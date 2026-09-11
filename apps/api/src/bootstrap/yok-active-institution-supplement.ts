import type { EducationLevel, UniversityType } from "../modules/catalog/catalog.types.js";

export interface CatalogSeedDepartment {
  name: string;
  slug: string;
  educationLevel: EducationLevel;
}

export interface CatalogSeedFaculty {
  name: string;
  slug: string;
  departments: CatalogSeedDepartment[];
}

export interface CatalogSeedUniversity {
  name: string;
  slug: string;
  city: string;
  type: UniversityType;
  websiteUrl?: string;
  faculties: CatalogSeedFaculty[];
}

export interface ActiveInstitutionSupplement {
  source: "YOK_UNIVERSITY_MONITORING_AND_EVALUATION_GENERAL_REPORT_2025";
  sourceUrl: string;
  referenceAcademicYear: "2023-2024";
  expectedCounts: {
    total: 208;
    stateUniversities: 129;
    foundationUniversities: 75;
    foundationVocationalSchools: 4;
  };
  universityIds: string[];
}

export interface TurkiyeCatalogSeed {
  source: "yok_atlas";
  sourceUrl: string;
  sourceRowCount: number;
  includedRowCount: number;
  activeInstitutionSupplement?: ActiveInstitutionSupplement;
  universities: CatalogSeedUniversity[];
}

export const yok2025ActiveInstitutionReportUrl =
  "https://veriyonetim.yok.gov.tr/documentFiles/1766133304915.2025-universite-izleme-ve-degerlendirme-genel-raporu.pdf";

export const izmirKonakStableUniversityId = "izmir-kavram-meslek-yuksekokulu";
const izmirKonakCurrentUniversityId = "izmir-konak-meslek-yuksekokulu";
const izmirKonakCurrentName = "İZMİR KONAK MESLEK YÜKSEKOKULU";
const izmirKonakWebsiteUrl = "https://www.konak.edu.tr/";

const supplementalUniversities: readonly CatalogSeedUniversity[] = [
  {
    name: "ANKA TEKNOLOJİ ÜNİVERSİTESİ",
    slug: "anka-teknoloji-universitesi",
    city: "ANKARA",
    type: "foundation",
    faculties: []
  },
  {
    name: "TÜRK-JAPON BİLİM VE TEKNOLOJİ ÜNİVERSİTESİ",
    slug: "turk-japon-bilim-ve-teknoloji-universitesi",
    city: "ANKARA",
    type: "state",
    websiteUrl: "https://www.tju.edu.tr/",
    faculties: [
      {
        name: "Mühendislik Fakültesi",
        slug: "muhendislik-fakultesi",
        departments: [
          { name: "Bilgisayar Mühendisliği", slug: "bilgisayar-muhendisligi", educationLevel: "bachelor" },
          { name: "Çevre Mühendisliği", slug: "cevre-muhendisligi", educationLevel: "bachelor" },
          { name: "Elektrik-Elektronik Mühendisliği", slug: "elektrik-elektronik-muhendisligi", educationLevel: "bachelor" },
          { name: "Malzeme Bilimi ve Mühendisliği", slug: "malzeme-bilimi-ve-muhendisligi", educationLevel: "bachelor" }
        ]
      }
    ]
  },
  {
    name: "TÜRKİYE ULUSLARARASI İSLAM, BİLİM VE TEKNOLOJİ ÜNİVERSİTESİ",
    slug: "turkiye-uluslararasi-islam-bilim-ve-teknoloji-universitesi",
    city: "İSTANBUL",
    type: "state",
    websiteUrl: "https://www.tibu.edu.tr/",
    faculties: [
      { name: "Bilgisayar ve Bilişim Fakültesi", slug: "bilgisayar-ve-bilisim-fakultesi", departments: [] },
      { name: "Hukuk Fakültesi", slug: "hukuk-fakultesi", departments: [] },
      { name: "İslami İlimler Fakültesi", slug: "islami-ilimler-fakultesi", departments: [] },
      { name: "Mühendislik ve Mimarlık Fakültesi", slug: "muhendislik-ve-mimarlik-fakultesi", departments: [] },
      { name: "Siyasal Bilgiler Fakültesi", slug: "siyasal-bilgiler-fakultesi", departments: [] },
      { name: "Sosyal ve Beşeri Bilimler Fakültesi", slug: "sosyal-ve-beseri-bilimler-fakultesi", departments: [] },
      { name: "Tıp Fakültesi", slug: "tip-fakultesi", departments: [] }
    ]
  }
];

/**
 * Reconciles either the live YÖK Atlas result or the bundled fallback with the
 * three active institutions that the 2025 YÖK report identifies but the Atlas
 * program rows can omit. The operation is intentionally idempotent.
 */
