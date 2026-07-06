import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { isFreshAcademicContent } from "../../domain/temporal-freshness.js";
import type { AnnouncementItem, AnnouncementSourceParser, AnnouncementSourceRecord } from "./announcements.types.js";

ensureCrawlerSystemCa();

export interface ParsedAnnouncementItem {
  title: string;
  link: string;
  publishedAt?: Date;
  summary?: string;
}

export async function fetchSourceItems(sourceUrl: string, parser: AnnouncementSourceParser, timeoutMs = 7000): Promise<ParsedAnnouncementItem[]> {
  const body = await fetchText(sourceUrl, timeoutMs, { accept: "text/html,application/json,application/rss+xml,application/xml;q=0.9,*/*;q=0.8" });
  if (parser === "auto" && looksLikeJson(body.text)) return parseJsonAnnouncements(body.text, body.finalUrl).slice(0, 30);
  const resolvedParser = parser === "auto" ? (looksLikeXmlFeed(body.text) ? "rss" : "html") : parser;
  if (resolvedParser === "rss") return parseRssOrAtom(body.text).slice(0, 30);
  return parseHtmlAnchors(body.text, body.finalUrl).slice(0, 30);
}

export async function fetchText(sourceUrl: string, timeoutMs = 7000, input: { accept?: string } = {}): Promise<{ text: string; finalUrl: string; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      headers: {
        Accept: input.accept ?? "text/html,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.7,en;q=0.6",
        "User-Agent": crawlerUserAgent
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`SOURCE_FETCH_FAILED:${response.status}`);
    return { text: await response.text(), finalUrl: response.url || sourceUrl, status: response.status };
  } catch (error) {
    if (isHttpFetchStatusError(error)) throw error;
    try {
      return await fetchTextWithNodeClient(sourceUrl, timeoutMs, input, 0, false);
    } catch (nodeError) {
      if (shouldRetryWithInvalidTls(sourceUrl, error) || shouldRetryWithInvalidTls(sourceUrl, nodeError)) return fetchTextWithNodeClient(sourceUrl, timeoutMs, input, 0, true);
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
}

function isHttpFetchStatusError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("SOURCE_FETCH_FAILED:");
}

export function toAnnouncementItems(source: AnnouncementSourceRecord, parsedItems: ParsedAnnouncementItem[], fetchedAt = new Date()): AnnouncementItem[] {
  return dedupeAnnouncements(parsedItems
    .filter((item) => isFreshAcademicContent({ title: item.title, url: item.link, publishedAt: item.publishedAt, fetchedAt }).accepted)
    .map((item) => ({
      id: createAnnouncementId(source.id, item.link, item.title),
      sourceId: source.id,
      sourceName: source.sourceName,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      title: item.title,
      link: item.link,
      publishedAt: (item.publishedAt ?? fetchedAt).toISOString(),
      ...(item.summary ? { summary: item.summary } : {}),
      fetchedAt: fetchedAt.toISOString()
    })));
}

