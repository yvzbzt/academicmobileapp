import { describe, expect, it } from "vitest";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { MongoAnnouncementRepository } from "../src/modules/announcements/mongo-announcement.repository.js";
import type { AnnouncementItem, AnnouncementSourceRecord } from "../src/modules/announcements/announcements.types.js";

describe("announcement source trust persistence", () => {
  it("quarantines new in-memory sources unless trust is explicit and preserves existing decisions on omitted updates", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const created = await repository.upsertSource(sourceInputWithoutTrust());

    expect(created.trustStatus).toBe("quarantined");
    expect(await repository.listAllSources({ status: "active" })).toEqual([]);

    const rejected = await repository.upsertSource({
      ...sourceInputWithoutTrust(),
      id: created.id,
      trustStatus: "rejected"
    });
    const updatedWithoutTrust = await repository.upsertSource({
      ...sourceInputWithoutTrust(),
      id: created.id,
      sourceName: "Updated source name"
    });

    expect(rejected.trustStatus).toBe("rejected");
    expect(updatedWithoutTrust).toEqual(expect.objectContaining({
      id: created.id,
      sourceName: "Updated source name",
      trustStatus: "rejected"
    }));

    const beforeCandidateInsert = JSON.stringify(updatedWithoutTrust);
    const existingCandidate = await repository.insertQuarantinedSourceCandidate(sourceCandidateInput());
    const missingCandidate = await repository.insertQuarantinedSourceCandidate(sourceCandidateInput("https://www.example.edu.tr/haberler"));
    expect(JSON.stringify(existingCandidate)).toBe(beforeCandidateInsert);
    expect(missingCandidate).toEqual(expect.objectContaining({ status: "inactive", trustStatus: "quarantined" }));
  });

  it("quarantines new Mongo sources and does not overwrite an existing trust decision when omitted", async () => {
    const store = new FakeAnnouncementSourceModel();
    const repository = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(repository, "model", { value: async () => store });

    const created = await repository.upsertSource(sourceInputWithoutTrust());
    expect(created.trustStatus).toBe("quarantined");
    expect(store.records[0]?.trustStatus).toBe("quarantined");

    const rejected = await repository.upsertSource({
      ...sourceInputWithoutTrust(),
      id: created.id,
      trustStatus: "rejected"
    });
    const updatedWithoutTrust = await repository.upsertSource({
      ...sourceInputWithoutTrust(),
      id: created.id,
      sourceName: "Updated source name"
    });

    expect(rejected.trustStatus).toBe("rejected");
    expect(updatedWithoutTrust.trustStatus).toBe("rejected");
    expect(store.records[0]).toEqual(expect.objectContaining({
      sourceName: "Updated source name",
      trustStatus: "rejected"
    }));

    const beforeCandidateInsert = JSON.stringify(updatedWithoutTrust);
    const existingCandidate = await repository.insertQuarantinedSourceCandidate(sourceCandidateInput());
    const missingCandidate = await repository.insertQuarantinedSourceCandidate(sourceCandidateInput("https://www.example.edu.tr/haberler"));
    expect(JSON.stringify(existingCandidate)).toBe(beforeCandidateInsert);
    expect(missingCandidate).toEqual(expect.objectContaining({ status: "inactive", trustStatus: "quarantined" }));
    expect(store.records).toHaveLength(2);

    const [concurrentLeft, concurrentRight] = await Promise.all([
      repository.insertQuarantinedSourceCandidate(sourceCandidateInput("http://www.example.edu.tr/etkinlikler/")),
      repository.insertQuarantinedSourceCandidate(sourceCandidateInput("https://example.edu.tr/etkinlikler"))
    ]);
    expect(concurrentLeft.id).toBe(concurrentRight.id);
    expect(store.records).toHaveLength(3);

    const [legacyRegistryCandidate, approvedRegistryCandidate] = await Promise.all([
      repository.insertQuarantinedSourceCandidate(sourceCandidateInput("https://www.gtu.edu.tr/tr/icerik/9/30904/display.aspx")),
      repository.insertQuarantinedSourceCandidate(sourceCandidateInput("https://www.gtu.edu.tr/icerik/9/30904/display.aspx"))
    ]);
    expect(legacyRegistryCandidate.id).toBe(approvedRegistryCandidate.id);
    expect(store.records).toHaveLength(4);
  });

  it.each(["trusted", "rejected", "quarantined"] as const)(
    "leaves an existing Mongo %s source byte-for-byte unchanged when inserting its alias as a candidate",
    async (trustStatus) => {
      const store = new FakeAnnouncementSourceModel();
      const repository = new MongoAnnouncementRepository({} as never);
      Object.defineProperty(repository, "model", { value: async () => store });
      const existing = await repository.upsertSource({
        ...sourceInputWithoutTrust(),
        sourceUrl: "https://www.gtu.edu.tr/tr/icerik/9/30904/display.aspx",
        homepageUrl: "https://www.gtu.edu.tr/",
        status: trustStatus === "trusted" ? "active" : "inactive",
        trustStatus,
        ...(trustStatus === "trusted" ? {} : { trustReasonCodes: ["unofficial_source" as const] })
      });
      const before = JSON.stringify(existing);

      const returned = await repository.insertQuarantinedSourceCandidate(
        sourceCandidateInput("https://www.gtu.edu.tr/icerik/9/30904/display.aspx")
      );

      expect(JSON.stringify(returned)).toBe(before);
      expect(JSON.stringify(await repository.findSourceById(existing.id))).toBe(before);
      expect(store.records).toHaveLength(1);
    }
  );

  it("matches a validated source URL upgrade during generic upsert without resetting trust", async () => {
    const inMemory = new InMemoryAnnouncementRepository();
    const inMemoryLegacy = await inMemory.upsertSource({
      ...sourceInputWithoutTrust(),
      sourceUrl: "https://www.gtu.edu.tr/tr/icerik/9/30904/display.aspx",
      homepageUrl: "https://www.gtu.edu.tr/",
      status: "inactive",
      trustStatus: "rejected"
    });
    const inMemoryUpgrade = await inMemory.upsertSource({
      ...sourceInputWithoutTrust(),
      sourceUrl: "https://www.gtu.edu.tr/icerik/9/30904/display.aspx",
      homepageUrl: "https://www.gtu.edu.tr/",
      status: "inactive"
    });
    expect(inMemoryUpgrade).toEqual(expect.objectContaining({
      id: inMemoryLegacy.id,
      trustStatus: "rejected"
    }));

    const store = new FakeAnnouncementSourceModel();
    const mongo = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(mongo, "model", { value: async () => store });
    const mongoLegacy = await mongo.upsertSource({
      ...sourceInputWithoutTrust(),
      sourceUrl: "https://www.gtu.edu.tr/tr/icerik/9/30904/display.aspx",
      homepageUrl: "https://www.gtu.edu.tr/",
      status: "inactive",
      trustStatus: "rejected"
    });
    const mongoUpgrade = await mongo.upsertSource({
      ...sourceInputWithoutTrust(),
      sourceUrl: "https://www.gtu.edu.tr/icerik/9/30904/display.aspx",
      homepageUrl: "https://www.gtu.edu.tr/",
      status: "inactive"
    });
    expect(mongoUpgrade).toEqual(expect.objectContaining({
      id: mongoLegacy.id,
      trustStatus: "rejected"
    }));
    expect(store.records).toHaveLength(1);
  });
});

