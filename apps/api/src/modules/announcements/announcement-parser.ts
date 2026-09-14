import { createHash } from "node:crypto";
import tls from "node:tls";
import { load } from "cheerio";
import {
  DEVICE_SOURCE_ACCEPT_LANGUAGE,
  DEVICE_SOURCE_USER_AGENT,
  executeDeviceSourceRuntime,
  type DeviceSourceRuntimeResponse
} from "../../../../../packages/shared/src/device-source-runtime.js";
import { safeOutboundRequest } from "../../common/network/safe-outbound-request.js";
import {
  requireSourceAuthority,
  type SourceAuthorityContext
} from "../../domain/source-authority-enforcement.js";
import type { SourceAuthorityResource } from "../../domain/source-authority-policy.js";
import { classifyStudentRelevance } from "../../domain/student-relevance-classifier.js";
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
  officialDomainForUrl,
  sanitizeAcademicContentBody,
  toIsoString
} from "./announcement-content-trust.js";
import type {
  AnnouncementContentType,
  AnnouncementItem,
  AnnouncementSourceParserConfig,
  AnnouncementSourceParser,
  AnnouncementSourceRecord
} from "./announcements.types.js";

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

export interface SourceAuthorityFetchContext {
  authority: SourceAuthorityContext;
  resource: SourceAuthorityResource;
}

export interface FetchedSourceSnapshot {
  items: ParsedAnnouncementItem[];
  finalUrl: string;
  fetchStatus: "fetched" | "not_modified";
  etag?: string;
  lastModified?: string;
  contentHash?: string;
}

export interface FetchTextInput {
  accept?: string;
  acceptLanguage?: string;
  userAgent?: string;
  origin?: string;
  authority?: SourceAuthorityContext;
  resource?: SourceAuthorityResource;
  etag?: string;
  lastModified?: string;
  maximumRedirects?: number;
  maximumResponseBytes?: number;
}

export interface SourceSnapshotValidators {
  etag?: string;
  lastModified?: string;
  contentHash?: string;
}

export interface FetchedText {
  text: string;
  finalUrl: string;
  status: number;
  etag?: string;
  lastModified?: string;
  contentHash?: string;
  contentType?: string;
}

export const ANNOUNCEMENT_DETAIL_MAX_ITEMS = 6;
export const ANNOUNCEMENT_DETAIL_CONCURRENCY = 2;
export const ANNOUNCEMENT_DETAIL_MAX_RESPONSE_BYTES = 512 * 1024;
export const ANNOUNCEMENT_DETAIL_MAX_TIMEOUT_MS = 4_000;
const ANNOUNCEMENT_HTML_MAX_ANCHORS = 2_000;
const ANNOUNCEMENT_HTML_MAX_ANCESTORS = 32;
const ANNOUNCEMENT_HTML_ROW_EVIDENCE_RADIUS = 16 * 1024;
const CHROME_IDENTITY_TOKEN_SOURCE = "(?:(?:breadcrumb|footer|menu|nav|navbar|navigation|pagination|pager|sidebar)(?:[-_][a-z0-9][a-z0-9_-]*)?|page[-_]numbers|related[-_]links|(?:site|main|primary|mobile|global|top|bottom|brand|header|page)[-_](?:footer|menu|nav|navbar|navigation|sidebar)(?:[-_][a-z0-9][a-z0-9_-]*)?|(?:drop|fast|dropdown|mega|quick)[-_]menu(?:[-_][a-z0-9][a-z0-9_-]*)?)";
const CHROME_IDENTITY_TOKEN = new RegExp(`^${CHROME_IDENTITY_TOKEN_SOURCE}$`, "iu");

export async function fetchSourceItems(
  sourceUrl: string,
  parser: AnnouncementSourceParser,
  timeoutMs = 7000,
  authorityContext?: SourceAuthorityFetchContext,
  contentType?: AnnouncementContentType,
  parserConfig?: AnnouncementSourceParserConfig
): Promise<ParsedAnnouncementItem[]> {
  return (await fetchSourceSnapshot(sourceUrl, parser, timeoutMs, authorityContext, {}, contentType, parserConfig)).items;
}

export async function fetchSourceSnapshot(
  sourceUrl: string,
  parser: AnnouncementSourceParser,
  timeoutMs = 7000,
  authorityContext?: SourceAuthorityFetchContext,
  validators: SourceSnapshotValidators = {},
  contentType?: AnnouncementContentType,
  parserConfig?: AnnouncementSourceParserConfig
): Promise<FetchedSourceSnapshot> {
  const officialSourceUrl = requireOfficialSourceUrl(sourceUrl);
  const ankaraCmsSnapshot = await fetchAnkaraUniversityCmsItems(
    officialSourceUrl,
    timeoutMs,
    authorityContext,
    validators,
    contentType
  );
  if (ankaraCmsSnapshot) {
    return {
      ...ankaraCmsSnapshot,
      items: ankaraCmsSnapshot.items.slice(0, 30)
    };
  }
  const atuSnapshot = await fetchAtuContentItems(officialSourceUrl, timeoutMs, authorityContext, validators);
  if (atuSnapshot) {
    return {
      ...atuSnapshot,
      items: atuSnapshot.items.slice(0, 30)
    };
  }

  const body = await fetchText(officialSourceUrl, timeoutMs, {
    accept: "text/html,application/json,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
    ...(authorityContext ? authorityContext : {}),
    ...validators
  });
  if (body.status === 304) {
    return {
      items: [],
      finalUrl: body.finalUrl,
      fetchStatus: "not_modified",
      ...(body.etag ? { etag: body.etag } : {}),
      ...(body.lastModified ? { lastModified: body.lastModified } : {})
    };
  }
  if (body.contentHash && body.contentHash === validators.contentHash) {
    return {
      items: [],
      finalUrl: body.finalUrl,
      fetchStatus: "not_modified",
      ...(body.etag ? { etag: body.etag } : {}),
      ...(body.lastModified ? { lastModified: body.lastModified } : {}),
      contentHash: body.contentHash
    };
  }
  const parsedItems = parseFetchedSourceItems(body.text, body.finalUrl, parser, contentType, parserConfig).slice(0, 30);
  const items = authorityContext && !parserConfig?.itemSelector?.trim() && isGenericHtmlSnapshot(body.text, body.finalUrl, parser)
    ? await hydrateGenericAnnouncementDetails(parsedItems, body.finalUrl, timeoutMs, authorityContext)
    : parsedItems;
  return {
    items,
    finalUrl: body.finalUrl,
    fetchStatus: "fetched",
    ...(body.etag ? { etag: body.etag } : {}),
    ...(body.lastModified ? { lastModified: body.lastModified } : {}),
    ...(body.contentHash ? { contentHash: body.contentHash } : {})
  };
}

