import { describe, expect, it, vi, afterEach } from "vitest";
import { mapAcademicEventCategory } from "../../apps/api/src/domain/category-mapper.js";
import { normalizeAcademicDate } from "../../apps/api/src/domain/date-normalizer.js";
import {
  CalendarIngestionService,
  buildYearAwareAcademicCalendarCandidates,
  inferAcademicYear,
  isAcceptableAcademicYear,
  selectAtuAcademicCalendarPdf
} from "../../apps/api/src/modules/calendars/calendar-ingestion.service.js";
import {
  extractAcademicScheduleLinks,
  extractDepartmentMenuLinks,
  extractModalPopupExamScheduleLinks,
  selectCurrentAcademicScheduleLinks
} from "../../apps/api/src/modules/calendars/academic-unit-schedule-discovery.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarRepository } from "../../apps/api/src/modules/calendars/calendar.types.js";
import type { CatalogRepository, DepartmentRecord, FacultyRecord, UniversityRecord } from "../../apps/api/src/modules/catalog/catalog.types.js";
import { PdfProcessingService } from "../../apps/api/src/modules/pdf/pdf-processing.service.js";
import type { ExtractedEventRecord, ExtractedEventStatus, PdfRepository, PdfSourceRecord } from "../../apps/api/src/modules/pdf/pdf.types.js";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type SafeOutboundHopResponse
} from "../../apps/api/src/common/network/safe-outbound-request.js";

const originalFetch = globalThis.fetch;
const disabledOcrService = {
  async extractText() {
    return null;
  }
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  setSafeOutboundRequestDependenciesForTesting(undefined);
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
      temporalKind: "date",
      endTemporalKind: "date",
      dateOnlyStart: "2025-09-01",
      dateOnlyEnd: "2025-09-05",
      startDate: new Date("2025-09-01T00:00:00.000Z"),
      endDate: new Date("2025-09-05T23:59:59.999Z")
    });
    expect(processed.extractedEvents[1]).toMatchObject({
      normalizedCategory: "midterm_exam",
      temporalKind: "date",
      dateOnlyStart: "2025-11-10",
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

  it("builds the AKU calendar page from the active academic year", () => {
    expect(buildYearAwareAcademicCalendarCandidates(
      { slug: "afyon-kocatepe-universitesi-afyonkarahisar" },
      new Date("2026-07-16T00:00:00.000Z")
    )).toEqual(["https://ogrenci.aku.edu.tr/2026-2027/"]);
  });

  it("publishes Adana ATU OData calendar rows when no calendar exists", async () => {
    const payload = {
      d: [
        {
          ID: 1,
          DonemAciklama: "Güz Dönemi",
          Aciklama: "Öğrenci işleri takvimi",
          // These instants are still the following calendar days in Europe/Istanbul.
          // UTC slicing would incorrectly publish 2025-08-31 through 2025-09-04.
          BaslamaTarihi: `/Date(${Date.UTC(2025, 7, 31, 22)})/`,
          BitisTarihi: `/Date(${Date.UTC(2025, 8, 4, 22)})/`,
          AdTR: "Ders kayıtları",
          Yil: 2025,
          Durum: 1
        }
      ]
    };
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop: async (_url, pinnedAddress): Promise<SafeOutboundHopResponse> => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify(payload)),
        remoteAddress: pinnedAddress.address
      })
    });

    const calendarRepository = new FakeCalendarRepository();
    const service = new CalendarIngestionService(
      new FakeCatalogRepository(),
      calendarRepository,
      {} as PdfProcessingService,
      {} as never
    );

    const universityId = "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi";
    const result = await service.ingestUniversityCalendar(universityId);
    const published = await calendarRepository.findPublishedCalendar(universityId, "2025-2026");
    const events = await calendarRepository.listPublishedEvents({ universityId, limit: 10, offset: 0 });

    expect(result).toMatchObject({ status: "published", academicYear: "2025-2026", eventCount: 1 });
    expect(published?.sourceUrl).toContain("odata.atu.edu.tr");
    expect(events[0]).toMatchObject({
      category: "course_registration",
      term: "fall",
      temporalKind: "date",
      endTemporalKind: "date",
      dateOnlyStart: "2025-09-01",
      dateOnlyEnd: "2025-09-05",
      startDate: new Date("2025-09-01T00:00:00.000Z"),
      endDate: new Date("2025-09-05T23:59:59.999Z")
    });
  });

  it("rejects a reverse ATU source range before creating a calendar", async () => {
    const payload = {
      d: [{
        ID: 2,
        DonemAciklama: "GÃ¼z DÃ¶nemi",
        Aciklama: "Ters kaynak aralÄ±ÄŸÄ±",
        BaslamaTarihi: `/Date(${Date.UTC(2025, 8, 4, 22)})/`,
        BitisTarihi: `/Date(${Date.UTC(2025, 7, 31, 22)})/`,
        AdTR: "Ders kayÄ±tlarÄ±",
        Yil: 2025,
        Durum: 1
      }]
    };
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop: async (_url, pinnedAddress): Promise<SafeOutboundHopResponse> => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify(payload)),
        remoteAddress: pinnedAddress.address
      })
    });
    const calendarRepository = new FakeCalendarRepository();
    const createCalendar = vi.spyOn(calendarRepository, "createCalendar");
    const service = new CalendarIngestionService(
      new FakeCatalogRepository(),
      calendarRepository,
      {} as PdfProcessingService,
      {} as never
    );

    await expect(service.ingestUniversityCalendar("adana-alparslan-turkes-bilim-ve-teknoloji-universitesi")).resolves.toMatchObject({
      status: "failed",
      eventCount: 0,
      error: "endDate must not be before startDate."
    });
    expect(createCalendar).not.toHaveBeenCalled();
  });

  it("selects ATU's current general undergraduate PDF from page content", () => {
    const html = `
      <a href="/Upload/2026-lisansustu.pdf">2026-2027 Lisansüstü Akademik Takvimi</a>
      <a href="/Upload/2025-lisans.pdf">2025-2026 Ön Lisans - Lisans Akademik Takvimi</a>
      <a href="/Upload/2026-yadyo.pdf">2026-2027 YADYO Akademik Takvimi</a>
      <a href="/Upload/2026-lisans.pdf">2026-2027 Ön Lisans - Lisans Akademik Takvimi</a>
    `;

    expect(selectAtuAcademicCalendarPdf(html, "2026-2027")).toEqual({
      sourceUrl: "https://www.atu.edu.tr/Upload/2026-lisans.pdf",
      title: "2026-2027 Ön Lisans - Lisans Akademik Takvimi"
    });
  });
});

