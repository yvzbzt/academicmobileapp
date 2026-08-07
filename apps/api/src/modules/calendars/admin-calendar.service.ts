import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PdfRepository } from "../pdf/pdf.types.js";
import { AuditService } from "../audit/audit.service.js";
import { NotificationSchedulingService } from "../notifications/notifications.service.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarRepository } from "./calendar.types.js";
import type { AcademicEventCategory, AcademicTerm } from "../../domain/academic-event.types.js";
import { academicTemporalFields, academicTemporalFieldsFromRecord } from "./calendar-temporal.js";

export interface CreateCalendarDraftInput {
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  academicYear: string;
  title: string;
  sourcePdfId: string;
  createdBy: string;
}

export interface CalendarDraftResponse {
  calendar: AcademicCalendarRecord;
  events: AcademicEventRecord[];
}

export interface PublishCalendarResponse {
  calendar: AcademicCalendarRecord;
  publishedEvents: AcademicEventRecord[];
  archivedCalendarCount: number;
}

@Injectable()
export class AdminCalendarService {
  constructor(
    @Inject("CalendarRepository") private readonly calendarRepository: CalendarRepository,
    @Inject("PdfRepository") private readonly pdfRepository: PdfRepository,
    @Optional() @Inject(NotificationSchedulingService) private readonly notificationSchedulingService?: NotificationSchedulingService,
    @Optional() @Inject(AuditService) private readonly auditService?: AuditService
  ) {}

  async createDraftFromApprovedExtractedEvents(input: CreateCalendarDraftInput): Promise<CalendarDraftResponse> {
    const source = await this.pdfRepository.findPdfSourceById(input.sourcePdfId);
    if (!source) throw new NotFoundException("PDF source not found.");
    if (source.universityId !== input.universityId) throw new BadRequestException("PDF source does not belong to the selected university.");
    if (source.academicYear !== input.academicYear) throw new BadRequestException("PDF source academic year does not match calendar academic year.");

    const approvedExtractedEvents = await this.pdfRepository.listExtractedEvents({
      pdfSourceId: input.sourcePdfId,
      status: "approved",
      limit: 500,
      offset: 0
    });
    if (approvedExtractedEvents.length === 0) throw new BadRequestException("At least one approved extracted event is required to create a calendar draft.");
    const validatedEvents = approvedExtractedEvents.map((event) => ({
      event,
      temporal: academicTemporalFieldsFromRecord(event)
    }));

    const publishedCalendar = await this.calendarRepository.findPublishedCalendar(input.universityId, input.academicYear);
    const calendar = await this.calendarRepository.createCalendar({
      universityId: input.universityId,
      academicYear: input.academicYear,
      title: input.title.trim(),
      status: "draft",
      version: (publishedCalendar?.version ?? 0) + 1,
      sourcePdfId: input.sourcePdfId,
      ...(source.url ? { sourceUrl: source.url } : {}),
      createdBy: input.createdBy
    });

    const events = await this.calendarRepository.createEvents(
      validatedEvents.map(({ event, temporal }) => ({
        calendarId: calendar.id,
        universityId: event.universityId,
        ...(input.facultyId ? { facultyId: input.facultyId } : {}),
        ...(input.departmentId ? { departmentId: input.departmentId } : {}),
        academicYear: event.academicYear,
        term: event.term,
        category: event.normalizedCategory,
        title: event.normalizedTitle,
        ...temporal,
        timezone: event.timezone,
        originalDateText: event.originalDateText,
        originalText: event.rawText,
        sourcePdfId: event.pdfSourceId,
        sourcePage: event.sourcePage,
        confidenceScore: event.confidenceScore,
        status: "approved",
        notificationRules: [
          { offsetDays: 7, enabled: true },
          { offsetDays: 1, enabled: true },
          { offsetDays: 0, enabled: true }
        ]
      }))
    );

    return { calendar, events };
  }

