import { Inject, Injectable } from "@nestjs/common";
import { extractedEventSchema, pdfSourceSchema } from "../../database/mongoose-schemas.js";
import { getModel, omitUndefined, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import type { ExtractedEventRecord, ExtractedEventStatus, PdfRepository, PdfSourceRecord } from "./pdf.types.js";

@Injectable()
export class MongoPdfRepository implements PdfRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async createPdfSource(input: Omit<PdfSourceRecord, "id" | "createdAt" | "updatedAt">): Promise<PdfSourceRecord> {
    const document = await (await this.model("PdfSource", pdfSourceSchema)).create(input);
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

  async updatePdfSource(id: string, input: Partial<Omit<PdfSourceRecord, "id" | "createdAt" | "updatedAt">>): Promise<PdfSourceRecord | null> {
    const document = await (await this.model("PdfSource", pdfSourceSchema)).findByIdAndUpdate(id, omitUndefined(input), { new: true });
    return document ? toDomainRecord<PdfSourceRecord>(document) : null;
  }

  async createExtractedEvents(input: Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord[]> {
    const documents = await (await this.model("ExtractedEvent", extractedEventSchema)).insertMany(input);
    return documents.map((document) => toDomainRecord<ExtractedEventRecord>(document));
  }

  async listExtractedEvents(input: { pdfSourceId?: string; status?: ExtractedEventStatus; limit: number; offset: number }): Promise<ExtractedEventRecord[]> {
    const documents = await (await this.model("ExtractedEvent", extractedEventSchema)).find(omitUndefined({ pdfSourceId: input.pdfSourceId, status: input.status })).sort({ createdAt: -1 }).skip(input.offset).limit(input.limit);
    return documents.map((document) => toDomainRecord<ExtractedEventRecord>(document));
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
