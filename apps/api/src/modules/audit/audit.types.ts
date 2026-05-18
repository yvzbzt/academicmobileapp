export interface AuditLogRecord {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditLogFilters {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  limit: number;
  offset: number;
}

export interface AuditRepository {
  append(input: Omit<AuditLogRecord, "id" | "createdAt">): Promise<AuditLogRecord>;
  listByEntity(entityType: string, entityId: string): Promise<AuditLogRecord[]>;
  list(input: AuditLogFilters): Promise<AuditLogRecord[]>;
}
