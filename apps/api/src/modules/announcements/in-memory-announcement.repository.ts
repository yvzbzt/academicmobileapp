import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { canonicalAnnouncementSourceIdentityKey, canonicalizeContentUrl, createAnnouncementSourceCandidateId, isOfficialContentUrl, normalizeDisplayText, officialDomainForUrl } from "./announcement-content-trust.js";
import { emptyAnnouncementPersistenceDelta, planAnnouncementReplacement, toPersistenceReference } from "./announcement-persistence.js";
import type { AnnouncementItem, AnnouncementPersistenceDelta, AnnouncementPersistenceReference, AnnouncementReplacementOptions, AnnouncementRepository, AnnouncementSourceCandidateInput, AnnouncementSourceDefinitionFence, AnnouncementSourceRecord, AnnouncementSourceScope, AnnouncementSourceStatus, AnnouncementTrustReason, SavedAnnouncementRecord, SourceCheckInput, UpsertAnnouncementSourceInput } from "./announcements.types.js";

@Injectable()
export class InMemoryAnnouncementRepository implements AnnouncementRepository {
  private readonly sources = new Map<string, AnnouncementSourceRecord>();
  private readonly items = new Map<string, AnnouncementItem[]>();
  private readonly savedAnnouncements = new Map<string, SavedAnnouncementRecord>();

  constructor() {}