export function parseFetchedSourceItems(
  input: string,
  sourceUrl: string,
  parser: AnnouncementSourceParser,
  contentType?: AnnouncementContentType,
  parserConfig?: AnnouncementSourceParserConfig
): ParsedAnnouncementItem[] {
  const nkuEventJsonSource = describeNkuEventJsonSource(sourceUrl, contentType);
  if (nkuEventJsonSource) {
    if (parser !== "auto") throw new Error("SOURCE_LAYOUT_INVALID:NKU_EVENT");
    return parseNkuEventJson(input, nkuEventJsonSource);
  }
  const alanyaEventCalendarSource = describeAlanyaEventCalendarSource(sourceUrl, contentType);
  if (alanyaEventCalendarSource) {
    if (parser !== "auto" && parser !== "html") throw new Error("SOURCE_LAYOUT_INVALID:ALANYA_EVENT");
    return parseAlanyaEventCalendarHtml(input, alanyaEventCalendarSource);
  }
  const ankaraCmsDescriptor = describeAnkaraUniversityCmsSource(sourceUrl, contentType);
  if (ankaraCmsDescriptor) return parseAnkaraUniversityCmsPayload(input, ankaraCmsDescriptor);
  if (parser === "auto" && looksLikeJson(input)) {
    const items = parseJsonAnnouncements(input, sourceUrl, contentType);
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
  if (parserConfig?.itemSelector?.trim()) {
    const items = parseConfiguredAnnouncementHtml(input, sourceUrl, parserConfig);
    if (items.length > 0) return items;
    throw new Error("SOURCE_HTML_SELECTOR_LAYOUT_INVALID");
  }
  if (isKtunNewsListingSource(sourceUrl, contentType)) return parseKtunNewsListingHtml(input, sourceUrl);
  if (isYokSourceUrl(sourceUrl)) return parseYokAnnouncementHtml(input, sourceUrl);
  if (isAnkaraUniversitySourceUrl(sourceUrl)) return parseAnkaraUniversityAnnouncementHtml(input, sourceUrl);
  const items = parseGenericAnnouncementHtml(input, sourceUrl, contentType);
  if (items.length > 0 || isExplicitEmptyHtmlSnapshot(input)) return items;
  throw new Error("SOURCE_HTML_LAYOUT_INVALID");
}

export async function fetchText(
  sourceUrl: string,
  timeoutMs = 7000,
  input: FetchTextInput = {}
): Promise<FetchedText> {
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
    const studentMetadata = classifyStudentRelevance({
      title: trust.title,
      ...(summary ? { summary } : {}),
      ...(body.length ? { body: body.map((block) => block.text).join("\n") } : {}),
      ...(keyDates.length ? {
        keyDates: keyDates.map((keyDate) => ({
          label: keyDate.label,
          value: keyDate.endDate ?? keyDate.startDate
        }))
      } : {})
    });
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
      dedupeKey: trust.dedupeKey,
      ...studentMetadata
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

export function parseGenericAnnouncementHtml(
  input: string,
  sourceUrl: string,
  contentType?: AnnouncementContentType
): ParsedAnnouncementItem[] {
  return parseHtmlDocument(input, sourceUrl, "generic", contentType);
}

/**
 * Executes the exact parser/fetch plan shipped to devices. This deliberately
 * stays separate from the richer legacy ingestion adapters: a successful
 * mobile-source probe must mean that the same recipe works on a device.
 */
export async function fetchDeviceRuntimeSourceSnapshot(
  sourceUrl: string,
  parser: AnnouncementSourceParser,
  timeoutMs = 7000,
  authorityContext?: SourceAuthorityFetchContext,
  validators: SourceSnapshotValidators = {},
  contentType: AnnouncementContentType = "announcement",
  checkedAt = new Date(),
  parserConfig?: AnnouncementSourceParserConfig
): Promise<FetchedSourceSnapshot> {
  const officialSourceUrl = requireOfficialSourceUrl(sourceUrl);
  const allowedOfficialDomain = officialDomainForUrl(officialSourceUrl);
  if (!allowedOfficialDomain || new URL(officialSourceUrl).protocol !== "https:") {
    throw new Error("SOURCE_RUNTIME_RECIPE_INVALID");
  }
  const snapshot = await executeDeviceSourceRuntime({
    sourceUrl: officialSourceUrl,
    allowedOfficialDomain,
    contentType,
    parser,
    checkedAt: checkedAt.toISOString(),
    ...(parserConfig ? { parserConfig } : {})
  }, async (request): Promise<DeviceSourceRuntimeResponse> => {
    const response = await fetchText(request.url, timeoutMs, {
      accept: request.accept,
      acceptLanguage: DEVICE_SOURCE_ACCEPT_LANGUAGE,
      userAgent: DEVICE_SOURCE_USER_AGENT,
      ...(request.origin ? { origin: request.origin } : {}),
      ...(authorityContext ? authorityContext : {}),
      ...(request.validators?.etag ? { etag: request.validators.etag } : {}),
      ...(request.validators?.lastModified ? { lastModified: request.validators.lastModified } : {}),
      maximumRedirects: 5,
      maximumResponseBytes: 1_500_000
    });
    return {
      status: response.status,
      text: response.text,
      finalUrl: response.finalUrl,
      ...(response.contentType ? { contentType: response.contentType } : {}),
      ...(response.etag ? { etag: response.etag } : {}),
      ...(response.lastModified ? { lastModified: response.lastModified } : {})
    };
  }, validators);
  return {
    items: snapshot.items.map((item) => ({
      title: item.title,
      link: item.link,
      ...(item.publicationKind === "date" && item.publishedDate
        ? { publicationKind: "date" as const, publishedDate: item.publishedDate }
        : item.publishedAt ? { publicationKind: "timestamp" as const, publishedAt: new Date(item.publishedAt) } : {}),
      ...(item.sourceUpdatedAt ? { sourceUpdatedAt: new Date(item.sourceUpdatedAt) } : {}),
      ...(item.summary ? { summary: item.summary } : {}),
      ...(item.body?.length ? { body: item.body } : {}),
      ...(item.keyDates?.length ? { keyDates: item.keyDates } : {})
    })),
    finalUrl: snapshot.finalUrl,
    fetchStatus: snapshot.fetchStatus,
    ...(snapshot.etag ? { etag: snapshot.etag } : {}),
    ...(snapshot.lastModified ? { lastModified: snapshot.lastModified } : {})
  };
}

const alanyaEventCalendarOrigin = "https://www.alanyauniversity.edu.tr";
const nkuEventOrigin = "https://bhi.nku.edu.tr";

interface CalendarTimestamp {
  date: string;
  value: string;
}

function describeAlanyaEventCalendarSource(
  sourceUrl: string,
  contentType?: AnnouncementContentType
): string | null {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.hostname !== "www.alanyauniversity.edu.tr" || url.pathname !== "/tr/events.calendar") return null;
  if (url.protocol !== "https:" || url.search || url.hash || contentType !== "event") {
    throw new Error("SOURCE_LAYOUT_INVALID:ALANYA_EVENT");
  }
  return url.toString();
}

function parseAlanyaEventCalendarHtml(input: string, sourceUrl: string): ParsedAnnouncementItem[] {
  const $ = load(input);
  const calendarScripts = $("script").toArray()
    .map((element) => $(element).html() ?? "")
    .filter((script) => /\$\(\s*["']#calendar["']\s*\)\.fullCalendar\s*\(/u.test(script));
  const match = calendarScripts[0]?.match(/\bevents\s*:\s*(\[[\s\S]*\])\s*,\s*eventColor\s*:/u);
  if ($('[id="calendar"]').length !== 1 || calendarScripts.length !== 1 || !match?.[1]) {
    throw new Error("SOURCE_LAYOUT_INVALID:ALANYA_EVENT");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    throw new Error("SOURCE_LAYOUT_INVALID:ALANYA_EVENT");
  }
  if (!Array.isArray(payload) || payload.length > 2_000) throw new Error("SOURCE_LAYOUT_INVALID:ALANYA_EVENT");

  const rows = payload.map((value) => {
    if (!isJsonRecord(value) || Object.keys(value).sort().join(",") !== "end,id,start,title,url") {
      throw new Error("SOURCE_LAYOUT_INVALID:ALANYA_EVENT");
    }
    const id = value.id;
    const rawTitle = value.title;
    const start = readCalendarTimestamp(value.start);
    const end = readCalendarTimestamp(value.end);
    if (
      typeof id !== "string"
      || !/^\d{1,12}$/u.test(id)
      || typeof rawTitle !== "string"
      || !normalizeDisplayText(rawTitle, 500)
      || !start
      || !end
      || end.value < start.value
      || value.url !== `${alanyaEventCalendarOrigin}/tr/events.single/id/${id}`
    ) throw new Error("SOURCE_LAYOUT_INVALID:ALANYA_EVENT");
    return { id, rawTitle, start, end, url: value.url };
  }).sort((left, right) => right.start.value.localeCompare(left.start.value) || Number(right.id) - Number(left.id));

  return dedupeParsedItems(rows.map((row) => {
    const trust = evaluateContentTrust({
      rawTitle: row.rawTitle,
      url: row.url,
      officialSourceUrl: sourceUrl,
      contentType: "event"
    });
    if (trust.status !== "trusted" || !trust.title || !trust.canonicalUrl) {
      throw new Error("SOURCE_LAYOUT_INVALID:ALANYA_EVENT");
    }
    return {
      title: trust.title,
      rawTitle: trust.rawTitle,
      link: trust.canonicalUrl,
      keyDates: [{
        label: "Etkinlik tarihi",
        startDate: row.start.date,
        ...(row.end.date !== row.start.date ? { endDate: row.end.date } : {})
      }]
    };
  }));
}

function describeNkuEventJsonSource(
  sourceUrl: string,
  contentType?: AnnouncementContentType
): string | null {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.hostname !== "bhi.nku.edu.tr") return null;
  if (url.pathname !== "/json/nku.json2.php") {
    if (url.pathname.startsWith("/json/nku")) throw new Error("SOURCE_LAYOUT_INVALID:NKU_EVENT");
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.search !== "?sid="
    || url.hash
    || contentType !== "event"
  ) throw new Error("SOURCE_LAYOUT_INVALID:NKU_EVENT");
  return url.toString();
}

function parseNkuEventJson(input: string, sourceUrl: string): ParsedAnnouncementItem[] {
  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch {
    throw new Error("SOURCE_LAYOUT_INVALID:NKU_EVENT");
  }
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > 10_000) {
    throw new Error("SOURCE_LAYOUT_INVALID:NKU_EVENT");
  }

  let sentinelCount = 0;
  const results: ParsedAnnouncementItem[] = [];
  for (const [index, value] of payload.entries()) {
    if (isNkuEventSentinel(value)) {
      sentinelCount += 1;
      if (sentinelCount > 1 || index !== payload.length - 1) throw new Error("SOURCE_LAYOUT_INVALID:NKU_EVENT");
      continue;
    }
    if (!isJsonRecord(value)) throw new Error("SOURCE_LAYOUT_INVALID:NKU_EVENT");
    const id = value.id;
    const rawTitle = value.title;
    const description = value.description;
    const rawUrl = value.url;
    const allDay = value.allDay;
    const start = readCalendarTimestamp(value.start);
    const end = readCalendarTimestamp(value.end);
    const urlMatch = typeof rawUrl === "string"
      ? rawUrl.match(/^haberler\/([^/\\\u0000-\u001f]{1,2000})\/s\/(\d{1,12})$/u)
      : null;
    if (
      typeof id !== "string"
      || !/^\d{1,12}$/u.test(id)
      || typeof rawTitle !== "string"
      || !normalizeDisplayText(rawTitle, 500)
      || typeof description !== "string"
      || typeof rawUrl !== "string"
      || (allDay !== undefined && allDay !== "true")
      || !start
      || !end
    ) throw new Error("SOURCE_LAYOUT_INVALID:NKU_EVENT");
    if (end.value < start.value) continue;
    if (!urlMatch || urlMatch[2] !== id || /%(?:2f|5c)/iu.test(rawUrl)) {
      throw new Error("SOURCE_LAYOUT_INVALID:NKU_EVENT");
    }

    const rawLinkUrl = new URL(nkuEventOrigin);
    rawLinkUrl.pathname = `/${rawUrl}`;
    const link = canonicalizeContentUrl(rawLinkUrl.toString(), `${nkuEventOrigin}/`);
    if (!link) throw new Error("SOURCE_LAYOUT_INVALID:NKU_EVENT");
    const linkUrl = new URL(link);
    if (
      linkUrl.protocol !== "https:"
      || linkUrl.hostname !== "bhi.nku.edu.tr"
      || linkUrl.search
      || linkUrl.hash
      || !/^\/haberler\/[^/]+\/s\/\d{1,12}$/u.test(linkUrl.pathname)
      || !linkUrl.pathname.endsWith(`/s/${id}`)
    ) throw new Error("SOURCE_LAYOUT_INVALID:NKU_EVENT");

    const item = finalizeParsedItem({ rawTitle, link, summary: description, richBody: description }, sourceUrl);
    if (!item) continue;
    const endDate = allDay === "true" ? previousCalendarDate(end.date) : end.date;
    if (!endDate || endDate < start.date) continue;
    results.push({
      ...item,
      keyDates: [{
        label: "Etkinlik tarihi",
        startDate: start.date,
        ...(endDate !== start.date ? { endDate } : {})
      }]
    });
  }
  return dedupeParsedItems(results);
}

function isNkuEventSentinel(value: unknown): boolean {
  if (!isJsonRecord(value) || Object.keys(value).sort().join(",") !== "date,description,title,type,url") return false;
  return value.url === "/"
    && typeof value.description === "string"
    && readCalendarTimestamp(value.date) !== undefined
    && typeof value.type === "string"
    && foldAnchorTitle(value.type) === "baslangic"
    && typeof value.title === "string"
    && foldAnchorTitle(value.title).includes("giris");
}

function readCalendarTimestamp(value: unknown): CalendarTimestamp | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/^(20\d{2})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u);
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5] || !match[6]) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (!createUtcCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return undefined;
  return { date: `${match[1]}-${match[2]}-${match[3]}`, value };
}

