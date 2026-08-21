import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength } from "class-validator";

export class MyAnnouncementsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

}

export class AnnouncementDiscoveryRequestDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(205)
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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
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
