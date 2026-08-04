import { Inject, Injectable, OnApplicationBootstrap, Optional, type BeforeApplicationShutdown, type OnApplicationShutdown } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NotificationDeliveryDto } from "../../../../../packages/shared/src/contracts.js";
import type { QueueService } from "../../queue/queue.types.js";
import type { AuthRepository, AuthUserRecord } from "../auth/auth.types.js";
import type { AnnouncementRepository } from "../announcements/announcements.types.js";
import type { CalendarRepository } from "../calendars/calendar.types.js";
import { announcementDestinationFingerprint, calendarDestinationFingerprint } from "./notification-destination.js";
import { NOTIFICATION_DELIVERY_CONSENT_VERSION } from "./notification.types.js";
import type { DeviceTokenRecord, NotificationDeliveryFailureReason, NotificationJobRecord, NotificationPreferenceRecord, NotificationRepository } from "./notification.types.js";
import type { PushSender } from "./push-sender.service.js";

export const ACADEMIC_REMINDERS_ANDROID_CHANNEL_ID = "academic-reminders";
export const ACADEMIC_UPDATES_ANDROID_CHANNEL_ID = "academic-updates";
export const NOTIFICATION_DESTINATION_SCHEMA_VERSION = "1";
export const GENERIC_PUSH_NOTIFICATION_TITLE = "Yeni bildirim";
export const GENERIC_PUSH_NOTIFICATION_BODY = "Ayrıntıları görmek için uygulamayı açın.";
export const NOTIFICATION_JOB_CLAIM_LEASE_MS = 10 * 60 * 1000;

export interface NotificationSendResult {
  queued: number;
  sent: number;
  failed: number;
  deferred?: number;
  skipped?: number;
  retryableFailureReason?: "provider_unavailable" | "provider_rejected";
}

export interface NotificationWorkerProcessResult extends NotificationSendResult {
  processedJobs: number;
}

type NotificationWorkerLifecycleState = "disabled" | "starting" | "ready" | "running" | "draining" | "degraded";

