import { Inject, Injectable } from "@nestjs/common";
import type { CollectionReference, DocumentData } from "firebase-admin/firestore";
import { FirestoreDatabaseService } from "../../database/firestore.service.js";
import { cleanFirestoreData, getAllFirestoreRecords, newFirestoreId, toFirestoreRecord } from "../../database/firestore-utils.js";
import type { AnnouncementItem, AnnouncementRepository, AnnouncementSourceRecord, AnnouncementSourceStatus, SourceCheckInput, UpsertAnnouncementSourceInput } from "./announcements.types.js";

@Injectable()
export class FirestoreAnnouncementRepository implements AnnouncementRepository {
  constructor(@Inject(FirestoreDatabaseService) private readonly firestore: FirestoreDatabaseService) {}

  async listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]> {
    return (await getAllFirestoreRecords<AnnouncementSourceRecord>(this.sources.where("status", "==", "active")))
      .filter((source) => {
        if (source.scopeType === "university") return source.scopeId === input.universityId;
        if (source.scopeType === "faculty") return Boolean(input.facultyId && source.scopeId === input.facultyId);
        return Boolean(input.departmentId && source.scopeId === input.departmentId);
      })
      .sort((left, right) => right.priority - left.priority);
  }

  async listAllSources(input: { status?: AnnouncementSourceStatus; limit?: number; offset?: number } = {}): Promise<AnnouncementSourceRecord[]> {
    const records = input.status ? await getAllFirestoreRecords<AnnouncementSourceRecord>(this.sources.where("status", "==", input.status)) : await getAllFirestoreRecords<AnnouncementSourceRecord>(this.sources);
    return records
      .sort((left, right) => right.priority - left.priority || left.sourceName.localeCompare(right.sourceName, "tr-TR"))
      .slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 500));
  }

  async upsertSource(input: UpsertAnnouncementSourceInput): Promise<AnnouncementSourceRecord> {
    const duplicate = (await getAllFirestoreRecords<AnnouncementSourceRecord>(this.sources.where("scopeType", "==", input.scopeType).where("scopeId", "==", input.scopeId))).find((source) => source.sourceUrl === input.sourceUrl);
    const id = input.id ?? duplicate?.id ?? newFirestoreId();
    const existing = toFirestoreRecord<AnnouncementSourceRecord>(await this.sources.doc(id).get());
    const now = new Date();
    const source: AnnouncementSourceRecord = { ...existing, ...input, id, createdAt: existing?.createdAt ?? now, updatedAt: now };
    await this.sources.doc(id).set(cleanFirestoreData(source as unknown as Record<string, unknown>), { merge: false });
    return source;
  }

  async recordSourceCheck(id: string, input: SourceCheckInput): Promise<AnnouncementSourceRecord | null> {
    const existing = toFirestoreRecord<AnnouncementSourceRecord>(await this.sources.doc(id).get());
    if (!existing) return null;
    const updated: AnnouncementSourceRecord = { ...existing, ...input, updatedAt: new Date() };
    await this.sources.doc(id).set(cleanFirestoreData(updated as unknown as Record<string, unknown>), { merge: false });
    return updated;
  }

  async replaceItemsForSource(source: AnnouncementSourceRecord, items: AnnouncementItem[]): Promise<void> {
    const existingItems = await getAllFirestoreRecords<AnnouncementItem>(this.items.where("sourceId", "==", source.id));
    const batch = this.firestore.getDb().batch();
    for (const item of existingItems) batch.delete(this.items.doc(item.id));
    for (const item of items) batch.set(this.items.doc(item.id), cleanFirestoreData(item as unknown as Record<string, unknown>));
    await batch.commit();
  }

  async listItemsByScope(input: { universityId: string; facultyId?: string; departmentId?: string; limit: number }): Promise<AnnouncementItem[]> {
    const sourceIds = new Set((await this.listSourcesByScope(input)).map((source) => source.id));
    if (sourceIds.size === 0) return [];
    return (await getAllFirestoreRecords<AnnouncementItem>(this.items))
      .filter((item) => sourceIds.has(item.sourceId))
      .sort(compareAnnouncementItems)
      .slice(0, input.limit);
  }

  async listAllItems(input: { limit?: number; offset?: number } = {}): Promise<AnnouncementItem[]> {
    return (await getAllFirestoreRecords<AnnouncementItem>(this.items))
      .sort(compareAnnouncementItems)
      .slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 1000));
  }

  private get sources(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("announcement_sources");
  }

  private get items(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("announcement_items");
  }
}

function compareAnnouncementItems(left: AnnouncementItem, right: AnnouncementItem): number {
  const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : left.fetchedAt ? Date.parse(left.fetchedAt) : 0;
  const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : right.fetchedAt ? Date.parse(right.fetchedAt) : 0;
  return rightTime - leftTime;
}
