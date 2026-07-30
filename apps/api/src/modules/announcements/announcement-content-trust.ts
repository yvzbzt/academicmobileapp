import { createHash } from "node:crypto";
import type { TrustedAcademicContentDto } from "../../../../../packages/shared/src/contracts.js";
import type {
  AnnouncementContentType,
  AnnouncementItem,
  AnnouncementSourceRecord,
  AnnouncementTrustReason
} from "./announcements.types.js";

const namedHtmlEntities: Readonly<Record<string, string>> = {
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
  aacute: "á",
  acirc: "â",
  agrave: "à",
  amp: "&",
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
  uuml: "ü",
  rsaquo: "›",
  lsaquo: "‹"
};

const navigationTitles = new Set([
  "alt bilgi",
  "altbilgi",
  "ana sayfa",
  "anasayfa",
  "bagli kuruluslar",
  "breadcrumb",
  "devamini oku",
  "duyuru arsivi",
  "duyuru",
  "duyurular",
  "etkinlik",
  "etkinlikler",
  "footer",
  "gecmis duyurular",
  "gezinti",
  "geri",
  "home",
  "haber",
  "haberler",
  "ileri",
  "menu",
  "next",
  "onceki",
  "previous",
  "read more",
  "sayfa alti",
  "sayfa sonu",
  "sidebar",
  "site haritasi",
  "sonraki",
  "tum duyurular",
  "tum haberler",
  "ust menu",
  "yan menu"
]);

const titleFallbacks: Record<AnnouncementContentType, string> = {
  announcement: "Resmî duyuru",
  news: "Resmî haber",
  event: "Resmî etkinlik"
};

export interface ContentTrustDecision {
  status: "trusted" | "rejected" | "quarantined";
  reasonCodes: AnnouncementTrustReason[];
  rawTitle: string;
  title?: string;
  canonicalUrl?: string;
  dedupeKey?: string;
}

