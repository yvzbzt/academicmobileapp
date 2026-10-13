import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This release is an overlay, not a rebuild of the older local API checkout.
// Refuse any production baseline other than the one inspected for this fix.
const baselineHashes = {
  "announcement-ingestion.service.js": "a38e34be359584aac4ea3c9f28725e3b9890d7b0ec5500b6cf3483acca3fda41",
  "device-source-runtime.js": "2aaeb3624fb9c0e46883ea38efd9520e2394e9e89b961c5336b049b0efad6108",
  "announcement-parser.js": "4b9daf66d2426e9bbaec0e1447da972e0ee3dadb3182993d5db2b766111e1bda"
};
const servicePath = "apps/api/src/modules/announcements/announcement-ingestion.service.js";
const runtimePath = "packages/shared/src/device-source-runtime.js";
const helperPaths = [
  "packages/shared/src/source-listing-state.js",
  "apps/api/src/modules/announcements/source-preview-retry.js"
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function replaceOnce(input, from, to, label) {
  const count = input.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one baseline match; found ${count}`);
  return input.replace(from, to);
}

function withoutSourceMap(input) {
  return input.replace(/^\/\/#[ \t]*sourceMappingURL=[^\r\n]*(?:\r?\n|$)/gm, "");
}

export async function buildAdminSourceHotfix(baselineDirectory, compiledDistDirectory, outputDirectory) {
  const baseline = resolve(baselineDirectory);
  const compiled = resolve(compiledDistDirectory);
  const output = resolve(outputDirectory);
  if ([baseline, compiled].some((input) => output === input || output.startsWith(`${input}/`) || input.startsWith(`${output}/`))) {
    throw new Error("Output must be separate from both input directories.");
  }
  const originals = {};
  for (const [name, expected] of Object.entries(baselineHashes)) {
    const bytes = await readFile(resolve(baseline, name));
    if (sha256(bytes) !== expected) throw new Error(`${name}: production baseline checksum mismatch`);
    originals[name] = bytes.toString("utf8");
  }

  let runtime = originals["device-source-runtime.js"];
  runtime = replaceOnce(runtime, 'import { load } from "cheerio/slim";\n',
    'import { load } from "cheerio/slim";\nimport { isExplicitSelcukEmptyListing, isSelcukUnitListingUrl } from "./source-listing-state.js";\n', "runtime import");
  runtime = replaceOnce(runtime, `        case "configured_html": {
            items = parseConfiguredHtml(body, recipe, baseUrl);
            if (items.length === 0)
                throw runtimeError("SOURCE_HTML_SELECTOR_LAYOUT_INVALID");`,
    `        case "configured_html": {
            items = parseConfiguredHtml(body, recipe, baseUrl);
            if (items.length === 0 && isExplicitSelcukEmptyListing(body, baseUrl))
                throw runtimeError("SOURCE_LISTING_EMPTY");
            if (items.length === 0)
                throw runtimeError("SOURCE_HTML_SELECTOR_LAYOUT_INVALID");`, "runtime explicit empty listing");
  runtime = replaceOnce(runtime, `    return filterFreshItems(items, recipe).slice(0, MAX_ITEMS);
}
export function isSourceChallengeDocument`,
    `    const freshItems = filterFreshItems(items, recipe).slice(0, MAX_ITEMS);
    // Scope the hotfix to the observed Selcuk listings. Preserve v4 archive
    // pagination, which intentionally permits an old second page.
    if (profile === "configured_html" && items.length > 0 && freshItems.length === 0
        && recipe.parserConfig?.maximumPages !== 2
        && isSelcukUnitListingUrl(baseUrl))
        throw runtimeError("SOURCE_LISTING_STALE");
    return freshItems;
}
export function isSourceChallengeDocument`, "runtime stale listing");
  runtime = replaceOnce(runtime, `        if (!config?.itemSelector)
            return [];
        const items = [];`,
    `        if (!config?.itemSelector)
            return [];
        // v4 also has numeric/boolean parser options: validate selectors only.
        for (const key of ["itemSelector", "titleSelector", "linkSelector", "dateSelector", "eventDateSelector", "contentSelector"]) {
            const selector = config[key];
            if (typeof selector === "string" && selector.trim())
                $(selector);
        }
        const items = [];`, "runtime selector validation");

  let service = originals["announcement-ingestion.service.js"];
  service = replaceOnce(service,
    'import { DEVICE_SOURCE_RUNTIME_VERSION } from "../../../../../packages/shared/src/device-source-runtime.js";\n',
    'import { isInformationalListingCode } from "../../../../../packages/shared/src/source-listing-state.js";\nimport { withSourcePreviewRetry } from "./source-preview-retry.js";\nimport { DEVICE_SOURCE_RUNTIME_VERSION } from "../../../../../packages/shared/src/device-source-runtime.js";\n', "service imports");
  service = replaceOnce(service,
    '            const snapshot = await fetchDeviceRuntimeSourceSnapshot(source.sourceUrl, source.parser, readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7000), { authority: authority.context, resource: sourceAuthorityResource(source.contentType) }, {}, source.contentType, testedAt, source.parserConfig);',
    '            const snapshot = await withSourcePreviewRetry(source.sourceUrl, readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7000), (timeoutMs) => fetchDeviceRuntimeSourceSnapshot(source.sourceUrl, source.parser, timeoutMs, { authority: authority.context, resource: sourceAuthorityResource(source.contentType) }, {}, source.contentType, testedAt, source.parserConfig));', "service preview retry");
  service = replaceOnce(service, `        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.announcementRepository.recordSourceCheck(source.id, {
                healthStatus: "failed",
                lastCheckedAt: testedAt,
                lastError: message,
                consecutiveFailures: (source.consecutiveFailures ?? 0) + 1
            }, source);
            return {
                sourceId: source.id,
                sourceName: source.sourceName,
                sourceUrl: source.sourceUrl,
                status: "failed",
                parsedItemCount: 0,`,
    `        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const informational = isInformationalListingCode(message);
            await this.announcementRepository.recordSourceCheck(source.id, {
                healthStatus: informational ? "degraded" : "failed",
                lastCheckedAt: testedAt,
                lastError: message,
                consecutiveFailures: informational ? 0 : (source.consecutiveFailures ?? 0) + 1
            }, source);
            return {
                sourceId: source.id,
                sourceName: source.sourceName,
                sourceUrl: source.sourceUrl,
                status: informational ? "degraded" : "failed",
                parsedItemCount: 0,`, "service preview classification");
  service = replaceOnce(service, `            const errorCode = healthProbeErrorCode(message);
            if (mode === "revision") {`,
    `            const errorCode = healthProbeErrorCode(message);
            if (isInformationalListingCode(errorCode)) {
                await this.persistHealthProbe(source, {
                    engineVersion: DEVICE_SOURCE_RUNTIME_VERSION, healthStatus: "degraded", lastCheckedAt: checkedAt,
                    ...fullHealthCheckTimestamp(source.healthProbe, mode, checkedAt),
                    ...(source.healthProbe?.lastSuccessAt ? { lastSuccessAt: source.healthProbe.lastSuccessAt } : {}),
                    lastError: errorCode, consecutiveFailures: 0, itemCount: 0,
                    ...(source.healthProbe?.contentHash ? { contentHash: source.healthProbe.contentHash } : {})
                });
                return { sourceId: source.id, status: "degraded", itemCount: 0, contentChanged: false, error: errorCode };
            }
            if (mode === "revision") {`, "service informational health probe");

  const outputs = new Map([
    [runtimePath, withoutSourceMap(runtime)],
    [servicePath, withoutSourceMap(service)]
  ]);
  for (const path of helperPaths) {
    const contents = withoutSourceMap(await readFile(resolve(compiled, path), "utf8"));
    const expectedExports = path.endsWith("source-listing-state.js")
      ? ["export function isExplicitSelcukEmptyListing(", "export function isSelcukUnitListingUrl(", "export function isInformationalListingCode("]
      : ["export async function withSourcePreviewRetry("];
    for (const declaration of expectedExports) {
      if (contents.split(declaration).length - 1 !== 1) throw new Error(`${path}: missing or duplicated helper export ${declaration}`);
    }
    outputs.set(path, contents);
  }
  if (!runtime.includes('DEVICE_SOURCE_RUNTIME_VERSION = "device-source-runtime-v4"')) throw new Error("Runtime version changed");
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length !== 0) throw new Error("Output directory must be empty; existing artifacts are never overwritten");
  const manifest = {
    release: "selcuk-empty-stale-preview-hotfix",
    runtimeVersion: "device-source-runtime-v4",
    baseline: baselineHashes,
    parserUntouched: true,
    files: {}
  };
  for (const [path, contents] of outputs) {
    const relative = `dist/${path}`;
    const target = resolve(output, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, { flag: "wx" });
    manifest.files[relative] = sha256(contents);
  }
  await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [baseline, compiled, output] = process.argv.slice(2);
  if (!baseline || !compiled || !output || process.argv.length !== 5) {
    console.error("Usage: node apply-admin-source-hotfix.mjs <baseline-dir> <compiled-dist-dir> <empty-output-dir>");
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify(await buildAdminSourceHotfix(baseline, compiled, output), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
