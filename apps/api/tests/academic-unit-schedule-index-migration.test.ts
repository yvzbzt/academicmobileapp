import { describe, expect, it } from "vitest";
import {
  ACADEMIC_EVENT_SCHEDULE_CANDIDATE_UNIQUE_INDEX_NAME,
  ACADEMIC_UNIT_SCHEDULE_SOURCE_UNIQUE_INDEX_NAME,
  migrateAcademicUnitScheduleIndexes
} from "../src/scripts/migrate-academic-unit-schedule-indexes.js";

describe("academic-unit schedule index migration", () => {
  it("creates both exact unique indexes and is idempotent", async () => {
    const harness = migrationHarness();

    await expect(migrateAcademicUnitScheduleIndexes(harness.connection)).resolves.toEqual({
      scheduleSourceIndexCreated: true,
      eventScheduleCandidateIndexCreated: true
    });
    expect(harness.operations).toEqual([
      `create:${ACADEMIC_UNIT_SCHEDULE_SOURCE_UNIQUE_INDEX_NAME}`,
      `create:${ACADEMIC_EVENT_SCHEDULE_CANDIDATE_UNIQUE_INDEX_NAME}`
    ]);

    harness.operations.length = 0;
    await expect(migrateAcademicUnitScheduleIndexes(harness.connection)).resolves.toEqual({
      scheduleSourceIndexCreated: false,
      eventScheduleCandidateIndexCreated: false
    });
    expect(harness.operations).toEqual([]);
  });

  it("fails closed on an unexpected existing key shape", async () => {
    const harness = migrationHarness();
    harness.indexes.academic_unit_schedule_sources.push({
      name: ACADEMIC_UNIT_SCHEDULE_SOURCE_UNIQUE_INDEX_NAME,
      key: { key: -1 },
      unique: true
    });

    await expect(migrateAcademicUnitScheduleIndexes(harness.connection))
      .rejects.toThrow(
        `ACADEMIC_UNIT_SCHEDULE_INDEX_SHAPE_INVALID:${ACADEMIC_UNIT_SCHEDULE_SOURCE_UNIQUE_INDEX_NAME}`
      );
    expect(harness.operations).toEqual([]);
  });

  it("fails closed when the event candidate index is not sparse", async () => {
    const harness = migrationHarness();
    harness.indexes.academic_events.push({
      name: ACADEMIC_EVENT_SCHEDULE_CANDIDATE_UNIQUE_INDEX_NAME,
      key: { scheduleCandidateKey: 1 },
      unique: true
    });

    await expect(migrateAcademicUnitScheduleIndexes(harness.connection))
      .rejects.toThrow(
        `ACADEMIC_UNIT_SCHEDULE_INDEX_SHAPE_INVALID:${ACADEMIC_EVENT_SCHEDULE_CANDIDATE_UNIQUE_INDEX_NAME}`
      );
    expect(harness.operations).toEqual([]);
  });

  it("does not create either index when schedule-source keys are duplicated", async () => {
    const harness = migrationHarness();
    harness.documents.academic_unit_schedule_sources.push({ key: "schedule-source-a" });

    await expect(migrateAcademicUnitScheduleIndexes(harness.connection))
      .rejects.toThrow("ACADEMIC_UNIT_SCHEDULE_SOURCE_DUPLICATE_KEY");
    expect(harness.operations).toEqual([]);
  });

  it("treats multiple missing non-sparse schedule-source keys as duplicates", async () => {
    const harness = migrationHarness();
    harness.documents.academic_unit_schedule_sources.splice(0, 2, {}, {});

    await expect(migrateAcademicUnitScheduleIndexes(harness.connection))
      .rejects.toThrow("ACADEMIC_UNIT_SCHEDULE_SOURCE_DUPLICATE_KEY");
    expect(harness.operations).toEqual([]);
  });

  it("does not create either index when sparse event candidate keys are duplicated", async () => {
    const harness = migrationHarness();
    harness.documents.academic_events.push({ scheduleCandidateKey: "event-a" });

    await expect(migrateAcademicUnitScheduleIndexes(harness.connection))
      .rejects.toThrow("ACADEMIC_EVENT_SCHEDULE_CANDIDATE_DUPLICATE_KEY");
    expect(harness.operations).toEqual([]);
  });

  it("still fails closed if a duplicate races the preflight", async () => {
    const harness = migrationHarness({ failCreateWithDuplicateKey: true });

    await expect(migrateAcademicUnitScheduleIndexes(harness.connection))
      .rejects.toMatchObject({ code: 11000 });
  });

  it("creates both indexes idempotently when the collections do not exist yet", async () => {
    const harness = migrationHarness({ namespaceMissing: true });

    await expect(migrateAcademicUnitScheduleIndexes(harness.connection)).resolves.toEqual({
      scheduleSourceIndexCreated: true,
      eventScheduleCandidateIndexCreated: true
    });
    await expect(migrateAcademicUnitScheduleIndexes(harness.connection)).resolves.toEqual({
      scheduleSourceIndexCreated: false,
      eventScheduleCandidateIndexCreated: false
    });
  });
});

