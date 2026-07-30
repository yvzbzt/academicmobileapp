import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AuthApplicationService } from "../src/modules/auth/auth-application.service.js";
import { EmailVerificationSenderService, type SendVerificationEmailInput } from "../src/modules/auth/email-verification-sender.service.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import { TokenService } from "../src/modules/auth/token.service.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import type { AnnouncementItem } from "../src/modules/announcements/announcements.types.js";
import { CalendarService } from "../src/modules/calendars/calendar.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import type { CatalogRepository, DepartmentRecord, FacultyRecord, UniversityRecord } from "../src/modules/catalog/catalog.types.js";

class FakeEmailVerificationSenderService extends EmailVerificationSenderService {
  public readonly sent: SendVerificationEmailInput[] = [];
  override async sendVerificationEmail(input: SendVerificationEmailInput): Promise<void> {
    this.sent.push(input);
  }
}

async function createStudentWithUniversity() {
  const authRepository = new InMemoryAuthRepository();
  const sender = new FakeEmailVerificationSenderService();
  const authService = new AuthApplicationService(authRepository, new PasswordHasher(), new TokenService(), sender);
  const registerResult = await authService.register({
    email: "calendar@campus.edu.tr",
    password: "StrongPass123!",
    passwordConfirmation: "StrongPass123!"
  });

  await authService.verifyEmail({ email: registerResult.email, code: sender.sent[0]!.code, deviceId: "device-1" });
  const session = await authService.login({ email: registerResult.email, password: "StrongPass123!", deviceId: "device-1" });
  await authRepository.updateUserAcademicSelection(session.user.id, {
    universityId: "sample-university-1",
    facultyId: "sample-faculty-1",
    departmentId: "sample-department-1"
  });
  return { authRepository, session };
}

