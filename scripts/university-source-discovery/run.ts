import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import { PDFParse } from "pdf-parse";
import {
  DISCOVERY_SCHEMA_VERSION,
  EXCLUDED_UNIVERSITIES,
  buildTargetManifest,
  canonicalizeUrl,
  classifyCandidateUrl,
  cleanVisibleText,
  detectDocumentType,
  detectSoft404,
  foldTurkishText,
  isExcludedDomain,
  isLikelyListingUrl,
  isOfficialUrl,
  registrableDomain,
  sha256,
  validateDocument,
  validateHtmlSemantic,
  type CanonicalUniversityRecord,
  type SourceType,
  type TargetManifest,
  type TargetUniversity,
  type TerminalStatus,
  type UniversityTreeRecord
} from "./core.js";

type RunMode = "prepare" | "pilot" | "run" | "revalidate" | "report";
type WorkStatus = "NOT_STARTED" | "DISCOVERING" | "VERIFYING" | "BLOCKED_RETRYABLE" | TerminalStatus;
type ScopeType = "university" | "faculty" | "department" | "program";

interface AcademicUnitSourceRecord {
  scopeType: "faculty" | "department";
  universityId: string;
  universityName?: string;
  facultyId?: string;
  facultyName?: string;
  departmentId?: string;
  departmentName?: string;
  websiteUrl?: string;
  announcementUrl?: string | null;
  newsUrl?: string | null;
  eventUrl?: string | null;
  courseScheduleUrl?: string | null;
  examScheduleUrl?: string | null;
}

interface CatalogSeed {
  source: string;
  sourceUrl: string;
  universities: Array<{
    name: string;
    slug: string;
    city: string;
    type: string;
    faculties: Array<{
      name: string;
      slug: string;
      departments: Array<{
        name: string;
        slug: string;
        educationLevel: string;
      }>;
    }>;
  }>;
}

interface SourceCandidate {
  candidateId: string;
  universityId: string;
  universityName: string;
  officialHomepageUrl: string;
  officialDomains: string[];
  scopeType: ScopeType;
  scopeId: string;
  scopeName: string;
  facultyId?: string;
  facultyName?: string;
  departmentId?: string;
  departmentName?: string;
  sourceType: SourceType;
  sourceUrl: string;
  parentUrl?: string;
  anchorText?: string;
  selector?: string;
  discoveryMethod: "canonical_registry" | "academic_unit_registry" | "navigation" | "sitemap" | "internal_search";
  publicationScope: "university" | "faculty_shared" | "department_specific" | "university_system";
}

interface ExtractedLink {
  url: string;
  text: string;
  selector: string;
}

interface DetailSample {
  url: string;
  finalUrl?: string;
  title?: string;
  status: "verified" | "rejected" | "blocked" | "request_failed";
  httpStatus?: number;
  meaningfulTextLength?: number;
}

interface VerificationRecord {
  schemaVersion: number;
  candidateId: string;
  universityId: string;
  universityName: string;
  officialHomepageUrl: string;
  unitType: ScopeType;
  facultyOrUnitName?: string;
  departmentOrProgramName?: string;
  scopeId: string;
  sourceType: SourceType;
  sourceUrl: string;
  finalUrl?: string;
  parentUrl?: string;
  anchorText?: string;
  selector?: string;
  discoveryMethod: SourceCandidate["discoveryMethod"];
  publicationScope: SourceCandidate["publicationScope"];
  language?: string;
  browserOpened: boolean;
  clickedFromParent: boolean;
  redirectChain: string[];
  httpStatus?: number;
  contentType?: string;
  responseByteLength?: number;
  domMeaningfulTextLength?: number;
  pageTitle?: string;
  mainHeading?: string;
  listingItemCount?: number;
  sampleItemUrls?: string[];
  sampleDetails?: DetailSample[];
  semanticMatch: boolean;
  semanticReasons: string[];
  soft404: boolean;
  officialDomain: boolean;
  transportInsecure: boolean;
  verifiedAt: string;
  sha256?: string;
  evidencePath?: string;
  screenshotPath?: string;
  status: "verified" | "rejected" | "blocked" | "request_failed";
  finalRevalidatedAt?: string;
}

interface AcademicUnitInventoryRecord {
  universityId: string;
  universityName: string;
  scopeType: "faculty" | "department";
  scopeId: string;
  scopeName: string;
  facultyId: string;
  facultyName: string;
  departmentId?: string;
  departmentName?: string;
  educationLevel?: string;
  officialUrl?: string;
  source: "yok_atlas_catalog";
  status: WorkStatus;
  evidenceCandidateId?: string;
  evidencePath?: string;
}

interface UniversityResult {
  schemaVersion: number;
  universityId: string;
  universityName: string;
  startedAt: string;
  completedAt: string;
  status: TerminalStatus;
  candidates: SourceCandidate[];
  verifications: VerificationRecord[];
  academicUnits: AcademicUnitInventoryRecord[];
  requiredSourceStatus: Record<"announcement" | "news" | "event" | "academic_calendar", TerminalStatus>;
  notes: string[];
}

interface UniversityProgress {
  schemaVersion: number;
  universityId: string;
  universityName: string;
  startedAt: string;
  updatedAt: string;
  sitemapDiscoveryComplete: boolean;
  candidates: SourceCandidate[];
  verifications: VerificationRecord[];
  academicUnits: AcademicUnitInventoryRecord[];
}

interface CheckpointTarget {
  universityId: string;
  universityName: string;
  status: WorkStatus;
  attempts: number;
  startedAt?: string;
  lastProcessedAt?: string;
  completedAt?: string;
  lastError?: string;
  resultPath?: string;
  continuationRequired?: boolean;
}

interface Checkpoint {
  schemaVersion: number;
  manifestSha256: string;
  createdAt: string;
  updatedAt: string;
  browserExecutable: string;
  targets: Record<string, CheckpointTarget>;
  finalRevalidation?: {
    startedAt: string;
    completedAt?: string;
    total: number;
    passed: number;
    failed: number;
  };
}

interface CliOptions {
  mode: RunMode;
  outputDir: string;
  onlyIds: string[];
  limit?: number;
  maxAttempts: number;
  universityConcurrency: number;
  candidateConcurrency: number;
  maxCandidatesPerUniversity: number;
  navigationTimeoutMs: number;
  screenshotMode: "representative" | "all" | "none";
}

interface LoadedInputs {
  sources: CanonicalUniversityRecord[];
  units: AcademicUnitSourceRecord[];
  catalog: CatalogSeed;
  tree: { universities: UniversityTreeRecord[] };
}

interface VerificationRuntime {
  context: BrowserContext;
  options: CliOptions;
  outputDir: string;
  screenshotTakenForUniversity: Set<string>;
}

const root = resolve(process.cwd());
const sourcePath = join(root, "apps/api/src/bootstrap/verified-university-sources.json");
const academicUnitSourcePath = join(root, "apps/api/src/bootstrap/verified-academic-unit-sources.json");
const catalogPath = join(root, "apps/api/src/bootstrap/turkiye-catalog-seed.json");
const facultyTreePath = join(root, "data/yok-university-faculty-tree.json");
const defaultOutputDir = join(root, "artifacts/university-source-discovery");
const promptPath = process.env.UNIVERSITY_DISCOVERY_PROMPT_PATH ?? "<USER_INPUT_ROOT>\\university-autonomous-discovery-verification-prompt.md";
const manualExcludedInputPath = process.env.UNIVERSITY_MANUAL_INPUT_PATH ?? "<USER_INPUT_ROOT>\\üniversiteANS.txt";
const akdenizInputPaths = (process.env.AKDENIZ_INPUT_PATHS ?? [
  "<SOURCE_ATTACHMENT_ROOT>\\970460d3-25e1-4f4a-8110-3a1b55aa2b20\\pasted-text.txt",
  "<SOURCE_ATTACHMENT_ROOT>\\db20dce0-ae33-4e58-9398-d6e59753ea67\\pasted-text.txt",
  "<SOURCE_ATTACHMENT_ROOT>\\6cc9e7ef-f44e-4458-9174-1fc2297e5cce\\pasted-text.txt"
].join(";")).split(";").filter(Boolean);

const requiredUniversitySourceTypes = ["announcement", "news", "event", "academic_calendar"] as const;
const terminalStatuses = new Set<WorkStatus>(["VERIFIED_COMPLETE", "NOT_FOUND_VERIFIED", "BLOCKED_FINAL", "NEEDS_REVIEW"]);
const documentExtensions = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg"]);
let checkpointWriteQueue: Promise<void> = Promise.resolve();

const options = readCliOptions(process.argv.slice(2));
await main(options);

