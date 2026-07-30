import type { AuthUserRecord, PasswordRecoveryTokenRecord, RefreshTokenRecord } from "./auth.types.js";

export function normalizeCredentialGeneration(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function normalizeAuthUserRecord(record: AuthUserRecord): AuthUserRecord {
  return { ...record, credentialGeneration: normalizeCredentialGeneration(record.credentialGeneration) };
}

export function normalizeRefreshTokenRecord(record: RefreshTokenRecord): RefreshTokenRecord {
  return { ...record, credentialGeneration: normalizeCredentialGeneration(record.credentialGeneration) };
}

export function normalizePasswordRecoveryTokenRecord(record: PasswordRecoveryTokenRecord): PasswordRecoveryTokenRecord {
  return { ...record, credentialGeneration: normalizeCredentialGeneration(record.credentialGeneration) };
}