describe("CalendarService", () => {
  it("requires university selection for my calendar", async () => {
    const authRepository = new InMemoryAuthRepository();
    const sender = new FakeEmailVerificationSenderService();
    const authService = new AuthApplicationService(authRepository, new PasswordHasher(), new TokenService(), sender);
    const registerResult = await authService.register({
      email: "no-university@campus.edu.tr",
      password: "StrongPass123!",
      passwordConfirmation: "StrongPass123!"
    });
    await authService.verifyEmail({ email: registerResult.email, code: sender.sent[0]!.code, deviceId: "device-1" });
    const session = await authService.login({ email: registerResult.email, password: "StrongPass123!", deviceId: "device-1" });
    await authRepository.updateUserAcademicSelection(session.user.id, { universityId: "" });
    const service = new CalendarService(new InMemoryCalendarRepository(), authRepository);

    await expect(service.getMyCalendar(session.user.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns the published university calendar and university-wide events for selected university", async () => {
    const { authRepository, session } = await createStudentWithUniversity();
    const calendarRepository = await createSeededCalendarRepository();
    const service = new CalendarService(calendarRepository, authRepository);

    const response = await service.getMyCalendar(session.user.id);

    expect(response.calendar.status).toBe("published");
    expect(response.events.length).toBeGreaterThan(0);
    expect(response.scope).toBe("university");
    expect(response.events.every((event) => event.status === "published")).toBe(true);
    expect(response.events.every((event) => !event.facultyId && !event.departmentId)).toBe(true);
    expect(response.events.some((event) => event.title.includes("Diger Fakulteler"))).toBe(false);
    expect(response.events.some((event) => event.title.includes("Final Sinavlari"))).toBe(false);
    expect(response.events.some((event) => event.title.includes("Yaz Okulu"))).toBe(false);
    expect(response.events.some((event) => event.title.includes("Eski Takvim"))).toBe(false);
  });

  it("does not scope the academic calendar view by faculty or department", async () => {
    const { authRepository, session } = await createStudentWithUniversity();
    const calendarRepository = await createSeededCalendarRepository();
    const service = new CalendarService(calendarRepository, authRepository);

    const response = await service.getMyCalendar(session.user.id);

    expect(response.scope).toBe("university");
    expect(response.events).toHaveLength(1);
    expect(response.events[0]?.title).toBe("Guz Donemi Ders Kayitlari");
    expect(response.events.every((event) => !event.facultyId && !event.departmentId)).toBe(true);
  });

  it("rejects saved faculty or department calendars as university academic calendars", async () => {
    const { authRepository, session } = await createStudentWithUniversity();
    const calendarRepository = new InMemoryCalendarRepository();
    const wrongCalendar = await calendarRepository.createCalendar({
      universityId: "sample-university-1",
      academicYear: "2026-2027",
      title: "ANKARA ÜNİVERSİTESİ Rehberlik ve Psikolojik Danışmanlık 2026-2027 Akademik Takvimi",
      status: "published",
      version: 1,
      sourceUrl: "https://egitim.ankara.edu.tr/wp-content/uploads/sites/347/2026/06/2026-2027-AKADEMIK_TAKVIM.pdf",
      publishedAt: new Date()
    });
    const service = new CalendarService(calendarRepository, authRepository);
    const previousAutoIngest = process.env.CALENDAR_AUTO_INGEST_ON_MISS;
    process.env.CALENDAR_AUTO_INGEST_ON_MISS = "false";

    try {
      await expect(service.getMyCalendar(session.user.id)).rejects.toBeInstanceOf(NotFoundException);
    } finally {
      if (previousAutoIngest === undefined) delete process.env.CALENDAR_AUTO_INGEST_ON_MISS;
      else process.env.CALENDAR_AUTO_INGEST_ON_MISS = previousAutoIngest;
    }

    await expect(calendarRepository.findCalendarById(wrongCalendar.id)).resolves.toEqual(expect.objectContaining({ status: "archived" }));
  });

  it("returns upcoming events sorted by start date", async () => {
    const { authRepository, session } = await createStudentWithUniversity();
    const calendarRepository = await createSeededCalendarRepository();
    const service = new CalendarService(calendarRepository, authRepository);

    const events = await service.getUpcomingEvents(session.user.id, 10);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.startDate.getTime()).toBeLessThanOrEqual(events[events.length - 1]?.startDate.getTime() ?? 0);
    expect(events.some((event) => event.title.includes("Diger Fakulteler"))).toBe(false);
  });

  it("returns department-specific course and exam schedule tabs separately", async () => {
    const { authRepository, session } = await createStudentWithUniversity();
    const calendarRepository = await createSeededCalendarRepository();
    const service = new CalendarService(calendarRepository, authRepository);

    const courses = await service.getMyCourseSchedules(session.user.id);
    const exams = await service.getMyExamSchedules(session.user.id);

    expect(courses.profile.departmentId).toBe("sample-department-1");
    expect(courses.events).toHaveLength(1);
    expect(courses.events[0]).toEqual(expect.objectContaining({
      title: "Bilgisayar Muhendisligi Ders Programi",
      category: "course_schedule",
      departmentId: "sample-department-1"
    }));
    expect(exams.events).toHaveLength(1);
    expect(exams.events[0]).toEqual(expect.objectContaining({
      title: "Bilgisayar Muhendisligi Sinav Programi",
      category: "department_exam_schedule",
      departmentId: "sample-department-1"
    }));
  });

  it("creates mobile calendar subscription links and a tokenized ICS feed", async () => {
    const { authRepository, session } = await createStudentWithUniversity();
    const calendarRepository = await createSeededCalendarRepository();
    const service = new CalendarService(calendarRepository, authRepository);

    const links = await service.getMyCalendarIntegrationLinks(session.user.id, "https://api.example.test/");
    const token = links.feedUrl.match(/\/calendar\/integrations\/feed\/(.+)\.ics$/u)?.[1];

    expect(links.feedUrl).toMatch(/^https:\/\/api\.example\.test\/calendar\/integrations\/feed\/.+\.ics$/u);
    expect(links.webcalUrl).toBe(links.feedUrl.replace(/^https:/u, "webcal:"));
    expect(links.appleSubscribeUrl).toBe(links.webcalUrl);
    expect(links.googleSubscribeUrl).toContain(encodeURIComponent(links.feedUrl));
    expect(token).toBeTruthy();

    const feed = await service.getMyCalendarFeedByToken(token!);

    expect(feed.contentType).toBe("text/calendar; charset=utf-8");
    expect(feed.content).toContain("BEGIN:VCALENDAR");
    expect(feed.content).toContain("BEGIN:VEVENT");
    expect(feed.content).toContain("SUMMARY:Guz Donemi Ders Kayitlari");
    expect(feed.content).toContain("SUMMARY:Bilgisayar Muhendisligi Ders Programi");
    expect(feed.content).toContain("SUMMARY:Bilgisayar Muhendisligi Sinav Programi");
    expect(feed.content).toContain("SUMMARY:Yaz Okulu");
    expect(feed.content).not.toContain("Baska Bolum Ders Programi");
    expect(feed.content).not.toContain("Diger Fakulteler Ara Sinav Takvimi");
  });

  it("filters public event search by category", async () => {
    const calendarRepository = await createSeededCalendarRepository();
    const service = new CalendarService(calendarRepository, new InMemoryAuthRepository());

    const events = await service.searchEvents({ category: "final_exam" });

    expect(events.length).toBe(1);
    expect(events[0]?.category).toBe("final_exam");
  });

  it("returns summer school requirements and same-department offerings from published calendars", async () => {
    const { authRepository, session } = await createStudentWithUniversity();
    const calendarRepository = await createSeededCalendarRepository();
    const announcementRepository = new InMemoryAnnouncementRepository();
    const otherCalendar = await calendarRepository.createCalendar({
      universityId: "sample-university-2",
      academicYear: "2025-2026",
      title: "2025-2026 Yaz Okulu Takvimi",
      status: "published",
      version: 1,
      publishedAt: new Date()
    });
    await calendarRepository.createEvents([
      {
        calendarId: otherCalendar.id,
        universityId: otherCalendar.universityId,
        academicYear: otherCalendar.academicYear,
        term: "summer",
        category: "summer_school_registration",
        title: "Yaz Okulu genel ders kayitlari",
        startDate: new Date("2026-07-08T00:00:00.000Z"),
        timezone: "Europe/Istanbul",
        confidenceScore: 92,
        status: "published",
        notificationRules: []
      }
    ]);
    const otherDepartmentCalendar = await calendarRepository.createCalendar({
      universityId: "sample-university-3",
      academicYear: "2025-2026",
      title: "2025-2026 Yaz Okulu Takvimi",
      status: "published",
      version: 1,
      publishedAt: new Date()
    });
    await calendarRepository.createEvents([
      {
        calendarId: otherDepartmentCalendar.id,
        universityId: otherDepartmentCalendar.universityId,
        academicYear: otherDepartmentCalendar.academicYear,
        term: "summer",
        category: "summer_school_registration",
        title: "Yaz Okulu genel ders kayitlari",
        startDate: new Date("2026-07-09T00:00:00.000Z"),
        timezone: "Europe/Istanbul",
        confidenceScore: 92,
        status: "published",
        notificationRules: []
      }
    ]);
    const fetchedAt = new Date("2026-07-04T10:00:00.000Z").toISOString();
    const ownSource = await announcementRepository.upsertSource({
      scopeType: "university",
      scopeId: "sample-university-1",
      sourceName: "Ornek Universitesi Duyurular",
      sourceUrl: "https://ornek.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active"
    });
    const otherSource = await announcementRepository.upsertSource({
      scopeType: "university",
      scopeId: "sample-university-2",
      sourceName: "Ornek Teknik Universitesi Duyurular",
      sourceUrl: "https://teknik.example.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active"
    });
    await announcementRepository.replaceItemsForSource(ownSource, [
      {
        id: "own-summer-announcement",
        sourceId: ownSource.id,
        sourceName: ownSource.sourceName,
        scopeType: "university",
        scopeId: "sample-university-1",
        title: "Yaz Okulu basvuru duyurusu",
        link: "https://ornek.edu.tr/duyuru/yaz-okulu",
        fetchedAt
      },
      {
        id: "forged-summer-announcement",
        sourceId: ownSource.id,
        sourceName: "YÖK",
        scopeType: "university",
        scopeId: "yok",
        title: "Bilgisayar Yaz Okulu duyurusu",
        link: "https://www.yok.gov.tr/tr/duyuru/yaz-okulu",
        officialSourceUrl: "https://www.yok.gov.tr/tr/announcements",
        fetchedAt
      },
      {
        id: "quarantined-summer-announcement",
        sourceId: ownSource.id,
        sourceName: ownSource.sourceName,
        scopeType: "university",
        scopeId: ownSource.scopeId,
        title: "Bilgisayar Yaz Okulu karantina",
        link: "https://ornek.edu.tr/duyuru/karantina",
        fetchedAt,
        trustStatus: "quarantined"
      }
    ]);
    await announcementRepository.replaceItemsForSource(otherSource, [
      {
        id: "other-same-department-summer-announcement",
        sourceId: otherSource.id,
        sourceName: otherSource.sourceName,
        scopeType: "university",
        scopeId: "sample-university-2",
        title: "Bilgisayar Muhendisligi Yaz Okulu duyurusu",
        link: "https://teknik.example.edu.tr/duyuru/bilgisayar-yaz-okulu",
        fetchedAt
      },
      {
        id: "other-different-department-summer-announcement",
        sourceId: otherSource.id,
        sourceName: otherSource.sourceName,
        scopeType: "university",
        scopeId: "sample-university-2",
        title: "Makine Muhendisligi Yaz Okulu duyurusu",
        link: "https://teknik.example.edu.tr/duyuru/makine-yaz-okulu",
        fetchedAt
      }
    ]);
    const storedItems = (announcementRepository as unknown as { items: Map<string, AnnouncementItem[]> }).items;
    storedItems.set(ownSource.id, [
      ...(storedItems.get(ownSource.id) ?? []),
      {
        id: "legacy-summer-announcement",
        sourceId: ownSource.id,
        sourceName: ownSource.sourceName,
        scopeType: "university",
        scopeId: ownSource.scopeId,
        title: "Bilgisayar Yaz Okulu eski guven kaydi",
        link: "https://ornek.edu.tr/duyuru/legacy-yaz-okulu",
        fetchedAt
      },
      {
        id: "stored-rejected-summer-announcement",
        sourceId: ownSource.id,
        sourceName: ownSource.sourceName,
        scopeType: "university",
        scopeId: ownSource.scopeId,
        title: "Bilgisayar Yaz Okulu reddedilen kayit",
        link: "https://ornek.edu.tr/duyuru/rejected-yaz-okulu",
        fetchedAt,
        trustStatus: "rejected"
      },
      {
        id: "stored-quarantined-summer-announcement",
        sourceId: ownSource.id,
        sourceName: ownSource.sourceName,
        scopeType: "university",
        scopeId: ownSource.scopeId,
        title: "Bilgisayar Yaz Okulu karantina kaydi",
        link: "https://ornek.edu.tr/duyuru/quarantined-yaz-okulu",
        fetchedAt,
        trustStatus: "quarantined"
      }
    ]);
    storedItems.set("missing-source", [{
      id: "missing-source-summer-announcement",
      sourceId: "missing-source",
      sourceName: "Kaydi olmayan kaynak",
      scopeType: "university",
      scopeId: ownSource.scopeId,
      title: "Bilgisayar Yaz Okulu kaynaksiz kayit",
      link: "https://ornek.edu.tr/duyuru/missing-source-yaz-okulu",
      fetchedAt,
      trustStatus: "trusted"
    }]);
    await announcementRepository.recordSourceCheck(otherSource.id, {
      healthStatus: "failed",
      lastCheckedAt: new Date("2026-07-05T10:00:00.000Z"),
      lastError: "SOURCE_FETCH_FAILED:503",
      consecutiveFailures: 0,
      itemCount: 2
    });
    const service = new CalendarService(calendarRepository, authRepository, createCatalogRepository(), undefined, announcementRepository);

    const response = await service.getMySummerSchool(session.user.id);

    expect(response.profile.departmentName).toBe("Bilgisayar Mühendisliği");
    expect(response.requirements.some((item) => item.message.includes("Yaz Okulu"))).toBe(true);
    expect(response.ownAnnouncements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "own-summer-announcement" })
      ])
    );
    expect(response.sameDepartmentAnnouncements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "other-same-department-summer-announcement" })
      ])
    );
    expect(response.sameDepartmentAnnouncements.some((item) => item.id === "other-different-department-summer-announcement")).toBe(false);
    expect(response.announcementStatus).toEqual({ state: "partial", sourceCount: 2, failedSourceCount: 1 });
    expect(JSON.stringify(response)).not.toContain("forged-summer-announcement");
    expect(JSON.stringify(response)).not.toContain("quarantined-summer-announcement");
    expect(JSON.stringify(response)).not.toContain("legacy-summer-announcement");
    expect(JSON.stringify(response)).not.toContain("missing-source-summer-announcement");
    expect(JSON.stringify(response)).not.toContain("stored-rejected-summer-announcement");
    expect(JSON.stringify(response)).not.toContain("stored-quarantined-summer-announcement");
    expect(JSON.stringify(response)).not.toContain("trustStatus");
    expect(response.sameDepartmentOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          universityId: "sample-university-2",
          universityName: "Örnek Teknik Üniversitesi",
          matchingDepartments: expect.arrayContaining([
            expect.objectContaining({
              departmentId: "sample-department-2",
              departmentName: "Bilgisayar Muhendisligi",
              facultyName: "Muhendislik Fakultesi"
            })
          ])
        })
      ])
    );
    expect(response.sameDepartmentOptions.some((option) => option.universityId === "sample-university-3")).toBe(false);
  });
});

