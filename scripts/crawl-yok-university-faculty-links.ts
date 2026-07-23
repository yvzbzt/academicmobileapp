import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { cleanText, fetchText } from "../apps/api/src/modules/announcements/announcement-parser.js";

interface UniversityInput {
  name?: string;
  category?: string;
  homepageUrl: string;
}

interface FacultyLink {
  name: string;
  url: string;
  unitType: AcademicUnitType;
  sourcePageUrl: string;
  confidence: number;
}

interface UniversityFacultyTree {
  name?: string;
  category?: string;
  homepageUrl: string;
  finalHomepageUrl?: string;
  hostname: string;
  siteTitle?: string;
  status: "pending" | "ok" | "partial" | "failed";
  checkedPageCount: number;
  facultyCount: number;
  faculties: FacultyLink[];
  errors: string[];
}

interface CrawlOutput {
  generatedAt: string;
  input: {
    linksPath: string;
    yokTextPath: string;
    workerCount: number;
    timeoutMs: number;
    maxPagesPerUniversity: number;
    limit: number;
    offset: number;
  };
  summary: {
    totalUniversities: number;
    completedUniversities: number;
    okUniversities: number;
    partialUniversities: number;
    failedUniversities: number;
    universitiesWithFaculties: number;
    totalFacultyLinks: number;
  };
  universities: UniversityFacultyTree[];
}

interface AnchorLink {
  title: string;
  url: string;
  sourcePageUrl: string;
}

type AcademicUnitType = "faculty" | "institute" | "school" | "vocational_school" | "academic_unit";

const linksPath = resolve(process.cwd(), process.env.YOK_UNIVERSITY_LINKS_INPUT ?? "data/yok-university-links.json");
const yokTextPath = resolve(process.cwd(), process.env.YOK_UNIVERSITY_TEXT_INPUT ?? "Y\u00d6K \u00dcniversiteler.txt");
const outputPath = resolve(process.cwd(), process.env.YOK_FACULTY_TREE_OUTPUT ?? "data/yok-university-faculty-tree.json");
const workerCount = readPositiveInteger(process.env.YOK_FACULTY_WORKERS, 4);
const timeoutMs = readPositiveInteger(process.env.YOK_FACULTY_TIMEOUT_MS, 8000);
const maxPagesPerUniversity = readPositiveInteger(process.env.YOK_FACULTY_MAX_PAGES, 12);
const limit = readPositiveInteger(process.env.YOK_FACULTY_CRAWL_LIMIT, Number.POSITIVE_INFINITY);
const offset = readPositiveInteger(process.env.YOK_FACULTY_CRAWL_OFFSET, 0);

async function main(): Promise<void> {
  const links = await loadLinks(linksPath);
  const metadataByUrl = await loadYokUniversityMetadata(yokTextPath);
  const selectedLinks = links.slice(offset, Number.isFinite(limit) ? offset + limit : undefined);
  const universities = selectedLinks.map((homepageUrl) => ({
    ...metadataByUrl.get(normalizeUrlForLookup(homepageUrl)),
    homepageUrl
  }));

  const results = universities.map(toPendingTree);
  let completed = 0;
  let writeQueue = Promise.resolve();

  await writeOutput(results);

  await runWithConcurrency(universities, workerCount, async (university, index, workerId) => {
    const tree = await crawlUniversity(university, index, workerId, selectedLinks.length);
    results[index] = tree;
    completed += 1;

    writeQueue = writeQueue.then(() => writeOutput(results));
    await writeQueue;

    const label = tree.name ?? tree.siteTitle ?? tree.hostname;
    console.log(`[worker ${workerId}] ${completed}/${selectedLinks.length} ${tree.status} faculties=${tree.facultyCount} ${label}`);
  });

  await writeQueue;
  await writeOutput(results);
  console.log(JSON.stringify(buildSummary(results), null, 2));
  console.log(`Faculty tree written to ${outputPath}`);
}

