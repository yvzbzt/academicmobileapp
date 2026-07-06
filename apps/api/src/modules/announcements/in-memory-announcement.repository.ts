import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AnnouncementItem, AnnouncementRepository, AnnouncementSourceRecord, AnnouncementSourceStatus, SourceCheckInput, UpsertAnnouncementSourceInput } from "./announcements.types.js";

@Injectable()
export class InMemoryAnnouncementRepository implements AnnouncementRepository {
  private readonly sources = new Map<string, AnnouncementSourceRecord>();
  private readonly items = new Map<string, AnnouncementItem[]>();

  constructor() {}

  async listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]> {
    return [...this.sources.values()]
      .filter((source) => source.status === "active")
      .filter((source) => {
        if (source.scopeType === "university") return source.scopeId === input.universityId;
        if (source.scopeType === "faculty") return Boolean(input.facultyId && source.scopeId === input.facultyId);
        return Boolean(input.departmentId && source.scopeId === input.departmentId);
      })
      .sort((left, right) => right.priority - left.priority);
  }

  async listAllSources(input: { status?: AnnouncementSourceStatus; limit?: number; offset?: number } = {}): Promise<AnnouncementSourceRecord[]> {
    return [...this.sources.values()]
      .filter((source) => (input.status ? source.status === input.status : true))
      .sort((left, right) => right.priority - left.priority || left.sourceName.localeCompare(right.sourceName, "tr-TR"))
      .slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 500));
  }

  async upsertSource(input: UpsertAnnouncementSourceInput): Promise<AnnouncementSourceRecord> {
    const duplicate = [...this.sources.values()].find((source) => source.scopeType === input.scopeType && source.scopeId === input.scopeId && source.sourceUrl === input.sourceUrl);
    const id = input.id ?? duplicate?.id ?? randomUUID();
    const now = new Date();
    const existing = this.sources.get(id);
    const source: AnnouncementSourceRecord = {
      ...existing,
      ...input,
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.sources.set(id, source);
    return source;
  }

  async recordSourceCheck(id: string, input: SourceCheckInput): Promise<AnnouncementSourceRecord | null> {
    const existing = this.sources.get(id);
    if (!existing) return null;
    const updated: AnnouncementSourceRecord = { ...existing, ...input, updatedAt: new Date() };
    this.sources.set(id, updated);
    return updated;
  }

  async replaceItemsForSource(source: AnnouncementSourceRecord, items: AnnouncementItem[]): Promise<void> {
    this.items.set(source.id, items.map((item) => ({ ...item, sourceId: source.id, sourceName: source.sourceName, scopeType: source.scopeType, scopeId: source.scopeId })));
  }

  async listItemsByScope(input: { universityId: string; facultyId?: string; departmentId?: string; limit: number }): Promise<AnnouncementItem[]> {
    const sourceIds = new Set((await this.listSourcesByScope(input)).map((source) => source.id));
    return [...this.items.entries()]
      .filter(([sourceId]) => sourceIds.has(sourceId))
      .flatMap(([, sourceItems]) => sourceItems)
      .sort(compareAnnouncementItems)
      .slice(0, input.limit);
  }

  async listAllItems(input: { limit?: number; offset?: number } = {}): Promise<AnnouncementItem[]> {
    return [...this.items.values()]
      .flat()
      .sort(compareAnnouncementItems)
      .slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 1000));
  }
}

function compareAnnouncementItems(left: AnnouncementItem, right: AnnouncementItem): number {
  const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : left.fetchedAt ? Date.parse(left.fetchedAt) : 0;
  const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : right.fetchedAt ? Date.parse(right.fetchedAt) : 0;
  return rightTime - leftTime;
}
