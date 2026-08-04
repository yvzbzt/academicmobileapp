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
      isSameScope(candidate, incoming) && fingerprintFor(candidate) === incomingFingerprint);
    const aliasMatchIndex = fingerprintMatchIndex >= 0
      ? -1
      : unmatched.findIndex((candidate) => isSameScope(candidate, incoming) && aliasesOverlap(candidate, incoming));
    const matchIndex = fingerprintMatchIndex >= 0 ? fingerprintMatchIndex : aliasMatchIndex;
    const previous = matchIndex >= 0 ? unmatched.splice(matchIndex, 1)[0] : undefined;
    const canonicalUrlAliases = mergeAliases(source, previous, incoming);
    const contentMateriallyUpdated = Boolean(previous && (
      fingerprintFor(previous) !== incomingFingerprint
      || (previous.contentType ?? "announcement") !== (incoming.contentType ?? "announcement")
    ));
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
        canonicalUrlAliases,
        ...(notificationEligibleFingerprint ? { notificationEligibleFingerprint } : {}),
        ...(notificationProducedFingerprint ? { notificationProducedFingerprint } : {})
      },
      ...(previous ? { previous } : {}),
      materiallyUpdated: contentMateriallyUpdated || notificationProductionPending
    });
  }

  return { entries, removed: unmatched };
}

export function fingerprintFor(item: AnnouncementItem): string {
  return createNormalizedContentFingerprint({
    title: item.title,
    ...(item.summary ? { summary: item.summary } : {}),
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
    scopeType: item.scopeType,
    scopeId: item.scopeId,
    canonicalUrl,
    contentFingerprint: fingerprintFor(item)
  };
}

export function emptyAnnouncementPersistenceDelta(): AnnouncementPersistenceDelta {
  return { created: [], materiallyUpdated: [], unchanged: [], removed: [] };
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
