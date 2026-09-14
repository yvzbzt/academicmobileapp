import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { deviceTokenSchema, notificationDeliverySchema, notificationJobSchema, notificationPreferenceSchema, studentAlarmSchema } from "../../database/mongoose-schemas.js";
import { getModel, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import { protectSensitiveValue, revealSensitiveValue, sensitiveLookupHash } from "../../security/data-protection.js";
import { DeviceRegistrationConflictError } from "./notification.types.js";
import type { DeviceTokenRecord, DeviceTokenRegistrationInput, NotificationDeliveryAttemptClaimInput, NotificationDeliveryAttemptFence, NotificationDeliveryAttemptFinalizeInput, NotificationDeliveryAttemptRecord, NotificationDeliveryRecord, NotificationJobCreateInput, NotificationJobFailureReason, NotificationJobRecord, NotificationJobStatus, NotificationPreferenceRecord, NotificationProducerDestinationRecord, NotificationRepository, StudentAlarmRecord } from "./notification.types.js";

@Injectable()
export class MongoNotificationRepository implements NotificationRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async upsertDeviceToken(input: DeviceTokenRegistrationInput): Promise<DeviceTokenRecord> {
    const model = await this.model("DeviceToken", deviceTokenSchema);
    const existingInstallation = await model.findOne({ installationHash: input.installationHash });
    const tokenLookupHash = sensitiveLookupHash(input.token, "deviceToken.token");
    const existingToken = await model.findOne({
      $or: [{ tokenLookupHash }, { token: input.token }]
    });
    const installationRecord = existingInstallation ? toDeviceTokenRecord(existingInstallation) : null;
    const tokenRecord = existingToken ? toDeviceTokenRecord(existingToken) : null;
    const protectedInput = {
      ...input,
      token: protectSensitiveValue(input.token, "deviceToken.token"),
      tokenLookupHash
    };

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
          { ...protectedInput, status: "active", lastSeenAt: new Date() },
          { returnDocument: "after" }
        )
        : await model.create({ ...protectedInput, status: "active", lastSeenAt: new Date() });
      if (!document) throw new DeviceRegistrationConflictError();
      return toDeviceTokenRecord(document);
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
    const record = toDeviceTokenRecord(existing);
    if (record.status === "disabled") return null;
    if (record.userId !== userId) throw new DeviceRegistrationConflictError();
    const document = await model.findOneAndUpdate(
      { _id: existing.id, userId, installationHash, status: "active" },
      { status: "disabled" },
      { returnDocument: "after" }
    );
    return document ? toDeviceTokenRecord(document) : null;
  }

  async findActiveDeviceTokenById(deviceTokenId: string): Promise<DeviceTokenRecord | null> {
    const document = await (await this.model("DeviceToken", deviceTokenSchema)).findOne({
      _id: deviceTokenId,
      status: "active",
      installationHash: { $type: "string", $ne: "" }
    });
    return document ? toDeviceTokenRecord(document) : null;
  }

  async findPreferencesByUserId(userId: string): Promise<NotificationPreferenceRecord | null> {
    const document = await (await this.model("NotificationPreference", notificationPreferenceSchema)).findOne({ userId });
    return document ? toDomainRecord<NotificationPreferenceRecord>(document) : null;
  }

  async upsertPreferences(input: Omit<NotificationPreferenceRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationPreferenceRecord> {
    const document = await (await this.model("NotificationPreference", notificationPreferenceSchema)).findOneAndUpdate({ userId: input.userId }, input, { new: true, upsert: true });
    return toDomainRecord<NotificationPreferenceRecord>(document);
  }

  async createNotificationJobs(input: NotificationJobCreateInput[]): Promise<NotificationJobRecord[]> {
    const model = await this.model("NotificationJob", notificationJobSchema);
    const documents = [];
    for (const job of input) {
      if (await model.findOne(notificationJobIdentityFilter(job))) continue;
      try {
        const document = await model.create({
          ...job,
          revision: 1,
          deliveryAttemptEpoch: 0,
          attemptCount: 0,
          maxAttempts: job.maxAttempts ?? DEFAULT_NOTIFICATION_MAX_ATTEMPTS
        });
        documents.push(document);
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }
    return documents.map(toNotificationJobRecord);
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
    return documents.map(toNotificationJobRecord);
  }

  async listDueJobs(now: Date, limit: number): Promise<NotificationJobRecord[]> {
    const documents = await (await this.model("NotificationJob", notificationJobSchema))
      .find(dueNotificationJobFilter(now))
      .sort({ scheduledAt: 1 })
      .limit(limit);
    return documents.map(toNotificationJobRecord);
  }

  async claimDueJob(jobId: string, now: Date, claimId: string, leaseUntil: Date): Promise<NotificationJobRecord | null> {
    if (!claimId.trim() || leaseUntil <= now) return null;
    const document = await (await this.model("NotificationJob", notificationJobSchema)).findOneAndUpdate(
      { _id: jobId, ...dueNotificationJobFilter(now) },
      { $set: { status: "processing", processingClaimId: claimId, processingLeaseUntil: leaseUntil } },
      { returnDocument: "after" }
    );
    return document ? toNotificationJobRecord(document) : null;
  }

  async renewClaimedJob(jobId: string, claimId: string, revision: number, leaseUntil: Date): Promise<NotificationJobRecord | null> {
    const document = await (await this.model("NotificationJob", notificationJobSchema)).findOneAndUpdate(
      {
        _id: jobId,
        status: "processing",
        processingClaimId: claimId,
        $or: [{ revision }, ...(revision === 1 ? [{ revision: { $exists: false } }] : [])]
      },
      { $set: { processingLeaseUntil: leaseUntil } },
      { returnDocument: "after" }
    );
    return document ? toNotificationJobRecord(document) : null;
  }

  async completeClaimedJob(jobId: string, claimId: string, status: "sent" | "failed" | "cancelled"): Promise<NotificationJobRecord | null> {
    const document = await (await this.model("NotificationJob", notificationJobSchema)).findOneAndUpdate(
      { _id: jobId, status: "processing", processingClaimId: claimId },
      { $set: { status }, $unset: { processingClaimId: 1, processingLeaseUntil: 1 } },
      { returnDocument: "after" }
    );
    return document ? toNotificationJobRecord(document) : null;
  }

  async rescheduleClaimedJob(jobId: string, claimId: string, scheduledAt: Date): Promise<NotificationJobRecord | null> {
    const document = await (await this.model("NotificationJob", notificationJobSchema)).findOneAndUpdate(
      { _id: jobId, status: "processing", processingClaimId: claimId },
      { $set: { status: "scheduled", scheduledAt }, $unset: { processingClaimId: 1, processingLeaseUntil: 1 } },
      { returnDocument: "after" }
    );
    return document ? toNotificationJobRecord(document) : null;
  }

  async failClaimedJob(input: {
    jobId: string;
    claimId: string;
    revision: number;
    failedAt: Date;
    retryAt: Date;
    reason: NotificationJobFailureReason;
  }): Promise<NotificationJobRecord | null> {
    const model = await this.model("NotificationJob", notificationJobSchema);
    const claimedDocument = await model.findOne({
      _id: input.jobId,
      status: "processing",
      processingClaimId: input.claimId
    });
    if (!claimedDocument) return null;
    const claimed = toNotificationJobRecord(claimedDocument);
    if (claimed.revision !== input.revision) return null;
    const attemptCount = claimed.attemptCount + 1;
    const exhausted = attemptCount >= claimed.maxAttempts;
    const document = await model.findOneAndUpdate(
      {
        _id: input.jobId,
        status: "processing",
        processingClaimId: input.claimId,
        $or: [{ revision: input.revision }, ...(input.revision === 1 ? [{ revision: { $exists: false } }] : [])]
      },
      {
        $set: {
          status: exhausted ? "dead" : "scheduled",
          attemptCount,
          lastAttemptAt: input.failedAt,
          lastFailureReason: input.reason,
          ...(exhausted ? { exhaustedAt: input.failedAt } : { scheduledAt: input.retryAt })
        },
        $unset: {
          processingClaimId: 1,
          processingLeaseUntil: 1,
          ...(!exhausted ? { exhaustedAt: 1 } : {})
        }
      },
      { returnDocument: "after" }
    );
    return document ? toNotificationJobRecord(document) : null;
  }

  async syncProducedJobs(input: {
    producerKey: string;
    producerGroupKey?: string;
    jobs: NotificationJobCreateInput[];
    retainJobs?: NotificationJobCreateInput[];
  }): Promise<{ active: NotificationJobRecord[]; retired: number }> {
    const model = await this.model("NotificationJob", notificationJobSchema);
    const desiredIdentityKeys = new Set([...input.jobs, ...(input.retainJobs ?? [])].map(notificationJobProducerMatchKey));
    const ownedDocuments = await model.find({ $or: [{ producerKey: input.producerKey }, { producerKeys: input.producerKey }] });
    let retired = 0;
    for (const document of ownedDocuments) {
      const existing = toNotificationJobRecord(document);
      if (desiredIdentityKeys.has(notificationJobProducerMatchKey(existing))) continue;
      if (await this.removeProducerRelationship(existing.id, input.producerKey)) retired += 1;
    }

    const active: NotificationJobRecord[] = [];
    for (const raw of input.jobs) {
      const desired = normalizeProducedJobInput({
        ...raw,
        producerKey: input.producerKey,
        producerKeys: [input.producerKey],
        ...(input.producerGroupKey ? { producerGroupKey: input.producerGroupKey } : {})
      }, input.producerKey);
      const identityFilter = notificationJobIdentityFilter(desired);
      const dedupeFilter = notificationJobDedupeFilter(desired);
      let document = dedupeFilter ? await model.findOne(dedupeFilter) : await model.findOne(identityFilter);
      if (!document && dedupeFilter) document = await model.findOne(identityFilter);
      if (!document) {
        try {
          document = await model.findOneAndUpdate(
            identityFilter,
            { $setOnInsert: { ...desired, producerKeys: [input.producerKey], producerDestinations: [producerDestinationFor(raw, input.producerKey)], revision: 1, deliveryAttemptEpoch: 0, attemptCount: 0, maxAttempts: desired.maxAttempts ?? DEFAULT_NOTIFICATION_MAX_ATTEMPTS } },
            { returnDocument: "after", upsert: true }
          );
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
          document = dedupeFilter ? await model.findOne(dedupeFilter) : await model.findOne(identityFilter);
        }
      }
      if (!document) throw new Error("NOTIFICATION_JOB_SYNC_FAILED");
      let existing = toNotificationJobRecord(document);
      existing = await this.attachProducerRelationship(
        existing.id,
        input.producerKey,
        producerDestinationFor(raw, input.producerKey),
        notificationJobProducerMatchKey(existing) === notificationJobProducerMatchKey(desired)
      );
      const producerKeys = notificationJobProducerKeys(existing);
      const producerDestinations = notificationJobProducerDestinations(existing);
      if (notificationJobMaterialKey(existing) !== notificationJobMaterialKey(desired) || existing.status === "cancelled") {
        document = await model.findOneAndUpdate(
          {
            _id: existing.id,
            $and: [
              { $or: [{ revision: existing.revision }, ...(existing.revision === 1 ? [{ revision: { $exists: false } }] : [])] },
              producerRelationshipRevisionFilter(existing)
            ]
          },
          {
            $set: {
              ...desired,
              producerKey: existing.producerKey ?? input.producerKey,
              producerKeys,
              producerDestinations,
              status: "scheduled",
              revision: existing.revision + 1,
              attemptCount: 0,
              maxAttempts: desired.maxAttempts ?? existing.maxAttempts
            },
            $unset: {
              lastAttemptAt: 1,
              lastFailureReason: 1,
              exhaustedAt: 1,
              processingClaimId: 1,
              processingLeaseUntil: 1
            }
          },
          { returnDocument: "after" }
        );
        if (!document) {
          const concurrentDocument = await model.findById(existing.id);
          if (!concurrentDocument) throw new Error("NOTIFICATION_JOB_SYNC_CONFLICT");
          const concurrent = toNotificationJobRecord(concurrentDocument);
          if (notificationJobMaterialKey(concurrent) !== notificationJobMaterialKey(desired) || concurrent.status === "cancelled") {
            throw new Error("NOTIFICATION_JOB_SYNC_CONFLICT");
          }
          document = concurrentDocument;
        }
      }
      active.push(toNotificationJobRecord(document));
    }
    for (const raw of input.retainJobs ?? []) {
      const retained = normalizeProducedJobInput({
        ...raw,
        producerKey: input.producerKey,
        producerKeys: [input.producerKey],
        ...(input.producerGroupKey ? { producerGroupKey: input.producerGroupKey } : {})
      }, input.producerKey);
      const dedupeFilter = notificationJobDedupeFilter(retained);
      let document = dedupeFilter ? await model.findOne(dedupeFilter) : await model.findOne(notificationJobIdentityFilter(retained));
      if (!document && dedupeFilter) document = await model.findOne(notificationJobIdentityFilter(retained));
      if (!document) continue;
      const existing = toNotificationJobRecord(document);
      const producerDestination = producerDestinationFor(raw, input.producerKey);
      const related = await this.attachProducerRelationship(existing.id, input.producerKey, producerDestination, true);
      if (!active.some((job) => job.id === related.id)) active.push(related);
    }
    return { active, retired };
  }

  async retireProducedJobs(producerKey: string): Promise<number> {
    const model = await this.model("NotificationJob", notificationJobSchema);
    const documents = await model.find({ $or: [{ producerKey }, { producerKeys: producerKey }] });
    let retired = 0;
    for (const document of documents) {
      const job = toNotificationJobRecord(document);
      if (await this.removeProducerRelationship(job.id, producerKey)) retired += 1;
    }
    return retired;
  }

  async retireProducerGroupRelationships(producerGroupKey: string): Promise<number> {
    const model = await this.model("NotificationJob", notificationJobSchema);
    const producerKeyPattern = new RegExp(`^${escapeRegularExpression(producerGroupKey)}(?::|$)`, "u");
    let retired = 0;
    for (let attempt = 0; attempt < PRODUCER_RELATIONSHIP_CAS_ATTEMPTS; attempt += 1) {
      const documents = await model.find({
        $or: [{ producerKey: producerKeyPattern }, { producerKeys: producerKeyPattern }]
      });
      const producerKeys = new Set(documents.flatMap((document) => {
        const job = toNotificationJobRecord(document);
        return notificationJobProducerKeys(job)
          .filter((producerKey) => producerBelongsToGroup(producerKey, producerGroupKey));
      }));
      if (producerKeys.size === 0) return retired;
      for (const producerKey of [...producerKeys].sort()) {
        retired += await this.retireProducedJobs(producerKey);
      }
    }
    throw new Error("NOTIFICATION_PRODUCER_GROUP_RETIREMENT_CONFLICT");
  }

  async retireSupersededProducerJobs(producerGroupKey: string, activeProducerKey: string): Promise<number> {
    return this.retireJobs({ producerGroupKey, producerKey: { $ne: activeProducerKey } });
  }

  async listJobsForDestinationValidation(limit: number, offset: number): Promise<NotificationJobRecord[]> {
    const documents = await (await this.model("NotificationJob", notificationJobSchema))
      .find({ status: { $in: ["scheduled", "processing"] }, destinationType: { $exists: true }, destinationId: { $type: "string", $ne: "" } })
      .sort({ scheduledAt: 1 })
      .skip(offset)
      .limit(limit);
    return documents.map(toNotificationJobRecord);
  }

  async getWorkerBacklog(now: Date): Promise<{ due: number; retrying: number; processing: number; dead: number }> {
    const model = await this.model("NotificationJob", notificationJobSchema);
    const [due, retrying, processing, dead] = await Promise.all([
      model.countDocuments(dueNotificationJobFilter(now)),
      model.countDocuments({ status: "scheduled", attemptCount: { $gt: 0 } }),
      model.countDocuments({ status: "processing" }),
      model.countDocuments({ status: "dead" })
    ]);
    return { due, retrying, processing, dead };
  }

  async listFailedJobs(limit: number, offset: number): Promise<NotificationJobRecord[]> {
    const documents = await (await this.model("NotificationJob", notificationJobSchema)).find({ status: { $in: ["failed", "dead"] } }).sort({ updatedAt: -1 }).skip(offset).limit(limit);
    return documents.map(toNotificationJobRecord);
  }

  async listActiveDeviceTokens(limit: number, offset: number): Promise<DeviceTokenRecord[]> {
    const documents = await (await this.model("DeviceToken", deviceTokenSchema))
      .find({ status: "active", installationHash: { $type: "string", $ne: "" } })
      .sort({ lastSeenAt: -1, _id: 1 })
      .skip(offset)
      .limit(limit);
    return documents.map(toDeviceTokenRecord);
  }

  async listSentDeviceTokenIdsForJob(jobId: string, revision = 1): Promise<string[]> {
    const ids = await (await this.model("NotificationDelivery", notificationDeliverySchema))
      .distinct("deviceTokenId", {
        jobId,
        status: "sent",
        ...(revision === 1 ? { $or: [{ jobRevision: 1 }, { jobRevision: { $exists: false } }] } : { jobRevision: revision })
      });
    return ids.filter((id): id is string => typeof id === "string");
  }

  async claimDeliveryAttempt(input: NotificationDeliveryAttemptClaimInput): Promise<{ claimed: boolean; attempt: NotificationDeliveryAttemptRecord }> {
    const model = await this.model("NotificationDelivery", notificationDeliverySchema);
    let document;
    try {
      document = await model.findOneAndUpdate(
        { attemptIdentity: input.attemptIdentity },
        {
          $setOnInsert: {
            jobId: input.jobId,
            jobRevision: input.jobRevision,
            attemptIdentity: input.attemptIdentity,
            attemptVersion: input.attemptVersion,
            deviceInstallationHash: input.deviceInstallationHash,
            userId: input.userId,
            deviceTokenId: input.deviceTokenId,
            status: "sending",
            sendingClaimId: input.sendingClaimId,
            sendingStartedAt: input.sendingStartedAt,
            sendingLeaseUntil: input.sendingLeaseUntil
          }
        },
        { returnDocument: "after", upsert: true }
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      document = await model.findOne({ attemptIdentity: input.attemptIdentity });
    }
    if (!document) throw new Error("NOTIFICATION_DELIVERY_ATTEMPT_CLAIM_FAILED");
    const attempt = toNotificationDeliveryAttemptRecord(document);
    return {
      claimed: attempt.status === "sending" && attempt.sendingClaimId === input.sendingClaimId,
      attempt
    };
  }

  async finalizeDeliveryAttempt(input: NotificationDeliveryAttemptFinalizeInput): Promise<NotificationDeliveryAttemptRecord | null> {
    const model = await this.model("NotificationDelivery", notificationDeliverySchema);
    const document = await model.findOneAndUpdate(
      {
        attemptIdentity: input.attemptIdentity,
        status: "sending",
        sendingClaimId: input.sendingClaimId
      },
      {
        $set: {
          status: input.status,
          finalizedAt: input.finalizedAt,
          ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
          ...(input.failureReason ? { failureReason: input.failureReason } : {}),
          ...(input.deliveredAt ? { deliveredAt: input.deliveredAt } : {})
        },
        $unset: { sendingClaimId: 1, sendingLeaseUntil: 1 }
      },
      { returnDocument: "after" }
    );
    if (document) return toNotificationDeliveryAttemptRecord(document);
    const existing = await model.findOne({ attemptIdentity: input.attemptIdentity });
    return existing ? toNotificationDeliveryAttemptRecord(existing) : null;
  }

  async recoverExpiredDeliveryAttempts(now: Date): Promise<number> {
    const result = await (await this.model("NotificationDelivery", notificationDeliverySchema)).updateMany(
      {
        attemptIdentity: { $type: "string", $ne: "" },
        status: "sending",
        $or: [{ sendingLeaseUntil: { $lte: now } }, { sendingLeaseUntil: { $exists: false } }]
      },
      {
        $set: { status: "ambiguous", failureReason: "provider_outcome_unknown", finalizedAt: now },
        $unset: { sendingClaimId: 1, sendingLeaseUntil: 1 }
      }
    );
    return result.modifiedCount;
  }

  async getDeliveryAttemptBacklog(now: Date): Promise<{ sending: number; expiredSending: number; ambiguous: number }> {
    const model = await this.model("NotificationDelivery", notificationDeliverySchema);
    const attempts = { attemptIdentity: { $type: "string", $ne: "" } };
    const [sending, expiredSending, ambiguous] = await Promise.all([
      model.countDocuments({ ...attempts, status: "sending" }),
      model.countDocuments({
        ...attempts,
        status: "sending",
        $or: [{ sendingLeaseUntil: { $lte: now } }, { sendingLeaseUntil: { $exists: false } }]
      }),
      model.countDocuments({ ...attempts, status: "ambiguous" })
    ]);
    return { sending, expiredSending, ambiguous };
  }

  async listDeliveryAttemptFencesForJob(jobId: string, revision = 1): Promise<NotificationDeliveryAttemptFence[]> {
    const documents = await (await this.model("NotificationDelivery", notificationDeliverySchema)).find({
      jobId,
      status: { $in: ["sending", "sent", "invalid_device", "ambiguous"] },
      ...(revision === 1 ? { $or: [{ jobRevision: 1 }, { jobRevision: { $exists: false } }] } : { jobRevision: revision })
    });
    return documents.map((document) => {
      const delivery = toDomainRecord<NotificationDeliveryRecord>(document);
      return { deviceTokenId: delivery.deviceTokenId, status: delivery.status as NotificationDeliveryAttemptFence["status"] };
    });
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
    return document ? toNotificationJobRecord(document) : null;
  }

  async rescheduleJob(jobId: string, scheduledAt: Date): Promise<NotificationJobRecord | null> {
    const document = await (await this.model("NotificationJob", notificationJobSchema)).findOneAndUpdate(
      { _id: jobId, status: { $in: ["failed", "dead"] } },
      {
        $set: { status: "scheduled", scheduledAt, attemptCount: 0 },
        $inc: { deliveryAttemptEpoch: 1 },
        $unset: { lastAttemptAt: 1, lastFailureReason: 1, exhaustedAt: 1, processingClaimId: 1, processingLeaseUntil: 1 }
      },
      { returnDocument: "after" }
    );
    return document ? toNotificationJobRecord(document) : null;
  }

  async disableDeviceToken(token: string): Promise<DeviceTokenRecord | null> {
    const document = await (await this.model("DeviceToken", deviceTokenSchema)).findOneAndUpdate(
      { $or: [{ tokenLookupHash: sensitiveLookupHash(token, "deviceToken.token") }, { token }] },
      { status: "disabled" },
      { new: true }
    );
    return document ? toDeviceTokenRecord(document) : null;
  }

  async deleteUserData(userId: string): Promise<void> {
    await (await this.model("DeviceToken", deviceTokenSchema)).deleteMany({ userId });
    await (await this.model("NotificationPreference", notificationPreferenceSchema)).deleteMany({ userId });
    await (await this.model("StudentAlarm", studentAlarmSchema)).deleteMany({ userId });
    await (await this.model("NotificationJob", notificationJobSchema)).deleteMany({ userId });
    await (await this.model("NotificationDelivery", notificationDeliverySchema)).deleteMany({ userId });
  }

  private async attachProducerRelationship(
    jobId: string,
    producerKey: string,
    destination: NotificationProducerDestinationRecord,
    preferDestination: boolean
  ): Promise<NotificationJobRecord> {
    const model = await this.model("NotificationJob", notificationJobSchema);
    for (let attempt = 0; attempt < PRODUCER_RELATIONSHIP_CAS_ATTEMPTS; attempt += 1) {
      const document = await model.findById(jobId);
      if (!document) throw new Error("NOTIFICATION_JOB_RELATIONSHIP_SYNC_FAILED");
      const existing = toNotificationJobRecord(document);
      const producerKeys = [...new Set([...notificationJobProducerKeys(existing), producerKey])];
      const producerDestinations = upsertProducerDestination(notificationJobProducerDestinations(existing), destination);
      const destinationChanged = preferDestination && existing.destinationId !== destination.destinationId;
      const relationshipsChanged = JSON.stringify(producerKeys) !== JSON.stringify(notificationJobProducerKeys(existing))
        || JSON.stringify(producerDestinations) !== JSON.stringify(notificationJobProducerDestinations(existing));
      if (!relationshipsChanged && !destinationChanged) return existing;
      const switched = destinationChanged
        ? switchToProducerDestination({ ...existing, producerKeys, producerDestinations }, destination)
        : { ...existing, producerKeys, producerDestinations };
      const statusChanged = switched.status !== existing.status;
      const updated = await model.findOneAndUpdate(
        producerRelationshipCasFilter(existing),
        {
          $set: {
            producerKey: existing.producerKey ?? producerKey,
            producerKeys,
            producerDestinations,
            ...(destinationChanged ? {
              calendarId: switched.calendarId,
              destinationId: switched.destinationId,
              title: switched.title,
              status: switched.status
            } : {})
          },
          $inc: {
            producerRelationRevision: 1,
            ...(statusChanged ? { revision: 1 } : {})
          },
          ...(destinationChanged ? { $unset: { processingClaimId: 1, processingLeaseUntil: 1 } } : {})
        },
        { returnDocument: "after" }
      );
      if (updated) return toNotificationJobRecord(updated);
    }
    throw new Error("NOTIFICATION_JOB_RELATIONSHIP_SYNC_CONFLICT");
  }

  private async removeProducerRelationship(jobId: string, producerKey: string): Promise<boolean> {
    const model = await this.model("NotificationJob", notificationJobSchema);
    for (let attempt = 0; attempt < PRODUCER_RELATIONSHIP_CAS_ATTEMPTS; attempt += 1) {
      const document = await model.findById(jobId);
      if (!document) return false;
      const existing = toNotificationJobRecord(document);
      if (!notificationJobHasProducer(existing, producerKey)) return false;
      const remainingProducerKeys = notificationJobProducerKeys(existing).filter((key) => key !== producerKey);
      const remainingDestinations = notificationJobProducerDestinations(existing).filter((destination) => destination.producerKey !== producerKey);
      if (remainingProducerKeys.length === 0) {
        const shouldRetire = isRetirableNotificationJob(existing);
        const detached = await model.findOneAndUpdate(
          producerRelationshipCasFilter(existing),
          {
            ...(shouldRetire ? { $set: { status: "cancelled" } } : {}),
            $inc: {
              producerRelationRevision: 1,
              ...(shouldRetire ? { revision: 1 } : {})
            },
            $unset: {
              producerKey: 1,
              producerKeys: 1,
              producerDestinations: 1,
              producerGroupKey: 1,
              processingClaimId: 1,
              processingLeaseUntil: 1
            }
          },
          { returnDocument: "after" }
        );
        if (detached) return shouldRetire;
        continue;
      }
      const switched = switchToProducerDestination({
        ...existing,
        producerKey: remainingProducerKeys[0]!,
        producerKeys: remainingProducerKeys,
        producerDestinations: remainingDestinations
      }, remainingDestinations[0]);
      const statusChanged = switched.status !== existing.status;
      const updated = await model.findOneAndUpdate(
        producerRelationshipCasFilter(existing),
        {
          $set: {
            producerKey: remainingProducerKeys[0]!,
            producerKeys: remainingProducerKeys,
            producerDestinations: remainingDestinations,
            calendarId: switched.calendarId,
            destinationId: switched.destinationId,
            title: switched.title,
            status: switched.status
          },
          $inc: {
            producerRelationRevision: 1,
            ...(statusChanged ? { revision: 1 } : {})
          },
          $unset: { processingClaimId: 1, processingLeaseUntil: 1 }
        },
        { returnDocument: "after" }
      );
      if (updated) return false;
    }
    throw new Error("NOTIFICATION_JOB_RELATIONSHIP_SYNC_CONFLICT");
  }

  private async retireJobs(filter: Record<string, unknown>): Promise<number> {
    const result = await (await this.model("NotificationJob", notificationJobSchema)).updateMany(
      { ...filter, status: { $in: RETIRABLE_NOTIFICATION_JOB_STATUSES } },
      { $set: { status: "cancelled" }, $inc: { revision: 1 }, $unset: { processingClaimId: 1, processingLeaseUntil: 1 } }
    );
    return result.modifiedCount;
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}

type PersistedDeviceTokenRecord = DeviceTokenRecord & {
  tokenLookupHash?: string;
};

function toDeviceTokenRecord(document: { id: string; toObject: () => Record<string, unknown> }): DeviceTokenRecord {
  const { tokenLookupHash, ...record } = toDomainRecord<PersistedDeviceTokenRecord>(document);
  void tokenLookupHash;
  return {
    ...record,
    token: revealSensitiveValue(record.token, "deviceToken.token")
  };
}

const DEFAULT_NOTIFICATION_MAX_ATTEMPTS = 5;
const PRODUCER_RELATIONSHIP_CAS_ATTEMPTS = 12;
const RETIRABLE_NOTIFICATION_JOB_STATUSES: NotificationJobStatus[] = ["scheduled", "processing", "failed", "dead"];

function toNotificationJobRecord(document: Parameters<typeof toDomainRecord<NotificationJobRecord>>[0]): NotificationJobRecord {
  const record = toDomainRecord<NotificationJobRecord>(document);
  return {
    ...record,
    ...(record.producerKey || record.producerKeys?.length ? { producerKeys: notificationJobProducerKeys(record) } : {}),
    ...(record.producerKey || record.producerDestinations?.length ? { producerDestinations: notificationJobProducerDestinations(record) } : {}),
    producerRelationRevision: nonNegativeIntegerOr(record.producerRelationRevision, 0),
    revision: positiveIntegerOr(record.revision, 1),
    deliveryAttemptEpoch: nonNegativeIntegerOr(record.deliveryAttemptEpoch, 0),
    attemptCount: nonNegativeIntegerOr(record.attemptCount, 0),
    maxAttempts: positiveIntegerOr(record.maxAttempts, DEFAULT_NOTIFICATION_MAX_ATTEMPTS)
  };
}

function toNotificationDeliveryAttemptRecord(
  document: Parameters<typeof toDomainRecord<NotificationDeliveryAttemptRecord>>[0]
): NotificationDeliveryAttemptRecord {
  return toDomainRecord<NotificationDeliveryAttemptRecord>(document);
}

function producerRelationshipCasFilter(job: NotificationJobRecord): Record<string, unknown> {
  return {
    _id: job.id,
    status: job.status,
    $and: [
      { $or: [{ revision: job.revision }, ...(job.revision === 1 ? [{ revision: { $exists: false } }] : [])] },
      producerRelationshipRevisionFilter(job)
    ]
  };
}

function producerRelationshipRevisionFilter(job: Pick<NotificationJobRecord, "producerRelationRevision">): Record<string, unknown> {
  const relationRevision = nonNegativeIntegerOr(job.producerRelationRevision, 0);
  return {
    $or: [
      { producerRelationRevision: relationRevision },
      ...(relationRevision === 0 ? [{ producerRelationRevision: { $exists: false } }] : [])
    ]
  };
}

function notificationJobIdentityFilter(job: NotificationJobCreateInput | NotificationJobRecord) {
  return {
    userId: job.userId ?? null,
    eventId: job.eventId,
    trigger: job.trigger,
    offsetDays: job.offsetDays,
    offsetHours: job.offsetHours ?? 0
  };
}

function notificationJobIdentityKey(job: NotificationJobCreateInput | NotificationJobRecord): string {
  return JSON.stringify([
    job.userId ?? null,
    job.eventId,
    job.trigger,
    job.offsetDays,
    job.offsetHours ?? 0
  ]);
}

function notificationJobMaterialKey(job: NotificationJobCreateInput | NotificationJobRecord): string {
  if (job.destinationType === "announcement" && job.destinationScopeType && job.destinationScopeId && job.destinationFingerprint) {
    return JSON.stringify([
      job.destinationType,
      job.destinationScopeType,
      job.destinationScopeId,
      job.destinationFingerprint
    ]);
  }
  return JSON.stringify([
    job.calendarId,
    job.destinationType,
    job.destinationId,
    job.destinationScopeType,
    job.destinationScopeId,
    job.destinationFingerprint,
    job.universityId,
    job.facultyId,
    job.departmentId,
    job.title,
    job.category,
    job.scheduledAt.toISOString()
  ]);
}

function notificationJobDedupeFilter(job: NotificationJobCreateInput | NotificationJobRecord): Record<string, unknown> | null {
  if (job.destinationType !== "announcement" || !job.destinationScopeType || !job.destinationScopeId || !job.destinationFingerprint) return null;
  return {
    destinationType: job.destinationType,
    destinationScopeType: job.destinationScopeType,
    destinationScopeId: job.destinationScopeId,
    destinationFingerprint: job.destinationFingerprint
  };
}

function notificationJobProducerMatchKey(job: NotificationJobCreateInput | NotificationJobRecord): string {
  const dedupeFilter = notificationJobDedupeFilter(job);
  return dedupeFilter ? JSON.stringify(dedupeFilter) : notificationJobIdentityKey(job);
}

function notificationJobProducerKeys(job: Pick<NotificationJobRecord, "producerKey" | "producerKeys">): string[] {
  return [...new Set([...(job.producerKeys ?? []), ...(job.producerKey ? [job.producerKey] : [])])];
}

function notificationJobHasProducer(job: Pick<NotificationJobRecord, "producerKey" | "producerKeys">, producerKey: string): boolean {
  return notificationJobProducerKeys(job).includes(producerKey);
}

function producerBelongsToGroup(producerKey: string, producerGroupKey: string): boolean {
  return producerKey === producerGroupKey || producerKey.startsWith(`${producerGroupKey}:`);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizeProducedJobInput(input: NotificationJobCreateInput, producerKey: string): NotificationJobCreateInput {
  const producerDestination = producerDestinationFor(input, producerKey);
  if (input.destinationType !== "announcement" || !input.destinationScopeType || !input.destinationScopeId || !input.destinationFingerprint) {
    return { ...input, producerDestinations: [producerDestination] };
  }
  return {
    ...input,
    eventId: automaticAnnouncementEventId(input.destinationScopeType, input.destinationScopeId, input.destinationFingerprint),
    producerDestinations: [producerDestination]
  };
}

function automaticAnnouncementEventId(scopeType: string, scopeId: string, fingerprint: string): string {
  return `announcement:${createHash("sha256").update("academic-mobile:notification-job:v1\0").update(scopeType).update("\0").update(scopeId).update("\0").update(fingerprint).digest("hex")}`;
}

function producerDestinationFor(job: Pick<NotificationJobRecord, "calendarId" | "eventId" | "destinationId" | "title">, producerKey: string): NotificationProducerDestinationRecord {
  return {
    producerKey,
    calendarId: job.calendarId,
    eventId: job.eventId,
    destinationId: job.destinationId ?? job.eventId,
    title: job.title
  };
}

function notificationJobProducerDestinations(job: Pick<NotificationJobRecord, "producerKey" | "producerDestinations" | "calendarId" | "eventId" | "destinationId" | "title">): NotificationProducerDestinationRecord[] {
  if (job.producerDestinations?.length) return job.producerDestinations;
  return job.producerKey ? [producerDestinationFor(job, job.producerKey)] : [];
}

function upsertProducerDestination(
  destinations: NotificationProducerDestinationRecord[],
  destination: NotificationProducerDestinationRecord
): NotificationProducerDestinationRecord[] {
  return [...destinations.filter((candidate) => candidate.producerKey !== destination.producerKey), destination];
}

function switchToProducerDestination(job: NotificationJobRecord, destination: NotificationProducerDestinationRecord | undefined): NotificationJobRecord {
  if (!destination) return job;
  const switched = {
    ...job,
    calendarId: destination.calendarId,
    destinationId: destination.destinationId,
    title: destination.title,
    status: job.status === "processing" || job.status === "cancelled" ? "scheduled" as const : job.status
  };
  delete switched.processingClaimId;
  delete switched.processingLeaseUntil;
  return switched;
}

function isRetirableNotificationJob(job: NotificationJobRecord): boolean {
  return RETIRABLE_NOTIFICATION_JOB_STATUSES.includes(job.status);
}

function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value! : fallback;
}

function nonNegativeIntegerOr(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? -1) >= 0 ? value! : fallback;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

function dueNotificationJobFilter(now: Date) {
  return {
    scheduledAt: { $lte: now },
    exhaustedAt: { $exists: false },
    $expr: {
      $lt: [
        { $ifNull: ["$attemptCount", 0] },
        { $ifNull: ["$maxAttempts", DEFAULT_NOTIFICATION_MAX_ATTEMPTS] }
      ]
    },
    $or: [
      { status: "scheduled" },
      { status: "processing", processingLeaseUntil: { $lte: now } },
      { status: "processing", processingLeaseUntil: { $exists: false } }
    ]
  };
}
