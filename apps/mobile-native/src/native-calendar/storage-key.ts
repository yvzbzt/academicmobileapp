import type { NativeCalendarStorageKey } from "./types";

const STORAGE_PREFIX = "native_calendar_state_v3";
const LEGACY_STORAGE_PREFIX = "native_calendar_state_v2";
const MIGRATION_PREFIX = "native_calendar_migration_v1";
const RECOVERY_PREFIX = "native_calendar_recovery_v1";
const QUARANTINE_PREFIX = "native_calendar_quarantine_v1";

export function createNativeCalendarStorageKey(key: NativeCalendarStorageKey): string {
  return createStorageKey(STORAGE_PREFIX, key);
}

export function createLegacyNativeCalendarStorageKey(key: NativeCalendarStorageKey): string {
  return createStorageKey(LEGACY_STORAGE_PREFIX, key);
}

export function createNativeCalendarMigrationKey(key: NativeCalendarStorageKey): string {
  return createStorageKey(MIGRATION_PREFIX, key);
}

export function createNativeCalendarRecoveryKey(key: NativeCalendarStorageKey): string {
  return createStorageKey(RECOVERY_PREFIX, key);
}

export function createNativeCalendarQuarantineKey(
  key: NativeCalendarStorageKey,
  quarantinedAt: Date
): string {
  const timestamp = quarantinedAt.getTime();
  if (!Number.isFinite(timestamp)) throw new Error("A valid quarantine timestamp is required.");
  return `${createStorageKey(QUARANTINE_PREFIX, key)}_${timestamp}`;
}

function createStorageKey(prefix: string, key: NativeCalendarStorageKey): string {
  return [prefix, key.platform, encodeStorageKeyPart(key.userId), encodeStorageKeyPart(key.deviceId)].join("_");
}

function encodeStorageKeyPart(value: string): string {
  return Array.from(value, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("_");
}
