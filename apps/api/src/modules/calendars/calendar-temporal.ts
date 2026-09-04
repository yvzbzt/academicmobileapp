import { BadRequestException } from "@nestjs/common";
import { ValidateBy, type ValidationOptions } from "class-validator";
import type { AcademicEventDto, AcademicEventTemporalKind } from "../../../../../packages/shared/src/contracts.js";
import {
  STUDENT_RELEVANCE_CLASSIFICATION_VERSION,
  classifyStudentRelevance
} from "../../domain/student-relevance-classifier.js";
import type { AcademicEventRecord, CalendarTemporalFilterBoundary } from "./calendar.types.js";

export const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
export const EXPLICIT_OFFSET_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(?:Z|([+-])(\d{2}):(\d{2}))$/u;
const INVALID_CALENDAR_DATE_MESSAGE = "Calendar date must be a valid YYYY-MM-DD value.";
const INVALID_TEMPORAL_RANGE_MESSAGE = "endDate must not be before startDate.";
const ISTANBUL_TIME_ZONE = "Europe/Istanbul";
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const ISTANBUL_TRANSITION_SEARCH_HOURS = 48;
const istanbulDateTimeFormatter = new Intl.DateTimeFormat("en-GB-u-ca-gregory", {
  timeZone: ISTANBUL_TIME_ZONE,
  era: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

export interface AcademicTemporalFields {
  temporalKind: AcademicEventTemporalKind;
  endTemporalKind?: AcademicEventTemporalKind;
  dateOnlyStart?: string;
  dateOnlyEnd?: string;
  startDate: Date;
  endDate?: Date;
}

export interface AcademicTemporalFilterFields {
  startBoundary?: CalendarTemporalFilterBoundary;
  endBoundary?: CalendarTemporalFilterBoundary;
}

export interface StoredAcademicTemporalFields {
  temporalKind?: AcademicEventTemporalKind;
  endTemporalKind?: AcademicEventTemporalKind;
  dateOnlyStart?: string;
  dateOnlyEnd?: string;
  startDate?: Date;
  endDate?: Date;
}

interface ParsedAcademicTemporalValue {
  kind: AcademicEventTemporalKind;
  date: Date;
  dateOnly?: string;
}

export function IsAcademicTemporalValue(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy({
    name: "isAcademicTemporalValue",
    validator: {
      validate: (value): boolean => isValidAcademicTemporalValue(value),
      defaultMessage: (arguments_): string => `${arguments_?.property ?? "value"} must be a valid YYYY-MM-DD date or a timestamp with an explicit Z or +/-HH:MM offset.`
    }
  }, validationOptions);
}

export function IsExplicitOffsetTimestamp(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy({
    name: "isExplicitOffsetTimestamp",
    validator: {
      validate: (value): boolean => isValidExplicitOffsetTimestamp(value),
      defaultMessage: (arguments_): string => `${arguments_?.property ?? "value"} must be a valid timestamp with an explicit Z or +/-HH:MM offset.`
    }
  }, validationOptions);
}

export function isValidAcademicTemporalValue(value: unknown): value is string {
  return isValidCalendarDate(value) || isValidExplicitOffsetTimestamp(value);
}

export function isValidExplicitOffsetTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = EXPLICIT_OFFSET_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[8] ?? 0);
  const offsetMinute = Number(match[9] ?? 0);
  const syntaxAndPartsAreValid = isValidCalendarDateParts(year, month, day)
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 14
    && offsetMinute <= 59
    && (offsetHour !== 14 || offsetMinute === 0);
  if (!syntaxAndPartsAreValid) return false;

  try {
    const instant = new Date(value);
    const utcYear = instant.getUTCFullYear();
    const istanbulYear = istanbulDateTimeParts(instant).year;
    return !Number.isNaN(instant.getTime())
      && utcYear >= 1
      && utcYear <= 9999
      && istanbulYear >= 1
      && istanbulYear <= 9999;
  } catch {
    return false;
  }
}

