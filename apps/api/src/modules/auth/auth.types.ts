import type { UserRole } from "../../../../../packages/shared/src/contracts.js";

export interface AuthUserRecord {
  id: string;
  fullName: string;
  email: string;
  emailVerifiedAt?: Date;
  passwordHash: string;
  authProvider?: "password" | "google" | "password_google";
  firebaseAuthUid?: string;
  role: UserRole;
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
  classLevel?: number;
  status: "active" | "inactive" | "locked";
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  deviceId: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
  revokedAt?: Date;
  reusedAt?: Date;
  createdAt: Date;
}

export interface AuthSessionResult {
  user: Pick<AuthUserRecord, "id" | "fullName" | "email" | "role">;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface EmailVerificationTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  resendAvailableAt: Date;
  consumedAt?: Date;
  createdAt: Date;
}

export interface PasswordRecoveryTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  resendAvailableAt: Date;
  consumedAt?: Date;
  invalidatedAt?: Date;
  createdAt: Date;
}

export interface PasswordRecoveryRequestResult {
  status: "recovery_requested";
  message: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  previewRecoveryCode?: string;
}

export interface PasswordRecoveryConfirmInput {
  email: string;
  code: string;
  newPassword: string;
  passwordConfirmation: string;
}

export interface RegisterResult {
  status: "verification_required";
  email: string;
  verificationExpiresAt: string;
  resendAvailableAt: string;
  previewVerificationToken?: string;
}

export interface RegisterInput {
  fullName?: string;
  email: string;
  password: string;
  passwordConfirmation: string;
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
  classLevel?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface LoginInput {
  email: string;
  password: string;
  deviceId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface GoogleLoginInput {
  idToken: string;
  deviceId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface RefreshInput {
  refreshToken: string;
  deviceId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface VerifyEmailInput {
  email: string;
  code: string;
  deviceId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface VerifyEmailByLinkInput {
  token: string;
}

export interface AuthRepository {
  createUser(input: Omit<AuthUserRecord, "id" | "createdAt" | "updatedAt">): Promise<AuthUserRecord>;
  listUsers(input: { search?: string; status?: AuthUserRecord["status"]; limit: number; offset: number }): Promise<AuthUserRecord[]>;
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  findUserById(id: string): Promise<AuthUserRecord | null>;
  markUserEmailVerified(id: string, verifiedAt: Date): Promise<AuthUserRecord | null>;
  updateUserGoogleIdentity(
    id: string,
    input: Partial<Pick<AuthUserRecord, "fullName" | "emailVerifiedAt" | "status" | "authProvider" | "firebaseAuthUid" | "lastLoginAt">>
  ): Promise<AuthUserRecord | null>;
  updateUserByAdmin(
    id: string,
    input: Partial<Pick<AuthUserRecord, "fullName" | "role" | "status" | "universityId" | "facultyId" | "departmentId" | "classLevel">>
  ): Promise<AuthUserRecord | null>;
  deleteUserByAdmin(id: string): Promise<void>;
  clearUserAppData(id: string): Promise<AuthUserRecord | null>;
  deleteUserAccount(
    id: string,
    input: {
      deletedAt: Date;
      anonymizedEmail: string;
      anonymizedFullName: string;
      anonymizedPasswordHash: string;
    }
  ): Promise<void>;
  updateUserProfile(id: string, input: { fullName?: string; classLevel?: number }): Promise<AuthUserRecord | null>;
  updateUserPassword(id: string, passwordHash: string): Promise<AuthUserRecord | null>;
  updateUserAcademicSelection(
    id: string,
    input: { universityId: string; facultyId?: string; departmentId?: string; classLevel?: number }
  ): Promise<AuthUserRecord | null>;
  createEmailVerificationToken(input: Omit<EmailVerificationTokenRecord, "id" | "createdAt">): Promise<EmailVerificationTokenRecord>;
  findEmailVerificationTokenByHash(tokenHash: string): Promise<EmailVerificationTokenRecord | null>;
  findLatestEmailVerificationTokenByUserId(userId: string): Promise<EmailVerificationTokenRecord | null>;
  consumeEmailVerificationToken(id: string, consumedAt: Date): Promise<void>;
  createPasswordRecoveryToken(input: Omit<PasswordRecoveryTokenRecord, "id" | "createdAt">): Promise<PasswordRecoveryTokenRecord>;
  findPasswordRecoveryTokenByHash(tokenHash: string): Promise<PasswordRecoveryTokenRecord | null>;
  findLatestPasswordRecoveryTokenByUserId(userId: string): Promise<PasswordRecoveryTokenRecord | null>;
  invalidatePasswordRecoveryTokensByUserId(userId: string, invalidatedAt: Date): Promise<void>;
  consumePasswordRecoveryToken(id: string, consumedAt: Date): Promise<boolean>;
  deletePasswordRecoveryTokensByUserId(userId: string): Promise<void>;
  createRefreshToken(input: Omit<RefreshTokenRecord, "id" | "createdAt">): Promise<RefreshTokenRecord>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revokeRefreshToken(id: string, revokedAt: Date): Promise<void>;
  markRefreshTokenReused(id: string, reusedAt: Date): Promise<void>;
  revokeRefreshTokenFamily(familyId: string, revokedAt: Date): Promise<void>;
  revokeRefreshTokensByUserId(userId: string, revokedAt: Date): Promise<void>;
  deleteEmailVerificationTokensByUserId(userId: string): Promise<void>;
}
