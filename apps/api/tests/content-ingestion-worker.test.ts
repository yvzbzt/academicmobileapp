import { afterEach, describe, expect, it, vi } from "vitest";
import { NestFactory } from "@nestjs/core";
import type { MongoConnectionService } from "../src/database/mongo-connection.service.js";
import type { AnnouncementIngestionService } from "../src/modules/announcements/announcement-ingestion.service.js";
import type { CalendarIngestionService } from "../src/modules/calendars/calendar-ingestion.service.js";
import { ContentIngestionWorkerModule } from "../src/modules/content-ingestion/content-ingestion-worker.module.js";
import {
  ContentIngestionWorkerService,
  isContentWorkerEnabled,
  millisecondsUntilNextDailyRun,
  parseDailyScheduleTimes
} from "../src/modules/content-ingestion/content-ingestion-worker.service.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("content ingestion worker", () => {
  it("is disabled by default in tests and supports an explicit runtime kill switch", () => {
    expect(isContentWorkerEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(isContentWorkerEnabled({ NODE_ENV: "test", CONTENT_INGESTION_WORKER_ENABLED: "true" })).toBe(true);
    expect(isContentWorkerEnabled({ NODE_ENV: "production", CONTENT_INGESTION_WORKER_ENABLED: "false" })).toBe(false);
    expect(isContentWorkerEnabled({ NODE_ENV: "production" })).toBe(true);
  });

  it("does no ingestion or notification reconciliation while globally disabled", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fixture = createWorker();

    await fixture.worker.onApplicationBootstrap();

    expect(fixture.announcement.runScheduledCycle).not.toHaveBeenCalled();
    expect(fixture.announcement.runDailyHealthCycle).not.toHaveBeenCalled();
    expect(fixture.announcement.runDeviceRevisionCycle).not.toHaveBeenCalled();
    expect(fixture.calendar.runScheduledCycle).not.toHaveBeenCalled();
    expect(fixture.calendar.reconcilePublishedCalendarNotifications).not.toHaveBeenCalled();
    expect(fixture.mongo.connect).not.toHaveBeenCalled();
  });

  it("does not become ready when the worker cannot connect to Mongo", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CONTENT_INGESTION_WORKER_ENABLED", "true");
    const fixture = createWorker({ mongoConnect: async () => { throw new Error("MONGO_UNAVAILABLE"); } });

    await expect(fixture.worker.onApplicationBootstrap()).rejects.toThrow("MONGO_UNAVAILABLE");
    expect(fixture.calendar.reconcilePublishedCalendarNotifications).not.toHaveBeenCalled();
    expect(fixture.announcement.runDailyHealthCycle).not.toHaveBeenCalled();
  });

  it("resolves the isolated application context without connecting to Mongo or starting HTTP", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const context = await NestFactory.createApplicationContext(ContentIngestionWorkerModule, { logger: false });
    try {
      expect(context.get(ContentIngestionWorkerService)).toBeInstanceOf(ContentIngestionWorkerService);
    } finally {
      await context.close();
    }
  });

  it("reconciles published calendar notifications without enabling either ingestion pipeline", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CONTENT_INGESTION_WORKER_ENABLED", "true");
    vi.stubEnv("ANNOUNCEMENT_AUTO_INGEST_ENABLED", "false");
    vi.stubEnv("CALENDAR_AUTO_INGEST_ENABLED", "false");
    const fixture = createWorker();

    await fixture.worker.onApplicationBootstrap();

    expect(fixture.calendar.reconcilePublishedCalendarNotifications).toHaveBeenCalledTimes(1);
    expect(fixture.announcement.runScheduledCycle).not.toHaveBeenCalled();
    expect(fixture.announcement.runDailyHealthCycle).not.toHaveBeenCalled();
    expect(fixture.announcement.runDeviceRevisionCycle).not.toHaveBeenCalled();
    expect(fixture.calendar.runScheduledCycle).not.toHaveBeenCalled();
    await fixture.worker.beforeApplicationShutdown();
  });

  it("runs enabled pipelines from timers and does not overlap a slow cycle", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CONTENT_INGESTION_WORKER_ENABLED", "true");
    vi.stubEnv("ANNOUNCEMENT_AUTO_INGEST_ENABLED", "true");
    vi.stubEnv("ANNOUNCEMENT_HEALTH_PROBE_ENABLED", "false");
    vi.stubEnv("ANNOUNCEMENT_INGEST_INITIAL_DELAY_MS", "1");
    vi.stubEnv("ANNOUNCEMENT_SCHEDULER_TICK_MS", "30000");
    vi.stubEnv("CALENDAR_AUTO_INGEST_ENABLED", "true");
    vi.stubEnv("CALENDAR_INGEST_INITIAL_DELAY_MS", "1");
    vi.stubEnv("CALENDAR_INGEST_SCHEDULE_TIMES", "");
    vi.stubEnv("CALENDAR_INGEST_INTERVAL_MS", "10");
    let releaseAnnouncement!: () => void;
    let releaseCalendar!: () => void;
    const fixture = createWorker({
      announcementCycle: () => new Promise<void>((resolve) => { releaseAnnouncement = resolve; }),
      calendarCycle: () => new Promise<void>((resolve) => { releaseCalendar = resolve; })
    });
    await fixture.worker.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.announcement.runScheduledCycle).toHaveBeenCalledTimes(1);
    expect(fixture.calendar.runScheduledCycle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fixture.announcement.runScheduledCycle).toHaveBeenCalledTimes(1);
    expect(fixture.calendar.runScheduledCycle).toHaveBeenCalledTimes(1);

    const draining = fixture.worker.beforeApplicationShutdown();
    releaseAnnouncement();
    releaseCalendar();
    await draining;
    await vi.advanceTimersByTimeAsync(90_000);

    expect(fixture.announcement.runScheduledCycle).toHaveBeenCalledTimes(1);
    expect(fixture.calendar.runScheduledCycle).toHaveBeenCalledTimes(1);
  });

  it("runs the source health probe once on the Istanbul daily schedule without overlap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T02:29:00.000Z"));
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CONTENT_INGESTION_WORKER_ENABLED", "true");
    vi.stubEnv("ANNOUNCEMENT_AUTO_INGEST_ENABLED", "false");
    vi.stubEnv("ANNOUNCEMENT_HEALTH_PROBE_ENABLED", "true");
    vi.stubEnv("ANNOUNCEMENT_HEALTH_PROBE_INITIAL_DELAY_MS", "3600000");
    vi.stubEnv("ANNOUNCEMENT_HEALTH_PROBE_SCHEDULE_TIMES", "05:30");
    vi.stubEnv("CALENDAR_AUTO_INGEST_ENABLED", "false");
    let releaseHealth!: () => void;
    const fixture = createWorker({
      healthCycle: () => new Promise<void>((resolve) => { releaseHealth = resolve; })
    });

    await fixture.worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fixture.announcement.runDailyHealthCycle).toHaveBeenCalledTimes(1);
    await expect(fixture.worker.runAnnouncementHealthCycle()).resolves.toBe(false);

    const draining = fixture.worker.beforeApplicationShutdown();
    releaseHealth();
    await draining;
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(fixture.announcement.runDailyHealthCycle).toHaveBeenCalledTimes(1);
  });

  it("runs a bounded startup probe and drains it on shutdown without overlap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"));
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CONTENT_INGESTION_WORKER_ENABLED", "true");
    vi.stubEnv("ANNOUNCEMENT_AUTO_INGEST_ENABLED", "false");
    vi.stubEnv("ANNOUNCEMENT_HEALTH_PROBE_ENABLED", "true");
    vi.stubEnv("ANNOUNCEMENT_HEALTH_PROBE_INITIAL_DELAY_MS", "1");
    vi.stubEnv("ANNOUNCEMENT_HEALTH_PROBE_SCHEDULE_TIMES", "23:59");
    vi.stubEnv("CALENDAR_AUTO_INGEST_ENABLED", "false");
    let releaseHealth!: () => void;
    const fixture = createWorker({
      healthCycle: () => new Promise<void>((resolve) => { releaseHealth = resolve; })
    });

    await fixture.worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(999);
    expect(fixture.announcement.runDailyHealthCycle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.announcement.runDailyHealthCycle).toHaveBeenCalledTimes(1);
    await expect(fixture.worker.runAnnouncementHealthCycle()).resolves.toBe(false);

    const draining = fixture.worker.beforeApplicationShutdown();
    releaseHealth();
    await draining;
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(fixture.announcement.runDailyHealthCycle).toHaveBeenCalledTimes(1);
  });

  it("checks device revisions every thirty minutes without overlapping a slow probe", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CONTENT_INGESTION_WORKER_ENABLED", "true");
    vi.stubEnv("ANNOUNCEMENT_HEALTH_PROBE_ENABLED", "false");
    vi.stubEnv("ANNOUNCEMENT_DEVICE_REVISION_ENABLED", "true");
    vi.stubEnv("ANNOUNCEMENT_DEVICE_REVISION_INITIAL_DELAY_MS", "1000");
    vi.stubEnv("ANNOUNCEMENT_DEVICE_REVISION_INTERVAL_MS", String(30 * 60 * 1000));
    vi.stubEnv("CALENDAR_AUTO_INGEST_ENABLED", "false");
    let releaseRevision!: () => void;
    const fixture = createWorker({
      revisionCycle: () => new Promise<void>((resolve) => { releaseRevision = resolve; })
    });

    await fixture.worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.announcement.runDeviceRevisionCycle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90 * 60 * 1000);
    expect(fixture.announcement.runDeviceRevisionCycle).toHaveBeenCalledTimes(1);
    await expect(fixture.worker.runAnnouncementRevisionCycle()).resolves.toBe(false);

    const draining = fixture.worker.beforeApplicationShutdown();
    releaseRevision();
    await draining;
  });

  it("queues one daily full probe when its schedule collides with a revision probe", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CONTENT_INGESTION_WORKER_ENABLED", "true");
    vi.stubEnv("ANNOUNCEMENT_HEALTH_PROBE_ENABLED", "false");
    vi.stubEnv("ANNOUNCEMENT_DEVICE_REVISION_ENABLED", "true");
    vi.stubEnv("ANNOUNCEMENT_DEVICE_REVISION_INITIAL_DELAY_MS", "1000");
    vi.stubEnv("ANNOUNCEMENT_DEVICE_REVISION_INTERVAL_MS", String(30 * 60 * 1000));
    vi.stubEnv("CALENDAR_AUTO_INGEST_ENABLED", "false");
    let releaseRevision!: () => void;
    const fixture = createWorker({
      revisionCycle: () => new Promise<void>((resolve) => { releaseRevision = resolve; })
    });

    await fixture.worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.announcement.runDeviceRevisionCycle).toHaveBeenCalledTimes(1);
    await expect(fixture.worker.runAnnouncementHealthCycle()).resolves.toBe(false);
    await expect(fixture.worker.runAnnouncementHealthCycle()).resolves.toBe(false);

    releaseRevision();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.announcement.runDailyHealthCycle).toHaveBeenCalledTimes(1);
    await fixture.worker.beforeApplicationShutdown();
  });

  it("becomes ready without waiting for a slow notification reconciliation", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CONTENT_INGESTION_WORKER_ENABLED", "true");
    vi.stubEnv("ANNOUNCEMENT_AUTO_INGEST_ENABLED", "false");
    vi.stubEnv("CALENDAR_AUTO_INGEST_ENABLED", "false");
    let releaseReconciliation!: () => void;
    const fixture = createWorker({
      reconciliationCycle: () => new Promise<void>((resolve) => { releaseReconciliation = resolve; })
    });

    await expect(fixture.worker.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(fixture.calendar.reconcilePublishedCalendarNotifications).toHaveBeenCalledTimes(1);

    const draining = fixture.worker.beforeApplicationShutdown();
    releaseReconciliation();
    await draining;
  });

  it("uses Istanbul wall-clock daily schedules", () => {
    expect(parseDailyScheduleTimes("18:30, bad, 06:30, 24:00")).toEqual([390, 1110]);
    expect(millisecondsUntilNextDailyRun([390, 1110], new Date("2026-09-04T03:00:00.000Z"))).toBe(30 * 60 * 1_000);
    expect(millisecondsUntilNextDailyRun([390, 1110], new Date("2026-09-04T16:00:00.000Z"))).toBe(11 * 60 * 60 * 1_000 + 30 * 60 * 1_000);
  });
});

