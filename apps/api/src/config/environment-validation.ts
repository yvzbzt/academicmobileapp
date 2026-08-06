import { readRuntimeConfig, type RuntimeConfig } from "./runtime-config.js";
import { invalidTrustedProxyCidrs } from "../common/network/client-ip.js";
import { isProductionSecret } from "./production-secret.js";

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
  const isProduction = env.NODE_ENV === "production";

  if (!env.MONGODB_URI?.trim()) errors.push("MONGODB_URI is required.");
  const invalidProxyCidrs = invalidTrustedProxyCidrs(env.TRUSTED_PROXY_CIDRS);
  if (invalidProxyCidrs.length > 0) errors.push("TRUSTED_PROXY_CIDRS must contain only valid explicit CIDR ranges.");
  if (config.queueMode === "bullmq" && !env.REDIS_URL) errors.push("REDIS_URL is required when QUEUE_MODE=bullmq.");
  if (config.rateLimitStoreMode === "redis" && !env.REDIS_URL) errors.push("REDIS_URL is required when RATE_LIMIT_STORE=redis.");
  if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET.length < 32) {
    const message = "JWT_ACCESS_SECRET must be set to a 32+ character secret in production.";
    if (isProduction && !isProductionSecret(env.JWT_ACCESS_SECRET)) errors.push(message);
    else warnings.push("JWT_ACCESS_SECRET should be set to a 32+ character secret.");
  } else if (isProduction && !isProductionSecret(env.JWT_ACCESS_SECRET)) {
    errors.push("JWT_ACCESS_SECRET must be set to a 32+ character secret in production.");
  }
  if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 32) {
    warnings.push("JWT_REFRESH_SECRET should be set to a 32+ character secret.");
  }
  if (!env.CALENDAR_FEED_SECRET || env.CALENDAR_FEED_SECRET.length < 32) {
    const message = "CALENDAR_FEED_SECRET must be set to a 32+ character secret in production.";
    if (isProduction && !isProductionSecret(env.CALENDAR_FEED_SECRET)) errors.push(message);
    else warnings.push("CALENDAR_FEED_SECRET should be set to a 32+ character secret.");
  } else if (isProduction && !isProductionSecret(env.CALENDAR_FEED_SECRET)) {
    errors.push("CALENDAR_FEED_SECRET must be set to a 32+ character secret in production.");
  }
  if (
    isProduction
    && isProductionSecret(env.JWT_ACCESS_SECRET)
    && isProductionSecret(env.CALENDAR_FEED_SECRET)
    && env.JWT_ACCESS_SECRET === env.CALENDAR_FEED_SECRET
  ) {
    errors.push("CALENDAR_FEED_SECRET must differ from JWT_ACCESS_SECRET in production.");
  }
  const passwordRecoverySecret = env.PASSWORD_RECOVERY_TOKEN_PEPPER ?? env.JWT_ACCESS_SECRET;
  if (isProduction && !isProductionSecret(passwordRecoverySecret)) {
    errors.push("PASSWORD_RECOVERY_TOKEN_PEPPER or JWT_ACCESS_SECRET must provide a 32+ character password-recovery digest secret in production.");
  }
  if (isProduction && !hasFirebaseAdminConfig(env)) warnings.push("Firebase Admin credentials or Cloud Run application default credentials are required before production push delivery is enabled.");
  if (isProduction && (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS)) warnings.push("SMTP_HOST, SMTP_USER and SMTP_PASS should be configured for email verification in production.");

  return { valid: errors.length === 0, errors, warnings, config };
}

export function assertValidEnvironment(env: NodeJS.ProcessEnv = process.env): EnvironmentValidationResult {
  const result = validateEnvironment(env);
  if (!result.valid) throw new Error(`ENVIRONMENT_INVALID: ${result.errors.join(" ")}`);
  return result;
}

function hasFirebaseAdminConfig(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON || env.FIREBASE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || env.GOOGLE_APPLICATION_CREDENTIALS || env.K_SERVICE);
}
