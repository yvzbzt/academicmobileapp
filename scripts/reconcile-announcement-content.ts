import mongoose from "mongoose";
import type { Collection, Document as MongoDocument } from "mongodb";
import { pathToFileURL } from "node:url";
import { knownOfficialUniversityUrls } from "../apps/api/src/modules/announcements/announcement-ingestion.service.js";
import {
  BUILT_IN_OFFICIAL_SCOPE_URLS,
  databaseNameFromMongoUri,
  itemReconciliationPreimageHash,
  parseReconciliationCliOptions,
  planAnnouncementContentReconciliation,
  sourceReconciliationPreimageHash,
  toMongoReconciliationSet,
  type ReconciliationItemDocument,
  type ReconciliationMutation,
  type ReconciliationSourceDocument
} from "../apps/api/src/modules/announcements/announcement-content-reconciliation.js";

async function main(): Promise<void> {
  const options = parseReconciliationCliOptions(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) throw new Error("CONTENT_RECONCILIATION_MONGODB_URI_REQUIRED");
  const databaseName = databaseNameFromMongoUri(mongoUri);
  if (!databaseName) throw new Error("CONTENT_RECONCILIATION_DATABASE_NAME_REQUIRED");
  if (options.apply && options.confirmDatabase !== databaseName) {
    throw new Error("CONTENT_RECONCILIATION_DATABASE_CONFIRMATION_MISMATCH");
  }

  const connection = await mongoose.createConnection(mongoUri, {
    autoIndex: false,
    serverSelectionTimeoutMS: Number(process.env.MONGODB_SELECTION_TIMEOUT_MS ?? 5_000)
  }).asPromise();

  try {
    const sourceCollection = connection.collection("announcement_sources");
    const itemCollection = connection.collection("announcement_items");
    const [sourceRows, itemRows, universityRows, facultyRows, departmentRows] = await Promise.all([
      sourceCollection.find({}).sort({ _id: 1 }).toArray(),
      itemCollection.find({}).sort({ _id: 1 }).toArray(),
      connection.collection("universities").find({}).toArray(),
      connection.collection("faculties").find({}).toArray(),
      connection.collection("departments").find({}).toArray()
    ]);
    const sourceIds = new Map(sourceRows.map((row) => [String(row._id), row._id]));
    const itemIds = new Map(itemRows.map((row) => [String(row._id), row._id]));
    const plan = planAnnouncementContentReconciliation({
      sources: sourceRows.map(toSourceDocument),
      items: itemRows.map(toItemDocument),
      officialScopeUrls: buildOfficialScopeUrls(universityRows, facultyRows, departmentRows)
    });

    if (!options.apply) {
      console.log(JSON.stringify({ mode: "dry-run", databaseName, ...plan.summary }, null, 2));
      return;
    }

    const sourceResult = await applyMutations({
      collection: sourceCollection,
      ids: sourceIds,
      mutations: plan.sources,
      batchSize: options.batchSize,
      documentType: "source",
      preimageHash: (row) => sourceReconciliationPreimageHash(toSourceDocument(row) as unknown as Record<string, unknown>)
    });
    const itemResult = sourceResult.conflicts === 0
      ? await applyMutations({
          collection: itemCollection,
          ids: itemIds,
          mutations: plan.items,
          batchSize: options.batchSize,
          documentType: "item",
          preimageHash: (row) => itemReconciliationPreimageHash(toItemDocument(row) as unknown as Record<string, unknown>)
        })
      : { applied: 0, conflicts: 0 };
    const skippedItemMutations = sourceResult.conflicts > 0 ? plan.items.length : 0;

    console.log(JSON.stringify({
      mode: "apply",
      databaseName,
      ...plan.summary,
      appliedSourceMutations: sourceResult.applied,
      appliedItemMutations: itemResult.applied,
      skippedItemMutations,
      conflicts: sourceResult.conflicts + itemResult.conflicts
    }, null, 2));
    if (sourceResult.conflicts + itemResult.conflicts > 0) process.exitCode = 2;
  } finally {
    await connection.close();
  }
}

