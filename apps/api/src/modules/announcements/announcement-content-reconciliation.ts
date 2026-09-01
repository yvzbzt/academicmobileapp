import { createHash } from "node:crypto";
import {
  canonicalContentKey,
  canonicalizeContentUrl,
  evaluateContentTrust,
  isOfficialContentUrl,
  normalizeContentTitle,
  normalizeDisplayText,
  officialDomainForUrl,
  toIsoString
} from "./announcement-content-trust.js";
import type { AnnouncementContentType, AnnouncementTrustReason, AnnouncementTrustStatus } from "./announcements.types.js";

export interface ReconciliationSourceDocument {
  id: string;
  scopeType?: "university" | "faculty" | "department";
  scopeId?: string;
  sourceName?: string;
  contentType?: AnnouncementContentType;
  sourceUrl?: string;
  canonicalUrl?: string;
  homepageUrl?: string;
  status?: "active" | "inactive";
  trustStatus?: AnnouncementTrustStatus;
  trustReasonCodes?: string[];
  duplicateOfId?: string;
  discoveredAt?: string | Date;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface ReconciliationItemDocument {
  id: string;
  sourceId?: string;
  sourceName?: string;
  contentType?: AnnouncementContentType;
  scopeType?: "university" | "faculty" | "department";
  scopeId?: string;
  title?: string;
  rawTitle?: string;
  link?: string;
  canonicalUrl?: string;
  officialSourceUrl?: string;
  publishedAt?: string | Date;
  publicationTimeSource?: "source";
  sourceUpdatedAt?: string | Date;
  sourceUpdateTimeSource?: "source";
  discoveredAt?: string | Date;
  fetchedAt?: string | Date;
  summary?: string;
  freshness?: "fresh" | "stale";
  trustStatus?: AnnouncementTrustStatus;
  trustReasonCodes?: string[];
  dedupeKey?: string;
  duplicateOfId?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface ReconciliationMutation {
  id: string;
  preimageHash: string;
  set: Record<string, unknown>;
  unset: string[];
}

export interface ContentReconciliationPlan {
  sources: ReconciliationMutation[];
  items: ReconciliationMutation[];
  summary: {
    sourceDocuments: number;
    itemDocuments: number;
    sourceMutations: number;
    itemMutations: number;
    trusted: number;
    rejected: number;
    quarantined: number;
    duplicates: number;
    removedCrawlerPublicationTimes: number;
  };
}

export interface ReconciliationCliOptions {
  apply: boolean;
  verifyPostApply?: true;
  confirmDatabase?: string;
  verificationReport?: string;
  confirmVerificationSha256?: string;
  batchSize: number;
}

export interface ReconciliationSourceTrustOverride {
  trustStatus: "rejected" | "quarantined";
  trustReasonCodes: AnnouncementTrustReason[];
}

export const BUILT_IN_OFFICIAL_SCOPE_URLS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "university:yok-council-of-higher-education": ["https://www.yok.gov.tr/tr"],
  "university:yok": ["https://www.yok.gov.tr/tr"]
});

