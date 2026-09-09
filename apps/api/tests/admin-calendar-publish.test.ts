import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminCalendarService } from "../src/modules/calendars/admin-calendar.service.js";
import { CalendarService } from "../src/modules/calendars/calendar.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { InMemoryPdfRepository } from "../src/modules/pdf/in-memory-pdf.repository.js";
import { PdfProcessingService } from "../src/modules/pdf/pdf-processing.service.js";
import type { AcademicCalendarRecord, AcademicEventRecord } from "../src/modules/calendars/calendar.types.js";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";
import { NotificationSchedulingService } from "../src/modules/notifications/notifications.service.js";

const validPdfData = Buffer.from("%PDF-1.7\npublish-flow-fixture", "utf8");
const validPdfInput = {
  universityId: "sample-university-1",
  fileName: "publish-flow.pdf",
  mimeType: "application/pdf",
  magicBytesHex: "255044462d312e37",
  fileSize: validPdfData.byteLength,
  pageCount: 2,
  academicYear: "2026-2027",
  uploadedBy: "admin-1",
  pdfData: validPdfData,
  rawText: "15-19 Eylul 2026 Guz Donemi Ders Kayitlari\n05-16 Ocak 2027 Guz Donemi Final Sinavlari"
};

const disabledOcrService = {
  async extractText() {
    return null;
  }
};

async function createApprovedExtractedEvents() {
  const pdfRepository = new InMemoryPdfRepository();
  const pdfService = new PdfProcessingService(pdfRepository, disabledOcrService);
  const source = await pdfService.createPdfSource(validPdfInput);
  const processed = await pdfService.processPdfSource(source.id);
  for (const event of processed.extractedEvents) {
    await pdfService.approveExtractedEvent(event.id, "admin-1");
  }
  return { pdfRepository, source };
}

