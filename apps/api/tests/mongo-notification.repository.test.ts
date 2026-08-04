import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoConnectionService } from "../src/database/mongo-connection.service.js";
import { deviceTokenSchema, notificationDeliverySchema, notificationJobSchema } from "../src/database/mongoose-schemas.js";
import { getModel } from "../src/database/mongoose-utils.js";
import { createNotificationDeliveryAttemptIdentity, notificationDeliveryAttemptVersion } from "../src/modules/notifications/notification-delivery-attempt.js";
import { DeviceRegistrationConflictError } from "../src/modules/notifications/notification.types.js";
import { MongoNotificationRepository } from "../src/modules/notifications/mongo-notification.repository.js";

const REAL_MONGO_TEST_DATABASE = `academic_notification_phase3_test_${process.pid}`;
const REAL_MONGO_TEST_URI = `mongodb://127.0.0.1:27017/${REAL_MONGO_TEST_DATABASE}`;

describe("MongoNotificationRepository device ownership", () => {
  const mongo = new MongoConnectionService();
  const repository = new MongoNotificationRepository(mongo);

  beforeAll(async () => {
    const connection = await mongo.connect(REAL_MONGO_TEST_URI);
    if (!connection) throw new Error("PHASE3_TEST_MONGODB_NOT_CONFIGURED");
    if (connection.name !== REAL_MONGO_TEST_DATABASE) {
      throw new Error(`PHASE3_TEST_MONGODB_DATABASE_MISMATCH:${connection.name}`);
    }
    await connection.dropDatabase();
    await getModel(connection, "DeviceToken", deviceTokenSchema).init();
    await getModel(connection, "NotificationJob", notificationJobSchema).init();
    await getModel(connection, "NotificationDelivery", notificationDeliverySchema).init();
  }, 30_000);

  afterAll(async () => {
    const connection = mongo.getConnection();
    if (connection) {
      if (connection.name !== REAL_MONGO_TEST_DATABASE) {
        throw new Error(`PHASE3_TEST_MONGODB_CLEANUP_DATABASE_MISMATCH:${connection.name}`);
      }
      await connection.dropDatabase();
    }
    await mongo.onApplicationShutdown();
  }, 30_000);

  it("rotates one installation, rejects active ownership conflicts, and permits rebind only after detach", async () => {
    const installationHash = "phase3-installation-hash";
    const first = await repository.upsertDeviceToken({
      userId: "mongo-owner-1",
      platform: "android",
      token: "mongo-device-token-first",
      installationHash
    });
    const rotated = await repository.upsertDeviceToken({
      userId: "mongo-owner-1",
      platform: "android",
      token: "mongo-device-token-rotated",
      installationHash
    });

    expect(rotated.id).toBe(first.id);
    expect(rotated.token).toBe("mongo-device-token-rotated");
    await expect(repository.findActiveDeviceTokenById(first.id)).resolves.toEqual(
      expect.objectContaining({ id: first.id, userId: "mongo-owner-1", token: "mongo-device-token-rotated", installationHash })
    );
    await expect(repository.listActiveDeviceTokens(10, 0)).resolves.toEqual([
      expect.objectContaining({ id: first.id, userId: "mongo-owner-1", installationHash })
    ]);
    await repository.recordDelivery({
      jobId: "mongo-retry-job",
      userId: "mongo-owner-1",
      deviceTokenId: first.id,
      status: "sent",
      providerMessageId: "mongo-provider-message",
      deliveredAt: new Date()
    });
    await expect(repository.listSentDeviceTokenIdsForJob("mongo-retry-job")).resolves.toEqual([first.id]);

    await expect(repository.upsertDeviceToken({
      userId: "mongo-owner-2",
      platform: "ios",
      token: "mongo-device-token-owner-2",
      installationHash
    })).rejects.toBeInstanceOf(DeviceRegistrationConflictError);
    await expect(repository.upsertDeviceToken({
      userId: "mongo-owner-2",
      platform: "ios",
      token: "mongo-device-token-rotated",
      installationHash: "phase3-other-installation-hash"
    })).rejects.toBeInstanceOf(DeviceRegistrationConflictError);
    await expect(repository.disableDeviceInstallation("mongo-owner-2", installationHash)).rejects.toBeInstanceOf(DeviceRegistrationConflictError);

    await expect(repository.disableDeviceInstallation("mongo-owner-1", installationHash)).resolves.toEqual(
      expect.objectContaining({ id: first.id, status: "disabled" })
    );
    await expect(repository.findActiveDeviceTokenById(first.id)).resolves.toBeNull();
    await expect(repository.disableDeviceInstallation("mongo-owner-1", installationHash)).resolves.toBeNull();
    await expect(repository.upsertDeviceToken({
      userId: "mongo-owner-2",
      platform: "ios",
      token: "mongo-device-token-owner-2",
      installationHash
    })).resolves.toEqual(expect.objectContaining({
      id: first.id,
      userId: "mongo-owner-2",
      status: "active"
    }));
    await expect(repository.findActiveDeviceTokenById(first.id)).resolves.toEqual(
      expect.objectContaining({ id: first.id, userId: "mongo-owner-2", token: "mongo-device-token-owner-2", installationHash })
    );
  }, 30_000);

  it("atomically claims one due job and fences an expired claim during recovery", async () => {
    const now = new Date("2027-01-01T00:00:00.000Z");
    const leaseUntil = new Date("2027-01-01T00:10:00.000Z");
    const [job] = await repository.createNotificationJobs([{
      calendarId: "mongo-claim-calendar",
      eventId: "mongo-claim-event",
      destinationType: "calendar_event",
      destinationId: "mongo-claim-event",
      universityId: "mongo-university",
      title: "Mongo claim event",
      category: "final_exam",
      offsetDays: 1,
      trigger: "before",
      scheduledAt: now,
      status: "scheduled"
    }]);
    if (!job) throw new Error("Expected a Mongo notification job.");

    const simultaneousClaims = await Promise.all([
      repository.claimDueJob(job.id, now, "mongo-claim-a", leaseUntil),
      repository.claimDueJob(job.id, now, "mongo-claim-b", leaseUntil)
    ]);
    const winner = simultaneousClaims.find((claim) => claim !== null);

    expect(simultaneousClaims.filter(Boolean)).toHaveLength(1);
    expect(winner).toEqual(expect.objectContaining({ status: "processing", processingLeaseUntil: leaseUntil }));
    await expect(repository.rescheduleJob(job.id, new Date("2027-01-01T00:01:00.000Z"))).resolves.toBeNull();
    await expect(repository.listDueJobs(new Date("2027-01-01T00:09:59.000Z"), 10)).resolves.toEqual([]);

    const recovered = await repository.claimDueJob(
      job.id,
      new Date("2027-01-01T00:10:00.000Z"),
      "mongo-claim-recovered",
      new Date("2027-01-01T00:20:00.000Z")
    );
    expect(recovered).toEqual(expect.objectContaining({ processingClaimId: "mongo-claim-recovered" }));
    await expect(repository.renewClaimedJob(job.id, winner!.processingClaimId!, winner!.revision, new Date("2027-01-01T00:30:00.000Z"))).resolves.toBeNull();
    await expect(repository.renewClaimedJob(job.id, "mongo-claim-recovered", recovered!.revision, new Date("2027-01-01T00:30:00.000Z"))).resolves.toEqual(
      expect.objectContaining({ processingLeaseUntil: new Date("2027-01-01T00:30:00.000Z") })
    );
    await expect(repository.completeClaimedJob(job.id, winner!.processingClaimId!, "sent")).resolves.toBeNull();
    await expect(repository.completeClaimedJob(job.id, "mongo-claim-recovered", "sent")).resolves.toEqual(
      expect.objectContaining({ status: "sent" })
    );
    const [completed] = await repository.listJobsByCalendar("mongo-claim-calendar");
    expect(completed).not.toHaveProperty("processingClaimId");
    expect(completed).not.toHaveProperty("processingLeaseUntil");
  }, 30_000);

  it("atomically creates one deterministic delivery attempt and recovers an expired sending fence as ambiguous", async () => {
    const now = new Date("2027-01-15T00:00:00.000Z");
    const [job] = await repository.createNotificationJobs([{
      calendarId: "mongo-attempt-calendar",
      eventId: "mongo-attempt-event",
      destinationType: "calendar_event",
      destinationId: "mongo-attempt-event",
      universityId: "mongo-university",
      title: "Mongo attempt event",
      category: "final_exam",
      offsetDays: 1,
      trigger: "before",
      scheduledAt: now,
      status: "scheduled"
    }]);
    if (!job) throw new Error("Expected a Mongo attempt job.");
    const attemptVersion = notificationDeliveryAttemptVersion(job);
    const deviceInstallationHash = "mongo-attempt-installation-hash";
    const attemptIdentity = createNotificationDeliveryAttemptIdentity({
      jobId: job.id,
      deviceInstallationHash,
      attemptVersion
    });
    const leaseUntil = new Date(now.getTime() + 60_000);
    const base = {
      attemptIdentity,
      attemptVersion,
      jobId: job.id,
      jobRevision: job.revision,
      userId: "mongo-attempt-owner",
      deviceTokenId: "mongo-attempt-device",
      deviceInstallationHash,
      sendingStartedAt: now,
      sendingLeaseUntil: leaseUntil
    };

    const claims = await Promise.all([
      repository.claimDeliveryAttempt({ ...base, sendingClaimId: "mongo-attempt-claim-a" }),
      repository.claimDeliveryAttempt({ ...base, sendingClaimId: "mongo-attempt-claim-b" })
    ]);

    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(new Set(claims.map((claim) => claim.attempt.id))).toHaveProperty("size", 1);
    expect(claims[0]?.attempt.attemptIdentity).toBe(attemptIdentity);
    await expect(repository.recoverExpiredDeliveryAttempts(new Date(leaseUntil.getTime() - 1))).resolves.toBe(0);
    await expect(repository.recoverExpiredDeliveryAttempts(leaseUntil)).resolves.toBe(1);
    await expect(repository.getDeliveryAttemptBacklog(leaseUntil)).resolves.toEqual({
      sending: 0,
      expiredSending: 0,
      ambiguous: 1
    });
    await expect(repository.listDeliveryAttemptFencesForJob(job.id, job.revision)).resolves.toEqual([
      { deviceTokenId: "mongo-attempt-device", status: "ambiguous" }
    ]);
  }, 30_000);

  it("does not list or claim a legacy scheduled job whose persisted retry budget is exhausted", async () => {
    const now = new Date("2027-02-01T00:00:00.000Z");
    const [job] = await repository.createNotificationJobs([{
      calendarId: "mongo-exhausted-calendar",
      eventId: "mongo-exhausted-event",
      destinationType: "calendar_event",
      destinationId: "mongo-exhausted-event",
      universityId: "mongo-university",
      title: "Mongo exhausted event",
      category: "final_exam",
      offsetDays: 1,
      trigger: "before",
      scheduledAt: now,
      status: "scheduled",
      maxAttempts: 2
    }]);
    if (!job) throw new Error("Expected a Mongo exhausted-job fixture.");
    const connection = mongo.getConnection();
    if (!connection) throw new Error("Expected Mongo connection.");
    await getModel(connection, "NotificationJob", notificationJobSchema).updateOne(
      { _id: job.id },
      { $set: { attemptCount: 2 }, $unset: { exhaustedAt: 1 } }
    );

    await expect(repository.listDueJobs(now, 10)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: job.id })])
    );
    await expect(repository.claimDueJob(job.id, now, "exhausted-claim", new Date(now.getTime() + 60_000))).resolves.toBeNull();

    await getModel(connection, "NotificationJob", notificationJobSchema).updateOne(
      { _id: job.id },
      { $unset: { attemptCount: 1, maxAttempts: 1 } }
    );
    await expect(repository.claimDueJob(job.id, now, "legacy-default-claim", new Date(now.getTime() + 60_000))).resolves.toEqual(
      expect.objectContaining({ attemptCount: 0, maxAttempts: 5 })
    );
  }, 30_000);

  it("keeps concurrent multi-producer attach and retirement relationships with CAS retries", async () => {
    const now = new Date("2027-03-01T00:00:00.000Z");
    const fingerprint = "mongo-shared-announcement-fingerprint";
    const producerA = "announcement-source:mongo-a";
    const producerB = "announcement-source:mongo-b";
    const producerC = "announcement-source:mongo-c";
    const producedJob = (producerKey: string, destinationId: string) => ({
      calendarId: producerKey,
      eventId: destinationId,
      destinationType: "announcement" as const,
      destinationId,
      destinationScopeType: "university" as const,
      destinationScopeId: "mongo-shared-university",
      destinationFingerprint: fingerprint,
      universityId: "mongo-shared-university",
      title: `Shared ${destinationId}`,
      category: "announcement" as const,
      offsetDays: 0,
      trigger: "at_time" as const,
      scheduledAt: now,
      status: "scheduled" as const
    });

    await Promise.all([
      repository.syncProducedJobs({ producerKey: producerA, jobs: [producedJob(producerA, "real-id-a")] }),
      repository.syncProducedJobs({ producerKey: producerB, jobs: [producedJob(producerB, "real-id-b")] })
    ]);
    let sharedJobs = (await repository.listJobsForDestinationValidation(1_000, 0))
      .filter((job) => job.destinationFingerprint === fingerprint);
    expect(sharedJobs).toHaveLength(1);
    expect(sharedJobs[0]?.producerKeys).toEqual(expect.arrayContaining([producerA, producerB]));

    await Promise.all([
      repository.retireProducedJobs(producerA),
      repository.syncProducedJobs({ producerKey: producerC, jobs: [producedJob(producerC, "real-id-c")] })
    ]);
    sharedJobs = (await repository.listJobsForDestinationValidation(1_000, 0))
      .filter((job) => job.destinationFingerprint === fingerprint);
    expect(sharedJobs).toHaveLength(1);
    expect(sharedJobs[0]).toEqual(expect.objectContaining({
      producerKeys: expect.arrayContaining([producerB, producerC]),
      destinationId: expect.stringMatching(/^real-id-[bc]$/u)
    }));
    expect(sharedJobs[0]?.producerKeys).not.toContain(producerA);

    await repository.retireProducedJobs(producerB);
    sharedJobs = (await repository.listJobsForDestinationValidation(1_000, 0))
      .filter((job) => job.destinationFingerprint === fingerprint);
    expect(sharedJobs).toEqual([expect.objectContaining({ producerKeys: [producerC], destinationId: "real-id-c" })]);
  }, 30_000);
});
