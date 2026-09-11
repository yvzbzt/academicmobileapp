import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { adminUniversityAccessFor } from "../../common/authorization/admin-university-access.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import {
  VERIFIED_SOURCE_COVERAGE_RESOLUTIONS,
  VERIFIED_SOURCE_COVERAGE_SOURCE_TYPES,
  type VerifiedSourceCoverageResolution,
  type VerifiedSourceCoverageScopeType,
  type VerifiedSourceCoverageSourceType
} from "./verified-source-coverage.types.js";
import { VerifiedSourceCoverageService } from "./verified-source-coverage.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";

export class VerifiedSourceCoverageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  universityId?: string;

  @IsOptional()
  @IsIn(["faculty", "department"])
  scopeType?: VerifiedSourceCoverageScopeType;

  @IsOptional()
  @IsIn(VERIFIED_SOURCE_COVERAGE_SOURCE_TYPES)
  sourceType?: VerifiedSourceCoverageSourceType;

  @IsOptional()
  @IsIn(VERIFIED_SOURCE_COVERAGE_RESOLUTIONS)
  resolution?: VerifiedSourceCoverageResolution;

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

@Controller("admin/source-coverage")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("content_editor", "university_admin", "super_admin")
export class AdminVerifiedSourceCoverageController {
  constructor(@Inject(VerifiedSourceCoverageService) private readonly coverageService: VerifiedSourceCoverageService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: VerifiedSourceCoverageQueryDto) {
    const access = adminUniversityAccessFor(user);
    return this.coverageService.listCoverage(access.kind === "global"
      ? query
      : { ...query, universityId: access.universityId });
  }
}
