import {
  isDateOnlyValue,
  type AcademicTemporalKind,
} from "../temporal/academic-temporal";

export const DEFAULT_ACADEMIC_EVENT_TIMEZONE = "Europe/Istanbul";
const timestampFormatterCache = new Map<string, Intl.DateTimeFormat>();
const dateOnlyFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export interface CalendarTemporalDisplayValue {
  startDate: string;
  endDate?: string;
  temporalKind?: AcademicTemporalKind;
  endTemporalKind?: AcademicTemporalKind;
  timezone?: string;
}

export function formatCalendarClock(
  value: string,
  temporalKind?: AcademicTemporalKind,
  timezone?: string,
): string {
  if (temporalKind === "date" || isDateOnlyValue(value)) return "Tüm gün";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Saat yok";
  return timestampFormatter(timezone, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Formats only the calendar date span while preserving the event timezone. */
export function formatCalendarDateRange(value: CalendarTemporalDisplayValue): string {
  const startKind = value.temporalKind
    ?? (isDateOnlyValue(value.startDate) ? "date" : "timestamp");
  const endKind = value.endDate
    ? value.endTemporalKind ?? (isDateOnlyValue(value.endDate) ? "date" : startKind)
    : undefined;
  const start = formatCalendarDateEndpoint(value.startDate, startKind, value.timezone);
  if (!value.endDate) return start;
  const end = formatCalendarDateEndpoint(value.endDate, endKind ?? startKind, value.timezone);
  return end === start ? start : `${start} – ${end}`;
}

export function formatCalendarTemporal(value: CalendarTemporalDisplayValue): string {
  const startKind = value.temporalKind
    ?? (isDateOnlyValue(value.startDate) ? "date" : "timestamp");
  const endKind = value.endDate
    ? value.endTemporalKind ?? (isDateOnlyValue(value.endDate) ? "date" : startKind)
    : undefined;
  const start = formatCalendarTemporalEndpoint(value.startDate, startKind, value.timezone);
  if (!value.endDate || value.endDate === value.startDate) return start;
  const end = formatCalendarTemporalEndpoint(value.endDate, endKind ?? startKind, value.timezone);
  return `${start} – ${end}`;
}

function formatCalendarTemporalEndpoint(
  value: string,
  temporalKind: AcademicTemporalKind,
  timezone?: string,
): string {
  if (temporalKind === "date") {
    const dateOnly = dateOnlyAtNoonUtc(value);
    if (!dateOnly) return "Tarih belirtilmemiş";
    return dateOnlyFormatter.format(dateOnly);
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Tarih belirtilmemiş";
  return timestampFormatter(timezone, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function timestampFormatter(
  timezone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const resolvedTimezone = timezone?.trim() || DEFAULT_ACADEMIC_EVENT_TIMEZONE;
  const cacheKey = `${resolvedTimezone}:${JSON.stringify(options)}`;
  const cached = timestampFormatterCache.get(cacheKey);
  if (cached) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("tr-TR", {
      ...options,
      timeZone: resolvedTimezone,
    });
  } catch {
    formatter = new Intl.DateTimeFormat("tr-TR", {
      ...options,
      timeZone: DEFAULT_ACADEMIC_EVENT_TIMEZONE,
    });
  }
  if (timestampFormatterCache.size >= 32) timestampFormatterCache.clear();
  timestampFormatterCache.set(cacheKey, formatter);
  return formatter;
}

function formatCalendarDateEndpoint(
  value: string,
  temporalKind: AcademicTemporalKind,
  timezone?: string,
): string {
  if (temporalKind === "date") {
    const dateOnly = dateOnlyAtNoonUtc(value);
    return dateOnly ? dateOnlyFormatter.format(dateOnly) : "Tarih belirtilmemiş";
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Tarih belirtilmemiş";
  return timestampFormatter(timezone, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function dateOnlyAtNoonUtc(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null;
}
