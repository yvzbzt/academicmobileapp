import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from "@nestjs/common";
import { PDFParse } from "pdf-parse";
import { findVerifiedUniversitySource } from "../../bootstrap/verified-source-registry.js";
import { mapAcademicEventCategory } from "../../domain/category-mapper.js";
import type { AcademicTerm } from "../../domain/academic-event.types.js";
import { isFreshAcademicContent } from "../../domain/temporal-freshness.js";
import type { CatalogRepository, UniversityRecord } from "../catalog/catalog.types.js";
import { buildHomepageCandidates, isLikelyUniversityHomepage } from "../announcements/announcement-ingestion.service.js";
import { cleanText, fetchText } from "../announcements/announcement-parser.js";
import { AdminCalendarService } from "./admin-calendar.service.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarRepository } from "./calendar.types.js";
import { PdfProcessingService } from "../pdf/pdf-processing.service.js";
import { NotificationSchedulingService } from "../notifications/notifications.service.js";

export interface CalendarIngestionResult {
  universityId: string;
  universityName: string;
  status: "existing" | "published" | "source_not_found" | "no_events" | "failed";
  academicYear?: string;
  sourceUrl?: string;
  eventCount: number;
  error?: string;
}

export interface CalendarSourceDiscoveryResult {
  universityId: string;
  universityName: string;
  status: "source_found" | "source_not_found" | "failed";
  sourceUrl?: string;
  title?: string;
  academicYear?: string;
  error?: string;
}

interface DiscoveredCalendarPdf {
  sourceUrl: string;
  title: string;
}

interface DownloadedPdf {
  finalUrl: string;
  data: Buffer;
  fileName: string;
  magicBytesHex: string;
}

interface ExtractedPdfText {
  text: string;
  pageCount: number;
}

const academicCalendarPaths = [
  "/akademik-takvim",
  "/akademik-takvimler",
  "/tr/akademik-takvim",
  "/tr/akademik-takvimler",
  "/ogrenci/akademik-takvim",
  "/ogrenci/akademik-takvimler",
  "/ogrenci-isleri/akademik-takvim",
  "/ogrenci-isleri/akademik-takvimler",
  "/tr/ogrenci/akademik-takvim",
  "/tr/ogrenci-isleri/akademik-takvim",
  "/akademik/akademik-takvim",
  "/egitim/akademik-takvim",
  "/universite/akademik-takvim",
  "/student/academic-calendar",
  "/academic-calendar",
  "/academic-calendars"
];

type AcademicEventInput = Omit<AcademicEventRecord, "id" | "createdAt" | "updatedAt">;

interface AtuCalendarRow {
  ID?: number;
  DonemAciklama?: string;
  Aciklama?: string;
  BaslamaTarihi?: string;
  BitisTarihi?: string;
  AdTR?: string;
  Yil?: number;
  GrupTipiAciklama?: string;
  Durum?: number | boolean;
}

