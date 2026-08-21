import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { isProductionSecret } from "../config/production-secret.js";

const ENCRYPTION_PREFIX = "enc:v1";
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u;
const DEVELOPMENT_KEY_ID = "development-v1";

export interface DataProtectionValidationResult {
  errors: string[];
}

export function protectSensitiveValue(value: string, purpose: string, env: NodeJS.ProcessEnv = process.env): string {
  if (isProtectedSensitiveValue(value)) return value;
  const { id, key } = activeEncryptionKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadFor(purpose, id));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_PREFIX, id, encode(iv), encode(tag), encode(ciphertext)].join(":");
}

export function revealSensitiveValue(value: string, purpose: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!isProtectedSensitiveValue(value)) return value;
  const parts = value.split(":");
  if (parts.length !== 6) throw new Error(`SENSITIVE_DATA_FORMAT_INVALID:${purpose}`);
  const keyId = parts[2] ?? "";
  const key = encryptionKeys(env).get(keyId);
  if (!key) throw new Error(`SENSITIVE_DATA_KEY_UNAVAILABLE:${keyId}`);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, decode(parts[3] ?? ""));
    decipher.setAAD(aadFor(purpose, keyId));
    decipher.setAuthTag(decode(parts[4] ?? ""));
    return Buffer.concat([decipher.update(decode(parts[5] ?? "")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(`SENSITIVE_DATA_DECRYPTION_FAILED:${purpose}`);
  }
}

export function sensitiveLookupHash(value: string, purpose: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac("sha256", lookupKey(env))
    .update(`academic-mobile:${purpose}:v1\0`, "utf8")
    .update(value, "utf8")
    .digest("hex");
}

export function isProtectedSensitiveValue(value: string): boolean {
  return value.startsWith(`${ENCRYPTION_PREFIX}:`);
}

export function validateDataProtectionEnvironment(env: NodeJS.ProcessEnv = process.env): DataProtectionValidationResult {
  const errors: string[] = [];
  if (env.NODE_ENV !== "production") return { errors };

  if (!KEY_ID_PATTERN.test(env.DATA_ENCRYPTION_KEY_ID ?? "")) {
    errors.push("DATA_ENCRYPTION_KEY_ID must contain 1-32 URL-safe identifier characters in production.");
  }
  if (!isValidEncodedKey(env.DATA_ENCRYPTION_KEY)) {
    errors.push("DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key in production.");
  }
  if (!isValidEncodedKey(env.DATA_LOOKUP_HMAC_SECRET)) {
    errors.push("DATA_LOOKUP_HMAC_SECRET must be a base64-encoded 32-byte key in production.");
  }
  if (!isProductionSecret(env.EMAIL_VERIFICATION_TOKEN_PEPPER)) {
    errors.push("EMAIL_VERIFICATION_TOKEN_PEPPER must be an independent 32+ character secret in production.");
  }
  if (!isProductionSecret(env.PASSWORD_RECOVERY_TOKEN_PEPPER)) {
    errors.push("PASSWORD_RECOVERY_TOKEN_PEPPER must be an independent 32+ character secret in production.");
  }
  if (sameEncodedKey(env.DATA_ENCRYPTION_KEY, env.DATA_LOOKUP_HMAC_SECRET)) {
    errors.push("DATA_ENCRYPTION_KEY and DATA_LOOKUP_HMAC_SECRET must be independent.");
  }
  const independentSecrets = [
    env.JWT_ACCESS_SECRET,
    env.JWT_REFRESH_SECRET,
    env.CALENDAR_FEED_SECRET,
    env.EMAIL_VERIFICATION_TOKEN_PEPPER,
    env.PASSWORD_RECOVERY_TOKEN_PEPPER
  ].filter(isProductionSecret);
  if (new Set(independentSecrets).size !== independentSecrets.length) {
    errors.push("Authentication peppers and signing secrets must all be independent in production.");
  }

  try {
    previousEncryptionKeys(env);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "DATA_ENCRYPTION_PREVIOUS_KEYS is invalid.");
  }
  return { errors };
}

function activeEncryptionKey(env: NodeJS.ProcessEnv): { id: string; key: Buffer } {
  const id = env.DATA_ENCRYPTION_KEY_ID ?? DEVELOPMENT_KEY_ID;
  const configured = decodeConfiguredKey(env.DATA_ENCRYPTION_KEY);
  if (env.NODE_ENV === "production" && (!KEY_ID_PATTERN.test(id) || !configured)) {
    throw new Error("DATA_ENCRYPTION_KEY_NOT_CONFIGURED");
  }
  return { id, key: configured ?? developmentKey("data-encryption") };
}

function encryptionKeys(env: NodeJS.ProcessEnv): Map<string, Buffer> {
  const active = activeEncryptionKey(env);
  return new Map([[active.id, active.key], ...previousEncryptionKeys(env)]);
}

function previousEncryptionKeys(env: NodeJS.ProcessEnv): Array<[string, Buffer]> {
  const raw = env.DATA_ENCRYPTION_PREVIOUS_KEYS?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DATA_ENCRYPTION_PREVIOUS_KEYS must be a JSON object of key IDs to base64 keys.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DATA_ENCRYPTION_PREVIOUS_KEYS must be a JSON object of key IDs to base64 keys.");
  }
  return Object.entries(parsed).map(([id, encoded]) => {
    const key = typeof encoded === "string" ? decodeConfiguredKey(encoded) : null;
    if (!KEY_ID_PATTERN.test(id) || !key) {
      throw new Error("DATA_ENCRYPTION_PREVIOUS_KEYS contains an invalid key ID or key.");
    }
    return [id, key];
  });
}

function lookupKey(env: NodeJS.ProcessEnv): Buffer {
  const configured = decodeConfiguredKey(env.DATA_LOOKUP_HMAC_SECRET);
  if (env.NODE_ENV === "production" && !configured) throw new Error("DATA_LOOKUP_HMAC_SECRET_NOT_CONFIGURED");
  return configured ?? developmentKey("lookup-hmac");
}

function decodeConfiguredKey(value: string | undefined): Buffer | null {
  if (!value?.trim()) return null;
  try {
    const decoded = Buffer.from(value.trim(), "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

function isValidEncodedKey(value: string | undefined): boolean {
  return Boolean(decodeConfiguredKey(value));
}

function sameEncodedKey(first: string | undefined, second: string | undefined): boolean {
  const firstKey = decodeConfiguredKey(first);
  const secondKey = decodeConfiguredKey(second);
  return Boolean(firstKey && secondKey && firstKey.equals(secondKey));
}

function developmentKey(label: string): Buffer {
  return createHash("sha256").update(`academic-mobile-development:${label}:v1`, "utf8").digest();
}

function aadFor(purpose: string, keyId: string): Buffer {
  return Buffer.from(`academic-mobile:${purpose}:v1:${keyId}`, "utf8");
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}
