import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { TrustedAcademicContentCollectionDto, TrustedAcademicContentDto } from "../../../../../packages/shared/src/contracts.js";
import type { AuthRepository } from "../auth/auth.types.js";
import type { CatalogRepository } from "../catalog/catalog.types.js";
import type { UserDataRepository } from "../users/user-data.types.js";
import { AnnouncementIngestionService, YOK_ANNOUNCEMENT_SCOPE_ID, YOK_ANNOUNCEMENT_SOURCE_URL } from "./announcement-ingestion.service.js";
import { academicContentLogicalIdentityKey, canonicalContentKey, compareAcademicContentDuplicateRecency, toTrustedAcademicContentDto } from "./announcement-content-trust.js";
import type { AnnouncementItem, AnnouncementRepository, AnnouncementSourceRecord, SavedAnnouncementStatus } from "./announcements.types.js";
import { NotificationSchedulingService } from "../notifications/notifications.service.js";

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject("AuthRepository") private readonly authRepository: AuthRepository,
    @Inject("AnnouncementRepository") private readonly announcementRepository: AnnouncementRepository,
    @Optional() @Inject("CatalogRepository") private readonly catalogRepository?: CatalogRepository,
    @Optional() @Inject(AnnouncementIngestionService) _announcementIngestionService?: AnnouncementIngestionService,
    @Optional() @Inject(NotificationSchedulingService) _notificationSchedulingService?: NotificationSchedulingService,
    @Optional() @Inject("UserDataRepository") private readonly userDataRepository?: Pick<UserDataRepository, "listFollowedAcademicScopesByUserId">
  ) {}

  async getMyAnnouncements(userId: string, limit = 20): Promise<TrustedAcademicContentDto[]> {
    return (await this.getMyAnnouncementsCollection(userId, limit)).items;
  }

  async getMyAnnouncementsCollection(userId: string, limit = 20): Promise<TrustedAcademicContentCollectionDto> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    const scopes = await this.academicScopesForUser(userId, user);
    if (scopes.length === 0) return toContentCollection([], 0, 0);
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const scopeResults = await Promise.all(scopes.map(async (scope) => {
      const sources = await this.announcementRepository.listSourcesByScope(scope);
      const items = sources.length === 0
        ? []
        : await this.announcementRepository.listItemsByScope({
          ...scope,
          limit: Math.max(boundedLimit * 3, 100)
        });
      return { sources, items };
    }));
    const sources = uniqueSources(scopeResults.flatMap((result) => result.sources));
    if (sources.length === 0) {
      // Source discovery probes multiple external candidates and belongs to the
      // scheduled/admin ingestion path. A student feed read must stay bounded
      // when a university has not been configured or ingested yet.
      return toContentCollection([], 0, 0);
    }

    const cachedItems = scopeResults.flatMap((result) => result.items);
    const presentedItems = markExpiredAnnouncementItems(cachedItems);
    const hierarchyByScope = await loadAcademicHierarchyByScope(this.catalogRepository, scopes);
    return toContentCollection(
      presentTrustedItems(presentedItems, sources)
        .map((item) => attachAcademicHierarchy(item, hierarchyByScope))
        .slice(0, boundedLimit),
      sources.length,
      persistedFailedSourceCount(sources)
    );
  }

  async getMyTrustedAnnouncement(userId: string, announcementId: string): Promise<TrustedAcademicContentDto> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    const userScopes = await this.academicScopesForUser(userId, user);
    const scopedMatches = await Promise.all(userScopes.map((scope) =>
      this.announcementRepository.findTrustedItemByIdInScope({ announcementId, ...scope })));
    const match = scopedMatches.find((candidate) => candidate !== null)
      ?? await this.announcementRepository.findTrustedItemByIdInScope({
        announcementId,
        universityId: YOK_ANNOUNCEMENT_SCOPE_ID
      });
    if (!match) {
      throw new NotFoundException("Trusted announcement not found.");
    }
    const presented = toTrustedAcademicContentDto(match.item, match.source);
    if (!presented) throw new NotFoundException("Trusted announcement not found.");
    const trustedPresentation: TrustedAcademicContentDto = presented;
    const presentationScope = match.source.scopeType === "university"
      && match.source.scopeId === YOK_ANNOUNCEMENT_SCOPE_ID
      ? { universityId: YOK_ANNOUNCEMENT_SCOPE_ID }
      : userScopes.find((scope) => scopeContainsSource(scope, match.source))
        ?? scopeForSource(match.source);
    const [sources, hierarchyByScope] = await Promise.all([
      this.announcementRepository.listSourcesByScope(presentationScope),
      loadAcademicHierarchyByScope(this.catalogRepository, [...userScopes, presentationScope])
    ]);
    const scopedItems = await this.announcementRepository.listItemsByScope({
      ...presentationScope,
      limit: 1_000
    });
    const trustedPresentationIdentity = academicContentLogicalIdentityKey(trustedPresentation);
    const logical = trustedPresentationIdentity
      ? presentTrustedItems(scopedItems, sources).find((item) =>
        academicContentLogicalIdentityKey(item) === trustedPresentationIdentity)
      : undefined;
    const result = logical ? {
      ...trustedPresentation,
      ...(logical.canonicalUrlAliases ? { canonicalUrlAliases: logical.canonicalUrlAliases } : {}),
      ...(logical.sourceRelationships ? { sourceRelationships: logical.sourceRelationships } : {})
    } : trustedPresentation;
    return attachAcademicHierarchy(result, hierarchyByScope);
  }

  async getMySavedAnnouncementStatus(userId: string, announcementId: string): Promise<SavedAnnouncementStatus> {
    await this.assertUserExists(userId);
    const saved = await this.announcementRepository.findSavedAnnouncement(userId, announcementId);
    return saved
      ? { announcementId, saved: true, savedAt: saved.savedAt.toISOString() }
      : { announcementId, saved: false };
  }

  async saveMyAnnouncement(userId: string, announcementId: string): Promise<SavedAnnouncementStatus> {
    await this.getMyTrustedAnnouncement(userId, announcementId);
    const saved = await this.announcementRepository.saveAnnouncement(userId, announcementId, new Date());
    return { announcementId, saved: true, savedAt: saved.savedAt.toISOString() };
  }

  async deleteMySavedAnnouncement(userId: string, announcementId: string): Promise<SavedAnnouncementStatus> {
    await this.assertUserExists(userId);
    await this.announcementRepository.deleteSavedAnnouncement(userId, announcementId);
    return { announcementId, saved: false };
  }

  async getYokAnnouncements(limit = 60): Promise<TrustedAcademicContentDto[]> {
    return (await this.getYokAnnouncementsCollection(limit)).items;
  }

  async getYokAnnouncementsCollection(limit = 60): Promise<TrustedAcademicContentCollectionDto> {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const yokSourceKey = canonicalContentKey(YOK_ANNOUNCEMENT_SOURCE_URL);
    const source = (await this.announcementRepository.listSourcesByScope({ universityId: YOK_ANNOUNCEMENT_SCOPE_ID }))
      .find((candidate) => canonicalContentKey(candidate.canonicalUrl ?? candidate.sourceUrl) === yokSourceKey);
    if (!source) return toContentCollection([], 0, 0);
    const cachedItems = await this.announcementRepository.listItemsForSource(source.id, Math.max(boundedLimit * 2, 100));
    const presentedItems = markExpiredAnnouncementItems(cachedItems);
    return toContentCollection(
      presentTrustedItems(presentedItems, [source]).slice(0, boundedLimit),
      1,
      persistedFailedSourceCount([source])
    );
  }

  private async assertUserExists(userId: string): Promise<void> {
    if (!await this.authRepository.findUserById(userId)) throw new NotFoundException("User not found.");
  }

  private async academicScopesForUser(
    userId: string,
    user: { universityId?: string; facultyId?: string; departmentId?: string }
  ): Promise<AnnouncementScopeInput[]> {
    const primary = user.universityId ? [{
      universityId: user.universityId,
      ...(user.facultyId ? { facultyId: user.facultyId } : {}),
      ...(user.departmentId ? { departmentId: user.departmentId } : {})
    }] : [];
    const followed = this.userDataRepository
      ? await this.userDataRepository.listFollowedAcademicScopesByUserId(userId)
      : [];
    return uniqueScopes([
      ...primary,
      ...followed.map((scope) => ({
        universityId: scope.universityId,
        ...(scope.facultyId ? { facultyId: scope.facultyId } : {}),
        ...(scope.departmentId ? { departmentId: scope.departmentId } : {})
      }))
    ]);
  }

}

