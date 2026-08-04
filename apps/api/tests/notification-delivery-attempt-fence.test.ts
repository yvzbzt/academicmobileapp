import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthUserRecord } from "../src/modules/auth/auth.types.js";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";
import { createNotificationDeliveryAttemptIdentity, notificationDeliveryAttemptVersion } from "../src/modules/notifications/notification-delivery-attempt.js";
import { AdminNotificationOpsController } from "../src/modules/notifications/admin-notification-ops.controller.js";
import { GENERIC_PUSH_NOTIFICATION_BODY, NOTIFICATION_DELIVERY_ATTEMPT_LEASE_MS, NOTIFICATION_JOB_CLAIM_LEASE_MS, NotificationWorkerService } from "../src/modules/notifications/notification-worker.service.js";
import { NOTIFICATION_DELIVERY_CONSENT_VERSION } from "../src/modules/notifications/notification.types.js";
import type { NotificationDeliveryAttemptClaimInput, NotificationDeliveryAttemptFinalizeInput } from "../src/modules/notifications/notification.types.js";
import { classifyFirebaseMessagingFailure } from "../src/modules/notifications/push-sender.service.js";
import type { PushMessageInput, PushSendResult, PushSender } from "../src/modules/notifications/push-sender.service.js";
import { InMemoryQueueService } from "../src/queue/in-memory-queue.service.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("notification delivery attempt fencing", () => {
  it("classifies transient and unknown Firebase outcomes as ambiguous while retaining explicit no-acceptance results", () => {
    for (const code of ["messaging/server-unavailable", "messaging/internal-error", "messaging/unknown-error"]) {
      expect(classifyFirebaseMessagingFailure({ code, message: "provider detail must not escape" })).toEqual({
        status: "ambiguous",
        reason: "provider_unavailable"
      });
    }
    expect(classifyFirebaseMessagingFailure(new Error("unknown provider response"))).toEqual({
      status: "ambiguous",
      reason: "provider_rejected"
    });
    expect(classifyFirebaseMessagingFailure({ code: "messaging/invalid-argument" })).toEqual({
      status: "failed",
      reason: "provider_rejected"
    });
    expect(classifyFirebaseMessagingFailure({ code: "messaging/registration-token-not-registered" })).toEqual({
      status: "invalid_token"
    });
  });

  it("does not call the provider when the attempt claim cannot be persisted and retries safely", async () => {
    const repository = new ClaimFailureRepository();
    const fixture = await createFixture(repository, "claim-persistence");
    const sender = new SequenceSender([{ status: "sent", providerMessageId: "provider-safe-retry" }]);
    const worker = createWorker(repository, sender);

    const first = await worker.processDueJobs(fixture.now);

    expect(first).toEqual(expect.objectContaining({ sent: 0, failed: 1 }));
    expect(sender.messages).toEqual([]);
    expect((await repository.listJobsByCalendar(fixture.job.calendarId))[0]).toEqual(expect.objectContaining({
      status: "scheduled",
      attemptCount: 1
    }));
    expect(await repository.listDeliveriesByJob(fixture.job.id, 10, 0)).toEqual([]);

    const retry = await worker.processDueJobs(new Date(fixture.now.getTime() + 60_000));

    expect(retry).toEqual(expect.objectContaining({ sent: 1, failed: 0 }));
    expect(sender.messages).toHaveLength(1);
    expect(await repository.listDeliveriesByJob(fixture.job.id, 10, 0)).toEqual([
      expect.objectContaining({ status: "sent", attemptVersion: "1:0:2" })
    ]);
  });

  it("retries a provider rejection that explicitly proves non-acceptance with a new deterministic attempt version", async () => {
    const repository = new InMemoryNotificationRepository();
    const fixture = await createFixture(repository, "explicit-rejection");
    const sender = new SequenceSender([
      { status: "failed", reason: "provider_rejected" },
      { status: "sent", providerMessageId: "provider-after-rejection" }
    ]);
    const worker = createWorker(repository, sender);

    const rejected = await worker.processDueJobs(fixture.now);
    expect(rejected).toEqual(expect.objectContaining({ sent: 0, failed: 1, ambiguous: 0 }));
    expect((await repository.listJobsByCalendar(fixture.job.calendarId))[0]).toEqual(expect.objectContaining({
      status: "scheduled",
      attemptCount: 1,
      lastFailureReason: "provider_rejected"
    }));

    const retried = await worker.processDueJobs(new Date(fixture.now.getTime() + 60_000));
    const attempts = await repository.listDeliveriesByJob(fixture.job.id, 10, 0);

    expect(retried).toEqual(expect.objectContaining({ sent: 1, failed: 0 }));
    expect(sender.messages).toHaveLength(2);
    expect(attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "failed", attemptVersion: "1:0:1", failureReason: "provider_rejected" }),
      expect.objectContaining({ status: "sent", attemptVersion: "1:0:2", providerMessageId: "provider-after-rejection" })
    ]));
  });

  it("persists one sent attempt and never sends the same job revision to the installation twice", async () => {
    const repository = new InMemoryNotificationRepository();
    const fixture = await createFixture(repository, "ordinary-success");
    const sender = new SequenceSender([{ status: "sent", providerMessageId: "provider-success-id" }]);
    const worker = createWorker(repository, sender);

    await expect(worker.processDueJobs(fixture.now)).resolves.toEqual(expect.objectContaining({ sent: 1 }));
    await expect(worker.processDueJobs(new Date(fixture.now.getTime() + 60_000))).resolves.toEqual(expect.objectContaining({ processedJobs: 0 }));

    const attempts = await repository.listDeliveriesByJob(fixture.job.id, 10, 0);
    const version = notificationDeliveryAttemptVersion(fixture.job);
    const identity = createNotificationDeliveryAttemptIdentity({
      jobId: fixture.job.id,
      deviceInstallationHash: fixture.devices[0]!.installationHash!,
      attemptVersion: version
    });
    expect(sender.messages).toHaveLength(1);
    expect(attempts).toEqual([
      expect.objectContaining({
        attemptIdentity: identity,
        attemptVersion: version,
        status: "sent",
        providerMessageId: "provider-success-id"
      })
    ]);
  });

  it("keeps a successful provider call fenced when terminal persistence fails and preserves ambiguity across worker restart", async () => {
    const repository = new TerminalPersistenceFailureRepository();
    const fixture = await createFixture(repository, "ambiguous-restart");
    const sender = new SequenceSender([{ status: "sent", providerMessageId: "provider-accepted-before-storage-loss" }]);
    const firstWorker = createWorker(repository, sender);

    const first = await firstWorker.processDueJobs(fixture.now);
    const firstAttempts = await repository.listDeliveriesByJob(fixture.job.id, 10, 0);
    const sendingLeaseUntil = firstAttempts[0]?.sendingLeaseUntil;
    if (!sendingLeaseUntil) throw new Error("EXPECTED_SENDING_ATTEMPT_LEASE");
    expect(first).toEqual(expect.objectContaining({ sent: 0, ambiguous: 1 }));
    expect(sender.messages).toHaveLength(1);
    expect(firstAttempts).toEqual([
      expect.objectContaining({ status: "sending", attemptVersion: "1:0:1" })
    ]);
    expect(firstWorker.health().deliveryAttempts).toEqual(expect.objectContaining({ sending: 1, ambiguous: 0 }));

    await repository.rescheduleJob(fixture.job.id, new Date(fixture.now.getTime() + 1));
    const restartedBeforeLease = createWorker(repository, sender);
    const fenced = await restartedBeforeLease.processDueJobs(new Date(fixture.now.getTime() + 1));
    expect(fenced).toEqual(expect.objectContaining({ sent: 0, ambiguous: 1, fenced: 1 }));
    expect(sender.messages).toHaveLength(1);

    repository.failTerminalWrites = false;
    const recoveredAt = sendingLeaseUntil;
    await repository.rescheduleJob(fixture.job.id, recoveredAt);
    const restartedAfterLease = createWorker(repository, sender);
    const recovered = await restartedAfterLease.processDueJobs(recoveredAt);
    const attempts = await repository.listDeliveriesByJob(fixture.job.id, 10, 0);

    expect(recovered).toEqual(expect.objectContaining({ sent: 0, ambiguous: 1, fenced: 1 }));
    expect(sender.messages).toHaveLength(1);
    expect(attempts).toEqual([expect.objectContaining({ status: "ambiguous", failureReason: "provider_outcome_unknown" })]);
    expect(restartedAfterLease.health().deliveryAttempts).toEqual(expect.objectContaining({ sending: 0, ambiguous: 1 }));
  });

  it("lets an atomic attempt claim allow only one provider call when two workers race the same job and installation", async () => {
    const repository = new InMemoryNotificationRepository();
    const fixture = await createFixture(repository, "attempt-race");
    const sender = new BlockingSender();
    const firstWorker = createWorker(repository, sender);
    const secondWorker = createWorker(repository, sender);

    const first = firstWorker.sendToDevice({ job: fixture.job, token: fixture.devices[0]!.token, device: fixture.devices[0]! });
    await sender.started;
    const second = await secondWorker.sendToDevice({ job: fixture.job, token: fixture.devices[0]!.token, device: fixture.devices[0]! });
    sender.release();
    const firstResult = await first;

    expect(sender.messages).toHaveLength(1);
    expect(firstResult.sent + second.sent).toBe(1);
    expect(second).toEqual(expect.objectContaining({ ambiguous: 1, fenced: 1 }));
    expect(await repository.listDeliveriesByJob(fixture.job.id, 10, 0)).toHaveLength(1);
  });

  it("continues to another installation after one ambiguous outcome with distinct deterministic identities", async () => {
    const repository = new InMemoryNotificationRepository();
    const fixture = await createFixture(repository, "multiple-installations", 2);
    const sender = new SequenceSender([
      { status: "ambiguous", reason: "provider_unavailable" },
      { status: "sent", providerMessageId: "provider-device-two" }
    ]);
    const worker = createWorker(repository, sender);

    const result = await worker.processDueJobs(fixture.now);
    const attempts = await repository.listDeliveriesByJob(fixture.job.id, 10, 0);

    expect(result).toEqual(expect.objectContaining({ sent: 1, ambiguous: 1 }));
    expect(sender.messages).toHaveLength(2);
    expect(new Set(attempts.map((attempt) => attempt.attemptIdentity))).toHaveProperty("size", 2);
    expect(attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "ambiguous", failureReason: "provider_outcome_unknown" }),
      expect.objectContaining({ status: "sent", providerMessageId: "provider-device-two" })
    ]));
  });

  it("starts each later device lease from fresh elapsed time during a long fan-out", async () => {
    const repository = new LeaseRecordingRepository();
    const fixture = await createFixture(repository, "elapsed-fan-out", 2);
    let wallNow = fixture.now.getTime();
    vi.spyOn(Date, "now").mockImplementation(() => wallNow);
    const messages: PushMessageInput[] = [];
    const delay = NOTIFICATION_DELIVERY_ATTEMPT_LEASE_MS + 1_000;
    const sender: PushSender = {
      async send(input) {
        messages.push(input);
        if (messages.length === 1) wallNow += delay;
        return { status: "sent", providerMessageId: `provider-elapsed-${messages.length}` };
      }
    };

    const result = await createWorker(repository, sender).processDueJobs(fixture.now);
    const attempts = await repository.listDeliveriesByJob(fixture.job.id, 10, 0);

    expect(result.sent).toBe(2);
    expect(messages).toHaveLength(2);
    expect(repository.attemptClaims).toHaveLength(2);
    expect(repository.renewedJobLeases).toHaveLength(2);
    expect(repository.attemptClaims[0]?.sendingStartedAt).toEqual(fixture.now);
    expect(repository.attemptClaims[1]?.sendingStartedAt).toEqual(new Date(fixture.now.getTime() + delay));
    expect(repository.attemptClaims[1]?.sendingLeaseUntil).toEqual(
      new Date(fixture.now.getTime() + delay + NOTIFICATION_DELIVERY_ATTEMPT_LEASE_MS)
    );
    expect(repository.renewedJobLeases[1]).toEqual(
      new Date(fixture.now.getTime() + delay + NOTIFICATION_JOB_CLAIM_LEASE_MS)
    );
    expect(attempts[0]?.finalizedAt?.getTime()).toBeGreaterThanOrEqual(fixture.now.getTime() + delay);
    expect(attempts[0]?.deliveredAt?.getTime()).toBeGreaterThanOrEqual(fixture.now.getTime() + delay);
  });

  it("keeps unknown provider outcomes ambiguous and exposes only controlled token-free operational state", async () => {
    const repository = new InMemoryNotificationRepository();
    const fixture = await createFixture(repository, "private-operations");
    const token = fixture.devices[0]!.token;
    const contentTitle = fixture.job.title;
    const sender = new UnknownOutcomeSender(`${token}|${contentTitle}|${GENERIC_PUSH_NOTIFICATION_BODY}`);
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined)
    ];
    const worker = createWorker(repository, sender);
    const controller = new AdminNotificationOpsController(worker);

    const result = await worker.processDueJobs(fixture.now);
    const operations = {
      result,
      health: controller.health(),
      deliveries: await controller.listDeliveries(fixture.job.id, "10", "0")
    };
    const serialized = JSON.stringify(operations);

    expect(result).toEqual(expect.objectContaining({ sent: 0, failed: 0, ambiguous: 1 }));
    expect(operations.health.deliveryAttempts).toEqual(expect.objectContaining({ ambiguous: 1 }));
    expect(operations.deliveries).toEqual([
      expect.objectContaining({ status: "ambiguous", failureReason: "provider_outcome_unknown" })
    ]);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(contentTitle);
    expect(serialized).not.toContain(GENERIC_PUSH_NOTIFICATION_BODY);
    expect(serialized).not.toContain(sender.sensitiveErrorText);
    expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it("does not persist an unsafe provider message identifier", async () => {
    const repository = new InMemoryNotificationRepository();
    const fixture = await createFixture(repository, "provider-id-safety");
    const sender = new SequenceSender([{ status: "sent", providerMessageId: "unsafe\nprovider-id" }]);

    await createWorker(repository, sender).processDueJobs(fixture.now);

    expect(await repository.listDeliveriesByJob(fixture.job.id, 10, 0)).toEqual([
      expect.not.objectContaining({ providerMessageId: expect.anything() })
    ]);
  });
});

