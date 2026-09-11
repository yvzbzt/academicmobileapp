import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it, vi } from "vitest";
import { AdminAnnouncementsController } from "../src/modules/announcements/announcements.controller.js";
import {
  AnnouncementSourceReviewDto,
  DeleteContentLlmApiKeyDto,
  RunContentLlmReviewDto,
  UpdateAnnouncementSourceDto,
  UpdateContentLlmSettingsDto
} from "../src/modules/announcements/announcements.dto.js";
import type { AuthenticatedUser } from "../src/modules/auth/auth.types.js";

describe("announcement source review API contract", () => {
  const validReview = {
    expectedSourceDefinitionVersion: "64c000000000000000000001",
    expectedCanonicalUrl: "https://www.example.edu.tr/duyurular",
    expectedTrustStatus: "quarantined" as const,
    expectedSourceStatus: "inactive" as const,
    expectedApprovalPending: false,
    note: "Official navigation checked"
  };

  it("caps the synchronous LLM queue request contract at one item", async () => {
    expect(await validate(plainToInstance(RunContentLlmReviewDto, { limit: "1" }))).toEqual([]);
    await expect(validate(plainToInstance(RunContentLlmReviewDto, { limit: "2" })))
      .resolves.not.toEqual([]);
  });

  it("requires every source CAS fence field and validates a complete request", async () => {
    expect(await validate(plainToInstance(AnnouncementSourceReviewDto, validReview))).toEqual([]);
    const missingFence = await validate(plainToInstance(AnnouncementSourceReviewDto, { note: "approve" }));
    expect(new Set(missingFence.map((error) => error.property))).toEqual(new Set([
      "expectedSourceDefinitionVersion",
      "expectedCanonicalUrl",
      "expectedTrustStatus",
      "expectedSourceStatus",
      "expectedApprovalPending"
    ]));
  });

  it("passes the complete observed source fence to review and deactivate commands", async () => {
    const ingestionService = {
      deactivateManualSourceForAdmin: vi.fn(async () => ({ id: "source-1", status: "inactive" }))
    };
    const reviewService = {
      approveSource: vi.fn(async () => ({ source: { id: "source-1" } })),
      rejectSource: vi.fn(async () => ({ id: "source-1" }))
    };
    const controller = new AdminAnnouncementsController(
      ingestionService as never,
      reviewService as never,
      {} as never
    );
    const user: AuthenticatedUser = {
      id: "admin-1",
      email: "admin@example.edu.tr",
      role: "super_admin"
    };
    const body = plainToInstance(AnnouncementSourceReviewDto, validReview);

    await controller.approveSource(user, "source-1", body);
    await controller.rejectSource(user, "source-1", body);
    await controller.deleteSource(user, "source-1", body);

    expect(reviewService.approveSource).toHaveBeenCalledWith(
      { kind: "global" }, "source-1", "admin-1", expect.objectContaining(validReview)
    );
    expect(reviewService.rejectSource).toHaveBeenCalledWith(
      { kind: "global" }, "source-1", "admin-1", expect.objectContaining(validReview)
    );
    expect(ingestionService.deactivateManualSourceForAdmin).toHaveBeenCalledWith(
      { kind: "global" }, "source-1", expect.objectContaining(validReview)
    );
  });

  it("requires and forwards a full source revision fence for metadata edits", async () => {
    const validEdit = {
      ...validReview,
      expectedUpdatedAt: "2026-09-10T08:00:00.000Z",
      sourceName: "Updated official source"
    };
    delete (validEdit as { note?: string }).note;

    expect(await validate(plainToInstance(UpdateAnnouncementSourceDto, validEdit))).toEqual([]);
    const missingFence = await validate(plainToInstance(UpdateAnnouncementSourceDto, {
      sourceName: "Updated official source"
    }));
    expect(new Set(missingFence.map((error) => error.property))).toEqual(new Set([
      "expectedSourceDefinitionVersion",
      "expectedCanonicalUrl",
      "expectedTrustStatus",
      "expectedSourceStatus",
      "expectedApprovalPending",
      "expectedUpdatedAt"
    ]));

    const ingestionService = {
      updateManualSourceForAdmin: vi.fn(async () => ({ source: { id: "source-1" }, ingestion: null }))
    };
    const controller = new AdminAnnouncementsController(
      ingestionService as never,
      {} as never,
      {} as never
    );
    const user: AuthenticatedUser = {
      id: "admin-1",
      email: "admin@example.edu.tr",
      role: "super_admin"
    };
    const body = plainToInstance(UpdateAnnouncementSourceDto, validEdit);

    await controller.updateSource(user, "source-1", body);

    expect(ingestionService.updateManualSourceForAdmin).toHaveBeenCalledWith(
      { kind: "global" }, "source-1", expect.objectContaining(validEdit)
    );
  });

  it("requires and forwards the observed LLM settings revision when deleting a key", async () => {
    const validDelete = plainToInstance(DeleteContentLlmApiKeyDto, { expectedRevision: "7" });
    expect(await validate(validDelete)).toEqual([]);
    expect(validDelete.expectedRevision).toBe(7);
    await expect(validate(plainToInstance(DeleteContentLlmApiKeyDto, {}))).resolves.not.toEqual([]);
    await expect(validate(plainToInstance(DeleteContentLlmApiKeyDto, { expectedRevision: -1 }))).resolves.not.toEqual([]);
    await expect(validate(plainToInstance(DeleteContentLlmApiKeyDto, { expectedRevision: 1.5 }))).resolves.not.toEqual([]);

    const llmSettingsService = {
      deleteApiKey: vi.fn(async () => ({ revision: 8, apiKeyConfigured: false }))
    };
    const controller = new AdminAnnouncementsController(
      {} as never,
      {} as never,
      llmSettingsService as never
    );
    const user: AuthenticatedUser = {
      id: "admin-1",
      email: "admin@example.edu.tr",
      role: "super_admin"
    };

    await controller.deleteLlmKey(user, validDelete);

    expect(llmSettingsService.deleteApiKey).toHaveBeenCalledWith("admin-1", 7);
  });

  it("requires and forwards the observed LLM settings revision when updating settings", async () => {
    const validUpdate = plainToInstance(UpdateContentLlmSettingsDto, {
      expectedRevision: "4",
      provider: "openai",
      model: "gpt-5-mini",
      enabled: false
    });
    expect(await validate(validUpdate)).toEqual([]);
    expect(validUpdate.expectedRevision).toBe(4);
    await expect(validate(plainToInstance(UpdateContentLlmSettingsDto, {
      provider: "openai", model: "gpt-5-mini", enabled: false
    }))).resolves.not.toEqual([]);
    await expect(validate(plainToInstance(UpdateContentLlmSettingsDto, {
      expectedRevision: -1, provider: "openai", model: "gpt-5-mini", enabled: false
    }))).resolves.not.toEqual([]);
    await expect(validate(plainToInstance(UpdateContentLlmSettingsDto, {
      expectedRevision: 1.5, provider: "openai", model: "gpt-5-mini", enabled: false
    }))).resolves.not.toEqual([]);

    const llmSettingsService = {
      updateSettings: vi.fn(async () => ({ revision: 5, apiKeyConfigured: false }))
    };
    const controller = new AdminAnnouncementsController(
      {} as never,
      {} as never,
      llmSettingsService as never
    );
    const user: AuthenticatedUser = {
      id: "admin-1",
      email: "admin@example.edu.tr",
      role: "super_admin"
    };

    await controller.updateLlmSettings(user, validUpdate);

    expect(llmSettingsService.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 4, provider: "openai", model: "gpt-5-mini", enabled: false }),
      "admin-1"
    );
  });
});
