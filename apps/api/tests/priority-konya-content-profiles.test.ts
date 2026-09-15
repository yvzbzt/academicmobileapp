import { describe, expect, it } from "vitest";
import { listVerifiedUniversitySources } from "../src/bootstrap/verified-source-registry.js";
import { parseDeviceSourceRuntimeDocument } from "../../../packages/shared/src/device-source-runtime.js";

const checkedAt = "2026-09-15T12:00:00.000Z";

async function parse(universityId: string, contentType: "announcement" | "news" | "event", html: string) {
  const source = (await listVerifiedUniversitySources()).find((candidate) => candidate.universityId === universityId)!;
  const profile = source.parserProfiles![contentType]!;
  const sourceUrl = source[`${contentType}Url`]!;
  expect(profile).toBeDefined();
  return parseDeviceSourceRuntimeDocument(html, {
    sourceUrl,
    allowedOfficialDomain: new URL(sourceUrl).hostname.replace(/^www\./, ""),
    contentType,
    ...profile,
    checkedAt
  });
}

describe("curated Konya university content profiles", () => {
  it.each(["announcement", "news"] as const)("extracts Selçuk %s titles without card metadata and preserves official PDF links", async (contentType) => {
    const prefix = contentType === "news" ? "news" : "announcement";
    const href = contentType === "news" ? "/icerik/haber/82893/arastirma-haberi" : "https://uzemegitim.selcuk.edu.tr/kilavuzlar/muafiyet.pdf";
    const items = await parse("selcuk-universitesi-konya", contentType, `
      <nav><a href="/icerik/duyurular">Duyurular</a></nav>
      <article class="${prefix}-card"><a class="${prefix}-card__link" href="${href}">
        <time class="${prefix}-card__date" datetime="2026-09-14">14.09.2026</time>
        <span>Öğrenci</span><h2 class="${prefix}-card__title">Kaynak başlığı</h2>
        <p class="${prefix}-card__description">Kaynakta yayımlanan kısa açıklama.</p><span>Devamını Oku</span>
      </a></article>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Kaynak başlığı", publishedDate: "2026-09-14", summary: "Kaynakta yayımlanan kısa açıklama." });
    expect(items[0]!.link).toBe(new URL(href, "https://selcuk.edu.tr").toString());
  });

  it("reads both scientific and social Selçuk event cards but rejects external destinations", async () => {
    const card = (href: string, title: string) => `<a class="events-component__card" href="${href}"><span>YAKLAŞAN ETKİNLİK</span><h3 class="events-component__name">${title}</h3><div class="events-component__date-text">25.09.2026</div></a>`;
    const items = await parse("selcuk-universitesi-konya", "event", `<main>${card("https://etkinlik.selcuk.edu.tr/etkinlik/detay?id=1662", "Genomik Çalıştayı")}${card("https://etkinlik.selcuk.edu.tr/etkinlik/detay?id=1676", "Bağımlılıkla Mücadele")}${card("https://outside.example/event", "Kurum dışı")}</main>`);
    expect(items.map((item) => item.title)).toEqual(["Genomik Çalıştayı", "Bağımlılıkla Mücadele"]);
    expect(items.every((item) => item.publishedDate === undefined && item.keyDates?.[0]?.startDate === "2026-09-25")).toBe(true);
  });

  it("reads KTUN announcement table dates and never exposes the duplicate Detay button", async () => {
    const items = await parse("konya-teknik-universitesi", "announcement", `<table><tbody><tr><td><a href="/tr/Universite/DuyuruDetay/yabanci_dil_sinavi_8767">Yabancı Dil Muafiyet Sınavı</a></td><td>14.09.2026</td><td><a href="/tr/Universite/DuyuruDetay/yabanci_dil_sinavi_8767">Detay</a></td></tr></tbody></table>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Yabancı Dil Muafiyet Sınavı", publishedDate: "2026-09-14" });
  });

  it("uses the official KTUN calendar JSON with event dates instead of the empty JS calendar shell", async () => {
    const items = await parse("konya-teknik-universitesi", "event", JSON.stringify([{ id: 524, title: "Mavi Vatan", start: "/Date(1784754000000)/", end: "/Date(1787432400000)/", url: "/Resimler/EtkinlikResim/AfisOrjinal/0/Mavi_Vatan.jpeg", description: "technical-owner@ktun.edu.tr" }]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Mavi Vatan", keyDates: [{ label: "Etkinlik tarihi", startDate: "2026-07-23", endDate: "2026-08-23" }] });
    expect(items[0]!.summary).toBeUndefined();
  });

  it.each(["announcement", "event"] as const)("reads Necmettin Erbakan %s cards without share/navigation links", async (contentType) => {
    const container = contentType === "announcement" ? "col-md-11" : "col-md-8";
    const path = contentType === "announcement" ? "duyuru" : "etkinlik";
    const items = await parse("necmettin-erbakan-universitesi-konya", contentType, `<a href="/tr/${path}lar">SEÇİMİ TEMİZLE</a><div class="${container}"><div class="tarih">${contentType === "announcement" ? "14" : "24"} Eylül 2026 | <span>09:00</span></div><div class="baslik"><a href="https://erbakan.edu.tr/tr/${path}/egitim-sempozyumu-2136">Eğitim Sempozyumu</a></div><div class="spot">Sempozyum programı kaynakta yayımlandı.</div><a href="https://facebook.com/share">Paylaş</a></div>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Eğitim Sempozyumu", summary: "Sempozyum programı kaynakta yayımlandı." });
    if (contentType === "event") {
      expect(items[0]?.keyDates).toEqual([{ label: "Etkinlik tarihi", startDate: "2026-09-24" }]);
      expect(items[0]?.publishedDate).toBeUndefined();
    } else {
      expect(items[0]?.publishedDate).toBe("2026-09-14");
    }
  });

  it("does not label the NEÜ congress start badge as a future publication date", async () => {
    const items = await parse("necmettin-erbakan-universitesi-konya", "announcement", `<div class="col-md-11">
      <div class="tarih">15 Ekim 2026 | <span>09:42</span></div>
      <div class="baslik"><a href="https://erbakan.edu.tr/tr/duyuru/karabuk-universitesi-uluslararasi-karabuk-saglik-bilimleri-kongre-duyurusu-28260">Karabük Üniversitesi Uluslararası Karabük Sağlık Bilimleri Kongre Duyurusu</a></div>
      <div class="spot">15-18 Ekim 2026 tarihlerinde Uluslararası Karabük Sağlık Bilimleri Kongresi düzenlenecektir.</div></div>`);
    expect(items).toHaveLength(1);
    expect(items[0]?.summary).toContain("15-18 Ekim 2026");
    expect(items[0]?.publishedDate).toBeUndefined();
    expect(items[0]?.publishedAt).toBeUndefined();
    expect(items[0]?.publicationKind).toBeUndefined();
    expect(items[0]?.keyDates).toBeUndefined();
  });

  it("reads Necmettin Erbakan full image alt headlines rather than the truncated display heading", async () => {
    const items = await parse("necmettin-erbakan-universitesi-konya", "news", `<div class="col-md-4 mb-4"><a href="https://erbakan.edu.tr/tr/haber/teknoloji-maratonu-13142#haber_detay"><img alt="Üniversitemizde 3 Haftalık Teknoloji Maratonu Tamamlandı"></a><div class="tarih">13 Ağustos 2026 | Akademik</div><div class="baslik">Üniversitemizde 3 Haftalık Teknoloji Maratonu Tama...</div><div class="spot">Atölye çalışmalarımız tamamlandı.</div><a href="https://facebook.com/share">Paylaş</a></div>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Üniversitemizde 3 Haftalık Teknoloji Maratonu Tamamlandı", publishedDate: "2026-08-13", link: "https://erbakan.edu.tr/tr/haber/teknoloji-maratonu-13142" });
  });
});
