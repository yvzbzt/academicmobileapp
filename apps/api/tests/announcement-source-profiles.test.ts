import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { afterEach, describe, expect, it } from "vitest";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress
} from "../src/common/network/safe-outbound-request.js";
import { AnnouncementIngestionService } from "../src/modules/announcements/announcement-ingestion.service.js";
import { parseConfiguredAnnouncementHtml } from "../src/modules/announcements/announcement-parser.js";
import { UpdateUniversityContentSourceProfileDto } from "../src/modules/announcements/announcements.dto.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import type { CatalogRepository, UniversityRecord } from "../src/modules/catalog/catalog.types.js";

const university: UniversityRecord = {
  id: "abdullah-gul-universitesi-kayseri",
  name: "ABDULLAH GÜL ÜNİVERSİTESİ (KAYSERİ)",
  slug: "abdullah-gul-universitesi-kayseri",
  city: "KAYSERİ",
  type: "state",
  websiteUrl: "https://www.agu.edu.tr/",
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date()
};

afterEach(() => setSafeOutboundRequestDependenciesForTesting(undefined));

describe("university content source profiles", () => {
  it("returns the complete 208-university, four-slot inventory even before DB provisioning", async () => {
    const service = new AnnouncementIngestionService(catalog(), new InMemoryAnnouncementRepository());

    const result = await service.listUniversityContentSourceProfilesForAdmin({ kind: "global" });

    expect(result.summary).toMatchObject({
      universities: 208,
      sourceSlots: 832,
      returnedUniversities: 208,
      returnedSourceSlots: 832
    });
    expect(result.universities).toHaveLength(208);
    expect(result.universities.every((item) => item.slots.length === 4)).toBe(true);
    expect(result.universities.flatMap((item) => item.slots).filter((slot) => slot.contentType === "academic_calendar"))
      .toHaveLength(208);
  });

  it("returns reviewed registry recipes before provisioning and lets persisted admin settings win", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog(), repository);
    const before = await service.listUniversityContentSourceProfilesForAdmin({ kind: "global" });
    const beforeSlot = before.universities
      .find((item) => item.universityId === "kahramanmaras-sutcu-imam-universitesi")
      ?.slots.find((slot) => slot.contentType === "announcement");

    expect(beforeSlot).toMatchObject({
      suggestedUrl: "https://www.ksu.edu.tr/default?DId=KSU&MI=42546",
      sourceUrl: "https://www.ksu.edu.tr/default?DId=KSU&MI=42546",
      parser: "html",
      parserConfig: {
        itemSelector: "main article.card.blog-card",
        titleSelector: ".card-body h3 a[href]",
        linkSelector: ".card-body h3 a[href]",
        dateSelector: ".card-body > .text-muted.small",
        contentSelector: ".card-body > p"
      }
    });

    await repository.upsertSource({
      scopeType: "university",
      scopeId: "kahramanmaras-sutcu-imam-universitesi",
      sourceName: "Admin override",
      sourceUrl: "https://www.ksu.edu.tr/duyurular",
      contentType: "announcement",
      parser: "auto",
      parserConfig: { itemSelector: ".admin-row" },
      priority: 50,
      status: "inactive",
      trustStatus: "quarantined"
    });
    const after = await service.listUniversityContentSourceProfilesForAdmin({ kind: "global" });
    const afterSlot = after.universities
      .find((item) => item.universityId === "kahramanmaras-sutcu-imam-universitesi")
      ?.slots.find((slot) => slot.contentType === "announcement");

    expect(afterSlot).toMatchObject({
      suggestedUrl: "https://www.ksu.edu.tr/default?DId=KSU&MI=42546",
      sourceUrl: "https://www.ksu.edu.tr/duyurular",
      parser: "auto",
      parserConfig: { itemSelector: ".admin-row" }
    });
  });

  it("does not graft a registry parser config onto a persisted source without one", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog(), repository);
    await repository.upsertSource({
      scopeType: "university",
      scopeId: "kahramanmaras-sutcu-imam-universitesi",
      sourceName: "Admin auto parser",
      sourceUrl: "https://www.ksu.edu.tr/duyurular",
      contentType: "announcement",
      parser: "auto",
      priority: 50,
      status: "inactive",
      trustStatus: "quarantined"
    });

    const result = await service.listUniversityContentSourceProfilesForAdmin({ kind: "global" });
    const slot = result.universities
      .find((item) => item.universityId === "kahramanmaras-sutcu-imam-universitesi")
      ?.slots.find((item) => item.contentType === "announcement");

    expect(slot).toMatchObject({
      sourceUrl: "https://www.ksu.edu.tr/duyurular",
      parser: "auto"
    });
    expect(slot?.parserConfig).toBeUndefined();
  });

  it("validates editable CSS selector profiles", async () => {
    const dto = plainToInstance(UpdateUniversityContentSourceProfileDto, {
      sourceUrl: "https://www.agu.edu.tr/duyurular",
      parser: "html",
      parserConfig: {
        itemSelector: ".notice-card",
        titleSelector: ".notice-title",
        linkSelector: "a.notice-link",
        dateSelector: "time",
        contentSelector: ".notice-body"
      }
    });

    expect(await validate(dto)).toEqual([]);
  });

  it.each(["rss", "auto"] as const)("clears persisted HTML selectors when a source switches to %s with an empty config", async (parser) => {
    const feedUrl = "https://www.agu.edu.tr/duyurular/feed";
    stubOutbound({
      [feedUrl]: `<rss><channel><title>Üniversite duyuruları</title><item>
        <title>2026-2027 Ders Kayıt Duyurusu</title><link>https://www.agu.edu.tr/duyuru/ders-kayit</link>
        <pubDate>Tue, 15 Sep 2026 09:00:00 +0000</pubDate>
      </item></channel></rss>`,
    }, "application/rss+xml");
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog(), repository);
    const first = await service.saveUniversityContentSourceProfileForAdmin({ kind: "global" }, university.id, "announcement", {
      sourceUrl: "https://www.agu.edu.tr/duyurular",
      parser: "html",
      parserConfig: { itemSelector: ".obsolete-card", titleSelector: ".obsolete-title" },
      status: "inactive",
    });
    const original = "source" in first ? first.source : null;
    expect(original?.parserConfig?.itemSelector).toBe(".obsolete-card");
    const update = { sourceUrl: feedUrl, parser, parserConfig: {}, status: "inactive" as const };
    expect(await validate(plainToInstance(UpdateUniversityContentSourceProfileDto, update))).toEqual([]);
    const saved = await service.saveUniversityContentSourceProfileForAdmin({ kind: "global" }, university.id, "announcement", update);
    const updated = "source" in saved ? saved.source : null;
    expect(updated?.parserConfig).toEqual({});
    expect(updated?.sourceDefinitionVersion).not.toBe(original?.sourceDefinitionVersion);
    expect((await repository.findSourceById(updated!.id))?.parserConfig).toEqual({});
    await expect(service.previewSourceByIdForAdmin({ kind: "global" }, updated!.id)).resolves.toMatchObject({
      status: "healthy",
      parsedItemCount: 1,
      acceptedItemCount: 1,
      samples: [expect.objectContaining({ title: "2026-2027 Ders Kayıt Duyurusu" })],
    });
  });

  it("persists and approves event-date selectors without treating the event start as publication", async () => {
    const sourceUrl = "https://www.agu.edu.tr/etkinlikler";
    stubOutbound({ [sourceUrl]: '<article><a href="/etkinlik/kongre">Uluslararası Eğitim Kongresi</a><span class="event-date">07 May 2027</span></article>' });
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog(), repository);
    const input = {
      sourceUrl, parser: "html" as const, status: "inactive" as const,
      parserConfig: { itemSelector: "article", linkSelector: "a", eventDateSelector: ".event-date" },
    };
    const dto = plainToInstance(UpdateUniversityContentSourceProfileDto, input);
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    const saved = await service.saveUniversityContentSourceProfileForAdmin({ kind: "global" }, university.id, "event", dto);
    const sourceId = "source" in saved ? saved.source.id : "";
    expect((await repository.findSourceById(sourceId))?.parserConfig).toEqual(input.parserConfig);
    const preview = await service.previewSourceByIdForAdmin({ kind: "global" }, sourceId);
    expect(preview).toMatchObject({ status: "healthy", acceptedItemCount: 1 });
    expect(preview.samples[0]?.keyDates).toEqual([{ label: "Etkinlik tarihi", startDate: "2027-05-07" }]);
    expect(preview.samples[0]?.publishedDate).toBeUndefined();
    await expect(service.previewUniversityContentSourceProfileForAdmin(
      { kind: "global" }, university.id, "event", { activateWhenHealthy: true }, "admin-1"
    )).resolves.toMatchObject({ activationStatus: "active" });
    const items = await repository.listItemsForSource(sourceId);
    expect(items).toHaveLength(1);
    expect(items[0]?.keyDates).toEqual([{ label: "Etkinlik tarihi", startDate: "2027-05-07" }]);
    expect(items[0]?.publishedDate).toBeUndefined();
    expect(items[0]?.publishedAt).toBeUndefined();
    const original = await repository.findSourceById(sourceId);
    await service.saveUniversityContentSourceProfileForAdmin({ kind: "global" }, university.id, "event", {
      ...input, parserConfig: { ...input.parserConfig, eventDateSelector: ".corrected-date" },
    });
    expect((await repository.findSourceById(sourceId))?.sourceDefinitionVersion).not.toBe(original?.sourceDefinitionVersion);
  });

  it("uses configured selectors to extract the exact title, URL, date and body", () => {
    const items = parseConfiguredAnnouncementHtml(`
      <nav><a href="/menu">Menü</a></nav>
      <section class="notice-card">
        <a class="notice-link" href="/duyuru/2026-kayit"><span class="notice-title">2026-2027 Kayıt Duyurusu</span></a>
        <time>10.09.2026</time>
        <div class="notice-body"><p>Kayıt işlemleri öğrenci bilgi sisteminden yapılacaktır.</p></div>
      </section>
    `, "https://www.agu.edu.tr/duyurular", {
      itemSelector: ".notice-card",
      titleSelector: ".notice-title",
      linkSelector: "a.notice-link",
      dateSelector: "time",
      contentSelector: ".notice-body"
    });

    expect(items).toEqual([
      expect.objectContaining({
        title: "2026-2027 Kayıt Duyurusu",
        link: "https://www.agu.edu.tr/duyuru/2026-kayit",
        publishedDate: "2026-09-10",
        summary: "Kayıt işlemleri öğrenci bilgi sisteminden yapılacaktır.",
        body: [expect.objectContaining({ text: "Kayıt işlemleri öğrenci bilgi sisteminden yapılacaktır." })]
      })
    ]);
  });

  it("parses full English month names in configured publication dates", () => {
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const items = parseConfiguredAnnouncementHtml(months.map((month) => `
      <article class="item">
        <a href="/news/${month.toLocaleLowerCase("en-US")}"><span class="title">${month} research update</span></a>
        <span class="date">1 ${month} 2026, Monday</span>
      </article>
    `).join(""), "https://example.edu.tr/news", {
      itemSelector: ".item",
      titleSelector: ".title",
      linkSelector: "a",
      dateSelector: ".date"
    }, "news");

    expect(items.map(({ publicationKind, publishedDate }) => ({ publicationKind, publishedDate }))).toEqual(
      months.map((_month, index) => ({
        publicationKind: "date",
        publishedDate: `2026-${String(index + 1).padStart(2, "0")}-01`
      }))
    );
  });

  it("saves a missing slot and previews it without requiring source approval", async () => {
    stubOutbound({
      "https://www.agu.edu.tr/duyurular": `
        <section class="notice-card">
          <a class="notice-link" href="/duyuru/2026-kayit"><span class="notice-title">2026-2027 Kayıt Duyurusu</span></a>
          <time>10.09.2026</time><p class="notice-body">Kayıt işlemleri başlamıştır.</p>
        </section>`,
      "https://www.agu.edu.tr/duyuru/2026-kayit": "<main><h1>Günün Yemeği</h1><p>Sayfa kabuğundaki ilgisiz içerik.</p></main>"
    });
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog(), repository);
    const saved = await service.saveUniversityContentSourceProfileForAdmin(
      { kind: "global" },
      university.id,
      "announcement",
      {
        sourceUrl: "https://www.agu.edu.tr/duyurular",
        parser: "html",
        parserConfig: {
          itemSelector: ".notice-card",
          titleSelector: ".notice-title",
          linkSelector: "a.notice-link",
          dateSelector: "time",
          contentSelector: ".notice-body"
        }
      }
    );
    const sourceId = "source" in saved ? saved.source.id : "";

    await expect(service.previewSourceByIdForAdmin({ kind: "global" }, sourceId)).resolves.toMatchObject({
      status: "healthy",
      parsedItemCount: 1,
      acceptedItemCount: 1,
      samples: [expect.objectContaining({
        title: "2026-2027 Kayıt Duyurusu",
        url: "https://www.agu.edu.tr/duyuru/2026-kayit",
        publishedDate: "2026-09-10"
      })]
    });
    expect((await repository.findSourceById(sourceId))?.healthStatus).toBe("healthy");

    await expect(service.previewUniversityContentSourceProfileForAdmin(
      { kind: "global" },
      university.id,
      "announcement",
      { activateWhenHealthy: true },
      "admin-1"
    )).resolves.toMatchObject({ activationStatus: "active" });
    expect(await repository.findSourceById(sourceId)).toMatchObject({
      status: "active",
      trustStatus: "trusted",
      approvalPending: false,
      healthStatus: "healthy"
    });
  });

  it.each([
    {
      universityId: "ege-universitesi-izmir",
      websiteUrl: "https://www.ege.edu.tr/",
      sourceUrl: "https://egeduyuru.ege.edu.tr/tum_duyurular.html",
      contentType: "announcement" as const,
      parser: "auto" as const,
      parserConfig: {},
      html: `<table><tr>${["Konu", "Türü", "Başlangıç Tarihi", "Düzenlenme Yeri", "Gönderen Birim", "Görüntüle"].map((label) => `<th class="thbaslik">${label}</th>`).join("")}</tr>
        <tr><td class="tdbaslik">2026-2027 Ders Kaydı Duyurusu</td><td class="tdbaslik">Genel</td>
        <td class="tdbaslik">15-09-2026</td><td class="tdbaslik">Ege Üniversitesi</td><td class="tdbaslik">Rektörlük</td>
        <td class="tdbaslik"><button onclick="icerikGetir(19963)">Görüntüle</button></td></tr></table>`,
      title: "2026-2027 Ders Kaydı Duyurusu",
      link: "https://egeduyuru.ege.edu.tr/icerikgoster_5.php?id=19963",
    },
    {
      universityId: "necmettin-erbakan-universitesi-konya",
      websiteUrl: "https://erbakan.edu.tr/",
      sourceUrl: "https://erbakan.edu.tr/tr/haberler",
      contentType: "news" as const,
      parser: "html" as const,
      parserConfig: {
        itemSelector: ".col-md-4.mb-4:has(> a[href*='/tr/haber/'])",
        titleSelector: "img[alt]",
        linkSelector: "a[href*='/tr/haber/']",
        dateSelector: ".tarih",
        contentSelector: ".spot",
      },
      html: `<div class="col-md-4 mb-4">
        <a href="/tr/haber/teknoloji-maratonu-13142#haber_detay"><img alt="Üniversitemizde 3 Haftalık Teknoloji Maratonu Tamamlandı"></a>
        <div class="tarih">13 Ağustos 2026 | Akademik</div><div class="baslik">Üniversitemizde 3 Haftalık Teknoloji Maratonu Tama...</div>
        <div class="spot">Atölye çalışmalarımız tamamlandı.</div><a href="https://facebook.com/share">Paylaş</a></div>`,
      title: "Üniversitemizde 3 Haftalık Teknoloji Maratonu Tamamlandı",
      link: "https://erbakan.edu.tr/tr/haber/teknoloji-maratonu-13142",
    },
  ])("approves $universityId with the same mobile recipe that passed preview", async (fixture) => {
    stubOutbound({ [fixture.sourceUrl]: fixture.html });
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog({
      ...university,
      id: fixture.universityId,
      slug: fixture.universityId,
      websiteUrl: fixture.websiteUrl,
    }), repository);
    const saved = await service.saveUniversityContentSourceProfileForAdmin(
      { kind: "global" }, fixture.universityId, fixture.contentType, {
        sourceUrl: fixture.sourceUrl,
        parser: fixture.parser,
        parserConfig: fixture.parserConfig,
        status: "inactive",
      }
    );
    const sourceId = "source" in saved ? saved.source.id : "";
    await expect(service.previewSourceByIdForAdmin({ kind: "global" }, sourceId)).resolves.toMatchObject({
      status: "healthy",
      acceptedItemCount: 1,
      samples: [expect.objectContaining({ title: fixture.title, url: fixture.link })],
    });

    await expect(service.previewUniversityContentSourceProfileForAdmin(
      { kind: "global" }, fixture.universityId, fixture.contentType,
      { activateWhenHealthy: true }, "admin-1"
    )).resolves.toMatchObject({ activationStatus: "active" });
    expect(await repository.findSourceById(sourceId)).toMatchObject({
      status: "active", trustStatus: "trusted", approvalPending: false, healthStatus: "healthy", itemCount: 1,
    });
    expect(await repository.listItemsForSource(sourceId)).toEqual([
      expect.objectContaining({ title: fixture.title, link: fixture.link, contentType: fixture.contentType }),
    ]);
  });

  it("persists and tests an editable academic-calendar slot", async () => {
    stubOutbound({ "https://www.agu.edu.tr/akademik-takvim.pdf": "%PDF-1.7" }, "application/pdf");
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog(), repository);

    await service.saveUniversityContentSourceProfileForAdmin(
      { kind: "global" },
      university.id,
      "academic_calendar",
      { sourceUrl: "https://www.agu.edu.tr/akademik-takvim.pdf", parser: "auto" }
    );
    const preview = await service.previewUniversityContentSourceProfileForAdmin(
      { kind: "global" },
      university.id,
      "academic_calendar",
      { activateWhenHealthy: true }
    );

    expect(preview).toMatchObject({
      status: "healthy",
      activationStatus: "active",
      parsedItemCount: 1,
      samples: [{ title: "Akademik Takvim", url: "https://www.agu.edu.tr/akademik-takvim.pdf" }]
    });
    expect(await repository.findUniversityCalendarSourceProfile(university.id)).toMatchObject({
      sourceUrl: "https://www.agu.edu.tr/akademik-takvim.pdf",
      status: "active",
      healthStatus: "healthy",
      itemCount: 1
    });
  });

  it("does not mark calendar navigation controls healthy in the admin device preview", async () => {
    stubOutbound({ "https://www.agu.edu.tr/duyurular": '<main><article class="duyuru"><a href="/takvimli.php?view=week">Bugün</a><a href="/author/editor">Editor</a></article></main>' });
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog(), repository);
    const saved = await service.saveUniversityContentSourceProfileForAdmin({ kind: "global" }, university.id, "announcement", { sourceUrl: "https://www.agu.edu.tr/duyurular", parser: "auto", status: "inactive" });
    const sourceId = "source" in saved ? saved.source.id : "";
    await expect(service.previewSourceByIdForAdmin({ kind: "global" }, sourceId)).resolves.toMatchObject({ status: "degraded", acceptedItemCount: 0, samples: [] });
  });

  it("applies calendar selectors to HTML calendar listings", async () => {
    stubOutbound({
      "https://www.agu.edu.tr/akademik-takvim": `
        <div class="calendar-row">
          <a class="calendar-link" href="/docs/2026-2027-akademik-takvim.pdf"><span class="calendar-title">2026-2027 Akademik Takvim</span></a>
          <time>11.09.2026</time>
          <div class="calendar-content">Dersler 15 Eylül 2026 tarihinde başlar.</div>
        </div>`
    });
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog(), repository);
    await service.saveUniversityContentSourceProfileForAdmin(
      { kind: "global" },
      university.id,
      "academic_calendar",
      {
        sourceUrl: "https://www.agu.edu.tr/akademik-takvim",
        parser: "html",
        parserConfig: {
          itemSelector: ".calendar-row",
          titleSelector: ".calendar-title",
          linkSelector: ".calendar-link",
          dateSelector: "time",
          contentSelector: ".calendar-content"
        }
      }
    );

    await expect(service.previewUniversityContentSourceProfileForAdmin(
      { kind: "global" },
      university.id,
      "academic_calendar"
    )).resolves.toMatchObject({
      status: "healthy",
      parsedItemCount: 1,
      detectedContentType: "text/html",
      samples: [expect.objectContaining({
        title: "2026-2027 Akademik Takvim",
        url: "https://www.agu.edu.tr/docs/2026-2027-akademik-takvim.pdf",
        publishedDate: "2026-09-11",
        summary: "Dersler 15 Eylül 2026 tarihinde başlar."
      })]
    });
  });

  it("rotates the source definition when selectors change", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const first = await repository.upsertSource({
      scopeType: "university",
      scopeId: university.id,
      sourceName: "Duyurular",
      sourceUrl: "https://www.agu.edu.tr/duyurular",
      contentType: "announcement",
      parser: "html",
      parserConfig: { itemSelector: ".old-card" },
      priority: 50,
      status: "inactive",
      trustStatus: "quarantined"
    });
    const second = await repository.upsertSource({
      ...first,
      parserConfig: { itemSelector: ".new-card" }
    });

    expect(second.sourceDefinitionVersion).not.toBe(first.sourceDefinitionVersion);
    expect(second.parserConfig).toEqual({ itemSelector: ".new-card" });
  });
});

function catalog(universityRecord = university): CatalogRepository {
  return {
    findUniversityById: async (id: string) => id === universityRecord.id ? universityRecord : null,
    listUniversities: async () => [universityRecord],
    listFaculties: async () => [],
    listDepartments: async () => []
  } as unknown as CatalogRepository;
}

function stubOutbound(pages: Record<string, string>, contentType = "text/html"): void {
  const publicAddress: ResolvedOutboundAddress = { address: "93.184.216.34", family: 4 };
  setSafeOutboundRequestDependenciesForTesting({
    resolveHostname: async () => [publicAddress],
    requestHop: async (url, pinnedAddress) => ({
      status: pages[url] === undefined ? 404 : 200,
      headers: { "content-type": contentType },
      body: Buffer.from(pages[url] ?? ""),
      remoteAddress: pinnedAddress.address
    })
  });
}
