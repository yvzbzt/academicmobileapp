import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AcademicEventRecord, AcademicCalendarRecord } from "../calendars/calendar.types.js";
import type { CalendarRepository } from "../calendars/calendar.types.js";
import { parseExplicitOffsetTimestamp } from "../calendars/calendar-temporal.js";
import type { AnnouncementPersistenceDelta, AnnouncementPersistenceReference, AnnouncementRepository, AnnouncementSourceRecord } from "../announcements/announcements.types.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import type { DeviceRegistrationDto, DeviceUnregistrationDto, NotificationPreferenceDto, StudentAlarmDto } from "../../../../../packages/shared/src/contracts.js";
import { DeviceRegistrationConflictError, NOTIFICATION_DELIVERY_CONSENT_VERSION } from "./notification.types.js";
import type { NotificationJobCreateInput, NotificationJobRecord, NotificationPreferenceRecord, NotificationRepository, ReminderPreferenceRuleRecord, StudentAlarmRecord } from "./notification.types.js";
import type { CreateStudentAlarmDto, RegisterDeviceDto, UnregisterDeviceDto, UpdateNotificationPreferencesDto } from "./notifications.dto.js";
import { announcementDestinationFingerprint, calendarDestinationFingerprint } from "./notification-destination.js";

const DEFAULT_REMINDER_OFFSETS = [7, 1, 0];
const DEFAULT_REMINDER_RULES: ReminderPreferenceRuleRecord[] = [
  { trigger: "before", amount: 7, unit: "days", enabled: true },
  { trigger: "before", amount: 1, unit: "days", enabled: true },
  { trigger: "at_time", amount: 0, unit: "days", enabled: true }
];

@Injectable()
export class NotificationsService {
  constructor(
    @Inject("NotificationRepository") private readonly notificationRepository: NotificationRepository,
    @Optional() @Inject("CalendarRepository") private readonly calendarRepository?: CalendarRepository,
    @Optional() @Inject("AnnouncementRepository") private readonly announcementRepository?: AnnouncementRepository
  ) {}

  async registerDevice(user: AuthenticatedUser, input: RegisterDeviceDto): Promise<DeviceRegistrationDto> {
    const token = normalizePushToken(input.token);
    const installationHash = hashNotificationDeviceId(normalizeRegistrationDeviceId(input.deviceId));
    try {
      const device = await this.notificationRepository.upsertDeviceToken({
        userId: user.id,
        platform: input.platform,
        token,
        installationHash
      });
      return {
        status: "registered",
        platform: device.platform,
        lastSeenAt: device.lastSeenAt.toISOString()
      };
    } catch (error) {
      if (error instanceof DeviceRegistrationConflictError) {
        throw new ConflictException("This device is already registered to another active installation or account.");
      }
      throw error;
    }
  }

  async unregisterCurrentDevice(user: AuthenticatedUser, input: UnregisterDeviceDto): Promise<DeviceUnregistrationDto> {
    const installationHash = hashNotificationDeviceId(normalizeRegistrationDeviceId(input.deviceId));
    try {
      await this.notificationRepository.disableDeviceInstallation(user.id, installationHash);
      return { status: "unregistered" };
    } catch (error) {
      if (error instanceof DeviceRegistrationConflictError) {
        throw new ConflictException("This device registration belongs to another active account.");
      }
      throw error;
    }
  }

  async getPreferences(user: AuthenticatedUser): Promise<NotificationPreferenceRecord> {
    const existing = await this.notificationRepository.findPreferencesByUserId(user.id);
    if (existing) return existing;
    return this.notificationRepository.upsertPreferences({
      userId: user.id,
      enabled: false,
      categories: {},
      reminderOffsets: DEFAULT_REMINDER_OFFSETS,
      reminderRules: DEFAULT_REMINDER_RULES
    });
  }

  async updatePreferences(user: AuthenticatedUser, input: UpdateNotificationPreferencesDto): Promise<NotificationPreferenceRecord> {
    if (input.enabled && input.deliveryConsentVersion !== NOTIFICATION_DELIVERY_CONSENT_VERSION) {
      throw new BadRequestException(`Enabling notifications requires deliveryConsentVersion=${NOTIFICATION_DELIVERY_CONSENT_VERSION}.`);
    }
    const reminderRules = normalizePreferenceReminderRules(input.reminderOffsets, input.reminderRules ?? []);
    if (reminderRules.length === 0) throw new BadRequestException("At least one reminder rule is required.");
    return this.notificationRepository.upsertPreferences({
      userId: user.id,
      enabled: input.enabled,
      ...(input.deliveryConsentVersion === NOTIFICATION_DELIVERY_CONSENT_VERSION
        ? { deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION }
        : {}),
      categories: input.categories,
      reminderOffsets: normalizedReminderOffsets(input.reminderOffsets),
      reminderRules,
      ...(input.quietHours ? { quietHours: input.quietHours } : {})
    });
  }

