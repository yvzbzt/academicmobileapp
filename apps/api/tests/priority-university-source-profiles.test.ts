import { describe, expect, it } from "vitest";
import { listVerifiedUniversitySources } from "../src/bootstrap/verified-source-registry.js";
import { parseDeviceSourceRuntimeDocument } from "../../../packages/shared/src/device-source-runtime.js";

const sources = await listVerifiedUniversitySources();
const checkedAt = "2026-09-15T12:00:00.000Z";

describe("priority university source profiles", () => {
  it.each(["ankara-universitesi", "yalova-universitesi", "kahramanmaras-sutcu-imam-universitesi"])(
    "%s has an official URL and explicit recipe for all three content types", (universityId) => {
      const source = sources.find((candidate) => candidate.universityId === universityId)!;
      for (const type of ["announcement", "news", "event"] as const) {
        expect(source[`${type}Url`]).toMatch(/^https:\/\//u);
        expect(source.parserProfiles?.[type]).toBeDefined();
      }
    },
  );

  it("uses Ankara's dated RSS items instead of author and category anchors", () => {
    const items = parse("ankara-universitesi", "announcement", `<rss><channel>
      <title>Ankara Üniversitesi Duyuruları</title><link>https://oidb.ankara.edu.tr/</link>
      <item><title>2026-2027 Ders Kayıt Duyurusu</title>
      <link>https://oidb.ankara.edu.tr/2026/09/14/ders-kayit/</link>
      <pubDate>Mon, 14 Sep 2026 09:04:53 +0000</pubDate></item>
    </channel></rss>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "2026-2027 Ders Kayıt Duyurusu", publishedAt: "2026-09-14T09:04:53.000Z" });
  });

  it.each(["announcement", "news"] as const)("extracts KSÜ %s cards without duplicate detail links", (type) => {
    const items = parse("kahramanmaras-sutcu-imam-universitesi", type, `<main>
      <a href="/default?DId=KSU&amp;MI=42547">Tümünü Gör</a>
      <article class="card blog-card"><div class="card-body">
      <div class="d-block text-muted mb-2 small">15.09.2026</div>
      <h3><a href="/default?DId=103265&amp;MI=42547">39. Ahilik Haftası Kutlama Programı Gerçekleştirildi</a></h3>
      <p>Üniversitemiz kutlama programına katıldı.</p>
      <span class="read-more"><a href="/default?DId=103265&amp;MI=42547">Detay</a></span>
      </div></article></main>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ publishedDate: "2026-09-15", summary: "Üniversitemiz kutlama programına katıldı." });
  });

  it("extracts KSÜ events whose heading is inside the linked feature card", () => {
    const items = parse("kahramanmaras-sutcu-imam-universitesi", "event", `<main>
      <a href="/default?EId=107&amp;MI=42548"><div class="feature-box-02">
      <div class="feature-textbox"><h4>Gazze'de Öğrenci Olmak</h4>
      <ul class="feature-desc"><li><b>Yer : </b>Kahramanmaraş Fen Lisesi</li>
      <li><b>Tarih : </b>17.09.2026</li><li>Saat : 14:00</li></ul></div></div></a></main>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Gazze'de Öğrenci Olmak", publishedDate: "2026-09-17" });
  });

  it.each(["announcement", "news"] as const)("extracts Yalova %s dates without the Son pagination link", (type) => {
    const route = type === "announcement" ? "Duyuru" : "Haber";
    const items = parse("yalova-universitesi", type, `<div class="gdlr-core-event-item-list">
      <h3 class="gdlr-core-event-item-title"><a href="/tr/${route}/Detay/ogrenci-oryantasyonu"></a>
      <a href="/tr/${route}/Detay/ogrenci-oryantasyonu">Yeni Öğrenci Oryantasyon Programı</a></h3>
      <span class="gdlr-core-blog-info-date">11 Eylül 2026 Cuma</span></div>
      <a href="/tr/${route}?page=212">Son</a>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Yeni Öğrenci Oryantasyon Programı", publishedDate: "2026-09-11" });
  });

  it("preserves Yalova event dates rendered as adjacent abbreviated month spans", () => {
    const items = parse("yalova-universitesi", "event", `<div class="gdlr-core-event-item-list">
      <span class="gdlr-core-type-start-date-month"><span>24</span><span>Eyl</span><span>2026</span></span>
      <h3 class="gdlr-core-event-item-title"><a href="/tr/Etkinlik/Detay/icmois-2026"></a>
      <a href="/tr/Etkinlik/Detay/icmois-2026">ICMOIS 2026 Kongresi</a></h3>
      <div class="gdlr-core-event-item-info-wrap">10:00 Kongre Online</div></div>
      <a href="/tr/Etkinlik?page=30">Son</a>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "ICMOIS 2026 Kongresi", publishedDate: "2026-09-24" });
  });
});

function parse(universityId: string, contentType: "announcement" | "news" | "event", html: string) {
  const source = sources.find((candidate) => candidate.universityId === universityId)!;
  const sourceUrl = source[`${contentType}Url`]!;
  const profile = source.parserProfiles![contentType]!;
  return parseDeviceSourceRuntimeDocument(html, {
    sourceUrl,
    allowedOfficialDomain: new URL(sourceUrl).hostname.split(".").slice(-3).join("."),
    contentType,
    parser: profile.parser,
    ...(profile.parserConfig ? { parserConfig: profile.parserConfig } : {}),
    checkedAt,
  });
}
