import { normalizeLegacyAllDayCalendarEvent } from "../../src/calendar/calendar-display-normalization";

describe("calendar display normalization", () => {
  it("restores legacy UTC day boundaries as all-day dates", () => {
    expect(normalizeLegacyAllDayCalendarEvent({
      startDate: "2026-08-13T00:00:00.000Z",
      endDate: "2026-08-17T23:59:59.000Z",
      temporalKind: "timestamp",
      endTemporalKind: "timestamp",
      timezone: "Europe/Istanbul",
    })).toEqual({
      startDate: "2026-08-13",
      endDate: "2026-08-17",
      temporalKind: "date",
      endTemporalKind: "date",
      timezone: "Europe/Istanbul",
    });
  });

  it("restores a single legacy midnight boundary as an all-day date", () => {
    expect(normalizeLegacyAllDayCalendarEvent({
      startDate: "2026-08-13T00:00:00.000Z",
      temporalKind: "timestamp",
      timezone: "Europe/Istanbul",
    })).toMatchObject({
      startDate: "2026-08-13",
      temporalKind: "date",
    });
  });

  it("preserves real timed events and non-Istanbul timestamps", () => {
    const timed = {
      startDate: "2026-08-13T09:30:00.000Z",
      endDate: "2026-08-13T11:00:00.000Z",
      temporalKind: "timestamp" as const,
      endTemporalKind: "timestamp" as const,
      timezone: "Europe/Istanbul",
    };
    const midnightUtc = {
      startDate: "2026-08-13T00:00:00.000Z",
      temporalKind: "timestamp" as const,
      timezone: "UTC",
    };

    expect(normalizeLegacyAllDayCalendarEvent(timed)).toBe(timed);
    expect(normalizeLegacyAllDayCalendarEvent(midnightUtc)).toBe(midnightUtc);
  });
});
