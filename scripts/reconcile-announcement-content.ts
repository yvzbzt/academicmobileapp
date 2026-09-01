import mongoose from "mongoose";
import type { Collection, Document as MongoDocument } from "mongodb";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  listVerifiedAcademicUnitSources,
  listVerifiedUniversitySources,
  type VerifiedAcademicUnitSource,
  type VerifiedUniversitySource
} from "../apps/api/src/bootstrap/verified-source-registry.js";
import { isForbiddenIpAddress } from "../apps/api/src/common/network/safe-outbound-request.js";
import { knownOfficialUniversityUrls } from "../apps/api/src/modules/announcements/announcement-ingestion.service.js";
import {
  canonicalizeContentUrl,
  isOfficialContentUrl,
  officialDomainForUrl
} from "../apps/api/src/modules/announcements/announcement-content-trust.js";
import {
  BUILT_IN_OFFICIAL_SCOPE_URLS,
  databaseNameFromMongoUri,
  itemReconciliationPreimageHash,
  parseReconciliationCliOptions,
  planAnnouncementContentReconciliation,
  reconciliationPreimageFilter,
  sourceReconciliationPreimageHash,
  toMongoReconciliationSet,
  type ReconciliationItemDocument,
  type ReconciliationMutation,
  type ReconciliationSourceDocument,
  type ReconciliationSourceTrustOverride
} from "../apps/api/src/modules/announcements/announcement-content-reconciliation.js";

async function main(): Promise<void> {
  const options = parseReconciliationCliOptions(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) throw new Error("CONTENT_RECONCILIATION_MONGODB_URI_REQUIRED");
  const databaseName = databaseNameFromMongoUri(mongoUri);
  if (!databaseName) throw new Error("CONTENT_RECONCILIATION_DATABASE_NAME_REQUIRED");
  if ((options.apply || options.verifyPostApply) && options.confirmDatabase !== databaseName) {
    throw new Error("CONTENT_RECONCILIATION_DATABASE_CONFIRMATION_MISMATCH");
  }
  const verification = options.verificationReport
    ? await readVerifiedSourceApprovalReport(options.verificationReport, databaseName)
    : undefined;
  if (options.confirmVerificationSha256 && verification?.sha256 !== options.confirmVerificationSha256) {
    throw new Error("CONTENT_RECONCILIATION_VERIFICATION_HASH_MISMATCH");
  }

  const connection = await mongoose.createConnection(mongoUri, {
    autoIndex: false,
    serverSelectionTimeoutMS: Number(process.env.MONGODB_SELECTION_TIMEOUT_MS ?? 5_000)
  }).asPromise();

  try {
    const sourceCollection = connection.collection("announcement_sources");
    const itemCollection = connection.collection("announcement_items");
    const [sourceRows, itemRows, universityRows, facultyRows, departmentRows] = await Promise.all([
      sourceCollection.find({}).sort({ _id: 1 }).toArray(),
      itemCollection.find({}).sort({ _id: 1 }).toArray(),
      connection.collection("universities").find({}).toArray(),
      connection.collection("faculties").find({}).toArray(),
      connection.collection("departments").find({}).toArray()
    ]);
    const selected = verification
      ? options.verifyPostApply
        ? selectVerifiedPostApplyDocuments(sourceRows, itemRows, verification.report)
        : selectVerifiedSourceDocuments(sourceRows, itemRows, verification.report)
      : { sources: sourceRows, items: itemRows, approvedSourceIds: sourceRows.map((row) => String(row._id)) };
    const sourceTrustOverrides = verification
      ? verifiedSourceTrustOverrides(sourceRows, verification.report, options.verifyPostApply ? "post-apply" : "pre-apply")
      : undefined;
    const sourceIds = new Map(selected.sources.map((row) => [String(row._id), row._id]));
    const itemIds = new Map(selected.items.map((row) => [String(row._id), row._id]));
    const sourceUpdatedAtPreimages = new Map(selected.sources.map((row) => [String(row._id), row.updatedAt]));
    const itemUpdatedAtPreimages = new Map(selected.items.map((row) => [String(row._id), row.updatedAt]));
    const databaseOfficialScopeUrls = buildOfficialScopeUrls(universityRows, facultyRows, departmentRows);
    const checkedInOfficialScopeUrls = await buildCheckedInVerifiedScopeUrls();
    const independentlyKnownOfficialScopeUrls = mergeOfficialScopeUrlMaps(
      databaseOfficialScopeUrls,
      checkedInOfficialScopeUrls
    );
    const officialScopeUrls = verification
      ? mergeVerifiedOfficialScopeUrls(independentlyKnownOfficialScopeUrls, verification.report)
      : independentlyKnownOfficialScopeUrls;
    const fullPlan = planAnnouncementContentReconciliation({
      sources: sourceRows.map(toSourceDocument),
      items: itemRows.map(toItemDocument),
      officialScopeUrls,
      ...(verification ? {
        verifiedSourceUrlOverrides: verifiedSourceUrlOverrides(verification.report),
        verifiedSourceTrustOverrides: sourceTrustOverrides!
      } : {})
    });
    const plan = filterReconciliationPlanToApprovedDocuments(
      fullPlan,
      selected.approvedSourceIds,
      selected.items.map((row) => String(row._id))
    );

    const approvedTargetSummary = summarizeApprovedTargetOutcome(selected.sources, selected.items, plan);
    const selectionSummary = {
      ...fullPlan.summary,
      verificationReportSha256: verification?.sha256,
      manualReviewSha256: verification?.manualReviewSha256,
      totalSourceDocuments: sourceRows.length,
      totalItemDocuments: itemRows.length,
      approvedSourceDocuments: selected.sources.length,
      approvedItemDocuments: selected.items.length,
      approvedSourceMutations: plan.sources.length,
      approvedItemMutations: plan.items.length,
      approvedTargetSummary,
      fullContextSummary: fullPlan.summary
    };

    if (verification) {
      assertApprovedSourceOutcome(selected.sources.length, approvedTargetSummary);
      assertApprovedSourcePostconditions(selected.sources, plan.sources, verification.report);
    }

    if (options.verifyPostApply) {
      assertPostApplyFixedPoint(plan);
      console.log(JSON.stringify({ mode: "verify-post-apply", databaseName, ...selectionSummary }, null, 2));
      return;
    }

    if (!options.apply) {
      console.log(JSON.stringify({ mode: "dry-run", databaseName, ...selectionSummary }, null, 2));
      return;
    }

    const sourceResult = await applyMutations({
      collection: sourceCollection,
      ids: sourceIds,
      mutations: plan.sources,
      batchSize: options.batchSize,
      documentType: "source",
      updatedAtPreimages: sourceUpdatedAtPreimages,
      preimageHash: (row) => sourceReconciliationPreimageHash(toSourceDocument(row) as unknown as Record<string, unknown>)
    });
    const fenceResult = sourceResult.conflicts === 0 && verification
      ? await verifyApprovedSourceFences({
          collection: sourceCollection,
          selectedSources: selected.sources,
          records: trustedApprovalRecordsById(verification.report),
          mutations: plan.sources
        })
      : { conflicts: 0 };
    const itemResult = sourceResult.conflicts + fenceResult.conflicts === 0
      ? await applyMutations({
          collection: itemCollection,
          ids: itemIds,
          mutations: plan.items,
          batchSize: options.batchSize,
          documentType: "item",
          updatedAtPreimages: itemUpdatedAtPreimages,
          preimageHash: (row) => itemReconciliationPreimageHash(toItemDocument(row) as unknown as Record<string, unknown>)
        })
      : { applied: 0, conflicts: 0 };
    const skippedItemMutations = sourceResult.conflicts + fenceResult.conflicts > 0 ? plan.items.length : 0;

    console.log(JSON.stringify({
      mode: "apply",
      databaseName,
      ...selectionSummary,
      appliedSourceMutations: sourceResult.applied,
      appliedItemMutations: itemResult.applied,
      skippedItemMutations,
      sourceFenceConflicts: fenceResult.conflicts,
      conflicts: sourceResult.conflicts + fenceResult.conflicts + itemResult.conflicts
    }, null, 2));
    if (sourceResult.conflicts + fenceResult.conflicts + itemResult.conflicts > 0) process.exitCode = 2;
  } finally {
    await connection.close();
  }
}

