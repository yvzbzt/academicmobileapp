import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  buildSourceAuthorityCoverage,
  stableSourceAuthorityCoverageJson,
  validateSourceAuthorityCoverage,
  type SourceAuthorityCoverageInput,
  type SourceAuthorityCoverageReport,
  type SourceCoverageAcademicUnitRecord,
  type SourceCoverageAuthority,
  type SourceCoverageCatalogDepartment,
  type SourceCoverageCatalogFaculty,
  type SourceCoverageCatalogInstitution,
  type SourceCoverageQuarantinedSource,
  type SourceCoverageUniversityRecord
} from "../apps/api/src/domain/source-authority-coverage.js";

const catalogPath = "apps/api/src/bootstrap/turkiye-catalog-seed.json";
const universitySourcePath = "apps/api/src/bootstrap/verified-university-sources.json";
const academicUnitSourcePath = "apps/api/src/bootstrap/verified-academic-unit-sources.json";
const authorityPath = "apps/api/src/bootstrap/verified-source-authorities.json";
const jsonOutputPath = "data/university-source-coverage-report.json";
const markdownOutputPath = "docs/university-source-coverage-report.md";

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const firstReport = buildSourceAuthorityCoverage(await loadCoverageInput());
  const firstJson = stableSourceAuthorityCoverageJson(firstReport);

  if (args.check) {
    const secondReport = buildSourceAuthorityCoverage(await loadCoverageInput());
    const secondJson = stableSourceAuthorityCoverageJson(secondReport);
    if (firstJson !== secondJson) throw new Error("SOURCE_AUTHORITY_COVERAGE_NONDETERMINISTIC");
  }

  if (args.write) {
    await mkdir(dirname(jsonOutputPath), { recursive: true });
    await mkdir(dirname(markdownOutputPath), { recursive: true });
    await writeFile(jsonOutputPath, firstJson, "utf8");
    await writeFile(markdownOutputPath, renderMarkdown(firstReport), "utf8");
  }
  process.stdout.write(firstJson);
}

async function loadCoverageInput(): Promise<SourceAuthorityCoverageInput> {
  const [catalog, universitySources, academicUnitSources, authorities] = await Promise.all([
    readJson(catalogPath),
    readJson(universitySourcePath),
    readJson(academicUnitSourcePath),
    readJson(authorityPath)
  ]);
  return {
    catalogInstitutions: readCatalogInstitutions(catalog),
    universitySources: readUniversitySources(universitySources),
    academicUnitSources: readAcademicUnitSources(academicUnitSources),
    authorities: readAuthorities(authorities)
  };
}

function parseArguments(values: readonly string[]): { check: boolean; write: boolean } {
  const supported = new Set(["--check", "--write"]);
  const unsupported = values.filter((value) => !supported.has(value));
  if (unsupported.length > 0) {
    throw new Error(`SOURCE_AUTHORITY_COVERAGE_ARGUMENT_UNSUPPORTED:${unsupported.join(",")}`);
  }
  return { check: values.includes("--check"), write: values.includes("--write") };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/u, "")) as unknown;
}

function readCatalogInstitutions(input: unknown): SourceCoverageCatalogInstitution[] {
  const container = asRecord(input);
  const records = Array.isArray(input)
    ? input
    : Array.isArray(container?.universities) ? container.universities : [];
  return records.flatMap((value) => {
    const record = asRecord(value);
    const universityId = readString(record?.universityId) ?? readString(record?.slug);
    const universityName = readString(record?.universityName) ?? readString(record?.name);
    if (!record || !universityId || !universityName) return [];
    const slug = readString(record.slug);
    const faculties = readCatalogFaculties(record.faculties);
    return [{
      universityId,
      universityName,
      ...(slug ? { slug } : {}),
      ...(faculties.length > 0 ? { faculties } : {})
    }];
  });
}

function readCatalogFaculties(input: unknown): SourceCoverageCatalogFaculty[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((value) => {
    const record = asRecord(value);
    const slug = readString(record?.slug);
    if (!record || !slug) return [];
    const departments = readCatalogDepartments(record.departments);
    return [{
      slug,
      ...optionalString(record, "name"),
      ...(departments.length > 0 ? { departments } : {})
    }];
  });
}

function readCatalogDepartments(input: unknown): SourceCoverageCatalogDepartment[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((value) => {
    const record = asRecord(value);
    const slug = readString(record?.slug);
    if (!record || !slug) return [];
    return [{ slug, ...optionalString(record, "name") }];
  });
}

function readUniversitySources(input: unknown): SourceCoverageUniversityRecord[] {
  if (!Array.isArray(input)) throw new Error("SOURCE_AUTHORITY_COVERAGE_UNIVERSITY_REGISTRY_INVALID");
  return input.flatMap((value) => {
    const record = asRecord(value);
    const universityId = readString(record?.universityId);
    const universityName = readString(record?.universityName);
    if (!record || !universityId || !universityName) return [];
    return [{
      universityId,
      universityName,
      ...optionalString(record, "announcementUrl"),
      ...optionalString(record, "newsUrl"),
      ...optionalString(record, "eventUrl"),
      ...optionalString(record, "calendarUrl"),
      ...optionalString(record, "summerSchoolUrl"),
      ...optionalQuarantinedSources(record)
    }];
  });
}

