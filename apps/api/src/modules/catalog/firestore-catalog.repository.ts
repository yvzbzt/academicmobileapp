import { Inject, Injectable } from "@nestjs/common";
import type { CollectionReference, DocumentData } from "firebase-admin/firestore";
import { FirestoreDatabaseService } from "../../database/firestore.service.js";
import { cleanFirestoreData, getAllFirestoreRecords, newFirestoreId, toFirestoreRecord } from "../../database/firestore-utils.js";
import type { CatalogSeedUniversity, TurkiyeCatalogSeed } from "../../bootstrap/yok-atlas-catalog-importer.js";
import type { CatalogRepository, CatalogStatus, DepartmentRecord, FacultyRecord, UniversityRecord } from "./catalog.types.js";

@Injectable()
export class FirestoreCatalogRepository implements CatalogRepository {
  constructor(@Inject(FirestoreDatabaseService) private readonly firestore: FirestoreDatabaseService) {}

  async seedCatalog(source: TurkiyeCatalogSeed, refresh = false) {
    const existing = await this.universities.limit(1).get();
    if (!refresh && !existing.empty) {
      return { created: false, skippedReason: "Catalog already exists in Firestore.", source: source.source, sourceUrl: source.sourceUrl };
    }

    const now = new Date();
    const writer = this.firestore.getDb().bulkWriter();
    let universities = 0;
    let faculties = 0;
    let departments = 0;

    for (const universitySeed of source.universities) {
      const universityId = universitySeed.slug;
      const university: UniversityRecord = {
        id: universityId,
        name: universitySeed.name,
        slug: universitySeed.slug,
        city: universitySeed.city,
        type: universitySeed.type,
        status: "active",
        createdAt: now,
        updatedAt: now
      };
      writer.set(this.universities.doc(university.id), cleanFirestoreData(university as unknown as Record<string, unknown>));
      universities += 1;
      for (const facultySeed of universitySeed.faculties) {
        const facultyId = `${university.id}__${facultySeed.slug}`;
        const faculty: FacultyRecord = { id: facultyId, universityId: university.id, name: facultySeed.name, slug: facultySeed.slug, status: "active", createdAt: now, updatedAt: now };
        writer.set(this.faculties.doc(faculty.id), cleanFirestoreData(faculty as unknown as Record<string, unknown>));
        faculties += 1;
        for (const departmentSeed of facultySeed.departments) {
          const department: DepartmentRecord = {
            id: `${faculty.id}__${departmentSeed.slug}`,
            universityId: university.id,
            facultyId: faculty.id,
            name: departmentSeed.name,
            slug: departmentSeed.slug,
            educationLevel: departmentSeed.educationLevel,
            status: "active",
            createdAt: now,
            updatedAt: now
          };
          writer.set(this.departments.doc(department.id), cleanFirestoreData(department as unknown as Record<string, unknown>));
          departments += 1;
        }
      }
    }

    await writer.close();
    return {
      created: true,
      source: source.source,
      sourceUrl: source.sourceUrl,
      sourceRowCount: source.sourceRowCount,
      includedRowCount: source.includedRowCount,
      universities,
      faculties,
      departments,
      createdUniversities: universities,
      createdFaculties: faculties,
      createdDepartments: departments
    };
  }

  async createUniversity(input: Omit<UniversityRecord, "id" | "createdAt" | "updatedAt">): Promise<UniversityRecord> {
    const duplicate = (await getAllFirestoreRecords<UniversityRecord>(this.universities.where("slug", "==", input.slug)))[0];
    if (duplicate) throw new Error("UNIVERSITY_SLUG_EXISTS");
    const now = new Date();
    const university: UniversityRecord = { ...input, id: newFirestoreId(), createdAt: now, updatedAt: now };
    await this.universities.doc(university.id).set(cleanFirestoreData(university as unknown as Record<string, unknown>));
    return university;
  }

  async updateUniversity(id: string, input: Partial<Omit<UniversityRecord, "id" | "createdAt" | "updatedAt">>): Promise<UniversityRecord | null> {
    const university = await this.findUniversityById(id);
    if (!university) return null;
    const updated: UniversityRecord = { ...university, ...input, updatedAt: new Date() };
    await this.universities.doc(id).set(cleanFirestoreData(updated as unknown as Record<string, unknown>), { merge: false });
    return updated;
  }

  archiveUniversity(id: string): Promise<UniversityRecord | null> {
    return this.updateUniversity(id, { status: "archived" });
  }

