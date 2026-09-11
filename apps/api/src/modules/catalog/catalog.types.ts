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
  announcementUrl?: string;
  academicCalendarUrl?: string;
  logoUrl?: string;
  emailDomains?: string[];
  status: CatalogStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface FacultyRecord {
  id: string;
  universityId: string;
  name: string;
  slug: string;
  websiteUrl?: string;
  announcementUrl?: string;
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
  websiteUrl?: string;
  announcementUrl?: string;
  courseScheduleUrl?: string;
  examScheduleUrl?: string;
  status: CatalogStatus;
  createdAt: Date;
  updatedAt: Date;
}

type MutableUniversityRecord = Omit<UniversityRecord, "id" | "createdAt" | "updatedAt">;
type MutableFacultyRecord = Omit<FacultyRecord, "id" | "createdAt" | "updatedAt">;
type MutableDepartmentRecord = Omit<DepartmentRecord, "id" | "createdAt" | "updatedAt">;

export type UniversityRecordUpdate = Partial<Omit<MutableUniversityRecord, "websiteUrl" | "announcementUrl" | "academicCalendarUrl" | "logoUrl">>
  & Partial<Record<"websiteUrl" | "announcementUrl" | "academicCalendarUrl" | "logoUrl", string | null>>;
export type FacultyRecordUpdate = Partial<Omit<MutableFacultyRecord, "websiteUrl" | "announcementUrl">>
  & Partial<Record<"websiteUrl" | "announcementUrl", string | null>>;
export type DepartmentRecordUpdate = Partial<Omit<MutableDepartmentRecord, "websiteUrl" | "announcementUrl" | "courseScheduleUrl" | "examScheduleUrl">>
  & Partial<Record<"websiteUrl" | "announcementUrl" | "courseScheduleUrl" | "examScheduleUrl", string | null>>;

export type VerifiedSourceUrlFill = {
  scopeId: string;
  expectedValue: string | null;
  verifiedUrl: string;
} & (
  | { scopeType: "university"; field: "announcementUrl" | "academicCalendarUrl" }
  | { scopeType: "faculty"; field: "websiteUrl" | "announcementUrl" }
  | { scopeType: "department"; field: "websiteUrl" | "announcementUrl" | "courseScheduleUrl" | "examScheduleUrl" }
);

export interface CatalogRepository {
  createUniversity(input: Omit<UniversityRecord, "id" | "createdAt" | "updatedAt">): Promise<UniversityRecord>;
  updateUniversity(id: string, input: UniversityRecordUpdate): Promise<UniversityRecord | null>;
  archiveUniversity(id: string): Promise<UniversityRecord | null>;
  findUniversityById(id: string): Promise<UniversityRecord | null>;
  listUniversities(input: { search?: string; status?: CatalogStatus; limit: number; offset: number }): Promise<UniversityRecord[]>;
  findUniversityByEmailDomain(domain: string): Promise<UniversityRecord | null>;
  createFaculty(input: Omit<FacultyRecord, "id" | "createdAt" | "updatedAt">): Promise<FacultyRecord>;
  updateFaculty(id: string, input: FacultyRecordUpdate): Promise<FacultyRecord | null>;
  listFaculties(universityId: string, status?: CatalogStatus): Promise<FacultyRecord[]>;
  createDepartment(input: Omit<DepartmentRecord, "id" | "createdAt" | "updatedAt">): Promise<DepartmentRecord>;
  updateDepartment(id: string, input: DepartmentRecordUpdate): Promise<DepartmentRecord | null>;
  listDepartments(facultyId: string, status?: CatalogStatus): Promise<DepartmentRecord[]>;
  compareAndFillVerifiedSourceUrl?(input: VerifiedSourceUrlFill): Promise<boolean>;
}
