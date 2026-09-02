import { BadRequestException, Inject, Injectable, NotFoundException, OnApplicationBootstrap, OnModuleDestroy, Optional } from "@nestjs/common";
import { findVerifiedAcademicUnitSource, findVerifiedUniversitySource, listVerifiedAcademicUnitSources, listVerifiedUniversitySources, type VerifiedAcademicUnitSource } from "../../bootstrap/verified-source-registry.js";
import { resolveSourceAuthorityContext, type ResolvedSourceAuthorityContext } from "../../bootstrap/source-authority-context.js";
import { assertUniversityTarget, type AdminUniversityAccess } from "../../common/authorization/admin-university-access.js";
import { evaluateSourceAuthority, SourceAuthorityError, type SourceAuthorityContext } from "../../domain/source-authority-enforcement.js";
import type { SourceAuthorityDecision, SourceAuthorityResource } from "../../domain/source-authority-policy.js";
import type { CatalogRepository, DepartmentRecord, FacultyRecord, UniversityRecord } from "../catalog/catalog.types.js";
import { fetchSourceItems, fetchSourceSnapshot, fetchText, parseHtmlAnchors, toAnnouncementItems, cleanText, containsAnnouncementHint } from "./announcement-parser.js";
import { canonicalAnnouncementSourceIdentityKey, canonicalizeContentUrl, isOfficialContentUrl } from "./announcement-content-trust.js";
import type { AnnouncementContentType, AnnouncementRepository, AnnouncementSourceCandidateInput, AnnouncementSourceParser, AnnouncementSourceRecord, AnnouncementSourceScope, AnnouncementSourceStatus } from "./announcements.types.js";
import { NotificationSchedulingService } from "../notifications/notifications.service.js";

export interface AnnouncementDiscoveryResult {
  universityId: string;
  universityName: string;
  status: "source_found" | "homepage_found_no_items" | "homepage_not_found";
  homepageUrl?: string;
  sourceUrl?: string;
  parser?: AnnouncementSourceParser;
  itemCount: number;
  checkedHomepageCandidates: number;
  checkedSourceCandidates: number;
  sampleTitles: string[];
  error?: string;
}

export interface AnnouncementIngestionResult {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  status: "healthy" | "degraded" | "failed";
  itemCount: number;
  sampleTitles: string[];
  error?: string;
}

export const YOK_ANNOUNCEMENT_SCOPE_ID = "yok-council-of-higher-education";
export const YOK_ANNOUNCEMENT_SOURCE_URL = "https://www.yok.gov.tr/tr/announcements";

