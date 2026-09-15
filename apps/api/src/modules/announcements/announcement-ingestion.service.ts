import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { findVerifiedAcademicUnitSource, findVerifiedSourceAuthority, findVerifiedUniversitySource, listVerifiedAcademicUnitSources, listVerifiedUniversitySources, type VerifiedAcademicUnitSource, type VerifiedContentSourceParserProfiles, type VerifiedRegistrySourceEvidence } from "../../bootstrap/verified-source-registry.js";
import { resolveSourceAuthorityContext, type ResolvedSourceAuthorityContext } from "../../bootstrap/source-authority-context.js";
import { assertUniversityTarget, type AdminUniversityAccess } from "../../common/authorization/admin-university-access.js";
import { evaluateSourceAuthority, SourceAuthorityError, type SourceAuthorityContext } from "../../domain/source-authority-enforcement.js";
import type { SourceAuthorityDecision, SourceAuthorityResource } from "../../domain/source-authority-policy.js";
import type { CatalogRepository, DepartmentRecord, FacultyRecord, UniversityRecord } from "../catalog/catalog.types.js";
import { fetchDeviceRuntimeSourceSnapshot, fetchSourceItems, fetchSourceSnapshot, fetchText, parseConfiguredAnnouncementHtml, parseHtmlAnchors, toAnnouncementItems, cleanText, containsAnnouncementHint } from "./announcement-parser.js";
import { DEVICE_SOURCE_RUNTIME_VERSION } from "../../../../../packages/shared/src/device-source-runtime.js";
import { ANNOUNCEMENT_CONTENT_FINGERPRINT_VERSION, canonicalAnnouncementSourceIdentityKey, canonicalizeContentUrl, isOfficialContentUrl } from "./announcement-content-trust.js";
import { emptyAnnouncementPersistenceDelta, toPersistenceReference } from "./announcement-persistence.js";
import {
  assertAnnouncementSourceVerificationEvidenceMatchesDefinition,
  normalizeAnnouncementSourceVerificationEvidence
} from "./announcement-source-evidence.js";
import { sameAnnouncementSourceParserConfig } from "./announcements.types.js";
import type { AnnouncementAdminSourceListQuery, AnnouncementContentType, AnnouncementItem, AnnouncementPersistenceDelta, AnnouncementRepository, AnnouncementSourceCandidateInput, AnnouncementSourceEditFence, AnnouncementSourceHealthProbe, AnnouncementSourceParser, AnnouncementSourceParserConfig, AnnouncementSourceRecord, AnnouncementSourceReviewFence, AnnouncementSourceScope, AnnouncementSourceStatus, AnnouncementSourceVerificationEvidence, AnnouncementTrustStatus, UniversityCalendarSourceProfileRecord, UpsertUniversityCalendarSourceProfileInput } from "./announcements.types.js";
import { NotificationSchedulingService } from "../notifications/notifications.service.js";
import {
  STUDENT_RELEVANCE_CLASSIFICATION_VERSION,
  summarizeStudentRelevanceAudit,
  type StudentRelevanceAuditCounts
} from "../../domain/student-relevance-classifier.js";

export interface AnnouncementDiscoveryResult {
  universityId: string;
  universityName: string;
  status: "source_found" | "homepage_found_no_items" | "homepage_not_found";
  homepageUrl?: string;
  sourceUrl?: string;
  parser?: AnnouncementSourceParser;
  parserConfig?: AnnouncementSourceParserConfig;
  itemCount: number;
  checkedHomepageCandidates: number;
  checkedSourceCandidates: number;
  sampleTitles: string[];
  error?: string;
}

export interface AnnouncementIngestionResult {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  status: "healthy" | "degraded" | "failed";
  itemCount: number;
  sampleTitles: string[];
  classificationAudit?: {
    mode: "shadow";
    classificationVersion: typeof STUDENT_RELEVANCE_CLASSIFICATION_VERSION;
    counts: StudentRelevanceAuditCounts;
  };
  error?: string;
}

export interface AnnouncementHealthProbeResult {
  sourceId: string;
  status: "healthy" | "degraded" | "failed";
  itemCount: number;
  contentChanged: boolean;
  error?: string;
}

export interface AnnouncementHealthProbeCycleResult {
  checkedSources: number;
  healthy: number;
  degraded: number;
  failed: number;
  changed: number;
  results: AnnouncementHealthProbeResult[];
}

export interface AnnouncementSourcePreviewResult {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  finalUrl?: string;
  status: "healthy" | "degraded" | "failed";
  parsedItemCount: number;
  acceptedItemCount: number;
  testedAt: string;
  samples: Array<{
    title: string;
    url: string;
    publishedAt?: string;
    publishedDate?: string;
    keyDates?: AnnouncementItem["keyDates"];
    summary?: string;
    body?: AnnouncementItem["body"];
  }>;
  error?: string;
  activationStatus?: "not_requested" | "active" | "inactive";
  activationError?: string;
  detectedContentType?: string;
}

export type UniversityContentSourceType = AnnouncementContentType | "academic_calendar";

export interface UniversityContentSourceProfileInput {
  sourceUrl: string;
  sourceName?: string;
  parser: AnnouncementSourceParser;
  parserConfig?: AnnouncementSourceParserConfig;
  status?: AnnouncementSourceStatus;
}

export interface AnnouncementRegistryProvisionResult {
  created: number;
  skipped: number;
  evidenceAttached: number;
  evidenceConflicts: number;
  total: number;
}

export interface AnnouncementSourceReviewRequest {
  expectedSourceDefinitionVersion: string;
  expectedCanonicalUrl: string;
  expectedTrustStatus: AnnouncementTrustStatus;
  expectedSourceStatus: AnnouncementSourceStatus;
  expectedApprovalPending: boolean;
  note?: string;
}

export type AnnouncementAdminSourceQueryInput = Omit<
  AnnouncementAdminSourceListQuery,
  "limit" | "offset"
> & {
  limit?: number;
  offset?: number;
};

export const YOK_ANNOUNCEMENT_SCOPE_ID = "yok-council-of-higher-education";
export const YOK_ANNOUNCEMENT_SOURCE_URL = "https://www.yok.gov.tr/tr/announcements";
export const ANNOUNCEMENT_PROCESSING_VERSION = `announcement-ingestion-v5+${ANNOUNCEMENT_CONTENT_FINGERPRINT_VERSION}+${STUDENT_RELEVANCE_CLASSIFICATION_VERSION}` as const;
const ANNOUNCEMENT_NOTIFICATION_RETRY_PAGE_SIZE = 100;
const ANNOUNCEMENT_NOTIFICATION_RETRY_MAX_ITEMS = 5_000;

@Injectable()
export class AnnouncementIngestionService {
  private running = false;
  private healthProbeCycle: Promise<AnnouncementHealthProbeCycleResult> | null = null;
  private staticSourcesPromise: Promise<AnnouncementRegistryProvisionResult> | null = null;

  constructor(
    @Inject("CatalogRepository") private readonly catalogRepository: CatalogRepository,
    @Inject("AnnouncementRepository") private readonly announcementRepository: AnnouncementRepository,
    @Optional() @Inject(NotificationSchedulingService) private readonly notificationSchedulingService?: NotificationSchedulingService
  ) {}

  async runSourceDiscovery(input: { limit?: number; offset?: number; concurrency?: number } = {}) {
    const universities = await this.listUniversities(input.limit ?? readPositiveInteger(process.env.ANNOUNCEMENT_DISCOVERY_BATCH_SIZE, 5_000), input.offset ?? 0);
    const discoveryResults = await runWithConcurrency(
      universities,
      input.concurrency ?? readPositiveInteger(process.env.ANNOUNCEMENT_DISCOVERY_CONCURRENCY, 4),
      (university) => this.discoverUniversitySource(university)
    );

    return {
      summary: summarizeDiscovery(discoveryResults),
      results: discoveryResults
    };
  }

  async runDiscoveryAndIngestion(input: { limit?: number; offset?: number; refreshSources?: boolean; concurrency?: number } = {}) {
    const discovery = await this.runSourceDiscovery({
      ...(input.limit ? { limit: input.limit } : {}),
      ...(input.offset ? { offset: input.offset } : {}),
      ...(input.concurrency ? { concurrency: input.concurrency } : {})
    });
    const ingestion = input.refreshSources
      ? await this.runIngestionAcrossAllPages(input.concurrency)
      : await this.runIngestion({ ...(input.concurrency ? { concurrency: input.concurrency } : {}) });
    return {
      discovery: discovery.summary,
      ingestion: summarizeIngestion(ingestion.results),
      discoveryResults: discovery.results,
      ingestionResults: ingestion.results
    };
  }

  async runIngestion(input: { limit?: number; offset?: number; concurrency?: number } = {}) {
    const sources = (await this.announcementRepository.listAllSources({
      status: "active",
      limit: input.limit ?? 1000,
      offset: input.offset ?? 0
    })).filter((source) => source.approvalPending !== true);
    const results = await runAnnouncementSourcesWithConcurrency(
      sources,
      input.concurrency ?? readPositiveInteger(process.env.ANNOUNCEMENT_INGEST_CONCURRENCY, 6),
      (source) => this.ingestSource(source)
    );
    return { summary: summarizeIngestion(results), results };
  }

  private async runIngestionAcrossAllPages(concurrency?: number) {
    const sources = await this.listAllActiveSources();
    const results = await runAnnouncementSourcesWithConcurrency(
      sources,
      concurrency ?? readPositiveInteger(process.env.ANNOUNCEMENT_INGEST_CONCURRENCY, 6),
      (source) => this.ingestSource(source)
    );
    return { summary: summarizeIngestion(results), results };
  }

