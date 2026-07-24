import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { isFreshAcademicContent } from "../../domain/temporal-freshness.js";
import type { AuthRepository } from "../auth/auth.types.js";
import type { CatalogRepository } from "../catalog/catalog.types.js";
import { AnnouncementIngestionService, discoverAnnouncementSourceForUniversity, YOK_ANNOUNCEMENT_SCOPE_ID, YOK_ANNOUNCEMENT_SOURCE_URL } from "./announcement-ingestion.service.js";
import { fetchSourceItems as fetchParsedAnnouncementItems, toAnnouncementItems } from "./announcement-parser.js";
import type { AnnouncementItem, AnnouncementRepository, AnnouncementSourceParser, AnnouncementSourceRecord } from "./announcements.types.js";

interface ParsedAnnouncementItem {
  title: string;
  link: string;
  publishedAt?: Date;
  summary?: string;
}

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject("AuthRepository") private readonly authRepository: AuthRepository,
    @Inject("AnnouncementRepository") private readonly announcementRepository: AnnouncementRepository,
    @Optional() @Inject("CatalogRepository") private readonly catalogRepository?: CatalogRepository,
    @Optional() @Inject(AnnouncementIngestionService) private readonly announcementIngestionService?: AnnouncementIngestionService
  ) {}

  async getMyAnnouncements(userId: string, limit = 20): Promise<AnnouncementItem[]> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");

    const scopeInput = {
      universityId: user.universityId,
      ...(user.facultyId ? { facultyId: user.facultyId } : {}),
      ...(user.departmentId ? { departmentId: user.departmentId } : {})
    };

    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    await this.announcementIngestionService?.ensureStaticAnnouncementSources();
    let sources = await this.announcementRepository.listSourcesByScope(scopeInput);

    if (sources.length === 0) {
      await this.discoverAndStoreUniversitySource(user.universityId);
      sources = await this.announcementRepository.listSourcesByScope(scopeInput);
    }

    const cachedItems = await this.announcementRepository.listItemsByScope({ ...scopeInput, limit: boundedLimit });
    const cachedSourceIds = new Set(cachedItems.map((item) => item.sourceId));
    const hasUncachedSources = sources.some((source) => !cachedSourceIds.has(source.id));
    if (!hasUncachedSources && cachedItems.length > 0 && areAnnouncementItemsFresh(cachedItems)) return cachedItems;

    if (sources.length === 0) return cachedItems;

    const refreshedItems = await this.refreshSources(sources);
    const merged = refreshedItems.length > 0 ? refreshedItems : cachedItems;

    const deduped = dedupeAnnouncements(merged);
    deduped.sort(compareAnnouncementItems);

    return deduped.slice(0, boundedLimit);
  }

  async getYokAnnouncements(limit = 60): Promise<AnnouncementItem[]> {
    const source = await this.announcementRepository.upsertSource({
      scopeType: "university",
      scopeId: YOK_ANNOUNCEMENT_SCOPE_ID,
      sourceName: "YÖK Duyuruları",
      sourceUrl: YOK_ANNOUNCEMENT_SOURCE_URL,
      contentType: "announcement",
      parser: "auto",
      priority: 100,
      status: "active",
      homepageUrl: "https://www.yok.gov.tr/tr",
      discoveryMethod: "manual",
      healthStatus: "pending",
      consecutiveFailures: 0,
      itemCount: 0
    });
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const cachedItems = (await this.announcementRepository.listItemsByScope({ universityId: YOK_ANNOUNCEMENT_SCOPE_ID, limit: boundedLimit }))
      .filter(isUsefulYokAnnouncement);
    if (cachedItems.length > 0) return cachedItems;

    const fetchedAt = new Date();
    const parsedItems = await this.fetchSourceItemsSafe(source);
    const items = toAnnouncementItems(source, parsedItems, fetchedAt).filter(isUsefulYokAnnouncement);
    items.sort(compareAnnouncementItems);
    await this.announcementRepository.replaceItemsForSource(source, items);
    return items.slice(0, boundedLimit);
  }

  private async fetchSourceItemsSafe(source: AnnouncementSourceRecord): Promise<ParsedAnnouncementItem[]> {
    try {
      return await fetchParsedAnnouncementItems(source.sourceUrl, source.parser);
    } catch {
      return [];
    }
  }

  private async discoverAndStoreUniversitySource(universityId: string): Promise<AnnouncementSourceRecord | null> {
    const university = await this.catalogRepository?.findUniversityById(universityId);
    if (!university) return null;
    const result = await discoverAnnouncementSourceForUniversity(university, { timeoutMs: readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7000) });
    if (result.status !== "source_found" || !result.sourceUrl) return null;

    return this.announcementRepository.upsertSource({
      scopeType: "university",
      scopeId: university.id,
      sourceName: `${university.name} Duyurular`,
      sourceUrl: result.sourceUrl,
      contentType: "announcement",
      parser: result.parser ?? "auto",
      priority: 20,
      status: "active",
      ...(result.homepageUrl ? { homepageUrl: result.homepageUrl } : {}),
      discoveryMethod: university.websiteUrl ? "catalog_website" : "domain_candidate",
      healthStatus: result.itemCount > 0 ? "healthy" : "degraded",
      lastCheckedAt: new Date(),
      ...(result.itemCount > 0 ? { lastSuccessAt: new Date() } : {}),
      consecutiveFailures: result.itemCount > 0 ? 0 : 1,
      itemCount: result.itemCount
    });
  }

  private async refreshSources(sources: AnnouncementSourceRecord[]): Promise<AnnouncementItem[]> {
    const fetchedAt = new Date();
    const groups = await Promise.all(sources.map((source) => this.refreshSource(source, fetchedAt)));
    return groups.flat();
  }

  private async refreshSource(source: AnnouncementSourceRecord, fetchedAt: Date): Promise<AnnouncementItem[]> {
    try {
      const parsedItems = await fetchParsedAnnouncementItems(source.sourceUrl, source.parser, readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7000));
      const items = toAnnouncementItems(source, parsedItems, fetchedAt);
      await this.announcementRepository.replaceItemsForSource(source, items);
      await this.announcementRepository.recordSourceCheck(source.id, {
        healthStatus: items.length > 0 ? "healthy" : "degraded",
        lastCheckedAt: fetchedAt,
        ...(items.length > 0 ? { lastSuccessAt: fetchedAt } : {}),
        ...(items.length > 0 ? {} : { lastError: "No announcement items parsed." }),
        consecutiveFailures: items.length > 0 ? 0 : (source.consecutiveFailures ?? 0) + 1,
        itemCount: items.length
      });
      if (items.length > 0) return items;
    } catch (error) {
      await this.announcementRepository.recordSourceCheck(source.id, {
        healthStatus: "degraded",
        lastCheckedAt: fetchedAt,
        lastError: error instanceof Error ? error.message : String(error),
        consecutiveFailures: (source.consecutiveFailures ?? 0) + 1,
        itemCount: 0
      });
    }

    return fallbackItemsForSource(source, fetchedAt);
  }
}

