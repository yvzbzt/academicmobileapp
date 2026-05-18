export type UniversityType = "state" | "foundation" | "private";
export type CatalogStatus = "active" | "inactive" | "archived";
export type EducationLevel = "associate" | "bachelor" | "master" | "doctorate";

export interface UniversityRecord {
  id: string;
  name: string;
  slug: string;
  city: string;
  type: UniversityType;
  websiteUrl?: string;
  academicCalendarUrl?: string;
  logoUrl?: string;
  status: CatalogStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface FacultyRecord {
  id: string;
  universityId: string;
  name: string;
  slug: string;
  status: CatalogStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface DepartmentRecord {
  id: string;
  universityId: string;
  facultyId: string;
  name: string;
  slug: string;
  educationLevel: EducationLevel;
  status: CatalogStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CatalogRepository {
  createUniversity(input: Omit<UniversityRecord, "id" | "createdAt" | "updatedAt">): Promise<UniversityRecord>;
  updateUniversity(id: string, input: Partial<Omit<UniversityRecord, "id" | "createdAt" | "updatedAt">>): Promise<UniversityRecord | null>;
  archiveUniversity(id: string): Promise<UniversityRecord | null>;
  findUniversityById(id: string): Promise<UniversityRecord | null>;
  listUniversities(input: { search?: string; status?: CatalogStatus; limit: number; offset: number }): Promise<UniversityRecord[]>;
  createFaculty(input: Omit<FacultyRecord, "id" | "createdAt" | "updatedAt">): Promise<FacultyRecord>;
  listFaculties(universityId: string, status?: CatalogStatus): Promise<FacultyRecord[]>;
  createDepartment(input: Omit<DepartmentRecord, "id" | "createdAt" | "updatedAt">): Promise<DepartmentRecord>;
  listDepartments(facultyId: string, status?: CatalogStatus): Promise<DepartmentRecord[]>;
}