  async createManualDraft(input: {
    universityId: string;
    academicYear: string;
    title: string;
    createdBy: string;
    events: Array<{
      title: string;
      category: AcademicEventCategory;
      term: AcademicTerm;
      startDate: string;
      endDate?: string;
      facultyId?: string;
      departmentId?: string;
      description?: string;
      notificationRules?: Array<{ offsetDays: number; offsetHours?: number; trigger?: "before" | "at_time" | "approaching"; enabled: boolean }>;
    }>;
  }): Promise<CalendarDraftResponse> {
    if (input.events.length === 0) throw new BadRequestException("At least one event is required.");
    const validatedEvents = input.events.map((event) => ({
      event,
      temporal: academicTemporalFields(event.startDate, event.endDate)
    }));
    const publishedCalendar = await this.calendarRepository.findPublishedCalendar(input.universityId, input.academicYear);
    const calendar = await this.calendarRepository.createCalendar({
      universityId: input.universityId,
      academicYear: input.academicYear,
      title: input.title.trim(),
      status: "draft",
      version: (publishedCalendar?.version ?? 0) + 1,
      createdBy: input.createdBy
    });

    const events = await this.calendarRepository.createEvents(
      validatedEvents.map(({ event, temporal }) => {
        return {
          calendarId: calendar.id,
          universityId: input.universityId,
          ...(event.facultyId ? { facultyId: event.facultyId } : {}),
          ...(event.departmentId ? { departmentId: event.departmentId } : {}),
          academicYear: input.academicYear,
          term: event.term,
          category: event.category,
          title: event.title.trim(),
          ...(event.description ? { description: event.description.trim() } : {}),
          ...temporal,
          timezone: "Europe/Istanbul" as const,
          status: "approved" as const,
          notificationRules: event.notificationRules?.length ? event.notificationRules : [{ offsetDays: 7, enabled: true }, { offsetDays: 1, enabled: true }, { offsetDays: 0, trigger: "at_time" as const, enabled: true }]
        };
      })
    );

    return { calendar, events };
  }

  async updateCalendar(calendarId: string, input: { title?: string }): Promise<AcademicCalendarRecord> {
    const calendar = await this.calendarRepository.findCalendarById(calendarId);
    if (!calendar) throw new NotFoundException("Calendar not found.");
    if (calendar.status !== "draft") throw new BadRequestException("Only draft calendars can be updated.");
    const updated = await this.calendarRepository.updateCalendar(calendarId, {
      ...(input.title ? { title: input.title.trim() } : {})
    });
    if (!updated) throw new NotFoundException("Calendar not found.");
    return updated;
  }

  async publishCalendar(calendarId: string, approvedBy: string): Promise<PublishCalendarResponse> {
    const calendar = await this.calendarRepository.findCalendarById(calendarId);
    if (!calendar) throw new NotFoundException("Calendar not found.");
    if (calendar.status === "published") {
      // Repair a publication interrupted after the parent calendar was persisted but
      // before its child events (or notification jobs) were durably reconciled.
      await this.calendarRepository.updateEventsByCalendar(calendarId, { status: "published" });
      const publishedEvents = await this.calendarRepository.listEventsByCalendar(calendarId);
      await this.notificationSchedulingService?.scheduleCalendarPublished(calendar, publishedEvents);
      return { calendar, publishedEvents, archivedCalendarCount: 0 };
    }
    if (calendar.status !== "draft") throw new BadRequestException("Only draft calendars can be published.");

    const draftEvents = await this.calendarRepository.listEventsByCalendar(calendarId);
    if (draftEvents.length === 0) throw new BadRequestException("Calendar must have at least one event before publishing.");
    if (draftEvents.some((event) => event.status !== "approved")) throw new BadRequestException("All calendar events must be approved before publishing.");

    const archivedCalendarCount = await this.calendarRepository.archivePublishedCalendars(calendar.universityId, calendar.academicYear);
    const publishedCalendar = await this.calendarRepository.updateCalendar(calendarId, {
      status: "published",
      publishedAt: new Date(),
      approvedBy
    });
    if (!publishedCalendar) throw new NotFoundException("Calendar not found.");
    await this.calendarRepository.updateEventsByCalendar(calendarId, { status: "published" });
    const publishedEvents = await this.calendarRepository.listEventsByCalendar(calendarId);
    await this.notificationSchedulingService?.scheduleCalendarPublished(publishedCalendar, publishedEvents);
    await this.auditService?.record({
      actorId: approvedBy,
      action: "calendar.published",
      entityType: "academic_calendar",
      entityId: calendarId,
      metadata: { universityId: calendar.universityId, academicYear: calendar.academicYear, eventCount: publishedEvents.length, archivedCalendarCount }
    });

    return { calendar: publishedCalendar, publishedEvents, archivedCalendarCount };
  }

  async rollbackCalendar(calendarId: string): Promise<AcademicCalendarRecord> {
    const calendar = await this.calendarRepository.findCalendarById(calendarId);
    if (!calendar) throw new NotFoundException("Calendar not found.");
    if (calendar.status !== "published") throw new BadRequestException("Only published calendars can be rolled back in the MVP flow.");
    const rolledBack = await this.calendarRepository.updateCalendar(calendarId, { status: "archived" });
    if (!rolledBack) throw new NotFoundException("Calendar not found.");
    await this.calendarRepository.updateEventsByCalendar(calendarId, { status: "archived" });
    await this.notificationSchedulingService?.retireCalendarJobs(calendarId);
    await this.auditService?.record({
      actorId: "system",
      action: "calendar.rollback_archived",
      entityType: "academic_calendar",
      entityId: calendarId,
      metadata: { universityId: calendar.universityId, academicYear: calendar.academicYear }
    });
    return rolledBack;
  }
}