async function crawlUniversity(input: UniversityInput, index: number, workerId: number, total: number): Promise<UniversityFacultyTree> {
  const hostname = safeHostname(input.homepageUrl);
  const faculties = new Map<string, FacultyLink>();
  const errors: string[] = [];
  const pagesToInspect = new Map<string, string>();
  const inspectedPages = new Set<string>();
  let siteTitle: string | undefined;
  let finalHomepageUrl: string | undefined;

  addPageCandidate(pagesToInspect, input.homepageUrl, "homepage");

  for (const path of academicUnitPaths.slice(0, 6)) {
    addPageCandidate(pagesToInspect, new URL(path, input.homepageUrl).toString(), "known path");
  }

  for (let cursor = 0; cursor < maxPagesPerUniversity;) {
    const nextUrl = [...pagesToInspect.keys()].find((url) => !inspectedPages.has(url));
    if (!nextUrl) break;
    cursor += 1;
    inspectedPages.add(nextUrl);

    try {
      const page = await fetchText(nextUrl, timeoutMs);
      if (!finalHomepageUrl) finalHomepageUrl = page.finalUrl;
      siteTitle ??= extractPageTitle(page.text);

      const links = extractLinks(page.text, page.finalUrl);
      for (const link of links) {
        if (!isSameUniversityUrl(link.url, finalHomepageUrl ?? input.homepageUrl)) continue;

        const faculty = toFacultyLink(link);
        if (faculty) {
          const key = facultyKey(faculty);
          const existing = faculties.get(key);
          if (!existing || faculty.confidence > existing.confidence) faculties.set(key, faculty);
        }

        if (pagesToInspect.size < maxPagesPerUniversity * 3 && isAcademicUnitNavigationLink(link)) {
          addPageCandidate(pagesToInspect, link.url, "navigation");
        }
      }
    } catch (error) {
      errors.push(`${nextUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const facultyList = [...faculties.values()].sort((left, right) => right.confidence - left.confidence || left.name.localeCompare(right.name, "tr-TR"));
  const status = facultyList.length > 0 ? (errors.length > 0 ? "partial" : "ok") : errors.length > 0 ? "failed" : "partial";
  const label = input.name ?? siteTitle ?? hostname;
  console.log(`[worker ${workerId}] scanned ${index + 1}/${total} pages=${inspectedPages.size} facultyLinks=${facultyList.length} ${label}`);

  return {
    ...(input.name ? { name: input.name } : {}),
    ...(input.category ? { category: input.category } : {}),
    homepageUrl: input.homepageUrl,
    ...(finalHomepageUrl ? { finalHomepageUrl } : {}),
    hostname,
    ...(siteTitle ? { siteTitle } : {}),
    status,
    checkedPageCount: inspectedPages.size,
    facultyCount: facultyList.length,
    faculties: facultyList,
    errors: errors.slice(0, 8)
  };
}

async function loadLinks(path: string): Promise<string[]> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new Error(`Expected ${path} to contain a JSON array of URL strings.`);
  }
  return parsed;
}

async function loadYokUniversityMetadata(path: string): Promise<Map<string, Pick<UniversityInput, "name" | "category">>> {
  const metadata = new Map<string, Pick<UniversityInput, "name" | "category">>();
  const lines = (await readFile(path, "utf8")).split(/\r?\n/u).map((line) => cleanText(line));
  let category: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const folded = foldText(line);
    if (universityCategories.has(folded)) category = line;

    const urls = extractUrlsFromText(line);
    if (urls.length === 0) continue;

    const name = findUniversityNameBefore(lines, index);
    for (const url of urls) {
      metadata.set(normalizeUrlForLookup(url), {
        ...(name ? { name } : {}),
        ...(category ? { category } : {})
      });
    }
  }

  return metadata;
}

function findUniversityNameBefore(lines: string[], startIndex: number): string | undefined {
  for (let index = startIndex - 1; index >= Math.max(0, startIndex - 18); index -= 1) {
    const line = lines[index] ?? "";
    const folded = foldText(line);
    if (!line || folded.endsWith(" logo")) continue;
    if (metadataLabels.has(folded) || universityCategories.has(folded)) continue;
    if (folded.includes("universitesi") || folded.includes("yuksekokulu") || folded.includes("akademisi")) return line;
  }
  return undefined;
}

function extractUrlsFromText(value: string): string[] {
  const matches = value.match(/\b(?:https?:\/\/|www\.)[^\s<>"'`]+/giu) ?? [];
  return matches.map(normalizeUniversityUrl).filter((url): url is string => Boolean(url));
}

function normalizeUniversityUrl(value: string): string | null {
  let candidate = value.trim().replace(/[),.;:!?]+$/u, "");
  if (candidate.startsWith("www.")) candidate = `https://${candidate}`;
  try {
    const url = new URL(candidate);
    url.hash = "";
    url.username = "";
    url.password = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return null;
  }
}

