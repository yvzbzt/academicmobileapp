import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { resolveSourceAuthorityContext } from "../../bootstrap/source-authority-context.js";
import { findVerifiedUniversitySource } from "../../bootstrap/verified-source-registry.js";
import { safeOutboundRequest } from "../../common/network/safe-outbound-request.js";
import { mapAcademicEventCategory } from "../../domain/category-mapper.js";
import {
  evaluateSourceAuthority,
  requireSourceAuthority,
  type SourceAuthorityContext
} from "../../domain/source-authority-enforcement.js";
import type { AcademicTerm } from "../../domain/academic-event.types.js";
import {
  STUDENT_RELEVANCE_CLASSIFICATION_VERSION,
  classifyStudentRelevance,
  summarizeStudentRelevanceAudit,
  type StudentRelevanceAuditCounts
} from "../../domain/student-relevance-classifier.js";
import { isFreshAcademicContent } from "../../domain/temporal-freshness.js";
import type { CatalogRepository, UniversityRecord } from "../catalog/catalog.types.js";
import { buildHomepageCandidates, isLikelyUniversityHomepage } from "../announcements/announcement-ingestion.service.js";
import { cleanText, fetchText } from "../announcements/announcement-parser.js";
import { isOfficialContentUrl } from "../announcements/announcement-content-trust.js";
import { AdminCalendarService } from "./admin-calendar.service.js";
import { academicTemporalFields, istanbulCalendarDate } from "./calendar-temporal.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarRepository } from "./calendar.types.js";
import { PdfProcessingService } from "../pdf/pdf-processing.service.js";
import { extractPdfBinaryText } from "../pdf/pdf-binary-text.js";
import type { ExtractedEventRecord } from "../pdf/pdf.types.js";
import { NotificationSchedulingService } from "../notifications/notifications.service.js";

export interface CalendarIngestionResult {
  universityId: string;
  universityName: string;
  status: "existing" | "published" | "source_not_found" | "no_events" | "failed";
  academicYear?: string;
  sourceUrl?: string;
  eventCount: number;
  classificationAudit?: CalendarClassificationAudit;
  error?: string;
}

interface CalendarClassificationAudit {
  mode: "shadow";
  classificationVersion: typeof STUDENT_RELEVANCE_CLASSIFICATION_VERSION;
  counts: StudentRelevanceAuditCounts;
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

const defaultCatalogDiscoveryLimit = 5000;
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
type PreparedAcademicEventInput = Omit<AcademicEventInput, "calendarId">;

export interface AtuCalendarRow {
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

interface AtuCalendarPagePayload {
  d?: {
    HTMLicerik?: string;
    MetinIcerik?: string;
  };
}

const atuCalendarPageApiUrl = "https://odata.atu.edu.tr/odata/DataService.svc/Icerik(2061)?$format=json";
const atuCalendarPageUrl = "https://www.atu.edu.tr/#!/sayfa/2061/51/f4d5eeb2-c7bf-4f04-b8d6-720c00de186f/";
const atuCalendarODataUrl = "https://odata.atu.edu.tr/odata/DataService.svc/V_AkademikTakvim?$format=json";

@Injectable()
export class CalendarIngestionService {
  private readonly logger = new Logger(CalendarIngestionService.name);
  private readonly inFlight = new Map<string, Promise<{ calendar: AcademicCalendarRecord; events: AcademicEventRecord[] } | null>>();

  constructor(
    @Inject("CatalogRepository") private readonly catalogRepository: CatalogRepository,
    @Inject("CalendarRepository") private readonly calendarRepository: CalendarRepository,
    @Inject(PdfProcessingService) private readonly pdfProcessingService: PdfProcessingService,
    @Inject(AdminCalendarService) private readonly adminCalendarService: AdminCalendarService,
    @Optional() @Inject(NotificationSchedulingService) private readonly notificationSchedulingService?: NotificationSchedulingService
  ) {}

