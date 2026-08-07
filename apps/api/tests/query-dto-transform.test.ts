import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { AnnouncementSourcesQueryDto, MyAnnouncementsQueryDto } from "../src/modules/announcements/announcements.dto.js";
import { CreateManualCalendarDto } from "../src/modules/calendars/admin-calendar.dto.js";
import { SearchEventsQueryDto, UpcomingEventsQueryDto } from "../src/modules/calendars/calendar.dto.js";
import { ListUniversitiesQueryDto } from "../src/modules/catalog/catalog.dto.js";
import { CreateStudentAlarmDto } from "../src/modules/notifications/notifications.dto.js";
import { ListExtractedEventsQueryDto, UpdateExtractedEventDto } from "../src/modules/pdf/pdf.dto.js";

describe("numeric query DTO transforms", () => {
  it.each([
    [ListUniversitiesQueryDto, { limit: "2", offset: "0" }],
    [MyAnnouncementsQueryDto, { limit: "10" }],
    [AnnouncementSourcesQueryDto, { limit: "20", offset: "5" }],
    [UpcomingEventsQueryDto, { limit: "8" }],
    [SearchEventsQueryDto, { limit: "25", offset: "10" }],
    [ListExtractedEventsQueryDto, { limit: "50", offset: "0" }]
  ])("converts numeric URL values for %s", async (Dto, input) => {
    const query = plainToInstance(Dto, input) as { limit?: number; offset?: number };

    expect(query.limit).toBe(Number(input.limit));
    if ("offset" in input) expect(query.offset).toBe(Number(input.offset));
    expect(await validate(query)).toEqual([]);
  });
});

describe("temporal DTO validation", () => {
  it("accepts strict manual calendar date-only and explicit-offset values", async () => {
    const input = plainToInstance(CreateManualCalendarDto, {
      universityId: "university-1",
      academicYear: "2026-2027",
      title: "Manual calendar",
      events: [{
        title: "Timed event",
        category: "course_registration",
        term: "fall",
        startDate: "2026-08-07",
        endDate: "2026-08-07T17:00:00.123+03:00"
      }]
    });

    expect(await validate(input)).toEqual([]);
  });

  it("rejects invalid manual and PDF edit temporal values before service execution", async () => {
    const manual = plainToInstance(CreateManualCalendarDto, {
      universityId: "university-1",
      academicYear: "2026-2027",
      title: "Manual calendar",
      events: [{
        title: "Invalid event",
        category: "course_registration",
        term: "fall",
        startDate: "2026-08-07T12:00:00.1Z"
      }]
    });
    const pdfEdit = plainToInstance(UpdateExtractedEventDto, {
      endDate: "2026-08-07T12:00:00.1234Z"
    });
    const nullManual = plainToInstance(CreateManualCalendarDto, {
      universityId: "university-1",
      academicYear: "2026-2027",
      title: "Manual calendar",
      events: [{
        title: "Null range",
        category: "course_registration",
        term: "fall",
        startDate: "2026-08-07",
        endDate: null
      }]
    });
    const nullSearch = plainToInstance(SearchEventsQueryDto, { startDate: null });
    const nullPdfEdit = plainToInstance(UpdateExtractedEventDto, { endDate: null });

    expect((await validate(manual)).length).toBeGreaterThan(0);
    expect((await validate(pdfEdit)).length).toBeGreaterThan(0);
    expect((await validate(nullManual)).length).toBeGreaterThan(0);
    expect((await validate(nullSearch)).length).toBeGreaterThan(0);
    expect((await validate(nullPdfEdit)).length).toBeGreaterThan(0);
  });

  it("validates public search dates and rejects ambiguous or impossible values", async () => {
    expect(await validate(plainToInstance(SearchEventsQueryDto, {
      startDate: "2026-08-07",
      endDate: "2026-08-08T12:00:00-05:00"
    }))).toEqual([]);
    for (const startDate of ["2026-08-07T12:00:00", "2026-02-30"]) {
      expect((await validate(plainToInstance(SearchEventsQueryDto, { startDate }))).length)
        .toBeGreaterThan(0);
    }
  });

  it("requires notification scheduledFor to be an explicit instant with zero or three fractional digits", async () => {
    const alarm = (scheduledFor: string) => plainToInstance(CreateStudentAlarmDto, {
      eventType: "announcement",
      targetId: "announcement-1",
      scheduledFor,
      trigger: "at_time",
      amount: 0,
      unit: "days"
    });

    expect(await validate(alarm("2026-08-07T12:00:00.123Z"))).toEqual([]);
    for (const scheduledFor of [
      "2026-08-07",
      "2026-08-07T12:00:00",
      "2026-08-07T12:00:00.1Z",
      "2026-08-07T12:00:00.1234Z"
    ]) {
      expect((await validate(alarm(scheduledFor))).length).toBeGreaterThan(0);
    }
  });
});
