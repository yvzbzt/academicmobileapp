import { Inject, Injectable } from "@nestjs/common";
import type { CollectionReference, DocumentData } from "firebase-admin/firestore";
import { FirestoreDatabaseService } from "../../database/firestore.service.js";
import { cleanFirestoreData, getAllFirestoreRecords, newFirestoreId, toFirestoreRecord } from "../../database/firestore-utils.js";
import type { ExtractedEventRecord, ExtractedEventStatus, PdfRepository, PdfSourceRecord } from "./pdf.types.js";

@Injectable()
export class FirestorePdfRepository implements PdfRepository {
  constructor(@Inject(FirestoreDatabaseService) private readonly firestore: FirestoreDatabaseService) {}

  async createPdfSource(input: Omit<PdfSourceRecord, "id" | "createdAt" | "updatedAt">): Promise<PdfSourceRecord> {
    const now = new Date();
    const pdfSource: PdfSourceRecord = { ...input, id: newFirestoreId(), createdAt: now, updatedAt: now };
    await this.pdfSources.doc(pdfSource.id).set(cleanFirestoreData(pdfSource as unknown as Record<string, unknown>));
    return pdfSource;
  }

  async findPdfSourceById(id: string): Promise<PdfSourceRecord | null> {
    return toFirestoreRecord<PdfSourceRecord>(await this.pdfSources.doc(id).get());
  }

  async findPdfSourceByHash(universityId: string, fileHash: string): Promise<PdfSourceRecord | null> {
    return (await getAllFirestoreRecords<PdfSourceRecord>(this.pdfSources.where("universityId", "==", universityId))).find((source) => source.fileHash === fileHash) ?? null;
  }

  async updatePdfSource(id: string, input: Partial<Omit<PdfSourceRecord, "id" | "createdAt" | "updatedAt">>): Promise<PdfSourceRecord | null> {
    const pdfSource = await this.findPdfSourceById(id);
    if (!pdfSource) return null;
    const updated: PdfSourceRecord = { ...pdfSource, ...input, updatedAt: new Date() };
    await this.pdfSources.doc(id).set(cleanFirestoreData(updated as unknown as Record<string, unknown>), { merge: false });
    return updated;
  }

  async createExtractedEvents(input: Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord[]> {
    const now = new Date();
    const records = input.map((event) => ({ ...event, id: newFirestoreId(), createdAt: now, updatedAt: now }));
    const batch = this.firestore.getDb().batch();
    for (const record of records) batch.set(this.extractedEvents.doc(record.id), cleanFirestoreData(record as unknown as Record<string, unknown>));
    await batch.commit();
    return records;
  }

  async listExtractedEvents(input: { pdfSourceId?: string; status?: ExtractedEventStatus; limit: number; offset: number }): Promise<ExtractedEventRecord[]> {
    const records = input.pdfSourceId
      ? await getAllFirestoreRecords<ExtractedEventRecord>(this.extractedEvents.where("pdfSourceId", "==", input.pdfSourceId))
      : await getAllFirestoreRecords<ExtractedEventRecord>(this.extractedEvents);
    return records
      .filter((event) => (input.status ? event.status === input.status : true))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(input.offset, input.offset + input.limit);
  }

  async findExtractedEventById(id: string): Promise<ExtractedEventRecord | null> {
    return toFirestoreRecord<ExtractedEventRecord>(await this.extractedEvents.doc(id).get());
  }

  async updateExtractedEvent(id: string, input: Partial<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord | null> {
    const event = await this.findExtractedEventById(id);
    if (!event) return null;
    const updated: ExtractedEventRecord = { ...event, ...input, updatedAt: new Date() };
    await this.extractedEvents.doc(id).set(cleanFirestoreData(updated as unknown as Record<string, unknown>), { merge: false });
    return updated;
  }

  private get pdfSources(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("pdf_sources");
  }

  private get extractedEvents(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("extracted_events");
  }
}
