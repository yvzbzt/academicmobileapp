import {
  normalizeTrustedContentCollection,
  type TrustedMobileContentRecord,
} from "./content-trust";
import type { DeviceContentCacheStorage } from "./device-content-cache";
import { isDeviceContentRecordId } from "./device-saved-content";

export interface DeviceContentNotificationSourceLease {
  id: string;
  definitionVersion: string;
  validUntil: string;
  fetchAllowed: boolean;
}

interface DeviceContentNotificationLedger {
  ownerId: string;
  sourceDefinitions: Record<string, string>;
  sourceValidUntil: Record<string, string>;
  seenTokensBySource: Record<string, string[]>;
  pending: TrustedMobileContentRecord[];
  archive: TrustedMobileContentRecord[];
  updatedAt: string;
}

export interface RecordDeviceContentDiscoveryInput {
  ownerId: string;
  sources: readonly DeviceContentNotificationSourceLease[];
  fetchedBySource: ReadonlyMap<string, readonly TrustedMobileContentRecord[]>;
  storage?: DeviceContentCacheStorage;
  now?: Date;
}

const LEDGER_PREFIX = "native_device_content_notification_v1";
const LEDGER_SCHEMA_VERSION = 1;
const MAX_SOURCES = 512;
const MAX_SEEN_TOKENS_PER_SOURCE = 256;
const MAX_PENDING_ITEMS = 64;
const MAX_ARCHIVE_ITEMS = 64;
const MAX_SERIALIZED_LENGTH = 4_000_000;
const HARD_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const SOURCE_ID_PATTERN = /^[\p{L}\p{N}._:@/+-]{1,512}$/u;
const DEFINITION_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;
const TOKEN_PATTERN = /^[a-f\d]{16}$/u;
const queues = new Map<string, Promise<void>>();

/**
 * Records fetched snapshots independently from the bounded display cache.
 * A source's first fetched snapshot is a silent baseline, never history spam.
 */
export function recordDeviceContentDiscovery(
  input: RecordDeviceContentDiscoveryInput,
): Promise<TrustedMobileContentRecord[]> {
  return serialize(input.ownerId, async () => {
    const storage = input.storage ?? loadAsyncStorage();
    const now = input.now ?? new Date();
    const previous = await readUnlocked(input.ownerId, storage, now);
    const sourceById = new Map(input.sources.map((source) => [source.id, source]));
    const sourceDefinitions = Object.fromEntries(input.sources.map((source) => [source.id, source.definitionVersion]));
    const sourceValidUntil = Object.fromEntries(input.sources.map((source) => [source.id, source.validUntil]));
    const definitionStillMatches = (item: TrustedMobileContentRecord) => (
      previous?.sourceDefinitions[item.sourceId] === sourceById.get(item.sourceId)?.definitionVersion
    );
    const pending = new Map((previous?.pending ?? [])
      .filter((item) => definitionStillMatches(item) && sourceById.get(item.sourceId)?.fetchAllowed === true)
      .map((item) => [item.id, item]));
    const archive = new Map((previous?.archive ?? [])
      .filter(definitionStillMatches)
      .map((item) => [item.id, item]));
    const seenTokensBySource: Record<string, string[]> = {};

    for (const source of input.sources) {
      const definitionMatches = previous?.sourceDefinitions[source.id] === source.definitionVersion;
      const previousTokens = definitionMatches ? previous?.seenTokensBySource[source.id] : undefined;
      const didFetch = input.fetchedBySource.has(source.id);
      const fetchedItems = [...(input.fetchedBySource.get(source.id) ?? [])]
        .filter((item) => item.sourceId === source.id && isDeviceContentRecordId(item.id));
      const fetchedTokens = fetchedItems.flatMap((item) => {
        const token = recordToken(item, source.id);
        return token ? [token] : [];
      });

      if (source.fetchAllowed && previousTokens && didFetch) {
        const known = new Set(previousTokens);
        for (const item of fetchedItems) {
          const token = recordToken(item, source.id);
          if (token && !known.has(token) && !archive.has(item.id)) pending.set(item.id, item);
        }
      }

      if (previousTokens || didFetch) {
        seenTokensBySource[source.id] = [...new Set([
          ...fetchedTokens,
          ...(previousTokens ?? []),
        ])].slice(0, MAX_SEEN_TOKENS_PER_SOURCE);
      }
    }

    const next: DeviceContentNotificationLedger = {
      ownerId: input.ownerId,
      sourceDefinitions,
      sourceValidUntil,
      seenTokensBySource,
      pending: [...pending.values()].sort(compareRecency).slice(0, MAX_PENDING_ITEMS),
      archive: [...archive.values()].sort(compareRecency).slice(0, MAX_ARCHIVE_ITEMS),
      updatedAt: now.toISOString(),
    };
    await writeUnlocked(next, storage);
    return next.pending.map((item) => ({ ...item }));
  });
}

