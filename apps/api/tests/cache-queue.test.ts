import { describe, expect, it } from "vitest";
import { cacheKeyPolicies } from "../src/cache/cache-keys.js";
import { queueJobPolicies } from "../src/queue/job-policies.js";

describe("cacheKeyPolicies", () => {
  it("requires TTL for every cache key", () => {
    expect(cacheKeyPolicies.every((policy) => policy.ttlSeconds > 0)).toBe(true);
  });

  it("invalidates user calendar when university changes", () => {
    expect(cacheKeyPolicies).toContainEqual(
      expect.objectContaining({
        pattern: "calendar:user:{userId}",
        invalidatedBy: expect.arrayContaining(["user.university_changed"])
      })
    );
  });
});

describe("queueJobPolicies", () => {
  it("defines notification send retries and dead-letter handling", () => {
    expect(queueJobPolicies).toContainEqual(
      expect.objectContaining({
        name: "notification_send_job",
        retryCount: 5,
        deadLetter: true
      })
    );
  });

  it("defines PDF parser timeout", () => {
    expect(queueJobPolicies.find((policy) => policy.name === "pdf_parse_job")?.timeoutMs).toBe(120000);
  });

  it("defines notification schedule retries and dead-letter handling", () => {
    expect(queueJobPolicies).toContainEqual(
      expect.objectContaining({
        name: "notification_schedule_job",
        retryCount: 3,
        deadLetter: true
      })
    );
  });
});
