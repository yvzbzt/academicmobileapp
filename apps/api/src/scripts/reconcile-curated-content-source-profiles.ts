import "reflect-metadata";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listVerifiedUniversitySources } from "../bootstrap/verified-source-registry.js";
import { MongoConnectionService } from "../database/mongo-connection.service.js";
import { AnnouncementIngestionService } from "../modules/announcements/announcement-ingestion.service.js";
import { MongoAnnouncementRepository } from "../modules/announcements/mongo-announcement.repository.js";
import { MongoCatalogRepository } from "../modules/catalog/mongo-catalog.repository.js";
import { MongoNotificationRepository } from "../modules/notifications/mongo-notification.repository.js";
import { NotificationSchedulingService } from "../modules/notifications/notifications.service.js";

const contentTypes = ["announcement", "news", "event"] as const;
const sourceUrlFields = {
  announcement: "announcementUrl",
  news: "newsUrl",
  event: "eventUrl"
} as const;
const systemActorId = "system:curated-content-source-reconciler";
const expectedUniversityCount = 208;

type ReconciliationService = Pick<
  AnnouncementIngestionService,
  "saveUniversityContentSourceProfileForAdmin"
  | "previewUniversityContentSourceProfileForAdmin"
  | "probeSourceForDeviceManifestById"
  | "listSourcesForAdmin"
  | "deactivateManualSourceForAdmin"
>;

interface CuratedContentSourceTarget {
  universityId: string;
  contentType: typeof contentTypes[number];
  sourceUrl: string;
  parser: "auto" | "rss" | "html";
  parserConfig?: {
    itemSelector?: string;
    titleSelector?: string;
    linkSelector?: string;
    dateSelector?: string;
    contentSelector?: string;
  };
}

export interface CuratedContentSourceReconciliationResult {
  universityId: string;
  contentType: typeof contentTypes[number];
  sourceUrl: string;
  itemCount: number;
  activationStatus: "active";
}

export async function reconcileCuratedContentSourceProfiles(
  service: ReconciliationService,
  filter: { universityId?: string; contentType?: typeof contentTypes[number] } = {}
): Promise<CuratedContentSourceReconciliationResult[]> {
  const sources = await listVerifiedUniversitySources();
  if (sources.length !== expectedUniversityCount) {
    throw new Error(`CURATED_CONTENT_SOURCE_REGISTRY_COUNT_MISMATCH:${sources.length}`);
  }
  const targets = sources.flatMap((source) => contentTypes.flatMap((contentType) => {
    if ((filter.universityId && source.universityId !== filter.universityId)
      || (filter.contentType && contentType !== filter.contentType)) return [];
    const profile = source.parserProfiles?.[contentType];
    if (!profile) return [];
    const sourceUrl = source[sourceUrlFields[contentType]];
    const parserConfig = profile.parserConfig;
    if (!sourceUrl || (profile.parser === "html" && !parserConfig?.itemSelector)) {
      throw new Error(`CURATED_CONTENT_SOURCE_PROFILE_INVALID:${source.universityId}:${contentType}`);
    }
    return [{
      universityId: source.universityId,
      contentType,
      parser: profile.parser,
      ...(parserConfig ? { parserConfig } : {}),
      sourceUrl
    } satisfies CuratedContentSourceTarget];
  }));
  if (targets.length === 0) {
    throw new Error(`CURATED_CONTENT_SOURCE_PROFILE_COUNT_MISMATCH:${targets.length}`);
  }

  const staged = new Map<string, string>();
  const stagingFailures: CuratedContentSourceTarget[] = [];
  for (const target of targets) {
    try {
      staged.set(targetKey(target), await stageTargetInactive(service, target));
    } catch {
      stagingFailures.push(target);
    }
  }
  if (stagingFailures.length > 0) {
    await cleanupTargetsFailClosed(service, targets);
    const first = stagingFailures[0]!;
    throw new Error(`CURATED_CONTENT_SOURCE_STAGING_FAILED:${first.universityId}:${first.contentType}`);
  }

  try {
    const results: CuratedContentSourceReconciliationResult[] = [];
    for (const target of targets) {
      const stagedId = staged.get(targetKey(target));
      if (!stagedId) throw new Error("CURATED_CONTENT_SOURCE_STAGED_ID_MISSING");
      let preview;
      try {
        preview = await service.previewUniversityContentSourceProfileForAdmin(
          { kind: "global" },
          target.universityId,
          target.contentType,
          { activateWhenHealthy: true },
          systemActorId
        );
      } catch {
        throw new Error(`CURATED_CONTENT_SOURCE_RECONCILIATION_FAILED:${target.universityId}:${target.contentType}`);
      }
      const activeState = readSavedSourceState(preview);
      if (
        preview.status !== "healthy"
        || !Number.isFinite(preview.acceptedItemCount)
        || preview.acceptedItemCount <= 0
        || preview.activationStatus !== "active"
        || activeState.status !== "active"
        || activeState.trustStatus !== "trusted"
        || activeState.approvalPending !== false
        || activeState.id !== stagedId
      ) {
        throw new Error(`CURATED_CONTENT_SOURCE_RECONCILIATION_FAILED:${target.universityId}:${target.contentType}`);
      }
      let probe;
      try {
        probe = await service.probeSourceForDeviceManifestById(stagedId);
      } catch {
        throw new Error(`CURATED_CONTENT_SOURCE_DEVICE_PROBE_FAILED:${target.universityId}:${target.contentType}`);
      }
      if (probe.status !== "healthy" || !Number.isFinite(probe.itemCount) || probe.itemCount <= 0) {
        throw new Error(`CURATED_CONTENT_SOURCE_DEVICE_PROBE_FAILED:${target.universityId}:${target.contentType}`);
      }
      await assertOnlyTargetSourceIsPublished(service, target, stagedId);
      results.push({
        universityId: target.universityId,
        contentType: target.contentType,
        sourceUrl: target.sourceUrl,
        itemCount: preview.acceptedItemCount,
        activationStatus: "active"
      });
    }
    return results;
  } catch (error) {
    await cleanupTargetsFailClosed(service, targets);
    if (error instanceof Error && error.message.startsWith("CURATED_CONTENT_SOURCE_")) throw error;
    throw new Error("CURATED_CONTENT_SOURCE_RECONCILIATION_FAILED");
  }
}

