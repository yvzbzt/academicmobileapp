import type {
  AcademicContentBodyBlockDto,
  AcademicContentFreshness,
  AcademicContentKeyDateDto,
  AcademicContentPublicationKind,
  AcademicContentScopeType,
  AcademicContentType,
  TrustedAcademicContentDto
} from "../../../../../packages/shared/src/contracts.js";
import type { SourceAuthorityReasonCode } from "../../domain/source-authority-policy.js";
import type { StudentRelevanceMetadata } from "../../domain/student-relevance-classifier.js";
import type { StrictVerifiedSourceEvidence } from "../../bootstrap/verified-source-evidence.js";

export type AnnouncementScopeType = AcademicContentScopeType;
export type AnnouncementContentType = AcademicContentType;
export type AnnouncementSourceParser = "auto" | "rss" | "html";
export interface AnnouncementSourceParserConfig {
  /** CSS selector for each row/card on the listing page. */
  itemSelector?: string;
  /** CSS selector, relative to the item, containing the title. */
  titleSelector?: string;
  /** CSS selector, relative to the item, containing the href. */
  linkSelector?: string;
  /** CSS selector, relative to the item, containing the publication date. */
  dateSelector?: string;
  eventDateSelector?: string;
  /** CSS selector, relative to the item, containing summary/body text. */
  contentSelector?: string;
}
export type AnnouncementSourceStatus = "active" | "inactive";
export type AnnouncementSourceHealthStatus = "pending" | "healthy" | "degraded" | "failed";
export type AnnouncementTrustStatus = "trusted" | "rejected" | "quarantined";
export type AnnouncementAdminTrustStatus = AnnouncementTrustStatus | "pending_review";
export type AnnouncementReviewStatus = "pending_review" | "approved" | "rejected";
export type AnnouncementTrustReason = SourceAuthorityReasonCode
  | "navigation_or_chrome"
  | "unsafe_url"
  | "unofficial_source"
  | "missing_source"
  | "invalid_timestamp"
  | "duplicate_canonical_url"
  | "legacy_crawl_time_removed"
  | "unverified_source_time_removed"
  | "preview_failed";

export interface AnnouncementFallbackItem {
  title: string;
  rawTitle?: string;
  link: string;
  publishedAt?: Date;
  publishedDate?: string;
  publicationKind?: AcademicContentPublicationKind;
  sourceUpdatedAt?: Date;
  discoveredAt?: Date;
  summary?: string;
  body?: AcademicContentBodyBlockDto[];
  keyDates?: AcademicContentKeyDateDto[];
}

