import { createHash } from "node:crypto";
import tls from "node:tls";
import { safeOutboundRequest } from "../../common/network/safe-outbound-request.js";
import { isFreshAcademicContent } from "../../domain/temporal-freshness.js";
import {
  academicContentLogicalIdentityKey,
  canonicalContentKey,
  canonicalizeContentUrl,
  compareAcademicContentDuplicateRecency,
  createContentDedupeKey,
  createNormalizedContentFingerprint,
  evaluateContentTrust,
  extractAcademicContentKeyDates,
  isNavigationOrChromeTitle,
  isOfficialContentUrl,
  normalizeDisplayText,
  sanitizeAcademicContentBody,
  toIsoString
} from "./announcement-content-trust.js";
import type { AnnouncementItem, AnnouncementSourceParser, AnnouncementSourceRecord } from "./announcements.types.js";

ensureCrawlerSystemCa();

export interface ParsedAnnouncementItem {
  title: string;
  rawTitle?: string;
  link: string;
  publishedAt?: Date;
  publicationKind?: "date" | "timestamp";
  publishedDate?: string;
  sourceUpdatedAt?: Date;
  summary?: string;
  body?: NonNullable<AnnouncementItem["body"]>;
  keyDates?: NonNullable<AnnouncementItem["keyDates"]>;
}

export async function fetchSourceItems(sourceUrl: string, parser: AnnouncementSourceParser, timeoutMs = 7000): Promise<ParsedAnnouncementItem[]> {
  const officialSourceUrl = requireOfficialSourceUrl(sourceUrl);
  const atuItems = await fetchAtuContentItems(officialSourceUrl, timeoutMs);
  if (atuItems) return atuItems.slice(0, 30);

  const body = await fetchText(officialSourceUrl, timeoutMs, { accept: "text/html,application/json,application/rss+xml,application/xml;q=0.9,*/*;q=0.8" });
  return parseFetchedSourceItems(body.text, body.finalUrl, parser).slice(0, 30);
}

export function parseFetchedSourceItems(
  input: string,
  sourceUrl: string,
  parser: AnnouncementSourceParser
): ParsedAnnouncementItem[] {
  if (parser === "auto" && looksLikeJson(input)) {
    const items = parseJsonAnnouncements(input, sourceUrl);
    if (items.length > 0 || isExplicitEmptyJsonSnapshot(input)) return items;
    throw new Error("SOURCE_JSON_LAYOUT_INVALID");
  }
  const resolvedParser = parser === "auto" ? (looksLikeXmlFeed(input) ? "rss" : "html") : parser;
  if (resolvedParser === "rss") {
    if (!hasValidSyndicatedEnvelope(input)) throw new Error("SOURCE_FEED_LAYOUT_INVALID");
    const items = parseSyndicatedAnnouncements(input, sourceUrl);
    if (items.length > 0 || !/<(?:item|entry)\b/iu.test(input)) return items;
    throw new Error("SOURCE_FEED_ITEMS_INVALID");
  }
  if (isYokSourceUrl(sourceUrl)) return parseYokAnnouncementHtml(input, sourceUrl);
  if (isAnkaraUniversitySourceUrl(sourceUrl)) return parseAnkaraUniversityAnnouncementHtml(input, sourceUrl);
  const items = parseGenericAnnouncementHtml(input, sourceUrl);
  if (items.length > 0 || isExplicitEmptyHtmlSnapshot(input)) return items;
  throw new Error("SOURCE_HTML_LAYOUT_INVALID");
}

