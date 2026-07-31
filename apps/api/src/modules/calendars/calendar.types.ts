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
  description?: string;
  startDate: Date;
  endDate?: Date;
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

export interface CalendarEventFilters {
  calendarId?: string;
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
  category?: AcademicEventCategory;
  startDate?: Date;
  endDate?: Date;
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
