import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  academicTemporalFields,
  academicTemporalFilterFields,
  eventMatchesTemporalFilters,
  instantBoundaryForIstanbulCalendarDate,
  istanbulCalendarDate,
  istanbulTimestamp,
  parseExplicitOffsetTimestamp
} from "../src/modules/calendars/calendar-temporal.js";
import type { AcademicEventRecord } from "../src/modules/calendars/calendar.types.js";
import { buildEventEndOnOrAfterQuery, buildEventStartOnOrBeforeQuery } from "../src/modules/calendars/mongo-calendar.repository.js";

describe("calendar temporal input contract", () => {
  it.each([
    ["2026-08-07T12:00:00Z", "2026-08-07T12:00:00.000Z"],
    ["2026-08-07T12:00:00+03:00", "2026-08-07T09:00:00.000Z"],
    ["2026-08-07T12:00:00-05:00", "2026-08-07T17:00:00.000Z"],
    ["2026-08-07T12:00:00.123Z", "2026-08-07T12:00:00.123Z"],
    ["2026-08-07T12:00:00.456-05:00", "2026-08-07T17:00:00.456Z"]
  ])("parses an explicit-offset instant %s independently of the host timezone", (input, expected) => {
    expect(parseExplicitOffsetTimestamp(input).toISOString()).toBe(expected);
  });

  it.each([
    "2026-08-07T12:00:00",
    "2026-02-30T12:00:00Z",
    "2026-08-07T12:00:00+03",
    "2026-08-07T12:00:00+0300",
    "2026-08-07T12:00:00.1Z",
    "2026-08-07T12:00:00.1234Z",
    "2026-08-07T12:00:00+14:01",
    "2026-08-07T12:00:00+15:00",
    "0000-01-01T12:00:00Z",
    "0001-01-01T00:00:00+14:00",
    "9999-12-31T23:59:59-14:00",
    "9999-12-31T23:00:00Z"
  ])("rejects an invalid or ambiguous instant %s with a controlled error", (input) => {
    expect(() => parseExplicitOffsetTimestamp(input, "startDate"))
      .toThrow(BadRequestException);
  });

  it("preserves an exact date-only value and inclusive ranges", () => {
    const sameDay = academicTemporalFields("2026-08-07", "2026-08-07");
    const multiDay = academicTemporalFields("2026-08-07", "2026-08-10");

    expect(sameDay).toMatchObject({
      temporalKind: "date",
      endTemporalKind: "date",
      dateOnlyStart: "2026-08-07",
      dateOnlyEnd: "2026-08-07",
      startDate: new Date("2026-08-07T00:00:00.000Z"),
      endDate: new Date("2026-08-07T23:59:59.999Z")
    });
    expect(multiDay.dateOnlyStart).toBe("2026-08-07");
    expect(multiDay.dateOnlyEnd).toBe("2026-08-10");
  });

  it.each(["0000-01-01", "2026-02-30", "2025-02-29", "2026-04-31"])("rejects an impossible date-only value %s", (input) => {
    expect(() => academicTemporalFields(input)).toThrow(BadRequestException);
  });

  it("rejects reverse date-only and instant ranges", () => {
    expect(() => academicTemporalFields("2026-08-08", "2026-08-07"))
      .toThrow("endDate must not be before startDate.");
    expect(() => academicTemporalFields("2026-08-08T09:00:00Z", "2026-08-08T08:59:59Z"))
      .toThrow("endDate must not be before startDate.");
  });

  it("orders intentional mixed ranges by the instant's Europe/Istanbul civil date", () => {
    expect(academicTemporalFields("2026-08-07", "2026-08-06T21:01:00Z")).toMatchObject({
      temporalKind: "date",
      endTemporalKind: "timestamp"
    });
    expect(academicTemporalFields("2026-08-07T20:59:59Z", "2026-08-07")).toMatchObject({
      temporalKind: "timestamp",
      endTemporalKind: "date"
    });
    expect(() => academicTemporalFields("2026-08-07", "2026-08-06T20:59:59Z"))
      .toThrow("endDate must not be before startDate.");
    expect(() => academicTemporalFields("2026-08-07T21:00:00Z", "2026-08-07"))
      .toThrow("endDate must not be before startDate.");
  });

  it("pads early Istanbul years and compares valid four-digit boundaries numerically", () => {
    const earlyInstant = new Date("0001-01-01T12:00:00.000Z");

    expect(istanbulCalendarDate(earlyInstant)).toBe("0001-01-01");
    expect(academicTemporalFields("0001-01-01", "0001-01-01T12:00:00Z")).toMatchObject({
      temporalKind: "date",
      endTemporalKind: "timestamp"
    });
    expect(academicTemporalFields("0001-01-01T12:00:00Z", "0001-01-01")).toMatchObject({
      temporalKind: "timestamp",
      endTemporalKind: "date"
    });
  });

  it("rejects nonexistent and ambiguous Istanbul wall-clock values", () => {
    expect(istanbulTimestamp("2015-03-29", "02:30")).toEqual(new Date("2015-03-29T00:30:00.000Z"));
    expect(istanbulTimestamp("2015-03-29", "04:30")).toEqual(new Date("2015-03-29T01:30:00.000Z"));
    expect(() => istanbulTimestamp("2015-03-29", "03:30")).toThrow(BadRequestException);

    expect(istanbulTimestamp("2015-11-08", "02:30")).toEqual(new Date("2015-11-07T23:30:00.000Z"));
    expect(istanbulTimestamp("2015-11-08", "04:30")).toEqual(new Date("2015-11-08T02:30:00.000Z"));
    expect(() => istanbulTimestamp("2015-11-08", "03:30")).toThrow(BadRequestException);
  });

  it.each([
    ["2015-03-29", "2015-03-28T22:00:00.000Z", "2015-03-29T20:59:59.999Z"],
    ["2015-11-08", "2015-11-07T21:00:00.000Z", "2015-11-08T21:59:59.999Z"],
    ["1910-10-01", "1910-09-30T22:03:04.000Z", "1910-10-01T21:59:59.999Z"]
  ])("uses the first and last representable Istanbul instants for civil date %s", (dateOnly, expectedStart, expectedEnd) => {
    const start = instantBoundaryForIstanbulCalendarDate(dateOnly);
    const end = instantBoundaryForIstanbulCalendarDate(dateOnly, true);

    expect(start.toISOString()).toBe(expectedStart);
    expect(end.toISOString()).toBe(expectedEnd);
    expect(istanbulCalendarDate(new Date(start.getTime() - 1))).not.toBe(dateOnly);
    expect(istanbulCalendarDate(start)).toBe(dateOnly);
    expect(istanbulCalendarDate(end)).toBe(dateOnly);
    expect(istanbulCalendarDate(new Date(end.getTime() + 1))).not.toBe(dateOnly);
  });

  it("preserves date-only query boundaries as civil dates", () => {
    expect(academicTemporalFilterFields("2026-08-01", "2026-08-07")).toEqual({
      startBoundary: { temporalKind: "date", dateOnly: "2026-08-01" },
      endBoundary: { temporalKind: "date", dateOnly: "2026-08-07" }
    });
  });

  it("matches a civil-date filter against date records and Istanbul instant boundaries", () => {
    const filters = academicTemporalFilterFields("2026-08-07", "2026-08-07");
    const event = (input: Partial<AcademicEventRecord> & Pick<AcademicEventRecord, "startDate">): AcademicEventRecord => ({
      id: "event",
      calendarId: "calendar",
      universityId: "university",
      academicYear: "2026-2027",
      term: "fall",
      category: "custom_event",
      title: "Temporal boundary",
      timezone: "Europe/Istanbul",
      status: "published",
      notificationRules: [],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...input
    });

    expect(eventMatchesTemporalFilters(event({
      temporalKind: "date",
      dateOnlyStart: "2026-08-06",
      startDate: new Date("2026-08-06T00:00:00.000Z")
    }), filters.startBoundary, filters.endBoundary)).toBe(false);
    expect(eventMatchesTemporalFilters(event({
      temporalKind: "date",
      dateOnlyStart: "2026-08-07",
      startDate: new Date("2026-08-07T00:00:00.000Z")
    }), filters.startBoundary, filters.endBoundary)).toBe(true);
    expect(eventMatchesTemporalFilters(event({ startDate: new Date("2026-08-06T21:00:00.000Z") }), filters.startBoundary, filters.endBoundary)).toBe(true);
    expect(eventMatchesTemporalFilters(event({ startDate: new Date("2026-08-07T20:59:59.999Z") }), filters.startBoundary, filters.endBoundary)).toBe(true);
    expect(eventMatchesTemporalFilters(event({ startDate: new Date("2026-08-07T21:00:00.000Z") }), filters.startBoundary, filters.endBoundary)).toBe(false);
  });

  it("builds Mongo date and instant predicates from the same civil boundary", () => {
    const filters = academicTemporalFilterFields("2026-08-07", "2026-08-07");

    expect(buildEventEndOnOrAfterQuery(filters.startBoundary!)).toEqual(expect.objectContaining({
      $or: expect.arrayContaining([
        { endTemporalKind: "date", dateOnlyEnd: { $gte: "2026-08-07" } },
        { endTemporalKind: "timestamp", endDate: { $gte: new Date("2026-08-06T21:00:00.000Z") } }
      ])
    }));
    expect(buildEventStartOnOrBeforeQuery(filters.endBoundary!)).toEqual(expect.objectContaining({
      $or: expect.arrayContaining([
        { temporalKind: "date", dateOnlyStart: { $lte: "2026-08-07" } },
        { temporalKind: "timestamp", startDate: { $lte: new Date("2026-08-07T20:59:59.999Z") } }
      ])
    }));
  });

  it("keeps missing temporal-kind records on the timestamp fallback in both repositories", () => {
    const filters = academicTemporalFilterFields(undefined, "2026-08-07");
    const legacyEvent = {
      id: "legacy-event",
      calendarId: "calendar",
      universityId: "university",
      academicYear: "2026-2027",
      term: "fall",
      category: "custom_event",
      title: "Legacy timestamp fallback",
      dateOnlyStart: "2026-08-07",
      startDate: new Date("2026-08-07T21:00:00.000Z"),
      timezone: "Europe/Istanbul",
      status: "published",
      notificationRules: [],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z")
    } satisfies AcademicEventRecord;
    expect(eventMatchesTemporalFilters(legacyEvent, undefined, filters.endBoundary)).toBe(false);

    const lowerQuery = buildEventEndOnOrAfterQuery({ temporalKind: "date", dateOnly: "2026-08-07" });
    const lowerMissingKindCases = (lowerQuery.$or as Array<Record<string, unknown>>)
      .filter((candidate) => JSON.stringify(candidate.temporalKind) === JSON.stringify({ $exists: false }));
    expect(lowerMissingKindCases).toEqual([{
      temporalKind: { $exists: false },
      endTemporalKind: { $exists: false },
      $or: [
        { endDate: { $gte: new Date("2026-08-06T21:00:00.000Z") } },
        { endDate: { $exists: false }, startDate: { $gte: new Date("2026-08-06T21:00:00.000Z") } }
      ]
    }]);

    const upperQuery = buildEventStartOnOrBeforeQuery(filters.endBoundary!);
    const upperMissingKindCases = (upperQuery.$or as Array<Record<string, unknown>>)
      .filter((candidate) => JSON.stringify(candidate.temporalKind) === JSON.stringify({ $exists: false }));
    expect(upperMissingKindCases).toEqual([{
      temporalKind: { $exists: false },
      startDate: { $lte: new Date("2026-08-07T20:59:59.999Z") }
    }]);
  });

  it("derives historical Istanbul instants from IANA rules instead of a fixed offset", () => {
    const filters = academicTemporalFilterFields(undefined, "2015-01-01");
    const event = {
      id: "historical-event",
      calendarId: "calendar",
      universityId: "university",
      academicYear: "2014-2015",
      term: "fall",
      category: "custom_event",
      title: "Historical Istanbul boundary",
      temporalKind: "timestamp",
      startDate: new Date("2015-01-01T21:30:00.000Z"),
      timezone: "Europe/Istanbul",
      status: "published",
      notificationRules: [],
      createdAt: new Date("2015-01-01T00:00:00.000Z"),
      updatedAt: new Date("2015-01-01T00:00:00.000Z")
    } satisfies AcademicEventRecord;

    expect(istanbulTimestamp("2015-01-01", "23:30")).toEqual(new Date("2015-01-01T21:30:00.000Z"));
    expect(eventMatchesTemporalFilters(event, undefined, filters.endBoundary)).toBe(true);
    expect(buildEventStartOnOrBeforeQuery(filters.endBoundary!)).toEqual(expect.objectContaining({
      $or: expect.arrayContaining([
        { temporalKind: "timestamp", startDate: { $lte: new Date("2015-01-01T21:59:59.999Z") } }
      ])
    }));
  });
});
