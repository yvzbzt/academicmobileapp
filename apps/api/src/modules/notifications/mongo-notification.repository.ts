import { Inject, Injectable } from "@nestjs/common";
import { deviceTokenSchema, notificationDeliverySchema, notificationJobSchema, notificationPreferenceSchema } from "../../database/mongoose-schemas.js";
import { getModel, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import type { DeviceTokenRecord, NotificationDeliveryRecord, NotificationJobRecord, NotificationJobStatus, NotificationPreferenceRecord, NotificationRepository } from "./notification.types.js";

@Injectable()
export class MongoNotificationRepository implements NotificationRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async upsertDeviceToken(input: Omit<DeviceTokenRecord, "id" | "createdAt" | "updatedAt" | "lastSeenAt" | "status">): Promise<DeviceTokenRecord> {
    const document = await (await this.model("DeviceToken", deviceTokenSchema)).findOneAndUpdate({ token: input.token }, { ...input, status: "active", lastSeenAt: new Date() }, { new: true, upsert: true });
    return toDomainRecord<DeviceTokenRecord>(document);
  }

  async findPreferencesByUserId(userId: string): Promise<NotificationPreferenceRecord | null> {
    const document = await (await this.model("NotificationPreference", notificationPreferenceSchema)).findOne({ userId });
    return document ? toDomainRecord<NotificationPreferenceRecord>(document) : null;
  }

  async upsertPreferences(input: Omit<NotificationPreferenceRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationPreferenceRecord> {
    const document = await (await this.model("NotificationPreference", notificationPreferenceSchema)).findOneAndUpdate({ userId: input.userId }, input, { new: true, upsert: true });
    return toDomainRecord<NotificationPreferenceRecord>(document);
  }

  async createNotificationJobs(input: Array<Omit<NotificationJobRecord, "id" | "createdAt" | "updatedAt">>): Promise<NotificationJobRecord[]> {
    const model = await this.model("NotificationJob", notificationJobSchema);
    const documents = [];
    for (const job of input) {
      const document = await model.findOneAndUpdate({ eventId: job.eventId, offsetDays: job.offsetDays }, job, { new: true, upsert: true });
      documents.push(document);
    }
    return documents.map((document) => toDomainRecord<NotificationJobRecord>(document));
  }

  async listJobsByCalendar(calendarId: string): Promise<NotificationJobRecord[]> {
    const documents = await (await this.model("NotificationJob", notificationJobSchema)).find({ calendarId }).sort({ scheduledAt: 1 });
    return documents.map((document) => toDomainRecord<NotificationJobRecord>(document));
  }

  async listDueJobs(now: Date, limit: number): Promise<NotificationJobRecord[]> {
    const documents = await (await this.model("NotificationJob", notificationJobSchema)).find({ status: "scheduled", scheduledAt: { $lte: now } }).sort({ scheduledAt: 1 }).limit(limit);
    return documents.map((document) => toDomainRecord<NotificationJobRecord>(document));
  }

  async listFailedJobs(limit: number, offset: number): Promise<NotificationJobRecord[]> {
    const documents = await (await this.model("NotificationJob", notificationJobSchema)).find({ status: "failed" }).sort({ updatedAt: -1 }).skip(offset).limit(limit);
    return documents.map((document) => toDomainRecord<NotificationJobRecord>(document));
  }

  async listActiveDeviceTokens(limit: number, offset: number): Promise<DeviceTokenRecord[]> {
    const documents = await (await this.model("DeviceToken", deviceTokenSchema)).find({ status: "active" }).sort({ lastSeenAt: -1 }).skip(offset).limit(limit);
    return documents.map((document) => toDomainRecord<DeviceTokenRecord>(document));
  }

  async recordDelivery(input: Omit<NotificationDeliveryRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationDeliveryRecord> {
    const document = await (await this.model("NotificationDelivery", notificationDeliverySchema)).create(input);
    return toDomainRecord<NotificationDeliveryRecord>(document);
  }

  async listDeliveriesByJob(jobId: string, limit: number, offset: number): Promise<NotificationDeliveryRecord[]> {
    const documents = await (await this.model("NotificationDelivery", notificationDeliverySchema)).find({ jobId }).sort({ createdAt: -1 }).skip(offset).limit(limit);
    return documents.map((document) => toDomainRecord<NotificationDeliveryRecord>(document));
  }

  async updateJobStatus(jobId: string, status: NotificationJobStatus): Promise<NotificationJobRecord | null> {
    const document = await (await this.model("NotificationJob", notificationJobSchema)).findByIdAndUpdate(jobId, { status }, { new: true });
    return document ? toDomainRecord<NotificationJobRecord>(document) : null;
  }

  async rescheduleJob(jobId: string, scheduledAt: Date): Promise<NotificationJobRecord | null> {
    const document = await (await this.model("NotificationJob", notificationJobSchema)).findByIdAndUpdate(jobId, { status: "scheduled", scheduledAt }, { new: true });
    return document ? toDomainRecord<NotificationJobRecord>(document) : null;
  }

  async disableDeviceToken(token: string): Promise<DeviceTokenRecord | null> {
    const document = await (await this.model("DeviceToken", deviceTokenSchema)).findOneAndUpdate({ token }, { status: "disabled" }, { new: true });
    return document ? toDomainRecord<DeviceTokenRecord>(document) : null;
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}
