import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";
import { academicEventCategories, type AcademicEventCategory } from "../../domain/academic-event.types.js";

export class UpcomingEventsQueryDto {
  @IsOptional()
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

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}