@Injectable()
export class AnnouncementIngestionService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private staticSourcesPromise: Promise<void> | null = null;

  constructor(
    @Inject("CatalogRepository") private readonly catalogRepository: CatalogRepository,
    @Inject("AnnouncementRepository") private readonly announcementRepository: AnnouncementRepository,
    @Optional() @Inject(NotificationSchedulingService) private readonly notificationSchedulingService?: NotificationSchedulingService
  ) {}

  onApplicationBootstrap() {
    if (process.env.ANNOUNCEMENT_AUTO_INGEST_ENABLED !== "true") return;
    const initialDelayMs = readPositiveInteger(process.env.ANNOUNCEMENT_INGEST_INITIAL_DELAY_MS, 5000);
    const schedulerTickMs = Math.max(30_000, readPositiveInteger(process.env.ANNOUNCEMENT_SCHEDULER_TICK_MS, 60_000));
    this.timer = setInterval(() => void this.runScheduledCycle(), schedulerTickMs);
    setTimeout(() => void this.runScheduledCycle(), initialDelayMs);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runSourceDiscovery(input: { limit?: number; offset?: number; concurrency?: number } = {}) {
    const universities = await this.listUniversities(input.limit ?? readPositiveInteger(process.env.ANNOUNCEMENT_DISCOVERY_BATCH_SIZE, 205), input.offset ?? 0);
    const discoveryResults = await runWithConcurrency(
      universities,
      input.concurrency ?? readPositiveInteger(process.env.ANNOUNCEMENT_DISCOVERY_CONCURRENCY, 4),
      (university) => this.discoverUniversitySource(university)
    );

    return {
      summary: summarizeDiscovery(discoveryResults),
      results: discoveryResults
    };
  }

  async runDiscoveryAndIngestion(input: { limit?: number; offset?: number; refreshSources?: boolean; concurrency?: number } = {}) {
    const discovery = await this.runSourceDiscovery({
      ...(input.limit ? { limit: input.limit } : {}),
      ...(input.offset ? { offset: input.offset } : {}),
      ...(input.concurrency ? { concurrency: input.concurrency } : {})
    });
    const ingestion = await this.runIngestion({ ...(input.concurrency ? { concurrency: input.concurrency } : {}) });
    return {
      discovery: discovery.summary,
      ingestion: summarizeIngestion(ingestion.results),
      discoveryResults: discovery.results,
      ingestionResults: ingestion.results
    };
  }

  async runIngestion(input: { limit?: number; offset?: number; concurrency?: number } = {}) {
    const sources = await this.announcementRepository.listAllSources({ status: "active", limit: input.limit ?? 1000, offset: input.offset ?? 0 });
    const results = await runWithConcurrency(sources, input.concurrency ?? readPositiveInteger(process.env.ANNOUNCEMENT_INGEST_CONCURRENCY, 6), (source) => this.ingestSource(source));
    return { summary: summarizeIngestion(results), results };
  }

  async listSources(input: { status?: "active" | "inactive"; limit?: number; offset?: number } = {}) {
    return this.announcementRepository.listAllSources(input);
  }

  async listSourcesForAdmin(
    access: AdminUniversityAccess,
    input: { status?: "active" | "inactive"; limit?: number; offset?: number } = {}
  ) {
    if (access.kind === "global") return this.listSources(input);
    return this.announcementRepository.listSourcesByScopeSet({
      scopes: await this.listAnnouncementScopesForUniversity(access.universityId),
      ...(input.status ? { status: input.status } : {}),
      limit: Math.min(Math.max(input.limit ?? 1000, 1), 1000),
      offset: Math.max(input.offset ?? 0, 0)
    });
  }

  async createManualSourceForAdmin(access: AdminUniversityAccess, input: ManualAnnouncementSourceInput) {
    assertUniversityTarget(access, input.universityId);
    return this.createManualSource(input);
  }

  async updateManualSourceForAdmin(access: AdminUniversityAccess, id: string, input: ManualAnnouncementSourceUpdateInput) {
    await this.getSourceForAdmin(access, id);
    return this.updateManualSource(id, input);
  }

  async deactivateManualSourceForAdmin(access: AdminUniversityAccess, id: string) {
    await this.getSourceForAdmin(access, id);
    return this.deactivateManualSource(id);
  }

  async ingestSourceByIdForAdmin(access: AdminUniversityAccess, id: string) {
    await this.getSourceForAdmin(access, id);
    return this.ingestSourceById(id);
  }

  async runSourceDiscoveryForAdmin(
    access: AdminUniversityAccess,
    input: { limit?: number; offset?: number; concurrency?: number } = {}
  ) {
    if (access.kind === "global") return this.runSourceDiscovery(input);
    const university = await this.catalogRepository.findUniversityById(access.universityId);
    if (!university || university.status !== "active") throw new NotFoundException("University not found.");
    const universities = (input.offset ?? 0) > 0 ? [] : [university];
    const results = await runWithConcurrency(
      universities,
      input.concurrency ?? readPositiveInteger(process.env.ANNOUNCEMENT_DISCOVERY_CONCURRENCY, 4),
      (candidate) => this.discoverUniversitySource(candidate)
    );
    return { summary: summarizeDiscovery(results), results };
  }

  async runIngestionForAdmin(
    access: AdminUniversityAccess,
    input: { limit?: number; offset?: number; concurrency?: number } = {}
  ) {
    if (access.kind === "global") return this.runIngestion(input);
    const sources = await this.listSourcesForAdmin(access, {
      status: "active",
      limit: input.limit ?? 1000,
      offset: input.offset ?? 0
    });
    const results = await runWithConcurrency(
      sources,
      input.concurrency ?? readPositiveInteger(process.env.ANNOUNCEMENT_INGEST_CONCURRENCY, 6),
      (source) => this.ingestSource(source)
    );
    return { summary: summarizeIngestion(results), results };
  }

  async runDiscoveryAndIngestionForAdmin(
    access: AdminUniversityAccess,
    input: { limit?: number; offset?: number; refreshSources?: boolean; concurrency?: number } = {}
  ) {
    if (access.kind === "global") return this.runDiscoveryAndIngestion(input);
    const discovery = await this.runSourceDiscoveryForAdmin(access, input);
    const ingestion = await this.runIngestionForAdmin(access, {
      ...(input.limit ? { limit: input.limit } : {}),
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
      ...(input.concurrency ? { concurrency: input.concurrency } : {})
    });
    return {
      discovery: discovery.summary,
      ingestion: ingestion.summary,
      discoveryResults: discovery.results,
      ingestionResults: ingestion.results
    };
  }

  async createManualSource(input: ManualAnnouncementSourceInput) {
    const scope = await this.resolveManualScope(input);
    const authority = await this.resolveAuthority(scope.university, input.scopeType, scope.scopeId);
    const decision = evaluateSourceAuthority(authority.context, {
      boundary: "registration",
      resource: sourceAuthorityResource(input.contentType),
      url: input.sourceUrl
    });
    if (!decision.allowed || !decision.canonicalUrl) {
      await this.insertRejectedCandidate({
        scopeType: input.scopeType,
        scopeId: scope.scopeId,
        sourceName: input.sourceName,
        sourceUrl: decision.canonicalUrl ?? input.sourceUrl,
        contentType: input.contentType,
        parser: input.parser,
        priority: input.priority,
        homepageUrl: scope.homepageUrl,
        discoveryMethod: "manual",
        healthStatus: "failed",
        lastError: decision.reasonCode,
        consecutiveFailures: 0,
        itemCount: 0,
        fetchIntervalMinutes: input.fetchIntervalMinutes,
        trustReasonCodes: [decision.reasonCode]
      });
      throw new BadRequestException(`Source authority validation failed: ${decision.reasonCode}.`);
    }
    const sourceHomepageUrl = isOfficialContentUrl(decision.canonicalUrl, scope.homepageUrl)
      ? scope.homepageUrl
      : homepageFromUrl(decision.canonicalUrl) ?? scope.homepageUrl;
    const source = await this.announcementRepository.upsertSource({
      scopeType: input.scopeType,
      scopeId: scope.scopeId,
      sourceName: input.sourceName,
      sourceUrl: decision.canonicalUrl,
      contentType: input.contentType,
      parser: input.parser,
      priority: input.priority,
      status: "active",
      homepageUrl: sourceHomepageUrl,
      discoveryMethod: "manual",
      healthStatus: "pending",
      consecutiveFailures: 0,
      itemCount: 0,
      fetchIntervalMinutes: input.fetchIntervalMinutes,
      // This admin-only command is the explicit approval boundary. Automated
      // discovery and registry provisioning use insertQuarantinedSourceCandidate.
      trustStatus: "trusted"
    });
    const ingestion = await this.ingestSource(source);
    return { source: await this.announcementRepository.findSourceById(source.id) ?? source, ingestion };
  }

  async updateManualSource(id: string, input: ManualAnnouncementSourceUpdateInput) {
    const existing = await this.announcementRepository.findSourceById(id);
    if (!existing) throw new NotFoundException("Announcement source not found.");
    const definedInput = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined)
    ) as ManualAnnouncementSourceUpdateInput;
    const authority = await this.resolveAuthorityForSource(existing);
    const requestedUrl = input.sourceUrl ?? existing.sourceUrl;
    const decision = authority
      ? evaluateSourceAuthority(authority.context, {
        boundary: "registration",
        resource: sourceAuthorityResource(input.contentType ?? existing.contentType),
        url: requestedUrl
      })
      : missingSourceOwnerDecision(existing, requestedUrl, "registration");
    if (!decision.allowed || !decision.canonicalUrl) {
      const quarantined = await this.announcementRepository.quarantineSource(existing.id, [decision.reasonCode]);
      await this.retireSourceNotifications(quarantined ?? { ...existing, status: "inactive", trustStatus: "quarantined" });
      throw new BadRequestException(`Source authority validation failed: ${decision.reasonCode}.`);
    }
    const sourceUrl = decision.canonicalUrl;
    const homepageUrl = existing.homepageUrl;
    if (!homepageUrl) throw new BadRequestException("Source homepage authority evidence is missing.");
    const sourceHomepageUrl = isOfficialContentUrl(sourceUrl, homepageUrl)
      ? homepageUrl
      : homepageFromUrl(sourceUrl) ?? homepageUrl;
    const updated = await this.announcementRepository.upsertSource({
      ...sourceInputFromRecord(existing),
      id: existing.id,
      ...definedInput,
      sourceUrl,
      homepageUrl: sourceHomepageUrl,
      discoveryMethod: "manual",
      trustStatus: "trusted",
      trustReasonCodes: []
    });
    if (updated.status !== "active") {
      await this.retireSourceNotifications(updated);
      return { source: updated, ingestion: null };
    }
    const ingestion = await this.ingestSource(updated);
    return { source: await this.announcementRepository.findSourceById(updated.id) ?? updated, ingestion };
  }

  async deactivateManualSource(id: string) {
    const source = await this.announcementRepository.deactivateSource(id);
    if (!source) throw new NotFoundException("Announcement source not found.");
    await this.retireSourceNotifications(source);
    return source;
  }

  async ingestSourceById(id: string) {
    const source = await this.announcementRepository.findSourceById(id);
    if (!source) throw new NotFoundException("Announcement source not found.");
    if (source.status !== "active") throw new BadRequestException("Inactive sources cannot be ingested.");
    return this.ingestSource(source);
  }

  /**
   * Explicitly provisions registry candidates for later review. Runtime startup,
   * ingestion, and read paths must never call this method.
   */
  async provisionStaticAnnouncementSources(): Promise<void> {
    this.staticSourcesPromise ??= this.upsertStaticAnnouncementSources();
    return this.staticSourcesPromise;
  }

  private async upsertStaticAnnouncementSources(): Promise<void> {
    const existingSourceKeys = new Set((await this.announcementRepository.listAllSources({ limit: 5_000, offset: 0 }))
      .map((source) => staticSourceIdentityKey(source.scopeType, source.scopeId, source.canonicalUrl ?? source.sourceUrl))
      .filter((key): key is string => Boolean(key)));
    const provisionIfMissing = async (
      input: Parameters<AnnouncementRepository["insertQuarantinedSourceCandidate"]>[0],
      authority: ResolvedSourceAuthorityContext
    ): Promise<void> => {
      const decision = evaluateSourceAuthority(authority.context, {
        boundary: "registration",
        resource: sourceAuthorityResource(input.contentType),
        url: input.sourceUrl
      });
      const sourceUrl = decision.canonicalUrl ?? canonicalizeContentUrl(input.sourceUrl);
      if (!sourceUrl) return;
      const candidate = {
        ...input,
        sourceUrl,
        trustReasonCodes: decision.allowed ? [] : [decision.reasonCode]
      };
      const key = staticSourceIdentityKey(candidate.scopeType, candidate.scopeId, candidate.sourceUrl);
      if (!key || existingSourceKeys.has(key)) return;
      existingSourceKeys.add(key);
      try {
        await this.announcementRepository.insertQuarantinedSourceCandidate(candidate);
      } catch (error) {
        existingSourceKeys.delete(key);
        throw error;
      }
    };

    await provisionIfMissing({
      scopeType: "university",
      scopeId: YOK_ANNOUNCEMENT_SCOPE_ID,
      sourceName: "YÖK Duyuruları",
      sourceUrl: YOK_ANNOUNCEMENT_SOURCE_URL,
      contentType: "announcement",
      parser: "auto",
      priority: 100,
      homepageUrl: "https://www.yok.gov.tr/tr",
      discoveryMethod: "manual"
    }, await resolveSourceAuthorityContext({
      universityId: YOK_ANNOUNCEMENT_SCOPE_ID,
      ownerAcademicEntityId: YOK_ANNOUNCEMENT_SCOPE_ID,
      scopeType: "university",
      scopeId: YOK_ANNOUNCEMENT_SCOPE_ID
    }));

    const verifiedSources = await listVerifiedUniversitySources();
    await Promise.all(verifiedSources.map(async (source) => {
      const university = await this.catalogRepository.findUniversityById(source.universityId);
      if (!university) return;
      const definitions = verifiedContentSourceDefinitions(source);
      const officialHomepage = university.websiteUrl ?? knownOfficialUniversityUrls(university.id)[0] ?? knownOfficialUniversityUrls(university.slug)[0];
      if (!officialHomepage) return;
      await Promise.all(definitions
        .map(async (definition) => provisionIfMissing({
          scopeType: "university",
          scopeId: source.universityId,
          sourceName: `${source.universityName} ${definition.label}`,
          sourceUrl: definition.url,
          contentType: definition.contentType,
          parser: "auto",
          priority: definition.priority,
          homepageUrl: canonicalizeContentUrl(officialHomepage) ?? officialHomepage,
          discoveryMethod: "manual"
        }, await this.resolveAuthority(university, "university", university.id))));
    }));

    const verifiedAcademicUnitSources = await listVerifiedAcademicUnitSources();
    const facultyCache = new Map<string, Promise<FacultyRecord[]>>();
    const departmentCache = new Map<string, Promise<DepartmentRecord[]>>();
    await Promise.all(verifiedAcademicUnitSources.map(async (source) => {
      const scopeId = source.scopeType === "department" ? source.departmentId : source.facultyId;
      if (!scopeId) return;
      const university = await this.catalogRepository.findUniversityById(source.universityId);
      if (!university) return;
      const faculties = await (facultyCache.get(university.id) ?? (() => {
        const request = this.catalogRepository.listFaculties(university.id, "active");
        facultyCache.set(university.id, request);
        return request;
      })());
      const facultyId = source.facultyId;
      if (!facultyId || !faculties.some((faculty) => faculty.id === facultyId)) return;
      if (source.scopeType === "department") {
        const departments = await (departmentCache.get(facultyId) ?? (() => {
          const request = this.catalogRepository.listDepartments(facultyId, "active");
          departmentCache.set(facultyId, request);
          return request;
        })());
        if (!source.departmentId || !departments.some((department) => department.id === source.departmentId)) return;
      }
      const definitions = verifiedContentSourceDefinitions(source);
      const universityAuthority = university.websiteUrl ?? knownOfficialUniversityUrls(university.id)[0] ?? knownOfficialUniversityUrls(university.slug)[0];
      if (!universityAuthority) return;
      const officialHomepage = source.websiteUrl && isOfficialContentUrl(source.websiteUrl, universityAuthority)
        ? source.websiteUrl
        : universityAuthority;
      await Promise.all(definitions
        .map(async (definition) => {
        const unitName = source.scopeType === "department" ? source.departmentName ?? "Bölüm" : source.facultyName ?? "Fakülte";
        const sourceName = `${source.universityName ?? source.universityId} ${unitName} ${definition.label}`;
        return provisionIfMissing({
          scopeType: source.scopeType,
          scopeId,
          sourceName,
          sourceUrl: definition.url,
          contentType: definition.contentType,
          parser: "auto",
          priority: definition.priority + (source.scopeType === "department" ? 15 : 10),
          homepageUrl: canonicalizeContentUrl(officialHomepage) ?? officialHomepage,
          discoveryMethod: "manual"
        }, await this.resolveAuthority(university, source.scopeType, scopeId));
      }));
    }));
  }

  private async runScheduledCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const activeSources = await this.announcementRepository.listAllSources({ status: "active", limit: 1000, offset: 0 });
      const universitySources = activeSources.filter((source) => source.scopeId !== YOK_ANNOUNCEMENT_SCOPE_ID);
      if (universitySources.length === 0 || process.env.ANNOUNCEMENT_REFRESH_SOURCES === "true") {
        await this.runDiscoveryAndIngestion();
        return;
      }
      const dueSources = activeSources.filter((source) => isSourceDue(source));
      if (dueSources.length === 0) return;
      await runWithConcurrency(
        dueSources,
        readPositiveInteger(process.env.ANNOUNCEMENT_INGEST_CONCURRENCY, 6),
        (source) => this.ingestSource(source)
      );
    } finally {
      this.running = false;
    }
  }

  async ingestSource(source: AnnouncementSourceRecord): Promise<AnnouncementIngestionResult> {
    if (source.status !== "active" || source.trustStatus !== "trusted") {
      throw new BadRequestException("Only active, trusted announcement sources can be ingested.");
    }
    const checkedAt = new Date();
    const authority = await this.resolveAuthorityForSource(source);
    const registrationDecision = authority
      ? evaluateSourceAuthority(authority.context, {
        boundary: "registration",
        resource: sourceAuthorityResource(source.contentType),
        url: source.sourceUrl
      })
      : missingSourceOwnerDecision(source, source.sourceUrl, "registration");
    if (!registrationDecision.allowed) {
      return this.quarantineIngestionSource(source, registrationDecision, checkedAt);
    }
    try {
      const snapshot = await fetchSourceSnapshot(
        source.sourceUrl,
        source.parser,
        readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7000),
        { authority: authority!.context, resource: sourceAuthorityResource(source.contentType) }
      );
      const parsedItems = snapshot.items;
      const items = toAnnouncementItems(source, parsedItems, checkedAt);
      const publicationDecision = evaluateSourceAuthority(authority!.context, {
        boundary: "publication",
        resource: sourceAuthorityResource(source.contentType),
        url: source.sourceUrl,
        finalRedirectUrl: snapshot.finalUrl
      });
      if (!publicationDecision.allowed) {
        return this.quarantineIngestionSource(source, publicationDecision, checkedAt);
      }
      const rejectedItemDecision = items
        .map((item) => evaluateSourceAuthority(authority!.context, {
          boundary: "publication",
          resource: sourceAuthorityResource(item.contentType ?? source.contentType),
          url: item.canonicalUrl ?? item.link
        }))
        .find((decision) => !decision.allowed);
      if (rejectedItemDecision) {
        return this.quarantineIngestionSource(source, rejectedItemDecision, checkedAt);
      }
      const authoritativeEmpty = parsedItems.length === 0;
      const succeeded = items.length > 0 || authoritativeEmpty;
      if (succeeded) {
        const delta = await this.announcementRepository.replaceItemsForSource(
          source,
          items,
          authoritativeEmpty ? { authoritativeEmpty: true } : {}
        );
        await this.notificationSchedulingService?.syncTrustedAnnouncementSource(source, delta, checkedAt);
      }
      const status = succeeded ? "healthy" : "degraded";
      await this.announcementRepository.recordSourceCheck(source.id, {
        healthStatus: status,
        lastCheckedAt: checkedAt,
        ...(succeeded ? { lastSuccessAt: checkedAt } : {}),
        ...(succeeded ? {} : { lastError: "No trusted announcement items parsed." }),
        consecutiveFailures: succeeded ? 0 : (source.consecutiveFailures ?? 0) + 1,
        itemCount: items.length
      });
      return { sourceId: source.id, sourceName: source.sourceName, sourceUrl: source.sourceUrl, status, itemCount: items.length, sampleTitles: items.slice(0, 3).map((item) => item.title) };
    } catch (error) {
      if (error instanceof SourceAuthorityError) {
        return this.quarantineIngestionSource(source, error.decision, checkedAt);
      }
      const message = error instanceof Error ? error.message : String(error);
      const failures = (source.consecutiveFailures ?? 0) + 1;
      await this.announcementRepository.recordSourceCheck(source.id, {
        healthStatus: failures >= 3 ? "failed" : "degraded",
        lastCheckedAt: checkedAt,
        lastError: message,
        consecutiveFailures: failures,
        itemCount: 0
      });
      return { sourceId: source.id, sourceName: source.sourceName, sourceUrl: source.sourceUrl, status: failures >= 3 ? "failed" : "degraded", itemCount: 0, sampleTitles: [], error: message };
    }
  }

  private resolveAuthority(
    university: UniversityRecord,
    scopeType: "university" | "faculty" | "department",
    scopeId: string
  ): Promise<ResolvedSourceAuthorityContext> {
    return resolveAuthorityForUniversityRecord(university, scopeType, scopeId);
  }

  private async resolveAuthorityForSource(source: AnnouncementSourceRecord): Promise<ResolvedSourceAuthorityContext | null> {
    if (source.scopeType === "university" && source.scopeId === YOK_ANNOUNCEMENT_SCOPE_ID) {
      return resolveSourceAuthorityContext({
        universityId: YOK_ANNOUNCEMENT_SCOPE_ID,
        ownerAcademicEntityId: YOK_ANNOUNCEMENT_SCOPE_ID,
        scopeType: "university",
        scopeId: YOK_ANNOUNCEMENT_SCOPE_ID
      });
    }
    if (source.scopeType === "university") {
      const university = await this.catalogRepository.findUniversityById(source.scopeId);
      return university ? this.resolveAuthority(university, "university", university.id) : null;
    }

    const universities = await this.catalogRepository.listUniversities({ status: "active", limit: 5_000, offset: 0 });
    for (const university of universities) {
      const faculties = await this.catalogRepository.listFaculties(university.id, "active");
      if (source.scopeType === "faculty" && faculties.some((faculty) => faculty.id === source.scopeId)) {
        return this.resolveAuthority(university, "faculty", source.scopeId);
      }
      if (source.scopeType !== "department") continue;
      for (const faculty of faculties) {
        const department = (await this.catalogRepository.listDepartments(faculty.id, "active"))
          .find((candidate) => candidate.id === source.scopeId && candidate.universityId === university.id);
        if (department) return this.resolveAuthority(university, "department", department.id);
      }
    }
    return null;
  }

  private async insertRejectedCandidate(input: AnnouncementSourceCandidateInput): Promise<void> {
    try {
      await this.announcementRepository.insertQuarantinedSourceCandidate(input);
    } catch {
      // Unsafe/non-canonical URLs cannot be stored. The policy denial remains
      // the authoritative result returned to the caller.
    }
  }

  private async quarantineIngestionSource(
    source: AnnouncementSourceRecord,
    decision: SourceAuthorityDecision,
    checkedAt: Date
  ): Promise<AnnouncementIngestionResult> {
    const quarantined = await this.announcementRepository.quarantineSource(source.id, [decision.reasonCode]);
    await this.announcementRepository.recordSourceCheck(source.id, {
      healthStatus: "failed",
      lastCheckedAt: checkedAt,
      lastError: decision.reasonCode,
      consecutiveFailures: (source.consecutiveFailures ?? 0) + 1,
      itemCount: 0
    });
    await this.retireSourceNotifications(quarantined ?? { ...source, status: "inactive", trustStatus: "quarantined" });
    return {
      sourceId: source.id,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      status: "failed",
      itemCount: 0,
      sampleTitles: [],
      error: decision.reasonCode
    };
  }

  private async listUniversities(limit: number, offset: number): Promise<UniversityRecord[]> {
    return this.catalogRepository.listUniversities({ status: "active", limit, offset });
  }

  private async discoverUniversitySource(university: UniversityRecord): Promise<AnnouncementDiscoveryResult> {
    const result = await discoverAnnouncementSourceForUniversity(university, {
      timeoutMs: readPositiveInteger(process.env.ANNOUNCEMENT_SOURCE_TIMEOUT_MS, 7000)
    });
    if (result.status !== "source_found" || !result.sourceUrl) return result;
    const officialHomepage = university.websiteUrl ?? result.homepageUrl;
    const authority = await this.resolveAuthority(university, "university", university.id);
    const registrationDecision = evaluateSourceAuthority(authority.context, {
      boundary: "registration",
      resource: "announcement",
      url: result.sourceUrl
    });
    if (!officialHomepage || !registrationDecision.allowed || !registrationDecision.canonicalUrl) {
      if (officialHomepage) {
        await this.insertRejectedCandidate({
          scopeType: "university",
          scopeId: university.id,
          sourceName: `${university.name} Duyurular`,
          sourceUrl: registrationDecision.canonicalUrl ?? result.sourceUrl,
          contentType: "announcement",
          parser: result.parser ?? "auto",
          priority: 20,
          homepageUrl: canonicalizeContentUrl(officialHomepage) ?? officialHomepage,
          discoveryMethod: university.websiteUrl ? "catalog_website" : "domain_candidate",
          trustReasonCodes: [registrationDecision.reasonCode]
        });
      }
      const { sourceUrl: _sourceUrl, parser: _parser, ...rest } = result;
      void _sourceUrl;
      void _parser;
      return {
        ...rest,
        status: "homepage_found_no_items",
        itemCount: 0,
        sampleTitles: [],
        error: registrationDecision.reasonCode
      };
    }

    await this.announcementRepository.insertQuarantinedSourceCandidate({
      scopeType: "university",
      scopeId: university.id,
      sourceName: `${university.name} Duyurular`,
      sourceUrl: registrationDecision.canonicalUrl,
      contentType: "announcement",
      parser: result.parser ?? "auto",
      priority: 20,
      homepageUrl: canonicalizeContentUrl(officialHomepage) ?? officialHomepage,
      discoveryMethod: university.websiteUrl ? "catalog_website" : "domain_candidate",
      healthStatus: result.itemCount > 0 ? "healthy" : "degraded",
      lastCheckedAt: new Date(),
      ...(result.itemCount > 0 ? { lastSuccessAt: new Date() } : {}),
      consecutiveFailures: result.itemCount > 0 ? 0 : 1,
      itemCount: result.itemCount,
      trustReasonCodes: []
    });
    return result;
  }

  private async listAnnouncementScopesForUniversity(universityId: string): Promise<AnnouncementSourceScope[]> {
    const faculties = await this.catalogRepository.listFaculties(universityId);
    const departments = (await Promise.all(faculties.map((faculty) => this.catalogRepository.listDepartments(faculty.id)))).flat();
    return [
      { scopeType: "university", scopeId: universityId },
      ...faculties.map((faculty) => ({ scopeType: "faculty" as const, scopeId: faculty.id })),
      ...departments
        .filter((department) => department.universityId === universityId)
        .map((department) => ({ scopeType: "department" as const, scopeId: department.id }))
    ];
  }

  private async getSourceForAdmin(access: AdminUniversityAccess, id: string): Promise<AnnouncementSourceRecord> {
    const source = await this.announcementRepository.findSourceById(id);
    if (!source) throw new NotFoundException("Announcement source not found.");
    if (access.kind === "global") return source;
    const allowedScopes = new Set(
      (await this.listAnnouncementScopesForUniversity(access.universityId))
        .map((scope) => `${scope.scopeType}\u0000${scope.scopeId}`)
    );
    if (!allowedScopes.has(`${source.scopeType}\u0000${source.scopeId}`)) {
      throw new NotFoundException("Announcement source not found.");
    }
    return source;
  }

  private async resolveManualScope(input: ManualAnnouncementSourceInput): Promise<{ scopeId: string; homepageUrl: string; university: UniversityRecord }> {
    const university = await this.catalogRepository.findUniversityById(input.universityId);
    const universityHomepage = university
      ? university.websiteUrl ?? knownOfficialUniversityUrls(university.id)[0] ?? knownOfficialUniversityUrls(university.slug)[0]
      : undefined;
    if (!university || university.status !== "active" || !universityHomepage) {
      throw new BadRequestException("Selected university has no verified active website.");
    }
    if (input.scopeType === "university") {
      return { scopeId: university.id, homepageUrl: universityHomepage, university };
    }
    const faculty = (await this.catalogRepository.listFaculties(university.id, "active"))
      .find((candidate) => candidate.id === input.facultyId);
    if (!faculty) throw new BadRequestException("Selected faculty does not belong to the university.");
    const facultyHomepage = faculty.websiteUrl && isOfficialContentUrl(faculty.websiteUrl, universityHomepage)
      ? faculty.websiteUrl
      : universityHomepage;
    if (input.scopeType === "faculty") return { scopeId: faculty.id, homepageUrl: facultyHomepage, university };
    const department = (await this.catalogRepository.listDepartments(faculty.id, "active"))
      .find((candidate) => candidate.id === input.departmentId && candidate.universityId === university.id);
    if (!department) throw new BadRequestException("Selected department does not belong to the faculty.");
    const departmentHomepage = department.websiteUrl && isOfficialContentUrl(department.websiteUrl, facultyHomepage)
      ? department.websiteUrl
      : facultyHomepage;
    return { scopeId: department.id, homepageUrl: departmentHomepage, university };
  }

  private retireSourceNotifications(source: AnnouncementSourceRecord): Promise<unknown> {
    return this.notificationSchedulingService?.syncTrustedAnnouncementSource(source, {
      created: [], materiallyUpdated: [], unchanged: [], removed: []
    }) ?? Promise.resolve();
  }
}

