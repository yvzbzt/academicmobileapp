import type {
  AcademicContentFreshness,
  AcademicContentScopeType,
  AcademicContentType,
  TrustedAcademicContentDto
} from "../../../../../packages/shared/src/contracts.js";

export type AnnouncementScopeType = AcademicContentScopeType;
export type AnnouncementContentType = AcademicContentType;
export type AnnouncementSourceParser = "auto" | "rss" | "html";
export type AnnouncementSourceStatus = "active" | "inactive";
export type AnnouncementSourceHealthStatus = "pending" | "healthy" | "degraded" | "failed";
export type AnnouncementTrustStatus = "trusted" | "rejected" | "quarantined";
export type AnnouncementTrustReason =
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
  sourceUpdatedAt?: Date;
  discoveredAt?: Date;
  summary?: string;
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
  fallbackItems?: AnnouncementFallbackItem[];
  discoveredAt?: Date;
  trustStatus?: AnnouncementTrustStatus;
  trustReasonCodes?: AnnouncementTrustReason[];
  duplicateOfId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnnouncementItem {
  id: string;
  sourceId: string;
  sourceName: string;
  contentType?: AnnouncementContentType;
  scopeType: AnnouncementScopeType;
  scopeId: string;
  title: string;
  rawTitle?: string;
  link: string;
  canonicalUrl?: string;
  officialSourceUrl?: string;
  publishedAt?: string;
  publicationTimeSource?: "source";
  sourceUpdatedAt?: string;
  sourceUpdateTimeSource?: "source";
  discoveredAt?: string;
  summary?: string;
  fetchedAt?: string;
  freshness?: AcademicContentFreshness;
  trustStatus?: AnnouncementTrustStatus;
  trustReasonCodes?: AnnouncementTrustReason[];
  dedupeKey?: string;
  duplicateOfId?: string;
}

export type MobileAnnouncementItem = TrustedAcademicContentDto;

export type UpsertAnnouncementSourceInput = Omit<AnnouncementSourceRecord, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type SourceCheckInput = Pick<AnnouncementSourceRecord, "healthStatus" | "lastCheckedAt" | "lastSuccessAt" | "lastError" | "consecutiveFailures" | "itemCount">;

export interface AnnouncementRepository {
  listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]>;
  listAllSources(input?: { status?: AnnouncementSourceStatus; limit?: number; offset?: number }): Promise<AnnouncementSourceRecord[]>;
  upsertSource(input: UpsertAnnouncementSourceInput): Promise<AnnouncementSourceRecord>;
  recordSourceCheck(id: string, input: SourceCheckInput): Promise<AnnouncementSourceRecord | null>;
  replaceItemsForSource(source: AnnouncementSourceRecord, items: AnnouncementItem[]): Promise<void>;
  listItemsForSource(sourceId: string, limit?: number): Promise<AnnouncementItem[]>;
  listItemsByScope(input: { universityId: string; facultyId?: string; departmentId?: string; limit: number }): Promise<AnnouncementItem[]>;
  listAllItems(input?: { limit?: number; offset?: number }): Promise<AnnouncementItem[]>;
}
