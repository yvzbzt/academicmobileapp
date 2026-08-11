import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min, ValidateIf } from "class-validator";
import { academicEventCategories, type AcademicEventCategory } from "../../domain/academic-event.types.js";
import { IsAcademicTemporalValue } from "./calendar-temporal.js";

export const calendarScopeViews = ["university"] as const;
export type CalendarScopeView = "university";

export class UpcomingEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class UniversityCalendarQueryDto {
  @IsOptional()
  academicYear?: string;
}

export class SearchEventsQueryDto {
  @IsOptional()
  @IsIn(academicEventCategories)
  category?: AcademicEventCategory;

  @ValidateIf((_object, value) => value !== undefined)
  @IsAcademicTemporalValue()
  startDate?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsAcademicTemporalValue()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