async function main(cli: CliOptions): Promise<void> {
  await ensureOutputDirectories(cli.outputDir);
  const inputs = await loadInputs();
  const manifest = await prepareManifestAndAudit(inputs, cli.outputDir);
  const browserExecutable = findBrowserExecutable();
  await proveBrowserReadiness(browserExecutable, cli.outputDir);
  const checkpoint = await loadOrCreateCheckpoint(manifest, browserExecutable, cli.outputDir);

  if (cli.mode === "prepare") {
    await aggregateArtifacts(manifest, checkpoint, inputs, cli.outputDir);
    return;
  }
  if (cli.mode === "report") {
    await aggregateArtifacts(manifest, checkpoint, inputs, cli.outputDir);
    return;
  }

  const browser = await launchBrowser(browserExecutable);
  try {
    const context = await createBrowserContext(browser);
    const runtime: VerificationRuntime = {
      context,
      options: cli,
      outputDir: cli.outputDir,
      screenshotTakenForUniversity: new Set()
    };
    if (cli.mode === "revalidate") {
      await finalRevalidate(manifest, checkpoint, inputs, runtime);
    } else {
      await runDiscovery(manifest, checkpoint, inputs, runtime, cli.mode === "pilot");
      if (cli.mode === "run" && allTargetsTerminal(checkpoint)) {
        await finalRevalidate(manifest, checkpoint, inputs, runtime);
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }

  await aggregateArtifacts(manifest, checkpoint, inputs, cli.outputDir);
}

function readCliOptions(args: string[]): CliOptions {
  const modeValue = args[0] ?? "prepare";
  if (!new Set(["prepare", "pilot", "run", "revalidate", "report"]).has(modeValue)) {
    throw new Error(`Unknown discovery mode: ${modeValue}`);
  }
  const readArg = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  };
  const onlyIds = (readArg("only") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const limitValue = readArg("limit");
  const screenshot = readArg("screenshots") ?? "representative";
  if (!new Set(["representative", "all", "none"]).has(screenshot)) throw new Error(`Invalid screenshot mode: ${screenshot}`);
  return {
    mode: modeValue as RunMode,
    outputDir: resolve(readArg("output") ?? process.env.UNIVERSITY_DISCOVERY_OUTPUT ?? defaultOutputDir),
    onlyIds,
    ...(limitValue ? { limit: readPositiveInteger(limitValue, 0) } : {}),
    maxAttempts: readPositiveInteger(readArg("max-attempts") ?? process.env.UNIVERSITY_DISCOVERY_MAX_ATTEMPTS, 2),
    universityConcurrency: readPositiveInteger(readArg("university-concurrency") ?? process.env.UNIVERSITY_DISCOVERY_UNIVERSITY_CONCURRENCY, 1),
    candidateConcurrency: readPositiveInteger(readArg("candidate-concurrency") ?? process.env.UNIVERSITY_DISCOVERY_CANDIDATE_CONCURRENCY, 3),
    maxCandidatesPerUniversity: readPositiveInteger(readArg("max-candidates") ?? process.env.UNIVERSITY_DISCOVERY_MAX_CANDIDATES_PER_UNIVERSITY, 700),
    navigationTimeoutMs: readPositiveInteger(readArg("timeout-ms") ?? process.env.UNIVERSITY_DISCOVERY_TIMEOUT_MS, 20_000),
    screenshotMode: screenshot as CliOptions["screenshotMode"]
  };
}

async function loadInputs(): Promise<LoadedInputs> {
  const [sources, units, catalog, tree] = await Promise.all([
    readJsonFile<CanonicalUniversityRecord[]>(sourcePath),
    readJsonFile<AcademicUnitSourceRecord[]>(academicUnitSourcePath),
    readJsonFile<CatalogSeed>(catalogPath),
    readJsonFile<{ universities: UniversityTreeRecord[] }>(facultyTreePath)
  ]);
  return { sources, units, catalog, tree };
}

async function prepareManifestAndAudit(inputs: LoadedInputs, outputDir: string): Promise<TargetManifest> {
  const manifest = buildTargetManifest(inputs.sources, inputs.tree.universities);
  const targetsById = new Map(manifest.targets.map((target) => [target.universityId, target]));
  for (const unit of inputs.units) {
    const target = targetsById.get(unit.universityId);
    if (!target) continue;
    const domains = new Set(target.officialDomains);
    for (const value of [unit.websiteUrl, unit.announcementUrl, unit.newsUrl, unit.eventUrl, unit.courseScheduleUrl, unit.examScheduleUrl]) {
      const domain = typeof value === "string" ? registrableDomain(value) : null;
      if (domain?.endsWith(".edu.tr") && !isExcludedDomain(domain)) domains.add(domain);
    }
    target.officialDomains = [...domains].sort();
  }
  await writeJsonAtomic(join(outputDir, "target-universities.json"), manifest);

  const files = [
    { role: "execution_prompt", path: promptPath },
    { role: "six_manually_handled_universities", path: manualExcludedInputPath },
    ...akdenizInputPaths.map((path) => ({ role: "akdeniz_manually_handled_sources", path }))
  ];
  const auditedFiles = await Promise.all(files.map(async (file) => {
    const data = await readFile(file.path);
    const text = data.toString("utf8").replace(/^\uFEFF/u, "");
    const urls = extractHttpUrls(text);
    return {
      role: file.role,
      fileName: basename(file.path),
      byteLength: data.byteLength,
      sha256: sha256(data),
      urlCount: urls.length,
      uniqueUrlCount: new Set(urls).size,
      domains: countBy(urls.map((url) => registrableDomain(url) ?? "invalid"))
    };
  }));
  const akdenizHashes = new Set(auditedFiles.filter((file) => file.role === "akdeniz_manually_handled_sources").map((file) => file.sha256));
  const manualDomains = auditedFiles.find((file) => file.role === "six_manually_handled_universities")?.domains ?? {};
  const expectedManualDomains = EXCLUDED_UNIVERSITIES.slice(0, 6).flatMap((record) => record.domains);
  const missingManualDomains = expectedManualDomains.filter((domain) => !(domain in manualDomains));
  if (akdenizHashes.size !== 1) throw new Error("The three supplied Akdeniz attachments are not identical.");
  if (missingManualDomains.length > 0) throw new Error(`Manual excluded input is missing domains: ${missingManualDomains.join(", ")}`);
  await writeJsonAtomic(join(outputDir, "excluded-input-audit.json"), {
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    exclusionCount: manifest.exclusionCount,
    exclusions: manifest.exclusions,
    files: auditedFiles,
    duplicateAkdenizAttachmentCount: Math.max(0, akdenizInputPaths.length - akdenizHashes.size),
    validation: {
      targetCountIs198: manifest.targetCount === 198,
      exclusionCountIs7: manifest.exclusionCount === 7,
      allManualDomainsPresent: missingManualDomains.length === 0,
      akdenizAttachmentsIdentical: akdenizHashes.size === 1
    }
  });
  return manifest;
}

function findBrowserExecutable(): string {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      if (requireFileExists(candidate)) return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("No local Chrome or Edge executable was found for Playwright.");
}

function requireFileExists(path: string): boolean {
  // Node's synchronous check is intentional here because browser startup cannot proceed without it.
  return Boolean(process.getBuiltinModule("fs")?.existsSync(path));
}

async function proveBrowserReadiness(executablePath: string, outputDir: string): Promise<void> {
  const browser = await launchBrowser(executablePath);
  try {
    const page = await browser.newPage();
    await page.setContent("<title>browser-ready</title><main>ready</main>");
    const proof = {
      checkedAt: new Date().toISOString(),
      ready: (await page.title()) === "browser-ready" && (await page.locator("main").innerText()) === "ready",
      browserVersion: browser.version(),
      executablePath
    };
    await writeJsonAtomic(join(outputDir, "browser-readiness.json"), proof);
    await page.close();
    if (!proof.ready) throw new Error("Playwright browser readiness proof failed.");
  } finally {
    await browser.close();
  }
}

async function launchBrowser(executablePath: string): Promise<Browser> {
  return chromium.launch({ headless: true, executablePath });
}

async function createBrowserContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36 AcademicSourceVerifier/1.0",
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    ignoreHTTPSErrors: true
  });
  await context.route("**/*", async (route) => {
    const resourceType = route.request().resourceType();
    if (resourceType === "media" || resourceType === "font") await route.abort();
    else await route.continue();
  });
  return context;
}

async function loadOrCreateCheckpoint(manifest: TargetManifest, browserExecutable: string, outputDir: string): Promise<Checkpoint> {
  const checkpointPath = join(outputDir, "checkpoint.json");
  const manifestHash = sha256(JSON.stringify(manifest.targets));
  const existing = await readOptionalJsonFile<Checkpoint>(checkpointPath);
  if (existing) {
    if (existing.schemaVersion !== DISCOVERY_SCHEMA_VERSION) {
      throw new Error(`Checkpoint schema ${existing.schemaVersion} is stale; archive the output directory and prepare a fresh schema ${DISCOVERY_SCHEMA_VERSION} run.`);
    }
    if (existing.manifestSha256 !== manifestHash) throw new Error("Target manifest changed; use a new output directory for this run.");
    let recoveredInterruptedState = false;
    for (const target of Object.values(existing.targets)) {
      if (target.status !== "DISCOVERING" && target.status !== "VERIFYING") continue;
      target.status = "BLOCKED_RETRYABLE";
      target.continuationRequired = true;
      target.lastError = "Previous process ended before the current candidate batch was checkpointed.";
      recoveredInterruptedState = true;
    }
    if (recoveredInterruptedState) await saveCheckpoint(existing, outputDir);
    return existing;
  }
  const now = new Date().toISOString();
  const checkpoint: Checkpoint = {
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    manifestSha256: manifestHash,
    createdAt: now,
    updatedAt: now,
    browserExecutable,
    targets: Object.fromEntries(manifest.targets.map((target) => [target.universityId, {
      universityId: target.universityId,
      universityName: target.universityName,
      status: "NOT_STARTED" as const,
      attempts: 0
    }]))
  };
  await saveCheckpoint(checkpoint, outputDir);
  return checkpoint;
}

async function ensureOutputDirectories(outputDir: string): Promise<void> {
  await Promise.all([
    mkdir(outputDir, { recursive: true }),
    mkdir(join(outputDir, "state/universities"), { recursive: true }),
    mkdir(join(outputDir, "state/progress"), { recursive: true }),
    mkdir(join(outputDir, "evidence/html"), { recursive: true }),
    mkdir(join(outputDir, "evidence/documents"), { recursive: true }),
    mkdir(join(outputDir, "evidence/screenshots"), { recursive: true })
  ]);
}

