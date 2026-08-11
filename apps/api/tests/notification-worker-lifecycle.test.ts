import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthUserRecord } from "../src/modules/auth/auth.types.js";
import type { AnnouncementItem, AnnouncementRepository, AnnouncementSourceRecord } from "../src/modules/announcements/announcements.types.js";
import { createNormalizedContentFingerprint } from "../src/modules/announcements/announcement-content-trust.js";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";
import { announcementDestinationFingerprint } from "../src/modules/notifications/notification-destination.js";
import { NotificationWorkerService } from "../src/modules/notifications/notification-worker.service.js";
import { NOTIFICATION_DELIVERY_CONSENT_VERSION } from "../src/modules/notifications/notification.types.js";
import type { PushMessageInput, PushSender } from "../src/modules/notifications/push-sender.service.js";
import { InMemoryQueueService } from "../src/queue/in-memory-queue.service.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("automatic notification worker lifecycle", () => {
  it("is test-disabled by default and runtime-enabled by default", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const testWorker = createWorker(new InMemoryNotificationRepository());
    testWorker.onApplicationBootstrap();
    expect(testWorker.health()).toEqual(expect.objectContaining({ enabled: false, state: "disabled" }));

    vi.stubEnv("NODE_ENV", "production");
    vi.useFakeTimers();
    const runtimeWorker = createWorker(new InMemoryNotificationRepository());
    runtimeWorker.onApplicationBootstrap();
    expect(runtimeWorker.health()).toEqual(expect.objectContaining({ enabled: true, state: "starting" }));
    await runtimeWorker.beforeApplicationShutdown();
    runtimeWorker.onApplicationShutdown();
  });

  it("dispatches without an admin call, never overlaps cycles, and drains before stopping", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NOTIFICATION_WORKER_ENABLED", "true");
    vi.stubEnv("NOTIFICATION_WORKER_INITIAL_DELAY_MS", "1");
    vi.stubEnv("NOTIFICATION_WORKER_INTERVAL_MS", "10");
    const worker = createWorker(new InMemoryNotificationRepository());
    let releaseCycle!: () => void;
    const processDue = vi.spyOn(worker, "processDueJobs").mockImplementation(() => new Promise((resolve) => {
      releaseCycle = () => resolve({ processedJobs: 0, queued: 0, sent: 0, failed: 0 });
    }));

    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(1);
    expect(processDue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(processDue).toHaveBeenCalledTimes(1);

    const draining = worker.beforeApplicationShutdown();
    expect(worker.health()).toEqual(expect.objectContaining({ state: "draining", running: true }));
    releaseCycle();
    await draining;
    worker.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(100);

    expect(processDue).toHaveBeenCalledTimes(1);
    expect(worker.health()).toEqual(expect.objectContaining({ enabled: false, state: "disabled", running: false }));
    expect(worker.health().lastSuccessAt).toEqual(expect.any(String));
    expect(worker.health().backlog).toEqual(expect.objectContaining({ due: 0, retrying: 0, processing: 0, dead: 0 }));
  });

  it("revalidates the exact trusted destination again immediately before send", async () => {
    const repository = new InMemoryNotificationRepository();
    const now = new Date("2026-08-04T12:00:00.000Z");
    const { source, item } = announcementFixture();
    const destinationFingerprint = announcementDestinationFingerprint(item, source);
    const device = await repository.upsertDeviceToken({
      userId: "student-1",
      platform: "android",
      token: "non-secret-test-device-token",
      installationHash: "installation-hash"
    });
    await repository.upsertPreferences({
      userId: "student-1",
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      categories: { announcement: true },
      reminderOffsets: [0]
    });
    const [job] = await repository.createNotificationJobs([{
      calendarId: "announcement-source:source-1",
      eventId: item.id,
      destinationType: "announcement",
      destinationId: item.id,
      destinationScopeType: source.scopeType,
      destinationScopeId: source.scopeId,
      destinationFingerprint,
      universityId: source.scopeId,
      title: item.title,
      category: "announcement",
      offsetDays: 0,
      trigger: "at_time",
      scheduledAt: now,
      status: "scheduled"
    }]);
    if (!job) throw new Error("Expected job fixture.");
    const exactLookup = vi.fn()
      .mockResolvedValueOnce({ item, source })
      .mockResolvedValueOnce(null);
    const announcementRepository = { findTrustedItemByIdInScope: exactLookup } as unknown as AnnouncementRepository;
    const sender = new RecordingSender();
    const worker = new NotificationWorkerService(
      repository,
      new InMemoryQueueService(),
      sender,
      activeStudentRepository({ universityId: source.scopeId }),
      announcementRepository
    );

    const result = await worker.processDueJobs(now);
    const deliveries = await repository.listDeliveriesByJob(job.id, 10, 0);
    const [stored] = await repository.listJobsByCalendar(job.calendarId);

    expect(exactLookup).toHaveBeenCalledTimes(2);
    expect(sender.messages).toEqual([]);
    expect(result).toEqual(expect.objectContaining({ sent: 0, skipped: 1 }));
    expect(deliveries).toEqual([expect.objectContaining({
      deviceTokenId: device.id,
      status: "skipped",
      failureReason: "destination_unavailable"
    })]);
    expect(stored?.status).toBe("cancelled");
  });

  it.each(["reclaimed", "cancelled"] as const)("does not call the provider after its claim is %s during destination revalidation", async (mutation) => {
    const repository = new InMemoryNotificationRepository();
    const now = new Date("2026-08-04T12:00:00.000Z");
    const { source, item } = announcementFixture();
    await repository.upsertDeviceToken({
      userId: "student-1",
      platform: "android",
      token: `claim-fence-${mutation}-device-token`,
      installationHash: `claim-fence-${mutation}-installation`
    });
    await repository.upsertPreferences({
      userId: "student-1",
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      categories: { announcement: true },
      reminderOffsets: [0]
    });
    const [job] = await repository.createNotificationJobs([{
      calendarId: "announcement-source:source-1",
      eventId: item.id,
      destinationType: "announcement",
      destinationId: item.id,
      destinationScopeType: source.scopeType,
      destinationScopeId: source.scopeId,
      destinationFingerprint: announcementDestinationFingerprint(item, source),
      universityId: source.scopeId,
      title: item.title,
      category: "announcement",
      offsetDays: 0,
      trigger: "at_time",
      scheduledAt: now,
      status: "scheduled"
    }]);
    if (!job) throw new Error("Expected claim-fence job fixture.");

    let releaseLookup!: () => void;
    let lookupStarted!: () => void;
    const lookupGate = new Promise<void>((resolve) => { releaseLookup = resolve; });
    const secondLookupStarted = new Promise<void>((resolve) => { lookupStarted = resolve; });
    let lookupCount = 0;
    const announcementRepository = {
      async findTrustedItemByIdInScope() {
        lookupCount += 1;
        if (lookupCount === 2) {
          lookupStarted();
          await lookupGate;
        }
        return { item, source };
      }
    } as unknown as AnnouncementRepository;
    const sender = new RecordingSender();
    const worker = new NotificationWorkerService(
      repository,
      new InMemoryQueueService(),
      sender,
      activeStudentRepository({ universityId: source.scopeId }),
      announcementRepository
    );

    const processing = worker.processDueJobs(now);
    await secondLookupStarted;
    if (mutation === "reclaimed") {
      await expect(repository.claimDueJob(
        job.id,
        new Date(now.getTime() + 10 * 60 * 1000),
        "replacement-claim",
        new Date(now.getTime() + 20 * 60 * 1000)
      )).resolves.toEqual(expect.objectContaining({ processingClaimId: "replacement-claim" }));
    } else {
      await repository.updateJobStatus(job.id, "cancelled");
    }
    releaseLookup();
    const result = await processing;

    expect(sender.messages).toEqual([]);
    expect(result).toEqual(expect.objectContaining({ sent: 0, skipped: 1 }));
  });

  it("fails closed for an automatic job without an exact destination fingerprint", async () => {
    const repository = new InMemoryNotificationRepository();
    const now = new Date("2026-08-04T12:00:00.000Z");
    const { source, item } = announcementFixture();
    await repository.upsertDeviceToken({
      userId: "student-1",
      platform: "android",
      token: "fingerprintless-automatic-device-token",
      installationHash: "fingerprintless-automatic-installation"
    });
    await repository.upsertPreferences({
      userId: "student-1",
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      categories: { announcement: true },
      reminderOffsets: [0]
    });
    const [job] = await repository.createNotificationJobs([{
      calendarId: "announcement-source:legacy",
      eventId: item.id,
      destinationType: "announcement",
      destinationId: item.id,
      destinationScopeType: source.scopeType,
      destinationScopeId: source.scopeId,
      universityId: source.scopeId,
      title: item.title,
      category: "announcement",
      offsetDays: 0,
      trigger: "at_time",
      scheduledAt: now,
      status: "scheduled"
    }]);
    if (!job) throw new Error("Expected fingerprintless job fixture.");
    const sender = new RecordingSender();
    const worker = new NotificationWorkerService(
      repository,
      new InMemoryQueueService(),
      sender,
      activeStudentRepository({ universityId: source.scopeId }),
      { findTrustedItemByIdInScope: async () => ({ item, source }) } as unknown as AnnouncementRepository
    );

    const result = await worker.processDueJobs(now);

    expect(sender.messages).toEqual([]);
    expect(result).toEqual(expect.objectContaining({ sent: 0, skipped: 1 }));
    expect((await repository.listJobsByCalendar(job.calendarId))[0]?.status).toBe("cancelled");
  });

  it("turns an unexpected per-job dependency failure into a claim-fenced dead job and continues safely", async () => {
    const repository = new InMemoryNotificationRepository();
    const now = new Date("2026-08-04T12:00:00.000Z");
    const { source, item } = announcementFixture();
    await repository.upsertDeviceToken({
      userId: "student-1",
      platform: "android",
      token: "dependency-failure-device-token",
      installationHash: "dependency-failure-installation"
    });
    await repository.upsertPreferences({
      userId: "student-1",
      enabled: true,
      deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
      categories: { announcement: true },
      reminderOffsets: [0]
    });
    const [job] = await repository.createNotificationJobs([{
      calendarId: "announcement-source:dependency-failure",
      eventId: item.id,
      destinationType: "announcement",
      destinationId: item.id,
      destinationScopeType: source.scopeType,
      destinationScopeId: source.scopeId,
      destinationFingerprint: announcementDestinationFingerprint(item, source),
      universityId: source.scopeId,
      title: item.title,
      category: "announcement",
      offsetDays: 0,
      trigger: "at_time",
      scheduledAt: now,
      status: "scheduled",
      maxAttempts: 1
    }]);
    if (!job) throw new Error("Expected dependency-failure job fixture.");
    const sender = new RecordingSender();
    const worker = new NotificationWorkerService(
      repository,
      new InMemoryQueueService(),
      sender,
      { findUserById: async () => { throw new Error("sensitive dependency detail"); } },
      { findTrustedItemByIdInScope: async () => ({ item, source }) } as unknown as AnnouncementRepository
    );

    const result = await worker.processDueJobs(now);
    const [stored] = await repository.listJobsByCalendar(job.calendarId);

    expect(result).toEqual(expect.objectContaining({ processedJobs: 1, sent: 0, failed: 1 }));
    expect(sender.messages).toEqual([]);
    expect(stored).toEqual(expect.objectContaining({
      status: "dead",
      attemptCount: 1,
      lastFailureReason: "worker_interrupted"
    }));
  });

  it("paginates destination validation beyond 500 jobs without skipping a stale tail job", async () => {
    const repository = new InMemoryNotificationRepository();
    const now = new Date("2026-08-04T12:00:00.000Z");
    const { source, item } = announcementFixture();
    const destinationFingerprint = announcementDestinationFingerprint(item, source);
    await repository.createNotificationJobs(Array.from({ length: 501 }, (_, index) => {
      const destinationId = index === 500 ? "stale-tail" : `valid-${index.toString().padStart(3, "0")}`;
      return {
        calendarId: "announcement-pagination",
        eventId: destinationId,
        destinationType: "announcement" as const,
        destinationId,
        destinationScopeType: source.scopeType,
        destinationScopeId: source.scopeId,
        destinationFingerprint,
        universityId: source.scopeId,
        title: item.title,
        category: "announcement" as const,
        offsetDays: 0,
        trigger: "at_time" as const,
        scheduledAt: now,
        status: "scheduled" as const
      };
    }));
    const announcementRepository = {
      async findTrustedItemByIdInScope(input: { announcementId: string }) {
        return input.announcementId === "stale-tail" ? null : { item: { ...item, id: input.announcementId }, source };
      }
    } as unknown as AnnouncementRepository;
    const worker = new NotificationWorkerService(
      repository,
      new InMemoryQueueService(),
      new RecordingSender(),
      undefined,
      announcementRepository
    );

    await expect(worker.retireStaleJobs(500)).resolves.toBe(1);
    const jobs = await repository.listJobsByCalendar("announcement-pagination");
    expect(jobs.filter((job) => job.status === "scheduled")).toHaveLength(500);
    expect(jobs.find((job) => job.destinationId === "stale-tail")?.status).toBe("cancelled");
  });
});

