import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";

export interface RateLimitStore {
  consume(key: string, limit: { points: number; windowMs: number }): Promise<boolean>;
}

@Injectable()
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  async consume(key: string, limit: { points: number; windowMs: number }): Promise<boolean> {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
      return true;
    }
    if (bucket.count >= limit.points) return false;
    bucket.count += 1;
    return true;
  }
}

@Injectable()
export class RedisRateLimitStore implements RateLimitStore, OnApplicationShutdown {
  private readonly redis?: Redis;

  constructor(redisUrl = process.env.REDIS_URL) {
    if (redisUrl) this.redis = new Redis(redisUrl);
  }

  async consume(key: string, limit: { points: number; windowMs: number }): Promise<boolean> {
    if (!this.redis) throw new Error("REDIS_NOT_CONFIGURED");
    const redisKey = `rate-limit:${key}`;
    const count = await this.redis.incr(redisKey);
    if (count === 1) await this.redis.pexpire(redisKey, limit.windowMs);
    return count <= limit.points;
  }

  async onApplicationShutdown() {
    await this.redis?.quit();
  }
}
