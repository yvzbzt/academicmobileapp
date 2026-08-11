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

export type AcademicEventTemporalKind = "date" | "timestamp";

export interface AcademicEventDto {
  id: string;
  universityId: string;
  calendarId: string;
  category: string;
  title: string;
  /** Course name only when explicitly supplied by the source or an editor. */
  courseName?: string;
  description?: string;
  /** Human-readable campus, room, or online meeting location when provided by the source. */
  location?: string;
  /** Date-only values are calendar dates; timestamp values are real instants. */
  temporalKind: AcademicEventTemporalKind;
  /** May differ from the start for a timed start with an inclusive date-only end. */
  endTemporalKind?: AcademicEventTemporalKind;
  startDate: string;
  endDate?: string;
  timezone: "Europe/Istanbul";
  academicYear: string;
  term: "fall" | "spring" | "summer" | "full_year" | "unknown";
  status: "draft" | "approved" | "published" | "archived";
}

export type AcademicContentType = "announcement" | "news" | "event";
export type AcademicContentScopeType = "university" | "faculty" | "department";
export type AcademicContentFreshness = "fresh" | "stale";
export type AcademicContentCollectionState = "fresh" | "stale" | "partial";
export type AcademicContentPublicationKind = "date" | "timestamp";

export interface AcademicContentBodyBlockDto {
  type: "heading" | "paragraph" | "bullet";
  /** Sanitized plain text. Raw source HTML is never exposed. */
  text: string;
}

export interface AcademicContentKeyDateDto {
  label: string;
  /** Source-declared calendar date. */
  startDate: string;
  /** Optional inclusive source-declared calendar end date. */
  endDate?: string;
}

export interface AcademicContentSourceRelationshipDto {
  sourceId: string;
  sourceName: string;
  officialSourceUrl: string;
  scopeType: AcademicContentScopeType;
  scopeId: string;
  canonicalUrl: string;
}

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
  /** Sanitized, presentation-safe structure derived from source-owned content. */
  body?: AcademicContentBodyBlockDto[];
  /** Explicit date/date-range statements derived from the sanitized source body. */
  keyDates?: AcademicContentKeyDateDto[];
  /** Backward-compatible alias of canonicalUrl. */
  link: string;
  canonicalUrl: string;
  /** Other official URLs observed for this same normalized item. */
  canonicalUrlAliases?: string[];
  /** Stable normalized title + summary + source-publication fingerprint. */
  contentFingerprint?: string;
  /** Source/scope provenance retained when equivalent records are presented once. */
  sourceRelationships?: AcademicContentSourceRelationshipDto[];
  /** Explicitly distinguishes a source date from a source timestamp. */
  publicationKind?: AcademicContentPublicationKind;
  /** Source-declared calendar date. Never interpreted as midnight UTC. */
  publishedDate?: string;
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

export const NOTIFICATION_DELIVERY_CONSENT_VERSION = "phase3-v1" as const;

export interface NotificationPreferenceDto {
  enabled: boolean;
  deliveryConsentVersion?: typeof NOTIFICATION_DELIVERY_CONSENT_VERSION;
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

export interface DeviceRegistrationDto {
  status: "registered";
  platform: "ios" | "android" | "web";
  lastSeenAt: string;
}

export interface DeviceUnregistrationDto {
  status: "unregistered";
}

export interface NotificationDeliveryDto {
  id: string;
  jobId: string;
  userId: string;
  deviceTokenId: string;
  status: "sending" | "sent" | "failed" | "invalid_device" | "ambiguous" | "deferred" | "skipped";
  attemptIdentity?: string;
  attemptVersion?: string;
  providerMessageId?: string;
  failureReason?:
    | "invalid_token"
    | "provider_unavailable"
    | "provider_rejected"
    | "scope_mismatch"
    | "preference_disabled"
    | "quiet_hours"
    | "destination_unavailable"
    | "device_registration_stale"
    | "provider_outcome_unknown";
  sendingStartedAt?: string;
  sendingLeaseUntil?: string;
  deliveredAt?: string;
  finalizedAt?: string;
  createdAt: string;
  updatedAt: string;
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
