import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listVerifiedAcademicUnitSources, listVerifiedUniversitySources } from "../src/bootstrap/verified-source-registry.js";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress,
  type SafeOutboundHopResponse
} from "../src/common/network/safe-outbound-request.js";
import { ANNOUNCEMENT_PROCESSING_VERSION, AnnouncementIngestionService, discoverAnnouncementSourceForUniversity, isSourceDue, runAnnouncementSourcesWithConcurrency, YOK_ANNOUNCEMENT_SCOPE_ID } from "../src/modules/announcements/announcement-ingestion.service.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import {
  cleanText,
  fetchSourceItems,
  fetchText,
  parseAnkaraUniversityAnnouncementHtml,
  parseGenericAnnouncementHtml,
  parseHtmlAnchors,
  parseJsonAnnouncements,
  parseSyndicatedAnnouncements,
  parseYokAnnouncementHtml,
  toAnnouncementItems
} from "../src/modules/announcements/announcement-parser.js";
import { AnnouncementsService } from "../src/modules/announcements/announcements.service.js";
import type { AnnouncementItem, AnnouncementPersistenceDelta, AnnouncementReplacementOptions, AnnouncementSourceRecord } from "../src/modules/announcements/announcements.types.js";
import type { AuthRepository, AuthUserRecord } from "../src/modules/auth/auth.types.js";
import type { CatalogRepository, UniversityRecord } from "../src/modules/catalog/catalog.types.js";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";
import { NotificationSchedulingService } from "../src/modules/notifications/notifications.service.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/announcements/${name}`, import.meta.url), "utf8");

const sampleUniversity: UniversityRecord = {
  id: "abdullah-gul-universitesi-kayseri",
  name: "ABDULLAH GÜL ÜNİVERSİTESİ (KAYSERİ)",
  slug: "abdullah-gul-universitesi-kayseri",
  city: "KAYSERİ",
  type: "state",
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date()
};

