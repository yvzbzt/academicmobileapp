import { sourceAuthorityPolicy } from "./source-authority-policy.js";
import {
  buildSourceScopeOwnershipIndex,
  resolveSourceScopeOwnership,
  type SourceScopeOwnershipIndex
} from "./source-scope-ownership.js";

export type SourceCoverageScopeType = "university" | "faculty" | "department";
export type SourceCoverageContentType = "announcement" | "news" | "event";
export type SourceCoverageResource =
  | SourceCoverageContentType
  | "academic_calendar"
  | "pdf"
  | "website";
export type SourceCoverageDisposition = "trusted" | "rejected" | "quarantined";

export interface SourceCoverageCatalogInstitution {
  universityId: string;
  universityName: string;
  slug?: string;
  faculties?: readonly SourceCoverageCatalogFaculty[];
}

export interface SourceCoverageCatalogFaculty {
  slug: string;
  name?: string;
  departments?: readonly SourceCoverageCatalogDepartment[];
}

export interface SourceCoverageCatalogDepartment {
  slug: string;
  name?: string;
}

export interface SourceCoverageAuthority {
  universityId: string;
  universityName?: string;
  status: "verified" | "quarantined";
  authorityDomains: readonly string[];
  authorityUrls: readonly string[];
  reasonCodes?: readonly string[];
}

export interface SourceCoverageQuarantinedSource {
  id?: string;
  field: string;
  url: string;
  reasonCode: string;
}

export interface SourceCoverageUniversityRecord {
  universityId: string;
  universityName: string;
  announcementUrl?: string | null;
  newsUrl?: string | null;
  eventUrl?: string | null;
  calendarUrl?: string | null;
  summerSchoolUrl?: string | null;
  quarantinedSources?: readonly SourceCoverageQuarantinedSource[];
}

export interface SourceCoverageAcademicUnitRecord {
  scopeType: "faculty" | "department";
  universityId: string;
  universityName?: string;
  facultyId?: string;
  facultyName?: string;
  departmentId?: string;
  departmentName?: string;
  websiteUrl?: string | null;
  announcementUrl?: string | null;
  newsUrl?: string | null;
  eventUrl?: string | null;
  courseScheduleUrl?: string | null;
  examScheduleUrl?: string | null;
  quarantinedSources?: readonly SourceCoverageQuarantinedSource[];
}

export interface SourceAuthorityCoverageInput {
  catalogInstitutions: readonly SourceCoverageCatalogInstitution[];
  universitySources: readonly SourceCoverageUniversityRecord[];
  academicUnitSources: readonly SourceCoverageAcademicUnitRecord[];
  authorities: readonly SourceCoverageAuthority[];
}

export interface SourceCoverageOperationalEvidence {
  liveAccess: "unknown";
  freshness: "unknown";
  itemProduction: "unknown";
}

export interface SourceCoverageAuditRecord extends SourceCoverageOperationalEvidence {
  id: string;
  universityId: string;
  universityName: string;
  ownerAcademicEntityId: string;
  scopeType: SourceCoverageScopeType;
  scopeId: string;
  sourceField: string;
  resource: SourceCoverageResource;
  url: string;
  canonicalUrl: string | null;
  authorityStatus: "verified" | "quarantined" | "missing";
  disposition: SourceCoverageDisposition;
  authorityValid: boolean;
  reasonCodes: string[];
  contentType?: SourceCoverageContentType;
  matchedAuthorityDomain?: string;
}

export interface SourceCoverageMatrixRow {
  scopeType: SourceCoverageScopeType;
  contentType: SourceCoverageContentType;
  configured: number;
  authorityValid: number;
  trusted: number;
  rejected: number;
  quarantined: number;
}

export interface SourceCoverageInstitutionReference {
  universityId: string;
  universityName: string;
}

export interface SourceAuthorityCoverageReport {
  schemaVersion: 1;
  mode: "offline";
  operationalEvidence: SourceCoverageOperationalEvidence;
  summary: {
    catalogInstitutions: number;
    configuredSources: number;
    authorityValidSources: number;
    institutionsWithVerifiedAuthority: number;
    institutionsWithQuarantinedAuthority: number;
    institutionsMissingAuthority: number;
  };
  sourceStatusCounts: {
    active: { known: number; unknown: number };
    trusted: number;
    rejected: number;
    quarantined: number;
  };
  coverageByScopeAndContentType: SourceCoverageMatrixRow[];
  institutionsWithoutValidContentSources: {
    announcement: SourceCoverageInstitutionReference[];
    news: SourceCoverageInstitutionReference[];
    event: SourceCoverageInstitutionReference[];
    anyContent: SourceCoverageInstitutionReference[];
  };
  sourceAudits: SourceCoverageAuditRecord[];
}

