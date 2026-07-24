import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { AnnouncementSourcesQueryDto, MyAnnouncementsQueryDto } from "../src/modules/announcements/announcements.dto.js";
import { SearchEventsQueryDto, UpcomingEventsQueryDto } from "../src/modules/calendars/calendar.dto.js";
import { ListUniversitiesQueryDto } from "../src/modules/catalog/catalog.dto.js";
import { ListExtractedEventsQueryDto } from "../src/modules/pdf/pdf.dto.js";

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
