import {
  normalizeTrustedContentCollection,
  type MobileContentRecordInput,
  type TrustedMobileContentRecord,
} from "./content-trust";

export interface DeviceContentCacheRecord {
  ownerId: string;
  manifestVersion: string;
  revalidateAfter: string;
  snapshotIncomplete: boolean;
  sourceRevisions: Record<string, string>;
  sourceValidUntil: Record<string, string>;
  failedSourceIds: string[];
  items: TrustedMobileContentRecord[];
  storedAt: string;
}

export interface DeviceContentCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const DEVICE_CONTENT_CACHE_PREFIX = "native_device_content_v1";
const DEVICE_CONTENT_CACHE_SCHEMA_VERSION = 4;
const DEFAULT_HARD_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const DIGEST_PATTERN = /^[a-f\d]{64}$/u;
const SOURCE_REVISION_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;
// Match the manifest/runtime bounds without a global cut that hides sources.
const MAX_CACHED_SOURCES = 512;
const MAX_ITEMS_PER_SOURCE = 60;
// ponytail: one bounded snapshot per owner; use per-source files if real follow
// sets exceed 16 Mi characters rather than silently dropping another source.
const MAX_CACHE_CHARACTERS = 16 * 1_024 * 1_024;
const MAX_CACHE_FILE_BYTES = 64 * 1_024 * 1_024;
const fileOperations = new Map<string, Promise<void>>();

export async function readDeviceContentCache(
  ownerId: string,
  options: { storage?: DeviceContentCacheStorage; now?: Date; hardRetentionMs?: number } = {},
): Promise<DeviceContentCacheRecord | null> {
  const storage = options.storage ?? loadFileStorage();
  const key = createDeviceContentCacheKey(ownerId);
  const raw = await storage.getItem(key);
  if (!raw) return null;
  if (raw.length > MAX_CACHE_CHARACTERS) {
    await storage.removeItem(key);
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    await deleteDeviceContentCache(ownerId, storage);
    return null;
  }
  const parsed = parseCacheRecord(value, ownerId);
  const retentionMs = options.hardRetentionMs ?? DEFAULT_HARD_RETENTION_MS;
  const now = options.now ?? new Date();
  if (!parsed || Date.parse(parsed.storedAt) + retentionMs <= now.getTime()) {
    await deleteDeviceContentCache(ownerId, storage);
    return null;
  }
  const activeSourceIds = new Set(Object.entries(parsed.sourceValidUntil)
    .filter(([, validUntil]) => Date.parse(validUntil) > now.getTime())
    .map(([sourceId]) => sourceId));
  const leaseExpired = activeSourceIds.size !== Object.keys(parsed.sourceValidUntil).length;
  const sourceRevisions = Object.fromEntries(Object.entries(parsed.sourceRevisions)
    .filter(([sourceId]) => activeSourceIds.has(sourceId)));
  const sourceValidUntil = Object.fromEntries(Object.entries(parsed.sourceValidUntil)
    .filter(([sourceId]) => activeSourceIds.has(sourceId)));
  const failedSourceIds = parsed.failedSourceIds.filter((sourceId) => activeSourceIds.has(sourceId));
  const earliestLease = Object.values(sourceValidUntil).sort()[0];
  return {
    ...parsed,
    revalidateAfter: leaseExpired
      ? now.toISOString()
      : earliestLease && earliestLease < parsed.revalidateAfter
        ? earliestLease
        : parsed.revalidateAfter,
    sourceRevisions,
    sourceValidUntil,
    failedSourceIds,
    items: parsed.items.filter((item) => activeSourceIds.has(item.sourceId)),
  };
}

export async function writeDeviceContentCache(
  record: DeviceContentCacheRecord,
  storage: DeviceContentCacheStorage = loadFileStorage(),
): Promise<void> {
  const parsed = parseCacheRecord({ schemaVersion: DEVICE_CONTENT_CACHE_SCHEMA_VERSION, ...record }, record.ownerId);
  if (!parsed) throw new Error("DEVICE_CONTENT_CACHE_INVALID");
  const key = createDeviceContentCacheKey(record.ownerId);
  const payload = JSON.stringify({
    schemaVersion: DEVICE_CONTENT_CACHE_SCHEMA_VERSION,
    ...parsed,
  });
  if (payload.length > MAX_CACHE_CHARACTERS) throw new Error("DEVICE_CONTENT_CACHE_TOO_LARGE");
  await storage.setItem(key, payload);
}