export interface VerifiedSourceApprovalRecord {
  id: string;
  sourceUrl: string;
  canonicalUrl?: string | null;
  finalUrl: string;
  approvedSourceUrl: string;
  upgradeToHttps: boolean;
  contentType: string;
  scopeType: string;
  scopeId: string;
  verifiedAt: string;
  preimage: {
    sourceUrl: string;
    canonicalUrl: string | null;
    status: string | null;
    trustStatus: string | null;
    updatedAt: string | null;
  };
  officialDomainMatch: true;
  finalOfficialDomainMatch: true;
  verifiedRegistryMatch: true;
  registryAuthorityUrls: string[];
  domainAuthorityUrls: string[];
  authorityDomains: string[];
  authorityValidatedAt: string;
  http: {
    syntaxOk: true;
    sourceProtocol: "http:" | "https:";
    status: number;
    ok: true;
    error: null;
    finalHostname: string;
    redirects: Array<{ status: number; from: string; to: string }>;
    dns: { ok: true; addresses: string[] };
    contentTypeHeader: string;
  };
  robots: { checked: true; disallowed: false };
  semanticSignals: {
    mediaType: string;
    semanticScore: number;
    challenge: false;
    login: false;
  };
  duplicateRisk: {
    exactUrlSourceIds: string[];
    sameScopeAndTypeIds: string[];
    survivorId: string;
    finalCanonicalUrl: string;
    finalCanonicalSurvivorId: string | null;
  };
  validationAttempts: Array<{
    verifiedAt: string;
    status: number | null;
    error: string | null;
    finalUrl: string;
    reasonCodes: string[];
  }>;
  redirectSafety: {
    checkedHopCount: number;
    everyHopOfficialDomain: true;
    everyTargetHttps: true;
    firstHopMatchesCheckedSource: true;
    lastHopMatchesFinalUrl: true;
    publicDnsResolvedBeforeEveryHop: true;
    evidenceContract: string;
  };
  reasonCodes: string[];
  verdict: "trusted";
}

export interface VerifiedSourceApprovalReport {
  schemaVersion: 2;
  revision: 6;
  state: "frozen";
  frozenAt: string;
  generatedAt: string;
  databaseName: string;
  policy: { authority: string };
  summary: {
    sourceDocuments: number;
    verdicts: { trusted: number; rejected: number; quarantined: number };
    multiTrustedFinalCanonicalGroups: number;
  };
  validationContract: {
    schemaVersion: 2;
    databaseName: string;
    trustedRequires: string[];
    preimageFenceFields: string[];
    nonTrustedAction: string;
  };
  classificationGuarantees: {
    checkedRecordCount: number;
    trustedRecordCount: number;
    trustedApprovedHttpsCount: number;
    trustedHttpPreimageHttpsUpgradeCount: number;
    trustedDirectHttpsCount: number;
    trustedAllAssertionsPassed: true;
    rejectedRecordCount: number;
    quarantinedRecordCount: number;
    nonTrustedAllHaveReasons: true;
    recommendedListsAreExactPartition: true;
    multiTrustedFinalCanonicalGroups: 0;
    crossContentFinalGroupsChecked: number;
    expectedRev6DemotionsChecked: 5;
  };
  manualReview: {
    reviewedAt: string;
    detailsArtifact: string;
    detailsSha256: string;
  };
  recommended: {
    trustedSourceIds: string[];
    rejectedSourceIds: string[];
    quarantinedSourceIds: string[];
  };
  records: Array<Record<string, unknown>>;
}

export async function readVerifiedSourceApprovalReport(
  filePath: string,
  databaseName: string
): Promise<{ report: VerifiedSourceApprovalReport; sha256: string; manualReviewSha256: string }> {
  const bytes = await readFile(filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("CONTENT_RECONCILIATION_VERIFICATION_REPORT_INVALID");
  }
  const report = validateVerifiedSourceApprovalReport(parsed, databaseName);
  const manualReviewSha256 = await verifyLinkedManualReview(filePath, report);
  return { report, sha256, manualReviewSha256 };
}

async function verifyLinkedManualReview(filePath: string, report: VerifiedSourceApprovalReport): Promise<string> {
  const sidecarPath = resolve(dirname(filePath), "manual-review.json");
  const sidecarBytes = await readFile(sidecarPath).catch(() => {
    throw new Error("CONTENT_RECONCILIATION_MANUAL_REVIEW_MISSING");
  });
  const sha256 = createHash("sha256").update(sidecarBytes).digest("hex");
  if (sha256 !== report.manualReview.detailsSha256) {
    throw new Error("CONTENT_RECONCILIATION_MANUAL_REVIEW_HASH_MISMATCH");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(sidecarBytes.toString("utf8"));
  } catch {
    throw new Error("CONTENT_RECONCILIATION_MANUAL_REVIEW_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CONTENT_RECONCILIATION_MANUAL_REVIEW_INVALID");
  }
  const sidecar = parsed as Record<string, unknown>;
  const identity = sidecar.parentReportIdentity as Record<string, unknown> | undefined;
  if (sidecar.parentReport !== basename(filePath)
    || identity?.schemaVersion !== report.schemaVersion
    || identity?.revision !== report.revision
    || identity?.databaseName !== report.databaseName
    || identity?.generatedAt !== report.generatedAt
    || identity?.frozenAt !== report.frozenAt) {
    throw new Error("CONTENT_RECONCILIATION_MANUAL_REVIEW_PARENT_MISMATCH");
  }
  return sha256;
}

