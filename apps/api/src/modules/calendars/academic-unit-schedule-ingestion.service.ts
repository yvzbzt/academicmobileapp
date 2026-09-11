import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AdminUniversityAccess } from "../../common/authorization/admin-university-access.js";
import { assertUniversityOwnedRecord } from "../../common/authorization/admin-university-access.js";
import { safeOutboundRequest, type SafeOutboundRequestOptions, type SafeOutboundResponse } from "../../common/network/safe-outbound-request.js";
import { resolveSourceAuthorityContext, type ResolvedSourceAuthorityContext } from "../../bootstrap/source-authority-context.js";
import {
  listVerifiedAcademicUnitSources,
  type VerifiedAcademicUnitSource,
  type VerifiedRegistrySourceEvidence
} from "../../bootstrap/verified-source-registry.js";
import {
  normalizeStrictVerifiedSourceEvidence,
  VerifiedSourceEvidenceError
} from "../../bootstrap/verified-source-evidence.js";
import { requireSourceAuthority } from "../../domain/source-authority-enforcement.js";
import { classifyStudentRelevance } from "../../domain/student-relevance-classifier.js";
import type { AcademicEventCategory, AcademicTerm } from "../../domain/academic-event.types.js";
import { AuditService } from "../audit/audit.service.js";
import type { CatalogRepository } from "../catalog/catalog.types.js";
import { cleanText } from "../announcements/announcement-parser.js";
import { inferOfficeDocumentKind, parseOfficeDocument } from "../documents/office-document-parser.js";
import { extractPdfBinaryText } from "../pdf/pdf-binary-text.js";
import { academicTemporalFields } from "./calendar-temporal.js";
import type { AcademicEventRecord, CalendarRepository } from "./calendar.types.js";
import type {
  AcademicUnitScheduleCandidate,
  AcademicUnitScheduleFormat,
  AcademicUnitScheduleReviewDecision,
  AcademicUnitScheduleReviewResult,
  AcademicUnitScheduleSourceFilters,
  AcademicUnitScheduleSourceRecord,
  AcademicUnitScheduleSourceRepository,
  AcademicUnitScheduleType,
  NewAcademicUnitScheduleSource
} from "./academic-unit-schedule.types.js";

export const ACADEMIC_UNIT_SCHEDULE_REPOSITORY = "AcademicUnitScheduleSourceRepository";
export const ACADEMIC_UNIT_SCHEDULE_REGISTRY_LOADER = "AcademicUnitScheduleRegistryLoader";
export const ACADEMIC_UNIT_SCHEDULE_FETCHER = "AcademicUnitScheduleFetcher";
export const ACADEMIC_UNIT_SCHEDULE_AUTHORITY_RESOLVER = "AcademicUnitScheduleAuthorityResolver";

export type AcademicUnitScheduleRegistryLoader = () => Promise<VerifiedAcademicUnitSource[]>;
export type AcademicUnitScheduleFetcher = (url: string, options: SafeOutboundRequestOptions) => Promise<SafeOutboundResponse>;
export type AcademicUnitScheduleAuthorityResolver = typeof resolveSourceAuthorityContext;

export const ACADEMIC_UNIT_SCHEDULE_MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_CANDIDATES = 250;
const MAX_TEXT_LINES = 20_000;
const MAX_MATERIALIZED_EVENTS = 2_500;
const MAX_COURSE_RANGE_DAYS = 370;
const PROCESSING_LEASE_MS = 5 * 60 * 1000;
const PUBLICATION_LEASE_MS = 60 * 1000;
const PROVISION_CONCURRENCY = 6;

@Injectable()
export class AcademicUnitScheduleIngestionService {
  constructor(
    @Inject(ACADEMIC_UNIT_SCHEDULE_REPOSITORY) private readonly repository: AcademicUnitScheduleSourceRepository,
    @Inject("CatalogRepository") private readonly catalogRepository: CatalogRepository,
    @Inject(ACADEMIC_UNIT_SCHEDULE_REGISTRY_LOADER) private readonly registryLoader: AcademicUnitScheduleRegistryLoader,
    @Inject(ACADEMIC_UNIT_SCHEDULE_FETCHER) private readonly fetcher: AcademicUnitScheduleFetcher,
    @Inject(ACADEMIC_UNIT_SCHEDULE_AUTHORITY_RESOLVER) private readonly authorityResolver: AcademicUnitScheduleAuthorityResolver,
    @Optional() @Inject("CalendarRepository") private readonly calendarRepository?: CalendarRepository,
    @Optional() @Inject(AuditService) private readonly auditService?: AuditService
  ) {}

  async provisionVerifiedRegistry(): Promise<{
    created: number;
    existing: number;
    refreshed: number;
    disabled: number;
    skipped: number;
    skippedByReason: Record<string, number>;
  }> {
    const summary = { created: 0, existing: 0, refreshed: 0, disabled: 0, skipped: 0, skippedByReason: {} as Record<string, number> };
    const validDefinitions: Array<{ key: string; definitionHash: string }> = [];
    const validInputs: NewAcademicUnitScheduleSource[] = [];
    const sources = await this.registryLoader();
    const catalogCache = createCatalogScopeCache();
    const tasks = sources.flatMap((registrySource) => registrySource.scopeType !== "department" ? [] : ([
      { registrySource, scheduleType: "course_schedule" as const, field: "courseScheduleUrl" as const },
      { registrySource, scheduleType: "exam_schedule" as const, field: "examScheduleUrl" as const }
    ].filter((task) => Boolean(task.registrySource[task.field]))));
    for (let offset = 0; offset < tasks.length; offset += PROVISION_CONCURRENCY) {
      await Promise.all(tasks.slice(offset, offset + PROVISION_CONCURRENCY).map(async ({ registrySource, scheduleType, field }) => {
        const registryUrl = registrySource[field]!;
        try {
          if (!registrySource.departmentId) throw new Error("registry_department_id_missing");
          const evidence = registrySource.verificationByField?.[field];
          const validatedEvidence = validateFinalRevalidationEvidence(registryUrl, scheduleType, evidence, {
            universityId: registrySource.universityId,
            unitType: "department",
            scopeId: registrySource.departmentId
          });
          await this.requireActiveCatalogScope(registrySource, catalogCache);
          const authority = await this.resolveVerifiedAuthority(registrySource);
          requireScheduleEvidenceAuthority(authority, validatedEvidence);
          const input = buildNewSource(registrySource, scheduleType, validatedEvidence);
          validDefinitions.push({ key: input.key, definitionHash: input.definitionHash });
          validInputs.push(input);
        } catch (error) {
          const reason = publicReasonCode(error, "registry_source_rejected");
          summary.skipped += 1;
          summary.skippedByReason[reason] = (summary.skippedByReason[reason] ?? 0) + 1;
        }
      }));
    }
    const revocation = await this.repository.disableSourcesExcept(validDefinitions);
    summary.disabled = revocation.disabled;
    if (revocation.revokedPublications.length > 0) {
      const calendarRepository = this.requireCalendarRepository();
      const unique = new Map(revocation.revokedPublications.map((item) => [`${item.universityId}\0${item.reviewKey}`, item]));
      for (const revoked of unique.values()) {
        await calendarRepository.archiveScheduleReviewEvents(revoked.reviewKey, revoked.universityId);
      }
    }
    for (let offset = 0; offset < validInputs.length; offset += PROVISION_CONCURRENCY) {
      await Promise.all(validInputs.slice(offset, offset + PROVISION_CONCURRENCY).map(async (input) => {
        try {
          const provisioned = await this.repository.provisionSource(input);
          summary[provisioned.disposition] += 1;
        } catch (error) {
          const reason = publicReasonCode(error, "registry_source_rejected");
          summary.skipped += 1;
          summary.skippedByReason[reason] = (summary.skippedByReason[reason] ?? 0) + 1;
        }
      }));
    }
    return summary;
  }

