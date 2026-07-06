import { describe, expect, it, vi, afterEach } from "vitest";
import { mapAcademicEventCategory } from "../../apps/api/src/domain/category-mapper.js";
import { normalizeAcademicDate } from "../../apps/api/src/domain/date-normalizer.js";
import { CalendarIngestionService, inferAcademicYear, isAcceptableAcademicYear } from "../../apps/api/src/modules/calendars/calendar-ingestion.service.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarRepository } from "../../apps/api/src/modules/calendars/calendar.types.js";
import type { CatalogRepository, DepartmentRecord, FacultyRecord, UniversityRecord } from "../../apps/api/src/modules/catalog/catalog.types.js";
import { PdfProcessingService } from "../../apps/api/src/modules/pdf/pdf-processing.service.js";
import type { ExtractedEventRecord, ExtractedEventStatus, PdfRepository, PdfSourceRecord } from "../../apps/api/src/modules/pdf/pdf.types.js";

const originalFetch = globalThis.fetch;
const disabledOcrService = {
  async extractText() {
    return null;
  }
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("academic calendar extraction", () => {
  it("normalizes Turkish textual date ranges", () => {
    expect(normalizeAcademicDate("Ders kayıtları 01-05 Eylül 2025")).toMatchObject({
      startDate: "2025-09-01",
      endDate: "2025-09-05",
      datePrecision: "date_range"
    });

    expect(normalizeAcademicDate("Yaz okulu başvuruları 1 Ağustos - 15 Eylül 2025")).toMatchObject({
      startDate: "2025-08-01",
      endDate: "2025-09-15",
      term: "summer"
    });
  });

  it("maps Turkish academic calendar text to supported categories", () => {
    expect(mapAcademicEventCategory("Ders kayıtları başlama tarihi")).toBe("course_registration");
    expect(mapAcademicEventCategory("Yatay geçiş başvuru tarihleri")).toBe("horizontal_transfer");
    expect(mapAcademicEventCategory("Katkı payı ve harç ödeme dönemi")).toBe("tuition_payment");
  });

  it("extracts events from text-backed PDF sources", async () => {
    const repository = new FakePdfRepository();
    const service = new PdfProcessingService(repository, disabledOcrService);
    const source = await service.createPdfSource({
      universityId: "atu",
      fileName: "akademik-takvim.pdf",
      mimeType: "application/pdf",
      magicBytesHex: "255044462d312e37",
      fileSize: 2048,
      pageCount: 1,
      academicYear: "2025-2026",
      uploadedBy: "test",
      rawText: "Ders kayıtları 01-05 Eylül 2025\nAra sınavlar 10 Kasım 2025"
    });

    const processed = await service.processPdfSource(source.id);

    expect(processed.extractedEvents).toHaveLength(2);
    expect(processed.extractedEvents[0]).toMatchObject({
      normalizedCategory: "course_registration",
      startDate: new Date("2025-09-01T00:00:00.000Z"),
      endDate: new Date("2025-09-05T23:59:59.000Z")
    });
    expect(processed.extractedEvents[1]).toMatchObject({
      normalizedCategory: "midterm_exam",
      startDate: new Date("2025-11-10T00:00:00.000Z")
    });
  });

  it("ignores date-only empty rows from PDF tables", async () => {
    const repository = new FakePdfRepository();
    const service = new PdfProcessingService(repository, disabledOcrService);
    const source = await service.createPdfSource({
      universityId: "atu",
      fileName: "akademik-takvim.pdf",
      mimeType: "application/pdf",
      magicBytesHex: "255044462d312e37",
      fileSize: 2048,
      pageCount: 1,
      academicYear: "2025-2026",
      uploadedBy: "test",
      rawText: "01.09.2025\nDers kayıtları 01-05 Eylül 2025"
    });

    const processed = await service.processPdfSource(source.id);

    expect(processed.extractedEvents).toHaveLength(1);
    expect(processed.extractedEvents[0]?.normalizedTitle).toContain("Ders");
  });

  it("marks image-only PDF text extraction as OCR required", async () => {
    const repository = new FakePdfRepository();
    const service = new PdfProcessingService(repository, disabledOcrService);
    const source = await service.createPdfSource({
      universityId: "mtu",
      fileName: "akademik-takvim.pdf",
      mimeType: "application/pdf",
      magicBytesHex: "255044462d312e37",
      fileSize: 2048,
      pageCount: 7,
      academicYear: "2026-2027",
      uploadedBy: "test",
      rawText: "-- 1 of 7 --\n-- 2 of 7 --\n-- 3 of 7 --"
    });

    const processed = await service.processPdfSource(source.id);

    expect(processed.pdfSource.parseStatus).toBe("ocr_required");
    expect(processed.extractedEvents).toHaveLength(0);
  });
});

describe("CalendarIngestionService", () => {
  it("normalizes and bounds inferred academic years", () => {
    expect(inferAcademicYear(["/uploads/akademik_takvim/2026/2025_2026Akademik_Takvim.pdf"])).toBe("2025-2026");
    expect(inferAcademicYear(["2026-2027 Akademik Takvim", "2027-2028 yatay geÃ§iÅŸ duyurusu"])).toBe("2026-2027");
    expect(isAcceptableAcademicYear("2027-2028", new Date("2026-07-02T00:00:00.000Z"))).toBe(false);
  });

  it("publishes Adana ATU OData calendar rows when no calendar exists", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      d: [
        {
          ID: 1,
          DonemAciklama: "Güz Dönemi",
          Aciklama: "Öğrenci işleri takvimi",
          BaslamaTarihi: `/Date(${Date.UTC(2025, 8, 1)})/`,
          BitisTarihi: `/Date(${Date.UTC(2025, 8, 5)})/`,
          AdTR: "Ders kayıtları",
          Yil: 2025,
          Durum: 1
        }
      ]
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

    const calendarRepository = new FakeCalendarRepository();
    const service = new CalendarIngestionService(
      new FakeCatalogRepository(),
      calendarRepository,
      {} as PdfProcessingService,
      {} as never
    );

    const result = await service.ingestUniversityCalendar("atu");
    const published = await calendarRepository.findPublishedCalendar("atu", "2025-2026");
    const events = await calendarRepository.listPublishedEvents({ universityId: "atu", limit: 10, offset: 0 });

    expect(result).toMatchObject({ status: "published", academicYear: "2025-2026", eventCount: 1 });
    expect(published?.sourceUrl).toContain("odata.atu.edu.tr");
    expect(events[0]).toMatchObject({
      category: "course_registration",
      term: "fall",
      startDate: new Date("2025-09-01T00:00:00.000Z"),
      endDate: new Date("2025-09-05T00:00:00.000Z")
    });
  });
});

