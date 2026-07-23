import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnouncementIngestionService, discoverAnnouncementSourceForUniversity } from "../src/modules/announcements/announcement-ingestion.service.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { fetchSourceItems, parseHtmlAnchors } from "../src/modules/announcements/announcement-parser.js";
import { AnnouncementsService } from "../src/modules/announcements/announcements.service.js";
import type { AuthRepository, AuthUserRecord } from "../src/modules/auth/auth.types.js";
import type { CatalogRepository, UniversityRecord } from "../src/modules/catalog/catalog.types.js";

const sampleUniversity: UniversityRecord = {
  id: "u-agu",
  name: "ABDULLAH GÜL ÜNİVERSİTESİ (KAYSERİ)",
  slug: "abdullah-gul-universitesi-kayseri",
  city: "KAYSERİ",
  type: "state",
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date()
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("announcement discovery and ingestion", () => {
  it("discovers a university announcement page and parses items", async () => {
    stubFetch({
      "https://agu.edu.tr": `<html><title>Abdullah Gül Üniversitesi</title><body><a href="/duyurular">Duyurular</a></body></html>`,
      "https://agu.edu.tr/duyurular": `<html><body><a href="/duyuru/1">Yeni öğrenci duyurusu</a><a href="/duyuru/2">Akademik takvim duyurusu</a></body></html>`
    });

    const result = await discoverAnnouncementSourceForUniversity(sampleUniversity, { timeoutMs: 1000 });

    expect(result.status).toBe("source_found");
    expect(result.sourceUrl).toBe("https://agu.edu.tr/duyurular");
    expect(result.itemCount).toBe(2);
  });

  it("stores fetched announcement items in the repository cache", async () => {
    stubFetch({
      "https://agu.edu.tr/duyurular": `<html><body><a href="/duyuru/1">Yeni öğrenci duyurusu</a></body></html>`
    });
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: "AGU Duyurular",
      sourceUrl: "https://agu.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active"
    });
    const service = new AnnouncementIngestionService(createCatalogRepository([sampleUniversity]), repository);

    const result = await service.runIngestion();
    const items = await repository.listItemsByScope({ universityId: sampleUniversity.id, limit: 10 });

    expect(result.summary.healthy).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({ sourceId: source.id, title: "Yeni öğrenci duyurusu" }));
  });

  it("loads ATU hash-route announcements from the university OData service", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname.endsWith("/Siteler")) {
        expect(url.searchParams.get("$filter")).toContain("AlanAdi eq 'www'");
        return Response.json({ d: [{ ID: 1 }] });
      }
      if (url.pathname.endsWith("/V_GuncelIcerik")) {
        expect(url.searchParams.get("$filter")).toContain("GrupTipi eq 2");
        return Response.json({
          d: [{
            GuID: "ede0278f-9f26-4b6a-96e5-ee10c516ba27",
            Baslik: "2026-2027 Egitim-Ogretim Yili Yatay Gecis Duyurusu",
            AltBaslik: "Basvurular acildi.",
            HTMLicerik: '<a href="https://ogrenci.atu.edu.tr/#!/duyuru/d98b041b-e0f2-4704-bd22-b51944c1ea47">Detay</a>',
            BaslamaTarihi: "/Date(1783641600000)/"
          }]
        });
      }
      return new Response("not found", { status: 404 });
    }));

    const items = await fetchSourceItems("https://www.atu.edu.tr/#!/TR/duyurular/", "auto", 1000);

    expect(items).toEqual([expect.objectContaining({
      title: "2026-2027 Egitim-Ogretim Yili Yatay Gecis Duyurusu",
      link: "https://ogrenci.atu.edu.tr/#!/duyuru/d98b041b-e0f2-4704-bd22-b51944c1ea47",
      summary: "Basvurular acildi.",
      publishedAt: new Date(1783641600000)
    })]);
  });

  it("returns university, faculty, and department announcements in the student announcement feed", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const fetchedAt = new Date().toISOString();
    const universitySource = await repository.upsertSource({
      scopeType: "university",
      scopeId: sampleUniversity.id,
      sourceName: "University Announcements",
      sourceUrl: "https://agu.edu.tr/duyurular",
      parser: "auto",
      priority: 20,
      status: "active"
    });
    const facultySource = await repository.upsertSource({
      scopeType: "faculty",
      scopeId: "faculty-1",
      sourceName: "Faculty Announcements",
      sourceUrl: "https://faculty.agu.edu.tr/duyurular",
      parser: "auto",
      priority: 30,
      status: "active"
    });
    const departmentSource = await repository.upsertSource({
      scopeType: "department",
      scopeId: "department-1",
      sourceName: "Department Announcements",
      sourceUrl: "https://department.agu.edu.tr/duyurular",
      parser: "auto",
      priority: 40,
      status: "active"
    });

    await repository.replaceItemsForSource(universitySource, [{
      id: "university-announcement",
      sourceId: universitySource.id,
      sourceName: universitySource.sourceName,
      scopeType: "university",
      scopeId: sampleUniversity.id,
      title: "University registration announcement",
      link: "https://agu.edu.tr/duyuru/university",
      fetchedAt
    }]);
    await repository.replaceItemsForSource(facultySource, [{
      id: "faculty-announcement",
      sourceId: facultySource.id,
      sourceName: facultySource.sourceName,
      scopeType: "faculty",
      scopeId: "faculty-1",
      title: "Faculty orientation announcement",
      link: "https://faculty.agu.edu.tr/duyuru/faculty",
      fetchedAt
    }]);
    await repository.replaceItemsForSource(departmentSource, [{
      id: "department-announcement",
      sourceId: departmentSource.id,
      sourceName: departmentSource.sourceName,
      scopeType: "department",
      scopeId: "department-1",
      title: "Department exam announcement",
      link: "https://department.agu.edu.tr/duyuru/department",
      fetchedAt
    }]);

    const service = new AnnouncementsService(createAuthRepository(), repository, createCatalogRepository([sampleUniversity]));

    const result = await service.getMyAnnouncements("student-1", 10);

    expect(result).toHaveLength(3);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scopeType: "university",
        scopeId: sampleUniversity.id,
        title: "University registration announcement"
      }),
      expect.objectContaining({
        scopeType: "faculty",
        scopeId: "faculty-1",
        title: "Faculty orientation announcement"
      }),
      expect.objectContaining({
        scopeType: "department",
        scopeId: "department-1",
        title: "Department exam announcement"
      })
    ]));
  });

  it("prefers leading listing dates over later deadline dates", () => {
    const items = parseHtmlAnchors(
      `<a href="/duyuru/1">22.06.2026 Öğrenci SÜYÖS-2026 tercihleri 22-Haziran-10 Temmuz 2026 tarihleri arasında yapılacaktır</a>`,
      "https://selcuk.edu.tr/icerik/ogrenciduyurulari"
    );

    expect(items[0]?.publishedAt?.toISOString()).toBe("2026-06-22T00:00:00.000Z");
  });

  it("ignores share links even when the listing URL contains an announcement keyword", () => {
    const items = parseHtmlAnchors(
      `<a href="#">WhatsApp</a><a href="/duyuru/1">22.06.2026 Ogrenci tercih duyurusu</a>`,
      "https://selcuk.edu.tr/icerik/ogrenciduyurulari"
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toContain("tercih duyurusu");
  });

  it("ignores pagination and navigation anchors", () => {
    const items = parseHtmlAnchors(
      [
        `<a href="/duyurular?page=2">Next</a>`,
        `<a href="/duyuru/2">Read more</a>`,
        `<a href="/duyurular/all">Show more</a>`,
        `<a href="/duyuru/1">22.06.2026 Ogrenci sinav duyurusu</a>`
      ].join(""),
      "https://selcuk.edu.tr/icerik/ogrenciduyurulari"
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toContain("sinav duyurusu");
  });

  it("drops stale formation announcement artifacts from previous academic years", () => {
    const items = parseHtmlAnchors(
      [
        `<a href="/detail.aspx?id=56247">2022-2023 Bahar Donemi Formasyon Tek Ders Sinav Duyurusu</a>`,
        `<a href="/upload/egitim/formasyon-2023.docx">Pedagojik Formasyon Sertifika Programi 2022-2023 Bahar Donemi Akademik Takvimi Duyurusu</a>`,
        `<a href="/upload/egitim/formasyon-2024.xlsx">2024 Formasyon Ders Programi Duyurusu</a>`,
        `<a href="/detail.aspx?id=70000">2026-2027 Akademik Takvim Duyurusu</a>`
      ].join(""),
      "https://www.agri.edu.tr/haberduyuru.aspx?bid=1&tid=2"
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      title: "2026-2027 Akademik Takvim Duyurusu",
      link: "https://www.agri.edu.tr/detail.aspx?id=70000"
    }));
  });
});