  async listSources(
    access: AdminUniversityAccess,
    filters: Omit<AcademicUnitScheduleSourceFilters, "limit" | "offset"> & { limit?: number; offset?: number }
  ): Promise<AcademicUnitScheduleSourceRecord[]> {
    if (access.kind === "university" && filters.universityId && filters.universityId !== access.universityId) {
      return [];
    }
    const universityId = access.kind === "university" ? access.universityId : filters.universityId;
    const requestedLimit = Number.isSafeInteger(filters.limit) ? filters.limit! : 50;
    const requestedOffset = Number.isSafeInteger(filters.offset) ? filters.offset! : 0;
    return this.repository.listSources({
      ...filters,
      ...(universityId ? { universityId } : {}),
      limit: Math.min(Math.max(requestedLimit, 1), 100),
      offset: Math.min(Math.max(requestedOffset, 0), 1_000_000)
    });
  }

  async updateCandidate(
    access: AdminUniversityAccess,
    actorId: string,
    sourceId: string,
    rowNumber: number,
    input: {
      expectedRevision: number;
      title?: string | null;
      date?: string | null;
      dayOfWeek?: number | null;
      startTime?: string | null;
      endTime?: string | null;
      location?: string | null;
    }
  ): Promise<AcademicUnitScheduleSourceRecord> {
    requireNonNegativeRevision(input.expectedRevision);
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || rowNumber > MAX_TEXT_LINES) {
      throw new BadRequestException("rowNumber is outside the parsed schedule bounds.");
    }
    const source = await this.requireOwnedSource(access, sourceId);
    if (source.lifecycle !== "review_required" || source.reviewResult?.outcome !== "parsed_pending_review") {
      throw new ConflictException("Only parsed candidates awaiting review can be edited.");
    }
    await this.requireCurrentDefinitionOrConflict(source);
    const candidate = source.reviewResult.candidates.find((item) => item.rowNumber === rowNumber);
    if (!candidate) throw new NotFoundException("Schedule candidate not found.");
    const edited = applyCandidateUpdate(candidate, input);
    const updated = await this.repository.updateCandidate({
      id: source.id,
      expectedRevision: input.expectedRevision,
      definitionHash: source.definitionHash,
      rowNumber,
      candidate: edited
    });
    if (!updated) throw new ConflictException("Schedule candidate changed; refresh before saving.");
    await this.auditService?.record({
      actorId,
      action: "academic_unit_schedule.candidate_updated",
      entityType: "academic_unit_schedule_source",
      entityId: source.id,
      metadata: { universityId: source.universityId, facultyId: source.facultyId, departmentId: source.departmentId, rowNumber, revision: updated.revision }
    });
    return updated;
  }

  async reviewSource(
    access: AdminUniversityAccess,
    actorId: string,
    sourceId: string,
    input: {
      expectedRevision: number;
      decision: "approve" | "reject";
      academicYear?: string;
      term?: AcademicTerm;
      courseRangeStart?: string;
      courseRangeEnd?: string;
      approvedRowNumbers?: number[];
      reason?: string;
    }
  ): Promise<AcademicUnitScheduleSourceRecord> {
    requireNonNegativeRevision(input.expectedRevision);
    const source = await this.requireOwnedSource(access, sourceId);
    if (source.lifecycle === "quarantined" || source.reviewResult?.outcome === "definition_drift_review") {
      throw new ConflictException("Definition drift is quarantined and cannot be approved; revalidate the registry first.");
    }
    if (!source.reviewResult || source.reviewResult.outcome !== "parsed_pending_review") {
      throw new ConflictException("This source has no parsed candidates awaiting review.");
    }
    await this.requireCurrentDefinitionOrConflict(source);

    const approvedRowNumbers = input.decision === "approve"
      ? normalizeApprovedRows(input.approvedRowNumbers, source.reviewResult.candidates)
      : [];
    const allRows = source.reviewResult.candidates.map((candidate) => candidate.rowNumber);
    const rejectedRowNumbers = allRows.filter((rowNumber) => !approvedRowNumbers.includes(rowNumber));
    const reviewKey = sha256(stableJson({
      sourceId: source.id,
      definitionHash: source.definitionHash,
      contentSha256: source.reviewResult.contentSha256,
      reviewRevision: input.expectedRevision,
      decision: input.decision,
      approvedRowNumbers,
      ...(input.academicYear ? { academicYear: input.academicYear } : {}),
      ...(input.term ? { term: input.term } : {}),
      ...(input.courseRangeStart ? { courseRangeStart: input.courseRangeStart } : {}),
      ...(input.courseRangeEnd ? { courseRangeEnd: input.courseRangeEnd } : {}),
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {})
    }));
    if (source.reviewDecision?.reviewKey === reviewKey) {
      if (source.lifecycle === "materializing" && source.reviewDecision.materializationStatus !== "reopening") {
        return this.materializeDecision(source);
      }
      if (["rejected", "staged", "published"].includes(source.lifecycle)) return source;
    }
    if (source.lifecycle !== "review_required") {
      throw new ConflictException("Schedule review changed; refresh before submitting a decision.");
    }

    let academicYear: string | undefined;
    let term: AcademicTerm | undefined;
    if (input.decision === "approve") {
      academicYear = requireAcademicYear(input.academicYear);
      term = requireAcademicTerm(input.term);
      validateApprovedCandidates(source, approvedRowNumbers, input.courseRangeStart, input.courseRangeEnd);
    }
    const decision: AcademicUnitScheduleReviewDecision = {
      decision: input.decision === "approve" ? "approved" : "rejected",
      reviewKey,
      reviewRevision: input.expectedRevision,
      reviewedBy: actorId,
      reviewedAt: new Date(),
      approvedRowNumbers,
      rejectedRowNumbers,
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      ...(academicYear ? { academicYear } : {}),
      ...(term ? { term } : {}),
      ...(input.courseRangeStart ? { courseRangeStart: input.courseRangeStart } : {}),
      ...(input.courseRangeEnd ? { courseRangeEnd: input.courseRangeEnd } : {}),
      ...(input.decision === "approve" ? { materializationStatus: "materializing" as const } : {})
    };
    const decided = await this.repository.beginReviewDecision({
      id: source.id,
      expectedRevision: input.expectedRevision,
      definitionHash: source.definitionHash,
      decision
    });
    if (!decided) throw new ConflictException("Schedule review changed; refresh before submitting a decision.");
    if (decision.decision === "rejected") {
      await this.auditService?.record({
        actorId,
        action: "academic_unit_schedule.rejected",
        entityType: "academic_unit_schedule_source",
        entityId: source.id,
        metadata: { universityId: source.universityId, facultyId: source.facultyId, departmentId: source.departmentId, candidateCount: allRows.length, reviewKey }
      });
      return decided;
    }
    return this.materializeDecision(decided);
  }

  async reopenReview(
    access: AdminUniversityAccess,
    actorId: string,
    sourceId: string,
    expectedRevision: number
  ): Promise<AcademicUnitScheduleSourceRecord> {
    requireNonNegativeRevision(expectedRevision);
    const source = await this.requireOwnedSource(access, sourceId);
    if (source.lifecycle === "published") {
      throw new ConflictException("Published schedule reviews are immutable and cannot be reopened.");
    }
    const decision = source.reviewDecision;
    if (!decision?.reviewKey || !["materializing", "staged"].includes(source.lifecycle)) {
      throw new ConflictException("Only a materializing or staged schedule review can be reopened.");
    }

    let claimed: AcademicUnitScheduleSourceRecord | null;
    if (decision.materializationStatus === "reopening") {
      claimed = source.revision === expectedRevision ? source : null;
    } else {
      claimed = await this.repository.claimReviewReopen({
        id: source.id,
        expectedRevision,
        reviewKey: decision.reviewKey
      });
    }
    if (!claimed?.reviewDecision) {
      throw new ConflictException("Schedule review changed; refresh before reopening it.");
    }

    const calendarRepository = this.requireCalendarRepository();
    const archivedEventCount = await calendarRepository.archiveScheduleReviewEvents(
      claimed.reviewDecision.reviewKey,
      claimed.universityId
    );
    const reopened = await this.repository.completeReviewReopen({
      id: claimed.id,
      expectedRevision: claimed.revision,
      reviewKey: claimed.reviewDecision.reviewKey
    });
    if (!reopened) {
      throw new ConflictException("Schedule review changed while it was being reopened; refresh and retry.");
    }
    await this.auditService?.record({
      actorId,
      action: "academic_unit_schedule.review_reopened",
      entityType: "academic_unit_schedule_source",
      entityId: source.id,
      metadata: {
        universityId: source.universityId,
        facultyId: source.facultyId,
        departmentId: source.departmentId,
        reviewKey: decision.reviewKey,
        archivedEventCount
      }
    });
    return reopened;
  }

  async publishStagedSource(
    access: AdminUniversityAccess,
    actorId: string,
    sourceId: string,
    expectedRevision: number
  ): Promise<AcademicUnitScheduleSourceRecord> {
    requireNonNegativeRevision(expectedRevision);
    const source = await this.requireOwnedSource(access, sourceId);
    if (source.lifecycle === "published" && source.reviewDecision?.materializationStatus === "published") return source;
    const resumablePublication = source.lifecycle === "published"
      && source.reviewDecision?.materializationStatus === "publishing";
    if ((source.lifecycle !== "staged" && !resumablePublication)
      || source.revision !== expectedRevision
      || !source.reviewDecision?.calendarId) {
      throw new ConflictException("Staged schedule changed; refresh before publication.");
    }
    await this.requireCurrentDefinitionOrConflict(source);
    const calendarRepository = this.requireCalendarRepository();
    const calendar = await calendarRepository.findCalendarById(source.reviewDecision.calendarId);
    if (!calendar || calendar.universityId !== source.universityId) {
      throw new ConflictException("The staged calendar is missing or outside the source scope.");
    }
    if (calendar.status === "draft") {
      throw new ConflictException("Publish the linked draft calendar through the standard super-admin calendar publication action first.");
    }
    if (calendar.status !== "published") throw new ConflictException("The linked calendar is not publishable.");
    const now = new Date();
    const claimed = await this.repository.claimPublication({
      id: source.id,
      expectedRevision,
      reviewKey: source.reviewDecision.reviewKey,
      now,
      leaseUntil: new Date(now.getTime() + PUBLICATION_LEASE_MS)
    });
    if (!claimed) throw new ConflictException("Schedule publication is active or changed; refresh and retry.");

    let published: AcademicUnitScheduleSourceRecord;
    try {
      await this.requireCurrentDefinitionOrConflict(claimed);
      const currentCalendar = await calendarRepository.findCalendarById(calendar.id);
      if (!currentCalendar || currentCalendar.status !== "published" || currentCalendar.universityId !== claimed.universityId) {
        throw new ConflictException("The linked calendar changed while the schedule was being published.");
      }
      await calendarRepository.publishScheduleReviewEvents(claimed.reviewDecision!.reviewKey, claimed.universityId);
      const eventIdSet = new Set(claimed.reviewDecision!.eventIds ?? []);
      const stagedEvents = (await calendarRepository.listEventsByCalendar(calendar.id)).filter((event) => eventIdSet.has(event.id));
      if (stagedEvents.length !== eventIdSet.size || stagedEvents.some((event) => event.status !== "published")) {
        throw new ConflictException("Not all staged schedule rows could be published.");
      }
      const completed = await this.repository.completePublication({
        id: claimed.id,
        expectedRevision: claimed.revision,
        reviewKey: claimed.reviewDecision!.reviewKey,
        publishedBy: actorId,
        publishedAt: new Date()
      });
      if (!completed) throw new ConflictException("Schedule publication changed before completion; refresh and retry.");
      published = completed;
    } catch (error) {
      const current = await this.repository.findSourceById(claimed.id);
      if (current?.lifecycle === "published"
        && current.reviewDecision?.reviewKey === claimed.reviewDecision!.reviewKey
        && current.reviewDecision.materializationStatus === "published") {
        return current;
      }
      if (current?.lifecycle === "published"
        && current.revision === claimed.revision
        && current.reviewDecision?.reviewKey === claimed.reviewDecision!.reviewKey
        && current.reviewDecision.materializationStatus === "publishing") {
        await calendarRepository.rollbackScheduleReviewEvents(claimed.reviewDecision!.reviewKey, claimed.universityId);
        await this.repository.releasePublication({
          id: claimed.id,
          expectedRevision: claimed.revision,
          reviewKey: claimed.reviewDecision!.reviewKey
        });
      }
      // A different revision owns all cleanup, including registry revocation; stale claimants do nothing.
      throw error;
    }
    const eventCount = new Set(published.reviewDecision?.eventIds ?? []).size;
    await this.auditService?.record({
      actorId,
      action: "academic_unit_schedule.published",
      entityType: "academic_unit_schedule_source",
      entityId: source.id,
      metadata: { universityId: source.universityId, calendarId: calendar.id, eventCount, reviewKey: source.reviewDecision.reviewKey }
    });
    return published;
  }

  async ingestSource(
    access: AdminUniversityAccess,
    sourceId: string,
    expectedRevision: number
  ): Promise<AcademicUnitScheduleSourceRecord> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new BadRequestException("expectedRevision must be a non-negative integer.");
    }
    const source = await this.repository.findSourceById(sourceId);
    if (!source) throw new NotFoundException("Schedule source not found.");
    assertUniversityOwnedRecord(access, source.universityId, "Schedule source");
    if (source.lifecycle === "disabled") throw new ConflictException("Schedule source is no longer verified by the active registry.");
    try {
      await this.requireCurrentRegistryDefinition(source);
    } catch {
      throw new ConflictException("Schedule source is no longer verified by the active registry. Provision the registry and retry.");
    }

    const now = new Date();
    const claimed = await this.repository.claimSource({
      id: source.id,
      expectedRevision,
      definitionHash: source.definitionHash,
      now,
      leaseUntil: new Date(now.getTime() + PROCESSING_LEASE_MS)
    });
    if (!claimed) throw new ConflictException("Schedule source changed or is already being processed. Refresh and retry.");

    let result: AcademicUnitScheduleReviewResult;
    try {
      result = await this.fetchAndParse(claimed);
    } catch (error) {
      result = emptyReviewResult(
        isScopeOrAuthorityError(error) ? "scope_rejected_review" : "fetch_failed_review",
        publicReasonCode(error, "schedule_fetch_failed")
      );
    }
    const completed = await this.repository.completeSource({
      id: claimed.id,
      claimRevision: claimed.revision,
      definitionHash: claimed.definitionHash,
      result
    });
    if (!completed) throw new ConflictException("Schedule source changed while processing; stale result was discarded.");
    return completed;
  }

  private async materializeDecision(source: AcademicUnitScheduleSourceRecord): Promise<AcademicUnitScheduleSourceRecord> {
    const decision = source.reviewDecision;
    if (source.lifecycle !== "materializing" || decision?.decision !== "approved" || !decision.academicYear || !decision.term) {
      throw new ConflictException("Schedule approval is not ready for materialization.");
    }
    await this.requireCurrentDefinitionOrConflict(source);
    const calendarRepository = this.requireCalendarRepository();
    const calendar = await calendarRepository.findPublishedCalendar(source.universityId, decision.academicYear);
    if (!calendar) {
      throw new ConflictException("Publish a standard academic calendar for this university and academic year, then retry the same review decision.");
    }
    if (calendar.universityId !== source.universityId || calendar.academicYear !== decision.academicYear) {
      throw new ConflictException("Published calendar does not match the approved source scope.");
    }
    const eventInputs = materializeScheduleEvents(source, calendar.id, {
      ...decision,
      academicYear: decision.academicYear,
      term: decision.term
    });
    const events = await calendarRepository.upsertScheduleReviewEvents(eventInputs);
    if (events.length !== eventInputs.length) {
      throw new ConflictException("Approved schedule rows were not fully staged; retry the same review decision.");
    }
    const completed = await this.repository.completeMaterialization({
      id: source.id,
      expectedRevision: source.revision,
      reviewKey: decision.reviewKey,
      calendarId: calendar.id,
      eventIds: events.map((event) => event.id)
    });
    if (!completed) {
      const current = await this.repository.findSourceById(source.id);
      if (current?.reviewDecision?.reviewKey === decision.reviewKey && ["staged", "published"].includes(current.lifecycle)) return current;
      await calendarRepository.archiveScheduleReviewEvents(decision.reviewKey, source.universityId);
      throw new ConflictException("Schedule source changed while approved rows were staged.");
    }
    await this.auditService?.record({
      actorId: decision.reviewedBy,
      action: "academic_unit_schedule.approved_staged",
      entityType: "academic_unit_schedule_source",
      entityId: source.id,
      metadata: {
        universityId: source.universityId,
        facultyId: source.facultyId,
        departmentId: source.departmentId,
        calendarId: calendar.id,
        calendarStatus: calendar.status,
        approvedCandidateCount: decision.approvedRowNumbers.length,
        rejectedCandidateCount: decision.rejectedRowNumbers.length,
        materializedEventCount: events.length,
        reviewKey: decision.reviewKey
      }
    });
    return completed;
  }

  private async requireOwnedSource(
    access: AdminUniversityAccess,
    sourceId: string
  ): Promise<AcademicUnitScheduleSourceRecord> {
    const source = await this.repository.findSourceById(sourceId);
    if (!source) throw new NotFoundException("Schedule source not found.");
    assertUniversityOwnedRecord(access, source.universityId, "Schedule source");
    return source;
  }

  private async requireCurrentDefinitionOrConflict(source: AcademicUnitScheduleSourceRecord): Promise<void> {
    try {
      await this.requireCurrentRegistryDefinition(source);
    } catch {
      throw new ConflictException("Schedule source is no longer verified by the active registry. Provision the registry and retry.");
    }
  }

  private requireCalendarRepository(): CalendarRepository {
    if (!this.calendarRepository) throw new Error("CALENDAR_REPOSITORY_REQUIRED_FOR_SCHEDULE_REVIEW");
    return this.calendarRepository;
  }

  private async fetchAndParse(source: AcademicUnitScheduleSourceRecord): Promise<AcademicUnitScheduleReviewResult> {
    await this.requireActivePersistedScope(source);
    const authority = await this.resolveVerifiedAuthority(source);
    requireScheduleAuthority(authority, "fetch", source.sourceUrl);
    const response = await this.fetcher(source.sourceUrl, {
      timeoutMs: 20_000,
      maximumRedirects: 5,
      maximumResponseBytes: ACADEMIC_UNIT_SCHEDULE_MAX_RESPONSE_BYTES,
      headers: {
        Accept: "text/html,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;q=0.9,*/*;q=0.2",
        "User-Agent": "AkademikTakvimScheduleVerifier/1.0"
      },
      validateUrl: (candidate, previousUrl) => {
        requireHttpsUrl(candidate);
        const decision = previousUrl
          ? requireScheduleAuthority(authority, "fetch", source.sourceUrl, candidate)
          : requireScheduleAuthority(authority, "fetch", candidate);
        return (previousUrl ? decision.canonicalFinalRedirectUrl : decision.canonicalUrl) ?? candidate;
      }
    });
    requireHttpsUrl(response.finalUrl);
    requireScheduleAuthority(authority, "fetch", source.sourceUrl, response.finalUrl);
    if (response.status < 200 || response.status >= 300) throw new Error(`schedule_http_${response.status}`);

    const fetchedFinalUrl = normalizeEvidenceUrl(response.finalUrl);
    const fetchedFinalUrlHash = sha256(fetchedFinalUrl);
    const contentType = firstHeader(response.headers["content-type"]).slice(0, 200);
    const format = detectScheduleFormat(response.body, fetchedFinalUrl, contentType);
    const provenance = {
      httpStatus: response.status,
      contentType,
      finalUrl: fetchedFinalUrl,
      finalUrlHash: fetchedFinalUrlHash,
      contentSha256: sha256(response.body)
    };
    if (fetchedFinalUrl !== source.verifiedFinalUrl || fetchedFinalUrlHash !== source.verifiedFinalUrlHash) {
      return { ...emptyReviewResult("definition_drift_review", "definition_drift", format), ...provenance };
    }
    if (format === "image") {
      return { ...emptyReviewResult("unsupported_ocr_review", "ocr_not_configured", format), ...provenance };
    }
    if (format === "unsupported") {
      return { ...emptyReviewResult("unsupported_format_review", "unsupported_schedule_format", format), ...provenance };
    }

    try {
      const parsed = await extractScheduleText(format, response.body, fetchedFinalUrl, contentType);
      if (parsed.ocrRequired) {
        return { ...emptyReviewResult("unsupported_ocr_review", "pdf_has_no_extractable_text", "pdf"), ...provenance };
      }
      const candidates = parseScheduleCandidates(parsed.text, source.scheduleType);
      return {
        outcome: candidates.length > 0 ? "parsed_pending_review" : "parse_zero_review",
        format,
        parser: parsed.parser,
        ...(candidates.length === 0 ? { reasonCode: "no_schedule_rows_parsed" } : {}),
        ...provenance,
        candidateCount: candidates.length,
        candidates,
        checkedAt: new Date()
      };
    } catch (error) {
      return {
        ...emptyReviewResult("parse_failed_review", publicReasonCode(error, "schedule_parse_failed"), format),
        ...provenance
      };
    }
  }

  private async requireCurrentRegistryDefinition(source: AcademicUnitScheduleSourceRecord): Promise<void> {
    const matches = (await this.registryLoader()).filter((candidate) => (
      candidate.scopeType === "department"
      && candidate.universityId === source.universityId
      && candidate.facultyId === source.facultyId
      && candidate.departmentId === source.departmentId
    ));
    if (matches.length !== 1) throw new Error("registry_scope_missing_or_ambiguous");
    const registrySource = matches[0]!;
    const field = source.scheduleType === "course_schedule" ? "courseScheduleUrl" : "examScheduleUrl";
    const registryUrl = registrySource[field];
    if (!registryUrl) throw new Error("registry_schedule_url_missing");
    const evidence = validateFinalRevalidationEvidence(registryUrl, source.scheduleType, registrySource.verificationByField?.[field], {
      universityId: source.universityId,
      unitType: "department",
      scopeId: source.departmentId
    });
    await this.requireActiveCatalogScope(registrySource);
    const authority = await this.resolveVerifiedAuthority(registrySource);
    requireScheduleEvidenceAuthority(authority, evidence);
    const currentDefinition = buildNewSource(registrySource, source.scheduleType, evidence);
    if (!sourceMatchesDefinition(source, currentDefinition)) throw new Error("registry_definition_changed");
  }

  private async requireActiveCatalogScope(source: VerifiedAcademicUnitSource, cache?: CatalogScopeCache): Promise<void> {
    if (!source.facultyId || !source.departmentId || !source.universityId) throw new Error("registry_scope_ids_missing");
    let universityActive = cache?.universityActive.get(source.universityId);
    if (!universityActive) {
      universityActive = this.catalogRepository.findUniversityById(source.universityId)
        .then((university) => university?.status === "active");
      cache?.universityActive.set(source.universityId, universityActive);
    }
    if (!await universityActive) throw new Error("catalog_university_inactive_or_missing");
    let facultyIds = cache?.activeFacultyIds.get(source.universityId);
    if (!facultyIds) {
      facultyIds = this.catalogRepository.listFaculties(source.universityId, "active")
        .then((faculties) => new Set(faculties.map((faculty) => faculty.id)));
      cache?.activeFacultyIds.set(source.universityId, facultyIds);
    }
    if (!(await facultyIds).has(source.facultyId)) throw new Error("catalog_faculty_scope_mismatch");
    let departments = cache?.activeDepartments.get(source.facultyId);
    if (!departments) {
      departments = this.catalogRepository.listDepartments(source.facultyId, "active")
        .then((items) => new Map(items.map((department) => [department.id, department.universityId])));
      cache?.activeDepartments.set(source.facultyId, departments);
    }
    if ((await departments).get(source.departmentId) !== source.universityId) throw new Error("catalog_department_scope_mismatch");
  }

  private async requireActivePersistedScope(source: AcademicUnitScheduleSourceRecord): Promise<void> {
    await this.requireActiveCatalogScope({
      scopeType: "department",
      universityId: source.universityId,
      facultyId: source.facultyId,
      departmentId: source.departmentId
    });
  }

  private async resolveVerifiedAuthority(
    source: Pick<VerifiedAcademicUnitSource, "universityId" | "departmentId">
  ): Promise<ResolvedSourceAuthorityContext> {
    if (!source.departmentId) throw new Error("registry_department_id_missing");
    const authority = await this.authorityResolver({
      universityId: source.universityId,
      ownerAcademicEntityId: source.departmentId,
      scopeType: "department",
      scopeId: source.departmentId
    });
    if (authority.authorityStatus !== "verified") throw new Error("source_authority_not_verified");
    return authority;
  }
}

