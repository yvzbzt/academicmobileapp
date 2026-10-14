import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { canonicalAnnouncementSourceIdentityKey, canonicalizeContentUrl, createAnnouncementSourceCandidateId, isOfficialContentUrl, normalizeDisplayText, officialDomainForUrl } from "./announcement-content-trust.js";
import { carryAnnouncementReviewState, emptyAnnouncementPersistenceDelta, fingerprintFor, planAnnouncementReplacement, reviewMutationDelta, toPersistenceReference } from "./announcement-persistence.js";
import { assertAnnouncementSourceOwnershipImmutable, assertAnnouncementSourceVerificationEvidenceMatchesDefinition, normalizeAnnouncementSourceOwnership, normalizeAnnouncementSourceVerificationEvidence, sameAnnouncementSourceVerificationEvidence } from "./announcement-source-evidence.js";
import { AnnouncementReviewConflictError, sameAnnouncementSourceParserConfig } from "./announcements.types.js";
import type { AnnouncementAdminSourceListQuery, AnnouncementItem, AnnouncementPersistenceDelta, AnnouncementPersistenceReference, AnnouncementReplacementOptions, AnnouncementRepository, AnnouncementReviewFence, AnnouncementReviewItemUpdate, AnnouncementReviewMutationResult, AnnouncementSourceCandidateInput, AnnouncementSourceDefinitionFence, AnnouncementSourceEditFence, AnnouncementSourceRecord, AnnouncementSourceReviewFence, AnnouncementSourceReviewMutation, AnnouncementSourceScope, AnnouncementSourceStatus, AnnouncementSourceVerificationAttachResult, AnnouncementSourceVerificationEvidence, AnnouncementTrustReason, SavedAnnouncementRecord, SourceCheckInput, SourceHealthProbeInput, UniversityCalendarSourceProfileRecord, UpsertAnnouncementSourceInput, UpsertUniversityCalendarSourceProfileInput } from "./announcements.types.js";

@Injectable()
export class InMemoryAnnouncementRepository implements AnnouncementRepository {
  private readonly sources = new Map<string, AnnouncementSourceRecord>();
  private readonly universityCalendarSourceProfiles = new Map<string, UniversityCalendarSourceProfileRecord>();
  private readonly items = new Map<string, AnnouncementItem[]>();
  private readonly savedAnnouncements = new Map<string, SavedAnnouncementRecord>();

  constructor() {}

