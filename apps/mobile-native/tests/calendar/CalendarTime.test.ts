import {
  formatCalendarClock,
  formatCalendarDateRange,
  formatCalendarTemporal,
} from "../../src/calendar/calendar-time";

describe("calendar event time formatting", () => {
  it("renders an absolute timestamp in the event's Europe/Istanbul timezone", () => {
    expect(formatCalendarClock(
      "2026-08-11T07:00:00.000Z",
      "timestamp",
      "Europe/Istanbul",
    )).toBe("10:00");

    const range = formatCalendarTemporal({
      startDate: "2026-08-11T07:00:00.000Z",
      endDate: "2026-08-11T09:00:00.000Z",
      temporalKind: "timestamp",
      endTemporalKind: "timestamp",
      timezone: "Europe/Istanbul",
    });
    expect(range).toContain("10:00");
    expect(range).toContain("12:00");
    expect(range).not.toContain("07:00");
  });

  it("keeps exact date-only values all-day without inventing midnight", () => {
    expect(formatCalendarClock("2026-08-11", "date", "Europe/Istanbul")).toBe("Tüm gün");
    expect(formatCalendarTemporal({
      startDate: "2026-08-11",
      temporalKind: "date",
      timezone: "Europe/Istanbul",
    })).not.toMatch(/00:00/u);
  });

  it("preserves all-day and cross-midnight date spans without duplicating clock copy", () => {
    expect(formatCalendarDateRange({
      startDate: "2026-08-31",
      endDate: "2026-09-04",
      temporalKind: "date",
      endTemporalKind: "date",
    })).toBe("31 Ağustos 2026 – 4 Eylül 2026");

    expect(formatCalendarDateRange({
      startDate: "2026-08-02T20:00:00.000Z",
      endDate: "2026-08-03T08:00:00.000Z",
      temporalKind: "timestamp",
      endTemporalKind: "timestamp",
      timezone: "Europe/Istanbul",
    })).toBe("2 Ağustos 2026 – 3 Ağustos 2026");
  });
});