  private async listAllActiveSources(): Promise<AnnouncementSourceRecord[]> {
    const sources: AnnouncementSourceRecord[] = [];
    const pageSize = 1_000;
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.announcementRepository.listAllSources({ status: "active", limit: pageSize, offset });
      sources.push(...page.filter((source) => source.approvalPending !== true));
      if (page.length < pageSize) return sources;
    }
  }

  async listSources(input: { status?: "active" | "inactive"; limit?: number; offset?: number } = {}) {
    return this.announcementRepository.listAllSources(input);
  }

  async listSourcesForAdmin(
    access: AdminUniversityAccess,
    input: AnnouncementAdminSourceQueryInput = {}
  ) {
    const query = normalizeAdminSourceListQuery(input);
    const sources = access.kind === "global"
      ? await this.announcementRepository.listAdminSources(query)
      : await this.announcementRepository.listAdminSourcesByScopeSet({
          ...query,
          scopes: await this.listAnnouncementScopesForUniversity(access.universityId)
        });
    return sources.map(presentSourceForAdmin);
  }

  async listUniversityContentSourceProfilesForAdmin(access: AdminUniversityAccess) {
    const inventory = await loadUniversityContentSourceInventory();
    const universities = access.kind === "global"
      ? inventory.universities
      : inventory.universities.filter((university) => university.universityId === access.universityId);
    const universityIds = universities.map((university) => university.universityId);
    const sources = access.kind === "global"
      ? await this.announcementRepository.listAdminSources({ scopeType: "university", limit: 1_000, offset: 0 })
      : await this.announcementRepository.listAdminSourcesByScopeSet({
          scopeType: "university",
          scopes: [{ scopeType: "university", scopeId: access.universityId }],
          limit: 1_000,
          offset: 0
        });
    const sourceBySlot = new Map<string, AnnouncementSourceRecord>();
    for (const source of sources) {
      const key = `${source.scopeId}\u0000${source.contentType ?? "announcement"}`;
      if (!sourceBySlot.has(key)) sourceBySlot.set(key, source);
    }
    const calendars = new Map(
      (await this.announcementRepository.listUniversityCalendarSourceProfiles(universityIds))
        .map((profile) => [profile.universityId, profile] as const)
    );
    return {
      summary: {
        ...inventory.summary,
        returnedUniversities: universities.length,
        returnedSourceSlots: universities.reduce((total, university) => total + university.slots.length, 0)
      },
      universities: universities.map((university) => ({
        universityId: university.universityId,
        universityName: university.universityName,
        city: university.city,
        authority: university.authority,
        slots: university.slots.map((slot) => {
          const suggestedUrl = slot.sourceUrl ?? slot.candidateUrl;
          if (slot.contentType === "academic_calendar") {
            const configured = calendars.get(university.universityId);
            return {
              ...slot,
              suggestedUrl,
              sourceUrl: configured?.sourceUrl ?? suggestedUrl,
              parser: configured?.parser ?? slot.parser,
              parserConfig: configured ? configured.parserConfig : slot.parserConfig,
              status: configured?.status ?? "inactive",
              trustStatus: configured ? "configured" as const : "needs_review" as const,
              lastTest: presentProfileTest(configured),
              adminPath: "/admin/calendars"
            };
          }
          const source = sourceBySlot.get(`${university.universityId}\u0000${slot.contentType}`);
          const presentedSource = source ? presentSourceForAdmin(source) : undefined;
          return {
            ...slot,
            suggestedUrl,
            sourceId: source?.id,
            sourceName: source?.sourceName,
            sourceUrl: source?.sourceUrl ?? suggestedUrl,
            parser: source?.parser ?? slot.parser,
            parserConfig: source ? source.parserConfig : slot.parserConfig,
            status: source?.status ?? "inactive",
            trustStatus: source?.trustStatus ?? "quarantined",
            reviewStatus: presentedSource?.reviewStatus ?? "pending_review",
            ...(presentedSource?.healthProbe ? { healthProbe: presentedSource.healthProbe } : {}),
            lastTest: presentProfileTest(source)
          };
        })
      }))
    };
  }

  async saveUniversityContentSourceProfileForAdmin(
    access: AdminUniversityAccess,
    universityId: string,
    contentType: UniversityContentSourceType,
    input: UniversityContentSourceProfileInput
  ) {
    assertUniversityTarget(access, universityId);
    assertUniversityContentSourceType(contentType);
    const university = await this.catalogRepository.findUniversityById(universityId);
    if (!university || university.status !== "active") throw new NotFoundException("University not found.");
    if (contentType === "academic_calendar") {
      const authority = await this.resolveAuthority(university, "university", university.id);
      const decision = evaluateSourceAuthority(authority.context, {
        boundary: "registration",
        resource: "academic_calendar",
        url: input.sourceUrl
      });
      if (!decision.allowed || !decision.canonicalUrl) {
        throw new BadRequestException(`Source authority validation failed: ${decision.reasonCode}.`);
      }
      return this.announcementRepository.upsertUniversityCalendarSourceProfile({
        universityId,
        sourceUrl: decision.canonicalUrl,
        parser: input.parser,
        ...(input.parserConfig ? { parserConfig: input.parserConfig } : {}),
        status: input.status ?? "inactive",
        healthStatus: "pending"
      });
    }
    const existing = (await this.announcementRepository.listAdminSources({
      scopeType: "university",
      contentType,
      limit: 1_000,
      offset: 0
    })).find((source) => source.scopeId === universityId);
    if (!existing) {
      return this.createManualSourceForAdmin(access, {
        scopeType: "university",
        universityId,
        sourceName: input.sourceName?.trim() || `${university.name} ${contentTypeLabel(contentType)}`,
        sourceUrl: input.sourceUrl,
        contentType,
        parser: input.parser,
        ...(input.parserConfig ? { parserConfig: input.parserConfig } : {}),
        priority: 50,
        fetchIntervalMinutes: 180
      });
    }
    return this.updateManualSourceForAdmin(access, existing.id, {
      expectedSourceDefinitionVersion: existing.sourceDefinitionVersion ?? "",
      expectedCanonicalUrl: existing.canonicalUrl ?? existing.sourceUrl,
      expectedTrustStatus: existing.trustStatus ?? "quarantined",
      expectedSourceStatus: existing.status,
      expectedApprovalPending: existing.approvalPending === true,
      expectedUpdatedAt: existing.updatedAt.toISOString(),
      sourceName: input.sourceName?.trim() || existing.sourceName,
      sourceUrl: input.sourceUrl,
      contentType,
      parser: input.parser,
      ...(input.parserConfig ? { parserConfig: input.parserConfig } : {}),
      ...(input.status ? { status: input.status } : {})
    });
  }

  async previewUniversityContentSourceProfileForAdmin(
    access: AdminUniversityAccess,
    universityId: string,
    contentType: UniversityContentSourceType,
    input: { activateWhenHealthy?: boolean } = {},
    actorId?: string
  ) {
    assertUniversityTarget(access, universityId);
    assertUniversityContentSourceType(contentType);
    if (contentType !== "academic_calendar") {
      const source = (await this.announcementRepository.listAdminSources({
        scopeType: "university",
        contentType,
        limit: 1_000,
        offset: 0
      })).find((candidate) => candidate.scopeId === universityId);
      if (!source) throw new NotFoundException("Content source profile has not been configured.");
      const preview = await this.previewSource(source);
      if (!input.activateWhenHealthy) return { ...preview, activationStatus: "not_requested" as const };
      if (preview.status !== "healthy") {
        const quarantined = await this.announcementRepository.quarantineSource(source.id, ["preview_failed"], source);
        if (quarantined) await this.retireSourceNotifications(quarantined);
        return { ...preview, activationStatus: "inactive" as const };
      }
      if (!actorId) throw new BadRequestException("Activating a source profile requires an administrator identity.");
      const current = await this.announcementRepository.findSourceById(source.id);
      if (!current) throw new NotFoundException("Content source profile has not been configured.");
      try {
        const activated = await this.approveSourceForAdmin(
          access,
          current.id,
          actorId,
          {
            ...sourceReviewFenceFromRecord(current),
            expectedSourceDefinitionVersion: current.sourceDefinitionVersion ?? ""
          }
        );
        return { ...preview, activationStatus: "active" as const, source: activated.source };
      } catch (error) {
        return {
          ...preview,
          activationStatus: "inactive" as const,
          activationError: error instanceof Error ? error.message : String(error)
        };
      }
    }
    return this.previewUniversityCalendarSource(universityId, input.activateWhenHealthy === true);
  }

  async createManualSourceForAdmin(access: AdminUniversityAccess, input: ManualAnnouncementSourceInput) {
    assertUniversityTarget(access, input.universityId);
    return this.createManualSource(input);
  }

  async updateManualSourceForAdmin(access: AdminUniversityAccess, id: string, input: ManualAnnouncementSourceUpdateInput) {
    await this.getSourceForAdmin(access, id);
    return this.updateManualSource(id, input);
  }

  async deactivateManualSourceForAdmin(
    access: AdminUniversityAccess,
    id: string,
    input: AnnouncementSourceReviewRequest
  ) {
    const existing = await this.getSourceForAdmin(access, id);
    const requestedFence = sourceReviewFenceFromRequest(input);
    assertSourceMatchesReviewFence(existing, requestedFence);
    const source = await this.announcementRepository.deactivateSource(id, {
      ...requestedFence,
      expectedSourceUrl: existing.sourceUrl,
      expectedReviewedAt: existing.reviewedAt ?? null
    });
    if (!source) throw sourceReviewConflict();
    await this.retireSourceNotifications(source);
    return source;
  }

  async ingestSourceByIdForAdmin(access: AdminUniversityAccess, id: string) {
    await this.getSourceForAdmin(access, id);
    return this.ingestSourceById(id);
  }

  async previewSourceByIdForAdmin(access: AdminUniversityAccess, id: string) {
    const source = await this.getSourceForAdmin(access, id);
    return this.previewSource(source);
  }

  async getSourceForAdminAccess(access: AdminUniversityAccess, id: string): Promise<AnnouncementSourceRecord> {
    return this.getSourceForAdmin(access, id);
  }

  async approveSourceForAdmin(
    access: AdminUniversityAccess,
    id: string,
    actorId: string,
    input: AnnouncementSourceReviewRequest
  ) {
    const existing = await this.getSourceForAdmin(access, id);
    const requestedReviewFence = sourceReviewFenceFromRequest(input);
    assertSourceMatchesReviewFence(existing, requestedReviewFence);
    if (hasActiveSourceApprovalLease(existing)) throw sourceReviewConflict();
    const reviewFence: AnnouncementSourceReviewFence = {
      ...requestedReviewFence,
      expectedSourceUrl: existing.sourceUrl,
      expectedReviewedAt: existing.reviewedAt ?? null
    };
    const authority = await this.resolveAuthorityForSource(existing);
    const decision = authority
      ? evaluateSourceAuthority(authority.context, {
        boundary: "registration",
        resource: sourceAuthorityResource(existing.contentType),
        url: existing.sourceUrl
      })
      : missingSourceOwnerDecision(existing, existing.sourceUrl, "registration");
    if (!decision.allowed || !decision.canonicalUrl) {
      const quarantined = await this.announcementRepository.reviewSource(existing.id, {
        decision: "quarantine",
        reviewedBy: actorId,
        reviewedAt: new Date(),
        ...(input.note ? { reviewNote: input.note } : {}),
        trustReasonCodes: [decision.reasonCode]
      }, reviewFence);
      if (!quarantined) throw sourceReviewConflict();
      await this.retireSourceNotificationsForReview(quarantined);
      throw new BadRequestException(`Source authority validation failed: ${decision.reasonCode}.`);
    }
    const source = await this.announcementRepository.reviewSource(existing.id, {
      decision: "approve",
      reviewedBy: actorId,
      reviewedAt: new Date(),
      ...(input.note ? { reviewNote: input.note } : {})
    }, reviewFence);
    if (!source) throw sourceReviewConflict();
    // The successful CAS may rotate the producer generation. Keep the
    // observed record so cleanup still addresses the exact previous key.
    await this.retireSourceNotificationsForReview(existing);
    await this.retireSourceNotificationsForReview(source);
    let ingestion: AnnouncementIngestionResult;
    try {
      ingestion = await this.ingestSource(source);
    } catch {
      await this.quarantineFailedSourceApproval(source);
      throw new BadRequestException("Announcement source approval failed its ingestion health check.");
    }
    if (ingestion.status !== "healthy") {
      await this.quarantineFailedSourceApproval(source);
      throw new BadRequestException("Announcement source approval failed its ingestion health check.");
    }
    const currentSource = await this.announcementRepository.findSourceById(source.id);
    if (
      !currentSource
      || currentSource.status !== "active"
      || currentSource.trustStatus !== "trusted"
      || currentSource.approvalPending !== true
      || currentSource.healthStatus !== "healthy"
      || (currentSource.itemCount ?? 0) <= 0
      || !sameAnnouncementSourceDefinition(currentSource, source)
      || canonicalizeContentUrl(currentSource.canonicalUrl ?? currentSource.sourceUrl) !== reviewFence.expectedCanonicalUrl
    ) throw sourceReviewConflict();
    const publishedSource = await this.announcementRepository.completeSourceApproval(
      currentSource.id,
      source,
      currentSource.activeSnapshotId ?? null
    );
    if (!publishedSource) throw sourceReviewConflict();
    await this.schedulePublishedSourceNotifications(publishedSource);
    return {
      source: presentSourceForAdmin(publishedSource),
      ingestion
    };
  }

  async rejectSourceForAdmin(
    access: AdminUniversityAccess,
    id: string,
    actorId: string,
    input: AnnouncementSourceReviewRequest
  ) {
    const existing = await this.getSourceForAdmin(access, id);
    const requestedReviewFence = sourceReviewFenceFromRequest(input);
    assertSourceMatchesReviewFence(existing, requestedReviewFence);
    const reviewFence: AnnouncementSourceReviewFence = {
      ...requestedReviewFence,
      expectedSourceUrl: existing.sourceUrl,
      expectedReviewedAt: existing.reviewedAt ?? null
    };
    const rejected = await this.announcementRepository.reviewSource(existing.id, {
      decision: "reject",
      reviewedBy: actorId,
      reviewedAt: new Date(),
      ...(input.note ? { reviewNote: input.note } : {})
    }, reviewFence);
    if (!rejected) throw sourceReviewConflict();
    await this.retireSourceNotificationsForReview(rejected);
    return presentSourceForAdmin(rejected);
  }

  async runSourceDiscoveryForAdmin(
    access: AdminUniversityAccess,
    input: { limit?: number; offset?: number; concurrency?: number } = {}
  ) {
    if (access.kind === "global") return this.runSourceDiscovery(input);
    const university = await this.catalogRepository.findUniversityById(access.universityId);
    if (!university || university.status !== "active") throw new NotFoundException("University not found.");
    const universities = (input.offset ?? 0) > 0 ? [] : [university];
    const results = await runWithConcurrency(
      universities,
      input.concurrency ?? readPositiveInteger(process.env.ANNOUNCEMENT_DISCOVERY_CONCURRENCY, 4),
      (candidate) => this.discoverUniversitySource(candidate)
    );
    return { summary: summarizeDiscovery(results), results };
  }

  async runIngestionForAdmin(
    access: AdminUniversityAccess,
    input: { limit?: number; offset?: number; concurrency?: number } = {}
  ) {
    if (access.kind === "global") return this.runIngestion(input);
    const sources = await this.listSourcesForAdmin(access, {
      status: "active",
      trustStatus: "trusted",
      limit: input.limit ?? 1000,
      offset: input.offset ?? 0
    });
    const results = await runAnnouncementSourcesWithConcurrency(
      sources.filter((source) => source.approvalPending !== true),
      input.concurrency ?? readPositiveInteger(process.env.ANNOUNCEMENT_INGEST_CONCURRENCY, 6),
      (source) => this.ingestSource(source)
    );
    return { summary: summarizeIngestion(results), results };
  }

  private async runIngestionForAdminAcrossAllPages(access: AdminUniversityAccess, concurrency?: number) {
    const sources: AnnouncementSourceRecord[] = [];
    const pageSize = 1_000;
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.listSourcesForAdmin(access, {
        status: "active",
        trustStatus: "trusted",
        limit: pageSize,
        offset
      });
      sources.push(...page.filter((source) => source.approvalPending !== true));
      if (page.length < pageSize) break;
    }
    const results = await runAnnouncementSourcesWithConcurrency(
      sources,
      concurrency ?? readPositiveInteger(process.env.ANNOUNCEMENT_INGEST_CONCURRENCY, 6),
      (source) => this.ingestSource(source)
    );
    return { summary: summarizeIngestion(results), results };
  }

  async runDiscoveryAndIngestionForAdmin(
    access: AdminUniversityAccess,
    input: { limit?: number; offset?: number; refreshSources?: boolean; concurrency?: number } = {}
  ) {
    if (access.kind === "global") return this.runDiscoveryAndIngestion(input);
    const discovery = await this.runSourceDiscoveryForAdmin(access, input);
    const ingestion = input.refreshSources
      ? await this.runIngestionForAdminAcrossAllPages(access, input.concurrency)
      : await this.runIngestionForAdmin(access, {
          ...(input.limit ? { limit: input.limit } : {}),
          ...(input.offset !== undefined ? { offset: input.offset } : {}),
          ...(input.concurrency ? { concurrency: input.concurrency } : {})
        });
    return {
      discovery: discovery.summary,
      ingestion: ingestion.summary,
      discoveryResults: discovery.results,
      ingestionResults: ingestion.results
    };
  }

  async createManualSource(input: ManualAnnouncementSourceInput) {
    const scope = await this.resolveManualScope(input);
    const authority = await this.resolveAuthority(scope.university, input.scopeType, scope.scopeId);
    const decision = evaluateSourceAuthority(authority.context, {
      boundary: "registration",
      resource: sourceAuthorityResource(input.contentType),
      url: input.sourceUrl
    });
    if (!decision.allowed || !decision.canonicalUrl) {
      await this.insertRejectedCandidate({
        scopeType: input.scopeType,
        scopeId: scope.scopeId,
        ownerUniversityId: scope.ownerUniversityId,
        ...(scope.ownerFacultyId ? { ownerFacultyId: scope.ownerFacultyId } : {}),
        sourceName: input.sourceName,
        sourceUrl: decision.canonicalUrl ?? input.sourceUrl,
        contentType: input.contentType,
        parser: input.parser,
        ...(input.parserConfig ? { parserConfig: input.parserConfig } : {}),
        priority: input.priority,
        homepageUrl: scope.homepageUrl,
        discoveryMethod: "manual",
        healthStatus: "failed",
        lastError: decision.reasonCode,
        consecutiveFailures: 0,
        itemCount: 0,
        fetchIntervalMinutes: input.fetchIntervalMinutes,
        trustReasonCodes: [decision.reasonCode]
      });
      throw new BadRequestException(`Source authority validation failed: ${decision.reasonCode}.`);
    }
    const sourceHomepageUrl = isOfficialContentUrl(decision.canonicalUrl, scope.homepageUrl)
      ? scope.homepageUrl
      : homepageFromUrl(decision.canonicalUrl) ?? scope.homepageUrl;
    const source = await this.announcementRepository.insertQuarantinedSourceCandidate({
      scopeType: input.scopeType,
      scopeId: scope.scopeId,
      ownerUniversityId: scope.ownerUniversityId,
      ...(scope.ownerFacultyId ? { ownerFacultyId: scope.ownerFacultyId } : {}),
      sourceName: input.sourceName,
      sourceUrl: decision.canonicalUrl,
      contentType: input.contentType,
      parser: input.parser,
      ...(input.parserConfig ? { parserConfig: input.parserConfig } : {}),
      priority: input.priority,
      homepageUrl: sourceHomepageUrl,
      discoveryMethod: "manual",
      healthStatus: "pending",
      consecutiveFailures: 0,
      itemCount: 0,
      fetchIntervalMinutes: input.fetchIntervalMinutes,
      trustReasonCodes: []
    });
    return { source: presentSourceForAdmin(source), ingestion: null };
  }

  async updateManualSource(id: string, input: ManualAnnouncementSourceUpdateInput) {
    const existing = await this.announcementRepository.findSourceById(id);
    if (!existing) throw new NotFoundException("Announcement source not found.");
    const editFence: AnnouncementSourceEditFence = {
      ...sourceEditFenceFromRequest(input),
      expectedSourceUrl: existing.sourceUrl
    };
    assertSourceMatchesEditFence(existing, editFence);
    const {
      expectedSourceDefinitionVersion: _expectedSourceDefinitionVersion,
      expectedCanonicalUrl: _expectedCanonicalUrl,
      expectedTrustStatus: _expectedTrustStatus,
      expectedSourceStatus: _expectedSourceStatus,
      expectedApprovalPending: _expectedApprovalPending,
      expectedUpdatedAt: _expectedUpdatedAt,
      ...requestedUpdates
    } = input;
    void _expectedSourceDefinitionVersion;
    void _expectedCanonicalUrl;
    void _expectedTrustStatus;
    void _expectedSourceStatus;
    void _expectedApprovalPending;
    void _expectedUpdatedAt;
    const definedInput = Object.fromEntries(
      Object.entries(requestedUpdates).filter(([, value]) => value !== undefined)
    ) as ManualAnnouncementSourceMutableUpdate;
    const authority = await this.resolveAuthorityForSource(existing);
    const requestedUrl = input.sourceUrl ?? existing.sourceUrl;
    const decision = authority
      ? evaluateSourceAuthority(authority.context, {
        boundary: "registration",
        resource: sourceAuthorityResource(input.contentType ?? existing.contentType),
        url: requestedUrl
      })
      : missingSourceOwnerDecision(existing, requestedUrl, "registration");
    if (!decision.allowed || !decision.canonicalUrl) {
      const quarantined = await this.announcementRepository.updateSource(existing.id, {
        ...sourceInputFromRecord(existing),
        status: "inactive",
        trustStatus: "quarantined",
        approvalPending: false,
        trustReasonCodes: [...new Set([...(existing.trustReasonCodes ?? []), decision.reasonCode])].sort()
      }, editFence);
      if (!quarantined) throw sourceReviewConflict();
      await this.retireSourceNotifications(quarantined);
      throw new BadRequestException(`Source authority validation failed: ${decision.reasonCode}.`);
    }
    const sourceUrl = decision.canonicalUrl;
    const homepageUrl = existing.homepageUrl;
    if (!homepageUrl) throw new BadRequestException("Source homepage authority evidence is missing.");
    const sourceHomepageUrl = isOfficialContentUrl(sourceUrl, homepageUrl)
      ? homepageUrl
      : homepageFromUrl(sourceUrl) ?? homepageUrl;
    const requestedStatus = definedInput.status ?? existing.status;
    const definitionChanged = sourceUrl !== existing.sourceUrl
      || (input.contentType !== undefined && input.contentType !== existing.contentType)
      || (input.parser !== undefined && input.parser !== existing.parser)
      || (input.parserConfig !== undefined && !sameAnnouncementSourceParserConfig(input.parserConfig, existing.parserConfig));
    const requiresReview = existing.trustStatus !== "trusted"
      || definitionChanged
      || (existing.status !== "active" && requestedStatus === "active");
    const status = requiresReview ? "inactive" : requestedStatus;
    const persistedInput = sourceInputFromRecord(existing);
    // Browser/crawler evidence attests to one exact processing definition.
    // A human URL/parser/type correction must be re-verified rather than
    // displaying the old evidence beside the new source.
    if (definitionChanged) delete persistedInput.verificationEvidence;
    const updated = await this.announcementRepository.updateSource(existing.id, {
      ...persistedInput,
      ...definedInput,
      sourceUrl,
      homepageUrl: sourceHomepageUrl,
      discoveryMethod: "manual",
      status,
      trustStatus: requiresReview ? "quarantined" : "trusted",
      approvalPending: requiresReview || status !== "active" ? false : existing.approvalPending ?? false,
      trustReasonCodes: []
    }, editFence);
    if (!updated) throw sourceReviewConflict();
    if (definitionChanged) await this.retireSourceNotificationsForReview(existing);
    if (updated.status !== "active" || updated.trustStatus !== "trusted") {
      await this.retireSourceNotifications(updated);
      return { source: updated, ingestion: null };
    }
    const ingestion = await this.ingestSource(updated);
    return { source: await this.announcementRepository.findSourceById(updated.id) ?? updated, ingestion };
  }

  async ingestSourceById(id: string) {
    const source = await this.announcementRepository.findSourceById(id);
    if (!source) throw new NotFoundException("Announcement source not found.");
    if (source.status !== "active") throw new BadRequestException("Inactive sources cannot be ingested.");
    if (source.approvalPending === true) {
      throw new BadRequestException("Pending source approval must be retried from the source review action.");
    }
    return this.ingestSource(source);
  }

  async previewSource(source: AnnouncementSourceRecord): Promise<AnnouncementSourcePreviewResult> {
    const testedAt = new Date();
    const authority = await this.resolveAuthorityForSource(source);
    try {
      const registration = authority
        ? evaluateSourceAuthority(authority.context, {
            boundary: "registration",
            resource: sourceAuthorityResource(source.contentType),
            url: source.sourceUrl
          })
        : missingSourceOwnerDecision(source, source.sourceUrl, "registration");
      if (!registration.allowed) throw new Error(registration.reasonCode);
      const snapshot = await fetchDeviceRuntimeSourceSnapshot(
        source.sourceUrl,
        source.parser,
        readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7000),
        { authority: authority!.context, resource: sourceAuthorityResource(source.contentType) },
        {},
        source.contentType,
        testedAt,
        source.parserConfig
      );
      const publication = evaluateSourceAuthority(authority!.context, {
        boundary: "publication",
        resource: sourceAuthorityResource(source.contentType),
        url: source.sourceUrl,
        finalRedirectUrl: snapshot.finalUrl
      });
      if (!publication.allowed) throw new Error(publication.reasonCode);
      const acceptedItems = toAnnouncementItems(source, snapshot.items, testedAt);
      const status = acceptedItems.length > 0 ? "healthy" as const : "degraded" as const;
      const error = acceptedItems.length > 0
        ? undefined
        : snapshot.items.length === 0 ? "SOURCE_EMPTY_SNAPSHOT_REJECTED" : "No trusted announcement items parsed.";
      await this.announcementRepository.recordSourceCheck(source.id, status === "healthy" ? {
        healthStatus: status,
        lastCheckedAt: testedAt,
        lastSuccessAt: testedAt,
        consecutiveFailures: 0
      } : {
        healthStatus: status,
        lastCheckedAt: testedAt,
        lastError: error!,
        consecutiveFailures: (source.consecutiveFailures ?? 0) + 1
      }, source);
      return {
        sourceId: source.id,
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        finalUrl: snapshot.finalUrl,
        status,
        parsedItemCount: snapshot.items.length,
        acceptedItemCount: acceptedItems.length,
        testedAt: testedAt.toISOString(),
        samples: snapshot.items.slice(0, 10).map((item) => ({
          title: item.title,
          url: item.link,
          ...(item.publishedAt ? { publishedAt: item.publishedAt.toISOString() } : {}),
          ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
          ...(item.keyDates?.length ? { keyDates: item.keyDates } : {}),
          ...(item.summary ? { summary: item.summary } : {}),
          ...(item.body?.length ? { body: item.body } : {})
        })),
        ...(error ? { error } : {})
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.announcementRepository.recordSourceCheck(source.id, {
        healthStatus: "failed",
        lastCheckedAt: testedAt,
        lastError: message,
        consecutiveFailures: (source.consecutiveFailures ?? 0) + 1
      }, source);
      return {
        sourceId: source.id,
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        status: "failed",
        parsedItemCount: 0,
        acceptedItemCount: 0,
        testedAt: testedAt.toISOString(),
        samples: [],
        error: message
      };
    }
  }

  private async previewUniversityCalendarSource(
    universityId: string,
    activateWhenHealthy: boolean
  ): Promise<AnnouncementSourcePreviewResult> {
    const profile = await this.announcementRepository.findUniversityCalendarSourceProfile(universityId);
    if (!profile) throw new NotFoundException("Academic calendar source profile has not been configured.");
    const university = await this.catalogRepository.findUniversityById(universityId);
    if (!university || university.status !== "active") throw new NotFoundException("University not found.");
    const testedAt = new Date();
    try {
      const authority = await this.resolveAuthority(university, "university", university.id);
      const response = await fetchText(profile.sourceUrl, readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7000), {
        accept: "text/html,application/pdf;q=0.9,*/*;q=0.8",
        authority: authority.context,
        resource: "academic_calendar",
        maximumResponseBytes: 5 * 1024 * 1024
      });
      const directDocument = /^(?:application\/pdf|application\/octet-stream)(?:\s*;|$)/iu.test(response.contentType ?? "")
        || /\.pdf(?:$|[?#])/iu.test(response.finalUrl);
      const configuredItems = !directDocument && profile.parserConfig?.itemSelector
        ? parseConfiguredAnnouncementHtml(response.text, response.finalUrl, profile.parserConfig, "academic_calendar")
        : [];
      if (!directDocument && profile.parserConfig?.itemSelector && configuredItems.length === 0) {
        throw new Error("SOURCE_HTML_SELECTOR_LAYOUT_INVALID");
      }
      const title = cleanText(response.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1]) || "Akademik Takvim";
      const samples = configuredItems.length > 0
        ? configuredItems.slice(0, 10).map((item) => ({
            title: item.title,
            url: item.link,
            ...(item.publishedAt ? { publishedAt: item.publishedAt.toISOString() } : {}),
            ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
            ...(item.summary ? { summary: item.summary } : {}),
            ...(item.body?.length ? { body: item.body } : {})
          }))
        : [{ title, url: response.finalUrl }];
      await this.announcementRepository.upsertUniversityCalendarSourceProfile({
        ...calendarProfileInput(profile),
        status: activateWhenHealthy ? "active" : profile.status,
        healthStatus: "healthy",
        lastCheckedAt: testedAt,
        lastSuccessAt: testedAt,
        itemCount: samples.length
      });
      return {
        sourceId: profile.id,
        sourceName: `${university.name} Akademik Takvim`,
        sourceUrl: profile.sourceUrl,
        finalUrl: response.finalUrl,
        status: "healthy",
        parsedItemCount: samples.length,
        acceptedItemCount: samples.length,
        testedAt: testedAt.toISOString(),
        samples,
        activationStatus: activateWhenHealthy ? "active" : "not_requested",
        ...(response.contentType ? { detectedContentType: response.contentType } : {})
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.announcementRepository.upsertUniversityCalendarSourceProfile({
        ...calendarProfileInput(profile),
        status: activateWhenHealthy ? "inactive" : profile.status,
        healthStatus: "failed",
        lastCheckedAt: testedAt,
        lastError: message,
        itemCount: 0
      });
      return {
        sourceId: profile.id,
        sourceName: `${university.name} Akademik Takvim`,
        sourceUrl: profile.sourceUrl,
        status: "failed",
        parsedItemCount: 0,
        acceptedItemCount: 0,
        testedAt: testedAt.toISOString(),
        samples: [],
        error: message,
        activationStatus: activateWhenHealthy ? "inactive" : "not_requested"
      };
    }
  }

  /**
   * Explicitly provisions registry candidates for later review. Runtime startup,
   * ingestion, and read paths must never call this method.
   */
  async provisionStaticAnnouncementSources(): Promise<AnnouncementRegistryProvisionResult> {
    if (this.staticSourcesPromise) return this.staticSourcesPromise;
    const provision = this.upsertStaticAnnouncementSources();
    this.staticSourcesPromise = provision;
    try {
      return await provision;
    } finally {
      if (this.staticSourcesPromise === provision) this.staticSourcesPromise = null;
    }
  }

  private async upsertStaticAnnouncementSources(): Promise<AnnouncementRegistryProvisionResult> {
    const existingSources: AnnouncementSourceRecord[] = [];
    const sourcePageSize = 1_000;
    for (let offset = 0; ; offset += sourcePageSize) {
      const page = await this.announcementRepository.listAllSources({ limit: sourcePageSize, offset });
      existingSources.push(...page);
      if (page.length < sourcePageSize) break;
    }
    const existingSourcesByKey = new Map(existingSources.flatMap((source) => {
      const key = staticSourceIdentityKey(
        source.scopeType,
        source.scopeId,
        source.contentType,
        source.canonicalUrl ?? source.sourceUrl
      );
      return key ? [[key, source] as const] : [];
    }));
    const result: AnnouncementRegistryProvisionResult = {
      created: 0,
      skipped: 0,
      evidenceAttached: 0,
      evidenceConflicts: 0,
      total: 0
    };
    const provisionIfMissing = async (
      input: Parameters<AnnouncementRepository["insertQuarantinedSourceCandidate"]>[0],
      authority: ResolvedSourceAuthorityContext
    ): Promise<void> => {
      result.total += 1;
      const decision = evaluateSourceAuthority(authority.context, {
        boundary: "registration",
        resource: sourceAuthorityResource(input.contentType),
        url: input.sourceUrl
      });
      const sourceUrl = decision.canonicalUrl ?? canonicalizeContentUrl(input.sourceUrl);
      if (!sourceUrl) {
        result.skipped += 1;
        return;
      }
      const candidate = {
        ...input,
        sourceUrl,
        trustReasonCodes: decision.allowed ? [] : [decision.reasonCode]
      };
      if (candidate.verificationEvidence) {
        assertVerificationEvidenceMatchesCandidate(candidate.verificationEvidence, candidate, authority.context);
      }
      const key = staticSourceIdentityKey(candidate.scopeType, candidate.scopeId, candidate.contentType, candidate.sourceUrl);
      if (!key) {
        result.skipped += 1;
        return;
      }
      const existing = existingSourcesByKey.get(key);
      if (existing) {
        if (candidate.verificationEvidence) {
          const attachment = await this.announcementRepository.attachVerificationEvidenceIfMissing(
            existing.id,
            candidate.verificationEvidence
          );
          if (attachment?.outcome === "attached") result.evidenceAttached += 1;
          if (attachment?.outcome === "conflict") result.evidenceConflicts += 1;
          if (attachment) existingSourcesByKey.set(key, attachment.source);
        }
        result.skipped += 1;
        return;
      }
      try {
        const persisted = await this.announcementRepository.insertQuarantinedSourceCandidate(candidate);
        existingSourcesByKey.set(key, persisted);
        result.created += 1;
      } catch (error) {
        throw error;
      }
    };

    await provisionIfMissing({
      scopeType: "university",
      scopeId: YOK_ANNOUNCEMENT_SCOPE_ID,
      ownerUniversityId: YOK_ANNOUNCEMENT_SCOPE_ID,
      sourceName: "YÖK Duyuruları",
      sourceUrl: YOK_ANNOUNCEMENT_SOURCE_URL,
      contentType: "announcement",
      parser: "auto",
      priority: 100,
      homepageUrl: "https://www.yok.gov.tr/tr",
      discoveryMethod: "manual"
    }, await resolveSourceAuthorityContext({
      universityId: YOK_ANNOUNCEMENT_SCOPE_ID,
      ownerAcademicEntityId: YOK_ANNOUNCEMENT_SCOPE_ID,
      scopeType: "university",
      scopeId: YOK_ANNOUNCEMENT_SCOPE_ID
    }));

    const provisionConcurrency = readPositiveInteger(process.env.ANNOUNCEMENT_REGISTRY_PROVISION_CONCURRENCY, 8);
    const verifiedSources = await listVerifiedUniversitySources();
    await runWithConcurrency(verifiedSources, provisionConcurrency, async (source) => {
      const university = await this.catalogRepository.findUniversityById(source.universityId);
      if (!university) return;
      const definitions = verifiedContentSourceDefinitions(source);
      const officialHomepage = university.websiteUrl ?? knownOfficialUniversityUrls(university.id)[0] ?? knownOfficialUniversityUrls(university.slug)[0];
      if (!officialHomepage) return;
      const authority = await this.resolveAuthority(university, "university", university.id);
      for (const definition of definitions) {
        await provisionIfMissing({
          scopeType: "university",
          scopeId: source.universityId,
          ownerUniversityId: source.universityId,
          sourceName: `${source.universityName} ${definition.label}`,
          sourceUrl: definition.url,
          contentType: definition.contentType,
          ...(definition.verificationEvidence ? { verificationEvidence: definition.verificationEvidence } : {}),
          parser: definition.parser,
          ...(definition.parserConfig ? { parserConfig: definition.parserConfig } : {}),
          priority: definition.priority,
          homepageUrl: canonicalizeContentUrl(officialHomepage) ?? officialHomepage,
          discoveryMethod: "manual"
        }, authority);
      }
    });

    const verifiedAcademicUnitSources = await listVerifiedAcademicUnitSources();
    const facultyCache = new Map<string, Promise<FacultyRecord[]>>();
    const departmentCache = new Map<string, Promise<DepartmentRecord[]>>();
    await runWithConcurrency(verifiedAcademicUnitSources, provisionConcurrency, async (source) => {
      const scopeId = source.scopeType === "department" ? source.departmentId : source.facultyId;
      if (!scopeId) return;
      const university = await this.catalogRepository.findUniversityById(source.universityId);
      if (!university) return;
      const faculties = await (facultyCache.get(university.id) ?? (() => {
        const request = this.catalogRepository.listFaculties(university.id, "active");
        facultyCache.set(university.id, request);
        return request;
      })());
      const facultyId = source.facultyId;
      if (!facultyId || !faculties.some((faculty) => faculty.id === facultyId)) return;
      if (source.scopeType === "department") {
        const departments = await (departmentCache.get(facultyId) ?? (() => {
          const request = this.catalogRepository.listDepartments(facultyId, "active");
          departmentCache.set(facultyId, request);
          return request;
        })());
        if (!source.departmentId || !departments.some((department) => department.id === source.departmentId)) return;
      }
      const definitions = verifiedContentSourceDefinitions(source);
      const universityAuthority = university.websiteUrl ?? knownOfficialUniversityUrls(university.id)[0] ?? knownOfficialUniversityUrls(university.slug)[0];
      if (!universityAuthority) return;
      const officialHomepage = source.websiteUrl && isOfficialContentUrl(source.websiteUrl, universityAuthority)
        ? source.websiteUrl
        : universityAuthority;
      const authority = await this.resolveAuthority(university, source.scopeType, scopeId);
      for (const definition of definitions) {
        const unitName = source.scopeType === "department" ? source.departmentName ?? "Bölüm" : source.facultyName ?? "Fakülte";
        const sourceName = `${source.universityName ?? source.universityId} ${unitName} ${definition.label}`;
        await provisionIfMissing({
          scopeType: source.scopeType,
          scopeId,
          ownerUniversityId: source.universityId,
          ...(source.scopeType === "department" && source.facultyId ? { ownerFacultyId: source.facultyId } : {}),
          sourceName,
          sourceUrl: definition.url,
          contentType: definition.contentType,
          ...(definition.verificationEvidence ? { verificationEvidence: definition.verificationEvidence } : {}),
          parser: definition.parser,
          ...(definition.parserConfig ? { parserConfig: definition.parserConfig } : {}),
          priority: definition.priority + (source.scopeType === "department" ? 15 : 10),
          homepageUrl: canonicalizeContentUrl(officialHomepage) ?? officialHomepage,
          discoveryMethod: "manual"
        }, authority);
      }
    });
    return result;
  }

  async runScheduledCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.announcementRepository.reconcileSnapshotRetention?.();
      // Discovery creates quarantined candidates and is intentionally an
      // operator-triggered workflow. Running it whenever no source has yet
      // been approved would recrawl the complete university catalog on every
      // scheduler tick in a fresh deployment.
      if (process.env.ANNOUNCEMENT_REFRESH_SOURCES === "true") {
        await this.runDiscoveryAndIngestion({ refreshSources: true });
        return;
      }
      const dueSources = (await this.listAllActiveSources())
        .filter((source) => isSourceDue(source))
        .sort(compareScheduledSourceDueOrder)
        .slice(0, readPositiveInteger(process.env.ANNOUNCEMENT_INGEST_BATCH_SIZE, 50));
      if (dueSources.length === 0) return;
      await runAnnouncementSourcesWithConcurrency(
        dueSources,
        readPositiveInteger(process.env.ANNOUNCEMENT_INGEST_CONCURRENCY, 6),
        (source) => this.ingestSource(source)
      );
    } finally {
      this.running = false;
    }
  }

  async runDailyHealthCycle(): Promise<AnnouncementHealthProbeCycleResult> {
    return this.runHealthProbeCycle("daily");
  }

  async probeSourceForDeviceManifestById(id: string): Promise<AnnouncementHealthProbeResult> {
    const source = await this.announcementRepository.findSourceById(id);
    if (!source) throw new NotFoundException("Announcement source not found.");
    if (source.status !== "active" || source.trustStatus !== "trusted" || source.approvalPending === true) {
      throw new BadRequestException("Only published announcement sources can be device-probed.");
    }
    return this.probeSourceHealth(source, "daily");
  }

  /**
   * Refreshes device-visible revisions without turning a short revision-poll
   * outage into three daily security failures. Authority violations still
   * quarantine immediately, and successful polls still refresh probe state.
   */
  runDeviceRevisionCycle(): Promise<AnnouncementHealthProbeCycleResult> {
    return this.runHealthProbeCycle("revision");
  }

  private async runHealthProbeCycle(
    mode: "daily" | "revision"
  ): Promise<AnnouncementHealthProbeCycleResult> {
    if (this.healthProbeCycle) return this.healthProbeCycle;
    const cycle = this.executeHealthProbeCycle(mode);
    this.healthProbeCycle = cycle;
    try {
      return await cycle;
    } finally {
      if (this.healthProbeCycle === cycle) this.healthProbeCycle = null;
    }
  }

  private async executeHealthProbeCycle(
    mode: "daily" | "revision"
  ): Promise<AnnouncementHealthProbeCycleResult> {
    const cycleStartedAt = new Date();
    const sources = (await this.listAllActiveSources()).filter((source) => (
      mode === "revision" || !sameIstanbulDate(source.healthProbe?.lastFullCheckedAt, cycleStartedAt)
    ));
    const results = await runAnnouncementSourcesWithConcurrency(
      sources,
      readPositiveInteger(process.env.ANNOUNCEMENT_HEALTH_PROBE_CONCURRENCY, 6),
      (source) => this.probeSourceHealth(source, mode)
    );
    return {
      checkedSources: results.length,
      healthy: results.filter((result) => result.status === "healthy").length,
      degraded: results.filter((result) => result.status === "degraded").length,
      failed: results.filter((result) => result.status === "failed").length,
      changed: results.filter((result) => result.contentChanged).length,
      results
    };
  }

  private async probeSourceHealth(
    source: AnnouncementSourceRecord,
    mode: "daily" | "revision"
  ): Promise<AnnouncementHealthProbeResult> {
    const checkedAt = new Date();
    try {
      const authority = await this.resolveAuthorityForSource(source);
      const registrationDecision = authority
        ? evaluateSourceAuthority(authority.context, {
          boundary: "registration",
          resource: sourceAuthorityResource(source.contentType),
          url: source.sourceUrl
        })
        : missingSourceOwnerDecision(source, source.sourceUrl, "registration");
      if (!authority || !registrationDecision.allowed) {
        return this.quarantineHealthProbeSource(source, registrationDecision, checkedAt, mode);
      }

      const previous = source.healthProbe;
      const snapshot = await fetchDeviceRuntimeSourceSnapshot(
        source.sourceUrl,
        source.parser,
        readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7000),
        { authority: authority.context, resource: sourceAuthorityResource(source.contentType) },
        mode === "revision" && previous?.engineVersion === DEVICE_SOURCE_RUNTIME_VERSION ? {
          ...(previous?.etag ? { etag: previous.etag } : {}),
          ...(previous?.lastModified ? { lastModified: previous.lastModified } : {})
        } : {},
        source.contentType ?? "announcement",
        checkedAt,
        source.parserConfig
      );
      const publicationDecision = evaluateSourceAuthority(authority.context, {
        boundary: "publication",
        resource: sourceAuthorityResource(source.contentType),
        url: source.sourceUrl,
        finalRedirectUrl: snapshot.finalUrl
      });
      if (!publicationDecision.allowed) {
        return this.quarantineHealthProbeSource(source, publicationDecision, checkedAt, mode);
      }

      if (snapshot.fetchStatus === "not_modified") {
        if (mode === "daily") throw new Error("SOURCE_HEALTH_PROBE_UNEXPECTED_NOT_MODIFIED");
        const previousItemCount = previous?.itemCount ?? 0;
        if (
          previous?.engineVersion !== DEVICE_SOURCE_RUNTIME_VERSION
          || !previous.lastSuccessAt
          || !previous.contentHash
          || previousItemCount === 0
        ) {
          throw new Error("SOURCE_HEALTH_PROBE_NOT_MODIFIED_WITHOUT_BASELINE");
        }
        const etag = snapshot.etag ?? previous.etag;
        const lastModified = snapshot.lastModified ?? previous.lastModified;
        if (previous.healthStatus === "degraded" || previous.healthStatus === "failed") {
          await this.persistHealthProbe(source, {
            engineVersion: DEVICE_SOURCE_RUNTIME_VERSION,
            healthStatus: previous.healthStatus,
            lastCheckedAt: checkedAt,
            ...fullHealthCheckTimestamp(previous, mode, checkedAt),
            lastSuccessAt: previous.lastSuccessAt,
            ...(previous.lastError ? { lastError: previous.lastError } : {}),
            consecutiveFailures: previous.consecutiveFailures,
            itemCount: previousItemCount,
            ...(etag ? { etag } : {}),
            ...(lastModified ? { lastModified } : {}),
            contentHash: previous.contentHash,
            ...(previous.lastContentChangedAt ? { lastContentChangedAt: previous.lastContentChangedAt } : {})
          });
          return {
            sourceId: source.id,
            status: previous.healthStatus,
            itemCount: previousItemCount,
            contentChanged: false,
            ...(previous.lastError ? { error: healthProbeErrorCode(previous.lastError) } : {})
          };
        }
        await this.persistHealthProbe(source, {
          engineVersion: DEVICE_SOURCE_RUNTIME_VERSION,
          healthStatus: "healthy",
          lastCheckedAt: checkedAt,
          ...fullHealthCheckTimestamp(previous, mode, checkedAt),
          lastSuccessAt: checkedAt,
          consecutiveFailures: 0,
          itemCount: previousItemCount,
          ...(etag ? { etag } : {}),
          ...(lastModified ? { lastModified } : {}),
          contentHash: previous.contentHash,
          ...(previous.lastContentChangedAt ? { lastContentChangedAt: previous.lastContentChangedAt } : {})
        });
        return { sourceId: source.id, status: "healthy", itemCount: previousItemCount, contentChanged: false };
      }

      const rejectedItemDecision = snapshot.items
        .map((item) => evaluateSourceAuthority(authority.context, {
          boundary: "publication",
          resource: sourceAuthorityResource(source.contentType),
          url: item.link
        }))
        .find((decision) => !decision.allowed);
      if (rejectedItemDecision) {
        return this.quarantineHealthProbeSource(source, rejectedItemDecision, checkedAt, mode);
      }
      if (snapshot.items.length === 0) throw new Error("SOURCE_HEALTH_PROBE_EMPTY");

      // Device refreshes follow parsed listing changes, not rotating banners,
      // analytics markup, or other irrelevant response-body differences.
      const contentHash = healthProbeContentHash(snapshot.items);
      const contentChanged = contentHash !== previous?.contentHash;
      await this.persistHealthProbe(source, {
        engineVersion: DEVICE_SOURCE_RUNTIME_VERSION,
        healthStatus: "healthy",
        lastCheckedAt: checkedAt,
        ...fullHealthCheckTimestamp(previous, mode, checkedAt),
        lastSuccessAt: checkedAt,
        consecutiveFailures: 0,
        itemCount: snapshot.items.length,
        ...(snapshot.etag ? { etag: snapshot.etag } : {}),
        ...(snapshot.lastModified ? { lastModified: snapshot.lastModified } : {}),
        contentHash,
        ...(contentChanged
          ? { lastContentChangedAt: checkedAt }
          : previous?.lastContentChangedAt ? { lastContentChangedAt: previous.lastContentChangedAt } : {})
      });
      return {
        sourceId: source.id,
        status: "healthy",
        itemCount: snapshot.items.length,
        contentChanged
      };
    } catch (error) {
      if (error instanceof SourceAuthorityError) {
        return this.quarantineHealthProbeSource(source, error.decision, checkedAt, mode);
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message === "ANNOUNCEMENT_SOURCE_DEFINITION_CHANGED") {
        return { sourceId: source.id, status: "failed", itemCount: 0, contentChanged: false, error: message };
      }
      const errorCode = healthProbeErrorCode(message);
      if (mode === "revision") {
        return {
          sourceId: source.id,
          status: source.healthProbe?.healthStatus === "failed" ? "failed" : "degraded",
          itemCount: source.healthProbe?.itemCount ?? 0,
          contentChanged: false,
          error: errorCode
        };
      }
      const failures = (source.healthProbe?.consecutiveFailures ?? 0) + 1;
      await this.persistHealthProbe(source, {
        ...failedHealthProbe(source.healthProbe, checkedAt, errorCode, failures),
        ...fullHealthCheckTimestamp(source.healthProbe, mode, checkedAt)
      });
      return {
        sourceId: source.id,
        status: failures >= 3 ? "failed" : "degraded",
        itemCount: 0,
        contentChanged: false,
        error: errorCode
      };
    }
  }

  private async quarantineHealthProbeSource(
    source: AnnouncementSourceRecord,
    decision: SourceAuthorityDecision,
    checkedAt: Date,
    mode: "daily" | "revision"
  ): Promise<AnnouncementHealthProbeResult> {
    const quarantined = await this.announcementRepository.quarantineSource(source.id, [decision.reasonCode], source);
    if (!quarantined) throw new Error("ANNOUNCEMENT_SOURCE_DEFINITION_CHANGED");
    const failures = (source.healthProbe?.consecutiveFailures ?? 0) + 1;
    const errorCode = `SOURCE_AUTHORITY_${decision.reasonCode.toLocaleUpperCase("en-US")}`;
    await this.persistHealthProbe(source, {
      ...failedHealthProbe(source.healthProbe, checkedAt, errorCode, failures),
      ...fullHealthCheckTimestamp(source.healthProbe, mode, checkedAt),
      healthStatus: "failed"
    });
    await this.retireSourceNotificationsForReview(quarantined);
    return {
      sourceId: source.id,
      status: "failed",
      itemCount: 0,
      contentChanged: false,
      error: errorCode
    };
  }

  private async persistHealthProbe(
    source: AnnouncementSourceRecord,
    probe: AnnouncementSourceHealthProbe
  ): Promise<void> {
    const updated = await this.announcementRepository.recordSourceHealthProbe(source.id, probe, source);
    if (!updated) throw new Error("ANNOUNCEMENT_SOURCE_DEFINITION_CHANGED");
  }

  async ingestSource(source: AnnouncementSourceRecord): Promise<AnnouncementIngestionResult> {
    if (source.status !== "active" || source.trustStatus !== "trusted") {
      throw new BadRequestException("Only active, trusted announcement sources can be ingested.");
    }
    const checkedAt = new Date();
    const approvalPending = source.approvalPending === true;
    const authority = await this.resolveAuthorityForSource(source);
    const registrationDecision = authority
      ? evaluateSourceAuthority(authority.context, {
        boundary: "registration",
        resource: sourceAuthorityResource(source.contentType),
        url: source.sourceUrl
      })
      : missingSourceOwnerDecision(source, source.sourceUrl, "registration");
    if (!registrationDecision.allowed) {
      return this.quarantineIngestionSource(source, registrationDecision, checkedAt);
    }
    let trustedSnapshotItemCount = source.itemCount ?? 0;
    let healthFenceSnapshotId = source.activeSnapshotId;
    try {
      if (!approvalPending && source.itemCount === undefined) {
        trustedSnapshotItemCount = (await this.announcementRepository.listItemsForSource(source.id, 1_000)).length;
      }
      // Approval validates the same recipe as preview and devices, without legacy detail hydration.
      const snapshot = approvalPending
        ? await fetchDeviceRuntimeSourceSnapshot(
            source.sourceUrl,
            source.parser,
            readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7000),
            { authority: authority!.context, resource: sourceAuthorityResource(source.contentType) },
            {},
            source.contentType,
            checkedAt,
            source.parserConfig
          )
        : await fetchSourceSnapshot(
            source.sourceUrl,
            source.parser,
            readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7000),
            { authority: authority!.context, resource: sourceAuthorityResource(source.contentType) },
            source.processingVersion === ANNOUNCEMENT_PROCESSING_VERSION
              ? {
                  ...(source.etag ? { etag: source.etag } : {}),
                  ...(source.lastModified ? { lastModified: source.lastModified } : {}),
                  ...(source.contentHash ? { contentHash: source.contentHash } : {})
                }
              : {},
            source.contentType,
            source.parserConfig
          );
      const publicationDecision = evaluateSourceAuthority(authority!.context, {
        boundary: "publication",
        resource: sourceAuthorityResource(source.contentType),
        url: source.sourceUrl,
        finalRedirectUrl: snapshot.finalUrl
      });
      if (!publicationDecision.allowed) {
        return this.quarantineIngestionSource(source, publicationDecision, checkedAt);
      }
      if (snapshot.fetchStatus === "not_modified") {
        const currentSource = await this.currentFencedSource(source);
        healthFenceSnapshotId = currentSource.activeSnapshotId;
        const activeItems = await this.loadFencedActiveItems(currentSource);
        trustedSnapshotItemCount = activeItems.length;
        if (activeItems.length === 0) {
          throw new Error("ANNOUNCEMENT_ACTIVE_SNAPSHOT_MISSING");
        }
        const retryDelta = notificationRetryDelta(currentSource, activeItems);
        if (!approvalPending && this.notificationSchedulingService && retryDelta.materiallyUpdated.length > 0) {
          await this.notificationSchedulingService.syncTrustedAnnouncementSource(currentSource, retryDelta, checkedAt);
        }
        await this.announcementRepository.recordSourceCheck(source.id, {
          healthStatus: "healthy",
          lastCheckedAt: checkedAt,
          lastSuccessAt: checkedAt,
          consecutiveFailures: 0,
          itemCount: activeItems.length,
          ...(snapshot.etag ? { etag: snapshot.etag } : {}),
          ...(snapshot.lastModified ? { lastModified: snapshot.lastModified } : {}),
          ...(snapshot.contentHash ? { contentHash: snapshot.contentHash } : {}),
          processingVersion: ANNOUNCEMENT_PROCESSING_VERSION
        }, currentSource, currentSource.activeSnapshotId ?? null);
        return {
          sourceId: source.id,
          sourceName: source.sourceName,
          sourceUrl: source.sourceUrl,
          status: "healthy",
          itemCount: 0,
          sampleTitles: []
        };
      }
      const parsedItems = snapshot.items;
      const items = toAnnouncementItems(source, parsedItems, checkedAt);
      const rejectedItemDecision = items
        .map((item) => evaluateSourceAuthority(authority!.context, {
          boundary: "publication",
          resource: sourceAuthorityResource(item.contentType ?? source.contentType),
          url: item.canonicalUrl ?? item.link
        }))
        .find((decision) => !decision.allowed);
      if (rejectedItemDecision) {
        return this.quarantineIngestionSource(source, rejectedItemDecision, checkedAt);
      }
      const succeeded = items.length > 0;
      if (succeeded) {
        const delta = await this.announcementRepository.replaceItemsForSource(source, items);
        healthFenceSnapshotId = delta.snapshotId ?? source.activeSnapshotId;
        trustedSnapshotItemCount = items.length;
        if (!approvalPending) {
          await this.notificationSchedulingService?.syncTrustedAnnouncementSource(source, delta, checkedAt);
        }
      }
      const status = succeeded ? "healthy" : "degraded";
      const failures = succeeded ? 0 : (source.consecutiveFailures ?? 0) + 1;
      const classificationAudit = succeeded ? {
        mode: "shadow" as const,
        classificationVersion: STUDENT_RELEVANCE_CLASSIFICATION_VERSION,
        counts: summarizeStudentRelevanceAudit(
          items.flatMap((item) => item.studentRelevance
            ? [{ studentRelevance: item.studentRelevance }]
            : [])
        )
      } : undefined;
      await this.announcementRepository.recordSourceCheck(source.id, {
        healthStatus: status,
        lastCheckedAt: checkedAt,
        ...(succeeded ? { lastSuccessAt: checkedAt } : {}),
        ...(succeeded ? {} : { lastError: parsedItems.length === 0 ? "SOURCE_EMPTY_SNAPSHOT_REJECTED" : "No trusted announcement items parsed." }),
        consecutiveFailures: failures,
        itemCount: succeeded ? items.length : trustedSnapshotItemCount,
        ...(succeeded && snapshot.etag ? { etag: snapshot.etag } : {}),
        ...(succeeded && snapshot.lastModified ? { lastModified: snapshot.lastModified } : {}),
        ...(succeeded && snapshot.contentHash ? { contentHash: snapshot.contentHash } : {}),
        ...(succeeded && snapshot.contentHash && snapshot.contentHash !== source.contentHash ? { lastContentChangedAt: checkedAt } : {}),
        ...(succeeded ? { processingVersion: ANNOUNCEMENT_PROCESSING_VERSION } : {})
      }, source, healthFenceSnapshotId ?? null);
      return {
        sourceId: source.id,
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        status,
        itemCount: succeeded ? items.length : 0,
        sampleTitles: items.slice(0, 3).map((item) => item.title),
        ...(classificationAudit ? { classificationAudit } : {}),
        ...(succeeded ? {} : { error: parsedItems.length === 0 ? "SOURCE_EMPTY_SNAPSHOT_REJECTED" : "No trusted announcement items parsed." })
      };
    } catch (error) {
      if (error instanceof SourceAuthorityError) {
        return this.quarantineIngestionSource(source, error.decision, checkedAt);
      }
      const message = error instanceof Error ? error.message : String(error);
      const failures = (source.consecutiveFailures ?? 0) + 1;
      await this.announcementRepository.recordSourceCheck(source.id, {
        healthStatus: failures >= 3 ? "failed" : "degraded",
        lastCheckedAt: checkedAt,
        lastError: message,
        consecutiveFailures: failures,
        itemCount: trustedSnapshotItemCount
      }, source, healthFenceSnapshotId ?? null);
      return { sourceId: source.id, sourceName: source.sourceName, sourceUrl: source.sourceUrl, status: failures >= 3 ? "failed" : "degraded", itemCount: 0, sampleTitles: [], error: message };
    }
  }

  private resolveAuthority(
    university: UniversityRecord,
    scopeType: "university" | "faculty" | "department",
    scopeId: string
  ): Promise<ResolvedSourceAuthorityContext> {
    return resolveAuthorityForUniversityRecord(university, scopeType, scopeId);
  }

  private async currentFencedSource(expected: AnnouncementSourceRecord): Promise<AnnouncementSourceRecord> {
    const current = await this.announcementRepository.findSourceById(expected.id);
    if (!current || current.status !== "active" || current.trustStatus !== "trusted") {
      throw new Error("ANNOUNCEMENT_SNAPSHOT_SOURCE_NOT_ACTIVE");
    }
    if (!sameAnnouncementSourceDefinition(current, expected)) {
      throw new Error("ANNOUNCEMENT_SOURCE_DEFINITION_CHANGED");
    }
    if ((current.activeSnapshotId?.trim() || undefined) !== (expected.activeSnapshotId?.trim() || undefined)) {
      throw new Error("ANNOUNCEMENT_NOTIFICATION_SNAPSHOT_CONFLICT");
    }
    return current;
  }

  private async loadFencedActiveItems(source: AnnouncementSourceRecord): Promise<AnnouncementItem[]> {
    const items: AnnouncementItem[] = [];
    for (let offset = 0; offset < ANNOUNCEMENT_NOTIFICATION_RETRY_MAX_ITEMS; offset += ANNOUNCEMENT_NOTIFICATION_RETRY_PAGE_SIZE) {
      const page = await this.announcementRepository.listItemsForSource(
        source.id,
        Math.min(ANNOUNCEMENT_NOTIFICATION_RETRY_PAGE_SIZE, ANNOUNCEMENT_NOTIFICATION_RETRY_MAX_ITEMS - offset),
        offset
      );
      items.push(...page);
      if (page.length < ANNOUNCEMENT_NOTIFICATION_RETRY_PAGE_SIZE) break;
    }
    if (items.length === ANNOUNCEMENT_NOTIFICATION_RETRY_MAX_ITEMS) {
      const overflow = await this.announcementRepository.listItemsForSource(
        source.id,
        1,
        ANNOUNCEMENT_NOTIFICATION_RETRY_MAX_ITEMS
      );
      if (overflow.length > 0) throw new Error("ANNOUNCEMENT_NOTIFICATION_RETRY_OVERFLOW");
    }
    await this.currentFencedSource(source);
    return items;
  }

  private async schedulePublishedSourceNotifications(source: AnnouncementSourceRecord): Promise<void> {
    if (!this.notificationSchedulingService) return;
    try {
      const items = await this.loadFencedActiveItems(source);
      const retryDelta = notificationRetryDelta(source, items);
      if (retryDelta.materiallyUpdated.length > 0) {
        await this.notificationSchedulingService.syncTrustedAnnouncementSource(source, retryDelta, new Date());
      }
    } catch {
      // Publication is already committed. Eligible fingerprints remain
      // unacknowledged, so the normal ingestion retry path can schedule them
      // without reopening or hiding the healthy source.
    }
  }

  private async resolveAuthorityForSource(source: AnnouncementSourceRecord): Promise<ResolvedSourceAuthorityContext | null> {
    if (source.scopeType === "university" && source.scopeId === YOK_ANNOUNCEMENT_SCOPE_ID) {
      if (
        (source.ownerUniversityId !== undefined && source.ownerUniversityId !== YOK_ANNOUNCEMENT_SCOPE_ID)
        || source.ownerFacultyId !== undefined
      ) return null;
      return resolveSourceAuthorityContext({
        universityId: YOK_ANNOUNCEMENT_SCOPE_ID,
        ownerAcademicEntityId: YOK_ANNOUNCEMENT_SCOPE_ID,
        scopeType: "university",
        scopeId: YOK_ANNOUNCEMENT_SCOPE_ID
      });
    }
    if (source.ownerUniversityId !== undefined || source.ownerFacultyId !== undefined) {
      if (!source.ownerUniversityId) return null;
      const university = await this.catalogRepository.findUniversityById(source.ownerUniversityId);
      if (!university || university.status !== "active") return null;
      if (source.scopeType === "university") {
        if (source.ownerUniversityId !== source.scopeId || source.ownerFacultyId !== undefined) return null;
        return this.resolveAuthority(university, "university", source.scopeId);
      }
      const faculties = await this.catalogRepository.listFaculties(source.ownerUniversityId, "active");
      if (source.scopeType === "faculty") {
        if (source.ownerFacultyId !== undefined || !faculties.some((faculty) => faculty.id === source.scopeId && faculty.universityId === source.ownerUniversityId)) return null;
        return this.resolveAuthority(university, "faculty", source.scopeId);
      }
      if (!source.ownerFacultyId) return null;
      const faculty = faculties.find((candidate) => candidate.id === source.ownerFacultyId && candidate.universityId === source.ownerUniversityId);
      if (!faculty) return null;
      const department = (await this.catalogRepository.listDepartments(source.ownerFacultyId, "active"))
        .find((candidate) => candidate.id === source.scopeId
          && candidate.facultyId === source.ownerFacultyId
          && candidate.universityId === source.ownerUniversityId);
      return department ? this.resolveAuthority(university, "department", department.id) : null;
    }

    // Controlled compatibility path for records created before immutable
    // ownership fields existed. Any partially populated owner metadata above
    // fails closed instead of falling back to a national scan.
    if (source.scopeType === "university") {
      const university = await this.catalogRepository.findUniversityById(source.scopeId);
      return university?.status === "active" ? this.resolveAuthority(university, "university", university.id) : null;
    }
    const universities = await this.catalogRepository.listUniversities({ status: "active", limit: 5_000, offset: 0 });
    for (const university of universities) {
      const faculties = await this.catalogRepository.listFaculties(university.id, "active");
      if (source.scopeType === "faculty" && faculties.some((faculty) => faculty.id === source.scopeId)) {
        return this.resolveAuthority(university, "faculty", source.scopeId);
      }
      if (source.scopeType !== "department") continue;
      for (const faculty of faculties) {
        const department = (await this.catalogRepository.listDepartments(faculty.id, "active"))
          .find((candidate) => candidate.id === source.scopeId && candidate.universityId === university.id);
        if (department) return this.resolveAuthority(university, "department", department.id);
      }
    }
    return null;
  }

  private async insertRejectedCandidate(input: AnnouncementSourceCandidateInput): Promise<void> {
    try {
      await this.announcementRepository.insertQuarantinedSourceCandidate(input);
    } catch {
      // Unsafe/non-canonical URLs cannot be stored. The policy denial remains
      // the authoritative result returned to the caller.
    }
  }

  private async quarantineIngestionSource(
    source: AnnouncementSourceRecord,
    decision: SourceAuthorityDecision,
    checkedAt: Date
  ): Promise<AnnouncementIngestionResult> {
    const quarantined = await this.announcementRepository.quarantineSource(source.id, [decision.reasonCode], source);
    if (!quarantined) throw new Error("ANNOUNCEMENT_SOURCE_DEFINITION_CHANGED");
    await this.announcementRepository.recordSourceCheck(source.id, {
      healthStatus: "failed",
      lastCheckedAt: checkedAt,
      lastError: decision.reasonCode,
      consecutiveFailures: (source.consecutiveFailures ?? 0) + 1,
      itemCount: 0
    }, source);
    await this.retireSourceNotifications(quarantined);
    return {
      sourceId: source.id,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      status: "failed",
      itemCount: 0,
      sampleTitles: [],
      error: decision.reasonCode
    };
  }

  private async listUniversities(limit: number, offset: number): Promise<UniversityRecord[]> {
    return this.catalogRepository.listUniversities({ status: "active", limit, offset });
  }

  private async discoverUniversitySource(university: UniversityRecord): Promise<AnnouncementDiscoveryResult> {
    const result = await discoverAnnouncementSourceForUniversity(university, {
      timeoutMs: readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7000)
    });
    if (result.status !== "source_found" || !result.sourceUrl) return result;
    const officialHomepage = university.websiteUrl ?? result.homepageUrl;
    const authority = await this.resolveAuthority(university, "university", university.id);
    const registrationDecision = evaluateSourceAuthority(authority.context, {
      boundary: "registration",
      resource: "announcement",
      url: result.sourceUrl
    });
    if (!officialHomepage || !registrationDecision.allowed || !registrationDecision.canonicalUrl) {
      if (officialHomepage) {
        await this.insertRejectedCandidate({
          scopeType: "university",
          scopeId: university.id,
          ownerUniversityId: university.id,
          sourceName: `${university.name} Duyurular`,
          sourceUrl: registrationDecision.canonicalUrl ?? result.sourceUrl,
          contentType: "announcement",
          parser: result.parser ?? "auto",
          ...(result.parserConfig ? { parserConfig: result.parserConfig } : {}),
          priority: 20,
          homepageUrl: canonicalizeContentUrl(officialHomepage) ?? officialHomepage,
          discoveryMethod: university.websiteUrl ? "catalog_website" : "domain_candidate",
          trustReasonCodes: [registrationDecision.reasonCode]
        });
      }
      const { sourceUrl: _sourceUrl, parser: _parser, parserConfig: _parserConfig, ...rest } = result;
      void _sourceUrl;
      void _parser;
      void _parserConfig;
      return {
        ...rest,
        status: "homepage_found_no_items",
        itemCount: 0,
        sampleTitles: [],
        error: registrationDecision.reasonCode
      };
    }

    await this.announcementRepository.insertQuarantinedSourceCandidate({
      scopeType: "university",
      scopeId: university.id,
      ownerUniversityId: university.id,
      sourceName: `${university.name} Duyurular`,
      sourceUrl: registrationDecision.canonicalUrl,
      contentType: "announcement",
      parser: result.parser ?? "auto",
      ...(result.parserConfig ? { parserConfig: result.parserConfig } : {}),
      priority: 20,
      homepageUrl: canonicalizeContentUrl(officialHomepage) ?? officialHomepage,
      discoveryMethod: university.websiteUrl ? "catalog_website" : "domain_candidate",
      healthStatus: result.itemCount > 0 ? "healthy" : "degraded",
      lastCheckedAt: new Date(),
      ...(result.itemCount > 0 ? { lastSuccessAt: new Date() } : {}),
      consecutiveFailures: result.itemCount > 0 ? 0 : 1,
      itemCount: result.itemCount,
      trustReasonCodes: []
    });
    return result;
  }

  private async listAnnouncementScopesForUniversity(universityId: string): Promise<AnnouncementSourceScope[]> {
    const faculties = await this.catalogRepository.listFaculties(universityId);
    const departments = (await Promise.all(faculties.map((faculty) => this.catalogRepository.listDepartments(faculty.id)))).flat();
    return [
      { scopeType: "university", scopeId: universityId },
      ...faculties.map((faculty) => ({ scopeType: "faculty" as const, scopeId: faculty.id })),
      ...departments
        .filter((department) => department.universityId === universityId)
        .map((department) => ({ scopeType: "department" as const, scopeId: department.id }))
    ];
  }

  private async getSourceForAdmin(access: AdminUniversityAccess, id: string): Promise<AnnouncementSourceRecord> {
    const source = await this.announcementRepository.findSourceById(id);
    if (!source) throw new NotFoundException("Announcement source not found.");
    if (access.kind === "global") return source;
    const allowedScopes = new Set(
      (await this.listAnnouncementScopesForUniversity(access.universityId))
        .map((scope) => `${scope.scopeType}\u0000${scope.scopeId}`)
    );
    if (!allowedScopes.has(`${source.scopeType}\u0000${source.scopeId}`)) {
      throw new NotFoundException("Announcement source not found.");
    }
    return source;
  }

  private async quarantineFailedSourceApproval(source: AnnouncementSourceRecord): Promise<void> {
    const fence = sourceReviewFenceFromRecord(source);
    let quarantined = await this.announcementRepository.reviewSource(source.id, {
      decision: "quarantine"
    }, fence);
    if (!quarantined) {
      const current = await this.announcementRepository.findSourceById(source.id);
      if (
        current
        && current.status === "inactive"
        && current.trustStatus === "quarantined"
        && sameAnnouncementSourceDefinition(current, source)
        && canonicalizeContentUrl(current.canonicalUrl ?? current.sourceUrl) === fence.expectedCanonicalUrl
      ) {
        quarantined = current;
      }
    }
    if (!quarantined) throw sourceReviewConflict();
    await this.retireSourceNotificationsForReview(quarantined);
  }

  private async retireSourceNotificationsForReview(source: AnnouncementSourceRecord): Promise<void> {
    try {
      await this.retireSourceNotifications(source);
    } catch {
      throw new ConflictException("Announcement source changed safely, but notification retirement must be retried.");
    }
  }

  private async resolveManualScope(input: ManualAnnouncementSourceInput): Promise<{
    scopeId: string;
    homepageUrl: string;
    university: UniversityRecord;
    ownerUniversityId: string;
    ownerFacultyId?: string;
  }> {
    const university = await this.catalogRepository.findUniversityById(input.universityId);
    if (!university || university.status !== "active") {
      throw new BadRequestException("Selected university has no verified active website.");
    }
    let universityHomepage = university.websiteUrl ?? knownOfficialUniversityUrls(university.id)[0] ?? knownOfficialUniversityUrls(university.slug)[0];
    if (!universityHomepage) {
      const authority = await findVerifiedSourceAuthority(university.id);
      if (authority?.status === "verified") {
        const { context } = await this.resolveAuthority(university, "university", university.id);
        for (const url of authority.authorityUrls) {
          const decision = evaluateSourceAuthority(context, { boundary: "registration", resource: "website", url });
          if (decision.allowed && decision.canonicalUrl) {
            universityHomepage = decision.canonicalUrl;
            break;
          }
        }
      }
    }
    if (!universityHomepage) {
      throw new BadRequestException("Selected university has no verified active website.");
    }
    if (input.scopeType === "university") {
      return { scopeId: university.id, homepageUrl: universityHomepage, university, ownerUniversityId: university.id };
    }
    const faculty = (await this.catalogRepository.listFaculties(university.id, "active"))
      .find((candidate) => candidate.id === input.facultyId);
    if (!faculty) throw new BadRequestException("Selected faculty does not belong to the university.");
    const facultyHomepage = faculty.websiteUrl && isOfficialContentUrl(faculty.websiteUrl, universityHomepage)
      ? faculty.websiteUrl
      : universityHomepage;
    if (input.scopeType === "faculty") {
      return { scopeId: faculty.id, homepageUrl: facultyHomepage, university, ownerUniversityId: university.id };
    }
    const department = (await this.catalogRepository.listDepartments(faculty.id, "active"))
      .find((candidate) => candidate.id === input.departmentId && candidate.universityId === university.id);
    if (!department) throw new BadRequestException("Selected department does not belong to the faculty.");
    const departmentHomepage = department.websiteUrl && isOfficialContentUrl(department.websiteUrl, facultyHomepage)
      ? department.websiteUrl
      : facultyHomepage;
    return {
      scopeId: department.id,
      homepageUrl: departmentHomepage,
      university,
      ownerUniversityId: university.id,
      ownerFacultyId: faculty.id
    };
  }

  private retireSourceNotifications(source: AnnouncementSourceRecord): Promise<unknown> {
    return this.notificationSchedulingService?.retireTrustedAnnouncementSource(source) ?? Promise.resolve();
  }
}

