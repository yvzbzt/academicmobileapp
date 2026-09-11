import { canonicalizeContentUrl, officialDomainForUrl } from "./announcement-content-trust.js";
import {
  normalizeStrictVerifiedSourceEvidence,
  VerifiedSourceEvidenceError
} from "../../bootstrap/verified-source-evidence.js";
import type {
  AnnouncementSourceRecord,
  AnnouncementSourceVerificationSampleDetail,
  AnnouncementSourceVerificationEvidence,
  UpsertAnnouncementSourceInput
} from "./announcements.types.js";

const verificationSourceTypes = new Set<AnnouncementSourceVerificationEvidence["sourceType"]>([
  "announcement", "news", "event", "academic_calendar", "course_schedule", "exam_schedule"
]);
const parserProfiles = new Set<NonNullable<AnnouncementSourceVerificationEvidence["parserProfile"]>>(["auto", "html", "rss"]);

export function normalizeAnnouncementSourceOwnership(
  input: Pick<UpsertAnnouncementSourceInput, "scopeType" | "scopeId" | "ownerUniversityId" | "ownerFacultyId">
): Pick<AnnouncementSourceRecord, "ownerUniversityId" | "ownerFacultyId"> {
  const scopeId = boundedIdentifier(input.scopeId, "ANNOUNCEMENT_SOURCE_SCOPE_ID_INVALID");
  const ownerUniversityId = optionalIdentifier(input.ownerUniversityId, "ANNOUNCEMENT_SOURCE_OWNER_UNIVERSITY_INVALID");
  const ownerFacultyId = optionalIdentifier(input.ownerFacultyId, "ANNOUNCEMENT_SOURCE_OWNER_FACULTY_INVALID");
  if (input.scopeType === "university" && ownerUniversityId && ownerUniversityId !== scopeId) {
    throw new Error("ANNOUNCEMENT_SOURCE_OWNER_SCOPE_MISMATCH");
  }
  if (input.scopeType !== "department" && ownerFacultyId) {
    throw new Error("ANNOUNCEMENT_SOURCE_OWNER_FACULTY_SCOPE_MISMATCH");
  }
  if (ownerFacultyId && !ownerUniversityId) throw new Error("ANNOUNCEMENT_SOURCE_OWNER_UNIVERSITY_REQUIRED");
  return {
    ...(ownerUniversityId ? { ownerUniversityId } : {}),
    ...(ownerFacultyId ? { ownerFacultyId } : {})
  };
}

export function assertAnnouncementSourceOwnershipImmutable(
  existing: AnnouncementSourceRecord,
  next: Pick<UpsertAnnouncementSourceInput, "scopeType" | "scopeId" | "ownerUniversityId" | "ownerFacultyId">
): void {
  if (existing.scopeType !== next.scopeType || existing.scopeId !== next.scopeId) {
    throw new Error("ANNOUNCEMENT_SOURCE_SCOPE_IMMUTABLE");
  }
  const normalized = normalizeAnnouncementSourceOwnership(next);
  if (
    (existing.ownerUniversityId && normalized.ownerUniversityId && existing.ownerUniversityId !== normalized.ownerUniversityId)
    || (existing.ownerFacultyId && normalized.ownerFacultyId && existing.ownerFacultyId !== normalized.ownerFacultyId)
  ) {
    throw new Error("ANNOUNCEMENT_SOURCE_OWNER_IMMUTABLE");
  }
}

export function normalizeAnnouncementSourceVerificationEvidence(
  input: AnnouncementSourceVerificationEvidence | undefined
): AnnouncementSourceVerificationEvidence | undefined {
  if (input === undefined) return undefined;
  if (!verificationSourceTypes.has(input.sourceType)) throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_TYPE_INVALID");
  let strict;
  try {
    strict = normalizeStrictVerifiedSourceEvidence(input, { expectedSourceType: input.sourceType });
  } catch (error) {
    if (error instanceof VerifiedSourceEvidenceError && error.code.startsWith("EVIDENCE_PATH")) {
      throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_EVIDENCE_PATH_INVALID");
    }
    if (error instanceof VerifiedSourceEvidenceError && error.code.startsWith("EVIDENCE_SAMPLE_DETAIL")) {
      throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_SAMPLE_DETAILS_INVALID");
    }
    if (error instanceof VerifiedSourceEvidenceError && error.code === "EVIDENCE_FINAL_URL_MISMATCH") {
      throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_FINAL_URL_MISMATCH");
    }
    throw new Error(`ANNOUNCEMENT_SOURCE_VERIFICATION_EVIDENCE_INVALID:${error instanceof VerifiedSourceEvidenceError ? error.code : "UNKNOWN"}`);
  }
  if (input.parserProfile !== undefined && !parserProfiles.has(input.parserProfile)) {
    throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_PARSER_PROFILE_INVALID");
  }
  return {
    ...strict,
    sourceType: input.sourceType,
    ...(input.parserProfile ? { parserProfile: input.parserProfile } : {}),
  };
}

export function sameAnnouncementSourceVerificationEvidence(
  left: AnnouncementSourceVerificationEvidence,
  right: AnnouncementSourceVerificationEvidence
): boolean {
  try {
    return JSON.stringify(normalizeAnnouncementSourceVerificationEvidence(left))
      === JSON.stringify(normalizeAnnouncementSourceVerificationEvidence(right));
  } catch {
    return false;
  }
}

