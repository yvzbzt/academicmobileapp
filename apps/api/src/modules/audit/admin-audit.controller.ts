import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { AuditService } from "./audit.service.js";

@Controller("admin/audit-logs")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminAuditController {
  constructor(@Inject(AuditService) private readonly auditService: AuditService) {}

  @Get()
  @Roles("super_admin")
  list(
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("actorId") actorId?: string,
    @Query("action") action?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ) {
    if (entityType && entityId && !actorId && !action && !limit && !offset) return this.auditService.listByEntity(entityType, entityId);
    return this.auditService.list({
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(actorId ? { actorId } : {}),
      ...(action ? { action } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
      ...(offset ? { offset: Number(offset) } : {})
    });
  }

  @Get("export")
  @Roles("super_admin")
  async exportJsonl(
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("actorId") actorId?: string,
    @Query("action") action?: string
  ) {
    return {
      contentType: "application/x-ndjson",
      fileName: "audit-logs.jsonl",
      data: await this.auditService.exportJsonl({
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(actorId ? { actorId } : {}),
        ...(action ? { action } : {})
      })
    };
  }
}
