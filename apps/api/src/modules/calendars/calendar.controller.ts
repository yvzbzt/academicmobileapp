import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
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
