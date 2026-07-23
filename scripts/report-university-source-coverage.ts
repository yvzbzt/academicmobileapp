import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type SourceRecord = {
  universityId: string;
  universityName: string;
  city?: string;
  announcementUrl?: string | null;
  newsUrl?: string | null;
  eventUrl?: string | null;
  calendarUrl?: string | null;
  summerSchoolUrl?: string | null;
  announcementStatus?: string | null;
  newsStatus?: string | null;
  eventStatus?: string | null;
  calendarStatus?: string | null;
  summerSchoolStatus?: string | null;
  unmappedContentUrls?: string[];
};

type AcademicUnitSourceRecord = {
  scopeType: "faculty" | "department";
  universityId: string;
  universityName?: string;
  facultyId?: string;
  facultyName?: string;
  departmentId?: string;
  departmentName?: string;
  websiteUrl?: string;
  announcementUrl?: string | null;
  newsUrl?: string | null;
  eventUrl?: string | null;
  courseScheduleUrl?: string | null;
  examScheduleUrl?: string | null;
};

type LiveCheckResult = {
  field: "announcementUrl" | "newsUrl" | "eventUrl" | "calendarUrl" | "summerSchoolUrl";
  url: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  error?: string;
};

type ReportRecord = SourceRecord & {
  missingAnnouncement: boolean;
  missingNews: boolean;
  missingEvent: boolean;
  missingCalendar: boolean;
  missingSummerSchool: boolean;
  liveChecks?: LiveCheckResult[];
};

type AcademicUnitCoverageRecord = {
  universityId: string;
  universityName: string;
  totalRecords: number;
  facultyRecords: number;
  departmentRecords: number;
  announcementSourceRecords: number;
  newsSourceRecords: number;
  eventSourceRecords: number;
  courseScheduleSourceRecords: number;
  examScheduleSourceRecords: number;
};

type SuppliedSourceVerification = {
  generatedAt?: string;
  liveCheckEnabled?: boolean;
  universities?: Array<{
    universityId: string;
    universityName: string;
    sources: Array<{
      url: string;
      validation?: {
        status: "reachable" | "redirected" | "blocked_by_site" | "broken" | "request_failed";
        httpStatus?: number;
        error?: string;
      };
    }>;
  }>;
};

const sourcePath = "apps/api/src/bootstrap/verified-university-sources.json";
const academicUnitSourcePath = "apps/api/src/bootstrap/verified-academic-unit-sources.json";
const suppliedSourceVerificationPath = "data/verified-four-university-content-sources.json";
const jsonOutputPath = "data/university-source-coverage-report.json";
const markdownOutputPath = "docs/university-source-coverage-report.md";
const liveCheckEnabled = process.argv.includes("--live");
const timeoutMs = Number(process.env.SOURCE_REPORT_TIMEOUT_MS ?? 8000);
const concurrency = Number(process.env.SOURCE_REPORT_CONCURRENCY ?? 8);

const sourceFields = [
  ["announcementUrl", "announcementStatus"] as const,
  ["newsUrl", "newsStatus"] as const,
  ["eventUrl", "eventStatus"] as const,
  ["calendarUrl", "calendarStatus"] as const,
  ["summerSchoolUrl", "summerSchoolStatus"] as const
];

