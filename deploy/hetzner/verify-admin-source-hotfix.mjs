import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Offline image canary: no DB imports, timers, network calls, or writes.
// docker run --rm --network none --entrypoint node <overlay-image> \
//   /app/deploy/hetzner/verify-admin-source-hotfix.mjs /app
export async function verifyAdminSourceHotfix(applicationRoot = "/app") {
  const root = resolve(applicationRoot);
  const moduleAt = (path) => import(pathToFileURL(resolve(root, "dist", path)).href);
  const parser = await readFile(resolve(root, "dist/apps/api/src/modules/announcements/announcement-parser.js"));
  assert.equal(createHash("sha256").update(parser).digest("hex"),
    "4b9daf66d2426e9bbaec0e1447da972e0ee3dadb3182993d5db2b766111e1bda", "Unrelated production parser must remain byte-identical");

  const { DEVICE_SOURCE_RUNTIME_VERSION, parseDeviceSourceRuntimeDocument, executeDeviceSourceRuntime } = await moduleAt("packages/shared/src/device-source-runtime.js");
  const { isSelcukUnitListingUrl, isExplicitSelcukEmptyListing, isInformationalListingCode } = await moduleAt("packages/shared/src/source-listing-state.js");
  const { withSourcePreviewRetry } = await moduleAt("apps/api/src/modules/announcements/source-preview-retry.js");
  assert.equal(DEVICE_SOURCE_RUNTIME_VERSION, "device-source-runtime-v4", "Production runtime must not downgrade");

  const sourceUrl = "https://selcuk.edu.tr/birim/tumicerikler/5346/2";
  const recipe = {
    sourceUrl, allowedOfficialDomain: "selcuk.edu.tr", parser: "html", contentType: "announcement",
    checkedAt: "2026-10-13T12:00:00.000Z",
    parserConfig: { itemSelector: "article.news-card", titleSelector: ".title", linkSelector: "a", dateSelector: "time" }
  };
  const empty = '<main><div class="news-wrapper birim-tum-icerikler-news"><p class="birim-tum-icerikler__empty">Gösterilecek içerik bulunmuyor.</p></div></main>';
  const row = (date, suffix = "test-123") => `<article class="news-card"><h2 class="title"><a href="/birim/icerik/5346/${suffix}">Öğrenci kayıt duyurusu</a></h2><time>${date}</time></article>`;
  const listing = (date) => `<main>${row(date)}</main>`;
  const paginated = { ...recipe, parserConfig: { ...recipe.parserConfig, maximumPages: 2, nextPageSelector: ".next-page", fetchDetail: false } };

  assert.equal(isSelcukUnitListingUrl(sourceUrl), true);
  assert.equal(isSelcukUnitListingUrl("https://selcuk.edu.tr:8443/birim/tumicerikler/5346/2"), false);
  assert.equal(isExplicitSelcukEmptyListing(empty, sourceUrl), true);
  assert.equal(isExplicitSelcukEmptyListing(empty, "https://untrusted.example/birim/tumicerikler/5346/2"), false);
  assert.equal(isInformationalListingCode("SOURCE_LISTING_EMPTY"), true);
  assert.equal(isInformationalListingCode("SOURCE_LISTING_STALE"), true);
  assert.equal(isInformationalListingCode("SOURCE_HTML_SELECTOR_LAYOUT_INVALID"), false);
  assert.throws(() => parseDeviceSourceRuntimeDocument(empty, recipe), /SOURCE_LISTING_EMPTY/);
  assert.throws(() => parseDeviceSourceRuntimeDocument(listing("2020-01-01"), recipe), /SOURCE_LISTING_STALE/);
  assert.equal(parseDeviceSourceRuntimeDocument(listing("2026-10-12"), recipe).length, 1);
  assert.throws(() => parseDeviceSourceRuntimeDocument(empty, { ...recipe, parserConfig: { ...recipe.parserConfig, dateSelector: "[[[" } }), /SOURCE_HTML_SELECTOR_INVALID/);
  assert.throws(() => parseDeviceSourceRuntimeDocument(listing("2026-10-12"), { ...recipe, parserConfig: { ...recipe.parserConfig, itemSelector: ".missing" } }), /SOURCE_HTML_SELECTOR_LAYOUT_INVALID/);
  assert.equal(parseDeviceSourceRuntimeDocument(listing("2026-10-12"), paginated).length, 1, "Boolean/numeric v4 options must not be parsed as CSS selectors");
  assert.deepEqual(parseDeviceSourceRuntimeDocument(listing("2020-01-01"), paginated), [], "An old archive page must preserve v4 pagination behavior");
  assert.deepEqual(parseDeviceSourceRuntimeDocument(listing("2020-01-01"), { ...recipe, sourceUrl: "https://example.edu.tr/announcements", allowedOfficialDomain: "example.edu.tr" }), [], "Stale hotfix must not alter unrelated university recipes");
  assert.equal(parseDeviceSourceRuntimeDocument(`<main>${Array.from({ length: 75 }, (_value, index) => row("2026-10-12", `test-${index}`)).join("")}</main>`, recipe).length, 60, "v4 maximum item limit must remain intact");

  const paginationRequests = [];
  const secondPageUrl = `${sourceUrl}?page=2`;
  const snapshot = await executeDeviceSourceRuntime(paginated, async (request) => {
    paginationRequests.push(request.url);
    assert.ok(request.url === sourceUrl || request.url === secondPageUrl, "Canary transport must only return in-memory fixtures");
    return { status: 200, finalUrl: request.url, contentType: "text/html",
      text: request.url === sourceUrl ? `<main>${row("2026-10-12", "fresh-1")}<a class="next-page" href="?page=2">Sonraki sayfa</a></main>` : listing("2020-01-01") };
  }, {}, { failOnPaginationError: true });
  assert.deepEqual(paginationRequests, [sourceUrl, secondPageUrl]);
  assert.equal(snapshot.items.length, 1, "A stale second page must not discard the fresh first page in strict ingestion");

  const retryLimits = [];
  assert.equal(await withSourcePreviewRetry(sourceUrl, 7000, async (timeoutMs) => {
    retryLimits.push(timeoutMs);
    if (retryLimits.length === 1) throw new Error("OUTBOUND_REQUEST_TIMEOUT");
    return "fixture";
  }), "fixture");
  assert.deepEqual(retryLimits, [7000, 10000]);
  let attempts = 0;
  await assert.rejects(withSourcePreviewRetry(sourceUrl, 7000, async () => {
    attempts++; throw new Error("OUTBOUND_REQUEST_TIMEOUT");
  }), /OUTBOUND_REQUEST_TIMEOUT/);
  assert.equal(attempts, 2, "Timeout retries must stop after the second attempt");
  for (const [url, limit, code] of [
    [sourceUrl, 7000, "SOURCE_HTML_SELECTOR_LAYOUT_INVALID"],
    [sourceUrl, 7000, "SOURCE_LISTING_EMPTY"],
    [sourceUrl, 7000, "SOURCE_RUNTIME_REDIRECT_REJECTED"],
    [sourceUrl, 20000, "OUTBOUND_REQUEST_TIMEOUT"],
    ["https://untrusted.example/birim/tumicerikler/5346/2", 7000, "OUTBOUND_REQUEST_TIMEOUT"]
  ]) {
    attempts = 0;
    await assert.rejects(withSourcePreviewRetry(url, limit, async () => {
      attempts++; throw new Error(code);
    }), new RegExp(code));
    assert.equal(attempts, 1, `${code} must not trigger an ineligible retry`);
  }

  return { status: "passed", runtimeVersion: DEVICE_SOURCE_RUNTIME_VERSION, parserUntouched: true,
    checks: ["empty", "stale", "fresh", "malformed-selector", "wrong-selector", "numeric-and-boolean-options", "maximum-items", "stale-second-page", "bounded-retry", "non-retry-errors"],
    externalRequests: 0, databaseWrites: 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) {
    console.error("Usage: node verify-admin-source-hotfix.mjs [application-root=/app]");
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await verifyAdminSourceHotfix(process.argv[2]), null, 2)); }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  }
}
