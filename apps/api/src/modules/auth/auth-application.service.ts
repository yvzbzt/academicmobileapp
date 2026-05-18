import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CatalogRepository } from "../catalog/catalog.types.js";
import { EmailVerificationSenderService } from "./email-verification-sender.service.js";
import type { AuthRepository, AuthSessionResult, LoginInput, RefreshInput, RefreshTokenRecord, RegisterInput, RegisterResult, VerifyEmailByLinkInput, VerifyEmailInput } from "./auth.types.js";
import { PasswordHasher } from "./password-hasher.js";
import { TokenService } from "./token.service.js";

@Injectable()
export class AuthApplicationService {
  constructor(
    @Inject("AuthRepository") private readonly authRepository: AuthRepository,
    @Inject("CatalogRepository") private readonly catalogRepository: CatalogRepository,
    @Inject(PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
    @Inject(TokenService) private readonly tokenService: TokenService,
    @Inject(EmailVerificationSenderService) private readonly emailVerificationSender: EmailVerificationSenderService
  ) {}

  async register(input: RegisterInput): Promise<RegisterResult> {
    const normalizedEmail = input.email.trim().toLocaleLowerCase("tr-TR");
    if (!isStudentEmail(normalizedEmail)) throw new BadRequestException("Only student email addresses are accepted at this stage.");

    const existingUser = await this.authRepository.findUserByEmail(normalizedEmail);
    if (existingUser) throw new ConflictException("Email is already registered.");

    await this.validateAcademicSelection(input.universityId, input.facultyId, input.departmentId);

    const passwordHash = await this.passwordHasher.hash(input.password);
    const user = await this.authRepository.createUser({
      fullName: input.fullName.trim(),
      email: normalizedEmail,
      passwordHash,
      role: "student",
      universityId: input.universityId,
      facultyId: input.facultyId,
      departmentId: input.departmentId,
      ...(input.classLevel ? { classLevel: input.classLevel } : {}),
      status: "inactive"
    });

    const verificationToken = this.tokenService.issueEmailVerificationToken();
    await this.authRepository.createEmailVerificationToken({
      userId: user.id,
      tokenHash: verificationToken.tokenHash,
      expiresAt: verificationToken.expiresAt
    });

    const verifyUrl = buildVerificationUrl(verificationToken.rawToken);
    await this.emailVerificationSender.sendVerificationEmail({
      email: user.email,
      fullName: user.fullName,
      verifyUrl,
      expiresAt: verificationToken.expiresAt
    });

    return {
      status: "verification_required",
      email: user.email,
      verificationExpiresAt: verificationToken.expiresAt.toISOString(),
      ...(process.env.NODE_ENV === "production" ? {} : { previewVerificationToken: verificationToken.rawToken })
    };
  }

  async login(input: LoginInput): Promise<AuthSessionResult> {
    const user = await this.authRepository.findUserByEmail(input.email);
    if (!user) throw new UnauthorizedException("Invalid credentials.");
    if (user.status !== "active") throw new UnauthorizedException("Email verification is required before login.");

    const passwordMatches = await this.passwordHasher.verify(input.password, user.passwordHash);
    if (!passwordMatches) throw new UnauthorizedException("Invalid credentials.");

    return this.createSession(user, input.deviceId, input.ipAddress, input.userAgent);
  }

  async verifyEmail(input: VerifyEmailInput): Promise<AuthSessionResult> {
    const user = await this.consumeVerificationToken(input.token);
    return this.createSession(user, input.deviceId, input.ipAddress, input.userAgent);
  }

  async verifyEmailByLink(input: VerifyEmailByLinkInput): Promise<{ status: "verified" }> {
    await this.consumeVerificationToken(input.token);
    return { status: "verified" };
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

  private async validateAcademicSelection(universityId: string, facultyId: string, departmentId: string): Promise<void> {
    const university = await this.catalogRepository.findUniversityById(universityId);
    if (!university || university.status !== "active") throw new BadRequestException("University is not valid.");

    const faculties = await this.catalogRepository.listFaculties(universityId, "active");
    const faculty = faculties.find((candidate) => candidate.id === facultyId);
    if (!faculty) throw new BadRequestException("Faculty is not valid for selected university.");

    const departments = await this.catalogRepository.listDepartments(facultyId, "active");
    const department = departments.find((candidate) => candidate.id === departmentId && candidate.universityId === universityId);
    if (!department) throw new BadRequestException("Department is not valid for selected faculty.");
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

function isStudentEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLocaleLowerCase("en-US");
  if (!domain) return false;
  const suffixes = (process.env.STUDENT_EMAIL_DOMAIN_SUFFIXES ?? ".edu.tr,.edu")
    .split(",")
    .map((item) => item.trim().toLocaleLowerCase("en-US"))
    .filter((item) => item.length > 0);
  return suffixes.some((suffix) => domain.endsWith(suffix));
}

function buildVerificationUrl(token: string): string {
  const base = process.env.EMAIL_VERIFICATION_URL ?? `${process.env.API_PUBLIC_BASE_URL ?? "http://localhost:3000"}/auth/verify-email`;
  if (base.includes("{token}")) return base.replace("{token}", encodeURIComponent(token));
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}token=${encodeURIComponent(token)}`;
}