@Injectable()
export class NotificationWorkerService implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private activeCycle: Promise<void> | null = null;
  private acceptingCycles = false;
  private lifecycleState: NotificationWorkerLifecycleState = "disabled";
  private lastCycleStartedAt?: Date;
  private lastCycleCompletedAt?: Date;
  private lastCycleFailureAt?: Date;
  private consecutiveCycleFailures = 0;
  private lastErrorCode?: "NOTIFICATION_WORKER_CYCLE_FAILED";
  private backlog = { due: 0, retrying: 0, processing: 0, dead: 0 };
  private backlogObservedAt?: Date;

  constructor(
    @Inject("NotificationRepository") private readonly notificationRepository: NotificationRepository,
    @Inject("QueueService") private readonly queueService: QueueService,
    @Inject("PushSender") private readonly pushSender: PushSender,
    @Optional() @Inject("AuthRepository") private readonly authRepository?: Pick<AuthRepository, "findUserById">,
    @Optional() @Inject("AnnouncementRepository") private readonly announcementRepository?: AnnouncementRepository,
    @Optional() @Inject("CalendarRepository") private readonly calendarRepository?: CalendarRepository
  ) {}

  onApplicationBootstrap(): void {
    const explicitlyEnabled = process.env.NOTIFICATION_WORKER_ENABLED === "true";
    if (process.env.NOTIFICATION_WORKER_ENABLED === "false" || (process.env.NODE_ENV === "test" && !explicitlyEnabled)) {
      this.lifecycleState = "disabled";
      return;
    }
    this.acceptingCycles = true;
    this.lifecycleState = "starting";
    this.scheduleCycle(readPositiveInteger(process.env.NOTIFICATION_WORKER_INITIAL_DELAY_MS, 5_000));
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.acceptingCycles = false;
    this.lifecycleState = "draining";
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.activeCycle) await this.activeCycle;
  }

  onApplicationShutdown(): void {
    this.acceptingCycles = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.lifecycleState === "draining") this.lifecycleState = "disabled";
  }

  health(): {
    enabled: boolean;
    state: NotificationWorkerLifecycleState;
    running: boolean;
    consecutiveFailures: number;
    lastStartedAt?: string;
    lastCompletedAt?: string;
    lastSuccessAt?: string;
    lastFailureAt?: string;
    lastErrorAt?: string;
    lastErrorCode?: "NOTIFICATION_WORKER_CYCLE_FAILED";
    backlog: { due: number; retrying: number; processing: number; dead: number; observedAt?: string };
  } {
    return {
      enabled: this.acceptingCycles || this.lifecycleState !== "disabled",
      state: this.lifecycleState,
      running: Boolean(this.activeCycle),
      consecutiveFailures: this.consecutiveCycleFailures,
      ...(this.lastCycleStartedAt ? { lastStartedAt: this.lastCycleStartedAt.toISOString() } : {}),
      ...(this.lastCycleCompletedAt ? { lastCompletedAt: this.lastCycleCompletedAt.toISOString() } : {}),
      ...(this.lastCycleCompletedAt ? { lastSuccessAt: this.lastCycleCompletedAt.toISOString() } : {}),
      ...(this.lastCycleFailureAt ? { lastFailureAt: this.lastCycleFailureAt.toISOString() } : {}),
      ...(this.lastCycleFailureAt ? { lastErrorAt: this.lastCycleFailureAt.toISOString() } : {}),
      ...(this.lastErrorCode ? { lastErrorCode: this.lastErrorCode } : {}),
      backlog: {
        ...this.backlog,
        ...(this.backlogObservedAt ? { observedAt: this.backlogObservedAt.toISOString() } : {})
      }
    };
  }

  async enqueueDueJobs(now = new Date()): Promise<number> {
    const dueJobs = await this.notificationRepository.listDueJobs(now, 100);
    for (const job of dueJobs) {
      await this.queueService.enqueue("notification_send_job", { notificationJobId: job.id }, { runAt: now });
    }
    return dueJobs.length;
  }

  async processDueJobs(now = new Date(), limit = 100): Promise<NotificationWorkerProcessResult> {
    const dueJobs = await this.notificationRepository.listDueJobs(now, limit);
    const result: NotificationWorkerProcessResult = { processedJobs: 0, queued: 0, sent: 0, failed: 0, deferred: 0, skipped: 0 };
    for (const candidate of dueJobs) {
      const claimId = randomUUID();
      const job = await this.notificationRepository.claimDueJob(
        candidate.id,
        now,
        claimId,
        new Date(now.getTime() + NOTIFICATION_JOB_CLAIM_LEASE_MS)
      );
      if (!job) continue;
      result.processedJobs += 1;
      try {
        const jobResult = await this.fanOutJob(job, now, claimId);
        result.queued += jobResult.queued;
        result.sent += jobResult.sent;
        result.failed += jobResult.failed;
        result.deferred = (result.deferred ?? 0) + (jobResult.deferred ?? 0);
        result.skipped = (result.skipped ?? 0) + (jobResult.skipped ?? 0);
      } catch {
        result.failed += 1;
        try {
          await this.notificationRepository.failClaimedJob({
            jobId: job.id,
            claimId,
            revision: job.revision,
            failedAt: now,
            retryAt: notificationRetryAt(job, now),
            reason: "worker_interrupted"
          });
        } catch {
          // The claim remains recoverable by its lease when persistence is unavailable.
        }
      }
    }
    return result;
  }

  async listFailedJobs(limit = 50, offset = 0) {
    return this.notificationRepository.listFailedJobs(Math.min(Math.max(limit, 1), 200), Math.max(offset, 0));
  }

  async listDeliveriesByJob(jobId: string, limit = 50, offset = 0): Promise<NotificationDeliveryDto[]> {
    const deliveries = await this.notificationRepository.listDeliveriesByJob(jobId, Math.min(Math.max(limit, 1), 200), Math.max(offset, 0));
    return deliveries.map((delivery) => ({
      id: delivery.id,
      jobId: delivery.jobId,
      userId: delivery.userId,
      deviceTokenId: delivery.deviceTokenId,
      status: delivery.status,
      ...(delivery.providerMessageId ? { providerMessageId: delivery.providerMessageId } : {}),
      ...(delivery.failureReason ? { failureReason: delivery.failureReason } : {}),
      ...(delivery.deliveredAt ? { deliveredAt: delivery.deliveredAt.toISOString() } : {}),
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString()
    }));
  }

  async retryFailedJob(jobId: string, runAt = new Date()) {
    return this.notificationRepository.rescheduleJob(jobId, runAt);
  }

  async markSent(job: NotificationJobRecord) {
    return this.notificationRepository.updateJobStatus(job.id, "sent");
  }

  async sendToDevice(input: { job: NotificationJobRecord; token: string; device: DeviceTokenRecord }): Promise<NotificationSendResult> {
    const result = await this.attemptDeviceDelivery(input);
    if (result.sent > 0) {
      await this.notificationRepository.updateJobStatus(input.job.id, "sent");
    } else if (result.failed > 0) {
      await this.notificationRepository.updateJobStatus(input.job.id, "failed");
    } else if ((result.skipped ?? 0) > 0) {
      await this.notificationRepository.updateJobStatus(input.job.id, "cancelled");
    }
    return result;
  }

  async retireStaleJobs(limit = 500): Promise<number> {
    let retired = 0;
    const pageSize = Math.min(Math.max(limit, 1), 500);
    let offset = 0;
    while (true) {
      const jobs = await this.notificationRepository.listJobsForDestinationValidation(pageSize, offset);
      if (jobs.length === 0) break;
      let retainedInPage = 0;
      for (const job of jobs) {
        if (await this.isCurrentTrustedDestination(job)) {
          retainedInPage += 1;
          continue;
        }
        const cancelled = await this.notificationRepository.updateJobStatus(job.id, "cancelled");
        if (cancelled) retired += 1;
        else retainedInPage += 1;
      }
      offset += retainedInPage;
      if (jobs.length < pageSize) break;
    }
    return retired;
  }

  private async attemptDeviceDelivery(input: { job: NotificationJobRecord; token: string; device: DeviceTokenRecord; claimId?: string }): Promise<NotificationSendResult> {
    const destination = notificationDestination(input.job);
    if (!destination) {
      await this.recordDelivery(input.job, input.device, "skipped", undefined, "destination_unavailable");
      return { queued: 0, sent: 0, failed: 0, skipped: 1 };
    }
    const currentDevice = await this.notificationRepository.findActiveDeviceTokenById(input.device.id);
    if (!isSameDeviceRegistration(input.device, currentDevice, input.token)) {
      await this.recordDelivery(input.job, input.device, "skipped", undefined, "device_registration_stale");
      return { queued: 0, sent: 0, failed: 0, skipped: 1 };
    }
    if (!await this.isCurrentTrustedDestination(input.job)) {
      await this.recordDelivery(input.job, input.device, "skipped", undefined, "destination_unavailable");
      return { queued: 0, sent: 0, failed: 0, skipped: 1 };
    }
    if (input.claimId && !await this.notificationRepository.renewClaimedJob(
      input.job.id,
      input.claimId,
      input.job.revision,
      new Date(Date.now() + NOTIFICATION_JOB_CLAIM_LEASE_MS)
    )) {
      return { queued: 0, sent: 0, failed: 0, skipped: 1 };
    }
    const result = await this.pushSender.send({
      token: currentDevice.token,
      title: GENERIC_PUSH_NOTIFICATION_TITLE,
      body: GENERIC_PUSH_NOTIFICATION_BODY,
      androidChannelId: destination.type === "announcement"
        ? ACADEMIC_UPDATES_ANDROID_CHANNEL_ID
        : ACADEMIC_REMINDERS_ANDROID_CHANNEL_ID,
      data: {
        schemaVersion: NOTIFICATION_DESTINATION_SCHEMA_VERSION,
        destinationType: destination.type,
        destinationId: destination.id,
        recipientOwnerId: currentDevice.userId
      }
    }).catch(async () => {
      await this.recordDelivery(input.job, input.device, "failed", undefined, "provider_unavailable");
      return null;
    });
    if (!result) return { queued: 0, sent: 0, failed: 1, retryableFailureReason: "provider_unavailable" };
    if (result.status === "invalid_token") {
      await this.notificationRepository.disableDeviceToken(input.token);
      await this.recordDelivery(input.job, input.device, "failed", undefined, "invalid_token");
      return { queued: 0, sent: 0, failed: 1 };
    }
    if (result.status === "failed") {
      await this.recordDelivery(input.job, input.device, "failed", undefined, result.reason);
      return { queued: 0, sent: 0, failed: 1, retryableFailureReason: result.reason };
    }
    await this.recordDelivery(input.job, input.device, "sent", result.providerMessageId);
    return { queued: 0, sent: 1, failed: 0 };
  }

  private async fanOutJob(job: NotificationJobRecord, now: Date, claimId: string): Promise<NotificationSendResult> {
    if (!await this.isCurrentTrustedDestination(job)) {
      await this.notificationRepository.completeClaimedJob(job.id, claimId, "cancelled");
      return { queued: 0, sent: 0, failed: 0, skipped: 1 };
    }
    const [devices, sentDeviceTokenIds] = await Promise.all([
      this.listAllActiveDeviceTokens(),
      this.notificationRepository.listSentDeviceTokenIdsForJob(job.id, job.revision)
    ]);
    const alreadySent = new Set(sentDeviceTokenIds);
    let eligible = 0;
    let deferred = 0;
    let skipped = 0;
    let sent = 0;
    let failed = 0;
    let retryableFailureReason: NotificationSendResult["retryableFailureReason"];
    let quietRescheduleAt: Date | undefined;

    for (const device of devices) {
      if (alreadySent.has(device.id)) continue;
      const user = await this.findDeviceUser(device);
      if (!isUserInJobScope(user, job)) {
        await this.recordDelivery(job, device, "skipped", undefined, "scope_mismatch");
        skipped += 1;
        continue;
      }
      const preference = await this.notificationRepository.findPreferencesByUserId(device.userId);
      if (!isEligibleForJob(preference, job)) {
        await this.recordDelivery(job, device, "skipped", undefined, "preference_disabled");
        skipped += 1;
        continue;
      }
      eligible += 1;
      if (isInQuietHours(preference, now)) {
        await this.recordDelivery(job, device, "deferred", undefined, "quiet_hours");
        quietRescheduleAt = minDate(quietRescheduleAt, nextQuietHourEnd(preference?.quietHours?.end ?? preferenceFallbackTime(now), now));
        deferred += 1;
        continue;
      }
      const sendResult = await this.attemptDeviceDelivery({ job, token: device.token, device, claimId });
      sent += sendResult.sent;
      failed += sendResult.failed;
      skipped += sendResult.skipped ?? 0;
      retryableFailureReason ??= sendResult.retryableFailureReason;
    }

    if (retryableFailureReason) {
      await this.notificationRepository.failClaimedJob({
        jobId: job.id,
        claimId,
        revision: job.revision,
        failedAt: now,
        retryAt: notificationRetryAt(job, now),
        reason: retryableFailureReason
      });
      return { queued: 0, sent, failed, deferred, skipped, retryableFailureReason };
    }
    if (deferred > 0) {
      await this.notificationRepository.rescheduleClaimedJob(
        job.id,
        claimId,
        quietRescheduleAt ?? nextQuietHourEnd(preferenceFallbackTime(now), now)
      );
      return { queued: 0, sent, failed: 0, deferred, skipped };
    }
    if (sent > 0 || alreadySent.size > 0) {
      await this.notificationRepository.completeClaimedJob(job.id, claimId, "sent");
      return { queued: 0, sent, failed: 0, deferred: 0, skipped };
    }
    if (eligible === 0 || skipped > 0 || failed > 0) {
      await this.notificationRepository.completeClaimedJob(job.id, claimId, "cancelled");
      return { queued: 0, sent: 0, failed: 0, deferred, skipped };
    }
    await this.notificationRepository.completeClaimedJob(job.id, claimId, "failed");
    return { queued: 0, sent: 0, failed: 1, deferred, skipped };
  }

  private async listAllActiveDeviceTokens(): Promise<DeviceTokenRecord[]> {
    const devicesById = new Map<string, DeviceTokenRecord>();
    let offset = 0;
    while (true) {
      const page = await this.notificationRepository.listActiveDeviceTokens(ACTIVE_DEVICE_PAGE_SIZE, offset);
      for (const device of page) devicesById.set(device.id, device);
      offset += page.length;
      if (page.length < ACTIVE_DEVICE_PAGE_SIZE) break;
    }
    return [...devicesById.values()];
  }

  private async isCurrentTrustedDestination(job: NotificationJobRecord): Promise<boolean> {
    const destination = notificationDestination(job);
    if (!destination) return false;
    if (destination.type === "announcement") {
      if (!this.announcementRepository) return process.env.NODE_ENV === "test" && !job.destinationFingerprint;
      if (!hasExactDestinationMetadata(job) && !isOwnerBoundManualAlarm(job)) return false;
      const scopeType = job.destinationScopeType;
      const scopeId = job.destinationScopeId;
      const match = await this.announcementRepository.findTrustedItemByIdInScope({
        announcementId: destination.id,
        universityId: scopeType === "university" && scopeId ? scopeId : job.universityId,
        ...(scopeType === "faculty" && scopeId ? { facultyId: scopeId } : job.facultyId ? { facultyId: job.facultyId } : {}),
        ...(scopeType === "department" && scopeId ? { departmentId: scopeId } : job.departmentId ? { departmentId: job.departmentId } : {})
      });
      if (!match) return false;
      if (scopeType && scopeType !== "global" && (match.source.scopeType !== scopeType || match.source.scopeId !== scopeId)) return false;
      return !job.destinationFingerprint || announcementDestinationFingerprint(match.item, match.source) === job.destinationFingerprint;
    }
    if (!this.calendarRepository) return process.env.NODE_ENV === "test" && !job.destinationFingerprint;
    if (!hasExactDestinationMetadata(job) && !isOwnerBoundManualAlarm(job)) return false;
    const event = await this.calendarRepository.findPublishedEventById(destination.id);
    if (!event) return false;
    if (event.universityId !== job.universityId) return false;
    if (job.facultyId && event.facultyId !== job.facultyId) return false;
    if (job.departmentId && event.departmentId !== job.departmentId) return false;
    return !job.destinationFingerprint || calendarDestinationFingerprint(event) === job.destinationFingerprint;
  }

  private scheduleCycle(delayMs: number): void {
    if (!this.acceptingCycles || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.acceptingCycles || this.activeCycle) return;
      const cycle = this.runAutomaticCycle();
      this.activeCycle = cycle;
      void cycle.finally(() => {
        if (this.activeCycle === cycle) this.activeCycle = null;
        if (this.acceptingCycles) this.scheduleCycle(readPositiveInteger(process.env.NOTIFICATION_WORKER_INTERVAL_MS, 30_000));
      });
    }, delayMs);
    this.timer.unref?.();
  }

  private async runAutomaticCycle(): Promise<void> {
    this.lifecycleState = "running";
    this.lastCycleStartedAt = new Date();
    try {
      await this.retireStaleJobs(readPositiveInteger(process.env.NOTIFICATION_WORKER_VALIDATION_LIMIT, 500));
      await this.processDueJobs(new Date(), readPositiveInteger(process.env.NOTIFICATION_WORKER_BATCH_SIZE, 100));
      this.backlog = await this.notificationRepository.getWorkerBacklog(new Date());
      this.backlogObservedAt = new Date();
      this.lastCycleCompletedAt = new Date();
      this.consecutiveCycleFailures = 0;
      delete this.lastErrorCode;
      if (this.acceptingCycles) this.lifecycleState = "ready";
    } catch {
      this.lastCycleFailureAt = new Date();
      this.consecutiveCycleFailures += 1;
      this.lastErrorCode = "NOTIFICATION_WORKER_CYCLE_FAILED";
      if (this.acceptingCycles) this.lifecycleState = "degraded";
    }
  }

  private recordDelivery(job: NotificationJobRecord, device: DeviceTokenRecord, status: "sent" | "failed" | "deferred" | "skipped", providerMessageId?: string, failureReason?: NotificationDeliveryFailureReason) {
    return this.notificationRepository.recordDelivery({
      jobId: job.id,
      jobRevision: job.revision,
      userId: device.userId,
      deviceTokenId: device.id,
      status,
      ...(providerMessageId ? { providerMessageId } : {}),
      ...(failureReason ? { failureReason } : {}),
      ...(status === "sent" ? { deliveredAt: new Date() } : {})
    });
  }

  private findDeviceUser(device: DeviceTokenRecord): Promise<AuthUserRecord | null> {
    return this.authRepository?.findUserById(device.userId) ?? Promise.resolve(null);
  }
}