export function validateVerifiedSourceApprovalReport(
  parsed: unknown,
  databaseName: string
): VerifiedSourceApprovalReport {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CONTENT_RECONCILIATION_VERIFICATION_REPORT_INVALID");
  }
  const report = parsed as VerifiedSourceApprovalReport;
  if (report.databaseName !== databaseName) throw new Error("CONTENT_RECONCILIATION_VERIFICATION_DATABASE_MISMATCH");
  if (report.schemaVersion !== 2) throw new Error("CONTENT_RECONCILIATION_VERIFICATION_SCHEMA_UNSUPPORTED");
  if (report.revision !== 6 || report.state !== "frozen") {
    throw new Error("CONTENT_RECONCILIATION_VERIFICATION_REPORT_NOT_FROZEN");
  }
  if (!validRecentVerificationTime(report.generatedAt)
    || !validRecentVerificationTime(report.frozenAt)
    || !validRecentVerificationTime(report.manualReview?.reviewedAt)) {
    throw new Error("CONTENT_RECONCILIATION_VERIFICATION_REPORT_STALE");
  }
  if (!Array.isArray(report.records)
    || !report.policy
    || typeof report.policy.authority !== "string"
    || !report.summary
    || !report.summary.verdicts
    || report.validationContract?.schemaVersion !== 2
    || report.validationContract?.databaseName !== databaseName
    || !Array.isArray(report.validationContract?.trustedRequires)
    || !Array.isArray(report.validationContract?.preimageFenceFields)
    || !report.classificationGuarantees
    || report.classificationGuarantees.trustedAllAssertionsPassed !== true
    || report.classificationGuarantees.nonTrustedAllHaveReasons !== true
    || report.classificationGuarantees.recommendedListsAreExactPartition !== true
    || report.classificationGuarantees.multiTrustedFinalCanonicalGroups !== 0
    || !Number.isInteger(report.classificationGuarantees.crossContentFinalGroupsChecked)
    || report.classificationGuarantees.crossContentFinalGroupsChecked < 1
    || report.classificationGuarantees.expectedRev6DemotionsChecked !== 5
    || report.summary.multiTrustedFinalCanonicalGroups !== 0
    || report.manualReview?.detailsArtifact !== "manual-review.json"
    || !/^[a-f\d]{64}$/u.test(report.manualReview?.detailsSha256 ?? "")
    || !Array.isArray(report.recommended?.trustedSourceIds)
    || !Array.isArray(report.recommended?.rejectedSourceIds)
    || !Array.isArray(report.recommended?.quarantinedSourceIds)) {
    throw new Error("CONTENT_RECONCILIATION_VERIFICATION_REPORT_INVALID");
  }
  assertRecommendationPartition(report);
  for (const candidate of report.records) {
    if (candidate.verdict === "trusted") {
      assertTrustedApprovalEvidence(candidate as unknown as VerifiedSourceApprovalRecord);
    } else if (!Array.isArray(candidate.reasonCodes) || candidate.reasonCodes.length === 0) {
      throw new Error("CONTENT_RECONCILIATION_VERIFICATION_NON_TRUSTED_REASON_REQUIRED");
    }
  }
  return report;
}

function assertRecommendationPartition(report: VerifiedSourceApprovalReport): void {
  const verdicts = ["trusted", "rejected", "quarantined"] as const;
  const recommendedByVerdict = {
    trusted: report.recommended.trustedSourceIds,
    rejected: report.recommended.rejectedSourceIds,
    quarantined: report.recommended.quarantinedSourceIds
  };
  const recordIds = new Set<string>();
  const trustedFinalGroups = new Map<string, string[]>();
  const recordsByVerdict = new Map<typeof verdicts[number], string[]>(verdicts.map((verdict) => [verdict, []]));
  for (const candidate of report.records) {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("CONTENT_RECONCILIATION_VERIFICATION_REPORT_INVALID");
    }
    const id = typeof candidate.id === "string" ? candidate.id : "";
    const verdict = candidate.verdict;
    if (!id || recordIds.has(id) || !verdicts.includes(verdict as typeof verdicts[number])) {
      throw new Error("CONTENT_RECONCILIATION_VERIFICATION_REPORT_INVALID");
    }
    recordIds.add(id);
    recordsByVerdict.get(verdict as typeof verdicts[number])!.push(id);
    if (verdict === "trusted") {
      const scopeType = typeof candidate.scopeType === "string" ? candidate.scopeType : "";
      const scopeId = typeof candidate.scopeId === "string" ? candidate.scopeId : "";
      const finalUrl = typeof candidate.finalUrl === "string" ? canonicalizeContentUrl(candidate.finalUrl) : null;
      if (!scopeType || !scopeId || !finalUrl) {
        throw new Error("CONTENT_RECONCILIATION_VERIFICATION_REPORT_INVALID");
      }
      const groupKey = `${scopeType}|${scopeId}|${finalUrl}`;
      trustedFinalGroups.set(groupKey, [...(trustedFinalGroups.get(groupKey) ?? []), id]);
    }
  }
  if ([...trustedFinalGroups.values()].some((ids) => ids.length > 1)) {
    throw new Error("CONTENT_RECONCILIATION_VERIFICATION_TRUSTED_FINAL_COLLISION");
  }
  const recommendedIds = new Set<string>();
  for (const verdict of verdicts) {
    const actual = recordsByVerdict.get(verdict)!;
    const recommended = recommendedByVerdict[verdict];
    if (recommended.some((id) => typeof id !== "string" || !id || recommendedIds.has(id))
      || new Set(recommended).size !== recommended.length
      || recommended.length !== actual.length
      || recommended.some((id) => !actual.includes(id))) {
      throw new Error("CONTENT_RECONCILIATION_VERIFICATION_RECOMMENDATION_MISMATCH");
    }
    for (const id of recommended) recommendedIds.add(id);
  }
  if (report.summary.sourceDocuments !== report.records.length
    || report.summary.verdicts.trusted !== recordsByVerdict.get("trusted")!.length
    || report.summary.verdicts.rejected !== recordsByVerdict.get("rejected")!.length
    || report.summary.verdicts.quarantined !== recordsByVerdict.get("quarantined")!.length) {
    throw new Error("CONTENT_RECONCILIATION_VERIFICATION_SUMMARY_MISMATCH");
  }
  const guarantees = report.classificationGuarantees;
  const upgradeCount = report.records.filter((record) => record.verdict === "trusted" && record.upgradeToHttps === true).length;
  if (guarantees.checkedRecordCount !== report.records.length
    || guarantees.trustedRecordCount !== recordsByVerdict.get("trusted")!.length
    || guarantees.trustedApprovedHttpsCount !== recordsByVerdict.get("trusted")!.length
    || guarantees.trustedHttpPreimageHttpsUpgradeCount !== upgradeCount
    || guarantees.trustedDirectHttpsCount !== recordsByVerdict.get("trusted")!.length - upgradeCount
    || guarantees.rejectedRecordCount !== recordsByVerdict.get("rejected")!.length
    || guarantees.quarantinedRecordCount !== recordsByVerdict.get("quarantined")!.length) {
    throw new Error("CONTENT_RECONCILIATION_VERIFICATION_GUARANTEE_MISMATCH");
  }
}

