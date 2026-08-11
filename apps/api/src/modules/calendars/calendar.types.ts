import type { AcademicEventTemporalKind } from "../../../../../packages/shared/src/contracts.js";
import type { AcademicEventCategory, AcademicTerm } from "../../domain/academic-event.types.js";

export type CalendarStatus = "draft" | "published" | "archived";
export type EventStatus = "draft" | "approved" | "published" | "archived";
export type NotificationRuleTrigger = "before" | "at_time" | "approaching";

export interface AcademicCalendarRecord {
  id: string;
  universityId: string;
  academicYear: string;
  title: string;
  status: CalendarStatus;
  version: number;
  sourcePdfId?: string;
  sourceUrl?: string;
  publishedAt?: Date;
  createdBy?: string;
  approvedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationRuleRecord {
  offsetDays: number;
  offsetHours?: number;
  trigger?: NotificationRuleTrigger;
  enabled: boolean;
}

export interface AcademicEventRecord {
  id: string;
  calendarId: string;
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  academicYear: string;
  term: AcademicTerm;
  category: AcademicEventCategory;
  title: string;
  courseName?: string;
  description?: string;
  location?: string;
  /** Compatibility/sort instant. Use dateOnlyStart when temporalKind is date. */
  startDate: Date;
  /** Compatibility/sort instant. Use dateOnlyEnd when endTemporalKind is date. */
  endDate?: Date;
  temporalKind?: AcademicEventTemporalKind;
  endTemporalKind?: AcademicEventTemporalKind;
  dateOnlyStart?: string;
  dateOnlyEnd?: string;
  timezone: "Europe/Istanbul";
  originalDateText?: string;
  originalText?: string;
  sourcePdfId?: string;
  sourcePage?: number;
  confidenceScore?: number;
  status: EventStatus;
  notificationRules: NotificationRuleRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export type CalendarTemporalFilterBoundary =
  | { temporalKind: "date"; dateOnly: string }
  | { temporalKind: "timestamp"; instant: Date };

export interface CalendarEventFilters {
  calendarId?: string;
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
  category?: AcademicEventCategory;
  startBoundary?: CalendarTemporalFilterBoundary;
  endBoundary?: CalendarTemporalFilterBoundary;
  limit: number;
  offset: number;
}

export interface UpcomingEventFilters {
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  fromDate: Date;
  limit: number;
}

export interface CalendarEventScope {
  universityId: string;
  facultyId?: string;
  departmentId?: string;
}

export interface CalendarRepository {
  findPublishedCalendar(universityId: string, academicYear?: string): Promise<AcademicCalendarRecord | null>;
  listPublishedCalendars(input: { limit: number; offset: number }): Promise<AcademicCalendarRecord[]>;
  findCalendarById(calendarId: string): Promise<AcademicCalendarRecord | null>;
  createCalendar(input: Omit<AcademicCalendarRecord, "id" | "createdAt" | "updatedAt">): Promise<AcademicCalendarRecord>;
  updateCalendar(calendarId: string, input: Partial<Omit<AcademicCalendarRecord, "id" | "createdAt" | "updatedAt">>): Promise<AcademicCalendarRecord | null>;
  archivePublishedCalendars(universityId: string, academicYear: string): Promise<number>;
  createEvents(input: Array<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<AcademicEventRecord[]>;
  updateEventsByCalendar(calendarId: string, input: Partial<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<number>;
  listEventsByCalendar(calendarId: string): Promise<AcademicEventRecord[]>;
  listPublishedEvents(filters: CalendarEventFilters): Promise<AcademicEventRecord[]>;
  listUpcomingEvents(filters: UpcomingEventFilters): Promise<AcademicEventRecord[]>;
  findPublishedEventById(eventId: string): Promise<AcademicEventRecord | null>;
  findPublishedEventByIdInScope(eventId: string, scope: CalendarEventScope): Promise<AcademicEventRecord | null>;
}
