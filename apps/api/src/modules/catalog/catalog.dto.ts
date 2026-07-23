import { Type } from "class-transformer";
import { IsArray, IsBooleanString, IsEnum, IsInt, IsOptional, IsString, IsUrl, Matches, Max, Min, MinLength } from "class-validator";
import type { CatalogStatus, EducationLevel, UniversityType } from "./catalog.types.js";

const universityTypes: UniversityType[] = ["state", "foundation", "private"];
const catalogStatuses: CatalogStatus[] = ["active", "inactive", "archived"];
const educationLevels: EducationLevel[] = ["associate", "bachelor", "master", "doctorate"];

export class ListUniversitiesQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

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
  offset?: number;

  @IsOptional()
  @IsBooleanString()
  includeInactive?: string;
}

export class CreateUniversityDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  city!: string;

  @IsEnum(universityTypes)
  type!: UniversityType;

  @IsOptional()
  @IsUrl({ require_tld: false })
  websiteUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  announcementUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  academicCalendarUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emailDomains?: string[];
}

export class UpdateUniversityDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  city?: string;

  @IsOptional()
  @IsEnum(universityTypes)
  type?: UniversityType;

  @IsOptional()
  @IsEnum(catalogStatuses)
  status?: CatalogStatus;

  @IsOptional()
  @IsUrl({ require_tld: false })
  websiteUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  announcementUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  academicCalendarUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emailDomains?: string[];
}

export class CreateFacultyDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  websiteUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  announcementUrl?: string;
}

export class UpdateFacultyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEnum(catalogStatuses)
  status?: CatalogStatus;

  @IsOptional()
  @IsUrl({ require_tld: false })
  websiteUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  announcementUrl?: string;
}

export class CreateDepartmentDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEnum(educationLevels)
  educationLevel!: EducationLevel;

  @IsOptional()
  @IsUrl({ require_tld: false })
  websiteUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  announcementUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  courseScheduleUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  examScheduleUrl?: string;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEnum(educationLevels)
  educationLevel?: EducationLevel;

  @IsOptional()
  @IsEnum(catalogStatuses)
  status?: CatalogStatus;

  @IsOptional()
  @IsUrl({ require_tld: false })
  websiteUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  announcementUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  courseScheduleUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  examScheduleUrl?: string;
}

export class AddUniversityEmailDomainDto {
  @IsString()
  @Matches(/^[a-z0-9.-]+\.[a-z]{2,}$/i)
  domain!: string;
}