type StagedScheduleEvent = Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt"> & { scheduleCandidateKey: string };

function applyCandidateUpdate(
  candidate: AcademicUnitScheduleCandidate,
  input: {
    title?: string | null;
    date?: string | null;
    dayOfWeek?: number | null;
    startTime?: string | null;
    endTime?: string | null;
    location?: string | null;
  }
): AcademicUnitScheduleCandidate {
  const updated = structuredClone(candidate);
  const mutable = updated as unknown as Record<string, unknown>;
  for (const field of ["title", "date", "dayOfWeek", "startTime", "endTime", "location"] as const) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    const value = input[field];
    if (value === null || (typeof value === "string" && !value.trim())) delete mutable[field];
    else mutable[field] = typeof value === "string" ? value.trim() : value;
  }
  if (updated.title && updated.title.length > 240) throw new BadRequestException("Candidate title is too long.");
  if (updated.location && updated.location.length > 240) throw new BadRequestException("Candidate location is too long.");
  if (updated.date && !isCalendarDate(updated.date)) throw new BadRequestException("Candidate date must be a valid YYYY-MM-DD date.");
  if (updated.dayOfWeek !== undefined && (!Number.isSafeInteger(updated.dayOfWeek) || updated.dayOfWeek < 0 || updated.dayOfWeek > 6)) {
    throw new BadRequestException("Candidate dayOfWeek must be from 0 through 6.");
  }
  if (updated.startTime && !isTime(updated.startTime)) throw new BadRequestException("Candidate startTime must be HH:mm.");
  if (updated.endTime && !isTime(updated.endTime)) throw new BadRequestException("Candidate endTime must be HH:mm.");
  if (updated.startTime && updated.endTime && updated.endTime <= updated.startTime) {
    throw new BadRequestException("Candidate endTime must be later than startTime.");
  }
  return updated;
}

