import { Inject, Injectable } from "@nestjs/common";
import { emailVerificationTokenSchema, passwordRecoveryTokenSchema, recentAuthenticationProofSchema, refreshTokenSchema, userSchema } from "../../database/mongoose-schemas.js";
import { getModel, omitUndefined, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import { protectSensitiveValue, revealSensitiveValue, sensitiveLookupHash } from "../../security/data-protection.js";
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

@Injectable()
export class MongoAuthRepository implements AuthRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async createUser(input: CreateAuthUserInput): Promise<AuthUserRecord> {
    const model = await this.model("User", userSchema);
    const email = input.email.toLowerCase();
    const document = await model.create({
      ...input,
      credentialGeneration: 0,
      fullName: protectSensitiveValue(input.fullName, "user.fullName"),
      email: protectSensitiveValue(email, "user.email"),
      emailLookupHash: sensitiveLookupHash(email, "user.email"),
      ...(input.firebaseAuthUid ? {
        firebaseAuthUid: protectSensitiveValue(input.firebaseAuthUid, "user.firebaseAuthUid"),
        firebaseAuthUidLookupHash: sensitiveLookupHash(input.firebaseAuthUid, "user.firebaseAuthUid")
      } : {})
    });
    return toAuthUserRecord(document);
  }

  async listUsers(input: { search?: string; status?: AuthUserRecord["status"]; limit: number; offset: number }): Promise<AuthUserRecord[]> {
    const model = await this.model("User", userSchema);
    const query: Record<string, unknown> = { deletedAt: { $exists: false } };
    if (input.status) query.status = input.status;
    const search = input.search?.trim().toLocaleLowerCase("tr-TR");
    if (search) {
      const documents = await model.find(query).sort({ createdAt: -1 });
      return documents
        .map(toAuthUserRecord)
        .filter((user) => user.fullName.toLocaleLowerCase("tr-TR").includes(search) || user.email.toLowerCase().includes(search))
        .slice(input.offset, input.offset + input.limit);
    }

    const documents = await model.find(query).sort({ createdAt: -1 }).skip(input.offset).limit(input.limit);
    return documents.map(toAuthUserRecord);
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const model = await this.model("User", userSchema);
    const normalizedEmail = email.toLowerCase();
    const document = await model.findOne({
      $or: [
        { emailLookupHash: sensitiveLookupHash(normalizedEmail, "user.email") },
        { email: normalizedEmail }
      ],
      deletedAt: { $exists: false }
    });
    return document ? toAuthUserRecord(document) : null;
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    const model = await this.model("User", userSchema);
    const document = await model.findOne({ _id: id, deletedAt: { $exists: false } });
    return document ? toAuthUserRecord(document) : null;
  }

  async markUserEmailVerified(id: string, verifiedAt: Date): Promise<AuthUserRecord | null> {
    return this.updateUser(id, { status: "active", emailVerifiedAt: verifiedAt });
  }

  updateUserGoogleIdentity(
    id: string,
    input: Partial<Pick<AuthUserRecord, "fullName" | "emailVerifiedAt" | "status" | "authProvider" | "firebaseAuthUid" | "lastLoginAt">>
  ): Promise<AuthUserRecord | null> {
    return this.updateUser(id, input);
  }

  async updateUserByAdmin(
    id: string,
    input: Partial<Pick<AuthUserRecord, "fullName" | "role" | "status" | "universityId" | "facultyId" | "departmentId" | "classLevel">>
  ): Promise<AuthUserRecord | null> {
    return this.updateUser(id, input);
  }

  async deleteUserByAdmin(id: string): Promise<void> {
    const model = await this.model("User", userSchema);
    await model.findByIdAndUpdate(id, { status: "inactive", deletedAt: new Date() });
  }

  async clearUserAppData(id: string): Promise<AuthUserRecord | null> {
    const model = await this.model("User", userSchema);
    const document = await model.findOneAndUpdate(
      { _id: id, deletedAt: { $exists: false } },
      {
        $unset: {
          universityId: "",
          facultyId: "",
          departmentId: "",
          classLevel: ""
        }
      },
      { new: true }
    );
    return document ? toAuthUserRecord(document) : null;
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
    const model = await this.model("User", userSchema);
    await model.findOneAndUpdate(
      { _id: id, deletedAt: { $exists: false } },
      {
        $set: {
          fullName: protectSensitiveValue(input.anonymizedFullName, "user.fullName"),
          email: protectSensitiveValue(input.anonymizedEmail.toLowerCase(), "user.email"),
          emailLookupHash: sensitiveLookupHash(input.anonymizedEmail.toLowerCase(), "user.email"),
          passwordHash: input.anonymizedPasswordHash,
          status: "inactive",
          deletedAt: input.deletedAt
        },
        $unset: {
          emailVerifiedAt: "",
          firebaseAuthUid: "",
          firebaseAuthUidLookupHash: "",
          universityId: "",
          facultyId: "",
          departmentId: "",
          classLevel: "",
          lastLoginAt: ""
        }
      }
    );
  }

  async updateUserProfile(id: string, input: { fullName?: string; classLevel?: number }): Promise<AuthUserRecord | null> {
    return this.updateUser(id, input);
  }

  async updateUserPassword(id: string, passwordHash: string): Promise<AuthUserRecord | null> {
    const user = await this.findUserById(id);
    if (!user) return null;
    return this.updateUser(id, {
      passwordHash,
      authProvider: user.authProvider === "google" ? "password_google" : user.authProvider ?? "password"
    });
  }

  async completePasswordRecovery(input: CompletePasswordRecoveryInput): Promise<"completed" | "already_completed" | "conflict"> {
    const model = await this.model("User", userSchema);
    const nextCredentialGeneration = input.expectedCredentialGeneration + 1;
    const document = await model.findOneAndUpdate(
      {
        _id: input.userId,
        deletedAt: { $exists: false },
        "passwordRecoveryAttempt.tokenHash": input.tokenHash,
        "passwordRecoveryAttempt.credentialGeneration": input.expectedCredentialGeneration,
        "passwordRecoveryAttempt.expiresAt": { $gt: input.completedAt },
        $or: [
          { credentialGeneration: input.expectedCredentialGeneration },
          ...(input.expectedCredentialGeneration === 0 ? [{ credentialGeneration: { $exists: false } }] : [])
        ]
      },
      {
        $set: {
          passwordHash: input.passwordHash,
          authProvider: input.authProvider,
          passwordRecoveryCompletion: {
            operationKey: input.operationKey,
            completedAt: input.completedAt,
            credentialGeneration: nextCredentialGeneration
          }
        },
        $unset: { passwordRecoveryAttempt: "" },
        $inc: { credentialGeneration: 1 }
      },
      { new: true }
    );
    if (document) return "completed";

    const current = await model.findOne({ _id: input.userId, deletedAt: { $exists: false } });
    if (!current) return "conflict";
    const user = toAuthUserRecord(current);
    return user.passwordRecoveryCompletion?.operationKey === input.operationKey
      ? "already_completed"
      : "conflict";
  }

  async updateUserAcademicSelection(id: string, input: { universityId: string; facultyId?: string; departmentId?: string; classLevel?: number }): Promise<AuthUserRecord | null> {
    const model = await this.model("User", userSchema);
    const fieldsToSet = omitUndefined({
      universityId: input.universityId,
      facultyId: input.facultyId,
      departmentId: input.departmentId,
      classLevel: input.classLevel
    });
    const fieldsToUnset: Record<string, ""> = {};
    if (input.facultyId === undefined) fieldsToUnset.facultyId = "";
    if (input.departmentId === undefined) fieldsToUnset.departmentId = "";
    if (input.classLevel === undefined) fieldsToUnset.classLevel = "";
    const document = await model.findOneAndUpdate(
      { _id: id, deletedAt: { $exists: false } },
      {
        $set: fieldsToSet,
        ...(Object.keys(fieldsToUnset).length > 0 ? { $unset: fieldsToUnset } : {})
      },
      { new: true }
    );
    return document ? toAuthUserRecord(document) : null;
  }

  async createEmailVerificationToken(input: Omit<EmailVerificationTokenRecord, "id" | "createdAt">): Promise<EmailVerificationTokenRecord> {
    const model = await this.model("EmailVerificationToken", emailVerificationTokenSchema);
    const document = await model.create(input);
    return toDomainRecord<EmailVerificationTokenRecord>(document);
  }

  async findEmailVerificationTokenByHash(tokenHash: string): Promise<EmailVerificationTokenRecord | null> {
    const model = await this.model("EmailVerificationToken", emailVerificationTokenSchema);
    const document = await model.findOne({ tokenHash });
    return document ? toDomainRecord<EmailVerificationTokenRecord>(document) : null;
  }

  async findLatestEmailVerificationTokenByUserId(userId: string): Promise<EmailVerificationTokenRecord | null> {
    const model = await this.model("EmailVerificationToken", emailVerificationTokenSchema);
    const document = await model.findOne({ userId, consumedAt: { $exists: false } }).sort({ createdAt: -1 });
    return document ? toDomainRecord<EmailVerificationTokenRecord>(document) : null;
  }

  async consumeEmailVerificationToken(id: string, consumedAt: Date): Promise<void> {
    const model = await this.model("EmailVerificationToken", emailVerificationTokenSchema);
    await model.findByIdAndUpdate(id, { consumedAt });
  }

  async createRefreshToken(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord> {
    const model = await this.model("RefreshToken", refreshTokenSchema);
    const document = await model.create({
      ...input,
      ...(input.ipAddress ? { ipAddress: protectSensitiveValue(input.ipAddress, "refreshToken.ipAddress") } : {}),
      ...(input.userAgent ? { userAgent: protectSensitiveValue(input.userAgent, "refreshToken.userAgent") } : {})
    });
    return toRefreshTokenRecord(document);
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const model = await this.model("RefreshToken", refreshTokenSchema);
    const document = await model.findOne({ tokenHash });
    return document ? toRefreshTokenRecord(document) : null;
  }

  async revokeRefreshToken(id: string, revokedAt: Date): Promise<void> {
    const model = await this.model("RefreshToken", refreshTokenSchema);
    await model.findByIdAndUpdate(id, { revokedAt });
  }

  async markRefreshTokenReused(id: string, reusedAt: Date): Promise<void> {
    const model = await this.model("RefreshToken", refreshTokenSchema);
    await model.findByIdAndUpdate(id, { reusedAt });
  }

  async revokeRefreshTokenFamily(familyId: string, revokedAt: Date): Promise<void> {
    const model = await this.model("RefreshToken", refreshTokenSchema);
    await model.updateMany({ familyId, revokedAt: { $exists: false } }, { revokedAt });
  }

  async createPasswordRecoveryToken(input: CreatePasswordRecoveryTokenInput): Promise<PasswordRecoveryTokenRecord> {
    const model = await this.model("PasswordRecoveryToken", passwordRecoveryTokenSchema);
    const document = await model.create(input);
    const userModel = await this.model("User", userSchema);
    await userModel.updateOne(
      {
        _id: input.userId,
        deletedAt: { $exists: false },
        $or: [
          { credentialGeneration: input.credentialGeneration },
          ...(input.credentialGeneration === 0 ? [{ credentialGeneration: { $exists: false } }] : [])
        ]
      },
      {
        $set: {
          passwordRecoveryAttempt: {
            tokenHash: input.tokenHash,
            credentialGeneration: input.credentialGeneration,
            expiresAt: input.expiresAt
          }
        }
      }
    );
    return normalizePasswordRecoveryTokenRecord(toDomainRecord<PasswordRecoveryTokenRecord>(document));
  }

  async findPasswordRecoveryTokenByHash(tokenHash: string): Promise<PasswordRecoveryTokenRecord | null> {
    const model = await this.model("PasswordRecoveryToken", passwordRecoveryTokenSchema);
    const document = await model.findOne({ tokenHash });
    return document ? normalizePasswordRecoveryTokenRecord(toDomainRecord<PasswordRecoveryTokenRecord>(document)) : null;
  }

  async findLatestPasswordRecoveryTokenByUserId(userId: string): Promise<PasswordRecoveryTokenRecord | null> {
    const model = await this.model("PasswordRecoveryToken", passwordRecoveryTokenSchema);
    const document = await model.findOne({ userId }).sort({ createdAt: -1 });
    return document ? normalizePasswordRecoveryTokenRecord(toDomainRecord<PasswordRecoveryTokenRecord>(document)) : null;
  }

  async invalidatePasswordRecoveryTokensByUserId(userId: string, invalidatedAt: Date): Promise<void> {
    const userModel = await this.model("User", userSchema);
    await userModel.updateOne(
      { _id: userId, deletedAt: { $exists: false } },
      { $unset: { passwordRecoveryAttempt: "" }, $set: { updatedAt: invalidatedAt } }
    );
    const model = await this.model("PasswordRecoveryToken", passwordRecoveryTokenSchema);
    await model.updateMany(
      { userId, consumedAt: { $exists: false }, invalidatedAt: { $exists: false } },
      { $set: { invalidatedAt } }
    );
  }

  async consumePasswordRecoveryToken(id: string, consumedAt: Date): Promise<boolean> {
    const model = await this.model("PasswordRecoveryToken", passwordRecoveryTokenSchema);
    const document = await model.findOneAndUpdate(
      {
        _id: id,
        consumedAt: { $exists: false },
        invalidatedAt: { $exists: false },
        expiresAt: { $gt: consumedAt }
      },
      { $set: { consumedAt } },
      { new: true }
    );
    return Boolean(document);
  }

  async deletePasswordRecoveryTokensByUserId(userId: string): Promise<void> {
    const userModel = await this.model("User", userSchema);
    await userModel.updateOne(
      { _id: userId, deletedAt: { $exists: false } },
      { $unset: { passwordRecoveryAttempt: "" }, $set: { updatedAt: new Date() } }
    );
    const model = await this.model("PasswordRecoveryToken", passwordRecoveryTokenSchema);
    await model.deleteMany({ userId });
  }

  async createRecentAuthenticationProof(input: CreateRecentAuthenticationProofInput): Promise<void> {
    const model = await this.model("RecentAuthenticationProof", recentAuthenticationProofSchema);
    await model.create(input);
  }

  async consumeRecentAuthenticationProof(input: ConsumeRecentAuthenticationProofInput): Promise<boolean> {
    const model = await this.model("RecentAuthenticationProof", recentAuthenticationProofSchema);
    const document = await model.findOneAndUpdate(
      {
        ownerId: input.ownerId,
        credentialGeneration: input.credentialGeneration,
        purpose: input.purpose,
        jtiDigest: input.jtiDigest,
        consumedAt: null,
        expiresAt: { $gt: input.consumedAt }
      },
      { $set: { consumedAt: input.consumedAt } },
      { new: true }
    );
    return Boolean(document);
  }

  async revokeRefreshTokensByUserId(userId: string, revokedAt: Date): Promise<void> {
    const model = await this.model("RefreshToken", refreshTokenSchema);
    await model.updateMany({ userId, revokedAt: { $exists: false } }, { revokedAt });
  }

  async deleteEmailVerificationTokensByUserId(userId: string): Promise<void> {
    const model = await this.model("EmailVerificationToken", emailVerificationTokenSchema);
    await model.deleteMany({ userId });
  }

  private async updateUser(id: string, input: Record<string, unknown>): Promise<AuthUserRecord | null> {
    const model = await this.model("User", userSchema);
    const { credentialGeneration: _credentialGeneration, ...safeInput } = input;
    void _credentialGeneration;
    const protectedInput = { ...safeInput };
    if (typeof protectedInput.fullName === "string") {
      protectedInput.fullName = protectSensitiveValue(protectedInput.fullName, "user.fullName");
    }
    if (typeof protectedInput.firebaseAuthUid === "string") {
      protectedInput.firebaseAuthUidLookupHash = sensitiveLookupHash(protectedInput.firebaseAuthUid, "user.firebaseAuthUid");
      protectedInput.firebaseAuthUid = protectSensitiveValue(protectedInput.firebaseAuthUid, "user.firebaseAuthUid");
    }
    const document = await model.findByIdAndUpdate(id, { $set: omitUndefined(protectedInput) }, { new: true });
    return document ? toAuthUserRecord(document) : null;
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}

type PersistedAuthUserRecord = AuthUserRecord & {
  emailLookupHash?: string;
  firebaseAuthUidLookupHash?: string;
};

function toAuthUserRecord(document: { id: string; toObject: () => Record<string, unknown> }): AuthUserRecord {
  const { emailLookupHash, firebaseAuthUidLookupHash, ...record } = toDomainRecord<PersistedAuthUserRecord>(document);
  void emailLookupHash;
  void firebaseAuthUidLookupHash;
  return normalizeAuthUserRecord({
    ...record,
    fullName: revealSensitiveValue(record.fullName, "user.fullName"),
    email: revealSensitiveValue(record.email, "user.email"),
    ...(record.firebaseAuthUid ? {
      firebaseAuthUid: revealSensitiveValue(record.firebaseAuthUid, "user.firebaseAuthUid")
    } : {})
  });
}

function toRefreshTokenRecord(document: { id: string; toObject: () => Record<string, unknown> }): RefreshTokenRecord {
  const record = toDomainRecord<RefreshTokenRecord>(document);
  return normalizeRefreshTokenRecord({
    ...record,
    ...(record.ipAddress ? { ipAddress: revealSensitiveValue(record.ipAddress, "refreshToken.ipAddress") } : {}),
    ...(record.userAgent ? { userAgent: revealSensitiveValue(record.userAgent, "refreshToken.userAgent") } : {})
  });
}
