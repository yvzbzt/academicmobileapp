import { Inject, Injectable } from "@nestjs/common";
import { isValidObjectId } from "mongoose";
import { academicUnitScheduleSourceSchema } from "../../database/mongoose-schemas.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import { getModel, toDomainRecord } from "../../database/mongoose-utils.js";
import type {
  AcademicUnitScheduleReviewResult,
  AcademicUnitScheduleRevokedPublication,
  AcademicUnitScheduleSourceFilters,
  AcademicUnitScheduleSourceRecord,
  AcademicUnitScheduleSourceRepository,
  NewAcademicUnitScheduleSource
} from "./academic-unit-schedule.types.js";

@Injectable()
export class MongoAcademicUnitScheduleRepository implements AcademicUnitScheduleSourceRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async provisionSource(input: NewAcademicUnitScheduleSource): Promise<{
    record: AcademicUnitScheduleSourceRecord;
    disposition: "created" | "existing" | "refreshed";
  }> {
    const model = await this.model();
    let created = false;
    try {
      const result = await model.updateOne(
        { key: input.key },
        { $setOnInsert: { ...input, lifecycle: "ready", revision: 0 } },
        { upsert: true }
      );
      created = result.upsertedCount === 1;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
    let currentDocument = await model.findOne({ key: input.key });
    if (!currentDocument) throw new Error("SCHEDULE_SOURCE_PROVISION_FAILED");
    let current = toDomainRecord<AcademicUnitScheduleSourceRecord>(currentDocument);
    if (created) return { record: current, disposition: "created" };
    const sameDefinition = current.definitionHash === input.definitionHash;
    if (sameDefinition && current.lifecycle !== "disabled") {
      return { record: current, disposition: "existing" };
    }

    const now = new Date();
    currentDocument = await model.findOneAndUpdate(
      {
        _id: current.id,
        revision: current.revision,
        $or: [
          { lifecycle: { $ne: "processing" } },
          { processingLeaseUntil: { $exists: false } },
          { processingLeaseUntil: { $lte: now } }
        ]
      },
      {
        $set: {
          ...input,
          lifecycle: sameDefinition && current.reviewResult ? "review_required" : "ready"
        },
        $unset: sameDefinition
          ? { processingLeaseUntil: 1, reviewDecision: 1 }
          : { processingLeaseUntil: 1, reviewResult: 1, reviewDecision: 1 },
        $inc: { revision: 1 }
      },
      { new: true }
    );
    if (!currentDocument) throw new Error("SCHEDULE_SOURCE_BUSY_OR_CHANGED");
    current = toDomainRecord<AcademicUnitScheduleSourceRecord>(currentDocument);
    return { record: current, disposition: "refreshed" };
  }

  async disableSourcesExcept(validDefinitions: ReadonlyArray<{ key: string; definitionHash: string }>): Promise<{
    disabled: number;
    revokedPublications: AcademicUnitScheduleRevokedPublication[];
  }> {
    const invalidDefinitionQuery = validDefinitions.length > 0
      ? { $nor: validDefinitions.map(({ key, definitionHash }) => ({ key, definitionHash })) }
      : {};
    const result = await (await this.model()).updateMany(
      { ...invalidDefinitionQuery, lifecycle: { $ne: "disabled" } },
      {
        $set: { lifecycle: "disabled" },
        $unset: { processingLeaseUntil: 1 },
        $inc: { revision: 1 }
      }
    );
    const revokedDocuments = await (await this.model()).find({
      lifecycle: "disabled",
      "reviewDecision.reviewKey": { $exists: true }
    });
    const revokedPublications = revokedDocuments.flatMap((document) => {
      const source = toDomainRecord<AcademicUnitScheduleSourceRecord>(document);
      return source.reviewDecision?.reviewKey
        ? [{ sourceId: source.id, universityId: source.universityId, reviewKey: source.reviewDecision.reviewKey }]
        : [];
    });
    return { disabled: result.modifiedCount, revokedPublications };
  }

  async findSourceById(id: string): Promise<AcademicUnitScheduleSourceRecord | null> {
    if (!isValidObjectId(id)) return null;
    const document = await (await this.model()).findById(id);
    return document ? toDomainRecord<AcademicUnitScheduleSourceRecord>(document) : null;
  }

  async listSources(filters: AcademicUnitScheduleSourceFilters): Promise<AcademicUnitScheduleSourceRecord[]> {
    const documents = await (await this.model())
      .find({
        ...(filters.universityId ? { universityId: filters.universityId } : {}),
        ...(filters.facultyId ? { facultyId: filters.facultyId } : {}),
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
        ...(filters.scheduleType ? { scheduleType: filters.scheduleType } : {}),
        ...(filters.lifecycle ? { lifecycle: filters.lifecycle } : {})
      })
      .sort({ updatedAt: -1, _id: 1 })
      .skip(filters.offset)
      .limit(filters.limit);
    return documents.map((document) => toDomainRecord<AcademicUnitScheduleSourceRecord>(document));
  }

  async claimSource(input: {
    id: string;
    expectedRevision: number;
    definitionHash: string;
    now: Date;
    leaseUntil: Date;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    if (!isValidObjectId(input.id)) return null;
    const document = await (await this.model()).findOneAndUpdate(
      {
        _id: input.id,
        revision: input.expectedRevision,
        definitionHash: input.definitionHash,
        $or: [
          { lifecycle: { $in: ["ready", "review_required", "quarantined", "rejected"] } },
          { lifecycle: "processing", processingLeaseUntil: { $exists: false } },
          { lifecycle: "processing", processingLeaseUntil: { $lte: input.now } }
        ]
      },
      {
        $set: { lifecycle: "processing", processingLeaseUntil: input.leaseUntil },
        $unset: { reviewDecision: 1 },
        $inc: { revision: 1 }
      },
      { new: true }
    );
    return document ? toDomainRecord<AcademicUnitScheduleSourceRecord>(document) : null;
  }

  async completeSource(input: {
    id: string;
    claimRevision: number;
    definitionHash: string;
    result: AcademicUnitScheduleReviewResult;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    if (!isValidObjectId(input.id)) return null;
    const document = await (await this.model()).findOneAndUpdate(
      {
        _id: input.id,
        lifecycle: "processing",
        revision: input.claimRevision,
        definitionHash: input.definitionHash
      },
      {
        $set: {
          lifecycle: input.result.outcome === "definition_drift_review" ? "quarantined" : "review_required",
          reviewResult: input.result
        },
        $unset: { processingLeaseUntil: 1 },
        $inc: { revision: 1 }
      },
      { new: true }
    );
    return document ? toDomainRecord<AcademicUnitScheduleSourceRecord>(document) : null;
  }

  async updateCandidate(input: {
    id: string;
    expectedRevision: number;
    definitionHash: string;
    rowNumber: number;
    candidate: AcademicUnitScheduleReviewResult["candidates"][number];
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    if (!isValidObjectId(input.id)) return null;
    const document = await (await this.model()).findOneAndUpdate(
      {
        _id: input.id,
        lifecycle: "review_required",
        revision: input.expectedRevision,
        definitionHash: input.definitionHash,
        "reviewResult.candidates.rowNumber": input.rowNumber
      },
      {
        $set: { "reviewResult.candidates.$": input.candidate },
        $inc: { revision: 1 }
      },
      { new: true }
    );
    return document ? toDomainRecord<AcademicUnitScheduleSourceRecord>(document) : null;
  }

  async beginReviewDecision(input: {
    id: string;
    expectedRevision: number;
    definitionHash: string;
    decision: NonNullable<AcademicUnitScheduleSourceRecord["reviewDecision"]>;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    if (!isValidObjectId(input.id)) return null;
    const document = await (await this.model()).findOneAndUpdate(
      {
        _id: input.id,
        lifecycle: "review_required",
        revision: input.expectedRevision,
        definitionHash: input.definitionHash
      },
      {
        $set: {
          lifecycle: input.decision.decision === "rejected" ? "rejected" : "materializing",
          reviewDecision: input.decision
        },
        $inc: { revision: 1 }
      },
      { new: true }
    );
    return document ? toDomainRecord<AcademicUnitScheduleSourceRecord>(document) : null;
  }

  async completeMaterialization(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
    calendarId: string;
    eventIds: string[];
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    if (!isValidObjectId(input.id)) return null;
    const document = await (await this.model()).findOneAndUpdate(
      {
        _id: input.id,
        lifecycle: "materializing",
        revision: input.expectedRevision,
        "reviewDecision.reviewKey": input.reviewKey,
        "reviewDecision.materializationStatus": "materializing"
      },
      {
        $set: {
          lifecycle: "staged",
          "reviewDecision.materializationStatus": "staged",
          "reviewDecision.calendarId": input.calendarId,
          "reviewDecision.eventIds": input.eventIds
        },
        $inc: { revision: 1 }
      },
      { new: true }
    );
    return document ? toDomainRecord<AcademicUnitScheduleSourceRecord>(document) : null;
  }

  async claimReviewReopen(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    if (!isValidObjectId(input.id)) return null;
    const document = await (await this.model()).findOneAndUpdate(
      {
        _id: input.id,
        revision: input.expectedRevision,
        lifecycle: { $in: ["materializing", "staged"] },
        "reviewDecision.reviewKey": input.reviewKey,
        "reviewDecision.materializationStatus": { $in: ["materializing", "staged"] }
      },
      {
        $set: { lifecycle: "materializing", "reviewDecision.materializationStatus": "reopening" },
        $unset: { "reviewDecision.publicationLeaseUntil": 1 },
        $inc: { revision: 1 }
      },
      { new: true }
    );
    return document ? toDomainRecord<AcademicUnitScheduleSourceRecord>(document) : null;
  }

  async completeReviewReopen(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    if (!isValidObjectId(input.id)) return null;
    const document = await (await this.model()).findOneAndUpdate(
      {
        _id: input.id,
        revision: input.expectedRevision,
        lifecycle: "materializing",
        "reviewDecision.reviewKey": input.reviewKey,
        "reviewDecision.materializationStatus": "reopening"
      },
      {
        $set: { lifecycle: "review_required" },
        $unset: { reviewDecision: 1 },
        $inc: { revision: 1 }
      },
      { new: true }
    );
    return document ? toDomainRecord<AcademicUnitScheduleSourceRecord>(document) : null;
  }

  async claimPublication(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
    now: Date;
    leaseUntil: Date;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    if (!isValidObjectId(input.id)) return null;
    const document = await (await this.model()).findOneAndUpdate(
      {
        _id: input.id,
        revision: input.expectedRevision,
        "reviewDecision.reviewKey": input.reviewKey,
        $or: [
          { lifecycle: "staged", "reviewDecision.materializationStatus": "staged" },
          {
            lifecycle: "published",
            "reviewDecision.materializationStatus": "publishing",
            $or: [
              { "reviewDecision.publicationLeaseUntil": { $exists: false } },
              { "reviewDecision.publicationLeaseUntil": { $lte: input.now } }
            ]
          }
        ]
      },
      {
        $set: {
          lifecycle: "published",
          "reviewDecision.materializationStatus": "publishing",
          "reviewDecision.publicationLeaseUntil": input.leaseUntil
        },
        $inc: { revision: 1 }
      },
      { new: true }
    );
    return document ? toDomainRecord<AcademicUnitScheduleSourceRecord>(document) : null;
  }

  async completePublication(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
    publishedBy: string;
    publishedAt: Date;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    if (!isValidObjectId(input.id)) return null;
    const document = await (await this.model()).findOneAndUpdate(
      {
        _id: input.id,
        lifecycle: "published",
        revision: input.expectedRevision,
        "reviewDecision.reviewKey": input.reviewKey,
        "reviewDecision.materializationStatus": "publishing"
      },
      {
        $set: {
          lifecycle: "published",
          "reviewDecision.materializationStatus": "published",
          "reviewDecision.publishedBy": input.publishedBy,
          "reviewDecision.publishedAt": input.publishedAt
        },
        $unset: { "reviewDecision.publicationLeaseUntil": 1 },
        $inc: { revision: 1 }
      },
      { new: true }
    );
    return document ? toDomainRecord<AcademicUnitScheduleSourceRecord>(document) : null;
  }

  async releasePublication(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    if (!isValidObjectId(input.id)) return null;
    const document = await (await this.model()).findOneAndUpdate(
      {
        _id: input.id,
        lifecycle: "published",
        revision: input.expectedRevision,
        "reviewDecision.reviewKey": input.reviewKey,
        "reviewDecision.materializationStatus": "publishing"
      },
      {
        $set: { lifecycle: "staged", "reviewDecision.materializationStatus": "staged" },
        $unset: { "reviewDecision.publicationLeaseUntil": 1 },
        $inc: { revision: 1 }
      },
      { new: true }
    );
    return document ? toDomainRecord<AcademicUnitScheduleSourceRecord>(document) : null;
  }

  private async model() {
    const connection = this.mongo.getConnection() ?? await this.mongo.connect();
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, "AcademicUnitScheduleSource", academicUnitScheduleSourceSchema);
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 11000);
}
