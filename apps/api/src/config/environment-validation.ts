import { readRuntimeConfig, type RuntimeConfig } from "./runtime-config.js";

export interface EnvironmentValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  config: RuntimeConfig;
}

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): EnvironmentValidationResult {
  const config = readRuntimeConfig(env);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.repositoryMode === "mongo" && !env.MONGODB_URI) errors.push("MONGODB_URI is required when REPOSITORY_MODE=mongo.");
  if (config.queueMode === "bullmq" && !env.REDIS_URL) errors.push("REDIS_URL is required when QUEUE_MODE=bullmq.");
  if (config.rateLimitStoreMode === "redis" && !env.REDIS_URL) errors.push("REDIS_URL is required when RATE_LIMIT_STORE=redis.");
  if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET.length < 32) warnings.push("JWT_ACCESS_SECRET should be set to a 32+ character secret.");
  if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 32) warnings.push("JWT_REFRESH_SECRET should be set to a 32+ character secret.");
  if (env.NODE_ENV === "production" && !env.FIREBASE_SERVICE_ACCOUNT_JSON) warnings.push("FIREBASE_SERVICE_ACCOUNT_JSON is required before production push delivery is enabled.");
  if (env.NODE_ENV === "production" && (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS)) warnings.push("SMTP_HOST, SMTP_USER and SMTP_PASS should be configured for email verification in production.");

  return { valid: errors.length === 0, errors, warnings, config };
}

export function assertValidEnvironment(env: NodeJS.ProcessEnv = process.env): EnvironmentValidationResult {
  const result = validateEnvironment(env);
  if (!result.valid) throw new Error(`ENVIRONMENT_INVALID: ${result.errors.join(" ")}`);
  return result;
}
