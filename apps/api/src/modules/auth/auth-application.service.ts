import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AUTH_ERROR_CODES, AUTH_PASSWORD_REQUIREMENT_MESSAGE, PASSWORD_RECOVERY_CODE_LENGTH, PASSWORD_RECOVERY_RESEND_SECONDS, PASSWORD_RECOVERY_TTL_SECONDS, isAuthPasswordStrong, type AuthErrorCode } from "./auth.constants.js";
import { EmailVerificationSenderService } from "./email-verification-sender.service.js";
import type { AuthRepository, AuthSessionResult, GoogleLoginInput, LoginInput, PasswordRecoveryConfirmInput, PasswordRecoveryRequestResult, RecentAuthenticationInput, RecentAuthenticationResult, RefreshInput, RefreshTokenRecord, RegisterInput, RegisterResult, VerifyEmailByLinkInput, VerifyEmailInput } from "./auth.types.js";
import { FirebaseAdminService } from "../../database/firebase-admin.service.js";
import { FirebaseGoogleIdentityVerifier, type GoogleIdentityVerifier, type VerifiedGoogleIdentity } from "./firebase-google-identity.verifier.js";
import { PasswordHasher } from "./password-hasher.js";
import { TokenService } from "./token.service.js";
import type { CatalogRepository } from "../catalog/catalog.types.js";
import { assertClassLevelAllowed } from "../catalog/academic-levels.js";
import { hashNotificationDeviceId } from "../notifications/notifications.service.js";
import { DeviceRegistrationConflictError } from "../notifications/notification.types.js";
import type { NotificationRepository } from "../notifications/notification.types.js";

const PASSWORD_RECOVERY_PARITY_HASH = "$2b$12$6TNw/I640i6eaS9wJrV0MO.xrhvXMsPeISUni3r5ycT8k2VkF0eq2";
const PASSWORD_RECOVERY_PUBLIC_FLOOR_MS = 350;
const PASSWORD_RECOVERY_DELIVERY_TIMEOUT_MS = 12_000;

@Injectable()
export class AuthApplicationService {
  constructor(
    @Inject("AuthRepository") private readonly authRepository: AuthRepository,
    @Inject(PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @Inject(TokenService) private readonly tokenService: TokenService,
    @Inject(EmailVerificationSenderService) private readonly emailVerificationSender: EmailVerificationSenderService,
    @Optional() @Inject("GoogleIdentityVerifier") private readonly googleIdentityVerifier?: GoogleIdentityVerifier,
    @Optional() @Inject("CatalogRepository") private readonly catalogRepository?: CatalogRepository,
    @Optional() @Inject("NotificationRepository") private readonly notificationRepository?: NotificationRepository
  ) {}

  async register(input: RegisterInput): Promise<RegisterResult> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const fullName = cleanGoogleDisplayName(input.fullName) ?? normalizedEmail.split("@")[0] ?? normalizedEmail;
    if (input.password !== input.passwordConfirmation) throw new BadRequestException("Password confirmation does not match.");
    if (!isAuthPasswordStrong(input.password)) {
      throw badRequestAuthError(AUTH_ERROR_CODES.PASSWORD_INVALID, AUTH_PASSWORD_REQUIREMENT_MESSAGE);
    }

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
    if (!user) throw unauthorizedAuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS, "Invalid credentials.");