function normalizeApprovedRows(
  requestedRows: number[] | undefined,
  candidates: AcademicUnitScheduleCandidate[]
): number[] {
  const available = new Set(candidates.map((candidate) => candidate.rowNumber));
  const rows = requestedRows === undefined ? [...available] : [...new Set(requestedRows)];
  if (rows.length === 0 || rows.length > MAX_CANDIDATES || rows.some((row) => !Number.isSafeInteger(row) || !available.has(row))) {
    throw new BadRequestException("approvedRowNumbers must select one or more parsed candidate rows.");
  }
  return rows.sort((left, right) => left - right);
}

function validateApprovedCandidates(
  source: AcademicUnitScheduleSourceRecord,
  approvedRows: number[],
  courseRangeStart?: string,
  courseRangeEnd?: string
): void {
  const selected = source.reviewResult!.candidates.filter((candidate) => approvedRows.includes(candidate.rowNumber));
  for (const candidate of selected) {
    if (!candidate.startTime || !isTime(candidate.startTime)) {
      throw new BadRequestException(`Candidate row ${candidate.rowNumber} requires a valid start time.`);
    }
    if (candidate.endTime && (!isTime(candidate.endTime) || candidate.endTime <= candidate.startTime)) {
      throw new BadRequestException(`Candidate row ${candidate.rowNumber} has an invalid end time.`);
    }
    if (source.scheduleType === "exam_schedule" && (!candidate.date || !isCalendarDate(candidate.date))) {
      throw new BadRequestException(`Exam candidate row ${candidate.rowNumber} requires a valid date.`);
    }
    if (source.scheduleType === "course_schedule" && (candidate.dayOfWeek === undefined || candidate.dayOfWeek < 0 || candidate.dayOfWeek > 6)) {
      throw new BadRequestException(`Course candidate row ${candidate.rowNumber} requires a weekday.`);
    }
  }
  if (source.scheduleType !== "course_schedule") return;
  if (!courseRangeStart || !courseRangeEnd || !isCalendarDate(courseRangeStart) || !isCalendarDate(courseRangeEnd)) {
    throw new BadRequestException("Course schedule approval requires valid courseRangeStart and courseRangeEnd dates.");
  }
  const rangeDays = calendarDayDistance(courseRangeStart, courseRangeEnd);
  if (rangeDays < 0 || rangeDays > MAX_COURSE_RANGE_DAYS) {
    throw new BadRequestException(`Course schedule range must be ordered and no longer than ${MAX_COURSE_RANGE_DAYS} days.`);
  }
  const estimated = selected.reduce((count, candidate) => count + countWeekdayOccurrences(courseRangeStart, courseRangeEnd, candidate.dayOfWeek!), 0);
  if (estimated < 1 || estimated > MAX_MATERIALIZED_EVENTS) {
    throw new BadRequestException(`Approved rows must materialize between 1 and ${MAX_MATERIALIZED_EVENTS} events.`);
  }
}