@Injectable()
export class CalendarIngestionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CalendarIngestionService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly inFlight = new Map<string, Promise<{ calendar: AcademicCalendarRecord; events: AcademicEventRecord[] } | null>>();

  constructor(
    @Inject("CatalogRepository") private readonly catalogRepository: CatalogRepository,
    @Inject("CalendarRepository") private readonly calendarRepository: CalendarRepository,
    @Inject(PdfProcessingService) private readonly pdfProcessingService: PdfProcessingService,
    @Inject(AdminCalendarService) private readonly adminCalendarService: AdminCalendarService,
    @Optional() @Inject(NotificationSchedulingService) private readonly notificationSchedulingService?: NotificationSchedulingService
  ) {}

  onApplicationBootstrap() {
    if (process.env.CALENDAR_AUTO_INGEST_ENABLED !== "true") return;
    const initialDelayMs = readPositiveInteger(process.env.CALENDAR_INGEST_INITIAL_DELAY_MS, 15000);
    const scheduleTimes = parseDailyScheduleTimes(process.env.CALENDAR_INGEST_SCHEDULE_TIMES ?? "06:30");
    if (scheduleTimes.length > 0) this.scheduleNextCycle(scheduleTimes);
    else this.timer = setInterval(() => void this.runScheduledCycle(), readPositiveInteger(process.env.CALENDAR_INGEST_INTERVAL_MS, 24 * 60 * 60 * 1000));
    setTimeout(() => void this.runScheduledCycle(), initialDelayMs);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async ensurePublishedCalendarForUniversity(universityId: string, academicYear?: string): Promise<{ calendar: AcademicCalendarRecord; events: AcademicEventRecord[] } | null> {
    const existing = await this.getPublishedCalendarWithEvents(universityId, academicYear);
    if (existing && !await this.shouldRetrySourceOnlyCalendar(existing)) return existing;

    const key = `${universityId}:${academicYear ?? "latest"}`;
    const existingJob = this.inFlight.get(key);
    if (existingJob) return existingJob;

    const job = this.ingestUniversityCalendar(universityId, academicYear, { retrySourceOnly: true })
      .then(async (result) => {
        if (result.status !== "published" && result.status !== "existing") return null;
        return this.getPublishedCalendarWithEvents(universityId, result.academicYear ?? academicYear);
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, job);
    return job;
  }

  async runSourceDiscovery(input: { universityId?: string; limit?: number; offset?: number; concurrency?: number } = {}) {
    const universities = input.universityId
      ? [await this.catalogRepository.findUniversityById(input.universityId)].filter((university): university is UniversityRecord => Boolean(university))
      : await this.catalogRepository.listUniversities({ status: "active", limit: input.limit ?? readPositiveInteger(process.env.CALENDAR_DISCOVERY_BATCH_SIZE, 205), offset: input.offset ?? 0 });

    const results = await runWithConcurrency(universities, input.concurrency ?? 2, async (university): Promise<CalendarSourceDiscoveryResult> => {
      try {
        const pdf = await discoverAcademicCalendarPdf(university, readPositiveInteger(process.env.CALENDAR_SOURCE_TIMEOUT_MS, 12000));
        if (!pdf) return { universityId: university.id, universityName: university.name, status: "source_not_found" };
        const academicYear = inferAcademicYear([pdf.title, pdf.sourceUrl]);
        return {
          universityId: university.id,
          universityName: university.name,
          status: "source_found",
          sourceUrl: pdf.sourceUrl,
          title: pdf.title,
          ...(academicYear ? { academicYear } : {})
        };
      } catch (error) {
        return {
          universityId: university.id,
          universityName: university.name,
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    return {
      summary: {
        checkedUniversities: results.length,
        sourceFound: results.filter((result) => result.status === "source_found").length,
        sourceNotFound: results.filter((result) => result.status === "source_not_found").length,
        failed: results.filter((result) => result.status === "failed").length
      },
      results
    };
  }

  async runDiscoveryAndIngestion(input: { universityId?: string; academicYear?: string; limit?: number; offset?: number; concurrency?: number } = {}) {
    const universities = input.universityId
      ? [await this.catalogRepository.findUniversityById(input.universityId)].filter((university): university is UniversityRecord => Boolean(university))
      : await this.catalogRepository.listUniversities({ status: "active", limit: input.limit ?? readPositiveInteger(process.env.CALENDAR_DISCOVERY_BATCH_SIZE, 205), offset: input.offset ?? 0 });

    const results = await runWithConcurrency(universities, input.concurrency ?? 2, (university) => this.ingestUniversityCalendar(university.id, input.academicYear));
    return {
      summary: {
        checkedUniversities: results.length,
        published: results.filter((result) => result.status === "published" || result.status === "existing").length,
        sourceNotFound: results.filter((result) => result.status === "source_not_found").length,
        noEvents: results.filter((result) => result.status === "no_events").length,
        failed: results.filter((result) => result.status === "failed").length,
        totalEvents: results.reduce((total, result) => total + result.eventCount, 0)
      },
      results
    };
  }

  async ingestUniversityCalendar(universityId: string, academicYear?: string, options: { retrySourceOnly?: boolean } = {}): Promise<CalendarIngestionResult> {
    const university = await this.catalogRepository.findUniversityById(universityId);
    if (!university) {
      this.logger.warn(`Calendar ingestion skipped: university not found (${universityId}).`);
      return { universityId, universityName: universityId, status: "source_not_found", eventCount: 0, error: "University not found." };
    }

    const existing = await this.calendarRepository.findPublishedCalendar(universityId, academicYear);
    if (existing && (academicYear || isAcceptableAcademicYear(existing.academicYear))) {
      const events = await this.calendarRepository.listPublishedEvents({ calendarId: existing.id, universityId, limit: 500, offset: 0 });
      if (events.length > 0 || !options.retrySourceOnly || !await this.shouldRetrySourceOnlyCalendar({ calendar: existing, events })) {
        return {
          universityId,
          universityName: university.name,
          status: "existing",
          academicYear: existing.academicYear,
          ...(existing.sourceUrl ? { sourceUrl: existing.sourceUrl } : {}),
          eventCount: events.length
        };
      }
    }

    try {
      if (university.slug === "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi") {
        return await this.ingestAtuODataCalendar(university, academicYear);
      }

      const pdf = await discoverAcademicCalendarPdf(university, readPositiveInteger(process.env.CALENDAR_SOURCE_TIMEOUT_MS, 12000));
      if (!pdf) {
        this.logger.warn(`Calendar source not found for ${university.name} (${university.id}).`);
        return { universityId, universityName: university.name, status: "source_not_found", eventCount: 0 };
      }
      const result = await this.ingestPdfCalendar(university, pdf, academicYear);
      if (result.status === "published" || result.status === "existing") this.logger.log(`Calendar ${result.status} for ${university.name}: ${result.academicYear ?? "unknown year"} (${result.eventCount} events).`);
      else this.logger.warn(`Calendar ingestion ${result.status} for ${university.name}: ${result.error ?? result.sourceUrl ?? "no details"}.`);
      return result;
    } catch (error) {
      this.logger.warn(`Calendar ingestion failed for ${university.name}: ${error instanceof Error ? error.message : String(error)}`);
      return {
        universityId,
        universityName: university.name,
        status: "failed",
        eventCount: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async runScheduledCycle(): Promise<void> {
    await this.runDiscoveryAndIngestion({
      limit: readPositiveInteger(process.env.CALENDAR_DISCOVERY_BATCH_SIZE, 205),
      offset: readPositiveInteger(process.env.CALENDAR_DISCOVERY_OFFSET, 0),
      concurrency: readPositiveInteger(process.env.CALENDAR_DISCOVERY_CONCURRENCY, 2)
    });
  }

  private scheduleNextCycle(scheduleTimes: number[]): void {
    const delayMs = millisecondsUntilNextDailyRun(scheduleTimes);
    this.timer = setTimeout(async () => {
      await this.runScheduledCycle();
      this.scheduleNextCycle(scheduleTimes);
    }, delayMs);
  }

  private async getPublishedCalendarWithEvents(universityId: string, academicYear?: string) {
    const calendar = await this.calendarRepository.findPublishedCalendar(universityId, academicYear);
    if (!calendar) return null;
    if (!academicYear && !isAcceptableAcademicYear(calendar.academicYear)) return null;
    const events = await this.calendarRepository.listPublishedEvents({ calendarId: calendar.id, universityId, limit: 200, offset: 0 });
    return { calendar, events };
  }

  private async publishSourceOnlyCalendar(
    university: UniversityRecord,
    academicYear: string,
    sourceUrl: string,
    sourcePdfId?: string
  ): Promise<AcademicCalendarRecord> {
    const existing = await this.calendarRepository.findPublishedCalendar(university.id, academicYear);
    if (existing) {
      const existingEvents = await this.calendarRepository.listPublishedEvents({ calendarId: existing.id, universityId: university.id, limit: 1, offset: 0 });
      if (existingEvents.length > 0 || existing.sourceUrl === sourceUrl) return existing;
    }

    const draft = await this.calendarRepository.createCalendar({
      universityId: university.id,
      academicYear,
      title: `${university.name} ${academicYear} Akademik Takvimi`.trim(),
      status: "draft",
      version: (existing?.version ?? 0) + 1,
      ...(sourcePdfId ? { sourcePdfId } : {}),
      sourceUrl,
      createdBy: "system-calendar-ingestion",
      approvedBy: "system-calendar-ingestion"
    });
    await this.calendarRepository.archivePublishedCalendars(university.id, academicYear);
    const published = await this.calendarRepository.updateCalendar(draft.id, {
      status: "published",
      publishedAt: new Date(),
      approvedBy: "system-calendar-ingestion"
    });
    return published ?? draft;
  }

  private async ingestAtuODataCalendar(university: UniversityRecord, requestedAcademicYear?: string): Promise<CalendarIngestionResult> {
    const sourceUrl = "https://odata.atu.edu.tr/odata/DataService.svc/V_AkademikTakvim?$format=json";
    const response = await fetch(sourceUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(readPositiveInteger(process.env.CALENDAR_SOURCE_TIMEOUT_MS, 12000)) });
    if (!response.ok) throw new Error(`ATU_CALENDAR_FETCH_FAILED:${response.status}`);
    const payload = await response.json() as { d?: AtuCalendarRow[] };
    const activeRows = (payload.d ?? []).filter((row) => row.Durum === 1 || row.Durum === true).filter((row) => row.AdTR && row.BaslamaTarihi && row.Yil);
    const availableYears = [...new Set(activeRows.map((row) => row.Yil).filter((year): year is number => Number.isInteger(year)))].sort((left, right) => right - left);
    const selectedStartYear = requestedAcademicYear
      ? Number(requestedAcademicYear.slice(0, 4))
      : availableYears.find((year) => isAcceptableAcademicYearStart(year));
    if (!selectedStartYear) return { universityId: university.id, universityName: university.name, status: "no_events", sourceUrl, eventCount: 0 };

    const rows = activeRows.filter((row) => row.Yil === selectedStartYear);
    if (rows.length === 0) return { universityId: university.id, universityName: university.name, status: "no_events", academicYear: `${selectedStartYear}-${selectedStartYear + 1}`, sourceUrl, eventCount: 0 };

    const academicYear = `${selectedStartYear}-${selectedStartYear + 1}`;
    const existing = await this.calendarRepository.findPublishedCalendar(university.id, academicYear);
    const calendar = await this.calendarRepository.createCalendar({
      universityId: university.id,
      academicYear,
      title: `${university.name} ${academicYear} Akademik Takvimi`,
      status: "draft",
      version: (existing?.version ?? 0) + 1,
      sourceUrl,
      createdBy: "system-calendar-ingestion"
    });

    const eventInputs = rows
      .map((row) => toAtuAcademicEvent(row, calendar.id, university.id, academicYear, sourceUrl))
      .filter((event): event is AcademicEventInput => Boolean(event));
    const events = await this.calendarRepository.createEvents(eventInputs);
    if (events.length === 0) {
      await this.calendarRepository.updateCalendar(calendar.id, { status: "archived" });
      return { universityId: university.id, universityName: university.name, status: "no_events", academicYear, sourceUrl, eventCount: 0 };
    }

    await this.calendarRepository.archivePublishedCalendars(university.id, academicYear);
    const publishedCalendar = await this.calendarRepository.updateCalendar(calendar.id, {
      status: "published",
      publishedAt: new Date(),
      approvedBy: "system-calendar-ingestion"
    });
    await this.calendarRepository.updateEventsByCalendar(calendar.id, { status: "published" });
    await this.notificationSchedulingService?.scheduleCalendarPublished(publishedCalendar ?? calendar, events);
    return { universityId: university.id, universityName: university.name, status: "published", academicYear: publishedCalendar?.academicYear ?? academicYear, sourceUrl, eventCount: events.length };
  }

  private async ingestPdfCalendar(university: UniversityRecord, pdf: DiscoveredCalendarPdf, requestedAcademicYear?: string): Promise<CalendarIngestionResult> {
    const downloaded = await downloadPdf(pdf.sourceUrl, readPositiveInteger(process.env.CALENDAR_SOURCE_TIMEOUT_MS, 12000));
    const extracted = await extractPdfText(downloaded.data);
    const inferredAcademicYear = inferAcademicYear([pdf.title, downloaded.fileName, downloaded.finalUrl, extracted.text]);
    if (!requestedAcademicYear && inferredAcademicYear && !isAcceptableAcademicYear(inferredAcademicYear)) {
      return { universityId: university.id, universityName: university.name, status: "source_not_found", sourceUrl: downloaded.finalUrl, eventCount: 0 };
    }
    const academicYear = requestedAcademicYear ?? inferredAcademicYear ?? currentAcademicYear();
    const pdfSource = await this.pdfProcessingService.createOrReusePdfSource({
      universityId: university.id,
      fileName: downloaded.fileName,
      mimeType: "application/pdf",
      magicBytesHex: downloaded.magicBytesHex,
      fileSize: downloaded.data.byteLength,
      pageCount: extracted.pageCount,
      academicYear,
      uploadedBy: "system-calendar-ingestion",
      rawText: extracted.text,
      url: downloaded.finalUrl
    });
    const processed = await this.pdfProcessingService.processPdfSource(pdfSource.id, { pdfData: downloaded.data });
    const approvable = processed.extractedEvents.filter((event) => event.startDate && event.confidenceScore >= 55);
    this.logger.log(`PDF processed for ${university.name}: extracted=${processed.extractedEvents.length}, approvable=${approvable.length}, parseStatus=${processed.pdfSource.parseStatus}, ocr=${processed.pdfSource.ocrProvider ? "yes" : "no"}.`);
    for (const event of approvable) await this.pdfProcessingService.approveExtractedEvent(event.id, "system-calendar-ingestion");
    if (approvable.length === 0) {
      await this.publishSourceOnlyCalendar(university, academicYear, downloaded.finalUrl, pdfSource.id);
      return { universityId: university.id, universityName: university.name, status: "published", academicYear, sourceUrl: downloaded.finalUrl, eventCount: 0 };
    }

    const draft = await this.adminCalendarService.createDraftFromApprovedExtractedEvents({
      universityId: university.id,
      academicYear,
      title: `${university.name} ${academicYear} Akademik Takvimi`,
      sourcePdfId: pdfSource.id,
      createdBy: "system-calendar-ingestion"
    });
    const published = await this.adminCalendarService.publishCalendar(draft.calendar.id, "system-calendar-ingestion");
    return { universityId: university.id, universityName: university.name, status: "published", academicYear, sourceUrl: downloaded.finalUrl, eventCount: published.publishedEvents.length };
  }

  private async shouldRetrySourceOnlyCalendar(existing: { calendar: AcademicCalendarRecord; events: AcademicEventRecord[] }): Promise<boolean> {
    if (existing.events.length > 0 || !isOcrProviderEnabled() || !existing.calendar.sourcePdfId) return false;
    try {
      const source = await this.pdfProcessingService.getPdfSource(existing.calendar.sourcePdfId);
      return !source.ocrProcessedAt;
    } catch {
      return false;
    }
  }
}

export async function discoverAcademicCalendarPdf(university: UniversityRecord, timeoutMs = 12000): Promise<DiscoveredCalendarPdf | null> {
  const checked = new Set<string>();
  const verified = await findVerifiedUniversitySource(university.id);
  const explicitCalendarUrls = new Set([university.academicCalendarUrl, verified?.calendarUrl].filter((url): url is string => Boolean(url)));
  const homepageCandidates = [
    ...(verified?.calendarUrl ? [verified.calendarUrl] : []),
    ...(university.academicCalendarUrl ? [university.academicCalendarUrl] : []),
    ...buildHomepageCandidates(university)
  ].slice(0, 16);
  return discoverAcademicCalendarPdfFromHomepages(university, homepageCandidates, timeoutMs, explicitCalendarUrls, (page) => isLikelyUniversityHomepage(page.text, page.finalUrl, university));
}

async function discoverAcademicCalendarPdfFromHomepages(
  university: UniversityRecord,
  homepageCandidates: string[],
  timeoutMs: number,
  explicitCalendarUrls: Set<string>,
  isLikelyHomepage: (page: { text: string; finalUrl: string }) => boolean
): Promise<DiscoveredCalendarPdf | null> {
  const checked = new Set<string>();

  for (const candidate of homepageCandidates) {
    if (checked.has(candidate)) continue;
    checked.add(candidate);
    const isExplicitCalendarUrl = explicitCalendarUrls.has(candidate);
    if (isExplicitCalendarUrl && looksLikePdfUrl(candidate) && containsCalendarHint(candidate, candidate) && isAcceptableCalendarSource({ sourceUrl: candidate, title: candidate })) return { sourceUrl: candidate, title: "Akademik Takvim" };

    try {
      const page = await fetchText(candidate, timeoutMs);
      if (!isExplicitCalendarUrl && !isLikelyHomepage(page)) continue;
      if (looksLikePdfUrl(page.finalUrl) && containsCalendarHint(page.finalUrl, page.finalUrl) && isAcceptableCalendarSource({ sourceUrl: page.finalUrl, title: page.finalUrl })) return { sourceUrl: page.finalUrl, title: "Akademik Takvim" };
      const links = extractAcademicCalendarLinks(page.text, page.finalUrl);
      const directPdf = links.find((link) => looksLikePdfUrl(link.sourceUrl) && isAcceptableCalendarSource(link));
      if (directPdf) return directPdf;

      for (const link of links.slice(0, 6)) {
        try {
          const nested = await fetchText(link.sourceUrl, timeoutMs);
          const nestedPdf = extractAcademicCalendarLinks(nested.text, nested.finalUrl).find((nestedLink) => looksLikePdfUrl(nestedLink.sourceUrl) && isAcceptableCalendarSource(nestedLink));
          if (nestedPdf) return nestedPdf;
        } catch {
          continue;
        }
      }

      for (const path of academicCalendarPaths) {
        const calendarPageUrl = new URL(path, page.finalUrl).toString();
        try {
          const nested = await fetchText(calendarPageUrl, timeoutMs);
          const nestedPdf = extractAcademicCalendarLinks(nested.text, nested.finalUrl).find((nestedLink) => looksLikePdfUrl(nestedLink.sourceUrl) && isAcceptableCalendarSource(nestedLink));
          if (nestedPdf) return nestedPdf;
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

function toAtuAcademicEvent(row: AtuCalendarRow, calendarId: string, universityId: string, academicYear: string, sourceUrl: string): AcademicEventInput | null {
  const startDate = parseODataDate(row.BaslamaTarihi);
  if (!startDate) return null;
  const endDate = parseODataDate(row.BitisTarihi);
  const title = cleanText(row.AdTR?.replace(/\r?\n/g, " ")) || cleanText(row.Aciklama) || "Akademik Takvim Etkinliği";
  return {
    calendarId,
    universityId,
    academicYear,
    term: mapTerm(row.DonemAciklama ?? row.Aciklama ?? title),
    category: mapAcademicEventCategory(`${title} ${row.Aciklama ?? ""}`),
    title,
    startDate,
    ...(endDate && endDate.getTime() !== startDate.getTime() ? { endDate } : {}),
    timezone: "Europe/Istanbul",
    originalDateText: `${startDate.toISOString().slice(0, 10)}${endDate ? ` - ${endDate.toISOString().slice(0, 10)}` : ""}`,
    originalText: `${title} ${row.Aciklama ?? ""}`.trim(),
    sourcePage: 1,
    confidenceScore: 98,
    status: "approved",
    notificationRules: [
      { offsetDays: 7, enabled: true },
      { offsetDays: 1, enabled: true },
      { offsetDays: 0, enabled: true }
    ],
    description: row.Aciklama ? `${cleanText(row.Aciklama)}\nKaynak: ${sourceUrl}` : `Kaynak: ${sourceUrl}`
  };
}

function extractAcademicCalendarLinks(html: string, baseUrl: string): DiscoveredCalendarPdf[] {
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const embeddedLinks = [...html.matchAll(/(?:href|src|url|file|link)["'\s:=]+([^"'<>\s]*(?:akademik[-_%20]*takvim|academic[-_%20]*calendar)[^"'<>\s]*)/gi)];
  return [
    ...anchors.map((anchor) => toCalendarLink(cleanText(anchor[1]), cleanText((anchor[2] ?? "").replace(/<[^>]+>/g, " ")), baseUrl)),
    ...embeddedLinks.map((match) => toCalendarLink(cleanText(match[1]), cleanText(match[1]), baseUrl))
  ]
    .filter((link): link is DiscoveredCalendarPdf => Boolean(link))
    .filter((link, index, links) => links.findIndex((candidate) => candidate.sourceUrl === link.sourceUrl) === index)
    .sort((left, right) => scoreCalendarSource(right) - scoreCalendarSource(left));
}

function toCalendarLink(href: string | undefined, title: string | undefined, baseUrl: string): DiscoveredCalendarPdf | null {
  if (!href || !containsCalendarHint(title ?? "", href)) return null;
  try {
    const sourceUrl = new URL(href, baseUrl).toString();
    if (!isFreshAcademicContent({ title, url: sourceUrl }).accepted) return null;
    return { sourceUrl, title: title || href };
  } catch {
    return null;
  }
}

async function downloadPdf(sourceUrl: string, timeoutMs: number): Promise<DownloadedPdf> {
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: "application/pdf,*/*;q=0.8",
      "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.7,en;q=0.6",
      "User-Agent": "AcademicCalendarPdfCrawler/1.0"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`CALENDAR_PDF_FETCH_FAILED:${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const magicBytesHex = data.subarray(0, 8).toString("hex");
  if (!magicBytesHex.startsWith("25504446")) throw new Error("CALENDAR_SOURCE_IS_NOT_PDF");
  return {
    finalUrl: response.url || sourceUrl,
    data,
    fileName: fileNameFromUrl(response.url || sourceUrl),
    magicBytesHex
  };
}

async function extractPdfText(data: Buffer): Promise<ExtractedPdfText> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    const resultWithTotal = result as { text?: string; total?: number };
    const parsedPageCount = Number(resultWithTotal.total);
    return {
      text: resultWithTotal.text ?? "",
      pageCount: Number.isInteger(parsedPageCount) && parsedPageCount > 0 ? parsedPageCount : Math.max(1, (resultWithTotal.text?.match(/\f/g)?.length ?? 0) + 1)
    };
  } finally {
    await parser.destroy();
  }
}

function containsCalendarHint(title: string, link: string): boolean {
  const text = foldText(`${title} ${link}`);
  return (text.includes("akademik") && text.includes("takvim")) || text.includes("academic calendar") || text.includes("academic-calendar");
}

function looksLikePdfUrl(input: string): boolean {
  return /\.pdf(?:$|[?#])/iu.test(input);
}

function scoreCalendarSource(source: DiscoveredCalendarPdf): number {
  const text = foldText(`${source.title} ${source.sourceUrl}`);
  const academicYear = inferAcademicYear([source.title, source.sourceUrl]);
  let score = looksLikePdfUrl(source.sourceUrl) ? 100 : 20;
  if (academicYear) {
    if (academicYear === currentAcademicYear()) score += 140;
    else if (academicYear === previousAcademicYear()) score += 100;
    else if (isAcceptableAcademicYear(academicYear)) score += 60;
    else score -= 300;
  }
  if (text.includes("akademik") && text.includes("takvim")) score += 60;
  if (text.includes("lisans")) score += 10;
  return score;
}

function isAcceptableCalendarSource(source: DiscoveredCalendarPdf): boolean {
  const academicYear = inferAcademicYear([source.title, source.sourceUrl]);
  return (!academicYear || isAcceptableAcademicYear(academicYear))
    && isFreshAcademicContent({ title: source.title, url: source.sourceUrl }).accepted
    && !isUnitSpecificCalendarSource(source);
}

export function isUnitSpecificCalendarSource(source: { title?: string; sourceUrl?: string }): boolean {
  const sourceUrl = source.sourceUrl ?? "";
  const title = source.title ?? "";
  const foldedUrl = foldText(`${sourceUrl} ${decodeUrlSafe(sourceUrl)}`);
  const text = foldText(`${title} ${sourceUrl} ${decodeUrlSafe(sourceUrl)}`).replace(/[-_/]+/g, " ");
  if (/\b(haric|disindakiler|except)\b/u.test(text) && /\b(tum|all|birimler|programlar)\b/u.test(text)) return false;
  if (/\bakademik[-\s]*takvim[-\s]*dhf\b|\bdhf[-\s.]*pdf\b/u.test(text)) return true;
  if (/\b(egitim|hukuk|tip|dis|eczacilik|muhendislik|iibf|sbf|saglik|ilahiyat|veteriner)\.[a-z0-9.-]*\.edu\.tr\b/u.test(foldedUrl)) return true;
  return [
    /\brehberlik\s*ve\s*psikolojik\s*danismanlik\b/u,
    /\bokul\s*oncesi\s*ogretmenligi\b/u,
    /\bsinif\s*ogretmenligi\b/u,
    /\bturkce\s*ogretmenligi\b/u,
    /\btip\s*fakultesi\b/u,
    /\bdis\s*hekimligi\s*fakultesi\b/u,
    /\beczacilik\s*fakultesi\b/u,
    /\bhukuk\s*fakultesi\b/u,
    /\begitim\s*fakultesi\b/u,
    /\bmuhendislik\s*fakultesi\b/u,
    /\bfen\s*edebiyat\s*fakultesi\b/u,
    /\bsaglik\s*bilimleri\s*fakultesi\b/u,
    /\biktisadi\s*ve\s*idari\s*bilimler\s*fakultesi\b/u,
    /\bfaculty\s*academic\s*calendar\b/u
  ].some((pattern) => pattern.test(text));
}

export function inferAcademicYear(values: string[]): string | undefined {
  const years: string[] = [];
  for (const value of values) {
    for (const match of foldText(value).matchAll(/(20\d{2})\s*[-_/]\s*(20\d{2})/gu)) {
      const academicYear = match[1] && match[2] ? normalizeAcademicYearPair(match[1], match[2]) : undefined;
      if (academicYear) years.push(academicYear);
    }
    for (const match of foldText(value).matchAll(/\b(20\d{2})(20\d{2})\b/gu)) {
      const academicYear = match[1] && match[2] ? normalizeAcademicYearPair(match[1], match[2]) : undefined;
      if (academicYear) years.push(academicYear);
    }
  }
  const uniqueYears = [...new Set(years)];
  const acceptableYears = uniqueYears.filter((academicYear) => isAcceptableAcademicYear(academicYear));
  return (acceptableYears.length > 0 ? acceptableYears : uniqueYears).sort((left, right) => academicYearStart(right) - academicYearStart(left))[0];
}

export function currentAcademicYear(date = new Date()): string {
  const year = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 6 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function previousAcademicYear(date = new Date()): string {
  const startYear = academicYearStart(currentAcademicYear(date)) - 1;
  return `${startYear}-${startYear + 1}`;
}

export function isAcceptableAcademicYear(academicYear: string, date = new Date()): boolean {
  return isAcceptableAcademicYearStart(academicYearStart(academicYear), date);
}

function isAcceptableAcademicYearStart(startYear: number, date = new Date()): boolean {
  const currentStartYear = academicYearStart(currentAcademicYear(date));
  const minimumStartYear = currentStartYear - readPositiveInteger(process.env.CALENDAR_MIN_YEAR_LOOKBACK, 1);
  return Number.isInteger(startYear) && startYear >= minimumStartYear && startYear <= currentStartYear;
}

function academicYearStart(academicYear: string): number {
  const startYear = Number(academicYear.match(/20\d{2}/u)?.[0]);
  return Number.isInteger(startYear) ? startYear : 0;
}

function normalizeAcademicYearPair(left: string, right: string): string | undefined {
  const leftYear = Number(left);
  const rightYear = Number(right);
  if (!Number.isInteger(leftYear) || !Number.isInteger(rightYear) || Math.abs(leftYear - rightYear) !== 1) return undefined;
  const startYear = Math.min(leftYear, rightYear);
  return `${startYear}-${startYear + 1}`;
}

function parseODataDate(value?: string): Date | undefined {
  const timestamp = value?.match(/Date\((\d+)\)/u)?.[1];
  if (!timestamp) return undefined;
  const parsed = Number(timestamp);
  return Number.isFinite(parsed) ? new Date(parsed) : undefined;
}

function mapTerm(value: string): AcademicTerm {
  const text = foldText(value);
  if (text.includes("guz")) return "fall";
  if (text.includes("bahar")) return "spring";
  if (text.includes("yaz")) return "summer";
  return "unknown";
}

function fileNameFromUrl(input: string): string {
  try {
    const pathname = new URL(input).pathname;
    return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) || "akademik-takvim.pdf");
  } catch {
    return "akademik-takvim.pdf";
  }
}

function decodeUrlSafe(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "I")
    .replace(/ğ/g, "g")
    .replace(/Ğ/g, "G")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "U")
    .replace(/ş/g, "s")
    .replace(/Ş/g, "S")
    .replace(/ö/g, "o")
    .replace(/Ö/g, "O")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "C")
    .toLocaleLowerCase("en-US");
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isOcrProviderEnabled(): boolean {
  return ["google_document_ai", "document_ai"].includes((process.env.OCR_PROVIDER ?? "").trim().toLocaleLowerCase("en-US"));
}

function parseDailyScheduleTimes(value: string): number[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .map((part) => part.match(/^(\d{1,2}):(\d{2})$/u))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]) * 60 + Number(match[2]))
    .filter((minutes) => minutes >= 0 && minutes < 24 * 60)
    .sort((left, right) => left - right);
}

function millisecondsUntilNextDailyRun(scheduleTimes: number[], now = new Date()): number {
  const turkeyOffsetMs = 3 * 60 * 60 * 1000;
  const turkeyNow = new Date(now.getTime() + turkeyOffsetMs);
  const elapsedTodayMs = ((turkeyNow.getUTCHours() * 60 + turkeyNow.getUTCMinutes()) * 60 + turkeyNow.getUTCSeconds()) * 1000 + turkeyNow.getUTCMilliseconds();
  const todayTargetMs = scheduleTimes.map((minutes) => minutes * 60 * 1000).find((targetMs) => targetMs > elapsedTodayMs);
  return (todayTargetMs ?? scheduleTimes[0]! * 60 * 1000 + 24 * 60 * 60 * 1000) - elapsedTodayMs;
}

async function runWithConcurrency<TInput, TOutput>(items: TInput[], concurrency: number, worker: (item: TInput) => Promise<TOutput>): Promise<TOutput[]> {
  const results: TOutput[] = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item);
    }
  }));
  return results;
}
