import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { type SessionPayload } from "./app-types";

export const SESSION_STORAGE_KEY = "native_session";

export const SESSION_INVALIDATED_STORAGE_VALUE = "native_session_invalidated_v1";

export const DEVICE_ID_STORAGE_KEY = "native_device_id";

export const PENDING_NOTIFICATION_STORAGE_KEY = "native_pending_notification_destination_v1";

export const LEGACY_GOOGLE_CALENDAR_STORAGE_KEY = "native_google_calendar_connection";

export const GOOGLE_CALENDAR_V2_STORAGE_PREFIX = "native_google_calendar_connection_v2";

export const GOOGLE_CALENDAR_STORAGE_PREFIX = "native_google_calendar_connection_v3";

export function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
}

export function getWebStorage(): Storage | null {
  if (typeof globalThis === "undefined") return null;
  if (typeof globalThis.localStorage === "undefined") return null;
  return globalThis.localStorage;
}

export async function getStoredValue(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return getWebStorage()?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

export function createGoogleCalendarStorageKey(ownerId: string): string {
  const normalized = ownerId.trim();
  if (!normalized) throw new Error("A Google Calendar connection owner is required.");
  const encoded = Array.from(normalized, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("_");
  return `${GOOGLE_CALENDAR_STORAGE_PREFIX}_${encoded}`;
}

export function createGoogleCalendarV2StorageKey(ownerId: string): string {
  const normalized = ownerId.trim();
  if (!normalized) throw new Error("A Google Calendar connection owner is required.");
  const encoded = Array.from(normalized, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("_");
  return `${GOOGLE_CALENDAR_V2_STORAGE_PREFIX}_${encoded}`;
}

export function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SessionPayload>;
  return typeof candidate.accessToken === "string"
    && Boolean(candidate.accessToken)
    && typeof candidate.refreshToken === "string"
    && Boolean(candidate.refreshToken)
    && typeof candidate.expiresInSeconds === "number"
    && Boolean(candidate.user)
    && typeof candidate.user?.id === "string"
    && Boolean(candidate.user.id)
    && typeof candidate.user?.email === "string"
    && typeof candidate.user?.fullName === "string"
    && typeof candidate.user?.role === "string";
}

export async function setStoredValue(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    const storage = getWebStorage();
    if (!storage) throw new Error("Web storage is unavailable.");
    storage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteStoredValue(key: string): Promise<void> {
  if (Platform.OS === "web") {
    const storage = getWebStorage();
    if (!storage) throw new Error("Web storage is unavailable.");
    storage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