function materializeScheduleEvents(
  source: AcademicUnitScheduleSourceRecord,
  calendarId: string,
  decision: AcademicUnitScheduleReviewDecision & { academicYear: string; term: AcademicTerm }
): StagedScheduleEvent[] {
  const selected = source.reviewResult!.candidates.filter((candidate) => decision.approvedRowNumbers.includes(candidate.rowNumber));
  const datedCandidates = source.scheduleType === "exam_schedule"
    ? selected.map((candidate) => ({ candidate, date: candidate.date! }))
    : selected.flatMap((candidate) => datesForWeekday(decision.courseRangeStart!, decision.courseRangeEnd!, candidate.dayOfWeek!)
      .map((date) => ({ candidate, date })));
  if (datedCandidates.length < 1 || datedCandidates.length > MAX_MATERIALIZED_EVENTS) {
    throw new BadRequestException(`Approved rows must materialize between 1 and ${MAX_MATERIALIZED_EVENTS} events.`);
  }
  return datedCandidates.map(({ candidate, date }) => {
    const title = (candidate.title?.trim() || candidate.rawText).slice(0, 240);
    const startValue = `${date}T${candidate.startTime}:00+03:00`;
    const endValue = candidate.endTime ? `${date}T${candidate.endTime}:00+03:00` : undefined;
    const temporal = academicTemporalFields(startValue, endValue);
    const scheduleCandidateKey = sha256(stableJson({ reviewKey: decision.reviewKey, rowNumber: candidate.rowNumber, date }));
    const category = source.scheduleType === "course_schedule" ? "course_schedule" : examCategory(title);
    return {
      calendarId,
      universityId: source.universityId,
      facultyId: source.facultyId,
      departmentId: source.departmentId,
      academicYear: decision.academicYear,
      term: decision.term,
      category,
      title,
      ...(source.scheduleType === "course_schedule" ? { courseName: title } : {}),
      ...(candidate.location?.trim() ? { location: candidate.location.trim() } : {}),
      ...classifyStudentRelevance({ title, body: candidate.rawText }),
      scheduleSeriesId: decision.reviewKey,
      scheduleReviewKey: decision.reviewKey,
      scheduleCandidateKey,
      scheduleSourceId: source.id,
      scheduleRowNumber: candidate.rowNumber,
      ...temporal,
      timezone: "Europe/Istanbul" as const,
      originalDateText: date,
      originalText: candidate.rawText,
      status: "approved" as const,
      notificationRules: source.scheduleType === "exam_schedule"
        ? [{ offsetDays: 7, enabled: true }, { offsetDays: 1, enabled: true }, { offsetDays: 0, trigger: "at_time" as const, enabled: true }]
        : []
    };
  });
}

