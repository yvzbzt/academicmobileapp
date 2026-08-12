import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthRepository, AuthUserRecord } from "../src/modules/auth/auth.types.js";
import { academicContentLogicalIdentityKey } from "../src/modules/announcements/announcement-content-trust.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { AnnouncementsService } from "../src/modules/announcements/announcements.service.js";
import type { AnnouncementContentType, AnnouncementItem, AnnouncementPersistenceDelta, AnnouncementSourceRecord } from "../src/modules/announcements/announcements.types.js";
import * as announcementParser from "../src/modules/announcements/announcement-parser.js";

describe("announcement logical content identity", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps source and scope identity separate while preserving exact detail provenance", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const universityA = await createSource(repository, "university", "university-1", "a", "announcement");
    const universityB = await createSource(repository, "university", "university-1", "b", "announcement");
    const faculty = await createSource(repository, "faculty", "faculty-1", "faculty", "announcement");
    const event = await createSource(repository, "university", "university-1", "event", "event");
    const fetchedAt = new Date().toISOString();

    await repository.replaceItemsForSource(universityA, [content(universityA, "university-a", "bir", fetchedAt)]);
    await repository.replaceItemsForSource(universityB, [content(universityB, "university-b", "iki", fetchedAt)]);
    await repository.replaceItemsForSource(faculty, [content(faculty, "faculty-item", "uc", fetchedAt)]);
    await repository.replaceItemsForSource(event, [content(event, "event-item", "event", fetchedAt)]);

    const service = new AnnouncementsService(authRepository(), repository);
    const collection = await service.getMyAnnouncements("student-1", 20);
    expect(collection).toHaveLength(4);

    const logicalUniversityA = collection.find((item) => item.sourceId === universityA.id);
    const logicalUniversityB = collection.find((item) => item.sourceId === universityB.id);
    expect(logicalUniversityA?.canonicalUrlAliases).toEqual(["https://www.example.edu.tr/duyuru/bir"]);
    expect(logicalUniversityB?.canonicalUrlAliases).toEqual(["https://www.example.edu.tr/duyuru/iki"]);
    expect(logicalUniversityA?.sourceRelationships).toEqual([
      expect.objectContaining({ sourceId: universityA.id, scopeType: "university", scopeId: "university-1" })
    ]);
    expect(logicalUniversityB?.sourceRelationships).toEqual([
      expect.objectContaining({ sourceId: universityB.id, scopeType: "university", scopeId: "university-1" })
    ]);
    expect(logicalUniversityA?.contentFingerprint).toBe(logicalUniversityB?.contentFingerprint);

    const facultyLogical = collection.find((item) => item.scopeType === "faculty");
    expect(facultyLogical?.contentFingerprint).toBe(logicalUniversityA?.contentFingerprint);
    expect(facultyLogical?.sourceRelationships).toHaveLength(1);
    expect(collection.find((item) => item.contentType === "event")?.contentFingerprint)
      .not.toBe(logicalUniversityA?.contentFingerprint);

    const detail = await service.getMyTrustedAnnouncement("student-1", "university-b");
    expect(detail.id).toBe("university-b");
    expect(detail.contentFingerprint).toBe(logicalUniversityB?.contentFingerprint);
    expect(detail.canonicalUrlAliases).toEqual(["https://www.example.edu.tr/duyuru/iki"]);
    expect(detail.sourceRelationships).toEqual([
      expect.objectContaining({ sourceId: universityB.id, scopeType: "university", scopeId: "university-1" })
    ]);
  });

  it("uses a collision-safe source/scope fingerprint identity with canonical legacy fallback", () => {
    const fingerprint = "a".repeat(64);
    const otherFingerprint = "b".repeat(64);
    const base = {
      sourceId: "source-1",
      scopeType: "university" as const,
      scopeId: "university-1",
      canonicalUrl: "https://www.example.edu.tr/duyuru/kayit?utm_source=feed"
    };
    const logical = academicContentLogicalIdentityKey({ ...base, contentFingerprint: fingerprint });

    expect(logical).toBe(academicContentLogicalIdentityKey({
      ...base,
      canonicalUrl: "https://example.edu.tr/duyuru/another-location",
      contentFingerprint: fingerprint
    }));
    expect(logical).not.toBe(academicContentLogicalIdentityKey({
      ...base,
      sourceId: "source-2",
      contentFingerprint: fingerprint
    }));
    expect(logical).not.toBe(academicContentLogicalIdentityKey({
      ...base,
      scopeType: "faculty",
      scopeId: "faculty-1",
      contentFingerprint: fingerprint
    }));
    expect(logical).not.toBe(academicContentLogicalIdentityKey({
      ...base,
      contentFingerprint: otherFingerprint
    }));

    const legacy = academicContentLogicalIdentityKey(base);
    expect(legacy).toBe(academicContentLogicalIdentityKey({
      ...base,
      canonicalUrl: "https://example.edu.tr/duyuru/kayit#content",
      contentFingerprint: "malformed"
    }));
    expect(legacy).not.toBe(academicContentLogicalIdentityKey({
      ...base,
      sourceId: 'source-1","university","university-1',
      scopeId: "scope",
      canonicalUrl: "https://example.edu.tr/duyuru/kayit"
    }));
    expect(academicContentLogicalIdentityKey({
      ...base,
      sourceId: "source-1\u0000university",
      contentFingerprint: fingerprint
    })).toBeNull();
  });

  it("returns the stable persisted refresh ID used by detail and notification delta after an alias update", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await createSource(repository, "university", "university-1", "refresh", "announcement");
    const staleFetchedAt = "2026-07-01T00:00:00.000Z";
    const created = await repository.replaceItemsForSource(source, [content(source, "stable-real-id", "old-url", staleFetchedAt)]);
    await repository.acknowledgeNotificationProduction(created.created);
    await repository.replaceItemsForSource(source, [content(source, "transient-alias-id", "current-url", staleFetchedAt)]);

    vi.spyOn(announcementParser, "fetchSourceItems").mockResolvedValue([{
      title: "Ortak öğrenci kayıt duyurusu",
      summary: "Başvurular çevrim içi ve danışman onayıyla alınacaktır.",
      link: "https://www.example.edu.tr/duyuru/current-url",
      publicationKind: "date",
      publishedDate: "2026-08-04"
    }]);
    const syncTrustedAnnouncementSource = vi.fn(async (..._args: unknown[]) => undefined);
    const service = new AnnouncementsService(
      authRepository(),
      repository,
      undefined,
      undefined,
      { syncTrustedAnnouncementSource } as never
    );

    const response = await service.getMyAnnouncementsCollection("student-1", 20);
    expect(response.items[0]).toEqual(expect.objectContaining({
      id: "stable-real-id",
      canonicalUrl: "https://www.example.edu.tr/duyuru/current-url",
      canonicalUrlAliases: [
        "https://www.example.edu.tr/duyuru/current-url",
        "https://www.example.edu.tr/duyuru/old-url"
      ]
    }));
    expect(syncTrustedAnnouncementSource).not.toHaveBeenCalled();
    expect((await service.getMyTrustedAnnouncement("student-1", "stable-real-id")).id).toBe("stable-real-id");
  });

  it("resolves an exact YOK notification destination without widening to another university", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const yok = await createSource(
      repository,
      "university",
      "yok-council-of-higher-education",
      "yok-global",
      "announcement",
      "https://www.yok.gov.tr"
    );
    const other = await createSource(repository, "university", "university-2", "other", "announcement");
    await repository.replaceItemsForSource(yok, [{
      ...content(yok, "yok-real-id", "yok-item", new Date().toISOString()),
      link: "https://www.yok.gov.tr/duyurular/yok-item"
    }]);
    await repository.replaceItemsForSource(other, [content(other, "other-university-id", "other-item", new Date().toISOString())]);
    const service = new AnnouncementsService(authRepository(), repository);

    await expect(service.getMyTrustedAnnouncement("student-1", "yok-real-id"))
      .resolves.toEqual(expect.objectContaining({ id: "yok-real-id", scopeId: "yok-council-of-higher-education" }));
    await expect(service.getMyTrustedAnnouncement("student-1", "other-university-id"))
      .rejects.toThrow("Trusted announcement not found.");
  });

  it("removes a successfully empty structured source from feed/detail and forwards its removed real ID", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await createSource(repository, "university", "university-1", "empty", "announcement");
    const created = await repository.replaceItemsForSource(source, [content(source, "persisted-empty-id", "old", "2026-07-01T00:00:00.000Z")]);
    await repository.acknowledgeNotificationProduction(created.created);
    const emptySnapshot = announcementParser.parseFetchedSourceItems("[]", source.sourceUrl, "auto");
    expect(emptySnapshot).toEqual([]);
    vi.spyOn(announcementParser, "fetchSourceItems").mockResolvedValue(emptySnapshot);
    const syncTrustedAnnouncementSource = vi.fn(async (..._args: unknown[]) => undefined);
    const service = new AnnouncementsService(authRepository(), repository, undefined, undefined, { syncTrustedAnnouncementSource } as never);

    const response = await service.getMyAnnouncementsCollection("student-1", 20);
    const delta = syncTrustedAnnouncementSource.mock.calls[0]?.[1] as AnnouncementPersistenceDelta | undefined;
    expect(response.items).toEqual([expect.objectContaining({ id: "persisted-empty-id", freshness: "stale" })]);
    expect(delta).toBeUndefined();
    expect(await repository.listItemsForSource(source.id)).toHaveLength(1);
    await expect(service.getMyTrustedAnnouncement("student-1", "persisted-empty-id"))
      .resolves.toEqual(expect.objectContaining({ id: "persisted-empty-id" }));
  });

  it.each([
    ["unrecognized generic HTML", "<html><body><nav>Duyurular</nav><p>site chrome</p></body></html>", "html"],
    ["malformed JSON", "[not-json", "auto"]
  ] as const)("retains trusted cache for %s instead of treating it as authoritative empty", async (_label, body, parser) => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await createSource(repository, "university", "university-1", `invalid-${parser}`, "announcement");
    await repository.replaceItemsForSource(source, [content(source, "retained-id", "retained", "2026-07-01T00:00:00.000Z")]);
    vi.spyOn(announcementParser, "fetchSourceItems").mockImplementation(async () =>
      announcementParser.parseFetchedSourceItems(body, source.sourceUrl, parser));
    const syncTrustedAnnouncementSource = vi.fn(async (..._args: unknown[]) => undefined);
    const service = new AnnouncementsService(authRepository(), repository, undefined, undefined, { syncTrustedAnnouncementSource } as never);

    const response = await service.getMyAnnouncementsCollection("student-1", 20);
    expect(response.items).toEqual([expect.objectContaining({ id: "retained-id", freshness: "stale" })]);
    expect(response.failedSourceCount).toBe(0);
    expect(await repository.listItemsForSource(source.id)).toHaveLength(1);
    expect(syncTrustedAnnouncementSource).not.toHaveBeenCalled();
  });
});