class FakeCatalogRepository implements CatalogRepository {
  private readonly university: UniversityRecord = {
    id: "atu",
    name: "ADANA ALPARSLAN TÜRKEŞ BİLİM VE TEKNOLOJİ ÜNİVERSİTESİ",
    slug: "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi",
    city: "Adana",
    type: "state",
    websiteUrl: "https://atu.edu.tr/",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date()
  };

  async createUniversity(): Promise<UniversityRecord> {
    throw new Error("not implemented");
  }

  async updateUniversity(): Promise<UniversityRecord | null> {
    throw new Error("not implemented");
  }

  async archiveUniversity(): Promise<UniversityRecord | null> {
    throw new Error("not implemented");
  }

  async findUniversityById(id: string): Promise<UniversityRecord | null> {
    return id === this.university.id ? this.university : null;
  }

  async listUniversities(): Promise<UniversityRecord[]> {
    return [this.university];
  }

  async findUniversityByEmailDomain(): Promise<UniversityRecord | null> {
    return null;
  }

  async createFaculty(): Promise<FacultyRecord> {
    throw new Error("not implemented");
  }

  async listFaculties(): Promise<FacultyRecord[]> {
    return [];
  }

  async createDepartment(): Promise<DepartmentRecord> {
    throw new Error("not implemented");
  }

  async listDepartments(): Promise<DepartmentRecord[]> {
    return [];
  }
}

class FakeCalendarRepository implements CalendarRepository {
  private calendars: AcademicCalendarRecord[] = [];
  private events: AcademicEventRecord[] = [];

  async findPublishedCalendar(universityId: string, academicYear?: string): Promise<AcademicCalendarRecord | null> {
    return this.calendars
      .filter((calendar) => calendar.universityId === universityId && calendar.status === "published")
      .filter((calendar) => (academicYear ? calendar.academicYear === academicYear : true))
      .sort((left, right) => right.version - left.version)[0] ?? null;
  }

  async findCalendarById(calendarId: string): Promise<AcademicCalendarRecord | null> {
    return this.calendars.find((calendar) => calendar.id === calendarId) ?? null;
  }

  async createCalendar(input: Omit<AcademicCalendarRecord, "id" | "createdAt" | "updatedAt">): Promise<AcademicCalendarRecord> {
    const now = new Date();
    const calendar = { ...input, id: `calendar-${this.calendars.length + 1}`, createdAt: now, updatedAt: now };
    this.calendars.push(calendar);
    return calendar;
  }

