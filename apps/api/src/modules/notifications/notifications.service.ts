import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { AcademicEventRecord, AcademicCalendarRecord } from "../calendars/calendar.types.js";
import type { CalendarRepository } from "../calendars/calendar.types.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import type { NotificationPreferenceDto, StudentAlarmDto } from "../../../../../packages/shared/src/contracts.js";
import type { NotificationJobRecord, NotificationPreferenceRecord, NotificationRepository, ReminderPreferenceRuleRecord, StudentAlarmRecord } from "./notification.types.js";
import type { CreateStudentAlarmDto, RegisterDeviceDto, UpdateNotificationPreferencesDto } from "./notifications.dto.js";

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
    @Optional() @Inject("CalendarRepository") private readonly calendarRepository?: CalendarRepository
  ) {}

  registerDevice(user: AuthenticatedUser, input: RegisterDeviceDto) {
    return this.notificationRepository.upsertDeviceToken({ userId: user.id, platform: input.platform, token: input.token.trim() });
  }

  async getPreferences(user: AuthenticatedUser): Promise<NotificationPreferenceRecord> {
    const existing = await this.notificationRepository.findPreferencesByUserId(user.id);
    if (existing) return existing;
    return this.notificationRepository.upsertPreferences({
      userId: user.id,
      enabled: true,
      categories: {},
      reminderOffsets: DEFAULT_REMINDER_OFFSETS,
      reminderRules: DEFAULT_REMINDER_RULES
    });
  }

  async updatePreferences(user: AuthenticatedUser, input: UpdateNotificationPreferencesDto): Promise<NotificationPreferenceRecord> {
    const reminderRules = normalizePreferenceReminderRules(input.reminderOffsets, input.reminderRules ?? []);
    if (reminderRules.length === 0) throw new BadRequestException("At least one reminder rule is required.");
    return this.notificationRepository.upsertPreferences({
      userId: user.id,
      enabled: input.enabled,
      categories: input.categories,
      reminderOffsets: normalizedReminderOffsets(input.reminderOffsets),
      reminderRules,
      ...(input.quietHours ? { quietHours: input.quietHours } : {})
    });
  }

  toPreferenceDto(preferences: NotificationPreferenceRecord): NotificationPreferenceDto {
    return {
      enabled: preferences.enabled,
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
    const resolvedEvent = input.eventType === "announcement" ? null : await this.calendarRepository?.findPublishedEventById(input.targetId);
    if ((input.eventType === "exam" || input.eventType === "calendar_event" || input.eventType === "course") && this.calendarRepository && !resolvedEvent) throw new NotFoundException("Calendar event not found.");
    if (input.eventType === "exam" && resolvedEvent && !isExamEvent(resolvedEvent)) throw new BadRequestException("Selected event is not an exam.");
    if (input.eventType === "course" && resolvedEvent && resolvedEvent.category !== "course_schedule") throw new BadRequestException("Selected event is not a course schedule item.");

    const universityId = resolvedEvent?.universityId ?? input.universityId ?? user.universityId;
    if (!universityId) throw new BadRequestException("User must select a university before creating alarms.");

    const trigger = input.trigger;
    const amount = trigger === "at_time" ? 0 : Math.max(0, Math.floor(input.amount));
    if (trigger === "before" && amount <= 0) throw new BadRequestException("Before alarms require a positive amount.");
    const unit = trigger === "at_time" ? "days" : input.unit;
    const scheduledAt = scheduledAtForCustomAlarm(scheduledFor, trigger, amount, unit);
    const title = (input.title ?? resolvedEvent?.title ?? "").trim();
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
      ...(resolvedEvent?.facultyId ?? input.facultyId ?? user.facultyId ? { facultyId: resolvedEvent?.facultyId ?? input.facultyId ?? user.facultyId } : {}),
      ...(resolvedEvent?.departmentId ?? input.departmentId ?? user.departmentId ? { departmentId: resolvedEvent?.departmentId ?? input.departmentId ?? user.departmentId } : {}),
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      status: "scheduled"
    });

    await this.notificationRepository.createNotificationJobs([{
      calendarId: resolvedEvent?.calendarId ?? "student-custom-alarm",
      eventId: alarm.id,
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
  constructor(@Inject("NotificationRepository") private readonly notificationRepository: NotificationRepository) {}

  async scheduleCalendarPublished(calendar: AcademicCalendarRecord, events: AcademicEventRecord[]): Promise<NotificationJobRecord[]> {
    if (calendar.status !== "published") throw new BadRequestException("Only published calendars can schedule notifications.");
    const jobs = events.flatMap((event) =>
      event.notificationRules
        .filter((rule) => rule.enabled)
        .map((rule) => ({
          calendarId: calendar.id,
          eventId: event.id,
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
    return this.notificationRepository.createNotificationJobs(jobs);
  }

  listCalendarJobs(calendarId: string) {
    return this.notificationRepository.listJobsByCalendar(calendarId);
  }
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
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} must be a valid date.`);
  return parsed;
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
