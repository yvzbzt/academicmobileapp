import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_SNAPSHOT_ITEM_LOOKUP_INDEX_NAME,
  ANNOUNCEMENT_SNAPSHOT_PURGE_TTL_INDEX_NAME,
  ANNOUNCEMENT_SNAPSHOT_RETENTION_INDEX_NAME,
  migrateAnnouncementSnapshotIndexes
} from "../src/scripts/migrate-announcement-snapshot-indexes.js";

describe("announcement snapshot index migration", () => {
  it("creates the lookup, bounded-retention, and TTL indexes idempotently", async () => {
    const harness = migrationHarness();

    await expect(migrateAnnouncementSnapshotIndexes(harness.connection)).resolves.toEqual({
      itemLookupIndexCreated: true,
      retentionIndexCreated: true,
      purgeTtlIndexCreated: true
    });
    expect(harness.operations).toEqual([
      { name: ANNOUNCEMENT_SNAPSHOT_ITEM_LOOKUP_INDEX_NAME, expireAfterSeconds: undefined },
      { name: ANNOUNCEMENT_SNAPSHOT_RETENTION_INDEX_NAME, expireAfterSeconds: undefined },
      { name: ANNOUNCEMENT_SNAPSHOT_PURGE_TTL_INDEX_NAME, expireAfterSeconds: 0 }
    ]);

    harness.operations.length = 0;
    await expect(migrateAnnouncementSnapshotIndexes(harness.connection)).resolves.toEqual({
      itemLookupIndexCreated: false,
      retentionIndexCreated: false,
      purgeTtlIndexCreated: false
    });
    expect(harness.operations).toEqual([]);
  });

  it("fails before writing when an expected name has the wrong options", async () => {
    const harness = migrationHarness();
    harness.indexes.push({
      name: ANNOUNCEMENT_SNAPSHOT_PURGE_TTL_INDEX_NAME,
      key: { purgeAfter: 1 },
      expireAfterSeconds: 60
    });

    await expect(migrateAnnouncementSnapshotIndexes(harness.connection))
      .rejects.toThrow(
        `ANNOUNCEMENT_SNAPSHOT_INDEX_SHAPE_INVALID:${ANNOUNCEMENT_SNAPSHOT_PURGE_TTL_INDEX_NAME}`
      );
    expect(harness.operations).toEqual([]);
  });

  it("fails before writing when the required key already exists under another name", async () => {
    const harness = migrationHarness();
    harness.indexes.push({
      name: "legacy_snapshot_retention",
      key: { nextRetentionCheckAt: 1, createdAt: 1, purgeAfter: 1, activationLeaseUntil: 1 }
    });

    await expect(migrateAnnouncementSnapshotIndexes(harness.connection))
      .rejects.toThrow(
        `ANNOUNCEMENT_SNAPSHOT_INDEX_CONFLICT:${ANNOUNCEMENT_SNAPSHOT_RETENTION_INDEX_NAME}:legacy_snapshot_retention`
      );
    expect(harness.operations).toEqual([]);
  });

  it.each([85, 86])("reports Mongo index conflict code %i explicitly", async (code) => {
    const harness = migrationHarness({ failCreateCode: code });

    await expect(migrateAnnouncementSnapshotIndexes(harness.connection))
      .rejects.toThrow(
        `ANNOUNCEMENT_SNAPSHOT_INDEX_CONFLICT:${ANNOUNCEMENT_SNAPSHOT_ITEM_LOOKUP_INDEX_NAME}`
      );
  });

  it("creates all indexes when the collection does not exist yet", async () => {
    const harness = migrationHarness({ namespaceMissing: true });

    await expect(migrateAnnouncementSnapshotIndexes(harness.connection)).resolves.toEqual({
      itemLookupIndexCreated: true,
      retentionIndexCreated: true,
      purgeTtlIndexCreated: true
    });
    await expect(migrateAnnouncementSnapshotIndexes(harness.connection)).resolves.toEqual({
      itemLookupIndexCreated: false,
      retentionIndexCreated: false,
      purgeTtlIndexCreated: false
    });
  });
});

interface IndexInfo {
  name: string;
  key: Record<string, number>;
  unique?: boolean;
  sparse?: boolean;
  hidden?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: Record<string, unknown>;
}

function migrationHarness(options: {
  failCreateCode?: number;
  namespaceMissing?: boolean;
} = {}) {
  const indexes: IndexInfo[] = options.namespaceMissing
    ? []
    : [{ name: "_id_", key: { _id: 1 } }];
  const operations: Array<{ name: string; expireAfterSeconds: number | undefined }> = [];
  let collectionExists = !options.namespaceMissing;
  let createAttempts = 0;

  const connection = {
    collection: () => ({
      indexes: async () => {
        if (!collectionExists) throw Object.assign(new Error("namespace not found"), { code: 26 });
        return indexes.map((index) => ({ ...index, key: { ...index.key } }));
      },
      createIndex: async (
        keys: Record<string, number>,
        createOptions: { name: string; expireAfterSeconds?: number }
      ) => {
        operations.push({
          name: createOptions.name,
          expireAfterSeconds: createOptions.expireAfterSeconds
        });
        createAttempts += 1;
        if (options.failCreateCode && createAttempts === 1) {
          throw Object.assign(new Error("index conflict"), { code: options.failCreateCode });
        }
        collectionExists = true;
        indexes.push({
          name: createOptions.name,
          key: { ...keys },
          ...(createOptions.expireAfterSeconds === undefined
            ? {}
            : { expireAfterSeconds: createOptions.expireAfterSeconds })
        });
        return createOptions.name;
      }
    })
  };

  return { connection: connection as never, indexes, operations };
}
