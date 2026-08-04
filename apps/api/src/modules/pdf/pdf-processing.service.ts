import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { mapAcademicEventCategory } from "../../domain/category-mapper.js";
import { calculateConfidenceScore } from "../../domain/confidence-score.js";
import { normalizeAcademicDate } from "../../domain/date-normalizer.js";
import type { AcademicEventCategory } from "../../domain/academic-event.types.js";
import { academicTemporalFields, compatibilityDateForCalendarDay, istanbulTimestamp } from "../calendars/calendar-temporal.js";
import type { CreatePdfSourceInput, ExtractedEventRecord, ExtractedEventStatus, PdfRepository, PdfSourceRecord } from "./pdf.types.js";
import { PdfOcrService } from "./pdf-ocr.service.js";

const maxPdfFileSizeBytes = 25 * 1024 * 1024;
const maxPdfPageCount = 100;
const pdfMagicBytesHex = "25504446";
const dateBearingLinePattern = /\d{1,2}[./-]\d{1,2}[./-]20\d{2}|\d{1,2}\s*(?:[-\u2013\u2014]\s*\d{1,2})?\s+\p{L}+\s+20\d{2}/u;
const numericDatePattern = /\b\d{1,2}[./-]\d{1,2}[./-]20\d{2}\b/gu;
const textualDatePattern = /\b\d{1,2}\s*(?:[-\u2013\u2014]\s*\d{1,2})?\s+\p{L}+\s+20\d{2}\b/gu;
const timePattern = /\b(?:saat\s*)?(?:[01]?\d|2[0-3])[:.][0-5]\d\b/giu;
const timeOnlyCellPattern = /^(?:saat\s*)?(?:[01]?\d|2[0-3])[:.][0-5]\d(?:\s*[-\u2013\u2014]\s*(?:saat\s*)?(?:[01]?\d|2[0-3])[:.][0-5]\d)?$/iu;
const eventTitleMaxLength = 240;

interface PdfEventLineCandidate {
  text: string;
  sourcePage: number;
}

@Injectable()
export class PdfProcessingService {
  private readonly logger = new Logger(PdfProcessingService.name);

  constructor(
    @Inject("PdfRepository") private readonly pdfRepository: PdfRepository,
    @Inject(PdfOcrService) private readonly ocrService: Pick<PdfOcrService, "extractText">
  ) {}

  async createPdfSource(input: CreatePdfSourceInput): Promise<PdfSourceRecord> {
    this.validatePdfSource(input);
    const fileHash = this.createFileHash(input);
    const duplicate = await this.pdfRepository.findPdfSourceByHash(input.universityId, fileHash);
    if (duplicate) throw new ConflictException("PDF source already exists for this university.");

    return this.createPdfSourceWithHash(input, fileHash);
  }

  async createOrReusePdfSource(input: CreatePdfSourceInput): Promise<PdfSourceRecord> {
    this.validatePdfSource(input);
    const fileHash = this.createFileHash(input);
    const duplicate = await this.pdfRepository.findPdfSourceByHash(input.universityId, fileHash);
    if (duplicate) return duplicate;
    return this.createPdfSourceWithHash(input, fileHash);
  }

