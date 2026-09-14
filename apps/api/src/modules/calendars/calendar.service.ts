import { createHmac, timingSafeEqual } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException, Optional, UnauthorizedException } from "@nestjs/common";
import type { MobileAcademicPdfApprovedEventDto, MobileAcademicPdfApprovedRowDto, MobileAcademicPdfSourceDto, TrustedAcademicContentCollectionDto, TrustedAcademicContentDto } from "../../../../../packages/shared/src/contracts.js";
import type { AcademicEventCategory } from "../../domain/academic-event.types.js";
import { findVerifiedAcademicUnitSource, findVerifiedUniversitySource } from "../../bootstrap/verified-source-registry.js";
import { academicContentLogicalIdentityKey, canonicalizeContentUrl, compareAcademicContentDuplicateRecency, isOfficialContentUrl, normalizeDisplayText, officialDomainForUrl, toTrustedAcademicContentDto } from "../announcements/announcement-content-trust.js";
import type { AnnouncementRepository, AnnouncementSourceRecord } from "../announcements/announcements.types.js";
import type { AuthRepository } from "../auth/auth.types.js";
import type { CatalogRepository, DepartmentRecord, FacultyRecord, UniversityRecord } from "../catalog/catalog.types.js";
import type { PdfRepository, PdfSourceRecord } from "../pdf/pdf.types.js";
import type { CalendarScopeView } from "./calendar.dto.js";
import { isProductionSecret } from "../../config/production-secret.js";
import { isAcceptableAcademicYear, isUnitSpecificCalendarSource } from "./calendar-ingestion.service.js";
import { compareEventStart, instantBoundaryForIstanbulCalendarDate, temporalStartValue } from "./calendar-temporal.js";
import type { AcademicUnitScheduleCandidate, AcademicUnitScheduleSourceRecord, AcademicUnitScheduleSourceRepository } from "./academic-unit-schedule.types.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarRepository, CalendarTemporalFilterBoundary } from "./calendar.types.js";

export type AcademicPdfProcessingMode = "device_text" | "server_ocr";

export interface CalendarWithEventsResponse {
  calendar: AcademicCalendarRecord;
  events: AcademicEventRecord[];
  scope: CalendarScopeView;
  sourceStatus: "parsed" | "source_only";
  pdfProcessingMode?: AcademicPdfProcessingMode;
  devicePdf?: MobileAcademicPdfSourceDto;
}

export interface DepartmentScheduleResponse {
  profile: {
    universityId: string;
    facultyId?: string;
    departmentId?: string;
  };
  events: AcademicEventRecord[];
  sourceUrl?: string;
  sourceStatus: "parsed" | "source_only" | "missing";
  pdfProcessingMode?: AcademicPdfProcessingMode;
  devicePdf?: MobileAcademicPdfSourceDto;
}

export interface SummerSchoolRequirementRecord {
  message: string;
  date?: string;
  sourceUrl?: string;
  eventId?: string;
}

export interface SummerSchoolUniversityOption {
  universityId: string;
  universityName: string;
  academicYear: string;
  sourceUrl?: string;
  events: AcademicEventRecord[];
  matchingDepartments?: SummerSchoolDepartmentMatch[];
}

export interface SummerSchoolDepartmentMatch {
  facultyId: string;
  facultyName: string;
  departmentId: string;
  departmentName: string;
  educationLevel: DepartmentRecord["educationLevel"];
}

export interface MySummerSchoolResponse {
  profile: {
    universityId: string;
    universityName?: string;
    facultyId?: string;
    facultyName?: string;
    departmentId?: string;
    departmentName?: string;
  };
  requirements: SummerSchoolRequirementRecord[];
  ownAnnouncements: TrustedAcademicContentDto[];
  sameDepartmentAnnouncements: TrustedAcademicContentDto[];
  announcementStatus: Pick<TrustedAcademicContentCollectionDto, "state" | "sourceCount" | "failedSourceCount">;
  sameDepartmentOptions: SummerSchoolUniversityOption[];
  generatedAt: Date;
}

interface SummerSchoolAnnouncementSelection {
  items: TrustedAcademicContentDto[];
  sources: AnnouncementSourceRecord[];
}

export interface CalendarIntegrationLinksResponse {
  feedUrl: string;
  webcalUrl: string;
  appleSubscribeUrl: string;
  googleSubscribeUrl: string;
  generatedAt: Date;
}

export interface CalendarFeedResponse {
  fileName: string;
  contentType: "text/calendar; charset=utf-8";
  content: string;
}

