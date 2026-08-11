import { describe, expect, it } from "vitest";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";
import type { NotificationJobCreateInput } from "../src/modules/notifications/notification.types.js";

describe("notification job durability", () => {
  it("persists exponential-retry state, reaches an explicit dead state, and supports a controlled retry", async () => {
    const repository = new InMemoryNotificationRepository();
    const now = new Date("2026-08-04T08:00:00.000Z");
    const [job] = await repository.createNotificationJobs([{ ...jobInput(now), maxAttempts: 2 }]);
    if (!job) throw new Error("Expected notification job.");

    const firstClaim = await repository.claimDueJob(job.id, now, "claim-1", new Date(now.getTime() + 60_000));
    if (!firstClaim) throw new Error("Expected first claim.");
    const retryAt = new Date(now.getTime() + 60_000);
    await expect(repository.failClaimedJob({
      jobId: job.id,
      claimId: "claim-1",
      revision: firstClaim.revision,
      failedAt: now,
      retryAt,
      reason: "provider_unavailable"
    })).resolves.toEqual(expect.objectContaining({ status: "scheduled", attemptCount: 1, scheduledAt: retryAt }));
    await expect(repository.listDueJobs(new Date(now.getTime() + 59_999), 10)).resolves.toEqual([]);

    const secondClaim = await repository.claimDueJob(job.id, retryAt, "claim-2", new Date(retryAt.getTime() + 60_000));
    if (!secondClaim) throw new Error("Expected second claim.");
    await expect(repository.failClaimedJob({
      jobId: job.id,
      claimId: "claim-2",
      revision: secondClaim.revision,
      failedAt: retryAt,
      retryAt: new Date(retryAt.getTime() + 120_000),
      reason: "provider_unavailable"
    })).resolves.toEqual(expect.objectContaining({ status: "dead", attemptCount: 2, exhaustedAt: retryAt }));
    await expect(repository.listDueJobs(new Date("2030-01-01T00:00:00.000Z"), 10)).resolves.toEqual([]);
    await expect(repository.getWorkerBacklog(retryAt)).resolves.toEqual(expect.objectContaining({ dead: 1, due: 0 }));

    await expect(repository.rescheduleJob(job.id, new Date(retryAt.getTime() + 1))).resolves.toEqual(
      expect.objectContaining({ status: "scheduled", attemptCount: 0 })
    );
  });

  it("fences an old claim when producer material changes", async () => {
    const repository = new InMemoryNotificationRepository();
    const now = new Date("2026-08-04T09:00:00.000Z");
    const first = await repository.syncProducedJobs({
      producerKey: "announcement-source:one",
      jobs: [jobInput(now)]
    });
    const job = first.active[0];
    if (!job) throw new Error("Expected produced job.");
    const claimed = await repository.claimDueJob(job.id, now, "old-claim", new Date(now.getTime() + 60_000));
    if (!claimed) throw new Error("Expected claim.");

    const changedInput = { ...jobInput(now), title: "Changed trusted title", destinationFingerprint: "fingerprint-v2" };
    const changed = await repository.syncProducedJobs({ producerKey: "announcement-source:one", jobs: [changedInput] });

    expect(changed.active[0]).toEqual(expect.objectContaining({ status: "scheduled", revision: 1 }));
    expect(changed.active[0]?.id).not.toBe(job.id);
    await expect(repository.failClaimedJob({
      jobId: job.id,
      claimId: "old-claim",
      revision: claimed.revision,
      failedAt: now,
      retryAt: new Date(now.getTime() + 60_000),
      reason: "worker_interrupted"
    })).resolves.toBeNull();
  });

  it("reactivates removed content once, preserves unchanged sent jobs, and scopes sent-delivery dedupe by revision", async () => {
    const repository = new InMemoryNotificationRepository();
    const now = new Date("2026-08-04T10:00:00.000Z");
    const producerKey = "announcement-source:two";
    const first = await repository.syncProducedJobs({ producerKey, jobs: [jobInput(now)] });
    const job = first.active[0];
    if (!job) throw new Error("Expected produced job.");

    await expect(repository.retireProducedJobs(producerKey)).resolves.toBe(1);
    const reappeared = await repository.syncProducedJobs({ producerKey, jobs: [jobInput(now)] });
    expect(reappeared.active[0]).toEqual(expect.objectContaining({ id: job.id, status: "scheduled", revision: 3 }));
    await repository.updateJobStatus(job.id, "sent");
    const unchanged = await repository.syncProducedJobs({ producerKey, jobs: [jobInput(now)] });
    expect(unchanged.active[0]).toEqual(expect.objectContaining({ status: "sent", revision: 3 }));

    await repository.recordDelivery({
      jobId: job.id,
      jobRevision: 1,
      userId: "student-1",
      deviceTokenId: "device-1",
      status: "sent"
    });
    await repository.recordDelivery({
      jobId: job.id,
      jobRevision: 3,
      userId: "student-1",
      deviceTokenId: "device-2",
      status: "sent"
    });
    await expect(repository.listSentDeviceTokenIdsForJob(job.id, 1)).resolves.toEqual(["device-1"]);
    await expect(repository.listSentDeviceTokenIdsForJob(job.id, 3)).resolves.toEqual(["device-2"]);
  });

  it("deduplicates concurrent equivalent sources within one scope and keeps a live real-ID destination when one source is removed", async () => {
    const repository = new InMemoryNotificationRepository();
    const now = new Date("2026-08-04T11:00:00.000Z");
    const sourceA = "announcement-source:a";
    const sourceB = "announcement-source:b";
    const jobA = jobInput(now);
    const jobB = { ...jobInput(now), calendarId: sourceB, eventId: "announcement-real-id-b", destinationId: "announcement-real-id-b" };

    await Promise.all([
      repository.syncProducedJobs({ producerKey: sourceA, jobs: [jobA] }),
      repository.syncProducedJobs({ producerKey: sourceB, jobs: [jobB] })
    ]);
    let jobs = await repository.listDueJobs(now, 10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual(expect.objectContaining({
      destinationId: "announcement-real-id-b",
      producerKeys: expect.arrayContaining([sourceA, sourceB])
    }));

    await repository.syncProducedJobs({ producerKey: sourceA, jobs: [] });
    jobs = await repository.listDueJobs(now, 10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual(expect.objectContaining({ destinationId: "announcement-real-id-b", producerKeys: [sourceB] }));

    const otherScope = { ...jobInput(now), destinationScopeId: "university-2", universityId: "university-2" };
    await repository.syncProducedJobs({ producerKey: "announcement-source:other-scope", jobs: [otherScope] });
    await expect(repository.listDueJobs(now, 10)).resolves.toHaveLength(2);
  });
});

function jobInput(scheduledAt: Date): NotificationJobCreateInput {
  return {
    calendarId: "announcement-source:one",
    eventId: "announcement-real-id",
    destinationType: "announcement",
    destinationId: "announcement-real-id",
    destinationScopeType: "university",
    destinationScopeId: "university-1",
    destinationFingerprint: "fingerprint-v1",
    universityId: "university-1",
    title: "Trusted title",
    category: "announcement",
    offsetDays: 0,
    trigger: "at_time",
    scheduledAt,
    status: "scheduled"
  };
}
