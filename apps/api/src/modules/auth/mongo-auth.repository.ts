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

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const model = await this.model("User", userSchema);
    const document = await model.findOne({ email: email.toLocaleLowerCase("tr-TR") });
    return document ? toDomainRecord<AuthUserRecord>(document) : null;
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    const model = await this.model("User", userSchema);
    const document = await model.findById(id);
    return document ? toDomainRecord<AuthUserRecord>(document) : null;
  }

  async markUserEmailVerified(id: string, verifiedAt: Date): Promise<AuthUserRecord | null> {
    return this.updateUser(id, { status: "active", emailVerifiedAt: verifiedAt });
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
