import { Body, Controller, Get, Inject, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { adminUniversityAccessFor } from "../../common/authorization/admin-university-access.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import {
  AcademicUnitScheduleSourceQueryDto,
  IngestAcademicUnitScheduleSourceDto,
  PublishAcademicUnitScheduleDto,
  ReopenAcademicUnitScheduleReviewDto,
  ReviewAcademicUnitScheduleDto,
  UpdateAcademicUnitScheduleCandidateDto
} from "./academic-unit-schedule.dto.js";
import { AcademicUnitScheduleIngestionService } from "./academic-unit-schedule-ingestion.service.js";

@Controller("admin/calendars/schedule-sources")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminAcademicUnitScheduleController {
  constructor(
    @Inject(AcademicUnitScheduleIngestionService)
    private readonly scheduleIngestionService: AcademicUnitScheduleIngestionService
  ) {}

  @Post("provision-registry")
  @Roles("super_admin")
  provisionRegistry() {
    return this.scheduleIngestionService.provisionVerifiedRegistry();
  }

  @Get()
  @Roles("content_editor", "university_admin", "super_admin")
  listSources(@CurrentUser() user: AuthenticatedUser, @Query() query: AcademicUnitScheduleSourceQueryDto) {
    return this.scheduleIngestionService.listSources(adminUniversityAccessFor(user), query);
  }

  @Post(":id/ingest")
  @Roles("super_admin")
  ingestSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: IngestAcademicUnitScheduleSourceDto
  ) {
    return this.scheduleIngestionService.ingestSource(adminUniversityAccessFor(user), id, body.expectedRevision);
  }

  @Patch(":id/candidates/:rowNumber")
  @Roles("content_editor", "university_admin", "super_admin")
  updateCandidate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("rowNumber", ParseIntPipe) rowNumber: number,
    @Body() body: UpdateAcademicUnitScheduleCandidateDto
  ) {
    return this.scheduleIngestionService.updateCandidate(adminUniversityAccessFor(user), user.id, id, rowNumber, body);
  }

  @Post(":id/review")
  @Roles("content_editor", "university_admin", "super_admin")
  reviewSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: ReviewAcademicUnitScheduleDto
  ) {
    return this.scheduleIngestionService.reviewSource(adminUniversityAccessFor(user), user.id, id, body);
  }

  @Post(":id/reopen-review")
  @Roles("super_admin")
  reopenReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: ReopenAcademicUnitScheduleReviewDto
  ) {
    return this.scheduleIngestionService.reopenReview(adminUniversityAccessFor(user), user.id, id, body.expectedRevision);
  }

  @Post(":id/publish")
  @Roles("super_admin")
  publishSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: PublishAcademicUnitScheduleDto
  ) {
    return this.scheduleIngestionService.publishStagedSource(adminUniversityAccessFor(user), user.id, id, body.expectedRevision);
  }
}
