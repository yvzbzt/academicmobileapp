import {
  canonicalizeOfficialAcademicUrl,
  normalizeDisplayText,
  officialDomainForUrl,
} from "./content-trust";

export type DeviceContentType = "announcement" | "news" | "event";
export type DeviceSourceScopeType = "university" | "faculty" | "department";
export type DeviceSourceParser = "auto" | "rss" | "html";

export interface DeviceSourceParserConfig {
  itemSelector?: string;
  titleSelector?: string;
  linkSelector?: string;
  dateSelector?: string;
  eventDateSelector?: string;
  contentSelector?: string;
}

export interface DeviceContentSource {
  id: string;
  sourceName: string;
  sourceUrl: string;
  allowedHostname: string;
  allowedOfficialDomain: string;
  fetchAllowed: boolean;
  contentType: DeviceContentType;
  scopeType: DeviceSourceScopeType;
  scopeId: string;
  universityId?: string;
  universityName?: string;
  facultyId?: string;
  facultyName?: string;
  departmentId?: string;
  departmentName?: string;
  parser: DeviceSourceParser;
  parserConfig?: DeviceSourceParserConfig;
  definitionVersion: string;
  contentRevision: string;
  checkedAt: string;
  validUntil: string;
}

export interface DeviceContentSourceManifest {
  schemaVersion: 2;
  version: string;
  refreshRequired: boolean;
  generatedAt: string;
  revalidateAfter: string;
  sources: DeviceContentSource[];
}

const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const IDENTIFIER_PATTERN = /^[\p{L}\p{N}._:@/+-]{1,512}$/u;
const MAX_SOURCE_COUNT = 512;
const MAX_SELECTOR_LENGTH = 300;

export function readDeviceContentSourceManifest(value: unknown): DeviceContentSourceManifest | null {
  if (!isRecord(value) || value.schemaVersion !== 2) return null;
  if (!SHA256_PATTERN.test(asString(value.version))) return null;
  if (typeof value.refreshRequired !== "boolean") return null;
  const generatedAt = readIsoTimestamp(value.generatedAt);
  const revalidateAfter = readIsoTimestamp(value.revalidateAfter);
  if (!generatedAt || !revalidateAfter || revalidateAfter < generatedAt) return null;
  if (!Array.isArray(value.sources) || value.sources.length > MAX_SOURCE_COUNT) return null;
  const sources: DeviceContentSource[] = [];
  const ids = new Set<string>();
  for (const candidate of value.sources) {
    const source = readDeviceContentSource(candidate, generatedAt);
    if (!source || ids.has(source.id)) return null;
    ids.add(source.id);
    sources.push(source);
  }
  return {
    schemaVersion: 2,
    version: asString(value.version),
    refreshRequired: value.refreshRequired,
    generatedAt,
    revalidateAfter,
    sources,
  };
}

export function isDeviceSourceCurrentlyTrusted(source: DeviceContentSource, now = new Date()): boolean {
  const validUntil = Date.parse(source.validUntil);
  return Number.isFinite(validUntil) && validUntil > now.getTime();
}

function readDeviceContentSource(value: unknown, generatedAt: string): DeviceContentSource | null {
  if (!isRecord(value)) return null;
  const id = readIdentifier(value.id);
  const sourceName = normalizeDisplayText(asString(value.sourceName));
  const sourceUrl = canonicalizeOfficialAcademicUrl(asString(value.sourceUrl));
  const allowedHostname = asString(value.allowedHostname).toLocaleLowerCase("en-US");
  const allowedOfficialDomain = asString(value.allowedOfficialDomain).toLocaleLowerCase("en-US");
  const fetchAllowed = typeof value.fetchAllowed === "boolean" ? value.fetchAllowed : null;
  const contentType = readContentType(value.contentType);
  const scopeType = readScopeType(value.scopeType);
  const scopeId = readIdentifier(value.scopeId);
  const hierarchy = scopeType && scopeId ? readSourceHierarchy(value, scopeType, scopeId) : false;
  const parser = readParser(value.parser);
  const parserConfig = readParserConfig(value.parserConfig);
  const definitionVersion = readDefinitionVersion(value.definitionVersion);
  const contentRevision = asString(value.contentRevision);
  const checkedAt = readIsoTimestamp(value.checkedAt);
  const validUntil = readIsoTimestamp(value.validUntil);
  if (
    !id
    || !sourceName
    || !sourceUrl
    || new URL(sourceUrl).protocol !== "https:"
    || !allowedHostname
    || new URL(sourceUrl).hostname.toLocaleLowerCase("en-US") !== allowedHostname
    || officialDomainForUrl(sourceUrl) !== allowedOfficialDomain
    || fetchAllowed === null
    || !contentType
    || !scopeType
    || !scopeId
    || hierarchy === false
    || !parser
    || parserConfig === false
    || !definitionVersion
    || !SHA256_PATTERN.test(contentRevision)
    || !checkedAt
    || !validUntil
    || Date.parse(checkedAt) > Date.parse(generatedAt)
    || Date.parse(validUntil) <= Date.parse(generatedAt)
  ) return null;
  return {
    id,
    sourceName,
    sourceUrl,
    allowedHostname,
    allowedOfficialDomain,
    fetchAllowed,
    contentType,
    scopeType,
    scopeId,
    ...(hierarchy ?? {}),
    parser,
    ...(parserConfig ? { parserConfig } : {}),
    definitionVersion,
    contentRevision,
    checkedAt,
    validUntil,
  };
}

