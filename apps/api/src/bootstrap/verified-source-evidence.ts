import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { isForbiddenIpAddress } from "../common/network/safe-outbound-request.js";

export const VERIFIED_SOURCE_EVIDENCE_SCHEMA_VERSION = 4;
export const VERIFIED_SOURCE_EVIDENCE_VERIFIER_VERSION = "authority-pinned-browser-and-raw-v9";
export const VERIFIED_SOURCE_EVIDENCE_BUNDLE_SCHEMA_VERSION = 4;
export const VERIFIED_SOURCE_EVIDENCE_MAX_STORED_BYTES = 25 * 1024 * 1024;
export const VERIFIED_SOURCE_EVIDENCE_MAX_DECOMPRESSED_BYTES = 25 * 1024 * 1024;
export const VERIFIED_SOURCE_EVIDENCE_BUNDLE_MAX_BYTES = 1024 * 1024 * 1024;
export const VERIFIED_SOURCE_EVIDENCE_BUNDLE_MAX_ENTRIES = 120_000;
export const VERIFIED_SOURCE_EVIDENCE_BUNDLE_MANIFEST_MAX_BYTES = 64 * 1024 * 1024;

export const VERIFIED_SOURCE_TYPES = [
  "academic_unit_page",
  "announcement",
  "news",
  "event",
  "academic_calendar",
  "course_schedule",
  "exam_schedule"
] as const;

export const VERIFIED_SOURCE_DISCOVERY_METHODS = [
  "canonical_registry",
  "academic_unit_registry",
  "navigation",
  "sitemap",
  "internal_search",
  "catalog_unit_homepage",
  "catalog_unit_navigation",
  "catalog_unit_sitemap"
] as const;

export type VerifiedSourceType = (typeof VERIFIED_SOURCE_TYPES)[number];
export type VerifiedSourceDiscoveryMethod = (typeof VERIFIED_SOURCE_DISCOVERY_METHODS)[number];
export type VerifiedSourcePublicationScope = "university" | "faculty_shared" | "department_specific" | "university_system";
export type VerifiedSourceUnitType = "university" | "faculty" | "department";

export interface StrictVerifiedSourceEvidence {
  status: "verified";
  schemaVersion: typeof VERIFIED_SOURCE_EVIDENCE_SCHEMA_VERSION;
  verifierVersion: typeof VERIFIED_SOURCE_EVIDENCE_VERIFIER_VERSION;
  runId: string;
  manifestHash: string;
  universityId: string;
  unitType: VerifiedSourceUnitType;
  scopeId: string;
  sourceType: VerifiedSourceType;
  sourceUrl: string;
  finalUrl: string;
  browserFinalUrl: string;
  rawFinalUrl: string;
  discoveryMethod: VerifiedSourceDiscoveryMethod;
  selector?: string;
  publicationScope: VerifiedSourcePublicationScope;
  httpStatus: number;
  contentType: string;
  officialDomain: true;
  semanticMatch: true;
  semanticReasons: string[];
  parserCompatible: true;
  parserItemCount: number;
  listingItemCount?: number;
  sampleItemUrls: string[];
  sampleDetails: Array<{
    url: string;
    finalUrl?: string;
    title?: string;
    status: "verified" | "rejected" | "blocked" | "request_failed";
    httpStatus?: number;
    reasonCodes: string[];
  }>;
  browserNetworkProofs: Array<{ hostname: string; addresses: string[] }>;
  verifiedAt: string;
  finalRevalidatedAt: string;
  sha256: string;
  evidencePath: string;
  parserInputSha256?: string;
  parserEvidencePath?: string;
}

export interface VerifiedSourceEvidenceBundleEntry {
  evidencePath: string;
  sha256: string;
  storedSha256: string;
  storedByteLength: number;
  canonicalByteLength: number;
}

export interface VerifiedSourceEvidenceBundleIndex {
  releaseCommit: string;
  entryCount: number;
  totalStoredBytes: number;
  has(evidence: Pick<StrictVerifiedSourceEvidence, "sourceType" | "evidencePath" | "sha256" | "parserEvidencePath" | "parserInputSha256" | "runId" | "manifestHash" | "schemaVersion" | "verifierVersion">): boolean;
}

export interface NormalizeStrictVerifiedSourceEvidenceOptions {
  expectedSourceType?: VerifiedSourceType;
  expectedFinalUrl?: string;
  expectedUniversityId?: string;
  expectedUnitType?: VerifiedSourceUnitType;
  expectedScopeId?: string;
}