export interface AnnouncementSourceRecord {
  id: string;
  scopeType: AnnouncementScopeType;
  scopeId: string;
  /** Immutable catalog owner used to resolve source authority without a national catalog scan. */
  ownerUniversityId?: string;
  /** Immutable faculty owner for department-scoped sources. */
  ownerFacultyId?: string;
  sourceName: string;
  sourceUrl: string;
  canonicalUrl?: string;
  contentType?: AnnouncementContentType;
  parser: AnnouncementSourceParser;
  parserConfig?: AnnouncementSourceParserConfig;
  priority: number;
  status: AnnouncementSourceStatus;
  homepageUrl?: string;
  discoveryMethod?: "catalog_website" | "domain_candidate" | "manual";
  healthStatus?: AnnouncementSourceHealthStatus;
  lastCheckedAt?: Date;
  lastSuccessAt?: Date;
  lastError?: string;
  consecutiveFailures?: number;
  itemCount?: number;
  etag?: string;
  lastModified?: string;
  contentHash?: string;
  lastContentChangedAt?: Date;
  /**
   * Daily device-manifest safety probe. These validators deliberately do not
   * share state with ingestion: a probe must never make a later ingestion
   * request incorrectly accept a stale 304 response.
   */
  healthProbe?: AnnouncementSourceHealthProbe;
  /** Atomic pointer to the complete student-visible snapshot. Missing on legacy sources. */
  activeSnapshotId?: string;
  /** Monotonic CAS generation for every snapshot activation or invalidation. Legacy sources are generation zero. */
  snapshotStateRevision?: number;
  /** Repository-owned, expiring two-phase activation intent. */
  pendingSnapshotId?: string;
  pendingSnapshotRevision?: number;
  pendingSnapshotExpiresAt?: Date;
  /** Monotonic fence for reservations, takeovers, and intent invalidation. */
  snapshotIntentRevision?: number;
  /** Opaque fence rotated whenever URL/parser/content type changes. Missing on legacy sources. */
  sourceDefinitionVersion?: string;
  /** Opaque fence rotated only when a trusted source is reactivated. */
  notificationProducerVersion?: string;
  processingVersion?: string;
  fetchIntervalMinutes?: number;
  fallbackItems?: AnnouncementFallbackItem[];
  discoveredAt?: Date;
  trustStatus?: AnnouncementTrustStatus;
  /**
   * True only while an administrator-requested approval is being health
   * checked. Pending sources are internal staging records and must not be
   * returned by any student-visible or notification-producing read.
   */
  approvalPending?: boolean;
  trustReasonCodes?: AnnouncementTrustReason[];
  duplicateOfId?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNote?: string;
  verificationEvidence?: AnnouncementSourceVerificationEvidence;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnnouncementSourceHealthProbe {
  /** Exact device parser/fetch implementation that produced this probe. */
  engineVersion?: string;
  healthStatus: AnnouncementSourceHealthStatus;
  lastCheckedAt: Date;
  /** Last unconditional Istanbul-day safety parse; revision polls never advance it. */
  lastFullCheckedAt?: Date;
  lastSuccessAt?: Date;
  lastError?: string;
  consecutiveFailures: number;
  itemCount?: number;
  etag?: string;
  lastModified?: string;
  contentHash?: string;
  lastContentChangedAt?: Date;
}

export interface UniversityCalendarSourceProfileRecord {
  id: string;
  universityId: string;
  sourceUrl: string;
  parser: AnnouncementSourceParser;
  parserConfig?: AnnouncementSourceParserConfig;
  status: AnnouncementSourceStatus;
  healthStatus?: AnnouncementSourceHealthStatus;
  lastCheckedAt?: Date;
  lastSuccessAt?: Date;
  lastError?: string;
  itemCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type UpsertUniversityCalendarSourceProfileInput = Omit<UniversityCalendarSourceProfileRecord, "id" | "createdAt" | "updatedAt">;

export interface AnnouncementSourceVerificationEvidence extends Omit<StrictVerifiedSourceEvidence, "sourceType"> {
  sourceType: AnnouncementContentType | "academic_calendar" | "course_schedule" | "exam_schedule";
  parserProfile?: AnnouncementSourceParser;
}

export interface AnnouncementSourceVerificationSampleDetail {
  url: string;
  finalUrl?: string;
  title?: string;
  status: "verified" | "rejected" | "blocked" | "request_failed";
  httpStatus?: number;
  reasonCodes?: string[];
}

export interface AnnouncementSourceVerificationAttachResult {
  source: AnnouncementSourceRecord;
  outcome: "attached" | "unchanged" | "conflict";
}

export type AnnouncementSourceScope = Pick<AnnouncementSourceRecord, "scopeType" | "scopeId">;

export interface AnnouncementItem extends Partial<StudentRelevanceMetadata> {
  id: string;
  sourceId: string;
  /** Internal persistence pointer; omitted on legacy rows. */
  snapshotId?: string;
  sourceName: string;
  contentType?: AnnouncementContentType;
  scopeType: AnnouncementScopeType;
  scopeId: string;
  title: string;
  rawTitle?: string;
  link: string;
  canonicalUrl?: string;
  canonicalUrlAliases?: string[];
  officialSourceUrl?: string;
  contentFingerprint?: string;
  /** Machine-content plus deterministic-classifier fence used to invalidate stale human approval. */
  adjudicationFingerprint?: string;
  notificationEligibleFingerprint?: string;
  notificationProducedFingerprint?: string;
  publicationKind?: AcademicContentPublicationKind;
  publishedDate?: string;
  publishedAt?: string;
  publicationTimeSource?: "source";
  sourceUpdatedAt?: string;
  sourceUpdateTimeSource?: "source";
  discoveredAt?: string;
  summary?: string;
  body?: AcademicContentBodyBlockDto[];
  keyDates?: AcademicContentKeyDateDto[];
  fetchedAt?: string;
  freshness?: AcademicContentFreshness;
  trustStatus?: AnnouncementTrustStatus;
  trustReasonCodes?: AnnouncementTrustReason[];
  dedupeKey?: string;
  duplicateOfId?: string;
  reviewStatus?: AnnouncementReviewStatus;
  /** Opaque compare-and-swap fence rotated by every human or LLM review write. */
  reviewRevision?: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string;
  humanOverride?: AnnouncementHumanOverride;
  llmClassification?: AnnouncementLlmClassification | null;
  /** Bounded, non-sensitive scheduling state for failed automated LLM review attempts. */
  llmReviewFailure?: AnnouncementLlmReviewFailure | null;
  /** Short-lived distributed lease; never expose its owner token to admin clients. */
  llmReviewClaim?: AnnouncementLlmReviewClaim | null;
}

export interface AnnouncementHumanOverride extends Partial<Pick<
  AnnouncementItem,
  "title" | "summary" | "body" | "studentRelevance" | "topic" | "audience" | "actionType" | "deadline" | "urgency"
>> {}

export interface AnnouncementLlmClassification extends Partial<Pick<
  AnnouncementItem,
  "studentRelevance" | "topic" | "audience" | "actionType" | "deadline" | "urgency"
>> {
  provider: "openai";
  model: string;
  confidence: number;
  rationale: string;
  analyzedAt: string;
  /** Machine-content inputs used for the classification; useful for audit/debugging. */
  inputContentFingerprint?: string;
  inputReviewRevision?: string;
}

export interface AnnouncementLlmReviewFailure {
  disposition: "retry_scheduled" | "manual_review";
  reasonCode: "provider_unavailable" | "provider_refusal" | "configuration_unavailable" | "retry_exhausted";
  /** Saturating counter; persistence and service code cap it at four attempts. */
  attemptCount: number;
  lastAttemptedAt: string;
  retryAfter?: string;
}

export interface AnnouncementLlmReviewClaim {
  ownerId: string;
  claimedAt: string;
  expiresAt: string;
}

export interface AnnouncementReviewFence {
  /** Missing only for the legacy row store. */
  expectedSnapshotId?: string;
  expectedContentFingerprint: string;
  /** Missing only for records created before review CAS was introduced. */
  expectedReviewRevision?: string;
}

export interface AnnouncementReviewItemUpdate {
  title?: string;
  summary?: string;
  body?: AcademicContentBodyBlockDto[];
  studentRelevance?: AnnouncementItem["studentRelevance"];
  topic?: AnnouncementItem["topic"];
  audience?: AnnouncementItem["audience"];
  actionType?: AnnouncementItem["actionType"];
  deadline?: AnnouncementItem["deadline"];
  urgency?: AnnouncementItem["urgency"];
  reviewStatus?: AnnouncementReviewStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string;
  humanOverride?: AnnouncementHumanOverride;
  llmClassification?: AnnouncementLlmClassification | null;
  llmReviewFailure?: AnnouncementLlmReviewFailure | null;
  llmReviewClaim?: AnnouncementLlmReviewClaim | null;
}

export interface AnnouncementReviewMutationResult {
  item: AnnouncementItem;
  source: AnnouncementSourceRecord;
  delta: AnnouncementPersistenceDelta;
}

export class AnnouncementReviewConflictError extends Error {
  constructor() {
    super("ANNOUNCEMENT_REVIEW_SNAPSHOT_CONFLICT");
    this.name = "AnnouncementReviewConflictError";
  }
}

export type MobileAnnouncementItem = TrustedAcademicContentDto;

export type UpsertAnnouncementSourceInput = Omit<AnnouncementSourceRecord, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type AnnouncementSourceCandidateInput = Omit<
  UpsertAnnouncementSourceInput,
  "id" | "status" | "trustStatus" | "duplicateOfId"
>;
export type SourceCheckInput = Pick<
  AnnouncementSourceRecord,
  | "healthStatus"
  | "lastCheckedAt"
  | "lastSuccessAt"
  | "lastError"
  | "consecutiveFailures"
  | "itemCount"
  | "etag"
  | "lastModified"
  | "contentHash"
  | "lastContentChangedAt"
  | "processingVersion"
>;

export type SourceHealthProbeInput = AnnouncementSourceHealthProbe;

export type AnnouncementSourceDefinitionFence = Pick<
  AnnouncementSourceRecord,
  "sourceUrl" | "parser" | "parserConfig" | "contentType" | "sourceDefinitionVersion" | "notificationProducerVersion" | "approvalPending" | "reviewedAt"
>;

export function sameAnnouncementSourceParserConfig(
  left: AnnouncementSourceParserConfig | undefined,
  right: AnnouncementSourceParserConfig | undefined
): boolean {
  const keys = ["itemSelector", "titleSelector", "linkSelector", "dateSelector", "eventDateSelector", "contentSelector"] as const;
  return keys.every((key) => (left?.[key]?.trim() || undefined) === (right?.[key]?.trim() || undefined));
}

export interface AnnouncementSourceReviewFence {
  /** Empty means the reviewer observed a legacy source without a definition generation. */
  expectedSourceDefinitionVersion?: string;
  expectedCanonicalUrl: string;
  /** Exact persisted URL observed by trusted server code; supports legacy non-canonical records without weakening CAS. */
  expectedSourceUrl?: string;
  expectedTrustStatus: AnnouncementTrustStatus;
  expectedSourceStatus: AnnouncementSourceStatus;
  /** Exact pending state observed by the reviewer; prevents duplicate approval leases. */
  expectedApprovalPending: boolean;
  /**
   * Internal repository fence for the review/approval lease timestamp. `null`
   * means the caller observed no timestamp; omitted is reserved for trusted
   * internal migrations/tests that intentionally do not fence this field.
   */
  expectedReviewedAt?: Date | null;
}

export interface AnnouncementSourceEditFence extends AnnouncementSourceReviewFence {
  /** Exact source revision observed by the editor; prevents stale metadata overwrites. */
  expectedUpdatedAt: Date;
}

export interface AnnouncementSourceReviewMutation {
  decision: "approve" | "reject" | "quarantine";
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNote?: string;
  trustReasonCodes?: AnnouncementTrustReason[];
}

export interface AnnouncementAdminSourceListQuery {
  status?: AnnouncementSourceStatus;
  /** Admin presentation status. `pending_review` maps to the approval staging fence. */
  trustStatus?: AnnouncementAdminTrustStatus;
  contentType?: AnnouncementContentType;
  scopeType?: AnnouncementScopeType;
  search?: string;
  limit: number;
  offset: number;
}

export interface AnnouncementPersistenceReference {
  id: string;
  sourceId: string;
  /** Snapshot that produced this reference. Missing for legacy rows. */
  snapshotId?: string;
  scopeType: AnnouncementScopeType;
  scopeId: string;
  canonicalUrl: string;
  contentFingerprint: string;
}

export interface AnnouncementPersistenceDelta {
  created: AnnouncementPersistenceReference[];
  materiallyUpdated: AnnouncementPersistenceReference[];
  unchanged: AnnouncementPersistenceReference[];
  removed: AnnouncementPersistenceReference[];
  /** Snapshot made visible by this write. Missing for legacy/in-memory persistence. */
  snapshotId?: string;
  /** Snapshot that was visible when this write began. Missing for the legacy row store. */
  previousSnapshotId?: string;
}

export interface AnnouncementReplacementOptions {
  /** Fetch and parser succeeded and authoritatively reported zero source rows. */
  authoritativeEmpty?: boolean;
}

export interface SavedAnnouncementRecord {
  id: string;
  userId: string;
  announcementId: string;
  savedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedAnnouncementStatus {
  announcementId: string;
  saved: boolean;
  savedAt?: string;
}

export interface AnnouncementRepository {
  listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]>;
  listSourcesByScopeSet(input: {
    scopes: AnnouncementSourceScope[];
    status?: AnnouncementSourceStatus;
    limit: number;
    offset: number;
  }): Promise<AnnouncementSourceRecord[]>;
  listAllSources(input?: { status?: AnnouncementSourceStatus; limit?: number; offset?: number }): Promise<AnnouncementSourceRecord[]>;
  listAdminSources(input: AnnouncementAdminSourceListQuery): Promise<AnnouncementSourceRecord[]>;
  listAdminSourcesByScopeSet(input: AnnouncementAdminSourceListQuery & { scopes: AnnouncementSourceScope[] }): Promise<AnnouncementSourceRecord[]>;
  findSourceById(id: string): Promise<AnnouncementSourceRecord | null>;
  listUniversityCalendarSourceProfiles(universityIds?: readonly string[]): Promise<UniversityCalendarSourceProfileRecord[]>;
  findUniversityCalendarSourceProfile(universityId: string): Promise<UniversityCalendarSourceProfileRecord | null>;
  upsertUniversityCalendarSourceProfile(input: UpsertUniversityCalendarSourceProfileInput): Promise<UniversityCalendarSourceProfileRecord>;
  attachVerificationEvidenceIfMissing(
    id: string,
    evidence: AnnouncementSourceVerificationEvidence
  ): Promise<AnnouncementSourceVerificationAttachResult | null>;
  upsertSource(input: UpsertAnnouncementSourceInput): Promise<AnnouncementSourceRecord>;
  updateSource(
    id: string,
    input: UpsertAnnouncementSourceInput,
    fence: AnnouncementSourceEditFence
  ): Promise<AnnouncementSourceRecord | null>;
  reviewSource(
    id: string,
    input: AnnouncementSourceReviewMutation,
    fence: AnnouncementSourceReviewFence
  ): Promise<AnnouncementSourceRecord | null>;
  completeSourceApproval(
    id: string,
    expectedDefinition: AnnouncementSourceDefinitionFence,
    expectedActiveSnapshotId: string | null
  ): Promise<AnnouncementSourceRecord | null>;
  insertQuarantinedSourceCandidate(input: AnnouncementSourceCandidateInput): Promise<AnnouncementSourceRecord>;
  quarantineSource(
    id: string,
    reasonCodes: AnnouncementTrustReason[],
    expectedDefinition?: AnnouncementSourceDefinitionFence
  ): Promise<AnnouncementSourceRecord | null>;
  deactivateSource(id: string, fence: AnnouncementSourceReviewFence): Promise<AnnouncementSourceRecord | null>;
  recordSourceCheck(
    id: string,
    input: SourceCheckInput,
    expectedDefinition?: AnnouncementSourceDefinitionFence,
    /** Optional CAS fence for health/validator writes; null means no active snapshot. */
    expectedActiveSnapshotId?: string | null
  ): Promise<AnnouncementSourceRecord | null>;
  recordSourceHealthProbe(
    id: string,
    input: SourceHealthProbeInput,
    expectedDefinition: AnnouncementSourceDefinitionFence
  ): Promise<AnnouncementSourceRecord | null>;
  replaceItemsForSource(
    source: AnnouncementSourceRecord,
    items: AnnouncementItem[],
    options?: AnnouncementReplacementOptions
  ): Promise<AnnouncementPersistenceDelta>;
  /** Opportunistic repair for crashed/indeterminate snapshot writers; Mongo implements this as TTL scheduling. */
  reconcileSnapshotRetention?(): Promise<void>;
  acknowledgeNotificationProduction(references: readonly AnnouncementPersistenceReference[]): Promise<number>;
  listItemsForSource(sourceId: string, limit?: number, offset?: number): Promise<AnnouncementItem[]>;
  listItemsByScope(input: { universityId: string; facultyId?: string; departmentId?: string; limit: number }): Promise<AnnouncementItem[]>;
  findTrustedItemByIdInScope(input: {
    announcementId: string;
    universityId: string;
    facultyId?: string;
    departmentId?: string;
  }): Promise<{ item: AnnouncementItem; source: AnnouncementSourceRecord } | null>;
  findSavedAnnouncement(userId: string, announcementId: string): Promise<SavedAnnouncementRecord | null>;
  saveAnnouncement(userId: string, announcementId: string, savedAt: Date): Promise<SavedAnnouncementRecord>;
  deleteSavedAnnouncement(userId: string, announcementId: string): Promise<boolean>;
  deleteSavedAnnouncementsByUserId(userId: string): Promise<void>;
  listAllItems(input?: { limit?: number; offset?: number }): Promise<AnnouncementItem[]>;
  listReviewItems(input?: { sourceIds?: string[]; limit?: number; offset?: number }): Promise<AnnouncementItem[]>;
  findReviewItemById(id: string): Promise<{ item: AnnouncementItem; source: AnnouncementSourceRecord } | null>;
  updateReviewItem(
    id: string,
    input: AnnouncementReviewItemUpdate,
    fence: AnnouncementReviewFence
  ): Promise<AnnouncementReviewMutationResult | null>;
}
