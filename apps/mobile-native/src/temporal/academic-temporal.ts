export type AcademicTemporalKind = "date" | "timestamp";

export interface AcademicTemporalValue {
  startDate: string;
  endDate?: string;
  temporalKind?: AcademicTemporalKind;
  endTemporalKind?: AcademicTemporalKind;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ACADEMIC_DAY_CACHE_LIMIT = 2_048;
const academicDayCache = new Map<string, number | null>();
const istanbulDayCache = new WeakMap<Date, { timestamp: number; day: number }>();
const istanbulDatePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const turkishDateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC"
});
const turkishTimestampFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Istanbul"
});

export function isDateOnlyValue(value: string): boolean {
  return validDateOnlyParts(value) !== null;
}

export function academicCalendarDayNumber(value: string): number | null {
  if (academicDayCache.has(value)) return academicDayCache.get(value) ?? null;

  const dateOnly = validDateOnlyParts(value);
  let day: number | null;
  if (dateOnly) {
    day = Date.UTC(dateOnly.year, dateOnly.month - 1, dateOnly.day);
  } else {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      day = null;
    } else {
      const parts = istanbulDateParts(parsed);
      day = Date.UTC(parts.year, parts.month - 1, parts.day);
    }
  }

  if (academicDayCache.size >= ACADEMIC_DAY_CACHE_LIMIT) academicDayCache.clear();
  academicDayCache.set(value, day);
  return day;
}

export function isAcademicTemporalCurrentOrFuture(value: AcademicTemporalValue, now: Date): boolean {
  const hasDateOnlyEnd = Boolean(
    value.endDate
    && (value.endTemporalKind === "date" || isDateOnlyValue(value.endDate))
  );
  if (hasDateOnlyEnd) {
    const end = academicCalendarDayNumber(value.endDate!);
    return end !== null && end >= istanbulCalendarDayNumber(now);
  }
  if (value.endDate && value.endTemporalKind === "timestamp") {
    const exactEnd = Date.parse(value.endDate);
    return Number.isFinite(exactEnd) && exactEnd >= now.getTime();
  }
  const isDateOnly = value.temporalKind === "date" || isDateOnlyValue(value.startDate);
  if (isDateOnly) {
    const today = istanbulCalendarDayNumber(now);
    const end = academicCalendarDayNumber(value.endDate ?? value.startDate);
    return end !== null && end >= today;
  }
  const end = Date.parse(value.endDate ?? value.startDate);
  return Number.isFinite(end) && end >= now.getTime();
}

export function isAcademicTemporalActiveOnDay(value: AcademicTemporalValue, now: Date): boolean {
  const today = istanbulCalendarDayNumber(now);
  const start = academicCalendarDayNumber(value.startDate);
  const end = academicCalendarDayNumber(value.endDate ?? value.startDate);
  return start !== null && end !== null && start <= today && today <= end;
}

export function compareAcademicTemporalStart(left: AcademicTemporalValue, right: AcademicTemporalValue): number {
  const leftDay = academicCalendarDayNumber(left.startDate);
  const rightDay = academicCalendarDayNumber(right.startDate);
  if (leftDay !== null && rightDay !== null && leftDay !== rightDay) return leftDay - rightDay;
  const leftTimestamp = left.temporalKind === "date" || isDateOnlyValue(left.startDate) ? 0 : Date.parse(left.startDate);
  const rightTimestamp = right.temporalKind === "date" || isDateOnlyValue(right.startDate) ? 0 : Date.parse(right.startDate);
  return (Number.isFinite(leftTimestamp) ? leftTimestamp : 0) - (Number.isFinite(rightTimestamp) ? rightTimestamp : 0);
}

export function formatAcademicTemporal(value: AcademicTemporalValue): string {
  const startKind = value.temporalKind ?? (isDateOnlyValue(value.startDate) ? "date" : "timestamp");
  const endKind = value.endDate
    ? value.endTemporalKind ?? (isDateOnlyValue(value.endDate) ? "date" : startKind)
    : undefined;
  const start = formatTemporalEndpoint(value.startDate, startKind);
  if (!value.endDate || value.endDate === value.startDate) return start;
  const end = formatTemporalEndpoint(value.endDate, endKind ?? startKind);
  return `${start} – ${end}`;
}

export function formatAcademicRemainingTime(value: AcademicTemporalValue, now: Date): string {
  const dateOnly = value.temporalKind === "date" || isDateOnlyValue(value.startDate);
  if (!dateOnly) {
    const difference = Date.parse(value.startDate) - now.getTime();
    if (!Number.isFinite(difference)) return "Tarih belirtilmemiş";
    if (difference < 0 && isAcademicTemporalCurrentOrFuture(value, now)) return "Devam ediyor";
    return remainingDurationLabel(difference);
  }

  const today = istanbulCalendarDayNumber(now);
  const start = academicCalendarDayNumber(value.startDate);
  const end = academicCalendarDayNumber(value.endDate ?? value.startDate);
  if (start === null || end === null) return "Tarih belirtilmemiş";
  if (start <= today && today <= end) return start < today ? "Devam ediyor" : "Bugün";
  return remainingDayLabel(Math.round((start - today) / 86_400_000));
}

export function addCalendarDays(dateOnly: string, days: number): string | null {
  const parts = validDateOnlyParts(dateOnly);
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12));
  return date.toISOString().slice(0, 10);
}

function formatTemporalEndpoint(value: string, kind: AcademicTemporalKind): string {
  if (kind === "date") {
    const parts = validDateOnlyParts(value);
    if (!parts) return "Tarih belirtilmemiş";
    return turkishDateFormatter.format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tarih belirtilmemiş";
  return turkishTimestampFormatter.format(date);
}

function remainingDurationLabel(difference: number): string {
  if (!Number.isFinite(difference) || difference < 0) return "Süresi geçti";
  const minutes = Math.ceil(difference / 60_000);
  if (minutes < 60) return `${minutes} dakika kaldı`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} saat kaldı`;
  return remainingDayLabel(Math.ceil(hours / 24));
}

function remainingDayLabel(days: number): string {
  if (days < 0) return "Süresi geçti";
  if (days === 0) return "Bugün";
  return days === 1 ? "Yarın" : `${days} gün kaldı`;
}

function istanbulCalendarDayNumber(value: Date): number {
  const timestamp = value.getTime();
  const cached = istanbulDayCache.get(value);
  if (cached?.timestamp === timestamp) return cached.day;

  const parts = istanbulDateParts(value);
  const day = Date.UTC(parts.year, parts.month - 1, parts.day);
  istanbulDayCache.set(value, { timestamp, day });
  return day;
}

function istanbulDateParts(value: Date): { year: number; month: number; day: number } {
  const parts = istanbulDatePartsFormatter.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function validDateOnlyParts(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const validation = new Date(Date.UTC(year, month - 1, day));
  if (
    validation.getUTCFullYear() !== year
    || validation.getUTCMonth() !== month - 1
    || validation.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}
