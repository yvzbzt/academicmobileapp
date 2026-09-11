import {
  ACADEMIC_CONTENT_BODY_BLOCK_MAX_LENGTH,
  ACADEMIC_CONTENT_BODY_MAX_BLOCKS,
  ACADEMIC_CONTENT_BODY_MAX_LENGTH,
  ACADEMIC_CONTENT_SUMMARY_MAX_LENGTH
} from "../../../packages/shared/src/contracts.js";

export const contentReviewBodyBlockMaxLength = ACADEMIC_CONTENT_BODY_BLOCK_MAX_LENGTH;
export const contentReviewBodyMaxBlocks = ACADEMIC_CONTENT_BODY_MAX_BLOCKS;
export const contentReviewBodyMaxLength = ACADEMIC_CONTENT_BODY_MAX_LENGTH;
export const contentReviewSummaryMaxLength = ACADEMIC_CONTENT_SUMMARY_MAX_LENGTH;

export type ContentReviewBodyBlockType = "heading" | "paragraph" | "bullet";

export interface ContentReviewBodyBlock {
  type: ContentReviewBodyBlockType;
  text: string;
}

export interface ContentReviewFormSource {
  id: string;
  snapshotId?: string;
  contentFingerprint: string;
  reviewRevision?: string;
  title: string;
  summary?: string;
  body?: ContentReviewBodyBlock[] | string;
  studentRelevance?: string;
  topic?: string;
  audience?: string[] | "unknown";
  actionType?: string;
  deadline?: string;
  urgency?: string;
  reviewStatus?: string;
  status?: string;
}

export interface ContentReviewFormDraft {
  title: string;
  summary: string;
  body: ContentReviewBodyBlock[];
  studentRelevance: string;
  topic: string;
  audience: string;
  actionType: string;
  deadline: string;
  urgency: string;
  reviewStatus: string;
}

export interface ContentReviewClassificationSuggestion {
  studentRelevance?: string;
  topic?: string;
  audience?: readonly string[] | "unknown";
  actionType?: string;
  deadline?: string;
  urgency?: string;
}

export type SerializedContentReviewBody =
  | { ok: true; blocks: ContentReviewBodyBlock[]; characterCount: number }
  | { ok: false; reason: "block_count" | "total_length"; blockCount: number; characterCount: number };

export interface ContentReviewMutationPayload {
  title: string;
  summary: string;
  body: ContentReviewBodyBlock[];
  studentRelevance: string;
  topic: string;
  audience: string[] | "unknown";
  actionType: string;
  deadline: string;
  urgency: string;
  reviewStatus: string;
  expectedSnapshotId?: string;
  expectedContentFingerprint: string;
  expectedReviewRevision?: string;
}

/** A React identity tied to the same optimistic-concurrency fence sent to the API. */
export function contentReviewFenceKey(item: Pick<ContentReviewFormSource, "id" | "snapshotId" | "contentFingerprint" | "reviewRevision">): string {
  return JSON.stringify([
    item.id,
    item.snapshotId ?? "",
    item.contentFingerprint,
    item.reviewRevision ?? ""
  ]);
}

/** Creates a controlled editor draft while retaining the source body's block types and order. */
export function createContentReviewFormDraft(item: ContentReviewFormSource): ContentReviewFormDraft {
  const body = typeof item.body === "string"
    ? paragraphsFromLegacyBody(item.body)
    : (item.body ?? []).map((block) => ({ type: block.type, text: block.text }));

  return {
    title: item.title,
    summary: item.summary ?? "",
    body: body.length ? body : [{ type: "paragraph", text: "" }],
    studentRelevance: item.studentRelevance ?? "uncertain",
    topic: item.topic ?? "unknown",
    audience: item.audience === "unknown" ? "" : (item.audience ?? []).join(", "),
    actionType: item.actionType ?? "unknown",
    deadline: item.deadline === "unknown" ? "" : (item.deadline ?? ""),
    urgency: item.urgency ?? "unknown",
    reviewStatus: item.reviewStatus ?? item.status ?? "pending_review"
  };
}

