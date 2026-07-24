import { Inject, Injectable } from "@nestjs/common";
import { FirestoreDatabaseService } from "../../database/firestore.service.js";
import { cleanFirestoreData, getAllFirestoreRecords, newFirestoreId } from "../../database/firestore-utils.js";
import type { AuditLogFilters, AuditLogRecord, AuditRepository } from "./audit.types.js";

@Injectable()
export class FirestoreAuditRepository implements AuditRepository {
  constructor(@Inject(FirestoreDatabaseService) private readonly firestore: FirestoreDatabaseService) {}

  async append(input: Omit<AuditLogRecord, "id" | "createdAt">): Promise<AuditLogRecord> {
    const record: AuditLogRecord = { ...input, id: newFirestoreId(), createdAt: new Date() };
    await this.collection.doc(record.id).set(cleanFirestoreData(record as unknown as Record<string, unknown>));
    return record;
  }

  async listByEntity(entityType: string, entityId: string): Promise<AuditLogRecord[]> {
    return (await getAllFirestoreRecords<AuditLogRecord>(this.collection.where("entityType", "==", entityType)))
      .filter((log) => log.entityId === entityId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async list(input: AuditLogFilters): Promise<AuditLogRecord[]> {
    return (await getAllFirestoreRecords<AuditLogRecord>(this.collection))
      .filter((log) => (input.actorId ? log.actorId === input.actorId : true))
      .filter((log) => (input.action ? log.action === input.action : true))
      .filter((log) => (input.entityType ? log.entityType === input.entityType : true))
      .filter((log) => (input.entityId ? log.entityId === input.entityId : true))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(input.offset, input.offset + input.limit);
  }

  private get collection() {
    return this.firestore.getDb().collection("audit_logs");
  }
}