const summerSchoolCategories: AcademicEventCategory[] = ["summer_school_registration", "summer_school_start", "summer_school_end"];
const departmentExamScheduleCategories: AcademicEventCategory[] = ["department_exam_schedule", "midterm_exam", "final_exam", "makeup_exam", "single_course_exam"];
const summerRequirementPattern = /\b(yaz okulu|basvuru|başvuru|kayit|kayıt|sart|şart|kosul|koşul|ucret|ücret|kontenjan|ders alma|ders sec|ders seç)\b/iu;
const MOBILE_PDF_MAX_BYTES = 12 * 1024 * 1024;
const MOBILE_PDF_CAPABILITY_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class CalendarService {
  constructor(
    @Inject("CalendarRepository") private readonly calendarRepository: CalendarRepository,
    @Inject("AuthRepository") private readonly authRepository: AuthRepository,
    @Optional() @Inject("CatalogRepository") private readonly catalogRepository?: CatalogRepository,
    @Optional() @Inject("AnnouncementRepository") private readonly announcementRepository?: AnnouncementRepository,
    @Optional() @Inject("PdfRepository") private readonly pdfRepository?: PdfRepository,
    @Optional() @Inject("AcademicUnitScheduleSourceRepository") private readonly scheduleSourceRepository?: AcademicUnitScheduleSourceRepository
  ) {}

  async getMyCalendar(userId: string): Promise<CalendarWithEventsResponse> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");

    const calendar = await this.findPublishedCalendar(user.universityId);
    if (!calendar) throw new NotFoundException("Selected university academic calendar is not available yet.");

    const events = (await this.calendarRepository.listPublishedEvents({
      calendarId: calendar.id,
      universityId: user.universityId,
      ...(user.facultyId ? { facultyId: user.facultyId } : {}),
      ...(user.departmentId ? { departmentId: user.departmentId } : {}),
      limit: 500,
      offset: 0
    })).filter(isPrimaryAcademicCalendarEvent);

    const responseEvents = events.slice(0, 200);
    const pdf = await this.calendarPdfPresentation(calendar, responseEvents);
    return {
      calendar,
      events: responseEvents,
      scope: "university",
      sourceStatus: events.length > 0 ? "parsed" : "source_only",
      ...pdf
    };
  }

  async getMyTrustedCalendarEvent(userId: string, eventId: string): Promise<AcademicEventRecord> {
    const notFound = () => new NotFoundException("Trusted calendar event not found.");
    const user = await this.authRepository.findUserById(userId);
    if (!user?.universityId || !eventId.trim()) throw notFound();

    const event = await this.calendarRepository.findPublishedEventByIdInScope(eventId, {
      universityId: user.universityId,
      ...(user.facultyId ? { facultyId: user.facultyId } : {}),
      ...(user.departmentId ? { departmentId: user.departmentId } : {})
    });
    if (!event) throw notFound();

    const calendar = await this.calendarRepository.findCalendarById(event.calendarId);
    if (
      !calendar
      || calendar.status !== "published"
      || calendar.universityId !== user.universityId
      || calendar.universityId !== event.universityId
    ) throw notFound();
    return event;
  }

  async getUniversityCalendar(universityId: string, academicYear?: string): Promise<CalendarWithEventsResponse> {
    const calendar = await this.findPublishedCalendar(universityId, academicYear);
    if (!calendar) throw new NotFoundException("Selected university academic calendar is not available yet.");
    const events = (await this.calendarRepository.listPublishedEvents({
      calendarId: calendar.id,
      universityId,
      limit: 500,
      offset: 0
    })).filter(isUniversityAcademicCalendarEvent).slice(0, 200);
    const pdf = await this.calendarPdfPresentation(calendar, events);
    return {
      calendar,
      events,
      scope: "university",
      sourceStatus: events.length > 0 ? "parsed" : "source_only",
      ...pdf
    };
  }

  async getUpcomingEvents(userId: string, limit = 10): Promise<AcademicEventRecord[]> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");
    return this.calendarRepository.listUpcomingEvents({
      universityId: user.universityId,
      ...(user.facultyId ? { facultyId: user.facultyId } : {}),
      ...(user.departmentId ? { departmentId: user.departmentId } : {}),
      fromDate: new Date(),
      limit: Math.min(Math.max(limit, 1), 50)
    });
  }

  async getMyCourseSchedules(userId: string): Promise<DepartmentScheduleResponse> {
    return this.getMyDepartmentSchedules(userId, ["course_schedule"], "courseScheduleUrl");
  }

  async getMyExamSchedules(userId: string): Promise<DepartmentScheduleResponse> {
    return this.getMyDepartmentSchedules(userId, departmentExamScheduleCategories, "examScheduleUrl");
  }

  async getEventDetail(eventId: string): Promise<AcademicEventRecord> {
    const event = await this.calendarRepository.findPublishedEventById(eventId);
    if (!event) throw new NotFoundException("Event not found.");
    return event;
  }

  async searchEvents(input: { category?: AcademicEventCategory; startBoundary?: CalendarTemporalFilterBoundary; endBoundary?: CalendarTemporalFilterBoundary; limit?: number; offset?: number }): Promise<AcademicEventRecord[]> {
    return this.calendarRepository.listPublishedEvents({
      ...(input.category ? { category: input.category } : {}),
      ...(input.startBoundary ? { startBoundary: input.startBoundary } : {}),
      ...(input.endBoundary ? { endBoundary: input.endBoundary } : {}),
      limit: Math.min(Math.max(input.limit ?? 50, 1), 100),
      offset: Math.max(input.offset ?? 0, 0)
    });
  }

  async getMySummerSchool(userId: string): Promise<MySummerSchoolResponse> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");

    const [university, faculty, department] = await this.resolveAcademicProfile(user.universityId, user.facultyId, user.departmentId);
    const userSummerEvents = await this.listSummerSchoolEvents({
      universityId: user.universityId,
      ...(user.facultyId ? { facultyId: user.facultyId } : {}),
      ...(user.departmentId ? { departmentId: user.departmentId } : {}),
      limit: 300
    });
    const requirements = userSummerEvents
      .filter((event) => summerRequirementPattern.test(`${event.title} ${event.description ?? ""} ${event.originalText ?? ""}`))
      .map((event) => {
        const sourceUrl = sourceUrlFromEvent(event, university);
        return {
          message: normalizeDisplayText(event.title, 320) || "Resmî yaz okulu bilgisi",
          date: temporalStartValue(event),
          eventId: event.id,
          ...(sourceUrl ? { sourceUrl } : {})
        };
      });

    const [ownAnnouncementSelection, sameDepartmentAnnouncementSelection, sameDepartmentOptions] = await Promise.all([
      this.findOwnSummerSchoolAnnouncements({
        universityId: user.universityId,
        ...(user.facultyId ? { facultyId: user.facultyId } : {}),
        ...(user.departmentId ? { departmentId: user.departmentId } : {})
      }),
      department
        ? this.findSameDepartmentSummerSchoolAnnouncements(department, {
          universityId: user.universityId,
          ...(user.facultyId ? { facultyId: user.facultyId } : {}),
          ...(user.departmentId ? { departmentId: user.departmentId } : {})
        })
        : Promise.resolve({ items: [], sources: [] } satisfies SummerSchoolAnnouncementSelection),
      department
        ? this.findSameDepartmentSummerSchoolOptions(department, user.universityId)
        : Promise.resolve([])
    ]);

    return {
      profile: {
        universityId: user.universityId,
        ...(university ? { universityName: university.name } : {}),
        ...(user.facultyId ? { facultyId: user.facultyId } : {}),
        ...(faculty ? { facultyName: faculty.name } : {}),
        ...(user.departmentId ? { departmentId: user.departmentId } : {}),
        ...(department ? { departmentName: department.name } : {})
      },
      requirements,
      ownAnnouncements: ownAnnouncementSelection.items.map((item) => attachResolvedAcademicHierarchy(
        item,
        university,
        faculty,
        department
      )),
      sameDepartmentAnnouncements: sameDepartmentAnnouncementSelection.items,
      announcementStatus: summerSchoolAnnouncementStatus([ownAnnouncementSelection, sameDepartmentAnnouncementSelection]),
      sameDepartmentOptions,
      generatedAt: new Date()
    };
  }

  async getMyCalendarIntegrationLinks(userId: string, apiBaseUrl: string): Promise<CalendarIntegrationLinksResponse> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");

    const token = signCalendarFeedToken(user.id);
    const normalizedBaseUrl = apiBaseUrl.replace(/\/+$/u, "");
    const feedUrl = `${normalizedBaseUrl}/calendar/integrations/feed/${encodeURIComponent(token)}.ics`;
    const webcalUrl = feedUrl.replace(/^https?:/iu, "webcal:");
    return {
      feedUrl,
      webcalUrl,
      appleSubscribeUrl: webcalUrl,
      googleSubscribeUrl: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl)}`,
      generatedAt: new Date()
    };
  }

  async getMyCalendarFeedByToken(token: string): Promise<CalendarFeedResponse> {
    const userId = verifyCalendarFeedToken(token);
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");

    const [calendarResponse, courseSchedules, examSchedules, summerSchool, summerEvents] = await Promise.all([
      this.getMyCalendar(userId),
      this.getMyCourseSchedules(userId),
      this.getMyExamSchedules(userId),
      this.getMySummerSchool(userId),
      this.listSummerSchoolEvents({
        universityId: user.universityId,
        ...(user.facultyId ? { facultyId: user.facultyId } : {}),
        ...(user.departmentId ? { departmentId: user.departmentId } : {}),
        limit: 300
      })
    ]);
    const events = dedupeCalendarEvents([
      ...calendarResponse.events,
      ...courseSchedules.events,
      ...examSchedules.events,
      ...summerEvents
    ]);
    const universityName = summerSchool.profile.universityName ?? user.universityId;
    const calendarName = `${universityName} Akademik Takvim`;

    return {
      fileName: "academic-mobile-calendar.ics",
      contentType: "text/calendar; charset=utf-8",
      content: renderIcsCalendar({
        name: calendarName,
        description: "Academic Mobile App akademik takvim aboneligi",
        events
      })
    };
  }

  private async getMyDepartmentSchedules(userId: string, categories: AcademicEventCategory[], sourceField: "courseScheduleUrl" | "examScheduleUrl"): Promise<DepartmentScheduleResponse> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");
    const universityId = user.universityId;
    const facultyId = user.facultyId;
    const departmentId = user.departmentId;
    const profile = {
      universityId,
      ...(facultyId ? { facultyId } : {}),
      ...(departmentId ? { departmentId } : {})
    };
    if (!departmentId) return { profile, events: [], sourceStatus: "missing" };

    const groups = await Promise.all(categories.map((category) =>
      this.calendarRepository.listPublishedEvents({
        universityId,
        ...(facultyId ? { facultyId } : {}),
        departmentId,
        category,
        limit: 500,
        offset: 0
      })
    ));

    const events = groups
      .flat()
      .filter((event) => event.departmentId === departmentId)
      .filter((event) => isAcceptableAcademicYear(event.academicYear))
      .sort(compareEventStart)
      .slice(0, 500);

    const sourceUrl = await this.findDepartmentScheduleSource({
      universityId,
      ...(facultyId ? { facultyId } : {}),
      departmentId,
      sourceField
    });
    const pdf = await this.schedulePdfPresentation(events, sourceUrl, {
      universityId,
      ...(facultyId ? { facultyId } : {}),
      departmentId,
      scheduleType: sourceField === "courseScheduleUrl" ? "course_schedule" : "exam_schedule"
    });

    return {
      profile,
      events,
      ...(sourceUrl ? { sourceUrl } : {}),
      sourceStatus: events.length > 0 ? "parsed" : sourceUrl ? "source_only" : "missing",
      ...pdf
    };
  }

  private async calendarPdfPresentation(
    calendar: AcademicCalendarRecord,
    events: AcademicEventRecord[]
  ): Promise<{
    pdfProcessingMode?: AcademicPdfProcessingMode;
    devicePdf?: MobileAcademicPdfSourceDto;
  }> {
    if (!calendar.sourcePdfId || !this.pdfRepository) return {};
    const source = await this.pdfRepository.findPdfSourceById(calendar.sourcePdfId);
    const pdfProcessingMode = pdfProcessingModeFromSource(source);
    if (!pdfProcessingMode) return {};
    const devicePdf = pdfProcessingMode === "device_text"
      ? mobileCalendarPdfCapability(calendar, source, events)
      : undefined;
    return {
      pdfProcessingMode,
      ...(devicePdf ? { devicePdf } : {})
    };
  }

  private async schedulePdfPresentation(
    events: AcademicEventRecord[],
    sourceUrl: string | undefined,
    scope: {
      universityId: string;
      facultyId?: string;
      departmentId: string;
      scheduleType: "course_schedule" | "exam_schedule";
    }
  ): Promise<{ pdfProcessingMode?: AcademicPdfProcessingMode; devicePdf?: MobileAcademicPdfSourceDto }> {
    if (!this.scheduleSourceRepository || !sourceUrl) return {};
    const sourceIds = new Set(events.map((event) => event.scheduleSourceId).filter((id): id is string => Boolean(id)));
    if (sourceIds.size !== 1) return {};
    const sourceId = [...sourceIds][0]!;
    const source = await this.scheduleSourceRepository.findSourceById(sourceId);
    if (!source || !sameCanonicalUrl(source.sourceUrl, sourceUrl)) return {};
    const pdfProcessingMode = pdfProcessingModeFromScheduleSource(source);
    if (!pdfProcessingMode) return {};
    const devicePdf = pdfProcessingMode === "device_text"
      ? mobileSchedulePdfCapability(source, events, scope)
      : undefined;
    return {
      pdfProcessingMode,
      ...(devicePdf ? { devicePdf } : {})
    };
  }

  private async findDepartmentScheduleSource(input: { universityId: string; facultyId?: string; departmentId: string; sourceField: "courseScheduleUrl" | "examScheduleUrl" }): Promise<string | undefined> {
    const departments = input.facultyId && this.catalogRepository ? await this.catalogRepository.listDepartments(input.facultyId, "active") : [];
    const department = departments.find((item) => item.id === input.departmentId);
    const verified = await findVerifiedAcademicUnitSource({
      ...(input.facultyId ? { facultyId: input.facultyId } : {}),
      departmentId: input.departmentId
    });
    return department?.[input.sourceField] ?? verified?.[input.sourceField];
  }

  private async findPublishedCalendar(universityId: string, academicYear?: string): Promise<AcademicCalendarRecord | null> {
    const existing = await this.calendarRepository.findPublishedCalendar(universityId, academicYear);
    if (!existing || (!academicYear && !isAcceptableAcademicYear(existing.academicYear))) return null;
    return isUnitSpecificCalendar(existing) ? null : existing;
  }

  private async listSummerSchoolEvents(input: { universityId?: string; facultyId?: string; departmentId?: string; limit: number }): Promise<AcademicEventRecord[]> {
    const perCategoryLimit = Math.max(1, Math.ceil(input.limit / summerSchoolCategories.length));
    const groups = await Promise.all(summerSchoolCategories.map((category) =>
      this.calendarRepository.listPublishedEvents({
        ...(input.universityId ? { universityId: input.universityId } : {}),
        ...(input.facultyId ? { facultyId: input.facultyId } : {}),
        ...(input.departmentId ? { departmentId: input.departmentId } : {}),
        category,
        limit: perCategoryLimit,
        offset: 0
      })
    ));

    return groups
      .flat()
      .filter((event) => isAcceptableAcademicYear(event.academicYear))
      .sort(compareEventStart);
  }

  private async findSameDepartmentSummerSchoolOptions(department: DepartmentRecord, selectedUniversityId: string): Promise<SummerSchoolUniversityOption[]> {
    const departmentName = foldForMatch(department.name);
    const allSummerEvents = await this.listSummerSchoolEvents({ limit: 900 });
    const eventsOutsideSelectedUniversity = allSummerEvents.filter((event) => event.universityId !== selectedUniversityId);
    const matchingDepartmentsByUniversity = await this.findMatchingDepartmentsBySummerEventUniversity(department, eventsOutsideSelectedUniversity);
    const matchedEvents = allSummerEvents.filter((event) => {
      if (event.universityId === selectedUniversityId) return false;
      const matchingDepartments = matchingDepartmentsByUniversity.get(event.universityId) ?? [];
      if (event.departmentId) {
        if (matchingDepartments.some((match) => match.departmentId === event.departmentId)) return true;
        const searchable = foldForMatch(`${event.title} ${event.description ?? ""} ${event.originalText ?? ""}`);
        return departmentName.length > 2 && searchable.includes(departmentName);
      }
      if (event.facultyId) {
        if (matchingDepartments.some((match) => match.facultyId === event.facultyId)) return true;
        const searchable = foldForMatch(`${event.title} ${event.description ?? ""} ${event.originalText ?? ""}`);
        return departmentName.length > 2 && searchable.includes(departmentName);
      }
      if (matchingDepartments.length > 0) return true;
      const searchable = foldForMatch(`${event.title} ${event.description ?? ""} ${event.originalText ?? ""}`);
      return departmentName.length > 2 && searchable.includes(departmentName);
    });
    const grouped = groupEventsByUniversityAndYear(matchedEvents);
    const options: SummerSchoolUniversityOption[] = [];

    for (const [key, events] of grouped.entries()) {
      const [universityId, academicYear] = key.split("::");
      if (!universityId || !academicYear) continue;
      const university = await this.catalogRepository?.findUniversityById(universityId);
      const sourceUrl = sourceUrlFromEvent(events[0]!, university ?? null) ?? university?.academicCalendarUrl;
      const matchingDepartments = matchingDepartmentsByUniversity.get(universityId) ?? [];
      options.push({
        universityId,
        universityName: normalizeDisplayText(university?.name ?? universityId, 160),
        academicYear,
        ...(sourceUrl ? { sourceUrl } : {}),
        events,
        ...(matchingDepartments.length ? { matchingDepartments } : {})
      });
    }

    return options.sort((left, right) => left.universityName.localeCompare(right.universityName, "tr-TR"));
  }

  private async findMatchingDepartmentsBySummerEventUniversity(department: DepartmentRecord, events: AcademicEventRecord[]): Promise<Map<string, SummerSchoolDepartmentMatch[]>> {
    if (!this.catalogRepository) return new Map();
    const summerUniversityIds = new Set(events.map((event) => event.universityId).filter((universityId) => universityId !== department.universityId));
    if (summerUniversityIds.size === 0) return new Map();

    const matchesByUniversity = new Map<string, SummerSchoolDepartmentMatch[]>();
    const targetKeys = departmentMatchKeys(department);
    for (const universityId of summerUniversityIds) {
      const faculties = await this.catalogRepository.listFaculties(universityId, "active");
      for (const faculty of faculties) {
        const departments = await this.catalogRepository.listDepartments(faculty.id, "active");
        for (const candidate of departments) {
          if (!departmentsMatch(candidate, targetKeys)) continue;
          matchesByUniversity.set(universityId, [
            ...(matchesByUniversity.get(universityId) ?? []),
            {
              facultyId: faculty.id,
              facultyName: faculty.name,
              departmentId: candidate.id,
              departmentName: candidate.name,
              educationLevel: candidate.educationLevel
            }
          ]);
        }
      }
    }

    return matchesByUniversity;
  }

  private async findOwnSummerSchoolAnnouncements(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<SummerSchoolAnnouncementSelection> {
    if (!this.announcementRepository) return { items: [], sources: [] };
    const [items, sources] = await Promise.all([
      this.announcementRepository.listItemsByScope({ ...input, limit: 200 }),
      this.announcementRepository.listSourcesByScope(input)
    ]);
    const sourcesById = new Map(sources.map((source) => [source.id, source]));
    const trustedItems = dedupeAnnouncementItems(items.flatMap((item) => {
      const presented = toTrustedAcademicContentDto(item, sourcesById.get(item.sourceId));
      return presented ? [presented] : [];
    }))
      .filter(isSummerSchoolAnnouncement)
      .slice(0, 80);
    return { items: trustedItems, sources };
  }

  private async findSameDepartmentSummerSchoolAnnouncements(department: DepartmentRecord, selectedScope: { universityId: string; facultyId?: string; departmentId?: string }): Promise<SummerSchoolAnnouncementSelection> {
    if (!this.announcementRepository) return { items: [], sources: [] };
    const departmentMatchers = [
      foldForMatch(department.name),
      foldForMatch(department.slug.replace(/-/gu, " "))
    ].filter((value, index, values) => value.length > 2 && values.indexOf(value) === index);
    if (departmentMatchers.length === 0) return { items: [], sources: [] };
    const selectedScopeIds = new Set([selectedScope.universityId, selectedScope.facultyId, selectedScope.departmentId].filter((value): value is string => Boolean(value)));
    const [items, sources] = await Promise.all([
      this.announcementRepository.listAllItems({ limit: 5000, offset: 0 }),
      this.announcementRepository.listAllSources({ status: "active", limit: 5000, offset: 0 })
    ]);
    const sourcesById = new Map(sources.map((source) => [source.id, source]));
    const trustedItems = dedupeAnnouncementItems(items.flatMap((item) => {
      const presented = toTrustedAcademicContentDto(item, sourcesById.get(item.sourceId));
      return presented ? [presented] : [];
    }))
      .filter(isSummerSchoolAnnouncement)
      .filter((item) => !isSelectedUniversityAnnouncementScope(item, selectedScope.universityId, selectedScopeIds))
      .filter((item) => departmentMatchers.some((matcher) => announcementMatchesDepartment(item, matcher)))
      .slice(0, 120);
    return {
      items: await Promise.all(trustedItems.map((item) => attachVerifiedAcademicHierarchy(item, this.catalogRepository))),
      sources
    };
  }

  private async resolveAcademicProfile(universityId: string, facultyId?: string, departmentId?: string): Promise<[UniversityRecord | null, FacultyRecord | null, DepartmentRecord | null]> {
    const university = await this.catalogRepository?.findUniversityById(universityId) ?? null;
    const faculties = facultyId && this.catalogRepository ? await this.catalogRepository.listFaculties(universityId, "active") : [];
    const faculty = faculties.find((item) => item.id === facultyId) ?? null;
    const departments = facultyId && this.catalogRepository ? await this.catalogRepository.listDepartments(facultyId, "active") : [];
    const department = departments.find((item) => item.id === departmentId) ?? null;
    return [university, faculty, department];
  }
}

function summerSchoolAnnouncementStatus(
  selections: SummerSchoolAnnouncementSelection[]
): MySummerSchoolResponse["announcementStatus"] {
  const sources = new Map<string, AnnouncementSourceRecord>();
  for (const selection of selections) {
    for (const source of selection.sources) sources.set(source.id, source);
  }
  const failedSourceCount = [...sources.values()].filter((source) =>
    source.healthStatus === "degraded"
    || source.healthStatus === "failed"
    || (source.consecutiveFailures ?? 0) > 0
  ).length;
  const items = selections.flatMap((selection) => selection.items);
  const staleCount = items.filter((item) => item.freshness === "stale").length;
  const state = failedSourceCount > 0 || (staleCount > 0 && staleCount < items.length)
    ? "partial"
    : staleCount > 0
      ? "stale"
      : "fresh";
  return { state, sourceCount: sources.size, failedSourceCount };
}

function groupEventsByUniversityAndYear(events: AcademicEventRecord[]): Map<string, AcademicEventRecord[]> {
  const grouped = new Map<string, AcademicEventRecord[]>();
  for (const event of events) {
    const key = `${event.universityId}::${event.academicYear}`;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  return grouped;
}

function signCalendarFeedToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    sub: userId,
    iat: Math.floor(Date.now() / 1000)
  }), "utf8").toString("base64url");
  const signature = signCalendarFeedPayload(payload);
  return `${payload}.${signature}`;
}

function verifyCalendarFeedToken(token: string): string {
  if (!token || token.length > 4_096) throw new UnauthorizedException("Invalid calendar feed token.");
  let parts: string[];
  try {
    parts = decodeURIComponent(token).split(".");
  } catch {
    throw new UnauthorizedException("Invalid calendar feed token.");
  }
  if (parts.length !== 2) throw new UnauthorizedException("Invalid calendar feed token.");
  const [payload, signature] = parts;
  if (!payload || !signature) throw new UnauthorizedException("Invalid calendar feed token.");
  const suppliedSignature = Buffer.from(signature, "utf8");
  const expectedSignature = Buffer.from(signCalendarFeedPayload(payload), "utf8");
  if (
    suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new UnauthorizedException("Invalid calendar feed token.");
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (parsed.v !== 1 || typeof parsed.sub !== "string" || !parsed.sub) throw new Error("INVALID_CALENDAR_FEED_TOKEN_PAYLOAD");
    return parsed.sub;
  } catch {
    throw new UnauthorizedException("Invalid calendar feed token.");
  }
}

function signCalendarFeedPayload(payload: string): string {
  return createHmac("sha256", calendarFeedSecret()).update(payload).digest("base64url");
}

function calendarFeedSecret(): string {
  const configuredSecret = process.env.CALENDAR_FEED_SECRET;
  if (
    process.env.NODE_ENV === "production"
    && (!isProductionSecret(configuredSecret) || configuredSecret === process.env.JWT_ACCESS_SECRET)
  ) {
    throw new Error("CALENDAR_FEED_SECRET_NOT_CONFIGURED");
  }
  return configuredSecret || process.env.JWT_ACCESS_SECRET || "development-calendar-feed-secret-change-me-32-chars";
}

function dedupeCalendarEvents(events: AcademicEventRecord[]): AcademicEventRecord[] {
  const unique = new Map<string, AcademicEventRecord>();
  for (const event of events) {
    if (event.status !== "published") continue;
    const existing = unique.get(event.id);
    if (!existing || event.updatedAt.getTime() > existing.updatedAt.getTime()) unique.set(event.id, event);
  }
  return [...unique.values()].sort(compareEventStart);
}

function renderIcsCalendar(input: { name: string; description: string; events: AcademicEventRecord[] }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Academic Mobile App//Academic Calendar//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-TIMEZONE:Europe/Istanbul",
    `X-WR-CALNAME:${escapeIcsText(input.name)}`,
    `X-WR-CALDESC:${escapeIcsText(input.description)}`
  ];

  for (const event of input.events) {
    lines.push(...renderIcsEvent(event));
  }

  lines.push("END:VCALENDAR");
  return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
}

function renderIcsEvent(event: AcademicEventRecord): string[] {
  const description = [
    event.description,
    `Kategori: ${event.category}`,
    `Akademik yil: ${event.academicYear}`,
    event.originalDateText ? `Kaynak tarih: ${event.originalDateText}` : undefined
  ].filter((value): value is string => Boolean(value));

  const hasDateOnlyStart = event.temporalKind === "date" && Boolean(event.dateOnlyStart);
  const hasTimestampEnd = event.endTemporalKind === "timestamp" && Boolean(event.endDate);
  const temporalLines = hasDateOnlyStart && !hasTimestampEnd
    ? [
        `DTSTART;VALUE=DATE:${icsCalendarDate(event.dateOnlyStart!)}`,
        `DTEND;VALUE=DATE:${icsCalendarDate(addCalendarDays(event.dateOnlyEnd ?? event.dateOnlyStart!, 1))}`
      ]
    : hasDateOnlyStart && hasTimestampEnd
      ? [
          `DTSTART:${icsTimestamp(istanbulCalendarStart(event.dateOnlyStart!))}`,
          `DTEND:${icsTimestamp(event.endDate!)}`
        ]
    : [
        `DTSTART:${icsTimestamp(event.startDate)}`,
        ...(event.endTemporalKind === "date" && event.dateOnlyEnd
          ? [`DTEND:${icsTimestamp(exclusiveIstanbulCalendarEnd(event.dateOnlyEnd))}`]
          : event.endDate ? [`DTEND:${icsTimestamp(event.endDate)}`] : [])
      ];

  return [
    "BEGIN:VEVENT",
    `UID:${event.id}@academic-mobile-app-7629`,
    `DTSTAMP:${icsTimestamp(new Date())}`,
    `LAST-MODIFIED:${icsTimestamp(event.updatedAt)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(description.join("\n"))}`,
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    `CATEGORIES:${escapeIcsText(event.category)}`,
    ...temporalLines,
    "TRANSP:TRANSPARENT",
    "END:VEVENT"
  ];
}

function icsDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("");
}

function icsTimestamp(date: Date): string {
  return `${icsDate(date)}T${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}Z`;
}

function icsCalendarDate(dateOnly: string): string {
  return dateOnly.replaceAll("-", "");
}

function addCalendarDays(dateOnly: string, days: number): string {
  const next = new Date(`${dateOnly}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function exclusiveIstanbulCalendarEnd(inclusiveEnd: string): Date {
  return instantBoundaryForIstanbulCalendarDate(addCalendarDays(inclusiveEnd, 1));
}