/**
 * Repository boundary check for evidence that is attached outside the
 * registry provisioning service. The crawler's requested URL may redirect,
 * so provenance keeps it verbatim; the revalidated final URL is what must
 * identify the persisted operational source.
 */
export function assertAnnouncementSourceVerificationEvidenceMatchesDefinition(
  source: Pick<AnnouncementSourceRecord, "sourceUrl" | "canonicalUrl" | "contentType" | "scopeType" | "scopeId" | "ownerUniversityId">,
  evidence: AnnouncementSourceVerificationEvidence
): void {
  if (evidence.sourceType !== (source.contentType ?? "announcement")) {
    throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_TYPE_MISMATCH");
  }
  const sourceUrl = canonicalizeContentUrl(source.canonicalUrl ?? source.sourceUrl);
  const finalUrl = canonicalizeContentUrl(evidence.finalUrl);
  if (!sourceUrl || !finalUrl || sourceUrl !== finalUrl) {
    throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_FINAL_URL_MISMATCH");
  }
  const ownerUniversityId = source.scopeType === "university" ? source.scopeId : source.ownerUniversityId;
  if (!ownerUniversityId
    || evidence.universityId !== ownerUniversityId
    || evidence.unitType !== source.scopeType
    || evidence.scopeId !== source.scopeId) {
    throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_SCOPE_MISMATCH");
  }
  const expectedPublicationScope = source.scopeType === "university"
    ? "university_system"
    : source.scopeType === "faculty" ? "faculty_shared" : "department_specific";
  if (evidence.publicationScope !== expectedPublicationScope) {
    throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_PUBLICATION_SCOPE_MISMATCH");
  }
}

function boundedIdentifier(value: string, code: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 240 || /[\u0000-\u001f\u007f]/u.test(normalized)) throw new Error(code);
  return normalized;
}

function optionalIdentifier(value: string | undefined, code: string): string | undefined {
  return value === undefined ? undefined : boundedIdentifier(value, code);
}

function boundedText(value: string, maximum: number, code: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) throw new Error(code);
  return normalized;
}

function boundedOfficialUrl(value: string, code: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 2_048) throw new Error(code);
  const canonical = canonicalizeContentUrl(normalized);
  if (!canonical || !officialDomainForUrl(canonical)) throw new Error(code);
  return normalized;
}

function boundedTextArray(value: string[], maximumItems: number, maximumLength: number, code: string): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error(code);
  return value.map((entry) => boundedText(entry, maximumLength, code));
}

function boundedUrlArray(value: string[], maximumItems: number, code: string): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error(code);
  return value.map((entry) => boundedOfficialUrl(entry, code));
}

function optionalBoundedCount(value: number | undefined, code: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 100_000) throw new Error(code);
  return value;
}

function optionalPositiveInteger(value: number | undefined, maximum: number, code: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value <= 0 || value > maximum) throw new Error(code);
  return value;
}

function normalizeSampleDetails(
  value: AnnouncementSourceVerificationSampleDetail[] | undefined
): AnnouncementSourceVerificationSampleDetail[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 2) throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_SAMPLE_DETAILS_INVALID");
  const statuses = new Set<AnnouncementSourceVerificationSampleDetail["status"]>(["verified", "rejected", "blocked", "request_failed"]);
  return value.map((detail) => {
    if (!detail || typeof detail !== "object" || !statuses.has(detail.status)) {
      throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_SAMPLE_DETAIL_INVALID");
    }
    const url = boundedOfficialUrl(detail.url, "ANNOUNCEMENT_SOURCE_VERIFICATION_SAMPLE_DETAIL_URL_INVALID");
    const finalUrl = detail.finalUrl === undefined
      ? undefined
      : boundedOfficialUrl(detail.finalUrl, "ANNOUNCEMENT_SOURCE_VERIFICATION_SAMPLE_DETAIL_FINAL_URL_INVALID");
    const title = detail.title === undefined
      ? undefined
      : boundedText(detail.title, 500, "ANNOUNCEMENT_SOURCE_VERIFICATION_SAMPLE_DETAIL_TITLE_INVALID");
    if (detail.httpStatus !== undefined && (!Number.isInteger(detail.httpStatus) || detail.httpStatus < 100 || detail.httpStatus > 599)) {
      throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_SAMPLE_DETAIL_HTTP_STATUS_INVALID");
    }
    const reasonCodes = detail.reasonCodes === undefined
      ? undefined
      : boundedTextArray(detail.reasonCodes, 16, 200, "ANNOUNCEMENT_SOURCE_VERIFICATION_SAMPLE_DETAIL_REASONS_INVALID");
    return {
      url,
      ...(finalUrl ? { finalUrl } : {}),
      ...(title ? { title } : {}),
      status: detail.status,
      ...(detail.httpStatus !== undefined ? { httpStatus: detail.httpStatus } : {}),
      ...(reasonCodes ? { reasonCodes } : {})
    };
  });
}

function isoTimestamp(value: string, code: string): string {
  if (typeof value !== "string" || value.length > 64) throw new Error(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(code);
  return value;
}

function safeEvidencePath(value: string): string {
  const normalized = boundedText(value.replace(/\\/gu, "/"), 512, "ANNOUNCEMENT_SOURCE_VERIFICATION_EVIDENCE_PATH_INVALID");
  if (normalized.startsWith("/") || /^[a-z]:/iu.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error("ANNOUNCEMENT_SOURCE_VERIFICATION_EVIDENCE_PATH_INVALID");
  }
  return normalized;
}