export interface ManualAnnouncementSourceInput {
  scopeType: "university" | "faculty" | "department";
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  sourceName: string;
  sourceUrl: string;
  contentType: AnnouncementContentType;
  parser: AnnouncementSourceParser;
  parserConfig?: AnnouncementSourceParserConfig;
  priority: number;
  fetchIntervalMinutes: number;
}

export interface ManualAnnouncementSourceMutableUpdate {
  sourceName?: string;
  sourceUrl?: string;
  contentType?: AnnouncementContentType;
  parser?: AnnouncementSourceParser;
  parserConfig?: AnnouncementSourceParserConfig;
  priority?: number;
  fetchIntervalMinutes?: number;
  status?: AnnouncementSourceStatus;
}

export interface ManualAnnouncementSourceUpdateInput extends ManualAnnouncementSourceMutableUpdate {
  expectedSourceDefinitionVersion: string;
  expectedCanonicalUrl: string;
  expectedTrustStatus: AnnouncementTrustStatus;
  expectedSourceStatus: AnnouncementSourceStatus;
  expectedApprovalPending: boolean;
  expectedUpdatedAt: string;
}

function notificationRetryDelta(
  source: AnnouncementSourceRecord,
  items: readonly AnnouncementItem[]
): AnnouncementPersistenceDelta {
  const delta = emptyAnnouncementPersistenceDelta();
  const activeSnapshotId = source.activeSnapshotId?.trim() || undefined;
  for (const item of items) {
    if (activeSnapshotId && item.snapshotId !== activeSnapshotId) {
      throw new Error("ANNOUNCEMENT_NOTIFICATION_SNAPSHOT_CONFLICT");
    }
    const reference = toPersistenceReference(item);
    if (!reference) continue;
    if (item.notificationEligibleFingerprint === reference.contentFingerprint) {
      delta.materiallyUpdated.push(reference);
    } else if (item.notificationProducedFingerprint === reference.contentFingerprint) {
      delta.unchanged.push(reference);
    }
  }
  return {
    ...delta,
    ...(activeSnapshotId ? { snapshotId: activeSnapshotId } : {})
  };
}