export interface ManualAnnouncementSourceInput {
  scopeType: "university" | "faculty" | "department";
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  sourceName: string;
  sourceUrl: string;
  contentType: AnnouncementContentType;
  parser: AnnouncementSourceParser;
  priority: number;
  fetchIntervalMinutes: number;
}

export interface ManualAnnouncementSourceUpdateInput {
  sourceName?: string;
  sourceUrl?: string;
  contentType?: AnnouncementContentType;
  parser?: AnnouncementSourceParser;
  priority?: number;
  fetchIntervalMinutes?: number;
  status?: AnnouncementSourceStatus;
}

function sourceAuthorityResource(contentType?: AnnouncementContentType): SourceAuthorityResource {
  return contentType ?? "announcement";
}

function resolveAuthorityForUniversityRecord(
  university: UniversityRecord,
  scopeType: "university" | "faculty" | "department",
  scopeId: string
): Promise<ResolvedSourceAuthorityContext> {
  return resolveSourceAuthorityContext({
    universityId: university.id,
    ownerAcademicEntityId: scopeId,
    scopeType,
    scopeId
  });
}

function missingSourceOwnerDecision(
  source: Pick<AnnouncementSourceRecord, "scopeType" | "scopeId" | "contentType">,
  url: string,
  boundary: "registration" | "publication"
): SourceAuthorityDecision {
  return evaluateSourceAuthority({
    ownerAcademicEntityId: source.scopeId,
    ownerUniversityId: null,
    resolvedOwnerAcademicEntityId: source.scopeId,
    resolvedOwnerUniversityId: null,
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    authorityDomains: null
  }, {
    boundary,
    resource: sourceAuthorityResource(source.contentType),
    url
  });
}