export function academicTemporalFields(
  startValue: string,
  endValue?: string
): AcademicTemporalFields {
  const start = parseAcademicTemporalValue(startValue, "startDate", false);
  const end = endValue === undefined
    ? undefined
    : parseAcademicTemporalValue(endValue, "endDate", true);
  if (end) assertOrderedTemporalRange(start, end);

  return {
    temporalKind: start.kind,
    ...(end ? { endTemporalKind: end.kind } : {}),
    ...(start.dateOnly ? { dateOnlyStart: start.dateOnly } : {}),
    ...(end?.dateOnly ? { dateOnlyEnd: end.dateOnly } : {}),
    startDate: start.date,
    ...(end ? { endDate: end.date } : {})
  };
}

export function academicTemporalFilterFields(
  startValue?: string,
  endValue?: string
): AcademicTemporalFilterFields {
  const start = startValue === undefined
    ? undefined
    : parseAcademicTemporalValue(startValue, "startDate", false);
  const end = endValue === undefined
    ? undefined
    : parseAcademicTemporalValue(endValue, "endDate", true);
  if (start && end) assertOrderedTemporalRange(start, end);
  return {
    ...(start ? { startBoundary: toTemporalFilterBoundary(start) } : {}),
    ...(end ? { endBoundary: toTemporalFilterBoundary(end) } : {})
  };
}

export function academicTemporalFieldsFromRecord(record: StoredAcademicTemporalFields): AcademicTemporalFields {
  return academicTemporalFields(
    storedAcademicTemporalStartValue(record),
    storedAcademicTemporalEndValue(record)
  );
}

export function storedAcademicTemporalStartValue(record: StoredAcademicTemporalFields): string {
  return storedTemporalValue(record.temporalKind, record.dateOnlyStart, record.startDate, "startDate");
}

export function storedAcademicTemporalEndValue(record: StoredAcademicTemporalFields): string | undefined {
  if (record.endTemporalKind !== undefined) {
    return storedTemporalValue(record.endTemporalKind, record.dateOnlyEnd, record.endDate, "endDate");
  }
  if (record.temporalKind === "date" && record.dateOnlyEnd !== undefined) {
    return storedTemporalValue("date", record.dateOnlyEnd, record.endDate, "endDate");
  }
  return record.endDate !== undefined
    ? storedTemporalValue("timestamp", undefined, record.endDate, "endDate")
    : undefined;
}

