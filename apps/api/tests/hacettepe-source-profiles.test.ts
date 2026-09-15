import { expect, it } from "vitest";
import { listVerifiedUniversitySources } from "../src/bootstrap/verified-source-registry.js";
import { parseDeviceSourceRuntimeDocument } from "../../../packages/shared/src/device-source-runtime.js";

const source = (await listVerifiedUniversitySources()).find(candidate => candidate.universityId === "hacettepe-universitesi-ankara")!;

function parse(contentType: "announcement" | "news" | "event", html: string) {
  const profile = source.parserProfiles![contentType]!;
  return parseDeviceSourceRuntimeDocument(html, {
    sourceUrl: source[`${contentType}Url`]!,
    allowedOfficialDomain: "hacettepe.edu.tr",
    contentType,
    parser: profile.parser,
    ...(profile.parserConfig ? { parserConfig: profile.parserConfig } : {}),
    checkedAt: "2026-09-15T12:00:00.000Z"
  });
}

it("reads dated Hacettepe announcements and preserves direct PDF sources without treating navigation as content", () => {
  expect(source.announcementUrl).toBe("https://hacettepe.edu.tr/duyurular/guncel-duyurular");
  const items = parse("announcement", `<nav><a href="/duyurular">Güncel Duyurular</a></nav><table>
    <tr><td><a href="/duyuru/rekduy/TrafikAkisPlaniAciklama070926.pdf">Beytepe Yerleşkesi Trafik Akış Planı Hakkında</a>
      <br><span class="smallyayin">07.09.2026</span></td></tr>
    <tr><td><a href="/duyuru/rekduy/eski.pdf">Eski Öğretim Üyesi İlanı</a><span class="smallyayin">01.01.2024</span></td></tr>
    <tr><td><a href="https://untrusted.invalid/ilan.pdf">Kurum Dışı İlan</a><span class="smallyayin">07.09.2026</span></td></tr>
    </table>`);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    title: "Beytepe Yerleşkesi Trafik Akış Planı Hakkında",
    link: "https://hacettepe.edu.tr/duyuru/rekduy/TrafikAkisPlaniAciklama070926.pdf",
    publishedDate: "2026-09-07"
  });
});

it("uses the news headline URL rather than the shortened image alias and separates author from publication date", () => {
  expect(source.newsUrl).toBe("https://gazete.hacettepe.edu.tr/tr/haberler");
  const items = parse("news", `<a href="/tr/haberler/ogretim-5">Öğretim</a><div class="haber2">
    <a class="haber2_resim-link" href="/tr/haber/kampusten_cop31’e_yolculuk_b-985"><div class="haber2_resim"></div></a>
    <div class="p-3"><div class="haber2_baslik"><a href="/tr/haber/kampusten_cop31e_yolculuk_basladi-985">Kampüsten COP31’e yolculuk başladı</a></div>
      <div class="haber_yazan">admin / 14.09.2026</div><div class="haber2_ozet">Öğrenciler iklim politikalarını tartıştı.</div></div></div>`);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    title: "Kampüsten COP31’e yolculuk başladı",
    link: "https://gazete.hacettepe.edu.tr/tr/haber/kampusten_cop31e_yolculuk_basladi-985",
    publishedDate: "2026-09-14",
    summary: "Öğrenciler iklim politikalarını tartıştı."
  });
});

it("reads actual event headings and separates event dates from publication dates", () => {
  expect(source.eventUrl).toBe("https://etkinlikler.hacettepe.edu.tr/");
  expect(source.parserProfiles?.event?.parserConfig?.dateSelector).toBeUndefined();
  const items = parse("event", `<nav><a href="/tr/bugun">Bugün</a><a href="/tr/aylik">Aylık Etkinlikler</a></nav>
    <div class="haber_card h-100"><div class="haber_card_ic">
      <div class="haber_card_baslik">Sağlıkta Simülasyon Haftası Etkinliği</div>
      <div class="haber_ozet mb-2">Tüm öğrencilerimiz davetlidir.</div>
      <div class="haber_ayrinti_but"><a href="/tr/saglikta_simulasyon_haftasi_et-3352">Devamı</a></div></div>
      <div class="haber_alt">17.09.2026 12:00<span> | </span>Diğer</div></div>`);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    title: "Sağlıkta Simülasyon Haftası Etkinliği",
    link: "https://etkinlikler.hacettepe.edu.tr/tr/saglikta_simulasyon_haftasi_et-3352",
    summary: "17.09.2026 12:00 | Diğer",
    keyDates: [{ label: "Etkinlik tarihi", startDate: "2026-09-17" }]
  });
  expect(items[0]?.publishedAt).toBeUndefined();
  expect(items[0]?.publishedDate).toBeUndefined();
});