function examCategory(title: string): AcademicEventCategory {
  if (/(?:bütünleme|butunleme|mazeret|make[ -]?up)/iu.test(title)) return "makeup_exam";
  if (/(?:ara\s+sınav|ara\s+sinav|vize|midterm)/iu.test(title)) return "midterm_exam";
  if (/(?:tek\s+ders|single\s+course)/iu.test(title)) return "single_course_exam";
  if (/(?:final|yarıyıl\s+sonu|yariyil\s+sonu)/iu.test(title)) return "final_exam";
  return "department_exam_schedule";
}

function requireAcademicYear(value: string | undefined): string {
  const match = /^(\d{4})-(\d{4})$/u.exec(value ?? "");
  if (!match || Number(match[2]) !== Number(match[1]) + 1) throw new BadRequestException("academicYear must contain consecutive years, for example 2026-2027.");
  return value!;
}

function requireAcademicTerm(value: AcademicTerm | undefined): AcademicTerm {
  if (!value || !["fall", "spring", "summer", "full_year", "unknown"].includes(value)) {
    throw new BadRequestException("A valid academic term is required.");
  }
  return value;
}

function requireNonNegativeRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new BadRequestException("expectedRevision must be a non-negative integer.");
}

function isTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

function calendarDayDistance(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000);
}

function datesForWeekday(start: string, end: string, dayOfWeek: number): string[] {
  const dates: string[] = [];
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + ((dayOfWeek - date.getUTCDay() + 7) % 7));
  while (date.toISOString().slice(0, 10) <= end) {
    dates.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 7);
  }
  return dates;
}

