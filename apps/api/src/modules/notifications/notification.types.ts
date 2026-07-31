import type { AcademicEventCategory } from "../../domain/academic-event.types.js";
import type { NotificationRuleTrigger } from "../calendars/calendar.types.js";
export { NOTIFICATION_DELIVERY_CONSENT_VERSION } from "../../../../../packages/shared/src/contracts.js";

export type DevicePlatform = "ios" | "android" | "web";
export type DeviceTokenStatus = "active" | "disabled";
export type NotificationJobStatus = "scheduled" | "processing" | "sent" | "failed" | "cancelled";
export type NotificationDeliveryStatus = "sent" | "failed" | "deferred" | "skipped";
export type NotificationDestinationType = "calendar_event" | "announcement";
export type NotificationDeliveryFailureReason =
  | "invalid_token"
  | "provider_unavailable"
  | "provider_rejected"
  | "scope_mismatch"
  | "preference_disabled"
  | "quiet_hours"
  | "destination_unavailable"
  | "device_registration_stale";
export type StudentAlarmEventType = "exam" | "calendar_event" | "announcement" | "course";
export type StudentAlarmTrigger = "at_time" | "before";
export type StudentAlarmStatus = "scheduled" | "cancelled";
export type NotificationEventType =
  | AcademicEventCategory
  | "announcement"
  | "faculty_announcement"
  | "department_announcement"
  | "course"
  | "course_schedule"
  | "department_exam_schedule"
  | "yok_event";
export type ReminderRuleUnit = "days" | "hours";

export interface ReminderPreferenceRuleRecord {
  trigger: NotificationRuleTrigger;
  amount: number;
  unit: ReminderRuleUnit;
  enabled: boolean;
}

export interface DeviceTokenRecord {
  id: string;
  userId: string;
  platform: DevicePlatform;
  token: string;
  /** Missing only on legacy records, which are never eligible for delivery. */
  installationHash?: string;
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
  /** Missing or stale values are legacy data and are never delivery eligible. */
  deliveryConsentVersion?: string;
  categories: Partial<Record<NotificationEventType | string, boolean>>;
  reminderOffsets: number[];
  reminderRules?: ReminderPreferenceRuleRecord[];
  quietHours?: QuietHoursRecord;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationJobRecord {
  id: string;
  calendarId: string;
  eventId: string;
  destinationType?: NotificationDestinationType;
  destinationId?: string;
  userId?: string;
  alarmId?: string;
  eventType?: StudentAlarmEventType;
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  title: string;
  category: NotificationEventType;
  offsetDays: number;
  offsetHours?: number;
  trigger: NotificationRuleTrigger;
  scheduledAt: Date;
  status: NotificationJobStatus;
  processingClaimId?: string;
  processingLeaseUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudentAlarmRecord {
  id: string;
  userId: string;
  eventType: StudentAlarmEventType;
  targetId: string;
  title: string;
  scheduledFor: Date;
  trigger: StudentAlarmTrigger;
  amount: number;
  unit: ReminderRuleUnit;
  scheduledAt: Date;
  timezone: "Europe/Istanbul";
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  sourceUrl?: string;
  status: StudentAlarmStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationDeliveryRecord {
  id: string;
  jobId: string;
  userId: string;
  deviceTokenId: string;
  status: NotificationDeliveryStatus;
  providerMessageId?: string;
  failureReason?: NotificationDeliveryFailureReason;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type DeviceTokenRegistrationInput = {
  userId: string;
  platform: DevicePlatform;
  token: string;
  installationHash: string;
};

export class DeviceRegistrationConflictError extends Error {
  constructor() {
    super("DEVICE_REGISTRATION_OWNERSHIP_CONFLICT");
    this.name = "DeviceRegistrationConflictError";
  }
}

export interface NotificationRepository {
  upsertDeviceToken(input: DeviceTokenRegistrationInput): Promise<DeviceTokenRecord>;
  disableDeviceInstallation(userId: string, installationHash: string): Promise<DeviceTokenRecord | null>;
  findActiveDeviceTokenById(deviceTokenId: string): Promise<DeviceTokenRecord | null>;
  findPreferencesByUserId(userId: string): Promise<NotificationPreferenceRecord | null>;
  upsertPreferences(input: Omit<NotificationPreferenceRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationPreferenceRecord>;
  createNotificationJobs(input: Array<Omit<NotificationJobRecord, "id" | "createdAt" | "updatedAt">>): Promise<NotificationJobRecord[]>;
  createStudentAlarm(input: Omit<StudentAlarmRecord, "id" | "createdAt" | "updatedAt">): Promise<StudentAlarmRecord>;
  listStudentAlarmsByUser(userId: string): Promise<StudentAlarmRecord[]>;
  cancelStudentAlarm(userId: string, alarmId: string): Promise<StudentAlarmRecord | null>;
  listJobsByCalendar(calendarId: string): Promise<NotificationJobRecord[]>;
  listDueJobs(now: Date, limit: number): Promise<NotificationJobRecord[]>;
  claimDueJob(jobId: string, now: Date, claimId: string, leaseUntil: Date): Promise<NotificationJobRecord | null>;
  completeClaimedJob(jobId: string, claimId: string, status: "sent" | "failed" | "cancelled"): Promise<NotificationJobRecord | null>;
  rescheduleClaimedJob(jobId: string, claimId: string, scheduledAt: Date): Promise<NotificationJobRecord | null>;
  listFailedJobs(limit: number, offset: number): Promise<NotificationJobRecord[]>;
  listActiveDeviceTokens(limit: number, offset: number): Promise<DeviceTokenRecord[]>;
  listSentDeviceTokenIdsForJob(jobId: string): Promise<string[]>;
  recordDelivery(input: Omit<NotificationDeliveryRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationDeliveryRecord>;
  listDeliveriesByJob(jobId: string, limit: number, offset: number): Promise<NotificationDeliveryRecord[]>;
  updateJobStatus(jobId: string, status: NotificationJobStatus): Promise<NotificationJobRecord | null>;
  rescheduleJob(jobId: string, scheduledAt: Date): Promise<NotificationJobRecord | null>;
  disableDeviceToken(token: string): Promise<DeviceTokenRecord | null>;
  deleteUserData(userId: string): Promise<void>;
}