const operationalEvidence = {
  liveAccess: "unknown",
  freshness: "unknown",
  itemProduction: "unknown"
} as const;

const scopeTypes = ["university", "faculty", "department"] as const;
const contentTypes = ["announcement", "news", "event"] as const;

const universitySourceFields = [
  ["announcementUrl", "announcement"],
  ["newsUrl", "news"],
  ["eventUrl", "event"],
  ["calendarUrl", "academic_calendar"],
  ["summerSchoolUrl", "announcement"]
] as const;

const academicUnitSourceFields = [
  ["websiteUrl", "website"],
  ["announcementUrl", "announcement"],
  ["newsUrl", "news"],
  ["eventUrl", "event"],
  ["courseScheduleUrl", "academic_calendar"],
  ["examScheduleUrl", "academic_calendar"]
] as const;

interface SourceCandidate {
  id: string;
  universityId: string;
  universityName: string;
  ownerAcademicEntityId: string;
  scopeType: SourceCoverageScopeType;
  scopeId: string;
  sourceField: string;
  resource: SourceCoverageResource;
  url: string;
  contentType?: SourceCoverageContentType;
  registryReasonCodes?: readonly string[];
}

export function buildSourceAuthorityCoverage(
  input: SourceAuthorityCoverageInput
): SourceAuthorityCoverageReport {
  const institutions = normalizeInstitutions(input);
  const authorityGroups = groupAuthorities(input.authorities);
  const scopeOwnership = buildSourceScopeOwnershipIndex({ universities: input.catalogInstitutions });
  const candidates = buildSourceCandidates(input).sort(compareSourceCandidates);
  const sourceAudits = candidates.map((candidate) => (
    auditSourceCandidate(candidate, authorityGroups, scopeOwnership)
  ));
  const trusted = sourceAudits.filter((source) => source.disposition === "trusted").length;
  const rejected = sourceAudits.filter((source) => source.disposition === "rejected").length;
  const quarantined = sourceAudits.filter((source) => source.disposition === "quarantined").length;

  const report: SourceAuthorityCoverageReport = {
    schemaVersion: 1,
    mode: "offline",
    operationalEvidence,
    summary: {
      catalogInstitutions: institutions.length,
      configuredSources: sourceAudits.length,
      authorityValidSources: sourceAudits.filter((source) => source.authorityValid).length,
      institutionsWithVerifiedAuthority: institutions.filter((institution) => (
        uniqueAuthorityFor(institution.universityId, authorityGroups)?.status === "verified"
      )).length,
      institutionsWithQuarantinedAuthority: institutions.filter((institution) => (
        uniqueAuthorityFor(institution.universityId, authorityGroups)?.status === "quarantined"
      )).length,
      institutionsMissingAuthority: institutions.filter((institution) => (
        !uniqueAuthorityFor(institution.universityId, authorityGroups)
      )).length
    },
    sourceStatusCounts: {
      active: { known: 0, unknown: sourceAudits.length },
      trusted,
      rejected,
      quarantined
    },
    coverageByScopeAndContentType: buildCoverageMatrix(sourceAudits),
    institutionsWithoutValidContentSources: {
      announcement: institutionsWithoutValidContent(institutions, sourceAudits, "announcement"),
      news: institutionsWithoutValidContent(institutions, sourceAudits, "news"),
      event: institutionsWithoutValidContent(institutions, sourceAudits, "event"),
      anyContent: institutions.filter((institution) => !sourceAudits.some((source) => (
        source.universityId === institution.universityId
        && source.authorityValid
        && source.contentType !== undefined
      )))
    },
    sourceAudits
  };
  validateSourceAuthorityCoverage(report);
  return report;
}