export function compatibilityDateForCalendarDay(dateOnly: string, endOfDay = false): Date {
  requireValidCalendarDate(dateOnly);
  const parsed = new Date(`${dateOnly}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(INVALID_CALENDAR_DATE_MESSAGE);
  return parsed;
}

export function istanbulTimestamp(dateOnly: string, time: string): Date {
  requireValidCalendarDate(dateOnly);
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(time);
  if (!match) {
    throw new BadRequestException("Istanbul timestamp must contain a valid HH:mm time.");
  }
  return instantForIstanbulLocalDateTime(
    dateOnly,
    Number(match[1]),
    Number(match[2]),
    0,
    0,
    "Istanbul timestamp"
  );
}

export function instantBoundaryForIstanbulCalendarDate(dateOnly: string, endOfDay = false): Date {
  requireValidCalendarDate(dateOnly);
  const target = calendarDateParts(dateOnly);
  const localNoonAsUtc = utcMilliseconds({ ...target, hour: 12, minute: 0, second: 0, millisecond: 0 });
  const searchStart = localNoonAsUtc - ISTANBUL_TRANSITION_SEARCH_HOURS * MILLISECONDS_PER_HOUR;
  const searchEnd = localNoonAsUtc + ISTANBUL_TRANSITION_SEARCH_HOURS * MILLISECONDS_PER_HOUR;
  let firstMatchingSample: number | undefined;
  let lastMatchingSample: number | undefined;

  for (let candidate = searchStart; candidate <= searchEnd; candidate += MILLISECONDS_PER_HOUR) {
    if (compareCalendarDateParts(istanbulDateTimeParts(new Date(candidate)), target) === 0) {
      firstMatchingSample ??= candidate;
      lastMatchingSample = candidate;
    }
  }

  if (firstMatchingSample === undefined || lastMatchingSample === undefined) {
    throw new BadRequestException("calendar date boundary is invalid in Europe/Istanbul.");
  }

  if (!endOfDay) {
    return new Date(findIstanbulCalendarDateStart(
      target,
      firstMatchingSample - MILLISECONDS_PER_HOUR,
      firstMatchingSample
    ));
  }
  const firstInstantAfterDate = findFirstInstantAfterIstanbulCalendarDate(
    target,
    lastMatchingSample,
    lastMatchingSample + MILLISECONDS_PER_HOUR
  );
  return new Date(firstInstantAfterDate - 1);
}

export function parseExplicitOffsetTimestamp(value: string, field = "timestamp"): Date {
  const invalidMessage = `${field} must be a valid timestamp with an explicit Z or +/-HH:MM offset.`;
  if (!isValidExplicitOffsetTimestamp(value)) throw new BadRequestException(invalidMessage);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(invalidMessage);
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
    ...(event.courseName ? { courseName: event.courseName } : {}),
    ...(event.description ? { description: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
    temporalKind,
    ...(endTemporalKind ? { endTemporalKind } : {}),
    startDate: temporalStartValue(event),
    ...(endDate ? { endDate } : {}),
    timezone: event.timezone,
    academicYear: event.academicYear,
    term: event.term,
    status: event.status,
    ...(event.classificationVersion === STUDENT_RELEVANCE_CLASSIFICATION_VERSION
      ? classifyStudentRelevance({
          title: event.title,
          ...(event.originalText || event.description || event.courseName
            ? { body: event.originalText ?? event.description ?? event.courseName }
            : {})
        })
      : {})
  };
}

export function istanbulCalendarDate(date: Date): string {
  const parts = istanbulDateTimeParts(date);
  const year = parts.year < 0
    ? `-${String(Math.abs(parts.year)).padStart(4, "0")}`
    : String(parts.year).padStart(4, "0");
  return `${year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function eventIsCurrentOrFuture(event: AcademicEventRecord, fromDate: Date): boolean {
  const fromCalendarDate = istanbulDateTimeParts(fromDate);
  if (event.endTemporalKind === "date" && event.dateOnlyEnd) {
    return compareCalendarDateParts(calendarDateParts(event.dateOnlyEnd), fromCalendarDate) >= 0;
  }
  if (event.endTemporalKind === "timestamp" && event.endDate) {
    return event.endDate.getTime() >= fromDate.getTime();
  }
  if (event.temporalKind === "date" && event.dateOnlyStart) {
    const end = event.dateOnlyEnd ?? event.dateOnlyStart;
    return compareCalendarDateParts(calendarDateParts(end), fromCalendarDate) >= 0;
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

export function eventMatchesTemporalFilters(
  event: AcademicEventRecord,
  startBoundary?: CalendarTemporalFilterBoundary,
  endBoundary?: CalendarTemporalFilterBoundary
): boolean {
  const eventStart = eventStartBoundary(event);
  const eventEnd = eventEndBoundary(event);
  return (!startBoundary || compareTemporalBoundaries(eventEnd, startBoundary) >= 0)
    && (!endBoundary || compareTemporalBoundaries(eventStart, endBoundary) <= 0);
}

function parseAcademicTemporalValue(value: string, field: string, endOfDay: boolean): ParsedAcademicTemporalValue {
  if (DATE_ONLY_PATTERN.test(value)) {
    return {
      kind: "date",
      date: compatibilityDateForCalendarDay(value, endOfDay),
      dateOnly: value
    };
  }
  return { kind: "timestamp", date: parseExplicitOffsetTimestamp(value, field) };
}

function assertOrderedTemporalRange(start: ParsedAcademicTemporalValue, end: ParsedAcademicTemporalValue): void {
  if (compareTemporalBoundaries(toTemporalFilterBoundary(start), toTemporalFilterBoundary(end)) > 0) {
    throw new BadRequestException(INVALID_TEMPORAL_RANGE_MESSAGE);
  }
}

function toTemporalFilterBoundary(value: ParsedAcademicTemporalValue): CalendarTemporalFilterBoundary {
  return value.kind === "date"
    ? { temporalKind: "date", dateOnly: value.dateOnly! }
    : { temporalKind: "timestamp", instant: value.date };
}

function eventStartBoundary(event: AcademicEventRecord): CalendarTemporalFilterBoundary {
  return event.temporalKind === "date" && event.dateOnlyStart
    ? { temporalKind: "date", dateOnly: event.dateOnlyStart }
    : { temporalKind: "timestamp", instant: event.startDate };
}

function eventEndBoundary(event: AcademicEventRecord): CalendarTemporalFilterBoundary {
  if (event.endTemporalKind === "date" && event.dateOnlyEnd) {
    return { temporalKind: "date", dateOnly: event.dateOnlyEnd };
  }
  if (event.endTemporalKind === "timestamp" && event.endDate) {
    return { temporalKind: "timestamp", instant: event.endDate };
  }
  if (event.temporalKind === "date") {
    const dateOnly = event.dateOnlyEnd ?? event.dateOnlyStart;
    if (dateOnly) return { temporalKind: "date", dateOnly };
  }
  return { temporalKind: "timestamp", instant: event.endDate ?? event.startDate };
}

function compareTemporalBoundaries(left: CalendarTemporalFilterBoundary, right: CalendarTemporalFilterBoundary): number {
  if (left.temporalKind === "timestamp" && right.temporalKind === "timestamp") {
    return left.instant.getTime() - right.instant.getTime();
  }
  const leftDate = left.temporalKind === "date" ? calendarDateParts(left.dateOnly) : istanbulDateTimeParts(left.instant);
  const rightDate = right.temporalKind === "date" ? calendarDateParts(right.dateOnly) : istanbulDateTimeParts(right.instant);
  return compareCalendarDateParts(leftDate, rightDate);
}

function storedTemporalValue(
  kind: AcademicEventTemporalKind | undefined,
  dateOnly: string | undefined,
  instant: Date | undefined,
  field: string
): string {
  if (kind === "date") {
    if (!dateOnly) throw new BadRequestException(`${field} must preserve a valid YYYY-MM-DD calendar date.`);
    requireValidCalendarDate(dateOnly);
    return dateOnly;
  }
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new BadRequestException(`${field} must contain a valid stored timestamp.`);
  }
  return instant.toISOString();
}

function instantForIstanbulLocalDateTime(
  dateOnly: string,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  field: string
): Date {
  const dateMatch = DATE_ONLY_PATTERN.exec(dateOnly)!;
  const desired = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour,
    minute,
    second,
    millisecond
  };
  const localAsUtc = utcMilliseconds(desired);
  try {
    const possibleOffsets = new Set<number>();
    for (
      let hours = -ISTANBUL_TRANSITION_SEARCH_HOURS;
      hours <= ISTANBUL_TRANSITION_SEARCH_HOURS;
      hours += 6
    ) {
      possibleOffsets.add(istanbulOffsetMilliseconds(new Date(localAsUtc + hours * MILLISECONDS_PER_HOUR)));
    }

    const matchingInstants = [...possibleOffsets]
      .map((offset) => new Date(localAsUtc - offset))
      .filter((instant) => matchesIstanbulLocalDateTime(instant, desired));
    if (matchingInstants.length !== 1) {
      throw new Error("NONEXISTENT_OR_AMBIGUOUS_LOCAL_TIME");
    }
    return matchingInstants[0]!;
  } catch {
    throw new BadRequestException(`${field} is invalid in Europe/Istanbul.`);
  }
}

function istanbulOffsetMilliseconds(instant: Date): number {
  const parts = istanbulDateTimeParts(instant);
  const representedAsUtc = utcMilliseconds({ ...parts, millisecond: 0 });
  const instantAtWholeSecond = Math.floor(instant.getTime() / 1000) * 1000;
  return representedAsUtc - instantAtWholeSecond;
}

function istanbulDateTimeParts(instant: Date): Omit<Parameters<typeof utcMilliseconds>[0], "millisecond"> {
  const parts = istanbulDateTimeFormatter.formatToParts(instant);
  const numberPart = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (value === undefined) throw new Error(`MISSING_ISTANBUL_${type.toUpperCase()}_PART`);
    return Number(value);
  };
  const yearOfEra = numberPart("year");
  const era = parts.find((part) => part.type === "era")?.value;
  if (era !== "AD" && era !== "BC") throw new Error("MISSING_ISTANBUL_ERA_PART");
  return {
    year: era === "BC" ? 1 - yearOfEra : yearOfEra,
    month: numberPart("month"),
    day: numberPart("day"),
    hour: numberPart("hour"),
    minute: numberPart("minute"),
    second: numberPart("second")
  };
}

function matchesIstanbulLocalDateTime(
  instant: Date,
  desired: Parameters<typeof utcMilliseconds>[0]
): boolean {
  const actual = istanbulDateTimeParts(instant);
  return actual.year === desired.year
    && actual.month === desired.month
    && actual.day === desired.day
    && actual.hour === desired.hour
    && actual.minute === desired.minute
    && actual.second === desired.second
    && instant.getUTCMilliseconds() === desired.millisecond;
}

function calendarDateParts(dateOnly: string): Pick<Parameters<typeof utcMilliseconds>[0], "year" | "month" | "day"> {
  const match = DATE_ONLY_PATTERN.exec(dateOnly);
  if (!match) throw new BadRequestException(INVALID_CALENDAR_DATE_MESSAGE);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function compareCalendarDateParts(
  left: Pick<Parameters<typeof utcMilliseconds>[0], "year" | "month" | "day">,
  right: Pick<Parameters<typeof utcMilliseconds>[0], "year" | "month" | "day">
): number {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

function findIstanbulCalendarDateStart(
  target: Pick<Parameters<typeof utcMilliseconds>[0], "year" | "month" | "day">,
  outside: number,
  inside: number
): number {
  if (
    compareCalendarDateParts(istanbulDateTimeParts(new Date(outside)), target) >= 0
    || compareCalendarDateParts(istanbulDateTimeParts(new Date(inside)), target) !== 0
  ) {
    throw new BadRequestException("calendar date boundary is invalid in Europe/Istanbul.");
  }
  let lower = outside;
  let upper = inside;
  while (upper - lower > 1) {
    const candidate = lower + Math.floor((upper - lower) / 2);
    if (compareCalendarDateParts(istanbulDateTimeParts(new Date(candidate)), target) < 0) lower = candidate;
    else upper = candidate;
  }
  return upper;
}

function findFirstInstantAfterIstanbulCalendarDate(
  target: Pick<Parameters<typeof utcMilliseconds>[0], "year" | "month" | "day">,
  inside: number,
  outside: number
): number {
  if (
    compareCalendarDateParts(istanbulDateTimeParts(new Date(inside)), target) !== 0
    || compareCalendarDateParts(istanbulDateTimeParts(new Date(outside)), target) <= 0
  ) {
    throw new BadRequestException("calendar date boundary is invalid in Europe/Istanbul.");
  }
  let lower = inside;
  let upper = outside;
  while (upper - lower > 1) {
    const candidate = lower + Math.floor((upper - lower) / 2);
    if (compareCalendarDateParts(istanbulDateTimeParts(new Date(candidate)), target) <= 0) lower = candidate;
    else upper = candidate;
  }
  return upper;
}

function utcMilliseconds(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}): number {
  const instant = new Date(0);
  instant.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  instant.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond);
  return instant.getTime();
}

function requireValidCalendarDate(value: string): void {
  if (!isValidCalendarDate(value)) {
    throw new BadRequestException(INVALID_CALENDAR_DATE_MESSAGE);
  }
}

function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_ONLY_PATTERN.exec(value);
  return Boolean(match && isValidCalendarDateParts(Number(match[1]), Number(match[2]), Number(match[3])));
}

function isValidCalendarDateParts(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const days = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day <= days;
}
