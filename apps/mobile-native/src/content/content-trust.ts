export type ContentFreshness = "fresh" | "stale";
export type ContentTrustStatus = "trusted" | "rejected" | "quarantined";
export type ContentSourceStatus = "active" | "inactive";
export type ContentCollectionState = "fresh" | "stale" | "partial";

export interface MobileContentBodyBlock {
  type: "heading" | "paragraph" | "bullet";
  text: string;
}

export interface MobileContentKeyDate {
  label: string;
  startDate: string;
  endDate?: string;
}

export interface MobileContentRecordInput {
  id: string;
  sourceId: string;
  sourceName: string;
  contentType?: "announcement" | "news" | "event";
  scopeType: "university" | "faculty" | "department";
  scopeId: string;
  universityId?: string;
  universityName?: string;
  facultyId?: string;
  facultyName?: string;
  departmentId?: string;
  departmentName?: string;
  title: string;
  link: string;
  canonicalUrl?: string;
  canonicalUrlAliases?: string[];
  contentFingerprint?: string;
  sourceRelationships?: MobileContentSourceRelationship[];
  officialSourceUrl?: string;
  publicationKind?: "date" | "timestamp";
  publishedDate?: string;
  publishedAt?: string;
  sourceUpdatedAt?: string;
  discoveredAt?: string;
  fetchedAt?: string;
  summary?: string;
  body?: MobileContentBodyBlock[];
  keyDates?: MobileContentKeyDate[];
  freshness?: ContentFreshness;
  trustStatus?: ContentTrustStatus;
  sourceStatus?: ContentSourceStatus;
  sourceTrustStatus?: ContentTrustStatus;
}

export interface MobileContentSourceRelationship {
  sourceId: string;
  sourceName: string;
  officialSourceUrl: string;
  scopeType: "university" | "faculty" | "department";
  scopeId: string;
  canonicalUrl: string;
}

export interface TrustedMobileContentRecord extends MobileContentRecordInput {
  canonicalUrl: string;
  link: string;
  officialSourceUrl: string;
  sourceRelationships: MobileContentSourceRelationship[];
  sourceName: string;
  title: string;
  trustStatus: "trusted";
  sourceStatus: "active";
  sourceTrustStatus: "trusted";
}

export interface TrustedContentCollection {
  items: TrustedMobileContentRecord[];
  state: ContentCollectionState;
  omittedCount: number;
  duplicateCount: number;
  rawItemCount: number;
  explicitRawCount?: number;
  nextCursor?: string;
  hasMore?: boolean;
}

export interface MobileContentCollectionInput {
  items: readonly MobileContentRecordInput[];
  state?: ContentCollectionState;
  sourceCount?: number;
  failedSourceCount?: number;
  rawCount?: number;
  rawItemCount?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
}

type ContentAdmissionOrigin = "explicit" | "trusted_api";

const namedEntities: Record<string, string> = {
  Aacute: "Á",
  Acirc: "Â",
  Agrave: "À",
  Aring: "Å",
  Atilde: "Ã",
  Auml: "Ä",
  Ccedil: "Ç",
  Eacute: "É",
  Ecirc: "Ê",
  Egrave: "È",
  Euml: "Ë",
  Gbreve: "Ğ",
  Iacute: "Í",
  Icirc: "Î",
  Idot: "İ",
  Igrave: "Ì",
  Iuml: "Ï",
  Oacute: "Ó",
  Ocirc: "Ô",
  Ograve: "Ò",
  Otilde: "Õ",
  Ouml: "Ö",
  Scedil: "Ş",
  Uacute: "Ú",
  Ucirc: "Û",
  Ugrave: "Ù",
  Uuml: "Ü",
  amp: "&",
  aacute: "á",
  acirc: "â",
  agrave: "à",
  apos: "'",
  aring: "å",
  atilde: "ã",
  auml: "ä",
  bull: "•",
  ccedil: "ç",
  copy: "©",
  deg: "°",
  eacute: "é",
  ecirc: "ê",
  egrave: "è",
  euml: "ë",
  ensp: " ",
  euro: "€",
  gbreve: "ğ",
  gt: ">",
  hellip: "…",
  iacute: "í",
  icirc: "î",
  igrave: "ì",
  iuml: "ï",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  oacute: "ó",
  ocirc: "ô",
  ograve: "ò",
  otilde: "õ",
  ouml: "ö",
  quot: "\"",
  raquo: "»",
  reg: "®",
  rdquo: "”",
  rsquo: "’",
  scedil: "ş",
  trade: "™",
  uacute: "ú",
  ucirc: "û",
  ugrave: "ù",
  uuml: "ü"
};

