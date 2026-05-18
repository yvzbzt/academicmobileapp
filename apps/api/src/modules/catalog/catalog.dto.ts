import { IsBooleanString, IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, Min, MinLength } from "class-validator";
import type { CatalogStatus, EducationLevel, UniversityType } from "./catalog.types.js";

const universityTypes: UniversityType[] = ["state", "foundation", "private"];
const catalogStatuses: CatalogStatus[] = ["active", "inactive", "archived"];
const educationLevels: EducationLevel[] = ["associate", "bachelor", "master", "doctorate"];

export class ListUniversitiesQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
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
  academicCalendarUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;
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
  academicCalendarUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;
}

export class CreateFacultyDto {
  @IsString()
  @MinLength(2)
  name!: string;
}

export class CreateDepartmentDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEnum(educationLevels)
  educationLevel!: EducationLevel;
}
