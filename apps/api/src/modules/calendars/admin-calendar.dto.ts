import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateNested } from "class-validator";
import { academicEventCategories, type AcademicEventCategory, type AcademicTerm } from "../../domain/academic-event.types.js";

const terms: AcademicTerm[] = ["fall", "spring", "summer", "full_year", "unknown"];

export class CreateCalendarDraftDto {
  @IsString()
  universityId!: string;

  @IsString()
  academicYear!: string;

  @IsString()
  @MinLength(3)
  title!: string;

  @IsString()
  sourcePdfId!: string;
}

class ManualNotificationRuleDto {
  @IsInt()
  @Min(0)
  @Max(30)
  offsetDays!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  offsetHours?: number;

  @IsOptional()
  @IsEnum(["before", "at_time", "approaching"])
  trigger?: "before" | "at_time" | "approaching";

  @IsBoolean()
  enabled!: boolean;
}

class ManualCalendarEventDto {
  @IsString()
  @MinLength(3)
  title!: string;

  @IsEnum(academicEventCategories)
  category!: AcademicEventCategory;

  @IsEnum(terms)
  term!: AcademicTerm;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  facultyId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualNotificationRuleDto)
  notificationRules?: ManualNotificationRuleDto[];
}

export class CreateManualCalendarDto {
  @IsString()
  universityId!: string;

  @IsString()
  academicYear!: string;

  @IsString()
  @MinLength(3)
  title!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualCalendarEventDto)
  events!: ManualCalendarEventDto[];
}

export class UpdateCalendarDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  title?: string;
}

export class CalendarIngestionRequestDto {
  @IsOptional()
  @IsString()
  universityId?: string;

  @IsOptional()
  @IsString()
  academicYear?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  concurrency?: number;
}