function isUserInJobScope(user: AuthUserRecord | null, job: NotificationJobRecord): boolean {
  if (job.userId) return Boolean(user && user.id === job.userId && user.status === "active" && user.role === "student");
  if (!user) return false;
  if (user.status !== "active" || user.role !== "student") return false;
  if (job.universityId === "*") {
    if (job.departmentId) {
      return job.destinationScopeType === "department"
        && job.destinationScopeId === job.departmentId
        && user.departmentId === job.departmentId;
    }
    if (job.facultyId) {
      return job.destinationScopeType === "faculty"
        && job.destinationScopeId === job.facultyId
        && user.facultyId === job.facultyId;
    }
    return job.category === "yok_event"
      && job.destinationScopeType === "university"
      && job.destinationScopeId === YOK_SCOPE_ID;
  }
  if (user.universityId !== job.universityId) return false;
  if (job.departmentId) return user.departmentId === job.departmentId;
  if (job.facultyId) return user.facultyId === job.facultyId;
  return true;
}

function isEligibleForJob(preference: NotificationPreferenceRecord | null, job: NotificationJobRecord): boolean {
  if (!preference) return false;
  if (!preference.enabled) return false;
  if (preference.deliveryConsentVersion !== NOTIFICATION_DELIVERY_CONSENT_VERSION) return false;
  if (preference.categories[job.category] === false) return false;
  if (preference.reminderRules?.length) return preference.reminderRules.some((rule) => rule.enabled && reminderRuleMatchesJob(rule, job));
  return !job.offsetHours && preference.reminderOffsets.includes(job.offsetDays);
}

