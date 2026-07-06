import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadBundledTurkiyeCatalogSeed, type CatalogSeedDepartment, type CatalogSeedFaculty, type CatalogSeedUniversity } from "../apps/api/src/bootstrap/yok-atlas-catalog-importer.js";
import { buildHomepageCandidates, isLikelyUniversityHomepage } from "../apps/api/src/modules/announcements/announcement-ingestion.service.js";
import { cleanText, fetchText } from "../apps/api/src/modules/announcements/announcement-parser.js";
import type { DepartmentRecord, FacultyRecord, UniversityRecord } from "../apps/api/src/modules/catalog/catalog.types.js";

interface VerifiedUniversitySource {
  universityId: string;
  announcementUrl?: string;
}

interface AcademicUnitMatch {
  scopeType: "faculty" | "department";
  universityId: string;
  universityName: string;
  facultyId: string;
  facultyName: string;
  departmentId?: string;
  departmentName?: string;
  websiteUrl?: string;
  matchTitle?: string;
  sourcePageUrl?: string;
  score: number;
  status: "url_found" | "url_not_found";
}

interface AnchorLink {
  url: string;
  title: string;
  sourcePageUrl: string;
}

const concurrency = readPositiveInteger(process.env.UNIT_URL_SCAN_CONCURRENCY, 10);
const timeoutMs = readPositiveInteger(process.env.UNIT_URL_SCAN_TIMEOUT_MS, 5000);
const outputPath = resolve(process.cwd(), process.env.UNIT_URL_SCAN_OUTPUT ?? ".tmp-test-run/academic-unit-url-audit.json");
const registryPath = resolve(process.cwd(), process.env.UNIT_URL_SCAN_REGISTRY_OUTPUT ?? ".tmp-test-run/verified-academic-unit-sources.json");
const universityLimit = readPositiveInteger(process.env.UNIT_URL_SCAN_LIMIT, 205);
const universityOffset = readPositiveInteger(process.env.UNIT_URL_SCAN_OFFSET, 0);

let catalog: Awaited<ReturnType<typeof loadBundledTurkiyeCatalogSeed>>;
let verifiedUniversitySources: Map<string, VerifiedUniversitySource>;

