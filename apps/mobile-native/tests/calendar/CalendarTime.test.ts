import {
  formatCalendarClock,
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
});
