import { digest, CryptoDigestAlgorithm } from "expo-crypto";
import { fetch as expoFetch, type FetchRequestInit } from "expo/fetch";
import { File, Paths } from "expo-file-system";
import { extractText, getPageCount, isAvailable } from "expo-pdf-text-extract";
import type { AcademicPdfProcessingMode, DeviceAcademicPdfSource, EventRecord } from "../app/app-types";
import { canonicalizeOfficialAcademicUrl, normalizeDisplayText, officialDomainForUrl } from "../content/content-trust";
import {
  mergeServerAndDeviceAcademicEvents,
  parseDeviceAcademicPdfText,
  type DeviceAcademicPdfEventContext,
} from "./academic-document-parser";

const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_CAPABILITY_LIFETIME_MS = 30 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;
const MAX_PDF_PAGES = 100;
const MAX_EXTRACTED_TEXT_LENGTH = 2_000_000;
const DEFAULT_NETWORK_TIMEOUT_MS = 20_000;
const DEFAULT_EXTRACTION_TIMEOUT_MS = 20_000;
const MAX_REDIRECT_HOPS = 5;

export type DeviceAcademicPdfErrorCode =
  | "capability_invalid"
  | "source_http"
  | "source_redirect"
  | "source_mime"
  | "source_size"
  | "source_magic"
  | "source_hash"
  | "native_unavailable"
  | "page_limit"
  | "text_layer_missing"
  | "timeout";

export class DeviceAcademicPdfError extends Error {
  constructor(readonly code: DeviceAcademicPdfErrorCode) {
    super(code);
    this.name = "DeviceAcademicPdfError";
  }
}

interface PdfFetchResponse {
  ok: boolean;
  status: number;
  url: string;
  headers: Pick<Headers, "get">;
  body: ReadableStream<Uint8Array> | null;
}

interface NativePdfTextExtractor {
  isAvailable(): boolean;
  getPageCount(fileUri: string): Promise<number>;
  extractText(fileUri: string): Promise<string>;
}

interface ApprovedRowDescriptor {
  rowNumber: number;
  normalizedTitle: string;
  date?: string;
  dayOfWeek?: number;
  startTime: string;
  endTime?: string;
}

interface ApprovedEventDescriptor {
  normalizedTitle: string;
  category: string;
  startDate: string;
  endDate?: string;
  temporalKind: "date" | "timestamp";
  endTemporalKind?: "date" | "timestamp";
}

export interface DeviceAcademicPdfDependencies {
  now?: () => number;
  fetchPdf?: (url: string, init: FetchRequestInit) => Promise<PdfFetchResponse>;
  sha256?: (bytes: Uint8Array) => Promise<string>;
  extractTextLayer?: (bytes: Uint8Array, source: DeviceAcademicPdfSource) => Promise<string>;
  networkTimeoutMs?: number;
}

export interface HydrateDeviceAcademicPdfInput {
  processingMode: AcademicPdfProcessingMode | undefined;
  source: unknown;
  serverEvents: readonly EventRecord[];
  context: DeviceAcademicPdfEventContext;
}

/**
 * A device PDF failure must never remove already-published server events. OCR is
 * deliberately absent here: a textless PDF remains on the server_ocr path.
 */
export async function hydrateDeviceAcademicPdfEvents(
  input: HydrateDeviceAcademicPdfInput,
  dependencies: DeviceAcademicPdfDependencies = {},
): Promise<EventRecord[]> {
  const serverEvents = [...input.serverEvents];
  try {
    if (input.processingMode !== "device_text") return serverEvents;
    const source = validateDeviceAcademicPdfSource(input.source, dependencies.now?.() ?? Date.now());
    if (!source || !contextMatchesDocument(input.context, source)) return serverEvents;
    const text = await loadVerifiedDeviceAcademicPdfText(source, dependencies);
    const deviceEvents = parseDeviceAcademicPdfText(text, source, input.context);
    if (deviceEvents.length === 0) return serverEvents;
    return mergeServerAndDeviceAcademicEvents(serverEvents, deviceEvents, true);
  } catch {
    return serverEvents;
  }
}

