import { Body, Controller, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { AdminCalendarService } from "./admin-calendar.service.js";
import { CalendarIngestionRequestDto, CreateCalendarDraftDto, CreateManualCalendarDto, UpdateCalendarDto } from "./admin-calendar.dto.js";
import { CalendarIngestionService } from "./calendar-ingestion.service.js";

@Controller("admin/calendars")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminCalendarController {
  constructor(
    @Inject(AdminCalendarService) private readonly adminCalendarService: AdminCalendarService,
    @Inject(CalendarIngestionService) private readonly calendarIngestionService: CalendarIngestionService
  ) {}

  @Post()
  @Roles("super_admin")
  createCalendarDraft(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateCalendarDraftDto) {
    return this.adminCalendarService.createDraftFromApprovedExtractedEvents({ ...body, createdBy: user.id });
  }

  @Post("manual")
  @Roles("super_admin")
  createManualCalendarDraft(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateManualCalendarDto) {
    return this.adminCalendarService.createManualDraft({ ...body, createdBy: user.id });
  }

  @Post("ingest")
  @Roles("super_admin")
  ingestCalendars(@Body() body: CalendarIngestionRequestDto) {
    return this.calendarIngestionService.runDiscoveryAndIngestion(body);
  }

  @Patch(":id")
  @Roles("super_admin")
  updateCalendar(@Param("id") id: string, @Body() body: UpdateCalendarDto) {
    return this.adminCalendarService.updateCalendar(id, body);
  }

  @Post(":id/publish")
  @Roles("super_admin")
  publishCalendar(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.adminCalendarService.publishCalendar(id, user.id);
  }

  @Post(":id/rollback")
  @Roles("super_admin")
  rollbackCalendar(@Param("id") id: string) {
    return this.adminCalendarService.rollbackCalendar(id);
  }
}
