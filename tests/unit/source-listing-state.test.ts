import { describe, expect, it } from "vitest";
import { isExplicitSelcukEmptyListing } from "../../packages/shared/src/source-listing-state";
import { parseDeviceSourceRuntimeDocument } from "../../packages/shared/src/device-source-runtime";

const url = "https://selcuk.edu.tr/birim/tumicerikler/5346/2";
const empty = '<main><div class="news-wrapper birim-tum-icerikler-news"><p class="birim-tum-icerikler__empty">Gösterilecek içerik bulunmuyor.</p></div></main>';
const recipe = { sourceUrl: url, allowedOfficialDomain: "selcuk.edu.tr", parser: "html" as const, contentType: "announcement" as const,
  checkedAt: "2026-10-13T10:00:00.000Z", parserConfig: { itemSelector: "article.news-card", titleSelector: ".title", linkSelector: "a", dateSelector: "time" } };

describe("empty and stale listing classification", () => {
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
