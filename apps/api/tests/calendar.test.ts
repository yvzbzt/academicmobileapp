import { BadRequestException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AuthApplicationService } from "../src/modules/auth/auth-application.service.js";
import { EmailVerificationSenderService, type SendVerificationEmailInput } from "../src/modules/auth/email-verification-sender.service.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import { TokenService } from "../src/modules/auth/token.service.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import type { AnnouncementItem } from "../src/modules/announcements/announcements.types.js";
import { endpointCatalog } from "../src/contracts/endpoint-catalog.js";
import { CalendarController } from "../src/modules/calendars/calendar.controller.js";
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

  it("returns the published university calendar and events matching the student's academic scope", async () => {
    const { authRepository, session } = await createStudentWithUniversity();
    const calendarRepository = await createSeededCalendarRepository();
    const service = new CalendarService(calendarRepository, authRepository);

    const response = await service.getMyCalendar(session.user.id);

    expect(response.calendar.status).toBe("published");
    expect(response.events.length).toBeGreaterThan(0);
    expect(response.scope).toBe("university");
    expect(response.events.every((event) => event.status === "published")).toBe(true);
    expect(response.events.some((event) => event.title.includes("Diger Fakulteler"))).toBe(false);
    expect(response.events.some((event) => event.title.includes("Final Sinavlari"))).toBe(true);
    expect(response.events.some((event) => event.title.includes("Yaz Okulu"))).toBe(true);
    expect(response.events.some((event) => event.title.includes("Eski Takvim"))).toBe(false);
  });

  it("includes university, faculty, and department events while excluding other academic scopes", async () => {
    const { authRepository, session } = await createStudentWithUniversity();
    const calendarRepository = await createSeededCalendarRepository();
    const calendar = await calendarRepository.findPublishedCalendar("sample-university-1");
    expect(calendar).not.toBeNull();
    await calendarRepository.createEvents([
      {
        calendarId: calendar!.id,
        universityId: calendar!.universityId,
        facultyId: "sample-faculty-1",
        departmentId: "sample-department-1",
        academicYear: calendar!.academicYear,
        term: "fall",
        category: "custom_event",
        title: "Own department custom event",
        startDate: new Date("2026-10-20T10:00:00.000Z"),
        timezone: "Europe/Istanbul",
        status: "published",
        notificationRules: []
      },
      {
        calendarId: calendar!.id,
        universityId: calendar!.universityId,
        facultyId: "sample-faculty-1",
        departmentId: "other-department",
        academicYear: calendar!.academicYear,
        term: "fall",
        category: "custom_event",
        title: "Other department custom event",
        startDate: new Date("2026-10-21T10:00:00.000Z"),
        timezone: "Europe/Istanbul",
        status: "published",
        notificationRules: []
      }
    ]);
    const service = new CalendarService(calendarRepository, authRepository);

    const response = await service.getMyCalendar(session.user.id);

    expect(response.scope).toBe("university");
    expect(response.events.map((event) => event.title)).toEqual(expect.arrayContaining([
      "Guz Donemi Ders Kayitlari",
      "Guz Donemi Final Sinavlari",
      "Own department custom event"
    ]));
    expect(response.events.some((event) => event.title === "Diger Fakulteler Ara Sinav Takvimi")).toBe(false);
    expect(response.events.some((event) => event.title === "Other department custom event")).toBe(false);
    expect(response.events.some((event) => event.category === "course_schedule")).toBe(false);
    expect(response.events.some((event) => event.category === "department_exam_schedule")).toBe(false);
  });

  it("resolves an exact trusted event beyond the calendar collection cap and hides every unavailable case", async () => {
    const { authRepository, session } = await createStudentWithUniversity();
    const calendarRepository = new InMemoryCalendarRepository();
    const calendar = await calendarRepository.createCalendar({
      universityId: "sample-university-1",
      academicYear: "2026-2027",
      title: "2026-2027 Akademik Takvimi",
      status: "published",
      version: 1,
      publishedAt: new Date("2026-07-01T00:00:00.000Z")
    });
    const events = await calendarRepository.createEvents(Array.from({ length: 205 }, (_, index) => ({
      calendarId: calendar.id,
      universityId: calendar.universityId,
      academicYear: calendar.academicYear,
      term: "fall" as const,
      category: "course_registration" as const,
      title: `Akademik olay ${String(index + 1).padStart(3, "0")}`,
      startDate: new Date(Date.UTC(2026, 8, index + 1)),
      timezone: "Europe/Istanbul" as const,
      confidenceScore: 95,
      status: "published" as const,
      notificationRules: []
    })));
    const exactTarget = events[204]!;
    const otherUniversityCalendar = await calendarRepository.createCalendar({
      universityId: "sample-university-2",
      academicYear: "2026-2027",
      title: "Other university calendar",
      status: "published",
      version: 1,
      publishedAt: new Date("2026-07-01T00:00:00.000Z")
    });
    const [outOfScope] = await calendarRepository.createEvents([{
      calendarId: otherUniversityCalendar.id,
      universityId: otherUniversityCalendar.universityId,
      academicYear: otherUniversityCalendar.academicYear,
      term: "fall",
      category: "course_registration",
      title: "Other university event",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      timezone: "Europe/Istanbul",
      status: "published",
      notificationRules: []
    }]);
    const [visibleFaculty, hiddenFaculty, visibleDepartment, hiddenDepartment, unpublished] = await calendarRepository.createEvents([
      { facultyId: "sample-faculty-1", title: "Own faculty event", status: "published" },
      { facultyId: "other-faculty", title: "Other faculty event", status: "published" },
      { facultyId: "sample-faculty-1", departmentId: "sample-department-1", title: "Own department event", status: "published" },
      { facultyId: "sample-faculty-1", departmentId: "other-department", title: "Other department event", status: "published" },
      { title: "Unpublished event", status: "approved" }
    ].map((item, index) => ({
      calendarId: calendar.id,
      universityId: calendar.universityId,
      academicYear: calendar.academicYear,
      term: "fall" as const,
      category: "custom_event" as const,
      title: item.title,
      startDate: new Date(Date.UTC(2027, 4, index + 1)),
      timezone: "Europe/Istanbul" as const,
      status: item.status as "published" | "approved",
      notificationRules: [],
      ...(item.facultyId ? { facultyId: item.facultyId } : {}),
      ...(item.departmentId ? { departmentId: item.departmentId } : {})
    })));
    const archivedCalendar = await calendarRepository.createCalendar({
      universityId: "sample-university-1",
      academicYear: "2025-2026",
      title: "Archived calendar",
      status: "archived",
      version: 1,
      publishedAt: new Date("2025-07-01T00:00:00.000Z")
    });
    const [unavailable] = await calendarRepository.createEvents([{
      calendarId: archivedCalendar.id,
      universityId: archivedCalendar.universityId,
      academicYear: archivedCalendar.academicYear,
      term: "fall",
      category: "course_registration",
      title: "Archived event",
      startDate: new Date("2025-09-01T00:00:00.000Z"),
      timezone: "Europe/Istanbul",
      status: "published",
      notificationRules: []
    }]);
    const service = new CalendarService(calendarRepository, authRepository);
    const controller = new CalendarController(service);

    const collection = await controller.getMyCalendar(session.user);
    expect(collection.events).toHaveLength(200);
    expect(collection.events.some((event) => event.id === exactTarget.id)).toBe(false);

    await expect(controller.getMyTrustedCalendarEvent(session.user, exactTarget.id))
      .resolves.toEqual(expect.objectContaining({ id: exactTarget.id, title: exactTarget.title, status: "published" }));
    await expect(controller.getMyTrustedCalendarEvent(session.user, visibleFaculty!.id))
      .resolves.toEqual(expect.objectContaining({ id: visibleFaculty!.id }));
    await expect(controller.getMyTrustedCalendarEvent(session.user, visibleDepartment!.id))
      .resolves.toEqual(expect.objectContaining({ id: visibleDepartment!.id }));

    const hiddenResponse = {
      response: {
        message: "Trusted calendar event not found.",
        error: "Not Found",
        statusCode: 404
      },
      status: 404
    };
    for (const hiddenId of [
      " ",
      "missing-event",
      outOfScope!.id,
      hiddenFaculty!.id,
      hiddenDepartment!.id,
      unpublished!.id,
      unavailable!.id
    ]) {
      await expect(controller.getMyTrustedCalendarEvent(session.user, hiddenId))
        .rejects.toMatchObject(hiddenResponse);
    }

    expect(endpointCatalog).toContainEqual({
      method: "GET",
      path: "/calendar/my/trusted/:eventId",
      authRequired: true,
      roles: ["student"],
      rateLimit: "standard"
    });
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

  it("keeps same-day, ongoing, and mixed-end events upcoming with Istanbul semantics", async () => {
    const repository = new InMemoryCalendarRepository();
    const calendar = await repository.createCalendar({
      universityId: "sample-university-1",
      academicYear: "2026-2027",
      title: "Temporal calendar",
      status: "published",
      version: 1,
      publishedAt: new Date("2026-08-01T00:00:00.000Z")
    });
    const common = {
      calendarId: calendar.id,
      universityId: calendar.universityId,
      academicYear: calendar.academicYear,
      term: "fall" as const,
      category: "course_registration" as const,
      timezone: "Europe/Istanbul" as const,
      confidenceScore: 98,
      status: "published" as const,
      notificationRules: []
    };
    await repository.createEvents([
      {
        ...common,
        title: "Same Istanbul day",
        temporalKind: "date",
        dateOnlyStart: "2026-08-04",
        startDate: new Date("2026-08-04T00:00:00.000Z")
      },
      {
        ...common,
        title: "Ongoing timestamp",
        temporalKind: "timestamp",
        endTemporalKind: "timestamp",
        startDate: new Date("2026-08-03T10:00:00.000Z"),
        endDate: new Date("2026-08-04T19:00:00.000Z")
      },
      {
        ...common,
        title: "Mixed inclusive end",
        temporalKind: "timestamp",
        endTemporalKind: "date",
        dateOnlyEnd: "2026-08-04",
        startDate: new Date("2026-08-01T10:00:00.000Z"),
        endDate: new Date("2026-08-04T23:59:59.999Z")
      },
      {
        ...common,
        title: "Already ended timestamp",
        temporalKind: "timestamp",
        endTemporalKind: "timestamp",
        startDate: new Date("2026-08-03T10:00:00.000Z"),
        endDate: new Date("2026-08-04T17:00:00.000Z")
      },
      {
        ...common,
        title: "Previous Istanbul day",
        temporalKind: "date",
        dateOnlyStart: "2026-08-03",
        startDate: new Date("2026-08-03T00:00:00.000Z")
      }
    ]);

    const events = await repository.listUpcomingEvents({
      universityId: calendar.universityId,
      fromDate: new Date("2026-08-04T18:00:00.000Z"),
      limit: 10
    });

    expect(events.map((event) => event.title)).toEqual([
      "Mixed inclusive end",
      "Ongoing timestamp",
      "Same Istanbul day"
    ]);
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
    const calendar = await calendarRepository.findPublishedCalendar("sample-university-1", "2026-2027");
    await calendarRepository.createEvents([
      {
        calendarId: calendar!.id,
        universityId: calendar!.universityId,
        academicYear: calendar!.academicYear,
        term: "fall",
        category: "course_registration",
        title: "Inclusive date range",
        temporalKind: "date",
        endTemporalKind: "date",
        dateOnlyStart: "2026-09-01",
        dateOnlyEnd: "2026-09-03",
        startDate: new Date("2026-09-01T00:00:00.000Z"),
        endDate: new Date("2026-09-03T23:59:59.999Z"),
        timezone: "Europe/Istanbul",
        confidenceScore: 98,
        status: "published",
        notificationRules: []
      },
      {
        calendarId: calendar!.id,
        universityId: calendar!.universityId,
        academicYear: calendar!.academicYear,
        term: "fall",
        category: "midterm_exam",
        title: "Real timed range",
        location: "Muhendislik Fak. - A Blok 201",
        temporalKind: "timestamp",
        endTemporalKind: "timestamp",
        startDate: new Date("2026-11-10T06:30:00.000Z"),
        endDate: new Date("2026-11-10T08:00:00.000Z"),
        timezone: "Europe/Istanbul",
        confidenceScore: 98,
        status: "published",
        notificationRules: []
      },
      {
        calendarId: calendar!.id,
        universityId: calendar!.universityId,
        academicYear: calendar!.academicYear,
        term: "fall",
        category: "custom_event",
        title: "Mixed temporal range",
        temporalKind: "timestamp",
        endTemporalKind: "date",
        dateOnlyEnd: "2026-09-12",
        startDate: new Date("2026-09-10T06:30:00.000Z"),
        endDate: new Date("2026-09-12T23:59:59.999Z"),
        timezone: "Europe/Istanbul",
        confidenceScore: 98,
        status: "published",
        notificationRules: []
      },
      {
        calendarId: calendar!.id,
        universityId: calendar!.universityId,
        academicYear: calendar!.academicYear,
        term: "fall",
        category: "custom_event",
        title: "Inverse mixed temporal range",
        temporalKind: "date",
        endTemporalKind: "timestamp",
        dateOnlyStart: "2026-09-01",
        startDate: new Date("2026-09-01T00:00:00.000Z"),
        endDate: new Date("2026-09-03T14:00:00.000Z"),
        timezone: "Europe/Istanbul",
        confidenceScore: 98,
        status: "published",
        notificationRules: []
      },
      {
        calendarId: calendar!.id,
        universityId: calendar!.universityId,
        academicYear: calendar!.academicYear,
        term: "fall",
        category: "custom_event",
        title: "Historical inverse mixed temporal range",
        temporalKind: "date",
        endTemporalKind: "timestamp",
        dateOnlyStart: "1910-10-01",
        startDate: new Date("1910-10-01T00:00:00.000Z"),
        endDate: new Date("1910-10-01T12:00:00.000Z"),
        timezone: "Europe/Istanbul",
        confidenceScore: 98,
        status: "published",
        notificationRules: []
      }
    ]);
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
    expect(feed.content).toContain("DTSTART;VALUE=DATE:20260901\r\nDTEND;VALUE=DATE:20260904");
    expect(feed.content).toContain("DTSTART:20261110T063000Z\r\nDTEND:20261110T080000Z");
    expect(feed.content).toContain("LOCATION:Muhendislik Fak. - A Blok 201");
    expect(feed.content).toContain("DTSTART:20260910T063000Z\r\nDTEND:20260912T210000Z");
    expect(feed.content).toContain("DTSTART:20260831T210000Z\r\nDTEND:20260903T140000Z");
    expect(feed.content).toContain("DTSTART:19100930T220304Z\r\nDTEND:19101001T120000Z");
    expect(feed.content).not.toContain("Baska Bolum Ders Programi");
    expect(feed.content).not.toContain("Diger Fakulteler Ara Sinav Takvimi");

    const [payload, signature] = decodeURIComponent(token!).split(".");
    const tamperedSignature = `${signature!.slice(0, -1)}${signature!.endsWith("A") ? "B" : "A"}`;
    await expect(service.getMyCalendarFeedByToken(`${payload}.${tamperedSignature}`))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.getMyCalendarFeedByToken(`${payload}.short`))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.getMyCalendarFeedByToken("%E0%A4%A"))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.getMyCalendarFeedByToken(`${payload}.${signature}.extra`))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.getMyCalendarFeedByToken("x".repeat(4_097)))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("filters public event search by category", async () => {
    const calendarRepository = await createSeededCalendarRepository();
    const service = new CalendarService(calendarRepository, new InMemoryAuthRepository());

    const events = await service.searchEvents({ category: "final_exam" });

    expect(events.length).toBe(1);
    expect(events[0]?.category).toBe("final_exam");
  });

  it("validates public search ranges and preserves date-only query boundaries", async () => {
    let captured: Parameters<CalendarService["searchEvents"]>[0] | undefined;
    const service = {
      async searchEvents(input: Parameters<CalendarService["searchEvents"]>[0]) {
        captured = input;
        return [];
      }
    } as unknown as CalendarService;
    const controller = new CalendarController(service);

    await expect(controller.searchEvents({
      startDate: "2026-08-01",
      endDate: "2026-08-07"
    })).resolves.toEqual([]);
    expect(captured).toMatchObject({
      startBoundary: { temporalKind: "date", dateOnly: "2026-08-01" },
      endBoundary: { temporalKind: "date", dateOnly: "2026-08-07" }
    });
    await expect(controller.searchEvents({
      startDate: "2026-08-08",
      endDate: "2026-08-07"
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.searchEvents({
      startDate: "2026-08-07T12:00:00"
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns summer school requirements and same-department offerings from published calendars", { timeout: 15_000 }, async () => {
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
      status: "active",
      trustStatus: "trusted"
    });
    const ownSecondarySource = await announcementRepository.upsertSource({
      scopeType: "university",
      scopeId: "sample-university-1",
      sourceName: "Ornek Universitesi Haberler",
      sourceUrl: "https://ornek.edu.tr/haberler",
      parser: "auto",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    const otherSource = await announcementRepository.upsertSource({
      scopeType: "university",
      scopeId: "sample-university-2",
      sourceName: "Ornek Teknik Universitesi Duyurular",
      sourceUrl: "https://teknik.example.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
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
    await announcementRepository.replaceItemsForSource(ownSecondarySource, [{
      id: "own-secondary-source-summer-announcement",
      sourceId: ownSecondarySource.id,
      sourceName: ownSecondarySource.sourceName,
      scopeType: "university",
      scopeId: "sample-university-1",
      title: "Yaz Okulu basvuru duyurusu",
      link: "https://ornek.edu.tr/duyuru/yaz-okulu?utm_source=secondary",
      fetchedAt
    }]);
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
        expect.objectContaining({
          id: "own-summer-announcement",
          sourceId: ownSource.id,
          universityId: "sample-university-1",
          universityName: "Örnek Üniversitesi"
        }),
        expect.objectContaining({
          id: "own-secondary-source-summer-announcement",
          sourceId: ownSecondarySource.id,
          universityId: "sample-university-1",
          universityName: "Örnek Üniversitesi"
        })
      ])
    );
    expect(response.ownAnnouncements.filter((item) => item.title === "Yaz Okulu basvuru duyurusu")).toHaveLength(2);
    expect(response.sameDepartmentAnnouncements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "other-same-department-summer-announcement",
          universityId: "sample-university-2",
          universityName: "Örnek Teknik Üniversitesi"
        })
      ])
    );
    expect(response.sameDepartmentAnnouncements.some((item) => item.id === "other-different-department-summer-announcement")).toBe(false);
    expect(response.announcementStatus).toEqual({ state: "partial", sourceCount: 3, failedSourceCount: 1 });
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
