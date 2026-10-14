import { describe, expect, it } from "vitest";
import { isExplicitSelcukEmptyListing, isSupportedStaleListingUrl, hasOnlyOldDatedItems } from "../../packages/shared/src/source-listing-state";
import { parseDeviceSourceRuntimeDocument } from "../../packages/shared/src/device-source-runtime";

const url = "https://selcuk.edu.tr/birim/tumicerikler/5346/2";
const empty = '<main><div class="news-wrapper birim-tum-icerikler-news"><p class="birim-tum-icerikler__empty">Gösterilecek içerik bulunmuyor.</p></div></main>';
const recipe = { sourceUrl: url, allowedOfficialDomain: "selcuk.edu.tr", parser: "html" as const, contentType: "announcement" as const,
  checkedAt: "2026-10-13T10:00:00.000Z", parserConfig: { itemSelector: "article.news-card", titleSelector: ".title", linkSelector: "a", dateSelector: "time" } };

describe("empty and stale listing classification", () => {
  it("requires old date evidence instead of calling undated, future, mixed or boundary-day items old", () => {
    const now = "2026-10-14T11:00:00.000Z";
    expect(hasOnlyOldDatedItems([{ publishedDate: "2025-10-09" }], now)).toBe(true);
    for (const items of [[], [{}], [{ publishedDate: "invalid" }], [{ publishedDate: "2025-10-14" }],
      [{ publishedDate: "2029-01-01" }], [{ publishedDate: "2020-01-01" }, {}],
      [{ publishedDate: "2020-01-01", keyDates: [{ startDate: "2026-12-01" }] }]]) {
      expect(hasOnlyOldDatedItems(items, now)).toBe(false);
    }
  });
  it("classifies the verified KTUN news table as old without treating wrong selectors as warnings", () => {
    const sourceUrl = "https://www.ktun.edu.tr/tr/Birim/DuyuruDetay/bOlUmUmUzden_haberler_6877";
    const parserConfig = {
      itemSelector: "main#mainContent .kingster-single-article-content table.MsoTableGrid > tbody > tr",
      titleSelector: "td:nth-child(2) p:has(span):not(:has(strong))",
      linkSelector: "td:nth-child(3) a[href]", dateSelector: "td:nth-child(2) strong"
    };
    const listing = (date: string) => `<main id="mainContent"><div class="kingster-single-article-content"><table class="MsoTableGrid"><tbody><tr><td>Fotoğraf</td><td><p><strong>${date}</strong></p><p><span>Bölüm öğrencilerinin teknik gezisi</span></p></td><td><a href="/tr/Birim/DuyuruDetay/teknIk_gezI_6883">Detay</a></td></tr></tbody></table></div></main>`;
    const ktunRecipe = { ...recipe, sourceUrl, allowedOfficialDomain: "ktun.edu.tr", contentType: "news" as const,
      checkedAt: "2026-10-14T11:00:00.000Z", parserConfig };
    expect(isSupportedStaleListingUrl(sourceUrl)).toBe(true);
    expect(() => parseDeviceSourceRuntimeDocument(listing("09.10.2025"), ktunRecipe)).toThrow("SOURCE_LISTING_STALE");
    expect(parseDeviceSourceRuntimeDocument(listing("14.10.2026"), ktunRecipe)).toHaveLength(1);
    expect(() => parseDeviceSourceRuntimeDocument(listing("09.10.2025"), { ...ktunRecipe, parserConfig: { ...parserConfig, itemSelector: ".wrong" } })).toThrow("SOURCE_HTML_SELECTOR_LAYOUT_INVALID");
    for (const url of [sourceUrl.replace("ktun.edu.tr", "ktun.edu.tr.evil.example"), sourceUrl.replace("6877", "7508"), sourceUrl.replace("https:", "http:"), `${sourceUrl}?page=2`]) {
      expect(isSupportedStaleListingUrl(url)).toBe(false);
    }
  });
  it("recognizes only the official CMS empty marker in its listing container", () => {
    expect(isExplicitSelcukEmptyListing(empty, url)).toBe(true);
    for (const [html, sourceUrl] of [[empty, "https://untrusted.example/birim/tumicerikler/5346/2"], [empty, "https://selcuk.edu.tr/login"], [empty.replace("<main>", "<footer>").replace("</main>", "</footer>"), url], [empty.replace("</div>", '<article class="news-card">Unread content</article></div>'), url]]) {
      expect(isExplicitSelcukEmptyListing(html, sourceUrl)).toBe(false);
    }
  });
  it("does not disguise genuinely changed markup as an empty listing", () => {
    expect(() => parseDeviceSourceRuntimeDocument("<main><div>Changed layout</div></main>", recipe)).toThrow("SOURCE_HTML_SELECTOR_LAYOUT_INVALID");
    expect(() => parseDeviceSourceRuntimeDocument(empty, recipe)).toThrow("SOURCE_LISTING_EMPTY");
  });
  it("keeps malformed selectors as errors even on an empty page", () => {
    expect(() => parseDeviceSourceRuntimeDocument(empty, { ...recipe, parserConfig: { itemSelector: "[[[" } })).toThrow();
    expect(() => parseDeviceSourceRuntimeDocument(empty, { ...recipe, parserConfig: { ...recipe.parserConfig, dateSelector: "[[[" } })).toThrow();
  });
  it("distinguishes stale items from unreadable selectors and retains fresh items", () => {
    const listing = (date: string) => `<main><article class="news-card"><h2 class="title"><a href="/birim/icerik/5346/test-123">Öğrenci kayıt duyurusu</a></h2><time>${date}</time></article></main>`;
    expect(() => parseDeviceSourceRuntimeDocument(listing("2020-01-01"), recipe)).toThrow("SOURCE_LISTING_STALE");
    expect(parseDeviceSourceRuntimeDocument(listing("2026-10-12"), recipe)).toHaveLength(1);
    expect(() => parseDeviceSourceRuntimeDocument(listing("2026-10-12"), { ...recipe, parserConfig: { itemSelector: ".wrong" } })).toThrow("SOURCE_HTML_SELECTOR_LAYOUT_INVALID");
    expect(parseDeviceSourceRuntimeDocument(listing("2020-01-01"), { ...recipe, sourceUrl: "https://other.edu.tr/list", allowedOfficialDomain: "other.edu.tr" })).toEqual([]);
  });
});
