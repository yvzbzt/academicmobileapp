import type { NativeCalendarStorageKey } from "./types";

const STORAGE_PREFIX = "native_calendar_state_v3";
const LEGACY_STORAGE_PREFIX = "native_calendar_state_v2";

export function createNativeCalendarStorageKey(key: NativeCalendarStorageKey): string {
  return createStorageKey(STORAGE_PREFIX, key);
}

export function createLegacyNativeCalendarStorageKey(key: NativeCalendarStorageKey): string {
  return createStorageKey(LEGACY_STORAGE_PREFIX, key);
}

function createStorageKey(prefix: string, key: NativeCalendarStorageKey): string {
  return [prefix, key.platform, encodeStorageKeyPart(key.userId), encodeStorageKeyPart(key.deviceId)].join("_");
}

function encodeStorageKeyPart(value: string): string {
  return Array.from(value, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("_");
}
