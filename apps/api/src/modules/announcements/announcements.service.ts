import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AuthRepository } from "../auth/auth.types.js";
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
    @Inject("AnnouncementRepository") private readonly announcementRepository: AnnouncementRepository
  ) {}

  async getMyAnnouncements(userId: string, limit = 20): Promise<AnnouncementItem[]> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");

    const sources = await this.announcementRepository.listSourcesByScope({
      universityId: user.universityId,
      ...(user.facultyId ? { facultyId: user.facultyId } : {}),
      ...(user.departmentId ? { departmentId: user.departmentId } : {})
    });

    const fetched = await Promise.all(sources.map((source) => this.fetchSourceItemsSafe(source)));
    const merged: AnnouncementItem[] = [];

    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      if (!source) continue;
      const remoteItems = fetched[index] ?? [];
      const activeItems = remoteItems.length > 0 ? remoteItems : source.fallbackItems ?? [];

      for (const item of activeItems) {
        merged.push({
          id: createAnnouncementId(source.id, item.link, item.title),
          sourceId: source.id,
          sourceName: source.sourceName,
          scopeType: source.scopeType,
          scopeId: source.scopeId,
          title: item.title,
          link: item.link,
          ...(item.publishedAt ? { publishedAt: item.publishedAt.toISOString() } : {}),
          ...(item.summary ? { summary: item.summary } : {})
        });
      }
    }

    const deduped = dedupeAnnouncements(merged);
    deduped.sort((left, right) => {
      const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
      const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
      return rightTime - leftTime;
    });

    return deduped.slice(0, Math.min(Math.max(limit, 1), 50));
  }

  private async fetchSourceItemsSafe(source: AnnouncementSourceRecord): Promise<ParsedAnnouncementItem[]> {
    try {
      return await fetchSourceItems(source.sourceUrl, source.parser);
    } catch {
      return [];
    }
  }
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

    results.push({ title, link: normalizedLink });
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
  if (Number.isNaN(timestamp)) return undefined;
  return new Date(timestamp);
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
