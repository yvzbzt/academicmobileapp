import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUrl, Matches, Max, Min, MinLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import type { QuietHoursRecord, ReminderPreferenceRuleRecord } from "./notification.types.js";

export class RegisterDeviceDto {
  @IsEnum(["ios", "android", "web"])
  platform!: "ios" | "android" | "web";

  @IsString()
  @MinLength(16)
  token!: string;
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

  @IsObject()
  categories!: Partial<Record<string, boolean>>;

  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(30, { each: true })
  reminderOffsets!: number[];

  @IsOptional()
  @IsArray()
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
  targetId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsDateString()
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
  universityId?: string;

  @IsOptional()
  @IsString()
  facultyId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  sourceUrl?: string;
}