afterEach(() => {
  setSafeOutboundRequestDependenciesForTesting(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("announcement discovery and ingestion", () => {
  it("serializes fetches to the same host while using concurrency across different hosts", async () => {
    const now = new Date();
    const source = (id: string, sourceUrl: string): AnnouncementSourceRecord => ({
      id,
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: id,
      sourceUrl,
      canonicalUrl: sourceUrl,
      contentType: "announcement",
      parser: "auto",
      priority: 1,
      status: "active",
      trustStatus: "trusted",
      createdAt: now,
      updatedAt: now
    });
    const sources = [
      source("same-a", "https://news.example.edu.tr/a"),
      source("other", "https://announcements.other.edu.tr/a"),
      source("same-b", "https://news.example.edu.tr/b")
    ];
    const activeByHost = new Map<string, number>();
    let maxGlobal = 0;
    let activeGlobal = 0;

    const results = await runAnnouncementSourcesWithConcurrency(sources, 3, async (candidate) => {
      const host = new URL(candidate.sourceUrl).hostname;
      const hostActive = (activeByHost.get(host) ?? 0) + 1;
      activeByHost.set(host, hostActive);
      activeGlobal += 1;
      maxGlobal = Math.max(maxGlobal, activeGlobal);
      expect(hostActive).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeByHost.set(host, hostActive - 1);
      activeGlobal -= 1;
      return candidate.id;
    });

    expect(results).toEqual(["same-a", "other", "same-b"]);
    expect(maxGlobal).toBeGreaterThan(1);
  });

  it("bounds each scheduled cycle to the configured source batch size", async () => {
    vi.stubEnv("ANNOUNCEMENT_INGEST_BATCH_SIZE", "2");
    const repository = new InMemoryAnnouncementRepository();
    for (let index = 0; index < 3; index += 1) {
      await repository.upsertSource({
        scopeType: "university",
        scopeId: `${sampleUniversity.id}-${index}`,
        sourceName: `Source ${index}`,
        sourceUrl: `https://source-${index}.example.edu.tr/announcements`,
        contentType: "announcement",
        parser: "auto",
        priority: 1,
        status: "active",
        trustStatus: "trusted"
      });
    }
    const service = new AnnouncementIngestionService(createCatalogRepository([sampleUniversity]), repository);
    const ingest = vi.spyOn(service, "ingestSource").mockImplementation(async (candidate) => ({
      sourceId: candidate.id,
      sourceName: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      status: "healthy",
      itemCount: 0,
      sampleTitles: []
    }));

    await service.runScheduledCycle();

    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it("schedules never-checked and oldest-checked due sources before priority with a deterministic id tie-break", async () => {
    vi.stubEnv("ANNOUNCEMENT_INGEST_BATCH_SIZE", "3");
    const repository = new InMemoryAnnouncementRepository();
    const definitions = [
      { id: "source-newer", priority: 100, lastCheckedAt: new Date("2020-02-01T00:00:00.000Z") },
      { id: "source-never-b", priority: 90 },
      { id: "source-oldest", priority: 80, lastCheckedAt: new Date("2020-01-01T00:00:00.000Z") },
      { id: "source-never-a", priority: 1 }
    ];
    for (const definition of definitions) {
      await repository.upsertSource({
        id: definition.id,
        scopeType: "university",
        scopeId: `${sampleUniversity.id}-${definition.id}`,
        sourceName: definition.id,
        sourceUrl: `https://${definition.id}.example.edu.tr/announcements`,
        contentType: "announcement",
        parser: "auto",
        priority: definition.priority,
        status: "active",
        trustStatus: "trusted",
        fetchIntervalMinutes: 5,
        ...(definition.lastCheckedAt ? { lastCheckedAt: definition.lastCheckedAt } : {})
      });
    }
    const service = new AnnouncementIngestionService(createCatalogRepository([sampleUniversity]), repository);
    const ingest = vi.spyOn(service, "ingestSource").mockImplementation(async (candidate) => ({
      sourceId: candidate.id,
      sourceName: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      status: "healthy",
      itemCount: 1,
      sampleTitles: []
    }));

    await service.runScheduledCycle();

    expect(ingest.mock.calls.map(([source]) => source.id)).toEqual([
      "source-never-a",
      "source-never-b",
      "source-oldest"
    ]);
  });

  it("pages every active trusted source during an explicit source refresh", async () => {
    const now = new Date("2026-09-10T08:00:00.000Z");
    const sources = Array.from({ length: 1_001 }, (_, index): AnnouncementSourceRecord => ({
      id: `source-${String(index).padStart(4, "0")}`,
      scopeType: "university",
      scopeId: `university-${index}`,
      sourceName: `Source ${index}`,
      sourceUrl: `https://source-${index}.example.edu.tr/announcements`,
      canonicalUrl: `https://source-${index}.example.edu.tr/announcements`,
      contentType: "announcement",
      parser: "auto",
      priority: 1,
      status: "active",
      trustStatus: "trusted",
      createdAt: now,
      updatedAt: now
    }));
    const listAllSources = vi.fn(async (input: { limit?: number; offset?: number }) =>
      sources.slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 500)));
    const service = new AnnouncementIngestionService(
      createCatalogRepository([]),
      { listAllSources } as never
    );
    vi.spyOn(service, "runSourceDiscovery").mockResolvedValue({
      summary: {
        checkedUniversities: 0,
        sourceFound: 0,
        homepageFoundNoItems: 0,
        homepageNotFound: 0,
        totalParsedItems: 0
      },
      results: []
    });
    const ingest = vi.spyOn(service, "ingestSource").mockImplementation(async (candidate) => ({
      sourceId: candidate.id,
      sourceName: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      status: "healthy",
      itemCount: 1,
      sampleTitles: []
    }));

    const result = await service.runDiscoveryAndIngestion({ refreshSources: true, concurrency: 10 });

    expect(result.ingestionResults).toHaveLength(1_001);
    expect(ingest).toHaveBeenCalledTimes(1_001);
    expect(listAllSources).toHaveBeenNthCalledWith(1, { status: "active", limit: 1_000, offset: 0 });
    expect(listAllSources).toHaveBeenNthCalledWith(2, { status: "active", limit: 1_000, offset: 1_000 });
  });

  it("does not repeat full discovery on scheduler ticks while every candidate is still quarantined", async () => {
    const repository = new InMemoryAnnouncementRepository();
    await repository.insertQuarantinedSourceCandidate({
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: "Awaiting review",
      sourceUrl: "https://www.agu.edu.tr/duyurular",
      contentType: "announcement",
      parser: "auto",
      priority: 1,
      homepageUrl: "https://www.agu.edu.tr/",
      discoveryMethod: "catalog_website",
      trustReasonCodes: []
    });
    const service = new AnnouncementIngestionService(createCatalogRepository([sampleUniversity]), repository);
    const discovery = vi.spyOn(service, "runDiscoveryAndIngestion");

    await service.runScheduledCycle();
    await service.runScheduledCycle();

    expect(discovery).not.toHaveBeenCalled();
  });

  it("pages past the first 1000 active sources so later due sources are not starved", async () => {
    vi.stubEnv("ANNOUNCEMENT_INGEST_BATCH_SIZE", "2");
    const repository = new InMemoryAnnouncementRepository();
    const recentlyCheckedAt = new Date();
    for (let index = 0; index < 1_001; index += 1) {
      await repository.upsertSource({
        scopeType: "university",
        scopeId: `${sampleUniversity.id}-${index}`,
        sourceName: `Paged source ${String(index).padStart(4, "0")}`,
        sourceUrl: `https://paged-${index}.example.edu.tr/announcements`,
        contentType: "announcement",
        parser: "auto",
        priority: 1,
        status: "active",
        trustStatus: "trusted",
        ...(index < 1_000 ? { lastCheckedAt: recentlyCheckedAt, fetchIntervalMinutes: 180 } : {})
      });
    }
    const service = new AnnouncementIngestionService(createCatalogRepository([sampleUniversity]), repository);
    const ingest = vi.spyOn(service, "ingestSource").mockImplementation(async (candidate) => ({
      sourceId: candidate.id,
      sourceName: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      status: "healthy",
      itemCount: 0,
      sampleTitles: []
    }));

    await service.runScheduledCycle();

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0]?.[0].sourceName).toBe("Paged source 1000");
  });

  it("provisions registry candidates as inactive quarantine without mutating an explicitly approved source", async () => {
    const tekirdag: UniversityRecord = {
      id: "tekirdag-namik-kemal-universitesi",
      name: "TEKİRDAĞ NAMIK KEMAL ÜNİVERSİTESİ",
      slug: "tekirdag-namik-kemal-universitesi",
      city: "Tekirdağ",
      type: "state",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const catalog = createCatalogRepository([tekirdag]);
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog, repository);

    const approved = await repository.upsertSource({
      scopeType: "university",
      scopeId: tekirdag.id,
      sourceName: "Approved source",
      sourceUrl: "https://nku.edu.tr/duyurular",
      parser: "auto",
      priority: 100,
      status: "active",
      trustStatus: "trusted"
    });
    const approvedBefore = JSON.stringify(approved);

    const firstProvision = await service.provisionStaticAnnouncementSources();
    const sources = await repository.listAllSources({ limit: 5_000 });
    const approvedAfter = await repository.findSourceById(approved.id);

    expect(sources.some((source) => source.scopeId === tekirdag.id && new URL(source.sourceUrl).hostname.endsWith("yok.gov.tr"))).toBe(false);
    expect(sources.every((source) => source.scopeId === YOK_ANNOUNCEMENT_SCOPE_ID || source.scopeId === tekirdag.id)).toBe(true);
    expect(sources.filter((source) => source.id !== approved.id)).not.toEqual([]);
    expect(sources.filter((source) => source.id !== approved.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "inactive", trustStatus: "quarantined" })
    ]));
    expect(JSON.stringify(approvedAfter)).toBe(approvedBefore);
    expect(await repository.listSourcesByScope({ universityId: YOK_ANNOUNCEMENT_SCOPE_ID })).toEqual([]);
    expect(firstProvision.total).toBe(firstProvision.created + firstProvision.skipped);
    expect(firstProvision.created).toBeGreaterThan(0);

    const repeatedProvision = await service.provisionStaticAnnouncementSources();
    expect(repeatedProvision).toEqual({
      created: 0,
      skipped: firstProvision.total,
      evidenceAttached: 0,
      evidenceConflicts: 0,
      total: firstProvision.total
    });
  });

  it("provisions one idempotent source per content type when a scope shares the same URL", async () => {
    const university: UniversityRecord = {
      id: "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi",
      name: "ADANA ALPARSLAN TÜRKEŞ BİLİM VE TEKNOLOJİ ÜNİVERSİTESİ",
      slug: "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi",
      city: "Adana",
      type: "state",
      websiteUrl: "https://www.atu.edu.tr/",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(createCatalogRepository([university]), repository);

    const first = await service.provisionStaticAnnouncementSources();
    const scoped = (await repository.listAllSources({ limit: 5_000 }))
      .filter((source) => source.scopeId === university.id && source.canonicalUrl === "https://www.atu.edu.tr/");

    expect(scoped.map((source) => source.contentType).sort()).toEqual(["announcement", "event", "news"]);
    expect(new Set(scoped.map((source) => source.id))).toHaveProperty("size", 3);

    const repeated = await service.provisionStaticAnnouncementSources();
    expect(repeated).toEqual({
      created: 0,
      skipped: first.total,
      evidenceAttached: 0,
      evidenceConflicts: 0,
      total: first.total
    });
    expect((await repository.listAllSources({ limit: 5_000 }))
      .filter((source) => source.scopeId === university.id && source.canonicalUrl === "https://www.atu.edu.tr/"))
      .toHaveLength(3);
  });

  it("does not add a registry duplicate when a validated legacy GTU URL already exists", async () => {
    const gtu: UniversityRecord = {
      id: "gebze-teknik-universitesi",
      name: "GEBZE TEKNÄ°K ÃœNÄ°VERSÄ°TESÄ°",
      slug: "gebze-teknik-universitesi",
      city: "KOCAELÄ°",
      type: "state",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const repository = new InMemoryAnnouncementRepository();
    const legacy = await repository.upsertSource({
      scopeType: "university",
      scopeId: gtu.id,
      sourceName: "Approved legacy GTU source",
      sourceUrl: "https://www.gtu.edu.tr/tr/icerik/9/30904/display.aspx",
      homepageUrl: "https://www.gtu.edu.tr/",
      contentType: "announcement",
      parser: "auto",
      priority: 30,
      status: "active",
      trustStatus: "trusted"
    });
    const before = JSON.stringify(legacy);

    await new AnnouncementIngestionService(createCatalogRepository([gtu]), repository)
      .provisionStaticAnnouncementSources();

    const gtuSources = (await repository.listAllSources({ limit: 5_000 }))
      .filter((source) => source.scopeId === gtu.id);
    expect(gtuSources).toHaveLength(1);
    expect(JSON.stringify(gtuSources[0])).toBe(before);
  });

  it("keeps every independently approved source upgrade in the static registries", async () => {
    const universities = await listVerifiedUniversitySources();
    const academicUnits = await listVerifiedAcademicUnitSources();
    const universitySource = (id: string) => universities.find((source) => source.universityId === id);

    expect(universitySource("gebze-teknik-universitesi")?.announcementUrl)
      .toBe("https://www.gtu.edu.tr/icerik/9/30904/display.aspx");
    expect(universitySource("ihsan-dogramaci-bilkent-universitesi-ankara")?.announcementUrl)
      .toBe("https://bilkentnews.bilkent.edu.tr/");
    expect(universitySource("istanbul-beykent-universitesi")?.announcementUrl)
      .toBe("https://www.beykent.edu.tr/duyurular");
    expect(universitySource("istanbul-teknik-universitesi")?.announcementUrl)
      .toBe("https://haberler.itu.edu.tr/");
    expect(universitySource("kahramanmaras-sutcu-imam-universitesi")?.announcementUrl)
      .toBe("https://www.ksu.edu.tr/default?DId=103100");
    expect(academicUnits.find((source) => source.departmentId === "abdullah-gul-universitesi-kayseri__muhendislik-fakultesi__elektrik-elektronik-muhendisligi")?.newsUrl)
      .toBe("https://eee.agu.edu.tr/haberler");
  });

  it("keeps bootstrap, source lists, ingestion, student feeds, and YÖK reads free of implicit source writes", async () => {
    vi.stubEnv("ANNOUNCEMENT_AUTO_INGEST_ENABLED", "false");
    const repository = new InMemoryAnnouncementRepository();
    const ingestion = new AnnouncementIngestionService(createCatalogRepository([sampleUniversity]), repository);
    const announcements = new AnnouncementsService(createAuthRepository(), repository, undefined, ingestion);

    await expect(ingestion.listSources()).resolves.toEqual([]);
    await expect(ingestion.runIngestion()).resolves.toEqual({
      summary: {
        checkedSources: 0,
        healthy: 0,
        degraded: 0,
        failed: 0,
        totalParsedItems: 0,
        classificationAudit: {
          mode: "shadow",
          classificationVersion: "student-relevance-rules-v2",
          counts: { total: 0, relevant: 0, not_relevant: 0, uncertain: 0 }
        }
      },
      results: []
    });
    await expect(announcements.getMyAnnouncementsCollection("student-1", 20)).resolves.toEqual({
      items: [], state: "fresh", sourceCount: 0, failedSourceCount: 0
    });
    await expect(announcements.getYokAnnouncementsCollection(20)).resolves.toEqual({
      items: [], state: "fresh", sourceCount: 0, failedSourceCount: 0
    });
    expect(await repository.listAllSources({ limit: 5_000 })).toEqual([]);
  });

  it("keeps an existing rejected source byte-for-byte stable across repeated read operations", async () => {
    vi.stubEnv("ANNOUNCEMENT_AUTO_INGEST_ENABLED", "false");
    const repository = new InMemoryAnnouncementRepository();
    await repository.upsertSource({
      scopeType: "university",
      scopeId: YOK_ANNOUNCEMENT_SCOPE_ID,
      sourceName: "Rejected YÖK candidate",
      sourceUrl: "http://www.yok.gov.tr/tr/announcements/",
      homepageUrl: "https://www.yok.gov.tr/tr",
      parser: "rss",
      priority: 3,
      status: "inactive",
      trustStatus: "rejected",
      trustReasonCodes: ["unofficial_source"],
      healthStatus: "failed",
      lastError: "manual rejection"
    });
    const before = JSON.stringify(await repository.listAllSources({ limit: 100 }));
    const ingestion = new AnnouncementIngestionService(createCatalogRepository([sampleUniversity]), repository);
    const announcements = new AnnouncementsService(createAuthRepository(), repository, undefined, ingestion);

    await ingestion.listSources();
    await ingestion.listSources({ status: "active" });
    await ingestion.runIngestion();
    await announcements.getMyAnnouncementsCollection("student-1", 20);
    await announcements.getYokAnnouncementsCollection(20);

    expect(JSON.stringify(await repository.listAllSources({ limit: 100 }))).toBe(before);
  });

  it("discovers a university announcement page and parses items", async () => {
    stubFetch({
      "https://agu.edu.tr": `<html><title>Abdullah Gül Üniversitesi</title><body><a href="/duyurular">Duyurular</a></body></html>`,
      "https://agu.edu.tr/duyurular": `<html><body><a href="/duyuru/1">Yeni öğrenci duyurusu</a><a href="/duyuru/2">Akademik takvim duyurusu</a></body></html>`
    });

    const result = await discoverAnnouncementSourceForUniversity(sampleUniversity, { timeoutMs: 1000 });

    expect(result.status).toBe("source_found");
    expect(result.sourceUrl).toBe("https://agu.edu.tr/duyurular");
    expect(result.itemCount).toBe(2);
  });

  it("inserts discovered sources once as quarantined candidates and leaves every existing trust decision byte-for-byte unchanged", async () => {
    stubFetch({
      "https://agu.edu.tr": `<html><title>Abdullah Gül Üniversitesi</title><body><a href="/duyurular">Duyurular</a></body></html>`,
      "https://agu.edu.tr/duyurular": `<html><body><a href="/duyuru/1">Yeni öğrenci duyurusu</a><a href="/duyuru/2">Akademik takvim duyurusu</a></body></html>`
    });

    for (const trustStatus of ["trusted", "rejected", "quarantined"] as const) {
      const repository = new InMemoryAnnouncementRepository();
      const existing = await repository.upsertSource({
        scopeType: "university",
        scopeId: sampleUniversity.id,
        sourceName: `Existing ${trustStatus}`,
        sourceUrl: "http://www.agu.edu.tr/duyurular/",
        parser: "rss",
        priority: 77,
        status: trustStatus === "trusted" ? "active" : "inactive",
        trustStatus,
        trustReasonCodes: trustStatus === "trusted" ? [] : ["unofficial_source"]
      });
      const before = JSON.stringify(existing);

      await new AnnouncementIngestionService(createCatalogRepository([sampleUniversity]), repository)
        .runSourceDiscovery({ concurrency: 1 });

      expect(JSON.stringify(await repository.findSourceById(existing.id))).toBe(before);
      expect(await repository.listAllSources({ limit: 100 })).toHaveLength(1);
    }

    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(createCatalogRepository([sampleUniversity]), repository);
    await Promise.all([
      service.runSourceDiscovery({ concurrency: 1 }),
      service.runSourceDiscovery({ concurrency: 1 })
    ]);
    expect(await repository.listAllSources({ limit: 100 })).toEqual([
      expect.objectContaining({ status: "inactive", trustStatus: "quarantined" })
    ]);
    expect(await repository.listAllSources({ status: "active", limit: 100 })).toEqual([]);
  });

  it("stores fetched announcement items in the repository cache", async () => {
    stubFetch({
      "https://agu.edu.tr/duyurular": `<html><body><a href="/duyuru/1">Yeni öğrenci duyurusu</a></body></html>`
    });
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: "AGU Duyurular",
      sourceUrl: "https://agu.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    const service = new AnnouncementIngestionService(createCatalogRepository([sampleUniversity]), repository);

    const result = await service.runIngestion();
    const items = await repository.listItemsForSource(source.id, 10);

    expect(result.summary.healthy).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({ sourceId: source.id, title: "Yeni öğrenci duyurusu" }));
  });

  it("uses source validators, skips unchanged bodies, and rejects one empty snapshot without losing trusted items", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: "AGU Announcements",
      sourceUrl: "https://agu.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    const trustedBody = '<html><body><a href="/duyuru/1">Ders kaydi duyurusu</a></body></html>';
    const seenHeaders: Array<Record<string, unknown>> = [];
    let responseIndex = 0;
    const publicAddress: ResolvedOutboundAddress = { address: "93.184.216.34", family: 4 };
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop: async (url, pinnedAddress, input) => {
        if (url !== source.sourceUrl) {
          return {
            status: 200,
            headers: { "content-type": "text/html" },
            body: Buffer.from("<article><h1>Ders kaydi duyurusu</h1><p>Kayıt ayrıntıları.</p></article>"),
            remoteAddress: pinnedAddress.address
          };
        }
        seenHeaders.push({ ...input.headers });
        const response = responseIndex++;
        if (response === 1) {
          return {
            status: 304,
            headers: { etag: '"v1"', "last-modified": "Wed, 02 Sep 2026 08:00:00 GMT" },
            body: Buffer.alloc(0),
            remoteAddress: pinnedAddress.address
          };
        }
        if (response === 3) {
          return {
            status: 200,
            headers: { etag: '"v2"', "last-modified": "Thu, 03 Sep 2026 08:00:00 GMT" },
            body: Buffer.from('<div class="announcement-listing">No announcements found</div>'),
            remoteAddress: pinnedAddress.address
          };
        }
        return {
          status: 200,
          headers: { etag: '"v1"', "last-modified": "Wed, 02 Sep 2026 08:00:00 GMT" },
          body: Buffer.from(trustedBody),
          remoteAddress: pinnedAddress.address
        };
      }
    });
    const replaceItems = vi.spyOn(repository, "replaceItemsForSource");
    const service = new AnnouncementIngestionService(createCatalogRepository([sampleUniversity]), repository);

    const first = await service.ingestSource(source);
    const firstItems = await repository.listItemsForSource(source.id);
    expect(first).toMatchObject({
      status: "healthy",
      itemCount: 1,
      classificationAudit: {
        mode: "shadow",
        counts: { total: 1, relevant: 1, not_relevant: 0, uncertain: 0 }
      }
    });
    expect(firstItems).toHaveLength(1);
    const acceptedSource = await repository.findSourceById(source.id);
    expect(acceptedSource).toMatchObject({
      etag: '"v1"',
      lastModified: "Wed, 02 Sep 2026 08:00:00 GMT",
      contentHash: expect.stringMatching(/^[a-f\d]{64}$/u),
      processingVersion: ANNOUNCEMENT_PROCESSING_VERSION,
      itemCount: 1,
      healthStatus: "healthy"
    });
    expect(seenHeaders[0]).not.toHaveProperty("If-None-Match");
    expect(seenHeaders[0]).not.toHaveProperty("If-Modified-Since");

    await service.ingestSource(acceptedSource!);
    const after304 = await repository.findSourceById(source.id);
    await service.ingestSource(after304!);
    const afterSameHash = await repository.findSourceById(source.id);
    const emptyResult = await service.ingestSource(afterSameHash!);

    expect(replaceItems).toHaveBeenCalledTimes(1);
    expect(seenHeaders[1]).toMatchObject({
      "If-None-Match": '"v1"',
      "If-Modified-Since": "Wed, 02 Sep 2026 08:00:00 GMT"
    });
    expect(emptyResult).toMatchObject({
      status: "degraded",
      itemCount: 0,
      error: "SOURCE_EMPTY_SNAPSHOT_REJECTED"
    });
    expect(await repository.listItemsForSource(source.id)).toEqual(firstItems);
    expect(await repository.findSourceById(source.id)).toMatchObject({
      healthStatus: "degraded",
      itemCount: 1,
      etag: '"v1"'
    });
    await service.ingestSource((await repository.findSourceById(source.id))!);
    const recoveredSource = await repository.findSourceById(source.id);
    expect(recoveredSource).toMatchObject({
      healthStatus: "healthy",
      consecutiveFailures: 0,
      itemCount: 1,
      etag: '"v1"'
    });
    expect(recoveredSource?.lastError).toBeUndefined();
    expect(replaceItems).toHaveBeenCalledTimes(1);
  });

  it("reconciles every pending notification after activation-to-sync crash on a 304 retry", async () => {
    const snapshotA = "64a000000000000000000011";
    const snapshotB = "64a000000000000000000012";
    const repository = new SnapshotPointerAnnouncementRepository(snapshotB);
    const created = await repository.upsertSource({
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: "AGU Announcements",
      sourceUrl: "https://agu.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted",
      etag: '"snapshot-a"',
      lastModified: "Wed, 02 Sep 2026 08:00:00 GMT",
      contentHash: "a".repeat(64),
      processingVersion: ANNOUNCEMENT_PROCESSING_VERSION,
      itemCount: 7
    });
    repository.setActiveSnapshot(created.id, snapshotA);
    const sourceA = await repository.findSourceById(created.id);
    if (!sourceA) throw new Error("Expected source A.");
    const pendingItems = Array.from({ length: 101 }, (_, index): AnnouncementItem => ({
      id: `pending-${String(index).padStart(3, "0")}`,
      sourceId: sourceA.id,
      sourceName: sourceA.sourceName,
      contentType: "announcement",
      scopeType: sourceA.scopeType,
      scopeId: sourceA.scopeId,
      title: `2026 student registration announcement ${index + 1}`,
      summary: `Registration details ${index + 1}`,
      link: `https://agu.edu.tr/duyuru/pending-${index + 1}`,
      publicationKind: "date",
      publishedDate: "2026-09-02",
      publicationTimeSource: "source",
      fetchedAt: "2026-09-02T08:00:00.000Z",
      trustStatus: "trusted"
    }));

    const activated = await repository.replaceItemsForSource(sourceA, pendingItems);
    expect(activated).toEqual(expect.objectContaining({
      snapshotId: snapshotB,
      previousSnapshotId: snapshotA,
      created: expect.arrayContaining([expect.objectContaining({ snapshotId: snapshotB })])
    }));
    expect(activated.created).toHaveLength(101);
    await approveAllReviewItems(repository, sourceA.id);

    const sourceB = await repository.findSourceById(created.id);
    if (!sourceB) throw new Error("Expected source B.");
    const listItems = vi.spyOn(repository, "listItemsForSource");
    const notifications = new InMemoryNotificationRepository();
    const scheduling = new NotificationSchedulingService(notifications, repository);
    stubOutboundRequest((_url) => ({
      status: 304,
      headers: {
        etag: '"snapshot-a"',
        "last-modified": "Wed, 02 Sep 2026 08:00:00 GMT"
      },
      body: ""
    }));

    const service = new AnnouncementIngestionService(
      createCatalogRepository([sampleUniversity]),
      repository,
      scheduling
    );
    const result = await service.ingestSource(sourceB);

    expect(result.status).toBe("healthy");
    expect(listItems).toHaveBeenCalledWith(sourceB.id, 100, 0);
    expect(listItems).toHaveBeenCalledWith(sourceB.id, 100, 100);
    expect(await notifications.listDueJobs(new Date("2100-01-01T00:00:00.000Z"), 200)).toHaveLength(101);
    const persistedItems = await repository.listItemsForSource(sourceB.id, 200);
    expect(persistedItems).toHaveLength(101);
    expect(persistedItems.every((item) =>
      item.notificationProducedFingerprint === item.notificationEligibleFingerprint
    )).toBe(true);
    expect(await repository.findSourceById(sourceB.id)).toEqual(expect.objectContaining({
      activeSnapshotId: snapshotB,
      healthStatus: "healthy",
      itemCount: 101
    }));
  });

  it("records a notification-sync failure against the snapshot that was just activated", async () => {
    const snapshotA = "64a000000000000000000031";
    const snapshotB = "64a000000000000000000032";
    const repository = new SnapshotPointerAnnouncementRepository(snapshotB);
    const created = await repository.upsertSource({
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: "AGU Announcements",
      sourceUrl: "https://agu.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted",
      itemCount: 9
    });
    repository.setActiveSnapshot(created.id, snapshotA);
    const sourceA = await repository.findSourceById(created.id);
    if (!sourceA) throw new Error("Expected source A.");
    stubFetch({
      "https://agu.edu.tr/duyurular": '<html><body><a href="/duyuru/new">New student registration announcement</a></body></html>'
    });
    const scheduling = {
      syncTrustedAnnouncementSource: async () => {
        throw new Error("SIMULATED_NOTIFICATION_SYNC_CRASH");
      }
    } as unknown as NotificationSchedulingService;
    const service = new AnnouncementIngestionService(
      createCatalogRepository([sampleUniversity]),
      repository,
      scheduling
    );

    await expect(service.ingestSource(sourceA)).resolves.toEqual(expect.objectContaining({
      status: "degraded",
      itemCount: 0,
      error: "SIMULATED_NOTIFICATION_SYNC_CRASH"
    }));
    expect(await repository.findSourceById(sourceA.id)).toEqual(expect.objectContaining({
      activeSnapshotId: snapshotB,
      healthStatus: "degraded",
      lastError: "SIMULATED_NOTIFICATION_SYNC_CRASH",
      itemCount: 1
    }));
  });

  it("does not attach a stale 304 health result or validators to a concurrently newer snapshot", async () => {
    const snapshotA = "64a000000000000000000041";
    const snapshotB = "64a000000000000000000042";
    const repository = new SnapshotPointerAnnouncementRepository(snapshotB);
    const created = await repository.upsertSource({
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: "AGU Announcements",
      sourceUrl: "https://agu.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted",
      etag: '"snapshot-a"',
      contentHash: "a".repeat(64),
      processingVersion: ANNOUNCEMENT_PROCESSING_VERSION,
      healthStatus: "healthy",
      itemCount: 7
    });
    repository.setActiveSnapshot(created.id, snapshotA);
    const sourceA = await repository.findSourceById(created.id);
    if (!sourceA) throw new Error("Expected source A.");
    stubOutboundRequest(() => {
      repository.updateSourceState(created.id, {
        activeSnapshotId: snapshotB,
        etag: '"snapshot-b"',
        contentHash: "b".repeat(64),
        healthStatus: "healthy",
        itemCount: 13
      });
      return {
        status: 304,
        headers: { etag: '"snapshot-a"' },
        body: ""
      };
    });
    const service = new AnnouncementIngestionService(createCatalogRepository([sampleUniversity]), repository);

    await expect(service.ingestSource(sourceA)).resolves.toEqual(expect.objectContaining({
      status: "degraded",
      error: "ANNOUNCEMENT_NOTIFICATION_SNAPSHOT_CONFLICT"
    }));
    expect(await repository.findSourceById(created.id)).toEqual(expect.objectContaining({
      activeSnapshotId: snapshotB,
      etag: '"snapshot-b"',
      contentHash: "b".repeat(64),
      healthStatus: "healthy",
      itemCount: 13
    }));
    expect((await repository.findSourceById(created.id))?.lastError).toBeUndefined();
  });

  it("keeps same-snapshot jobs when stale deactivate cleanup finishes after reactivation and 304 reconciliation", async () => {
    const snapshotB = "64a000000000000000000072";
    const repository = new SnapshotPointerAnnouncementRepository(snapshotB);
    const created = await repository.upsertSource({
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: "AGU Announcements",
      sourceUrl: "https://agu.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted",
      etag: '"snapshot-b"',
      contentHash: "b".repeat(64),
      processingVersion: ANNOUNCEMENT_PROCESSING_VERSION,
      itemCount: 1
    });
    const initialItem: AnnouncementItem = {
      id: "same-snapshot-item",
      sourceId: created.id,
      sourceName: created.sourceName,
      contentType: "announcement",
      scopeType: created.scopeType,
      scopeId: created.scopeId,
      title: "Same snapshot student registration announcement",
      summary: "Registration remains open.",
      link: "https://agu.edu.tr/duyuru/same-snapshot",
      publicationKind: "date",
      publishedDate: "2026-09-02",
      publicationTimeSource: "source",
      fetchedAt: "2026-09-02T08:00:00.000Z",
      trustStatus: "trusted"
    };
    await repository.replaceItemsForSource(created, [initialItem]);
    const approved = await approveReviewItem(repository, initialItem.id);
    const sourceGenerationA = await repository.findSourceById(created.id);
    if (!sourceGenerationA?.notificationProducerVersion) throw new Error("Expected producer generation A.");
    const notifications = new TargetedSnapshotRetireGateNotificationRepository();
    const scheduling = new NotificationSchedulingService(notifications, repository);
    const initialNow = new Date("2026-09-02T08:01:00.000Z");
    await scheduling.syncTrustedAnnouncementSource(sourceGenerationA, approved.delta, initialNow);
    expect(await notifications.listDueJobs(initialNow, 10)).toHaveLength(1);

    const inactiveGenerationA = await repository.deactivateSource(created.id, {
      ...(created.sourceDefinitionVersion ? { expectedSourceDefinitionVersion: created.sourceDefinitionVersion } : {}),
      expectedCanonicalUrl: created.canonicalUrl ?? created.sourceUrl,
      expectedTrustStatus: created.trustStatus ?? "quarantined",
      expectedSourceStatus: created.status,
      expectedApprovalPending: created.approvalPending === true
    });
    if (!inactiveGenerationA) throw new Error("Expected inactive generation A.");
    const producerKeyA = `announcement-source:${created.id}:generation:${sourceGenerationA.notificationProducerVersion}:snapshot:${snapshotB}`;
    notifications.gateNextRetirement(producerKeyA);
    const staleCleanup = scheduling.syncTrustedAnnouncementSource(inactiveGenerationA, {
      created: [],
      materiallyUpdated: [],
      unchanged: [],
      removed: []
    }, initialNow);
    await notifications.retirementStarted;

    const reactivated = await repository.upsertSource({
      scopeType: sourceGenerationA.scopeType,
      scopeId: sourceGenerationA.scopeId,
      sourceName: sourceGenerationA.sourceName,
      sourceUrl: sourceGenerationA.sourceUrl,
      ...(sourceGenerationA.canonicalUrl ? { canonicalUrl: sourceGenerationA.canonicalUrl } : {}),
      contentType: sourceGenerationA.contentType ?? "announcement",
      parser: sourceGenerationA.parser,
      priority: sourceGenerationA.priority,
      status: "active",
      ...(sourceGenerationA.homepageUrl ? { homepageUrl: sourceGenerationA.homepageUrl } : {}),
      ...(sourceGenerationA.discoveryMethod ? { discoveryMethod: sourceGenerationA.discoveryMethod } : {}),
      ...(sourceGenerationA.etag ? { etag: sourceGenerationA.etag } : {}),
      ...(sourceGenerationA.contentHash ? { contentHash: sourceGenerationA.contentHash } : {}),
      ...(sourceGenerationA.processingVersion ? { processingVersion: sourceGenerationA.processingVersion } : {}),
      ...(sourceGenerationA.itemCount !== undefined ? { itemCount: sourceGenerationA.itemCount } : {}),
      trustStatus: "trusted",
      id: sourceGenerationA.id
    });
    expect(reactivated.activeSnapshotId).toBe(snapshotB);
    expect(reactivated.notificationProducerVersion).not.toBe(sourceGenerationA.notificationProducerVersion);
    stubOutboundRequest(() => ({
      status: 304,
      headers: { etag: '"snapshot-b"' },
      body: ""
    }));
    const service = new AnnouncementIngestionService(
      createCatalogRepository([sampleUniversity]),
      repository,
      scheduling
    );

    const retry = await service.ingestSource(reactivated);
    notifications.releaseRetirement();
    await staleCleanup;

    const producerKeyB = `announcement-source:${created.id}:generation:${reactivated.notificationProducerVersion}:snapshot:${snapshotB}`;
    expect(retry.status).toBe("healthy");
    await expect(notifications.listDueJobs(new Date("2100-01-01T00:00:00.000Z"), 10)).resolves.toEqual([
      expect.objectContaining({
        calendarId: producerKeyB,
        producerKey: producerKeyB,
        producerKeys: [producerKeyB],
        status: "scheduled"
      })
    ]);
  });

  it("loads ATU hash-route announcements from the university OData service", async () => {
    stubOutboundRequest((input) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/Siteler")) {
        expect(url.searchParams.get("$filter")).toContain("AlanAdi eq 'www'");
        return { body: JSON.stringify({ d: [{ ID: 1 }] }) };
      }
      if (url.pathname.endsWith("/V_GuncelIcerik")) {
        expect(url.searchParams.get("$filter")).toContain("GrupTipi eq 2");
        return { body: JSON.stringify({
          d: [{
            GuID: "ede0278f-9f26-4b6a-96e5-ee10c516ba27",
            Baslik: "2026-2027 Egitim-Ogretim Yili Yatay Gecis Duyurusu",
            AltBaslik: "Basvurular acildi.",
            HTMLicerik: '<a href="https://ogrenci.atu.edu.tr/#!/duyuru/d98b041b-e0f2-4704-bd22-b51944c1ea47">Detay</a>',
            BaslamaTarihi: "/Date(1783641600000)/"
          }]
        }) };
      }
      return { body: "not found", status: 404 };
    });

    const items = await fetchSourceItems("https://www.atu.edu.tr/#!/TR/duyurular/", "auto", 1000);

    expect(items).toEqual([expect.objectContaining({
      title: "2026-2027 Egitim-Ogretim Yili Yatay Gecis Duyurusu",
      link: "https://ogrenci.atu.edu.tr/#!/duyuru/d98b041b-e0f2-4704-bd22-b51944c1ea47",
      summary: "Basvurular acildi.",
      publishedAt: new Date(1783641600000)
    })]);
  });

  it("returns university, faculty, and department announcements in the student announcement feed", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const fetchedAt = new Date().toISOString();
    const universitySource = await repository.upsertSource({
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: "University Announcements",
      sourceUrl: "https://agu.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    const facultySource = await repository.upsertSource({
      scopeType: "faculty",
      scopeId: "faculty-1",
      sourceName: "Faculty Announcements",
      sourceUrl: "https://faculty.agu.edu.tr/duyurular",
      parser: "auto",
      priority: 30,
      status: "active",
      trustStatus: "trusted"
    });
    const departmentSource = await repository.upsertSource({
      scopeType: "department",
      scopeId: "department-1",
      sourceName: "Department Announcements",
      sourceUrl: "https://department.agu.edu.tr/duyurular",
      parser: "auto",
      priority: 40,
      status: "active",
      trustStatus: "trusted"
    });

    await repository.replaceItemsForSource(universitySource, [{
      id: "university-announcement",
      sourceId: universitySource.id,
      sourceName: universitySource.sourceName,
      scopeType: "university",
      scopeId: sampleUniversity.id,
      title: "University registration announcement",
      link: "https://agu.edu.tr/duyuru/university",
      fetchedAt
    }]);
    await repository.replaceItemsForSource(facultySource, [{
      id: "faculty-announcement",
      sourceId: facultySource.id,
      sourceName: facultySource.sourceName,
      scopeType: "faculty",
      scopeId: "faculty-1",
      title: "Faculty orientation announcement",
      link: "https://faculty.agu.edu.tr/duyuru/faculty",
      fetchedAt
    }]);
    await repository.replaceItemsForSource(departmentSource, [{
      id: "department-announcement",
      sourceId: departmentSource.id,
      sourceName: departmentSource.sourceName,
      scopeType: "department",
      scopeId: "department-1",
      title: "Department exam announcement",
      link: "https://department.agu.edu.tr/duyuru/department",
      fetchedAt
    }]);
    await approveAllReviewItems(repository, universitySource.id);
    await approveAllReviewItems(repository, facultySource.id);
    await approveAllReviewItems(repository, departmentSource.id);

    const service = new AnnouncementsService(createAuthRepository(), repository, createCatalogRepository([sampleUniversity]));

    const result = await service.getMyAnnouncements("student-1", 10);

    expect(result).toHaveLength(3);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scopeType: "university",
        scopeId: sampleUniversity.id,
        title: "University registration announcement"
      }),
      expect.objectContaining({
        scopeType: "faculty",
        scopeId: "faculty-1",
        title: "Faculty orientation announcement"
      }),
      expect.objectContaining({
        scopeType: "department",
        scopeId: "department-1",
        title: "Department exam announcement"
      })
    ]));
  });

  it("refuses direct ingestion of a source until it is both active and explicitly trusted", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const candidate = await repository.upsertSource({
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: "Unreviewed source",
      sourceUrl: "https://agu.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active"
    });
    const service = new AnnouncementIngestionService(createCatalogRepository([sampleUniversity]), repository);

    await expect(service.ingestSource(candidate)).rejects.toThrow("Only active, trusted announcement sources can be ingested.");
  });

  it("merges announcements from additional followed universities without duplicating the primary scope", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const fetchedAt = new Date().toISOString();
    const primarySource = await repository.upsertSource({
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: "Primary university",
      sourceUrl: "https://agu.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    const followedSource = await repository.upsertSource({
      scopeType: "university",
      scopeId: "u-followed",
      sourceName: "Followed university",
      sourceUrl: "https://followed.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(primarySource, [{
      id: "primary-item",
      sourceId: primarySource.id,
      sourceName: primarySource.sourceName,
      scopeType: "university",
      scopeId: sampleUniversity.id,
      title: "Primary announcement",
      link: "https://agu.edu.tr/duyurular/primary",
      fetchedAt
    }]);
    await repository.replaceItemsForSource(followedSource, [{
      id: "followed-item",
      sourceId: followedSource.id,
      sourceName: followedSource.sourceName,
      scopeType: "university",
      scopeId: "u-followed",
      title: "Followed announcement",
      link: "https://followed.edu.tr/duyurular/followed",
      fetchedAt
    }]);
    await approveAllReviewItems(repository, primarySource.id);
    await approveAllReviewItems(repository, followedSource.id);
    const service = new AnnouncementsService(
      createAuthRepository(),
      repository,
      createCatalogRepository([sampleUniversity]),
      undefined,
      undefined,
      {
        async listFollowedAcademicScopesByUserId() {
          return [
            { id: "duplicate-primary", userId: "student-1", universityId: sampleUniversity.id, createdAt: new Date() },
            { id: "followed", userId: "student-1", universityId: "u-followed", createdAt: new Date() }
          ];
        }
      }
    );

    const result = await service.getMyAnnouncements("student-1", 10);

    expect(result.map((item) => item.title).sort()).toEqual(["Followed announcement", "Primary announcement"]);
  });

  it("prefers leading listing dates over later deadline dates", () => {
    const items = parseHtmlAnchors(
      `<a href="/duyuru/1">22.06.2026 Öğrenci SÜYÖS-2026 tercihleri 22-Haziran-10 Temmuz 2026 tarihleri arasında yapılacaktır</a>`,
      "https://selcuk.edu.tr/icerik/ogrenciduyurulari"
    );

    expect(items[0]).toEqual(expect.objectContaining({
      publicationKind: "date",
      publishedDate: "2026-06-22"
    }));
    expect(items[0]).not.toHaveProperty("publishedAt");
  });

  it("ignores share links even when the listing URL contains an announcement keyword", () => {
    const items = parseHtmlAnchors(
      `<a href="#">WhatsApp</a><a href="/duyuru/1">22.06.2026 Ogrenci tercih duyurusu</a>`,
      "https://selcuk.edu.tr/icerik/ogrenciduyurulari"
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toContain("tercih duyurusu");
  });

  it("ignores pagination and navigation anchors", () => {
    const items = parseHtmlAnchors(
      [
        `<a href="/duyurular?page=2">Next</a>`,
        `<a href="/duyuru/2">Read more</a>`,
        `<a href="/duyurular/all">Show more</a>`,
        `<a href="/duyuru/1">22.06.2026 Ogrenci sinav duyurusu</a>`
      ].join(""),
      "https://selcuk.edu.tr/icerik/ogrenciduyurulari"
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toContain("sinav duyurusu");
  });

  it("drops stale formation announcement artifacts from previous academic years", () => {
    const items = parseHtmlAnchors(
      [
        `<a href="/detail.aspx?id=56247">2022-2023 Bahar Donemi Formasyon Tek Ders Sinav Duyurusu</a>`,
        `<a href="/upload/egitim/formasyon-2023.docx">Pedagojik Formasyon Sertifika Programi 2022-2023 Bahar Donemi Akademik Takvimi Duyurusu</a>`,
        `<a href="/upload/egitim/formasyon-2024.xlsx">2024 Formasyon Ders Programi Duyurusu</a>`,
        `<a href="/detail.aspx?id=70000">2026-2027 Akademik Takvim Duyurusu</a>`
      ].join(""),
      "https://www.agri.edu.tr/haberduyuru.aspx?bid=1&tid=2"
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      title: "2026-2027 Akademik Takvim Duyurusu",
      link: "https://www.agri.edu.tr/detail.aspx?id=70000"
    }));
  });

  it("decodes named, decimal, hexadecimal, and nested HTML entities safely", () => {
    expect(cleanText("&amp;amp;amp;raquo;&nbsp;A &amp; B &deg;&ensp;&#304; &#x15F; &#99999999; &unknown;"))
      .toBe("» A & B ° İ ş");
  });

  it("does not infer source publication time from an arbitrary date in a title", () => {
    const items = parseGenericAnnouncementHtml(
      `<article><a href="/duyuru/sinav">31.07.2026 Sınav ve Başvuru Duyurusu</a></article>`,
      "https://example.edu.tr/duyurular"
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("31.07.2026 Sınav ve Başvuru Duyurusu");
    expect(items[0]?.publishedAt).toBeUndefined();
  });

  it("keeps the exact source title markup as audit evidence while displaying normalized text", () => {
    const rawTitle = "<strong>&raquo;&nbsp;Burs &amp; Başvuru Duyurusu</strong>";
    const items = parseGenericAnnouncementHtml(
      `<article><a href="/duyuru/burs">${rawTitle}</a></article>`,
      "https://example.edu.tr/duyurular"
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.rawTitle).toBe(rawTitle);
    expect(items[0]?.title).toBe("Burs & Başvuru Duyurusu");
  });

  it("parses the YÖK fixture, strips chrome, keeps source timestamps, and canonicalizes duplicates", () => {
    const items = parseYokAnnouncementHtml(fixture("yok.html"));

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      title: "Yükseköğretim Kurulu & Üniversiteler için İş Birliği Duyurusu ş",
      link: "https://www.yok.gov.tr/tr/announcements/yuksekogretim-kurulu-bilgilendirme-duyurusu?id=42",
      publishedAt: new Date("2026-07-28T05:30:00.000Z"),
      sourceUpdatedAt: new Date("2026-07-29T11:45:00.000Z")
    }));
    expect(items[0]?.rawTitle).toContain("&raquo;");
    expect(items[0]?.summary).toBe("Öğrenciler & akademisyenler için resmî bilgilendirme.");
  });

  it("parses the Ankara University fixture with publication and update time kept separate", () => {
    expect(fixture("ankara-university.html").match(/class="post announcement"/gu)).toHaveLength(2);
    const items = parseAnkaraUniversityAnnouncementHtml(fixture("ankara-university.html"));

    expect(items).toEqual([expect.objectContaining({
      title: "2026-2027 Eğitim-Öğretim Yılı Yatay Geçiş Başvuru Duyurusu",
      link: "https://oidb.ankara.edu.tr/2026-2027-yatay-gecis-duyurusu?a=1&b=2",
      publishedAt: new Date("2026-07-21T06:00:00.000Z"),
      sourceUpdatedAt: new Date("2026-07-23T13:15:00.000Z"),
      summary: "Başvuru koşulları, belgeler & değerlendirme takvimi açıklanmıştır."
    })]);
  });

  it("rejects adapter layouts where one plausible row is the only surviving signal", () => {
    expect(() => parseYokAnnouncementHtml(`
      <main>
        <article class="announcement-card">
          <a href="/tr/announcements/one">Tek geçerli görünen duyuru</a>
        </article>
      </main>
    `)).toThrow("SOURCE_LAYOUT_INVALID:YOK");
    expect(() => parseAnkaraUniversityAnnouncementHtml(`
      <div id="content">
        <article class="post announcement">
          <h2 class="entry-title"><a href="/duyuru/one">Tek geçerli görünen duyuru</a></h2>
        </article>
      </div>
    `)).toThrow("SOURCE_LAYOUT_INVALID:ANKARA");
  });

  it("quarantines plausible rows from a broken known layout as source-health failure", async () => {
    stubFetch({
      "https://www.yok.gov.tr/tr/announcements": `
        <main>
          <article class="announcement-card">
            <a href="/tr/announcements/one">Tek geçerli görünen duyuru</a>
          </article>
        </main>
      `
    });
    const repository = new InMemoryAnnouncementRepository();
    await repository.upsertSource({
      scopeType: "university",
      scopeId: YOK_ANNOUNCEMENT_SCOPE_ID,
      sourceName: "YÖK Duyuruları",
      sourceUrl: "https://www.yok.gov.tr/tr/announcements",
      homepageUrl: "https://www.yok.gov.tr/tr",
      parser: "auto",
      priority: 100,
      status: "active",
      trustStatus: "trusted"
    });
    const service = new AnnouncementIngestionService(createCatalogRepository([]), repository);

    const result = await service.runIngestion({ concurrency: 1 });
    const items = await repository.listItemsByScope({ universityId: YOK_ANNOUNCEMENT_SCOPE_ID, limit: 10 });
    const sources = await repository.listAllSources({ status: "active", limit: 10 });
    const yokSource = sources.find((source) => source.scopeId === YOK_ANNOUNCEMENT_SCOPE_ID);

    expect(result.summary.degraded).toBe(1);
    expect(result.results[0]?.error).toBe("SOURCE_LAYOUT_INVALID:YOK");
    expect(items).toEqual([]);
    expect(yokSource).toEqual(expect.objectContaining({
      healthStatus: "degraded",
      lastError: "SOURCE_LAYOUT_INVALID:YOK",
      itemCount: 0
    }));
  });

  it("classifies a visible update-only time element without fabricating publication time", () => {
    const items = parseGenericAnnouncementHtml(`
      <article>
        <a href="/duyuru/kayit-yenileme">Kayıt Yenileme Duyurusu</a>
        <time datetime="2026-07-23T13:15:00Z">Güncellenme Tarihi: 23 Temmuz 2026</time>
      </article>
    `, "https://example.edu.tr/duyurular");
    expect(items).toHaveLength(1);
    expect(items[0]?.publishedAt).toBeUndefined();
    expect(items[0]?.sourceUpdatedAt?.toISOString()).toBe("2026-07-23T13:15:00.000Z");
  });

  it("dispatches fetched YÖK and Ankara University HTML to their source-specific parsers and other HTML to the generic fallback", async () => {
    stubFetch({
      "https://www.yok.gov.tr/tr/announcements": fixture("yok.html"),
      "https://oidb.ankara.edu.tr/gecmis-duyurular": fixture("ankara-university.html"),
      "https://example.edu.tr/duyurular": fixture("generic.html")
    });

    const [yokItems, ankaraItems, genericItems] = await Promise.all([
      fetchSourceItems("https://www.yok.gov.tr/tr/announcements", "auto", 1_000),
      fetchSourceItems("https://oidb.ankara.edu.tr/gecmis-duyurular/", "auto", 1_000),
      fetchSourceItems("https://example.edu.tr/duyurular", "auto", 1_000)
    ]);

    expect(yokItems).toHaveLength(1);
    expect(yokItems[0]?.sourceUpdatedAt?.toISOString()).toBe("2026-07-29T11:45:00.000Z");
    expect(ankaraItems).toHaveLength(1);
    expect(ankaraItems[0]?.publishedAt?.toISOString()).toBe("2026-07-21T06:00:00.000Z");
    expect(genericItems).toHaveLength(1);
    expect(genericItems[0]?.link).toBe("https://example.edu.tr/duyuru/uluslararasi-ogrenciler-icin-kayit-ve-uyum-programi?a=1&z=9");
    expect(genericItems[0]?.publishedAt).toBeUndefined();
  });

  it("parses the generic fixture with a long Turkish title and rejects unsafe or unofficial links", () => {
    const items = parseGenericAnnouncementHtml(fixture("generic.html"), "https://example.edu.tr/duyurular/");

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Uluslararası Öğrenciler İçin Kayıt, Akademik Danışmanlık, Kampüs Yaşamı ve Uyum Programı Hakkında Ayrıntılı Bilgilendirme Duyurusu & Başvuru Rehberi Şı");
    expect(items[0]?.link).toBe("https://example.edu.tr/duyuru/uluslararasi-ogrenciler-icin-kayit-ve-uyum-programi?a=1&z=9");
    expect(items[0]?.publishedAt).toBeUndefined();
  });

  it("rejects every required navigation and chrome label in HTML, JSON, RSS, and Atom", () => {
    const labels = [
      "Sonraki",
      "Önceki",
      "Ana Sayfa",
      "Bağlı Kuruluşlar",
      "Geçmiş Duyurular",
      "Tüm Duyurular",
      "Devamını Oku",
      "İletişim",
      "AGÜ NEWS",
      "1 / 10",
      "Sayfa 2 / 10",
      "6 of 10 --",
      "Alt Bilgi",
      "Yan Menü"
    ];
    const sourceUrl = "https://example.edu.tr/duyurular";
    const html = labels.map((title, index) => `<a href="/duyuru/${index}">${title}</a>`).join("");
    const json = JSON.stringify(labels.map((title, index) => ({ title, url: `/duyuru/${index}` })));
    const feed = [
      "<rss><channel>",
      ...labels.map((title, index) => `<item><title>${title}</title><link>${sourceUrl}/${index}</link></item>`),
      "</channel></rss><feed>",
      ...labels.map((title, index) => `<entry><title>${title}</title><link href="${sourceUrl}/atom-${index}" /></entry>`),
      "</feed>"
    ].join("");

    expect(parseHtmlAnchors(html, sourceUrl)).toEqual([]);
    expect(parseJsonAnnouncements(json, sourceUrl)).toEqual([]);
    expect(parseSyndicatedAnnouncements(feed, sourceUrl)).toEqual([]);
  });

  it("keeps Atom publication and source-update timestamps distinct", () => {
    const items = parseSyndicatedAnnouncements(
      `<feed><entry>
        <title>2026 Öğrenci Kayıt Duyurusu</title>
        <link href="/duyuru/kayit?utm_source=feed" />
        <published>2026-07-18T09:00:00+03:00</published>
        <updated>2026-07-20T11:30:00+03:00</updated>
      </entry></feed>`,
      "https://example.edu.tr/duyurular"
    );

    expect(items).toEqual([expect.objectContaining({
      publishedAt: new Date("2026-07-18T06:00:00.000Z"),
      sourceUpdatedAt: new Date("2026-07-20T08:30:00.000Z")
    })]);
  });

  it("converts syndicated source content to sanitized body and explicit key-date blocks", () => {
    const [item] = parseSyndicatedAnnouncements(
      `<rss><channel><item>
        <title>2026 Akademik Takvim Güncellemesi</title>
        <link>https://example.edu.tr/duyuru/takvim-guncellemesi</link>
        <description><![CDATA[Önemli akademik tarihler güncellendi.]]></description>
        <content:encoded><![CDATA[
          <script>alert('x')</script>
          <p>Üniversitemiz senato kararıyla takvim güncellenmiştir.</p>
          <h3>Kayıt Yenileme</h3><p>20 – 24 Mayıs 2026</p>
          <h3>Final Sınavları</h3><p>23 Haziran – 04 Temmuz 2026</p>
        ]]></content:encoded>
      </item></channel></rss>`,
      "https://example.edu.tr/duyurular"
    );

    expect(item?.body).toEqual(expect.arrayContaining([
      { type: "paragraph", text: "Üniversitemiz senato kararıyla takvim güncellenmiştir." },
      { type: "heading", text: "Kayıt Yenileme" },
      { type: "paragraph", text: "20 – 24 Mayıs 2026" },
    ]));
    expect(item?.keyDates).toEqual([
      { label: "Kayıt Yenileme", startDate: "2026-05-20", endDate: "2026-05-24" },
      { label: "Final Sınavları", startDate: "2026-06-23", endDate: "2026-07-04" },
    ]);
    expect(JSON.stringify(item)).not.toContain("alert");
    expect(JSON.stringify(item)).not.toContain("<script");
  });

  it("never substitutes crawl time for a missing source publication time", () => {
    const source: AnnouncementSourceRecord = {
      id: "source-generic",
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Example Üniversitesi Duyuruları",
      sourceUrl: "https://example.edu.tr/duyurular",
      canonicalUrl: "https://example.edu.tr/duyurular",
      contentType: "announcement",
      parser: "html",
      priority: 10,
      status: "active",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z")
    };
    const parsed = parseGenericAnnouncementHtml(fixture("generic.html"), source.sourceUrl);
    const fetchedAt = new Date("2026-07-30T12:00:00.000Z");
    const items = toAnnouncementItems(source, parsed, fetchedAt);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      canonicalUrl: "https://example.edu.tr/duyuru/uluslararasi-ogrenciler-icin-kayit-ve-uyum-programi?a=1&z=9",
      officialSourceUrl: "https://example.edu.tr/duyurular",
      discoveredAt: fetchedAt.toISOString(),
      fetchedAt: fetchedAt.toISOString(),
      trustStatus: "trusted",
      freshness: "fresh",
      dedupeKey: expect.any(String)
    }));
    expect(items[0]?.publishedAt).toBeUndefined();
    expect(items[0]?.publicationTimeSource).toBeUndefined();
  });

  it("rejects unsafe fetch sources and cross-official-domain redirects before reading content", async () => {
    await expect(fetchText("javascript:alert(1)", 100)).rejects.toThrow("SOURCE_URL_UNSAFE");
    stubOutboundRequest(() => ({
      body: "",
      status: 302,
      headers: { location: "https://evil.example/duyurular" }
    }));

    await expect(fetchText("https://example.edu.tr/duyurular", 100)).rejects.toThrow("SOURCE_REDIRECT_UNOFFICIAL");
  });

  it("honors each source's configured refresh interval", () => {
    const source = {
      id: "source-1",
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: "Duyurular",
      sourceUrl: "https://agu.edu.tr/duyurular",
      parser: "auto",
      priority: 50,
      status: "active",
      fetchIntervalMinutes: 30,
      lastCheckedAt: new Date("2026-08-13T09:00:00.000Z"),
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-13T09:00:00.000Z")
    } satisfies AnnouncementSourceRecord;

    expect(isSourceDue(source, new Date("2026-08-13T09:29:59.999Z"))).toBe(false);
    expect(isSourceDue(source, new Date("2026-08-13T09:30:00.000Z"))).toBe(true);
    expect(isSourceDue({ ...source, status: "inactive" }, new Date("2026-08-13T10:00:00.000Z"))).toBe(false);
  });
});

