export const DEFAULT_NATIVE_CALENDAR_TIMEZONE = "Europe/Istanbul";

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

type CalendarDateTimeParts = CalendarDateParts & {
  hour: number;
  minute: number;
  second: number;
};

export function isExactCalendarDate(value: string): boolean {
  const parsed = parseCalendarDate(value);
  if (!parsed) return false;
  return formatCalendarDate(parsed) === value;
}

export function addCalendarDays(value: string, days: number): string {
  const parsed = parseCalendarDate(value);
  if (!parsed || !Number.isInteger(days)) throw new Error("Invalid calendar date.");

  const date = new Date(utcMillis(parsed));
  date.setUTCDate(date.getUTCDate() + days);
  return formatCalendarDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  });
}

/** Converts a calendar-local midnight to an absolute ISO instant without using the device timezone. */
export function calendarDateToISOString(value: string, timezone: string): string {
  const target = parseCalendarDate(value);
  if (!target) throw new Error("Invalid calendar date.");

  const targetWallClock = utcMillis({ ...target, hour: 0, minute: 0, second: 0 });
  let candidate = targetWallClock;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const represented = zonedDateTimeParts(new Date(candidate), timezone);
    const representedWallClock = utcMillis(represented);
    const adjustment = targetWallClock - representedWallClock;
    candidate += adjustment;
    if (adjustment === 0) return new Date(candidate).toISOString();
  }

  const finalParts = zonedDateTimeParts(new Date(candidate), timezone);
  if (
    finalParts.year !== target.year
    || finalParts.month !== target.month
    || finalParts.day !== target.day
    || finalParts.hour !== 0
    || finalParts.minute !== 0
  ) {
    throw new Error(`Calendar date has no representable midnight in ${timezone}.`);
  }
  return new Date(candidate).toISOString();
}

export function instantToCalendarDate(value: string | Date, timezone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid calendar instant.");
  const parts = zonedDateTimeParts(date, timezone);
  return formatCalendarDate(parts);
}

export function normalizeCalendarTimestamp(value: string): string | null {
  if (isExactCalendarDate(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseCalendarDate(value: string): CalendarDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(utcMillis({ year, month, day }));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function formatCalendarDate(parts: CalendarDateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function zonedDateTimeParts(date: Date, timezone: string): CalendarDateTimeParts {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
  } catch {
    throw new Error(`Invalid calendar timezone: ${timezone}.`);
  }

  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  const year = values.year;
  const month = values.month;
  const day = values.day;
  const minute = values.minute;
  const second = values.second;
  const rawHour = values.hour;
  if ([year, month, day, rawHour, minute, second].some((value) => !Number.isFinite(value))) {
    throw new Error(`Calendar timezone could not be evaluated: ${timezone}.`);
  }

  return {
    year: year!,
    month: month!,
    day: day!,
    hour: rawHour === 24 ? 0 : rawHour!,
    minute: minute!,
    second: second!
  };
}

function utcMillis(parts: CalendarDateParts & Partial<Pick<CalendarDateTimeParts, "hour" | "minute" | "second">>): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, 0);
  return date.getTime();
}
