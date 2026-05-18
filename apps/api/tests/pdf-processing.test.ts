import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { InMemoryPdfRepository } from "../src/modules/pdf/in-memory-pdf.repository.js";
import { PdfProcessingService } from "../src/modules/pdf/pdf-processing.service.js";

function createService(): PdfProcessingService {
  return new PdfProcessingService(new InMemoryPdfRepository());
}

const validPdfInput = {
  universityId: "sample-university-1",
  fileName: "akademik-takvim-2026.pdf",
  mimeType: "application/pdf",
  magicBytesHex: "255044462d312e37",
  fileSize: 1024,
  pageCount: 2,
  academicYear: "2026-2027",
  uploadedBy: "admin-1",
  rawText: "15-19 Eylul 2026 Guz Donemi Ders Kayitlari\n05-16 Ocak 2027 Guz Donemi Final Sinavlari"
};

describe("PdfProcessingService", () => {
  it("rejects unsafe non-PDF inputs", async () => {
    const service = createService();

    await expect(
      service.createPdfSource({
        ...validPdfInput,
        mimeType: "text/plain"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("prevents duplicate PDF processing by hash", async () => {
    const service = createService();
    await service.createPdfSource(validPdfInput);

    await expect(service.createPdfSource(validPdfInput)).rejects.toBeInstanceOf(ConflictException);
  });

  it("extracts pending review events from text layer", async () => {
    const service = createService();
    const source = await service.createPdfSource(validPdfInput);

    const result = await service.processPdfSource(source.id);

    expect(result.pdfSource.parseStatus).toBe("processed");
    expect(result.extractedEvents).toHaveLength(2);
    expect(result.extractedEvents[0]).toEqual(
      expect.objectContaining({
        normalizedCategory: "course_registration",
        status: "pending_review",
        sourcePage: 1
      })
    );
  });

  it("marks scanned PDFs as OCR required when no text layer exists", async () => {
    const service = createService();
    const { rawText: _rawText, ...scannedPdfInput } = validPdfInput;
    const source = await service.createPdfSource({ ...scannedPdfInput, fileName: "scanned.pdf" });

    const result = await service.processPdfSource(source.id);

    expect(result.pdfSource.parseStatus).toBe("ocr_required");
    expect(result.extractedEvents).toHaveLength(0);
  });

  it("supports admin approve and reject review decisions", async () => {
    const service = createService();
    const source = await service.createPdfSource(validPdfInput);
    const result = await service.processPdfSource(source.id);
    const firstEventId = result.extractedEvents[0]?.id;
    const secondEventId = result.extractedEvents[1]?.id;
    expect(firstEventId).toBeDefined();
    expect(secondEventId).toBeDefined();

    const approved = await service.approveExtractedEvent(firstEventId!, "admin-1");
    const rejected = await service.rejectExtractedEvent(secondEventId!, "admin-1", "Wrong row");

    expect(approved.status).toBe("approved");
    expect(approved.reviewedBy).toBe("admin-1");
    expect(rejected.status).toBe("rejected");
    expect(rejected.adminNote).toBe("Wrong row");
  });
});