export function readPendingDeviceContentNotifications(
  ownerId: string,
  options: { storage?: DeviceContentCacheStorage; now?: Date } = {},
): Promise<TrustedMobileContentRecord[]> {
  return serialize(ownerId, async () => {
    const ledger = await readUnlocked(ownerId, options.storage ?? loadAsyncStorage(), options.now ?? new Date());
    return (ledger?.pending ?? []).map((item) => ({ ...item })).sort(compareRecency);
  });
}

/** Moves settled pending items into a bounded archive used by notification taps. */
export function acknowledgeDeviceContentNotifications(
  ownerId: string,
  itemIds: readonly string[],
  options: { storage?: DeviceContentCacheStorage; now?: Date } = {},
): Promise<void> {
  return serialize(ownerId, async () => {
    const storage = options.storage ?? loadAsyncStorage();
    const now = options.now ?? new Date();
    const ledger = await readUnlocked(ownerId, storage, now);
    if (!ledger) return;
    const acknowledged = new Set(itemIds.filter(isDeviceContentRecordId));
    if (acknowledged.size === 0) return;
    const moved = ledger.pending.filter((item) => acknowledged.has(item.id));
    if (moved.length === 0) return;
    const archive = new Map([...moved, ...ledger.archive].map((item) => [item.id, item]));
    await writeUnlocked({
      ...ledger,
      pending: ledger.pending.filter((item) => !acknowledged.has(item.id)),
      archive: [...archive.values()].sort(compareRecency).slice(0, MAX_ARCHIVE_ITEMS),
      updatedAt: now.toISOString(),
    }, storage);
  });
}

export function findDeviceContentNotificationRecord(
  ownerId: string,
  contentId: string,
  options: { storage?: DeviceContentCacheStorage; now?: Date } = {},
): Promise<TrustedMobileContentRecord | null> {
  if (!isDeviceContentRecordId(contentId)) return Promise.resolve(null);
  return serialize(ownerId, async () => {
    const ledger = await readUnlocked(ownerId, options.storage ?? loadAsyncStorage(), options.now ?? new Date());
    const item = [...(ledger?.pending ?? []), ...(ledger?.archive ?? [])]
      .find((candidate) => candidate.id === contentId);
    return item ? { ...item } : null;
  });
}

export function deleteDeviceContentNotificationLedger(
  ownerId: string,
  storage: DeviceContentCacheStorage = loadAsyncStorage(),
): Promise<void> {
  return serialize(ownerId, () => storage.removeItem(createDeviceContentNotificationLedgerKey(ownerId)));
}

