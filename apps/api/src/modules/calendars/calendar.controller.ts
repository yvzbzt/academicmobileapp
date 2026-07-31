import { Controller, Get, Header, Inject, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { CalendarService } from "./calendar.service.js";
import { SearchEventsQueryDto, UniversityCalendarQueryDto, UpcomingEventsQueryDto } from "./calendar.dto.js";

@Controller("calendar")
export class CalendarController {
  constructor(@Inject(CalendarService) private readonly calendarService: CalendarService) {}

  @Get("my")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  getMyCalendar(@CurrentUser() user: AuthenticatedUser) {
    return this.calendarService.getMyCalendar(user.id);
  }

  @Get("my/trusted/:eventId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  getMyTrustedCalendarEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("eventId") eventId: string
  ) {
    return this.calendarService.getMyTrustedCalendarEvent(user.id, eventId);
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
  getUniversityCalendar(@Param("universityId") universityId: string, @Query() query: UniversityCalendarQueryDto) {
    return this.calendarService.getUniversityCalendar(universityId, query.academicYear);
  }

  @Get("upcoming")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  getUpcomingEvents(@CurrentUser() user: AuthenticatedUser, @Query() query: UpcomingEventsQueryDto) {
    return this.calendarService.getUpcomingEvents(user.id, query.limit);
  }

  @Get("my/course-schedules")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  getMyCourseSchedules(@CurrentUser() user: AuthenticatedUser) {
    return this.calendarService.getMyCourseSchedules(user.id);
  }

  @Get("my/exam-schedules")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  getMyExamSchedules(@CurrentUser() user: AuthenticatedUser) {
    return this.calendarService.getMyExamSchedules(user.id);
  }

  @Get("summer-school/my")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  getMySummerSchool(@CurrentUser() user: AuthenticatedUser) {
    return this.calendarService.getMySummerSchool(user.id);
  }

  @Get("events")
  searchEvents(@Query() query: SearchEventsQueryDto) {
    return this.calendarService.searchEvents({
      ...(query.category ? { category: query.category } : {}),
      ...(query.startDate ? { startDate: new Date(query.startDate) } : {}),
      ...(query.endDate ? { endDate: new Date(query.endDate) } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {})
    });
  }

  @Get("events/:eventId")
  getEventDetail(@Param("eventId") eventId: string) {
    return this.calendarService.getEventDetail(eventId);
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
