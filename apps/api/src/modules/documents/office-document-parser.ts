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

const MAX_ZIP_ENTRIES = 2_048;
const MAX_ZIP_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_COMPRESSION_RATIO = 100;
const MAX_ZIP_ENTRY_NAME_BYTES = 1_024;
const SUPPORTED_ZIP_GENERAL_PURPOSE_FLAGS = 0x080e; // deflate options, data descriptor, UTF-8 names

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

  requireBufferRange(data, endOffset, 22, "INVALID_ZIP_END_RECORD");
  const diskNumber = data.readUInt16LE(endOffset + 4);
  const centralDirectoryDisk = data.readUInt16LE(endOffset + 6);
  const entriesOnDisk = data.readUInt16LE(endOffset + 8);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0) throw new Error("MULTI_DISK_ZIP_FORBIDDEN");

  const entryCount = data.readUInt16LE(endOffset + 10);
  if (entriesOnDisk !== entryCount || entryCount > MAX_ZIP_ENTRIES) throw new Error("ZIP_ENTRY_COUNT_LIMIT");
  const centralDirectorySize = data.readUInt32LE(endOffset + 12);
  let cursor = data.readUInt32LE(endOffset + 16);
  if (cursor + centralDirectorySize > endOffset || cursor > data.length) throw new Error("INVALID_ZIP_CENTRAL_DIRECTORY_BOUNDS");
  const entries: ZipEntry[] = [];
  const entryNames = new Set<string>();
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    requireBufferRange(data, cursor, 46, "INVALID_ZIP_CENTRAL_DIRECTORY");
    if (data.readUInt32LE(cursor) !== 0x02014b50) throw new Error("INVALID_ZIP_CENTRAL_DIRECTORY");
    const flags = data.readUInt16LE(cursor + 8);
    const compressionMethod = data.readUInt16LE(cursor + 10);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const uncompressedSize = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localHeaderOffset = data.readUInt32LE(cursor + 42);
    if ((flags & 0x0001) !== 0) throw new Error("ENCRYPTED_ZIP_ENTRY_FORBIDDEN");
    if ((flags & ~SUPPORTED_ZIP_GENERAL_PURPOSE_FLAGS) !== 0 || (compressionMethod === 0 && (flags & 0x0006) !== 0)) {
      throw new Error("ZIP_GENERAL_PURPOSE_FLAG_UNSUPPORTED");
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) throw new Error("ZIP_COMPRESSION_METHOD_UNSUPPORTED");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new Error("ZIP64_ARCHIVE_UNSUPPORTED");
    }
    if (nameLength === 0 || nameLength > MAX_ZIP_ENTRY_NAME_BYTES) throw new Error("ZIP_ENTRY_NAME_INVALID");
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw new Error("ZIP_ENTRY_SIZE_LIMIT");
    if (uncompressedSize > 0 && (compressedSize === 0 || uncompressedSize / compressedSize > MAX_ZIP_COMPRESSION_RATIO)) {
      throw new Error("ZIP_COMPRESSION_RATIO_LIMIT");
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_ZIP_TOTAL_BYTES) throw new Error("ZIP_TOTAL_SIZE_LIMIT");
    const centralEntrySize = 46 + nameLength + extraLength + commentLength;
    requireBufferRange(data, cursor, centralEntrySize, "INVALID_ZIP_CENTRAL_DIRECTORY_BOUNDS");
    const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) {
      throw new Error("ZIP_ENTRY_PATH_FORBIDDEN");
    }
    if (entryNames.has(name)) throw new Error("ZIP_DUPLICATE_ENTRY_NAME");
    entryNames.add(name);
    cursor += centralEntrySize;

    requireBufferRange(data, localHeaderOffset, 30, "INVALID_ZIP_LOCAL_HEADER");
    if (localHeaderOffset >= data.readUInt32LE(endOffset + 16)) throw new Error("INVALID_ZIP_LOCAL_HEADER_BOUNDS");
    if (data.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error("INVALID_ZIP_LOCAL_HEADER");
    const localFlags = data.readUInt16LE(localHeaderOffset + 6);
    const localCompressionMethod = data.readUInt16LE(localHeaderOffset + 8);
    if ((localFlags & 0x0001) !== 0 || localFlags !== flags || localCompressionMethod !== compressionMethod) {
      throw new Error("ZIP_LOCAL_HEADER_MISMATCH");
    }
    const localNameLength = data.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = data.readUInt16LE(localHeaderOffset + 28);
    requireBufferRange(data, localHeaderOffset + 30, localNameLength + localExtraLength, "INVALID_ZIP_LOCAL_HEADER_BOUNDS");
    const localName = data.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength);
    if (!localName.equals(data.subarray(cursor - centralEntrySize + 46, cursor - centralEntrySize + 46 + nameLength))) {
      throw new Error("ZIP_LOCAL_ENTRY_NAME_MISMATCH");
    }
    const payloadStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    requireBufferRange(data, payloadStart, compressedSize, "INVALID_ZIP_PAYLOAD_BOUNDS");
    if (payloadStart + compressedSize > data.readUInt32LE(endOffset + 16)) throw new Error("INVALID_ZIP_PAYLOAD_BOUNDS");
    const compressed = data.subarray(payloadStart, payloadStart + compressedSize);
    const entryData = compressionMethod === 0
      ? compressed
      : compressionMethod === 8
        ? inflateRawSync(compressed, { maxOutputLength: Math.min(uncompressedSize + 1, MAX_ZIP_ENTRY_BYTES + 1) })
        : undefined;
    if (!entryData || entryData.length !== uncompressedSize) throw new Error("ZIP_ENTRY_SIZE_MISMATCH");
    entries.push({ name, data: entryData });
  }

  if (cursor !== data.readUInt32LE(endOffset + 16) + centralDirectorySize) {
    throw new Error("INVALID_ZIP_CENTRAL_DIRECTORY_SIZE");
  }

  return entries;
}

function findEndOfCentralDirectory(data: Buffer): number {
  if (data.length < 22) return -1;
  const minimumOffset = Math.max(0, data.length - 0xffff - 22);
  for (let offset = data.length - 22; offset >= minimumOffset; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      const commentLength = data.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === data.length) return offset;
    }
  }
  return -1;
}

function requireBufferRange(data: Buffer, offset: number, length: number, errorCode: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > data.length) {
    throw new Error(errorCode);
  }
}
