import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { adminUniversityAccessFor } from "../../common/authorization/admin-university-access.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { AnnouncementDiscoveryRequestDto, AnnouncementIngestionRequestDto, AnnouncementSourcesQueryDto, CreateAnnouncementSourceDto, MyAnnouncementsQueryDto, UpdateAnnouncementSourceDto } from "./announcements.dto.js";
import { AnnouncementIngestionService } from "./announcement-ingestion.service.js";
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

  @Get("my/trusted")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  getMyTrustedAnnouncementCollection(@CurrentUser() user: AuthenticatedUser, @Query() query: MyAnnouncementsQueryDto) {
    return this.announcementsService.getMyAnnouncementsCollection(user.id, query.limit);
  }

  @Get("my/trusted/:announcementId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  getMyTrustedAnnouncement(
    @CurrentUser() user: AuthenticatedUser,
    @Param("announcementId") announcementId: string
  ) {
    return this.announcementsService.getMyTrustedAnnouncement(user.id, announcementId);
  }

  @Get("my/saved/:announcementId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  getMySavedAnnouncementStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("announcementId") announcementId: string
  ) {
    return this.announcementsService.getMySavedAnnouncementStatus(user.id, announcementId);
  }

  @Put("my/saved/:announcementId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  saveMyAnnouncement(
    @CurrentUser() user: AuthenticatedUser,
    @Param("announcementId") announcementId: string
  ) {
    return this.announcementsService.saveMyAnnouncement(user.id, announcementId);
  }

  @Delete("my/saved/:announcementId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("student")
  deleteMySavedAnnouncement(
    @CurrentUser() user: AuthenticatedUser,
    @Param("announcementId") announcementId: string
  ) {
    return this.announcementsService.deleteMySavedAnnouncement(user.id, announcementId);
  }

  @Get("yok")
  getYokAnnouncements(@Query() query: MyAnnouncementsQueryDto) {
    return this.announcementsService.getYokAnnouncements(query.limit);
  }

  @Get("yok/trusted")
  getYokTrustedAnnouncementCollection(@Query() query: MyAnnouncementsQueryDto) {
    return this.announcementsService.getYokAnnouncementsCollection(query.limit);
  }
}

@Controller("admin/announcements")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("content_editor", "university_admin", "super_admin")
export class AdminAnnouncementsController {
  constructor(@Inject(AnnouncementIngestionService) private readonly ingestionService: AnnouncementIngestionService) {}

  @Get("sources")
  listSources(@CurrentUser() user: AuthenticatedUser, @Query() query: AnnouncementSourcesQueryDto) {
    return this.ingestionService.listSourcesForAdmin(adminUniversityAccessFor(user), query);
  }

  @Post("sources")
  createSource(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateAnnouncementSourceDto) {
    return this.ingestionService.createManualSourceForAdmin(adminUniversityAccessFor(user), body);
  }

  @Put("sources/:id")
  updateSource(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: UpdateAnnouncementSourceDto) {
    return this.ingestionService.updateManualSourceForAdmin(adminUniversityAccessFor(user), id, body);
  }

  @Delete("sources/:id")
  deleteSource(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ingestionService.deactivateManualSourceForAdmin(adminUniversityAccessFor(user), id);
  }

  @Post("sources/:id/ingest")
  ingestSource(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ingestionService.ingestSourceByIdForAdmin(adminUniversityAccessFor(user), id);
  }

  @Post("discover")
  discoverSources(@CurrentUser() user: AuthenticatedUser, @Body() body: AnnouncementDiscoveryRequestDto) {
    return this.ingestionService.runDiscoveryAndIngestionForAdmin(adminUniversityAccessFor(user), body);
  }

  @Post("ingest")
  ingestSources(@CurrentUser() user: AuthenticatedUser, @Body() body: AnnouncementIngestionRequestDto) {
    return this.ingestionService.runIngestionForAdmin(adminUniversityAccessFor(user), body);
  }
}