const navigationTitles = new Set([
  "ana sayfa",
  "anasayfa",
  "alt bilgi",
  "altbilgi",
  "bagli kuruluslar",
  "breadcrumb",
  "devamini oku",
  "devami",
  "duyuru",
  "duyurular",
  "footer",
  "gecmis duyurular",
  "gezinti",
  "iletisim",
  "menu",
  "news",
  "onceki",
  "sayfa alti",
  "sayfa sonu",
  "sidebar",
  "sonraki",
  "tum duyurular",
  "ust menu",
  "yan menu"
]);

const trackingParameterPattern = /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/iu;
const strictIsoTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/u;

export function decodeHtmlEntities(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 16; pass += 1) {
    const next = decoded.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/giu, (entity, token: string) => {
      const normalized = token.toLocaleLowerCase("en-US");
      if (normalized.startsWith("#x")) return decodeNumericEntity(normalized.slice(2), 16);
      if (normalized.startsWith("#")) return decodeNumericEntity(normalized.slice(1), 10);
      return namedEntities[token] ?? namedEntities[normalized] ?? " ";
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded.replace(/&(?:#x[0-9a-f]+|#\d+|[a-z][a-z\d]+);/giu, " ");
}

export function normalizeDisplayText(value: string | undefined): string {
  if (!value) return "";
  return decodeHtmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function canonicalizeHttpUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const decoded = decodeHtmlEntities(value).trim();
    if (!decoded || decoded.length > 2_048) return null;
    const url = new URL(decoded);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || url.username || url.password) return null;
    if (url.port && url.port !== "80" && url.port !== "443") return null;

    url.hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/u, "");
    if (isUnsafeHostname(url.hostname)) return null;
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (trackingParameterPattern.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/{2,}/gu, "/");
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/gu, "");
    if (!url.hash.startsWith("#!")) url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function canonicalizeOfficialAcademicUrl(value: string | undefined): string | null {
  const canonicalUrl = canonicalizeHttpUrl(value);
  return canonicalUrl && officialDomainForUrl(canonicalUrl) ? canonicalUrl : null;
}

export function isNavigationContentTitle(value: string): boolean {
  const title = foldForTrust(value);
  if (!title || !/[\p{L}\p{N}]/u.test(title)) return true;
  if (navigationTitles.has(title)) return true;
  return /^(?:devamini oku|onceki|sonraki)(?:\s+(?:sayfa|kayit|duyuru|haber|etkinlik|\d+))*$/u.test(title)
    || /^(?:sayfa\s+)?\d+(?:\s*\/\s*\d+)?$/u.test(title)
    || /^\d+\s+of\s+\d+$/u.test(title)
    || /^\d+(?:\s+\d+)+$/u.test(title)
    || /^[\p{L}\p{N}]{2,12}\s+news$/u.test(title);
}

export function normalizeTrustedContentCollection(
  records: readonly MobileContentRecordInput[]
): TrustedContentCollection {
  return normalizeContentCollection(records, "explicit");
}

/**
 * Admits records returned by a trusted-content API boundary. The server has
 * already proved active/trusted item and source status; any contradictory
 * status that is nevertheless present on the wire still fails closed.
 */
export function normalizeTrustedApiContentCollection(
  records: readonly MobileContentRecordInput[]
): TrustedContentCollection {
  return normalizeContentCollection(records, "trusted_api");
}

/** Re-validates one record at every native render or navigation handoff. */
export function admitTrustedContentRecord(
  record: MobileContentRecordInput
): TrustedMobileContentRecord | null {
  const normalized = normalizeTrustedContentRecord(record, "explicit");
  if (!normalized) return null;
  if (
    normalized.id !== record.id
    || normalized.sourceId !== record.sourceId
    || normalized.scopeId !== record.scopeId
    || normalized.sourceName !== record.sourceName
    || normalized.title !== record.title
    || normalized.canonicalUrl !== record.canonicalUrl
    || normalized.link !== record.link
    || normalized.officialSourceUrl !== record.officialSourceUrl
    || normalized.universityId !== record.universityId
    || normalized.universityName !== record.universityName
    || normalized.facultyId !== record.facultyId
    || normalized.facultyName !== record.facultyName
    || normalized.departmentId !== record.departmentId
    || normalized.departmentName !== record.departmentName
    || (record.summary !== undefined && normalized.summary !== record.summary)
    || (record.body !== undefined && JSON.stringify(normalized.body ?? []) !== JSON.stringify(record.body))
    || (record.keyDates !== undefined && JSON.stringify(normalized.keyDates ?? []) !== JSON.stringify(record.keyDates))
  ) return null;
  return normalized;
}

/**
 * Record ids are storage identity only. Logical identity is source + scope +
 * a valid fingerprint, with a scoped canonical-url fallback for legacy rows.
 */
export function logicalContentIdentityKey(
  record: Pick<MobileContentRecordInput, "sourceId" | "scopeType" | "scopeId" | "contentFingerprint" | "canonicalUrl" | "link">
): string | null {
  const sourceId = normalizeIdentifier(record.sourceId);
  const scopeId = normalizeIdentifier(record.scopeId);
  if (!sourceId || !scopeId || !isAcademicScope(record.scopeType)) return null;
  const fingerprint = validContentFingerprint(record.contentFingerprint);
  if (fingerprint) {
    return JSON.stringify(["content-v1", "fingerprint", sourceId, record.scopeType, scopeId, fingerprint]);
  }
  const canonicalUrl = canonicalizeOfficialAcademicUrl(record.canonicalUrl ?? record.link);
  if (!canonicalUrl) return null;
  return JSON.stringify([
    "content-v1",
    "canonical",
    sourceId,
    record.scopeType,
    scopeId,
    canonicalContentKey(canonicalUrl)
  ]);
}

function normalizeContentCollection(
  records: readonly MobileContentRecordInput[],
  origin: ContentAdmissionOrigin
): TrustedContentCollection {
  const unique = new Map<string, TrustedMobileContentRecord>();
  let omittedCount = 0;
  let duplicateCount = 0;

  for (const record of records) {
    const normalized = normalizeTrustedContentRecord(record, origin);
    if (!normalized) {
      omittedCount += 1;
      continue;
    }

    const canonicalKey = logicalContentIdentityKey(normalized);
    if (!canonicalKey) {
      omittedCount += 1;
      continue;
    }
    const existing = unique.get(canonicalKey);
    if (!existing) {
      unique.set(canonicalKey, normalized);
      continue;
    }

    duplicateCount += 1;
    const preferred = preferContentRecord(normalized, existing) ? normalized : existing;
    unique.set(canonicalKey, {
      ...preferred,
      canonicalUrlAliases: [...new Set([
        existing.canonicalUrl,
        ...(existing.canonicalUrlAliases ?? []),
        normalized.canonicalUrl,
        ...(normalized.canonicalUrlAliases ?? [])
      ])].sort(compareStableText),
      sourceRelationships: mergeSourceRelationships(existing, normalized)
    });
  }

  const items = [...unique.values()];
  const staleCount = items.filter((item) => item.freshness === "stale").length;
  const state: ContentCollectionState = omittedCount > 0 || (staleCount > 0 && staleCount < items.length)
    ? "partial"
    : staleCount > 0
      ? "stale"
      : "fresh";

  return { items, state, omittedCount, duplicateCount, rawItemCount: records.length };
}

export function normalizeTrustedContentEnvelope(
  collection: MobileContentCollectionInput
): TrustedContentCollection {
  return normalizeContentEnvelope(collection, "explicit");
}

export function normalizeTrustedApiContentEnvelope(
  collection: MobileContentCollectionInput
): TrustedContentCollection {
  return normalizeContentEnvelope(collection, "trusted_api");
}

function normalizeContentEnvelope(
  collection: MobileContentCollectionInput,
  origin: ContentAdmissionOrigin
): TrustedContentCollection {
  const normalized = normalizeContentCollection(collection.items, origin);
  const sourceState = collection.failedSourceCount !== undefined && collection.failedSourceCount > 0
    ? "partial"
    : collection.state;
  const state = normalized.state === "partial" || sourceState === "partial"
    ? "partial"
    : normalized.state === "stale" || sourceState === "stale"
      ? "stale"
      : "fresh";
  const nextCursor = typeof collection.nextCursor === "string" && collection.nextCursor.trim()
    ? collection.nextCursor.trim()
    : undefined;
  const explicitRawCount = validRawCount(collection.rawCount) ?? validRawCount(collection.rawItemCount);
  return {
    ...normalized,
    state,
    ...(explicitRawCount === undefined ? {} : { explicitRawCount }),
    ...(nextCursor ? { nextCursor } : {}),
    ...(typeof collection.hasMore === "boolean" ? { hasMore: collection.hasMore } : {})
  };
}

export function contentTimestampLabel(
  record: Pick<MobileContentRecordInput, "publicationKind" | "publishedDate" | "publishedAt" | "sourceUpdatedAt" | "discoveredAt" | "fetchedAt">
): string {
  const publishedDate = record.publicationKind === "date" ? validDateOnly(record.publishedDate) : undefined;
  if (publishedDate) return `Yayınlandı ${formatContentDate(publishedDate)}`;

  const publishedAt = record.publicationKind === "date" ? null : validDate(record.publishedAt);
  if (publishedAt) return `Yayınlandı ${formatContentTimestamp(publishedAt)}`;

  const sourceUpdatedAt = validDate(record.sourceUpdatedAt);
  if (sourceUpdatedAt) return `Güncellendi ${formatContentTimestamp(sourceUpdatedAt)}`;

  return "Yayın tarihi belirtilmemiş";
}

function normalizeTrustedContentRecord(
  record: MobileContentRecordInput,
  origin: ContentAdmissionOrigin
): TrustedMobileContentRecord | null {
  if (!hasTrustedAdmissionEvidence(record, origin)) return null;

  const id = normalizeIdentifier(record.id);
  const sourceId = normalizeIdentifier(record.sourceId);
  const scopeId = normalizeIdentifier(record.scopeId);
  if (!id || !sourceId || !scopeId || !isAcademicScope(record.scopeType)) return null;
  if (record.contentType !== undefined && !isAcademicContentType(record.contentType)) return null;

  const canonicalUrl = canonicalizeOfficialAcademicUrl(record.canonicalUrl ?? record.link);
  if (!canonicalUrl) return null;
  const candidateOfficialDomain = officialDomainForUrl(canonicalUrl)!;
  const link = canonicalizeOfficialAcademicUrl(record.link);
  const officialSourceUrl = canonicalizeOfficialAcademicUrl(record.officialSourceUrl);
  if (!link || canonicalContentKey(link) !== canonicalContentKey(canonicalUrl)) return null;
  if (!officialSourceUrl || officialDomainForUrl(officialSourceUrl) !== candidateOfficialDomain) return null;

  const title = normalizeDisplayText(record.title)
    .replace(/^\s*(?:\d{1,4}\s*of\s*\d{1,4}|\d{1,3}\s*\/\s*\d{1,4})\s*(?:[-–—:|>»]+\s*)?/iu, "")
    .trim();
  if (!title || isNavigationContentTitle(title) || !hasUsableDisplayTitle(title)) return null;

  const sourceName = normalizeDisplayText(record.sourceName);
  if (!isExplicitAcademicSourceName(sourceName)) return null;
  const academicHierarchy = normalizeAcademicHierarchy(record, scopeId);
  if (!academicHierarchy) return null;
  const summary = normalizeDisplayText(record.summary);
  const body = normalizeContentBodyBlocks(record.body);
  const keyDates = normalizeContentKeyDates(record.keyDates);
  const fetchedAt = validIsoTimestamp(record.fetchedAt);
  const publishedDate = record.publicationKind === "date" ? validDateOnly(record.publishedDate) : undefined;
  const candidatePublishedAt = record.publicationKind === "date" ? undefined : validIsoTimestamp(record.publishedAt);
  const publishedAt = candidatePublishedAt && candidatePublishedAt !== fetchedAt ? candidatePublishedAt : undefined;
  const publicationKind = publishedDate ? "date" as const : publishedAt ? "timestamp" as const : undefined;
  const candidateSourceUpdatedAt = validIsoTimestamp(record.sourceUpdatedAt);
  const sourceUpdatedAt = candidateSourceUpdatedAt && candidateSourceUpdatedAt !== fetchedAt
    ? candidateSourceUpdatedAt
    : undefined;
  const discoveredAt = validIsoTimestamp(record.discoveredAt);
  const {
    canonicalUrl: _canonicalUrl,
    canonicalUrlAliases: _canonicalUrlAliases,
    body: _body,
    contentFingerprint: _contentFingerprint,
    discoveredAt: _discoveredAt,
    departmentId: _departmentId,
    departmentName: _departmentName,
    facultyId: _facultyId,
    facultyName: _facultyName,
    fetchedAt: _fetchedAt,
    keyDates: _keyDates,
    officialSourceUrl: _officialSourceUrl,
    publicationKind: _publicationKind,
    publishedDate: _publishedDate,
    publishedAt: _publishedAt,
    sourceRelationships: _sourceRelationships,
    sourceStatus: _sourceStatus,
    sourceTrustStatus: _sourceTrustStatus,
    sourceUpdatedAt: _sourceUpdatedAt,
    summary: _summary,
    trustStatus: _trustStatus,
    universityId: _universityId,
    universityName: _universityName,
    ...baseRecord
  } = record;
  const contentFingerprint = validContentFingerprint(record.contentFingerprint);
  const canonicalUrlAliases = normalizeCanonicalAliases(record.canonicalUrlAliases, canonicalUrl, candidateOfficialDomain);
  const sourceRelationships = normalizeSourceRelationships(record.sourceRelationships);
  if (
    sourceRelationships.length === 0
    || sourceRelationships.length !== (record.sourceRelationships?.length ?? 0)
    || sourceRelationships.some((relationship) => (
      relationship.sourceId !== sourceId
      || relationship.sourceName !== sourceName
      || relationship.scopeType !== record.scopeType
      || relationship.scopeId !== scopeId
      || officialDomainForUrl(relationship.officialSourceUrl) !== candidateOfficialDomain
      || officialDomainForUrl(relationship.canonicalUrl) !== candidateOfficialDomain
    ))
  ) return null;

  return {
    ...baseRecord,
    id,
    sourceId,
    scopeId,
    sourceName,
    title,
    link: canonicalUrl,
    canonicalUrl,
    canonicalUrlAliases,
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
    officialSourceUrl,
    sourceRelationships,
    ...academicHierarchy,
    ...(contentFingerprint ? { contentFingerprint } : {}),
    ...(summary ? { summary } : {}),
    ...(body.length ? { body } : {}),
    ...(keyDates.length ? { keyDates } : {}),
    ...(publicationKind === "date" && publishedDate ? { publicationKind, publishedDate } : {}),
    ...(publicationKind === "timestamp" && publishedAt ? { publicationKind, publishedAt } : {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    ...(discoveredAt ? { discoveredAt } : {}),
    ...(fetchedAt ? { fetchedAt } : {})
  };
}

function normalizeAcademicHierarchy(
  record: MobileContentRecordInput,
  scopeId: string,
): Pick<
  MobileContentRecordInput,
  "universityId" | "universityName" | "facultyId" | "facultyName" | "departmentId" | "departmentName"
> | null {
  const university = normalizeAcademicUnit(record.universityId, record.universityName);
  const faculty = normalizeAcademicUnit(record.facultyId, record.facultyName);
  const department = normalizeAcademicUnit(record.departmentId, record.departmentName);
  if (university === false || faculty === false || department === false) return null;

  const hasHierarchy = Boolean(university || faculty || department);
  if (!hasHierarchy) return {};
  if (!university) return null;
  if (record.scopeType === "university" && (university.id !== scopeId || faculty || department)) return null;
  if (record.scopeType === "faculty" && (!faculty || faculty.id !== scopeId || department)) return null;
  if (record.scopeType === "department" && (!faculty || !department || department.id !== scopeId)) return null;

  return {
    universityId: university.id,
    universityName: university.name,
    ...(faculty ? { facultyId: faculty.id, facultyName: faculty.name } : {}),
    ...(department ? { departmentId: department.id, departmentName: department.name } : {}),
  };
}

function normalizeAcademicUnit(
  rawId: string | undefined,
  rawName: string | undefined,
): { id: string; name: string } | false | null {
  if (rawId === undefined && rawName === undefined) return null;
  const id = normalizeIdentifier(rawId);
  const name = normalizeDisplayText(rawName);
  if (!id || !name) return false;
  return { id, name };
}

function decodeNumericEntity(value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix);
  if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    return " ";
  }
  return String.fromCodePoint(codePoint);
}

function foldForTrust(value: string): string {
  return normalizeDisplayText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/gu, "i")
    .replace(/\u0130/gu, "I")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function hasUsableDisplayTitle(value: string): boolean {
  return (value.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3;
}

function hasTrustedAdmissionEvidence(
  record: MobileContentRecordInput,
  origin: ContentAdmissionOrigin
): boolean {
  if (record.trustStatus !== undefined && record.trustStatus !== "trusted") return false;
  if (record.sourceStatus !== undefined && record.sourceStatus !== "active") return false;
  if (record.sourceTrustStatus !== undefined && record.sourceTrustStatus !== "trusted") return false;
  return origin === "trusted_api" || (
    record.trustStatus === "trusted"
    && record.sourceStatus === "active"
    && record.sourceTrustStatus === "trusted"
  );
}

function normalizeIdentifier(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  if (
    !normalized
    || normalized !== value
    || normalized.length > 512
    || /[\u0000-\u001F\u007F-\u009F]/u.test(normalized)
  ) return null;
  return normalized;
}

function isAcademicScope(value: string): value is MobileContentRecordInput["scopeType"] {
  return value === "university" || value === "faculty" || value === "department";
}

function isAcademicContentType(value: string): value is NonNullable<MobileContentRecordInput["contentType"]> {
  return value === "announcement" || value === "news" || value === "event";
}

function isExplicitAcademicSourceName(value: string): boolean {
  const folded = foldForTrust(value);
  return Boolean(folded) && !new Set([
    "kaynak",
    "akademik kaynak",
    "resmi kaynak",
    "resmi akademik kaynak",
    "official source",
    "official academic source"
  ]).has(folded);
}

function validContentFingerprint(value: string | undefined): string | undefined {
  return typeof value === "string" && /^[a-f\d]{64}$/u.test(value) ? value : undefined;
}

function validRawCount(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function validDateOnly(value: string | undefined): string | undefined {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
    ? value
    : undefined;
}

function normalizeContentBodyBlocks(input: unknown): MobileContentBodyBlock[] {
  if (!Array.isArray(input)) return [];
  const blocks: MobileContentBodyBlock[] = [];
  let totalLength = 0;
  for (const candidate of input.slice(0, 48)) {
    if (!candidate || typeof candidate !== "object") continue;
    const value = candidate as Record<string, unknown>;
    if (value.type !== "heading" && value.type !== "paragraph" && value.type !== "bullet") continue;
    const text = normalizeDisplayText(typeof value.text === "string" ? value.text : undefined).slice(0, 800).trim();
    if (!text || totalLength + text.length > 12_000) continue;
    blocks.push({ type: value.type, text });
    totalLength += text.length;
  }
  return blocks;
}

function normalizeContentKeyDates(input: unknown): MobileContentKeyDate[] {
  if (!Array.isArray(input)) return [];
  const dates: MobileContentKeyDate[] = [];
  for (const candidate of input.slice(0, 16)) {
    if (!candidate || typeof candidate !== "object") continue;
    const value = candidate as Record<string, unknown>;
    const label = normalizeDisplayText(typeof value.label === "string" ? value.label : undefined).slice(0, 160).trim();
    const startDate = validDateOnly(typeof value.startDate === "string" ? value.startDate : undefined);
    const endDate = validDateOnly(typeof value.endDate === "string" ? value.endDate : undefined);
    if (!label || !startDate || (endDate && endDate < startDate)) continue;
    dates.push({ label, startDate, ...(endDate && endDate !== startDate ? { endDate } : {}) });
  }
  return dates;
}

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const match = strictIsoTimestampPattern.exec(value);
  if (!match) return null;
  const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue, , , offsetHourValue, offsetMinuteValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = Number(secondValue);
  const offsetHour = Number(offsetHourValue ?? 0);
  const offsetMinute = Number(offsetMinuteValue ?? 0);
  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth(year, month)
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 14
    || offsetMinute > 59
    || (offsetHour === 14 && offsetMinute !== 0)
  ) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validIsoTimestamp(value: string | undefined): string | undefined {
  const date = validDate(value);
  return date?.toISOString();
}

function formatContentTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul"
  }).format(date);
}