function previousCalendarDate(value: string): string | undefined {
  const match = value.match(/^(20\d{2})-(\d{2})-(\d{2})$/u);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const date = createUtcCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
  if (!date) return undefined;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

const ktunNewsItemSelector = "main#mainContent .table-responsive > table.table.table-striped.table-hover > tbody > tr";

function isKtunNewsListingSource(sourceUrl: string, contentType?: AnnouncementContentType): boolean {
  try {
    const url = new URL(sourceUrl);
    return contentType === "news"
      && url.protocol === "https:"
      && url.hostname === "www.ktun.edu.tr"
      && url.pathname === "/tr/Universite/TumHaberler"
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function parseKtunNewsListingHtml(input: string, sourceUrl: string): ParsedAnnouncementItem[] {
  const $ = load(input);
  const tables = $("main#mainContent .table-responsive > table.table.table-striped.table-hover");
  const table = tables.first();
  const headings = table.find("> thead > tr").first().children("th");
  const rows = table.find("> tbody > tr");
  const validRows = rows.length >= 2 && rows.length <= 80 && rows.toArray().every((element) => {
    const row = $(element);
    const cells = row.children("td");
    const titleAnchor = cells.eq(0).children("a");
    const detailAnchor = cells.eq(2).children("a");
    const title = normalizeDisplayText(titleAnchor.text(), 500);
    const date = normalizeDisplayText(cells.eq(1).text(), 200);
    const titleUrl = canonicalizeContentUrl(titleAnchor.attr("href") ?? "", sourceUrl);
    const detailUrl = canonicalizeContentUrl(detailAnchor.attr("href") ?? "", sourceUrl);
    if (
      row.closest("nav,aside,footer").length
      || cells.length !== 3
      || titleAnchor.length !== 1
      || detailAnchor.length !== 1
      || !title
      || isLowValueAnchorTitle(title)
      || foldAnchorTitle(detailAnchor.text()) !== "detay"
      || !titleUrl
      || canonicalContentKey(titleUrl) !== canonicalContentKey(detailUrl ?? "")
      || parsePublicationMaybe(date)?.publicationKind !== "date"
    ) return false;
    const url = new URL(titleUrl);
    return url.protocol === "https:"
      && url.hostname === "www.ktun.edu.tr"
      && /^\/tr\/Universite\/HaberDetay\/[^/?#]{1,500}_\d{1,12}$/u.test(url.pathname)
      && !url.search
      && !url.hash;
  });
  if (
    tables.length !== 1
    || table.closest("nav,aside,footer").length
    || headings.length !== 3
    || foldAnchorTitle(headings.eq(0).text()) !== "haberler"
    || foldAnchorTitle(headings.eq(1).text()) !== "yayin tarihi"
    || normalizeDisplayText(headings.eq(2).text())
    || !validRows
  ) throw new Error("SOURCE_LAYOUT_INVALID:KTUN_NEWS");

  return parseConfiguredAnnouncementHtml(input, sourceUrl, {
    itemSelector: ktunNewsItemSelector,
    titleSelector: "td:first-child > a",
    linkSelector: "td:first-child > a",
    dateSelector: "td:nth-child(2)"
  }, "news");
}

/** Uses admin-maintained CSS selectors when a university changes its listing layout. */
export function parseConfiguredAnnouncementHtml(
  input: string,
  sourceUrl: string,
  config: AnnouncementSourceParserConfig,
  profileType: AnnouncementContentType | "academic_calendar" = "announcement"
): ParsedAnnouncementItem[] {
  const itemSelector = config.itemSelector?.trim();
  if (!itemSelector) return [];
  const officialSourceUrl = canonicalizeContentUrl(sourceUrl);
  if (!officialSourceUrl || !isOfficialContentUrl(officialSourceUrl, officialSourceUrl)) return [];
  try {
    const $ = load(input);
    const results: ParsedAnnouncementItem[] = [];
    $(itemSelector).slice(0, 80).each((_index, element) => {
      const row = $(element);
      const titleSelector = config.titleSelector?.trim();
      const linkSelector = config.linkSelector?.trim();
      const dateSelector = config.dateSelector?.trim();
      const contentSelector = config.contentSelector?.trim();
      const titleNode = titleSelector
        ? (row.is(titleSelector) ? row : row.find(titleSelector).first())
        : row.is("a") ? row : row.find("h1,h2,h3,h4,h5,h6,a").first();
      const linkNode = linkSelector
        ? (row.is(linkSelector) ? row : row.find(linkSelector).first())
        : titleNode.is("a") ? titleNode : titleNode.find("a").first().add(row.find("a").first()).first();
      const rawTitle = titleNode.text();
      const href = linkNode.attr("href") ?? linkNode.find("a").first().attr("href");
      if (!rawTitle || !href) return;
      const dateText = dateSelector
        ? (row.is(dateSelector) ? row : row.find(dateSelector).first()).text()
        : "";
      const contentNode = contentSelector
        ? (row.is(contentSelector) ? row : row.find(contentSelector).first())
        : undefined;
      const publication = dateText ? parsePublicationMaybe(normalizeDisplayText(dateText, 200)) : undefined;
      const summary = contentNode ? normalizeDisplayText(contentNode.text(), 1_200) : undefined;
      const richBody = contentNode?.html() ?? undefined;
      const candidate: ParsedItemCandidate = {
        rawTitle,
        link: href,
        ...(publication ?? {}),
        ...(summary ? { summary } : {}),
        ...(richBody ? { richBody } : {})
      };
      const item = profileType === "academic_calendar"
        ? finalizeConfiguredCalendarItem(candidate, officialSourceUrl)
        : finalizeParsedItem(candidate, officialSourceUrl);
      if (item) results.push(item);
    });
    return dedupeParsedItems(results);
  } catch (error) {
    if (error instanceof Error && error.message === "SOURCE_HTML_SELECTOR_LAYOUT_INVALID") throw error;
    throw new Error(`SOURCE_HTML_SELECTOR_INVALID:${error instanceof Error ? error.message : String(error)}`);
  }
}

function finalizeConfiguredCalendarItem(
  input: ParsedItemCandidate,
  officialSourceUrl: string
): ParsedAnnouncementItem | null {
  const title = normalizeDisplayText(input.rawTitle, 500);
  const link = canonicalizeContentUrl(input.link, officialSourceUrl);
  if (!title || !link || !isOfficialContentUrl(link, officialSourceUrl)) return null;
  const summary = normalizeDisplayText(input.summary, 1_200);
  const body = sanitizeAcademicContentBody(input.richBody ?? input.summary);
  const keyDates = extractAcademicContentKeyDates(body);
  return {
    title,
    rawTitle: title,
    link,
    ...(input.publicationKind === "date" && input.publishedDate
      ? { publicationKind: "date", publishedDate: input.publishedDate }
      : input.publishedAt ? { publicationKind: "timestamp", publishedAt: input.publishedAt } : {}),
    ...(summary ? { summary } : {}),
    ...(body.length ? { body } : {}),
    ...(keyDates.length ? { keyDates } : {})
  };
}

/** Parses one generic detail page without trusting it to change source ownership. */
export function parseGenericAnnouncementDetailHtml(
  input: string,
  detailUrl: string,
  officialSourceUrl: string,
  listingItem: ParsedAnnouncementItem
): ParsedAnnouncementItem | null {
  const document = stripChromeRegions(input, "generic");
  const content = selectGenericDetailContent(document);
  const detailTitle = extractGenericDetailTitle(content, document);
  const rawTitle = detailTitle && !isLowValueAnchorTitle(detailTitle)
    ? detailTitle
    : listingItem.rawTitle ?? listingItem.title;
  const timestamps = extractHtmlTimestamps(content, rawTitle, officialSourceUrl);
  const listingPublication = publicationFromParsedItem(listingItem);
  const summary = extractGenericDetailSummary(content, document);
  return finalizeParsedItem({
    rawTitle,
    link: detailUrl,
    ...(listingPublication ?? timestamps.publication),
    ...(timestamps.sourceUpdatedAt ?? listingItem.sourceUpdatedAt
      ? { sourceUpdatedAt: timestamps.sourceUpdatedAt ?? listingItem.sourceUpdatedAt }
      : {}),
    ...(summary ? { summary } : listingItem.summary ? { summary: listingItem.summary } : {}),
    ...(content ? { richBody: content } : {})
  }, officialSourceUrl);
}

export async function hydrateGenericAnnouncementDetails(
  items: readonly ParsedAnnouncementItem[],
  officialSourceUrl: string,
  timeoutMs: number,
  authorityContext: SourceAuthorityFetchContext
): Promise<ParsedAnnouncementItem[]> {
  const hydrated = [...items];
  const candidates = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isDetailHydrationCandidate(item, officialSourceUrl))
    .slice(0, ANNOUNCEMENT_DETAIL_MAX_ITEMS);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(ANNOUNCEMENT_DETAIL_CONCURRENCY, candidates.length) },
    async () => {
      while (nextIndex < candidates.length) {
        const candidate = candidates[nextIndex];
        nextIndex += 1;
        if (!candidate) continue;
        try {
          const decision = requireSourceAuthority(authorityContext.authority, {
            boundary: "fetch",
            resource: authorityContext.resource,
            url: candidate.item.link
          });
          if (!decision.canonicalUrl) continue;
          const response = await fetchTextWithSafeRequest(
            decision.canonicalUrl,
            Math.min(Math.max(timeoutMs, 1), ANNOUNCEMENT_DETAIL_MAX_TIMEOUT_MS),
            {
              ...authorityContext,
              accept: "text/html,application/xhtml+xml;q=0.9",
              maximumRedirects: 2,
              maximumResponseBytes: ANNOUNCEMENT_DETAIL_MAX_RESPONSE_BYTES
            }
          );
          if (response.contentType && !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/iu.test(response.contentType)) continue;
          const detail = parseGenericAnnouncementDetailHtml(
            response.text,
            response.finalUrl,
            officialSourceUrl,
            candidate.item
          );
          if (detail) hydrated[candidate.index] = mergeListingAndDetailItem(candidate.item, detail);
        } catch {
          // A single unsafe, redirected, oversized, slow, or malformed detail
          // page must not discard the already-validated listing snapshot.
        }
      }
    }
  );
  await Promise.all(workers);
  return hydrated;
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

export function parseJsonAnnouncements(
  input: string,
  sourceUrl: string,
  contentType?: AnnouncementContentType
): ParsedAnnouncementItem[] {
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    return [];
  }

  const items: ParsedAnnouncementItem[] = [];
  collectJsonAnnouncementItems(data, sourceUrl, items, 0, Array.isArray(data), contentType);
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

function parseHtmlDocument(
  input: string,
  sourceUrl: string,
  profile: HtmlParserProfile,
  contentType?: AnnouncementContentType
): ParsedAnnouncementItem[] {
  const officialSourceUrl = canonicalizeContentUrl(sourceUrl);
  if (!officialSourceUrl || !isOfficialContentUrl(officialSourceUrl, officialSourceUrl)) return [];
  const document = stripNonContentRegions(input);
  const anchors: RegExpMatchArray[] = [];
  for (const anchor of document.matchAll(/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/giu)) {
    anchors.push(anchor);
    if (anchors.length >= ANNOUNCEMENT_HTML_MAX_ANCHORS) break;
  }
  const anchorAncestors = buildAnchorAncestorChains(document, anchors.map((anchor) => anchor.index ?? 0));
  const expectedContentType = contentType ?? inferListingContentType(officialSourceUrl);
  const linkOccurrences = new Map<string, number>();
  for (const anchor of anchors) {
    const attributes = `${anchor[1] ?? ""} ${anchor[3] ?? ""}`;
    const rawHref = normalizeDisplayText(anchor[2], 2_048);
    const href = profile === "generic"
      ? resolveBandirmaEventListingHref(rawHref, attributes, officialSourceUrl, expectedContentType) ?? rawHref
      : rawHref;
    const link = canonicalizeContentUrl(href, officialSourceUrl);
    const key = link ? canonicalContentKey(link) : null;
    if (key) linkOccurrences.set(key, (linkOccurrences.get(key) ?? 0) + 1);
  }
  const results: ParsedAnnouncementItem[] = [];

  for (const anchor of anchors) {
    const attributes = `${anchor[1] ?? ""} ${anchor[3] ?? ""}`;
    if (isChromeAnchor(attributes)) continue;
    const rawHref = normalizeDisplayText(anchor[2], 2_048);
    const href = profile === "generic"
      ? resolveBandirmaEventListingHref(rawHref, attributes, officialSourceUrl, expectedContentType) ?? rawHref
      : rawHref;
    const ancestors = anchorAncestors.get(anchor.index ?? 0) ?? [];
    if (ancestors.some((ancestor) => isChromeHtmlAncestor(ancestor, profile))) continue;
    if (profile === "ankara" && (
      !ancestors.some((ancestor) => readClassNames(ancestor.attributes).has("entry-title"))
      || !ancestors.some((ancestor) => (
        ancestor.tag === "article" && isAnkaraAnnouncementArticle({ classes: readClassNames(ancestor.attributes) })
      ))
    )) continue;
    let rawTitle = anchor[4] ?? "";
    let normalizedTitle = normalizeDisplayText(rawTitle, 500);
    if (profile === "generic" && (!normalizedTitle || isLowValueAnchorTitle(normalizedTitle))) {
      rawTitle = extractAnchorMetadataTitle(attributes, anchor[4] ?? "") ?? rawTitle;
      normalizedTitle = normalizeDisplayText(rawTitle, 500);
    }
    if (profile === "generic" && (!normalizedTitle || isLowValueAnchorTitle(normalizedTitle))) {
      rawTitle = extractGenericContentRowTitle(document, anchor.index ?? 0, ancestors) ?? rawTitle;
      normalizedTitle = normalizeDisplayText(rawTitle, 500);
    }
    if (!href || !normalizedTitle || isLowValueAnchorTitle(normalizedTitle)) continue;

    const candidateUrl = canonicalizeContentUrl(href, officialSourceUrl);
    if (!candidateUrl) continue;
    if (profile === "generic" && canonicalContentKey(candidateUrl) === canonicalContentKey(officialSourceUrl)) continue;
    const context = boundedHtmlContext(document, anchor.index ?? 0, ancestors, anchor[0]);
    const timestamps = extractHtmlTimestamps(context, normalizedTitle, officialSourceUrl);
    const summary = extractHtmlSummary(context);
    if (profile === "generic") {
      const key = canonicalContentKey(candidateUrl);
      if (!hasGenericListingItemEvidence({
        title: normalizedTitle,
        candidateUrl,
        ...(expectedContentType ? { expectedContentType } : {}),
        context,
        anchorHtml: anchor[0],
        document,
        anchorIndex: anchor.index ?? 0,
        ancestors,
        linkOccurrences: key ? linkOccurrences.get(key) ?? 0 : 0,
        timestamps,
        ...(summary ? { summary } : {})
      })) continue;
    } else if (!containsAnnouncementHint(normalizedTitle, candidateUrl) && !containsAnnouncementHint("", officialSourceUrl)) {
      continue;
    }
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

function hasGenericListingItemEvidence(input: {
  title: string;
  candidateUrl: string;
  expectedContentType?: AnnouncementContentType;
  context: string;
  anchorHtml: string;
  document: string;
  anchorIndex: number;
  ancestors: HtmlAncestor[];
  linkOccurrences: number;
  timestamps: { publication: ParsedPublication | Record<string, never>; sourceUpdatedAt?: Date };
  summary?: string;
}): boolean {
  if (input.ancestors.some((ancestor) => isChromeHtmlAncestor(ancestor))) return false;
  const candidateTypes = listingContentTypes(`${input.title} ${input.candidateUrl}`, input.candidateUrl);
  if (input.expectedContentType && candidateTypes.has(input.expectedContentType)) return true;
  if (!input.expectedContentType) return candidateTypes.size > 0;

  const pathTypes = listingContentTypes(input.candidateUrl, input.candidateUrl);
  if (pathTypes.size > 0 && !pathTypes.has(input.expectedContentType)) return false;
  const contentAncestors = input.ancestors;
  if (contentAncestors.some((ancestor) => ancestor.tag === "article")) return true;
  const rowAncestor = [...contentAncestors].reverse().find(isContentRowAncestor);
  if (rowAncestor) {
    const rowWindow = boundedHtmlAncestorContent(input.document, input.anchorIndex, rowAncestor);
    if (isTypedContentRowAncestor(rowAncestor) || hasGenericContentRowSignal(rowWindow)) return true;
  }
  if (input.context === input.anchorHtml) {
    return input.linkOccurrences > 1 && contentAncestors.some((ancestor) => /^h[1-6]$/u.test(ancestor.tag));
  }
  if (/^\s*<article\b/iu.test(input.context)) return true;
  if (/^\s*<(?:li|section|div)\b[^>]*(?:class|id)=["'][^"']*(?:announcement|duyuru|news|haber|event|etkinlik|post|entry|content[-_ ]?item)[^"']*["']/iu.test(input.context)) {
    return true;
  }
  if (Object.keys(input.timestamps.publication).length > 0 || input.timestamps.sourceUpdatedAt || input.summary) return true;
  return /\b(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-]20\d{2}\b/u.test(normalizeDisplayText(input.context, 5_000));
}

function inferListingContentType(sourceUrl: string): AnnouncementContentType | undefined {
  const types = listingContentTypes(sourceUrl, sourceUrl);
  return types.size === 1 ? [...types][0] : undefined;
}

function listingContentTypes(value: string, url: string): Set<AnnouncementContentType> {
  const folded = foldAnchorTitle(value);
  const words = new Set(folded.split(" "));
  const types = new Set<AnnouncementContentType>();
  if (["duyuru", "duyurular", "duyurusu", "announcement", "announcements", "notice", "notices", "ilan", "ilanlar"].some((word) => words.has(word))) {
    types.add("announcement");
  }
  if (["haber", "haberler", "news"].some((word) => words.has(word))) types.add("news");
  if (["etkinlik", "etkinlikler", "event", "events"].some((word) => words.has(word))) types.add("event");
  try {
    const pathSegments = new URL(url).pathname.split("/").filter(Boolean).map(foldAnchorTitle);
    if (pathSegments.includes("d")) types.add("announcement");
    if (pathSegments.includes("h")) types.add("news");
    if (pathSegments.includes("e")) types.add("event");
  } catch {
    // The caller already canonicalizes candidate URLs; an invalid URL has no hint.
  }
  return types;
}

interface HtmlAncestor {
  tag: string;
  attributes: string;
  start: number;
  end?: number;
}

function buildAnchorAncestorChains(input: string, anchorIndexes: number[]): Map<number, HtmlAncestor[]> {
  const indexes = [...anchorIndexes].sort((left, right) => left - right);
  const result = new Map<number, HtmlAncestor[]>();
  const stack: HtmlAncestor[] = [];
  const voidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  let nextAnchor = 0;
  let overflowDepth = 0;
  for (const token of input.matchAll(/<(\/?)\s*([a-z][\w-]*)\b([^>]*)>/giu)) {
    const tokenIndex = token.index ?? 0;
    while ((indexes[nextAnchor] ?? Number.POSITIVE_INFINITY) <= tokenIndex) {
      result.set(indexes[nextAnchor]!, overflowDepth > 0
        ? [...stack, { tag: "ancestor-depth-overflow", attributes: "", start: tokenIndex }]
        : [...stack]);
      nextAnchor += 1;
    }
    const tag = (token[2] ?? "").toLocaleLowerCase("en-US");
    if (token[1]) {
      if (overflowDepth > 0) {
        overflowDepth -= 1;
        continue;
      }
      const matching = stack.map((ancestor) => ancestor.tag).lastIndexOf(tag);
      if (matching >= 0) {
        stack[matching]!.end = tokenIndex + token[0].length;
        stack.splice(matching);
      }
      continue;
    }
    const attributes = token[3] ?? "";
    if (!voidElements.has(tag) && !/\/\s*$/u.test(attributes)) {
      if (stack.length >= ANNOUNCEMENT_HTML_MAX_ANCESTORS) overflowDepth += 1;
      else stack.push({ tag, attributes, start: tokenIndex });
    }
  }
  while (nextAnchor < indexes.length) {
    result.set(indexes[nextAnchor]!, [...stack]);
    nextAnchor += 1;
  }
  return result;
}

function isChromeHtmlAncestor(ancestor: HtmlAncestor, profile: HtmlParserProfile = "generic"): boolean {
  if (ancestor.tag === "ancestor-depth-overflow") return true;
  const role = foldAnchorTitle(readHtmlAttribute(ancestor.attributes, "role") ?? "");
  if (["nav", "footer"].includes(ancestor.tag)) return true;
  if (ancestor.tag === "aside") {
    const classes = readClassNames(ancestor.attributes);
    if (role === "complementary" || profile !== "generic" || (!classes.has("fullside") && !classes.has("rightsidebar"))) return true;
  }
  if (["banner", "contentinfo", "menu", "menubar", "navigation"].includes(role)) return true;
  if (["html", "body"].includes(ancestor.tag)) return false;
  return [readHtmlAttribute(ancestor.attributes, "class"), readHtmlAttribute(ancestor.attributes, "id")]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(/\s+/u))
    .some((value) => isChromeIdentityToken(value, profile));
}

function isChromeIdentityToken(value: string, profile: HtmlParserProfile = "generic"): boolean {
  const token = normalizeDisplayText(value, 200).toLocaleLowerCase("en-US");
  if (CHROME_IDENTITY_TOKEN.test(token)) return true;
  if (profile === "yok") return ["quick-links", "quick_links", "corporate-links", "corporate_links", "bagli-kurulus", "bagli_kurulus"].includes(token);
  return profile === "ankara" && ["widget-area", "widget_area"].includes(token);
}

function isTypedContentRowAncestor(ancestor: HtmlAncestor): boolean {
  const identityWords = new Set(foldAnchorTitle([
    readHtmlAttribute(ancestor.attributes, "class"),
    readHtmlAttribute(ancestor.attributes, "id")
  ].filter(Boolean).join(" ")).split(" "));
  return ["announcement", "duyuru", "news", "haber", "event", "etkinlik"].some((word) => identityWords.has(word))
    && ["item", "card", "row"].some((word) => identityWords.has(word));
}

function isContentRowAncestor(ancestor: HtmlAncestor): boolean {
  if (isTypedContentRowAncestor(ancestor)) return true;
  const classes = readClassNames(ancestor.attributes);
  return ["item", "card", "post", "entry", "row", "media", "well", "cbp-item"].some((name) => classes.has(name));
}

function hasGenericContentRowSignal(input: string): boolean {
  return /<(?:time)\b|(?:class|id)=["'][^"']*(?:date|tarih|summary|excerpt|description|ozet)[^"']*["']/iu.test(input)
    || /\b(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-]20\d{2}\b/u.test(normalizeDisplayText(input, 5_000));
}

function extractGenericContentRowTitle(input: string, anchorIndex: number, ancestors: HtmlAncestor[]): string | undefined {
  if (ancestors.some((ancestor) => isChromeHtmlAncestor(ancestor))) return undefined;
  const rowAncestor = [...ancestors].reverse().find(isContentRowAncestor);
  if (!rowAncestor) return undefined;
  const beforeAnchor = input.slice(
    Math.max(rowAncestor.start, anchorIndex - ANNOUNCEMENT_HTML_ROW_EVIDENCE_RADIUS),
    anchorIndex
  );
  const rawTitle = [...beforeAnchor.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/giu)].at(-1)?.[1];
  const normalizedTitle = normalizeDisplayText(rawTitle, 500);
  return normalizedTitle && !isLowValueAnchorTitle(normalizedTitle) ? rawTitle : undefined;
}

function resolveBandirmaEventListingHref(
  href: string,
  attributes: string,
  sourceUrl: string,
  contentType?: AnnouncementContentType
): string | undefined {
  if (contentType !== "event" || href.toLocaleLowerCase("tr-TR") !== "#secilietkinlikdetay") return undefined;
  const source = new URL(sourceUrl);
  if (source.hostname !== "bandirma.edu.tr" && !source.hostname.endsWith(".bandirma.edu.tr")) return undefined;
  if (!readClassNames(attributes).has("etkinliklink")) return undefined;
  const segments = source.pathname.split("/").filter(Boolean);
  if (segments.length !== 4 || segments[2]?.toLocaleLowerCase("tr-TR") !== "etkinlik" || segments[3]?.toLocaleLowerCase("tr-TR") !== "liste") {
    return undefined;
  }
  const id = readHtmlAttribute(attributes, "data-id") ?? "";
  const slug = readHtmlAttribute(attributes, "data-slug") ?? "";
  const language = readHtmlAttribute(attributes, "data-lang") ?? "";
  const unit = readHtmlAttribute(attributes, "data-birimseo") ?? "";
  if (!/^\d{1,12}$/u.test(id) || !/^[a-z0-9-]{1,300}$/iu.test(slug) || language !== segments[0] || unit !== segments[1]) {
    return undefined;
  }
  source.pathname = `${source.pathname.replace(/\/$/u, "")}/${slug}-${id}`;
  source.hash = "";
  return source.toString();
}

function boundedHtmlAncestorContent(input: string, anchorIndex: number, ancestor: HtmlAncestor): string {
  if (ancestor.end === undefined) return "";
  return input.slice(
    Math.max(ancestor.start, anchorIndex - ANNOUNCEMENT_HTML_ROW_EVIDENCE_RADIUS),
    Math.min(ancestor.end, anchorIndex + ANNOUNCEMENT_HTML_ROW_EVIDENCE_RADIUS)
  );
}

function boundedHtmlContext(
  input: string,
  anchorIndex: number,
  ancestors: HtmlAncestor[],
  anchorHtml: string
): string {
  const contentAncestor = [...ancestors].reverse().find((ancestor) => (
    ancestor.tag === "article" || ancestor.tag === "li" || isContentRowAncestor(ancestor)
  ));
  return contentAncestor ? boundedHtmlAncestorContent(input, anchorIndex, contentAncestor) || anchorHtml : anchorHtml;
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
  const announcementRows = readArticleBlocks(input).filter(isAnkaraAnnouncementArticle);
  const hasMalformedRow = announcementRows.some((row) => (
    !/<[a-z][\w-]*\b[^>]*class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["'][^"']+["']/iu.test(row.body)
  ));
  if (!hasContentRoot || announcementRows.length < 2 || hasMalformedRow) {
    throw new Error("SOURCE_LAYOUT_INVALID:ANKARA");
  }
}

function isAnkaraAnnouncementArticle(row: { classes: Set<string> }): boolean {
  return (row.classes.has("post") && row.classes.has("announcement"))
    || (
      row.classes.has("type-post")
      && row.classes.has("status-publish")
      && (row.classes.has("category-duyurular") || row.classes.has("category-gecmis-duyurular"))
    );
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
  if (isListingNavigationUrl(input.link)) return null;
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

function isListingNavigationUrl(input: string): boolean {
  try {
    const url = new URL(input);
    const pathname = url.pathname.replace(/\/+$/u, "") || "/";
    if (pathname === "/" && !url.hash.startsWith("#!/")) return true;
    if (/\/(?:duyuru[-_]?arsiv|arsiv|archive|archives)$/iu.test(pathname)) return true;
    if (/\/date\/20\d{2}\/(?:0?[1-9]|1[0-2])$/iu.test(pathname)) return true;
    if (/(?:^|\/)(?:duyuru|haber|etkinlik)\/(?:liste|index(?:\.html?)?)$/iu.test(pathname)) return true;
    if (/(?:^|\/)(?:duyurular|haberler|etkinlikler|announcements|events|news)$/iu.test(pathname)) return true;
    return (url.hostname === "baskent.edu.tr" || url.hostname.endsWith(".baskent.edu.tr"))
      && /^\/tr\/(?:haberler|etkinlikler)\/(?:egitim|basvuru|taziye|konferans|konusma|yarisma|toren)\/\d+$/iu.test(pathname);
  } catch {
    return false;
  }
}

function stripChromeRegions(input: string, profile: HtmlParserProfile): string {
  let output = stripNonContentRegions(input);
  const profileMarkers = profile === "yok"
    ? "quick[-_]links|corporate[-_]links|bagli[-_]kurulus"
    : profile === "ankara"
      ? "widget[-_]area"
      : "(?!)";
  const chromeMarkers = `(?<![a-z0-9_-])(?:${CHROME_IDENTITY_TOKEN_SOURCE}|${profileMarkers})(?![a-z0-9_-])`;

  for (let pass = 0; pass < 4; pass += 1) {
    const previous = output;
    output = output
      .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ")
      .replace(new RegExp(`<(div|section|ul|ol|header)\\b(?=[^>]*(?:(?:class|id)=["'][^"']*(?:${chromeMarkers})[^"']*["']|role=["'](?:banner|navigation|menu|menubar|contentinfo)["']))[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "giu"), " ");
    if (output === previous) break;
  }
  return output;
}

function stripNonContentRegions(input: string): string {
  return input
    .replace(/<!--([\s\S]*?)-->/gu, " ")
    .replace(/<(?:script|style|template|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|template|noscript)\s*>/giu, " ");
}

function isChromeAnchor(attributes: string): boolean {
  const role = foldAnchorTitle(readHtmlAttribute(attributes, "role") ?? "");
  if (["menuitem", "navigation"].includes(role)) return true;
  const rel = foldAnchorTitle(readHtmlAttribute(attributes, "rel") ?? "");
  if (rel.split(" ").some((value) => value === "next" || value === "prev")) return true;
  const label = foldAnchorTitle([
    readHtmlAttribute(attributes, "aria-label"),
    readHtmlAttribute(attributes, "title")
  ].filter(Boolean).join(" "));
  if (["next", "previous", "onceki", "sonraki"].includes(label)) return true;
  return [readHtmlAttribute(attributes, "class"), readHtmlAttribute(attributes, "id")]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(/\s+/u))
    .some((value) => isChromeIdentityToken(value));
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

function extractAnchorMetadataTitle(attributes: string, body: string): string | undefined {
  const imageAttributes = body.match(/<img\b([^>]*)>/iu)?.[1] ?? "";
  for (const candidate of [
    readHtmlAttribute(attributes, "aria-label"),
    readHtmlAttribute(attributes, "title"),
    readHtmlAttribute(attributes, "alt"),
    readHtmlAttribute(imageAttributes, "alt"),
    readHtmlAttribute(imageAttributes, "title")
  ]) {
    const normalized = normalizeDisplayText(candidate, 500);
    if (normalized && !isLowValueAnchorTitle(normalized)) return candidate;
  }
  return undefined;
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

function isGenericHtmlSnapshot(input: string, sourceUrl: string, parser: AnnouncementSourceParser): boolean {
  const resolvedParser = parser === "auto" ? (looksLikeXmlFeed(input) ? "rss" : looksLikeJson(input) ? "json" : "html") : parser;
  return resolvedParser === "html" && !isYokSourceUrl(sourceUrl) && !isAnkaraUniversitySourceUrl(sourceUrl);
}

function isDetailHydrationCandidate(item: ParsedAnnouncementItem, officialSourceUrl: string): boolean {
  const canonical = canonicalizeContentUrl(item.link);
  if (!canonical || canonicalContentKey(canonical) === canonicalContentKey(officialSourceUrl)) return false;
  const pathname = new URL(canonical).pathname;
  if (/\.(?:7z|avi|csv|docx?|gif|jpe?g|mov|mp3|mp4|pdf|png|pptx?|rar|svg|webp|xlsx?|zip)$/iu.test(pathname)) return false;
  const bodyLength = item.body?.reduce((total, block) => total + block.text.length, 0) ?? 0;
  return bodyLength < 2_000;
}

function selectGenericDetailContent(input: string): string {
  const candidates: string[] = [];
  for (const tag of ["article", "main"] as const) {
    for (const match of input.matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "giu"))) {
      if (match[0]) candidates.push(match[0]);
    }
  }
  for (const match of input.matchAll(/<(section|div)\b(?=[^>]*(?:class|id)=["'][^"']*(?:article|content|detail|entry|post|duyuru|haber|etkinlik)[^"']*["'])[^>]*>[\s\S]*?<\/\1\s*>/giu)) {
    if (match[0]) candidates.push(match[0]);
  }
  const richest = candidates
    .map((html) => ({ html, textLength: normalizeDisplayText(html, 20_000).length }))
    .filter((candidate) => candidate.textLength > 0)
    .sort((left, right) => right.textLength - left.textLength)[0]?.html;
  return richest ?? input;
}

function extractGenericDetailTitle(content: string, document: string): string | undefined {
  for (const input of [content, document]) {
    const heading = input.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/iu)?.[1]
      ?? input.match(/<[a-z][\w-]*\b(?=[^>]*itemprop=["']headline["'])[^>]*>([\s\S]*?)<\/[a-z][\w-]*\s*>/iu)?.[1];
    const normalized = normalizeDisplayText(heading, 500);
    if (normalized && !isNavigationOrChromeTitle(normalized)) return normalized;
  }
  const openGraphTitle = document.match(/<meta\b(?=[^>]*(?:property|name)=["'](?:og:title|twitter:title)["'])[^>]*content=["']([^"']+)["'][^>]*>/iu)?.[1];
  return normalizeDisplayText(openGraphTitle, 500) || undefined;
}

function extractGenericDetailSummary(content: string, document: string): string | undefined {
  const explicit = extractHtmlSummary(content)
    ?? document.match(/<meta\b(?=[^>]*name=["']description["'])[^>]*content=["']([^"']+)["'][^>]*>/iu)?.[1]
    ?? content.match(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/iu)?.[1];
  return normalizeDisplayText(explicit, 1_200) || undefined;
}

function publicationFromParsedItem(item: ParsedAnnouncementItem): ParsedPublication | undefined {
  if (item.publicationKind === "date" && item.publishedDate) {
    return { publicationKind: "date", publishedDate: item.publishedDate };
  }
  return item.publishedAt ? { publicationKind: "timestamp", publishedAt: item.publishedAt } : undefined;
}

function mergeListingAndDetailItem(listing: ParsedAnnouncementItem, detail: ParsedAnnouncementItem): ParsedAnnouncementItem {
  const detailBodyLength = detail.body?.reduce((total, block) => total + block.text.length, 0) ?? 0;
  const listingBodyLength = listing.body?.reduce((total, block) => total + block.text.length, 0) ?? 0;
  const publication = publicationFromParsedItem(listing) ?? publicationFromParsedItem(detail);
  const body = detailBodyLength > listingBodyLength ? detail.body : listing.body;
  const keyDates = detailBodyLength > listingBodyLength
    ? detail.keyDates ?? listing.keyDates
    : listing.keyDates ?? detail.keyDates;
  const rawTitle = detail.rawTitle ?? listing.rawTitle;
  return {
    ...listing,
    title: detail.title,
    ...(rawTitle ? { rawTitle } : {}),
    link: detail.link,
    ...(publication ?? {}),
    ...(detail.sourceUpdatedAt ?? listing.sourceUpdatedAt
      ? { sourceUpdatedAt: detail.sourceUpdatedAt ?? listing.sourceUpdatedAt }
      : {}),
    ...(detail.summary ?? listing.summary ? { summary: detail.summary ?? listing.summary } : {}),
    ...(body?.length ? { body } : {}),
    ...(keyDates?.length ? { keyDates } : {})
  };
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
const ankaraUniversityOrigin = "https://www.ankara.edu.tr";
const ankaraUniversityCmsHost = "ubys.ankara.edu.tr";
const ankaraUniversityCmsPaths = {
  news: "/api/CMS/GetMainNews",
  event: "/api/CMS/GetMainevents"
} as const;
const atuODataBaseUrl = "https://odata.atu.edu.tr/odata/DataService.svc";

interface AnkaraUniversityCmsDescriptor {
  contentType: "news" | "event";
  publicRoute: "haber" | "etkinlik";
  sourceUrl: string;
}

async function fetchAnkaraUniversityCmsItems(
  sourceUrl: string,
  timeoutMs: number,
  authorityContext: SourceAuthorityFetchContext | undefined,
  validators: SourceSnapshotValidators,
  contentType: AnnouncementContentType | undefined
): Promise<FetchedSourceSnapshot | null> {
  const descriptor = describeAnkaraUniversityCmsSource(sourceUrl, contentType);
  if (!descriptor) return null;
  if (authorityContext && authorityContext.resource !== descriptor.contentType) {
    throw new Error("ANKARA_CMS_SOURCE_INVALID");
  }

  const response = await fetchText(sourceUrl, timeoutMs, {
    accept: "application/json",
    ...(authorityContext ? authorityContext : {}),
    ...validators
  });
  if (canonicalContentKey(response.finalUrl) !== canonicalContentKey(sourceUrl)) {
    throw new Error("ANKARA_CMS_REDIRECT_INVALID");
  }
  if (response.status === 304) {
    return {
      items: [],
      finalUrl: response.finalUrl,
      fetchStatus: "not_modified",
      ...(response.etag ? { etag: response.etag } : {}),
      ...(response.lastModified ? { lastModified: response.lastModified } : {})
    };
  }
  if (!response.contentType || !/^application\/json(?:\s*;|$)/iu.test(response.contentType)) {
    throw new Error("ANKARA_CMS_CONTENT_TYPE_INVALID");
  }
  if (response.contentHash && response.contentHash === validators.contentHash) {
    return {
      items: [],
      finalUrl: response.finalUrl,
      fetchStatus: "not_modified",
      ...(response.etag ? { etag: response.etag } : {}),
      ...(response.lastModified ? { lastModified: response.lastModified } : {}),
      contentHash: response.contentHash
    };
  }

  return {
    items: parseAnkaraUniversityCmsPayload(response.text, descriptor),
    finalUrl: response.finalUrl,
    fetchStatus: "fetched",
    ...(response.etag ? { etag: response.etag } : {}),
    ...(response.lastModified ? { lastModified: response.lastModified } : {}),
    ...(response.contentHash ? { contentHash: response.contentHash } : {})
  };
}

function describeAnkaraUniversityCmsSource(
  sourceUrl: string,
  contentType: AnnouncementContentType | undefined
): AnkaraUniversityCmsDescriptor | null {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.hostname !== ankaraUniversityCmsHost || !url.pathname.startsWith("/api/CMS/")) return null;

  const expectedContentType = url.pathname === ankaraUniversityCmsPaths.news
    ? "news"
    : url.pathname === ankaraUniversityCmsPaths.event
      ? "event"
      : null;
  const expectedKeys = ["Page", "PageSize", "websiteId", "languageCode"];
  if (
    url.protocol !== "https:"
    || !expectedContentType
    || contentType !== expectedContentType
    || [...url.searchParams].length !== expectedKeys.length
    || expectedKeys.some((key) => url.searchParams.getAll(key).length !== 1)
    || !/^\d+$/u.test(url.searchParams.get("Page") ?? "")
    || !/^(?:[1-9]|[12]\d|30)$/u.test(url.searchParams.get("PageSize") ?? "")
    || url.searchParams.get("websiteId") !== "1"
    || url.searchParams.get("languageCode") !== "tr-TR"
  ) throw new Error("ANKARA_CMS_SOURCE_INVALID");

  return {
    contentType: expectedContentType,
    publicRoute: expectedContentType === "news" ? "haber" : "etkinlik",
    sourceUrl: url.toString()
  };
}

function parseAnkaraUniversityCmsPayload(
  input: string,
  descriptor: AnkaraUniversityCmsDescriptor
): ParsedAnnouncementItem[] {
  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch {
    throw new Error("ANKARA_CMS_RESPONSE_INVALID");
  }
  if (!isJsonRecord(payload) || !Array.isArray(payload.items) || payload.items.length > 30) {
    throw new Error("ANKARA_CMS_RESPONSE_INVALID");
  }

  return dedupeParsedItems(payload.items.map((value) => {
    if (!isJsonRecord(value)) throw new Error("ANKARA_CMS_RESPONSE_INVALID");
    const rawTitle = value.baslik;
    const slug = value.url;
    const publishedAt = readAnkaraUniversityCmsTimestamp(value.publishDate);
    const summary = readAnkaraUniversityCmsOptionalText(value, "aciklama");
    const richBody = readAnkaraUniversityCmsOptionalText(value, "icerik") ?? summary;
    if (
      typeof rawTitle !== "string"
      || typeof slug !== "string"
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)
      || !publishedAt
    ) throw new Error("ANKARA_CMS_RESPONSE_INVALID");

    const item = finalizeParsedItem({
      rawTitle,
      link: `${ankaraUniversityOrigin}/${descriptor.publicRoute}/${slug}`,
      publicationKind: "timestamp",
      publishedAt,
      ...(summary ? { summary } : {}),
      ...(richBody ? { richBody } : {})
    }, descriptor.sourceUrl);
    if (!item) throw new Error("ANKARA_CMS_RESPONSE_INVALID");
    if (descriptor.contentType !== "event") return item;

    const eventStart = readAnkaraUniversityCmsTimestamp(value.eventDateTime);
    const eventEnd = value.eventEndDateTime == null
      ? undefined
      : readAnkaraUniversityCmsTimestamp(value.eventEndDateTime);
    if (!eventStart || (value.eventEndDateTime != null && !eventEnd)) {
      throw new Error("ANKARA_CMS_RESPONSE_INVALID");
    }
    const startDate = formatIstanbulCalendarDate(eventStart);
    const endDate = eventEnd && eventEnd >= eventStart ? formatIstanbulCalendarDate(eventEnd) : undefined;
    return {
      ...item,
      keyDates: [{
        label: "Etkinlik tarihi",
        startDate,
        ...(endDate && endDate !== startDate ? { endDate } : {})
      }]
    };
  }));
}

function readAnkaraUniversityCmsOptionalText(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error("ANKARA_CMS_RESPONSE_INVALID");
  return value;
}

function readAnkaraUniversityCmsTimestamp(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  return parseExplicitSourceTimestamp(value);
}

function formatIstanbulCalendarDate(value: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

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

async function fetchAtuContentItems(
  sourceUrl: string,
  timeoutMs: number,
  authorityContext?: SourceAuthorityFetchContext,
  validators: SourceSnapshotValidators = {}
): Promise<FetchedSourceSnapshot | null> {
  const descriptor = describeAtuContentSource(sourceUrl);
  if (!descriptor) return null;

  const siteUrl = buildAtuODataUrl("Siteler", {
    "$format": "json",
    "$filter": `AlanAdi eq '${descriptor.siteAlias}' and Durum eq 1`,
    "$top": "1"
  });
  const siteResponse = await fetchText(siteUrl, timeoutMs, {
    accept: "application/json",
    ...(authorityContext ? authorityContext : {})
  });
  const sitePayload = parseAtuODataPayload<{ ID?: number }>(siteResponse.text);
  const siteId = sitePayload[0]?.ID;
  if (!Number.isInteger(siteId)) throw new Error("ATU_CONTENT_SITE_NOT_FOUND");

  const contentUrl = buildAtuODataUrl("V_GuncelIcerik", {
    "$format": "json",
    "$filter": `SiteID eq ${siteId} and Durum eq 1 and GrupTipi eq ${descriptor.groupType} and DilKodu eq 'TR'`,
    "$orderby": "BaslamaTarihi desc",
    "$top": "40"
  });
  const contentResponse = await fetchText(contentUrl, timeoutMs, {
    accept: "application/json",
    ...(authorityContext ? authorityContext : {}),
    ...validators
  });
  if (contentResponse.status === 304) {
    return {
      items: [],
      finalUrl: contentResponse.finalUrl,
      fetchStatus: "not_modified",
      ...(contentResponse.etag ? { etag: contentResponse.etag } : {}),
      ...(contentResponse.lastModified ? { lastModified: contentResponse.lastModified } : {})
    };
  }
  if (contentResponse.contentHash && contentResponse.contentHash === validators.contentHash) {
    return {
      items: [],
      finalUrl: contentResponse.finalUrl,
      fetchStatus: "not_modified",
      ...(contentResponse.etag ? { etag: contentResponse.etag } : {}),
      ...(contentResponse.lastModified ? { lastModified: contentResponse.lastModified } : {}),
      contentHash: contentResponse.contentHash
    };
  }
  const rows = parseAtuODataPayload<AtuContentRow>(contentResponse.text);

  const items = dedupeParsedItems(rows.flatMap((row) => {
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
  return {
    items,
    finalUrl: contentResponse.finalUrl,
    fetchStatus: "fetched",
    ...(contentResponse.etag ? { etag: contentResponse.etag } : {}),
    ...(contentResponse.lastModified ? { lastModified: contentResponse.lastModified } : {}),
    ...(contentResponse.contentHash ? { contentHash: contentResponse.contentHash } : {})
  };
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
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = foldAnchorTitle(key);
    if (jsonCollectionKeys.has(normalizedKey) && Array.isArray(nested) && nested.length === 0) return true;
    if (jsonWrapperKeys.has(normalizedKey) && hasExplicitEmptyJsonCollection(nested, depth + 1)) return true;
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
  return parseNamedDate(input);
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
  const namedDate = parseNamedDateParts(trimmed, false);
  if (namedDate) {
    const publishedDate = createCalendarDateString(namedDate.year, namedDate.month, namedDate.day);
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

function parseNamedDate(input: string): Date | undefined {
  const parts = parseNamedDateParts(input, false);
  return parts ? createUtcCalendarDate(parts.year, parts.month, parts.day) : undefined;
}

function parseNamedDateParts(input: string, exact: boolean): { year: number; month: number; day: number } | undefined {
  const normalized = foldAnchorTitle(input);
  const expression = exact
    ? /^(\d{1,2})\s+(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})$/u
    : /\b(\d{1,2})\s+(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/u;
  const match = normalized.match(expression);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const month = namedMonths[match[2]];
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

const jsonCollectionKeys = new Set(["items", "data", "results", "value", "announcements", "duyurular", "entries"]);
const jsonWrapperKeys = new Set(["d", "response", "payload"]);
const jsonItemWrapperKeys = new Set(["attributes", "fields", "properties"]);

function collectJsonAnnouncementItems(
  value: unknown,
  sourceUrl: string,
  output: ParsedAnnouncementItem[],
  depth: number,
  allowItem: boolean,
  contentType?: AnnouncementContentType
): void {
  if (depth > 8 || output.length >= 120) return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonAnnouncementItems(item, sourceUrl, output, depth + 1, true, contentType);
    return;
  }

  if (!isJsonRecord(value)) return;
  const bayburtMedia = readBayburtPortalMediaItem(value, sourceUrl, contentType);
  const rawTitle = readJsonRawText(value, ["title", "baslik", "başlık", "name", "subject", "headline"])
    ?? bayburtMedia?.rawTitle;
  const link = readJsonRawText(value, ["link", "url", "href", "permalink", "slug"])
    ?? bayburtMedia?.link;
  const summary = readJsonRawText(value, ["summary", "description", "excerpt", "ozet", "özet"]);
  const richBody = readJsonRawText(value, ["body", "content", "html", "icerik", "içerik", "HTMLicerik", "MetinIcerik"]);
  const published = readJsonRawText(value, ["publishedAt", "publishDate", "pubDate", "date", "createdAt", "baslamaTarihi", "BaşlamaTarihi"])
    ?? bayburtMedia?.published;
  const updated = readJsonRawText(value, ["sourceUpdatedAt", "updatedAt", "modifiedAt", "updateDate", "lastModified", "guncellenmeTarihi", "GüncellenmeTarihi"]);
  const absoluteLink = link ? canonicalizeContentUrl(link, sourceUrl) : null;

  if (allowItem && rawTitle && absoluteLink && (containsAnnouncementHint(normalizeDisplayText(rawTitle), absoluteLink) || containsAnnouncementHint("", sourceUrl))) {
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

  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = foldAnchorTitle(key);
    if (jsonCollectionKeys.has(normalizedKey)) collectJsonAnnouncementItems(nested, sourceUrl, output, depth + 1, true, contentType);
    else if (jsonWrapperKeys.has(normalizedKey)) collectJsonAnnouncementItems(nested, sourceUrl, output, depth + 1, Array.isArray(nested), contentType);
    else if (allowItem && jsonItemWrapperKeys.has(normalizedKey)) collectJsonAnnouncementItems(nested, sourceUrl, output, depth + 1, true, contentType);
  }
}

function readBayburtPortalMediaItem(
  record: Record<string, unknown>,
  sourceUrl: string,
  contentType?: AnnouncementContentType
): { rawTitle: string; link: string; published?: string } | undefined {
  try {
    const url = new URL(sourceUrl);
    const route = url.pathname.match(/^\/api\/web\/department\/medyalist\/(?:tr|en)\/(haber|etkinlik)\/\d+$/u)?.[1];
    if (
      url.hostname !== "apiportal.bayburt.edu.tr"
      || !route
      || contentType !== (route === "haber" ? "news" : "event")
    ) return undefined;
  } catch {
    return undefined;
  }

  const media = record.medyaresx_object;
  if (!isJsonRecord(media)) return undefined;
  const rawTitle = readJsonRawText(media, ["baslik"]);
  const link = readJsonRawText(record, ["domain"]);
  if (!rawTitle || !link) return undefined;
  const rawPublished = readJsonRawText(record, ["tarih"]);
  const published = rawPublished?.match(/^\d{4}-\d{2}-\d{2}(?=T)/u)?.[0] ?? rawPublished;
  return { rawTitle, link, ...(published ? { published } : {}) };
}

const namedMonths: Record<string, number> = {
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
  aralik: 12,
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
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
  input: FetchTextInput
): Promise<FetchedText> {
  const authorityContext = normalizeSourceAuthorityFetchContext(input);
  const response = await safeOutboundRequest(sourceUrl, {
    timeoutMs,
    maximumRedirects: input.maximumRedirects ?? 5,
    maximumResponseBytes: input.maximumResponseBytes ?? 5 * 1024 * 1024,
    headers: {
      Accept: input.accept ?? "text/html,*/*;q=0.8",
      "Accept-Language": input.acceptLanguage ?? "tr-TR,tr;q=0.9,en-US;q=0.7,en;q=0.6",
      "User-Agent": input.userAgent ?? crawlerUserAgent,
      ...(input.origin ? { Origin: input.origin } : isAnkaraUniversityCmsApiRequestUrl(sourceUrl) ? { Origin: ankaraUniversityOrigin } : {}),
      ...(input.etag ? { "If-None-Match": input.etag } : {}),
      ...(input.lastModified ? { "If-Modified-Since": input.lastModified } : {})
    },
    validateUrl: (candidate, previousUrl) => {
      if (authorityContext) {
        const decision = requireSourceAuthority(authorityContext.authority, {
          boundary: "fetch",
          resource: authorityContext.resource,
          url: sourceUrl,
          ...(previousUrl ? { finalRedirectUrl: candidate } : {})
        });
        const canonical = previousUrl ? decision.canonicalFinalRedirectUrl : decision.canonicalUrl;
        if (!canonical) throw new Error("SOURCE_AUTHORITY_CANONICAL_URL_MISSING");
        return preserveFetchTrailingSlash(canonical, candidate, previousUrl);
      }
      return requireOfficialRedirectUrl(candidate, sourceUrl, previousUrl ?? sourceUrl);
    }
  });
  if (response.status !== 304 && (response.status < 200 || response.status >= 300)) {
    throw new Error(`SOURCE_FETCH_FAILED:${response.status}`);
  }
  const etag = normalizedResponseValidator(response.headers.etag, 512);
  const lastModified = normalizedResponseValidator(response.headers["last-modified"], 128);
  const contentType = normalizedResponseValidator(response.headers["content-type"], 256);
  return {
    text: response.body.toString("utf8"),
    finalUrl: response.finalUrl,
    status: response.status,
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
    ...(contentType ? { contentType } : {}),
    ...(response.status === 304 ? {} : { contentHash: createHash("sha256").update(response.body).digest("hex") })
  };
}

function isAnkaraUniversityCmsApiRequestUrl(sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl);
    return url.protocol === "https:"
      && url.hostname === ankaraUniversityCmsHost
      && Object.values(ankaraUniversityCmsPaths).includes(url.pathname as (typeof ankaraUniversityCmsPaths)[keyof typeof ankaraUniversityCmsPaths]);
  } catch {
    return false;
  }
}

function normalizedResponseValidator(value: string | string[] | undefined, maximumLength: number): string | undefined {
  const candidate = (Array.isArray(value) ? value[0] : value)?.trim();
  if (!candidate || candidate.length > maximumLength || /[\r\n]/u.test(candidate)) return undefined;
  return candidate;
}

function normalizeSourceAuthorityFetchContext(input: FetchTextInput): SourceAuthorityFetchContext | null {
  const hasAuthority = input.authority !== undefined;
  const hasResource = input.resource !== undefined;
  if (hasAuthority !== hasResource) throw new Error("SOURCE_AUTHORITY_FETCH_CONTEXT_INCOMPLETE");
  if (!input.authority || !input.resource) return null;
  return { authority: input.authority, resource: input.resource };
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