/**
 * Copies only classification fields into the local editor. In particular, an
 * LLM suggestion can never change the human review decision or submit data.
 */
export function applyContentReviewClassificationSuggestion(
  draft: ContentReviewFormDraft,
  suggestion: ContentReviewClassificationSuggestion
): ContentReviewFormDraft {
  return {
    ...draft,
    ...(suggestion.studentRelevance ? { studentRelevance: suggestion.studentRelevance } : {}),
    ...(suggestion.topic ? { topic: suggestion.topic } : {}),
    ...(suggestion.audience !== undefined
      ? { audience: suggestion.audience === "unknown" ? "" : suggestion.audience.join(", ") }
      : {}),
    ...(suggestion.actionType ? { actionType: suggestion.actionType } : {}),
    ...(suggestion.deadline !== undefined
      ? { deadline: suggestion.deadline === "unknown" ? "" : suggestion.deadline }
      : {}),
    ...(suggestion.urgency ? { urgency: suggestion.urgency } : {})
  };
}

/**
 * Converts editable blocks to the API representation. Long editor blocks are split instead of
 * truncated, and every emitted block satisfies UpdateAnnouncementReviewItemDto's 800-char limit.
 */
export function serializeContentReviewBody(blocks: readonly ContentReviewBodyBlock[]): SerializedContentReviewBody {
  const serialized: ContentReviewBodyBlock[] = [];
  let characterCount = 0;

  for (const block of blocks) {
    let remaining = block.text.trim();
    while (remaining) {
      const end = safeUtf16ChunkEnd(remaining, contentReviewBodyBlockMaxLength);
      const text = remaining.slice(0, end);
      serialized.push({ type: block.type, text });
      characterCount += text.length;
      remaining = remaining.slice(end);
    }
  }

  if (serialized.length > contentReviewBodyMaxBlocks) {
    return { ok: false, reason: "block_count", blockCount: serialized.length, characterCount };
  }
  if (characterCount > contentReviewBodyMaxLength) {
    return { ok: false, reason: "total_length", blockCount: serialized.length, characterCount };
  }
  return { ok: true, blocks: serialized, characterCount };
}

/** Builds the single CAS mutation used by both Save and Approve in the editor. */
export function createContentReviewMutationPayload(
  item: Pick<ContentReviewFormSource, "snapshotId" | "contentFingerprint" | "reviewRevision">,
  draft: ContentReviewFormDraft,
  body: ContentReviewBodyBlock[],
  forcedReviewStatus?: "approved" | "rejected"
): ContentReviewMutationPayload {
  const audience = draft.audience.split(",").map((entry) => entry.trim()).filter(Boolean);
  return {
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    body,
    studentRelevance: draft.studentRelevance,
    topic: draft.topic,
    audience: audience.length ? audience : "unknown",
    actionType: draft.actionType || "unknown",
    deadline: draft.deadline || "unknown",
    urgency: draft.urgency || "unknown",
    reviewStatus: forcedReviewStatus ?? draft.reviewStatus,
    ...(item.snapshotId ? { expectedSnapshotId: item.snapshotId } : {}),
    expectedContentFingerprint: item.contentFingerprint,
    ...(item.reviewRevision !== undefined ? { expectedReviewRevision: item.reviewRevision } : {})
  };
}

function paragraphsFromLegacyBody(body: string): ContentReviewBodyBlock[] {
  return body
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/u)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ type: "paragraph", text }));
}

function safeUtf16ChunkEnd(value: string, maximum: number): number {
  if (value.length <= maximum) return value.length;
  const proposed = maximum;
  const lastCodeUnit = value.charCodeAt(proposed - 1);
  const nextCodeUnit = value.charCodeAt(proposed);
  const splitsSurrogatePair = lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff
    && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff;
  return splitsSurrogatePair ? proposed - 1 : proposed;
}