function istanbulCalendarStart(dateOnly: string): Date {
  return instantBoundaryForIstanbulCalendarDate(dateOnly);
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/;/gu, "\\;")
    .replace(/,/gu, "\\,")
    .replace(/\r?\n/gu, "\\n");
}

function foldIcsLine(line: string): string[] {
  if (line.length <= 74) return [line];
  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > 74) {
    chunks.push(chunks.length === 0 ? remaining.slice(0, 74) : ` ${remaining.slice(0, 73)}`);
    remaining = chunks.length === 1 ? remaining.slice(74) : remaining.slice(73);
  }
  chunks.push(chunks.length === 0 ? remaining : ` ${remaining}`);
  return chunks;
}

function foldForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/gu, "i")
    .replace(/\u0130/gu, "I")
    .replace(/\u011f/gu, "g")
    .replace(/\u011e/gu, "G")
    .replace(/\u00fc/gu, "u")
    .replace(/\u00dc/gu, "U")
    .replace(/\u015f/gu, "s")
    .replace(/\u015e/gu, "S")
    .replace(/\u00f6/gu, "o")
    .replace(/\u00d6/gu, "O")
    .replace(/\u00e7/gu, "c")
    .replace(/\u00c7/gu, "C")
    .replace(/[^\p{L}\d]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function departmentMatchKeys(department: DepartmentRecord): Set<string> {
  return new Set([
    foldForMatch(department.name),
    foldForMatch(department.slug.replace(/-/gu, " ")),
    canonicalDepartmentKey(department.name),
    canonicalDepartmentKey(department.slug.replace(/-/gu, " "))
  ].filter((value) => value.length > 2));
}

function departmentsMatch(candidate: DepartmentRecord, targetKeys: Set<string>): boolean {
  return [...departmentMatchKeys(candidate)].some((key) => targetKeys.has(key));
}

function canonicalDepartmentKey(value: string): string {
  return foldForMatch(value)
    .split(" ")
    .filter((token) => token.length > 1)
    .filter((token) => !["bolumu", "programi", "anabilim", "dali", "ana", "bilim", "dal"].includes(token))
    .join(" ");
}

function sourceUrlFromEvent(event: AcademicEventRecord, university: UniversityRecord | null): string | undefined {
  const match = `${event.description ?? ""} ${event.originalText ?? ""}`.match(/\bhttps?:\/\/[^\s)]+/u);
  const officialSourceUrl = university?.academicCalendarUrl ?? university?.websiteUrl;
  if (!officialSourceUrl) return undefined;
  const candidate = canonicalizeContentUrl(match?.[0]?.replace(/[.,;:]+$/u, "") ?? officialSourceUrl);
  return candidate && isOfficialContentUrl(candidate, officialSourceUrl) ? candidate : undefined;
}