export function mergeYok208ActiveInstitutions(seed: TurkiyeCatalogSeed): TurkiyeCatalogSeed {
  reconcileIzmirKonakIdentity(seed.universities);
  const universitiesById = new Map(seed.universities.map((university) => [university.slug, university]));
  for (const supplement of supplementalUniversities) {
    const existing = universitiesById.get(supplement.slug);
    if (existing) {
      assertCompatibleUniversity(existing, supplement);
      if (!existing.websiteUrl && supplement.websiteUrl) existing.websiteUrl = supplement.websiteUrl;
      mergeAcademicStructure(existing, supplement);
      continue;
    }
    const added = structuredClone(supplement);
    seed.universities.push(added);
    universitiesById.set(added.slug, added);
  }

  seed.universities.sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
  seed.activeInstitutionSupplement = {
    source: "YOK_UNIVERSITY_MONITORING_AND_EVALUATION_GENERAL_REPORT_2025",
    sourceUrl: yok2025ActiveInstitutionReportUrl,
    referenceAcademicYear: "2023-2024",
    expectedCounts: {
      total: 208,
      stateUniversities: 129,
      foundationUniversities: 75,
      foundationVocationalSchools: 4
    },
    universityIds: supplementalUniversities.map((university) => university.slug).sort(compareText)
  };
  assertOfficialCounts(seed.universities);
  return seed;
}

function reconcileIzmirKonakIdentity(universities: CatalogSeedUniversity[]): void {
  const legacy = universities.find((university) => university.slug === izmirKonakStableUniversityId);
  const current = universities.find((university) => university.slug === izmirKonakCurrentUniversityId);
  if (legacy && current && legacy !== current) throw new Error("IZMIR_KONAK_STABLE_ID_CONFLICT");
  const university = legacy ?? current;
  if (!university) return;
  if (university.city !== "İZMİR" || university.type !== "foundation") {
    throw new Error("IZMIR_KONAK_IDENTITY_CONFLICT");
  }

  university.slug = izmirKonakStableUniversityId;
  university.name = izmirKonakCurrentName;
  university.websiteUrl = izmirKonakWebsiteUrl;

  const school = university.faculties.find((faculty) =>
    faculty.slug === izmirKonakStableUniversityId || faculty.slug === izmirKonakCurrentUniversityId
  );
  if (school) {
    school.slug = izmirKonakStableUniversityId;
    school.name = "İzmir Konak Meslek Yüksekokulu";
  }
}

function assertCompatibleUniversity(existing: CatalogSeedUniversity, supplement: CatalogSeedUniversity): void {
  if (existing.name !== supplement.name || existing.city !== supplement.city || existing.type !== supplement.type) {
    throw new Error(`YOK_208_SUPPLEMENT_CONFLICT:${supplement.slug}`);
  }
}

function mergeAcademicStructure(existing: CatalogSeedUniversity, supplement: CatalogSeedUniversity): void {
  const facultiesById = new Map(existing.faculties.map((faculty) => [faculty.slug, faculty]));
  for (const supplementalFaculty of supplement.faculties) {
    const faculty = facultiesById.get(supplementalFaculty.slug);
    if (!faculty) {
      const added = structuredClone(supplementalFaculty);
      existing.faculties.push(added);
      facultiesById.set(added.slug, added);
      continue;
    }
    if (faculty.name !== supplementalFaculty.name) throw new Error(`YOK_208_FACULTY_CONFLICT:${existing.slug}:${faculty.slug}`);
    const departmentsById = new Map(faculty.departments.map((department) => [department.slug, department]));
    for (const supplementalDepartment of supplementalFaculty.departments) {
      const department = departmentsById.get(supplementalDepartment.slug);
      if (!department) {
        const added = structuredClone(supplementalDepartment);
        faculty.departments.push(added);
        departmentsById.set(added.slug, added);
        continue;
      }
      if (department.name !== supplementalDepartment.name || department.educationLevel !== supplementalDepartment.educationLevel) {
        throw new Error(`YOK_208_DEPARTMENT_CONFLICT:${existing.slug}:${faculty.slug}:${department.slug}`);
      }
    }
    faculty.departments.sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
  }
  existing.faculties.sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
}

function assertOfficialCounts(universities: readonly CatalogSeedUniversity[]): void {
  const stateUniversities = universities.filter((university) => university.type === "state").length;
  const foundationVocationalSchools = universities.filter(isFoundationVocationalSchool).length;
  const foundationUniversities = universities.filter((university) => university.type === "foundation").length - foundationVocationalSchools;
  if (universities.length !== 208 || stateUniversities !== 129 || foundationUniversities !== 75 || foundationVocationalSchools !== 4) {
    throw new Error(
      `YOK_208_COUNT_MISMATCH:total=${universities.length},state=${stateUniversities},foundation=${foundationUniversities},foundationVmyo=${foundationVocationalSchools}`
    );
  }
}

function isFoundationVocationalSchool(university: CatalogSeedUniversity): boolean {
  return university.type === "foundation" && /MESLEK YÜKSEKOKULU(?:\s*\([^)]*\))?$/u.test(university.name);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en-US");
}
