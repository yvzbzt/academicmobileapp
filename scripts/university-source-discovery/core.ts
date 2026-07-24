import { createHash } from "node:crypto";

export const DISCOVERY_SCHEMA_VERSION = 2;

const PROJECT_HOMEPAGE_OVERRIDES: Record<string, string> = {
  "izmir-kavram-meslek-yuksekokulu": "https://www.kavram.edu.tr/"
};

export const EXCLUDED_UNIVERSITIES = [
  {
    universityId: "agri-ibrahim-cecen-universitesi",
    universityName: "AĞRI İBRAHİM ÇEÇEN ÜNİVERSİTESİ",
    domains: ["agri.edu.tr"],
    reason: "manually_handled_input"
  },
  {
    universityId: "aksaray-universitesi",
    universityName: "AKSARAY ÜNİVERSİTESİ",
    domains: ["aksaray.edu.tr"],
    reason: "manually_handled_input"
  },
  {
    universityId: "afyonkarahisar-saglik-bilimleri-universitesi",
    universityName: "AFYONKARAHİSAR SAĞLIK BİLİMLERİ ÜNİVERSİTESİ",
    domains: ["afsu.edu.tr"],
    reason: "manually_handled_input"
  },
  {
    universityId: "alanya-alaaddin-keykubat-universitesi-antalya",
    universityName: "ALANYA ALAADDİN KEYKUBAT ÜNİVERSİTESİ (ANTALYA)",
    domains: ["alanya.edu.tr"],
    reason: "manually_handled_input"
  },
  {
    universityId: "alanya-universitesi-antalya",
    universityName: "ALANYA ÜNİVERSİTESİ (ANTALYA)",
    domains: ["alanyauniversity.edu.tr"],
    reason: "manually_handled_input"
  },
  {
    universityId: "batman-universitesi",
    universityName: "BATMAN ÜNİVERSİTESİ",
    domains: ["batman.edu.tr"],
    reason: "manually_handled_input"
  },
  {
    universityId: "akdeniz-universitesi-antalya",
    universityName: "AKDENİZ ÜNİVERSİTESİ (ANTALYA)",
    domains: ["akdeniz.edu.tr"],
    reason: "explicit_additional_exclusion"
  }
] as const;

export type SourceType =
  | "homepage"
  | "academic_unit_page"
  | "announcement"
  | "news"
  | "event"
  | "academic_calendar"
  | "course_schedule"
  | "exam_schedule";

export type TerminalStatus =
  | "VERIFIED_COMPLETE"
  | "NOT_FOUND_VERIFIED"
  | "BLOCKED_FINAL"
  | "NEEDS_REVIEW";

export interface CanonicalUniversityRecord {
  universityId: string;
  universityName: string;
  city?: string;
  announcementUrl?: string | null;
  newsUrl?: string | null;
  eventUrl?: string | null;
  calendarUrl?: string | null;
  summerSchoolUrl?: string | null;
}

export interface UniversityTreeRecord {
  name?: string;
  homepageUrl?: string;
  finalHomepageUrl?: string;
  hostname?: string;
}

export interface TargetUniversity {
  universityId: string;
  universityName: string;
  normalizedName: string;
  aliases: string[];
  city?: string;
  officialHomepageUrl: string;
  officialDomains: string[];
  homepageResolution: "faculty_tree" | "existing_verified_source" | "project_domain_registry";
}

export interface TargetManifest {
  schemaVersion: number;
  generatedAt: string;
  sourceUniversityCount: number;
  expectedTargetCount: number;
  targetCount: number;
  exclusionCount: number;
  targets: TargetUniversity[];
  exclusions: Array<{
    universityId: string;
    universityName: string;
    domains: string[];
    reason: string;
  }>;
  normalizationAudit: Array<{
    universityId: string;
    canonicalName: string;
    normalizedName: string;
    matchedTreeName?: string;
    homepageResolution: TargetUniversity["homepageResolution"];
  }>;
}

export interface HtmlSemanticInput {
  sourceType: SourceType;
  requestedUrl: string;
  finalUrl: string;
  title: string;
  heading: string;
  text: string;
  itemCount?: number;
  scopeName?: string;
}

export interface SemanticResult {
  semanticMatch: boolean;
  soft404: boolean;
  reasons: string[];
}

export interface DocumentValidationInput {
  sourceType: SourceType;
  url: string;
  contentType: string;
  body: Uint8Array;
  extractedText?: string;
  scopeName?: string;
}