export async function deleteDeviceContentCache(
  ownerId: string,
  storage: DeviceContentCacheStorage = loadFileStorage(),
): Promise<void> {
  const key = createDeviceContentCacheKey(ownerId);
  await storage.removeItem(key);
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
  if (
    !revalidateAfter
    || !storedAt
    || typeof value.snapshotIncomplete !== "boolean"
    || !isRecord(value.sourceRevisions)
    || !isRecord(value.sourceValidUntil)
    || !Array.isArray(value.failedSourceIds)
    || !Array.isArray(value.items)
  ) return null;
  if (
    Object.keys(value.sourceRevisions).length > MAX_CACHED_SOURCES
    || Object.keys(value.sourceValidUntil).length > MAX_CACHED_SOURCES
    || value.items.length > MAX_CACHED_SOURCES * MAX_ITEMS_PER_SOURCE
  ) return null;
  const sourceRevisions: Record<string, string> = {};
  for (const [sourceId, revision] of Object.entries(value.sourceRevisions)) {
    if (!sourceId || sourceId.length > 512 || typeof revision !== "string" || !SOURCE_REVISION_PATTERN.test(revision)) return null;
    sourceRevisions[sourceId] = revision;
  }
  const sourceValidUntil: Record<string, string> = {};
  for (const [sourceId, rawValidUntil] of Object.entries(value.sourceValidUntil)) {
    const validUntil = readIsoTimestamp(rawValidUntil);
    if (!sourceId || sourceId.length > 512 || !validUntil) return null;
    sourceValidUntil[sourceId] = validUntil;
  }
  if (Object.keys(sourceRevisions).some((sourceId) => !(sourceId in sourceValidUntil))) return null;
  const failedSourceIds = value.failedSourceIds;
  if (
    failedSourceIds.length > 512
    || failedSourceIds.some((sourceId) => typeof sourceId !== "string" || !(sourceId in sourceValidUntil))
    || new Set(failedSourceIds).size !== failedSourceIds.length
  ) return null;
  const normalized = normalizeTrustedContentCollection(value.items as MobileContentRecordInput[]);
  if (normalized.omittedCount > 0 || normalized.duplicateCount > 0 || normalized.items.length !== value.items.length) return null;
  if (normalized.items.some((item) => !(item.sourceId in sourceValidUntil))) return null;
  const itemsPerSource = new Map<string, number>();
  for (const item of normalized.items) {
    const count = (itemsPerSource.get(item.sourceId) ?? 0) + 1;
    if (count > MAX_ITEMS_PER_SOURCE) return null;
    itemsPerSource.set(item.sourceId, count);
  }
  return {
    ownerId,
    manifestVersion: asString(value.manifestVersion),
    revalidateAfter,
    snapshotIncomplete: value.snapshotIncomplete,
    sourceRevisions,
    sourceValidUntil,
    failedSourceIds: [...failedSourceIds].sort(),
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

function loadFileStorage(): DeviceContentCacheStorage {
  const fs = require("expo-file-system/legacy") as typeof import("expo-file-system/legacy");
  const crypto = require("expo-crypto") as typeof import("expo-crypto");
  const legacy = loadAsyncStorage();
  // Private cache files avoid Android's ~2 MiB row and default 6 MiB database
  // limits. The OS may evict this regenerable cache; authority leases still apply.
  const fileUri = async (key: string) => {
    if (!fs.cacheDirectory) throw new Error("DEVICE_CONTENT_CACHE_DIRECTORY_UNAVAILABLE");
    const digest = await crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, key);
    return `${fs.cacheDirectory}device-content-${digest}.json`;
  };
  return {
    getItem: (key) => serializeFileOperation(key, async () => {
      const uri = await fileUri(key);
      const info = await fs.getInfoAsync(uri);
      if (!info.exists) return legacy.getItem(key);
      if (info.size > MAX_CACHE_FILE_BYTES) {
        await fs.deleteAsync(uri, { idempotent: true });
        return null;
      }
      return fs.readAsStringAsync(uri);
    }),
    setItem: (key, value) => serializeFileOperation(key, async () => {
      const uri = await fileUri(key);
      const temporaryUri = `${uri}.tmp`;
      try {
        await fs.writeAsStringAsync(temporaryUri, value);
        await fs.moveAsync({ from: temporaryUri, to: uri });
        await legacy.removeItem(key);
      } finally {
        await fs.deleteAsync(temporaryUri, { idempotent: true });
      }
    }),
    removeItem: (key) => serializeFileOperation(key, async () => {
      const uri = await fileUri(key);
      await fs.deleteAsync(uri, { idempotent: true });
      await fs.deleteAsync(`${uri}.tmp`, { idempotent: true });
      await legacy.removeItem(key);
    }),
  };
}

function serializeFileOperation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = fileOperations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(() => undefined, () => undefined);
  fileOperations.set(key, tail);
  return current.finally(() => {
    if (fileOperations.get(key) === tail) fileOperations.delete(key);
  });
}
