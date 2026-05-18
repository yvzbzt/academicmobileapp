import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuditLogFilters, AuditLogRecord, AuditRepository } from "./audit.types.js";

@Injectable()
export class InMemoryAuditRepository implements AuditRepository {
  private readonly logs: AuditLogRecord[] = [];

  async append(input: Omit<AuditLogRecord, "id" | "createdAt">): Promise<AuditLogRecord> {
    const record: AuditLogRecord = { ...input, id: randomUUID(), createdAt: new Date() };
    this.logs.push(record);
    return record;
  }

  async listByEntity(entityType: string, entityId: string): Promise<AuditLogRecord[]> {
    return this.logs.filter((log) => log.entityType === entityType && log.entityId === entityId).sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async list(input: AuditLogFilters): Promise<AuditLogRecord[]> {
    return this.logs
      .filter((log) => (input.actorId ? log.actorId === input.actorId : true))
      .filter((log) => (input.action ? log.action === input.action : true))
      .filter((log) => (input.entityType ? log.entityType === input.entityType : true))
      .filter((log) => (input.entityId ? log.entityId === input.entityId : true))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(input.offset, input.offset + input.limit);
  }
}