function reminderRuleMatchesJob(rule: NonNullable<NotificationPreferenceRecord["reminderRules"]>[number], job: NotificationJobRecord): boolean {
  if (rule.trigger !== job.trigger) return false;
  if (rule.unit === "hours") return (job.offsetHours ?? 0) === rule.amount;
  return !job.offsetHours && job.offsetDays === rule.amount;
}

function isInQuietHours(preference: NotificationPreferenceRecord | null, now: Date): boolean {
  if (!preference?.quietHours?.enabled) return false;
  const current = formatHourMinute(now);
  const { start, end } = preference.quietHours;
  if (start <= end) return current >= start && current < end;
  return current >= start || current < end;
}

function nextQuietHourEnd(end: string, now: Date): Date {
  const [hour = "0", minute = "0"] = end.split(":");
  const next = new Date(now.getTime() + turkeyUtcOffsetMs);
  next.setUTCHours(Number(hour), Number(minute), 0, 0);
  const nowInTurkey = new Date(now.getTime() + turkeyUtcOffsetMs);
  if (next <= nowInTurkey) next.setUTCDate(next.getUTCDate() + 1);
  return new Date(next.getTime() - turkeyUtcOffsetMs);
}

function preferenceFallbackTime(now: Date): string {
  const next = new Date(now);
  next.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
  return formatHourMinute(next);
}

