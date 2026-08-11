import type { NativeCalendarSyncEvent } from "./types";

export type AcademicCalendarEventInput = {
  id: string;
  title: string;
  category?: string;
  startDate: string;
  endDate?: string;
  temporalKind?: "date" | "timestamp";
  endTemporalKind?: "date" | "timestamp";
  timezone?: string;
  description?: string;
  location?: string;
  url?: string;
  recurrenceRule?: NativeCalendarSyncEvent["recurrenceRule"];
};

export type ManualExamEventInput = {
  id: string;
  title: string;
  examDate: string;
  locationNote?: string;
};

export type NativeCalendarMappingOptions = {
  timezone?: string;
  reminderMinutesBefore?: number[];
  categoryLabel?: (category: string) => string;
};

const DEFAULT_TIMEZONE = "Europe/Istanbul";

export function mapAcademicEventsToNativeCalendarEvents(
  events: AcademicCalendarEventInput[],
  options: NativeCalendarMappingOptions = {}
): NativeCalendarSyncEvent[] {
  return events.flatMap((event) => {
    const startIsDateOnly = event.temporalKind === "date"
      || (event.temporalKind === undefined && isExactDateOnly(event.startDate));
    const endKind = event.endTemporalKind
      ?? (event.endDate && isExactDateOnly(event.endDate) ? "date" : "timestamp");
    const hasTimestampEnd = endKind === "timestamp" && Boolean(event.endDate);
    const allDay = startIsDateOnly && !hasTimestampEnd;
    const startDate = allDay
      ? normalizeCalendarDate(event.startDate)
      : startIsDateOnly
        ? normalizeIstanbulCalendarStart(event.startDate)
        : normalizeTimestamp(event.startDate);
    if (!startDate) return [];

    const endDate = normalizeEventEndDate(startDate, event, allDay);
    const category = event.category ?? "academic_event";
    const categoryLabel = options.categoryLabel?.(category) ?? category;

    return [
      stripUndefined({
        id: `academic:${event.id}`,
        title: event.title,
        startDate,
        endDate,
        allDay,
        timezone: options.timezone ?? event.timezone ?? DEFAULT_TIMEZONE,
        notes: event.description ?? `Academic event category: ${categoryLabel}`,
        location: event.location,
        url: event.url,
        category,
        recurrenceRule: event.recurrenceRule,
        reminderMinutesBefore: options.reminderMinutesBefore ?? []
      })
    ];
  });
}

export function mapManualExamsToNativeCalendarEvents(
  exams: ManualExamEventInput[],
  options: NativeCalendarMappingOptions = {}
): NativeCalendarSyncEvent[] {
  return exams.flatMap((exam) => {
    const startDate = normalizeTimestamp(exam.examDate);
    if (!startDate) return [];

    return [
      {
        id: `manual-exam:${exam.id}`,
        title: exam.title,
        startDate,
        endDate: addMinutes(startDate, 60),
        allDay: false,
        timezone: options.timezone ?? DEFAULT_TIMEZONE,
        notes: "Manual exam reminder",
        location: exam.locationNote,
        category: "manual_exam",
        reminderMinutesBefore: options.reminderMinutesBefore ?? []
      }
    ];
  });
}

export function normalizeReminderMinutes(value: number): number[] {
  if (!Number.isFinite(value) || value < 0) return [];
  return [Math.max(0, Math.round(value))];
}

function normalizeTimestamp(input: string): string | null {
  if (isExactDateOnly(input)) return null;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeCalendarDate(input: string): string | null {
  if (!isExactDateOnly(input)) return null;
  return `${input}T00:00:00.000Z`;
}

function normalizeIstanbulCalendarStart(input: string): string | null {
  if (!isExactDateOnly(input)) return null;
  return new Date(`${input}T00:00:00.000+03:00`).toISOString();
}

function normalizeEventEndDate(
  startIsoDate: string,
  event: AcademicCalendarEventInput,
  allDay: boolean
): string {
  const inferredEndKind = event.endTemporalKind
    ?? (event.endDate && isExactDateOnly(event.endDate) ? "date" : "timestamp");
  if (allDay) {
    const inclusiveEnd = inferredEndKind === "date" && event.endDate
      ? normalizeCalendarDate(event.endDate)
      : null;
    return addDays(inclusiveEnd ?? startIsoDate, 1);
  }
  if (inferredEndKind === "date" && event.endDate) {
    const exclusiveEnd = exclusiveIstanbulEnd(event.endDate);
    if (exclusiveEnd && Date.parse(exclusiveEnd) > Date.parse(startIsoDate)) return exclusiveEnd;
  }
  const parsedEndDate = event.endDate ? normalizeTimestamp(event.endDate) : null;
  if (parsedEndDate && Date.parse(parsedEndDate) > Date.parse(startIsoDate)) return parsedEndDate;
  return addMinutes(startIsoDate, 60);
}

function isExactDateOnly(input: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input)) return false;
  const parsed = new Date(`${input}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === input;
}

function exclusiveIstanbulEnd(inclusiveEnd: string): string | null {
  const normalized = normalizeCalendarDate(inclusiveEnd);
  if (!normalized) return null;
  const exclusiveDate = addDays(normalized, 1).slice(0, 10);
  return new Date(`${exclusiveDate}T00:00:00.000+03:00`).toISOString();
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function addMinutes(isoDate: string, minutes: number): string {
  const date = new Date(isoDate);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString();
}

function stripUndefined(event: NativeCalendarSyncEvent): NativeCalendarSyncEvent {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (value !== undefined) next[key] = value;
  }
  return next as NativeCalendarSyncEvent;
}
