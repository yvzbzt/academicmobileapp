import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildAdminSourceHotfix } from "../../deploy/hetzner/apply-admin-source-hotfix.mjs";

const temporary = [];
async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "admin-source-hotfix-test-"));
  temporary.push(path);
  return path;
}
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("admin source production overlay", () => {
  it("rejects an unreviewed baseline before writing release artifacts", async () => {
    const path = await temporaryDirectory();
    await writeFile(join(path, "announcement-ingestion.service.js"), "wrong baseline");
    const output = join(path, "output");
    await expect(buildAdminSourceHotfix(path, join(path, "compiled"), output)).rejects.toThrow("Output must be separate");
    const other = await temporaryDirectory();
    await expect(buildAdminSourceHotfix(path, other, join(other, "output"))).rejects.toThrow("Output must be separate");
    const release = await temporaryDirectory();
    await expect(buildAdminSourceHotfix(path, other, release)).rejects.toThrow("baseline checksum mismatch");
    expect(await readdir(release)).toEqual([]);
    await expect(access(output)).rejects.toThrow();
  });

  const baseline = process.env.ADMIN_SOURCE_HOTFIX_BASELINE;
  const compiled = process.env.ADMIN_SOURCE_HOTFIX_COMPILED_DIST;
  it.skipIf(!baseline || !compiled)("preserves v4, generates deterministic checksummed artifacts, and leaves the parser untouched", async () => {
    const first = await temporaryDirectory();
    const second = await temporaryDirectory();
    const beforeParser = await readFile(join(baseline, "announcement-parser.js"));
    const manifest = await buildAdminSourceHotfix(baseline, compiled, first);
    expect(await buildAdminSourceHotfix(baseline, compiled, second)).toEqual(manifest);
    expect(Object.keys(manifest.files)).toHaveLength(4);
    const runtime = await readFile(join(first, "dist/packages/shared/src/device-source-runtime.js"), "utf8");
    const service = await readFile(join(first, "dist/apps/api/src/modules/announcements/announcement-ingestion.service.js"), "utf8");
    expect(runtime).toContain('DEVICE_SOURCE_RUNTIME_VERSION = "device-source-runtime-v4"');
    expect(runtime).toContain('filterFreshItems(items, recipe).slice(0, MAX_ITEMS)');
    expect(runtime).toContain('recipe.parserConfig?.maximumPages !== 2');
    expect(runtime).toContain('"bogazici_event"');
    expect(runtime).toContain('hydrateDeviceSourceDetailItems');
    expect(runtime).toContain('isSourceChallengeDocument');
    expect(runtime).toContain('isSelcukUnitListingUrl(baseUrl)');
    expect(service).toContain('backfillAcademicUnitSourceOwnershipForAdmin');
    expect(service).toContain('withSourcePreviewRetry');
    expect(service).toContain('consecutiveFailures: informational ? 0');
    for (const [path, hash] of Object.entries(manifest.files)) {
      const file = await readFile(join(first, path));
      expect(createHash("sha256").update(file).digest("hex")).toBe(hash);
      expect(await readFile(join(second, path))).toEqual(file);
      expect(file.toString("utf8")).not.toContain("//# sourceMappingURL=");
    }
    expect(await readFile(join(baseline, "announcement-parser.js"))).toEqual(beforeParser);
    await expect(access(join(first, "dist/apps/api/src/modules/announcements/announcement-parser.js"))).rejects.toThrow();
    await expect(buildAdminSourceHotfix(baseline, compiled, first)).rejects.toThrow("Output directory must be empty");

    // Execute the resulting v4 module, not the older local source runtime.
    await symlink(fileURLToPath(new URL("../../node_modules", import.meta.url)), join(first, "node_modules"), "dir");
    const { parseDeviceSourceRuntimeDocument } = await import(pathToFileURL(join(first, "dist/packages/shared/src/device-source-runtime.js")).href);
    const url = "https://selcuk.edu.tr/birim/tumicerikler/5346/2";
    const recipe = { sourceUrl: url, allowedOfficialDomain: "selcuk.edu.tr", parser: "html", contentType: "announcement",
      checkedAt: "2026-10-13T12:00:00.000Z", parserConfig: { itemSelector: "article.news-card", titleSelector: ".title", linkSelector: "a", dateSelector: "time" } };
    const empty = '<main><div class="news-wrapper birim-tum-icerikler-news"><p class="birim-tum-icerikler__empty">Gösterilecek içerik bulunmuyor.</p></div></main>';
    const listing = (date) => `<main><article class="news-card"><h2 class="title"><a href="/birim/icerik/5346/test-123">Öğrenci kayıt duyurusu</a></h2><time>${date}</time></article></main>`;
    expect(() => parseDeviceSourceRuntimeDocument(empty, recipe)).toThrow("SOURCE_LISTING_EMPTY");
    expect(() => parseDeviceSourceRuntimeDocument(empty, { ...recipe, parserConfig: { ...recipe.parserConfig, dateSelector: "[[[" } })).toThrow("SOURCE_HTML_SELECTOR_INVALID");
    expect(() => parseDeviceSourceRuntimeDocument(listing("2020-01-01"), recipe)).toThrow("SOURCE_LISTING_STALE");
    expect(parseDeviceSourceRuntimeDocument(listing("2026-10-12"), { ...recipe, parserConfig: { ...recipe.parserConfig, maximumPages: 2, nextPageSelector: ".next-page", fetchDetail: true } })).toHaveLength(1);
    expect(parseDeviceSourceRuntimeDocument(listing("2020-01-01"), { ...recipe, parserConfig: { ...recipe.parserConfig, maximumPages: 2, nextPageSelector: ".next-page" } })).toEqual([]);
  });
});
