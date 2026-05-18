import { Inject, Injectable } from "@nestjs/common";
import type { QueueService } from "../../queue/queue.types.js";
import type { DeviceTokenRecord, NotificationJobRecord, NotificationPreferenceRecord, NotificationRepository } from "./notification.types.js";
import type { PushSender } from "./push-sender.service.js";

export interface NotificationSendResult {
  queued: number;
  sent: number;
  failed: number;
  deferred?: number;
  skipped?: number;
}

export interface NotificationWorkerProcessResult extends NotificationSendResult {
  processedJobs: number;
}

@Injectable()
export class NotificationWorkerService {
  constructor(
    @Inject("NotificationRepository") private readonly notificationRepository: NotificationRepository,
    @Inject("QueueService") private readonly queueService: QueueService,
    @Inject("PushSender") private readonly pushSender: PushSender
  ) {}

  async enqueueDueJobs(now = new Date()): Promise<number> {
    const dueJobs = await this.notificationRepository.listDueJobs(now, 100);
    for (const job of dueJobs) {
      await this.queueService.enqueue("notification_send_job", { notificationJobId: job.id, eventId: job.eventId, title: job.title }, { runAt: now });
    }
    return dueJobs.length;
  }

  async processDueJobs(now = new Date(), limit = 100): Promise<NotificationWorkerProcessResult> {
    const dueJobs = await this.notificationRepository.listDueJobs(now, limit);
    const result: NotificationWorkerProcessResult = { processedJobs: dueJobs.length, queued: 0, sent: 0, failed: 0, deferred: 0, skipped: 0 };
    for (const job of dueJobs) {
      const jobResult = await this.fanOutJob(job, now);
      result.queued += jobResult.queued;
      result.sent += jobResult.sent;
      result.failed += jobResult.failed;
      result.deferred = (result.deferred ?? 0) + (jobResult.deferred ?? 0);
      result.skipped = (result.skipped ?? 0) + (jobResult.skipped ?? 0);
    }
    return result;
  }

  async listFailedJobs(limit = 50, offset = 0) {
    return this.notificationRepository.listFailedJobs(Math.min(Math.max(limit, 1), 200), Math.max(offset, 0));
  }

  listDeliveriesByJob(jobId: string, limit = 50, offset = 0) {
    return this.notificationRepository.listDeliveriesByJob(jobId, Math.min(Math.max(limit, 1), 200), Math.max(offset, 0));
  }

  async retryFailedJob(jobId: string, runAt = new Date()) {
    return this.notificationRepository.rescheduleJob(jobId, runAt);
  }

  async markSent(job: NotificationJobRecord) {
    return this.notificationRepository.updateJobStatus(job.id, "sent");
  }

  async sendToDevice(input: { job: NotificationJobRecord; token: string; body: string; device?: DeviceTokenRecord }): Promise<NotificationSendResult> {
    const result = await this.pushSender.send({ token: input.token, title: input.job.title, body: input.body, data: { eventId: input.job.eventId, calendarId: input.job.calendarId } });
    if (result.invalidToken) {
      await this.notificationRepository.disableDeviceToken(input.token);
      await this.notificationRepository.updateJobStatus(input.job.id, "failed");
      if (input.device) await this.recordDelivery(input.job, input.device, "failed", undefined, "invalid_token");
      return { queued: 0, sent: 0, failed: 1 };
    }
    if (input.device) await this.recordDelivery(input.job, input.device, "sent", result.providerMessageId);
    await this.notificationRepository.updateJobStatus(input.job.id, "sent");
    return { queued: 0, sent: 1, failed: 0 };
  }

  private async fanOutJob(job: NotificationJobRecord, now: Date): Promise<NotificationSendResult> {
    const devices = await this.notificationRepository.listActiveDeviceTokens(1000, 0);
    let eligible = 0;
    let deferred = 0;
    let skipped = 0;
    let sent = 0;
    let failed = 0;

    for (const device of devices) {
      const preference = await this.notificationRepository.findPreferencesByUserId(device.userId);
      if (!isEligibleForJob(preference, job)) {
        await this.recordDelivery(job, device, "skipped", undefined, "preference_disabled");
        skipped += 1;
        continue;
      }
      eligible += 1;
      if (isInQuietHours(preference, now)) {
        await this.recordDelivery(job, device, "deferred", undefined, "quiet_hours");
        deferred += 1;
        continue;
      }
      const sendResult = await this.sendToDevice({ job, token: device.token, body: buildNotificationBody(job), device });
      sent += sendResult.sent;
      failed += sendResult.failed;
    }

    if (eligible === 0) {
      await this.notificationRepository.updateJobStatus(job.id, "cancelled");
      return { queued: 0, sent: 0, failed: 0, deferred: 0, skipped };
    }
    if (sent > 0) return { queued: 0, sent, failed, deferred, skipped };
    if (deferred > 0) {
      await this.notificationRepository.rescheduleJob(job.id, nextQuietHourEnd(preferenceFallbackTime(now), now));
      return { queued: 0, sent: 0, failed, deferred, skipped };
    }
    await this.notificationRepository.updateJobStatus(job.id, "failed");
    return { queued: 0, sent: 0, failed: Math.max(failed, 1), deferred, skipped };
  }

  private recordDelivery(job: NotificationJobRecord, device: DeviceTokenRecord, status: "sent" | "failed" | "deferred" | "skipped", providerMessageId?: string, failureReason?: string) {
    return this.notificationRepository.recordDelivery({
      jobId: job.id,
      userId: device.userId,
      deviceTokenId: device.id,
      token: device.token,
      status,
      ...(providerMessageId ? { providerMessageId } : {}),
      ...(failureReason ? { failureReason } : {}),
      ...(status === "sent" ? { deliveredAt: new Date() } : {})
    });
  }
}

function isEligibleForJob(preference: NotificationPreferenceRecord | null, job: NotificationJobRecord): boolean {
  if (!preference) return true;
  if (!preference.enabled) return false;
  return preference.categories[job.category] !== false;
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
  const next = new Date(now);
  next.setUTCHours(Number(hour), Number(minute), 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function preferenceFallbackTime(now: Date): string {
  const next = new Date(now);
  next.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
  return formatHourMinute(next);
}

function formatHourMinute(date: Date): string {
  return `${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}`;
}

function buildNotificationBody(job: NotificationJobRecord): string {
  return `${job.title} icin ${job.offsetDays} gun hatirlatici.`;
}
