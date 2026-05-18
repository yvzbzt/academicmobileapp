import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { DeviceTokenRecord, NotificationDeliveryRecord, NotificationJobRecord, NotificationJobStatus, NotificationPreferenceRecord, NotificationRepository } from "./notification.types.js";

@Injectable()
export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly deviceTokens = new Map<string, DeviceTokenRecord>();
  private readonly preferences = new Map<string, NotificationPreferenceRecord>();
  private readonly jobs = new Map<string, NotificationJobRecord>();
  private readonly deliveries = new Map<string, NotificationDeliveryRecord>();

  async upsertDeviceToken(input: Omit<DeviceTokenRecord, "id" | "createdAt" | "updatedAt" | "lastSeenAt" | "status">): Promise<DeviceTokenRecord> {
    const now = new Date();
    const existing = [...this.deviceTokens.values()].find((device) => device.token === input.token);
    const device: DeviceTokenRecord = {
      ...(existing ?? { id: randomUUID(), createdAt: now }),
      userId: input.userId,
      platform: input.platform,
      token: input.token,
      status: "active",
      lastSeenAt: now,
      updatedAt: now
    };
    this.deviceTokens.set(device.id, device);
    return device;
  }

  async findPreferencesByUserId(userId: string): Promise<NotificationPreferenceRecord | null> {
    return this.preferences.get(userId) ?? null;
  }

  async upsertPreferences(input: Omit<NotificationPreferenceRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationPreferenceRecord> {
    const now = new Date();
    const existing = this.preferences.get(input.userId);
    const preferences: NotificationPreferenceRecord = {
      ...(existing ?? { id: randomUUID(), createdAt: now }),
      userId: input.userId,
      enabled: input.enabled,
      categories: input.categories,
      reminderOffsets: [...new Set(input.reminderOffsets)].sort((left, right) => right - left),
      ...(input.quietHours ? { quietHours: input.quietHours } : {}),
      updatedAt: now
    };
    this.preferences.set(input.userId, preferences);
    return preferences;
  }

  async createNotificationJobs(input: Array<Omit<NotificationJobRecord, "id" | "createdAt" | "updatedAt">>): Promise<NotificationJobRecord[]> {
    const now = new Date();
    const created: NotificationJobRecord[] = [];
    for (const jobInput of input) {
      const existing = [...this.jobs.values()].find((job) => job.eventId === jobInput.eventId && job.offsetDays === jobInput.offsetDays && job.status !== "cancelled");
      if (existing) continue;
      const job: NotificationJobRecord = { ...jobInput, id: randomUUID(), createdAt: now, updatedAt: now };
      this.jobs.set(job.id, job);
      created.push(job);
    }
    return created;
  }

  async listJobsByCalendar(calendarId: string): Promise<NotificationJobRecord[]> {
    return [...this.jobs.values()].filter((job) => job.calendarId === calendarId).sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());
  }

  async listDueJobs(now: Date, limit: number): Promise<NotificationJobRecord[]> {
    return [...this.jobs.values()]
      .filter((job) => job.status === "scheduled" && job.scheduledAt <= now)
      .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime())
      .slice(0, limit);
  }

  async listFailedJobs(limit: number, offset: number): Promise<NotificationJobRecord[]> {
    return [...this.jobs.values()]
      .filter((job) => job.status === "failed")
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(offset, offset + limit);
  }

  async listActiveDeviceTokens(limit: number, offset: number): Promise<DeviceTokenRecord[]> {
    return [...this.deviceTokens.values()]
      .filter((device) => device.status === "active")
      .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
      .slice(offset, offset + limit);
  }

  async recordDelivery(input: Omit<NotificationDeliveryRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationDeliveryRecord> {
    const now = new Date();
    const delivery: NotificationDeliveryRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.deliveries.set(delivery.id, delivery);
    return delivery;
  }

  async listDeliveriesByJob(jobId: string, limit: number, offset: number): Promise<NotificationDeliveryRecord[]> {
    return [...this.deliveries.values()]
      .filter((delivery) => delivery.jobId === jobId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(offset, offset + limit);
  }

  async updateJobStatus(jobId: string, status: NotificationJobStatus): Promise<NotificationJobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const updated: NotificationJobRecord = { ...job, status, updatedAt: new Date() };
    this.jobs.set(jobId, updated);
    return updated;
  }

  async rescheduleJob(jobId: string, scheduledAt: Date): Promise<NotificationJobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const updated: NotificationJobRecord = { ...job, status: "scheduled", scheduledAt, updatedAt: new Date() };
    this.jobs.set(jobId, updated);
    return updated;
  }

  async disableDeviceToken(token: string): Promise<DeviceTokenRecord | null> {
    const device = [...this.deviceTokens.values()].find((record) => record.token === token);
    if (!device) return null;
    const updated: DeviceTokenRecord = { ...device, status: "disabled", updatedAt: new Date() };
    this.deviceTokens.set(device.id, updated);
    return updated;
  }
}
