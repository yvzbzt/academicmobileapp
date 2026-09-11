import { createHash } from "node:crypto";
import {
  canonicalContentKey,
  canonicalizeContentUrl,
  createNormalizedContentFingerprint,
  isOfficialContentUrl,
  normalizeTrustedItemsForSource
} from "./announcement-content-trust.js";
import type {
  AnnouncementItem,
  AnnouncementPersistenceDelta,
  AnnouncementPersistenceReference,
  AnnouncementReplacementOptions,
  AnnouncementSourceRecord
} from "./announcements.types.js";

export interface AnnouncementReplacementEntry {
  item: AnnouncementItem;
  previous?: AnnouncementItem;
  contentMateriallyUpdated: boolean;
  reviewMateriallyUpdated: boolean;
  materiallyUpdated: boolean;
}

export interface AnnouncementReplacementPlan {
  entries: AnnouncementReplacementEntry[];
  removed: AnnouncementItem[];
}

export function planAnnouncementReplacement(
  source: AnnouncementSourceRecord,
  items: readonly AnnouncementItem[],
  existingItems: readonly AnnouncementItem[],
  options: AnnouncementReplacementOptions = {}
): AnnouncementReplacementPlan {
  const trustedItems = normalizeTrustedItemsForSource(source, items);
  const unmatched = existingItems
    .filter((item) => item.sourceId === source.id && item.trustStatus === "trusted")
    .sort((left, right) => left.id.localeCompare(right.id, "en-US"));
  // An empty input is used by callers for fetch/layout degradation and keeps
  // the trusted cache. A non-empty authoritative snapshot whose rows now all
  // fail trust is different: its previously trusted rows must be retired.
  if (items.length === 0) return { entries: [], removed: options.authoritativeEmpty ? unmatched : [] };
  if (trustedItems.length === 0) return { entries: [], removed: unmatched };

  const entries: AnnouncementReplacementEntry[] = [];

  for (const incoming of trustedItems) {
    const incomingFingerprint = fingerprintFor(incoming);
    const fingerprintMatchIndex = unmatched.findIndex((candidate) =>
      isSameScope(candidate, incoming)
      && (candidate.contentFingerprint ?? fingerprintFor(candidate)) === incomingFingerprint);
    const aliasMatchIndex = fingerprintMatchIndex >= 0
      ? -1
      : unmatched.findIndex((candidate) => isSameScope(candidate, incoming) && aliasesOverlap(candidate, incoming));
    const matchIndex = fingerprintMatchIndex >= 0 ? fingerprintMatchIndex : aliasMatchIndex;
    const previous = matchIndex >= 0 ? unmatched.splice(matchIndex, 1)[0] : undefined;
    const canonicalUrlAliases = mergeAliases(source, previous, incoming);
    const previousFingerprint = previous?.contentFingerprint ?? (previous ? fingerprintFor(previous) : undefined);
    const contentMateriallyUpdated = Boolean(previous && (
      previousFingerprint !== incomingFingerprint
      || (previous.contentType ?? "announcement") !== (incoming.contentType ?? "announcement")
    ));
    const incomingAdjudicationFingerprint = adjudicationFingerprintFor(incoming, incomingFingerprint);
    const previousAdjudicationFingerprint = previous?.adjudicationFingerprint
      ?? (previous ? adjudicationFingerprintFor(previous, previousFingerprint) : undefined);
    const reviewMateriallyUpdated = Boolean(previous
      && previousAdjudicationFingerprint !== incomingAdjudicationFingerprint);
    const notificationEligibleFingerprint = !previous || contentMateriallyUpdated
      ? incomingFingerprint
      : previous.notificationEligibleFingerprint;
    const notificationProducedFingerprint = previous?.notificationProducedFingerprint;
    const notificationProductionPending = Boolean(
      previous
      && notificationEligibleFingerprint === incomingFingerprint
      && notificationProducedFingerprint !== notificationEligibleFingerprint
    );
    entries.push({
      item: {
        ...incoming,
        adjudicationFingerprint: incomingAdjudicationFingerprint,
        canonicalUrlAliases,
        ...(notificationEligibleFingerprint ? { notificationEligibleFingerprint } : {}),
        ...(notificationProducedFingerprint ? { notificationProducedFingerprint } : {})
      },
      ...(previous ? { previous } : {}),
      contentMateriallyUpdated,
      reviewMateriallyUpdated,
      materiallyUpdated: reviewMateriallyUpdated || notificationProductionPending
    });
  }

  return { entries, removed: unmatched };
}

export function fingerprintFor(item: AnnouncementItem): string {
  return createNormalizedContentFingerprint({
    title: item.title,
    ...(item.summary ? { summary: item.summary } : {}),
    ...(item.body?.length ? { body: item.body } : {}),
    ...(item.contentType ? { contentType: item.contentType } : {}),
    ...(item.publicationKind ? { publicationKind: item.publicationKind } : {}),
    ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
    ...(item.publishedAt ? { publishedAt: item.publishedAt } : {})
  });
}

