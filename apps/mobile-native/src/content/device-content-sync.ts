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
  normalizeTrustedContentCollection,
  type TrustedContentCollection,
  type TrustedMobileContentRecord,
} from "./content-trust";

export interface DeviceContentSyncResult {
  collection: TrustedContentCollection;
  manifest: DeviceContentSourceManifest | null;
  cacheHit: boolean;
  failedSourceIds: string[];
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
  if (!options.force && cached && Date.parse(cached.revalidateAfter) > now.getTime()) {
    return { collection: collectionFromCache(cached, false), manifest: null, cacheHit: true, failedSourceIds: [] };
  }

  let manifest: DeviceContentSourceManifest;
  try {
    const payload = await options.loadManifest(cached?.manifestVersion);
    assertCurrent(options);
    const parsed = readDeviceContentSourceManifest(payload);
    if (!parsed) throw new Error("DEVICE_CONTENT_MANIFEST_INVALID");
    manifest = parsed;
  } catch (error) {
    if (!cached) throw error;
    return { collection: collectionFromCache(cached, true), manifest: null, cacheHit: true, failedSourceIds: [] };
  }

  const currentIds = new Set(manifest.sources.map((source) => source.id));
  const sourceById = new Map(manifest.sources.map((source) => [source.id, source]));
  const currentRecipes = new Map(manifest.sources.map((source) => [source.id, recipeRevision(source)]));
  const unchangedIds = new Set(manifest.sources
    .filter((source) => cached?.sourceRevisions[source.id] === currentRecipes.get(source.id))
    .map((source) => source.id));
  const retained = (cached?.items ?? []).filter((item) => currentIds.has(item.sourceId) && unchangedIds.has(item.sourceId));
  const changedSources = manifest.sources.filter((source) => !unchangedIds.has(source.id));
  const fetched = new Map<string, TrustedMobileContentRecord[]>();
  const failedSourceIds: string[] = [];

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
        && previousRevision?.startsWith(`${current.definitionVersion}:`)
      );
    })
    .map((item) => ({ ...item, freshness: "stale" as const }));
  const merged = normalizeTrustedContentCollection([
    ...retained,
    ...[...fetched.values()].flat(),
    ...failedFallback,
  ]);
  const sourceRevisions: Record<string, string> = {};
  for (const source of manifest.sources) {
    const revision = currentRecipes.get(source.id)!;
    if (unchangedIds.has(source.id) || fetched.has(source.id)) sourceRevisions[source.id] = revision;
    else if (cached?.sourceRevisions[source.id]) sourceRevisions[source.id] = cached.sourceRevisions[source.id]!;
  }
  const cacheRecord: DeviceContentCacheRecord = {
    ownerId: options.ownerId,
    manifestVersion: manifest.version,
    revalidateAfter: manifest.revalidateAfter,
    sourceRevisions,
    items: merged.items,
    storedAt: now.toISOString(),
  };
  await writeDeviceContentCache(cacheRecord, options.storage);
  assertCurrent(options);
  return {
    collection: {
      ...merged,
      state: failedSourceIds.length > 0 ? "partial" : merged.state,
    },
    manifest,
    cacheHit: changedSources.length === 0,
    failedSourceIds: failedSourceIds.sort(),
  };
}

function assertCurrent(options: DeviceContentSyncOptions): void {
  if (options.isCurrent && !options.isCurrent()) throw new Error("DEVICE_CONTENT_SYNC_STALE");
}

function collectionFromCache(cache: DeviceContentCacheRecord, stale: boolean): TrustedContentCollection {
  const collection = normalizeTrustedContentCollection(stale
    ? cache.items.map((item) => ({ ...item, freshness: "stale" as const }))
    : cache.items);
  return { ...collection, state: stale && collection.items.length > 0 ? "stale" : collection.state };
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