function areAnnouncementItemsFresh(items: AnnouncementItem[], now = Date.now()): boolean {
  const latestFetchedAt = Math.max(...items.map((item) => Date.parse(item.fetchedAt ?? "")).filter((timestamp) => Number.isFinite(timestamp)), 0);
  return latestFetchedAt > 0 && now - latestFetchedAt <= readPositiveInteger(process.env.ANNOUNCEMENT_CACHE_TTL_MS, 10 * 60 * 1000);
}

function fallbackItemsForSource(source: AnnouncementSourceRecord, fetchedAt: Date): AnnouncementItem[] {
  return (source.fallbackItems ?? [])
    .filter((item) => isFreshAcademicContent({ title: item.title, url: item.link, publishedAt: item.publishedAt, fetchedAt }).accepted)
    .map((item) => ({
    id: createAnnouncementId(source.id, item.link, item.title),
    sourceId: source.id,
    sourceName: source.sourceName,
    contentType: source.contentType ?? "announcement",
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    title: item.title,
    link: item.link,
    ...(item.publishedAt ? { publishedAt: item.publishedAt.toISOString() } : {}),
    ...(item.summary ? { summary: item.summary } : {}),
    fetchedAt: fetchedAt.toISOString()
  }));
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function fetchSourceItems(sourceUrl: string, parser: AnnouncementSourceParser): Promise<ParsedAnnouncementItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      headers: { Accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`SOURCE_FETCH_FAILED:${response.status}`);
    const body = await response.text();

    const resolvedParser = parser === "auto" ? (looksLikeXmlFeed(body) ? "rss" : "html") : parser;
    if (resolvedParser === "rss") return parseRssOrAtom(body).slice(0, 20);
    return parseHtmlAnchors(body, sourceUrl).slice(0, 20);
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeXmlFeed(input: string): boolean {
  const text = input.toLocaleLowerCase("en-US");
  return text.includes("<rss") || text.includes("<feed") || text.includes("<channel");
}

function parseRssOrAtom(input: string): ParsedAnnouncementItem[] {
  const rssItems = [...input.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map((match) => parseRssItem(match[0]))
    .filter((item): item is ParsedAnnouncementItem => Boolean(item));

  const atomItems = [...input.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)]
    .map((match) => parseAtomEntry(match[0]))
    .filter((item): item is ParsedAnnouncementItem => Boolean(item));

  return [...rssItems, ...atomItems];
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

function parseHtmlAnchors(input: string, sourceUrl: string): ParsedAnnouncementItem[] {
  const anchors = [...input.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const results: ParsedAnnouncementItem[] = [];

  for (const anchor of anchors) {
    const href = cleanText(anchor[1]);
    const title = cleanText(stripHtml(anchor[2] ?? ""));
    if (!href || !title || title.length < 8) continue;

    const normalizedLink = toAbsoluteUrl(href, sourceUrl);
    if (!normalizedLink) continue;

    if (!containsAnnouncementHint(title, normalizedLink)) continue;

    const publishedAt = parseDateMaybe(title);
    results.push({ title, link: normalizedLink, ...(publishedAt ? { publishedAt } : {}) });
    if (results.length >= 50) break;
  }

  return results;
}

function containsAnnouncementHint(title: string, link: string): boolean {
  const haystack = `${title} ${link}`.toLocaleLowerCase("tr-TR");
  return ["duyuru", "announcement", "ilan", "haber", "exam", "sinav", "notice"].some((hint) => haystack.includes(hint));
}

function extractTagValue(input: string, tagName: string): string | undefined {
  const match = input.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  if (!match?.[1]) return undefined;
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function parseDateMaybe(input: string): Date | undefined {
  const timestamp = Date.parse(input);
  if (!Number.isNaN(timestamp)) return new Date(timestamp);
  return parseTurkishDate(input);
}

function parseTurkishDate(input: string): Date | undefined {
  const normalized = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "I")
    .toLocaleLowerCase("en-US");
  const match = normalized.match(/\b(\d{1,2})\s+(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\s+(20\d{2})\b/u);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const month = turkishMonths[match[2]];
  if (!month) return undefined;
  return new Date(Date.UTC(Number(match[3]), month - 1, Number(match[1])));
}

function toAbsoluteUrl(candidate: string, base: string): string | null {
  try {
    return new URL(candidate, base).toString();
  } catch {
    return null;
  }
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, " ");
}

function cleanText(input?: string): string {
  if (!input) return "";
  return decodeHtmlEntities(input).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function createAnnouncementId(sourceId: string, link: string, title: string): string {
  return createHash("sha1").update(`${sourceId}|${link}|${title}`).digest("hex").slice(0, 20);
}

function dedupeAnnouncements(items: AnnouncementItem[]): AnnouncementItem[] {
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

function compareAnnouncementItems(left: AnnouncementItem, right: AnnouncementItem): number {
  const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : left.fetchedAt ? Date.parse(left.fetchedAt) : 0;
  const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : right.fetchedAt ? Date.parse(right.fetchedAt) : 0;
  return rightTime - leftTime;
}

function isUsefulYokAnnouncement(item: AnnouncementItem): boolean {
  const normalized = item.title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .trim();
  return !["duyurular", "duyuru", "haberler", "haber"].includes(normalized);
}
