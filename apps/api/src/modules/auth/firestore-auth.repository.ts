import { Inject, Injectable } from "@nestjs/common";
import { FieldValue, type CollectionReference, type DocumentData } from "firebase-admin/firestore";
import { FirestoreDatabaseService } from "../../database/firestore.service.js";
import { cleanFirestoreData, getAllFirestoreRecords, newFirestoreId, toFirestoreRecord } from "../../database/firestore-utils.js";
import type {
  AuthRepository,
  AuthUserRecord,
  CreateAuthUserInput,
  CreatePasswordRecoveryTokenInput,
  CreateRefreshTokenInput,
  EmailVerificationTokenRecord,
  PasswordRecoveryTokenRecord,
  RefreshTokenRecord
} from "./auth.types.js";
import {
  normalizeAuthUserRecord,
  normalizePasswordRecoveryTokenRecord,
  normalizeRefreshTokenRecord
} from "./credential-generation.js";

@Injectable()
export class FirestoreAuthRepository implements AuthRepository {
  constructor(@Inject(FirestoreDatabaseService) private readonly firestore: FirestoreDatabaseService) {}

  async createUser(input: CreateAuthUserInput): Promise<AuthUserRecord> {
    const normalizedEmail = input.email.toLowerCase();
    const existing = await this.findUserByEmail(normalizedEmail);
    if (existing) throw new Error("EMAIL_ALREADY_EXISTS");
    const now = new Date();
    const user: AuthUserRecord = {
      ...input,
      id: newFirestoreId(),
      credentialGeneration: 0,
      email: normalizedEmail,
      createdAt: now,
      updatedAt: now
    };
    await this.users.doc(user.id).set(cleanFirestoreData(user as unknown as Record<string, unknown>));
    return user;
  }

  async listUsers(input: { search?: string; status?: AuthUserRecord["status"]; limit: number; offset: number }): Promise<AuthUserRecord[]> {
    const records = input.status
      ? await getAllFirestoreRecords<AuthUserRecord>(this.users.where("status", "==", input.status))
      : await getAllFirestoreRecords<AuthUserRecord>(this.users);
    const search = input.search?.trim().toLocaleLowerCase("tr-TR");
    return records
      .map(normalizeAuthUserRecord)
      .filter((user) => !user.deletedAt)
      .filter((user) => (search ? user.fullName.toLocaleLowerCase("tr-TR").includes(search) || user.email.includes(search) : true))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(input.offset, input.offset + input.limit);
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const snapshot = await this.users.where("email", "==", email.toLowerCase()).limit(1).get();
    const user = snapshot.docs[0] ? toFirestoreRecord<AuthUserRecord>(snapshot.docs[0]) : null;
    return user && !user.deletedAt ? normalizeAuthUserRecord(user) : null;
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    const user = toFirestoreRecord<AuthUserRecord>(await this.users.doc(id).get());
    return user && !user.deletedAt ? normalizeAuthUserRecord(user) : null;
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
    const deletedAt = new Date();
    await this.updateUserFields(id, { status: "inactive", deletedAt }, []);
  }

  async clearUserAppData(id: string): Promise<AuthUserRecord | null> {
    return this.updateUserFields(id, {}, ["universityId", "facultyId", "departmentId", "classLevel"]);
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
    await this.updateUserFields(
      id,
      {
        fullName: input.anonymizedFullName,
        email: input.anonymizedEmail.toLowerCase(),
        passwordHash: input.anonymizedPasswordHash,
        status: "inactive",
        deletedAt: input.deletedAt,
        updatedAt: input.deletedAt
      },
      ["emailVerifiedAt", "firebaseAuthUid", "universityId", "facultyId", "departmentId", "classLevel", "lastLoginAt"]
    );
  }

  updateUserProfile(id: string, input: { fullName?: string; classLevel?: number }): Promise<AuthUserRecord | null> {
    return this.updateUser(id, {
      ...(input.fullName ? { fullName: input.fullName } : {}),
      ...(input.classLevel ? { classLevel: input.classLevel } : {})
    });
  }

  async updateUserAcademicSelection(id: string, input: { universityId: string; facultyId?: string; departmentId?: string; classLevel?: number }): Promise<AuthUserRecord | null> {
    return this.updateUserFields(
      id,
      {
        universityId: input.universityId,
        ...(input.facultyId ? { facultyId: input.facultyId } : {}),
        ...(input.departmentId ? { departmentId: input.departmentId } : {}),
        ...(input.classLevel ? { classLevel: input.classLevel } : {})
      },
      [
        ...(input.facultyId ? [] : ["facultyId"]),
        ...(input.departmentId ? [] : ["departmentId"]),
        ...(input.classLevel ? [] : ["classLevel"])
      ]
    );
  }