function readAcademicUnitSources(input: unknown): SourceCoverageAcademicUnitRecord[] {
  if (!Array.isArray(input)) throw new Error("SOURCE_AUTHORITY_COVERAGE_ACADEMIC_UNIT_REGISTRY_INVALID");
  return input.flatMap((value) => {
    const record = asRecord(value);
    const universityId = readString(record?.universityId);
    const scopeType = record?.scopeType === "faculty" || record?.scopeType === "department"
      ? record.scopeType
      : null;
    if (!record || !universityId || !scopeType) return [];
    return [{
      scopeType,
      universityId,
      ...optionalString(record, "universityName"),
      ...optionalString(record, "facultyId"),
      ...optionalString(record, "facultyName"),
      ...optionalString(record, "departmentId"),
      ...optionalString(record, "departmentName"),
      ...optionalString(record, "websiteUrl"),
      ...optionalString(record, "announcementUrl"),
      ...optionalString(record, "newsUrl"),
      ...optionalString(record, "eventUrl"),
      ...optionalString(record, "courseScheduleUrl"),
      ...optionalString(record, "examScheduleUrl"),
      ...optionalQuarantinedSources(record)
    }];
  });
}

function readAuthorities(input: unknown): SourceCoverageAuthority[] {
  const container = asRecord(input);
  const records = Array.isArray(input)
    ? input
    : Array.isArray(container?.authorities) ? container.authorities : [];
  if (records.length === 0) throw new Error("SOURCE_AUTHORITY_COVERAGE_AUTHORITY_REGISTRY_INVALID");
  return records.flatMap((value) => {
    const record = asRecord(value);
    const universityId = readString(record?.universityId);
    if (!record || !universityId) return [];
    const status = record.status === "verified" ? "verified" : "quarantined";
    const reasonCodes = readStringArray(record.reasonCodes);
    return [{
      universityId,
      ...optionalString(record, "universityName"),
      status,
      authorityDomains: readStringArray(record.authorityDomains),
      authorityUrls: readStringArray(record.authorityUrls),
      ...(status === "quarantined"
        ? { reasonCodes: reasonCodes.length > 0 ? reasonCodes : ["owner_evidence_missing"] }
        : reasonCodes.length > 0 ? { reasonCodes } : {})
    }];
  });
}

function optionalQuarantinedSources(
  record: Record<string, unknown>
): { quarantinedSources: SourceCoverageQuarantinedSource[] } | Record<string, never> {
  if (!Array.isArray(record.quarantinedSources)) return {};
  const sources = record.quarantinedSources.flatMap((value) => {
    const source = asRecord(value);
    const field = readString(source?.field);
    const url = readString(source?.url);
    const reasonCode = readString(source?.reasonCode);
    if (!source || !field || !url || !reasonCode) return [];
    return [{ ...optionalString(source, "id"), field, url, reasonCode }];
  });
  return sources.length > 0 ? { quarantinedSources: sources } : {};
}

function optionalString<TName extends string>(
  record: Record<string, unknown>,
  name: TName
): Partial<Record<TName, string>> {
  const value = readString(record[name]);
  return value ? { [name]: value } as Partial<Record<TName, string>> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const text = readString(item);
    return text ? [text] : [];
  }))].sort(stableCompare);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function renderMarkdown(report: SourceAuthorityCoverageReport): string {
  validateSourceAuthorityCoverage(report);
  const lines = [
    "# Source Authority Coverage Report",
    "",
    "This deterministic offline report does not claim live access, freshness, or item production.",
    "",
    "## Summary",
    "",
    `- Catalog institutions: ${report.summary.catalogInstitutions}`,
    `- Configured sources: ${report.summary.configuredSources}`,
    `- Authority-valid sources: ${report.summary.authorityValidSources}`,
    `- Active sources: ${report.sourceStatusCounts.active.known} known; ${report.sourceStatusCounts.active.unknown} unknown`,
    `- Trusted sources: ${report.sourceStatusCounts.trusted}`,
    `- Rejected sources: ${report.sourceStatusCounts.rejected}`,
    `- Quarantined sources: ${report.sourceStatusCounts.quarantined}`,
    `- Institutions with verified authority: ${report.summary.institutionsWithVerifiedAuthority}`,
    `- Institutions with quarantined authority: ${report.summary.institutionsWithQuarantinedAuthority}`,
    `- Institutions missing authority: ${report.summary.institutionsMissingAuthority}`,
    "",
    "## Scope And Content Coverage",
    "",
    "| Scope | Content | Configured | Authority-valid | Trusted | Rejected | Quarantined |",
    "|---|---|---:|---:|---:|---:|---:|",
    ...report.coverageByScopeAndContentType.map((row) => (
      `| ${row.scopeType} | ${row.contentType} | ${row.configured} | ${row.authorityValid} | ${row.trusted} | ${row.rejected} | ${row.quarantined} |`
    )),
    ""
  ];
  appendMissing(lines, "Without Valid Announcement Source", report.institutionsWithoutValidContentSources.announcement);
  appendMissing(lines, "Without Valid News Source", report.institutionsWithoutValidContentSources.news);
  appendMissing(lines, "Without Valid Event Source", report.institutionsWithoutValidContentSources.event);
  appendMissing(lines, "Without Any Valid Announcement, News, Or Event Source", report.institutionsWithoutValidContentSources.anyContent);
  lines.push("## Quarantined Sources", "");
  const quarantined = report.sourceAudits.filter((source) => source.disposition === "quarantined");
  if (quarantined.length === 0) lines.push("None.");
  else for (const source of quarantined) {
    lines.push(`- ${source.id} — ${source.reasonCodes.join(", ")} — ${source.url}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function appendMissing(
  lines: string[],
  title: string,
  institutions: readonly SourceCoverageCatalogInstitution[]
): void {
  lines.push(`## ${title}`, "");
  if (institutions.length === 0) lines.push("None.");
  else for (const institution of institutions) {
    lines.push(`- ${institution.universityId} — ${institution.universityName}`);
  }
  lines.push("");
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
