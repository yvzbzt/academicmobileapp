import {
  readDeviceContentCache,
  writeDeviceContentCache,
  type DeviceContentCacheRecord,
  type DeviceContentCacheStorage,
} from "./device-content-cache";
import { fetchDeviceContentSource, type DeviceSourceFetchOptions } from "./device-source-client";
import {
  readDeviceContentSourceManifest,
  type DeviceContentSource,
  type DeviceContentSourceManifest,
} from "./device-source-manifest";
import {
  readPendingDeviceContentNotifications,
  recordDeviceContentDiscovery,
} from "./device-content-notification-ledger";
import {
  normalizeTrustedContentCollection,
  type TrustedContentCollection,
  type TrustedMobileContentRecord,
} from "./content-trust";

export interface DeviceContentSyncResult {
  collection: TrustedContentCollection;
  manifest: DeviceContentSourceManifest | null;
  cacheHit: boolean;
  failedSourceIds: string[];
  newItems: TrustedMobileContentRecord[];
}

export interface DeviceContentSyncOptions {
  ownerId: string;
  loadManifest(knownVersion?: string): Promise<unknown>;
  storage?: DeviceContentCacheStorage;
  now?: Date;
  force?: boolean;
  fetchOptions?: Omit<DeviceSourceFetchOptions, "now">;
  concurrency?: number;
  isCurrent?: () => boolean;
}

export async function syncDeviceContent(options: DeviceContentSyncOptions): Promise<DeviceContentSyncResult> {
  const now = options.now ?? new Date();
  const cached = await readDeviceContentCache(options.ownerId, { storage: options.storage, now });
  assertCurrent(options);
  if (!options.force && cached && !cached.snapshotIncomplete && Date.parse(cached.revalidateAfter) > now.getTime()) {
    const pending = await readPendingDeviceContentNotifications(options.ownerId, { storage: options.storage, now });
    assertCurrent(options);
    return {
      collection: collectionFromCache(cached, false),
      manifest: null,
      cacheHit: true,
      failedSourceIds: cached.failedSourceIds,
      newItems: pending.sort(compareDeviceContentRecency),
    };
  }

  let manifest: DeviceContentSourceManifest;
  try {
    const payload = await options.loadManifest(cached?.manifestVersion);
    assertCurrent(options);
    const parsed = readDeviceContentSourceManifest(payload);
    if (!parsed) throw new Error("DEVICE_CONTENT_MANIFEST_INVALID");
    manifest = parsed;
  } catch (error) {
    if (!cached || options.force) throw error;
    const pending = await readPendingDeviceContentNotifications(options.ownerId, { storage: options.storage, now });
    assertCurrent(options);
    return {
      collection: collectionFromCache(cached, true),
      manifest: null,
      cacheHit: true,
      failedSourceIds: cached.failedSourceIds,
      newItems: pending.sort(compareDeviceContentRecency),
    };
  }

  const currentIds = new Set(manifest.sources.map((source) => source.id));
  const sourceById = new Map(manifest.sources.map((source) => [source.id, source]));
  const currentRecipes = new Map(manifest.sources.map((source) => [source.id, recipeRevision(source)]));
  const previousFailedIds = new Set(cached?.failedSourceIds ?? []);
  const unchangedIds = new Set(manifest.sources
    .filter((source) => !cached?.snapshotIncomplete
      && !previousFailedIds.has(source.id)
      && cached?.sourceRevisions[source.id] === currentRecipes.get(source.id))
    .map((source) => source.id));
  const fetchBlockedIds = new Set(manifest.sources.filter((source) => !source.fetchAllowed).map((source) => source.id));
  const retained = (cached?.items ?? [])
    .filter((item) => currentIds.has(item.sourceId) && unchangedIds.has(item.sourceId))
    .map((item) => ({
      ...item,
      freshness: fetchBlockedIds.has(item.sourceId) ? "stale" as const : "fresh" as const,
    }));
  const changedSources = manifest.sources.filter((source) => source.fetchAllowed && !unchangedIds.has(source.id));
  const fetched = new Map<string, TrustedMobileContentRecord[]>();
  const failedSourceIds: string[] = [...fetchBlockedIds];

  await forEachConcurrent(changedSources, options.concurrency ?? 4, async (source) => {
    if (options.isCurrent && !options.isCurrent()) return;
    try {
      const collection = await fetchDeviceContentSource(source, { ...options.fetchOptions, now });
      fetched.set(source.id, collection.items);
    } catch {
      failedSourceIds.push(source.id);
    }
  });
  assertCurrent(options);

  const failedFallback = (cached?.items ?? [])
    .filter((item) => {
      const current = sourceById.get(item.sourceId);
      const previousRevision = cached?.sourceRevisions[item.sourceId];
      return Boolean(
        current
        && failedSourceIds.includes(item.sourceId)
        && !unchangedIds.has(item.sourceId)
        && previousRevision?.startsWith(`${current.definitionVersion}:`)
      );
    })
    .map((item) => ({ ...item, freshness: "stale" as const }));
  const merged = normalizeTrustedContentCollection([
    ...retained,
    ...[...fetched.values()].flat(),
    ...failedFallback,
  ]);
  merged.items.sort(compareDeviceContentRecency);
  const sourceRevisions: Record<string, string> = {};
  const sourceValidUntil = Object.fromEntries(manifest.sources.map((source) => [source.id, source.validUntil]));
  for (const source of manifest.sources) {
    const revision = currentRecipes.get(source.id)!;
    if (unchangedIds.has(source.id) || fetched.has(source.id)) {
      sourceRevisions[source.id] = revision;
    } else if (cached?.sourceRevisions[source.id]) {
      sourceRevisions[source.id] = cached.sourceRevisions[source.id]!;
    }
  }
  const revalidateAfter = failedSourceIds.length > 0
    ? earlierIso(manifest.revalidateAfter, new Date(now.getTime() + 5 * 60 * 1_000).toISOString())
    : manifest.revalidateAfter;
  const cacheRecord: DeviceContentCacheRecord = {
    ownerId: options.ownerId,
    manifestVersion: manifest.version,
    revalidateAfter,
    // Only legacy snapshots were globally truncated. After one migration pass,
    // retry failed sources individually instead of refetching every healthy one.
    snapshotIncomplete: false,
    sourceRevisions,
    sourceValidUntil,
    failedSourceIds: [...failedSourceIds].sort(),
    items: merged.items,
    storedAt: now.toISOString(),
  };
  const pending = await recordDeviceContentDiscovery({
    ownerId: options.ownerId,
    sources: manifest.sources,
    fetchedBySource: fetched,
    storage: options.storage,
    now,
  });
  assertCurrent(options);
  await writeDeviceContentCache(cacheRecord, options.storage);
  assertCurrent(options);
  return {
    collection: {
      ...merged,
      hasMore: false,
      state: failedSourceIds.length > 0 ? "partial" : merged.state,
    },
    manifest,
    cacheHit: changedSources.length === 0,
    failedSourceIds: failedSourceIds.sort(),
    newItems: pending.sort(compareDeviceContentRecency),
  };
}

