import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import type { AcademicUnitScheduleLifecycle, AcademicUnitScheduleType } from "./academic-unit-schedule.types.js";

export class AcademicUnitScheduleSourceQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  universityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  facultyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  departmentId?: string;

  @IsOptional()
  @IsEnum(["course_schedule", "exam_schedule"])
  scheduleType?: AcademicUnitScheduleType;

  @IsOptional()
  @IsEnum(["ready", "processing", "review_required", "quarantined", "materializing", "staged", "published", "rejected", "disabled"])
  lifecycle?: AcademicUnitScheduleLifecycle;

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
  @Max(1_000_000)
  offset?: number;
}

export class IngestAcademicUnitScheduleSourceDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class UpdateAcademicUnitScheduleCandidateDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  title?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  date?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number | null;

  @IsOptional()
  @IsString()
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
  startTime?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
  endTime?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  location?: string | null;
}

export class ReviewAcademicUnitScheduleDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsEnum(["approve", "reject"])
  decision!: "approve" | "reject";

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{4}$/u)
  academicYear?: string;

  @IsOptional()
  @IsEnum(["fall", "spring", "summer", "full_year", "unknown"])
  term?: "fall" | "spring" | "summer" | "full_year" | "unknown";

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  courseRangeStart?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  courseRangeEnd?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(250)
  @IsInt({ each: true })
  @Min(1, { each: true })
  approvedRowNumbers?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PublishAcademicUnitScheduleDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class ReopenAcademicUnitScheduleReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}
