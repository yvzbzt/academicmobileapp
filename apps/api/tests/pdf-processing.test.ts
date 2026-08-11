import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { InMemoryPdfRepository } from "../src/modules/pdf/in-memory-pdf.repository.js";
import { PdfProcessingService } from "../src/modules/pdf/pdf-processing.service.js";

function createService(): PdfProcessingService {
  return new PdfProcessingService(new InMemoryPdfRepository(), {
    async extractText() {
      return null;
    }
  });
}

function createServiceWithOcr(rawText: string): PdfProcessingService {
  return new PdfProcessingService(new InMemoryPdfRepository(), {
    async extractText() {
      return { provider: "test_ocr", text: rawText };
    }
  });
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

  it("merges split PDF rows and ignores dangling duplicate fragments", async () => {
    const service = createService();
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "split-row-calendar.pdf",
      rawText: [
        "ilan edilmesinin son günü",
        "24.07.2026",
        "2025-2026 Bahar Döneminde %10'luk başarı dilimine itirazın son günü",
        "24.07.2026",
        "günü",
        "24.07.2026"
      ].join("\n")
    });

    const result = await service.processPdfSource(source.id);

    expect(result.extractedEvents).toHaveLength(1);
    expect(result.extractedEvents[0]).toEqual(
      expect.objectContaining({
        normalizedTitle: "2025-2026 Bahar Döneminde %10'luk başarı dilimine itirazın son günü",
        startDate: new Date("2026-07-24T00:00:00.000Z")
      })
    );
  });

  it("combines wrapped titles with a following date-only PDF line", async () => {
    const service = createService();
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "wrapped-row-calendar.pdf",
      rawText: [
        "2025-2026 Bahar Döneminde",
        "%10'luk başarı dilimine itirazın son günü",
        "24.07.2026"
      ].join("\n")
    });

    const result = await service.processPdfSource(source.id);

    expect(result.extractedEvents).toHaveLength(1);
    expect(result.extractedEvents[0]?.normalizedTitle).toBe("2025-2026 Bahar Döneminde %10'luk başarı dilimine itirazın son günü");
  });

  it("extracts aligned dates and times from structured table rows", async () => {
    const service = createService();
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "table-layout-calendar.pdf",
      rawText: [
        "Etkinlik\tBaslama Tarihi\tBitis Tarihi\tSaat",
        "Guz Donemi Ders Kayitlari\t15.09.2026\t19.09.2026\t09:30",
        "Final Sinavlari\t05.01.2027\t16.01.2027\t10:00"
      ].join("\n")
    });

    const result = await service.processPdfSource(source.id);

    expect(result.extractedEvents).toHaveLength(2);
    expect(result.extractedEvents[0]).toEqual(
      expect.objectContaining({
        normalizedTitle: "Guz Donemi Ders Kayitlari",
        temporalKind: "timestamp",
        endTemporalKind: "date",
        dateOnlyEnd: "2026-09-19",
        startDate: new Date("2026-09-15T06:30:00.000Z"),
        endDate: new Date("2026-09-19T23:59:59.999Z"),
        startTime: "09:30",
        hasExplicitTime: true
      })
    );
    expect(result.extractedEvents[1]?.startDate).toEqual(new Date("2027-01-05T07:00:00.000Z"));
  });

  it("uses historical IANA Istanbul offsets for timed PDF rows", async () => {
    const service = createService();
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "historical-timed-calendar.pdf",
      rawText: "Ders Kayitlari 01.01.2015 23:30"
    });

    const result = await service.processPdfSource(source.id);

    expect(result.extractedEvents).toHaveLength(1);
    expect(result.extractedEvents[0]).toEqual(expect.objectContaining({
      temporalKind: "timestamp",
      startDate: new Date("2015-01-01T21:30:00.000Z"),
      startTime: "23:30"
    }));
  });

  it.each([
    ["nonexistent", "Ders Kayitlari 29.03.2015 03:30"],
    ["ambiguous", "Ders Kayitlari 08.11.2015 03:30"]
  ])("drops a PDF row with a %s Istanbul wall-clock value", async (_case, rawText) => {
    const service = createService();
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: `${_case}-timed-calendar.pdf`,
      rawText
    });

    const result = await service.processPdfSource(source.id);

    expect(result.extractedEvents).toEqual([]);
  });

  it("extracts row-aligned dates from header mapped table cells", async () => {
    const service = createService();
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "header-mapped-table-calendar.pdf",
      rawText: [
        "Event\tEvent Start Time\tEnd Date\tStart Date",
        "Final Sinavlari\t14:30\t05.09.2026\t01.09.2026"
      ].join("\n")
    });

    const result = await service.processPdfSource(source.id);

    expect(result.extractedEvents).toHaveLength(1);
    expect(result.extractedEvents[0]).toEqual(
      expect.objectContaining({
        normalizedTitle: "Final Sinavlari",
        normalizedCategory: "final_exam",
        temporalKind: "timestamp",
        endTemporalKind: "date",
        dateOnlyEnd: "2026-09-05",
        startDate: new Date("2026-09-01T11:30:00.000Z"),
        endDate: new Date("2026-09-05T23:59:59.999Z"),
        startTime: "14:30",
        hasExplicitTime: true
      })
    );
  });

  it("strips inline pagination and navigation labels from PDF event rows", async () => {
    const service = createService();
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "navigation-filter-calendar.pdf",
      rawText: [
        "Next",
        "Read more",
        "Show more",
        "Read more Ders Kayitlari 01.09.2026",
        "Show more Mezuniyet Basvurusu 02.09.2026",
        "Next Ara Sinavlari 10.11.2026"
      ].join("\n")
    });

    const result = await service.processPdfSource(source.id);

    expect(result.extractedEvents.map((event) => event.normalizedTitle)).toEqual([
      "Ders Kayitlari",
      "Mezuniyet Basvurusu",
      "Ara Sinavlari"
    ]);
  });

  it("does not emit document headings or notes as unknown-date calendar events", async () => {
    const service = createService();
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "agri-current-calendar.pdf",
      rawText: [
        "AGRI IBRAHIM CECEN UNIVERSITESI",
        "2025-2026 AKADEMIK TAKVIMI",
        "NOT: Akademik takvimde belirtilen tarihler resmi duyurulara gore guncellenebilir.",
        "Ders Kayitlari 01.09.2026",
        "Final Sinavlari 05.01.2027 - 16.01.2027"
      ].join("\n")
    });

    const result = await service.processPdfSource(source.id);

    expect(result.extractedEvents).toHaveLength(2);
    expect(result.extractedEvents.every((event) => event.startDate && event.datePrecision !== "unknown")).toBe(true);
    expect(result.extractedEvents.map((event) => event.normalizedTitle)).toEqual([
      "Ders Kayitlari",
      "Final Sinavlari"
    ]);
  });

  it("repairs noisy OCR date and time glyphs before extracting events", async () => {
    const service = createService();
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "ocr-noisy-calendar.pdf",
      rawText: [
        "Ders kay1tlari 0l.09.2026",
        "Ara s1navlar l0.ll.2026 Saat l4:3O"
      ].join("\n")
    });

    const result = await service.processPdfSource(source.id);

    expect(result.extractedEvents).toHaveLength(2);
    expect(result.extractedEvents[0]).toEqual(expect.objectContaining({
      normalizedCategory: "course_registration",
      temporalKind: "date",
      dateOnlyStart: "2026-09-01",
      startDate: new Date("2026-09-01T00:00:00.000Z")
    }));
    expect(result.extractedEvents[1]).toEqual(expect.objectContaining({
      normalizedCategory: "midterm_exam",
      temporalKind: "timestamp",
      startDate: new Date("2026-11-10T11:30:00.000Z"),
      startTime: "14:30",
      hasExplicitTime: true
    }));
  });

  it("marks scanned PDFs as OCR required when no text layer exists", async () => {
    const service = createService();
    const { rawText: _rawText, ...scannedPdfInput } = validPdfInput;
    const source = await service.createPdfSource({ ...scannedPdfInput, fileName: "scanned.pdf" });

    const result = await service.processPdfSource(source.id);

    expect(result.pdfSource.parseStatus).toBe("ocr_required");
    expect(result.extractedEvents).toHaveLength(0);
  });

  it("extracts events from OCR text when the PDF has no text layer", async () => {
    const service = createServiceWithOcr("15-19 Eylul 2026 Guz Donemi Ders Kayitlari");
    const { rawText: _rawText, ...scannedPdfInput } = validPdfInput;
    const source = await service.createPdfSource({ ...scannedPdfInput, fileName: "ocr-scanned.pdf" });

    const result = await service.processPdfSource(source.id, { pdfData: Buffer.from("%PDF") });

    expect(result.pdfSource.parseStatus).toBe("processed");
    expect(result.pdfSource.ocrProvider).toBe("test_ocr");
    expect(result.extractedEvents).toHaveLength(1);
    expect(result.extractedEvents[0]).toEqual(expect.objectContaining({ normalizedCategory: "course_registration" }));
  });

  it("falls back to OCR when the text layer has no extractable events", async () => {
    const service = createServiceWithOcr("15-19 Eylul 2026 Guz Donemi Ders Kayitlari");
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "ocr-fallback.pdf",
      rawText: "MALATYA TURGUT OZAL UNIVERSITESI AKADEMIK TAKVIM"
    });

    const result = await service.processPdfSource(source.id, { pdfData: Buffer.from("%PDF") });

    expect(result.pdfSource.parseStatus).toBe("processed");
    expect(result.pdfSource.ocrProvider).toBe("test_ocr");
    expect(result.extractedEvents).toHaveLength(1);
    expect(result.extractedEvents[0]).toEqual(expect.objectContaining({ normalizedCategory: "course_registration" }));
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

  it("rejects a reverse extracted range at the approval boundary", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, {
      async extractText() {
        return null;
      }
    });
    const source = await service.createPdfSource(validPdfInput);
    const result = await service.processPdfSource(source.id);
    const event = result.extractedEvents[0]!;
    await repository.updateExtractedEvent(event.id, {
      temporalKind: "date",
      dateOnlyStart: "2026-09-03",
      startDate: new Date("2026-09-03T00:00:00.000Z"),
      endTemporalKind: "date",
      dateOnlyEnd: "2026-09-01",
      endDate: new Date("2026-09-01T23:59:59.999Z")
    });

    await expect(service.approveExtractedEvent(event.id, "admin-1"))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getExtractedEvent(event.id)).resolves.toMatchObject({ status: "pending_review" });
  });

  it("preserves an exact timestamp end on a range with a date-only start", async () => {
    const service = createService();
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "inverse-mixed-range.pdf",
      rawText: "Basvuru sonuclari 01.09.2026 - 03.09.2026 17:00"
    });

    const result = await service.processPdfSource(source.id);

    expect(result.extractedEvents).toHaveLength(1);
    expect(result.extractedEvents[0]).toEqual(expect.objectContaining({
      temporalKind: "date",
      endTemporalKind: "timestamp",
      dateOnlyStart: "2026-09-01",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-09-03T14:00:00.000Z"),
      endTime: "17:00"
    }));
  });

  it("clears stale date-only metadata when an admin replaces a range with real timestamps", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, {
      async extractText() {
        return null;
      }
    });
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "admin-temporal-edit.pdf",
      rawText: "Ders Kayitlari 01.09.2026 - 03.09.2026"
    });
    const processed = await service.processPdfSource(source.id);
    const original = processed.extractedEvents[0]!;
    expect(original).toMatchObject({
      temporalKind: "date",
      endTemporalKind: "date",
      dateOnlyStart: "2026-09-01",
      dateOnlyEnd: "2026-09-03"
    });

    const updated = await service.updateExtractedEvent(original.id, {
      startDate: "2026-09-01T09:30:00+03:00",
      endDate: "2026-09-03T11:00:00+03:00"
    });

    expect(updated).toMatchObject({
      temporalKind: "timestamp",
      endTemporalKind: "timestamp",
      startDate: new Date("2026-09-01T06:30:00.000Z"),
      endDate: new Date("2026-09-03T08:00:00.000Z")
    });
    expect(updated.dateOnlyStart).toBeUndefined();
    expect(updated.dateOnlyEnd).toBeUndefined();
  });

  it("validates partial admin temporal edits against the stored counterpart before writing", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, {
      async extractText() {
        return null;
      }
    });
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "admin-invalid-temporal-edit.pdf",
      rawText: "Ders Kayitlari 01.09.2026 - 03.09.2026"
    });
    const processed = await service.processPdfSource(source.id);
    const original = processed.extractedEvents[0]!;

    await expect(service.updateExtractedEvent(original.id, {
      startDate: "2026-09-04"
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateExtractedEvent(original.id, {
      startDate: "2026-09-01T09:30:00"
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateExtractedEvent(original.id, {
      endDate: ""
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateExtractedEvent(original.id, {
      endDate: null
    } as unknown as { endDate?: string })).rejects.toBeInstanceOf(BadRequestException);

    expect(await service.getExtractedEvent(original.id)).toMatchObject({
      temporalKind: "date",
      endTemporalKind: "date",
      dateOnlyStart: "2026-09-01",
      dateOnlyEnd: "2026-09-03"
    });
  });

  it("preserves an untouched legacy date end and rejects inconsistent declared date metadata", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, {
      async extractText() {
        return null;
      }
    });
    const source = await service.createPdfSource(validPdfInput);
    const processed = await service.processPdfSource(source.id);
    const original = processed.extractedEvents[0]!;
    await repository.updateExtractedEvent(original.id, {
      endTemporalKind: undefined
    } as unknown as Parameters<InMemoryPdfRepository["updateExtractedEvent"]>[1]);

    const updated = await service.updateExtractedEvent(original.id, { startDate: "2026-09-16" });
    expect(updated).toMatchObject({
      temporalKind: "date",
      dateOnlyStart: "2026-09-16",
      endTemporalKind: "date",
      dateOnlyEnd: "2026-09-19"
    });

    await repository.updateExtractedEvent(original.id, {
      endTemporalKind: "date",
      dateOnlyEnd: undefined
    } as unknown as Parameters<InMemoryPdfRepository["updateExtractedEvent"]>[1]);
    await expect(service.updateExtractedEvent(original.id, { startDate: "2026-09-17" }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getExtractedEvent(original.id)).resolves.toMatchObject({ dateOnlyStart: "2026-09-16" });
  });

  it("rejects a reverse PDF-extracted range instead of persisting a candidate", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, {
      async extractText() {
        return null;
      }
    });
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "reverse-temporal-range.pdf",
      rawText: "Ders Kayitlari 03.09.2026 - 01.09.2026"
    });

    const processed = await service.processPdfSource(source.id);

    expect(processed.extractedEvents).toEqual([]);
    expect(await repository.listExtractedEvents({ pdfSourceId: source.id, limit: 10, offset: 0 })).toEqual([]);
  });
});
