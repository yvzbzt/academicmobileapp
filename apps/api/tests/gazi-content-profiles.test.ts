import { describe, expect, it } from "vitest";
import { findVerifiedUniversitySource } from "../src/bootstrap/verified-source-registry.js";
import { parseDeviceSourceRuntimeDocument } from "../../../packages/shared/src/device-source-runtime.js";

async function parse(contentType: "announcement" | "news" | "event", html: string) {
  const source = (await findVerifiedUniversitySource("gazi-universitesi-ankara"))!;
  return parseDeviceSourceRuntimeDocument(html, {
    sourceUrl: source[`${contentType}Url`]!,
    allowedOfficialDomain: "gazi.edu.tr",
    contentType,
    ...source.parserProfiles![contentType]!,
    checkedAt: "2026-09-15T12:00:00.000Z"
  });
}

describe("Gazi University content profiles", () => {
  it("uses general announcements instead of the death-only category and real content lists", async () => {
    const source = (await findVerifiedUniversitySource("gazi-universitesi-ankara"))!;
    expect(source.announcementUrl).toBe("https://gazi.edu.tr/view/announcement-list/1?type=1");
    expect(source.newsUrl).toBe("https://gazi.edu.tr/view/news-list/");
    expect(source.eventUrl).toBe("https://gazi.edu.tr/view/event-list?id=1&type=1");
  });

  it("reads month-first announcement dates without mistaking a date in the title for publication", async () => {
    const items = await parse("announcement", `<div class="subpage-ann-single">
      <div class="subpage-ann-date"><div class="subpage-ann-border"></div><div>
        <span class="ann-month">Eylül</span> <span class="ann-day">15 </span> <span class="ann-year">2026</span>
      </div></div>
      <div class="subpage-ann-link"><a href="/view/announcement/325482?type=1&amp;title=sinav-giris-belgeleri">20.09.2026 Tarihli Sınav Giriş Belgeleri</a></div>
    </div><nav><a href="/view/announcement-list?type=2">Vefat Duyuruları</a></nav>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "20.09.2026 Tarihli Sınav Giriş Belgeleri", publishedDate: "2026-09-15" });
  });

  it("keeps news card headings separate from timestamps and ignores the calendar/sidebar", async () => {
    const items = await parse("news", `<div class="info-content"><a href="/view/news/304995/teknofest-final-basarisi"><div class="card">
      <div class="news-date">7 Eylül 2026 &nbsp; | &nbsp; <i class="far fa-clock"></i>17:33</div>
      <div class="card-body"><h6>QURT Kuantum Teknolojileri Takımından TEKNOFEST Final Başarısı</h6></div>
    </div></a></div><aside><a href="/view/news/1/yan-haber">Yan haber</a></aside>
    <div id="calendar-data" data-calendar='[{"title":"Calendar-only item"}]'></div>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "QURT Kuantum Teknolojileri Takımından TEKNOFEST Final Başarısı", publishedDate: "2026-09-07", link: "https://gazi.edu.tr/view/news/304995/teknofest-final-basarisi" });
  });

  it("reads event image titles rather than treating the visible date as the headline", async () => {
    const items = await parse("event", `<div class="tum-etkinlikler"><a href="/view/event/292583/1/saglikta-iletisim" title="Sağlıkta İletişim"><div class="card">
      <div class="card-img"><img class="event-img" alt="Sağlıkta İletişim" src="https://webupload.gazi.edu.tr/poster.jpg"></div>
      <div class="card-body event-next"><div class="event-single"><p>17 Eylül 2026 &nbsp;|&nbsp; <i class="far fa-clock"></i>10:00</p></div></div>
    </div></a><div class="pagination"><a href="/view/event-list?id=2">Sonraki</a></div></div>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Sağlıkta İletişim", keyDates: [{ label: "Etkinlik tarihi", startDate: "2026-09-17" }], link: "https://gazi.edu.tr/view/event/292583/1/saglikta-iletisim" });
    expect(items[0]?.publishedDate).toBeUndefined();
    expect(items[0]?.summary).toBeUndefined();
  });

  it("rejects foreign destinations even inside a matching card", async () => {
    const items = await parse("news", `<div class="info-content">
      <a href="https://other.example/view/news/1/foreign"><div class="card-body"><h6>Foreign headline</h6></div></a>
      <a href="/view/news/2/official"><div class="card-body"><h6>Resmi üniversite haberi</h6></div></a>
    </div>`);
    expect(items.map((item) => item.title)).toEqual(["Resmi üniversite haberi"]);
  });

  it("fails closed when the configured list layout disappears", async () => {
    await expect(parse("announcement", '<nav><a href="/view/announcement-list">Duyurular</a></nav>'))
      .rejects.toThrow("SOURCE_HTML_SELECTOR_LAYOUT_INVALID");
  });
});
