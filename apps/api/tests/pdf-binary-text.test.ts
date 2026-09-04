import { describe, expect, it } from "vitest";
import { extractPdfBinaryText } from "../src/modules/pdf/pdf-binary-text.js";

describe("verified PDF binary text extraction", () => {
  it("derives text and page count from the supplied bytes", async () => {
    const result = await extractPdfBinaryText(textPdf("15 Eylul 2026 Ders Kayitlari"));

    expect(result.pageCount).toBe(1);
    expect(result.text).toContain("15 Eylul 2026 Ders Kayitlari");
  });
});

function textPdf(text: string): Buffer {
  const escapedText = text.replace(/([\\()])/gu, "\\$1");
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escapedText}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(body, "latin1");
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
