import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { compareEventStart, eventIsCurrentOrFuture, eventMatchesTemporalFilters } from "./calendar-temporal.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarEventFilters, CalendarEventScope, CalendarRepository, UpcomingEventFilters } from "./calendar.types.js";

@Injectable()
export class InMemoryCalendarRepository implements CalendarRepository {
  private readonly calendars: AcademicCalendarRecord[];
  private readonly events: AcademicEventRecord[];

  constructor() {
    this.calendars = [];
    this.events = [];
  }

  async findPublishedCalendar(universityId: string, academicYear?: string): Promise<AcademicCalendarRecord | null> {
    return (
      this.calendars
        .filter((calendar) => calendar.universityId === universityId && calendar.status === "published")
        .filter((calendar) => (academicYear ? calendar.academicYear === academicYear : true))
        .sort(compareCalendarFreshness)[0] ?? null
    );
  }

  async listPublishedCalendars(input: { limit: number; offset: number }): Promise<AcademicCalendarRecord[]> {
    return this.calendars
      .filter((calendar) => calendar.status === "published")
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id, "en-US"))
      .slice(input.offset, input.offset + input.limit);
  }

  async findCalendarById(calendarId: string): Promise<AcademicCalendarRecord | null> {
    return this.calendars.find((calendar) => calendar.id === calendarId) ?? null;
  }

  async createCalendar(input: Omit<AcademicCalendarRecord, "id" | "createdAt" | "updatedAt">): Promise<AcademicCalendarRecord> {
    const now = new Date();
    const calendar: AcademicCalendarRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.calendars.push(calendar);
    return calendar;
  }

  async updateCalendar(calendarId: string, input: Partial<Omit<AcademicCalendarRecord, "id" | "createdAt" | "updatedAt">>): Promise<AcademicCalendarRecord | null> {
    const index = this.calendars.findIndex((calendar) => calendar.id === calendarId);
    if (index < 0) return null;
    const current = this.calendars[index];
    if (!current) return null;
    const updated: AcademicCalendarRecord = { ...current, ...input, updatedAt: new Date() };
    this.calendars[index] = updated;
    return updated;
  }

  async archivePublishedCalendars(universityId: string, academicYear: string): Promise<number> {
    let archivedCount = 0;
    const archivedCalendarIds = new Set<string>();
    for (const [index, calendar] of this.calendars.entries()) {
      if (calendar.universityId === universityId && calendar.academicYear === academicYear && calendar.status === "published") {
        this.calendars[index] = { ...calendar, status: "archived", updatedAt: new Date() };
        archivedCalendarIds.add(calendar.id);
        archivedCount += 1;
      }
    }
    if (archivedCalendarIds.size > 0) {
      for (const [index, event] of this.events.entries()) {
        if (archivedCalendarIds.has(event.calendarId)) {
          this.events[index] = { ...event, status: "archived", updatedAt: new Date() };
        }
      }
    }
    return archivedCount;
  }

  async createEvents(input: Array<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<AcademicEventRecord[]> {
    const now = new Date();
    const records = input.map((event) => ({ ...event, id: randomUUID(), createdAt: now, updatedAt: now }));
    this.events.push(...records);
    return records;
  }

  async updateEventsByCalendar(calendarId: string, input: Partial<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<number> {
    let updatedCount = 0;
    for (const [index, event] of this.events.entries()) {
      if (event.calendarId === calendarId) {
        this.events[index] = { ...event, ...input, updatedAt: new Date() };
        updatedCount += 1;
      }
    }
    return updatedCount;
  }

  async archiveEventsByScheduleSeries(scheduleSeriesId: string, universityId?: string): Promise<number> {
    let updatedCount = 0;
    for (const [index, event] of this.events.entries()) {
      if (
        event.scheduleSeriesId === scheduleSeriesId
        && (!universityId || event.universityId === universityId)
        && event.status !== "archived"
      ) {
        this.events[index] = { ...event, status: "archived", updatedAt: new Date() };
        updatedCount += 1;
      }
    }
    return updatedCount;
  }

  async listEventsByCalendar(calendarId: string): Promise<AcademicEventRecord[]> {
    return this.events
      .filter((event) => event.calendarId === calendarId)
      .sort(compareEventStart);
  }

  async listPublishedEvents(filters: CalendarEventFilters): Promise<AcademicEventRecord[]> {
    const publishedCalendarIds = this.publishedCalendarIds();
    return this.events
      .filter((event) => event.status === "published" && publishedCalendarIds.has(event.calendarId))
      .filter((event) => (filters.calendarId ? event.calendarId === filters.calendarId : true))
      .filter((event) => (filters.universityId ? event.universityId === filters.universityId : true))
      .filter((event) => matchesScope(event, filters.facultyId, filters.departmentId))
      .filter((event) => (filters.category ? event.category === filters.category : true))
      .filter((event) => eventMatchesTemporalFilters(event, filters.startBoundary, filters.endBoundary))
      .sort(compareEventStart)
      .slice(filters.offset, filters.offset + filters.limit);
  }

  async listUpcomingEvents(filters: UpcomingEventFilters): Promise<AcademicEventRecord[]> {
    const publishedCalendarIds = this.publishedCalendarIds();
    return this.events
      .filter((event) => event.status === "published" && publishedCalendarIds.has(event.calendarId) && event.universityId === filters.universityId && eventIsCurrentOrFuture(event, filters.fromDate))
      .filter((event) => matchesScope(event, filters.facultyId, filters.departmentId))
      .sort(compareEventStart)
      .slice(0, filters.limit);
  }

  async findPublishedEventById(eventId: string): Promise<AcademicEventRecord | null> {
    const publishedCalendarIds = this.publishedCalendarIds();
    return this.events.find((event) => event.id === eventId && event.status === "published" && publishedCalendarIds.has(event.calendarId)) ?? null;
  }

  async findPublishedEventByIdInScope(eventId: string, scope: CalendarEventScope): Promise<AcademicEventRecord | null> {
    const publishedCalendarIds = this.publishedCalendarIds();
    return this.events.find((event) => (
      event.id === eventId
      && event.status === "published"
      && publishedCalendarIds.has(event.calendarId)
      && event.universityId === scope.universityId
      && matchesExactScope(event, scope.facultyId, scope.departmentId)
    )) ?? null;
  }

  private publishedCalendarIds(): Set<string> {
    return new Set(this.calendars.filter((calendar) => calendar.status === "published").map((calendar) => calendar.id));
  }
}

function matchesScope(event: AcademicEventRecord, facultyId?: string, departmentId?: string): boolean {
  if (!facultyId && !departmentId) return true;
  if (event.departmentId) return Boolean(departmentId && event.departmentId === departmentId);
  if (event.facultyId) return Boolean(facultyId && event.facultyId === facultyId);
  return true;
}

function matchesExactScope(event: AcademicEventRecord, facultyId?: string, departmentId?: string): boolean {
  if (event.departmentId) {
    if (!departmentId || event.departmentId !== departmentId) return false;
    return !event.facultyId || Boolean(facultyId && event.facultyId === facultyId);
  }
  if (event.facultyId) return Boolean(facultyId && event.facultyId === facultyId);
  return true;
}

function compareCalendarFreshness(left: AcademicCalendarRecord, right: AcademicCalendarRecord): number {
  return right.academicYear.localeCompare(left.academicYear, "en-US") || right.version - left.version;
}
