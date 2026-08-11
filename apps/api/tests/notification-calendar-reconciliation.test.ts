import { describe, expect, it } from "vitest";
import { AdminCalendarService } from "../src/modules/calendars/admin-calendar.service.js";
import { CalendarIngestionService } from "../src/modules/calendars/calendar-ingestion.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import type { AcademicCalendarRecord, AcademicEventRecord } from "../src/modules/calendars/calendar.types.js";
import { calendarDestinationFingerprint } from "../src/modules/notifications/notification-destination.js";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";
import { NotificationWorkerService } from "../src/modules/notifications/notification-worker.service.js";
import { NotificationSchedulingService } from "../src/modules/notifications/notifications.service.js";
import { NOTIFICATION_DELIVERY_CONSENT_VERSION } from "../src/modules/notifications/notification.types.js";
import type { PushMessageInput, PushSender } from "../src/modules/notifications/push-sender.service.js";
import { InMemoryQueueService } from "../src/queue/in-memory-queue.service.js";

describe("calendar notification reconciliation", () => {
  it("repairs a lost scheduling response idempotently after restart and makes superseded events untrusted", async () => {
    const calendars = new InMemoryCalendarRepository();
    const oldCalendar = await calendars.createCalendar(calendarInput("published", 1));
    const [oldEvent] = await calendars.createEvents([eventInput(oldCalendar, "published", "Old final")]);
    if (!oldEvent) throw new Error("Expected old event fixture.");
    const draftCalendar = await calendars.createCalendar(calendarInput("draft", 2));
    const [draftEvent] = await calendars.createEvents([eventInput(draftCalendar, "approved", "New final")]);
    if (!draftEvent) throw new Error("Expected draft event fixture.");

    const notifications = new ResponseLossNotificationRepository();
    const firstScheduler = new NotificationSchedulingService(notifications);
    const firstService = new AdminCalendarService(calendars, {} as never, firstScheduler);
    await expect(firstService.publishCalendar(draftCalendar.id, "admin-1")).rejects.toThrow("SIMULATED_CALENDAR_SYNC_RESPONSE_LOSS");
    await expect(calendars.findCalendarById(draftCalendar.id)).resolves.toEqual(expect.objectContaining({ status: "published" }));
    await expect(notifications.listJobsByCalendar(draftCalendar.id)).resolves.toHaveLength(1);

    const restartedScheduler = new NotificationSchedulingService(notifications);
    const restartedService = new AdminCalendarService(
      calendars,
      {} as never,
      restartedScheduler
    );
    const reconciliationScan = new CalendarIngestionService(
      { findUniversityById: async () => activeUniversity(draftCalendar.universityId) } as never,
      calendars,
      {} as never,
      restartedService,
      restartedScheduler
    );
    await expect(reconciliationScan.onApplicationBootstrap()).resolves.toBeUndefined();
    await expect(reconciliationScan.onApplicationBootstrap()).resolves.toBeUndefined();
    const reconciledJobs = await notifications.listJobsByCalendar(draftCalendar.id);
    expect(reconciledJobs).toHaveLength(1);
    expect(reconciledJobs[0]).toEqual(expect.objectContaining({ destinationId: draftEvent.id, status: "scheduled" }));

    expect((await calendars.listEventsByCalendar(oldCalendar.id))[0]?.status).toBe("archived");
    // Model the crash window where the parent supersession committed but a stale
    // child event still says published. Every trusted read must use the parent gate.
    await calendars.updateEventsByCalendar(oldCalendar.id, { status: "published" });
    expect((await calendars.listEventsByCalendar(oldCalendar.id))[0]?.status).toBe("published");
    await expect(calendars.findPublishedEventById(oldEvent.id)).resolves.toBeNull();
    await expect(calendars.findPublishedEventByIdInScope(oldEvent.id, { universityId: oldEvent.universityId })).resolves.toBeNull();
    await expect(calendars.listUpcomingEvents({
      universityId: oldEvent.universityId,
      fromDate: new Date("2026-08-01T00:00:00.000Z"),
      limit: 20
    })).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: oldEvent.id })]));
    const staleNotifications = new InMemoryNotificationRepository();
    await staleNotifications.upsertDeviceToken({
      userId: "student-1",
      platform: "android",
      token: "stale-calendar-device-token",
      installationHash: "stale-calendar-installation"
    });
    await staleNotifications.upsertPreferences({
      userId: "student-1",
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      categories: { final_exam: true },
      reminderOffsets: [0]
    });
    const dueAt = new Date("2026-08-04T10:00:00.000Z");
    const [staleJob] = await staleNotifications.createNotificationJobs([{
      calendarId: oldCalendar.id,
      eventId: oldEvent.id,
      destinationType: "calendar_event",
      destinationId: oldEvent.id,
      destinationScopeType: "university",
      destinationScopeId: oldEvent.universityId,
      destinationFingerprint: calendarDestinationFingerprint(oldEvent),
      universityId: oldEvent.universityId,
      title: oldEvent.title,
      category: oldEvent.category,
      offsetDays: 0,
      trigger: "at_time",
      scheduledAt: dueAt,
      status: "scheduled"
    }]);
    if (!staleJob) throw new Error("Expected stale notification fixture.");
    const sender = new RecordingSender();
    const worker = new NotificationWorkerService(
      staleNotifications,
      new InMemoryQueueService(),
      sender,
      { findUserById: async (id: string) => id === "student-1" ? activeStudent(oldEvent.universityId) : null },
      undefined,
      calendars
    );
    await expect(worker.processDueJobs(dueAt)).resolves.toEqual(expect.objectContaining({ sent: 0, skipped: 1 }));
    expect(sender.messages).toEqual([]);
    expect((await staleNotifications.listJobsByCalendar(oldCalendar.id))[0]?.status).toBe("cancelled");
  });
});

