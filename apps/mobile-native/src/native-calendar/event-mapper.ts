import type { NativeCalendarSyncEvent } from "./types";

export type AcademicCalendarEventInput = {
  id: string;
  title: string;
  category?: string;
  startDate: string;
  endDate?: string;
  description?: string;
  url?: string;
  recurrenceRule?: NativeCalendarSyncEvent["recurrenceRule"];
};

export type ManualExamEventInput = {
  id: string;
  title: string;
  examDate: string;
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
    const startDate = normalizeDateInput(event.startDate);
    if (!startDate) return [];

    const allDay = isAllDayCandidate(event.startDate);
    const endDate = normalizeEventEndDate(startDate, event.endDate, allDay);
    const category = event.category ?? "academic_event";
    const categoryLabel = options.categoryLabel?.(category) ?? category;

    return [
      stripUndefined({
        id: `academic:${event.id}`,
        title: event.title,
        startDate,
        endDate,
        allDay,
        timezone: options.timezone ?? DEFAULT_TIMEZONE,
        notes: event.description ?? `Academic event category: ${categoryLabel}`,
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
    const startDate = normalizeDateInput(exam.examDate);
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

function normalizeDateInput(input: string): string | null {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeEventEndDate(startIsoDate: string, inputEndDate: string | undefined, allDay: boolean): string {
  const parsedEndDate = inputEndDate ? new Date(inputEndDate) : null;
  if (parsedEndDate && !Number.isNaN(parsedEndDate.getTime())) return parsedEndDate.toISOString();

  return allDay ? addDays(startIsoDate, 1) : addMinutes(startIsoDate, 60);
}

function isAllDayCandidate(input: string): boolean {
  return !/T\d{2}:\d{2}/.test(input);
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