export function parseReconciliationCliOptions(arguments_: string[]): ReconciliationCliOptions {
  let apply = false;
  let verifyPostApply = false;
  let confirmDatabase: string | undefined;
  let verificationReport: string | undefined;
  let confirmVerificationSha256: string | undefined;
  let batchSize = 250;
  for (const argument of arguments_) {
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--verify-post-apply") {
      verifyPostApply = true;
      continue;
    }
    if (argument.startsWith("--confirm-database=")) {
      confirmDatabase = argument.slice("--confirm-database=".length).trim() || undefined;
      continue;
    }
    if (argument.startsWith("--batch-size=")) {
      const parsed = Number(argument.slice("--batch-size=".length));
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000) throw new Error("CONTENT_RECONCILIATION_BATCH_SIZE_INVALID");
      batchSize = parsed;
      continue;
    }
    if (argument.startsWith("--verification-report=")) {
      verificationReport = argument.slice("--verification-report=".length).trim() || undefined;
      continue;
    }
    if (argument.startsWith("--confirm-verification-sha256=")) {
      const value = argument.slice("--confirm-verification-sha256=".length).trim().toLocaleLowerCase("en-US");
      if (value && !/^[a-f\d]{64}$/u.test(value)) throw new Error("CONTENT_RECONCILIATION_VERIFICATION_HASH_INVALID");
      confirmVerificationSha256 = value || undefined;
      continue;
    }
    throw new Error("CONTENT_RECONCILIATION_ARGUMENT_INVALID");
  }
  if (apply && verifyPostApply) throw new Error("CONTENT_RECONCILIATION_MODE_CONFLICT");
  if ((apply || verifyPostApply) && !confirmDatabase) throw new Error("CONTENT_RECONCILIATION_DATABASE_CONFIRMATION_REQUIRED");
  if ((apply || verifyPostApply) && !verificationReport) throw new Error("CONTENT_RECONCILIATION_VERIFICATION_REPORT_REQUIRED");
  if ((apply || verifyPostApply) && !confirmVerificationSha256) throw new Error("CONTENT_RECONCILIATION_VERIFICATION_HASH_REQUIRED");
  if (confirmVerificationSha256 && !verificationReport) {
    throw new Error("CONTENT_RECONCILIATION_VERIFICATION_REPORT_REQUIRED");
  }
  return {
    apply,
    ...(verifyPostApply ? { verifyPostApply: true as const } : {}),
    ...(confirmDatabase ? { confirmDatabase } : {}),
    ...(verificationReport ? { verificationReport } : {}),
    ...(confirmVerificationSha256 ? { confirmVerificationSha256 } : {}),
    batchSize
  };
}

export function databaseNameFromMongoUri(uri: string): string | null {
  try {
    const match = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?#]+)(?:[?#].*)?$/u);
    return match?.[1] ? decodeURIComponent(match[1]) || null : null;
  } catch {
    return null;
  }
}

