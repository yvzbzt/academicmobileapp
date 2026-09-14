import {
  createDeviceContentCacheKey,
  readDeviceContentCache,
  writeDeviceContentCache,
  type DeviceContentCacheStorage,
} from "../../src/content/device-content-cache";
import { syncDeviceContent } from "../../src/content/device-content-sync";
import type { DeviceContentSource } from "../../src/content/device-source-manifest";
import type { TrustedMobileContentRecord } from "../../src/content/content-trust";

const initialNow = new Date("2026-09-14T12:00:00.000Z");

function source(overrides: Partial<DeviceContentSource> = {}): DeviceContentSource {
  return {
    id: "source-1",
    sourceName: "Example University announcements",
    sourceUrl: "https://example.edu.tr/announcements",
    allowedHostname: "example.edu.tr",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    parser: "html",
    parserConfig: { itemSelector: "article", linkSelector: "a", titleSelector: "h2" },
    definitionVersion: "definition-1",
    contentRevision: "a".repeat(64),
    checkedAt: "2026-09-14T11:00:00.000Z",
    validUntil: "2026-09-16T00:00:00.000Z",
    ...overrides,
  };
}

function manifest(recipe = source(), overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    version: "b".repeat(64),
    refreshRequired: true,
    generatedAt: "2026-09-14T12:00:00.000Z",
    revalidateAfter: "2026-09-14T12:30:00.000Z",
    sources: [recipe],
    ...overrides,
  };
}

function createMemoryStorage(): DeviceContentCacheStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
}

function response(title: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url: "https://example.edu.tr/announcements",
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null },
    text: async () => `<article><h2>${title}</h2><a href="/announcements/item">Open</a></article>`,
  } as unknown as Response;
}

describe("device content cache", () => {
  it("isolates owners and deletes corrupt or expired values", async () => {
    const storage = createMemoryStorage();
    const record = trustedRecord();
    await writeDeviceContentCache({
      ownerId: "owner-1",
      manifestVersion: "b".repeat(64),
      revalidateAfter: "2026-09-14T12:30:00.000Z",
      sourceRevisions: { "source-1": `definition-1:${"a".repeat(64)}` },
      items: [record],
      storedAt: initialNow.toISOString(),
    }, storage);

    await expect(readDeviceContentCache("owner-1", { storage, now: initialNow })).resolves.toEqual(expect.objectContaining({
      ownerId: "owner-1",
      items: [expect.objectContaining({ id: record.id })],
    }));
    await expect(readDeviceContentCache("owner-2", { storage, now: initialNow })).resolves.toBeNull();

    storage.values.set(createDeviceContentCacheKey("owner-1"), "not-json");
    await expect(readDeviceContentCache("owner-1", { storage, now: initialNow })).resolves.toBeNull();
    expect(storage.values.has(createDeviceContentCacheKey("owner-1"))).toBe(false);
  });
});

describe("device content sync", () => {
  it("fetches changed sources, then serves the owner cache until revalidation is due", async () => {
    const storage = createMemoryStorage();
    const loadManifest = jest.fn(async () => manifest());
    const fetchImpl = jest.fn(async () => response("Enrollment dates announced"));

    const first = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest,
      storage,
      now: initialNow,
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
    });
    const cached = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest,
      storage,
      now: new Date("2026-09-14T12:10:00.000Z"),
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
    });

    expect(first.collection.items).toEqual([expect.objectContaining({ title: "Enrollment dates announced" })]);
    expect(first.cacheHit).toBe(false);
    expect(cached.cacheHit).toBe(true);
    expect(loadManifest).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends the known version and avoids source fetch when recipes are unchanged", async () => {
    const storage = createMemoryStorage();
    const fetchImpl = jest.fn(async () => response("Initial item"));
    await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(),
      storage,
      now: initialNow,
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
    });
    const loadManifest = jest.fn(async (knownVersion?: string) => manifest(source(), {
      refreshRequired: false,
      generatedAt: "2026-09-14T13:00:00.000Z",
      revalidateAfter: "2026-09-14T13:30:00.000Z",
    }));

    const result = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest,
      storage,
      now: new Date("2026-09-14T13:00:00.000Z"),
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
    });

    expect(loadManifest).toHaveBeenCalledWith("b".repeat(64));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.cacheHit).toBe(true);
    expect(result.collection.items[0]?.title).toBe("Initial item");
  });

  it("retains stale last-known-good content after a content-only change fails", async () => {
    const storage = createMemoryStorage();
    await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(),
      storage,
      now: initialNow,
      fetchOptions: { fetchImpl: jest.fn(async () => response("Initial item")) as unknown as typeof fetch },
    });
    const changed = source({ contentRevision: "c".repeat(64) });

    const result = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(changed, {
        version: "d".repeat(64),
        generatedAt: "2026-09-14T13:00:00.000Z",
        revalidateAfter: "2026-09-14T13:30:00.000Z",
      }),
      storage,
      now: new Date("2026-09-14T13:00:00.000Z"),
      fetchOptions: { fetchImpl: jest.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch },
    });

    expect(result.failedSourceIds).toEqual(["source-1"]);
    expect(result.collection.state).toBe("partial");
    expect(result.collection.items).toEqual([expect.objectContaining({ title: "Initial item", freshness: "stale" })]);
  });

  it("never carries old content across a source definition change", async () => {
    const storage = createMemoryStorage();
    await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(),
      storage,
      now: initialNow,
      fetchOptions: { fetchImpl: jest.fn(async () => response("Old item")) as unknown as typeof fetch },
    });
    const changed = source({ definitionVersion: "definition-2", contentRevision: "c".repeat(64) });

    const result = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(changed, {
        version: "d".repeat(64),
        generatedAt: "2026-09-14T13:00:00.000Z",
        revalidateAfter: "2026-09-14T13:30:00.000Z",
      }),
      storage,
      now: new Date("2026-09-14T13:00:00.000Z"),
      fetchOptions: { fetchImpl: jest.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch },
    });

    expect(result.failedSourceIds).toEqual(["source-1"]);
    expect(result.collection.items).toEqual([]);
  });
});

function trustedRecord(): TrustedMobileContentRecord {
  return {
    id: "device-source-1-item",
    sourceId: "source-1",
    sourceName: "Example University announcements",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    title: "Cached item",
    link: "https://example.edu.tr/announcements/item",
    canonicalUrl: "https://example.edu.tr/announcements/item",
    canonicalUrlAliases: [],
    officialSourceUrl: "https://example.edu.tr/announcements",
    sourceRelationships: [{
      sourceId: "source-1",
      sourceName: "Example University announcements",
      officialSourceUrl: "https://example.edu.tr/announcements",
      scopeType: "university",
      scopeId: "university-1",
      canonicalUrl: "https://example.edu.tr/announcements/item",
    }],
    freshness: "fresh",
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
  };
}