function isSummerSchoolAnnouncement(item: Pick<TrustedAcademicContentDto, "title" | "summary" | "link" | "sourceName">): boolean {
  const searchable = foldForMatch(`${item.title} ${item.summary ?? ""} ${item.link} ${item.sourceName}`);
  return [
    "yaz okulu",
    "yaz ogretimi",
    "yaz donemi",
    "summer school",
    "summer term"
  ].some((keyword) => searchable.includes(keyword));
}

async function attachVerifiedAcademicHierarchy(
  item: TrustedAcademicContentDto,
  catalogRepository?: CatalogRepository
): Promise<TrustedAcademicContentDto> {
  if (item.scopeType === "university") {
    const university = await catalogRepository?.findUniversityById(item.scopeId)
      ?? await findVerifiedUniversitySource(item.scopeId);
    return university ? {
      ...item,
      universityId: "universityId" in university ? university.universityId : university.id,
      universityName: "universityName" in university ? university.universityName : university.name
    } : item;
  }

  const unit = await findVerifiedAcademicUnitSource(
    item.scopeType === "department"
      ? { departmentId: item.scopeId }
      : { facultyId: item.scopeId }
  );
  if (!unit?.universityName || !unit.facultyId || !unit.facultyName) return item;
  if (item.scopeType === "department" && (!unit.departmentId || !unit.departmentName)) return item;
  return {
    ...item,
    universityId: unit.universityId,
    universityName: unit.universityName,
    facultyId: unit.facultyId,
    facultyName: unit.facultyName,
    ...(item.scopeType === "department" ? {
      departmentId: unit.departmentId!,
      departmentName: unit.departmentName!
    } : {})
  };
}