function readSourceHierarchy(
  value: Record<string, unknown>,
  scopeType: DeviceSourceScopeType,
  scopeId: string,
): Pick<DeviceContentSource,
  "universityId" | "universityName" | "facultyId" | "facultyName" | "departmentId" | "departmentName"
> | false | undefined {
  const keys = ["universityId", "universityName", "facultyId", "facultyName", "departmentId", "departmentName"] as const;
  if (keys.every((key) => value[key] === undefined)) return undefined;
  const universityId = readIdentifier(value.universityId);
  const universityName = normalizeDisplayText(asString(value.universityName));
  const facultyId = value.facultyId === undefined ? undefined : readIdentifier(value.facultyId) ?? false;
  const facultyName = value.facultyName === undefined ? undefined : normalizeDisplayText(asString(value.facultyName)) || false;
  const departmentId = value.departmentId === undefined ? undefined : readIdentifier(value.departmentId) ?? false;
  const departmentName = value.departmentName === undefined ? undefined : normalizeDisplayText(asString(value.departmentName)) || false;
  if (
    !universityId
    || !universityName
    || facultyId === false
    || facultyName === false
    || departmentId === false
    || departmentName === false
    || Boolean(facultyId) !== Boolean(facultyName)
    || Boolean(departmentId) !== Boolean(departmentName)
    || (departmentId && !facultyId)
    || (scopeType === "university" && scopeId !== universityId)
    || (scopeType === "faculty" && scopeId !== facultyId)
    || (scopeType === "department" && scopeId !== departmentId)
  ) return false;
  return {
    universityId,
    universityName,
    ...(facultyId && facultyName ? { facultyId, facultyName } : {}),
    ...(departmentId && departmentName ? { departmentId, departmentName } : {}),
  };
}

function readParserConfig(value: unknown): DeviceSourceParserConfig | false | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return false;
  const result: DeviceSourceParserConfig = {};
  for (const key of ["itemSelector", "titleSelector", "linkSelector", "dateSelector", "eventDateSelector", "contentSelector"] as const) {
    if (value[key] === undefined) continue;
    const selector = asString(value[key]).trim();
    if (!selector || selector.length > MAX_SELECTOR_LENGTH) return false;
    result[key] = selector;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function readIsoTimestamp(value: unknown): string | null {
  const timestamp = asString(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(timestamp)) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === timestamp ? timestamp : null;
}

function readIdentifier(value: unknown): string | null {
  const identifier = asString(value);
  return identifier === identifier.trim() && IDENTIFIER_PATTERN.test(identifier) ? identifier : null;
}

function readDefinitionVersion(value: unknown): string | null {
  const version = asString(value);
  return version.length <= 64 ? readIdentifier(version) : null;
}

function readContentType(value: unknown): DeviceContentType | null {
  return value === "announcement" || value === "news" || value === "event" ? value : null;
}

function readScopeType(value: unknown): DeviceSourceScopeType | null {
  return value === "university" || value === "faculty" || value === "department" ? value : null;
}

function readParser(value: unknown): DeviceSourceParser | null {
  return value === "auto" || value === "rss" || value === "html" ? value : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