  toPreferenceDto(preferences: NotificationPreferenceRecord): NotificationPreferenceDto {
    const deliveryConsentCurrent = preferences.deliveryConsentVersion === NOTIFICATION_DELIVERY_CONSENT_VERSION;
    const enabled = preferences.enabled && deliveryConsentCurrent;
    return {
      enabled,
      ...(enabled ? { deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION } : {}),
      categories: Object.fromEntries(Object.entries(preferences.categories).filter((entry): entry is [string, boolean] => entry[1] !== undefined)),
      reminderOffsets: preferences.reminderOffsets,
      ...(preferences.reminderRules ? { reminderRules: preferences.reminderRules } : {}),
      ...(preferences.quietHours ? { quietHours: preferences.quietHours } : {})
    };
  }

  listStudentAlarms(user: AuthenticatedUser): Promise<StudentAlarmDto[]> {
    return this.notificationRepository.listStudentAlarmsByUser(user.id).then((alarms) => alarms.map(toStudentAlarmDto));
  }

  async createStudentAlarm(user: AuthenticatedUser, input: CreateStudentAlarmDto): Promise<StudentAlarmDto> {
    const scheduledFor = parseRequiredDate(input.scheduledFor, "scheduledFor");
    const isCalendarTarget = input.eventType === "exam" || input.eventType === "calendar_event" || input.eventType === "course";
    const resolvedEvent = isCalendarTarget && this.calendarRepository && user.universityId
      ? await this.calendarRepository.findPublishedEventByIdInScope(input.targetId, {
        universityId: user.universityId,
        ...(user.facultyId ? { facultyId: user.facultyId } : {}),
        ...(user.departmentId ? { departmentId: user.departmentId } : {})
      })
      : null;
    const trustedAnnouncement = input.eventType === "announcement" && this.announcementRepository && user.universityId
      ? await this.announcementRepository.findTrustedItemByIdInScope({
        announcementId: input.targetId,
        universityId: user.universityId,
        ...(user.facultyId ? { facultyId: user.facultyId } : {}),
        ...(user.departmentId ? { departmentId: user.departmentId } : {})
      })
      : null;
    if (input.eventType === "announcement" && !trustedAnnouncement) throw new NotFoundException("Trusted announcement not found.");
    if (isCalendarTarget && !resolvedEvent) throw new NotFoundException("Calendar event not found.");
    if (input.eventType === "exam" && resolvedEvent && !isExamEvent(resolvedEvent)) throw new BadRequestException("Selected event is not an exam.");
    if (input.eventType === "course" && resolvedEvent && resolvedEvent.category !== "course_schedule") throw new BadRequestException("Selected event is not a course schedule item.");

    const universityId = resolvedEvent?.universityId ?? user.universityId;
    if (!universityId) throw new BadRequestException("User must select a university before creating alarms.");
    const facultyId = resolvedEvent?.facultyId
      ?? (trustedAnnouncement?.source.scopeType === "faculty" ? trustedAnnouncement.source.scopeId : user.facultyId);
    const departmentId = resolvedEvent?.departmentId
      ?? (trustedAnnouncement?.source.scopeType === "department" ? trustedAnnouncement.source.scopeId : user.departmentId);
    if (input.universityId && input.universityId !== universityId) throw new BadRequestException("Alarm university scope does not match the trusted destination.");
    if (input.facultyId && input.facultyId !== facultyId) throw new BadRequestException("Alarm faculty scope does not match the trusted destination.");
    if (input.departmentId && input.departmentId !== departmentId) throw new BadRequestException("Alarm department scope does not match the trusted destination.");

    const trigger = input.trigger;
    const amount = trigger === "at_time" ? 0 : Math.max(0, Math.floor(input.amount));
    if (trigger === "before" && amount <= 0) throw new BadRequestException("Before alarms require a positive amount.");
    const unit = trigger === "at_time" ? "days" : input.unit;
    const scheduledAt = scheduledAtForCustomAlarm(scheduledFor, trigger, amount, unit);
    const title = (input.title ?? resolvedEvent?.title ?? trustedAnnouncement?.item.title ?? "").trim();
    if (!title) throw new BadRequestException("Alarm title is required when the target cannot be resolved automatically.");

    const alarm = await this.notificationRepository.createStudentAlarm({
      userId: user.id,
      eventType: input.eventType,
      targetId: input.targetId,
      title,
      scheduledFor,
      trigger,
      amount,
      unit,
      scheduledAt,
      timezone: "Europe/Istanbul",
      universityId,
      ...(facultyId ? { facultyId } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      status: "scheduled"
    });

    await this.notificationRepository.createNotificationJobs([{
      calendarId: resolvedEvent?.calendarId ?? "student-custom-alarm",
      eventId: alarm.id,
      destinationType: input.eventType === "announcement" ? "announcement" : "calendar_event",
      destinationId: input.targetId,
      ...(trustedAnnouncement ? {
        destinationScopeType: trustedAnnouncement.source.scopeType,
        destinationScopeId: trustedAnnouncement.source.scopeId,
        destinationFingerprint: announcementDestinationFingerprint(trustedAnnouncement.item, trustedAnnouncement.source)
      } : resolvedEvent ? {
        destinationScopeType: resolvedEvent.departmentId ? "department" as const : resolvedEvent.facultyId ? "faculty" as const : "university" as const,
        destinationScopeId: resolvedEvent.departmentId ?? resolvedEvent.facultyId ?? resolvedEvent.universityId,
        destinationFingerprint: calendarDestinationFingerprint(resolvedEvent)
      } : {}),
      userId: user.id,
      alarmId: alarm.id,
      eventType: input.eventType,
      universityId,
      ...(alarm.facultyId ? { facultyId: alarm.facultyId } : {}),
      ...(alarm.departmentId ? { departmentId: alarm.departmentId } : {}),
      title: alarm.title,
      category: notificationCategoryForAlarm(input.eventType, resolvedEvent),
      offsetDays: unit === "days" ? amount : 0,
      ...(unit === "hours" ? { offsetHours: amount } : {}),
      trigger,
      scheduledAt,
      status: "scheduled"
    }]);

    return toStudentAlarmDto(alarm);
  }

  async cancelStudentAlarm(user: AuthenticatedUser, alarmId: string): Promise<StudentAlarmDto> {
    const alarm = await this.notificationRepository.cancelStudentAlarm(user.id, alarmId);
    if (!alarm) throw new NotFoundException("Alarm not found.");
    return toStudentAlarmDto(alarm);
  }
}

@Injectable()
export class NotificationSchedulingService {
  constructor(
    @Inject("NotificationRepository") private readonly notificationRepository: NotificationRepository,
    @Optional() @Inject("AnnouncementRepository") private readonly announcementRepository?: AnnouncementRepository
  ) {}

