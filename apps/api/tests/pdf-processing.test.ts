import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InMemoryPdfRepository } from "../src/modules/pdf/in-memory-pdf.repository.js";
import { PdfProcessingService } from "../src/modules/pdf/pdf-processing.service.js";
import { AdminCalendarService } from "../src/modules/calendars/admin-calendar.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";

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

  it("uses exact PDF bytes for verified identity and labels metadata-only identity as legacy", async () => {
    const service = createService();
    const firstBytes = Buffer.from("%PDF-1.7\nbinary-A", "utf8");
    const secondBytes = Buffer.from("%PDF-1.7\nbinary-B", "utf8");
    const binaryInput = { ...validPdfInput, fileSize: firstBytes.byteLength };
    const first = await service.createPdfSource({ ...binaryInput, pdfData: firstBytes });

    expect(first.fileHash).toBe(createHash("sha256").update(firstBytes).digest("hex"));
    expect(first.binarySha256).toBe(first.fileHash);
    expect(first.binaryIdentityVerified).toBe(true);
    await expect(service.createPdfSource({
      ...binaryInput,
      fileName: "renamed-calendar.pdf",
      rawText: "different extracted text",
      pdfData: firstBytes
    })).rejects.toBeInstanceOf(ConflictException);

    const second = await service.createPdfSource({ ...binaryInput, pdfData: secondBytes });
    expect(second.fileHash).not.toBe(first.fileHash);
    expect(second.binarySha256).toBe(second.fileHash);

    const legacy = await service.createPdfSource({ ...validPdfInput, fileName: "legacy-calendar.pdf" });
    expect(legacy.fileHash).toMatch(/^legacy-unverified-[a-f0-9]{64}$/u);
    expect(legacy.binarySha256).toBeUndefined();
    expect(legacy.binaryIdentityVerified).toBe(false);
  });

  it("looks up an existing verified PDF by exact bytes before replay processing", async () => {
    const service = createService();
    const pdfBytes = Buffer.from("%PDF-1.7\nverified-calendar", "utf8");
    const created = await service.createPdfSource({
      ...validPdfInput,
      fileSize: pdfBytes.byteLength,
      pdfData: pdfBytes
    });

    await expect(service.findVerifiedPdfSourceForBytes("sample-university-1", pdfBytes)).resolves.toMatchObject({
      id: created.id,
      binaryIdentityVerified: true,
      binarySha256: created.fileHash
    });
    await expect(service.findVerifiedPdfSourceForBytes(
      "sample-university-1",
      Buffer.from("%PDF-1.7\nother-calendar", "utf8")
    )).resolves.toBeNull();
  });

  it("reuses one PDF source when identical binary creation races", async () => {
    const service = createService();
    const pdfBytes = Buffer.from("%PDF-1.7\nconcurrent-calendar", "utf8");
    const input = { ...validPdfInput, fileSize: pdfBytes.byteLength, pdfData: pdfBytes };

    const [left, right] = await Promise.all([
      service.createOrReusePdfSource(input),
      service.createOrReusePdfSource(input)
    ]);

    expect(left.id).toBe(right.id);
  });

  it("rejects changed bytes before mutating a verified PDF processing record", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const pdfBytes = Buffer.from("%PDF-1.7\nverified-calendar", "utf8");
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileSize: pdfBytes.byteLength,
      pdfData: pdfBytes
    });

    await expect(service.processPdfSource(source.id, {
      pdfData: Buffer.from("%PDF-1.7\nchanged-calendar", "utf8")
    })).rejects.toThrow("does not match the source identity");
    await expect(repository.findPdfSourceById(source.id)).resolves.toMatchObject({ parseStatus: "pending" });
  });

  it("keeps generation and active snapshot ownership out of generic repository updates", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const source = await service.createPdfSource(validPdfInput);

    await repository.updatePdfSource(source.id, {
      version: 99,
      activeExtractedEventIds: ["smuggled-event"]
    } as never);

    await expect(repository.findPdfSourceById(source.id)).resolves.toMatchObject({
      version: 1,
      activeExtractedEventIds: []
    });
  });

  it("clears a stale parse error when a new processing generation is claimed", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const source = await service.createPdfSource(validPdfInput);
    await repository.updatePdfSource(source.id, { parseStatus: "failed", parseError: "old failure" });

    const claimed = await repository.beginPdfProcessing(source.id);

    expect(claimed).toMatchObject({ version: 2, parseStatus: "processing" });
    expect(claimed?.parseError).toBeUndefined();
  });

  it("rejects binary content that is not actually a PDF", async () => {
    const service = createService();

    await expect(service.createPdfSource({
      ...validPdfInput,
      fileSize: Buffer.byteLength("not a PDF", "utf8"),
      pdfData: Buffer.from("not a PDF", "utf8")
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("replays extracted events without duplicates and preserves an unchanged human review", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const source = await service.createPdfSource(validPdfInput);
    const first = await service.processPdfSource(source.id);
    const reviewed = await service.approveExtractedEvent(first.extractedEvents[0]!.id, "admin-1");
    await service.updateExtractedEvent(reviewed.id, {
      normalizedTitle: "Admin tarafindan duzeltilen baslik",
      adminNote: "Kontrol edildi"
    });

    const replay = await service.processPdfSource(source.id);
    const replayedReviewedEvent = replay.extractedEvents.find((event) => event.id === reviewed.id);

    expect(replay.extractedEvents.map((event) => event.id)).toEqual(first.extractedEvents.map((event) => event.id));
    expect(await repository.listExtractedEvents({ pdfSourceId: source.id, limit: 20, offset: 0 })).toHaveLength(2);
    expect(replayedReviewedEvent).toMatchObject({
      status: "approved",
      normalizedTitle: "Admin tarafindan duzeltilen baslik",
      adminNote: "Kontrol edildi",
      reviewedBy: "admin-1"
    });
  });

  it("reuses deterministic semantic events observed in another PDF revision", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const firstSource = await service.createPdfSource({
      ...validPdfInput,
      fileName: "calendar-revision-1.pdf",
      fileSize: Buffer.byteLength("%PDF revision one", "utf8"),
      pdfData: Buffer.from("%PDF revision one", "utf8")
    });
    const secondSource = await service.createPdfSource({
      ...validPdfInput,
      fileName: "calendar-revision-2.pdf",
      fileSize: Buffer.byteLength("%PDF revision two", "utf8"),
      pdfData: Buffer.from("%PDF revision two", "utf8")
    });

    const first = await service.processPdfSource(firstSource.id);
    const second = await service.processPdfSource(secondSource.id);

    expect(second.extractedEvents.map((event) => event.id)).toEqual(first.extractedEvents.map((event) => event.id));
    expect(await repository.listExtractedEvents({ universityId: validPdfInput.universityId, limit: 20, offset: 0 })).toHaveLength(2);
    expect((await repository.listExtractedEvents({ pdfSourceId: secondSource.id, limit: 20, offset: 0 })).map((event) => event.id))
      .toEqual(expect.arrayContaining(first.extractedEvents.map((event) => event.id)));
    expect(second.extractedEvents.every((event) => (
      event.observedPdfSourceIds?.includes(firstSource.id)
      && event.observedPdfSourceIds.includes(secondSource.id)
    ))).toBe(true);
  });

  it("creates a new extraction revision without mutating prior human review provenance", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const source = await service.createPdfSource({
      ...validPdfInput,
      rawText: "15-19 Eylul 2026 Guz Donemi Ders Kayitlari"
    });
    const first = await service.processPdfSource(source.id);
    const reviewed = await service.approveExtractedEvent(first.extractedEvents[0]!.id, "admin-1");
    await service.updateExtractedEvent(reviewed.id, { adminNote: "Eski kanit" });
    await repository.updatePdfSource(source.id, {
      rawText: "15-19 Eylul 2026 Guz Donemi Ders Kayitlari Guncellendi"
    });

    const replay = await service.processPdfSource(source.id);

    expect(replay.extractedEvents).toHaveLength(1);
    expect(replay.extractedEvents[0]).toMatchObject({
      status: "pending_review",
      normalizedTitle: "Guz Donemi Ders Kayitlari Guncellendi"
    });
    expect(replay.extractedEvents[0]?.id).not.toBe(reviewed.id);
    expect(replay.extractedEvents[0]?.adminNote).toBeUndefined();
    expect(replay.extractedEvents[0]?.reviewedBy).toBeUndefined();
    expect(replay.extractedEvents[0]?.reviewedAt).toBeUndefined();
    expect(await repository.findExtractedEventById(reviewed.id)).toEqual(expect.objectContaining({
      status: "approved",
      adminNote: "Eski kanit",
      reviewedBy: "admin-1"
    }));
    expect(await repository.listExtractedEvents({ pdfSourceId: source.id, limit: 20, offset: 0 })).toHaveLength(1);
  });

  it("revives the original semantic identity without duplicates across an A-to-C-to-A replay", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const originalText = "15-19 Eylul 2026 Guz Donemi Ders Kayitlari";
    const source = await service.createPdfSource({ ...validPdfInput, rawText: originalText });

    const first = await service.processPdfSource(source.id);
    await repository.updatePdfSource(source.id, { rawText: `${originalText} Guncellendi` });
    const changed = await service.processPdfSource(source.id);
    await repository.updatePdfSource(source.id, { rawText: originalText });
    const restored = await service.processPdfSource(source.id);

    expect(changed.extractedEvents[0]?.id).not.toBe(first.extractedEvents[0]?.id);
    expect(restored.extractedEvents[0]?.id).toBe(first.extractedEvents[0]?.id);
    const activeEvents = await repository.listExtractedEvents({ pdfSourceId: source.id, limit: 20, offset: 0 });
    expect(activeEvents).toHaveLength(1);
    expect(activeEvents[0]?.id).toBe(first.extractedEvents[0]?.id);
    expect(await repository.findExtractedEventById(changed.extractedEvents[0]!.id)).toEqual(expect.objectContaining({
      status: "pending_review"
    }));
  });

  it("keeps unchanged reviewed events approved when a new leading row shifts candidate positions", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const originalText = [
      "15-19 Eylul 2026 Guz Donemi Ders Kayitlari",
      "05-16 Ocak 2027 Guz Donemi Final Sinavlari"
    ].join("\n");
    const source = await service.createPdfSource({ ...validPdfInput, rawText: originalText });
    const first = await service.processPdfSource(source.id);
    for (const event of first.extractedEvents) await service.approveExtractedEvent(event.id, "admin-1");

    await repository.updatePdfSource(source.id, {
      rawText: `01 Eylul 2026 Oryantasyon\n${originalText}`
    });
    const replay = await service.processPdfSource(source.id);

    expect(replay.extractedEvents).toHaveLength(3);
    expect(replay.extractedEvents.filter((event) => event.status === "approved").map((event) => event.id).sort())
      .toEqual(first.extractedEvents.map((event) => event.id).sort());
    expect(replay.extractedEvents.filter((event) => event.status === "pending_review")).toHaveLength(1);
    expect(replay.extractedEvents.filter((event) => event.status === "approved").every((event) => event.reviewedBy === "admin-1"))
      .toBe(true);
  });

  it("retains the last extraction snapshot when one replay yields no trusted events", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const source = await service.createPdfSource({
      ...validPdfInput,
      rawText: "15-19 Eylul 2026 Guz Donemi Ders Kayitlari"
    });
    const first = await service.processPdfSource(source.id);
    await service.approveExtractedEvent(first.extractedEvents[0]!.id, "admin-1");
    await repository.updatePdfSource(source.id, {
      rawText: "AKADEMIK TAKVIM HAKKINDA GENEL BILGILENDIRME NOTU"
    });

    const replay = await service.processPdfSource(source.id);

    expect(replay.pdfSource).toMatchObject({
      parseStatus: "failed",
      parseError: expect.stringContaining("previous snapshot was retained")
    });
    expect(replay.extractedEvents).toEqual([
      expect.objectContaining({ id: first.extractedEvents[0]?.id, status: "approved", reviewedBy: "admin-1" })
    ]);
    expect(await repository.listExtractedEvents({ pdfSourceId: source.id, limit: 20, offset: 0 }))
      .toEqual(replay.extractedEvents);
  });

  it("marks an unexpected write failure while retaining the previous active snapshot", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const source = await service.createPdfSource({
      ...validPdfInput,
      rawText: "15 Eylul 2026 Onceki Guvenilir Ders Kayitlari"
    });
    const previous = await service.processPdfSource(source.id);
    await repository.updatePdfSource(source.id, {
      rawText: "16 Eylul 2026 Yeni Ders Kayitlari"
    });
    vi.spyOn(repository, "createExtractedEvents").mockRejectedValueOnce(new Error("SIMULATED_EVENT_WRITE_FAILURE"));

    await expect(service.processPdfSource(source.id)).rejects.toThrow("SIMULATED_EVENT_WRITE_FAILURE");

    await expect(repository.findPdfSourceById(source.id)).resolves.toMatchObject({
      parseStatus: "failed",
      parseError: "SIMULATED_EVENT_WRITE_FAILURE",
      activeExtractedEventIds: previous.extractedEvents.map((event) => event.id)
    });
    await expect(repository.listExtractedEvents({ pdfSourceId: source.id, limit: 20, offset: 0 }))
      .resolves.toEqual(previous.extractedEvents);
  });

  it("fences an older slow processing generation from replacing a newer active snapshot", async () => {
    const repository = new InMemoryPdfRepository();
    let ocrCallCount = 0;
    let signalFirstStarted: (() => void) | undefined;
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => { signalFirstStarted = resolve; });
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const service = new PdfProcessingService(repository, {
      async extractText() {
        ocrCallCount += 1;
        if (ocrCallCount === 1) {
          signalFirstStarted?.();
          await firstRelease;
          return { provider: "slow_ocr", text: "15 Eylul 2026 Eski Nesil Ders Kayitlari" };
        }
        return { provider: "fast_ocr", text: "16 Eylul 2026 Yeni Nesil Ders Kayitlari" };
      }
    });
    const { rawText: _rawText, ...inputWithoutText } = validPdfInput;
    void _rawText;
    const source = await service.createPdfSource(inputWithoutText);

    const slow = service.processPdfSource(source.id);
    await firstStarted;
    const newer = await service.processPdfSource(source.id);
    releaseFirst?.();

    await expect(slow).rejects.toBeInstanceOf(ConflictException);
    expect(newer.extractedEvents).toEqual([expect.objectContaining({ normalizedTitle: "Yeni Nesil Ders Kayitlari" })]);
    await expect(repository.findPdfSourceById(source.id)).resolves.toMatchObject({
      version: 3,
      parseStatus: "processed",
      ocrProvider: "fast_ocr",
      activeExtractedEventIds: newer.extractedEvents.map((event) => event.id)
    });
  });

  it("loads every event in a 101-row processed snapshot for retry and PDF draft creation", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const pdfData = Buffer.from("%PDF-1.7\nlarge-calendar-fixture", "utf8");
    const lines = Array.from({ length: 101 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 8, 1 + index));
      const day = String(date.getUTCDate()).padStart(2, "0");
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      return `${day}.${month}.${date.getUTCFullYear()} Ders Kayit Islemi Kod${String(index).padStart(3, "0")}`;
    });
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "large-calendar.pdf",
      fileSize: pdfData.byteLength,
      pdfData,
      rawText: lines.join("\n")
    });
    const processed = await service.processPdfSource(source.id);
    expect(processed.extractedEvents).toHaveLength(101);
    for (const event of processed.extractedEvents) await service.approveExtractedEvent(event.id, "admin-1");

    const replay = await service.loadCompleteExtractedEventSnapshot(source.id);
    expect(replay.extractedEvents).toHaveLength(101);
    const calendarService = new AdminCalendarService(new InMemoryCalendarRepository(), repository);
    const draft = await calendarService.createDraftFromApprovedExtractedEvents({
      universityId: source.universityId,
      academicYear: source.academicYear,
      title: "Large PDF calendar",
      sourcePdfId: source.id,
      createdBy: "admin-1"
    });
    expect(draft.events).toHaveLength(101);
  });

  it("distinguishes an initialized empty snapshot from a legacy source without a pointer", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const source = await service.createPdfSource(validPdfInput);

    expect(source.activeExtractedEventIds).toEqual([]);
    const processed = await service.processPdfSource(source.id);
    expect(processed.extractedEvents).toHaveLength(2);

    const storedSource = pdfSourceStore(repository).get(source.id);
    if (!storedSource) throw new Error("Expected stored PDF source.");
    delete storedSource.activeExtractedEventIds;
    await expect(repository.listExtractedEvents({ pdfSourceId: source.id, limit: 20, offset: 0 }))
      .resolves.toHaveLength(2);
    await expect(repository.listExtractedEvents({ universityId: source.universityId, limit: 20, offset: 0 }))
      .resolves.toHaveLength(2);

    storedSource.activeExtractedEventIds = [];
    await expect(repository.listExtractedEvents({ pdfSourceId: source.id, limit: 20, offset: 0 }))
      .resolves.toEqual([]);
    await expect(repository.listExtractedEvents({ universityId: source.universityId, limit: 20, offset: 0 }))
      .resolves.toEqual([]);
  });

  it("does not list rows staged before an extraction loop fails", async () => {
    const repository = new MidLoopFailingPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const source = await service.createPdfSource(validPdfInput);

    await expect(service.processPdfSource(source.id)).rejects.toThrow("SIMULATED_EVENT_WRITE_FAILURE");
    expect(extractedEventStore(repository).size).toBe(1);
    await expect(repository.listExtractedEvents({ pdfSourceId: source.id, limit: 20, offset: 0 }))
      .resolves.toEqual([]);
    await expect(repository.listExtractedEvents({ universityId: source.universityId, limit: 20, offset: 0 }))
      .resolves.toEqual([]);
  });

  it("does not list a complete staged set when snapshot pointer activation fails", async () => {
    const repository = new PointerFailingPdfRepository();
    const service = new PdfProcessingService(repository, { async extractText() { return null; } });
    const source = await service.createPdfSource(validPdfInput);

    await expect(service.processPdfSource(source.id))
      .rejects.toThrow("PDF_EXTRACTED_EVENT_SNAPSHOT_ACTIVATION_FAILED");
    expect(extractedEventStore(repository).size).toBe(2);
    await expect(repository.listExtractedEvents({ pdfSourceId: source.id, limit: 20, offset: 0 }))
      .resolves.toEqual([]);
    await expect(repository.listExtractedEvents({ universityId: source.universityId, limit: 20, offset: 0 }))
      .resolves.toEqual([]);
  });

  it("keeps an unprovable source date missing and pending instead of using fetch or creation time", async () => {
    const service = createService();
    const source = await service.createPdfSource({
      ...validPdfInput,
      fileName: "calendar-downloaded-2026-09-04.pdf",
      rawText: "Ders Kayitlari 35.19.2026"
    });

    const result = await service.processPdfSource(source.id);

    expect(result.extractedEvents).toHaveLength(1);
    expect(result.extractedEvents[0]).toMatchObject({
      datePrecision: "unknown",
      status: "pending_review"
    });
    expect(result.extractedEvents[0]?.startDate).toBeUndefined();
    expect(result.extractedEvents[0]?.endDate).toBeUndefined();
    expect(result.extractedEvents[0]?.originalDateText).not.toContain("fallback");
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
        sourcePage: 1,
        studentRelevance: "relevant",
        topic: "course_registration",
        deadline: "unknown",
        classificationVersion: "student-relevance-rules-v2"
      })
    );
    expect(result.extractedEvents[0]?.evidenceSpans).not.toHaveLength(0);
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