class ClaimFailureRepository extends InMemoryNotificationRepository {
  private remainingFailures = 1;

  override async claimDeliveryAttempt(input: NotificationDeliveryAttemptClaimInput) {
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new Error("DELIVERY_ATTEMPT_PERSISTENCE_UNAVAILABLE");
    }
    return super.claimDeliveryAttempt(input);
  }
}

class TerminalPersistenceFailureRepository extends InMemoryNotificationRepository {
  failTerminalWrites = true;

  override async finalizeDeliveryAttempt(input: NotificationDeliveryAttemptFinalizeInput) {
    if (this.failTerminalWrites && (input.status === "sent" || input.status === "ambiguous")) {
      throw new Error("DELIVERY_TERMINAL_PERSISTENCE_UNAVAILABLE");
    }
    return super.finalizeDeliveryAttempt(input);
  }
}

class LeaseRecordingRepository extends InMemoryNotificationRepository {
  readonly attemptClaims: NotificationDeliveryAttemptClaimInput[] = [];
  readonly renewedJobLeases: Date[] = [];

  override async renewClaimedJob(jobId: string, claimId: string, revision: number, leaseUntil: Date) {
    this.renewedJobLeases.push(new Date(leaseUntil));
    return super.renewClaimedJob(jobId, claimId, revision, leaseUntil);
  }

