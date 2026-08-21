import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, InternalServerErrorException, NotFoundException, Optional } from "@nestjs/common";
import { assertUniversityTarget, type AdminUniversityAccess } from "../../common/authorization/admin-university-access.js";
import type { PdfRepository } from "../pdf/pdf.types.js";
import type { CatalogRepository, DepartmentRecord, FacultyRecord } from "../catalog/catalog.types.js";
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

interface ManualCalendarEventInput {
  title: string;
  category: AcademicEventCategory;
  term: AcademicTerm;
  startDate: string;
  endDate?: string;
  repeatWeekly?: boolean;
  repeatUntil?: string;
  facultyId?: string;
  departmentId?: string;
  courseName?: string;
  description?: string;
  location?: string;
  notificationRules?: Array<{ offsetDays: number; offsetHours?: number; trigger?: "before" | "at_time" | "approaching"; enabled: boolean }>;
}

@Injectable()
export class AdminCalendarService {
  constructor(
    @Inject("CalendarRepository") private readonly calendarRepository: CalendarRepository,
    @Inject("PdfRepository") private readonly pdfRepository: PdfRepository,
    @Optional() @Inject(NotificationSchedulingService) private readonly notificationSchedulingService?: NotificationSchedulingService,
    @Optional() @Inject(AuditService) private readonly auditService?: AuditService,
    @Optional() @Inject("CatalogRepository") private readonly catalogRepository?: CatalogRepository
  ) {}

  async listCourseSchedulesForAdmin(
    access: AdminUniversityAccess,
    input: { universityId: string; departmentId: string; academicYear?: string }
  ): Promise<AcademicEventRecord[]> {
    assertUniversityTarget(access, input.universityId);
    await this.requireDepartmentInUniversity(input.universityId, input.departmentId);
    return this.listCourseSchedules(input);
  }

  async createCourseScheduleSeriesForAdmin(
    access: AdminUniversityAccess,
    input: Parameters<AdminCalendarService["createCourseScheduleSeries"]>[0]
  ) {
    assertUniversityTarget(access, input.universityId);
    await this.requireCourseScheduleUnit(input.universityId, input.facultyId, input.departmentId);
    return this.createCourseScheduleSeries(input);
  }

