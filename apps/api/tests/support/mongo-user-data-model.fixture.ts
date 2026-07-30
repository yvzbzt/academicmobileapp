import type { MongoConnectionService } from "../../src/database/mongo-connection.service.js";

type StoredRecord = Record<string, unknown> & { _id: string; createdAt: Date };
type Filter = Record<string, unknown>;
type Update = Record<string, unknown> & {
  $set?: Record<string, unknown>;
  $setOnInsert?: Record<string, unknown>;
  $unset?: Record<string, unknown>;
};
type SortDefinition = Record<string, 1 | -1>;

interface FakeDocument {
  id: string;
  toObject(): Record<string, unknown>;
}

interface FindOneAndUpdateOptions {
  new?: boolean;
  returnDocument?: "before" | "after";
  upsert?: boolean;
}

export interface FakeMongoUserDataModel {
  create(input: Record<string, unknown>): Promise<FakeDocument>;
  find(filter?: Filter): FakeFindQuery;
  findById(id: string): Promise<FakeDocument | null>;
  findByIdAndUpdate(
    id: string,
    update: Update,
    options?: FindOneAndUpdateOptions
  ): Promise<FakeDocument | null>;
  findOne(filter: Filter): Promise<FakeDocument | null>;
  findOneAndUpdate(
    filter: Filter,
    update: Update,
    options?: FindOneAndUpdateOptions
  ): Promise<FakeDocument | null>;
  deleteMany(filter: Filter): Promise<{ deletedCount: number }>;
}

export interface FakeFindQuery extends PromiseLike<FakeDocument[]> {
  sort(definition: SortDefinition): Promise<FakeDocument[]>;
}

export interface MongoUserDataModelFixtureSnapshot {
  academicUnitSuggestions: Record<string, unknown>[];
  followedAcademicScopes: Record<string, unknown>[];
}

export interface MongoUserDataModelFixture {
  mongo: MongoConnectionService;
  models: {
    AcademicUnitSuggestion: FakeMongoUserDataModel;
    FollowedAcademicScope: FakeMongoUserDataModel;
  };
  snapshot(): MongoUserDataModelFixtureSnapshot;
  clear(): void;
}

export interface MongoUserDataModelFixtureOptions {
  initialTimestamp?: Date;
  timestampStepMs?: number;
}

/**
 * Provides the subset of the Mongoose model API used by MongoUserDataRepository.
 * One fixture owns one shared model context, so repositories rebuilt with the
 * same `mongo` value observe the same persisted records.
 */
export function createMongoUserDataModelFixture(
  options: MongoUserDataModelFixtureOptions = {}
): MongoUserDataModelFixture {
  const stores = {
    AcademicUnitSuggestion: new Map<string, StoredRecord>(),
    FollowedAcademicScope: new Map<string, StoredRecord>()
  };
  const timestampStepMs = options.timestampStepMs ?? 1;
  let timestampCursor = (options.initialTimestamp ?? new Date("2026-01-01T00:00:00.000Z")).getTime();
  let generatedId = 0;

  const nextTimestamp = (): Date => {
    const timestamp = new Date(timestampCursor);
    timestampCursor += timestampStepMs;
    return timestamp;
  };
  const nextId = (modelName: keyof typeof stores): string => {
    generatedId += 1;
    return `fixture-${modelName}-${generatedId}`;
  };

  const models = {
    AcademicUnitSuggestion: createModel(
      "AcademicUnitSuggestion",
      stores.AcademicUnitSuggestion,
      nextTimestamp,
      nextId
    ),
    FollowedAcademicScope: createModel(
      "FollowedAcademicScope",
      stores.FollowedAcademicScope,
      nextTimestamp,
      nextId
    )
  };
  const connection = { models };
  const mongo = {
    getConnection: () => connection,
    connect: async () => connection
  } as unknown as MongoConnectionService;

  return {
    mongo,
    models,
    snapshot: () => ({
      academicUnitSuggestions: [...stores.AcademicUnitSuggestion.values()].map(cloneRecord),
      followedAcademicScopes: [...stores.FollowedAcademicScope.values()].map(cloneRecord)
    }),
    clear: () => {
      stores.AcademicUnitSuggestion.clear();
      stores.FollowedAcademicScope.clear();
    }
  };
}

