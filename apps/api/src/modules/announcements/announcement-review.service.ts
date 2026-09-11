import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  ACADEMIC_CONTENT_BODY_BLOCK_MAX_LENGTH,
  ACADEMIC_CONTENT_BODY_MAX_BLOCKS,
  ACADEMIC_CONTENT_BODY_MAX_LENGTH,
  ACADEMIC_CONTENT_SUMMARY_MAX_LENGTH
} from "../../../../../packages/shared/src/contracts.js";
import type { AdminUniversityAccess } from "../../common/authorization/admin-university-access.js";
import { AuditService } from "../audit/audit.service.js";
import { NotificationSchedulingService } from "../notifications/notifications.service.js";
import { fingerprintFor } from "./announcement-persistence.js";
import { AnnouncementIngestionService, type AnnouncementSourceReviewRequest } from "./announcement-ingestion.service.js";
import { ContentLlmSettingsService } from "./content-llm-settings.service.js";
import type {
  AnnouncementHumanOverride,
  AnnouncementItem,
  AnnouncementLlmReviewClaim,
  AnnouncementLlmReviewFailure,
  AnnouncementRepository,
  AnnouncementReviewFence,
  AnnouncementReviewItemUpdate,
  AnnouncementReviewMutationResult,
  AnnouncementReviewStatus,
  AnnouncementSourceRecord
} from "./announcements.types.js";
import { AnnouncementReviewConflictError } from "./announcements.types.js";

interface ReviewItemsQuery {
  sourceId?: string;
  reviewStatus?: AnnouncementReviewStatus;
  contentType?: "announcement" | "news" | "event";
  limit?: number;
  offset?: number;
  requiresLlmReview?: boolean;
}

interface ReviewItemInput {
  title?: string;
  summary?: string;
  body?: Array<{ type: "heading" | "paragraph" | "bullet"; text: string }>;
  studentRelevance?: AnnouncementItem["studentRelevance"];
  topic?: string;
  audience?: unknown;
  actionType?: string;
  deadline?: string;
  urgency?: string;
  reviewStatus?: AnnouncementReviewStatus;
  reviewNote?: string;
}

interface ReviewFenceInput {
  expectedSnapshotId?: string;
  expectedContentFingerprint: string;
  expectedReviewRevision?: string;
}

const supportedAudiences = new Set([
  "all_students", "prospective_students", "associate_students", "bachelor_students",
  "master_students", "doctoral_students", "graduates"
]);

const MAXIMUM_LLM_REVIEW_ATTEMPTS = 4;
const LLM_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;
const LLM_REVIEW_LEASE_MS = 90_000;
const SYNCHRONOUS_LLM_REVIEW_LIMIT = 1;

type PendingLlmReviewResult =
  | { itemId: string; status: "reviewed" }
  | { itemId: string; status: "failed"; disposition: "retry_scheduled" | "manual_review" | "stale" };

type LlmReviewAttemptResult =
  | { status: "reviewed"; item: ReturnType<typeof presentReviewItem> }
  | {
      status: "failed";
      disposition: "retry_scheduled" | "manual_review" | "stale" | "configuration_unavailable";
      error: unknown;
    };

@Injectable()
export class AnnouncementReviewService {
  constructor(
    @Inject("AnnouncementRepository") private readonly announcementRepository: AnnouncementRepository,
    @Inject(AnnouncementIngestionService) private readonly ingestionService: AnnouncementIngestionService,
    @Inject(ContentLlmSettingsService) private readonly llmService: ContentLlmSettingsService,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Optional() @Inject(NotificationSchedulingService)
    private readonly notificationSchedulingService?: NotificationSchedulingService
  ) {}

  async approveSource(access: AdminUniversityAccess, sourceId: string, actorId: string, input: AnnouncementSourceReviewRequest) {
    const note = normalizedNote(input.note);
    const { note: _inputNote, ...fence } = input;
    void _inputNote;
    const result = await this.ingestionService.approveSourceForAdmin(access, sourceId, actorId, {
      ...fence,
      ...(note ? { note } : {})
    });
    await this.auditService.record({
      actorId,
      action: "announcement_source.approved",
      entityType: "announcement_source",
      entityId: sourceId,
      metadata: { noteProvided: Boolean(note?.trim()) }
    });
    return result;
  }

