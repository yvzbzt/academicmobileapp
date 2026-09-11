import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseOfficeDocument } from "../src/modules/documents/office-document-parser.js";

describe("office document parser", () => {
  it("extracts DOCX text for non-PDF schedule fallback parsing", () => {
    const docx = createZip({
      "word/document.xml": [
        "<w:document>",
        "<w:body>",
        "<w:p><w:r><w:t>Ders Programi</w:t></w:r></w:p>",
        "<w:p><w:r><w:t>Final Sinavlari 05.01.2027</w:t></w:r></w:p>",
        "</w:body>",
        "</w:document>"
      ].join("")
    });

    const parsed = parseOfficeDocument({ fileName: "program.docx", data: docx });

    expect(parsed.kind).toBe("docx");
    expect(parsed.text).toContain("Ders Programi");
    expect(parsed.text).toContain("Final Sinavlari 05.01.2027");
  });

  it("extracts XLSX rows as tab-aligned cells for schedule parsing", () => {
    const xlsx = createZip({
      "xl/sharedStrings.xml": [
        "<sst>",
        "<si><t>Etkinlik</t></si>",
        "<si><t>Baslama Tarihi</t></si>",
        "<si><t>Saat</t></si>",
        "<si><t>Final Sinavlari</t></si>",
        "</sst>"
      ].join(""),
      "xl/worksheets/sheet1.xml": [
        "<worksheet><sheetData>",
        "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c><c r=\"C1\" t=\"s\"><v>2</v></c></row>",
        "<row r=\"2\"><c r=\"A2\" t=\"s\"><v>3</v></c><c r=\"B2\"><v>05.01.2027</v></c><c r=\"C2\"><v>10:00</v></c></row>",
        "</sheetData></worksheet>"
      ].join("")
    });

    const parsed = parseOfficeDocument({ fileName: "sinav-programi.xlsx", data: xlsx });

    expect(parsed.kind).toBe("xlsx");
    expect(parsed.text.split("\n")).toEqual([
      "Etkinlik\tBaslama Tarihi\tSaat",
      "Final Sinavlari\t05.01.2027\t10:00"
    ]);
  });

  it("rejects encrypted and unsupported-compression entries fail closed", () => {
    const encrypted = createZip({ "word/document.xml": "hello" });
    encrypted.writeUInt16LE(1, 6);
    encrypted.writeUInt16LE(1, encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 8);
    expect(() => parseOfficeDocument({ fileName: "bad.docx", data: encrypted })).toThrow("ENCRYPTED_ZIP_ENTRY_FORBIDDEN");

    const unsupported = createZip({ "word/document.xml": "hello" });
    unsupported.writeUInt16LE(99, 8);
    unsupported.writeUInt16LE(99, unsupported.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);
    expect(() => parseOfficeDocument({ fileName: "bad.docx", data: unsupported })).toThrow("ZIP_COMPRESSION_METHOD_UNSUPPORTED");

    const unsupportedFlag = createZip({ "word/document.xml": "hello" });
    unsupportedFlag.writeUInt16LE(0x0040, 6);
    unsupportedFlag.writeUInt16LE(0x0040, unsupportedFlag.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 8);
    expect(() => parseOfficeDocument({ fileName: "bad.docx", data: unsupportedFlag })).toThrow("ZIP_GENERAL_PURPOSE_FLAG_UNSUPPORTED");
  });

  it("rejects zip bombs from declared size, ratio, and out-of-bounds offsets before inflate", () => {
    const oversized = createZip({ "word/document.xml": "hello" });
    oversized.writeUInt32LE(17 * 1024 * 1024, oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    expect(() => parseOfficeDocument({ fileName: "bad.docx", data: oversized })).toThrow("ZIP_ENTRY_SIZE_LIMIT");

    const ratio = createZip({ "word/document.xml": "hello" });
    ratio.writeUInt32LE(1_000_000, ratio.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    expect(() => parseOfficeDocument({ fileName: "bad.docx", data: ratio })).toThrow("ZIP_COMPRESSION_RATIO_LIMIT");

    const invalidOffset = createZip({ "word/document.xml": "hello" });
    invalidOffset.writeUInt32LE(invalidOffset.length + 100, invalidOffset.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 42);
    expect(() => parseOfficeDocument({ fileName: "bad.docx", data: invalidOffset })).toThrow("INVALID_ZIP_LOCAL_HEADER");
  });
});

function createZip(entries: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const raw = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(raw);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(localHeader, nameBuffer, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