interface VerifiedSourceEvidenceBundleManifest {
  schemaVersion: number;
  evidenceSchemaVersion: number;
  verifierVersion: string;
  releaseCommit: string;
  generatedAt: string;
  discovery: {
    runId: string | null;
    manifestHash: string | null;
    summarySha256: string | null;
    checkpointSha256: string | null;
    finalRevalidationStatus: "passed" | "not_applicable";
  };
  registries: Array<{
    fileName: "verified-university-sources.json" | "verified-academic-unit-sources.json";
    sha256: string;
    byteLength: number;
  }>;
  entryCount: number;
  totalStoredBytes: number;
  entries: VerifiedSourceEvidenceBundleEntry[];
}

let bundledEvidencePromise: Promise<VerifiedSourceEvidenceBundleIndex> | null = null;

export class VerifiedSourceEvidenceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "VerifiedSourceEvidenceError";
  }
}

export function normalizeStrictVerifiedSourceEvidence(
  input: unknown,
  options: NormalizeStrictVerifiedSourceEvidenceOptions = {}
): StrictVerifiedSourceEvidence {
  if (!isRecord(input)) fail("EVIDENCE_INVALID");
  if (input.status !== "verified") fail("EVIDENCE_STATUS_INVALID");
  if (input.schemaVersion !== VERIFIED_SOURCE_EVIDENCE_SCHEMA_VERSION) fail("EVIDENCE_SCHEMA_INVALID");
  if (input.verifierVersion !== VERIFIED_SOURCE_EVIDENCE_VERIFIER_VERSION) fail("EVIDENCE_VERIFIER_INVALID");

  const runId = boundedText(input.runId, 120, "EVIDENCE_RUN_ID_INVALID");
  const manifestHash = digest(input.manifestHash, "EVIDENCE_MANIFEST_HASH_INVALID");
  const universityId = boundedText(input.universityId, 240, "EVIDENCE_UNIVERSITY_ID_INVALID");
  const unitType = enumValue(input.unitType, ["university", "faculty", "department"] as const, "EVIDENCE_UNIT_TYPE_INVALID");
  const scopeId = boundedText(input.scopeId, 720, "EVIDENCE_SCOPE_ID_INVALID");
  if (unitType === "university" && scopeId !== universityId) fail("EVIDENCE_UNIVERSITY_SCOPE_MISMATCH");
  if (options.expectedUniversityId && universityId !== options.expectedUniversityId) fail("EVIDENCE_UNIVERSITY_ID_MISMATCH");
  if (options.expectedUnitType && unitType !== options.expectedUnitType) fail("EVIDENCE_UNIT_TYPE_MISMATCH");
  if (options.expectedScopeId && scopeId !== options.expectedScopeId) fail("EVIDENCE_SCOPE_ID_MISMATCH");
  const sourceType = enumValue(input.sourceType, VERIFIED_SOURCE_TYPES, "EVIDENCE_SOURCE_TYPE_INVALID");
  if (options.expectedSourceType && sourceType !== options.expectedSourceType) fail("EVIDENCE_SOURCE_TYPE_MISMATCH");
  const sourceUrl = httpsUrl(input.sourceUrl, "EVIDENCE_SOURCE_URL_INVALID");
  const finalUrl = httpsUrl(input.finalUrl, "EVIDENCE_FINAL_URL_INVALID");
  const browserFinalUrl = httpsUrl(input.browserFinalUrl, "EVIDENCE_BROWSER_FINAL_URL_INVALID");
  const rawFinalUrl = httpsUrl(input.rawFinalUrl, "EVIDENCE_RAW_FINAL_URL_INVALID");
  if (options.expectedFinalUrl && !sameUrl(finalUrl, options.expectedFinalUrl)) fail("EVIDENCE_FINAL_URL_MISMATCH");
  const discoveryMethod = enumValue(input.discoveryMethod, VERIFIED_SOURCE_DISCOVERY_METHODS, "EVIDENCE_DISCOVERY_METHOD_INVALID");
  const publicationScope = enumValue(
    input.publicationScope,
    ["university", "faculty_shared", "department_specific", "university_system"] as const,
    "EVIDENCE_PUBLICATION_SCOPE_INVALID"
  );
  const httpStatus = boundedInteger(input.httpStatus, 200, 299, "EVIDENCE_HTTP_STATUS_INVALID");
  const contentType = boundedText(input.contentType, 256, "EVIDENCE_CONTENT_TYPE_INVALID");
  if (input.officialDomain !== true) fail("EVIDENCE_OFFICIAL_DOMAIN_INVALID");
  if (input.semanticMatch !== true) fail("EVIDENCE_SEMANTIC_MATCH_INVALID");
  const semanticReasons = boundedTextArray(input.semanticReasons, 32, 300, "EVIDENCE_SEMANTIC_REASONS_INVALID");
  if (input.parserCompatible !== true) fail("EVIDENCE_PARSER_COMPATIBILITY_INVALID");
  const parserItemCount = boundedInteger(input.parserItemCount, 0, 100_000, "EVIDENCE_PARSER_ITEM_COUNT_INVALID");
  if (requiresParsedItems(sourceType) && parserItemCount < 1) fail("EVIDENCE_PARSER_EMPTY");
  const listingItemCount = input.listingItemCount === undefined
    ? undefined
    : boundedInteger(input.listingItemCount, 0, 100_000, "EVIDENCE_LISTING_ITEM_COUNT_INVALID");
  const sampleItemUrls = boundedHttpsUrlArray(input.sampleItemUrls, 10, "EVIDENCE_SAMPLE_URLS_INVALID");
  const sampleDetails = normalizeSampleDetails(input.sampleDetails);
  const browserNetworkProofs = normalizeBrowserNetworkProofs(input.browserNetworkProofs, browserFinalUrl);
  const verifiedAt = isoTimestamp(input.verifiedAt, "EVIDENCE_VERIFIED_AT_INVALID");
  const finalRevalidatedAt = isoTimestamp(input.finalRevalidatedAt, "EVIDENCE_FINAL_REVALIDATED_AT_INVALID");
  if (Date.parse(finalRevalidatedAt) < Date.parse(verifiedAt)) fail("EVIDENCE_FINAL_REVALIDATION_ORDER_INVALID");
  const sha256 = digest(input.sha256, "EVIDENCE_SHA256_INVALID");
  const evidencePath = normalizeEvidencePath(input.evidencePath, sha256);
  const parserEvidenceRequired = requiresParserEvidence(sourceType, evidencePath);
  if (parserEvidenceRequired
    && (!sameUrl(finalUrl, browserFinalUrl) || !sameUrl(finalUrl, rawFinalUrl))) fail("EVIDENCE_LISTING_FINAL_URL_MISMATCH");
  const hasParserInputSha256 = input.parserInputSha256 !== undefined;
  const hasParserEvidencePath = input.parserEvidencePath !== undefined;
  if (hasParserInputSha256 !== hasParserEvidencePath) fail("EVIDENCE_PARSER_REFERENCE_PAIR_INVALID");
  if (parserEvidenceRequired && !hasParserInputSha256) fail("EVIDENCE_PARSER_REFERENCE_REQUIRED");
  const parserInputSha256 = hasParserInputSha256
    ? digest(input.parserInputSha256, "EVIDENCE_PARSER_INPUT_SHA256_INVALID")
    : undefined;
  const parserEvidencePath = parserInputSha256
    ? normalizeEvidencePath(input.parserEvidencePath, parserInputSha256)
    : undefined;
  if (parserEvidencePath && !parserEvidencePath.startsWith("evidence/html/")) fail("EVIDENCE_PARSER_PATH_INVALID");
  const selector = input.selector === undefined ? undefined : boundedText(input.selector, 512, "EVIDENCE_SELECTOR_INVALID");

  return {
    status: "verified",
    schemaVersion: VERIFIED_SOURCE_EVIDENCE_SCHEMA_VERSION,
    verifierVersion: VERIFIED_SOURCE_EVIDENCE_VERIFIER_VERSION,
    runId,
    manifestHash,
    universityId,
    unitType,
    scopeId,
    sourceType,
    sourceUrl,
    finalUrl,
    browserFinalUrl,
    rawFinalUrl,
    discoveryMethod,
    ...(selector ? { selector } : {}),
    publicationScope,
    httpStatus,
    contentType,
    officialDomain: true,
    semanticMatch: true,
    semanticReasons,
    parserCompatible: true,
    parserItemCount,
    ...(listingItemCount !== undefined ? { listingItemCount } : {}),
    sampleItemUrls,
    sampleDetails,
    browserNetworkProofs,
    verifiedAt,
    finalRevalidatedAt,
    sha256,
    evidencePath,
    ...(parserInputSha256 ? { parserInputSha256 } : {}),
    ...(parserEvidencePath ? { parserEvidencePath } : {})
  };
}

