import { Controller, Get, HttpStatus, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { InfrastructureHealthService } from "./infrastructure-health.service.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(InfrastructureHealthService) private readonly infrastructureHealth: InfrastructureHealthService) {}

  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) response: Response): Promise<{ status: "ok" | "degraded" }> {
    const readiness = await this.infrastructureHealth.readiness();
    if (readiness.status === "degraded") response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: readiness.status };
  }
}
