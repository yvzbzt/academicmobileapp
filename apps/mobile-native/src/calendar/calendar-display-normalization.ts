import type { AcademicTemporalKind } from "../temporal/academic-temporal";

interface CalendarDisplayTemporal {
  startDate: string;
  endDate?: string;
  temporalKind?: AcademicTemporalKind;
  endTemporalKind?: AcademicTemporalKind;
  timezone?: string;
}

const UTC_DAY_START = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.\d{3})?Z$/u;
const UTC_DAY_END = /^(\d{4}-\d{2}-\d{2})T23:59:59(?:\.\d{3})?Z$/u;

export function normalizeLegacyAllDayCalendarEvent<T extends CalendarDisplayTemporal>(event: T): T {
  if (event.temporalKind !== "timestamp" || event.timezone !== "Europe/Istanbul") return event;

  const start = UTC_DAY_START.exec(event.startDate);
  if (!start) return event;

  const end = event.endDate ? UTC_DAY_END.exec(event.endDate) : null;
  if (event.endDate && (!end || event.endTemporalKind !== "timestamp")) return event;

  return {
    ...event,
    startDate: start[1],
    temporalKind: "date",
    ...(end ? { endDate: end[1], endTemporalKind: "date" as const } : {}),
  };
}