export function normalizeEvidencePath(value: unknown, expectedSha256: string): string {
  const normalized = boundedText(value, 512, "EVIDENCE_PATH_INVALID").replace(/\\/gu, "/");
  if (normalized.startsWith("/") || /^[a-z]:/iu.test(normalized) || normalized.includes("\0")
    || normalized.split("/").some((segment) => segment === "." || segment === "..")) {
    fail("EVIDENCE_PATH_INVALID");
  }
  const match = normalized.match(/^evidence\/html\/([a-f\d]{64})\.html\.gz$/u)
    ?? normalized.match(/^evidence\/documents\/([a-f\d]{64})\.[a-z\d]{1,10}$/u);
  if (!match) fail("EVIDENCE_PATH_INVALID");
  if (match[1] !== expectedSha256) fail("EVIDENCE_PATH_HASH_MISMATCH");
  return normalized;
}

export function verifyEvidenceArtifactPayload(
  storedBytes: Uint8Array,
  evidencePath: string,
  expectedSha256: string
): { storedSha256: string; storedByteLength: number; canonicalByteLength: number } {
  normalizeEvidencePath(evidencePath, expectedSha256);
  if (storedBytes.byteLength > VERIFIED_SOURCE_EVIDENCE_MAX_STORED_BYTES) fail("EVIDENCE_STORED_SIZE_EXCEEDED");
  let canonicalBytes: Uint8Array = storedBytes;
  if (evidencePath.startsWith("evidence/html/")) {
    try {
      canonicalBytes = gunzipSync(storedBytes, { maxOutputLength: VERIFIED_SOURCE_EVIDENCE_MAX_DECOMPRESSED_BYTES });
    } catch {
      fail("EVIDENCE_GZIP_INVALID_OR_TOO_LARGE");
    }
    if (canonicalBytes.byteLength > VERIFIED_SOURCE_EVIDENCE_MAX_DECOMPRESSED_BYTES) fail("EVIDENCE_DECOMPRESSED_SIZE_EXCEEDED");
    try {
      canonicalBytes = Buffer.from(new TextDecoder("utf-8", { fatal: true }).decode(canonicalBytes), "utf8");
    } catch {
      fail("EVIDENCE_HTML_UTF8_INVALID");
    }
  }
  if (sha256Hex(canonicalBytes) !== expectedSha256) fail("EVIDENCE_HASH_MISMATCH");
  return {
    storedSha256: sha256Hex(storedBytes),
    storedByteLength: storedBytes.byteLength,
    canonicalByteLength: canonicalBytes.byteLength
  };
}

