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

export interface NotificationPreferenceDto {
  enabled: boolean;
  categories: Record<string, boolean>;
  reminderOffsets: number[];
  quietHours?: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: "Europe/Istanbul";
  };
}
