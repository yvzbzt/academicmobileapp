import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { mapAcademicEventCategory } from "../../domain/category-mapper.js";
import { calculateConfidenceScore } from "../../domain/confidence-score.js";
import { normalizeAcademicDate } from "../../domain/date-normalizer.js";
import type { AcademicEventCategory } from "../../domain/academic-event.types.js";
import type { CreatePdfSourceInput, ExtractedEventRecord, ExtractedEventStatus, PdfRepository, PdfSourceRecord } from "./pdf.types.js";

const maxPdfFileSizeBytes = 25 * 1024 * 1024;
const maxPdfPageCount = 100;
const pdfMagicBytesHex = "25504446";

@Injectable()
export class PdfProcessingService {
  constructor(@Inject("PdfRepository") private readonly pdfRepository: PdfRepository) {}

  async createPdfSource(input: CreatePdfSourceInput): Promise<PdfSourceRecord> {
    this.validatePdfSource(input);
    const fileHash = this.createFileHash(input);
    const duplicate = await this.pdfRepository.findPdfSourceByHash(input.universityId, fileHash);
    if (duplicate) throw new ConflictException("PDF source already exists for this university.");

    return this.pdfRepository.createPdfSource({
      universityId: input.universityId,
      ...(input.url ? { url: input.url } : {}),
      fileName: input.fileName,
      filePath: `private/pdf-sources/${input.universityId}/${fileHash}.pdf`,
      fileHash,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      magicBytesHex: input.magicBytesHex.toLocaleLowerCase("tr-TR"),
      pageCount: input.pageCount,
      academicYear: input.academicYear,
      version: 1,
      status: "uploaded",
      parseStatus: "pending",
      uploadedBy: input.uploadedBy,
      ...(input.rawText ? { rawText: input.rawText } : {})
    });
  }

  async processPdfSource(pdfSourceId: string): Promise<{ pdfSource: PdfSourceRecord; extractedEvents: ExtractedEventRecord[] }> {
    const source = await this.pdfRepository.findPdfSourceById(pdfSourceId);
    if (!source) throw new NotFoundException("PDF source not found.");

    await this.pdfRepository.updatePdfSource(pdfSourceId, { parseStatus: "processing" });

    if (!source.rawText?.trim()) {
      const updated = await this.pdfRepository.updatePdfSource(pdfSourceId, {
        parseStatus: "ocr_required",
        parseError: "No text layer found. OCR is required."
      });
      return { pdfSource: updated ?? source, extractedEvents: [] };
    }

    const extractedEvents = await this.pdfRepository.createExtractedEvents(this.extractEventsFromText(source));
    const updatedSource = await this.pdfRepository.updatePdfSource(pdfSourceId, {
      parseStatus: "processed",
      processedAt: new Date()
    });

    return { pdfSource: updatedSource ?? source, extractedEvents };
  }

  async getPdfSource(id: string): Promise<PdfSourceRecord> {
    const source = await this.pdfRepository.findPdfSourceById(id);
    if (!source) throw new NotFoundException("PDF source not found.");
    return source;
  }

  async listExtractedEvents(input: { pdfSourceId?: string; status?: ExtractedEventStatus; limit?: number; offset?: number }): Promise<ExtractedEventRecord[]> {
    return this.pdfRepository.listExtractedEvents({
      ...(input.pdfSourceId ? { pdfSourceId: input.pdfSourceId } : {}),
      ...(input.status ? { status: input.status } : {}),
      limit: Math.min(Math.max(input.limit ?? 50, 1), 100),
      offset: Math.max(input.offset ?? 0, 0)
    });
  }

  async getExtractedEvent(id: string): Promise<ExtractedEventRecord> {
    const event = await this.pdfRepository.findExtractedEventById(id);
    if (!event) throw new NotFoundException("Extracted event not found.");
    return event;
  }

  async updateExtractedEvent(
    id: string,
    input: { normalizedTitle?: string; normalizedCategory?: AcademicEventCategory; startDate?: Date; endDate?: Date; adminNote?: string }
  ): Promise<ExtractedEventRecord> {
    const updated = await this.pdfRepository.updateExtractedEvent(id, input);
    if (!updated) throw new NotFoundException("Extracted event not found.");
    return updated;
  }

