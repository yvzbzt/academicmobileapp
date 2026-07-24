import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadTurkiyeCatalogFromYokAtlas } from "../apps/api/src/bootstrap/yok-atlas-catalog-importer.js";
import { buildHomepageCandidates, discoverAnnouncementSourceForUniversity } from "../apps/api/src/modules/announcements/announcement-ingestion.service.js";
import { cleanText, fetchText } from "../apps/api/src/modules/announcements/announcement-parser.js";
import { discoverAcademicCalendarPdf } from "../apps/api/src/modules/calendars/calendar-ingestion.service.js";
import type { UniversityRecord } from "../apps/api/src/modules/catalog/catalog.types.js";

const limit = readPositiveInteger(process.env.SOURCE_AUDIT_LIMIT, 205);
const offset = readPositiveInteger(process.env.SOURCE_AUDIT_OFFSET, 0);
const concurrency = readPositiveInteger(process.env.SOURCE_AUDIT_CONCURRENCY, 4);
const timeoutMs = readPositiveInteger(process.env.SOURCE_AUDIT_TIMEOUT_MS, 4500);
const outputPath = resolve(process.cwd(), process.env.SOURCE_AUDIT_OUTPUT ?? ".tmp-test-run/university-source-audit.json");

const summerSchoolPaths = [
  "/yaz-okulu",
  "/yaz-okulu/",
  "/yazokulu",
  "/yazokulu/",
  "/tr/yaz-okulu",
  "/tr/yazokulu",
  "/ogrenci/yaz-okulu",
  "/ogrenci-isleri/yaz-okulu",
  "/akademik/yaz-okulu",
  "/duyurular",
  "/summer-school",
  "/student/summer-school"
];

const catalog = await loadTurkiyeCatalogFromYokAtlas(60000);
const universities = catalog.universities.slice(offset, offset + limit).map((university) => ({
  id: university.slug,
  name: university.name,
  slug: university.slug,
  city: university.city,
  type: university.type,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date()
}) satisfies UniversityRecord);

const startedAt = new Date();
const results = await runWithConcurrency(universities, concurrency, async (university, index) => {
  const [announcement, calendar, summerSchool] = await Promise.all([
    discoverAnnouncementSourceForUniversity(university, { timeoutMs }),
    discoverCalendarSource(university),
    discoverSummerSchoolInfoSource(university)
  ]);
  const ordinal = offset + index + 1;
  console.log(`${ordinal}/${catalog.universities.length} announcements=${announcement.status} calendar=${calendar.status} summer=${summerSchool.status} ${university.name}`);
  return { universityId: university.id, universityName: university.name, city: university.city, announcement, calendar, summerSchool };
});
const finishedAt = new Date();

const summary = {
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationSeconds: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
  sourceCatalog: catalog.sourceUrl,
  checkedUniversities: results.length,
  announcementSourceFound: results.filter((result) => result.announcement.status === "source_found").length,
  calendarSourceFound: results.filter((result) => result.calendar.status === "source_found").length,
  summerSchoolSourceFound: results.filter((result) => result.summerSchool.status === "source_found").length,
  announcementMissing: results.filter((result) => result.announcement.status !== "source_found").length,
  calendarMissing: results.filter((result) => result.calendar.status !== "source_found").length,
  summerSchoolMissing: results.filter((result) => result.summerSchool.status !== "source_found").length
};

await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, JSON.stringify({ summary, results }, null, 2), "utf8");
console.log(JSON.stringify(summary, null, 2));
console.log(`Report written to ${outputPath}`);