  async rejectSource(access: AdminUniversityAccess, sourceId: string, actorId: string, input: AnnouncementSourceReviewRequest) {
    const note = normalizedNote(input.note);
    const { note: _inputNote, ...fence } = input;
    void _inputNote;
    const source = await this.ingestionService.rejectSourceForAdmin(access, sourceId, actorId, {
      ...fence,
      ...(note ? { note } : {})
    });
    await this.auditService.record({
      actorId,
      action: "announcement_source.rejected",
      entityType: "announcement_source",
      entityId: sourceId,
      metadata: { noteProvided: Boolean(note?.trim()) }
    });
    return source;
  }

  async listItems(access: AdminUniversityAccess, query: ReviewItemsQuery) {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    let sources: AnnouncementSourceRecord[];
    let sourceIds: string[] | undefined;
    if (query.sourceId) {
      const source = await this.ingestionService.getSourceForAdminAccess(access, query.sourceId);
      sources = [source];
      sourceIds = [source.id];
    } else if (access.kind === "global") {
      // Avoid loading/truncating the complete source registry for a global
      // review queue. The repository can page active snapshots directly.
      sources = [];
    } else {
      sources = await this.listAllAccessibleSources(access);
      sourceIds = sources.map((source) => source.id);
    }
    const sourceById = new Map(sources.map((source) => [source.id, source] as const));
    const filtered: AnnouncementItem[] = [];
    const pageSize = 1_000;
    let scanOffset = 0;
    let exhausted = Boolean(sourceIds && sourceIds.length === 0);
    while (!exhausted && filtered.length < offset + limit + 1) {
      const page = await this.announcementRepository.listReviewItems({
        ...(sourceIds ? { sourceIds } : {}),
        limit: pageSize,
        offset: scanOffset
      });
      filtered.push(...page.filter((item) => matchesReviewQuery(item, query)));
      scanOffset += page.length;
      exhausted = page.length < pageSize;
    }
    const visibleItems = filtered.slice(offset, offset + limit);
    const missingSourceIds = [...new Set(visibleItems.map((item) => item.sourceId))]
      .filter((sourceId) => !sourceById.has(sourceId));
    const missingSources = await Promise.all(missingSourceIds.map((sourceId) =>
      this.announcementRepository.findSourceById(sourceId)));
    for (const source of missingSources) {
      if (source) sourceById.set(source.id, source);
    }
    return {
      items: visibleItems.map((item) => presentReviewItem(item, sourceById.get(item.sourceId))),
      total: exhausted ? filtered.length : offset + visibleItems.length + 1,
      limit,
      offset,
      hasMore: filtered.length > offset + limit || !exhausted
    };
  }

  async updateItem(
    access: AdminUniversityAccess,
    itemId: string,
    input: ReviewItemInput & ReviewFenceInput,
    actorId: string
  ) {
    const existing = await this.requireAccessibleItem(access, itemId);
    const fence = reviewFenceFrom(input);
    assertCurrentFence(existing.item, fence);
    const effective = normalizeReviewUpdate(input);
    const overrideFields = pickHumanOverride(effective);
    const overridesChanged = humanOverrideChanged(existing.item, overrideFields);
    if (Object.keys(overrideFields).length > 0 && effective.reviewStatus === undefined) {
      effective.reviewStatus = "pending_review";
    }
    const update: AnnouncementReviewItemUpdate = {
      ...effective,
      ...(Object.keys(overrideFields).length > 0
        ? {
            humanOverride: { ...(existing.item.humanOverride ?? {}), ...overrideFields },
            ...(overridesChanged ? { llmClassification: null, llmReviewFailure: null } : {})
          }
        : {}),
      llmReviewClaim: null,
      ...(effective.reviewStatus === "approved" || effective.reviewStatus === "rejected"
        ? { reviewedBy: actorId, reviewedAt: new Date().toISOString() }
        : effective.reviewStatus === "pending_review"
          ? { reviewedBy: null, reviewedAt: null }
          : {})
    };
    const mutation = await this.persistReviewMutation(itemId, update, fence);
    await this.syncReviewNotifications(mutation);
    await this.auditService.record({
      actorId,
      action: "announcement_review_item.updated",
      entityType: "announcement_item",
      entityId: itemId,
      metadata: {
        sourceId: existing.source.id,
        fields: Object.keys(effective).sort(),
        reviewStatus: mutation.item.reviewStatus ?? "pending_review"
      }
    });
    return presentReviewItem(mutation.item, mutation.source);
  }

