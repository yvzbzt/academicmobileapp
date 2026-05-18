import { Inject, Injectable, OnApplicationBootstrap } from "@nestjs/common";
import type { AuthRepository } from "../modules/auth/auth.types.js";
import { PasswordHasher } from "../modules/auth/password-hasher.js";
import type { CatalogRepository } from "../modules/catalog/catalog.types.js";

@Injectable()
export class BootstrapSeedService implements OnApplicationBootstrap {
  constructor(
    @Inject("AuthRepository") private readonly authRepository: AuthRepository,
    @Inject("CatalogRepository") private readonly catalogRepository: CatalogRepository,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher
  ) {}

  async onApplicationBootstrap() {
    if (process.env.BOOTSTRAP_SEED_ENABLED === "true") await this.seed();
  }

  async seed() {
    const catalog = await this.seedSampleCatalog();
    const admin = await this.seedAdminUser();
    return { catalog, admin };
  }

  private async seedSampleCatalog() {
    const existingUniversity = (await this.catalogRepository.listUniversities({ search: "Ankara Ornek Universitesi", status: "active", limit: 10, offset: 0 })).find((university) => university.slug === "ankara-ornek-universitesi");
    if (existingUniversity) return { university: existingUniversity, created: false };
    const university = await this.catalogRepository.createUniversity({
      name: "Ankara Ornek Universitesi",
      slug: "ankara-ornek-universitesi",
      city: "Ankara",
      type: "state",
      status: "active"
    });
    const faculty = await this.catalogRepository.createFaculty({ universityId: university.id, name: "Muhendislik Fakultesi", slug: "muhendislik-fakultesi", status: "active" });
    const department = await this.catalogRepository.createDepartment({
      universityId: university.id,
      facultyId: faculty.id,
      name: "Bilgisayar Muhendisligi",
      slug: "bilgisayar-muhendisligi",
      educationLevel: "bachelor",
      status: "active"
    });
    return { university, faculty, department, created: true };
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
