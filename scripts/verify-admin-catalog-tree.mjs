// Read-only audit of the public catalog consumed by the admin tree.
// No authentication, source mutations, approval, or ingestion requests.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const origin = process.env.ADMIN_CATALOG_API ?? "https://academic-api.anssoft.com.tr";
const errors = [];
const artifactPath = "artifacts/admin-academic-tree/live-catalog.json";
const previous = existsSync(artifactPath) ? JSON.parse(readFileSync(artifactPath, "utf8")) : undefined;
// Only resume a recent interrupted audit, never silently reuse an old successful snapshot.
const canResume = previous?.summary.origin === origin && previous.summary.errors.length > 0
  && Date.now() - Date.parse(previous.summary.checkedAt) < 3600000;
const cachedTree = canResume ? previous.tree : {};
const tree = {};
let nextRequestAt = 0;
async function read(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      // Keep the total request rate below the API's 120 requests/minute limit.
      const requestAt = Math.max(Date.now(), nextRequestAt);
      nextRequestAt = requestAt + 650;
      await new Promise((resolve) => setTimeout(resolve, requestAt - Date.now()));
      const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(20000) });
      if (response.status === 429) {
        console.log("API rate limit reached; slowing read-only audit.");
        nextRequestAt = Math.max(nextRequestAt, Date.now() + 15000);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
      const items = await response.json();
      if (!Array.isArray(items)) throw new Error(`Expected catalog array: ${path}`);
      return items;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}
const universities = [];
for (let offset = 0; ; offset += 500) {
  const page = await read(`/universities?limit=500&offset=${offset}`);
  universities.push(...page);
  if (page.length < 500) break;
}
let cursor = 0;
let completed = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < universities.length) {
    const university = universities[cursor++];
    try {
      const faculties = await read(`/universities/${encodeURIComponent(university.id)}/faculties`);
      const cached = new Map((cachedTree[university.id]?.faculties ?? []).map((unit) => [unit.faculty.id, unit.departments]));
      tree[university.id] = { university, faculties: [] };
      for (const faculty of faculties) {
        const departments = cached.get(faculty.id) ?? await read(`/faculties/${encodeURIComponent(faculty.id)}/departments`);
        if (faculty.universityId !== university.id || departments.some((unit) => unit.facultyId !== faculty.id)) {
          throw new Error(`Catalog parent mismatch: ${faculty.id}`);
        }
        tree[university.id].faculties.push({ faculty, departments });
      }
    } catch (error) { errors.push(String(error)); }
    completed++;
    if (completed % 20 === 0) console.log(`Read ${completed}/${universities.length} universities`);
  }
}));
const facultyCount = Object.values(tree).reduce((sum, unit) => sum + unit.faculties.length, 0);
const departmentCount = Object.values(tree).reduce((sum, unit) => sum + unit.faculties.reduce((count, faculty) => count + faculty.departments.length, 0), 0);
const summary = { checkedAt: new Date().toISOString(), origin, universities: universities.length, faculties: facultyCount, departments: departmentCount, errors };
mkdirSync("artifacts/admin-academic-tree", { recursive: true });
writeFileSync(artifactPath, JSON.stringify({ summary, tree }));
console.log(JSON.stringify({ ...summary, errors: errors.length, errorSamples: errors.slice(0, 3) }));
if (errors.length) process.exitCode = 1;
