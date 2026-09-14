export interface DeviceSavedContentStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const DEVICE_SAVED_CONTENT_PREFIX = "native_device_saved_content_v1";
const DEVICE_SAVED_CONTENT_SCHEMA_VERSION = 1;
const DEVICE_CONTENT_ID_PATTERN = /^device-[\p{L}\p{N}._:@/+-]{1,512}-[a-f\d]{16}$/u;
const MAX_SAVED_ITEM_COUNT = 1_000;

export function isDeviceContentRecordId(value: string): boolean {
  return DEVICE_CONTENT_ID_PATTERN.test(value);
}

export async function isDeviceContentSaved(
  ownerId: string,
  contentId: string,
  storage: DeviceSavedContentStorage = loadAsyncStorage(),
): Promise<boolean> {
  if (!isDeviceContentRecordId(contentId)) return false;
  return (await readSavedIds(ownerId, storage)).has(contentId);
}

export async function setDeviceContentSaved(
  ownerId: string,
  contentId: string,
  saved: boolean,
  storage: DeviceSavedContentStorage = loadAsyncStorage(),
): Promise<void> {
  if (!isDeviceContentRecordId(contentId)) throw new Error("DEVICE_CONTENT_ID_INVALID");
  const ids = await readSavedIds(ownerId, storage);
  if (saved) ids.add(contentId);
  else ids.delete(contentId);
  if (ids.size > MAX_SAVED_ITEM_COUNT) throw new Error("DEVICE_SAVED_CONTENT_LIMIT_EXCEEDED");
  const key = createDeviceSavedContentKey(ownerId);
  if (ids.size === 0) {
    await storage.removeItem(key);
    return;
  }
  await storage.setItem(key, JSON.stringify({
    schemaVersion: DEVICE_SAVED_CONTENT_SCHEMA_VERSION,
    ownerId,
    ids: [...ids].sort(),
  }));
}

export function deleteDeviceSavedContent(
  ownerId: string,
  storage: DeviceSavedContentStorage = loadAsyncStorage(),
): Promise<void> {
  return storage.removeItem(createDeviceSavedContentKey(ownerId));
}

export function createDeviceSavedContentKey(ownerId: string): string {
  const normalized = ownerId.trim();
  if (!normalized || normalized !== ownerId || normalized.length > 512) {
    throw new Error("DEVICE_SAVED_CONTENT_OWNER_INVALID");
  }
  const encoded = Array.from(normalized, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("_");
  return `${DEVICE_SAVED_CONTENT_PREFIX}_${encoded}`;
}

async function readSavedIds(
  ownerId: string,
  storage: DeviceSavedContentStorage,
): Promise<Set<string>> {
  const key = createDeviceSavedContentKey(ownerId);
  const raw = await storage.getItem(key);
  if (!raw) return new Set();
  try {
    const value = JSON.parse(raw) as unknown;
    if (
      !isRecord(value)
      || value.schemaVersion !== DEVICE_SAVED_CONTENT_SCHEMA_VERSION
      || value.ownerId !== ownerId
      || !Array.isArray(value.ids)
      || value.ids.length > MAX_SAVED_ITEM_COUNT
      || value.ids.some((id) => typeof id !== "string" || !isDeviceContentRecordId(id))
      || new Set(value.ids).size !== value.ids.length
    ) throw new Error("DEVICE_SAVED_CONTENT_INVALID");
    return new Set(value.ids as string[]);
  } catch {
    await storage.removeItem(key);
    return new Set();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function loadAsyncStorage(): DeviceSavedContentStorage {
  const loaded = require("@react-native-async-storage/async-storage") as {
    default?: DeviceSavedContentStorage;
    getItem?: DeviceSavedContentStorage["getItem"];
    setItem?: DeviceSavedContentStorage["setItem"];
    removeItem?: DeviceSavedContentStorage["removeItem"];
  };
  const storage = loaded.default ?? (loaded as DeviceSavedContentStorage);
  if (
    typeof storage.getItem !== "function"
    || typeof storage.setItem !== "function"
    || typeof storage.removeItem !== "function"
  ) throw new Error("AsyncStorage is unavailable.");
  return storage;
}