export function toPersistenceReference(item: AnnouncementItem, id = item.id): AnnouncementPersistenceReference | null {
  const canonicalUrl = canonicalizeContentUrl(item.canonicalUrl ?? item.link);
  if (!canonicalUrl) return null;
  return {
    id,
    sourceId: item.sourceId,
    ...(item.snapshotId ? { snapshotId: item.snapshotId } : {}),
    scopeType: item.scopeType,
    scopeId: item.scopeId,
    canonicalUrl,
    contentFingerprint: item.contentFingerprint ?? fingerprintFor(item)
  };
}

export function emptyAnnouncementPersistenceDelta(): AnnouncementPersistenceDelta {
  return { created: [], materiallyUpdated: [], unchanged: [], removed: [] };
}

function adjudicationFingerprintFor(
  item: AnnouncementItem,
  contentFingerprint = item.contentFingerprint ?? fingerprintFor(item)
): string {
  const audience = Array.isArray(item.audience) ? [...item.audience].sort() : item.audience ?? null;
  return createHash("sha256").update(JSON.stringify([
    "announcement-adjudication-v1",
    contentFingerprint,
    item.studentRelevance ?? null,
    item.topic ?? null,
    audience,
    item.actionType ?? null,
    item.deadline ?? null,
    item.urgency ?? null,
    item.classificationVersion ?? null
  ])).digest("hex");
}

/**
 * A review write replaces the active snapshot too.  Describe the complete set
 * of approved destinations so notification producers can retain the other
 * approved jobs and retire the old snapshot atomically from their perspective.
 */
export function reviewMutationDelta(
  items: readonly AnnouncementItem[],
  targetId: string,
  snapshotId?: string,
  previousSnapshotId?: string
): AnnouncementPersistenceDelta {
  const delta: AnnouncementPersistenceDelta = {
    ...emptyAnnouncementPersistenceDelta(),
    ...(snapshotId ? { snapshotId } : {}),
    ...(previousSnapshotId ? { previousSnapshotId } : {})
  };
  for (const item of items) {
    if (item.reviewStatus !== "approved") continue;
    const reference = toPersistenceReference(item);
    if (!reference) continue;
    if (item.id === targetId) delta.materiallyUpdated.push(reference);
    else delta.unchanged.push(reference);
  }
  return delta;
}

export function carryAnnouncementReviewState(
  item: AnnouncementItem,
  previous: AnnouncementItem | undefined,
  contentMateriallyUpdated: boolean,
  reviewMateriallyUpdated: boolean
): AnnouncementItem {
  if (!previous) return { ...item, reviewStatus: item.reviewStatus ?? "pending_review" };

  if (contentMateriallyUpdated) return { ...item, reviewStatus: "pending_review" };

  const humanOverride = previous.humanOverride;
  if (reviewMateriallyUpdated) {
    return {
      ...item,
      ...(humanOverride ?? {}),
      reviewStatus: "pending_review",
      reviewedBy: null,
      reviewedAt: null,
      ...(previous.reviewNote ? { reviewNote: previous.reviewNote } : {}),
      ...(humanOverride ? { humanOverride } : {})
    };
  }
  return {
    ...item,
    ...(humanOverride ?? {}),
    reviewStatus: previous.reviewStatus ?? "pending_review",
    ...(previous.reviewRevision ? { reviewRevision: previous.reviewRevision } : {}),
    ...(previous.reviewedBy ? { reviewedBy: previous.reviewedBy } : {}),
    ...(previous.reviewedAt ? { reviewedAt: previous.reviewedAt } : {}),
    ...(previous.reviewNote ? { reviewNote: previous.reviewNote } : {}),
    ...(humanOverride ? { humanOverride } : {}),
    ...(previous.llmClassification ? { llmClassification: previous.llmClassification } : {}),
    ...(previous.llmReviewFailure !== undefined ? { llmReviewFailure: previous.llmReviewFailure } : {}),
    ...(previous.llmReviewClaim !== undefined ? { llmReviewClaim: previous.llmReviewClaim } : {})
  };
}

function aliasesOverlap(left: AnnouncementItem, right: AnnouncementItem): boolean {
  const leftKeys = new Set(itemAliases(left).flatMap((value) => {
    const key = canonicalContentKey(value);
    return key ? [key] : [];
  }));
  return itemAliases(right).some((value) => {
    const key = canonicalContentKey(value);
    return Boolean(key && leftKeys.has(key));
  });
}

function itemAliases(item: AnnouncementItem): string[] {
  return [item.canonicalUrl ?? item.link, ...(item.canonicalUrlAliases ?? [])];
}

function mergeAliases(
  source: AnnouncementSourceRecord,
  previous: AnnouncementItem | undefined,
  incoming: AnnouncementItem
): string[] {
  const officialSourceUrl = source.canonicalUrl ?? source.sourceUrl;
  return [...new Set([
    ...(previous ? itemAliases(previous) : []),
    ...itemAliases(incoming)
  ].flatMap((value) => {
    const canonicalUrl = canonicalizeContentUrl(value);
    return canonicalUrl && isOfficialContentUrl(canonicalUrl, officialSourceUrl) ? [canonicalUrl] : [];
  }))].sort((left, right) => left.localeCompare(right, "en-US"));
}

function isSameScope(left: AnnouncementItem, right: AnnouncementItem): boolean {
  return left.scopeType === right.scopeType && left.scopeId === right.scopeId;
}