export function planAnnouncementContentReconciliation(input: {
  sources: ReconciliationSourceDocument[];
  items: ReconciliationItemDocument[];
  officialScopeUrls?: Readonly<Record<string, readonly string[]>>;
  verifiedSourceUrlOverrides?: Readonly<Record<string, string>>;
  verifiedSourceTrustOverrides?: Readonly<Record<string, ReconciliationSourceTrustOverride>>;
}): ContentReconciliationPlan {
  const sourceMutations: ReconciliationMutation[] = [];
  const sourceState = new Map<string, ReconciliationSourceDocument>();
  const sourceEntries: Array<{ current: ReconciliationSourceDocument; next: ReconciliationSourceDocument }> = [];
  const hasScopeAuthority = input.officialScopeUrls !== undefined;

  for (const source of [...input.sources].sort(byId)) {
    const sourceUrlOverride = input.verifiedSourceUrlOverrides?.[source.id];
    const canonicalUrl = canonicalVerifiedSourceUrlOverride(source.sourceUrl, sourceUrlOverride);
    const homepageUrl = source.homepageUrl ? canonicalizeContentUrl(source.homepageUrl) : null;
    const sourceDiscoveredAt = toIsoString(source.discoveredAt) ?? toIsoString(source.createdAt);
    const officialScopeUrls = input.officialScopeUrls?.[`${source.scopeType ?? "university"}:${source.scopeId ?? ""}`] ?? [];
    const scopeAuthorityMissing = hasScopeAuthority && officialScopeUrls.length === 0;
    const matchesOfficialScope = !hasScopeAuthority
      || officialScopeUrls.some((officialUrl) => canonicalUrl && isOfficialContentUrl(canonicalUrl, officialUrl));
    const trustedSource = Boolean(
      canonicalUrl
      && officialDomainForUrl(canonicalUrl)
      && (!source.homepageUrl || (homepageUrl && isOfficialContentUrl(canonicalUrl, homepageUrl)))
      && matchesOfficialScope
    );
    const automatedTrustStatus: AnnouncementTrustStatus = scopeAuthorityMissing ? "quarantined" : trustedSource ? "trusted" : "rejected";
    const verifiedTrustOverride = input.verifiedSourceTrustOverrides?.[source.id];
    const preservedTrustStatus = verifiedTrustOverride?.trustStatus
      ?? (source.trustStatus === "rejected" || source.trustStatus === "quarantined" ? source.trustStatus : undefined);
    const trustStatus = preservedTrustStatus ?? automatedTrustStatus;
    const automatedReasons: AnnouncementTrustReason[] = scopeAuthorityMissing
      ? ["missing_source"]
      : trustedSource ? [] : [canonicalUrl ? "unofficial_source" : "unsafe_url"];
    const reasons = mergeReasons(
      verifiedTrustOverride?.trustReasonCodes,
      preservedTrustStatus && !verifiedTrustOverride ? source.trustReasonCodes : undefined,
      automatedReasons
    );
    const next: ReconciliationSourceDocument = {
      ...source,
      sourceName: normalizeDisplayText(source.sourceName, 160) || "Resmî akademik kaynak",
      ...(canonicalUrl ? { sourceUrl: canonicalUrl, canonicalUrl } : {}),
      ...(homepageUrl ? { homepageUrl } : {}),
      status: trustStatus === "trusted" ? source.status ?? "active" : "inactive",
      trustStatus,
      trustReasonCodes: reasons,
      ...(sourceDiscoveredAt ? { discoveredAt: sourceDiscoveredAt } : {})
    };
    if (!canonicalUrl) delete next.canonicalUrl;
    if (!sourceDiscoveredAt) delete next.discoveredAt;
    if (preservedTrustStatus && source.sourceUrl) next.sourceUrl = source.sourceUrl;
    if (trustStatus === "trusted") delete next.duplicateOfId;
    sourceEntries.push({ current: source, next });
  }

  const sourceDuplicateGroups = new Map<string, typeof sourceEntries>();
  for (const entry of sourceEntries) {
    if (entry.next.trustStatus !== "trusted" || !entry.next.canonicalUrl) continue;
    const key = `${entry.next.scopeType ?? "university"}|${entry.next.scopeId ?? "unknown"}|${canonicalContentKey(entry.next.canonicalUrl) ?? entry.next.canonicalUrl}`;
    sourceDuplicateGroups.set(key, [...(sourceDuplicateGroups.get(key) ?? []), entry]);
  }
  let sourceDuplicateCount = 0;
  for (const group of sourceDuplicateGroups.values()) {
    if (group.length < 2) continue;
    group.sort((left, right) => sourceSurvivorRank(left) - sourceSurvivorRank(right)
      || reconciliationSourceTimestamp(left.next) - reconciliationSourceTimestamp(right.next)
      || left.current.id.localeCompare(right.current.id, "en-US"));
    const survivor = group[0]!;
    for (const duplicate of group.slice(1)) {
      sourceDuplicateCount += 1;
      duplicate.next = {
        ...duplicate.next,
        ...(duplicate.current.sourceUrl ? { sourceUrl: duplicate.current.sourceUrl } : {}),
        status: "inactive",
        trustStatus: "rejected",
        trustReasonCodes: mergeReasons(duplicate.next.trustReasonCodes, ["duplicate_canonical_url"]),
        duplicateOfId: survivor.current.id
      };
    }
  }
  preserveSourceAliasesForUniqueKeyCollisions(sourceEntries);
  for (const entry of sourceEntries) {
    sourceState.set(entry.current.id, entry.next);
    const mutation = planMutation(entry.current, entry.next, sourceFields);
    if (mutation) sourceMutations.push(mutation);
  }

  const provisionalItems = [...input.items].sort(byId).map((item) => reconcileItem(item, sourceState.get(item.sourceId ?? "")));
  const duplicateGroups = new Map<string, typeof provisionalItems>();
  for (const entry of provisionalItems) {
    if (entry.next.trustStatus !== "trusted" || !entry.next.dedupeKey) continue;
    const scopeKey = `${entry.next.scopeType ?? "unknown"}|${entry.next.scopeId ?? "unknown"}|${entry.next.dedupeKey}`;
    duplicateGroups.set(scopeKey, [...(duplicateGroups.get(scopeKey) ?? []), entry]);
  }

  let duplicateCount = sourceDuplicateCount;
  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue;
    group.sort((left, right) => itemSurvivorRank(left) - itemSurvivorRank(right)
      || reconciliationTimestamp(left.next) - reconciliationTimestamp(right.next)
      || left.current.id.localeCompare(right.current.id, "en-US"));
    const survivor = group[0]!;
    for (const duplicate of group.slice(1)) {
      duplicateCount += 1;
      duplicate.next = {
        ...duplicate.next,
        ...(duplicate.current.link ? { link: duplicate.current.link } : {}),
        trustStatus: "rejected",
        trustReasonCodes: mergeReasons(duplicate.next.trustReasonCodes, ["duplicate_canonical_url"]),
        duplicateOfId: survivor.current.id
      };
    }
  }
  preserveItemAliasesForUniqueKeyCollisions(provisionalItems);

  const itemMutations = provisionalItems.flatMap(({ current, next }) => {
    const mutation = planMutation(current, next, itemFields);
    return mutation ? [mutation] : [];
  });
  const statuses = provisionalItems.map(({ next }) => next.trustStatus ?? "quarantined");
  const removedCrawlerPublicationTimes = provisionalItems.filter(({ current, next }) => Boolean(current.publishedAt) && !next.publishedAt && toIsoString(current.publishedAt) === toIsoString(current.fetchedAt)).length;

  return {
    sources: sourceMutations,
    items: itemMutations,
    summary: {
      sourceDocuments: input.sources.length,
      itemDocuments: input.items.length,
      sourceMutations: sourceMutations.length,
      itemMutations: itemMutations.length,
      trusted: statuses.filter((status) => status === "trusted").length,
      rejected: statuses.filter((status) => status === "rejected").length,
      quarantined: statuses.filter((status) => status === "quarantined").length,
      duplicates: duplicateCount,
      removedCrawlerPublicationTimes
    }
  };
}

