import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadBundledTurkiyeCatalogSeed } from "../apps/api/src/bootstrap/yok-atlas-catalog-importer.js";
import { AcademicSourceDiscoveryService } from "../apps/api/src/modules/source-discovery/academic-source-discovery.service.js";
import { InMemoryCatalogRepository } from "../apps/api/src/modules/catalog/in-memory-catalog.repository.js";
import type { CatalogRepository, DepartmentRecord, FacultyRecord, UniversityRecord } from "../apps/api/src/modules/catalog/catalog.types.js";

const limit = readPositiveInteger(process.env.SOURCE_EXPORT_LIMIT, 205);
const offset = readPositiveInteger(process.env.SOURCE_EXPORT_OFFSET, 0);
const concurrency = readPositiveInteger(process.env.SOURCE_EXPORT_CONCURRENCY, 2);
const outputPath = resolve(process.cwd(), process.env.SOURCE_EXPORT_OUTPUT ?? "data/source-url-candidates.json");

const repository = new InMemoryCatalogRepository();
const catalog = await loadBundledTurkiyeCatalogSeed();
const selectedUniversities = catalog.universities.slice(offset, offset + limit);

for (const universitySeed of selectedUniversities) {
  const university = await repository.createUniversity({
    name: universitySeed.name,
    slug: universitySeed.slug,
    city: universitySeed.city,
    type: universitySeed.type,
    status: "active"
  });

  for (const facultySeed of universitySeed.faculties) {
    const faculty = await repository.createFaculty({
      universityId: university.id,
      name: facultySeed.name,
      slug: facultySeed.slug,
      status: "active"
    });

    for (const departmentSeed of facultySeed.departments) {
      await repository.createDepartment({
        universityId: university.id,
        facultyId: faculty.id,
        name: departmentSeed.name,
        slug: departmentSeed.slug,
        educationLevel: departmentSeed.educationLevel,
        status: "active"
      });
    }
  }
}

const startedAt = new Date();
const discovery = await new AcademicSourceDiscoveryService(repository as CatalogRepository).discoverSources({
  limit,
  offset: 0,
  concurrency
});
const finishedAt = new Date();

const payload = {
  generatedAt: finishedAt.toISOString(),
  input: {
    limit,
    offset,
    concurrency,
    sourceCatalog: catalog.sourceUrl,
    selectedUniversities: selectedUniversities.length,
    webSearchEndpointConfigured: Boolean(process.env.WEB_SOURCE_SEARCH_ENDPOINT)
  },
  summary: {
    ...discovery.summary,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    distinctUrlCount: new Set(discovery.candidates.map((candidate) => candidate.url)).size
  },
  queryPlan: discovery.queryPlan,
  candidates: discovery.candidates.map((candidate) => ({
    ...candidate,
    extractionPriority: extractionPriority(candidate.extractionMethod, candidate.reliabilityScore)
  })),
  urlsByType: groupUrlsByType(discovery.candidates)
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
console.log(JSON.stringify(payload.summary, null, 2));
console.log(`Source URL candidates written to ${outputPath}`);

function extractionPriority(method: string, reliabilityScore: number): "high" | "medium" | "manual_review" {
  if (reliabilityScore >= 90 && method !== "manual_review") return "high";
  if (reliabilityScore >= 70) return "medium";
  return "manual_review";
}

function groupUrlsByType(candidates: typeof discovery.candidates): Record<string, string[]> {
  const grouped = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (!grouped.has(candidate.sourceType)) grouped.set(candidate.sourceType, new Set());
    grouped.get(candidate.sourceType)!.add(candidate.url);
  }
  return Object.fromEntries([...grouped.entries()].map(([type, urls]) => [type, [...urls].sort()]));
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