function countWeekdayOccurrences(start: string, end: string, dayOfWeek: number): number {
  return datesForWeekday(start, end, dayOfWeek).length;
}

interface CatalogScopeCache {
  universityActive: Map<string, Promise<boolean>>;
  activeFacultyIds: Map<string, Promise<Set<string>>>;
  activeDepartments: Map<string, Promise<Map<string, string>>>;
}

function createCatalogScopeCache(): CatalogScopeCache {
  return { universityActive: new Map(), activeFacultyIds: new Map(), activeDepartments: new Map() };
}

function buildNewSource(
  source: VerifiedAcademicUnitSource,
  scheduleType: AcademicUnitScheduleType,
  evidence: VerifiedRegistrySourceEvidence
): NewAcademicUnitScheduleSource {
  const universityId = source.universityId;
  const facultyId = source.facultyId!;
  const departmentId = source.departmentId!;
  const sourceUrl = normalizeEvidenceUrl(evidence.sourceUrl);
  const verifiedFinalUrl = normalizeEvidenceUrl(evidence.finalUrl);
  const evidenceHash = sha256(stableJson(evidence));
  const definition = { universityId, facultyId, departmentId, scheduleType, sourceUrl, verifiedFinalUrl, evidenceHash };
  return {
    key: sha256(stableJson({ universityId, facultyId, departmentId, scheduleType })),
    ...definition,
    sourceUrlHash: sha256(sourceUrl),
    verifiedFinalUrlHash: sha256(verifiedFinalUrl),
    definitionHash: sha256(stableJson(definition)),
    evidence: structuredClone(evidence)
  };
}

function sourceMatchesDefinition(source: AcademicUnitScheduleSourceRecord, expected: NewAcademicUnitScheduleSource): boolean {
  return source.key === expected.key
    && source.definitionHash === expected.definitionHash
    && source.sourceUrl === expected.sourceUrl
    && source.sourceUrlHash === expected.sourceUrlHash
    && source.verifiedFinalUrl === expected.verifiedFinalUrl
    && source.verifiedFinalUrlHash === expected.verifiedFinalUrlHash
    && source.evidenceHash === expected.evidenceHash
    && sha256(stableJson(source.evidence)) === expected.evidenceHash;
}

export function validateFinalRevalidationEvidence(
  registryUrl: string,
  scheduleType: AcademicUnitScheduleType,
  evidence: VerifiedRegistrySourceEvidence | undefined,
  ownership: { universityId: string; unitType: "department"; scopeId: string }
): VerifiedRegistrySourceEvidence {
  if (!evidence) throw new Error("missing_final_revalidation_evidence");
  let strict: VerifiedRegistrySourceEvidence;
  try {
    strict = normalizeStrictVerifiedSourceEvidence(evidence, {
      expectedSourceType: scheduleType,
      expectedFinalUrl: registryUrl,
      expectedUniversityId: ownership.universityId,
      expectedUnitType: ownership.unitType,
      expectedScopeId: ownership.scopeId
    });
  } catch (error) {
    const code = error instanceof VerifiedSourceEvidenceError ? error.code : "";
    if (code === "EVIDENCE_SCHEMA_INVALID" || code === "EVIDENCE_VERIFIER_INVALID") {
      throw new Error("invalid_final_revalidation_schema");
    }
    if (code === "EVIDENCE_HTTP_STATUS_INVALID") throw new Error("final_revalidation_http_status_invalid");
    if (code.startsWith("EVIDENCE_PATH")) throw new Error("final_revalidation_evidence_path_invalid");
    if (code === "EVIDENCE_FINAL_URL_MISMATCH" || code === "EVIDENCE_LISTING_FINAL_URL_MISMATCH") {
      throw new Error("final_revalidation_url_mismatch");
    }
    if (code === "EVIDENCE_UNIVERSITY_ID_MISMATCH" || code === "EVIDENCE_UNIT_TYPE_MISMATCH"
      || code === "EVIDENCE_SCOPE_ID_MISMATCH" || code === "EVIDENCE_UNIVERSITY_SCOPE_MISMATCH") {
      throw new Error("final_revalidation_scope_mismatch");
    }
    if (code.startsWith("EVIDENCE_PARSER_")) throw new Error("final_revalidation_parser_evidence_invalid");
    throw new Error("final_revalidation_not_verified");
  }
  if (strict.publicationScope !== "department_specific") {
    throw new Error("final_revalidation_scope_mismatch");
  }
  const sourceUrl = normalizeEvidenceUrl(strict.sourceUrl);
  const finalUrl = normalizeEvidenceUrl(strict.finalUrl);
  const normalizedRegistryUrl = normalizeEvidenceUrl(registryUrl);
  if (normalizedRegistryUrl !== sourceUrl && normalizedRegistryUrl !== finalUrl) {
    throw new Error("final_revalidation_url_mismatch");
  }
  return { ...structuredClone(strict), sourceUrl, finalUrl };
}

function requireScheduleEvidenceAuthority(
  authority: ResolvedSourceAuthorityContext,
  evidence: VerifiedRegistrySourceEvidence
): void {
  for (const url of [evidence.sourceUrl, evidence.finalUrl, evidence.browserFinalUrl, evidence.rawFinalUrl]) {
    requireScheduleAuthority(authority, "registration", url);
  }
}

function requireScheduleAuthority(
  authority: ResolvedSourceAuthorityContext,
  boundary: "registration" | "fetch",
  sourceUrl: string,
  finalRedirectUrl?: string
) {
  requireHttpsUrl(sourceUrl);
  if (finalRedirectUrl) requireHttpsUrl(finalRedirectUrl);
  return requireSourceAuthority(authority.context, {
    boundary,
    resource: "academic_calendar",
    url: sourceUrl,
    ...(finalRedirectUrl ? { finalRedirectUrl } : {})
  });
}

function normalizeEvidenceUrl(value: string): string {
  const normalized = requireHttpsUrl(value);
  normalized.hash = "";
  return normalized.toString();
}

function requireHttpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("schedule_url_https_required");
  }
  return url;
}

export async function extractScheduleText(
  format: AcademicUnitScheduleFormat,
  body: Buffer,
  finalUrl: string,
  contentType: string
): Promise<{ text: string; parser: AcademicUnitScheduleReviewResult["parser"]; ocrRequired?: boolean }> {
  if (format === "pdf") {
    const parsed = await extractPdfBinaryText(body);
    const text = normalizeBoundedText(parsed.text);
    return { text, parser: "pdf_binary_text", ...(text.length < 20 ? { ocrRequired: true } : {}) };
  }
  if (format === "xlsx") {
    const parsed = parseOfficeDocument({ data: body, fileName: new URL(finalUrl).pathname, mimeType: contentType });
    if (parsed.kind !== "xlsx") throw new Error("schedule_xlsx_kind_mismatch");
    return { text: normalizeBoundedText(parsed.text), parser: "office_xlsx" };
  }
  if (format === "html") {
    return { text: normalizeBoundedText(htmlToScheduleText(body.toString("utf8"))), parser: "html_text" };
  }
  throw new Error("unsupported_schedule_format");
}