function canonicalVerifiedSourceUrlOverride(sourceUrl: string | undefined, override: string | undefined): string | null {
  const current = sourceUrl ? canonicalizeContentUrl(sourceUrl) : null;
  if (override === undefined) return current;
  const canonicalOverride = canonicalizeContentUrl(override);
  if (!current
    || !canonicalOverride
    || new URL(canonicalOverride).protocol !== "https:"
    || !isOfficialContentUrl(canonicalOverride, current)) {
    throw new Error("CONTENT_RECONCILIATION_VERIFIED_SOURCE_URL_OVERRIDE_INVALID");
  }
  return canonicalOverride;
}

export function reconciliationPreimageHash(document: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(document)).digest("hex");
}

export function sourceReconciliationPreimageHash(document: Record<string, unknown>): string {
  return reconciliationPreimageHash(pickFields(document, SOURCE_RECONCILIATION_PREIMAGE_FIELDS));
}

export function itemReconciliationPreimageHash(document: Record<string, unknown>): string {
  return reconciliationPreimageHash(pickFields(document, ITEM_RECONCILIATION_PREIMAGE_FIELDS));
}

export function reconciliationPreimageFilter(
  document: Record<string, unknown>,
  documentType: "source" | "item"
): Record<string, unknown> {
  const fields = documentType === "source"
    ? SOURCE_RECONCILIATION_PREIMAGE_FIELDS
    : ITEM_RECONCILIATION_PREIMAGE_FIELDS;
  return Object.fromEntries(fields.map((field) => [
    field,
    document[field] === undefined
      ? { $exists: false }
      : { $exists: true, $eq: document[field] }
  ]));
}

export function toMongoReconciliationSet(
  values: Record<string, unknown>,
  documentType: "source" | "item"
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [
    field,
    documentType === "source" && field === "discoveredAt" && typeof value === "string"
      ? new Date(value)
      : value
  ]));
}