export function validateSourceAuthorityCoverage(report: SourceAuthorityCoverageReport): void {
  const configured = report.summary.configuredSources;
  const classified = report.sourceStatusCounts.trusted
    + report.sourceStatusCounts.rejected
    + report.sourceStatusCounts.quarantined;
  if (report.schemaVersion !== 1 || report.mode !== "offline") {
    throw new Error("SOURCE_AUTHORITY_COVERAGE_SCHEMA_INVALID");
  }
  if (report.sourceAudits.length !== configured || classified !== configured) {
    throw new Error("SOURCE_AUTHORITY_COVERAGE_SOURCE_TOTAL_MISMATCH");
  }
  if (report.sourceStatusCounts.active.known !== 0
    || report.sourceStatusCounts.active.unknown !== configured) {
    throw new Error("SOURCE_AUTHORITY_COVERAGE_ACTIVE_EVIDENCE_INVALID");
  }
  if (report.summary.authorityValidSources !== report.sourceStatusCounts.trusted) {
    throw new Error("SOURCE_AUTHORITY_COVERAGE_AUTHORITY_TOTAL_MISMATCH");
  }
  if (report.coverageByScopeAndContentType.length !== scopeTypes.length * contentTypes.length) {
    throw new Error("SOURCE_AUTHORITY_COVERAGE_MATRIX_INCOMPLETE");
  }
  for (const row of report.coverageByScopeAndContentType) {
    if (row.configured !== row.trusted + row.rejected + row.quarantined
      || row.authorityValid !== row.trusted) {
      throw new Error("SOURCE_AUTHORITY_COVERAGE_MATRIX_TOTAL_MISMATCH");
    }
  }
  if (report.operationalEvidence.liveAccess !== "unknown"
    || report.operationalEvidence.freshness !== "unknown"
    || report.operationalEvidence.itemProduction !== "unknown"
    || report.sourceAudits.some((source) => (
      source.liveAccess !== "unknown"
      || source.freshness !== "unknown"
      || source.itemProduction !== "unknown"
    ))) {
    throw new Error("SOURCE_AUTHORITY_COVERAGE_OFFLINE_EVIDENCE_INVALID");
  }
}

export function stableSourceAuthorityCoverageJson(report: SourceAuthorityCoverageReport): string {
  validateSourceAuthorityCoverage(report);
  return `${JSON.stringify(sortJsonValue(report), null, 2)}\n`;
}

function normalizeInstitutions(input: SourceAuthorityCoverageInput): SourceCoverageInstitutionReference[] {
  const names = new Map<string, string>();
  for (const institution of input.catalogInstitutions) {
    const universityId = normalizedText(institution.universityId);
    if (!universityId) continue;
    names.set(universityId, normalizedText(institution.universityName) || universityId);
  }
  return [...names]
    .map(([universityId, universityName]) => ({ universityId, universityName }))
    .sort(compareInstitutions);
}

function groupAuthorities(
  authorities: readonly SourceCoverageAuthority[]
): ReadonlyMap<string, readonly SourceCoverageAuthority[]> {
  const groups = new Map<string, SourceCoverageAuthority[]>();
  for (const authority of authorities) {
    const universityId = normalizedText(authority.universityId);
    if (!universityId) continue;
    const group = groups.get(universityId) ?? [];
    group.push(authority);
    groups.set(universityId, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => stableCompare(
      `${left.status}\u0000${left.universityName}\u0000${left.authorityDomains.join("\u0000")}`,
      `${right.status}\u0000${right.universityName}\u0000${right.authorityDomains.join("\u0000")}`
    ));
  }
  return groups;
}

function uniqueAuthorityFor(
  universityId: string,
  groups: ReadonlyMap<string, readonly SourceCoverageAuthority[]>
): SourceCoverageAuthority | null {
  const matches = groups.get(universityId) ?? [];
  return matches.length === 1 ? matches[0]! : null;
}

