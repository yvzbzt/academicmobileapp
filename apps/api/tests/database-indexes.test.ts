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

  it("contains the expired notification claim recovery index", () => {
    expect(mongoIndexDefinitions).toContainEqual(expect.objectContaining({
      collection: "notification_jobs",
      keys: { status: 1, processingLeaseUntil: 1, scheduledAt: 1 },
      name: "notification_jobs_claim_recovery"
    }));
  });

  it("contains sparse uniqueness for hashed notification installations", () => {
    expect(mongoIndexDefinitions).toContainEqual(expect.objectContaining({
      collection: "device_tokens",
      keys: { installationHash: 1 },
      unique: true,
      sparse: true,
      name: "device_tokens_installation_unique"
    }));
  });

  it("contains the sent-recipient retry lookup index", () => {
    expect(mongoIndexDefinitions).toContainEqual(expect.objectContaining({
      collection: "notification_deliveries",
      keys: { jobId: 1, status: 1, deviceTokenId: 1 },
      name: "notification_deliveries_job_status_device"
    }));
  });

  it("contains unique attempt-identity and bounded sending-recovery indexes", () => {
    expect(mongoIndexDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collection: "notification_deliveries",
        keys: { attemptIdentity: 1 },
        unique: true,
        sparse: true,
        name: "notification_deliveries_attempt_identity_unique"
      }),
      expect.objectContaining({
        collection: "notification_deliveries",
        keys: { status: 1, sendingLeaseUntil: 1 },
        name: "notification_deliveries_attempt_recovery"
      })
    ]));
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

  it("contains digest lookup and TTL indexes for recent authentication", () => {
    expect(mongoIndexDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collection: "recent_authentication_proofs",
        keys: { jtiDigest: 1 },
        name: "recent_authentication_proofs_jti_digest_unique",
        unique: true
      }),
      expect.objectContaining({
        collection: "recent_authentication_proofs",
        keys: { expiresAt: 1 },
        name: "recent_authentication_proofs_expires_ttl",
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
        keys: { sourceUrl: 1, scopeType: 1, scopeId: 1, contentType: 1 },
        name: "announcement_sources_unique_scope_url_content",
        unique: true
      }),
      expect.objectContaining({
        collection: "announcement_sources",
        keys: { canonicalUrl: 1, scopeType: 1, scopeId: 1, contentType: 1 },
        name: "announcement_sources_canonical_scope_content"
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

  it("contains the refresh-family account revocation index", () => {
    expect(mongoIndexDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collection: "refresh_token_families",
        keys: { userId: 1, status: 1 },
        name: "refresh_token_families_user_status"
      }),
      expect.objectContaining({
        collection: "refresh_token_families",
        keys: { status: 1, cleanupPending: 1, cleanupLeaseUntil: 1, updatedAt: 1 },
        name: "refresh_token_families_cleanup_queue"
      }),
      expect.objectContaining({
        collection: "refresh_token_families",
        keys: { status: 1, expiresAt: 1 },
        name: "refresh_token_families_active_expiry"
      })
    ]));
  });

  it("contains announcement snapshot lookup, bounded retention, and TTL indexes", () => {
    expect(mongoIndexDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collection: "announcement_snapshots",
        keys: { "items.id": 1, createdAt: -1 },
        name: "announcement_snapshots_review_item_lookup"
      }),
      expect.objectContaining({
        collection: "announcement_snapshots",
        keys: { nextRetentionCheckAt: 1, createdAt: 1, purgeAfter: 1, activationLeaseUntil: 1 },
        name: "announcement_snapshots_retention_candidates"
      }),
      expect.objectContaining({
        collection: "announcement_snapshots",
        keys: { purgeAfter: 1 },
        ttlSeconds: 0,
        name: "announcement_snapshots_purge_after_ttl"
      })
    ]));
  });
});
