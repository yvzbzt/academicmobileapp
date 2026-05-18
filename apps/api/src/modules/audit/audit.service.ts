import { Inject, Injectable } from "@nestjs/common";
import type { AuditLogFilters, AuditLogRecord, AuditRepository } from "./audit.types.js";

@Injectable()
export class AuditService {
  constructor(@Inject("AuditRepository") private readonly auditRepository: AuditRepository) {}

  record(input: Omit<AuditLogRecord, "id" | "createdAt">) {
    return this.auditRepository.append(input);
  }

  listByEntity(entityType: string, entityId: string) {
    return this.auditRepository.listByEntity(entityType, entityId);
  }

  list(input: Partial<AuditLogFilters>) {
    return this.auditRepository.list({
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.action ? { action: input.action } : {}),
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.entityId ? { entityId: input.entityId } : {}),
      limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
      offset: Math.max(input.offset ?? 0, 0)
    });
  }

  async exportJsonl(input: Partial<AuditLogFilters>): Promise<string> {
    const records = await this.list({ ...input, limit: Math.min(input.limit ?? 1000, 1000), offset: input.offset ?? 0 });
    return records.map((record) => JSON.stringify(record)).join("\n");
  }
}
