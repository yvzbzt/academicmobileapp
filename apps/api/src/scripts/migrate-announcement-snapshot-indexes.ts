import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mongoose, { type Collection, type Connection, type Document } from "mongoose";

export const ANNOUNCEMENT_SNAPSHOT_ITEM_LOOKUP_INDEX_NAME =
  "announcement_snapshots_review_item_lookup";
export const ANNOUNCEMENT_SNAPSHOT_RETENTION_INDEX_NAME =
  "announcement_snapshots_retention_candidates";
export const ANNOUNCEMENT_SNAPSHOT_PURGE_TTL_INDEX_NAME =
  "announcement_snapshots_purge_after_ttl";

interface MongoIndexInfo {
  name?: string;
  key?: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  hidden?: boolean;
  expireAfterSeconds?: unknown;
  partialFilterExpression?: unknown;
}

interface RequiredIndex {
  keys: Record<string, number>;
  name: string;
  expireAfterSeconds?: number;
}

const requiredIndexes: readonly RequiredIndex[] = [
  {
    keys: { "items.id": 1, createdAt: -1 },
    name: ANNOUNCEMENT_SNAPSHOT_ITEM_LOOKUP_INDEX_NAME
  },
  {
    keys: { nextRetentionCheckAt: 1, createdAt: 1, purgeAfter: 1, activationLeaseUntil: 1 },
    name: ANNOUNCEMENT_SNAPSHOT_RETENTION_INDEX_NAME
  },
  {
    keys: { purgeAfter: 1 },
    name: ANNOUNCEMENT_SNAPSHOT_PURGE_TTL_INDEX_NAME,
    expireAfterSeconds: 0
  }
];

export interface AnnouncementSnapshotIndexMigrationResult {
  itemLookupIndexCreated: boolean;
  retentionIndexCreated: boolean;
  purgeTtlIndexCreated: boolean;
}

export async function migrateAnnouncementSnapshotIndexes(
  connection: Pick<Connection, "collection">
): Promise<AnnouncementSnapshotIndexMigrationResult> {
  const collection = connection.collection("announcement_snapshots") as Collection<Document>;
  const initialIndexes = await readIndexes(collection);
  const missing: RequiredIndex[] = [];

  for (const required of requiredIndexes) {
    const named = initialIndexes.find((index) => index.name === required.name);
    if (named) {
      assertIndexShape(named, required);
      continue;
    }
    const conflicting = initialIndexes.find((index) => sameKeys(index.key, required.keys));
    if (conflicting) throw indexConflict(required, conflicting.name);
    missing.push(required);
  }

  for (const required of missing) {
    try {
      const createdName = await collection.createIndex(required.keys, {
        name: required.name,
        ...(required.expireAfterSeconds === undefined
          ? {}
          : { expireAfterSeconds: required.expireAfterSeconds })
      });
      if (createdName !== required.name) throw indexConflict(required, createdName);
    } catch (error) {
      if (mongoErrorCode(error) === 85 || mongoErrorCode(error) === 86) {
        throw indexConflict(required);
      }
      throw error;
    }
  }

  const finalIndexes = await readIndexes(collection);
  for (const required of requiredIndexes) {
    const verified = finalIndexes.find((index) => index.name === required.name);
    if (!verified) throw new Error(`ANNOUNCEMENT_SNAPSHOT_INDEX_CREATE_NOT_VISIBLE:${required.name}`);
    assertIndexShape(verified, required);
  }

  return {
    itemLookupIndexCreated: missing.some(({ name }) => name === ANNOUNCEMENT_SNAPSHOT_ITEM_LOOKUP_INDEX_NAME),
    retentionIndexCreated: missing.some(({ name }) => name === ANNOUNCEMENT_SNAPSHOT_RETENTION_INDEX_NAME),
    purgeTtlIndexCreated: missing.some(({ name }) => name === ANNOUNCEMENT_SNAPSHOT_PURGE_TTL_INDEX_NAME)
  };
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
  const expectedTtl = required.expireAfterSeconds;
  const ttlMatches = expectedTtl === undefined
    ? index.expireAfterSeconds === undefined
    : Number(index.expireAfterSeconds) === expectedTtl;
  if (
    !sameKeys(index.key, required.keys)
    || index.unique === true
    || index.sparse === true
    || index.hidden === true
    || index.partialFilterExpression !== undefined
    || !ttlMatches
  ) {
    throw new Error(`ANNOUNCEMENT_SNAPSHOT_INDEX_SHAPE_INVALID:${required.name}`);
  }
}

function sameKeys(actual: Record<string, unknown> | undefined, expected: Record<string, number>): boolean {
  return JSON.stringify(Object.entries(actual ?? {})) === JSON.stringify(Object.entries(expected));
}

function indexConflict(required: RequiredIndex, conflictingName?: string): Error {
  return new Error(
    `ANNOUNCEMENT_SNAPSHOT_INDEX_CONFLICT:${required.name}${conflictingName ? `:${conflictingName}` : ""}`
  );
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
    const result = await migrateAnnouncementSnapshotIndexes(connection);
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
