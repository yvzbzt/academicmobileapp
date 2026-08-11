import { readFile } from "node:fs/promises";
import {
  safeOutboundRequest,
  YOK_ATLAS_SEARCH_URL
} from "../common/network/safe-outbound-request.js";
import type { EducationLevel, UniversityType } from "../modules/catalog/catalog.types.js";
import { createSlug } from "../modules/catalog/slug.js";

const yokAtlasSearchUrl = YOK_ATLAS_SEARCH_URL;

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
  faculties: CatalogSeedFaculty[];
}

export interface TurkiyeCatalogSeed {
  source: "yok_atlas";
  sourceUrl: string;
  sourceRowCount: number;
  includedRowCount: number;
  universities: CatalogSeedUniversity[];
}

interface MutableFaculty extends CatalogSeedFaculty {
  departmentMap: Map<string, CatalogSeedDepartment>;
}

interface MutableUniversity extends CatalogSeedUniversity {
  facultyMap: Map<string, MutableFaculty>;
}

interface YokAtlasProgramRow {
  universiteId: string | number | undefined;
  universiteAdi: string | undefined;
  uniIlKodu: string | number | undefined;
  uniIlAdi: string | undefined;
  universiteTuru: string | undefined;
  fymkAdi: string | undefined;
  birimGrupAdi: string | undefined;
  birimTuruAdi: string | undefined;
}

export async function loadTurkiyeCatalogFromYokAtlas(timeoutMs = 20000): Promise<TurkiyeCatalogSeed> {
  const payload = {
    puanTuru: null,
    universiteId: [],
    birimGrupId: [],
    ilKodu: [],
    birimTuruId: null,
    universiteTuru: null,
    bursOraniId: null,
    ogrenimTuruId: null,
    kilavuzKodu: null,
    minBasariSirasi: null,
    maxBasariSirasi: null
  };
  const response = await fetchJsonWithTimeout(yokAtlasSearchUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: "https://yokatlas.yok.gov.tr",
      referer: "https://yokatlas.yok.gov.tr/",
      "user-agent": "AcademicCalendarSeeder/1.0"
    },
    body: JSON.stringify(payload)
  }, timeoutMs);
  const rows = extractRows(response);
  return buildTurkiyeCatalogFromYokAtlasRows(rows);
}

export async function loadBundledTurkiyeCatalogSeed(): Promise<TurkiyeCatalogSeed> {
  const raw = await readFile(new URL("./turkiye-catalog-seed.json", import.meta.url), "utf8");
  const seed = JSON.parse(raw) as TurkiyeCatalogSeed;
  if (!Array.isArray(seed.universities) || seed.universities.length === 0) throw new Error("BUNDLED_TURKIYE_CATALOG_EMPTY");
  return seed;
}

