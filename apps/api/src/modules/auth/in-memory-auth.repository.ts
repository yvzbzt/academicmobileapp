import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  AuthRepository,
  AuthUserRecord,
  CompletePasswordRecoveryInput,
  CreateAuthUserInput,
  CreatePasswordRecoveryTokenInput,
  CreateRecentAuthenticationProofInput,
  CreateRefreshTokenInput,
  ConsumeRecentAuthenticationProofInput,
  EmailVerificationTokenRecord,
  PasswordRecoveryTokenRecord,
  RefreshTokenRecord
} from "./auth.types.js";
import {
  normalizeAuthUserRecord,
  normalizePasswordRecoveryTokenRecord,
  normalizeRefreshTokenRecord
} from "./credential-generation.js";
import { linkedAuthProvider } from "./auth-provider.js";

@Injectable()
export class InMemoryAuthRepository implements AuthRepository {
  private readonly users = new Map<string, AuthUserRecord>();
  private readonly emailVerificationTokens = new Map<string, EmailVerificationTokenRecord>();
  private readonly passwordRecoveryTokens = new Map<string, PasswordRecoveryTokenRecord>();
  private readonly recentAuthenticationProofs = new Map<string, CreateRecentAuthenticationProofInput & { consumedAt?: Date }>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  async createUser(input: CreateAuthUserInput): Promise<AuthUserRecord> {
    const normalizedEmail = input.email.toLowerCase();
    if ([...this.users.values()].some((user) => user.email === normalizedEmail && !user.deletedAt)) {
      throw new Error("EMAIL_ALREADY_EXISTS");
    }

    const now = new Date();
    const user: AuthUserRecord = {
      ...input,
      id: randomUUID(),
      credentialGeneration: 0,
      email: normalizedEmail,
      createdAt: now,
      updatedAt: now
    };
    return this.storeUser(user);
  }

  async listUsers(input: { search?: string; status?: AuthUserRecord["status"]; limit: number; offset: number }): Promise<AuthUserRecord[]> {
    const search = input.search?.trim().toLocaleLowerCase("tr-TR");
    return [...this.users.values()]
      .map(normalizeAuthUserRecord)
      .filter((user) => !user.deletedAt)
      .filter((user) => (input.status ? user.status === input.status : true))
      .filter((user) => (search ? user.fullName.toLocaleLowerCase("tr-TR").includes(search) || user.email.includes(search) : true))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(input.offset, input.offset + input.limit);
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const normalizedEmail = email.toLowerCase();
    const user = [...this.users.values()].find((candidate) => candidate.email === normalizedEmail && !candidate.deletedAt);
    return user ? normalizeAuthUserRecord(user) : null;
  }

  async findUserByAppleSubject(subject: string): Promise<AuthUserRecord | null> {
    const user = [...this.users.values()].find((candidate) => candidate.appleSubject === subject && !candidate.deletedAt);
    return user ? normalizeAuthUserRecord(user) : null;
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    return this.getActiveUser(id);
  }

  async markUserEmailVerified(id: string, verifiedAt: Date): Promise<AuthUserRecord | null> {
    const user = this.getActiveUser(id);
    if (!user) return null;
    return this.storeUser({
      ...user,
      status: "active",
      emailVerifiedAt: verifiedAt,
      updatedAt: new Date()
    });
  }

  async updateUserGoogleIdentity(
    id: string,
    input: Partial<Pick<AuthUserRecord, "fullName" | "emailVerifiedAt" | "status" | "authProvider" | "firebaseAuthUid" | "lastLoginAt">>
  ): Promise<AuthUserRecord | null> {
    const user = this.getActiveUser(id);
    if (!user) return null;
    return this.storeUser({
      ...user,
      ...input,
      credentialGeneration: user.credentialGeneration,
      updatedAt: new Date()
    });
  }

  async updateUserAppleIdentity(
    id: string,
    input: Partial<Pick<AuthUserRecord, "fullName" | "emailVerifiedAt" | "status" | "authProvider" | "appleSubject" | "lastLoginAt">>
  ): Promise<AuthUserRecord | null> {
    const user = this.getActiveUser(id);
    if (!user) return null;
    return this.storeUser({
      ...user,
      ...input,
      credentialGeneration: user.credentialGeneration,
      updatedAt: new Date()
    });
  }

