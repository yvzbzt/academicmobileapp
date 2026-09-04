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

export type AnnouncementScopeType = AcademicContentScopeType;
export type AnnouncementContentType = AcademicContentType;
export type AnnouncementSourceParser = "auto" | "rss" | "html";
export type AnnouncementSourceStatus = "active" | "inactive";
export type AnnouncementSourceHealthStatus = "pending" | "healthy" | "degraded" | "failed";
export type AnnouncementTrustStatus = "trusted" | "rejected" | "quarantined";
export type AnnouncementTrustReason = SourceAuthorityReasonCode
  | "navigation_or_chrome"
  | "unsafe_url"
  | "unofficial_source"
  | "missing_source"
  | "invalid_timestamp"
  | "duplicate_canonical_url"
  | "legacy_crawl_time_removed"
  | "unverified_source_time_removed";

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
  sourceName: string;
  sourceUrl: string;
  canonicalUrl?: string;
  contentType?: AnnouncementContentType;
  parser: AnnouncementSourceParser;
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
  /** Atomic pointer to the complete student-visible snapshot. Missing on legacy sources. */
  activeSnapshotId?: string;
  /** Opaque fence rotated whenever URL/parser/content type changes. Missing on legacy sources. */
  sourceDefinitionVersion?: string;
  /** Opaque fence rotated only when a trusted source is reactivated. */
  notificationProducerVersion?: string;
  processingVersion?: string;
  fetchIntervalMinutes?: number;
  fallbackItems?: AnnouncementFallbackItem[];
  discoveredAt?: Date;
  trustStatus?: AnnouncementTrustStatus;
  trustReasonCodes?: AnnouncementTrustReason[];
  duplicateOfId?: string;
  createdAt: Date;
  updatedAt: Date;
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

export type AnnouncementSourceDefinitionFence = Pick<
  AnnouncementSourceRecord,
  "sourceUrl" | "parser" | "contentType" | "sourceDefinitionVersion" | "notificationProducerVersion"
>;

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
  findSourceById(id: string): Promise<AnnouncementSourceRecord | null>;
  upsertSource(input: UpsertAnnouncementSourceInput): Promise<AnnouncementSourceRecord>;
  insertQuarantinedSourceCandidate(input: AnnouncementSourceCandidateInput): Promise<AnnouncementSourceRecord>;
  quarantineSource(
    id: string,
    reasonCodes: AnnouncementTrustReason[],
    expectedDefinition?: AnnouncementSourceDefinitionFence
  ): Promise<AnnouncementSourceRecord | null>;
  deactivateSource(id: string): Promise<AnnouncementSourceRecord | null>;
  recordSourceCheck(
    id: string,
    input: SourceCheckInput,
    expectedDefinition?: AnnouncementSourceDefinitionFence,
    /** Optional CAS fence for health/validator writes; null means no active snapshot. */
    expectedActiveSnapshotId?: string | null
  ): Promise<AnnouncementSourceRecord | null>;
  replaceItemsForSource(
    source: AnnouncementSourceRecord,
    items: AnnouncementItem[],
    options?: AnnouncementReplacementOptions
  ): Promise<AnnouncementPersistenceDelta>;
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
}
