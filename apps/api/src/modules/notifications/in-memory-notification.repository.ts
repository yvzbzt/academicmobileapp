import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { DeviceRegistrationConflictError } from "./notification.types.js";
import type { DeviceTokenRecord, DeviceTokenRegistrationInput, NotificationDeliveryAttemptClaimInput, NotificationDeliveryAttemptFence, NotificationDeliveryAttemptFinalizeInput, NotificationDeliveryAttemptRecord, NotificationDeliveryRecord, NotificationJobCreateInput, NotificationJobRecord, NotificationJobStatus, NotificationPreferenceRecord, NotificationProducerDestinationRecord, NotificationRepository, StudentAlarmRecord } from "./notification.types.js";

@Injectable()
export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly deviceTokens = new Map<string, DeviceTokenRecord>();
  private readonly preferences = new Map<string, NotificationPreferenceRecord>();
  private readonly jobs = new Map<string, NotificationJobRecord>();
  private readonly deliveries = new Map<string, NotificationDeliveryRecord>();
  private readonly studentAlarms = new Map<string, StudentAlarmRecord>();

  async upsertDeviceToken(input: DeviceTokenRegistrationInput): Promise<DeviceTokenRecord> {
    const now = new Date();
    const existingInstallation = [...this.deviceTokens.values()].find((device) => device.installationHash === input.installationHash);
    const existingToken = [...this.deviceTokens.values()].find((device) => device.token === input.token);
    if (existingInstallation?.status === "active" && existingInstallation.userId !== input.userId) {
      throw new DeviceRegistrationConflictError();
    }
    if (
      existingToken?.status === "active"
      && (
        existingToken.userId !== input.userId
        || Boolean(existingToken.installationHash && existingToken.installationHash !== input.installationHash)
      )
    ) {
      throw new DeviceRegistrationConflictError();
    }
    if (existingInstallation && existingToken && existingInstallation.id !== existingToken.id) {
      if (existingToken.status === "active") throw new DeviceRegistrationConflictError();
      this.deviceTokens.delete(existingToken.id);
    }
    const existing = existingInstallation ?? existingToken;
    const device: DeviceTokenRecord = {
      ...(existing ?? { id: randomUUID(), createdAt: now }),
      userId: input.userId,
      platform: input.platform,
      token: input.token,
      installationHash: input.installationHash,
      status: "active",
      lastSeenAt: now,
      updatedAt: now
    };
    this.deviceTokens.set(device.id, device);
    return device;
  }

  async disableDeviceInstallation(userId: string, installationHash: string): Promise<DeviceTokenRecord | null> {
    const device = [...this.deviceTokens.values()].find((record) => record.installationHash === installationHash);
    if (!device || device.status === "disabled") return null;
    if (device.userId !== userId) throw new DeviceRegistrationConflictError();
    const updated: DeviceTokenRecord = { ...device, status: "disabled", updatedAt: new Date() };
    this.deviceTokens.set(device.id, updated);
    return updated;
  }

  async findActiveDeviceTokenById(deviceTokenId: string): Promise<DeviceTokenRecord | null> {
    const device = this.deviceTokens.get(deviceTokenId);
    if (!device || device.status !== "active" || !device.installationHash) return null;
    return device;
  }

  async findPreferencesByUserId(userId: string): Promise<NotificationPreferenceRecord | null> {
    return this.preferences.get(userId) ?? null;
  }

  async upsertPreferences(input: Omit<NotificationPreferenceRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationPreferenceRecord> {
    const now = new Date();
    const existing = this.preferences.get(input.userId);
    const preferences: NotificationPreferenceRecord = {
      ...(existing ?? { id: randomUUID(), createdAt: now }),
      userId: input.userId,
      enabled: input.enabled,
      ...(input.deliveryConsentVersion ? { deliveryConsentVersion: input.deliveryConsentVersion } : {}),
      categories: input.categories,
      reminderOffsets: [...new Set(input.reminderOffsets)].sort((left, right) => right - left),
      ...(input.reminderRules ? { reminderRules: input.reminderRules } : {}),
      ...(input.quietHours ? { quietHours: input.quietHours } : {}),
      updatedAt: now
    };
    this.preferences.set(input.userId, preferences);
    return preferences;
  }

  async createNotificationJobs(input: NotificationJobCreateInput[]): Promise<NotificationJobRecord[]> {
    const now = new Date();
    const created: NotificationJobRecord[] = [];
    for (const jobInput of input) {
      const existing = [...this.jobs.values()].find((job) => notificationJobIdentityKey(job) === notificationJobIdentityKey(jobInput) && notificationJobReminderKey(job) === notificationJobReminderKey(jobInput) && job.status !== "cancelled");
      if (existing) continue;
      const job: NotificationJobRecord = withNewJobLifecycle(jobInput, randomUUID(), now);
      this.jobs.set(job.id, job);
      created.push(job);
    }
    return created;
  }

  async createStudentAlarm(input: Omit<StudentAlarmRecord, "id" | "createdAt" | "updatedAt">): Promise<StudentAlarmRecord> {
    const now = new Date();
    const existing = [...this.studentAlarms.values()].find((alarm) =>
      alarm.userId === input.userId &&
      alarm.targetId === input.targetId &&
      alarm.eventType === input.eventType &&
      alarm.trigger === input.trigger &&
      alarm.amount === input.amount &&
      alarm.unit === input.unit &&
      alarm.status !== "cancelled"
    );
    const alarm: StudentAlarmRecord = {
      ...(existing ?? { id: randomUUID(), createdAt: now }),
      ...input,
      updatedAt: now
    };
    this.studentAlarms.set(alarm.id, alarm);
    return alarm;
  }

  async listStudentAlarmsByUser(userId: string): Promise<StudentAlarmRecord[]> {
    return [...this.studentAlarms.values()]
      .filter((alarm) => alarm.userId === userId)
      .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());
  }

  async cancelStudentAlarm(userId: string, alarmId: string): Promise<StudentAlarmRecord | null> {
    const existing = this.studentAlarms.get(alarmId);
    if (!existing || existing.userId !== userId) return null;
    const updated: StudentAlarmRecord = { ...existing, status: "cancelled", updatedAt: new Date() };
    this.studentAlarms.set(alarmId, updated);
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.alarmId === alarmId) {
        this.jobs.set(jobId, clearJobClaim({ ...job, status: "cancelled", updatedAt: new Date() }));
      }
    }
    return updated;
  }

  async listJobsByCalendar(calendarId: string): Promise<NotificationJobRecord[]> {
    return [...this.jobs.values()].filter((job) => job.calendarId === calendarId).sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());
  }

  async listDueJobs(now: Date, limit: number): Promise<NotificationJobRecord[]> {
    return [...this.jobs.values()]
      .filter((job) => isJobClaimable(job, now))
      .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime())
      .slice(0, limit);
  }

  async claimDueJob(jobId: string, now: Date, claimId: string, leaseUntil: Date): Promise<NotificationJobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job || !claimId.trim() || leaseUntil <= now || !isJobClaimable(job, now)) return null;
    const claimed: NotificationJobRecord = {
      ...job,
      status: "processing",
      processingClaimId: claimId,
      processingLeaseUntil: leaseUntil,
      updatedAt: now
    };
    this.jobs.set(jobId, claimed);
    return claimed;
  }

  async renewClaimedJob(jobId: string, claimId: string, revision: number, leaseUntil: Date): Promise<NotificationJobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "processing" || job.processingClaimId !== claimId || job.revision !== revision) return null;
    const renewed: NotificationJobRecord = { ...job, processingLeaseUntil: leaseUntil, updatedAt: new Date() };
    this.jobs.set(jobId, renewed);
    return renewed;
  }

  async completeClaimedJob(jobId: string, claimId: string, status: "sent" | "failed" | "cancelled"): Promise<NotificationJobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "processing" || job.processingClaimId !== claimId) return null;
    const completed = clearJobClaim({ ...job, status, updatedAt: new Date() });
    this.jobs.set(jobId, completed);
    return completed;
  }

  async rescheduleClaimedJob(jobId: string, claimId: string, scheduledAt: Date): Promise<NotificationJobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "processing" || job.processingClaimId !== claimId) return null;
    const rescheduled = clearJobClaim({ ...job, status: "scheduled", scheduledAt, updatedAt: new Date() });
    this.jobs.set(jobId, rescheduled);
    return rescheduled;
  }

  async failClaimedJob(input: {
    jobId: string;
    claimId: string;
    revision: number;
    failedAt: Date;
    retryAt: Date;
    reason: NotificationJobRecord["lastFailureReason"] & string;
  }): Promise<NotificationJobRecord | null> {
    const job = this.jobs.get(input.jobId);
    if (!job || job.status !== "processing" || job.processingClaimId !== input.claimId || job.revision !== input.revision) return null;
    const attemptCount = job.attemptCount + 1;
    const exhausted = attemptCount >= job.maxAttempts;
    const failed = clearJobClaim({
      ...job,
      status: exhausted ? "dead" : "scheduled",
      attemptCount,
      lastAttemptAt: input.failedAt,
      lastFailureReason: input.reason,
      ...(exhausted ? { exhaustedAt: input.failedAt } : { scheduledAt: input.retryAt }),
      updatedAt: input.failedAt
    });
    if (!exhausted) delete failed.exhaustedAt;
    this.jobs.set(job.id, failed);
    return failed;
  }

  async syncProducedJobs(input: {
    producerKey: string;
    producerGroupKey?: string;
    jobs: NotificationJobCreateInput[];
    retainJobs?: NotificationJobCreateInput[];
  }): Promise<{ active: NotificationJobRecord[]; retired: number }> {
    const now = new Date();
    const desiredKeys = new Set([...input.jobs, ...(input.retainJobs ?? [])].map(notificationJobProducerMatchKey));
    let retired = 0;
    for (const [id, existing] of this.jobs.entries()) {
      if (!notificationJobHasProducer(existing, input.producerKey) || desiredKeys.has(notificationJobProducerMatchKey(existing))) continue;
      const remainingProducerKeys = notificationJobProducerKeys(existing).filter((key) => key !== input.producerKey);
      const remainingDestinations = notificationJobProducerDestinations(existing).filter((destination) => destination.producerKey !== input.producerKey);
      if (remainingProducerKeys.length > 0) {
        this.jobs.set(id, switchToProducerDestination({
          ...existing,
          producerKey: remainingProducerKeys[0]!,
          producerKeys: remainingProducerKeys,
          producerDestinations: remainingDestinations,
          updatedAt: now
        }, remainingDestinations[0]));
      } else if (isRetirableJob(existing)) {
        this.jobs.set(id, retireJob(existing, now));
        retired += 1;
      }
    }

    const active: NotificationJobRecord[] = [];
    for (const raw of input.jobs) {
      const jobInput = normalizeProducedJobInput({
        ...raw,
        producerKey: input.producerKey,
        producerKeys: [input.producerKey],
        ...(input.producerGroupKey ? { producerGroupKey: input.producerGroupKey } : {})
      }, input.producerKey);
      const existing = [...this.jobs.values()].find((job) => notificationJobProducerMatchKey(job) === notificationJobProducerMatchKey(jobInput))
        ?? [...this.jobs.values()].find((job) => notificationJobFullIdentityKey(job) === notificationJobFullIdentityKey(jobInput));
      if (!existing) {
        const created = withNewJobLifecycle(jobInput, randomUUID(), now);
        this.jobs.set(created.id, created);
        active.push(created);
        continue;
      }
      const producerKeys = [...new Set([...notificationJobProducerKeys(existing), input.producerKey])];
      const producerDestinations = upsertProducerDestination(
        notificationJobProducerDestinations(existing),
        producerDestinationFor(raw, input.producerKey)
      );
      if (notificationJobProducerMatchKey(existing) === notificationJobProducerMatchKey(jobInput)
        && existing.destinationId !== raw.destinationId) {
        const related = switchToProducerDestination({ ...existing, producerKeys, producerDestinations, updatedAt: now }, producerDestinationFor(raw, input.producerKey));
        this.jobs.set(existing.id, related);
        active.push(related);
        continue;
      }
      if (notificationJobMaterialKey(existing) === notificationJobMaterialKey(jobInput) && existing.status !== "cancelled") {
        const related = { ...existing, producerKeys, producerDestinations, updatedAt: now };
        this.jobs.set(existing.id, related);
        active.push(related);
        continue;
      }
      const updated = clearJobClaim({
        ...existing,
        ...jobInput,
        producerKey: existing.producerKey ?? input.producerKey,
        producerKeys,
        producerDestinations,
        status: "scheduled",
        revision: existing.revision + 1,
        attemptCount: 0,
        maxAttempts: jobInput.maxAttempts ?? existing.maxAttempts,
        updatedAt: now
      });
      delete updated.lastAttemptAt;
      delete updated.lastFailureReason;
      delete updated.exhaustedAt;
      this.jobs.set(existing.id, updated);
      active.push(updated);
    }
    for (const raw of input.retainJobs ?? []) {
      const retainedInput = normalizeProducedJobInput({
        ...raw,
        producerKey: input.producerKey,
        producerKeys: [input.producerKey],
        ...(input.producerGroupKey ? { producerGroupKey: input.producerGroupKey } : {})
      }, input.producerKey);
      const existing = [...this.jobs.values()].find((job) => notificationJobProducerMatchKey(job) === notificationJobProducerMatchKey(retainedInput))
        ?? [...this.jobs.values()].find((job) => notificationJobFullIdentityKey(job) === notificationJobFullIdentityKey(retainedInput));
      if (!existing) continue;
      const producerKeys = [...new Set([...notificationJobProducerKeys(existing), input.producerKey])];
      const producerDestination = producerDestinationFor(raw, input.producerKey);
      const producerDestinations = upsertProducerDestination(notificationJobProducerDestinations(existing), producerDestination);
      const related = existing.destinationId !== raw.destinationId
        ? switchToProducerDestination({ ...existing, producerKeys, producerDestinations, updatedAt: now }, producerDestination)
        : { ...existing, producerKeys, producerDestinations, updatedAt: now };
      this.jobs.set(existing.id, related);
      if (!active.some((job) => job.id === related.id)) active.push(related);
    }
    return { active, retired };
  }

  async retireProducedJobs(producerKey: string): Promise<number> {
    const now = new Date();
    let retired = 0;
    for (const [id, job] of this.jobs.entries()) {
      if (!notificationJobHasProducer(job, producerKey)) continue;
      const remainingProducerKeys = notificationJobProducerKeys(job).filter((key) => key !== producerKey);
      const remainingDestinations = notificationJobProducerDestinations(job).filter((destination) => destination.producerKey !== producerKey);
      if (remainingProducerKeys.length > 0) {
        this.jobs.set(id, switchToProducerDestination({
          ...job,
          producerKey: remainingProducerKeys[0]!,
          producerKeys: remainingProducerKeys,
          producerDestinations: remainingDestinations,
          updatedAt: now
        }, remainingDestinations[0]));
      } else if (isRetirableJob(job)) {
        this.jobs.set(id, retireJob(job, now));
        retired += 1;
      }
    }
    return retired;
  }

  async retireSupersededProducerJobs(producerGroupKey: string, activeProducerKey: string): Promise<number> {
    return this.retireMatchingJobs((job) => job.producerGroupKey === producerGroupKey && job.producerKey !== activeProducerKey);
  }

  async listJobsForDestinationValidation(limit: number, offset: number): Promise<NotificationJobRecord[]> {
    return [...this.jobs.values()]
      .filter(isRetirableJob)
      .filter((job) => Boolean(job.destinationType && job.destinationId))
      .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime())
      .slice(offset, offset + limit);
  }

  async getWorkerBacklog(now: Date): Promise<{ due: number; retrying: number; processing: number; dead: number }> {
    const jobs = [...this.jobs.values()];
    return {
      due: jobs.filter((job) => isJobClaimable(job, now)).length,
      retrying: jobs.filter((job) => job.status === "scheduled" && job.attemptCount > 0).length,
      processing: jobs.filter((job) => job.status === "processing").length,
      dead: jobs.filter((job) => job.status === "dead").length
    };
  }

  async listFailedJobs(limit: number, offset: number): Promise<NotificationJobRecord[]> {
    return [...this.jobs.values()]
      .filter((job) => job.status === "failed" || job.status === "dead")
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(offset, offset + limit);
  }

  async listActiveDeviceTokens(limit: number, offset: number): Promise<DeviceTokenRecord[]> {
    return [...this.deviceTokens.values()]
      .filter((device) => device.status === "active" && Boolean(device.installationHash))
      .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime() || left.id.localeCompare(right.id))
      .slice(offset, offset + limit);
  }

  async listSentDeviceTokenIdsForJob(jobId: string, revision = 1): Promise<string[]> {
    return [...new Set(
      [...this.deliveries.values()]
        .filter((delivery) => delivery.jobId === jobId && (delivery.jobRevision ?? 1) === revision && delivery.status === "sent")
        .map((delivery) => delivery.deviceTokenId)
    )];
  }

  async claimDeliveryAttempt(input: NotificationDeliveryAttemptClaimInput): Promise<{ claimed: boolean; attempt: NotificationDeliveryAttemptRecord }> {
    const existing = [...this.deliveries.values()].find((delivery) => delivery.attemptIdentity === input.attemptIdentity);
    if (existing) return { claimed: false, attempt: existing as NotificationDeliveryAttemptRecord };
    const now = new Date(input.sendingStartedAt);
    const attempt: NotificationDeliveryAttemptRecord = {
      id: randomUUID(),
      jobId: input.jobId,
      jobRevision: input.jobRevision,
      attemptIdentity: input.attemptIdentity,
      attemptVersion: input.attemptVersion,
      deviceInstallationHash: input.deviceInstallationHash,
      userId: input.userId,
      deviceTokenId: input.deviceTokenId,
      status: "sending",
      sendingClaimId: input.sendingClaimId,
      sendingStartedAt: now,
      sendingLeaseUntil: new Date(input.sendingLeaseUntil),
      createdAt: now,
      updatedAt: now
    };
    this.deliveries.set(attempt.id, attempt);
    return { claimed: true, attempt };
  }

  async finalizeDeliveryAttempt(input: NotificationDeliveryAttemptFinalizeInput): Promise<NotificationDeliveryAttemptRecord | null> {
    const existing = [...this.deliveries.values()].find((delivery) => delivery.attemptIdentity === input.attemptIdentity) as NotificationDeliveryAttemptRecord | undefined;
    if (!existing) return null;
    if (existing.status !== "sending" || existing.sendingClaimId !== input.sendingClaimId) return existing;
    const finalized: NotificationDeliveryAttemptRecord = {
      ...existing,
      status: input.status,
      ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
      ...(input.deliveredAt ? { deliveredAt: new Date(input.deliveredAt) } : {}),
      finalizedAt: new Date(input.finalizedAt),
      updatedAt: new Date(input.finalizedAt)
    };
    delete finalized.sendingClaimId;
    delete finalized.sendingLeaseUntil;
    this.deliveries.set(finalized.id, finalized);
    return finalized;
  }

  async recoverExpiredDeliveryAttempts(now: Date): Promise<number> {
    let recovered = 0;
    for (const [id, delivery] of this.deliveries.entries()) {
      if (!delivery.attemptIdentity || delivery.status !== "sending" || (delivery.sendingLeaseUntil && delivery.sendingLeaseUntil > now)) continue;
      const ambiguous: NotificationDeliveryRecord = {
        ...delivery,
        status: "ambiguous",
        failureReason: "provider_outcome_unknown",
        finalizedAt: new Date(now),
        updatedAt: new Date(now)
      };
      delete ambiguous.sendingClaimId;
      delete ambiguous.sendingLeaseUntil;
      this.deliveries.set(id, ambiguous);
      recovered += 1;
    }
    return recovered;
  }

  async getDeliveryAttemptBacklog(now: Date): Promise<{ sending: number; expiredSending: number; ambiguous: number }> {
    const attempts = [...this.deliveries.values()].filter((delivery) => Boolean(delivery.attemptIdentity));
    return {
      sending: attempts.filter((attempt) => attempt.status === "sending").length,
      expiredSending: attempts.filter((attempt) => attempt.status === "sending" && (!attempt.sendingLeaseUntil || attempt.sendingLeaseUntil <= now)).length,
      ambiguous: attempts.filter((attempt) => attempt.status === "ambiguous").length
    };
  }

  async listDeliveryAttemptFencesForJob(jobId: string, revision = 1): Promise<NotificationDeliveryAttemptFence[]> {
    return [...this.deliveries.values()]
      .filter((delivery): delivery is NotificationDeliveryRecord & { status: NotificationDeliveryAttemptFence["status"] } =>
        delivery.jobId === jobId
        && (delivery.jobRevision ?? 1) === revision
        && (delivery.status === "sending" || delivery.status === "sent" || delivery.status === "invalid_device" || delivery.status === "ambiguous"))
      .map((delivery) => ({ deviceTokenId: delivery.deviceTokenId, status: delivery.status }));
  }

  async recordDelivery(input: Omit<NotificationDeliveryRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationDeliveryRecord> {
    const now = new Date();
    const delivery: NotificationDeliveryRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.deliveries.set(delivery.id, delivery);
    return delivery;
  }

  async listDeliveriesByJob(jobId: string, limit: number, offset: number): Promise<NotificationDeliveryRecord[]> {
    return [...this.deliveries.values()]
      .filter((delivery) => delivery.jobId === jobId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(offset, offset + limit);
  }

  async updateJobStatus(jobId: string, status: NotificationJobStatus): Promise<NotificationJobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const next: NotificationJobRecord = { ...job, status, updatedAt: new Date() };
    const updated = status === "processing" ? next : clearJobClaim(next);
    this.jobs.set(jobId, updated);
    return updated;
  }

  async rescheduleJob(jobId: string, scheduledAt: Date): Promise<NotificationJobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job || (job.status !== "failed" && job.status !== "dead")) return null;
    const updated = clearJobClaim({
      ...job,
      status: "scheduled",
      scheduledAt,
      deliveryAttemptEpoch: job.deliveryAttemptEpoch + 1,
      attemptCount: 0,
      updatedAt: new Date()
    });
    delete updated.lastAttemptAt;
    delete updated.lastFailureReason;
    delete updated.exhaustedAt;
    this.jobs.set(jobId, updated);
    return updated;
  }

  async disableDeviceToken(token: string): Promise<DeviceTokenRecord | null> {
    const device = [...this.deviceTokens.values()].find((record) => record.token === token);
    if (!device) return null;
    const updated: DeviceTokenRecord = { ...device, status: "disabled", updatedAt: new Date() };
    this.deviceTokens.set(device.id, updated);
    return updated;
  }

  async deleteUserData(userId: string): Promise<void> {
    for (const [id, device] of this.deviceTokens.entries()) {
      if (device.userId === userId) this.deviceTokens.delete(id);
    }
    this.preferences.delete(userId);
    for (const [id, alarm] of this.studentAlarms.entries()) {
      if (alarm.userId === userId) this.studentAlarms.delete(id);
    }
    for (const [id, job] of this.jobs.entries()) {
      if (job.userId === userId) this.jobs.delete(id);
    }
    for (const [id, delivery] of this.deliveries.entries()) {
      if (delivery.userId === userId) this.deliveries.delete(id);
    }
  }

  private retireMatchingJobs(predicate: (job: NotificationJobRecord) => boolean): number {
    const now = new Date();
    let retired = 0;
    for (const [id, job] of this.jobs.entries()) {
      if (!predicate(job) || !isRetirableJob(job)) continue;
      this.jobs.set(id, retireJob(job, now));
      retired += 1;
    }
    return retired;
  }
}

