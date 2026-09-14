import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap
} from "@nestjs/common";
import { AnnouncementIngestionService } from "../announcements/announcement-ingestion.service.js";
import { CalendarIngestionService } from "../calendars/calendar-ingestion.service.js";

@Injectable()
export class ContentIngestionWorkerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(ContentIngestionWorkerService.name);
  private announcementInitialTimer: NodeJS.Timeout | null = null;
  private announcementTimer: NodeJS.Timeout | null = null;
  private announcementHealthInitialTimer: NodeJS.Timeout | null = null;
  private announcementHealthTimer: NodeJS.Timeout | null = null;
  private calendarInitialTimer: NodeJS.Timeout | null = null;
  private calendarTimer: NodeJS.Timeout | null = null;
  private announcementCycle: Promise<void> | null = null;
  private announcementHealthCycle: Promise<void> | null = null;
  private calendarCycle: Promise<void> | null = null;
  private reconciliationCycle: Promise<void> | null = null;
  private acceptingCycles = false;

  constructor(
    @Inject(AnnouncementIngestionService) private readonly announcementIngestionService: Pick<AnnouncementIngestionService, "runScheduledCycle" | "runDailyHealthCycle">,
    @Inject(CalendarIngestionService) private readonly calendarIngestionService: Pick<CalendarIngestionService, "runScheduledCycle" | "reconcilePublishedCalendarNotifications">
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!isContentWorkerEnabled(process.env)) return;

    this.acceptingCycles = true;
    await this.dispatchReconciliation();
    if (!this.acceptingCycles) return;

    if (process.env.ANNOUNCEMENT_AUTO_INGEST_ENABLED === "true") this.scheduleAnnouncementIngestion();
    if (process.env.ANNOUNCEMENT_HEALTH_PROBE_ENABLED !== "false") this.scheduleAnnouncementHealthProbe();
    if (process.env.CALENDAR_AUTO_INGEST_ENABLED === "true") this.scheduleCalendarIngestion();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.acceptingCycles = false;
    this.clearTimers();
    await Promise.allSettled([
      ...(this.announcementCycle ? [this.announcementCycle] : []),
      ...(this.announcementHealthCycle ? [this.announcementHealthCycle] : []),
      ...(this.calendarCycle ? [this.calendarCycle] : []),
      ...(this.reconciliationCycle ? [this.reconciliationCycle] : [])
    ]);
  }

  async runAnnouncementCycle(): Promise<boolean> {
    if (!this.acceptingCycles || this.announcementCycle) return false;
    const cycle = Promise.resolve().then(() => this.announcementIngestionService.runScheduledCycle());
    this.announcementCycle = cycle;
    try {
      await cycle;
      return true;
    } finally {
      if (this.announcementCycle === cycle) this.announcementCycle = null;
    }
  }

  async runCalendarCycle(): Promise<boolean> {
    if (!this.acceptingCycles || this.calendarCycle) return false;
    const cycle = Promise.resolve().then(() => this.calendarIngestionService.runScheduledCycle());
    this.calendarCycle = cycle;
    try {
      await cycle;
      return true;
    } finally {
      if (this.calendarCycle === cycle) this.calendarCycle = null;
    }
  }

  async runAnnouncementHealthCycle(): Promise<boolean> {
    if (!this.acceptingCycles || this.announcementHealthCycle) return false;
    const cycle = Promise.resolve()
      .then(() => this.announcementIngestionService.runDailyHealthCycle())
      .then(() => undefined);
    this.announcementHealthCycle = cycle;
    try {
      await cycle;
      return true;
    } finally {
      if (this.announcementHealthCycle === cycle) this.announcementHealthCycle = null;
    }
  }

  async reconcileCalendarNotifications(): Promise<boolean> {
    if (!this.acceptingCycles || this.reconciliationCycle) return false;
    const cycle = Promise.resolve()
      .then(() => this.calendarIngestionService.reconcilePublishedCalendarNotifications())
      .then(() => undefined);
    this.reconciliationCycle = cycle;
    try {
      await cycle;
      return true;
    } finally {
      if (this.reconciliationCycle === cycle) this.reconciliationCycle = null;
    }
  }

  private scheduleAnnouncementIngestion(): void {
    const initialDelayMs = readPositiveInteger(process.env.ANNOUNCEMENT_INGEST_INITIAL_DELAY_MS, 5_000);
    const schedulerTickMs = Math.max(30_000, readPositiveInteger(process.env.ANNOUNCEMENT_SCHEDULER_TICK_MS, 60_000));
    this.announcementTimer = setInterval(() => this.dispatchAnnouncementCycle(), schedulerTickMs);
    this.announcementInitialTimer = setTimeout(() => {
      this.announcementInitialTimer = null;
      this.dispatchAnnouncementCycle();
    }, initialDelayMs);
  }

  private scheduleCalendarIngestion(): void {
    const initialDelayMs = readPositiveInteger(process.env.CALENDAR_INGEST_INITIAL_DELAY_MS, 15_000);
    const scheduleTimes = parseDailyScheduleTimes(process.env.CALENDAR_INGEST_SCHEDULE_TIMES ?? "06:30");
    if (scheduleTimes.length > 0) this.scheduleNextCalendarCycle(scheduleTimes);
    else {
      this.calendarTimer = setInterval(
        () => this.dispatchCalendarCycle(),
        readPositiveInteger(process.env.CALENDAR_INGEST_INTERVAL_MS, 24 * 60 * 60 * 1_000)
      );
    }
    this.calendarInitialTimer = setTimeout(() => {
      this.calendarInitialTimer = null;
      this.dispatchCalendarCycle();
    }, initialDelayMs);
  }

  private scheduleAnnouncementHealthProbe(): void {
    const initialDelayMs = readBoundedPositiveInteger(
      process.env.ANNOUNCEMENT_HEALTH_PROBE_INITIAL_DELAY_MS,
      30_000,
      1_000,
      60 * 60 * 1_000
    );
    const scheduleTimes = parseDailyScheduleTimes(process.env.ANNOUNCEMENT_HEALTH_PROBE_SCHEDULE_TIMES ?? "05:30");
    if (scheduleTimes.length > 0) this.scheduleNextAnnouncementHealthCycle(scheduleTimes);
    this.announcementHealthInitialTimer = setTimeout(() => {
      this.announcementHealthInitialTimer = null;
      this.dispatchAnnouncementHealthCycle();
    }, initialDelayMs);
  }

  private scheduleNextAnnouncementHealthCycle(scheduleTimes: number[]): void {
    this.announcementHealthTimer = setTimeout(() => {
      this.announcementHealthTimer = null;
      void this.runAnnouncementHealthCycle()
        .catch(() => this.logger.error("CONTENT_INGESTION_ANNOUNCEMENT_HEALTH_PROBE_FAILED"))
        .finally(() => {
          if (this.acceptingCycles) this.scheduleNextAnnouncementHealthCycle(scheduleTimes);
        });
    }, millisecondsUntilNextDailyRun(scheduleTimes));
  }

  private scheduleNextCalendarCycle(scheduleTimes: number[]): void {
    this.calendarTimer = setTimeout(() => {
      this.calendarTimer = null;
      void this.runCalendarCycle()
        .catch(() => this.logger.error("CONTENT_INGESTION_CALENDAR_CYCLE_FAILED"))
        .finally(() => {
          if (this.acceptingCycles) this.scheduleNextCalendarCycle(scheduleTimes);
        });
    }, millisecondsUntilNextDailyRun(scheduleTimes));
  }

  private dispatchAnnouncementCycle(): void {
    void this.runAnnouncementCycle().catch(() => this.logger.error("CONTENT_INGESTION_ANNOUNCEMENT_CYCLE_FAILED"));
  }

  private dispatchAnnouncementHealthCycle(): void {
    void this.runAnnouncementHealthCycle()
      .catch(() => this.logger.error("CONTENT_INGESTION_ANNOUNCEMENT_HEALTH_PROBE_FAILED"));
  }

  private dispatchCalendarCycle(): void {
    void this.runCalendarCycle().catch(() => this.logger.error("CONTENT_INGESTION_CALENDAR_CYCLE_FAILED"));
  }

  private async dispatchReconciliation(): Promise<void> {
    try {
      await this.reconcileCalendarNotifications();
    } catch {
      this.logger.error("CONTENT_INGESTION_CALENDAR_NOTIFICATION_RECONCILIATION_FAILED");
    }
  }

  private clearTimers(): void {
    if (this.announcementInitialTimer) clearTimeout(this.announcementInitialTimer);
    if (this.announcementTimer) clearInterval(this.announcementTimer);
    if (this.announcementHealthInitialTimer) clearTimeout(this.announcementHealthInitialTimer);
    if (this.announcementHealthTimer) clearTimeout(this.announcementHealthTimer);
    if (this.calendarInitialTimer) clearTimeout(this.calendarInitialTimer);
    if (this.calendarTimer) clearTimeout(this.calendarTimer);
    this.announcementInitialTimer = null;
    this.announcementTimer = null;
    this.announcementHealthInitialTimer = null;
    this.announcementHealthTimer = null;
    this.calendarInitialTimer = null;
    this.calendarTimer = null;
  }
}