export function decodeHtmlEntities(input: string): string {
  let output = input;
  for (let pass = 0; pass < 16; pass += 1) {
    const decoded = output
      .replace(/&#x([0-9a-f]+);?/giu, (match, value: string) => decodeCodePoint(match, value, 16))
      .replace(/&#(\d+);?/gu, (match, value: string) => decodeCodePoint(match, value, 10))
      .replace(/&([a-z][a-z\d]+);/giu, (_match, name: string) => namedHtmlEntities[name] ?? namedHtmlEntities[name.toLocaleLowerCase("en-US")] ?? " ");
    if (decoded === output) break;
    output = decoded;
  }
  return output.replace(/&(?:#x[0-9a-f]+|#\d+|[a-z][a-z\d]+);/giu, " ");
}

export function normalizeDisplayText(input: string | undefined, maximumLength = 2_000): string {
  if (!input) return "";
  const decoded = decodeHtmlEntities(input)
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return truncateAtWord(decoded, maximumLength);
}

export function isNavigationOrChromeTitle(input: string | undefined): boolean {
  const normalized = normalizeDisplayText(input, 500);
  if (/^[<>«»‹›←→]+$/u.test(normalized)) return true;
  const folded = foldTurkish(normalized);
  if (!folded) return false;
  if (navigationTitles.has(folded)) return true;
  if (/^\d{1,4}$/u.test(folded)) return true;
  if (/^\d+(?:\s+\d+)+$/u.test(folded)) return true;
  if (/^\d+\s+of\s+\d+$/u.test(folded)) return true;
  if (/^(?:page|sayfa)\s*\d+(?:\s+\d+)?$/u.test(folded)) return true;
  if (/^(?:devamini oku|read more|show more|daha fazla)(?:\s+.*)?$/u.test(folded)) return true;
  if (/^(?:onceki|sonraki|previous|next)(?:\s+(?:sayfa|page))?$/u.test(folded)) return true;
  return false;
}

export function normalizeContentTitle(
  rawTitle: string | undefined,
  contentType: AnnouncementContentType,
  canonicalUrl?: string
): { rawTitle: string; title?: string; rejected: boolean } {
  const raw = rawTitle ?? "";
  const normalized = normalizeDisplayText(raw, 500);
  if (isNavigationOrChromeTitle(normalized)) return { rawTitle: raw, rejected: true };

  const withoutChrome = normalized
    .replace(/^\s*(?:\d{1,4}\s*of\s*\d{1,4}|\d{1,3}\s*\/\s*\d{1,4})\s*(?:[-–—:|>»]+\s*)?/iu, "")
    .replace(/^[\s»›>•·|:;,_-]+/u, "")
    .replace(/\s+(?:devamını oku|devamini oku|read more|detay(?:lar)?ı?)\s*$/iu, "")
    .trim();
  if (hasMeaningfulTitle(withoutChrome)) return { rawTitle: raw, title: truncateAtWord(withoutChrome, 320), rejected: false };

  const derived = canonicalUrl ? deriveTitleFromUrl(canonicalUrl) : undefined;
  return {
    rawTitle: raw,
    title: derived ?? titleFallbacks[contentType],
    rejected: false
  };
}

export function canonicalizeContentUrl(input: string, base?: string): string | null {
  const decoded = decodeHtmlEntities(input).trim();
  if (!decoded || decoded.length > 2_048) return null;
  try {
    const url = base ? new URL(decoded, base) : new URL(decoded);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== "80" && url.port !== "443") return null;
    url.hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/u, "");
    if (isUnsafeHostname(url.hostname)) return null;
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";

    const parameters = [...url.searchParams.entries()]
      .filter(([key]) => !/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/iu.test(key))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey, "en-US") || leftValue.localeCompare(rightValue, "en-US"));
    url.search = "";
    for (const [key, value] of parameters) url.searchParams.append(key, value);
    url.pathname = url.pathname.replace(/\/{2,}/gu, "/");
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
    if (!url.hash.startsWith("#!")) url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function officialDomainForUrl(input: string): string | null {
  const canonicalUrl = canonicalizeContentUrl(input);
  if (!canonicalUrl) return null;
  const labels = new URL(canonicalUrl).hostname.replace(/^www\./u, "").split(".").filter(Boolean);
  if (labels.length < 3) return null;
  const suffix = labels.slice(-2).join(".");
  if (suffix !== "edu.tr" && suffix !== "gov.tr") return null;
  return labels.slice(-3).join(".");
}

export function isOfficialContentUrl(candidate: string, officialSourceUrl: string): boolean {
  const candidateDomain = officialDomainForUrl(candidate);
  const sourceDomain = officialDomainForUrl(officialSourceUrl);
  return Boolean(candidateDomain && sourceDomain && candidateDomain === sourceDomain);
}

export function canonicalContentKey(input: string): string | null {
  const canonicalUrl = canonicalizeContentUrl(input);
  if (!canonicalUrl) return null;
  const url = new URL(canonicalUrl);
  const hostname = url.hostname.replace(/^www\./u, "");
  return `${hostname.toLocaleLowerCase("en-US")}${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}${url.hash}`;
}

export function compareAcademicContentDuplicateRecency(
  candidate: Pick<AnnouncementItem, "publishedAt" | "sourceUpdatedAt" | "discoveredAt" | "fetchedAt"> & Partial<Pick<AnnouncementItem, "id">>,
  current: Pick<AnnouncementItem, "publishedAt" | "sourceUpdatedAt" | "discoveredAt" | "fetchedAt"> & Partial<Pick<AnnouncementItem, "id">>
): number {
  const candidateSourceTime = sourceAuthorityTimestamp(candidate);
  const currentSourceTime = sourceAuthorityTimestamp(current);
  if (Boolean(candidateSourceTime) !== Boolean(currentSourceTime)) return candidateSourceTime ? 1 : -1;
  if (candidateSourceTime !== currentSourceTime) return candidateSourceTime - currentSourceTime;
  const operationalDifference = operationalContentTimestamp(candidate) - operationalContentTimestamp(current);
  if (operationalDifference !== 0) return operationalDifference;
  return candidate.id && current.id ? current.id.localeCompare(candidate.id, "en-US") : 0;
}

export function createContentDedupeKey(input: string): string | null {
  const key = canonicalContentKey(input);
  return key ? createHash("sha256").update(key).digest("hex").slice(0, 32) : null;
}

export function evaluateContentTrust(input: {
  rawTitle?: string;
  url: string;
  officialSourceUrl: string;
  contentType?: AnnouncementContentType;
}): ContentTrustDecision {
  const contentType = input.contentType ?? "announcement";
  const canonicalUrl = canonicalizeContentUrl(input.url, input.officialSourceUrl);
  const titleDecision = normalizeContentTitle(input.rawTitle, contentType, canonicalUrl ?? undefined);
  if (titleDecision.rejected) {
    return { status: "rejected", reasonCodes: ["navigation_or_chrome"], rawTitle: titleDecision.rawTitle };
  }
  if (!canonicalUrl) {
    return { status: "rejected", reasonCodes: ["unsafe_url"], rawTitle: titleDecision.rawTitle, ...(titleDecision.title ? { title: titleDecision.title } : {}) };
  }
  if (!isOfficialContentUrl(canonicalUrl, input.officialSourceUrl)) {
    return {
      status: "rejected",
      reasonCodes: ["unofficial_source"],
      rawTitle: titleDecision.rawTitle,
      ...(titleDecision.title ? { title: titleDecision.title } : {}),
      canonicalUrl
    };
  }
  const dedupeKey = createContentDedupeKey(canonicalUrl);
  if (!titleDecision.title || !dedupeKey) {
    return { status: "quarantined", reasonCodes: ["missing_source"], rawTitle: titleDecision.rawTitle, canonicalUrl };
  }
  return {
    status: "trusted",
    reasonCodes: [],
    rawTitle: titleDecision.rawTitle,
    title: titleDecision.title,
    canonicalUrl,
    dedupeKey
  };
}

export function toTrustedAcademicContentDto(
  item: AnnouncementItem,
  source?: Pick<AnnouncementSourceRecord, "id" | "sourceUrl" | "canonicalUrl" | "sourceName" | "contentType" | "scopeType" | "scopeId" | "status" | "trustStatus">
): TrustedAcademicContentDto | null {
  if (item.trustStatus !== "trusted") return null;
  if (!source || source.id !== item.sourceId || source.status !== "active" || source.trustStatus !== "trusted") return null;
  const authoritativeSourceUrl = source.canonicalUrl ?? source.sourceUrl;
  if (item.officialSourceUrl && !isOfficialContentUrl(item.officialSourceUrl, authoritativeSourceUrl)) return null;
  const officialSourceUrl = authoritativeSourceUrl;
  const decision = evaluateContentTrust({
    rawTitle: item.rawTitle ?? item.title,
    url: item.canonicalUrl ?? item.link,
    officialSourceUrl,
    contentType: source.contentType ?? item.contentType ?? "announcement"
  });
  if (decision.status !== "trusted" || !decision.title || !decision.canonicalUrl) return null;

  const fetchedAt = toIsoString(item.fetchedAt);
  const discoveredAt = toIsoString(item.discoveredAt);
  const sourceUpdatedAt = item.sourceUpdateTimeSource === "source" ? toIsoString(item.sourceUpdatedAt) : undefined;
  const parsedPublishedAt = toIsoString(item.publishedAt);
  const publishedAt = item.publicationTimeSource === "source" ? parsedPublishedAt : undefined;
  const summary = normalizeDisplayText(item.summary, 1_200);
  const contentType = source.contentType ?? item.contentType ?? "announcement";

  return {
    id: item.id,
    sourceId: item.sourceId,
    sourceName: normalizeDisplayText(source.sourceName, 160) || "Resmî akademik kaynak",
    officialSourceUrl: canonicalizeContentUrl(officialSourceUrl)!,
    contentType,
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    title: decision.title,
    ...(summary ? { summary } : {}),
    link: decision.canonicalUrl,
    canonicalUrl: decision.canonicalUrl,
    ...(publishedAt ? { publishedAt } : {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    ...(discoveredAt ? { discoveredAt } : {}),
    ...(fetchedAt ? { fetchedAt } : {}),
    freshness: item.freshness === "stale" ? "stale" : "fresh"
  };
}

export function normalizeTrustedItemsForSource(source: AnnouncementSourceRecord, items: readonly AnnouncementItem[]): AnnouncementItem[] {
  if (source.status !== "active" || source.trustStatus !== "trusted") return [];
  const officialSourceUrl = canonicalizeContentUrl(source.canonicalUrl ?? source.sourceUrl);
  if (!officialSourceUrl || !officialDomainForUrl(officialSourceUrl)) return [];
  const unique = new Map<string, AnnouncementItem>();

  for (const item of items) {
    if (item.trustStatus === "rejected" || item.trustStatus === "quarantined") continue;
    const contentType = source.contentType ?? item.contentType ?? "announcement";
    const decision = evaluateContentTrust({
      rawTitle: item.rawTitle ?? item.title,
      url: item.canonicalUrl ?? item.link,
      officialSourceUrl,
      contentType
    });
    if (decision.status !== "trusted" || !decision.title || !decision.canonicalUrl || !decision.dedupeKey) continue;
    const publishedAt = item.publicationTimeSource === "source" ? toIsoString(item.publishedAt) : undefined;
    const sourceUpdatedAt = item.sourceUpdateTimeSource === "source" ? toIsoString(item.sourceUpdatedAt) : undefined;
    const discoveredAt = toIsoString(item.discoveredAt);
    const fetchedAt = toIsoString(item.fetchedAt);
    const summary = normalizeDisplayText(item.summary, 1_200);
    const normalized: AnnouncementItem = {
      id: item.id,
      sourceId: source.id,
      sourceName: normalizeDisplayText(source.sourceName, 160) || "Resmî akademik kaynak",
      contentType,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      title: decision.title,
      rawTitle: decision.rawTitle,
      link: decision.canonicalUrl,
      canonicalUrl: decision.canonicalUrl,
      officialSourceUrl,
      ...(publishedAt ? { publishedAt, publicationTimeSource: "source" as const } : {}),
      ...(sourceUpdatedAt ? { sourceUpdatedAt, sourceUpdateTimeSource: "source" as const } : {}),
      ...(discoveredAt ? { discoveredAt } : {}),
      ...(summary ? { summary } : {}),
      ...(fetchedAt ? { fetchedAt } : {}),
      freshness: item.freshness === "stale" ? "stale" : "fresh",
      trustStatus: "trusted",
      trustReasonCodes: [],
      dedupeKey: decision.dedupeKey
    };
    const existing = unique.get(decision.dedupeKey);
    if (!existing || compareAcademicContentDuplicateRecency(normalized, existing) > 0) unique.set(decision.dedupeKey, normalized);
  }
  return [...unique.values()];
}

export function toIsoString(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && !isStrictIsoDate(value)) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function isStrictIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2})))?$/u);
  if (!match) return false;
  const [, yearValue, monthValue, dayValue, hourValue = "0", minuteValue = "0", secondValue = "0", , offsetHourValue = "0", offsetMinuteValue = "0"] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = Number(secondValue);
  const offsetHour = Number(offsetHourValue);
  const offsetMinute = Number(offsetMinuteValue);
  return month >= 1
    && month <= 12
    && day >= 1
    && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 14
    && offsetMinute <= 59
    && (offsetHour !== 14 || offsetMinute === 0);
}

