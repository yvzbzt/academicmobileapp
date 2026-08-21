export type AcademicUnitSuggestionStatus = "pending" | "approved" | "rejected";
export type SuggestedEducationLevel = "associate" | "bachelor" | "master" | "doctorate";

export interface AcademicUnitSuggestionRecord {
  id: string;
  userId: string;
  userEmail: string;
  universityId: string;
  facultyName: string;
  departmentName?: string;
  educationLevel: SuggestedEducationLevel;
  status: AcademicUnitSuggestionStatus;
  createdAt: Date;
  reviewedAt?: Date;
}

export interface FollowedAcademicScopeRecord {
  id: string;
  userId: string;
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  createdAt: Date;
}

export interface UserDataRepository {
  createAcademicUnitSuggestion(
    input: Omit<AcademicUnitSuggestionRecord, "id" | "status" | "createdAt" | "reviewedAt">
  ): Promise<AcademicUnitSuggestionRecord>;
  findAcademicUnitSuggestionById(id: string): Promise<AcademicUnitSuggestionRecord | null>;
  listAcademicUnitSuggestions(status: AcademicUnitSuggestionStatus): Promise<AcademicUnitSuggestionRecord[]>;
  updateAcademicUnitSuggestionReview(
    id: string,
    input: { status: "approved" | "rejected"; reviewedAt: Date }
  ): Promise<AcademicUnitSuggestionRecord | null>;
  upsertFollowedAcademicScope(
    input: Omit<FollowedAcademicScopeRecord, "id" | "createdAt">
  ): Promise<FollowedAcademicScopeRecord>;
  listFollowedAcademicScopesByUserId(userId: string): Promise<FollowedAcademicScopeRecord[]>;
  deleteFollowedAcademicScopeById(userId: string, id: string): Promise<boolean>;
  deleteUserData(userId: string): Promise<void>;
}

export function normalizeFollowedAcademicScope(
  input: { universityId: string; facultyId?: string; departmentId?: string }
): { universityId: string; facultyId?: string; departmentId?: string } {
  return {
    universityId: input.universityId,
    ...(input.facultyId ? { facultyId: input.facultyId } : {}),
    ...(input.departmentId ? { departmentId: input.departmentId } : {})
  };
}

export function followedAcademicScopeKey(
  input: { universityId: string; facultyId?: string; departmentId?: string }
): string {
  const normalized = normalizeFollowedAcademicScope(input);
  return JSON.stringify([
    normalized.universityId,
    normalized.facultyId ?? null,
    normalized.departmentId ?? null
  ]);
}