  async reconcilePublishedCalendarNotifications(input: { batchSize?: number; maximumCalendars?: number } = {}): Promise<{
    checked: number;
    reconciled: number;
    failed: number;
  }> {
    if (!this.notificationSchedulingService) return { checked: 0, reconciled: 0, failed: 0 };
    const maximumCalendars = Math.min(
      input.maximumCalendars ?? readPositiveInteger(process.env.CALENDAR_NOTIFICATION_RECONCILIATION_LIMIT, 500),
      5_000
    );
    const batchSize = Math.min(input.batchSize ?? 100, maximumCalendars, 500);
    let checked = 0;
    let reconciled = 0;
    let failed = 0;
    const observedCalendars: AcademicCalendarRecord[] = [];

    while (checked < maximumCalendars) {
      const limit = Math.min(batchSize, maximumCalendars - checked);
      let calendars: AcademicCalendarRecord[];
      try {
        calendars = await this.calendarRepository.listPublishedCalendars({ limit, offset: checked });
      } catch (error) {
        this.logger.warn(`Calendar notification reconciliation scan failed: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
      if (calendars.length === 0) break;
      checked += calendars.length;
      observedCalendars.push(...calendars);

      if (calendars.length < limit) break;
    }

    const scopes = new Map<string, { universityId: string; academicYear: string }>();
    for (const calendar of observedCalendars) {
      scopes.set(`${calendar.universityId}\0${calendar.academicYear}`, {
        universityId: calendar.universityId,
        academicYear: calendar.academicYear
      });
    }
    for (const scope of scopes.values()) {
      try {
        const active = await this.reconcileUsablePublishedSnapshot(scope.universityId, scope.academicYear);
        if (active) reconciled += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`Calendar notification reconciliation failed for ${scope.universityId}/${scope.academicYear}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { checked, reconciled, failed };
  }

  async ensurePublishedCalendarForUniversity(universityId: string, academicYear?: string): Promise<{ calendar: AcademicCalendarRecord; events: AcademicEventRecord[] } | null> {
    const existing = await this.getPublishedCalendarWithEvents(universityId, academicYear);
    if (
      existing
      && existing.events.length > 0
      && !isUnitSpecificCalendarSource(existing.calendar)
    ) return existing;

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
      : await this.catalogRepository.listUniversities({ status: "active", limit: input.limit ?? readPositiveInteger(process.env.CALENDAR_DISCOVERY_BATCH_SIZE, defaultCatalogDiscoveryLimit), offset: input.offset ?? 0 });

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

  async runDiscoveryAndIngestion(input: { universityId?: string; academicYear?: string; limit?: number; offset?: number; concurrency?: number; retrySourceOnly?: boolean } = {}) {
    const universities = input.universityId
      ? [await this.catalogRepository.findUniversityById(input.universityId)].filter((university): university is UniversityRecord => Boolean(university))
      : await this.catalogRepository.listUniversities({ status: "active", limit: input.limit ?? readPositiveInteger(process.env.CALENDAR_DISCOVERY_BATCH_SIZE, defaultCatalogDiscoveryLimit), offset: input.offset ?? 0 });

    const results = await runWithConcurrency(universities, input.concurrency ?? 2, (university) => this.ingestUniversityCalendar(
      university.id,
      input.academicYear,
      input.retrySourceOnly === undefined ? {} : { retrySourceOnly: input.retrySourceOnly }
    ));
    return {
      summary: {
        checkedUniversities: results.length,
        published: results.filter((result) => result.status === "published" || result.status === "existing").length,
        sourceNotFound: results.filter((result) => result.status === "source_not_found").length,
        noEvents: results.filter((result) => result.status === "no_events").length,
        failed: results.filter((result) => result.status === "failed").length,
        totalEvents: results.reduce((total, result) => total + result.eventCount, 0),
        classificationAudit: aggregateCalendarClassificationAudits(results)
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
      const events = await this.listAllPublishedEvents(existing);
      const refreshRequired = isUnitSpecificCalendarSource(existing)
        || (options.retrySourceOnly === true && events.length === 0);
      if (refreshRequired) {
        try {
          const active = await this.reconcileUsablePublishedSnapshot(universityId, existing.academicYear);
          if (active && (active.events.length === 0 || isUnitSpecificCalendarSource(active.calendar))) {
            throw new Error("No usable published calendar remained after fallback reconciliation.");
          }
        } catch (error) {
          return {
            universityId,
            universityName: university.name,
            status: "failed",
            academicYear: existing.academicYear,
            eventCount: events.length,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
      if (!refreshRequired) {
        try {
          // This scan also repairs a publish that committed before archiving its
          // superseded snapshot or scheduling notifications.
          const active = await this.reconcileUsablePublishedSnapshot(universityId, existing.academicYear);
          if (!active) throw new Error("Published calendar reconciliation produced no winner.");
          if (options.retrySourceOnly !== true) {
            return {
              universityId,
              universityName: university.name,
              status: "existing",
              academicYear: active.calendar.academicYear,
              ...(active.calendar.sourceUrl ? { sourceUrl: active.calendar.sourceUrl } : {}),
              eventCount: active.events.length,
              classificationAudit: classificationAuditFor(active.events)
            };
          }
        } catch (error) {
          return {
            universityId,
            universityName: university.name,
            status: "failed",
            academicYear: existing.academicYear,
            ...(existing.sourceUrl ? { sourceUrl: existing.sourceUrl } : {}),
            eventCount: events.length,
            classificationAudit: classificationAuditFor(events),
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
    }

    try {
      const authority = await resolveCalendarSourceAuthority(university);
      if (university.slug === "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi") {
        return await this.ingestAtuCalendar(university, academicYear, authority);
      }

      const pdf = await discoverAcademicCalendarPdf(
        university,
        readPositiveInteger(process.env.CALENDAR_SOURCE_TIMEOUT_MS, 12000),
        authority
      );
      if (!pdf) {
        this.logger.warn(`Calendar source not found for ${university.name} (${university.id}).`);
        return { universityId, universityName: university.name, status: "source_not_found", eventCount: 0 };
      }
      const result = await this.ingestPdfCalendar(university, pdf, academicYear, authority);
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

  async runScheduledCycle(): Promise<void> {
    await this.runDiscoveryAndIngestion({
      limit: readPositiveInteger(process.env.CALENDAR_DISCOVERY_BATCH_SIZE, defaultCatalogDiscoveryLimit),
      offset: readPositiveInteger(process.env.CALENDAR_DISCOVERY_OFFSET, 0),
      concurrency: readPositiveInteger(process.env.CALENDAR_DISCOVERY_CONCURRENCY, 2),
      retrySourceOnly: true
    });
  }

  private async getPublishedCalendarWithEvents(universityId: string, academicYear?: string) {
    const calendar = await this.calendarRepository.findPublishedCalendar(universityId, academicYear);
    if (!calendar) return null;
    if (!academicYear && !isAcceptableAcademicYear(calendar.academicYear)) return null;
    const events = await this.listAllPublishedEvents(calendar);
    await this.notificationSchedulingService?.scheduleCalendarPublished(calendar, events);
    return { calendar, events };
  }

  private async reconcileUsablePublishedSnapshot(
    universityId: string,
    academicYear: string
  ): Promise<{ calendar: AcademicCalendarRecord; events: AcademicEventRecord[] } | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidates = await this.listPublishedCalendarCandidates(universityId, academicYear);
      if (candidates.length === 0) return null;
      const snapshots = await Promise.all(candidates.map(async (calendar) => ({
        calendar,
        events: await this.listCompletePublishedSnapshotEvents(calendar)
      })));
      const usable = snapshots
        .filter((snapshot) => snapshot.events.length > 0 && !isUnitSpecificCalendarSource(snapshot.calendar))
        .sort((left, right) => compareCalendarPublicationWinner(left.calendar, right.calendar));

      // A source-only calendar is still a recoverable last-known snapshot. Do not
      // archive it unless a complete, usable replacement is already present.
      if (usable.length === 0) return null;

      for (const snapshot of snapshots) {
        if (usable.some((candidate) => candidate.calendar.id === snapshot.calendar.id)) continue;
        await this.calendarRepository.updateCalendar(snapshot.calendar.id, { status: "archived" });
        await this.calendarRepository.updateEventsByCalendar(snapshot.calendar.id, { status: "archived" });
        await this.notificationSchedulingService?.retireCalendarJobs(snapshot.calendar.id);
      }

      // Reconcile only the snapshots proven usable in this bounded observation.
      // A concurrent, unvalidated publisher is intentionally outside this write set
      // and will be assessed in the next loop instead of deleting the last good copy.
      const reconciliation = await this.calendarRepository.reconcilePublishedCalendars(
        universityId,
        academicYear,
        usable.map((snapshot) => snapshot.calendar.id)
      );
      for (const archivedCalendarId of reconciliation.archivedCalendarIds) {
        await this.notificationSchedulingService?.retireCalendarJobs(archivedCalendarId);
      }
      if (!reconciliation.winnerCalendarId) continue;
      const selected = usable.find((snapshot) => snapshot.calendar.id === reconciliation.winnerCalendarId);
      if (!selected) continue;
      const current = await this.calendarRepository.findCalendarById(selected.calendar.id);
      if (!current || current.status !== "published") continue;

      const beforeSchedule = await this.listPublishedCalendarCandidates(universityId, academicYear);
      if (beforeSchedule.some((calendar) => calendar.id !== current.id)) continue;
      await this.notificationSchedulingService?.scheduleCalendarPublished(current, selected.events);
      const afterSchedule = await this.listPublishedCalendarCandidates(universityId, academicYear);
      if (afterSchedule.length === 1 && afterSchedule[0]?.id === current.id) {
        return { calendar: current, events: selected.events };
      }
    }

    throw new Error(`CALENDAR_PUBLICATION_RECONCILIATION_UNSTABLE:${universityId}:${academicYear}`);
  }

  private async listPublishedCalendarCandidates(
    universityId: string,
    academicYear: string
  ): Promise<AcademicCalendarRecord[]> {
    const candidates = (await this.calendarRepository.listPublishedCalendars({
      universityId,
      academicYear,
      limit: 5_001,
      offset: 0
    }))
      .filter((calendar) => calendar.universityId === universityId && calendar.academicYear === academicYear);
    if (candidates.length > 5_000) {
      throw new Error(`CALENDAR_PUBLICATION_RECONCILIATION_LIMIT:${universityId}:${academicYear}`);
    }
    return candidates;
  }

  private async listAllPublishedEvents(calendar: AcademicCalendarRecord): Promise<AcademicEventRecord[]> {
    const maximumEvents = Math.min(
      readPositiveInteger(process.env.CALENDAR_NOTIFICATION_RECONCILIATION_EVENT_LIMIT, 5_000),
      20_000
    );
    const events: AcademicEventRecord[] = [];
    const pageSize = 500;
    while (events.length <= maximumEvents) {
      const page = await this.calendarRepository.listPublishedEvents({
        calendarId: calendar.id,
        universityId: calendar.universityId,
        limit: Math.min(pageSize, maximumEvents + 1 - events.length),
        offset: events.length
      });
      events.push(...page);
      if (page.length < pageSize || events.length > maximumEvents) break;
    }
    if (events.length > maximumEvents) throw new Error(`CALENDAR_NOTIFICATION_RECONCILIATION_EVENT_LIMIT:${calendar.id}`);
    return events;
  }

  private async listCompletePublishedSnapshotEvents(calendar: AcademicCalendarRecord): Promise<AcademicEventRecord[]> {
    const events = await this.calendarRepository.listEventsByCalendar(calendar.id);
    const calendarSnapshotEvents = events.filter((event) => !event.scheduleSeriesId);
    if (
      calendarSnapshotEvents.length === 0
      || calendarSnapshotEvents.some((event) => event.status !== "published")
    ) return [];
    // Course schedule series have an independent archive lifecycle while sharing
    // the university calendar parent. They do not make the base snapshot partial.
    const activeEvents = events.filter((event) => event.status === "published");
    const maximumEvents = Math.min(
      readPositiveInteger(process.env.CALENDAR_NOTIFICATION_RECONCILIATION_EVENT_LIMIT, 5_000),
      20_000
    );
    if (activeEvents.length > maximumEvents) {
      throw new Error(`CALENDAR_NOTIFICATION_RECONCILIATION_EVENT_LIMIT:${calendar.id}`);
    }
    return activeEvents;
  }

  private async ingestAtuCalendar(
    university: UniversityRecord,
    requestedAcademicYear: string | undefined,
    authority: SourceAuthorityContext
  ): Promise<CalendarIngestionResult> {
    let pageError: unknown;
    try {
      const pdf = await discoverAtuAcademicCalendarPdf(
        requestedAcademicYear,
        readPositiveInteger(process.env.CALENDAR_SOURCE_TIMEOUT_MS, 12000),
        authority
      );
      if (pdf) return await this.ingestPdfCalendar(university, pdf, requestedAcademicYear, authority);
    } catch (error) {
      pageError = error;
      this.logger.warn(`ATU calendar page ingestion failed; trying OData fallback: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const odataResult = await this.ingestAtuODataCalendar(university, requestedAcademicYear, authority);
      if (odataResult.status !== "no_events" || !pageError) return odataResult;
    } catch (odataError) {
      if (!pageError) throw odataError;
      throw new Error(
        `ATU_CALENDAR_SOURCES_FAILED:${pageError instanceof Error ? pageError.message : String(pageError)};${odataError instanceof Error ? odataError.message : String(odataError)}`
      );
    }

    throw pageError;
  }

  private async ingestAtuODataCalendar(
    university: UniversityRecord,
    requestedAcademicYear: string | undefined,
    authority: SourceAuthorityContext
  ): Promise<CalendarIngestionResult> {
    const sourceUrl = atuCalendarODataUrl;
    requireSourceAuthority(authority, {
      boundary: "registration",
      resource: "academic_calendar",
      url: sourceUrl
    });
    const rowsFromSource = await fetchAtuCalendarRows(
      readPositiveInteger(process.env.CALENDAR_SOURCE_TIMEOUT_MS, 12000),
      authority
    );
    const activeRows = rowsFromSource.filter((row) => row.Durum === 1 || row.Durum === true).filter((row) => row.AdTR && row.BaslamaTarihi && row.Yil);
    const availableYears = [...new Set(activeRows.map((row) => row.Yil).filter((year): year is number => Number.isInteger(year)))].sort((left, right) => right - left);
    const selectedStartYear = requestedAcademicYear
      ? Number(requestedAcademicYear.slice(0, 4))
      : availableYears.find((year) => isAcceptableAcademicYearStart(year));
    if (!selectedStartYear) return { universityId: university.id, universityName: university.name, status: "no_events", sourceUrl, eventCount: 0 };

    const rows = activeRows.filter((row) => row.Yil === selectedStartYear);
    if (rows.length === 0) return { universityId: university.id, universityName: university.name, status: "no_events", academicYear: `${selectedStartYear}-${selectedStartYear + 1}`, sourceUrl, eventCount: 0 };

    const academicYear = `${selectedStartYear}-${selectedStartYear + 1}`;
    const preparedEventInputs = rows
      .map((row) => toAtuAcademicEvent(row, university.id, academicYear, sourceUrl))
      .filter((event): event is PreparedAcademicEventInput => Boolean(event));
    if (preparedEventInputs.length === 0) {
      return { universityId: university.id, universityName: university.name, status: "no_events", academicYear, sourceUrl, eventCount: 0 };
    }
    requireSourceAuthority(authority, {
      boundary: "publication",
      resource: "academic_calendar",
      url: sourceUrl
    });
    const existing = await this.calendarRepository.findPublishedCalendar(university.id, academicYear);
    if (existing?.sourceUrl === sourceUrl && !isUnitSpecificCalendarSource(existing)) {
      const existingEvents = await this.listAllPublishedEvents(existing);
      if (sameAcademicEventSnapshot(existingEvents, preparedEventInputs)) {
        return {
          universityId: university.id,
          universityName: university.name,
          status: "existing",
          academicYear: existing.academicYear,
          sourceUrl,
          eventCount: existingEvents.length,
          classificationAudit: classificationAuditFor(existingEvents)
        };
      }
    }
    const calendar = await this.calendarRepository.createCalendar({
      universityId: university.id,
      academicYear,
      title: `${university.name} ${academicYear} Akademik Takvimi`,
      status: "draft",
      version: (existing?.version ?? 0) + 1,
      sourceUrl,
      createdBy: "system-calendar-ingestion"
    });

    const eventInputs = preparedEventInputs.map((event) => ({ ...event, calendarId: calendar.id }));
    const events = await this.calendarRepository.createEvents(eventInputs);
    if (events.length === 0) {
      await this.calendarRepository.updateCalendar(calendar.id, { status: "archived" });
      return { universityId: university.id, universityName: university.name, status: "no_events", academicYear, sourceUrl, eventCount: 0 };
    }

    const published = await this.adminCalendarService.publishCalendar(calendar.id, "system-calendar-ingestion");
    return {
      universityId: university.id,
      universityName: university.name,
      status: "published",
      academicYear: published.calendar.academicYear,
      sourceUrl,
      eventCount: published.publishedEvents.length,
      classificationAudit: classificationAuditFor(published.publishedEvents)
    };
  }

  private async ingestPdfCalendar(
    university: UniversityRecord,
    pdf: DiscoveredCalendarPdf,
    requestedAcademicYear: string | undefined,
    authority: SourceAuthorityContext
  ): Promise<CalendarIngestionResult> {
    requireSourceAuthority(authority, {
      boundary: "registration",
      resource: "pdf",
      url: pdf.sourceUrl
    });
    const downloaded = await downloadPdf(
      pdf.sourceUrl,
      readPositiveInteger(process.env.CALENDAR_SOURCE_TIMEOUT_MS, 12000),
      authority
    );
    // Binary identity is cheap and authoritative. Check it before parsing so a
    // scheduled replay of unchanged bytes does not repeat PDF extraction/OCR.
    const verifiedPdfSource = await this.pdfProcessingService.findVerifiedPdfSourceForBytes(
      university.id,
      downloaded.data
    );
    let academicYear: string;
    let pdfSource;
    if (verifiedPdfSource) {
      if (requestedAcademicYear && requestedAcademicYear !== verifiedPdfSource.academicYear) {
        return {
          universityId: university.id,
          universityName: university.name,
          status: "source_not_found",
          sourceUrl: downloaded.finalUrl,
          eventCount: 0,
          error: "CALENDAR_PDF_ACADEMIC_YEAR_MISMATCH"
        };
      }
      if (!requestedAcademicYear && !isAcceptableAcademicYear(verifiedPdfSource.academicYear)) {
        return { universityId: university.id, universityName: university.name, status: "source_not_found", sourceUrl: downloaded.finalUrl, eventCount: 0 };
      }
      academicYear = verifiedPdfSource.academicYear;
      pdfSource = verifiedPdfSource;
    } else {
      const extracted = await extractPdfBinaryText(downloaded.data);
      const inferredAcademicYear = inferAcademicYear([pdf.title, downloaded.fileName, downloaded.finalUrl, extracted.text]);
      if (!requestedAcademicYear && inferredAcademicYear && !isAcceptableAcademicYear(inferredAcademicYear)) {
        return { universityId: university.id, universityName: university.name, status: "source_not_found", sourceUrl: downloaded.finalUrl, eventCount: 0 };
      }
      academicYear = requestedAcademicYear ?? inferredAcademicYear ?? currentAcademicYear();
      pdfSource = await this.pdfProcessingService.createOrReusePdfSource({
        universityId: university.id,
        fileName: downloaded.fileName,
        mimeType: "application/pdf",
        magicBytesHex: downloaded.magicBytesHex,
        fileSize: downloaded.data.byteLength,
        pageCount: extracted.pageCount,
        academicYear,
        uploadedBy: "system-calendar-ingestion",
        rawText: extracted.text,
        url: downloaded.finalUrl,
        pdfData: downloaded.data
      });
    }
    const currentForPdf = await this.calendarRepository.findPublishedCalendar(university.id, academicYear);
    if (
      currentForPdf?.sourcePdfId === pdfSource.id
      && !isUnitSpecificCalendarSource(currentForPdf)
    ) {
      const currentEvents = await this.listAllPublishedEvents(currentForPdf);
      if (currentEvents.length > 0) {
        return {
          universityId: university.id,
          universityName: university.name,
          status: "existing",
          academicYear: currentForPdf.academicYear,
          ...(currentForPdf.sourceUrl ? { sourceUrl: currentForPdf.sourceUrl } : {}),
          eventCount: currentEvents.length,
          classificationAudit: classificationAuditFor(currentEvents)
        };
      }
    }
    const processed = pdfSource.parseStatus === "processed"
      ? await this.pdfProcessingService.loadCompleteExtractedEventSnapshot(pdfSource.id)
      : await this.pdfProcessingService.processPdfSource(pdfSource.id, { pdfData: downloaded.data });
    const publishable = processed.extractedEvents.filter((event) => (
      event.status !== "rejected" && hasAutoPublicationEvidence(event)
    ));
    const approvable = publishable.filter(isAutoApprovableExtractedEvent);
    this.logger.log(`PDF processed for ${university.name}: extracted=${processed.extractedEvents.length}, approvable=${approvable.length}, parseStatus=${processed.pdfSource.parseStatus}, ocr=${processed.pdfSource.ocrProvider ? "yes" : "no"}.`);
    for (const event of approvable) await this.pdfProcessingService.approveExtractedEvent(event.id, "system-calendar-ingestion");
    if (publishable.length === 0) {
      return {
        universityId: university.id,
        universityName: university.name,
        status: "no_events",
        academicYear,
        sourceUrl: downloaded.finalUrl,
        eventCount: 0,
        classificationAudit: classificationAuditFor(processed.extractedEvents)
      };
    }

    requireSourceAuthority(authority, {
      boundary: "publication",
      resource: "academic_calendar",
      url: downloaded.finalUrl
    });
    const draft = await this.adminCalendarService.createDraftFromApprovedExtractedEvents({
      universityId: university.id,
      academicYear,
      title: `${university.name} ${academicYear} Akademik Takvimi`,
      sourcePdfId: pdfSource.id,
      createdBy: "system-calendar-ingestion"
    });
    const published = await this.adminCalendarService.publishCalendar(draft.calendar.id, "system-calendar-ingestion");
    return {
      universityId: university.id,
      universityName: university.name,
      status: "published",
      academicYear,
      sourceUrl: downloaded.finalUrl,
      eventCount: published.publishedEvents.length,
      classificationAudit: classificationAuditFor(published.publishedEvents)
    };
  }

}

export function isAutoApprovableExtractedEvent(
  event: Pick<ExtractedEventRecord, "confidenceScore" | "datePrecision" | "originalDateText" | "rawText" | "sourcePage" | "startDate" | "status">
): boolean {
  return event.status === "pending_review" && hasAutoPublicationEvidence(event);
}

function hasAutoPublicationEvidence(
  event: Pick<ExtractedEventRecord, "confidenceScore" | "datePrecision" | "originalDateText" | "rawText" | "sourcePage" | "startDate">
): boolean {
  const originalDateText = event.originalDateText.trim();
  const rawText = event.rawText.trim();
  return Boolean(
    event.startDate
    && !Number.isNaN(event.startDate.getTime())
    && event.confidenceScore >= 90
    && (event.datePrecision === "day" || event.datePrecision === "date_range")
    && Number.isInteger(event.sourcePage)
    && event.sourcePage > 0
    && originalDateText
    && rawText
    && !/^document publication date fallback:/iu.test(originalDateText)
    && hasExplicitDateEvidence(originalDateText)
    && hasExplicitDateEvidence(rawText)
    && normalizedEvidenceText(rawText).includes(normalizedEvidenceText(originalDateText))
  );
}

function hasExplicitDateEvidence(value: string): boolean {
  const folded = foldText(value);
  return /\b(?:20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]20\d{2}|\d{1,2}\s*(?:[-\u2013\u2014]\s*\d{1,2})?\s+(?:ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2})\b/u.test(folded);
}

function normalizedEvidenceText(value: string): string {
  return foldText(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function sameAcademicEventSnapshot(
  existing: readonly AcademicEventRecord[],
  prepared: readonly PreparedAcademicEventInput[]
): boolean {
  if (existing.length === 0 || existing.length !== prepared.length) return false;
  const existingKeys = existing.map(academicEventSnapshotKey).sort();
  const preparedKeys = prepared.map(academicEventSnapshotKey).sort();
  return existingKeys.every((key, index) => key === preparedKeys[index]);
}

function academicEventSnapshotKey(event: PreparedAcademicEventInput | AcademicEventRecord): string {
  return JSON.stringify([
    event.universityId,
    event.academicYear,
    event.term,
    event.category,
    event.title.trim(),
    event.description?.trim(),
    event.temporalKind,
    event.dateOnlyStart,
    event.startDate.toISOString(),
    event.endTemporalKind,
    event.dateOnlyEnd,
    event.endDate?.toISOString(),
    event.timezone,
    event.originalDateText,
    event.originalText,
    event.sourcePage,
    event.confidenceScore
  ]);
}

function classificationAuditFor(
  records: ReadonlyArray<Pick<AcademicEventRecord, "studentRelevance"> | Pick<ExtractedEventRecord, "studentRelevance">>
): CalendarClassificationAudit {
  return {
    mode: "shadow",
    classificationVersion: STUDENT_RELEVANCE_CLASSIFICATION_VERSION,
    counts: summarizeStudentRelevanceAudit(records.flatMap((record) => (
      record.studentRelevance ? [{ studentRelevance: record.studentRelevance }] : []
    )))
  };
}

function aggregateCalendarClassificationAudits(results: readonly CalendarIngestionResult[]): CalendarClassificationAudit {
  const counts = results.reduce<StudentRelevanceAuditCounts>((total, result) => {
    const current = result.classificationAudit?.counts;
    if (!current) return total;
    total.total += current.total;
    total.relevant += current.relevant;
    total.not_relevant += current.not_relevant;
    total.uncertain += current.uncertain;
    return total;
  }, { total: 0, relevant: 0, not_relevant: 0, uncertain: 0 });
  return {
    mode: "shadow",
    classificationVersion: STUDENT_RELEVANCE_CLASSIFICATION_VERSION,
    counts
  };
}

export async function discoverAtuAcademicCalendarPdf(
  requestedAcademicYear?: string,
  timeoutMs = 12000,
  authority?: SourceAuthorityContext
): Promise<DiscoveredCalendarPdf | null> {
  const payload = await fetchCalendarJson<AtuCalendarPagePayload>(atuCalendarPageApiUrl, timeoutMs, "ATU_CALENDAR_PAGE_FETCH_FAILED", {
    headers: {
      Accept: "application/json",
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.6",
      "User-Agent": "AcademicCalendarPdfCrawler/1.0"
    },
    ...(authority ? { authority } : {})
  });
  const html = payload.d?.HTMLicerik ?? payload.d?.MetinIcerik;
  if (!html) return null;

  const pdf = selectAtuAcademicCalendarPdf(html, requestedAcademicYear);
  if (pdf && authority) {
    requireSourceAuthority(authority, {
      boundary: "registration",
      resource: "pdf",
      url: pdf.sourceUrl
    });
  }
  return pdf;
}

export async function fetchAtuCalendarRows(
  timeoutMs = 12000,
  authority?: SourceAuthorityContext
): Promise<AtuCalendarRow[]> {
  const payload = await fetchCalendarJson<{ d?: AtuCalendarRow[] }>(
    atuCalendarODataUrl,
    timeoutMs,
    "ATU_CALENDAR_FETCH_FAILED",
    { headers: { Accept: "application/json" }, ...(authority ? { authority } : {}) }
  );
  return Array.isArray(payload.d) ? payload.d : [];
}

async function fetchCalendarJson<T>(
  sourceUrl: string,
  timeoutMs: number,
  errorCode: string,
  input: { headers: Record<string, string>; authority?: SourceAuthorityContext }
): Promise<T> {
  const response = await safeOutboundRequest(sourceUrl, {
    timeoutMs,
    maximumRedirects: 5,
    maximumResponseBytes: 5 * 1024 * 1024,
    headers: input.headers,
    validateUrl: (candidate, previousUrl) => requireCalendarFetchUrl(
      candidate,
      sourceUrl,
      previousUrl,
      "academic_calendar",
      input.authority
    )
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${errorCode}:${response.status}`);
  }
  try {
    return JSON.parse(response.body.toString("utf8")) as T;
  } catch {
    throw new Error(`${errorCode}:INVALID_JSON`);
  }
}

export function selectAtuAcademicCalendarPdf(
  html: string,
  requestedAcademicYear?: string
): DiscoveredCalendarPdf | null {
  const targetAcademicYears = requestedAcademicYear
    ? [requestedAcademicYear]
    : [currentAcademicYear(), previousAcademicYear()];
  const candidates = extractAcademicCalendarLinks(html, atuCalendarPageUrl)
    .filter(isAcceptableCalendarSource)
    .filter(isGeneralUndergraduateCalendar);

  for (const academicYear of targetAcademicYears) {
    const candidate = candidates.find((item) => inferAcademicYear([item.title, item.sourceUrl]) === academicYear);
    if (candidate) return candidate;
  }

  return candidates[0] ?? null;
}

export async function discoverAcademicCalendarPdf(
  university: UniversityRecord,
  timeoutMs = 12000,
  authority?: SourceAuthorityContext
): Promise<DiscoveredCalendarPdf | null> {
  const effectiveAuthority = authority ?? await resolveCalendarSourceAuthority(university);
  const verified = await findVerifiedUniversitySource(university.id);
  const yearAwareCandidates = buildYearAwareAcademicCalendarCandidates(university);
  const explicitCalendarUrls = new Set([
    ...yearAwareCandidates,
    university.academicCalendarUrl,
    verified?.calendarUrl
  ].filter((url): url is string => Boolean(url)));
  const homepageCandidates = uniqueUrls([
    ...yearAwareCandidates,
    ...(verified?.calendarUrl ? [verified.calendarUrl] : []),
    ...(university.academicCalendarUrl ? [university.academicCalendarUrl] : []),
    ...buildHomepageCandidates(university)
  ]).slice(0, 16);
  return discoverAcademicCalendarPdfFromHomepages(
    university,
    homepageCandidates,
    timeoutMs,
    explicitCalendarUrls,
    (page) => isLikelyUniversityHomepage(page.text, page.finalUrl, university),
    effectiveAuthority
  );
}

export function buildYearAwareAcademicCalendarCandidates(university: Pick<UniversityRecord, "slug">, date = new Date()): string[] {
  if (university.slug !== "afyon-kocatepe-universitesi-afyonkarahisar") return [];
  return [`https://ogrenci.aku.edu.tr/${currentAcademicYear(date)}/`];
}

export async function discoverAcademicCalendarPdfFromHomepages(
  university: UniversityRecord,
  homepageCandidates: string[],
  timeoutMs: number,
  explicitCalendarUrls: Set<string>,
  isLikelyHomepage: (page: { text: string; finalUrl: string }) => boolean,
  authority?: SourceAuthorityContext
): Promise<DiscoveredCalendarPdf | null> {
  const checked = new Set<string>();

  for (const candidate of homepageCandidates) {
    if (checked.has(candidate)) continue;
    checked.add(candidate);
    const isExplicitCalendarUrl = explicitCalendarUrls.has(candidate);
    if (isExplicitCalendarUrl && looksLikePdfUrl(candidate) && containsCalendarHint(candidate, candidate) && isAcceptableCalendarSource({ sourceUrl: candidate, title: candidate })) {
      if (authority) requireSourceAuthority(authority, { boundary: "registration", resource: "pdf", url: candidate });
      return { sourceUrl: candidate, title: "Akademik Takvim" };
    }

    try {
      const page = await fetchText(candidate, timeoutMs, authority ? { authority, resource: "academic_calendar" } : {});
      if (!isExplicitCalendarUrl && !isLikelyHomepage(page)) continue;
      if (looksLikePdfUrl(page.finalUrl) && containsCalendarHint(page.finalUrl, page.finalUrl) && isAcceptableCalendarSource({ sourceUrl: page.finalUrl, title: page.finalUrl })) {
        if (authority) requireSourceAuthority(authority, { boundary: "registration", resource: "pdf", url: page.finalUrl });
        return { sourceUrl: page.finalUrl, title: "Akademik Takvim" };
      }
      const links = extractAcademicCalendarLinks(page.text, page.finalUrl)
        .filter((link) => authority
          ? isAuthorityAllowed(authority, "pdf", link.sourceUrl)
          : isOfficialContentUrl(link.sourceUrl, page.finalUrl));
      const directPdf = links.find((link) => looksLikePdfUrl(link.sourceUrl) && isAcceptableCalendarSource(link));
      if (directPdf) return directPdf;

      for (const link of links.slice(0, 6)) {
        try {
          const nested = await fetchText(link.sourceUrl, timeoutMs, authority ? { authority, resource: "academic_calendar" } : {});
          const nestedPdf = extractAcademicCalendarLinks(nested.text, nested.finalUrl)
            .filter((nestedLink) => authority
              ? isAuthorityAllowed(authority, "pdf", nestedLink.sourceUrl)
              : isOfficialContentUrl(nestedLink.sourceUrl, page.finalUrl))
            .find((nestedLink) => looksLikePdfUrl(nestedLink.sourceUrl) && isAcceptableCalendarSource(nestedLink));
          if (nestedPdf) return nestedPdf;
        } catch {
          continue;
        }
      }

      for (const path of academicCalendarPaths) {
        const calendarPageUrl = new URL(path, page.finalUrl).toString();
        try {
          const nested = await fetchText(calendarPageUrl, timeoutMs, authority ? { authority, resource: "academic_calendar" } : {});
          const nestedPdf = extractAcademicCalendarLinks(nested.text, nested.finalUrl)
            .filter((nestedLink) => authority
              ? isAuthorityAllowed(authority, "pdf", nestedLink.sourceUrl)
              : isOfficialContentUrl(nestedLink.sourceUrl, page.finalUrl))
            .find((nestedLink) => looksLikePdfUrl(nestedLink.sourceUrl) && isAcceptableCalendarSource(nestedLink));
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

function toAtuAcademicEvent(row: AtuCalendarRow, universityId: string, academicYear: string, sourceUrl: string): PreparedAcademicEventInput | null {
  const startDate = parseODataDate(row.BaslamaTarihi);
  if (!startDate) return null;
  const endDate = parseODataDate(row.BitisTarihi);
  const dateOnlyStart = istanbulCalendarDate(startDate);
  const dateOnlyEnd = endDate ? istanbulCalendarDate(endDate) : undefined;
  const temporal = academicTemporalFields(
    dateOnlyStart,
    dateOnlyEnd && dateOnlyEnd !== dateOnlyStart ? dateOnlyEnd : undefined
  );
  const title = cleanText(row.AdTR?.replace(/\r?\n/g, " ")) || cleanText(row.Aciklama) || "Akademik Takvim Etkinliği";
  return {
    universityId,
    academicYear,
    term: mapTerm(row.DonemAciklama ?? row.Aciklama ?? title),
    category: mapAcademicEventCategory(`${title} ${row.Aciklama ?? ""}`),
    title,
    ...temporal,
    timezone: "Europe/Istanbul",
    originalDateText: `${dateOnlyStart}${dateOnlyEnd ? ` - ${dateOnlyEnd}` : ""}`,
    originalText: `${title} ${row.Aciklama ?? ""}`.trim(),
    sourcePage: 1,
    confidenceScore: 98,
    ...classifyStudentRelevance({ title, ...(row.Aciklama ? { body: row.Aciklama } : {}) }),
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

export async function downloadPdf(
  sourceUrl: string,
  timeoutMs: number,
  authority?: SourceAuthorityContext
): Promise<DownloadedPdf> {
  const response = await safeOutboundRequest(sourceUrl, {
    timeoutMs,
    maximumRedirects: 5,
    maximumResponseBytes: 25 * 1024 * 1024,
    headers: {
      Accept: "application/pdf,*/*;q=0.8",
      "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.7,en;q=0.6",
      "User-Agent": "AcademicCalendarPdfCrawler/1.0"
    },
    validateUrl: (candidate, previousUrl) => requireCalendarFetchUrl(
      candidate,
      sourceUrl,
      previousUrl,
      "pdf",
      authority
    )
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`CALENDAR_PDF_FETCH_FAILED:${response.status}`);
  }
  const data = response.body;
  const magicBytesHex = data.subarray(0, 8).toString("hex");
  if (!magicBytesHex.startsWith("25504446")) throw new Error("CALENDAR_SOURCE_IS_NOT_PDF");
  return {
    finalUrl: response.finalUrl,
    data,
    fileName: fileNameFromUrl(response.finalUrl),
    magicBytesHex
  };
}

async function resolveCalendarSourceAuthority(university: UniversityRecord): Promise<SourceAuthorityContext> {
  const resolved = await resolveSourceAuthorityContext({
    universityId: university.id,
    ownerAcademicEntityId: university.id,
    scopeType: "university",
    scopeId: university.id
  });
  return resolved.context;
}

function isAuthorityAllowed(
  authority: SourceAuthorityContext | undefined,
  resource: "pdf" | "academic_calendar",
  url: string
): boolean {
  if (!authority) return true;
  return evaluateSourceAuthority(authority, {
    boundary: "registration",
    resource,
    url
  }).allowed;
}

function requireCalendarFetchUrl(
  candidate: string,
  sourceUrl: string,
  previousUrl: string | undefined,
  resource: "pdf" | "academic_calendar",
  authority?: SourceAuthorityContext
): string {
  if (!authority) return requireOfficialCalendarSourceUrl(candidate, sourceUrl);
  const decision = requireSourceAuthority(authority, {
    boundary: "fetch",
    resource,
    url: sourceUrl,
    ...(previousUrl ? { finalRedirectUrl: candidate } : {})
  });
  const canonical = previousUrl ? decision.canonicalFinalRedirectUrl : decision.canonicalUrl;
  if (!canonical) throw new Error("SOURCE_AUTHORITY_CANONICAL_URL_MISSING");
  return preserveFetchTrailingSlash(canonical, candidate, previousUrl);
}

function preserveFetchTrailingSlash(canonicalUrl: string, candidate: string, baseUrl?: string): string {
  try {
    const requested = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
    if (requested.pathname.length <= 1 || !requested.pathname.endsWith("/")) return canonicalUrl;
    const fetchUrl = new URL(canonicalUrl);
    if (!fetchUrl.pathname.endsWith("/")) fetchUrl.pathname += "/";
    return fetchUrl.toString();
  } catch {
    return canonicalUrl;
  }
}

function requireOfficialCalendarSourceUrl(candidate: string, officialSourceUrl: string): string {
  if (!isOfficialContentUrl(candidate, officialSourceUrl)) {
    throw new Error("CALENDAR_SOURCE_DOMAIN_UNTRUSTED");
  }
  return candidate;
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

function isGeneralUndergraduateCalendar(source: DiscoveredCalendarPdf): boolean {
  const text = foldText(`${source.title} ${source.sourceUrl}`);
  if (/\b(lisansustu|yadyo|yabanci diller|hazirlik)\b/u.test(text)) return false;
  return /\b(on lisans|onlisans|lisans)\b/u.test(text);
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

function compareCalendarPublicationWinner(left: AcademicCalendarRecord, right: AcademicCalendarRecord): number {
  return right.version - left.version
    || right.createdAt.getTime() - left.createdAt.getTime()
    || right.id.localeCompare(left.id, "en-US");
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

function uniqueUrls(values: string[]): string[] {
  return [...new Set(values)];
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
