export type UserRole = "student" | "content_editor" | "university_admin" | "super_admin";

export type EntityStatus = "active" | "inactive" | "archived";

export interface ApiErrorResponse {
  errorCode: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
}

export interface UniversitySummaryDto {
  id: string;
  name: string;
  slug: string;
  city: string;
  type: "state" | "foundation" | "private";
  logoUrl?: string;
}

export interface AcademicEventDto {
  id: string;
  universityId: string;
  calendarId: string;
  category: string;
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  timezone: "Europe/Istanbul";
  academicYear: string;
  term: "fall" | "spring" | "summer" | "full_year" | "unknown";
}

export type AcademicContentType = "announcement" | "news" | "event";
export type AcademicContentScopeType = "university" | "faculty" | "department";
export type AcademicContentFreshness = "fresh" | "stale";
export type AcademicContentCollectionState = "fresh" | "stale" | "partial";

/**
 * Additive, mobile-facing presentation contract for source-derived academic
 * content. Persistence-only trust/audit fields such as raw titles and
 * quarantine reasons must never be serialized into this shape.
 */
export interface TrustedAcademicContentDto {
  id: string;
  sourceId: string;
  sourceName: string;
  officialSourceUrl: string;
  contentType: AcademicContentType;
  scopeType: AcademicContentScopeType;
  scopeId: string;
  title: string;
  summary?: string;
  /** Backward-compatible alias of canonicalUrl. */
  link: string;
  canonicalUrl: string;
  /** Source-declared publication time only. */
  publishedAt?: string;
  /** Source-declared modification time only. */
  sourceUpdatedAt?: string;
  /** First time this canonical item was observed by this service. */
  discoveredAt?: string;
  /** Most recent crawler retrieval time. Never a publication-time fallback. */
  fetchedAt?: string;
  freshness: AcademicContentFreshness;
}

/**
 * Additive native feed envelope. The legacy array endpoints remain available,
 * while this shape makes a source failure observable even when that source has
 * no trusted cached item to carry a stale marker.
 */
export interface TrustedAcademicContentCollectionDto {
  items: TrustedAcademicContentDto[];
  state: AcademicContentCollectionState;
  sourceCount: number;
  failedSourceCount: number;
}

export interface NotificationPreferenceDto {
  enabled: boolean;
  categories: Record<string, boolean>;
  reminderOffsets: number[];
  reminderRules?: Array<{
    trigger: "before" | "at_time" | "approaching";
    amount: number;
    unit: "days" | "hours";
    enabled: boolean;
  }>;
  quietHours?: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: "Europe/Istanbul";
  };
}

export interface StudentAlarmDto {
  id: string;
  eventType: "exam" | "calendar_event" | "announcement" | "course";
  targetId: string;
  title: string;
  scheduledFor: string;
  trigger: "at_time" | "before";
  amount: number;
  unit: "days" | "hours";
  scheduledAt: string;
  timezone: "Europe/Istanbul";
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  sourceUrl?: string;
  status: "scheduled" | "cancelled";
}
