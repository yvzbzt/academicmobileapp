import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { EmailVerificationSenderService } from "./email-verification-sender.service.js";
import type { AuthRepository, AuthSessionResult, GoogleLoginInput, LoginInput, RefreshInput, RefreshTokenRecord, RegisterInput, RegisterResult, VerifyEmailByLinkInput, VerifyEmailInput } from "./auth.types.js";
import { FirebaseAdminService } from "../../database/firebase-admin.service.js";
import { FirebaseGoogleIdentityVerifier, type GoogleIdentityVerifier, type VerifiedGoogleIdentity } from "./firebase-google-identity.verifier.js";
import { PasswordHasher } from "./password-hasher.js";
import { TokenService } from "./token.service.js";
import type { CatalogRepository } from "../catalog/catalog.types.js";
import { assertClassLevelAllowed } from "../catalog/academic-levels.js";

@Injectable()
export class AuthApplicationService {
  constructor(
    @Inject("AuthRepository") private readonly authRepository: AuthRepository,
    @Inject(PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @Inject(TokenService) private readonly tokenService: TokenService,
    @Inject(EmailVerificationSenderService) private readonly emailVerificationSender: EmailVerificationSenderService,
    @Optional() @Inject("GoogleIdentityVerifier") private readonly googleIdentityVerifier?: GoogleIdentityVerifier,
    @Optional() @Inject("CatalogRepository") private readonly catalogRepository?: CatalogRepository
  ) {}

  async register(input: RegisterInput): Promise<RegisterResult> {
    const normalizedEmail = input.email.trim().toLocaleLowerCase("tr-TR");
    const fullName = cleanGoogleDisplayName(input.fullName) ?? normalizedEmail.split("@")[0] ?? normalizedEmail;
    if (input.password !== input.passwordConfirmation) throw new BadRequestException("Password confirmation does not match.");

    const existingUser = await this.authRepository.findUserByEmail(normalizedEmail);
    if (existingUser) throw new ConflictException("Email is already registered.");
    await this.validateAcademicSelection(input);

    const passwordHash = await this.passwordHasher.hash(input.password);
    const user = await this.authRepository.createUser({
      fullName,
      email: normalizedEmail,
      passwordHash,
      role: "student",
      status: "inactive",
      ...(input.universityId ? { universityId: input.universityId } : {}),
      ...(input.facultyId ? { facultyId: input.facultyId } : {}),
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
      ...(input.classLevel ? { classLevel: input.classLevel } : {})
    });

    return this.issueAndSendVerificationCode(user);
  }

  async login(input: LoginInput): Promise<AuthSessionResult> {
    const user = await this.authRepository.findUserByEmail(input.email);
    if (!user) throw new UnauthorizedException("Invalid credentials.");
    if (user.status !== "active") throw new UnauthorizedException("Email verification is required before login.");

    const passwordMatches = await this.passwordHasher.verify(input.password, user.passwordHash);
    if (!passwordMatches) throw new UnauthorizedException("Invalid credentials.");

    return this.createSession(user, input.deviceId, input.ipAddress, input.userAgent);
  }

  async loginWithGoogle(input: GoogleLoginInput): Promise<AuthSessionResult> {
    const identity = await this.verifyGoogleIdentity(input.idToken);
    if (!identity.email) throw new UnauthorizedException("Google account must expose an email address.");
    if (!identity.emailVerified) throw new UnauthorizedException("Google account email is not verified.");
    if (identity.signInProvider !== "google.com") throw new UnauthorizedException("Google sign-in token must come from Google.");

    const normalizedEmail = identity.email.trim().toLocaleLowerCase("tr-TR");
    const fullName = cleanGoogleDisplayName(identity.fullName) ?? normalizedEmail.split("@")[0] ?? normalizedEmail;
    const now = new Date();
    let user = await this.authRepository.findUserByEmail(normalizedEmail);

    if (!user) {
      user = await this.authRepository.createUser({
        fullName,
        email: normalizedEmail,
        emailVerifiedAt: now,
        passwordHash: await this.passwordHasher.hash(randomUUID()),
        authProvider: "google",
        firebaseAuthUid: identity.uid,
        role: "student",
        status: "active",
        lastLoginAt: now
      });
    } else {
      if (user.status === "locked") throw new UnauthorizedException("Account is locked.");
      const shouldBackfillName = user.fullName === user.email.split("@")[0] && fullName !== user.fullName;
      const linkedUser = await this.authRepository.updateUserGoogleIdentity(user.id, {
        ...(shouldBackfillName ? { fullName } : {}),
        emailVerifiedAt: user.emailVerifiedAt ?? now,
        status: "active",
        authProvider: linkedGoogleProvider(user.authProvider),
        firebaseAuthUid: identity.uid,
        lastLoginAt: now
      });
      if (!linkedUser) throw new UnauthorizedException("Google sign-in could not be linked.");
      user = linkedUser;
    }

    return this.createSession(user, input.deviceId, input.ipAddress, input.userAgent);
  }

  async verifyEmail(input: VerifyEmailInput): Promise<{ status: "verified"; email: string }> {
    const user = await this.consumeVerificationCode(input.email, input.code);
    return { status: "verified", email: user.email };
  }

  async verifyEmailByLink(input: VerifyEmailByLinkInput): Promise<{ status: "verified" }> {
    await this.consumeVerificationToken(input.token);
    return { status: "verified" };
  }

  async resendVerificationCode(email: string): Promise<RegisterResult> {
    const normalizedEmail = email.trim().toLocaleLowerCase("tr-TR");
    const user = await this.authRepository.findUserByEmail(normalizedEmail);
    if (!user) throw new UnauthorizedException("Verification request is not valid.");
    if (user.status === "active") throw new BadRequestException("Email is already verified.");
    const latest = await this.authRepository.findLatestEmailVerificationTokenByUserId(user.id);
    if (latest && latest.resendAvailableAt.getTime() > Date.now()) {
      throw new HttpException({
        message: "Please wait before requesting another verification code.",
        resendAvailableAt: latest.resendAvailableAt.toISOString()
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.issueAndSendVerificationCode(user);
  }

  async refresh(input: RefreshInput): Promise<AuthSessionResult> {
    const tokenHash = this.tokenService.hashRefreshToken(input.refreshToken);
    const existingToken = await this.authRepository.findRefreshTokenByHash(tokenHash);
    if (!existingToken) throw new UnauthorizedException("Invalid refresh token.");

    if (existingToken.revokedAt) {
      await this.authRepository.markRefreshTokenReused(existingToken.id, new Date());
      await this.authRepository.revokeRefreshTokenFamily(existingToken.familyId, new Date());
      throw new UnauthorizedException("Refresh token reuse detected.");
    }

    if (existingToken.expiresAt.getTime() <= Date.now()) {
      await this.authRepository.revokeRefreshToken(existingToken.id, new Date());
      throw new UnauthorizedException("Refresh token expired.");
    }

    const user = await this.authRepository.findUserById(existingToken.userId);
    if (!user || user.status !== "active") throw new UnauthorizedException("Invalid refresh token.");

    await this.authRepository.revokeRefreshToken(existingToken.id, new Date());
    return this.createSession(user, input.deviceId, input.ipAddress, input.userAgent, existingToken.familyId);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.tokenService.hashRefreshToken(refreshToken);
    const existingToken = await this.authRepository.findRefreshTokenByHash(tokenHash);
    if (existingToken && !existingToken.revokedAt) {
      await this.authRepository.revokeRefreshToken(existingToken.id, new Date());
    }
  }

  private async consumeVerificationToken(rawToken: string) {
    const tokenHash = this.tokenService.hashOpaqueToken(rawToken);
    const record = await this.authRepository.findEmailVerificationTokenByHash(tokenHash);
    if (!record) throw new UnauthorizedException("Invalid verification token.");

    const user = await this.authRepository.findUserById(record.userId);
    if (!user) throw new UnauthorizedException("Verification token is not valid.");

    if (record.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException("Verification token has expired.");

    if (!record.consumedAt) {
      const verified = await this.authRepository.markUserEmailVerified(user.id, new Date());
      if (!verified) throw new UnauthorizedException("Verification token is not valid.");
      await this.authRepository.consumeEmailVerificationToken(record.id, new Date());
      return verified;
    }

    if (user.status === "active") return user;
    throw new UnauthorizedException("Verification token has already been consumed.");
  }

  private async consumeVerificationCode(email: string, code: string) {
    if (!/^\d{4}$/.test(code.trim())) throw new UnauthorizedException("Invalid verification code.");
    const user = await this.authRepository.findUserByEmail(email.trim().toLocaleLowerCase("tr-TR"));
    if (!user) throw new UnauthorizedException("Invalid verification code.");
    const tokenHash = this.tokenService.hashOpaqueToken(code.trim());
    const record = await this.authRepository.findEmailVerificationTokenByHash(tokenHash);
    if (!record || record.userId !== user.id || record.consumedAt) throw new UnauthorizedException("Invalid verification code.");
    if (record.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException("Verification code has expired.");
    const verified = await this.authRepository.markUserEmailVerified(user.id, new Date());
    if (!verified) throw new UnauthorizedException("Verification code is not valid.");
    await this.authRepository.consumeEmailVerificationToken(record.id, new Date());
    return verified;
  }

  private async verifyGoogleIdentity(idToken: string): Promise<VerifiedGoogleIdentity> {
    const verifier = this.googleIdentityVerifier ?? new FirebaseGoogleIdentityVerifier(new FirebaseAdminService());
    try {
      return await verifier.verifyIdToken(idToken);
    } catch (error) {
      if (error instanceof Error && error.message === "FIREBASE_NOT_CONFIGURED") {
        throw new ServiceUnavailableException("Google sign-in is not configured.");
      }
      throw new UnauthorizedException("Google sign-in token is invalid.");
    }
  }

  private async validateAcademicSelection(input: { universityId?: string; facultyId?: string; departmentId?: string; classLevel?: number }): Promise<void> {
    if (!input.universityId && !input.facultyId && !input.departmentId) {
      assertClassLevelAllowed(input.classLevel, null);
      return;
    }
    if (!this.catalogRepository) throw new BadRequestException("Academic catalog is not available.");
    if (!input.universityId) throw new BadRequestException("University is required when selecting a faculty or department.");
    const university = await this.catalogRepository.findUniversityById(input.universityId);
    if (!university || university.status !== "active") throw new BadRequestException("University is not valid.");
    if (!input.facultyId && !input.departmentId) {
      assertClassLevelAllowed(input.classLevel, null);
      return;
    }
    if (!input.facultyId) throw new BadRequestException("Faculty is required when selecting a department.");
    const faculties = await this.catalogRepository.listFaculties(input.universityId, "active");
    const faculty = faculties.find((candidate) => candidate.id === input.facultyId);
    if (!faculty) throw new BadRequestException("Faculty is not valid for selected university.");
    if (!input.departmentId) {
      assertClassLevelAllowed(input.classLevel, null);
      return;
    }
    const departments = await this.catalogRepository.listDepartments(input.facultyId, "active");
    const department = departments.find((candidate) => candidate.id === input.departmentId && candidate.universityId === input.universityId);
    if (!department) throw new BadRequestException("Department is not valid for selected faculty.");
    assertClassLevelAllowed(input.classLevel, department);
  }

  private async issueAndSendVerificationCode(user: { id: string; fullName: string; email: string }): Promise<RegisterResult> {
    const verificationToken = this.tokenService.issueEmailVerificationToken();
    const resendAvailableAt = new Date(Date.now() + 60 * 1000);
    await this.authRepository.createEmailVerificationToken({
      userId: user.id,
      tokenHash: verificationToken.tokenHash,
      expiresAt: verificationToken.expiresAt,
      resendAvailableAt
    });

    await this.emailVerificationSender.sendVerificationEmail({
      email: user.email,
      fullName: user.fullName,
      code: verificationToken.rawToken,
      expiresAt: verificationToken.expiresAt
    });

    return {
      status: "verification_required",
      email: user.email,
      verificationExpiresAt: verificationToken.expiresAt.toISOString(),
      resendAvailableAt: resendAvailableAt.toISOString(),
      ...(shouldExposePreviewVerificationToken() ? { previewVerificationToken: verificationToken.rawToken } : {})
    };
  }

  private async createSession(
    user: { id: string; fullName: string; email: string; role: "student" | "content_editor" | "university_admin" | "super_admin" },
    deviceId: string,
    ipAddress?: string,
    userAgent?: string,
    familyId?: string
  ): Promise<AuthSessionResult> {
    const refreshToken = this.tokenService.issueRefreshToken(familyId);
    const refreshTokenRecord: Omit<RefreshTokenRecord, "id" | "createdAt"> = {
      userId: user.id,
      tokenHash: refreshToken.tokenHash,
      familyId: refreshToken.familyId,
      deviceId,
      expiresAt: refreshToken.expiresAt
    };
    if (ipAddress) refreshTokenRecord.ipAddress = ipAddress;
    if (userAgent) refreshTokenRecord.userAgent = userAgent;

    await this.authRepository.createRefreshToken(refreshTokenRecord);

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role
      },
      accessToken: this.tokenService.signAccessToken(user),
      refreshToken: refreshToken.rawToken,
      expiresInSeconds: this.tokenService.getAccessTokenTtlSeconds()
    };
  }
}

function shouldExposePreviewVerificationToken(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.AUTH_EXPOSE_PREVIEW_VERIFICATION_TOKEN === "true";
}

function cleanGoogleDisplayName(value: string | undefined): string | undefined {
  const clean = value?.trim().replace(/\s+/g, " ");
  return clean || undefined;
}

function linkedGoogleProvider(current: "password" | "google" | "password_google" | undefined): "google" | "password_google" {
  return current === "google" ? "google" : "password_google";
}
