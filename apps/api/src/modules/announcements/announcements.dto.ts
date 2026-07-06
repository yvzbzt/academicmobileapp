import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export class MyAnnouncementsQueryDto {
  @IsOptional()
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
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}