function buildSourceCandidates(input: SourceAuthorityCoverageInput): SourceCandidate[] {
  const candidates: SourceCandidate[] = [];
  for (const source of input.universitySources) {
    const universityId = normalizedText(source.universityId);
    const universityName = normalizedText(source.universityName) || universityId;
    for (const [sourceField, defaultResource] of universitySourceFields) {
      const url = normalizedText(source[sourceField]);
      if (!url) continue;
      const resource = sourceResource(sourceField, defaultResource, url);
      candidates.push({
        id: `university:${universityId}:${sourceField}`,
        universityId,
        universityName,
        ownerAcademicEntityId: universityId,
        scopeType: "university",
        scopeId: universityId,
        sourceField,
        resource,
        url,
        ...contentTypeForSourceField(sourceField)
      });
    }
    for (const quarantined of source.quarantinedSources ?? []) {
      const sourceField = normalizedText(quarantined.field);
      const url = normalizedText(quarantined.url);
      const reasonCode = normalizedText(quarantined.reasonCode);
      if (!sourceField || !url || !reasonCode) continue;
      candidates.push({
        id: normalizedText(quarantined.id) || `university:${universityId}:${sourceField}`,
        universityId,
        universityName,
        ownerAcademicEntityId: universityId,
        scopeType: "university",
        scopeId: universityId,
        sourceField,
        resource: sourceResource(sourceField, defaultResourceForField(sourceField), url),
        url,
        registryReasonCodes: [reasonCode],
        ...contentTypeForSourceField(sourceField)
      });
    }
  }

  for (const source of input.academicUnitSources) {
    const universityId = normalizedText(source.universityId);
    const universityName = normalizedText(source.universityName) || universityId;
    const scopeId = source.scopeType === "faculty"
      ? normalizedText(source.facultyId)
      : normalizedText(source.departmentId);
    for (const [sourceField, defaultResource] of academicUnitSourceFields) {
      const url = normalizedText(source[sourceField]);
      if (!url) continue;
      const resource = sourceResource(sourceField, defaultResource, url);
      candidates.push({
        id: `academic-unit:${source.scopeType}:${scopeId || "<missing>"}:${sourceField}`,
        universityId,
        universityName,
        ownerAcademicEntityId: scopeId,
        scopeType: source.scopeType,
        scopeId,
        sourceField,
        resource,
        url,
        ...contentTypeForSourceField(sourceField)
      });
    }
    for (const quarantined of source.quarantinedSources ?? []) {
      const sourceField = normalizedText(quarantined.field);
      const url = normalizedText(quarantined.url);
      const reasonCode = normalizedText(quarantined.reasonCode);
      if (!sourceField || !url || !reasonCode) continue;
      candidates.push({
        id: normalizedText(quarantined.id)
          || `academic-unit:${source.scopeType}:${scopeId || "<missing>"}:${sourceField}`,
        universityId,
        universityName,
        ownerAcademicEntityId: scopeId,
        scopeType: source.scopeType,
        scopeId,
        sourceField,
        resource: sourceResource(sourceField, defaultResourceForField(sourceField), url),
        url,
        registryReasonCodes: [reasonCode],
        ...contentTypeForSourceField(sourceField)
      });
    }
  }
  const byIdentity = new Map<string, SourceCandidate>();
  for (const candidate of candidates.sort(compareSourceCandidates)) {
    const existing = byIdentity.get(candidate.id);
    if (!existing || candidate.registryReasonCodes) byIdentity.set(candidate.id, candidate);
  }
  return [...byIdentity.values()];
}

function auditSourceCandidate(
  candidate: SourceCandidate,
  authorityGroups: ReadonlyMap<string, readonly SourceCoverageAuthority[]>,
  scopeOwnership: SourceScopeOwnershipIndex
): SourceCoverageAuditRecord {
  const { registryReasonCodes: registryReasons, ...auditCandidate } = candidate;
  const authorityMatches = authorityGroups.get(candidate.universityId) ?? [];
  const authority = uniqueAuthorityFor(candidate.universityId, authorityGroups);
  const authorityStatus = authority?.status ?? "missing";
  if (!authority || authority.status !== "verified") {
    const reasonCodes = authority
      ? normalizedReasonCodes(authority.reasonCodes, "owner_evidence_missing")
      : [authorityMatches.length > 1 ? "owner_evidence_ambiguous" : "owner_evidence_missing"];
    return {
      ...auditCandidate,
      ...operationalEvidence,
      canonicalUrl: null,
      authorityStatus,
      disposition: "quarantined",
      authorityValid: false,
      reasonCodes
    };
  }

  const authorityDomains = normalizedAuthorityDomains(authority);
  const resolvedOwnership = resolveSourceScopeOwnership(scopeOwnership, {
    scopeType: candidate.scopeType,
    scopeId: candidate.scopeId
  });
  const decision = sourceAuthorityPolicy.evaluate({
    boundary: "registration",
    resource: candidate.resource,
    ownerAcademicEntityId: candidate.ownerAcademicEntityId,
    ownerUniversityId: candidate.universityId,
    resolvedOwnerAcademicEntityId: resolvedOwnership.resolvedOwnerAcademicEntityId,
    resolvedOwnerUniversityId: resolvedOwnership.resolvedOwnerUniversityId,
    scopeType: candidate.scopeType,
    scopeId: candidate.scopeId,
    authorityDomains,
    url: candidate.url
  });
  const trusted = decision.allowed && decision.status === "trusted";
  const registryReasonCodes = registryReasons
    ? normalizedReasonCodes(registryReasons, "").filter(Boolean)
    : [];
  const forcedQuarantine = registryReasonCodes.length > 0;
  return {
    ...auditCandidate,
    ...operationalEvidence,
    canonicalUrl: decision.canonicalUrl,
    authorityStatus,
    disposition: trusted && !forcedQuarantine ? "trusted" : "quarantined",
    authorityValid: trusted && !forcedQuarantine,
    reasonCodes: !trusted ? [decision.reasonCode] : forcedQuarantine ? registryReasonCodes : [],
    ...(decision.matchedAuthorityDomain ? { matchedAuthorityDomain: decision.matchedAuthorityDomain } : {})
  };
}

