import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RecentAuthGuard } from "../../common/guards/recent-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { AdminUpdateUserDto, DeleteMyAccountDto, FollowAcademicScopeDto, ListUsersQueryDto, SuggestAcademicUnitDto, UpdateMeDto, UpdateMyUniversityDto } from "./users.dto.js";
import { UsersService } from "./users.service.js";

@Controller("me")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  @Get()
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMe(user.id);
  }

  @Delete()
  @UseGuards(RecentAuthGuard)
  deleteMe(@CurrentUser() user: AuthenticatedUser, @Body() body: DeleteMyAccountDto) {
    return this.usersService.deleteMe(user.id, body);
  }

  @Patch()
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateMeDto) {
    return this.usersService.updateMe(user.id, body);
  }

  @Delete("data")
  @UseGuards(RecentAuthGuard)
  deleteMyData(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.deleteMyData(user.id);
  }

  @Patch("university")
  @Roles("student")
  updateMyUniversity(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateMyUniversityDto) {
    return this.usersService.updateMyUniversity(user.id, body);
  }

  @Get("affiliation-options")
  @Roles("student")
  getAffiliationOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getAffiliationOptions(user.id);
  }

  @Post("academic-suggestions")
  @Roles("student")
  suggestAcademicUnit(@CurrentUser() user: AuthenticatedUser, @Body() body: SuggestAcademicUnitDto) {
    return this.usersService.suggestAcademicUnit(user.id, body);
  }

  @Get("follows")
  @Roles("student")
  listFollowedScopes(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.listFollowedScopes(user.id);
  }

  @Post("follows")
  @Roles("student")
  addFollowedScope(@CurrentUser() user: AuthenticatedUser, @Body() body: FollowAcademicScopeDto) {
    return this.usersService.addFollowedScope(user.id, body);
  }
}

@Controller("admin/users")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin")
export class AdminUsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  @Get()
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.usersService.listUsers(query);
  }

  @Get("unassociated-email-domains")
  listUnassociatedEmailDomains() {
    return this.usersService.listUnassociatedEmailDomains();
  }

  @Get("academic-unit-suggestions")
  listAcademicUnitSuggestions(@Query("status") status?: "pending" | "approved" | "rejected") {
    return this.usersService.listAcademicUnitSuggestions(status);
  }

  @Post("academic-unit-suggestions/:id/approve")
  approveAcademicUnitSuggestion(@Param("id") id: string) {
    return this.usersService.approveAcademicUnitSuggestion(id);
  }

  @Post("academic-unit-suggestions/:id/reject")
  rejectAcademicUnitSuggestion(@Param("id") id: string) {
    return this.usersService.rejectAcademicUnitSuggestion(id);
  }

  @Patch(":id")
  updateUser(@Param("id") id: string, @Body() body: AdminUpdateUserDto) {
    return this.usersService.updateUserByAdmin(id, body);
  }

  @Delete(":id")
  deleteUser(@Param("id") id: string) {
    return this.usersService.deleteUserByAdmin(id);
  }
}
