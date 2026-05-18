import { Controller, Get, Inject } from "@nestjs/common";
import { InfrastructureHealthService } from "./infrastructure-health.service.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(InfrastructureHealthService) private readonly infrastructureHealth: InfrastructureHealthService) {}

  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  ready() {
    return this.infrastructureHealth.readiness();
  }
}