export async function discoverAnnouncementSourceForUniversity(university: UniversityRecord, input: { timeoutMs?: number } = {}): Promise<AnnouncementDiscoveryResult> {
  const timeoutMs = input.timeoutMs ?? 7000;
  const authority = await resolveAuthorityForUniversityRecord(university, "university", university.id);
  const verifiedSource = await discoverVerifiedAnnouncementSource(university, timeoutMs, authority.context);
  if (verifiedSource) return verifiedSource;
  const homepageCandidates = buildHomepageCandidates(university).slice(0, 16);
  return discoverAnnouncementSourceFromHomepages(university, homepageCandidates, timeoutMs, authority.context, (homepage) => isLikelyUniversityHomepage(homepage.text, homepage.finalUrl, university));
}

export async function discoverAnnouncementSourceForAcademicScope(
  university: UniversityRecord,
  scope: { faculty?: FacultyRecord; department?: DepartmentRecord },
  input: { timeoutMs?: number } = {}
): Promise<AnnouncementDiscoveryResult> {
  const timeoutMs = input.timeoutMs ?? 7000;
  const scopeType = scope.department ? "department" : scope.faculty ? "faculty" : "university";
  const scopeId = scope.department?.id ?? scope.faculty?.id ?? university.id;
  const authority = await resolveAuthorityForUniversityRecord(university, scopeType, scopeId);
  const homepageCandidates = await buildAcademicScopeHomepageCandidates(university, scope, timeoutMs, authority.context);
  return discoverAnnouncementSourceFromHomepages(university, homepageCandidates, timeoutMs, authority.context, (homepage) => isLikelyAcademicScopePage(homepage.text, homepage.finalUrl, university, scope));
}

