import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { MyAnnouncementsQueryDto } from "./announcements.dto.js";
import { AnnouncementsService } from "./announcements.service.js";

@Controller("announcements")
export class AnnouncementsController {
  constructor(@Inject(AnnouncementsService) private readonly announcementsService: AnnouncementsService) {}

  @Get("my")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  getMyAnnouncements(@CurrentUser() user: AuthenticatedUser, @Query() query: MyAnnouncementsQueryDto) {
    return this.announcementsService.getMyAnnouncements(user.id, query.limit);
  }
}
