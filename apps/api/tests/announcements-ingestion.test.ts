import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listVerifiedAcademicUnitSources, listVerifiedUniversitySources } from "../src/bootstrap/verified-source-registry.js";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress,
  type SafeOutboundHopResponse
} from "../src/common/network/safe-outbound-request.js";
import { AnnouncementIngestionService, discoverAnnouncementSourceForUniversity, isSourceDue, YOK_ANNOUNCEMENT_SCOPE_ID } from "../src/modules/announcements/announcement-ingestion.service.js";
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
import type { AnnouncementSourceRecord } from "../src/modules/announcements/announcements.types.js";
import type { AuthRepository, AuthUserRecord } from "../src/modules/auth/auth.types.js";
import type { CatalogRepository, UniversityRecord } from "../src/modules/catalog/catalog.types.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/announcements/${name}`, import.meta.url), "utf8");

const sampleUniversity: UniversityRecord = {
  id: "u-agu",
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

    await service.provisionStaticAnnouncementSources();
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

    ingestion.onApplicationBootstrap();
    await expect(ingestion.listSources()).resolves.toEqual([]);
    await expect(ingestion.runIngestion()).resolves.toEqual({
      summary: { checkedSources: 0, healthy: 0, degraded: 0, failed: 0, totalParsedItems: 0 },
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

  it("keeps an existing rejected source byte-for-byte stable across repeated startup and read operations", async () => {
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

    ingestion.onApplicationBootstrap();
    ingestion.onApplicationBootstrap();
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
    const items = await repository.listItemsByScope({ universityId: sampleUniversity.id, limit: 10 });

    expect(result.summary.healthy).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({ sourceId: source.id, title: "Yeni öğrenci duyurusu" }));
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
