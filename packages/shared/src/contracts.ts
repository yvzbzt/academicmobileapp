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