  async runLlmReview(
    access: AdminUniversityAccess,
    itemId: string,
    input: ReviewFenceInput,
    actorId: string
  ) {
    await this.llmService.assertReviewReady();
    const result = await this.attemptLlmReview(access, itemId, input, actorId);
    if (result.status === "failed") throw result.error;
    return result.item;
  }

  private async attemptLlmReview(
    access: AdminUniversityAccess,
    itemId: string,
    input: ReviewFenceInput,
    actorId: string
  ): Promise<LlmReviewAttemptResult> {
    const existing = await this.requireAccessibleItem(access, itemId);
    const fence = reviewFenceFrom(input);
    assertCurrentFence(existing.item, fence);
    if ((existing.item.reviewStatus ?? "pending_review") !== "pending_review") {
      throw new ConflictException("Only pending review items can be analyzed by the LLM.");
    }
    if (hasActiveLlmReviewClaim(existing.item)) {
      throw new ConflictException("Announcement is already being analyzed by the LLM.");
    }

    const claimedAt = new Date();
    const claim: AnnouncementLlmReviewClaim = {
      ownerId: randomUUID(),
      claimedAt: claimedAt.toISOString(),
      expiresAt: new Date(claimedAt.getTime() + LLM_REVIEW_LEASE_MS).toISOString()
    };
    const claimed = await this.persistReviewMutation(itemId, { llmReviewClaim: claim }, fence);
    const claimedFence = reviewFenceForItem(claimed.item);
    try {
      await this.syncReviewNotifications(claimed);
    } catch (error) {
      await this.releaseLlmReviewClaim(itemId, claimedFence);
      throw error;
    }

    let llmClassification;
    try {
      llmClassification = await this.llmService.classify(claimed.item);
    } catch (error) {
      if (llmErrorStatus(error) === 400) {
        const released = await this.releaseLlmReviewClaim(itemId, claimedFence);
        return released
          ? { status: "failed", disposition: "configuration_unavailable", error }
          : { status: "failed", disposition: "stale", error: reviewConflict() };
      }
      const failure = nextLlmReviewFailure(existing.item.llmReviewFailure, error, new Date());
      try {
        const failed = await this.persistReviewMutation(itemId, {
          llmReviewClaim: null,
          llmReviewFailure: failure
        }, claimedFence);
        await this.syncReviewNotifications(failed);
        return { status: "failed", disposition: failure.disposition, error };
      } catch (persistenceError) {
        if (llmErrorStatus(persistenceError) === 409) {
          return { status: "failed", disposition: "stale", error: persistenceError };
        }
        throw persistenceError;
      }
    }

    const mutation = await this.persistReviewMutation(itemId, {
      llmClassification: {
        ...llmClassification,
        inputContentFingerprint: fingerprintFor(claimed.item),
        ...(claimed.item.reviewRevision ? { inputReviewRevision: claimed.item.reviewRevision } : {})
      },
      llmReviewFailure: null,
      llmReviewClaim: null
    }, claimedFence);
    await this.syncReviewNotifications(mutation);
    await this.auditService.record({
      actorId,
      action: "announcement_review_item.llm_reviewed",
      entityType: "announcement_item",
      entityId: itemId,
      metadata: {
        sourceId: existing.source.id,
        provider: llmClassification.provider,
        model: llmClassification.model,
        confidence: llmClassification.confidence
      }
    });
    return { status: "reviewed", item: presentReviewItem(mutation.item, mutation.source) };
  }

