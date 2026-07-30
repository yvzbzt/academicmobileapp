import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnouncementsController } from "../src/modules/announcements/announcements.controller.js";
import { MyAnnouncementsQueryDto } from "../src/modules/announcements/announcements.dto.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { AnnouncementsService } from "../src/modules/announcements/announcements.service.js";
import { YOK_ANNOUNCEMENT_SCOPE_ID, YOK_ANNOUNCEMENT_SOURCE_URL } from "../src/modules/announcements/announcement-ingestion.service.js";
import type { AnnouncementItem } from "../src/modules/announcements/announcements.types.js";
import type { AuthRepository, AuthUserRecord, AuthenticatedUser } from "../src/modules/auth/auth.types.js";

describe("trusted announcement API contract", () => {
  afterEach(() => vi.restoreAllMocks());

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
      status: "active"
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

    expect(body).toHaveLength(3);
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
    expect(body.find((item) => item.canonicalUrl === "https://ankara.edu.tr/duyuru/duplicate")?.id)
      .toBe("duplicate-newer-update");
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
      status: "active"
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
    const controller = new AnnouncementsController(new AnnouncementsService(createAuthRepository(), repository));
    const body = await controller.getYokAnnouncements(Object.assign(new MyAnnouncementsQueryDto(), { limit: 10 }));

    expect(body).toHaveLength(2);
    expect(body.find((item) => item.id === "yok-trusted")?.publishedAt).toBe("2026-07-29T08:00:00.000Z");
    expect(body.find((item) => item.id === "yok-crawl-only")).not.toHaveProperty("publishedAt");
    expect(JSON.stringify(body)).not.toContain("Sonraki");
  });

  it("reports a failed source even when it has no trusted cached item", async () => {
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
      state: "partial",
      sourceCount: 1,
      failedSourceCount: 1
    });
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
      status: "active"
    });
    await repository.replaceItemsForSource(source, [cachedItem(source, "fresh-cached-item", new Date().toISOString())]);
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
      itemCount: 7
    });
    await repository.replaceItemsForSource(source, [cachedItem(source, "yok-fresh-cached-item", new Date().toISOString())]);
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
      status: "active"
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
      status: "active"
    });
    await repository.replaceItemsForSource(freshSource, [cachedItem(freshSource, "fresh-item", new Date().toISOString())]);
    await repository.replaceItemsForSource(staleSource, [cachedItem(staleSource, "stale-item", "2026-07-01T00:00:00.000Z")]);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/guncel")) {
        return new Response(JSON.stringify([{
          title: "Güncel kaynak duyurusu",
          link: "https://www.ankara.edu.tr/duyuru/guncel",
          publishedAt: "2026-07-30T09:00:00.000Z"
        }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("unavailable", { status: 503 });
    });

    const body = await new AnnouncementsService(createAuthRepository(), repository)
      .getMyAnnouncementsCollection("student-1", 10);

    expect(body).toEqual(expect.objectContaining({ state: "partial", sourceCount: 2, failedSourceCount: 1 }));
    expect(body.items.some((item) => item.id === "stale-item" && item.freshness === "stale")).toBe(true);
  });
});

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

function createAuthRepository(): AuthRepository {
  const now = new Date();
  const user: AuthUserRecord = {
    id: "student-1",
    credentialGeneration: 0,
    fullName: "Student",
    email: "student@ankara.edu.tr",
    passwordHash: "hash",
    role: "student",
    universityId: "ankara-university",
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  return { async findUserById(id: string) { return id === user.id ? user : null; } } as unknown as AuthRepository;
}
