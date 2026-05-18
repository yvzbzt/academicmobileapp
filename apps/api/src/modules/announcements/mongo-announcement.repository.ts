import { Inject, Injectable } from "@nestjs/common";
import { announcementSourceSchema } from "../../database/mongoose-schemas.js";
import { getModel, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import type { AnnouncementRepository, AnnouncementSourceRecord } from "./announcements.types.js";

@Injectable()
export class MongoAnnouncementRepository implements AnnouncementRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]> {
    const matchers: Array<Record<string, string>> = [{ scopeType: "university", scopeId: input.universityId }];
    if (input.facultyId) matchers.push({ scopeType: "faculty", scopeId: input.facultyId });
    if (input.departmentId) matchers.push({ scopeType: "department", scopeId: input.departmentId });

    const documents = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", $or: matchers })
      .sort({ priority: -1, updatedAt: -1 });

    return documents.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}
