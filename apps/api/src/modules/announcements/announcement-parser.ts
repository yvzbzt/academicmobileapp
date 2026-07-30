import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { isFreshAcademicContent } from "../../domain/temporal-freshness.js";
import {
  canonicalContentKey,
  canonicalizeContentUrl,
  compareAcademicContentDuplicateRecency,
  createContentDedupeKey,
  evaluateContentTrust,
  isNavigationOrChromeTitle,
  isOfficialContentUrl,
  normalizeDisplayText,
  toIsoString
} from "./announcement-content-trust.js";
import type { AnnouncementItem, AnnouncementSourceParser, AnnouncementSourceRecord } from "./announcements.types.js";

ensureCrawlerSystemCa();

export interface ParsedAnnouncementItem {
  title: string;
  rawTitle?: string;
  link: string;
  publishedAt?: Date;
  sourceUpdatedAt?: Date;
  summary?: string;
}

export async function fetchSourceItems(sourceUrl: string, parser: AnnouncementSourceParser, timeoutMs = 7000): Promise<ParsedAnnouncementItem[]> {
  const officialSourceUrl = requireOfficialSourceUrl(sourceUrl);
  const atuItems = await fetchAtuContentItems(officialSourceUrl, timeoutMs);
  if (atuItems) return atuItems.slice(0, 30);

  const body = await fetchText(officialSourceUrl, timeoutMs, { accept: "text/html,application/json,application/rss+xml,application/xml;q=0.9,*/*;q=0.8" });
  if (parser === "auto" && looksLikeJson(body.text)) return parseJsonAnnouncements(body.text, body.finalUrl).slice(0, 30);
  const resolvedParser = parser === "auto" ? (looksLikeXmlFeed(body.text) ? "rss" : "html") : parser;
  if (resolvedParser === "rss") return parseSyndicatedAnnouncements(body.text, body.finalUrl).slice(0, 30);
  if (isYokSourceUrl(body.finalUrl)) return parseYokAnnouncementHtml(body.text, body.finalUrl).slice(0, 30);
  if (isAnkaraUniversitySourceUrl(body.finalUrl)) return parseAnkaraUniversityAnnouncementHtml(body.text, body.finalUrl).slice(0, 30);
  return parseGenericAnnouncementHtml(body.text, body.finalUrl).slice(0, 30);
}

