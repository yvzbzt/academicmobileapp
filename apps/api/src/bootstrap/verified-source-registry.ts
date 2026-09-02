import { readFile } from "node:fs/promises";
import {
  sourceAuthorityPolicy,
  type SourceAuthorityReasonCode,
  type SourceAuthorityResource,
  type SourceAuthorityScopeType
} from "../domain/source-authority-policy.js";
import {
  buildSourceScopeOwnershipIndex,
  resolveSourceScopeOwnership,
  type SourceScopeOwnershipIndex
} from "../domain/source-scope-ownership.js";

export type VerifiedRegistryReasonCode = SourceAuthorityReasonCode | "owner_evidence_missing";

export interface VerifiedSourceAuthorityEvidence {
  type: "YOK_HOMEPAGE" | "OBSERVED_OFFICIAL_REDIRECT" | "CHECKED_IN_AUTHORITY_ALIAS" | "CURATED_CATALOG_BINDING";
  url: string;
}

export interface VerifiedSourceAuthority {
  universityId: string;
  status: "verified" | "quarantined";
  authorityDomains: string[];
  authorityUrls: string[];
  evidence: VerifiedSourceAuthorityEvidence[];
  reasonCodes: VerifiedRegistryReasonCode[];
}

export interface QuarantinedVerifiedSource {
  id: string;
  status: "quarantined";
  field: string;
  url: string;
  reasonCode: VerifiedRegistryReasonCode;
  authorityDomains: string[];
  canonicalUrl?: string;
}

export interface VerifiedUniversitySource {
  universityId: string;
  universityName: string;
  city?: string;
  announcementUrl?: string;
  newsUrl?: string;
  eventUrl?: string;
  calendarUrl?: string;
  summerSchoolUrl?: string;
  rawUrls?: Partial<Record<VerifiedUniversitySourceUrlField, string>>;
  quarantinedSources?: QuarantinedVerifiedSource[];
}

export type VerifiedUniversitySourceUrlField = "announcementUrl" | "newsUrl" | "eventUrl" | "calendarUrl" | "summerSchoolUrl";

export interface VerifiedAcademicUnitSource {
  scopeType: "faculty" | "department";
  universityId: string;
  universityName?: string;
  facultyId?: string;
  facultyName?: string;
  departmentId?: string;
  departmentName?: string;
  websiteUrl?: string;
  announcementUrl?: string;
  newsUrl?: string;
  eventUrl?: string;
  courseScheduleUrl?: string;
  examScheduleUrl?: string;
  rawUrls?: Partial<Record<VerifiedAcademicUnitSourceUrlField, string>>;
  quarantinedSources?: QuarantinedVerifiedSource[];
}

export type VerifiedAcademicUnitSourceUrlField = "websiteUrl" | "announcementUrl" | "newsUrl" | "eventUrl" | "courseScheduleUrl" | "examScheduleUrl";

interface RawVerifiedUniversitySource {
  universityId?: unknown;
  universityName?: unknown;
  city?: unknown;
  announcementUrl?: unknown;
  newsUrl?: unknown;
  eventUrl?: unknown;
  calendarUrl?: unknown;
  summerSchoolUrl?: unknown;
}

interface RawVerifiedAcademicUnitSource {
  scopeType?: unknown;
  universityId?: unknown;
  universityName?: unknown;
  facultyId?: unknown;
  facultyName?: unknown;
  departmentId?: unknown;
  departmentName?: unknown;
  websiteUrl?: unknown;
  announcementUrl?: unknown;
  newsUrl?: unknown;
  eventUrl?: unknown;
  courseScheduleUrl?: unknown;
  examScheduleUrl?: unknown;
}

let sourceCache: Promise<VerifiedUniversitySource[]> | null = null;
let sourceMapCache: Promise<Map<string, VerifiedUniversitySource>> | null = null;
let academicUnitSourceCache: Promise<VerifiedAcademicUnitSource[]> | null = null;
let academicUnitSourceMapsCache: Promise<{ faculty: Map<string, VerifiedAcademicUnitSource>; department: Map<string, VerifiedAcademicUnitSource> }> | null = null;
let authorityCache: Promise<VerifiedSourceAuthority[]> | null = null;
let authorityMapCache: Promise<Map<string, VerifiedSourceAuthority>> | null = null;

export async function listVerifiedSourceAuthorities(): Promise<VerifiedSourceAuthority[]> {
  authorityCache ??= readVerifiedSourceAuthorities();
  return authorityCache;
}

