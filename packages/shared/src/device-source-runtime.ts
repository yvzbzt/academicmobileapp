import { load } from "cheerio/slim";
import { isExplicitSelcukEmptyListing, isSelcukUnitListingUrl } from "./source-listing-state.js";

export const DEVICE_SOURCE_RUNTIME_VERSION = "device-source-runtime-v2" as const;
export const DEVICE_SOURCE_ACCEPT_LANGUAGE = "tr-TR,tr;q=0.9,en-US;q=0.7,en;q=0.6" as const;
export const DEVICE_SOURCE_USER_AGENT = "AcademicMobileContent/1.0" as const;

export type DeviceSourceRuntimeContentType = "announcement" | "news" | "event";
export type DeviceSourceRuntimeParser = "auto" | "rss" | "html";

export interface DeviceSourceRuntimeParserConfig {
  itemSelector?: string;
  titleSelector?: string;
  linkSelector?: string;
  dateSelector?: string;
  eventDateSelector?: string;
  contentSelector?: string;
}

export interface DeviceSourceRuntimeRecipe {
  sourceUrl: string;
  allowedOfficialDomain: string;
  contentType: DeviceSourceRuntimeContentType;
  parser: DeviceSourceRuntimeParser;
  /** Server-observed time used for deterministic freshness decisions. */
  checkedAt: string;
  parserConfig?: DeviceSourceRuntimeParserConfig;
}

export interface DeviceSourceRuntimeItem {
  title: string;
  link: string;
  publicationKind?: "date" | "timestamp";
  publishedDate?: string;
  publishedAt?: string;
  sourceUpdatedAt?: string;
  summary?: string;
  body?: Array<{ type: "paragraph"; text: string }>;
  keyDates?: Array<{ label: string; startDate: string; endDate?: string }>;
}

export interface DeviceSourceRuntimeValidators {
  etag?: string;
  lastModified?: string;
}

export interface DeviceSourceRuntimeRequest {
  url: string;
  accept: string;
  validators?: DeviceSourceRuntimeValidators;
  origin?: string;
}

export interface DeviceSourceRuntimeResponse {
  status: number;
  text: string;
  finalUrl: string;
  contentType?: string;
  etag?: string;
  lastModified?: string;
}

export interface DeviceSourceRuntimeSnapshot {
  items: DeviceSourceRuntimeItem[];
  finalUrl: string;
  fetchStatus: "fetched" | "not_modified";
  etag?: string;
  lastModified?: string;
  profile: DeviceSourceRuntimeProfile;
}

export type DeviceSourceRuntimeTransport = (
  request: DeviceSourceRuntimeRequest,
) => Promise<DeviceSourceRuntimeResponse>;

export type DeviceSourceRuntimeProfile =
  | "atu_odata"
  | "ankara_cms"
  | "alanya_event"
  | "nku_event"
  | "bayburt_media"
  | "ktun_news"
  | "ktun_event"
  | "ege_listing"
  | "bandirma_event"
  | "configured_html"
  | "generic_json"
  | "generic_rss"
  | "generic_html";

const MAX_ITEMS = 60;
const MAX_CANDIDATES = MAX_ITEMS * 8;
const GENERIC_ACCEPT = "text/html,application/json,application/rss+xml,application/xml;q=0.9,text/plain;q=0.8";
const JSON_ACCEPT = "application/json";
const HTML_ACCEPT = "text/html,application/xhtml+xml";
const ANKARA_ORIGIN = "https://www.ankara.edu.tr";
const ATU_ODATA_BASE_URL = "https://odata.atu.edu.tr/odata/DataService.svc";
const NAMED_MONTHS: Readonly<Record<string, number>> = {
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
  oca: 1,
  sub: 2,
  mar: 3,
  nis: 4,
  haz: 6,
  tem: 7,
  agu: 8,
  eyl: 9,
  eki: 10,
  kas: 11,
  ara: 12,
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
  december: 12,
};

export async function executeDeviceSourceRuntime(
  recipe: DeviceSourceRuntimeRecipe,
  transport: DeviceSourceRuntimeTransport,
  validators: DeviceSourceRuntimeValidators = {},
): Promise<DeviceSourceRuntimeSnapshot> {
  assertRecipe(recipe);
  const requestProfile = detectDeviceSourceRuntimeProfile(recipe);
  if (requestProfile === "atu_odata") return fetchAtuSnapshot(recipe, transport, validators);

  const response = await transport({
    url: recipe.sourceUrl,
    accept: requestProfile === "ankara_cms" || requestProfile === "nku_event" || requestProfile === "bayburt_media" || requestProfile === "ktun_event"
      ? JSON_ACCEPT
      : requestProfile === "alanya_event" || requestProfile === "ktun_news" || requestProfile === "bandirma_event" || requestProfile === "ege_listing"
        ? HTML_ACCEPT
        : GENERIC_ACCEPT,
    ...(Object.keys(validators).length > 0 ? { validators } : {}),
    ...(requestProfile === "ankara_cms" ? { origin: ANKARA_ORIGIN } : {}),
  });
  const responseRecipe = recipeForFinalUrl(recipe, response.finalUrl);
  const responseProfile = detectDeviceSourceRuntimeProfile(responseRecipe, response.text);
  assertTransportResponse(response, responseRecipe, responseProfile);
  if (response.status === 304) return notModifiedSnapshot(response, responseProfile);
  return fetchedSnapshot(
    response,
    responseProfile,
    parseDeviceSourceRuntimeDocument(response.text, responseRecipe, response.finalUrl),
  );
}

function recipeForFinalUrl(
  recipe: DeviceSourceRuntimeRecipe,
  finalUrl: string,
): DeviceSourceRuntimeRecipe {
  const canonical = canonicalUrl(finalUrl);
  if (!canonical || new URL(canonical).protocol !== "https:" || officialDomain(canonical) !== recipe.allowedOfficialDomain) {
    throw runtimeError("SOURCE_RUNTIME_REDIRECT_REJECTED");
  }
  return { ...recipe, sourceUrl: canonical };
}

export function parseDeviceSourceRuntimeDocument(
  input: string,
  recipe: DeviceSourceRuntimeRecipe,
  baseUrl = recipe.sourceUrl,
): DeviceSourceRuntimeItem[] {
  assertRecipe(recipe);
  const body = input.trim();
  if (!body) return [];
  if (isErrorPageUrl(baseUrl)) throw runtimeError("SOURCE_ERROR_PAGE");
  const profile = detectDeviceSourceRuntimeProfile(recipe, body);
  let items: DeviceSourceRuntimeItem[];
  switch (profile) {
    case "ankara_cms": items = parseAnkaraCms(body, recipe); break;
    case "alanya_event": items = parseAlanyaEvent(body, recipe); break;
    case "nku_event": items = parseNkuEvent(body, recipe); break;
    case "bayburt_media": items = parseBayburtMedia(body, recipe); break;
    case "ktun_news": items = parseKtunNews(body, recipe); break;
    case "ktun_event": items = parseKtunEvent(body, recipe); break;
    case "ege_listing": items = parseEgeListing(body, recipe); break;
    case "bandirma_event": items = parseBandirmaEvent(body, recipe); break;
    case "configured_html": {
      items = parseConfiguredHtml(body, recipe, baseUrl);
      if (items.length === 0 && isExplicitSelcukEmptyListing(body, baseUrl)) throw runtimeError("SOURCE_LISTING_EMPTY");
      if (items.length === 0) throw runtimeError("SOURCE_HTML_SELECTOR_LAYOUT_INVALID");
      break;
    }
    case "generic_json": items = parseGenericJson(body, recipe, baseUrl); break;
    case "generic_rss": items = parseSyndicatedDocument(body, recipe, baseUrl); break;
    case "generic_html": items = parseGenericHtml(body, recipe, baseUrl); break;
    case "atu_odata": throw runtimeError("SOURCE_RUNTIME_ATU_REQUIRES_TRANSPORT");
  }
  const freshItems = filterFreshItems(items, recipe);
  const paginated = recipe.parserConfig && "maximumPages" in recipe.parserConfig && recipe.parserConfig.maximumPages === 2;
  if (profile === "configured_html" && !paginated && isSelcukUnitListingUrl(baseUrl) && items.length > 0 && freshItems.length === 0) throw runtimeError("SOURCE_LISTING_STALE");
  return freshItems;
}

