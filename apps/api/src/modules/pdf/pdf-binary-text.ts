import { PDFParse } from "pdf-parse";

export interface PdfBinaryText {
  pageCount: number;
  text: string;
}

/** Extracts text and page count from the exact bytes used for binary identity. */
export async function extractPdfBinaryText(data: Buffer): Promise<PdfBinaryText> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    const resultWithTotal = result as { text?: string; total?: number };
    const text = resultWithTotal.text ?? "";
    const parsedPageCount = Number(resultWithTotal.total);
    return {
      pageCount: Number.isInteger(parsedPageCount) && parsedPageCount > 0
        ? parsedPageCount
        : Math.max(1, (text.match(/\f/gu)?.length ?? 0) + 1),
      text
    };
  } finally {
    await parser.destroy();
  }
}
