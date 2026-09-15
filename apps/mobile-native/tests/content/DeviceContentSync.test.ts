import {
  createDeviceContentCacheKey,
  readDeviceContentCache,
  writeDeviceContentCache,
  type DeviceContentCacheStorage,
} from "../../src/content/device-content-cache";
import { syncDeviceContent } from "../../src/content/device-content-sync";
import type { DeviceContentSource } from "../../src/content/device-source-manifest";
import type { TrustedMobileContentRecord } from "../../src/content/content-trust";
import { buildContentFeed, filterContentFeed } from "../../src/announcements/feed-model";

const initialNow = new Date("2026-09-14T12:00:00.000Z");

function source(overrides: Partial<DeviceContentSource> = {}): DeviceContentSource {
  return {
    id: "source-1",
    sourceName: "Example University announcements",
    sourceUrl: "https://example.edu.tr/announcements",
    allowedHostname: "example.edu.tr",
    allowedOfficialDomain: "example.edu.tr",
    fetchAllowed: true,
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
    schemaVersion: 2,
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
  const body = `<article><h2>${title}</h2><a href="/announcements/item">Open</a></article>`;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url: "https://example.edu.tr/announcements",
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : name.toLowerCase() === "content-length" ? String(new TextEncoder().encode(body).byteLength) : null },
    text: async () => body,
  } as unknown as Response;
}