  override async claimDeliveryAttempt(input: NotificationDeliveryAttemptClaimInput) {
    this.attemptClaims.push({
      ...input,
      sendingStartedAt: new Date(input.sendingStartedAt),
      sendingLeaseUntil: new Date(input.sendingLeaseUntil)
    });
    return super.claimDeliveryAttempt(input);
  }
}

class SequenceSender implements PushSender {
  readonly messages: PushMessageInput[] = [];

  constructor(private readonly outcomes: PushSendResult[]) {}

  async send(input: PushMessageInput): Promise<PushSendResult> {
    this.messages.push(input);
    return this.outcomes.shift() ?? { status: "sent", providerMessageId: "provider-default" };
  }
}

class BlockingSender implements PushSender {
  readonly messages: PushMessageInput[] = [];
  private resolveStarted!: () => void;
  private resolveRelease!: () => void;
  readonly started = new Promise<void>((resolve) => { this.resolveStarted = resolve; });
  private readonly released = new Promise<void>((resolve) => { this.resolveRelease = resolve; });

  async send(input: PushMessageInput): Promise<PushSendResult> {
    this.messages.push(input);
    this.resolveStarted();
    await this.released;
    return { status: "sent", providerMessageId: "provider-race-winner" };
  }

  release(): void {
    this.resolveRelease();
  }
}

