import type { AcademicTerm, NormalizedDateResult } from "./academic-event.types.js";

const turkishMonths: Record<string, number> = {
  ocak: 1,
  subat: 2,
  "şubat": 2,
  mart: 3,
  nisan: 4,
  mayis: 5,
  "mayıs": 5,
  haziran: 6,
  temmuz: 7,
  agustos: 8,
  "ağustos": 8,
  eylul: 9,
  "eylül": 9,
  ekim: 10,
  kasim: 11,
  "kasım": 11,
  aralik: 12,
  "aralık": 12
};

function toIsoDate(year: number, month: number, day: number): string {
  const paddedMonth = String(month).padStart(2, "0");
  const paddedDay = String(day).padStart(2, "0");
  return `${year}-${paddedMonth}-${paddedDay}`;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");
}

function detectTerm(value: string): AcademicTerm | undefined {
  const text = normalizeText(value);
  if (/güz|guz|fall/.test(text)) return "fall";
  if (/bahar|spring/.test(text)) return "spring";
  if (/yaz okulu|summer/.test(text)) return "summer";
  if (/akademik yıl|akademik yil/.test(text)) return "full_year";
  return undefined;
}

export function normalizeAcademicDate(input: string, defaultYear?: number): NormalizedDateResult {
  const originalDateText = input.trim();
  const text = normalizeText(input);
  const warnings: string[] = [];
  const academicYearMatch = text.match(/(20\d{2})\s*[-/]\s*(20\d{2})\s*akademik\s*y[ıi]l[ıi]/u);

  if (academicYearMatch?.[1] && academicYearMatch[2]) {
    return {
      originalDateText,
      academicYear: `${academicYearMatch[1]}-${academicYearMatch[2]}`,
      datePrecision: "academic_year",
      term: "full_year",
      warnings
    };
  }

  const term = detectTerm(text);
  if (term && !/\d/.test(text)) {
    return {
      originalDateText,
      datePrecision: "term",
      term,
      warnings
    };
  }

  const numericRange = text.match(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\s*[-–]\s*(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/u);
  if (numericRange?.[1] && numericRange[2] && numericRange[3] && numericRange[4] && numericRange[5] && numericRange[6]) {
    return {
      originalDateText,
      startDate: toIsoDate(Number(numericRange[3]), Number(numericRange[2]), Number(numericRange[1])),
      endDate: toIsoDate(Number(numericRange[6]), Number(numericRange[5]), Number(numericRange[4])),
      datePrecision: "date_range",
      term: term ?? "unknown",
      warnings
    };
  }

  const numericSingle = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/u);
  if (numericSingle?.[1] && numericSingle[2] && numericSingle[3]) {
    return {
      originalDateText,
      startDate: toIsoDate(Number(numericSingle[3]), Number(numericSingle[2]), Number(numericSingle[1])),
      datePrecision: "day",
      term: term ?? "unknown",
      warnings
    };
  }

  const textualSameMonthRange = text.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([a-zçğıöşü]+)\s+(20\d{2})\b/u);
  if (textualSameMonthRange?.[1] && textualSameMonthRange[2] && textualSameMonthRange[3] && textualSameMonthRange[4]) {
    const month = turkishMonths[textualSameMonthRange[3]];
    if (month) {
      return {
        originalDateText,
        startDate: toIsoDate(Number(textualSameMonthRange[4]), month, Number(textualSameMonthRange[1])),
        endDate: toIsoDate(Number(textualSameMonthRange[4]), month, Number(textualSameMonthRange[2])),
        datePrecision: "date_range",
        term: term ?? "unknown",
        warnings
      };
    }
  }

  const textualDifferentMonthRange = text.match(/\b(\d{1,2})\s+([a-zçğıöşü]+)\s*[-–]\s*(\d{1,2})\s+([a-zçğıöşü]+)\s+(20\d{2})\b/u);
  if (textualDifferentMonthRange?.[1] && textualDifferentMonthRange[2] && textualDifferentMonthRange[3] && textualDifferentMonthRange[4] && textualDifferentMonthRange[5]) {
    const startMonth = turkishMonths[textualDifferentMonthRange[2]];
    const endMonth = turkishMonths[textualDifferentMonthRange[4]];
    if (startMonth && endMonth) {
      return {
        originalDateText,
        startDate: toIsoDate(Number(textualDifferentMonthRange[5]), startMonth, Number(textualDifferentMonthRange[1])),
        endDate: toIsoDate(Number(textualDifferentMonthRange[5]), endMonth, Number(textualDifferentMonthRange[3])),
        datePrecision: "date_range",
        term: term ?? "unknown",
        warnings
      };
    }
  }

  const textualSingle = text.match(/\b(\d{1,2})\s+([a-zçğıöşü]+)\s+(20\d{2})\b/u);
  if (textualSingle?.[1] && textualSingle[2] && textualSingle[3]) {
    const month = turkishMonths[textualSingle[2]];
    if (month) {
      return {
        originalDateText,
        startDate: toIsoDate(Number(textualSingle[3]), month, Number(textualSingle[1])),
        datePrecision: "day",
        term: term ?? "unknown",
        warnings
      };
    }
  }

  const weekMatch = text.match(/\b(\d{1,2})\.\s*hafta\b/u);
  if (weekMatch) {
    warnings.push("Week expression requires academic term calendar context.");
    return {
      originalDateText,
      datePrecision: "week",
      term: term ?? "unknown",
      warnings
    };
  }

  if (defaultYear && /dönem baş|donem bas|dönem son|donem son/.test(text)) {
    warnings.push("Relative term boundary requires approved academic calendar context.");
    return {
      originalDateText,
      datePrecision: "term",
      term: term ?? "unknown",
      warnings
    };
  }

  warnings.push("Date could not be normalized automatically.");
  return {
    originalDateText,
    datePrecision: "unknown",
    term: term ?? "unknown",
    warnings
  };
}