/**
 * Verifies the evidence bundle copied into the deployed API image. A missing or
 * malformed bundle returns an empty index, so callers can retain legacy URLs
 * for review while refusing to treat any of them as verified.
 */
export async function loadBundledVerifiedSourceEvidence(): Promise<VerifiedSourceEvidenceBundleIndex> {
  bundledEvidencePromise ??= readBundledVerifiedSourceEvidence().catch(() => emptyBundleIndex());
  return bundledEvidencePromise;
}

export async function assertBundledVerifiedSourceEvidence(): Promise<VerifiedSourceEvidenceBundleIndex> {
  return readBundledVerifiedSourceEvidence();
}

export function resetBundledVerifiedSourceEvidenceCacheForTests(): void {
  bundledEvidencePromise = null;
}

async function readBundledVerifiedSourceEvidence(): Promise<VerifiedSourceEvidenceBundleIndex> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  return verifyVerifiedSourceEvidenceBundleDirectory(moduleDirectory);
}

export async function verifyVerifiedSourceEvidenceBundleDirectory(
  moduleDirectory: string
): Promise<VerifiedSourceEvidenceBundleIndex> {
  const bundleRoot = resolve(moduleDirectory, "verified-source-evidence");
  const manifestPath = resolve(bundleRoot, "manifest.json");
  const manifestBytes = await readBoundedRegularFile(manifestPath, VERIFIED_SOURCE_EVIDENCE_BUNDLE_MANIFEST_MAX_BYTES);
  const manifest = normalizeBundleManifest(JSON.parse(manifestBytes.toString("utf8")) as unknown);
  const runtimeReleaseCommit = process.env.APP_RELEASE_COMMIT?.trim();
  if (runtimeReleaseCommit && manifest.releaseCommit !== runtimeReleaseCommit) fail("EVIDENCE_BUNDLE_RUNTIME_RELEASE_MISMATCH");

  for (const registry of manifest.registries) {
    const registryBytes = await readBoundedRegularFile(resolve(moduleDirectory, registry.fileName), 32 * 1024 * 1024);
    if (registryBytes.byteLength !== registry.byteLength || sha256Hex(registryBytes) !== registry.sha256) {
      fail("EVIDENCE_BUNDLE_REGISTRY_HASH_MISMATCH");
    }
  }

  const verifiedKeys = new Set<string>();
  await mapWithConcurrency(manifest.entries, 8, async (entry) => {
    const artifactPath = resolve(bundleRoot, "artifacts", entry.evidencePath);
    await assertStrictChildPath(resolve(bundleRoot, "artifacts"), artifactPath);
    const storedBytes = await readBoundedRegularFile(artifactPath, VERIFIED_SOURCE_EVIDENCE_MAX_STORED_BYTES);
    const verified = verifyEvidenceArtifactPayload(storedBytes, entry.evidencePath, entry.sha256);
    if (verified.storedSha256 !== entry.storedSha256
      || verified.storedByteLength !== entry.storedByteLength
      || verified.canonicalByteLength !== entry.canonicalByteLength) {
      fail("EVIDENCE_BUNDLE_ARTIFACT_ATTESTATION_MISMATCH");
    }
    verifiedKeys.add(evidenceKey(entry.evidencePath, entry.sha256));
  });

  return {
    releaseCommit: manifest.releaseCommit,
    entryCount: manifest.entryCount,
    totalStoredBytes: manifest.totalStoredBytes,
    has: (evidence) => manifest.discovery.finalRevalidationStatus === "passed"
      && evidence.schemaVersion === VERIFIED_SOURCE_EVIDENCE_SCHEMA_VERSION
      && evidence.verifierVersion === VERIFIED_SOURCE_EVIDENCE_VERIFIER_VERSION
      && evidence.runId === manifest.discovery.runId
      && evidence.manifestHash === manifest.discovery.manifestHash
      && verifiedKeys.has(evidenceKey(evidence.evidencePath, evidence.sha256))
      && hasVerifiedParserEvidence(evidence, verifiedKeys)
  };
}

