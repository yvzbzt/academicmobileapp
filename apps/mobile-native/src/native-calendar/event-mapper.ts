import type { NativeCalendarSyncEvent } from "./types";
import {
  DEFAULT_NATIVE_CALENDAR_TIMEZONE,
  addCalendarDays,
  calendarDateToISOString,
  isExactCalendarDate,
  normalizeCalendarTimestamp
} from "./calendar-date";
import { normalizeReminderOffsets } from "./managed-event";

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

export function mapAcademicEventsToNativeCalendarEvents(
  events: AcademicCalendarEventInput[],
  options: NativeCalendarMappingOptions = {}
): NativeCalendarSyncEvent[] {
  return events.flatMap((event) => {
    const timezone = options.timezone ?? event.timezone ?? DEFAULT_NATIVE_CALENDAR_TIMEZONE;
    const startIsDateOnly = event.temporalKind === "date"
      || (event.temporalKind === undefined && isExactCalendarDate(event.startDate));
    const endKind = event.endTemporalKind
      ?? (event.endDate && isExactCalendarDate(event.endDate) ? "date" : "timestamp");
    const hasTimestampEnd = endKind === "timestamp" && Boolean(event.endDate);
    const allDay = startIsDateOnly && !hasTimestampEnd;
    const startDate = allDay
      ? (isExactCalendarDate(event.startDate) ? event.startDate : null)
      : startIsDateOnly
        ? normalizeCalendarStart(event.startDate, timezone)
        : normalizeCalendarTimestamp(event.startDate);
    if (!startDate) return [];

    const endDate = normalizeEventEndDate(startDate, event, allDay, timezone);
    const category = event.category ?? "academic_event";
    const categoryLabel = options.categoryLabel?.(category) ?? category;

    return [
      stripUndefined({
        id: `academic:${event.id}`,
        sourceId: event.id,
        sourceType: "academic_event",
        title: event.title,
        startDate,
        endDate,
        allDay,
        timezone,
        notes: event.description ?? `Academic event category: ${categoryLabel}`,
        location: event.location,
        sourceUrl: event.url,
        category,
        recurrenceRule: event.recurrenceRule,
        reminderMinutesBefore: normalizeReminderOffsets(options.reminderMinutesBefore)
      })
    ];
  });
}

export function mapManualExamsToNativeCalendarEvents(
  exams: ManualExamEventInput[],
  options: NativeCalendarMappingOptions = {}
): NativeCalendarSyncEvent[] {
  return exams.flatMap((exam) => {
    const startDate = normalizeCalendarTimestamp(exam.examDate);
    if (!startDate) return [];

    return [
      {
        id: `manual-exam:${exam.id}`,
        sourceId: exam.id,
        sourceType: "manual_exam",
        title: exam.title,
        startDate,
        endDate: addMinutes(startDate, 60),
        allDay: false,
        timezone: options.timezone ?? DEFAULT_NATIVE_CALENDAR_TIMEZONE,
        notes: "Manual exam reminder",
        location: exam.locationNote,
        category: "manual_exam",
        reminderMinutesBefore: normalizeReminderOffsets(options.reminderMinutesBefore)
      }
    ];
  });
}

export function normalizeReminderMinutes(value: number): number[] {
  if (!Number.isFinite(value) || value < 0) return [];
  return [Math.max(0, Math.round(value))];
}

function normalizeCalendarStart(input: string, timezone: string): string | null {
  if (!isExactCalendarDate(input)) return null;
  try {
    return calendarDateToISOString(input, timezone);
  } catch {
    return null;
  }
}

function normalizeEventEndDate(
  startIsoDate: string,
  event: AcademicCalendarEventInput,
  allDay: boolean,
  timezone: string
): string {
  const inferredEndKind = event.endTemporalKind
    ?? (event.endDate && isExactCalendarDate(event.endDate) ? "date" : "timestamp");
  if (allDay) {
    const inclusiveEnd = inferredEndKind === "date" && event.endDate && isExactCalendarDate(event.endDate)
      ? event.endDate
      : startIsoDate;
    return addCalendarDays(inclusiveEnd, 1);
  }
  if (inferredEndKind === "date" && event.endDate) {
    const exclusiveEnd = exclusiveCalendarEnd(event.endDate, timezone);
    if (exclusiveEnd && Date.parse(exclusiveEnd) > Date.parse(startIsoDate)) return exclusiveEnd;
  }
  const parsedEndDate = event.endDate ? normalizeCalendarTimestamp(event.endDate) : null;
  if (parsedEndDate && Date.parse(parsedEndDate) > Date.parse(startIsoDate)) return parsedEndDate;
  return addMinutes(startIsoDate, 60);
}

function exclusiveCalendarEnd(inclusiveEnd: string, timezone: string): string | null {
  if (!isExactCalendarDate(inclusiveEnd)) return null;
  try {
    return calendarDateToISOString(addCalendarDays(inclusiveEnd, 1), timezone);
  } catch {
    return null;
  }
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
