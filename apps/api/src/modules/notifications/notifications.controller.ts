import { Body, Controller, Get, Inject, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { RegisterDeviceDto, UpdateNotificationPreferencesDto } from "./notifications.dto.js";
import { NotificationsService } from "./notifications.service.js";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notificationsService: NotificationsService) {}

  @Post("devices/register")
  @Roles("student")
  registerDevice(@CurrentUser() user: AuthenticatedUser, @Body() body: RegisterDeviceDto) {
    return this.notificationsService.registerDevice(user, body);
  }

  @Get("notification-preferences")
  @Roles("student")
  async getNotificationPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.toPreferenceDto(await this.notificationsService.getPreferences(user));
  }

  @Patch("notification-preferences")
  @Roles("student")
  async updateNotificationPreferences(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateNotificationPreferencesDto) {
    return this.notificationsService.toPreferenceDto(await this.notificationsService.updatePreferences(user, body));
  }
}
