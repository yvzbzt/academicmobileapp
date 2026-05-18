import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { QueueJobRecord, QueueService } from "./queue.types.js";

@Injectable()
export class BullMqQueueService implements QueueService, OnApplicationShutdown {
  private readonly connection?: Redis;
  private readonly queues = new Map<string, Queue>();

  constructor(@Inject("REDIS_URL") redisUrl?: string) {
    if (redisUrl) this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  async enqueue<TPayload extends Record<string, unknown>>(name: string, payload: TPayload, input: { runAt?: Date } = {}): Promise<QueueJobRecord<TPayload>> {
    if (!this.connection) throw new Error("REDIS_NOT_CONFIGURED");
    const queue = this.getQueue(name);
    const now = new Date();
    const delay = Math.max((input.runAt?.getTime() ?? now.getTime()) - now.getTime(), 0);
    const job = await queue.add(name, payload, { delay, attempts: 5, removeOnComplete: 1000, removeOnFail: 5000 });
    return {
      id: job.id ?? `${name}:${now.getTime()}`,
      name,
      payload,
      status: "queued",
      runAt: input.runAt ?? now,
      attempts: job.attemptsMade,
      createdAt: now,
      updatedAt: now
    };
  }

  async listQueued(name?: string): Promise<QueueJobRecord[]> {
    if (!this.connection) throw new Error("REDIS_NOT_CONFIGURED");
    const queues = name ? [this.getQueue(name)] : [...this.queues.values()];
    const records: QueueJobRecord[] = [];
    for (const queue of queues) {
      const jobs = await queue.getJobs(["waiting", "delayed"]);
      records.push(
        ...jobs.map((job) => ({
          id: job.id ?? `${queue.name}:${job.timestamp}`,
          name: queue.name,
          payload: job.data,
          status: "queued" as const,
          runAt: new Date(job.timestamp + (job.delay ?? 0)),
          attempts: job.attemptsMade,
          createdAt: new Date(job.timestamp),
          updatedAt: new Date(job.timestamp)
        }))
      );
    }
    return records.sort((left, right) => left.runAt.getTime() - right.runAt.getTime());
  }

  async onApplicationShutdown() {
    for (const queue of this.queues.values()) await queue.close();
    await this.connection?.quit();
  }

  private getQueue(name: string): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;
    if (!this.connection) throw new Error("REDIS_NOT_CONFIGURED");
    const queue = new Queue(name, { connection: this.connection });
    this.queues.set(name, queue);
    return queue;
  }
}