export function selectVerifiedSourceDocuments(
  sourceRows: MongoDocument[],
  itemRows: MongoDocument[],
  report: VerifiedSourceApprovalReport
): { sources: MongoDocument[]; items: MongoDocument[]; approvedSourceIds: string[] } {
  const approvedSourceIds = report.recommended.trustedSourceIds;
  if (approvedSourceIds.length === 0 || new Set(approvedSourceIds).size !== approvedSourceIds.length) {
    throw new Error("CONTENT_RECONCILIATION_VERIFIED_SOURCE_IDS_INVALID");
  }
  const records = report.records.flatMap((candidate): VerifiedSourceApprovalRecord[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as unknown as VerifiedSourceApprovalRecord;
    if (record.verdict !== "trusted") return [];
    assertTrustedApprovalEvidence(record);
    return [record];
  });
  const trustedRecordsById = new Map(records.map((record) => [record.id, record]));
  if (trustedRecordsById.size !== records.length
    || trustedRecordsById.size !== approvedSourceIds.length
    || approvedSourceIds.some((id) => !trustedRecordsById.has(id))) {
    throw new Error("CONTENT_RECONCILIATION_VERIFICATION_RECOMMENDATION_MISMATCH");
  }

  const sourceRowsById = new Map(sourceRows.map((row) => [String(row._id), row]));
  const selectedSources = approvedSourceIds.map((id) => {
    const row = sourceRowsById.get(id);
    const record = trustedRecordsById.get(id);
    if (!row || !record) throw new Error("CONTENT_RECONCILIATION_VERIFIED_SOURCE_NOT_FOUND");
    assertVerifiedSourcePreimage(row, record);
    return row;
  });
  const selectedIds = new Set(approvedSourceIds);
  return {
    sources: selectedSources,
    items: itemRows.filter((row) => selectedIds.has(String(row.sourceId ?? ""))),
    approvedSourceIds: [...approvedSourceIds]
  };
}

export function selectVerifiedPostApplyDocuments(
  sourceRows: MongoDocument[],
  itemRows: MongoDocument[],
  report: VerifiedSourceApprovalReport
): { sources: MongoDocument[]; items: MongoDocument[]; approvedSourceIds: string[] } {
  const approvedSourceIds = report.recommended.trustedSourceIds;
  if (approvedSourceIds.length === 0 || new Set(approvedSourceIds).size !== approvedSourceIds.length) {
    throw new Error("CONTENT_RECONCILIATION_VERIFIED_SOURCE_IDS_INVALID");
  }
  const records = trustedApprovalRecordsById(report);
  if (records.size !== approvedSourceIds.length || approvedSourceIds.some((id) => !records.has(id))) {
    throw new Error("CONTENT_RECONCILIATION_VERIFICATION_RECOMMENDATION_MISMATCH");
  }
  const sourceRowsById = new Map(sourceRows.map((row) => [String(row._id), row]));
  const selectedSources = approvedSourceIds.map((id) => {
    const row = sourceRowsById.get(id);
    const record = records.get(id);
    if (!row || !record) throw new Error("CONTENT_RECONCILIATION_VERIFIED_SOURCE_NOT_FOUND");
    assertVerifiedSourcePostimage(row, record);
    return row;
  });
  const selectedIds = new Set(approvedSourceIds);
  return {
    sources: selectedSources,
    items: itemRows.filter((row) => selectedIds.has(String(row.sourceId ?? ""))),
    approvedSourceIds: [...approvedSourceIds]
  };
}

export function mergeVerifiedOfficialScopeUrls(
  base: Readonly<Record<string, readonly string[]>>,
  report: VerifiedSourceApprovalReport
): Record<string, string[]> {
  const merged = Object.fromEntries(Object.entries(base).map(([key, urls]) => [key, [...urls]]));
  for (const candidate of report.records) {
    if (!candidate || typeof candidate !== "object" || candidate.verdict !== "trusted") continue;
    const record = candidate as unknown as VerifiedSourceApprovalRecord;
    assertTrustedApprovalEvidence(record);
    const scopeKey = `${record.scopeType}:${record.scopeId}`;
    const independentlyKnownAuthorities = matchingIndependentAuthorityUrls(record, merged[scopeKey] ?? []);
    if (independentlyKnownAuthorities.length === 0) {
      throw new Error("CONTENT_RECONCILIATION_VERIFIED_AUTHORITY_NOT_IN_REGISTRY");
    }
    merged[scopeKey] = uniqueUrls([
      ...(merged[scopeKey] ?? []),
      ...matchingRegistryAuthorityUrls(record, independentlyKnownAuthorities)
    ]);
  }
  return merged;
}

function matchingIndependentAuthorityUrls(
  record: VerifiedSourceApprovalRecord,
  independentlyKnownAuthorities: readonly string[]
): string[] {
  const sourceUrl = canonicalizeContentUrl(record.sourceUrl);
  const finalUrl = canonicalizeContentUrl(record.finalUrl);
  if (!sourceUrl || !finalUrl) return [];
  return uniqueUrls(independentlyKnownAuthorities.flatMap((value) => {
    const authorityUrl = canonicalizeContentUrl(value);
    return authorityUrl
      && isOfficialContentUrl(sourceUrl, authorityUrl)
      && isOfficialContentUrl(finalUrl, authorityUrl)
      ? [authorityUrl]
      : [];
  }));
}

function matchingRegistryAuthorityUrls(
  record: VerifiedSourceApprovalRecord,
  independentlyKnownAuthorities: readonly string[]
): string[] {
  const sourceUrl = canonicalizeContentUrl(record.sourceUrl);
  const finalUrl = canonicalizeContentUrl(record.finalUrl);
  const authorityDomains = new Set(record.authorityDomains.map((domain) => domain.toLocaleLowerCase("en-US")));
  if (!sourceUrl || !finalUrl) return [];
  return uniqueUrls(record.registryAuthorityUrls.flatMap((value) => {
    const authorityUrl = canonicalizeContentUrl(value);
    const authorityDomain = authorityUrl ? officialDomainForUrl(authorityUrl) : null;
    return authorityUrl
      && authorityDomain
      && authorityDomains.has(authorityDomain)
      && isOfficialContentUrl(sourceUrl, authorityUrl)
      && isOfficialContentUrl(finalUrl, authorityUrl)
      && independentlyKnownAuthorities.some((knownAuthority) => isOfficialContentUrl(authorityUrl, knownAuthority))
      ? [authorityUrl]
      : [];
  }));
}

export function verifiedSourceUrlOverrides(report: VerifiedSourceApprovalReport): Record<string, string> {
  return Object.fromEntries(report.records.flatMap((candidate): Array<[string, string]> => {
    if (!candidate || typeof candidate !== "object" || candidate.verdict !== "trusted") return [];
    const record = candidate as unknown as VerifiedSourceApprovalRecord;
    assertTrustedApprovalEvidence(record);
    return [[record.id, record.approvedSourceUrl]];
  }));
}

export function verifiedSourceTrustOverrides(
  sourceRows: MongoDocument[],
  report: VerifiedSourceApprovalReport,
  mode: "pre-apply" | "post-apply" = "pre-apply"
): Record<string, ReconciliationSourceTrustOverride> {
  const recordsById = new Map<string, Record<string, unknown>>();
  for (const candidate of report.records) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.id !== "string" || recordsById.has(candidate.id)) {
      throw new Error("CONTENT_RECONCILIATION_VERIFICATION_REPORT_INVALID");
    }
    recordsById.set(candidate.id, candidate);
  }
  const rowIds = new Set(sourceRows.map((row) => String(row._id)));
  if (rowIds.size !== sourceRows.length
    || recordsById.size !== sourceRows.length
    || [...recordsById.keys()].some((id) => !rowIds.has(id))) {
    throw new Error("CONTENT_RECONCILIATION_VERIFIED_PLANNING_CONTEXT_MISMATCH");
  }

  const overrides: Record<string, ReconciliationSourceTrustOverride> = {};
  for (const row of sourceRows) {
    const id = String(row._id);
    const record = recordsById.get(id);
    if (!record) throw new Error("CONTENT_RECONCILIATION_VERIFIED_PLANNING_CONTEXT_MISMATCH");
    if (mode === "post-apply" && record.verdict === "trusted") {
      assertVerifiedSourcePostimage(row, record as unknown as VerifiedSourceApprovalRecord);
    } else {
      assertVerifiedPlanningContextPreimage(row, record);
    }
    if (record.verdict === "rejected" || record.verdict === "quarantined") {
      overrides[id] = {
        trustStatus: record.verdict,
        trustReasonCodes: planningTrustReasonCodes(record.verdict, record.reasonCodes)
      };
    }
  }
  return overrides;
}