async function discoverAnnouncementSourceFromHomepages(
  university: UniversityRecord,
  homepageCandidates: string[],
  timeoutMs: number,
  authority: SourceAuthorityContext,
  isLikelyHomepage: (homepage: { text: string; finalUrl: string }) => boolean
): Promise<AnnouncementDiscoveryResult> {
  let checkedHomepageCandidates = 0;
  let lastError = "";
  let bestEmptyHomepage: AnnouncementDiscoveryResult | null = null;

  for (const homepageUrl of homepageCandidates) {
    checkedHomepageCandidates += 1;
    try {
      const homepage = await fetchText(homepageUrl, timeoutMs, { authority, resource: "announcement" });
      if (!isLikelyHomepage(homepage)) continue;

      const homepageItems = parseHtmlAnchors(homepage.text, homepage.finalUrl);
      const sourceCandidates = buildAnnouncementSourceCandidates(homepage.finalUrl, homepage.text).slice(0, 16);
      let checkedSourceCandidates = 0;
      const homepageFallback: { url: string; itemCount: number; sampleTitles: string[] } | null = homepageItems.length > 0
        ? { url: homepage.finalUrl, itemCount: homepageItems.length, sampleTitles: homepageItems.slice(0, 3).map((item) => item.title) }
        : null;
      let best: { url: string; itemCount: number; sampleTitles: string[] } | null = null;

      for (const candidate of sourceCandidates) {
        checkedSourceCandidates += 1;
        try {
          const items = await fetchSourceItems(candidate.url, "auto", timeoutMs, { authority, resource: "announcement" });
          if (items.length > (best?.itemCount ?? 0)) best = { url: candidate.url, itemCount: items.length, sampleTitles: items.slice(0, 3).map((item) => item.title) };
          if (best && best.itemCount >= 5) break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      best ??= homepageFallback;
      if (best && best.itemCount > 0) {
        return {
          universityId: university.id,
          universityName: university.name,
          status: "source_found",
          homepageUrl: homepage.finalUrl,
          sourceUrl: best.url,
          parser: "auto",
          itemCount: best.itemCount,
          checkedHomepageCandidates,
          checkedSourceCandidates,
          sampleTitles: best.sampleTitles
        };
      }

      const emptyResult: AnnouncementDiscoveryResult = {
        universityId: university.id,
        universityName: university.name,
        status: "homepage_found_no_items",
        homepageUrl: homepage.finalUrl,
        itemCount: 0,
        checkedHomepageCandidates,
        checkedSourceCandidates,
        sampleTitles: [],
        ...(lastError ? { error: lastError } : {})
      };
      bestEmptyHomepage ??= emptyResult;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (bestEmptyHomepage) return bestEmptyHomepage;
  return {
    universityId: university.id,
    universityName: university.name,
    status: "homepage_not_found",
    itemCount: 0,
    checkedHomepageCandidates,
    checkedSourceCandidates: 0,
    sampleTitles: [],
    ...(lastError ? { error: lastError } : {})
  };
}

export function buildHomepageCandidates(university: UniversityRecord): string[] {
  const candidates = new Set<string>();
  if (university.websiteUrl) candidates.add(university.websiteUrl);

  for (const domain of knownUniversityDomains[university.slug] ?? []) addDomainCandidates(candidates, domain);

  const tokens = significantNameTokens(university.name);
  const acronym = tokens.map((token) => token[0]).join("");
  const joined = tokens.join("");
  const first = tokens[0];
  const firstTwo = tokens.slice(0, 2).join("");
  const slugWithoutCity = university.slug.replace(/-[a-z]+$/u, "");
  const slugToken = slugWithoutCity.replace(/-universitesi$/u, "").replace(/-/g, "");
  const generatedDomainTokens = [
    first,
    tokens.length >= 2 ? firstTwo : undefined,
    tokens.length >= 2 ? acronym : undefined,
    tokens.length >= 2 ? `${acronym}u` : undefined,
    tokens.length >= 2 ? joined : undefined,
    slugToken
  ];

  for (const domainToken of generatedDomainTokens.filter(Boolean)) {
    addDomainCandidates(candidates, `${domainToken}.edu.tr`);
  }

  return [...candidates];
}

export async function buildAcademicScopeHomepageCandidates(
  university: UniversityRecord,
  scope: { faculty?: FacultyRecord; department?: DepartmentRecord },
  timeoutMs = 7000,
  authorityContext?: SourceAuthorityContext
): Promise<string[]> {
  const scopeType = scope.department ? "department" : scope.faculty ? "faculty" : "university";
  const scopeId = scope.department?.id ?? scope.faculty?.id ?? university.id;
  const authority = authorityContext ?? (await resolveAuthorityForUniversityRecord(university, scopeType, scopeId)).context;
  const candidates = new Set<string>();
  const verifiedScope = await findVerifiedAcademicUnitSource({
    ...(scope.faculty?.id ? { facultyId: scope.faculty.id } : {}),
    ...(scope.department?.id ? { departmentId: scope.department.id } : {})
  });
  addAcademicScopeExplicitUrls(candidates, scope, verifiedScope ?? undefined);
  const scopeTokens = academicScopeTokens(scope);
  if (scopeTokens.length === 0) return buildHomepageCandidates(university).slice(0, 16);

  for (const homepageUrl of buildHomepageCandidates(university).slice(0, 8)) {
    try {
      const homepage = await fetchText(homepageUrl, timeoutMs, { authority, resource: "announcement" });
      if (!isLikelyUniversityHomepage(homepage.text, homepage.finalUrl, university)) continue;
      addScopedPathCandidates(candidates, homepage.finalUrl, scope);
      addScopedSubdomainCandidates(candidates, homepage.finalUrl, scope);

      for (const link of extractAcademicScopeLinks(homepage.text, homepage.finalUrl, scopeTokens)) {
        candidates.add(link);
      }
    } catch {
      continue;
    }
  }

  return [...candidates].slice(0, 28);
}

function addAcademicScopeExplicitUrls(candidates: Set<string>, scope: { faculty?: FacultyRecord; department?: DepartmentRecord }, verifiedScope?: VerifiedAcademicUnitSource): void {
  for (const url of [verifiedScope?.announcementUrl, verifiedScope?.websiteUrl]) {
    if (url) candidates.add(url);
  }
  for (const unit of [scope.department, scope.faculty]) {
    if (!unit) continue;
    for (const url of [unit.announcementUrl, unit.websiteUrl]) {
      if (url) candidates.add(url);
    }
  }
}

async function discoverVerifiedAnnouncementSource(
  university: UniversityRecord,
  timeoutMs: number,
  authority: SourceAuthorityContext
): Promise<AnnouncementDiscoveryResult | null> {
  const verified = await findVerifiedUniversitySource(university.id);
  if (!verified?.announcementUrl) return null;

  try {
    const items = await fetchSourceItems(verified.announcementUrl, "auto", timeoutMs, { authority, resource: "announcement" });
    if (items.length === 0) return null;
    const homepageUrl = homepageFromUrl(verified.announcementUrl);
    return {
      universityId: university.id,
      universityName: university.name,
      status: "source_found",
      ...(homepageUrl ? { homepageUrl } : {}),
      sourceUrl: verified.announcementUrl,
      parser: "auto",
      itemCount: items.length,
      checkedHomepageCandidates: 0,
      checkedSourceCandidates: 1,
      sampleTitles: items.slice(0, 3).map((item) => item.title)
    };
  } catch {
    return null;
  }
}

function homepageFromUrl(input: string): string | undefined {
  try {
    return new URL("/", input).toString();
  } catch {
    return undefined;
  }
}

function verifiedContentSourceDefinitions(source: { announcementUrl?: string; newsUrl?: string; eventUrl?: string }): Array<{ contentType: AnnouncementContentType; label: string; url: string; priority: number }> {
  return [
    source.announcementUrl ? { contentType: "announcement" as const, label: "Duyurular", url: source.announcementUrl, priority: 30 } : null,
    source.newsUrl ? { contentType: "news" as const, label: "Haberler", url: source.newsUrl, priority: 25 } : null,
    source.eventUrl ? { contentType: "event" as const, label: "Etkinlikler", url: source.eventUrl, priority: 24 } : null
  ].filter((definition): definition is { contentType: AnnouncementContentType; label: string; url: string; priority: number } => Boolean(definition));
}

export function isLikelyAcademicScopePage(html: string, finalUrl: string, university: UniversityRecord, scope: { faculty?: FacultyRecord; department?: DepartmentRecord }): boolean {
  const text = foldText(`${finalUrl} ${html.slice(0, 80000)}`);
  const tokens = academicScopeTokens(scope);
  if (tokens.length === 0) return isLikelyUniversityHomepage(html, finalUrl, university);
  const scopeMatches = tokens.some((token) => text.includes(token));
  return scopeMatches || (isLikelyUniversityHomepage(html, finalUrl, university) && tokens.some((token) => foldText(finalUrl).includes(token)));
}

function addScopedPathCandidates(candidates: Set<string>, baseUrl: string, scope: { faculty?: FacultyRecord; department?: DepartmentRecord }): void {
  const slugs = [scope.faculty?.slug, scope.department?.slug].filter((slug): slug is string => Boolean(slug));
  const prefixes = ["", "tr", "birim", "akademik-birimler", "fakulteler", "fakulte", "bolumler", "bolum", "ogrenci"];
  for (const slug of slugs) {
    for (const prefix of prefixes) {
      const path = prefix ? `/${prefix}/${slug}` : `/${slug}`;
      try {
        candidates.add(new URL(path, baseUrl).toString());
      } catch {
        continue;
      }
    }
  }

  if (scope.faculty?.slug && scope.department?.slug) {
    for (const path of [`/${scope.faculty.slug}/${scope.department.slug}`, `/tr/${scope.faculty.slug}/${scope.department.slug}`]) {
      try {
        candidates.add(new URL(path, baseUrl).toString());
      } catch {
        continue;
      }
    }
  }
}

function addScopedSubdomainCandidates(candidates: Set<string>, baseUrl: string, scope: { faculty?: FacultyRecord; department?: DepartmentRecord }): void {
  let domain = "";
  try {
    domain = new URL(baseUrl).hostname.replace(/^www\./u, "");
  } catch {
    return;
  }
  const tokens = [scope.department?.slug, scope.faculty?.slug]
    .flatMap((slug) => slug ? slug.split("-") : [])
    .filter((token) => token.length >= 3 && !unitSlugStopWords.has(token))
    .slice(0, 4);
  for (const token of tokens) {
    candidates.add(`https://${token}.${domain}`);
    candidates.add(`https://www.${token}.${domain}`);
  }

  for (const token of academicUnitSubdomainTokens(scope)) {
    candidates.add(`https://${token}.${domain}`);
    candidates.add(`https://www.${token}.${domain}`);
  }
}

function extractAcademicScopeLinks(html: string, baseUrl: string, scopeTokens: string[]): string[] {
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const links = new Set<string>();
  for (const anchor of anchors) {
    const href = cleanText(anchor[1]);
    const title = cleanText((anchor[2] ?? "").replace(/<[^>]+>/g, " "));
    const text = foldText(`${title} ${href}`);
    if (!href || !scopeTokens.some((token) => text.includes(token))) continue;
    try {
      links.add(new URL(href, baseUrl).toString());
    } catch {
      continue;
    }
  }
  return [...links].slice(0, 16);
}

function academicScopeTokens(scope: { faculty?: FacultyRecord; department?: DepartmentRecord }): string[] {
  const rawValues = [
    scope.department?.slug?.replace(/-/gu, " "),
    scope.department?.name,
    scope.faculty?.slug?.replace(/-/gu, " "),
    scope.faculty?.name
  ].filter((value): value is string => Boolean(value));
  const tokens = new Set<string>();
  for (const value of rawValues) {
    const folded = foldText(value).replace(/[^\p{L}\d]+/gu, " ").replace(/\s+/gu, " ").trim();
    if (folded.length >= 4) tokens.add(folded);
    for (const token of folded.split(" ")) {
      if (token.length >= 4 && !unitSlugStopWords.has(token)) tokens.add(token);
    }
  }
  return [...tokens];
}

function academicUnitSubdomainTokens(scope: { faculty?: FacultyRecord; department?: DepartmentRecord }): string[] {
  const values = [scope.department?.slug, scope.faculty?.slug, scope.department?.name, scope.faculty?.name].filter((value): value is string => Boolean(value));
  const tokens = new Set<string>();
  for (const value of values) {
    const folded = foldText(value).replace(/[^\p{L}\d]+/gu, " ").replace(/\s+/gu, " ").trim();
    const parts = folded.split(" ").filter((part) => part.length >= 2 && !unitSlugStopWords.has(part));
    const first = parts[0];
    if (first && first.length >= 3) {
      if (folded.includes("meslek yuksekokulu")) tokens.add(`${first}myo`);
      if (folded.includes("yuksekokulu")) tokens.add(`${first}yo`);
      if (folded.includes("fakulte")) tokens.add(`${first}f`);
      if (folded.includes("enstitu")) tokens.add(`${first}ens`);
    }
    const acronym = parts.map((part) => part[0]).join("");
    if (acronym.length >= 3) tokens.add(acronym);
  }
  addKnownAcademicUnitAliases(tokens, values.join(" "));
  return [...tokens].slice(0, 10);
}

function addKnownAcademicUnitAliases(tokens: Set<string>, value: string): void {
  const text = foldText(value);
  if (text.includes("iktisadi") && text.includes("idari")) tokens.add("iibf");
  if (text.includes("siyasal")) tokens.add("sbf");
  if (text.includes("tip")) tokens.add("tip");
  if (text.includes("dis hekimligi")) tokens.add("dis");
  if (text.includes("eczacilik")) tokens.add("eczacilik");
  if (text.includes("veteriner")) tokens.add("veteriner");
  if (text.includes("muhendislik")) tokens.add("muhendislik");
  if (text.includes("egitim")) tokens.add("egitim");
  if (text.includes("hukuk")) tokens.add("hukuk");
  if (text.includes("iletisim")) tokens.add("iletisim");
  if (text.includes("ilahiyat")) tokens.add("ilahiyat");
  if (text.includes("guzel sanat")) tokens.add("gsf");
  if (text.includes("saglik bilim")) tokens.add("sbf");
  if (text.includes("fen edebiyat")) tokens.add("fef");
}

function buildAnnouncementSourceCandidates(homepageUrl: string, homepageHtml: string): Array<{ url: string; score: number }> {
  const candidates = new Map<string, number>();
  for (const path of [
    "/duyurular",
    "/duyurular/",
    "/duyuru",
    "/duyuru/",
    "/tr/duyurular",
    "/tr/duyurular/",
    "/tr/duyuru",
    "/icerik/duyurular",
    "/icerik/duyuru",
    "/tr/icerik/duyurular",
    "/web/duyurular",
    "/web/haberler",
    "/announcements",
    "/announcements/",
    "/announcement",
    "/tr/announcements",
    "/category/duyurular/",
    "/category/announcements/",
    "/haberler",
    "/haberler/",
    "/tr/haberler",
    "/news",
    "/news/",
    "/tr/news",
    "/etkinlikler",
    "/etkinlikler/",
    "/tr/etkinlikler",
    "/events",
    "/events/",
    "/tr/events",
    "/notices",
    "/tr-tr/duyurular/Pages/default.aspx"
  ]) {
    addSourceCandidate(candidates, new URL(path, homepageUrl).toString(), 50);
  }

  const anchors = [...homepageHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const anchor of anchors) {
    const href = cleanText(anchor[1]);
    const title = cleanText(anchor[2]?.replace(/<[^>]+>/g, " "));
    if (!href || !containsAnnouncementHint(title, href)) continue;
    try {
      const url = new URL(href, homepageUrl).toString();
      if (looksLikeAnnouncementDetailUrl(url)) continue;
      addSourceCandidate(candidates, url, scoreAnnouncementCandidate(title, url));
    } catch {
      continue;
    }
  }
  addEmbeddedLinkSourceCandidates(candidates, homepageUrl, homepageHtml);

  return [...candidates.entries()].map(([url, score]) => ({ url, score })).sort((left, right) => right.score - left.score);
}

function addEmbeddedLinkSourceCandidates(candidates: Map<string, number>, homepageUrl: string, homepageHtml: string): void {
  const normalized = homepageHtml
    .replace(/\\&q;/g, "\"")
    .replace(/&q;/g, "\"")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/");

  for (const match of normalized.matchAll(/"(?:announcementsLink|newsLink|eventsLink|eventLink|link|href|url)"\s*:\s*"([^"]+)"/gi)) {
    const href = cleanText(match[1]);
    if (!href || !containsAnnouncementHint("", href)) continue;
    try {
      const url = new URL(href, homepageUrl).toString();
      if (looksLikeAnnouncementDetailUrl(url)) continue;
      addSourceCandidate(candidates, url, href.includes("duyuru") || href.includes("announcement") ? 90 : href.includes("etkinlik") || href.includes("event") ? 55 : 40);
    } catch {
      continue;
    }
  }

  for (const match of normalized.matchAll(/(?:href|src)=["']([^"']*(?:duyuru|announcement|haber|news|etkinlik|event)[^"']*)["']/gi)) {
    const href = cleanText(match[1]);
    if (!href) continue;
    try {
      const url = new URL(href, homepageUrl).toString();
      if (looksLikeAnnouncementDetailUrl(url)) continue;
      addSourceCandidate(candidates, url, href.includes(".js") ? 25 : 70);
    } catch {
      continue;
    }
  }
}

function looksLikeAnnouncementDetailUrl(input: string): boolean {
  const url = new URL(input);
  const path = url.pathname.toLocaleLowerCase("tr-TR");
  const segments = path.split("/").filter(Boolean);
  if (url.searchParams.has("announcementId") || url.searchParams.has("announcementdetail")) return true;
  if (/(duyurudetay|duyuru-detay|announcement-detail|haber-detay|news-detail|etkinlik-detay|event-detail)/u.test(path)) return true;
  if (segments.some((segment, index) => ["duyuru", "haber", "etkinlik", "announcement", "news", "event"].includes(segment) && Boolean(segments[index + 1]) && (/^\d{3,}$/u.test(segments[index + 1] ?? "") || Boolean(segments[index + 2])))) return true;
  return segments.some((segment, index) => ["duyuru", "duyurular", "announcement", "announcements", "haber", "haberler", "news", "etkinlik", "etkinlikler", "event", "events"].includes(segment) && (segments[index + 1]?.length ?? 0) > 10);
}

function addSourceCandidate(candidates: Map<string, number>, url: string, score: number): void {
  const normalized = url.replace(/#.*$/u, "");
  candidates.set(normalized, Math.max(candidates.get(normalized) ?? 0, score));
}

function scoreAnnouncementCandidate(title: string, url: string): number {
  const text = `${title} ${url}`.toLocaleLowerCase("tr-TR");
  let score = 20;
  if (text.includes("duyuru")) score += 70;
  if (text.includes("announcement")) score += 60;
  if (text.includes("ilan")) score += 30;
  if (text.includes("haber")) score += 15;
  if (text.includes("news")) score += 15;
  if (text.includes("etkinlik") || text.includes("event")) score += 20;
  if (text.includes("ogrenci") || text.includes("öğrenci")) score += 10;
  return score;
}

export function isLikelyUniversityHomepage(html: string, finalUrl: string, university: UniversityRecord): boolean {
  const foldedHtml = foldText(html.slice(0, 20000));
  const foldedUrl = foldText(finalUrl);
  const tokens = significantNameTokens(university.name).filter((token) => token.length >= 3);
  const matchedTokens = tokens.filter((token) => foldedHtml.includes(token) || foldedUrl.includes(token));
  if (tokens.length <= 1) return matchedTokens.length > 0;
  return matchedTokens.some((token) => token !== tokens[0]);
}

function addDomainCandidates(candidates: Set<string>, domain: string): void {
  const normalized = domain.replace(/^https?:\/\//u, "").replace(/^www\./u, "").replace(/\/.*$/u, "");
  candidates.add(`https://${normalized}`);
  candidates.add(`https://www.${normalized}`);
  candidates.add(`http://${normalized}`);
  candidates.add(`http://www.${normalized}`);
}

function significantNameTokens(name: string): string[] {
  return foldText(name)
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z0-9]+/u)
    .filter((token) => token && !nameStopWords.has(token));
}

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .toLocaleLowerCase("en-US");
}

function summarizeDiscovery(results: AnnouncementDiscoveryResult[]) {
  return {
    checkedUniversities: results.length,
    sourceFound: results.filter((result) => result.status === "source_found").length,
    homepageFoundNoItems: results.filter((result) => result.status === "homepage_found_no_items").length,
    homepageNotFound: results.filter((result) => result.status === "homepage_not_found").length,
    totalParsedItems: results.reduce((total, result) => total + result.itemCount, 0)
  };
}

function summarizeIngestion(results: AnnouncementIngestionResult[]) {
  return {
    checkedSources: results.length,
    healthy: results.filter((result) => result.status === "healthy").length,
    degraded: results.filter((result) => result.status === "degraded").length,
    failed: results.filter((result) => result.status === "failed").length,
    totalParsedItems: results.reduce((total, result) => total + result.itemCount, 0)
  };
}

async function runWithConcurrency<TInput, TOutput>(items: TInput[], concurrency: number, worker: (item: TInput) => Promise<TOutput>): Promise<TOutput[]> {
  const results: TOutput[] = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item);
    }
  }));
  return results;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isSourceDue(source: AnnouncementSourceRecord, now = new Date()): boolean {
  if (source.status !== "active") return false;
  if (!source.lastCheckedAt) return true;
  const intervalMinutes = Math.min(Math.max(source.fetchIntervalMinutes ?? 180, 5), 10_080);
  return now.getTime() - source.lastCheckedAt.getTime() >= intervalMinutes * 60_000;
}