export async function fetchText(sourceUrl: string, timeoutMs = 7000, input: { accept?: string } = {}): Promise<{ text: string; finalUrl: string; status: number }> {
  const officialSourceUrl = requireOfficialSourceUrl(sourceUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchTextWithFetch(officialSourceUrl, timeoutMs, input, controller.signal);
  } catch (error) {
    if (isNonRetryableSourceError(error)) throw error;
    try {
      return await fetchTextWithNodeClient(officialSourceUrl, officialSourceUrl, timeoutMs, input, 0, false);
    } catch (nodeError) {
      if (shouldRetryWithInvalidTls(officialSourceUrl, error) || shouldRetryWithInvalidTls(officialSourceUrl, nodeError)) {
        return fetchTextWithNodeClient(officialSourceUrl, officialSourceUrl, timeoutMs, input, 0, true);
      }
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
}

function isNonRetryableSourceError(error: unknown): boolean {
  return error instanceof Error && /^(?:SOURCE_FETCH_FAILED:|SOURCE_URL_|SOURCE_REDIRECT_)/u.test(error.message);
}

export function toAnnouncementItems(source: AnnouncementSourceRecord, parsedItems: ParsedAnnouncementItem[], fetchedAt = new Date()): AnnouncementItem[] {
  const officialSourceUrl = canonicalizeContentUrl(source.canonicalUrl ?? source.sourceUrl);
  if (!officialSourceUrl || !isOfficialContentUrl(officialSourceUrl, officialSourceUrl)) return [];
  const fetchedAtIso = fetchedAt.toISOString();
  const contentType = source.contentType ?? "announcement";

  return dedupeAnnouncements(parsedItems.flatMap((item): AnnouncementItem[] => {
    const trust = evaluateContentTrust({
      rawTitle: item.rawTitle ?? item.title,
      url: item.link,
      officialSourceUrl,
      contentType
    });
    if (trust.status !== "trusted" || !trust.title || !trust.canonicalUrl || !trust.dedupeKey) return [];
    const summary = normalizeDisplayText(item.summary, 1_200);
    const freshness = isFreshAcademicContent({
      title: trust.title,
      url: trust.canonicalUrl,
      ...(summary ? { text: summary } : {}),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {})
    });
    if (!freshness.accepted) return [];

    return [{
      id: createAnnouncementId(source.id, trust.canonicalUrl, trust.title),
      sourceId: source.id,
      sourceName: normalizeDisplayText(source.sourceName, 160) || source.sourceName,
      contentType,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      title: trust.title,
      rawTitle: trust.rawTitle,
      link: trust.canonicalUrl,
      canonicalUrl: trust.canonicalUrl,
      officialSourceUrl,
      ...(item.publishedAt ? { publishedAt: item.publishedAt.toISOString(), publicationTimeSource: "source" as const } : {}),
      ...(item.sourceUpdatedAt ? { sourceUpdatedAt: item.sourceUpdatedAt.toISOString(), sourceUpdateTimeSource: "source" as const } : {}),
      discoveredAt: fetchedAtIso,
      ...(summary ? { summary } : {}),
      fetchedAt: fetchedAtIso,
      freshness: "fresh",
      trustStatus: "trusted",
      trustReasonCodes: [],
      dedupeKey: trust.dedupeKey
    }];
  }));
}

export function parseHtmlAnchors(input: string, sourceUrl: string): ParsedAnnouncementItem[] {
  return parseGenericAnnouncementHtml(input, sourceUrl);
}

export function parseYokAnnouncementHtml(input: string, sourceUrl = "https://www.yok.gov.tr/tr/announcements"): ParsedAnnouncementItem[] {
  return parseHtmlDocument(input, sourceUrl, "yok");
}

export function parseAnkaraUniversityAnnouncementHtml(input: string, sourceUrl = "https://oidb.ankara.edu.tr/gecmis-duyurular/"): ParsedAnnouncementItem[] {
  return parseHtmlDocument(input, sourceUrl, "ankara");
}

export function parseGenericAnnouncementHtml(input: string, sourceUrl: string): ParsedAnnouncementItem[] {
  return parseHtmlDocument(input, sourceUrl, "generic");
}

export function containsAnnouncementHint(title: string, link: string): boolean {
  const haystack = `${title} ${link}`.toLocaleLowerCase("tr-TR");
  return ["duyuru", "duyurular", "announcement", "announcements", "ilan", "haber", "news", "notice", "etkinlik", "etkinlikler", "event", "events", "exam", "sinav", "sınav"].some((hint) => haystack.includes(hint));
}

export function createAnnouncementId(sourceId: string, link: string, title: string): string {
  void title;
  return createHash("sha1").update(`${sourceId}|${canonicalContentKey(link) ?? link}`).digest("hex").slice(0, 20);
}

export function dedupeAnnouncements(items: AnnouncementItem[]): AnnouncementItem[] {
  const unique = new Map<string, AnnouncementItem>();
  for (const item of items) {
    const key = item.dedupeKey ?? createContentDedupeKey(item.canonicalUrl ?? item.link) ?? item.link.toLocaleLowerCase("en-US");
    if (!unique.has(key)) {
      unique.set(key, item);
      continue;
    }

    const existing = unique.get(key);
    if (!existing || preferAnnouncementItem(item, existing)) unique.set(key, item);
  }
  return [...unique.values()];
}

export function cleanText(input?: string): string {
  return normalizeDisplayText(input);
}

export function parseJsonAnnouncements(input: string, sourceUrl: string): ParsedAnnouncementItem[] {
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    return [];
  }

  const items: ParsedAnnouncementItem[] = [];
  collectJsonAnnouncementItems(data, sourceUrl, items, 0);
  return dedupeParsedItems(items);
}

type HtmlParserProfile = "yok" | "ankara" | "generic";

interface ParsedItemCandidate {
  rawTitle: string;
  link: string;
  publishedAt?: Date;
  sourceUpdatedAt?: Date;
  summary?: string;
}

function parseHtmlDocument(input: string, sourceUrl: string, profile: HtmlParserProfile): ParsedAnnouncementItem[] {
  const officialSourceUrl = canonicalizeContentUrl(sourceUrl);
  if (!officialSourceUrl || !isOfficialContentUrl(officialSourceUrl, officialSourceUrl)) return [];
  const document = stripChromeRegions(input, profile);
  const anchors = [...document.matchAll(/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/giu)];
  const results: ParsedAnnouncementItem[] = [];

  for (const anchor of anchors) {
    const attributes = `${anchor[1] ?? ""} ${anchor[3] ?? ""}`;
    if (isChromeAnchor(attributes)) continue;
    const href = normalizeDisplayText(anchor[2], 2_048);
    const rawTitle = anchor[4] ?? "";
    const normalizedTitle = normalizeDisplayText(rawTitle, 500);
    if (!href || !normalizedTitle || isLowValueAnchorTitle(normalizedTitle)) continue;

    const candidateUrl = canonicalizeContentUrl(href, officialSourceUrl);
    if (!candidateUrl) continue;
    if (!containsAnnouncementHint(normalizedTitle, candidateUrl) && !containsAnnouncementHint("", officialSourceUrl)) continue;

    const context = findContainingContentBlock(document, anchor.index ?? 0) ?? anchor[0];
    const timestamps = extractHtmlTimestamps(context, normalizedTitle, officialSourceUrl);
    const summary = extractHtmlSummary(context);
    const item = finalizeParsedItem({
      rawTitle,
      link: candidateUrl,
      ...(timestamps.publishedAt ? { publishedAt: timestamps.publishedAt } : {}),
      ...(timestamps.sourceUpdatedAt ? { sourceUpdatedAt: timestamps.sourceUpdatedAt } : {}),
      ...(summary ? { summary } : {})
    }, officialSourceUrl);
    if (item) results.push(item);
    if (results.length >= 80) break;
  }

  return dedupeParsedItems(results);
}