function assertVerifiedSourcePostimage(row: MongoDocument, record: VerifiedSourceApprovalRecord): void {
  assertTrustedApprovalEvidence(record);
  if (record.id !== String(row._id)
    || row.sourceUrl !== record.approvedSourceUrl
    || row.canonicalUrl !== record.approvedSourceUrl
    || row.scopeType !== record.scopeType
    || row.scopeId !== record.scopeId
    || (row.contentType ?? "announcement") !== record.contentType
    || row.status !== "active"
    || row.trustStatus !== "trusted"
    || (typeof row.duplicateOfId === "string" && row.duplicateOfId)) {
    throw new Error("CONTENT_RECONCILIATION_VERIFIED_SOURCE_POSTIMAGE_MISMATCH");
  }
}

function assertVerifiedPlanningContextPreimage(row: MongoDocument, record: Record<string, unknown>): void {
  const preimage = record.preimage && typeof record.preimage === "object" && !Array.isArray(record.preimage)
    ? record.preimage as Record<string, unknown>
    : undefined;
  if (!preimage
    || record.id !== String(row._id)
    || record.sourceUrl !== row.sourceUrl
    || preimage.sourceUrl !== row.sourceUrl
    || record.scopeType !== row.scopeType
    || record.scopeId !== row.scopeId
    || record.contentType !== (row.contentType ?? "announcement")
    || nullableString(preimage.canonicalUrl) !== nullableString(row.canonicalUrl)
    || nullableString(preimage.status) !== nullableString(row.status)
    || nullableString(preimage.trustStatus) !== nullableString(row.trustStatus)
    || nullableDate(preimage.updatedAt) !== nullableDate(row.updatedAt)) {
    throw new Error("CONTENT_RECONCILIATION_VERIFIED_PLANNING_CONTEXT_MISMATCH");
  }
}

function planningTrustReasonCodes(
  verdict: "rejected" | "quarantined",
  rawReasonCodes: unknown
): ReconciliationSourceTrustOverride["trustReasonCodes"] {
  const normalized = Array.isArray(rawReasonCodes)
    ? rawReasonCodes.filter((reason): reason is string => typeof reason === "string").map((reason) => reason.toLocaleLowerCase("en-US"))
    : [];
  const reasons: ReconciliationSourceTrustOverride["trustReasonCodes"] = [];
  if (normalized.some((reason) => reason.includes("duplicate"))) reasons.push("duplicate_canonical_url");
  if (normalized.some((reason) => /(?:unsafe|syntax|protocol|private|dns|ip)/u.test(reason))) reasons.push("unsafe_url");
  if (normalized.some((reason) => /(?:official|authority|domain|redirect|registry)/u.test(reason))) reasons.push("unofficial_source");
  if (reasons.length === 0) reasons.push(verdict === "rejected" ? "unofficial_source" : "missing_source");
  return [...new Set(reasons)];
}

export function filterReconciliationPlanToApprovedDocuments(
  fullPlan: { sources: ReconciliationMutation[]; items: ReconciliationMutation[] },
  approvedSourceIds: readonly string[],
  approvedItemIds: readonly string[]
): { sources: ReconciliationMutation[]; items: ReconciliationMutation[] } {
  const sourceIds = new Set(approvedSourceIds);
  const itemIds = new Set(approvedItemIds);
  return {
    sources: fullPlan.sources.filter((mutation) => sourceIds.has(mutation.id)),
    items: fullPlan.items.filter((mutation) => itemIds.has(mutation.id))
  };
}

export function summarizeApprovedTargetOutcome(
  sources: MongoDocument[],
  items: MongoDocument[],
  plan: { sources: ReconciliationMutation[]; items: ReconciliationMutation[] }
): {
  sources: { trusted: number; rejected: number; quarantined: number; active: number; inactive: number };
  items: { trusted: number; rejected: number; quarantined: number };
  sourceDuplicates: number;
  itemDuplicates: number;
  duplicates: number;
} {
  const sourceMutations = new Map(plan.sources.map((mutation) => [mutation.id, mutation]));
  const itemMutations = new Map(plan.items.map((mutation) => [mutation.id, mutation]));
  const projectedSources = sources.map((row) => projectMutation(row, sourceMutations.get(String(row._id))));
  const projectedItems = items.map((row) => projectMutation(row, itemMutations.get(String(row._id))));
  const sourceDuplicates = projectedSources.filter((row) => typeof row.duplicateOfId === "string" && row.duplicateOfId).length;
  const itemDuplicates = projectedItems.filter((row) => typeof row.duplicateOfId === "string" && row.duplicateOfId).length;
  return {
    sources: {
      trusted: projectedSources.filter((row) => normalizedTrustStatus(row.trustStatus) === "trusted").length,
      rejected: projectedSources.filter((row) => normalizedTrustStatus(row.trustStatus) === "rejected").length,
      quarantined: projectedSources.filter((row) => normalizedTrustStatus(row.trustStatus) === "quarantined").length,
      active: projectedSources.filter((row) => row.status === "active").length,
      inactive: projectedSources.filter((row) => row.status !== "active").length
    },
    items: {
      trusted: projectedItems.filter((row) => normalizedTrustStatus(row.trustStatus) === "trusted").length,
      rejected: projectedItems.filter((row) => normalizedTrustStatus(row.trustStatus) === "rejected").length,
      quarantined: projectedItems.filter((row) => normalizedTrustStatus(row.trustStatus) === "quarantined").length
    },
    sourceDuplicates,
    itemDuplicates,
    duplicates: sourceDuplicates + itemDuplicates
  };
}

export function assertApprovedSourceOutcome(
  approvedSourceDocuments: number,
  summary: ReturnType<typeof summarizeApprovedTargetOutcome>
): void {
  if (summary.sources.trusted !== approvedSourceDocuments
    || summary.sources.rejected !== 0
    || summary.sources.quarantined !== 0
    || summary.sources.active !== approvedSourceDocuments
    || summary.sources.inactive !== 0
    || summary.sourceDuplicates !== 0) {
    throw new Error("CONTENT_RECONCILIATION_APPROVED_SOURCE_OUTCOME_INVALID");
  }
}

