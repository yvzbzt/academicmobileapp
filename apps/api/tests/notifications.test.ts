import { describe, expect, it } from "vitest";
import type { AuthUserRecord } from "../src/modules/auth/auth.types.js";
import { AdminCalendarService } from "../src/modules/calendars/admin-calendar.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";
import { NotificationWorkerService } from "../src/modules/notifications/notification-worker.service.js";
import { NotificationSchedulingService, NotificationsService } from "../src/modules/notifications/notifications.service.js";
import type { PushMessageInput, PushSender } from "../src/modules/notifications/push-sender.service.js";
import { InMemoryPdfRepository } from "../src/modules/pdf/in-memory-pdf.repository.js";
import { PdfProcessingService } from "../src/modules/pdf/pdf-processing.service.js";
import { InMemoryQueueService } from "../src/queue/in-memory-queue.service.js";

const studentUser = { id: "student-1", email: "student@example.com", role: "student" as const };
const disabledOcrService = {
  async extractText() {
    return null;
  }
};

class RecordingPushSender implements PushSender {
  public readonly messages: PushMessageInput[] = [];

  async send(input: PushMessageInput) {
    this.messages.push(input);
    return { providerMessageId: "provider-message-1", invalidToken: false };
  }
}

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
    expect(defaults.reminderRules?.map((rule) => rule.trigger)).toEqual(["before", "before", "at_time"]);
    expect(updated.reminderOffsets).toEqual([7, 1]);
    expect(service.toPreferenceDto(updated).quietHours?.start).toBe("22:00");
  });

  it("stores exact-time and hour-before reminder preferences", async () => {
    const service = new NotificationsService(new InMemoryNotificationRepository());

    const updated = await service.updatePreferences(studentUser, {
      enabled: true,
      categories: { final_exam: true, yok_event: true },
      reminderOffsets: [],
      reminderRules: [
        { trigger: "before", amount: 3, unit: "hours", enabled: true },
        { trigger: "at_time", amount: 0, unit: "days", enabled: true }
      ]
    });

    expect(updated.reminderOffsets).toEqual([]);
    expect(updated.reminderRules).toEqual([
      { trigger: "before", amount: 3, unit: "hours", enabled: true },
      { trigger: "at_time", amount: 0, unit: "days", enabled: true }
    ]);
  });

  it("creates and cancels per-student custom alarms", async () => {
    const repository = new InMemoryNotificationRepository();
    const service = new NotificationsService(repository);
    const user = { ...studentUser, universityId: "university-1", facultyId: "faculty-1", departmentId: "department-1" };

    const alarm = await service.createStudentAlarm(user, {
      eventType: "exam",
      targetId: "exam-1",
      title: "Algorithms Final",
      scheduledFor: "2026-10-01T06:30:00.000Z",
      trigger: "before",
      amount: 3,
      unit: "hours"
    });
    const jobs = await repository.listDueJobs(new Date("2026-10-01T03:30:00.000Z"), 10);
    const listed = await service.listStudentAlarms(user);
    const cancelled = await service.cancelStudentAlarm(user, alarm.id);

    expect(alarm).toEqual(expect.objectContaining({
      eventType: "exam",
      targetId: "exam-1",
      scheduledAt: "2026-10-01T03:30:00.000Z",
      timezone: "Europe/Istanbul",
      status: "scheduled"
    }));
    expect(listed).toHaveLength(1);
    expect(jobs[0]).toEqual(expect.objectContaining({
      userId: user.id,
      alarmId: alarm.id,
      eventType: "exam",
      category: "department_exam_schedule"
    }));
    expect(cancelled.status).toBe("cancelled");
    expect(await repository.listDueJobs(new Date("2026-10-01T03:31:00.000Z"), 10)).toHaveLength(0);
  });
});

