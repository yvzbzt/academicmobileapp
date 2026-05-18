import { IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Matches, Max, Min, MinLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import type { AcademicEventCategory } from "../../domain/academic-event.types.js";
import type { QuietHoursRecord } from "./notification.types.js";

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

export class UpdateNotificationPreferencesDto {
  @IsBoolean()
  enabled!: boolean;

  @IsObject()
  categories!: Partial<Record<AcademicEventCategory, boolean>>;

  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(30, { each: true })
  reminderOffsets!: number[];

  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto;
}