function finalizeParsedItem(input: ParsedItemCandidate, officialSourceUrl: string): ParsedAnnouncementItem | null {
  const normalizedTitle = normalizeDisplayText(input.rawTitle, 500);
  if (!normalizedTitle || isLowValueAnchorTitle(normalizedTitle) || isNavigationOrChromeTitle(normalizedTitle)) return null;
  const decision = evaluateContentTrust({
    rawTitle: input.rawTitle,
    url: input.link,
    officialSourceUrl
  });
  if (decision.status !== "trusted" || !decision.title || !decision.canonicalUrl) return null;
  const summary = normalizeDisplayText(input.summary, 1_200);
  const freshness = isFreshAcademicContent({
    title: decision.title,
    url: decision.canonicalUrl,
    ...(summary ? { text: summary } : {}),
    ...(input.publishedAt ? { publishedAt: input.publishedAt } : {})
  });
  if (!freshness.accepted) return null;

  return {
    title: decision.title,
    rawTitle: decision.rawTitle,
    link: decision.canonicalUrl,
    ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
    ...(input.sourceUpdatedAt ? { sourceUpdatedAt: input.sourceUpdatedAt } : {}),
    ...(summary ? { summary } : {})
  };
}

function stripChromeRegions(input: string, profile: HtmlParserProfile): string {
  let output = input
    .replace(/<!--([\s\S]*?)-->/gu, " ")
    .replace(/<(?:script|style|template|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|template|noscript)\s*>/giu, " ");
  const profileMarkers = profile === "yok"
    ? "quick-links|corporate-links|related-links|bagli-kurulus"
    : profile === "ankara"
      ? "main-navigation|site-footer|widget-area|related-links"
      : "related-links";
  const chromeMarkers = `nav(?:igation)?|navbar|menu|breadcrumb|sidebar|footer|pagination|pager|page-numbers|${profileMarkers}`;

  for (let pass = 0; pass < 4; pass += 1) {
    const previous = output;
    output = output
      .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ")
      .replace(new RegExp(`<(div|section|ul|ol|header)\\b(?=[^>]*(?:(?:class|id)=["'][^"']*(?:${chromeMarkers})[^"']*["']|role=["'](?:navigation|menu|menubar|contentinfo)["']))[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "giu"), " ");
    if (output === previous) break;
  }
  return output;
}

function isChromeAnchor(attributes: string): boolean {
  const normalized = normalizeDisplayText(attributes, 1_000).toLocaleLowerCase("tr-TR");
  return /\b(?:breadcrumb|footer|menu|nav(?:igation)?|next|page-numbers|pager|pagination|previous|sidebar)\b/u.test(normalized)
    || /\brel\s*=\s*["']?(?:next|prev)/iu.test(attributes)
    || /\brole\s*=\s*["']?(?:menuitem|navigation)/iu.test(attributes);
}

function findContainingContentBlock(input: string, anchorIndex: number): string | undefined {
  const before = input.slice(0, anchorIndex);
  const candidates: Array<{ start: number; end: number }> = [];
  for (const tag of ["article", "li"] as const) {
    const openings = [...before.matchAll(new RegExp(`<${tag}\\b`, "giu"))];
    const start = openings.at(-1)?.index;
    if (start === undefined) continue;
    const closingsBefore = [...before.matchAll(new RegExp(`<\\/${tag}\\s*>`, "giu"))];
    if ((closingsBefore.at(-1)?.index ?? -1) > start) continue;
    const after = input.slice(anchorIndex);
    const closing = after.match(new RegExp(`<\\/${tag}\\s*>`, "iu"));
    if (closing?.index === undefined) continue;
    candidates.push({ start, end: anchorIndex + closing.index + closing[0].length });
  }
  const selected = candidates.sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
  return selected ? input.slice(selected.start, selected.end) : undefined;
}

function extractHtmlTimestamps(context: string, title: string, sourceUrl: string): { publishedAt?: Date; sourceUpdatedAt?: Date } {
  let publishedAt = parseHtmlDateAttribute(context, ["data-published-at", "data-publish-date", "data-date"]);
  let sourceUpdatedAt = parseHtmlDateAttribute(context, ["data-updated-at", "data-modified-at", "data-update-date"]);

  for (const match of context.matchAll(/<time\b([^>]*)>([\s\S]*?)<\/time>/giu)) {
    const attributes = match[1] ?? "";
    const value = readHtmlAttribute(attributes, "datetime") ?? normalizeDisplayText(match[2], 200);
    const parsed = value ? parseDateMaybe(value) : undefined;
    if (!parsed) continue;
    const foldedTimeContext = foldAnchorTitle(`${attributes} ${normalizeDisplayText(match[2], 300)}`);
    if (/(?:updated|modified|guncel|degistiril)/u.test(foldedTimeContext)) sourceUpdatedAt ??= parsed;
    else publishedAt ??= parsed;
  }

  const visibleText = normalizeDisplayText(context, 5_000);
  sourceUpdatedAt ??= parseLabeledDate(visibleText, /(?:guncellenme|guncelleme|degistirilme|updated|modified)\s+tarihi?/u);
  publishedAt ??= parseLabeledDate(visibleText, /(?:yayin|yayim|publication)\s+tarihi?/u);
  if (!publishedAt && isKnownLeadingListingDateSource(sourceUrl)) {
    const leadingDate = title.match(/^\s*((?:\d{1,2}[./-]){2}20\d{2})(?:\s+|$)/u)?.[1];
    publishedAt = leadingDate ? parseDateMaybe(leadingDate) : undefined;
  }
  return {
    ...(publishedAt ? { publishedAt } : {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {})
  };
}

function isKnownLeadingListingDateSource(sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl);
    return (url.hostname === "selcuk.edu.tr" || url.hostname.endsWith(".selcuk.edu.tr"))
      && /^\/icerik\/ogrenciduyurulari(?:\/|$)/iu.test(url.pathname);
  } catch {
    return false;
  }
}

function parseHtmlDateAttribute(context: string, names: string[]): Date | undefined {
  for (const name of names) {
    const match = context.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "iu"));
    const value = match?.[1] ? normalizeDisplayText(match[1], 200) : "";
    const parsed = value ? parseDateMaybe(value) : undefined;
    if (parsed) return parsed;
  }
  return undefined;
}

function readHtmlAttribute(attributes: string, name: string): string | undefined {
  return attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "iu"))?.[1];
}

function parseLabeledDate(input: string, label: RegExp): Date | undefined {
  const folded = foldAnchorTitle(input);
  const match = folded.match(new RegExp(`${label.source}\\s*[: -]*((?:\\d{1,2}[./-]){2}20\\d{2}|\\d{1,2}\\s+[a-z]+\\s+20\\d{2}|20\\d{2}-\\d{2}-\\d{2}(?:t\\d{2}:\\d{2}(?::\\d{2})?(?:z|[+-]\\d{2}:?\\d{2})?)?)`, "u"));
  return match?.[1] ? parseDateMaybe(match[1]) : undefined;
}

function extractHtmlSummary(context: string): string | undefined {
  const match = context.match(/<p\b(?=[^>]*(?:class|itemprop)=["'][^"']*(?:summary|excerpt|description|ozet)[^"']*["'])[^>]*>([\s\S]*?)<\/p>/iu);
  const summary = match?.[1] ? normalizeDisplayText(match[1], 1_200) : "";
  return summary || undefined;
}

function isYokSourceUrl(input: string): boolean {
  const canonical = canonicalizeContentUrl(input);
  if (!canonical) return false;
  const hostname = new URL(canonical).hostname;
  return hostname === "yok.gov.tr" || hostname.endsWith(".yok.gov.tr");
}

function isAnkaraUniversitySourceUrl(input: string): boolean {
  const canonical = canonicalizeContentUrl(input);
  if (!canonical) return false;
  const hostname = new URL(canonical).hostname;
  return hostname === "ankara.edu.tr" || hostname.endsWith(".ankara.edu.tr");
}

const crawlerUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 AcademicCalendarAnnouncementCrawler/1.0";
const atuODataBaseUrl = "https://odata.atu.edu.tr/odata/DataService.svc";

interface AtuContentDescriptor {
  groupType: 1 | 2 | 4;
  routeName: "haber" | "duyuru" | "etkinlik";
  siteAlias: string;
  sourceUrl: URL;
}

interface AtuContentRow {
  GuID?: string;
  Baslik?: string;
  AltBaslik?: string;
  HTMLicerik?: string;
  MetinIcerik?: string;
  BaslamaTarihi?: string;
  EklenmeTarihi?: string;
}

async function fetchAtuContentItems(sourceUrl: string, timeoutMs: number): Promise<ParsedAnnouncementItem[] | null> {
  const descriptor = describeAtuContentSource(sourceUrl);
  if (!descriptor) return null;

  const siteUrl = buildAtuODataUrl("Siteler", {
    "$format": "json",
    "$filter": `AlanAdi eq '${descriptor.siteAlias}' and Durum eq 1`,
    "$top": "1"
  });
  const sitePayload = parseAtuODataPayload<{ ID?: number }>((await fetchText(siteUrl, timeoutMs, { accept: "application/json" })).text);
  const siteId = sitePayload[0]?.ID;
  if (!Number.isInteger(siteId)) throw new Error("ATU_CONTENT_SITE_NOT_FOUND");

  const contentUrl = buildAtuODataUrl("V_GuncelIcerik", {
    "$format": "json",
    "$filter": `SiteID eq ${siteId} and Durum eq 1 and GrupTipi eq ${descriptor.groupType} and DilKodu eq 'TR'`,
    "$orderby": "BaslamaTarihi desc",
    "$top": "40"
  });
  const rows = parseAtuODataPayload<AtuContentRow>((await fetchText(contentUrl, timeoutMs, { accept: "application/json" })).text);

  return dedupeParsedItems(rows.flatMap((row) => {
    const rawTitle = row.Baslik;
    if (!rawTitle) return [];

    const embeddedLink = firstHtmlLink(row.HTMLicerik ?? row.MetinIcerik, descriptor.sourceUrl.toString());
    const guid = cleanText(row.GuID);
    const generatedLink = guid
      ? `${descriptor.sourceUrl.origin}/#!/${descriptor.routeName}/${encodeURIComponent(guid)}`
      : undefined;
    const link = embeddedLink ?? generatedLink;
    if (!link) return [];

    const publishedAt = firstPlausibleAtuDate(row.BaslamaTarihi);
    const sourceUpdatedAt = firstPlausibleAtuDate(row.EklenmeTarihi);
    const item = finalizeParsedItem({
      rawTitle,
      link,
      ...(publishedAt ? { publishedAt } : {}),
      ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
      ...(row.AltBaslik && normalizeDisplayText(row.AltBaslik) !== "-" ? { summary: row.AltBaslik } : {})
    }, descriptor.sourceUrl.toString());
    return item ? [item] : [];
  }));
}

