import "reflect-metadata";
import { Module, ValidationPipe } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard.js";
import { RecentAuthGuard } from "../src/common/guards/recent-auth.guard.js";
import { RolesGuard } from "../src/common/guards/roles.guard.js";
import { AuthApplicationService } from "../src/modules/auth/auth-application.service.js";
import { AUTH_ERROR_CODES } from "../src/modules/auth/auth.constants.js";
import { AuthController } from "../src/modules/auth/auth.controller.js";
import {
  EmailVerificationSenderService,
  type SendPasswordRecoveryEmailInput,
  type SendVerificationEmailInput
} from "../src/modules/auth/email-verification-sender.service.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import { TokenService } from "../src/modules/auth/token.service.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import { AdminUsersController, UsersController } from "../src/modules/users/users.controller.js";
import { UsersService } from "../src/modules/users/users.service.js";
import { TestUserDataRepository } from "./support/test-user-data.repository.js";

class CapturingEmailSender extends EmailVerificationSenderService {
  readonly sent: SendVerificationEmailInput[] = [];
  readonly recoverySent: SendPasswordRecoveryEmailInput[] = [];

  override async sendVerificationEmail(input: SendVerificationEmailInput): Promise<void> {
    this.sent.push(input);
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

type JsonResponse = {
  status: number;
  body: Record<string, unknown>;
};

describe("auth and academic-profile HTTP contracts", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("serializes controlled auth errors, rotates a session, and clears hierarchy descendants", async () => {
    const authRepository = new InMemoryAuthRepository();
    const catalogRepository = new InMemoryCatalogRepository();
    const tokenService = new TokenService();
    const sender = new CapturingEmailSender();
    const authService = new AuthApplicationService(
      authRepository,
      new FastTestPasswordHasher(),
      tokenService,
      sender,
      undefined,
      catalogRepository
    );
    const userDataRepository = new TestUserDataRepository();
    const usersService = new UsersService(authRepository, catalogRepository, userDataRepository);

    class ContractTestModule {}
    Module({
      controllers: [AuthController, UsersController, AdminUsersController],
      providers: [
        { provide: AuthApplicationService, useValue: authService },
        { provide: UsersService, useValue: usersService },
        { provide: TokenService, useValue: tokenService },
        { provide: "AuthRepository", useValue: authRepository },
        JwtAuthGuard,
        RecentAuthGuard,
        RolesGuard,
        Reflector
      ]
    })(ContractTestModule);

    app = await NestFactory.create(ContractTestModule, { logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const request = async (path: string, init: RequestInit): Promise<JsonResponse> => {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) }
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };

    const firstUniversity = await catalogRepository.createUniversity({
      name: "HTTP First University",
      slug: "http-first-university",
      city: "Ankara",
      type: "state",
      status: "active"
    });
    const secondUniversity = await catalogRepository.createUniversity({
      name: "HTTP Second University",
      slug: "http-second-university",
      city: "İzmir",
      type: "state",
      status: "active"
    });
    const firstFaculty = await catalogRepository.createFaculty({
      universityId: firstUniversity.id,
      name: "HTTP Faculty",
      slug: "http-faculty",
      status: "active"
    });
    const firstDepartment = await catalogRepository.createDepartment({
      universityId: firstUniversity.id,
      facultyId: firstFaculty.id,
      name: "HTTP Department",
      slug: "http-department",
      educationLevel: "bachelor",
      status: "active"
    });

    const registration = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: "HTTP Student",
        email: "HTTP.STUDENT@example.com",
        password: "  Spaced-pass1  ",
        passwordConfirmation: "  Spaced-pass1  "
      })
    });
    expect(registration.status).toBe(201);
    expect(registration.body).toEqual(expect.objectContaining({
      status: "verification_required",
      email: "http.student@example.com",
      verificationExpiresAt: expect.any(String),
      resendAvailableAt: expect.any(String)
    }));
    expect(JSON.stringify(registration.body)).not.toContain("Spaced-pass1");

