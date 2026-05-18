import { IsOptional, IsString, MinLength } from "class-validator";

export class CreateCalendarDraftDto {
  @IsString()
  universityId!: string;

  @IsString()
  academicYear!: string;

  @IsString()
  @MinLength(3)
  title!: string;

  @IsString()
  sourcePdfId!: string;
}

export class UpdateCalendarDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  title?: string;
}