function sourceInputFromRecord(source: AnnouncementSourceRecord) {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = source;
  void _id;
  void _createdAt;
  void _updatedAt;
  return input;
}

function staticSourceIdentityKey(scopeType: AnnouncementSourceScope["scopeType"], scopeId: string, sourceUrl: string): string | null {
  const contentKey = canonicalAnnouncementSourceIdentityKey(sourceUrl);
  return contentKey ? `${scopeType}\u0000${scopeId}\u0000${contentKey}` : null;
}

function parseDailyScheduleTimes(value: string): number[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .map((part) => part.match(/^(\d{1,2}):(\d{2})$/u))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]) * 60 + Number(match[2]))
    .filter((minutes) => minutes >= 0 && minutes < 24 * 60)
    .sort((left, right) => left - right);
}

function millisecondsUntilNextDailyRun(scheduleTimes: number[], now = new Date()): number {
  const turkeyOffsetMs = 3 * 60 * 60 * 1000;
  const turkeyNow = new Date(now.getTime() + turkeyOffsetMs);
  const elapsedTodayMs = ((turkeyNow.getUTCHours() * 60 + turkeyNow.getUTCMinutes()) * 60 + turkeyNow.getUTCSeconds()) * 1000 + turkeyNow.getUTCMilliseconds();
  const todayTargetMs = scheduleTimes.map((minutes) => minutes * 60 * 1000).find((targetMs) => targetMs > elapsedTodayMs);
  return (todayTargetMs ?? scheduleTimes[0]! * 60 * 1000 + 24 * 60 * 60 * 1000) - elapsedTodayMs;
}