type CollectionName = "academic_unit_schedule_sources" | "academic_events";
type IndexInfo = {
  name: string;
  key: Record<string, number>;
  unique?: boolean;
  sparse?: boolean;
};

function migrationHarness(options: {
  failCreateWithDuplicateKey?: boolean;
  namespaceMissing?: boolean;
} = {}) {
  const documents: Record<CollectionName, Array<Record<string, unknown>>> = {
    academic_unit_schedule_sources: [
      { key: "schedule-source-a" },
      { key: "schedule-source-b" }
    ],
    academic_events: [
      {},
      {},
      { scheduleCandidateKey: "event-a" },
      { scheduleCandidateKey: "event-b" }
    ]
  };
  const indexes: Record<CollectionName, IndexInfo[]> = {
    academic_unit_schedule_sources: [{ name: "_id_", key: { _id: 1 }, unique: true }],
    academic_events: [{ name: "_id_", key: { _id: 1 }, unique: true }]
  };
  const collectionExists: Record<CollectionName, boolean> = {
    academic_unit_schedule_sources: !options.namespaceMissing,
    academic_events: !options.namespaceMissing
  };
  if (options.namespaceMissing) {
    documents.academic_unit_schedule_sources.length = 0;
    documents.academic_events.length = 0;
    indexes.academic_unit_schedule_sources.length = 0;
    indexes.academic_events.length = 0;
  }
  const operations: string[] = [];
  let createAttempts = 0;

  const connection = {
    collection: (name: CollectionName) => ({
      indexes: async () => {
        if (!collectionExists[name]) throw Object.assign(new Error("namespace not found"), { code: 26 });
        return indexes[name].map((index) => ({ ...index, key: { ...index.key } }));
      },
      aggregate: () => ({
        next: async () => {
          if (!collectionExists[name]) return null;
          const field = name === "academic_events" ? "scheduleCandidateKey" : "key";
          const sparse = name === "academic_events";
          const counts = new Map<unknown, number>();
          for (const document of documents[name]) {
            if (sparse && !Object.hasOwn(document, field)) continue;
            const value = Object.hasOwn(document, field) ? document[field] : null;
            const count = (counts.get(value) ?? 0) + 1;
            if (count > 1) return { _id: value, count };
            counts.set(value, count);
          }
          return null;
        }
      }),
      createIndex: async (
        keys: Record<string, number>,
        createOptions: { name: string; unique?: boolean; sparse?: boolean }
      ) => {
        operations.push(`create:${createOptions.name}`);
        createAttempts += 1;
        if (options.failCreateWithDuplicateKey && createAttempts === 1) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        collectionExists[name] = true;
        indexes[name].push({
          name: createOptions.name,
          key: { ...keys },
          ...(createOptions.unique ? { unique: true } : {}),
          ...(createOptions.sparse ? { sparse: true } : {})
        });
        return createOptions.name;
      }
    })
  };

  return { connection: connection as never, documents, indexes, operations };
}
