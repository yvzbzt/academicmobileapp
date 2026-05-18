import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CatalogRepository, CatalogStatus, DepartmentRecord, FacultyRecord, UniversityRecord, UniversityType, EducationLevel } from "./catalog.types.js";
import { createSlug } from "./slug.js";

@Injectable()
export class CatalogService {
  constructor(@Inject("CatalogRepository") private readonly catalogRepository: CatalogRepository) {}

  async listUniversities(input: { search?: string; limit?: number; offset?: number; includeInactive?: boolean }): Promise<UniversityRecord[]> {
    return this.catalogRepository.listUniversities({
      ...(input.search ? { search: input.search } : {}),
      ...(input.includeInactive ? {} : { status: "active" }),
      limit: Math.min(Math.max(input.limit ?? 50, 1), 100),
      offset: Math.max(input.offset ?? 0, 0)
    });
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

  async createUniversity(input: { name: string; city: string; type: UniversityType; websiteUrl?: string; academicCalendarUrl?: string; logoUrl?: string }): Promise<UniversityRecord> {
    try {
      return await this.catalogRepository.createUniversity({
        name: input.name.trim(),
        slug: createSlug(input.name),
        city: input.city.trim(),
        type: input.type,
        ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
        ...(input.academicCalendarUrl ? { academicCalendarUrl: input.academicCalendarUrl } : {}),
        ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
        status: "active"
      });
    } catch (error) {
      if (error instanceof Error && error.message === "UNIVERSITY_SLUG_EXISTS") throw new ConflictException("University slug already exists.");
      throw error;
    }
  }

  async updateUniversity(id: string, input: { name?: string; city?: string; type?: UniversityType; status?: CatalogStatus; websiteUrl?: string; academicCalendarUrl?: string; logoUrl?: string }): Promise<UniversityRecord> {
    const updated = await this.catalogRepository.updateUniversity(id, {
      ...(input.name ? { name: input.name.trim(), slug: createSlug(input.name) } : {}),
      ...(input.city ? { city: input.city.trim() } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
      ...(input.academicCalendarUrl ? { academicCalendarUrl: input.academicCalendarUrl } : {}),
      ...(input.logoUrl ? { logoUrl: input.logoUrl } : {})
    });
    if (!updated) throw new NotFoundException("University not found.");
    return updated;
  }

  async archiveUniversity(id: string): Promise<UniversityRecord> {
    const archived = await this.catalogRepository.archiveUniversity(id);
    if (!archived) throw new NotFoundException("University not found.");
    return archived;
  }

  async createFaculty(input: { universityId: string; name: string }): Promise<FacultyRecord> {
    const university = await this.catalogRepository.findUniversityById(input.universityId);
    if (!university) throw new NotFoundException("University not found.");
    return this.catalogRepository.createFaculty({
      universityId: input.universityId,
      name: input.name.trim(),
      slug: createSlug(input.name),
      status: "active"
    });
  }

  async createDepartment(input: { universityId: string; facultyId: string; name: string; educationLevel: EducationLevel }): Promise<DepartmentRecord> {
    return this.catalogRepository.createDepartment({
      universityId: input.universityId,
      facultyId: input.facultyId,
      name: input.name.trim(),
      slug: createSlug(input.name),
      educationLevel: input.educationLevel,
      status: "active"
    });
  }
}
