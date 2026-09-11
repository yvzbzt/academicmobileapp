import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mongoose, { type Collection, type Connection, type Document } from "mongoose";

export const ACADEMIC_UNIT_SCHEDULE_SOURCE_UNIQUE_INDEX_NAME =
  "academic_unit_schedule_sources_key_unique";
export const ACADEMIC_EVENT_SCHEDULE_CANDIDATE_UNIQUE_INDEX_NAME =
  "events_schedule_candidate_unique";

const scheduleSourceKeys = { key: 1 } as const;
const eventScheduleCandidateKeys = { scheduleCandidateKey: 1 } as const;

interface MongoIndexInfo {
  name?: string;
  key?: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
}

interface RequiredIndex {
  collection: Collection<Document>;
  field: "key" | "scheduleCandidateKey";
  keys: Record<string, number>;
  name: string;
  sparse: boolean;
  duplicateError: string;
}

export interface AcademicUnitScheduleIndexMigrationResult {
  scheduleSourceIndexCreated: boolean;
  eventScheduleCandidateIndexCreated: boolean;
}

export async function migrateAcademicUnitScheduleIndexes(
  connection: Pick<Connection, "collection">
): Promise<AcademicUnitScheduleIndexMigrationResult> {
  const scheduleSourceIndex: RequiredIndex = {
    collection: connection.collection("academic_unit_schedule_sources") as Collection<Document>,
    field: "key",
    keys: scheduleSourceKeys,
    name: ACADEMIC_UNIT_SCHEDULE_SOURCE_UNIQUE_INDEX_NAME,
    sparse: false,
    duplicateError: "ACADEMIC_UNIT_SCHEDULE_SOURCE_DUPLICATE_KEY"
  };
  const eventScheduleCandidateIndex: RequiredIndex = {
    collection: connection.collection("academic_events") as Collection<Document>,
    field: "scheduleCandidateKey",
    keys: eventScheduleCandidateKeys,
    name: ACADEMIC_EVENT_SCHEDULE_CANDIDATE_UNIQUE_INDEX_NAME,
    sparse: true,
    duplicateError: "ACADEMIC_EVENT_SCHEDULE_CANDIDATE_DUPLICATE_KEY"
  };
  const requiredIndexes = [scheduleSourceIndex, eventScheduleCandidateIndex];
  const missingIndexes: RequiredIndex[] = [];

  for (const required of requiredIndexes) {
    const existing = (await readIndexes(required.collection))
      .find((index) => index.name === required.name);
    if (existing) {
      assertIndexShape(existing, required);
    } else {
      missingIndexes.push(required);
    }
  }

  // Preflight every missing index before creating either one, so duplicate
  // legacy data cannot leave this paired migration only partially applied.
  for (const required of missingIndexes) {
    await assertNoDuplicateValues(required);
  }

  for (const required of missingIndexes) {
    await required.collection.createIndex(required.keys, {
      name: required.name,
      unique: true,
      ...(required.sparse ? { sparse: true } : {})
    });
  }

  for (const required of requiredIndexes) {
    const verified = (await readIndexes(required.collection))
      .find((index) => index.name === required.name);
    if (!verified) throw new Error(`ACADEMIC_UNIT_SCHEDULE_INDEX_CREATE_NOT_VISIBLE:${required.name}`);
    assertIndexShape(verified, required);
  }

  return {
    scheduleSourceIndexCreated: missingIndexes.includes(scheduleSourceIndex),
    eventScheduleCandidateIndexCreated: missingIndexes.includes(eventScheduleCandidateIndex)
  };
}

async function assertNoDuplicateValues(required: RequiredIndex): Promise<void> {
  const duplicate = await required.collection.aggregate([
    ...(required.sparse ? [{ $match: { [required.field]: { $exists: true } } }] : []),
    { $group: { _id: `$${required.field}`, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 }
  ]).next();
  if (duplicate) throw new Error(required.duplicateError);
}

async function readIndexes(collection: Collection<Document>): Promise<MongoIndexInfo[]> {
  try {
    return await collection.indexes() as MongoIndexInfo[];
  } catch (error) {
    if (mongoErrorCode(error) === 26) return [];
    throw error;
  }
}

function assertIndexShape(index: MongoIndexInfo, required: RequiredIndex): void {
  const keysMatch = JSON.stringify(Object.entries(index.key ?? {}))
    === JSON.stringify(Object.entries(required.keys));
  const sparseMatches = required.sparse ? index.sparse === true : index.sparse !== true;
  if (!keysMatch || index.unique !== true || !sparseMatches) {
    throw new Error(`ACADEMIC_UNIT_SCHEDULE_INDEX_SHAPE_INVALID:${required.name}`);
  }
}

function mongoErrorCode(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "number"
    ? error.code
    : undefined;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI is required.");
  const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 10_000 }).asPromise();
  try {
    const result = await migrateAcademicUnitScheduleIndexes(connection);
    process.stdout.write(`${JSON.stringify({ status: "ok", result })}\n`);
  } finally {
    await connection.close();
  }
}

const isEntrypoint = resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