function notificationJobReminderKey(job: Pick<NotificationJobRecord, "trigger" | "offsetDays" | "offsetHours">): string {
  return `${job.trigger}:${job.offsetDays}:${job.offsetHours ?? 0}`;
}

function notificationJobIdentityKey(job: Pick<NotificationJobRecord, "userId" | "alarmId" | "eventId">): string {
  return `${job.userId ?? "broadcast"}:${job.alarmId ?? "event"}:${job.eventId}`;
}

function notificationJobFullIdentityKey(job: Pick<NotificationJobRecord, "userId" | "alarmId" | "eventId" | "trigger" | "offsetDays" | "offsetHours">): string {
  return `${notificationJobIdentityKey(job)}:${notificationJobReminderKey(job)}`;
}

function notificationJobMaterialKey(job: Pick<NotificationJobRecord, "calendarId" | "destinationType" | "destinationId" | "destinationScopeType" | "destinationScopeId" | "destinationFingerprint" | "universityId" | "facultyId" | "departmentId" | "title" | "category" | "scheduledAt">): string {
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

function notificationJobProducerMatchKey(job: Pick<NotificationJobRecord, "destinationType" | "destinationScopeType" | "destinationScopeId" | "destinationFingerprint" | "userId" | "alarmId" | "eventId" | "trigger" | "offsetDays" | "offsetHours">): string {
  if (job.destinationType === "announcement" && job.destinationScopeType && job.destinationScopeId && job.destinationFingerprint) {
    return JSON.stringify([job.destinationType, job.destinationScopeType, job.destinationScopeId, job.destinationFingerprint]);
  }
  return notificationJobFullIdentityKey(job);
}

function notificationJobProducerKeys(job: Pick<NotificationJobRecord, "producerKey" | "producerKeys">): string[] {
  return [...new Set([...(job.producerKeys ?? []), ...(job.producerKey ? [job.producerKey] : [])])];
}

function notificationJobHasProducer(job: Pick<NotificationJobRecord, "producerKey" | "producerKeys">, producerKey: string): boolean {
  return notificationJobProducerKeys(job).includes(producerKey);
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
  return clearJobClaim(switched);
}

function withNewJobLifecycle(input: NotificationJobCreateInput, id: string, now: Date): NotificationJobRecord {
  return {
    ...input,
    ...(input.producerKey ? { producerKeys: notificationJobProducerKeys(input) } : {}),
    id,
    revision: 1,
    deliveryAttemptEpoch: 0,
    attemptCount: 0,
    maxAttempts: input.maxAttempts ?? 5,
    createdAt: now,
    updatedAt: now
  };
}

function isJobClaimable(job: NotificationJobRecord, now: Date): boolean {
  if (job.attemptCount >= job.maxAttempts || job.exhaustedAt) return false;
  if (job.scheduledAt > now) return false;
  if (job.status === "scheduled") return true;
  return job.status === "processing" && (!job.processingLeaseUntil || job.processingLeaseUntil <= now);
}

function isRetirableJob(job: NotificationJobRecord): boolean {
  return job.status === "scheduled" || job.status === "processing" || job.status === "failed" || job.status === "dead";
}

function retireJob(job: NotificationJobRecord, now: Date): NotificationJobRecord {
  return clearJobClaim({ ...job, status: "cancelled", revision: job.revision + 1, updatedAt: now });
}

function clearJobClaim(job: NotificationJobRecord): NotificationJobRecord {
  const cleared = { ...job };
  delete cleared.processingClaimId;
  delete cleared.processingLeaseUntil;
  return cleared;
}