function describeAtuContentSource(sourceUrl: string): AtuContentDescriptor | null {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }

  if (url.hostname !== "atu.edu.tr" && !url.hostname.endsWith(".atu.edu.tr")) return null;
  const route = decodeURIComponent(url.hash).toLocaleLowerCase("tr-TR");
  const type = route.includes("/duyurular")
    ? { groupType: 2 as const, routeName: "duyuru" as const }
    : route.includes("/haberler")
      ? { groupType: 1 as const, routeName: "haber" as const }
      : route.includes("/etkinlikler")
        ? { groupType: 4 as const, routeName: "etkinlik" as const }
        : null;
  if (!type) return null;

  const firstLabel = url.hostname.split(".")[0]?.toLocaleLowerCase("en-US");
  const siteAlias = !firstLabel || firstLabel === "atu" ? "www" : firstLabel;
  return { ...type, siteAlias, sourceUrl: url };
}

function buildAtuODataUrl(entity: string, parameters: Record<string, string>): string {
  const url = new URL(`${atuODataBaseUrl}/${entity}`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url.toString();
}

function parseAtuODataPayload<T>(input: string): T[] {
  try {
    const payload = JSON.parse(input) as { d?: unknown };
    return Array.isArray(payload.d) ? payload.d as T[] : [];
  } catch {
    throw new Error("ATU_CONTENT_RESPONSE_INVALID");
  }
}

function firstHtmlLink(input: string | undefined, sourceUrl: string): string | undefined {
  if (!input) return undefined;
  const href = input.match(/<a\b[^>]*href=["']([^"']+)["']/iu)?.[1];
  return href ? canonicalizeContentUrl(href, sourceUrl) ?? undefined : undefined;
}

function firstPlausibleAtuDate(...values: Array<string | undefined>): Date | undefined {
  const maximum = Date.now() + 3 * 365 * 24 * 60 * 60 * 1000;
  for (const value of values) {
    if (!value) continue;
    const milliseconds = Number(value.match(/\/Date\((-?\d+)/u)?.[1]);
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > maximum) continue;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return undefined;
}

function looksLikeXmlFeed(input: string): boolean {
  const text = input.toLocaleLowerCase("en-US");
  return text.includes("<rss") || text.includes("<feed") || text.includes("<channel");
}

function looksLikeJson(input: string): boolean {
  const text = input.trimStart();
  return text.startsWith("{") || text.startsWith("[");
}

export function parseSyndicatedAnnouncements(input: string, sourceUrl: string): ParsedAnnouncementItem[] {
  const rssItems = [...input.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map((match) => parseRssItem(match[0], sourceUrl))
    .filter((item): item is ParsedAnnouncementItem => Boolean(item));

  const atomItems = [...input.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)]
    .map((match) => parseAtomEntry(match[0], sourceUrl))
    .filter((item): item is ParsedAnnouncementItem => Boolean(item));

  return dedupeParsedItems([...rssItems, ...atomItems]);
}

function parseRssItem(input: string, sourceUrl: string): ParsedAnnouncementItem | null {
  const rawTitle = extractTagValue(input, "title");
  const link = extractTagValue(input, "link");
  if (!rawTitle || !link) return null;

  const published = extractTagValue(input, "pubDate") ?? extractTagValue(input, "published") ?? extractTagValue(input, "dc:date");
  const updated = extractTagValue(input, "updated") ?? extractTagValue(input, "modified");
  const summary = extractTagValue(input, "description");
  const publishedAt = published ? parseDateMaybe(normalizeDisplayText(published)) : undefined;
  const sourceUpdatedAt = updated ? parseDateMaybe(normalizeDisplayText(updated)) : undefined;

  return finalizeParsedItem({
    rawTitle,
    link,
    ...(publishedAt ? { publishedAt } : {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    ...(summary ? { summary } : {})
  }, sourceUrl);
}

function parseAtomEntry(input: string, sourceUrl: string): ParsedAnnouncementItem | null {
  const rawTitle = extractTagValue(input, "title");
  const linkFromHref = input.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  const link = linkFromHref ?? extractTagValue(input, "link");
  if (!rawTitle || !link) return null;

  const published = extractTagValue(input, "published");
  const updated = extractTagValue(input, "updated");
  const summary = extractTagValue(input, "summary") ?? extractTagValue(input, "content");
  const publishedAt = published ? parseDateMaybe(normalizeDisplayText(published)) : undefined;
  const sourceUpdatedAt = updated ? parseDateMaybe(normalizeDisplayText(updated)) : undefined;

  return finalizeParsedItem({
    rawTitle,
    link,
    ...(publishedAt ? { publishedAt } : {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    ...(summary ? { summary } : {})
  }, sourceUrl);
}

function extractTagValue(input: string, tagName: string): string | undefined {
  const match = input.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  if (!match?.[1]) return undefined;
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function parseDateMaybe(input: string): Date | undefined {
  const leadingNumericDate = input.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/u);
  if (leadingNumericDate?.[1] && leadingNumericDate[2] && leadingNumericDate[3]) {
    return createUtcCalendarDate(Number(leadingNumericDate[3]), Number(leadingNumericDate[2]), Number(leadingNumericDate[1]));
  }
  if (/^\d{4}-\d{2}-\d{2}/u.test(input.trim())) {
    const iso = toIsoString(input.trim());
    return iso ? new Date(iso) : undefined;
  }
  const timestamp = Date.parse(input);
  if (!Number.isNaN(timestamp)) return new Date(timestamp);
  return parseTurkishDate(input);
}

function parseTurkishDate(input: string): Date | undefined {
  const normalized = foldAnchorTitle(input);
  const match = normalized.match(/\b(\d{1,2})\s+(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\s+(20\d{2})\b/u);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const month = turkishMonths[match[2]];
  if (!month) return undefined;
  return createUtcCalendarDate(Number(match[3]), month, Number(match[1]));
}

function createUtcCalendarDate(year: number, month: number, day: number): Date | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : undefined;
}

function isLowValueAnchorTitle(title: string): boolean {
  if (isNavigationOrChromeTitle(title)) return true;
  const normalized = foldAnchorTitle(title);
  if (/^page \d+$/u.test(normalized)) return true;
  if (normalized.endsWith(" icin tiklayiniz")) return true;
  if (normalized.startsWith("devamini oku")) return true;
  if (normalized.startsWith("daha fazla")) return true;
  if (normalized.startsWith("show more")) return true;
  if (normalized.startsWith("read more")) return true;
  if (normalized.startsWith("detayli bilgi")) return true;
  if (normalized.startsWith("bilgi icin")) return true;
  if (normalized.includes("whatsapp")) return true;
  if (normalized.includes("erisilebilirlik modunu ac")) return true;
  if (normalized.includes("su anda secili")) return true;
  return [
    "ana icerige gec",
    "icerige atla",
    "icerige gec",
    "skip to content",
    "ana içeriğe atla",
    "ana sayfa",
    "anasayfa",
    "akademik takvim",
    "akreditasyon",
    "announcements",
    "basın",
    "basin",
    "bilgi edinme",
    "bize ulaşın",
    "bize ulasin",
    "çerez politikası",
    "devamı",
    "devami",
    "details",
    "detay",
    "duyuru",
    "duyurular",
    "duyuru arşivi",
    "duyuru arsivi",
    "bağlı kuruluşlar",
    "bagli kuruluslar",
    "geçmiş duyurular",
    "gecmis duyurular",
    "english",
    "e posta",
    "eposta",
    "facebook",
    "haber",
    "haberler",
    "hakkımızda",
    "hakkimizda",
    "hastanelerimiz",
    "home",
    "ihale duyuruları",
    "ihale duyurulari",
    "instagram",
    "kurumsal",
    "kutuphane",
    "kütüphane",
    "linkedin",
    "linki kopyala",
    "misyon ve vizyon",
    "more",
    "next",
    "news",
    "notices",
    "ogrenci bilgi sistemi",
    "paylas",
    "previous",
    "tümü",
    "tum",
    "tum duyurular",
    "tüm duyurular",
    "tüm haberler",
    "tum haberler",
    "türkçe",
    "twitter",
    "üniversitemiz",
    "universitemiz",
    "yüksekokul",
    "yuksekokul",
    "youtube",
    "x",
    "tr",
    "en"
  ].map(foldAnchorTitle).includes(normalized) || extraLowValueAnchorTitles.has(normalized);
}

const extraLowValueAnchorTitles = new Set([
  "duyuru detay",
  "haber detay",
  "onceki",
  "sonraki",
  "sik kullanilanlar",
  "saglik programlari",
  "yonetim"
]);

function foldAnchorTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "I")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeParsedItems(items: ParsedAnnouncementItem[]): ParsedAnnouncementItem[] {
  const unique = new Map<string, ParsedAnnouncementItem>();
  for (const item of items) {
    const key = createContentDedupeKey(item.link) ?? item.link.toLocaleLowerCase("en-US");
    const existing = unique.get(key);
    if (!existing || preferParsedItem(item, existing)) unique.set(key, item);
  }
  return [...unique.values()];
}

function collectJsonAnnouncementItems(value: unknown, sourceUrl: string, output: ParsedAnnouncementItem[], depth: number): void {
  if (depth > 8 || output.length >= 120) return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonAnnouncementItems(item, sourceUrl, output, depth + 1);
    return;
  }

  if (!isJsonRecord(value)) return;
  const rawTitle = readJsonRawText(value, ["title", "baslik", "başlık", "name", "subject", "headline"]);
  const link = readJsonRawText(value, ["link", "url", "href", "permalink", "slug"]);
  const summary = readJsonRawText(value, ["summary", "description", "excerpt", "ozet", "özet", "icerik", "içerik"]);
  const published = readJsonRawText(value, ["publishedAt", "publishDate", "pubDate", "date", "createdAt", "baslamaTarihi", "BaşlamaTarihi"]);
  const updated = readJsonRawText(value, ["sourceUpdatedAt", "updatedAt", "modifiedAt", "updateDate", "lastModified", "guncellenmeTarihi", "GüncellenmeTarihi"]);
  const absoluteLink = link ? canonicalizeContentUrl(link, sourceUrl) : null;

  if (rawTitle && absoluteLink && (containsAnnouncementHint(normalizeDisplayText(rawTitle), absoluteLink) || containsAnnouncementHint("", sourceUrl))) {
    const publishedAt = published ? parseDateMaybe(normalizeDisplayText(published)) : undefined;
    const sourceUpdatedAt = updated ? parseDateMaybe(normalizeDisplayText(updated)) : undefined;
    const item = finalizeParsedItem({
      rawTitle,
      link: absoluteLink,
      ...(publishedAt ? { publishedAt } : {}),
      ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
      ...(summary ? { summary } : {})
    }, sourceUrl);
    if (item) output.push(item);
  }

  for (const nested of Object.values(value)) collectJsonAnnouncementItems(nested, sourceUrl, output, depth + 1);
}

const turkishMonths: Record<string, number> = {
  ocak: 1,
  subat: 2,
  mart: 3,
  nisan: 4,
  mayis: 5,
  haziran: 6,
  temmuz: 7,
  agustos: 8,
  eylul: 9,
  ekim: 10,
  kasim: 11,
  aralik: 12
};

function readJsonRawText(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const [key, value] of Object.entries(record)) {
    if (!keys.some((candidate) => candidate.toLocaleLowerCase("tr-TR") === key.toLocaleLowerCase("tr-TR"))) continue;
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (isJsonRecord(value)) {
      const rendered = value.rendered;
      if (typeof rendered === "string") return rendered;
    }
  }
  return undefined;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireOfficialSourceUrl(sourceUrl: string): string {
  const canonical = canonicalizeContentUrl(sourceUrl);
  if (!canonical) throw new Error("SOURCE_URL_UNSAFE");
  if (!isOfficialContentUrl(canonical, canonical)) throw new Error("SOURCE_URL_UNOFFICIAL");
  return preserveFetchTrailingSlash(canonical, sourceUrl);
}

function requireOfficialRedirectUrl(candidate: string, officialSourceUrl: string, baseUrl = officialSourceUrl): string {
  const canonical = canonicalizeContentUrl(candidate, baseUrl);
  if (!canonical) throw new Error("SOURCE_REDIRECT_UNSAFE");
  if (!isOfficialContentUrl(canonical, officialSourceUrl)) throw new Error("SOURCE_REDIRECT_UNOFFICIAL");
  return preserveFetchTrailingSlash(canonical, candidate, baseUrl);
}

function preserveFetchTrailingSlash(canonicalUrl: string, candidate: string, baseUrl?: string): string {
  try {
    const requested = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
    if (requested.pathname.length <= 1 || !requested.pathname.endsWith("/")) return canonicalUrl;
    const fetchUrl = new URL(canonicalUrl);
    if (!fetchUrl.pathname.endsWith("/")) fetchUrl.pathname += "/";
    return fetchUrl.toString();
  } catch {
    return canonicalUrl;
  }
}

async function fetchTextWithFetch(
  sourceUrl: string,
  timeoutMs: number,
  input: { accept?: string },
  signal: AbortSignal
): Promise<{ text: string; finalUrl: string; status: number }> {
  let currentUrl = sourceUrl;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      method: "GET",
      headers: {
        Accept: input.accept ?? "text/html,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.7,en;q=0.6",
        "User-Agent": crawlerUserAgent
      },
      redirect: "manual",
      signal
    });
    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) {
      if (redirectCount >= 5) throw new Error("SOURCE_REDIRECT_LIMIT");
      currentUrl = requireOfficialRedirectUrl(location, sourceUrl, currentUrl);
      await response.body?.cancel().catch(() => undefined);
      continue;
    }
    if (response.status >= 300 && response.status < 400) throw new Error("SOURCE_REDIRECT_LOCATION_MISSING");
    if (!response.ok) throw new Error(`SOURCE_FETCH_FAILED:${response.status}`);
    const finalUrl = requireOfficialRedirectUrl(response.url || currentUrl, sourceUrl);
    return { text: await response.text(), finalUrl, status: response.status };
  }
  throw new Error("SOURCE_REDIRECT_LIMIT");
}

