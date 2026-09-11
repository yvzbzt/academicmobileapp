import { NotFoundException } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mergeYok208ActiveInstitutions } from "../src/bootstrap/yok-active-institution-supplement.js";
import { buildTurkiyeCatalogFromYokAtlasRows, loadBundledTurkiyeCatalogSeed, type TurkiyeCatalogSeed } from "../src/bootstrap/yok-atlas-catalog-importer.js";
import { planCacheInvalidation } from "../src/cache/cache-invalidation.js";
import { CatalogService } from "../src/modules/catalog/catalog.service.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import { buildNullableCatalogMongoUpdate } from "../src/modules/catalog/mongo-catalog.repository.js";
import type { VerifiedSourceUrlFill } from "../src/modules/catalog/catalog.types.js";
import { createSlug } from "../src/modules/catalog/slug.js";

const verifiedSourceRegistry = vi.hoisted(() => ({
  listVerifiedUniversitySources: vi.fn<() => Promise<unknown[]>>(),
  listVerifiedAcademicUnitSources: vi.fn<() => Promise<unknown[]>>()
}));

vi.mock("../src/bootstrap/verified-source-registry.js", () => verifiedSourceRegistry);

beforeEach(() => {
  verifiedSourceRegistry.listVerifiedUniversitySources.mockReset().mockResolvedValue([]);
  verifiedSourceRegistry.listVerifiedAcademicUnitSources.mockReset().mockResolvedValue([]);
});

class InterleavingCatalogRepository extends InMemoryCatalogRepository {
  private interleaved = false;

  constructor(private readonly interleave: (input: VerifiedSourceUrlFill) => Promise<void>) {
    super();
  }

  override async compareAndFillVerifiedSourceUrl(input: VerifiedSourceUrlFill): Promise<boolean> {
    if (!this.interleaved) {
      this.interleaved = true;
      await this.interleave(input);
    }
    return super.compareAndFillVerifiedSourceUrl(input);
  }
}

describe("createSlug", () => {
  it("creates stable Turkish-safe slugs", () => {
    expect(createSlug("İstanbul Şehir Üniversitesi")).toBe("istanbul-sehir-universitesi");
    expect(createSlug("Mühendislik Fakültesi")).toBe("muhendislik-fakultesi");
  });
});

