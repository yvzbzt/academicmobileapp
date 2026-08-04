import { describe, expect, it } from "vitest";
import { academicCalendarSchema, academicEventSchema, academicUnitSuggestionSchema, announcementItemSchema, announcementSourceSchema, departmentSchema, deviceTokenSchema, extractedEventSchema, facultySchema, followedAcademicScopeSchema, notificationDeliverySchema, notificationJobSchema, notificationPreferenceSchema, passwordRecoveryTokenSchema, pdfSourceSchema, refreshTokenSchema, universitySchema, userSchema } from "../src/database/mongoose-schemas.js";

describe("mongoose schemas", () => {
  it("defaults credential generations to zero and rejects negative values", () => {
    for (const schema of [userSchema, refreshTokenSchema, passwordRecoveryTokenSchema]) {
      expect(schema.path("credentialGeneration").options).toEqual(expect.objectContaining({
        required: true,
        default: 0,
        min: 0
      }));
    }
  });

  it("defines users collection and email unique index", () => {
    expect(userSchema.get("collection")).toBe("users");
    const indexes = userSchema.indexes();
    expect(indexes).toEqual(expect.arrayContaining([[{ email: 1 }, expect.objectContaining({ unique: true })]]));
  });

  it("defines refresh token TTL cleanup index", () => {
    expect(refreshTokenSchema.get("collection")).toBe("refresh_tokens");
    const indexes = refreshTokenSchema.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([[{ expiresAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0 })]])
    );
  });

  it("stores a durable password-recovery completion marker on the user", () => {
    expect(userSchema.path("passwordRecoveryCompletion.operationKey").instance).toBe("String");
    expect(userSchema.path("passwordRecoveryCompletion.completedAt").instance).toBe("Date");
    expect(userSchema.path("passwordRecoveryCompletion.credentialGeneration").instance).toBe("Number");
  });

  it("defines password recovery digest, user lookup, and TTL indexes", () => {
    expect(passwordRecoveryTokenSchema.get("collection")).toBe("password_recovery_tokens");
    expect(passwordRecoveryTokenSchema.indexes()).toEqual(expect.arrayContaining([
      [{ tokenHash: 1 }, expect.objectContaining({ unique: true, name: "password_recovery_tokens_hash_unique" })],
      [{ userId: 1, createdAt: -1 }, expect.objectContaining({ name: "password_recovery_tokens_user_latest" })],
      [{ expiresAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0, name: "password_recovery_tokens_expires_ttl" })]
    ]));
  });

  it("defines academic-unit suggestion persistence and review indexes", () => {
    expect(academicUnitSuggestionSchema.get("collection")).toBe("academic_unit_suggestions");
    expect(academicUnitSuggestionSchema.path("_id").instance).toBe("String");
    expect(academicUnitSuggestionSchema.path("userId").isRequired).toBe(true);
    expect(academicUnitSuggestionSchema.path("userEmail").isRequired).toBe(true);
    expect(academicUnitSuggestionSchema.path("universityId").isRequired).toBe(true);
    expect(academicUnitSuggestionSchema.path("facultyName").isRequired).toBe(true);
    expect(academicUnitSuggestionSchema.path("educationLevel").options.enum).toEqual([
      "associate",
      "bachelor",
      "master",
      "doctorate"
    ]);
    expect(academicUnitSuggestionSchema.path("status").options).toEqual(expect.objectContaining({
      required: true,
      default: "pending",
      enum: ["pending", "approved", "rejected"]
    }));
    expect(academicUnitSuggestionSchema.path("createdAt")).toBeDefined();
    expect(academicUnitSuggestionSchema.path("updatedAt")).toBeUndefined();
    expect(academicUnitSuggestionSchema.indexes()).toEqual(expect.arrayContaining([
      [{ status: 1, createdAt: -1 }, expect.objectContaining({ name: "academic_unit_suggestions_status_created" })],
      [{ userId: 1 }, expect.objectContaining({ name: "academic_unit_suggestions_user" })]
    ]));
  });

  it("defines followed-scope persistence with a private normalized uniqueness key", () => {
    expect(followedAcademicScopeSchema.get("collection")).toBe("followed_academic_scopes");
    expect(followedAcademicScopeSchema.path("_id").instance).toBe("String");
    expect(followedAcademicScopeSchema.path("userId").isRequired).toBe(true);
    expect(followedAcademicScopeSchema.path("universityId").isRequired).toBe(true);
    expect(followedAcademicScopeSchema.path("normalizedScopeKey").options).toEqual(expect.objectContaining({
      required: true,
      select: false
    }));
    expect(followedAcademicScopeSchema.path("createdAt")).toBeDefined();
    expect(followedAcademicScopeSchema.path("updatedAt")).toBeUndefined();
    expect(followedAcademicScopeSchema.indexes()).toEqual(expect.arrayContaining([
      [
        { userId: 1, normalizedScopeKey: 1 },
        expect.objectContaining({ unique: true, name: "followed_academic_scopes_user_scope_unique" })
      ],
      [{ userId: 1, createdAt: 1 }, expect.objectContaining({ name: "followed_academic_scopes_user_created" })]
    ]));
  });

  it("defines catalog collection indexes", () => {
    expect(universitySchema.get("collection")).toBe("universities");
    expect(facultySchema.get("collection")).toBe("faculties");
    expect(departmentSchema.get("collection")).toBe("departments");
    expect(universitySchema.path("_id").instance).toBe("String");
    expect(facultySchema.path("_id").instance).toBe("String");
    expect(departmentSchema.path("_id").instance).toBe("String");
    expect(universitySchema.indexes()).toEqual(expect.arrayContaining([[{ slug: 1 }, expect.objectContaining({ unique: true })]]));
    expect(facultySchema.indexes()).toEqual(expect.arrayContaining([[{ universityId: 1, slug: 1 }, expect.objectContaining({ unique: true })]]));
    expect(departmentSchema.indexes()).toEqual(expect.arrayContaining([[{ facultyId: 1, slug: 1 }, expect.objectContaining({ unique: true })]]));
  });

  it("defines academic calendar and event indexes", () => {
    expect(academicCalendarSchema.get("collection")).toBe("academic_calendars");
    expect(academicEventSchema.get("collection")).toBe("academic_events");
    expect(academicCalendarSchema.indexes()).toEqual(
      expect.arrayContaining([[{ universityId: 1, academicYear: 1, status: 1 }, expect.objectContaining({ name: "calendars_published_lookup" })]])
    );
    expect(academicEventSchema.indexes()).toEqual(
      expect.arrayContaining([[{ universityId: 1, status: 1, startDate: 1 }, expect.objectContaining({ name: "events_university_status_start" })]])
    );
  });

  it("defines PDF source and extracted event indexes", () => {
    expect(pdfSourceSchema.get("collection")).toBe("pdf_sources");
    expect(extractedEventSchema.get("collection")).toBe("extracted_events");
    expect(pdfSourceSchema.indexes()).toEqual(
      expect.arrayContaining([[{ universityId: 1, fileHash: 1 }, expect.objectContaining({ unique: true })]])
    );
    expect(extractedEventSchema.indexes()).toEqual(
      expect.arrayContaining([[{ status: 1, confidenceScore: 1, createdAt: -1 }, expect.objectContaining({ name: "extracted_review_queue" })]])
    );
  });

  it("defines announcement source and item indexes", () => {
    expect(announcementSourceSchema.get("collection")).toBe("announcement_sources");
    expect(announcementItemSchema.get("collection")).toBe("announcement_items");
    expect(announcementSourceSchema.path("canonicalUrl")).toBeDefined();
    expect(announcementSourceSchema.path("trustStatus").options.enum).toEqual(["trusted", "rejected", "quarantined"]);
    expect(announcementSourceSchema.path("trustStatus").options.default).toBe("quarantined");
    expect(announcementSourceSchema.path("duplicateOfId")).toBeDefined();
    for (const path of ["rawTitle", "canonicalUrl", "officialSourceUrl", "publishedAt", "publicationTimeSource", "sourceUpdatedAt", "sourceUpdateTimeSource", "discoveredAt", "fetchedAt", "freshness", "trustStatus", "trustReasonCodes", "dedupeKey", "duplicateOfId"]) {
      expect(announcementItemSchema.path(path), `announcement item path ${path}`).toBeDefined();
    }
    expect(announcementItemSchema.path("trustStatus").options.default).toBe("quarantined");
    expect(announcementSourceSchema.indexes()).toEqual(expect.arrayContaining([
      [{ sourceUrl: 1, scopeType: 1, scopeId: 1 }, expect.objectContaining({ unique: true })],
      [{ canonicalUrl: 1, scopeType: 1, scopeId: 1 }, expect.objectContaining({ name: "announcement_sources_canonical_scope" })]
    ]));
    expect(announcementItemSchema.indexes()).toEqual(expect.arrayContaining([
      [{ sourceId: 1, link: 1 }, expect.objectContaining({ unique: true })],
      [{ sourceId: 1, canonicalUrl: 1 }, expect.objectContaining({ name: "announcement_items_source_canonical" })],
      [{ trustStatus: 1, dedupeKey: 1 }, expect.objectContaining({ name: "announcement_items_trust_dedupe" })]
    ]));
  });

  it("defines notification device, preference and job indexes", () => {
    expect(deviceTokenSchema.get("collection")).toBe("device_tokens");
    expect(notificationPreferenceSchema.get("collection")).toBe("notification_preferences");
    expect(notificationJobSchema.get("collection")).toBe("notification_jobs");
    expect(deviceTokenSchema.indexes()).toEqual(expect.arrayContaining([[{ token: 1 }, expect.objectContaining({ unique: true })]]));
    expect(deviceTokenSchema.indexes()).toEqual(expect.arrayContaining([
      [{ installationHash: 1 }, expect.objectContaining({ unique: true, sparse: true, name: "device_tokens_installation_unique" })]
    ]));
    expect(deviceTokenSchema.path("installationHash")).toBeDefined();
    expect(notificationPreferenceSchema.indexes()).toEqual(expect.arrayContaining([[{ userId: 1 }, expect.objectContaining({ unique: true })]]));
    expect((notificationPreferenceSchema.path("enabled") as unknown as { options: { default: boolean } }).options.default).toBe(false);
    expect((notificationPreferenceSchema.path("deliveryConsentVersion") as unknown as { options: { enum: string[] } }).options.enum).toEqual(["phase3-v1"]);
    expect(notificationJobSchema.path("destinationType")).toBeDefined();
    expect(notificationJobSchema.path("destinationId")).toBeDefined();
    expect((notificationJobSchema.path("status") as unknown as { options: { enum: string[] } }).options.enum).toEqual([
      "scheduled", "processing", "sent", "failed", "dead", "cancelled"
    ]);
    expect(notificationJobSchema.path("processingClaimId")).toBeDefined();
    expect(notificationJobSchema.path("processingLeaseUntil")).toBeDefined();
    expect(notificationDeliverySchema.path("token")).toBeUndefined();
    expect(notificationDeliverySchema.indexes()).toEqual(expect.arrayContaining([
      [{ jobId: 1, status: 1, deviceTokenId: 1 }, expect.objectContaining({ name: "notification_deliveries_job_status_device" })]
    ]));
    expect((notificationDeliverySchema.path("failureReason") as unknown as { options: { enum: string[] } }).options.enum).toEqual([
      "invalid_token",
      "provider_unavailable",
      "provider_rejected",
      "scope_mismatch",
      "preference_disabled",
      "quiet_hours",
      "destination_unavailable",
      "device_registration_stale"
    ]);
    expect(notificationJobSchema.indexes()).toEqual(
      expect.arrayContaining([[{ status: 1, scheduledAt: 1 }, expect.objectContaining({ name: "notification_jobs_due" })]])
    );
    expect(notificationJobSchema.indexes()).toEqual(
      expect.arrayContaining([[{ status: 1, processingLeaseUntil: 1, scheduledAt: 1 }, expect.objectContaining({ name: "notification_jobs_claim_recovery" })]])
    );
  });
});