function createModel(
  modelName: "AcademicUnitSuggestion" | "FollowedAcademicScope",
  store: Map<string, StoredRecord>,
  nextTimestamp: () => Date,
  nextId: (modelName: "AcademicUnitSuggestion" | "FollowedAcademicScope") => string
): FakeMongoUserDataModel {
  const createRecord = (input: Record<string, unknown>): StoredRecord => {
    const id = typeof input._id === "string" ? input._id : nextId(modelName);
    const createdAt = input.createdAt instanceof Date ? new Date(input.createdAt) : nextTimestamp();
    const record = cloneRecord({ ...input, _id: id, createdAt }) as StoredRecord;
    assertUniqueFollowedScope(modelName, store, record);
    store.set(id, record);
    return record;
  };

  const findRecord = (filter: Filter): StoredRecord | undefined =>
    [...store.values()].find((record) => matchesFilter(record, filter));

  const findRecords = (filter: Filter): StoredRecord[] =>
    [...store.values()].filter((record) => matchesFilter(record, filter));

  const model: FakeMongoUserDataModel = {
    async create(input) {
      return toDocument(createRecord(input));
    },

    find(filter = {}) {
      return createFindQuery(() => findRecords(filter));
    },

    async findById(id) {
      const record = store.get(id);
      return record ? toDocument(record) : null;
    },

    async findByIdAndUpdate(id, update, options = {}) {
      const record = store.get(id);
      if (!record) return null;
      const previous = cloneRecord(record) as StoredRecord;
      const updated = applyUpdate(record, update, false);
      assertUniqueFollowedScope(modelName, store, updated, id);
      store.set(id, updated);
      return toDocument(returnsUpdatedDocument(options) ? updated : previous);
    },

    async findOne(filter) {
      const record = findRecord(filter);
      return record ? toDocument(record) : null;
    },

    async findOneAndUpdate(filter, update, options = {}) {
      const existing = findRecord(filter);
      if (existing) {
        const previous = cloneRecord(existing) as StoredRecord;
        const updated = applyUpdate(existing, update, false);
        assertUniqueFollowedScope(modelName, store, updated, existing._id);
        store.set(existing._id, updated);
        return toDocument(returnsUpdatedDocument(options) ? updated : previous);
      }
      if (!options.upsert) return null;

      const record = createRecord({
        ...equalityFields(filter),
        ...(update.$setOnInsert ?? {}),
        ...(update.$set ?? {})
      });
      return returnsUpdatedDocument(options) ? toDocument(record) : null;
    },

    async deleteMany(filter) {
      let deletedCount = 0;
      for (const [id, record] of store) {
        if (!matchesFilter(record, filter)) continue;
        store.delete(id);
        deletedCount += 1;
      }
      return { deletedCount };
    }
  };

  return model;
}

function returnsUpdatedDocument(options: FindOneAndUpdateOptions): boolean {
  return options.new === true || options.returnDocument === "after";
}

function createFindQuery(load: () => StoredRecord[]): FakeFindQuery {
  const documents = (definition?: SortDefinition): FakeDocument[] => {
    const records = load().map((record) => cloneRecord(record) as StoredRecord);
    if (definition) records.sort((left, right) => compareRecords(left, right, definition));
    return records.map(toDocument);
  };

  return {
    sort: async (definition) => documents(definition),
    then: (onfulfilled, onrejected) => Promise.resolve(documents()).then(onfulfilled, onrejected)
  };
}

function applyUpdate(record: StoredRecord, update: Update, inserting: boolean): StoredRecord {
  const updated = cloneRecord(record) as StoredRecord;
  if (inserting && update.$setOnInsert) Object.assign(updated, cloneRecord(update.$setOnInsert));
  if (update.$set) Object.assign(updated, cloneRecord(update.$set));
  if (update.$unset) {
    for (const field of Object.keys(update.$unset)) delete updated[field];
  }
  for (const [field, value] of Object.entries(update)) {
    if (!field.startsWith("$")) updated[field] = cloneValue(value);
  }
  return updated;
}

function equalityFields(filter: Filter): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(filter)
      .filter(([field, value]) => !field.startsWith("$") && !isOperatorExpression(value))
      .map(([field, value]) => [field, cloneValue(value)])
  );
}

function matchesFilter(record: StoredRecord, filter: Filter): boolean {
  return Object.entries(filter).every(([field, expected]) => {
    if (field === "$and" && Array.isArray(expected)) {
      return expected.every((part) => matchesFilter(record, part as Filter));
    }
    if (field === "$or" && Array.isArray(expected)) {
      return expected.some((part) => matchesFilter(record, part as Filter));
    }

    const present = Object.prototype.hasOwnProperty.call(record, field);
    const actual = record[field];
    if (isOperatorExpression(expected)) {
      if ("$exists" in expected && present !== Boolean(expected.$exists)) return false;
      if ("$eq" in expected && !valuesEqual(actual, expected.$eq)) return false;
      if ("$ne" in expected && valuesEqual(actual, expected.$ne)) return false;
      return true;
    }
    return valuesEqual(actual, expected);
  });
}

function compareRecords(left: StoredRecord, right: StoredRecord, definition: SortDefinition): number {
  for (const [field, direction] of Object.entries(definition)) {
    const comparison = compareValues(left[field], right[field]);
    if (comparison !== 0) return comparison * direction;
  }
  return 0;
}

function compareValues(left: unknown, right: unknown): number {
  const normalizedLeft = left instanceof Date ? left.getTime() : left;
  const normalizedRight = right instanceof Date ? right.getTime() : right;
  if (normalizedLeft === normalizedRight) return 0;
  if (normalizedLeft === undefined || normalizedLeft === null) return -1;
  if (normalizedRight === undefined || normalizedRight === null) return 1;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return Object.is(left, right);
}

function assertUniqueFollowedScope(
  modelName: "AcademicUnitSuggestion" | "FollowedAcademicScope",
  store: Map<string, StoredRecord>,
  candidate: StoredRecord,
  ignoredId?: string
): void {
  if (modelName !== "FollowedAcademicScope") return;
  const duplicate = [...store.values()].some((record) =>
    record._id !== ignoredId
    && record.userId === candidate.userId
    && record.normalizedScopeKey === candidate.normalizedScopeKey
  );
  if (!duplicate) return;
  throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
}

function toDocument(record: StoredRecord): FakeDocument {
  return {
    id: record._id,
    toObject: () => cloneRecord(record)
  };
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, cloneValue(value)]));
}

function cloneValue(value: unknown): unknown {
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") return cloneRecord(value as Record<string, unknown>);
  return value;
}

function isOperatorExpression(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && !(value instanceof Date)
    && Object.keys(value as Record<string, unknown>).some((key) => key.startsWith("$"))
  );
}