  async runPendingLlmReviews(access: AdminUniversityAccess, actorId: string, limit = 1) {
    await this.llmService.assertReviewReady();
    const boundedLimit = Math.min(Math.max(limit, 1), SYNCHRONOUS_LLM_REVIEW_LIMIT);
    const queue = await this.listItems(access, {
      reviewStatus: "pending_review",
      requiresLlmReview: true,
      limit: boundedLimit,
      offset: 0
    });
    const candidates = queue.items;
    const results: PendingLlmReviewResult[] = [];
    for (const queuedItem of candidates) {
      let item: AnnouncementItem;
      try {
        const current = await this.requireAccessibleItem(access, queuedItem.id);
        item = current.item;
      } catch (error) {
        if (!isStaleReviewRaceError(error)) throw error;
        results.push({ itemId: queuedItem.id, status: "failed", disposition: "stale" });
        continue;
      }
      if ((item.reviewStatus ?? "pending_review") !== "pending_review" || !isLlmReviewReady(item)) {
        results.push({ itemId: item.id, status: "failed", disposition: "stale" });
        continue;
      }
      const fence = {
        ...(item.snapshotId ? { expectedSnapshotId: item.snapshotId } : {}),
        expectedContentFingerprint: item.contentFingerprint ?? fingerprintFor(item),
        ...(item.reviewRevision ? { expectedReviewRevision: item.reviewRevision } : {})
      };
      try {
        const result = await this.attemptLlmReview(access, item.id, fence, actorId);
        if (result.status === "reviewed") {
          results.push({ itemId: item.id, status: "reviewed" });
          continue;
        }
        if (result.disposition === "configuration_unavailable") throw result.error;
        results.push({ itemId: item.id, status: "failed", disposition: result.disposition });
      } catch (error) {
        if (!isStaleReviewRaceError(error)) throw error;
        results.push({ itemId: item.id, status: "failed", disposition: "stale" });
      }
    }
    return {
      processed: results.length,
      reviewed: results.filter((result) => result.status === "reviewed").length,
      failed: results.filter((result) => result.status === "failed").length,
      hasMore: queue.hasMore || results.some((result) => result.status === "failed" && result.disposition === "stale"),
      results
    };
  }

  private async requireAccessibleItem(access: AdminUniversityAccess, itemId: string) {
    const result = await this.announcementRepository.findReviewItemById(itemId);
    if (!result) throw new NotFoundException("Announcement review item not found.");
    await this.ingestionService.getSourceForAdminAccess(access, result.source.id);
    return result;
  }

  private async persistReviewMutation(
    itemId: string,
    update: AnnouncementReviewItemUpdate,
    fence: AnnouncementReviewFence
  ): Promise<AnnouncementReviewMutationResult> {
    try {
      const mutation = await this.announcementRepository.updateReviewItem(itemId, update, fence);
      if (!mutation) throw new NotFoundException("Announcement review item not found.");
      return mutation;
    } catch (error) {
      if (error instanceof AnnouncementReviewConflictError) {
        throw new ConflictException("Announcement changed after it was loaded. Refresh the review item and retry.");
      }
      throw error;
    }
  }

  private async releaseLlmReviewClaim(itemId: string, fence: AnnouncementReviewFence): Promise<boolean> {
    try {
      const mutation = await this.persistReviewMutation(itemId, { llmReviewClaim: null }, fence);
      await this.syncReviewNotifications(mutation);
      return true;
    } catch (error) {
      if (llmErrorStatus(error) === 409) return false;
      throw error;
    }
  }

  private async syncReviewNotifications(mutation: AnnouncementReviewMutationResult): Promise<void> {
    if (!this.notificationSchedulingService) return;
    await this.notificationSchedulingService.syncTrustedAnnouncementSource(mutation.source, mutation.delta);
  }

  private async listAllAccessibleSources(access: AdminUniversityAccess): Promise<AnnouncementSourceRecord[]> {
    const sources: AnnouncementSourceRecord[] = [];
    const pageSize = 1_000;
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.ingestionService.listSourcesForAdmin(access, {
        status: "active",
        limit: pageSize,
        offset
      });
      sources.push(...page);
      if (page.length < pageSize) return sources;
    }
  }
}

function matchesReviewQuery(item: AnnouncementItem, query: ReviewItemsQuery): boolean {
  const reviewStatus = item.reviewStatus ?? "pending_review";
  return (!query.reviewStatus || reviewStatus === query.reviewStatus)
    && (!query.contentType || (item.contentType ?? "announcement") === query.contentType)
    && (!query.requiresLlmReview || isLlmReviewReady(item));
}

function isLlmReviewReady(item: AnnouncementItem): boolean {
  if (hasActiveLlmReviewClaim(item)) return false;
  if (item.llmClassification) return false;
  const failure = item.llmReviewFailure;
  if (!failure) return true;
  if (failure.disposition === "manual_review") return false;
  const retryAt = failure.retryAfter ? Date.parse(failure.retryAfter) : Number.NaN;
  return !Number.isFinite(retryAt) || retryAt <= Date.now();
}

