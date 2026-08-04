import { Injectable, Logger } from "@nestjs/common";
import { safeOutboundRequest } from "../../common/network/safe-outbound-request.js";
import { isOfficialContentUrl } from "../announcements/announcement-content-trust.js";
import type { PdfSourceRecord } from "./pdf.types.js";

export interface PdfOcrResult {
  provider: string;
  text: string;
}

interface DocumentAiTextSegment {
  startIndex?: string | number;
  endIndex?: string | number;
}

interface DocumentAiLayout {
  textAnchor?: {
    textSegments?: DocumentAiTextSegment[];
  };
}

interface DocumentAiPage {
  layout?: DocumentAiLayout;
  tables?: DocumentAiTable[];
}

interface DocumentAiTableCell {
  layout?: DocumentAiLayout;
}

interface DocumentAiTableRow {
  cells?: DocumentAiTableCell[];
}

interface DocumentAiTable {
  headerRows?: DocumentAiTableRow[];
  bodyRows?: DocumentAiTableRow[];
}

interface DocumentAiResponse {
  document?: {
    text?: string;
    pages?: DocumentAiPage[];
  };
  error?: {
    message?: string;
  };
}

@Injectable()
export class PdfOcrService {
  private readonly logger = new Logger(PdfOcrService.name);

  async extractText(input: { pdfSource: PdfSourceRecord; pdfData?: Buffer }): Promise<PdfOcrResult | null> {
    const provider = (process.env.OCR_PROVIDER ?? "").trim().toLocaleLowerCase("en-US");
    if (!["google_document_ai", "document_ai"].includes(provider)) return null;

    const processorName = readDocumentAiProcessorName();
    if (!processorName) {
      this.logger.warn("OCR skipped: Document AI processor is not configured.");
      return null;
    }

    const pdfData = input.pdfData ?? await downloadPdfData(input.pdfSource.url);
    if (!pdfData) {
      this.logger.warn(`OCR skipped: PDF data is unavailable for source ${input.pdfSource.id}.`);
      return null;
    }

    const accessToken = await readGoogleAccessToken();
    if (!accessToken) {
      this.logger.warn("OCR skipped: Google access token is unavailable.");
      return null;
    }

    const location = processorName.match(/\/locations\/([^/]+)\//u)?.[1] ?? process.env.DOCUMENT_AI_LOCATION ?? "eu";
    const endpoint = `https://${location}-documentai.googleapis.com/v1/${processorName}:process`;
    this.logger.log(`Running Document AI OCR for PDF source ${input.pdfSource.id}.`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        rawDocument: {
          content: pdfData.toString("base64"),
          mimeType: "application/pdf"
        }
      })
    });
    const body = await response.json() as DocumentAiResponse;
    if (!response.ok) throw new Error(body.error?.message ?? `DOCUMENT_AI_OCR_FAILED_${response.status}`);

    const text = documentAiPageText(body);
    this.logger.log(`Document AI OCR completed for PDF source ${input.pdfSource.id}: ${text.length} characters.`);
    return text.trim() ? { provider: "google_document_ai", text } : null;
  }
}

function readDocumentAiProcessorName(): string | undefined {
  const explicit = process.env.DOCUMENT_AI_PROCESSOR_NAME ?? process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_NAME;
  if (explicit?.trim()) return explicit.trim().replace(/^\/+/, "");

  const project = process.env.DOCUMENT_AI_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
  const location = process.env.DOCUMENT_AI_LOCATION ?? process.env.GOOGLE_DOCUMENT_AI_LOCATION ?? "eu";
  const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID ?? process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
  if (!project || !processorId) return undefined;
  return `projects/${project}/locations/${location}/processors/${processorId}`;
}

async function readGoogleAccessToken(): Promise<string | undefined> {
  const explicit = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (explicit?.trim()) return explicit.trim();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
      headers: { "Metadata-Flavor": "Google" },
      signal: controller.signal
    });
    if (!response.ok) return undefined;
    const body = await response.json() as { access_token?: string };
    return body.access_token;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadPdfData(url?: string): Promise<Buffer | undefined> {
  if (!url) return undefined;
  const response = await safeOutboundRequest(url, {
    timeoutMs: readPositiveInteger(process.env.OCR_SOURCE_TIMEOUT_MS, 20000),
    maximumRedirects: 5,
    maximumResponseBytes: 50 * 1024 * 1024,
    headers: { Accept: "application/pdf,*/*;q=0.8" },
    validateUrl: (candidate) => {
      if (!isOfficialContentUrl(candidate, url)) throw new Error("OCR_SOURCE_DOMAIN_UNTRUSTED");
      return candidate;
    }
  });
  if (response.status < 200 || response.status >= 300) return undefined;
  if (!response.body.subarray(0, 4).equals(Buffer.from("%PDF"))) return undefined;
  return response.body;
}

function documentAiPageText(response: DocumentAiResponse): string {
  const fullText = response.document?.text ?? "";
  const pages = response.document?.pages ?? [];
  const pageTexts = pages
    .map((page) => renderDocumentAiPageText(fullText, page))
    .filter((text) => text.trim().length > 0);
  return pageTexts.length > 0 ? pageTexts.join("\f") : fullText;
}

function renderDocumentAiPageText(fullText: string, page: DocumentAiPage): string {
  const tableText = textFromTables(fullText, page.tables ?? []);
  const layoutText = textFromLayout(fullText, page.layout).trim();
  if (!tableText) return layoutText;
  if (!layoutText) return tableText;

  const foldedTable = foldForContainment(tableText);
  const foldedLayout = foldForContainment(layoutText);
  if (foldedTable.length > 0 && foldedLayout.length > 0 && (foldedLayout.includes(foldedTable) || foldedTable.includes(foldedLayout))) return tableText;
  return `${tableText}\n${layoutText}`;
}

function textFromTables(fullText: string, tables: DocumentAiTable[]): string {
  return tables
    .flatMap((table) => [...(table.headerRows ?? []), ...(table.bodyRows ?? [])])
    .map((row) => textFromTableRow(fullText, row))
    .filter((row) => row.trim().length > 0)
    .join("\n");
}

function textFromTableRow(fullText: string, row: DocumentAiTableRow): string {
  return (row.cells ?? [])
    .map((cell) => cleanDocumentAiCellText(textFromLayout(fullText, cell.layout)))
    .join("\t");
}

function textFromLayout(fullText: string, layout?: DocumentAiLayout): string {
  const segments = layout?.textAnchor?.textSegments ?? [];
  return segments.map((segment) => {
    const start = Number(segment.startIndex ?? 0);
    const end = Number(segment.endIndex ?? 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "";
    return fullText.slice(start, end);
  }).join("");
}

function cleanDocumentAiCellText(value: string): string {
  return value
    .replace(/\u00a0/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function foldForContainment(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .replace(/[^\p{L}\d]+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
