import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CatalogRepository, CatalogStatus, DepartmentRecord, FacultyRecord, UniversityRecord } from "./catalog.types.js";

@Injectable()
export class InMemoryCatalogRepository implements CatalogRepository {
  private readonly universities = new Map<string, UniversityRecord>();
  private readonly faculties = new Map<string, FacultyRecord>();
  private readonly departments = new Map<string, DepartmentRecord>();

  constructor() {
    const now = new Date();
    const university: UniversityRecord = {
      id: "sample-university-1",
      name: "Ankara Ornek Universitesi",
      slug: "ankara-ornek-universitesi",
      city: "Ankara",
      type: "state",
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    const faculty: FacultyRecord = {
      id: "sample-faculty-1",
      universityId: university.id,
      name: "Muhendislik Fakultesi",
      slug: "muhendislik-fakultesi",
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    const department: DepartmentRecord = {
      id: "sample-department-1",
      universityId: university.id,
      facultyId: faculty.id,
      name: "Bilgisayar Muhendisligi",
      slug: "bilgisayar-muhendisligi",
      educationLevel: "bachelor",
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    this.universities.set(university.id, university);
    this.faculties.set(faculty.id, faculty);
    this.departments.set(department.id, department);
  }

  async createUniversity(input: Omit<UniversityRecord, "id" | "createdAt" | "updatedAt">): Promise<UniversityRecord> {
    if ([...this.universities.values()].some((university) => university.slug === input.slug)) throw new Error("UNIVERSITY_SLUG_EXISTS");
    const now = new Date();
    const university: UniversityRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.universities.set(university.id, university);
    return university;
  }

  async updateUniversity(id: string, input: Partial<Omit<UniversityRecord, "id" | "createdAt" | "updatedAt">>): Promise<UniversityRecord | null> {
    const university = this.universities.get(id);
    if (!university) return null;
    const updated: UniversityRecord = { ...university, ...input, updatedAt: new Date() };
    this.universities.set(id, updated);
    return updated;
  }

  async archiveUniversity(id: string): Promise<UniversityRecord | null> {
    return this.updateUniversity(id, { status: "archived" });
  }

  async findUniversityById(id: string): Promise<UniversityRecord | null> {
    return this.universities.get(id) ?? null;
  }

  async listUniversities(input: { search?: string; status?: CatalogStatus; limit: number; offset: number }): Promise<UniversityRecord[]> {
    const search = input.search?.toLocaleLowerCase("tr-TR");
    return [...this.universities.values()]
      .filter((university) => (input.status ? university.status === input.status : true))
      .filter((university) => (search ? university.name.toLocaleLowerCase("tr-TR").includes(search) || university.city.toLocaleLowerCase("tr-TR").includes(search) : true))
      .sort((left, right) => left.name.localeCompare(right.name, "tr-TR"))
      .slice(input.offset, input.offset + input.limit);
  }

  async createFaculty(input: Omit<FacultyRecord, "id" | "createdAt" | "updatedAt">): Promise<FacultyRecord> {
    if ([...this.faculties.values()].some((faculty) => faculty.universityId === input.universityId && faculty.slug === input.slug)) throw new Error("FACULTY_SLUG_EXISTS");
    const now = new Date();
    const faculty: FacultyRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.faculties.set(faculty.id, faculty);
    return faculty;
  }

  async listFaculties(universityId: string, status?: CatalogStatus): Promise<FacultyRecord[]> {
    return [...this.faculties.values()]
      .filter((faculty) => faculty.universityId === universityId)
      .filter((faculty) => (status ? faculty.status === status : true))
      .sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
  }

  async createDepartment(input: Omit<DepartmentRecord, "id" | "createdAt" | "updatedAt">): Promise<DepartmentRecord> {
    if ([...this.departments.values()].some((department) => department.facultyId === input.facultyId && department.slug === input.slug)) throw new Error("DEPARTMENT_SLUG_EXISTS");
    const now = new Date();
    const department: DepartmentRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.departments.set(department.id, department);
    return department;
  }

  async listDepartments(facultyId: string, status?: CatalogStatus): Promise<DepartmentRecord[]> {
    return [...this.departments.values()]
      .filter((department) => department.facultyId === facultyId)
      .filter((department) => (status ? department.status === status : true))
      .sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
  }
}
