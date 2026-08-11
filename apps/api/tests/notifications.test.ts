import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { AuthUserRecord } from "../src/modules/auth/auth.types.js";
import { AdminCalendarService } from "../src/modules/calendars/admin-calendar.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";
import { GENERIC_PUSH_NOTIFICATION_BODY, GENERIC_PUSH_NOTIFICATION_TITLE, NotificationWorkerService } from "../src/modules/notifications/notification-worker.service.js";
import { hashNotificationDeviceId, NotificationSchedulingService, NotificationsService } from "../src/modules/notifications/notifications.service.js";
import { NOTIFICATION_DELIVERY_CONSENT_VERSION } from "../src/modules/notifications/notification.types.js";
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
    return { status: "sent" as const, providerMessageId: "provider-message-1" };
  }
}

class TokenOutcomePushSender implements PushSender {
  public readonly messages: PushMessageInput[] = [];

  constructor(public readonly failedTokens = new Set<string>()) {}

  async send(input: PushMessageInput) {
    this.messages.push(input);
    if (this.failedTokens.has(input.token)) {
      return { status: "failed" as const, reason: "provider_unavailable" as const };
    }
    return { status: "sent" as const, providerMessageId: `provider-message-${input.token}` };
  }
}

describe("NotificationsService", () => {
  it.each([
    "2026-10-01",
    "2026-10-01T06:30:00",
    "2026-02-30T06:30:00Z",
    "2026-10-01T06:30:00+03"
  ])("rejects an alarm scheduledFor value that is not an explicit valid instant: %s", async (scheduledFor) => {
    const service = new NotificationsService(new InMemoryNotificationRepository());

    await expect(service.createStudentAlarm(
      { ...studentUser, universityId: "university-1" },
      {
        eventType: "announcement",
        targetId: "announcement-1",
        title: "Announcement",
        scheduledFor,
        trigger: "at_time",
        amount: 0,
        unit: "days"
      }
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it("registers, rotates and detaches a device without exposing token or raw device id", async () => {
    const repository = new InMemoryNotificationRepository();
    const service = new NotificationsService(repository);
    const deviceId = "native-device-stable-1";
    const firstToken = "fcm-token-123456789";
    const rotatedToken = "fcm-token-987654321";

    const first = await service.registerDevice(studentUser, { platform: "android", token: firstToken, deviceId });
    const second = await service.registerDevice(studentUser, { platform: "android", token: rotatedToken, deviceId });
    const active = await repository.listActiveDeviceTokens(10, 0);

    expect(first).toEqual(expect.objectContaining({ status: "registered", platform: "android" }));
    expect(second).toEqual(expect.objectContaining({ status: "registered", platform: "android" }));
    expect(JSON.stringify([first, second])).not.toContain(firstToken);
    expect(JSON.stringify([first, second])).not.toContain(rotatedToken);
    expect(JSON.stringify([first, second])).not.toContain(deviceId);
    expect(active).toHaveLength(1);
    expect(active[0]).toEqual(expect.objectContaining({ token: rotatedToken, installationHash: hashNotificationDeviceId(deviceId) }));

    await expect(service.unregisterCurrentDevice(studentUser, { deviceId })).resolves.toEqual({ status: "unregistered" });
    await expect(service.unregisterCurrentDevice(studentUser, { deviceId })).resolves.toEqual({ status: "unregistered" });
    await expect(repository.listActiveDeviceTokens(10, 0)).resolves.toEqual([]);

    const newOwner = { ...studentUser, id: "student-2", email: "student-2@example.com" };
    await expect(service.registerDevice(newOwner, {
      platform: "android",
      token: "fcm-token-new-owner-123",
      deviceId
    })).resolves.toEqual(expect.objectContaining({ status: "registered", platform: "android" }));
    await expect(repository.listActiveDeviceTokens(10, 0)).resolves.toEqual([
      expect.objectContaining({ userId: newOwner.id, token: "fcm-token-new-owner-123" })
    ]);
  });

  it("rejects active token and installation ownership conflicts", async () => {
    const repository = new InMemoryNotificationRepository();
    const service = new NotificationsService(repository);
    await service.registerDevice(studentUser, {
      platform: "android",
      token: "fcm-token-owner-one",
      deviceId: "native-device-owner-one"
    });

    await expect(service.registerDevice(
      { ...studentUser, id: "student-2" },
      { platform: "android", token: "fcm-token-owner-two", deviceId: "native-device-owner-one" }
    )).rejects.toThrow("another active installation or account");
    await expect(service.registerDevice(
      { ...studentUser, id: "student-2" },
      { platform: "android", token: "fcm-token-owner-one", deviceId: "native-device-owner-two" }
    )).rejects.toThrow("another active installation or account");
    await expect(service.unregisterCurrentDevice(
      { ...studentUser, id: "student-2" },
      { deviceId: "native-device-owner-one" }
    )).rejects.toThrow("belongs to another active account");
  });

  it("rejects registration identifiers that are invalid after trimming", async () => {
    const service = new NotificationsService(new InMemoryNotificationRepository());

    await expect(service.registerDevice(studentUser, {
      platform: "android",
      token: "                 ",
      deviceId: "native-device-valid"
    })).rejects.toThrow("token must be between 16 and 4096 characters after trimming");
    await expect(service.unregisterCurrentDevice(studentUser, {
      deviceId: "        "
    })).rejects.toThrow("deviceId must be between 8 and 256 characters after trimming");
  });

  it("creates default preferences and updates quiet hours", async () => {
    const service = new NotificationsService(new InMemoryNotificationRepository());

    const defaults = await service.getPreferences(studentUser);
    const updated = await service.updatePreferences(studentUser, {
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      categories: { final_exam: true, makeup_exam: false },
      reminderOffsets: [1, 7, 1],
      quietHours: { enabled: true, start: "22:00", end: "08:00", timezone: "Europe/Istanbul" }
    });

    expect(defaults.reminderOffsets).toEqual([7, 1, 0]);
    expect(defaults.enabled).toBe(false);
    expect(defaults.deliveryConsentVersion).toBeUndefined();
    expect(defaults.reminderRules?.map((rule) => rule.trigger)).toEqual(["before", "before", "at_time"]);
    expect(updated.reminderOffsets).toEqual([7, 1]);
    expect(service.toPreferenceDto(updated)).toEqual(expect.objectContaining({
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      quietHours: expect.objectContaining({ start: "22:00" })
    }));
  });

  it("removes Mongo subdocument metadata from reminder preference responses", async () => {
    const repository = new InMemoryNotificationRepository();
    const service = new NotificationsService(repository);
    const preferences = await repository.upsertPreferences({
      userId: studentUser.id,
      enabled: false,
      categories: { final_exam: true },
      reminderOffsets: [1],
      reminderRules: [{ trigger: "before", amount: 1, unit: "days", enabled: true }]
    });
    const reminderRule = preferences.reminderRules?.[0];

    expect(reminderRule).toBeDefined();
    const dto = service.toPreferenceDto({
      ...preferences,
      reminderRules: [{ ...reminderRule!, _id: "mongo-subdocument-id" }] as unknown as NonNullable<typeof preferences.reminderRules>
    });

    expect(dto.reminderRules).toEqual([
      { trigger: "before", amount: 1, unit: "days", enabled: true }
    ]);
    expect(dto.reminderRules?.[0]).not.toHaveProperty("_id");
  });

  it("treats legacy enabled rows as disabled and requires the current consent marker when enabling", async () => {
    const repository = new InMemoryNotificationRepository();
    const service = new NotificationsService(repository);
    const legacy = await repository.upsertPreferences({
      userId: studentUser.id,
      enabled: true,
      categories: { final_exam: true },
      reminderOffsets: [1]
    });

    expect(service.toPreferenceDto(legacy)).toEqual(expect.objectContaining({ enabled: false }));
    expect(service.toPreferenceDto(legacy)).not.toHaveProperty("deliveryConsentVersion");
    await expect(service.updatePreferences(studentUser, {
      enabled: true,
      categories: { final_exam: true },
      reminderOffsets: [1]
    })).rejects.toThrow(`deliveryConsentVersion=${NOTIFICATION_DELIVERY_CONSENT_VERSION}`);
    await expect(service.updatePreferences(studentUser, {
      enabled: true,
      deliveryConsentVersion: "legacy-v0",
      categories: { final_exam: true },
      reminderOffsets: [1]
    } as never)).rejects.toThrow(`deliveryConsentVersion=${NOTIFICATION_DELIVERY_CONSENT_VERSION}`);
  });

  it("stores exact-time and hour-before reminder preferences", async () => {
    const service = new NotificationsService(new InMemoryNotificationRepository());

    const updated = await service.updatePreferences(studentUser, {
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
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
    const calendarRepository = new InMemoryCalendarRepository();
    const user = { ...studentUser, universityId: "university-1", facultyId: "faculty-1", departmentId: "department-1" };
    const calendar = await calendarRepository.createCalendar({
      universityId: user.universityId,
      academicYear: "2026-2027",
      title: "Published calendar",
      status: "published",
      version: 1
    });
    const [event] = await calendarRepository.createEvents([{
      calendarId: calendar.id,
      universityId: user.universityId,
      facultyId: user.facultyId,
      departmentId: user.departmentId,
      academicYear: "2026-2027",
      term: "fall",
      category: "final_exam",
      title: "Algorithms Final",
      startDate: new Date("2026-10-01T06:30:00.000Z"),
      timezone: "Europe/Istanbul",
      status: "published",
      notificationRules: []
    }]);
    if (!event) throw new Error("Expected calendar event fixture.");
    const service = new NotificationsService(repository, calendarRepository);

    const alarm = await service.createStudentAlarm(user, {
      eventType: "exam",
      targetId: event.id,
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
      targetId: event.id,
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
    await repository.upsertDeviceToken({ userId: "student-in-scope", platform: "android", token: "token-in-scope", installationHash: "installation-in-scope" });
    await repository.upsertDeviceToken({ userId: "student-out-of-scope", platform: "android", token: "token-out-of-scope", installationHash: "installation-out-of-scope" });
    await repository.upsertPreferences({ userId: "student-in-scope", enabled: true, deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION, categories: { final_exam: true }, reminderOffsets: [1] });
    await repository.upsertPreferences({ userId: "student-out-of-scope", enabled: true, deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION, categories: { final_exam: true }, reminderOffsets: [1] });
    const [job] = await repository.createNotificationJobs([{
      calendarId: "calendar-scoped",
      eventId: "event-scoped",
      destinationType: "calendar_event",
      destinationId: "event-scoped",
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
    expect(sender.messages[0]).toEqual(expect.objectContaining({
      title: GENERIC_PUSH_NOTIFICATION_TITLE,
      body: GENERIC_PUSH_NOTIFICATION_BODY,
      androidChannelId: "academic-reminders",
      data: {
        schemaVersion: "1",
        destinationType: "calendar_event",
        destinationId: "event-scoped",
        recipientOwnerId: "student-in-scope"
      }
    }));
    expect(JSON.stringify(sender.messages[0])).not.toContain("Scoped Final Exam");
    expect(deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "student-in-scope", status: "sent" }),
      expect.objectContaining({ userId: "student-out-of-scope", status: "skipped", failureReason: "scope_mismatch" })
    ]));
  });

  it("defers quiet-hour jobs until the Europe/Istanbul quiet period ends", async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.upsertDeviceToken({ userId: "student-in-scope", platform: "android", token: "token-in-scope", installationHash: "installation-in-scope" });
    await repository.upsertPreferences({
      userId: "student-in-scope",
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      categories: { final_exam: true },
      reminderOffsets: [1],
      quietHours: { enabled: true, start: "22:00", end: "08:00", timezone: "Europe/Istanbul" }
    });
    const [job] = await repository.createNotificationJobs([{
      calendarId: "calendar-quiet",
      eventId: "event-quiet",
      destinationType: "calendar_event",
      destinationId: "event-quiet",
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

  it.each([
    ["an injected repository cannot find the token owner", { async findUserById() { return null; } }],
    ["the auth repository dependency is unavailable", undefined]
  ])("fails closed when %s", async (_label, authRepository) => {
    const repository = new InMemoryNotificationRepository();
    await repository.upsertDeviceToken({
      userId: "orphan-owner",
      platform: "android",
      token: "orphan-device-token",
      installationHash: "orphan-installation"
    });
    await repository.upsertPreferences({
      userId: "orphan-owner",
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      categories: { final_exam: true },
      reminderOffsets: [1]
    });
    const job = await createWorkerJob(repository, "orphan-scope");
    const sender = new RecordingPushSender();
    const worker = new NotificationWorkerService(repository, new InMemoryQueueService(), sender, authRepository);

    const result = await worker.processDueJobs(new Date("2027-01-01T00:00:00.000Z"));
    const deliveries = await repository.listDeliveriesByJob(job.id, 10, 0);

    expect(result).toEqual(expect.objectContaining({ sent: 0, skipped: 1 }));
    expect(sender.messages).toEqual([]);
    expect(deliveries).toEqual([expect.objectContaining({ status: "skipped", failureReason: "scope_mismatch" })]);
    expect((await repository.listJobsByCalendar(job.calendarId))[0]?.status).toBe("cancelled");
  });

  it("does not deliver for a legacy enabled preference without current consent", async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.upsertDeviceToken({
      userId: "student-in-scope",
      platform: "android",
      token: "legacy-consent-device-token",
      installationHash: "legacy-consent-installation"
    });
    await repository.upsertPreferences({
      userId: "student-in-scope",
      enabled: true,
      categories: { final_exam: true },
      reminderOffsets: [1]
    });
    const job = await createWorkerJob(repository, "legacy-consent");
    const sender = new RecordingPushSender();
    const worker = new NotificationWorkerService(repository, new InMemoryQueueService(), sender, {
      async findUserById(id: string) {
        return scopedUsers.get(id) ?? null;
      }
    });

    const result = await worker.processDueJobs(new Date("2027-01-01T00:00:00.000Z"));
    const deliveries = await repository.listDeliveriesByJob(job.id, 10, 0);

    expect(result).toEqual(expect.objectContaining({ sent: 0, skipped: 1 }));
    expect(sender.messages).toEqual([]);
    expect(deliveries).toEqual([expect.objectContaining({ failureReason: "preference_disabled" })]);
  });

  it("retries only failed recipients after a mixed provider outcome", async () => {
    const repository = new InMemoryNotificationRepository();
    for (const token of ["mixed-device-success", "mixed-device-failure"]) {
      await repository.upsertDeviceToken({
        userId: "student-in-scope",
        platform: "android",
        token,
        installationHash: `installation-${token}`
      });
    }
    await repository.upsertPreferences({
      userId: "student-in-scope",
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      categories: { final_exam: true },
      reminderOffsets: [1]
    });
    const job = await createWorkerJob(repository, "mixed-provider");
    const sender = new TokenOutcomePushSender(new Set(["mixed-device-failure"]));
    const worker = new NotificationWorkerService(repository, new InMemoryQueueService(), sender, {
      async findUserById(id: string) {
        return scopedUsers.get(id) ?? null;
      }
    });

    const first = await worker.processDueJobs(new Date("2027-01-01T00:00:00.000Z"));
    expect(first).toEqual(expect.objectContaining({ sent: 1, failed: 1 }));
    expect((await repository.listJobsByCalendar(job.calendarId))[0]).toEqual(expect.objectContaining({
      status: "scheduled",
      attemptCount: 1,
      lastFailureReason: "provider_unavailable"
    }));

    sender.failedTokens.clear();
    const retry = await worker.processDueJobs(new Date("2027-01-01T00:01:00.000Z"));
    const deliveries = await repository.listDeliveriesByJob(job.id, 10, 0);

    expect(retry).toEqual(expect.objectContaining({ sent: 1, failed: 0 }));
    expect(sender.messages.filter((message) => message.token === "mixed-device-success")).toHaveLength(1);
    expect(sender.messages.filter((message) => message.token === "mixed-device-failure")).toHaveLength(2);
    expect(deliveries.filter((delivery) => delivery.status === "sent")).toHaveLength(2);
    expect(deliveries.filter((delivery) => delivery.status === "failed")).toHaveLength(1);
    expect((await repository.listJobsByCalendar(job.calendarId))[0]?.status).toBe("sent");
  });

  it("resumes only deferred recipients after a mixed quiet-hour outcome", async () => {
    const repository = new InMemoryNotificationRepository();
    const users = new Map<string, AuthUserRecord>([
      ["student-awake", createUser("student-awake", "university-1", "faculty-1", "department-1")],
      ["student-quiet", createUser("student-quiet", "university-1", "faculty-1", "department-1")]
    ]);
    await repository.upsertDeviceToken({ userId: "student-awake", platform: "android", token: "device-awake", installationHash: "installation-awake" });
    await repository.upsertDeviceToken({ userId: "student-quiet", platform: "android", token: "device-quiet", installationHash: "installation-quiet" });
    await repository.upsertPreferences({ userId: "student-awake", enabled: true, deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION, categories: { final_exam: true }, reminderOffsets: [1] });
    await repository.upsertPreferences({
      userId: "student-quiet",
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      categories: { final_exam: true },
      reminderOffsets: [1],
      quietHours: { enabled: true, start: "22:00", end: "07:00", timezone: "Europe/Istanbul" }
    });
    const job = await createWorkerJob(repository, "mixed-quiet", new Date("2027-01-01T23:00:00.000Z"));
    const sender = new RecordingPushSender();
    const worker = new NotificationWorkerService(repository, new InMemoryQueueService(), sender, {
      async findUserById(id: string) {
        return users.get(id) ?? null;
      }
    });

    const first = await worker.processDueJobs(new Date("2027-01-01T23:00:00.000Z"));
    expect(first).toEqual(expect.objectContaining({ sent: 1, deferred: 1 }));
    expect((await repository.listJobsByCalendar(job.calendarId))[0]).toEqual(expect.objectContaining({
      status: "scheduled",
      scheduledAt: new Date("2027-01-02T04:00:00.000Z")
    }));

    const resumed = await worker.processDueJobs(new Date("2027-01-02T04:00:00.000Z"));
    const deliveries = await repository.listDeliveriesByJob(job.id, 10, 0);

    expect(resumed).toEqual(expect.objectContaining({ sent: 1, deferred: 0 }));
    expect(sender.messages.map((message) => message.token).sort()).toEqual(["device-awake", "device-quiet"]);
    expect(deliveries.filter((delivery) => delivery.status === "sent")).toHaveLength(2);
    expect(deliveries.filter((delivery) => delivery.status === "deferred")).toHaveLength(1);
    expect((await repository.listJobsByCalendar(job.calendarId))[0]?.status).toBe("sent");
  });

  it("fans out beyond one page without dropping active devices", async () => {
    const repository = new InMemoryNotificationRepository();
    const user = createUser("student-many-devices", "university-1", "faculty-1", "department-1");
    await repository.upsertPreferences({
      userId: user.id,
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      categories: { final_exam: true },
      reminderOffsets: [1]
    });
    for (let index = 0; index < 1001; index += 1) {
      await repository.upsertDeviceToken({
        userId: user.id,
        platform: "android",
        token: `paginated-device-token-${index}`,
        installationHash: `paginated-installation-${index}`
      });
    }
    const job = await createWorkerJob(repository, "paginated-fanout");
    const sender = new RecordingPushSender();
    const worker = new NotificationWorkerService(repository, new InMemoryQueueService(), sender, {
      async findUserById(id: string) {
        return id === user.id ? user : null;
      }
    });

    const result = await worker.processDueJobs(new Date("2027-01-01T00:00:00.000Z"));

    expect(result.sent).toBe(1001);
    expect(sender.messages).toHaveLength(1001);
    expect(new Set(sender.messages.map((message) => message.token))).toHaveProperty("size", 1001);
    expect((await repository.listJobsByCalendar(job.calendarId))[0]?.status).toBe("sent");
  });

  it("allows only one simultaneous worker to claim and send the same due job", async () => {
    const repository = new SimultaneousDueListRepository();
    await repository.upsertDeviceToken({
      userId: "student-in-scope",
      platform: "android",
      token: "concurrent-worker-device",
      installationHash: "concurrent-worker-installation"
    });
    await repository.upsertPreferences({
      userId: "student-in-scope",
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      categories: { final_exam: true },
      reminderOffsets: [1]
    });
    const job = await createWorkerJob(repository, "simultaneous-claim");
    const sender = new RecordingPushSender();
    const authRepository = {
      async findUserById(id: string) {
        return scopedUsers.get(id) ?? null;
      }
    };
    const firstWorker = new NotificationWorkerService(repository, new InMemoryQueueService(), sender, authRepository);
    const secondWorker = new NotificationWorkerService(repository, new InMemoryQueueService(), sender, authRepository);
    const now = new Date("2027-01-01T00:00:00.000Z");

    const results = await Promise.all([
      firstWorker.processDueJobs(now),
      secondWorker.processDueJobs(now)
    ]);
    const deliveries = await repository.listDeliveriesByJob(job.id, 10, 0);
    const [completed] = await repository.listJobsByCalendar(job.calendarId);

    expect(results.reduce((sum, result) => sum + result.processedJobs, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
    expect(sender.messages).toHaveLength(1);
    expect(deliveries).toEqual([expect.objectContaining({ status: "sent" })]);
    expect(completed).toEqual(expect.objectContaining({ status: "sent" }));
    expect(completed).not.toHaveProperty("processingClaimId");
    expect(completed).not.toHaveProperty("processingLeaseUntil");
  });

  it.each(["detached", "rebound"] as const)("skips a device that is %s after fan-out selection", async (mutation) => {
    const repository = new RegistrationMutationRepository(mutation);
    const token = "race-device-token";
    await repository.upsertDeviceToken({
      userId: "student-in-scope",
      platform: "android",
      token,
      installationHash: repository.installationHash
    });
    await repository.upsertPreferences({
      userId: "student-in-scope",
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      categories: { final_exam: true },
      reminderOffsets: [1]
    });
    const job = await createWorkerJob(repository, `registration-${mutation}`);
    const sender = new RecordingPushSender();
    const worker = new NotificationWorkerService(repository, new InMemoryQueueService(), sender, {
      async findUserById(id: string) {
        return scopedUsers.get(id) ?? null;
      }
    });

    const result = await worker.processDueJobs(new Date("2027-01-01T00:00:00.000Z"));
    const deliveries = await repository.listDeliveriesByJob(job.id, 10, 0);

    expect(result).toEqual(expect.objectContaining({ sent: 0, failed: 0, skipped: 1 }));
    expect(sender.messages).toEqual([]);
    expect(deliveries).toEqual([
      expect.objectContaining({ status: "skipped", failureReason: "device_registration_stale" })
    ]);
    expect(JSON.stringify(deliveries)).not.toContain(token);
    expect((await repository.listJobsByCalendar(job.calendarId))[0]?.status).toBe("cancelled");
    if (mutation === "rebound") {
      await expect(repository.listActiveDeviceTokens(10, 0)).resolves.toEqual([
        expect.objectContaining({ userId: "student-rebound", token, installationHash: repository.installationHash })
      ]);
    }
  });
});

class RegistrationMutationRepository extends InMemoryNotificationRepository {
  readonly installationHash = "race-installation";
  private mutated = false;

  constructor(private readonly mutation: "detached" | "rebound") {
    super();
  }

  override async findPreferencesByUserId(userId: string) {
    const preference = await super.findPreferencesByUserId(userId);
    if (!this.mutated && userId === "student-in-scope") {
      this.mutated = true;
      await this.disableDeviceInstallation(userId, this.installationHash);
      if (this.mutation === "rebound") {
        await this.upsertDeviceToken({
          userId: "student-rebound",
          platform: "android",
          token: "race-device-token",
          installationHash: this.installationHash
        });
      }
    }
    return preference;
  }
}

class SimultaneousDueListRepository extends InMemoryNotificationRepository {
  private listCalls = 0;
  private releaseListings: (() => void) | undefined;
  private readonly listingsReady = new Promise<void>((resolve) => {
    this.releaseListings = resolve;
  });

  override async listDueJobs(now: Date, limit: number) {
    const snapshot = await super.listDueJobs(now, limit);
    this.listCalls += 1;
    if (this.listCalls === 2) this.releaseListings?.();
    if (this.listCalls <= 2) await this.listingsReady;
    return snapshot;
  }
}

async function createWorkerJob(
  repository: InMemoryNotificationRepository,
  suffix: string,
  scheduledAt = new Date("2027-01-01T00:00:00.000Z")
) {
  const [job] = await repository.createNotificationJobs([{
    calendarId: `calendar-${suffix}`,
    eventId: `event-${suffix}`,
    destinationType: "calendar_event",
    destinationId: `event-${suffix}`,
    universityId: "university-1",
    facultyId: "faculty-1",
    departmentId: "department-1",
    title: `Final ${suffix}`,
    category: "final_exam",
    offsetDays: 1,
    trigger: "before",
    scheduledAt,
    status: "scheduled"
  }]);
  if (!job) throw new Error("Expected notification job to be created.");
  return job;
}

const scopedUsers = new Map<string, AuthUserRecord>([
  ["student-in-scope", createUser("student-in-scope", "university-1", "faculty-1", "department-1")],
  ["student-out-of-scope", createUser("student-out-of-scope", "university-1", "faculty-2", "department-2")]
]);

function createUser(id: string, universityId: string, facultyId: string, departmentId: string): AuthUserRecord {
  return {
    id,
    credentialGeneration: 0,
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
