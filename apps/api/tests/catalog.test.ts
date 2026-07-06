import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { buildTurkiyeCatalogFromYokAtlasRows } from "../src/bootstrap/yok-atlas-catalog-importer.js";
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
  it("starts with no seeded universities for public selection", async () => {
    const service = new CatalogService(new InMemoryCatalogRepository());

    const universities = await service.listUniversities({});

    expect(universities).toEqual([]);
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

  it("updates source URLs according to the university/faculty/department hierarchy", async () => {
    const service = new CatalogService(new InMemoryCatalogRepository());
    const university = await service.createUniversity({ name: "Manual Source University", city: "Ankara", type: "state" });
    const faculty = await service.createFaculty({ universityId: university.id, name: "Engineering Faculty" });
    const department = await service.createDepartment({
      universityId: university.id,
      facultyId: faculty.id,
      name: "Computer Engineering",
      educationLevel: "bachelor"
    });

    const updatedUniversity = await service.updateUniversity(university.id, {
      announcementUrl: "https://example.edu.tr/announcements",
      academicCalendarUrl: "https://example.edu.tr/calendar.pdf"
    });
    const updatedFaculty = await service.updateFaculty(faculty.id, {
      websiteUrl: "https://engineering.example.edu.tr",
      announcementUrl: "https://engineering.example.edu.tr/announcements"
    });
    const updatedDepartment = await service.updateDepartment(department.id, {
      websiteUrl: "https://ceng.example.edu.tr",
      announcementUrl: "https://ceng.example.edu.tr/announcements",
      courseScheduleUrl: "https://ceng.example.edu.tr/courses.pdf",
      examScheduleUrl: "https://ceng.example.edu.tr/exams.pdf"
    });

    expect(updatedUniversity.academicCalendarUrl).toBe("https://example.edu.tr/calendar.pdf");
    expect(updatedFaculty).toEqual(expect.objectContaining({
      websiteUrl: "https://engineering.example.edu.tr",
      announcementUrl: "https://engineering.example.edu.tr/announcements"
    }));
    expect("courseScheduleUrl" in updatedFaculty).toBe(false);
    expect(updatedDepartment.websiteUrl).toBe("https://ceng.example.edu.tr");
    expect(updatedDepartment.courseScheduleUrl).toBe("https://ceng.example.edu.tr/courses.pdf");
    expect(updatedDepartment.examScheduleUrl).toBe("https://ceng.example.edu.tr/exams.pdf");
  });

  it("rejects departments attached to a faculty from another university", async () => {
    const service = new CatalogService(new InMemoryCatalogRepository());
    const university = await service.createUniversity({ name: "Scope University", city: "Ankara", type: "state" });
    const otherUniversity = await service.createUniversity({ name: "Other Scope University", city: "Izmir", type: "state" });
    const otherFaculty = await service.createFaculty({ universityId: otherUniversity.id, name: "Other Faculty" });

    await expect(service.createDepartment({
      universityId: university.id,
      facultyId: otherFaculty.id,
      name: "Misplaced Department",
      educationLevel: "bachelor"
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("archives universities instead of hard deleting", async () => {
    const service = new CatalogService(new InMemoryCatalogRepository());
    const university = await service.createUniversity({ name: "Archive Test", city: "Ankara", type: "foundation" });

    const archived = await service.archiveUniversity(university.id);

    expect(archived.status).toBe("archived");
  });
});

describe("buildTurkiyeCatalogFromYokAtlasRows", () => {
  it("groups Turkey universities, faculties and departments from YOK Atlas rows", () => {
    const catalog = buildTurkiyeCatalogFromYokAtlasRows([
      {
        universiteId: 1,
        universiteAdi: "ANKARA TEST UNIVERSITESI",
        uniIlKodu: 6,
        uniIlAdi: "ANKARA",
        universiteTuru: "DEVLET",
        fymkAdi: "Engineering Faculty",
        birimGrupAdi: "Computer Engineering",
        birimTuruAdi: "LISANS"
      },
      {
        universiteId: 1,
        universiteAdi: "ANKARA TEST UNIVERSITESI",
        uniIlKodu: 6,
        uniIlAdi: "ANKARA",
        universiteTuru: "DEVLET",
        fymkAdi: "Engineering Faculty",
        birimGrupAdi: "Computer Engineering",
        birimTuruAdi: "LISANS"
      },
      {
        universiteId: 2,
        universiteAdi: "OVERSEAS TEST UNIVERSITY",
        uniIlKodu: 900,
        uniIlAdi: "OVERSEAS",
        universiteTuru: "VAKIF",
        fymkAdi: "Faculty",
        birimGrupAdi: "Program",
        birimTuruAdi: "LISANS"
      }
    ]);

    expect(catalog.includedRowCount).toBe(2);
    expect(catalog.universities).toHaveLength(1);
    expect(catalog.universities[0]).toEqual(expect.objectContaining({ name: "ANKARA TEST UNIVERSITESI", city: "ANKARA", type: "state" }));
    expect(catalog.universities[0]?.faculties[0]?.departments).toEqual([{ name: "Computer Engineering", slug: "computer-engineering", educationLevel: "bachelor" }]);
  });
});

describe("planCacheInvalidation", () => {
  it("plans catalog cache invalidation keys", () => {
    expect(planCacheInvalidation({ type: "university.updated", universityId: "u1" })).toEqual(["universities:all", "university:u1"]);
    expect(planCacheInvalidation({ type: "faculty.created", universityId: "u1" })).toEqual(["university:u1:faculties"]);
    expect(planCacheInvalidation({ type: "department.created", facultyId: "f1" })).toEqual(["faculty:f1:departments"]);
  });
});
