import { IsEmail, IsIn, IsNotEmpty, IsString, Length } from "class-validator";

export class AccountDeletionRequestCodeDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class AccountDeletionConfirmDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @Length(6, 6)
  code!: string;

  @IsIn(["data", "account"])
  deletionType!: "data" | "account";
}