  private createPdfSourceWithHash(input: CreatePdfSourceInput, fileHash: string): Promise<PdfSourceRecord> {
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

  async processPdfSource(pdfSourceId: string, input: { pdfData?: Buffer } = {}): Promise<{ pdfSource: PdfSourceRecord; extractedEvents: ExtractedEventRecord[] }> {
    const source = await this.pdfRepository.findPdfSourceById(pdfSourceId);
    if (!source) throw new NotFoundException("PDF source not found.");

    await this.pdfRepository.updatePdfSource(pdfSourceId, { parseStatus: "processing" });

    let processableSource = source;
    if (!hasUsefulPdfTextLayer(processableSource.rawText)) {
      const ocr = await this.ocrService.extractText({ pdfSource: source, ...(input.pdfData ? { pdfData: input.pdfData } : {}) });
      if (ocr?.text && hasUsefulPdfTextLayer(ocr.text)) {
        processableSource = await this.pdfRepository.updatePdfSource(pdfSourceId, {
          rawText: ocr.text,
          ocrProvider: ocr.provider,
          ocrProcessedAt: new Date()
        }) ?? source;
      }
    }

    if (!hasUsefulPdfTextLayer(processableSource.rawText)) {
      const updated = await this.pdfRepository.updatePdfSource(pdfSourceId, {
        parseStatus: "ocr_required",
        parseError: "No text layer found. OCR is required."
      });
      return { pdfSource: updated ?? source, extractedEvents: [] };
    }

    let eventInputs = this.extractEventsFromText(processableSource);

    if (!processableSource.ocrProcessedAt && (eventInputs.length === 0 || shouldAttemptDocumentAiTableExtraction())) {
      this.logger.log(`Attempting OCR/layout extraction for PDF source ${pdfSourceId}; current candidate count=${eventInputs.length}.`);
      const ocr = await this.ocrService.extractText({ pdfSource: source, ...(input.pdfData ? { pdfData: input.pdfData } : {}) });
      if (ocr?.text && hasUsefulPdfTextLayer(ocr.text)) {
        const ocrSource = { ...processableSource, rawText: ocr.text };
        const ocrEventInputs = this.extractEventsFromText(ocrSource);
        if (isBetterExtraction(ocrEventInputs, eventInputs)) {
          processableSource = await this.pdfRepository.updatePdfSource(pdfSourceId, {
            rawText: ocr.text,
            ocrProvider: ocr.provider,
            ocrProcessedAt: new Date()
          }) ?? processableSource;
          eventInputs = ocrEventInputs;
        }
      }
    }

    const extractedEvents = await this.pdfRepository.createExtractedEvents(eventInputs);
    const updatedSource = await this.pdfRepository.updatePdfSource(pdfSourceId, {
      parseStatus: "processed",
      processedAt: new Date()
    });

    return { pdfSource: updatedSource ?? processableSource, extractedEvents };
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
    input: { normalizedTitle?: string; normalizedCategory?: AcademicEventCategory; startDate?: string; endDate?: string; adminNote?: string }
  ): Promise<ExtractedEventRecord> {
    const current = await this.pdfRepository.findExtractedEventById(id);
    if (!current) throw new NotFoundException("Extracted event not found.");
    const currentStart = current.temporalKind === "date" && current.dateOnlyStart
      ? current.dateOnlyStart
      : current.startDate?.toISOString();
    const currentEnd = current.endTemporalKind === "date" && current.dateOnlyEnd
      ? current.dateOnlyEnd
      : current.endDate?.toISOString();
    const requestedStart = input.startDate ?? currentStart;
    const requestedEnd = input.endDate ?? currentEnd;
    const temporal = requestedStart && (input.startDate || input.endDate)
      ? academicTemporalFields(requestedStart, requestedEnd)
      : {};
    const updated = await this.pdfRepository.updateExtractedEvent(id, {
      ...(input.normalizedTitle ? { normalizedTitle: input.normalizedTitle } : {}),
      ...(input.normalizedCategory ? { normalizedCategory: input.normalizedCategory } : {}),
      ...temporal,
      ...(input.adminNote ? { adminNote: input.adminNote } : {})
    });
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
    const extracted = pages.flatMap((pageText, pageIndex) =>
      buildPdfEventLineCandidates(pageText, pageIndex + 1)
        .map((candidate) => this.createExtractedEventFromLine(source, candidate.text, candidate.sourcePage))
        .filter((event) => isMeaningfulExtractedEvent(event))
    );
    return deduplicateExtractedEvents(extracted);
  }

  private createExtractedEventFromLine(source: PdfSourceRecord, line: string, sourcePage: number): Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt"> {
    const repaired = repairOcrDateTimeText(stripNavigationChrome(line));
    const normalizedDate = normalizeAcademicDate(repaired.text);
    const title = this.normalizeTitle(repaired.text);
    const category = mapAcademicEventCategory(`${title} ${repaired.text}`);
    const fallbackDate = !normalizedDate.startDate && shouldUseDocumentDateFallback(title, repaired.text)
      ? inferDocumentPublicationIsoDate(source)
      : undefined;
    const startDate = normalizedDate.startDate ?? fallbackDate;
    const endDate = normalizedDate.endDate ?? fallbackDate;
    const originalDateText = normalizedDate.startDate
      ? normalizedDate.originalDateText
      : fallbackDate
        ? `Document publication date fallback: ${fallbackDate}`
        : normalizedDate.originalDateText;
    const score = calculateConfidenceScore({
      dateClarity: normalizedDate.startDate ? 100 : fallbackDate ? 55 : 20,
      titleClarity: title.length > 4 ? 90 : 40,
      categoryClarity: category === "custom_event" ? 55 : 90,
      ocrQuality: repaired.repaired ? 82 : 100,
      tableRowQuality: 80,
      academicYearClarity: source.academicYear ? 100 : 30,
      scopeClarity: 80,
      duplicateRisk: 0,
      sourcePageClarity: sourcePage > 0 ? 100 : 0
    });
    const includeEnd = Boolean(endDate && (endDate !== startDate || normalizedDate.endTime));

    return {
      pdfSourceId: source.id,
      universityId: source.universityId,
      academicYear: source.academicYear,
      rawText: repaired.text,
      originalDateText,
      normalizedTitle: title,
      normalizedCategory: category,
      ...(startDate ? {
        temporalKind: normalizedDate.startTime ? "timestamp" as const : "date" as const,
        ...(normalizedDate.startTime ? {} : { dateOnlyStart: startDate }),
        startDate: normalizedDate.startTime
          ? istanbulTimestamp(startDate, normalizedDate.startTime)
          : compatibilityDateForCalendarDay(startDate)
      } : {}),
      ...(includeEnd && endDate ? {
        endTemporalKind: normalizedDate.endTime ? "timestamp" as const : "date" as const,
        ...(normalizedDate.endTime ? {} : { dateOnlyEnd: endDate }),
        endDate: normalizedDate.endTime
          ? istanbulTimestamp(endDate, normalizedDate.endTime)
          : compatibilityDateForCalendarDay(endDate, true)
      } : {}),
      ...(normalizedDate.startTime ? { startTime: normalizedDate.startTime } : {}),
      ...(normalizedDate.endTime ? { endTime: normalizedDate.endTime } : {}),
      ...(normalizedDate.hasExplicitTime ? { hasExplicitTime: true } : {}),
      timezone: "Europe/Istanbul",
      datePrecision: fallbackDate ? "day" : normalizedDate.datePrecision,
      term: normalizedDate.term ?? "unknown",
      sourcePage,
      confidenceScore: score.score,
      status: "pending_review"
    };
  }

