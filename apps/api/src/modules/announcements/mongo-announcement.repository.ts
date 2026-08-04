import { Inject, Injectable } from "@nestjs/common";
import { isValidObjectId } from "mongoose";
import { announcementItemSchema, announcementSourceSchema } from "../../database/mongoose-schemas.js";
import { getModel, omitUndefined, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import { canonicalizeContentUrl, isOfficialContentUrl, normalizeDisplayText, officialDomainForUrl } from "./announcement-content-trust.js";
import { emptyAnnouncementPersistenceDelta, planAnnouncementReplacement, toPersistenceReference } from "./announcement-persistence.js";
import type { AnnouncementItem, AnnouncementPersistenceDelta, AnnouncementPersistenceReference, AnnouncementReplacementOptions, AnnouncementRepository, AnnouncementSourceRecord, AnnouncementSourceStatus, SourceCheckInput, UpsertAnnouncementSourceInput } from "./announcements.types.js";

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

  async replaceItemsForSource(source: AnnouncementSourceRecord, items: AnnouncementItem[], options: AnnouncementReplacementOptions = {}): Promise<AnnouncementPersistenceDelta> {
    const model = await this.model("AnnouncementItem", announcementItemSchema);
    const existingDocuments = await model.find({ sourceId: source.id });
    const existingItems = existingDocuments.map((document) => toDomainRecord<AnnouncementItem>(document));
    const plan = planAnnouncementReplacement(source, items, existingItems, options);
    if (plan.entries.length === 0 && plan.removed.length === 0) return emptyAnnouncementPersistenceDelta();
    const delta = emptyAnnouncementPersistenceDelta();
    const removedIds = plan.removed.map((item) => item.id);
    if (removedIds.length > 0) await model.deleteMany({ _id: { $in: removedIds }, trustStatus: "trusted" });

    for (const { item, previous, materiallyUpdated } of plan.entries) {
      const discoveredAt = previous?.discoveredAt ?? item.discoveredAt ?? item.fetchedAt;
      const persisted: AnnouncementItem = {
        ...item,
        id: previous?.id ?? item.id,
        sourceId: source.id,
        sourceName: source.sourceName,
        officialSourceUrl: source.canonicalUrl ?? source.sourceUrl,
        contentType: item.contentType ?? source.contentType ?? "announcement",
        scopeType: source.scopeType,
        scopeId: source.scopeId,
        ...(discoveredAt ? { discoveredAt } : {})
      };
      let persistedId: string;
      if (previous) {
        const updated = await model.findByIdAndUpdate(previous.id, omitUndefined(persisted as unknown as Record<string, unknown>), { new: true });
        if (!updated) throw new Error("ANNOUNCEMENT_ITEM_UPDATE_FAILED");
        persistedId = updated.id;
      } else {
        const created = await model.create(omitUndefined(persisted as unknown as Record<string, unknown>));
        persistedId = created.id;
      }
      const reference = toPersistenceReference(persisted, persistedId);
      if (!reference) continue;
      if (!previous) delta.created.push(reference);
      else if (materiallyUpdated) delta.materiallyUpdated.push(reference);
      else delta.unchanged.push(reference);
    }
    for (const removed of plan.removed) {
      const reference = toPersistenceReference(removed);
      if (reference) delta.removed.push(reference);
    }
    return delta;
  }

  async acknowledgeNotificationProduction(references: readonly AnnouncementPersistenceReference[]): Promise<number> {
    const model = await this.model("AnnouncementItem", announcementItemSchema);
    let acknowledged = 0;
    const visited = new Set<string>();
    for (const reference of references) {
      const key = `${reference.sourceId}\u0000${reference.id}\u0000${reference.contentFingerprint}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const document = await model.findOneAndUpdate({
        _id: reference.id,
        sourceId: reference.sourceId,
        scopeType: reference.scopeType,
        scopeId: reference.scopeId,
        contentFingerprint: reference.contentFingerprint,
        notificationEligibleFingerprint: reference.contentFingerprint
      }, {
        $set: { notificationProducedFingerprint: reference.contentFingerprint }
      });
      if (document) acknowledged += 1;
    }
    return acknowledged;
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

  async findTrustedItemByIdInScope(input: {
    announcementId: string;
    universityId: string;
    facultyId?: string;
    departmentId?: string;
  }): Promise<{ item: AnnouncementItem; source: AnnouncementSourceRecord } | null> {
    if (!isValidObjectId(input.announcementId)) return null;
    const matchers: Array<Record<string, string>> = [{ scopeType: "university", scopeId: input.universityId }];
    if (input.facultyId) matchers.push({ scopeType: "faculty", scopeId: input.facultyId });
    if (input.departmentId) matchers.push({ scopeType: "department", scopeId: input.departmentId });

    const sources = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", trustStatus: "trusted", $or: matchers });
    if (sources.length === 0) return null;
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const document = await (await this.model("AnnouncementItem", announcementItemSchema)).findOne({
      _id: input.announcementId,
      sourceId: { $in: [...sourceById.keys()] },
      trustStatus: "trusted"
    });
    if (!document) return null;
    const item = toDomainRecord<AnnouncementItem>(document);
    const sourceDocument = sourceById.get(item.sourceId);
    return sourceDocument
      ? { item, source: toDomainRecord<AnnouncementSourceRecord>(sourceDocument) }
      : null;
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
