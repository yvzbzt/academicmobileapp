import { describe, expect, it, vi } from "vitest";
import { findVerifiedUniversitySource, listVerifiedUniversitySources } from "../src/bootstrap/verified-source-registry.js";
import { inferAcademicYear, isAcceptableAcademicYear } from "../src/modules/calendars/calendar-ingestion.service.js";
import { CatalogService } from "../src/modules/catalog/catalog.service.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import { AcademicSourceDiscoveryService } from "../src/modules/source-discovery/academic-source-discovery.service.js";

describe("AcademicSourceDiscoveryService", () => {
  it("loads verified university URLs from the registry file", async () => {
    const sources = await listVerifiedUniversitySources();
    const acibadem = await findVerifiedUniversitySource("acibadem-mehmet-ali-aydinlar-universitesi-istanbul");
    const agri = await findVerifiedUniversitySource("agri-ibrahim-cecen-universitesi");
    const ankara = await findVerifiedUniversitySource("ankara-universitesi");

    expect(sources.length).toBeGreaterThan(0);
    expect(acibadem).toEqual(expect.objectContaining({
      announcementUrl: "https://www.acibadem.edu.tr/duyurular",
      calendarUrl: "https://www.acibadem.edu.tr/ogrenci/ogrenci-isleri/akademik-takvim"
    }));
    expect(agri?.calendarUrl).toContain("2025-2026");
    expect(ankara).toEqual(expect.objectContaining({
      announcementUrl: "https://oidb.ankara.edu.tr/gecmis-duyurular/",
      calendarUrl: "https://oidb.ankara.edu.tr/wp-content/uploads/sites/91/2026/06/2026-2027_Yili_Akademik_Takvimi-SON.pdf"
    }));
    expect(inferAcademicYear([agri?.calendarUrl ?? ""])).toBe("2025-2026");
    expect(isAcceptableAcademicYear("2025-2026", new Date("2026-07-03T00:00:00.000Z"))).toBe(true);
    expect(isAcceptableAcademicYear("2024-2025", new Date("2026-07-03T00:00:00.000Z"))).toBe(false);
  });

  it("builds university, faculty, and department query plans with schedule candidates", async () => {
    const repository = new InMemoryCatalogRepository();
    const catalog = new CatalogService(repository);
    const university = await catalog.createUniversity({
      name: "Test University",
      city: "Istanbul",
      type: "state",
      websiteUrl: "https://test.edu.tr",
      announcementUrl: "https://test.edu.tr/announcements",
      academicCalendarUrl: "https://test.edu.tr/calendar.pdf"
    });
    const faculty = await catalog.createFaculty({
      universityId: university.id,
      name: "Engineering Faculty",
      announcementUrl: "https://eng.test.edu.tr/announcements"
    });
    const department = await catalog.createDepartment({
      universityId: university.id,
      facultyId: faculty.id,
      name: "Computer Engineering",
      educationLevel: "bachelor",
      announcementUrl: "https://ceng.test.edu.tr/announcements",
      courseScheduleUrl: "https://ceng.test.edu.tr/courses.jpg",
      examScheduleUrl: "https://ceng.test.edu.tr/exams.pdf"
    });
    const service = new AcademicSourceDiscoveryService(repository);

    const result = await service.discoverSources({ universityId: university.id });

    expect(result.queryPlan.map((item) => item.query)).toEqual([
      "Test University",
      "Test University Engineering Faculty",
      "Test University Engineering Faculty Computer Engineering"
    ]);
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scopeType: "department",
        scopeId: department.id,
        sourceType: "department_announcement",
        url: "https://ceng.test.edu.tr/announcements"
      }),
      expect.objectContaining({
        scopeType: "department",
        sourceType: "department_exam_schedule",
        url: "https://ceng.test.edu.tr/exams.pdf",
        extractionMethod: "pdf_auto"
      }),
      expect.objectContaining({
        scopeType: "department",
        sourceType: "course_schedule",
        url: "https://ceng.test.edu.tr/courses.jpg",
        extractionMethod: "image_ocr"
      })
    ]));
    expect(result.summary.byType.course_schedule).toBe(1);
    expect(result.summary.byType.department_exam_schedule).toBe(1);
    expect(result.candidates.some((candidate) => candidate.scopeType !== "department" && (candidate.sourceType === "course_schedule" || candidate.sourceType === "department_exam_schedule"))).toBe(false);
    expect(result.candidates.some((candidate) => candidate.scopeType !== "university" && candidate.sourceType === "academic_calendar")).toBe(false);
  });

  it("filters stale source candidates before they reach the URL export list", async () => {
    const repository = new InMemoryCatalogRepository();
    const catalog = new CatalogService(repository);
    const university = await catalog.createUniversity({
      name: "Agri Ibrahim Cecen Universitesi",
      city: "Agri",
      type: "state",
      websiteUrl: "https://www.agri.edu.tr",
      academicCalendarUrl: "https://www.agri.edu.tr/upload/2022-2023-akademik-takvim.pdf"
    });
    const service = new AcademicSourceDiscoveryService(repository);

    const result = await service.discoverSources({ universityId: university.id });

    expect(result.candidates.some((candidate) => /2022|2023|2024/u.test(candidate.url) && candidate.sourceType !== "homepage")).toBe(false);
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "homepage", url: "https://www.agri.edu.tr/" })
    ]));
  });

  it("uses Ankara University's official directory to discover law faculty schedule sources", async () => {
    const repository = new InMemoryCatalogRepository();
    const catalog = new CatalogService(repository);
    const university = await catalog.createUniversity({
      name: "ANKARA ÜNİVERSİTESİ",
      city: "Ankara",
      type: "state",
      websiteUrl: "https://www.ankara.edu.tr",
      announcementUrl: "https://oidb.ankara.edu.tr/gecmis-duyurular/",
      academicCalendarUrl: "https://oidb.ankara.edu.tr/wp-content/uploads/sites/91/2026/06/2026-2027_Yili_Akademik_Takvimi-SON.pdf"
    });
    const faculty = await catalog.createFaculty({
      universityId: university.id,
      name: "Hukuk Fakültesi"
    });
    const department = await catalog.createDepartment({
      universityId: university.id,
      facultyId: faculty.id,
      name: "Hukuk",
      educationLevel: "bachelor"
    });
    const htmlByUrl = new Map([
      ["https://www.ankara.edu.tr/akademik-ve-idari-birimler/Fakulteler", `
        <a href="/akademik-ve-idari-birimler/Fakulteler/hukuk-fakultesi">Hukuk Fakültesi</a>
      `],
      ["https://www.ankara.edu.tr/akademik-ve-idari-birimler/Fakulteler/hukuk-fakultesi", `
        <a href="https://www.law.ankara.edu.tr/">Website</a>
      `],
      ["https://www.law.ankara.edu.tr/", `
        <a href="/duyurular/">Duyurular</a>
        <a href="/ders-programi/">Ders Programı</a>
        <a href="/sinavlar/">Sınavlar</a>
      `],
      ["https://www.law.ankara.edu.tr/ders-programi/", `
        <a href="/wp-content/uploads/sites/190/2026/02/1.-SINIF.jpg">1. sınıf</a>
        <img src="/wp-content/uploads/sites/190/2026/02/2.-SINIF.jpg" alt="2. sınıf ders programı" />
      `]
    ]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const text = htmlByUrl.get(url);
      if (text === undefined) return new Response("not found", { status: 404, statusText: "Not Found" });
      return new Response(text, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    });

    try {
      const service = new AcademicSourceDiscoveryService(repository);
      const result = await service.discoverSources({ universityId: university.id });

      expect(result.candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          discoveryMethod: "official_directory",
          scopeType: "faculty",
          scopeId: faculty.id,
          sourceType: "homepage",
          url: "https://www.law.ankara.edu.tr/"
        }),
        expect.objectContaining({
          discoveryMethod: "official_directory",
          scopeType: "department",
          scopeId: department.id,
          sourceType: "course_schedule",
          url: "https://www.law.ankara.edu.tr/ders-programi/"
        }),
        expect.objectContaining({
          discoveryMethod: "official_directory",
          scopeType: "department",
          scopeId: department.id,
          sourceType: "course_schedule",
          url: "https://www.law.ankara.edu.tr/wp-content/uploads/sites/190/2026/02/1.-SINIF.jpg",
          extractionMethod: "image_ocr"
        }),
        expect.objectContaining({
          discoveryMethod: "official_directory",
          scopeType: "department",
          scopeId: department.id,
          sourceType: "course_schedule",
          url: "https://www.law.ankara.edu.tr/wp-content/uploads/sites/190/2026/02/2.-SINIF.jpg",
          extractionMethod: "image_ocr"
        }),
        expect.objectContaining({
          discoveryMethod: "official_directory",
          scopeType: "department",
          scopeId: department.id,
          sourceType: "department_exam_schedule",
          url: "https://www.law.ankara.edu.tr/sinavlar/"
        }),
        expect.objectContaining({
          scopeType: "university",
          sourceType: "academic_calendar",
          url: "https://oidb.ankara.edu.tr/wp-content/uploads/sites/91/2026/06/2026-2027_Yili_Akademik_Takvimi-SON.pdf"
        })
      ]));
      expect(result.candidates.some((candidate) => candidate.scopeType !== "university" && candidate.sourceType === "academic_calendar")).toBe(false);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
