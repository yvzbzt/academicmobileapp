export type ContentFreshness = "fresh" | "stale";
export type ContentTrustStatus = "trusted" | "rejected" | "quarantined";
export type ContentCollectionState = "fresh" | "stale" | "partial";

export interface MobileContentRecordInput {
  id: string;
  sourceId: string;
  sourceName: string;
  contentType?: "announcement" | "news" | "event";
  scopeType: "university" | "faculty" | "department";
  scopeId: string;
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
  freshness?: ContentFreshness;
  trustStatus?: ContentTrustStatus;
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
  sourceName: string;
  title: string;
  trustStatus: "trusted";
}

export interface TrustedContentCollection {
  items: TrustedMobileContentRecord[];
  state: ContentCollectionState;
  omittedCount: number;
  duplicateCount: number;
}

export interface MobileContentCollectionInput {
  items: readonly MobileContentRecordInput[];
  state?: ContentCollectionState;
  sourceCount?: number;
  failedSourceCount?: number;
}

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
  "menu",
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
    || /^\d+(?:\s+\d+)+$/u.test(title);
}

export function normalizeTrustedContentCollection(
  records: readonly MobileContentRecordInput[]
): TrustedContentCollection {
  const unique = new Map<string, TrustedMobileContentRecord>();
  let omittedCount = 0;
  let duplicateCount = 0;

  for (const record of records) {
    const normalized = normalizeTrustedContentRecord(record);
    if (!normalized) {
      omittedCount += 1;
      continue;
    }

    const canonicalKey = normalized.contentFingerprint
      ? `${normalized.scopeType}\u0000${normalized.scopeId}\u0000${normalized.contentFingerprint}`
      : `${normalized.scopeType}\u0000${normalized.scopeId}\u0000${canonicalContentKey(normalized.canonicalUrl)}`;
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

  return { items, state, omittedCount, duplicateCount };
}

export function normalizeTrustedContentEnvelope(
  collection: MobileContentCollectionInput
): TrustedContentCollection {
  const normalized = normalizeTrustedContentCollection(collection.items);
  const sourceState = collection.failedSourceCount !== undefined && collection.failedSourceCount > 0
    ? "partial"
    : collection.state;
  const state = normalized.state === "partial" || sourceState === "partial"
    ? "partial"
    : normalized.state === "stale" || sourceState === "stale"
      ? "stale"
      : "fresh";
  return { ...normalized, state };
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

function normalizeTrustedContentRecord(record: MobileContentRecordInput): TrustedMobileContentRecord | null {
  if (record.trustStatus === "rejected" || record.trustStatus === "quarantined") return null;

  const canonicalUrl = canonicalizeOfficialAcademicUrl(record.canonicalUrl ?? record.link);
  if (!canonicalUrl) return null;
  const candidateOfficialDomain = officialDomainForUrl(canonicalUrl)!;
  const officialSourceUrl = record.officialSourceUrl === undefined
    ? undefined
    : canonicalizeOfficialAcademicUrl(record.officialSourceUrl);
  if (record.officialSourceUrl !== undefined && !officialSourceUrl) return null;
  if (officialSourceUrl && officialDomainForUrl(officialSourceUrl) !== candidateOfficialDomain) return null;

  const title = normalizeDisplayText(record.title)
    .replace(/^\s*(?:\d{1,4}\s*of\s*\d{1,4}|\d{1,3}\s*\/\s*\d{1,4})\s*(?:[-–—:|>»]+\s*)?/iu, "")
    .trim();
  if (!title || isNavigationContentTitle(title) || !hasUsableDisplayTitle(title)) return null;

  const sourceName = normalizeDisplayText(record.sourceName) || "Resmî kaynak";
  const summary = normalizeDisplayText(record.summary);
  const publishedDate = record.publicationKind === "date" ? validDateOnly(record.publishedDate) : undefined;
  const publishedAt = record.publicationKind === "date" ? undefined : validIsoTimestamp(record.publishedAt);
  const publicationKind = publishedDate ? "date" as const : publishedAt ? "timestamp" as const : undefined;
  const sourceUpdatedAt = validIsoTimestamp(record.sourceUpdatedAt);
  const discoveredAt = validIsoTimestamp(record.discoveredAt);
  const fetchedAt = validIsoTimestamp(record.fetchedAt);
  const {
    canonicalUrl: _canonicalUrl,
    canonicalUrlAliases: _canonicalUrlAliases,
    contentFingerprint: _contentFingerprint,
    discoveredAt: _discoveredAt,
    fetchedAt: _fetchedAt,
    officialSourceUrl: _officialSourceUrl,
    publicationKind: _publicationKind,
    publishedDate: _publishedDate,
    publishedAt: _publishedAt,
    sourceRelationships: _sourceRelationships,
    sourceUpdatedAt: _sourceUpdatedAt,
    summary: _summary,
    trustStatus: _trustStatus,
    ...baseRecord
  } = record;
  const contentFingerprint = typeof record.contentFingerprint === "string" && /^[a-f\d]{64}$/u.test(record.contentFingerprint)
    ? record.contentFingerprint
    : undefined;
  const canonicalUrlAliases = normalizeCanonicalAliases(record.canonicalUrlAliases, canonicalUrl, candidateOfficialDomain);
  const sourceRelationships = normalizeSourceRelationships([
    ...(record.sourceRelationships ?? []),
    ...(officialSourceUrl ? [{
      sourceId: record.sourceId,
      sourceName,
      officialSourceUrl,
      scopeType: record.scopeType,
      scopeId: record.scopeId,
      canonicalUrl
    }] : [])
  ]);

  return {
    ...baseRecord,
    sourceName,
    title,
    link: canonicalUrl,
    canonicalUrl,
    canonicalUrlAliases,
    trustStatus: "trusted",
    ...(contentFingerprint ? { contentFingerprint } : {}),
    ...(sourceRelationships.length > 0 ? { sourceRelationships } : {}),
    ...(officialSourceUrl ? { officialSourceUrl } : {}),
    ...(summary ? { summary } : {}),
    ...(publicationKind === "date" && publishedDate ? { publicationKind, publishedDate } : {}),
    ...(publicationKind === "timestamp" && publishedAt ? { publicationKind, publishedAt } : {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    ...(discoveredAt ? { discoveredAt } : {}),
    ...(fetchedAt ? { fetchedAt } : {})
  };
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
    const sourceName = normalizeDisplayText(relationship.sourceName);
    const officialSourceUrl = canonicalizeOfficialAcademicUrl(relationship.officialSourceUrl);
    const canonicalUrl = canonicalizeOfficialAcademicUrl(relationship.canonicalUrl);
    if (
      !relationship.sourceId?.trim()
      || !relationship.scopeId?.trim()
      || !sourceName
      || !officialSourceUrl
      || !canonicalUrl
      || !["university", "faculty", "department"].includes(relationship.scopeType)
      || officialDomainForUrl(officialSourceUrl) !== officialDomainForUrl(canonicalUrl)
    ) return [];
    return [{ ...relationship, sourceName, officialSourceUrl, canonicalUrl }];
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
