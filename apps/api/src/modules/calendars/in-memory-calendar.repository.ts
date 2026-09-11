import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { compareEventStart, eventIsCurrentOrFuture, eventMatchesTemporalFilters } from "./calendar-temporal.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarEventFilters, CalendarEventScope, CalendarRepository, PublishedCalendarReconciliation, UpcomingEventFilters } from "./calendar.types.js";

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

  async listPublishedCalendars(input: { universityId?: string; academicYear?: string; limit: number; offset: number }): Promise<AcademicCalendarRecord[]> {
    return this.calendars
      .filter((calendar) => calendar.status === "published")
      .filter((calendar) => !input.universityId || calendar.universityId === input.universityId)
      .filter((calendar) => !input.academicYear || calendar.academicYear === input.academicYear)
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

  async archivePublishedCalendars(universityId: string, academicYear: string, excludeCalendarId?: string): Promise<number> {
    let archivedCount = 0;
    const archivedCalendarIds = new Set<string>();
    for (const [index, calendar] of this.calendars.entries()) {
      if (
        calendar.universityId === universityId
        && calendar.academicYear === academicYear
        && calendar.status === "published"
        && calendar.id !== excludeCalendarId
      ) {
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

  async reconcilePublishedCalendars(
    universityId: string,
    academicYear: string,
    candidateCalendarIds?: readonly string[]
  ): Promise<PublishedCalendarReconciliation> {
    const candidateIdSet = candidateCalendarIds ? new Set(candidateCalendarIds) : undefined;
    const candidates = this.calendars
      .filter((calendar) => (
        calendar.universityId === universityId
        && calendar.academicYear === academicYear
        && calendar.status === "published"
        && (!candidateIdSet || candidateIdSet.has(calendar.id))
      ))
      .sort(compareCalendarPublicationWinner);
    const winner = candidates[0];
    if (!winner) return { winnerCalendarId: null, archivedCalendarCount: 0, archivedCalendarIds: [] };
    const archivedCalendarIds = candidates.slice(1).map((calendar) => calendar.id);
    for (const calendarId of archivedCalendarIds) {
      await this.updateCalendar(calendarId, { status: "archived" });
      await this.updateEventsByCalendar(calendarId, { status: "archived" });
    }
    return { winnerCalendarId: winner.id, archivedCalendarCount: archivedCalendarIds.length, archivedCalendarIds };
  }

  async createEvents(input: Array<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<AcademicEventRecord[]> {
    const now = new Date();
    const records = input.map((event) => ({ ...event, id: randomUUID(), createdAt: now, updatedAt: now }));
    this.events.push(...records);
    return records;
  }

  async upsertScheduleReviewEvents(
    input: Array<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt"> & { scheduleCandidateKey: string }>
  ): Promise<AcademicEventRecord[]> {
    const records: AcademicEventRecord[] = [];
    for (const candidate of input) {
      const existing = this.events.find((event) => event.scheduleCandidateKey === candidate.scheduleCandidateKey);
      if (existing) {
        records.push(existing);
        continue;
      }
      records.push((await this.createEvents([candidate]))[0]!);
    }
    return records;
  }

  async publishScheduleReviewEvents(reviewKey: string, universityId: string): Promise<number> {
    let published = 0;
    for (const [index, event] of this.events.entries()) {
      if (event.scheduleReviewKey !== reviewKey || event.universityId !== universityId || event.status !== "approved") continue;
      this.events[index] = { ...event, status: "published", updatedAt: new Date() };
      published += 1;
    }
    return published;
  }

  async archiveScheduleReviewEvents(reviewKey: string, universityId: string): Promise<number> {
    let archived = 0;
    for (const [index, event] of this.events.entries()) {
      if (event.scheduleReviewKey !== reviewKey || event.universityId !== universityId || event.status === "archived") continue;
      this.events[index] = { ...event, status: "archived", updatedAt: new Date() };
      archived += 1;
    }
    return archived;
  }

  async rollbackScheduleReviewEvents(reviewKey: string, universityId: string): Promise<number> {
    let rolledBack = 0;
    for (const [index, event] of this.events.entries()) {
      if (event.scheduleReviewKey !== reviewKey || event.universityId !== universityId || event.status !== "published") continue;
      this.events[index] = { ...event, status: "approved", updatedAt: new Date() };
      rolledBack += 1;
    }
    return rolledBack;
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
  return right.academicYear.localeCompare(left.academicYear, "en-US") || compareCalendarPublicationWinner(left, right);
}

function compareCalendarPublicationWinner(left: AcademicCalendarRecord, right: AcademicCalendarRecord): number {
  return right.version - left.version
    || right.createdAt.getTime() - left.createdAt.getTime()
    || right.id.localeCompare(left.id, "en-US");
}
