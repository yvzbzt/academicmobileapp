import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import {
  ACADEMIC_CONTENT_BODY_BLOCK_MAX_LENGTH,
  ACADEMIC_CONTENT_BODY_MAX_BLOCKS,
  ACADEMIC_CONTENT_SUMMARY_MAX_LENGTH
} from "../../../../../packages/shared/src/contracts.js";

export class MyAnnouncementsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

}

export class MobileSourceManifestQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-f\d]{64}$/u)
  knownVersion?: string;
}

export class AnnouncementDiscoveryRequestDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  concurrency?: number;

  @IsOptional()
  @IsBoolean()
  refreshSources?: boolean;
}

export class AnnouncementIngestionRequestDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  concurrency?: number;
}

export class AnnouncementSourcesQueryDto {
  @IsOptional()
  @IsIn(["active", "inactive"])
  status?: "active" | "inactive";

  @IsOptional()
  @IsIn(["trusted", "rejected", "quarantined", "pending_review"])
  trustStatus?: "trusted" | "rejected" | "quarantined" | "pending_review";

  @IsOptional()
  @IsIn(["announcement", "news", "event"])
  contentType?: "announcement" | "news" | "event";

  @IsOptional()
  @IsIn(["university", "faculty", "department"])
  scopeType?: "university" | "faculty" | "department";

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(101)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  offset?: number;
}

export class AnnouncementSourceParserConfigDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  itemSelector?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  titleSelector?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  linkSelector?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  dateSelector?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  eventDateSelector?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  contentSelector?: string;
}

export class UpdateUniversityContentSourceProfileDto {
  @IsUrl({ protocols: ["https"], require_protocol: true, require_tld: true })
  @MaxLength(2048)
  sourceUrl!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  sourceName?: string;

  @IsIn(["auto", "rss", "html"])
  parser!: "auto" | "rss" | "html";

  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementSourceParserConfigDto)
  parserConfig?: AnnouncementSourceParserConfigDto;

  @IsOptional()
  @IsIn(["active", "inactive"])
  status?: "active" | "inactive";
}

export class PreviewUniversityContentSourceProfileDto {
  @IsOptional()
  @IsBoolean()
  activateWhenHealthy?: boolean;
}

export class CreateAnnouncementSourceDto {
  @IsIn(["university", "faculty", "department"])
  scopeType!: "university" | "faculty" | "department";

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  universityId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  facultyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  departmentId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  sourceName!: string;

  @IsUrl({ protocols: ["https"], require_protocol: true, require_tld: true })
  @MaxLength(2048)
  sourceUrl!: string;

  @IsIn(["announcement", "news", "event"])
  contentType!: "announcement" | "news" | "event";

  @IsIn(["auto", "rss", "html"])
  parser!: "auto" | "rss" | "html";

  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementSourceParserConfigDto)
  parserConfig?: AnnouncementSourceParserConfigDto;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  priority!: number;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(10080)
  fetchIntervalMinutes!: number;
}

export class UpdateAnnouncementSourceDto {
  @IsString()
  @MaxLength(64)
  expectedSourceDefinitionVersion!: string;

  @IsUrl({ protocols: ["https"], require_protocol: true, require_tld: true })
  @MaxLength(2048)
  expectedCanonicalUrl!: string;

  @IsIn(["trusted", "rejected", "quarantined"])
  expectedTrustStatus!: "trusted" | "rejected" | "quarantined";

  @IsIn(["active", "inactive"])
  expectedSourceStatus!: "active" | "inactive";

  @IsBoolean()
  expectedApprovalPending!: boolean;

  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  sourceName?: string;

  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true, require_tld: true })
  @MaxLength(2048)
  sourceUrl?: string;

  @IsOptional()
  @IsIn(["announcement", "news", "event"])
  contentType?: "announcement" | "news" | "event";

  @IsOptional()
  @IsIn(["auto", "rss", "html"])
  parser?: "auto" | "rss" | "html";

  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementSourceParserConfigDto)
  parserConfig?: AnnouncementSourceParserConfigDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  priority?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(10080)
  fetchIntervalMinutes?: number;

  @IsOptional()
  @IsIn(["active", "inactive"])
  status?: "active" | "inactive";
}

export class AnnouncementSourceReviewDto {
  @IsString()
  @MaxLength(64)
  expectedSourceDefinitionVersion!: string;

  @IsUrl({ protocols: ["https"], require_protocol: true, require_tld: true })
  @MaxLength(2048)
  expectedCanonicalUrl!: string;

  @IsIn(["trusted", "rejected", "quarantined"])
  expectedTrustStatus!: "trusted" | "rejected" | "quarantined";

  @IsIn(["active", "inactive"])
  expectedSourceStatus!: "active" | "inactive";

  @IsBoolean()
  expectedApprovalPending!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AnnouncementReviewItemsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  sourceId?: string;

  @IsOptional()
  @IsIn(["pending_review", "approved", "rejected"])
  reviewStatus?: "pending_review" | "approved" | "rejected";

  @IsOptional()
  @IsIn(["announcement", "news", "event"])
  contentType?: "announcement" | "news" | "event";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  offset?: number;
}

class AnnouncementReviewBodyBlockDto {
  @IsIn(["heading", "paragraph", "bullet"])
  type!: "heading" | "paragraph" | "bullet";

  @IsString()
  @MinLength(1)
  @MaxLength(ACADEMIC_CONTENT_BODY_BLOCK_MAX_LENGTH)
  text!: string;
}

export class UpdateAnnouncementReviewItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  expectedSnapshotId?: string;

  @IsString()
  @Matches(/^[a-f\d]{64}$/iu)
  expectedContentFingerprint!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  expectedReviewRevision?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ACADEMIC_CONTENT_SUMMARY_MAX_LENGTH)
  summary?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ACADEMIC_CONTENT_BODY_MAX_BLOCKS)
  @ValidateNested({ each: true })
  @Type(() => AnnouncementReviewBodyBlockDto)
  body?: AnnouncementReviewBodyBlockDto[];

  @IsOptional()
  @IsIn(["relevant", "not_relevant", "uncertain"])
  studentRelevance?: "relevant" | "not_relevant" | "uncertain";

  @IsOptional()
  @IsIn([
    "academic_calendar", "admission", "course_registration", "course_schedule", "double_major_minor",
    "education_opportunity", "exam", "horizontal_transfer", "scholarship", "internship", "exchange",
    "graduation", "tuition", "housing", "competition", "student_achievement", "student_event",
    "personnel_recruitment", "procurement", "internal_operations", "unknown"
  ])
  topic?: string;

  @IsOptional()
  audience?: unknown;

  @IsOptional()
  @IsIn(["apply", "attend", "pay", "register", "review", "submit", "unknown"])
  actionType?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:unknown|\d{4}-\d{2}-\d{2})$/u)
  deadline?: string;

  @IsOptional()
  @IsIn(["critical", "high", "normal", "low", "unknown"])
  urgency?: string;

  @IsOptional()
  @IsIn(["pending_review", "approved", "rejected"])
  reviewStatus?: "pending_review" | "approved" | "rejected";

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}

export class RunSingleContentLlmReviewDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  expectedSnapshotId?: string;

  @IsString()
  @Matches(/^[a-f\d]{64}$/iu)
  expectedContentFingerprint!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  expectedReviewRevision?: string;
}

export class UpdateContentLlmSettingsDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsIn(["openai"])
  provider!: "openai";

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  model!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  apiKey?: string;
}

export class DeleteContentLlmApiKeyDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class RunContentLlmReviewDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1)
  limit?: number;
}