async function discoverCalendarSource(university: UniversityRecord): Promise<{ status: "source_found" | "source_not_found" | "failed"; sourceUrl?: string; title?: string; error?: string }> {
  try {
    const source = await discoverAcademicCalendarPdf(university, timeoutMs);
    return source
      ? { status: "source_found", sourceUrl: source.sourceUrl, title: source.title }
      : { status: "source_not_found" };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

async function discoverSummerSchoolInfoSource(university: UniversityRecord): Promise<{ status: "source_found" | "source_not_found" | "failed"; sourceUrl?: string; itemCount: number; sampleTitles: string[]; error?: string }> {
  let lastError = "";

  for (const homepageUrl of buildHomepageCandidates(university).slice(0, 12)) {
    try {
      const homepage = await fetchText(homepageUrl, timeoutMs);
      const candidateUrls = unique([
        ...extractSummerSchoolLinks(homepage.text, homepage.finalUrl).map((link) => link.url),
        ...summerSchoolPaths.map((path) => new URL(path, homepage.finalUrl).toString())
      ]).slice(0, 24);

      for (const candidateUrl of candidateUrls) {
        try {
          const page = await fetchText(candidateUrl, timeoutMs);
          const pageTitle = extractHtmlTitle(page.text);
          const sampleTitles = extractSummerSchoolLinks(page.text, page.finalUrl).map((link) => link.title).slice(0, 5);
          if (hasStrongSummerSchoolSignal(page.finalUrl, pageTitle, sampleTitles) || hasSummerSchoolRequirementSignal(page.text)) {
            return { status: "source_found", sourceUrl: page.finalUrl, itemCount: sampleTitles.length, sampleTitles };
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      if (hasSummerSchoolRequirementSignal(homepage.text)) {
        return { status: "source_found", sourceUrl: homepage.finalUrl, itemCount: 0, sampleTitles: [] };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return { status: lastError ? "failed" : "source_not_found", itemCount: 0, sampleTitles: [], ...(lastError ? { error: lastError } : {}) };
}

function extractSummerSchoolLinks(html: string, baseUrl: string): Array<{ url: string; title: string }> {
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const links: Array<{ url: string; title: string }> = [];
  for (const anchor of anchors) {
    const href = cleanText(anchor[1]);
    const title = cleanText((anchor[2] ?? "").replace(/<[^>]+>/g, " "));
    if (!href || !containsSummerSchoolHint(`${title} ${href}`)) continue;
    try {
      links.push({ url: new URL(href, baseUrl).toString(), title: title || href });
    } catch {
      continue;
    }
  }
  return links;
}

function containsSummerSchoolHint(value: string): boolean {
  const text = foldText(value.slice(0, 120000));
  return text.includes("yaz okulu") || text.includes("yazokulu") || text.includes("summer school");
}

function hasStrongSummerSchoolSignal(url: string, title: string, sampleTitles: string[]): boolean {
  return containsSummerSchoolHint(`${url} ${title} ${sampleTitles.join(" ")}`);
}

function hasSummerSchoolRequirementSignal(value: string): boolean {
  const text = foldText(value.slice(0, 120000));
  const hasSummerSchool = text.includes("yaz okulu") || text.includes("yazokulu") || text.includes("summer school");
  const hasRequirement = ["basvuru", "kayit", "ucret", "kontenjan", "ders sec", "ders alma", "kilavuz", "takvim", "form"].some((hint) => text.includes(hint));
  return hasSummerSchool && hasRequirement;
}

function extractHtmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(match?.[1]?.replace(/<[^>]+>/g, " ") ?? "");
}

async function runWithConcurrency<TInput, TOutput>(items: TInput[], workerCount: number, worker: (item: TInput, index: number) => Promise<TOutput>): Promise<TOutput[]> {
  const results: TOutput[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workerCount, items.length || 1)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  }));
  return results;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/#.*$/u, "")))];
}

function foldText(value: string): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/gu, "i")
    .replace(/\u0130/gu, "I")
    .replace(/\u011f/gu, "g")
    .replace(/\u011e/gu, "G")
    .replace(/\u00fc/gu, "u")
    .replace(/\u00dc/gu, "U")
    .replace(/\u015f/gu, "s")
    .replace(/\u015e/gu, "S")
    .replace(/\u00f6/gu, "o")
    .replace(/\u00d6/gu, "O")
    .replace(/\u00e7/gu, "c")
    .replace(/\u00c7/gu, "C")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