describe("AKU academic-unit schedule discovery", () => {
  it("reads an academic year concatenated to a department name in a schedule filename", () => {
    const links = extractAcademicScheduleLinks(
      '<a href="/uploads/Antrenorluk-Bolumu2026-2027-Guz-Donemi-Ders-Programi.pdf">Ders Programi</a>',
      "https://sbf.aku.edu.tr/"
    );
    expect(links[0]).toMatchObject({ academicYear: "2026-2027", term: "fall", type: "course_schedule" });
  });

  it("extracts and selects current exam PDFs from the SBF modal popup", () => {
    const html = `
      <div class="modalpopup-content">
        <span class="modalpopup-close">x</span>
        <div>
          <p><a href="/files/2025-2026-Bahar-Butunleme-Sinav-Programi.pdf">2025-2026 Bahar Butunleme Sinav Programi</a></p>
          <p><a href="/files/2026-2027-Guz-Vize-Sinav-Programi.pdf">2026-2027 Guz Vize Sinav Programi</a></p>
        </div>
      </div>`;
    const links = extractModalPopupExamScheduleLinks(html, "https://sbf.aku.edu.tr/");
    const selected = selectCurrentAcademicScheduleLinks(links, "2026-2027", "fall");

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      sourceUrl: "https://sbf.aku.edu.tr/files/2026-2027-Guz-Vize-Sinav-Programi.pdf",
      type: "exam_schedule",
      academicYear: "2026-2027",
      term: "fall",
      discoveryArea: "modal_popup"
    });
  });

  it("finds SBF department pages below the Bolumler dropdown", () => {
    const html = `
      <nav><ul><li class="drop-down"><a href="#">Bolumler</a><ul>
        <li><a href="/beden-egitimi-ve-spor-ogretmenligi/">Beden Egitimi ve Spor Ogretmenligi</a></li>
        <li><a href="/antrenorluk-bolumu/">Antrenorluk Bolumu</a></li>
        <li><a href="/rekreasyon-bolumu/">Rekreasyon Bolumu</a></li>
      </ul></li></ul></nav>`;

    expect(extractDepartmentMenuLinks(html, "https://sbf.aku.edu.tr/")).toEqual([
      { sourceUrl: "https://sbf.aku.edu.tr/beden-egitimi-ve-spor-ogretmenligi/", title: "Beden Egitimi ve Spor Ogretmenligi" },
      { sourceUrl: "https://sbf.aku.edu.tr/antrenorluk-bolumu/", title: "Antrenorluk Bolumu" },
      { sourceUrl: "https://sbf.aku.edu.tr/rekreasyon-bolumu/", title: "Rekreasyon Bolumu" }
    ]);
  });
});

class FakeCatalogRepository implements CatalogRepository {
  private readonly university: UniversityRecord = {
    id: "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi",
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

  async listPublishedCalendars(input: { limit: number; offset: number }): Promise<AcademicCalendarRecord[]> {
    return this.calendars
      .filter((calendar) => calendar.status === "published")
      .slice(input.offset, input.offset + input.limit);
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

  async archiveEventsByScheduleSeries(scheduleSeriesId: string): Promise<number> {
    let updated = 0;
    for (const event of this.events) {
      if (event.scheduleSeriesId === scheduleSeriesId && event.status !== "archived") {
        Object.assign(event, { status: "archived", updatedAt: new Date() });
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

  async findPublishedEventByIdInScope(
    eventId: string,
    scope: { universityId: string; facultyId?: string; departmentId?: string }
  ): Promise<AcademicEventRecord | null> {
    return this.events.find((event) => (
      event.id === eventId
      && event.status === "published"
      && event.universityId === scope.universityId
      && (!event.facultyId || event.facultyId === scope.facultyId)
      && (!event.departmentId || event.departmentId === scope.departmentId)
    )) ?? null;
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