  async listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]> {
    return [...this.sources.values()]
      .filter((source) => source.status === "active")
      .filter((source) => source.trustStatus === "trusted")
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
      .filter((source) => input.status !== "active" || source.trustStatus === "trusted")
      .sort((left, right) => right.priority - left.priority || left.sourceName.localeCompare(right.sourceName, "tr-TR"))
      .slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 500));
  }

  async listSourcesByScopeSet(input: {
    scopes: AnnouncementSourceScope[];
    status?: AnnouncementSourceStatus;
    limit: number;
    offset: number;
  }): Promise<AnnouncementSourceRecord[]> {
    const scopeKeys = new Set(input.scopes.map((scope) => `${scope.scopeType}\u0000${scope.scopeId}`));
    return [...this.sources.values()]
      .filter((source) => scopeKeys.has(`${source.scopeType}\u0000${source.scopeId}`))
      .filter((source) => (input.status ? source.status === input.status : true))
      .filter((source) => input.status !== "active" || source.trustStatus === "trusted")
      .sort((left, right) => right.priority - left.priority || left.sourceName.localeCompare(right.sourceName, "tr-TR"))
      .slice(input.offset, input.offset + input.limit);
  }

  async findSourceById(id: string): Promise<AnnouncementSourceRecord | null> {
    return this.sources.get(id) ?? null;
  }

  async upsertSource(input: UpsertAnnouncementSourceInput): Promise<AnnouncementSourceRecord> {
    const canonicalUrl = canonicalizeContentUrl(input.sourceUrl);
    if (!canonicalUrl || !officialDomainForUrl(canonicalUrl)) throw new Error("ANNOUNCEMENT_SOURCE_URL_NOT_OFFICIAL");
    const homepageUrl = input.homepageUrl ? canonicalizeContentUrl(input.homepageUrl) : undefined;
    if (input.homepageUrl && !homepageUrl) throw new Error("ANNOUNCEMENT_SOURCE_HOMEPAGE_URL_INVALID");
    if (
      homepageUrl
      && (input.status === "active" || input.trustStatus === "trusted")
      && !isOfficialContentUrl(canonicalUrl, homepageUrl)
    ) throw new Error("ANNOUNCEMENT_SOURCE_DOMAIN_MISMATCH");
    const identityKey = canonicalAnnouncementSourceIdentityKey(canonicalUrl);
    const duplicate = [...this.sources.values()].find((source) => source.scopeType === input.scopeType
      && source.scopeId === input.scopeId
      && canonicalAnnouncementSourceIdentityKey(source.canonicalUrl ?? source.sourceUrl) === identityKey);
    const id = input.id ?? duplicate?.id ?? randomUUID();
    const now = new Date();
    const existing = this.sources.get(id);
    const processingDefinitionChanged = existing
      ? hasProcessingDefinitionChanged(existing, {
          sourceUrl: canonicalUrl,
          parser: input.parser,
          contentType: input.contentType
        })
      : false;
    const reactivated = existing ? isReactivatedTrustedSource(existing, input) : false;
    const source: AnnouncementSourceRecord = {
      ...existing,
      ...input,
      sourceName: normalizeDisplayText(input.sourceName, 160) || "Resmî akademik kaynak",
      sourceUrl: canonicalUrl,
      canonicalUrl,
      ...(homepageUrl ? { homepageUrl } : {}),
      discoveredAt: existing?.discoveredAt ?? input.discoveredAt ?? existing?.createdAt ?? now,
      trustStatus: input.trustStatus ?? existing?.trustStatus ?? "quarantined",
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    delete source.activeSnapshotId;
    if (existing?.activeSnapshotId !== undefined) source.activeSnapshotId = existing.activeSnapshotId;
    delete source.sourceDefinitionVersion;
    if (!existing || processingDefinitionChanged) source.sourceDefinitionVersion = randomUUID();
    else if (existing.sourceDefinitionVersion !== undefined) source.sourceDefinitionVersion = existing.sourceDefinitionVersion;
    delete source.notificationProducerVersion;
    if (!existing || reactivated) source.notificationProducerVersion = randomUUID();
    else if (existing.notificationProducerVersion !== undefined) {
      source.notificationProducerVersion = existing.notificationProducerVersion;
    }
    if (processingDefinitionChanged) clearSourceValidators(source);
    this.sources.set(id, source);
    return source;
  }

  async insertQuarantinedSourceCandidate(input: AnnouncementSourceCandidateInput): Promise<AnnouncementSourceRecord> {
    const canonicalUrl = canonicalizeContentUrl(input.sourceUrl);
    if (!canonicalUrl || !officialDomainForUrl(canonicalUrl)) throw new Error("ANNOUNCEMENT_SOURCE_URL_NOT_OFFICIAL");
    const homepageUrl = input.homepageUrl ? canonicalizeContentUrl(input.homepageUrl) : undefined;
    if (input.homepageUrl && !homepageUrl) throw new Error("ANNOUNCEMENT_SOURCE_HOMEPAGE_URL_INVALID");
    const identityKey = canonicalAnnouncementSourceIdentityKey(canonicalUrl);
    const candidateId = createAnnouncementSourceCandidateId({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      sourceUrl: canonicalUrl
    });
    if (!identityKey || !candidateId) throw new Error("ANNOUNCEMENT_SOURCE_CANDIDATE_ID_INVALID");
    const existing = [...this.sources.values()].find((source) =>
      source.scopeType === input.scopeType
      && source.scopeId === input.scopeId
      && canonicalAnnouncementSourceIdentityKey(source.canonicalUrl ?? source.sourceUrl) === identityKey);
    if (existing) return existing;
    return this.upsertSource({
      ...input,
      id: candidateId,
      sourceUrl: canonicalUrl,
      ...(homepageUrl ? { homepageUrl } : {}),
      status: "inactive",
      trustStatus: "quarantined"
    });
  }

  async recordSourceCheck(
    id: string,
    input: SourceCheckInput,
    expectedDefinition?: AnnouncementSourceDefinitionFence,
    expectedActiveSnapshotId?: string | null
  ): Promise<AnnouncementSourceRecord | null> {
    const existing = this.sources.get(id);
    if (!existing) return null;
    if (expectedDefinition && !sameSourceDefinition(existing, expectedDefinition)) return null;
    if (
      expectedActiveSnapshotId !== undefined
      && normalizedSnapshotId(existing.activeSnapshotId) !== normalizedSnapshotId(expectedActiveSnapshotId ?? undefined)
    ) return null;
    const updated: AnnouncementSourceRecord = { ...existing, ...input, updatedAt: new Date() };
    if (input.healthStatus === "healthy") delete updated.lastError;
    this.sources.set(id, updated);
    return updated;
  }

  async quarantineSource(
    id: string,
    reasonCodes: AnnouncementTrustReason[],
    expectedDefinition?: AnnouncementSourceDefinitionFence
  ): Promise<AnnouncementSourceRecord | null> {
    const existing = this.sources.get(id);
    if (!existing) return null;
    if (expectedDefinition && !sameSourceDefinition(existing, expectedDefinition)) return null;
    const updated: AnnouncementSourceRecord = {
      ...existing,
      status: "inactive",
      trustStatus: "quarantined",
      trustReasonCodes: [...new Set([...(existing.trustReasonCodes ?? []), ...reasonCodes])].sort(),
      updatedAt: new Date()
    };
    this.sources.set(id, updated);
    return updated;
  }

  async deactivateSource(id: string): Promise<AnnouncementSourceRecord | null> {
    const existing = this.sources.get(id);
    if (!existing) return null;
    const updated = { ...existing, status: "inactive" as const, updatedAt: new Date() };
    this.sources.set(id, updated);
    return updated;
  }

  async replaceItemsForSource(source: AnnouncementSourceRecord, items: AnnouncementItem[], options: AnnouncementReplacementOptions = {}): Promise<AnnouncementPersistenceDelta> {
    const currentSource = this.sources.get(source.id);
    if (!currentSource || currentSource.status !== "active" || currentSource.trustStatus !== "trusted") {
      throw new Error("ANNOUNCEMENT_SNAPSHOT_SOURCE_NOT_ACTIVE");
    }
    if (!sameSourceDefinition(currentSource, source)) throw new Error("ANNOUNCEMENT_SOURCE_DEFINITION_CHANGED");
    const existing = this.items.get(source.id) ?? [];
    const plan = planAnnouncementReplacement(currentSource, items, existing, options);
    if (plan.entries.length === 0 && plan.removed.length === 0) return emptyAnnouncementPersistenceDelta();
    const delta = emptyAnnouncementPersistenceDelta();
    const persistedItems = plan.entries.map(({ item, previous, materiallyUpdated }) => {
      const discoveredAt = previous?.discoveredAt ?? item.discoveredAt ?? item.fetchedAt;
      const persisted: AnnouncementItem = {
        ...item,
        id: previous?.id ?? item.id,
        sourceId: source.id,
        sourceName: currentSource.sourceName,
        officialSourceUrl: currentSource.canonicalUrl ?? currentSource.sourceUrl,
        contentType: item.contentType ?? currentSource.contentType ?? "announcement",
        scopeType: currentSource.scopeType,
        scopeId: currentSource.scopeId,
        ...(discoveredAt ? { discoveredAt } : {})
      };
      const reference = toPersistenceReference(persisted);
      if (reference) {
        if (!previous) delta.created.push(reference);
        else if (materiallyUpdated) delta.materiallyUpdated.push(reference);
        else delta.unchanged.push(reference);
      }
      return persisted;
    });
    for (const removed of plan.removed) {
      const reference = toPersistenceReference(removed);
      if (reference) delta.removed.push(reference);
    }
    this.items.set(source.id, [
      ...existing.filter((item) => item.trustStatus !== "trusted"),
      ...persistedItems
    ]);
    return delta;
  }

  async acknowledgeNotificationProduction(references: readonly AnnouncementPersistenceReference[]): Promise<number> {
    let acknowledged = 0;
    const visited = new Set<string>();
    for (const reference of references) {
      const key = `${reference.sourceId}\u0000${reference.id}\u0000${reference.contentFingerprint}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const sourceItems = this.items.get(reference.sourceId);
      const index = sourceItems?.findIndex((item) =>
        item.id === reference.id
        && item.scopeType === reference.scopeType
        && item.scopeId === reference.scopeId
        && item.contentFingerprint === reference.contentFingerprint
        && item.notificationEligibleFingerprint === reference.contentFingerprint) ?? -1;
      if (!sourceItems || index < 0) continue;
      sourceItems[index] = {
        ...sourceItems[index]!,
        notificationProducedFingerprint: reference.contentFingerprint
      };
      acknowledged += 1;
    }
    return acknowledged;
  }

  async listItemsForSource(sourceId: string, limit = 1_000, offset = 0): Promise<AnnouncementItem[]> {
    const source = this.sources.get(sourceId);
    if (!source || source.status !== "active" || source.trustStatus !== "trusted") return [];
    return (this.items.get(sourceId) ?? [])
      .filter(isApiEligibleItem)
      .sort(compareAnnouncementItems)
      .slice(offset, offset + limit);
  }

  async listItemsByScope(input: { universityId: string; facultyId?: string; departmentId?: string; limit: number }): Promise<AnnouncementItem[]> {
    const sourceIds = new Set((await this.listSourcesByScope(input)).map((source) => source.id));
    return [...this.items.entries()]
      .filter(([sourceId]) => sourceIds.has(sourceId))
      .flatMap(([, sourceItems]) => sourceItems)
      .filter(isApiEligibleItem)
      .sort(compareAnnouncementItems)
      .slice(0, input.limit);
  }

  async findTrustedItemByIdInScope(input: {
    announcementId: string;
    universityId: string;
    facultyId?: string;
    departmentId?: string;
  }): Promise<{ item: AnnouncementItem; source: AnnouncementSourceRecord } | null> {
    const sources = await this.listSourcesByScope(input);
    for (const source of sources) {
      const item = (this.items.get(source.id) ?? [])
        .find((candidate) => candidate.id === input.announcementId && isApiEligibleItem(candidate));
      if (item) return { item, source };
    }
    return null;
  }

  async findSavedAnnouncement(userId: string, announcementId: string): Promise<SavedAnnouncementRecord | null> {
    return this.savedAnnouncements.get(savedAnnouncementKey(userId, announcementId)) ?? null;
  }

  async saveAnnouncement(userId: string, announcementId: string, savedAt: Date): Promise<SavedAnnouncementRecord> {
    const key = savedAnnouncementKey(userId, announcementId);
    const existing = this.savedAnnouncements.get(key);
    const record: SavedAnnouncementRecord = {
      id: existing?.id ?? randomUUID(),
      userId,
      announcementId,
      savedAt: existing?.savedAt ?? savedAt,
      createdAt: existing?.createdAt ?? savedAt,
      updatedAt: savedAt
    };
    this.savedAnnouncements.set(key, record);
    return record;
  }

  async deleteSavedAnnouncement(userId: string, announcementId: string): Promise<boolean> {
    return this.savedAnnouncements.delete(savedAnnouncementKey(userId, announcementId));
  }

  async deleteSavedAnnouncementsByUserId(userId: string): Promise<void> {
    for (const [key, record] of this.savedAnnouncements) {
      if (record.userId === userId) this.savedAnnouncements.delete(key);
    }
  }

  async listAllItems(input: { limit?: number; offset?: number } = {}): Promise<AnnouncementItem[]> {
    const activeSourceIds = new Set([...this.sources.values()]
      .filter((source) => source.status === "active" && source.trustStatus === "trusted")
      .map((source) => source.id));
    return [...this.items.entries()]
      .filter(([sourceId]) => activeSourceIds.has(sourceId))
      .flatMap(([, items]) => items)
      .filter(isApiEligibleItem)
      .sort(compareAnnouncementItems)
      .slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 1000));
  }
}

function compareAnnouncementItems(left: AnnouncementItem, right: AnnouncementItem): number {
  const leftSourceTime = announcementSourceTime(left);
  const rightSourceTime = announcementSourceTime(right);
  if (leftSourceTime !== rightSourceTime) return rightSourceTime - leftSourceTime;
  const leftDiscoveredAt = parseAnnouncementTime(left.discoveredAt);
  const rightDiscoveredAt = parseAnnouncementTime(right.discoveredAt);
  return rightDiscoveredAt - leftDiscoveredAt || left.id.localeCompare(right.id, "en-US");
}

function announcementSourceTime(item: AnnouncementItem): number {
  return Math.max(
    parseAnnouncementTime(item.publishedAt),
    parseAnnouncementTime(item.sourceUpdatedAt),
    parseAnnouncementTime(item.publishedDate ? `${item.publishedDate}T12:00:00+03:00` : undefined)
  );
}

function parseAnnouncementTime(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function savedAnnouncementKey(userId: string, announcementId: string): string {
  return `${userId}\u0000${announcementId}`;
}

function isApiEligibleItem(item: AnnouncementItem): boolean {
  return item.trustStatus === "trusted";
}

const sourceValidatorFields = [
  "etag",
  "lastModified",
  "contentHash",
  "processingVersion",
  "lastContentChangedAt"
] as const;

function hasProcessingDefinitionChanged(
  existing: AnnouncementSourceRecord,
  next: {
    sourceUrl: AnnouncementSourceRecord["sourceUrl"];
    parser: AnnouncementSourceRecord["parser"];
    contentType: AnnouncementSourceRecord["contentType"] | undefined;
  }
): boolean {
  return existing.sourceUrl !== next.sourceUrl
    || existing.parser !== next.parser
    || (existing.contentType ?? "announcement") !== (next.contentType ?? "announcement");
}

function isReactivatedTrustedSource(
  existing: AnnouncementSourceRecord,
  next: Pick<UpsertAnnouncementSourceInput, "status" | "trustStatus">
): boolean {
  return (existing.status !== "active" || existing.trustStatus !== "trusted")
    && next.status === "active"
    && (next.trustStatus ?? existing.trustStatus) === "trusted";
}

function sameSourceDefinition(
  current: AnnouncementSourceDefinitionFence,
  expected: AnnouncementSourceDefinitionFence
): boolean {
  return current.sourceUrl === expected.sourceUrl
    && current.parser === expected.parser
    && (current.contentType ?? "announcement") === (expected.contentType ?? "announcement")
    && current.sourceDefinitionVersion === expected.sourceDefinitionVersion
    && current.notificationProducerVersion === expected.notificationProducerVersion;
}

function normalizedSnapshotId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function clearSourceValidators(source: AnnouncementSourceRecord): void {
  for (const field of sourceValidatorFields) delete source[field];
}
