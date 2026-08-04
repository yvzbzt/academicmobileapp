import { describe, expect, it } from "vitest";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { MongoAnnouncementRepository } from "../src/modules/announcements/mongo-announcement.repository.js";
import type { AnnouncementItem, AnnouncementSourceRecord } from "../src/modules/announcements/announcements.types.js";

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
    status: "active" as const
  };
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