function formatHourMinute(date: Date): string {
  const turkeyDate = new Date(date.getTime() + turkeyUtcOffsetMs);
  return `${turkeyDate.getUTCHours().toString().padStart(2, "0")}:${turkeyDate.getUTCMinutes().toString().padStart(2, "0")}`;
}

function minDate(left: Date | undefined, right: Date): Date {
  return !left || right < left ? right : left;
}

const turkeyUtcOffsetMs = 3 * 60 * 60 * 1000;
const YOK_SCOPE_ID = "yok-council-of-higher-education";
const ACTIVE_DEVICE_PAGE_SIZE = 1000;

function notificationRetryAt(job: NotificationJobRecord, failedAt: Date): Date {
  const baseDelayMs = readPositiveInteger(process.env.NOTIFICATION_RETRY_BASE_DELAY_MS, 60_000);
  const maximumDelayMs = readPositiveInteger(process.env.NOTIFICATION_RETRY_MAX_DELAY_MS, 60 * 60 * 1000);
  const delayMs = Math.min(maximumDelayMs, baseDelayMs * (2 ** Math.min(job.attemptCount, 10)));
  return new Date(failedAt.getTime() + delayMs);
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function notificationDestination(job: NotificationJobRecord): { type: "calendar_event" | "announcement"; id: string } | null {
  if ((job.destinationType !== "calendar_event" && job.destinationType !== "announcement") || !job.destinationId?.trim()) return null;
  return { type: job.destinationType, id: job.destinationId };
}

function hasExactDestinationMetadata(job: NotificationJobRecord): boolean {
  return Boolean(job.destinationScopeType && job.destinationScopeId?.trim() && job.destinationFingerprint?.trim());
}

function isOwnerBoundManualAlarm(job: NotificationJobRecord): boolean {
  return Boolean(job.userId && job.alarmId);
}

function isSameDeviceRegistration(
  expected: DeviceTokenRecord,
  current: DeviceTokenRecord | null,
  expectedToken: string
): current is DeviceTokenRecord {
  return Boolean(
    current
    && current.id === expected.id
    && current.userId === expected.userId
    && current.token === expected.token
    && current.token === expectedToken
    && current.installationHash === expected.installationHash
  );
}
