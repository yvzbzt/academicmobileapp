import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "@playwright/test";

interface SeedDepartment {
  name: string;
  slug: string;
  educationLevel: string;
}

interface SeedFaculty {
  name: string;
  slug: string;
  departments: SeedDepartment[];
}

interface SeedUniversity {
  name: string;
  slug: string;
  city: string;
  type: "state" | "foundation" | "private";
  faculties: SeedFaculty[];
}

interface CatalogSeed {
  universities: SeedUniversity[];
}

const execFileAsync = promisify(execFile);
const cwd = process.cwd();
const outputDir = resolve(cwd, process.env.PW_UNIVERSITY_AUDIT_OUTPUT_DIR ?? ".tmp-test-run/playwright-university-audit");
const catalog = JSON.parse(await readFile(resolve(cwd, "apps/api/src/bootstrap/turkiye-catalog-seed.json"), "utf8")) as CatalogSeed;
const workerScript = resolve(cwd, "scripts/audit-single-university-retrieval.ts");
const tsxCli = resolve(cwd, "node_modules/tsx/dist/cli.mjs");

test.describe.configure({ mode: "parallel" });

test.beforeAll(async () => {
  await mkdir(outputDir, { recursive: true });
});

for (const university of catalog.universities) {
  test(`retrieval audit: ${university.slug}`, async () => {
    test.setTimeout(330_000);

    await execFileAsync(process.execPath, [tsxCli, workerScript, university.slug], {
      cwd,
      env: {
        ...process.env,
        PW_UNIVERSITY_AUDIT_OUTPUT_DIR: outputDir
      },
      maxBuffer: 2 * 1024 * 1024,
      timeout: 300_000,
      windowsHide: true
    });
  });
}