function hasActiveLlmReviewClaim(item: AnnouncementItem, now = Date.now()): boolean {
  const expiresAt = Date.parse(item.llmReviewClaim?.expiresAt ?? "");
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function nextLlmReviewFailure(
  previous: AnnouncementLlmReviewFailure | null | undefined,
  error: unknown,
  attemptedAt: Date
): AnnouncementLlmReviewFailure {
  const previousAttempts = Number.isSafeInteger(previous?.attemptCount)
    ? Math.min(Math.max(previous!.attemptCount, 0), MAXIMUM_LLM_REVIEW_ATTEMPTS - 1)
    : 0;
  const attemptCount = previousAttempts + 1;
  const lastAttemptedAt = attemptedAt.toISOString();
  if (llmErrorStatus(error) === 422) {
    return {
      disposition: "manual_review",
      reasonCode: "provider_refusal",
      attemptCount,
      lastAttemptedAt
    };
  }
  if (attemptCount >= MAXIMUM_LLM_REVIEW_ATTEMPTS) {
    return {
      disposition: "manual_review",
      reasonCode: "retry_exhausted",
      attemptCount: MAXIMUM_LLM_REVIEW_ATTEMPTS,
      lastAttemptedAt
    };
  }
  const delayMs = LLM_RETRY_DELAYS_MS[attemptCount - 1] ?? LLM_RETRY_DELAYS_MS.at(-1)!;
  return {
    disposition: "retry_scheduled",
    reasonCode: llmErrorStatus(error) === 400 ? "configuration_unavailable" : "provider_unavailable",
    attemptCount,
    lastAttemptedAt,
    retryAfter: new Date(attemptedAt.getTime() + delayMs).toISOString()
  };
}

function llmErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("getStatus" in error) || typeof error.getStatus !== "function") {
    return undefined;
  }
  try {
    const status = error.getStatus();
    return typeof status === "number" ? status : undefined;
  } catch {
    return undefined;
  }
}

function isStaleReviewRaceError(error: unknown): boolean {
  const status = llmErrorStatus(error);
  return status === 404 || status === 409;
}

function normalizeReviewUpdate(input: ReviewItemInput): AnnouncementReviewItemUpdate {
  if (input.deadline !== undefined && !isCalendarDateOrUnknown(input.deadline)) {
    throw new BadRequestException("Deadline must be 'unknown' or a real calendar date.");
  }
  if (input.summary !== undefined && input.summary.length > ACADEMIC_CONTENT_SUMMARY_MAX_LENGTH) {
    throw new BadRequestException(`Announcement summary must not exceed ${ACADEMIC_CONTENT_SUMMARY_MAX_LENGTH} characters.`);
  }
  if (input.body !== undefined && input.body.length > ACADEMIC_CONTENT_BODY_MAX_BLOCKS) {
    throw new BadRequestException(`Announcement body must not exceed ${ACADEMIC_CONTENT_BODY_MAX_BLOCKS} blocks.`);
  }
  const audience = input.audience === undefined ? undefined : normalizeAudience(input.audience);
  const body = input.body?.map((block) => {
    if (block.text.length > ACADEMIC_CONTENT_BODY_BLOCK_MAX_LENGTH) {
      throw new BadRequestException(`Announcement body blocks must not exceed ${ACADEMIC_CONTENT_BODY_BLOCK_MAX_LENGTH} characters.`);
    }
    return { ...block, text: block.text.trim() };
  }).filter((block) => block.text);
  const bodyLength = body?.reduce((total, block) => total + block.text.length, 0) ?? 0;
  if (bodyLength > ACADEMIC_CONTENT_BODY_MAX_LENGTH) {
    throw new BadRequestException(`Announcement body must not exceed ${ACADEMIC_CONTENT_BODY_MAX_LENGTH} characters.`);
  }
  const values: AnnouncementReviewItemUpdate = {
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.summary !== undefined ? { summary: input.summary.trim() } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(input.studentRelevance !== undefined ? { studentRelevance: input.studentRelevance } : {}),
    ...(input.topic !== undefined ? { topic: input.topic as AnnouncementItem["topic"] } : {}),
    ...(audience !== undefined ? { audience } : {}),
    ...(input.actionType !== undefined ? { actionType: input.actionType as AnnouncementItem["actionType"] } : {}),
    ...(input.deadline !== undefined ? { deadline: input.deadline as AnnouncementItem["deadline"] } : {}),
    ...(input.urgency !== undefined ? { urgency: input.urgency as AnnouncementItem["urgency"] } : {}),
    ...(input.reviewStatus !== undefined ? { reviewStatus: input.reviewStatus } : {}),
    ...(input.reviewNote !== undefined ? { reviewNote: input.reviewNote.trim() } : {})
  };
  if (values.title !== undefined && values.title.length < 2) throw new BadRequestException("Announcement title is too short.");
  if (Object.keys(values).length === 0) throw new BadRequestException("At least one review field is required.");
  return values;
}