    const unverifiedLogin = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "http.student@example.com",
        password: "  Spaced-pass1  ",
        deviceId: "http-device"
      })
    });
    expect(unverifiedLogin).toEqual({
      status: 401,
      body: expect.objectContaining({ errorCode: AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED })
    });

    const unknownResend = await request("/auth/resend-verification-code", {
      method: "POST",
      body: JSON.stringify({ email: "missing@example.com" })
    });
    expect(unknownResend).toEqual({
      status: 401,
      body: expect.objectContaining({ errorCode: AUTH_ERROR_CODES.VERIFICATION_REQUEST_INVALID })
    });

    const cooldown = await request("/auth/resend-verification-code", {
      method: "POST",
      body: JSON.stringify({ email: "http.student@example.com" })
    });
    expect(cooldown.status).toBe(429);
    expect(cooldown.body).toEqual(expect.objectContaining({
      errorCode: AUTH_ERROR_CODES.RATE_LIMITED,
      resendAvailableAt: registration.body.resendAvailableAt,
      details: { resendAvailableAt: registration.body.resendAvailableAt }
    }));

    const verification = await request("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({
        email: "http.student@example.com",
        code: sender.sent[0]?.code,
        deviceId: "http-device"
      })
    });
    expect(verification).toEqual({
      status: 201,
      body: { status: "verified", email: "http.student@example.com" }
    });

    const wrongPassword = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "http.student@example.com",
        password: "wrong-password",
        deviceId: "http-device"
      })
    });
    expect(wrongPassword).toEqual({
      status: 401,
      body: expect.objectContaining({ errorCode: AUTH_ERROR_CODES.INVALID_CREDENTIALS })
    });

    const login = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "http.student@example.com",
        password: "  Spaced-pass1  ",
        deviceId: "http-device"
      })
    });
    expect(login.status).toBe(201);
    expect(login.body).toEqual(expect.objectContaining({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: expect.objectContaining({ email: "http.student@example.com" })
    }));

    const invalidLogoutBodies: Array<{ name: string; body?: string }> = [
      { name: "missing" },
      { name: "empty object", body: JSON.stringify({}) },
      { name: "empty refresh token", body: JSON.stringify({ refreshToken: "" }) }
    ];
    for (const invalidLogout of invalidLogoutBodies) {
      const response = await request("/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${login.body.accessToken as string}` },
        ...(invalidLogout.body === undefined ? {} : { body: invalidLogout.body })
      });
      expect(response.status, invalidLogout.name).toBe(400);
    }

    const rotated = await request("/auth/refresh-token", {
      method: "POST",
      body: JSON.stringify({ refreshToken: login.body.refreshToken, deviceId: "http-device" })
    });
    expect(rotated.status).toBe(201);
    expect(rotated.body.refreshToken).not.toBe(login.body.refreshToken);

    await userDataRepository.createAcademicUnitSuggestion({
      userId: "other-http-student",
      userEmail: "other.http.student@example.com",
      universityId: firstUniversity.id,
      facultyName: "Private Faculty Suggestion",
      educationLevel: "bachelor"
    });
    const forbiddenSuggestionList = await request("/admin/users/academic-unit-suggestions?status=pending", {
      method: "GET",
      headers: { Authorization: `Bearer ${rotated.body.accessToken as string}` }
    });
    expect(forbiddenSuggestionList.status).toBe(403);
    expect(JSON.stringify(forbiddenSuggestionList.body)).not.toContain("other.http.student@example.com");

    const selected = await request("/me/university", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${rotated.body.accessToken as string}` },
      body: JSON.stringify({
        universityId: firstUniversity.id,
        facultyId: firstFaculty.id,
        departmentId: firstDepartment.id,
        classLevel: 2
      })
    });
    expect(selected.status).toBe(200);
    expect(selected.body).toEqual(expect.objectContaining({
      universityId: firstUniversity.id,
      facultyId: firstFaculty.id,
      departmentId: firstDepartment.id,
      classLevel: 2
    }));

    const parentChanged = await request("/me/university", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${rotated.body.accessToken as string}` },
      body: JSON.stringify({ universityId: secondUniversity.id })
    });
    expect(parentChanged.status).toBe(200);
    expect(parentChanged.body).toEqual(expect.objectContaining({ universityId: secondUniversity.id }));
    expect(parentChanged.body).not.toHaveProperty("facultyId");
    expect(parentChanged.body).not.toHaveProperty("departmentId");
    expect(parentChanged.body).not.toHaveProperty("classLevel");

    const knownRecovery = await request("/auth/password-recovery/request", {
      method: "POST",
      body: JSON.stringify({ email: "http.student@example.com" })
    });
    const unknownRecovery = await request("/auth/password-recovery/request", {
      method: "POST",
      body: JSON.stringify({ email: "unknown.student@example.com" })
    });
    expect(knownRecovery.status).toBe(201);
    expect(unknownRecovery.status).toBe(201);
    const { previewRecoveryCode: knownPreview, ...knownRecoveryPublic } = knownRecovery.body;
    const { previewRecoveryCode: unknownPreview, ...unknownRecoveryPublic } = unknownRecovery.body;
    expect(knownRecoveryPublic).toEqual(unknownRecoveryPublic);
    expect(knownPreview).toEqual(expect.stringMatching(/^\d{6}$/));
    expect(unknownPreview).toEqual(expect.stringMatching(/^\d{6}$/));
    expect(JSON.stringify(knownRecovery.body)).not.toContain("http.student@example.com");

    const mismatch = await request("/auth/password-recovery/confirm", {
      method: "POST",
      body: JSON.stringify({
        email: "http.student@example.com",
        code: sender.recoverySent[0]?.code,
        newPassword: "HTTP New Password 123!",
        passwordConfirmation: "HTTP Different Password 123!"
      })
    });
    expect(mismatch).toEqual({
      status: 400,
      body: expect.objectContaining({ errorCode: AUTH_ERROR_CODES.PASSWORD_CONFIRMATION_MISMATCH })
    });

    const reset = await request("/auth/password-recovery/confirm", {
      method: "POST",
      body: JSON.stringify({
        email: "http.student@example.com",
        code: sender.recoverySent[0]?.code,
        newPassword: "HTTP New Password 123!",
        passwordConfirmation: "HTTP New Password 123!"
      })
    });
    expect(reset).toEqual({ status: 201, body: { status: "password_reset" } });

    const oldPasswordAfterReset = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "http.student@example.com",
        password: "  Spaced-pass1  ",
        deviceId: "http-device"
      })
    });
    expect(oldPasswordAfterReset).toEqual({
      status: 401,
      body: expect.objectContaining({ errorCode: AUTH_ERROR_CODES.INVALID_CREDENTIALS })
    });
    const newPasswordAfterReset = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "http.student@example.com",
        password: "HTTP New Password 123!",
        deviceId: "http-new-device"
      })
    });
    expect(newPasswordAfterReset.status).toBe(201);

    const staleAccessAfterReset = await request("/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${rotated.body.accessToken as string}` }
    });
    expect(staleAccessAfterReset.status).toBe(401);

    const revokedSession = await request("/auth/refresh-token", {
      method: "POST",
      body: JSON.stringify({ refreshToken: rotated.body.refreshToken, deviceId: "http-device" })
    });
    expect(revokedSession).toEqual({
      status: 401,
      body: expect.objectContaining({ errorCode: AUTH_ERROR_CODES.SESSION_INVALID })
    });

    const missingRecentAuthentication = await request("/me/data", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${newPasswordAfterReset.body.accessToken as string}` }
    });
    expect(missingRecentAuthentication.status).toBe(401);

    const recentAuthentication = await request("/auth/recent-authentication", {
      method: "POST",
      headers: { Authorization: `Bearer ${newPasswordAfterReset.body.accessToken as string}` },
      body: JSON.stringify({
        method: "password",
        password: "HTTP New Password 123!",
        purpose: "delete_personal_data"
      })
    });
    expect(recentAuthentication).toEqual({
      status: 201,
      body: { proof: expect.any(String), expiresInSeconds: 300 }
    });

    const dataProofAgainstAccountDeletion = await request("/me", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${newPasswordAfterReset.body.accessToken as string}`,
        "x-recent-authentication": recentAuthentication.body.proof as string
      },
      body: JSON.stringify({ deleteData: true })
    });
    expect(dataProofAgainstAccountDeletion).toEqual({
      status: 401,
      body: expect.objectContaining({ statusCode: 401 })
    });

    const concurrentDataDeletions = await Promise.all([
      request("/me/data", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${newPasswordAfterReset.body.accessToken as string}`,
          "x-recent-authentication": recentAuthentication.body.proof as string
        }
      }),
      request("/me/data", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${newPasswordAfterReset.body.accessToken as string}`,
          "x-recent-authentication": recentAuthentication.body.proof as string
        }
      })
    ]);
    expect(concurrentDataDeletions.map((response) => response.status).sort()).toEqual([200, 401]);
    expect(concurrentDataDeletions.find((response) => response.status === 200)).toEqual({
      status: 200,
      body: { status: "deleted" }
    });

    const reusedDataProof = await request("/me/data", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${newPasswordAfterReset.body.accessToken as string}`,
        "x-recent-authentication": recentAuthentication.body.proof as string
      }
    });
    expect(reusedDataProof.status).toBe(401);

    const accountRecentAuthentication = await request("/auth/recent-authentication", {
      method: "POST",
      headers: { Authorization: `Bearer ${newPasswordAfterReset.body.accessToken as string}` },
      body: JSON.stringify({
        method: "password",
        password: "HTTP New Password 123!",
        purpose: "delete_account"
      })
    });
    expect(accountRecentAuthentication).toEqual({
      status: 201,
      body: { proof: expect.any(String), expiresInSeconds: 300 }
    });

    const deletedAccount = await request("/me", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${newPasswordAfterReset.body.accessToken as string}`,
        "x-recent-authentication": accountRecentAuthentication.body.proof as string
      },
      body: JSON.stringify({ deleteData: true })
    });
    expect(deletedAccount).toEqual({ status: 200, body: { status: "deleted" } });
  }, 30_000);
});