export async function findVerifiedSourceAuthority(universityId: string): Promise<VerifiedSourceAuthority | null> {
  authorityMapCache ??= listVerifiedSourceAuthorities().then((authorities) => new Map(authorities.map((authority) => [authority.universityId, authority])));
  return (await authorityMapCache).get(universityId) ?? null;
}

export async function listVerifiedUniversitySources(): Promise<VerifiedUniversitySource[]> {
  sourceCache ??= readVerifiedUniversitySources();
  return sourceCache;
}

export async function findVerifiedUniversitySource(universityId: string): Promise<VerifiedUniversitySource | null> {
  sourceMapCache ??= listVerifiedUniversitySources().then((sources) => new Map(sources.map((source) => [source.universityId, source])));
  return (await sourceMapCache).get(universityId) ?? null;
}

export async function listVerifiedAcademicUnitSources(): Promise<VerifiedAcademicUnitSource[]> {
  academicUnitSourceCache ??= readVerifiedAcademicUnitSources();
  return academicUnitSourceCache;
}

export async function findVerifiedAcademicUnitSource(input: { facultyId?: string; departmentId?: string }): Promise<VerifiedAcademicUnitSource | null> {
  academicUnitSourceMapsCache ??= listVerifiedAcademicUnitSources().then((sources) => ({
    faculty: new Map(sources.filter((source) => source.scopeType === "faculty" && source.facultyId).map((source) => [source.facultyId!, source])),
    department: new Map(sources.filter((source) => source.scopeType === "department" && source.departmentId).map((source) => [source.departmentId!, source]))
  }));
  const maps = await academicUnitSourceMapsCache;
  return (input.departmentId ? maps.department.get(input.departmentId) : undefined)
    ?? (input.facultyId ? maps.faculty.get(input.facultyId) : undefined)
    ?? null;
}

async function readVerifiedUniversitySources(): Promise<VerifiedUniversitySource[]> {
  try {
    const [raw, authorities, catalog] = await Promise.all([
      readJsonFile(new URL("./verified-university-sources.json", import.meta.url)),
      listVerifiedSourceAuthorities(),
      readJsonFile(new URL("./turkiye-catalog-seed.json", import.meta.url))
    ]);
    if (!Array.isArray(raw)) return [];
    const authorityByUniversity = new Map(authorities.map((authority) => [authority.universityId, authority]));
    const scopeOwnership = buildSourceScopeOwnershipIndex(catalog);
    return raw
      .map((source) => normalizeVerifiedSource(source, authorityByUniversity, scopeOwnership))
      .filter((source): source is VerifiedUniversitySource => Boolean(source));
  } catch {
    return [];
  }
}

async function readVerifiedAcademicUnitSources(): Promise<VerifiedAcademicUnitSource[]> {
  try {
    const [raw, authorities, catalog] = await Promise.all([
      readJsonFile(new URL("./verified-academic-unit-sources.json", import.meta.url)),
      listVerifiedSourceAuthorities(),
      readJsonFile(new URL("./turkiye-catalog-seed.json", import.meta.url))
    ]);
    if (!Array.isArray(raw)) return [];
    const authorityByUniversity = new Map(authorities.map((authority) => [authority.universityId, authority]));
    const scopeOwnership = buildSourceScopeOwnershipIndex(catalog);
    return raw
      .map((source) => normalizeAcademicUnitSource(source, authorityByUniversity, scopeOwnership))
      .filter((source): source is VerifiedAcademicUnitSource => Boolean(source));
  } catch {
    return [];
  }
}

async function readVerifiedSourceAuthorities(): Promise<VerifiedSourceAuthority[]> {
  try {
    const raw = await readJsonFile(new URL("./verified-source-authorities.json", import.meta.url));
    if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.authorities)) return [];
    return raw.authorities
      .map(normalizeSourceAuthority)
      .filter((authority): authority is VerifiedSourceAuthority => Boolean(authority))
      .sort((left, right) => left.universityId.localeCompare(right.universityId, "en-US"));
  } catch {
    return [];
  }
}

async function readJsonFile(url: URL): Promise<unknown> {
  const data = await readFile(url);
  return JSON.parse(decodeJsonBuffer(data)) as unknown;
}