function normalizeBundleManifest(input: unknown): VerifiedSourceEvidenceBundleManifest {
  if (!isRecord(input)
    || input.schemaVersion !== VERIFIED_SOURCE_EVIDENCE_BUNDLE_SCHEMA_VERSION
    || input.evidenceSchemaVersion !== VERIFIED_SOURCE_EVIDENCE_SCHEMA_VERSION
    || input.verifierVersion !== VERIFIED_SOURCE_EVIDENCE_VERIFIER_VERSION) fail("EVIDENCE_BUNDLE_SCHEMA_INVALID");
  const releaseCommit = boundedText(input.releaseCommit, 40, "EVIDENCE_BUNDLE_RELEASE_INVALID");
  if (!/^[a-f\d]{40}$/u.test(releaseCommit)) fail("EVIDENCE_BUNDLE_RELEASE_INVALID");
  const generatedAt = isoTimestamp(input.generatedAt, "EVIDENCE_BUNDLE_TIMESTAMP_INVALID");
  void generatedAt;
  if (!isRecord(input.discovery)) fail("EVIDENCE_BUNDLE_DISCOVERY_INVALID");
  const finalRevalidationStatus = input.discovery.finalRevalidationStatus;
  if (finalRevalidationStatus !== "passed" && finalRevalidationStatus !== "not_applicable") fail("EVIDENCE_BUNDLE_REVALIDATION_INVALID");
  const runId = nullableBoundedText(input.discovery.runId, 120, "EVIDENCE_BUNDLE_RUN_ID_INVALID");
  const manifestHash = nullableDigest(input.discovery.manifestHash, "EVIDENCE_BUNDLE_MANIFEST_HASH_INVALID");
  const summarySha256 = nullableDigest(input.discovery.summarySha256, "EVIDENCE_BUNDLE_SUMMARY_HASH_INVALID");
  const checkpointSha256 = nullableDigest(input.discovery.checkpointSha256, "EVIDENCE_BUNDLE_CHECKPOINT_HASH_INVALID");
  if (finalRevalidationStatus === "passed" && (!runId || !manifestHash || !summarySha256 || !checkpointSha256)) {
    fail("EVIDENCE_BUNDLE_REVALIDATION_PROVENANCE_MISSING");
  }
  if (finalRevalidationStatus === "not_applicable" && (runId || manifestHash || summarySha256 || checkpointSha256)) {
    fail("EVIDENCE_BUNDLE_REVALIDATION_PROVENANCE_UNEXPECTED");
  }
  if (!Array.isArray(input.registries) || input.registries.length !== 2) fail("EVIDENCE_BUNDLE_REGISTRIES_INVALID");
  const registryNames = new Set<string>();
  const registries = input.registries.map((raw) => {
    if (!isRecord(raw)) {
      fail("EVIDENCE_BUNDLE_REGISTRY_INVALID");
    }
    const fileName = raw.fileName;
    if (fileName !== "verified-university-sources.json" && fileName !== "verified-academic-unit-sources.json") {
      fail("EVIDENCE_BUNDLE_REGISTRY_INVALID");
    }
    const verifiedFileName = fileName as "verified-university-sources.json" | "verified-academic-unit-sources.json";
    if (registryNames.has(fileName)) fail("EVIDENCE_BUNDLE_REGISTRY_DUPLICATE");
    registryNames.add(fileName);
    return {
      fileName: verifiedFileName,
      sha256: digest(raw.sha256, "EVIDENCE_BUNDLE_REGISTRY_HASH_INVALID"),
      byteLength: boundedInteger(raw.byteLength, 1, 32 * 1024 * 1024, "EVIDENCE_BUNDLE_REGISTRY_SIZE_INVALID")
    };
  });
  const entryCount = boundedInteger(input.entryCount, 0, VERIFIED_SOURCE_EVIDENCE_BUNDLE_MAX_ENTRIES, "EVIDENCE_BUNDLE_ENTRY_COUNT_INVALID");
  const totalStoredBytes = boundedInteger(input.totalStoredBytes, 0, VERIFIED_SOURCE_EVIDENCE_BUNDLE_MAX_BYTES, "EVIDENCE_BUNDLE_TOTAL_SIZE_INVALID");
  if (!Array.isArray(input.entries) || input.entries.length !== entryCount) fail("EVIDENCE_BUNDLE_ENTRIES_INVALID");
  const seen = new Set<string>();
  let calculatedBytes = 0;
  let calculatedCanonicalBytes = 0;
  const entries = input.entries.map((raw) => {
    if (!isRecord(raw)) fail("EVIDENCE_BUNDLE_ENTRY_INVALID");
    const sha256 = digest(raw.sha256, "EVIDENCE_BUNDLE_ENTRY_HASH_INVALID");
    const evidencePath = normalizeEvidencePath(raw.evidencePath, sha256);
    const storedSha256 = digest(raw.storedSha256, "EVIDENCE_BUNDLE_STORED_HASH_INVALID");
    const storedByteLength = boundedInteger(raw.storedByteLength, 1, VERIFIED_SOURCE_EVIDENCE_MAX_STORED_BYTES, "EVIDENCE_BUNDLE_STORED_SIZE_INVALID");
    const canonicalByteLength = boundedInteger(raw.canonicalByteLength, 1, VERIFIED_SOURCE_EVIDENCE_MAX_DECOMPRESSED_BYTES, "EVIDENCE_BUNDLE_CANONICAL_SIZE_INVALID");
    const key = evidenceKey(evidencePath, sha256);
    if (seen.has(key)) fail("EVIDENCE_BUNDLE_ENTRY_DUPLICATE");
    seen.add(key);
    calculatedBytes += storedByteLength;
    calculatedCanonicalBytes += canonicalByteLength;
    return { evidencePath, sha256, storedSha256, storedByteLength, canonicalByteLength };
  });
  if (calculatedBytes !== totalStoredBytes || calculatedBytes > VERIFIED_SOURCE_EVIDENCE_BUNDLE_MAX_BYTES) {
    fail("EVIDENCE_BUNDLE_TOTAL_SIZE_MISMATCH");
  }
  assertVerifiedEvidenceBundleCanonicalByteTotal(calculatedCanonicalBytes);
  if (entryCount > 0 && finalRevalidationStatus !== "passed") fail("EVIDENCE_BUNDLE_REVALIDATION_REQUIRED");
  return {
    schemaVersion: VERIFIED_SOURCE_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    evidenceSchemaVersion: VERIFIED_SOURCE_EVIDENCE_SCHEMA_VERSION,
    verifierVersion: VERIFIED_SOURCE_EVIDENCE_VERIFIER_VERSION,
    releaseCommit,
    generatedAt,
    discovery: { runId, manifestHash, summarySha256, checkpointSha256, finalRevalidationStatus },
    registries,
    entryCount,
    totalStoredBytes,
    entries
  };
}