export function buildTurkiyeCatalogFromYokAtlasRows(rows: unknown[]): TurkiyeCatalogSeed {
  const universities = new Map<string, MutableUniversity>();
  let includedRowCount = 0;

  for (const value of rows) {
    const row = toYokAtlasProgramRow(value);
    if (!row) continue;
    const cityCode = Number(row.uniIlKodu);
    if (!Number.isInteger(cityCode) || cityCode < 1 || cityCode > 81) continue;

    const universityName = cleanText(row.universiteAdi);
    const city = cleanText(row.uniIlAdi);
    const facultyName = cleanText(row.fymkAdi);
    const departmentName = cleanText(row.birimGrupAdi);
    if (!universityName || !city || !facultyName || !departmentName) continue;

    includedRowCount += 1;
    const universityKey = String(row.universiteId ?? createSlug(universityName));
    const university = getOrCreateUniversity(universities, universityKey, {
      name: universityName,
      slug: createSlug(universityName),
      city,
      type: mapUniversityType(row.universiteTuru),
      faculties: []
    });
    const facultySlug = createSlug(facultyName);
    const faculty = getOrCreateFaculty(university, facultySlug, facultyName);
    const departmentSlug = createSlug(departmentName);
    if (!faculty.departmentMap.has(departmentSlug)) {
      faculty.departmentMap.set(departmentSlug, {
        name: departmentName,
        slug: departmentSlug,
        educationLevel: mapEducationLevel(row.birimTuruAdi)
      });
    }
  }

  return {
    source: "yok_atlas",
    sourceUrl: yokAtlasSearchUrl,
    sourceRowCount: rows.length,
    includedRowCount,
    universities: [...universities.values()]
      .map((university) => ({
        name: university.name,
        slug: university.slug,
        city: university.city,
        type: university.type,
        faculties: [...university.facultyMap.values()]
          .map((faculty) => ({
            name: faculty.name,
            slug: faculty.slug,
            departments: [...faculty.departmentMap.values()].sort((left, right) => left.name.localeCompare(right.name, "tr-TR"))
          }))
          .sort((left, right) => left.name.localeCompare(right.name, "tr-TR"))
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "tr-TR"))
  };
}

export async function fetchJsonWithTimeout(
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
  timeoutMs: number
): Promise<unknown> {
  const response = await safeOutboundRequest(url, {
    timeoutMs,
    method: init.method,
    headers: init.headers,
    body: init.body,
    maximumRedirects: 0,
    maximumRequestBytes: 256 * 1024,
    maximumResponseBytes: 32 * 1024 * 1024,
    providerPolicy: "yok-atlas"
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`YOK_ATLAS_REQUEST_FAILED_${response.status}`);
  }
  try {
    return JSON.parse(response.body.toString("utf8")) as unknown;
  } catch {
    throw new Error("YOK_ATLAS_RESPONSE_INVALID_JSON");
  }
}

function extractRows(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (!isRecord(response)) return [];
  const content = response.content;
  if (Array.isArray(content)) return content;
  const data = response.data;
  if (Array.isArray(data)) return data;
  return [];
}

function toYokAtlasProgramRow(value: unknown): YokAtlasProgramRow | null {
  if (!isRecord(value)) return null;
  return {
    universiteId: readStringOrNumber(value.universiteId),
    universiteAdi: readString(value.universiteAdi),
    uniIlKodu: readStringOrNumber(value.uniIlKodu),
    uniIlAdi: readString(value.uniIlAdi),
    universiteTuru: readString(value.universiteTuru),
    fymkAdi: readString(value.fymkAdi),
    birimGrupAdi: readString(value.birimGrupAdi),
    birimTuruAdi: readString(value.birimTuruAdi)
  };
}

function getOrCreateUniversity(universities: Map<string, MutableUniversity>, key: string, input: Omit<CatalogSeedUniversity, "faculties"> & { faculties: CatalogSeedFaculty[] }): MutableUniversity {
  const existing = universities.get(key);
  if (existing) return existing;
  const university: MutableUniversity = { ...input, facultyMap: new Map() };
  universities.set(key, university);
  return university;
}

function getOrCreateFaculty(university: MutableUniversity, slug: string, name: string): MutableFaculty {
  const existing = university.facultyMap.get(slug);
  if (existing) return existing;
  const faculty: MutableFaculty = { name, slug, departments: [], departmentMap: new Map() };
  university.facultyMap.set(slug, faculty);
  return faculty;
}

function mapUniversityType(value: string | undefined): UniversityType {
  const normalized = foldValue(value);
  if (normalized.includes("DEVLET")) return "state";
  if (normalized.includes("VAKIF")) return "foundation";
  return "private";
}

function mapEducationLevel(value: string | undefined): EducationLevel {
  const normalized = foldValue(value);
  if (normalized.includes("ONLISANS")) return "associate";
  return "bachelor";
}

function cleanText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function foldValue(value: string | undefined): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "I")
    .toLocaleUpperCase("en-US");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readStringOrNumber(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