function normalizeAudience(value: unknown): AnnouncementItem["audience"] {
  if (value === "unknown") return "unknown";
  if (!Array.isArray(value) || value.length === 0 || value.length > supportedAudiences.size) {
    throw new BadRequestException("Audience must be 'unknown' or a supported audience list.");
  }
  const entries = [...new Set(value)];
  if (entries.some((entry) => typeof entry !== "string" || !supportedAudiences.has(entry))) {
    throw new BadRequestException("Audience contains an unsupported value.");
  }
  return entries as Exclude<AnnouncementItem["audience"], "unknown" | undefined>;
}

function pickHumanOverride(input: AnnouncementReviewItemUpdate): AnnouncementHumanOverride {
  const fields = ["title", "summary", "body", "studentRelevance", "topic", "audience", "actionType", "deadline", "urgency"] as const;
  return Object.fromEntries(fields.flatMap((field) => input[field] !== undefined ? [[field, input[field]]] : [])) as AnnouncementHumanOverride;
}

function humanOverrideChanged(item: AnnouncementItem, override: AnnouncementHumanOverride): boolean {
  return Object.entries(override).some(([field, value]) =>
    JSON.stringify(item[field as keyof AnnouncementItem]) !== JSON.stringify(value));
}

function presentReviewItem(item: AnnouncementItem, source?: AnnouncementSourceRecord) {
  const { llmReviewClaim, ...visibleItem } = item;
  return {
    ...visibleItem,
    contentFingerprint: item.contentFingerprint ?? fingerprintFor(item),
    reviewStatus: item.reviewStatus ?? "pending_review",
    status: item.reviewStatus ?? "pending_review",
    llmReviewInFlight: hasActiveLlmReviewClaim(item),
    sourceUrl: source?.canonicalUrl ?? source?.sourceUrl ?? item.officialSourceUrl
  };
}

function reviewFenceFrom(input: ReviewFenceInput): AnnouncementReviewFence {
  const expectedSnapshotId = normalizedFenceValue(input.expectedSnapshotId);
  const expectedReviewRevision = normalizedFenceValue(input.expectedReviewRevision);
  return {
    ...(expectedSnapshotId ? { expectedSnapshotId } : {}),
    expectedContentFingerprint: input.expectedContentFingerprint.trim().toLowerCase(),
    ...(expectedReviewRevision ? { expectedReviewRevision } : {})
  };
}

function reviewFenceForItem(item: AnnouncementItem): AnnouncementReviewFence {
  return {
    ...(item.snapshotId ? { expectedSnapshotId: item.snapshotId } : {}),
    expectedContentFingerprint: item.contentFingerprint ?? fingerprintFor(item),
    ...(item.reviewRevision ? { expectedReviewRevision: item.reviewRevision } : {})
  };
}

function reviewConflict(): ConflictException {
  return new ConflictException("Announcement changed after it was loaded. Refresh the review item and retry.");
}

function assertCurrentFence(item: AnnouncementItem, fence: AnnouncementReviewFence): void {
  const currentSnapshotId = normalizedFenceValue(item.snapshotId);
  const currentReviewRevision = normalizedFenceValue(item.reviewRevision);
  if (
    currentSnapshotId !== normalizedFenceValue(fence.expectedSnapshotId)
    || (item.contentFingerprint ?? fingerprintFor(item)) !== fence.expectedContentFingerprint
    || currentReviewRevision !== normalizedFenceValue(fence.expectedReviewRevision)
  ) {
    throw new ConflictException("Announcement changed after it was loaded. Refresh the review item and retry.");
  }
}

function normalizedFenceValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function isCalendarDateOrUnknown(value: string): boolean {
  if (value === "unknown") return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizedNote(note: string | undefined): string | undefined {
  const normalized = note?.trim();
  return normalized || undefined;
}
