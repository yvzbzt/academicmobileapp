import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoConnectionService } from "../src/database/mongo-connection.service.js";
import { deviceTokenSchema, notificationJobSchema } from "../src/database/mongoose-schemas.js";
import { getModel } from "../src/database/mongoose-utils.js";
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
    await expect(repository.completeClaimedJob(job.id, winner!.processingClaimId!, "sent")).resolves.toBeNull();
    await expect(repository.completeClaimedJob(job.id, "mongo-claim-recovered", "sent")).resolves.toEqual(
      expect.objectContaining({ status: "sent" })
    );
    const [completed] = await repository.listJobsByCalendar("mongo-claim-calendar");
    expect(completed).not.toHaveProperty("processingClaimId");
    expect(completed).not.toHaveProperty("processingLeaseUntil");
  }, 30_000);
});
