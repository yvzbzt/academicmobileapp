import type { AcademicEventCategory } from "../../domain/academic-event.types.js";
import type { NotificationRuleTrigger } from "../calendars/calendar.types.js";
export { NOTIFICATION_DELIVERY_CONSENT_VERSION } from "../../../../../packages/shared/src/contracts.js";

export type DevicePlatform = "ios" | "android" | "web";
export type DeviceTokenStatus = "active" | "disabled";
export type NotificationJobStatus = "scheduled" | "processing" | "sent" | "failed" | "dead" | "cancelled";
export type NotificationDeliveryAttemptState = "sending" | "sent" | "failed" | "invalid_device" | "ambiguous";
export type NotificationDeliveryStatus = NotificationDeliveryAttemptState | "deferred" | "skipped";
export type NotificationDestinationType = "calendar_event" | "announcement";
export type NotificationDestinationScopeType = "global" | "university" | "faculty" | "department";
export type NotificationJobFailureReason =
  | "provider_unavailable"
  | "provider_rejected"
  | "destination_unavailable"
  | "destination_changed"
  | "worker_interrupted";
export type NotificationDeliveryFailureReason =
  | "invalid_token"
  | "provider_unavailable"
  | "provider_rejected"
  | "scope_mismatch"
  | "preference_disabled"
  | "quiet_hours"
  | "destination_unavailable"
  | "device_registration_stale"
  | "provider_outcome_unknown";
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

export interface NotificationProducerDestinationRecord {
  producerKey: string;
  calendarId: string;
  eventId: string;
  destinationId: string;
  title: string;
}

