import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10)
  password!: string;

  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @IsString()
  @IsNotEmpty()
  universityId!: string;

  @IsString()
  @IsNotEmpty()
  facultyId!: string;

  @IsString()
  @IsNotEmpty()
  departmentId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  classLevel?: number;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @IsNotEmpty()
  deviceId!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;

  @IsString()
  @IsNotEmpty()
  deviceId!: string;
}

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @IsNotEmpty()
  deviceId!: string;
}

export class VerifyEmailQueryDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
