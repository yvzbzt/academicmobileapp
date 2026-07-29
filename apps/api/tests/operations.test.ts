import { HttpException, HttpStatus, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { RateLimitGuard } from "../src/common/guards/rate-limit.guard.js";
import { MongoConnectionService } from "../src/database/mongo-connection.service.js";
import { AdminCalendarService } from "../src/modules/calendars/admin-calendar.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { AdminAuditController } from "../src/modules/audit/admin-audit.controller.js";
import { InMemoryAuditRepository } from "../src/modules/audit/in-memory-audit.repository.js";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";
import { NotificationWorkerService } from "../src/modules/notifications/notification-worker.service.js";
import { NotificationSchedulingService } from "../src/modules/notifications/notifications.service.js";
import { InMemoryPdfRepository } from "../src/modules/pdf/in-memory-pdf.repository.js";
import { PdfProcessingService } from "../src/modules/pdf/pdf-processing.service.js";
import { InMemoryQueueService } from "../src/queue/in-memory-queue.service.js";
import { BullMqQueueService } from "../src/queue/bullmq-queue.service.js";
import { FirebasePushSender, type PushMessageInput, type PushSender } from "../src/modules/notifications/push-sender.service.js";
import { readRuntimeConfig } from "../src/config/runtime-config.js";
import { validateEnvironment } from "../src/config/environment-validation.js";
import { InfrastructureHealthService } from "../src/modules/health/infrastructure-health.service.js";
import { BootstrapSeedService } from "../src/bootstrap/bootstrap-seed.service.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import { AdminNotificationOpsController } from "../src/modules/notifications/admin-notification-ops.controller.js";
import { AUTH_ERROR_CODES } from "../src/modules/auth/auth.constants.js";
import { endpointCatalog } from "../src/contracts/endpoint-catalog.js";

function createExecutionContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class TestController {}
  } as unknown as ExecutionContext;
}

class FakePushSender implements PushSender {
  public readonly messages: PushMessageInput[] = [];

  constructor(private readonly invalidToken = false) {}

  async send(input: PushMessageInput) {
    this.messages.push(input);
    return { invalidToken: this.invalidToken, ...(this.invalidToken ? {} : { providerMessageId: "provider-message-1" }) };
  }
}

class ThrowingPushSender implements PushSender {
  async send(): Promise<never> {
    throw new Error("FIREBASE_NOT_CONFIGURED");
  }
}

const disabledOcrService = {
  async extractText() {
    return null;
  }
};

async function createScheduledNotificationJob(repository: InMemoryNotificationRepository) {
  const [job] = await repository.createNotificationJobs([
    {
      calendarId: "calendar-1",
      eventId: "event-1",
      universityId: "sample-university-1",
      title: "Final Sinavlari",
      category: "final_exam",
      offsetDays: 1,
      trigger: "before",
      scheduledAt: new Date("2027-01-01T00:00:00.000Z"),
      status: "scheduled"
    }
  ]);
  return job!;
}

async function createPublishableCalendar(input: { auditService?: AuditService; notificationRepository?: InMemoryNotificationRepository } = {}) {
  const pdfRepository = new InMemoryPdfRepository();
  const pdfService = new PdfProcessingService(pdfRepository, disabledOcrService);
  const source = await pdfService.createPdfSource({
    universityId: "sample-university-1",
    fileName: "operations-calendar.pdf",
    mimeType: "application/pdf",
    magicBytesHex: "255044462d312e37",
    fileSize: 4096,
    pageCount: 2,
    academicYear: "2026-2027",
    uploadedBy: "admin-1",
    rawText: "15-19 Eylul 2026 Guz Donemi Ders Kayitlari\n05-16 Ocak 2027 Guz Donemi Final Sinavlari"
  });
  const processed = await pdfService.processPdfSource(source.id);
  for (const event of processed.extractedEvents) await pdfService.approveExtractedEvent(event.id, "admin-1");
  const notificationRepository = input.notificationRepository ?? new InMemoryNotificationRepository();
  const scheduler = new NotificationSchedulingService(notificationRepository);
  const service = new AdminCalendarService(new InMemoryCalendarRepository(), pdfRepository, scheduler, input.auditService);
  const draft = await service.createDraftFromApprovedExtractedEvents({
    universityId: source.universityId,
    academicYear: source.academicYear,
    title: "Operations Calendar",
    sourcePdfId: source.id,
    createdBy: "admin-1"
  });
  return { service, draft, notificationRepository };
}

