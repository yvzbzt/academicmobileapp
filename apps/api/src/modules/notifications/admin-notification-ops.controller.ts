import { Controller, Get, Inject, Post, Query, UseGuards } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { NotificationWorkerService } from "./notification-worker.service.js";

@Controller("admin/notification-jobs")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminNotificationOpsController {
  constructor(@Inject(NotificationWorkerService) private readonly worker: NotificationWorkerService) {}

  @Get("health")
  @Roles("super_admin")
  health() {
    return this.worker.health();
  }

  @Post("process-due")
  @Roles("super_admin")
  processDue(@Query("limit") limit?: string) {
    return this.worker.processDueJobs(new Date(), limit ? Number(limit) : 100);
  }

  @Get("failed")
  @Roles("super_admin")
  listFailed(@Query("limit") limit?: string, @Query("offset") offset?: string) {
    return this.worker.listFailedJobs(limit ? Number(limit) : 50, offset ? Number(offset) : 0);
  }

  @Get("deliveries")
  @Roles("super_admin")
  listDeliveries(@Query("jobId") jobId: string, @Query("limit") limit?: string, @Query("offset") offset?: string) {
    return this.worker.listDeliveriesByJob(jobId, limit ? Number(limit) : 50, offset ? Number(offset) : 0);
  }

  @Post("retry")
  @Roles("super_admin")
  retry(@Query("jobId") jobId: string) {
    return this.worker.retryFailedJob(jobId);
  }
}