function attachResolvedAcademicHierarchy(
  item: TrustedAcademicContentDto,
  university: UniversityRecord | null,
  faculty: FacultyRecord | null,
  department: DepartmentRecord | null
): TrustedAcademicContentDto {
  if (!university) return item;
  const universityHierarchy = {
    universityId: university.id,
    universityName: university.name
  };
  if (item.scopeType === "university") {
    return item.scopeId === university.id ? { ...item, ...universityHierarchy } : item;
  }
  if (!faculty || (item.scopeType === "faculty" && item.scopeId !== faculty.id)) return item;
  const facultyHierarchy = {
    ...universityHierarchy,
    facultyId: faculty.id,
    facultyName: faculty.name
  };
  if (item.scopeType === "faculty") return { ...item, ...facultyHierarchy };
  if (!department || item.scopeId !== department.id) return item;
  return {
    ...item,
    ...facultyHierarchy,
    departmentId: department.id,
    departmentName: department.name
  };
}

function announcementMatchesDepartment(item: Pick<TrustedAcademicContentDto, "title" | "summary" | "link" | "sourceName">, foldedDepartmentName: string): boolean {
  const searchable = foldForMatch(`${item.title} ${item.summary ?? ""} ${item.link} ${item.sourceName}`);
  if (searchable.includes(foldedDepartmentName)) return true;

  const departmentTokens = foldedDepartmentName
    .split(" ")
    .filter((token) => token.length > 3 && !["bolumu", "programi", "anabilim", "dali"].includes(token));
  if (departmentTokens.length === 0) return false;
  return departmentTokens.every((token) => searchable.includes(token));
}

