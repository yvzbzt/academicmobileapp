import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { academicUnitSuggestionSchema, followedAcademicScopeSchema } from "../../database/mongoose-schemas.js";
import { getModel, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import { protectSensitiveValue, revealSensitiveValue, sensitiveLookupHash } from "../../security/data-protection.js";
import {
  followedAcademicScopeKey,
  type AcademicUnitSuggestionRecord,
  type AcademicUnitSuggestionStatus,
  type FollowedAcademicScopeRecord,
  type UserDataRepository
} from "./user-data.types.js";

type PersistedFollowedAcademicScopeRecord = FollowedAcademicScopeRecord & {
  normalizedScopeKey: string;
};

@Injectable()
export class MongoUserDataRepository implements UserDataRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async createAcademicUnitSuggestion(
    input: Omit<AcademicUnitSuggestionRecord, "id" | "status" | "createdAt" | "reviewedAt">
  ): Promise<AcademicUnitSuggestionRecord> {
    const document = await (await this.model("AcademicUnitSuggestion", academicUnitSuggestionSchema)).create({
      _id: randomUUID(),
      ...input,
      userEmail: protectSensitiveValue(input.userEmail.toLowerCase(), "academicSuggestion.userEmail"),
      userEmailLookupHash: sensitiveLookupHash(input.userEmail.toLowerCase(), "academicSuggestion.userEmail"),
      facultyName: protectSensitiveValue(input.facultyName, "academicSuggestion.facultyName"),
      ...(input.departmentName ? {
        departmentName: protectSensitiveValue(input.departmentName, "academicSuggestion.departmentName")
      } : {}),
      status: "pending"
    });
    return toAcademicUnitSuggestionRecord(document);
  }

  async findAcademicUnitSuggestionById(id: string): Promise<AcademicUnitSuggestionRecord | null> {
    const document = await (await this.model("AcademicUnitSuggestion", academicUnitSuggestionSchema)).findById(id);
    return document ? toAcademicUnitSuggestionRecord(document) : null;
  }

  async listAcademicUnitSuggestions(status: AcademicUnitSuggestionStatus): Promise<AcademicUnitSuggestionRecord[]> {
    const documents = await (await this.model("AcademicUnitSuggestion", academicUnitSuggestionSchema))
      .find({ status })
      .sort({ createdAt: -1 });
    return documents.map(toAcademicUnitSuggestionRecord);
  }

  async updateAcademicUnitSuggestionReview(
    id: string,
    input: { status: "approved" | "rejected"; reviewedAt: Date }
  ): Promise<AcademicUnitSuggestionRecord | null> {
    const document = await (await this.model("AcademicUnitSuggestion", academicUnitSuggestionSchema)).findByIdAndUpdate(
      id,
      { $set: input },
      { returnDocument: "after" }
    );
    return document ? toAcademicUnitSuggestionRecord(document) : null;
  }

  async upsertFollowedAcademicScope(
    input: Omit<FollowedAcademicScopeRecord, "id" | "createdAt">
  ): Promise<FollowedAcademicScopeRecord> {
    const normalizedScopeKey = followedAcademicScopeKey(input);
    const model = await this.model("FollowedAcademicScope", followedAcademicScopeSchema);
    try {
      const document = await model.findOneAndUpdate(
        { userId: input.userId, normalizedScopeKey },
        {
          $setOnInsert: {
            _id: randomUUID(),
            ...input,
            normalizedScopeKey
          }
        },
        { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
      );
      if (!document) throw new Error("FOLLOWED_ACADEMIC_SCOPE_UPSERT_FAILED");
      return toFollowedAcademicScopeRecord(document);
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = await model.findOne({ userId: input.userId, normalizedScopeKey });
      if (!existing) throw error;
      return toFollowedAcademicScopeRecord(existing);
    }
  }

  async listFollowedAcademicScopesByUserId(userId: string): Promise<FollowedAcademicScopeRecord[]> {
    const documents = await (await this.model("FollowedAcademicScope", followedAcademicScopeSchema))
      .find({ userId })
      .sort({ createdAt: 1 });
    return documents.map((document) => toFollowedAcademicScopeRecord(document));
  }

  async deleteFollowedAcademicScopeById(userId: string, id: string): Promise<boolean> {
    const result = await (await this.model("FollowedAcademicScope", followedAcademicScopeSchema))
      .deleteOne({ _id: id, userId });
    return result.deletedCount > 0;
  }

  async deleteUserData(userId: string): Promise<void> {
    await (await this.model("AcademicUnitSuggestion", academicUnitSuggestionSchema)).deleteMany({ userId });
    await (await this.model("FollowedAcademicScope", followedAcademicScopeSchema)).deleteMany({ userId });
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}

type PersistedAcademicUnitSuggestionRecord = AcademicUnitSuggestionRecord & {
  userEmailLookupHash?: string;
};

function toAcademicUnitSuggestionRecord(
  document: { id: string; toObject: () => Record<string, unknown> }
): AcademicUnitSuggestionRecord {
  const { userEmailLookupHash, ...record } = toDomainRecord<PersistedAcademicUnitSuggestionRecord>(document);
  void userEmailLookupHash;
  return {
    ...record,
    userEmail: revealSensitiveValue(record.userEmail, "academicSuggestion.userEmail"),
    facultyName: revealSensitiveValue(record.facultyName, "academicSuggestion.facultyName"),
    ...(record.departmentName ? {
      departmentName: revealSensitiveValue(record.departmentName, "academicSuggestion.departmentName")
    } : {})
  };
}

function toFollowedAcademicScopeRecord(document: { id: string; toObject: () => Record<string, unknown> }): FollowedAcademicScopeRecord {
  const { normalizedScopeKey, ...record } = toDomainRecord<PersistedFollowedAcademicScopeRecord>(document);
  void normalizedScopeKey;
  return record;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