  async scheduleCalendarPublished(calendar: AcademicCalendarRecord, events: AcademicEventRecord[]): Promise<NotificationJobRecord[]> {
    if (calendar.status !== "published") throw new BadRequestException("Only published calendars can schedule notifications.");
    const producerKey = `calendar:${calendar.id}`;
    const producerGroupKey = `calendar:${calendar.universityId}:${calendar.academicYear}`;
    const jobs = events.flatMap((event) =>
      event.notificationRules
        .filter((rule) => rule.enabled)
        .map((rule) => ({
          calendarId: calendar.id,
          eventId: event.id,
           destinationType: "calendar_event" as const,
           destinationId: event.id,
           destinationScopeType: event.departmentId ? "department" as const : event.facultyId ? "faculty" as const : "university" as const,
           destinationScopeId: event.departmentId ?? event.facultyId ?? event.universityId,
           destinationFingerprint: calendarDestinationFingerprint(event),
          universityId: event.universityId,
          ...(event.facultyId ? { facultyId: event.facultyId } : {}),
          ...(event.departmentId ? { departmentId: event.departmentId } : {}),
          title: event.title,
          category: event.category,
          offsetDays: rule.offsetDays,
          ...(rule.offsetHours !== undefined ? { offsetHours: rule.offsetHours } : {}),
          trigger: rule.trigger ?? (rule.offsetDays === 0 && !rule.offsetHours ? "at_time" as const : "before" as const),
          scheduledAt: scheduledAtForReminder(event.startDate, rule),
          status: "scheduled" as const
        }))
    );
    await this.notificationRepository.retireSupersededProducerJobs(producerGroupKey, producerKey);
    const synced = await this.notificationRepository.syncProducedJobs({ producerKey, producerGroupKey, jobs });
    return synced.active;
  }

