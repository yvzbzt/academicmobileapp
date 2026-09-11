import { describe, expect, it } from "vitest";
import { endpointCatalog } from "../src/contracts/endpoint-catalog.js";
import { savedAnnouncementSchema } from "../src/database/mongoose-schemas.js";
import { AnnouncementsController } from "../src/modules/announcements/announcements.controller.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { AnnouncementsService } from "../src/modules/announcements/announcements.service.js";
import type { AuthRepository, AuthUserRecord, AuthenticatedUser } from "../src/modules/auth/auth.types.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import { UsersService } from "../src/modules/users/users.service.js";
import { TestUserDataRepository } from "./support/test-user-data.repository.js";

describe("saved announcement contract", () => {
  it("persists an idempotent owner-scoped bookmark only after trusted scope validation", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "university-1",
      sourceName: "Example University",
      sourceUrl: "https://example.edu.tr/announcements",
      homepageUrl: "https://example.edu.tr",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [{
      id: "announcement-1",
      sourceId: source.id,
      sourceName: source.sourceName,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      contentType: "announcement",
      title: "Registration dates",
      link: "https://example.edu.tr/announcements/registration-dates",
      fetchedAt: new Date().toISOString()
    }]);
    await approveAllReviewItems(repository, source.id);

    const controller = new AnnouncementsController(new AnnouncementsService(authRepository(), repository));
    const owner = { id: "student-1", role: "student" } as AuthenticatedUser;
    const otherOwner = { id: "student-2", role: "student" } as AuthenticatedUser;

    expect(await controller.getMySavedAnnouncementStatus(owner, "announcement-1"))
      .toEqual({ announcementId: "announcement-1", saved: false });
    const first = await controller.saveMyAnnouncement(owner, "announcement-1");
    const second = await controller.saveMyAnnouncement(owner, "announcement-1");
    expect(first).toEqual(expect.objectContaining({ announcementId: "announcement-1", saved: true }));
    expect(second).toEqual(first);
    expect(await controller.getMySavedAnnouncementStatus(otherOwner, "announcement-1"))
      .toEqual({ announcementId: "announcement-1", saved: false });

    await controller.saveMyAnnouncement(otherOwner, "announcement-1");
    expect(await controller.deleteMySavedAnnouncement(otherOwner, "announcement-1"))
      .toEqual({ announcementId: "announcement-1", saved: false });
    expect(await controller.getMySavedAnnouncementStatus(owner, "announcement-1"))
      .toEqual(first);

    const approved = await repository.findReviewItemById("announcement-1");
    if (!approved?.item.contentFingerprint) throw new Error("Expected approved announcement.");
    await repository.updateReviewItem("announcement-1", { reviewStatus: "rejected" }, {
      expectedContentFingerprint: approved.item.contentFingerprint,
      ...(approved.item.reviewRevision ? { expectedReviewRevision: approved.item.reviewRevision } : {})
    });
    expect(await controller.getMySavedAnnouncementStatus(owner, "announcement-1"))
      .toEqual({ announcementId: "announcement-1", saved: false });
  });

  it("fails closed when a student tries to save an announcement outside their trusted academic scope", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "university-2",
      sourceName: "Other University",
      sourceUrl: "https://other.edu.tr/announcements",
      homepageUrl: "https://other.edu.tr",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [{
      id: "other-announcement",
      sourceId: source.id,
      sourceName: source.sourceName,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      contentType: "announcement",
      title: "Private scope",
      link: "https://other.edu.tr/announcements/private-scope",
      fetchedAt: new Date().toISOString()
    }]);
    const controller = new AnnouncementsController(new AnnouncementsService(authRepository(), repository));
    const owner = { id: "student-1", role: "student" } as AuthenticatedUser;

    await expect(controller.saveMyAnnouncement(owner, "other-announcement"))
      .rejects.toMatchObject({ status: 404 });
    expect(await controller.getMySavedAnnouncementStatus(owner, "other-announcement"))
      .toEqual({ announcementId: "other-announcement", saved: false });
  });

  it("defines durable per-owner uniqueness without placing saved state on shared announcement rows", () => {
    expect(savedAnnouncementSchema.get("collection")).toBe("saved_announcements");
    expect(savedAnnouncementSchema.path("userId").isRequired).toBe(true);
    expect(savedAnnouncementSchema.path("announcementId").isRequired).toBe(true);
    expect(savedAnnouncementSchema.path("savedAt").instance).toBe("Date");
    expect(savedAnnouncementSchema.indexes()).toEqual(expect.arrayContaining([
      [
        { userId: 1, announcementId: 1 },
        expect.objectContaining({ unique: true, name: "saved_announcements_user_announcement_unique" })
      ]
    ]));
    expect(endpointCatalog).toEqual(expect.arrayContaining([
      { method: "GET", path: "/announcements/my/saved/:announcementId", authRequired: true, roles: ["student"], rateLimit: "standard" },
      { method: "PUT", path: "/announcements/my/saved/:announcementId", authRequired: true, roles: ["student"], rateLimit: "standard" },
      { method: "DELETE", path: "/announcements/my/saved/:announcementId", authRequired: true, roles: ["student"], rateLimit: "standard" }
    ]));
  });

  it("erases bookmarks with the owner's personal app data", async () => {
    const auth = new InMemoryAuthRepository();
    const announcements = new InMemoryAnnouncementRepository();
    const user = await auth.createUser({
      fullName: "Bookmark Owner",
      email: "bookmark.owner@example.edu.tr",
      passwordHash: "hash",
      role: "student",
      status: "active"
    });
    await announcements.saveAnnouncement(user.id, "announcement-1", new Date());
    const users = new UsersService(
      auth,
      new InMemoryCatalogRepository(),
      new TestUserDataRepository(),
      undefined,
      announcements
    );

    await users.deleteMyData(user.id);

    await expect(announcements.findSavedAnnouncement(user.id, "announcement-1"))
      .resolves.toBeNull();
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

function authRepository(): AuthRepository {
  const now = new Date();
  const users = new Map<string, AuthUserRecord>(["student-1", "student-2"].map((id) => [id, {
    id,
    credentialGeneration: 0,
    fullName: id,
    email: `${id}@example.edu.tr`,
    passwordHash: "hash",
    role: "student",
    universityId: "university-1",
    status: "active",
    createdAt: now,
    updatedAt: now
  }]));
  return {
    async findUserById(id: string) {
      return users.get(id) ?? null;
    }
  } as unknown as AuthRepository;
}
