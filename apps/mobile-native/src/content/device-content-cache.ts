import {
  normalizeTrustedContentCollection,
  type MobileContentRecordInput,
  type TrustedMobileContentRecord,
} from "./content-trust";

export interface DeviceContentCacheRecord {
  ownerId: string;
  manifestVersion: string;
  revalidateAfter: string;
  sourceRevisions: Record<string, string>;
  items: TrustedMobileContentRecord[];
  storedAt: string;
}

export interface DeviceContentCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const DEVICE_CONTENT_CACHE_PREFIX = "native_device_content_v1";
const DEVICE_CONTENT_CACHE_SCHEMA_VERSION = 1;
const DEFAULT_HARD_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const DIGEST_PATTERN = /^[a-f\d]{64}$/u;
const SOURCE_REVISION_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;

export async function readDeviceContentCache(
  ownerId: string,
  options: { storage?: DeviceContentCacheStorage; now?: Date; hardRetentionMs?: number } = {},
): Promise<DeviceContentCacheRecord | null> {
  const storage = options.storage ?? loadAsyncStorage();
  const key = createDeviceContentCacheKey(ownerId);
  const raw = await storage.getItem(key);
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    await storage.removeItem(key);
    return null;
  }
  const parsed = parseCacheRecord(value, ownerId);
  const retentionMs = options.hardRetentionMs ?? DEFAULT_HARD_RETENTION_MS;
  const now = options.now ?? new Date();
  if (!parsed || Date.parse(parsed.storedAt) + retentionMs <= now.getTime()) {
    await storage.removeItem(key);
    return null;
  }
  return parsed;
}

export async function writeDeviceContentCache(
  record: DeviceContentCacheRecord,
  storage: DeviceContentCacheStorage = loadAsyncStorage(),
): Promise<void> {
  const parsed = parseCacheRecord({ schemaVersion: DEVICE_CONTENT_CACHE_SCHEMA_VERSION, ...record }, record.ownerId);
  if (!parsed) throw new Error("DEVICE_CONTENT_CACHE_INVALID");
  await storage.setItem(createDeviceContentCacheKey(record.ownerId), JSON.stringify({
    schemaVersion: DEVICE_CONTENT_CACHE_SCHEMA_VERSION,
    ...parsed,
  }));
}

export function deleteDeviceContentCache(
  ownerId: string,
  storage: DeviceContentCacheStorage = loadAsyncStorage(),
): Promise<void> {
  return storage.removeItem(createDeviceContentCacheKey(ownerId));
}

export function createDeviceContentCacheKey(ownerId: string): string {
  const normalized = ownerId.trim();
  if (!normalized || normalized !== ownerId || normalized.length > 512) {
    throw new Error("DEVICE_CONTENT_CACHE_OWNER_INVALID");
  }
  const encoded = Array.from(normalized, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("_");
  return `${DEVICE_CONTENT_CACHE_PREFIX}_${encoded}`;
}

function parseCacheRecord(value: unknown, ownerId: string): DeviceContentCacheRecord | null {
  if (!isRecord(value) || value.schemaVersion !== DEVICE_CONTENT_CACHE_SCHEMA_VERSION || value.ownerId !== ownerId) return null;
  if (!DIGEST_PATTERN.test(asString(value.manifestVersion))) return null;
  const revalidateAfter = readIsoTimestamp(value.revalidateAfter);
  const storedAt = readIsoTimestamp(value.storedAt);
  if (!revalidateAfter || !storedAt || !isRecord(value.sourceRevisions) || !Array.isArray(value.items)) return null;
  const sourceRevisions: Record<string, string> = {};
  for (const [sourceId, revision] of Object.entries(value.sourceRevisions)) {
    if (!sourceId || sourceId.length > 512 || typeof revision !== "string" || !SOURCE_REVISION_PATTERN.test(revision)) return null;
    sourceRevisions[sourceId] = revision;
  }
  const normalized = normalizeTrustedContentCollection(value.items as MobileContentRecordInput[]);
  if (normalized.omittedCount > 0 || normalized.duplicateCount > 0 || normalized.items.length !== value.items.length) return null;
  return {
    ownerId,
    manifestVersion: asString(value.manifestVersion),
    revalidateAfter,
    sourceRevisions,
    items: normalized.items,
    storedAt,
  };
}

function readIsoTimestamp(value: unknown): string | null {
  const timestamp = asString(value);
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === timestamp ? timestamp : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function loadAsyncStorage(): DeviceContentCacheStorage {
  const loaded = require("@react-native-async-storage/async-storage") as {
    default?: DeviceContentCacheStorage;
    getItem?: DeviceContentCacheStorage["getItem"];
    setItem?: DeviceContentCacheStorage["setItem"];
    removeItem?: DeviceContentCacheStorage["removeItem"];
  };
  const storage = loaded.default ?? (loaded as DeviceContentCacheStorage);
  if (
    typeof storage.getItem !== "function"
    || typeof storage.setItem !== "function"
    || typeof storage.removeItem !== "function"
  ) throw new Error("AsyncStorage is unavailable.");
  return storage;
}