async function cleanupTargetsFailClosed(
  service: ReconciliationService,
  targets: CuratedContentSourceTarget[]
): Promise<void> {
  const failures = (await Promise.all(targets.map(async (target) => {
    try {
      await stageTargetInactive(service, target);
    } catch {
      try {
        await deactivateCompetingSources(service, target, null);
      } catch {
        // Final state verification below is authoritative even when a cleanup attempt throws.
      }
    }
    try {
      await assertOnlyTargetSourceIsPublished(service, target, null);
      return null;
    } catch {
      return target;
    }
  }))).filter((target): target is CuratedContentSourceTarget => target !== null);
  if (failures.length > 0) {
    throw new Error(`CURATED_CONTENT_SOURCE_CLEANUP_FAILED:${failures
      .map((target) => `${target.universityId}:${target.contentType}`)
      .join(",")}`);
  }
}

async function stageTargetInactive(
  service: ReconciliationService,
  target: CuratedContentSourceTarget
): Promise<string> {
  const saved = await service.saveUniversityContentSourceProfileForAdmin(
    { kind: "global" },
    target.universityId,
    target.contentType,
    desiredInactiveProfile(target)
  );
  const stagedState = readSavedSourceState(saved);
  if (!stagedState.id || stagedState.status !== "inactive" || stagedState.approvalPending !== false) {
    throw new Error(`CURATED_CONTENT_SOURCE_STAGING_FAILED:${target.universityId}:${target.contentType}`);
  }
  await deactivateCompetingSources(service, target, stagedState.id);
  await assertOnlyTargetSourceIsPublished(service, target, null);
  return stagedState.id;
}

async function deactivateCompetingSources(
  service: ReconciliationService,
  target: CuratedContentSourceTarget,
  keepSourceId: string | null
): Promise<void> {
  for (const candidate of await listTargetSources(service, target)) {
    const state = readManagedSourceState(candidate);
    if ((keepSourceId !== null && state.id === keepSourceId) || (state.status !== "active" && state.approvalPending !== true)) continue;
    await service.deactivateManualSourceForAdmin({ kind: "global" }, state.id, {
      expectedSourceDefinitionVersion: state.sourceDefinitionVersion,
      expectedCanonicalUrl: state.canonicalUrl,
      expectedTrustStatus: state.trustStatus,
      expectedSourceStatus: state.status,
      expectedApprovalPending: state.approvalPending
    });
  }
}

