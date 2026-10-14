import React, { useState, type ReactNode } from "react";

interface CoverageUnit {
  universityId: string; universityName: string;
  facultyId: string; facultyName: string;
  scopeId: string; scopeType: "faculty" | "department"; scopeName: string;
  departmentName?: string;
}
interface UnitGroup<T> { id: string; name: string; items: T[] }
interface FacultyGroup<T> extends UnitGroup<T> { departments: UnitGroup<T>[]; count: number }
interface UniversityGroup<T> { id: string; name: string; faculties: FacultyGroup<T>[]; count: number }

// Group only the returned page; never merge units by their display names.
export function groupCoverageItems<T extends CoverageUnit>(items: readonly T[]): UniversityGroup<T>[] {
  const universities = new Map<string, UniversityGroup<T>>();
  for (const item of items) {
    let university = universities.get(item.universityId);
    if (!university) {
      university = { id: item.universityId, name: item.universityName, faculties: [], count: 0 };
      universities.set(item.universityId, university);
    }
    const facultyId = item.facultyId || (item.scopeType === "faculty" ? item.scopeId : "unknown-faculty");
    let faculty = university.faculties.find((group) => group.id === facultyId);
    if (!faculty) {
      faculty = { id: facultyId, name: item.facultyName || "Fakülte bilgisi yok", items: [], departments: [], count: 0 };
      university.faculties.push(faculty);
    }
    university.count++; faculty.count++;
    if (item.scopeType === "faculty") faculty.items.push(item);
    else {
      let department = faculty.departments.find((group) => group.id === item.scopeId);
      if (!department) {
        department = { id: item.scopeId, name: item.departmentName || item.scopeName, items: [] };
        faculty.departments.push(department);
      }
      department.items.push(item);
    }
  }
  return [...universities.values()];
}

function CoverageBlock({ name, count, className, children }: {
  name: string; count: number; className: string; children: () => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return <details className={`coverageGroup ${className}`} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><strong>{name}</strong><span>{count} kayıt</span></summary>
    {expanded && <div className="coverageGroupBody">{children()}</div>}
  </details>;
}

export function SourceCoverageGroups<T extends CoverageUnit>({ items, renderItem }: {
  items: readonly T[]; renderItem: (item: T) => ReactNode;
}) {
  const groups = groupCoverageItems(items);
  return <div className="coverageList">
    {groups.length > 0 && <p className="coveragePageHint">Bu sayfada {groups.length} üniversite · {items.length} kayıt. Başlıkları açarak birim seçebilirsin; diğer kayıtlar için Sonraki'yi kullan.</p>}
    {groups.map((university) => <CoverageBlock key={university.id} className="coverageUniversity" name={university.name} count={university.count}>
      {() => university.faculties.map((faculty) => <CoverageBlock key={faculty.id} className="coverageFaculty" name={faculty.name} count={faculty.count}>
        {() => <>
          {faculty.items.length > 0 && <section className="coverageFacultyGeneral"><h3>Fakülte geneli</h3>{faculty.items.map(renderItem)}</section>}
          {faculty.departments.map((department) => <CoverageBlock key={department.id} className="coverageDepartment" name={department.name} count={department.items.length}>
            {() => department.items.map(renderItem)}
          </CoverageBlock>)}
        </>}
      </CoverageBlock>)}
    </CoverageBlock>)}
  </div>;
}
