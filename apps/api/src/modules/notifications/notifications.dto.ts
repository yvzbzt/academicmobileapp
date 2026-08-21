import { ArrayMaxSize, ArrayUnique, Equals, IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, ValidateBy, ValidateNested, type ValidationOptions } from "class-validator";
import { Type } from "class-transformer";
import { IsExplicitOffsetTimestamp } from "../calendars/calendar-temporal.js";
import { NOTIFICATION_DELIVERY_CONSENT_VERSION } from "./notification.types.js";
import type { QuietHoursRecord, ReminderPreferenceRuleRecord } from "./notification.types.js";

export const NOTIFICATION_CATEGORY_COUNT_MAX = 64;
export const NOTIFICATION_CATEGORY_KEY_MAX_LENGTH = 64;
export const NOTIFICATION_REMINDER_OFFSET_COUNT_MAX = 31;
export const NOTIFICATION_REMINDER_RULE_COUNT_MAX = 16;
export const NOTIFICATION_TARGET_ID_MAX_LENGTH = 256;
export const NOTIFICATION_TITLE_MAX_LENGTH = 240;
export const NOTIFICATION_SCOPE_ID_MAX_LENGTH = 128;
export const NOTIFICATION_SOURCE_URL_MAX_LENGTH = 2048;

const BLOCKED_CATEGORY_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function IsNotificationCategoryMap(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy({
    name: "isNotificationCategoryMap",
    validator: {
      validate(value: unknown): boolean {
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
        const entries = Object.entries(value as Record<string, unknown>);
        return entries.length <= NOTIFICATION_CATEGORY_COUNT_MAX && entries.every(([key, enabled]) => (
          key.length > 0
          && key.length <= NOTIFICATION_CATEGORY_KEY_MAX_LENGTH
          && !BLOCKED_CATEGORY_KEYS.has(key)
          && typeof enabled === "boolean"
        ));
      },
      defaultMessage: () => "categories must contain at most 64 short, safe keys with boolean values"
    }
  }, validationOptions);
}

export class RegisterDeviceDto {
  @IsEnum(["ios", "android", "web"])
  platform!: "ios" | "android" | "web";

  @IsString()
  @MinLength(16)
  @MaxLength(4096)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  deviceId!: string;
}

export class UnregisterDeviceDto {
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  deviceId!: string;
}

class QuietHoursDto implements QuietHoursRecord {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  start!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  end!: string;

  @IsEnum(["Europe/Istanbul"])
  timezone!: "Europe/Istanbul";
}

class ReminderPreferenceRuleDto implements ReminderPreferenceRuleRecord {
  @IsEnum(["before", "at_time", "approaching"])
  trigger!: "before" | "at_time" | "approaching";

  @IsInt()
  @Min(0)
  @Max(720)
  amount!: number;

  @IsEnum(["days", "hours"])
  unit!: "days" | "hours";

  @IsBoolean()
  enabled!: boolean;
}

export class UpdateNotificationPreferencesDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @Equals(NOTIFICATION_DELIVERY_CONSENT_VERSION)
  deliveryConsentVersion?: typeof NOTIFICATION_DELIVERY_CONSENT_VERSION;

  @IsObject()
  @IsNotificationCategoryMap()
  categories!: Partial<Record<string, boolean>>;

  @IsArray()
  @ArrayMaxSize(NOTIFICATION_REMINDER_OFFSET_COUNT_MAX)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(30, { each: true })
  reminderOffsets!: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(NOTIFICATION_REMINDER_RULE_COUNT_MAX)
  @ValidateNested({ each: true })
  @Type(() => ReminderPreferenceRuleDto)
  reminderRules?: ReminderPreferenceRuleDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto;
}

export class CreateStudentAlarmDto {
  @IsEnum(["exam", "calendar_event", "announcement", "course"])
  eventType!: "exam" | "calendar_event" | "announcement" | "course";

  @IsString()
  @MinLength(1)
  @MaxLength(NOTIFICATION_TARGET_ID_MAX_LENGTH)
  targetId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(NOTIFICATION_TITLE_MAX_LENGTH)
  title?: string;

  @IsExplicitOffsetTimestamp()
  scheduledFor!: string;

  @IsEnum(["at_time", "before"])
  trigger!: "at_time" | "before";

  @IsInt()
  @Min(0)
  @Max(720)
  amount!: number;

  @IsEnum(["days", "hours"])
  unit!: "days" | "hours";

  @IsOptional()
  @IsString()
  @MaxLength(NOTIFICATION_SCOPE_ID_MAX_LENGTH)
  universityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTIFICATION_SCOPE_ID_MAX_LENGTH)
  facultyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTIFICATION_SCOPE_ID_MAX_LENGTH)
  departmentId?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(NOTIFICATION_SOURCE_URL_MAX_LENGTH)
  sourceUrl?: string;
}