  async findUniversityById(id: string): Promise<UniversityRecord | null> {
    return toFirestoreRecord<UniversityRecord>(await this.universities.doc(id).get());
  }

  async listUniversities(input: { search?: string; status?: CatalogStatus; limit: number; offset: number }): Promise<UniversityRecord[]> {
    const records = input.status
      ? await getAllFirestoreRecords<UniversityRecord>(this.universities.where("status", "==", input.status))
      : await getAllFirestoreRecords<UniversityRecord>(this.universities);
    const search = input.search?.toLocaleLowerCase("tr-TR");
    return records
      .filter((university) => (search ? university.name.toLocaleLowerCase("tr-TR").includes(search) || university.city.toLocaleLowerCase("tr-TR").includes(search) : true))
      .sort((left, right) => left.name.localeCompare(right.name, "tr-TR"))
      .slice(input.offset, input.offset + input.limit);
  }

  async findUniversityByEmailDomain(domain: string): Promise<UniversityRecord | null> {
    const normalizedDomain = domain.trim().replace(/^@/, "").toLocaleLowerCase("en-US");
    const snapshot = await this.universities.where("emailDomains", "array-contains", normalizedDomain).limit(1).get();
    return snapshot.docs[0] ? toFirestoreRecord<UniversityRecord>(snapshot.docs[0]) : null;
  }

  async createFaculty(input: Omit<FacultyRecord, "id" | "createdAt" | "updatedAt">): Promise<FacultyRecord> {
    const duplicate = (await getAllFirestoreRecords<FacultyRecord>(this.faculties.where("universityId", "==", input.universityId))).find((faculty) => faculty.slug === input.slug);
    if (duplicate) throw new Error("FACULTY_SLUG_EXISTS");
    const now = new Date();
    const faculty: FacultyRecord = { ...input, id: newFirestoreId(), createdAt: now, updatedAt: now };
    await this.faculties.doc(faculty.id).set(cleanFirestoreData(faculty as unknown as Record<string, unknown>));
    return faculty;
  }

  async updateFaculty(id: string, input: Partial<Omit<FacultyRecord, "id" | "createdAt" | "updatedAt">>): Promise<FacultyRecord | null> {
    const faculty = toFirestoreRecord<FacultyRecord>(await this.faculties.doc(id).get());
    if (!faculty) return null;
    const updated: FacultyRecord = { ...faculty, ...input, updatedAt: new Date() };
    await this.faculties.doc(id).set(cleanFirestoreData(updated as unknown as Record<string, unknown>), { merge: false });
    return updated;
  }

  async listFaculties(universityId: string, status?: CatalogStatus): Promise<FacultyRecord[]> {
    return (await getAllFirestoreRecords<FacultyRecord>(this.faculties.where("universityId", "==", universityId)))
      .filter((faculty) => (status ? faculty.status === status : true))
      .sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
  }

  async createDepartment(input: Omit<DepartmentRecord, "id" | "createdAt" | "updatedAt">): Promise<DepartmentRecord> {
    const duplicate = (await getAllFirestoreRecords<DepartmentRecord>(this.departments.where("facultyId", "==", input.facultyId))).find((department) => department.slug === input.slug);
    if (duplicate) throw new Error("DEPARTMENT_SLUG_EXISTS");
    const now = new Date();
    const department: DepartmentRecord = { ...input, id: newFirestoreId(), createdAt: now, updatedAt: now };
    await this.departments.doc(department.id).set(cleanFirestoreData(department as unknown as Record<string, unknown>));
    return department;
  }

  async updateDepartment(id: string, input: Partial<Omit<DepartmentRecord, "id" | "createdAt" | "updatedAt">>): Promise<DepartmentRecord | null> {
    const department = toFirestoreRecord<DepartmentRecord>(await this.departments.doc(id).get());
    if (!department) return null;
    const updated: DepartmentRecord = { ...department, ...input, updatedAt: new Date() };
    await this.departments.doc(id).set(cleanFirestoreData(updated as unknown as Record<string, unknown>), { merge: false });
    return updated;
  }

  async listDepartments(facultyId: string, status?: CatalogStatus): Promise<DepartmentRecord[]> {
    return (await getAllFirestoreRecords<DepartmentRecord>(this.departments.where("facultyId", "==", facultyId)))
      .filter((department) => (status ? department.status === status : true))
      .sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
  }

  private get universities(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("universities");
  }

  private get faculties(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("faculties");
  }

  private get departments(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("departments");
  }
}
