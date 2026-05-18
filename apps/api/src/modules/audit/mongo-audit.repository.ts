import { Inject, Injectable } from "@nestjs/common";
import { Schema } from "mongoose";
import { getModel, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import type { AuditLogFilters, AuditLogRecord, AuditRepository } from "./audit.types.js";

const auditLogSchema = new Schema(
  {
    actorId: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: String, required: true, index: true },
    metadata: { type: Schema.Types.Mixed, required: true, default: {} }
  },
  { collection: "audit_logs", timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ actorId: 1, createdAt: -1 }, { name: "audit_actor_time" });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 }, { name: "audit_entity_time" });

@Injectable()
export class MongoAuditRepository implements AuditRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async append(input: Omit<AuditLogRecord, "id" | "createdAt">): Promise<AuditLogRecord> {
    const document = await (await this.model()).create(input);
    return toDomainRecord<AuditLogRecord>(document);
  }

  async listByEntity(entityType: string, entityId: string): Promise<AuditLogRecord[]> {
    const documents = await (await this.model()).find({ entityType, entityId }).sort({ createdAt: 1 });
    return documents.map((document) => toDomainRecord<AuditLogRecord>(document));
  }

  async list(input: AuditLogFilters): Promise<AuditLogRecord[]> {
    const documents = await (await this.model())
      .find({
        ...(input.actorId ? { actorId: input.actorId } : {}),
        ...(input.action ? { action: input.action } : {}),
        ...(input.entityType ? { entityType: input.entityType } : {}),
        ...(input.entityId ? { entityId: input.entityId } : {})
      })
      .sort({ createdAt: -1 })
      .skip(input.offset)
      .limit(input.limit);
    return documents.map((document) => toDomainRecord<AuditLogRecord>(document));
  }

  private async model() {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, "AuditLog", auditLogSchema);
  }
}