function isSelectedUniversityAnnouncementScope(item: Pick<TrustedAcademicContentDto, "scopeId" | "scopeType">, selectedUniversityId: string, selectedScopeIds: Set<string>): boolean {
  if (selectedScopeIds.has(item.scopeId)) return true;
  return item.scopeType !== "university" && item.scopeId.startsWith(`${selectedUniversityId}__`);
}

function dedupeAnnouncementItems(items: TrustedAcademicContentDto[]): TrustedAcademicContentDto[] {
  const unique = new Map<string, TrustedAcademicContentDto>();
  for (const item of items) {
    const key = academicContentLogicalIdentityKey(item);
    if (!key) continue;
    const existing = unique.get(key);
    if (!existing || compareAcademicContentDuplicateRecency(item, existing) > 0) unique.set(key, item);
  }
  return [...unique.values()].sort((left, right) => announcementTimestamp(right) - announcementTimestamp(left));
}

function announcementTimestamp(item: TrustedAcademicContentDto): number {
  return Math.max(...[item.publishedAt, item.sourceUpdatedAt, item.discoveredAt]
    .map((value) => value ? Date.parse(value) : 0)
    .filter(Number.isFinite), 0);
}

function isUniversityAcademicCalendarEvent(event: AcademicEventRecord): boolean {
  if (event.facultyId || event.departmentId) return false;
  return isPrimaryAcademicCalendarEvent(event);
}

