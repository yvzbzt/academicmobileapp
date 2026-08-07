import { Controller, Get, Header, Inject, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { CalendarService } from "./calendar.service.js";
import { academicTemporalFilterFields, toAcademicEventDto } from "./calendar-temporal.js";
import { SearchEventsQueryDto, UniversityCalendarQueryDto, UpcomingEventsQueryDto } from "./calendar.dto.js";

@Controller("calendar")
export class CalendarController {
  constructor(@Inject(CalendarService) private readonly calendarService: CalendarService) {}

  @Get("my")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  async getMyCalendar(@CurrentUser() user: AuthenticatedUser) {
    const response = await this.calendarService.getMyCalendar(user.id);
    return { ...response, events: response.events.map(toAcademicEventDto) };
  }

  @Get("my/trusted/:eventId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  async getMyTrustedCalendarEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("eventId") eventId: string
  ) {
    return toAcademicEventDto(await this.calendarService.getMyTrustedCalendarEvent(user.id, eventId));
  }

  @Get("integrations")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  getMyCalendarIntegrations(@CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    return this.calendarService.getMyCalendarIntegrationLinks(user.id, apiBaseUrlFromRequest(request));
  }

  @Get("integrations/feed/:token.ics")
  @Header("Content-Type", "text/calendar; charset=utf-8")
  @Header("Cache-Control", "private, max-age=300")
  async getCalendarFeed(@Param("token") token: string, @Res() response: Response) {
    const feed = await this.calendarService.getMyCalendarFeedByToken(token);
    response.setHeader("Content-Type", feed.contentType);
    response.setHeader("Content-Disposition", `inline; filename="${feed.fileName}"`);
    response.send(feed.content);
  }

  @Get("university/:universityId")
  async getUniversityCalendar(@Param("universityId") universityId: string, @Query() query: UniversityCalendarQueryDto) {
    const response = await this.calendarService.getUniversityCalendar(universityId, query.academicYear);
    return { ...response, events: response.events.map(toAcademicEventDto) };
  }

  @Get("upcoming")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  async getUpcomingEvents(@CurrentUser() user: AuthenticatedUser, @Query() query: UpcomingEventsQueryDto) {
    return (await this.calendarService.getUpcomingEvents(user.id, query.limit)).map(toAcademicEventDto);
  }

  @Get("my/course-schedules")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  async getMyCourseSchedules(@CurrentUser() user: AuthenticatedUser) {
    const response = await this.calendarService.getMyCourseSchedules(user.id);
    return { ...response, events: response.events.map(toAcademicEventDto) };
  }

  @Get("my/exam-schedules")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  async getMyExamSchedules(@CurrentUser() user: AuthenticatedUser) {
    const response = await this.calendarService.getMyExamSchedules(user.id);
    return { ...response, events: response.events.map(toAcademicEventDto) };
  }

  @Get("summer-school/my")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  async getMySummerSchool(@CurrentUser() user: AuthenticatedUser) {
    const response = await this.calendarService.getMySummerSchool(user.id);
    return {
      ...response,
      sameDepartmentOptions: response.sameDepartmentOptions.map((option) => ({
        ...option,
        events: option.events.map(toAcademicEventDto)
      }))
    };
  }

  @Get("events")
  async searchEvents(@Query() query: SearchEventsQueryDto) {
    const temporalFilters = academicTemporalFilterFields(query.startDate, query.endDate);
    return (await this.calendarService.searchEvents({
      ...(query.category ? { category: query.category } : {}),
      ...temporalFilters,
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {})
    })).map(toAcademicEventDto);
  }

  @Get("events/:eventId")
  async getEventDetail(@Param("eventId") eventId: string) {
    return toAcademicEventDto(await this.calendarService.getEventDetail(eventId));
  }
}

function apiBaseUrlFromRequest(request: Request): string {
  const configured = process.env.PUBLIC_API_BASE_URL;
  if (configured) return configured;

  const proto = firstHeaderValue(request.headers["x-forwarded-proto"]) ?? request.protocol ?? "http";
  const host = firstHeaderValue(request.headers["x-forwarded-host"]) ?? request.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
