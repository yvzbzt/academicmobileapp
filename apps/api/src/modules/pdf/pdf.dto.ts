import { IsHexadecimal, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, Min, MinLength } from "class-validator";
import { academicEventCategories, type AcademicEventCategory } from "../../domain/academic-event.types.js";

export class CreatePdfSourceDto {
  @IsString()
  universityId!: string;

  @IsString()
  @MinLength(3)
  fileName!: string;

  @IsString()
  mimeType!: string;

  @IsHexadecimal()
  magicBytesHex!: string;

  @IsInt()
  @Min(1)
  fileSize!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  pageCount!: number;

  @IsString()
  academicYear!: string;

  @IsOptional()
  @IsString()
  rawText?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;
}

export class ListExtractedEventsQueryDto {
  @IsOptional()
  @IsString()
  pdfSourceId?: string;

  @IsOptional()
  @IsIn(["pending_review", "approved", "rejected"])
  status?: "pending_review" | "approved" | "rejected";

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

export class UpdateExtractedEventDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  normalizedTitle?: string;

  @IsOptional()
  @IsIn(academicEventCategories)
  normalizedCategory?: AcademicEventCategory;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  adminNote?: string;
}

export class RejectExtractedEventDto {
  @IsOptional()
  @IsString()
  adminNote?: string;
}