describe("announcement normalized persistence identity", () => {
  it("keeps a real in-memory ID across URL aliases and reports material and authoritative-empty deltas", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource(sourceInput());

    const first = await repository.replaceItemsForSource(source, [item(source, "parser-first", "bir")]);
    expect(first).toEqual(expect.objectContaining({
      created: [expect.objectContaining({ id: "parser-first", scopeId: source.scopeId })],
      materiallyUpdated: [],
      unchanged: [],
      removed: []
    }));
    const retry = await repository.replaceItemsForSource(source, [item(source, "parser-retry", "bir")]);
    expect(retry.materiallyUpdated.map((reference) => reference.id)).toEqual(["parser-first"]);
    expect(await repository.acknowledgeNotificationProduction(first.created)).toBe(1);

    const alias = await repository.replaceItemsForSource(source, [item(source, "parser-alias", "iki")]);
    expect(alias.unchanged).toEqual([expect.objectContaining({
      id: "parser-first",
      sourceId: source.id,
      scopeType: source.scopeType,
      scopeId: source.scopeId
    })]);
    expect((await repository.listItemsForSource(source.id))[0]).toEqual(expect.objectContaining({
      id: "parser-first",
      canonicalUrl: "https://www.example.edu.tr/duyuru/iki",
      canonicalUrlAliases: [
        "https://www.example.edu.tr/duyuru/bir",
        "https://www.example.edu.tr/duyuru/iki"
      ]
    }));

    const changed = await repository.replaceItemsForSource(source, [item(source, "parser-changed", "iki", "Düzeltilmiş özet")]);
    expect(changed.materiallyUpdated).toEqual([expect.objectContaining({ id: "parser-first" })]);

    expect(await repository.replaceItemsForSource(source, [])).toEqual({
      created: [], materiallyUpdated: [], unchanged: [], removed: []
    });
    expect(await repository.listItemsForSource(source.id)).toHaveLength(1);
    const retired = await repository.replaceItemsForSource(source, [], { authoritativeEmpty: true });
    expect(retired.removed).toEqual([expect.objectContaining({ id: "parser-first" })]);
    expect(await repository.listItemsForSource(source.id)).toEqual([]);
  });

  it("uses Mongo-assigned IDs with the same alias/update/removal delta semantics", async () => {
    const source = mongoSource();
    const store = new FakeAnnouncementItemModel();
    const repository = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(repository, "model", { value: async () => store });

    const first = await repository.replaceItemsForSource(source, [item(source, "parser-first", "bir")]);
    const persistedId = first.created[0]?.id;
    expect(persistedId).toBe("64f000000000000000000001");
    expect(persistedId).not.toBe("parser-first");
    const retry = await repository.replaceItemsForSource(source, [item(source, "parser-retry", "bir")]);
    expect(retry.materiallyUpdated.map((reference) => reference.id)).toEqual([persistedId]);
    expect(await repository.acknowledgeNotificationProduction(first.created)).toBe(1);

    const alias = await repository.replaceItemsForSource(source, [item(source, "parser-alias", "iki")]);
    expect(alias.unchanged.map((reference) => reference.id)).toEqual([persistedId]);
    expect(store.records[0]).toEqual(expect.objectContaining({
      canonicalUrlAliases: [
        "https://www.example.edu.tr/duyuru/bir",
        "https://www.example.edu.tr/duyuru/iki"
      ]
    }));

    const changed = await repository.replaceItemsForSource(source, [item(source, "parser-changed", "iki", "Düzeltilmiş özet")]);
    expect(changed.materiallyUpdated.map((reference) => reference.id)).toEqual([persistedId]);

    expect(await repository.replaceItemsForSource(source, [])).toEqual({
      created: [], materiallyUpdated: [], unchanged: [], removed: []
    });
    expect(store.records).toHaveLength(1);
    const retired = await repository.replaceItemsForSource(source, [], { authoritativeEmpty: true });
    expect(retired.removed.map((reference) => reference.id)).toEqual([persistedId]);
    expect(store.records).toEqual([]);
  });

  it("does not mark legacy rows without runtime eligibility for notification replay", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource(sourceInput());
    await repository.replaceItemsForSource(source, [item(source, "legacy-id", "legacy")]);
    const stored = (repository as unknown as { items: Map<string, AnnouncementItem[]> }).items.get(source.id)?.[0];
    expect(stored).toBeDefined();
    delete stored!.notificationEligibleFingerprint;
    delete stored!.notificationProducedFingerprint;

    const delta = await repository.replaceItemsForSource(source, [item(source, "new-parser-id", "legacy")]);
    expect(delta.unchanged.map((reference) => reference.id)).toEqual(["legacy-id"]);
    expect(delta.materiallyUpdated).toEqual([]);
  });
});

