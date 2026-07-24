import { Inject, Injectable } from "@nestjs/common";
import type { CollectionReference, DocumentData } from "firebase-admin/firestore";
import { FirestoreDatabaseService } from "../../database/firestore.service.js";
import { cleanFirestoreData, getAllFirestoreRecords, newFirestoreId, toFirestoreRecord } from "../../database/firestore-utils.js";
import type { AuthRepository, AuthUserRecord, EmailVerificationTokenRecord, RefreshTokenRecord } from "./auth.types.js";

@Injectable()
export class FirestoreAuthRepository implements AuthRepository {
  constructor(@Inject(FirestoreDatabaseService) private readonly firestore: FirestoreDatabaseService) {}

  async createUser(input: Omit<AuthUserRecord, "id" | "createdAt" | "updatedAt">): Promise<AuthUserRecord> {
    const normalizedEmail = input.email.toLocaleLowerCase("tr-TR");
    const existing = await this.findUserByEmail(normalizedEmail);
    if (existing) throw new Error("EMAIL_ALREADY_EXISTS");
    const now = new Date();
    const user: AuthUserRecord = { ...input, id: newFirestoreId(), email: normalizedEmail, createdAt: now, updatedAt: now };
    await this.users.doc(user.id).set(cleanFirestoreData(user as unknown as Record<string, unknown>));
    return user;
  }

  async listUsers(input: { search?: string; status?: AuthUserRecord["status"]; limit: number; offset: number }): Promise<AuthUserRecord[]> {
    const records = input.status
      ? await getAllFirestoreRecords<AuthUserRecord>(this.users.where("status", "==", input.status))
      : await getAllFirestoreRecords<AuthUserRecord>(this.users);
    const search = input.search?.trim().toLocaleLowerCase("tr-TR");
    return records
      .filter((user) => !user.deletedAt)
      .filter((user) => (search ? user.fullName.toLocaleLowerCase("tr-TR").includes(search) || user.email.includes(search) : true))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(input.offset, input.offset + input.limit);
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const snapshot = await this.users.where("email", "==", email.toLocaleLowerCase("tr-TR")).limit(1).get();
    const user = snapshot.docs[0] ? toFirestoreRecord<AuthUserRecord>(snapshot.docs[0]) : null;
    return user && !user.deletedAt ? user : null;
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    const user = toFirestoreRecord<AuthUserRecord>(await this.users.doc(id).get());
    return user && !user.deletedAt ? user : null;
  }

  markUserEmailVerified(id: string, verifiedAt: Date): Promise<AuthUserRecord | null> {
    return this.updateUser(id, { status: "active", emailVerifiedAt: verifiedAt });
  }

  updateUserGoogleIdentity(
    id: string,
    input: Partial<Pick<AuthUserRecord, "fullName" | "emailVerifiedAt" | "status" | "authProvider" | "firebaseAuthUid" | "lastLoginAt">>
  ): Promise<AuthUserRecord | null> {
    return this.updateUser(id, input);
  }

  updateUserByAdmin(
    id: string,
    input: Partial<Pick<AuthUserRecord, "fullName" | "role" | "status" | "universityId" | "facultyId" | "departmentId" | "classLevel">>
  ): Promise<AuthUserRecord | null> {
    return this.updateUser(id, input);
  }

  async deleteUserByAdmin(id: string): Promise<void> {
    const user = await this.findUserById(id);
    if (!user) return;
    await this.users.doc(id).set(cleanFirestoreData({ ...user, status: "inactive", deletedAt: new Date(), updatedAt: new Date() }), { merge: false });
  }

  async clearUserAppData(id: string): Promise<AuthUserRecord | null> {
    const user = await this.findUserById(id);
    if (!user) return null;
    const { universityId: _universityId, facultyId: _facultyId, departmentId: _departmentId, classLevel: _classLevel, ...rest } = user;
    const updated: AuthUserRecord = { ...rest, updatedAt: new Date() };
    await this.users.doc(id).set(cleanFirestoreData(updated as unknown as Record<string, unknown>), { merge: false });
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
    const user = await this.findUserById(id);
    if (!user) return;
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
    const deletedUser: AuthUserRecord = {
      ...rest,
      fullName: input.anonymizedFullName,
      email: input.anonymizedEmail.toLocaleLowerCase("tr-TR"),
      passwordHash: input.anonymizedPasswordHash,
      status: "inactive",
      deletedAt: input.deletedAt,
      updatedAt: input.deletedAt
    };
    await this.users.doc(id).set(cleanFirestoreData(deletedUser as unknown as Record<string, unknown>), { merge: false });
  }

  updateUserProfile(id: string, input: { fullName?: string; classLevel?: number }): Promise<AuthUserRecord | null> {
    return this.updateUser(id, {
      ...(input.fullName ? { fullName: input.fullName } : {}),
      ...(input.classLevel ? { classLevel: input.classLevel } : {})
    });
  }

