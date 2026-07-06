import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AuthApplicationService } from "../src/modules/auth/auth-application.service.js";
import { EmailVerificationSenderService, type SendVerificationEmailInput } from "../src/modules/auth/email-verification-sender.service.js";
import type { GoogleIdentityVerifier, VerifiedGoogleIdentity } from "../src/modules/auth/firebase-google-identity.verifier.js";
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

class FakeGoogleIdentityVerifier implements GoogleIdentityVerifier {
  constructor(private readonly identity: VerifiedGoogleIdentity) {}

  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    if (idToken === "invalid-google-token") throw new Error("INVALID_TOKEN");
    return this.identity;
  }
}

function createAuthService(googleIdentity?: VerifiedGoogleIdentity, catalogRepository?: InMemoryCatalogRepository) {
  const sender = new FakeEmailVerificationSenderService();
  const authRepository = new InMemoryAuthRepository();
  const service = new AuthApplicationService(
    authRepository,
    new PasswordHasher(),
    new TokenService(),
    sender,
    googleIdentity ? new FakeGoogleIdentityVerifier(googleIdentity) : undefined,
    catalogRepository
  );
  return { service, sender, authRepository };
}

describe("AuthApplicationService", () => {
  it("registers a student and returns a verification-required response", async () => {
    const { service: authService, sender } = createAuthService();

    const registerResult = await authService.register({
      email: "ada@ogr.example.edu.tr",
      password: "StrongPass123!",
      passwordConfirmation: "StrongPass123!"
    });

    expect(registerResult.status).toBe("verification_required");
    expect(registerResult.email).toBe("ada@ogr.example.edu.tr");
    expect(registerResult.previewVerificationToken).toBeTruthy();
    expect(registerResult.resendAvailableAt).toBeTruthy();
    expect(sender.sent[0]?.code).toMatch(/^\d{4}$/);

    const verification = await authService.verifyEmail({
      email: registerResult.email,
      code: sender.sent[0]!.code,
      deviceId: "device-1"
    });

    expect(verification).toEqual({ status: "verified", email: "ada@ogr.example.edu.tr" });
    const session = await authService.login({ email: "ada@ogr.example.edu.tr", password: "StrongPass123!", deviceId: "device-1" });
    expect(session.user.email).toBe("ada@ogr.example.edu.tr");
    expect(session.user.role).toBe("student");
    expect(session.accessToken.length).toBeGreaterThan(20);
    expect(session.refreshToken.length).toBeGreaterThan(40);
  });

  it("registers non-university email domains", async () => {
    const { service: authService } = createAuthService();
    const registerResult = await authService.register({
      email: "demo@example.com",
      password: "StrongPass123!",
      passwordConfirmation: "StrongPass123!"
    });

    expect(registerResult.status).toBe("verification_required");
    expect(registerResult.email).toBe("demo@example.com");
  });

  it("stores a valid university, faculty and department selected during registration", async () => {
    const catalogRepository = new InMemoryCatalogRepository();
    const university = await catalogRepository.createUniversity({ name: "Ankara Test Universitesi", slug: "ankara-test-universitesi", city: "ANKARA", type: "state", status: "active" });
    const faculty = await catalogRepository.createFaculty({ universityId: university.id, name: "Muhendislik Fakultesi", slug: "muhendislik-fakultesi", status: "active" });
    const department = await catalogRepository.createDepartment({ universityId: university.id, facultyId: faculty.id, name: "Bilgisayar Muhendisligi", slug: "bilgisayar-muhendisligi", educationLevel: "bachelor", status: "active" });
    const { service: authService, authRepository } = createAuthService(undefined, catalogRepository);

    const registerResult = await authService.register({
      email: "catalog-student@example.com",
      password: "StrongPass123!",
      passwordConfirmation: "StrongPass123!",
      universityId: university.id,
      facultyId: faculty.id,
      departmentId: department.id,
      classLevel: 2
    });

    const user = await authRepository.findUserByEmail(registerResult.email);
    expect(user).toEqual(expect.objectContaining({ universityId: university.id, facultyId: faculty.id, departmentId: department.id, classLevel: 2 }));
  });

  it("rejects registration with a faculty outside the selected university", async () => {
    const catalogRepository = new InMemoryCatalogRepository();
    const university = await catalogRepository.createUniversity({ name: "Ankara Test Universitesi", slug: "ankara-test-universitesi", city: "ANKARA", type: "state", status: "active" });
    const otherUniversity = await catalogRepository.createUniversity({ name: "Izmir Test Universitesi", slug: "izmir-test-universitesi", city: "IZMIR", type: "state", status: "active" });
    const otherFaculty = await catalogRepository.createFaculty({ universityId: otherUniversity.id, name: "Fen Fakultesi", slug: "fen-fakultesi", status: "active" });
    const { service: authService } = createAuthService(undefined, catalogRepository);

    await expect(
      authService.register({
        email: "invalid-catalog@example.com",
        password: "StrongPass123!",
        passwordConfirmation: "StrongPass123!",
        universityId: university.id,
        facultyId: otherFaculty.id
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects invalid login credentials", async () => {
    const { service: authService, sender } = createAuthService();

    const registerResult = await authService.register({
      email: "student@campus.edu.tr",
      password: "StrongPass123!",
      passwordConfirmation: "StrongPass123!"
    });

    await authService.verifyEmail({ email: registerResult.email, code: sender.sent[0]!.code, deviceId: "device-1" });

    await expect(
      authService.login({
        email: "student@campus.edu.tr",
        password: "wrong-password",
        deviceId: "device-1"
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("creates an active student session from a verified Google account", async () => {
    const { service: authService, sender } = createAuthService({
      uid: "firebase-google-user-1",
      email: "google.student@example.com",
      emailVerified: true,
      signInProvider: "google.com",
      fullName: "Google Student"
    });

    const session = await authService.loginWithGoogle({
      idToken: "valid-google-token",
      deviceId: "device-google"
    });

    expect(session.user.email).toBe("google.student@example.com");
    expect(session.user.fullName).toBe("Google Student");
    expect(session.user.role).toBe("student");
    expect(session.accessToken.length).toBeGreaterThan(20);
    expect(sender.sent).toHaveLength(0);

    await expect(
      authService.login({
        email: "google.student@example.com",
        password: "StrongPass123!",
        deviceId: "device-google"
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("links Google sign-in to an existing inactive email account", async () => {
    const { service: authService } = createAuthService({
      uid: "firebase-google-user-2",
      email: "pending.student@example.com",
      emailVerified: true,
      signInProvider: "google.com",
      fullName: "Pending Student"
    });

    await authService.register({
      email: "pending.student@example.com",
      password: "StrongPass123!",
      passwordConfirmation: "StrongPass123!"
    });

    const session = await authService.loginWithGoogle({
      idToken: "valid-google-token",
      deviceId: "device-google"
    });

    expect(session.user.email).toBe("pending.student@example.com");
    expect(session.user.role).toBe("student");
  });

  it("rejects Firebase tokens that were not issued by the Google provider", async () => {
    const { service: authService } = createAuthService({
      uid: "firebase-password-user",
      email: "password.firebase@example.com",
      emailVerified: true,
      signInProvider: "password",
      fullName: "Password Firebase"
    });

    await expect(
      authService.loginWithGoogle({
        idToken: "valid-but-not-google-token",
        deviceId: "device-google"
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rotates refresh tokens and rejects reuse", async () => {
    const { service: authService, sender } = createAuthService();

    const registerResult = await authService.register({
      email: "rotation@campus.edu.tr",
      password: "StrongPass123!",
      passwordConfirmation: "StrongPass123!"
    });

    await authService.verifyEmail({ email: registerResult.email, code: sender.sent[0]!.code, deviceId: "device-1" });
    const firstSession = await authService.login({ email: "rotation@campus.edu.tr", password: "StrongPass123!", deviceId: "device-1" });

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
    const { service: authService, sender } = createAuthService();

    const registerResult = await authService.register({
      email: "logout@campus.edu.tr",
      password: "StrongPass123!",
      passwordConfirmation: "StrongPass123!"
    });

    await authService.verifyEmail({ email: registerResult.email, code: sender.sent[0]!.code, deviceId: "device-1" });
    const session = await authService.login({ email: "logout@campus.edu.tr", password: "StrongPass123!", deviceId: "device-1" });

    await authService.logout(session.refreshToken);

    await expect(
      authService.refresh({
        refreshToken: session.refreshToken,
        deviceId: "device-1"
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
