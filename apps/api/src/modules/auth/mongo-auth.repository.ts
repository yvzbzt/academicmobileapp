import { Inject, Injectable } from "@nestjs/common";
import { emailVerificationTokenSchema, passwordRecoveryTokenSchema, refreshTokenSchema, userSchema } from "../../database/mongoose-schemas.js";
import { getModel, omitUndefined, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import type { AuthRepository, AuthUserRecord, EmailVerificationTokenRecord, PasswordRecoveryTokenRecord, RefreshTokenRecord } from "./auth.types.js";

@Injectable()
export class MongoAuthRepository implements AuthRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async createUser(input: Omit<AuthUserRecord, "id" | "createdAt" | "updatedAt">): Promise<AuthUserRecord> {
    const model = await this.model("User", userSchema);
    const document = await model.create({ ...input, email: input.email.toLowerCase() });
    return toDomainRecord<AuthUserRecord>(document);
  }

  async listUsers(input: { search?: string; status?: AuthUserRecord["status"]; limit: number; offset: number }): Promise<AuthUserRecord[]> {
    const model = await this.model("User", userSchema);
    const query: Record<string, unknown> = { deletedAt: { $exists: false } };
    if (input.status) query.status = input.status;
    if (input.search?.trim()) {
      const escapedSearch = input.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [{ fullName: { $regex: escapedSearch, $options: "i" } }, { email: { $regex: escapedSearch, $options: "i" } }];
    }

    const documents = await model.find(query).sort({ createdAt: -1 }).skip(input.offset).limit(input.limit);
    return documents.map((document) => toDomainRecord<AuthUserRecord>(document));
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const model = await this.model("User", userSchema);
    const document = await model.findOne({ email: email.toLowerCase(), deletedAt: { $exists: false } });
    return document ? toDomainRecord<AuthUserRecord>(document) : null;
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    const model = await this.model("User", userSchema);
    const document = await model.findOne({ _id: id, deletedAt: { $exists: false } });
    return document ? toDomainRecord<AuthUserRecord>(document) : null;
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
    return document ? toDomainRecord<AuthUserRecord>(document) : null;
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
          fullName: input.anonymizedFullName,
          email: input.anonymizedEmail.toLowerCase(),
          passwordHash: input.anonymizedPasswordHash,
          status: "inactive",
          deletedAt: input.deletedAt
        },
        $unset: {
          emailVerifiedAt: "",
          firebaseAuthUid: "",
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
    return document ? toDomainRecord<AuthUserRecord>(document) : null;
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

  async createRefreshToken(input: Omit<RefreshTokenRecord, "id" | "createdAt">): Promise<RefreshTokenRecord> {
    const model = await this.model("RefreshToken", refreshTokenSchema);
    const document = await model.create(input);
    return toDomainRecord<RefreshTokenRecord>(document);
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const model = await this.model("RefreshToken", refreshTokenSchema);
    const document = await model.findOne({ tokenHash });
    return document ? toDomainRecord<RefreshTokenRecord>(document) : null;
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

  async createPasswordRecoveryToken(input: Omit<PasswordRecoveryTokenRecord, "id" | "createdAt">): Promise<PasswordRecoveryTokenRecord> {
    const model = await this.model("PasswordRecoveryToken", passwordRecoveryTokenSchema);
    const document = await model.create(input);
    return toDomainRecord<PasswordRecoveryTokenRecord>(document);
  }

  async findPasswordRecoveryTokenByHash(tokenHash: string): Promise<PasswordRecoveryTokenRecord | null> {
    const model = await this.model("PasswordRecoveryToken", passwordRecoveryTokenSchema);
    const document = await model.findOne({ tokenHash });
    return document ? toDomainRecord<PasswordRecoveryTokenRecord>(document) : null;
  }

  async findLatestPasswordRecoveryTokenByUserId(userId: string): Promise<PasswordRecoveryTokenRecord | null> {
    const model = await this.model("PasswordRecoveryToken", passwordRecoveryTokenSchema);
    const document = await model.findOne({ userId }).sort({ createdAt: -1 });
    return document ? toDomainRecord<PasswordRecoveryTokenRecord>(document) : null;
  }

  async invalidatePasswordRecoveryTokensByUserId(userId: string, invalidatedAt: Date): Promise<void> {
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
    const model = await this.model("PasswordRecoveryToken", passwordRecoveryTokenSchema);
    await model.deleteMany({ userId });
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
    const document = await model.findByIdAndUpdate(id, omitUndefined(input), { new: true });
    return document ? toDomainRecord<AuthUserRecord>(document) : null;
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}
