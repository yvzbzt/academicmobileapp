import { createHash } from "node:crypto";
import type {
  AcademicContentBodyBlockDto,
  AcademicContentKeyDateDto,
  TrustedAcademicContentDto
} from "../../../../../packages/shared/src/contracts.js";
import {
  STUDENT_RELEVANCE_CLASSIFICATION_VERSION,
  classifyStudentRelevance,
  type StudentRelevanceMetadata
} from "../../domain/student-relevance-classifier.js";
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
  "iletisim",
  "haber",
  "haberler",
  "ileri",
  "menu",
  "news",
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

const richBodyMarker = "\uE000ACADEMIC_BODY\uE001";
const turkishMonthNumbers: Readonly<Record<string, number>> = {
  ocak: 1,
  subat: 2,
  mart: 3,
  nisan: 4,
  mayis: 5,
  haziran: 6,
  temmuz: 7,
  agustos: 8,
  eylul: 9,
  ekim: 10,
  kasim: 11,
  aralik: 12
};

/** Converts source-owned HTML/text into a small, plain-text presentation AST. */
export function sanitizeAcademicContentBody(input: string | undefined): AcademicContentBodyBlockDto[] {
  if (!input?.trim()) return [];
  const prepared = input.slice(0, 60_000)
    .replace(/<!--([\s\S]*?)-->/gu, " ")
    .replace(/<(?:script|style|template|noscript|svg|math|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/(?:script|style|template|noscript|svg|math|iframe|object|embed|form)\s*>/giu, " ")
    .replace(/<h[1-6]\b[^>]*>/giu, `\n${richBodyMarker}heading:`)
    .replace(/<li\b[^>]*>/giu, `\n${richBodyMarker}bullet:`)
    .replace(/<(?:p|div|section|article|blockquote|tr)\b[^>]*>/giu, `\n${richBodyMarker}paragraph:`)
    .replace(/<br\s*\/?\s*>/giu, `\n${richBodyMarker}paragraph:`)
    .replace(/<\/(?:h[1-6]|li|p|div|section|article|blockquote|tr)\s*>/giu, "\n")
    .replace(/\r\n?/gu, "\n");
  const blocks: AcademicContentBodyBlockDto[] = [];
  let totalLength = 0;
  for (const rawLine of prepared.split(/\n+/u)) {
    const marker = rawLine.startsWith(richBodyMarker)
      ? /^(?:\uE000ACADEMIC_BODY\uE001)(heading|paragraph|bullet):/u.exec(rawLine)
      : null;
    const type = marker?.[1] === "heading" || marker?.[1] === "bullet"
      ? marker[1]
      : "paragraph";
    const text = normalizeDisplayText(marker ? rawLine.slice(marker[0].length) : rawLine, 800);
    if (!text) continue;
    if (totalLength + text.length > 12_000 || blocks.length >= 48) break;
    const previous = blocks.at(-1);
    if (previous?.type === type && previous.text === text) continue;
    blocks.push({ type, text });
    totalLength += text.length;
  }
  return blocks;
}

/** Revalidates stored structured body data before serialization. */
export function normalizeAcademicContentBodyBlocks(input: unknown): AcademicContentBodyBlockDto[] {
  if (!Array.isArray(input)) return [];
  const blocks: AcademicContentBodyBlockDto[] = [];
  let totalLength = 0;
  for (const candidate of input.slice(0, 48)) {
    if (!candidate || typeof candidate !== "object") continue;
    const value = candidate as Record<string, unknown>;
    if (value.type !== "heading" && value.type !== "paragraph" && value.type !== "bullet") continue;
    const text = normalizeDisplayText(typeof value.text === "string" ? value.text : undefined, 800);
    if (!text || totalLength + text.length > 12_000) continue;
    blocks.push({ type: value.type, text });
    totalLength += text.length;
  }
  return blocks;
}

/** Extracts only explicit source-declared date or date-range statements. */
export function extractAcademicContentKeyDates(
  body: readonly AcademicContentBodyBlockDto[]
): AcademicContentKeyDateDto[] {
  const dates: AcademicContentKeyDateDto[] = [];
  let headingHint = "";
  for (const block of body) {
    if (block.type === "heading") headingHint = normalizeDisplayText(block.text, 160);
    const parsed = parseExplicitKeyDate(block.text, headingHint);
    if (!parsed) continue;
    const key = `${parsed.label}\u0000${parsed.startDate}\u0000${parsed.endDate ?? ""}`;
    if (dates.some((date) => `${date.label}\u0000${date.startDate}\u0000${date.endDate ?? ""}` === key)) continue;
    dates.push(parsed);
    if (dates.length >= 16) break;
  }
  return dates;
}

/** Revalidates stored key dates and rejects impossible or inverted ranges. */
export function normalizeAcademicContentKeyDates(input: unknown): AcademicContentKeyDateDto[] {
  if (!Array.isArray(input)) return [];
  const dates: AcademicContentKeyDateDto[] = [];
  for (const candidate of input.slice(0, 16)) {
    if (!candidate || typeof candidate !== "object") continue;
    const value = candidate as Record<string, unknown>;
    const label = normalizeDisplayText(typeof value.label === "string" ? value.label : undefined, 160);
    const startDate = validDateOnly(typeof value.startDate === "string" ? value.startDate : "");
    const endDate = validDateOnly(typeof value.endDate === "string" ? value.endDate : "");
    if (!label || !startDate || (endDate && endDate < startDate)) continue;
    dates.push({ label, startDate, ...(endDate && endDate !== startDate ? { endDate } : {}) });
  }
  return dates;
}

function parseExplicitKeyDate(text: string, headingHint: string): AcademicContentKeyDateDto | null {
  const normalized = normalizeDisplayText(text, 800);
  const patterns: Array<{ expression: RegExp; parse: (match: RegExpExecArray) => { startDate: string; endDate?: string } | null }> = [
    {
      expression: /(\d{4}-\d{2}-\d{2})(?:\s*(?:-|–|—|ile)\s*(\d{4}-\d{2}-\d{2}))?/iu,
      parse: (match) => dateRange(match[1], match[2])
    },
    {
      expression: /(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s*(?:-|–|—|ile)\s*(\d{1,2})[./](\d{1,2})[./](\d{4}))?/iu,
      parse: (match) => dateRange(
        isoCalendarDate(Number(match[3]), Number(match[2]), Number(match[1])),
        match[4] ? isoCalendarDate(Number(match[6]), Number(match[5]), Number(match[4])) : undefined
      )
    },
    {
      expression: /(\d{1,2})\s+([\p{L}]+)\s*(?:-|–|—|ile)\s*(\d{1,2})\s+([\p{L}]+)\s+(\d{4})/iu,
      parse: (match) => dateRange(
        turkishCalendarDate(match[1], match[2], match[5]),
        turkishCalendarDate(match[3], match[4], match[5])
      )
    },
    {
      expression: /(\d{1,2})\s*(?:-|–|—|ile)\s*(\d{1,2})\s+([\p{L}]+)\s+(\d{4})/iu,
      parse: (match) => dateRange(
        turkishCalendarDate(match[1], match[3], match[4]),
        turkishCalendarDate(match[2], match[3], match[4])
      )
    },
    {
      expression: /(\d{1,2})\s+([\p{L}]+)\s+(\d{4})/iu,
      parse: (match) => dateRange(turkishCalendarDate(match[1], match[2], match[3]))
    }
  ];
  for (const { expression, parse } of patterns) {
    const match = expression.exec(normalized);
    if (!match) continue;
    const range = parse(match);
    if (!range) continue;
    const inlineLabel = normalizeDisplayText(normalized.slice(0, match.index).replace(/^[•*\-–—\s]+|[\s:;,.\-–—]+$/gu, ""), 160);
    const label = inlineLabel || headingHint;
    if (!label || (label.match(/[\p{L}]/gu)?.length ?? 0) < 2) return null;
    return { label, ...range };
  }
  return null;
}

function turkishCalendarDate(dayValue: string | undefined, monthValue: string | undefined, yearValue: string | undefined): string | undefined {
  const month = monthValue ? turkishMonthNumbers[foldTurkish(monthValue)] : undefined;
  return month ? isoCalendarDate(Number(yearValue), month, Number(dayValue)) : undefined;
}

function isoCalendarDate(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validDateOnly(value);
}

function validDateOnly(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? value
    : undefined;
}

function dateRange(startDate: string | undefined, endDate?: string): { startDate: string; endDate?: string } | null {
  if (!startDate || (endDate && endDate < startDate)) return null;
  return { startDate, ...(endDate && endDate !== startDate ? { endDate } : {}) };
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
  if (/^[\p{L}\p{N}]{2,12}\s+news$/u.test(folded)) return true;
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

/**
 * Explicit, independently validated source URL upgrades. These aliases are
 * intentionally narrower than general URL canonicalization: changing a host
 * or a path is not safe unless the registry review proved both endpoints are
 * the same official source.
 */
const approvedAnnouncementSourceUrlUpgrades = [
  [
    "https://www.gtu.edu.tr/tr/icerik/9/30904/display.aspx",
    "https://www.gtu.edu.tr/icerik/9/30904/display.aspx"
  ],
  [
    "http://bilnews.bilkent.edu.tr/",
    "https://bilkentnews.bilkent.edu.tr/"
  ],
  [
    "https://www.ksu.edu.tr/default.aspx?DId=103100",
    "https://www.ksu.edu.tr/default?DId=103100"
  ]
] as const;

const approvedAnnouncementSourceIdentityAliases = new Map<string, string>();
for (const [legacyUrl, approvedUrl] of approvedAnnouncementSourceUrlUpgrades) {
  const legacyKey = canonicalContentKey(legacyUrl);
  const approvedKey = canonicalContentKey(approvedUrl);
  if (!legacyKey || !approvedKey) continue;
  approvedAnnouncementSourceIdentityAliases.set(legacyKey, approvedKey);
  approvedAnnouncementSourceIdentityAliases.set(approvedKey, approvedKey);
}

export function canonicalAnnouncementSourceIdentityKey(input: string): string | null {
  const contentKey = canonicalContentKey(input);
  return contentKey ? approvedAnnouncementSourceIdentityAliases.get(contentKey) ?? contentKey : null;
}

/**
 * Stable ObjectId-shaped fence for an unreviewed source candidate. The hash is
 * scoped so the same official URL may intentionally belong to different units.
 * Mongo's built-in unique `_id` index makes scheme/www aliases converge without
 * requiring a production index migration over legacy source rows.
 */
export function createAnnouncementSourceCandidateId(input: {
  scopeType: AnnouncementSourceRecord["scopeType"];
  scopeId: string;
  sourceUrl: string;
}): string | null {
  const contentKey = canonicalAnnouncementSourceIdentityKey(input.sourceUrl);
  if (!contentKey) return null;
  return createHash("sha256")
    .update(`${input.scopeType}\u0000${input.scopeId}\u0000${contentKey}`)
    .digest("hex")
    .slice(0, 24);
}

export function compareAcademicContentDuplicateRecency(
  candidate: Pick<AnnouncementItem, "publishedAt" | "publishedDate" | "sourceUpdatedAt" | "discoveredAt" | "fetchedAt"> & Partial<Pick<AnnouncementItem, "id">>,
  current: Pick<AnnouncementItem, "publishedAt" | "publishedDate" | "sourceUpdatedAt" | "discoveredAt" | "fetchedAt"> & Partial<Pick<AnnouncementItem, "id">>
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

export function createNormalizedContentFingerprint(input: {
  title: string;
  summary?: string;
  contentType?: AnnouncementContentType;
  publicationKind?: "date" | "timestamp";
  publishedDate?: string;
  publishedAt?: string;
}): string {
  const publication = input.publicationKind === "date"
    ? `date:${toDateOnlyString(input.publishedDate) ?? "invalid"}`
    : input.publicationKind === "timestamp" || input.publishedAt
      ? `timestamp:${toIsoString(input.publishedAt) ?? "invalid"}`
      : "none";
  const normalized = [
    foldTurkish(normalizeDisplayText(input.title, 500)),
    foldTurkish(normalizeDisplayText(input.summary, 1_200)),
    input.contentType ?? "announcement",
    publication
  ].join("\u0000");
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Presentation identity is deliberately separate from the stored document ID.
 * A source-issued fingerprint identifies equivalent content only inside the
 * same source and academic scope. Legacy or malformed fingerprints fall back
 * to that same source/scope plus the canonical official location.
 *
 * JSON tuple encoding keeps field boundaries collision-safe even when one
 * identifier contains text that resembles another tuple segment.
 */
export function academicContentLogicalIdentityKey(input: {
  sourceId: string;
  scopeType: AnnouncementItem["scopeType"];
  scopeId: string;
  contentFingerprint?: string;
  canonicalUrl?: string;
  link?: string;
}): string | null {
  const sourceId = normalizeIdentitySegment(input.sourceId);
  const scopeId = normalizeIdentitySegment(input.scopeId);
  if (!sourceId || !scopeId || !["university", "faculty", "department"].includes(input.scopeType)) return null;

  const fingerprint = typeof input.contentFingerprint === "string" && /^[a-f\d]{64}$/u.test(input.contentFingerprint)
    ? input.contentFingerprint
    : null;
  if (fingerprint) {
    return JSON.stringify(["academic-content-v1", "fingerprint", sourceId, input.scopeType, scopeId, fingerprint]);
  }

  const contentUrl = input.canonicalUrl ?? input.link;
  const canonicalKey = typeof contentUrl === "string" ? canonicalContentKey(contentUrl) : null;
  return canonicalKey
    ? JSON.stringify(["academic-content-v1", "canonical", sourceId, input.scopeType, scopeId, canonicalKey])
    : null;
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
  const publication = normalizeSourcePublication(item);
  const summary = normalizeDisplayText(item.summary, 1_200);
  const body = normalizeAcademicContentBodyBlocks(item.body);
  const keyDates = normalizeAcademicContentKeyDates(
    item.keyDates?.length ? item.keyDates : extractAcademicContentKeyDates(body)
  );
  const contentType = source.contentType ?? item.contentType ?? "announcement";
  const contentFingerprint = createNormalizedContentFingerprint({
    title: decision.title,
    ...(summary ? { summary } : {}),
    contentType,
    ...publication
  });
  const canonicalUrlAliases = normalizeCanonicalUrlAliases(
    [decision.canonicalUrl, ...(item.canonicalUrlAliases ?? [])],
    officialSourceUrl
  );
  const sourceName = normalizeDisplayText(source.sourceName, 160) || "Resmî akademik kaynak";
  const normalizedOfficialSourceUrl = canonicalizeContentUrl(officialSourceUrl)!;
  const studentMetadata = normalizedStudentMetadata(item, {
    title: decision.title,
    ...(summary ? { summary } : {}),
    body,
    keyDates
  });

  return {
    id: item.id,
    sourceId: item.sourceId,
    sourceName,
    officialSourceUrl: normalizedOfficialSourceUrl,
    contentType,
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    title: decision.title,
    ...(summary ? { summary } : {}),
    ...(body.length ? { body } : {}),
    ...(keyDates.length ? { keyDates } : {}),
    link: decision.canonicalUrl,
    canonicalUrl: decision.canonicalUrl,
    canonicalUrlAliases,
    contentFingerprint,
    sourceRelationships: [{
      sourceId: item.sourceId,
      sourceName,
      officialSourceUrl: normalizedOfficialSourceUrl,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      canonicalUrl: decision.canonicalUrl
    }],
    ...publication,
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    ...(discoveredAt ? { discoveredAt } : {}),
    ...(fetchedAt ? { fetchedAt } : {}),
    ...studentMetadata,
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
    const publication = normalizeSourcePublication(item);
    const sourceUpdatedAt = item.sourceUpdateTimeSource === "source" ? toIsoString(item.sourceUpdatedAt) : undefined;
    const discoveredAt = toIsoString(item.discoveredAt);
    const fetchedAt = toIsoString(item.fetchedAt);
    const summary = normalizeDisplayText(item.summary, 1_200);
    const body = normalizeAcademicContentBodyBlocks(item.body);
    const keyDates = normalizeAcademicContentKeyDates(
      item.keyDates?.length ? item.keyDates : extractAcademicContentKeyDates(body)
    );
    const contentFingerprint = createNormalizedContentFingerprint({
      title: decision.title,
      ...(summary ? { summary } : {}),
      contentType,
      ...publication
    });
    const canonicalUrlAliases = normalizeCanonicalUrlAliases(
      [decision.canonicalUrl, ...(item.canonicalUrlAliases ?? [])],
      officialSourceUrl
    );
    const studentMetadata = normalizedStudentMetadata(item, {
      title: decision.title,
      ...(summary ? { summary } : {}),
      body,
      keyDates
    });
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
      canonicalUrlAliases,
      officialSourceUrl,
      contentFingerprint,
      ...(Object.keys(publication).length > 0 ? { ...publication, publicationTimeSource: "source" as const } : {}),
      ...(sourceUpdatedAt ? { sourceUpdatedAt, sourceUpdateTimeSource: "source" as const } : {}),
      ...(discoveredAt ? { discoveredAt } : {}),
      ...(summary ? { summary } : {}),
      ...(body.length ? { body } : {}),
      ...(keyDates.length ? { keyDates } : {}),
      ...(fetchedAt ? { fetchedAt } : {}),
      freshness: item.freshness === "stale" ? "stale" : "fresh",
      trustStatus: "trusted",
      trustReasonCodes: [],
      dedupeKey: decision.dedupeKey,
      ...studentMetadata
    };
    const logicalKey = academicContentLogicalIdentityKey(normalized);
    if (!logicalKey) continue;
    const existing = unique.get(logicalKey);
    if (!existing) {
      unique.set(logicalKey, normalized);
      continue;
    }
    const preferred = compareAcademicContentDuplicateRecency(normalized, existing) > 0 ? normalized : existing;
    unique.set(logicalKey, {
      ...preferred,
      canonicalUrlAliases: normalizeCanonicalUrlAliases(
        [...(existing.canonicalUrlAliases ?? []), ...(normalized.canonicalUrlAliases ?? [])],
        officialSourceUrl
      )
    });
  }
  return [...unique.values()];
}

function normalizedStudentMetadata(
  item: AnnouncementItem,
  content: {
    title: string;
    summary?: string;
    body: readonly AcademicContentBodyBlockDto[];
    keyDates: readonly AcademicContentKeyDateDto[];
  }
): StudentRelevanceMetadata | Record<string, never> {
  if (item.classificationVersion !== STUDENT_RELEVANCE_CLASSIFICATION_VERSION) return {};
  return classifyStudentRelevance({
    title: content.title,
    ...(content.summary ? { summary: content.summary } : {}),
    ...(content.body.length ? { body: content.body.map((block) => block.text).join("\n") } : {}),
    ...(content.keyDates.length ? {
      keyDates: content.keyDates.map((keyDate) => ({
        label: keyDate.label,
        value: keyDate.endDate ?? keyDate.startDate
      }))
    } : {})
  });
}

export function toIsoString(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && !isStrictIsoDate(value)) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function toDateOnlyString(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || !isStrictIsoDate(value)) return undefined;
  return value;
}

function normalizeSourcePublication(item: Pick<AnnouncementItem, "publicationKind" | "publicationTimeSource" | "publishedDate" | "publishedAt">):
  | { publicationKind: "date"; publishedDate: string }
  | { publicationKind: "timestamp"; publishedAt: string }
  | Record<string, never> {
  if (item.publicationTimeSource !== "source") return {};
  if (item.publicationKind === "date" || (!item.publicationKind && toDateOnlyString(item.publishedAt))) {
    const publishedDate = toDateOnlyString(item.publishedDate ?? item.publishedAt);
    return publishedDate ? { publicationKind: "date", publishedDate } : {};
  }
  const publishedAt = toIsoString(item.publishedAt);
  return publishedAt ? { publicationKind: "timestamp", publishedAt } : {};
}

function normalizeCanonicalUrlAliases(values: readonly string[], officialSourceUrl: string): string[] {
  return [...new Set(values.flatMap((value) => {
    const canonicalUrl = canonicalizeContentUrl(value);
    return canonicalUrl && isOfficialContentUrl(canonicalUrl, officialSourceUrl) ? [canonicalUrl] : [];
  }))].sort((left, right) => left.localeCompare(right, "en-US"));
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

function sourceAuthorityTimestamp(item: Pick<AnnouncementItem, "publishedAt" | "publishedDate" | "sourceUpdatedAt">): number {
  return Math.max(...[item.publishedAt, item.sourceUpdatedAt, dateOnlySortInstant(item.publishedDate)]
    .map((value) => value ? Date.parse(value) : 0)
    .filter(Number.isFinite), 0);
}

function dateOnlySortInstant(value: string | undefined): string | undefined {
  return toDateOnlyString(value) ? `${value}T12:00:00+03:00` : undefined;
}

function operationalContentTimestamp(item: Pick<AnnouncementItem, "discoveredAt" | "fetchedAt">): number {
  return Math.max(...[item.discoveredAt, item.fetchedAt]
    .map((value) => value ? Date.parse(value) : 0)
    .filter(Number.isFinite), 0);
}

function normalizeIdentitySegment(value: string): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized && !/[\u0000-\u001F\u007F]/u.test(normalized) ? normalized : null;
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
