import { Inject, Injectable } from "@nestjs/common";
import type { CollectionReference, DocumentData } from "firebase-admin/firestore";
import { FirestoreDatabaseService } from "../../database/firestore.service.js";
import { cleanFirestoreData, getAllFirestoreRecords, newFirestoreId, toFirestoreRecord } from "../../database/firestore-utils.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarEventFilters, CalendarRepository, UpcomingEventFilters } from "./calendar.types.js";

@Injectable()
export class FirestoreCalendarRepository implements CalendarRepository {
  constructor(@Inject(FirestoreDatabaseService) private readonly firestore: FirestoreDatabaseService) {}

  async findPublishedCalendar(universityId: string, academicYear?: string): Promise<AcademicCalendarRecord | null> {
    return (await getAllFirestoreRecords<AcademicCalendarRecord>(this.calendars.where("universityId", "==", universityId)))
      .filter((calendar) => calendar.status === "published")
      .filter((calendar) => (academicYear ? calendar.academicYear === academicYear : true))
      .sort(compareCalendarFreshness)[0] ?? null;
  }

  async findCalendarById(calendarId: string): Promise<AcademicCalendarRecord | null> {
    return toFirestoreRecord<AcademicCalendarRecord>(await this.calendars.doc(calendarId).get());
  }

  async createCalendar(input: Omit<AcademicCalendarRecord, "id" | "createdAt" | "updatedAt">): Promise<AcademicCalendarRecord> {
    const now = new Date();
    const calendar: AcademicCalendarRecord = { ...input, id: newFirestoreId(), createdAt: now, updatedAt: now };
    await this.calendars.doc(calendar.id).set(cleanFirestoreData(calendar as unknown as Record<string, unknown>));
    return calendar;
  }

  async updateCalendar(calendarId: string, input: Partial<Omit<AcademicCalendarRecord, "id" | "createdAt" | "updatedAt">>): Promise<AcademicCalendarRecord | null> {
    const calendar = await this.findCalendarById(calendarId);
    if (!calendar) return null;
    const updated: AcademicCalendarRecord = { ...calendar, ...input, updatedAt: new Date() };
    await this.calendars.doc(calendarId).set(cleanFirestoreData(updated as unknown as Record<string, unknown>), { merge: false });
    return updated;
  }

  async archivePublishedCalendars(universityId: string, academicYear: string): Promise<number> {
    const calendars = (await getAllFirestoreRecords<AcademicCalendarRecord>(this.calendars.where("universityId", "==", universityId)))
      .filter((calendar) => calendar.academicYear === academicYear && calendar.status === "published");
    const batch = this.firestore.getDb().batch();
    const now = new Date();
    for (const calendar of calendars) {
      batch.set(this.calendars.doc(calendar.id), cleanFirestoreData({ status: "archived", updatedAt: now }), { merge: true });
    }
    await batch.commit();
    return calendars.length;
  }

  async createEvents(input: Array<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<AcademicEventRecord[]> {
    const now = new Date();
    const records = input.map((event) => ({ ...event, id: newFirestoreId(), createdAt: now, updatedAt: now }));
    const batch = this.firestore.getDb().batch();
    for (const record of records) batch.set(this.events.doc(record.id), cleanFirestoreData(record as unknown as Record<string, unknown>));
    await batch.commit();
    return records;
  }

  async updateEventsByCalendar(calendarId: string, input: Partial<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<number> {
    const events = await getAllFirestoreRecords<AcademicEventRecord>(this.events.where("calendarId", "==", calendarId));
    const batch = this.firestore.getDb().batch();
    const now = new Date();
    for (const event of events) batch.set(this.events.doc(event.id), cleanFirestoreData({ ...input, updatedAt: now }), { merge: true });
    await batch.commit();
    return events.length;
  }

  async listEventsByCalendar(calendarId: string): Promise<AcademicEventRecord[]> {
    return (await getAllFirestoreRecords<AcademicEventRecord>(this.events.where("calendarId", "==", calendarId)))
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
  }

  async listPublishedEvents(filters: CalendarEventFilters): Promise<AcademicEventRecord[]> {
    const records = filters.universityId
      ? await getAllFirestoreRecords<AcademicEventRecord>(this.events.where("universityId", "==", filters.universityId))
      : await getAllFirestoreRecords<AcademicEventRecord>(this.events.where("status", "==", "published"));
    return records
      .filter((event) => event.status === "published")
      .filter((event) => (filters.calendarId ? event.calendarId === filters.calendarId : true))
      .filter((event) => matchesScope(event, filters.facultyId, filters.departmentId))
      .filter((event) => (filters.category ? event.category === filters.category : true))
      .filter((event) => (filters.startDate ? event.startDate >= filters.startDate : true))
      .filter((event) => (filters.endDate ? event.startDate <= filters.endDate : true))
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime())
      .slice(filters.offset, filters.offset + filters.limit);
  }

  async listUpcomingEvents(filters: UpcomingEventFilters): Promise<AcademicEventRecord[]> {
    return (await getAllFirestoreRecords<AcademicEventRecord>(this.events.where("universityId", "==", filters.universityId)))
      .filter((event) => event.status === "published" && event.startDate >= filters.fromDate)
      .filter((event) => matchesScope(event, filters.facultyId, filters.departmentId))
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime())
      .slice(0, filters.limit);
  }

  async findPublishedEventById(eventId: string): Promise<AcademicEventRecord | null> {
    const event = toFirestoreRecord<AcademicEventRecord>(await this.events.doc(eventId).get());
    return event?.status === "published" ? event : null;
  }

  private get calendars(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("academic_calendars");
  }

  private get events(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("academic_events");
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
