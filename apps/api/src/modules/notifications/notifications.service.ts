import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { AcademicEventRecord, AcademicCalendarRecord } from "../calendars/calendar.types.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import type { NotificationPreferenceDto } from "../../../../../packages/shared/src/contracts.js";
import type { NotificationJobRecord, NotificationPreferenceRecord, NotificationRepository } from "./notification.types.js";
import type { RegisterDeviceDto, UpdateNotificationPreferencesDto } from "./notifications.dto.js";

const DEFAULT_REMINDER_OFFSETS = [7, 1, 0];

@Injectable()
export class NotificationsService {
  constructor(@Inject("NotificationRepository") private readonly notificationRepository: NotificationRepository) {}

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
      reminderOffsets: DEFAULT_REMINDER_OFFSETS
    });
  }

  async updatePreferences(user: AuthenticatedUser, input: UpdateNotificationPreferencesDto): Promise<NotificationPreferenceRecord> {
    if (input.reminderOffsets.length === 0) throw new BadRequestException("At least one reminder offset is required.");
    return this.notificationRepository.upsertPreferences({
      userId: user.id,
      enabled: input.enabled,
      categories: input.categories,
      reminderOffsets: input.reminderOffsets,
      ...(input.quietHours ? { quietHours: input.quietHours } : {})
    });
  }

  toPreferenceDto(preferences: NotificationPreferenceRecord): NotificationPreferenceDto {
    return {
      enabled: preferences.enabled,
      categories: preferences.categories,
      reminderOffsets: preferences.reminderOffsets,
      ...(preferences.quietHours ? { quietHours: preferences.quietHours } : {})
    };
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
          title: event.title,
          category: event.category,
          offsetDays: rule.offsetDays,
          scheduledAt: subtractDays(event.startDate, rule.offsetDays),
          status: "scheduled" as const
        }))
    );
    return this.notificationRepository.createNotificationJobs(jobs);
  }

  listCalendarJobs(calendarId: string) {
    return this.notificationRepository.listJobsByCalendar(calendarId);
  }
}

function subtractDays(date: Date, days: number): Date {
  const scheduledAt = new Date(date);
  scheduledAt.setUTCDate(scheduledAt.getUTCDate() - days);
  return scheduledAt;
}
