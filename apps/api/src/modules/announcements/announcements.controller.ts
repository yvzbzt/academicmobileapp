import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { adminUniversityAccessFor } from "../../common/authorization/admin-university-access.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { AnnouncementDiscoveryRequestDto, AnnouncementIngestionRequestDto, AnnouncementReviewItemsQueryDto, AnnouncementSourceReviewDto, AnnouncementSourcesQueryDto, CreateAnnouncementSourceDto, DeleteContentLlmApiKeyDto, MyAnnouncementsQueryDto, PreviewUniversityContentSourceProfileDto, RunContentLlmReviewDto, RunSingleContentLlmReviewDto, UpdateAnnouncementReviewItemDto, UpdateAnnouncementSourceDto, UpdateContentLlmSettingsDto, UpdateUniversityContentSourceProfileDto } from "./announcements.dto.js";
import { AnnouncementIngestionService } from "./announcement-ingestion.service.js";
import { AnnouncementReviewService } from "./announcement-review.service.js";
import { AnnouncementsService } from "./announcements.service.js";
import { ContentLlmSettingsService } from "./content-llm-settings.service.js";

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
  constructor(
    @Inject(AnnouncementIngestionService) private readonly ingestionService: AnnouncementIngestionService,
    @Inject(AnnouncementReviewService) private readonly reviewService: AnnouncementReviewService,
    @Inject(ContentLlmSettingsService) private readonly llmSettingsService: ContentLlmSettingsService
  ) {}

  @Get("sources")
  listSources(@CurrentUser() user: AuthenticatedUser, @Query() query: AnnouncementSourcesQueryDto) {
    return this.ingestionService.listSourcesForAdmin(adminUniversityAccessFor(user), query);
  }

  @Get("source-profiles")
  listSourceProfiles(@CurrentUser() user: AuthenticatedUser) {
    return this.ingestionService.listUniversityContentSourceProfilesForAdmin(adminUniversityAccessFor(user));
  }

  @Put("source-profiles/:universityId/:contentType")
  updateSourceProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("universityId") universityId: string,
    @Param("contentType") contentType: string,
    @Body() body: UpdateUniversityContentSourceProfileDto
  ) {
    return this.ingestionService.saveUniversityContentSourceProfileForAdmin(
      adminUniversityAccessFor(user),
      universityId,
      contentType as "announcement" | "news" | "event" | "academic_calendar",
      body
    );
  }

  @Post("source-profiles/:universityId/:contentType/preview")
  previewSourceProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("universityId") universityId: string,
    @Param("contentType") contentType: string,
    @Body() body: PreviewUniversityContentSourceProfileDto
  ) {
    return this.ingestionService.previewUniversityContentSourceProfileForAdmin(
      adminUniversityAccessFor(user),
      universityId,
      contentType as "announcement" | "news" | "event" | "academic_calendar",
      body,
      user.id
    );
  }

  @Post("sources")
  createSource(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateAnnouncementSourceDto) {
    return this.ingestionService.createManualSourceForAdmin(adminUniversityAccessFor(user), body);
  }

  @Post("sources/provision-registry")
  @Roles("super_admin")
  provisionRegistrySources() {
    return this.ingestionService.provisionStaticAnnouncementSources();
  }

  @Put("sources/:id")
  updateSource(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: UpdateAnnouncementSourceDto) {
    return this.ingestionService.updateManualSourceForAdmin(adminUniversityAccessFor(user), id, body);
  }

  @Delete("sources/:id")
  deleteSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: AnnouncementSourceReviewDto
  ) {
    return this.ingestionService.deactivateManualSourceForAdmin(adminUniversityAccessFor(user), id, body);
  }

  @Post("sources/:id/ingest")
  ingestSource(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ingestionService.ingestSourceByIdForAdmin(adminUniversityAccessFor(user), id);
  }

  @Post("sources/:id/preview")
  previewSource(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ingestionService.previewSourceByIdForAdmin(adminUniversityAccessFor(user), id);
  }

  @Post("sources/:id/approve")
  approveSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: AnnouncementSourceReviewDto
  ) {
    return this.reviewService.approveSource(adminUniversityAccessFor(user), id, user.id, body);
  }

  @Post("sources/:id/reject")
  rejectSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: AnnouncementSourceReviewDto
  ) {
    return this.reviewService.rejectSource(adminUniversityAccessFor(user), id, user.id, body);
  }

  @Get("review-items")
  listReviewItems(@CurrentUser() user: AuthenticatedUser, @Query() query: AnnouncementReviewItemsQueryDto) {
    return this.reviewService.listItems(adminUniversityAccessFor(user), query);
  }

  @Patch("review-items/:id")
  updateReviewItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: UpdateAnnouncementReviewItemDto
  ) {
    return this.reviewService.updateItem(adminUniversityAccessFor(user), id, body, user.id);
  }

  @Post("review-items/:id/llm-review")
  @Roles("super_admin")
  runLlmReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: RunSingleContentLlmReviewDto
  ) {
    return this.reviewService.runLlmReview(adminUniversityAccessFor(user), id, body, user.id);
  }

  @Post("review-items/llm-review")
  @Roles("super_admin")
  runPendingLlmReviews(@CurrentUser() user: AuthenticatedUser, @Body() body: RunContentLlmReviewDto) {
    return this.reviewService.runPendingLlmReviews(adminUniversityAccessFor(user), user.id, body.limit);
  }

  @Get("llm-settings")
  @Roles("super_admin")
  getLlmSettings() {
    return this.llmSettingsService.getSettings();
  }

  @Put("llm-settings")
  @Roles("super_admin")
  updateLlmSettings(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateContentLlmSettingsDto) {
    return this.llmSettingsService.updateSettings(body, user.id);
  }

  @Delete("llm-settings/key")
  @Roles("super_admin")
  deleteLlmKey(@CurrentUser() user: AuthenticatedUser, @Body() body: DeleteContentLlmApiKeyDto) {
    return this.llmSettingsService.deleteApiKey(user.id, body.expectedRevision);
  }

  @Post("llm-settings/test")
  @Roles("super_admin")
  testLlmSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.llmSettingsService.testConnection(user.id);
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
