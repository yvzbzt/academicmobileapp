import { afterEach, describe, expect, it, vi } from "vitest";
import { NestFactory } from "@nestjs/core";
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
    expect(fixture.calendar.runScheduledCycle).not.toHaveBeenCalled();
    expect(fixture.calendar.reconcilePublishedCalendarNotifications).not.toHaveBeenCalled();
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
    expect(fixture.calendar.runScheduledCycle).not.toHaveBeenCalled();
    await fixture.worker.beforeApplicationShutdown();
  });

  it("runs enabled pipelines from timers and does not overlap a slow cycle", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CONTENT_INGESTION_WORKER_ENABLED", "true");
    vi.stubEnv("ANNOUNCEMENT_AUTO_INGEST_ENABLED", "true");
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

  it("uses Istanbul wall-clock daily schedules", () => {
    expect(parseDailyScheduleTimes("18:30, bad, 06:30, 24:00")).toEqual([390, 1110]);
    expect(millisecondsUntilNextDailyRun([390, 1110], new Date("2026-09-04T03:00:00.000Z"))).toBe(30 * 60 * 1_000);
    expect(millisecondsUntilNextDailyRun([390, 1110], new Date("2026-09-04T16:00:00.000Z"))).toBe(11 * 60 * 60 * 1_000 + 30 * 60 * 1_000);
  });
});

function createWorker(input: {
  announcementCycle?: () => Promise<void>;
  calendarCycle?: () => Promise<void>;
} = {}) {
  const announcement = {
    runScheduledCycle: vi.fn(input.announcementCycle ?? (async () => undefined))
  };
  const calendar = {
    runScheduledCycle: vi.fn(input.calendarCycle ?? (async () => undefined)),
    reconcilePublishedCalendarNotifications: vi.fn(async () => ({ checked: 0, reconciled: 0, failed: 0 }))
  };
  const worker = new ContentIngestionWorkerService(
    announcement as Pick<AnnouncementIngestionService, "runScheduledCycle">,
    calendar as Pick<CalendarIngestionService, "runScheduledCycle" | "reconcilePublishedCalendarNotifications">
  );
  return { worker, announcement, calendar };
}