export function assertVerifiedEvidenceBundleCanonicalByteTotal(totalCanonicalBytes: number): void {
  if (!Number.isSafeInteger(totalCanonicalBytes)
    || totalCanonicalBytes < 0
    || totalCanonicalBytes > VERIFIED_SOURCE_EVIDENCE_BUNDLE_MAX_BYTES) {
    fail("EVIDENCE_BUNDLE_CANONICAL_TOTAL_SIZE_INVALID");
  }
}

function normalizeSampleDetails(value: unknown): StrictVerifiedSourceEvidence["sampleDetails"] {
  if (!Array.isArray(value) || value.length > 2) fail("EVIDENCE_SAMPLE_DETAILS_INVALID");
  return value.map((raw) => {
    if (!isRecord(raw)) fail("EVIDENCE_SAMPLE_DETAIL_INVALID");
    const status = enumValue(raw.status, ["verified", "rejected", "blocked", "request_failed"] as const, "EVIDENCE_SAMPLE_DETAIL_STATUS_INVALID");
    const url = httpsUrl(raw.url, "EVIDENCE_SAMPLE_DETAIL_URL_INVALID");
    const finalUrl = raw.finalUrl === undefined ? undefined : httpsUrl(raw.finalUrl, "EVIDENCE_SAMPLE_DETAIL_FINAL_URL_INVALID");
    const title = raw.title === undefined ? undefined : boundedText(raw.title, 500, "EVIDENCE_SAMPLE_DETAIL_TITLE_INVALID");
    const httpStatus = raw.httpStatus === undefined ? undefined : boundedInteger(raw.httpStatus, 100, 599, "EVIDENCE_SAMPLE_DETAIL_HTTP_STATUS_INVALID");
    if (status === "verified" && httpStatus !== undefined && (httpStatus < 200 || httpStatus >= 300)) {
      fail("EVIDENCE_SAMPLE_DETAIL_VERIFIED_HTTP_STATUS_INVALID");
    }
    const reasonCodes = boundedTextArray(raw.reasonCodes ?? [], 16, 200, "EVIDENCE_SAMPLE_DETAIL_REASONS_INVALID");
    return { url, ...(finalUrl ? { finalUrl } : {}), ...(title ? { title } : {}), status, ...(httpStatus !== undefined ? { httpStatus } : {}), reasonCodes };
  });
}

