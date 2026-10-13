import { load } from "cheerio/slim";

// Only a verified CMS empty-state counts as empty; arbitrary missing selectors do not.
export function isSelcukUnitListingUrl(sourceUrl: string): boolean {
  let url: URL;
  try { url = new URL(sourceUrl); } catch { return false; }
  if (url.protocol !== "https:" || url.port || url.username || url.password || !["selcuk.edu.tr", "www.selcuk.edu.tr"].includes(url.hostname)
    || !/^\/birim\/tumicerikler\/\d+\/[0-3]\/?$/.test(url.pathname)) return false;
  return true;
}

export function isExplicitSelcukEmptyListing(html: string, sourceUrl: string): boolean {
  if (!isSelcukUnitListingUrl(sourceUrl)) return false;
  const $ = load(html);
  const listing = $("main .news-wrapper.birim-tum-icerikler-news");
  return listing.length === 1 && listing.find("article, .news-card, .announcement-card").length === 0
    && listing.find("p.birim-tum-icerikler__empty").toArray().some((node) =>
      $(node).text().replace(/\s+/g, " ").trim() === "Gösterilecek içerik bulunmuyor.");
}

export function isInformationalListingCode(code: string): boolean {
  return code === "SOURCE_LISTING_EMPTY" || code === "SOURCE_LISTING_STALE";
}