  private normalizeTitle(line: string): string {
    const title = stripNavigationChrome(line)
      .replace(numericDatePattern, "")
      .replace(textualDatePattern, "")
      .replace(timePattern, "")
      .replace(/^\s*[-\u2013\u2014]+\s*/u, "")
      .replace(/\s*[-\u2013\u2014]+\s*$/u, "")
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/(?<=\p{L})1(?=\p{L})/gu, "i")
      .replace(/(?<=\p{L})0(?=\p{L})/gu, "o");
    return stripNavigationChrome(title);
  }
}

function isMeaningfulExtractedEvent(event: Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">): boolean {
  const title = event.normalizedTitle.trim();
  if (!event.startDate || event.datePrecision === "unknown") return false;
  if (isDocumentChromeOrNote(event.rawText) || isDocumentChromeOrNote(title)) return false;
  if (title.length < 3) return false;
  if (/^[\d\s./\-"()\u2013\u2014]+$/u.test(title)) return false;
  if (isLowValueContentLine(title)) return false;
  if (isGenericTitleFragment(title)) return false;
  return true;
}

function hasUsefulPdfTextLayer(rawText?: string): boolean {
  const lines = (rawText ?? "")
    .split(/\r?\n/u)
    .map(cleanPdfLine)
    .filter((line) => line.length > 0 && !/^--\s*\d+\s+of\s+\d+\s*--$/iu.test(line) && !isLowValueContentLine(line));
  const usefulText = lines.join(" ").replace(/[^\p{L}\d]+/gu, "");
  return usefulText.length >= 20;
}

function buildPdfEventLineCandidates(pageText: string, sourcePage: number): PdfEventLineCandidate[] {
  const candidates: PdfEventLineCandidate[] = [];
  let pendingTitle = "";
  let tableHeader: string[] | undefined;
  const rawLines = pageText
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);

  for (const rawLine of rawLines) {
    const tableCells = splitTableCells(rawLine);
    if (tableCells.length >= 2 && tableCells.every((cell) => !cell || isTableHeaderCell(cell))) {
      tableHeader = tableCells;
      pendingTitle = "";
      continue;
    }

    const structuredCandidate = buildStructuredPdfRowCandidate(rawLine, sourcePage, tableHeader);
    if (structuredCandidate) {
      candidates.push(structuredCandidate);
      pendingTitle = "";
      continue;
    }

    const line = repairOcrDateTimeText(cleanPdfLine(rawLine)).text;
    if (line.length === 0 || isLowValueContentLine(line)) continue;
    if (isDocumentChromeOrNote(line)) {
      pendingTitle = "";
      continue;
    }
    const hasDate = dateBearingLinePattern.test(line);
    if (!hasDate) {
      if (isGenericTitleFragment(line)) {
        pendingTitle = "";
        continue;
      }
      pendingTitle = pendingTitle ? trimCandidateText(`${pendingTitle} ${line}`) : line;
      continue;
    }

    const titleWithoutDates = removeDateText(line);
    if (isDateOnlyLine(line) || isGenericTitleFragment(titleWithoutDates)) {
      if (pendingTitle && !isGenericTitleFragment(pendingTitle)) candidates.push({ text: trimCandidateText(`${pendingTitle} ${line}`), sourcePage });
      pendingTitle = "";
      continue;
    }

    const combinedLine = pendingTitle && isShortContinuationTitle(titleWithoutDates)
      ? trimCandidateText(`${pendingTitle} ${line}`)
      : line;
    candidates.push({ text: combinedLine, sourcePage });
    pendingTitle = "";
  }

  return candidates;
}

function buildStructuredPdfRowCandidate(rawLine: string, sourcePage: number, headerCells?: string[]): PdfEventLineCandidate | null {
  if (!rawLine.includes("\t")) return null;
  const cells = splitTableCells(rawLine);
  const nonEmptyCells = cells.filter((cell) => cell.length > 0 && !isLowValueContentLine(cell));
  if (nonEmptyCells.length < 2 || nonEmptyCells.every(isTableHeaderCell)) return null;

  if (headerCells?.length) {
    const mapped = buildHeaderMappedStructuredRowCandidate(cells, headerCells, sourcePage);
    if (mapped) return mapped;
  }

  const dateCells: string[] = [];
  const timeCells: string[] = [];
  const titleFragments: string[] = [];

  for (const cell of nonEmptyCells) {
    const hasDate = dateBearingLinePattern.test(cell);
    const isTimeOnly = timeOnlyCellPattern.test(cell);
    if (hasDate) {
      dateCells.push(cell);
      const residualTitle = removeDateAndTimeText(cell);
      if (residualTitle && !isGenericTitleFragment(residualTitle) && !isTableHeaderCell(residualTitle)) titleFragments.push(residualTitle);
      continue;
    }
    if (isTimeOnly) {
      timeCells.push(cell);
      continue;
    }
    if (!isTableHeaderCell(cell) && !isGenericTitleFragment(cell)) titleFragments.push(cell);
  }

  const title = uniqueText(titleFragments).join(" ");
  const dateText = buildStructuredDateText(dateCells, timeCells.length > 0 ? timeCells : extractTimeTextsFromCell(rawLine));
  if (!title || !dateText) return null;
  return { text: trimCandidateText(`${title} ${dateText}`), sourcePage };
}

function splitTableCells(rawLine: string): string[] {
  if (!rawLine.includes("\t")) return [];
  return rawLine.split(/\t/u).map((cell) => repairOcrDateTimeText(cleanPdfLine(cell)).text);
}

function buildHeaderMappedStructuredRowCandidate(cells: string[], headerCells: string[], sourcePage: number): PdfEventLineCandidate | null {
  const headers = headerCells.map(foldEventText);
  const titleIndex = firstHeaderIndex(headers, ["aciklama", "description", "event", "etkinlik", "faaliyet"]);
  const startDateIndex = firstHeaderIndex(headers, ["baslama tarihi", "baslangic tarihi", "start date"]);
  const endDateIndex = firstHeaderIndex(headers, ["bitis tarihi", "end date"]);
  const timeIndex = firstHeaderIndex(headers, ["saat", "time", "event start time", "start time"]);
  const title = cleanPdfLine(cells[titleIndex] ?? "");
  const startDate = cleanPdfLine(cells[startDateIndex] ?? "");
  const endDate = endDateIndex >= 0 ? cleanPdfLine(cells[endDateIndex] ?? "") : "";
  const time = timeIndex >= 0 ? cleanPdfLine(cells[timeIndex] ?? "") : "";
  if (!title || !startDate || isGenericTitleFragment(title)) return null;

  const startDateText = appendTimeIfMissing(startDate, extractTimeTextsFromCell(time)[0]);
  const endDateText = endDate ? appendTimeIfMissing(endDate, extractTimeTextsFromCell(time)[1]) : "";
  const dateText = endDateText ? `${startDateText} - ${endDateText}` : startDateText;
  return { text: trimCandidateText(`${title} ${dateText}`), sourcePage };
}

function firstHeaderIndex(headers: string[], candidates: string[]): number {
  const exact = headers.findIndex((header) => candidates.includes(header));
  if (exact >= 0) return exact;
  return headers.findIndex((header) => candidates.some((candidate) => header.includes(candidate)));
}

function buildStructuredDateText(dateCells: string[], timeCells: string[]): string {
  const dateParts = uniqueText(dateCells.flatMap(extractDateTextsFromCell));
  const times = uniqueText(timeCells.flatMap(extractTimeTextsFromCell));
  if (dateParts.length === 0) return "";

  if (dateParts.length >= 2) {
    const start = appendTimeIfMissing(dateParts[0]!, times[0]);
    const end = appendTimeIfMissing(dateParts[1]!, times[1]);
    return `${start} - ${end}`.trim();
  }

  const onlyDate = dateParts[0]!;
  if (times.length >= 2) return `${appendTimeIfMissing(onlyDate, times[0])} - ${times[1]}`;
  return appendTimeIfMissing(onlyDate, times[0]);
}

function extractDateTextsFromCell(cell: string): string[] {
  const numericMatches = [...cell.matchAll(/\b\d{1,2}[./-]\d{1,2}[./-]20\d{2}(?:\s*(?:saat\s*)?(?:[01]?\d|2[0-3])[:.][0-5]\d)?\b/giu)].map((match) => cleanPdfLine(match[0]));
  const textualMatches = [...cell.matchAll(/\b\d{1,2}\s*(?:[-\u2013\u2014]\s*\d{1,2})?\s+\p{L}+\s+20\d{2}(?:\s*(?:saat\s*)?(?:[01]?\d|2[0-3])[:.][0-5]\d)?\b/giu)].map((match) => cleanPdfLine(match[0]));
  const matches = uniqueText([...numericMatches, ...textualMatches]);
  return matches.length > 0 ? matches : [cell];
}

function extractTimeTextsFromCell(cell: string): string[] {
  return [...cell.matchAll(/\b(?:saat\s*)?(?:[01]?\d|2[0-3])[:.][0-5]\d\b/giu)]
    .filter((match) => isStandaloneTimeMatch(cell, match))
    .map((match) => match[0].replace(/^saat\s*/iu, "").replace(".", ":"));
}

function appendTimeIfMissing(dateText: string, timeText?: string): string {
  if (!timeText || hasTimeText(dateText)) return dateText;
  return `${dateText} ${timeText}`;
}

function hasTimeText(value: string): boolean {
  return extractTimeTextsFromCell(value).length > 0;
}

function isStandaloneTimeMatch(source: string, match: RegExpMatchArray): boolean {
  const value = match[0];
  if (value.includes(":") || /^saat/iu.test(value)) return true;
  const start = match.index ?? 0;
  const end = start + value.length;
  const after = source[end] ?? "";
  return !/[./]/u.test(after);
}

function cleanPdfLine(line: string): string {
  return stripNavigationChrome(line
    .replace(/\u00a0/gu, " ")
    .replace(/[|]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim());
}

function removeDateText(line: string): string {
  return line
    .replace(numericDatePattern, "")
    .replace(textualDatePattern, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function removeDateAndTimeText(line: string): string {
  return removeDateText(line)
    .replace(timePattern, "")
    .replace(/^\s*[-\u2013\u2014]+\s*/u, "")
    .replace(/\s*[-\u2013\u2014]+\s*$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function isDateOnlyLine(line: string): boolean {
  if (!dateBearingLinePattern.test(line)) return false;
  return removeDateText(line).replace(/[^\p{L}\d]+/gu, "").trim().length === 0;
}

function isShortContinuationTitle(title: string): boolean {
  const folded = foldEventText(title);
  if (folded.length <= 28) return true;
  return /^(son gunu|baslangici|bitisi|ilan edilmesi|duyurulmasi)\b/u.test(folded);
}

function isGenericTitleFragment(value: string): boolean {
  const folded = foldEventText(value);
  if (!folded) return true;
  if (/^(pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar)$/u.test(folded)) return true;
  if (/^(gunu|son gunu|tarihi|tarih|baslangici|bitisi|basi|sonu)$/u.test(folded)) return true;
  if (/^(ilan|duyuru|duyurulmasi|ilan edilmesi|ilan edilmesinin|sonuc|sonuclar)\b.*\b(?:gunu|son gunu)$/u.test(folded)) return true;
  return folded.replace(/[^\p{L}\d]+/gu, "").length < 3;
}

function isTableHeaderCell(value: string): boolean {
  const folded = foldEventText(value);
  return [
    "aciklama",
    "baslama tarihi",
    "baslangic tarihi",
    "bitis tarihi",
    "date",
    "description",
    "end date",
    "etkinlik",
    "event start time",
    "event",
    "faaliyet",
    "gun",
    "saat",
    "start date",
    "start time",
    "tarih",
    "time"
  ].includes(folded);
}

function isLowValueContentLine(value: string): boolean {
  const folded = foldEventText(value);
  if (!folded) return true;
  if (/^(?:page|sayfa)\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/u.test(folded)) return true;
  if (/^\d+\s*\/\s*\d+$/u.test(folded)) return true;
  return [
    "back",
    "devami",
    "devamini oku",
    "daha fazla",
    "daha fazla goster",
    "geri",
    "ileri",
    "load more",
    "menu",
    "more",
    "next",
    "onceki",
    "pagination",
    "previous",
    "read more",
    "show more",
    "sonraki",
    "tum duyurular",
    "tumu"
  ].includes(folded);
}

function isDocumentChromeOrNote(value: string): boolean {
  const folded = foldEventText(value);
  if (!folded) return true;
  if (/^(not|note|aciklama|uyari)\b/u.test(folded)) return true;
  if (/^(agri|ağrı)?\s*(ibrahim|i?brahim)?\s*(cecen|cecen)?\s*universitesi\b/u.test(folded) && folded.includes("akademik takvim")) return true;
  if (/\bakademik takvim(?:i)?\b/u.test(folded) && folded.replace(/\b20\d{2}\b/gu, "").replace(/[^\p{L}\d]+/gu, " ").trim().split(" ").length <= 6) return true;
  if (/^(guz|bahar|yaz)\s+donemi\s*$/u.test(folded)) return true;
  return false;
}

function shouldUseDocumentDateFallback(title: string, rawText: string): boolean {
  if (isDocumentChromeOrNote(title) || isDocumentChromeOrNote(rawText)) return false;
  const folded = foldEventText(`${title} ${rawText}`);
  if (!folded || folded.length < 12) return false;
  return [
    "basvuru",
    "bitis",
    "ders",
    "duyuru",
    "kayit",
    "program",
    "sinav",
    "takvim",
    "tercih",
    "odeme",
    "mezuniyet",
    "orientation",
    "exam",
    "registration",
    "schedule"
  ].some((keyword) => folded.includes(keyword));
}

function inferDocumentPublicationIsoDate(source: PdfSourceRecord): string | undefined {
  const fromText = dateFromSourceMetadata(`${source.fileName} ${source.url ?? ""}`);
  if (fromText) return fromText;
  const metadataDate = source.downloadedAt ?? source.createdAt;
  return metadataDate.toISOString().slice(0, 10);
}

function dateFromSourceMetadata(value: string): string | undefined {
  const numeric = value.match(/\b(\d{1,2})[._-](\d{1,2})[._-](20\d{2})\b/u);
  if (numeric?.[1] && numeric[2] && numeric[3]) return toIsoDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  const isoLike = value.match(/\b(20\d{2})[._-](\d{1,2})[._-](\d{1,2})\b/u);
  if (isoLike?.[1] && isoLike[2] && isoLike[3]) return toIsoDate(Number(isoLike[1]), Number(isoLike[2]), Number(isoLike[3]));
  return undefined;
}

function toIsoDate(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function stripNavigationChrome(value: string): string {
  let result = value.trim();
  for (let index = 0; index < 4; index += 1) {
    const stripped = result
      .replace(/^(?:read\s*more|show\s*more|load\s*more|next|previous|back|more|devamini\s*oku|devami|daha\s*fazla(?:\s*goster)?|ileri|geri|sonraki|onceki|tum\s*duyurular|tumu)\s*(?:[:\-|>\u00bb\u2013\u2014]\s*)?/iu, "")
      .replace(/(?:\s*[:\-|<\u00ab\u2013\u2014])?\s*(?:read\s*more|show\s*more|load\s*more|next|previous|back|more|devamini\s*oku|devami|daha\s*fazla(?:\s*goster)?|ileri|geri|sonraki|onceki|tum\s*duyurular|tumu)$/iu, "")
      .trim();
    if (stripped === result) break;
    result = stripped;
  }
  return result;
}

function repairOcrDateTimeText(value: string): { text: string; repaired: boolean } {
  let repaired = false;
  const text = value.replace(/\b[0-9oOlI|SB]{1,2}[./:-][0-9oOlI|SB]{1,2}(?:[./:-][0-9oOlI|SB]{2,4})?\b/gu, (token) => {
    const next = token.replace(/[oO]/gu, "0").replace(/[lI|]/gu, "1").replace(/S/gu, "5").replace(/B/gu, "8");
    repaired ||= next !== token;
    return next;
  });
  return { text, repaired };
}

function trimCandidateText(value: string): string {
  const trimmed = cleanPdfLine(value);
  return trimmed.length > eventTitleMaxLength ? trimmed.slice(0, eventTitleMaxLength).trim() : trimmed;
}

function uniqueText(values: string[]): string[] {
  return [...new Set(values.map(cleanPdfLine).filter(Boolean))];
}

function deduplicateExtractedEvents(events: Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">> {
  const selected: Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">> = [];

  for (const event of events) {
    const duplicateIndex = selected.findIndex((existing) => hasSameEventSlot(existing, event) && areDuplicateTitles(existing.normalizedTitle, event.normalizedTitle));
    if (duplicateIndex < 0) {
      selected.push(event);
      continue;
    }

    const existing = selected[duplicateIndex];
    if (existing && foldEventText(event.normalizedTitle).length > foldEventText(existing.normalizedTitle).length) selected[duplicateIndex] = event;
  }

  return selected;
}

function shouldAttemptDocumentAiTableExtraction(): boolean {
  return process.env.PDF_TABLE_LAYOUT_AUTO_ENABLED === "true" || process.env.DOCUMENT_AI_PREFER_TABLES === "true";
}

function isBetterExtraction(
  candidate: Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>,
  current: Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>
): boolean {
  if (candidate.length === 0) return false;
  if (current.length === 0) return true;
  if (candidate.length > current.length) return true;
  if (candidate.length < current.length) return false;
  return averageConfidence(candidate) > averageConfidence(current) + 4;
}

function averageConfidence(events: Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): number {
  if (events.length === 0) return 0;
  return events.reduce((total, event) => total + event.confidenceScore, 0) / events.length;
}

function hasSameEventSlot(left: Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">, right: Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">): boolean {
  return left.normalizedCategory === right.normalizedCategory
    && dateKey(left.startDate) === dateKey(right.startDate)
    && dateKey(left.endDate) === dateKey(right.endDate);
}

function areDuplicateTitles(left: string, right: string): boolean {
  const leftTitle = foldEventText(left);
  const rightTitle = foldEventText(right);
  return leftTitle === rightTitle || leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle);
}

function dateKey(value?: Date): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

function foldEventText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/gu, "i")
    .replace(/\u0130/gu, "I")
    .replace(/\u011f/gu, "g")
    .replace(/\u011e/gu, "G")
    .replace(/\u00fc/gu, "u")
    .replace(/\u00dc/gu, "U")
    .replace(/\u015f/gu, "s")
    .replace(/\u015e/gu, "S")
    .replace(/\u00f6/gu, "o")
    .replace(/\u00d6/gu, "O")
    .replace(/\u00e7/gu, "c")
    .replace(/\u00c7/gu, "C")
    .replace(/\u2019/gu, "'")
    .replace(/[^\p{L}\d]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}
