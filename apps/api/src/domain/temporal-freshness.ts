export interface TemporalFreshnessInput {
  title?: string | undefined;
  url?: string | undefined;
  text?: string | undefined;
  publishedAt?: Date | string | undefined;
  fetchedAt?: Date | string | undefined;
  now?: Date;
  academicYearLookback?: number;
}

export interface TemporalFreshnessDecision {
  accepted: boolean;
  reason: "current_academic_year" | "current_year" | "recent_publication" | "unknown_date" | "stale_academic_year" | "stale_year" | "stale_publication" | "future_year";
  years: number[];
  academicYears: string[];
}

export function isFreshAcademicContent(input: TemporalFreshnessInput): TemporalFreshnessDecision {
  const now = input.now ?? new Date();
  const values = [input.title, input.url, input.text].filter((value): value is string => Boolean(value));
  const academicYears = extractAcademicYearRanges(values);
  const years = extractExplicitYears(values);
  const currentStart = currentAcademicYearStart(now);
  const minimumYear = currentStart - readPositiveInteger(
    input.academicYearLookback?.toString(),
    readPositiveInteger(process.env.ACADEMIC_CONTENT_MIN_YEAR_LOOKBACK, 1)
  );
  const maximumYear = currentStart + readPositiveInteger(process.env.ACADEMIC_CONTENT_MAX_YEAR_LOOKAHEAD, 1);

  if (academicYears.length > 0) {
    const acceptableAcademicYears = academicYears.filter((academicYear) => {
      const startYear = academicYearStart(academicYear);
      return startYear >= minimumYear && startYear <= currentStart;
    });
    if (acceptableAcademicYears.length > 0) return { accepted: true, reason: "current_academic_year", years, academicYears };
    return { accepted: false, reason: "stale_academic_year", years, academicYears };
  }

  if (years.length > 0) {
    if (years.some((year) => year >= minimumYear && year <= maximumYear)) return { accepted: true, reason: "current_year", years, academicYears };
    if (Math.max(...years) < minimumYear) return { accepted: false, reason: "stale_year", years, academicYears };
    return { accepted: false, reason: "future_year", years, academicYears };
  }

  const publicationDate = coerceDate(input.publishedAt ?? input.fetchedAt);
  if (publicationDate) {
    const earliest = new Date(now);
    earliest.setUTCFullYear(now.getUTCFullYear() - 1);
    if (publicationDate.getTime() >= earliest.getTime()) return { accepted: true, reason: "recent_publication", years, academicYears };
    return { accepted: false, reason: "stale_publication", years, academicYears };
  }

  return { accepted: true, reason: "unknown_date", years, academicYears };
}

export function extractAcademicYearRanges(values: string[]): string[] {
  const years = new Set<string>();
  for (const value of values) {
    for (const match of foldForTemporalMatch(value).matchAll(/(20\d{2})\s*[-_/]\s*(20\d{2})/gu)) {
      const normalized = match[1] && match[2] ? normalizeAcademicYearPair(match[1], match[2]) : undefined;
      if (normalized) years.add(normalized);
    }
    for (const match of foldForTemporalMatch(value).matchAll(/\b(20\d{2})(20\d{2})\b/gu)) {
      const normalized = match[1] && match[2] ? normalizeAcademicYearPair(match[1], match[2]) : undefined;
      if (normalized) years.add(normalized);
    }
  }
  return [...years].sort((left, right) => academicYearStart(right) - academicYearStart(left));
}

export function extractExplicitYears(values: string[]): number[] {
  const years = new Set<number>();
  for (const value of values) {
    for (const match of foldForTemporalMatch(value).matchAll(/\b(20\d{2})\b/gu)) {
      const year = Number(match[1]);
      if (Number.isInteger(year)) years.add(year);
    }
  }
  return [...years].sort((left, right) => left - right);
}

export function currentAcademicYear(date = new Date()): string {
  const startYear = currentAcademicYearStart(date);
  return `${startYear}-${startYear + 1}`;
}

export function currentAcademicYearStart(date = new Date()): number {
  const year = date.getUTCFullYear();
  return date.getUTCMonth() >= 6 ? year : year - 1;
}

export function isAcceptableAcademicYear(academicYear: string, date = new Date()): boolean {
  const startYear = academicYearStart(academicYear);
  const currentStart = currentAcademicYearStart(date);
  const minimumYear = currentStart - readPositiveInteger(process.env.ACADEMIC_CONTENT_MIN_YEAR_LOOKBACK, 1);
  return Number.isInteger(startYear) && startYear >= minimumYear && startYear <= currentStart;
}

export function academicYearStart(academicYear: string): number {
  const startYear = Number(academicYear.match(/20\d{2}/u)?.[0]);
  return Number.isInteger(startYear) ? startYear : 0;
}

function normalizeAcademicYearPair(left: string, right: string): string | undefined {
  const leftYear = Number(left);
  const rightYear = Number(right);
  if (!Number.isInteger(leftYear) || !Number.isInteger(rightYear) || Math.abs(leftYear - rightYear) !== 1) return undefined;
  const startYear = Math.min(leftYear, rightYear);
  return `${startYear}-${startYear + 1}`;
}

function coerceDate(value?: Date | string): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
}

function foldForTemporalMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "I")
    .replace(/ÄŸ/g, "g")
    .replace(/Ä/g, "G")
    .replace(/Ã¼/g, "u")
    .replace(/Ãœ/g, "U")
    .replace(/ÅŸ/g, "s")
    .replace(/Å/g, "S")
    .replace(/Ã¶/g, "o")
    .replace(/Ã–/g, "O")
    .replace(/Ã§/g, "c")
    .replace(/Ã‡/g, "C")
    .toLocaleLowerCase("en-US");
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
