import {
  admitTrustedContentRecord,
  logicalContentIdentityKey,
  normalizeDisplayText,
  type ContentCollectionState,
  type TrustedMobileContentRecord,
} from "../content/content-trust";

export const CONTENT_FEED_SEARCH_DEBOUNCE_MS = 300;
export const CONTENT_FEED_LIMITS = [20, 40, 60, 80, 100] as const;
export const CONTENT_FEED_INITIAL_LIMIT: number = CONTENT_FEED_LIMITS[0];
export const CONTENT_FEED_LIMIT_STEP = 20;
export const CONTENT_FEED_MAX_LIMIT: number = CONTENT_FEED_LIMITS[CONTENT_FEED_LIMITS.length - 1];

export type FeedContentTypeFilter = "all" | "announcement" | "news" | "event";
export type FeedSourceFilter =
  | "all"
  | "university"
  | "faculty"
  | "department"
  | "yok"
  | "summer-school";
export type ContentFeedSourceFamily = Exclude<FeedSourceFilter, "all">;
export type ContentFeedTimestampKind = "published" | "updated";
export type ContentFeedState =
  | "initial_loading"
  | "background_refresh"
  | "populated"
  | "empty"
  | "no_results"
  | "stale"
  | "partial"
  | "offline"
  | "recoverable_error"
  | "pagination_loading"
  | "pagination_failure";

export interface ContentFeedItem {
  key: string;
  record: TrustedMobileContentRecord;
  contentType: Exclude<FeedContentTypeFilter, "all">;
  sourceFamilies: readonly ContentFeedSourceFamily[];
  displayTimestamp: string | null;
  displayTimestampKind: ContentFeedTimestampKind | null;
}

export interface ContentFeedBuildInput {
  academic: readonly TrustedMobileContentRecord[];
  yok: readonly TrustedMobileContentRecord[];
  summerSchool: readonly TrustedMobileContentRecord[];
}

export interface ContentFeedFilters {
  contentType: FeedContentTypeFilter;
  source: FeedSourceFilter;
  query: string;
}

export interface ContentFeedStateInput {
  loading: boolean;
  attempted: boolean;
  totalItemCount: number;
  visibleItemCount: number;
  hasActiveFilters: boolean;
  error?: string;
  offline?: boolean;
  stale?: boolean;
  collectionState?: ContentCollectionState;
  paginationLoading?: boolean;
  paginationError?: string;
}

export interface ContentFeedLayout {
  gutter: number;
  maxWidth: number;
  columns: 1;
  minTouchTarget: 48;
  filterGroupsStacked: boolean;
  supportsLargeText: boolean;
  allowsHorizontalClipping: false;
}

export type ContentFeedRequestKind = "refresh" | "pagination";

export interface ContentFeedRequestLease {
  generation: number;
  kind: ContentFeedRequestKind;
}

export interface ContentFeedRequestCoordinator {
  beginRefresh: () => ContentFeedRequestLease | null;
  beginPagination: () => ContentFeedRequestLease | null;
  captureGeneration: () => number;
  finish: (lease: ContentFeedRequestLease) => void;
  isGenerationCurrent: (generation: number) => boolean;
  isCurrent: (lease: ContentFeedRequestLease) => boolean;
  reset: () => void;
}

export interface ContentFeedLoadableState<T> {
  loading: boolean;
  data?: T;
  error?: string;
  attempted?: boolean;
  stale?: boolean;
}

export interface ContentFeedPaginationEvidence {
  requestedLimit: number;
  nextCursor?: string;
  hasMore?: boolean;
  explicitRawCount?: number;
  rawItemCount: number;
}

interface FeedCandidate {
  key: string;
  record: TrustedMobileContentRecord;
  contentType: Exclude<FeedContentTypeFilter, "all">;
  family: ContentFeedSourceFamily;
  displayTimestamp: string | null;
  displayTimestampKind: ContentFeedTimestampKind | null;
  displayTimestampValue: number;
  sourceUpdatedTimestampValue: number;
}

const sourceFamilyOrder: readonly ContentFeedSourceFamily[] = [
  "university",
  "faculty",
  "department",
  "yok",
  "summer-school",
];

const strictIsoTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const strictDateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * Builds the renderable feed from records that have already crossed the Phase 2
 * normalizer. This is intentionally a second, fail-closed presentation gate.
 */
export function buildContentFeed(input: ContentFeedBuildInput): ContentFeedItem[] {
  const candidates: FeedCandidate[] = [];

  for (const record of input.academic) {
    const family = academicSourceFamily(record.scopeType);
    if (!family) continue;
    const candidate = toFeedCandidate(record, family);
    if (candidate) candidates.push(candidate);
  }
  for (const record of input.yok) {
    const candidate = toFeedCandidate(record, "yok");
    if (candidate) candidates.push(candidate);
  }
  for (const record of input.summerSchool) {
    const candidate = toFeedCandidate(record, "summer-school");
    if (candidate) candidates.push(candidate);
  }

  const deduplicated = new Map<string, { candidate: FeedCandidate; families: Set<ContentFeedSourceFamily> }>();
  for (const candidate of candidates) {
    const existing = deduplicated.get(candidate.key);
    if (!existing) {
      deduplicated.set(candidate.key, { candidate, families: new Set([candidate.family]) });
      continue;
    }

    existing.families.add(candidate.family);
    if (compareFeedCandidates(candidate, existing.candidate) < 0) existing.candidate = candidate;
  }

  return [...deduplicated.values()]
    .map(({ candidate, families }) => ({
      key: candidate.key,
      record: candidate.record,
      contentType: candidate.contentType,
      sourceFamilies: sourceFamilyOrder.filter((family) => families.has(family)),
      displayTimestamp: candidate.displayTimestamp,
      displayTimestampKind: candidate.displayTimestampKind,
    }))
    .sort(compareContentFeedItems);
}

export function filterContentFeed(
  items: readonly ContentFeedItem[],
  filters: ContentFeedFilters,
): ContentFeedItem[] {
  const searchTokens = foldContentFeedSearchText(filters.query).split(" ").filter(Boolean);

  return items.filter((item) => {
    if (filters.contentType !== "all" && item.contentType !== filters.contentType) return false;
    if (filters.source !== "all" && !item.sourceFamilies.includes(filters.source)) return false;
    if (searchTokens.length === 0) return true;

    const searchableText = foldContentFeedSearchText([
      item.record.title,
      item.record.summary ?? "",
      item.record.sourceName,
      item.record.universityName ?? "",
      item.record.facultyName ?? "",
      item.record.departmentName ?? "",
    ].join(" "));
    return searchTokens.every((token) => searchableText.includes(token));
  });
}