function decodeJsonBuffer(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString("utf16le");
  if (data[0] === 0xfe && data[1] === 0xff) return swapUtf16Bytes(data.subarray(2)).toString("utf16le");
  const sample = data.subarray(0, Math.min(data.length, 64));
  const oddNulls = sample.filter((byte, index) => index % 2 === 1 && byte === 0).length;
  if (oddNulls > sample.length / 4) return data.toString("utf16le").replace(/^\uFEFF/u, "");
  return data.toString("utf8").replace(/^\uFEFF/u, "");
}

function swapUtf16Bytes(data: Buffer): Buffer {
  const swapped = Buffer.from(data);
  for (let index = 0; index + 1 < swapped.length; index += 2) {
    const left = swapped[index]!;
    swapped[index] = swapped[index + 1]!;
    swapped[index + 1] = left;
  }
  return swapped;
}

function normalizeVerifiedSource(
  input: RawVerifiedUniversitySource,
  authorityByUniversity: ReadonlyMap<string, VerifiedSourceAuthority>,
  scopeOwnership: SourceScopeOwnershipIndex
): VerifiedUniversitySource | null {
  const universityId = readString(input.universityId);
  if (!universityId) return null;
  const universityName = readString(input.universityName) ?? universityId;
  const city = readString(input.city);
  const rawUrls = readRawUrls<VerifiedUniversitySourceUrlField>(input, universitySourceFields);
  const resolvedOwnership = resolveSourceScopeOwnership(scopeOwnership, {
    scopeType: "university",
    scopeId: universityId
  });
  const evaluated = evaluateOperationalUrls({
    recordKind: "university",
    scopeType: "university",
    scopeId: universityId,
    universityId,
    rawUrls,
    authority: authorityByUniversity.get(universityId),
    ...resolvedOwnership
  });

  return {
    universityId,
    universityName,
    ...(city ? { city } : {}),
    ...evaluated.operationalUrls,
    rawUrls,
    quarantinedSources: evaluated.quarantinedSources
  };
}

