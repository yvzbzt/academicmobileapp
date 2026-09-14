import { listVerifiedUniversitySources } from "../apps/api/src/bootstrap/verified-source-registry.js";
import { resolveSourceAuthorityContext } from "../apps/api/src/bootstrap/source-authority-context.js";
import {
  fetchText,
  parseFetchedSourceItems,
  type ParsedAnnouncementItem
} from "../apps/api/src/modules/announcements/announcement-parser.js";
import { officialDomainForUrl } from "../apps/api/src/modules/announcements/announcement-content-trust.js";
import {
  DEVICE_SOURCE_ACCEPT_LANGUAGE,
  DEVICE_SOURCE_USER_AGENT,
  parseDeviceSourceRuntimeDocument,
  type DeviceSourceRuntimeItem
} from "../packages/shared/src/device-source-runtime.js";

const maximumResponseBytes = 4 * 1024 * 1024;
const expectedUniversityCount = 208;
const expectedCuratedProfileCount = 3;
const contentTypes = ["announcement", "news", "event"] as const;
const sourceUrlFields = {
  announcement: "announcementUrl",
  news: "newsUrl",
  event: "eventUrl"
} as const;

type ComparableItem = DeviceSourceRuntimeItem | ParsedAnnouncementItem;

function normalizedItemProjection(item: ComparableItem): Record<string, string | null> {
  return {
    title: item.title,
    link: item.link,
    publicationKind: item.publicationKind ?? null,
    publishedDate: item.publishedDate ?? null,
    publishedAt: normalizedTimestamp(item.publishedAt),
    sourceUpdatedAt: normalizedTimestamp(item.sourceUpdatedAt),
    summary: item.summary ?? null
  };
}

function normalizedTimestamp(value: Date | string | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function main(): Promise<void> {
  const checkedAt = new Date().toISOString();
  const results: Array<Record<string, unknown>> = [];
  const sources = await listVerifiedUniversitySources();
  if (sources.length !== expectedUniversityCount) {
    throw new Error(`CURATED_SOURCE_REGISTRY_COUNT_INVALID:${sources.length}:${expectedUniversityCount}`);
  }
  const targets = [] as Array<{
    source: (typeof sources)[number];
    contentType: (typeof contentTypes)[number];
    profile: NonNullable<(typeof sources)[number]["parserProfiles"]>[(typeof contentTypes)[number]];
    sourceUrl: string;
  }>;
  for (const source of sources) {
    for (const contentType of contentTypes) {
      const profile = source.parserProfiles?.[contentType];
      if (!profile) continue;
      const sourceUrl = source[sourceUrlFields[contentType]];
      if (!sourceUrl) throw new Error(`CURATED_SOURCE_URL_MISSING:${source.universityId}:${contentType}`);
      targets.push({ source, contentType, profile, sourceUrl });
    }
  }
  if (targets.length !== expectedCuratedProfileCount) {
    throw new Error(`CURATED_SOURCE_PROFILE_COUNT_INVALID:${targets.length}:${expectedCuratedProfileCount}`);
  }

  for (const { source, contentType, profile, sourceUrl } of targets) {
    const officialDomain = officialDomainForUrl(sourceUrl);
    if (!officialDomain) throw new Error(`CURATED_SOURCE_DOMAIN_INVALID:${source.universityId}:${contentType}`);
    const authority = await resolveSourceAuthorityContext({
      universityId: source.universityId,
      ownerAcademicEntityId: source.universityId,
      scopeType: "university",
      scopeId: source.universityId
    });
    if (authority.authorityStatus !== "verified") {
      throw new Error(`CURATED_SOURCE_AUTHORITY_INVALID:${source.universityId}:${contentType}`);
    }
    const response = await fetchText(sourceUrl, 10_000, {
      accept: "text/html,application/xhtml+xml",
      acceptLanguage: DEVICE_SOURCE_ACCEPT_LANGUAGE,
      userAgent: DEVICE_SOURCE_USER_AGENT,
      authority: authority.context,
      resource: contentType,
      maximumRedirects: 5,
      maximumResponseBytes
    });
    if (officialDomainForUrl(response.finalUrl) !== officialDomain) {
      throw new Error(`CURATED_SOURCE_REDIRECT_REJECTED:${source.universityId}:${contentType}`);
    }
    const deviceItems = parseDeviceSourceRuntimeDocument(response.text, {
      sourceUrl: response.finalUrl,
      allowedOfficialDomain: officialDomain,
      contentType,
      parser: profile.parser,
      parserConfig: profile.parserConfig,
      checkedAt
    }, response.finalUrl);
    const backendItems = parseFetchedSourceItems(
      response.text,
      response.finalUrl,
      profile.parser,
      contentType,
      profile.parserConfig
    );
    if (deviceItems.length === 0 || backendItems.length === 0) {
      throw new Error(`CURATED_SOURCE_LAYOUT_INVALID:${source.universityId}:${contentType}`);
    }
    const deviceProjection = deviceItems.map(normalizedItemProjection);
    const backendProjection = backendItems.map(normalizedItemProjection);
    if (JSON.stringify(deviceProjection) !== JSON.stringify(backendProjection)) {
      const mismatchIndex = deviceProjection.findIndex((item, index) => (
        JSON.stringify(item) !== JSON.stringify(backendProjection[index])
      ));
      throw new Error(`CURATED_SOURCE_PARSER_DIVERGENCE:${source.universityId}:${contentType}:${mismatchIndex}`);
    }
    results.push({
      universityId: source.universityId,
      contentType,
      sourceUrl,
      finalUrl: response.finalUrl,
      itemCount: deviceItems.length,
      datedItemCount: deviceItems.filter((item) => item.publishedDate || item.publishedAt).length,
      firstTitle: deviceItems[0]?.title
    });
  }
  process.stdout.write(`${JSON.stringify({ status: "ok", checkedAt, results })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