function sameAnnouncementSourceDefinition(
  current: AnnouncementSourceRecord,
  expected: AnnouncementSourceRecord
): boolean {
  return current.sourceUrl === expected.sourceUrl
    && current.parser === expected.parser
    && sameAnnouncementSourceParserConfig(current.parserConfig, expected.parserConfig)
    && (current.contentType ?? "announcement") === (expected.contentType ?? "announcement")
    && current.sourceDefinitionVersion === expected.sourceDefinitionVersion
    && current.notificationProducerVersion === expected.notificationProducerVersion
    && (current.approvalPending === true) === (expected.approvalPending === true)
    && (current.reviewedAt?.getTime() ?? null) === (expected.reviewedAt?.getTime() ?? null);
}

function sourceReviewFenceFromRequest(input: AnnouncementSourceReviewRequest): AnnouncementSourceReviewFence {
  const expectedCanonicalUrl = canonicalizeContentUrl(input.expectedCanonicalUrl);
  if (!expectedCanonicalUrl) throw new BadRequestException("Announcement source review fence is invalid.");
  const expectedSourceDefinitionVersion = input.expectedSourceDefinitionVersion.trim() || undefined;
  return {
    expectedCanonicalUrl,
    ...(expectedSourceDefinitionVersion ? { expectedSourceDefinitionVersion } : {}),
    expectedTrustStatus: input.expectedTrustStatus,
    expectedSourceStatus: input.expectedSourceStatus,
    expectedApprovalPending: input.expectedApprovalPending
  };
}