export async function applyMutations(input: {
  collection: Collection<MongoDocument>;
  ids: Map<string, MongoDocument["_id"]>;
  mutations: ReconciliationMutation[];
  batchSize: number;
  documentType: "source" | "item";
  preimageHash: (document: MongoDocument) => string;
}): Promise<{ applied: number; conflicts: number }> {
  let applied = 0;
  let conflicts = 0;
  for (let offset = 0; offset < input.mutations.length; offset += input.batchSize) {
    const batch = input.mutations.slice(offset, offset + input.batchSize);
    for (const mutation of batch) {
      const databaseId = input.ids.get(mutation.id);
      if (databaseId === undefined) {
        conflicts += 1;
        continue;
      }
      const current = await input.collection.findOne({ _id: databaseId });
      if (!current || input.preimageHash(current) !== mutation.preimageHash) {
        conflicts += 1;
        continue;
      }
      const updateFilter: Record<string, unknown> = { _id: databaseId };
      updateFilter.updatedAt = current.updatedAt instanceof Date ? current.updatedAt : { $exists: false };
      const set = toMongoReconciliationSet(mutation.set, input.documentType);
      set.updatedAt = new Date();
      const update: Record<string, unknown> = { $set: set };
      if (mutation.unset.length > 0) update.$unset = Object.fromEntries(mutation.unset.map((field) => [field, ""]));
      const result = await input.collection.updateOne(updateFilter, update);
      if (result.modifiedCount === 1) applied += 1;
      else conflicts += 1;
    }
  }
  return { applied, conflicts };
}

function toSourceDocument(row: MongoDocument): ReconciliationSourceDocument {
  return { ...(row as unknown as ReconciliationSourceDocument), id: String(row._id) };
}

function toItemDocument(row: MongoDocument): ReconciliationItemDocument {
  return { ...(row as unknown as ReconciliationItemDocument), id: String(row._id) };
}

export function buildOfficialScopeUrls(
  universities: MongoDocument[],
  faculties: MongoDocument[],
  departments: MongoDocument[]
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const universityUrls = new Map<string, string[]>();
  for (const university of universities) {
    const id = String(university._id);
    const emailDomainUrls = Array.isArray(university.emailDomains)
      ? university.emailDomains.flatMap((domain: unknown) => typeof domain === "string" ? [`https://${domain}`] : [])
      : [];
    const urls = uniqueUrls([
      ...readUrls(university, ["websiteUrl", "announcementUrl", "academicCalendarUrl"]),
      ...emailDomainUrls,
      ...knownOfficialUniversityUrls(id),
      ...knownOfficialUniversityUrls(String(university.slug ?? ""))
    ]);
    universityUrls.set(id, urls);
    result[`university:${id}`] = urls;
  }
  for (const [scopeKey, urls] of Object.entries(BUILT_IN_OFFICIAL_SCOPE_URLS)) {
    result[scopeKey] = [...urls];
  }

  const facultyUrls = new Map<string, string[]>();
  for (const faculty of faculties) {
    const id = String(faculty._id);
    const urls = uniqueUrls([
      ...readUrls(faculty, ["websiteUrl", "announcementUrl"]),
      ...(universityUrls.get(String(faculty.universityId ?? "")) ?? [])
    ]);
    facultyUrls.set(id, urls);
    result[`faculty:${id}`] = urls;
  }

  for (const department of departments) {
    const id = String(department._id);
    result[`department:${id}`] = uniqueUrls([
      ...readUrls(department, ["websiteUrl", "announcementUrl", "courseScheduleUrl", "examScheduleUrl"]),
      ...(facultyUrls.get(String(department.facultyId ?? "")) ?? []),
      ...(universityUrls.get(String(department.universityId ?? "")) ?? [])
    ]);
  }
  return result;
}

function readUrls(document: MongoDocument, fields: string[]): string[] {
  return uniqueUrls(fields.flatMap((field) => typeof document[field] === "string" ? [document[field] as string] : []));
}

function uniqueUrls(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

if (isDirectExecution()) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "CONTENT_RECONCILIATION_FAILED");
    process.exitCode = 1;
  });
}

function isDirectExecution(): boolean {
  const entryPoint = process.argv[1];
  return Boolean(entryPoint && import.meta.url === pathToFileURL(entryPoint).href);
}
