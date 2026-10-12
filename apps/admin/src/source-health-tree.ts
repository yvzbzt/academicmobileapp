import type { AdminSourceHealthAlert, AdminSourceHealthInput } from "./source-health-alerts.js";

export interface HealthFacultyUnit {
  id: string;
  name: string;
}

export interface HealthDepartmentUnit {
  id: string;
  name: string;
  facultyId: string;
}

export interface ScopedHealthAlert extends AdminSourceHealthAlert {
  scopeDescription: string;
}

export interface SourceHealthDepartmentGroup {
  id: string;
  name: string;
  alerts: ScopedHealthAlert[];
}

export interface SourceHealthFacultyGroup {
  id: string;
  name: string;
  alerts: ScopedHealthAlert[];
  departments: SourceHealthDepartmentGroup[];
}

export interface SourceHealthUniversityGroup {
  id: string;
  name: string;
  universityAlerts: ScopedHealthAlert[];
  faculties: SourceHealthFacultyGroup[];
  alertCount: number;
}

export function buildSourceHealthTree(
  alerts: readonly AdminSourceHealthAlert[],
  sources: readonly AdminSourceHealthInput[],
  facultyUnits: readonly HealthFacultyUnit[],
  departmentUnits: readonly HealthDepartmentUnit[]
): SourceHealthUniversityGroup[] {
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const facultiesById = new Map(facultyUnits.map((faculty) => [faculty.id, faculty]));
  const departmentsById = new Map(departmentUnits.map((department) => [department.id, department]));
  const knownFacultyIds = new Set([
    ...facultiesById.keys(),
    ...sources.filter((source) => source.scopeType === "faculty" && source.scopeId).map((source) => source.scopeId!)
  ]);
  const universities = new Map<string, SourceHealthUniversityGroup>();

  for (const alert of alerts) {
    const university: SourceHealthUniversityGroup = universities.get(alert.universityId) ?? {
      id: alert.universityId,
      name: alert.universityName,
      universityAlerts: [],
      faculties: [],
      alertCount: 0
    };
    const source = sourcesById.get(alert.sourceId);
    const scopeType = source?.scopeType ?? "university";
    university.alertCount += 1;

    if (scopeType === "university") {
      university.universityAlerts.push({ ...alert, scopeDescription: "Üniversite geneli" });
      universities.set(university.id, university);
      continue;
    }

    const department = scopeType === "department" ? departmentsById.get(source?.scopeId ?? "") : undefined;
    const facultyId = scopeType === "faculty"
      ? source?.scopeId ?? "unknown"
      : source?.ownerFacultyId
        ?? department?.facultyId
        ?? inferFacultyId(source?.scopeId, knownFacultyIds)
        ?? `unresolved:${source?.scopeId ?? alert.sourceId}`;
    const faculty: SourceHealthFacultyGroup = university.faculties.find((item) => item.id === facultyId) ?? {
      id: facultyId,
      name: facultyId.startsWith("unresolved:")
        ? "Fakültesi belirlenemeyen bölüm"
        : facultiesById.get(facultyId)?.name ?? facultyId,
      alerts: [],
      departments: []
    };

    if (scopeType === "faculty") {
      faculty.alerts.push({ ...alert, scopeDescription: `Fakülte · ${faculty.name}` });
    } else {
      const departmentId = source?.scopeId ?? alert.sourceId;
      const departmentGroup: SourceHealthDepartmentGroup = faculty.departments.find((item) => item.id === departmentId) ?? {
        id: departmentId,
        name: department?.name ?? departmentId,
        alerts: []
      };
      departmentGroup.alerts.push({
        ...alert,
        scopeDescription: `Fakülte · ${faculty.name} / Bölüm · ${departmentGroup.name}`
      });
      if (!faculty.departments.some((item) => item.id === departmentId)) faculty.departments.push(departmentGroup);
    }
    if (!university.faculties.some((item) => item.id === facultyId)) university.faculties.push(faculty);
    universities.set(university.id, university);
  }

  return [...universities.values()]
    .map((university) => ({
      ...university,
      faculties: university.faculties
        .map((faculty) => ({
          ...faculty,
          departments: faculty.departments.sort((left, right) => left.name.localeCompare(right.name, "tr-TR"))
        }))
        .sort((left, right) => left.name.localeCompare(right.name, "tr-TR"))
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
}

function inferFacultyId(departmentId: string | undefined, facultyIds: ReadonlySet<string>): string | undefined {
  if (!departmentId) return undefined;
  return [...facultyIds]
    .filter((facultyId) => departmentId.startsWith(`${facultyId}__`))
    .sort((left, right) => right.length - left.length)[0];
}