function preferParsedItem(candidate: ParsedAnnouncementItem, current: ParsedAnnouncementItem): boolean {
  const candidateTime = parsedItemTimestamp(candidate);
  const currentTime = parsedItemTimestamp(current);
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  if (candidate.link.startsWith("https://") !== current.link.startsWith("https://")) return candidate.link.startsWith("https://");
  return parsedItemRichness(candidate) > parsedItemRichness(current);
}

function parsedItemTimestamp(item: ParsedAnnouncementItem): number {
  return Math.max(item.publishedAt?.getTime() ?? 0, item.sourceUpdatedAt?.getTime() ?? 0);
}

function parsedItemRichness(item: ParsedAnnouncementItem): number {
  return item.title.length + (item.summary?.length ?? 0) + (item.publishedAt ? 30 : 0) + (item.sourceUpdatedAt ? 20 : 0);
}

function preferAnnouncementItem(candidate: AnnouncementItem, current: AnnouncementItem): boolean {
  const recency = compareAcademicContentDuplicateRecency(candidate, current);
  if (recency !== 0) return recency > 0;
  if (candidate.link.startsWith("https://") !== current.link.startsWith("https://")) return candidate.link.startsWith("https://");
  return candidate.title.length + (candidate.summary?.length ?? 0) > current.title.length + (current.summary?.length ?? 0);
}