export async function fetchText(sourceUrl: string, timeoutMs = 7000, input: { accept?: string } = {}): Promise<{ text: string; finalUrl: string; status: number }> {
  const officialSourceUrl = requireOfficialSourceUrl(sourceUrl);
  return fetchTextWithSafeRequest(officialSourceUrl, timeoutMs, input);
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
    const body = item.body ?? [];
    const keyDates = item.keyDates ?? [];
    const freshness = isFreshAcademicContent({
      title: trust.title,
      url: trust.canonicalUrl,
      ...(summary ? { text: summary } : {}),
      ...(publicationFreshnessDate(item) ? { publishedAt: publicationFreshnessDate(item) } : {})
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
      canonicalUrlAliases: [trust.canonicalUrl],
      officialSourceUrl,
      ...(item.publicationKind === "date" && item.publishedDate
        ? { publicationKind: "date" as const, publishedDate: item.publishedDate, publicationTimeSource: "source" as const }
        : item.publishedAt
          ? { publicationKind: "timestamp" as const, publishedAt: item.publishedAt.toISOString(), publicationTimeSource: "source" as const }
          : {}),
      ...(item.sourceUpdatedAt ? { sourceUpdatedAt: item.sourceUpdatedAt.toISOString(), sourceUpdateTimeSource: "source" as const } : {}),
      discoveredAt: fetchedAtIso,
      ...(summary ? { summary } : {}),
      ...(body.length ? { body } : {}),
      ...(keyDates.length ? { keyDates } : {}),
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
  assertSourceAdapterLayout(input, "yok");
  return parseHtmlDocument(input, sourceUrl, "yok");
}

export function parseAnkaraUniversityAnnouncementHtml(input: string, sourceUrl = "https://oidb.ankara.edu.tr/gecmis-duyurular/"): ParsedAnnouncementItem[] {
  assertSourceAdapterLayout(input, "ankara");
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
    const contentFingerprint = createNormalizedContentFingerprint(item);
    const normalized = {
      ...item,
      contentFingerprint,
      canonicalUrlAliases: [...new Set([item.canonicalUrl ?? item.link, ...(item.canonicalUrlAliases ?? [])])]
        .sort((left, right) => left.localeCompare(right, "en-US"))
    };
    const key = academicContentLogicalIdentityKey(normalized);
    if (!key) continue;
    if (!unique.has(key)) {
      unique.set(key, normalized);
      continue;
    }

    const existing = unique.get(key);
    if (!existing) continue;
    const preferred = preferAnnouncementItem(normalized, existing) ? normalized : existing;
    unique.set(key, {
      ...preferred,
      canonicalUrlAliases: [...new Set([
        ...(existing.canonicalUrlAliases ?? []),
        ...(normalized.canonicalUrlAliases ?? [])
      ])].sort((left, right) => left.localeCompare(right, "en-US"))
    });
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
type SourceSpecificHtmlParserProfile = Exclude<HtmlParserProfile, "generic">;

interface ParsedItemCandidate {
  rawTitle: string;
  link: string;
  publishedAt?: Date;
  publicationKind?: "date" | "timestamp";
  publishedDate?: string;
  sourceUpdatedAt?: Date;
  summary?: string;
  richBody?: string;
}

type ParsedPublication =
  | { publicationKind: "date"; publishedDate: string }
  | { publicationKind: "timestamp"; publishedAt: Date };

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
      ...timestamps.publication,
      ...(timestamps.sourceUpdatedAt ? { sourceUpdatedAt: timestamps.sourceUpdatedAt } : {}),
      ...(summary ? { summary } : {})
    }, officialSourceUrl);
    if (item) results.push(item);
    if (results.length >= 80) break;
  }

  return dedupeParsedItems(results);
}

