import type { UserRole } from "../../../../../packages/shared/src/contracts.js";

export interface AuthUserRecord {
  id: string;
  credentialGeneration: number;
  passwordRecoveryAttempt?: {
    tokenHash: string;
    credentialGeneration: number;
    expiresAt: Date;
  };
  passwordRecoveryCompletion?: {
    operationKey: string;
    completedAt: Date;
    credentialGeneration: number;
  };
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
  credentialGeneration?: number;
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  credentialGeneration: number;
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
  user: Pick<AuthUserRecord, "id" | "fullName" | "email" | "role" | "authProvider">;
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
  credentialGeneration: number;
  tokenHash: string;
  expiresAt: Date;
  resendAvailableAt: Date;
  consumedAt?: Date;
  invalidatedAt?: Date;
  createdAt: Date;
}

export type RecentAuthenticationPurpose = "delete_personal_data" | "delete_account";

export interface RecentAuthenticationProofRecord {
  ownerId: string;
  credentialGeneration: number;
  purpose: RecentAuthenticationPurpose;
  jtiDigest: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt?: Date;
}

export type CreateRecentAuthenticationProofInput = Omit<RecentAuthenticationProofRecord, "consumedAt">;

export interface ConsumeRecentAuthenticationProofInput {
  ownerId: string;
  credentialGeneration: number;
  purpose: RecentAuthenticationPurpose;
  jtiDigest: string;
  consumedAt: Date;
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

export type RecentAuthenticationInput =
  | { method: "password"; password: string; purpose: RecentAuthenticationPurpose }
  | { method: "google"; idToken: string; purpose: RecentAuthenticationPurpose };

export interface RecentAuthenticationResult {
  proof: string;
  expiresInSeconds: number;
}

export type PasswordRecoveryCompletionResult = "completed" | "already_completed" | "conflict";

export interface CompletePasswordRecoveryInput {
  userId: string;
  expectedCredentialGeneration: number;
  tokenHash: string;
  operationKey: string;
  passwordHash: string;
  completedAt: Date;
  authProvider: NonNullable<AuthUserRecord["authProvider"]>;
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

export type CreateAuthUserInput = Omit<AuthUserRecord, "id" | "createdAt" | "updatedAt" | "credentialGeneration">;

export type CreateRefreshTokenInput = Omit<RefreshTokenRecord, "id" | "createdAt">;

export type CreatePasswordRecoveryTokenInput = Omit<PasswordRecoveryTokenRecord, "id" | "createdAt">;

export interface AuthRepository {
  createUser(input: CreateAuthUserInput): Promise<AuthUserRecord>;
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
  completePasswordRecovery(input: CompletePasswordRecoveryInput): Promise<PasswordRecoveryCompletionResult>;
  updateUserAcademicSelection(
    id: string,
    input: { universityId: string; facultyId?: string; departmentId?: string; classLevel?: number }
  ): Promise<AuthUserRecord | null>;
  createEmailVerificationToken(input: Omit<EmailVerificationTokenRecord, "id" | "createdAt">): Promise<EmailVerificationTokenRecord>;
  findEmailVerificationTokenByHash(tokenHash: string): Promise<EmailVerificationTokenRecord | null>;
  findLatestEmailVerificationTokenByUserId(userId: string): Promise<EmailVerificationTokenRecord | null>;
  consumeEmailVerificationToken(id: string, consumedAt: Date): Promise<void>;
  createPasswordRecoveryToken(input: CreatePasswordRecoveryTokenInput): Promise<PasswordRecoveryTokenRecord>;
  findPasswordRecoveryTokenByHash(tokenHash: string): Promise<PasswordRecoveryTokenRecord | null>;
  findLatestPasswordRecoveryTokenByUserId(userId: string): Promise<PasswordRecoveryTokenRecord | null>;
  invalidatePasswordRecoveryTokensByUserId(userId: string, invalidatedAt: Date): Promise<void>;
  consumePasswordRecoveryToken(id: string, consumedAt: Date): Promise<boolean>;
  deletePasswordRecoveryTokensByUserId(userId: string): Promise<void>;
  createRecentAuthenticationProof(input: CreateRecentAuthenticationProofInput): Promise<void>;
  consumeRecentAuthenticationProof(input: ConsumeRecentAuthenticationProofInput): Promise<boolean>;
  createRefreshToken(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  consumeRefreshTokenForRotation(id: string, revokedAt: Date): Promise<boolean>;
  revokeRefreshToken(id: string, revokedAt: Date): Promise<void>;
  markRefreshTokenReused(id: string, reusedAt: Date): Promise<void>;
  revokeRefreshTokenFamily(familyId: string, revokedAt: Date): Promise<void>;
  revokeRefreshTokensByUserId(userId: string, revokedAt: Date): Promise<void>;
  deleteEmailVerificationTokensByUserId(userId: string): Promise<void>;
}
