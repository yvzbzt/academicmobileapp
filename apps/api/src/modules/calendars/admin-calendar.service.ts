import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, InternalServerErrorException, NotFoundException, Optional } from "@nestjs/common";
import { assertUniversityTarget, type AdminUniversityAccess } from "../../common/authorization/admin-university-access.js";
import { resolveSourceAuthorityContext } from "../../bootstrap/source-authority-context.js";
import { requireSourceAuthority } from "../../domain/source-authority-enforcement.js";
import type { SourceAuthorityBoundary, SourceAuthorityResource } from "../../domain/source-authority-policy.js";
import { classifyStudentRelevance } from "../../domain/student-relevance-classifier.js";
import type { PdfRepository } from "../pdf/pdf.types.js";
import { loadCompletePdfExtractedEventSnapshot } from "../pdf/pdf-processing.service.js";
import type { CatalogRepository, DepartmentRecord, FacultyRecord } from "../catalog/catalog.types.js";
import { AuditService } from "../audit/audit.service.js";
import { NotificationSchedulingService } from "../notifications/notifications.service.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarRepository, PublishedCalendarReconciliation } from "./calendar.types.js";
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
    if (source.url) {
      await this.requireExternalSourceAuthority(input.universityId, source.url, "publication", "pdf");
    }
    if (!source.binaryIdentityVerified || !source.binarySha256) {
      throw new BadRequestException("A verified PDF binary identity is required to create a calendar draft.");
    }

    const approvedExtractedEvents = (await loadCompletePdfExtractedEventSnapshot(
      this.pdfRepository,
      input.sourcePdfId
    )).extractedEvents.filter((event) => event.status === "approved");
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
        sourcePdfId: input.sourcePdfId,
        sourcePage: event.sourcePage,
        confidenceScore: event.confidenceScore,
        ...classifyStudentRelevance({ title: event.normalizedTitle, body: event.rawText }),
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
          ...classifyStudentRelevance({
            title: event.title.trim(),
            ...(event.description ? { body: event.description.trim() } : {})
          }),
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
      ...classifyStudentRelevance({
        title: event.title.trim(),
        ...(event.courseName?.trim() ? { body: event.courseName.trim() } : {})
      }),
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
    await this.requireCalendarPublicationAuthority(calendar);
    if (calendar.status === "published") {
      // Repair a publication interrupted after the parent calendar was persisted but
      // before its superseded snapshot (or notification jobs) was durably reconciled.
      const storedEvents = await this.calendarRepository.listEventsByCalendar(calendarId);
      const calendarSnapshotEvents = storedEvents.filter((event) => !event.scheduleSeriesId);
      if (
        calendarSnapshotEvents.length === 0
        || calendarSnapshotEvents.some((event) => event.status !== "published")
      ) {
        throw new InternalServerErrorException("Published calendar snapshot is incomplete.");
      }
      const publishedEvents = storedEvents.filter((event) => event.status === "published");
      const reconciled = await this.finalizeCalendarPublication(calendar, publishedEvents);
      return { calendar: reconciled.calendar, publishedEvents, archivedCalendarCount: reconciled.archivedCalendarCount };
    }
    if (calendar.status !== "draft") throw new BadRequestException("Only draft calendars can be published.");

    const draftEvents = await this.calendarRepository.listEventsByCalendar(calendarId);
    if (draftEvents.length === 0) throw new BadRequestException("Calendar must have at least one event before publishing.");
    if (draftEvents.some((event) => event.status !== "approved" && event.status !== "published")) {
      throw new BadRequestException("All calendar events must be approved before publishing.");
    }

    // Child events are prepared first but remain invisible while their parent is a
    // draft. The single parent status update is the snapshot visibility boundary.
    await this.calendarRepository.updateEventsByCalendar(calendarId, { status: "published" });
    const publishedEvents = await this.calendarRepository.listEventsByCalendar(calendarId);
    if (publishedEvents.length !== draftEvents.length || publishedEvents.some((event) => event.status !== "published")) {
      throw new InternalServerErrorException("Calendar events could not be prepared for publication.");
    }
    const publishedCalendar = await this.calendarRepository.updateCalendar(calendarId, {
      status: "published",
      publishedAt: new Date(),
      approvedBy
    });
    if (!publishedCalendar) throw new NotFoundException("Calendar not found.");
    const reconciled = await this.finalizeCalendarPublication(publishedCalendar, publishedEvents);
    await this.auditService?.record({
      actorId: approvedBy,
      action: "calendar.published",
      entityType: "academic_calendar",
      entityId: calendarId,
      metadata: { universityId: calendar.universityId, academicYear: calendar.academicYear, eventCount: publishedEvents.length, archivedCalendarCount: reconciled.archivedCalendarCount }
    });

    return { calendar: reconciled.calendar, publishedEvents, archivedCalendarCount: reconciled.archivedCalendarCount };
  }

  private async reconcilePublishedCalendar(calendar: AcademicCalendarRecord): Promise<{
    calendar: AcademicCalendarRecord;
    archivedCalendarCount: number;
  }> {
    const reconciliation = await this.reconcilePublishedCalendarScope(
      calendar.universityId,
      calendar.academicYear
    );
    const current = await this.calendarRepository.findCalendarById(calendar.id);
    if (reconciliation.winnerCalendarId !== calendar.id || current?.status !== "published") {
      await this.calendarRepository.updateCalendar(calendar.id, { status: "archived" });
      await this.calendarRepository.updateEventsByCalendar(calendar.id, { status: "archived" });
      await this.notificationSchedulingService?.retireCalendarJobs(calendar.id);
      throw new ConflictException("Another calendar won concurrent publication for this university and academic year.");
    }
    return { calendar: current, archivedCalendarCount: reconciliation.archivedCalendarCount };
  }

  private async finalizeCalendarPublication(
    calendar: AcademicCalendarRecord,
    publishedEvents: AcademicEventRecord[]
  ): Promise<{ calendar: AcademicCalendarRecord; archivedCalendarCount: number }> {
    const initial = await this.reconcilePublishedCalendar(calendar);
    await this.notificationSchedulingService?.scheduleCalendarPublished(initial.calendar, publishedEvents);

    // A contender can be superseded while its own producer jobs are being synced.
    // Confirm the deterministic winner after scheduling and retire only this
    // calendar's producer if it lost.
    const confirmation = await this.reconcilePublishedCalendarScope(
      calendar.universityId,
      calendar.academicYear
    );
    const current = await this.calendarRepository.findCalendarById(calendar.id);
    if (confirmation.winnerCalendarId === calendar.id && current?.status === "published") {
      return {
        calendar: current,
        archivedCalendarCount: initial.archivedCalendarCount + confirmation.archivedCalendarCount
      };
    }

    await this.calendarRepository.updateCalendar(calendar.id, { status: "archived" });
    await this.calendarRepository.updateEventsByCalendar(calendar.id, { status: "archived" });
    await this.notificationSchedulingService?.retireCalendarJobs(calendar.id);
    await this.repairPublishedCalendarNotifications(
      calendar.universityId,
      calendar.academicYear,
      confirmation.winnerCalendarId
    );
    throw new ConflictException("Another calendar won concurrent publication for this university and academic year.");
  }

  private async repairPublishedCalendarNotifications(
    universityId: string,
    academicYear: string,
    initialWinnerCalendarId: string | null
  ): Promise<void> {
    if (!this.notificationSchedulingService || !initialWinnerCalendarId) return;
    let winnerCalendarId: string | null = initialWinnerCalendarId;

    for (let attempt = 0; attempt < 3 && winnerCalendarId; attempt += 1) {
      const winner = await this.calendarRepository.findCalendarById(winnerCalendarId);
      if (!winner || winner.status !== "published") {
        const reconciliation = await this.reconcilePublishedCalendarScope(universityId, academicYear);
        winnerCalendarId = reconciliation.winnerCalendarId;
        continue;
      }
      const events = await this.calendarRepository.listEventsByCalendar(winner.id);
      if (events.length === 0 || events.some((event) => event.status !== "published")) {
        throw new InternalServerErrorException("Published calendar snapshot is incomplete.");
      }
      await this.notificationSchedulingService.scheduleCalendarPublished(winner, events);

      const confirmation = await this.reconcilePublishedCalendarScope(universityId, academicYear);
      const current = await this.calendarRepository.findCalendarById(winner.id);
      if (confirmation.winnerCalendarId === winner.id && current?.status === "published") return;
      await this.notificationSchedulingService.retireCalendarJobs(winner.id);
      winnerCalendarId = confirmation.winnerCalendarId;
    }

    throw new InternalServerErrorException("Published calendar notification reconciliation did not stabilize.");
  }

  private async retireArchivedCalendarJobs(calendarIds: readonly string[]): Promise<void> {
    if (!this.notificationSchedulingService) return;
    for (const calendarId of calendarIds) {
      await this.notificationSchedulingService.retireCalendarJobs(calendarId);
    }
  }

  private async reconcilePublishedCalendarScope(
    universityId: string,
    academicYear: string
  ): Promise<PublishedCalendarReconciliation> {
    const observed = await this.calendarRepository.listPublishedCalendars({
      universityId,
      academicYear,
      limit: 5_001,
      offset: 0
    });
    try {
      const reconciliation = await this.calendarRepository.reconcilePublishedCalendars(universityId, academicYear);
      await this.retireArchivedCalendarJobs(reconciliation.archivedCalendarIds);
      return reconciliation;
    } catch (error) {
      // If persistence completed but its response was lost, identify the observed
      // parents that are now archived and finish their child/job cleanup. The
      // original error is still surfaced so the caller can retry idempotently.
      for (const calendar of observed) {
        try {
          const current = await this.calendarRepository.findCalendarById(calendar.id);
          if (current?.status !== "archived") continue;
          await this.calendarRepository.updateEventsByCalendar(calendar.id, { status: "archived" });
          await this.notificationSchedulingService?.retireCalendarJobs(calendar.id);
        } catch {
          // Preserve the reconciliation error; a later retry/worker scan can repair
          // any cleanup whose backing store is still unavailable.
        }
      }
      throw error;
    }
  }

  private async requireCalendarPublicationAuthority(calendar: AcademicCalendarRecord): Promise<void> {
    if (calendar.sourcePdfId) {
      const source = await this.pdfRepository.findPdfSourceById(calendar.sourcePdfId);
      if (!source) throw new NotFoundException("PDF source not found.");
      if (source.universityId !== calendar.universityId) {
        throw new BadRequestException("PDF source does not belong to the selected university.");
      }
      if (source.url) {
        await this.requireExternalSourceAuthority(calendar.universityId, source.url, "publication", "pdf");
      }
      if (!source.binaryIdentityVerified || !source.binarySha256) {
        throw new BadRequestException("A verified PDF binary identity is required to publish a calendar.");
      }
    }
    if (calendar.sourceUrl) {
      await this.requireExternalSourceAuthority(
        calendar.universityId,
        calendar.sourceUrl,
        "publication",
        sourceResourceForUrl(calendar.sourceUrl)
      );
    }
  }

  private async requireExternalSourceAuthority(
    universityId: string,
    url: string,
    boundary: SourceAuthorityBoundary,
    resource: SourceAuthorityResource
  ): Promise<void> {
    const authority = await resolveSourceAuthorityContext({
      universityId,
      ownerAcademicEntityId: universityId,
      scopeType: "university",
      scopeId: universityId
    });
    requireSourceAuthority(authority.context, { boundary, resource, url });
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

function sourceResourceForUrl(url: string): SourceAuthorityResource {
  return /\.pdf(?:$|[?#])/iu.test(url) ? "pdf" : "academic_calendar";
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