type AnnouncementScopeInput = {
  universityId: string;
  facultyId?: string;
  departmentId?: string;
};

type AcademicContentHierarchy = Pick<
  TrustedAcademicContentDto,
  "universityId" | "universityName" | "facultyId" | "facultyName" | "departmentId" | "departmentName"
>;

function uniqueScopes(scopes: readonly AnnouncementScopeInput[]): AnnouncementScopeInput[] {
  return [...new Map(scopes.map((scope) => [
    [scope.universityId, scope.facultyId ?? "", scope.departmentId ?? ""].join("\u0000"),
    scope
  ])).values()];
}

function uniqueSources(sources: readonly AnnouncementSourceRecord[]): AnnouncementSourceRecord[] {
  return [...new Map(sources.map((source) => [source.id, source])).values()];
}

async function loadAcademicHierarchyByScope(
  catalogRepository: CatalogRepository | undefined,
  scopes: readonly AnnouncementScopeInput[]
): Promise<Map<string, AcademicContentHierarchy>> {
  const hierarchyByScope = new Map<string, AcademicContentHierarchy>();
  if (!catalogRepository) return hierarchyByScope;

  const unique = uniqueScopes(scopes).filter((scope) => scope.universityId !== "*");
  const universityIds = [...new Set(unique.map((scope) => scope.universityId))];
  const universities = new Map((await Promise.all(universityIds.map(async (universityId) => {
    const university = await catalogRepository.findUniversityById(universityId);
    return university ? [[university.id, university] as const] : [];
  }))).flat());

  const facultiesByUniversity = new Map<string, Awaited<ReturnType<CatalogRepository["listFaculties"]>>>();
  await Promise.all(universityIds.map(async (universityId) => {
    if (!unique.some((scope) => scope.universityId === universityId && scope.facultyId)) return;
    facultiesByUniversity.set(universityId, await catalogRepository.listFaculties(universityId, "active"));
  }));

  const facultyIds = [...new Set(unique.flatMap((scope) => scope.facultyId ? [scope.facultyId] : []))];
  const departmentsByFaculty = new Map<string, Awaited<ReturnType<CatalogRepository["listDepartments"]>>>();
  await Promise.all(facultyIds.map(async (facultyId) => {
    if (!unique.some((scope) => scope.facultyId === facultyId && scope.departmentId)) return;
    departmentsByFaculty.set(facultyId, await catalogRepository.listDepartments(facultyId, "active"));
  }));

  for (const scope of unique) {
    const university = universities.get(scope.universityId);
    if (!university) continue;
    const universityHierarchy: AcademicContentHierarchy = {
      universityId: university.id,
      universityName: university.name
    };
    hierarchyByScope.set(academicScopeKey("university", university.id), universityHierarchy);

    const faculty = scope.facultyId
      ? facultiesByUniversity.get(university.id)?.find((candidate) => candidate.id === scope.facultyId)
      : undefined;
    if (!faculty) continue;
    const facultyHierarchy: AcademicContentHierarchy = {
      ...universityHierarchy,
      facultyId: faculty.id,
      facultyName: faculty.name
    };
    hierarchyByScope.set(academicScopeKey("faculty", faculty.id), facultyHierarchy);

    const department = scope.departmentId
      ? departmentsByFaculty.get(faculty.id)?.find((candidate) => candidate.id === scope.departmentId)
      : undefined;
    if (!department) continue;
    hierarchyByScope.set(academicScopeKey("department", department.id), {
      ...facultyHierarchy,
      departmentId: department.id,
      departmentName: department.name
    });
  }

  return hierarchyByScope;
}

