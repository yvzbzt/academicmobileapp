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

  it("contains academic-unit suggestion review and ownership indexes", () => {
    expect(mongoIndexDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collection: "academic_unit_suggestions",
        keys: { status: 1, createdAt: -1 },
        name: "academic_unit_suggestions_status_created"
      }),
      expect.objectContaining({
        collection: "academic_unit_suggestions",
        keys: { userId: 1 },
        name: "academic_unit_suggestions_user"
      })
    ]));
  });

  it("contains followed-scope uniqueness and ordered-list indexes", () => {
    expect(mongoIndexDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collection: "followed_academic_scopes",
        keys: { userId: 1, normalizedScopeKey: 1 },
        unique: true,
        name: "followed_academic_scopes_user_scope_unique"
      }),
      expect.objectContaining({
        collection: "followed_academic_scopes",
        keys: { userId: 1, createdAt: 1 },
        name: "followed_academic_scopes_user_created"
      })
    ]));
  });

  it("contains canonical and trust indexes for announcement content", () => {
    expect(mongoIndexDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collection: "announcement_sources",
        keys: { canonicalUrl: 1, scopeType: 1, scopeId: 1 },
        name: "announcement_sources_canonical_scope"
      }),
      expect.objectContaining({
        collection: "announcement_items",
        keys: { sourceId: 1, canonicalUrl: 1 },
        name: "announcement_items_source_canonical"
      }),
      expect.objectContaining({
        collection: "announcement_items",
        keys: { trustStatus: 1, dedupeKey: 1 },
        name: "announcement_items_trust_dedupe"
      })
    ]));
  });
});