function formatContentDate(value: string): string {
  const [year = "", month = "", day = ""] = value.split("-");
  const monthLabel = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"][Number(month) - 1];
  return `${day} ${monthLabel ?? month} ${year}`;
}

function normalizeCanonicalAliases(
  aliases: readonly string[] | undefined,
  canonicalUrl: string,
  officialDomain: string
): string[] {
  return [...new Set([canonicalUrl, ...(aliases ?? [])].flatMap((value) => {
    const normalized = canonicalizeOfficialAcademicUrl(value);
    return normalized && officialDomainForUrl(normalized) === officialDomain ? [normalized] : [];
  }))].sort(compareStableText);
}

function normalizeSourceRelationships(
  relationships: readonly MobileContentSourceRelationship[] | undefined
): MobileContentSourceRelationship[] {
  const normalized = (relationships ?? []).flatMap((relationship): MobileContentSourceRelationship[] => {
    const sourceId = normalizeIdentifier(relationship.sourceId);
    const scopeId = normalizeIdentifier(relationship.scopeId);
    const sourceName = normalizeDisplayText(relationship.sourceName);
    const officialSourceUrl = canonicalizeOfficialAcademicUrl(relationship.officialSourceUrl);
    const canonicalUrl = canonicalizeOfficialAcademicUrl(relationship.canonicalUrl);
    if (
      !sourceId
      || !scopeId
      || !isExplicitAcademicSourceName(sourceName)
      || !officialSourceUrl
      || !canonicalUrl
      || !isAcademicScope(relationship.scopeType)
      || officialDomainForUrl(officialSourceUrl) !== officialDomainForUrl(canonicalUrl)
    ) return [];
    return [{ ...relationship, sourceId, scopeId, sourceName, officialSourceUrl, canonicalUrl }];
  });
  return [...new Map(normalized.map((relationship) => [
    [relationship.scopeType, relationship.scopeId, relationship.sourceId, relationship.canonicalUrl].join("\u0000"),
    relationship
  ])).values()].sort((left, right) => compareStableText(
    [left.scopeType, left.scopeId, left.sourceId, left.canonicalUrl].join("\u0000"),
    [right.scopeType, right.scopeId, right.sourceId, right.canonicalUrl].join("\u0000")
  ));
}