export interface VerifiedOutputShape {
  sourceUrl?: unknown;
  finalUrl?: unknown;
  browserOpened?: unknown;
  semanticMatch?: unknown;
  soft404?: unknown;
  officialDomain?: unknown;
  verifiedAt?: unknown;
  sha256?: unknown;
  evidencePath?: unknown;
  status?: unknown;
}

export function buildTargetManifest(
  sourceRecords: CanonicalUniversityRecord[],
  treeRecords: UniversityTreeRecord[],
  now = new Date()
): TargetManifest {
  if (sourceRecords.length !== 205) {
    throw new Error(`Expected 205 canonical universities, received ${sourceRecords.length}.`);
  }

  const excludedIds = new Set<string>(EXCLUDED_UNIVERSITIES.map((record) => record.universityId));
  const treeByName = new Map<string, UniversityTreeRecord>();
  for (const treeRecord of treeRecords) {
    if (!treeRecord.name) continue;
    const key = normalizeUniversityName(treeRecord.name);
    if (!treeByName.has(key)) treeByName.set(key, treeRecord);
  }

  const targets: TargetUniversity[] = [];
  const normalizationAudit: TargetManifest["normalizationAudit"] = [];

  for (const record of sourceRecords) {
    if (excludedIds.has(record.universityId)) continue;
    const normalizedName = normalizeUniversityName(record.universityName);
    const treeRecord = treeByName.get(normalizedName);
    const treeHomepage = readHttpUrl(treeRecord?.finalHomepageUrl) ?? readHttpUrl(treeRecord?.homepageUrl);
    const existingHomepage = inferHomepageFromExistingSources(record);
    const projectHomepage = readHttpUrl(PROJECT_HOMEPAGE_OVERRIDES[record.universityId]);
    const officialHomepageUrl = treeHomepage ?? existingHomepage ?? projectHomepage;
    if (!officialHomepageUrl) {
      throw new Error(`No official homepage candidate for ${record.universityId}.`);
    }

    const homepageResolution: TargetUniversity["homepageResolution"] = treeHomepage
      ? "faculty_tree"
      : existingHomepage
        ? "existing_verified_source"
        : "project_domain_registry";
    const officialDomains = collectOfficialDomains(record, officialHomepageUrl);
    const excludedDomain = officialDomains.find((domain) => isExcludedDomain(domain));
    if (excludedDomain) {
      throw new Error(`Target ${record.universityId} resolved to excluded domain ${excludedDomain}.`);
    }

    targets.push({
      universityId: record.universityId,
      universityName: record.universityName,
      normalizedName,
      aliases: uniqueStrings([record.universityName, stripTrailingCity(record.universityName)]),
      ...(record.city ? { city: record.city } : {}),
      officialHomepageUrl,
      officialDomains,
      homepageResolution
    });
    normalizationAudit.push({
      universityId: record.universityId,
      canonicalName: record.universityName,
      normalizedName,
      ...(treeRecord?.name ? { matchedTreeName: treeRecord.name } : {}),
      homepageResolution
    });
  }

  const duplicateIds = duplicates(targets.map((record) => record.universityId));
  const duplicateNames = duplicates(targets.map((record) => record.normalizedName));
  if (duplicateIds.length > 0 || duplicateNames.length > 0) {
    throw new Error(`Duplicate targets found: ids=${duplicateIds.join(",")}; names=${duplicateNames.join(",")}.`);
  }
  if (targets.length !== 198) {
    throw new Error(`Expected exactly 198 target universities, received ${targets.length}.`);
  }

  return {
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    sourceUniversityCount: sourceRecords.length,
    expectedTargetCount: 198,
    targetCount: targets.length,
    exclusionCount: EXCLUDED_UNIVERSITIES.length,
    targets: targets.sort((left, right) => left.universityName.localeCompare(right.universityName, "tr-TR")),
    exclusions: EXCLUDED_UNIVERSITIES.map((record) => ({
      universityId: record.universityId,
      universityName: record.universityName,
      domains: [...record.domains],
      reason: record.reason
    })),
    normalizationAudit
  };
}

export function normalizeUniversityName(value: string): string {
  return foldTurkishText(stripTrailingCity(value))
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function foldTurkishText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/gu, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/ğ/gu, "g")
    .replace(/ş/gu, "s")
    .replace(/ç/gu, "c")
    .replace(/ö/gu, "o")
    .replace(/ü/gu, "u");
}

export function stripTrailingCity(value: string): string {
  let result = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  while (/\s*\([^()]+\)\s*$/u.test(result)) {
    result = result.replace(/\s*\([^()]+\)\s*$/u, "").trim();
  }
  return result;
}