async function runDiscovery(
  manifest: TargetManifest,
  checkpoint: Checkpoint,
  inputs: LoadedInputs,
  runtime: VerificationRuntime,
  pilot: boolean
): Promise<void> {
  const defaultPilotIds = [
    "bingol-universitesi",
    "ankara-universitesi",
    "izmir-yuksek-teknoloji-enstitusu"
  ];
  const requestedIds = runtime.options.onlyIds.length > 0
    ? new Set(runtime.options.onlyIds)
    : pilot
      ? new Set(defaultPilotIds)
      : null;
  let targets = manifest.targets.filter((target) => !requestedIds || requestedIds.has(target.universityId));
  targets = [...targets].sort((left, right) => {
    const priority = (target: TargetUniversity): number => {
      const status = checkpoint.targets[target.universityId]?.status;
      if (status === "NOT_STARTED") return 0;
      if (status && terminalStatuses.has(status)) return 2;
      return 1;
    };
    const priorityDifference = priority(left) - priority(right);
    if (priorityDifference !== 0) return priorityDifference;
    const leftProcessedAt = checkpoint.targets[left.universityId]?.lastProcessedAt ?? "";
    const rightProcessedAt = checkpoint.targets[right.universityId]?.lastProcessedAt ?? "";
    return leftProcessedAt.localeCompare(rightProcessedAt);
  });
  if (runtime.options.limit !== undefined) targets = targets.slice(0, runtime.options.limit);
  if (requestedIds) {
    const missing = [...requestedIds].filter((id) => !manifest.targets.some((target) => target.universityId === id));
    if (missing.length > 0) throw new Error(`Requested targets are absent or excluded: ${missing.join(", ")}`);
  }

  await logRun(
    runtime.outputDir,
    `Starting ${pilot ? "pilot" : "full"} discovery for ${targets.length} universities with ${runtime.options.universityConcurrency} university worker(s).`
  );
  let nextTargetIndex = 0;
  let processedTargetCount = 0;
  let aggregationQueue: Promise<void> = Promise.resolve();
  const aggregationInterval = Math.max(4, runtime.options.universityConcurrency * 2);
  const scheduleAggregation = async (): Promise<void> => {
    const aggregate = async (): Promise<void> => aggregateArtifacts(manifest, checkpoint, inputs, runtime.outputDir);
    aggregationQueue = aggregationQueue.then(aggregate, aggregate);
    await aggregationQueue;
  };
  const runWorker = async (): Promise<void> => {
    while (true) {
      const targetIndex = nextTargetIndex;
      nextTargetIndex += 1;
      const target = targets[targetIndex];
      if (!target) return;
      await processDiscoveryTarget(target, checkpoint, inputs, runtime);
      processedTargetCount += 1;
      if (processedTargetCount % aggregationInterval === 0) await scheduleAggregation();
    }
  };
  const workerCount = Math.min(runtime.options.universityConcurrency, targets.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  await aggregationQueue;
}

async function processDiscoveryTarget(
  target: TargetUniversity,
  checkpoint: Checkpoint,
  inputs: LoadedInputs,
  runtime: VerificationRuntime
): Promise<void> {
  const checkpointTarget = checkpoint.targets[target.universityId];
  if (!checkpointTarget) throw new Error(`Checkpoint target missing: ${target.universityId}`);
  if (terminalStatuses.has(checkpointTarget.status)) {
    await logRun(runtime.outputDir, `Skipping terminal target ${target.universityId}: ${checkpointTarget.status}.`);
    return;
  }
  if (checkpointTarget.status === "BLOCKED_RETRYABLE" && checkpointTarget.attempts >= runtime.options.maxAttempts && !checkpointTarget.continuationRequired) {
    checkpointTarget.status = "BLOCKED_FINAL";
    checkpointTarget.lastProcessedAt = new Date().toISOString();
    checkpointTarget.completedAt = new Date().toISOString();
    return;
  }

  checkpointTarget.status = "DISCOVERING";
  checkpointTarget.attempts += 1;
  checkpointTarget.startedAt ??= new Date().toISOString();
  delete checkpointTarget.lastError;
  await saveCheckpoint(checkpoint, runtime.outputDir);
  await logRun(runtime.outputDir, `Processing ${target.universityId}, attempt ${checkpointTarget.attempts}.`);

  try {
    checkpointTarget.status = "VERIFYING";
    await saveCheckpoint(checkpoint, runtime.outputDir);
    const result = await processUniversity(target, inputs, runtime);
    const resultPath = universityResultPath(runtime.outputDir, target.universityId);
    await writeJsonAtomic(resultPath, result);
    checkpointTarget.resultPath = toArtifactPath(runtime.outputDir, resultPath);
    const continuationRequired = result.notes.some((note) => note.startsWith("Candidate pass limit reached:"));
    if (continuationRequired) {
      checkpointTarget.status = "BLOCKED_RETRYABLE";
      checkpointTarget.continuationRequired = true;
      delete checkpointTarget.completedAt;
      await logRun(runtime.outputDir, `Checkpointed partial ${target.universityId}; candidates=${result.verifications.length}/${result.candidates.length}.`);
    } else {
      await rm(universityProgressPath(runtime.outputDir, target.universityId), { force: true });
      checkpointTarget.status = result.status;
      checkpointTarget.completedAt = result.completedAt;
      delete checkpointTarget.continuationRequired;
      await logRun(runtime.outputDir, `Completed ${target.universityId}: ${result.status}; verified=${result.verifications.filter((item) => item.status === "verified").length}.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    checkpointTarget.lastError = message;
    delete checkpointTarget.continuationRequired;
    checkpointTarget.status = checkpointTarget.attempts >= runtime.options.maxAttempts ? "BLOCKED_FINAL" : "BLOCKED_RETRYABLE";
    if (checkpointTarget.status === "BLOCKED_FINAL") checkpointTarget.completedAt = new Date().toISOString();
    await logRun(runtime.outputDir, `Failed ${target.universityId}: ${message.replace(/\s+/gu, " ").slice(0, 1000)}.`);
  }
  checkpointTarget.lastProcessedAt = new Date().toISOString();
  await saveCheckpoint(checkpoint, runtime.outputDir);
}

async function processUniversity(
  target: TargetUniversity,
  inputs: LoadedInputs,
  runtime: VerificationRuntime
): Promise<UniversityResult> {
  const startedAt = new Date().toISOString();
  const { candidates: seedCandidates, academicUnits } = buildUniversityWork(target, inputs);
  const progressPath = universityProgressPath(runtime.outputDir, target.universityId);
  const savedProgress = await readOptionalJsonFile<UniversityProgress>(progressPath);
  const queue = dedupeCandidates([...(savedProgress?.candidates ?? []), ...seedCandidates]);
  const queuedIds = new Set(queue.map((candidate) => candidate.candidateId));
  const verifications: VerificationRecord[] = [...(savedProgress?.verifications ?? [])];
  const completedCandidateIds = new Set(verifications.map((record) => record.candidateId));
  const workingAcademicUnits = savedProgress?.academicUnits ?? academicUnits;
  const passLimit = verifications.length + runtime.options.maxCandidatesPerUniversity;
  let sitemapDiscoveryComplete = savedProgress?.sitemapDiscoveryComplete ?? false;
  let lastSavedVerificationCount = verifications.length;
  const persistProgress = async (force = false): Promise<void> => {
    if (!force && verifications.length - lastSavedVerificationCount < 16) return;
    await saveUniversityProgress(progressPath, {
      schemaVersion: DISCOVERY_SCHEMA_VERSION,
      universityId: target.universityId,
      universityName: target.universityName,
      startedAt: savedProgress?.startedAt ?? startedAt,
      updatedAt: new Date().toISOString(),
      sitemapDiscoveryComplete,
      candidates: queue,
      verifications,
      academicUnits: workingAcademicUnits
    });
    lastSavedVerificationCount = verifications.length;
  };

  const homepageIndex = queue.findIndex((candidate) => candidate.sourceType === "homepage");
  if (homepageIndex > 0) {
    const homepage = queue.splice(homepageIndex, 1)[0];
    if (homepage) queue.unshift(homepage);
  }

  while (verifications.length < passLimit) {
    const batch = queue
      .filter((candidate) => !completedCandidateIds.has(candidate.candidateId))
      .slice(0, Math.min(runtime.options.candidateConcurrency, passLimit - verifications.length));
    if (batch.length === 0) break;
    const results = await Promise.all(batch.map(async (candidate) => {
      const result = await verifyCandidate(candidate, runtime);
      return { candidate, ...result };
    }));
    for (const { candidate, record, links } of results) {
      verifications.push(record);
      completedCandidateIds.add(candidate.candidateId);
      if (record.status !== "verified" || !["homepage", "academic_unit_page"].includes(candidate.sourceType)) continue;
      for (const link of links) {
        const sourceType = classifyCandidateUrl(link.url, link.text);
        if (!sourceType || sourceType === "exam_schedule") continue;
        if (["announcement", "news", "event"].includes(sourceType) && !isLikelyListingUrl(link.url, sourceType, link.text)) continue;
        const discovered = makeCandidate({
          target: { ...target, officialDomains: candidate.officialDomains },
          scopeType: candidate.scopeType,
          scopeId: candidate.scopeId,
          scopeName: candidate.scopeName,
          ...(candidate.facultyId ? { facultyId: candidate.facultyId } : {}),
          ...(candidate.facultyName ? { facultyName: candidate.facultyName } : {}),
          ...(candidate.departmentId ? { departmentId: candidate.departmentId } : {}),
          ...(candidate.departmentName ? { departmentName: candidate.departmentName } : {}),
          sourceType,
          sourceUrl: link.url,
          parentUrl: record.finalUrl ?? candidate.sourceUrl,
          anchorText: link.text,
          selector: link.selector,
          discoveryMethod: "navigation"
        });
        if (discovered && !queuedIds.has(discovered.candidateId)) {
          queue.push(discovered);
          queuedIds.add(discovered.candidateId);
        }
      }
    }
    await persistProgress();
  }

  if (!sitemapDiscoveryComplete && verifications.length < passLimit) {
    const sitemapCandidates = await discoverSitemapCandidates(target, runtime);
    for (const candidate of sitemapCandidates) {
      if (completedCandidateIds.has(candidate.candidateId) || queuedIds.has(candidate.candidateId)) continue;
      queue.push(candidate);
      queuedIds.add(candidate.candidateId);
    }
    sitemapDiscoveryComplete = true;
    await persistProgress(true);
  }
  while (verifications.length < passLimit) {
    const batch = queue
      .filter((candidate) => !completedCandidateIds.has(candidate.candidateId))
      .slice(0, Math.min(runtime.options.candidateConcurrency, passLimit - verifications.length));
    if (batch.length === 0) break;
    const results = await Promise.all(batch.map(async (candidate) => ({ candidate, ...(await verifyCandidate(candidate, runtime)) })));
    for (const result of results) {
      verifications.push(result.record);
      completedCandidateIds.add(result.candidate.candidateId);
    }
    await persistProgress();
  }

  reconcileAcademicUnits(workingAcademicUnits, verifications);
  const requiredSourceStatus = buildRequiredSourceStatus(verifications);
  const notes: string[] = [];
  const pendingCandidateCount = queue.filter((candidate) => !completedCandidateIds.has(candidate.candidateId)).length;
  if (pendingCandidateCount > 0) notes.push(`Candidate pass limit reached: ${verifications.length}/${queue.length}; pending=${pendingCandidateCount}.`);
  const status = deriveUniversityStatus(verifications, workingAcademicUnits, requiredSourceStatus);
  await persistProgress(true);

  return {
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    universityId: target.universityId,
    universityName: target.universityName,
    startedAt: savedProgress?.startedAt ?? startedAt,
    completedAt: new Date().toISOString(),
    status,
    candidates: queue,
    verifications,
    academicUnits: workingAcademicUnits,
    requiredSourceStatus,
    notes
  };
}

function buildUniversityWork(
  target: TargetUniversity,
  inputs: LoadedInputs
): { candidates: SourceCandidate[]; academicUnits: AcademicUnitInventoryRecord[] } {
  const source = inputs.sources.find((record) => record.universityId === target.universityId);
  const catalogUniversity = inputs.catalog.universities.find((record) => record.slug === target.universityId);
  if (!source) throw new Error(`University source record missing: ${target.universityId}`);
  if (!catalogUniversity) throw new Error(`YÖK Atlas catalog record missing: ${target.universityId}`);
  const existingUnits = inputs.units.filter((record) => record.universityId === target.universityId);
  const officialDomains = new Set(target.officialDomains);
  for (const unit of existingUnits) {
    for (const value of [unit.websiteUrl, unit.announcementUrl, unit.newsUrl, unit.eventUrl, unit.courseScheduleUrl, unit.examScheduleUrl]) {
      const domain = typeof value === "string" ? registrableDomain(value) : null;
      if (domain?.endsWith(".edu.tr") && !isExcludedDomain(domain)) officialDomains.add(domain);
    }
  }
  const effectiveTarget: TargetUniversity = { ...target, officialDomains: [...officialDomains].sort() };
  const candidates: SourceCandidate[] = [];
  const academicUnits: AcademicUnitInventoryRecord[] = [];

  addCandidate(candidates, makeCandidate({
    target: effectiveTarget,
    scopeType: "university",
    scopeId: target.universityId,
    scopeName: target.universityName,
    sourceType: "homepage",
    sourceUrl: target.officialHomepageUrl,
    discoveryMethod: "canonical_registry"
  }));
  const universityFields: Array<[SourceType, string | null | undefined]> = [
    ["announcement", source.announcementUrl],
    ["news", source.newsUrl],
    ["event", source.eventUrl],
    ["academic_calendar", source.calendarUrl]
  ];
  for (const [sourceType, sourceUrl] of universityFields) {
    if (!sourceUrl) continue;
    addCandidate(candidates, makeCandidate({
      target: effectiveTarget,
      scopeType: "university",
      scopeId: target.universityId,
      scopeName: target.universityName,
      sourceType,
      sourceUrl,
      parentUrl: target.officialHomepageUrl,
      discoveryMethod: "canonical_registry"
    }));
  }

  const existingByScopeId = new Map<string, AcademicUnitSourceRecord>();
  for (const unit of existingUnits) {
    const scopeId = unit.scopeType === "faculty" ? unit.facultyId : unit.departmentId;
    if (scopeId && !existingByScopeId.has(scopeId)) existingByScopeId.set(scopeId, unit);
  }

  for (const faculty of catalogUniversity.faculties) {
    const facultyId = `${target.universityId}__${faculty.slug}`;
    const existingFaculty = existingByScopeId.get(facultyId);
    academicUnits.push({
      universityId: target.universityId,
      universityName: target.universityName,
      scopeType: "faculty",
      scopeId: facultyId,
      scopeName: faculty.name,
      facultyId,
      facultyName: faculty.name,
      ...(existingFaculty?.websiteUrl ? { officialUrl: existingFaculty.websiteUrl } : {}),
      source: "yok_atlas_catalog",
      status: existingFaculty?.websiteUrl ? "NOT_STARTED" : "NEEDS_REVIEW"
    });
    if (existingFaculty) addAcademicUnitCandidates(candidates, effectiveTarget, existingFaculty, facultyId, faculty.name);

    for (const department of faculty.departments) {
      const departmentId = `${facultyId}__${department.slug}`;
      const existingDepartment = existingByScopeId.get(departmentId);
      academicUnits.push({
        universityId: target.universityId,
        universityName: target.universityName,
        scopeType: "department",
        scopeId: departmentId,
        scopeName: department.name,
        facultyId,
        facultyName: faculty.name,
        departmentId,
        departmentName: department.name,
        educationLevel: department.educationLevel,
        ...(existingDepartment?.websiteUrl ? { officialUrl: existingDepartment.websiteUrl } : {}),
        source: "yok_atlas_catalog",
        status: existingDepartment?.websiteUrl ? "NOT_STARTED" : "NEEDS_REVIEW"
      });
      if (existingDepartment) addAcademicUnitCandidates(candidates, effectiveTarget, existingDepartment, departmentId, department.name);
    }
  }

  for (const existingUnit of existingUnits) {
    const scopeId = existingUnit.scopeType === "faculty" ? existingUnit.facultyId : existingUnit.departmentId;
    if (!scopeId || existingByScopeId.get(scopeId) !== existingUnit) continue;
    if (academicUnits.some((unit) => unit.scopeId === scopeId)) continue;
    const scopeName = existingUnit.scopeType === "faculty" ? existingUnit.facultyName : existingUnit.departmentName;
    if (!scopeName) continue;
    academicUnits.push({
      universityId: target.universityId,
      universityName: target.universityName,
      scopeType: existingUnit.scopeType,
      scopeId,
      scopeName,
      facultyId: existingUnit.facultyId ?? scopeId,
      facultyName: existingUnit.facultyName ?? scopeName,
      ...(existingUnit.departmentId ? { departmentId: existingUnit.departmentId } : {}),
      ...(existingUnit.departmentName ? { departmentName: existingUnit.departmentName } : {}),
      ...(existingUnit.websiteUrl ? { officialUrl: existingUnit.websiteUrl } : {}),
      source: "yok_atlas_catalog",
      status: existingUnit.websiteUrl ? "NOT_STARTED" : "NEEDS_REVIEW"
    });
    addAcademicUnitCandidates(candidates, effectiveTarget, existingUnit, scopeId, scopeName);
  }

  return { candidates: dedupeCandidates(candidates), academicUnits };
}

function addAcademicUnitCandidates(
  candidates: SourceCandidate[],
  target: TargetUniversity,
  unit: AcademicUnitSourceRecord,
  scopeId: string,
  scopeName: string
): void {
  const scopeType = unit.scopeType;
  const common = {
    target,
    scopeType,
    scopeId,
    scopeName,
    ...(unit.facultyId ? { facultyId: unit.facultyId } : {}),
    ...(unit.facultyName ? { facultyName: unit.facultyName } : {}),
    ...(unit.departmentId ? { departmentId: unit.departmentId } : {}),
    ...(unit.departmentName ? { departmentName: unit.departmentName } : {}),
    discoveryMethod: "academic_unit_registry" as const
  };
  if (unit.websiteUrl) addCandidate(candidates, makeCandidate({ ...common, sourceType: "academic_unit_page", sourceUrl: unit.websiteUrl }));
  const fields: Array<[SourceType, string | null | undefined]> = [
    ["announcement", unit.announcementUrl],
    ["news", unit.newsUrl],
    ["event", unit.eventUrl],
    ["course_schedule", unit.courseScheduleUrl],
    ["exam_schedule", unit.examScheduleUrl]
  ];
  for (const [sourceType, sourceUrl] of fields) {
    if (!sourceUrl) continue;
    addCandidate(candidates, makeCandidate({
      ...common,
      sourceType,
      sourceUrl,
      ...(unit.websiteUrl ? { parentUrl: unit.websiteUrl } : {})
    }));
  }
}

function makeCandidate(input: Omit<SourceCandidate, "candidateId" | "universityId" | "universityName" | "officialHomepageUrl" | "officialDomains" | "publicationScope"> & {
  target: TargetUniversity;
}): SourceCandidate | null {
  const sourceUrl = canonicalizeUrl(input.sourceUrl, input.parentUrl ?? input.target.officialHomepageUrl);
  if (!sourceUrl || isExcludedDomain(sourceUrl)) return null;
  const parentUrl = input.parentUrl ? canonicalizeUrl(input.parentUrl, input.target.officialHomepageUrl) : null;
  const publicationScope: SourceCandidate["publicationScope"] = input.scopeType === "university"
    ? "university"
    : input.scopeType === "faculty"
      ? "faculty_shared"
      : "department_specific";
  const candidateId = sha256(`${input.target.universityId}|${input.scopeId}|${input.sourceType}|${sourceUrl}`).slice(0, 24);
  return {
    candidateId,
    universityId: input.target.universityId,
    universityName: input.target.universityName,
    officialHomepageUrl: input.target.officialHomepageUrl,
    officialDomains: input.target.officialDomains,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    scopeName: input.scopeName,
    ...(input.facultyId ? { facultyId: input.facultyId } : {}),
    ...(input.facultyName ? { facultyName: input.facultyName } : {}),
    ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    ...(input.departmentName ? { departmentName: input.departmentName } : {}),
    sourceType: input.sourceType,
    sourceUrl,
    ...(parentUrl ? { parentUrl } : {}),
    ...(input.anchorText ? { anchorText: cleanVisibleText(input.anchorText) } : {}),
    ...(input.selector ? { selector: input.selector } : {}),
    discoveryMethod: input.discoveryMethod,
    publicationScope
  };
}

function addCandidate(candidates: SourceCandidate[], candidate: SourceCandidate | null): void {
  if (candidate) candidates.push(candidate);
}

function dedupeCandidates(candidates: SourceCandidate[]): SourceCandidate[] {
  return [...new Map(candidates.map((candidate) => [candidate.candidateId, candidate])).values()];
}

function buildRequiredSourceStatus(verifications: VerificationRecord[]): UniversityResult["requiredSourceStatus"] {
  return Object.fromEntries(requiredUniversitySourceTypes.map((sourceType) => {
    const records = verifications.filter((record) => record.unitType === "university" && record.sourceType === sourceType);
    if (records.some((record) => record.status === "verified")) return [sourceType, "VERIFIED_COMPLETE"];
    if (records.some((record) => record.status === "blocked" || record.status === "request_failed")) return [sourceType, "BLOCKED_FINAL"];
    return [sourceType, "NEEDS_REVIEW"];
  })) as UniversityResult["requiredSourceStatus"];
}

function deriveUniversityStatus(
  verifications: VerificationRecord[],
  academicUnits: AcademicUnitInventoryRecord[],
  requiredSourceStatus: UniversityResult["requiredSourceStatus"]
): TerminalStatus {
  const blocked = verifications.some((record) => record.status === "blocked" || record.status === "request_failed");
  const homepageVerified = verifications.some((record) => record.sourceType === "homepage" && record.status === "verified");
  const requiredComplete = Object.values(requiredSourceStatus).every((status) => status === "VERIFIED_COMPLETE" || status === "NOT_FOUND_VERIFIED");
  const allAcademicUnitsVerified = academicUnits.every((unit) => unit.status === "VERIFIED_COMPLETE");
  if (blocked && !homepageVerified) return "BLOCKED_FINAL";
  if (homepageVerified && requiredComplete && allAcademicUnitsVerified) return "VERIFIED_COMPLETE";
  return "NEEDS_REVIEW";
}

function reconcileAcademicUnits(units: AcademicUnitInventoryRecord[], verifications: VerificationRecord[]): void {
  const byScope = new Map<string, VerificationRecord[]>();
  for (const verification of verifications) {
    if (!byScope.has(verification.scopeId)) byScope.set(verification.scopeId, []);
    byScope.get(verification.scopeId)!.push(verification);
  }
  for (const unit of units) {
    const records = byScope.get(unit.scopeId) ?? [];
    const website = records.find((record) => record.sourceType === "academic_unit_page" && record.status === "verified");
    if (website) {
      unit.status = "VERIFIED_COMPLETE";
      unit.evidenceCandidateId = website.candidateId;
      if (website.evidencePath) unit.evidencePath = website.evidencePath;
      else delete unit.evidencePath;
      unit.officialUrl = website.finalUrl ?? website.sourceUrl;
    } else if (records.some((record) => record.status === "blocked" || record.status === "request_failed")) {
      unit.status = "BLOCKED_FINAL";
    } else if (unit.officialUrl) {
      unit.status = "NEEDS_REVIEW";
    }
  }
}

async function verifyCandidate(
  candidate: SourceCandidate,
  runtime: VerificationRuntime,
  finalRevalidation = false
): Promise<{ record: VerificationRecord; links: ExtractedLink[] }> {
  const verifiedAt = new Date().toISOString();
  const page = await runtime.context.newPage();
  page.setDefaultNavigationTimeout(runtime.options.navigationTimeoutMs);
  page.setDefaultTimeout(Math.min(runtime.options.navigationTimeoutMs, 12_000));
  let candidateDeadlineExceeded = false;
  const candidateDeadline = setTimeout(() => {
    candidateDeadlineExceeded = true;
    void page.close({ runBeforeUnload: false }).catch(() => undefined);
  }, Math.max(60_000, runtime.options.navigationTimeoutMs * 10));
  let browserOpened = false;
  let clickedFromParent = false;
  let browserResponse: Response | null = null;
  let browserError: string | null = null;
  let finalUrl = candidate.sourceUrl;
  let title = "";
  let heading = "";
  let text = "";
  let html = "";
  let links: ExtractedLink[] = [];
  let screenshotPath: string | undefined;
  const rawPromise = fetchRawCandidate(runtime.context, candidate.sourceUrl, runtime.options.navigationTimeoutMs);

  try {
    const clicked = await tryClickFromParent(page, candidate, runtime.options.navigationTimeoutMs);
    clickedFromParent = clicked.clicked;
    browserResponse = clicked.response;
    if (!clicked.clicked) browserResponse = await page.goto(candidate.sourceUrl, { waitUntil: "domcontentloaded" });
    browserOpened = true;
    await settlePage(page);
    finalUrl = canonicalizeUrl(page.url()) ?? candidate.sourceUrl;
    title = cleanVisibleText(await page.title().catch(() => ""));
    heading = cleanVisibleText(await page.locator("h1, main h2, [role=heading]").first().innerText().catch(() => ""));
    text = cleanVisibleText(await page.locator("body").innerText({ timeout: 8_000 }).catch(() => ""));
    html = await page.content().catch(() => "");
    links = await extractPageLinks(page, finalUrl);
  } catch (error) {
    browserError = error instanceof Error ? error.message : String(error);
    finalUrl = canonicalizeUrl(page.url()) ?? candidate.sourceUrl;
  }

  const redirectChain = readRedirectChain(browserResponse, candidate.sourceUrl, finalUrl);
  const raw = await rawPromise;
  const rawStatus = raw.status;
  const contentType = raw.contentType;
  const body = raw.body;
  const rawError = raw.error;
  finalUrl = raw.finalUrl ?? finalUrl;

  const documentType = detectDocumentType(body);
  const isDocument = documentType !== null || documentExtensions.has(extname(new URL(finalUrl).pathname).toLowerCase()) || /application\/(pdf|msword|vnd\.)/iu.test(contentType);
  let semantic = { semanticMatch: false, soft404: false, reasons: [] as string[] };
  let itemLinks: ExtractedLink[] = [];
  let sampleDetails: DetailSample[] = [];
  let evidencePath: string | undefined;
  let evidenceHash: string | undefined;

  if (isDocument && body.byteLength > 0) {
    const extractedText = documentType === "pdf" ? await extractPdfText(body) : "";
    semantic = validateDocument({
      sourceType: candidate.sourceType,
      url: finalUrl,
      contentType,
      body,
      ...(extractedText ? { extractedText } : {}),
      ...(candidate.scopeType !== "university" ? { scopeName: candidate.scopeName } : {})
    });
    evidenceHash = sha256(body);
    const extension = safeDocumentExtension(finalUrl, documentType);
    const evidenceFile = join(runtime.outputDir, "evidence/documents", `${evidenceHash}.${extension}`);
    await writeFileIfAbsent(evidenceFile, body);
    evidencePath = toArtifactPath(runtime.outputDir, evidenceFile);
  } else {
    itemLinks = extractListingItemLinks(links, finalUrl, candidate.sourceType, candidate.officialDomains);
    semantic = validateHtmlSemantic({
      sourceType: candidate.sourceType,
      requestedUrl: candidate.sourceUrl,
      finalUrl,
      title,
      heading,
      text,
      itemCount: itemLinks.length,
      scopeName: candidate.scopeName
    });
    const listingNeedsSampleValidation = ["announcement", "news", "event"].includes(candidate.sourceType)
      && semantic.semanticMatch;
    const listingCanBeAccepted = browserOpened
      && !rawError
      && rawStatus !== undefined
      && rawStatus >= 200
      && rawStatus < 400
      && body.byteLength > 0
      && isOfficialUrl(finalUrl, candidate.officialDomains);
    if (listingNeedsSampleValidation && listingCanBeAccepted) {
      sampleDetails = await verifyDetailSamples(runtime.context, finalUrl, itemLinks, runtime.options.navigationTimeoutMs);
      const requiredSamples = Math.min(2, itemLinks.length);
      if (sampleDetails.filter((sample) => sample.status === "verified").length < requiredSamples) {
        semantic.semanticMatch = false;
        semantic.reasons.push("sample_detail_validation_failed");
      }
    }
    if (html) {
      evidenceHash = sha256(html);
      const evidenceFile = join(runtime.outputDir, "evidence/html", `${evidenceHash}.html.gz`);
      await writeFileIfAbsent(evidenceFile, gzipSync(Buffer.from(html, "utf8")));
      evidencePath = toArtifactPath(runtime.outputDir, evidenceFile);
    }
  }

  const parentOfficial = candidate.parentUrl ? isOfficialUrl(candidate.parentUrl, candidate.officialDomains) : false;
  const officialDomain = isOfficialUrl(finalUrl, candidate.officialDomains) || (isDocument && parentOfficial);
  if (!officialDomain) semantic.reasons.push("unofficial_or_excluded_domain");
  if (!browserOpened) semantic.reasons.push(`browser_navigation_failed${browserError ? `:${sanitizeError(browserError)}` : ""}`);
  if (rawError) semantic.reasons.push(`raw_get_failed:${sanitizeError(rawError)}`);
  if (rawStatus === undefined || rawStatus < 200 || rawStatus >= 400) semantic.reasons.push(`invalid_http_status:${rawStatus ?? "none"}`);
  if (body.byteLength === 0) semantic.reasons.push("empty_response_body");
  if (candidateDeadlineExceeded) semantic.reasons.push("candidate_deadline_exceeded");
  semantic.reasons = [...new Set(semantic.reasons)];
  semantic.semanticMatch = semantic.semanticMatch
    && officialDomain
    && browserOpened
    && !candidateDeadlineExceeded
    && !rawError
    && rawStatus !== undefined
    && rawStatus >= 200
    && rawStatus < 400
    && body.byteLength > 0;

  const blocked = rawStatus !== undefined && [401, 403, 407, 429, 451, 503].includes(rawStatus);
  const status: VerificationRecord["status"] = semantic.semanticMatch
    ? "verified"
    : blocked
      ? "blocked"
      : rawError || (!browserOpened && !rawStatus)
        ? "request_failed"
        : "rejected";

  if (browserOpened && shouldTakeScreenshot(candidate, status, runtime)) {
    const screenshotFile = join(runtime.outputDir, "evidence/screenshots", `${candidate.universityId}-${candidate.candidateId}.png`);
    try {
      await page.screenshot({
        path: screenshotFile,
        fullPage: true,
        animations: "disabled",
        timeout: runtime.options.navigationTimeoutMs
      });
      screenshotPath = toArtifactPath(runtime.outputDir, screenshotFile);
      runtime.screenshotTakenForUniversity.add(candidate.universityId);
    } catch {
      // HTML and raw response evidence remain authoritative when a screenshot cannot be captured.
    }
  }

  clearTimeout(candidateDeadline);
  await page.close().catch(() => undefined);
  const record: VerificationRecord = {
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    candidateId: candidate.candidateId,
    universityId: candidate.universityId,
    universityName: candidate.universityName,
    officialHomepageUrl: candidate.officialHomepageUrl,
    unitType: candidate.scopeType,
    ...(candidate.facultyName ? { facultyOrUnitName: candidate.facultyName } : candidate.scopeType === "faculty" ? { facultyOrUnitName: candidate.scopeName } : {}),
    ...(candidate.departmentName ? { departmentOrProgramName: candidate.departmentName } : candidate.scopeType === "department" || candidate.scopeType === "program" ? { departmentOrProgramName: candidate.scopeName } : {}),
    scopeId: candidate.scopeId,
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl,
    finalUrl,
    ...(candidate.parentUrl ? { parentUrl: candidate.parentUrl } : {}),
    ...(candidate.anchorText ? { anchorText: candidate.anchorText } : {}),
    ...(candidate.selector ? { selector: candidate.selector } : {}),
    discoveryMethod: candidate.discoveryMethod,
    publicationScope: candidate.publicationScope,
    language: detectLanguage(text),
    browserOpened,
    clickedFromParent,
    redirectChain,
    ...(rawStatus !== undefined ? { httpStatus: rawStatus } : {}),
    ...(contentType ? { contentType } : {}),
    responseByteLength: body.byteLength,
    domMeaningfulTextLength: text.length,
    ...(title ? { pageTitle: title } : {}),
    ...(heading ? { mainHeading: heading } : {}),
    ...(["announcement", "news", "event"].includes(candidate.sourceType) ? { listingItemCount: itemLinks.length } : {}),
    ...(itemLinks.length > 0 ? { sampleItemUrls: itemLinks.slice(0, 2).map((link) => link.url) } : {}),
    ...(sampleDetails.length > 0 ? { sampleDetails } : {}),
    semanticMatch: semantic.semanticMatch,
    semanticReasons: semantic.reasons,
    soft404: semantic.soft404,
    officialDomain,
    transportInsecure: candidate.sourceUrl.startsWith("http://") || finalUrl.startsWith("http://"),
    verifiedAt,
    ...(evidenceHash ? { sha256: evidenceHash } : {}),
    ...(evidencePath ? { evidencePath } : {}),
    ...(screenshotPath ? { screenshotPath } : {}),
    status,
    ...(finalRevalidation ? { finalRevalidatedAt: verifiedAt } : {})
  };
  return { record, links };
}

async function fetchRawCandidate(
  context: BrowserContext,
  url: string,
  timeoutMs: number
): Promise<{ status?: number; contentType: string; body: Uint8Array; finalUrl?: string; error: string | null }> {
  try {
    const response = await context.request.get(url, {
      timeout: timeoutMs,
      maxRedirects: 12,
      failOnStatusCode: false,
      headers: { Accept: "text/html,application/xhtml+xml,application/pdf,application/vnd.openxmlformats-officedocument.*,*/*;q=0.8" }
    });
    return {
      status: response.status(),
      contentType: response.headers()["content-type"] ?? "",
      body: new Uint8Array(await response.body()),
      finalUrl: canonicalizeUrl(response.url()) ?? response.url(),
      error: null
    };
  } catch (error) {
    return {
      contentType: "",
      body: new Uint8Array(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function tryClickFromParent(
  page: Page,
  candidate: SourceCandidate,
  timeoutMs: number
): Promise<{ clicked: boolean; response: Response | null }> {
  if (!candidate.parentUrl || candidate.parentUrl === candidate.sourceUrl || candidate.discoveryMethod !== "navigation") {
    return { clicked: false, response: null };
  }
  try {
    await page.goto(candidate.parentUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await settlePage(page);
    const index = await page.locator("a[href]").evaluateAll((anchors, expected) => anchors.findIndex((anchor) => {
      const href = (anchor as HTMLAnchorElement).href;
      try {
        const left = new URL(href);
        const right = new URL(String(expected));
        left.hash = left.hash.startsWith("#!") ? left.hash : "";
        right.hash = right.hash.startsWith("#!") ? right.hash : "";
        return left.toString() === right.toString();
      } catch {
        return false;
      }
    }), candidate.sourceUrl);
    if (index < 0) return { clicked: false, response: null };
    const locator = page.locator("a[href]").nth(index);
    const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 10_000) }).catch(() => null);
    await locator.click({ timeout: Math.min(timeoutMs, 10_000) });
    const response = await navigation;
    await settlePage(page);
    if ((canonicalizeUrl(page.url()) ?? page.url()) !== candidate.sourceUrl && !page.url().includes(candidate.sourceUrl)) {
      return { clicked: false, response: null };
    }
    return { clicked: true, response };
  } catch {
    return { clicked: false, response: null };
  }
}

async function settlePage(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => undefined);
  await page.waitForTimeout(200);
}

async function extractPageLinks(page: Page, baseUrl: string): Promise<ExtractedLink[]> {
  const raw = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor, index) => ({
    href: (anchor as HTMLAnchorElement).getAttribute("href") ?? "",
    absoluteHref: (anchor as HTMLAnchorElement).href,
    text: (anchor.textContent ?? (anchor as HTMLAnchorElement).getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim(),
    selector: `a[href] >> nth=${index}`
  })));
  const links = new Map<string, ExtractedLink>();
  for (const item of raw) {
    const url = canonicalizeUrl(item.absoluteHref || item.href, baseUrl);
    if (!url || url === baseUrl || isExcludedDomain(url)) continue;
    if (/\.(?:css|js|png|jpe?g|gif|svg|webp|mp4|mp3|zip|rar)(?:$|[?#])/iu.test(url) && !/\.(?:png|jpe?g)(?:$|[?#])/iu.test(url)) continue;
    if (!links.has(url)) links.set(url, { url, text: cleanVisibleText(item.text), selector: item.selector });
  }
  return [...links.values()];
}

function extractListingItemLinks(
  links: ExtractedLink[],
  listingUrl: string,
  sourceType: SourceType,
  officialDomains: string[]
): ExtractedLink[] {
  if (!["announcement", "news", "event"].includes(sourceType)) return [];
  const listing = new URL(listingUrl);
  const listingPath = listing.pathname.replace(/\/+$/u, "");
  const navNoise = /^(ana sayfa|anasayfa|home|duyurular|haberler|etkinlikler|announcements|news|events|tumunu gor|tumu)$/u;
  return links
    .filter((link) => isOfficialUrl(link.url, officialDomains))
    .filter((link) => {
      const parsed = new URL(link.url);
      if (parsed.toString() === listing.toString()) return false;
      if (navNoise.test(foldTurkishText(link.text))) return false;
      if (classifyCandidateUrl(link.url, link.text) && parsed.pathname.replace(/\/+$/u, "") === listingPath) return false;
      const deeperPath = parsed.pathname.length > listingPath.length || parsed.search.length > listing.search.length;
      const dateOrId = /(?:20\d{2}|\d{2,}|detay|detail|icerik|content)/iu.test(`${parsed.pathname}${parsed.search}`);
      return deeperPath || dateOrId;
    })
    .slice(0, 50);
}

async function verifyDetailSamples(
  context: BrowserContext,
  parentUrl: string,
  links: ExtractedLink[],
  timeoutMs: number
): Promise<DetailSample[]> {
  return Promise.all(links.slice(0, 2).map(async (link): Promise<DetailSample> => {
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(timeoutMs);
    page.setDefaultTimeout(timeoutMs);
    const sampleDeadline = setTimeout(() => {
      void page.close({ runBeforeUnload: false }).catch(() => undefined);
    }, Math.max(30_000, timeoutMs * 5));
    try {
      const rawPromise = context.request.get(link.url, {
        timeout: timeoutMs,
        failOnStatusCode: false,
        maxRedirects: 8
      }).then(async (response) => ({ status: response.status(), byteLength: (await response.body()).byteLength })).catch(() => null);
      await page.goto(parentUrl, { waitUntil: "domcontentloaded" });
      await settlePage(page);
      const index = Number(link.selector.match(/nth=(\d+)/u)?.[1] ?? -1);
      let response: Response | null = null;
      if (index >= 0 && index < await page.locator("a[href]").count()) {
        const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 4_000) }).catch(() => null);
        await page.locator("a[href]").nth(index).click({ timeout: Math.min(timeoutMs, 4_000) }).catch(() => undefined);
        response = await navigation;
      }
      if ((canonicalizeUrl(page.url()) ?? page.url()) === (canonicalizeUrl(parentUrl) ?? parentUrl)) {
        response = await page.goto(link.url, { waitUntil: "domcontentloaded" });
      }
      await settlePage(page);
      const raw = await rawPromise;
      const finalUrl = canonicalizeUrl(page.url()) ?? link.url;
      const title = cleanVisibleText(await page.title().catch(() => ""));
      const heading = cleanVisibleText(await page.locator("h1, main h2, [role=heading]").first().innerText().catch(() => ""));
      const text = cleanVisibleText(await page.locator("body").innerText().catch(() => ""));
      const status = raw?.status ?? response?.status();
      const soft404 = detectSoft404(title, heading, text, finalUrl);
      return {
        url: link.url,
        finalUrl,
        title,
        status: status && status >= 200 && status < 400 && (raw?.byteLength ?? 0) > 0 && text.length >= 120 && !soft404 ? "verified" : "rejected",
        ...(status !== undefined ? { httpStatus: status } : {}),
        meaningfulTextLength: text.length
      };
    } catch {
      return { url: link.url, status: "request_failed" };
    } finally {
      clearTimeout(sampleDeadline);
      await page.close().catch(() => undefined);
    }
  }));
}

async function discoverSitemapCandidates(target: TargetUniversity, runtime: VerificationRuntime): Promise<SourceCandidate[]> {
  const homepage = new URL(target.officialHomepageUrl);
  const sitemapUrls = [new URL("/sitemap.xml", homepage).toString(), new URL("/sitemap_index.xml", homepage).toString()];
  const candidates: SourceCandidate[] = [];
  for (const sitemapUrl of sitemapUrls) {
    try {
      const response = await runtime.context.request.get(sitemapUrl, {
        timeout: runtime.options.navigationTimeoutMs,
        failOnStatusCode: false,
        maxRedirects: 8
      });
      if (!response.ok()) continue;
      const body = await response.text();
      const locations = [...body.matchAll(/<loc[^>]*>([^<]+)<\/loc>/giu)].map((match) => decodeXml(match[1] ?? "")).slice(0, 5_000);
      for (const location of locations) {
        const sourceType = classifyCandidateUrl(location);
        if (!sourceType || sourceType === "exam_schedule") continue;
        if (["announcement", "news", "event"].includes(sourceType) && !isLikelyListingUrl(location, sourceType)) continue;
        addCandidate(candidates, makeCandidate({
          target,
          scopeType: "university",
          scopeId: target.universityId,
          scopeName: target.universityName,
          sourceType,
          sourceUrl: location,
          parentUrl: sitemapUrl,
          discoveryMethod: "sitemap"
        }));
      }
      if (candidates.length > 0) break;
    } catch {
      continue;
    }
  }
  return dedupeCandidates(candidates).slice(0, 150);
}

function readRedirectChain(response: Response | null, requestedUrl: string, finalUrl: string): string[] {
  const chain: string[] = [];
  let request = response?.request() ?? null;
  while (request) {
    chain.unshift(canonicalizeUrl(request.url()) ?? request.url());
    request = request.redirectedFrom();
  }
  if (chain.length === 0) chain.push(requestedUrl);
  if (chain.at(-1) !== finalUrl) chain.push(finalUrl);
  return [...new Set(chain)];
}

async function extractPdfText(body: Uint8Array): Promise<string> {
  try {
    const parser = new PDFParse({ data: Buffer.from(body) });
    try {
      const result = await parser.getText();
      return cleanVisibleText(result.text);
    } finally {
      await parser.destroy();
    }
  } catch {
    return "";
  }
}

function safeDocumentExtension(url: string, detectedType: string | null): string {
  const extension = extname(new URL(url).pathname).toLowerCase().replace(/^\./u, "");
  if (/^[a-z0-9]{2,5}$/u.test(extension)) return extension;
  if (detectedType === "zip_office") return "zip";
  if (detectedType === "ole_office") return "bin";
  return detectedType ?? "bin";
}

function shouldTakeScreenshot(candidate: SourceCandidate, status: VerificationRecord["status"], runtime: VerificationRuntime): boolean {
  if (runtime.options.screenshotMode === "none") return false;
  if (runtime.options.screenshotMode === "all") return true;
  if (status !== "verified") return true;
  return candidate.sourceType === "homepage" && !runtime.screenshotTakenForUniversity.has(candidate.universityId);
}

function detectLanguage(value: string): string {
  const folded = foldTurkishText(value.slice(0, 20_000));
  const turkishSignals = ["universite", "fakulte", "ogrenci", "duyuru", "haber", "etkinlik", "akademik"];
  return turkishSignals.filter((signal) => folded.includes(signal)).length >= 2 ? "tr" : "und";
}

async function finalRevalidate(
  manifest: TargetManifest,
  checkpoint: Checkpoint,
  inputs: LoadedInputs,
  runtime: VerificationRuntime
): Promise<void> {
  const resultTargets = manifest.targets.filter((target) => checkpoint.targets[target.universityId]?.resultPath);
  const startedAt = new Date().toISOString();
  checkpoint.finalRevalidation = { startedAt, total: 0, passed: 0, failed: 0 };
  await saveCheckpoint(checkpoint, runtime.outputDir);
  await logRun(runtime.outputDir, `Starting final live revalidation for ${resultTargets.length} university result files.`);

  for (const target of resultTargets) {
    const result = await readOptionalJsonFile<UniversityResult>(universityResultPath(runtime.outputDir, target.universityId));
    if (!result) continue;
    const verifiedCandidates = result.candidates.filter((candidate) => result.verifications.some((record) => record.candidateId === candidate.candidateId && record.status === "verified"));
    checkpoint.finalRevalidation.total += verifiedCandidates.length;
    const refreshed = new Map<string, VerificationRecord>();

    for (let index = 0; index < verifiedCandidates.length; index += runtime.options.candidateConcurrency) {
      const batch = verifiedCandidates.slice(index, index + runtime.options.candidateConcurrency);
      const checks = await Promise.all(batch.map((candidate) => verifyCandidate(candidate, runtime, true)));
      for (const check of checks) {
        refreshed.set(check.record.candidateId, check.record);
        if (check.record.status === "verified") checkpoint.finalRevalidation.passed += 1;
        else checkpoint.finalRevalidation.failed += 1;
      }
      checkpoint.updatedAt = new Date().toISOString();
      await saveCheckpoint(checkpoint, runtime.outputDir);
    }

    result.verifications = result.verifications.map((record) => refreshed.get(record.candidateId) ?? record);
    reconcileAcademicUnits(result.academicUnits, result.verifications);
    result.requiredSourceStatus = buildRequiredSourceStatus(result.verifications);
    const failedRevalidation = [...refreshed.values()].some((record) => record.status !== "verified");
    if (failedRevalidation || result.status === "VERIFIED_COMPLETE" && Object.values(result.requiredSourceStatus).some((status) => status !== "VERIFIED_COMPLETE")) {
      result.status = "NEEDS_REVIEW";
      checkpoint.targets[target.universityId]!.status = "NEEDS_REVIEW";
    }
    result.completedAt = new Date().toISOString();
    await writeJsonAtomic(universityResultPath(runtime.outputDir, target.universityId), result);
  }

  checkpoint.finalRevalidation.completedAt = new Date().toISOString();
  await saveCheckpoint(checkpoint, runtime.outputDir);
  await applyVerifiedRuntimeUpdates(manifest, checkpoint, inputs, runtime.outputDir);
  await logRun(runtime.outputDir, `Final revalidation completed: passed=${checkpoint.finalRevalidation.passed}, failed=${checkpoint.finalRevalidation.failed}.`);
}

async function applyVerifiedRuntimeUpdates(
  manifest: TargetManifest,
  checkpoint: Checkpoint,
  inputs: LoadedInputs,
  outputDir: string
): Promise<void> {
  if (!checkpoint.finalRevalidation?.completedAt || checkpoint.finalRevalidation.failed > 0) {
    await logRun(outputDir, "Runtime registry update skipped because final revalidation is incomplete or has failures.");
    return;
  }
  const excludedIds = new Set<string>(EXCLUDED_UNIVERSITIES.map((record) => record.universityId));
  const sourceById = new Map(inputs.sources.map((record) => [record.universityId, record]));
  const unitById = new Map<string, AcademicUnitSourceRecord>();
  for (const unit of inputs.units) {
    const id = unit.scopeType === "faculty" ? unit.facultyId : unit.departmentId;
    if (id && !unitById.has(id)) unitById.set(id, unit);
  }
  let universityUpdates = 0;
  let unitUpdates = 0;

  for (const target of manifest.targets) {
    if (excludedIds.has(target.universityId)) throw new Error(`Excluded target reached runtime update: ${target.universityId}`);
    const result = await readOptionalJsonFile<UniversityResult>(universityResultPath(outputDir, target.universityId));
    if (!result) continue;
    const verified = result.verifications.filter((record) => record.status === "verified" && record.finalRevalidatedAt);
    const universityRecord = sourceById.get(target.universityId);
    if (universityRecord) {
      const fieldMap: Array<[SourceType, keyof CanonicalUniversityRecord]> = [
        ["announcement", "announcementUrl"],
        ["news", "newsUrl"],
        ["event", "eventUrl"],
        ["academic_calendar", "calendarUrl"]
      ];
      for (const [sourceType, field] of fieldMap) {
        const record = chooseCanonicalVerification(verified.filter((item) => item.unitType === "university" && item.sourceType === sourceType));
        if (!record?.finalUrl) continue;
        if (universityRecord[field] !== record.finalUrl) {
          (universityRecord as unknown as Record<string, unknown>)[field] = record.finalUrl;
          (universityRecord as unknown as Record<string, unknown>)[field.replace("Url", "Status")] = "source_found";
          universityUpdates += 1;
        }
      }
    }

    for (const record of verified.filter((item) => item.unitType === "faculty" || item.unitType === "department")) {
      const unit = unitById.get(record.scopeId);
      if (!unit || !record.finalUrl) continue;
      const field = record.sourceType === "academic_unit_page" ? "websiteUrl"
        : record.sourceType === "announcement" ? "announcementUrl"
          : record.sourceType === "news" ? "newsUrl"
            : record.sourceType === "event" ? "eventUrl"
              : record.sourceType === "course_schedule" ? "courseScheduleUrl"
                : record.sourceType === "exam_schedule" ? "examScheduleUrl"
                  : null;
      if (!field || unit[field] === record.finalUrl) continue;
      (unit as unknown as Record<string, unknown>)[field] = record.finalUrl;
      unitUpdates += 1;
    }
  }

  assertNoExcludedRuntimeMutations(inputs.sources, inputs.units);
  await Promise.all([
    writeJsonAtomic(sourcePath, inputs.sources),
    writeJsonAtomic(academicUnitSourcePath, inputs.units)
  ]);
  await writeJsonAtomic(join(outputDir, "runtime-update-audit.json"), {
    updatedAt: new Date().toISOString(),
    universityFieldUpdates: universityUpdates,
    academicUnitFieldUpdates: unitUpdates,
    excludedUniversityMutations: 0,
    sourcePath: toWorkspacePath(sourcePath),
    academicUnitSourcePath: toWorkspacePath(academicUnitSourcePath)
  });
}

function chooseCanonicalVerification(records: VerificationRecord[]): VerificationRecord | null {
  return [...records].sort((left, right) => {
    const leftScore = (left.clickedFromParent ? 20 : 0) + (left.transportInsecure ? 0 : 10) + (left.listingItemCount ?? 0);
    const rightScore = (right.clickedFromParent ? 20 : 0) + (right.transportInsecure ? 0 : 10) + (right.listingItemCount ?? 0);
    return rightScore - leftScore || (left.finalUrl?.length ?? Infinity) - (right.finalUrl?.length ?? Infinity);
  })[0] ?? null;
}

function assertNoExcludedRuntimeMutations(sources: CanonicalUniversityRecord[], units: AcademicUnitSourceRecord[]): void {
  const excludedIds = new Set<string>(EXCLUDED_UNIVERSITIES.map((record) => record.universityId));
  const excludedDomainLeak = [
    ...sources.filter((record) => !excludedIds.has(record.universityId)).flatMap((record) => [record.announcementUrl, record.newsUrl, record.eventUrl, record.calendarUrl]),
    ...units.filter((record) => !excludedIds.has(record.universityId)).flatMap((record) => [record.websiteUrl, record.announcementUrl, record.newsUrl, record.eventUrl, record.courseScheduleUrl, record.examScheduleUrl])
  ].find((value) => typeof value === "string" && isExcludedDomain(value));
  if (excludedDomainLeak) throw new Error(`Excluded domain leaked into a target registry record: ${excludedDomainLeak}`);
}

async function aggregateArtifacts(
  manifest: TargetManifest,
  checkpoint: Checkpoint,
  inputs: LoadedInputs,
  outputDir: string
): Promise<void> {
  const results = new Map<string, UniversityResult>();
  let checkpointReconciled = false;
  for (const target of manifest.targets) {
    const result = await readOptionalJsonFile<UniversityResult>(universityResultPath(outputDir, target.universityId));
    if (!result) continue;
    const checkpointTarget = checkpoint.targets[target.universityId];
    if (checkpointTarget && !checkpointTarget.continuationRequired) {
      const derivedStatus = deriveUniversityStatus(result.verifications, result.academicUnits, result.requiredSourceStatus);
      if (result.status !== derivedStatus || checkpointTarget.status !== derivedStatus) {
        result.status = derivedStatus;
        checkpointTarget.status = derivedStatus;
        checkpointTarget.completedAt = result.completedAt;
        checkpointReconciled = true;
        await writeJsonAtomic(universityResultPath(outputDir, target.universityId), result);
      }
    }
    results.set(target.universityId, result);
  }
  if (checkpointReconciled) await saveCheckpoint(checkpoint, outputDir);

  const allVerifications = [...results.values()].flatMap((result) => result.verifications);
  const academicUnits = manifest.targets.flatMap((target) => {
    const result = results.get(target.universityId);
    return result?.academicUnits ?? buildUniversityWork(target, inputs).academicUnits;
  });
  const unitIds = new Set(academicUnits.map((unit) => unit.scopeId));
  const allVerifiedCandidates = allVerifications.filter((record) => record.status === "verified");
  const verified = dedupeVerifiedAssignments(allVerifiedCandidates);
  const courseScheduleMap = academicUnits
    .filter((unit) => unit.scopeType === "department")
    .map((unit) => buildCourseScheduleRecord(unit, allVerifications, checkpoint.targets[unit.universityId]?.status ?? "NOT_STARTED"));
  const academicCalendars = manifest.targets.map((target) => buildAcademicCalendarRecord(target, allVerifications, checkpoint.targets[target.universityId]?.status ?? "NOT_STARTED"));
  const unresolved = buildUnresolvedRecords(manifest, checkpoint, results, academicUnits, allVerifications);
  const duplicateUrls = duplicates(verified.map(canonicalVerifiedAssignmentKey));
  const excludedLeaks = verified.filter((record) => isExcludedDomain(record.finalUrl ?? record.sourceUrl));
  const orphanRecords = verified.filter((record) => record.unitType !== "university" && !unitIds.has(record.scopeId));
  const invalidVerified = verified.filter((record) => !record.sourceUrl || !record.finalUrl || !record.evidencePath || !record.sha256 || !record.verifiedAt || !record.semanticMatch || record.soft404 || !record.browserOpened || !record.officialDomain);

  await Promise.all([
    writeJsonLines(join(outputDir, "verified-sources.jsonl"), verified),
    writeTextAtomic(join(outputDir, "verified-sources.csv"), renderVerifiedCsv(verified)),
    writeJsonLines(join(outputDir, "academic-units.jsonl"), academicUnits),
    writeJsonLines(join(outputDir, "course-schedule-map.jsonl"), courseScheduleMap),
    writeJsonLines(join(outputDir, "academic-calendars.jsonl"), academicCalendars),
    writeJsonLines(join(outputDir, "unresolved-and-not-found.jsonl"), unresolved),
    writeJsonLines(join(outputDir, "verification-manifest.jsonl"), allVerifications)
  ]);

  const allTargetsTerminalValue = allTargetsTerminal(checkpoint);
  const allUnitsTerminal = academicUnits.every((unit) => terminalStatuses.has(unit.status));
  const revalidationComplete = Boolean(checkpoint.finalRevalidation?.completedAt);
  const allVerifiedRevalidated = verified.every((record) => Boolean(record.finalRevalidatedAt));
  const crawlComplete = manifest.targetCount === 198 && allTargetsTerminalValue && allUnitsTerminal && revalidationComplete;
  const verifiedDataGreen = crawlComplete
    && allVerifiedRevalidated
    && checkpoint.finalRevalidation?.failed === 0
    && invalidVerified.length === 0
    && excludedLeaks.length === 0
    && orphanRecords.length === 0
    && duplicateUrls.length === 0;
  const requiredUniversityCoverage = academicCalendars.every((record) => record.status === "VERIFIED_COMPLETE")
    && [...results.values()].every((result) => Object.values(result.requiredSourceStatus).every((status) => status === "VERIFIED_COMPLETE"));
  const allSchedulesCovered = courseScheduleMap.every((record) => record.status === "VERIFIED_COMPLETE");
  const fullCoverageGreen = verifiedDataGreen && requiredUniversityCoverage && allSchedulesCovered && unresolved.length === 0;
  const summary = buildAggregateSummary({
    manifest,
    checkpoint,
    results,
    academicUnits,
    verified,
    allVerifications,
    courseScheduleMap,
    academicCalendars,
    unresolved,
    duplicateUrls,
    excludedLeaks,
    orphanRecords,
    invalidVerified,
    duplicateCandidatesDemoted: allVerifiedCandidates.length - verified.length,
    crawlComplete,
    verifiedDataGreen,
    fullCoverageGreen
  });
  await writeJsonAtomic(join(outputDir, "summary.json"), summary);
  await writeTextAtomic(join(outputDir, "university-source-coverage-final.md"), renderFinalReport(summary, outputDir));
}

function buildCourseScheduleRecord(
  unit: AcademicUnitInventoryRecord,
  verifications: VerificationRecord[],
  universityStatus: WorkStatus
): Record<string, unknown> {
  const records = verifications.filter((record) => record.scopeId === unit.scopeId && record.sourceType === "course_schedule");
  const verified = chooseCanonicalVerification(records.filter((record) => record.status === "verified"));
  const status: WorkStatus = verified
    ? "VERIFIED_COMPLETE"
    : records.some((record) => record.status === "blocked" || record.status === "request_failed")
      ? "BLOCKED_FINAL"
      : universityStatus === "NOT_STARTED" || universityStatus === "DISCOVERING" || universityStatus === "VERIFYING"
        ? universityStatus
        : "NEEDS_REVIEW";
  return {
    universityId: unit.universityId,
    universityName: unit.universityName,
    facultyId: unit.facultyId,
    facultyName: unit.facultyName,
    departmentId: unit.departmentId,
    departmentName: unit.departmentName,
    publicationScope: verified?.publicationScope,
    ...(verified?.finalUrl ? { scheduleIndexUrl: verified.finalUrl } : {}),
    ...(verified?.evidencePath ? { evidencePath: verified.evidencePath } : {}),
    status,
    reason: verified ? "verified_schedule_source" : "no_verified_department_schedule_source"
  };
}

function buildAcademicCalendarRecord(
  target: TargetUniversity,
  verifications: VerificationRecord[],
  universityStatus: WorkStatus
): Record<string, unknown> {
  const records = verifications.filter((record) => record.universityId === target.universityId && record.unitType === "university" && record.sourceType === "academic_calendar");
  const verified = chooseCanonicalVerification(records.filter((record) => record.status === "verified"));
  const status: WorkStatus = verified
    ? "VERIFIED_COMPLETE"
    : records.some((record) => record.status === "blocked" || record.status === "request_failed")
      ? "BLOCKED_FINAL"
      : terminalStatuses.has(universityStatus)
        ? "NEEDS_REVIEW"
        : universityStatus;
  return {
    universityId: target.universityId,
    universityName: target.universityName,
    ...(verified?.finalUrl ? { sourceUrl: verified.finalUrl } : {}),
    ...(verified?.contentType ? { contentType: verified.contentType } : {}),
    ...(verified?.evidencePath ? { evidencePath: verified.evidencePath } : {}),
    ...(verified?.sha256 ? { sha256: verified.sha256 } : {}),
    ...(verified?.verifiedAt ? { verifiedAt: verified.verifiedAt } : {}),
    status
  };
}

function buildUnresolvedRecords(
  manifest: TargetManifest,
  checkpoint: Checkpoint,
  results: Map<string, UniversityResult>,
  academicUnits: AcademicUnitInventoryRecord[],
  verifications: VerificationRecord[]
): Array<Record<string, unknown>> {
  const unresolved: Array<Record<string, unknown>> = verifications
    .filter((record) => record.status !== "verified")
    .map((record) => ({
      kind: "candidate_verification",
      universityId: record.universityId,
      universityName: record.universityName,
      scopeId: record.scopeId,
      sourceType: record.sourceType,
      candidateUrl: record.sourceUrl,
      finalUrl: record.finalUrl,
      status: record.status === "blocked" || record.status === "request_failed" ? "BLOCKED_FINAL" : "NEEDS_REVIEW",
      reasons: record.semanticReasons,
      evidencePath: record.evidencePath
    }));
  for (const target of manifest.targets) {
    const result = results.get(target.universityId);
    if (!result) {
      unresolved.push({
        kind: "university_not_processed",
        universityId: target.universityId,
        universityName: target.universityName,
        status: checkpoint.targets[target.universityId]?.status ?? "NOT_STARTED"
      });
      continue;
    }
    for (const sourceType of requiredUniversitySourceTypes) {
      if (result.requiredSourceStatus[sourceType] === "VERIFIED_COMPLETE") continue;
      unresolved.push({
        kind: "required_university_source",
        universityId: target.universityId,
        universityName: target.universityName,
        sourceType,
        status: result.requiredSourceStatus[sourceType],
        reason: "no_fully_verified_source"
      });
    }
  }
  for (const unit of academicUnits) {
    if (unit.status === "VERIFIED_COMPLETE") continue;
    unresolved.push({
      kind: "academic_unit_page",
      universityId: unit.universityId,
      universityName: unit.universityName,
      scopeType: unit.scopeType,
      scopeId: unit.scopeId,
      scopeName: unit.scopeName,
      status: unit.status,
      reason: unit.officialUrl ? "official_url_failed_verification" : "no_official_unit_url_in_registry"
    });
  }
  return unresolved;
}

function buildAggregateSummary(input: {
  manifest: TargetManifest;
  checkpoint: Checkpoint;
  results: Map<string, UniversityResult>;
  academicUnits: AcademicUnitInventoryRecord[];
  verified: VerificationRecord[];
  allVerifications: VerificationRecord[];
  courseScheduleMap: Array<Record<string, unknown>>;
  academicCalendars: Array<Record<string, unknown>>;
  unresolved: Array<Record<string, unknown>>;
  duplicateUrls: string[];
  excludedLeaks: VerificationRecord[];
  orphanRecords: VerificationRecord[];
  invalidVerified: VerificationRecord[];
  duplicateCandidatesDemoted: number;
  crawlComplete: boolean;
  verifiedDataGreen: boolean;
  fullCoverageGreen: boolean;
}): Record<string, unknown> {
  const targetStates = Object.values(input.checkpoint.targets);
  const statusCounts = countBy(targetStates.map((target) => target.status));
  const verifiedBySourceType = countBy(input.verified.map((record) => record.sourceType));
  const verifiedByLevel = countBy(input.verified.map((record) => record.unitType));
  const finalLiveChecks = {
    reachable: input.verified.filter((record) => record.redirectChain.length <= 1).length,
    redirectedToValidFinal: input.verified.filter((record) => record.redirectChain.length > 1).length,
    broken: input.allVerifications.filter((record) => record.status === "rejected" && (record.httpStatus ?? 0) >= 400).length,
    empty: input.allVerifications.filter((record) => record.semanticReasons.includes("empty_response_body") || record.semanticReasons.includes("insufficient_meaningful_text")).length,
    soft404: input.allVerifications.filter((record) => record.soft404).length,
    blocked: input.allVerifications.filter((record) => record.status === "blocked").length,
    requestFailed: input.allVerifications.filter((record) => record.status === "request_failed").length
  };
  const completedUniversities = targetStates.filter((target) => terminalStatuses.has(target.status)).length;
  const facultyUnits = input.academicUnits.filter((unit) => unit.scopeType === "faculty");
  const departmentUnits = input.academicUnits.filter((unit) => unit.scopeType === "department");
  const schedulesCovered = input.courseScheduleMap.filter((record) => record.status === "VERIFIED_COMPLETE").length;
  const calendarsCovered = input.academicCalendars.filter((record) => record.status === "VERIFIED_COMPLETE").length;
  return {
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    targetCount: input.manifest.targetCount,
    exclusionCount: input.manifest.exclusionCount,
    universitiesCompleted: completedUniversities,
    universityStatusCounts: statusCounts,
    academicUnits: {
      total: input.academicUnits.length,
      facultiesAndUnits: facultyUnits.length,
      departmentsAndPrograms: departmentUnits.length,
      verifiedOfficialPages: input.academicUnits.filter((unit) => unit.status === "VERIFIED_COMPLETE").length,
      needsReview: input.academicUnits.filter((unit) => unit.status === "NEEDS_REVIEW").length,
      blocked: input.academicUnits.filter((unit) => unit.status === "BLOCKED_FINAL").length,
      notStarted: input.academicUnits.filter((unit) => !terminalStatuses.has(unit.status)).length
    },
    verifiedUrls: {
      total: input.verified.length,
      bySourceType: verifiedBySourceType,
      byAcademicLevel: verifiedByLevel,
      finalRevalidated: input.verified.filter((record) => record.finalRevalidatedAt).length
    },
    academicCalendarCoverage: { verified: calendarsCovered, total: input.academicCalendars.length },
    departmentCourseScheduleCoverage: { verified: schedulesCovered, total: input.courseScheduleMap.length },
    unresolved: {
      total: input.unresolved.length,
      notFoundVerified: input.unresolved.filter((record) => record.status === "NOT_FOUND_VERIFIED").length,
      blocked: input.unresolved.filter((record) => record.status === "BLOCKED_FINAL").length,
      needsReview: input.unresolved.filter((record) => record.status === "NEEDS_REVIEW").length,
      notStarted: input.unresolved.filter((record) => !terminalStatuses.has(record.status as WorkStatus)).length
    },
    finalLiveChecks,
    duplicateOrphanAudit: {
      duplicateVerifiedAssignments: input.duplicateUrls.length,
      duplicateCandidatesDemoted: input.duplicateCandidatesDemoted,
      orphanVerifiedRecords: input.orphanRecords.length,
      excludedDomainLeaks: input.excludedLeaks.length,
      invalidVerifiedRecords: input.invalidVerified.length
    },
    finalRevalidation: input.checkpoint.finalRevalidation ?? null,
    gates: {
      CRAWL_COMPLETE: input.crawlComplete,
      VERIFIED_DATA_GREEN: input.verifiedDataGreen,
      FULL_COVERAGE_GREEN: input.fullCoverageGreen
    },
    resumeCommand: input.crawlComplete
      ? null
      : `npm run discover:universities -- run --output=${JSON.stringify(relative(root, options.outputDir).replace(/\\/gu, "/"))}`,
    guarantees: {
      excludedUniversitiesProcessed: 0,
      excludedDomainsInVerifiedData: input.excludedLeaks.length,
      unverifiedUrlsWrittenToVerifiedDataset: input.invalidVerified.length
    }
  };
}

function renderFinalReport(summary: Record<string, unknown>, outputDir: string): string {
  const units = summary.academicUnits as Record<string, number>;
  const verifiedUrls = summary.verifiedUrls as { total: number; bySourceType: Record<string, number>; byAcademicLevel: Record<string, number>; finalRevalidated: number };
  const calendar = summary.academicCalendarCoverage as Record<string, number>;
  const schedule = summary.departmentCourseScheduleCoverage as Record<string, number>;
  const unresolved = summary.unresolved as Record<string, number>;
  const live = summary.finalLiveChecks as Record<string, number>;
  const audit = summary.duplicateOrphanAudit as Record<string, number>;
  const gates = summary.gates as Record<string, boolean>;
  const lines = [
    "# University Source Discovery Final Report",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Scope",
    "",
    `- Canonical targets: ${summary.targetCount}`,
    `- Explicit exclusions: ${summary.exclusionCount}`,
    `- Universities in terminal state: ${summary.universitiesCompleted}/${summary.targetCount}`,
    `- Faculties/units inventoried: ${units.facultiesAndUnits}`,
    `- Departments/programs inventoried: ${units.departmentsAndPrograms}`,
    "",
    "## Verified Sources",
    "",
    `- Verified URLs: ${verifiedUrls.total}`,
    `- Final-revalidated URLs: ${verifiedUrls.finalRevalidated}`,
    `- By source type: ${renderCounts(verifiedUrls.bySourceType)}`,
    `- By academic level: ${renderCounts(verifiedUrls.byAcademicLevel)}`,
    `- Academic calendars: ${calendar.verified}/${calendar.total}`,
    `- Department course schedules: ${schedule.verified}/${schedule.total}`,
    "",
    "## Outstanding",
    "",
    `- Total unresolved records: ${unresolved.total}`,
    `- Not found after verification: ${unresolved.notFoundVerified}`,
    `- Blocked: ${unresolved.blocked}`,
    `- Needs review: ${unresolved.needsReview}`,
    `- Not started/in progress: ${unresolved.notStarted}`,
    "",
    "## Live Revalidation",
    "",
    `- Reachable: ${live.reachable}`,
    `- Redirected to valid final URL: ${live.redirectedToValidFinal}`,
    `- Broken: ${live.broken}`,
    `- Empty: ${live.empty}`,
    `- Soft 404: ${live.soft404}`,
    `- Blocked: ${live.blocked}`,
    `- Request failed: ${live.requestFailed}`,
    "",
    "## Integrity Audit",
    "",
    `- Duplicate verified assignments: ${audit.duplicateVerifiedAssignments}`,
    `- Duplicate candidates demoted to one canonical assignment: ${audit.duplicateCandidatesDemoted}`,
    `- Orphan verified records: ${audit.orphanVerifiedRecords}`,
    `- Excluded-domain leaks: ${audit.excludedDomainLeaks}`,
    `- Invalid verified records: ${audit.invalidVerifiedRecords}`,
    "",
    "## Gates",
    "",
    `- CRAWL_COMPLETE: ${gates.CRAWL_COMPLETE ? "GREEN" : "NOT_GREEN"}`,
    `- VERIFIED_DATA_GREEN: ${gates.VERIFIED_DATA_GREEN ? "GREEN" : "NOT_GREEN"}`,
    `- FULL_COVERAGE_GREEN: ${gates.FULL_COVERAGE_GREEN ? "GREEN" : "NOT_GREEN"}`,
    "",
    "No excluded university was processed by this run. Only records that passed browser, raw-response, semantic, domain, and evidence checks are present in `verified-sources.jsonl`.",
    "",
    "## Artifacts",
    "",
    ...[
      "target-universities.json",
      "excluded-input-audit.json",
      "verified-sources.jsonl",
      "verified-sources.csv",
      "academic-units.jsonl",
      "course-schedule-map.jsonl",
      "academic-calendars.jsonl",
      "unresolved-and-not-found.jsonl",
      "verification-manifest.jsonl",
      "checkpoint.json",
      "run.log"
    ].map((file) => `- ${relative(root, join(outputDir, file)).replace(/\\/gu, "/")}`),
    ""
  ];
  if (summary.resumeCommand) lines.push("## Resume", "", `\`${summary.resumeCommand}\``, "");
  return `${lines.join("\n")}\n`;
}

function renderVerifiedCsv(records: VerificationRecord[]): string {
  const headers = [
    "university_id", "university_name", "unit_type", "faculty_or_unit_name", "department_or_program_name",
    "source_type", "source_url", "final_url", "parent_url", "http_status", "content_type", "browser_opened",
    "clicked_from_parent", "semantic_match", "soft_404", "official_domain", "verified_at", "final_revalidated_at", "sha256", "evidence_path"
  ];
  const rows = records.map((record) => [
    record.universityId, record.universityName, record.unitType, record.facultyOrUnitName, record.departmentOrProgramName,
    record.sourceType, record.sourceUrl, record.finalUrl, record.parentUrl, record.httpStatus, record.contentType,
    record.browserOpened, record.clickedFromParent, record.semanticMatch, record.soft404, record.officialDomain,
    record.verifiedAt, record.finalRevalidatedAt, record.sha256, record.evidencePath
  ].map(csvCell).join(","));
  return `${headers.join(",")}\n${rows.join("\n")}${rows.length > 0 ? "\n" : ""}`;
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function renderCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "none";
}

function allTargetsTerminal(checkpoint: Checkpoint): boolean {
  return Object.values(checkpoint.targets).length === 198
    && Object.values(checkpoint.targets).every((target) => terminalStatuses.has(target.status));
}

async function saveCheckpoint(checkpoint: Checkpoint, outputDir: string): Promise<void> {
  const write = async (): Promise<void> => {
    checkpoint.updatedAt = new Date().toISOString();
    await writeJsonAtomic(join(outputDir, "checkpoint.json"), checkpoint);
  };
  checkpointWriteQueue = checkpointWriteQueue.then(write, write);
  await checkpointWriteQueue;
}

function universityResultPath(outputDir: string, universityId: string): string {
  return join(outputDir, "state/universities", `${universityId}.json`);
}

function universityProgressPath(outputDir: string, universityId: string): string {
  return join(outputDir, "state/progress", `${universityId}.json`);
}

async function saveUniversityProgress(path: string, progress: UniversityProgress): Promise<void> {
  await writeJsonAtomic(path, progress);
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/u, "")) as T;
}

async function readOptionalJsonFile<T>(path: string): Promise<T | null> {
  try {
    return await readJsonFile<T>(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonLines(path: string, values: unknown[]): Promise<void> {
  await writeTextAtomic(path, values.length > 0 ? `${values.map((value) => JSON.stringify(value)).join("\n")}\n` : "");
}

async function writeTextAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text, "utf8");
  try {
    await rename(temporary, path);
  } catch (error) {
    if (!new Set(["EEXIST", "EPERM"]).has((error as NodeJS.ErrnoException).code ?? "")) throw error;
    await rm(path, { force: true });
    await rename(temporary, path);
  }
}

async function writeFileIfAbsent(path: string, data: Uint8Array): Promise<void> {
  try {
    await writeFile(path, data, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

async function logRun(outputDir: string, message: string): Promise<void> {
  await appendFile(join(outputDir, "run.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
}

function toArtifactPath(outputDir: string, path: string): string {
  return relative(outputDir, path).replace(/\\/gu, "/");
}

function toWorkspacePath(path: string): string {
  return relative(root, path).replace(/\\/gu, "/");
}

function extractHttpUrls(value: string): string[] {
  return [...value.matchAll(/https?:\/\/[^\s<>"']+/giu)]
    .map((match) => match[0].replace(/[),.;]+$/gu, ""))
    .map((url) => canonicalizeUrl(url))
    .filter((url): url is string => Boolean(url));
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicateValues = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicateValues.add(value);
    seen.add(value);
  }
  return [...duplicateValues];
}

function dedupeVerifiedAssignments(records: VerificationRecord[]): VerificationRecord[] {
  const groups = new Map<string, VerificationRecord[]>();
  for (const record of records) {
    const key = canonicalVerifiedAssignmentKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(record);
  }
  return [...groups.values()].map((group) => chooseCanonicalVerification(group)!).filter(Boolean);
}

function canonicalVerifiedAssignmentKey(record: VerificationRecord): string {
  const url = canonicalizeUrl(record.finalUrl ?? record.sourceUrl) ?? record.finalUrl ?? record.sourceUrl;
  return `${record.universityId}|${record.scopeId}|${record.sourceType}|${url.replace(/\/$/u, "")}`;
}

function sanitizeError(value: string): string {
  return cleanVisibleText(value).replace(/https?:\/\/[^\s]+/gu, "[url]").slice(0, 240);
}

function decodeXml(value: string): string {
  return value.replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&#39;/gu, "'");
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