function sourceInput() {
  return {
    scopeType: "university" as const,
    scopeId: "university-1",
    sourceName: "Örnek Üniversitesi",
    sourceUrl: "https://www.example.edu.tr/duyurular",
    homepageUrl: "https://www.example.edu.tr/",
    contentType: "announcement" as const,
    parser: "auto" as const,
    priority: 20,
    status: "active" as const,
    trustStatus: "trusted" as const
  };
}

function sourceInputWithoutTrust() {
  const { trustStatus: _trustStatus, ...input } = sourceInput();
  void _trustStatus;
  return input;
}

function sourceCandidateInput(sourceUrl = "https://www.example.edu.tr/duyurular") {
  const { status: _status, ...input } = sourceInputWithoutTrust();
  void _status;
  return { ...input, sourceUrl, homepageUrl: new URL(sourceUrl).origin };
}

function mongoSource(): AnnouncementSourceRecord {
  const now = new Date("2026-08-04T08:00:00.000Z");
  return {
    ...sourceInput(),
    id: "source-1",
    canonicalUrl: "https://www.example.edu.tr/duyurular",
    trustStatus: "trusted",
    createdAt: now,
    updatedAt: now
  };
}

function item(
  source: AnnouncementSourceRecord,
  id: string,
  slug: string,
  summary = "Aynı özet"
): AnnouncementItem {
  return {
    id,
    sourceId: source.id,
    sourceName: source.sourceName,
    contentType: "announcement",
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    title: "Kayıt başvurusu duyurusu",
    summary,
    link: `https://www.example.edu.tr/duyuru/${slug}`,
    publicationKind: "date",
    publishedDate: "2026-08-04",
    publicationTimeSource: "source",
    fetchedAt: "2026-08-04T08:00:00.000Z",
    trustStatus: "trusted"
  };
}