export function canonicalizeUrl(input: string, base?: string): string | null {
  try {
    const url = base ? new URL(input, base) : new URL(input);
    if (!/^https?:$/u.test(url.protocol)) return null;
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/iu.test(key)) url.searchParams.delete(key);
    }
    if (!url.hash.startsWith("#!")) url.hash = "";
    url.pathname = url.pathname.replace(/\/{2,}/gu, "/");
    return url.toString();
  } catch {
    return null;
  }
}

export function registrableDomain(input: string): string | null {
  let hostname: string;
  try {
    hostname = input.includes("://") ? new URL(input).hostname : input;
  } catch {
    return null;
  }
  const labels = hostname.toLowerCase().replace(/^www\./u, "").split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] ?? null;
  if (labels.length >= 3 && labels.at(-2) === "edu" && labels.at(-1) === "tr") {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

export function isExcludedDomain(input: string): boolean {
  const domain = registrableDomain(input);
  return domain !== null && EXCLUDED_UNIVERSITIES.some((record) => record.domains.some((excluded) => excluded === domain));
}

export function isOfficialUrl(input: string, officialDomains: string[]): boolean {
  const domain = registrableDomain(input);
  return domain !== null && officialDomains.includes(domain) && !isExcludedDomain(domain);
}

export function classifyCandidateUrl(url: string, anchorText = ""): SourceType | null {
  const folded = foldTurkishText(`${url} ${anchorText}`).replace(/[^a-z0-9]+/gu, " ");
  if (/\b(sinav programi?|exam schedule|exam timetable)\b/u.test(folded)) return "exam_schedule";
  if (/\b(ders programi?|haftalik ders|course schedule|class schedule|timetable)\b/u.test(folded)) return "course_schedule";
  if (/\b(akademik takvim|academic calendar|egitim ogretim takvim)\b/u.test(folded)) return "academic_calendar";
  if (/\.(?:pdf|docx?|xlsx?|png|jpe?g|gif|webp)(?:$|[?#])/iu.test(url)) return null;
  if (/\b(duyuru|duyurular|announcement|announcements|ilan|notices)\b/u.test(folded)) return "announcement";
  if (/\b(haber|haberler|news)\b/u.test(folded)) return "news";
  if (/\b(etkinlik|etkinlikler|event|events)\b/u.test(folded)) return "event";
  return null;
}

export function isLikelyListingUrl(url: string, sourceType: SourceType, anchorText = ""): boolean {
  if (!["announcement", "news", "event"].includes(sourceType)) return true;
  try {
    const parsed = new URL(url);
    if (/\.(?:pdf|docx?|xlsx?|png|jpe?g|gif|webp)$/iu.test(parsed.pathname)) return false;
    const segments = parsed.pathname
      .split("/")
      .map((segment) => foldTurkishText(decodeURIComponent(segment)).replace(/[^a-z0-9]+/gu, " ").trim())
      .filter(Boolean);
    const last = segments.at(-1) ?? "";
    const previous = segments.at(-2) ?? "";
    const foldedAnchor = foldTurkishText(anchorText).replace(/[^a-z0-9]+/gu, " ").trim();
    const names = sourceType === "announcement"
      ? ["duyuru", "duyurular", "announcement", "announcements", "ilan", "notices"]
      : sourceType === "news"
        ? ["haber", "haberler", "news"]
        : ["etkinlik", "etkinlikler", "event", "events"];
    const genericAnchor = names.some((name) => foldedAnchor === name || foldedAnchor === `tum ${name}` || foldedAnchor === `all ${name}`);
    const terminalCategory = names.includes(last) || names.some((name) => last === `tum ${name}` || last === `all ${name}`);
    const categoryArchive = previous === "category" && names.includes(last);
    const archivePath = segments.some((segment) => ["arsiv", "archive", "list", "liste", "index"].includes(segment)) && segments.some((segment) => names.includes(segment));
    const paginatedCategory = parsed.searchParams.has("page") && segments.some((segment) => names.includes(segment));
    return terminalCategory || categoryArchive || archivePath || paginatedCategory || (genericAnchor && names.some((name) => last.includes(name)));
  } catch {
    return false;
  }
}

export function validateHtmlSemantic(input: HtmlSemanticInput): SemanticResult {
  const reasons: string[] = [];
  const combined = foldTurkishText(`${input.finalUrl} ${input.title} ${input.heading} ${input.text.slice(0, 200_000)}`);
  const meaningfulText = cleanVisibleText(input.text);
  const soft404 = detectSoft404(input.title, input.heading, meaningfulText, input.finalUrl);
  if (soft404) reasons.push("soft_404_detected");
  if (meaningfulText.length < 100) reasons.push("insufficient_meaningful_text");

  switch (input.sourceType) {
    case "homepage":
      if (input.scopeName && tokenSimilarity(input.scopeName, `${input.title} ${input.heading} ${meaningfulText.slice(0, 3000)}`) < 0.18) {
        reasons.push("university_identity_not_visible");
      }
      break;
    case "academic_unit_page":
      if (input.scopeName && tokenSimilarity(input.scopeName, `${input.title} ${input.heading} ${meaningfulText.slice(0, 5000)}`) < 0.25) {
        reasons.push("academic_unit_identity_not_visible");
      }
      break;
    case "announcement":
      requireListingSignal(combined, input.itemCount, reasons, ["duyuru", "announcement", "ilan", "notice"]);
      if (!isLikelyListingUrl(input.finalUrl, input.sourceType)) reasons.push("listing_url_shape_invalid");
      break;
    case "news":
      requireListingSignal(combined, input.itemCount, reasons, ["haber", "news"]);
      if (!isLikelyListingUrl(input.finalUrl, input.sourceType)) reasons.push("listing_url_shape_invalid");
      break;
    case "event":
      requireListingSignal(combined, input.itemCount, reasons, ["etkinlik", "event"]);
      if (!isLikelyListingUrl(input.finalUrl, input.sourceType)) reasons.push("listing_url_shape_invalid");
      break;
    case "academic_calendar":
      if (!containsAny(combined, ["akademik takvim", "academic calendar", "egitim ogretim takvim"])) {
        reasons.push("academic_calendar_keyword_missing");
      }
      if (countDateSignals(meaningfulText) < 2) reasons.push("academic_calendar_dates_missing");
      break;
    case "course_schedule":
      if (!containsAny(combined, ["ders program", "course schedule", "class schedule", "timetable", "haftalik program"])) {
        reasons.push("course_schedule_keyword_missing");
      }
      if (!hasTimetableStructure(meaningfulText)) reasons.push("course_schedule_structure_missing");
      if (input.scopeName && tokenSimilarity(input.scopeName, meaningfulText) < 0.16) reasons.push("course_schedule_scope_not_visible");
      break;
    case "exam_schedule":
      if (!containsAny(combined, ["sinav program", "exam schedule", "exam timetable"])) reasons.push("exam_schedule_keyword_missing");
      break;
  }

  return {
    semanticMatch: reasons.length === 0,
    soft404,
    reasons
  };
}

export function validateDocument(input: DocumentValidationInput): SemanticResult & { detectedType: string | null } {
  const reasons: string[] = [];
  const detectedType = detectDocumentType(input.body);
  const text = cleanVisibleText(input.extractedText ?? "");
  const combined = foldTurkishText(`${input.url} ${text.slice(0, 250_000)}`);
  if (!detectedType) reasons.push("unknown_file_signature");
  if (input.body.byteLength < 1024) reasons.push("document_too_small");
  if (input.sourceType === "academic_calendar") {
    if (!containsAny(combined, ["akademik takvim", "academic calendar", "egitim ogretim", "guz yariyili", "bahar yariyili"])) {
      reasons.push("academic_calendar_keyword_missing");
    }
    if (countDateSignals(text || combined) < 2) reasons.push("academic_calendar_dates_missing");
  }
  if (input.sourceType === "course_schedule") {
    if (!containsAny(combined, ["ders program", "course schedule", "class schedule", "timetable"])) {
      reasons.push("course_schedule_keyword_missing");
    }
    if (!hasTimetableStructure(text)) reasons.push("course_schedule_structure_missing");
    if (input.scopeName && tokenSimilarity(input.scopeName, text) < 0.16) reasons.push("course_schedule_scope_not_visible");
  }
  return { semanticMatch: reasons.length === 0, soft404: false, reasons, detectedType };
}

export function detectDocumentType(body: Uint8Array): string | null {
  if (startsWithBytes(body, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (startsWithBytes(body, [0x50, 0x4b, 0x03, 0x04])) return "zip_office";
  if (startsWithBytes(body, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (startsWithBytes(body, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWithBytes(body, [0xd0, 0xcf, 0x11, 0xe0])) return "ole_office";
  return null;
}

export function detectSoft404(title: string, heading: string, text: string, finalUrl: string): boolean {
  const folded = foldTurkishText(`${title} ${heading} ${text.slice(0, 5000)}`);
  const explicit = [
    "404", "sayfa bulunamadi", "aradiginiz sayfa bulunamadi", "icerik bulunamadi", "page not found",
    "the page you requested could not be found", "boyle bir sayfa yok", "kayit bulunamadi"
  ];
  if (containsAny(folded, explicit)) return true;
  try {
    const requestedPath = new URL(finalUrl).pathname;
    return requestedPath !== "/" && /^\s*(anasayfa|ana sayfa|home)\s*$/u.test(foldTurkishText(heading));
  } catch {
    return false;
  }
}

export function cleanVisibleText(value: string): string {
  return value.replace(/\u00a0/gu, " ").replace(/\s+/gu, " ").trim();
}

export function countDateSignals(value: string): number {
  const numeric = value.match(/\b(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:20)?\d{2}\b/gu) ?? [];
  const textual = foldTurkishText(value).match(/\b(?:ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\s+(?:20)?\d{2}\b/gu) ?? [];
  const ranges = value.match(/\b20\d{2}\s*[-/]\s*20\d{2}\b/gu) ?? [];
  return numeric.length + textual.length + ranges.length;
}

export function hasTimetableStructure(value: string): boolean {
  const folded = foldTurkishText(value);
  const dayCount = ["pazartesi", "sali", "carsamba", "persembe", "cuma", "monday", "tuesday", "wednesday", "thursday", "friday"]
    .filter((day) => folded.includes(day)).length;
  const timeCount = (value.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/gu) ?? []).length;
  const courseSignal = /\b(?:ders|course|sinif|classroom|ogretim elemani|instructor|kodu|code)\b/u.test(folded);
  return (dayCount >= 2 && timeCount >= 2) || (courseSignal && timeCount >= 3);
}

export function tokenSimilarity(expected: string, actual: string): number {
  const expectedTokens = tokenSet(expected);
  if (expectedTokens.size === 0) return 0;
  const actualTokens = tokenSet(actual);
  let matched = 0;
  for (const token of expectedTokens) if (actualTokens.has(token)) matched += 1;
  return matched / expectedTokens.size;
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function validateVerifiedOutputShape(record: VerifiedOutputShape): string[] {
  const errors: string[] = [];
  if (!readHttpUrl(record.sourceUrl)) errors.push("invalid_source_url");
  if (!readHttpUrl(record.finalUrl)) errors.push("invalid_final_url");
  if (record.browserOpened !== true) errors.push("browser_not_opened");
  if (record.semanticMatch !== true) errors.push("semantic_match_missing");
  if (record.soft404 !== false) errors.push("soft_404_not_false");
  if (record.officialDomain !== true) errors.push("official_domain_not_confirmed");
  if (typeof record.verifiedAt !== "string" || Number.isNaN(Date.parse(record.verifiedAt))) errors.push("invalid_verified_at");
  if (typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(record.sha256)) errors.push("invalid_sha256");
  if (typeof record.evidencePath !== "string" || !record.evidencePath.trim()) errors.push("missing_evidence_path");
  if (record.status !== "verified") errors.push("status_not_verified");
  return errors;
}

function inferHomepageFromExistingSources(record: CanonicalUniversityRecord): string | null {
  const candidates = [record.announcementUrl, record.newsUrl, record.eventUrl, record.calendarUrl, record.summerSchoolUrl];
  for (const candidate of candidates) {
    const parsed = readHttpUrl(candidate);
    if (!parsed) continue;
    const url = new URL(parsed);
    return `${url.protocol}//${url.host}/`;
  }
  return null;
}

function collectOfficialDomains(record: CanonicalUniversityRecord, homepage: string): string[] {
  const candidates = [homepage, record.announcementUrl, record.newsUrl, record.eventUrl, record.calendarUrl, record.summerSchoolUrl];
  return uniqueStrings(candidates.flatMap((value) => {
    const parsed = readHttpUrl(value);
    const domain = parsed ? registrableDomain(parsed) : null;
    return domain && domain.endsWith(".edu.tr") ? [domain] : [];
  }));
}

function readHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return canonicalizeUrl(value.trim());
}

function requireListingSignal(combined: string, itemCount: number | undefined, reasons: string[], hints: string[]): void {
  if (!containsAny(combined, hints)) reasons.push("category_keyword_missing");
  if ((itemCount ?? 0) < 1) reasons.push("listing_items_missing");
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function tokenSet(value: string): Set<string> {
  const stopWords = new Set(["universitesi", "universite", "fakultesi", "fakulte", "bolumu", "bolum", "meslek", "yuksekokulu", "ve", "the", "of"]);
  return new Set(foldTurkishText(value).split(/[^a-z0-9]+/u).filter((token) => token.length >= 3 && !stopWords.has(token)));
}

function startsWithBytes(body: Uint8Array, bytes: number[]): boolean {
  return bytes.every((byte, index) => body[index] === byte);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicatesFound = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicatesFound.add(value);
    seen.add(value);
  }
  return [...duplicatesFound];
}