export function isContentWorkerEnabled(environment: NodeJS.ProcessEnv): boolean {
  if (environment.CONTENT_INGESTION_WORKER_ENABLED === "false") return false;
  return environment.NODE_ENV !== "test" || environment.CONTENT_INGESTION_WORKER_ENABLED === "true";
}

export function parseDailyScheduleTimes(value: string): number[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .map((part) => part.match(/^(\d{1,2}):(\d{2})$/u))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]) * 60 + Number(match[2]))
    .filter((minutes) => minutes >= 0 && minutes < 24 * 60)
    .sort((left, right) => left - right);
}

export function millisecondsUntilNextDailyRun(scheduleTimes: number[], now = new Date()): number {
  if (scheduleTimes.length === 0) throw new Error("CONTENT_INGESTION_CALENDAR_SCHEDULE_EMPTY");
  const turkeyOffsetMs = 3 * 60 * 60 * 1_000;
  const turkeyNow = new Date(now.getTime() + turkeyOffsetMs);
  const elapsedTodayMs = ((turkeyNow.getUTCHours() * 60 + turkeyNow.getUTCMinutes()) * 60 + turkeyNow.getUTCSeconds()) * 1_000
    + turkeyNow.getUTCMilliseconds();
  const todayTargetMs = scheduleTimes
    .map((minutes) => minutes * 60 * 1_000)
    .find((targetMs) => targetMs > elapsedTodayMs);
  return (todayTargetMs ?? scheduleTimes[0]! * 60 * 1_000 + 24 * 60 * 60 * 1_000) - elapsedTodayMs;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoundedPositiveInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, readPositiveInteger(value, fallback)));
}
