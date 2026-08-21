import "reflect-metadata";
import { validate, type ValidationError } from "class-validator";
import { describe, expect, it } from "vitest";
import {
  AUTH_AFFILIATION_ID_MAX_LENGTH,
  AUTH_DEVICE_ID_MAX_LENGTH,
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_FULL_NAME_MAX_LENGTH,
  AUTH_ID_TOKEN_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_REFRESH_TOKEN_MAX_LENGTH,
  EMAIL_VERIFICATION_CODE_LENGTH,
  PASSWORD_RECOVERY_CODE_LENGTH
} from "../src/modules/auth/auth.constants.js";
import {
  GoogleLoginDto,
  LoginDto,
  LogoutDto,
  PasswordRecoveryConfirmDto,
  PasswordRecoveryRequestDto,
  RecentAuthenticationDto,
  RefreshTokenDto,
  RegisterDto,
  ResendVerificationCodeDto,
  VerifyEmailDto,
  VerifyEmailQueryDto
} from "../src/modules/auth/auth.dto.js";

type DtoConstructor = new () => object;

function dto(constructor: DtoConstructor, input: object): object {
  return Object.assign(new constructor(), input);
}

async function errorsFor(constructor: DtoConstructor, input: object): Promise<ValidationError[]> {
  return validate(dto(constructor, input));
}

function expectConstraint(errors: ValidationError[], property: string, constraint: string): void {
  const error = errors.find((candidate) => candidate.property === property);
  expect(error?.constraints, `${property} should fail ${constraint}`).toHaveProperty(constraint);
}

const validEmailAtMaximumLength = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;