function attachAcademicHierarchy(
  item: TrustedAcademicContentDto,
  hierarchyByScope: ReadonlyMap<string, AcademicContentHierarchy>
): TrustedAcademicContentDto {
  const hierarchy = hierarchyByScope.get(academicScopeKey(item.scopeType, item.scopeId));
  return hierarchy ? { ...item, ...hierarchy } : item;
}

function academicScopeKey(scopeType: TrustedAcademicContentDto["scopeType"], scopeId: string): string {
  return `${scopeType}\u0000${scopeId}`;
}

function scopeContainsSource(scope: AnnouncementScopeInput, source: AnnouncementSourceRecord): boolean {
  if (source.scopeType === "university") return source.scopeId === scope.universityId;
  if (source.scopeType === "faculty") return source.scopeId === scope.facultyId;
  return source.scopeId === scope.departmentId;
}

function scopeForSource(source: AnnouncementSourceRecord): AnnouncementScopeInput {
  if (source.scopeType === "university") return { universityId: source.scopeId };
  if (source.scopeType === "faculty") return { universityId: "*", facultyId: source.scopeId };
  return { universityId: "*", departmentId: source.scopeId };
}

function presentTrustedItems(items: AnnouncementItem[], sources: AnnouncementSourceRecord[]): TrustedAcademicContentDto[] {
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const unique = new Map<string, TrustedAcademicContentDto>();
  for (const item of items) {
    const presented = toTrustedAcademicContentDto(item, sourcesById.get(item.sourceId));
    if (!presented) continue;
    const key = academicContentLogicalIdentityKey(presented);
    if (!key) continue;
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
  const sourceTimestamp = Math.max(...[
    item.publishedAt,
    item.sourceUpdatedAt,
    item.publishedDate ? `${item.publishedDate}T12:00:00+03:00` : undefined
  ].map(parseContentTimestamp), 0);
  return sourceTimestamp > 0 ? sourceTimestamp : parseContentTimestamp(item.discoveredAt);
}

function parseContentTimestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
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

function markExpiredAnnouncementItems(items: AnnouncementItem[], now = Date.now()): AnnouncementItem[] {
  const latestFetchedAtBySource = new Map<string, number>();
  for (const item of items) {
    const fetchedAt = Date.parse(item.fetchedAt ?? "");
    latestFetchedAtBySource.set(
      item.sourceId,
      Number.isFinite(fetchedAt)
        ? Math.max(latestFetchedAtBySource.get(item.sourceId) ?? 0, fetchedAt)
        : 0,
    );
  }
  const ttlMs = readPositiveInteger(process.env.ANNOUNCEMENT_CACHE_TTL_MS, 10 * 60 * 1_000);
  const staleSources = new Set(
    [...latestFetchedAtBySource.entries()]
      .filter(([, fetchedAt]) => fetchedAt <= 0 || now - fetchedAt > ttlMs)
      .map(([sourceId]) => sourceId),
  );
  return items.map((item) => staleSources.has(item.sourceId) ? markStale(item) : item);
}

function markStale(item: AnnouncementItem): AnnouncementItem {
  return { ...item, freshness: "stale" };
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