function sourceReviewFenceFromRecord(source: AnnouncementSourceRecord): AnnouncementSourceReviewFence {
  const expectedCanonicalUrl = canonicalizeContentUrl(source.canonicalUrl ?? source.sourceUrl);
  if (!expectedCanonicalUrl) throw new BadRequestException("Announcement source review fence is invalid.");
  return {
    expectedCanonicalUrl,
    expectedSourceUrl: source.sourceUrl,
    ...(source.sourceDefinitionVersion ? { expectedSourceDefinitionVersion: source.sourceDefinitionVersion } : {}),
    expectedTrustStatus: source.trustStatus ?? "quarantined",
    expectedSourceStatus: source.status,
    expectedApprovalPending: source.approvalPending === true,
    expectedReviewedAt: source.reviewedAt ?? null
  };
}

function sourceEditFenceFromRequest(input: ManualAnnouncementSourceUpdateInput): AnnouncementSourceEditFence {
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) {
    throw new BadRequestException("Announcement source edit fence is invalid.");
  }
  return {
    ...sourceReviewFenceFromRequest(input),
    expectedUpdatedAt
  };
}

function assertSourceMatchesReviewFence(
  source: AnnouncementSourceRecord,
  fence: AnnouncementSourceReviewFence
): void {
  const canonicalUrl = canonicalizeContentUrl(source.canonicalUrl ?? source.sourceUrl);
  const expectedVersion = fence.expectedSourceDefinitionVersion?.trim() || undefined;
  if (
    canonicalUrl !== fence.expectedCanonicalUrl
    || (fence.expectedSourceUrl !== undefined && source.sourceUrl !== fence.expectedSourceUrl)
    || source.sourceDefinitionVersion !== expectedVersion
    || (source.trustStatus ?? "quarantined") !== fence.expectedTrustStatus
    || source.status !== fence.expectedSourceStatus
    || (source.approvalPending === true) !== fence.expectedApprovalPending
  ) throw sourceReviewConflict();
}

function assertSourceMatchesEditFence(
  source: AnnouncementSourceRecord,
  fence: AnnouncementSourceEditFence
): void {
  assertSourceMatchesReviewFence(source, fence);
  if (source.updatedAt.getTime() !== fence.expectedUpdatedAt.getTime()) throw sourceReviewConflict();
}

function sourceReviewConflict(): ConflictException {
  return new ConflictException("Announcement source changed after it was loaded. Refresh the source and retry.");
}

const SOURCE_APPROVAL_LEASE_MS = 15 * 60_000;

function hasActiveSourceApprovalLease(source: AnnouncementSourceRecord): boolean {
  return source.approvalPending === true
    && source.reviewedAt instanceof Date
    && Number.isFinite(source.reviewedAt.getTime())
    && Date.now() - source.reviewedAt.getTime() < SOURCE_APPROVAL_LEASE_MS;
}