async function main() {
  const records = JSON.parse((await readFile(sourcePath, "utf8")).replace(/^\uFEFF/u, "")) as SourceRecord[];
  const academicUnitRecords = JSON.parse((await readFile(academicUnitSourcePath, "utf8")).replace(/^\uFEFF/u, "")) as AcademicUnitSourceRecord[];
  const suppliedSourceVerification = await readOptionalSuppliedSourceVerification();
  const reportRecords: ReportRecord[] = records.map((record) => ({
    ...record,
    missingAnnouncement: record.announcementStatus !== "source_found" || !record.announcementUrl,
    missingNews: record.newsStatus !== "source_found" || !record.newsUrl,
    missingEvent: record.eventStatus !== "source_found" || !record.eventUrl,
    missingCalendar: record.calendarStatus !== "source_found" || !record.calendarUrl,
    missingSummerSchool: record.summerSchoolStatus !== "source_found" || !record.summerSchoolUrl
  }));

  if (liveCheckEnabled) {
    await runLiveChecks(reportRecords);
  }

  const liveBroken = reportRecords
    .flatMap((record) => (record.liveChecks ?? []).map((check) => ({ record, check })))
    .filter(({ check }) => !check.ok);
  const academicUnitCoverage = buildAcademicUnitCoverage(records, academicUnitRecords);

  const summary = {
    generatedAt: new Date().toISOString(),
    sourcePath,
    academicUnitSourcePath,
    liveCheckEnabled,
    totalUniversities: reportRecords.length,
    withAnnouncementSource: reportRecords.filter((record) => !record.missingAnnouncement).length,
    withoutAnnouncementSource: reportRecords.filter((record) => record.missingAnnouncement).length,
    withNewsSource: reportRecords.filter((record) => !record.missingNews).length,
    withoutNewsSource: reportRecords.filter((record) => record.missingNews).length,
    withEventSource: reportRecords.filter((record) => !record.missingEvent).length,
    withoutEventSource: reportRecords.filter((record) => record.missingEvent).length,
    withCalendarSource: reportRecords.filter((record) => !record.missingCalendar).length,
    withoutCalendarSource: reportRecords.filter((record) => record.missingCalendar).length,
    withSummerSchoolSource: reportRecords.filter((record) => !record.missingSummerSchool).length,
    withoutSummerSchoolSource: reportRecords.filter((record) => record.missingSummerSchool).length,
    withoutAnnouncementAndCalendar: reportRecords.filter((record) => record.missingAnnouncement && record.missingCalendar).length,
    liveBrokenUrlCount: liveBroken.length,
    academicUnitSourceRecords: academicUnitRecords.length,
    universitiesWithAcademicUnitSources: academicUnitCoverage.length,
    facultyAcademicUnitSourceRecords: academicUnitRecords.filter((record) => record.scopeType === "faculty").length,
    departmentAcademicUnitSourceRecords: academicUnitRecords.filter((record) => record.scopeType === "department").length,
    academicUnitAnnouncementSourceRecords: academicUnitRecords.filter((record) => Boolean(record.announcementUrl)).length,
    academicUnitNewsSourceRecords: academicUnitRecords.filter((record) => Boolean(record.newsUrl)).length,
    academicUnitEventSourceRecords: academicUnitRecords.filter((record) => Boolean(record.eventUrl)).length,
    academicUnitCourseScheduleSourceRecords: academicUnitRecords.filter((record) => Boolean(record.courseScheduleUrl)).length,
    academicUnitExamScheduleSourceRecords: academicUnitRecords.filter((record) => Boolean(record.examScheduleUrl)).length,
    unmappedContentUrlCount: reportRecords.reduce((total, record) => total + (record.unmappedContentUrls?.length ?? 0), 0)
  };

  const jsonReport = {
    summary,
    academicUnitCoverage,
    withoutAnnouncementSource: reportRecords.filter((record) => record.missingAnnouncement),
    withoutNewsSource: reportRecords.filter((record) => record.missingNews),
    withoutEventSource: reportRecords.filter((record) => record.missingEvent),
    withoutCalendarSource: reportRecords.filter((record) => record.missingCalendar),
    withoutAnnouncementAndCalendar: reportRecords.filter((record) => record.missingAnnouncement && record.missingCalendar),
    withoutSummerSchoolSource: reportRecords.filter((record) => record.missingSummerSchool),
    unmappedContentUrls: reportRecords
      .filter((record) => (record.unmappedContentUrls?.length ?? 0) > 0)
      .map((record) => ({
        universityId: record.universityId,
        universityName: record.universityName,
        city: record.city,
        urls: record.unmappedContentUrls ?? []
      })),
    liveBrokenUrls: liveBroken.map(({ record, check }) => ({
      universityId: record.universityId,
      universityName: record.universityName,
      city: record.city,
      field: check.field,
      url: check.url,
      status: check.status,
      statusText: check.statusText,
      error: check.error
    })),
    suppliedSourceVerification
  };

  await mkdir(dirname(jsonOutputPath), { recursive: true });
  await mkdir(dirname(markdownOutputPath), { recursive: true });
  await writeFile(jsonOutputPath, `${JSON.stringify(jsonReport, null, 2)}\n`, "utf8");
  await writeFile(markdownOutputPath, renderMarkdown(jsonReport), "utf8");

  console.log(`Wrote ${jsonOutputPath}`);
  console.log(`Wrote ${markdownOutputPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

async function runLiveChecks(records: ReportRecord[]) {
  const jobs: Array<() => Promise<void>> = [];

  for (const record of records) {
    record.liveChecks = [];
    for (const [urlField] of sourceFields) {
      const url = record[urlField];
      if (!url) continue;
      jobs.push(async () => {
        record.liveChecks!.push(await checkUrl(urlField, url));
      });
    }
  }

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        await job();
      }
    })
  );
}

async function checkUrl(field: LiveCheckResult["field"], url: string): Promise<LiveCheckResult> {
  try {
    const head = await fetchWithTimeout(url, "HEAD");
    if (head.ok || (head.status >= 300 && head.status < 400)) {
      return { field, url, ok: true, status: head.status, statusText: head.statusText };
    }

    if ([403, 405, 406, 429].includes(head.status)) {
      const get = await fetchWithTimeout(url, "GET");
      return { field, url, ok: get.ok || (get.status >= 300 && get.status < 400), status: get.status, statusText: get.statusText };
    }

    return { field, url, ok: false, status: head.status, statusText: head.statusText };
  } catch (error) {
    return {
      field,
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fetchWithTimeout(url: string, method: "GET" | "HEAD") {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: method === "GET" ? { Range: "bytes=0-4095" } : undefined
    });
  } finally {
    clearTimeout(handle);
  }
}

function renderMarkdown(report: {
  summary: Record<string, unknown>;
  withoutAnnouncementSource: ReportRecord[];
  withoutNewsSource: ReportRecord[];
  withoutEventSource: ReportRecord[];
  withoutCalendarSource: ReportRecord[];
  withoutAnnouncementAndCalendar: ReportRecord[];
  withoutSummerSchoolSource: ReportRecord[];
  unmappedContentUrls: Array<{
    universityName: string;
    city?: string;
    urls: string[];
  }>;
  liveBrokenUrls: Array<{
    universityName: string;
    city?: string;
    field: string;
    url: string;
    status?: number;
    statusText?: string;
    error?: string;
  }>;
  academicUnitCoverage: AcademicUnitCoverageRecord[];
  suppliedSourceVerification: SuppliedSourceVerification | null;
}) {
  const lines: string[] = [];
  lines.push("# University Source Coverage Report");
  lines.push("");
  lines.push(`Generated: ${report.summary.generatedAt}`);
  lines.push(`Live URL check: ${report.summary.liveCheckEnabled ? "enabled" : "disabled"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total universities in source file: ${report.summary.totalUniversities}`);
  lines.push(`- Universities with announcement source: ${report.summary.withAnnouncementSource}`);
  lines.push(`- Universities without announcement source: ${report.summary.withoutAnnouncementSource}`);
  lines.push(`- Universities with news source: ${report.summary.withNewsSource}`);
  lines.push(`- Universities without news source: ${report.summary.withoutNewsSource}`);
  lines.push(`- Universities with event source: ${report.summary.withEventSource}`);
  lines.push(`- Universities without event source: ${report.summary.withoutEventSource}`);
  lines.push(`- Universities with academic calendar source: ${report.summary.withCalendarSource}`);
  lines.push(`- Universities without academic calendar source: ${report.summary.withoutCalendarSource}`);
  lines.push(`- Universities without both announcement and calendar source: ${report.summary.withoutAnnouncementAndCalendar}`);
  lines.push(`- Universities with summer school source: ${report.summary.withSummerSchoolSource}`);
  lines.push(`- Universities without summer school source: ${report.summary.withoutSummerSchoolSource}`);
  lines.push(`- Broken URLs found by live check: ${report.summary.liveBrokenUrlCount}`);
  lines.push("");
  lines.push("## Academic Unit URL Registry");
  lines.push("");
  lines.push(`- Runtime academic-unit source records: ${report.summary.academicUnitSourceRecords}`);
  lines.push(`- Universities with faculty/department URL records: ${report.summary.universitiesWithAcademicUnitSources}`);
  lines.push(`- Faculty URL records: ${report.summary.facultyAcademicUnitSourceRecords}`);
  lines.push(`- Department URL records: ${report.summary.departmentAcademicUnitSourceRecords}`);
  lines.push(`- Academic-unit announcement source URLs: ${report.summary.academicUnitAnnouncementSourceRecords}`);
  lines.push(`- Academic-unit news source URLs: ${report.summary.academicUnitNewsSourceRecords}`);
  lines.push(`- Academic-unit event source URLs: ${report.summary.academicUnitEventSourceRecords}`);
  lines.push(`- Academic-unit course-schedule source URLs: ${report.summary.academicUnitCourseScheduleSourceRecords}`);
  lines.push(`- Academic-unit exam-schedule source URLs: ${report.summary.academicUnitExamScheduleSourceRecords}`);
  lines.push(`- Unmapped content URLs needing review: ${report.summary.unmappedContentUrlCount}`);
  lines.push("");
  lines.push("Note: `source_not_found` in the sections below refers only to university-level announcement, news, event, academic calendar, or summer school source URLs. Faculty and department URL coverage is tracked separately in this registry section.");
  lines.push("");
  lines.push("### Universities With Academic Unit URL Records");
  lines.push("");
  for (const item of report.academicUnitCoverage) {
    lines.push(`- ${item.universityName} - ${item.totalRecords} total (${item.facultyRecords} faculty, ${item.departmentRecords} department; ${item.announcementSourceRecords} announcement, ${item.newsSourceRecords} news, ${item.eventSourceRecords} event, ${item.courseScheduleSourceRecords} course schedule, ${item.examScheduleSourceRecords} exam schedule URLs)`);
  }
  lines.push("");

  appendUniversityList(lines, "Without Academic Calendar Source", report.withoutCalendarSource, "calendarStatus", "calendarUrl");
  appendUniversityList(lines, "Without Announcement Source", report.withoutAnnouncementSource, "announcementStatus", "announcementUrl");
  appendUniversityList(lines, "Without News Source", report.withoutNewsSource, "newsStatus", "newsUrl");
  appendUniversityList(lines, "Without Event Source", report.withoutEventSource, "eventStatus", "eventUrl");
  appendUniversityList(lines, "Without Both Announcement And Calendar Source", report.withoutAnnouncementAndCalendar, "calendarStatus", "calendarUrl");
  appendUniversityList(lines, "Without Summer School Source", report.withoutSummerSchoolSource, "summerSchoolStatus", "summerSchoolUrl");

  lines.push("## Unmapped Content URLs");
  lines.push("");
  if (report.unmappedContentUrls.length === 0) {
    lines.push("None.");
  } else {
    for (const item of report.unmappedContentUrls) {
      lines.push(`- ${item.universityName}${item.city ? ` (${item.city})` : ""}`);
      for (const url of item.urls) lines.push(`  - ${url}`);
    }
  }
  lines.push("");

  appendSuppliedSourceVerification(lines, report.suppliedSourceVerification);

  lines.push("## Broken URLs From Live Check");
  lines.push("");
  if (report.liveBrokenUrls.length === 0) {
    lines.push(report.summary.liveCheckEnabled ? "No broken URLs were found during the live check." : "Live check was not run.");
  } else {
    for (const item of report.liveBrokenUrls) {
      const status = item.status ? `${item.status} ${item.statusText ?? ""}`.trim() : item.error ?? "request failed";
      lines.push(`- ${item.universityName}${item.city ? ` (${item.city})` : ""} - ${item.field}: ${status} - ${item.url}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildAcademicUnitCoverage(records: SourceRecord[], academicUnitRecords: AcademicUnitSourceRecord[]): AcademicUnitCoverageRecord[] {
  const sourceNameById = new Map(records.map((record) => [record.universityId, record.universityName]));
  const byUniversity = new Map<string, AcademicUnitSourceRecord[]>();
  for (const record of academicUnitRecords) {
    const group = byUniversity.get(record.universityId) ?? [];
    group.push(record);
    byUniversity.set(record.universityId, group);
  }

  return [...byUniversity.entries()]
    .map(([universityId, universityRecords]) => ({
      universityId,
      universityName: universityRecords.find((record) => record.universityName)?.universityName ?? sourceNameById.get(universityId) ?? universityId,
      totalRecords: universityRecords.length,
      facultyRecords: universityRecords.filter((record) => record.scopeType === "faculty").length,
      departmentRecords: universityRecords.filter((record) => record.scopeType === "department").length,
      announcementSourceRecords: universityRecords.filter((record) => Boolean(record.announcementUrl)).length,
      newsSourceRecords: universityRecords.filter((record) => Boolean(record.newsUrl)).length,
      eventSourceRecords: universityRecords.filter((record) => Boolean(record.eventUrl)).length,
      courseScheduleSourceRecords: universityRecords.filter((record) => Boolean(record.courseScheduleUrl)).length,
      examScheduleSourceRecords: universityRecords.filter((record) => Boolean(record.examScheduleUrl)).length
    }))
    .sort((left, right) => left.universityName.localeCompare(right.universityName, "tr-TR"));
}

async function readOptionalSuppliedSourceVerification(): Promise<SuppliedSourceVerification | null> {
  try {
    return JSON.parse((await readFile(suppliedSourceVerificationPath, "utf8")).replace(/^\uFEFF/u, "")) as SuppliedSourceVerification;
  } catch {
    return null;
  }
}

function appendSuppliedSourceVerification(lines: string[], verification: SuppliedSourceVerification | null): void {
  lines.push("## Four-University Supplied URL Verification");
  lines.push("");
  if (!verification?.universities?.length) {
    lines.push("No dedicated verification file was found.");
    lines.push("");
    return;
  }
  lines.push(`- Verification generated: ${verification.generatedAt ?? "unknown"}`);
  lines.push(`- Live checks: ${verification.liveCheckEnabled ? "enabled" : "disabled"}`);
  for (const university of verification.universities) {
    const sources = university.sources ?? [];
    const count = (status: NonNullable<NonNullable<typeof sources[number]["validation"]>["status"]>) => sources.filter((source) => source.validation?.status === status).length;
    lines.push(`- ${university.universityName}: ${sources.length} URLs (${count("reachable")} reachable, ${count("redirected")} redirected, ${count("blocked_by_site")} site-blocked, ${count("broken")} broken, ${count("request_failed")} request failed)`);
  }
  const failures = verification.universities.flatMap((university) => university.sources
    .filter((source) => source.validation?.status === "broken" || source.validation?.status === "request_failed")
    .map((source) => ({ universityName: university.universityName, source })));
  if (failures.length > 0) {
    lines.push("");
    lines.push("### Supplied URLs Needing Review");
    lines.push("");
    for (const failure of failures) {
      const detail = failure.source.validation?.httpStatus ?? failure.source.validation?.error ?? "request failed";
      lines.push(`- ${failure.universityName} - ${detail} - ${failure.source.url}`);
    }
  }
  lines.push("");
}

function appendUniversityList(
  lines: string[],
  title: string,
  records: ReportRecord[],
  statusField: keyof SourceRecord,
  urlField: keyof SourceRecord
) {
  lines.push(`## ${title}`);
  lines.push("");
  if (records.length === 0) {
    lines.push("None.");
    lines.push("");
    return;
  }

  for (const record of records) {
    const status = record[statusField] ?? "missing";
    const url = record[urlField] ?? "-";
    lines.push(`- ${record.universityName}${record.city ? ` (${record.city})` : ""} - ${status} - ${url}`);
  }
  lines.push("");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