function shouldRetryWithInvalidTls(sourceUrl: string, error: unknown): boolean {
  if (process.env.ANNOUNCEMENT_ALLOW_INVALID_TLS !== "true") return false;
  if (!sourceUrl.startsWith("https://")) return false;
  const message = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
  const host = new URL(sourceUrl).hostname;
  if (host.endsWith(".edu.tr") && ["fetch failed", "UND_ERR_SOCKET", "ECONNRESET", "unable to verify"].some((hint) => message.includes(hint))) return true;
  return ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "CERT_HAS_EXPIRED", "unable to verify"].some((hint) => message.includes(hint));
}

function ensureCrawlerSystemCa(): void {
  if (process.env.CRAWLER_USE_SYSTEM_CA === "false") return;
  try {
    const systemCertificates = tls.getCACertificates("system");
    if (systemCertificates.length === 0) return;
    tls.setDefaultCACertificates([...new Set([...tls.rootCertificates, ...systemCertificates])]);
  } catch {
    // Older Node builds may not expose the system CA store; the normal bundled CA set still applies.
  }
}

function fetchTextWithNodeClient(sourceUrl: string, officialSourceUrl: string, timeoutMs: number, input: { accept?: string }, redirectCount: number, allowInvalidTls: boolean): Promise<{ text: string; finalUrl: string; status: number }> {
  if (redirectCount > 5) return Promise.reject(new Error("SOURCE_FETCH_REDIRECT_LIMIT"));
  const url = new URL(requireOfficialRedirectUrl(sourceUrl, officialSourceUrl));
  const client = url.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method: "GET",
      timeout: timeoutMs,
      rejectUnauthorized: url.protocol === "https:" ? !allowInvalidTls : undefined,
      headers: {
        Accept: input.accept ?? "text/html,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.7,en;q=0.6",
        "User-Agent": crawlerUserAgent
      }
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (location && status >= 300 && status < 400) {
        response.resume();
        let nextUrl: string;
        try {
          nextUrl = requireOfficialRedirectUrl(location, officialSourceUrl, sourceUrl);
        } catch (error) {
          reject(error);
          return;
        }
        void fetchTextWithNodeClient(nextUrl, officialSourceUrl, timeoutMs, input, redirectCount + 1, allowInvalidTls).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`SOURCE_FETCH_FAILED:${status}`));
        return;
      }

      response.setEncoding("utf8");
      let text = "";
      response.on("data", (chunk: string) => {
        text += chunk;
      });
      response.on("end", () => resolve({ text, finalUrl: sourceUrl, status }));
    });

    request.on("timeout", () => {
      request.destroy(new Error("SOURCE_FETCH_TIMEOUT"));
    });
    request.on("error", reject);
    request.end();
  });
}
