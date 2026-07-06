import type { AcademicTerm, NormalizedDateResult } from "./academic-event.types.js";

const turkishMonths: Record<string, number> = {
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

function toIsoDate(year: number, month: number, day: number): string {
  const paddedMonth = String(month).padStart(2, "0");
  const paddedDay = String(day).padStart(2, "0");
  return `${year}-${paddedMonth}-${paddedDay}`;
}

function normalizeText(value: string): string {
  return foldTurkish(value)
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function detectTerm(value: string): AcademicTerm | undefined {
  const text = normalizeText(value);
  if (/guz|fall/.test(text)) return "fall";
  if (/bahar|spring/.test(text)) return "spring";
  if (/yaz okulu|summer/.test(text)) return "summer";
  if (/akademik yil/.test(text)) return "full_year";
  return undefined;
}

export function normalizeAcademicDate(input: string, defaultYear?: number): NormalizedDateResult {
  const originalDateText = input.trim();
  const text = normalizeText(input);
  const warnings: string[] = [];
  const academicYearMatch = text.match(/(20\d{2})\s*[-/]\s*(20\d{2})\s*akademik\s*yili?/u);

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

  const numericRange = text.match(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})(?:\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d))?\s*-\s*(\d{1,2})[./-](\d{1,2})[./-](20\d{2})(?:\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d))?/u);
  if (numericRange?.[1] && numericRange[2] && numericRange[3] && numericRange[6] && numericRange[7] && numericRange[8]) {
    const startTime = normalizeTimeParts(numericRange[4], numericRange[5]);
    const endTime = normalizeTimeParts(numericRange[9], numericRange[10]);
    return {
      originalDateText,
      startDate: toIsoDate(Number(numericRange[3]), Number(numericRange[2]), Number(numericRange[1])),
      endDate: toIsoDate(Number(numericRange[8]), Number(numericRange[7]), Number(numericRange[6])),
      ...(startTime ? { startTime, hasExplicitTime: true } : {}),
      ...(endTime ? { endTime, hasExplicitTime: true } : {}),
      datePrecision: "date_range",
      term: term ?? "unknown",
      warnings
    };
  }

  const numericSingleTimeRange = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)\s*-\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/u);
  if (numericSingleTimeRange?.[1] && numericSingleTimeRange[2] && numericSingleTimeRange[3]) {
    const isoDate = toIsoDate(Number(numericSingleTimeRange[3]), Number(numericSingleTimeRange[2]), Number(numericSingleTimeRange[1]));
    const startTime = normalizeTimeParts(numericSingleTimeRange[4], numericSingleTimeRange[5]);
    const endTime = normalizeTimeParts(numericSingleTimeRange[6], numericSingleTimeRange[7]);
    return {
      originalDateText,
      startDate: isoDate,
      endDate: isoDate,
      ...(startTime ? { startTime, hasExplicitTime: true } : {}),
      ...(endTime ? { endTime, hasExplicitTime: true } : {}),
      datePrecision: "day",
      term: term ?? "unknown",
      warnings
    };
  }

  const numericSingle = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})(?:\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d))?\b/u);
  if (numericSingle?.[1] && numericSingle[2] && numericSingle[3]) {
    const startTime = normalizeTimeParts(numericSingle[4], numericSingle[5]);
    return {
      originalDateText,
      startDate: toIsoDate(Number(numericSingle[3]), Number(numericSingle[2]), Number(numericSingle[1])),
      ...(startTime ? { startTime, hasExplicitTime: true } : {}),
      datePrecision: "day",
      term: term ?? "unknown",
      warnings
    };
  }

  const textualSameMonthRange = text.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\s+([a-z]+)\s+(20\d{2})(?:\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d))?\b/u);
  if (textualSameMonthRange?.[1] && textualSameMonthRange[2] && textualSameMonthRange[3] && textualSameMonthRange[4]) {
    const month = turkishMonths[textualSameMonthRange[3]];
    if (month) {
      const startTime = normalizeTimeParts(textualSameMonthRange[5], textualSameMonthRange[6]);
      return {
        originalDateText,
        startDate: toIsoDate(Number(textualSameMonthRange[4]), month, Number(textualSameMonthRange[1])),
        endDate: toIsoDate(Number(textualSameMonthRange[4]), month, Number(textualSameMonthRange[2])),
        ...(startTime ? { startTime, hasExplicitTime: true } : {}),
        datePrecision: "date_range",
        term: term ?? "unknown",
        warnings
      };
    }
  }

  const textualDifferentMonthRange = text.match(/\b(\d{1,2})\s+([a-z]+)\s*-\s*(\d{1,2})\s+([a-z]+)\s+(20\d{2})(?:\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d))?\b/u);
  if (textualDifferentMonthRange?.[1] && textualDifferentMonthRange[2] && textualDifferentMonthRange[3] && textualDifferentMonthRange[4] && textualDifferentMonthRange[5]) {
    const startMonth = turkishMonths[textualDifferentMonthRange[2]];
    const endMonth = turkishMonths[textualDifferentMonthRange[4]];
    if (startMonth && endMonth) {
      const startTime = normalizeTimeParts(textualDifferentMonthRange[6], textualDifferentMonthRange[7]);
      return {
        originalDateText,
        startDate: toIsoDate(Number(textualDifferentMonthRange[5]), startMonth, Number(textualDifferentMonthRange[1])),
        endDate: toIsoDate(Number(textualDifferentMonthRange[5]), endMonth, Number(textualDifferentMonthRange[3])),
        ...(startTime ? { startTime, hasExplicitTime: true } : {}),
        datePrecision: "date_range",
        term: term ?? "unknown",
        warnings
      };
    }
  }

  const textualSingle = text.match(/\b(\d{1,2})\s+([a-z]+)\s+(20\d{2})(?:\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d))?\b/u);
  if (textualSingle?.[1] && textualSingle[2] && textualSingle[3]) {
    const month = turkishMonths[textualSingle[2]];
    if (month) {
      const startTime = normalizeTimeParts(textualSingle[4], textualSingle[5]);
      return {
        originalDateText,
        startDate: toIsoDate(Number(textualSingle[3]), month, Number(textualSingle[1])),
        ...(startTime ? { startTime, hasExplicitTime: true } : {}),
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

  if (defaultYear && /donem bas|donem son/.test(text)) {
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

function normalizeTimeParts(hour?: string, minute?: string): string | undefined {
  if (!hour || !minute) return undefined;
  const parsedHour = Number(hour);
  const parsedMinute = Number(minute);
  if (!Number.isInteger(parsedHour) || !Number.isInteger(parsedMinute) || parsedHour < 0 || parsedHour > 23 || parsedMinute < 0 || parsedMinute > 59) return undefined;
  return `${String(parsedHour).padStart(2, "0")}:${String(parsedMinute).padStart(2, "0")}`;
}

function foldTurkish(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "I")
    .replace(/ğ/g, "g")
    .replace(/Ğ/g, "G")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "U")
    .replace(/ş/g, "s")
    .replace(/Ş/g, "S")
    .replace(/ö/g, "o")
    .replace(/Ö/g, "O")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "C");
}
