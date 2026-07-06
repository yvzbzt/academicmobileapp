import { ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import type { CatalogRepository, CatalogStatus, DepartmentRecord, FacultyRecord, UniversityRecord, UniversityType, EducationLevel } from "./catalog.types.js";
import { createSlug } from "./slug.js";

@Injectable()
export class CatalogService {
  constructor(
    @Inject("CatalogRepository") private readonly catalogRepository: CatalogRepository,
    @Optional() @Inject(AuditService) private readonly auditService?: AuditService
  ) {}

  async listUniversities(input: { search?: string; limit?: number; offset?: number; includeInactive?: boolean }): Promise<UniversityRecord[]> {
    return this.catalogRepository.listUniversities({
      ...(input.search ? { search: input.search } : {}),
      ...(input.includeInactive ? {} : { status: "active" }),
      limit: Math.min(Math.max(input.limit ?? 50, 1), 500),
      offset: Math.max(input.offset ?? 0, 0)
    });
  }

  async findUniversityByEmailDomain(domain: string): Promise<UniversityRecord | null> {
    return this.catalogRepository.findUniversityByEmailDomain(normalizeDomain(domain));
  }

  async getUniversity(id: string): Promise<UniversityRecord> {
    const university = await this.catalogRepository.findUniversityById(id);
    if (!university || university.status !== "active") throw new NotFoundException("University not found.");
    return university;
  }

  async listFaculties(universityId: string): Promise<FacultyRecord[]> {
    await this.getUniversity(universityId);
    return this.catalogRepository.listFaculties(universityId, "active");
  }

  async listDepartments(facultyId: string): Promise<DepartmentRecord[]> {
    return this.catalogRepository.listDepartments(facultyId, "active");
  }

  async createUniversity(input: { name: string; city: string; type: UniversityType; websiteUrl?: string; announcementUrl?: string; academicCalendarUrl?: string; logoUrl?: string; emailDomains?: string[] }): Promise<UniversityRecord> {
    try {
      const university = await this.catalogRepository.createUniversity({
        name: input.name.trim(),
        slug: createSlug(input.name),
        city: input.city.trim(),
        type: input.type,
        ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
        ...(input.announcementUrl ? { announcementUrl: input.announcementUrl } : {}),
        ...(input.academicCalendarUrl ? { academicCalendarUrl: input.academicCalendarUrl } : {}),
        ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
        ...(input.emailDomains ? { emailDomains: normalizeDomains(input.emailDomains) } : {}),
        status: "active"
      });
      await this.recordCatalogAudit("catalog.university.created", "university", university.id, { name: university.name });
      return university;
    } catch (error) {
      if (error instanceof Error && error.message === "UNIVERSITY_SLUG_EXISTS") throw new ConflictException("University slug already exists.");
      throw error;
    }
  }

  async updateUniversity(id: string, input: { name?: string; city?: string; type?: UniversityType; status?: CatalogStatus; websiteUrl?: string; announcementUrl?: string; academicCalendarUrl?: string; logoUrl?: string; emailDomains?: string[] }): Promise<UniversityRecord> {
    const updated = await this.catalogRepository.updateUniversity(id, {
      ...(input.name ? { name: input.name.trim(), slug: createSlug(input.name) } : {}),
      ...(input.city ? { city: input.city.trim() } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
      ...(input.announcementUrl ? { announcementUrl: input.announcementUrl } : {}),
      ...(input.academicCalendarUrl ? { academicCalendarUrl: input.academicCalendarUrl } : {}),
      ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
      ...(input.emailDomains ? { emailDomains: normalizeDomains(input.emailDomains) } : {})
    });
    if (!updated) throw new NotFoundException("University not found.");
    await this.recordCatalogAudit("catalog.university.updated", "university", updated.id, { updatedFields: Object.keys(input) });
    return updated;
  }

  async archiveUniversity(id: string): Promise<UniversityRecord> {
    const archived = await this.catalogRepository.archiveUniversity(id);
    if (!archived) throw new NotFoundException("University not found.");
    await this.recordCatalogAudit("catalog.university.archived", "university", archived.id, { name: archived.name });
    return archived;
  }

  async addEmailDomain(id: string, domain: string): Promise<UniversityRecord> {
    const university = await this.catalogRepository.findUniversityById(id);
    if (!university) throw new NotFoundException("University not found.");
    const normalizedDomain = normalizeDomain(domain);
    const existingUniversity = await this.catalogRepository.findUniversityByEmailDomain(normalizedDomain);
    if (existingUniversity && existingUniversity.id !== id) throw new ConflictException("Email domain is already associated with another university.");
    return this.updateUniversity(id, { emailDomains: [...(university.emailDomains ?? []), normalizedDomain] });
  }

  async createFaculty(input: { universityId: string; name: string; websiteUrl?: string; announcementUrl?: string }): Promise<FacultyRecord> {
    const university = await this.catalogRepository.findUniversityById(input.universityId);
    if (!university) throw new NotFoundException("University not found.");
    const faculty = await this.catalogRepository.createFaculty({
      universityId: input.universityId,
      name: input.name.trim(),
      slug: createSlug(input.name),
      ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
      ...(input.announcementUrl ? { announcementUrl: input.announcementUrl } : {}),
      status: "active"
    });
    await this.recordCatalogAudit("catalog.faculty.created", "faculty", faculty.id, { universityId: faculty.universityId, name: faculty.name });
    return faculty;
  }

  async updateFaculty(id: string, input: { name?: string; status?: CatalogStatus; websiteUrl?: string; announcementUrl?: string }): Promise<FacultyRecord> {
    const updated = await this.catalogRepository.updateFaculty(id, {
      ...(input.name ? { name: input.name.trim(), slug: createSlug(input.name) } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
      ...(input.announcementUrl ? { announcementUrl: input.announcementUrl } : {})
    });
    if (!updated) throw new NotFoundException("Faculty not found.");
    await this.recordCatalogAudit("catalog.faculty.updated", "faculty", updated.id, { updatedFields: Object.keys(input) });
    return updated;
  }

  async createDepartment(input: { universityId: string; facultyId: string; name: string; educationLevel: EducationLevel; websiteUrl?: string; announcementUrl?: string; courseScheduleUrl?: string; examScheduleUrl?: string }): Promise<DepartmentRecord> {
    const university = await this.catalogRepository.findUniversityById(input.universityId);
    if (!university) throw new NotFoundException("University not found.");
    const faculty = (await this.catalogRepository.listFaculties(input.universityId)).find((candidate) => candidate.id === input.facultyId);
    if (!faculty) throw new NotFoundException("Faculty not found for selected university.");
    const department = await this.catalogRepository.createDepartment({
      universityId: input.universityId,
      facultyId: input.facultyId,
      name: input.name.trim(),
      slug: createSlug(input.name),
      educationLevel: input.educationLevel,
      ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
      ...(input.announcementUrl ? { announcementUrl: input.announcementUrl } : {}),
      ...(input.courseScheduleUrl ? { courseScheduleUrl: input.courseScheduleUrl } : {}),
      ...(input.examScheduleUrl ? { examScheduleUrl: input.examScheduleUrl } : {}),
      status: "active"
    });
    await this.recordCatalogAudit("catalog.department.created", "department", department.id, { universityId: department.universityId, facultyId: department.facultyId, name: department.name });
    return department;
  }

  async updateDepartment(id: string, input: { name?: string; educationLevel?: EducationLevel; status?: CatalogStatus; websiteUrl?: string; announcementUrl?: string; courseScheduleUrl?: string; examScheduleUrl?: string }): Promise<DepartmentRecord> {
    const updated = await this.catalogRepository.updateDepartment(id, {
      ...(input.name ? { name: input.name.trim(), slug: createSlug(input.name) } : {}),
      ...(input.educationLevel ? { educationLevel: input.educationLevel } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
      ...(input.announcementUrl ? { announcementUrl: input.announcementUrl } : {}),
      ...(input.courseScheduleUrl ? { courseScheduleUrl: input.courseScheduleUrl } : {}),
      ...(input.examScheduleUrl ? { examScheduleUrl: input.examScheduleUrl } : {})
    });
    if (!updated) throw new NotFoundException("Department not found.");
    await this.recordCatalogAudit("catalog.department.updated", "department", updated.id, { updatedFields: Object.keys(input) });
    return updated;
  }

  private async recordCatalogAudit(action: string, entityType: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.auditService?.record({
      actorId: "admin-panel",
      action,
      entityType,
      entityId,
      metadata
    });
  }
}

function normalizeDomain(domain: string): string {
  return domain.trim().replace(/^@/, "").toLocaleLowerCase("en-US");
}

function normalizeDomains(domains: string[]): string[] {
  return [...new Set(domains.map(normalizeDomain).filter(Boolean))].sort();
}