  async archiveCourseScheduleSeriesForAdmin(access: AdminUniversityAccess, seriesId: string) {
    return this.archiveCourseScheduleSeries(
      seriesId,
      access.kind === "university" ? access.universityId : undefined
    );
  }

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
    events: ManualCalendarEventInput[];
  }): Promise<CalendarDraftResponse> {
    if (input.events.length === 0) throw new BadRequestException("At least one event is required.");
    const expandedEvents = input.events.flatMap(expandWeeklyManualEvent);
    if (expandedEvents.length > 500) throw new BadRequestException("Manual calendar cannot contain more than 500 expanded events.");
    const validatedEvents = expandedEvents.map((event) => ({
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
          ...(event.courseName?.trim() ? { courseName: event.courseName.trim() } : {}),
          ...(event.description ? { description: event.description.trim() } : {}),
          ...(event.location?.trim() ? { location: event.location.trim() } : {}),
          ...temporal,
          timezone: "Europe/Istanbul" as const,
          status: "approved" as const,
          notificationRules: event.notificationRules?.length ? event.notificationRules : [{ offsetDays: 7, enabled: true }, { offsetDays: 1, enabled: true }, { offsetDays: 0, trigger: "at_time" as const, enabled: true }]
        };
      })
    );

    return { calendar, events };
  }

  async createCourseScheduleSeries(input: {
    universityId: string;
    facultyId: string;
    departmentId: string;
    academicYear: string;
    term: AcademicTerm;
    title: string;
    courseName?: string;
    startDate: string;
    endDate?: string;
    repeatWeekly?: boolean;
    repeatUntil?: string;
    location?: string;
  }): Promise<{ seriesId: string; calendar: AcademicCalendarRecord; events: AcademicEventRecord[] }> {
    const calendar = await this.calendarRepository.findPublishedCalendar(input.universityId, input.academicYear);
    if (!calendar) throw new BadRequestException("Publish the university academic calendar before adding a course schedule.");

    const occurrences = expandWeeklyManualEvent({
      title: input.title,
      ...(input.courseName ? { courseName: input.courseName } : {}),
      ...(input.location ? { location: input.location } : {}),
      category: "course_schedule",
      term: input.term,
      startDate: input.startDate,
      ...(input.endDate ? { endDate: input.endDate } : {}),
      ...(input.repeatWeekly ? { repeatWeekly: true } : {}),
      ...(input.repeatUntil ? { repeatUntil: input.repeatUntil } : {}),
      facultyId: input.facultyId,
      departmentId: input.departmentId,
      notificationRules: []
    });
    const seriesId = randomUUID();
    const prepared = occurrences.map((event) => ({ event, temporal: academicTemporalFields(event.startDate, event.endDate) }));
    const events = await this.calendarRepository.createEvents(prepared.map(({ event, temporal }) => ({
      calendarId: calendar.id,
      universityId: input.universityId,
      facultyId: input.facultyId,
      departmentId: input.departmentId,
      academicYear: input.academicYear,
      term: input.term,
      category: "course_schedule" as const,
      title: event.title.trim(),
      ...(event.courseName?.trim() ? { courseName: event.courseName.trim() } : {}),
      ...(event.location?.trim() ? { location: event.location.trim() } : {}),
      scheduleSeriesId: seriesId,
      ...temporal,
      timezone: "Europe/Istanbul" as const,
      status: "published" as const,
      notificationRules: []
    })));
    return { seriesId, calendar, events };
  }

  async listCourseSchedules(input: { universityId: string; departmentId: string; academicYear?: string }): Promise<AcademicEventRecord[]> {
    const events = await this.calendarRepository.listPublishedEvents({
      universityId: input.universityId,
      departmentId: input.departmentId,
      category: "course_schedule",
      limit: 500,
      offset: 0
    });
    return events.filter((event) => event.departmentId === input.departmentId)
      .filter((event) => input.academicYear ? event.academicYear === input.academicYear : true);
  }

  async archiveCourseScheduleSeries(seriesId: string, universityId?: string): Promise<{ seriesId: string; archivedCount: number }> {
    if (!seriesId.trim()) throw new BadRequestException("Course schedule series is required.");
    const archivedCount = await this.calendarRepository.archiveEventsByScheduleSeries(seriesId, universityId);
    if (archivedCount === 0) throw new NotFoundException("Course schedule series not found.");
    return { seriesId, archivedCount };
  }

  private async requireCourseScheduleUnit(universityId: string, facultyId: string, departmentId: string): Promise<void> {
    const catalog = this.requireCatalogRepository();
    const faculty = (await catalog.listFaculties(universityId, "active"))
      .find((candidate) => candidate.id === facultyId && candidate.universityId === universityId);
    if (!faculty) throw new NotFoundException("Academic unit not found.");
    const department = (await catalog.listDepartments(faculty.id, "active"))
      .find((candidate) => candidate.id === departmentId && candidate.universityId === universityId);
    if (!department) throw new NotFoundException("Academic unit not found.");
  }

  private async requireDepartmentInUniversity(universityId: string, departmentId: string): Promise<DepartmentRecord> {
    const catalog = this.requireCatalogRepository();
    const faculties = await catalog.listFaculties(universityId);
    const departments = (await Promise.all(
      faculties.map((faculty: FacultyRecord) => catalog.listDepartments(faculty.id))
    )).flat();
    const department = departments.find((candidate) => (
      candidate.id === departmentId && candidate.universityId === universityId
    ));
    if (!department) throw new NotFoundException("Academic unit not found.");
    return department;
  }

  private requireCatalogRepository(): CatalogRepository {
    if (!this.catalogRepository) {
      throw new InternalServerErrorException("Catalog repository is required for course-schedule authorization.");
    }
    return this.catalogRepository;
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

function expandWeeklyManualEvent(event: ManualCalendarEventInput): ManualCalendarEventInput[] {
  const { repeatWeekly: _repeatWeekly, repeatUntil: _repeatUntil, ...base } = event;
  if (!event.repeatWeekly) return [base];
  if (!event.repeatUntil || !/^\d{4}-\d{2}-\d{2}$/u.test(event.repeatUntil)) {
    throw new BadRequestException("Weekly events require a YYYY-MM-DD repeatUntil date.");
  }

  const firstCalendarDate = event.startDate.slice(0, 10);
  if (event.repeatUntil < firstCalendarDate) {
    throw new BadRequestException("Weekly event repeatUntil cannot be before startDate.");
  }

  const occurrences: ManualCalendarEventInput[] = [];
  let startDate = event.startDate;
  let endDate = event.endDate;
  for (let count = 0; count < 54 && startDate.slice(0, 10) <= event.repeatUntil; count += 1) {
    occurrences.push({ ...base, startDate, ...(endDate ? { endDate } : {}) });
    startDate = addTemporalDays(startDate, 7);
    if (endDate) endDate = addTemporalDays(endDate, 7);
  }
  return occurrences;
}

function addTemporalDays(value: string, days: number): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  const instant = new Date(value);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString();
}