  async updateUserByAdmin(
    id: string,
    input: Partial<Pick<AuthUserRecord, "fullName" | "role" | "status" | "universityId" | "facultyId" | "departmentId" | "classLevel">>
  ): Promise<AuthUserRecord | null> {
    const user = this.getActiveUser(id);
    if (!user) return null;
    return this.storeUser({
      ...user,
      ...input,
      credentialGeneration: user.credentialGeneration,
      updatedAt: new Date()
    });
  }

  async deleteUserByAdmin(id: string): Promise<void> {
    const user = this.getActiveUser(id);
    if (user) this.storeUser({ ...user, status: "inactive", deletedAt: new Date(), updatedAt: new Date() });
  }

  async clearUserAppData(id: string): Promise<AuthUserRecord | null> {
    const user = this.getActiveUser(id);
    if (!user) return null;
    const { universityId: _universityId, facultyId: _facultyId, departmentId: _departmentId, classLevel: _classLevel, ...rest } = user;
    return this.storeUser({
      ...rest,
      updatedAt: new Date()
    });
  }

  async deleteUserAccount(
    id: string,
    input: {
      deletedAt: Date;
      anonymizedEmail: string;
      anonymizedFullName: string;
      anonymizedPasswordHash: string;
    }
  ): Promise<void> {
    const user = this.getActiveUser(id);
    if (!user) return;
    const {
      emailVerifiedAt: _emailVerifiedAt,
      firebaseAuthUid: _firebaseAuthUid,
      appleSubject: _appleSubject,
      universityId: _universityId,
      facultyId: _facultyId,
      departmentId: _departmentId,
      classLevel: _classLevel,
      lastLoginAt: _lastLoginAt,
      ...rest
    } = user;
    this.storeUser({
      ...rest,
      fullName: input.anonymizedFullName,
      email: input.anonymizedEmail.toLowerCase(),
      passwordHash: input.anonymizedPasswordHash,
      status: "inactive",
      deletedAt: input.deletedAt,
      updatedAt: input.deletedAt
    });
  }

  async updateUserProfile(id: string, input: { fullName?: string; classLevel?: number }): Promise<AuthUserRecord | null> {
    const user = this.getActiveUser(id);
    if (!user) return null;
    return this.storeUser({
      ...user,
      ...(input.fullName ? { fullName: input.fullName } : {}),
      ...(input.classLevel ? { classLevel: input.classLevel } : {}),
      updatedAt: new Date()
    });
  }

  async updateUserPassword(id: string, passwordHash: string): Promise<AuthUserRecord | null> {
    const user = this.getActiveUser(id);
    if (!user) return null;
    return this.storeUser({
      ...user,
      passwordHash,
      authProvider: linkedAuthProvider(user.authProvider, "password"),
      updatedAt: new Date()
    });
  }

  async completePasswordRecovery(input: CompletePasswordRecoveryInput): Promise<"completed" | "already_completed" | "conflict"> {
    const user = this.getActiveUser(input.userId);
    if (!user) return "conflict";
    if (user.passwordRecoveryCompletion?.operationKey === input.operationKey) return "already_completed";
    if (
      user.credentialGeneration !== input.expectedCredentialGeneration
      || user.passwordRecoveryAttempt?.tokenHash !== input.tokenHash
      || user.passwordRecoveryAttempt.credentialGeneration !== input.expectedCredentialGeneration
      || user.passwordRecoveryAttempt.expiresAt.getTime() <= input.completedAt.getTime()
    ) return "conflict";

    const credentialGeneration = input.expectedCredentialGeneration + 1;
    this.storeUser({
      ...withoutPasswordRecoveryAttempt(user),
      passwordHash: input.passwordHash,
      authProvider: input.authProvider,
      credentialGeneration,
      passwordRecoveryCompletion: {
        operationKey: input.operationKey,
        completedAt: input.completedAt,
        credentialGeneration
      },
      updatedAt: input.completedAt
    });
    return "completed";
  }