function extractLinks(html: string, baseUrl: string): AnchorLink[] {
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)];
  const links: AnchorLink[] = [];

  for (const anchor of anchors) {
    const attrs = anchor[1] ?? "";
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/iu)?.[1];
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;

    const rawTitle = `${stripHtml(anchor[2] ?? "")} ${readAttr(attrs, "title")} ${readAttr(attrs, "aria-label")}`;
    const title = cleanText(decodeHtmlEntities(rawTitle));
    try {
      const url = new URL(decodeHtmlEntities(href), baseUrl);
      url.hash = "";
      if (!isHttpUrl(url.toString()) || looksLikeAsset(url.toString())) continue;
      links.push({ title, url: url.toString(), sourcePageUrl: baseUrl });
    } catch {
      continue;
    }
  }

  return links;
}

function toFacultyLink(link: AnchorLink): FacultyLink | null {
  const title = normalizeAcademicUnitName(link.title, link.url);
  const foldedTitle = foldText(title);
  const foldedHaystack = foldText(`${link.title} ${decodeURIComponentSafe(link.url)}`);
  if (!title || title.length < 3 || isGenericAcademicUnitTitle(foldedTitle) || isNonAcademicNoise(foldedHaystack)) return null;

  const unitType = detectAcademicUnitType(foldedHaystack);
  const confidence = scoreAcademicUnitCandidate(foldedTitle, foldedHaystack, unitType);
  if (confidence < 55) return null;

  return {
    name: title,
    url: link.url,
    unitType,
    sourcePageUrl: link.sourcePageUrl,
    confidence
  };
}

function normalizeAcademicUnitName(title: string, url: string): string {
  const cleanedTitle = cleanText(title);
  if (cleanedTitle && !isGenericAcademicUnitTitle(foldText(cleanedTitle))) return cleanedTitle;

  try {
    const pathParts = new URL(url).pathname.split("/").map(decodeURIComponentSafe).filter(Boolean);
    const bestPart = [...pathParts].reverse().find((part) => !isGenericAcademicUnitTitle(foldText(part)));
    if (!bestPart) return cleanedTitle;
    return slugToTitle(bestPart);
  } catch {
    return cleanedTitle;
  }
}

function scoreAcademicUnitCandidate(foldedTitle: string, foldedHaystack: string, unitType: AcademicUnitType): number {
  let score = 0;
  if (unitType === "faculty") score += 90;
  if (unitType === "institute") score += 70;
  if (unitType === "school" || unitType === "vocational_school") score += 65;
  if (unitType === "academic_unit") score += 45;
  if (facultyNameHints.some((hint) => foldedHaystack.includes(hint))) score += 25;
  if (/\b(fakultesi|faculty of|school of)\b/u.test(foldedHaystack)) score += 25;
  if (foldedTitle.split(/\s+/u).filter(Boolean).length >= 2) score += 10;
  if (isGenericAcademicUnitTitle(foldedTitle)) score -= 80;
  return score;
}

function detectAcademicUnitType(foldedHaystack: string): AcademicUnitType {
  if (/\b(meslek yuksekokulu|myo)\b/u.test(foldedHaystack)) return "vocational_school";
  if (/\b(enstitu|institu|institute)\b/u.test(foldedHaystack)) return "institute";
  if (/\b(fakulte|fakultesi|faculty|faculties)\b/u.test(foldedHaystack)) return "faculty";
  if (/\b(yuksekokul|school|college)\b/u.test(foldedHaystack)) return "school";
  return "academic_unit";
}

