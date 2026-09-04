import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { extractedEventSchema, pdfSourceSchema } from "../../database/mongoose-schemas.js";
import { getModel, omitUndefined, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import type { ExtractedEventRecord, ExtractedEventStatus, PdfRepository, PdfSourceGenerationUpdate, PdfSourceRecord, PdfSourceUpdate } from "./pdf.types.js";

@Injectable()
export class MongoPdfRepository implements PdfRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async createPdfSource(input: Omit<PdfSourceRecord, "id" | "createdAt" | "updatedAt">): Promise<PdfSourceRecord> {
    const document = await (await this.model("PdfSource", pdfSourceSchema)).create({
      ...input,
      // The repository owns snapshot activation; callers cannot make rows
      // visible by smuggling a pointer into source creation.
      activeExtractedEventIds: []
    });
    return toDomainRecord<PdfSourceRecord>(document);
  }

  async findPdfSourceById(id: string): Promise<PdfSourceRecord | null> {
    const document = await (await this.model("PdfSource", pdfSourceSchema)).findById(id);
    return document ? toDomainRecord<PdfSourceRecord>(document) : null;
  }

  async findPdfSourceByHash(universityId: string, fileHash: string): Promise<PdfSourceRecord | null> {
    const document = await (await this.model("PdfSource", pdfSourceSchema)).findOne({ universityId, fileHash });
    return document ? toDomainRecord<PdfSourceRecord>(document) : null;
  }

  async updatePdfSource(id: string, input: PdfSourceUpdate): Promise<PdfSourceRecord | null> {
    const unsafeInput = input as Partial<PdfSourceRecord>;
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, version: _version, activeExtractedEventIds: _pointer, ...safeInput } = unsafeInput;
    void _id; void _createdAt; void _updatedAt; void _version; void _pointer;
    const document = await (await this.model("PdfSource", pdfSourceSchema)).findByIdAndUpdate(id, {
      $set: omitUndefined(safeInput),
      ...(input.parseStatus === "processed" ? { $unset: { parseError: 1 } } : {})
    }, { new: true });
    return document ? toDomainRecord<PdfSourceRecord>(document) : null;
  }

  async beginPdfProcessing(id: string): Promise<PdfSourceRecord | null> {
    const document = await (await this.model("PdfSource", pdfSourceSchema)).findByIdAndUpdate(id, {
      $inc: { version: 1 },
      $set: { parseStatus: "processing" },
      $unset: { parseError: 1 }
    }, { new: true });
    return document ? toDomainRecord<PdfSourceRecord>(document) : null;
  }

  async updatePdfSourceForGeneration(
    id: string,
    generation: number,
    input: PdfSourceGenerationUpdate
  ): Promise<PdfSourceRecord | null> {
    const unsafeInput = input as Partial<PdfSourceRecord>;
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, version: _version, ...safeInput } = unsafeInput;
    void _id; void _createdAt; void _updatedAt; void _version;
    const document = await (await this.model("PdfSource", pdfSourceSchema)).findOneAndUpdate({
      _id: id,
      version: generation
    }, {
      $set: omitUndefined(safeInput),
      ...(input.parseStatus === "processed" ? { $unset: { parseError: 1 } } : {})
    }, { new: true });
    return document ? toDomainRecord<PdfSourceRecord>(document) : null;
  }

  async createExtractedEvents(input: Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord[]> {
    const model = await this.model("ExtractedEvent", extractedEventSchema);
    const records: ExtractedEventRecord[] = [];

    for (const event of input) {
      if (!event.semanticKey || !event.sourceEventKey || !event.extractionFingerprint) {
        const legacyDocument = await model.create(event);
        records.push(toDomainRecord<ExtractedEventRecord>(legacyDocument));
        continue;
      }
      const semanticKey = event.semanticKey;
      const extractionFingerprint = event.extractionFingerprint;

      const persist = async (canRetryDuplicate: boolean): Promise<ExtractedEventRecord> => {
        const observedPdfSourceIds = event.observedPdfSourceIds ?? [event.pdfSourceId];
        const unchanged = await model.findOneAndUpdate(
          { semanticKey, extractionFingerprint },
          { $addToSet: { observedPdfSourceIds: { $each: observedPdfSourceIds } } },
          { new: true }
        );
        if (unchanged) return toDomainRecord<ExtractedEventRecord>(unchanged);

        const { observedPdfSourceIds: _observedPdfSourceIds, ...insertFields } = event;
        void _observedPdfSourceIds;
        const deterministicId = createHash("sha256")
          .update(`pdf-event-revision:v1\0${semanticKey}\0${extractionFingerprint}`)
          .digest("hex")
          .slice(0, 24);
        const insertUpdate = {
          $setOnInsert: omitUndefined({ ...insertFields, status: "pending_review" }),
          $addToSet: { observedPdfSourceIds: { $each: observedPdfSourceIds } }
        };

        try {
          const inserted = await model.findOneAndUpdate(
            {
              _id: deterministicId,
              $or: [
                { semanticKey, extractionFingerprint },
                { semanticKey: { $exists: false } }
              ]
            },
            insertUpdate,
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          return toDomainRecord<ExtractedEventRecord>(inserted);
        } catch (error) {
          if (canRetryDuplicate && isMongoDuplicateKeyError(error)) return persist(false);
          if (isMongoDuplicateKeyError(error)) {
            const occupied = await model.findById(deterministicId);
            const occupiedRecord = occupied ? toDomainRecord<ExtractedEventRecord>(occupied) : null;
            if (
              occupiedRecord
              && (occupiedRecord.semanticKey !== semanticKey || occupiedRecord.extractionFingerprint !== extractionFingerprint)
            ) {
              const inserted = await model.create({
                ...omitUndefined(insertFields as unknown as Record<string, unknown>),
                _id: new Types.ObjectId(),
                status: "pending_review",
                observedPdfSourceIds
              });
              return toDomainRecord<ExtractedEventRecord>(inserted);
            }
          }
          throw error;
        }
      };

      records.push(await persist(true));
    }

    return records;
  }

  async listExtractedEvents(input: { universityId?: string; pdfSourceId?: string; status?: ExtractedEventStatus; limit: number; offset: number }): Promise<ExtractedEventRecord[]> {
    let visibilityFilter: Record<string, unknown>;
    if (input.pdfSourceId) {
      const source = await this.findPdfSourceById(input.pdfSourceId);
      if (!source) return [];
      if (source.activeExtractedEventIds !== undefined) {
        if (source.activeExtractedEventIds.length === 0) return [];
        visibilityFilter = { _id: { $in: source.activeExtractedEventIds } };
      } else {
        // Legacy records predate snapshot pointers and retain their previous
        // relationship-based visibility until explicitly reprocessed.
        visibilityFilter = {
          $or: [
            { pdfSourceId: input.pdfSourceId },
            { observedPdfSourceIds: input.pdfSourceId }
          ]
        };
      }
    } else {
      visibilityFilter = await this.aggregateVisibilityFilter(input.universityId);
      if (Object.keys(visibilityFilter).length === 0) return [];
    }
    const documents = await (await this.model("ExtractedEvent", extractedEventSchema)).find({
      ...omitUndefined({ universityId: input.universityId, status: input.status }),
      ...visibilityFilter
    }).sort({ createdAt: -1, _id: -1 }).skip(input.offset).limit(input.limit);
    return documents.map((document) => toDomainRecord<ExtractedEventRecord>(document));
  }

  private async aggregateVisibilityFilter(universityId: string | undefined): Promise<Record<string, unknown>> {
    const sourceDocuments = await (await this.model("PdfSource", pdfSourceSchema)).find(
      omitUndefined({ universityId })
    );
    const sources = sourceDocuments.map((document) => toDomainRecord<PdfSourceRecord>(document));
    const activeIds = [...new Set(sources.flatMap((source) => source.activeExtractedEventIds ?? []))];
    const legacySourceIds = sources
      .filter((source) => source.activeExtractedEventIds === undefined)
      .map((source) => source.id);
    const branches: Record<string, unknown>[] = [];
    if (activeIds.length > 0) branches.push({ _id: { $in: activeIds } });
    if (legacySourceIds.length > 0) {
      branches.push(
        { pdfSourceId: { $in: legacySourceIds } },
        { observedPdfSourceIds: { $in: legacySourceIds } }
      );
    }
    if (branches.length === 0) return {};
    return branches.length === 1 ? branches[0]! : { $or: branches };
  }

  async findExtractedEventById(id: string): Promise<ExtractedEventRecord | null> {
    const document = await (await this.model("ExtractedEvent", extractedEventSchema)).findById(id);
    return document ? toDomainRecord<ExtractedEventRecord>(document) : null;
  }

  async updateExtractedEvent(id: string, input: Partial<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord | null> {
    const unset: Record<string, 1> = {};
    if (input.temporalKind === "timestamp") unset.dateOnlyStart = 1;
    if (input.endTemporalKind === "timestamp") unset.dateOnlyEnd = 1;
    const document = await (await this.model("ExtractedEvent", extractedEventSchema)).findByIdAndUpdate(id, {
      $set: omitUndefined(input),
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {})
    }, { new: true });
    return document ? toDomainRecord<ExtractedEventRecord>(document) : null;
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}

function isMongoDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === 11000;
}