  async updateUserPassword(id: string, passwordHash: string): Promise<AuthUserRecord | null> {
    const user = await this.findUserById(id);
    if (!user) return null;
    return this.updateUser(id, {
      passwordHash,
      authProvider: user.authProvider === "google" ? "password_google" : user.authProvider ?? "password"
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

  async createRefreshToken(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord> {
    const refreshToken = normalizeRefreshTokenRecord({ ...input, id: newFirestoreId(), createdAt: new Date() });
    await this.refreshTokens.doc(refreshToken.id).set(cleanFirestoreData(refreshToken as unknown as Record<string, unknown>));
    return refreshToken;
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const snapshot = await this.refreshTokens.where("tokenHash", "==", tokenHash).limit(1).get();
    const token = snapshot.docs[0] ? toFirestoreRecord<RefreshTokenRecord>(snapshot.docs[0]) : null;
    return token ? normalizeRefreshTokenRecord(token) : null;
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

  async createPasswordRecoveryToken(input: CreatePasswordRecoveryTokenInput): Promise<PasswordRecoveryTokenRecord> {
    const token = normalizePasswordRecoveryTokenRecord({ ...input, id: newFirestoreId(), createdAt: new Date() });
    await this.passwordRecoveryTokens.doc(token.id).set(cleanFirestoreData(token as unknown as Record<string, unknown>));
    return token;
  }

  async findPasswordRecoveryTokenByHash(tokenHash: string): Promise<PasswordRecoveryTokenRecord | null> {
    const snapshot = await this.passwordRecoveryTokens.where("tokenHash", "==", tokenHash).limit(1).get();
    const token = snapshot.docs[0] ? toFirestoreRecord<PasswordRecoveryTokenRecord>(snapshot.docs[0]) : null;
    return token ? normalizePasswordRecoveryTokenRecord(token) : null;
  }

  async findLatestPasswordRecoveryTokenByUserId(userId: string): Promise<PasswordRecoveryTokenRecord | null> {
    const tokens = (await getAllFirestoreRecords<PasswordRecoveryTokenRecord>(this.passwordRecoveryTokens.where("userId", "==", userId))).map(
      normalizePasswordRecoveryTokenRecord
    );
    return tokens.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
  }

  async invalidatePasswordRecoveryTokensByUserId(userId: string, invalidatedAt: Date): Promise<void> {
    const tokens = await getAllFirestoreRecords<PasswordRecoveryTokenRecord>(this.passwordRecoveryTokens.where("userId", "==", userId));
    const batch = this.firestore.getDb().batch();
    for (const token of tokens.filter((record) => !record.consumedAt && !record.invalidatedAt)) {
      batch.set(this.passwordRecoveryTokens.doc(token.id), cleanFirestoreData({ invalidatedAt }), { merge: true });
    }
    await batch.commit();
  }

  async consumePasswordRecoveryToken(id: string, consumedAt: Date): Promise<boolean> {
    const db = this.firestore.getDb();
    const reference = this.passwordRecoveryTokens.doc(id);
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const token = toFirestoreRecord<PasswordRecoveryTokenRecord>(snapshot);
      if (!token || token.consumedAt || token.invalidatedAt || token.expiresAt.getTime() <= consumedAt.getTime()) return false;
      transaction.set(reference, cleanFirestoreData({ consumedAt }), { merge: true });
      return true;
    });
  }

  async deletePasswordRecoveryTokensByUserId(userId: string): Promise<void> {
    const tokens = await getAllFirestoreRecords<PasswordRecoveryTokenRecord>(this.passwordRecoveryTokens.where("userId", "==", userId));
    const batch = this.firestore.getDb().batch();
    for (const token of tokens) batch.delete(this.passwordRecoveryTokens.doc(token.id));
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

  private async updateUser(
    id: string,
    input: Partial<Omit<AuthUserRecord, "id" | "createdAt" | "updatedAt" | "credentialGeneration">>
  ): Promise<AuthUserRecord | null> {
    return this.updateUserFields(id, input as Record<string, unknown>, []);
  }

  private async updateUserFields(
    id: string,
    input: Record<string, unknown>,
    fieldsToDelete: string[]
  ): Promise<AuthUserRecord | null> {
    if (!(await this.findUserById(id))) return null;

    const { credentialGeneration: _credentialGeneration, ...safeInput } = input;
    void _credentialGeneration;
    const update = cleanFirestoreData({
      ...safeInput,
      updatedAt: safeInput.updatedAt ?? new Date()
    });
    for (const field of fieldsToDelete) update[field] = FieldValue.delete();

    await this.users.doc(id).update(update);
    return this.findUserById(id);
  }

  private get users(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("users");
  }

  private get emailVerificationTokens(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("email_verification_tokens");
  }

  private get passwordRecoveryTokens(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("password_recovery_tokens");
  }

  private get refreshTokens(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("refresh_tokens");
  }
}
