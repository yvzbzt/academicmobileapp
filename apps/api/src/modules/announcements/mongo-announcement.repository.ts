import { Inject, Injectable } from "@nestjs/common";
import { announcementItemSchema, announcementSourceSchema } from "../../database/mongoose-schemas.js";
import { getModel, omitUndefined, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import { canonicalContentKey, canonicalizeContentUrl, isOfficialContentUrl, normalizeDisplayText, normalizeTrustedItemsForSource, officialDomainForUrl } from "./announcement-content-trust.js";
import type { AnnouncementItem, AnnouncementRepository, AnnouncementSourceRecord, AnnouncementSourceStatus, SourceCheckInput, UpsertAnnouncementSourceInput } from "./announcements.types.js";

@Injectable()
export class MongoAnnouncementRepository implements AnnouncementRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]> {
    const matchers: Array<Record<string, string>> = [{ scopeType: "university", scopeId: input.universityId }];
    if (input.facultyId) matchers.push({ scopeType: "faculty", scopeId: input.facultyId });
    if (input.departmentId) matchers.push({ scopeType: "department", scopeId: input.departmentId });

    const documents = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", trustStatus: "trusted", $or: matchers })
      .sort({ priority: -1, updatedAt: -1 });

    return documents.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
  }

  async listAllSources(input: { status?: AnnouncementSourceStatus; limit?: number; offset?: number } = {}): Promise<AnnouncementSourceRecord[]> {
    const documents = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find(input.status === "active"
        ? { status: "active", trustStatus: "trusted" }
        : input.status ? { status: input.status } : {})
      .sort({ priority: -1, sourceName: 1 })
      .skip(input.offset ?? 0)
      .limit(input.limit ?? 500);

    return documents.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
  }

  async upsertSource(input: UpsertAnnouncementSourceInput): Promise<AnnouncementSourceRecord> {
    const model = await this.model("AnnouncementSource", announcementSourceSchema);
    const canonicalUrl = canonicalizeContentUrl(input.sourceUrl);
    if (!canonicalUrl || !officialDomainForUrl(canonicalUrl)) throw new Error("ANNOUNCEMENT_SOURCE_URL_NOT_OFFICIAL");
    const homepageUrl = input.homepageUrl ? canonicalizeContentUrl(input.homepageUrl) : undefined;
    if (input.homepageUrl && (!homepageUrl || !isOfficialContentUrl(canonicalUrl, homepageUrl))) throw new Error("ANNOUNCEMENT_SOURCE_DOMAIN_MISMATCH");
    const normalizedInput = {
      ...input,
      sourceName: normalizeDisplayText(input.sourceName, 160) || "Resmî akademik kaynak",
      sourceUrl: canonicalUrl,
      canonicalUrl,
      ...(homepageUrl ? { homepageUrl } : {}),
      ...(input.trustStatus ? { trustStatus: input.trustStatus } : {})
    };
    let existing = input.id ? await model.findById(input.id) : null;
    if (!existing) existing = await model.findOne({ scopeType: input.scopeType, scopeId: input.scopeId, sourceUrl: canonicalUrl });
    if (!existing) existing = await model.findOne({ scopeType: input.scopeType, scopeId: input.scopeId, canonicalUrl });
    if (!existing && input.sourceUrl !== canonicalUrl) {
      existing = await model.findOne({ scopeType: input.scopeType, scopeId: input.scopeId, sourceUrl: input.sourceUrl });
    }
    const document = existing
      ? await model.findByIdAndUpdate(existing.id, omitUndefined(normalizedInput as unknown as Record<string, unknown>), { new: true })
      : await model.create({ ...normalizedInput, trustStatus: input.trustStatus ?? "trusted", discoveredAt: input.discoveredAt ?? new Date() });
    if (!document) throw new Error("ANNOUNCEMENT_SOURCE_UPSERT_FAILED");
    return toDomainRecord<AnnouncementSourceRecord>(document);
  }

  async recordSourceCheck(id: string, input: SourceCheckInput): Promise<AnnouncementSourceRecord | null> {
    const document = await (await this.model("AnnouncementSource", announcementSourceSchema)).findByIdAndUpdate(id, omitUndefined(input as unknown as Record<string, unknown>), { new: true });
    return document ? toDomainRecord<AnnouncementSourceRecord>(document) : null;
  }

  async replaceItemsForSource(source: AnnouncementSourceRecord, items: AnnouncementItem[]): Promise<void> {
    const trustedItems = normalizeTrustedItemsForSource(source, items);
    if (trustedItems.length === 0) return;
    const model = await this.model("AnnouncementItem", announcementItemSchema);
    const existingDocuments = await model.find({ sourceId: source.id });
    const existingByCanonicalKey = new Map<string, Array<{ document: (typeof existingDocuments)[number]; record: AnnouncementItem & { createdAt?: Date } }>>();
    for (const document of existingDocuments) {
      const record = toDomainRecord<AnnouncementItem & { createdAt?: Date }>(document);
      const key = canonicalContentKey(record.canonicalUrl ?? record.link);
      if (key) existingByCanonicalKey.set(key, [...(existingByCanonicalKey.get(key) ?? []), { document, record }]);
    }
    const selectedPreviousByKey = new Map<string, { document: (typeof existingDocuments)[number]; record: AnnouncementItem & { createdAt?: Date } }>();
    for (const item of trustedItems) {
      const key = canonicalContentKey(item.canonicalUrl ?? item.link);
      if (!key || selectedPreviousByKey.has(key)) continue;
      const canonicalUrl = canonicalizeContentUrl(item.canonicalUrl ?? item.link);
      const candidates = existingByCanonicalKey.get(key) ?? [];
      candidates.sort((left, right) => Number(right.record.link === canonicalUrl) - Number(left.record.link === canonicalUrl)
        || (left.record.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.record.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
        || left.document.id.localeCompare(right.document.id, "en-US"));
      const selected = candidates[0];
      if (selected) selectedPreviousByKey.set(key, selected);
    }
    const obsoleteAliasIds = [...selectedPreviousByKey.entries()].flatMap(([key, selected]) =>
      (existingByCanonicalKey.get(key) ?? []).filter((candidate) => candidate.document.id !== selected.document.id).map((candidate) => candidate.document.id));
    if (obsoleteAliasIds.length > 0) await model.deleteMany({ _id: { $in: obsoleteAliasIds } });
    const retainedDocumentIds: string[] = [];

    for (const item of trustedItems) {
      const key = canonicalContentKey(item.canonicalUrl ?? item.link);
      const previous = key ? selectedPreviousByKey.get(key) : undefined;
      const persisted = {
        ...item,
        sourceId: source.id,
        sourceName: source.sourceName,
        officialSourceUrl: source.canonicalUrl ?? source.sourceUrl,
        contentType: item.contentType ?? source.contentType ?? "announcement",
        scopeType: source.scopeType,
        scopeId: source.scopeId,
        discoveredAt: previous?.record.discoveredAt ?? previous?.record.createdAt?.toISOString() ?? item.discoveredAt ?? item.fetchedAt
      };
      if (previous) {
        await model.findByIdAndUpdate(previous.document.id, omitUndefined(persisted as unknown as Record<string, unknown>));
        retainedDocumentIds.push(previous.document.id);
      } else {
        const created = await model.create(persisted);
        retainedDocumentIds.push(created.id);
      }
    }

    await model.deleteMany({ sourceId: source.id, ...(retainedDocumentIds.length > 0 ? { _id: { $nin: retainedDocumentIds } } : {}) });
  }

  async listItemsForSource(sourceId: string, limit = 1_000): Promise<AnnouncementItem[]> {
    const source = await (await this.model("AnnouncementSource", announcementSourceSchema)).findOne({
      _id: sourceId,
      status: "active",
      trustStatus: "trusted"
    });
    if (!source) return [];
    const documents = await (await this.model("AnnouncementItem", announcementItemSchema))
      .find({ sourceId, trustStatus: "trusted" })
      .sort({ discoveredAt: -1, sourceUpdatedAt: -1, publishedAt: -1 })
      .limit(limit);
    return documents.map((document) => toDomainRecord<AnnouncementItem>(document));
  }

  async listItemsByScope(input: { universityId: string; facultyId?: string; departmentId?: string; limit: number }): Promise<AnnouncementItem[]> {
    const matchers: Array<Record<string, string>> = [{ scopeType: "university", scopeId: input.universityId }];
    if (input.facultyId) matchers.push({ scopeType: "faculty", scopeId: input.facultyId });
    if (input.departmentId) matchers.push({ scopeType: "department", scopeId: input.departmentId });
    const sources = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", trustStatus: "trusted", $or: matchers });
    const sourceIds = sources.map((source) => source.id);
    if (sourceIds.length === 0) return [];
    const documents = await (await this.model("AnnouncementItem", announcementItemSchema))
      .find({ sourceId: { $in: sourceIds }, trustStatus: "trusted" })
      .sort({ discoveredAt: -1, sourceUpdatedAt: -1, publishedAt: -1 })
      .limit(input.limit);
    return documents.map((document) => toDomainRecord<AnnouncementItem>(document));
  }

  async listAllItems(input: { limit?: number; offset?: number } = {}): Promise<AnnouncementItem[]> {
    const activeSources = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", trustStatus: "trusted" });
    const sourceIds = activeSources.map((source) => source.id);
    if (sourceIds.length === 0) return [];
    const documents = await (await this.model("AnnouncementItem", announcementItemSchema))
      .find({ sourceId: { $in: sourceIds }, trustStatus: "trusted" })
      .sort({ discoveredAt: -1, sourceUpdatedAt: -1, publishedAt: -1 })
      .skip(input.offset ?? 0)
      .limit(input.limit ?? 1000);
    return documents.map((document) => toDomainRecord<AnnouncementItem>(document));
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}