function isPrimaryAcademicCalendarEvent(event: AcademicEventRecord): boolean {
  return event.category !== "course_schedule" && event.category !== "department_exam_schedule";
}

function isUnitSpecificCalendar(calendar: AcademicCalendarRecord): boolean {
  return isUnitSpecificCalendarSource({
    title: calendar.title,
    ...(calendar.sourceUrl ? { sourceUrl: calendar.sourceUrl } : {})
  });
}

function mobileCalendarPdfCapability(
  calendar: AcademicCalendarRecord,
  source: PdfSourceRecord | null,
  events: AcademicEventRecord[]
): MobileAcademicPdfSourceDto | undefined {
  if (
    !source
    || calendar.status !== "published"
    || source.id !== calendar.sourcePdfId
    || source.universityId !== calendar.universityId
    || source.academicYear !== calendar.academicYear
    || source.status !== "uploaded"
    || source.parseStatus !== "processed"
    || source.binaryIdentityVerified !== true
    || source.binarySha256 !== source.fileHash
    || source.mimeType !== "application/pdf"
    || !source.magicBytesHex.toLocaleLowerCase("en-US").startsWith("25504446")
    || !source.url
    || !calendar.sourceUrl
    || !sameCanonicalUrl(source.url, calendar.sourceUrl)
  ) return undefined;
  const approvedEvents = events.flatMap((event) => {
    const descriptor = mobileApprovedCalendarEvent(event, calendar);
    return descriptor ? [descriptor] : [];
  });
  if (approvedEvents.length === 0) return undefined;
  const capability = mobilePdfCapabilityBase({
    sourceUrl: source.url,
    verifiedFinalUrl: source.url,
    expectedSha256: source.binarySha256,
    expectedByteLength: source.fileSize
  });
  if (!capability) return undefined;
  return {
    ...capability,
    document: {
      kind: "academic_calendar",
      universityId: calendar.universityId,
      academicYear: calendar.academicYear,
      approvedEvents
    }
  };
}

function mobileApprovedCalendarEvent(
  event: AcademicEventRecord,
  calendar: AcademicCalendarRecord
): MobileAcademicPdfApprovedEventDto | undefined {
  if (
    event.status !== "published"
    || event.calendarId !== calendar.id
    || event.universityId !== calendar.universityId
    || event.academicYear !== calendar.academicYear
  ) return undefined;
  const normalizedTitle = normalizeDisplayText(event.title);
  if (!normalizedTitle || normalizedTitle.length > 240) return undefined;
  const temporalKind = event.temporalKind === "date" && isCalendarDate(event.dateOnlyStart)
    ? "date"
    : "timestamp";
  const startDate = temporalKind === "date" ? event.dateOnlyStart! : event.startDate.toISOString();
  if (temporalKind === "timestamp" && !Number.isFinite(Date.parse(startDate))) return undefined;
  let endDate: string | undefined;
  let endTemporalKind: "date" | "timestamp" | undefined;
  if (event.endDate) {
    endTemporalKind = event.endTemporalKind === "date" && isCalendarDate(event.dateOnlyEnd)
      ? "date"
      : "timestamp";
    endDate = endTemporalKind === "date" ? event.dateOnlyEnd! : event.endDate.toISOString();
    const startOrder = temporalKind === "date" ? Date.parse(`${startDate}T00:00:00.000Z`) : Date.parse(startDate);
    const endOrder = endTemporalKind === "date" ? Date.parse(`${endDate}T00:00:00.000Z`) : Date.parse(endDate);
    if (!Number.isFinite(endOrder) || endOrder < startOrder) return undefined;
  }
  return {
    normalizedTitle,
    category: event.category,
    startDate,
    ...(endDate && endTemporalKind ? { endDate, endTemporalKind } : {}),
    temporalKind
  };
}

