import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildHomepageCandidates, discoverAnnouncementSourceForAcademicScope, discoverAnnouncementSourceForUniversity } from "../apps/api/src/modules/announcements/announcement-ingestion.service.js";
import { cleanText, fetchText } from "../apps/api/src/modules/announcements/announcement-parser.js";
import { discoverAcademicCalendarPdf } from "../apps/api/src/modules/calendars/calendar-ingestion.service.js";
import type { DepartmentRecord, FacultyRecord, UniversityRecord } from "../apps/api/src/modules/catalog/catalog.types.js";

interface SeedDepartment {
  name: string;
  slug: string;
  educationLevel: string;
}

interface SeedFaculty {
  name: string;
  slug: string;
  departments: SeedDepartment[];
}

interface SeedUniversity {
  name: string;
  slug: string;
  city: string;
  type: "state" | "foundation" | "private";
  faculties: SeedFaculty[];
}

interface CatalogSeed {
  universities: SeedUniversity[];
}

const slug = process.argv[2];
if (!slug) throw new Error("Usage: tsx scripts/audit-single-university-retrieval.ts <university-slug>");

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "https://academic-calendar-api-qrld4semgq-ew.a.run.app";
const outputDir = resolve(process.cwd(), process.env.PW_UNIVERSITY_AUDIT_OUTPUT_DIR ?? ".tmp-test-run/playwright-university-audit");
const sourceTimeoutMs = readPositiveInteger(process.env.PW_SOURCE_TIMEOUT_MS, 12_000);
const apiTimeoutMs = readPositiveInteger(process.env.PW_API_TIMEOUT_MS, 150_000);
const workerHardTimeoutMs = readPositiveInteger(process.env.PW_WORKER_HARD_TIMEOUT_MS, 280_000);

const catalog = JSON.parse(await readFile(resolve(process.cwd(), "apps/api/src/bootstrap/turkiye-catalog-seed.json"), "utf8")) as CatalogSeed;
const seed = catalog.universities.find((university) => university.slug === slug);
if (!seed) throw new Error(`University seed not found: ${slug}`);

const university: UniversityRecord = {
  id: seed.slug,
  name: seed.name,
  slug: seed.slug,
  city: seed.city,
  type: seed.type,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date()
};
const sampledAcademicScope = buildSampleAcademicScope(seed, university.id);

const startedAt = Date.now();
let completed = false;
const hardTimeout = setTimeout(() => {
  if (completed) return;
  void writeAuditResult(buildTimeoutResult()).finally(() => process.exit(0));
}, workerHardTimeoutMs);

try {
  const [announcement, calendarSource] = await Promise.all([
    auditAnnouncementSource(university),
    auditCalendarSource(university)
  ]);
  const departmentScopedRetrieval = sampledAcademicScope
    ? await auditAcademicScopeRetrieval(university, sampledAcademicScope)
    : {
        supported: false,
        reason: "Catalog seed has no faculty/department sample for scoped retrieval verification."
      };
  const calendarApi = await auditCalendarApi(university.id);
  await writeAuditResult({
    universityId: university.id,
    universityName: university.name,
    city: university.city,
    facultyCount: seed.faculties.length,
    departmentCount: seed.faculties.reduce((total, faculty) => total + faculty.departments.length, 0),
    announcement,
    calendar: {
      ...calendarSource,
      ...calendarApi
    },
    departmentScopedRetrieval,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    workerStatus: "completed"
  });
} finally {
  completed = true;
  clearTimeout(hardTimeout);
}

function buildTimeoutResult() {
  return {
    universityId: university.id,
    universityName: university.name,
    city: university.city,
    facultyCount: seed.faculties.length,
    departmentCount: seed.faculties.reduce((total, faculty) => total + faculty.departments.length, 0),
    announcement: {
      status: "failed",
      reason: "Audit worker hard-timed-out before announcement discovery completed. This indicates a crawler/network path that can hang past the configured fetch timeout for this university.",
      itemCount: 0,
      sampleTitles: [],
      error: `hard_timeout_after_${workerHardTimeoutMs}ms`
    },
    calendar: {
      status: "failed",
      reason: "Audit worker hard-timed-out before calendar discovery/API verification completed. This indicates a crawler/network path that can hang past the configured fetch timeout for this university.",
      apiStatus: 0,
      apiOk: false,
      apiEventCount: 0,
      apiError: `hard_timeout_after_${workerHardTimeoutMs}ms`
    },
    departmentScopedRetrieval: {
      supported: false,
      reason: "Audit worker hard-timed-out before scoped faculty/department announcement retrieval could be verified."
    },
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    workerStatus: "hard_timeout"
  };
}

