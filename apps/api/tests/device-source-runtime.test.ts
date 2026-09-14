import { describe, expect, it, vi } from "vitest";
import {
  executeDeviceSourceRuntime,
  parseDeviceSourceRuntimeDocument,
  type DeviceSourceRuntimeRecipe,
  type DeviceSourceRuntimeRequest,
} from "../../../packages/shared/src/device-source-runtime.js";

function recipe(overrides: Partial<DeviceSourceRuntimeRecipe> = {}): DeviceSourceRuntimeRecipe {
  return {
    sourceUrl: "https://example.edu.tr/announcements",
    allowedOfficialDomain: "example.edu.tr",
    contentType: "announcement",
    parser: "auto",
    checkedAt: "2026-09-14T12:00:00.000Z",
    ...overrides,
  };
}

describe("shared device source runtime", () => {
  it("uses configured selectors on the row itself and supports generic HTML, JSON and RSS", () => {
    const configured = parseDeviceSourceRuntimeDocument(
      '<a class="item" href="/one" data-date="2026-09-14">Registration announced</a>',
      recipe({
        parser: "html",
        parserConfig: {
          itemSelector: "a.item",
          titleSelector: "a.item",
          linkSelector: "a.item",
          dateSelector: "a.item",
        },
      }),
    );
    const html = parseDeviceSourceRuntimeDocument(
      '<main><article><a href="/two">Scholarship application results</a></article></main>',
      recipe(),
    );
    const json = parseDeviceSourceRuntimeDocument(
      JSON.stringify({ data: [{ title: "Research news", href: "/three", publishedDate: "2026-09-13" }] }),
      recipe({ contentType: "news" }),
    );
    const rss = parseDeviceSourceRuntimeDocument(
      '<rss><channel><item><title>Student event</title><link>https://example.edu.tr/four</link></item></channel></rss>',
      recipe({ parser: "rss", contentType: "event" }),
    );

    expect(configured).toEqual([expect.objectContaining({ title: "Registration announced", link: "https://example.edu.tr/one" })]);
    expect(html).toEqual([expect.objectContaining({ link: "https://example.edu.tr/two" })]);
    expect(json).toEqual([expect.objectContaining({ link: "https://example.edu.tr/three", publishedDate: "2026-09-13" })]);
    expect(rss).toEqual([expect.objectContaining({ link: "https://example.edu.tr/four" })]);
  });

  it("filters freshness from the server checkedAt for dates, timestamps, academic years, events and undated items", () => {
    const generic = parseDeviceSourceRuntimeDocument(JSON.stringify({ data: [
      { title: "Old date notice", href: "/old-date", publishedDate: "2024-09-13" },
      { title: "Recent date notice", href: "/recent-date", publishedDate: "2025-09-14" },
      { title: "Old timestamp notice", href: "/old-timestamp", publishedAt: "2025-09-14T11:59:59.000Z" },
      { title: "Recent timestamp notice", href: "/recent-timestamp", publishedAt: "2025-09-14T12:00:00.000Z" },
      { title: "2023 graduates current update", href: "/current-old-title-year", publishedDate: "2026-09-14" },
      { title: "2022-2023 registration notice", href: "/old-academic-year" },
      { title: "Undated campus notice", href: "/undated" },
    ] }), recipe());
    const events = parseDeviceSourceRuntimeDocument(`
      <div id="calendar"></div><script>$('#calendar').fullCalendar({ events: ${JSON.stringify([{
        id: "7", title: "Archived meeting", start: "2020-05-04 09:00:00", end: "2020-05-04 11:00:00",
        url: "https://www.alanyauniversity.edu.tr/tr/events.single/id/7",
      }, {
        id: "455", title: "2020 alumni current meeting", start: "2026-09-20 10:00:00", end: "2026-09-20 11:00:00",
        url: "https://www.alanyauniversity.edu.tr/tr/events.single/id/455",
      }])}, eventColor: '#42b8d4' });</script>
    `, recipe({
      sourceUrl: "https://www.alanyauniversity.edu.tr/tr/events.calendar",
      allowedOfficialDomain: "alanyauniversity.edu.tr",
      contentType: "event",
    }));

    expect(generic.map((item) => item.title)).toEqual([
      "Recent date notice",
      "Recent timestamp notice",
      "2023 graduates current update",
      "Undated campus notice",
    ]);
    expect(generic[1]).toMatchObject({
      publicationKind: "timestamp",
      publishedAt: "2025-09-14T12:00:00.000Z",
    });
    expect(events.map((item) => item.title)).toEqual(["2020 alumni current meeting"]);
  });

  it("executes ATU's bounded two-hop OData plan and applies validators only to content", async () => {
    const requests: DeviceSourceRuntimeRequest[] = [];
    const transport = vi.fn(async (request: DeviceSourceRuntimeRequest) => {
      requests.push(request);
      return {
        status: 200,
        finalUrl: request.url,
        contentType: "application/json",
        text: request.url.includes("/Siteler?")
          ? JSON.stringify({ d: [{ ID: 7 }] })
          : JSON.stringify({ d: [{
              GuID: "official-guid",
              Baslik: "2026 Student registration announcement",
              AltBaslik: "Official details",
              BaslamaTarihi: "/Date(1789344000000)/",
            }] }),
      };
    });
    const snapshot = await executeDeviceSourceRuntime(recipe({
      sourceUrl: "https://www.atu.edu.tr/#!/TR/duyurular/",
      allowedOfficialDomain: "atu.edu.tr",
    }), transport, { etag: '"known"' });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.validators).toBeUndefined();
    expect(requests[1]?.validators).toEqual({ etag: '"known"' });
    expect(snapshot.items).toEqual([expect.objectContaining({
      title: "2026 Student registration announcement",
      link: "https://www.atu.edu.tr/#!/duyuru/official-guid",
      summary: "Official details",
    })]);
  });

  it("bounds ATU timestamps against checkedAt instead of the device clock", async () => {
    const futureMilliseconds = new Date("2030-01-01T00:00:00.000Z").getTime();
    const run = (checkedAt: string) => executeDeviceSourceRuntime(recipe({
      sourceUrl: "https://www.atu.edu.tr/#!/TR/duyurular/",
      allowedOfficialDomain: "atu.edu.tr",
      checkedAt,
    }), async (request) => ({
      status: 200,
      finalUrl: request.url,
      contentType: "application/json",
      text: request.url.includes("/Siteler?")
        ? JSON.stringify({ d: [{ ID: 7 }] })
        : JSON.stringify({ d: [{ GuID: "future-guid", Baslik: "Student notice", BaslamaTarihi: `/Date(${futureMilliseconds})/` }] }),
    }));

    expect((await run("2026-09-14T12:00:00.000Z")).items[0]?.publishedAt).toBeUndefined();
    expect((await run("2028-09-14T12:00:00.000Z")).items[0]?.publishedAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it("parses the Ankara CMS contract including event dates", () => {
    const items = parseDeviceSourceRuntimeDocument(JSON.stringify({ items: [{
      baslik: "Student career meeting",
      aciklama: "Official meeting details",
      icerik: "<p>Official meeting details</p>",
      url: "student-career-meeting",
      publishDate: "2026-09-13T10:15:00Z",
      eventDateTime: "2026-09-14T07:00:00Z",
      eventEndDateTime: "2026-09-18T14:30:00Z",
    }] }), recipe({
      sourceUrl: "https://ubys.ankara.edu.tr/api/CMS/GetMainevents?Page=0&PageSize=20&websiteId=1&languageCode=tr-TR",
      allowedOfficialDomain: "ankara.edu.tr",
      contentType: "event",
    }));

    expect(items).toEqual([expect.objectContaining({
      link: "https://www.ankara.edu.tr/etkinlik/student-career-meeting",
      publishedAt: "2026-09-13T10:15:00.000Z",
      keyDates: [{ label: "Etkinlik tarihi", startDate: "2026-09-14", endDate: "2026-09-18" }],
    })]);
  });

  it("parses Alanya, NKU, Bayburt, KTUN and Bandirma golden layouts", () => {
    const alanya = parseDeviceSourceRuntimeDocument(`
      <div id="calendar"></div><script>$('#calendar').fullCalendar({ events: ${JSON.stringify([{
        id: "455", title: "World Chemistry Day", start: "2026-04-07 10:00:00", end: "2026-04-08 11:00:00",
        url: "https://www.alanyauniversity.edu.tr/tr/events.single/id/455",
      }])}, eventColor: '#42b8d4' });</script>
    `, recipe({
      sourceUrl: "https://www.alanyauniversity.edu.tr/tr/events.calendar",
      allowedOfficialDomain: "alanyauniversity.edu.tr",
      contentType: "event",
    }));
    const nku = parseDeviceSourceRuntimeDocument(JSON.stringify([{
      id: "69889",
      start: "2026-09-28 10:00:00",
      end: "2026-09-28 12:00:00",
      title: "Faculty orientation",
      description: "Official orientation details",
      url: "haberler/faculty-orientation/s/69889",
      color: "#6495ED",
    }]), recipe({
      sourceUrl: "https://bhi.nku.edu.tr/json/nku.json2.php?sid=",
      allowedOfficialDomain: "nku.edu.tr",
      contentType: "event",
    }));
    const bayburt = parseDeviceSourceRuntimeDocument(JSON.stringify({ response: [{
      tarih: "2026-09-13T00:00:00",
      medyaresx_object: { baslik: "Academic success news" },
      domain: "https://bayburt.edu.tr/medya/haber/academic-success-p9146",
    }] }), recipe({
      sourceUrl: "https://apiportal.bayburt.edu.tr/api/web/department/medyalist/tr/haber/30?depid=1",
      allowedOfficialDomain: "bayburt.edu.tr",
      contentType: "news",
    }));
    const ktunRow = (title: string, slug: string, date: string) => `<tr><td><a href="/tr/Universite/HaberDetay/${slug}">${title}</a></td><td>${date}</td><td><a href="/tr/Universite/HaberDetay/${slug}">Detay</a></td></tr>`;
    const ktun = parseDeviceSourceRuntimeDocument(`<main id="mainContent"><div class="table-responsive"><table class="table table-striped table-hover"><thead><tr><th>Haberler</th><th>Yayın Tarihi</th><th></th></tr></thead><tbody>${ktunRow("First news", "first_news_1372", "11.09.2026")}${ktunRow("Second news", "second_news_1371", "10.09.2026")}</tbody></table></div></main>`, recipe({
      sourceUrl: "https://www.ktun.edu.tr/tr/Universite/TumHaberler",
      allowedOfficialDomain: "ktun.edu.tr",
      contentType: "news",
    }));
    const bandirma = parseDeviceSourceRuntimeDocument(`
      <div class="etkinlik"><div class="tarih"><span>29</span> Ağustos 2026</div><a class="etkinlikLink"
        data-id="1775" data-birimseo="www" data-lang="tr" data-slug="student-meeting"
        href="#seciliEtkinlikDetay">Student meeting</a></div>
    `, recipe({
      sourceUrl: "https://www.bandirma.edu.tr/tr/www/Etkinlik/Liste?k=-1",
      allowedOfficialDomain: "bandirma.edu.tr",
      contentType: "event",
    }));

    expect(alanya[0]).toMatchObject({ link: "https://www.alanyauniversity.edu.tr/tr/events.single/id/455" });
    expect(nku[0]).toMatchObject({ link: "https://bhi.nku.edu.tr/haberler/faculty-orientation/s/69889" });
    expect(bayburt[0]).toMatchObject({ publishedDate: "2026-09-13" });
    expect(ktun).toHaveLength(2);
    expect(bandirma[0]).toMatchObject({
      link: "https://www.bandirma.edu.tr/tr/www/Etkinlik/Liste/student-meeting-1775?k=-1",
      publishedDate: "2026-08-29",
    });
  });

  it("selects Bandirma's bounded adapter from its canonical redirect target", async () => {
    const snapshot = await executeDeviceSourceRuntime(recipe({
      sourceUrl: "https://bandirma.edu.tr/etkinlikler/",
      allowedOfficialDomain: "bandirma.edu.tr",
      contentType: "event",
    }), async () => ({
      status: 200,
      finalUrl: "https://www.bandirma.edu.tr/tr/www/Etkinlik/Liste?k=-1",
      contentType: "text/html",
      text: `
        <div class="etkinlik"><div class="tarih">29 Agustos 2026</div><a class="etkinlikLink"
          data-id="1775" data-birimseo="www" data-lang="tr" data-slug="student-meeting"
          href="#seciliEtkinlikDetay">Student meeting</a></div>
      `,
    }));

    expect(snapshot.profile).toBe("bandirma_event");
    expect(snapshot.items[0]).toMatchObject({
      link: "https://www.bandirma.edu.tr/tr/www/Etkinlik/Liste/student-meeting-1775?k=-1",
      publishedDate: "2026-08-29",
    });
  });

  it("fails closed on special-profile schema drift", async () => {
    expect(() => parseDeviceSourceRuntimeDocument(JSON.stringify({ items: [{
      baslik: "News", url: "https://attacker.example/stolen", publishDate: "2026-09-13T10:15:00Z",
    }] }), recipe({
      sourceUrl: "https://ubys.ankara.edu.tr/api/CMS/GetMainNews?Page=0&PageSize=20&websiteId=1&languageCode=tr-TR",
      allowedOfficialDomain: "ankara.edu.tr",
      contentType: "news",
    }))).toThrow("SOURCE_LAYOUT_INVALID:ANKARA_CMS");

    await expect(executeDeviceSourceRuntime(recipe({
      sourceUrl: "https://www.atu.edu.tr/#!/TR/duyurular/",
      allowedOfficialDomain: "atu.edu.tr",
    }), async (request) => ({
      status: 200,
      finalUrl: request.url,
      contentType: "application/json",
      text: JSON.stringify({ d: [] }),
    }))).rejects.toThrow("SOURCE_LAYOUT_INVALID:ATU_SITE");
  });
});
