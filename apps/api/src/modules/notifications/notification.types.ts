import type { AcademicEventCategory } from "../../domain/academic-event.types.js";
import type { NotificationRuleTrigger } from "../calendars/calendar.types.js";

export type DevicePlatform = "ios" | "android" | "web";
export type DeviceTokenStatus = "active" | "disabled";
export type NotificationJobStatus = "scheduled" | "sent" | "failed" | "cancelled";
export type NotificationDeliveryStatus = "sent" | "failed" | "deferred" | "skipped";
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
  createStudentAlarm(input: Omit<StudentAlarmRecord, "id" | "createdAt" | "updatedAt">): Promise<StudentAlarmRecord>;
  listStudentAlarmsByUser(userId: string): Promise<StudentAlarmRecord[]>;
  cancelStudentAlarm(userId: string, alarmId: string): Promise<StudentAlarmRecord | null>;
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
