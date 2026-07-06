import { readFile } from "node:fs/promises";

export interface VerifiedUniversitySource {
  universityId: string;
  universityName: string;
  city?: string;
  announcementUrl?: string;
  calendarUrl?: string;
  summerSchoolUrl?: string;
}

export interface VerifiedAcademicUnitSource {
  scopeType: "faculty" | "department";
  universityId: string;
  universityName?: string;
  facultyId?: string;
  facultyName?: string;
  departmentId?: string;
  departmentName?: string;
  websiteUrl?: string;
  announcementUrl?: string;
  courseScheduleUrl?: string;
  examScheduleUrl?: string;
}

interface RawVerifiedUniversitySource {
  universityId?: unknown;
  universityName?: unknown;
  city?: unknown;
  announcementUrl?: unknown;
  calendarUrl?: unknown;
  summerSchoolUrl?: unknown;
}

interface RawVerifiedAcademicUnitSource {
  scopeType?: unknown;
  universityId?: unknown;
  universityName?: unknown;
  facultyId?: unknown;
  facultyName?: unknown;
  departmentId?: unknown;
  departmentName?: unknown;
  websiteUrl?: unknown;
  announcementUrl?: unknown;
  courseScheduleUrl?: unknown;
  examScheduleUrl?: unknown;
}

let sourceCache: Promise<VerifiedUniversitySource[]> | null = null;
let sourceMapCache: Promise<Map<string, VerifiedUniversitySource>> | null = null;
let academicUnitSourceCache: Promise<VerifiedAcademicUnitSource[]> | null = null;
let academicUnitSourceMapsCache: Promise<{ faculty: Map<string, VerifiedAcademicUnitSource>; department: Map<string, VerifiedAcademicUnitSource> }> | null = null;

export async function listVerifiedUniversitySources(): Promise<VerifiedUniversitySource[]> {
  sourceCache ??= readVerifiedUniversitySources();
  return sourceCache;
}

export async function findVerifiedUniversitySource(universityId: string): Promise<VerifiedUniversitySource | null> {
  sourceMapCache ??= listVerifiedUniversitySources().then((sources) => new Map(sources.map((source) => [source.universityId, source])));
  return (await sourceMapCache).get(universityId) ?? null;
}

export async function listVerifiedAcademicUnitSources(): Promise<VerifiedAcademicUnitSource[]> {
  academicUnitSourceCache ??= readVerifiedAcademicUnitSources();
  return academicUnitSourceCache;
}

export async function findVerifiedAcademicUnitSource(input: { facultyId?: string; departmentId?: string }): Promise<VerifiedAcademicUnitSource | null> {
  academicUnitSourceMapsCache ??= listVerifiedAcademicUnitSources().then((sources) => ({
    faculty: new Map(sources.filter((source) => source.scopeType === "faculty" && source.facultyId).map((source) => [source.facultyId!, source])),
    department: new Map(sources.filter((source) => source.scopeType === "department" && source.departmentId).map((source) => [source.departmentId!, source]))
  }));
  const maps = await academicUnitSourceMapsCache;
  return (input.departmentId ? maps.department.get(input.departmentId) : undefined)
    ?? (input.facultyId ? maps.faculty.get(input.facultyId) : undefined)
    ?? null;
}

async function readVerifiedUniversitySources(): Promise<VerifiedUniversitySource[]> {
  try {
    const raw = await readJsonFile(new URL("./verified-university-sources.json", import.meta.url));
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeVerifiedSource).filter((source): source is VerifiedUniversitySource => Boolean(source));
  } catch {
    return [];
  }
}

async function readVerifiedAcademicUnitSources(): Promise<VerifiedAcademicUnitSource[]> {
  try {
    const raw = await readJsonFile(new URL("./verified-academic-unit-sources.json", import.meta.url));
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeAcademicUnitSource).filter((source): source is VerifiedAcademicUnitSource => Boolean(source));
  } catch {
    return [];
  }
}

async function readJsonFile(url: URL): Promise<unknown> {
  const data = await readFile(url);
  return JSON.parse(decodeJsonBuffer(data)) as unknown;
}

function decodeJsonBuffer(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString("utf16le");
  if (data[0] === 0xfe && data[1] === 0xff) return swapUtf16Bytes(data.subarray(2)).toString("utf16le");
  const sample = data.subarray(0, Math.min(data.length, 64));
  const oddNulls = sample.filter((byte, index) => index % 2 === 1 && byte === 0).length;
  if (oddNulls > sample.length / 4) return data.toString("utf16le").replace(/^\uFEFF/u, "");
  return data.toString("utf8").replace(/^\uFEFF/u, "");
}

function swapUtf16Bytes(data: Buffer): Buffer {
  const swapped = Buffer.from(data);
  for (let index = 0; index + 1 < swapped.length; index += 2) {
    const left = swapped[index]!;
    swapped[index] = swapped[index + 1]!;
    swapped[index + 1] = left;
  }
  return swapped;
}

function normalizeVerifiedSource(input: RawVerifiedUniversitySource): VerifiedUniversitySource | null {
  const universityId = readString(input.universityId);
  if (!universityId) return null;
  const universityName = readString(input.universityName) ?? universityId;
  const city = readString(input.city);
  const announcementUrl = readUrl(input.announcementUrl);
  const calendarUrl = readUrl(input.calendarUrl);
  const summerSchoolUrl = readUrl(input.summerSchoolUrl);

  return {
    universityId,
    universityName,
    ...(city ? { city } : {}),
    ...(announcementUrl ? { announcementUrl } : {}),
    ...(calendarUrl ? { calendarUrl } : {}),
    ...(summerSchoolUrl ? { summerSchoolUrl } : {})
  };
}

function normalizeAcademicUnitSource(input: RawVerifiedAcademicUnitSource): VerifiedAcademicUnitSource | null {
  const scopeType = input.scopeType === "faculty" || input.scopeType === "department" ? input.scopeType : undefined;
  const universityId = readString(input.universityId);
  if (!scopeType || !universityId) return null;
  const facultyId = readString(input.facultyId);
  const departmentId = readString(input.departmentId);
  if (scopeType === "faculty" && !facultyId) return null;
  if (scopeType === "department" && !departmentId) return null;

  const universityName = readString(input.universityName);
  const facultyName = readString(input.facultyName);
  const departmentName = readString(input.departmentName);
  const websiteUrl = readUrl(input.websiteUrl);
  const announcementUrl = readUrl(input.announcementUrl);
  const courseScheduleUrl = scopeType === "department" ? readUrl(input.courseScheduleUrl) : undefined;
  const examScheduleUrl = scopeType === "department" ? readUrl(input.examScheduleUrl) : undefined;
  if (!websiteUrl && !announcementUrl && !courseScheduleUrl && !examScheduleUrl) return null;

  return {
    scopeType,
    universityId,
    ...(universityName ? { universityName } : {}),
    ...(facultyId ? { facultyId } : {}),
    ...(facultyName ? { facultyName } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(departmentName ? { departmentName } : {}),
    ...(websiteUrl ? { websiteUrl } : {}),
    ...(announcementUrl ? { announcementUrl } : {}),
    ...(courseScheduleUrl ? { courseScheduleUrl } : {}),
    ...(examScheduleUrl ? { examScheduleUrl } : {})
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readUrl(value: unknown): string | undefined {
  const candidate = readString(value);
  if (!candidate) return undefined;
  try {
    return new URL(candidate).toString();
  } catch {
    return undefined;
  }
}