  async listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]> {
    return [...this.sources.values()]
      .filter(isPublishedSource)
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
      .sort((left, right) => right.priority - left.priority
        || left.sourceName.localeCompare(right.sourceName, "tr-TR")
        || left.id.localeCompare(right.id, "en-US"))
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
      .sort((left, right) => right.priority - left.priority
        || left.sourceName.localeCompare(right.sourceName, "tr-TR")
        || left.id.localeCompare(right.id, "en-US"))
      .slice(input.offset, input.offset + input.limit);
  }

  async listAdminSources(input: AnnouncementAdminSourceListQuery): Promise<AnnouncementSourceRecord[]> {
    return [...this.sources.values()]
      .filter((source) => matchesAdminSourceQuery(source, input))
      .sort(compareAdminSources)
      .slice(input.offset, input.offset + input.limit);
  }

  async listAdminSourcesByScopeSet(input: AnnouncementAdminSourceListQuery & { scopes: AnnouncementSourceScope[] }): Promise<AnnouncementSourceRecord[]> {
    const scopeKeys = new Set(input.scopes.map((scope) => `${scope.scopeType}\u0000${scope.scopeId}`));
    return [...this.sources.values()]
      .filter((source) => scopeKeys.has(`${source.scopeType}\u0000${source.scopeId}`))
      .filter((source) => matchesAdminSourceQuery(source, input))
      .sort(compareAdminSources)
      .slice(input.offset, input.offset + input.limit);
  }

  async findSourceById(id: string): Promise<AnnouncementSourceRecord | null> {
    return this.sources.get(id) ?? null;
  }

  async listUniversityCalendarSourceProfiles(universityIds?: readonly string[]): Promise<UniversityCalendarSourceProfileRecord[]> {
    const allowed = universityIds ? new Set(universityIds) : undefined;
    return [...this.universityCalendarSourceProfiles.values()]
      .filter((profile) => !allowed || allowed.has(profile.universityId))
      .sort((left, right) => left.universityId.localeCompare(right.universityId, "en-US"));
  }

  async findUniversityCalendarSourceProfile(universityId: string): Promise<UniversityCalendarSourceProfileRecord | null> {
    return this.universityCalendarSourceProfiles.get(universityId) ?? null;
  }

  async upsertUniversityCalendarSourceProfile(input: UpsertUniversityCalendarSourceProfileInput): Promise<UniversityCalendarSourceProfileRecord> {
    const sourceUrl = canonicalizeContentUrl(input.sourceUrl);
    if (!sourceUrl || !officialDomainForUrl(sourceUrl)) throw new Error("UNIVERSITY_CALENDAR_SOURCE_URL_NOT_OFFICIAL");
    const existing = this.universityCalendarSourceProfiles.get(input.universityId);
    const now = new Date();
    const profile: UniversityCalendarSourceProfileRecord = {
      ...existing,
      ...input,
      id: existing?.id ?? `calendar-${input.universityId}`,
      sourceUrl,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.universityCalendarSourceProfiles.set(input.universityId, profile);
    return profile;
  }

  async attachVerificationEvidenceIfMissing(
    id: string,
    evidenceInput: AnnouncementSourceVerificationEvidence
  ): Promise<AnnouncementSourceVerificationAttachResult | null> {
    const existing = this.sources.get(id);
    if (!existing) return null;
    const evidence = normalizeAnnouncementSourceVerificationEvidence(evidenceInput)!;
    assertAnnouncementSourceVerificationEvidenceMatchesDefinition(existing, evidence);
    if (existing.verificationEvidence) {
      return {
        source: existing,
        outcome: sameAnnouncementSourceVerificationEvidence(existing.verificationEvidence, evidence) ? "unchanged" : "conflict"
      };
    }
    const source = { ...existing, verificationEvidence: evidence, updatedAt: new Date() };
    this.sources.set(id, source);
    return { source, outcome: "attached" };
  }

  async upsertSource(input: UpsertAnnouncementSourceInput): Promise<AnnouncementSourceRecord> {
    const ownership = normalizeAnnouncementSourceOwnership(input);
    const verificationEvidence = normalizeAnnouncementSourceVerificationEvidence(input.verificationEvidence);
    const canonicalUrl = canonicalizeContentUrl(input.sourceUrl);
    if (!canonicalUrl || !officialDomainForUrl(canonicalUrl)) throw new Error("ANNOUNCEMENT_SOURCE_URL_NOT_OFFICIAL");
    const homepageUrl = input.homepageUrl ? canonicalizeContentUrl(input.homepageUrl) : undefined;
    if (input.homepageUrl && !homepageUrl) throw new Error("ANNOUNCEMENT_SOURCE_HOMEPAGE_URL_INVALID");
    const contentType = input.contentType ?? "announcement";
    if (verificationEvidence) {
      assertAnnouncementSourceVerificationEvidenceMatchesDefinition({
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        ...(ownership.ownerUniversityId ? { ownerUniversityId: ownership.ownerUniversityId } : {}),
        sourceUrl: canonicalUrl,
        canonicalUrl,
        contentType
      }, verificationEvidence);
    }
    if (
      homepageUrl
      && (input.status === "active" || input.trustStatus === "trusted")
      && !isOfficialContentUrl(canonicalUrl, homepageUrl)
    ) throw new Error("ANNOUNCEMENT_SOURCE_DOMAIN_MISMATCH");
    const identityKey = canonicalAnnouncementSourceIdentityKey(canonicalUrl);
    const duplicate = [...this.sources.values()].find((source) => source.scopeType === input.scopeType
      && source.scopeId === input.scopeId
      && (source.contentType ?? "announcement") === contentType
      && canonicalAnnouncementSourceIdentityKey(source.canonicalUrl ?? source.sourceUrl) === identityKey);
    const id = input.id ?? duplicate?.id ?? randomUUID();
    const now = new Date();
    const existing = this.sources.get(id);
    if (existing) {
      assertAnnouncementSourceOwnershipImmutable(existing, input);
      if (
        existing.verificationEvidence
        && verificationEvidence
        && !sameAnnouncementSourceVerificationEvidence(existing.verificationEvidence, verificationEvidence)
      ) throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_EVIDENCE_CONFLICT");
    }
    const processingDefinitionChanged = existing
      ? hasProcessingDefinitionChanged(existing, {
          sourceUrl: canonicalUrl,
          parser: input.parser,
          parserConfig: input.parserConfig,
          contentType: input.contentType
        })
      : false;
    const reactivated = existing ? isReactivatedTrustedSource(existing, input) : false;
    const source: AnnouncementSourceRecord = {
      ...existing,
      ...input,
      ...ownership,
      contentType,
      sourceName: normalizeDisplayText(input.sourceName, 160) || "Resmî akademik kaynak",
      sourceUrl: canonicalUrl,
      canonicalUrl,
      ...(homepageUrl ? { homepageUrl } : {}),
      discoveredAt: existing?.discoveredAt ?? input.discoveredAt ?? existing?.createdAt ?? now,
      trustStatus: input.trustStatus ?? existing?.trustStatus ?? "quarantined",
      approvalPending: input.approvalPending ?? existing?.approvalPending ?? false,
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    delete source.ownerUniversityId;
    delete source.ownerFacultyId;
    delete source.verificationEvidence;
    const ownerUniversityId = existing?.ownerUniversityId ?? ownership.ownerUniversityId;
    const ownerFacultyId = existing?.ownerFacultyId ?? ownership.ownerFacultyId;
    const persistedEvidence = processingDefinitionChanged
      ? verificationEvidence
      : existing?.verificationEvidence ?? verificationEvidence;
    if (ownerUniversityId) source.ownerUniversityId = ownerUniversityId;
    if (ownerFacultyId) source.ownerFacultyId = ownerFacultyId;
    if (persistedEvidence) source.verificationEvidence = persistedEvidence;
    delete source.activeSnapshotId;
    if (!processingDefinitionChanged && existing?.activeSnapshotId !== undefined) {
      source.activeSnapshotId = existing.activeSnapshotId;
    }
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

  async updateSource(
    id: string,
    input: UpsertAnnouncementSourceInput,
    fence: AnnouncementSourceEditFence
  ): Promise<AnnouncementSourceRecord | null> {
    const existing = this.sources.get(id);
    if (!existing || !sourceEditFenceMatches(existing, fence)) return null;
    // This repository has no asynchronous work between the fence check and
    // mutation, so the in-memory compare-and-set is one event-loop operation.
    return this.upsertSource({ ...input, id });
  }

  async reviewSource(
    id: string,
    input: AnnouncementSourceReviewMutation,
    fence: AnnouncementSourceReviewFence
  ): Promise<AnnouncementSourceRecord | null> {
    const existing = this.sources.get(id);
    if (!existing || !sourceReviewFenceMatches(existing, fence)) return null;
    const now = new Date();
    const reviewed: AnnouncementSourceRecord = {
      ...existing,
      ...(input.reviewedBy ? { reviewedBy: input.reviewedBy } : {}),
      ...(input.reviewedAt ? { reviewedAt: input.reviewedAt } : {}),
      ...(input.reviewNote !== undefined ? { reviewNote: input.reviewNote } : {}),
      updatedAt: now
    };
    if (input.decision === "approve") {
      const reactivated = existing.status !== "active" || existing.trustStatus !== "trusted";
      reviewed.status = "active";
      reviewed.trustStatus = "trusted";
      reviewed.approvalPending = true;
      reviewed.healthStatus = "pending";
      delete reviewed.lastError;
      reviewed.trustReasonCodes = [];
      if (reactivated) reviewed.notificationProducerVersion = randomUUID();
    } else if (input.decision === "reject") {
      reviewed.status = "inactive";
      reviewed.trustStatus = "rejected";
      reviewed.approvalPending = false;
    } else {
      reviewed.status = "inactive";
      reviewed.trustStatus = "quarantined";
      reviewed.approvalPending = false;
      reviewed.trustReasonCodes = [...new Set([
        ...(existing.trustReasonCodes ?? []),
        ...(input.trustReasonCodes ?? [])
      ])].sort();
    }
    this.sources.set(id, reviewed);
    return reviewed;
  }

  async completeSourceApproval(
    id: string,
    expectedDefinition: AnnouncementSourceDefinitionFence,
    expectedActiveSnapshotId: string | null,
    staleContentCheckedAt?: Date
  ): Promise<AnnouncementSourceRecord | null> {
    const existing = this.sources.get(id);
    const healthAccepted = staleContentCheckedAt
      ? existing?.healthStatus === "degraded" && existing.lastError === "SOURCE_LISTING_STALE"
        && existing.itemCount === 0 && !existing.activeSnapshotId && expectedActiveSnapshotId === null
        && existing.lastCheckedAt?.getTime() === staleContentCheckedAt.getTime()
      : existing?.healthStatus === "healthy" && (existing.itemCount ?? 0) > 0;
    if (
      !existing
      || existing.status !== "active"
      || existing.trustStatus !== "trusted"
      || existing.approvalPending !== true
      || !healthAccepted
      || !sameSourceDefinition(existing, expectedDefinition)
      || normalizedSnapshotId(existing.activeSnapshotId) !== normalizedSnapshotId(expectedActiveSnapshotId ?? undefined)
    ) return null;
    const published: AnnouncementSourceRecord = {
      ...existing,
      approvalPending: false,
      updatedAt: new Date()
    };
    this.sources.set(id, published);
    return published;
  }

  async insertQuarantinedSourceCandidate(input: AnnouncementSourceCandidateInput): Promise<AnnouncementSourceRecord> {
    const canonicalUrl = canonicalizeContentUrl(input.sourceUrl);
    if (!canonicalUrl || !officialDomainForUrl(canonicalUrl)) throw new Error("ANNOUNCEMENT_SOURCE_URL_NOT_OFFICIAL");
    const homepageUrl = input.homepageUrl ? canonicalizeContentUrl(input.homepageUrl) : undefined;
    if (input.homepageUrl && !homepageUrl) throw new Error("ANNOUNCEMENT_SOURCE_HOMEPAGE_URL_INVALID");
    const contentType = input.contentType ?? "announcement";
    const identityKey = canonicalAnnouncementSourceIdentityKey(canonicalUrl);
    const candidateId = createAnnouncementSourceCandidateId({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      sourceUrl: canonicalUrl,
      contentType
    });
    if (!identityKey || !candidateId) throw new Error("ANNOUNCEMENT_SOURCE_CANDIDATE_ID_INVALID");
    const existing = [...this.sources.values()].find((source) =>
      source.scopeType === input.scopeType
      && source.scopeId === input.scopeId
      && (source.contentType ?? "announcement") === contentType
      && canonicalAnnouncementSourceIdentityKey(source.canonicalUrl ?? source.sourceUrl) === identityKey);
    if (existing) {
      assertAnnouncementSourceOwnershipImmutable(existing, input);
      if (input.verificationEvidence) {
        const attached = await this.attachVerificationEvidenceIfMissing(existing.id, input.verificationEvidence);
        if (attached?.outcome === "conflict") throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_EVIDENCE_CONFLICT");
        return attached?.source ?? existing;
      }
      return existing;
    }
    return this.upsertSource({
      ...input,
      contentType,
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

  async recordSourceHealthProbe(
    id: string,
    input: SourceHealthProbeInput,
    expectedDefinition: AnnouncementSourceDefinitionFence
  ): Promise<AnnouncementSourceRecord | null> {
    const existing = this.sources.get(id);
    if (!existing || !sameSourceDefinition(existing, expectedDefinition)) return null;
    const updated: AnnouncementSourceRecord = {
      ...existing,
      healthProbe: { ...input },
      updatedAt: new Date()
    };
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
      approvalPending: false,
      trustReasonCodes: [...new Set([...(existing.trustReasonCodes ?? []), ...reasonCodes])].sort(),
      updatedAt: new Date()
    };
    this.sources.set(id, updated);
    return updated;
  }

  async deactivateSource(id: string, fence: AnnouncementSourceReviewFence): Promise<AnnouncementSourceRecord | null> {
    const existing = this.sources.get(id);
    if (!existing || !sourceReviewFenceMatches(existing, fence)) return null;
    const updated = { ...existing, status: "inactive" as const, approvalPending: false, updatedAt: new Date() };
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
    const persistedItems = plan.entries.map(({ item, previous, contentMateriallyUpdated, reviewMateriallyUpdated, materiallyUpdated }) => {
      const discoveredAt = previous?.discoveredAt ?? item.discoveredAt ?? item.fetchedAt;
      const reviewedItem = carryAnnouncementReviewState(item, previous, contentMateriallyUpdated, reviewMateriallyUpdated);
      const persisted: AnnouncementItem = {
        ...reviewedItem,
        reviewRevision: reviewedItem.reviewRevision ?? randomUUID(),
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
    if (!source || !isPublishedSource(source)) return [];
    return (this.items.get(sourceId) ?? [])
      .filter((item) => item.trustStatus === "trusted")
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
      .filter(isPublishedSource)
      .map((source) => source.id));
    return [...this.items.entries()]
      .filter(([sourceId]) => activeSourceIds.has(sourceId))
      .flatMap(([, items]) => items)
      .filter(isApiEligibleItem)
      .sort(compareAnnouncementItems)
      .slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 1000));
  }

  async listReviewItems(input: { sourceIds?: string[]; limit?: number; offset?: number } = {}): Promise<AnnouncementItem[]> {
    const requestedSourceIds = input.sourceIds ? new Set(input.sourceIds) : null;
    const activeSourceIds = new Set([...this.sources.values()]
      .filter((source) => source.status === "active" && source.trustStatus === "trusted")
      .filter((source) => !requestedSourceIds || requestedSourceIds.has(source.id))
      .map((source) => source.id));
    return [...this.items.entries()]
      .filter(([sourceId]) => activeSourceIds.has(sourceId))
      .flatMap(([, items]) => items)
      .filter((item) => item.trustStatus === "trusted")
      .sort(compareAnnouncementItems)
      .slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 1000));
  }

  async findReviewItemById(id: string): Promise<{ item: AnnouncementItem; source: AnnouncementSourceRecord } | null> {
    for (const [sourceId, items] of this.items) {
      const item = items.find((candidate) => candidate.id === id);
      const source = this.sources.get(sourceId);
      if (item && source) return { item, source };
    }
    return null;
  }

  async updateReviewItem(
    id: string,
    input: AnnouncementReviewItemUpdate,
    fence: AnnouncementReviewFence
  ): Promise<AnnouncementReviewMutationResult | null> {
    for (const [sourceId, items] of this.items) {
      const index = items.findIndex((candidate) => candidate.id === id);
      if (index < 0) continue;
      const current = items[index]!;
      if (!reviewFenceMatches(current, fence)) throw new AnnouncementReviewConflictError();
      const definedInput = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      const updated = { ...current, ...definedInput, reviewRevision: randomUUID() } as AnnouncementItem;
      items[index] = updated;
      this.items.set(sourceId, items);
      const source = this.sources.get(sourceId);
      if (!source) return null;
      return { item: updated, source, delta: reviewMutationDelta(items, id) };
    }
    return null;
  }
}

function matchesAdminSourceQuery(source: AnnouncementSourceRecord, input: AnnouncementAdminSourceListQuery): boolean {
  if (input.status && source.status !== input.status) return false;
  if (input.trustStatus === "pending_review") {
    if (source.approvalPending !== true) return false;
  } else if (input.trustStatus) {
    if (source.approvalPending === true || (source.trustStatus ?? "quarantined") !== input.trustStatus) return false;
  }
  if (input.contentType && (source.contentType ?? "announcement") !== input.contentType) return false;
  if (input.scopeType && source.scopeType !== input.scopeType) return false;
  const search = input.search?.trim().toLocaleLowerCase("tr-TR");
  return !search || `${source.sourceName}\u0000${source.sourceUrl}\u0000${source.scopeId}`.toLocaleLowerCase("tr-TR").includes(search);
}

function compareAdminSources(left: AnnouncementSourceRecord, right: AnnouncementSourceRecord): number {
  return right.priority - left.priority
    || left.sourceName.localeCompare(right.sourceName, "tr-TR")
    || left.id.localeCompare(right.id, "en-US");
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
  return item.trustStatus === "trusted" && item.reviewStatus === "approved";
}

function isPublishedSource(source: AnnouncementSourceRecord): boolean {
  return source.status === "active"
    && source.trustStatus === "trusted"
    && source.approvalPending !== true;
}

function reviewFenceMatches(item: AnnouncementItem, fence: AnnouncementReviewFence): boolean {
  return normalizedSnapshotId(item.snapshotId) === normalizedSnapshotId(fence.expectedSnapshotId)
    && (item.contentFingerprint ?? fingerprintFor(item)) === fence.expectedContentFingerprint
    && normalizedRevision(item.reviewRevision) === normalizedRevision(fence.expectedReviewRevision);
}

function normalizedRevision(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

const sourceValidatorFields = [
  "etag",
  "lastModified",
  "contentHash",
  "processingVersion",
  "lastContentChangedAt",
  "healthProbe"
] as const;

function hasProcessingDefinitionChanged(
  existing: AnnouncementSourceRecord,
  next: {
    sourceUrl: AnnouncementSourceRecord["sourceUrl"];
    parser: AnnouncementSourceRecord["parser"];
    parserConfig: AnnouncementSourceRecord["parserConfig"];
    contentType: AnnouncementSourceRecord["contentType"] | undefined;
  }
): boolean {
  return existing.sourceUrl !== next.sourceUrl
    || existing.parser !== next.parser
    || !sameAnnouncementSourceParserConfig(existing.parserConfig, next.parserConfig)
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
    && sameAnnouncementSourceParserConfig(current.parserConfig, expected.parserConfig)
    && (current.contentType ?? "announcement") === (expected.contentType ?? "announcement")
    && current.sourceDefinitionVersion === expected.sourceDefinitionVersion
    && current.notificationProducerVersion === expected.notificationProducerVersion
    && (current.approvalPending === true) === (expected.approvalPending === true)
    && normalizedTimestamp(current.reviewedAt) === normalizedTimestamp(expected.reviewedAt);
}

function sourceReviewFenceMatches(
  current: AnnouncementSourceRecord,
  fence: AnnouncementSourceReviewFence
): boolean {
  const expectedCanonicalUrl = canonicalizeContentUrl(fence.expectedCanonicalUrl);
  const currentCanonicalUrl = canonicalizeContentUrl(current.canonicalUrl ?? current.sourceUrl);
  return Boolean(expectedCanonicalUrl)
    && currentCanonicalUrl === expectedCanonicalUrl
    && (fence.expectedSourceUrl === undefined || current.sourceUrl === fence.expectedSourceUrl)
    && current.sourceDefinitionVersion === normalizedVersion(fence.expectedSourceDefinitionVersion)
    && (current.trustStatus ?? "quarantined") === fence.expectedTrustStatus
    && current.status === fence.expectedSourceStatus
    && (current.approvalPending === true) === fence.expectedApprovalPending
    && (fence.expectedReviewedAt === undefined
      || normalizedTimestamp(current.reviewedAt) === normalizedTimestamp(fence.expectedReviewedAt ?? undefined));
}

function sourceEditFenceMatches(
  current: AnnouncementSourceRecord,
  fence: AnnouncementSourceEditFence
): boolean {
  return sourceReviewFenceMatches(current, fence)
    && current.updatedAt.getTime() === fence.expectedUpdatedAt.getTime();
}

function normalizedVersion(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizedTimestamp(value: Date | undefined): number | undefined {
  const timestamp = value?.getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function normalizedSnapshotId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function clearSourceValidators(source: AnnouncementSourceRecord): void {
  for (const field of sourceValidatorFields) delete source[field];
}