export function detectDeviceSourceRuntimeProfile(
  recipe: DeviceSourceRuntimeRecipe,
  body = "",
): DeviceSourceRuntimeProfile {
  const source = new URL(recipe.sourceUrl);
  if (describeAtuSource(source)) return "atu_odata";
  if (describeAnkaraCmsSource(source, recipe.contentType)) return "ankara_cms";
  if (isExactSource(source, "www.alanyauniversity.edu.tr", "/tr/events.calendar", recipe.contentType, "event")) {
    return "alanya_event";
  }
  if (source.hostname === "bhi.nku.edu.tr" && source.pathname.startsWith("/json/nku")) {
    assertNkuSource(source, recipe);
    return "nku_event";
  }
  if (source.hostname === "apiportal.bayburt.edu.tr" && source.pathname.includes("/medyalist/")) {
    assertBayburtSource(source, recipe);
    return "bayburt_media";
  }
  if (source.hostname.endsWith("ktun.edu.tr") && source.pathname === "/tr/Universite/TumHaberler") {
    assertKtunSource(source, recipe);
    return "ktun_news";
  }
  if (isExactSource(source, "www.ktun.edu.tr", "/tr/Universite/findAll", recipe.contentType, "event")) {
    if (recipe.parser !== "auto" || source.search) throw runtimeError("SOURCE_LAYOUT_INVALID:KTUN_EVENT");
    return "ktun_event";
  }
  if (source.hostname.endsWith("bandirma.edu.tr") && /\/Etkinlik\/Liste\/?$/iu.test(source.pathname)) {
    assertBandirmaSource(source, recipe);
    return "bandirma_event";
  }
  if (source.hostname === "egeduyuru.ege.edu.tr" && source.pathname === "/tum_duyurular.html") {
    if (recipe.contentType === "news" || recipe.parser !== "auto" || source.search || source.hash) throw runtimeError("SOURCE_LAYOUT_INVALID:EGE_LISTING");
    return "ege_listing";
  }
  if (recipe.parserConfig?.itemSelector?.trim()) return "configured_html";
  if (recipe.parser === "rss" || (recipe.parser === "auto" && /^<\?xml\b|^<(?:rss|feed)\b/iu.test(body.trim()))) {
    return "generic_rss";
  }
  if (recipe.parser === "auto" && /^[\[{]/u.test(body.trim())) return "generic_json";
  return "generic_html";
}

async function fetchAtuSnapshot(
  recipe: DeviceSourceRuntimeRecipe,
  transport: DeviceSourceRuntimeTransport,
  validators: DeviceSourceRuntimeValidators,
): Promise<DeviceSourceRuntimeSnapshot> {
  const descriptor = describeAtuSource(new URL(recipe.sourceUrl));
  const checkedAt = strictReferenceDate(recipe.checkedAt);
  if (!descriptor || !checkedAt) throw runtimeError("SOURCE_LAYOUT_INVALID:ATU_ODATA");
  const siteResponse = await transport({
    url: odataUrl("Siteler", {
      "$format": "json",
      "$filter": `AlanAdi eq '${descriptor.siteAlias}' and Durum eq 1`,
      "$top": "1",
    }),
    accept: JSON_ACCEPT,
  });
  assertTransportResponse(siteResponse, recipe, "atu_odata");
  if (siteResponse.status === 304) throw runtimeError("SOURCE_LAYOUT_INVALID:ATU_SITE_NOT_MODIFIED");
  const siteId = parseODataRows(siteResponse.text)[0]?.ID;
  if (!Number.isInteger(siteId)) throw runtimeError("SOURCE_LAYOUT_INVALID:ATU_SITE");

  const contentResponse = await transport({
    url: odataUrl("V_GuncelIcerik", {
      "$format": "json",
      "$filter": `SiteID eq ${String(siteId)} and Durum eq 1 and GrupTipi eq ${String(descriptor.groupType)} and DilKodu eq 'TR'`,
      "$orderby": "BaslamaTarihi desc",
      "$top": "40",
    }),
    accept: JSON_ACCEPT,
    ...(Object.keys(validators).length > 0 ? { validators } : {}),
  });
  assertTransportResponse(contentResponse, recipe, "atu_odata");
  if (contentResponse.status === 304) return notModifiedSnapshot(contentResponse, "atu_odata");
  const rows = parseODataRows(contentResponse.text);
  const items = rows.flatMap((row): DeviceSourceRuntimeItem[] => {
    const title = normalizeText(asString(row.Baslik));
    if (!title) return [];
    const embedded = firstHtmlHref(asString(row.HTMLicerik) || asString(row.MetinIcerik));
    const guid = normalizeText(asString(row.GuID));
    const generated = guid
      ? `${new URL(recipe.sourceUrl).origin}/#!/${descriptor.routeName}/${encodeURIComponent(guid)}`
      : undefined;
    const link = resolveTrustedUrl(embedded ?? generated, recipe, recipe.sourceUrl);
    if (!link) return [];
    const publishedAt = readDotNetDate(asString(row.BaslamaTarihi), checkedAt);
    const sourceUpdatedAt = readDotNetDate(asString(row.EklenmeTarihi), checkedAt);
    const summary = normalizeText(asString(row.AltBaslik));
    const richText = normalizeText(asString(row.HTMLicerik) || asString(row.MetinIcerik));
    return [{
      title,
      link,
      ...(publishedAt ? { publicationKind: "timestamp" as const, publishedAt } : {}),
      ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
      ...(summary && summary !== "-" ? { summary } : richText ? { summary: richText.slice(0, 1_200) } : {}),
    }];
  });
  return fetchedSnapshot(contentResponse, "atu_odata", filterFreshItems(dedupe(items), recipe));
}

function parseAnkaraCms(input: string, recipe: DeviceSourceRuntimeRecipe): DeviceSourceRuntimeItem[] {
  const descriptor = describeAnkaraCmsSource(new URL(recipe.sourceUrl), recipe.contentType);
  if (!descriptor) throw runtimeError("SOURCE_LAYOUT_INVALID:ANKARA_CMS");
  const payload = parseJson(input, "SOURCE_LAYOUT_INVALID:ANKARA_CMS");
  if (!isRecord(payload) || !Array.isArray(payload.items) || payload.items.length > 30) {
    throw runtimeError("SOURCE_LAYOUT_INVALID:ANKARA_CMS");
  }
  return dedupe(payload.items.map((candidate): DeviceSourceRuntimeItem => {
    if (!isRecord(candidate)) throw runtimeError("SOURCE_LAYOUT_INVALID:ANKARA_CMS");
    const title = normalizeText(asString(candidate.baslik));
    const slug = asString(candidate.url);
    const publishedAt = readIsoTimestamp(asString(candidate.publishDate));
    const summary = optionalText(candidate, "aciklama", "SOURCE_LAYOUT_INVALID:ANKARA_CMS");
    const content = optionalText(candidate, "icerik", "SOURCE_LAYOUT_INVALID:ANKARA_CMS") ?? summary;
    const link = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)
      ? resolveTrustedUrl(`${ANKARA_ORIGIN}/${descriptor.publicRoute}/${slug}`, recipe)
      : null;
    if (!title || !link || !publishedAt) throw runtimeError("SOURCE_LAYOUT_INVALID:ANKARA_CMS");
    const keyDates = descriptor.contentType === "event"
      ? readAnkaraEventDates(candidate)
      : undefined;
    return {
      title,
      link,
      publicationKind: "timestamp",
      publishedAt,
      ...(summary ? { summary } : {}),
      ...(content ? { body: [{ type: "paragraph", text: normalizeText(content).slice(0, 8_000) }] } : {}),
      ...(keyDates ? { keyDates } : {}),
    };
  }));
}

function parseAlanyaEvent(input: string, recipe: DeviceSourceRuntimeRecipe): DeviceSourceRuntimeItem[] {
  const $ = load(input);
  const scripts = $("script").toArray()
    .map((element) => $(element).html() ?? "")
    .filter((script) => /\$\(\s*["']#calendar["']\s*\)\.fullCalendar\s*\(/u.test(script));
  const match = scripts[0]?.match(/\bevents\s*:\s*(\[[\s\S]*\])\s*,\s*eventColor\s*:/u);
  if ($('[id="calendar"]').length !== 1 || scripts.length !== 1 || !match?.[1]) {
    throw runtimeError("SOURCE_LAYOUT_INVALID:ALANYA_EVENT");
  }
  const payload = parseJson(match[1], "SOURCE_LAYOUT_INVALID:ALANYA_EVENT");
  if (!Array.isArray(payload) || payload.length > 2_000) throw runtimeError("SOURCE_LAYOUT_INVALID:ALANYA_EVENT");
  const rows = payload.map((candidate) => {
    if (!isRecord(candidate) || Object.keys(candidate).sort().join(",") !== "end,id,start,title,url") {
      throw runtimeError("SOURCE_LAYOUT_INVALID:ALANYA_EVENT");
    }
    const id = asString(candidate.id);
    const title = normalizeText(asString(candidate.title));
    const start = readCalendarTimestamp(candidate.start);
    const end = readCalendarTimestamp(candidate.end);
    const expected = `https://www.alanyauniversity.edu.tr/tr/events.single/id/${id}`;
    const link = resolveTrustedUrl(asString(candidate.url), recipe);
    if (!/^\d{1,12}$/u.test(id) || !title || !start || !end || end.value < start.value || link !== expected) {
      throw runtimeError("SOURCE_LAYOUT_INVALID:ALANYA_EVENT");
    }
    return { id, title, start, end, link };
  }).sort((left, right) => right.start.value.localeCompare(left.start.value) || Number(right.id) - Number(left.id));
  return rows.map((row) => ({
    title: row.title,
    link: row.link,
    keyDates: [{
      label: "Etkinlik tarihi",
      startDate: row.start.date,
      ...(row.end.date !== row.start.date ? { endDate: row.end.date } : {}),
    }],
  }));
}

function parseNkuEvent(input: string, recipe: DeviceSourceRuntimeRecipe): DeviceSourceRuntimeItem[] {
  const payload = parseJson(input, "SOURCE_LAYOUT_INVALID:NKU_EVENT");
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > 10_000) {
    throw runtimeError("SOURCE_LAYOUT_INVALID:NKU_EVENT");
  }
  let sentinelCount = 0;
  const items: DeviceSourceRuntimeItem[] = [];
  for (const [index, candidate] of payload.entries()) {
    if (isNkuSentinel(candidate)) {
      sentinelCount += 1;
      if (sentinelCount > 1 || index !== payload.length - 1) throw runtimeError("SOURCE_LAYOUT_INVALID:NKU_EVENT");
      continue;
    }
    if (!isRecord(candidate)) throw runtimeError("SOURCE_LAYOUT_INVALID:NKU_EVENT");
    const id = asString(candidate.id);
    const title = normalizeText(asString(candidate.title));
    const summary = normalizeText(asString(candidate.description));
    const rawUrl = asString(candidate.url);
    const start = readCalendarTimestamp(candidate.start);
    const end = readCalendarTimestamp(candidate.end);
    const urlMatch = rawUrl.match(/^haberler\/([^/\\\u0000-\u001f]{1,2000})\/s\/(\d{1,12})$/u);
    if (
      !/^\d{1,12}$/u.test(id)
      || !title
      || !summary
      || !start
      || !end
      || (candidate.allDay !== undefined && candidate.allDay !== "true")
      || !urlMatch
      || urlMatch[2] !== id
      || /%(?:2f|5c)/iu.test(rawUrl)
    ) throw runtimeError("SOURCE_LAYOUT_INVALID:NKU_EVENT");
    if (end.value < start.value) continue;
    const link = resolveTrustedUrl(`https://bhi.nku.edu.tr/${rawUrl}`, recipe);
    if (!link || !new URL(link).pathname.endsWith(`/s/${id}`)) throw runtimeError("SOURCE_LAYOUT_INVALID:NKU_EVENT");
    const endDate = candidate.allDay === "true" ? previousDate(end.date) : end.date;
    if (!endDate || endDate < start.date) continue;
    items.push({
      title,
      link,
      summary,
      body: [{ type: "paragraph", text: summary }],
      keyDates: [{
        label: "Etkinlik tarihi",
        startDate: start.date,
        ...(endDate !== start.date ? { endDate } : {}),
      }],
    });
  }
  return dedupe(items);
}

function parseBayburtMedia(input: string, recipe: DeviceSourceRuntimeRecipe): DeviceSourceRuntimeItem[] {
  const source = new URL(recipe.sourceUrl);
  assertBayburtSource(source, recipe);
  const payload = parseJson(input, "SOURCE_LAYOUT_INVALID:BAYBURT_MEDIA");
  if (!isRecord(payload) || !Array.isArray(payload.response) || payload.response.length > 1_000) {
    throw runtimeError("SOURCE_LAYOUT_INVALID:BAYBURT_MEDIA");
  }
  return dedupe(payload.response.map((candidate): DeviceSourceRuntimeItem => {
    if (!isRecord(candidate) || !isRecord(candidate.medyaresx_object)) {
      throw runtimeError("SOURCE_LAYOUT_INVALID:BAYBURT_MEDIA");
    }
    const title = normalizeText(asString(candidate.medyaresx_object.baslik));
    const link = resolveTrustedUrl(asString(candidate.domain), recipe);
    const publishedDate = asString(candidate.tarih).match(/^\d{4}-\d{2}-\d{2}(?=T|$)/u)?.[0];
    if (!title || !link || !publishedDate || !isRealDate(publishedDate)) {
      throw runtimeError("SOURCE_LAYOUT_INVALID:BAYBURT_MEDIA");
    }
    return { title, link, publicationKind: "date", publishedDate };
  }));
}

function parseKtunNews(input: string, recipe: DeviceSourceRuntimeRecipe): DeviceSourceRuntimeItem[] {
  const $ = load(input);
  const tables = $("main#mainContent .table-responsive > table.table.table-striped.table-hover");
  const table = tables.first();
  const headings = table.find("> thead > tr").first().children("th");
  const rows = table.find("> tbody > tr");
  if (
    tables.length !== 1
    || headings.length !== 3
    || fold(headings.eq(0).text()) !== "haberler"
    || fold(headings.eq(1).text()) !== "yayin tarihi"
    || normalizeText(headings.eq(2).text())
    || rows.length < 2
    || rows.length > 80
  ) throw runtimeError("SOURCE_LAYOUT_INVALID:KTUN_NEWS");
  const items = rows.toArray().map((element): DeviceSourceRuntimeItem => {
    const cells = $(element).children("td");
    const titleAnchor = cells.eq(0).children("a");
    const detailAnchor = cells.eq(2).children("a");
    const title = normalizeText(titleAnchor.text());
    const link = resolveTrustedUrl(titleAnchor.attr("href"), recipe);
    const detail = resolveTrustedUrl(detailAnchor.attr("href"), recipe);
    const publishedDate = readDateOnly(cells.eq(1).text());
    if (
      cells.length !== 3
      || titleAnchor.length !== 1
      || detailAnchor.length !== 1
      || !title
      || fold(detailAnchor.text()) !== "detay"
      || !link
      || link !== detail
      || !publishedDate
      || !/^\/tr\/Universite\/HaberDetay\/[^/?#]{1,500}_\d{1,12}$/u.test(new URL(link).pathname)
    ) throw runtimeError("SOURCE_LAYOUT_INVALID:KTUN_NEWS");
    return { title, link, publicationKind: "date", publishedDate };
  });
  return dedupe(items);
}

function parseKtunEvent(input: string, recipe: DeviceSourceRuntimeRecipe): DeviceSourceRuntimeItem[] {
  const payload = parseJson(input, "SOURCE_LAYOUT_INVALID:KTUN_EVENT");
  const checkedAt = strictReferenceDate(recipe.checkedAt)!;
  if (!Array.isArray(payload) || payload.length > MAX_CANDIDATES) throw runtimeError("SOURCE_LAYOUT_INVALID:KTUN_EVENT");
  return dedupe(payload.map((row): DeviceSourceRuntimeItem => {
    if (!isRecord(row)) throw runtimeError("SOURCE_LAYOUT_INVALID:KTUN_EVENT");
    const title = normalizeText(asString(row.title));
    const link = resolveTrustedUrl(asString(row.url), recipe);
    const start = readDotNetDate(asString(row.start), checkedAt);
    const end = readDotNetDate(asString(row.end), checkedAt);
    if (!title || !link || !start || !end || end < start) throw runtimeError("SOURCE_LAYOUT_INVALID:KTUN_EVENT");
    const startDate = istanbulDate(start);
    const endDate = istanbulDate(end);
    return { title, link, keyDates: [{ label: "Etkinlik tarihi", startDate, ...(endDate !== startDate ? { endDate } : {}) }] };
  }));
}

function parseEgeListing(input: string, recipe: DeviceSourceRuntimeRecipe): DeviceSourceRuntimeItem[] {
  const $ = load(input);
  const table = $("table").filter((_index, element) => $(element).find("th.thbaslik").length === 6);
  const headings = table.find("th.thbaslik").map((_i, element) => fold($(element).text())).get();
  if (table.length !== 1 || headings.join("|") !== "konu|turu|baslangic tarihi|duzenlenme yeri|gonderen birim|goruntule") throw runtimeError("SOURCE_LAYOUT_INVALID:EGE_LISTING");
  const checkedAt = strictReferenceDate(recipe.checkedAt)!;
  const items: DeviceSourceRuntimeItem[] = [];
  table.find("tr").filter((_i, element) => $(element).children("td.tdbaslik").length > 0).slice(0, MAX_CANDIDATES).each((_i, element) => {
    const cells = $(element).children("td.tdbaslik");
    const button = cells.eq(5).find("button");
    const id = button.attr("onclick")?.replace(/\s+/gu, "").match(/^icerikGetir\((\d{1,12})\);?$/u)?.[1];
    const title = normalizeText(cells.eq(0).text());
    const category = fold(cells.eq(1).text());
    const startDate = readDateOnly(cells.eq(2).text());
    if (cells.length !== 6 || button.length !== 1 || !id || !title || !startDate
      || !["genel", "egitim", "acil duyurular", "toplanti/kurultay", "konferans/kongre/sempozyum"].includes(category)) throw runtimeError("SOURCE_LAYOUT_INVALID:EGE_LISTING");
    const event = category === "toplanti/kurultay" || category === "konferans/kongre/sempozyum";
    if ((recipe.contentType === "event") !== event || dateOnlyAtNoon(startDate)! < oneYearBefore(checkedAt)) return;
    const summary = [cells.eq(1).text(), cells.eq(3).text(), cells.eq(4).text()].map(normalizeText).filter(Boolean).join(" · ");
    items.push({ title, link: `https://egeduyuru.ege.edu.tr/icerikgoster_5.php?id=${id}`,
      keyDates: [{ label: event ? "Etkinlik tarihi" : "Başlangıç tarihi", startDate }], ...(summary ? { summary } : {}) });
  });
  return dedupe(items);
}

function parseBandirmaEvent(input: string, recipe: DeviceSourceRuntimeRecipe): DeviceSourceRuntimeItem[] {
  const $ = load(input);
  const source = new URL(recipe.sourceUrl);
  const segments = source.pathname.split("/").filter(Boolean);
  const items: DeviceSourceRuntimeItem[] = [];
  $(".etkinlik a.etkinlikLink[href]").slice(0, MAX_CANDIDATES).each((_index, element) => {
    const link = $(element);
    if (fold(link.attr("href") ?? "") !== "#secilietkinlikdetay") return;
    const id = link.attr("data-id") ?? "";
    const slug = link.attr("data-slug") ?? "";
    if (
      !/^\d{1,12}$/u.test(id)
      || !/^[a-z0-9-]{1,300}$/iu.test(slug)
      || link.attr("data-lang") !== segments[0]
      || link.attr("data-birimseo") !== segments[1]
    ) return;
    const target = new URL(recipe.sourceUrl);
    target.pathname = `${target.pathname.replace(/\/$/u, "")}/${slug}-${id}`;
    target.hash = "";
    const trusted = resolveTrustedUrl(target.toString(), recipe);
    const title = normalizeText(link.text());
    if (!trusted || !title) return;
    const startDate = readDateOnly(link.closest(".etkinlik").find(".tarih").text());
    items.push({
      title,
      link: trusted,
      ...(startDate ? { keyDates: [{ label: "Etkinlik tarihi", startDate }] } : {}),
    });
  });
  if (items.length === 0) throw runtimeError("SOURCE_LAYOUT_INVALID:BANDIRMA_EVENT");
  return dedupe(items);
}

function parseConfiguredHtml(
  input: string,
  recipe: DeviceSourceRuntimeRecipe,
  baseUrl: string,
): DeviceSourceRuntimeItem[] {
  try {
    const $ = load(input);
    const config = recipe.parserConfig;
    if (!config?.itemSelector) return [];
    // Validate all selector syntax even when the listing currently has no rows.
    for (const key of ["itemSelector", "titleSelector", "linkSelector", "dateSelector", "eventDateSelector", "contentSelector"] as const) {
      const selector = config[key];
      if (selector?.trim()) $(selector);
    }
    const items: DeviceSourceRuntimeItem[] = [];
    $(config.itemSelector).slice(0, MAX_CANDIDATES).each((_index, element) => {
      const row = $(element);
      const titleNode = config.titleSelector
        ? row.is(config.titleSelector) ? row : row.find(config.titleSelector).first()
        : row.is("a") ? row : row.find("h1,h2,h3,h4,h5,h6,a").first();
      const linkNode = config.linkSelector
        ? row.is(config.linkSelector) ? row : row.find(config.linkSelector).first()
        : titleNode.is("a") ? titleNode : titleNode.find("a").first().add(row.find("a").first()).first();
      const dateNode = config.dateSelector
        ? row.is(config.dateSelector) ? row : row.find(config.dateSelector).first()
        : undefined;
      const eventDateNode = config.eventDateSelector && recipe.contentType === "event"
        ? row.is(config.eventDateSelector) ? row : row.find(config.eventDateSelector).first()
        : undefined;
      const eventDate = eventDateNode
        ? readDateOnly(eventDateNode.attr("datetime") || eventDateNode.text())
        : null;
      const contentNode = config.contentSelector
        ? row.is(config.contentSelector) ? row : row.find(config.contentSelector).first()
        : undefined;
      const record = createItem(recipe, baseUrl, {
        title: titleNode.text() || titleNode.attr("title") || titleNode.attr("alt") || linkNode.attr("title"),
        link: linkNode.attr("href") ?? linkNode.find("a").first().attr("href"),
        date: dateNode?.attr("datetime") || dateNode?.text(),
        summary: contentNode?.text(),
      });
      if (record) {
        if (eventDate) record.keyDates = [{ label: "Etkinlik tarihi", startDate: eventDate }];
        items.push(record);
      }
    });
    return dedupe(items);
  } catch (error) {
    if (isRuntimeError(error)) throw error;
    throw runtimeError("SOURCE_HTML_SELECTOR_INVALID");
  }
}

function parseGenericHtml(
  input: string,
  recipe: DeviceSourceRuntimeRecipe,
  baseUrl: string,
): DeviceSourceRuntimeItem[] {
  try {
    const $ = load(input);
    $("nav, footer, aside:not(.fullSide):not(.rightSidebar), [role=navigation], .site-menu, .header-nav-lower, .fast-menu-block, .drop-menu-row").remove();
    const preferred = "article a[href], main .duyuru a[href], main .announcement a[href], main .haber a[href], main .news a[href], main .etkinlik a[href], main .event a[href], .well .media a[href], .item a[href]";
    const candidates = $(preferred).length > 0 ? $(preferred) : $("main a[href], a[href]");
    const items: DeviceSourceRuntimeItem[] = [];
    candidates.slice(0, MAX_CANDIDATES).each((_index, element) => {
      const link = $(element);
      const row = link.closest("article, li, tr, .item, .card, .well, .media, .duyuru, .announcement, .haber, .news, .etkinlik, .event, .cbp-item");
      const heading = row.find("h1,h2,h3,h4,h5,h6").filter((_i, node) => normalizeText($(node).text()).length > 3).last();
      const time = row.find("time, .date, .tarih").first();
      const linkTitle = link.attr("title") || link.find("img").attr("alt") || link.text();
      const title = !normalizeText(linkTitle) || isNavigationTitle(linkTitle) ? heading.text() : linkTitle;
      const href = link.attr("href");
      const date = time.attr("datetime") || time.text();
      const summary = row.find("p, .description, .summary").first().text();
      if (!hasGenericHtmlItemEvidence({
        recipe,
        baseUrl,
        title,
        href,
        date,
        summary,
        ancestorIdentity: link.parents().addBack().map((_i, node) => {
          const candidate = $(node);
          return `${candidate.is("article") ? "article" : ""} ${candidate.attr("class") ?? ""} ${candidate.attr("id") ?? ""}`;
        }).get().join(" "),
      })) return;
      const record = createItem(recipe, baseUrl, {
        title,
        link: href,
        date,
        summary,
      });
      if (record) items.push(record);
    });
    return dedupe(items);
  } catch {
    return [];
  }
}

function hasGenericHtmlItemEvidence(input: {
  recipe: DeviceSourceRuntimeRecipe;
  baseUrl: string;
  title?: string | undefined;
  href?: string | undefined;
  date?: string | undefined;
  summary?: string | undefined;
  ancestorIdentity: string;
}): boolean {
  const link = resolveTrustedUrl(input.href, input.recipe, input.baseUrl);
  if (!link || isListingNavigationUrl(link, input.recipe.sourceUrl)) return false;

  const pathTypes = contentTypeHints(new URL(link).pathname);
  const titleTypes = contentTypeHints(input.title ?? "");
  if (titleTypes.has(input.recipe.contentType) || pathTypes.has(input.recipe.contentType)) return true;
  if (pathTypes.size > 0) return false;

  const ancestors = fold(input.ancestorIdentity);
  if (/(?:^|\s)article(?:\s|$)/u.test(ancestors)) return true;
  const typedRow = input.recipe.contentType === "announcement"
    ? /(?:^|[^\p{L}\p{N}])(?:announcement|duyuru|ilan|notice)(?:[^\p{L}\p{N}]|$)/u
    : input.recipe.contentType === "news"
      ? /(?:^|[^\p{L}\p{N}])(?:haber|news)(?:[^\p{L}\p{N}]|$)/u
      : /(?:^|[^\p{L}\p{N}])(?:etkinlik|event)(?:[^\p{L}\p{N}]|$)/u;
  if (typedRow.test(ancestors)) return true;
  if (Object.keys(readPublication(input.date, false)).length > 0) return true;
  return normalizeText(input.summary).length >= 24;
}

function contentTypeHints(value: string): Set<DeviceSourceRuntimeContentType> {
  const words = new Set(fold(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const types = new Set<DeviceSourceRuntimeContentType>();
  if (["announcement", "announcements", "duyuru", "duyurular", "duyurusu", "ilan", "ilanlar", "notice", "notices"]
    .some((word) => words.has(word))) types.add("announcement");
  if (["haber", "haberler", "news"].some((word) => words.has(word))) types.add("news");
  if (["etkinlik", "etkinlikler", "event", "events"].some((word) => words.has(word))) types.add("event");
  return types;
}

function parseSyndicatedDocument(
  input: string,
  recipe: DeviceSourceRuntimeRecipe,
  baseUrl: string,
): DeviceSourceRuntimeItem[] {
  try {
    const $ = load(input, { xmlMode: true });
    const items: DeviceSourceRuntimeItem[] = [];
    $("item, entry").slice(0, MAX_CANDIDATES).each((_index, element) => {
      const row = $(element);
      const link = row.find("link").first();
      const item = createItem(recipe, baseUrl, {
        title: row.find("title").first().text(),
        link: link.attr("href") || link.text() || row.find("guid").first().text(),
        date: row.find("pubDate, published, updated, date").first().text(),
        summary: row.find("description, summary, content\\:encoded, content").first().text(),
      }, true);
      if (item) items.push(item);
    });
    return dedupe(items);
  } catch {
    return [];
  }
}

function parseGenericJson(
  input: string,
  recipe: DeviceSourceRuntimeRecipe,
  baseUrl: string,
): DeviceSourceRuntimeItem[] {
  const payload = parseJson(input, "SOURCE_JSON_LAYOUT_INVALID");
  const records = collectJsonRecords(payload);
  const items = records.flatMap((record): DeviceSourceRuntimeItem[] => {
    const item = createItem(recipe, baseUrl, {
      title: firstValue(record, ["title", "name", "headline", "subject", "baslik", "başlık"]),
      link: firstValue(record, ["link", "url", "href", "permalink", "detailUrl", "slug"]),
      date: firstValue(record, ["publishedAt", "publishDate", "publishedDate", "pubDate", "date", "createdAt", "updatedAt"]),
      summary: firstValue(record, ["summary", "description", "excerpt", "content", "body", "ozet", "özet"]),
    }, true);
    return item ? [item] : [];
  });
  if (items.length === 0 && records.length > 0) throw runtimeError("SOURCE_JSON_LAYOUT_INVALID");
  return dedupe(items);
}

function createItem(
  recipe: DeviceSourceRuntimeRecipe,
  baseUrl: string,
  candidate: {
    title?: string | undefined;
    link?: string | undefined;
    date?: string | undefined;
    summary?: string | undefined;
  },
  allowRfcDate = false,
): DeviceSourceRuntimeItem | null {
  const title = normalizeText(candidate.title);
  if (!title || isNavigationTitle(title)) return null;
  const link = resolveTrustedUrl(candidate.link, recipe, baseUrl);
  if (!link || isListingNavigationUrl(link, recipe.sourceUrl)) return null;
  const summary = normalizeText(candidate.summary).slice(0, 1_200);
  return {
    title,
    link,
    ...readPublication(candidate.date, allowRfcDate),
    ...(summary ? { summary, body: [{ type: "paragraph", text: summary }] } : {}),
  };
}

function filterFreshItems(
  items: readonly DeviceSourceRuntimeItem[],
  recipe: DeviceSourceRuntimeRecipe,
): DeviceSourceRuntimeItem[] {
  const checkedAt = strictReferenceDate(recipe.checkedAt);
  if (!checkedAt) throw runtimeError("SOURCE_RUNTIME_RECIPE_INVALID");
  const checkedDate = istanbulDate(checkedAt.toISOString());
  return items.filter((item) => isFreshItem(item, recipe.contentType, checkedAt)).map((item) => {
    if (
      (item.publishedDate && item.publishedDate > checkedDate)
      || (item.publishedAt && Date.parse(item.publishedAt) > checkedAt.getTime())
    ) {
      // CMS date badges can contain future event dates. Keep the content, not a false publication claim.
      const { publicationKind: _kind, publishedDate: _date, publishedAt: _timestamp, ...undated } = item;
      return undated;
    }
    return item;
  });
}

function isFreshItem(
  item: DeviceSourceRuntimeItem,
  contentType: DeviceSourceRuntimeContentType,
  checkedAt: Date,
): boolean {
  const currentStart = checkedAt.getUTCMonth() >= 6
    ? checkedAt.getUTCFullYear()
    : checkedAt.getUTCFullYear() - 1;
  const minimumYear = currentStart - 1;
  const maximumYear = currentStart + 1;

  if (item.keyDates?.length && (contentType === "event" || (!item.publishedAt && !item.publishedDate))) {
    const mostRecent = item.keyDates.reduce<string | undefined>((latest, keyDate) => {
      const candidate = keyDate.endDate ?? keyDate.startDate;
      return !latest || candidate > latest ? candidate : latest;
    }, undefined);
    if (mostRecent) {
      const eventDate = dateOnlyAtNoon(mostRecent);
      return Boolean(
        eventDate
        && eventDate.getTime() >= oneYearBefore(checkedAt).getTime()
        && eventDate.getUTCFullYear() <= maximumYear
      );
    }
  }

  const publication = item.publicationKind === "date" && item.publishedDate
    ? dateOnlyAtNoon(item.publishedDate)
    : item.publishedAt ? strictReferenceDate(item.publishedAt) : null;
  if (publication) return publication.getTime() >= oneYearBefore(checkedAt).getTime();

  const values = [
    item.title,
    item.link,
    item.summary,
    ...(item.body ?? []).map((block) => block.text),
  ].filter((value): value is string => Boolean(value));
  const academicYears = extractAcademicYears(values);
  const years = extractYears(values);
  if (academicYears.length > 0) {
    return academicYears.some((year) => year >= minimumYear && year <= currentStart);
  }
  return years.length === 0 || years.some((year) => year >= minimumYear && year <= maximumYear);
}

function extractAcademicYears(values: readonly string[]): number[] {
  const years = new Set<number>();
  for (const value of values) {
    const folded = fold(value);
    for (const match of folded.matchAll(/(20\d{2})\s*[-_/]\s*(20\d{2})/gu)) {
      const left = Number(match[1]);
      const right = Number(match[2]);
      if (Number.isInteger(left) && Number.isInteger(right) && Math.abs(left - right) === 1) {
        years.add(Math.min(left, right));
      }
    }
    for (const match of folded.matchAll(/\b(20\d{2})(20\d{2})\b/gu)) {
      const left = Number(match[1]);
      const right = Number(match[2]);
      if (Number.isInteger(left) && Number.isInteger(right) && Math.abs(left - right) === 1) {
        years.add(Math.min(left, right));
      }
    }
  }
  return [...years];
}

function extractYears(values: readonly string[]): number[] {
  const years = new Set<number>();
  for (const value of values) {
    for (const match of fold(value).matchAll(/\b(20\d{2})\b/gu)) {
      const year = Number(match[1]);
      if (Number.isInteger(year)) years.add(year);
    }
  }
  return [...years];
}

function oneYearBefore(value: Date): Date {
  const result = new Date(value);
  result.setUTCFullYear(result.getUTCFullYear() - 1);
  return result;
}

function dateOnlyAtNoon(value: string): Date | null {
  if (!isRealDate(value)) return null;
  return new Date(`${value}T12:00:00.000Z`);
}

function strictReferenceDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? date : null;
}

function assertRecipe(recipe: DeviceSourceRuntimeRecipe): void {
  const source = canonicalUrl(recipe.sourceUrl);
  if (
    !source
    || new URL(source).protocol !== "https:"
    || officialDomain(source) !== recipe.allowedOfficialDomain
    || !strictReferenceDate(recipe.checkedAt)
    || !["announcement", "news", "event"].includes(recipe.contentType)
    || !["auto", "rss", "html"].includes(recipe.parser)
  ) throw runtimeError("SOURCE_RUNTIME_RECIPE_INVALID");
}

function assertTransportResponse(
  response: DeviceSourceRuntimeResponse,
  recipe: DeviceSourceRuntimeRecipe,
  profile: DeviceSourceRuntimeProfile,
): void {
  if (response.status === 304) return;
  if (response.status < 200 || response.status >= 300) throw runtimeError("SOURCE_RUNTIME_REQUEST_FAILED");
  const final = canonicalUrl(response.finalUrl);
  if (!final || new URL(final).protocol !== "https:" || officialDomain(final) !== recipe.allowedOfficialDomain) {
    throw runtimeError("SOURCE_RUNTIME_REDIRECT_REJECTED");
  }
  const media = response.contentType?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US");
  const json = media === "application/json" || media === "text/json";
  const html = media === "text/html" || media === "application/xhtml+xml";
  const generic = json || html || media === "application/xml" || media === "text/xml"
    || media === "application/rss+xml" || media === "application/atom+xml" || media === "text/plain";
  if (
    !media
    || ((profile === "ankara_cms" || profile === "nku_event" || profile === "bayburt_media" || profile === "atu_odata" || profile === "ktun_event") && !json)
    || ((profile === "alanya_event" || profile === "ktun_news" || profile === "bandirma_event" || profile === "ege_listing") && !html)
    || (!generic && !["ankara_cms", "nku_event", "bayburt_media", "atu_odata", "alanya_event", "ktun_news", "ktun_event", "bandirma_event", "ege_listing"].includes(profile))
  ) throw runtimeError("SOURCE_RUNTIME_MEDIA_TYPE_REJECTED");
}

function fetchedSnapshot(
  response: DeviceSourceRuntimeResponse,
  profile: DeviceSourceRuntimeProfile,
  items: DeviceSourceRuntimeItem[],
): DeviceSourceRuntimeSnapshot {
  return {
    items: items.slice(0, MAX_ITEMS),
    finalUrl: response.finalUrl,
    fetchStatus: "fetched",
    ...(response.etag ? { etag: response.etag } : {}),
    ...(response.lastModified ? { lastModified: response.lastModified } : {}),
    profile,
  };
}

function notModifiedSnapshot(
  response: DeviceSourceRuntimeResponse,
  profile: DeviceSourceRuntimeProfile,
): DeviceSourceRuntimeSnapshot {
  return {
    items: [],
    finalUrl: response.finalUrl,
    fetchStatus: "not_modified",
    ...(response.etag ? { etag: response.etag } : {}),
    ...(response.lastModified ? { lastModified: response.lastModified } : {}),
    profile,
  };
}

function describeAtuSource(source: URL): { groupType: 1 | 2 | 4; routeName: "haber" | "duyuru" | "etkinlik"; siteAlias: string } | null {
  if (source.protocol !== "https:" || (source.hostname !== "atu.edu.tr" && !source.hostname.endsWith(".atu.edu.tr"))) return null;
  const route = decodeURIComponent(source.hash).toLocaleLowerCase("tr-TR");
  const type = route.includes("/duyurular")
    ? { groupType: 2 as const, routeName: "duyuru" as const }
    : route.includes("/haberler")
      ? { groupType: 1 as const, routeName: "haber" as const }
      : route.includes("/etkinlikler")
        ? { groupType: 4 as const, routeName: "etkinlik" as const }
        : null;
  if (!type) return null;
  const first = source.hostname.split(".")[0]?.toLocaleLowerCase("en-US");
  return { ...type, siteAlias: !first || first === "atu" ? "www" : first };
}

function describeAnkaraCmsSource(source: URL, contentType: DeviceSourceRuntimeContentType) {
  if (source.hostname !== "ubys.ankara.edu.tr" || !source.pathname.startsWith("/api/CMS/")) return null;
  const expected = source.pathname === "/api/CMS/GetMainNews"
    ? { contentType: "news" as const, publicRoute: "haber" as const }
    : source.pathname === "/api/CMS/GetMainevents"
      ? { contentType: "event" as const, publicRoute: "etkinlik" as const }
      : null;
  const keys = ["Page", "PageSize", "websiteId", "languageCode"];
  if (
    source.protocol !== "https:"
    || !expected
    || expected.contentType !== contentType
    || [...source.searchParams].length !== keys.length
    || keys.some((key) => source.searchParams.getAll(key).length !== 1)
    || !/^\d+$/u.test(source.searchParams.get("Page") ?? "")
    || !/^(?:[1-9]|[12]\d|30)$/u.test(source.searchParams.get("PageSize") ?? "")
    || source.searchParams.get("websiteId") !== "1"
    || source.searchParams.get("languageCode") !== "tr-TR"
  ) throw runtimeError("SOURCE_LAYOUT_INVALID:ANKARA_CMS");
  return expected;
}

function assertNkuSource(source: URL, recipe: DeviceSourceRuntimeRecipe): void {
  if (
    source.protocol !== "https:"
    || source.hostname !== "bhi.nku.edu.tr"
    || source.pathname !== "/json/nku.json2.php"
    || source.search !== "?sid="
    || source.hash
    || recipe.contentType !== "event"
    || recipe.parser !== "auto"
  ) throw runtimeError("SOURCE_LAYOUT_INVALID:NKU_EVENT");
}

function assertBayburtSource(source: URL, recipe: DeviceSourceRuntimeRecipe): void {
  const route = source.pathname.match(/^\/api\/web\/department\/medyalist\/(?:tr|en)\/(haber|etkinlik)\/\d+$/u)?.[1];
  if (
    source.protocol !== "https:"
    || source.hostname !== "apiportal.bayburt.edu.tr"
    || !route
    || recipe.contentType !== (route === "haber" ? "news" : "event")
    || recipe.parser !== "auto"
  ) throw runtimeError("SOURCE_LAYOUT_INVALID:BAYBURT_MEDIA");
}

function assertKtunSource(source: URL, recipe: DeviceSourceRuntimeRecipe): void {
  if (!isExactSource(source, "www.ktun.edu.tr", "/tr/Universite/TumHaberler", recipe.contentType, "news") || recipe.parser !== "auto") {
    throw runtimeError("SOURCE_LAYOUT_INVALID:KTUN_NEWS");
  }
}

function assertBandirmaSource(source: URL, recipe: DeviceSourceRuntimeRecipe): void {
  const segments = source.pathname.split("/").filter(Boolean);
  if (
    source.protocol !== "https:"
    || recipe.contentType !== "event"
    || recipe.parser !== "auto"
    || segments.length !== 4
    || fold(segments[2] ?? "") !== "etkinlik"
    || fold(segments[3] ?? "") !== "liste"
  ) throw runtimeError("SOURCE_LAYOUT_INVALID:BANDIRMA_EVENT");
}

function isExactSource(source: URL, host: string, path: string, actualType: string, expectedType: string): boolean {
  if (source.hostname !== host || source.pathname !== path) return false;
  if (source.protocol !== "https:" || source.hash || actualType !== expectedType) {
    throw runtimeError(`SOURCE_LAYOUT_INVALID:${expectedType === "event" ? "ALANYA_EVENT" : "SOURCE"}`);
  }
  return true;
}

function readAnkaraEventDates(record: Record<string, unknown>): DeviceSourceRuntimeItem["keyDates"] {
  const start = readIsoTimestamp(asString(record.eventDateTime));
  const end = record.eventEndDateTime == null ? undefined : readIsoTimestamp(asString(record.eventEndDateTime));
  if (!start || (record.eventEndDateTime != null && !end)) throw runtimeError("SOURCE_LAYOUT_INVALID:ANKARA_CMS");
  const startDate = istanbulDate(start);
  const endDate = end && end >= start ? istanbulDate(end) : undefined;
  return [{ label: "Etkinlik tarihi", startDate, ...(endDate && endDate !== startDate ? { endDate } : {}) }];
}

function isNkuSentinel(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "date,description,title,type,url") return false;
  return value.url === "/"
    && typeof value.description === "string"
    && Boolean(readCalendarTimestamp(value.date))
    && fold(asString(value.type)) === "baslangic"
    && fold(asString(value.title)).includes("giris");
}

function readCalendarTimestamp(value: unknown): { date: string; value: string } | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(20\d{2})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u);
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5] || !match[6]) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (!isRealDate(date) || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return null;
  return { date, value };
}

function readPublication(value: string | undefined, allowRfcDate: boolean): Partial<DeviceSourceRuntimeItem> {
  const normalized = normalizeText(value);
  if (/^\d{4}-\d{2}-\d{2}T/u.test(normalized)) {
    const timestamp = readIsoTimestamp(normalized);
    return timestamp ? { publicationKind: "timestamp", publishedAt: timestamp } : {};
  }
  const dateOnly = readDateOnly(normalized);
  if (dateOnly) return { publicationKind: "date", publishedDate: dateOnly };
  if (!normalized || !allowRfcDate) return {};
  const timestamp = readIsoTimestamp(normalized);
  return timestamp ? { publicationKind: "timestamp", publishedAt: timestamp } : {};
}

function readDateOnly(value: string): string | null {
  const normalized = normalizeText(value);
  const iso = normalized.match(/(?:^|\D)(\d{4})-(\d{1,2})-(\d{1,2})(?:\D|$)/u);
  if (iso) return validDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = normalized.match(/(?:^|\D)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\D|$)/u);
  if (numeric) return validDateParts(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  const named = fold(normalized).match(/(?:^|\D)(\d{1,2})\s*([a-z]+)\.?\s*(\d{4})(?:\D|$)/u);
  const month = named && NAMED_MONTHS[named[2]!];
  if (named && month) return validDateParts(Number(named[3]), month, Number(named[1]));
  const monthFirst = fold(normalized).match(/(?:^|[^a-z])([a-z]+)\.?\s*(\d{1,2})(?:\s*,\s*|\s+)(\d{4})(?:\D|$)/u);
  const leadingMonth = monthFirst && NAMED_MONTHS[monthFirst[1]!];
  return monthFirst && leadingMonth ? validDateParts(Number(monthFirst[3]), leadingMonth, Number(monthFirst[2])) : null;
}

function validDateParts(year: number, month: number, day: number): string | null {
  const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isRealDate(date) ? date : null;
}

function readIsoTimestamp(value: string): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function readDotNetDate(value: string, checkedAt: Date): string | null {
  const milliseconds = Number(value.match(/\/Date\((-?\d+)/u)?.[1]);
  const maximum = checkedAt.getTime() + 3 * 365 * 24 * 60 * 60 * 1_000;
  return Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds <= maximum
    ? new Date(milliseconds).toISOString()
    : null;
}

function previousDate(value: string): string | null {
  if (!isRealDate(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function istanbulDate(value: string): string {
  const timestamp = Date.parse(value);
  // IANA: Istanbul stays at UTC+3 from 2016-09-07 local midnight; old Android tzdata still applies DST.
  // https://data.iana.org/time-zones/tzdb/europe
  if (timestamp >= Date.parse("2016-09-07T00:00:00+03:00")) {
    return new Date(timestamp + 3 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isRealDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function resolveTrustedUrl(value: string | undefined, recipe: DeviceSourceRuntimeRecipe, base = recipe.sourceUrl): string | null {
  if (!value?.trim()) return null;
  const canonical = canonicalUrl(value, base);
  if (!canonical || new URL(canonical).protocol !== "https:" || officialDomain(canonical) !== recipe.allowedOfficialDomain) return null;
  return canonical;
}

function canonicalUrl(value: string, base?: string): string | null {
  try {
    const url = base ? new URL(decodeEntities(value).trim(), base) : new URL(decodeEntities(value).trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || !url.hostname) return null;
    if (url.port && url.port !== "80" && url.port !== "443") return null;
    url.hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/u, "");
    if (/^(?:localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2})$/u.test(url.hostname)) return null;
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/iu.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/{2,}/gu, "/");
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/gu, "");
    if (!url.hash.startsWith("#!")) url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function officialDomain(value: string): string | null {
  const canonical = canonicalUrl(value);
  if (!canonical) return null;
  const labels = new URL(canonical).hostname.replace(/^www\./u, "").split(".").filter(Boolean);
  if (labels.length < 3 || !["edu.tr", "gov.tr"].includes(labels.slice(-2).join("."))) return null;
  return labels.slice(-3).join(".");
}

function isListingNavigationUrl(candidate: string, sourceUrl: string): boolean {
  const candidateUrl = new URL(candidate);
  const source = canonicalUrl(sourceUrl);
  if (source && canonicalUrl(candidate) === source) return true;
  const path = candidateUrl.pathname.replace(/\/+$/u, "") || "/";
  return (path === "/" && !candidateUrl.hash.startsWith("#!/"))
    || isErrorPageUrl(candidate)
    || /(?:^|\/)(?:author|yazar|category|tag|etiket)(?:\/|$)/iu.test(path)
    || candidateUrl.searchParams.has("author")
    || /\/(?:duyuru[-_]?arsiv|arsiv|archive|archives)$/iu.test(path)
    || /\/date\/20\d{2}\/(?:0?[1-9]|1[0-2])$/iu.test(path)
    || /(?:^|\/)(?:duyuru|haber|etkinlik)\/(?:liste|index(?:\.html?)?)$/iu.test(path)
    || /(?:^|\/)(?:duyurular|haberler|etkinlikler|announcements|events|news)$/iu.test(path);
}

function isErrorPageUrl(value: string): boolean {
  const path = new URL(value).pathname;
  return /(?:^|\/)(?:hata|error|errors)(?:\/|\.|$)/iu.test(path)
    || /^\/(?:404|403)(?:\/|\.|$)/u.test(path);
}

function isNavigationTitle(value: string): boolean {
  const title = fold(value).replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "");
  return !/[\p{L}\p{N}]/u.test(title)
    || /^(?:next|previous|home|read more|click here|devami(?:ni oku)?|onceki|sonraki|menu|ana ?sayfa|t[ıi]klay[ıi]n[ıi]z|detay|ayrinti|arsiv)$/u.test(title)
    || /^(?:duyuru(?:lar)?|haber(?:ler)?|etkinlik(?:ler)?|announcement(?:s)?|news|event(?:s)?)$/u.test(title)
    || /^(?:tum (?:duyurular|haberler|etkinlikler)|all (?:announcements|news|events))$/u.test(title)
    || /^(?:bugun|today|goruntule|yeni gorunum|yeni tasarima gec|etkinlik takvimi)$/u.test(title)
    || /^(?:sayfa\s+)?\d+(?:\s*\/\s*\d+)?$/u.test(title);
}

function normalizeText(value: string | undefined): string {
  if (!value) return "";
  return decodeEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) => safeCodePoint(code, 16))
    .replace(/&#(\d+);/gu, (_match, code: string) => safeCodePoint(code, 10))
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/giu, (_match, name: string) => ({
      amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " ",
    }[name.toLocaleLowerCase("en-US")] ?? " "));
}

function safeCodePoint(value: string, radix: number): string {
  const code = Number.parseInt(value, radix);
  try {
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
  } catch {
    return " ";
  }
}

function fold(value: string): string {
  return normalizeText(value).toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function parseJson(value: string, error: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw runtimeError(error);
  }
}

function parseODataRows(value: string): Array<Record<string, unknown>> {
  const payload = parseJson(value, "SOURCE_LAYOUT_INVALID:ATU_ODATA");
  if (!isRecord(payload) || !Array.isArray(payload.d) || payload.d.length > 2_000 || !payload.d.every(isRecord)) {
    throw runtimeError("SOURCE_LAYOUT_INVALID:ATU_ODATA");
  }
  return payload.d;
}

function odataUrl(entity: string, parameters: Record<string, string>): string {
  const url = new URL(`${ATU_ODATA_BASE_URL}/${entity}`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url.toString();
}

function firstHtmlHref(value: string): string | undefined {
  return value.match(/<a\b[^>]*href=["']([^"']+)["']/iu)?.[1];
}

function collectJsonRecords(value: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 8) return [];
  if (Array.isArray(value)) return value.filter(isRecord).slice(0, MAX_CANDIDATES);
  if (!isRecord(value)) return [];
  const keys = ["items", "data", "results", "value", "announcements", "news", "events", "duyurular", "entries", "response", "payload", "d"];
  for (const key of keys) {
    if (!(key in value)) continue;
    const nested = collectJsonRecords(value[key], depth + 1);
    if (nested.length > 0 || Array.isArray(value[key])) return nested;
  }
  return firstValue(value, ["title", "name", "headline", "subject", "baslik", "başlık"]) ? [value] : [];
}

function firstValue(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const [key, value] of Object.entries(record)) {
    if (!keys.some((candidate) => fold(candidate) === fold(key))) continue;
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) return String(value);
    if (isRecord(value) && typeof value.rendered === "string") return value.rendered;
  }
  return undefined;
}

function optionalText(record: Record<string, unknown>, key: string, error: string): string | undefined {
  const value = record[key];
  if (value == null) return undefined;
  if (typeof value !== "string") throw runtimeError(error);
  return normalizeText(value) || undefined;
}

function dedupe(items: readonly DeviceSourceRuntimeItem[]): DeviceSourceRuntimeItem[] {
  return [...new Map(items.map((item) => [item.link.toLocaleLowerCase("en-US"), item])).values()].slice(0, MAX_ITEMS);
}

function asString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function runtimeError(message: string): Error {
  const error = new Error(message);
  error.name = "DeviceSourceRuntimeError";
  return error;
}

function isRuntimeError(value: unknown): boolean {
  return value instanceof Error && value.name === "DeviceSourceRuntimeError";
}
