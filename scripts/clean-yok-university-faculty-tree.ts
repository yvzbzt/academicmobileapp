import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface FacultyLink {
  name: string;
  url: string;
  unitType?: string;
  sourcePageUrl?: string;
  confidence?: number;
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
  cleanup?: CleanupStats;
}

interface FacultyTreeFile {
  generatedAt: string;
  input?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  cleanup?: CleanupSummary;
  universities: UniversityFacultyTree[];
}

interface CleanupStats {
  beforeFacultyCount: number;
  afterFacultyCount: number;
  removedFacultyCount: number;
}

interface CleanupSummary {
  cleanedAt: string;
  beforeFacultyLinks: number;
  afterFacultyLinks: number;
  removedFacultyLinks: number;
  beforeUniversitiesWithFaculties: number;
  afterUniversitiesWithFaculties: number;
}

const inputPath = resolve(process.cwd(), process.env.YOK_FACULTY_TREE_INPUT ?? "data/yok-university-faculty-tree.json");
const outputPath = resolve(process.cwd(), process.env.YOK_FACULTY_TREE_OUTPUT ?? inputPath);

async function main(): Promise<void> {
  const tree = JSON.parse(await readFile(inputPath, "utf8")) as FacultyTreeFile;
  const beforeFacultyLinks = countFacultyLinks(tree.universities);
  const beforeUniversitiesWithFaculties = tree.universities.filter((university) => university.facultyCount > 0).length;

  const cleanedUniversities = tree.universities.map(cleanUniversity);
  const afterFacultyLinks = countFacultyLinks(cleanedUniversities);
  const afterUniversitiesWithFaculties = cleanedUniversities.filter((university) => university.facultyCount > 0).length;

  const cleanup: CleanupSummary = {
    cleanedAt: new Date().toISOString(),
    beforeFacultyLinks,
    afterFacultyLinks,
    removedFacultyLinks: beforeFacultyLinks - afterFacultyLinks,
    beforeUniversitiesWithFaculties,
    afterUniversitiesWithFaculties
  };

  const output: FacultyTreeFile = {
    ...tree,
    generatedAt: new Date().toISOString(),
    summary: buildSummary(cleanedUniversities),
    cleanup,
    universities: cleanedUniversities
  };

  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(cleanup, null, 2));
  console.log(`Cleaned faculty tree written to ${outputPath}`);
}

function cleanUniversity(university: UniversityFacultyTree): UniversityFacultyTree {
  const beforeFacultyCount = university.faculties.length;
  const deduped = new Map<string, FacultyLink>();

  for (const faculty of university.faculties) {
    const normalized = normalizeFaculty(faculty);
    if (!normalized) continue;

    const nameKey = foldText(normalized.name);
    const urlKey = normalizeUrlForLookup(normalized.url);
    const key = `${nameKey}|${urlKey}`;
    const existing = deduped.get(key);
    if (!existing || rankFacultyLink(normalized) > rankFacultyLink(existing)) deduped.set(key, normalized);
  }

  const byName = new Map<string, FacultyLink>();
  for (const faculty of deduped.values()) {
    const key = foldText(faculty.name);
    const existing = byName.get(key);
    if (!existing || rankFacultyLink(faculty) > rankFacultyLink(existing)) byName.set(key, faculty);
  }

  const faculties = [...byName.values()]
    .sort((left, right) => left.name.localeCompare(right.name, "tr-TR") || left.url.length - right.url.length);
  const cleanup: CleanupStats = {
    beforeFacultyCount,
    afterFacultyCount: faculties.length,
    removedFacultyCount: beforeFacultyCount - faculties.length
  };

  return {
    ...university,
    status: inferStatus(university, faculties.length),
    facultyCount: faculties.length,
    faculties,
    cleanup
  };
}

function normalizeFaculty(faculty: FacultyLink): FacultyLink | null {
  const name = normalizeFacultyName(faculty.name);
  if (!name || !isSpecificAcademicUnitName(name)) return null;
  if (containsAnnouncementNoise(name)) return null;
  if (!isLikelyAcademicUnitLandingUrl(faculty.url)) return null;

  return {
    name,
    url: normalizeFacultyUrl(faculty.url),
    ...(faculty.unitType ? { unitType: faculty.unitType } : {}),
    ...(faculty.sourcePageUrl ? { sourcePageUrl: faculty.sourcePageUrl } : {}),
    ...(typeof faculty.confidence === "number" ? { confidence: faculty.confidence } : {})
  };
}

function normalizeFacultyName(value: string): string | null {
  let cleaned = value
    .replace(/\s+/gu, " ")
    .replace(/\s+\|\s+.*$/u, "")
    .trim();

  cleaned = collapseRepeatedName(cleaned);
  cleaned = stripLeadingAcronym(cleaned);

  if (!cleaned || cleaned.length > 90) return null;
  if (cleaned.split(/\s+/u).length > 11) return null;
  return cleaned;
}

function isSpecificAcademicUnitName(name: string): boolean {
  const folded = foldText(name);
  if (genericTitles.has(folded)) return false;
  if (/\b(fakultesi|enstitusu|yuksekokulu|konservatuvari)\b$/u.test(folded)) return true;
  if (/^(faculty|school|institute|college) of \b/u.test(folded)) return true;
  if (/\b(faculty|school|institute|vocational school|college)$/u.test(folded)) return true;
  return false;
}

function containsAnnouncementNoise(name: string): boolean {
  const folded = foldText(name);
  return /\b(duyuru|duyurular|duyurusu|haber|haberler|haberi|etkinlik|etkinlikler|konferans|toplanti|seminer|sempozyum|kongre|toren|toreni|mezuniyet|sinav|sonuc|sonucu|ilan|alimi|arastirma|proje|ogrenci toplulugu|kurallari|yonetmelik|akreditasyon|takvim|calendar|basvuru|kayit)\b/u.test(folded);
}

