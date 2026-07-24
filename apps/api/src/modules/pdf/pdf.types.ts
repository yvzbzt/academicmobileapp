import type { AcademicEventCategory, AcademicTerm, DatePrecision } from "../../domain/academic-event.types.js";

export type PdfSourceStatus = "uploaded" | "duplicate" | "rejected" | "archived";
export type PdfParseStatus = "pending" | "processing" | "processed" | "failed" | "ocr_required";
export type ExtractedEventStatus = "pending_review" | "approved" | "rejected";

export interface PdfSourceRecord {
  id: string;
  universityId: string;
  url?: string;
  fileName: string;
  filePath: string;
  fileHash: string;
  fileSize: number;
  mimeType: string;
  magicBytesHex: string;
  pageCount: number;
  academicYear: string;
  version: number;
  status: PdfSourceStatus;
  parseStatus: PdfParseStatus;
  parseError?: string;
  uploadedBy: string;
  rawText?: string;
  ocrProvider?: string;
  ocrProcessedAt?: Date;
  downloadedAt?: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtractedEventRecord {
  id: string;
  pdfSourceId: string;
  universityId: string;
  academicYear: string;
  rawText: string;
  originalDateText: string;
  normalizedTitle: string;
  normalizedCategory: AcademicEventCategory;
  startDate?: Date;
  endDate?: Date;
  startTime?: string;
  endTime?: string;
  hasExplicitTime?: boolean;
  timezone: "Europe/Istanbul";
  datePrecision: DatePrecision;
  term: AcademicTerm;
  sourcePage: number;
  confidenceScore: number;
  status: ExtractedEventStatus;
  adminNote?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePdfSourceInput {
  universityId: string;
  fileName: string;
  mimeType: string;
  magicBytesHex: string;
  fileSize: number;
  pageCount: number;
  academicYear: string;
  uploadedBy: string;
  rawText?: string;
  url?: string;
}

export interface PdfRepository {
  createPdfSource(input: Omit<PdfSourceRecord, "id" | "createdAt" | "updatedAt">): Promise<PdfSourceRecord>;
  findPdfSourceById(id: string): Promise<PdfSourceRecord | null>;
  findPdfSourceByHash(universityId: string, fileHash: string): Promise<PdfSourceRecord | null>;
  updatePdfSource(id: string, input: Partial<Omit<PdfSourceRecord, "id" | "createdAt" | "updatedAt">>): Promise<PdfSourceRecord | null>;
  createExtractedEvents(input: Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord[]>;
  listExtractedEvents(input: { pdfSourceId?: string; status?: ExtractedEventStatus; limit: number; offset: number }): Promise<ExtractedEventRecord[]>;
  findExtractedEventById(id: string): Promise<ExtractedEventRecord | null>;
  updateExtractedEvent(id: string, input: Partial<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord | null>;
}
