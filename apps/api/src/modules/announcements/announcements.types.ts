export type AnnouncementScopeType = "university" | "faculty" | "department";
export type AnnouncementSourceParser = "auto" | "rss" | "html";
export type AnnouncementSourceStatus = "active" | "inactive";
export type AnnouncementSourceHealthStatus = "pending" | "healthy" | "degraded" | "failed";

export interface AnnouncementFallbackItem {
  title: string;
  link: string;
  publishedAt?: Date;
  summary?: string;
}

export interface AnnouncementSourceRecord {
  id: string;
  scopeType: AnnouncementScopeType;
  scopeId: string;
  sourceName: string;
  sourceUrl: string;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface AnnouncementItem {
  id: string;
  sourceId: string;
  sourceName: string;
  scopeType: AnnouncementScopeType;
  scopeId: string;
  title: string;
  link: string;
  publishedAt?: string;
  summary?: string;
  fetchedAt?: string;
}

export type UpsertAnnouncementSourceInput = Omit<AnnouncementSourceRecord, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type SourceCheckInput = Pick<AnnouncementSourceRecord, "healthStatus" | "lastCheckedAt" | "lastSuccessAt" | "lastError" | "consecutiveFailures" | "itemCount">;

export interface AnnouncementRepository {
  listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]>;
  listAllSources(input?: { status?: AnnouncementSourceStatus; limit?: number; offset?: number }): Promise<AnnouncementSourceRecord[]>;
  upsertSource(input: UpsertAnnouncementSourceInput): Promise<AnnouncementSourceRecord>;
  recordSourceCheck(id: string, input: SourceCheckInput): Promise<AnnouncementSourceRecord | null>;
  replaceItemsForSource(source: AnnouncementSourceRecord, items: AnnouncementItem[]): Promise<void>;
  listItemsByScope(input: { universityId: string; facultyId?: string; departmentId?: string; limit: number }): Promise<AnnouncementItem[]>;
  listAllItems(input?: { limit?: number; offset?: number }): Promise<AnnouncementItem[]>;
}
