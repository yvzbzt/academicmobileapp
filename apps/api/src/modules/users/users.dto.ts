import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import type { UserRole } from "../../../../../packages/shared/src/contracts.js";
import { AUTH_AFFILIATION_ID_MAX_LENGTH, AUTH_FULL_NAME_MAX_LENGTH } from "../auth/auth.constants.js";
import type { AuthUserRecord } from "../auth/auth.types.js";

const ACADEMIC_UNIT_NAME_MAX_LENGTH = 160;
const USER_SEARCH_MAX_LENGTH = 160;

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(AUTH_FULL_NAME_MAX_LENGTH)
  fullName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  classLevel?: number;
}

export class UpdateMyUniversityDto {
  @IsString()
  @MaxLength(AUTH_AFFILIATION_ID_MAX_LENGTH)
  universityId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(AUTH_AFFILIATION_ID_MAX_LENGTH)
  facultyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AUTH_AFFILIATION_ID_MAX_LENGTH)
  departmentId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  classLevel?: number;
}

export class SuggestAcademicUnitDto {
  @IsString()
  @MaxLength(AUTH_AFFILIATION_ID_MAX_LENGTH)
  universityId!: string;

  @IsString()
  @MaxLength(ACADEMIC_UNIT_NAME_MAX_LENGTH)
  facultyName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(ACADEMIC_UNIT_NAME_MAX_LENGTH)
  departmentName?: string;

  @IsOptional()
  @IsIn(["associate", "bachelor", "master", "doctorate"])
  educationLevel?: "associate" | "bachelor" | "master" | "doctorate";
}

export class FollowAcademicScopeDto {
  @IsString()
  @MaxLength(AUTH_AFFILIATION_ID_MAX_LENGTH)
  universityId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(AUTH_AFFILIATION_ID_MAX_LENGTH)
  facultyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AUTH_AFFILIATION_ID_MAX_LENGTH)
  departmentId?: string;
}

export class DeleteMyAccountDto {
  @IsOptional()
  @IsBoolean()
  deleteData?: boolean;
}

export class ListUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(USER_SEARCH_MAX_LENGTH)
  search?: string;

  @IsOptional()
  @IsIn(["active", "inactive", "locked"])
  status?: AuthUserRecord["status"];

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

export class AdminUpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(AUTH_FULL_NAME_MAX_LENGTH)
  fullName?: string;

  @IsOptional()
  @IsIn(["student", "content_editor", "university_admin", "super_admin"])
  role?: UserRole;

  @IsOptional()
  @IsIn(["active", "inactive", "locked"])
  status?: AuthUserRecord["status"];

  @IsOptional()
  @IsString()
  @MaxLength(AUTH_AFFILIATION_ID_MAX_LENGTH)
  universityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AUTH_AFFILIATION_ID_MAX_LENGTH)
  facultyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AUTH_AFFILIATION_ID_MAX_LENGTH)
  departmentId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  classLevel?: number;
}
