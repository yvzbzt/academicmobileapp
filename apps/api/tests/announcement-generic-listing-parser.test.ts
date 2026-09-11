import { describe, expect, it } from "vitest";
import {
  parseFetchedSourceItems,
  parseGenericAnnouncementHtml
} from "../src/modules/announcements/announcement-parser.js";

describe("generic announcement listing parser evidence", () => {
  it("rejects Bandirma-style utility links while retaining typed detail rows", () => {
    const items = parseGenericAnnouncementHtml(`
      <a href="/tr/www/Theme?theme=Views_New&amp;returnUrl=%2Ftr%2Fwww%2FDuyuru%2FListe%3Fk%3D-1">Eski Görünüm</a>
      <a href="/tr/www/s/Yemek-Listesi-10">Yemek Listesi</a>
      <a href="/tr/www/s/Yonetmelik-ve-Yonergeler-11">YÖNETMELİK VE YÖNERGELER</a>
      <li class="menu-item"><a href="/tr/www/duyuru/sahte">Menüdeki Duyuru Bağlantısı</a></li>
      <div class="well"><div class="media"><h4 class="media-heading">
        <a href="/tr/www/d/2026-2027-Guz-Donemi-Ders-Kayitlari-93023">2026-2027 Güz Dönemi Ders Kayıtları</a>
      </h4><p>Öğrenciler kayıtlarını ilan edilen tarihlerde tamamlayacaktır.</p></div></div>
      <div class="well"><div class="media"><h4 class="media-heading">
        <a href="/tr/www/d/Yatay-Gecis-Basvuru-Sonuclari-93017">Yatay Geçiş Başvuru Sonuçları</a>
      </h4><p>Başvuru sonuçları ve kayıt adımları açıklanmıştır.</p></div></div>
    `, "https://www.bandirma.edu.tr/tr/www/Duyuru/Liste?k=-1", "announcement");

    expect(items.map((item) => item.link)).toEqual([
      "https://www.bandirma.edu.tr/tr/www/d/2026-2027-Guz-Donemi-Ders-Kayitlari-93023",
      "https://www.bandirma.edu.tr/tr/www/d/Yatay-Gecis-Basvuru-Sonuclari-93017"
    ]);
  });

  it("retains neutral titles only inside evidenced content rows and rejects the wrong listing type", () => {
    const aksaray = parseGenericAnnouncementHtml(`
      <div class="row"><div class="link"><a href="/yonetmelikler">Yönetmelik ve Yönergeler</a></div></div>
      <div class="col-md-3 item"><div class="row">
        <div class="link"><a href="/2026-2027-guz-donemi-ders-programlari">2026-2027 Güz Dönemi Ders Programları</a></div>
        <div class="description">Öğrenciler için yeni dönem programı yayımlandı.</div>
        <div class="tarih">4.8.2026</div>
      </div></div>
      <article><h2><a href="/2026/09/08/yatay-gecis-sonuclari">Yatay Geçiş Sonuçları</a></h2></article>
    `, "https://teknik.aksaray.edu.tr/duyurular", "announcement");
    expect(aksaray.map((item) => item.link)).toEqual([
      "https://teknik.aksaray.edu.tr/2026-2027-guz-donemi-ders-programlari",
      "https://teknik.aksaray.edu.tr/2026/09/08/yatay-gecis-sonuclari"
    ]);
    expect(parseGenericAnnouncementHtml(`
      <body class="banner-mobile keyboard-navigation with-sidebar without-menu"><main class="with-banner">
        <article><a href="/duyuru/gercek">2026-2027 Gercek Duyuru</a></article>
      </main></body>
    `, "https://aku.edu.tr/duyurular", "announcement")).toEqual([
      expect.objectContaining({ link: "https://aku.edu.tr/duyuru/gercek" })
    ]);
    expect(parseGenericAnnouncementHtml(`
      <div class="col-md-8 has-sidebar"><div class="dataTables_wrapper no-footer"><table class="dataTable no-footer"><tbody><tr><td>
        <a href="/Birimler/iif/duyuru/yatay-gecis-sonuclari">2026-2027 Yatay Gecis Sonuclari Duyurusu</a>
      </td></tr></tbody></table></div></div>
    `, "https://batman.edu.tr/Birimler/iif/tum-duyurular", "announcement")).toEqual([
      expect.objectContaining({ link: "https://batman.edu.tr/Birimler/iif/duyuru/yatay-gecis-sonuclari" })
    ]);
    expect(parseGenericAnnouncementHtml(`
      <div class="kingster-with-sticky-navigation"><div class="gdlr-core-pbf-sidebar-content">
        <div class="event-sidebar-container"><div class="kingster-sidebar-style-none">
          <article><a href="/etkinlikler/gercek-etkinlik">2026 Gercek Etkinlik</a></article>
        </div></div>
      </div></div>
    `, "https://eskisehir.edu.tr/etkinlikler", "event")).toEqual([
      expect.objectContaining({ link: "https://eskisehir.edu.tr/etkinlikler/gercek-etkinlik" })
    ]);

    expect(parseGenericAnnouncementHtml(`
      <article><a href="/duyuru/personel-ilani">Personel Alımı</a></article>
    `, "https://example.edu.tr/haberler", "news")).toEqual([]);
    expect(parseGenericAnnouncementHtml(`
      <div class="row"><a href="/yonetmelikler">Yönetmelik ve Yönergeler</a>
        ${"x".repeat(40_000)}<div class="tarih">4.8.2026</div>
      </div>
    `, "https://example.edu.tr/duyurular", "announcement")).toEqual([]);
    expect(parseGenericAnnouncementHtml(`
      <form role="navigation"><a href="/duyuru/sahte">Sahte Duyuru</a></form>
    `, "https://example.edu.tr/duyurular", "announcement")).toEqual([]);
    expect(parseGenericAnnouncementHtml(`
      <footer><a href="/duyuru/footer-sahte">Footer Duyurusu</a></footer>
      <div class="site-menu"><a href="/duyuru/menu-sahte">Menu Duyurusu</a></div>
    `, "https://example.edu.tr/duyurular", "announcement")).toEqual([]);
    expect(parseGenericAnnouncementHtml(`
      <form role="navigation">${"<div>".repeat(33)}<a href="/duyuru/sahte">Derin Sahte Duyuru</a>${"</div>".repeat(33)}</form>
    `, "https://example.edu.tr/duyurular", "announcement")).toEqual([]);
    expect(parseGenericAnnouncementHtml(`
      ${"<div>".repeat(33)}<a href="/duyuru/sahte">Derinlik Siniri Duyurusu</a>${"</div>".repeat(33)}
    `, "https://example.edu.tr/duyurular", "announcement")).toEqual([]);
  });

  it("derives a title only from a bounded evidenced card around an icon-only detail link", () => {
    const items = parseGenericAnnouncementHtml(`
      <div class="news-card">
        <h4>Genel Icerik - 2 Eylul 2026</h4>
        <h3>2026-2027 Yatay Geçiş Başvuru Sonuçları</h3>
        <a class="stretched-link" href="/duyurular/yatay-gecis-basvuru-sonuclari"><svg></svg></a>
      </div>
    `, "https://www.fbu.edu.tr/duyurular", "announcement");
    expect(items).toEqual([expect.objectContaining({
      title: "2026-2027 Yatay Geçiş Başvuru Sonuçları",
      link: "https://www.fbu.edu.tr/duyurular/yatay-gecis-basvuru-sonuclari"
    })]);
  });

  it("rejects FBU drop/fast menus inside typed listing containers", () => {
    const cases = [
      { type: "announcement" as const, path: "duyurular", count: 6 },
      { type: "event" as const, path: "etkinlikler", count: 4 },
      { type: "news" as const, path: "haberler", count: 7 }
    ];
    for (const { type, path, count } of cases) {
      const shortcut = type === "event"
        ? { title: "Bilimsel Etkinlikler", href: "/arastirma/bilimsel-etkinlikler" }
        : { title: "Akademik Bilgi Paketi", href: "/ogrenci/akademik-bilgi-paketi" };
      const realRows = Array.from({ length: count }, (_, index) => `
        <div class="${type}-card"><h3>${type} gercek baslik ${index + 1}</h3>
          <a class="stretched-link" href="/${path}/gercek-${index + 1}"><svg></svg></a>
        </div>
      `).join("");
      const items = parseGenericAnnouncementHtml(`
        <div class="${type}">
          <div class="drop-menu-row">
            <div class="drop-menu-col"><a href="/arastirma/fbu-dergileri">FBÜ Dergileri</a></div>
            <div class="drop-menu-list"><a href="${shortcut.href}">${shortcut.title}</a></div>
          </div>
          <div class="fast-menu-block"><a href="${shortcut.href}">${shortcut.title}</a></div>
          <div class="header-nav-lower"><a href="${shortcut.href}">${shortcut.title}</a></div>
          <a href="/ogrenci/rehberi">Öğrenci Rehberi</a>
          ${realRows}
        </div>
      `, `https://www.fbu.edu.tr/${path}`, type);

      expect(items).toHaveLength(count);
      expect(items.map((item) => item.link)).toEqual(Array.from(
        { length: count },
        (_, index) => `https://www.fbu.edu.tr/${path}/gercek-${index + 1}`
      ));
    }
  });

  it("reconstructs only Bandirma event-detail hashes carrying the complete CMS identity", () => {
    const items = parseGenericAnnouncementHtml(`
      <div class="etkinlik">
        <div class="tarih"><span>29</span> Agustos 2026</div>
        <div class="yazi"><h3>
          <a class="etkinlikLink" data-id="1775" data-birimseo="www" data-lang="tr"
             data-slug="5-Geleneksel-Engelsiz-Dalis-ve-Engelsiz-Kampi-Duzenleniyor"
             href="#seciliEtkinlikDetay">5. Geleneksel Engelsiz Dalis ve Engelsiz Kampi Duzenleniyor</a>
        </h3></div>
      </div>
      <div class="etkinlik"><h3>
        <a class="etkinlikLink" data-id="999" href="#seciliEtkinlikDetay">Eksik CMS Kimligi</a>
      </h3></div>
    `, "https://www.bandirma.edu.tr/tr/www/Etkinlik/Liste?k=-1", "event");

    expect(items).toEqual([expect.objectContaining({
      title: "5. Geleneksel Engelsiz Dalis ve Engelsiz Kampi Duzenleniyor",
      link: "https://www.bandirma.edu.tr/tr/www/Etkinlik/Liste/5-Geleneksel-Engelsiz-Dalis-ve-Engelsiz-Kampi-Duzenleniyor-1775?k=-1"
    })]);
  });

  it("rejects archive, date, all-items, and central Bandirma listing navigation URLs", () => {
    expect(parseGenericAnnouncementHtml(`
      <div class="row g-4 pt--30 pb--60">
        <div class="section-title"><h5 class="rbt-title-style-2">Hızlı Erişimler</h5></div>
        <div class="faq-button-grid">
          <a href="https://www.bandirma.edu.tr/tr/www/Duyuru/Liste?k=-1" class="faq-button">
            <i class="feather-bell"></i><span>Duyurular</span>
          </a>
          <a href="index.html"><img src="/Content/v2/images/logo_banu.png" alt="Bandırma Onyedi Eylül Üniversitesi"></a>
        </div>
      </div>
      <div class="well"><div class="media"><h4 class="media-heading">
        <a href="/tr/www/d/2026-2027-Guz-Donemi-Ders-Kayitlari-93023">2026-2027 Güz Dönemi Ders Kayıtları</a>
      </h4></div></div>
    `, "https://bandirmamyo.bandirma.edu.tr/tr/bandirmamyo/Duyuru/Liste?k=-1", "announcement"))
      .toEqual([expect.objectContaining({
        link: "https://bandirmamyo.bandirma.edu.tr/tr/www/d/2026-2027-Guz-Donemi-Ders-Kayitlari-93023"
      })]);

    expect(parseGenericAnnouncementHtml(`
      <article><a href="/date/2026/9">Eylül 2026</a></article>
      <div class="all-records d-flex justify-content-end">
        <a href="/haberler/etkinlikler">TÜM ETKİNLİKLER</a>
      </div>
      <article><a href="/haberler/ogrenci-topluluklari-bulusmasi">Öğrenci Toplulukları Buluşması Gerçekleşti</a></article>
    `, "https://akdeniz.edu.tr/tr/haberler", "news"))
      .toEqual([expect.objectContaining({
        link: "https://akdeniz.edu.tr/haberler/ogrenci-topluluklari-bulusmasi"
      })]);

    expect(parseGenericAnnouncementHtml(`
      <div class="tum-heading text-right"><h2><a class="btn" href="/duyuru-arsiv">Arşiv</a></h2></div>
      <div class="duyuru"><a href="/duyurular/kurumsal-e-posta-sisteminin-yenilenmesi-hakkinda-duyuru">
        Kurumsal E-Posta Sisteminin Yenilenmesi Hakkında Duyuru
      </a></div>
    `, "https://www.amasya.edu.tr/duyurular", "announcement"))
      .toEqual([expect.objectContaining({
        link: "https://www.amasya.edu.tr/duyurular/kurumsal-e-posta-sisteminin-yenilenmesi-hakkinda-duyuru"
      })]);
  });

  it("uses anchor metadata before a prior card heading and rejects Baskent category pages", () => {
    const items = parseGenericAnnouncementHtml(`
      <div class="cbp-item">
        <div class="blog-thumb-desc category-list event-list">
          <a class="link-to-post" href="https://www.baskent.edu.tr/tr/haberler/basvuru/18"><h4>Başvuru</h4></a>
          <a class="link-to-post" href="https://onkayit.baskent.edu.tr/konservatuvar/sonuc/"><h5>2026 Devlet Konservatuvarı Özel Yetenek Sınav Sonuçları</h5></a>
        </div>
      </div>
      <div class="cbp-item">
        <a href="https://www.baskent.edu.tr/tr/haberler/taziye/basimiz-sagolsun/882"
           class="cbp-caption" title="Başımız Sağolsun">
          <div class="cbp-caption-defaultWrap"><img alt="Başımız Sağolsun" src="taziye.jpg"></div>
        </a>
        <div class="blog-thumb-desc category-list event-list">
          <a class="link-to-post" href="https://www.baskent.edu.tr/tr/haberler/taziye/13"><h4>Taziye</h4></a>
          <a class="link-to-post" href="https://www.baskent.edu.tr/tr/haberler/taziye/basimiz-sagolsun/882"><h5>Başımız Sağolsun</h5></a>
        </div>
      </div>
      <div class="cbp-item">
        <a href="https://www.baskent.edu.tr/tr/haberler/egitim/butunlesik-yuksek-lisans-programi-imkni/880" class="cbp-caption">
          <div class="cbp-caption-defaultWrap"><img alt="Bütünleşik Yüksek Lisans Programı İmkânı" src="id8.jpg"></div>
        </a>
      </div>
    `, "https://www.baskent.edu.tr/tr/haberler", "news");

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Başımız Sağolsun",
        link: "https://www.baskent.edu.tr/tr/haberler/taziye/basimiz-sagolsun/882"
      }),
      expect.objectContaining({
        title: "Bütünleşik Yüksek Lisans Programı İmkânı",
        link: "https://www.baskent.edu.tr/tr/haberler/egitim/butunlesik-yuksek-lisans-programi-imkni/880"
      })
    ]));
    expect(items.some((item) => /\/(?:basvuru\/18|taziye\/13)$/u.test(new URL(item.link).pathname))).toBe(false);

    expect(parseGenericAnnouncementHtml(`
      <div class="cbp-item"><a href="/tr/etkinlikler/konferans/7"><h4>Konferans</h4></a></div>
      <div class="cbp-item"><a href="/tr/etkinlikler/konusma/16"><h4>Konuşma</h4></a></div>
      <div class="cbp-item"><a href="/tr/etkinlikler/yarisma/9"><h4>Yarışma</h4></a></div>
      <div class="cbp-item"><a href="/tr/etkinlikler/egitim/11"><h4>Eğitim</h4></a></div>
      <div class="cbp-item"><a href="/tr/etkinlikler/toren/5"><h4>Tören</h4></a></div>
      <div class="cbp-item" style="min-height: 460px">
        <a href="/upload/files/Yasam-Gecislerine-Iliskin-Yeni-Bir-Kuram.pdf" class="cbp-caption"
           title="Yaşam Geçişlerine İlişkin Yeni Bir Kuram">
          <div class="cbp-caption-defaultWrap"><img alt="Yaşam Geçişlerine İlişkin Yeni Bir Kuram" src="kuram.jpg"></div>
        </a>
        <div class="category-date"><h4 class="month">EYLÜL</h4><h3 class="day">08</h3></div>
        <div class="blog-thumb-desc category-list event-list">
          <a class="link-to-post" href="/tr/etkinlikler/konferans/7"><h4>Konferans</h4></a>
          <a class="link-to-post" href="/upload/files/Yasam-Gecislerine-Iliskin-Yeni-Bir-Kuram.pdf"><h5>Yaşam Geçişlerine İlişkin Yeni Bir Kuram</h5></a>
        </div>
      </div>
    `, "https://www.baskent.edu.tr/tr/etkinlikler", "event"))
      .toEqual([expect.objectContaining({
        title: "Yaşam Geçişlerine İlişkin Yeni Bir Kuram",
        link: "https://www.baskent.edu.tr/upload/files/Yasam-Gecislerine-Iliskin-Yeni-Bir-Kuram.pdf"
      })]);
  });

  it("never slices an unbounded document prefix to find generic anchor context", () => {
    const originalSlice = String.prototype.slice;
    let longestPrefixSlice = 0;
    String.prototype.slice = function (this: string, start?: number, end?: number): string {
      if ((start ?? 0) === 0 && typeof end === "number") longestPrefixSlice = Math.max(longestPrefixSlice, end);
      return originalSlice.call(this, start, end);
    };
    try {
      parseGenericAnnouncementHtml(
        `${"x".repeat(128 * 1024)}${Array.from({ length: 10 }, (_, index) => (
          `<a href="/duyuru/${index}">Duyuru ${index}</a>`
        )).join("")}`,
        "https://example.edu.tr/duyurular",
        "announcement"
      );
    } finally {
      String.prototype.slice = originalSlice;
    }
    expect(longestPrefixSlice).toBeLessThanOrEqual(32 * 1024);
  });

  it("does not apply HTML row heuristics to structured JSON or RSS envelopes", () => {
    expect(parseFetchedSourceItems(JSON.stringify({
      items: [{ title: "Yatay Geçiş Sonuçları", link: "/content/42" }]
    }), "https://example.edu.tr/duyurular", "auto", "announcement")).toHaveLength(1);
    expect(parseFetchedSourceItems(`
      <rss><channel><item><title>Yatay Geçiş Sonuçları</title><link>https://example.edu.tr/content/42</link></item></channel></rss>
    `, "https://example.edu.tr/duyurular", "auto", "announcement")).toHaveLength(1);
    expect(() => parseFetchedSourceItems(JSON.stringify({
      navigation: [
        { title: "Yemek Listesi", link: "/yemek-listesi" },
        { title: "Yönetmelikler", link: "/yonetmelikler" }
      ]
    }), "https://example.edu.tr/duyurular", "auto", "announcement"))
      .toThrow("SOURCE_JSON_LAYOUT_INVALID");
  });
});