async function writeAuditResult(result: {
  universityId: string;
  universityName: string;
  city: string;
  facultyCount: number;
  departmentCount: number;
  announcement: {
    status: string;
    reason: string;
    sourceUrl?: string;
    itemCount: number;
    sampleTitles: string[];
    error?: string;
  };
  calendar: {
    status: string;
    reason: string;
    sourceUrl?: string;
    title?: string;
    apiStatus: number;
    apiOk: boolean;
    apiAcademicYear?: string;
    apiEventCount: number;
    apiSourceUrl?: string;
    apiError?: string;
  };
  departmentScopedRetrieval: {
    supported: boolean;
    facultyName?: string;
    departmentName?: string;
    announcementStatus?: string;
    announcementSourceUrl?: string;
    announcementItemCount?: number;
    calendarStatus?: "inherited_university";
    reason: string;
  };
  checkedAt: string;
  durationMs: number;
  workerStatus: string;
}) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, `${university.slug}.json`), JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify({
    universityId: result.universityId,
    workerStatus: result.workerStatus,
    announcementStatus: result.announcement.status,
    calendarStatus: result.calendar.status,
    calendarApiStatus: result.calendar.apiStatus,
    calendarApiEventCount: result.calendar.apiEventCount
  }));
}

async function auditAnnouncementSource(input: UniversityRecord) {
  try {
    const result = await discoverAnnouncementSourceForUniversity(input, { timeoutMs: sourceTimeoutMs });
    if (result.status === "source_found") {
      return {
        status: "source_found",
        reason: "A parseable announcement listing was discovered.",
        sourceUrl: result.sourceUrl,
        itemCount: result.itemCount,
        sampleTitles: result.sampleTitles
      };
    }
    return {
      status: result.status,
      reason: await classifyMissingAnnouncement(input, result.error),
      itemCount: result.itemCount,
      sampleTitles: result.sampleTitles,
      ...(result.homepageUrl ? { sourceUrl: result.homepageUrl } : {}),
      ...(result.error ? { error: result.error } : {})
    };
  } catch (error) {
    return {
      status: "failed",
      reason: "Announcement discovery threw before it could classify a source.",
      itemCount: 0,
      sampleTitles: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function auditCalendarSource(input: UniversityRecord) {
  try {
    const source = await discoverAcademicCalendarPdf(input, sourceTimeoutMs);
    if (source) {
      return {
        status: "source_found",
        reason: "A current/acceptable academic-calendar PDF source was discovered.",
        sourceUrl: source.sourceUrl,
        title: source.title
      };
    }
    return {
      status: "source_not_found",
      reason: await classifyMissingCalendar(input)
    };
  } catch (error) {
    return {
      status: "failed",
      reason: "Academic calendar discovery threw before it could classify a source.",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function auditCalendarApi(universityId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), apiTimeoutMs);
  try {
    const response = await fetch(`${apiBaseUrl}/calendar/university/${encodeURIComponent(universityId)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const text = await response.text();
    const body = parseJson(text);
    const calendar = isRecord(body) && isRecord(body.calendar) ? body.calendar : undefined;
    const events = isRecord(body) && Array.isArray(body.events) ? body.events : [];
    return {
      apiStatus: response.status,
      apiOk: response.ok,
      ...(typeof calendar?.academicYear === "string" ? { apiAcademicYear: calendar.academicYear } : {}),
      apiEventCount: events.length,
      ...(typeof calendar?.sourceUrl === "string" ? { apiSourceUrl: calendar.sourceUrl } : {}),
      ...(!response.ok ? { apiError: readApiError(body, text) } : {})
    };
  } catch (error) {
    return {
      apiStatus: 0,
      apiOk: false,
      apiEventCount: 0,
      apiError: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function auditAcademicScopeRetrieval(input: UniversityRecord, scope: { faculty: FacultyRecord; department?: DepartmentRecord }) {
  const announcement = await discoverAnnouncementSourceForAcademicScope(input, scope, { timeoutMs: sourceTimeoutMs }).catch((error) => ({
    status: "failed",
    sourceUrl: undefined,
    itemCount: 0,
    error: error instanceof Error ? error.message : String(error)
  }));

  const announcementFound = announcement.status === "source_found" && Boolean(announcement.sourceUrl);
  return {
    supported: announcementFound,
    facultyName: scope.faculty.name,
    ...(scope.department ? { departmentName: scope.department.name } : {}),
    announcementStatus: announcement.status,
    ...(announcement.sourceUrl ? { announcementSourceUrl: announcement.sourceUrl } : {}),
    announcementItemCount: announcement.itemCount,
    calendarStatus: "inherited_university" as const,
    reason: announcementFound
      ? "Faculty/department announcements were discovered; academic calendar is inherited from the central university calendar."
      : "No faculty/department announcement source was visible through static homepage links, scoped paths or scoped subdomain candidates; academic calendar is inherited from the central university calendar."
  };
}

function buildSampleAcademicScope(seedUniversity: SeedUniversity, universityId: string): { faculty: FacultyRecord; department?: DepartmentRecord } | null {
  const facultySeed = [...seedUniversity.faculties]
    .sort((left, right) => scoreFacultyForScopedAudit(right) - scoreFacultyForScopedAudit(left))
    .find((faculty) => faculty.departments.length > 0) ?? seedUniversity.faculties[0];
  if (!facultySeed) return null;

  const now = new Date();
  const faculty: FacultyRecord = {
    id: facultySeed.slug,
    universityId,
    name: facultySeed.name,
    slug: facultySeed.slug,
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  const departmentSeed = facultySeed.departments[0];
  if (!departmentSeed) return { faculty };

  return {
    faculty,
    department: {
      id: departmentSeed.slug,
      universityId,
      facultyId: faculty.id,
      name: departmentSeed.name,
      slug: departmentSeed.slug,
      educationLevel: departmentSeed.educationLevel as DepartmentRecord["educationLevel"],
      status: "active",
      createdAt: now,
      updatedAt: now
    }
  };
}

function scoreFacultyForScopedAudit(faculty: SeedFaculty): number {
  const text = foldText(`${faculty.name} ${faculty.slug}`);
  let score = faculty.departments.length;
  for (const keyword of ["muhendislik", "tip", "egitim", "hukuk", "iktisadi", "idari", "saglik bilim", "fen edebiyat", "iletisim", "ilahiyat"]) {
    if (text.includes(keyword)) score += 50;
  }
  if (text.includes("meslek yuksekokulu")) score -= 20;
  return score;
}

async function classifyMissingAnnouncement(input: UniversityRecord, existingError?: string): Promise<string> {
  const homepage = await inspectHomepage(input, ["duyuru", "announcement", "haber", "news", "ilan"]);
  if (!homepage.reachable) return `No reachable university homepage candidate. Last error: ${existingError ?? homepage.error ?? "unknown"}`;
  if (homepage.hasKeyword && homepage.hasAnchors) return "Homepage/static HTML mentions announcements, but the crawler could not find a parseable listing with items. Likely JS-rendered listing, nonstandard API, or unsupported detail/listing shape.";
  if (homepage.hasKeyword) return "Homepage/static HTML mentions announcements but exposes no usable announcement anchors. Likely client-rendered navigation or hidden API.";
  return "No announcement link or keyword was visible in the reachable static homepage HTML.";
}

async function classifyMissingCalendar(input: UniversityRecord): Promise<string> {
  const homepage = await inspectHomepage(input, ["akademik takvim", "academic calendar", "takvim"]);
  if (!homepage.reachable) return `No reachable university homepage candidate. Last error: ${homepage.error ?? "unknown"}`;
  if (homepage.hasKeyword && homepage.hasPdf) return "Static HTML contains calendar/PDF hints, but discovery rejected them, usually because the linked year is stale or the link shape is unsupported.";
  if (homepage.hasKeyword && homepage.hasAnchors) return "Static HTML mentions academic calendar, but no current acceptable PDF was found in homepage, known paths, or linked pages.";
  if (homepage.hasKeyword) return "Static HTML mentions academic calendar but exposes no usable anchors. Likely client-rendered navigation or hidden API.";
  return "No academic-calendar link or keyword was visible in the reachable static homepage HTML.";
}

async function inspectHomepage(input: UniversityRecord, keywords: string[]) {
  let lastError = "";
  for (const homepageUrl of buildHomepageCandidates(input).slice(0, 16)) {
    try {
      const page = await fetchText(homepageUrl, sourceTimeoutMs);
      const text = foldText(page.text.slice(0, 160_000));
      const hasKeyword = keywords.some((keyword) => text.includes(foldText(keyword)));
      return {
        reachable: true,
        url: page.finalUrl,
        hasKeyword,
        hasPdf: /\.pdf(?:["')\s?#]|$)/iu.test(page.text),
        hasAnchors: /<a\b[^>]*href=/iu.test(page.text)
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { reachable: false, hasKeyword: false, hasPdf: false, hasAnchors: false, error: lastError };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function readApiError(body: unknown, fallback: string): string {
  if (isRecord(body) && typeof body.message === "string") return body.message;
  return fallback.slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