function normalizeAcademicUnitSource(
  input: RawVerifiedAcademicUnitSource,
  authorityByUniversity: ReadonlyMap<string, VerifiedSourceAuthority>,
  scopeOwnership: SourceScopeOwnershipIndex
): VerifiedAcademicUnitSource | null {
  const scopeType = input.scopeType === "faculty" || input.scopeType === "department" ? input.scopeType : undefined;
  const universityId = readString(input.universityId);
  if (!scopeType || !universityId) return null;
  const facultyId = readString(input.facultyId);
  const departmentId = readString(input.departmentId);
  if (scopeType === "faculty" && !facultyId) return null;
  if (scopeType === "department" && !departmentId) return null;

  const universityName = readString(input.universityName);
  const facultyName = readString(input.facultyName);
  const departmentName = readString(input.departmentName);
  const rawUrls = readRawUrls<VerifiedAcademicUnitSourceUrlField>(input, academicUnitSourceFields);
  if (scopeType === "faculty") {
    delete rawUrls.courseScheduleUrl;
    delete rawUrls.examScheduleUrl;
  }
  if (Object.keys(rawUrls).length === 0) return null;
  const scopeId = scopeType === "department" ? departmentId! : facultyId!;
  const resolvedOwnership = resolveSourceScopeOwnership(scopeOwnership, { scopeType, scopeId });
  const evaluated = evaluateOperationalUrls({
    recordKind: "academic-unit",
    scopeType,
    scopeId,
    universityId,
    rawUrls,
    authority: authorityByUniversity.get(universityId),
    ...resolvedOwnership
  });

  return {
    scopeType,
    universityId,
    ...(universityName ? { universityName } : {}),
    ...(facultyId ? { facultyId } : {}),
    ...(facultyName ? { facultyName } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(departmentName ? { departmentName } : {}),
    ...evaluated.operationalUrls,
    rawUrls,
    quarantinedSources: evaluated.quarantinedSources
  };
}

function normalizeSourceAuthority(input: unknown): VerifiedSourceAuthority | null {
  if (!isRecord(input)) return null;
  const universityId = readString(input.universityId);
  const status = input.status === "verified" || input.status === "quarantined" ? input.status : undefined;
  if (!universityId || !status || !Array.isArray(input.authorityDomains) || !Array.isArray(input.authorityUrls) || !Array.isArray(input.evidence) || !Array.isArray(input.reasonCodes)) return null;
  const authorityDomains = input.authorityDomains.map(readString).filter((value): value is string => Boolean(value));
  const authorityUrls = input.authorityUrls.map(readUrl).filter((value): value is string => Boolean(value));
  const evidence = input.evidence.map((value): VerifiedSourceAuthorityEvidence | null => {
    if (!isRecord(value)) return null;
    const type = value.type;
    const url = readUrl(value.url);
    if ((type !== "YOK_HOMEPAGE" && type !== "OBSERVED_OFFICIAL_REDIRECT" && type !== "CHECKED_IN_AUTHORITY_ALIAS" && type !== "CURATED_CATALOG_BINDING") || !url) return null;
    return { type, url };
  }).filter((value): value is VerifiedSourceAuthorityEvidence => Boolean(value));
  const reasonCodes = input.reasonCodes.map(readString).filter((value): value is VerifiedRegistryReasonCode => Boolean(value));
  if (authorityDomains.length !== input.authorityDomains.length || authorityUrls.length !== input.authorityUrls.length || evidence.length !== input.evidence.length || reasonCodes.length !== input.reasonCodes.length) return null;
  if (status === "verified" && authorityDomains.length === 0) return null;
  if (status === "quarantined" && reasonCodes.length === 0) return null;
  return { universityId, status, authorityDomains, authorityUrls, evidence, reasonCodes };
}

const universitySourceFields: readonly VerifiedUniversitySourceUrlField[] = ["announcementUrl", "newsUrl", "eventUrl", "calendarUrl", "summerSchoolUrl"];
const academicUnitSourceFields: readonly VerifiedAcademicUnitSourceUrlField[] = ["websiteUrl", "announcementUrl", "newsUrl", "eventUrl", "courseScheduleUrl", "examScheduleUrl"];

function readRawUrls<TField extends string>(input: object, fields: readonly TField[]): Partial<Record<TField, string>> {
  const urls: Partial<Record<TField, string>> = {};
  for (const field of fields) {
    const url = readUrl((input as Record<string, unknown>)[field]);
    if (url) urls[field] = url;
  }
  return urls;
}

function evaluateOperationalUrls<TField extends string>(input: {
  recordKind: "university" | "academic-unit";
  scopeType: SourceAuthorityScopeType;
  scopeId: string;
  universityId: string;
  rawUrls: Partial<Record<TField, string>>;
  authority: VerifiedSourceAuthority | undefined;
  resolvedOwnerAcademicEntityId: string | null;
  resolvedOwnerUniversityId: string | null;
}): { operationalUrls: Partial<Record<TField, string>>; quarantinedSources: QuarantinedVerifiedSource[] } {
  const operationalUrls: Partial<Record<TField, string>> = {};
  const quarantinedSources: QuarantinedVerifiedSource[] = [];
  const authorityDomains = input.authority?.status === "verified" ? input.authority.authorityDomains : [];

  for (const [field, url] of Object.entries(input.rawUrls) as Array<[TField, string]>) {
    const decision = sourceAuthorityPolicy.evaluate({
      boundary: "registration",
      resource: resourceForSourceField(field, url),
      ownerAcademicEntityId: input.scopeId,
      ownerUniversityId: input.universityId,
      resolvedOwnerAcademicEntityId: input.resolvedOwnerAcademicEntityId,
      resolvedOwnerUniversityId: input.resolvedOwnerUniversityId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      authorityDomains,
      url
    });
    if (decision.allowed && decision.canonicalUrl) {
      operationalUrls[field] = url;
      continue;
    }

    const reasonCode = input.authority?.status === "quarantined"
      ? input.authority.reasonCodes[0] ?? decision.reasonCode
      : decision.reasonCode;
    quarantinedSources.push({
      id: input.recordKind === "university"
        ? `university:${input.universityId}:${field}`
        : `academic-unit:${input.scopeType}:${input.scopeId}:${field}`,
      status: "quarantined",
      field,
      url,
      reasonCode,
      authorityDomains: [...authorityDomains],
      ...(decision.canonicalUrl ? { canonicalUrl: decision.canonicalUrl } : {})
    });
  }

  return { operationalUrls, quarantinedSources };
}

function resourceForSourceField(field: string, url: string): SourceAuthorityResource {
  if (/\.pdf(?:$|[?#])/iu.test(url)) return "pdf";
  if (field === "announcementUrl" || field === "summerSchoolUrl") return "announcement";
  if (field === "newsUrl") return "news";
  if (field === "eventUrl") return "event";
  if (field === "calendarUrl" || field === "courseScheduleUrl" || field === "examScheduleUrl") return "academic_calendar";
  return "website";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readUrl(value: unknown): string | undefined {
  const candidate = readString(value);
  if (!candidate) return undefined;
  try {
    new URL(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
