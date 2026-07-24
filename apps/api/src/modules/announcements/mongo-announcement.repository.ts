import { Inject, Injectable } from "@nestjs/common";
import { announcementItemSchema, announcementSourceSchema } from "../../database/mongoose-schemas.js";
import { getModel, omitUndefined, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import type { AnnouncementItem, AnnouncementRepository, AnnouncementSourceRecord, AnnouncementSourceStatus, SourceCheckInput, UpsertAnnouncementSourceInput } from "./announcements.types.js";

@Injectable()
export class MongoAnnouncementRepository implements AnnouncementRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]> {
    const matchers: Array<Record<string, string>> = [{ scopeType: "university", scopeId: input.universityId }];
    if (input.facultyId) matchers.push({ scopeType: "faculty", scopeId: input.facultyId });
    if (input.departmentId) matchers.push({ scopeType: "department", scopeId: input.departmentId });

    const documents = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", $or: matchers })
      .sort({ priority: -1, updatedAt: -1 });

    return documents.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
  }

  async listAllSources(input: { status?: AnnouncementSourceStatus; limit?: number; offset?: number } = {}): Promise<AnnouncementSourceRecord[]> {
    const documents = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find(input.status ? { status: input.status } : {})
      .sort({ priority: -1, sourceName: 1 })
      .skip(input.offset ?? 0)
      .limit(input.limit ?? 500);

    return documents.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
  }

  async upsertSource(input: UpsertAnnouncementSourceInput): Promise<AnnouncementSourceRecord> {
    const model = await this.model("AnnouncementSource", announcementSourceSchema);
    const existing = input.id
      ? await model.findById(input.id)
      : await model.findOne({ scopeType: input.scopeType, scopeId: input.scopeId, sourceUrl: input.sourceUrl });
    const document = existing
      ? await model.findByIdAndUpdate(existing.id, omitUndefined(input as unknown as Record<string, unknown>), { new: true })
      : await model.create(input);
    if (!document) throw new Error("ANNOUNCEMENT_SOURCE_UPSERT_FAILED");
    return toDomainRecord<AnnouncementSourceRecord>(document);
  }

  async recordSourceCheck(id: string, input: SourceCheckInput): Promise<AnnouncementSourceRecord | null> {
    const document = await (await this.model("AnnouncementSource", announcementSourceSchema)).findByIdAndUpdate(id, omitUndefined(input as unknown as Record<string, unknown>), { new: true });
    return document ? toDomainRecord<AnnouncementSourceRecord>(document) : null;
  }

  async replaceItemsForSource(source: AnnouncementSourceRecord, items: AnnouncementItem[]): Promise<void> {
    const model = await this.model("AnnouncementItem", announcementItemSchema);
    await model.deleteMany({ sourceId: source.id });
    if (items.length > 0) {
      await model.insertMany(items.map((item) => ({ ...item, sourceId: source.id, sourceName: source.sourceName, contentType: item.contentType ?? source.contentType ?? "announcement", scopeType: source.scopeType, scopeId: source.scopeId })));
    }
  }

  async listItemsByScope(input: { universityId: string; facultyId?: string; departmentId?: string; limit: number }): Promise<AnnouncementItem[]> {
    const matchers: Array<Record<string, string>> = [{ scopeType: "university", scopeId: input.universityId }];
    if (input.facultyId) matchers.push({ scopeType: "faculty", scopeId: input.facultyId });
    if (input.departmentId) matchers.push({ scopeType: "department", scopeId: input.departmentId });
    const documents = await (await this.model("AnnouncementItem", announcementItemSchema))
      .find({ $or: matchers })
      .sort({ publishedAt: -1, fetchedAt: -1 })
      .limit(input.limit);
    return documents.map((document) => toDomainRecord<AnnouncementItem>(document));
  }

  async listAllItems(input: { limit?: number; offset?: number } = {}): Promise<AnnouncementItem[]> {
    const documents = await (await this.model("AnnouncementItem", announcementItemSchema))
      .find({})
      .sort({ publishedAt: -1, fetchedAt: -1 })
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
