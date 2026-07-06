import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadTurkiyeCatalogFromYokAtlas } from "../apps/api/src/bootstrap/yok-atlas-catalog-importer.js";
import { discoverAnnouncementSourceForUniversity, type AnnouncementDiscoveryResult } from "../apps/api/src/modules/announcements/announcement-ingestion.service.js";
import type { UniversityRecord } from "../apps/api/src/modules/catalog/catalog.types.js";

const limit = readPositiveInteger(process.env.ANNOUNCEMENT_VERIFY_LIMIT, 205);
const offset = readPositiveInteger(process.env.ANNOUNCEMENT_VERIFY_OFFSET, 0);
const concurrency = readPositiveInteger(process.env.ANNOUNCEMENT_VERIFY_CONCURRENCY, 6);
const timeoutMs = readPositiveInteger(process.env.ANNOUNCEMENT_VERIFY_TIMEOUT_MS, 3500);
const outputPath = resolve(process.cwd(), process.env.ANNOUNCEMENT_VERIFY_OUTPUT ?? ".tmp-test-run/announcement-discovery-report.json");

const catalog = await loadTurkiyeCatalogFromYokAtlas(60000);
const universities = catalog.universities.slice(offset, offset + limit).map((university) => ({
  id: university.slug,
  name: university.name,
  slug: university.slug,
  city: university.city,
  type: university.type,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date()
}) satisfies UniversityRecord);

const startedAt = new Date();
const results = await runWithConcurrency(universities, concurrency, async (university, index) => {
  const result = await discoverAnnouncementSourceForUniversity(university, { timeoutMs });
  const ordinal = offset + index + 1;
  console.log(`${ordinal}/${catalog.universities.length} ${result.status.padEnd(24)} ${university.name} ${result.sourceUrl ?? result.homepageUrl ?? ""}`);
  return result;
});

const finishedAt = new Date();
const summary = {
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationSeconds: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
  sourceCatalog: catalog.sourceUrl,
  checkedUniversities: results.length,
  sourceFound: results.filter((result) => result.status === "source_found").length,
  homepageFoundNoItems: results.filter((result) => result.status === "homepage_found_no_items").length,
  homepageNotFound: results.filter((result) => result.status === "homepage_not_found").length,
  totalParsedItems: results.reduce((total, result) => total + result.itemCount, 0)
};

await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, JSON.stringify({ summary, results }, null, 2), "utf8");
console.log(JSON.stringify(summary, null, 2));
console.log(`Report written to ${outputPath}`);

async function runWithConcurrency<TInput, TOutput>(items: TInput[], workerCount: number, worker: (item: TInput, index: number) => Promise<TOutput>): Promise<TOutput[]> {
  const results: TOutput[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workerCount, items.length || 1)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  }));
  return results;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
