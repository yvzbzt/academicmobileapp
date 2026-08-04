import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AdminCalendarService } from "../src/modules/calendars/admin-calendar.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import { InMemoryPdfRepository } from "../src/modules/pdf/in-memory-pdf.repository.js";
import { PdfProcessingService } from "../src/modules/pdf/pdf-processing.service.js";

const validPdfInput = {
  universityId: "sample-university-1",
  fileName: "publish-flow.pdf",
  mimeType: "application/pdf",
  magicBytesHex: "255044462d312e37",
  fileSize: 4096,
  pageCount: 2,
  academicYear: "2026-2027",
  uploadedBy: "admin-1",
  rawText: "15-19 Eylul 2026 Guz Donemi Ders Kayitlari\n05-16 Ocak 2027 Guz Donemi Final Sinavlari"
};

const disabledOcrService = {
  async extractText() {
    return null;
  }
};

async function createApprovedExtractedEvents() {
  const pdfRepository = new InMemoryPdfRepository();
  const pdfService = new PdfProcessingService(pdfRepository, disabledOcrService);
  const source = await pdfService.createPdfSource(validPdfInput);
  const processed = await pdfService.processPdfSource(source.id);
  for (const event of processed.extractedEvents) {
    await pdfService.approveExtractedEvent(event.id, "admin-1");
  }
  return { pdfRepository, source };
}

describe("AdminCalendarService", () => {
  it("creates a draft calendar from approved extracted events", async () => {
    const { pdfRepository, source } = await createApprovedExtractedEvents();
    const calendarRepository = new InMemoryCalendarRepository();
    const service = new AdminCalendarService(calendarRepository, pdfRepository);

    const draft = await service.createDraftFromApprovedExtractedEvents({
      universityId: source.universityId,
      academicYear: source.academicYear,
      title: "PDF'den Gelen Taslak Takvim",
      sourcePdfId: source.id,
      createdBy: "admin-1"
    });

    expect(draft.calendar.status).toBe("draft");
    expect(draft.calendar.version).toBe(1);
    expect(draft.events).toHaveLength(2);
    expect(draft.events.every((event) => event.status === "approved")).toBe(true);
  });

  it("carries a date-only start and real timestamp end through the approved draft", async () => {
    const pdfRepository = new InMemoryPdfRepository();
    const pdfService = new PdfProcessingService(pdfRepository, disabledOcrService);
    const source = await pdfService.createPdfSource({
      ...validPdfInput,
      fileName: "inverse-mixed-publish-flow.pdf",
      rawText: "Basvuru sonuclari 01.09.2026 - 03.09.2026 17:00"
    });
    const processed = await pdfService.processPdfSource(source.id);
    await pdfService.approveExtractedEvent(processed.extractedEvents[0]!.id, "admin-1");
    const service = new AdminCalendarService(new InMemoryCalendarRepository(), pdfRepository);

    const draft = await service.createDraftFromApprovedExtractedEvents({
      universityId: source.universityId,
      academicYear: source.academicYear,
      title: "Karma zaman araligi",
      sourcePdfId: source.id,
      createdBy: "admin-1"
    });

    expect(draft.events[0]).toMatchObject({
      temporalKind: "date",
      endTemporalKind: "timestamp",
      dateOnlyStart: "2026-09-01",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-09-03T14:00:00.000Z")
    });
  });

  it("publishes draft calendar and archives previous published calendar", async () => {
    const { pdfRepository, source } = await createApprovedExtractedEvents();
    const calendarRepository = new InMemoryCalendarRepository();
    const service = new AdminCalendarService(calendarRepository, pdfRepository);
    const draft = await service.createDraftFromApprovedExtractedEvents({
      universityId: source.universityId,
      academicYear: source.academicYear,
      title: "Yayina Alinacak Takvim",
      sourcePdfId: source.id,
      createdBy: "admin-1"
    });

    const published = await service.publishCalendar(draft.calendar.id, "admin-1");
    const activeCalendar = await calendarRepository.findPublishedCalendar(source.universityId, source.academicYear);

    expect(published.calendar.status).toBe("published");
    expect(published.archivedCalendarCount).toBe(0);
    expect(published.publishedEvents.every((event) => event.status === "published")).toBe(true);
    expect(activeCalendar?.id).toBe(draft.calendar.id);
  });

  it("rejects draft creation without approved extracted events", async () => {
    const pdfRepository = new InMemoryPdfRepository();
    const pdfService = new PdfProcessingService(pdfRepository, disabledOcrService);
    const source = await pdfService.createPdfSource(validPdfInput);
    await pdfService.processPdfSource(source.id);
    const service = new AdminCalendarService(new InMemoryCalendarRepository(), pdfRepository);

    await expect(
      service.createDraftFromApprovedExtractedEvents({
        universityId: source.universityId,
        academicYear: source.academicYear,
        title: "Eksik Onayli Takvim",
        sourcePdfId: source.id,
        createdBy: "admin-1"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rolls back a published calendar by archiving its events", async () => {
    const { pdfRepository, source } = await createApprovedExtractedEvents();
    const calendarRepository = new InMemoryCalendarRepository();
    const service = new AdminCalendarService(calendarRepository, pdfRepository);
    const draft = await service.createDraftFromApprovedExtractedEvents({
      universityId: source.universityId,
      academicYear: source.academicYear,
      title: "Rollback Test Takvimi",
      sourcePdfId: source.id,
      createdBy: "admin-1"
    });
    await service.publishCalendar(draft.calendar.id, "admin-1");

    const rolledBack = await service.rollbackCalendar(draft.calendar.id);
    const events = await calendarRepository.listEventsByCalendar(draft.calendar.id);

    expect(rolledBack.status).toBe("archived");
    expect(events.every((event) => event.status === "archived")).toBe(true);
  });
});