export function assertSourceAdapterLayout(
  input: string,
  profile: SourceSpecificHtmlParserProfile
): void {
  const elements = readOpeningElements(input);
  if (profile === "yok") {
    const hasListingRoot = elements.some((element) => element.tag === "main");
    const announcementRows = readArticleBlocks(input)
      .filter((row) => row.classes.has("announcement-card"));
    // The adapter intentionally requires a listing root and repeated row
    // structure. A single plausible anchor/card must not bless an otherwise
    // changed page layout and publish navigation or stale fragments.
    if (
      !hasListingRoot
      || announcementRows.length < 2
      || announcementRows.some((row) => !/<a\b[^>]*href=["'][^"']+["']/iu.test(row.body))
    ) {
      throw new Error("SOURCE_LAYOUT_INVALID:YOK");
    }
    return;
  }

  const hasContentRoot = elements.some((element) => element.id === "content");
  const announcementRows = readArticleBlocks(input).filter((row) => (
    row.classes.has("post") && row.classes.has("announcement")
  ));
  const hasMalformedRow = announcementRows.some((row) => (
    !/<[a-z][\w-]*\b[^>]*class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["'][^"']+["']/iu.test(row.body)
  ));
  if (!hasContentRoot || announcementRows.length < 2 || hasMalformedRow) {
    throw new Error("SOURCE_LAYOUT_INVALID:ANKARA");
  }
}

function readArticleBlocks(input: string): Array<{ classes: Set<string>; body: string }> {
  return [...input.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article\s*>/giu)].map((match) => ({
    classes: readClassNames(match[1] ?? ""),
    body: match[2] ?? ""
  }));
}

function readOpeningElements(input: string): Array<{
  tag: string;
  id?: string;
  classes: Set<string>;
}> {
  return [...input.matchAll(/<([a-z][\w-]*)\b([^>]*)>/giu)].map((match) => {
    const attributes = match[2] ?? "";
    const id = readHtmlAttribute(attributes, "id");
    return {
      tag: (match[1] ?? "").toLocaleLowerCase("en-US"),
      ...(id ? { id: id.toLocaleLowerCase("en-US") } : {}),
      classes: readClassNames(attributes)
    };
  });
}

