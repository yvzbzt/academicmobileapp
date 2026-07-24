import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarEventFilters, CalendarRepository, UpcomingEventFilters } from "./calendar.types.js";

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
    for (const [index, calendar] of this.calendars.entries()) {
      if (calendar.universityId === universityId && calendar.academicYear === academicYear && calendar.status === "published") {
        this.calendars[index] = { ...calendar, status: "archived", updatedAt: new Date() };
        archivedCount += 1;
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

  async listEventsByCalendar(calendarId: string): Promise<AcademicEventRecord[]> {
    return this.events
      .filter((event) => event.calendarId === calendarId)
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
  }

  async listPublishedEvents(filters: CalendarEventFilters): Promise<AcademicEventRecord[]> {
    return this.events
      .filter((event) => event.status === "published")
      .filter((event) => (filters.calendarId ? event.calendarId === filters.calendarId : true))
      .filter((event) => (filters.universityId ? event.universityId === filters.universityId : true))
      .filter((event) => matchesScope(event, filters.facultyId, filters.departmentId))
      .filter((event) => (filters.category ? event.category === filters.category : true))
      .filter((event) => (filters.startDate ? event.startDate >= filters.startDate : true))
      .filter((event) => (filters.endDate ? event.startDate <= filters.endDate : true))
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime())
      .slice(filters.offset, filters.offset + filters.limit);
  }

  async listUpcomingEvents(filters: UpcomingEventFilters): Promise<AcademicEventRecord[]> {
    return this.events
      .filter((event) => event.status === "published" && event.universityId === filters.universityId && event.startDate >= filters.fromDate)
      .filter((event) => matchesScope(event, filters.facultyId, filters.departmentId))
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime())
      .slice(0, filters.limit);
  }

  async findPublishedEventById(eventId: string): Promise<AcademicEventRecord | null> {
    return this.events.find((event) => event.id === eventId && event.status === "published") ?? null;
  }
}

function matchesScope(event: AcademicEventRecord, facultyId?: string, departmentId?: string): boolean {
  if (!facultyId && !departmentId) return true;
  if (event.departmentId) return Boolean(departmentId && event.departmentId === departmentId);
  if (event.facultyId) return Boolean(facultyId && event.facultyId === facultyId);
  return true;
}

function compareCalendarFreshness(left: AcademicCalendarRecord, right: AcademicCalendarRecord): number {
  return right.academicYear.localeCompare(left.academicYear, "en-US") || right.version - left.version;
}