function stubFetch(pages: Record<string, string>): void {
  stubOutboundRequest((requestUrl) => {
    const normalized = requestUrl.replace(/\/$/u, "");
    const body = pages[normalized];
    return { body: body ?? "<html></html>", status: body ? 200 : 404 };
  });
}

function stubOutboundRequest(handler: (url: string) => {
  body: string;
  status?: number;
  headers?: SafeOutboundHopResponse["headers"];
}): void {
  const publicAddress: ResolvedOutboundAddress = { address: "93.184.216.34", family: 4 };
  setSafeOutboundRequestDependenciesForTesting({
    resolveHostname: async () => [publicAddress],
    requestHop: async (url, pinnedAddress) => {
      const response = handler(url);
      return {
        status: response.status ?? 200,
        headers: response.headers ?? {},
        body: Buffer.from(response.body),
        remoteAddress: pinnedAddress.address
      };
    }
  });
}

function createCatalogRepository(universities: UniversityRecord[]): CatalogRepository {
  return {
    async createUniversity() {
      throw new Error("not used");
    },
    async updateUniversity() {
      throw new Error("not used");
    },
    async archiveUniversity() {
      throw new Error("not used");
    },
    async findUniversityById(id: string) {
      return universities.find((university) => university.id === id) ?? null;
    },
    async listUniversities(input) {
      return universities.slice(input.offset, input.offset + input.limit);
    },
    async findUniversityByEmailDomain() {
      return null;
    },
    async createFaculty() {
      throw new Error("not used");
    },
    async updateFaculty() {
      throw new Error("not used");
    },
    async listFaculties() {
      return [];
    },
    async createDepartment() {
      throw new Error("not used");
    },
    async updateDepartment() {
      throw new Error("not used");
    },
    async listDepartments() {
      return [];
    }
  };
}

