import { createHmac } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException, Optional, UnauthorizedException } from "@nestjs/common";
import type { TrustedAcademicContentCollectionDto, TrustedAcademicContentDto } from "../../../../../packages/shared/src/contracts.js";
import type { AcademicEventCategory } from "../../domain/academic-event.types.js";
import { findVerifiedAcademicUnitSource } from "../../bootstrap/verified-source-registry.js";
import { canonicalContentKey, canonicalizeContentUrl, compareAcademicContentDuplicateRecency, isOfficialContentUrl, normalizeDisplayText, toTrustedAcademicContentDto } from "../announcements/announcement-content-trust.js";
import type { AnnouncementRepository, AnnouncementSourceRecord } from "../announcements/announcements.types.js";
import type { AuthRepository } from "../auth/auth.types.js";
import type { CatalogRepository, DepartmentRecord, FacultyRecord, UniversityRecord } from "../catalog/catalog.types.js";
import type { CalendarScopeView } from "./calendar.dto.js";
import { isProductionSecret } from "../../config/production-secret.js";
import { CalendarIngestionService, isAcceptableAcademicYear, isUnitSpecificCalendarSource } from "./calendar-ingestion.service.js";
import { compareEventStart, temporalStartValue } from "./calendar-temporal.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarRepository } from "./calendar.types.js";

export interface CalendarWithEventsResponse {
  calendar: AcademicCalendarRecord;
  events: AcademicEventRecord[];
  scope: CalendarScopeView;
  sourceStatus: "parsed" | "source_only";
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

@Injectable()
export class CalendarService {
  constructor(
    @Inject("CalendarRepository") private readonly calendarRepository: CalendarRepository,
    @Inject("AuthRepository") private readonly authRepository: AuthRepository,
    @Optional() @Inject("CatalogRepository") private readonly catalogRepository?: CatalogRepository,
    @Optional() @Inject(CalendarIngestionService) private readonly calendarIngestionService?: CalendarIngestionService,
    @Optional() @Inject("AnnouncementRepository") private readonly announcementRepository?: AnnouncementRepository
  ) {}

  async getMyCalendar(userId: string): Promise<CalendarWithEventsResponse> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");

    const calendar = await this.findPublishedCalendarOrIngest(user.universityId);
    if (!calendar) throw new NotFoundException("Selected university academic calendar is not available yet.");

    const events = (await this.calendarRepository.listPublishedEvents({
      calendarId: calendar.id,
      universityId: user.universityId,
      limit: 500,
      offset: 0
    })).filter(isUniversityAcademicCalendarEvent);

    return { calendar, events: events.slice(0, 200), scope: "university", sourceStatus: events.length > 0 ? "parsed" : "source_only" };
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
    const calendar = await this.findPublishedCalendarOrIngest(universityId, academicYear);
    if (!calendar) throw new NotFoundException("Selected university academic calendar is not available yet.");
    const events = (await this.calendarRepository.listPublishedEvents({
      calendarId: calendar.id,
      universityId,
      limit: 500,
      offset: 0
    })).filter(isUniversityAcademicCalendarEvent).slice(0, 200);
    return { calendar, events, scope: "university", sourceStatus: events.length > 0 ? "parsed" : "source_only" };
  }

  async getUpcomingEvents(userId: string, limit = 10): Promise<AcademicEventRecord[]> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");
    await this.findPublishedCalendarOrIngest(user.universityId);
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

  async searchEvents(input: { category?: AcademicEventCategory; startDate?: Date; endDate?: Date; limit?: number; offset?: number }): Promise<AcademicEventRecord[]> {
    return this.calendarRepository.listPublishedEvents({
      ...(input.category ? { category: input.category } : {}),
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.endDate ? { endDate: input.endDate } : {}),
      limit: Math.min(Math.max(input.limit ?? 50, 1), 100),
      offset: Math.max(input.offset ?? 0, 0)
    });
  }

  async getMySummerSchool(userId: string): Promise<MySummerSchoolResponse> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");

    const [university, faculty, department] = await this.resolveAcademicProfile(user.universityId, user.facultyId, user.departmentId);
    await this.findPublishedCalendarOrIngest(user.universityId);
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
      ownAnnouncements: ownAnnouncementSelection.items,
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
      .slice(0, 200);

    const sourceUrl = await this.findDepartmentScheduleSource({
      universityId,
      ...(facultyId ? { facultyId } : {}),
      departmentId,
      sourceField
    });

    return {
      profile,
      events,
      ...(sourceUrl ? { sourceUrl } : {}),
      sourceStatus: events.length > 0 ? "parsed" : sourceUrl ? "source_only" : "missing"
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

  private async findPublishedCalendarOrIngest(universityId: string, academicYear?: string): Promise<AcademicCalendarRecord | null> {
    const existing = await this.calendarRepository.findPublishedCalendar(universityId, academicYear);
    if (existing && (academicYear || isAcceptableAcademicYear(existing.academicYear))) {
      if (isUnitSpecificCalendar(existing)) {
        await this.calendarRepository.updateCalendar(existing.id, { status: "archived" });
        return this.findPublishedCalendarOrIngest(universityId, academicYear);
      } else {
        if (process.env.CALENDAR_AUTO_INGEST_ON_MISS === "false") return existing;
        const events = await this.calendarRepository.listPublishedEvents({ calendarId: existing.id, universityId, limit: 1, offset: 0 });
        if (events.length > 0) return existing;

        const retried = await this.calendarIngestionService?.ensurePublishedCalendarForUniversity(universityId, academicYear);
        return retried?.calendar && !isUnitSpecificCalendar(retried.calendar) ? retried.calendar : existing;
      }
    }
    if (process.env.CALENDAR_AUTO_INGEST_ON_MISS === "false") return null;

    const ingested = await this.calendarIngestionService?.ensurePublishedCalendarForUniversity(universityId, academicYear);
    if (ingested?.calendar && (academicYear || isAcceptableAcademicYear(ingested.calendar.academicYear)) && !isUnitSpecificCalendar(ingested.calendar)) return ingested.calendar;
    const refreshed = await this.calendarRepository.findPublishedCalendar(universityId, academicYear);
    if (!refreshed || (!academicYear && !isAcceptableAcademicYear(refreshed.academicYear))) return null;
    if (isUnitSpecificCalendar(refreshed)) {
      await this.calendarRepository.updateCalendar(refreshed.id, { status: "archived" });
      return null;
    }
    return refreshed;
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
    return { items: trustedItems, sources };
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
  const [payload, signature] = decodeURIComponent(token).split(".");
  if (!payload || !signature) throw new UnauthorizedException("Invalid calendar feed token.");
  if (signature !== signCalendarFeedPayload(payload)) throw new UnauthorizedException("Invalid calendar feed token.");

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
  return new Date(`${addCalendarDays(inclusiveEnd, 1)}T00:00:00.000+03:00`);
}

function istanbulCalendarStart(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000+03:00`);
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
    const key = canonicalContentKey(item.canonicalUrl) ?? item.canonicalUrl;
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
  return event.category !== "course_schedule" && event.category !== "department_exam_schedule";
}

function isUnitSpecificCalendar(calendar: AcademicCalendarRecord): boolean {
  return isUnitSpecificCalendarSource({
    title: calendar.title,
    ...(calendar.sourceUrl ? { sourceUrl: calendar.sourceUrl } : {})
  });
}