function normalizeBrowserNetworkProofs(value: unknown, browserFinalUrl: string): StrictVerifiedSourceEvidence["browserNetworkProofs"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) fail("EVIDENCE_NETWORK_PROOFS_INVALID");
  const proofs = value.map((raw) => {
    if (!isRecord(raw)) fail("EVIDENCE_NETWORK_PROOF_INVALID");
    const hostname = boundedText(raw.hostname, 253, "EVIDENCE_NETWORK_HOSTNAME_INVALID").toLocaleLowerCase("en-US").replace(/\.$/u, "");
    if (!isCanonicalHostname(hostname) || !Array.isArray(raw.addresses) || raw.addresses.length < 1 || raw.addresses.length > 32) {
      fail("EVIDENCE_NETWORK_PROOF_INVALID");
    }
    const addresses = raw.addresses.map((address) => boundedText(address, 64, "EVIDENCE_NETWORK_ADDRESS_INVALID"));
    if (new Set(addresses).size !== addresses.length || addresses.some(isForbiddenIpAddress)) fail("EVIDENCE_NETWORK_ADDRESS_INVALID");
    return { hostname, addresses };
  });
  const finalHostname = new URL(browserFinalUrl).hostname.replace(/^\[|\]$/gu, "").replace(/\.$/u, "").toLocaleLowerCase("en-US");
  if (!proofs.some((proof) => proof.hostname === finalHostname)) fail("EVIDENCE_FINAL_HOST_NETWORK_PROOF_MISSING");
  return proofs;
}