describe("NotificationSchedulingService", () => {
  it("schedules notification jobs when an admin publishes a calendar", async () => {
    const pdfRepository = new InMemoryPdfRepository();
    const pdfService = new PdfProcessingService(pdfRepository, disabledOcrService);
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

  it("schedules exact-time and hour-before notification jobs", async () => {
    const scheduler = new NotificationSchedulingService(new InMemoryNotificationRepository());
    const startDate = new Date("2026-10-01T06:30:00.000Z");
    const calendar = {
      id: "calendar-1",
      universityId: "sample-university-1",
      academicYear: "2026-2027",
      title: "Manual Calendar",
      status: "published" as const,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const event = {
      id: "event-1",
      calendarId: calendar.id,
      universityId: calendar.universityId,
      academicYear: calendar.academicYear,
      term: "fall" as const,
      category: "final_exam" as const,
      title: "Final Exam",
      startDate,
      timezone: "Europe/Istanbul" as const,
      status: "published" as const,
      notificationRules: [
        { offsetDays: 0, offsetHours: 3, trigger: "before" as const, enabled: true },
        { offsetDays: 0, trigger: "at_time" as const, enabled: true }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const jobs = await scheduler.scheduleCalendarPublished(calendar, [event]);

    expect(jobs).toHaveLength(2);
    expect(jobs.find((job) => job.offsetHours === 3)?.scheduledAt).toEqual(new Date("2026-10-01T03:30:00.000Z"));
    expect(jobs.find((job) => job.trigger === "at_time")?.scheduledAt).toEqual(startDate);
  });
});

describe("NotificationWorkerService", () => {
  it("fans out reminders only to users in the job academic scope", async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.upsertDeviceToken({ userId: "student-in-scope", platform: "android", token: "token-in-scope" });
    await repository.upsertDeviceToken({ userId: "student-out-of-scope", platform: "android", token: "token-out-of-scope" });
    await repository.upsertPreferences({ userId: "student-in-scope", enabled: true, categories: { final_exam: true }, reminderOffsets: [1] });
    await repository.upsertPreferences({ userId: "student-out-of-scope", enabled: true, categories: { final_exam: true }, reminderOffsets: [1] });
    const [job] = await repository.createNotificationJobs([{
      calendarId: "calendar-scoped",
      eventId: "event-scoped",
      universityId: "university-1",
      facultyId: "faculty-1",
      departmentId: "department-1",
      title: "Scoped Final Exam",
      category: "final_exam",
      offsetDays: 1,
      trigger: "before",
      scheduledAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "scheduled"
    }]);
    const sender = new RecordingPushSender();
    const worker = new NotificationWorkerService(repository, new InMemoryQueueService(), sender, {
      async findUserById(id: string) {
        return scopedUsers.get(id) ?? null;
      }
    });

    const result = await worker.processDueJobs(new Date("2026-01-01T00:00:00.000Z"));
    const deliveries = await repository.listDeliveriesByJob(job!.id, 10, 0);

    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(1);
    expect(sender.messages.map((message) => message.token)).toEqual(["token-in-scope"]);
    expect(deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "student-in-scope", status: "sent" }),
      expect.objectContaining({ userId: "student-out-of-scope", status: "skipped", failureReason: "scope_mismatch" })
    ]));
  });

  it("defers quiet-hour jobs until the Europe/Istanbul quiet period ends", async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.upsertDeviceToken({ userId: "student-in-scope", platform: "android", token: "token-in-scope" });
    await repository.upsertPreferences({
      userId: "student-in-scope",
      enabled: true,
      categories: { final_exam: true },
      reminderOffsets: [1],
      quietHours: { enabled: true, start: "22:00", end: "08:00", timezone: "Europe/Istanbul" }
    });
    const [job] = await repository.createNotificationJobs([{
      calendarId: "calendar-quiet",
      eventId: "event-quiet",
      universityId: "university-1",
      facultyId: "faculty-1",
      departmentId: "department-1",
      title: "Quiet Hour Final Exam",
      category: "final_exam",
      offsetDays: 1,
      trigger: "before",
      scheduledAt: new Date("2026-01-01T19:30:00.000Z"),
      status: "scheduled"
    }]);
    const worker = new NotificationWorkerService(repository, new InMemoryQueueService(), new RecordingPushSender(), {
      async findUserById(id: string) {
        return scopedUsers.get(id) ?? null;
      }
    });

    const result = await worker.processDueJobs(new Date("2026-01-01T19:30:00.000Z"));
    const [rescheduled] = await repository.listJobsByCalendar(job!.calendarId);

    expect(result.deferred).toBe(1);
    expect(rescheduled?.status).toBe("scheduled");
    expect(rescheduled?.scheduledAt).toEqual(new Date("2026-01-02T05:00:00.000Z"));
  });
});

const scopedUsers = new Map<string, AuthUserRecord>([
  ["student-in-scope", createUser("student-in-scope", "university-1", "faculty-1", "department-1")],
  ["student-out-of-scope", createUser("student-out-of-scope", "university-1", "faculty-2", "department-2")]
]);

function createUser(id: string, universityId: string, facultyId: string, departmentId: string): AuthUserRecord {
  return {
    id,
    fullName: id,
    email: `${id}@example.edu.tr`,
    passwordHash: "hash",
    role: "student",
    universityId,
    facultyId,
    departmentId,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date()
  };
}