class MidLoopFailingPdfRepository extends InMemoryPdfRepository {
  override async createExtractedEvents(
    input: Parameters<InMemoryPdfRepository["createExtractedEvents"]>[0]
  ): ReturnType<InMemoryPdfRepository["createExtractedEvents"]> {
    const first = input[0];
    if (first) await super.createExtractedEvents([first]);
    throw new Error("SIMULATED_EVENT_WRITE_FAILURE");
  }
}

class PointerFailingPdfRepository extends InMemoryPdfRepository {
  override async updatePdfSourceForGeneration(
    id: string,
    generation: number,
    input: Parameters<InMemoryPdfRepository["updatePdfSourceForGeneration"]>[2]
  ): ReturnType<InMemoryPdfRepository["updatePdfSourceForGeneration"]> {
    if (input.activeExtractedEventIds !== undefined) return null;
    return super.updatePdfSourceForGeneration(id, generation, input);
  }
}

function pdfSourceStore(repository: InMemoryPdfRepository) {
  return (repository as unknown as {
    pdfSources: Map<string, Awaited<ReturnType<InMemoryPdfRepository["findPdfSourceById"]>>>;
  }).pdfSources;
}

function extractedEventStore(repository: InMemoryPdfRepository) {
  return (repository as unknown as {
    extractedEvents: Map<string, Awaited<ReturnType<InMemoryPdfRepository["findExtractedEventById"]>>>;
  }).extractedEvents;
}