function isLikelyAcademicUnitLandingUrl(input: string): boolean {
  try {
    const url = new URL(input);
    const foldedPath = foldText(decodeURIComponentSafe(url.pathname));
    const segments = foldedPath.split("/").filter(Boolean);
    if (segments.some((segment) => urlNoiseSegments.has(segment))) return false;
    if (/(?:^|\/)(?:19|20)\d{2}(?:\/|$)/u.test(foldedPath)) return false;
    if (/\b(duyuru|duyurular|haber|haberler|news|announcement|announcements|event|events|etkinlik|etkinlikler|ilan|sinav|mezuniyet|toplanti|konferans|kongre|seminer|sonuc|basvuru|kayit|ogrenci|personel|yonetim|kurul|komisyon|kalite|form|forms|hakkinda|tarihce|misyon|vizyon|organizasyon|arsiv|archive|arama|search)\b/u.test(foldedPath)) return false;
    if (segments.length === 0) return true;
    if (segments.length === 1 && languageSegments.has(segments[0] ?? "")) return true;
    if (segments.length <= 4 && academicPathHints.some((hint) => foldedPath.includes(hint))) return true;
    if (segments.length <= 2 && looksLikeAcademicUnitSubdomain(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

function rankFacultyLink(faculty: FacultyLink): number {
  let score = typeof faculty.confidence === "number" ? faculty.confidence : 0;
  try {
    const url = new URL(faculty.url);
    const path = foldText(url.pathname);
    const segments = path.split("/").filter(Boolean);
    if (url.protocol === "https:") score += 12;
    if (segments.length === 0) score += 80;
    if (segments.length === 1 && languageSegments.has(segments[0] ?? "")) score += 65;
    if (looksLikeAcademicUnitSubdomain(url.hostname)) score += 35;
    score -= faculty.url.length / 10;
  } catch {
    score -= 100;
  }
  return score;
}

function inferStatus(university: UniversityFacultyTree, facultyCount: number): UniversityFacultyTree["status"] {
  if (facultyCount > 0 && university.errors.length > 0) return "partial";
  if (facultyCount > 0) return "ok";
  if (university.errors.length > 0) return "failed";
  return "partial";
}

function buildSummary(universities: UniversityFacultyTree[]): Record<string, unknown> {
  return {
    totalUniversities: universities.length,
    completedUniversities: universities.filter((university) => university.status !== "pending").length,
    okUniversities: universities.filter((university) => university.status === "ok").length,
    partialUniversities: universities.filter((university) => university.status === "partial").length,
    failedUniversities: universities.filter((university) => university.status === "failed").length,
    universitiesWithFaculties: universities.filter((university) => university.facultyCount > 0).length,
    totalFacultyLinks: countFacultyLinks(universities)
  };
}

function collapseRepeatedName(value: string): string {
  const words = value.split(/\s+/u).filter(Boolean);
  if (words.length % 2 !== 0 || words.length < 4) return value;

  const midpoint = words.length / 2;
  const firstHalf = words.slice(0, midpoint).join(" ");
  const secondHalf = words.slice(midpoint).join(" ");
  return foldText(firstHalf) === foldText(secondHalf) ? firstHalf : value;
}

function stripLeadingAcronym(value: string): string {
  const stripped = value.replace(/^[\p{Lu}\d.]{2,8}\s+/u, "").trim();
  return stripped && stripped !== value && isSpecificAcademicUnitName(stripped) ? stripped : value;
}

function countFacultyLinks(universities: UniversityFacultyTree[]): number {
  return universities.reduce((total, university) => total + university.facultyCount, 0);
}

function normalizeFacultyUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

function normalizeUrlForLookup(input: string): string {
  try {
    return normalizeFacultyUrl(input).replace(/\/$/u, "");
  } catch {
    return input.trim().replace(/\/$/u, "");
  }
}

function looksLikeAcademicUnitSubdomain(hostname: string): boolean {
  const folded = foldText(hostname.split(".")[0] ?? "");
  return academicSubdomainHints.some((hint) => folded.includes(hint));
}

function foldText(value: string): string {
  return value
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

const genericTitles = new Set([
  "akademik",
  "akademik birimler",
  "birimler",
  "fakulte",
  "fakulteler",
  "faculty",
  "faculties",
  "school",
  "schools",
  "institute",
  "institutes",
  "enstitu",
  "enstituler",
  "yuksekokul",
  "yuksekokullar",
  "meslek yuksekokullari"
]);

const languageSegments = new Set(["tr", "en", "eng", "english", "turkce"]);

const urlNoiseSegments = new Set([
  "duyurular",
  "haberler",
  "news",
  "announcements",
  "events",
  "etkinlik",
  "etkinlikler",
  "arsiv",
  "archive"
]);

const academicPathHints = [
  "fakulte",
  "fakultesi",
  "faculty",
  "faculties",
  "enstitu",
  "institute",
  "yuksekokul",
  "school",
  "college",
  "konservatuvar",
  "akademik-birim"
];

const academicSubdomainHints = [
  "fef",
  "iibf",
  "sbf",
  "gsf",
  "egitim",
  "muh",
  "muhendis",
  "hukuk",
  "tip",
  "dis",
  "ecz",
  "ilahiyat",
  "iletisim",
  "mim",
  "saglik",
  "ziraat",
  "veteriner",
  "turizm",
  "spor",
  "teknoloji",
  "fen",
  "edebiyat",
  "faculty",
  "school",
  "institute"
];

await main();