export function assertApprovedSourcePostconditions(
  approvedSources: MongoDocument[],
  sourceMutations: readonly ReconciliationMutation[],
  report: VerifiedSourceApprovalReport
): void {
  const records = trustedApprovalRecordsById(report);
  const mutationsById = new Map(sourceMutations.map((mutation) => [mutation.id, mutation]));
  if (approvedSources.length !== records.size) {
    throw new Error("CONTENT_RECONCILIATION_APPROVED_SOURCE_POSTCONDITION_INVALID");
  }
  for (const source of approvedSources) {
    const id = String(source._id);
    const record = records.get(id);
    if (!record) throw new Error("CONTENT_RECONCILIATION_APPROVED_SOURCE_POSTCONDITION_INVALID");
    const projected = projectMutation(source, mutationsById.get(id));
    if (projected.sourceUrl !== record.approvedSourceUrl
      || projected.canonicalUrl !== record.approvedSourceUrl
      || projected.scopeType !== record.scopeType
      || projected.scopeId !== record.scopeId
      || (projected.contentType ?? "announcement") !== record.contentType
      || projected.status !== "active"
      || projected.trustStatus !== "trusted"
      || (typeof projected.duplicateOfId === "string" && projected.duplicateOfId)) {
      throw new Error("CONTENT_RECONCILIATION_APPROVED_SOURCE_POSTCONDITION_INVALID");
    }
  }
}

export function assertPostApplyFixedPoint(plan: {
  sources: readonly ReconciliationMutation[];
  items: readonly ReconciliationMutation[];
}): void {
  if (plan.sources.length !== 0 || plan.items.length !== 0) {
    throw new Error("CONTENT_RECONCILIATION_POST_APPLY_NOT_AT_FIXED_POINT");
  }
}

function projectMutation(row: MongoDocument, mutation: ReconciliationMutation | undefined): MongoDocument {
  if (!mutation) return { ...row };
  const projected = { ...row } as MongoDocument;
  Object.assign(projected, mutation.set);
  for (const field of mutation.unset) delete projected[field];
  return projected;
}

function normalizedTrustStatus(value: unknown): "trusted" | "rejected" | "quarantined" {
  return value === "trusted" || value === "rejected" ? value : "quarantined";
}

export async function verifyApprovedSourceFences(input: {
  collection: Collection<MongoDocument>;
  selectedSources: MongoDocument[];
  records: Map<string, VerifiedSourceApprovalRecord>;
  mutations: ReconciliationMutation[];
}): Promise<{ conflicts: number }> {
  const mutationsById = new Map(input.mutations.map((mutation) => [mutation.id, mutation]));
  let conflicts = 0;
  for (const original of input.selectedSources) {
    const id = String(original._id);
    const current = await input.collection.findOne({ _id: original._id });
    const record = input.records.get(id);
    if (!current || !record) {
      conflicts += 1;
      continue;
    }
    const mutation = mutationsById.get(id);
    if (!mutation) {
      try {
        assertVerifiedSourcePreimage(current, record);
      } catch {
        conflicts += 1;
      }
      continue;
    }
    const expected = { ...original } as MongoDocument;
    Object.assign(expected, toMongoReconciliationSet(mutation.set, "source"));
    for (const field of mutation.unset) delete expected[field];
    if (sourceReconciliationPreimageHash(toSourceDocument(current) as unknown as Record<string, unknown>)
      !== sourceReconciliationPreimageHash(toSourceDocument(expected) as unknown as Record<string, unknown>)
      || current.scopeType !== original.scopeType
      || current.scopeId !== original.scopeId
      || (current.contentType ?? "announcement") !== (original.contentType ?? "announcement")) {
      conflicts += 1;
    }
  }
  return { conflicts };
}

function trustedApprovalRecordsById(report: VerifiedSourceApprovalReport): Map<string, VerifiedSourceApprovalRecord> {
  const records = report.records.flatMap((candidate): VerifiedSourceApprovalRecord[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as unknown as VerifiedSourceApprovalRecord;
    if (record.verdict !== "trusted") return [];
    assertTrustedApprovalEvidence(record);
    return [record];
  });
  return new Map(records.map((record) => [record.id, record]));
}

function assertTrustedApprovalEvidence(record: VerifiedSourceApprovalRecord): void {
  const sourceUrl = canonicalizeContentUrl(record.sourceUrl);
  const finalUrl = canonicalizeContentUrl(record.finalUrl);
  const sourceDomain = sourceUrl ? officialDomainForUrl(sourceUrl) : null;
  const finalDomain = finalUrl ? officialDomainForUrl(finalUrl) : null;
  const authorityDomains = Array.isArray(record.authorityDomains)
    ? new Set(record.authorityDomains.map((domain) => typeof domain === "string" ? domain.trim().toLocaleLowerCase("en-US") : ""))
    : new Set<string>();
  const registryAuthorityUrls = Array.isArray(record.registryAuthorityUrls) ? record.registryAuthorityUrls : [];
  const matchingRegistryAuthority = registryAuthorityUrls.some((value) => {
    const authorityUrl = typeof value === "string" ? canonicalizeContentUrl(value) : null;
    const authorityDomain = authorityUrl ? officialDomainForUrl(authorityUrl) : null;
    return Boolean(authorityUrl
      && authorityDomain
      && authorityDomains.has(authorityDomain)
      && sourceUrl
      && finalUrl
      && isOfficialContentUrl(sourceUrl, authorityUrl)
      && isOfficialContentUrl(finalUrl, authorityUrl));
  });
  const validDomainAuthorityUrls = Array.isArray(record.domainAuthorityUrls)
    && record.domainAuthorityUrls.length > 0
    && record.domainAuthorityUrls.every((value) => typeof value === "string" && Boolean(canonicalizeContentUrl(value)));
  const finalHostname = finalUrl ? new URL(finalUrl).hostname.toLocaleLowerCase("en-US") : null;
  const sourceProtocol = sourceUrl ? new URL(sourceUrl).protocol : null;
  const finalProtocol = finalUrl ? new URL(finalUrl).protocol : null;
  const approvedSourceUrl = typeof record.approvedSourceUrl === "string"
    ? canonicalizeContentUrl(record.approvedSourceUrl)
    : null;
  const contentTypeHeader = record.http?.contentTypeHeader?.toLocaleLowerCase("en-US") ?? "";
  const validMediaType = /^(?:text\/html|application\/xhtml\+xml|application\/(?:xml|json)|text\/xml)(?:;|$)/u.test(contentTypeHeader);
  const matchingAttempt = Array.isArray(record.validationAttempts) && record.validationAttempts.some((attempt) => (
    attempt
    && attempt.verifiedAt === record.verifiedAt
    && attempt.status === record.http?.status
    && attempt.error === null
    && canonicalizeContentUrl(attempt.finalUrl) === finalUrl
    && Array.isArray(attempt.reasonCodes)
    && attempt.reasonCodes.length === 0
  ));
  const validRedirects = validTrustedRedirectEvidence(record, sourceUrl, finalUrl);
  if (!record.id
    || record.verdict !== "trusted"
    || !["university", "faculty", "department"].includes(record.scopeType)
    || !record.scopeId
    || !["announcement", "news", "event"].includes(record.contentType)
    || record.officialDomainMatch !== true
    || record.finalOfficialDomainMatch !== true
    || record.verifiedRegistryMatch !== true
    || !sourceUrl
    || !finalUrl
    || !sourceDomain
    || !finalDomain
    || !matchingRegistryAuthority
    || !validDomainAuthorityUrls
    || authorityDomains.size === 0
    || !authorityDomains.has(sourceDomain)
    || !authorityDomains.has(finalDomain)
    || !validRecentVerificationTime(record.verifiedAt)
    || !validRecentVerificationTime(record.authorityValidatedAt)
    || record.http?.syntaxOk !== true
    || (record.http?.sourceProtocol !== "http:" && record.http?.sourceProtocol !== "https:")
    || record.http.sourceProtocol !== sourceProtocol
    || finalProtocol !== "https:"
    || approvedSourceUrl !== finalUrl
    || record.upgradeToHttps !== (sourceProtocol === "http:")
    || !validRedirects
    || record.http?.ok !== true
    || record.http?.error !== null
    || !Number.isInteger(record.http?.status)
    || record.http.status < 200
    || record.http.status >= 300
    || record.http?.dns?.ok !== true
    || !Array.isArray(record.http.dns.addresses)
    || record.http.dns.addresses.length === 0
    || record.http.dns.addresses.some((address) => (
      typeof address !== "string" || !address || isForbiddenIpAddress(address)
    ))
    || record.http?.finalHostname?.toLocaleLowerCase("en-US") !== finalHostname
    || !validMediaType
    || record.robots?.checked !== true
    || record.robots?.disallowed !== false
    || !record.semanticSignals
    || typeof record.semanticSignals.semanticScore !== "number"
    || record.semanticSignals.semanticScore < 5
    || record.semanticSignals.challenge !== false
    || record.semanticSignals.login !== false
    || !Array.isArray(record.reasonCodes)
    || record.reasonCodes.length !== 0
    || !record.duplicateRisk
    || record.duplicateRisk.survivorId !== record.id
    || record.duplicateRisk.finalCanonicalSurvivorId !== record.id
    || typeof record.duplicateRisk.finalCanonicalUrl !== "string"
    || canonicalizeContentUrl(record.duplicateRisk.finalCanonicalUrl) !== approvedSourceUrl
    || !Array.isArray(record.duplicateRisk.exactUrlSourceIds)
    || !record.duplicateRisk.exactUrlSourceIds.includes(record.id)
    || !record.redirectSafety
    || record.redirectSafety.checkedHopCount !== record.http.redirects.length
    || record.redirectSafety.everyHopOfficialDomain !== true
    || record.redirectSafety.everyTargetHttps !== true
    || record.redirectSafety.firstHopMatchesCheckedSource !== true
    || record.redirectSafety.lastHopMatchesFinalUrl !== true
    || record.redirectSafety.publicDnsResolvedBeforeEveryHop !== true
    || typeof record.redirectSafety.evidenceContract !== "string"
    || !record.redirectSafety.evidenceContract
    || !matchingAttempt) {
    throw new Error("CONTENT_RECONCILIATION_VERIFIED_AUTHORITY_EVIDENCE_INVALID");
  }
}

