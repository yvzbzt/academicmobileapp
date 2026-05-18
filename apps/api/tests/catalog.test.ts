import { describe, expect, it } from "vitest";
import { planCacheInvalidation } from "../src/cache/cache-invalidation.js";
import { CatalogService } from "../src/modules/catalog/catalog.service.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import { createSlug } from "../src/modules/catalog/slug.js";

describe("createSlug", () => {
  it("creates stable Turkish-safe slugs", () => {
    expect(createSlug("İstanbul Şehir Üniversitesi")).toBe("istanbul-sehir-universitesi");
    expect(createSlug("Mühendislik Fakültesi")).toBe("muhendislik-fakultesi");
  });
});

describe("CatalogService", () => {
  it("lists seeded active universities for public selection", async () => {
    const service = new CatalogService(new InMemoryCatalogRepository());

    const universities = await service.listUniversities({});

    expect(universities.length).toBeGreaterThan(0);
    expect(universities.every((university) => university.status === "active")).toBe(true);
  });

  it("creates university, faculty and department", async () => {
    const service = new CatalogService(new InMemoryCatalogRepository());
    const university = await service.createUniversity({
      name: "Ege Test Universitesi",
      city: "Izmir",
      type: "state"
    });
    const faculty = await service.createFaculty({ universityId: university.id, name: "Fen Fakultesi" });
    const department = await service.createDepartment({
      universityId: university.id,
      facultyId: faculty.id,
      name: "Matematik",
      educationLevel: "bachelor"
    });

    expect(university.slug).toBe("ege-test-universitesi");
    expect(faculty.universityId).toBe(university.id);
    expect(department.facultyId).toBe(faculty.id);
  });

  it("archives universities instead of hard deleting", async () => {
    const service = new CatalogService(new InMemoryCatalogRepository());
    const university = await service.createUniversity({ name: "Archive Test", city: "Ankara", type: "foundation" });

    const archived = await service.archiveUniversity(university.id);

    expect(archived.status).toBe("archived");
  });
});

describe("planCacheInvalidation", () => {
  it("plans catalog cache invalidation keys", () => {
    expect(planCacheInvalidation({ type: "university.updated", universityId: "u1" })).toEqual(["universities:all", "university:u1"]);
    expect(planCacheInvalidation({ type: "faculty.created", universityId: "u1" })).toEqual(["university:u1:faculties"]);
    expect(planCacheInvalidation({ type: "department.created", facultyId: "f1" })).toEqual(["faculty:f1:departments"]);
  });
});
