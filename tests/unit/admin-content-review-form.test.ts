import { describe, expect, it } from "vitest";
import {
  contentReviewBodyBlockMaxLength,
  contentReviewBodyMaxLength,
  contentReviewBodyMaxBlocks,
  contentReviewFenceKey,
  applyContentReviewClassificationSuggestion,
  createContentReviewMutationPayload,
  createContentReviewFormDraft,
  serializeContentReviewBody
} from "../../apps/admin/src/content-review-form.js";

describe("admin content review form model", () => {
  it("changes the mounted editor identity for every CAS fence component", () => {
    const base = {
      id: "item-1",
      snapshotId: "snapshot-1",
      contentFingerprint: "a".repeat(64),
      reviewRevision: "revision-1"
    };

    expect(new Set([
      contentReviewFenceKey(base),
      contentReviewFenceKey({ ...base, snapshotId: "snapshot-2" }),
      contentReviewFenceKey({ ...base, contentFingerprint: "b".repeat(64) }),
      contentReviewFenceKey({ ...base, reviewRevision: "revision-2" })
    ])).toHaveLength(4);
  });

  it("creates a controlled draft without flattening body block structure", () => {
    const draft = createContentReviewFormDraft({
      id: "item-1",
      contentFingerprint: "a".repeat(64),
      title: "Kayıt duyurusu",
      body: [
        { type: "heading", text: "Başvuru" },
        { type: "paragraph", text: "Açıklama" },
        { type: "bullet", text: "Belge" }
      ],
      audience: ["all_students", "bachelor_students"],
      status: "approved"
    });

    expect(draft.body).toEqual([
      { type: "heading", text: "Başvuru" },
      { type: "paragraph", text: "Açıklama" },
      { type: "bullet", text: "Belge" }
    ]);
    expect(draft.audience).toBe("all_students, bachelor_students");
    expect(draft.reviewStatus).toBe("approved");
  });

  it("splits long normal content into API-safe blocks without truncating it", () => {
    const longText = `${"a".repeat(799)}🎓${"b".repeat(805)}`;
    const result = serializeContentReviewBody([{ type: "paragraph", text: longText }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks.length).toBe(3);
    expect(result.blocks.every((block) => block.text.length <= contentReviewBodyBlockMaxLength)).toBe(true);
    expect(result.blocks.map((block) => block.text).join("")).toBe(longText);
    expect(result.blocks.every((block) => block.type === "paragraph")).toBe(true);
  });

  it("rejects a payload that would exceed the shared API/mobile block limit", () => {
    const result = serializeContentReviewBody([
      { type: "bullet", text: "x".repeat(contentReviewBodyBlockMaxLength * contentReviewBodyMaxBlocks + 1) }
    ]);

    expect(result).toEqual({
      ok: false,
      reason: "block_count",
      blockCount: contentReviewBodyMaxBlocks + 1,
      characterCount: contentReviewBodyBlockMaxLength * contentReviewBodyMaxBlocks + 1
    });
  });

  it("rejects content that fits the block count but exceeds the mobile character contract", () => {
    const result = serializeContentReviewBody([
      { type: "paragraph", text: "x".repeat(contentReviewBodyMaxLength + 1) }
    ]);

    expect(result).toMatchObject({
      ok: false,
      reason: "total_length",
      characterCount: contentReviewBodyMaxLength + 1
    });
  });

  it("approves the current edited draft and CAS fence in one mutation", () => {
    const item = {
      id: "item-1",
      snapshotId: "snapshot-1",
      contentFingerprint: "a".repeat(64),
      reviewRevision: "revision-1",
      title: "Old server title"
    };
    const draft = {
      ...createContentReviewFormDraft(item),
      title: "Corrected title",
      summary: "Corrected summary",
      topic: "course_registration",
      audience: "all_students, bachelor_students"
    };
    const body = [{ type: "paragraph" as const, text: "Corrected body" }];

    expect(createContentReviewMutationPayload(item, draft, body, "approved")).toEqual(expect.objectContaining({
      title: "Corrected title",
      summary: "Corrected summary",
      body,
      topic: "course_registration",
      audience: ["all_students", "bachelor_students"],
      reviewStatus: "approved",
      expectedSnapshotId: "snapshot-1",
      expectedContentFingerprint: "a".repeat(64),
      expectedReviewRevision: "revision-1"
    }));
  });

  it("applies an LLM classification only to the local draft and never changes review status", () => {
    const draft = createContentReviewFormDraft({
      id: "item-1",
      contentFingerprint: "a".repeat(64),
      title: "Kayıt duyurusu",
      reviewStatus: "pending_review"
    });

    expect(applyContentReviewClassificationSuggestion(draft, {
      studentRelevance: "relevant",
      topic: "course_registration",
      audience: ["all_students", "bachelor_students"],
      actionType: "register",
      deadline: "2026-09-30",
      urgency: "high"
    })).toEqual({
      ...draft,
      studentRelevance: "relevant",
      topic: "course_registration",
      audience: "all_students, bachelor_students",
      actionType: "register",
      deadline: "2026-09-30",
      urgency: "high",
      reviewStatus: "pending_review"
    });
  });

  it("maps unknown LLM audience and deadline to the editor's empty values", () => {
    const draft = {
      ...createContentReviewFormDraft({
        id: "item-1",
        contentFingerprint: "a".repeat(64),
        title: "Duyuru",
        reviewStatus: "approved"
      }),
      audience: "all_students",
      deadline: "2026-09-30"
    };

    expect(applyContentReviewClassificationSuggestion(draft, {
      audience: "unknown",
      deadline: "unknown"
    })).toMatchObject({
      audience: "",
      deadline: "",
      reviewStatus: "approved"
    });
  });
});
