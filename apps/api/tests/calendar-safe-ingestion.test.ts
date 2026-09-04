import { describe, expect, it, vi } from "vitest";
import {
  CalendarIngestionService,
  isAutoApprovableExtractedEvent
} from "../src/modules/calendars/calendar-ingestion.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import type { AcademicCalendarRecord } from "../src/modules/calendars/calendar.types.js";
import { AdminCalendarService } from "../src/modules/calendars/admin-calendar.service.js";
import { academicTemporalFields, toAcademicEventDto } from "../src/modules/calendars/calendar-temporal.js";
import { classifyStudentRelevance } from "../src/domain/student-relevance-classifier.js";
import type { UniversityRecord } from "../src/modules/catalog/catalog.types.js";
import type { ExtractedEventRecord } from "../src/modules/pdf/pdf.types.js";
import { InMemoryPdfRepository } from "../src/modules/pdf/in-memory-pdf.repository.js";
import { PdfProcessingService } from "../src/modules/pdf/pdf-processing.service.js";
import { setSafeOutboundRequestDependenciesForTesting } from "../src/common/network/safe-outbound-request.js";
import type { SourceAuthorityContext } from "../src/domain/source-authority-enforcement.js";

describe("safe calendar ingestion", () => {
  it("leaves lifecycle ownership to the dedicated worker", () => {
    const prototype = CalendarIngestionService.prototype as CalendarIngestionService & {
      onApplicationBootstrap?: unknown;
      onModuleDestroy?: unknown;
    };

    expect(prototype.onApplicationBootstrap).toBeUndefined();
    expect(prototype.onModuleDestroy).toBeUndefined();
    expect(prototype.runScheduledCycle).toBeTypeOf("function");
  });

  it("auto-approves only high-confidence events with explicit parsed date evidence", () => {
    const explicit = extractedEvent({
      confidenceScore: 90,
      datePrecision: "day",
      originalDateText: "15 Eylul 2026 Guz Donemi Baslangici",
      rawText: "15 Eylul 2026 Guz Donemi Baslangici",
      sourcePage: 1,
      startDate: new Date("2026-09-15T00:00:00.000Z")
    });

    expect(isAutoApprovableExtractedEvent(explicit)).toBe(true);
    expect(isAutoApprovableExtractedEvent({ ...explicit, status: "approved" })).toBe(false);
    expect(isAutoApprovableExtractedEvent({ ...explicit, status: "rejected" })).toBe(false);
    expect(isAutoApprovableExtractedEvent({ ...explicit, confidenceScore: 89 })).toBe(false);
    expect(isAutoApprovableExtractedEvent({ ...explicit, datePrecision: "unknown" })).toBe(false);
    expect(isAutoApprovableExtractedEvent({ ...explicit, originalDateText: "" })).toBe(false);
    expect(isAutoApprovableExtractedEvent({ ...explicit, rawText: "" })).toBe(false);
    expect(isAutoApprovableExtractedEvent({ ...explicit, sourcePage: 0 })).toBe(false);
    const withoutStartDate = { ...explicit };
    delete withoutStartDate.startDate;
    expect(isAutoApprovableExtractedEvent(withoutStartDate)).toBe(false);
    expect(isAutoApprovableExtractedEvent({
      ...explicit,
      confidenceScore: 99,
      originalDateText: "Document publication date fallback: 2026-09-15"
    })).toBe(false);
    expect(isAutoApprovableExtractedEvent({
      ...explicit,
      confidenceScore: 99,
      originalDateText: "unknown"
    })).toBe(false);
    expect(isAutoApprovableExtractedEvent({
      ...explicit,
      confidenceScore: 99,
      rawText: "Guz Donemi Baslangici"
    })).toBe(false);
  });

  it("runs scheduled ingestion in source-only repair mode", async () => {
    const service = new CalendarIngestionService(
      { listUniversities: async () => [universityRecord()] } as never,
      new InMemoryCalendarRepository(),
      {} as never,
      {} as never
    );
    const ingest = vi.spyOn(service, "ingestUniversityCalendar").mockResolvedValue({
      universityId: "university-1",
      universityName: "Example University",
      status: "source_not_found",
      eventCount: 0
    });

    await service.runScheduledCycle();

    expect(ingest).toHaveBeenCalledWith("university-1", undefined, { retrySourceOnly: true });
  });

  it("repairs multiple published snapshots while keeping the newest usable calendar", async () => {
    const calendars = new InMemoryCalendarRepository();
    const oldCalendar = await seedPublishedCalendar(calendars, { version: 1, includeEvent: true });
    const currentCalendar = await seedPublishedCalendar(calendars, { version: 2, includeEvent: true });
    const service = calendarIngestionService(calendars);

    const result = await service.ingestUniversityCalendar("university-1", "2026-2027");

    expect(result).toMatchObject({ status: "existing", eventCount: 1 });
    expect((await calendars.findCalendarById(currentCalendar.id))?.status).toBe("published");
    expect((await calendars.findCalendarById(oldCalendar.id))?.status).toBe("archived");
    expect((await calendars.listEventsByCalendar(oldCalendar.id))[0]?.status).toBe("archived");
  });

  it.each([
    { caseName: "unit-specific", title: "Muhendislik Fakultesi Akademik Takvimi", includeEvent: true },
    { caseName: "empty", title: "Example University Academic Calendar", includeEvent: false }
  ])("retries discovery while preserving a usable fallback for a newer $caseName snapshot", async ({ title, includeEvent }) => {
    const calendars = new InMemoryCalendarRepository();
    const university = atuUniversityRecord();
    const fallback = await seedPublishedCalendar(calendars, { universityId: university.id, version: 1, includeEvent: true });
    const unusable = await seedPublishedCalendar(calendars, { universityId: university.id, version: 2, title, includeEvent });
    const service = calendarIngestionService(calendars, university);
    const requestHop = vi.fn(async () => ({
      status: 503,
      headers: { "content-type": "text/plain" },
      body: Buffer.from("temporarily unavailable", "utf8"),
      remoteAddress: "93.184.216.34"
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop
    });

    try {
      const firstResult = await service.ingestUniversityCalendar(university.id, "2026-2027", { retrySourceOnly: true });
      const secondResult = await service.ingestUniversityCalendar(university.id, "2026-2027", { retrySourceOnly: true });

      expect(firstResult.status).toBe("failed");
      expect(secondResult.status).toBe("failed");
      expect(requestHop).toHaveBeenCalledTimes(4);
      expect((await calendars.findCalendarById(unusable.id))?.status).toBe("archived");
      expect((await calendars.findCalendarById(fallback.id))?.status).toBe("published");
    } finally {
      setSafeOutboundRequestDependenciesForTesting(undefined);
    }
  });

  it("does not let a concurrently published unusable snapshot archive the last usable fallback", async () => {
    const calendars = new InMemoryCalendarRepository();
    const university = atuUniversityRecord();
    const fallback = await seedPublishedCalendar(calendars, { universityId: university.id, version: 1, includeEvent: true });
    const firstUnusable = await seedPublishedCalendar(calendars, {
      universityId: university.id,
      version: 2,
      title: "Muhendislik Fakultesi Akademik Takvimi",
      includeEvent: true
    });
    const listPublishedCalendars = calendars.listPublishedCalendars.bind(calendars);
    let listCallCount = 0;
    let concurrentUnusable: AcademicCalendarRecord | undefined;
    vi.spyOn(calendars, "listPublishedCalendars").mockImplementation(async (input) => {
      const observed = await listPublishedCalendars(input);
      listCallCount += 1;
      if (listCallCount === 1) {
        concurrentUnusable = await seedPublishedCalendar(calendars, {
          universityId: university.id,
          version: 3,
          title: "Tip Fakultesi Akademik Takvimi",
          includeEvent: true
        });
      }
      return observed;
    });
    const service = calendarIngestionService(calendars, university);
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop: async () => ({
        status: 503,
        headers: { "content-type": "text/plain" },
        body: Buffer.from("temporarily unavailable", "utf8"),
        remoteAddress: "93.184.216.34"
      })
    });

    try {
      const result = await service.ingestUniversityCalendar(university.id, "2026-2027", { retrySourceOnly: true });

      expect(result.status).toBe("failed");
      expect((await calendars.findCalendarById(fallback.id))?.status).toBe("published");
      expect((await calendars.findCalendarById(firstUnusable.id))?.status).toBe("archived");
      expect(concurrentUnusable).toBeDefined();
      expect((await calendars.findCalendarById(concurrentUnusable!.id))?.status).toBe("archived");
    } finally {
      setSafeOutboundRequestDependenciesForTesting(undefined);
    }
  });

  it("activates a successfully fetched replacement only after keeping the fallback visible", async () => {
    const calendars = new InMemoryCalendarRepository();
    const university = atuUniversityRecord();
    const fallback = await seedPublishedCalendar(calendars, { universityId: university.id, version: 1, includeEvent: true });
    const unusable = await seedPublishedCalendar(calendars, {
      universityId: university.id,
      version: 2,
      title: "Muhendislik Fakultesi Akademik Takvimi",
      includeEvent: true
    });
    const adminCalendarService = new AdminCalendarService(calendars, new InMemoryPdfRepository());
    const service = calendarIngestionService(calendars, university, adminCalendarService);
    const requestHop = vi.fn(async (url: string) => (
      url.includes("V_AkademikTakvim")
        ? {
            status: 200,
            headers: { "content-type": "application/json" },
            body: Buffer.from(JSON.stringify({
              d: [{
                ID: 1,
                DonemAciklama: "Guz",
                Aciklama: "Ders kayitlari",
                BaslamaTarihi: `/Date(${Date.UTC(2026, 8, 15)})/`,
                BitisTarihi: `/Date(${Date.UTC(2026, 8, 19)})/`,
                AdTR: "Ders Kayitlari",
                Yil: 2026,
                Durum: 1
              }]
            }), "utf8"),
            remoteAddress: "93.184.216.34"
          }
        : {
            status: 503,
            headers: { "content-type": "text/plain" },
            body: Buffer.from("calendar page unavailable", "utf8"),
            remoteAddress: "93.184.216.34"
          }
    ));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop
    });

    try {
      const result = await service.ingestUniversityCalendar(university.id, "2026-2027", { retrySourceOnly: true });
      const active = await calendars.findPublishedCalendar(university.id, "2026-2027");
      const replay = await service.ingestUniversityCalendar(university.id, "2026-2027", { retrySourceOnly: true });
      const activeAfterReplay = await calendars.findPublishedCalendar(university.id, "2026-2027");

      expect(result).toMatchObject({ status: "published", eventCount: 1 });
      expect(replay).toMatchObject({ status: "existing", eventCount: 1 });
      expect(requestHop).toHaveBeenCalledTimes(4);
      expect(active?.id).not.toBe(fallback.id);
      expect(active?.id).not.toBe(unusable.id);
      expect(active?.sourceUrl).toContain("V_AkademikTakvim");
      expect(activeAfterReplay?.id).toBe(active?.id);
      expect((await calendars.findCalendarById(fallback.id))?.status).toBe("archived");
      expect((await calendars.findCalendarById(unusable.id))?.status).toBe("archived");
    } finally {
      setSafeOutboundRequestDependenciesForTesting(undefined);
    }
  });

  it("keeps the only source-only snapshot when its replacement fetch fails", async () => {
    const calendars = new InMemoryCalendarRepository();
    const sourceOnly = await seedPublishedCalendar(calendars, { version: 1, includeEvent: false });
    const service = calendarIngestionService(calendars);
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop: async () => ({
        status: 404,
        headers: { "content-type": "text/html" },
        body: Buffer.from("not found", "utf8"),
        remoteAddress: "93.184.216.34"
      })
    });

    try {
      const result = await service.ingestUniversityCalendar("university-1", "2026-2027", { retrySourceOnly: true });

      expect(result.status).not.toBe("existing");
      expect((await calendars.findCalendarById(sourceOnly.id))?.status).toBe("published");
    } finally {
      setSafeOutboundRequestDependenciesForTesting(undefined);
    }
  });

  it("reuses all 101 active events when a processed PDF is retried", async () => {
    const university = atuUniversityRecord();
    const pdfRepository = new InMemoryPdfRepository();
    const pdfService = new PdfProcessingService(pdfRepository, { async extractText() { return null; } });
    const pdfData = Buffer.from("%PDF-1.7\nprocessed-retry-fixture", "utf8");
    const rawText = Array.from({ length: 101 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 8, 1 + index));
      return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${date.getUTCFullYear()} Ders Kayit Islemi Kod${String(index).padStart(3, "0")}`;
    }).join("\n");
    const source = await pdfService.createPdfSource({
      universityId: university.id,
      fileName: "large-calendar.pdf",
      mimeType: "application/pdf",
      magicBytesHex: pdfData.subarray(0, 8).toString("hex"),
      fileSize: pdfData.byteLength,
      pageCount: 2,
      academicYear: "2026-2027",
      uploadedBy: "system-calendar-ingestion",
      pdfData,
      rawText
    });
    const processed = await pdfService.processPdfSource(source.id);
    expect(processed.extractedEvents).toHaveLength(101);
    const processPdfSource = vi.spyOn(pdfService, "processPdfSource");
    const loadCompleteSnapshot = vi.spyOn(pdfService, "loadCompleteExtractedEventSnapshot");
    const calendars = new InMemoryCalendarRepository();
    const admin = new AdminCalendarService(calendars, pdfRepository);
    const ingestion = new CalendarIngestionService(
      { findUniversityById: async () => university } as never,
      calendars,
      pdfService,
      admin
    );
    const authority: SourceAuthorityContext = {
      ownerAcademicEntityId: university.id,
      ownerUniversityId: university.id,
      resolvedOwnerAcademicEntityId: university.id,
      resolvedOwnerUniversityId: university.id,
      scopeType: "university",
      scopeId: university.id,
      authorityDomains: ["atu.edu.tr"]
    };
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop: async () => ({
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: pdfData,
        remoteAddress: "93.184.216.34"
      })
    });

    try {
      const result = await (ingestion as unknown as {
        ingestPdfCalendar(
          universityInput: UniversityRecord,
          pdf: { sourceUrl: string; title: string },
          requestedAcademicYear: string | undefined,
          sourceAuthority: SourceAuthorityContext
        ): ReturnType<CalendarIngestionService["ingestUniversityCalendar"]>;
      }).ingestPdfCalendar(
        university,
        { sourceUrl: "https://www.atu.edu.tr/calendar.pdf", title: "2026-2027 Akademik Takvim" },
        "2026-2027",
        authority
      );

      expect(result).toMatchObject({ status: "published", eventCount: 101 });
      expect(loadCompleteSnapshot).toHaveBeenCalledWith(source.id);
      expect(processPdfSource).not.toHaveBeenCalled();
      const publishedCalendar = await calendars.findPublishedCalendar(university.id, "2026-2027");
      expect(publishedCalendar).not.toBeNull();
      await expect(calendars.listEventsByCalendar(publishedCalendar!.id)).resolves.toHaveLength(101);
    } finally {
      setSafeOutboundRequestDependenciesForTesting(undefined);
    }
  });

  it("reports deterministic classification counts in shadow mode without changing an existing feed", async () => {
    const calendars = new InMemoryCalendarRepository();
    const calendar = await calendars.createCalendar({
      universityId: "university-1",
      academicYear: "2026-2027",
      title: "Academic calendar",
      status: "published",
      version: 1
    });
    await calendars.createEvents([{
      calendarId: calendar.id,
      universityId: "university-1",
      academicYear: "2026-2027",
      term: "fall",
      category: "course_registration",
      title: "Ders kayit yenileme",
      ...academicTemporalFields("2026-09-15"),
      timezone: "Europe/Istanbul",
      status: "published",
      notificationRules: [],
      ...classifyStudentRelevance({ title: "Ders kayit yenileme" })
    }]);
    const service = new CalendarIngestionService(
      { findUniversityById: async () => ({ id: "university-1", name: "Example University" }) } as never,
      calendars,
      {} as never,
      {} as never
    );

    const result = await service.ingestUniversityCalendar("university-1", "2026-2027");

    expect(result).toMatchObject({
      status: "existing",
      eventCount: 1,
      classificationAudit: {
        mode: "shadow",
        classificationVersion: "student-relevance-rules-v1",
        counts: { total: 1, relevant: 1, not_relevant: 0, uncertain: 0 }
      }
    });
    const [stored] = await calendars.listEventsByCalendar(calendar.id);
    expect(toAcademicEventDto(stored!)).toEqual(expect.objectContaining({
      studentRelevance: "relevant",
      topic: "course_registration",
      classificationVersion: "student-relevance-rules-v1"
    }));
  });
});

function extractedEvent(overrides: Partial<ExtractedEventRecord>): ExtractedEventRecord {
  const now = new Date("2026-09-01T00:00:00.000Z");
  return {
    id: "event-1",
    pdfSourceId: "pdf-1",
    universityId: "university-1",
    academicYear: "2026-2027",
    rawText: "15 Eylul 2026 Guz Donemi Baslangici",
    originalDateText: "15 Eylul 2026 Guz Donemi Baslangici",
    normalizedTitle: "Guz Donemi Baslangici",
    normalizedCategory: "fall_term_start",
    startDate: new Date("2026-09-15T00:00:00.000Z"),
    temporalKind: "date",
    dateOnlyStart: "2026-09-15",
    timezone: "Europe/Istanbul",
    datePrecision: "day",
    term: "fall",
    sourcePage: 1,
    confidenceScore: 90,
    status: "pending_review",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function universityRecord(): UniversityRecord {
  const now = new Date("2026-09-01T00:00:00.000Z");
  return {
    id: "university-1",
    name: "Example University",
    slug: "example-university",
    city: "Istanbul",
    type: "state",
    status: "active",
    createdAt: now,
    updatedAt: now
  };
}

function atuUniversityRecord(): UniversityRecord {
  const now = new Date("2026-09-01T00:00:00.000Z");
  return {
    id: "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi",
    name: "Adana Alparslan Turkes Bilim ve Teknoloji Universitesi",
    slug: "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi",
    city: "Adana",
    type: "state",
    websiteUrl: "https://www.atu.edu.tr/",
    status: "active",
    createdAt: now,
    updatedAt: now
  };
}

function calendarIngestionService(
  calendars: InMemoryCalendarRepository,
  university = universityRecord(),
  adminCalendarService: AdminCalendarService = {} as AdminCalendarService
): CalendarIngestionService {
  return new CalendarIngestionService(
    { findUniversityById: async () => university } as never,
    calendars,
    {} as never,
    adminCalendarService
  );
}

async function seedPublishedCalendar(
  calendars: InMemoryCalendarRepository,
  input: { universityId?: string; version: number; title?: string; includeEvent: boolean }
): Promise<AcademicCalendarRecord> {
  const universityId = input.universityId ?? "university-1";
  const calendar = await calendars.createCalendar({
    universityId,
    academicYear: "2026-2027",
    title: input.title ?? "Example University Academic Calendar",
    status: "published",
    version: input.version
  });
  if (input.includeEvent) {
    await calendars.createEvents([{
      calendarId: calendar.id,
      universityId,
      academicYear: "2026-2027",
      term: "fall",
      category: "course_registration",
      title: "Ders kayit yenileme",
      ...academicTemporalFields("2026-09-15"),
      timezone: "Europe/Istanbul",
      status: "published",
      notificationRules: []
    }]);
  }
  return calendar;
}
