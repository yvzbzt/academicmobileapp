import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";
import type { UserRole } from "../../../../../packages/shared/src/contracts.js";
import type { AuthUserRecord } from "../auth/auth.types.js";

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  classLevel?: number;
}

export class UpdateMyUniversityDto {
  @IsString()
  universityId!: string;

  @IsOptional()
  @IsString()
  facultyId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  classLevel?: number;
}

export class SuggestAcademicUnitDto {
  @IsString()
  universityId!: string;

  @IsString()
  facultyName!: string;

  @IsOptional()
  @IsString()
  departmentName?: string;

  @IsOptional()
  @IsIn(["associate", "bachelor", "master", "doctorate"])
  educationLevel?: "associate" | "bachelor" | "master" | "doctorate";
}

export class FollowAcademicScopeDto {
  @IsString()
  universityId!: string;

  @IsOptional()
  @IsString()
  facultyId?: string;

  @IsOptional()
  @IsString()
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
  fullName?: string;

  @IsOptional()
  @IsIn(["student", "content_editor", "university_admin", "super_admin"])
  role?: UserRole;

  @IsOptional()
  @IsIn(["active", "inactive", "locked"])
  status?: AuthUserRecord["status"];

  @IsOptional()
  @IsString()
  universityId?: string;

  @IsOptional()
  @IsString()
  facultyId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  classLevel?: number;
}
