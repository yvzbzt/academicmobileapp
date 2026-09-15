import { describe, expect, it } from "vitest";
import { listVerifiedUniversitySources } from "../src/bootstrap/verified-source-registry.js";
import { parseDeviceSourceRuntimeDocument } from "../../../packages/shared/src/device-source-runtime.js";

async function parse(universityId: string, contentType: "announcement" | "news" | "event", html: string) {
  const source = (await listVerifiedUniversitySources()).find((candidate) => candidate.universityId === universityId)!;
  const sourceUrl = source[`${contentType}Url`]!;
  return parseDeviceSourceRuntimeDocument(html, {
    sourceUrl, allowedOfficialDomain: new URL(sourceUrl).hostname.replace(/^www\./, ""),
    contentType, ...source.parserProfiles![contentType]!, checkedAt: "2026-09-15T12:00:00.000Z"
  });
}

describe("Bandırma and Marmara source profiles", () => {
  it.each(["announcement", "news"] as const)("reads Bandırma %s heading and footer date rather than Görüntüle", async (contentType) => {
    const path = contentType === "announcement" ? "d" : "h";
    const href = `/tr/www/${path}/Ders-Kayitlari-93023`;
    const items = await parse("bandirma-onyedi-eylul-universitesi-balikesir", contentType, `<div class="blogList"><div class="well"><div class="media"><a class="pull-left" href="${href}"><img></a><div class="media-body"><h5 class="media-heading"><a href="${href}">Ders Kayıtları</a></h5><p>Ders kayıtlarının tamamlanması gerekmektedir.</p><ul class="itemFooter"><li class="pull-right"><a href="${href}">Görüntüle</a></li><li><i class="fa fa-calendar"></i>14.09.2026</li><li>Genel</li></ul></div></div></div></div>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Ders Kayıtları", publishedDate: "2026-09-14", link: `https://bandirma.edu.tr${href}` });
  });

  it("keeps the required Bandırma event category and builds a real event permalink", async () => {
    const source = (await listVerifiedUniversitySources()).find((candidate) => candidate.universityId === "bandirma-onyedi-eylul-universitesi-balikesir")!;
    expect(source.eventUrl).toBe("https://bandirma.edu.tr/tr/www/Etkinlik/Liste?k=-1");
    const items = await parse(source.universityId, "event", `<div class="etkinlik"><div class="tarih"><span>29</span> <span>Ağustos</span> <span>2026</span></div><h3><a class="etkinlikLink" data-id="1775" data-birimseo="www" data-lang="tr" data-slug="Engelsiz-Dalis" href="#seciliEtkinlikDetay">Engelsiz Dalış</a></h3><a href="https://facebook.com/share">Paylaş</a></div>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Engelsiz Dalış", keyDates: [{ label: "Etkinlik tarihi", startDate: "2026-08-29" }], link: "https://bandirma.edu.tr/tr/www/Etkinlik/Liste/Engelsiz-Dalis-1775?k=-1" });
    expect(items[0]?.publishedDate).toBeUndefined();
    expect(items[0]?.publishedAt).toBeUndefined();
  });

  it.each(["announcement", "news"] as const)("reads Marmara %s standalone headings and keeps faculty subdomain links", async (contentType) => {
    const href = contentType === "announcement" ? "https://oidb.marmara.edu.tr/notice/dgs-kayit-islemleri" : "/news/ilk-market-acildi";
    const items = await parse("marmara-universitesi-istanbul", contentType, `<div class="blog-pull-right"><div class="row mb-15"><div class="col-md-8"><h4 class="line-bottom">DGS Kayıt İşlemleri</h4><ul class="review_text"><li><h6>10.09.2026</h6></li></ul><p></p><a href="${href}">Devamı</a></div></div></div><aside><a href="/news/yan-panel">Yan panel haberi</a></aside>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "DGS Kayıt İşlemleri", publishedDate: "2026-09-10", link: new URL(href, "https://www.marmara.edu.tr").toString() });
  });

  it("keeps future Marmara event dates without inventing a publication date or reading the shared news sidebar", async () => {
    const items = await parse("marmara-universitesi-istanbul", "event", `<article class="media"><h4><a href="/event/karadeniz-kongresi">Mavi Karadeniz Kongresi</a></h4><ul><li><i class="fa fa-calendar"></i>22.10.2026</li></ul></article><article class="media"><h4><a href="/news/yan-haber">Yan haber</a></h4><ul><li><i class="fa fa-calendar"></i>15.09.2026</li></ul></article>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Mavi Karadeniz Kongresi", keyDates: [{ label: "Etkinlik tarihi", startDate: "2026-10-22" }] });
    expect(items[0]?.publishedDate).toBeUndefined();
    expect(items[0]?.publishedAt).toBeUndefined();
  });
});