async function approveReviewItem(repository: InMemoryAnnouncementRepository, itemId: string) {
  const current = await repository.findReviewItemById(itemId);
  if (!current?.item.contentFingerprint) throw new Error("Expected persisted review item.");
  const mutation = await repository.updateReviewItem(itemId, { reviewStatus: "approved" }, {
    ...(current.item.snapshotId ? { expectedSnapshotId: current.item.snapshotId } : {}),
    expectedContentFingerprint: current.item.contentFingerprint,
    ...(current.item.reviewRevision ? { expectedReviewRevision: current.item.reviewRevision } : {})
  });
  if (!mutation) throw new Error("Expected review mutation.");
  return mutation;
}

async function approveAllReviewItems(repository: InMemoryAnnouncementRepository, sourceId: string) {
  for (const item of await repository.listReviewItems({ sourceIds: [sourceId] })) {
    if (item.reviewStatus !== "approved") await approveReviewItem(repository, item.id);
  }
}

class SnapshotPointerAnnouncementRepository extends InMemoryAnnouncementRepository {
  constructor(private readonly nextSnapshotId: string) {
    super();
  }

  setActiveSnapshot(sourceId: string, snapshotId: string): void {
    this.updateSourceState(sourceId, { activeSnapshotId: snapshotId });
  }

