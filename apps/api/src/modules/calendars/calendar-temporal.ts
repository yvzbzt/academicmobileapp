import type { AcademicEventDto, AcademicEventTemporalKind } from "../../../../../packages/shared/src/contracts.js";
import type { AcademicEventRecord } from "./calendar.types.js";

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export interface AcademicTemporalFields {
  temporalKind: AcademicEventTemporalKind;
  endTemporalKind?: AcademicEventTemporalKind;
  dateOnlyStart?: string;
  dateOnlyEnd?: string;
  startDate: Date;
  endDate?: Date;
}

export function academicTemporalFields(
  startValue: string,
  endValue?: string
): AcademicTemporalFields {
  const startIsDateOnly = DATE_ONLY_PATTERN.test(startValue);
  const endIsDateOnly = Boolean(endValue && DATE_ONLY_PATTERN.test(endValue));
  const startDate = startIsDateOnly
    ? compatibilityDateForCalendarDay(startValue)
    : requireValidTimestamp(startValue);
  const endDate = endValue
    ? endIsDateOnly
      ? compatibilityDateForCalendarDay(endValue, true)
      : requireValidTimestamp(endValue)
    : undefined;

  return {
    temporalKind: startIsDateOnly ? "date" : "timestamp",
    ...(endValue ? { endTemporalKind: endIsDateOnly ? "date" : "timestamp" } : {}),
    ...(startIsDateOnly ? { dateOnlyStart: startValue } : {}),
    ...(endValue && endIsDateOnly ? { dateOnlyEnd: endValue } : {}),
    startDate,
    ...(endDate ? { endDate } : {})
  };
}

export function compatibilityDateForCalendarDay(dateOnly: string, endOfDay = false): Date {
  if (!DATE_ONLY_PATTERN.test(dateOnly)) throw new Error("INVALID_CALENDAR_DATE");
  const parsed = new Date(`${dateOnly}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateOnly) {
    throw new Error("INVALID_CALENDAR_DATE");
  }
  return parsed;
}

export function istanbulTimestamp(dateOnly: string, time: string): Date {
  if (!DATE_ONLY_PATTERN.test(dateOnly) || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(time)) {
    throw new Error("INVALID_ISTANBUL_TIMESTAMP");
  }
  const parsed = new Date(`${dateOnly}T${time}:00.000+03:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_ISTANBUL_TIMESTAMP");
  return parsed;
}

export function temporalStartValue(event: AcademicEventRecord): string {
  return event.temporalKind === "date" && event.dateOnlyStart
    ? event.dateOnlyStart
    : event.startDate.toISOString();
}

export function temporalEndValue(event: AcademicEventRecord): string | undefined {
  if (event.endTemporalKind === "date" && event.dateOnlyEnd) return event.dateOnlyEnd;
  if (event.temporalKind === "date" && event.dateOnlyEnd) return event.dateOnlyEnd;
  return event.endDate?.toISOString();
}

export function toAcademicEventDto(event: AcademicEventRecord): AcademicEventDto {
  const temporalKind = event.temporalKind === "date" && event.dateOnlyStart ? "date" : "timestamp";
  const endDate = temporalEndValue(event);
  const endTemporalKind = endDate
    ? event.endTemporalKind ?? (event.temporalKind === "date" ? "date" : "timestamp")
    : undefined;
  return {
    id: event.id,
    universityId: event.universityId,
    calendarId: event.calendarId,
    category: event.category,
    title: event.title,
    ...(event.description ? { description: event.description } : {}),
    temporalKind,
    ...(endTemporalKind ? { endTemporalKind } : {}),
    startDate: temporalStartValue(event),
    ...(endDate ? { endDate } : {}),
    timezone: event.timezone,
    academicYear: event.academicYear,
    term: event.term,
    status: event.status
  };
}

export function istanbulCalendarDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function eventIsCurrentOrFuture(event: AcademicEventRecord, fromDate: Date): boolean {
  if (event.endTemporalKind === "date" && event.dateOnlyEnd) {
    return event.dateOnlyEnd >= istanbulCalendarDate(fromDate);
  }
  if (event.endTemporalKind === "timestamp" && event.endDate) {
    return event.endDate.getTime() >= fromDate.getTime();
  }
  if (event.temporalKind === "date" && event.dateOnlyStart) {
    const end = event.dateOnlyEnd ?? event.dateOnlyStart;
    return end >= istanbulCalendarDate(fromDate);
  }
  return (event.endDate ?? event.startDate).getTime() >= fromDate.getTime();
}

export function compareEventStart(left: AcademicEventRecord, right: AcademicEventRecord): number {
  const leftKey = left.temporalKind === "date" && left.dateOnlyStart
    ? `${left.dateOnlyStart}T00:00:00.000Z`
    : left.startDate.toISOString();
  const rightKey = right.temporalKind === "date" && right.dateOnlyStart
    ? `${right.dateOnlyStart}T00:00:00.000Z`
    : right.startDate.toISOString();
  return leftKey.localeCompare(rightKey) || left.title.localeCompare(right.title, "tr-TR");
}

function requireValidTimestamp(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_EVENT_TIMESTAMP");
  return parsed;
}