function validTrustedRedirectEvidence(
  record: VerifiedSourceApprovalRecord,
  sourceUrl: string | null,
  finalUrl: string | null
): boolean {
  if (!sourceUrl || !finalUrl || !Array.isArray(record.http?.redirects)) return false;
  let currentUrl = sourceUrl;
  for (const redirect of record.http.redirects) {
    const from = redirect && typeof redirect.from === "string" ? canonicalizeContentUrl(redirect.from) : null;
    const to = redirect && typeof redirect.to === "string" ? canonicalizeContentUrl(redirect.to) : null;
    if (!from
      || !to
      || from !== currentUrl
      || !Number.isInteger(redirect.status)
      || redirect.status < 300
      || redirect.status >= 400
      || new URL(to).protocol !== "https:"
      || !isOfficialContentUrl(to, sourceUrl)) return false;
    currentUrl = to;
  }
  return currentUrl === finalUrl;
}

function assertVerifiedSourcePreimage(row: MongoDocument, record: VerifiedSourceApprovalRecord): void {
  assertTrustedApprovalEvidence(record);
  const sourceUrl = canonicalizeContentUrl(record.sourceUrl);
  const finalUrl = canonicalizeContentUrl(record.finalUrl);
  if (!record.id
    || record.officialDomainMatch !== true
    || record.finalOfficialDomainMatch !== true
    || !validRecentVerificationTime(record.verifiedAt)
    || typeof record.sourceUrl !== "string"
    || typeof record.finalUrl !== "string"
    || !sourceUrl
    || !finalUrl
    || !isOfficialContentUrl(finalUrl, sourceUrl)
    || !record.preimage
    || record.preimage.sourceUrl !== row.sourceUrl
    || record.sourceUrl !== row.sourceUrl
    || record.scopeType !== row.scopeType
    || record.scopeId !== row.scopeId
    || record.contentType !== (row.contentType ?? "announcement")
    || nullableString(record.preimage.canonicalUrl) !== nullableString(row.canonicalUrl)
    || nullableString(record.preimage.status) !== nullableString(row.status)
    || nullableString(record.preimage.trustStatus) !== nullableString(row.trustStatus)
    || nullableDate(record.preimage.updatedAt) !== nullableDate(row.updatedAt)) {
    throw new Error("CONTENT_RECONCILIATION_VERIFIED_SOURCE_PREIMAGE_MISMATCH");
  }
}

function validRecentVerificationTime(value: unknown, now = Date.now()): boolean {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now + 5 * 60_000 && timestamp >= now - 24 * 60 * 60_000;
}

function nullableDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const timestamp = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "INVALID";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function applyMutations(input: {
  collection: Collection<MongoDocument>;
  ids: Map<string, MongoDocument["_id"]>;
  mutations: ReconciliationMutation[];
  batchSize: number;
  documentType: "source" | "item";
  updatedAtPreimages: Map<string, unknown>;
  preimageHash: (document: MongoDocument) => string;
}): Promise<{ applied: number; conflicts: number }> {
  let applied = 0;
  let conflicts = 0;
  for (let offset = 0; offset < input.mutations.length; offset += input.batchSize) {
    const batch = input.mutations.slice(offset, offset + input.batchSize);
    for (const mutation of batch) {
      const databaseId = input.ids.get(mutation.id);
      if (databaseId === undefined) {
        conflicts += 1;
        continue;
      }
      const current = await input.collection.findOne({ _id: databaseId });
      const expectedUpdatedAt = input.updatedAtPreimages.get(mutation.id);
      if (!current
        || input.preimageHash(current) !== mutation.preimageHash
        || nullableDate(current.updatedAt) !== nullableDate(expectedUpdatedAt)) {
        conflicts += 1;
        continue;
      }
      const updateFilter: Record<string, unknown> = {
        _id: databaseId,
        ...reconciliationPreimageFilter(current, input.documentType)
      };
      updateFilter.updatedAt = expectedUpdatedAt === undefined ? { $exists: false } : expectedUpdatedAt;
      const set = toMongoReconciliationSet(mutation.set, input.documentType);
      set.updatedAt = new Date();
      const update: Record<string, unknown> = { $set: set };
      if (mutation.unset.length > 0) update.$unset = Object.fromEntries(mutation.unset.map((field) => [field, ""]));
      const result = await input.collection.updateOne(updateFilter, update);
      if (result.modifiedCount === 1) applied += 1;
      else conflicts += 1;
    }
  }
  return { applied, conflicts };
}

function toSourceDocument(row: MongoDocument): ReconciliationSourceDocument {
  return { ...(row as unknown as ReconciliationSourceDocument), id: String(row._id) };
}

function toItemDocument(row: MongoDocument): ReconciliationItemDocument {
  return { ...(row as unknown as ReconciliationItemDocument), id: String(row._id) };
}