async function assertOnlyTargetSourceIsPublished(
  service: ReconciliationService,
  target: CuratedContentSourceTarget,
  expectedPublishedId: string | null
): Promise<void> {
  const sources = (await listTargetSources(service, target)).map(readManagedSourceState);
  const published = sources
    .filter((source) => source.status === "active" && source.trustStatus === "trusted" && !source.approvalPending);
  const competingLiveSource = sources.some((source) => (
    source.id !== expectedPublishedId && (source.status === "active" || source.approvalPending)
  ));
  if (
    competingLiveSource
    || (expectedPublishedId === null
      ? published.length !== 0
      : published.length !== 1 || published[0]?.id !== expectedPublishedId)
  ) {
    throw new Error(`CURATED_CONTENT_SOURCE_DUPLICATE_ACTIVE:${target.universityId}:${target.contentType}`);
  }
}

async function listTargetSources(
  service: ReconciliationService,
  target: CuratedContentSourceTarget
): Promise<unknown[]> {
  const matches: unknown[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await service.listSourcesForAdmin({ kind: "global" }, {
      scopeType: "university",
      contentType: target.contentType,
      limit: pageSize,
      offset
    });
    matches.push(...page.filter((source) => (
      isRecord(source) && source.scopeType === "university" && source.scopeId === target.universityId
    )));
    if (page.length < pageSize) return matches;
  }
}

function readManagedSourceState(input: unknown): {
  id: string;
  canonicalUrl: string;
  sourceDefinitionVersion: string;
  status: "active" | "inactive";
  trustStatus: "trusted" | "rejected" | "quarantined";
  approvalPending: boolean;
} {
  if (!isRecord(input)) throw new Error("CURATED_CONTENT_SOURCE_STATE_INVALID");
  const id = typeof input.id === "string" ? input.id : "";
  const canonicalUrl = typeof input.canonicalUrl === "string"
    ? input.canonicalUrl
    : typeof input.sourceUrl === "string" ? input.sourceUrl : "";
  const sourceDefinitionVersion = typeof input.sourceDefinitionVersion === "string" ? input.sourceDefinitionVersion : "";
  const status = input.status === "active" || input.status === "inactive" ? input.status : null;
  const trustStatus = input.trustStatus === "trusted" || input.trustStatus === "rejected" || input.trustStatus === "quarantined"
    ? input.trustStatus
    : null;
  if (!id || !canonicalUrl || !status || !trustStatus) throw new Error("CURATED_CONTENT_SOURCE_STATE_INVALID");
  return { id, canonicalUrl, sourceDefinitionVersion, status, trustStatus, approvalPending: input.approvalPending === true };
}

function desiredInactiveProfile(target: CuratedContentSourceTarget) {
  return {
    sourceUrl: target.sourceUrl,
    parser: target.parser,
    parserConfig: target.parserConfig ?? {},
    status: "inactive" as const
  };
}

function targetKey(target: CuratedContentSourceTarget): string {
  return `${target.universityId}\u0000${target.contentType}`;
}

function readSavedSourceState(input: unknown): { id?: string; status?: string; trustStatus?: string; approvalPending?: boolean } {
  if (!isRecord(input)) return {};
  const source = isRecord(input.source) ? input.source : input;
  return {
    ...(typeof source.id === "string" ? { id: source.id } : {}),
    ...(typeof source.status === "string" ? { status: source.status } : {}),
    ...(typeof source.trustStatus === "string" ? { trustStatus: source.trustStatus } : {}),
    ...(typeof source.approvalPending === "boolean" ? { approvalPending: source.approvalPending } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI?.trim()) throw new Error("MONGODB_URI is required.");
  const mongo = new MongoConnectionService();
  await mongo.connect();
  try {
    const announcementRepository = new MongoAnnouncementRepository(mongo);
    const notificationRepository = new MongoNotificationRepository(mongo);
    const service = new AnnouncementIngestionService(
      new MongoCatalogRepository(mongo),
      announcementRepository,
      new NotificationSchedulingService(notificationRepository, announcementRepository)
    );
    const universityId = process.env.CURATED_SOURCE_UNIVERSITY?.trim();
    const contentType = process.env.CURATED_SOURCE_TYPE?.trim();
    if (contentType && !contentTypes.includes(contentType as typeof contentTypes[number])) {
      throw new Error("CURATED_CONTENT_SOURCE_TYPE_INVALID");
    }
    const results = await reconcileCuratedContentSourceProfiles(service, {
      ...(universityId ? { universityId } : {}),
      ...(contentType ? { contentType: contentType as typeof contentTypes[number] } : {})
    });
    process.stdout.write(`${JSON.stringify({ status: "ok", reconciled: results.length, results })}\n`);
  } finally {
    await mongo.onApplicationShutdown();
  }
}

const isEntrypoint = resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