function sourceAuthorityResource(contentType?: AnnouncementContentType): SourceAuthorityResource {
  return contentType ?? "announcement";
}

function resolveAuthorityForUniversityRecord(
  university: UniversityRecord,
  scopeType: "university" | "faculty" | "department",
  scopeId: string
): Promise<ResolvedSourceAuthorityContext> {
  return resolveSourceAuthorityContext({
    universityId: university.id,
    ownerAcademicEntityId: scopeId,
    scopeType,
    scopeId
  });
}

function missingSourceOwnerDecision(
  source: Pick<AnnouncementSourceRecord, "scopeType" | "scopeId" | "contentType">,
  url: string,
  boundary: "registration" | "publication"
): SourceAuthorityDecision {
  return evaluateSourceAuthority({
    ownerAcademicEntityId: source.scopeId,
    ownerUniversityId: null,
    resolvedOwnerAcademicEntityId: source.scopeId,
    resolvedOwnerUniversityId: null,
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    authorityDomains: null
  }, {
    boundary,
    resource: sourceAuthorityResource(source.contentType),
    url
  });
}

export async function discoverAnnouncementSourceForUniversity(university: UniversityRecord, input: { timeoutMs?: number } = {}): Promise<AnnouncementDiscoveryResult> {
  const timeoutMs = input.timeoutMs ?? 7000;
  const authority = await resolveAuthorityForUniversityRecord(university, "university", university.id);
  const verifiedSource = await discoverVerifiedAnnouncementSource(university, timeoutMs, authority.context);
  if (verifiedSource) return verifiedSource;
  const homepageCandidates = buildHomepageCandidates(university).slice(0, 16);
  return discoverAnnouncementSourceFromHomepages(university, homepageCandidates, timeoutMs, authority.context, (homepage) => isLikelyUniversityHomepage(homepage.text, homepage.finalUrl, university));
}

export async function discoverAnnouncementSourceForAcademicScope(
  university: UniversityRecord,
  scope: { faculty?: FacultyRecord; department?: DepartmentRecord },
  input: { timeoutMs?: number } = {}
): Promise<AnnouncementDiscoveryResult> {
  const timeoutMs = input.timeoutMs ?? 7000;
  const scopeType = scope.department ? "department" : scope.faculty ? "faculty" : "university";
  const scopeId = scope.department?.id ?? scope.faculty?.id ?? university.id;
  const authority = await resolveAuthorityForUniversityRecord(university, scopeType, scopeId);
  const homepageCandidates = await buildAcademicScopeHomepageCandidates(university, scope, timeoutMs, authority.context);
  return discoverAnnouncementSourceFromHomepages(university, homepageCandidates, timeoutMs, authority.context, (homepage) => isLikelyAcademicScopePage(homepage.text, homepage.finalUrl, university, scope));
}

async function discoverAnnouncementSourceFromHomepages(
  university: UniversityRecord,
  homepageCandidates: string[],
  timeoutMs: number,
  authority: SourceAuthorityContext,
  isLikelyHomepage: (homepage: { text: string; finalUrl: string }) => boolean
): Promise<AnnouncementDiscoveryResult> {
  let checkedHomepageCandidates = 0;
  let lastError = "";
  let bestEmptyHomepage: AnnouncementDiscoveryResult | null = null;

  for (const homepageUrl of homepageCandidates) {
    checkedHomepageCandidates += 1;
    try {
      const homepage = await fetchText(homepageUrl, timeoutMs, { authority, resource: "announcement" });
      if (!isLikelyHomepage(homepage)) continue;

      const homepageItems = parseHtmlAnchors(homepage.text, homepage.finalUrl);
      const sourceCandidates = buildAnnouncementSourceCandidates(homepage.finalUrl, homepage.text).slice(0, 16);
      let checkedSourceCandidates = 0;
      const homepageFallback: { url: string; itemCount: number; sampleTitles: string[] } | null = homepageItems.length > 0
        ? { url: homepage.finalUrl, itemCount: homepageItems.length, sampleTitles: homepageItems.slice(0, 3).map((item) => item.title) }
        : null;
      let best: { url: string; itemCount: number; sampleTitles: string[] } | null = null;

      for (const candidate of sourceCandidates) {
        checkedSourceCandidates += 1;
        try {
          const items = await fetchSourceItems(candidate.url, "auto", timeoutMs, { authority, resource: "announcement" });
          if (items.length > (best?.itemCount ?? 0)) best = { url: candidate.url, itemCount: items.length, sampleTitles: items.slice(0, 3).map((item) => item.title) };
          if (best && best.itemCount >= 5) break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      best ??= homepageFallback;
      if (best && best.itemCount > 0) {
        return {
          universityId: university.id,
          universityName: university.name,
          status: "source_found",
          homepageUrl: homepage.finalUrl,
          sourceUrl: best.url,
          parser: "auto",
          itemCount: best.itemCount,
          checkedHomepageCandidates,
          checkedSourceCandidates,
          sampleTitles: best.sampleTitles
        };
      }

      const emptyResult: AnnouncementDiscoveryResult = {
        universityId: university.id,
        universityName: university.name,
        status: "homepage_found_no_items",
        homepageUrl: homepage.finalUrl,
        itemCount: 0,
        checkedHomepageCandidates,
        checkedSourceCandidates,
        sampleTitles: [],
        ...(lastError ? { error: lastError } : {})
      };
      bestEmptyHomepage ??= emptyResult;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (bestEmptyHomepage) return bestEmptyHomepage;
  return {
    universityId: university.id,
    universityName: university.name,
    status: "homepage_not_found",
    itemCount: 0,
    checkedHomepageCandidates,
    checkedSourceCandidates: 0,
    sampleTitles: [],
    ...(lastError ? { error: lastError } : {})
  };
}

export function buildHomepageCandidates(university: UniversityRecord): string[] {
  const candidates = new Set<string>();
  if (university.websiteUrl) candidates.add(university.websiteUrl);

  for (const domain of knownUniversityDomains[university.slug] ?? []) addDomainCandidates(candidates, domain);

  const tokens = significantNameTokens(university.name);
  const acronym = tokens.map((token) => token[0]).join("");
  const joined = tokens.join("");
  const first = tokens[0];
  const firstTwo = tokens.slice(0, 2).join("");
  const slugWithoutCity = university.slug.replace(/-[a-z]+$/u, "");
  const slugToken = slugWithoutCity.replace(/-universitesi$/u, "").replace(/-/g, "");
  const generatedDomainTokens = [
    first,
    tokens.length >= 2 ? firstTwo : undefined,
    tokens.length >= 2 ? acronym : undefined,
    tokens.length >= 2 ? `${acronym}u` : undefined,
    tokens.length >= 2 ? joined : undefined,
    slugToken
  ];

  for (const domainToken of generatedDomainTokens.filter(Boolean)) {
    addDomainCandidates(candidates, `${domainToken}.edu.tr`);
  }

  return [...candidates];
}

export async function buildAcademicScopeHomepageCandidates(
  university: UniversityRecord,
  scope: { faculty?: FacultyRecord; department?: DepartmentRecord },
  timeoutMs = 7000,
  authorityContext?: SourceAuthorityContext
): Promise<string[]> {
  const scopeType = scope.department ? "department" : scope.faculty ? "faculty" : "university";
  const scopeId = scope.department?.id ?? scope.faculty?.id ?? university.id;
  const authority = authorityContext ?? (await resolveAuthorityForUniversityRecord(university, scopeType, scopeId)).context;
  const candidates = new Set<string>();
  const verifiedScope = await findVerifiedAcademicUnitSource({
    ...(scope.faculty?.id ? { facultyId: scope.faculty.id } : {}),
    ...(scope.department?.id ? { departmentId: scope.department.id } : {})
  });
  addAcademicScopeExplicitUrls(candidates, scope, verifiedScope ?? undefined);
  const scopeTokens = academicScopeTokens(scope);
  if (scopeTokens.length === 0) return buildHomepageCandidates(university).slice(0, 16);

  for (const homepageUrl of buildHomepageCandidates(university).slice(0, 8)) {
    try {
      const homepage = await fetchText(homepageUrl, timeoutMs, { authority, resource: "announcement" });
      if (!isLikelyUniversityHomepage(homepage.text, homepage.finalUrl, university)) continue;
      addScopedPathCandidates(candidates, homepage.finalUrl, scope);
      addScopedSubdomainCandidates(candidates, homepage.finalUrl, scope);

      for (const link of extractAcademicScopeLinks(homepage.text, homepage.finalUrl, scopeTokens)) {
        candidates.add(link);
      }
    } catch {
      continue;
    }
  }

  return [...candidates].slice(0, 28);
}

function addAcademicScopeExplicitUrls(candidates: Set<string>, scope: { faculty?: FacultyRecord; department?: DepartmentRecord }, verifiedScope?: VerifiedAcademicUnitSource): void {
  for (const url of [verifiedScope?.announcementUrl, verifiedScope?.websiteUrl]) {
    if (url) candidates.add(url);
  }
  for (const unit of [scope.department, scope.faculty]) {
    if (!unit) continue;
    for (const url of [unit.announcementUrl, unit.websiteUrl]) {
      if (url) candidates.add(url);
    }
  }
}

async function discoverVerifiedAnnouncementSource(
  university: UniversityRecord,
  timeoutMs: number,
  authority: SourceAuthorityContext
): Promise<AnnouncementDiscoveryResult | null> {
  const verified = await findVerifiedUniversitySource(university.id);
  if (!verified?.announcementUrl) return null;

  try {
    const profile = verified.parserProfiles?.announcement;
    const parser = profile?.parser ?? "auto";
    const items = await fetchSourceItems(
      verified.announcementUrl,
      parser,
      timeoutMs,
      { authority, resource: "announcement" },
      "announcement",
      profile?.parserConfig
    );
    if (items.length === 0) return null;
    const homepageUrl = homepageFromUrl(verified.announcementUrl);
    return {
      universityId: university.id,
      universityName: university.name,
      status: "source_found",
      ...(homepageUrl ? { homepageUrl } : {}),
      sourceUrl: verified.announcementUrl,
      parser,
      ...(profile?.parserConfig ? { parserConfig: profile.parserConfig } : {}),
      itemCount: items.length,
      checkedHomepageCandidates: 0,
      checkedSourceCandidates: 1,
      sampleTitles: items.slice(0, 3).map((item) => item.title)
    };
  } catch {
    return null;
  }
}

function homepageFromUrl(input: string): string | undefined {
  try {
    return new URL("/", input).toString();
  } catch {
    return undefined;
  }
}

function verifiedContentSourceDefinitions(source: {
  announcementUrl?: string;
  newsUrl?: string;
  eventUrl?: string;
  parserProfiles?: VerifiedContentSourceParserProfiles;
  verificationByField?: Partial<Record<"announcementUrl" | "newsUrl" | "eventUrl", VerifiedRegistrySourceEvidence>>;
}): Array<{
  contentType: AnnouncementContentType;
  label: string;
  url: string;
  priority: number;
  parser: AnnouncementSourceParser;
  parserConfig?: AnnouncementSourceParserConfig;
  verificationEvidence?: AnnouncementSourceVerificationEvidence;
}> {
  return [
    source.announcementUrl ? {
      contentType: "announcement" as const,
      label: "Duyurular",
      url: source.announcementUrl,
      priority: 30,
      parser: source.parserProfiles?.announcement?.parser ?? "auto",
      ...(source.parserProfiles?.announcement?.parserConfig
        ? { parserConfig: source.parserProfiles.announcement.parserConfig }
        : {}),
      ...(source.verificationByField?.announcementUrl
        ? { verificationEvidence: toAnnouncementSourceVerificationEvidence(source.verificationByField.announcementUrl) }
        : {})
    } : null,
    source.newsUrl ? {
      contentType: "news" as const,
      label: "Haberler",
      url: source.newsUrl,
      priority: 25,
      parser: source.parserProfiles?.news?.parser ?? "auto",
      ...(source.parserProfiles?.news?.parserConfig
        ? { parserConfig: source.parserProfiles.news.parserConfig }
        : {}),
      ...(source.verificationByField?.newsUrl
        ? { verificationEvidence: toAnnouncementSourceVerificationEvidence(source.verificationByField.newsUrl) }
        : {})
    } : null,
    source.eventUrl ? {
      contentType: "event" as const,
      label: "Etkinlikler",
      url: source.eventUrl,
      priority: 24,
      parser: source.parserProfiles?.event?.parser ?? "auto",
      ...(source.parserProfiles?.event?.parserConfig
        ? { parserConfig: source.parserProfiles.event.parserConfig }
        : {}),
      ...(source.verificationByField?.eventUrl
        ? { verificationEvidence: toAnnouncementSourceVerificationEvidence(source.verificationByField.eventUrl) }
        : {})
    } : null
  ].filter((definition): definition is NonNullable<typeof definition> => Boolean(definition));
}

function toAnnouncementSourceVerificationEvidence(input: VerifiedRegistrySourceEvidence): AnnouncementSourceVerificationEvidence {
  if (input.sourceType !== "announcement" && input.sourceType !== "news" && input.sourceType !== "event") {
    throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_TYPE_INVALID");
  }
  return {
    status: "verified",
    schemaVersion: input.schemaVersion,
    verifierVersion: input.verifierVersion,
    runId: input.runId,
    manifestHash: input.manifestHash,
    universityId: input.universityId,
    unitType: input.unitType,
    scopeId: input.scopeId,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    finalUrl: input.finalUrl,
    browserFinalUrl: input.browserFinalUrl,
    rawFinalUrl: input.rawFinalUrl,
    discoveryMethod: input.discoveryMethod,
    ...(input.selector ? { selector: input.selector } : {}),
    publicationScope: input.publicationScope,
    httpStatus: input.httpStatus,
    contentType: input.contentType,
    officialDomain: true,
    semanticMatch: true,
    semanticReasons: input.semanticReasons,
    parserProfile: "auto",
    parserCompatible: input.parserCompatible,
    parserItemCount: input.parserItemCount,
    ...(input.listingItemCount !== undefined ? { listingItemCount: input.listingItemCount } : {}),
    sampleItemUrls: input.sampleItemUrls,
    sampleDetails: input.sampleDetails.map((detail) => ({
      url: detail.url,
      ...(detail.finalUrl ? { finalUrl: detail.finalUrl } : {}),
      ...(detail.title ? { title: detail.title } : {}),
      status: detail.status,
      ...(detail.httpStatus !== undefined ? { httpStatus: detail.httpStatus } : {}),
      reasonCodes: detail.reasonCodes
    })),
    browserNetworkProofs: input.browserNetworkProofs.map((proof) => ({
      hostname: proof.hostname,
      addresses: [...proof.addresses]
    })),
    verifiedAt: input.verifiedAt,
    finalRevalidatedAt: input.finalRevalidatedAt,
    sha256: input.sha256,
    evidencePath: input.evidencePath,
    ...(input.parserInputSha256 ? { parserInputSha256: input.parserInputSha256 } : {}),
    ...(input.parserEvidencePath ? { parserEvidencePath: input.parserEvidencePath } : {})
  };
}

function assertVerificationEvidenceMatchesCandidate(
  evidence: AnnouncementSourceVerificationEvidence,
  source: Pick<AnnouncementSourceRecord, "sourceUrl" | "canonicalUrl" | "contentType" | "scopeType" | "scopeId" | "ownerUniversityId">,
  authority: SourceAuthorityContext
): void {
  assertAnnouncementSourceVerificationEvidenceMatchesDefinition(source, evidence);
  for (const url of [
    evidence.sourceUrl,
    evidence.finalUrl,
    evidence.browserFinalUrl,
    evidence.rawFinalUrl,
    ...evidence.sampleItemUrls
  ]) {
    const decision = evaluateSourceAuthority(authority, {
      boundary: "registration",
      resource: sourceAuthorityResource(source.contentType),
      url
    });
    if (!decision.allowed || !decision.canonicalUrl) {
      throw new Error(`ANNOUNCEMENT_SOURCE_VERIFICATION_AUTHORITY_MISMATCH:${decision.reasonCode}`);
    }
  }
  for (const detail of evidence.sampleDetails ?? []) {
    for (const url of [detail.url, detail.finalUrl].filter((value): value is string => Boolean(value))) {
      const decision = evaluateSourceAuthority(authority, {
        boundary: "registration",
        resource: sourceAuthorityResource(source.contentType),
        url
      });
      if (!decision.allowed || !decision.canonicalUrl) {
        throw new Error(`ANNOUNCEMENT_SOURCE_VERIFICATION_SAMPLE_AUTHORITY_MISMATCH:${decision.reasonCode}`);
      }
    }
  }
}

export function isLikelyAcademicScopePage(html: string, finalUrl: string, university: UniversityRecord, scope: { faculty?: FacultyRecord; department?: DepartmentRecord }): boolean {
  const text = foldText(`${finalUrl} ${html.slice(0, 80000)}`);
  const tokens = academicScopeTokens(scope);
  if (tokens.length === 0) return isLikelyUniversityHomepage(html, finalUrl, university);
  const scopeMatches = tokens.some((token) => text.includes(token));
  return scopeMatches || (isLikelyUniversityHomepage(html, finalUrl, university) && tokens.some((token) => foldText(finalUrl).includes(token)));
}

function addScopedPathCandidates(candidates: Set<string>, baseUrl: string, scope: { faculty?: FacultyRecord; department?: DepartmentRecord }): void {
  const slugs = [scope.faculty?.slug, scope.department?.slug].filter((slug): slug is string => Boolean(slug));
  const prefixes = ["", "tr", "birim", "akademik-birimler", "fakulteler", "fakulte", "bolumler", "bolum", "ogrenci"];
  for (const slug of slugs) {
    for (const prefix of prefixes) {
      const path = prefix ? `/${prefix}/${slug}` : `/${slug}`;
      try {
        candidates.add(new URL(path, baseUrl).toString());
      } catch {
        continue;
      }
    }
  }

  if (scope.faculty?.slug && scope.department?.slug) {
    for (const path of [`/${scope.faculty.slug}/${scope.department.slug}`, `/tr/${scope.faculty.slug}/${scope.department.slug}`]) {
      try {
        candidates.add(new URL(path, baseUrl).toString());
      } catch {
        continue;
      }
    }
  }
}

function addScopedSubdomainCandidates(candidates: Set<string>, baseUrl: string, scope: { faculty?: FacultyRecord; department?: DepartmentRecord }): void {
  let domain = "";
  try {
    domain = new URL(baseUrl).hostname.replace(/^www\./u, "");
  } catch {
    return;
  }
  const tokens = [scope.department?.slug, scope.faculty?.slug]
    .flatMap((slug) => slug ? slug.split("-") : [])
    .filter((token) => token.length >= 3 && !unitSlugStopWords.has(token))
    .slice(0, 4);
  for (const token of tokens) {
    candidates.add(`https://${token}.${domain}`);
    candidates.add(`https://www.${token}.${domain}`);
  }

  for (const token of academicUnitSubdomainTokens(scope)) {
    candidates.add(`https://${token}.${domain}`);
    candidates.add(`https://www.${token}.${domain}`);
  }
}

function extractAcademicScopeLinks(html: string, baseUrl: string, scopeTokens: string[]): string[] {
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const links = new Set<string>();
  for (const anchor of anchors) {
    const href = cleanText(anchor[1]);
    const title = cleanText((anchor[2] ?? "").replace(/<[^>]+>/g, " "));
    const text = foldText(`${title} ${href}`);
    if (!href || !scopeTokens.some((token) => text.includes(token))) continue;
    try {
      links.add(new URL(href, baseUrl).toString());
    } catch {
      continue;
    }
  }
  return [...links].slice(0, 16);
}

function academicScopeTokens(scope: { faculty?: FacultyRecord; department?: DepartmentRecord }): string[] {
  const rawValues = [
    scope.department?.slug?.replace(/-/gu, " "),
    scope.department?.name,
    scope.faculty?.slug?.replace(/-/gu, " "),
    scope.faculty?.name
  ].filter((value): value is string => Boolean(value));
  const tokens = new Set<string>();
  for (const value of rawValues) {
    const folded = foldText(value).replace(/[^\p{L}\d]+/gu, " ").replace(/\s+/gu, " ").trim();
    if (folded.length >= 4) tokens.add(folded);
    for (const token of folded.split(" ")) {
      if (token.length >= 4 && !unitSlugStopWords.has(token)) tokens.add(token);
    }
  }
  return [...tokens];
}

function academicUnitSubdomainTokens(scope: { faculty?: FacultyRecord; department?: DepartmentRecord }): string[] {
  const values = [scope.department?.slug, scope.faculty?.slug, scope.department?.name, scope.faculty?.name].filter((value): value is string => Boolean(value));
  const tokens = new Set<string>();
  for (const value of values) {
    const folded = foldText(value).replace(/[^\p{L}\d]+/gu, " ").replace(/\s+/gu, " ").trim();
    const parts = folded.split(" ").filter((part) => part.length >= 2 && !unitSlugStopWords.has(part));
    const first = parts[0];
    if (first && first.length >= 3) {
      if (folded.includes("meslek yuksekokulu")) tokens.add(`${first}myo`);
      if (folded.includes("yuksekokulu")) tokens.add(`${first}yo`);
      if (folded.includes("fakulte")) tokens.add(`${first}f`);
      if (folded.includes("enstitu")) tokens.add(`${first}ens`);
    }
    const acronym = parts.map((part) => part[0]).join("");
    if (acronym.length >= 3) tokens.add(acronym);
  }
  addKnownAcademicUnitAliases(tokens, values.join(" "));
  return [...tokens].slice(0, 10);
}

function addKnownAcademicUnitAliases(tokens: Set<string>, value: string): void {
  const text = foldText(value);
  if (text.includes("iktisadi") && text.includes("idari")) tokens.add("iibf");
  if (text.includes("siyasal")) tokens.add("sbf");
  if (text.includes("tip")) tokens.add("tip");
  if (text.includes("dis hekimligi")) tokens.add("dis");
  if (text.includes("eczacilik")) tokens.add("eczacilik");
  if (text.includes("veteriner")) tokens.add("veteriner");
  if (text.includes("muhendislik")) tokens.add("muhendislik");
  if (text.includes("egitim")) tokens.add("egitim");
  if (text.includes("hukuk")) tokens.add("hukuk");
  if (text.includes("iletisim")) tokens.add("iletisim");
  if (text.includes("ilahiyat")) tokens.add("ilahiyat");
  if (text.includes("guzel sanat")) tokens.add("gsf");
  if (text.includes("saglik bilim")) tokens.add("sbf");
  if (text.includes("fen edebiyat")) tokens.add("fef");
}

function buildAnnouncementSourceCandidates(homepageUrl: string, homepageHtml: string): Array<{ url: string; score: number }> {
  const candidates = new Map<string, number>();
  for (const path of [
    "/duyurular",
    "/duyurular/",
    "/duyuru",
    "/duyuru/",
    "/tr/duyurular",
    "/tr/duyurular/",
    "/tr/duyuru",
    "/icerik/duyurular",
    "/icerik/duyuru",
    "/tr/icerik/duyurular",
    "/web/duyurular",
    "/web/haberler",
    "/announcements",
    "/announcements/",
    "/announcement",
    "/tr/announcements",
    "/category/duyurular/",
    "/category/announcements/",
    "/haberler",
    "/haberler/",
    "/tr/haberler",
    "/news",
    "/news/",
    "/tr/news",
    "/etkinlikler",
    "/etkinlikler/",
    "/tr/etkinlikler",
    "/events",
    "/events/",
    "/tr/events",
    "/notices",
    "/tr-tr/duyurular/Pages/default.aspx"
  ]) {
    addSourceCandidate(candidates, new URL(path, homepageUrl).toString(), 50);
  }

  const anchors = [...homepageHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const anchor of anchors) {
    const href = cleanText(anchor[1]);
    const title = cleanText(anchor[2]?.replace(/<[^>]+>/g, " "));
    if (!href || !containsAnnouncementHint(title, href)) continue;
    try {
      const url = new URL(href, homepageUrl).toString();
      if (looksLikeAnnouncementDetailUrl(url)) continue;
      addSourceCandidate(candidates, url, scoreAnnouncementCandidate(title, url));
    } catch {
      continue;
    }
  }
  addEmbeddedLinkSourceCandidates(candidates, homepageUrl, homepageHtml);

  return [...candidates.entries()].map(([url, score]) => ({ url, score })).sort((left, right) => right.score - left.score);
}

function addEmbeddedLinkSourceCandidates(candidates: Map<string, number>, homepageUrl: string, homepageHtml: string): void {
  const normalized = homepageHtml
    .replace(/\\&q;/g, "\"")
    .replace(/&q;/g, "\"")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/");

  for (const match of normalized.matchAll(/"(?:announcementsLink|newsLink|eventsLink|eventLink|link|href|url)"\s*:\s*"([^"]+)"/gi)) {
    const href = cleanText(match[1]);
    if (!href || !containsAnnouncementHint("", href)) continue;
    try {
      const url = new URL(href, homepageUrl).toString();
      if (looksLikeAnnouncementDetailUrl(url)) continue;
      addSourceCandidate(candidates, url, href.includes("duyuru") || href.includes("announcement") ? 90 : href.includes("etkinlik") || href.includes("event") ? 55 : 40);
    } catch {
      continue;
    }
  }

  for (const match of normalized.matchAll(/(?:href|src)=["']([^"']*(?:duyuru|announcement|haber|news|etkinlik|event)[^"']*)["']/gi)) {
    const href = cleanText(match[1]);
    if (!href) continue;
    try {
      const url = new URL(href, homepageUrl).toString();
      if (looksLikeAnnouncementDetailUrl(url)) continue;
      addSourceCandidate(candidates, url, href.includes(".js") ? 25 : 70);
    } catch {
      continue;
    }
  }
}

function looksLikeAnnouncementDetailUrl(input: string): boolean {
  const url = new URL(input);
  const path = url.pathname.toLocaleLowerCase("tr-TR");
  const segments = path.split("/").filter(Boolean);
  if (url.searchParams.has("announcementId") || url.searchParams.has("announcementdetail")) return true;
  if (/(duyurudetay|duyuru-detay|announcement-detail|haber-detay|news-detail|etkinlik-detay|event-detail)/u.test(path)) return true;
  if (segments.some((segment, index) => ["duyuru", "haber", "etkinlik", "announcement", "news", "event"].includes(segment) && Boolean(segments[index + 1]) && (/^\d{3,}$/u.test(segments[index + 1] ?? "") || Boolean(segments[index + 2])))) return true;
  return segments.some((segment, index) => ["duyuru", "duyurular", "announcement", "announcements", "haber", "haberler", "news", "etkinlik", "etkinlikler", "event", "events"].includes(segment) && (segments[index + 1]?.length ?? 0) > 10);
}

function addSourceCandidate(candidates: Map<string, number>, url: string, score: number): void {
  const normalized = url.replace(/#.*$/u, "");
  candidates.set(normalized, Math.max(candidates.get(normalized) ?? 0, score));
}

function scoreAnnouncementCandidate(title: string, url: string): number {
  const text = `${title} ${url}`.toLocaleLowerCase("tr-TR");
  let score = 20;
  if (text.includes("duyuru")) score += 70;
  if (text.includes("announcement")) score += 60;
  if (text.includes("ilan")) score += 30;
  if (text.includes("haber")) score += 15;
  if (text.includes("news")) score += 15;
  if (text.includes("etkinlik") || text.includes("event")) score += 20;
  if (text.includes("ogrenci") || text.includes("öğrenci")) score += 10;
  return score;
}

export function isLikelyUniversityHomepage(html: string, finalUrl: string, university: UniversityRecord): boolean {
  const foldedHtml = foldText(html.slice(0, 20000));
  const foldedUrl = foldText(finalUrl);
  const tokens = significantNameTokens(university.name).filter((token) => token.length >= 3);
  const matchedTokens = tokens.filter((token) => foldedHtml.includes(token) || foldedUrl.includes(token));
  if (tokens.length <= 1) return matchedTokens.length > 0;
  return matchedTokens.some((token) => token !== tokens[0]);
}

function addDomainCandidates(candidates: Set<string>, domain: string): void {
  const normalized = domain.replace(/^https?:\/\//u, "").replace(/^www\./u, "").replace(/\/.*$/u, "");
  candidates.add(`https://${normalized}`);
  candidates.add(`https://www.${normalized}`);
  candidates.add(`http://${normalized}`);
  candidates.add(`http://www.${normalized}`);
}

function significantNameTokens(name: string): string[] {
  return foldText(name)
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z0-9]+/u)
    .filter((token) => token && !nameStopWords.has(token));
}

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .toLocaleLowerCase("en-US");
}

function summarizeDiscovery(results: AnnouncementDiscoveryResult[]) {
  return {
    checkedUniversities: results.length,
    sourceFound: results.filter((result) => result.status === "source_found").length,
    homepageFoundNoItems: results.filter((result) => result.status === "homepage_found_no_items").length,
    homepageNotFound: results.filter((result) => result.status === "homepage_not_found").length,
    totalParsedItems: results.reduce((total, result) => total + result.itemCount, 0)
  };
}

function summarizeIngestion(results: AnnouncementIngestionResult[]) {
  const classificationCounts = results.reduce<StudentRelevanceAuditCounts>((counts, result) => {
    if (!result.classificationAudit) return counts;
    counts.total += result.classificationAudit.counts.total;
    counts.relevant += result.classificationAudit.counts.relevant;
    counts.not_relevant += result.classificationAudit.counts.not_relevant;
    counts.uncertain += result.classificationAudit.counts.uncertain;
    return counts;
  }, { total: 0, relevant: 0, not_relevant: 0, uncertain: 0 });
  return {
    checkedSources: results.length,
    healthy: results.filter((result) => result.status === "healthy").length,
    degraded: results.filter((result) => result.status === "degraded").length,
    failed: results.filter((result) => result.status === "failed").length,
    totalParsedItems: results.reduce((total, result) => total + result.itemCount, 0),
    classificationAudit: {
      mode: "shadow" as const,
      classificationVersion: STUDENT_RELEVANCE_CLASSIFICATION_VERSION,
      counts: classificationCounts
    }
  };
}

async function runWithConcurrency<TInput, TOutput>(items: TInput[], concurrency: number, worker: (item: TInput) => Promise<TOutput>): Promise<TOutput[]> {
  const results: TOutput[] = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item);
    }
  }));
  return results;
}