function stubFetch(pages: Record<string, string>): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
    const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    const normalized = requestUrl.replace(/\/$/u, "");
    const body = pages[normalized];
    return new Response(body ?? "<html></html>", { status: body ? 200 : 404 });
  }));
}

function createCatalogRepository(universities: UniversityRecord[]): CatalogRepository {
  return {
    async createUniversity() {
      throw new Error("not used");
    },
    async updateUniversity() {
      throw new Error("not used");
    },
    async archiveUniversity() {
      throw new Error("not used");
    },
    async findUniversityById(id: string) {
      return universities.find((university) => university.id === id) ?? null;
    },
    async listUniversities(input) {
      return universities.slice(input.offset, input.offset + input.limit);
    },
    async findUniversityByEmailDomain() {
      return null;
    },
    async createFaculty() {
      throw new Error("not used");
    },
    async updateFaculty() {
      throw new Error("not used");
    },
    async listFaculties() {
      return [];
    },
    async createDepartment() {
      throw new Error("not used");
    },
    async updateDepartment() {
      throw new Error("not used");
    },
    async listDepartments() {
      return [];
    }
  };
}

function createAuthRepository(): AuthRepository {
  const now = new Date();
  const user: AuthUserRecord = {
    id: "student-1",
    fullName: "Student",
    email: "student@agu.edu.tr",
    passwordHash: "hash",
    role: "student",
    universityId: sampleUniversity.id,
    facultyId: "faculty-1",
    departmentId: "department-1",
    status: "active",
    createdAt: now,
    updatedAt: now
  };

  return {
    async findUserById(id: string) {
      return id === user.id ? user : null;
    }
  } as unknown as AuthRepository;
}