function isAcademicUnitNavigationLink(link: AnchorLink): boolean {
  const folded = foldText(`${link.title} ${decodeURIComponentSafe(link.url)}`);
  if (isNonAcademicNoise(folded)) return false;
  return academicUnitNavigationHints.some((hint) => folded.includes(hint));
}

function isGenericAcademicUnitTitle(foldedTitle: string): boolean {
  const compact = foldedTitle.replace(/\s+/gu, " ").trim();
  return genericAcademicUnitTitles.has(compact);
}

function isSameUniversityUrl(candidateUrl: string, homepageUrl: string): boolean {
  try {
    const candidateHost = stripCommonHostPrefix(new URL(candidateUrl).hostname);
    const homepageHost = stripCommonHostPrefix(new URL(homepageUrl).hostname);
    return candidateHost === homepageHost || candidateHost.endsWith(`.${homepageHost}`) || homepageHost.endsWith(`.${candidateHost}`);
  } catch {
    return false;
  }
}

function addPageCandidate(candidates: Map<string, string>, url: string, reason: string): void {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (!isHttpUrl(parsed.toString()) || looksLikeAsset(parsed.toString())) return;
    if (!candidates.has(parsed.toString())) candidates.set(parsed.toString(), reason);
  } catch {
    return;
  }
}

function toPendingTree(input: UniversityInput): UniversityFacultyTree {
  return {
    ...(input.name ? { name: input.name } : {}),
    ...(input.category ? { category: input.category } : {}),
    homepageUrl: input.homepageUrl,
    hostname: safeHostname(input.homepageUrl),
    status: "pending",
    checkedPageCount: 0,
    facultyCount: 0,
    faculties: [],
    errors: []
  };
}

async function runWithConcurrency<TInput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number, workerId: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async (_, workerIndex) => {
    const workerId = workerIndex + 1;
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      await worker(item, index, workerId);
    }
  }));
}

async function writeOutput(universities: UniversityFacultyTree[]): Promise<void> {
  const output: CrawlOutput = {
    generatedAt: new Date().toISOString(),
    input: {
      linksPath,
      yokTextPath,
      workerCount,
      timeoutMs,
      maxPagesPerUniversity,
      limit: Number.isFinite(limit) ? limit : universities.length,
      offset
    },
    summary: buildSummary(universities),
    universities
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

function buildSummary(universities: UniversityFacultyTree[]): CrawlOutput["summary"] {
  return {
    totalUniversities: universities.length,
    completedUniversities: universities.filter((university) => university.status !== "pending").length,
    okUniversities: universities.filter((university) => university.status === "ok").length,
    partialUniversities: universities.filter((university) => university.status === "partial").length,
    failedUniversities: universities.filter((university) => university.status === "failed").length,
    universitiesWithFaculties: universities.filter((university) => university.facultyCount > 0).length,
    totalFacultyLinks: universities.reduce((total, university) => total + university.facultyCount, 0)
  };
}

function facultyKey(faculty: FacultyLink): string {
  return `${foldText(faculty.name)}|${normalizeUrlForLookup(faculty.url)}`;
}

function normalizeUrlForLookup(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/u, "");
  } catch {
    return input.trim().replace(/\/$/u, "");
  }
}

function safeHostname(input: string): string {
  try {
    return new URL(input).hostname;
  } catch {
    return input;
  }
}

function stripCommonHostPrefix(hostname: string): string {
  return hostname.toLowerCase().replace(/^(?:www|web|new)\./u, "");
}

function extractPageTitle(html: string): string | undefined {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  const cleaned = cleanText(decodeHtmlEntities(stripHtml(title ?? "")));
  return cleaned || undefined;
}

function readAttr(attrs: string, name: string): string {
  return attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "iu"))?.[1] ?? "";
}

function stripHtml(input: string): string {
  return input
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ");
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/giu, (_, entity: string) => htmlEntities[entity.toLowerCase()] ?? `&${entity};`);
}