function normalizedAuthorityDomains(authority: SourceCoverageAuthority): string[] {
  const domains = authority.authorityDomains.flatMap((value) => {
    const normalized = normalizedText(value).toLocaleLowerCase("en-US").replace(/^\.+|\.+$/gu, "");
    return normalized ? [normalized] : [];
  });
  return [...new Set(domains)].sort(stableCompare);
}

function normalizedReasonCodes(values: readonly string[] | undefined, fallback: string): string[] {
  const codes = (values ?? []).flatMap((value) => {
    const normalized = normalizedText(value);
    return normalized ? [normalized] : [];
  });
  return codes.length > 0 ? [...new Set(codes)].sort(stableCompare) : [fallback];
}

function buildCoverageMatrix(sourceAudits: readonly SourceCoverageAuditRecord[]): SourceCoverageMatrixRow[] {
  return scopeTypes.flatMap((scopeType) => contentTypes.map((contentType) => {
    const sources = sourceAudits.filter((source) => (
      source.scopeType === scopeType && source.contentType === contentType
    ));
    return {
      scopeType,
      contentType,
      configured: sources.length,
      authorityValid: sources.filter((source) => source.authorityValid).length,
      trusted: sources.filter((source) => source.disposition === "trusted").length,
      rejected: sources.filter((source) => source.disposition === "rejected").length,
      quarantined: sources.filter((source) => source.disposition === "quarantined").length
    };
  }));
}

function institutionsWithoutValidContent(
  institutions: readonly SourceCoverageInstitutionReference[],
  sourceAudits: readonly SourceCoverageAuditRecord[],
  contentType: SourceCoverageContentType
): SourceCoverageInstitutionReference[] {
  return institutions.filter((institution) => !sourceAudits.some((source) => (
    source.universityId === institution.universityId
    && source.contentType === contentType
    && source.authorityValid
  )));
}

function sourceResource(
  sourceField: string,
  defaultResource: SourceCoverageResource,
  url: string
): SourceCoverageResource {
  if (/(?:^|\/)pdf(?:\/|$)/iu.test(url) || /\.pdf(?:$|[?#])/iu.test(url)) return "pdf";
  if (sourceField === "calendarUrl") return "academic_calendar";
  return defaultResource;
}

function defaultResourceForField(sourceField: string): SourceCoverageResource {
  if (sourceField === "announcementUrl" || sourceField === "summerSchoolUrl") return "announcement";
  if (sourceField === "newsUrl") return "news";
  if (sourceField === "eventUrl") return "event";
  if (sourceField === "calendarUrl") return "academic_calendar";
  if (sourceField === "courseScheduleUrl" || sourceField === "examScheduleUrl") return "academic_calendar";
  return "website";
}

function contentTypeForSourceField(
  sourceField: string
): { contentType: SourceCoverageContentType } | Record<string, never> {
  if (sourceField === "announcementUrl") return { contentType: "announcement" };
  if (sourceField === "newsUrl") return { contentType: "news" };
  if (sourceField === "eventUrl") return { contentType: "event" };
  return {};
}

function compareSourceCandidates(left: SourceCandidate, right: SourceCandidate): number {
  return stableCompare(
    `${left.universityId}\u0000${left.scopeType}\u0000${left.scopeId}\u0000${left.sourceField}\u0000${left.url}`,
    `${right.universityId}\u0000${right.scopeType}\u0000${right.scopeId}\u0000${right.sourceField}\u0000${right.url}`
  );
}

function compareInstitutions(
  left: SourceCoverageInstitutionReference,
  right: SourceCoverageInstitutionReference
): number {
  return stableCompare(left.universityId, right.universityId);
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => stableCompare(left, right))
      .map(([key, nested]) => [key, sortJsonValue(nested)])
  );
}
