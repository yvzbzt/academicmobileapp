import { Inject, Injectable } from "@nestjs/common";
import { isValidObjectId } from "mongoose";
import { academicCalendarSchema, academicEventSchema } from "../../database/mongoose-schemas.js";
import { getModel, omitUndefined, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarEventFilters, CalendarEventScope, CalendarRepository, UpcomingEventFilters } from "./calendar.types.js";

@Injectable()
export class MongoCalendarRepository implements CalendarRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async findPublishedCalendar(universityId: string, academicYear?: string): Promise<AcademicCalendarRecord | null> {
    const document = await (await this.model("AcademicCalendar", academicCalendarSchema))
      .findOne({ universityId, status: "published", ...(academicYear ? { academicYear } : {}) })
      .sort({ academicYear: -1, version: -1 });
    return document ? toDomainRecord<AcademicCalendarRecord>(document) : null;
  }

  async findCalendarById(calendarId: string): Promise<AcademicCalendarRecord | null> {
    const document = await (await this.model("AcademicCalendar", academicCalendarSchema)).findById(calendarId);
    return document ? toDomainRecord<AcademicCalendarRecord>(document) : null;
  }

  async createCalendar(input: Omit<AcademicCalendarRecord, "id" | "createdAt" | "updatedAt">): Promise<AcademicCalendarRecord> {
    const document = await (await this.model("AcademicCalendar", academicCalendarSchema)).create(input);
    return toDomainRecord<AcademicCalendarRecord>(document);
  }

  async updateCalendar(calendarId: string, input: Partial<Omit<AcademicCalendarRecord, "id" | "createdAt" | "updatedAt">>): Promise<AcademicCalendarRecord | null> {
    const document = await (await this.model("AcademicCalendar", academicCalendarSchema)).findByIdAndUpdate(calendarId, omitUndefined(input), { new: true });
    return document ? toDomainRecord<AcademicCalendarRecord>(document) : null;
  }

  async archivePublishedCalendars(universityId: string, academicYear: string): Promise<number> {
    const result = await (await this.model("AcademicCalendar", academicCalendarSchema)).updateMany({ universityId, academicYear, status: "published" }, { status: "archived" });
    return result.modifiedCount;
  }

  async createEvents(input: Array<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<AcademicEventRecord[]> {
    const documents = await (await this.model("AcademicEvent", academicEventSchema)).insertMany(input);
    return documents.map((document) => toDomainRecord<AcademicEventRecord>(document));
  }

  async updateEventsByCalendar(calendarId: string, input: Partial<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<number> {
    const result = await (await this.model("AcademicEvent", academicEventSchema)).updateMany({ calendarId }, omitUndefined(input));
    return result.modifiedCount;
  }

  async listEventsByCalendar(calendarId: string): Promise<AcademicEventRecord[]> {
    const documents = await (await this.model("AcademicEvent", academicEventSchema)).find({ calendarId }).sort({ startDate: 1 });
    return documents.map((document) => toDomainRecord<AcademicEventRecord>(document));
  }

  async listPublishedEvents(filters: CalendarEventFilters): Promise<AcademicEventRecord[]> {
    const query: Record<string, unknown> = omitUndefined({ status: "published", calendarId: filters.calendarId, universityId: filters.universityId, category: filters.category });
    Object.assign(query, buildScopeQuery(filters.facultyId, filters.departmentId));
    if (filters.startDate || filters.endDate) query.startDate = omitUndefined({ $gte: filters.startDate, $lte: filters.endDate });
    const documents = await (await this.model("AcademicEvent", academicEventSchema)).find(query).sort({ startDate: 1 }).skip(filters.offset).limit(filters.limit);
    return documents.map((document) => toDomainRecord<AcademicEventRecord>(document));
  }

  async listUpcomingEvents(filters: UpcomingEventFilters): Promise<AcademicEventRecord[]> {
    const query: Record<string, unknown> = {
      universityId: filters.universityId,
      status: "published",
      startDate: { $gte: filters.fromDate }
    };
    Object.assign(query, buildScopeQuery(filters.facultyId, filters.departmentId));

    const documents = await (await this.model("AcademicEvent", academicEventSchema)).find(query).sort({ startDate: 1 }).limit(filters.limit);
    return documents.map((document) => toDomainRecord<AcademicEventRecord>(document));
  }

  async findPublishedEventById(eventId: string): Promise<AcademicEventRecord | null> {
    const document = await (await this.model("AcademicEvent", academicEventSchema)).findOne({ _id: eventId, status: "published" });
    return document ? toDomainRecord<AcademicEventRecord>(document) : null;
  }

  async findPublishedEventByIdInScope(eventId: string, scope: CalendarEventScope): Promise<AcademicEventRecord | null> {
    if (!isValidObjectId(eventId)) return null;
    const document = await (await this.model("AcademicEvent", academicEventSchema)).findOne({
      _id: eventId,
      status: "published",
      universityId: scope.universityId,
      ...buildExactScopeQuery(scope.facultyId, scope.departmentId)
    });
    return document ? toDomainRecord<AcademicEventRecord>(document) : null;
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}

function buildScopeQuery(facultyId?: string, departmentId?: string): Record<string, unknown> {
  if (departmentId && facultyId) {
    return {
      $or: [
        { departmentId },
        { departmentId: { $exists: false }, facultyId },
        { departmentId: { $exists: false }, facultyId: { $exists: false } }
      ]
    };
  }

  if (facultyId) {
    return {
      $or: [
        { departmentId: { $exists: false }, facultyId },
        { departmentId: { $exists: false }, facultyId: { $exists: false } }
      ]
    };
  }

  return {};
}

function buildExactScopeQuery(facultyId?: string, departmentId?: string): Record<string, unknown> {
  const scopeMatchers: Array<Record<string, unknown>> = [
    { facultyId: { $exists: false }, departmentId: { $exists: false } }
  ];
  if (facultyId) scopeMatchers.push({ facultyId, departmentId: { $exists: false } });
  if (departmentId && facultyId) {
    scopeMatchers.push({ departmentId, facultyId }, { departmentId, facultyId: { $exists: false } });
  } else if (departmentId) {
    scopeMatchers.push({ departmentId, facultyId: { $exists: false } });
  }
  return { $or: scopeMatchers };
}
