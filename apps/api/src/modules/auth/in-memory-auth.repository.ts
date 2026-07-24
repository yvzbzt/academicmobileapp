import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthRepository, AuthUserRecord, EmailVerificationTokenRecord, RefreshTokenRecord } from "./auth.types.js";

@Injectable()
export class InMemoryAuthRepository implements AuthRepository {
  private readonly users = new Map<string, AuthUserRecord>();
  private readonly emailVerificationTokens = new Map<string, EmailVerificationTokenRecord>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  async createUser(input: Omit<AuthUserRecord, "id" | "createdAt" | "updatedAt">): Promise<AuthUserRecord> {
    const normalizedEmail = input.email.toLocaleLowerCase("tr-TR");
    const existing = await this.findUserByEmail(normalizedEmail);
    if (existing) throw new Error("EMAIL_ALREADY_EXISTS");

    const now = new Date();
    const user: AuthUserRecord = {
      ...input,
      id: randomUUID(),
      email: normalizedEmail,
      createdAt: now,
      updatedAt: now
    };
    this.users.set(user.id, user);
    return user;
  }

  async listUsers(input: { search?: string; status?: AuthUserRecord["status"]; limit: number; offset: number }): Promise<AuthUserRecord[]> {
    const search = input.search?.trim().toLocaleLowerCase("tr-TR");
    return [...this.users.values()]
      .filter((user) => !user.deletedAt)
      .filter((user) => (input.status ? user.status === input.status : true))
      .filter((user) => (search ? user.fullName.toLocaleLowerCase("tr-TR").includes(search) || user.email.includes(search) : true))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(input.offset, input.offset + input.limit);
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const normalizedEmail = email.toLocaleLowerCase("tr-TR");
    return [...this.users.values()].find((user) => user.email === normalizedEmail && !user.deletedAt) ?? null;
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    const user = this.users.get(id);
    return user && !user.deletedAt ? user : null;
  }

  async markUserEmailVerified(id: string, verifiedAt: Date): Promise<AuthUserRecord | null> {
    const user = this.users.get(id);
    if (!user) return null;
    const updated: AuthUserRecord = {
      ...user,
      status: "active",
      emailVerifiedAt: verifiedAt,
      updatedAt: new Date()
    };
    this.users.set(id, updated);
    return updated;
  }

  async updateUserGoogleIdentity(
    id: string,
    input: Partial<Pick<AuthUserRecord, "fullName" | "emailVerifiedAt" | "status" | "authProvider" | "firebaseAuthUid" | "lastLoginAt">>
  ): Promise<AuthUserRecord | null> {
    const user = await this.findUserById(id);
    if (!user) return null;
    const updated: AuthUserRecord = {
      ...user,
      ...input,
      updatedAt: new Date()
    };
    this.users.set(id, updated);
    return updated;
  }

  async updateUserByAdmin(
    id: string,
    input: Partial<Pick<AuthUserRecord, "fullName" | "role" | "status" | "universityId" | "facultyId" | "departmentId" | "classLevel">>
  ): Promise<AuthUserRecord | null> {
    const user = await this.findUserById(id);
    if (!user) return null;
    const updated: AuthUserRecord = {
      ...user,
      ...input,
      updatedAt: new Date()
    };
    this.users.set(id, updated);
    return updated;
  }

  async deleteUserByAdmin(id: string): Promise<void> {
    const user = this.users.get(id);
    if (user) this.users.set(id, { ...user, status: "inactive", deletedAt: new Date(), updatedAt: new Date() });
  }

  async clearUserAppData(id: string): Promise<AuthUserRecord | null> {
    const user = await this.findUserById(id);
    if (!user) return null;
    const { universityId: _universityId, facultyId: _facultyId, departmentId: _departmentId, classLevel: _classLevel, ...rest } = user;
    const updated: AuthUserRecord = {
      ...rest,
      updatedAt: new Date()
    };
    this.users.set(id, updated);
    return updated;
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
    const user = this.users.get(id);
    if (!user || user.deletedAt) return;
    const {
      emailVerifiedAt: _emailVerifiedAt,
      firebaseAuthUid: _firebaseAuthUid,
      universityId: _universityId,
      facultyId: _facultyId,
      departmentId: _departmentId,
      classLevel: _classLevel,
      lastLoginAt: _lastLoginAt,
      ...rest
    } = user;
    this.users.set(id, {
      ...rest,
      fullName: input.anonymizedFullName,
      email: input.anonymizedEmail.toLocaleLowerCase("tr-TR"),
      passwordHash: input.anonymizedPasswordHash,
      status: "inactive",
      deletedAt: input.deletedAt,
      updatedAt: input.deletedAt
    });
  }

  async updateUserProfile(id: string, input: { fullName?: string; classLevel?: number }): Promise<AuthUserRecord | null> {
    const user = this.users.get(id);
    if (!user) return null;
    const updated: AuthUserRecord = {
      ...user,
      ...(input.fullName ? { fullName: input.fullName } : {}),
      ...(input.classLevel ? { classLevel: input.classLevel } : {}),
      updatedAt: new Date()
    };
    this.users.set(id, updated);
    return updated;
  }

  async updateUserAcademicSelection(
    id: string,
    input: { universityId: string; facultyId?: string; departmentId?: string; classLevel?: number }
  ): Promise<AuthUserRecord | null> {
    const user = this.users.get(id);
    if (!user) return null;
    const updated: AuthUserRecord = {
      ...user,
      universityId: input.universityId,
      ...(input.facultyId ? { facultyId: input.facultyId } : {}),
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
      ...(input.classLevel ? { classLevel: input.classLevel } : {}),
      updatedAt: new Date()
    };
    this.users.set(id, updated);
    return updated;
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

  async createRefreshToken(input: Omit<RefreshTokenRecord, "id" | "createdAt">): Promise<RefreshTokenRecord> {
    const refreshToken: RefreshTokenRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date()
    };
    this.refreshTokens.set(refreshToken.id, refreshToken);
    return refreshToken;
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return [...this.refreshTokens.values()].find((token) => token.tokenHash === tokenHash) ?? null;
  }

  async revokeRefreshToken(id: string, revokedAt: Date): Promise<void> {
    const token = this.refreshTokens.get(id);
    if (token) this.refreshTokens.set(id, { ...token, revokedAt });
  }

  async markRefreshTokenReused(id: string, reusedAt: Date): Promise<void> {
    const token = this.refreshTokens.get(id);
    if (token) this.refreshTokens.set(id, { ...token, reusedAt });
  }

  async revokeRefreshTokenFamily(familyId: string, revokedAt: Date): Promise<void> {
    for (const [id, token] of this.refreshTokens.entries()) {
      if (token.familyId === familyId && !token.revokedAt) {
        this.refreshTokens.set(id, { ...token, revokedAt });
      }
    }
  }

  async revokeRefreshTokensByUserId(userId: string, revokedAt: Date): Promise<void> {
    for (const [id, token] of this.refreshTokens.entries()) {
      if (token.userId === userId && !token.revokedAt) {
        this.refreshTokens.set(id, { ...token, revokedAt });
      }
    }
  }

  async deleteEmailVerificationTokensByUserId(userId: string): Promise<void> {
    for (const [id, token] of this.emailVerificationTokens.entries()) {
      if (token.userId === userId) this.emailVerificationTokens.delete(id);
    }
  }
}
