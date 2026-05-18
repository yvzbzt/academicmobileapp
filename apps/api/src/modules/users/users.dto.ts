import { IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
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
  @Max(8)
  classLevel?: number;
}