  updateSourceState(sourceId: string, patch: Partial<AnnouncementSourceRecord>): void {
    const sources = (this as unknown as {
      sources: Map<string, AnnouncementSourceRecord>;
    }).sources;
    const source = sources.get(sourceId);
    if (!source) throw new Error("Expected source to set snapshot pointer.");
    sources.set(sourceId, { ...source, ...patch });
  }

  override async replaceItemsForSource(
    source: AnnouncementSourceRecord,
    items: AnnouncementItem[],
    options: AnnouncementReplacementOptions = {}
  ): Promise<AnnouncementPersistenceDelta> {
    const previousSnapshotId = source.activeSnapshotId;
    const delta = await super.replaceItemsForSource(source, items, options);
    const sources = (this as unknown as {
      sources: Map<string, AnnouncementSourceRecord>;
    }).sources;
    const storedSource = sources.get(source.id);
    if (!storedSource) throw new Error("Expected persisted source.");
    sources.set(source.id, { ...storedSource, activeSnapshotId: this.nextSnapshotId });

    const itemStore = (this as unknown as {
      items: Map<string, AnnouncementItem[]>;
    }).items;
    itemStore.set(source.id, (itemStore.get(source.id) ?? []).map((item) => ({
      ...item,
      snapshotId: this.nextSnapshotId
    })));
    const withSnapshot = (references: AnnouncementPersistenceDelta["created"]) =>
      references.map((reference) => ({ ...reference, snapshotId: this.nextSnapshotId }));
    return {
      created: withSnapshot(delta.created),
      materiallyUpdated: withSnapshot(delta.materiallyUpdated),
      unchanged: withSnapshot(delta.unchanged),
      removed: delta.removed,
      snapshotId: this.nextSnapshotId,
      ...(previousSnapshotId ? { previousSnapshotId } : {})
    };
  }
}