async function createSeededCalendarRepository() {
  const repository = new InMemoryCalendarRepository();
  const now = new Date();
  const calendar = await repository.createCalendar({
    universityId: "sample-university-1",
    academicYear: "2026-2027",
    title: "2026-2027 Akademik Takvimi",
    status: "published",
    version: 1,
    publishedAt: now
  });
  await repository.createEvents([
    {
      calendarId: calendar.id,
      universityId: calendar.universityId,
      academicYear: calendar.academicYear,
      term: "fall",
      category: "course_registration",
      title: "Guz Donemi Ders Kayitlari",
      startDate: new Date("2026-09-15T00:00:00.000Z"),
      timezone: "Europe/Istanbul",
      confidenceScore: 96,
      status: "published",
      notificationRules: []
    },
    {
      calendarId: calendar.id,
      universityId: calendar.universityId,
      facultyId: "sample-faculty-1",
      academicYear: calendar.academicYear,
      term: "fall",
      category: "final_exam",
      title: "Guz Donemi Final Sinavlari",
      startDate: new Date("2027-01-05T00:00:00.000Z"),
      timezone: "Europe/Istanbul",
      confidenceScore: 94,
      status: "published",
      notificationRules: []
    },
    {
      calendarId: calendar.id,
      universityId: calendar.universityId,
      facultyId: "sample-faculty-x",
      academicYear: calendar.academicYear,
      term: "fall",
      category: "midterm_exam",
      title: "Diger Fakulteler Ara Sinav Takvimi",
      startDate: new Date("2026-11-10T00:00:00.000Z"),
      timezone: "Europe/Istanbul",
      confidenceScore: 90,
      status: "published",
      notificationRules: []
    },
    {
      calendarId: calendar.id,
      universityId: calendar.universityId,
      facultyId: "sample-faculty-1",
      departmentId: "sample-department-1",
      academicYear: calendar.academicYear,
      term: "fall",
      category: "course_schedule",
      title: "Bilgisayar Muhendisligi Ders Programi",
      startDate: new Date("2026-09-22T00:00:00.000Z"),
      timezone: "Europe/Istanbul",
      confidenceScore: 92,
      status: "published",
      notificationRules: []
    },
    {
      calendarId: calendar.id,
      universityId: calendar.universityId,
      facultyId: "sample-faculty-1",
      departmentId: "sample-department-1",
      academicYear: calendar.academicYear,
      term: "fall",
      category: "department_exam_schedule",
      title: "Bilgisayar Muhendisligi Sinav Programi",
      startDate: new Date("2026-11-20T00:00:00.000Z"),
      timezone: "Europe/Istanbul",
      confidenceScore: 92,
      status: "published",
      notificationRules: []
    },
    {
      calendarId: calendar.id,
      universityId: calendar.universityId,
      facultyId: "sample-faculty-1",
      departmentId: "other-department",
      academicYear: calendar.academicYear,
      term: "fall",
      category: "course_schedule",
      title: "Baska Bolum Ders Programi",
      startDate: new Date("2026-09-23T00:00:00.000Z"),
      timezone: "Europe/Istanbul",
      confidenceScore: 92,
      status: "published",
      notificationRules: []
    },
    {
      calendarId: calendar.id,
      universityId: calendar.universityId,
      facultyId: "sample-faculty-1",
      departmentId: "sample-department-1",
      academicYear: calendar.academicYear,
      term: "summer",
      category: "summer_school_registration",
      title: "Yaz Okulu başvuru ve kayıt şartları",
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      timezone: "Europe/Istanbul",
      confidenceScore: 91,
      status: "published",
      notificationRules: []
    }
  ]);
  const staleCalendar = await repository.createCalendar({
    universityId: "sample-university-1",
    academicYear: "2024-2025",
    title: "2024-2025 Eski Akademik Takvimi",
    status: "published",
    version: 9,
    publishedAt: now
  });
  await repository.createEvents([
    {
      calendarId: staleCalendar.id,
      universityId: staleCalendar.universityId,
      academicYear: staleCalendar.academicYear,
      term: "fall",
      category: "course_registration",
      title: "Eski Takvim Ders Kayitlari",
      startDate: new Date("2024-09-15T00:00:00.000Z"),
      timezone: "Europe/Istanbul",
      confidenceScore: 96,
      status: "published",
      notificationRules: []
    }
  ]);
  return repository;
}

