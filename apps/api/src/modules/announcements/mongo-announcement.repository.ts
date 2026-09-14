import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { isValidObjectId, Types } from "mongoose";
import { announcementItemSchema, announcementSnapshotSchema, announcementSourceSchema, savedAnnouncementSchema, universityCalendarSourceProfileSchema } from "../../database/mongoose-schemas.js";
import { getModel, omitUndefined, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import { canonicalAnnouncementSourceIdentityKey, canonicalizeContentUrl, createAnnouncementSourceCandidateId, isOfficialContentUrl, normalizeDisplayText, officialDomainForUrl } from "./announcement-content-trust.js";
import { carryAnnouncementReviewState, emptyAnnouncementPersistenceDelta, fingerprintFor, planAnnouncementReplacement, reviewMutationDelta, toPersistenceReference } from "./announcement-persistence.js";
import { assertAnnouncementSourceOwnershipImmutable, assertAnnouncementSourceVerificationEvidenceMatchesDefinition, normalizeAnnouncementSourceOwnership, normalizeAnnouncementSourceVerificationEvidence, sameAnnouncementSourceVerificationEvidence } from "./announcement-source-evidence.js";
import { AnnouncementReviewConflictError, sameAnnouncementSourceParserConfig } from "./announcements.types.js";
import type { AnnouncementAdminSourceListQuery, AnnouncementItem, AnnouncementPersistenceDelta, AnnouncementPersistenceReference, AnnouncementReplacementOptions, AnnouncementRepository, AnnouncementReviewFence, AnnouncementReviewItemUpdate, AnnouncementReviewMutationResult, AnnouncementSourceCandidateInput, AnnouncementSourceDefinitionFence, AnnouncementSourceEditFence, AnnouncementSourceRecord, AnnouncementSourceReviewFence, AnnouncementSourceReviewMutation, AnnouncementSourceScope, AnnouncementSourceStatus, AnnouncementSourceVerificationAttachResult, AnnouncementSourceVerificationEvidence, AnnouncementTrustReason, SavedAnnouncementRecord, SourceCheckInput, SourceHealthProbeInput, UniversityCalendarSourceProfileRecord, UpsertAnnouncementSourceInput, UpsertUniversityCalendarSourceProfileInput } from "./announcements.types.js";

@Injectable()
export class MongoAnnouncementRepository implements AnnouncementRepository {
  private lastSnapshotRetentionReconciliationAt = 0;

  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]> {
    const matchers: Array<Record<string, string>> = [{ scopeType: "university", scopeId: input.universityId }];
    if (input.facultyId) matchers.push({ scopeType: "faculty", scopeId: input.facultyId });
    if (input.departmentId) matchers.push({ scopeType: "department", scopeId: input.departmentId });

    const documents = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", trustStatus: "trusted", approvalPending: { $ne: true }, $or: matchers })
      .sort({ priority: -1, updatedAt: -1 });

    return documents.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
  }

  async listAllSources(input: { status?: AnnouncementSourceStatus; limit?: number; offset?: number } = {}): Promise<AnnouncementSourceRecord[]> {
    const documents = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find(input.status === "active"
        ? { status: "active", trustStatus: "trusted" }
        : input.status ? { status: input.status } : {})
      .sort({ priority: -1, sourceName: 1, _id: 1 })
      .skip(input.offset ?? 0)
      .limit(input.limit ?? 500);

    return documents.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
  }

  async listSourcesByScopeSet(input: {
    scopes: AnnouncementSourceScope[];
    status?: AnnouncementSourceStatus;
    limit: number;
    offset: number;
  }): Promise<AnnouncementSourceRecord[]> {
    if (input.scopes.length === 0) return [];
    const documents = await (await this.model("AnnouncementSource", announcementSourceSchema)).find({
      ...(input.status === "active"
        ? { status: "active", trustStatus: "trusted" }
        : input.status ? { status: input.status } : {}),
      $or: input.scopes.map((scope) => ({ scopeType: scope.scopeType, scopeId: scope.scopeId }))
    }).sort({ priority: -1, sourceName: 1, _id: 1 }).skip(input.offset).limit(input.limit);
    return documents.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
  }

  async listAdminSources(input: AnnouncementAdminSourceListQuery): Promise<AnnouncementSourceRecord[]> {
    const documents = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find(adminSourceMongoFilter(input))
      .sort({ priority: -1, sourceName: 1, _id: 1 })
      .skip(input.offset)
      .limit(input.limit);
    return documents.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
  }

  async listAdminSourcesByScopeSet(input: AnnouncementAdminSourceListQuery & { scopes: AnnouncementSourceScope[] }): Promise<AnnouncementSourceRecord[]> {
    if (input.scopes.length === 0) return [];
    const documents = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find(adminSourceMongoFilter(input, {
        $or: input.scopes.map((scope) => ({ scopeType: scope.scopeType, scopeId: scope.scopeId }))
      }))
      .sort({ priority: -1, sourceName: 1, _id: 1 })
      .skip(input.offset)
      .limit(input.limit);
    return documents.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
  }

  async findSourceById(id: string): Promise<AnnouncementSourceRecord | null> {
    if (!isValidObjectId(id)) return null;
    const document = await (await this.model("AnnouncementSource", announcementSourceSchema)).findById(id);
    return document ? toDomainRecord<AnnouncementSourceRecord>(document) : null;
  }

  async listUniversityCalendarSourceProfiles(universityIds?: readonly string[]): Promise<UniversityCalendarSourceProfileRecord[]> {
    const documents = await (await this.model("UniversityCalendarSourceProfile", universityCalendarSourceProfileSchema))
      .find(universityIds ? { universityId: { $in: [...universityIds] } } : {})
      .sort({ universityId: 1 });
    return documents.map((document) => toDomainRecord<UniversityCalendarSourceProfileRecord>(document));
  }

  async findUniversityCalendarSourceProfile(universityId: string): Promise<UniversityCalendarSourceProfileRecord | null> {
    const document = await (await this.model("UniversityCalendarSourceProfile", universityCalendarSourceProfileSchema))
      .findOne({ universityId });
    return document ? toDomainRecord<UniversityCalendarSourceProfileRecord>(document) : null;
  }

  async upsertUniversityCalendarSourceProfile(input: UpsertUniversityCalendarSourceProfileInput): Promise<UniversityCalendarSourceProfileRecord> {
    const sourceUrl = canonicalizeContentUrl(input.sourceUrl);
    if (!sourceUrl || !officialDomainForUrl(sourceUrl)) throw new Error("UNIVERSITY_CALENDAR_SOURCE_URL_NOT_OFFICIAL");
    const set = omitUndefined({ ...input, sourceUrl } as unknown as Record<string, unknown>);
    const resetTest = input.healthStatus === "pending";
    const clearError = input.healthStatus === "healthy";
    const document = await (await this.model("UniversityCalendarSourceProfile", universityCalendarSourceProfileSchema))
      .findOneAndUpdate({ universityId: input.universityId }, {
        $set: set,
        ...((resetTest || clearError) ? {
          $unset: {
            lastError: 1,
            ...(resetTest ? { lastCheckedAt: 1, lastSuccessAt: 1, itemCount: 1 } : {})
          }
        } : {})
      }, { upsert: true, new: true, setDefaultsOnInsert: true });
    if (!document) throw new Error("UNIVERSITY_CALENDAR_SOURCE_PROFILE_UPSERT_FAILED");
    return toDomainRecord<UniversityCalendarSourceProfileRecord>(document);
  }

  async attachVerificationEvidenceIfMissing(
    id: string,
    evidenceInput: AnnouncementSourceVerificationEvidence
  ): Promise<AnnouncementSourceVerificationAttachResult | null> {
    if (!isValidObjectId(id)) return null;
    const evidence = normalizeAnnouncementSourceVerificationEvidence(evidenceInput)!;
    const model = await this.model("AnnouncementSource", announcementSourceSchema);
    const observed = await model.findById(id);
    if (!observed) return null;
    const observedSource = toDomainRecord<AnnouncementSourceRecord>(observed);
    assertAnnouncementSourceVerificationEvidenceMatchesDefinition(observedSource, evidence);
    const attached = await model.findOneAndUpdate({
      _id: id,
      verificationEvidence: { $exists: false },
      ...sourceDefinitionFenceFilter(observedSource)
    }, {
      $set: { verificationEvidence: evidence }
    }, { new: true });
    if (attached) return { source: toDomainRecord<AnnouncementSourceRecord>(attached), outcome: "attached" };
    const current = await model.findById(id);
    if (!current) return null;
    const source = toDomainRecord<AnnouncementSourceRecord>(current);
    return {
      source,
      outcome: source.verificationEvidence && sameAnnouncementSourceVerificationEvidence(source.verificationEvidence, evidence)
        ? "unchanged"
        : "conflict"
    };
  }

  async upsertSource(input: UpsertAnnouncementSourceInput): Promise<AnnouncementSourceRecord> {
    const ownership = normalizeAnnouncementSourceOwnership(input);
    const verificationEvidence = normalizeAnnouncementSourceVerificationEvidence(input.verificationEvidence);
    const model = await this.model("AnnouncementSource", announcementSourceSchema);
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
    const normalizedInput = {
      ...input,
      ...ownership,
      ...(verificationEvidence ? { verificationEvidence } : {}),
      contentType,
      sourceName: normalizeDisplayText(input.sourceName, 160) || "Resmî akademik kaynak",
      sourceUrl: canonicalUrl,
      canonicalUrl,
      ...(homepageUrl ? { homepageUrl } : {}),
      ...(input.trustStatus ? { trustStatus: input.trustStatus } : {})
    };
    let existing = input.id ? await model.findById(input.id) : null;
    if (!existing) existing = await model.findOne({ scopeType: input.scopeType, scopeId: input.scopeId, contentType, sourceUrl: canonicalUrl });
    if (!existing) existing = await model.findOne({ scopeType: input.scopeType, scopeId: input.scopeId, contentType, canonicalUrl });
    if (!existing && input.sourceUrl !== canonicalUrl) {
      existing = await model.findOne({ scopeType: input.scopeType, scopeId: input.scopeId, contentType, sourceUrl: input.sourceUrl });
    }
    if (!existing) {
      const identityKey = canonicalAnnouncementSourceIdentityKey(canonicalUrl);
      const scopedDocuments = await model.find({ scopeType: input.scopeType, scopeId: input.scopeId });
      existing = scopedDocuments.find((candidate) => {
        const record = toDomainRecord<AnnouncementSourceRecord>(candidate);
        return (record.contentType ?? "announcement") === contentType
          && canonicalAnnouncementSourceIdentityKey(record.canonicalUrl ?? record.sourceUrl) === identityKey;
      }) ?? null;
    }
    let document;
    let snapshotInvalidated = false;
    let invalidatedSnapshotId: string | undefined;
    if (existing) {
      const existingRecord = toDomainRecord<AnnouncementSourceRecord>(existing);
      assertAnnouncementSourceOwnershipImmutable(existingRecord, input);
      if (
        existingRecord.verificationEvidence
        && verificationEvidence
        && !sameAnnouncementSourceVerificationEvidence(existingRecord.verificationEvidence, verificationEvidence)
      ) throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_EVIDENCE_CONFLICT");
      const definitionChanged = hasProcessingDefinitionChanged(existingRecord, {
        sourceUrl: canonicalUrl,
        parser: input.parser,
        parserConfig: input.parserConfig,
        contentType: input.contentType
      });
      const activationIntentInvalidated = definitionChanged
        || existingRecord.status !== input.status
        || (input.trustStatus !== undefined && existingRecord.trustStatus !== input.trustStatus)
        || (input.approvalPending !== undefined
          && (existingRecord.approvalPending === true) !== (input.approvalPending === true))
        || (input.reviewedAt !== undefined
          && normalizedTimestamp(existingRecord.reviewedAt) !== normalizedTimestamp(input.reviewedAt));
      const reactivated = isReactivatedTrustedSource(existingRecord, input);
      const set = omitUndefined(normalizedInput as unknown as Record<string, unknown>);
      delete set.id;
      // The snapshot pointer is repository-owned and may only change through
      // the CAS activation below. Generic source edits must never restore a
      // stale pointer copied from an earlier source read.
      delete set.activeSnapshotId;
      // Repository-owned generations cannot be restored from a stale source
      // read. Processing changes and notification reactivation intentionally
      // use separate fences.
      delete set.sourceDefinitionVersion;
      delete set.notificationProducerVersion;
      delete set.snapshotStateRevision;
      delete set.pendingSnapshotId;
      delete set.pendingSnapshotRevision;
      delete set.pendingSnapshotExpiresAt;
      delete set.snapshotIntentRevision;
      if (definitionChanged) {
        snapshotInvalidated = true;
        invalidatedSnapshotId = normalizedSnapshotId(existingRecord.activeSnapshotId);
        set.sourceDefinitionVersion = newSourceDefinitionVersion();
      }
      if (reactivated) set.notificationProducerVersion = newSourceDefinitionVersion();
      if (definitionChanged) {
        for (const field of sourceValidatorFields) delete set[field];
      }
      document = await model.findOneAndUpdate({
        _id: existing.id,
        ...(definitionChanged ? snapshotStateFenceFilter(
          existingRecord.activeSnapshotId ?? null,
          snapshotStateRevisionFor(existingRecord)
        ) : {})
      }, {
        $set: set,
        ...(definitionChanged || activationIntentInvalidated ? {
          $inc: {
            ...(definitionChanged ? { snapshotStateRevision: 1 } : {}),
            ...(activationIntentInvalidated ? { snapshotIntentRevision: 1 } : {})
          }
        } : {}),
        ...(activationIntentInvalidated ? {
          $unset: {
            ...snapshotActivationIntentUnset,
            ...(definitionChanged ? {
              ...sourceValidatorUnset,
              activeSnapshotId: 1,
              ...(!verificationEvidence ? { verificationEvidence: 1 } : {})
            } : {})
          }
        } : {})
      }, { new: true });
      if (!document && definitionChanged) throw new Error("ANNOUNCEMENT_SNAPSHOT_INVALIDATION_CONFLICT");
    } else {
      const createValue = omitUndefined({
        ...normalizedInput,
        trustStatus: input.trustStatus ?? "quarantined",
        approvalPending: input.approvalPending ?? false,
        discoveredAt: input.discoveredAt ?? new Date()
      } as unknown as Record<string, unknown>);
      delete createValue.activeSnapshotId;
      delete createValue.sourceDefinitionVersion;
      delete createValue.notificationProducerVersion;
      delete createValue.snapshotStateRevision;
      delete createValue.pendingSnapshotId;
      delete createValue.pendingSnapshotRevision;
      delete createValue.pendingSnapshotExpiresAt;
      delete createValue.snapshotIntentRevision;
      createValue.sourceDefinitionVersion = newSourceDefinitionVersion();
      createValue.notificationProducerVersion = newSourceDefinitionVersion();
      createValue.snapshotStateRevision = 0;
      createValue.snapshotIntentRevision = 0;
      document = await model.create(createValue);
    }
    if (!document) throw new Error("ANNOUNCEMENT_SOURCE_UPSERT_FAILED");
    const persisted = toDomainRecord<AnnouncementSourceRecord>(document);
    if (snapshotInvalidated) {
      await this.retireSnapshotHistory(persisted, invalidatedSnapshotId);
    }
    return persisted;
  }

  async updateSource(
    id: string,
    input: UpsertAnnouncementSourceInput,
    fence: AnnouncementSourceEditFence
  ): Promise<AnnouncementSourceRecord | null> {
    if (!isValidObjectId(id) || !Number.isFinite(fence.expectedUpdatedAt.getTime())) return null;
    const model = await this.model("AnnouncementSource", announcementSourceSchema);
    const canonicalUrl = canonicalizeContentUrl(input.sourceUrl);
    if (!canonicalUrl || !officialDomainForUrl(canonicalUrl)) throw new Error("ANNOUNCEMENT_SOURCE_URL_NOT_OFFICIAL");
    const homepageUrl = input.homepageUrl ? canonicalizeContentUrl(input.homepageUrl) : undefined;
    if (input.homepageUrl && !homepageUrl) throw new Error("ANNOUNCEMENT_SOURCE_HOMEPAGE_URL_INVALID");
    const contentType = input.contentType ?? "announcement";
    if (
      homepageUrl
      && (input.status === "active" || input.trustStatus === "trusted")
      && !isOfficialContentUrl(canonicalUrl, homepageUrl)
    ) throw new Error("ANNOUNCEMENT_SOURCE_DOMAIN_MISMATCH");

    const observedDocument = await model.findById(id);
    if (!observedDocument) return null;
    const observed = toDomainRecord<AnnouncementSourceRecord>(observedDocument);
    assertAnnouncementSourceOwnershipImmutable(observed, input);
    const ownership = normalizeAnnouncementSourceOwnership(input);
    const verificationEvidence = normalizeAnnouncementSourceVerificationEvidence(input.verificationEvidence);
    if (verificationEvidence) {
      assertAnnouncementSourceVerificationEvidenceMatchesDefinition({
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        ...(observed.ownerUniversityId
          ? { ownerUniversityId: observed.ownerUniversityId }
          : ownership.ownerUniversityId ? { ownerUniversityId: ownership.ownerUniversityId } : {}),
        sourceUrl: canonicalUrl,
        canonicalUrl,
        contentType
      }, verificationEvidence);
    }
    if (
      observed.verificationEvidence
      && verificationEvidence
      && !sameAnnouncementSourceVerificationEvidence(observed.verificationEvidence, verificationEvidence)
    ) throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_EVIDENCE_CONFLICT");
    const definitionChanged = hasProcessingDefinitionChanged(observed, {
      sourceUrl: canonicalUrl,
      parser: input.parser,
      parserConfig: input.parserConfig,
      contentType: input.contentType
    });
    const activationIntentInvalidated = definitionChanged
      || observed.status !== input.status
      || (input.trustStatus !== undefined && observed.trustStatus !== input.trustStatus)
      || (input.approvalPending !== undefined
        && (observed.approvalPending === true) !== (input.approvalPending === true))
      || (input.reviewedAt !== undefined
        && normalizedTimestamp(observed.reviewedAt) !== normalizedTimestamp(input.reviewedAt));
    const reactivated = isReactivatedTrustedSource(observed, input);
    const set = omitUndefined({
      ...input,
      ...ownership,
      ...(verificationEvidence ? { verificationEvidence } : {}),
      contentType,
      sourceName: normalizeDisplayText(input.sourceName, 160) || "Resmî akademik kaynak",
      sourceUrl: canonicalUrl,
      canonicalUrl,
      ...(homepageUrl ? { homepageUrl } : {}),
      ...(input.trustStatus ? { trustStatus: input.trustStatus } : {})
    } as unknown as Record<string, unknown>);
    delete set.id;
    delete set.activeSnapshotId;
    delete set.sourceDefinitionVersion;
    delete set.notificationProducerVersion;
    delete set.snapshotStateRevision;
    delete set.pendingSnapshotId;
    delete set.pendingSnapshotRevision;
    delete set.pendingSnapshotExpiresAt;
    delete set.snapshotIntentRevision;
    if (definitionChanged) set.sourceDefinitionVersion = newSourceDefinitionVersion();
    if (reactivated) set.notificationProducerVersion = newSourceDefinitionVersion();
    if (definitionChanged) {
      for (const field of sourceValidatorFields) delete set[field];
    }
    const expectedCanonicalUrl = canonicalizeContentUrl(fence.expectedCanonicalUrl);
    if (!expectedCanonicalUrl) return null;
    const document = await model.findOneAndUpdate({
      _id: id,
      ...sourceReviewFenceFilter({ ...fence, expectedCanonicalUrl }),
      updatedAt: fence.expectedUpdatedAt,
      ...(definitionChanged ? snapshotStateFenceFilter(
        observed.activeSnapshotId ?? null,
        snapshotStateRevisionFor(observed)
      ) : {})
    }, {
      $set: set,
      ...(definitionChanged || activationIntentInvalidated ? {
        $inc: {
          ...(definitionChanged ? { snapshotStateRevision: 1 } : {}),
          ...(activationIntentInvalidated ? { snapshotIntentRevision: 1 } : {})
        }
      } : {}),
      ...(activationIntentInvalidated ? {
        $unset: {
          ...snapshotActivationIntentUnset,
          ...(definitionChanged ? {
            ...sourceValidatorUnset,
            activeSnapshotId: 1,
            ...(!verificationEvidence ? { verificationEvidence: 1 } : {})
          } : {})
        }
      } : {})
    }, { new: true });
    if (!document) return null;
    const persisted = toDomainRecord<AnnouncementSourceRecord>(document);
    if (definitionChanged) {
      await this.retireSnapshotHistory(persisted, normalizedSnapshotId(observed.activeSnapshotId));
    }
    return persisted;
  }

  async reviewSource(
    id: string,
    input: AnnouncementSourceReviewMutation,
    fence: AnnouncementSourceReviewFence
  ): Promise<AnnouncementSourceRecord | null> {
    if (!isValidObjectId(id)) return null;
    const expectedCanonicalUrl = canonicalizeContentUrl(fence.expectedCanonicalUrl);
    if (!expectedCanonicalUrl) return null;
    const reactivated = fence.expectedSourceStatus !== "active" || fence.expectedTrustStatus !== "trusted";
    const set: Record<string, unknown> = {
      status: input.decision === "approve" ? "active" : "inactive",
      trustStatus: input.decision === "approve"
        ? "trusted"
        : input.decision === "reject" ? "rejected" : "quarantined",
      approvalPending: input.decision === "approve",
      ...(input.reviewedBy !== undefined ? { reviewedBy: input.reviewedBy } : {}),
      ...(input.reviewedAt !== undefined ? { reviewedAt: input.reviewedAt } : {}),
      ...(input.reviewNote !== undefined ? { reviewNote: input.reviewNote } : {})
    };
    if (input.decision === "approve") {
      set.trustReasonCodes = [];
      set.healthStatus = "pending";
      if (reactivated) set.notificationProducerVersion = newSourceDefinitionVersion();
    }
    const update: Record<string, unknown> = {
      $set: set,
      $inc: { snapshotIntentRevision: 1 },
      $unset: {
        ...snapshotActivationIntentUnset,
        ...(input.decision === "approve" ? { lastError: 1 } : {})
      },
      ...(input.decision === "quarantine" && (input.trustReasonCodes?.length ?? 0) > 0
        ? { $addToSet: { trustReasonCodes: { $each: [...new Set(input.trustReasonCodes)].sort() } } }
        : {})
    };
    const document = await (await this.model("AnnouncementSource", announcementSourceSchema)).findOneAndUpdate({
      _id: id,
      ...sourceReviewFenceFilter({ ...fence, expectedCanonicalUrl })
    }, update, { new: true });
    return document ? toDomainRecord<AnnouncementSourceRecord>(document) : null;
  }

  async completeSourceApproval(
    id: string,
    expectedDefinition: AnnouncementSourceDefinitionFence,
    expectedActiveSnapshotId: string | null
  ): Promise<AnnouncementSourceRecord | null> {
    if (!isValidObjectId(id)) return null;
    const document = await (await this.model("AnnouncementSource", announcementSourceSchema)).findOneAndUpdate({
      _id: id,
      status: "active",
      trustStatus: "trusted",
      approvalPending: true,
      healthStatus: "healthy",
      itemCount: { $gt: 0 },
      ...sourceDefinitionFenceFilter(expectedDefinition),
      ...snapshotPointerFenceFilter(expectedActiveSnapshotId)
    }, {
      $set: { approvalPending: false },
      $inc: { snapshotIntentRevision: 1 },
      $unset: snapshotActivationIntentUnset
    }, { new: true });
    return document ? toDomainRecord<AnnouncementSourceRecord>(document) : null;
  }

  async insertQuarantinedSourceCandidate(input: AnnouncementSourceCandidateInput): Promise<AnnouncementSourceRecord> {
    const model = await this.model("AnnouncementSource", announcementSourceSchema);
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
    const identityKey = canonicalAnnouncementSourceIdentityKey(canonicalUrl);
    const candidateId = createAnnouncementSourceCandidateId({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      sourceUrl: canonicalUrl,
      contentType
    });
    if (!identityKey || !candidateId) throw new Error("ANNOUNCEMENT_SOURCE_CANDIDATE_ID_INVALID");
    const scopedDocuments = await model.find({ scopeType: input.scopeType, scopeId: input.scopeId });
    const aliasMatch = scopedDocuments.find((candidate) => {
      const record = toDomainRecord<AnnouncementSourceRecord>(candidate);
      return (record.contentType ?? "announcement") === contentType
        && canonicalAnnouncementSourceIdentityKey(record.canonicalUrl ?? record.sourceUrl) === identityKey;
    });
    if (aliasMatch) {
      const existing = toDomainRecord<AnnouncementSourceRecord>(aliasMatch);
      assertAnnouncementSourceOwnershipImmutable(existing, input);
      if (verificationEvidence) {
        const attached = await this.attachVerificationEvidenceIfMissing(existing.id, verificationEvidence);
        if (attached?.outcome === "conflict") throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_EVIDENCE_CONFLICT");
        return attached?.source ?? existing;
      }
      return existing;
    }

    const now = new Date();
    const candidate = omitUndefined({
      ...input,
      ...ownership,
      ...(verificationEvidence ? { verificationEvidence } : {}),
      contentType,
      sourceName: normalizeDisplayText(input.sourceName, 160) || "Resmî akademik kaynak",
      sourceUrl: canonicalUrl,
      canonicalUrl,
      ...(homepageUrl ? { homepageUrl } : {}),
      status: "inactive",
      trustStatus: "quarantined",
      approvalPending: false,
      sourceDefinitionVersion: newSourceDefinitionVersion(),
      notificationProducerVersion: newSourceDefinitionVersion(),
      snapshotStateRevision: 0,
      snapshotIntentRevision: 0,
      discoveredAt: input.discoveredAt ?? now,
      createdAt: now,
      updatedAt: now
    } as unknown as Record<string, unknown>);
    delete candidate.activeSnapshotId;
    delete candidate.pendingSnapshotId;
    delete candidate.pendingSnapshotRevision;
    delete candidate.pendingSnapshotExpiresAt;
    const document = await model.findOneAndUpdate(
      { _id: candidateId },
      { $setOnInsert: candidate },
      { new: true, upsert: true, setDefaultsOnInsert: false, timestamps: false }
    );
    if (!document) throw new Error("ANNOUNCEMENT_SOURCE_CANDIDATE_INSERT_FAILED");
    const persisted = toDomainRecord<AnnouncementSourceRecord>(document);
    if (
      persisted.scopeType !== input.scopeType
      || persisted.scopeId !== input.scopeId
      || (persisted.contentType ?? "announcement") !== contentType
      || canonicalAnnouncementSourceIdentityKey(persisted.canonicalUrl ?? persisted.sourceUrl) !== identityKey
    ) {
      throw new Error("ANNOUNCEMENT_SOURCE_CANDIDATE_ID_COLLISION");
    }
    if (verificationEvidence) {
      const attached = await this.attachVerificationEvidenceIfMissing(persisted.id, verificationEvidence);
      if (attached?.outcome === "conflict") throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_EVIDENCE_CONFLICT");
      return attached?.source ?? persisted;
    }
    return persisted;
  }

  async recordSourceCheck(
    id: string,
    input: SourceCheckInput,
    expectedDefinition?: AnnouncementSourceDefinitionFence,
    expectedActiveSnapshotId?: string | null
  ): Promise<AnnouncementSourceRecord | null> {
    const model = await this.model("AnnouncementSource", announcementSourceSchema);
    const update = {
      $set: omitUndefined(input as unknown as Record<string, unknown>),
      ...(input.healthStatus === "healthy" ? { $unset: { lastError: 1 } } : {})
    };
    const document = expectedDefinition || expectedActiveSnapshotId !== undefined
      ? await model.findOneAndUpdate({
          _id: id,
          ...(expectedDefinition ? sourceDefinitionFenceFilter(expectedDefinition) : {}),
          ...(expectedActiveSnapshotId !== undefined ? snapshotPointerFenceFilter(expectedActiveSnapshotId) : {})
        }, update, { new: true })
      : await model.findByIdAndUpdate(id, update, { new: true });
    return document ? toDomainRecord<AnnouncementSourceRecord>(document) : null;
  }

  async recordSourceHealthProbe(
    id: string,
    input: SourceHealthProbeInput,
    expectedDefinition: AnnouncementSourceDefinitionFence
  ): Promise<AnnouncementSourceRecord | null> {
    if (!isValidObjectId(id)) return null;
    const document = await (await this.model("AnnouncementSource", announcementSourceSchema)).findOneAndUpdate({
      _id: id,
      ...sourceDefinitionFenceFilter(expectedDefinition)
    }, {
      $set: { healthProbe: omitUndefined(input as unknown as Record<string, unknown>) }
    }, { new: true });
    return document ? toDomainRecord<AnnouncementSourceRecord>(document) : null;
  }

  async quarantineSource(
    id: string,
    reasonCodes: AnnouncementTrustReason[],
    expectedDefinition?: AnnouncementSourceDefinitionFence
  ): Promise<AnnouncementSourceRecord | null> {
    if (!isValidObjectId(id)) return null;
    const model = await this.model("AnnouncementSource", announcementSourceSchema);
    const document = await model.findOneAndUpdate({
      _id: id,
      ...(expectedDefinition ? sourceDefinitionFenceFilter(expectedDefinition) : {})
    }, {
      $set: { status: "inactive", trustStatus: "quarantined", approvalPending: false },
      $inc: { snapshotIntentRevision: 1 },
      $unset: snapshotActivationIntentUnset,
      $addToSet: { trustReasonCodes: { $each: [...new Set(reasonCodes)].sort() } }
    }, { new: true });
    return document ? toDomainRecord<AnnouncementSourceRecord>(document) : null;
  }

  async deactivateSource(id: string, fence: AnnouncementSourceReviewFence): Promise<AnnouncementSourceRecord | null> {
    if (!isValidObjectId(id)) return null;
    const expectedCanonicalUrl = canonicalizeContentUrl(fence.expectedCanonicalUrl);
    if (!expectedCanonicalUrl) return null;
    const document = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .findOneAndUpdate({
        _id: id,
        ...sourceReviewFenceFilter({ ...fence, expectedCanonicalUrl })
      }, {
        $set: { status: "inactive", approvalPending: false },
        $inc: { snapshotIntentRevision: 1 },
        $unset: snapshotActivationIntentUnset
      }, { new: true });
    return document ? toDomainRecord<AnnouncementSourceRecord>(document) : null;
  }

  async replaceItemsForSource(source: AnnouncementSourceRecord, items: AnnouncementItem[], options: AnnouncementReplacementOptions = {}): Promise<AnnouncementPersistenceDelta> {
    // Historical focused tests inject only an AnnouncementItem model. Keep
    // that narrow compatibility path; configured Mongo uses atomic snapshot
    // activation and does not require replica-set transactions.
    if (!this.supportsSnapshotPersistence()) return this.persistLegacyItemsForSource(source, items, options);
    return this.persistSnapshotItemsForSource(source, items, options);
  }

  private async persistSnapshotItemsForSource(
    requestedSource: AnnouncementSourceRecord,
    items: AnnouncementItem[],
    options: AnnouncementReplacementOptions
  ): Promise<AnnouncementPersistenceDelta> {
    const sourceModel = await this.model("AnnouncementSource", announcementSourceSchema);
    const snapshotModel = await this.model("AnnouncementSnapshot", announcementSnapshotSchema);
    const legacyItemModel = await this.model("AnnouncementItem", announcementItemSchema);

    const sourceDocument = await sourceModel.findOne({
      _id: requestedSource.id,
      status: "active",
      trustStatus: "trusted"
    });
    if (!sourceDocument) throw new Error("ANNOUNCEMENT_SNAPSHOT_SOURCE_NOT_ACTIVE");
    const source = toDomainRecord<AnnouncementSourceRecord>(sourceDocument);
    if (!sameSourceDefinition(source, requestedSource)) {
      throw new Error("ANNOUNCEMENT_SOURCE_DEFINITION_CHANGED");
    }
    const expectedSourceRevision = snapshotStateRevisionFor(source);
    if (expectedSourceRevision !== snapshotStateRevisionFor(requestedSource)) {
      throw new Error("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");
    }
    const expectedSnapshotId = normalizedSnapshotId(source.activeSnapshotId);
    if (expectedSnapshotId !== normalizedSnapshotId(requestedSource.activeSnapshotId)) {
      throw new Error("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");
    }
    let existingItems: AnnouncementItem[];
    let activeSnapshotHash: string | undefined;

    if (expectedSnapshotId) {
      const activeSnapshot = await snapshotModel.findOne({
        _id: expectedSnapshotId,
        sourceId: source.id
      });
      if (!activeSnapshot) {
        try {
          await this.finalizeSnapshotActivation(
            sourceModel,
            snapshotModel,
            source,
            expectedSnapshotId,
            expectedSourceRevision,
            snapshotIntentRevisionFor(source)
          );
        } catch {
          throw new Error("ANNOUNCEMENT_ACTIVE_SNAPSHOT_MISSING");
        }
        throw new Error("ANNOUNCEMENT_ACTIVE_SNAPSHOT_MISSING");
      }
      const activeSnapshotRecord = toDomainRecord<AnnouncementSnapshotRecord>(activeSnapshot);
      if (!snapshotMatchesSourceState(source, activeSnapshotRecord)) {
        try {
          await this.finalizeSnapshotActivation(
            sourceModel,
            snapshotModel,
            source,
            expectedSnapshotId,
            expectedSourceRevision,
            snapshotIntentRevisionFor(source)
          );
        } catch {
          throw new Error("ANNOUNCEMENT_ACTIVE_SNAPSHOT_REVISION_MISMATCH");
        }
        throw new Error("ANNOUNCEMENT_ACTIVE_SNAPSHOT_REVISION_MISMATCH");
      }
      activeSnapshotHash = activeSnapshotRecord.snapshotHash;
      existingItems = itemsFromSnapshot(activeSnapshot, source.id, expectedSnapshotId);
    } else if (expectedSourceRevision === 0) {
      const existingDocuments = await legacyItemModel.find({ sourceId: source.id });
      existingItems = existingDocuments.map((document) => toDomainRecord<AnnouncementItem>(document));
    } else {
      // A missing pointer after generation zero is an intentional
      // invalidation, not a legacy source. Carrying rows across that boundary
      // would restore review/notification state from an obsolete definition.
      existingItems = [];
    }

    const plan = planAnnouncementReplacement(source, items, existingItems, options);
    if (plan.entries.length === 0 && plan.removed.length === 0) {
      if (expectedSnapshotId) {
        await this.finalizeSnapshotActivation(
          sourceModel,
          snapshotModel,
          source,
          expectedSnapshotId,
          expectedSourceRevision,
          snapshotIntentRevisionFor(source)
        );
      }
      return emptyAnnouncementPersistenceDelta();
    }

    const snapshotId = new Types.ObjectId().toHexString();
    const snapshotItems = plan.entries.map(({ item, previous, contentMateriallyUpdated, reviewMateriallyUpdated }) => {
      const discoveredAt = previous?.discoveredAt ?? item.discoveredAt ?? item.fetchedAt;
      const reviewedItem = carryAnnouncementReviewState(item, previous, contentMateriallyUpdated, reviewMateriallyUpdated);
      return omitUndefined({
        ...reviewedItem,
        reviewRevision: reviewedItem.reviewRevision ?? new Types.ObjectId().toHexString(),
        id: previous?.id ?? new Types.ObjectId().toHexString(),
        sourceId: source.id,
        snapshotId,
        sourceName: source.sourceName,
        officialSourceUrl: source.canonicalUrl ?? source.sourceUrl,
        contentType: item.contentType ?? source.contentType ?? "announcement",
        scopeType: source.scopeType,
        scopeId: source.scopeId,
        ...(discoveredAt ? { discoveredAt } : {})
      } as unknown as Record<string, unknown>) as unknown as AnnouncementItem;
    });
    const snapshotHash = snapshotHashFor(snapshotItems);
    if (expectedSnapshotId && activeSnapshotHash === snapshotHash) {
      await this.finalizeSnapshotActivation(
        sourceModel,
        snapshotModel,
        source,
        expectedSnapshotId,
        expectedSourceRevision,
        snapshotIntentRevisionFor(source)
      );
      return {
        ...snapshotDelta(
          plan,
          snapshotItems.map((item) => ({ ...item, snapshotId: expectedSnapshotId }))
        ),
        snapshotId: expectedSnapshotId
      };
    }
    const delta: AnnouncementPersistenceDelta = {
      ...snapshotDelta(plan, snapshotItems),
      snapshotId,
      ...(expectedSnapshotId ? { previousSnapshotId: expectedSnapshotId } : {})
    };

    if (!await this.reserveAndStageSnapshot(
      sourceModel,
      snapshotModel,
      source,
      expectedSnapshotId,
      expectedSourceRevision,
      snapshotId,
      snapshotItems,
      snapshotHash,
      { status: "active", trustStatus: "trusted" }
    )) {
      throw new Error("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");
    }

    let activated;
    try {
      activated = await sourceModel.findOneAndUpdate({
        _id: source.id,
        status: "active",
        trustStatus: "trusted",
        ...sourceDefinitionFenceFilter(source),
        ...snapshotStateFenceFilter(expectedSnapshotId ?? null, expectedSourceRevision),
        ...snapshotActivationIntentFenceFilter(
          snapshotId,
          expectedSourceRevision + 1,
          snapshotIntentRevisionFor(source) + 1
        )
      }, {
        $set: { activeSnapshotId: snapshotId },
        $inc: { snapshotStateRevision: 1 },
        $unset: snapshotActivationIntentUnset
      }, { new: true });
    } catch (error) {
      // A response failure makes activation indeterminate. Even when the
      // pointer has since advanced, this snapshot may have been visible to a
      // reader that already loaded it. Never delete an indeterminate stage.
      try {
        const currentAfterError = await sourceModel.findOne({ _id: source.id });
        if (currentAfterError) {
          const currentSource = toDomainRecord<AnnouncementSourceRecord>(currentAfterError);
          const currentSnapshotId = normalizedSnapshotId(currentSource.activeSnapshotId);
          if (
            currentSnapshotId === snapshotId
            && snapshotStateRevisionFor(currentSource) === expectedSourceRevision + 1
          ) {
            await this.finalizeSnapshotActivation(
              sourceModel,
              snapshotModel,
              currentSource,
              snapshotId,
              expectedSourceRevision + 1,
              snapshotIntentRevisionFor(source) + 1,
              expectedSnapshotId
            );
            return delta;
          }
          if (
            currentSnapshotId !== snapshotId
            && snapshotStateRevisionFor(currentSource) >= expectedSourceRevision + 1
          ) {
            await bestEffortRetireSnapshot(snapshotModel, snapshotId);
          }
        }
      } catch {
        // Preserve the staged snapshot when verification is unavailable too.
      }
      throw error;
    }

    if (activated) {
      await this.finalizeSnapshotActivation(
        sourceModel,
        snapshotModel,
        toDomainRecord<AnnouncementSourceRecord>(activated),
        snapshotId,
        expectedSourceRevision + 1,
        snapshotIntentRevisionFor(source) + 1,
        expectedSnapshotId
      );
      return delta;
    }
    // A definitive CAS miss means another writer or a definition edit won.
    // Do not replay stale fetched items over that newer state.
    await this.clearSnapshotActivationIntent(
      sourceModel,
      source.id,
      expectedSnapshotId,
      expectedSourceRevision,
      snapshotId,
      expectedSourceRevision + 1,
      snapshotIntentRevisionFor(source) + 1
    );
    await bestEffortDeleteSnapshot(snapshotModel, snapshotId);
    throw new Error("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");
  }

  private async persistLegacyItemsForSource(
    source: AnnouncementSourceRecord,
    items: AnnouncementItem[],
    options: AnnouncementReplacementOptions
  ): Promise<AnnouncementPersistenceDelta> {
    const model = await this.model("AnnouncementItem", announcementItemSchema);
    const existingDocuments = await model.find({ sourceId: source.id });
    const existingItems = existingDocuments.map((document) => toDomainRecord<AnnouncementItem>(document));
    const plan = planAnnouncementReplacement(source, items, existingItems, options);
    if (plan.entries.length === 0 && plan.removed.length === 0) return emptyAnnouncementPersistenceDelta();
    const delta = emptyAnnouncementPersistenceDelta();
    const removedIds = plan.removed.map((item) => item.id);

    for (const { item, previous, contentMateriallyUpdated, reviewMateriallyUpdated, materiallyUpdated } of plan.entries) {
      const discoveredAt = previous?.discoveredAt ?? item.discoveredAt ?? item.fetchedAt;
      const reviewedItem = carryAnnouncementReviewState(item, previous, contentMateriallyUpdated, reviewMateriallyUpdated);
      const persisted: AnnouncementItem = {
        ...reviewedItem,
        reviewRevision: reviewedItem.reviewRevision ?? new Types.ObjectId().toHexString(),
        id: previous?.id ?? item.id,
        sourceId: source.id,
        sourceName: source.sourceName,
        officialSourceUrl: source.canonicalUrl ?? source.sourceUrl,
        contentType: item.contentType ?? source.contentType ?? "announcement",
        scopeType: source.scopeType,
        scopeId: source.scopeId,
        ...(discoveredAt ? { discoveredAt } : {})
      };
      const value = omitUndefined(persisted as unknown as Record<string, unknown>);
      delete value.id;
      let persistedId: string;
      if (previous) {
        const updated = await model.findByIdAndUpdate(previous.id, value, { new: true });
        if (!updated) throw new Error("ANNOUNCEMENT_ITEM_UPDATE_FAILED");
        persistedId = updated.id;
      } else {
        const created = await model.create(value);
        if (!created) throw new Error("ANNOUNCEMENT_ITEM_CREATE_FAILED");
        persistedId = created.id;
      }
      const reference = toPersistenceReference(persisted, persistedId);
      if (!reference) continue;
      if (!previous) delta.created.push(reference);
      else if (materiallyUpdated) delta.materiallyUpdated.push(reference);
      else delta.unchanged.push(reference);
    }
    // Retire the previous rows only after every replacement row is durable. A
    // failed write therefore leaves the last complete trusted snapshot intact.
    if (removedIds.length > 0) {
      await model.deleteMany({ _id: { $in: removedIds }, trustStatus: "trusted" });
    }
    for (const removed of plan.removed) {
      const reference = toPersistenceReference(removed);
      if (reference) delta.removed.push(reference);
    }
    return delta;
  }

  async acknowledgeNotificationProduction(references: readonly AnnouncementPersistenceReference[]): Promise<number> {
    if (!this.supportsSnapshotPersistence()) return this.acknowledgeLegacyNotificationProduction(references);

    const sourceModel = await this.model("AnnouncementSource", announcementSourceSchema);
    const snapshotModel = await this.model("AnnouncementSnapshot", announcementSnapshotSchema);
    const legacyItemModel = await this.model("AnnouncementItem", announcementItemSchema);
    let acknowledged = 0;
    const visited = new Set<string>();
    for (const reference of references) {
      const key = `${reference.sourceId}\u0000${reference.id}\u0000${reference.contentFingerprint}`;
      if (visited.has(key)) continue;
      visited.add(key);

      let didAcknowledge = false;
      for (let attempt = 0; attempt < SNAPSHOT_CAS_ATTEMPTS; attempt += 1) {
        const sourceDocument = await sourceModel.findOne({
          _id: reference.sourceId,
          scopeType: reference.scopeType,
          scopeId: reference.scopeId,
          status: "active",
          trustStatus: "trusted",
          approvalPending: { $ne: true }
        });
        if (!sourceDocument) break;
        const source = toDomainRecord<AnnouncementSourceRecord>(sourceDocument);
        const activeSnapshotId = normalizedSnapshotId(source.activeSnapshotId);
        const expectedSourceRevision = snapshotStateRevisionFor(source);
        let activeItems: AnnouncementItem[];
        if (!activeSnapshotId) {
          // Revision zero is the only state allowed to migrate legacy rows.
          // A positive revision with no pointer means a definition edit
          // intentionally invalidated every earlier snapshot.
          if (expectedSourceRevision !== 0) break;
          const legacyDocuments = await legacyItemModel.find({
            sourceId: reference.sourceId,
            trustStatus: "trusted"
          }).limit(REVIEW_SOURCE_ITEM_LIMIT + 1);
          if (legacyDocuments.length > REVIEW_SOURCE_ITEM_LIMIT) {
            throw new Error("ANNOUNCEMENT_NOTIFICATION_SOURCE_TOO_LARGE");
          }
          activeItems = legacyDocuments.map((candidate) => toDomainRecord<AnnouncementItem>(candidate));
        } else {
          const activeSnapshot = await snapshotModel.findOne({
            _id: activeSnapshotId,
            sourceId: reference.sourceId
          });
          if (!activeSnapshot) {
            await this.finalizeSnapshotActivation(
              sourceModel,
              snapshotModel,
              source,
              activeSnapshotId,
              expectedSourceRevision,
              snapshotIntentRevisionFor(source)
            );
            break;
          }
          const snapshot = toDomainRecord<AnnouncementSnapshotRecord>(activeSnapshot);
          if (!snapshotMatchesSourceState(source, snapshot)) {
            await this.finalizeSnapshotActivation(
              sourceModel,
              snapshotModel,
              source,
              activeSnapshotId,
              expectedSourceRevision,
              snapshotIntentRevisionFor(source)
            );
            break;
          }
          activeItems = itemsFromSnapshot(activeSnapshot, source.id, activeSnapshotId);
        }

        const target = activeItems.find((item) => notificationReferenceMatches(item, reference));
        if (!target) break;
        if (target.notificationProducedFingerprint === reference.contentFingerprint) {
          if (activeSnapshotId) {
            await this.finalizeSnapshotActivation(
              sourceModel,
              snapshotModel,
              source,
              activeSnapshotId,
              expectedSourceRevision,
              snapshotIntentRevisionFor(source)
            );
          }
          didAcknowledge = true;
          break;
        }

        const newSnapshotId = new Types.ObjectId().toHexString();
        const nextItems = activeItems.map((item) => ({
          ...item,
          snapshotId: newSnapshotId,
          ...(item.id === target.id
            ? { notificationProducedFingerprint: reference.contentFingerprint }
            : {})
        }));
        if (!await this.reserveAndStageSnapshot(
          sourceModel,
          snapshotModel,
          source,
          activeSnapshotId,
          expectedSourceRevision,
          newSnapshotId,
          nextItems,
          snapshotHashFor(nextItems),
          {
            scopeType: reference.scopeType,
            scopeId: reference.scopeId,
            status: "active",
            trustStatus: "trusted",
            approvalPending: { $ne: true }
          }
        )) {
          continue;
        }

        let activated;
        try {
          activated = await sourceModel.findOneAndUpdate({
            _id: reference.sourceId,
            scopeType: reference.scopeType,
            scopeId: reference.scopeId,
            status: "active",
            trustStatus: "trusted",
            approvalPending: { $ne: true },
            ...snapshotStateFenceFilter(activeSnapshotId ?? null, expectedSourceRevision),
            ...snapshotActivationIntentFenceFilter(
              newSnapshotId,
              expectedSourceRevision + 1,
              snapshotIntentRevisionFor(source) + 1
            )
          }, {
            $set: { activeSnapshotId: newSnapshotId },
            $inc: { snapshotStateRevision: 1 },
            $unset: snapshotActivationIntentUnset
          }, { new: true });
        } catch (error) {
          let currentDocument;
          try {
            currentDocument = await sourceModel.findOne({ _id: reference.sourceId });
          } catch {
            throw error;
          }
          if (!currentDocument) throw error;
          const currentSource = toDomainRecord<AnnouncementSourceRecord>(currentDocument);
          if (
            normalizedSnapshotId(currentSource.activeSnapshotId) === newSnapshotId
            && snapshotStateRevisionFor(currentSource) === expectedSourceRevision + 1
          ) {
            activated = currentDocument;
          } else if (
            normalizedSnapshotId(currentSource.activeSnapshotId) !== newSnapshotId
            && snapshotStateRevisionFor(currentSource) >= expectedSourceRevision + 1
          ) {
            await bestEffortRetireSnapshot(snapshotModel, newSnapshotId);
            continue;
          } else {
            throw error;
          }
        }
        if (!activated) {
          await this.clearSnapshotActivationIntent(
            sourceModel,
            source.id,
            activeSnapshotId,
            expectedSourceRevision,
            newSnapshotId,
            expectedSourceRevision + 1,
            snapshotIntentRevisionFor(source) + 1
          );
          await bestEffortDeleteSnapshot(snapshotModel, newSnapshotId);
          continue;
        }
        await this.finalizeSnapshotActivation(
          sourceModel,
          snapshotModel,
          toDomainRecord<AnnouncementSourceRecord>(activated),
          newSnapshotId,
          expectedSourceRevision + 1,
          snapshotIntentRevisionFor(source) + 1,
          activeSnapshotId
        );
        didAcknowledge = true;
        break;
      }
      if (didAcknowledge) acknowledged += 1;
    }
    return acknowledged;
  }

  private async acknowledgeLegacyNotificationProduction(
    references: readonly AnnouncementPersistenceReference[]
  ): Promise<number> {
    const model = await this.model("AnnouncementItem", announcementItemSchema);
    let acknowledged = 0;
    const visited = new Set<string>();
    for (const reference of references) {
      const key = `${reference.sourceId}\u0000${reference.id}\u0000${reference.contentFingerprint}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (await acknowledgeLegacyReference(model, reference)) acknowledged += 1;
    }
    return acknowledged;
  }

  async listItemsForSource(sourceId: string, limit = 1_000, offset = 0): Promise<AnnouncementItem[]> {
    const sourceDocument = await (await this.model("AnnouncementSource", announcementSourceSchema)).findOne({
      _id: sourceId,
      status: "active",
      trustStatus: "trusted",
      approvalPending: { $ne: true }
    });
    if (!sourceDocument) return [];
    const source = toDomainRecord<AnnouncementSourceRecord>(sourceDocument);
    return (await this.loadVisibleItemsForSources([source], offset + limit, true))
      .sort(compareMongoAnnouncementItems)
      .slice(offset, offset + limit);
  }

  async listItemsByScope(input: { universityId: string; facultyId?: string; departmentId?: string; limit: number }): Promise<AnnouncementItem[]> {
    const matchers: Array<Record<string, string>> = [{ scopeType: "university", scopeId: input.universityId }];
    if (input.facultyId) matchers.push({ scopeType: "faculty", scopeId: input.facultyId });
    if (input.departmentId) matchers.push({ scopeType: "department", scopeId: input.departmentId });
    const sourceDocuments = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", trustStatus: "trusted", approvalPending: { $ne: true }, $or: matchers });
    const sources = sourceDocuments.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
    if (sources.length === 0) return [];
    return (await this.loadVisibleItemsForSources(sources, input.limit))
      .sort(compareMongoAnnouncementItems)
      .slice(0, input.limit);
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

    const sourceDocuments = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", trustStatus: "trusted", approvalPending: { $ne: true }, $or: matchers });
    if (sourceDocuments.length === 0) return null;
    const sourceById = new Map(sourceDocuments.map((document) => {
      const source = toDomainRecord<AnnouncementSourceRecord>(document);
      return [source.id, source] as const;
    }));
    const snapshotSources = [...sourceById.values()].filter((source) => normalizedSnapshotId(source.activeSnapshotId));
    if (snapshotSources.length > 0) {
      const snapshotDocuments = await (await this.model("AnnouncementSnapshot", announcementSnapshotSchema)).find({
        _id: { $in: snapshotSources.map((source) => source.activeSnapshotId) }
      });
      for (const snapshotDocument of snapshotDocuments) {
        const snapshot = toDomainRecord<AnnouncementSnapshotRecord>(snapshotDocument);
        const source = sourceById.get(snapshot.sourceId);
        if (!source || source.activeSnapshotId !== snapshot.id || !snapshotMatchesSourceState(source, snapshot)) continue;
        const item = itemsFromSnapshot(snapshotDocument, source.id, snapshot.id)
          .find((candidate) => candidate.id === input.announcementId && isApiEligibleItem(candidate));
        if (item) return { item, source };
      }
    }

    const legacySourceIds = [...sourceById.values()]
      .filter(isLegacySnapshotState)
      .map((source) => source.id);
    if (legacySourceIds.length === 0) return null;
    const document = await (await this.model("AnnouncementItem", announcementItemSchema)).findOne({
      _id: input.announcementId,
      sourceId: { $in: legacySourceIds },
      trustStatus: "trusted",
      reviewStatus: "approved"
    });
    if (!document) return null;
    const item = toDomainRecord<AnnouncementItem>(document);
    const source = sourceById.get(item.sourceId);
    return source && isApiEligibleItem(item)
      ? { item, source }
      : null;
  }

  async findSavedAnnouncement(userId: string, announcementId: string): Promise<SavedAnnouncementRecord | null> {
    const document = await (await this.model("SavedAnnouncement", savedAnnouncementSchema))
      .findOne({ userId, announcementId });
    return document ? toDomainRecord<SavedAnnouncementRecord>(document) : null;
  }

  async saveAnnouncement(userId: string, announcementId: string, savedAt: Date): Promise<SavedAnnouncementRecord> {
    const document = await (await this.model("SavedAnnouncement", savedAnnouncementSchema)).findOneAndUpdate(
      { userId, announcementId },
      {
        $setOnInsert: { userId, announcementId, savedAt },
        $set: { updatedAt: savedAt }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    if (!document) throw new Error("SAVED_ANNOUNCEMENT_UPSERT_FAILED");
    return toDomainRecord<SavedAnnouncementRecord>(document);
  }

  async deleteSavedAnnouncement(userId: string, announcementId: string): Promise<boolean> {
    const result = await (await this.model("SavedAnnouncement", savedAnnouncementSchema))
      .deleteOne({ userId, announcementId });
    return result.deletedCount > 0;
  }

  async deleteSavedAnnouncementsByUserId(userId: string): Promise<void> {
    await (await this.model("SavedAnnouncement", savedAnnouncementSchema)).deleteMany({ userId });
  }

  async listAllItems(input: { limit?: number; offset?: number } = {}): Promise<AnnouncementItem[]> {
    const sourceDocuments = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", trustStatus: "trusted", approvalPending: { $ne: true } });
    const sources = sourceDocuments.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
    if (sources.length === 0) return [];
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 1000;
    return (await this.loadVisibleItemsForSources(sources, offset + limit))
      .sort(compareMongoAnnouncementItems)
      .slice(offset, offset + limit);
  }

  async listReviewItems(input: { sourceIds?: string[]; limit?: number; offset?: number } = {}): Promise<AnnouncementItem[]> {
    const sourceModel = await this.model("AnnouncementSource", announcementSourceSchema);
    const requestedSourceIds = input.sourceIds?.flatMap((id) => isValidObjectId(id) ? [new Types.ObjectId(id)] : []);
    if (input.sourceIds && requestedSourceIds?.length === 0) return [];
    const sourceMatch = {
      status: "active",
      trustStatus: "trusted",
      ...(requestedSourceIds ? { _id: { $in: requestedSourceIds } } : {})
    };
    const offset = Math.max(input.offset ?? 0, 0);
    const limit = Math.min(Math.max(input.limit ?? 1_000, 1), 1_000);
    if (typeof sourceModel.aggregate === "function") {
      const records = await sourceModel.aggregate([
        { $match: sourceMatch },
        { $match: { activeSnapshotId: { $type: "string" } } },
        {
          $lookup: {
            from: "announcement_snapshots",
            let: {
              activeSnapshotId: "$activeSnapshotId",
              sourceId: { $toString: "$_id" },
              sourceRevision: { $ifNull: ["$snapshotStateRevision", 0] }
            },
            pipeline: [{
              $match: {
                $expr: {
                  $and: [
                    { $eq: [{ $toString: "$_id" }, "$$activeSnapshotId"] },
                    { $eq: ["$sourceId", "$$sourceId"] },
                    { $eq: [{ $ifNull: ["$sourceRevision", 0] }, "$$sourceRevision"] }
                  ]
                }
              }
            }],
            as: "activeSnapshot"
          }
        },
        { $unwind: "$activeSnapshot" },
        { $unwind: "$activeSnapshot.items" },
        {
          $replaceWith: {
            $mergeObjects: [
              "$activeSnapshot.items",
              { snapshotId: { $toString: "$activeSnapshot._id" } }
            ]
          }
        },
        { $match: { trustStatus: "trusted" } },
        {
          $unionWith: {
            coll: "announcement_sources",
            pipeline: [
              { $match: sourceMatch },
              { $match: snapshotStateFenceFilter(null, 0) },
              {
                $lookup: {
                  from: "announcement_items",
                  let: { sourceId: { $toString: "$_id" } },
                  pipeline: [{
                    $match: {
                      trustStatus: "trusted",
                      $expr: { $eq: ["$sourceId", "$$sourceId"] }
                    }
                  }],
                  as: "legacyItem"
                }
              },
              { $unwind: "$legacyItem" },
              {
                $replaceWith: {
                  $mergeObjects: [
                    "$legacyItem",
                    { id: { $toString: "$legacyItem._id" } }
                  ]
                }
              }
            ]
          }
        },
        { $sort: { discoveredAt: -1, sourceUpdatedAt: -1, publishedAt: -1, publishedDate: -1, id: 1 } },
        { $skip: offset },
        { $limit: limit }
      ]);
      return (records as Array<Record<string, unknown>>).flatMap((record) => {
        const { _id, __v: _version, ...item } = record;
        const id = typeof item.id === "string" ? item.id : _id ? String(_id) : undefined;
        return id ? [{ ...item, id } as unknown as AnnouncementItem] : [];
      });
    }

    // Narrow test doubles without aggregation support keep the old read path.
    const sourceDocuments = await sourceModel.find({
      status: "active",
      trustStatus: "trusted",
      ...(input.sourceIds ? { _id: { $in: input.sourceIds } } : {})
    });
    const sources = sourceDocuments.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
    if (sources.length === 0) return [];
    return (await this.loadVisibleItemsForSources(sources, offset + limit, true))
      .sort(compareMongoAnnouncementItems)
      .slice(offset, offset + limit);
  }

  async findReviewItemById(id: string): Promise<{ item: AnnouncementItem; source: AnnouncementSourceRecord } | null> {
    if (!isValidObjectId(id)) return null;
    const sourceModel = await this.model("AnnouncementSource", announcementSourceSchema);
    if (this.supportsSnapshotPersistence()) {
      if (typeof sourceModel.aggregate === "function") {
        const [record] = await sourceModel.aggregate([
          { $match: { status: "active", trustStatus: "trusted", activeSnapshotId: { $type: "string" } } },
          {
            $lookup: {
              from: "announcement_snapshots",
              let: {
                activeSnapshotId: "$activeSnapshotId",
                sourceId: { $toString: "$_id" },
                sourceRevision: { $ifNull: ["$snapshotStateRevision", 0] }
              },
              pipeline: [
                { $match: { "items.id": id } },
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: [{ $toString: "$_id" }, "$$activeSnapshotId"] },
                        { $eq: ["$sourceId", "$$sourceId"] },
                        { $eq: [{ $ifNull: ["$sourceRevision", 0] }, "$$sourceRevision"] }
                      ]
                    }
                  }
                },
                { $limit: 1 }
              ],
              as: "activeReviewSnapshot"
            }
          },
          { $unwind: "$activeReviewSnapshot" },
          { $limit: 1 }
        ]);
        const active = reviewItemFromActiveSnapshotAggregate(record, id);
        if (active) return active;
      } else {
        const snapshotModel = await this.model("AnnouncementSnapshot", announcementSnapshotSchema);
        const sourceDocuments = await sourceModel.find({
          status: "active",
          trustStatus: "trusted",
          activeSnapshotId: { $type: "string" }
        });
        for (const sourceDocument of sourceDocuments) {
          const source = toDomainRecord<AnnouncementSourceRecord>(sourceDocument);
          const activeSnapshotId = normalizedSnapshotId(source.activeSnapshotId);
          if (!activeSnapshotId) continue;
          const snapshotDocument = await snapshotModel.findOne({
            _id: activeSnapshotId,
            sourceId: source.id,
            "items.id": id
          });
          if (!snapshotDocument) continue;
          if (!snapshotMatchesSourceState(
            source,
            toDomainRecord<AnnouncementSnapshotRecord>(snapshotDocument)
          )) continue;
          const item = itemsFromSnapshot(snapshotDocument, source.id, activeSnapshotId)
            .find((candidate) => candidate.id === id);
          if (item) return { item, source };
        }
      }
    }

    const legacyDocument = await (await this.model("AnnouncementItem", announcementItemSchema)).findOne({ _id: id });
    if (!legacyDocument) return null;
    const item = toDomainRecord<AnnouncementItem>(legacyDocument);
    // Once a source has an active snapshot, its legacy rows are historical and
    // must never be reviewable or selected as an update fallback.
    const sourceDocument = await sourceModel.findOne({
      _id: item.sourceId,
      status: "active",
      trustStatus: "trusted",
      ...snapshotStateFenceFilter(null, 0)
    });
    return sourceDocument
      ? { item, source: toDomainRecord<AnnouncementSourceRecord>(sourceDocument) }
      : null;
  }

  async updateReviewItem(
    id: string,
    input: AnnouncementReviewItemUpdate,
    fence: AnnouncementReviewFence
  ): Promise<AnnouncementReviewMutationResult | null> {
    const current = await this.findReviewItemById(id);
    if (!current) return null;
    if (!reviewFenceMatches(current.item, fence)) throw new AnnouncementReviewConflictError();
    if (!current.item.snapshotId) {
      const sourceModel = await this.model("AnnouncementSource", announcementSourceSchema);
      const snapshotModel = await this.model("AnnouncementSnapshot", announcementSnapshotSchema);
      const itemModel = await this.model("AnnouncementItem", announcementItemSchema);
      const expectedSourceRevision = snapshotStateRevisionFor(current.source);
      if (expectedSourceRevision !== 0 || normalizedSnapshotId(current.source.activeSnapshotId)) {
        throw new AnnouncementReviewConflictError();
      }
      const legacyDocuments = await itemModel.find({
        sourceId: current.source.id,
        trustStatus: "trusted"
      }).limit(REVIEW_SOURCE_ITEM_LIMIT + 1);
      if (legacyDocuments.length > REVIEW_SOURCE_ITEM_LIMIT) throw new Error("ANNOUNCEMENT_REVIEW_SOURCE_TOO_LARGE");
      const legacyItems = legacyDocuments.map((candidate) => toDomainRecord<AnnouncementItem>(candidate));
      const currentLegacyItem = legacyItems.find((candidate) => candidate.id === id);
      if (!currentLegacyItem || !reviewFenceMatches(currentLegacyItem, fence)) {
        throw new AnnouncementReviewConflictError();
      }

      const newSnapshotId = new Types.ObjectId().toHexString();
      const reviewRevision = new Types.ObjectId().toHexString();
      let updatedItem: AnnouncementItem | undefined;
      const definedInput = omitUndefined(input as unknown as Record<string, unknown>);
      const nextItems = legacyItems.map((candidate) => {
        const next = candidate.id === id
          ? { ...candidate, ...definedInput, reviewRevision } as AnnouncementItem
          : candidate;
        const stored = { ...next, snapshotId: newSnapshotId };
        if (candidate.id === id) updatedItem = stored;
        return stored;
      });
      if (!updatedItem) throw new AnnouncementReviewConflictError();

      if (!await this.reserveAndStageSnapshot(
        sourceModel,
        snapshotModel,
        current.source,
        undefined,
        expectedSourceRevision,
        newSnapshotId,
        nextItems,
        snapshotHashFor(nextItems),
        { status: "active", trustStatus: "trusted" }
      )) {
        throw new AnnouncementReviewConflictError();
      }
      let activated;
      try {
        activated = await sourceModel.findOneAndUpdate({
          _id: current.source.id,
          status: "active",
          trustStatus: "trusted",
          ...sourceDefinitionFenceFilter(current.source),
          ...snapshotStateFenceFilter(null, expectedSourceRevision),
          ...snapshotActivationIntentFenceFilter(
            newSnapshotId,
            expectedSourceRevision + 1,
            snapshotIntentRevisionFor(current.source) + 1
          )
        }, {
          $set: { activeSnapshotId: newSnapshotId },
          $inc: { snapshotStateRevision: 1 },
          $unset: snapshotActivationIntentUnset
        }, { new: true });
      } catch (error) {
        try {
          const currentAfterError = await sourceModel.findOne({ _id: current.source.id });
          if (currentAfterError) {
            const currentSource = toDomainRecord<AnnouncementSourceRecord>(currentAfterError);
            if (
              normalizedSnapshotId(currentSource.activeSnapshotId) === newSnapshotId
              && snapshotStateRevisionFor(currentSource) === expectedSourceRevision + 1
            ) {
              activated = currentAfterError;
            } else if (
              normalizedSnapshotId(currentSource.activeSnapshotId) !== newSnapshotId
              && snapshotStateRevisionFor(currentSource) >= expectedSourceRevision + 1
            ) {
              await bestEffortRetireSnapshot(snapshotModel, newSnapshotId);
            }
          }
        } catch {
          // Preserve the stage while the original activation may still commit.
        }
        if (!activated) throw error;
      }
      if (!activated) {
        await this.clearSnapshotActivationIntent(
          sourceModel,
          current.source.id,
          undefined,
          expectedSourceRevision,
          newSnapshotId,
          expectedSourceRevision + 1,
          snapshotIntentRevisionFor(current.source) + 1
        );
        await bestEffortDeleteSnapshot(snapshotModel, newSnapshotId);
        throw new AnnouncementReviewConflictError();
      }
      await this.finalizeSnapshotActivation(
        sourceModel,
        snapshotModel,
        toDomainRecord<AnnouncementSourceRecord>(activated),
        newSnapshotId,
        expectedSourceRevision + 1,
        snapshotIntentRevisionFor(current.source) + 1
      );
      return {
        item: updatedItem,
        source: toDomainRecord<AnnouncementSourceRecord>(activated),
        delta: reviewMutationDelta(nextItems, id, newSnapshotId)
      };
    }

    const sourceModel = await this.model("AnnouncementSource", announcementSourceSchema);
    const snapshotModel = await this.model("AnnouncementSnapshot", announcementSnapshotSchema);
    const activeSnapshotId = fence.expectedSnapshotId;
    const expectedSourceRevision = snapshotStateRevisionFor(current.source);
    if (!activeSnapshotId || activeSnapshotId !== current.item.snapshotId) {
      throw new AnnouncementReviewConflictError();
    }
    const activeSnapshot = await snapshotModel.findOne({
      _id: activeSnapshotId,
      sourceId: current.source.id
    });
    if (!activeSnapshot) throw new AnnouncementReviewConflictError();
    if (!snapshotMatchesSourceState(
      current.source,
      toDomainRecord<AnnouncementSnapshotRecord>(activeSnapshot)
    )) throw new AnnouncementReviewConflictError();
    const activeItems = itemsFromSnapshot(activeSnapshot, current.source.id, activeSnapshotId);
    const currentInSnapshot = activeItems.find((candidate) => candidate.id === id);
    if (!currentInSnapshot || !reviewFenceMatches(currentInSnapshot, fence)) {
      throw new AnnouncementReviewConflictError();
    }
    const newSnapshotId = new Types.ObjectId().toHexString();
    const reviewRevision = new Types.ObjectId().toHexString();
    let updatedItem: AnnouncementItem | undefined;
    const definedInput = omitUndefined(input as unknown as Record<string, unknown>);
    const nextItems: AnnouncementItem[] = activeItems.map((candidate) => {
      const next = candidate.id === id
        ? { ...candidate, ...definedInput, reviewRevision } as AnnouncementItem
        : candidate;
      const stored = { ...next, snapshotId: newSnapshotId } as AnnouncementItem;
      if (candidate.id === id) updatedItem = stored;
      return stored;
    });
    if (!updatedItem) return null;

    if (!await this.reserveAndStageSnapshot(
      sourceModel,
      snapshotModel,
      current.source,
      activeSnapshotId,
      expectedSourceRevision,
      newSnapshotId,
      nextItems,
      snapshotHashFor(nextItems),
      { status: "active", trustStatus: "trusted" }
    )) {
      throw new AnnouncementReviewConflictError();
    }
    let activated;
    try {
      activated = await sourceModel.findOneAndUpdate({
        _id: current.source.id,
        status: "active",
        trustStatus: "trusted",
        ...snapshotStateFenceFilter(activeSnapshotId, expectedSourceRevision),
        ...snapshotActivationIntentFenceFilter(
          newSnapshotId,
          expectedSourceRevision + 1,
          snapshotIntentRevisionFor(current.source) + 1
        )
      }, {
        $set: { activeSnapshotId: newSnapshotId },
        $inc: { snapshotStateRevision: 1 },
        $unset: snapshotActivationIntentUnset
      }, { new: true });
    } catch (error) {
      try {
        const currentAfterError = await sourceModel.findOne({ _id: current.source.id });
        if (currentAfterError) {
          const currentSource = toDomainRecord<AnnouncementSourceRecord>(currentAfterError);
          if (
            normalizedSnapshotId(currentSource.activeSnapshotId) === newSnapshotId
            && snapshotStateRevisionFor(currentSource) === expectedSourceRevision + 1
          ) {
            activated = currentAfterError;
          } else if (
            normalizedSnapshotId(currentSource.activeSnapshotId) !== newSnapshotId
            && snapshotStateRevisionFor(currentSource) >= expectedSourceRevision + 1
          ) {
            await bestEffortRetireSnapshot(snapshotModel, newSnapshotId);
          }
        }
      } catch {
        // Preserve the stage while the original activation may still commit.
      }
      if (!activated) throw error;
    }
    if (!activated) {
      await this.clearSnapshotActivationIntent(
        sourceModel,
        current.source.id,
        activeSnapshotId,
        expectedSourceRevision,
        newSnapshotId,
        expectedSourceRevision + 1,
        snapshotIntentRevisionFor(current.source) + 1
      );
      await bestEffortDeleteSnapshot(snapshotModel, newSnapshotId);
      throw new AnnouncementReviewConflictError();
    }
    await this.finalizeSnapshotActivation(
      sourceModel,
      snapshotModel,
      toDomainRecord<AnnouncementSourceRecord>(activated),
      newSnapshotId,
      expectedSourceRevision + 1,
      snapshotIntentRevisionFor(current.source) + 1,
      activeSnapshotId
    );
    return {
      item: updatedItem,
      source: toDomainRecord<AnnouncementSourceRecord>(activated),
      delta: reviewMutationDelta(nextItems, id, newSnapshotId, activeSnapshotId)
    };
  }

  private async loadVisibleItemsForSources(
    sources: readonly AnnouncementSourceRecord[],
    legacyLimit: number,
    includeAllReviewItems = false
  ): Promise<AnnouncementItem[]> {
    const visibleItems: AnnouncementItem[] = [];
    const snapshotSources = sources.filter((source) => normalizedSnapshotId(source.activeSnapshotId));
    if (snapshotSources.length > 0) {
      const snapshotDocuments = await (await this.model("AnnouncementSnapshot", announcementSnapshotSchema)).find({
        _id: { $in: snapshotSources.map((source) => source.activeSnapshotId) }
      });
      const snapshots = new Map(snapshotDocuments.map((document) => {
        const snapshot = toDomainRecord<AnnouncementSnapshotRecord>(document);
        return [snapshot.id, { document, snapshot }] as const;
      }));
      for (const source of snapshotSources) {
        const activeSnapshotId = normalizedSnapshotId(source.activeSnapshotId);
        if (!activeSnapshotId) continue;
        const entry = snapshots.get(activeSnapshotId);
        if (
          !entry
          || entry.snapshot.sourceId !== source.id
          || !snapshotMatchesSourceState(source, entry.snapshot)
        ) continue;
        visibleItems.push(...itemsFromSnapshot(entry.document, source.id, activeSnapshotId));
      }
    }

    const legacySourceIds = sources
      .filter(isLegacySnapshotState)
      .map((source) => source.id);
    if (legacySourceIds.length > 0 && legacyLimit > 0) {
      const documents = await (await this.model("AnnouncementItem", announcementItemSchema))
        .find({ sourceId: { $in: legacySourceIds }, trustStatus: "trusted" })
        .sort({ publishedAt: -1, sourceUpdatedAt: -1, publishedDate: -1, discoveredAt: -1 })
        .limit(legacyLimit);
      visibleItems.push(...documents.map((document) => toDomainRecord<AnnouncementItem>(document)));
    }
    return visibleItems.filter((item) =>
      item.trustStatus === "trusted" && (includeAllReviewItems || item.reviewStatus === "approved"));
  }

  async reconcileSnapshotRetention(): Promise<void> {
    if (!this.supportsSnapshotPersistence()) return;
    const now = Date.now();
    if (now - this.lastSnapshotRetentionReconciliationAt < SNAPSHOT_RECONCILIATION_INTERVAL_MS) return;
    const snapshotModel = await this.model("AnnouncementSnapshot", announcementSnapshotSchema);
    const abandonedBefore = new Date(now - SNAPSHOT_RETENTION_GRACE_MS);
    const dueAt = new Date(now);
    const nextRetentionCheckAt = new Date(now + SNAPSHOT_RETENTION_GRACE_MS);
    const candidateFilter = {
      purgeAfter: { $exists: false },
      createdAt: { $lte: abandonedBefore },
      $and: [
        {
          $or: [
            { nextRetentionCheckAt: { $exists: false } },
            { nextRetentionCheckAt: null },
            { nextRetentionCheckAt: { $lte: dueAt } }
          ]
        },
        {
          $or: [
            { activationLeaseUntil: { $exists: false } },
            { activationLeaseUntil: null },
            { activationLeaseUntil: { $lte: dueAt } }
          ]
        }
      ]
    };
    const candidates = await snapshotModel.aggregate([
      { $match: candidateFilter },
      { $sort: { nextRetentionCheckAt: 1, createdAt: 1 } },
      // Persistently advancing active rows caps source lookups at one batch
      // and is restart-safe: legacy active prefixes leave the due set instead
      // of being rediscovered forever.
      { $limit: SNAPSHOT_RECONCILIATION_BATCH_SIZE },
      {
        $lookup: {
          from: "announcement_sources",
          let: {
            sourceObjectId: {
              $convert: { input: "$sourceId", to: "objectId", onError: null, onNull: null }
            },
            snapshotId: { $toString: "$_id" },
            snapshotRevision: { $ifNull: ["$sourceRevision", 0] }
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    // Compare the indexed ObjectId field directly. Converting
                    // every source _id to a string would turn each candidate's
                    // lookup into a collection scan at production scale.
                    { $eq: ["$_id", "$$sourceObjectId"] },
                    {
                      $or: [
                        {
                          $and: [
                            { $eq: ["$activeSnapshotId", "$$snapshotId"] },
                            { $eq: [{ $ifNull: ["$snapshotStateRevision", 0] }, "$$snapshotRevision"] }
                          ]
                        },
                        {
                          $and: [
                            { $eq: ["$pendingSnapshotId", "$$snapshotId"] },
                            { $eq: ["$pendingSnapshotRevision", "$$snapshotRevision"] },
                            { $gt: ["$pendingSnapshotExpiresAt", "$$NOW"] }
                          ]
                        }
                      ]
                    }
                  ]
                }
              }
            },
            { $limit: 1 }
          ],
          as: "protectedSource"
        }
      },
      { $project: { _id: 1, protected: { $gt: [{ $size: "$protectedSource" }, 0] } } }
    ]);
    const candidateRecords = candidates as Array<{ _id?: unknown; protected?: boolean }>;
    const protectedIds = candidateRecords.flatMap((snapshot) =>
      snapshot._id !== undefined && snapshot.protected === true ? [String(snapshot._id)] : []);
    const retireIds = candidateRecords.flatMap((snapshot) =>
      snapshot._id !== undefined && snapshot.protected !== true ? [String(snapshot._id)] : []);
    if (protectedIds.length > 0) {
      await snapshotModel.updateMany({
        _id: { $in: protectedIds },
        ...candidateFilter
      }, {
        $set: { nextRetentionCheckAt }
      });
    }
    if (retireIds.length > 0) {
      await snapshotModel.updateMany({
        _id: { $in: retireIds },
        ...candidateFilter
      }, {
        $set: {
          purgeAfter: nextRetentionCheckAt,
          nextRetentionCheckAt
        },
        $unset: { activationLeaseUntil: 1 }
      });
    }
    this.lastSnapshotRetentionReconciliationAt = now;
  }

  private async reserveAndStageSnapshot(
    sourceModel: ReturnType<typeof getModel>,
    snapshotModel: ReturnType<typeof getModel>,
    source: AnnouncementSourceRecord,
    expectedSnapshotId: string | undefined,
    expectedSourceRevision: number,
    snapshotId: string,
    items: AnnouncementItem[],
    snapshotHash: string,
    sourceFilter: Record<string, unknown>
  ): Promise<boolean> {
    const sourceRevision = expectedSourceRevision + 1;
    const expectedIntentRevision = snapshotIntentRevisionFor(source);
    const reservedIntentRevision = expectedIntentRevision + 1;
    const pendingSnapshotExpiresAt = new Date(Date.now() + SNAPSHOT_RETENTION_GRACE_MS);
    try {
      const reserved = await sourceModel.findOneAndUpdate({
        _id: source.id,
        ...sourceFilter,
        ...sourceDefinitionFenceFilter(source),
        ...snapshotStateFenceFilter(expectedSnapshotId ?? null, expectedSourceRevision),
        ...snapshotIntentRevisionFenceFilter(expectedIntentRevision)
      }, {
        $set: {
          pendingSnapshotId: snapshotId,
          pendingSnapshotRevision: sourceRevision,
          pendingSnapshotExpiresAt
        },
        $inc: { snapshotIntentRevision: 1 }
      }, { new: true });
      if (!reserved) return false;
    } catch (error) {
      await this.fenceAmbiguousSnapshotReservation(
        sourceModel,
        source.id,
        expectedSnapshotId,
        expectedSourceRevision,
        snapshotId,
        sourceRevision,
        expectedIntentRevision,
        reservedIntentRevision
      );
      throw error;
    }

    try {
      await snapshotModel.create({
        _id: snapshotId,
        sourceId: source.id,
        sourceRevision,
        items,
        snapshotHash,
        ...snapshotRetentionLease()
      });
      if (await claimSnapshotForActivation(snapshotModel, snapshotId, source.id, sourceRevision)) {
        return true;
      }
    } catch (error) {
      await this.clearSnapshotActivationIntent(
        sourceModel,
        source.id,
        expectedSnapshotId,
        expectedSourceRevision,
        snapshotId,
        sourceRevision,
        reservedIntentRevision
      );
      await bestEffortDeleteSnapshot(snapshotModel, snapshotId);
      throw error;
    }

    await this.clearSnapshotActivationIntent(
      sourceModel,
      source.id,
      expectedSnapshotId,
      expectedSourceRevision,
      snapshotId,
      sourceRevision,
      reservedIntentRevision
    );
    await bestEffortDeleteSnapshot(snapshotModel, snapshotId);
    return false;
  }

  private async clearSnapshotActivationIntent(
    sourceModel: ReturnType<typeof getModel>,
    sourceId: string,
    expectedSnapshotId: string | undefined,
    expectedSourceRevision: number,
    pendingSnapshotId: string,
    pendingSnapshotRevision: number,
    snapshotIntentRevision: number
  ): Promise<void> {
    try {
      await sourceModel.findOneAndUpdate({
        _id: sourceId,
        ...snapshotStateFenceFilter(expectedSnapshotId ?? null, expectedSourceRevision),
        pendingSnapshotId,
        pendingSnapshotRevision,
        snapshotIntentRevision
      }, {
        $inc: { snapshotIntentRevision: 1 },
        $unset: snapshotActivationIntentUnset
      }, { new: true });
    } catch {
      // The expiring intent remains safe: a later writer can replace it, while
      // its expiry fences this writer and lets retention reclaim its stage.
    }
  }

  private async fenceAmbiguousSnapshotReservation(
    sourceModel: ReturnType<typeof getModel>,
    sourceId: string,
    expectedSnapshotId: string | undefined,
    expectedSourceRevision: number,
    pendingSnapshotId: string,
    pendingSnapshotRevision: number,
    expectedIntentRevision: number,
    reservedIntentRevision: number
  ): Promise<void> {
    try {
      await sourceModel.findOneAndUpdate({
        _id: sourceId,
        ...snapshotStateFenceFilter(expectedSnapshotId ?? null, expectedSourceRevision),
        ...snapshotIntentRevisionFenceFilter(expectedIntentRevision)
      }, {
        $inc: { snapshotIntentRevision: 1 },
        $unset: snapshotActivationIntentUnset
      }, { new: true });
    } catch {
      // The token-specific fence below still cannot overwrite a newer epoch.
    }
    try {
      await sourceModel.findOneAndUpdate({
        _id: sourceId,
        ...snapshotStateFenceFilter(expectedSnapshotId ?? null, expectedSourceRevision),
        pendingSnapshotId,
        pendingSnapshotRevision,
        snapshotIntentRevision: reservedIntentRevision
      }, {
        $inc: { snapshotIntentRevision: 1 },
        $unset: snapshotActivationIntentUnset
      }, { new: true });
    } catch {
      // A newer epoch or the eventual original reservation owns the outcome.
    }
  }

  private async retireSnapshotHistory(
    source: AnnouncementSourceRecord,
    predecessorSnapshotId?: string
  ): Promise<void> {
    if (!this.supportsSnapshotPersistence()) return;
    try {
      await bestEffortReconcileSnapshotRetention(
        await this.model("AnnouncementSnapshot", announcementSnapshotSchema),
        source,
        predecessorSnapshotId
      );
    } catch {
      // Retention repair must not turn a committed pointer swap into an
      // indeterminate application-level failure.
    }
  }

  private async finalizeSnapshotActivation(
    sourceModel: ReturnType<typeof getModel>,
    snapshotModel: ReturnType<typeof getModel>,
    activatedSource: AnnouncementSourceRecord,
    snapshotId: string,
    sourceRevision: number,
    snapshotIntentRevision: number,
    predecessorSnapshotId?: string
  ): Promise<void> {
    let finalized;
    try {
      finalized = await snapshotModel.findOneAndUpdate({
        _id: snapshotId,
        sourceId: activatedSource.id,
        sourceRevision
      }, {
        $set: snapshotRetentionLease(),
        $unset: { purgeAfter: 1 }
      }, { new: true });
    } catch (error) {
      await this.compensateFailedSnapshotActivation(
        sourceModel,
        snapshotModel,
        activatedSource.id,
        snapshotId,
        sourceRevision,
        snapshotIntentRevision,
        predecessorSnapshotId
      );
      throw error;
    }
    if (!finalized) {
      await this.compensateFailedSnapshotActivation(
        sourceModel,
        snapshotModel,
        activatedSource.id,
        snapshotId,
        sourceRevision,
        snapshotIntentRevision,
        predecessorSnapshotId
      );
      throw new Error("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_FINALIZATION_FAILED");
    }

    // Do not let a slow predecessor cleanup refresh a snapshot that a newer
    // writer has already superseded. The exact current pointer owns cleanup;
    // a confirmed stale activation only grace-retires its own snapshot.
    try {
      const exactCurrent = await sourceModel.findOne({
        _id: activatedSource.id,
        ...snapshotStateFenceFilter(snapshotId, sourceRevision)
      });
      if (exactCurrent) {
        await this.retireSnapshotHistory(
          toDomainRecord<AnnouncementSourceRecord>(exactCurrent),
          predecessorSnapshotId
        );
      } else {
        await bestEffortRetireSnapshot(snapshotModel, snapshotId);
      }
    } catch {
      // Snapshot durability is already established. Retention reconciliation
      // can safely repair skipped cleanup without changing visible state.
    }
  }

  private async compensateFailedSnapshotActivation(
    sourceModel: ReturnType<typeof getModel>,
    snapshotModel: ReturnType<typeof getModel>,
    sourceId: string,
    snapshotId: string,
    sourceRevision: number,
    snapshotIntentRevision: number,
    predecessorSnapshotId?: string
  ): Promise<void> {
    try {
      const invalidated = await sourceModel.findOneAndUpdate({
        _id: sourceId,
        ...snapshotStateFenceFilter(snapshotId, sourceRevision),
        ...snapshotIntentRevisionFenceFilter(snapshotIntentRevision)
      }, {
        $inc: { snapshotStateRevision: 1, snapshotIntentRevision: 1 },
        $unset: { activeSnapshotId: 1, ...snapshotActivationIntentUnset }
      }, { new: true });
      if (!invalidated) return;
      await bestEffortRetireSnapshot(snapshotModel, snapshotId);
      await this.retireSnapshotHistory(
        toDomainRecord<AnnouncementSourceRecord>(invalidated),
        predecessorSnapshotId
      );
    } catch {
      // Never report activation success when compensation is indeterminate.
    }
  }

  private supportsSnapshotPersistence(): boolean {
    return typeof this.mongo.getConnection === "function" && typeof this.mongo.connect === "function";
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}

interface AnnouncementSnapshotRecord {
  id: string;
  sourceId: string;
  sourceRevision?: number;
  items: AnnouncementItem[];
  snapshotHash: string;
  activationLeaseUntil?: Date;
  nextRetentionCheckAt?: Date;
  purgeAfter?: Date;
}

const SNAPSHOT_CAS_ATTEMPTS = 5;
const SNAPSHOT_RETENTION_GRACE_MS = 24 * 60 * 60 * 1_000;
const SNAPSHOT_RECONCILIATION_INTERVAL_MS = 60 * 60 * 1_000;
const SNAPSHOT_RECONCILIATION_BATCH_SIZE = 500;

const sourceValidatorFields = [
  "etag",
  "lastModified",
  "contentHash",
  "processingVersion",
  "lastContentChangedAt",
  "healthProbe"
] as const;

const sourceValidatorUnset = Object.fromEntries(
  sourceValidatorFields.map((field) => [field, 1] as const)
);

const snapshotActivationIntentUnset = {
  pendingSnapshotId: 1,
  pendingSnapshotRevision: 1,
  pendingSnapshotExpiresAt: 1
} as const;

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

function newSourceDefinitionVersion(): string {
  return new Types.ObjectId().toHexString();
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

export function adminSourceMongoFilter(
  input: Omit<AnnouncementAdminSourceListQuery, "limit" | "offset">,
  scopeClause?: Record<string, unknown>
): Record<string, unknown> {
  const clauses: Array<Record<string, unknown>> = [];
  if (scopeClause) clauses.push(scopeClause);
  if (input.status) clauses.push({ status: input.status });
  if (input.trustStatus === "pending_review") {
    clauses.push({ approvalPending: true });
  } else if (input.trustStatus) {
    if (input.trustStatus === "quarantined") {
      clauses.push({ $or: [{ trustStatus: "quarantined" }, { trustStatus: { $exists: false } }, { trustStatus: null }] });
    } else {
      clauses.push({ trustStatus: input.trustStatus });
    }
    clauses.push({ approvalPending: { $ne: true } });
  }
  if (input.contentType === "announcement") {
    clauses.push({ $or: [{ contentType: "announcement" }, { contentType: { $exists: false } }, { contentType: null }] });
  } else if (input.contentType) clauses.push({ contentType: input.contentType });
  if (input.scopeType) clauses.push({ scopeType: input.scopeType });
  const search = input.search?.trim();
  if (search) {
    const expression = new RegExp(escapeMongoRegex(search.slice(0, 200)), "iu");
    clauses.push({ $or: [{ sourceName: expression }, { sourceUrl: expression }, { scopeId: expression }] });
  }
  if (clauses.length === 0) return {};
  return clauses.length === 1 ? clauses[0]! : { $and: clauses };
}

function escapeMongoRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sourceDefinitionFenceFilter(expected: AnnouncementSourceDefinitionFence): Record<string, unknown> {
  return {
    sourceUrl: expected.sourceUrl,
    parser: expected.parser,
    parserConfig: expected.parserConfig ?? null,
    ...(expected.sourceDefinitionVersion
      ? { sourceDefinitionVersion: expected.sourceDefinitionVersion }
      : { sourceDefinitionVersion: { $exists: false } }),
    ...(expected.notificationProducerVersion
      ? { notificationProducerVersion: expected.notificationProducerVersion }
      : { notificationProducerVersion: { $exists: false } }),
    approvalPending: expected.approvalPending === true ? true : { $ne: true },
    reviewedAt: expected.reviewedAt ?? null
  };
}

function sourceReviewFenceFilter(fence: AnnouncementSourceReviewFence): Record<string, unknown> {
  const expectedVersion = normalizedVersion(fence.expectedSourceDefinitionVersion);
  const expectedTrustStatus = fence.expectedTrustStatus;
  return {
    status: fence.expectedSourceStatus,
    approvalPending: fence.expectedApprovalPending ? true : { $ne: true },
    ...(fence.expectedReviewedAt !== undefined
      ? fence.expectedReviewedAt
        ? { reviewedAt: fence.expectedReviewedAt }
        : { reviewedAt: null }
      : {}),
    $and: [
      {
        $or: [
          { canonicalUrl: fence.expectedCanonicalUrl },
          {
            $and: [
              { $or: [{ canonicalUrl: { $exists: false } }, { canonicalUrl: null }, { canonicalUrl: "" }] },
              { sourceUrl: fence.expectedCanonicalUrl }
            ]
          }
        ]
      },
      expectedVersion
        ? { sourceDefinitionVersion: expectedVersion }
        : { $or: [{ sourceDefinitionVersion: { $exists: false } }, { sourceDefinitionVersion: null }, { sourceDefinitionVersion: "" }] },
      expectedTrustStatus === "quarantined"
        ? { $or: [{ trustStatus: "quarantined" }, { trustStatus: { $exists: false } }, { trustStatus: null }] }
        : { trustStatus: expectedTrustStatus }
    ]
  };
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

function snapshotStateRevisionFor(source: Pick<AnnouncementSourceRecord, "snapshotStateRevision">): number {
  const revision = source.snapshotStateRevision;
  return Number.isSafeInteger(revision) && Number(revision) >= 0 ? Number(revision) : 0;
}

function snapshotIntentRevisionFor(source: Pick<AnnouncementSourceRecord, "snapshotIntentRevision">): number {
  const revision = source.snapshotIntentRevision;
  return Number.isSafeInteger(revision) && Number(revision) >= 0 ? Number(revision) : 0;
}

function snapshotSourceRevisionFor(snapshot: Pick<AnnouncementSnapshotRecord, "sourceRevision">): number {
  const revision = snapshot.sourceRevision;
  return Number.isSafeInteger(revision) && Number(revision) >= 0 ? Number(revision) : 0;
}

function snapshotMatchesSourceState(
  source: Pick<AnnouncementSourceRecord, "snapshotStateRevision">,
  snapshot: Pick<AnnouncementSnapshotRecord, "sourceRevision">
): boolean {
  return snapshotStateRevisionFor(source) === snapshotSourceRevisionFor(snapshot);
}

function isLegacySnapshotState(
  source: Pick<AnnouncementSourceRecord, "activeSnapshotId" | "snapshotStateRevision">
): boolean {
  return !normalizedSnapshotId(source.activeSnapshotId) && snapshotStateRevisionFor(source) === 0;
}

function snapshotPointerFenceFilter(expectedSnapshotId: string | null): Record<string, unknown> {
  const normalized = normalizedSnapshotId(expectedSnapshotId ?? undefined);
  return normalized
    ? { activeSnapshotId: normalized }
    : { $or: [{ activeSnapshotId: { $exists: false } }, { activeSnapshotId: null }] };
}

function itemsFromSnapshot(
  document: { id: string; toObject: (options?: { flattenMaps?: boolean }) => Record<string, unknown> },
  sourceId: string,
  snapshotId: string
): AnnouncementItem[] {
  const snapshot = toDomainRecord<AnnouncementSnapshotRecord>(document);
  if (snapshot.sourceId !== sourceId || !Array.isArray(snapshot.items)) return [];
  return snapshot.items.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as AnnouncementItem;
    if (item.sourceId !== sourceId || typeof item.id !== "string") return [];
    return [{ ...item, snapshotId }];
  });
}

function snapshotStateFenceFilter(
  expectedSnapshotId: string | null,
  expectedRevision: number
): Record<string, unknown> {
  return {
    activeSnapshotId: normalizedSnapshotId(expectedSnapshotId ?? undefined) ?? null,
    snapshotStateRevision: expectedRevision === 0 ? { $in: [0, null] } : expectedRevision
  };
}

function snapshotActivationIntentFenceFilter(
  pendingSnapshotId: string,
  pendingSnapshotRevision: number,
  snapshotIntentRevision: number
): Record<string, unknown> {
  return {
    pendingSnapshotId,
    pendingSnapshotRevision,
    snapshotIntentRevision,
    $expr: { $gt: ["$pendingSnapshotExpiresAt", "$$NOW"] }
  };
}

function snapshotIntentRevisionFenceFilter(expectedRevision: number): Record<string, unknown> {
  return {
    snapshotIntentRevision: expectedRevision === 0 ? { $in: [0, null] } : expectedRevision
  };
}

function reviewItemFromActiveSnapshotAggregate(
  value: unknown,
  itemId: string
): { item: AnnouncementItem; source: AnnouncementSourceRecord } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const snapshotValue = record.activeReviewSnapshot;
  if (!snapshotValue || typeof snapshotValue !== "object" || Array.isArray(snapshotValue) || record._id === undefined) return null;
  const snapshot = snapshotValue as Record<string, unknown>;
  if (snapshot._id === undefined || !Array.isArray(snapshot.items)) return null;

  const sourceId = String(record._id);
  const snapshotId = String(snapshot._id);
  if (record.activeSnapshotId !== snapshotId || snapshot.sourceId !== sourceId) return null;
  if (snapshotStateRevisionFor(record as unknown as AnnouncementSourceRecord)
    !== snapshotSourceRevisionFor(snapshot as unknown as AnnouncementSnapshotRecord)) return null;
  const candidate = snapshot.items.find((item) => Boolean(
    item
    && typeof item === "object"
    && !Array.isArray(item)
    && (item as Record<string, unknown>).id === itemId
    && (item as Record<string, unknown>).sourceId === sourceId
  ));
  if (!candidate) return null;

  const {
    _id: _sourceObjectId,
    __v: _sourceVersion,
    activeReviewSnapshot: _activeReviewSnapshot,
    ...sourceFields
  } = record;
  void _sourceObjectId;
  void _sourceVersion;
  void _activeReviewSnapshot;
  return {
    item: { ...(candidate as AnnouncementItem), snapshotId },
    source: { ...sourceFields, id: sourceId } as unknown as AnnouncementSourceRecord
  };
}

function snapshotHashFor(items: readonly AnnouncementItem[]): string {
  const hashInput = items.map(({
    snapshotId: _snapshotId,
    notificationProducedFingerprint: _notificationProducedFingerprint,
    fetchedAt: _fetchedAt,
    ...item
  }) => item);
  return createHash("sha256").update(JSON.stringify(hashInput), "utf8").digest("hex");
}

function snapshotDelta(
  plan: ReturnType<typeof planAnnouncementReplacement>,
  persistedItems: readonly AnnouncementItem[]
): AnnouncementPersistenceDelta {
  const delta = emptyAnnouncementPersistenceDelta();
  for (const [index, entry] of plan.entries.entries()) {
    const persisted = persistedItems[index];
    if (!persisted) throw new Error("ANNOUNCEMENT_SNAPSHOT_ITEM_MISSING");
    const reference = toPersistenceReference(persisted);
    if (!reference) continue;
    if (!entry.previous) delta.created.push(reference);
    else if (entry.materiallyUpdated) delta.materiallyUpdated.push(reference);
    else delta.unchanged.push(reference);
  }
  for (const removed of plan.removed) {
    const reference = toPersistenceReference(removed);
    if (reference) delta.removed.push(reference);
  }
  return delta;
}

async function bestEffortDeleteSnapshot(
  model: ReturnType<typeof getModel>,
  snapshotId: string
): Promise<void> {
  try {
    await model.deleteOne({ _id: snapshotId });
  } catch {
    // An unreferenced staged snapshot is never student-visible. Cleanup can be
    // retried operationally without compromising the active pointer.
  }
}

async function bestEffortRetireSnapshot(
  model: ReturnType<typeof getModel>,
  snapshotId: string,
  now = new Date()
): Promise<void> {
  const purgeAfter = new Date(now.getTime() + SNAPSHOT_RETENTION_GRACE_MS);
  try {
    await model.updateOne({
      _id: snapshotId,
      purgeAfter: { $exists: false }
    }, {
      $set: { purgeAfter, nextRetentionCheckAt: purgeAfter },
      $unset: { activationLeaseUntil: 1 }
    });
  } catch {
    // A later reconciliation pass can reschedule an unreachable snapshot.
  }
}

async function bestEffortReconcileSnapshotRetention(
  model: ReturnType<typeof getModel>,
  source: AnnouncementSourceRecord,
  predecessorSnapshotId?: string,
  now = new Date()
): Promise<void> {
  const activeSnapshotId = normalizedSnapshotId(source.activeSnapshotId);
  const purgeAfter = new Date(now.getTime() + SNAPSHOT_RETENTION_GRACE_MS);
  try {
    if (predecessorSnapshotId && predecessorSnapshotId !== activeSnapshotId) {
      await model.updateOne({
        _id: predecessorSnapshotId,
        sourceId: source.id,
        purgeAfter: { $exists: false }
      }, {
        $set: { purgeAfter, nextRetentionCheckAt: purgeAfter },
        $unset: { activationLeaseUntil: 1 }
      });
    }
  } catch {
    // Pointer state remains authoritative; the next write or hourly pass retries.
  }
}

function snapshotRetentionLease(now = new Date()): {
  activationLeaseUntil: Date;
  nextRetentionCheckAt: Date;
} {
  const until = new Date(now.getTime() + SNAPSHOT_RETENTION_GRACE_MS);
  return { activationLeaseUntil: until, nextRetentionCheckAt: until };
}

async function claimSnapshotForActivation(
  model: ReturnType<typeof getModel>,
  snapshotId: string,
  sourceId: string,
  sourceRevision: number,
  now = new Date()
): Promise<boolean> {
  const claimed = await model.findOneAndUpdate({
    _id: snapshotId,
    sourceId,
    sourceRevision,
    $or: [
      { purgeAfter: { $exists: false } },
      { purgeAfter: null },
      { purgeAfter: { $gt: now } }
    ]
  }, {
    $set: snapshotRetentionLease(now),
    $unset: { purgeAfter: 1 }
  }, { new: true });
  return Boolean(claimed);
}

function notificationReferenceMatches(
  item: AnnouncementItem,
  reference: AnnouncementPersistenceReference
): boolean {
  return item.id === reference.id
    && item.sourceId === reference.sourceId
    && item.scopeType === reference.scopeType
    && item.scopeId === reference.scopeId
    && item.contentFingerprint === reference.contentFingerprint
    && item.notificationEligibleFingerprint === reference.contentFingerprint;
}

function acknowledgeLegacyReference(
  model: ReturnType<typeof getModel>,
  reference: AnnouncementPersistenceReference
) {
  return model.findOneAndUpdate({
    _id: reference.id,
    sourceId: reference.sourceId,
    scopeType: reference.scopeType,
    scopeId: reference.scopeId,
    contentFingerprint: reference.contentFingerprint,
    notificationEligibleFingerprint: reference.contentFingerprint
  }, {
    $set: { notificationProducedFingerprint: reference.contentFingerprint }
  });
}

function compareMongoAnnouncementItems(left: AnnouncementItem, right: AnnouncementItem): number {
  for (const field of ["discoveredAt", "sourceUpdatedAt", "publishedAt"] as const) {
    const leftTime = parseTimestamp(left[field]);
    const rightTime = parseTimestamp(right[field]);
    if (leftTime !== rightTime) return rightTime - leftTime;
  }
  return left.id.localeCompare(right.id, "en-US");
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isApiEligibleItem(item: AnnouncementItem): boolean {
  return item.trustStatus === "trusted" && item.reviewStatus === "approved";
}

const REVIEW_SOURCE_ITEM_LIMIT = 5_000;

function reviewFenceMatches(item: AnnouncementItem, fence: AnnouncementReviewFence): boolean {
  return normalizedSnapshotId(item.snapshotId) === normalizedSnapshotId(fence.expectedSnapshotId)
    && (item.contentFingerprint ?? fingerprintFor(item)) === fence.expectedContentFingerprint
    && normalizedRevision(item.reviewRevision) === normalizedRevision(fence.expectedReviewRevision);
}

function normalizedRevision(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
