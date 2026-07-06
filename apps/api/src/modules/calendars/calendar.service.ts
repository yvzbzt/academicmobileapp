import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { AcademicEventCategory } from "../../domain/academic-event.types.js";
import { findVerifiedAcademicUnitSource } from "../../bootstrap/verified-source-registry.js";
import type { AnnouncementItem, AnnouncementRepository } from "../announcements/announcements.types.js";
import type { AuthRepository } from "../auth/auth.types.js";
import type { CatalogRepository, DepartmentRecord, FacultyRecord, UniversityRecord } from "../catalog/catalog.types.js";
import type { CalendarScopeView } from "./calendar.dto.js";
import { CalendarIngestionService, isAcceptableAcademicYear, isUnitSpecificCalendarSource } from "./calendar-ingestion.service.js";
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
  date?: Date;
  sourceUrl?: string;
  eventId?: string;
}

export interface SummerSchoolUniversityOption {
  universityId: string;
  universityName: string;
  academicYear: string;
  sourceUrl?: string;
  events: AcademicEventRecord[];
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
  ownAnnouncements: AnnouncementItem[];
  sameDepartmentAnnouncements: AnnouncementItem[];
  sameDepartmentOptions: SummerSchoolUniversityOption[];
  generatedAt: Date;
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
          message: event.title,
          date: event.startDate,
          eventId: event.id,
          ...(sourceUrl ? { sourceUrl } : {})
        };
      });

    const [ownAnnouncements, sameDepartmentAnnouncements, sameDepartmentOptions] = await Promise.all([
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
        : Promise.resolve([]),
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
      ownAnnouncements,
      sameDepartmentAnnouncements,
      sameDepartmentOptions,
      generatedAt: new Date()
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
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime())
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
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
  }

  private async findSameDepartmentSummerSchoolOptions(department: DepartmentRecord, selectedUniversityId: string): Promise<SummerSchoolUniversityOption[]> {
    const departmentName = foldForMatch(department.name);
    const allSummerEvents = await this.listSummerSchoolEvents({ limit: 900 });
    const matchedEvents = allSummerEvents.filter((event) => {
      if (event.universityId === selectedUniversityId) return false;
      if (event.departmentId === department.id) return true;
      const searchable = foldForMatch(`${event.title} ${event.description ?? ""} ${event.originalText ?? ""}`);
      return departmentName.length > 2 && searchable.includes(departmentName);
    });
    const grouped = groupEventsByUniversityAndYear(matchedEvents);
    const options: SummerSchoolUniversityOption[] = [];

    for (const [key, events] of grouped.entries()) {
      const [universityId, academicYear] = key.split("::");
      if (!universityId || !academicYear) continue;
      const university = await this.catalogRepository?.findUniversityById(universityId);
      options.push({
        universityId,
        universityName: university?.name ?? universityId,
        academicYear,
        ...(university?.academicCalendarUrl ? { sourceUrl: university.academicCalendarUrl } : {}),
        events
      });
    }

    return options.sort((left, right) => left.universityName.localeCompare(right.universityName, "tr-TR"));
  }

  private async findOwnSummerSchoolAnnouncements(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementItem[]> {
    if (!this.announcementRepository) return [];
    const items = await this.announcementRepository.listItemsByScope({ ...input, limit: 200 });
    return dedupeAnnouncementItems(items)
      .filter(isSummerSchoolAnnouncement)
      .slice(0, 80);
  }

  private async findSameDepartmentSummerSchoolAnnouncements(department: DepartmentRecord, selectedScope: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementItem[]> {
    if (!this.announcementRepository) return [];
    const departmentMatchers = [
      foldForMatch(department.name),
      foldForMatch(department.slug.replace(/-/gu, " "))
    ].filter((value, index, values) => value.length > 2 && values.indexOf(value) === index);
    if (departmentMatchers.length === 0) return [];
    const selectedScopeIds = new Set([selectedScope.universityId, selectedScope.facultyId, selectedScope.departmentId].filter((value): value is string => Boolean(value)));
    const items = await this.announcementRepository.listAllItems({ limit: 5000, offset: 0 });
    return dedupeAnnouncementItems(items)
      .filter(isSummerSchoolAnnouncement)
      .filter((item) => !isSelectedUniversityAnnouncementScope(item, selectedScope.universityId, selectedScopeIds))
      .filter((item) => departmentMatchers.some((matcher) => announcementMatchesDepartment(item, matcher)))
      .slice(0, 120);
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

function groupEventsByUniversityAndYear(events: AcademicEventRecord[]): Map<string, AcademicEventRecord[]> {
  const grouped = new Map<string, AcademicEventRecord[]>();
  for (const event of events) {
    const key = `${event.universityId}::${event.academicYear}`;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  return grouped;
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

function sourceUrlFromEvent(event: AcademicEventRecord, university: UniversityRecord | null): string | undefined {
  const match = `${event.description ?? ""} ${event.originalText ?? ""}`.match(/\bhttps?:\/\/[^\s)]+/u);
  return match?.[0]?.replace(/[.,;:]+$/u, "") ?? university?.academicCalendarUrl;
}

function isSummerSchoolAnnouncement(item: AnnouncementItem): boolean {
  const searchable = foldForMatch(`${item.title} ${item.summary ?? ""} ${item.link} ${item.sourceName}`);
  return [
    "yaz okulu",
    "yaz ogretimi",
    "yaz donemi",
    "summer school",
    "summer term"
  ].some((keyword) => searchable.includes(keyword));
}

function announcementMatchesDepartment(item: AnnouncementItem, foldedDepartmentName: string): boolean {
  const searchable = foldForMatch(`${item.title} ${item.summary ?? ""} ${item.link} ${item.sourceName}`);
  if (searchable.includes(foldedDepartmentName)) return true;

  const departmentTokens = foldedDepartmentName
    .split(" ")
    .filter((token) => token.length > 3 && !["bolumu", "programi", "anabilim", "dali"].includes(token));
  if (departmentTokens.length === 0) return false;
  return departmentTokens.every((token) => searchable.includes(token));
}

function isSelectedUniversityAnnouncementScope(item: AnnouncementItem, selectedUniversityId: string, selectedScopeIds: Set<string>): boolean {
  if (selectedScopeIds.has(item.scopeId)) return true;
  return item.scopeType !== "university" && item.scopeId.startsWith(`${selectedUniversityId}__`);
}

function dedupeAnnouncementItems(items: AnnouncementItem[]): AnnouncementItem[] {
  const unique = new Map<string, AnnouncementItem>();
  for (const item of items) {
    const key = item.link.toLocaleLowerCase("en-US");
    const existing = unique.get(key);
    if (!existing || announcementTimestamp(item) > announcementTimestamp(existing)) unique.set(key, item);
  }
  return [...unique.values()].sort((left, right) => announcementTimestamp(right) - announcementTimestamp(left));
}

function announcementTimestamp(item: AnnouncementItem): number {
  const timestamp = item.publishedAt ? Date.parse(item.publishedAt) : item.fetchedAt ? Date.parse(item.fetchedAt) : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
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
