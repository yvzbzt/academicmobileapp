import { Inject, Injectable, OnApplicationShutdown, Optional } from "@nestjs/common";
import { Redis } from "ioredis";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import { NotificationWorkerService } from "../notifications/notification-worker.service.js";

export interface DependencyHealthRecord {
  name: string;
  status: "ok" | "skipped" | "down";
  detail?: string;
}

@Injectable()
export class InfrastructureHealthService implements OnApplicationShutdown {
  private readonly redis?: Redis;

  constructor(
    @Inject(MongoConnectionService) private readonly mongo: MongoConnectionService,
    @Optional() @Inject("REDIS_URL") redisUrl?: string,
    @Optional() @Inject(NotificationWorkerService) private readonly notificationWorker?: NotificationWorkerService
  ) {
    if (redisUrl) this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
  }

  async readiness(): Promise<{ status: "ok" | "degraded"; dependencies: DependencyHealthRecord[] }> {
    const config = readRuntimeConfig();
    const dependencies: DependencyHealthRecord[] = [{ name: "api", status: "ok" }];
    dependencies.push(await this.mongoHealth());
    dependencies.push(await this.redisHealth(config.queueMode === "bullmq" || config.rateLimitStoreMode === "redis"));
    if (this.notificationWorker) dependencies.push(this.notificationWorkerHealth());
    return { status: dependencies.some((dependency) => dependency.status === "down") ? "degraded" : "ok", dependencies };
  }

  async onApplicationShutdown() {
    await this.redis?.quit();
  }

  private async mongoHealth(): Promise<DependencyHealthRecord> {
    try {
      const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
      if (!connection?.db) return { name: "mongodb", status: "down", detail: "not connected" };
      await connection.db.admin().ping();
      return { name: "mongodb", status: "ok" };
    } catch (error) {
      return { name: "mongodb", status: "down", detail: error instanceof Error ? error.message : String(error) };
    }
  }

  private async redisHealth(required: boolean): Promise<DependencyHealthRecord> {
    if (!required) return { name: "redis", status: "skipped", detail: "Redis-backed modes are disabled" };
    if (!this.redis) return { name: "redis", status: "down", detail: "REDIS_URL is not configured" };
    try {
      if (this.redis.status === "wait") await this.redis.connect();
      await this.redis.ping();
      return { name: "redis", status: "ok" };
    } catch (error) {
      return { name: "redis", status: "down", detail: error instanceof Error ? error.message : String(error) };
    }
  }

  private notificationWorkerHealth(): DependencyHealthRecord {
    const health = this.notificationWorker!.health();
    if (!health.enabled && health.state === "disabled") return { name: "notification-worker", status: "skipped", detail: "disabled" };
    const detail = `${health.state}; due=${health.backlog.due}; retrying=${health.backlog.retrying}; processing=${health.backlog.processing}; dead=${health.backlog.dead}; delivery_sending=${health.deliveryAttempts.sending}; delivery_expired=${health.deliveryAttempts.expiredSending}; delivery_ambiguous=${health.deliveryAttempts.ambiguous}`;
    if (
      health.state === "degraded"
      || health.state === "draining"
      || health.deliveryAttempts.expiredSending > 0
    ) {
      return { name: "notification-worker", status: "down", detail };
    }
    return { name: "notification-worker", status: "ok", detail };
  }

}