const nameStopWords = new Set([
  "universitesi",
  "universite",
  "university",
  "vakif",
  "devlet",
  "turkiye",
  "turk",
  "ve",
  "the"
]);

const unitSlugStopWords = new Set([
  "fakultesi",
  "fakulte",
  "bolumu",
  "bolum",
  "meslek",
  "yuksekokulu",
  "yuksek",
  "okulu",
  "enstitusu",
  "enstitu",
  "bilimleri",
  "bilimler",
  "programi",
  "program"
]);

export function knownOfficialUniversityUrls(universityIdOrSlug: string): string[] {
  return (knownUniversityDomains[universityIdOrSlug] ?? []).map((domain) => `https://${domain}`);
}

const knownUniversityDomains: Record<string, string[]> = {
  "abdullah-gul-universitesi-kayseri": ["agu.edu.tr", "w3.agu.edu.tr"],
  "akdeniz-universitesi-antalya": ["akdeniz.edu.tr"],
  "anadolu-universitesi-eskisehir": ["anadolu.edu.tr"],
  "ankara-universitesi-ankara": ["ankara.edu.tr"],
  "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi": ["atu.edu.tr"],
  "afyon-kocatepe-universitesi-afyonkarahisar": ["aku.edu.tr"],
  "afyonkarahisar-saglik-bilimleri-universitesi": ["afsu.edu.tr"],
  "ankara-haci-bayram-veli-universitesi": ["hacibayram.edu.tr", "hbv.edu.tr"],
  "ankara-muzik-ve-guzel-sanatlar-universitesi": ["mgu.edu.tr"],
  "ankara-sosyal-bilimler-universitesi": ["asbu.edu.tr"],
  "ankara-universitesi": ["ankara.edu.tr"],
  "ankara-yildirim-beyazit-universitesi": ["aybu.edu.tr"],
  "antalya-belek-universitesi": ["belek.edu.tr"],
  "ataturk-universitesi-erzurum": ["atauni.edu.tr"],
  "atasehir-adiguzel-meslek-yuksekokulu-istanbul": ["adiguzel.edu.tr"],
  "aydin-adnan-menderes-universitesi": ["adu.edu.tr"],
  "atilim-universitesi-ankara": ["atilim.edu.tr"],
  "baskent-universitesi-ankara": ["baskent.edu.tr"],
  "bezm-i-lem-vakif-universitesi-istanbul": ["bezmialem.edu.tr"],
  "bilkent-universitesi-ankara": ["bilkent.edu.tr"],
  "bogazici-universitesi-istanbul": ["boun.edu.tr"],
  "bolu-abant-izzet-baysal-universitesi": ["ibu.edu.tr"],
  "burdur-mehmet-akif-ersoy-universitesi": ["mehmetakif.edu.tr"],
  "bursa-teknik-universitesi": ["btu.edu.tr"],
  "bursa-uludag-universitesi": ["uludag.edu.tr"],
  "bursa-uludag-universitesi-bursa": ["uludag.edu.tr"],
  "canakkale-onsekiz-mart-universitesi": ["comu.edu.tr"],
  "cankaya-universitesi-ankara": ["cankaya.edu.tr"],
  "cankiri-karatekin-universitesi": ["karatekin.edu.tr"],
  "cukurova-universitesi-adana": ["cu.edu.tr"],
  "demiroglu-bilim-universitesi-istanbul": ["demiroglu.bilim.edu.tr"],
  "dokuz-eylul-universitesi-izmir": ["deu.edu.tr"],
  "ege-universitesi-izmir": ["ege.edu.tr"],
  "erciyes-universitesi-kayseri": ["erciyes.edu.tr"],
  "erzincan-binali-yildirim-universitesi": ["erzincan.edu.tr"],
  "eskisehir-osmangazi-universitesi": ["ogu.edu.tr"],
  "fenerbahce-universitesi-istanbul": ["fbu.edu.tr"],
  "firat-universitesi-elazig": ["firat.edu.tr"],
  "galatasaray-universitesi-istanbul": ["gsu.edu.tr"],
  "gazi-universitesi-ankara": ["gazi.edu.tr"],
  "gebze-teknik-universitesi": ["gtu.edu.tr"],
  "hacettepe-universitesi-ankara": ["hacettepe.edu.tr"],
  "hatay-mustafa-kemal-universitesi": ["mku.edu.tr"],
  "ihsan-dogramaci-bilkent-universitesi-ankara": ["bilkent.edu.tr"],
  "isik-universitesi-istanbul": ["isikun.edu.tr"],
  "iskenderun-teknik-universitesi-hatay": ["iste.edu.tr"],
  "istanbul-29-mayis-universitesi": ["29mayis.edu.tr"],
  "istanbul-arel-universitesi": ["arel.edu.tr"],
  "istanbul-atlas-universitesi": ["atlas.edu.tr"],
  "istanbul-aydin-universitesi": ["aydin.edu.tr"],
  "istanbul-beykent-universitesi": ["beykent.edu.tr"],
  "istanbul-bilgi-universitesi": ["bilgi.edu.tr"],
  "istanbul-esenyurt-universitesi": ["esenyurt.edu.tr"],
  "istanbul-galata-universitesi": ["galata.edu.tr"],
  "istanbul-gedik-universitesi": ["gedik.edu.tr"],
  "istanbul-gelisim-universitesi": ["gelisim.edu.tr"],
  "istanbul-kent-universitesi": ["kent.edu.tr"],
  "istanbul-kultur-universitesi": ["iku.edu.tr"],
  "istanbul-medeniyet-universitesi": ["medeniyet.edu.tr"],
  "istanbul-medipol-universitesi": ["medipol.edu.tr"],
  "istanbul-nisantasi-universitesi": ["nisantasi.edu.tr"],
  "istanbul-okan-universitesi": ["okan.edu.tr"],
  "istanbul-rumeli-universitesi": ["rumeli.edu.tr"],
  "istanbul-sabahattin-zaim-universitesi": ["izu.edu.tr"],
  "istanbul-saglik-ve-sosyal-bilimler-meslek-yuksekokulu": ["issb.edu.tr", "issbmyo.edu.tr"],
  "istanbul-saglik-ve-teknoloji-universitesi": ["istun.edu.tr"],
  "istanbul-sisli-meslek-yuksekokulu": ["sisli.edu.tr"],
  "istanbul-teknik-universitesi-istanbul": ["itu.edu.tr"],
  "istanbul-teknik-universitesi": ["itu.edu.tr"],
  "istanbul-topkapi-universitesi": ["topkapi.edu.tr"],
  "istanbul-universitesi-cerrahpasa-istanbul": ["iuc.edu.tr"],
  "istanbul-universitesi-cerrahpasa": ["iuc.edu.tr"],
  "istanbul-universitesi-istanbul": ["istanbul.edu.tr"],
  "istanbul-universitesi": ["istanbul.edu.tr"],
  "istanbul-yeni-yuzyil-universitesi": ["yeniyuzyil.edu.tr"],
  "izmir-bakircay-universitesi": ["bakircay.edu.tr"],
  "izmir-demokrasi-universitesi": ["idu.edu.tr"],
  "izmir-kavram-meslek-yuksekokulu": ["kavram.edu.tr"],
  "izmir-tinaztepe-universitesi": ["tinaztepe.edu.tr"],
  "kadir-has-universitesi-istanbul": ["khas.edu.tr"],
  "kahramanmaras-istiklal-universitesi": ["istiklal.edu.tr"],
  "kahramanmaras-sutcu-imam-universitesi": ["ksu.edu.tr"],
  "karadeniz-teknik-universitesi-trabzon": ["ktu.edu.tr"],
  "karamanoglu-mehmetbey-universitesi-karaman": ["kmu.edu.tr"],
  "kirikkale-universitesi": ["kku.edu.tr"],
  "kirsehir-ahi-evran-universitesi": ["ahievran.edu.tr"],
  "kocaeli-saglik-ve-teknoloji-universitesi": ["kocaelisaglik.edu.tr", "kostu.edu.tr"],
  "kocaeli-universitesi": ["kocaeli.edu.tr"],
  "koc-universitesi-istanbul": ["ku.edu.tr"],
  "konya-gida-ve-tarim-universitesi": ["gidatarim.edu.tr"],
  "kto-karatay-universitesi-konya": ["karatay.edu.tr"],
  "kutahya-dumlupinar-universitesi": ["dpu.edu.tr"],
  "kutahya-saglik-bilimleri-universitesi": ["ksbu.edu.tr"],
  "malatya-turgut-ozal-universitesi": ["ozal.edu.tr"],
  "manisa-cel-l-bayar-universitesi": ["mcbu.edu.tr", "cbu.edu.tr"],
  "mardin-artuklu-universitesi": ["artuklu.edu.tr"],
  "marmara-universitesi-istanbul": ["marmara.edu.tr"],
  "mimar-sinan-guzel-sanatlar-universitesi-istanbul": ["msgsu.edu.tr"],
  "mugla-sitki-kocman-universitesi": ["mu.edu.tr"],
  "mus-alparslan-universitesi": ["alparslan.edu.tr"],
  "necmettin-erbakan-universitesi-konya": ["erbakan.edu.tr"],
  "ordu-universitesi": ["odu.edu.tr"],
  "orta-dogu-teknik-universitesi-ankara": ["odtu.edu.tr", "metu.edu.tr"],
  "ostim-teknik-universitesi-ankara": ["ostimteknik.edu.tr"],
  "pamukkale-universitesi-denizli": ["pau.edu.tr"],
  "recep-tayyip-erdogan-universitesi-rize": ["erdogan.edu.tr"],
  "saglik-bilimleri-universitesi-istanbul": ["sbu.edu.tr"],
  "sakarya-uygulamali-bilimler-universitesi": ["subu.edu.tr"],
  "sabanci-universitesi-istanbul": ["sabanciuniv.edu.tr"],
  "selcuk-universitesi-konya": ["selcuk.edu.tr"],
  "sivas-cumhuriyet-universitesi": ["cumhuriyet.edu.tr"],
  "suleyman-demirel-universitesi-isparta": ["sdu.edu.tr"],
  "ted-universitesi-ankara": ["tedu.edu.tr"],
  "tekirdag-namik-kemal-universitesi": ["nku.edu.tr"],
  "tobb-ekonomi-ve-teknoloji-universitesi-ankara": ["etu.edu.tr"],
  "tokat-gaziosmanpasa-universitesi": ["gop.edu.tr"],
  "turk-alman-universitesi-istanbul": ["tau.edu.tr"],
  "turk-hava-kurumu-universitesi-ankara": ["thk.edu.tr"],
  "van-yuzuncu-yil-universitesi": ["yyu.edu.tr"],
  "yalova-universitesi": ["yalova.edu.tr"],
  "yasar-universitesi-izmir": ["yasar.edu.tr"],
  "yildiz-teknik-universitesi-istanbul": ["yildiz.edu.tr"],
  "yozgat-bozok-universitesi": ["bozok.edu.tr"],
  "yuksek-ihtisas-universitesi-ankara": ["yiu.edu.tr"],
  "zonguldak-bulent-ecevit-universitesi": ["beun.edu.tr"]
};