async function main(): Promise<void> {
  catalog = await loadBundledTurkiyeCatalogSeed();
  verifiedUniversitySources = await loadVerifiedUniversitySources();
  const selectedUniversities = catalog.universities.slice(universityOffset, universityOffset + universityLimit);
  const startedAt = new Date();

  const results = (await runWithConcurrency(selectedUniversities, concurrency, scanUniversity)).flat();
  const registry = results
    .filter((result) => result.status === "url_found" && result.websiteUrl)
    .map((result) => ({
      scopeType: result.scopeType,
      universityId: result.universityId,
      universityName: result.universityName,
      facultyId: result.facultyId,
      facultyName: result.facultyName,
      ...(result.departmentId ? { departmentId: result.departmentId } : {}),
      ...(result.departmentName ? { departmentName: result.departmentName } : {}),
      websiteUrl: result.websiteUrl
    }));

  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    checkedUniversities: selectedUniversities.length,
    totalUniversities: catalog.universities.length,
    checkedUnits: results.length,
    facultyUnits: results.filter((result) => result.scopeType === "faculty").length,
    departmentUnits: results.filter((result) => result.scopeType === "department").length,
    foundUnits: results.filter((result) => result.status === "url_found").length,
    missingUnits: results.filter((result) => result.status === "url_not_found").length,
    foundFaculties: results.filter((result) => result.scopeType === "faculty" && result.status === "url_found").length,
    foundDepartments: results.filter((result) => result.scopeType === "department" && result.status === "url_found").length
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({ summary, results }, null, 2), "utf8");
  await writeFile(registryPath, JSON.stringify(registry, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Audit written to ${outputPath}`);
  console.log(`Registry written to ${registryPath}`);
}

async function scanUniversity(seed: CatalogSeedUniversity, index: number): Promise<AcademicUnitMatch[]> {
  const university = toUniversityRecord(seed);
  const links = await collectAcademicUnitLinks(university);
  const matches: AcademicUnitMatch[] = [];

  for (const facultySeed of seed.faculties) {
    const faculty = toFacultyRecord(university.id, facultySeed);
    const facultyMatch = bestAnchorMatch(links, faculty.name, faculty.slug, "faculty");
    matches.push({
      scopeType: "faculty",
      universityId: university.id,
      universityName: university.name,
      facultyId: faculty.id,
      facultyName: faculty.name,
      ...(facultyMatch ? { websiteUrl: facultyMatch.link.url, matchTitle: facultyMatch.link.title, sourcePageUrl: facultyMatch.link.sourcePageUrl } : {}),
      score: facultyMatch?.score ?? 0,
      status: facultyMatch ? "url_found" : "url_not_found"
    });

    for (const departmentSeed of facultySeed.departments) {
      const department = toDepartmentRecord(university.id, faculty.id, departmentSeed);
      const departmentMatch = bestAnchorMatch(links, department.name, department.slug, "department", faculty.name);
      matches.push({
        scopeType: "department",
        universityId: university.id,
        universityName: university.name,
        facultyId: faculty.id,
        facultyName: faculty.name,
        departmentId: department.id,
        departmentName: department.name,
        ...(departmentMatch ? { websiteUrl: departmentMatch.link.url, matchTitle: departmentMatch.link.title, sourcePageUrl: departmentMatch.link.sourcePageUrl } : {}),
        score: departmentMatch?.score ?? 0,
        status: departmentMatch ? "url_found" : "url_not_found"
      });
    }
  }

  const found = matches.filter((match) => match.status === "url_found").length;
  console.log(`${universityOffset + index + 1}/${catalog.universities.length} unitUrls=${found}/${matches.length} ${university.name}`);
  return matches;
}

async function collectAcademicUnitLinks(university: UniversityRecord): Promise<AnchorLink[]> {
  const links = new Map<string, AnchorLink>();
  const pageCandidates = new Set<string>();
  const verified = verifiedUniversitySources.get(university.id);

  for (const url of [verified?.announcementUrl]) {
    const homepage = homepageFromUrl(url);
    if (homepage) pageCandidates.add(homepage);
  }
  for (const homepage of buildHomepageCandidates(university).slice(0, 10)) pageCandidates.add(homepage);

  const pagesToInspect = new Set<string>();
  for (const homepageCandidate of pageCandidates) {
    try {
      const page = await fetchText(homepageCandidate, timeoutMs);
      if (!isLikelyUniversityHomepage(page.text, page.finalUrl, university)) continue;
      pagesToInspect.add(page.finalUrl);
      for (const path of academicUnitPaths) pagesToInspect.add(new URL(path, page.finalUrl).toString());
      for (const link of extractLinks(page.text, page.finalUrl, page.finalUrl)) {
        if (isAcademicUnitNavigationLink(link)) pagesToInspect.add(link.url);
        links.set(link.url, link);
      }
      break;
    } catch {
      continue;
    }
  }

  for (const pageUrl of [...pagesToInspect].slice(0, 28)) {
    try {
      const page = await fetchText(pageUrl, timeoutMs);
      for (const link of extractLinks(page.text, page.finalUrl, pageUrl)) links.set(link.url, link);
    } catch {
      continue;
    }
  }

  return [...links.values()];
}

function bestAnchorMatch(links: AnchorLink[], name: string, slug: string, scopeType: "faculty" | "department", facultyName?: string): { link: AnchorLink; score: number } | null {
  const matches = links
    .map((link) => ({ link, score: scoreAnchor(link, name, slug, scopeType, facultyName) }))
    .filter((match) => match.score >= (scopeType === "faculty" ? 80 : 90))
    .sort((left, right) => right.score - left.score || left.link.url.length - right.link.url.length);
  return matches[0] ?? null;
}

function scoreAnchor(link: AnchorLink, name: string, slug: string, scopeType: "faculty" | "department", facultyName?: string): number {
  const linkText = foldText(`${link.title} ${decodeURIComponentSafe(link.url)}`);
  const path = foldText(new URL(link.url).pathname.replace(/\//g, " "));
  const nameTokens = significantUnitTokens(name);
  const slugTokens = significantUnitTokens(slug.replace(/-/g, " "));
  const tokens = unique([...nameTokens, ...slugTokens]);
  if (tokens.length === 0) return 0;

  let score = 0;
  const foldedName = foldText(name);
  const slugCompact = slug.replace(/-/g, "");
  const compactLink = linkText.replace(/[^a-z0-9]+/g, "");
  if (foldedName.length > 8 && linkText.includes(foldedName)) score += 100;
  if (slugCompact.length > 8 && compactLink.includes(slugCompact)) score += 90;

  const matchedTokens = tokens.filter((token) => linkText.includes(token) || path.includes(token));
  score += matchedTokens.length * 22;
  if (matchedTokens.length >= Math.min(2, tokens.length)) score += 25;
  if (scopeType === "faculty" && /\b(fakulte|faculty|yo|myo|enstitu|instit)/u.test(linkText)) score += 20;
  if (scopeType === "department" && /\b(bolum|department|program|anabilim|abd)\b/u.test(linkText)) score += 20;
  if (facultyName && score > 0 && significantUnitTokens(facultyName).some((token) => linkText.includes(token))) score += 10;
  if (isNonAcademicNoise(linkText)) score -= 80;
  return score;
}

function extractLinks(html: string, baseUrl: string, sourcePageUrl: string): AnchorLink[] {
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const links: AnchorLink[] = [];
  for (const anchor of anchors) {
    const attrs = anchor[1] ?? "";
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    const title = cleanText(`${stripHtml(anchor[2] ?? "")} ${attrs.match(/\btitle=["']([^"']+)["']/i)?.[1] ?? ""} ${attrs.match(/\baria-label=["']([^"']+)["']/i)?.[1] ?? ""}`);
    try {
      const url = new URL(href, baseUrl).toString().replace(/#.*$/u, "");
      if (!isHttpUrl(url) || looksLikeAsset(url)) continue;
      links.push({ url, title, sourcePageUrl });
    } catch {
      continue;
    }
  }
  return links;
}

function isAcademicUnitNavigationLink(link: AnchorLink): boolean {
  const text = foldText(`${link.title} ${decodeURIComponentSafe(link.url)}`);
  return academicUnitNavigationHints.some((hint) => text.includes(hint));
}

function toUniversityRecord(seed: CatalogSeedUniversity): UniversityRecord {
  const now = new Date();
  return { id: seed.slug, name: seed.name, slug: seed.slug, city: seed.city, type: seed.type, status: "active", createdAt: now, updatedAt: now };
}

function toFacultyRecord(universityId: string, seed: CatalogSeedFaculty): FacultyRecord {
  const now = new Date();
  return { id: `${universityId}__${seed.slug}`, universityId, name: seed.name, slug: seed.slug, status: "active", createdAt: now, updatedAt: now };
}

function toDepartmentRecord(universityId: string, facultyId: string, seed: CatalogSeedDepartment): DepartmentRecord {
  const now = new Date();
  return { id: `${facultyId}__${seed.slug}`, universityId, facultyId, name: seed.name, slug: seed.slug, educationLevel: seed.educationLevel, status: "active", createdAt: now, updatedAt: now };
}

async function loadVerifiedUniversitySources(): Promise<Map<string, VerifiedUniversitySource>> {
  try {
    const raw = JSON.parse(await readFile(resolve(process.cwd(), "apps/api/src/bootstrap/verified-university-sources.json"), "utf8")) as VerifiedUniversitySource[];
    return new Map(raw.map((source) => [source.universityId, source]));
  } catch {
    return new Map();
  }
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

function homepageFromUrl(input?: string): string | undefined {
  if (!input) return undefined;
  try {
    return new URL("/", input).toString();
  } catch {
    return undefined;
  }
}

function significantUnitTokens(value: string): string[] {
  return foldText(value)
    .replace(/[^\p{L}\d]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length >= 3 && !unitStopWords.has(token));
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

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, " ");
}

function decodeURIComponentSafe(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//iu.test(input);
}

function looksLikeAsset(input: string): boolean {
  return /\.(?:css|js|jpg|jpeg|png|gif|svg|webp|ico|zip|rar|docx?|xlsx?|pptx?)(?:[?#]|$)/iu.test(input);
}

function isNonAcademicNoise(input: string): boolean {
  return /\b(yemek|ihale|kutuphane|library|spor|mezun|alumni|basin|duyuru|haber|news|announcement|kvkk|iletisim|contact)\b/u.test(input);
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const academicUnitPaths = [
  "/akademik",
  "/akademik/",
  "/akademik-birimler",
  "/akademik-birimler/",
  "/akademik-birimler/fakulteler",
  "/akademik-birimler/bolumler",
  "/fakulteler",
  "/fakulteler/",
  "/fakulte",
  "/bolumler",
  "/bolumler/",
  "/birimler",
  "/birimler/",
  "/tr/akademik",
  "/tr/akademik-birimler",
  "/tr/fakulteler",
  "/tr/bolumler",
  "/universite/akademik-birimler"
];

const academicUnitNavigationHints = [
  "akademik",
  "akademik birim",
  "fakulte",
  "fakulteler",
  "faculty",
  "bolum",
  "bolumler",
  "department",
  "enstitu",
  "yuksekokul",
  "meslek yuksekokulu"
];

const unitStopWords = new Set([
  "fakultesi",
  "fakulte",
  "faculty",
  "bolumu",
  "bolum",
  "department",
  "programi",
  "program",
  "meslek",
  "yuksekokulu",
  "yuksek",
  "okulu",
  "enstitusu",
  "enstitu",
  "bilimleri",
  "bilimler",
  "universitesi",
  "universite",
  "ve",
  "ile"
]);

await main();