function slugToTitle(value: string): string {
  return value
    .replace(/\.[a-z0-9]+$/iu, "")
    .replace(/[-_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("tr-TR"));
}

function foldText(value: string): string {
  return cleanText(decodeHtmlEntities(value))
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

function decodeURIComponentSafe(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//iu.test(input);
}

function looksLikeAsset(input: string): boolean {
  return /\.(?:css|js|mjs|jpg|jpeg|png|gif|svg|webp|ico|bmp|avif|mp4|mp3|zip|rar|7z|pdf|docx?|xlsx?|pptx?)(?:[?#]|$)/iu.test(input);
}

function isNonAcademicNoise(foldedInput: string): boolean {
  return /\b(duyuru|haber|news|announcement|ihale|kutuphane|library|mezun|alumni|basin|iletisim|contact|kvkk|gizlilik|privacy|ogrenci isleri|student affairs|yemek|yemekhane|saglik kultur|sks|personel|staff|login|mail|eposta|takvim|calendar|erasmus|aday ogrenci|prospective|tanitim|rektorluk|yonetim|administration)\b/u.test(foldedInput);
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const universityCategories = new Set([
  "devlet universiteleri",
  "vakif universiteleri",
  "vakif meslek yuksekokullari",
  "kktc universiteleri"
]);

const metadataLabels = new Set([
  "sehir:",
  "kurulus:",
  "web sitesi:",
  "adres:"
]);

const academicUnitPaths = [
  "/akademik",
  "/akademik/",
  "/akademik-birimler",
  "/akademik-birimler/",
  "/akademik-birimler/fakulteler",
  "/fakulteler",
  "/fakulteler/",
  "/fakultelerimiz",
  "/akademik/fakulteler",
  "/akademik/birimler",
  "/birimler",
  "/birimler/",
  "/tr/akademik",
  "/tr/akademik-birimler",
  "/tr/fakulteler",
  "/universite/akademik-birimler",
  "/en/academic",
  "/en/academic-units",
  "/en/faculties",
  "/faculties",
  "/academic-units"
];

const academicUnitNavigationHints = [
  "akademik",
  "akademik birim",
  "fakulte",
  "fakulteler",
  "faculty",
  "faculties",
  "enstitu",
  "institute",
  "yuksekokul",
  "school",
  "college",
  "myo",
  "meslek yuksekokulu"
];

const genericAcademicUnitTitles = new Set([
  "akademik",
  "akademik birimler",
  "akademik birimlerimiz",
  "akademik uniteler",
  "academic",
  "academic units",
  "academics",
  "birimler",
  "fakulte",
  "fakulteler",
  "fakultelerimiz",
  "faculty",
  "faculties",
  "enstitu",
  "enstituler",
  "institutes",
  "school",
  "schools",
  "colleges",
  "yuksekokul",
  "yuksekokullar",
  "meslek yuksekokullari",
  "bolumler",
  "departments"
]);

const facultyNameHints = [
  "muhendislik",
  "egitim",
  "fen",
  "edebiyat",
  "iktisadi",
  "idari",
  "hukuk",
  "tip",
  "dis",
  "eczacilik",
  "ilahiyat",
  "iletisim",
  "mimarlik",
  "guzel sanat",
  "sanat",
  "spor",
  "turizm",
  "saglik",
  "veteriner",
  "ziraat",
  "teknoloji",
  "havacilik",
  "denizcilik",
  "isletme",
  "siyasal",
  "sosyal",
  "insan",
  "beseri",
  "bilgisayar",
  "iktisat",
  "faculty of",
  "school of"
];

const htmlEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  ccedil: "\u00e7",
  Ccedil: "\u00c7",
  gt: ">",
  lt: "<",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  ograve: "\u00f2",
  ouml: "\u00f6",
  Ouml: "\u00d6",
  quot: "\"",
  rsquo: "'",
  scedil: "\u015f",
  Scedil: "\u015e",
  uuml: "\u00fc",
  Uuml: "\u00dc"
};

await main();
