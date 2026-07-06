import { Inject, Injectable } from "@nestjs/common";
import { emailVerificationTokenSchema, refreshTokenSchema, userSchema } from "../../database/mongoose-schemas.js";
import { getModel, omitUndefined, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import type { AuthRepository, AuthUserRecord, EmailVerificationTokenRecord, RefreshTokenRecord } from "./auth.types.js";

@Injectable()
export class MongoAuthRepository implements AuthRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async createUser(input: Omit<AuthUserRecord, "id" | "createdAt" | "updatedAt">): Promise<AuthUserRecord> {
    const model = await this.model("User", userSchema);
    const document = await model.create({ ...input, email: input.email.toLocaleLowerCase("tr-TR") });
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
    const document = await model.findOne({ email: email.toLocaleLowerCase("tr-TR"), deletedAt: { $exists: false } });
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

  async updateUserProfile(id: string, input: { fullName?: string; classLevel?: number }): Promise<AuthUserRecord | null> {
    return this.updateUser(id, input);
  }

  async updateUserAcademicSelection(id: string, input: { universityId: string; facultyId?: string; departmentId?: string; classLevel?: number }): Promise<AuthUserRecord | null> {
    return this.updateUser(id, input);
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