class FakeDocument {
  constructor(readonly id: string, private readonly record: Record<string, unknown>) {}

  toObject(): Record<string, unknown> {
    return { _id: this.id, ...this.record };
  }
}

class FakeAnnouncementSourceModel {
  records: Array<Record<string, unknown> & { _id: string }> = [];
  private nextId = 1;

  async findById(id: string): Promise<FakeDocument | null> {
    const record = this.records.find((candidate) => candidate._id === id);
    return record ? new FakeDocument(record._id, record) : null;
  }

  async findOne(filter: Record<string, unknown>): Promise<FakeDocument | null> {
    const record = this.records.find((candidate) => Object.entries(filter).every(([key, value]) => candidate[key] === value));
    return record ? new FakeDocument(record._id, record) : null;
  }

  async find(filter: Record<string, unknown>): Promise<FakeDocument[]> {
    return this.records
      .filter((candidate) => Object.entries(filter).every(([key, value]) => candidate[key] === value))
      .map((candidate) => new FakeDocument(candidate._id, candidate));
  }

  async create(value: Record<string, unknown>, forcedId?: string): Promise<FakeDocument> {
    const _id = forcedId ?? `64e${String(this.nextId++).padStart(21, "0")}`;
    const now = new Date("2026-08-27T00:00:00.000Z");
    const stored = { ...value, _id, createdAt: now, updatedAt: now };
    this.records.push(stored);
    return new FakeDocument(_id, stored);
  }

  async findByIdAndUpdate(id: string, value: Record<string, unknown>): Promise<FakeDocument | null> {
    const index = this.records.findIndex((record) => record._id === id);
    if (index < 0) return null;
    const stored = { ...this.records[index]!, ...value, _id: id, updatedAt: new Date("2026-08-27T00:01:00.000Z") };
    this.records[index] = stored;
    return new FakeDocument(id, stored);
  }

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: { $setOnInsert?: Record<string, unknown> },
    options: { upsert?: boolean }
  ): Promise<FakeDocument | null> {
    const matches = (record: Record<string, unknown>) => Object.entries(filter).every(([key, value]) => {
      if (key === "$or") {
        return (value as Array<Record<string, unknown>>).some((branch) =>
          Object.entries(branch).every(([branchKey, branchValue]) => record[branchKey] === branchValue));
      }
      return record[key] === value;
    });
    const existing = this.records.find(matches);
    if (existing) return new FakeDocument(existing._id, existing);
    if (!options.upsert || !update.$setOnInsert) return null;
    return this.create(update.$setOnInsert, typeof filter._id === "string" ? filter._id : undefined);
  }
}

class FakeAnnouncementItemModel {
  records: Array<Record<string, unknown> & { _id: string }> = [];
  private nextId = 1;

  async find(filter: { sourceId?: string }): Promise<FakeDocument[]> {
    return this.records
      .filter((record) => !filter.sourceId || record.sourceId === filter.sourceId)
      .map((record) => new FakeDocument(record._id, record));
  }

  async create(value: Record<string, unknown>): Promise<FakeDocument> {
    const _id = `64f${String(this.nextId++).padStart(21, "0")}`;
    const { id: _parserId, ...record } = value;
    const stored = { ...record, _id };
    this.records.push(stored);
    return new FakeDocument(_id, stored);
  }

  async findByIdAndUpdate(id: string, value: Record<string, unknown>): Promise<FakeDocument | null> {
    const index = this.records.findIndex((record) => record._id === id);
    if (index < 0) return null;
    const { id: _parserId, ...update } = value;
    const stored = { ...this.records[index]!, ...update, _id: id };
    this.records[index] = stored;
    return new FakeDocument(id, stored);
  }

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: { $set?: Record<string, unknown> }
  ): Promise<FakeDocument | null> {
    const index = this.records.findIndex((record) => Object.entries(filter).every(([key, value]) =>
      (key === "_id" ? record._id : record[key]) === value));
    if (index < 0) return null;
    const stored = { ...this.records[index]!, ...(update.$set ?? {}) };
    this.records[index] = stored;
    return new FakeDocument(stored._id, stored);
  }

  async deleteMany(filter: { _id?: { $in?: string[] }; trustStatus?: string }): Promise<void> {
    const ids = new Set(filter._id?.$in ?? []);
    this.records = this.records.filter((record) =>
      !(ids.has(record._id) && (!filter.trustStatus || record.trustStatus === filter.trustStatus)));
  }
}