function reconcileItem(current: ReconciliationItemDocument, source: ReconciliationSourceDocument | undefined): { current: ReconciliationItemDocument; next: ReconciliationItemDocument } {
  const rawTitle = current.rawTitle ?? current.title ?? "";
  const fetchedAt = toIsoString(current.fetchedAt);
  const discoveredAt = toIsoString(current.discoveredAt) ?? toIsoString(current.createdAt) ?? fetchedAt;
  const parsedPublishedAt = toIsoString(current.publishedAt);
  const crawlerWasPublication = Boolean(parsedPublishedAt && fetchedAt && parsedPublishedAt === fetchedAt && current.publicationTimeSource !== "source");
  const publishedAt = current.publicationTimeSource === "source" ? parsedPublishedAt : undefined;
  const parsedSourceUpdatedAt = toIsoString(current.sourceUpdatedAt);
  const sourceUpdatedAt = current.sourceUpdateTimeSource === "source" ? parsedSourceUpdatedAt : undefined;
  const unverifiedSourceTime = Boolean(
    (current.publishedAt && current.publicationTimeSource !== "source" && !crawlerWasPublication)
    || (current.sourceUpdatedAt && current.sourceUpdateTimeSource !== "source")
  );
  const invalidTimestamp = Boolean(
    (current.publishedAt && !parsedPublishedAt)
    || (current.sourceUpdatedAt && !parsedSourceUpdatedAt)
    || (current.discoveredAt && !toIsoString(current.discoveredAt))
    || (current.fetchedAt && !fetchedAt)
  );
  const timestampReasons: AnnouncementTrustReason[] = [
    ...(invalidTimestamp ? ["invalid_timestamp" as const] : []),
    ...(crawlerWasPublication || current.trustReasonCodes?.includes("legacy_crawl_time_removed") ? ["legacy_crawl_time_removed" as const] : []),
    ...(unverifiedSourceTime || current.trustReasonCodes?.includes("unverified_source_time_removed") ? ["unverified_source_time_removed" as const] : [])
  ];

  if (!source || source.trustStatus !== "trusted" || !source.canonicalUrl) {
    const contentType = current.contentType ?? "announcement";
    const canonicalUrl = canonicalizeContentUrl(current.canonicalUrl ?? "") ?? canonicalizeContentUrl(current.link ?? "");
    const titleDecision = normalizeContentTitle(rawTitle, contentType, canonicalUrl ?? undefined);
    const title = titleDecision.title ?? normalizeDisplayText(current.title ?? rawTitle, 320);
    const preservedTrustStatus = current.trustStatus === "rejected" || current.trustStatus === "quarantined" ? current.trustStatus : undefined;
    const automatedTrustStatus: AnnouncementTrustStatus = titleDecision.rejected || !canonicalUrl ? "rejected" : "quarantined";
    const trustStatus = preservedTrustStatus ?? automatedTrustStatus;
    const summary = normalizeDisplayText(current.summary, 1_200);
    const next: ReconciliationItemDocument = {
      ...current,
      sourceName: normalizeDisplayText(current.sourceName, 160) || "Resmî akademik kaynak",
      contentType,
      rawTitle,
      ...(title ? { title } : {}),
      ...(canonicalUrl ? { link: canonicalUrl, canonicalUrl } : {}),
      ...(publishedAt ? { publishedAt, publicationTimeSource: "source" as const } : {}),
      ...(sourceUpdatedAt ? { sourceUpdatedAt, sourceUpdateTimeSource: "source" as const } : {}),
      ...(discoveredAt ? { discoveredAt } : {}),
      ...(fetchedAt ? { fetchedAt } : {}),
      ...(summary ? { summary } : {}),
      freshness: current.freshness === "stale" ? "stale" : "fresh",
      trustStatus,
      trustReasonCodes: mergeReasons(
        preservedTrustStatus ? current.trustReasonCodes : undefined,
        source?.trustReasonCodes,
        ["missing_source"],
        titleDecision.rejected ? ["navigation_or_chrome"] : [],
        canonicalUrl ? [] : ["unsafe_url"],
        timestampReasons
      )
    };
    if (!canonicalUrl) {
      delete next.link;
      delete next.canonicalUrl;
    }
    delete next.officialSourceUrl;
    if (!publishedAt) {
      delete next.publishedAt;
      delete next.publicationTimeSource;
    }
    if (!sourceUpdatedAt) {
      delete next.sourceUpdatedAt;
      delete next.sourceUpdateTimeSource;
    }
    if (!discoveredAt) delete next.discoveredAt;
    if (!fetchedAt) delete next.fetchedAt;
    if (!summary) delete next.summary;
    delete next.dedupeKey;
    return { current, next };
  }

  const decision = evaluateContentTrust({
    rawTitle,
    url: current.canonicalUrl ?? current.link ?? "",
    officialSourceUrl: source.canonicalUrl,
    contentType: current.contentType ?? "announcement"
  });
  const preservedTrustStatus = current.trustStatus === "rejected" || current.trustStatus === "quarantined" ? current.trustStatus : undefined;
  const trustStatus = preservedTrustStatus ?? decision.status;
  const reasons = mergeReasons(
    preservedTrustStatus ? current.trustReasonCodes : undefined,
    decision.reasonCodes,
    timestampReasons
  );
  const next: ReconciliationItemDocument = {
    ...current,
    sourceName: normalizeDisplayText(source.sourceName ?? current.sourceName, 160) || "Resmî akademik kaynak",
    contentType: source.contentType ?? current.contentType ?? "announcement",
    scopeType: source.scopeType ?? current.scopeType ?? "university",
    scopeId: source.scopeId ?? current.scopeId ?? "unknown",
    rawTitle: decision.rawTitle,
    ...(decision.title ? { title: decision.title } : {}),
    ...(decision.canonicalUrl ? { link: decision.canonicalUrl, canonicalUrl: decision.canonicalUrl } : {}),
    officialSourceUrl: source.canonicalUrl,
    ...(publishedAt ? { publishedAt } : {}),
    ...(publishedAt && current.publicationTimeSource === "source" ? { publicationTimeSource: "source" as const } : {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    ...(sourceUpdatedAt && current.sourceUpdateTimeSource === "source" ? { sourceUpdateTimeSource: "source" as const } : {}),
    ...(discoveredAt ? { discoveredAt } : {}),
    ...(fetchedAt ? { fetchedAt } : {}),
    summary: normalizeDisplayText(current.summary, 1_200),
    trustStatus,
    trustReasonCodes: reasons,
    ...(decision.dedupeKey ? { dedupeKey: decision.dedupeKey } : {}),
    freshness: current.freshness === "stale" ? "stale" : "fresh"
  };
  if (!publishedAt) delete next.publishedAt;
  if (!publishedAt) delete next.publicationTimeSource;
  if (!sourceUpdatedAt) delete next.sourceUpdatedAt;
  if (!sourceUpdatedAt) delete next.sourceUpdateTimeSource;
  if (!discoveredAt) delete next.discoveredAt;
  if (!fetchedAt) delete next.fetchedAt;
  if (!decision.dedupeKey) delete next.dedupeKey;
  if (!decision.canonicalUrl) delete next.canonicalUrl;
  if (preservedTrustStatus && current.link) next.link = current.link;
  if (trustStatus === "trusted" || !current.duplicateOfId) delete next.duplicateOfId;
  if (!next.summary) delete next.summary;
  return { current, next };
}

function planMutation<T extends { id: string }>(current: T, next: T, fields: readonly string[]): ReconciliationMutation | null {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const field of fields) {
    const currentValue = (current as Record<string, unknown>)[field];
    const nextValue = (next as Record<string, unknown>)[field];
    if (nextValue === undefined) {
      if (currentValue !== undefined) unset.push(field);
      continue;
    }
    if (stableStringify(normalizeComparable(currentValue)) !== stableStringify(normalizeComparable(nextValue))) set[field] = nextValue;
  }
  if (Object.keys(set).length === 0 && unset.length === 0) return null;
  return {
    id: current.id,
    preimageHash: reconciliationPreimageHash(pickFields(current as Record<string, unknown>, fields)),
    set,
    unset
  };
}

function reconciliationTimestamp(item: ReconciliationItemDocument): number {
  const value = toIsoString(item.discoveredAt) ?? toIsoString(item.createdAt) ?? toIsoString(item.fetchedAt);
  return value ? Date.parse(value) : Number.MAX_SAFE_INTEGER;
}

function reconciliationSourceTimestamp(source: ReconciliationSourceDocument): number {
  const value = toIsoString(source.discoveredAt) ?? toIsoString(source.createdAt);
  return value ? Date.parse(value) : Number.MAX_SAFE_INTEGER;
}

function sourceSurvivorRank(entry: { current: ReconciliationSourceDocument; next: ReconciliationSourceDocument }): number {
  return entry.current.sourceUrl === entry.next.canonicalUrl ? 0 : 1;
}

function itemSurvivorRank(entry: { current: ReconciliationItemDocument; next: ReconciliationItemDocument }): number {
  return entry.current.link === entry.next.canonicalUrl ? 0 : 1;
}

function preserveSourceAliasesForUniqueKeyCollisions(
  entries: Array<{ current: ReconciliationSourceDocument; next: ReconciliationSourceDocument }>
): void {
  const projectedUniqueKeys = new Map<string, typeof entries>();
  for (const entry of entries) {
    if (!entry.next.sourceUrl) continue;
    const key = stableStringify([
      entry.next.scopeType ?? "university",
      entry.next.scopeId ?? "unknown",
      entry.next.sourceUrl
    ]);
    projectedUniqueKeys.set(key, [...(projectedUniqueKeys.get(key) ?? []), entry]);
  }
  for (const group of projectedUniqueKeys.values()) {
    if (group.length < 2) continue;
    for (const entry of group) {
      if (entry.current.sourceUrl) entry.next = { ...entry.next, sourceUrl: entry.current.sourceUrl };
    }
  }
}

function preserveItemAliasesForUniqueKeyCollisions(
  entries: Array<{ current: ReconciliationItemDocument; next: ReconciliationItemDocument }>
): void {
  const projectedUniqueKeys = new Map<string, typeof entries>();
  for (const entry of entries) {
    if (!entry.next.sourceId || !entry.next.link) continue;
    const key = stableStringify([entry.next.sourceId, entry.next.link]);
    projectedUniqueKeys.set(key, [...(projectedUniqueKeys.get(key) ?? []), entry]);
  }
  for (const group of projectedUniqueKeys.values()) {
    if (group.length < 2) continue;
    for (const entry of group) {
      if (entry.current.link) entry.next = { ...entry.next, link: entry.current.link };
    }
  }
}

function mergeReasons(...groups: Array<readonly (string | AnnouncementTrustReason)[] | undefined>): AnnouncementTrustReason[] {
  const allowed = new Set<AnnouncementTrustReason>([
    "navigation_or_chrome",
    "unsafe_url",
    "unofficial_source",
    "missing_source",
    "invalid_timestamp",
    "duplicate_canonical_url",
    "legacy_crawl_time_removed",
    "unverified_source_time_removed"
  ]);
  return [...new Set(groups.flatMap((group) => group ?? []).filter((reason): reason is AnnouncementTrustReason => allowed.has(reason as AnnouncementTrustReason)))];
}

function pickFields(document: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.filter((field) => document[field] !== undefined).map((field) => [field, document[field]]));
}

function normalizeComparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeComparable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, normalizeComparable(nested)]));
  return value;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right, "en-US")).map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id, "en-US");
}

export const SOURCE_RECONCILIATION_PREIMAGE_FIELDS = [
  "scopeType",
  "scopeId",
  "contentType",
  "sourceName",
  "sourceUrl",
  "canonicalUrl",
  "homepageUrl",
  "status",
  "trustStatus",
  "trustReasonCodes",
  "duplicateOfId",
  "discoveredAt"
] as const;
export const ITEM_RECONCILIATION_PREIMAGE_FIELDS = [
  "sourceId",
  "sourceName",
  "contentType",
  "scopeType",
  "scopeId",
  "rawTitle",
  "title",
  "link",
  "canonicalUrl",
  "officialSourceUrl",
  "publishedAt",
  "publicationTimeSource",
  "sourceUpdatedAt",
  "sourceUpdateTimeSource",
  "discoveredAt",
  "fetchedAt",
  "summary",
  "freshness",
  "trustStatus",
  "trustReasonCodes",
  "dedupeKey",
  "duplicateOfId"
] as const;
const sourceFields = SOURCE_RECONCILIATION_PREIMAGE_FIELDS;
const itemFields = ITEM_RECONCILIATION_PREIMAGE_FIELDS;