function decodeCodePoint(original: string, value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix);
  if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return " ";
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return original;
  }
}

function sourceAuthorityTimestamp(item: Pick<AnnouncementItem, "publishedAt" | "sourceUpdatedAt">): number {
  return Math.max(...[item.publishedAt, item.sourceUpdatedAt]
    .map((value) => value ? Date.parse(value) : 0)
    .filter(Number.isFinite), 0);
}

function operationalContentTimestamp(item: Pick<AnnouncementItem, "discoveredAt" | "fetchedAt">): number {
  return Math.max(...[item.discoveredAt, item.fetchedAt]
    .map((value) => value ? Date.parse(value) : 0)
    .filter(Number.isFinite), 0);
}

function foldTurkish(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/gu, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function hasMeaningfulTitle(value: string): boolean {
  return value.length >= 3 && /[\p{L}\p{N}].*[\p{L}\p{N}]/u.test(value);
}

function deriveTitleFromUrl(input: string): string | undefined {
  try {
    const url = new URL(input);
    const segments = url.pathname.split("/").filter(Boolean).reverse();
    for (const segment of segments) {
      const decoded = normalizeDisplayText(decodeURIComponent(segment).replace(/[-_]+/gu, " "), 160)
        .replace(/\.(?:html?|php|aspx?|pdf)$/iu, "")
        .trim();
      if (!hasMeaningfulTitle(decoded) || isNavigationOrChromeTitle(decoded) || /^(?:duyuru|duyurular|haber|haberler|etkinlik|etkinlikler|detail|detay|\d+)$/iu.test(decoded)) continue;
      return decoded.replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase("tr-TR"));
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function truncateAtWord(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value;
  const candidate = value.slice(0, maximumLength + 1);
  const boundary = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, boundary >= Math.floor(maximumLength * 0.6) ? boundary : maximumLength).trimEnd()}…`;
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLocaleLowerCase("en-US");
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local") || normalized.endsWith(".internal") || normalized.endsWith(".lan")) return true;
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("::ffff:") || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  const ipv4 = mappedIpv4 ?? (/^\d+\.\d+\.\d+\.\d+$/u.test(normalized) ? normalized : undefined);
  if (!ipv4) return false;
  const octets = ipv4.split(".").map(Number);
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