describe("operation services", () => {
  it("queues due notification jobs for worker processing", async () => {
    const notificationRepository = new InMemoryNotificationRepository();
    const { service, draft } = await createPublishableCalendar({ notificationRepository });
    await service.publishCalendar(draft.calendar.id, "admin-1");
    const queue = new InMemoryQueueService();
    const worker = new NotificationWorkerService(notificationRepository, queue, new FakePushSender());

    const queuedCount = await worker.enqueueDueJobs(new Date("2028-01-01T00:00:00.000Z"));
    const queuedJobs = await queue.listQueued("notification_send_job");

    expect(queuedCount).toBe(6);
    expect(queuedJobs).toHaveLength(6);
    expect(queuedJobs[0]?.payload).toEqual(expect.objectContaining({ title: expect.any(String) }));
  });

  it("records audit log when a calendar is published", async () => {
    const auditRepository = new InMemoryAuditRepository();
    const auditService = new AuditService(auditRepository);
    const { service, draft } = await createPublishableCalendar({ auditService });

    await service.publishCalendar(draft.calendar.id, "admin-1");
    const logs = await auditService.listByEntity("academic_calendar", draft.calendar.id);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual(expect.objectContaining({ actorId: "admin-1", action: "calendar.published" }));
  });

  it("limits strict endpoints by client and route", async () => {
    const guard = new RateLimitGuard();
    const request = { method: "POST", route: { path: "/auth/login" }, ip: "127.0.0.1" };

    for (let attempt = 0; attempt < 10; attempt += 1) await expect(guard.canActivate(createExecutionContext(request))).resolves.toBe(true);

    let rateLimitError: HttpException | undefined;
    try {
      await guard.canActivate(createExecutionContext(request));
    } catch (error) {
      rateLimitError = error as HttpException;
    }

    expect(rateLimitError).toBeInstanceOf(HttpException);
    expect(rateLimitError?.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(rateLimitError?.getResponse()).toEqual(
      expect.objectContaining({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: AUTH_ERROR_CODES.RATE_LIMITED,
        message: "Rate limit exceeded."
      })
    );
  });

  it("catalogs Google and resend verification as strict public auth endpoints", () => {
    expect(endpointCatalog).toEqual(
      expect.arrayContaining([
        { method: "POST", path: "/auth/google", authRequired: false, roles: "public", rateLimit: "strict" },
        { method: "POST", path: "/auth/resend-verification-code", authRequired: false, roles: "public", rateLimit: "strict" }
      ])
    );
  });

  it("keeps Mongo connection passive when no URI is configured", async () => {
    const service = new MongoConnectionService();
    await expect(service.connect(undefined)).resolves.toBeNull();
    expect(service.getConnection()).toBeNull();
  });

  it("keeps BullMQ adapter explicit when Redis is not configured", async () => {
    const service = new BullMqQueueService(undefined);
    await expect(service.enqueue("notification_send_job", { notificationJobId: "job-1" })).rejects.toThrow("REDIS_NOT_CONFIGURED");
  });

  it("keeps Firebase push sender explicit when credentials are not configured", async () => {
    const sender = new FirebasePushSender();
    await expect(sender.send({ token: "token-1", title: "Title", body: "Body" })).rejects.toThrow("FIREBASE_NOT_CONFIGURED");
  });

  it("returns admin audit entity timeline", async () => {
    const auditService = new AuditService(new InMemoryAuditRepository());
    await auditService.record({ actorId: "admin-1", action: "calendar.published", entityType: "academic_calendar", entityId: "calendar-1", metadata: {} });
    const controller = new AdminAuditController(auditService);

    const logs = await controller.list("academic_calendar", "calendar-1");

    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("calendar.published");
  });

  it("filters and exports admin audit logs", async () => {
    const auditService = new AuditService(new InMemoryAuditRepository());
    await auditService.record({ actorId: "admin-1", action: "calendar.published", entityType: "academic_calendar", entityId: "calendar-1", metadata: {} });
    await auditService.record({ actorId: "admin-2", action: "calendar.rollback", entityType: "academic_calendar", entityId: "calendar-1", metadata: {} });
    const controller = new AdminAuditController(auditService);

    const logs = await controller.list("academic_calendar", "calendar-1", "admin-2", undefined, "10", "0");
    const exported = await controller.exportJsonl("academic_calendar", "calendar-1", "admin-2");

    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("calendar.rollback");
    expect(exported.contentType).toBe("application/x-ndjson");
    expect(exported.data).toContain("calendar.rollback");
  });

  it("disables invalid device tokens during push delivery", async () => {
    const notificationRepository = new InMemoryNotificationRepository();
    const device = await notificationRepository.upsertDeviceToken({ userId: "user-1", platform: "android", token: "device-token-1" });
    const job = await createScheduledNotificationJob(notificationRepository);
    const worker = new NotificationWorkerService(notificationRepository, new InMemoryQueueService(), new FakePushSender(true));

    const result = await worker.sendToDevice({ job, token: device.token, body: "Yaklasan akademik etkinlik", device });
    const disabled = await notificationRepository.disableDeviceToken(device.token);
    const deliveries = await notificationRepository.listDeliveriesByJob(job.id, 10, 0);

    expect(result.failed).toBe(1);
    expect(disabled?.status).toBe("disabled");
    expect(deliveries[0]).toEqual(expect.objectContaining({ status: "failed", failureReason: "invalid_token", userId: "user-1" }));
  });

  it("records failed deliveries when the push provider is not configured", async () => {
    const notificationRepository = new InMemoryNotificationRepository();
    const device = await notificationRepository.upsertDeviceToken({ userId: "user-1", platform: "android", token: "device-token-1" });
    const job = await createScheduledNotificationJob(notificationRepository);
    const worker = new NotificationWorkerService(notificationRepository, new InMemoryQueueService(), new ThrowingPushSender());

    const result = await worker.sendToDevice({ job, token: device.token, body: "Yaklasan akademik etkinlik", device });
    const deliveries = await notificationRepository.listDeliveriesByJob(job.id, 10, 0);
    const failedJobs = await notificationRepository.listFailedJobs(10, 0);

    expect(result.failed).toBe(1);
    expect(failedJobs[0]?.id).toBe(job.id);
    expect(deliveries[0]).toEqual(expect.objectContaining({ status: "failed", failureReason: "FIREBASE_NOT_CONFIGURED", userId: "user-1" }));
  });

  it("fans out due notification jobs to eligible active devices", async () => {
    const notificationRepository = new InMemoryNotificationRepository();
    await notificationRepository.upsertDeviceToken({ userId: "user-1", platform: "android", token: "device-token-1" });
    await notificationRepository.upsertPreferences({ userId: "user-1", enabled: true, categories: { final_exam: true }, reminderOffsets: [1] });
    const sender = new FakePushSender();
    const worker = new NotificationWorkerService(notificationRepository, new InMemoryQueueService(), sender);
    const job = await createScheduledNotificationJob(notificationRepository);

    const result = await worker.processDueJobs(new Date("2027-01-01T00:00:00.000Z"));
    const deliveries = await notificationRepository.listDeliveriesByJob(job.id, 10, 0);

    expect(result.processedJobs).toBe(1);
    expect(result.sent).toBe(1);
    expect(sender.messages[0]).toEqual(expect.objectContaining({ token: "device-token-1", title: "Final Sinavlari" }));
    expect(deliveries[0]).toEqual(expect.objectContaining({ status: "sent", providerMessageId: "provider-message-1", userId: "user-1" }));
    expect(deliveries[0]?.deliveredAt).toBeInstanceOf(Date);
  });

  it("skips fan-out when notification preferences disable the category", async () => {
    const notificationRepository = new InMemoryNotificationRepository();
    await notificationRepository.upsertDeviceToken({ userId: "user-1", platform: "ios", token: "device-token-1" });
    await notificationRepository.upsertPreferences({ userId: "user-1", enabled: true, categories: { final_exam: false }, reminderOffsets: [1] });
    const worker = new NotificationWorkerService(notificationRepository, new InMemoryQueueService(), new FakePushSender());
    const job = await createScheduledNotificationJob(notificationRepository);

    const result = await worker.processDueJobs(new Date("2027-01-01T00:00:00.000Z"));
    const failed = await notificationRepository.listFailedJobs(10, 0);
    const deliveries = await notificationRepository.listDeliveriesByJob(job.id, 10, 0);

    expect(result.skipped).toBe(1);
    expect(failed).toHaveLength(0);
    expect((await notificationRepository.listJobsByCalendar(job.calendarId))[0]?.status).toBe("cancelled");
    expect(deliveries[0]).toEqual(expect.objectContaining({ status: "skipped", failureReason: "preference_disabled" }));
  });

  it("defers due jobs when all eligible users are in quiet hours", async () => {
    const notificationRepository = new InMemoryNotificationRepository();
    await notificationRepository.upsertDeviceToken({ userId: "user-1", platform: "android", token: "device-token-1" });
    await notificationRepository.upsertPreferences({
      userId: "user-1",
      enabled: true,
      categories: { final_exam: true },
      reminderOffsets: [1],
      quietHours: { enabled: true, start: "22:00", end: "07:00", timezone: "Europe/Istanbul" }
    });
    const worker = new NotificationWorkerService(notificationRepository, new InMemoryQueueService(), new FakePushSender());
    const job = await createScheduledNotificationJob(notificationRepository);

    const result = await worker.processDueJobs(new Date("2027-01-01T23:00:00.000Z"));
    const [rescheduled] = await notificationRepository.listJobsByCalendar(job.calendarId);
    const deliveries = await notificationRepository.listDeliveriesByJob(job.id, 10, 0);

    expect(result.deferred).toBe(1);
    expect(rescheduled?.status).toBe("scheduled");
    expect(rescheduled?.scheduledAt.getTime()).toBeGreaterThan(new Date("2027-01-01T23:00:00.000Z").getTime());
    expect(deliveries[0]).toEqual(expect.objectContaining({ status: "deferred", failureReason: "quiet_hours" }));
  });

  it("lists and retries failed notification jobs through admin operations", async () => {
    const notificationRepository = new InMemoryNotificationRepository();
    const worker = new NotificationWorkerService(notificationRepository, new InMemoryQueueService(), new FakePushSender());
    const controller = new AdminNotificationOpsController(worker);
    const job = await createScheduledNotificationJob(notificationRepository);
    await notificationRepository.updateJobStatus(job.id, "failed");

    const failed = await controller.listFailed("10", "0");
    const retried = await controller.retry(job.id);

    expect(failed).toHaveLength(1);
    expect(retried?.status).toBe("scheduled");
  });

  it("lists notification delivery records through admin operations", async () => {
    const notificationRepository = new InMemoryNotificationRepository();
    await notificationRepository.upsertDeviceToken({ userId: "user-1", platform: "web", token: "device-token-1" });
    const worker = new NotificationWorkerService(notificationRepository, new InMemoryQueueService(), new FakePushSender());
    const controller = new AdminNotificationOpsController(worker);
    const job = await createScheduledNotificationJob(notificationRepository);

    await worker.processDueJobs(new Date("2027-01-01T00:00:00.000Z"));
    const deliveries = await controller.listDeliveries(job.id, "10", "0");

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toEqual(expect.objectContaining({ jobId: job.id, status: "sent", token: "device-token-1" }));
  });

  it("reads runtime adapter modes from environment with safe defaults", () => {
    expect(readRuntimeConfig({}).repositoryMode).toBe("memory");
    expect(readRuntimeConfig({ REPOSITORY_MODE: "mongo", QUEUE_MODE: "bullmq", RATE_LIMIT_STORE: "redis", REDIS_URL: "redis://localhost:6379" })).toEqual({
      repositoryMode: "mongo",
      queueMode: "bullmq",
      rateLimitStoreMode: "redis",
      redisUrl: "redis://localhost:6379"
    });
  });

  it("validates infrastructure environment requirements", () => {
    const invalid = validateEnvironment({ REPOSITORY_MODE: "mongo", QUEUE_MODE: "bullmq", RATE_LIMIT_STORE: "redis" });
    const valid = validateEnvironment({ REPOSITORY_MODE: "mongo", QUEUE_MODE: "bullmq", RATE_LIMIT_STORE: "redis", MONGODB_URI: "mongodb://localhost:27017/test", REDIS_URL: "redis://localhost:6379" });

    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContain("MONGODB_URI is required when REPOSITORY_MODE=mongo.");
    expect(invalid.errors).toContain("REDIS_URL is required when QUEUE_MODE=bullmq.");
    expect(valid.valid).toBe(true);
  });

  it("reports skipped infrastructure readiness for in-memory runtime", async () => {
    const service = new InfrastructureHealthService(new MongoConnectionService(), undefined);

    const readiness = await service.readiness();

    expect(readiness.status).toBe("ok");
    expect(readiness.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ name: "mongodb", status: "skipped" }), expect.objectContaining({ name: "redis", status: "skipped" })]));
  });

  it("seeds only the bootstrap admin user when explicitly invoked", async () => {
    const authRepository = new InMemoryAuthRepository();
    const service = new BootstrapSeedService(authRepository, new InMemoryCatalogRepository(), new PasswordHasher());
    const previousPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    const previousCatalogSeedEnabled = process.env.BOOTSTRAP_CATALOG_SEED_ENABLED;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "AdminPassword123!";
    process.env.BOOTSTRAP_CATALOG_SEED_ENABLED = "false";

    const result = await service.seed();
    const admin = await authRepository.findUserByEmail("admin@example.com");
    if (previousPassword === undefined) delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    else process.env.BOOTSTRAP_ADMIN_PASSWORD = previousPassword;
    if (previousCatalogSeedEnabled === undefined) delete process.env.BOOTSTRAP_CATALOG_SEED_ENABLED;
    else process.env.BOOTSTRAP_CATALOG_SEED_ENABLED = previousCatalogSeedEnabled;

    expect(result.catalog.created).toBe(false);
    expect(result.catalog.skippedReason).toContain("BOOTSTRAP_CATALOG_SEED_ENABLED=false");
    expect(result.admin.created).toBe(true);
    expect(admin?.role).toBe("super_admin");
  });
});
