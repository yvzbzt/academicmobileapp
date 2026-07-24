import { Inject, Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import type { AuthRepository } from "../modules/auth/auth.types.js";
import type { CatalogRepository, FacultyRecord, UniversityRecord } from "../modules/catalog/catalog.types.js";
import { FirestoreCatalogRepository } from "../modules/catalog/firestore-catalog.repository.js";
import { PasswordHasher } from "../modules/auth/password-hasher.js";
import { loadBundledTurkiyeCatalogSeed, loadTurkiyeCatalogFromYokAtlas, type CatalogSeedDepartment, type CatalogSeedFaculty, type CatalogSeedUniversity, type TurkiyeCatalogSeed } from "./yok-atlas-catalog-importer.js";

@Injectable()
export class BootstrapSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapSeedService.name);

  constructor(
    @Inject("AuthRepository") private readonly authRepository: AuthRepository,
    @Inject("CatalogRepository") private readonly catalogRepository: CatalogRepository,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher
  ) {}

  async onApplicationBootstrap() {
    const catalog = await this.seedCatalog();
    if ("skippedReason" in catalog && catalog.skippedReason) this.logger.warn(catalog.skippedReason);
    else if ("universities" in catalog) this.logger.log(`Catalog bootstrap ready: ${catalog.universities} universities, ${catalog.faculties} faculties, ${catalog.departments} departments.`);
    if (process.env.BOOTSTRAP_SEED_ENABLED === "true") await this.seedAdminUser();
  }

  async seed() {
    const catalog = await this.seedCatalog();
    const admin = await this.seedAdminUser();
    return { catalog, admin };
  }

  async seedCatalog() {
    if (process.env.BOOTSTRAP_CATALOG_SEED_ENABLED === "false") {
      return { created: false, skippedReason: "Catalog bootstrap is disabled by BOOTSTRAP_CATALOG_SEED_ENABLED=false." };
    }

    try {
      const { source, fallbackReason } = await this.loadCatalogSeedSource();
      if (fallbackReason) this.logger.warn(`Using bundled Turkey catalog seed because live YOK Atlas loading failed: ${fallbackReason}`);
      if (this.catalogRepository instanceof FirestoreCatalogRepository) {
        return this.catalogRepository.seedCatalog(source, process.env.BOOTSTRAP_CATALOG_SEED_REFRESH === "true");
      }

      let createdUniversities = 0;
      let createdFaculties = 0;
      let createdDepartments = 0;
      const universitiesBySlug = new Map((await this.listAllUniversities()).map((university) => [university.slug, university]));

      for (const universitySeed of source.universities) {
        const universityResult = await this.findOrCreateUniversity(universitySeed, universitiesBySlug);
        if (universityResult.created) createdUniversities += 1;
        const facultyCounts = await this.seedFaculties(universityResult.record, universitySeed.faculties);
        createdFaculties += facultyCounts.createdFaculties;
        createdDepartments += facultyCounts.createdDepartments;
      }

      return {
        created: createdUniversities + createdFaculties + createdDepartments > 0,
        source: source.source,
        sourceUrl: source.sourceUrl,
        sourceRowCount: source.sourceRowCount,
        includedRowCount: source.includedRowCount,
        universities: source.universities.length,
        faculties: source.universities.reduce((total, university) => total + university.faculties.length, 0),
        departments: source.universities.reduce((total, university) => total + university.faculties.reduce((facultyTotal, faculty) => facultyTotal + faculty.departments.length, 0), 0),
        createdUniversities,
        createdFaculties,
        createdDepartments
      };
    } catch (error) {
      return {
        created: false,
        skippedReason: `Catalog bootstrap failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async loadCatalogSeedSource(): Promise<{ source: TurkiyeCatalogSeed; fallbackReason?: string }> {
    try {
      const source = await loadTurkiyeCatalogFromYokAtlas(readCatalogSeedTimeoutMs());
      if (source.universities.length === 0) throw new Error("YOK_ATLAS_EMPTY_CATALOG");
      return { source };
    } catch (error) {
      return {
        source: await loadBundledTurkiyeCatalogSeed(),
        fallbackReason: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async seedFaculties(university: UniversityRecord, facultySeeds: CatalogSeedFaculty[]) {
    let createdFaculties = 0;
    let createdDepartments = 0;
    const facultiesBySlug = new Map((await this.catalogRepository.listFaculties(university.id)).map((faculty) => [faculty.slug, faculty]));

    for (const facultySeed of facultySeeds) {
      const facultyResult = await this.findOrCreateFaculty(university.id, facultySeed, facultiesBySlug);
      if (facultyResult.created) createdFaculties += 1;
      createdDepartments += await this.seedDepartments(university.id, facultyResult.record, facultySeed.departments);
    }

    return { createdFaculties, createdDepartments };
  }

  private async seedDepartments(universityId: string, faculty: FacultyRecord, departmentSeeds: CatalogSeedDepartment[]): Promise<number> {
    let createdDepartments = 0;
    const departmentsBySlug = new Set((await this.catalogRepository.listDepartments(faculty.id)).map((department) => department.slug));

    for (const departmentSeed of departmentSeeds) {
      if (departmentsBySlug.has(departmentSeed.slug)) continue;
      try {
        const department = await this.catalogRepository.createDepartment({
          universityId,
          facultyId: faculty.id,
          name: departmentSeed.name,
          slug: departmentSeed.slug,
          educationLevel: departmentSeed.educationLevel,
          status: "active"
        });
        departmentsBySlug.add(department.slug);
        createdDepartments += 1;
      } catch (error) {
        if (!isDuplicateError(error, "DEPARTMENT_SLUG_EXISTS")) throw error;
      }
    }

    return createdDepartments;
  }

  private async findOrCreateUniversity(seed: CatalogSeedUniversity, universitiesBySlug: Map<string, UniversityRecord>): Promise<{ record: UniversityRecord; created: boolean }> {
    const existing = universitiesBySlug.get(seed.slug);
    if (existing) return { record: existing, created: false };
    try {
      const record = await this.catalogRepository.createUniversity({
        name: seed.name,
        slug: seed.slug,
        city: seed.city,
        type: seed.type,
        status: "active"
      });
      universitiesBySlug.set(record.slug, record);
      return { record, created: true };
    } catch (error) {
      if (!isDuplicateError(error, "UNIVERSITY_SLUG_EXISTS")) throw error;
      const duplicate = (await this.listAllUniversities()).find((university) => university.slug === seed.slug);
      if (!duplicate) throw error;
      universitiesBySlug.set(duplicate.slug, duplicate);
      return { record: duplicate, created: false };
    }
  }

  private async findOrCreateFaculty(universityId: string, seed: CatalogSeedFaculty, facultiesBySlug: Map<string, FacultyRecord>): Promise<{ record: FacultyRecord; created: boolean }> {
    const existing = facultiesBySlug.get(seed.slug);
    if (existing) return { record: existing, created: false };
    try {
      const record = await this.catalogRepository.createFaculty({
        universityId,
        name: seed.name,
        slug: seed.slug,
        status: "active"
      });
      facultiesBySlug.set(record.slug, record);
      return { record, created: true };
    } catch (error) {
      if (!isDuplicateError(error, "FACULTY_SLUG_EXISTS")) throw error;
      const duplicate = (await this.catalogRepository.listFaculties(universityId)).find((faculty) => faculty.slug === seed.slug);
      if (!duplicate) throw error;
      facultiesBySlug.set(duplicate.slug, duplicate);
      return { record: duplicate, created: false };
    }
  }

  private async listAllUniversities(): Promise<UniversityRecord[]> {
    const universities: UniversityRecord[] = [];
    const limit = 500;
    for (let offset = 0; ; offset += limit) {
      const page = await this.catalogRepository.listUniversities({ limit, offset });
      universities.push(...page);
      if (page.length < limit) return universities;
    }
  }

  private async seedAdminUser() {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@example.com";
    const existing = await this.authRepository.findUserByEmail(email);
    if (existing) return { userId: existing.id, email: existing.email, created: false };
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!password) return { email, created: false, skippedReason: "BOOTSTRAP_ADMIN_PASSWORD is not configured" };
    const user = await this.authRepository.createUser({
      fullName: process.env.BOOTSTRAP_ADMIN_NAME ?? "System Administrator",
      email,
      passwordHash: await this.passwordHasher.hash(password),
      role: "super_admin",
      status: "active"
    });
    return { userId: user.id, email: user.email, created: true };
  }
}

function readCatalogSeedTimeoutMs(): number {
  const parsed = Number(process.env.BOOTSTRAP_CATALOG_SEED_TIMEOUT_MS ?? 20000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
}

function isDuplicateError(error: unknown, memoryMessage: string): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === memoryMessage || error.message.includes("E11000") || error.message.includes("duplicate key");
}