export async function runAnnouncementSourcesWithConcurrency<TOutput>(
  sources: readonly AnnouncementSourceRecord[],
  concurrency: number,
  worker: (source: AnnouncementSourceRecord) => Promise<TOutput>
): Promise<TOutput[]> {
  const sourcesByHost = new Map<string, Array<{ index: number; source: AnnouncementSourceRecord }>>();
  sources.forEach((source, index) => {
    let host: string;
    try {
      host = new URL(source.canonicalUrl ?? source.sourceUrl).hostname.toLocaleLowerCase("en-US");
    } catch {
      host = `invalid-source-${source.id}`;
    }
    const bucket = sourcesByHost.get(host) ?? [];
    bucket.push({ index, source });
    sourcesByHost.set(host, bucket);
  });

  const groupedResults = await runWithConcurrency(
    [...sourcesByHost.values()],
    concurrency,
    async (bucket) => {
      const results: Array<{ index: number; value: TOutput }> = [];
      for (const entry of bucket) {
        results.push({ index: entry.index, value: await worker(entry.source) });
      }
      return results;
    }
  );

  return groupedResults
    .flat()
    .sort((left, right) => left.index - right.index)
    .map((result) => result.value);
}

export function healthProbeContentHash(items: readonly {
  title: string;
  link: string;
  publishedAt?: Date;
  publishedDate?: string;
  sourceUpdatedAt?: Date;
  summary?: string;
  body?: readonly { type: string; text: string }[];
  keyDates?: readonly { label: string; startDate: string; endDate?: string }[];
}[]): string {
  const hash = createHash("sha256").update(`academic-mobile:source-health-probe:${DEVICE_SOURCE_RUNTIME_VERSION}\0`);
  for (const item of items) {
    hash.update(JSON.stringify({
      title: item.title,
      link: item.link,
      publishedAt: item.publishedAt?.toISOString(),
      publishedDate: item.publishedDate,
      sourceUpdatedAt: item.sourceUpdatedAt?.toISOString(),
      summary: item.summary,
      body: item.body,
      keyDates: item.keyDates
    })).update("\0");
  }
  return hash.digest("hex");
}

function failedHealthProbe(
  previous: AnnouncementSourceHealthProbe | undefined,
  checkedAt: Date,
  error: string,
  consecutiveFailures: number
): AnnouncementSourceHealthProbe {
  return {
    ...(previous?.engineVersion ? { engineVersion: previous.engineVersion } : {}),
    healthStatus: consecutiveFailures >= 3 ? "failed" : "degraded",
    lastCheckedAt: checkedAt,
    ...(previous?.lastFullCheckedAt ? { lastFullCheckedAt: previous.lastFullCheckedAt } : {}),
    ...(previous?.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
    lastError: healthProbeErrorCode(error),
    consecutiveFailures,
    ...(previous?.itemCount !== undefined ? { itemCount: previous.itemCount } : {}),
    ...(previous?.etag ? { etag: previous.etag } : {}),
    ...(previous?.lastModified ? { lastModified: previous.lastModified } : {}),
    ...(previous?.contentHash ? { contentHash: previous.contentHash } : {}),
    ...(previous?.lastContentChangedAt ? { lastContentChangedAt: previous.lastContentChangedAt } : {})
  };
}

function fullHealthCheckTimestamp(
  previous: AnnouncementSourceHealthProbe | undefined,
  mode: "daily" | "revision",
  checkedAt: Date
): Pick<AnnouncementSourceHealthProbe, "lastFullCheckedAt"> | Record<string, never> {
  if (mode === "daily") return { lastFullCheckedAt: checkedAt };
  return previous?.lastFullCheckedAt ? { lastFullCheckedAt: previous.lastFullCheckedAt } : {};
}

function sameIstanbulDate(left: Date | undefined, right: Date): boolean {
  if (!left) return false;
  const turkeyOffsetMs = 3 * 60 * 60 * 1_000;
  return new Date(left.getTime() + turkeyOffsetMs).toISOString().slice(0, 10)
    === new Date(right.getTime() + turkeyOffsetMs).toISOString().slice(0, 10);
}

function healthProbeErrorCode(error: string): string {
  return error.trim().match(/^([A-Z][A-Z0-9_]{2,79})(?::|$)/u)?.[1]
    ?? "SOURCE_HEALTH_PROBE_FAILED";
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isSourceDue(source: AnnouncementSourceRecord, now = new Date()): boolean {
  if (source.status !== "active") return false;
  if (!source.lastCheckedAt) return true;
  const intervalMinutes = Math.min(Math.max(source.fetchIntervalMinutes ?? 180, 5), 10_080);
  return now.getTime() - source.lastCheckedAt.getTime() >= intervalMinutes * 60_000;
}

export function compareScheduledSourceDueOrder(
  left: AnnouncementSourceRecord,
  right: AnnouncementSourceRecord
): number {
  const leftCheckedAt = validTimestamp(left.lastCheckedAt);
  const rightCheckedAt = validTimestamp(right.lastCheckedAt);
  if (leftCheckedAt === undefined && rightCheckedAt !== undefined) return -1;
  if (leftCheckedAt !== undefined && rightCheckedAt === undefined) return 1;
  if (leftCheckedAt !== rightCheckedAt) return (leftCheckedAt ?? 0) - (rightCheckedAt ?? 0);
  return left.id.localeCompare(right.id, "en-US");
}

function validTimestamp(value: Date | undefined): number | undefined {
  const timestamp = value?.getTime();
  return timestamp !== undefined && Number.isFinite(timestamp) ? timestamp : undefined;
}

function sourceInputFromRecord(source: AnnouncementSourceRecord) {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = source;
  void _id;
  void _createdAt;
  void _updatedAt;
  return input;
}

function presentSourceForAdmin(source: AnnouncementSourceRecord) {
  const verified = source.trustStatus === "trusted" && source.approvalPending !== true;
  let currentEvidence: AnnouncementSourceVerificationEvidence | undefined;
  if (source.verificationEvidence) {
    try {
      currentEvidence = normalizeAnnouncementSourceVerificationEvidence(source.verificationEvidence);
      if (currentEvidence) assertAnnouncementSourceVerificationEvidenceMatchesDefinition(source, currentEvidence);
    } catch {
      currentEvidence = undefined;
    }
  }
  const evidence = currentEvidence ?? (source.approvalPending === true
    ? {
        status: "blocked" as const,
        sourceType: source.contentType ?? "announcement",
        sourceUrl: source.sourceUrl,
        finalUrl: source.canonicalUrl ?? source.sourceUrl,
        discoveryMethod: source.discoveryMethod ?? "manual",
        semanticReasons: ["approval_health_check_incomplete"]
      }
    : undefined);
  const {
    verificationEvidence: _verificationEvidence,
    healthProbe: _healthProbe,
    ...presentedSource
  } = source;
  void _verificationEvidence;
  return {
    ...presentedSource,
    ...(source.healthProbe ? { healthProbe: presentHealthProbe(source.healthProbe) } : {}),
    reviewStatus: verified
      ? "trusted" as const
      : source.trustStatus === "rejected" ? "rejected" as const : "pending_review" as const,
    ...(evidence
      ? { evidence, verification: evidence }
      : {})
  };
}

function presentHealthProbe(probe: AnnouncementSourceHealthProbe) {
  return {
    ...(probe.engineVersion ? { engineVersion: probe.engineVersion } : {}),
    healthStatus: probe.healthStatus,
    lastCheckedAt: probe.lastCheckedAt,
    ...(probe.lastFullCheckedAt ? { lastFullCheckedAt: probe.lastFullCheckedAt } : {}),
    ...(probe.lastSuccessAt ? { lastSuccessAt: probe.lastSuccessAt } : {}),
    ...(probe.lastError ? { lastError: healthProbeErrorCode(probe.lastError) } : {}),
    consecutiveFailures: Math.max(0, Math.min(probe.consecutiveFailures, 10_000)),
    ...(probe.itemCount !== undefined ? { itemCount: Math.max(0, Math.min(probe.itemCount, 100_000)) } : {}),
    ...(probe.lastContentChangedAt ? { lastContentChangedAt: probe.lastContentChangedAt } : {})
  };
}

function normalizeAdminSourceListQuery(input: AnnouncementAdminSourceQueryInput): AnnouncementAdminSourceListQuery {
  const search = input.search?.trim().slice(0, 200);
  return {
    limit: boundedInteger(input.limit, 1_000, 1, 1_000),
    offset: boundedInteger(input.offset, 0, 0, 1_000_000),
    ...(input.status ? { status: input.status } : {}),
    ...(input.trustStatus ? { trustStatus: input.trustStatus } : {}),
    ...(input.contentType ? { contentType: input.contentType } : {}),
    ...(input.scopeType ? { scopeType: input.scopeType } : {}),
    ...(search ? { search } : {})
  };
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), minimum), maximum);
}

