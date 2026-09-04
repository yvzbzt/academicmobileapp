import type { AcademicEventTemporalKind } from "../../../../../packages/shared/src/contracts.js";
import type { AcademicEventCategory, AcademicTerm, DatePrecision } from "../../domain/academic-event.types.js";
import type { StudentRelevanceMetadata } from "../../domain/student-relevance-classifier.js";

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
  /** SHA-256 over the exact uploaded/downloaded bytes. Missing on legacy records. */
  binarySha256?: string;
  /** False for metadata-derived legacy identities; missing on records created before this field existed. */
  binaryIdentityVerified?: boolean;
  /** Complete extracted-event snapshot currently visible for this PDF. Missing on legacy records. */
  activeExtractedEventIds?: string[];
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

export interface ExtractedEventRecord extends Partial<StudentRelevanceMetadata> {
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
  temporalKind?: AcademicEventTemporalKind;
  endTemporalKind?: AcademicEventTemporalKind;
  dateOnlyStart?: string;
  dateOnlyEnd?: string;
  startTime?: string;
  endTime?: string;
  hasExplicitTime?: boolean;
  timezone: "Europe/Istanbul";
  datePrecision: DatePrecision;
  term: AcademicTerm;
  sourcePage: number;
  confidenceScore: number;
  /** Deterministic identity for the semantic event, independent of a processing replay. */
  semanticKey?: string;
  /** Diagnostic position fingerprint within one extraction run; never used as semantic identity. */
  sourceEventKey?: string;
  /** Hash of machine-extracted fields, kept separate from human corrections. */
  extractionFingerprint?: string;
  observedPdfSourceIds?: string[];
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
  /** Exact PDF bytes. When absent, identity remains explicitly legacy/unverified. */
  pdfData?: Buffer;
}

export type PdfSourceUpdate = Partial<Omit<
  PdfSourceRecord,
  "id" | "createdAt" | "updatedAt" | "version" | "activeExtractedEventIds"
>>;

export type PdfSourceGenerationUpdate = Partial<Omit<
  PdfSourceRecord,
  "id" | "createdAt" | "updatedAt" | "version"
>>;

export interface PdfRepository {
  createPdfSource(input: Omit<PdfSourceRecord, "id" | "createdAt" | "updatedAt">): Promise<PdfSourceRecord>;
  findPdfSourceById(id: string): Promise<PdfSourceRecord | null>;
  findPdfSourceByHash(universityId: string, fileHash: string): Promise<PdfSourceRecord | null>;
  updatePdfSource(id: string, input: PdfSourceUpdate): Promise<PdfSourceRecord | null>;
  beginPdfProcessing(id: string): Promise<PdfSourceRecord | null>;
  updatePdfSourceForGeneration(
    id: string,
    generation: number,
    input: PdfSourceGenerationUpdate
  ): Promise<PdfSourceRecord | null>;
  createExtractedEvents(input: Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord[]>;
  listExtractedEvents(input: { universityId?: string; pdfSourceId?: string; status?: ExtractedEventStatus; limit: number; offset: number }): Promise<ExtractedEventRecord[]>;
  findExtractedEventById(id: string): Promise<ExtractedEventRecord | null>;
  updateExtractedEvent(id: string, input: Partial<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord | null>;
}
