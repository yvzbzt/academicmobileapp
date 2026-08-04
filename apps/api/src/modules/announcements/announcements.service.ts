import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { TrustedAcademicContentCollectionDto, TrustedAcademicContentDto } from "../../../../../packages/shared/src/contracts.js";
import type { AuthRepository } from "../auth/auth.types.js";
import type { CatalogRepository } from "../catalog/catalog.types.js";
import { AnnouncementIngestionService, discoverAnnouncementSourceForUniversity, YOK_ANNOUNCEMENT_SCOPE_ID, YOK_ANNOUNCEMENT_SOURCE_URL } from "./announcement-ingestion.service.js";
import { canonicalContentKey, compareAcademicContentDuplicateRecency, isOfficialContentUrl, scopedContentFingerprintKey, toTrustedAcademicContentDto } from "./announcement-content-trust.js";
import { fetchSourceItems, toAnnouncementItems, type ParsedAnnouncementItem } from "./announcement-parser.js";
import type { AnnouncementItem, AnnouncementRepository, AnnouncementSourceRecord } from "./announcements.types.js";
import { NotificationSchedulingService } from "../notifications/notifications.service.js";

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject("AuthRepository") private readonly authRepository: AuthRepository,
    @Inject("AnnouncementRepository") private readonly announcementRepository: AnnouncementRepository,
    @Optional() @Inject("CatalogRepository") private readonly catalogRepository?: CatalogRepository,
    @Optional() @Inject(AnnouncementIngestionService) private readonly announcementIngestionService?: AnnouncementIngestionService,
    @Optional() @Inject(NotificationSchedulingService) private readonly notificationSchedulingService?: NotificationSchedulingService
  ) {}

  async getMyAnnouncements(userId: string, limit = 20): Promise<TrustedAcademicContentDto[]> {
    return (await this.getMyAnnouncementsCollection(userId, limit)).items;
  }

  async getMyAnnouncementsCollection(userId: string, limit = 20): Promise<TrustedAcademicContentCollectionDto> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");

    const scopeInput = {
      universityId: user.universityId,
      ...(user.facultyId ? { facultyId: user.facultyId } : {}),
      ...(user.departmentId ? { departmentId: user.departmentId } : {})
    };
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    await this.announcementIngestionService?.ensureStaticAnnouncementSources();
    let sources = await this.announcementRepository.listSourcesByScope(scopeInput);
    if (sources.length === 0) {
      await this.discoverAndStoreUniversitySource(user.universityId);
      sources = await this.announcementRepository.listSourcesByScope(scopeInput);
    }

    const cachedItems = await this.announcementRepository.listItemsByScope({ ...scopeInput, limit: Math.max(boundedLimit * 4, 100) });
    const cachedSourceIds = new Set(cachedItems.map((item) => item.sourceId));
    const hasUncachedSources = sources.some((source) => !cachedSourceIds.has(source.id));
    if (!hasUncachedSources && cachedItems.length > 0 && areAnnouncementItemsFresh(cachedItems)) {
      return toContentCollection(
        presentTrustedItems(cachedItems, sources).slice(0, boundedLimit),
        sources.length,
        persistedFailedSourceCount(sources)
      );
    }

    if (sources.length === 0) {
      return toContentCollection(presentTrustedItems(cachedItems, sources).slice(0, boundedLimit), 0, 0);
    }
    const refreshed = await this.refreshSources(sources, cachedItems);
    const merged = refreshed.items;
    return toContentCollection(
      presentTrustedItems(merged, sources).slice(0, boundedLimit),
      sources.length,
      refreshed.failedSourceCount
    );
  }

  async getMyTrustedAnnouncement(userId: string, announcementId: string): Promise<TrustedAcademicContentDto> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    const userScope = user.universityId ? {
      universityId: user.universityId,
      ...(user.facultyId ? { facultyId: user.facultyId } : {}),
      ...(user.departmentId ? { departmentId: user.departmentId } : {})
    } : undefined;
    const match = (userScope
      ? await this.announcementRepository.findTrustedItemByIdInScope({ announcementId, ...userScope })
      : null)
      ?? await this.announcementRepository.findTrustedItemByIdInScope({
        announcementId,
        universityId: YOK_ANNOUNCEMENT_SCOPE_ID
      });
    if (!match) {
      if (!userScope) throw new BadRequestException("User must select a university first.");
      throw new NotFoundException("Trusted announcement not found.");
    }
    const presented = toTrustedAcademicContentDto(match.item, match.source);
    if (!presented) throw new NotFoundException("Trusted announcement not found.");
    const trustedPresentation: TrustedAcademicContentDto = presented;
    const presentationScope = match.source.scopeType === "university"
      && match.source.scopeId === YOK_ANNOUNCEMENT_SCOPE_ID
      ? { universityId: YOK_ANNOUNCEMENT_SCOPE_ID }
      : userScope!;
    const sources = await this.announcementRepository.listSourcesByScope(presentationScope);
    const scopedItems = await this.announcementRepository.listItemsByScope({
      ...presentationScope,
      limit: 1_000
    });
    const logical = presentTrustedItems(scopedItems, sources).find((item) =>
      item.scopeType === trustedPresentation.scopeType
      && item.scopeId === trustedPresentation.scopeId
      && item.contentFingerprint === trustedPresentation.contentFingerprint);
    return logical ? {
      ...trustedPresentation,
      ...(logical.canonicalUrlAliases ? { canonicalUrlAliases: logical.canonicalUrlAliases } : {}),
      ...(logical.sourceRelationships ? { sourceRelationships: logical.sourceRelationships } : {})
    } : trustedPresentation;
  }

  async getYokAnnouncements(limit = 60): Promise<TrustedAcademicContentDto[]> {
    return (await this.getYokAnnouncementsCollection(limit)).items;
  }

  async getYokAnnouncementsCollection(limit = 60): Promise<TrustedAcademicContentCollectionDto> {
    const source = await this.announcementRepository.upsertSource({
      scopeType: "university",
      scopeId: YOK_ANNOUNCEMENT_SCOPE_ID,
      sourceName: "YÖK Duyuruları",
      sourceUrl: YOK_ANNOUNCEMENT_SOURCE_URL,
      contentType: "announcement",
      parser: "auto",
      priority: 100,
      status: "active",
      homepageUrl: "https://www.yok.gov.tr/tr",
      discoveryMethod: "manual"
    });
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const cachedItems = await this.announcementRepository.listItemsForSource(source.id, Math.max(boundedLimit * 2, 100));
    if (cachedItems.length > 0 && areAnnouncementItemsFresh(cachedItems)) {
      return toContentCollection(
        presentTrustedItems(cachedItems, [source]).slice(0, boundedLimit),
        1,
        persistedFailedSourceCount([source])
      );
    }

    const fetchedAt = new Date();
    try {
      const parsedItems = await fetchSourceItems(source.sourceUrl, source.parser);
      const items = toAnnouncementItems(source, parsedItems, fetchedAt);
      if (parsedItems.length === 0) {
        const delta = await this.announcementRepository.replaceItemsForSource(source, [], { authoritativeEmpty: true });
        await this.notificationSchedulingService?.syncTrustedAnnouncementSource(source, delta, fetchedAt);
        const persistedItems = await this.announcementRepository.listItemsForSource(source.id, Math.max(boundedLimit * 2, 100));
        return toContentCollection(presentTrustedItems(persistedItems, [source]).slice(0, boundedLimit), 1, 0);
      }
      if (items.length > 0) {
        const delta = await this.announcementRepository.replaceItemsForSource(source, items);
        await this.notificationSchedulingService?.syncTrustedAnnouncementSource(source, delta, fetchedAt);
        const persistedItems = await this.announcementRepository.listItemsForSource(source.id, Math.max(boundedLimit * 2, 100));
        return toContentCollection(presentTrustedItems(persistedItems, [source]).slice(0, boundedLimit), 1, 0);
      }
    } catch {
      // A stale, previously trusted cache is safer and more honest than a
      // crawler timestamp fabricated as publication time.
    }
    return toContentCollection(presentTrustedItems(cachedItems.map(markStale), [source]).slice(0, boundedLimit), 1, 1);
  }

  private async discoverAndStoreUniversitySource(universityId: string): Promise<AnnouncementSourceRecord | null> {
    const university = await this.catalogRepository?.findUniversityById(universityId);
    if (!university) return null;
    const result = await discoverAnnouncementSourceForUniversity(university, { timeoutMs: readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7_000) });
    if (result.status !== "source_found" || !result.sourceUrl) return null;
    const officialHomepage = university.websiteUrl ?? result.homepageUrl;
    if (!officialHomepage || !isOfficialContentUrl(result.sourceUrl, officialHomepage)) return null;

    const checkedAt = new Date();
    return this.announcementRepository.upsertSource({
      scopeType: "university",
      scopeId: university.id,
      sourceName: `${university.name} Duyurular`,
      sourceUrl: result.sourceUrl,
      contentType: "announcement",
      parser: result.parser ?? "auto",
      priority: 20,
      status: "active",
      homepageUrl: officialHomepage,
      discoveryMethod: university.websiteUrl ? "catalog_website" : "domain_candidate",
      healthStatus: result.itemCount > 0 ? "healthy" : "degraded",
      lastCheckedAt: checkedAt,
      ...(result.itemCount > 0 ? { lastSuccessAt: checkedAt } : {}),
      consecutiveFailures: result.itemCount > 0 ? 0 : 1,
      itemCount: result.itemCount
    });
  }

  private async refreshSources(
    sources: AnnouncementSourceRecord[],
    cachedItems: AnnouncementItem[]
  ): Promise<{ items: AnnouncementItem[]; failedSourceCount: number }> {
    const fetchedAt = new Date();
    const cachedBySource = new Map<string, AnnouncementItem[]>();
    for (const item of cachedItems) cachedBySource.set(item.sourceId, [...(cachedBySource.get(item.sourceId) ?? []), item]);
    const groups = await Promise.all(sources.map((source) => this.refreshSource(source, fetchedAt, cachedBySource.get(source.id) ?? [])));
    return {
      items: groups.flatMap((group) => group.items),
      failedSourceCount: groups.filter((group) => group.failed).length
    };
  }

  private async refreshSource(
    source: AnnouncementSourceRecord,
    fetchedAt: Date,
    cachedItems: AnnouncementItem[]
  ): Promise<{ items: AnnouncementItem[]; failed: boolean }> {
    try {
      const parsedItems = await fetchSourceItems(source.sourceUrl, source.parser, readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7_000));
      const items = toAnnouncementItems(source, parsedItems, fetchedAt);
      const authoritativeEmpty = parsedItems.length === 0;
      const succeeded = items.length > 0 || authoritativeEmpty;
      await this.announcementRepository.recordSourceCheck(source.id, {
        healthStatus: succeeded ? "healthy" : "degraded",
        lastCheckedAt: fetchedAt,
        ...(succeeded ? { lastSuccessAt: fetchedAt } : {}),
        ...(succeeded ? {} : { lastError: "No trusted announcement items parsed." }),
        consecutiveFailures: succeeded ? 0 : (source.consecutiveFailures ?? 0) + 1,
        itemCount: items.length
      });
      if (succeeded) {
        const delta = await this.announcementRepository.replaceItemsForSource(
          source,
          items,
          authoritativeEmpty ? { authoritativeEmpty: true } : {}
        );
        await this.notificationSchedulingService?.syncTrustedAnnouncementSource(source, delta, fetchedAt);
        return {
          items: await this.announcementRepository.listItemsForSource(source.id, 1_000),
          failed: false
        };
      }
    } catch (error) {
      await this.announcementRepository.recordSourceCheck(source.id, {
        healthStatus: "degraded",
        lastCheckedAt: fetchedAt,
        lastError: controlledSourceError(error),
        consecutiveFailures: (source.consecutiveFailures ?? 0) + 1,
        itemCount: 0
      });
    }

    const fallbackItems = toAnnouncementItems(source, fallbackParsedItems(source), fetchedAt).map(markStale);
    return { items: (cachedItems.length > 0 ? cachedItems : fallbackItems).map(markStale), failed: true };
  }
}

