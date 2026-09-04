import { Inject, Injectable } from "@nestjs/common";
import { isValidObjectId } from "mongoose";
import { academicCalendarSchema, academicEventSchema } from "../../database/mongoose-schemas.js";
import { getModel, omitUndefined, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import { instantBoundaryForIstanbulCalendarDate, istanbulCalendarDate } from "./calendar-temporal.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarEventFilters, CalendarEventScope, CalendarRepository, CalendarTemporalFilterBoundary, PublishedCalendarReconciliation, UpcomingEventFilters } from "./calendar.types.js";

@Injectable()
export class MongoCalendarRepository implements CalendarRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async findPublishedCalendar(universityId: string, academicYear?: string): Promise<AcademicCalendarRecord | null> {
    const document = await (await this.model("AcademicCalendar", academicCalendarSchema))
      .findOne({ universityId, status: "published", ...(academicYear ? { academicYear } : {}) })
      .sort({ academicYear: -1, version: -1, createdAt: -1, _id: -1 });
    return document ? toDomainRecord<AcademicCalendarRecord>(document) : null;
  }

  async listPublishedCalendars(input: { universityId?: string; academicYear?: string; limit: number; offset: number }): Promise<AcademicCalendarRecord[]> {
    const documents = await (await this.model("AcademicCalendar", academicCalendarSchema))
      .find({
        status: "published",
        ...(input.universityId ? { universityId: input.universityId } : {}),
        ...(input.academicYear ? { academicYear: input.academicYear } : {})
      })
      .sort({ createdAt: 1, _id: 1 })
      .skip(input.offset)
      .limit(input.limit);
    return documents.map((document) => toDomainRecord<AcademicCalendarRecord>(document));
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

  async archivePublishedCalendars(universityId: string, academicYear: string, excludeCalendarId?: string): Promise<number> {
    const calendarModel = await this.model("AcademicCalendar", academicCalendarSchema);
    const publishedCalendars = await calendarModel.find({
      universityId,
      academicYear,
      status: "published",
      ...(excludeCalendarId ? { _id: { $ne: excludeCalendarId } } : {})
    }).select({ _id: 1 });
    const calendarIds = publishedCalendars.map((calendar) => String(calendar._id));
    if (calendarIds.length === 0) return 0;
    const result = await calendarModel.updateMany({ _id: { $in: calendarIds }, status: "published" }, { status: "archived" });
    await (await this.model("AcademicEvent", academicEventSchema)).updateMany(
      { calendarId: { $in: calendarIds } },
      { status: "archived" }
    );
    return result.modifiedCount;
  }

  async reconcilePublishedCalendars(
    universityId: string,
    academicYear: string,
    candidateCalendarIds?: readonly string[]
  ): Promise<PublishedCalendarReconciliation> {
    if (candidateCalendarIds?.length === 0) {
      return { winnerCalendarId: null, archivedCalendarCount: 0, archivedCalendarIds: [] };
    }
    const calendarModel = await this.model("AcademicCalendar", academicCalendarSchema);
    const candidates = await calendarModel.find({
      universityId,
      academicYear,
      status: "published",
      ...(candidateCalendarIds ? { _id: { $in: candidateCalendarIds } } : {})
    }).sort({ version: -1, createdAt: -1, _id: -1 }).select({ _id: 1 });
    const winner = candidates[0];
    if (!winner) return { winnerCalendarId: null, archivedCalendarCount: 0, archivedCalendarIds: [] };

    const winnerCalendarId = String(winner._id);
    const loserCalendarIds = candidates.slice(1).map((calendar) => String(calendar._id));
    if (loserCalendarIds.length === 0) {
      return { winnerCalendarId, archivedCalendarCount: 0, archivedCalendarIds: [] };
    }
    const result = await calendarModel.updateMany(
      { _id: { $in: loserCalendarIds }, status: "published" },
      { status: "archived" }
    );
    await (await this.model("AcademicEvent", academicEventSchema)).updateMany(
      { calendarId: { $in: loserCalendarIds } },
      { status: "archived" }
    );
    return {
      winnerCalendarId,
      archivedCalendarCount: result.modifiedCount,
      archivedCalendarIds: loserCalendarIds
    };
  }

  async createEvents(input: Array<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<AcademicEventRecord[]> {
    const documents = await (await this.model("AcademicEvent", academicEventSchema)).insertMany(input);
    return documents.map((document) => toDomainRecord<AcademicEventRecord>(document));
  }

  async updateEventsByCalendar(calendarId: string, input: Partial<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<number> {
    const result = await (await this.model("AcademicEvent", academicEventSchema)).updateMany({ calendarId }, omitUndefined(input));
    return result.modifiedCount;
  }

  async archiveEventsByScheduleSeries(scheduleSeriesId: string, universityId?: string): Promise<number> {
    const result = await (await this.model("AcademicEvent", academicEventSchema)).updateMany(
      { scheduleSeriesId, ...(universityId ? { universityId } : {}), status: { $ne: "archived" } },
      { status: "archived" }
    );
    return result.modifiedCount;
  }

  async listEventsByCalendar(calendarId: string): Promise<AcademicEventRecord[]> {
    const documents = await (await this.model("AcademicEvent", academicEventSchema)).find({ calendarId }).sort({ startDate: 1 });
    return documents.map((document) => toDomainRecord<AcademicEventRecord>(document));
  }

  async listPublishedEvents(filters: CalendarEventFilters): Promise<AcademicEventRecord[]> {
    const calendarIds = await this.listPublishedCalendarIds({
      ...(filters.calendarId ? { calendarId: filters.calendarId } : {}),
      ...(filters.universityId ? { universityId: filters.universityId } : {})
    });
    if (calendarIds.length === 0) return [];
    const query: Record<string, unknown> = omitUndefined({ status: "published", universityId: filters.universityId, category: filters.category });
    query.calendarId = { $in: calendarIds };
    const conditions: Record<string, unknown>[] = [];
    const scopeQuery = buildScopeQuery(filters.facultyId, filters.departmentId);
    if (Object.keys(scopeQuery).length > 0) conditions.push(scopeQuery);
    if (filters.startBoundary) conditions.push(buildEventEndOnOrAfterQuery(filters.startBoundary));
    if (filters.endBoundary) conditions.push(buildEventStartOnOrBeforeQuery(filters.endBoundary));
    if (conditions.length > 0) query.$and = conditions;
    const documents = await (await this.model("AcademicEvent", academicEventSchema)).find(query).sort({ startDate: 1, _id: 1 }).skip(filters.offset).limit(filters.limit);
    return documents.map((document) => toDomainRecord<AcademicEventRecord>(document));
  }

  async listUpcomingEvents(filters: UpcomingEventFilters): Promise<AcademicEventRecord[]> {
    const calendarIds = await this.listPublishedCalendarIds({ universityId: filters.universityId });
    if (calendarIds.length === 0) return [];
    const query: Record<string, unknown> = {
      universityId: filters.universityId,
      status: "published",
      calendarId: { $in: calendarIds }
    };
    const conditions: Record<string, unknown>[] = [];
    const scopeQuery = buildScopeQuery(filters.facultyId, filters.departmentId);
    if (Object.keys(scopeQuery).length > 0) conditions.push(scopeQuery);
    conditions.push(buildUpcomingTemporalQuery(filters.fromDate));
    query.$and = conditions;

    const documents = await (await this.model("AcademicEvent", academicEventSchema)).find(query).sort({ startDate: 1 }).limit(filters.limit);
    return documents.map((document) => toDomainRecord<AcademicEventRecord>(document));
  }

  async findPublishedEventById(eventId: string): Promise<AcademicEventRecord | null> {
    if (!isValidObjectId(eventId)) return null;
    const document = await (await this.model("AcademicEvent", academicEventSchema)).findOne({ _id: eventId, status: "published" });
    if (!document) return null;
    const event = toDomainRecord<AcademicEventRecord>(document);
    return await this.isCalendarPublished(event.calendarId) ? event : null;
  }

  async findPublishedEventByIdInScope(eventId: string, scope: CalendarEventScope): Promise<AcademicEventRecord | null> {
    if (!isValidObjectId(eventId)) return null;
    const document = await (await this.model("AcademicEvent", academicEventSchema)).findOne({
      _id: eventId,
      status: "published",
      universityId: scope.universityId,
      ...buildExactScopeQuery(scope.facultyId, scope.departmentId)
    });
    if (!document) return null;
    const event = toDomainRecord<AcademicEventRecord>(document);
    return await this.isCalendarPublished(event.calendarId) ? event : null;
  }

  private async listPublishedCalendarIds(input: { calendarId?: string; universityId?: string }): Promise<string[]> {
    if (input.calendarId && !isValidObjectId(input.calendarId)) return [];
    const documents = await (await this.model("AcademicCalendar", academicCalendarSchema))
      .find(omitUndefined({
        _id: input.calendarId,
        universityId: input.universityId,
        status: "published"
      }))
      .select({ _id: 1 });
    return documents.map((document) => String(document._id));
  }

  private async isCalendarPublished(calendarId: string): Promise<boolean> {
    if (!isValidObjectId(calendarId)) return false;
    return Boolean(await (await this.model("AcademicCalendar", academicCalendarSchema)).exists({ _id: calendarId, status: "published" }));
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}

export function buildUpcomingTemporalQuery(fromDate: Date): Record<string, unknown> {
  const fromCalendarDate = istanbulCalendarDate(fromDate);
  return {
    $or: [
      {
        endTemporalKind: "date",
        dateOnlyEnd: { $gte: fromCalendarDate }
      },
      {
        endTemporalKind: "timestamp",
        endDate: { $gte: fromDate }
      },
      {
        temporalKind: "date",
        endTemporalKind: { $exists: false },
        $or: [
          { dateOnlyEnd: { $gte: fromCalendarDate } },
          { dateOnlyEnd: { $exists: false }, dateOnlyStart: { $gte: fromCalendarDate } }
        ]
      },
      {
        temporalKind: "timestamp",
        endTemporalKind: { $exists: false },
        $or: [
          { endDate: { $gte: fromDate } },
          { endDate: { $exists: false }, startDate: { $gte: fromDate } }
        ]
      },
      {
        temporalKind: { $exists: false },
        $or: [
          { endDate: { $gte: fromDate } },
          { endDate: { $exists: false }, startDate: { $gte: fromDate } }
        ]
      }
    ]
  };
}

export function buildEventEndOnOrAfterQuery(boundary: CalendarTemporalFilterBoundary): Record<string, unknown> {
  const calendarDate = boundaryCalendarDate(boundary);
  const instant = boundary.temporalKind === "timestamp"
    ? boundary.instant
    : instantBoundaryForIstanbulCalendarDate(boundary.dateOnly);
  return {
    $or: [
      { endTemporalKind: "date", dateOnlyEnd: { $gte: calendarDate } },
      { endTemporalKind: "timestamp", endDate: { $gte: instant } },
      {
        temporalKind: "date",
        endTemporalKind: { $exists: false },
        $or: [
          { dateOnlyEnd: { $gte: calendarDate } },
          { dateOnlyEnd: { $exists: false }, dateOnlyStart: { $gte: calendarDate } }
        ]
      },
      {
        temporalKind: "timestamp",
        endTemporalKind: { $exists: false },
        $or: [
          { endDate: { $gte: instant } },
          { endDate: { $exists: false }, startDate: { $gte: instant } }
        ]
      },
      {
        temporalKind: { $exists: false },
        endTemporalKind: { $exists: false },
        $or: [
          { endDate: { $gte: instant } },
          { endDate: { $exists: false }, startDate: { $gte: instant } }
        ]
      }
    ]
  };
}

export function buildEventStartOnOrBeforeQuery(boundary: CalendarTemporalFilterBoundary): Record<string, unknown> {
  const calendarDate = boundaryCalendarDate(boundary);
  const instant = boundary.temporalKind === "timestamp"
    ? boundary.instant
    : instantBoundaryForIstanbulCalendarDate(boundary.dateOnly, true);
  return {
    $or: [
      { temporalKind: "date", dateOnlyStart: { $lte: calendarDate } },
      { temporalKind: "timestamp", startDate: { $lte: instant } },
      { temporalKind: { $exists: false }, startDate: { $lte: instant } }
    ]
  };
}

function boundaryCalendarDate(boundary: CalendarTemporalFilterBoundary): string {
  return boundary.temporalKind === "date" ? boundary.dateOnly : istanbulCalendarDate(boundary.instant);
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
