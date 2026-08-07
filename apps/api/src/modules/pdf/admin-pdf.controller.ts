import { Body, Controller, Get, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { CreatePdfSourceDto, ListExtractedEventsQueryDto, RejectExtractedEventDto, UpdateExtractedEventDto } from "./pdf.dto.js";
import { PdfProcessingService } from "./pdf-processing.service.js";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("content_editor", "university_admin", "super_admin")
export class AdminPdfController {
  constructor(@Inject(PdfProcessingService) private readonly pdfProcessingService: PdfProcessingService) {}

  @Post("pdf-sources")
  createPdfSource(@CurrentUser() user: AuthenticatedUser, @Body() body: CreatePdfSourceDto) {
    return this.pdfProcessingService.createPdfSource({ ...body, uploadedBy: user.id });
  }

  @Post("pdf-sources/:id/process")
  processPdfSource(@Param("id") id: string) {
    return this.pdfProcessingService.processPdfSource(id);
  }

  @Get("pdf-sources/:id")
  getPdfSource(@Param("id") id: string) {
    return this.pdfProcessingService.getPdfSource(id);
  }

  @Get("pdf-sources/:id/extracted-events")
  listPdfExtractedEvents(@Param("id") id: string) {
    return this.pdfProcessingService.listExtractedEvents({ pdfSourceId: id });
  }

  @Get("extracted-events")
  listExtractedEvents(@Query() query: ListExtractedEventsQueryDto) {
    return this.pdfProcessingService.listExtractedEvents({
      ...(query.pdfSourceId ? { pdfSourceId: query.pdfSourceId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {})
    });
  }

  @Get("extracted-events/:id")
  getExtractedEvent(@Param("id") id: string) {
    return this.pdfProcessingService.getExtractedEvent(id);
  }

  @Patch("extracted-events/:id")
  updateExtractedEvent(@Param("id") id: string, @Body() body: UpdateExtractedEventDto) {
    return this.pdfProcessingService.updateExtractedEvent(id, {
      ...(body.normalizedTitle ? { normalizedTitle: body.normalizedTitle } : {}),
      ...(body.normalizedCategory ? { normalizedCategory: body.normalizedCategory } : {}),
      ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
      ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
      ...(body.adminNote ? { adminNote: body.adminNote } : {})
    });
  }

  @Post("extracted-events/:id/approve")
  approveExtractedEvent(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.pdfProcessingService.approveExtractedEvent(id, user.id);
  }

  @Post("extracted-events/:id/reject")
  rejectExtractedEvent(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: RejectExtractedEventDto) {
    return this.pdfProcessingService.rejectExtractedEvent(id, user.id, body.adminNote);
  }
}
