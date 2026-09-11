import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mongoose, { type Collection, type Connection, type Document } from "mongoose";

export const ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME = "announcement_sources_unique_scope_url_content";
export const ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME = "announcement_sources_canonical_scope_content";
export const LEGACY_ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME = "announcement_sources_unique_scope_url";
export const LEGACY_ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME = "announcement_sources_canonical_scope";

const uniqueKeys = { sourceUrl: 1, scopeType: 1, scopeId: 1, contentType: 1 } as const;
const canonicalKeys = { canonicalUrl: 1, scopeType: 1, scopeId: 1, contentType: 1 } as const;
const legacyUniqueKeys = { sourceUrl: 1, scopeType: 1, scopeId: 1 } as const;
const legacyCanonicalKeys = { canonicalUrl: 1, scopeType: 1, scopeId: 1 } as const;

interface MongoIndexInfo {
  name?: string;
  key?: Record<string, unknown>;
  unique?: boolean;
}

export interface AnnouncementSourceContentTypeIndexMigrationResult {
  backfilledContentTypes: number;
  uniqueIndexCreated: boolean;
  canonicalIndexCreated: boolean;
  legacyUniqueIndexDropped: boolean;
  legacyCanonicalIndexDropped: boolean;
}

export async function migrateAnnouncementSourceContentTypeIndex(
  connection: Pick<Connection, "collection">
): Promise<AnnouncementSourceContentTypeIndexMigrationResult> {
  const collection = connection.collection("announcement_sources") as Collection<Document>;
  const backfill = await collection.updateMany(
    { $or: [{ contentType: { $exists: false } }, { contentType: null }] },
    { $set: { contentType: "announcement" } }
  );
  const invalidContentTypes = await collection.countDocuments({
    contentType: { $nin: ["announcement", "news", "event"] }
  });
  if (invalidContentTypes > 0) {
    throw new Error(`ANNOUNCEMENT_SOURCE_CONTENT_TYPE_INVALID:${invalidContentTypes}`);
  }

  let indexes = await readIndexes(collection);
  const existingUnique = indexes.find((index) => index.name === ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME);
  const existingCanonical = indexes.find((index) => index.name === ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME);
  if (existingUnique) assertIndexShape(existingUnique, uniqueKeys, true);
  if (existingCanonical) assertIndexShape(existingCanonical, canonicalKeys, false);

  let uniqueIndexCreated = false;
  if (!existingUnique) {
    await collection.createIndex(uniqueKeys, { unique: true, name: ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME });
    uniqueIndexCreated = true;
  }
  let canonicalIndexCreated = false;
  if (!existingCanonical) {
    await collection.createIndex(canonicalKeys, { name: ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME });
    canonicalIndexCreated = true;
  }

  indexes = await readIndexes(collection);
  const verifiedUnique = indexes.find((index) => index.name === ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME);
  const verifiedCanonical = indexes.find((index) => index.name === ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME);
  if (!verifiedUnique || !verifiedCanonical) throw new Error("ANNOUNCEMENT_SOURCE_INDEX_CREATE_NOT_VISIBLE");
  assertIndexShape(verifiedUnique, uniqueKeys, true);
  assertIndexShape(verifiedCanonical, canonicalKeys, false);

  const legacyUnique = indexes.find((index) => index.name === LEGACY_ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME);
  const legacyCanonical = indexes.find((index) => index.name === LEGACY_ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME);
  if (legacyUnique) assertIndexShape(legacyUnique, legacyUniqueKeys, true);
  if (legacyCanonical) assertIndexShape(legacyCanonical, legacyCanonicalKeys, false);

  const legacyUniqueIndexDropped = legacyUnique
    ? await dropIndexIfPresent(collection, LEGACY_ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME)
    : false;
  const legacyCanonicalIndexDropped = legacyCanonical
    ? await dropIndexIfPresent(collection, LEGACY_ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME)
    : false;

  indexes = await readIndexes(collection);
  const finalUnique = indexes.find((index) => index.name === ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME);
  const finalCanonical = indexes.find((index) => index.name === ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME);
  if (!finalUnique || !finalCanonical) throw new Error("ANNOUNCEMENT_SOURCE_INDEX_FINAL_STATE_MISSING");
  assertIndexShape(finalUnique, uniqueKeys, true);
  assertIndexShape(finalCanonical, canonicalKeys, false);
  if (indexes.some((index) => index.name === LEGACY_ANNOUNCEMENT_SOURCE_UNIQUE_INDEX_NAME
    || index.name === LEGACY_ANNOUNCEMENT_SOURCE_CANONICAL_INDEX_NAME)) {
    throw new Error("ANNOUNCEMENT_SOURCE_LEGACY_INDEX_STILL_PRESENT");
  }

  return {
    backfilledContentTypes: backfill.modifiedCount,
    uniqueIndexCreated,
    canonicalIndexCreated,
    legacyUniqueIndexDropped,
    legacyCanonicalIndexDropped
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

async function dropIndexIfPresent(collection: Collection<Document>, name: string): Promise<boolean> {
  try {
    await collection.dropIndex(name);
    return true;
  } catch (error) {
    if (mongoErrorCode(error) === 27) return false;
    throw error;
  }
}

function assertIndexShape(
  index: MongoIndexInfo,
  expectedKeys: Record<string, number>,
  expectedUnique: boolean
): void {
  const actualKeys = Object.entries(index.key ?? {});
  const expectedEntries = Object.entries(expectedKeys);
  const keysMatch = JSON.stringify(actualKeys) === JSON.stringify(expectedEntries);
  const uniquenessMatches = expectedUnique ? index.unique === true : index.unique !== true;
  if (!keysMatch || !uniquenessMatches) {
    throw new Error(`ANNOUNCEMENT_SOURCE_INDEX_SHAPE_INVALID:${index.name ?? "unnamed"}`);
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
    const result = await migrateAnnouncementSourceContentTypeIndex(connection);
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