class ResponseLossNotificationRepository extends InMemoryNotificationRepository {
  private loseResponse = true;

  override async syncProducedJobs(input: Parameters<InMemoryNotificationRepository["syncProducedJobs"]>[0]) {
    const result = await super.syncProducedJobs(input);
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error("SIMULATED_CALENDAR_SYNC_RESPONSE_LOSS");
    }
    return result;
  }
}

class RecordingSender implements PushSender {
  readonly messages: PushMessageInput[] = [];

  async send(input: PushMessageInput) {
    this.messages.push(input);
    return { status: "sent" as const, providerMessageId: "provider-message" };
  }
}

function calendarInput(status: "draft" | "published", version: number): Omit<AcademicCalendarRecord, "id" | "createdAt" | "updatedAt"> {
  return {
    universityId: "university-1",
    academicYear: "2026-2027",
    title: `Calendar v${version}`,
    status,
    version,
    ...(status === "published" ? { publishedAt: new Date("2026-07-01T00:00:00.000Z") } : {})
  };
}

function eventInput(
  calendar: AcademicCalendarRecord,
  status: "approved" | "published",
  title: string
): Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt"> {
  return {
    calendarId: calendar.id,
    universityId: calendar.universityId,
    academicYear: calendar.academicYear,
    term: "fall",
    category: "final_exam",
    title,
    startDate: new Date("2026-09-01T09:00:00.000Z"),
    timezone: "Europe/Istanbul",
    status,
    notificationRules: [{ offsetDays: 0, trigger: "at_time", enabled: true }]
  };
}

function activeStudent(universityId: string) {
  const now = new Date("2026-08-04T00:00:00.000Z");
  return {
    id: "student-1",
    credentialGeneration: 0,
    fullName: "Student",
    email: "student@example.test",
    passwordHash: "not-a-real-hash",
    role: "student" as const,
    status: "active" as const,
    universityId,
    createdAt: now,
    updatedAt: now
  };
}

function activeUniversity(id: string) {
  const now = new Date("2026-08-04T00:00:00.000Z");
  return {
    id,
    name: "Reconciliation University",
    slug: "reconciliation-university",
    city: "Ankara",
    type: "state" as const,
    status: "active" as const,
    createdAt: now,
    updatedAt: now
  };
}