export async function loadVerifiedDeviceAcademicPdfText(
  sourceInput: unknown,
  dependencies: DeviceAcademicPdfDependencies = {},
): Promise<string> {
  const now = dependencies.now ?? Date.now;
  const source = validateDeviceAcademicPdfSource(sourceInput, now());
  if (!source) throw new DeviceAcademicPdfError("capability_invalid");

  const abortController = new AbortController();
  const networkTimeoutMs = boundedTimeout(dependencies.networkTimeoutMs, DEFAULT_NETWORK_TIMEOUT_MS);
  const timer = setTimeout(() => abortController.abort(), networkTimeoutMs);
  let response: PdfFetchResponse;
  try {
    const fetchPdf = dependencies.fetchPdf ?? defaultFetchPdf;
    response = await fetchFollowingVerifiedRedirects(fetchPdf, source, abortController.signal);
    if (!response.ok) throw new DeviceAcademicPdfError("source_http");
    assertFinalOfficialUrl(response.url, source);
    assertPdfMime(response.headers.get("content-type"));
    assertDeclaredSize(response.headers.get("content-length"));
    const bytes = await readExactBoundedBody(response.body, source.expectedByteLength);
    if (!hasPdfMagic(bytes)) throw new DeviceAcademicPdfError("source_magic");
    const actualSha256 = await (dependencies.sha256 ?? sha256Hex)(bytes);
    if (actualSha256 !== source.expectedSha256) throw new DeviceAcademicPdfError("source_hash");
    if (!validateDeviceAcademicPdfSource(source, now())) throw new DeviceAcademicPdfError("capability_invalid");
    const text = await (dependencies.extractTextLayer ?? extractNativeTextLayer)(bytes, source);
    return requireUsableTextLayer(text);
  } catch (error) {
    if (abortController.signal.aborted && !(error instanceof DeviceAcademicPdfError)) {
      throw new DeviceAcademicPdfError("timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function validateDeviceAcademicPdfSource(
  input: unknown,
  nowMs = Date.now(),
): DeviceAcademicPdfSource | null {
  if (!isRecord(input) || input.mode !== "device_text") return null;
  const sourceUrl = typeof input.sourceUrl === "string"
    ? canonicalizeOfficialAcademicUrl(input.sourceUrl)
    : null;
  if (!sourceUrl || sourceUrl !== input.sourceUrl || new URL(sourceUrl).protocol !== "https:") return null;

  const officialDomain = officialDomainForUrl(sourceUrl);
  if (
    !officialDomain
    || typeof input.allowedOfficialDomain !== "string"
    || input.allowedOfficialDomain !== officialDomain
  ) return null;
  if (typeof input.expectedSha256 !== "string" || !/^[a-f\d]{64}$/u.test(input.expectedSha256)) return null;
  if (
    typeof input.expectedByteLength !== "number"
    || !Number.isSafeInteger(input.expectedByteLength)
    || input.expectedByteLength < 5
    || input.expectedByteLength > MAX_PDF_BYTES
  ) return null;

  const authorizedAt = exactIsoTime(input.authorizedAt);
  const validUntil = exactIsoTime(input.validUntil);
  if (
    authorizedAt === null
    || validUntil === null
    || validUntil <= authorizedAt
    || validUntil - authorizedAt > MAX_CAPABILITY_LIFETIME_MS
    || authorizedAt > nowMs + MAX_CLOCK_SKEW_MS
    || validUntil <= nowMs
  ) return null;

  const document = validateDocument(input.document);
  if (!document) return null;
  return {
    mode: "device_text",
    sourceUrl,
    allowedOfficialDomain: officialDomain,
    expectedSha256: input.expectedSha256,
    expectedByteLength: input.expectedByteLength,
    authorizedAt: input.authorizedAt as string,
    validUntil: input.validUntil as string,
    document,
  };
}

function validateDocument(input: unknown): DeviceAcademicPdfSource["document"] | null {
  if (!isRecord(input) || !isConsecutiveAcademicYear(input.academicYear)) return null;
  const academicYear = input.academicYear;
  const universityId = validIdentifier(input.universityId);
  if (!universityId) return null;
  if (input.kind === "academic_calendar") {
    if (!Array.isArray(input.approvedEvents) || input.approvedEvents.length < 1 || input.approvedEvents.length > 200) {
      return null;
    }
    const approvedEvents = input.approvedEvents.flatMap((event) => {
      const descriptor = validateApprovedEvent(event);
      return descriptor ? [descriptor] : [];
    });
    if (
      approvedEvents.length !== input.approvedEvents.length
      || new Set(approvedEvents.map(approvedEventDescriptorKey)).size !== approvedEvents.length
    ) return null;
    return { kind: "academic_calendar", universityId, academicYear, approvedEvents };
  }
  if (input.kind !== "course_schedule" && input.kind !== "exam_schedule") return null;
  const scheduleType = input.kind;
  const departmentId = validIdentifier(input.departmentId);
  const facultyId = input.facultyId === undefined ? undefined : validIdentifier(input.facultyId);
  if (!departmentId || (input.facultyId !== undefined && !facultyId)) return null;
  if (!isAcademicTerm(input.term) || !Array.isArray(input.approvedRowNumbers) || !Array.isArray(input.approvedRows)) return null;
  const approvedRowNumbers = input.approvedRowNumbers;
  if (
    approvedRowNumbers.length === 0
    || approvedRowNumbers.length > 250
    || approvedRowNumbers.some((row) => typeof row !== "number" || !Number.isSafeInteger(row) || row < 1)
    || approvedRowNumbers.some((row, index) => index > 0 && row <= approvedRowNumbers[index - 1]!)
  ) return null;
  const approvedRows = input.approvedRows.flatMap((row) => {
    const descriptor = validateApprovedRow(row, scheduleType);
    return descriptor ? [descriptor] : [];
  });
  if (
    approvedRows.length !== approvedRowNumbers.length
    || approvedRows.some((row, index) => row.rowNumber !== approvedRowNumbers[index])
  ) return null;
  if (scheduleType === "exam_schedule") {
    return {
      kind: "exam_schedule",
      universityId,
      ...(facultyId ? { facultyId } : {}),
      departmentId,
      academicYear,
      term: input.term,
      approvedRowNumbers: [...approvedRowNumbers],
      approvedRows,
    };
  }

  const courseRangeStart = validCalendarDate(input.courseRangeStart);
  const courseRangeEnd = validCalendarDate(input.courseRangeEnd);
  if (!courseRangeStart || !courseRangeEnd) return null;
  const rangeDays = Math.floor((Date.parse(`${courseRangeEnd}T00:00:00.000Z`) - Date.parse(`${courseRangeStart}T00:00:00.000Z`)) / 86_400_000);
  if (rangeDays < 0 || rangeDays > 370) return null;
  return {
    kind: "course_schedule",
    universityId,
    ...(facultyId ? { facultyId } : {}),
    departmentId,
    academicYear,
    term: input.term,
    approvedRowNumbers: [...approvedRowNumbers],
    approvedRows,
    courseRangeStart,
    courseRangeEnd,
  };
}

function validateApprovedEvent(input: unknown): ApprovedEventDescriptor | null {
  if (!isRecord(input)) return null;
  const normalizedTitle = typeof input.normalizedTitle === "string"
    ? normalizeDisplayText(input.normalizedTitle)
    : "";
  const category = typeof input.category === "string" ? input.category : "";
  const temporalKind = input.temporalKind;
  const endTemporalKind = input.endTemporalKind === "date" || input.endTemporalKind === "timestamp"
    ? input.endTemporalKind
    : undefined;
  const startDate = validAcademicTemporal(input.startDate, temporalKind);
  const endDate = input.endDate === undefined
    ? undefined
    : validAcademicTemporal(input.endDate, endTemporalKind) ?? undefined;
  if (
    !normalizedTitle
    || normalizedTitle !== input.normalizedTitle
    || normalizedTitle.length > 240
    || !/^[a-z][a-z0-9_]{0,63}$/u.test(category)
    || (temporalKind !== "date" && temporalKind !== "timestamp")
    || !startDate
    || (input.endDate === undefined) !== (endTemporalKind === undefined)
    || (input.endDate !== undefined && !endDate)
  ) return null;
  if (endDate && endTemporalKind && temporalOrder(endDate, endTemporalKind) < temporalOrder(startDate, temporalKind)) return null;
  return {
    normalizedTitle,
    category,
    startDate,
    ...(endDate && endTemporalKind ? { endDate, endTemporalKind } : {}),
    temporalKind,
  };
}

function approvedEventDescriptorKey(event: ApprovedEventDescriptor): string {
  return JSON.stringify([
    event.normalizedTitle,
    event.category,
    event.temporalKind,
    event.startDate,
    event.endTemporalKind ?? "",
    event.endDate ?? "",
  ]);
}

function validateApprovedRow(
  input: unknown,
  scheduleType: "course_schedule" | "exam_schedule",
): ApprovedRowDescriptor | null {
  if (!isRecord(input)) return null;
  const normalizedTitle = typeof input.normalizedTitle === "string"
    ? normalizeDisplayText(input.normalizedTitle)
    : "";
  const date = input.date === undefined ? undefined : validCalendarDate(input.date) ?? undefined;
  const dayOfWeek = input.dayOfWeek;
  const startTime = input.startTime;
  const endTime = input.endTime;
  if (
    typeof input.rowNumber !== "number"
    || !Number.isSafeInteger(input.rowNumber)
    || input.rowNumber < 1
    || !normalizedTitle
    || normalizedTitle !== input.normalizedTitle
    || normalizedTitle.length > 240
    || typeof startTime !== "string"
    || !isClockTime(startTime)
    || (input.date !== undefined && !date)
    || (dayOfWeek !== undefined && (typeof dayOfWeek !== "number" || !Number.isSafeInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6))
    || (endTime !== undefined && (typeof endTime !== "string" || !isClockTime(endTime) || endTime <= startTime))
    || (scheduleType === "course_schedule" && dayOfWeek === undefined)
    || (scheduleType === "exam_schedule" && date === undefined)
  ) return null;
  return {
    rowNumber: input.rowNumber,
    normalizedTitle,
    ...(date ? { date } : {}),
    ...(typeof dayOfWeek === "number" ? { dayOfWeek } : {}),
    startTime,
    ...(typeof endTime === "string" ? { endTime } : {}),
  };
}

function contextMatchesDocument(
  context: DeviceAcademicPdfEventContext,
  source: DeviceAcademicPdfSource,
): boolean {
  const document = source.document;
  if (context.universityId !== document.universityId) return false;
  if (document.kind === "academic_calendar") return context.facultyId === undefined && context.departmentId === undefined;
  return context.facultyId === document.facultyId && context.departmentId === document.departmentId;
}

async function defaultFetchPdf(url: string, init: FetchRequestInit): Promise<PdfFetchResponse> {
  return expoFetch(url, init);
}

async function fetchFollowingVerifiedRedirects(
  fetchPdf: NonNullable<DeviceAcademicPdfDependencies["fetchPdf"]>,
  source: DeviceAcademicPdfSource,
  signal: AbortSignal,
): Promise<PdfFetchResponse> {
  const visited = new Set<string>();
  let url = source.sourceUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    if (visited.has(url)) throw new DeviceAcademicPdfError("source_redirect");
    visited.add(url);
    const response = await fetchPdf(url, {
      method: "GET",
      credentials: "omit",
      redirect: "manual",
      headers: {
        Accept: "application/pdf, application/octet-stream;q=0.5",
        "Cache-Control": "no-store",
      },
      signal,
    });
    if (!isRedirectStatus(response.status)) return response;
    await response.body?.cancel().catch(() => undefined);
    if (hop === MAX_REDIRECT_HOPS) throw new DeviceAcademicPdfError("source_redirect");
    const location = response.headers.get("location");
    if (!location) throw new DeviceAcademicPdfError("source_redirect");
    let resolved: string;
    try {
      resolved = new URL(location, url).toString();
    } catch {
      throw new DeviceAcademicPdfError("source_redirect");
    }
    const nextUrl = canonicalizeOfficialAcademicUrl(resolved);
    if (
      !nextUrl
      || new URL(nextUrl).protocol !== "https:"
      || officialDomainForUrl(nextUrl) !== source.allowedOfficialDomain
    ) throw new DeviceAcademicPdfError("source_redirect");
    url = nextUrl;
  }
  throw new DeviceAcademicPdfError("source_redirect");
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function assertFinalOfficialUrl(finalUrl: string, source: DeviceAcademicPdfSource): void {
  const canonicalFinalUrl = canonicalizeOfficialAcademicUrl(finalUrl);
  if (
    !canonicalFinalUrl
    || new URL(canonicalFinalUrl).protocol !== "https:"
    || officialDomainForUrl(canonicalFinalUrl) !== source.allowedOfficialDomain
  ) throw new DeviceAcademicPdfError("source_redirect");
}

function assertPdfMime(rawContentType: string | null): void {
  const mime = rawContentType?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US");
  if (mime !== "application/pdf" && mime !== "application/octet-stream" && mime !== "binary/octet-stream") {
    throw new DeviceAcademicPdfError("source_mime");
  }
}

function assertDeclaredSize(rawContentLength: string | null): void {
  if (rawContentLength === null) return;
  if (!/^\d+$/u.test(rawContentLength)) throw new DeviceAcademicPdfError("source_size");
  const size = Number(rawContentLength);
  if (!Number.isSafeInteger(size) || size < 5 || size > MAX_PDF_BYTES) {
    throw new DeviceAcademicPdfError("source_size");
  }
}

async function readExactBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  expectedByteLength: number,
): Promise<Uint8Array> {
  if (!body) throw new DeviceAcademicPdfError("source_size");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) throw new DeviceAcademicPdfError("source_size");
      byteLength += chunk.byteLength;
      if (byteLength > expectedByteLength || byteLength > MAX_PDF_BYTES) {
        await reader.cancel();
        throw new DeviceAcademicPdfError("source_size");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  if (byteLength !== expectedByteLength) throw new DeviceAcademicPdfError("source_size");
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestBytes = new Uint8Array(bytes.byteLength);
  digestBytes.set(bytes);
  const result = await digest(CryptoDigestAlgorithm.SHA256, digestBytes.buffer);
  return [...new Uint8Array(result)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

let nextTemporaryFile = 0;

async function extractNativeTextLayer(bytes: Uint8Array, source: DeviceAcademicPdfSource): Promise<string> {
  const nativeExtractor: NativePdfTextExtractor = { isAvailable, getPageCount, extractText };
  if (!nativeExtractor.isAvailable()) throw new DeviceAcademicPdfError("native_unavailable");
  nextTemporaryFile = (nextTemporaryFile + 1) % 1_000_000;
  const file = new File(
    Paths.cache,
    `academic-pdf-${source.expectedSha256.slice(0, 16)}-${Date.now()}-${nextTemporaryFile}.pdf`,
  );
  try {
    file.write(bytes);
    const pageCount = await withTimeout(nativeExtractor.getPageCount(file.uri), DEFAULT_EXTRACTION_TIMEOUT_MS);
    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > MAX_PDF_PAGES) {
      throw new DeviceAcademicPdfError("page_limit");
    }
    return await withTimeout(nativeExtractor.extractText(file.uri), DEFAULT_EXTRACTION_TIMEOUT_MS);
  } finally {
    if (file.exists) file.delete();
  }
}

function requireUsableTextLayer(input: unknown): string {
  if (typeof input !== "string" || input.length > MAX_EXTRACTED_TEXT_LENGTH) {
    throw new DeviceAcademicPdfError("text_layer_missing");
  }
  const text = input.replace(/\0/gu, " ").trim();
  const usefulCharacters = text.slice(0, 200_000).replace(/[^\p{L}\p{N}]/gu, "").length;
  if (usefulCharacters < 20) throw new DeviceAcademicPdfError("text_layer_missing");
  return text;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DeviceAcademicPdfError("timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d;
}

function exactIsoTime(input: unknown): number | null {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input)) return null;
  const value = Date.parse(input);
  return Number.isFinite(value) && new Date(value).toISOString() === input ? value : null;
}

function isConsecutiveAcademicYear(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const match = /^(\d{4})-(\d{4})$/u.exec(input);
  return Boolean(match && Number(match[2]) === Number(match[1]) + 1);
}

function isAcademicTerm(input: unknown): input is "fall" | "spring" | "summer" | "full_year" | "unknown" {
  return input === "fall" || input === "spring" || input === "summer" || input === "full_year" || input === "unknown";
}

function isClockTime(input: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(input);
}

function validCalendarDate(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(input);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3])
    ? input
    : null;
}

function validAcademicTemporal(input: unknown, kind: unknown): string | null {
  if (kind === "date") return validCalendarDate(input);
  if (
    kind !== "timestamp"
    || typeof input !== "string"
    || input.length > 40
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(input)
  ) return null;
  return Number.isFinite(Date.parse(input)) ? input : null;
}

function temporalOrder(value: string, kind: "date" | "timestamp"): number {
  return Date.parse(kind === "date" ? `${value}T00:00:00.000Z` : value);
}

function validIdentifier(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.normalize("NFKC").trim();
  return value && value === input && value.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    ? value
    : null;
}

function boundedTimeout(input: number | undefined, fallback: number): number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 100 && input <= 60_000
    ? input
    : fallback;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
