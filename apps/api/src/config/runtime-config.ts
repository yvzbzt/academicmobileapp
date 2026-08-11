export type QueueMode = "memory" | "bullmq";
export type RateLimitStoreMode = "memory" | "redis";

export interface RuntimeConfig {
  queueMode: QueueMode;
  rateLimitStoreMode: RateLimitStoreMode;
  redisUrl?: string;
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    queueMode: parseMode(env.QUEUE_MODE, ["memory", "bullmq"], "memory"),
    rateLimitStoreMode: parseMode(env.RATE_LIMIT_STORE, ["memory", "redis"], "memory"),
    ...(env.REDIS_URL ? { redisUrl: env.REDIS_URL } : {})
  };
}

function parseMode<TMode extends string>(value: string | undefined, allowed: readonly TMode[], fallback: TMode): TMode {
  return allowed.includes(value as TMode) ? (value as TMode) : fallback;
}