function fallbackParsedItems(source: AnnouncementSourceRecord): ParsedAnnouncementItem[] {
  return (source.fallbackItems ?? []).map((item) => ({
    title: item.title,
    rawTitle: item.rawTitle ?? item.title,
    link: item.link,
    ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    ...(item.publishedDate ? { publishedDate: item.publishedDate, publicationKind: item.publicationKind ?? "date" as const } : {}),
    ...(item.sourceUpdatedAt ? { sourceUpdatedAt: item.sourceUpdatedAt } : {}),
    ...(item.summary ? { summary: item.summary } : {})
  }));
}

function presentTrustedItems(items: AnnouncementItem[], sources: AnnouncementSourceRecord[]): TrustedAcademicContentDto[] {
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const unique = new Map<string, TrustedAcademicContentDto>();
  for (const item of items) {
    const presented = toTrustedAcademicContentDto(item, sourcesById.get(item.sourceId));
    if (!presented) continue;
    const key = presented.contentFingerprint
      ? scopedContentFingerprintKey({
        scopeType: presented.scopeType,
        scopeId: presented.scopeId,
        contentFingerprint: presented.contentFingerprint
      })
      : `${presented.scopeType}\u0000${presented.scopeId}\u0000${canonicalContentKey(presented.canonicalUrl) ?? ""}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, presented);
      continue;
    }
    const preferred = compareAcademicContentDuplicateRecency(presented, existing) > 0 ? presented : existing;
    unique.set(key, {
      ...preferred,
      canonicalUrlAliases: [...new Set([
        existing.canonicalUrl,
        ...(existing.canonicalUrlAliases ?? []),
        presented.canonicalUrl,
        ...(presented.canonicalUrlAliases ?? [])
      ])].sort((left, right) => left.localeCompare(right, "en-US")),
      sourceRelationships: mergeSourceRelationships(existing, presented)
    });
  }
  return [...unique.values()].sort((left, right) => contentTimestamp(right) - contentTimestamp(left));
}

function toContentCollection(
  items: TrustedAcademicContentDto[],
  sourceCount: number,
  failedSourceCount: number
): TrustedAcademicContentCollectionDto {
  const staleCount = items.filter((item) => item.freshness === "stale").length;
  const state = failedSourceCount > 0 || (staleCount > 0 && staleCount < items.length)
    ? "partial"
    : staleCount > 0
      ? "stale"
      : "fresh";
  return { items, state, sourceCount, failedSourceCount };
}

function persistedFailedSourceCount(sources: AnnouncementSourceRecord[]): number {
  return sources.filter((source) =>
    source.healthStatus === "degraded"
    || source.healthStatus === "failed"
    || (source.consecutiveFailures ?? 0) > 0
  ).length;
}

function contentTimestamp(item: TrustedAcademicContentDto): number {
  return Math.max(...[item.publishedAt, item.sourceUpdatedAt, item.discoveredAt, item.publishedDate ? `${item.publishedDate}T12:00:00+03:00` : undefined]
    .map((value) => value ? Date.parse(value) : 0)
    .filter(Number.isFinite), 0);
}

function mergeSourceRelationships(
  left: TrustedAcademicContentDto,
  right: TrustedAcademicContentDto
): NonNullable<TrustedAcademicContentDto["sourceRelationships"]> {
  const relationships = [...(left.sourceRelationships ?? []), ...(right.sourceRelationships ?? [])];
  return [...new Map(relationships.map((relationship) => [
    [relationship.scopeType, relationship.scopeId, relationship.sourceId, relationship.canonicalUrl].join("\u0000"),
    relationship
  ])).values()].sort((first, second) =>
    first.scopeType.localeCompare(second.scopeType, "en-US")
    || first.scopeId.localeCompare(second.scopeId, "en-US")
    || first.sourceId.localeCompare(second.sourceId, "en-US")
    || first.canonicalUrl.localeCompare(second.canonicalUrl, "en-US"));
}

function areAnnouncementItemsFresh(items: AnnouncementItem[], now = Date.now()): boolean {
  const latestFetchedAtBySource = new Map<string, number>();
  for (const item of items) {
    const fetchedAt = Date.parse(item.fetchedAt ?? "");
    if (!Number.isFinite(fetchedAt)) return false;
    latestFetchedAtBySource.set(item.sourceId, Math.max(latestFetchedAtBySource.get(item.sourceId) ?? 0, fetchedAt));
  }
  const ttlMs = readPositiveInteger(process.env.ANNOUNCEMENT_CACHE_TTL_MS, 10 * 60 * 1_000);
  return latestFetchedAtBySource.size > 0
    && [...latestFetchedAtBySource.values()].every((fetchedAt) => fetchedAt > 0 && now - fetchedAt <= ttlMs);
}

function markStale(item: AnnouncementItem): AnnouncementItem {
  return { ...item, freshness: "stale" };
}

function controlledSourceError(error: unknown): string {
  if (!(error instanceof Error)) return "SOURCE_REFRESH_FAILED";
  const code = error.message.match(/^[A-Z][A-Z\d_:-]+$/u)?.[0];
  return code?.slice(0, 160) ?? "SOURCE_REFRESH_FAILED";
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
