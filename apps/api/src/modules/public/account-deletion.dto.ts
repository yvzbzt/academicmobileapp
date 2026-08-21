import { IsEmail, IsIn, IsNotEmpty, IsString, Length, MaxLength } from "class-validator";
import { AUTH_EMAIL_MAX_LENGTH, AUTH_PASSWORD_MAX_LENGTH } from "../auth/auth.constants.js";

export class AccountDeletionRequestCodeDto {
  @IsEmail()
  @MaxLength(AUTH_EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_PASSWORD_MAX_LENGTH)
  password!: string;
}

export class AccountDeletionConfirmDto {
  @IsEmail()
  @MaxLength(AUTH_EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(AUTH_PASSWORD_MAX_LENGTH)
  password!: string;

  @IsString()
  @Length(6, 6)
  code!: string;

  @IsIn(["data", "account"])
  deletionType!: "data" | "account";
}