function createWorker(input: {
  mongoConnect?: () => Promise<unknown>;
  announcementCycle?: () => Promise<void>;
  healthCycle?: () => Promise<void>;
  revisionCycle?: () => Promise<void>;
  calendarCycle?: () => Promise<void>;
  reconciliationCycle?: () => Promise<void>;
} = {}) {
  const mongo = {
    connect: vi.fn(input.mongoConnect ?? (async () => ({})))
  };
  const announcement = {
    runScheduledCycle: vi.fn(input.announcementCycle ?? (async () => undefined)),
    runDailyHealthCycle: vi.fn(input.healthCycle ?? (async () => undefined)),
    runDeviceRevisionCycle: vi.fn(input.revisionCycle ?? (async () => undefined))
  };
  const calendar = {
    runScheduledCycle: vi.fn(input.calendarCycle ?? (async () => undefined)),
    reconcilePublishedCalendarNotifications: vi.fn(async () => {
      await input.reconciliationCycle?.();
      return { checked: 0, reconciled: 0, failed: 0 };
    })
  };
  const worker = new ContentIngestionWorkerService(
    mongo as unknown as Pick<MongoConnectionService, "connect">,
    announcement as unknown as Pick<AnnouncementIngestionService, "runScheduledCycle" | "runDailyHealthCycle" | "runDeviceRevisionCycle">,
    calendar as Pick<CalendarIngestionService, "runScheduledCycle" | "reconcilePublishedCalendarNotifications">
  );
  return { worker, mongo, announcement, calendar };
}
