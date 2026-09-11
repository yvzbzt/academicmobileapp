export const VERIFIED_SOURCE_COVERAGE_SOURCE_TYPES = [
  "homepage",
  "announcement",
  "news",
  "event",
  "academic_calendar",
  "course_schedule",
  "exam_schedule"
] as const;

export type VerifiedSourceCoverageSourceType = (typeof VERIFIED_SOURCE_COVERAGE_SOURCE_TYPES)[number];

export const VERIFIED_SOURCE_COVERAGE_RESOLUTIONS = [
  "missing",
  "quarantined",
  "verified",
  "legacy_unverified"
] as const;

export type VerifiedSourceCoverageResolution = (typeof VERIFIED_SOURCE_COVERAGE_RESOLUTIONS)[number];
export type VerifiedSourceCoverageScopeType = "faculty" | "department";

export interface VerifiedSourceCoverageQuery {
  search?: string;
  universityId?: string;
  scopeType?: VerifiedSourceCoverageScopeType;
  sourceType?: VerifiedSourceCoverageSourceType;
  resolution?: VerifiedSourceCoverageResolution;
  limit?: number;
  offset?: number;
}

export interface VerifiedSourceCoverageItem {
  id: string;
  universityId: string;
  universityName: string;
  scopeType: VerifiedSourceCoverageScopeType;
  scopeId: string;
  scopeName: string;
  facultyId: string;
  facultyName: string;
  departmentId?: string;
  departmentName?: string;
  sourceType: VerifiedSourceCoverageSourceType;
  resolution: VerifiedSourceCoverageResolution;
  url?: string;
  evidencePresent: boolean;
  evidenceArtifactReferencePresent: boolean;
  finalRevalidatedAt?: string;
  publicationScope?: "university" | "faculty_shared" | "department_specific" | "university_system";
  inheritedFromScopeType?: "faculty" | "university";
  inheritedFromScopeId?: string;
  quarantineReason?: string;
  missingReason?: string;
  legacyReason?: "final_revalidation_evidence_missing";
}

export interface VerifiedSourceCoverageResolutionCounts {
  missing: number;
  quarantined: number;
  verified: number;
  legacy_unverified: number;
}

export interface VerifiedSourceCoverageSourceSummary extends VerifiedSourceCoverageResolutionCounts {
  total: number;
}

export interface VerifiedSourceCoverageSummary {
  catalog: {
    universities: number;
    academicUnits: number;
    faculties: number;
    departments: number;
  };
  filteredAcademicUnits: number;
  filteredSourceSlots: number;
  byResolution: VerifiedSourceCoverageResolutionCounts;
  bySourceType: Record<VerifiedSourceCoverageSourceType, VerifiedSourceCoverageSourceSummary>;
}

export interface VerifiedSourceCoverageResponse {
  total: number;
  items: VerifiedSourceCoverageItem[];
  summary: VerifiedSourceCoverageSummary;
}