  async approveExtractedEvent(id: string, reviewedBy: string): Promise<ExtractedEventRecord> {
    const event = await this.pdfRepository.findExtractedEventById(id);
    if (!event) throw new NotFoundException("Extracted event not found.");
    if (!event.startDate) throw new BadRequestException("Extracted event must have a start date before approval.");
    const updated = await this.pdfRepository.updateExtractedEvent(id, {
      status: "approved",
      reviewedBy,
      reviewedAt: new Date()
    });
    if (!updated) throw new NotFoundException("Extracted event not found.");
    return updated;
  }

  async rejectExtractedEvent(id: string, reviewedBy: string, adminNote?: string): Promise<ExtractedEventRecord> {
    const updated = await this.pdfRepository.updateExtractedEvent(id, {
      status: "rejected",
      reviewedBy,
      reviewedAt: new Date(),
      ...(adminNote ? { adminNote } : {})
    });
    if (!updated) throw new NotFoundException("Extracted event not found.");
    return updated;
  }

  private validatePdfSource(input: CreatePdfSourceInput): void {
    if (input.mimeType !== "application/pdf") throw new BadRequestException("Only application/pdf files are accepted.");
    if (!input.magicBytesHex.toLocaleLowerCase("tr-TR").startsWith(pdfMagicBytesHex)) throw new BadRequestException("Invalid PDF magic bytes.");
    if (input.fileSize <= 0 || input.fileSize > maxPdfFileSizeBytes) throw new BadRequestException("PDF file size is outside allowed limits.");
    if (input.pageCount <= 0 || input.pageCount > maxPdfPageCount) throw new BadRequestException("PDF page count is outside allowed limits.");
    if (!/^20\d{2}-20\d{2}$/u.test(input.academicYear)) throw new BadRequestException("Academic year must use YYYY-YYYY format.");
  }

  private createFileHash(input: CreatePdfSourceInput): string {
    return createHash("sha256")
      .update(`${input.universityId}:${input.fileName}:${input.fileSize}:${input.pageCount}:${input.rawText ?? ""}`)
      .digest("hex");
  }

  private extractEventsFromText(source: PdfSourceRecord): Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">> {
    const pages = source.rawText?.split(/\f/u) ?? [];
    return pages.flatMap((pageText, pageIndex) => {
      return pageText
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => /\d{1,2}[./-]\d{1,2}[./-]20\d{2}|\d{1,2}\s*(?:[-–]\s*\d{1,2})?\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+20\d{2}/u.test(line))
        .map((line) => this.createExtractedEventFromLine(source, line, pageIndex + 1));
    });
  }

  private createExtractedEventFromLine(source: PdfSourceRecord, line: string, sourcePage: number): Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt"> {
    const normalizedDate = normalizeAcademicDate(line);
    const category = mapAcademicEventCategory(line);
    const title = this.normalizeTitle(line);
    const score = calculateConfidenceScore({
      dateClarity: normalizedDate.startDate ? 100 : 40,
      titleClarity: title.length > 4 ? 90 : 40,
      categoryClarity: category === "custom_event" ? 55 : 90,
      ocrQuality: 100,
      tableRowQuality: 80,
      academicYearClarity: source.academicYear ? 100 : 30,
      scopeClarity: 80,
      duplicateRisk: 0,
      sourcePageClarity: sourcePage > 0 ? 100 : 0
    });

    return {
      pdfSourceId: source.id,
      universityId: source.universityId,
      academicYear: source.academicYear,
      rawText: line,
      originalDateText: normalizedDate.originalDateText,
      normalizedTitle: title,
      normalizedCategory: category,
      ...(normalizedDate.startDate ? { startDate: new Date(`${normalizedDate.startDate}T00:00:00.000Z`) } : {}),
      ...(normalizedDate.endDate ? { endDate: new Date(`${normalizedDate.endDate}T23:59:59.000Z`) } : {}),
      timezone: "Europe/Istanbul",
      datePrecision: normalizedDate.datePrecision,
      term: normalizedDate.term ?? "unknown",
      sourcePage,
      confidenceScore: score.score,
      status: "pending_review"
    };
  }

  private normalizeTitle(line: string): string {
    return line
      .replace(/\b\d{1,2}[./-]\d{1,2}[./-]20\d{2}\b/gu, "")
      .replace(/\b\d{1,2}\s*(?:[-–]\s*\d{1,2})?\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+20\d{2}\b/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
  }
}
