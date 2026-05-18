import type { AcademicEventCategory } from "../../domain/academic-event.types.js";

export type DevicePlatform = "ios" | "android" | "web";
export type DeviceTokenStatus = "active" | "disabled";
export type NotificationJobStatus = "scheduled" | "sent" | "failed" | "cancelled";
export type NotificationDeliveryStatus = "sent" | "failed" | "deferred" | "skipped";

export interface DeviceTokenRecord {
  id: string;
  userId: string;
  platform: DevicePlatform;
  token: string;
  status: DeviceTokenStatus;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuietHoursRecord {
  enabled: boolean;
  start: string;
  end: string;
  timezone: "Europe/Istanbul";
}

export interface NotificationPreferenceRecord {
  id: string;
  userId: string;
  enabled: boolean;
  categories: Partial<Record<AcademicEventCategory, boolean>>;
  reminderOffsets: number[];
  quietHours?: QuietHoursRecord;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationJobRecord {
  id: string;
  calendarId: string;
  eventId: string;
  universityId: string;
  title: string;
  category: AcademicEventCategory;
  offsetDays: number;
  scheduledAt: Date;
  status: NotificationJobStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationDeliveryRecord {
  id: string;
  jobId: string;
  userId: string;
  deviceTokenId: string;
  token: string;
  status: NotificationDeliveryStatus;
  providerMessageId?: string;
  failureReason?: string;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationRepository {
  upsertDeviceToken(input: Omit<DeviceTokenRecord, "id" | "createdAt" | "updatedAt" | "lastSeenAt" | "status">): Promise<DeviceTokenRecord>;
  findPreferencesByUserId(userId: string): Promise<NotificationPreferenceRecord | null>;
  upsertPreferences(input: Omit<NotificationPreferenceRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationPreferenceRecord>;
  createNotificationJobs(input: Array<Omit<NotificationJobRecord, "id" | "createdAt" | "updatedAt">>): Promise<NotificationJobRecord[]>;
  listJobsByCalendar(calendarId: string): Promise<NotificationJobRecord[]>;
  listDueJobs(now: Date, limit: number): Promise<NotificationJobRecord[]>;
  listFailedJobs(limit: number, offset: number): Promise<NotificationJobRecord[]>;
  listActiveDeviceTokens(limit: number, offset: number): Promise<DeviceTokenRecord[]>;
  recordDelivery(input: Omit<NotificationDeliveryRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationDeliveryRecord>;
  listDeliveriesByJob(jobId: string, limit: number, offset: number): Promise<NotificationDeliveryRecord[]>;
  updateJobStatus(jobId: string, status: NotificationJobStatus): Promise<NotificationJobRecord | null>;
  rescheduleJob(jobId: string, scheduledAt: Date): Promise<NotificationJobRecord | null>;
  disableDeviceToken(token: string): Promise<DeviceTokenRecord | null>;
}
