export type AnnouncementScopeType = "university" | "faculty" | "department";
export type AnnouncementSourceParser = "auto" | "rss" | "html";

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
  status: "active" | "inactive";
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
}

export interface AnnouncementRepository {
  listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]>;
}