  async updateUserAcademicSelection(
    id: string,
    input: { universityId: string; facultyId?: string; departmentId?: string; classLevel?: number }
  ): Promise<AuthUserRecord | null> {
    const user = this.getActiveUser(id);
    if (!user) return null;
    const { facultyId: _facultyId, departmentId: _departmentId, classLevel: _classLevel, ...userWithoutDependentSelection } = user;
    return this.storeUser({
      ...userWithoutDependentSelection,
      universityId: input.universityId,
      ...(input.facultyId ? { facultyId: input.facultyId } : {}),
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
      ...(input.classLevel ? { classLevel: input.classLevel } : {}),
      updatedAt: new Date()
    });
  }

  async createEmailVerificationToken(input: Omit<EmailVerificationTokenRecord, "id" | "createdAt">): Promise<EmailVerificationTokenRecord> {
    const token: EmailVerificationTokenRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date()
    };
    this.emailVerificationTokens.set(token.id, token);
    return token;
  }

  async findEmailVerificationTokenByHash(tokenHash: string): Promise<EmailVerificationTokenRecord | null> {
    return [...this.emailVerificationTokens.values()].find((token) => token.tokenHash === tokenHash) ?? null;
  }

  async findLatestEmailVerificationTokenByUserId(userId: string): Promise<EmailVerificationTokenRecord | null> {
    return [...this.emailVerificationTokens.values()]
      .filter((token) => token.userId === userId && !token.consumedAt)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
  }

  async consumeEmailVerificationToken(id: string, consumedAt: Date): Promise<void> {
    const token = this.emailVerificationTokens.get(id);
    if (token) this.emailVerificationTokens.set(id, { ...token, consumedAt });
  }

  async createRefreshToken(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord> {
    const refreshToken = normalizeRefreshTokenRecord({
      ...input,
      id: randomUUID(),
      createdAt: new Date()
    });
    this.refreshTokens.set(refreshToken.id, { ...refreshToken });
    return { ...refreshToken };
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const token = [...this.refreshTokens.values()].find((candidate) => candidate.tokenHash === tokenHash);
    return token ? normalizeRefreshTokenRecord(token) : null;
  }

  async consumeRefreshTokenForRotation(id: string, revokedAt: Date): Promise<boolean> {
    const token = this.refreshTokens.get(id);
    if (!token || token.revokedAt) return false;
    this.refreshTokens.set(id, normalizeRefreshTokenRecord({ ...token, revokedAt }));
    return true;
  }

  async revokeRefreshToken(id: string, revokedAt: Date): Promise<void> {
    const token = this.refreshTokens.get(id);
    if (token) this.refreshTokens.set(id, normalizeRefreshTokenRecord({ ...token, revokedAt }));
  }

  async markRefreshTokenReused(id: string, reusedAt: Date): Promise<void> {
    const token = this.refreshTokens.get(id);
    if (token) this.refreshTokens.set(id, normalizeRefreshTokenRecord({ ...token, reusedAt }));
  }

  async revokeRefreshTokenFamily(familyId: string, revokedAt: Date): Promise<void> {
    for (const [id, token] of this.refreshTokens.entries()) {
      if (token.familyId === familyId && !token.revokedAt) {
        this.refreshTokens.set(id, normalizeRefreshTokenRecord({ ...token, revokedAt }));
      }
    }
  }

  async createPasswordRecoveryToken(input: CreatePasswordRecoveryTokenInput): Promise<PasswordRecoveryTokenRecord> {
    const token = normalizePasswordRecoveryTokenRecord({
      ...input,
      id: randomUUID(),
      createdAt: new Date()
    });
    this.passwordRecoveryTokens.set(token.id, { ...token });
    const user = this.getActiveUser(input.userId);
    if (user && user.credentialGeneration === input.credentialGeneration) {
      this.storeUser({
        ...user,
        passwordRecoveryAttempt: {
          tokenHash: input.tokenHash,
          credentialGeneration: input.credentialGeneration,
          expiresAt: input.expiresAt
        },
        updatedAt: new Date()
      });
    }
    return { ...token };
  }

  async findPasswordRecoveryTokenByHash(tokenHash: string): Promise<PasswordRecoveryTokenRecord | null> {
    const token = [...this.passwordRecoveryTokens.values()].find((candidate) => candidate.tokenHash === tokenHash);
    return token ? normalizePasswordRecoveryTokenRecord(token) : null;
  }

  async findLatestPasswordRecoveryTokenByUserId(userId: string): Promise<PasswordRecoveryTokenRecord | null> {
    return [...this.passwordRecoveryTokens.values()]
      .map(normalizePasswordRecoveryTokenRecord)
      .filter((token) => token.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
  }

  async invalidatePasswordRecoveryTokensByUserId(userId: string, invalidatedAt: Date): Promise<void> {
    const user = this.getActiveUser(userId);
    if (user?.passwordRecoveryAttempt) {
      this.storeUser({ ...withoutPasswordRecoveryAttempt(user), updatedAt: invalidatedAt });
    }
    for (const [id, token] of this.passwordRecoveryTokens.entries()) {
      if (token.userId === userId && !token.consumedAt && !token.invalidatedAt) {
        this.passwordRecoveryTokens.set(id, normalizePasswordRecoveryTokenRecord({ ...token, invalidatedAt }));
      }
    }
  }

  async consumePasswordRecoveryToken(id: string, consumedAt: Date): Promise<boolean> {
    const token = this.passwordRecoveryTokens.get(id);
    if (!token || token.consumedAt || token.invalidatedAt || token.expiresAt.getTime() <= consumedAt.getTime()) return false;
    this.passwordRecoveryTokens.set(id, normalizePasswordRecoveryTokenRecord({ ...token, consumedAt }));
    return true;
  }

  async deletePasswordRecoveryTokensByUserId(userId: string): Promise<void> {
    const user = this.getActiveUser(userId);
    if (user?.passwordRecoveryAttempt) {
      this.storeUser({ ...withoutPasswordRecoveryAttempt(user), updatedAt: new Date() });
    }
    for (const [id, token] of this.passwordRecoveryTokens.entries()) {
      if (token.userId === userId) this.passwordRecoveryTokens.delete(id);
    }
  }

  async createRecentAuthenticationProof(input: CreateRecentAuthenticationProofInput): Promise<void> {
    if (this.recentAuthenticationProofs.has(input.jtiDigest)) {
      throw new Error("RECENT_AUTHENTICATION_JTI_DIGEST_ALREADY_EXISTS");
    }
    this.recentAuthenticationProofs.set(input.jtiDigest, { ...input });
  }

  async consumeRecentAuthenticationProof(input: ConsumeRecentAuthenticationProofInput): Promise<boolean> {
    const record = this.recentAuthenticationProofs.get(input.jtiDigest);
    if (
      !record
      || record.ownerId !== input.ownerId
      || record.credentialGeneration !== input.credentialGeneration
      || record.purpose !== input.purpose
      || record.consumedAt
      || record.expiresAt.getTime() <= input.consumedAt.getTime()
    ) {
      return false;
    }
    this.recentAuthenticationProofs.set(input.jtiDigest, { ...record, consumedAt: input.consumedAt });
    return true;
  }

  async revokeRefreshTokensByUserId(userId: string, revokedAt: Date): Promise<void> {
    for (const [id, token] of this.refreshTokens.entries()) {
      if (token.userId === userId && !token.revokedAt) {
        this.refreshTokens.set(id, normalizeRefreshTokenRecord({ ...token, revokedAt }));
      }
    }
  }

  async deleteEmailVerificationTokensByUserId(userId: string): Promise<void> {
    for (const [id, token] of this.emailVerificationTokens.entries()) {
      if (token.userId === userId) this.emailVerificationTokens.delete(id);
    }
  }

  private getActiveUser(id: string): AuthUserRecord | null {
    const user = this.users.get(id);
    return user && !user.deletedAt ? normalizeAuthUserRecord(user) : null;
  }

  private storeUser(user: AuthUserRecord): AuthUserRecord {
    const normalized = normalizeAuthUserRecord(user);
    this.users.set(normalized.id, { ...normalized });
    return { ...normalized };
  }
}

function withoutPasswordRecoveryAttempt(user: AuthUserRecord): AuthUserRecord {
  const { passwordRecoveryAttempt: _passwordRecoveryAttempt, ...remaining } = user;
  void _passwordRecoveryAttempt;
  return remaining;
}
