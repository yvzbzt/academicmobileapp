import { Inject, Injectable } from "@nestjs/common";
import { deviceTokenSchema, notificationDeliverySchema, notificationJobSchema, notificationPreferenceSchema, studentAlarmSchema } from "../../database/mongoose-schemas.js";
import { getModel, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import { DeviceRegistrationConflictError } from "./notification.types.js";
import type { DeviceTokenRecord, DeviceTokenRegistrationInput, NotificationDeliveryRecord, NotificationJobRecord, NotificationJobStatus, NotificationPreferenceRecord, NotificationRepository, StudentAlarmRecord } from "./notification.types.js";

@Injectable()
export class MongoNotificationRepository implements NotificationRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async upsertDeviceToken(input: DeviceTokenRegistrationInput): Promise<DeviceTokenRecord> {
    const model = await this.model("DeviceToken", deviceTokenSchema);
    const existingInstallation = await model.findOne({ installationHash: input.installationHash });
    const existingToken = await model.findOne({ token: input.token });
    const installationRecord = existingInstallation ? toDomainRecord<DeviceTokenRecord>(existingInstallation) : null;
    const tokenRecord = existingToken ? toDomainRecord<DeviceTokenRecord>(existingToken) : null;

    if (installationRecord?.status === "active" && installationRecord.userId !== input.userId) {
      throw new DeviceRegistrationConflictError();
    }
    if (
      tokenRecord?.status === "active"
      && (
        tokenRecord.userId !== input.userId
        || Boolean(tokenRecord.installationHash && tokenRecord.installationHash !== input.installationHash)
      )
    ) {
      throw new DeviceRegistrationConflictError();
    }

    if (existingInstallation && existingToken && existingInstallation.id !== existingToken.id) {
      const deleted = await model.deleteOne({ _id: existingToken.id, status: "disabled" });
      if (deleted.deletedCount !== 1) throw new DeviceRegistrationConflictError();
    }

    const existing = existingInstallation ?? existingToken;
    try {
      const document = existing
        ? await model.findOneAndUpdate(
          {
            _id: existing.id,
            $or: [{ status: { $ne: "active" } }, { userId: input.userId }]
          },
          { ...input, status: "active", lastSeenAt: new Date() },
          { returnDocument: "after" }
        )
        : await model.create({ ...input, status: "active", lastSeenAt: new Date() });
      if (!document) throw new DeviceRegistrationConflictError();
      return toDomainRecord<DeviceTokenRecord>(document);
    } catch (error) {
      if (error instanceof DeviceRegistrationConflictError || isDuplicateKeyError(error)) {
        throw new DeviceRegistrationConflictError();
      }
      throw error;
    }
  }

  async disableDeviceInstallation(userId: string, installationHash: string): Promise<DeviceTokenRecord | null> {
    const model = await this.model("DeviceToken", deviceTokenSchema);
    const existing = await model.findOne({ installationHash });
    if (!existing) return null;
    const record = toDomainRecord<DeviceTokenRecord>(existing);
    if (record.status === "disabled") return null;
    if (record.userId !== userId) throw new DeviceRegistrationConflictError();
    const document = await model.findOneAndUpdate(
      { _id: existing.id, userId, installationHash, status: "active" },
      { status: "disabled" },
      { returnDocument: "after" }
    );
    return document ? toDomainRecord<DeviceTokenRecord>(document) : null;
  }

  async findActiveDeviceTokenById(deviceTokenId: string): Promise<DeviceTokenRecord | null> {
    const document = await (await this.model("DeviceToken", deviceTokenSchema)).findOne({
      _id: deviceTokenId,
      status: "active",
      installationHash: { $type: "string", $ne: "" }
    });
    return document ? toDomainRecord<DeviceTokenRecord>(document) : null;
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
      const document = await model.findOneAndUpdate({ userId: job.userId, eventId: job.eventId, trigger: job.trigger, offsetDays: job.offsetDays, offsetHours: job.offsetHours ?? 0 }, job, { new: true, upsert: true });
      documents.push(document);
    }
    return documents.map((document) => toDomainRecord<NotificationJobRecord>(document));
  }

  async createStudentAlarm(input: Omit<StudentAlarmRecord, "id" | "createdAt" | "updatedAt">): Promise<StudentAlarmRecord> {
    const document = await (await this.model("StudentAlarm", studentAlarmSchema)).findOneAndUpdate(
      {
        userId: input.userId,
        targetId: input.targetId,
        eventType: input.eventType,
        trigger: input.trigger,
        amount: input.amount,
        unit: input.unit,
        status: { $ne: "cancelled" }
      },
      input,
      { new: true, upsert: true }
    );
    return toDomainRecord<StudentAlarmRecord>(document);
  }

  async listStudentAlarmsByUser(userId: string): Promise<StudentAlarmRecord[]> {
    const documents = await (await this.model("StudentAlarm", studentAlarmSchema)).find({ userId }).sort({ scheduledAt: 1 });
    return documents.map((document) => toDomainRecord<StudentAlarmRecord>(document));
  }

  async cancelStudentAlarm(userId: string, alarmId: string): Promise<StudentAlarmRecord | null> {
    const document = await (await this.model("StudentAlarm", studentAlarmSchema)).findOneAndUpdate({ _id: alarmId, userId }, { status: "cancelled" }, { new: true });
    if (!document) return null;
    await (await this.model("NotificationJob", notificationJobSchema)).updateMany(
      { alarmId },
      { $set: { status: "cancelled" }, $unset: { processingClaimId: 1, processingLeaseUntil: 1 } }
    );
    return toDomainRecord<StudentAlarmRecord>(document);
  }

  async listJobsByCalendar(calendarId: string): Promise<NotificationJobRecord[]> {
    const documents = await (await this.model("NotificationJob", notificationJobSchema)).find({ calendarId }).sort({ scheduledAt: 1 });
    return documents.map((document) => toDomainRecord<NotificationJobRecord>(document));
  }

  async listDueJobs(now: Date, limit: number): Promise<NotificationJobRecord[]> {
    const documents = await (await this.model("NotificationJob", notificationJobSchema))
      .find(dueNotificationJobFilter(now))
      .sort({ scheduledAt: 1 })
      .limit(limit);
    return documents.map((document) => toDomainRecord<NotificationJobRecord>(document));
  }

  async claimDueJob(jobId: string, now: Date, claimId: string, leaseUntil: Date): Promise<NotificationJobRecord | null> {
    if (!claimId.trim() || leaseUntil <= now) return null;
    const document = await (await this.model("NotificationJob", notificationJobSchema)).findOneAndUpdate(
      { _id: jobId, ...dueNotificationJobFilter(now) },
      { $set: { status: "processing", processingClaimId: claimId, processingLeaseUntil: leaseUntil } },
      { returnDocument: "after" }
    );
    return document ? toDomainRecord<NotificationJobRecord>(document) : null;
  }

  async completeClaimedJob(jobId: string, claimId: string, status: "sent" | "failed" | "cancelled"): Promise<NotificationJobRecord | null> {
    const document = await (await this.model("NotificationJob", notificationJobSchema)).findOneAndUpdate(
      { _id: jobId, status: "processing", processingClaimId: claimId },
      { $set: { status }, $unset: { processingClaimId: 1, processingLeaseUntil: 1 } },
      { returnDocument: "after" }
    );
    return document ? toDomainRecord<NotificationJobRecord>(document) : null;
  }

  async rescheduleClaimedJob(jobId: string, claimId: string, scheduledAt: Date): Promise<NotificationJobRecord | null> {
    const document = await (await this.model("NotificationJob", notificationJobSchema)).findOneAndUpdate(
      { _id: jobId, status: "processing", processingClaimId: claimId },
      { $set: { status: "scheduled", scheduledAt }, $unset: { processingClaimId: 1, processingLeaseUntil: 1 } },
      { returnDocument: "after" }
    );
    return document ? toDomainRecord<NotificationJobRecord>(document) : null;
  }

  async listFailedJobs(limit: number, offset: number): Promise<NotificationJobRecord[]> {
    const documents = await (await this.model("NotificationJob", notificationJobSchema)).find({ status: "failed" }).sort({ updatedAt: -1 }).skip(offset).limit(limit);
    return documents.map((document) => toDomainRecord<NotificationJobRecord>(document));
  }

  async listActiveDeviceTokens(limit: number, offset: number): Promise<DeviceTokenRecord[]> {
    const documents = await (await this.model("DeviceToken", deviceTokenSchema))
      .find({ status: "active", installationHash: { $type: "string", $ne: "" } })
      .sort({ lastSeenAt: -1, _id: 1 })
      .skip(offset)
      .limit(limit);
    return documents.map((document) => toDomainRecord<DeviceTokenRecord>(document));
  }

  async listSentDeviceTokenIdsForJob(jobId: string): Promise<string[]> {
    const ids = await (await this.model("NotificationDelivery", notificationDeliverySchema))
      .distinct("deviceTokenId", { jobId, status: "sent" });
    return ids.filter((id): id is string => typeof id === "string");
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
    const update = status === "processing"
      ? { $set: { status } }
      : { $set: { status }, $unset: { processingClaimId: 1, processingLeaseUntil: 1 } };
    const document = await (await this.model("NotificationJob", notificationJobSchema)).findByIdAndUpdate(jobId, update, { new: true });
    return document ? toDomainRecord<NotificationJobRecord>(document) : null;
  }

  async rescheduleJob(jobId: string, scheduledAt: Date): Promise<NotificationJobRecord | null> {
    const document = await (await this.model("NotificationJob", notificationJobSchema)).findOneAndUpdate(
      { _id: jobId, status: "failed" },
      { $set: { status: "scheduled", scheduledAt }, $unset: { processingClaimId: 1, processingLeaseUntil: 1 } },
      { returnDocument: "after" }
    );
    return document ? toDomainRecord<NotificationJobRecord>(document) : null;
  }

  async disableDeviceToken(token: string): Promise<DeviceTokenRecord | null> {
    const document = await (await this.model("DeviceToken", deviceTokenSchema)).findOneAndUpdate({ token }, { status: "disabled" }, { new: true });
    return document ? toDomainRecord<DeviceTokenRecord>(document) : null;
  }

  async deleteUserData(userId: string): Promise<void> {
    await (await this.model("DeviceToken", deviceTokenSchema)).deleteMany({ userId });
    await (await this.model("NotificationPreference", notificationPreferenceSchema)).deleteMany({ userId });
    await (await this.model("StudentAlarm", studentAlarmSchema)).deleteMany({ userId });
    await (await this.model("NotificationJob", notificationJobSchema)).deleteMany({ userId });
    await (await this.model("NotificationDelivery", notificationDeliverySchema)).deleteMany({ userId });
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

function dueNotificationJobFilter(now: Date) {
  return {
    scheduledAt: { $lte: now },
    $or: [
      { status: "scheduled" },
      { status: "processing", processingLeaseUntil: { $lte: now } },
      { status: "processing", processingLeaseUntil: { $exists: false } }
    ]
  };
}