describe("CatalogService", () => {
  it("uses Mongo $unset when an administrator clears a source URL", () => {
    expect(buildNullableCatalogMongoUpdate({
      name: "Updated",
      websiteUrl: undefined,
      announcementUrl: null,
      examScheduleUrl: null
    })).toEqual({
      $set: { name: "Updated" },
      $unset: { announcementUrl: 1, examScheduleUrl: 1 }
    });
  });

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
    await expect(service.listUniversities({ search: "Ege Test" })).resolves.toEqual([
      expect.objectContaining({ id: university.id, name: university.name, status: "active" })
    ]);
    await expect(service.listFaculties(university.id)).resolves.toEqual([
      expect.objectContaining({ id: faculty.id, universityId: university.id, status: "active" })
    ]);
    await expect(service.listDepartments(faculty.id)).resolves.toEqual([
      expect.objectContaining({ id: department.id, facultyId: faculty.id, status: "active" })
    ]);
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

    const clearedUniversity = await service.updateUniversity(university.id, {
      announcementUrl: null,
      academicCalendarUrl: null
    });
    const clearedFaculty = await service.updateFaculty(faculty.id, { announcementUrl: null });
    const clearedDepartment = await service.updateDepartment(department.id, {
      websiteUrl: null,
      announcementUrl: null,
      courseScheduleUrl: null,
      examScheduleUrl: null
    });
    expect(clearedUniversity).not.toHaveProperty("announcementUrl");
    expect(clearedUniversity).not.toHaveProperty("academicCalendarUrl");
    expect(clearedFaculty).not.toHaveProperty("announcementUrl");
    expect(clearedDepartment).not.toHaveProperty("websiteUrl");
    expect(clearedDepartment).not.toHaveProperty("announcementUrl");
    expect(clearedDepartment).not.toHaveProperty("courseScheduleUrl");
    expect(clearedDepartment).not.toHaveProperty("examScheduleUrl");
  });

  it.each(["university", "faculty", "department"] as const)(
    "does not overwrite a concurrent administrator URL change for a %s",
    async (scopeType) => {
      const verifiedUrl = `https://verified.example.edu.tr/${scopeType}`;
      const administratorUrl = `https://admin.example.edu.tr/${scopeType}`;
      let universityId = "";
      let facultyId = "";
      let departmentId = "";
      const repository = new InterleavingCatalogRepository(async () => {
        if (scopeType === "university") {
          await repository.updateUniversity(universityId, { announcementUrl: administratorUrl });
        } else if (scopeType === "faculty") {
          await repository.updateFaculty(facultyId, { websiteUrl: administratorUrl });
        } else {
          await repository.updateDepartment(departmentId, { examScheduleUrl: administratorUrl });
        }
      });
      const service = new CatalogService(repository);
      const university = await service.createUniversity({ name: `${scopeType} Race University`, city: "Ankara", type: "state" });
      universityId = university.id;
      const faculty = await service.createFaculty({ universityId, name: `${scopeType} Race Faculty` });
      facultyId = faculty.id;
      const department = await service.createDepartment({
        universityId,
        facultyId,
        name: `${scopeType} Race Department`,
        educationLevel: "bachelor"
      });
      departmentId = department.id;

      if (scopeType === "university") {
        verifiedSourceRegistry.listVerifiedUniversitySources.mockResolvedValue([{
          universityId,
          universityName: university.name,
          announcementUrl: verifiedUrl,
          verificationByField: { announcementUrl: { finalUrl: verifiedUrl } }
        }]);
      } else if (scopeType === "faculty") {
        verifiedSourceRegistry.listVerifiedAcademicUnitSources.mockResolvedValue([{
          scopeType,
          universityId,
          facultyId,
          websiteUrl: verifiedUrl,
          verificationByField: { websiteUrl: { finalUrl: verifiedUrl } }
        }]);
      } else {
        verifiedSourceRegistry.listVerifiedAcademicUnitSources.mockResolvedValue([{
          scopeType,
          universityId,
          facultyId,
          departmentId,
          examScheduleUrl: verifiedUrl,
          verificationByField: { examScheduleUrl: { finalUrl: verifiedUrl } }
        }]);
      }

      await expect(service.syncFinalVerifiedSourceRegistry()).resolves.toEqual(expect.objectContaining({
        examinedEvidence: 1,
        filled: 0,
        unchanged: 0,
        conflicts: 1,
        conflictSamples: [{
          scopeType,
          scopeId: scopeType === "university" ? universityId : scopeType === "faculty" ? facultyId : departmentId,
          field: scopeType === "university" ? "announcementUrl" : scopeType === "faculty" ? "websiteUrl" : "examScheduleUrl",
          reason: "concurrent_change"
        }]
      }));

      if (scopeType === "university") {
        await expect(repository.findUniversityById(universityId)).resolves.toEqual(expect.objectContaining({ announcementUrl: administratorUrl }));
      } else if (scopeType === "faculty") {
        await expect(repository.listFaculties(universityId)).resolves.toEqual([
          expect.objectContaining({ id: facultyId, websiteUrl: administratorUrl })
        ]);
      } else {
        await expect(repository.listDepartments(facultyId)).resolves.toEqual([
          expect.objectContaining({ id: departmentId, examScheduleUrl: administratorUrl })
        ]);
      }
    }
  );

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

  it("reconciles the legacy 205-record seed to YÖK's active 208 idempotently", async () => {
    const checkedIn = JSON.parse(await readFile("apps/api/src/bootstrap/turkiye-catalog-seed.json", "utf8")) as TurkiyeCatalogSeed;
    const supplementalIds = new Set(checkedIn.activeInstitutionSupplement?.universityIds ?? []);
    const legacy = structuredClone(checkedIn);
    legacy.universities = legacy.universities.filter((university) => !supplementalIds.has(university.slug));
    delete legacy.activeInstitutionSupplement;
    const renamedKonak = legacy.universities.find((university) => university.slug === "izmir-kavram-meslek-yuksekokulu");
    if (!renamedKonak) throw new Error("TEST_KONAK_RECORD_MISSING");
    renamedKonak.slug = "izmir-konak-meslek-yuksekokulu";
    const renamedSchool = renamedKonak.faculties.find((faculty) => faculty.slug === "izmir-kavram-meslek-yuksekokulu");
    if (renamedSchool) renamedSchool.slug = "izmir-konak-meslek-yuksekokulu";

    const merged = mergeYok208ActiveInstitutions(legacy);
    const once = JSON.stringify(merged);
    const byId = new Map(merged.universities.map((university) => [university.slug, university]));

    expect(merged.universities).toHaveLength(208);
    expect(merged.activeInstitutionSupplement?.expectedCounts).toEqual({
      total: 208,
      stateUniversities: 129,
      foundationUniversities: 75,
      foundationVocationalSchools: 4
    });
    expect(byId.get("anka-teknoloji-universitesi")).not.toHaveProperty("websiteUrl");
    expect(byId.get("turk-japon-bilim-ve-teknoloji-universitesi")).toEqual(expect.objectContaining({
      websiteUrl: "https://www.tju.edu.tr/"
    }));
    expect(byId.get("turkiye-uluslararasi-islam-bilim-ve-teknoloji-universitesi")).toEqual(expect.objectContaining({
      websiteUrl: "https://www.tibu.edu.tr/"
    }));
    expect(byId.has("izmir-konak-meslek-yuksekokulu")).toBe(false);
    expect(byId.get("izmir-kavram-meslek-yuksekokulu")).toEqual(expect.objectContaining({
      name: "İZMİR KONAK MESLEK YÜKSEKOKULU",
      websiteUrl: "https://www.konak.edu.tr/",
      faculties: expect.arrayContaining([
        expect.objectContaining({ name: "İzmir Konak Meslek Yüksekokulu", slug: "izmir-kavram-meslek-yuksekokulu" })
      ])
    }));
    expect(JSON.stringify(mergeYok208ActiveInstitutions(merged))).toBe(once);
  });

  it("applies the same YÖK 208 reconciliation to the bundled runtime loader", async () => {
    const bundled = await loadBundledTurkiyeCatalogSeed();

    expect(bundled.universities).toHaveLength(208);
    expect(bundled.activeInstitutionSupplement?.universityIds).toEqual([
      "anka-teknoloji-universitesi",
      "turk-japon-bilim-ve-teknoloji-universitesi",
      "turkiye-uluslararasi-islam-bilim-ve-teknoloji-universitesi"
    ]);
  });
});

describe("planCacheInvalidation", () => {
  it("plans catalog cache invalidation keys", () => {
    expect(planCacheInvalidation({ type: "university.updated", universityId: "u1" })).toEqual(["universities:all", "university:u1"]);
    expect(planCacheInvalidation({ type: "faculty.created", universityId: "u1" })).toEqual(["university:u1:faculties"]);
    expect(planCacheInvalidation({ type: "department.created", facultyId: "f1" })).toEqual(["faculty:f1:departments"]);
  });
});
