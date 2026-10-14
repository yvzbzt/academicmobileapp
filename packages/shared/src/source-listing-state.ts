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

// This KTUN detail endpoint contains a verified, dated department news table.
// Do not classify arbitrary detail pages (or a missing selector) as old listings.
export function isSupportedStaleListingUrl(sourceUrl: string): boolean {
  if (isSelcukUnitListingUrl(sourceUrl)) return true;
  try {
    const url = new URL(sourceUrl);
    return url.protocol === "https:" && !url.port && !url.username && !url.password && !url.search && !url.hash
      && ["ktun.edu.tr", "www.ktun.edu.tr"].includes(url.hostname)
      && url.pathname.toLowerCase() === "/tr/birim/duyurudetay/bolumumuzden_haberler_6877";
  } catch { return false; }
}

export function hasOnlyOldDatedItems(items: readonly {
  publishedAt?: string; publishedDate?: string;
  keyDates?: readonly { startDate: string; endDate?: string }[];
}[], checkedAt: string): boolean {
  const cutoff = new Date(checkedAt);
  if (!Number.isFinite(cutoff.getTime()) || items.length === 0) return false;
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return items.every((item) => {
    const values = [item.publishedAt, item.publishedDate,
      ...(item.keyDates ?? []).map((date) => date.endDate ?? date.startDate)].filter((value): value is string => Boolean(value));
    return values.length > 0 && values.every((value) => {
      const date = new Date(/^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T12:00:00.000Z` : value);
      return Number.isFinite(date.getTime()) && date.getTime() < cutoff.getTime();
    });
  });
}
