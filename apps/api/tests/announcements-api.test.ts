import { afterEach, describe, expect, it, vi } from "vitest";
import { endpointCatalog } from "../src/contracts/endpoint-catalog.js";
import { AnnouncementsController } from "../src/modules/announcements/announcements.controller.js";
import { MyAnnouncementsQueryDto } from "../src/modules/announcements/announcements.dto.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { AnnouncementsService } from "../src/modules/announcements/announcements.service.js";
import { YOK_ANNOUNCEMENT_SCOPE_ID, YOK_ANNOUNCEMENT_SOURCE_URL } from "../src/modules/announcements/announcement-ingestion.service.js";
import * as announcementParser from "../src/modules/announcements/announcement-parser.js";
import type { AnnouncementItem } from "../src/modules/announcements/announcements.types.js";
import type { AuthRepository, AuthUserRecord, AuthenticatedUser } from "../src/modules/auth/auth.types.js";

describe("trusted announcement API contract", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps pending and rejected review items out of student collections", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "ankara-university",
      sourceName: "Ankara announcements",
      sourceUrl: "https://www.ankara.edu.tr/duyurular/",
      homepageUrl: "https://www.ankara.edu.tr/",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [{
      id: "review-gated-public-item",
      sourceId: source.id,
      sourceName: source.sourceName,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      title: "Kayit duyurusu",
      link: "https://www.ankara.edu.tr/duyurular/review-gated",
      trustStatus: "trusted"
    }]);
    const service = new AnnouncementsService(createAuthRepository(), repository);
    expect(await service.getMyAnnouncements("student-1", 10)).toEqual([]);

    await approveAllReviewItems(repository, source.id);
    expect(await service.getMyAnnouncements("student-1", 10)).toHaveLength(1);

    const approved = await repository.findReviewItemById("review-gated-public-item");
    if (!approved?.item.contentFingerprint) throw new Error("Expected approved item.");
    await repository.updateReviewItem(approved.item.id, { reviewStatus: "rejected" }, {
      expectedContentFingerprint: approved.item.contentFingerprint,
      ...(approved.item.reviewRevision ? { expectedReviewRevision: approved.item.reviewRevision } : {})
    });
    expect(await service.getMyAnnouncements("student-1", 10)).toEqual([]);
  });

  it("returns only trusted normalized content and never exposes crawler time as publication time", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "ankara-university",
      sourceName: "Ankara &amp; Üniversitesi",
      sourceUrl: "https://www.ankara.edu.tr/duyurular/",
      homepageUrl: "https://www.ankara.edu.tr/",
      contentType: "announcement",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    const fetchedAt = new Date().toISOString();
    const base: Omit<AnnouncementItem, "id" | "title" | "link"> = {
      sourceId: source.id,
      sourceName: source.sourceName,
      contentType: "announcement",
      scopeType: "university",
      scopeId: source.scopeId,
      fetchedAt
    };
    await repository.replaceItemsForSource(source, [
      {
        ...base,
        id: "trusted",
        title: "&raquo; Araştırma &amp; Geliştirme Duyurusu",
        rawTitle: "&raquo; Araştırma &amp; Geliştirme Duyurusu",
        link: "https://www.ankara.edu.tr/duyuru/1?utm_source=crawler",
        publishedAt: "2026-07-28T07:00:00.000Z",
        publicationTimeSource: "source",
        sourceUpdatedAt: "2026-07-29T09:00:00.000Z",
        sourceUpdateTimeSource: "source",
        discoveredAt: "2026-07-29T10:00:00.000Z",
        trustStatus: "trusted",
        trustReasonCodes: []
      },
      {
        ...base,
        id: "crawl-only",
        title: "Kayıt yenileme duyurusu",
        link: "https://www.ankara.edu.tr/duyuru/2",
        publishedAt: fetchedAt,
        discoveredAt: fetchedAt
      },
      {
        ...base,
        id: "duplicate-later-publication",
        title: "Yatay geçiş duyurusu",
        link: "https://www.ankara.edu.tr/duyuru/duplicate",
        publishedAt: "2026-07-29T08:00:00.000Z",
        publicationTimeSource: "source",
        sourceUpdatedAt: "2026-07-29T09:00:00.000Z",
        sourceUpdateTimeSource: "source",
        discoveredAt: "2026-07-31T10:00:00.000Z"
      },
      {
        ...base,
        id: "duplicate-newer-update",
        title: "Yatay geçiş duyurusu güncellendi",
        link: "https://ankara.edu.tr/duyuru/duplicate/",
        publishedAt: "2026-07-20T08:00:00.000Z",
        publicationTimeSource: "source",
        sourceUpdatedAt: "2026-07-30T09:00:00.000Z",
        sourceUpdateTimeSource: "source",
        discoveredAt: "2026-07-30T10:00:00.000Z"
      },
      { ...base, id: "navigation", title: "Devamını Oku", link: "https://www.ankara.edu.tr/duyuru/3" },
      { ...base, id: "unsafe", title: "Güvenli görünen duyuru", link: "javascript:alert(1)" },
      { ...base, id: "quarantined", title: "Karantina", link: "https://www.ankara.edu.tr/duyuru/4", trustStatus: "quarantined" }
    ]);
    await approveAllReviewItems(repository, source.id);

    const storedItems = (repository as unknown as { items: Map<string, AnnouncementItem[]> }).items;
    storedItems.set(source.id, [
      ...(storedItems.get(source.id) ?? []),
      { ...base, id: "legacy-no-trust", title: "Eski guven kaydi", link: "https://www.ankara.edu.tr/duyuru/legacy" },
      { ...base, id: "stored-rejected", title: "Reddedilen kayit", link: "https://www.ankara.edu.tr/duyuru/rejected", trustStatus: "rejected" },
      { ...base, id: "stored-quarantined", title: "Karantina kaydi", link: "https://www.ankara.edu.tr/duyuru/quarantined", trustStatus: "quarantined" }
    ]);
    storedItems.set("missing-source", [{
      ...base,
      id: "missing-source",
      sourceId: "missing-source",
      title: "Kaynaksiz kayit",
      link: "https://www.ankara.edu.tr/duyuru/missing-source",
      trustStatus: "trusted"
    }]);

    const controller = new AnnouncementsController(new AnnouncementsService(createAuthRepository(), repository));
    const query = Object.assign(new MyAnnouncementsQueryDto(), { limit: 10 });
    const body = await controller.getMyAnnouncements({ id: "student-1", role: "student" } as AuthenticatedUser, query);

    expect(body).toHaveLength(4);
    expect(body.at(-1)?.id).toBe("crawl-only");
    expect(body.find((item) => item.id === "trusted")).toEqual(expect.objectContaining({
      sourceName: "Ankara & Üniversitesi",
      title: "Araştırma & Geliştirme Duyurusu",
      canonicalUrl: "https://www.ankara.edu.tr/duyuru/1",
      publishedAt: "2026-07-28T07:00:00.000Z",
      sourceUpdatedAt: "2026-07-29T09:00:00.000Z",
      discoveredAt: "2026-07-29T10:00:00.000Z",
      fetchedAt
    }));
    expect(body.find((item) => item.id === "crawl-only")).not.toHaveProperty("publishedAt");
    expect(body.filter((item) => item.canonicalUrl.includes("/duyuru/duplicate")).map((item) => item.id))
      .toEqual(expect.arrayContaining(["duplicate-later-publication", "duplicate-newer-update"]));
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("rawTitle");
    expect(serialized).not.toContain("trustStatus");
    expect(serialized).not.toContain("trustReasonCodes");
    expect(serialized).not.toContain("Devamını Oku");
    expect(serialized).not.toContain("javascript:");
    expect(serialized).not.toContain("legacy-no-trust");
    expect(serialized).not.toContain("missing-source");
    expect(serialized).not.toContain("stored-rejected");
    expect(serialized).not.toContain("stored-quarantined");

    const collection = await controller.getMyTrustedAnnouncementCollection(
      { id: "student-1", role: "student" } as AuthenticatedUser,
      query
    );
    expect(collection).toEqual(expect.objectContaining({ state: "fresh", sourceCount: 1, failedSourceCount: 0 }));
    expect(collection.items).toEqual(body);
  });

  it("resolves an exact trusted item outside the collection limit and fails closed across scope and trust boundaries", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "ankara-university",
      sourceName: "Ankara Universitesi",
      sourceUrl: "https://www.ankara.edu.tr/duyurular/tum-duyurular",
      homepageUrl: "https://www.ankara.edu.tr/",
      contentType: "announcement",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    const fetchedAt = new Date().toISOString();
    await repository.replaceItemsForSource(source, Array.from({ length: 130 }, (_, index) => ({
      id: index === 125 ? "exact-target" : `announcement-${index}`,
      sourceId: source.id,
      sourceName: source.sourceName,
      contentType: "announcement" as const,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      title: index === 125 ? "&raquo; Kesin hedef duyurusu" : `Duyuru ${index}`,
      rawTitle: index === 125 ? "&raquo; Kesin hedef duyurusu" : `Duyuru ${index}`,
      link: `${source.sourceUrl}/${index}?utm_source=notification`,
      fetchedAt
    })));
    await approveAllReviewItems(repository, source.id);

    const otherFacultySource = await repository.upsertSource({
      scopeType: "faculty",
      scopeId: "other-faculty",
      sourceName: "Diger Fakultenin Duyurulari",
      sourceUrl: "https://www.ankara.edu.tr/duyurular/diger-fakulte",
      homepageUrl: "https://www.ankara.edu.tr/",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(otherFacultySource, [{
      id: "out-of-scope",
      sourceId: otherFacultySource.id,
      sourceName: otherFacultySource.sourceName,
      contentType: "announcement",
      scopeType: otherFacultySource.scopeType,
      scopeId: otherFacultySource.scopeId,
      title: "Diger fakultenin duyurusu",
      link: `${otherFacultySource.sourceUrl}/1`,
      fetchedAt
    }]);
    await approveAllReviewItems(repository, otherFacultySource.id);

    const storedItems = (repository as unknown as { items: Map<string, AnnouncementItem[]> }).items;
    storedItems.set(source.id, [
      ...(storedItems.get(source.id) ?? []),
      {
        id: "untrusted-item",
        sourceId: source.id,
        sourceName: source.sourceName,
        contentType: "announcement",
        scopeType: source.scopeType,
        scopeId: source.scopeId,
        title: "Guvenilmez kayit",
        link: `${source.sourceUrl}/untrusted`,
        fetchedAt,
        trustStatus: "quarantined"
      }
    ]);
    const controller = new AnnouncementsController(new AnnouncementsService(
      createAuthRepository({ facultyId: "engineering-faculty", departmentId: "computer-engineering" }),
      repository
    ));
    const user = { id: "student-1", role: "student" } as AuthenticatedUser;
    const collection = await controller.getMyTrustedAnnouncementCollection(
      user,
      Object.assign(new MyAnnouncementsQueryDto(), { limit: 100 })
    );
    expect(collection.items).toHaveLength(100);
    expect(collection.items.some((item) => item.id === "exact-target")).toBe(false);

    const exact = await controller.getMyTrustedAnnouncement(user, "exact-target");
    expect(exact).toEqual(expect.objectContaining({
      id: "exact-target",
      title: "Kesin hedef duyurusu",
      canonicalUrl: `${source.sourceUrl}/125`
    }));
    expect(JSON.stringify(exact)).not.toContain("rawTitle");
    expect(JSON.stringify(exact)).not.toContain("trustStatus");

    const hiddenResponse = {
      response: {
        message: "Trusted announcement not found.",
        error: "Not Found",
        statusCode: 404
      },
      status: 404
    };
    await expect(controller.getMyTrustedAnnouncement(user, "missing"))
      .rejects.toMatchObject(hiddenResponse);
    await expect(controller.getMyTrustedAnnouncement(user, "out-of-scope"))
      .rejects.toMatchObject(hiddenResponse);
    await expect(controller.getMyTrustedAnnouncement(user, "untrusted-item"))
      .rejects.toMatchObject(hiddenResponse);

    expect(endpointCatalog).toContainEqual({
      method: "GET",
      path: "/announcements/my/trusted/:announcementId",
      authRequired: true,
      roles: ["student"],
      rateLimit: "standard"
    });
  });

  it("applies the same trust and timestamp boundary to the public YÖK API", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: YOK_ANNOUNCEMENT_SCOPE_ID,
      sourceName: "YÖK Duyuruları",
      sourceUrl: YOK_ANNOUNCEMENT_SOURCE_URL,
      homepageUrl: "https://www.yok.gov.tr/tr",
      contentType: "announcement",
      parser: "auto",
      priority: 100,
      status: "active",
      trustStatus: "trusted"
    });
    const fetchedAt = new Date().toISOString();
    await repository.replaceItemsForSource(source, [
      {
        id: "yok-trusted",
        sourceId: source.id,
        sourceName: source.sourceName,
        scopeType: "university",
        scopeId: source.scopeId,
        title: "Yükseköğretim Kurulu duyurusu",
        link: "https://www.yok.gov.tr/tr/duyuru/1",
        publishedAt: "2026-07-29T08:00:00.000Z",
        publicationTimeSource: "source",
        fetchedAt
      },
      {
        id: "yok-navigation",
        sourceId: source.id,
        sourceName: source.sourceName,
        scopeType: "university",
        scopeId: source.scopeId,
        title: "Sonraki",
        link: "https://www.yok.gov.tr/tr/duyuru/2",
        fetchedAt
      },
      {
        id: "yok-crawl-only",
        sourceId: source.id,
        sourceName: source.sourceName,
        scopeType: "university",
        scopeId: source.scopeId,
        title: "Kurul toplantısı duyurusu",
        link: "https://www.yok.gov.tr/tr/duyuru/3",
        publishedAt: fetchedAt,
        fetchedAt
      }
    ]);
    await approveAllReviewItems(repository, source.id);
    const controller = new AnnouncementsController(new AnnouncementsService(createAuthRepository(), repository));
    const body = await controller.getYokAnnouncements(Object.assign(new MyAnnouncementsQueryDto(), { limit: 10 }));

    expect(body).toHaveLength(2);
    expect(body.find((item) => item.id === "yok-trusted")?.publishedAt).toBe("2026-07-29T08:00:00.000Z");
    expect(body.find((item) => item.id === "yok-crawl-only")).not.toHaveProperty("publishedAt");
    expect(JSON.stringify(body)).not.toContain("Sonraki");
  });

  it("returns immediately without probing an uncached source", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unavailable", { status: 503 }));
    const controller = new AnnouncementsController(new AnnouncementsService(
      createAuthRepository(),
      new InMemoryAnnouncementRepository()
    ));

    const body = await controller.getYokTrustedAnnouncementCollection(
      Object.assign(new MyAnnouncementsQueryDto(), { limit: 10 })
    );

    expect(body).toEqual({
      items: [],
      state: "fresh",
      sourceCount: 0,
      failedSourceCount: 0
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("reports persisted unhealthy source state even while trusted cache entries remain fresh", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "ankara-university",
      sourceName: "Ankara kesintili kaynak",
      sourceUrl: "https://www.ankara.edu.tr/duyurular/kesintili",
      homepageUrl: "https://www.ankara.edu.tr/",
      contentType: "announcement",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [cachedItem(source, "fresh-cached-item", new Date().toISOString())]);
    await approveAllReviewItems(repository, source.id);
    await repository.recordSourceCheck(source.id, {
      healthStatus: "degraded",
      lastCheckedAt: new Date(),
      lastError: "SOURCE_FETCH_FAILED:503",
      consecutiveFailures: 0,
      itemCount: 1
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const body = await new AnnouncementsService(createAuthRepository(), repository)
      .getMyAnnouncementsCollection("student-1", 10);

    expect(body).toEqual(expect.objectContaining({ state: "partial", sourceCount: 1, failedSourceCount: 1 }));
    expect(body.items).toEqual([expect.objectContaining({ id: "fresh-cached-item", freshness: "fresh" })]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns an empty collection without starting source discovery in the read request", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const findUniversityById = vi.fn(async () => {
      throw new Error("source discovery must not run during a trusted collection read");
    });
    const service = new AnnouncementsService(
      createAuthRepository(),
      repository,
      { findUniversityById } as never
    );

    await expect(service.getMyAnnouncementsCollection("student-1", 20)).resolves.toEqual({
      items: [],
      state: "fresh",
      sourceCount: 0,
      failedSourceCount: 0
    });
    expect(findUniversityById).not.toHaveBeenCalled();
  });

  it("does not reset persisted YÖK source health during public collection reads", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: YOK_ANNOUNCEMENT_SCOPE_ID,
      sourceName: "YÖK Duyuruları",
      sourceUrl: YOK_ANNOUNCEMENT_SOURCE_URL,
      homepageUrl: "https://www.yok.gov.tr/tr",
      contentType: "announcement",
      parser: "auto",
      priority: 100,
      status: "active",
      discoveryMethod: "manual",
      healthStatus: "failed",
      consecutiveFailures: 0,
      itemCount: 7,
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [cachedItem(source, "yok-fresh-cached-item", new Date().toISOString())]);
    await approveAllReviewItems(repository, source.id);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const body = await new AnnouncementsService(createAuthRepository(), repository)
      .getYokAnnouncementsCollection(10);
    const persisted = (await repository.listAllSources({ status: "active", limit: 100 }))
      .find((candidate) => candidate.id === source.id);

    expect(body).toEqual(expect.objectContaining({ state: "partial", sourceCount: 1, failedSourceCount: 1 }));
    expect(body.items).toEqual([expect.objectContaining({ id: "yok-fresh-cached-item", freshness: "fresh" })]);
    expect(persisted).toEqual(expect.objectContaining({ healthStatus: "failed", consecutiveFailures: 0, itemCount: 7 }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("evaluates cache freshness for every selected source", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const freshSource = await repository.upsertSource({
      scopeType: "university",
      scopeId: "ankara-university",
      sourceName: "Ankara güncel kaynak",
      sourceUrl: "https://www.ankara.edu.tr/duyurular/guncel",
      homepageUrl: "https://www.ankara.edu.tr/",
      contentType: "announcement",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    const staleSource = await repository.upsertSource({
      scopeType: "university",
      scopeId: "ankara-university",
      sourceName: "Ankara eski kaynak",
      sourceUrl: "https://www.ankara.edu.tr/duyurular/eski",
      homepageUrl: "https://www.ankara.edu.tr/",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(freshSource, [cachedItem(freshSource, "fresh-item", new Date().toISOString())]);
    await repository.replaceItemsForSource(staleSource, [cachedItem(staleSource, "stale-item", "2026-07-01T00:00:00.000Z")]);
    await approveAllReviewItems(repository, freshSource.id);
    await approveAllReviewItems(repository, staleSource.id);
    vi.spyOn(announcementParser, "fetchSourceItems").mockImplementation(async (url) => {
      if (url.includes("/guncel")) {
        return [{
          title: "Güncel kaynak duyurusu",
          link: "https://www.ankara.edu.tr/duyuru/guncel",
          publicationKind: "timestamp",
          publishedAt: new Date("2026-07-30T09:00:00.000Z")
        }];
      }
      throw new Error("SOURCE_FETCH_FAILED:503");
    });

    const body = await new AnnouncementsService(createAuthRepository(), repository)
      .getMyAnnouncementsCollection("student-1", 10);

    expect(body).toEqual(expect.objectContaining({ state: "partial", sourceCount: 2, failedSourceCount: 0 }));
    expect(body.items.some((item) => item.id === "fresh-item" && item.freshness !== "stale")).toBe(true);
    expect(body.items.some((item) => item.id === "stale-item" && item.freshness === "stale")).toBe(true);
  });
});

describe("mobile academic content source manifest", () => {
  it("returns only fresh trusted recipes for the student's selected and followed scopes", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const now = new Date("2026-09-14T12:00:00.000Z");
    const primary = await repository.upsertSource({
      scopeType: "university",
      scopeId: "ankara-university",
      sourceName: "Ankara announcements",
      sourceUrl: "https://www.ankara.edu.tr/duyurular/",
      homepageUrl: "https://www.ankara.edu.tr/",
      contentType: "announcement",
      parser: "html",
      parserConfig: { itemSelector: "article", titleSelector: "h2", linkSelector: "a" },
      priority: 20,
      status: "active",
      trustStatus: "trusted",
      healthStatus: "healthy",
      lastSuccessAt: new Date("2026-09-14T11:00:00.000Z"),
      contentHash: "a".repeat(64)
    });
    const followed = await repository.upsertSource({
      scopeType: "faculty",
      scopeId: "followed-faculty",
      ownerUniversityId: "gazi-university",
      sourceName: "Followed faculty news",
      sourceUrl: "https://muhendislik.gazi.edu.tr/haberler",
      homepageUrl: "https://muhendislik.gazi.edu.tr/",
      contentType: "news",
      parser: "rss",
      priority: 10,
      status: "active",
      trustStatus: "trusted",
      healthStatus: "healthy",
      lastSuccessAt: new Date("2026-09-14T10:30:00.000Z"),
      contentHash: "b".repeat(64)
    });
    await repository.upsertSource({
      scopeType: "university",
      scopeId: "ankara-university",
      sourceName: "Failed source",
      sourceUrl: "https://www.ankara.edu.tr/haberler/bozuk",
      homepageUrl: "https://www.ankara.edu.tr/",
      contentType: "news",
      parser: "auto",
      priority: 5,
      status: "active",
      trustStatus: "trusted",
      healthStatus: "failed",
      lastSuccessAt: new Date("2026-09-14T10:00:00.000Z"),
      lastError: "SOURCE_FETCH_FAILED"
    });
    await repository.upsertSource({
      scopeType: "university",
      scopeId: "ankara-university",
      sourceName: "Expired source",
      sourceUrl: "https://www.ankara.edu.tr/etkinlikler/eski",
      homepageUrl: "https://www.ankara.edu.tr/",
      contentType: "event",
      parser: "auto",
      priority: 4,
      status: "active",
      trustStatus: "trusted",
      healthStatus: "healthy",
      lastSuccessAt: new Date("2026-09-12T00:00:00.000Z")
    });
    await repository.upsertSource({
      scopeType: "university",
      scopeId: "unfollowed-university",
      sourceName: "Out of scope source",
      sourceUrl: "https://www.itu.edu.tr/duyurular",
      homepageUrl: "https://www.itu.edu.tr/",
      contentType: "announcement",
      parser: "auto",
      priority: 3,
      status: "active",
      trustStatus: "trusted",
      healthStatus: "healthy",
      lastSuccessAt: new Date("2026-09-14T11:00:00.000Z")
    });
    const follows = {
      async listFollowedAcademicScopesByUserId() {
        return [{ universityId: "gazi-university", facultyId: "followed-faculty" }];
      }
    };
    const service = new AnnouncementsService(
      createAuthRepository(),
      repository,
      undefined,
      undefined,
      undefined,
      follows as never
    );

    const manifest = await service.getMySourceManifest("student-1", undefined, now);

    expect(manifest).toEqual(expect.objectContaining({
      schemaVersion: 1,
      refreshRequired: true,
      generatedAt: now.toISOString(),
      sources: [
        expect.objectContaining({
          id: followed.id,
          sourceUrl: "https://muhendislik.gazi.edu.tr/haberler",
          allowedHostname: "muhendislik.gazi.edu.tr",
          contentType: "news",
          scopeType: "faculty",
          scopeId: "followed-faculty",
          parser: "rss"
        }),
        expect.objectContaining({
          id: primary.id,
          sourceUrl: "https://www.ankara.edu.tr/duyurular",
          allowedHostname: "www.ankara.edu.tr",
          parserConfig: { itemSelector: "article", titleSelector: "h2", linkSelector: "a" }
        })
      ]
    }));
    expect(manifest.version).toMatch(/^[a-f\d]{64}$/u);
    expect(manifest.sources.every((source) => source.validUntil > now.toISOString())).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain("SOURCE_FETCH_FAILED");
    expect(JSON.stringify(manifest)).not.toContain("contentHash");
    expect(JSON.stringify(manifest)).not.toContain("verificationEvidence");

    const unchanged = await service.getMySourceManifest("student-1", manifest.version, now);
    expect(unchanged.refreshRequired).toBe(false);
    expect(unchanged.sources).toHaveLength(2);

    await repository.recordSourceCheck(primary.id, {
      healthStatus: "healthy",
      lastCheckedAt: now,
      lastSuccessAt: now,
      contentHash: "c".repeat(64)
    });
    const changed = await service.getMySourceManifest("student-1", manifest.version, now);
    expect(changed.refreshRequired).toBe(true);
    expect(changed.version).not.toBe(manifest.version);

    expect(endpointCatalog).toContainEqual({
      method: "GET",
      path: "/announcements/my/source-manifest",
      authRequired: true,
      roles: ["student"],
      rateLimit: "standard"
    });
  });

  it("prefers a successful daily probe over legacy ingestion health and fails closed after a probe failure", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const now = new Date("2026-09-14T12:00:00.000Z");
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "ankara-university",
      sourceName: "Ankara events",
      sourceUrl: "https://www.ankara.edu.tr/etkinlikler/",
      homepageUrl: "https://www.ankara.edu.tr/",
      contentType: "event",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted",
      healthStatus: "failed",
      lastSuccessAt: new Date("2026-09-01T00:00:00.000Z"),
      contentHash: "a".repeat(64)
    });
    await repository.recordSourceHealthProbe(source.id, {
      healthStatus: "healthy",
      lastCheckedAt: new Date("2026-09-14T11:00:00.000Z"),
      lastSuccessAt: new Date("2026-09-14T11:00:00.000Z"),
      consecutiveFailures: 0,
      itemCount: 2,
      contentHash: "b".repeat(64),
      lastContentChangedAt: new Date("2026-09-14T11:00:00.000Z")
    }, source);
    const service = new AnnouncementsService(createAuthRepository(), repository);

    const healthy = await service.getMySourceManifest("student-1", undefined, now);
    expect(healthy.sources).toEqual([expect.objectContaining({ id: source.id, contentType: "event" })]);
    const probed = await repository.findSourceById(source.id);
    await repository.recordSourceHealthProbe(source.id, {
      ...probed!.healthProbe!,
      healthStatus: "degraded",
      lastCheckedAt: now,
      lastError: "SOURCE_FETCH_FAILED",
      consecutiveFailures: 1
    }, probed!);

    const failed = await service.getMySourceManifest("student-1", healthy.version, now);
    expect(failed.sources).toEqual([]);
    expect(failed.refreshRequired).toBe(true);
    expect(failed.version).not.toBe(healthy.version);
  });
});

async function approveAllReviewItems(repository: InMemoryAnnouncementRepository, sourceId: string) {
  for (const item of await repository.listReviewItems({ sourceIds: [sourceId] })) {
    if (!item.contentFingerprint) throw new Error("Expected content fingerprint.");
    await repository.updateReviewItem(item.id, { reviewStatus: "approved" }, {
      expectedContentFingerprint: item.contentFingerprint,
      ...(item.reviewRevision ? { expectedReviewRevision: item.reviewRevision } : {})
    });
  }
}

function cachedItem(
  source: Awaited<ReturnType<InMemoryAnnouncementRepository["upsertSource"]>>,
  id: string,
  fetchedAt: string
): AnnouncementItem {
  return {
    id,
    sourceId: source.id,
    sourceName: source.sourceName,
    contentType: "announcement",
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    title: `${source.sourceName} içerik kaydı`,
    link: `${source.sourceUrl}/${id}`,
    fetchedAt
  };
}

function createAuthRepository(
  overrides: Partial<Pick<AuthUserRecord, "universityId" | "facultyId" | "departmentId">> = {}
): AuthRepository {
  const now = new Date();
  const user: AuthUserRecord = {
    id: "student-1",
    credentialGeneration: 0,
    fullName: "Student",
    email: "student@ankara.edu.tr",
    passwordHash: "hash",
    role: "student",
    universityId: "ankara-university",
    ...overrides,
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  return { async findUserById(id: string) { return id === user.id ? user : null; } } as unknown as AuthRepository;
}