function createCatalogRepository(): CatalogRepository {
  const now = new Date();
  const universities: UniversityRecord[] = [
    {
      id: "sample-university-1",
      name: "Örnek Üniversitesi",
      slug: "ornek-universitesi",
      city: "ANKARA",
      type: "state",
      status: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "sample-university-2",
      name: "Örnek Teknik Üniversitesi",
      slug: "ornek-teknik-universitesi",
      city: "ISTANBUL",
      type: "state",
      status: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "sample-university-3",
      name: "Baska Teknik Universitesi",
      slug: "baska-teknik-universitesi",
      city: "IZMIR",
      type: "state",
      status: "active",
      createdAt: now,
      updatedAt: now
    }
  ];
  const faculties: FacultyRecord[] = [
    {
      id: "sample-faculty-1",
      universityId: "sample-university-1",
      name: "Mühendislik Fakültesi",
      slug: "muhendislik-fakultesi",
      status: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "sample-faculty-2",
      universityId: "sample-university-2",
      name: "Muhendislik Fakultesi",
      slug: "muhendislik-fakultesi",
      status: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "sample-faculty-3",
      universityId: "sample-university-3",
      name: "Muhendislik Fakultesi",
      slug: "muhendislik-fakultesi",
      status: "active",
      createdAt: now,
      updatedAt: now
    }
  ];
  const departments: DepartmentRecord[] = [
    {
      id: "sample-department-1",
      universityId: "sample-university-1",
      facultyId: "sample-faculty-1",
      name: "Bilgisayar Mühendisliği",
      slug: "bilgisayar-muhendisligi",
      educationLevel: "bachelor",
      status: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "sample-department-2",
      universityId: "sample-university-2",
      facultyId: "sample-faculty-2",
      name: "Bilgisayar Muhendisligi",
      slug: "bilgisayar-muhendisligi",
      educationLevel: "bachelor",
      status: "active",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "sample-department-3",
      universityId: "sample-university-3",
      facultyId: "sample-faculty-3",
      name: "Makine Muhendisligi",
      slug: "makine-muhendisligi",
      educationLevel: "bachelor",
      status: "active",
      createdAt: now,
      updatedAt: now
    }
  ];

  return {
    async createUniversity() {
      throw new Error("not used");
    },
    async updateUniversity() {
      throw new Error("not used");
    },
    async archiveUniversity() {
      throw new Error("not used");
    },
    async findUniversityById(id) {
      return universities.find((university) => university.id === id) ?? null;
    },
    async listUniversities(input) {
      return universities.slice(input.offset, input.offset + input.limit);
    },
    async findUniversityByEmailDomain() {
      return null;
    },
    async createFaculty() {
      throw new Error("not used");
    },
    async updateFaculty() {
      throw new Error("not used");
    },
    async listFaculties(universityId) {
      return faculties.filter((faculty) => faculty.universityId === universityId);
    },
    async createDepartment() {
      throw new Error("not used");
    },
    async updateDepartment() {
      throw new Error("not used");
    },
    async listDepartments(facultyId) {
      return departments.filter((department) => department.facultyId === facultyId);
    }
  };
}
