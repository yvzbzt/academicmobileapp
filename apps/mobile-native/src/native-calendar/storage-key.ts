import type { NativeCalendarStorageKey } from "./types";

const STORAGE_PREFIX = "native_calendar_state_v2";

export function createNativeCalendarStorageKey(key: NativeCalendarStorageKey): string {
  return [STORAGE_PREFIX, key.platform, encodeStorageKeyPart(key.userId), encodeStorageKeyPart(key.deviceId)].join("_");
}

function encodeStorageKeyPart(value: string): string {
  return Array.from(value, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("_");
}