export function createDeviceContentNotificationLedgerKey(ownerId: string): string {
  const normalized = ownerId.trim();
  if (!normalized || normalized !== ownerId || normalized.length > 512) {
    throw new Error("DEVICE_CONTENT_NOTIFICATION_OWNER_INVALID");
  }
  const encoded = Array.from(normalized, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("_");
  return `${LEDGER_PREFIX}_${encoded}`;
}

async function readUnlocked(
  ownerId: string,
  storage: DeviceContentCacheStorage,
  now: Date,
): Promise<DeviceContentNotificationLedger | null> {
  const key = createDeviceContentNotificationLedgerKey(ownerId);
  const raw = await storage.getItem(key);
  if (!raw) return null;
  if (raw.length > MAX_SERIALIZED_LENGTH) {
    await storage.removeItem(key);
    return null;
  }
  let parsed: DeviceContentNotificationLedger | null = null;
  try {
    parsed = parseLedger(JSON.parse(raw) as unknown, ownerId);
  } catch {
    parsed = null;
  }
  if (!parsed || Date.parse(parsed.updatedAt) + HARD_RETENTION_MS <= now.getTime()) {
    await storage.removeItem(key);
    return null;
  }
  const activeSources = new Set(Object.entries(parsed.sourceValidUntil)
    .filter(([, validUntil]) => Date.parse(validUntil) > now.getTime())
    .map(([sourceId]) => sourceId));
  return {
    ...parsed,
    sourceDefinitions: Object.fromEntries(Object.entries(parsed.sourceDefinitions)
      .filter(([sourceId]) => activeSources.has(sourceId))),
    sourceValidUntil: Object.fromEntries(Object.entries(parsed.sourceValidUntil)
      .filter(([sourceId]) => activeSources.has(sourceId))),
    seenTokensBySource: Object.fromEntries(Object.entries(parsed.seenTokensBySource)
      .filter(([sourceId]) => activeSources.has(sourceId))),
    pending: parsed.pending.filter((item) => activeSources.has(item.sourceId)),
    archive: parsed.archive.filter((item) => activeSources.has(item.sourceId)),
  };
}

async function writeUnlocked(
  ledger: DeviceContentNotificationLedger,
  storage: DeviceContentCacheStorage,
): Promise<void> {
  const parsed = parseLedger({ schemaVersion: LEDGER_SCHEMA_VERSION, ...ledger }, ledger.ownerId);
  if (!parsed) throw new Error("DEVICE_CONTENT_NOTIFICATION_LEDGER_INVALID");
  const serialized = JSON.stringify({ schemaVersion: LEDGER_SCHEMA_VERSION, ...parsed });
  if (serialized.length > MAX_SERIALIZED_LENGTH) throw new Error("DEVICE_CONTENT_NOTIFICATION_LEDGER_LIMIT_EXCEEDED");
  await storage.setItem(createDeviceContentNotificationLedgerKey(ledger.ownerId), serialized);
}

function parseLedger(value: unknown, ownerId: string): DeviceContentNotificationLedger | null {
  if (!isRecord(value) || value.schemaVersion !== LEDGER_SCHEMA_VERSION || value.ownerId !== ownerId) return null;
  if (!isRecord(value.sourceDefinitions) || !isRecord(value.sourceValidUntil) || !isRecord(value.seenTokensBySource)) return null;
  const sourceDefinitions: Record<string, string> = {};
  const sourceValidUntil: Record<string, string> = {};
  for (const [sourceId, definition] of Object.entries(value.sourceDefinitions)) {
    const validUntil = readIsoTimestamp(value.sourceValidUntil[sourceId]);
    if (!SOURCE_ID_PATTERN.test(sourceId) || typeof definition !== "string" || !DEFINITION_PATTERN.test(definition) || !validUntil) return null;
    sourceDefinitions[sourceId] = definition;
    sourceValidUntil[sourceId] = validUntil;
  }
  if (Object.keys(sourceDefinitions).length > MAX_SOURCES || Object.keys(value.sourceValidUntil).length !== Object.keys(sourceDefinitions).length) return null;
  const seenTokensBySource: Record<string, string[]> = {};
  for (const [sourceId, rawTokens] of Object.entries(value.seenTokensBySource)) {
    if (!(sourceId in sourceDefinitions) || !Array.isArray(rawTokens) || rawTokens.length > MAX_SEEN_TOKENS_PER_SOURCE) return null;
    if (rawTokens.some((token) => typeof token !== "string" || !TOKEN_PATTERN.test(token)) || new Set(rawTokens).size !== rawTokens.length) return null;
    seenTokensBySource[sourceId] = [...rawTokens] as string[];
  }
  const pending = readTrustedItems(value.pending, sourceDefinitions, MAX_PENDING_ITEMS);
  const archive = readTrustedItems(value.archive, sourceDefinitions, MAX_ARCHIVE_ITEMS);
  const updatedAt = readIsoTimestamp(value.updatedAt);
  if (!pending || !archive || !updatedAt) return null;
  if (new Set([...pending, ...archive].map((item) => item.id)).size !== pending.length + archive.length) return null;
  return { ownerId, sourceDefinitions, sourceValidUntil, seenTokensBySource, pending, archive, updatedAt };
}

function readTrustedItems(
  value: unknown,
  sourceDefinitions: Readonly<Record<string, string>>,
  maximum: number,
): TrustedMobileContentRecord[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const items: TrustedMobileContentRecord[] = [];
  for (const raw of value) {
    const normalized = normalizeTrustedContentCollection([raw as TrustedMobileContentRecord]);
    const item = normalized.omittedCount === 0 && normalized.items.length === 1 ? normalized.items[0] : undefined;
    if (
      !item
      || !isDeviceContentRecordId(item.id)
      || !(item.sourceId in sourceDefinitions)
      || !recordToken(item, item.sourceId)
    ) return null;
    items.push(item);
  }
  return new Set(items.map((item) => item.id)).size === items.length ? items : null;
}

function recordToken(item: TrustedMobileContentRecord, sourceId: string): string | null {
  const prefix = `device-${sourceId}-`;
  const token = item.id.startsWith(prefix) ? item.id.slice(prefix.length) : "";
  return TOKEN_PATTERN.test(token) ? token : null;
}

function compareRecency(left: TrustedMobileContentRecord, right: TrustedMobileContentRecord): number {
  const rightTime = recordTimestamp(right);
  const leftTime = recordTimestamp(left);
  return rightTime - leftTime || left.id.localeCompare(right.id, "en-US");
}

function recordTimestamp(record: TrustedMobileContentRecord): number {
  const value = record.publicationKind === "date" && record.publishedDate
    ? `${record.publishedDate}T12:00:00+03:00`
    : record.publishedAt ?? record.sourceUpdatedAt ?? record.fetchedAt;
  const parsed = value ? Date.parse(value) : Number.NEGATIVE_INFINITY;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function readIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : null;
}

function serialize<T>(ownerId: string, operation: () => Promise<T>): Promise<T> {
  const key = createDeviceContentNotificationLedgerKey(ownerId);
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(() => undefined, () => undefined);
  queues.set(key, tail);
  return current.finally(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
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
  if (typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
    throw new Error("AsyncStorage is unavailable.");
  }
  return storage;
}