export function buildOfficialScopeUrls(
  universities: MongoDocument[],
  faculties: MongoDocument[],
  departments: MongoDocument[]
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const universityEntries = universities.map((university, index) => {
    const aliases = scopeAliases(university);
    const emailDomainUrls = Array.isArray(university.emailDomains)
      ? university.emailDomains.flatMap((domain: unknown) => typeof domain === "string" ? [`https://${domain}`] : [])
      : [];
    const urls = uniqueUrls([
      ...readUrls(university, ["websiteUrl", "announcementUrl", "academicCalendarUrl"]),
      ...emailDomainUrls,
      ...aliases.flatMap((alias) => knownOfficialUniversityUrls(alias))
    ]);
    return { owner: scopeOwner(university, index), aliases, urls };
  });
  const universityUrls = buildUnambiguousAliasUrlMap(universityEntries);
  for (const [alias, urls] of universityUrls) result[`university:${alias}`] = urls;
  for (const [scopeKey, urls] of Object.entries(BUILT_IN_OFFICIAL_SCOPE_URLS)) {
    result[scopeKey] = [...urls];
    const [scopeType, ...idParts] = scopeKey.split(":");
    if (scopeType === "university") universityUrls.set(idParts.join(":"), [...urls]);
  }

  const facultyEntries = faculties.map((faculty, index) => {
    const aliases = scopeAliases(faculty);
    const urls = uniqueUrls([
      ...readUrls(faculty, ["websiteUrl", "announcementUrl"]),
      ...inheritedUrls(universityUrls, referenceAliases(faculty, ["universityId"]))
    ]);
    return { owner: scopeOwner(faculty, index), aliases, urls };
  });
  const facultyUrls = buildUnambiguousAliasUrlMap(facultyEntries);
  for (const [alias, urls] of facultyUrls) result[`faculty:${alias}`] = urls;

  const departmentEntries = departments.map((department, index) => ({
    owner: scopeOwner(department, index),
    aliases: scopeAliases(department),
    urls: uniqueUrls([
      ...readUrls(department, ["websiteUrl", "announcementUrl", "courseScheduleUrl", "examScheduleUrl"]),
      ...inheritedUrls(facultyUrls, referenceAliases(department, ["facultyId"])),
      ...inheritedUrls(universityUrls, referenceAliases(department, ["universityId"]))
    ])
  }));
  const departmentUrls = buildUnambiguousAliasUrlMap(departmentEntries);
  for (const [alias, urls] of departmentUrls) result[`department:${alias}`] = urls;
  return result;
}

export async function buildCheckedInVerifiedScopeUrls(): Promise<Record<string, string[]>> {
  const [universities, academicUnits] = await Promise.all([
    listVerifiedUniversitySources(),
    listVerifiedAcademicUnitSources()
  ]);
  return buildVerifiedRegistryScopeUrls(universities, academicUnits);
}

export function buildVerifiedRegistryScopeUrls(
  universities: readonly VerifiedUniversitySource[],
  academicUnits: readonly VerifiedAcademicUnitSource[]
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const universityUrls = new Map<string, string[]>();
  for (const university of universities) {
    const urls = uniqueUrls([
      ...readVerifiedRegistryUrls(university),
      ...knownOfficialUniversityUrls(university.universityId)
    ]);
    universityUrls.set(university.universityId, urls);
    result[`university:${university.universityId}`] = urls;
  }

  const facultyUrls = new Map<string, string[]>();
  for (const unit of academicUnits.filter((entry) => entry.scopeType === "faculty" && entry.facultyId)) {
    const urls = uniqueUrls([
      ...readVerifiedRegistryUrls(unit),
      ...(universityUrls.get(unit.universityId) ?? [])
    ]);
    facultyUrls.set(unit.facultyId!, urls);
    result[`faculty:${unit.facultyId}`] = urls;
  }

  for (const unit of academicUnits.filter((entry) => entry.scopeType === "department" && entry.departmentId)) {
    result[`department:${unit.departmentId}`] = uniqueUrls([
      ...readVerifiedRegistryUrls(unit),
      ...(unit.facultyId ? facultyUrls.get(unit.facultyId) ?? [] : []),
      ...(universityUrls.get(unit.universityId) ?? [])
    ]);
  }
  return result;
}

export function mergeOfficialScopeUrlMaps(
  ...maps: ReadonlyArray<Readonly<Record<string, readonly string[]>>>
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const map of maps) {
    for (const [scopeKey, urls] of Object.entries(map)) {
      merged[scopeKey] = uniqueUrls([...(merged[scopeKey] ?? []), ...urls]);
    }
  }
  return merged;
}

function readVerifiedRegistryUrls(source: VerifiedUniversitySource | VerifiedAcademicUnitSource): string[] {
  return uniqueUrls([
    source.announcementUrl,
    source.newsUrl,
    source.eventUrl,
    ...(isVerifiedUniversitySource(source)
      ? [source.calendarUrl, source.summerSchoolUrl]
      : [source.websiteUrl, source.courseScheduleUrl, source.examScheduleUrl])
  ].flatMap((value) => typeof value === "string" ? [value] : []));
}

function isVerifiedUniversitySource(
  source: VerifiedUniversitySource | VerifiedAcademicUnitSource
): source is VerifiedUniversitySource {
  return !("scopeType" in source);
}

interface AliasUrlEntry {
  owner: string;
  aliases: string[];
  urls: string[];
}

function buildUnambiguousAliasUrlMap(entries: AliasUrlEntry[]): Map<string, string[]> {
  const claims = new Map<string, { owner: string; urls: string[] }>();
  const collisions = new Set<string>();
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      if (collisions.has(alias)) continue;
      const existing = claims.get(alias);
      if (existing && existing.owner !== entry.owner) {
        claims.delete(alias);
        collisions.add(alias);
        continue;
      }
      claims.set(alias, { owner: entry.owner, urls: entry.urls });
    }
  }
  return new Map([...claims].map(([alias, claim]) => [alias, claim.urls]));
}

function scopeAliases(document: MongoDocument): string[] {
  return referenceAliases(document, ["_id", "id", "slug"]);
}

function referenceAliases(document: MongoDocument, fields: string[]): string[] {
  return uniqueUrls(fields.flatMap((field) => {
    const value = document[field];
    if (typeof value === "string" || typeof value === "number") return [String(value)];
    if (value && typeof value === "object" && "toHexString" in value
      && typeof (value as { toHexString?: unknown }).toHexString === "function") {
      return [(value as { toHexString(): string }).toHexString()];
    }
    return [];
  }));
}

function scopeOwner(document: MongoDocument, index: number): string {
  return referenceAliases(document, ["_id"])[0] ?? `missing-id:${index}`;
}

function inheritedUrls(urlsByAlias: Map<string, string[]>, aliases: string[]): string[] {
  return uniqueUrls(aliases.flatMap((alias) => urlsByAlias.get(alias) ?? []));
}

function readUrls(document: MongoDocument, fields: string[]): string[] {
  return uniqueUrls(fields.flatMap((field) => typeof document[field] === "string" ? [document[field] as string] : []));
}

function uniqueUrls(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

if (isDirectExecution()) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "CONTENT_RECONCILIATION_FAILED");
    process.exitCode = 1;
  });
}

function isDirectExecution(): boolean {
  const entryPoint = process.argv[1];
  return Boolean(entryPoint && import.meta.url === pathToFileURL(entryPoint).href);
}