class RecordingSender implements PushSender {
  readonly messages: PushMessageInput[] = [];

  async send(input: PushMessageInput) {
    this.messages.push(input);
    return { status: "sent" as const, providerMessageId: "provider-message" };
  }
}

function createWorker(repository: InMemoryNotificationRepository): NotificationWorkerService {
  return new NotificationWorkerService(repository, new InMemoryQueueService(), new RecordingSender());
}

function activeStudentRepository(scope: { universityId?: string; facultyId?: string; departmentId?: string }) {
  const now = new Date("2026-08-04T00:00:00.000Z");
  const user: AuthUserRecord = {
    id: "student-1",
    credentialGeneration: 0,
    fullName: "Student",
    email: "student@example.test",
    passwordHash: "not-a-real-hash",
    role: "student",
    status: "active",
    ...scope,
    createdAt: now,
    updatedAt: now
  };
  return { findUserById: async (id: string) => id === user.id ? user : null };
}

function announcementFixture(): { source: AnnouncementSourceRecord; item: AnnouncementItem } {
  const now = new Date("2026-08-04T00:00:00.000Z");
  const source: AnnouncementSourceRecord = {
    id: "source-1",
    scopeType: "university",
    scopeId: "university-1",
    sourceName: "Official source",
    sourceUrl: "https://example.edu.tr/announcements",
    canonicalUrl: "https://example.edu.tr/announcements",
    contentType: "announcement",
    parser: "html",
    priority: 10,
    status: "active",
    trustStatus: "trusted",
    createdAt: now,
    updatedAt: now
  };
  const contentFingerprint = createNormalizedContentFingerprint({ title: "Trusted announcement" });
  const item: AnnouncementItem = {
    id: "announcement-real-id",
    sourceId: source.id,
    sourceName: source.sourceName,
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    contentType: "announcement",
    title: "Trusted announcement",
    link: "https://example.edu.tr/announcements/1",
    canonicalUrl: "https://example.edu.tr/announcements/1",
    ...(source.canonicalUrl ? { officialSourceUrl: source.canonicalUrl } : {}),
    contentFingerprint,
    trustStatus: "trusted"
  };
  return { source, item };
}
