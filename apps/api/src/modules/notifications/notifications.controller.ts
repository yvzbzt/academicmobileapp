import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { CreateStudentAlarmDto, RegisterDeviceDto, UnregisterDeviceDto, UpdateNotificationPreferencesDto } from "./notifications.dto.js";
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

  @Delete("devices/current")
  @Roles("student")
  unregisterCurrentDevice(@CurrentUser() user: AuthenticatedUser, @Body() body: UnregisterDeviceDto) {
    return this.notificationsService.unregisterCurrentDevice(user, body);
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

  @Get("notification-alarms")
  @Roles("student")
  listStudentAlarms(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listStudentAlarms(user);
  }

  @Post("notification-alarms")
  @Roles("student")
  createStudentAlarm(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateStudentAlarmDto) {
    return this.notificationsService.createStudentAlarm(user, body);
  }

  @Delete("notification-alarms/:id")
  @Roles("student")
  cancelStudentAlarm(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.notificationsService.cancelStudentAlarm(user, id);
  }
}
