import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME,
  ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME,
  LEGACY_ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME,
  LEGACY_ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME,
  migrateAnnouncementSourceContentTypeIndex
} from "../src/scripts/migrate-announcement-source-content-type-index.js";

describe("announcement source content-type index migration", () => {
  it("backfills legacy rows, creates replacements before dropping old indexes, and is idempotent", async () => {
    const harness = migrationHarness();

    await expect(migrateAnnouncementSourceContentTypeIndex(harness.connection)).resolves.toEqual({
      backfilledContentTypes: 2,
      uniqueIndexCreated: true,
      canonicalIndexCreated: true,
      legacyUniqueIndexDropped: true,
      legacyCanonicalIndexDropped: true
    });
    expect(harness.documents.map((document) => document.contentType)).toEqual(["announcement", "announcement", "news"]);
    expect(harness.operations).toEqual([
      `create:${ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME}`,
      `create:${ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME}`,
      `drop:${LEGACY_ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME}`,
      `drop:${LEGACY_ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME}`
    ]);

    harness.operations.length = 0;
    await expect(migrateAnnouncementSourceContentTypeIndex(harness.connection)).resolves.toEqual({
      backfilledContentTypes: 0,
      uniqueIndexCreated: false,
      canonicalIndexCreated: false,
      legacyUniqueIndexDropped: false,
      legacyCanonicalIndexDropped: false
    });
    expect(harness.operations).toEqual([]);
  });

  it("keeps the legacy guard when replacement-index creation fails", async () => {
    const harness = migrationHarness({ failCreate: ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME });

    await expect(migrateAnnouncementSourceContentTypeIndex(harness.connection))
      .rejects.toThrow("SIMULATED_INDEX_CREATE_FAILURE");
    expect(harness.indexNames()).toEqual(expect.arrayContaining([
      LEGACY_ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME,
      LEGACY_ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME
    ]));
    expect(harness.operations.some((operation) => operation.startsWith("drop:"))).toBe(false);
  });

  it("fails closed on an unexpected existing replacement index shape", async () => {
    const harness = migrationHarness();
    harness.indexes.push({
      name: ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME,
      key: { sourceUrl: 1, scopeType: 1 },
      unique: true
    });

    await expect(migrateAnnouncementSourceContentTypeIndex(harness.connection))
      .rejects.toThrow(`ANNOUNCEMENT_SOURCE_INDEX_SHAPE_INVALID:${ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME}`);
    expect(harness.operations).toEqual([]);
    expect(harness.indexNames()).toContain(LEGACY_ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME);
  });

  it("fails closed before index replacement when a source has an invalid content type", async () => {
    const harness = migrationHarness();
    harness.documents.push({ contentType: "calendar" });

    await expect(migrateAnnouncementSourceContentTypeIndex(harness.connection))
      .rejects.toThrow("ANNOUNCEMENT_SOURCE_CONTENT_TYPE_INVALID:1");
    expect(harness.operations).toEqual([]);
    expect(harness.indexNames()).toContain(LEGACY_ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME);
  });

  it("verifies legacy indexes are actually absent after the drop calls", async () => {
    const harness = migrationHarness({ retainDroppedIndexes: true });

    await expect(migrateAnnouncementSourceContentTypeIndex(harness.connection))
      .rejects.toThrow("ANNOUNCEMENT_SOURCE_LEGACY_INDEX_STILL_PRESENT");
  });

  it("creates the replacement indexes idempotently when the collection does not exist yet", async () => {
    const harness = migrationHarness({ namespaceMissing: true });

    await expect(migrateAnnouncementSourceContentTypeIndex(harness.connection)).resolves.toEqual({
      backfilledContentTypes: 0,
      uniqueIndexCreated: true,
      canonicalIndexCreated: true,
      legacyUniqueIndexDropped: false,
      legacyCanonicalIndexDropped: false
    });
    await expect(migrateAnnouncementSourceContentTypeIndex(harness.connection)).resolves.toEqual({
      backfilledContentTypes: 0,
      uniqueIndexCreated: false,
      canonicalIndexCreated: false,
      legacyUniqueIndexDropped: false,
      legacyCanonicalIndexDropped: false
    });
  });
});

function migrationHarness(options: {
  failCreate?: string;
  namespaceMissing?: boolean;
  retainDroppedIndexes?: boolean;
} = {}) {
  const documents: Array<{ contentType?: string | null }> = [
    {},
    { contentType: null },
    { contentType: "news" }
  ];
  const indexes: Array<{ name: string; key: Record<string, number>; unique?: boolean }> = [
    { name: "_id_", key: { _id: 1 }, unique: true },
    {
      name: LEGACY_ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME,
      key: { sourceUrl: 1, scopeType: 1, scopeId: 1 },
      unique: true
    },
    {
      name: LEGACY_ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME,
      key: { canonicalUrl: 1, scopeType: 1, scopeId: 1 }
    }
  ];
  const operations: string[] = [];
  let collectionExists = !options.namespaceMissing;
  if (!collectionExists) {
    documents.length = 0;
    indexes.length = 0;
  }
  const collection = {
    updateMany: async () => {
      if (!collectionExists) return { modifiedCount: 0 };
      let modifiedCount = 0;
      for (const document of documents) {
        if (document.contentType !== undefined && document.contentType !== null) continue;
        document.contentType = "announcement";
        modifiedCount += 1;
      }
      return { modifiedCount };
    },
    countDocuments: async () => documents.filter((document) =>
      !["announcement", "news", "event"].includes(document.contentType ?? "")).length,
    indexes: async () => {
      if (!collectionExists) throw Object.assign(new Error("namespace not found"), { code: 26 });
      return indexes.map((index) => ({ ...index, key: { ...index.key } }));
    },
    createIndex: async (keys: Record<string, number>, createOptions: { name: string; unique?: boolean }) => {
      operations.push(`create:${createOptions.name}`);
      if (options.failCreate === createOptions.name) throw new Error("SIMULATED_INDEX_CREATE_FAILURE");
      collectionExists = true;
      indexes.push({ name: createOptions.name, key: { ...keys }, ...(createOptions.unique ? { unique: true } : {}) });
      return createOptions.name;
    },
    dropIndex: async (name: string) => {
      operations.push(`drop:${name}`);
      const index = indexes.findIndex((candidate) => candidate.name === name);
      if (index < 0) throw Object.assign(new Error("index not found"), { code: 27 });
      if (!options.retainDroppedIndexes) indexes.splice(index, 1);
    }
  };
  return {
    connection: { collection: () => collection } as never,
    documents,
    indexes,
    operations,
    indexNames: () => indexes.map((index) => index.name)
  };
}