function requiresParsedItems(value: VerifiedSourceType): boolean {
  return value === "announcement" || value === "news" || value === "event"
    || value === "course_schedule" || value === "exam_schedule";
}

function requiresParserEvidence(value: VerifiedSourceType, evidencePath: string): boolean {
  return evidencePath.startsWith("evidence/html/") && requiresParsedItems(value);
}

function hasVerifiedParserEvidence(
  evidence: Pick<StrictVerifiedSourceEvidence, "sourceType" | "evidencePath" | "parserEvidencePath" | "parserInputSha256">,
  verifiedKeys: ReadonlySet<string>
): boolean {
  const hasParserPath = evidence.parserEvidencePath !== undefined;
  const hasParserHash = evidence.parserInputSha256 !== undefined;
  if (hasParserPath !== hasParserHash) return false;
  if (!hasParserPath) return !requiresParserEvidence(evidence.sourceType, evidence.evidencePath);
  return verifiedKeys.has(evidenceKey(evidence.parserEvidencePath!, evidence.parserInputSha256!));
}

function httpsUrl(value: unknown, code: string): string {
  const normalized = boundedText(value, 2_048, code);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) fail(code);
    return normalized;
  } catch (error) {
    if (error instanceof VerifiedSourceEvidenceError) throw error;
    fail(code);
  }
}

function sameUrl(left: string, right: string): boolean {
  try {
    const first = new URL(left);
    const second = new URL(right);
    first.hash = "";
    second.hash = "";
    return first.href === second.href;
  } catch {
    return false;
  }
}

function boundedHttpsUrlArray(value: unknown, maximumItems: number, code: string): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) fail(code);
  return value.map((item) => httpsUrl(item, code));
}

function boundedTextArray(value: unknown, maximumItems: number, maximumLength: number, code: string): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) fail(code);
  return value.map((item) => boundedText(item, maximumLength, code));
}

function boundedText(value: unknown, maximumLength: number, code: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maximumLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) fail(code);
  return normalized;
}

function nullableBoundedText(value: unknown, maximumLength: number, code: string): string | null {
  return value === null ? null : boundedText(value, maximumLength, code);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code);
  return value;
}

function digest(value: unknown, code: string): string {
  const normalized = boundedText(value, 64, code);
  if (!/^[a-f\d]{64}$/u.test(normalized)) fail(code);
  return normalized;
}

function nullableDigest(value: unknown, code: string): string | null {
  return value === null ? null : digest(value, code);
}

function isoTimestamp(value: unknown, code: string): string {
  const normalized = boundedText(value, 64, code);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) fail(code);
  return normalized;
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, code: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) fail(code);
  return value as T[number];
}

function isCanonicalHostname(hostname: string): boolean {
  return hostname.split(".").every((label) => /^(?!-)[a-z\d-]{1,63}(?<!-)$/u.test(label));
}

function evidenceKey(evidencePath: string, digestValue: string): string {
  return `${evidencePath}\0${digestValue}`;
}

function sha256Hex(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readBoundedRegularFile(path: string, maximumBytes: number): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) fail("EVIDENCE_BUNDLE_FILE_INVALID");
  const bytes = await readFile(path);
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) fail("EVIDENCE_BUNDLE_FILE_INVALID");
  return bytes;
}

async function assertStrictChildPath(parent: string, child: string): Promise<void> {
  const canonicalParent = await realpath(parent);
  const canonicalChild = await realpath(child);
  const fromParent = relative(canonicalParent, canonicalChild);
  if (!fromParent || fromParent.startsWith("..") || resolve(canonicalParent, fromParent) !== canonicalChild) fail("EVIDENCE_BUNDLE_PATH_ESCAPE");
}

async function mapWithConcurrency<T>(values: readonly T[], concurrency: number, operation: (value: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await operation(values[index]!);
    }
  }));
}

function emptyBundleIndex(): VerifiedSourceEvidenceBundleIndex {
  return { releaseCommit: "", entryCount: 0, totalStoredBytes: 0, has: () => false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: string): never {
  throw new VerifiedSourceEvidenceError(code);
}