export interface NotificationJobRecord {
  id: string;
  calendarId: string;
  eventId: string;
  destinationType?: NotificationDestinationType;
  destinationId?: string;
  destinationScopeType?: NotificationDestinationScopeType;
  destinationScopeId?: string;
  /** A domain-separated hash of trusted destination material; never raw content. */
  destinationFingerprint?: string;
  /** Identifies the writer that currently owns this automatically produced job. */
  producerKey?: string;
  /** All current source relationships for a scope-safe deduplicated job. */
  producerKeys?: string[];
  /** Exact real-ID destinations contributed by each equivalent trusted source. */
  producerDestinations?: NotificationProducerDestinationRecord[];
  /** Internal CAS fence for concurrent producer relationship changes. */
  producerRelationRevision?: number;
  /** Groups mutually exclusive producer versions, such as calendar publications. */
  producerGroupKey?: string;
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
  revision: number;
  /** Increments when an operator starts a fresh retry budget without changing trusted content. */
  deliveryAttemptEpoch: number;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt?: Date;
  lastFailureReason?: NotificationJobFailureReason;
  exhaustedAt?: Date;
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
  jobRevision?: number;
  /** Present only for provider-facing attempts; legacy audit rows do not have an attempt identity. */
  attemptIdentity?: string;
  attemptVersion?: string;
  /** Domain-separated digest of the app installation identifier, never the raw device ID. */
  deviceInstallationHash?: string;
  userId: string;
  deviceTokenId: string;
  status: NotificationDeliveryStatus;
  sendingClaimId?: string;
  sendingStartedAt?: Date;
  sendingLeaseUntil?: Date;
  providerMessageId?: string;
  failureReason?: NotificationDeliveryFailureReason;
  deliveredAt?: Date;
  finalizedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationDeliveryAttemptRecord = NotificationDeliveryRecord & {
  attemptIdentity: string;
  attemptVersion: string;
  deviceInstallationHash: string;
  status: NotificationDeliveryAttemptState;
  sendingStartedAt: Date;
};

export interface NotificationDeliveryAttemptClaimInput {
  attemptIdentity: string;
  attemptVersion: string;
  jobId: string;
  jobRevision: number;
  userId: string;
  deviceTokenId: string;
  deviceInstallationHash: string;
  sendingClaimId: string;
  sendingStartedAt: Date;
  sendingLeaseUntil: Date;
}

export interface NotificationDeliveryAttemptFinalizeInput {
  attemptIdentity: string;
  sendingClaimId: string;
  status: Exclude<NotificationDeliveryAttemptState, "sending">;
  finalizedAt: Date;
  providerMessageId?: string;
  failureReason?: NotificationDeliveryFailureReason;
  deliveredAt?: Date;
}

export interface NotificationDeliveryAttemptFence {
  deviceTokenId: string;
  status: "sending" | "sent" | "invalid_device" | "ambiguous";
}

export type NotificationJobCreateInput = Omit<
  NotificationJobRecord,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "revision"
  | "deliveryAttemptEpoch"
  | "attemptCount"
  | "maxAttempts"
  | "lastAttemptAt"
  | "lastFailureReason"
  | "exhaustedAt"
  | "processingClaimId"
  | "processingLeaseUntil"
> & { maxAttempts?: number };

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
  createNotificationJobs(input: NotificationJobCreateInput[]): Promise<NotificationJobRecord[]>;
  createStudentAlarm(input: Omit<StudentAlarmRecord, "id" | "createdAt" | "updatedAt">): Promise<StudentAlarmRecord>;
  listStudentAlarmsByUser(userId: string): Promise<StudentAlarmRecord[]>;
  cancelStudentAlarm(userId: string, alarmId: string): Promise<StudentAlarmRecord | null>;
  listJobsByCalendar(calendarId: string): Promise<NotificationJobRecord[]>;
  listDueJobs(now: Date, limit: number): Promise<NotificationJobRecord[]>;
  claimDueJob(jobId: string, now: Date, claimId: string, leaseUntil: Date): Promise<NotificationJobRecord | null>;
  renewClaimedJob(jobId: string, claimId: string, revision: number, leaseUntil: Date): Promise<NotificationJobRecord | null>;
  completeClaimedJob(jobId: string, claimId: string, status: "sent" | "failed" | "cancelled"): Promise<NotificationJobRecord | null>;
  rescheduleClaimedJob(jobId: string, claimId: string, scheduledAt: Date): Promise<NotificationJobRecord | null>;
  failClaimedJob(input: {
    jobId: string;
    claimId: string;
    revision: number;
    failedAt: Date;
    retryAt: Date;
    reason: NotificationJobFailureReason;
  }): Promise<NotificationJobRecord | null>;
  syncProducedJobs(input: {
    producerKey: string;
    producerGroupKey?: string;
    jobs: NotificationJobCreateInput[];
    /** Existing equivalent jobs may gain this producer relationship, but missing jobs are not backfilled. */
    retainJobs?: NotificationJobCreateInput[];
  }): Promise<{ active: NotificationJobRecord[]; retired: number }>;
  retireProducedJobs(producerKey: string): Promise<number>;
  retireSupersededProducerJobs(producerGroupKey: string, activeProducerKey: string): Promise<number>;
  listJobsForDestinationValidation(limit: number, offset: number): Promise<NotificationJobRecord[]>;
  getWorkerBacklog(now: Date): Promise<{ due: number; retrying: number; processing: number; dead: number }>;
  listFailedJobs(limit: number, offset: number): Promise<NotificationJobRecord[]>;
  listActiveDeviceTokens(limit: number, offset: number): Promise<DeviceTokenRecord[]>;
  listSentDeviceTokenIdsForJob(jobId: string, revision?: number): Promise<string[]>;
  claimDeliveryAttempt(input: NotificationDeliveryAttemptClaimInput): Promise<{ claimed: boolean; attempt: NotificationDeliveryAttemptRecord }>;
  finalizeDeliveryAttempt(input: NotificationDeliveryAttemptFinalizeInput): Promise<NotificationDeliveryAttemptRecord | null>;
  recoverExpiredDeliveryAttempts(now: Date): Promise<number>;
  getDeliveryAttemptBacklog(now: Date): Promise<{ sending: number; expiredSending: number; ambiguous: number }>;
  listDeliveryAttemptFencesForJob(jobId: string, revision?: number): Promise<NotificationDeliveryAttemptFence[]>;
  recordDelivery(input: Omit<NotificationDeliveryRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationDeliveryRecord>;
  listDeliveriesByJob(jobId: string, limit: number, offset: number): Promise<NotificationDeliveryRecord[]>;
  updateJobStatus(jobId: string, status: NotificationJobStatus): Promise<NotificationJobRecord | null>;
  rescheduleJob(jobId: string, scheduledAt: Date): Promise<NotificationJobRecord | null>;
  disableDeviceToken(token: string): Promise<DeviceTokenRecord | null>;
  deleteUserData(userId: string): Promise<void>;
}
