import { inflateRawSync } from "node:zlib";

export type OfficeDocumentKind = "docx" | "xlsx";

export interface ParsedOfficeDocument {
  kind: OfficeDocumentKind;
  text: string;
  entryCount: number;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

export function parseOfficeDocument(input: { data: Buffer; fileName?: string; mimeType?: string }): ParsedOfficeDocument {
  const kind = inferOfficeDocumentKind(input.fileName, input.mimeType);
  if (!kind) throw new Error("UNSUPPORTED_OFFICE_DOCUMENT_TYPE");
  const entries = readZipEntries(input.data);
  const text = kind === "docx" ? extractDocxText(entries) : extractXlsxText(entries);
  return {
    kind,
    text: text.replace(/\r\n/gu, "\n").replace(/[ \t]+\n/gu, "\n").trim(),
    entryCount: entries.length
  };
}

export function inferOfficeDocumentKind(fileName?: string, mimeType?: string): OfficeDocumentKind | undefined {
  const value = `${fileName ?? ""} ${mimeType ?? ""}`.toLocaleLowerCase("en-US");
  if (value.includes(".docx") || value.includes("wordprocessingml.document")) return "docx";
  if (value.includes(".xlsx") || value.includes("spreadsheetml.sheet")) return "xlsx";
  return undefined;
}

function extractDocxText(entries: ZipEntry[]): string {
  const documentXml = entries.find((entry) => entry.name === "word/document.xml")?.data.toString("utf8");
  if (!documentXml) return "";
  return xmlToText(documentXml
    .replace(/<\/w:tc>/giu, "\t")
    .replace(/<\/w:p>/giu, "\n")
    .replace(/<w:br\b[^>]*>/giu, "\n"));
}

function extractXlsxText(entries: ZipEntry[]): string {
  const sharedStrings = parseSharedStrings(entries.find((entry) => entry.name === "xl/sharedStrings.xml")?.data.toString("utf8") ?? "");
  const worksheetEntries = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/iu.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  const rows: string[] = [];
  for (const sheet of worksheetEntries) {
    const xml = sheet.data.toString("utf8");
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/giu)) {
      const cells = [...(rowMatch[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/giu)]
        .map((cellMatch) => extractXlsxCellText(cellMatch[1] ?? "", cellMatch[2] ?? "", sharedStrings));
      const rendered = trimTrailingEmptyCells(cells).join("\t").trim();
      if (rendered) rows.push(rendered);
    }
  }
  return rows.join("\n");
}

function parseSharedStrings(xml: string): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/giu)].map((match) => xmlToText(match[1] ?? ""));
}

function extractXlsxCellText(attributes: string, body: string, sharedStrings: string[]): string {
  const type = attributes.match(/\bt=["']([^"']+)["']/iu)?.[1];
  if (type === "s") {
    const index = Number(xmlToText(extractFirstTag(body, "v") ?? ""));
    return Number.isInteger(index) ? sharedStrings[index] ?? "" : "";
  }
  if (type === "inlineStr") return xmlToText(extractFirstTag(body, "is") ?? body);
  return xmlToText(extractFirstTag(body, "v") ?? body);
}

function extractFirstTag(xml: string, tagName: string): string | undefined {
  return xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "iu"))?.[1];
}

function trimTrailingEmptyCells(cells: string[]): string[] {
  const copy = [...cells];
  while (copy.at(-1) === "") copy.pop();
  return copy;
}

function xmlToText(xml: string): string {
  return decodeXmlEntities(xml
    .replace(/<[^>]+>/gu, " ")
    .replace(/[ \f\v]+/gu, " ")
    .replace(/\s*\n\s*/gu, "\n")
    .replace(/\s*\t\s*/gu, "\t")
    .trim());
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function readZipEntries(data: Buffer): ZipEntry[] {
  const endOffset = findEndOfCentralDirectory(data);
  if (endOffset < 0) throw new Error("INVALID_ZIP_ARCHIVE");

  const entryCount = data.readUInt16LE(endOffset + 10);
  let cursor = data.readUInt32LE(endOffset + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (data.readUInt32LE(cursor) !== 0x02014b50) throw new Error("INVALID_ZIP_CENTRAL_DIRECTORY");
    const compressionMethod = data.readUInt16LE(cursor + 10);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localHeaderOffset = data.readUInt32LE(cursor + 42);
    const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;

    if (data.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error("INVALID_ZIP_LOCAL_HEADER");
    const localNameLength = data.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = data.readUInt16LE(localHeaderOffset + 28);
    const payloadStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = data.subarray(payloadStart, payloadStart + compressedSize);
    const entryData = compressionMethod === 0
      ? compressed
      : compressionMethod === 8
        ? inflateRawSync(compressed)
        : undefined;
    if (entryData) entries.push({ name, data: entryData });
  }

  return entries;
}

function findEndOfCentralDirectory(data: Buffer): number {
  const minimumOffset = Math.max(0, data.length - 0xffff - 22);
  for (let offset = data.length - 22; offset >= minimumOffset; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}
