import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AuthApplicationService } from "../src/modules/auth/auth-application.service.js";
import { EmailVerificationSenderService, type SendVerificationEmailInput } from "../src/modules/auth/email-verification-sender.service.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import { TokenService } from "../src/modules/auth/token.service.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";

class FakeEmailVerificationSenderService extends EmailVerificationSenderService {
  public readonly sent: SendVerificationEmailInput[] = [];

  override async sendVerificationEmail(input: SendVerificationEmailInput): Promise<void> {
    this.sent.push(input);
  }
}

function createAuthService(): AuthApplicationService {
  return new AuthApplicationService(
    new InMemoryAuthRepository(),
    new InMemoryCatalogRepository(),
    new PasswordHasher(),
    new TokenService(),
    new FakeEmailVerificationSenderService()
  );
}

describe("AuthApplicationService", () => {
  it("registers a student and returns a verification-required response", async () => {
    const authService = createAuthService();

    const registerResult = await authService.register({
      fullName: "Ada Lovelace",
      email: "ada@ogr.example.edu.tr",
      password: "StrongPass123!",
      deviceId: "device-1",
      universityId: "sample-university-1",
      facultyId: "sample-faculty-1",
      departmentId: "sample-department-1"
    });

    expect(registerResult.status).toBe("verification_required");
    expect(registerResult.email).toBe("ada@ogr.example.edu.tr");
    expect(registerResult.previewVerificationToken).toBeTruthy();

    const session = await authService.verifyEmail({
      token: registerResult.previewVerificationToken!,
      deviceId: "device-1"
    });

    expect(session.user.email).toBe("ada@ogr.example.edu.tr");
    expect(session.user.role).toBe("student");
    expect(session.accessToken.length).toBeGreaterThan(20);
    expect(session.refreshToken.length).toBeGreaterThan(40);
  });

  it("rejects non-student email domains during registration", async () => {
    const authService = createAuthService();

    await expect(
      authService.register({
        fullName: "Invalid Email User",
        email: "user@example.com",
        password: "StrongPass123!",
        deviceId: "device-1",
        universityId: "sample-university-1",
        facultyId: "sample-faculty-1",
        departmentId: "sample-department-1"
      })
    ).rejects.toThrow("Only student email addresses are accepted at this stage.");
  });

  it("rejects invalid login credentials", async () => {
    const authService = createAuthService();

    const registerResult = await authService.register({
      fullName: "Student User",
      email: "student@campus.edu.tr",
      password: "StrongPass123!",
      deviceId: "device-1",
      universityId: "sample-university-1",
      facultyId: "sample-faculty-1",
      departmentId: "sample-department-1"
    });

    await authService.verifyEmail({ token: registerResult.previewVerificationToken!, deviceId: "device-1" });

    await expect(
      authService.login({
        email: "student@campus.edu.tr",
        password: "wrong-password",
        deviceId: "device-1"
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rotates refresh tokens and rejects reuse", async () => {
    const authService = createAuthService();

    const registerResult = await authService.register({
      fullName: "Rotation User",
      email: "rotation@campus.edu.tr",
      password: "StrongPass123!",
      deviceId: "device-1",
      universityId: "sample-university-1",
      facultyId: "sample-faculty-1",
      departmentId: "sample-department-1"
    });

    const firstSession = await authService.verifyEmail({ token: registerResult.previewVerificationToken!, deviceId: "device-1" });

    const secondSession = await authService.refresh({
      refreshToken: firstSession.refreshToken,
      deviceId: "device-1"
    });

    expect(secondSession.refreshToken).not.toBe(firstSession.refreshToken);

    await expect(
      authService.refresh({
        refreshToken: firstSession.refreshToken,
        deviceId: "device-1"
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      authService.refresh({
        refreshToken: secondSession.refreshToken,
        deviceId: "device-1"
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("revokes refresh token on logout", async () => {
    const authService = createAuthService();

    const registerResult = await authService.register({
      fullName: "Logout User",
      email: "logout@campus.edu.tr",
      password: "StrongPass123!",
      deviceId: "device-1",
      universityId: "sample-university-1",
      facultyId: "sample-faculty-1",
      departmentId: "sample-department-1"
    });

    const session = await authService.verifyEmail({ token: registerResult.previewVerificationToken!, deviceId: "device-1" });

    await authService.logout(session.refreshToken);

    await expect(
      authService.refresh({
        refreshToken: session.refreshToken,
        deviceId: "device-1"
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
