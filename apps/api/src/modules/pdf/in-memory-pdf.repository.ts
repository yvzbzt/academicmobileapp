import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ExtractedEventRecord, ExtractedEventStatus, PdfRepository, PdfSourceGenerationUpdate, PdfSourceRecord, PdfSourceUpdate } from "./pdf.types.js";

@Injectable()
export class InMemoryPdfRepository implements PdfRepository {
  private readonly pdfSources = new Map<string, PdfSourceRecord>();
  private readonly extractedEvents = new Map<string, ExtractedEventRecord>();

  async createPdfSource(input: Omit<PdfSourceRecord, "id" | "createdAt" | "updatedAt">): Promise<PdfSourceRecord> {
    if ([...this.pdfSources.values()].some((source) => (
      source.universityId === input.universityId && source.fileHash === input.fileHash
    ))) throw new Error("PDF_SOURCE_DUPLICATE_HASH");
    const now = new Date();
    const pdfSource: PdfSourceRecord = {
      ...input,
      activeExtractedEventIds: [],
      id: randomUUID(),
      createdAt: now,
      updatedAt: now
    };
    this.pdfSources.set(pdfSource.id, pdfSource);
    return pdfSource;
  }

  async findPdfSourceById(id: string): Promise<PdfSourceRecord | null> {
    return this.pdfSources.get(id) ?? null;
  }

  async findPdfSourceByHash(universityId: string, fileHash: string): Promise<PdfSourceRecord | null> {
    return [...this.pdfSources.values()].find((source) => source.universityId === universityId && source.fileHash === fileHash) ?? null;
  }

  async updatePdfSource(id: string, input: PdfSourceUpdate): Promise<PdfSourceRecord | null> {
    const pdfSource = this.pdfSources.get(id);
    if (!pdfSource) return null;
    const unsafeInput = input as Partial<PdfSourceRecord>;
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, version: _version, activeExtractedEventIds: _pointer, ...safeInput } = unsafeInput;
    void _id; void _createdAt; void _updatedAt; void _version; void _pointer;
    const updated: PdfSourceRecord = { ...pdfSource, ...safeInput, updatedAt: new Date() };
    if (input.parseStatus === "processed") delete updated.parseError;
    this.pdfSources.set(id, updated);
    return updated;
  }

  async beginPdfProcessing(id: string): Promise<PdfSourceRecord | null> {
    const pdfSource = this.pdfSources.get(id);
    if (!pdfSource) return null;
    const updated: PdfSourceRecord = {
      ...pdfSource,
      version: pdfSource.version + 1,
      parseStatus: "processing",
      updatedAt: new Date()
    };
    delete updated.parseError;
    this.pdfSources.set(id, updated);
    return updated;
  }

  async updatePdfSourceForGeneration(
    id: string,
    generation: number,
    input: PdfSourceGenerationUpdate
  ): Promise<PdfSourceRecord | null> {
    const pdfSource = this.pdfSources.get(id);
    if (!pdfSource || pdfSource.version !== generation) return null;
    const unsafeInput = input as Partial<PdfSourceRecord>;
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, version: _version, ...safeInput } = unsafeInput;
    void _id; void _createdAt; void _updatedAt; void _version;
    const updated: PdfSourceRecord = { ...pdfSource, ...safeInput, updatedAt: new Date() };
    if (input.parseStatus === "processed") delete updated.parseError;
    this.pdfSources.set(id, updated);
    return updated;
  }

  async createExtractedEvents(input: Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord[]> {
    const records: ExtractedEventRecord[] = [];
    for (const event of input) {
      const now = new Date();
      const existing = event.semanticKey && event.extractionFingerprint
        ? [...this.extractedEvents.values()].find((candidate) => (
            candidate.semanticKey === event.semanticKey
            && candidate.extractionFingerprint === event.extractionFingerprint
          ))
        : undefined;

      if (existing) {
        const observedPdfSourceIds = [...new Set([
          ...(existing.observedPdfSourceIds ?? [existing.pdfSourceId]),
          ...(event.observedPdfSourceIds ?? [event.pdfSourceId])
        ])];
        const unchanged = { ...existing, observedPdfSourceIds, updatedAt: now };
        this.extractedEvents.set(unchanged.id, unchanged);
        records.push(unchanged);
        continue;
      }

      const created: ExtractedEventRecord = { ...event, id: randomUUID(), createdAt: now, updatedAt: now };
      this.extractedEvents.set(created.id, created);
      records.push(created);
    }
    return records;
  }

  async listExtractedEvents(input: { universityId?: string; pdfSourceId?: string; status?: ExtractedEventStatus; limit: number; offset: number }): Promise<ExtractedEventRecord[]> {
    const requestedSource = input.pdfSourceId ? this.pdfSources.get(input.pdfSourceId) : undefined;
    if (input.pdfSourceId && !requestedSource) return [];
    const scopedSources = input.pdfSourceId
      ? requestedSource ? [requestedSource] : []
      : [...this.pdfSources.values()].filter((source) =>
          !input.universityId || source.universityId === input.universityId);
    const activeIdSet = new Set(scopedSources.flatMap((source) => source.activeExtractedEventIds ?? []));
    const legacySourceIds = new Set(scopedSources
      .filter((source) => source.activeExtractedEventIds === undefined)
      .map((source) => source.id));
    return [...this.extractedEvents.values()]
      .filter((event) => (input.universityId ? event.universityId === input.universityId : true))
      .filter((event) => activeIdSet.has(event.id) || eventBelongsToLegacySource(event, legacySourceIds))
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

function eventBelongsToLegacySource(
  event: ExtractedEventRecord,
  legacySourceIds: ReadonlySet<string>
): boolean {
  return legacySourceIds.has(event.pdfSourceId)
    || Boolean(event.observedPdfSourceIds?.some((sourceId) => legacySourceIds.has(sourceId)));
}