/** Folds Turkish dotted/dotless I and diacritics without retaining raw queries. */
export function foldContentFeedSearchText(value: string): string {
  return normalizeDisplayText(value)
    .replace(/\u0131/gu, "i")
    .replace(/\u0130/gu, "I")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function hasActiveContentFeedFilters(filters: ContentFeedFilters): boolean {
  return filters.contentType !== "all"
    || filters.source !== "all"
    || foldContentFeedSearchText(filters.query).length > 0;
}

/** Resolves one dominant feed state; useful retained records are never replaced by a full-screen error. */
export function resolveContentFeedState(input: ContentFeedStateInput): ContentFeedState {
  const hasItems = input.totalItemCount > 0;
  const hasVisibleItems = input.visibleItemCount > 0;

  if (!hasItems) {
    if (input.offline) return "offline";
    if (input.loading) return "initial_loading";
    if (input.error) return "recoverable_error";
    if (input.attempted && input.collectionState === "partial") return "partial";
    return input.attempted ? "empty" : "initial_loading";
  }

  if (!hasVisibleItems && input.hasActiveFilters) return "no_results";
  if (input.paginationLoading) return "pagination_loading";
  if (input.paginationError) return "pagination_failure";
  if (input.offline) return "offline";
  if (input.loading) return "background_refresh";
  if (input.collectionState === "partial") return "partial";
  if (input.stale || input.collectionState === "stale" || input.error) return "stale";
  return "populated";
}

export function resolveContentFeedLayout(width: number, fontScale: number): ContentFeedLayout {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 320;
  const safeFontScale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  return {
    gutter: safeWidth < 375 ? 16 : 20,
    maxWidth: 720,
    columns: 1,
    minTouchTarget: 48,
    filterGroupsStacked: safeWidth < 375 || safeFontScale >= 2,
    supportsLargeText: safeFontScale >= 2,
    allowsHorizontalClipping: false,
  };
}

export function nextContentFeedLimit(currentLimit: number): number {
  if (!Number.isFinite(currentLimit)) return CONTENT_FEED_INITIAL_LIMIT;
  return CONTENT_FEED_LIMITS.find((limit) => limit > currentLimit) ?? CONTENT_FEED_MAX_LIMIT;
}

export function resolveContentFeedHasMore(input: ContentFeedPaginationEvidence): boolean {
  if (!Number.isSafeInteger(input.requestedLimit)) return false;
  if (input.requestedLimit < CONTENT_FEED_INITIAL_LIMIT || input.requestedLimit >= CONTENT_FEED_MAX_LIMIT) return false;
  if (typeof input.nextCursor === "string" && input.nextCursor.trim()) return true;
  if (typeof input.hasMore === "boolean") return input.hasMore;
  const explicitRawCount = typeof input.explicitRawCount === "number"
    && Number.isSafeInteger(input.explicitRawCount)
    && input.explicitRawCount >= 0
    ? input.explicitRawCount
    : undefined;
  const rawCount = explicitRawCount ?? input.rawItemCount;
  return Number.isSafeInteger(rawCount) && rawCount >= input.requestedLimit;
}

/** Compatibility wrapper for older call sites; raw cardinality remains last in precedence. */
export function inferContentFeedHasMore(input: {
  requestedLimit: number;
  receivedCount: number;
}): boolean {
  return resolveContentFeedHasMore({
    requestedLimit: input.requestedLimit,
    rawItemCount: input.receivedCount
  });
}

/** Settles a locally invalidated request without discarding retained trusted data or status. */
export function settleContentFeedLoading<T>(
  state: ContentFeedLoadableState<T>,
): ContentFeedLoadableState<T> {
  return state.loading ? { ...state, loading: false } : state;
}

/**
 * Serializes feed refresh/pagination work without retaining response data.
 * A refresh invalidates an older pagination lease so a late smaller response
 * cannot overwrite a newer refresh result or limit.
 */
export function createContentFeedRequestCoordinator(): ContentFeedRequestCoordinator {
  let generation = 0;
  let refreshInFlight = false;
  let paginationInFlight = false;

  return {
    beginRefresh() {
      if (refreshInFlight) return null;
      generation += 1;
      refreshInFlight = true;
      paginationInFlight = false;
      return { generation, kind: "refresh" };
    },
    beginPagination() {
      if (refreshInFlight || paginationInFlight) return null;
      paginationInFlight = true;
      return { generation, kind: "pagination" };
    },
    captureGeneration() {
      return generation;
    },
    finish(lease) {
      if (lease.generation !== generation) return;
      if (lease.kind === "refresh") refreshInFlight = false;
      else paginationInFlight = false;
    },
    isGenerationCurrent(candidate) {
      return candidate === generation;
    },
    isCurrent(lease) {
      return lease.generation === generation
        && (lease.kind === "refresh" ? refreshInFlight : paginationInFlight);
    },
    reset() {
      generation += 1;
      refreshInFlight = false;
      paginationInFlight = false;
    },
  };
}

function toFeedCandidate(
  record: TrustedMobileContentRecord,
  family: ContentFeedSourceFamily,
): FeedCandidate | null {
  const admittedRecord = admitTrustedContentRecord(record);
  const logicalKey = admittedRecord ? logicalContentIdentityKey(admittedRecord) : null;
  if (!admittedRecord || !logicalKey) return null;
  record = admittedRecord;

  const publishedDate = record.publicationKind === "date" ? trustedDateOnly(record.publishedDate) : null;
  const publishedTimestamp = publishedDate?.sortValue ?? trustedTimestamp(record.publishedAt);
  const updatedTimestamp = trustedTimestamp(record.sourceUpdatedAt);
  const displayTimestamp = publishedDate
    ? publishedDate.value
    : publishedTimestamp
      ? record.publishedAt ?? null
    : updatedTimestamp
      ? record.sourceUpdatedAt ?? null
      : null;
  const displayTimestampKind: ContentFeedTimestampKind | null = publishedDate || publishedTimestamp
    ? "published"
    : updatedTimestamp
      ? "updated"
      : null;

  return {
    key: logicalKey,
    record,
    contentType: record.contentType ?? "announcement",
    family,
    displayTimestamp,
    displayTimestampKind,
    displayTimestampValue: publishedTimestamp ?? updatedTimestamp ?? Number.NEGATIVE_INFINITY,
    sourceUpdatedTimestampValue: updatedTimestamp ?? Number.NEGATIVE_INFINITY,
  };
}

function academicSourceFamily(value: string): Extract<ContentFeedSourceFamily, "university" | "faculty" | "department"> | null {
  return value === "university" || value === "faculty" || value === "department" ? value : null;
}

function compareContentFeedItems(left: ContentFeedItem, right: ContentFeedItem): number {
  const leftPublished = trustedPublicationTimestamp(left.record);
  const rightPublished = trustedPublicationTimestamp(right.record);
  const leftDisplay = leftPublished ?? trustedTimestamp(left.record.sourceUpdatedAt) ?? Number.NEGATIVE_INFINITY;
  const rightDisplay = rightPublished ?? trustedTimestamp(right.record.sourceUpdatedAt) ?? Number.NEGATIVE_INFINITY;
  if (leftDisplay !== rightDisplay) return rightDisplay - leftDisplay;

  const leftUpdated = trustedTimestamp(left.record.sourceUpdatedAt) ?? Number.NEGATIVE_INFINITY;
  const rightUpdated = trustedTimestamp(right.record.sourceUpdatedAt) ?? Number.NEGATIVE_INFINITY;
  if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
  return compareStableText(left.key, right.key);
}

function compareFeedCandidates(left: FeedCandidate, right: FeedCandidate): number {
  if (left.displayTimestampValue !== right.displayTimestampValue) {
    return right.displayTimestampValue - left.displayTimestampValue;
  }
  const leftPublished = left.displayTimestampKind === "published";
  const rightPublished = right.displayTimestampKind === "published";
  if (leftPublished !== rightPublished) return leftPublished ? -1 : 1;
  if (left.sourceUpdatedTimestampValue !== right.sourceUpdatedTimestampValue) {
    return right.sourceUpdatedTimestampValue - left.sourceUpdatedTimestampValue;
  }
  const leftHasSummary = Boolean(normalizeDisplayText(left.record.summary));
  const rightHasSummary = Boolean(normalizeDisplayText(right.record.summary));
  if (leftHasSummary !== rightHasSummary) return leftHasSummary ? -1 : 1;
  return compareStableText(recordTieBreaker(left.record), recordTieBreaker(right.record));
}

function recordTieBreaker(record: TrustedMobileContentRecord): string {
  return [record.id, record.sourceId, record.sourceName, record.canonicalUrl].join("\u0000");
}

function trustedTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const match = strictIsoTimestampPattern.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offset = /([+-])(\d{2}):(\d{2})$/u.exec(value);
  const offsetHour = Number(offset?.[2] ?? 0);
  const offsetMinute = Number(offset?.[3] ?? 0);
  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 14
    || offsetMinute > 59
    || (offsetHour === 14 && offsetMinute !== 0)
  ) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function trustedDateOnly(value: string | undefined): { value: string; sortValue: number } | null {
  if (!value) return null;
  const match = strictDateOnlyPattern.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  // Noon is used only as an internal monotonic sort key; the API value and UI
  // remain a calendar date and never expose a fabricated midnight/clock.
  return { value, sortValue: Date.UTC(year, month - 1, day, 12) };
}

function trustedPublicationTimestamp(record: TrustedMobileContentRecord): number | null {
  const dateOnly = record.publicationKind === "date" ? trustedDateOnly(record.publishedDate) : null;
  return dateOnly?.sortValue ?? trustedTimestamp(record.publishedAt);
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
