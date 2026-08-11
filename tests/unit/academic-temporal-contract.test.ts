import { describe, expect, it } from "vitest";
import type { AcademicEventRecord } from "../../apps/api/src/modules/calendars/calendar.types.js";
import { buildUpcomingTemporalQuery } from "../../apps/api/src/modules/calendars/mongo-calendar.repository.js";
import {
  eventIsCurrentOrFuture,
  toAcademicEventDto
} from "../../apps/api/src/modules/calendars/calendar-temporal.js";
import {
  formatAcademicTemporal,
  isAcademicTemporalCurrentOrFuture,
  type AcademicTemporalValue
} from "../../apps/mobile-native/src/temporal/academic-temporal.js";

describe("academic temporal API-to-native contract", () => {
  it("renders an inclusive date-only API range without inventing an Istanbul clock", () => {
    const dto = toAcademicEventDto(event({
      temporalKind: "date",
      endTemporalKind: "date",
      dateOnlyStart: "2026-09-01",
      dateOnlyEnd: "2026-09-03",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-09-03T23:59:59.999Z"),
      courseName: "Veri Yapıları",
      location: "Merkez Kampüs, A Blok 201"
    }));
    const nativePayload = JSON.parse(JSON.stringify(dto)) as AcademicTemporalValue;
    const rendered = formatAcademicTemporal(nativePayload);

    expect(nativePayload).toMatchObject({
      temporalKind: "date",
      endTemporalKind: "date",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      courseName: "Veri Yapıları",
      location: "Merkez Kampüs, A Blok 201"
    });
    expect(rendered).toContain("1 Eylül 2026");
    expect(rendered).toContain("3 Eylül 2026");
    expect(rendered).not.toMatch(/\b(?:00|03):00\b/u);
  });

  it("retains a real timestamp and formats the instant in Europe/Istanbul", () => {
    const dto = toAcademicEventDto(event({
      temporalKind: "timestamp",
      endTemporalKind: "timestamp",
      startDate: new Date("2026-11-10T06:30:00.000Z"),
      endDate: new Date("2026-11-10T08:00:00.000Z")
    }));
    const nativePayload = JSON.parse(JSON.stringify(dto)) as AcademicTemporalValue;
    const rendered = formatAcademicTemporal(nativePayload);

    expect(nativePayload.startDate).toBe("2026-11-10T06:30:00.000Z");
    expect(nativePayload.endDate).toBe("2026-11-10T08:00:00.000Z");
    expect(rendered).toContain("09:30");
    expect(rendered).toContain("11:00");
  });

  it("uses a date-only end for mixed-range liveness through the final Istanbul day", () => {
    const domainEvent = event({
      temporalKind: "timestamp",
      endTemporalKind: "date",
      dateOnlyEnd: "2026-09-03",
      startDate: new Date("2026-09-01T06:30:00.000Z"),
      endDate: new Date("2026-09-03T23:59:59.999Z")
    });
    const nativePayload = JSON.parse(JSON.stringify(toAcademicEventDto(domainEvent))) as AcademicTemporalValue;

    expect(eventIsCurrentOrFuture(domainEvent, new Date("2026-09-03T18:00:00.000Z"))).toBe(true);
    expect(isAcademicTemporalCurrentOrFuture(nativePayload, new Date("2026-09-03T18:00:00.000Z"))).toBe(true);
    expect(eventIsCurrentOrFuture(domainEvent, new Date("2026-09-03T21:00:00.000Z"))).toBe(false);
    expect(isAcademicTemporalCurrentOrFuture(nativePayload, new Date("2026-09-03T21:00:00.000Z"))).toBe(false);
  });

  it("keeps a date-start/timestamp-end range live only through the exact end instant", () => {
    const domainEvent = event({
      temporalKind: "date",
      endTemporalKind: "timestamp",
      dateOnlyStart: "2026-09-01",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-09-03T14:00:00.000Z")
    });
    const nativePayload = JSON.parse(JSON.stringify(toAcademicEventDto(domainEvent))) as AcademicTemporalValue;

    expect(nativePayload).toMatchObject({
      temporalKind: "date",
      endTemporalKind: "timestamp",
      startDate: "2026-09-01",
      endDate: "2026-09-03T14:00:00.000Z"
    });
    expect(eventIsCurrentOrFuture(domainEvent, new Date("2026-09-03T13:59:59.000Z"))).toBe(true);
    expect(isAcademicTemporalCurrentOrFuture(nativePayload, new Date("2026-09-03T13:59:59.000Z"))).toBe(true);
    expect(eventIsCurrentOrFuture(domainEvent, new Date("2026-09-03T14:00:01.000Z"))).toBe(false);
    expect(isAcademicTemporalCurrentOrFuture(nativePayload, new Date("2026-09-03T14:00:01.000Z"))).toBe(false);
  });

  it("builds Mongo upcoming branches from the Istanbul calendar day and exact timestamp", () => {
    const fromDate = new Date("2026-08-03T22:00:00.000Z");
    const branches = buildUpcomingTemporalQuery(fromDate).$or as Array<Record<string, unknown>>;

    expect(branches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        endTemporalKind: "date",
        dateOnlyEnd: { $gte: "2026-08-04" }
      }),
      expect.objectContaining({
        endTemporalKind: "timestamp",
        endDate: { $gte: fromDate }
      }),
      expect.objectContaining({
        temporalKind: "date",
        endTemporalKind: { $exists: false },
        $or: expect.arrayContaining([
          { dateOnlyEnd: { $exists: false }, dateOnlyStart: { $gte: "2026-08-04" } }
        ])
      })
    ]));
  });
});

function event(overrides: Partial<AcademicEventRecord>): AcademicEventRecord {
  return {
    id: "event-1",
    calendarId: "calendar-1",
    universityId: "university-1",
    academicYear: "2026-2027",
    term: "fall",
    category: "course_registration",
    title: "Akademik etkinlik",
    startDate: new Date("2026-09-01T00:00:00.000Z"),
    timezone: "Europe/Istanbul",
    status: "published",
    notificationRules: [],
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides
  };
}