export function parseScheduleCandidates(text: string, scheduleType: AcademicUnitScheduleType): AcademicUnitScheduleCandidate[] {
  const candidates: AcademicUnitScheduleCandidate[] = [];
  const lines = text.split(/\r?\n/gu).slice(0, MAX_TEXT_LINES);
  for (const [index, rawLine] of lines.entries()) {
    const rawText = cleanText(rawLine).slice(0, 1_000);
    if (rawText.length < 5 || isCmsMetadataRow(rawText)) continue;
    const date = extractDate(rawText);
    const timeSearchText = rawText
      .replace(/\b[0-3]?\d[./-][01]?\d[./-](?:19|20)\d{2}\b/gu, " ")
      .replace(/\b(?:19|20)\d{2}-[01]?\d-[0-3]?\d\b/gu, " ");
    const times = [...timeSearchText.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:[-–—]\s*([01]?\d|2[0-3])[:.]([0-5]\d))?/gu)];
    const start = times[0];
    if (!start) continue;
    const startTime = `${String(start[1]).padStart(2, "0")}:${start[2]}`;
    const endTime = start[3] && start[4] ? `${String(start[3]).padStart(2, "0")}:${start[4]}` : undefined;
    const dayOfWeek = extractDayOfWeek(rawText);
    if (scheduleType === "exam_schedule" ? !date : dayOfWeek === undefined) continue;
    const title = cleanText(rawText
      .replace(/\b(?:[0-3]?\d[./-][01]?\d[./-](?:19|20)\d{2}|(?:19|20)\d{2}-[01]\d-[0-3]\d)\b/gu, " ")
      .replace(/\b(?:pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/giu, " ")
      .replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*[-–—]\s*([01]?\d|2[0-3])[:.]([0-5]\d))?/gu, " "))
      .replace(/^[\s|;,:-]+|[\s|;,:-]+$/gu, " ")
      .trim()
      .slice(0, 240);
    candidates.push({
      rowNumber: index + 1,
      rawText,
      ...(title ? { title } : {}),
      ...(date ? { date } : {}),
      ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
      startTime,
      ...(endTime ? { endTime } : {})
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return candidates;
}

function isCmsMetadataRow(value: string): boolean {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/gu, "i")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
  return /^(?:eklenme tarihi|son guncelleme(?: tarihi)?|guncellenme tarihi|yayin(?:lanma)? tarihi|added(?: date| on)?|last updated|published(?: date| on)?|modified(?: date| on)?)\b/u.test(normalized);
}

function extractDate(value: string): string | undefined {
  const iso = value.match(/\b((?:19|20)\d{2})-([01]?\d)-([0-3]?\d)\b/u);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : (() => {
        const local = value.match(/\b([0-3]?\d)[./-]([01]?\d)[./-]((?:19|20)\d{2})\b/u);
        return local ? { year: Number(local[3]), month: Number(local[2]), day: Number(local[1]) } : undefined;
      })();
  if (!parts) return undefined;
  const test = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (test.getUTCFullYear() !== parts.year || test.getUTCMonth() + 1 !== parts.month || test.getUTCDate() !== parts.day) return undefined;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function extractDayOfWeek(value: string): number | undefined {
  const match = value.match(/\b(pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/iu)?.[1];
  if (!match) return undefined;
  const normalized = match.toLocaleLowerCase("tr-TR");
  return ({ pazartesi: 1, monday: 1, salı: 2, sali: 2, tuesday: 2, çarşamba: 3, carsamba: 3, wednesday: 3,
    perşembe: 4, persembe: 4, thursday: 4, cuma: 5, friday: 5, cumartesi: 6, saturday: 6, pazar: 0, sunday: 0 } as Record<string, number>)[normalized];
}

function htmlToScheduleText(html: string): string {
  return html
    .slice(0, ACADEMIC_UNIT_SCHEDULE_MAX_RESPONSE_BYTES)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, " ")
    .replace(/<\/(?:tr|p|li|div|h[1-6])>/giu, "\n")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<\/(?:td|th)>/giu, "\t")
    .replace(/<[^>]+>/gu, " ")
    .split(/\r?\n/gu)
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join("\n");
}

function normalizeBoundedText(text: string): string {
  return text.replace(/\0/gu, " ").slice(0, 2_000_000).split(/\r?\n/gu).slice(0, MAX_TEXT_LINES).join("\n");
}

export function detectScheduleFormat(body: Buffer, url: string, contentType: string): AcademicUnitScheduleFormat {
  const mime = contentType.toLocaleLowerCase("en-US");
  const pathname = new URL(url).pathname.toLocaleLowerCase("en-US");
  if (body.subarray(0, 5).toString("ascii") === "%PDF-" || mime.includes("application/pdf") || pathname.endsWith(".pdf")) return "pdf";
  if ((body[0] === 0x50 && body[1] === 0x4b && inferOfficeDocumentKind(pathname, mime) === "xlsx")
      || mime.includes("spreadsheetml.sheet") || pathname.endsWith(".xlsx")) return "xlsx";
  if (mime.startsWith("text/html") || /^\s*<!doctype\s+html|^\s*<html\b/iu.test(body.subarray(0, 512).toString("utf8"))) return "html";
  if (mime.startsWith("image/") || isImageMagic(body)) return "image";
  return "unsupported";
}

function isImageMagic(body: Buffer): boolean {
  return (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)
    || (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    || body.subarray(0, 6).toString("ascii") === "GIF87a"
    || body.subarray(0, 6).toString("ascii") === "GIF89a";
}

function emptyReviewResult(
  outcome: AcademicUnitScheduleReviewResult["outcome"],
  reasonCode: string,
  format: AcademicUnitScheduleFormat = "unsupported"
): AcademicUnitScheduleReviewResult {
  return { outcome, format, parser: "none", reasonCode, candidateCount: 0, candidates: [], checkedAt: new Date() };
}

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isSafeEvidencePath(value: string, digest: string): boolean {
  if (value.length > 500 || value.includes("\\") || value.startsWith("/") || value.split("/").some((part) => part === "." || part === "..")) {
    return false;
  }
  return value.match(/^evidence\/(?:html|documents)\/([a-f\d]{64})\.[a-z\d.]+$/u)?.[1] === digest;
}

function isScopeOrAuthorityError(error: unknown): boolean {
  const value = error instanceof Error ? `${error.name}:${error.message}` : "";
  return /sourceauthorityerror|source_authority|scope|catalog|schedule_url_https_required/iu.test(value);
}

function publicReasonCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  const token = message.split(":", 1)[0]?.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9_]+/gu, "_");
  return token && token.length <= 100 ? token : fallback;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const defaultAcademicUnitScheduleProviders = {
  registryLoader: listVerifiedAcademicUnitSources,
  fetcher: safeOutboundRequest,
  authorityResolver: resolveSourceAuthorityContext
} as const;
