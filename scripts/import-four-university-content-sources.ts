import { readFile, writeFile } from "node:fs/promises";

type ContentType = "announcement" | "news" | "event" | "academic_calendar" | "course_schedule" | "exam_schedule" | "reference";
type ScopeHint = "university" | "academic_unit" | "university_or_unit";

interface SourceEntry {
  url: string;
  types: ContentType[];
  scopeHint: ScopeHint;
  matchedRuntimeScope?: string;
  validation?: {
    status: "reachable" | "redirected" | "blocked_by_site" | "broken" | "request_failed";
    httpStatus?: number;
    finalUrl?: string;
    error?: string;
  };
}

interface UniversityDefinition {
  universityId: string;
  universityName: string;
  domains: string[];
  mainHosts: string[];
  universitySources: {
    announcementUrl: string;
    newsUrl: string;
    eventUrl: string;
    calendarUrl: string;
  };
}

interface VerifiedUniversitySource {
  universityId: string;
  universityName: string;
  announcementUrl?: string | null;
  newsUrl?: string | null;
  eventUrl?: string | null;
  calendarUrl?: string | null;
  announcementStatus?: string;
  newsStatus?: string;
  eventStatus?: string;
  calendarStatus?: string;
  unmappedContentUrls?: string[];
  [key: string]: unknown;
}

interface VerifiedAcademicUnitSource {
  scopeType: "faculty" | "department";
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  websiteUrl?: string;
  announcementUrl?: string;
  newsUrl?: string;
  eventUrl?: string;
  courseScheduleUrl?: string;
  examScheduleUrl?: string;
  [key: string]: unknown;
}

const defaultInput = "C:/Users/buyuk/.codex/attachments/ce2f8b9c-182a-4c2d-a520-bc32e9433079/pasted-text.txt";
const outputPath = "data/verified-four-university-content-sources.json";
const universityRegistryPath = "apps/api/src/bootstrap/verified-university-sources.json";
const academicUnitRegistryPath = "apps/api/src/bootstrap/verified-academic-unit-sources.json";
const liveCheckEnabled = process.argv.includes("--live");
const timeoutMs = Number(process.env.FOUR_UNIVERSITY_SOURCE_TIMEOUT_MS ?? 9000);
const concurrency = Number(process.env.FOUR_UNIVERSITY_SOURCE_CONCURRENCY ?? 16);

const definitions: UniversityDefinition[] = [
  {
    universityId: "abdullah-gul-universitesi-kayseri",
    universityName: "ABDULLAH GUL UNIVERSITESI",
    domains: ["agu.edu.tr"],
    mainHosts: ["www.agu.edu.tr", "w3.agu.edu.tr", "oidb-tr.agu.edu.tr"],
    universitySources: {
      announcementUrl: "https://www.agu.edu.tr/duyurular",
      newsUrl: "https://www.agu.edu.tr/haberler",
      eventUrl: "https://www.agu.edu.tr/etkinlikler",
      calendarUrl: "https://oidb-tr.agu.edu.tr/akademik-takvim"
    }
  },
  {
    universityId: "acibadem-mehmet-ali-aydinlar-universitesi-istanbul",
    universityName: "ACIBADEM MEHMET ALI AYDINLAR UNIVERSITESI",
    domains: ["acibadem.edu.tr"],
    mainHosts: ["acibadem.edu.tr", "www.acibadem.edu.tr", "obs.acibadem.edu.tr"],
    universitySources: {
      announcementUrl: "https://www.acibadem.edu.tr/duyurular",
      newsUrl: "https://www.acibadem.edu.tr/haberler",
      eventUrl: "https://www.acibadem.edu.tr/etkinlikler",
      calendarUrl: "https://www.acibadem.edu.tr/ogrenci/ogrenci-isleri/akademik-takvim"
    }
  },
  {
    universityId: "adiyaman-universitesi",
    universityName: "ADIYAMAN UNIVERSITESI",
    domains: ["adiyaman.edu.tr"],
    mainHosts: ["adiyaman.edu.tr", "www.adiyaman.edu.tr"],
    universitySources: {
      announcementUrl: "https://adiyaman.edu.tr/tr/duyurular",
      newsUrl: "https://adiyaman.edu.tr/tr/haberler",
      eventUrl: "https://adiyaman.edu.tr/tr/etkinlikler",
      calendarUrl: "https://adiyaman.edu.tr/tr/egitim/akademik-takvim"
    }
  },
  {
    universityId: "afyon-kocatepe-universitesi-afyonkarahisar",
    universityName: "AFYON KOCATEPE UNIVERSITESI",
    domains: ["aku.edu.tr"],
    mainHosts: ["aku.edu.tr", "www.aku.edu.tr", "haber.aku.edu.tr", "ogrenci.aku.edu.tr"],
    universitySources: {
      announcementUrl: "https://aku.edu.tr/category/duyurular/",
      newsUrl: "https://haber.aku.edu.tr/category/haberler",
      eventUrl: "https://aku.edu.tr/etkinlik-arsivi",
      calendarUrl: "https://ogrenci.aku.edu.tr/2026-2027/"
    }
  }
];