class UnknownOutcomeSender implements PushSender {
  constructor(readonly sensitiveErrorText: string) {}

  async send(): Promise<never> {
    throw new Error(this.sensitiveErrorText);
  }
}

function createWorker(repository: InMemoryNotificationRepository, sender: PushSender): NotificationWorkerService {
  return new NotificationWorkerService(repository, new InMemoryQueueService(), sender, activeStudentRepository);
}

async function createFixture(repository: InMemoryNotificationRepository, suffix: string, deviceCount = 1) {
  const now = new Date("2027-04-01T00:00:00.000Z");
  const devices = [];
  for (let index = 0; index < deviceCount; index += 1) {
    devices.push(await repository.upsertDeviceToken({
      userId: TEST_USER.id,
      platform: "android",
      token: `private-push-token-${suffix}-${index}`,
      installationHash: `installation-hash-${suffix}-${index}`
    }));
  }
  await repository.upsertPreferences({
    userId: TEST_USER.id,
    enabled: true,
    deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
    categories: { final_exam: true },
    reminderOffsets: [1]
  });
  const [job] = await repository.createNotificationJobs([{
    calendarId: `calendar-${suffix}`,
    eventId: `event-${suffix}`,
    destinationType: "calendar_event",
    destinationId: `event-${suffix}`,
    universityId: TEST_USER.universityId!,
    title: `Private content ${suffix}`,
    category: "final_exam",
    offsetDays: 1,
    trigger: "before",
    scheduledAt: now,
    status: "scheduled"
  }]);
  if (!job) throw new Error("EXPECTED_NOTIFICATION_JOB_FIXTURE");
  return { now, devices, job };
}

const TEST_USER: AuthUserRecord = {
  id: "delivery-fence-student",
  credentialGeneration: 0,
  fullName: "Delivery Fence Student",
  email: "delivery-fence@example.test",
  passwordHash: "not-a-real-password-hash",
  role: "student",
  universityId: "delivery-fence-university",
  status: "active",
  createdAt: new Date("2027-01-01T00:00:00.000Z"),
  updatedAt: new Date("2027-01-01T00:00:00.000Z")
};

const activeStudentRepository = {
  async findUserById(userId: string): Promise<AuthUserRecord | null> {
    return userId === TEST_USER.id ? TEST_USER : null;
  }
};
