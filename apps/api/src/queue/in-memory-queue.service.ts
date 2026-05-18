import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { QueueJobRecord, QueueService } from "./queue.types.js";

@Injectable()
export class InMemoryQueueService implements QueueService {
  private readonly jobs = new Map<string, QueueJobRecord>();

  async enqueue<TPayload extends Record<string, unknown>>(name: string, payload: TPayload, input: { runAt?: Date } = {}): Promise<QueueJobRecord<TPayload>> {
    const now = new Date();
    const job: QueueJobRecord<TPayload> = {
      id: randomUUID(),
      name,
      payload,
      status: "queued",
      runAt: input.runAt ?? now,
      attempts: 0,
      createdAt: now,
      updatedAt: now
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async listQueued(name?: string): Promise<QueueJobRecord[]> {
    return [...this.jobs.values()]
      .filter((job) => job.status === "queued")
      .filter((job) => (name ? job.name === name : true))
      .sort((left, right) => left.runAt.getTime() - right.runAt.getTime());
  }
}