describe("auth DTO input length limits", () => {
  it("accepts registration fields at their documented maximum lengths", async () => {
    const password = `Aa1!${"a".repeat(AUTH_PASSWORD_MAX_LENGTH - 4)}`;
    const errors = await errorsFor(RegisterDto, {
      fullName: "a".repeat(AUTH_FULL_NAME_MAX_LENGTH),
      email: validEmailAtMaximumLength,
      password,
      passwordConfirmation: password,
      universityId: "u".repeat(AUTH_AFFILIATION_ID_MAX_LENGTH),
      facultyId: "f".repeat(AUTH_AFFILIATION_ID_MAX_LENGTH),
      departmentId: "d".repeat(AUTH_AFFILIATION_ID_MAX_LENGTH)
    });

    expect(validEmailAtMaximumLength).toHaveLength(AUTH_EMAIL_MAX_LENGTH);
    expect(errors).toEqual([]);
  });

  it.each([
    ["fullName", "a".repeat(AUTH_FULL_NAME_MAX_LENGTH + 1)],
    ["email", "a".repeat(AUTH_EMAIL_MAX_LENGTH + 1)],
    ["password", "a".repeat(AUTH_PASSWORD_MAX_LENGTH + 1)],
    ["passwordConfirmation", "a".repeat(AUTH_PASSWORD_MAX_LENGTH + 1)],
    ["universityId", "a".repeat(AUTH_AFFILIATION_ID_MAX_LENGTH + 1)],
    ["facultyId", "a".repeat(AUTH_AFFILIATION_ID_MAX_LENGTH + 1)],
    ["departmentId", "a".repeat(AUTH_AFFILIATION_ID_MAX_LENGTH + 1)]
  ] as const)("rejects an overlong registration %s", async (property, value) => {
    const errors = await errorsFor(RegisterDto, {
      email: "student@example.com",
      password: "StrongPass123!",
      passwordConfirmation: "StrongPass123!",
      [property]: value
    });

    expectConstraint(errors, property, "maxLength");
  });

  it.each([
    ["login email", LoginDto, { email: "a".repeat(AUTH_EMAIL_MAX_LENGTH + 1), password: "password", deviceId: "device-1" }, "email"],
    ["login password", LoginDto, { email: "student@example.com", password: "a".repeat(AUTH_PASSWORD_MAX_LENGTH + 1), deviceId: "device-1" }, "password"],
    ["login deviceId", LoginDto, { email: "student@example.com", password: "password", deviceId: "a".repeat(AUTH_DEVICE_ID_MAX_LENGTH + 1) }, "deviceId"],
    ["Google idToken", GoogleLoginDto, { idToken: "a".repeat(AUTH_ID_TOKEN_MAX_LENGTH + 1), deviceId: "device-1" }, "idToken"],
    ["Google deviceId", GoogleLoginDto, { idToken: "id-token", deviceId: "a".repeat(AUTH_DEVICE_ID_MAX_LENGTH + 1) }, "deviceId"],
    ["refresh token", RefreshTokenDto, { refreshToken: "a".repeat(AUTH_REFRESH_TOKEN_MAX_LENGTH + 1), deviceId: "device-1" }, "refreshToken"],
    ["refresh deviceId", RefreshTokenDto, { refreshToken: "refresh-token", deviceId: "a".repeat(AUTH_DEVICE_ID_MAX_LENGTH + 1) }, "deviceId"],
    ["logout refresh token", LogoutDto, { refreshToken: "a".repeat(AUTH_REFRESH_TOKEN_MAX_LENGTH + 1) }, "refreshToken"],
    ["verification email", VerifyEmailDto, { email: "a".repeat(AUTH_EMAIL_MAX_LENGTH + 1), code: "123456", deviceId: "device-1" }, "email"],
    ["verification deviceId", VerifyEmailDto, { email: "student@example.com", code: "123456", deviceId: "a".repeat(AUTH_DEVICE_ID_MAX_LENGTH + 1) }, "deviceId"],
    ["resend email", ResendVerificationCodeDto, { email: "a".repeat(AUTH_EMAIL_MAX_LENGTH + 1) }, "email"],
    ["recovery request email", PasswordRecoveryRequestDto, { email: "a".repeat(AUTH_EMAIL_MAX_LENGTH + 1) }, "email"],
    ["recovery confirmation email", PasswordRecoveryConfirmDto, { email: "a".repeat(AUTH_EMAIL_MAX_LENGTH + 1), code: "123456", newPassword: "password", passwordConfirmation: "password" }, "email"],
    ["new password", PasswordRecoveryConfirmDto, { email: "student@example.com", code: "123456", newPassword: "a".repeat(AUTH_PASSWORD_MAX_LENGTH + 1), passwordConfirmation: "password" }, "newPassword"],
    ["new password confirmation", PasswordRecoveryConfirmDto, { email: "student@example.com", code: "123456", newPassword: "password", passwordConfirmation: "a".repeat(AUTH_PASSWORD_MAX_LENGTH + 1) }, "passwordConfirmation"],
    ["recent password", RecentAuthenticationDto, { purpose: "delete_account", method: "password", password: "a".repeat(AUTH_PASSWORD_MAX_LENGTH + 1) }, "password"],
    ["recent Google idToken", RecentAuthenticationDto, { purpose: "delete_account", method: "google", idToken: "a".repeat(AUTH_ID_TOKEN_MAX_LENGTH + 1) }, "idToken"]
  ] as const)("rejects an overlong %s", async (_name, constructor, input, property) => {
    const errors = await errorsFor(constructor, input);
    expectConstraint(errors, property, "maxLength");
  });

  it.each([
    ["verification code below", VerifyEmailDto, { email: "student@example.com", code: "1".repeat(EMAIL_VERIFICATION_CODE_LENGTH - 1), deviceId: "device-1" }, "code"],
    ["verification code above", VerifyEmailDto, { email: "student@example.com", code: "1".repeat(EMAIL_VERIFICATION_CODE_LENGTH + 1), deviceId: "device-1" }, "code"],
    ["recovery code below", PasswordRecoveryConfirmDto, { email: "student@example.com", code: "1".repeat(PASSWORD_RECOVERY_CODE_LENGTH - 1), newPassword: "password", passwordConfirmation: "password" }, "code"],
    ["recovery code above", PasswordRecoveryConfirmDto, { email: "student@example.com", code: "1".repeat(PASSWORD_RECOVERY_CODE_LENGTH + 1), newPassword: "password", passwordConfirmation: "password" }, "code"],
    ["link token below", VerifyEmailQueryDto, { token: "1".repeat(EMAIL_VERIFICATION_CODE_LENGTH - 1) }, "token"],
    ["link token above", VerifyEmailQueryDto, { token: "1".repeat(EMAIL_VERIFICATION_CODE_LENGTH + 1) }, "token"]
  ] as const)("requires exact length for %s", async (_name, constructor, input, property) => {
    const errors = await errorsFor(constructor, input);
    expectConstraint(errors, property, "isLength");
  });

  it("accepts exact-length verification, recovery, and link tokens", async () => {
    await expect(errorsFor(VerifyEmailDto, {
      email: "student@example.com",
      code: "1".repeat(EMAIL_VERIFICATION_CODE_LENGTH),
      deviceId: "device-1"
    })).resolves.toEqual([]);
    await expect(errorsFor(PasswordRecoveryConfirmDto, {
      email: "student@example.com",
      code: "1".repeat(PASSWORD_RECOVERY_CODE_LENGTH),
      newPassword: "password",
      passwordConfirmation: "password"
    })).resolves.toEqual([]);
    await expect(errorsFor(VerifyEmailQueryDto, {
      token: "1".repeat(EMAIL_VERIFICATION_CODE_LENGTH)
    })).resolves.toEqual([]);
  });

  it("requires a non-empty concrete logout refresh token", async () => {
    const missing = await errorsFor(LogoutDto, {});
    const empty = await errorsFor(LogoutDto, { refreshToken: "" });

    expectConstraint(missing, "refreshToken", "isNotEmpty");
    expectConstraint(empty, "refreshToken", "isNotEmpty");
  });
});