  updateUserAcademicSelection(id: string, input: { universityId: string; facultyId?: string; departmentId?: string; classLevel?: number }): Promise<AuthUserRecord | null> {
    return this.updateUser(id, {
      universityId: input.universityId,
      ...(input.facultyId ? { facultyId: input.facultyId } : {}),
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
      ...(input.classLevel ? { classLevel: input.classLevel } : {})
    });
  }

  async createEmailVerificationToken(input: Omit<EmailVerificationTokenRecord, "id" | "createdAt">): Promise<EmailVerificationTokenRecord> {
    const token: EmailVerificationTokenRecord = { ...input, id: newFirestoreId(), createdAt: new Date() };
    await this.emailVerificationTokens.doc(token.id).set(cleanFirestoreData(token as unknown as Record<string, unknown>));
    return token;
  }

  async findEmailVerificationTokenByHash(tokenHash: string): Promise<EmailVerificationTokenRecord | null> {
    const snapshot = await this.emailVerificationTokens.where("tokenHash", "==", tokenHash).limit(1).get();
    return snapshot.docs[0] ? toFirestoreRecord<EmailVerificationTokenRecord>(snapshot.docs[0]) : null;
  }

  async findLatestEmailVerificationTokenByUserId(userId: string): Promise<EmailVerificationTokenRecord | null> {
    const tokens = await getAllFirestoreRecords<EmailVerificationTokenRecord>(this.emailVerificationTokens.where("userId", "==", userId));
    return tokens.filter((token) => !token.consumedAt).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
  }

  async consumeEmailVerificationToken(id: string, consumedAt: Date): Promise<void> {
    await this.emailVerificationTokens.doc(id).set(cleanFirestoreData({ consumedAt }), { merge: true });
  }

  async createRefreshToken(input: Omit<RefreshTokenRecord, "id" | "createdAt">): Promise<RefreshTokenRecord> {
    const refreshToken: RefreshTokenRecord = { ...input, id: newFirestoreId(), createdAt: new Date() };
    await this.refreshTokens.doc(refreshToken.id).set(cleanFirestoreData(refreshToken as unknown as Record<string, unknown>));
    return refreshToken;
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const snapshot = await this.refreshTokens.where("tokenHash", "==", tokenHash).limit(1).get();
    return snapshot.docs[0] ? toFirestoreRecord<RefreshTokenRecord>(snapshot.docs[0]) : null;
  }

  async revokeRefreshToken(id: string, revokedAt: Date): Promise<void> {
    await this.refreshTokens.doc(id).set(cleanFirestoreData({ revokedAt }), { merge: true });
  }

  async markRefreshTokenReused(id: string, reusedAt: Date): Promise<void> {
    await this.refreshTokens.doc(id).set(cleanFirestoreData({ reusedAt }), { merge: true });
  }

  async revokeRefreshTokenFamily(familyId: string, revokedAt: Date): Promise<void> {
    const tokens = await getAllFirestoreRecords<RefreshTokenRecord>(this.refreshTokens.where("familyId", "==", familyId));
    const batch = this.firestore.getDb().batch();
    for (const token of tokens.filter((record) => !record.revokedAt)) {
      batch.set(this.refreshTokens.doc(token.id), cleanFirestoreData({ revokedAt }), { merge: true });
    }
    await batch.commit();
  }

  async revokeRefreshTokensByUserId(userId: string, revokedAt: Date): Promise<void> {
    const tokens = await getAllFirestoreRecords<RefreshTokenRecord>(this.refreshTokens.where("userId", "==", userId));
    const batch = this.firestore.getDb().batch();
    for (const token of tokens.filter((record) => !record.revokedAt)) {
      batch.set(this.refreshTokens.doc(token.id), cleanFirestoreData({ revokedAt }), { merge: true });
    }
    await batch.commit();
  }

  async deleteEmailVerificationTokensByUserId(userId: string): Promise<void> {
    const tokens = await getAllFirestoreRecords<EmailVerificationTokenRecord>(this.emailVerificationTokens.where("userId", "==", userId));
    const batch = this.firestore.getDb().batch();
    for (const token of tokens) batch.delete(this.emailVerificationTokens.doc(token.id));
    await batch.commit();
  }

  private async updateUser(id: string, input: Partial<Omit<AuthUserRecord, "id" | "createdAt" | "updatedAt">>): Promise<AuthUserRecord | null> {
    const user = await this.findUserById(id);
    if (!user) return null;
    const updated: AuthUserRecord = { ...user, ...input, updatedAt: new Date() };
    await this.users.doc(id).set(cleanFirestoreData(updated as unknown as Record<string, unknown>), { merge: false });
    return updated;
  }

  private get users(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("users");
  }

  private get emailVerificationTokens(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("email_verification_tokens");
  }

  private get refreshTokens(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("refresh_tokens");
  }
}