function mobileSchedulePdfCapability(
  source: AcademicUnitScheduleSourceRecord,
  events: AcademicEventRecord[],
  scope: {
    universityId: string;
    facultyId?: string;
    departmentId: string;
    scheduleType: "course_schedule" | "exam_schedule";
  }
): MobileAcademicPdfSourceDto | undefined {
  const review = source.reviewResult;
  const decision = source.reviewDecision;
  if (
    source.lifecycle !== "published"
    || source.universityId !== scope.universityId
    || source.departmentId !== scope.departmentId
    || source.facultyId !== scope.facultyId
    || source.scheduleType !== scope.scheduleType
    || review?.format !== "pdf"
    || review.parser !== "pdf_binary_text"
    || review.outcome !== "parsed_pending_review"
    || !review.finalUrl
    || !sameCanonicalUrl(review.finalUrl, source.verifiedFinalUrl)
    || decision?.decision !== "approved"
    || decision.materializationStatus !== "published"
    || !decision.reviewKey
    || events.length === 0
    || events.some((event) => (
      event.status !== "published"
      || event.scheduleSourceId !== source.id
      || event.scheduleReviewKey !== decision.reviewKey
    ))
  ) return undefined;

  const approvedRowNumbers = [...new Set(decision.approvedRowNumbers)].sort((left, right) => left - right);
  const availableRows = new Set(review.candidates.map((candidate) => candidate.rowNumber));
  const academicYear = decision.academicYear;
  const term = decision.term;
  if (
    approvedRowNumbers.length === 0
    || approvedRowNumbers.length > 250
    || approvedRowNumbers.some((row) => !Number.isSafeInteger(row) || row < 1 || !availableRows.has(row))
    || !isConsecutiveAcademicYear(academicYear)
    || !term
    || !["fall", "spring", "summer", "full_year", "unknown"].includes(term)
  ) return undefined;
  if (
    source.scheduleType === "course_schedule"
    && (!isCalendarDate(decision.courseRangeStart)
      || !isCalendarDate(decision.courseRangeEnd)
      || calendarDayDistance(decision.courseRangeStart, decision.courseRangeEnd) < 0
      || calendarDayDistance(decision.courseRangeStart, decision.courseRangeEnd) > 370)
  ) return undefined;
  const approvedRows = approvedRowNumbers.flatMap((rowNumber) => {
    const candidate = review.candidates.find((item) => item.rowNumber === rowNumber);
    const descriptor = candidate ? mobileApprovedScheduleRow(candidate, source.scheduleType) : undefined;
    return descriptor ? [descriptor] : [];
  });
  if (approvedRows.length !== approvedRowNumbers.length) return undefined;

  const capability = mobilePdfCapabilityBase({
    sourceUrl: source.sourceUrl,
    verifiedFinalUrl: source.verifiedFinalUrl,
    expectedSha256: review.contentSha256,
    expectedByteLength: review.contentLengthBytes
  });
  if (!capability) return undefined;
  return {
    ...capability,
    document: {
      kind: source.scheduleType,
      universityId: scope.universityId,
      ...(scope.facultyId ? { facultyId: scope.facultyId } : {}),
      departmentId: scope.departmentId,
      academicYear,
      term,
      approvedRowNumbers,
      approvedRows,
      ...(source.scheduleType === "course_schedule" ? { courseRangeStart: decision.courseRangeStart!, courseRangeEnd: decision.courseRangeEnd! } : {})
    }
  };
}

function mobileApprovedScheduleRow(
  candidate: AcademicUnitScheduleCandidate,
  scheduleType: "course_schedule" | "exam_schedule"
): MobileAcademicPdfApprovedRowDto | undefined {
  const normalizedTitle = normalizeDisplayText(candidate.title);
  const startTime = candidate.startTime;
  const endTime = candidate.endTime;
  const date = candidate.date;
  const dayOfWeek = candidate.dayOfWeek;
  if (
    !normalizedTitle
    || normalizedTitle.length > 240
    || !startTime
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(startTime)
    || (endTime !== undefined && (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(endTime) || endTime <= startTime))
    || (date !== undefined && !isCalendarDate(date))
    || (dayOfWeek !== undefined && (!Number.isSafeInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6))
    || (scheduleType === "course_schedule" && dayOfWeek === undefined)
    || (scheduleType === "exam_schedule" && date === undefined)
  ) return undefined;
  return {
    rowNumber: candidate.rowNumber,
    normalizedTitle,
    ...(date ? { date } : {}),
    ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
    startTime,
    ...(endTime ? { endTime } : {})
  };
}

function mobilePdfCapabilityBase(input: {
  sourceUrl: string;
  verifiedFinalUrl: string;
  expectedSha256: string | undefined;
  expectedByteLength: number | undefined;
}): Omit<MobileAcademicPdfSourceDto, "document"> | undefined {
  const sourceUrl = canonicalizeContentUrl(input.sourceUrl);
  const verifiedFinalUrl = canonicalizeContentUrl(input.verifiedFinalUrl);
  if (!sourceUrl || !verifiedFinalUrl) return undefined;
  if (new URL(sourceUrl).protocol !== "https:" || new URL(verifiedFinalUrl).protocol !== "https:") return undefined;
  const allowedOfficialDomain = officialDomainForUrl(verifiedFinalUrl);
  if (!allowedOfficialDomain || !isOfficialContentUrl(sourceUrl, verifiedFinalUrl)) return undefined;
  const expectedSha256 = input.expectedSha256;
  const expectedByteLength = input.expectedByteLength;
  if (!expectedSha256 || !/^[a-f\d]{64}$/u.test(expectedSha256)) return undefined;
  if (
    !Number.isSafeInteger(expectedByteLength)
    || expectedByteLength! < 5
    || expectedByteLength! > MOBILE_PDF_MAX_BYTES
  ) return undefined;
  const authorizedAt = new Date();
  return {
    mode: "device_text",
    sourceUrl,
    allowedOfficialDomain,
    expectedSha256,
    expectedByteLength: expectedByteLength!,
    authorizedAt: authorizedAt.toISOString(),
    validUntil: new Date(authorizedAt.getTime() + MOBILE_PDF_CAPABILITY_TTL_MS).toISOString()
  };
}

function isConsecutiveAcademicYear(value: string | undefined): value is string {
  const match = /^(\d{4})-(\d{4})$/u.exec(value ?? "");
  return Boolean(match && Number(match[2]) === Number(match[1]) + 1);
}

function isCalendarDate(value: string | undefined): value is string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value ?? "");
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

function calendarDayDistance(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000);
}

function pdfProcessingModeFromSource(source: PdfSourceRecord | null): AcademicPdfProcessingMode | undefined {
  if (!source) return undefined;
  if (source.ocrProvider || source.ocrProcessedAt || source.parseStatus === "ocr_required") return "server_ocr";
  return source.rawText?.trim() ? "device_text" : undefined;
}

function pdfProcessingModeFromScheduleSource(
  source: AcademicUnitScheduleSourceRecord
): AcademicPdfProcessingMode | undefined {
  if (source.reviewResult?.format !== "pdf") return undefined;
  if (source.reviewResult.parser === "pdf_ocr" || source.reviewResult.outcome === "unsupported_ocr_review") {
    return "server_ocr";
  }
  return source.reviewResult.parser === "pdf_binary_text" ? "device_text" : undefined;
}

function sameCanonicalUrl(left: string, right: string): boolean {
  const canonicalLeft = canonicalizeContentUrl(left);
  const canonicalRight = canonicalizeContentUrl(right);
  return Boolean(canonicalLeft && canonicalRight && canonicalLeft === canonicalRight);
}
