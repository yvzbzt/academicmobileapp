import { describe, expect, it } from "vitest";
import { mongoIndexDefinitions } from "../src/database/collection-indexes.js";

describe("mongoIndexDefinitions", () => {
  it("contains unique index for duplicate PDF prevention", () => {
    expect(mongoIndexDefinitions).toContainEqual(
      expect.objectContaining({
        collection: "pdf_sources",
        unique: true,
        name: "pdf_sources_university_hash_unique"
      })
    );
  });

  it("contains due notification job index", () => {
    expect(mongoIndexDefinitions).toContainEqual(
      expect.objectContaining({
        collection: "notification_jobs",
        name: "notification_jobs_due"
      })
    );
  });

  it("contains TTL index for refresh token cleanup", () => {
    expect(mongoIndexDefinitions).toContainEqual(
      expect.objectContaining({
        collection: "refresh_tokens",
        ttlSeconds: 0
      })
    );
  });

  it("contains digest lookup and TTL indexes for password recovery", () => {
    expect(mongoIndexDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collection: "password_recovery_tokens",
        name: "password_recovery_tokens_hash_unique",
        unique: true
      }),
      expect.objectContaining({
        collection: "password_recovery_tokens",
        name: "password_recovery_tokens_expires_ttl",
        ttlSeconds: 0
      })
    ]));
  });
});