function assertCurrent(options: DeviceContentSyncOptions): void {
  if (options.isCurrent && !options.isCurrent()) throw new Error("DEVICE_CONTENT_SYNC_STALE");
}

function collectionFromCache(cache: DeviceContentCacheRecord, stale: boolean): TrustedContentCollection {
  const collection = normalizeTrustedContentCollection(stale
    ? cache.items.map((item) => ({ ...item, freshness: "stale" as const }))
    : cache.items);
  collection.items.sort(compareDeviceContentRecency);
  return {
    ...collection,
    hasMore: cache.snapshotIncomplete,
    state: cache.failedSourceIds.length > 0
      ? "partial"
      : stale && collection.items.length > 0
        ? "stale"
        : collection.state,
  };
}

function earlierIso(left: string, right: string): string {
  return left < right ? left : right;
}

function compareDeviceContentRecency(
  left: TrustedMobileContentRecord,
  right: TrustedMobileContentRecord,
): number {
  const leftPublished = publicationTimestamp(left);
  const rightPublished = publicationTimestamp(right);
  if (leftPublished !== rightPublished) return rightPublished - leftPublished;
  const leftUpdated = timestamp(left.sourceUpdatedAt);
  const rightUpdated = timestamp(right.sourceUpdatedAt);
  if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
  return left.id.localeCompare(right.id, "en-US");
}

function publicationTimestamp(record: TrustedMobileContentRecord): number {
  if (record.publicationKind === "date" && record.publishedDate) {
    return timestamp(`${record.publishedDate}T12:00:00+03:00`);
  }
  return timestamp(record.publishedAt);
}

function timestamp(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function recipeRevision(source: DeviceContentSource): string {
  return `${source.definitionVersion}:${source.contentRevision}`;
}

async function forEachConcurrent<T>(
  values: readonly T[],
  requestedConcurrency: number,
  action: (value: T) => Promise<void>,
): Promise<void> {
  const concurrency = Math.min(Math.max(Math.floor(requestedConcurrency), 1), 6);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const value = values[nextIndex];
      nextIndex += 1;
      if (value !== undefined) await action(value);
    }
  }));
}
