import type { VerifiedRegistrySourceEvidence } from "../../bootstrap/verified-source-registry.js";

export type AcademicUnitScheduleType = "course_schedule" | "exam_schedule";
export type AcademicUnitScheduleFormat = "pdf" | "xlsx" | "html" | "image" | "unsupported";
export type AcademicUnitScheduleLifecycle =
  | "ready"
  | "processing"
  | "review_required"
  | "quarantined"
  | "materializing"
  | "staged"
  | "published"
  | "rejected"
  | "disabled";
export type AcademicUnitScheduleReviewOutcome =
  | "parsed_pending_review"
  | "parse_zero_review"
  | "unsupported_ocr_review"
  | "unsupported_format_review"
  | "fetch_failed_review"
  | "parse_failed_review"
  | "scope_rejected_review"
  | "definition_drift_review";

export interface AcademicUnitScheduleCandidate {
  rowNumber: number;
  rawText: string;
  title?: string;
  date?: string;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  location?: string;
}

export interface AcademicUnitScheduleReviewResult {
  outcome: AcademicUnitScheduleReviewOutcome;
  format: AcademicUnitScheduleFormat;
  parser: "pdf_binary_text" | "pdf_ocr" | "office_xlsx" | "html_text" | "none";
  reasonCode?: string;
  httpStatus?: number;
  contentType?: string;
  finalUrl?: string;
  finalUrlHash?: string;
  contentSha256?: string;
  contentLengthBytes?: number;
  candidateCount: number;
  candidates: AcademicUnitScheduleCandidate[];
  checkedAt: Date;
}

export interface AcademicUnitScheduleReviewDecision {
  decision: "approved" | "rejected";
  reviewKey: string;
  reviewRevision: number;
  reviewedBy: string;
  reviewedAt: Date;
  approvedRowNumbers: number[];
  rejectedRowNumbers: number[];
  reason?: string;
  academicYear?: string;
  term?: "fall" | "spring" | "summer" | "full_year" | "unknown";
  courseRangeStart?: string;
  courseRangeEnd?: string;
  materializationStatus?: "materializing" | "staged" | "reopening" | "publishing" | "published";
  calendarId?: string;
  eventIds?: string[];
  publicationLeaseUntil?: Date;
  publishedBy?: string;
  publishedAt?: Date;
}

export interface AcademicUnitScheduleRevokedPublication {
  sourceId: string;
  universityId: string;
  reviewKey: string;
}

export interface AcademicUnitScheduleSourceRecord {
  id: string;
  key: string;
  universityId: string;
  facultyId: string;
  departmentId: string;
  scheduleType: AcademicUnitScheduleType;
  sourceUrl: string;
  sourceUrlHash: string;
  verifiedFinalUrl: string;
  verifiedFinalUrlHash: string;
  definitionHash: string;
  evidenceHash: string;
  evidence: VerifiedRegistrySourceEvidence;
  lifecycle: AcademicUnitScheduleLifecycle;
  revision: number;
  processingLeaseUntil?: Date;
  reviewResult?: AcademicUnitScheduleReviewResult;
  reviewDecision?: AcademicUnitScheduleReviewDecision;
  createdAt: Date;
  updatedAt: Date;
}

export type NewAcademicUnitScheduleSource = Omit<
  AcademicUnitScheduleSourceRecord,
  "id" | "lifecycle" | "revision" | "processingLeaseUntil" | "reviewResult" | "reviewDecision" | "createdAt" | "updatedAt"
>;

export interface AcademicUnitScheduleSourceFilters {
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
  scheduleType?: AcademicUnitScheduleType;
  lifecycle?: AcademicUnitScheduleLifecycle;
  limit: number;
  offset: number;
}

export interface AcademicUnitScheduleSourceRepository {
  provisionSource(input: NewAcademicUnitScheduleSource): Promise<{
    record: AcademicUnitScheduleSourceRecord;
    disposition: "created" | "existing" | "refreshed";
  }>;
  disableSourcesExcept(validDefinitions: ReadonlyArray<{ key: string; definitionHash: string }>): Promise<{
    disabled: number;
    revokedPublications: AcademicUnitScheduleRevokedPublication[];
  }>;
  findSourceById(id: string): Promise<AcademicUnitScheduleSourceRecord | null>;
  listSources(filters: AcademicUnitScheduleSourceFilters): Promise<AcademicUnitScheduleSourceRecord[]>;
  claimSource(input: {
    id: string;
    expectedRevision: number;
    definitionHash: string;
    now: Date;
    leaseUntil: Date;
  }): Promise<AcademicUnitScheduleSourceRecord | null>;
  completeSource(input: {
    id: string;
    claimRevision: number;
    definitionHash: string;
    result: AcademicUnitScheduleReviewResult;
  }): Promise<AcademicUnitScheduleSourceRecord | null>;
  updateCandidate(input: {
    id: string;
    expectedRevision: number;
    definitionHash: string;
    rowNumber: number;
    candidate: AcademicUnitScheduleCandidate;
  }): Promise<AcademicUnitScheduleSourceRecord | null>;
  beginReviewDecision(input: {
    id: string;
    expectedRevision: number;
    definitionHash: string;
    decision: AcademicUnitScheduleReviewDecision;
  }): Promise<AcademicUnitScheduleSourceRecord | null>;
  completeMaterialization(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
    calendarId: string;
    eventIds: string[];
  }): Promise<AcademicUnitScheduleSourceRecord | null>;
  claimReviewReopen(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
  }): Promise<AcademicUnitScheduleSourceRecord | null>;
  completeReviewReopen(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
  }): Promise<AcademicUnitScheduleSourceRecord | null>;
  claimPublication(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
    now: Date;
    leaseUntil: Date;
  }): Promise<AcademicUnitScheduleSourceRecord | null>;
  completePublication(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
    publishedBy: string;
    publishedAt: Date;
  }): Promise<AcademicUnitScheduleSourceRecord | null>;
  releasePublication(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
  }): Promise<AcademicUnitScheduleSourceRecord | null>;
}