const explicitScopeAliases = new Map<string, string>([
  ["mf-tr.agu.edu.tr", "abdullah-gul-universitesi-kayseri__muhendislik-fakultesi"],
  ["cmp.agu.edu.tr", "abdullah-gul-universitesi-kayseri__muhendislik-fakultesi__bilgisayar-muhendisligi"],
  ["fa-tr.agu.edu.tr", "abdullah-gul-universitesi-kayseri__mimarlik-fakultesi"]
]);

const dynamicCourseSchedulePages = new Set([
  "https://gsf.aku.edu.tr/geleneksel-turk-sanatlar-bolumu/",
  "https://gsf.aku.edu.tr/resim-bolumu/",
  "https://gsf.aku.edu.tr/sinema-ve-televizyon-bolumu/"
].map(canonicalKey));

async function main() {
  const inputPath = readArgument("--input") ?? defaultInput;
  const text = await readFile(inputPath, "utf8");
  const allEntries = extractSourceEntries(text);
  const universityRegistry = JSON.parse(await readFile(universityRegistryPath, "utf8")) as VerifiedUniversitySource[];
  const unitRegistry = JSON.parse(await readFile(academicUnitRegistryPath, "utf8")) as VerifiedAcademicUnitSource[];

  const universities = definitions.map((definition) => {
    const entries = allEntries.filter((entry) => belongsToDefinition(entry.url, definition));
    return {
      universityId: definition.universityId,
      universityName: definition.universityName,
      counts: countTypes(entries),
      sources: entries
    };
  });

  for (const definition of definitions) {
    patchUniversityRegistry(universityRegistry, definition);
    const entries = universities.find((item) => item.universityId === definition.universityId)?.sources ?? [];
    clearImportedAcademicUnitFields(unitRegistry, definition.universityId);
    patchAcademicUnitRegistry(unitRegistry, definition, entries);
    const unmapped = entries
      .filter((entry) => entry.scopeHint !== "university" && entry.types.some(isRuntimeContentType) && !entry.matchedRuntimeScope)
      .map((entry) => entry.url);
    const university = universityRegistry.find((record) => record.universityId === definition.universityId);
    if (university) university.unmappedContentUrls = unique(unmapped);
  }

  if (liveCheckEnabled) {
    await runLiveChecks(universities.flatMap((university) => university.sources));
  }

  const output = {
    generatedAt: new Date().toISOString(),
    sourceAttachment: inputPath.replace(/\\/g, "/"),
    ignoredDuplicateDomains: ["atu.edu.tr"],
    liveCheckEnabled,
    universities,
    automationTasks: [
      {
        id: "aku-current-academic-calendar",
        status: "implemented",
        description: "Build the AKU academic-calendar page from the current academic year instead of pinning an expired year.",
        implementation: "apps/api/src/modules/calendars/calendar-ingestion.service.ts"
      },
      {
        id: "aku-gsf-course-schedule-discovery",
        status: "implemented",
        description: "Inspect GSF department pages and prefer current-year fall/spring course-program PDF links.",
        implementation: "apps/api/src/modules/calendars/academic-unit-schedule-discovery.ts"
      },
      {
        id: "aku-sbf-popup-exam-discovery",
        status: "implemented",
        description: "Inspect SBF modal popup links for current-year exam-program PDFs; image-only PDFs use the existing OCR pipeline.",
        implementation: "apps/api/src/modules/calendars/academic-unit-schedule-discovery.ts"
      },
      {
        id: "aku-sbf-department-course-discovery",
        status: "implemented",
        description: "Read department links below the Bolumler menu and inspect each department page for current-year course-program PDFs.",
        implementation: "apps/api/src/modules/calendars/academic-unit-schedule-discovery.ts"
      }
    ]
  };

  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(universityRegistryPath, `${JSON.stringify(universityRegistry, null, 2)}\n`, "utf8");
  await writeFile(academicUnitRegistryPath, `${JSON.stringify(unitRegistry, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    outputPath,
    liveCheckEnabled,
    universities: universities.map((university) => ({
      universityId: university.universityId,
      total: university.sources.length,
      matchedRuntime: university.sources.filter((source) => source.matchedRuntimeScope).length,
      ...university.counts
    }))
  }, null, 2));
}

function extractSourceEntries(text: string): SourceEntry[] {
  const splitNestedUrls = text.replace(/\(https?:\/\//giu, (match) => `\n${match.slice(1)}`);
  const urls = [...splitNestedUrls.matchAll(/https?:\/\/[^\s"'<>]+/giu)]
    .map((match) => cleanUrlToken(match[0]))
    .filter((url): url is string => Boolean(url));
  const seen = new Set<string>();
  const entries: SourceEntry[] = [];
  for (const url of urls) {
    const definition = definitions.find((item) => belongsToDefinition(url, item));
    if (!definition) continue;
    const key = canonicalKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ url, types: classifyUrl(url), scopeHint: inferScope(url, definition) });
  }
  return entries;
}

function cleanUrlToken(input: string): string | null {
  const token = input.split("(")[0]?.replace(/[),.;]+$/gu, "").trim();
  if (!token) return null;
  try {
    const url = new URL(token);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

function classifyUrl(url: string): ContentType[] {
  const text = foldText(decodeUrlSafe(url));
  const types: ContentType[] = [];
  if (/akademik[-_ ]*takvim|academic[-_ ]*calendar|ogrenci\.aku\.edu\.tr\/20\d{2}[-/]20\d{2}/u.test(text)) types.push("academic_calendar");
  if (/ders[-_ ]*program/u.test(text) || dynamicCourseSchedulePages.has(canonicalKey(url))) types.push("course_schedule");
  if (/sinav[-_ ]*program|exam[-_ ]*schedule/u.test(text)) types.push("exam_schedule");
  if (/duyuru|genel-duyurular|ilanlar/u.test(text)) types.push("announcement");
  if (/haber/u.test(text)) types.push("news");
  if (/etkinlik/u.test(text)) types.push("event");
  return unique(types.length > 0 ? types : ["reference"]);
}

function inferScope(url: string, definition: UniversityDefinition): ScopeHint {
  const parsed = new URL(url);
  const host = parsed.hostname.toLocaleLowerCase("en-US");
  if (!definition.mainHosts.includes(host)) return "academic_unit";
  if (definition.universityId.startsWith("acibadem-") && /^\/(?:en\/)?(?:haberler|duyurular)\/\d+/u.test(parsed.pathname)) return "university_or_unit";
  return "university";
}

function patchUniversityRegistry(registry: VerifiedUniversitySource[], definition: UniversityDefinition): void {
  const record = registry.find((item) => item.universityId === definition.universityId);
  if (!record) throw new Error(`University registry record not found: ${definition.universityId}`);
  Object.assign(record, definition.universitySources, {
    announcementStatus: "source_found",
    newsStatus: "source_found",
    eventStatus: "source_found",
    calendarStatus: "source_found"
  });
}

function patchAcademicUnitRegistry(registry: VerifiedAcademicUnitSource[], definition: UniversityDefinition, entries: SourceEntry[]): void {
  const records = registry.filter((record) => record.universityId === definition.universityId);
  for (const entry of entries) {
    if (entry.scopeHint === "university" || !entry.types.some((type) => isRuntimeContentType(type) || type === "course_schedule" || type === "exam_schedule")) continue;
    const matches = matchAcademicUnitRecords(entry.url, records);
    for (const record of matches) {
      for (const type of entry.types) {
        if (type === "announcement") record.announcementUrl = entry.url;
        if (type === "news") record.newsUrl = entry.url;
        if (type === "event") record.eventUrl = entry.url;
        if (type === "course_schedule" && record.scopeType === "department") record.courseScheduleUrl = entry.url;
        if (type === "exam_schedule" && record.scopeType === "department") record.examScheduleUrl = entry.url;
      }
      entry.matchedRuntimeScope = record.departmentId ?? record.facultyId;
    }
  }
}

function clearImportedAcademicUnitFields(registry: VerifiedAcademicUnitSource[], universityId: string): void {
  for (const record of registry) {
    if (record.universityId !== universityId) continue;
    delete record.announcementUrl;
    delete record.newsUrl;
    delete record.eventUrl;
    delete record.courseScheduleUrl;
    delete record.examScheduleUrl;
  }
}

function matchAcademicUnitRecords(sourceUrl: string, records: VerifiedAcademicUnitSource[]): VerifiedAcademicUnitSource[] {
  const source = new URL(sourceUrl);
  const alias = explicitScopeAliases.get(source.hostname.toLocaleLowerCase("en-US"));
  if (alias) return records.filter((record) => record.departmentId === alias || (record.scopeType === "faculty" && record.facultyId === alias));

  const sourceBasePath = stripContentPath(source.pathname);
  const scored = records
    .map((record) => ({ record, score: scoreUnitMatch(source, sourceBasePath, record, records) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const best = scored[0]?.score ?? 0;
  return scored.filter((candidate) => candidate.score === best).map((candidate) => candidate.record);
}

function scoreUnitMatch(source: URL, sourceBasePath: string, record: VerifiedAcademicUnitSource, records: VerifiedAcademicUnitSource[]): number {
  if (!record.websiteUrl) return 0;
  let website: URL;
  try {
    website = new URL(record.websiteUrl);
  } catch {
    return 0;
  }
  if (website.hostname.toLocaleLowerCase("en-US") !== source.hostname.toLocaleLowerCase("en-US")) return 0;
  const websitePath = normalizePath(stripContentPath(website.pathname));
  const normalizedSourcePath = normalizePath(sourceBasePath);
  if (websitePath === normalizedSourcePath) return 1000 + websitePath.length;
  if (websitePath !== "/" && (normalizedSourcePath.startsWith(`${websitePath}/`) || websitePath.startsWith(`${normalizedSourcePath}/`))) return 700 + Math.min(websitePath.length, normalizedSourcePath.length);
  const sameHostCount = recordsForHost(records, source.hostname).length;
  return sameHostCount === 1 ? 100 : 0;
}

function recordsForHost(records: VerifiedAcademicUnitSource[], host: string): VerifiedAcademicUnitSource[] {
  return records.filter((record) => {
    try {
      return record.websiteUrl && new URL(record.websiteUrl).hostname === host;
    } catch {
      return false;
    }
  });
}

function stripContentPath(pathname: string): string {
  return pathname
    .replace(/\/(?:tr\/)?(?:category\/)?(?:duyurular?|genel-duyurular|lisans-duyurulari|lisansustu-duyurulari|sinav-duyurulari|haberler?|etkinlikler?)\/?$/iu, "")
    .replace(/\/(?:haberler?|duyurular?)\/\d+\/?$/iu, "") || "/";
}

function normalizePath(pathname: string): string {
  const value = pathname.replace(/\/+$/u, "");
  return value || "/";
}

async function runLiveChecks(entries: SourceEntry[]): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      if (entry) entry.validation = await checkUrl(entry.url);
    }
  }));
}

async function checkUrl(url: string): Promise<NonNullable<SourceEntry["validation"]>> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Range: "bytes=0-8191",
        "User-Agent": "AcademicMobileSourceVerifier/1.0"
      }
    });
    const finalUrl = response.url || url;
    if ([401, 403, 406, 429].includes(response.status)) return { status: "blocked_by_site", httpStatus: response.status, finalUrl };
    if (!response.ok) return { status: "broken", httpStatus: response.status, finalUrl };
    return { status: canonicalKey(finalUrl) === canonicalKey(url) ? "reachable" : "redirected", httpStatus: response.status, finalUrl };
  } catch (error) {
    return { status: "request_failed", error: error instanceof Error ? error.message : String(error) };
  }
}

function belongsToDefinition(input: string, definition: UniversityDefinition): boolean {
  try {
    const host = new URL(input).hostname.toLocaleLowerCase("en-US");
    return definition.domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function countTypes(entries: SourceEntry[]) {
  return {
    total: entries.length,
    announcement: entries.filter((entry) => entry.types.includes("announcement")).length,
    news: entries.filter((entry) => entry.types.includes("news")).length,
    event: entries.filter((entry) => entry.types.includes("event")).length,
    academicCalendar: entries.filter((entry) => entry.types.includes("academic_calendar")).length,
    courseSchedule: entries.filter((entry) => entry.types.includes("course_schedule")).length,
    examSchedule: entries.filter((entry) => entry.types.includes("exam_schedule")).length,
    reference: entries.filter((entry) => entry.types.includes("reference")).length
  };
}

function isRuntimeContentType(type: ContentType): boolean {
  return type === "announcement" || type === "news" || type === "event";
}

function canonicalKey(input: string): string {
  try {
    const url = new URL(input);
    url.hostname = url.hostname.toLocaleLowerCase("en-US");
    url.pathname = normalizePath(url.pathname);
    return url.toString();
  } catch {
    return input;
  }
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function decodeUrlSafe(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/gu, "i")
    .replace(/\u0130/gu, "I")
    .toLocaleLowerCase("en-US");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