describe("AdminCalendarService", () => {
  it("keeps metadata-only legacy PDF identities out of calendar publication", async () => {
    const pdfRepository = new InMemoryPdfRepository();
    const pdfService = new PdfProcessingService(pdfRepository, disabledOcrService);
    const { pdfData: _pdfData, ...legacyInput } = validPdfInput;
    void _pdfData;
    const source = await pdfService.createPdfSource(legacyInput);
    const processed = await pdfService.processPdfSource(source.id);
    await pdfService.approveExtractedEvent(processed.extractedEvents[0]!.id, "admin-1");
    const service = new AdminCalendarService(new InMemoryCalendarRepository(), pdfRepository);

    await expect(service.createDraftFromApprovedExtractedEvents({
      universityId: source.universityId,
      academicYear: source.academicYear,
      title: "Unverified legacy source",
      sourcePdfId: source.id,
      createdBy: "admin-1"
    })).rejects.toThrow("verified PDF binary identity");
  });

  it("refuses to publish a pre-existing draft backed by an unverified legacy PDF identity", async () => {
    const pdfRepository = new InMemoryPdfRepository();
    const pdfService = new PdfProcessingService(pdfRepository, disabledOcrService);
    const { pdfData: _pdfData, ...legacyInput } = validPdfInput;
    void _pdfData;
    const source = await pdfService.createPdfSource(legacyInput);
    const calendarRepository = new InMemoryCalendarRepository();
    const draft = await calendarRepository.createCalendar({
      universityId: source.universityId,
      academicYear: source.academicYear,
      title: "Legacy draft",
      status: "draft",
      version: 1,
      sourcePdfId: source.id
    });
    const service = new AdminCalendarService(calendarRepository, pdfRepository);

    await expect(service.publishCalendar(draft.id, "admin-1"))
      .rejects.toThrow("verified PDF binary identity");
  });

  it("propagates a published manual admin event only to students in its academic scope", async () => {
    const calendarRepository = new InMemoryCalendarRepository();
    const authRepository = new InMemoryAuthRepository();
    const adminService = new AdminCalendarService(calendarRepository, new InMemoryPdfRepository());
    const studentService = new CalendarService(calendarRepository, authRepository);
    const matchingStudent = await authRepository.createUser({
      fullName: "Matching Student",
      email: "matching@student.example.edu.tr",
      passwordHash: "test-only-hash",
      role: "student",
      universityId: "sample-university-1",
      facultyId: "engineering",
      departmentId: "computer-engineering",
      status: "active"
    });
    const otherDepartmentStudent = await authRepository.createUser({
      fullName: "Other Department Student",
      email: "other@student.example.edu.tr",
      passwordHash: "test-only-hash",
      role: "student",
      universityId: "sample-university-1",
      facultyId: "engineering",
      departmentId: "industrial-engineering",
      status: "active"
    });
    const draft = await adminService.createManualDraft({
      universityId: "sample-university-1",
      academicYear: "2026-2027",
      title: "Admin to student propagation",
      createdBy: "admin-1",
      events: [{
        facultyId: "engineering",
        departmentId: "computer-engineering",
        title: "Bilgisayar Muhendisligi Kayit Yenileme",
        description: "Admin panelinden eklenen kapsamli etkinlik",
        category: "course_registration",
        term: "fall",
        startDate: "2026-09-14",
        location: "Ogrenci Isleri"
      }]
    });
    expect(draft.events[0]).toEqual(expect.objectContaining({
      studentRelevance: "relevant",
      topic: "course_registration",
      classificationVersion: "student-relevance-rules-v2"
    }));

    await adminService.publishCalendar(draft.calendar.id, "admin-1");
    await adminService.createCourseScheduleSeries({
      universityId: "sample-university-1",
      facultyId: "engineering",
      departmentId: "computer-engineering",
      academicYear: "2026-2027",
      term: "fall",
      title: "Veri Yapilari",
      courseName: "CENG 201",
      location: "A-201",
      startDate: "2026-09-15T09:00:00+03:00",
      endDate: "2026-09-15T10:00:00+03:00",
      repeatWeekly: false
    });

    const matchingCalendar = await studentService.getMyCalendar(matchingStudent.id);
    const otherDepartmentCalendar = await studentService.getMyCalendar(otherDepartmentStudent.id);
    const matchingCourseSchedule = await studentService.getMyCourseSchedules(matchingStudent.id);
    const otherDepartmentCourseSchedule = await studentService.getMyCourseSchedules(otherDepartmentStudent.id);
    expect(matchingCalendar.events).toEqual([
      expect.objectContaining({
        title: "Bilgisayar Muhendisligi Kayit Yenileme",
        description: "Admin panelinden eklenen kapsamli etkinlik",
        category: "course_registration",
        facultyId: "engineering",
        departmentId: "computer-engineering",
        status: "published",
        location: "Ogrenci Isleri"
      })
    ]);
    expect(otherDepartmentCalendar.events).toHaveLength(0);
    expect(matchingCourseSchedule).toEqual(expect.objectContaining({
      sourceStatus: "parsed",
      events: [expect.objectContaining({
        title: "Veri Yapilari",
        courseName: "CENG 201",
        location: "A-201",
        departmentId: "computer-engineering",
        status: "published"
      })]
    }));
    expect(otherDepartmentCourseSchedule.events).toHaveLength(0);
  });

  it("preserves explicit course and location metadata on manually authored events", async () => {
    const service = new AdminCalendarService(
      new InMemoryCalendarRepository(),
      new InMemoryPdfRepository()
    );

    const draft = await service.createManualDraft({
      universityId: "sample-university-1",
      academicYear: "2026-2027",
      title: "Located events",
      createdBy: "admin-1",
      events: [{
        title: "Veri Yapıları Final Sınavı",
        courseName: "  Veri Yapıları  ",
        category: "final_exam",
        term: "fall",
        startDate: "2026-11-10T09:30:00+03:00",
        endDate: "2026-11-10T11:00:00+03:00",
        location: "  Mühendislik Fak. – A Blok 201  "
      }]
    });

    expect(draft.events[0]).toMatchObject({
      courseName: "Veri Yapıları",
      location: "Mühendislik Fak. – A Blok 201",
      startDate: new Date("2026-11-10T06:30:00.000Z"),
      endDate: new Date("2026-11-10T08:00:00.000Z")
    });
  });

  it.each([
    ["ambiguous instant", { startDate: "2026-09-01T09:30:00", endDate: "2026-09-01T11:00:00+03:00" }],
    ["reverse date range", { startDate: "2026-09-03", endDate: "2026-09-01" }],
    ["reverse instant range", { startDate: "2026-09-03T11:00:00+03:00", endDate: "2026-09-03T10:59:59+03:00" }]
  ])("rejects a manual calendar %s before creating its parent draft", async (_label, temporal) => {
    const calendarRepository = new InMemoryCalendarRepository();
    const createCalendar = vi.spyOn(calendarRepository, "createCalendar");
    const service = new AdminCalendarService(calendarRepository, new InMemoryPdfRepository());

    await expect(service.createManualDraft({
      universityId: "sample-university-1",
      academicYear: "2026-2027",
      title: "Invalid temporal draft",
      createdBy: "admin-1",
      events: [{
        title: "Invalid event",
        category: "course_registration",
        term: "fall",
        ...temporal
      }]
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(createCalendar).not.toHaveBeenCalled();
  });

  it("rejects an invalid approved extracted range before creating its parent draft", async () => {
    const { pdfRepository, source } = await createApprovedExtractedEvents();
    const [approved] = await pdfRepository.listExtractedEvents({
      pdfSourceId: source.id,
      status: "approved",
      limit: 10,
      offset: 0
    });
    await pdfRepository.updateExtractedEvent(approved!.id, {
      temporalKind: "date",
      dateOnlyStart: "2026-09-03",
      startDate: new Date("2026-09-03T00:00:00.000Z"),
      endTemporalKind: "date",
      dateOnlyEnd: "2026-09-01",
      endDate: new Date("2026-09-01T23:59:59.999Z")
    });
    const calendarRepository = new InMemoryCalendarRepository();
    const createCalendar = vi.spyOn(calendarRepository, "createCalendar");
    const service = new AdminCalendarService(calendarRepository, pdfRepository);

    await expect(service.createDraftFromApprovedExtractedEvents({
      universityId: source.universityId,
      academicYear: source.academicYear,
      title: "Invalid extracted draft",
      sourcePdfId: source.id,
      createdBy: "admin-1"
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(createCalendar).not.toHaveBeenCalled();
  });

  it("creates a draft calendar from approved extracted events", async () => {
    const { pdfRepository, source } = await createApprovedExtractedEvents();
    const calendarRepository = new InMemoryCalendarRepository();
    const service = new AdminCalendarService(calendarRepository, pdfRepository);

    const draft = await service.createDraftFromApprovedExtractedEvents({
      universityId: source.universityId,
      academicYear: source.academicYear,
      title: "PDF'den Gelen Taslak Takvim",
      sourcePdfId: source.id,
      createdBy: "admin-1"
    });

    expect(draft.calendar.status).toBe("draft");
    expect(draft.calendar.version).toBe(1);
    expect(draft.events).toHaveLength(2);
    expect(draft.events.every((event) => event.status === "approved")).toBe(true);
    expect(draft.events.every((event) => event.classificationVersion === "student-relevance-rules-v2")).toBe(true);
  });

  it("binds reused semantic events to the PDF snapshot selected for the draft", async () => {
    const pdfRepository = new InMemoryPdfRepository();
    const pdfService = new PdfProcessingService(pdfRepository, disabledOcrService);
    const firstBytes = Buffer.from("%PDF-1.7\ncalendar-revision-one", "utf8");
    const secondBytes = Buffer.from("%PDF-1.7\ncalendar-revision-two", "utf8");
    const firstSource = await pdfService.createPdfSource({
      ...validPdfInput,
      fileName: "calendar-revision-one.pdf",
      fileSize: firstBytes.byteLength,
      pdfData: firstBytes
    });
    const secondSource = await pdfService.createPdfSource({
      ...validPdfInput,
      fileName: "calendar-revision-two.pdf",
      fileSize: secondBytes.byteLength,
      pdfData: secondBytes
    });
    const first = await pdfService.processPdfSource(firstSource.id);
    for (const event of first.extractedEvents) await pdfService.approveExtractedEvent(event.id, "admin-1");
    await pdfService.processPdfSource(secondSource.id);
    const service = new AdminCalendarService(new InMemoryCalendarRepository(), pdfRepository);

    const draft = await service.createDraftFromApprovedExtractedEvents({
      universityId: secondSource.universityId,
      academicYear: secondSource.academicYear,
      title: "Second PDF revision",
      sourcePdfId: secondSource.id,
      createdBy: "admin-1"
    });

    expect(draft.events).not.toHaveLength(0);
    expect(draft.events.every((event) => event.sourcePdfId === secondSource.id)).toBe(true);
  });

  it("carries a date-only start and real timestamp end through the approved draft", async () => {
    const pdfRepository = new InMemoryPdfRepository();
    const pdfService = new PdfProcessingService(pdfRepository, disabledOcrService);
    const source = await pdfService.createPdfSource({
      ...validPdfInput,
      fileName: "inverse-mixed-publish-flow.pdf",
      rawText: "Basvuru sonuclari 01.09.2026 - 03.09.2026 17:00"
    });
    const processed = await pdfService.processPdfSource(source.id);
    await pdfService.approveExtractedEvent(processed.extractedEvents[0]!.id, "admin-1");
    const service = new AdminCalendarService(new InMemoryCalendarRepository(), pdfRepository);

    const draft = await service.createDraftFromApprovedExtractedEvents({
      universityId: source.universityId,
      academicYear: source.academicYear,
      title: "Karma zaman araligi",
      sourcePdfId: source.id,
      createdBy: "admin-1"
    });

    expect(draft.events[0]).toMatchObject({
      temporalKind: "date",
      endTemporalKind: "timestamp",
      dateOnlyStart: "2026-09-01",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-09-03T14:00:00.000Z")
    });
  });

  it("publishes draft calendar and archives previous published calendar", async () => {
    const { pdfRepository, source } = await createApprovedExtractedEvents();
    const calendarRepository = new InMemoryCalendarRepository();
    const service = new AdminCalendarService(calendarRepository, pdfRepository);
    const draft = await service.createDraftFromApprovedExtractedEvents({
      universityId: source.universityId,
      academicYear: source.academicYear,
      title: "Yayina Alinacak Takvim",
      sourcePdfId: source.id,
      createdBy: "admin-1"
    });

    const published = await service.publishCalendar(draft.calendar.id, "admin-1");
    const activeCalendar = await calendarRepository.findPublishedCalendar(source.universityId, source.academicYear);

    expect(published.calendar.status).toBe("published");
    expect(published.archivedCalendarCount).toBe(0);
    expect(published.publishedEvents.every((event) => event.status === "published")).toBe(true);
    expect(activeCalendar?.id).toBe(draft.calendar.id);
  });

  it("keeps one deterministic calendar and only its notification jobs when two drafts publish concurrently", async () => {
    const calendarRepository = new InMemoryCalendarRepository();
    const notificationRepository = new InMemoryNotificationRepository();
    const scheduler = new PausingNotificationSchedulingService(notificationRepository);
    const service = new AdminCalendarService(calendarRepository, new InMemoryPdfRepository(), scheduler);
    const left = await service.createManualDraft({
      universityId: "sample-university-1",
      academicYear: "2026-2027",
      title: "Concurrent left",
      createdBy: "admin-1",
      events: [{ title: "Left event", category: "fall_term_start", term: "fall", startDate: "2026-09-07" }]
    });
    const right = await service.createManualDraft({
      universityId: "sample-university-1",
      academicYear: "2026-2027",
      title: "Concurrent right",
      createdBy: "admin-2",
      events: [{ title: "Right event", category: "fall_term_start", term: "fall", startDate: "2026-09-08" }]
    });
    const ranked = [left.calendar, right.calendar].sort(compareCalendarPublicationWinnerForTest);
    const winner = ranked[0]!;
    const loser = ranked[1]!;
    scheduler.pauseBeforeScheduling(loser.id);

    const loserPublication = service.publishCalendar(loser.id, "admin-loser");
    await scheduler.waitUntilPaused();
    const winnerPublication = await service.publishCalendar(winner.id, "admin-winner");
    scheduler.releasePausedScheduling();

    await expect(loserPublication).rejects.toBeInstanceOf(ConflictException);
    expect(winnerPublication.calendar.id).toBe(winner.id);
    const published = (await calendarRepository.listPublishedCalendars({ limit: 20, offset: 0 }))
      .filter((calendar) => calendar.universityId === winner.universityId && calendar.academicYear === winner.academicYear);
    expect(published.map((calendar) => calendar.id)).toEqual([winner.id]);
    await expect(calendarRepository.findCalendarById(loser.id)).resolves.toEqual(expect.objectContaining({ status: "archived" }));
    const winnerJobs = await notificationRepository.listJobsByCalendar(winner.id);
    const loserJobs = await notificationRepository.listJobsByCalendar(loser.id);
    expect(winnerJobs.length).toBeGreaterThan(0);
    expect(winnerJobs.every((job) => job.status === "scheduled")).toBe(true);
    expect(loserJobs.length).toBeGreaterThan(0);
    expect(loserJobs.every((job) => job.status !== "scheduled")).toBe(true);
  });

  it("keeps the previous snapshot published when the new parent visibility update fails", async () => {
    const calendarRepository = new InMemoryCalendarRepository();
    const service = new AdminCalendarService(calendarRepository, new InMemoryPdfRepository());
    const previous = await calendarRepository.createCalendar({
      universityId: "sample-university-1",
      academicYear: "2026-2027",
      title: "Previous trusted calendar",
      status: "published",
      version: 1,
      publishedAt: new Date("2026-07-01T00:00:00.000Z")
    });
    const [previousEvent] = await calendarRepository.createEvents([{
      calendarId: previous.id,
      universityId: previous.universityId,
      academicYear: previous.academicYear,
      term: "fall",
      category: "fall_term_start",
      title: "Previous trusted event",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      timezone: "Europe/Istanbul",
      status: "published",
      notificationRules: []
    }]);
    const draft = await service.createManualDraft({
      universityId: previous.universityId,
      academicYear: previous.academicYear,
      title: "Replacement calendar",
      createdBy: "admin-1",
      events: [{
        title: "Replacement event",
        category: "fall_term_start",
        term: "fall",
        startDate: "2026-09-08"
      }]
    });
    const archivePublishedCalendars = vi.spyOn(calendarRepository, "archivePublishedCalendars");
    vi.spyOn(calendarRepository, "updateCalendar").mockRejectedValueOnce(new Error("SIMULATED_PARENT_PUBLISH_FAILURE"));

    await expect(service.publishCalendar(draft.calendar.id, "admin-1")).rejects.toThrow("SIMULATED_PARENT_PUBLISH_FAILURE");

    expect(archivePublishedCalendars).not.toHaveBeenCalled();
    await expect(calendarRepository.findCalendarById(previous.id)).resolves.toEqual(expect.objectContaining({ status: "published" }));
    await expect(calendarRepository.findCalendarById(draft.calendar.id)).resolves.toEqual(expect.objectContaining({ status: "draft" }));
    await expect(calendarRepository.listEventsByCalendar(draft.calendar.id)).resolves.toEqual([
      expect.objectContaining({ status: "published" })
    ]);
    await expect(calendarRepository.listPublishedEvents({
      universityId: previous.universityId,
      limit: 20,
      offset: 0
    })).resolves.toEqual([expect.objectContaining({ id: previousEvent!.id })]);

    const retried = await service.publishCalendar(draft.calendar.id, "admin-1");
    expect(retried.archivedCalendarCount).toBe(1);
    expect(retried.publishedEvents).toEqual([expect.objectContaining({ title: "Replacement event", status: "published" })]);
    await expect(calendarRepository.findCalendarById(previous.id)).resolves.toEqual(expect.objectContaining({ status: "archived" }));
  });

  it("repairs supersession after the complete new snapshot became visible before archival", async () => {
    const calendarRepository = new InMemoryCalendarRepository();
    const service = new AdminCalendarService(calendarRepository, new InMemoryPdfRepository());
    const previous = await calendarRepository.createCalendar({
      universityId: "sample-university-1",
      academicYear: "2026-2027",
      title: "Previous trusted calendar",
      status: "published",
      version: 1,
      publishedAt: new Date("2026-07-01T00:00:00.000Z")
    });
    await calendarRepository.createEvents([{
      calendarId: previous.id,
      universityId: previous.universityId,
      academicYear: previous.academicYear,
      term: "fall",
      category: "fall_term_start",
      title: "Previous trusted event",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      timezone: "Europe/Istanbul",
      status: "published",
      notificationRules: []
    }]);
    const draft = await service.createManualDraft({
      universityId: previous.universityId,
      academicYear: previous.academicYear,
      title: "Replacement calendar",
      createdBy: "admin-1",
      events: [{
        title: "Replacement event",
        category: "fall_term_start",
        term: "fall",
        startDate: "2026-09-08"
      }]
    });
    vi.spyOn(calendarRepository, "reconcilePublishedCalendars").mockRejectedValueOnce(new Error("SIMULATED_ARCHIVE_FAILURE"));

    await expect(service.publishCalendar(draft.calendar.id, "admin-1")).rejects.toThrow("SIMULATED_ARCHIVE_FAILURE");

    await expect(calendarRepository.findCalendarById(previous.id)).resolves.toEqual(expect.objectContaining({ status: "published" }));
    await expect(calendarRepository.findCalendarById(draft.calendar.id)).resolves.toEqual(expect.objectContaining({ status: "published" }));
    await expect(calendarRepository.listEventsByCalendar(draft.calendar.id)).resolves.toEqual([
      expect.objectContaining({ status: "published" })
    ]);

    const repaired = await service.publishCalendar(draft.calendar.id, "admin-1");
    expect(repaired.archivedCalendarCount).toBe(1);
    await expect(calendarRepository.findCalendarById(previous.id)).resolves.toEqual(expect.objectContaining({ status: "archived" }));
  });

  it("repairs archived child state and jobs when reconciliation persistence loses its response", async () => {
    const calendarRepository = new ReconciliationResponseLossCalendarRepository();
    const notificationRepository = new InMemoryNotificationRepository();
    const scheduler = new NotificationSchedulingService(notificationRepository);
    const service = new AdminCalendarService(calendarRepository, new InMemoryPdfRepository(), scheduler);
    const previous = await calendarRepository.createCalendar({
      universityId: "sample-university-1",
      academicYear: "2026-2027",
      title: "Previous calendar",
      status: "published",
      version: 1,
      publishedAt: new Date("2026-07-01T00:00:00.000Z")
    });
    const [previousEvent] = await calendarRepository.createEvents([{
      calendarId: previous.id,
      universityId: previous.universityId,
      academicYear: previous.academicYear,
      term: "fall",
      category: "fall_term_start",
      title: "Previous event",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      timezone: "Europe/Istanbul",
      status: "published",
      notificationRules: [{ offsetDays: 0, trigger: "at_time", enabled: true }]
    }]);
    await scheduler.scheduleCalendarPublished(previous, [previousEvent!]);
    const draft = await service.createManualDraft({
      universityId: previous.universityId,
      academicYear: previous.academicYear,
      title: "Replacement calendar",
      createdBy: "admin-1",
      events: [{ title: "Replacement event", category: "fall_term_start", term: "fall", startDate: "2026-09-08" }]
    });
    calendarRepository.loseNextReconciliationResponse();

    await expect(service.publishCalendar(draft.calendar.id, "admin-1"))
      .rejects.toThrow("SIMULATED_RECONCILIATION_RESPONSE_LOSS");

    await expect(calendarRepository.findCalendarById(previous.id)).resolves.toEqual(expect.objectContaining({ status: "archived" }));
    expect((await notificationRepository.listJobsByCalendar(previous.id)).every((job) => job.status !== "scheduled")).toBe(true);

    const repaired = await service.publishCalendar(draft.calendar.id, "admin-1");
    expect(repaired.calendar.id).toBe(draft.calendar.id);
    expect((await notificationRepository.listJobsByCalendar(draft.calendar.id)).some((job) => job.status === "scheduled")).toBe(true);
  });

  it("publishes a weekly department course series without replacing the university calendar", async () => {
    const calendarRepository = new InMemoryCalendarRepository();
    const service = new AdminCalendarService(calendarRepository, new InMemoryPdfRepository());
    const primaryDraft = await service.createManualDraft({
      universityId: "sample-university-1",
      academicYear: "2026-2027",
      title: "2026-2027 Akademik Takvim",
      createdBy: "admin-1",
      events: [{
        title: "Güz dönemi başlangıcı",
        category: "fall_term_start",
        term: "fall",
        startDate: "2026-09-07"
      }]
    });
    await service.publishCalendar(primaryDraft.calendar.id, "admin-1");

    const schedule = await service.createCourseScheduleSeries({
      universityId: "sample-university-1",
      facultyId: "faculty-1",
      departmentId: "department-1",
      academicYear: "2026-2027",
      term: "fall",
      title: "Veri Yapıları",
      courseName: "CENG 201",
      location: "A-201",
      startDate: "2026-09-07T09:00:00+03:00",
      endDate: "2026-09-07T10:00:00+03:00",
      repeatWeekly: true,
      repeatUntil: "2026-09-21"
    });

    expect(schedule.events).toHaveLength(3);
    expect(schedule.events.map((event) => event.startDate.toISOString())).toEqual([
      "2026-09-07T06:00:00.000Z",
      "2026-09-14T06:00:00.000Z",
      "2026-09-21T06:00:00.000Z"
    ]);
    expect(schedule.events.every((event) => event.scheduleSeriesId === schedule.seriesId && event.status === "published")).toBe(true);
    expect((await calendarRepository.findPublishedCalendar("sample-university-1", "2026-2027"))?.id).toBe(primaryDraft.calendar.id);
    expect(await service.listCourseSchedules({ universityId: "sample-university-1", departmentId: "department-1", academicYear: "2026-2027" })).toHaveLength(3);

    await expect(service.archiveCourseScheduleSeries(schedule.seriesId)).resolves.toEqual({ seriesId: schedule.seriesId, archivedCount: 3 });
    expect(await service.listCourseSchedules({ universityId: "sample-university-1", departmentId: "department-1" })).toHaveLength(0);
    await service.publishCalendar(primaryDraft.calendar.id, "admin-retry");
    expect(await service.listCourseSchedules({ universityId: "sample-university-1", departmentId: "department-1" })).toHaveLength(0);
  });

  it("rejects draft creation without approved extracted events", async () => {
    const pdfRepository = new InMemoryPdfRepository();
    const pdfService = new PdfProcessingService(pdfRepository, disabledOcrService);
    const source = await pdfService.createPdfSource(validPdfInput);
    await pdfService.processPdfSource(source.id);
    const service = new AdminCalendarService(new InMemoryCalendarRepository(), pdfRepository);

    await expect(
      service.createDraftFromApprovedExtractedEvents({
        universityId: source.universityId,
        academicYear: source.academicYear,
        title: "Eksik Onayli Takvim",
        sourcePdfId: source.id,
        createdBy: "admin-1"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rolls back a published calendar by archiving its events", async () => {
    const { pdfRepository, source } = await createApprovedExtractedEvents();
    const calendarRepository = new InMemoryCalendarRepository();
    const service = new AdminCalendarService(calendarRepository, pdfRepository);
    const draft = await service.createDraftFromApprovedExtractedEvents({
      universityId: source.universityId,
      academicYear: source.academicYear,
      title: "Rollback Test Takvimi",
      sourcePdfId: source.id,
      createdBy: "admin-1"
    });
    await service.publishCalendar(draft.calendar.id, "admin-1");

    const rolledBack = await service.rollbackCalendar(draft.calendar.id);
    const events = await calendarRepository.listEventsByCalendar(draft.calendar.id);

    expect(rolledBack.status).toBe("archived");
    expect(events.every((event) => event.status === "archived")).toBe(true);
  });
});

class PausingNotificationSchedulingService extends NotificationSchedulingService {
  private calendarIdToPause?: string;
  private pausedResolve?: () => void;
  private releaseResolve?: () => void;
  private paused = new Promise<void>((resolve) => { this.pausedResolve = resolve; });
  private release = new Promise<void>((resolve) => { this.releaseResolve = resolve; });

  pauseBeforeScheduling(calendarId: string): void {
    this.calendarIdToPause = calendarId;
  }

  waitUntilPaused(): Promise<void> {
    return this.paused;
  }

  releasePausedScheduling(): void {
    this.releaseResolve?.();
  }

  override async scheduleCalendarPublished(calendar: AcademicCalendarRecord, events: AcademicEventRecord[]) {
    if (calendar.id === this.calendarIdToPause) {
      delete this.calendarIdToPause;
      this.pausedResolve?.();
      await this.release;
    }
    return super.scheduleCalendarPublished(calendar, events);
  }
}

class ReconciliationResponseLossCalendarRepository extends InMemoryCalendarRepository {
  private loseResponse = false;

  loseNextReconciliationResponse(): void {
    this.loseResponse = true;
  }

  override async reconcilePublishedCalendars(
    ...input: Parameters<InMemoryCalendarRepository["reconcilePublishedCalendars"]>
  ): ReturnType<InMemoryCalendarRepository["reconcilePublishedCalendars"]> {
    const result = await super.reconcilePublishedCalendars(...input);
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error("SIMULATED_RECONCILIATION_RESPONSE_LOSS");
    }
    return result;
  }
}

function compareCalendarPublicationWinnerForTest(left: AcademicCalendarRecord, right: AcademicCalendarRecord): number {
  return right.version - left.version
    || right.createdAt.getTime() - left.createdAt.getTime()
    || right.id.localeCompare(left.id, "en-US");
}