interface UniversityContentSourceInventorySlot {
  contentType: UniversityContentSourceType;
  sourceUrl?: string;
  candidateUrl?: string;
  status: string;
  resolution: string;
  sourceStatus: string;
  evidenceStatus: string;
  parser: AnnouncementSourceParser;
  parserConfig?: AnnouncementSourceParserConfig;
  siteStructure: Record<string, unknown>;
}

interface UniversityContentSourceInventory {
  schemaVersion: 1;
  generatedAt: string;
  summary: Record<string, unknown>;
  universities: Array<{
    universityId: string;
    universityName: string;
    city?: string;
    authority: Record<string, unknown>;
    slots: UniversityContentSourceInventorySlot[];
  }>;
}

let universityContentSourceInventoryPromise: Promise<UniversityContentSourceInventory> | null = null;

async function loadUniversityContentSourceInventory(): Promise<UniversityContentSourceInventory> {
  universityContentSourceInventoryPromise ??= readFile(
    new URL("../../bootstrap/university-content-source-inventory.json", import.meta.url),
    "utf8"
  ).then((text) => {
    const inventory = JSON.parse(text.replace(/^\uFEFF/u, "")) as UniversityContentSourceInventory;
    const slotCount = inventory.universities?.reduce((total, university) => total + (university.slots?.length ?? 0), 0);
    if (inventory.schemaVersion !== 1 || inventory.universities?.length !== 208 || slotCount !== 832) {
      throw new Error("UNIVERSITY_CONTENT_SOURCE_INVENTORY_INVALID");
    }
    for (const university of inventory.universities) {
      if (university.slots.length !== 4) throw new Error("UNIVERSITY_CONTENT_SOURCE_INVENTORY_SLOT_COUNT_INVALID");
      for (const slot of university.slots) assertUniversityContentSourceType(slot.contentType);
    }
    return inventory;
  });
  return universityContentSourceInventoryPromise;
}

function assertUniversityContentSourceType(value: string): asserts value is UniversityContentSourceType {
  if (!["announcement", "news", "event", "academic_calendar"].includes(value)) {
    throw new BadRequestException("Unsupported university content source type.");
  }
}

function presentProfileTest(source: Pick<
  AnnouncementSourceRecord,
  "healthStatus" | "lastCheckedAt" | "lastSuccessAt" | "lastError" | "itemCount"
> | UniversityCalendarSourceProfileRecord | undefined) {
  return {
    status: source?.healthStatus ?? "not_tested",
    ...(source?.lastCheckedAt ? { checkedAt: source.lastCheckedAt.toISOString() } : {}),
    ...(source?.lastSuccessAt ? { successAt: source.lastSuccessAt.toISOString() } : {}),
    ...(source?.itemCount !== undefined ? { itemCount: source.itemCount } : {}),
    ...(source?.lastError ? { error: source.lastError } : {})
  };
}

function calendarProfileInput(profile: UniversityCalendarSourceProfileRecord): UpsertUniversityCalendarSourceProfileInput {
  return {
    universityId: profile.universityId,
    sourceUrl: profile.sourceUrl,
    parser: profile.parser,
    ...(profile.parserConfig ? { parserConfig: profile.parserConfig } : {}),
    status: profile.status
  };
}

function contentTypeLabel(contentType: AnnouncementContentType): string {
  return contentType === "news" ? "Haberler" : contentType === "event" ? "Etkinlikler" : "Duyurular";
}

function staticSourceIdentityKey(
  scopeType: AnnouncementSourceScope["scopeType"],
  scopeId: string,
  contentType: AnnouncementContentType | undefined,
  sourceUrl: string
): string | null {
  const contentKey = canonicalAnnouncementSourceIdentityKey(sourceUrl);
  return contentKey ? `${scopeType}\u0000${scopeId}\u0000${contentType ?? "announcement"}\u0000${contentKey}` : null;
}

const nameStopWords = new Set([
  "universitesi",
  "universite",
  "university",
  "vakif",
  "devlet",
  "turkiye",
  "turk",
  "ve",
  "the"
]);

const unitSlugStopWords = new Set([
  "fakultesi",
  "fakulte",
  "bolumu",
  "bolum",
  "meslek",
  "yuksekokulu",
  "yuksek",
  "okulu",
  "enstitusu",
  "enstitu",
  "bilimleri",
  "bilimler",
  "programi",
  "program"
]);

export function knownOfficialUniversityUrls(universityIdOrSlug: string): string[] {
  return (knownUniversityDomains[universityIdOrSlug] ?? []).map((domain) => `https://${domain}`);
}

const knownUniversityDomains: Record<string, string[]> = {
  "abdullah-gul-universitesi-kayseri": ["agu.edu.tr", "w3.agu.edu.tr"],
  "akdeniz-universitesi-antalya": ["akdeniz.edu.tr"],
  "anadolu-universitesi-eskisehir": ["anadolu.edu.tr"],
  "ankara-universitesi-ankara": ["ankara.edu.tr"],
  "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi": ["atu.edu.tr"],
  "afyon-kocatepe-universitesi-afyonkarahisar": ["aku.edu.tr"],
  "afyonkarahisar-saglik-bilimleri-universitesi": ["afsu.edu.tr"],
  "ankara-haci-bayram-veli-universitesi": ["hacibayram.edu.tr", "hbv.edu.tr"],
  "ankara-muzik-ve-guzel-sanatlar-universitesi": ["mgu.edu.tr"],
  "ankara-sosyal-bilimler-universitesi": ["asbu.edu.tr"],
  "ankara-universitesi": ["ankara.edu.tr"],
  "ankara-yildirim-beyazit-universitesi": ["aybu.edu.tr"],
  "antalya-belek-universitesi": ["belek.edu.tr"],
  "ataturk-universitesi-erzurum": ["atauni.edu.tr"],
  "atasehir-adiguzel-meslek-yuksekokulu-istanbul": ["adiguzel.edu.tr"],
  "aydin-adnan-menderes-universitesi": ["adu.edu.tr"],
  "atilim-universitesi-ankara": ["atilim.edu.tr"],
  "baskent-universitesi-ankara": ["baskent.edu.tr"],
  "bezm-i-lem-vakif-universitesi-istanbul": ["bezmialem.edu.tr"],
  "bilkent-universitesi-ankara": ["bilkent.edu.tr"],
  "bogazici-universitesi-istanbul": ["boun.edu.tr"],
  "bolu-abant-izzet-baysal-universitesi": ["ibu.edu.tr"],
  "burdur-mehmet-akif-ersoy-universitesi": ["mehmetakif.edu.tr"],
  "bursa-teknik-universitesi": ["btu.edu.tr"],
  "bursa-uludag-universitesi": ["uludag.edu.tr"],
  "bursa-uludag-universitesi-bursa": ["uludag.edu.tr"],
  "canakkale-onsekiz-mart-universitesi": ["comu.edu.tr"],
  "cankaya-universitesi-ankara": ["cankaya.edu.tr"],
  "cankiri-karatekin-universitesi": ["karatekin.edu.tr"],
  "cukurova-universitesi-adana": ["cu.edu.tr"],
  "demiroglu-bilim-universitesi-istanbul": ["demiroglu.bilim.edu.tr"],
  "dokuz-eylul-universitesi-izmir": ["deu.edu.tr"],
  "ege-universitesi-izmir": ["ege.edu.tr"],
  "erciyes-universitesi-kayseri": ["erciyes.edu.tr"],
  "erzincan-binali-yildirim-universitesi": ["erzincan.edu.tr"],
  "eskisehir-osmangazi-universitesi": ["ogu.edu.tr"],
  "fenerbahce-universitesi-istanbul": ["fbu.edu.tr"],
  "firat-universitesi-elazig": ["firat.edu.tr"],
  "galatasaray-universitesi-istanbul": ["gsu.edu.tr"],
  "gazi-universitesi-ankara": ["gazi.edu.tr"],
  "gebze-teknik-universitesi": ["gtu.edu.tr"],
  "hacettepe-universitesi-ankara": ["hacettepe.edu.tr"],
  "hatay-mustafa-kemal-universitesi": ["mku.edu.tr"],
  "ihsan-dogramaci-bilkent-universitesi-ankara": ["bilkent.edu.tr"],
  "isik-universitesi-istanbul": ["isikun.edu.tr"],
  "iskenderun-teknik-universitesi-hatay": ["iste.edu.tr"],
  "istanbul-29-mayis-universitesi": ["29mayis.edu.tr"],
  "istanbul-arel-universitesi": ["arel.edu.tr"],
  "istanbul-atlas-universitesi": ["atlas.edu.tr"],
  "istanbul-aydin-universitesi": ["aydin.edu.tr"],
  "istanbul-beykent-universitesi": ["beykent.edu.tr"],
  "istanbul-bilgi-universitesi": ["bilgi.edu.tr"],
  "istanbul-esenyurt-universitesi": ["esenyurt.edu.tr"],
  "istanbul-galata-universitesi": ["galata.edu.tr"],
  "istanbul-gedik-universitesi": ["gedik.edu.tr"],
  "istanbul-gelisim-universitesi": ["gelisim.edu.tr"],
  "istanbul-kent-universitesi": ["kent.edu.tr"],
  "istanbul-kultur-universitesi": ["iku.edu.tr"],
  "istanbul-medeniyet-universitesi": ["medeniyet.edu.tr"],
  "istanbul-medipol-universitesi": ["medipol.edu.tr"],
  "istanbul-nisantasi-universitesi": ["nisantasi.edu.tr"],
  "istanbul-okan-universitesi": ["okan.edu.tr"],
  "istanbul-rumeli-universitesi": ["rumeli.edu.tr"],
  "istanbul-sabahattin-zaim-universitesi": ["izu.edu.tr"],
  "istanbul-saglik-ve-sosyal-bilimler-meslek-yuksekokulu": ["issb.edu.tr", "issbmyo.edu.tr"],
  "istanbul-saglik-ve-teknoloji-universitesi": ["istun.edu.tr"],
  "istanbul-sisli-meslek-yuksekokulu": ["sisli.edu.tr"],
  "istanbul-teknik-universitesi-istanbul": ["itu.edu.tr"],
  "istanbul-teknik-universitesi": ["itu.edu.tr"],
  "istanbul-topkapi-universitesi": ["topkapi.edu.tr"],
  "istanbul-universitesi-cerrahpasa-istanbul": ["iuc.edu.tr"],
  "istanbul-universitesi-cerrahpasa": ["iuc.edu.tr"],
  "istanbul-universitesi-istanbul": ["istanbul.edu.tr"],
  "istanbul-universitesi": ["istanbul.edu.tr"],
  "istanbul-yeni-yuzyil-universitesi": ["yeniyuzyil.edu.tr"],
  "izmir-bakircay-universitesi": ["bakircay.edu.tr"],
  "izmir-demokrasi-universitesi": ["idu.edu.tr"],
  "izmir-kavram-meslek-yuksekokulu": ["kavram.edu.tr"],
  "izmir-tinaztepe-universitesi": ["tinaztepe.edu.tr"],
  "kadir-has-universitesi-istanbul": ["khas.edu.tr"],
  "kahramanmaras-istiklal-universitesi": ["istiklal.edu.tr"],
  "kahramanmaras-sutcu-imam-universitesi": ["ksu.edu.tr"],
  "karadeniz-teknik-universitesi-trabzon": ["ktu.edu.tr"],
  "karamanoglu-mehmetbey-universitesi-karaman": ["kmu.edu.tr"],
  "kirikkale-universitesi": ["kku.edu.tr"],
  "kirsehir-ahi-evran-universitesi": ["ahievran.edu.tr"],
  "kocaeli-saglik-ve-teknoloji-universitesi": ["kocaelisaglik.edu.tr", "kostu.edu.tr"],
  "kocaeli-universitesi": ["kocaeli.edu.tr"],
  "koc-universitesi-istanbul": ["ku.edu.tr"],
  "konya-gida-ve-tarim-universitesi": ["gidatarim.edu.tr"],
  "kto-karatay-universitesi-konya": ["karatay.edu.tr"],
  "kutahya-dumlupinar-universitesi": ["dpu.edu.tr"],
  "kutahya-saglik-bilimleri-universitesi": ["ksbu.edu.tr"],
  "malatya-turgut-ozal-universitesi": ["ozal.edu.tr"],
  "manisa-cel-l-bayar-universitesi": ["mcbu.edu.tr", "cbu.edu.tr"],
  "mardin-artuklu-universitesi": ["artuklu.edu.tr"],
  "marmara-universitesi-istanbul": ["marmara.edu.tr"],
  "mimar-sinan-guzel-sanatlar-universitesi-istanbul": ["msgsu.edu.tr"],
  "mugla-sitki-kocman-universitesi": ["mu.edu.tr"],
  "mus-alparslan-universitesi": ["alparslan.edu.tr"],
  "necmettin-erbakan-universitesi-konya": ["erbakan.edu.tr"],
  "ordu-universitesi": ["odu.edu.tr"],
  "orta-dogu-teknik-universitesi-ankara": ["odtu.edu.tr", "metu.edu.tr"],
  "ostim-teknik-universitesi-ankara": ["ostimteknik.edu.tr"],
  "pamukkale-universitesi-denizli": ["pau.edu.tr"],
  "recep-tayyip-erdogan-universitesi-rize": ["erdogan.edu.tr"],
  "saglik-bilimleri-universitesi-istanbul": ["sbu.edu.tr"],
  "sakarya-uygulamali-bilimler-universitesi": ["subu.edu.tr"],
  "sabanci-universitesi-istanbul": ["sabanciuniv.edu.tr"],
  "selcuk-universitesi-konya": ["selcuk.edu.tr"],
  "sivas-cumhuriyet-universitesi": ["cumhuriyet.edu.tr"],
  "suleyman-demirel-universitesi-isparta": ["sdu.edu.tr"],
  "ted-universitesi-ankara": ["tedu.edu.tr"],
  "tekirdag-namik-kemal-universitesi": ["nku.edu.tr"],
  "tobb-ekonomi-ve-teknoloji-universitesi-ankara": ["etu.edu.tr"],
  "tokat-gaziosmanpasa-universitesi": ["gop.edu.tr"],
  "turk-alman-universitesi-istanbul": ["tau.edu.tr"],
  "turk-hava-kurumu-universitesi-ankara": ["thk.edu.tr"],
  "van-yuzuncu-yil-universitesi": ["yyu.edu.tr"],
  "yalova-universitesi": ["yalova.edu.tr"],
  "yasar-universitesi-izmir": ["yasar.edu.tr"],
  "yildiz-teknik-universitesi-istanbul": ["yildiz.edu.tr"],
  "yozgat-bozok-universitesi": ["bozok.edu.tr"],
  "yuksek-ihtisas-universitesi-ankara": ["yiu.edu.tr"],
  "zonguldak-bulent-ecevit-universitesi": ["beun.edu.tr"]
};