    const passwordMatches = await this.passwordHasher.verify(input.password, user.passwordHash);
    if (!passwordMatches) throw unauthorizedAuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS, "Invalid credentials.");
    if (user.status === "locked" || (user.status === "inactive" && Boolean(user.emailVerifiedAt))) {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.ACCOUNT_DISABLED, "Account is disabled.");
    }
    if (user.status !== "active") {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED, "Email verification is required before login.");
    }

    return this.createSession(user, input.deviceId, input.ipAddress, input.userAgent);
  }

  async loginWithGoogle(input: GoogleLoginInput): Promise<AuthSessionResult> {
    const identity = await this.verifyGoogleIdentity(input.idToken);
    if (!identity.email) throw new UnauthorizedException("Google account must expose an email address.");
    if (!identity.emailVerified) throw new UnauthorizedException("Google account email is not verified.");
    if (identity.signInProvider !== "google.com") throw new UnauthorizedException("Google sign-in token must come from Google.");

    const normalizedEmail = identity.email.trim().toLowerCase();
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
      if (user.status === "locked" || (user.status === "inactive" && Boolean(user.emailVerifiedAt))) {
        throw unauthorizedAuthError(AUTH_ERROR_CODES.ACCOUNT_DISABLED, "Account is disabled.");
      }
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
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.authRepository.findUserByEmail(normalizedEmail);
    if (!user) {
      throw unauthorizedAuthError(
        AUTH_ERROR_CODES.VERIFICATION_REQUEST_INVALID,
        "Verification request is not valid."
      );
    }
    if (user.status === "active") throw new BadRequestException("Email is already verified.");
    const latest = await this.authRepository.findLatestEmailVerificationTokenByUserId(user.id);
    if (latest && latest.resendAvailableAt.getTime() > Date.now()) {
      const resendAvailableAt = latest.resendAvailableAt.toISOString();
      throw new HttpException({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: "Too Many Requests",
        errorCode: AUTH_ERROR_CODES.RATE_LIMITED,
        message: "Please wait before requesting another verification code.",
        resendAvailableAt,
        details: { resendAvailableAt }
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.issueAndSendVerificationCode(user);
  }

  async requestPasswordRecovery(email: string): Promise<PasswordRecoveryRequestResult> {
    const requestStartedAt = Date.now();
    const normalizedEmail = email.trim().toLowerCase();
    const recoveryToken = this.tokenService.issuePasswordRecoveryToken(normalizedEmail);
    const [user] = await Promise.all([
      this.authRepository.findUserByEmail(normalizedEmail),
      this.passwordHasher.verify(recoveryToken.rawToken, PASSWORD_RECOVERY_PARITY_HASH).catch(() => false)
    ]);
    const latest = await this.authRepository.findLatestPasswordRecoveryTokenByUserId(
      user?.id ?? `recovery-decoy:${recoveryToken.tokenHash}`
    );
    let delivery: Parameters<EmailVerificationSenderService["sendPasswordRecoveryEmail"]>[0] | undefined;

    if (user && (!latest || latest.resendAvailableAt.getTime() <= Date.now())) {
      const now = new Date();
      await this.authRepository.invalidatePasswordRecoveryTokensByUserId(user.id, now);
      await this.authRepository.createPasswordRecoveryToken({
        userId: user.id,
        credentialGeneration: user.credentialGeneration,
        tokenHash: recoveryToken.tokenHash,
        expiresAt: recoveryToken.expiresAt,
        resendAvailableAt: new Date(now.getTime() + PASSWORD_RECOVERY_RESEND_SECONDS * 1000)
      });
      delivery = {
        email: user.email,
        fullName: user.fullName,
        code: recoveryToken.rawToken,
        expiresAt: recoveryToken.expiresAt
      };
    }

    this.schedulePasswordRecoveryDelivery(delivery);
    await enforcePasswordRecoveryPublicFloor(requestStartedAt);
    return passwordRecoveryRequestResult(recoveryToken.rawToken);
  }

  async confirmPasswordRecovery(input: PasswordRecoveryConfirmInput): Promise<{ status: "password_reset" }> {
    if (input.newPassword !== input.passwordConfirmation) {
      throw badRequestAuthError(AUTH_ERROR_CODES.PASSWORD_CONFIRMATION_MISMATCH, "Password confirmation does not match.");
    }
    if (!isAuthPasswordStrong(input.newPassword)) {
      throw badRequestAuthError(
        AUTH_ERROR_CODES.PASSWORD_INVALID,
        AUTH_PASSWORD_REQUIREMENT_MESSAGE
      );
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    const normalizedCode = input.code.trim();
    if (!new RegExp(`^\\d{${PASSWORD_RECOVERY_CODE_LENGTH}}$`).test(normalizedCode)) {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.PASSWORD_RECOVERY_CODE_INVALID, "Invalid password recovery code.");
    }

    const tokenHash = this.tokenService.hashPasswordRecoveryToken(normalizedEmail, normalizedCode);
    const [user, record] = await Promise.all([
      this.authRepository.findUserByEmail(normalizedEmail),
      this.authRepository.findPasswordRecoveryTokenByHash(tokenHash)
    ]);
    if (!user) {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.PASSWORD_RECOVERY_CODE_INVALID, "Invalid password recovery code.");
    }
    const recordIsCurrent = Boolean(
      record
      && record.userId === user.id
      && record.credentialGeneration === user.credentialGeneration
      && !record.consumedAt
      && !record.invalidatedAt
    );
    if (!recordIsCurrent && user.passwordRecoveryCompletion) {
      const completedSourceGeneration = user.passwordRecoveryCompletion.credentialGeneration - 1;
      const retryOperationKey = this.tokenService.hashPasswordRecoveryOperation(
        tokenHash,
        completedSourceGeneration,
        input.newPassword
      );
      if (user.passwordRecoveryCompletion.operationKey === retryOperationKey) {
        return { status: "password_reset" };
      }
    }
    if (
      !record ||
      record.userId !== user.id ||
      record.credentialGeneration !== user.credentialGeneration ||
      record.consumedAt ||
      record.invalidatedAt
    ) {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.PASSWORD_RECOVERY_CODE_INVALID, "Invalid password recovery code.");
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.PASSWORD_RECOVERY_CODE_EXPIRED, "Password recovery code has expired.");
    }

    const operationKey = this.tokenService.hashPasswordRecoveryOperation(
      tokenHash,
      record.credentialGeneration,
      input.newPassword
    );
    const passwordHash = await this.passwordHasher.hash(input.newPassword);
    const completedAt = new Date();
    const completion = await this.authRepository.completePasswordRecovery({
      userId: user.id,
      expectedCredentialGeneration: user.credentialGeneration,
      tokenHash,
      operationKey,
      passwordHash,
      completedAt,
      authProvider: user.authProvider === "google" ? "password_google" : user.authProvider ?? "password"
    });
    if (completion === "conflict") {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.PASSWORD_RECOVERY_CODE_INVALID, "Invalid password recovery code.");
    }
    if (completion === "completed") {
      await Promise.allSettled([
        this.authRepository.revokeRefreshTokensByUserId(user.id, completedAt),
        this.authRepository.invalidatePasswordRecoveryTokensByUserId(user.id, completedAt)
      ]);
    }
    return { status: "password_reset" };
  }

  async refresh(input: RefreshInput): Promise<AuthSessionResult> {
    const tokenHash = this.tokenService.hashRefreshToken(input.refreshToken);
    const existingToken = await this.authRepository.findRefreshTokenByHash(tokenHash);
    if (!existingToken) throw unauthorizedAuthError(AUTH_ERROR_CODES.SESSION_INVALID, "Session is no longer valid.");

    if (existingToken.revokedAt) {
      await this.authRepository.markRefreshTokenReused(existingToken.id, new Date());
      await this.authRepository.revokeRefreshTokenFamily(existingToken.familyId, new Date());
      throw unauthorizedAuthError(AUTH_ERROR_CODES.SESSION_INVALID, "Session is no longer valid.");
    }

    if (existingToken.expiresAt.getTime() <= Date.now()) {
      await this.authRepository.revokeRefreshToken(existingToken.id, new Date());
      throw unauthorizedAuthError(AUTH_ERROR_CODES.SESSION_EXPIRED, "Session has expired.");
    }

    const user = await this.authRepository.findUserById(existingToken.userId);
    if (!user) throw unauthorizedAuthError(AUTH_ERROR_CODES.SESSION_INVALID, "Session is no longer valid.");
    if (existingToken.credentialGeneration !== user.credentialGeneration) {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.SESSION_INVALID, "Session is no longer valid.");
    }
    if (user.status !== "active") throw unauthorizedAuthError(AUTH_ERROR_CODES.ACCOUNT_DISABLED, "Account is disabled.");

    const consumed = await this.authRepository.consumeRefreshTokenForRotation(existingToken.id, new Date());
    if (!consumed) {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.SESSION_INVALID, "Session is no longer valid.");
    }
    return this.createSession(user, input.deviceId, input.ipAddress, input.userAgent, existingToken.familyId);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.tokenService.hashRefreshToken(refreshToken);
    const existingToken = await this.authRepository.findRefreshTokenByHash(tokenHash);
    if (existingToken && !existingToken.revokedAt) {
      await this.authRepository.revokeRefreshToken(existingToken.id, new Date());
    }
    if (existingToken && this.notificationRepository) {
      try {
        await this.notificationRepository.disableDeviceInstallation(
          existingToken.userId,
          hashNotificationDeviceId(existingToken.deviceId)
        );
      } catch (error) {
        // A late logout from an old account must never detach a newer owner's
        // active installation. The repository conflict proves there is
        // nothing left for this refresh-token owner to detach.
        if (!(error instanceof DeviceRegistrationConflictError)) throw error;
      }
    }
  }

  async createRecentAuthenticationProof(
    userId: string,
    input: RecentAuthenticationInput
  ): Promise<RecentAuthenticationResult> {
    const user = await this.authRepository.findUserById(userId);
    if (!user || user.status !== "active") {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.SESSION_INVALID, "Session is no longer valid.");
    }

    if (input.method === "password") {
      if (user.authProvider === "google" || !(await this.passwordHasher.verify(input.password, user.passwordHash))) {
        throw unauthorizedAuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS, "Recent authentication failed.");
      }
    } else {
      const identity = await this.verifyGoogleIdentity(input.idToken);
      const identityEmail = identity.email?.trim().toLowerCase();
      const uidMatches = Boolean(user.firebaseAuthUid) && identity.uid === user.firebaseAuthUid;
      if (
        identity.signInProvider !== "google.com"
        || !identity.emailVerified
        || (!uidMatches && identityEmail !== user.email)
      ) {
        throw unauthorizedAuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS, "Recent authentication failed.");
      }
    }

    const issuedProof = this.tokenService.issueRecentAuthenticationProof(user, input.method, input.purpose);
    await this.authRepository.createRecentAuthenticationProof({
      ownerId: user.id,
      credentialGeneration: user.credentialGeneration,
      purpose: input.purpose,
      jtiDigest: this.tokenService.hashRecentAuthenticationJti(issuedProof.jti),
      createdAt: issuedProof.createdAt,
      expiresAt: issuedProof.expiresAt
    });

    return {
      proof: issuedProof.proof,
      expiresInSeconds: this.tokenService.getRecentAuthenticationTtlSeconds()
    };
  }

  private async consumeVerificationToken(rawToken: string) {
    const tokenHash = this.tokenService.hashEmailVerificationToken(rawToken);
    const record = await this.authRepository.findEmailVerificationTokenByHash(tokenHash);
    if (!record) throw unauthorizedAuthError(AUTH_ERROR_CODES.VERIFICATION_TOKEN_INVALID, "Invalid verification token.");

    const user = await this.authRepository.findUserById(record.userId);
    if (!user) throw unauthorizedAuthError(AUTH_ERROR_CODES.VERIFICATION_TOKEN_INVALID, "Verification token is not valid.");

    if (record.expiresAt.getTime() <= Date.now()) {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.VERIFICATION_TOKEN_EXPIRED, "Verification token has expired.");
    }

    if (!record.consumedAt) {
      const verified = await this.authRepository.markUserEmailVerified(user.id, new Date());
      if (!verified) throw unauthorizedAuthError(AUTH_ERROR_CODES.VERIFICATION_TOKEN_INVALID, "Verification token is not valid.");
      await this.authRepository.consumeEmailVerificationToken(record.id, new Date());
      return verified;
    }

    if (user.status === "active") return user;
    throw unauthorizedAuthError(AUTH_ERROR_CODES.VERIFICATION_TOKEN_INVALID, "Verification token has already been consumed.");
  }

  private async consumeVerificationCode(email: string, code: string) {
    if (!/^\d{6}$/.test(code.trim())) {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.VERIFICATION_CODE_INVALID, "Invalid verification code.");
    }
    const user = await this.authRepository.findUserByEmail(email.trim().toLowerCase());
    if (!user) throw unauthorizedAuthError(AUTH_ERROR_CODES.VERIFICATION_CODE_INVALID, "Invalid verification code.");
    const tokenHash = this.tokenService.hashEmailVerificationToken(code.trim());
    const record = await this.authRepository.findEmailVerificationTokenByHash(tokenHash);
    if (!record || record.userId !== user.id || record.consumedAt) {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.VERIFICATION_CODE_INVALID, "Invalid verification code.");
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw unauthorizedAuthError(AUTH_ERROR_CODES.VERIFICATION_CODE_EXPIRED, "Verification code has expired.");
    }
    const verified = await this.authRepository.markUserEmailVerified(user.id, new Date());
    if (!verified) throw unauthorizedAuthError(AUTH_ERROR_CODES.VERIFICATION_CODE_INVALID, "Verification code is not valid.");
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
    user: {
      id: string;
      credentialGeneration: number;
      fullName: string;
      email: string;
      role: "student" | "content_editor" | "university_admin" | "super_admin";
      authProvider?: "password" | "google" | "password_google";
    },
    deviceId: string,
    ipAddress?: string,
    userAgent?: string,
    familyId?: string
  ): Promise<AuthSessionResult> {
    const refreshToken = this.tokenService.issueRefreshToken(familyId);
    const refreshTokenRecord: Omit<RefreshTokenRecord, "id" | "createdAt"> = {
      userId: user.id,
      credentialGeneration: user.credentialGeneration,
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
        role: user.role,
        ...(user.authProvider ? { authProvider: user.authProvider } : {})
      },
      accessToken: this.tokenService.signAccessToken(user),
      refreshToken: refreshToken.rawToken,
      expiresInSeconds: this.tokenService.getAccessTokenTtlSeconds()
    };
  }

  private schedulePasswordRecoveryDelivery(
    input: Parameters<EmailVerificationSenderService["sendPasswordRecoveryEmail"]>[0] | undefined
  ): void {
    queueMicrotask(() => {
      if (!input) return;
      void withTimeout(
        this.emailVerificationSender.sendPasswordRecoveryEmail(input),
        PASSWORD_RECOVERY_DELIVERY_TIMEOUT_MS
      ).catch(() => undefined);
    });
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

function passwordRecoveryRequestResult(rawToken: string): PasswordRecoveryRequestResult {
  return {
    status: "recovery_requested",
    message: "If an eligible account exists, recovery instructions will be sent.",
    expiresInSeconds: PASSWORD_RECOVERY_TTL_SECONDS,
    resendAfterSeconds: PASSWORD_RECOVERY_RESEND_SECONDS,
    ...(shouldExposePreviewPasswordRecoveryCode() ? { previewRecoveryCode: rawToken } : {})
  };
}

function shouldExposePreviewPasswordRecoveryCode(): boolean {
  return process.env.NODE_ENV !== "production";
}

function unauthorizedAuthError(errorCode: AuthErrorCode, message: string): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: HttpStatus.UNAUTHORIZED,
    error: "Unauthorized",
    errorCode,
    message
  });
}

function badRequestAuthError(errorCode: AuthErrorCode, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: HttpStatus.BAD_REQUEST,
    error: "Bad Request",
    errorCode,
    message
  });
}

async function enforcePasswordRecoveryPublicFloor(startedAt: number): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  const remaining = PASSWORD_RECOVERY_PUBLIC_FLOOR_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("PASSWORD_RECOVERY_DELIVERY_TIMEOUT")), timeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
