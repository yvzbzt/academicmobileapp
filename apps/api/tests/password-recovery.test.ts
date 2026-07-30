import { HttpException, HttpStatus, Logger, type ExecutionContext } from "@nestjs/common";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimitGuard } from "../src/common/guards/rate-limit.guard.js";
import { validateEnvironment } from "../src/config/environment-validation.js";
import { endpointCatalog } from "../src/contracts/endpoint-catalog.js";
import { AuthApplicationService } from "../src/modules/auth/auth-application.service.js";
import { AUTH_ERROR_CODES, type AuthErrorCode } from "../src/modules/auth/auth.constants.js";
import {
  EmailVerificationSenderService,
  type SendPasswordRecoveryEmailInput,
  type SendVerificationEmailInput
} from "../src/modules/auth/email-verification-sender.service.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import { TokenService } from "../src/modules/auth/token.service.js";

const originalEnv = { ...process.env };

class CapturingPasswordRecoverySender extends EmailVerificationSenderService {
  readonly verificationSent: SendVerificationEmailInput[] = [];
  readonly recoverySent: SendPasswordRecoveryEmailInput[] = [];

  override async sendVerificationEmail(input: SendVerificationEmailInput): Promise<void> {
    this.verificationSent.push(input);
  }

  override async sendPasswordRecoveryEmail(input: SendPasswordRecoveryEmailInput): Promise<void> {
    this.recoverySent.push(input);
  }
}

class FastTestPasswordHasher extends PasswordHasher {
  override async hash(password: string): Promise<string> {
    return createHash("sha256").update(password).digest("hex");
  }

  override async verify(password: string, passwordHash: string): Promise<boolean> {
    return (await this.hash(password)) === passwordHash;
  }
}

function createRecoveryFixture() {
  const repository = new InMemoryAuthRepository();
  const passwordHasher = new FastTestPasswordHasher();
  const tokenService = new TokenService();
  const sender = new CapturingPasswordRecoverySender();
  const service = new AuthApplicationService(repository, passwordHasher, tokenService, sender);
  return { service, repository, passwordHasher, tokenService, sender };
}

function setStoredCredentialGeneration(
  repository: InMemoryAuthRepository,
  userId: string,
  credentialGeneration: number
): void {
  type StoredUser = Record<string, unknown> & { credentialGeneration: number };
  const users = (repository as unknown as { users: Map<string, StoredUser> }).users;
  const user = users.get(userId);
  if (!user) throw new Error("Expected a stored test user.");
  users.set(userId, { ...user, credentialGeneration });
}

async function createActivePasswordUser(
  fixture: ReturnType<typeof createRecoveryFixture>,
  email = "recovery.student@example.com",
  password = "OldPassword123!"
) {
  return fixture.repository.createUser({
    fullName: "Recovery Student",
    email,
    emailVerifiedAt: new Date(),
    passwordHash: await fixture.passwordHasher.hash(password),
    authProvider: "password",
    role: "student",
    status: "active"
  });
}

async function captureHttpException(action: () => Promise<unknown>): Promise<HttpException> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error("Expected an HTTP exception.");
}

function expectControlledError(error: HttpException, status: number, errorCode: AuthErrorCode): void {
  expect(error.getStatus()).toBe(status);
  expect(error.getResponse()).toEqual(expect.objectContaining({ statusCode: status, errorCode }));
}

function createExecutionContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class TestController {}
  } as unknown as ExecutionContext;
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("password recovery", () => {
  it("fails closed without a production-grade digest secret", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PASSWORD_RECOVERY_TOKEN_PEPPER;
    delete process.env.JWT_ACCESS_SECRET;

    expect(() => new TokenService().issuePasswordRecoveryToken("student@example.com"))
      .toThrow("PASSWORD_RECOVERY_TOKEN_PEPPER_NOT_CONFIGURED");
    expect(validateEnvironment(process.env).errors).toContain(
      "PASSWORD_RECOVERY_TOKEN_PEPPER or JWT_ACCESS_SECRET must provide a 32+ character password-recovery digest secret in production."
    );
  });

  it("returns indistinguishable public responses for known and unknown emails", async () => {
    process.env.NODE_ENV = "production";
    process.env.PASSWORD_RECOVERY_TOKEN_PEPPER = "test-password-recovery-pepper-with-at-least-32-characters";
    const fixture = createRecoveryFixture();
    await createActivePasswordUser(fixture);

    const known = await fixture.service.requestPasswordRecovery(" RECOVERY.STUDENT@example.com ");
    const knownDuringCooldown = await fixture.service.requestPasswordRecovery("recovery.student@example.com");
    const unknown = await fixture.service.requestPasswordRecovery("unknown.student@example.com");

    expect(known).toEqual(unknown);
    expect(knownDuringCooldown).toEqual(known);
    expect(known).not.toHaveProperty("previewRecoveryCode");
    expect(fixture.sender.recoverySent).toHaveLength(1);
    expect(fixture.sender.recoverySent[0]?.email).toBe("recovery.student@example.com");
  });

  it("stores only an HMAC digest and supports account-cleanup deletion", async () => {
    const fixture = createRecoveryFixture();
    const user = await createActivePasswordUser(fixture);
    setStoredCredentialGeneration(fixture.repository, user.id, 11);
    await fixture.service.requestPasswordRecovery(user.email);
    const code = fixture.sender.recoverySent[0]!.code;

    expect(await fixture.repository.findPasswordRecoveryTokenByHash(code)).toBeNull();
    const record = await fixture.repository.findPasswordRecoveryTokenByHash(
      fixture.tokenService.hashPasswordRecoveryToken(user.email, code)
    );
    expect(record).toEqual(expect.objectContaining({
      userId: user.id,
      credentialGeneration: 11,
      tokenHash: expect.any(String)
    }));
    expect(JSON.stringify(record)).not.toContain(code);
    expect(JSON.stringify(record)).not.toContain(user.email);
    await fixture.repository.deletePasswordRecoveryTokensByUserId(user.id);
    expect(await fixture.repository.findPasswordRecoveryTokenByHash(
      fixture.tokenService.hashPasswordRecoveryToken(user.email, code)
    )).toBeNull();
  });

  it("rejects invalid and expired recovery codes with distinct controlled errors", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T08:00:00.000Z"));
    const fixture = createRecoveryFixture();
    const user = await createActivePasswordUser(fixture);
    await fixture.service.requestPasswordRecovery(user.email);
    const code = fixture.sender.recoverySent[0]!.code;

    const invalid = await captureHttpException(() => fixture.service.confirmPasswordRecovery({
      email: user.email,
      code: "000000" === code ? "000001" : "000000",
      newPassword: "NewPassword123!",
      passwordConfirmation: "NewPassword123!"
    }));
    expectControlledError(invalid, HttpStatus.UNAUTHORIZED, AUTH_ERROR_CODES.PASSWORD_RECOVERY_CODE_INVALID);

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    const expired = await captureHttpException(() => fixture.service.confirmPasswordRecovery({
      email: user.email,
      code,
      newPassword: "NewPassword123!",
      passwordConfirmation: "NewPassword123!"
    }));
    expectControlledError(expired, HttpStatus.UNAUTHORIZED, AUTH_ERROR_CODES.PASSWORD_RECOVERY_CODE_EXPIRED);
  });

  it("invalidates older recovery material when a later request is accepted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T08:00:00.000Z"));
    const fixture = createRecoveryFixture();
    const user = await createActivePasswordUser(fixture);
    await fixture.service.requestPasswordRecovery(user.email);
    const firstCode = fixture.sender.recoverySent[0]!.code;

    vi.advanceTimersByTime(61_000);
    await fixture.service.requestPasswordRecovery(user.email);
    const secondCode = fixture.sender.recoverySent[1]!.code;
    expect(secondCode).toMatch(/^\d{6}$/);

    const oldCodeError = await captureHttpException(() => fixture.service.confirmPasswordRecovery({
      email: user.email,
      code: firstCode,
      newPassword: "NewPassword123!",
      passwordConfirmation: "NewPassword123!"
    }));
    expectControlledError(oldCodeError, HttpStatus.UNAUTHORIZED, AUTH_ERROR_CODES.PASSWORD_RECOVERY_CODE_INVALID);

    await expect(fixture.service.confirmPasswordRecovery({
      email: user.email,
      code: secondCode,
      newPassword: "NewPassword123!",
      passwordConfirmation: "NewPassword123!"
    })).resolves.toEqual({ status: "password_reset" });
  });

  it("enforces password parity and confirmation without consuming a valid code", async () => {
    const fixture = createRecoveryFixture();
    const user = await createActivePasswordUser(fixture);
    await fixture.service.requestPasswordRecovery(user.email);
    const code = fixture.sender.recoverySent[0]!.code;

    const mismatch = await captureHttpException(() => fixture.service.confirmPasswordRecovery({
      email: user.email,
      code,
      newPassword: "NewPassword123!",
      passwordConfirmation: "DifferentPassword123!"
    }));
    expectControlledError(mismatch, HttpStatus.BAD_REQUEST, AUTH_ERROR_CODES.PASSWORD_CONFIRMATION_MISMATCH);

    const tooShort = await captureHttpException(() => fixture.service.confirmPasswordRecovery({
      email: user.email,
      code,
      newPassword: "short",
      passwordConfirmation: "short"
    }));
    expectControlledError(tooShort, HttpStatus.BAD_REQUEST, AUTH_ERROR_CODES.PASSWORD_INVALID);

    await expect(fixture.service.confirmPasswordRecovery({
      email: user.email,
      code,
      newPassword: "NewPassword123!",
      passwordConfirmation: "NewPassword123!"
    })).resolves.toEqual({ status: "password_reset" });
  });

  it("changes the password, preserves the current generation without pre-A2 mismatch enforcement, and revokes sessions", async () => {
    const fixture = createRecoveryFixture();
    const user = await createActivePasswordUser(fixture);
    setStoredCredentialGeneration(fixture.repository, user.id, 5);
    const existingSession = await fixture.service.login({
      email: user.email,
      password: "OldPassword123!",
      deviceId: "existing-device"
    });
    await fixture.service.requestPasswordRecovery(user.email);
    const code = fixture.sender.recoverySent[0]!.code;
    setStoredCredentialGeneration(fixture.repository, user.id, 6);

    await expect(fixture.service.confirmPasswordRecovery({
      email: user.email,
      code,
      newPassword: "NewPassword123!",
      passwordConfirmation: "NewPassword123!"
    })).resolves.toEqual({ status: "password_reset" });
    await expect(fixture.repository.findUserById(user.id)).resolves.toEqual(
      expect.objectContaining({ credentialGeneration: 6 })
    );

    const oldPasswordError = await captureHttpException(() => fixture.service.login({
      email: user.email,
      password: "OldPassword123!",
      deviceId: "old-password-device"
    }));
    expectControlledError(oldPasswordError, HttpStatus.UNAUTHORIZED, AUTH_ERROR_CODES.INVALID_CREDENTIALS);
    await expect(fixture.service.login({
      email: user.email,
      password: "NewPassword123!",
      deviceId: "new-password-device"
    })).resolves.toEqual(expect.objectContaining({ user: expect.objectContaining({ id: user.id }) }));

    const refreshError = await captureHttpException(() => fixture.service.refresh({
      refreshToken: existingSession.refreshToken,
      deviceId: "existing-device"
    }));
    expectControlledError(refreshError, HttpStatus.UNAUTHORIZED, AUTH_ERROR_CODES.SESSION_INVALID);

    const reusedCodeError = await captureHttpException(() => fixture.service.confirmPasswordRecovery({
      email: user.email,
      code,
      newPassword: "ThirdPassword123!",
      passwordConfirmation: "ThirdPassword123!"
    }));
    expectControlledError(reusedCodeError, HttpStatus.UNAUTHORIZED, AUTH_ERROR_CODES.PASSWORD_RECOVERY_CODE_INVALID);
  });

  it("does not write recovery secrets, credentials, tokens, or personal values to logs", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const repository = new InMemoryAuthRepository();
    const passwordHasher = new FastTestPasswordHasher();
    const service = new AuthApplicationService(
      repository,
      passwordHasher,
      new TokenService(),
      new EmailVerificationSenderService()
    );
    const personal = {
      email: "private.recovery.student@example.com",
      fullName: "Private Recovery Student",
      oldPassword: "PrivateOldPassword123!",
      newPassword: "PrivateNewPassword123!"
    };
    await repository.createUser({
      fullName: personal.fullName,
      email: personal.email,
      emailVerifiedAt: new Date(),
      passwordHash: await passwordHasher.hash(personal.oldPassword),
      authProvider: "password",
      role: "student",
      status: "active"
    });
    const session = await service.login({ email: personal.email, password: personal.oldPassword, deviceId: "private-device" });
    const recovery = await service.requestPasswordRecovery(personal.email);
    const code = recovery.previewRecoveryCode!;
    await service.confirmPasswordRecovery({
      email: personal.email,
      code,
      newPassword: personal.newPassword,
      passwordConfirmation: personal.newPassword
    });

    const serializedLogs = JSON.stringify([warnSpy.mock.calls, logSpy.mock.calls, errorSpy.mock.calls]);
    expect(warnSpy).toHaveBeenCalledWith(
      "SMTP is not configured. Password recovery email was not sent in this non-production environment."
    );
    for (const sensitiveValue of [
      personal.email,
      personal.fullName,
      personal.oldPassword,
      personal.newPassword,
      code,
      session.accessToken,
      session.refreshToken
    ]) {
      expect(serializedLogs).not.toContain(sensitiveValue);
    }
  });

  it("applies the strict IP rate-limit policy to both recovery endpoints", async () => {
    expect(endpointCatalog).toEqual(expect.arrayContaining([
      { method: "POST", path: "/auth/password-recovery/request", authRequired: false, roles: "public", rateLimit: "strict" },
      { method: "POST", path: "/auth/password-recovery/confirm", authRequired: false, roles: "public", rateLimit: "strict" }
    ]));
    const guard = new RateLimitGuard();
    const request = { method: "POST", route: { path: "/auth/password-recovery/request" }, ip: "192.0.2.10" };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(guard.canActivate(createExecutionContext(request))).resolves.toBe(true);
    }
    const limited = await captureHttpException(() => guard.canActivate(createExecutionContext(request)));
    expectControlledError(limited, HttpStatus.TOO_MANY_REQUESTS, AUTH_ERROR_CODES.RATE_LIMITED);
  });
});