function mergeSourceRelationships(
  left: TrustedMobileContentRecord,
  right: TrustedMobileContentRecord
): MobileContentSourceRelationship[] {
  return normalizeSourceRelationships([...(left.sourceRelationships ?? []), ...(right.sourceRelationships ?? [])]);
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function preferContentRecord(next: TrustedMobileContentRecord, existing: TrustedMobileContentRecord): boolean {
  if (next.freshness === "fresh" && existing.freshness === "stale") return true;
  if (next.freshness === "stale" && existing.freshness === "fresh") return false;
  const nextSourceTime = contentSourceTimestamp(next);
  const existingSourceTime = contentSourceTimestamp(existing);
  if (Boolean(nextSourceTime) !== Boolean(existingSourceTime)) return Boolean(nextSourceTime);
  if (nextSourceTime !== existingSourceTime) return nextSourceTime > existingSourceTime;
  const nextOperationalTime = contentOperationalTimestamp(next);
  const existingOperationalTime = contentOperationalTimestamp(existing);
  if (nextOperationalTime !== existingOperationalTime) return nextOperationalTime > existingOperationalTime;
  return next.id.localeCompare(existing.id, "en-US") < 0;
}

function contentSourceTimestamp(record: TrustedMobileContentRecord): number {
  return Math.max(
    validDate(record.publishedAt)?.getTime() ?? 0,
    record.publishedDate ? Date.parse(`${record.publishedDate}T12:00:00+03:00`) || 0 : 0,
    validDate(record.sourceUpdatedAt)?.getTime() ?? 0
  );
}

function contentOperationalTimestamp(record: TrustedMobileContentRecord): number {
  return Math.max(
    validDate(record.discoveredAt)?.getTime() ?? 0,
    validDate(record.fetchedAt)?.getTime() ?? 0
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function officialDomainForUrl(value: string): string | null {
  const canonicalUrl = canonicalizeHttpUrl(value);
  if (!canonicalUrl) return null;
  const labels = new URL(canonicalUrl).hostname.replace(/^www\./u, "").split(".").filter(Boolean);
  if (labels.length < 3) return null;
  const suffix = labels.slice(-2).join(".");
  if (suffix !== "edu.tr" && suffix !== "gov.tr") return null;
  return labels.slice(-3).join(".");
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLocaleLowerCase("en-US");
  if (
    !normalized
    || normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".lan")
  ) return true;

  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (normalized.includes(":")) {
    if (mappedIpv4) return isUnsafeIpv4(mappedIpv4);
    return normalized === "::"
      || normalized === "::1"
      || normalized.startsWith("::ffff:")
      || normalized.startsWith("fe80:")
      || normalized.startsWith("fc")
      || normalized.startsWith("fd");
  }

  return /^\d+\.\d+\.\d+\.\d+$/u.test(normalized) && isUnsafeIpv4(normalized);
}

function isUnsafeIpv4(value: string): boolean {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [first = 0, second = 0] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || first >= 224;
}

function canonicalContentKey(value: string): string {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^www\./u, "");
  return `${hostname}${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}${url.hash}`;
}