function datedResponse(url: string, title: string, date: string, itemPath: string): Response {
  const body = `<article><h2>${title}</h2><a href="${itemPath}">Open</a><time datetime="${date}">${date}</time></article>`;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url,
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : name.toLowerCase() === "content-length" ? String(new TextEncoder().encode(body).byteLength) : null },
    text: async () => body,
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
      snapshotIncomplete: false,
      sourceRevisions: { "source-1": `definition-1:${"a".repeat(64)}` },
      sourceValidUntil: { "source-1": "2026-09-16T00:00:00.000Z" },
      failedSourceIds: [],
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
    expect(first.collection.hasMore).toBe(false);
    expect(first.newItems).toEqual([]);
    expect(first.cacheHit).toBe(false);
    expect(cached.cacheHit).toBe(true);
    expect(cached.collection.hasMore).toBe(false);
    expect(cached.newItems).toEqual([]);
    expect(loadManifest).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports only genuinely new records after an existing source revision changes", async () => {
    const storage = createMemoryStorage();
    await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(),
      storage,
      now: initialNow,
      fetchOptions: {
        fetchImpl: jest.fn(async () => listedResponse([
          ["Initial item", "/announcements/initial"],
        ])) as unknown as typeof fetch,
      },
    });

    const result = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(source({ contentRevision: "c".repeat(64) }), {
        version: "d".repeat(64),
        generatedAt: "2026-09-14T13:00:00.000Z",
        revalidateAfter: "2026-09-14T13:30:00.000Z",
      }),
      storage,
      now: new Date("2026-09-14T13:00:00.000Z"),
      fetchOptions: {
        fetchImpl: jest.fn(async () => listedResponse([
          ["New item", "/announcements/new"],
          ["Initial item", "/announcements/initial"],
        ])) as unknown as typeof fetch,
      },
    });

    expect(result.newItems).toEqual([expect.objectContaining({ title: "New item" })]);
  });

  it("uses a newly followed source as a silent baseline instead of backfilling notifications", async () => {
    const storage = createMemoryStorage();
    await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(),
      storage,
      now: initialNow,
      fetchOptions: { fetchImpl: jest.fn(async () => response("Initial item")) as unknown as typeof fetch },
    });
    const newlyFollowed = source({
      id: "source-2",
      sourceUrl: "https://example.edu.tr/news",
      contentType: "news",
      scopeId: "university-2",
    });

    const result = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(source(), {
        version: "d".repeat(64),
        generatedAt: "2026-09-14T13:00:00.000Z",
        revalidateAfter: "2026-09-14T13:30:00.000Z",
        sources: [source(), newlyFollowed],
      }),
      storage,
      now: new Date("2026-09-14T13:00:00.000Z"),
      fetchOptions: { fetchImpl: jest.fn(async () => listedResponse([["Followed source history", "/news/history"]], "https://example.edu.tr/news")) as unknown as typeof fetch },
    });

    expect(result.collection.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Initial item" }),
      expect.objectContaining({ title: "Followed source history" }),
    ]));
    expect(result.newItems).toEqual([]);
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

  it("keeps a leased cache stale while fetching is blocked, then refetches only after approval recovers", async () => {
    const storage = createMemoryStorage();
    const fetchImpl = jest.fn(async () => response("Known good item"));
    await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(),
      storage,
      now: initialNow,
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
    });
    const blocked = source({ fetchAllowed: false });
    const blockedResult = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(blocked, {
        version: "c".repeat(64),
        generatedAt: "2026-09-14T13:00:00.000Z",
        revalidateAfter: "2026-09-14T13:30:00.000Z",
      }),
      storage,
      now: new Date("2026-09-14T13:00:00.000Z"),
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(blockedResult.failedSourceIds).toEqual(["source-1"]);
    expect(blockedResult.collection).toMatchObject({
      state: "partial",
      duplicateCount: 0,
      items: [expect.objectContaining({ title: "Known good item", freshness: "stale" })],
    });

    const recoveredResult = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(source(), {
        version: "d".repeat(64),
        generatedAt: "2026-09-14T13:06:00.000Z",
        revalidateAfter: "2026-09-14T13:36:00.000Z",
      }),
      storage,
      now: new Date("2026-09-14T13:06:00.000Z"),
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(recoveredResult.failedSourceIds).toEqual([]);
    expect(recoveredResult.collection.items).toEqual([
      expect.objectContaining({ title: "Known good item", freshness: "fresh" }),
    ]);
  });

  it("does not deliver queued discoveries after the backend blocks that source", async () => {
    const storage = createMemoryStorage();
    await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(),
      storage,
      now: initialNow,
      fetchOptions: { fetchImpl: jest.fn(async () => listedResponse([["Initial", "/announcements/initial"]])) as unknown as typeof fetch },
    });
    const revised = source({ contentRevision: "c".repeat(64) });
    const discovered = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(revised, {
        version: "d".repeat(64),
        generatedAt: "2026-09-14T13:00:00.000Z",
        revalidateAfter: "2026-09-14T13:30:00.000Z",
      }),
      storage,
      now: new Date("2026-09-14T13:00:00.000Z"),
      fetchOptions: { fetchImpl: jest.fn(async () => listedResponse([
        ["Discovered", "/announcements/discovered"],
        ["Initial", "/announcements/initial"],
      ])) as unknown as typeof fetch },
    });
    expect(discovered.newItems).toEqual([expect.objectContaining({ title: "Discovered" })]);

    const blocked = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest({ ...revised, fetchAllowed: false }, {
        version: "e".repeat(64),
        generatedAt: "2026-09-14T13:31:00.000Z",
        revalidateAfter: "2026-09-14T14:01:00.000Z",
      }),
      storage,
      now: new Date("2026-09-14T13:31:00.000Z"),
    });

    expect(blocked.newItems).toEqual([]);
    expect(blocked.failedSourceIds).toEqual(["source-1"]);
  });

  it("drops cached content immediately when an authority-revoked source disappears", async () => {
    const storage = createMemoryStorage();
    await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(),
      storage,
      now: initialNow,
      fetchOptions: { fetchImpl: jest.fn(async () => response("Revoked item")) as unknown as typeof fetch },
    });

    const result = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(source(), {
        version: "e".repeat(64),
        sources: [],
        generatedAt: "2026-09-14T13:00:00.000Z",
        revalidateAfter: "2026-09-14T13:30:00.000Z",
      }),
      storage,
      now: new Date("2026-09-14T13:00:00.000Z"),
    });

    expect(result.collection.items).toEqual([]);
    expect(result.failedSourceIds).toEqual([]);
  });

  it("preserves a partial failure envelope on an immediate cache hit and retries it early", async () => {
    const storage = createMemoryStorage();
    const first = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(),
      storage,
      now: initialNow,
      fetchOptions: { fetchImpl: jest.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch },
    });
    const cached = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: jest.fn(async () => manifest()),
      storage,
      now: new Date("2026-09-14T12:01:00.000Z"),
    });

    expect(first.collection.state).toBe("partial");
    expect(cached.collection.state).toBe("partial");
    expect(cached.failedSourceIds).toEqual(["source-1"]);
    expect(cached.cacheHit).toBe(true);
    const stored = await readDeviceContentCache("owner-1", { storage, now: initialNow });
    expect(stored?.revalidateAfter).toBe("2026-09-14T12:05:00.000Z");
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

  it("drops cached items after their server trust lease expires while the manifest is unavailable", async () => {
    const storage = createMemoryStorage();
    await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(source({ validUntil: "2026-09-14T12:05:00.000Z" }), {
        revalidateAfter: "2026-09-14T12:30:00.000Z",
      }),
      storage,
      now: initialNow,
      fetchOptions: { fetchImpl: jest.fn(async () => response("Lease-bound item")) as unknown as typeof fetch },
    });

    const result = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => { throw new Error("offline"); },
      storage,
      now: new Date("2026-09-14T12:06:00.000Z"),
    });

    expect(result.collection.items).toEqual([]);
    expect(result.collection.state).toBe("fresh");
  });

  it.each([
    [25, 0],
    [0, 25],
  ])("sorts the complete multi-source collection before pagination regardless of completion order", async (newDelay, oldDelay) => {
    const storage = createMemoryStorage();
    const oldSource = source({
      id: "source-old",
      sourceUrl: "https://example.edu.tr/old",
      parserConfig: { itemSelector: "article", linkSelector: "a", titleSelector: "h2", dateSelector: "time" },
    });
    const newSource = source({
      id: "source-new",
      sourceUrl: "https://example.edu.tr/new",
      parserConfig: { itemSelector: "article", linkSelector: "a", titleSelector: "h2", dateSelector: "time" },
    });
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isNew = url.endsWith("/new");
      await new Promise((resolve) => setTimeout(resolve, isNew ? newDelay : oldDelay));
      return isNew
        ? datedResponse(url, "Newest item", "2026-09-14", "/new/item")
        : datedResponse(url, "Older item", "2026-09-01", "/old/item");
    });

    const result = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(oldSource, { sources: [oldSource, newSource] }),
      storage,
      now: initialNow,
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
      concurrency: 2,
    });

    expect(result.collection.items.map((item) => item.title)).toEqual(["Newest item", "Older item"]);
  });

  it("places a newly fetched record ahead of an older retained source record", async () => {
    const storage = createMemoryStorage();
    const retainedSource = source({
      id: "source-retained",
      sourceUrl: "https://example.edu.tr/retained",
      parserConfig: { itemSelector: "article", linkSelector: "a", titleSelector: "h2", dateSelector: "time" },
    });
    const changedSource = source({
      id: "source-changed",
      sourceUrl: "https://example.edu.tr/changed",
      parserConfig: { itemSelector: "article", linkSelector: "a", titleSelector: "h2", dateSelector: "time" },
    });
    await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(retainedSource, { sources: [retainedSource, changedSource] }),
      storage,
      now: initialNow,
      fetchOptions: {
        fetchImpl: (async (input: RequestInfo | URL) => {
          const url = String(input);
          return datedResponse(url, url.endsWith("/retained") ? "Retained item" : "Changed old item", "2026-09-01", url.endsWith("/retained") ? "/retained/item" : "/changed/item");
        }) as typeof fetch,
      },
    });

    const changedRecipe = { ...changedSource, contentRevision: "c".repeat(64) };
    const result = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(retainedSource, {
        version: "d".repeat(64),
        generatedAt: "2026-09-14T13:00:00.000Z",
        revalidateAfter: "2026-09-14T13:30:00.000Z",
        sources: [retainedSource, changedRecipe],
      }),
      storage,
      now: new Date("2026-09-14T13:00:00.000Z"),
      fetchOptions: {
        fetchImpl: (async (input: RequestInfo | URL) => datedResponse(String(input), "Changed newest item", "2026-09-14", "/changed/item")) as typeof fetch,
      },
    });

    expect(result.collection.items.map((item) => item.title)).toEqual(["Changed newest item", "Retained item"]);
  });

  it.each(["blocked", "network_failure"])("retries only the unavailable source after truncated-cache migration (%s)", async (failure) => {
    const storage = createMemoryStorage();
    const recipes = ["a", "b", "c"].map((id) => source({ id: `source-${id}`, sourceUrl: `https://example.edu.tr/${id}` }));
    const failedSource = recipes[2]!;
    let failing = false;
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (failing && url === failedSource.sourceUrl) throw new Error("network unavailable");
      const prefix = url.slice(-1);
      return listedResponse(Array.from({ length: 60 }, (_, index) => [
        `Source ${prefix} announcement ${index}`, `/${prefix}/item-${index}`,
      ] as const), url);
    });
    await syncDeviceContent({
      ownerId: "owner-1", storage, now: initialNow,
      loadManifest: async () => manifest(recipes[0], { sources: recipes }),
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
    });
    const original = await readDeviceContentCache("owner-1", { storage, now: initialNow });
    storage.values.set(createDeviceContentCacheKey("owner-1"), JSON.stringify({
      schemaVersion: 5, ...original, items: original!.items.slice(0, 100), snapshotIncomplete: true,
    }));
    failing = true;
    const unavailableRecipes = recipes.map((recipe) => recipe.id === failedSource.id && failure === "blocked"
      ? { ...recipe, fetchAllowed: false }
      : recipe);
    fetchImpl.mockClear();
    const migrated = await syncDeviceContent({
      ownerId: "owner-1", storage, now: new Date("2026-09-14T12:10:00.000Z"),
      loadManifest: async () => manifest(recipes[0], { sources: unavailableRecipes }),
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(failure === "blocked" ? 2 : 3);
    expect(migrated.failedSourceIds).toEqual([failedSource.id]);
    expect(migrated.collection.state).toBe("partial");
    expect((await readDeviceContentCache("owner-1", { storage, now: initialNow }))?.snapshotIncomplete).toBe(false);

    fetchImpl.mockClear();
    const retried = await syncDeviceContent({
      ownerId: "owner-1", storage, now: new Date("2026-09-14T12:20:00.000Z"),
      loadManifest: async () => manifest(recipes[0], { sources: unavailableRecipes }),
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(failure === "blocked" ? 0 : 1);
    expect(retried.collection.items.filter((item) => item.sourceId !== failedSource.id)).toHaveLength(120);

    failing = false;
    fetchImpl.mockClear();
    const recovered = await syncDeviceContent({
      ownerId: "owner-1", storage, now: new Date("2026-09-14T12:40:00.000Z"),
      loadManifest: async () => manifest(recipes[0], { sources: recipes }),
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(failedSource.sourceUrl, expect.anything());
    expect(recovered.collection.items).toHaveLength(180);
    expect(recovered.failedSourceIds).toEqual([]);
    expect(recovered.newItems).toEqual([]);
  });

  it("retains every bounded source snapshot and repairs an old globally truncated cache", async () => {
    const storage = createMemoryStorage();
    const firstSource = source({ id: "source-a", sourceUrl: "https://example.edu.tr/a" });
    const secondSource = source({ id: "source-b", sourceUrl: "https://example.edu.tr/b" });
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const prefix = url.endsWith("/a") ? "a" : "b";
      return listedResponse(Array.from({ length: 60 }, (_, index) => [
        `Source ${prefix.toUpperCase()} item ${index}`,
        `/${prefix}/item-${index}`,
      ] as const), url);
    });

    const result = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(firstSource, { sources: [firstSource, secondSource] }),
      storage,
      now: initialNow,
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
    });
    const cached = await readDeviceContentCache("owner-1", { storage, now: initialNow });

    expect(result.collection.items).toHaveLength(120);
    expect(cached?.items).toHaveLength(120);
    expect(cached?.snapshotIncomplete).toBe(false);

    const loadCachedManifest = jest.fn(async () => manifest(firstSource, { sources: [firstSource, secondSource] }));
    const cacheHit = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: loadCachedManifest,
      storage,
      now: new Date("2026-09-14T12:10:00.000Z"),
    });
    expect(cacheHit.collection.items).toHaveLength(120);
    expect(cacheHit.collection.hasMore).toBe(false);
    expect(loadCachedManifest).not.toHaveBeenCalled();
    expect(filterContentFeed(buildContentFeed({ academic: cacheHit.collection.items, yok: [], summerSchool: [] }), {
      contentType: "all", source: "all", query: "Source B item 59",
    })).toHaveLength(1);

    // An incomplete snapshot acknowledges every source revision but contains
    // only the first 100. Repair it even before its revalidation time.
    storage.values.set(createDeviceContentCacheKey("owner-1"), JSON.stringify({
      schemaVersion: 5,
      ...cached,
      items: cached!.items.slice(0, 100),
      snapshotIncomplete: true,
    }));
    const repaired = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: loadCachedManifest,
      storage,
      now: new Date("2026-09-14T12:10:00.000Z"),
      fetchOptions: { fetchImpl: fetchImpl as typeof fetch },
    });
    expect(repaired.collection.items).toHaveLength(120);
    expect(repaired.collection.hasMore).toBe(false);
    expect(repaired.newItems).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    const changedSource = secondSource;
    const unchangedSource = firstSource;
    const changedPrefix = "b";
    const revisedSource = { ...changedSource, contentRevision: "c".repeat(64) };

    const revised = await syncDeviceContent({
      ownerId: "owner-1",
      loadManifest: async () => manifest(revisedSource, {
        version: "d".repeat(64),
        generatedAt: "2026-09-14T13:00:00.000Z",
        revalidateAfter: "2026-09-14T13:30:00.000Z",
        sources: changedSource.id === firstSource.id
          ? [revisedSource, unchangedSource]
          : [unchangedSource, revisedSource],
      }),
      storage,
      now: new Date("2026-09-14T13:00:00.000Z"),
      fetchOptions: {
        fetchImpl: jest.fn(async (input: RequestInfo | URL) => listedResponse([
          [`Source ${changedPrefix.toUpperCase()} genuinely new`, `/${changedPrefix}/genuinely-new`],
          ...Array.from({ length: 60 }, (_, index) => [
            `Source ${changedPrefix.toUpperCase()} item ${index}`,
            `/${changedPrefix}/item-${index}`,
          ] as const),
        ], String(input))) as unknown as typeof fetch,
      },
    });

    expect(revised.collection.items).toHaveLength(120);
    expect(revised.collection.items.filter((item) => item.sourceId === firstSource.id)).toHaveLength(60);
    expect(revised.collection.hasMore).toBe(false);
    expect(revised.newItems).toEqual([
      expect.objectContaining({ title: `Source ${changedPrefix.toUpperCase()} genuinely new` }),
    ]);
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

function listedResponse(
  items: ReadonlyArray<readonly [title: string, path: string]>,
  url = "https://example.edu.tr/announcements",
): Response {
  const body = items.map(([title, path]) => `<article><h2>${title}</h2><a href="${path}">Open</a></article>`).join("");
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url,
    headers: {
      get: (name: string) => name.toLowerCase() === "content-type"
        ? "text/html"
        : name.toLowerCase() === "content-length"
          ? String(new TextEncoder().encode(body).byteLength)
          : null,
    },
    text: async () => body,
  } as unknown as Response;
}
