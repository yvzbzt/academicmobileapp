import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, MinLength } from "class-validator";
import { AUTH_PASSWORD_MIN_LENGTH } from "./auth.constants.js";

export class RegisterDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(AUTH_PASSWORD_MIN_LENGTH)
  password!: string;

  @IsString()
  @IsNotEmpty()
  passwordConfirmation!: string;

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

export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  idToken!: string;

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
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  deviceId!: string;
}

export class ResendVerificationCodeDto {
  @IsEmail()
  email!: string;
}

export class PasswordRecoveryRequestDto {
  @IsEmail()
  email!: string;
}

export class PasswordRecoveryConfirmDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  newPassword!: string;

  @IsString()
  @IsNotEmpty()
  passwordConfirmation!: string;
}

export class VerifyEmailQueryDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
