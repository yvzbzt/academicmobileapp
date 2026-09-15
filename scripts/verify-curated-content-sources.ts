import { listVerifiedUniversitySources } from "../apps/api/src/bootstrap/verified-source-registry.js";
import { resolveSourceAuthorityContext } from "../apps/api/src/bootstrap/source-authority-context.js";
import { fetchDeviceRuntimeSourceSnapshot } from "../apps/api/src/modules/announcements/announcement-parser.js";

const contentTypes = ["announcement", "news", "event"] as const;

async function main(): Promise<void> {
  const checkedAt = new Date();
  const sources = await listVerifiedUniversitySources();
  if (sources.length !== 208) throw new Error(`CURATED_SOURCE_REGISTRY_COUNT_INVALID:${sources.length}:208`);
  const universityId = process.env.CURATED_SOURCE_UNIVERSITY?.trim();
  const targets = sources.filter(source => !universityId || source.universityId === universityId)
    .flatMap(source => contentTypes.flatMap(contentType => {
      const profile = source.parserProfiles?.[contentType];
      if (!profile) return [];
      const sourceUrl = source[`${contentType}Url`];
      if (!sourceUrl) throw new Error(`CURATED_SOURCE_URL_MISSING:${source.universityId}:${contentType}`);
      return [{ source, contentType, profile, sourceUrl }];
    }));
  if (targets.length === 0) throw new Error("CURATED_SOURCE_PROFILE_COUNT_INVALID:0");

  let next = 0;
  const results: Array<Record<string, unknown>> = [];
  await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async () => {
    while (next < targets.length) {
      const { source, contentType, profile, sourceUrl } = targets[next++]!;
      const started = performance.now();
      try {
        const authority = await resolveSourceAuthorityContext({
          universityId: source.universityId, ownerAcademicEntityId: source.universityId,
          scopeType: "university", scopeId: source.universityId,
        });
        if (authority.authorityStatus !== "verified") throw new Error("CURATED_SOURCE_AUTHORITY_INVALID");
        // The same transport, redirect/body limits and parser as admin previews and mobile health probes.
        const snapshot = await fetchDeviceRuntimeSourceSnapshot(sourceUrl, profile.parser, 10000,
          { authority: authority.context, resource: contentType }, {}, contentType, checkedAt, profile.parserConfig);
        if (snapshot.items.length === 0) throw new Error("CURATED_SOURCE_LAYOUT_INVALID");
        results.push({ universityId: source.universityId, contentType, sourceUrl, status: "ok",
          finalUrl: snapshot.finalUrl, itemCount: snapshot.items.length,
          datedItemCount: snapshot.items.filter(item => item.publishedDate || item.publishedAt || item.keyDates?.length).length,
          firstTitle: snapshot.items[0]?.title, elapsedMs: Math.round(performance.now() - started) });
      } catch (error) {
        results.push({ universityId: source.universityId, contentType, sourceUrl, status: "failed",
          error: error instanceof Error ? error.message : String(error), elapsedMs: Math.round(performance.now() - started) });
      }
    }
  }));
  results.sort((left, right) => `${left.universityId}:${left.contentType}`.localeCompare(`${right.universityId}:${right.contentType}`));
  const failed = results.filter(result => result.status === "failed").length;
  process.stdout.write(`${JSON.stringify({ status: failed ? "failed" : "ok", checkedAt: checkedAt.toISOString(), checked: results.length, failed, results })}\n`);
  if (failed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