export function parseHtmlAnchors(input: string, sourceUrl: string): ParsedAnnouncementItem[] {
  const anchors = [...input.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const results: ParsedAnnouncementItem[] = [];

  for (const anchor of anchors) {
    const href = cleanText(anchor[1]);
    const title = cleanText(stripHtml(anchor[2] ?? ""));
    if (!href || !title || title.length < 6 || isLowValueAnchorTitle(title)) continue;

    const normalizedLink = toAbsoluteUrl(href, sourceUrl);
    if (!normalizedLink) continue;

    if (!containsAnnouncementHint(title, normalizedLink)) continue;
    const publishedAt = parseDateMaybe(title);
    if (!isFreshAcademicContent({ title, url: normalizedLink, publishedAt }).accepted) continue;
    results.push({ title, link: normalizedLink, ...(publishedAt ? { publishedAt } : {}) });
    if (results.length >= 80) break;
  }

  return dedupeParsedItems(results);
}

export function containsAnnouncementHint(title: string, link: string): boolean {
  const haystack = `${title} ${link}`.toLocaleLowerCase("tr-TR");
  return ["duyuru", "duyurular", "announcement", "announcements", "ilan", "haber", "news", "notice", "exam", "sinav", "sınav"].some((hint) => haystack.includes(hint));
}

export function createAnnouncementId(sourceId: string, link: string, title: string): string {
  return createHash("sha1").update(`${sourceId}|${link}|${title}`).digest("hex").slice(0, 20);
}

export function dedupeAnnouncements(items: AnnouncementItem[]): AnnouncementItem[] {
  const unique = new Map<string, AnnouncementItem>();
  for (const item of items) {
    const key = item.link.toLocaleLowerCase("en-US");
    if (!unique.has(key)) {
      unique.set(key, item);
      continue;
    }

    const existing = unique.get(key);
    const existingTime = existing?.publishedAt ? Date.parse(existing.publishedAt) : 0;
    const nextTime = item.publishedAt ? Date.parse(item.publishedAt) : 0;
    if (nextTime > existingTime) unique.set(key, item);
  }
  return [...unique.values()];
}

export function cleanText(input?: string): string {
  if (!input) return "";
  return decodeHtmlEntities(input).replace(/\s+/g, " ").trim();
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

const crawlerUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 AcademicCalendarAnnouncementCrawler/1.0";

function looksLikeXmlFeed(input: string): boolean {
  const text = input.toLocaleLowerCase("en-US");
  return text.includes("<rss") || text.includes("<feed") || text.includes("<channel");
}

function looksLikeJson(input: string): boolean {
  const text = input.trimStart();
  return text.startsWith("{") || text.startsWith("[");
}

function parseRssOrAtom(input: string): ParsedAnnouncementItem[] {
  const rssItems = [...input.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map((match) => parseRssItem(match[0]))
    .filter((item): item is ParsedAnnouncementItem => Boolean(item));

  const atomItems = [...input.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)]
    .map((match) => parseAtomEntry(match[0]))
    .filter((item): item is ParsedAnnouncementItem => Boolean(item));

  return dedupeParsedItems([...rssItems, ...atomItems]);
}

function parseRssItem(input: string): ParsedAnnouncementItem | null {
  const title = cleanText(extractTagValue(input, "title"));
  const link = cleanText(extractTagValue(input, "link"));
  if (!title || !link) return null;

  const published = cleanText(extractTagValue(input, "pubDate"));
  const summary = cleanText(extractTagValue(input, "description"));
  const publishedAt = published ? parseDateMaybe(published) : undefined;

  return {
    title,
    link,
    ...(publishedAt ? { publishedAt } : {}),
    ...(summary ? { summary } : {})
  };
}

function parseAtomEntry(input: string): ParsedAnnouncementItem | null {
  const title = cleanText(extractTagValue(input, "title"));
  const linkFromHref = input.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  const link = cleanText(linkFromHref ?? extractTagValue(input, "link"));
  if (!title || !link) return null;

  const published = cleanText(extractTagValue(input, "updated") ?? extractTagValue(input, "published"));
  const summary = cleanText(extractTagValue(input, "summary") ?? extractTagValue(input, "content"));
  const publishedAt = published ? parseDateMaybe(published) : undefined;

  return {
    title,
    link,
    ...(publishedAt ? { publishedAt } : {}),
    ...(summary ? { summary } : {})
  };
}

function extractTagValue(input: string, tagName: string): string | undefined {
  const match = input.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  if (!match?.[1]) return undefined;
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function parseDateMaybe(input: string): Date | undefined {
  const leadingNumericDate = input.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/u);
  if (leadingNumericDate?.[1] && leadingNumericDate[2] && leadingNumericDate[3]) {
    return new Date(Date.UTC(Number(leadingNumericDate[3]), Number(leadingNumericDate[2]) - 1, Number(leadingNumericDate[1])));
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
  return new Date(Date.UTC(Number(match[3]), month - 1, Number(match[1])));
}

function toAbsoluteUrl(candidate: string, base: string): string | null {
  try {
    if (candidate.startsWith("mailto:") || candidate.startsWith("tel:") || candidate.startsWith("javascript:")) return null;
    return new URL(candidate, base).toString();
  } catch {
    return null;
  }
}

function isLowValueAnchorTitle(title: string): boolean {
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

function stripHtml(input: string): string {
  return input.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function dedupeParsedItems(items: ParsedAnnouncementItem[]): ParsedAnnouncementItem[] {
  const unique = new Map<string, ParsedAnnouncementItem>();
  for (const item of items) {
    const key = item.link.toLocaleLowerCase("en-US");
    if (!unique.has(key)) unique.set(key, item);
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
  const title = readJsonText(value, ["title", "baslik", "başlık", "name", "subject", "headline"]);
  const link = readJsonText(value, ["link", "url", "href", "permalink", "slug"]);
  const summary = readJsonText(value, ["summary", "description", "excerpt", "ozet", "özet", "icerik", "içerik"]);
  const published = readJsonText(value, ["publishedAt", "publishDate", "pubDate", "date", "createdAt", "baslamaTarihi", "BaşlamaTarihi"]);
  const absoluteLink = link ? toAbsoluteUrl(link, sourceUrl) : null;

  if (title && absoluteLink && (containsAnnouncementHint(title, absoluteLink) || containsAnnouncementHint("", sourceUrl))) {
    const publishedAt = published ? parseDateMaybe(published) : undefined;
    if (isFreshAcademicContent({ title, url: absoluteLink, text: summary, publishedAt }).accepted) {
      output.push({
        title,
        link: absoluteLink,
        ...(publishedAt ? { publishedAt } : {}),
        ...(summary ? { summary } : {})
      });
    }
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

function readJsonText(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const [key, value] of Object.entries(record)) {
    if (!keys.some((candidate) => candidate.toLocaleLowerCase("tr-TR") === key.toLocaleLowerCase("tr-TR"))) continue;
    if (typeof value === "string" || typeof value === "number") return cleanText(String(value).replace(/<[^>]+>/g, " "));
    if (isJsonRecord(value)) {
      const rendered = value.rendered;
      if (typeof rendered === "string") return cleanText(rendered.replace(/<[^>]+>/g, " "));
    }
  }
  return undefined;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function fetchTextWithNodeClient(sourceUrl: string, timeoutMs: number, input: { accept?: string }, redirectCount: number, allowInvalidTls: boolean): Promise<{ text: string; finalUrl: string; status: number }> {
  if (redirectCount > 5) return Promise.reject(new Error("SOURCE_FETCH_REDIRECT_LIMIT"));
  const url = new URL(sourceUrl);
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
        const nextUrl = new URL(location, sourceUrl).toString();
        void fetchTextWithNodeClient(nextUrl, timeoutMs, input, redirectCount + 1, allowInvalidTls).then(resolve, reject);
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
