import { Body, Controller, Get, Inject, Patch, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { UpdateMeDto, UpdateMyUniversityDto } from "./users.dto.js";
import { UsersService } from "./users.service.js";

@Controller("me")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  @Get()
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMe(user.id);
  }

  @Patch()
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateMeDto) {
    return this.usersService.updateMe(user.id, body);
  }

  @Patch("university")
  @Roles("student")
  updateMyUniversity(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateMyUniversityDto) {
    return this.usersService.updateMyUniversity(user.id, body);
  }
}
