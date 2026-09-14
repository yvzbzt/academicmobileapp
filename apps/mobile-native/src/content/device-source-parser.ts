import { load } from "cheerio/slim";
import {
  canonicalizeOfficialAcademicUrl,
  isNavigationContentTitle,
  normalizeDisplayText,
  officialDomainForUrl,
  type MobileContentRecordInput,
} from "./content-trust";
import type { DeviceContentSource } from "./device-source-manifest";

const MAX_PARSED_ITEMS = 60;
const JSON_COLLECTION_KEYS = ["items", "data", "results", "announcements", "news", "events"] as const;
const TURKISH_MONTHS: Readonly<Record<string, number>> = {
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
};

export function parseDeviceSourceDocument(
  input: string,
  source: DeviceContentSource,
  fetchedAt = new Date(),
): MobileContentRecordInput[] {
  const body = input.trim();
  if (!body) return [];
  if (source.parser === "rss" || (source.parser === "auto" && /^<\?xml\b|^<(?:rss|feed)\b/iu.test(body))) {
    return parseSyndicatedDocument(body, source, fetchedAt);
  }
  if (source.parser === "auto" && /^[\[{]/u.test(body)) {
    const parsed = parseJsonDocument(body, source, fetchedAt);
    if (parsed.length > 0) return parsed;
  }
  return source.parserConfig?.itemSelector
    ? parseConfiguredHtml(body, source, fetchedAt)
    : parseGenericHtml(body, source, fetchedAt);
}

function parseConfiguredHtml(
  input: string,
  source: DeviceContentSource,
  fetchedAt: Date,
): MobileContentRecordInput[] {
  try {
    const $ = load(input);
    const config = source.parserConfig!;
    const records: MobileContentRecordInput[] = [];
    $(config.itemSelector!).slice(0, MAX_PARSED_ITEMS * 3).each((_index, element) => {
      const row = $(element);
      const linkElement = config.linkSelector ? row.find(config.linkSelector).first() : row.find("a[href]").first();
      const titleElement = config.titleSelector ? row.find(config.titleSelector).first() : linkElement;
      const record = createRecord(source, {
        title: titleElement.text() || titleElement.attr("title") || linkElement.attr("title"),
        link: linkElement.attr("href"),
        date: config.dateSelector ? row.find(config.dateSelector).first().attr("datetime") || row.find(config.dateSelector).first().text() : undefined,
        summary: config.contentSelector ? row.find(config.contentSelector).first().text() : undefined,
      }, fetchedAt);
      if (record) records.push(record);
    });
    return dedupeRecords(records).slice(0, MAX_PARSED_ITEMS);
  } catch {
    return [];
  }
}

function parseGenericHtml(
  input: string,
  source: DeviceContentSource,
  fetchedAt: Date,
): MobileContentRecordInput[] {
  try {
    const $ = load(input);
    const preferred = "article a[href], main .duyuru a[href], main .announcement a[href], main .haber a[href], main .news a[href], main .etkinlik a[href], main .event a[href]";
    const candidates = $(preferred).length > 0 ? $(preferred) : $("main a[href], a[href]");
    const records: MobileContentRecordInput[] = [];
    candidates.slice(0, MAX_PARSED_ITEMS * 8).each((_index, element) => {
      const link = $(element);
      const row = link.closest("article, li, tr, .duyuru, .announcement, .haber, .news, .etkinlik, .event");
      const time = row.find("time").first();
      const record = createRecord(source, {
        title: link.attr("title") || link.text(),
        link: link.attr("href"),
        date: time.attr("datetime") || time.text(),
        summary: row.find("p").first().text(),
      }, fetchedAt);
      if (record) records.push(record);
    });
    return dedupeRecords(records).slice(0, MAX_PARSED_ITEMS);
  } catch {
    return [];
  }
}

function parseSyndicatedDocument(
  input: string,
  source: DeviceContentSource,
  fetchedAt: Date,
): MobileContentRecordInput[] {
  try {
    const $ = load(input, { xmlMode: true });
    const records: MobileContentRecordInput[] = [];
    $("item, entry").slice(0, MAX_PARSED_ITEMS * 2).each((_index, element) => {
      const row = $(element);
      const link = row.find("link").first();
      const record = createRecord(source, {
        title: row.find("title").first().text(),
        link: link.attr("href") || link.text() || row.find("guid").first().text(),
        date: row.find("pubDate, published, updated, date").first().text(),
        summary: row.find("description, summary, content\\:encoded, content").first().text(),
      }, fetchedAt, true);
      if (record) records.push(record);
    });
    return dedupeRecords(records).slice(0, MAX_PARSED_ITEMS);
  } catch {
    return [];
  }
}

function parseJsonDocument(
  input: string,
  source: DeviceContentSource,
  fetchedAt: Date,
): MobileContentRecordInput[] {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return [];
  }
  const candidates = findJsonRecords(value);
  const records = candidates.map((candidate) => createRecord(source, {
    title: firstString(candidate, ["title", "name", "headline", "subject"]),
    link: firstString(candidate, ["link", "url", "href", "permalink", "detailUrl"]),
    date: firstString(candidate, ["publishedAt", "publishedDate", "date", "createdAt", "updatedAt"]),
    summary: firstString(candidate, ["summary", "description", "excerpt", "content", "body"]),
  }, fetchedAt, true)).filter((record): record is MobileContentRecordInput => record !== null);
  return dedupeRecords(records).slice(0, MAX_PARSED_ITEMS);
}

function createRecord(
  source: DeviceContentSource,
  candidate: { title?: string; link?: string; date?: string; summary?: string },
  fetchedAt: Date,
  allowRfcDate = false,
): MobileContentRecordInput | null {
  const title = normalizeDisplayText(candidate.title);
  if (!title || isNavigationContentTitle(title) || isDeviceNavigationTitle(title)) return null;
  const canonicalUrl = resolveSourceUrl(candidate.link, source);
  if (!canonicalUrl) return null;
  const summary = normalizeDisplayText(candidate.summary).slice(0, 1_200);
  const publication = readPublication(candidate.date, allowRfcDate);
  return {
    id: `device-${source.id}-${stableTextHash(canonicalUrl)}`,
    sourceId: source.id,
    sourceName: source.sourceName,
    contentType: source.contentType,
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    title,
    link: canonicalUrl,
    canonicalUrl,
    officialSourceUrl: source.sourceUrl,
    sourceRelationships: [{
      sourceId: source.id,
      sourceName: source.sourceName,
      officialSourceUrl: source.sourceUrl,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      canonicalUrl,
    }],
    fetchedAt: fetchedAt.toISOString(),
    ...(summary ? { summary, body: [{ type: "paragraph", text: summary }] } : {}),
    ...publication,
    freshness: "fresh",
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
  };
}

function resolveSourceUrl(value: string | undefined, source: DeviceContentSource): string | null {
  if (!value?.trim()) return null;
  let absolute: string;
  try {
    absolute = new URL(value.trim(), source.sourceUrl).toString();
  } catch {
    return null;
  }
  const canonical = canonicalizeOfficialAcademicUrl(absolute);
  if (!canonical) return null;
  return officialDomainForUrl(canonical) === officialDomainForUrl(source.sourceUrl)
    ? canonical
    : null;
}

function readPublication(value: string | undefined, allowRfcDate: boolean): Partial<MobileContentRecordInput> {
  const normalized = normalizeDisplayText(value);
  const dateOnly = readPublicationDateOnly(normalized);
  if (dateOnly && isRealDateOnly(dateOnly)) return { publicationKind: "date", publishedDate: dateOnly };
  if (!normalized || (!allowRfcDate && !/^\d{4}-\d{2}-\d{2}T/u.test(normalized))) return {};
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? { publicationKind: "timestamp", publishedAt: new Date(timestamp).toISOString() } : {};
}

function readPublicationDateOnly(value: string): string | null {
  const iso = value.match(/(?:^|\D)(\d{4})-(\d{1,2})-(\d{1,2})(?:\D|$)/u);
  if (iso) return dateOnly(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = value.match(/(?:^|\D)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\D|$)/u);
  if (numeric) return dateOnly(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  const named = foldTurkish(value).match(/(?:^|\D)(\d{1,2})\s+(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\s+(\d{4})(?:\D|$)/u);
  return named ? dateOnly(Number(named[3]), TURKISH_MONTHS[named[2]!]!, Number(named[1])) : null;
}

function dateOnly(year: number, month: number, day: number): string | null {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isRealDateOnly(value) ? value : null;
}

function foldTurkish(value: string): string {
  return value.toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "");
}

function isRealDateOnly(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function findJsonRecords(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) {
    return value.filter(isRecord).slice(0, MAX_PARSED_ITEMS * 3);
  }
  if (!isRecord(value)) return [];
  for (const key of JSON_COLLECTION_KEYS) {
    const nested = value[key];
    const records = findJsonRecords(nested, depth + 1);
    if (records.length > 0) return records;
  }
  return firstString(value, ["title", "name", "headline", "subject"]) ? [value] : [];
}

function firstString(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key];
  }
  return undefined;
}

function dedupeRecords(records: readonly MobileContentRecordInput[]): MobileContentRecordInput[] {
  return [...new Map(records.map((record) => [record.canonicalUrl ?? record.link, record])).values()];
}

function stableTextHash(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

function isDeviceNavigationTitle(value: string): boolean {
  return /^(?:next|previous|home|read more|all (?:announcements|news|events))$/iu.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
