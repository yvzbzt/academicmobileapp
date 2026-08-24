import { IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import {
  AUTH_AFFILIATION_ID_MAX_LENGTH,
  AUTH_DEVICE_ID_MAX_LENGTH,
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_FULL_NAME_MAX_LENGTH,
  AUTH_ID_TOKEN_MAX_LENGTH,
  AUTH_NONCE_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  AUTH_REFRESH_TOKEN_MAX_LENGTH,
  EMAIL_VERIFICATION_CODE_LENGTH,
  PASSWORD_RECOVERY_CODE_LENGTH
} from "./auth.constants.js";

export class RegisterDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(AUTH_FULL_NAME_MAX_LENGTH)
  fullName?: string;

  @IsEmail()
  @MaxLength(AUTH_EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @MinLength(AUTH_PASSWORD_MIN_LENGTH)
  @MaxLength(AUTH_PASSWORD_MAX_LENGTH)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_PASSWORD_MAX_LENGTH)
  passwordConfirmation!: string;

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

export class LoginDto {
  @IsEmail()
  @MaxLength(AUTH_EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_PASSWORD_MAX_LENGTH)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_DEVICE_ID_MAX_LENGTH)
  deviceId!: string;
}

export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_ID_TOKEN_MAX_LENGTH)
  idToken!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_DEVICE_ID_MAX_LENGTH)
  deviceId!: string;
}

export class AppleLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_ID_TOKEN_MAX_LENGTH)
  identityToken!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_NONCE_MAX_LENGTH)
  nonce!: string;

  @IsOptional()
  @IsString()
  @MaxLength(AUTH_FULL_NAME_MAX_LENGTH)
  fullName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_DEVICE_ID_MAX_LENGTH)
  deviceId!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_REFRESH_TOKEN_MAX_LENGTH)
  refreshToken!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_DEVICE_ID_MAX_LENGTH)
  deviceId!: string;
}

export class LogoutDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_REFRESH_TOKEN_MAX_LENGTH)
  refreshToken!: string;
}

export class VerifyEmailDto {
  @IsEmail()
  @MaxLength(AUTH_EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @Length(EMAIL_VERIFICATION_CODE_LENGTH, EMAIL_VERIFICATION_CODE_LENGTH)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_DEVICE_ID_MAX_LENGTH)
  deviceId!: string;
}

export class ResendVerificationCodeDto {
  @IsEmail()
  @MaxLength(AUTH_EMAIL_MAX_LENGTH)
  email!: string;
}

export class PasswordRecoveryRequestDto {
  @IsEmail()
  @MaxLength(AUTH_EMAIL_MAX_LENGTH)
  email!: string;
}

export class PasswordRecoveryConfirmDto {
  @IsEmail()
  @MaxLength(AUTH_EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @Length(PASSWORD_RECOVERY_CODE_LENGTH, PASSWORD_RECOVERY_CODE_LENGTH)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_PASSWORD_MAX_LENGTH)
  newPassword!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_PASSWORD_MAX_LENGTH)
  passwordConfirmation!: string;
}

export class RecentAuthenticationDto {
  @IsIn(["delete_personal_data", "delete_account"])
  purpose!: "delete_personal_data" | "delete_account";

  @IsIn(["password", "google", "apple"])
  method!: "password" | "google" | "apple";

  @ValidateIf((input: RecentAuthenticationDto) => input.method === "password")
  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_PASSWORD_MAX_LENGTH)
  password?: string;

  @ValidateIf((input: RecentAuthenticationDto) => input.method === "google")
  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_ID_TOKEN_MAX_LENGTH)
  idToken?: string;

  @ValidateIf((input: RecentAuthenticationDto) => input.method === "apple")
  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_ID_TOKEN_MAX_LENGTH)
  identityToken?: string;

  @ValidateIf((input: RecentAuthenticationDto) => input.method === "apple")
  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_NONCE_MAX_LENGTH)
  nonce?: string;
}

export class VerifyEmailQueryDto {
  @IsString()
  @IsNotEmpty()
  @Length(EMAIL_VERIFICATION_CODE_LENGTH, EMAIL_VERIFICATION_CODE_LENGTH)
  token!: string;
}