  async updateCalendar(calendarId: string, input: Partial<Omit<AcademicCalendarRecord, "id" | "createdAt" | "updatedAt">>): Promise<AcademicCalendarRecord | null> {
    const calendar = await this.findCalendarById(calendarId);
    if (!calendar) return null;
    Object.assign(calendar, input, { updatedAt: new Date() });
    return calendar;
  }

  async archivePublishedCalendars(universityId: string, academicYear: string): Promise<number> {
    let archived = 0;
    for (const calendar of this.calendars) {
      if (calendar.universityId === universityId && calendar.academicYear === academicYear && calendar.status === "published") {
        calendar.status = "archived";
        archived += 1;
      }
    }
    return archived;
  }

  async createEvents(input: Array<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<AcademicEventRecord[]> {
    const now = new Date();
    const created = input.map((event) => ({ ...event, id: `event-${this.events.length + 1}`, createdAt: now, updatedAt: now }));
    this.events.push(...created);
    return created;
  }

  async updateEventsByCalendar(calendarId: string, input: Partial<Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<number> {
    let updated = 0;
    for (const event of this.events) {
      if (event.calendarId === calendarId) {
        Object.assign(event, input, { updatedAt: new Date() });
        updated += 1;
      }
    }
    return updated;
  }

  async listEventsByCalendar(calendarId: string): Promise<AcademicEventRecord[]> {
    return this.events.filter((event) => event.calendarId === calendarId);
  }

  async listPublishedEvents(input: { universityId?: string; limit: number; offset: number }): Promise<AcademicEventRecord[]> {
    return this.events
      .filter((event) => event.status === "published")
      .filter((event) => (input.universityId ? event.universityId === input.universityId : true))
      .slice(input.offset, input.offset + input.limit);
  }

  async listUpcomingEvents(): Promise<AcademicEventRecord[]> {
    return [];
  }

  async findPublishedEventById(eventId: string): Promise<AcademicEventRecord | null> {
    return this.events.find((event) => event.id === eventId && event.status === "published") ?? null;
  }
}

class FakePdfRepository implements PdfRepository {
  private sources = new Map<string, PdfSourceRecord>();
  private events = new Map<string, ExtractedEventRecord>();

  async createPdfSource(input: Omit<PdfSourceRecord, "id" | "createdAt" | "updatedAt">): Promise<PdfSourceRecord> {
    const now = new Date();
    const source = { ...input, id: `pdf-${this.sources.size + 1}`, createdAt: now, updatedAt: now };
    this.sources.set(source.id, source);
    return source;
  }

  async findPdfSourceById(id: string): Promise<PdfSourceRecord | null> {
    return this.sources.get(id) ?? null;
  }

  async findPdfSourceByHash(universityId: string, fileHash: string): Promise<PdfSourceRecord | null> {
    return [...this.sources.values()].find((source) => source.universityId === universityId && source.fileHash === fileHash) ?? null;
  }

  async updatePdfSource(id: string, input: Partial<Omit<PdfSourceRecord, "id" | "createdAt" | "updatedAt">>): Promise<PdfSourceRecord | null> {
    const source = this.sources.get(id);
    if (!source) return null;
    const updated = { ...source, ...input, updatedAt: new Date() };
    this.sources.set(id, updated);
    return updated;
  }

  async createExtractedEvents(input: Array<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord[]> {
    const now = new Date();
    const records = input.map((event) => ({ ...event, id: `extracted-${this.events.size + 1}`, createdAt: now, updatedAt: now }));
    for (const record of records) this.events.set(record.id, record);
    return records;
  }

  async listExtractedEvents(input: { pdfSourceId?: string; status?: ExtractedEventStatus; limit: number; offset: number }): Promise<ExtractedEventRecord[]> {
    return [...this.events.values()]
      .filter((event) => (input.pdfSourceId ? event.pdfSourceId === input.pdfSourceId : true))
      .filter((event) => (input.status ? event.status === input.status : true))
      .slice(input.offset, input.offset + input.limit);
  }

  async findExtractedEventById(id: string): Promise<ExtractedEventRecord | null> {
    return this.events.get(id) ?? null;
  }

  async updateExtractedEvent(id: string, input: Partial<Omit<ExtractedEventRecord, "id" | "createdAt" | "updatedAt">>): Promise<ExtractedEventRecord | null> {
    const event = this.events.get(id);
    if (!event) return null;
    const updated = { ...event, ...input, updatedAt: new Date() };
    this.events.set(id, updated);
    return updated;
  }
}