  async syncTrustedAnnouncementSource(
    source: AnnouncementSourceRecord,
    delta: AnnouncementPersistenceDelta,
    now = new Date()
  ): Promise<{ active: NotificationJobRecord[]; retired: number }> {
    const producerKey = `announcement-source:${source.id}`;
    if (source.status !== "active" || source.trustStatus !== "trusted" || !this.announcementRepository) {
      return { active: [], retired: await this.notificationRepository.retireProducedJobs(producerKey) };
    }

    const producibleIds = new Set([...delta.created, ...delta.materiallyUpdated].map((reference) => reference.id));
    const references = [...delta.created, ...delta.materiallyUpdated, ...delta.unchanged];
    const producedJobs: NotificationJobCreateInput[] = [];
    const retainedJobs: NotificationJobCreateInput[] = [];
    const referencesToAcknowledge: AnnouncementPersistenceReference[] = [];
    for (const reference of references) {
      if (reference.sourceId !== source.id || reference.scopeType !== source.scopeType || reference.scopeId !== source.scopeId) continue;
      const resolved = await this.resolveTrustedAnnouncementReference(source, reference);
      if (!resolved) continue;
      const job = {
        calendarId: producerKey,
        eventId: resolved.item.id,
        destinationType: "announcement" as const,
        destinationId: resolved.item.id,
        destinationScopeType: source.scopeType,
        destinationScopeId: source.scopeId,
        destinationFingerprint: announcementDestinationFingerprint(resolved.item, resolved.source),
        eventType: "announcement" as const,
        universityId: source.scopeType === "university" && source.scopeId !== YOK_SCOPE_ID ? source.scopeId : "*",
        ...(source.scopeType === "faculty" ? { facultyId: source.scopeId } : {}),
        ...(source.scopeType === "department" ? { departmentId: source.scopeId } : {}),
        title: resolved.item.title,
        category: announcementNotificationCategory(source),
        offsetDays: 0,
        trigger: "at_time" as const,
        scheduledAt: now,
        status: "scheduled" as const
      };
      if (producibleIds.has(reference.id)) {
        producedJobs.push(job);
        referencesToAcknowledge.push(reference);
      } else retainedJobs.push(job);
    }
    const synced = await this.notificationRepository.syncProducedJobs({
      producerKey,
      jobs: producedJobs,
      retainJobs: retainedJobs
    });
    if (referencesToAcknowledge.length > 0) {
      const acknowledged = await this.announcementRepository.acknowledgeNotificationProduction(referencesToAcknowledge);
      if (acknowledged !== referencesToAcknowledge.length) throw new Error("NOTIFICATION_PRODUCTION_ACK_CONFLICT");
    }
    return synced;
  }

  listCalendarJobs(calendarId: string) {
    return this.notificationRepository.listJobsByCalendar(calendarId);
  }

  retireCalendarJobs(calendarId: string) {
    return this.notificationRepository.retireProducedJobs(`calendar:${calendarId}`);
  }

