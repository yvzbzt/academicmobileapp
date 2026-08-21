import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ExtractedEventRecord, ExtractedEventStatus, PdfRepository, PdfSourceRecord } from "./pdf.types.js";

@Injectable()
export class InMemoryPdfRepository implements PdfRepository {
  private readonly pdfSources = new Map<string, PdfSourceRecord>();
  private readonly extractedEvents = new Map<string, ExtractedEventRecord>();

  async createPdfSource(input: Omit<PdfSourceRecord, "id" | "createdAt" | "updatedAt">): Promise<PdfSourceRecord> {
    const now = new Date();
    const pdfSource: PdfSourceRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.pdfSources.set(pdfSource.id, pdfSource);
    return pdfSource;
  }

  async findPdfSourceById(id: string): Promise<PdfSourceRecord | null> {
    return this.pdfSources.get(id) ?? null;
  }

  async findPdfSourceByHash(universityId: string, fileHash: string): Promise<PdfSourceRecord | null> {
    return [...this.pdfSources.values()].find((source) => source.universityId === universityId && source.fileHash === fileHash) ?? null;
  }

  async updatePdfSource(id: string, input: Partial<Omit<PdfSourceRecord, "id" | "createdAt" | "updatedAt">>): Promise<PdfSourceRecord | null> {
    const pdfSource = this.pdfSources.get(id);
    if (!pdfSource) return null;
    const updated: PdfSourceRecord = { ...pdfSource, ...input, updatedAt: new Date() };
    this.pdfSources.set(id, updated);
    return updated;
  }

  async createExtractedEvents(input: Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord[]> {
    const now = new Date();
    const records = input.map((event) => ({ ...event, id: randomUUID(), createdAt: now, updatedAt: now }));
    for (const record of records) this.extractedEvents.set(record.id, record);
    return records;
  }

  async listExtractedEvents(input: { universityId?: string; pdfSourceId?: string; status?: ExtractedEventStatus; limit: number; offset: number }): Promise<ExtractedEventRecord[]> {
    return [...this.extractedEvents.values()]
      .filter((event) => (input.universityId ? event.universityId === input.universityId : true))
      .filter((event) => (input.pdfSourceId ? event.pdfSourceId === input.pdfSourceId : true))
      .filter((event) => (input.status ? event.status === input.status : true))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(input.offset, input.offset + input.limit);
  }

  async findExtractedEventById(id: string): Promise<ExtractedEventRecord | null> {
    return this.extractedEvents.get(id) ?? null;
  }

  async updateExtractedEvent(id: string, input: Partial<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord | null> {
    const event = this.extractedEvents.get(id);
    if (!event) return null;
    const updated: ExtractedEventRecord = { ...event, ...input, updatedAt: new Date() };
    if (input.temporalKind === "timestamp") delete updated.dateOnlyStart;
    if (input.endTemporalKind === "timestamp") delete updated.dateOnlyEnd;
    this.extractedEvents.set(id, updated);
    return updated;
  }
}