function readClassNames(attributes: string): Set<string> {
  return new Set((readHtmlAttribute(attributes, "class") ?? "")
    .split(/\s+/u)
    .map((value) => value.toLocaleLowerCase("en-US"))
    .filter(Boolean));
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
  const body = sanitizeAcademicContentBody(input.richBody ?? input.summary);
  const keyDates = extractAcademicContentKeyDates(body);
  const freshness = isFreshAcademicContent({
    title: decision.title,
    url: decision.canonicalUrl,
    ...(summary ? { text: summary } : {}),
    ...(publicationFreshnessDate(input) ? { publishedAt: publicationFreshnessDate(input) } : {})
  });
  if (!freshness.accepted) return null;

  return {
    title: decision.title,
    rawTitle: decision.rawTitle,
    link: decision.canonicalUrl,
    ...(input.publicationKind === "date" && input.publishedDate
      ? { publicationKind: "date", publishedDate: input.publishedDate }
      : input.publishedAt
        ? { publicationKind: "timestamp", publishedAt: input.publishedAt }
        : {}),
    ...(input.sourceUpdatedAt ? { sourceUpdatedAt: input.sourceUpdatedAt } : {}),
    ...(summary ? { summary } : {}),
    ...(body.length ? { body } : {}),
    ...(keyDates.length ? { keyDates } : {})
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

function extractHtmlTimestamps(context: string, title: string, sourceUrl: string): { publication: ParsedPublication | Record<string, never>; sourceUpdatedAt?: Date } {
  let publication = parseHtmlPublicationAttribute(context, ["data-published-at", "data-publish-date", "data-date"]);
  let sourceUpdatedAt = parseHtmlDateAttribute(context, ["data-updated-at", "data-modified-at", "data-update-date"]);

  for (const match of context.matchAll(/<time\b([^>]*)>([\s\S]*?)<\/time>/giu)) {
    const attributes = match[1] ?? "";
    const value = readHtmlAttribute(attributes, "datetime") ?? normalizeDisplayText(match[2], 200);
    const foldedTimeContext = foldAnchorTitle(`${attributes} ${normalizeDisplayText(match[2], 300)}`);
    if (/(?:updated|modified|guncel|degistiril)/u.test(foldedTimeContext)) {
      sourceUpdatedAt ??= value ? parseDateMaybe(value) : undefined;
    } else {
      publication ??= value ? parsePublicationMaybe(value) : undefined;
    }
  }

  const visibleText = normalizeDisplayText(context, 5_000);
  sourceUpdatedAt ??= parseLabeledDate(visibleText, /(?:guncellenme|guncelleme|degistirilme|updated|modified)\s+tarihi?/u);
  publication ??= parseLabeledPublication(visibleText, /(?:yayin|yayim|publication)\s+tarihi?/u);
  if (!publication && isKnownLeadingListingDateSource(sourceUrl)) {
    const leadingDate = title.match(/^\s*((?:\d{1,2}[./-]){2}20\d{2})(?:\s+|$)/u)?.[1];
    publication = leadingDate ? parsePublicationMaybe(leadingDate) : undefined;
  }
  return {
    publication: publication ?? {},
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

function parseHtmlPublicationAttribute(context: string, names: string[]): ParsedPublication | undefined {
  for (const name of names) {
    const match = context.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "iu"));
    const value = match?.[1] ? normalizeDisplayText(match[1], 200) : "";
    const parsed = value ? parsePublicationMaybe(value) : undefined;
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

function parseLabeledPublication(input: string, label: RegExp): ParsedPublication | undefined {
  const folded = foldAnchorTitle(input);
  const match = folded.match(new RegExp(`${label.source}\\s*[: -]*((?:\\d{1,2}[./-]){2}20\\d{2}|\\d{1,2}\\s+[a-z]+\\s+20\\d{2}|20\\d{2}-\\d{2}-\\d{2}(?:t\\d{2}:\\d{2}(?::\\d{2})?(?:z|[+-]\\d{2}:?\\d{2})?)?)`, "u"));
  return match?.[1] ? parsePublicationMaybe(match[1]) : undefined;
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
      ...(row.HTMLicerik || row.MetinIcerik ? { richBody: row.HTMLicerik ?? row.MetinIcerik } : {}),
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

function isExplicitEmptyJsonSnapshot(input: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return false;
  }
  return hasExplicitEmptyJsonCollection(value, 0);
}

function hasExplicitEmptyJsonCollection(value: unknown, depth: number): boolean {
  if (depth > 4) return false;
  if (Array.isArray(value)) return value.length === 0;
  if (!isJsonRecord(value)) return false;
  const collectionKeys = new Set(["items", "data", "results", "value", "announcements", "duyurular", "entries"]);
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = foldAnchorTitle(key);
    if (collectionKeys.has(normalizedKey) && Array.isArray(nested) && nested.length === 0) return true;
    if (["d", "response", "payload"].includes(normalizedKey) && hasExplicitEmptyJsonCollection(nested, depth + 1)) return true;
  }
  return false;
}

function hasValidSyndicatedEnvelope(input: string): boolean {
  return /<rss\b[^>]*>[\s\S]*<channel\b[^>]*>[\s\S]*<\/channel\s*>[\s\S]*<\/rss\s*>/iu.test(input)
    || /<feed\b[^>]*>[\s\S]*<\/feed\s*>/iu.test(input);
}

function isExplicitEmptyHtmlSnapshot(input: string): boolean {
  const hasListingRoot = /<(?:main|section|div|ul|ol)\b[^>]*(?:class|id)=["'][^"']*(?:announcement|duyuru|notice|listing|archive|results)[^"']*["'][^>]*>/iu.test(input);
  if (!hasListingRoot) return false;
  const text = foldAnchorTitle(normalizeDisplayText(input, 20_000));
  return /(?:duyuru|kayit|sonuc) bulunamadi|listelenecek duyuru bulunmamaktadir|no (?:announcements|notices|results) (?:found|available)/u.test(text);
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
  const richBody = extractTagValue(input, "content:encoded") ?? summary;
  const publication = published ? parsePublicationMaybe(normalizeDisplayText(published)) : undefined;
  const sourceUpdatedAt = updated ? parseDateMaybe(normalizeDisplayText(updated)) : undefined;

  return finalizeParsedItem({
    rawTitle,
    link,
    ...(publication ?? {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    ...(richBody ? { richBody } : {}),
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
  const richBody = extractTagValue(input, "content") ?? summary;
  const publication = published ? parsePublicationMaybe(normalizeDisplayText(published)) : undefined;
  const sourceUpdatedAt = updated ? parseDateMaybe(normalizeDisplayText(updated)) : undefined;

  return finalizeParsedItem({
    rawTitle,
    link,
    ...(publication ?? {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    ...(richBody ? { richBody } : {}),
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

function parsePublicationMaybe(input: string): ParsedPublication | undefined {
  const trimmed = input.trim();
  const explicitTimestamp = parseExplicitSourceTimestamp(trimmed);
  if (explicitTimestamp) return { publicationKind: "timestamp", publishedAt: explicitTimestamp };

  const numericDate = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](20\d{2})(?:\b|\s)/u);
  if (numericDate?.[1] && numericDate[2] && numericDate[3]) {
    const publishedDate = createCalendarDateString(Number(numericDate[3]), Number(numericDate[2]), Number(numericDate[1]));
    return publishedDate ? { publicationKind: "date", publishedDate } : undefined;
  }
  const isoDate = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:\b|\s)/u);
  if (isoDate?.[1] && isoDate[2] && isoDate[3]) {
    const publishedDate = createCalendarDateString(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
    return publishedDate ? { publicationKind: "date", publishedDate } : undefined;
  }
  const turkishDate = parseTurkishDateParts(trimmed, false);
  if (turkishDate) {
    const publishedDate = createCalendarDateString(turkishDate.year, turkishDate.month, turkishDate.day);
    return publishedDate ? { publicationKind: "date", publishedDate } : undefined;
  }
  return undefined;
}

function parseExplicitSourceTimestamp(input: string): Date | undefined {
  const hasClock = /(?:t|\s)\d{1,2}:\d{2}(?::\d{2})?/iu.test(input);
  const hasZone = /(?:z|gmt|utc|[+-]\d{2}:?\d{2})\b/iu.test(input);
  if (!hasClock || !hasZone) return undefined;
  const timestamp = Date.parse(input);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
}

function parseTurkishDate(input: string): Date | undefined {
  const parts = parseTurkishDateParts(input, false);
  return parts ? createUtcCalendarDate(parts.year, parts.month, parts.day) : undefined;
}

function parseTurkishDateParts(input: string, exact: boolean): { year: number; month: number; day: number } | undefined {
  const normalized = foldAnchorTitle(input);
  const expression = exact
    ? /^(\d{1,2})\s+(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\s+(20\d{2})$/u
    : /\b(\d{1,2})\s+(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\s+(20\d{2})\b/u;
  const match = normalized.match(expression);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const month = turkishMonths[match[2]];
  return month ? { year: Number(match[3]), month, day: Number(match[1]) } : undefined;
}

function createCalendarDateString(year: number, month: number, day: number): string | undefined {
  const date = createUtcCalendarDate(year, month, day);
  return date ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : undefined;
}

function publicationFreshnessDate(item: Pick<ParsedItemCandidate, "publicationKind" | "publishedDate" | "publishedAt">): Date | undefined {
  if (item.publicationKind === "date" && item.publishedDate) {
    const date = new Date(`${item.publishedDate}T12:00:00+03:00`);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return item.publishedAt;
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
  const summary = readJsonRawText(value, ["summary", "description", "excerpt", "ozet", "özet"]);
  const richBody = readJsonRawText(value, ["body", "content", "html", "icerik", "içerik", "HTMLicerik", "MetinIcerik"]);
  const published = readJsonRawText(value, ["publishedAt", "publishDate", "pubDate", "date", "createdAt", "baslamaTarihi", "BaşlamaTarihi"]);
  const updated = readJsonRawText(value, ["sourceUpdatedAt", "updatedAt", "modifiedAt", "updateDate", "lastModified", "guncellenmeTarihi", "GüncellenmeTarihi"]);
  const absoluteLink = link ? canonicalizeContentUrl(link, sourceUrl) : null;

  if (rawTitle && absoluteLink && (containsAnnouncementHint(normalizeDisplayText(rawTitle), absoluteLink) || containsAnnouncementHint("", sourceUrl))) {
    const publication = published ? parsePublicationMaybe(normalizeDisplayText(published)) : undefined;
    const sourceUpdatedAt = updated ? parseDateMaybe(normalizeDisplayText(updated)) : undefined;
    const summaryText = summary ?? richBody;
    const item = finalizeParsedItem({
      rawTitle,
      link: absoluteLink,
      ...(publication ?? {}),
      ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
      ...(richBody ? { richBody } : {}),
      ...(summaryText ? { summary: summaryText } : {})
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

async function fetchTextWithSafeRequest(
  sourceUrl: string,
  timeoutMs: number,
  input: { accept?: string }
): Promise<{ text: string; finalUrl: string; status: number }> {
  const response = await safeOutboundRequest(sourceUrl, {
    timeoutMs,
    maximumRedirects: 5,
    maximumResponseBytes: 5 * 1024 * 1024,
    headers: {
      Accept: input.accept ?? "text/html,*/*;q=0.8",
      "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.7,en;q=0.6",
      "User-Agent": crawlerUserAgent
    },
    validateUrl: (candidate, previousUrl) => (
      requireOfficialRedirectUrl(candidate, sourceUrl, previousUrl ?? sourceUrl)
    )
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`SOURCE_FETCH_FAILED:${response.status}`);
  }
  return {
    text: response.body.toString("utf8"),
    finalUrl: response.finalUrl,
    status: response.status
  };
}

function preferParsedItem(candidate: ParsedAnnouncementItem, current: ParsedAnnouncementItem): boolean {
  const candidateTime = parsedItemTimestamp(candidate);
  const currentTime = parsedItemTimestamp(current);
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  if (candidate.link.startsWith("https://") !== current.link.startsWith("https://")) return candidate.link.startsWith("https://");
  const candidateRichness = candidate.title.length
    + (candidate.summary?.length ?? 0)
    + (candidate.body?.reduce((total, block) => total + block.text.length, 0) ?? 0);
  const currentRichness = current.title.length
    + (current.summary?.length ?? 0)
    + (current.body?.reduce((total, block) => total + block.text.length, 0) ?? 0);
  return candidateRichness > currentRichness;
}

function parsedItemTimestamp(item: ParsedAnnouncementItem): number {
  const publishedDate = item.publishedDate ? new Date(`${item.publishedDate}T12:00:00+03:00`).getTime() : 0;
  return Math.max(item.publishedAt?.getTime() ?? 0, Number.isFinite(publishedDate) ? publishedDate : 0, item.sourceUpdatedAt?.getTime() ?? 0);
}

function parsedItemRichness(item: ParsedAnnouncementItem): number {
  return item.title.length
    + (item.summary?.length ?? 0)
    + (item.body?.reduce((total, block) => total + block.text.length, 0) ?? 0)
    + (item.keyDates?.length ?? 0) * 20
    + (item.publishedAt || item.publishedDate ? 30 : 0)
    + (item.sourceUpdatedAt ? 20 : 0);
}

function preferAnnouncementItem(candidate: AnnouncementItem, current: AnnouncementItem): boolean {
  const recency = compareAcademicContentDuplicateRecency(candidate, current);
  if (recency !== 0) return recency > 0;
  if (candidate.link.startsWith("https://") !== current.link.startsWith("https://")) return candidate.link.startsWith("https://");
  const candidateRichness = candidate.title.length
    + (candidate.summary?.length ?? 0)
    + (candidate.body?.reduce((total, block) => total + block.text.length, 0) ?? 0);
  const currentRichness = current.title.length
    + (current.summary?.length ?? 0)
    + (current.body?.reduce((total, block) => total + block.text.length, 0) ?? 0);
  return candidateRichness > currentRichness;
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