async function createSource(
  repository: InMemoryAnnouncementRepository,
  scopeType: "university" | "faculty",
  scopeId: string,
  slug: string,
  contentType: AnnouncementContentType,
  origin = "https://www.example.edu.tr"
): Promise<AnnouncementSourceRecord> {
  return repository.upsertSource({
    scopeType,
    scopeId,
    sourceName: `Örnek ${slug} kaynağı`,
    sourceUrl: `${origin}/duyurular/${slug}`,
    homepageUrl: `${origin}/`,
    contentType,
    parser: "auto",
    priority: 20,
    status: "active"
  });
}

function content(
  source: AnnouncementSourceRecord,
  id: string,
  slug: string,
  fetchedAt: string
): AnnouncementItem {
  return {
    id,
    sourceId: source.id,
    sourceName: source.sourceName,
    contentType: source.contentType ?? "announcement",
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    title: "Ortak öğrenci kayıt duyurusu",
    summary: "Başvurular çevrim içi alınacaktır.",
    link: `https://www.example.edu.tr/duyuru/${slug}`,
    publicationKind: "date",
    publishedDate: "2026-08-04",
    publicationTimeSource: "source",
    fetchedAt,
    trustStatus: "trusted"
  };
}

function authRepository(): AuthRepository {
  const now = new Date();
  const user: AuthUserRecord = {
    id: "student-1",
    credentialGeneration: 1,
    fullName: "Öğrenci",
    email: "student@example.edu.tr",
    passwordHash: "unused",
    role: "student",
    universityId: "university-1",
    facultyId: "faculty-1",
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  return { findUserById: async (id: string) => id === user.id ? user : null } as AuthRepository;
}