class TargetedSnapshotRetireGateNotificationRepository extends InMemoryNotificationRepository {
  private targetProducerKey: string | undefined;
  private didGate = false;
  private signalRetirementStarted!: () => void;
  private continueRetirement!: () => void;
  readonly retirementStarted = new Promise<void>((resolve) => {
    this.signalRetirementStarted = resolve;
  });
  private readonly retirementRelease = new Promise<void>((resolve) => {
    this.continueRetirement = resolve;
  });

  gateNextRetirement(producerKey: string): void {
    this.targetProducerKey = producerKey;
  }

  releaseRetirement(): void {
    this.continueRetirement();
  }

  override async retireProducedJobs(producerKey: string): Promise<number> {
    if (!this.didGate && producerKey === this.targetProducerKey) {
      this.didGate = true;
      this.signalRetirementStarted();
      await this.retirementRelease;
    }
    return super.retireProducedJobs(producerKey);
  }
}

function createAuthRepository(): AuthRepository {
  const now = new Date();
  const user: AuthUserRecord = {
    id: "student-1",
    credentialGeneration: 0,
    fullName: "Student",
    email: "student@agu.edu.tr",
    passwordHash: "hash",
    role: "student",
    universityId: sampleUniversity.id,
    facultyId: "faculty-1",
    departmentId: "department-1",
    status: "active",
    createdAt: now,
    updatedAt: now
  };

  return {
    async findUserById(id: string) {
      return id === user.id ? user : null;
    }
  } as unknown as AuthRepository;
}
