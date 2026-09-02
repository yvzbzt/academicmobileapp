import type { SourceAuthorityScopeType } from "./source-authority-policy.js";

export interface SourceScopeOwnershipIndex {
  universityOwners: ReadonlyMap<string, string | null>;
  facultyOwners: ReadonlyMap<string, string | null>;
  departmentOwners: ReadonlyMap<string, string | null>;
}

export interface ResolvedSourceScopeOwnership {
  resolvedOwnerAcademicEntityId: string | null;
  resolvedOwnerUniversityId: string | null;
}

/** Builds independent scope-to-university membership from the checked-in catalog tree. */
export function buildSourceScopeOwnershipIndex(catalog: unknown): SourceScopeOwnershipIndex {
  const universityOwners = new Map<string, string | null>();
  const facultyOwners = new Map<string, string | null>();
  const departmentOwners = new Map<string, string | null>();
  const container = asRecord(catalog);
  const universities = Array.isArray(container?.universities) ? container.universities : [];

  for (const value of universities) {
    const university = asRecord(value);
    const universityId = readString(university?.slug) ?? readString(university?.universityId);
    if (!universityId) continue;
    registerOwner(universityOwners, universityId, universityId);

    for (const facultyValue of Array.isArray(university?.faculties) ? university.faculties : []) {
      const faculty = asRecord(facultyValue);
      const facultySlug = readString(faculty?.slug);
      if (!facultySlug) continue;
      const facultyId = `${universityId}__${facultySlug}`;
      registerOwner(facultyOwners, facultyId, universityId);

      for (const departmentValue of Array.isArray(faculty?.departments) ? faculty.departments : []) {
        const department = asRecord(departmentValue);
        const departmentSlug = readString(department?.slug);
        if (!departmentSlug) continue;
        registerOwner(departmentOwners, `${facultyId}__${departmentSlug}`, universityId);
      }
    }
  }

  return { universityOwners, facultyOwners, departmentOwners };
}

export function resolveSourceScopeOwnership(
  index: SourceScopeOwnershipIndex,
  input: { scopeType: SourceAuthorityScopeType; scopeId: string }
): ResolvedSourceScopeOwnership {
  const owner = input.scopeType === "university"
    ? index.universityOwners.get(input.scopeId)
    : input.scopeType === "faculty"
      ? index.facultyOwners.get(input.scopeId)
      : index.departmentOwners.get(input.scopeId);
  if (!owner) {
    return {
      resolvedOwnerAcademicEntityId: null,
      resolvedOwnerUniversityId: null
    };
  }
  return {
    resolvedOwnerAcademicEntityId: input.scopeId,
    resolvedOwnerUniversityId: owner
  };
}

function registerOwner(target: Map<string, string | null>, scopeId: string, universityId: string): void {
  if (!target.has(scopeId)) {
    target.set(scopeId, universityId);
    return;
  }
  if (target.get(scopeId) !== universityId) target.set(scopeId, null);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
