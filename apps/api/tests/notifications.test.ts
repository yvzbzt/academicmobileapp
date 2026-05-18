import { describe, expect, it } from "vitest";
import { AdminCalendarService } from "../src/modules/calendars/admin-calendar.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";
import { NotificationSchedulingService, NotificationsService } from "../src/modules/notifications/notifications.service.js";
import { InMemoryPdfRepository } from "../src/modules/pdf/in-memory-pdf.repository.js";
import { PdfProcessingService } from "../src/modules/pdf/pdf-processing.service.js";

const studentUser = { id: "student-1", email: "student@example.com", role: "student" as const };

describe("NotificationsService", () => {
  it("registers a device token idempotently", async () => {
    const service = new NotificationsService(new InMemoryNotificationRepository());

    const first = await service.registerDevice(studentUser, { platform: "android", token: "fcm-token-123456789" });
    const second = await service.registerDevice(studentUser, { platform: "android", token: "fcm-token-123456789" });

    expect(second.id).toBe(first.id);
    expect(second.status).toBe("active");
  });

  it("creates default preferences and updates quiet hours", async () => {
    const service = new NotificationsService(new InMemoryNotificationRepository());

    const defaults = await service.getPreferences(studentUser);
    const updated = await service.updatePreferences(studentUser, {
      enabled: true,
      categories: { final_exam: true, makeup_exam: false },
      reminderOffsets: [1, 7, 1],
      quietHours: { enabled: true, start: "22:00", end: "08:00", timezone: "Europe/Istanbul" }
    });

    expect(defaults.reminderOffsets).toEqual([7, 1, 0]);
    expect(updated.reminderOffsets).toEqual([7, 1]);
    expect(service.toPreferenceDto(updated).quietHours?.start).toBe("22:00");
  });
});

describe("NotificationSchedulingService", () => {
  it("schedules notification jobs when an admin publishes a calendar", async () => {
    const pdfRepository = new InMemoryPdfRepository();
    const pdfService = new PdfProcessingService(pdfRepository);
    const source = await pdfService.createPdfSource({
      universityId: "sample-university-1",
      fileName: "notification-publish.pdf",
      mimeType: "application/pdf",
      magicBytesHex: "255044462d312e37",
      fileSize: 4096,
      pageCount: 2,
      academicYear: "2026-2027",
      uploadedBy: "admin-1",
      rawText: "15-19 Eylul 2026 Guz Donemi Ders Kayitlari\n05-16 Ocak 2027 Guz Donemi Final Sinavlari"
    });
    const processed = await pdfService.processPdfSource(source.id);
    for (const event of processed.extractedEvents) {
      await pdfService.approveExtractedEvent(event.id, "admin-1");
    }
    const notificationRepository = new InMemoryNotificationRepository();
    const scheduler = new NotificationSchedulingService(notificationRepository);
    const calendarService = new AdminCalendarService(new InMemoryCalendarRepository(), pdfRepository, scheduler);

    const draft = await calendarService.createDraftFromApprovedExtractedEvents({
      universityId: source.universityId,
      academicYear: source.academicYear,
      title: "Notification Scheduled Calendar",
      sourcePdfId: source.id,
      createdBy: "admin-1"
    });
    const published = await calendarService.publishCalendar(draft.calendar.id, "admin-1");
    const jobs = await scheduler.listCalendarJobs(draft.calendar.id);

    expect(published.publishedEvents).toHaveLength(2);
    expect(jobs).toHaveLength(6);
    expect(jobs.every((job) => job.status === "scheduled")).toBe(true);
    expect(jobs.map((job) => job.offsetDays)).toEqual(expect.arrayContaining([7, 1, 0]));
  });
});