  private resolveTrustedAnnouncementReference(source: AnnouncementSourceRecord, reference: AnnouncementPersistenceReference) {
    return this.announcementRepository!.findTrustedItemByIdInScope({
      announcementId: reference.id,
      universityId: source.scopeType === "university" ? source.scopeId : "*",
      ...(source.scopeType === "faculty" ? { facultyId: source.scopeId } : {}),
      ...(source.scopeType === "department" ? { departmentId: source.scopeId } : {})
    }).then((resolved) => resolved
      && resolved.item.contentFingerprint === reference.contentFingerprint
      && resolved.item.trustStatus === "trusted"
      && resolved.source.status === "active"
      && resolved.source.trustStatus === "trusted"
      ? resolved
      : null);
  }
}

const YOK_SCOPE_ID = "yok-council-of-higher-education";

function announcementNotificationCategory(source: AnnouncementSourceRecord) {
  if (source.scopeId === YOK_SCOPE_ID) return "yok_event" as const;
  if (source.scopeType === "department") return "department_announcement" as const;
  if (source.scopeType === "faculty") return "faculty_announcement" as const;
  return "announcement" as const;
}

export function hashNotificationDeviceId(deviceId: string): string {
  const normalized = deviceId.trim();
  if (!normalized) throw new BadRequestException("deviceId is required.");
  return createHash("sha256").update("academic-mobile-notification-device:v1\0").update(normalized).digest("hex");
}

function normalizePushToken(token: string): string {
  const normalized = token.trim();
  if (normalized.length < 16 || normalized.length > 4096) {
    throw new BadRequestException("token must be between 16 and 4096 characters after trimming.");
  }
  return normalized;
}

function normalizeRegistrationDeviceId(deviceId: string): string {
  const normalized = deviceId.trim();
  if (normalized.length < 8 || normalized.length > 256) {
    throw new BadRequestException("deviceId must be between 8 and 256 characters after trimming.");
  }
  return normalized;
}

function normalizedReminderOffsets(offsets: number[]): number[] {
  return [...new Set(offsets)].sort((left, right) => right - left);
}

function normalizePreferenceReminderRules(offsets: number[], explicitRules: ReminderPreferenceRuleRecord[]): ReminderPreferenceRuleRecord[] {
  const rules = [
    ...normalizedReminderOffsets(offsets).map((offsetDays) => ({
      trigger: offsetDays === 0 ? "at_time" as const : "before" as const,
      amount: offsetDays,
      unit: "days" as const,
      enabled: true
    })),
    ...explicitRules
  ];
  const unique = new Map<string, ReminderPreferenceRuleRecord>();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const amount = Math.max(0, Math.floor(rule.amount));
    const key = `${rule.trigger}:${amount}:${rule.unit}`;
    unique.set(key, { trigger: rule.trigger, amount, unit: rule.unit, enabled: true });
  }
  return [...unique.values()].sort((left, right) => reminderRuleSortScore(right) - reminderRuleSortScore(left));
}

function reminderRuleSortScore(rule: ReminderPreferenceRuleRecord): number {
  if (rule.trigger === "at_time") return 0;
  return rule.unit === "hours" ? rule.amount / 24 : rule.amount;
}

function scheduledAtForReminder(date: Date, rule: { offsetDays: number; offsetHours?: number; trigger?: "before" | "at_time" | "approaching" }): Date {
  const trigger = rule.trigger ?? (rule.offsetDays === 0 && !rule.offsetHours ? "at_time" : "before");
  if (trigger === "at_time") return new Date(date);
  const offsetDays = trigger === "approaching" && rule.offsetDays === 0 && !rule.offsetHours ? 1 : rule.offsetDays;
  return subtractOffset(date, offsetDays, rule.offsetHours ?? 0);
}

function subtractOffset(date: Date, days: number, hours: number): Date {
  const scheduledAt = new Date(date);
  scheduledAt.setUTCDate(scheduledAt.getUTCDate() - days);
  scheduledAt.setUTCHours(scheduledAt.getUTCHours() - hours);
  return scheduledAt;
}

function scheduledAtForCustomAlarm(date: Date, trigger: "before" | "at_time", amount: number, unit: "days" | "hours"): Date {
  if (trigger === "at_time") return new Date(date);
  return subtractOffset(date, unit === "days" ? amount : 0, unit === "hours" ? amount : 0);
}

function parseRequiredDate(value: string, field: string): Date {
  return parseExplicitOffsetTimestamp(value, field);
}

function isExamEvent(event: AcademicEventRecord): boolean {
  return ["midterm_exam", "final_exam", "makeup_exam", "single_course_exam", "department_exam_schedule"].includes(event.category);
}

function notificationCategoryForAlarm(eventType: "exam" | "calendar_event" | "announcement" | "course", event: AcademicEventRecord | null | undefined) {
  if (eventType === "announcement") return "announcement" as const;
  if (eventType === "exam") return "department_exam_schedule" as const;
  if (eventType === "course") return "course_schedule" as const;
  return event?.category ?? "custom_event";
}

function toStudentAlarmDto(alarm: StudentAlarmRecord): StudentAlarmDto {
  return {
    id: alarm.id,
    eventType: alarm.eventType,
    targetId: alarm.targetId,
    title: alarm.title,
    scheduledFor: alarm.scheduledFor.toISOString(),
    trigger: alarm.trigger,
    amount: alarm.amount,
    unit: alarm.unit,
    scheduledAt: alarm.scheduledAt.toISOString(),
    timezone: alarm.timezone,
    universityId: alarm.universityId,
    ...(alarm.facultyId ? { facultyId: alarm.facultyId } : {}),
    ...(alarm.departmentId ? { departmentId: alarm.departmentId } : {}),
    ...(alarm.sourceUrl ? { sourceUrl: alarm.sourceUrl } : {}),
    status: alarm.status
  };
}
