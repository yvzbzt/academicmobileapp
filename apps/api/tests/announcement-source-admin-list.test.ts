import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it, vi } from "vitest";
import { AnnouncementIngestionService } from "../src/modules/announcements/announcement-ingestion.service.js";
import { AnnouncementSourcesQueryDto } from "../src/modules/announcements/announcements.dto.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { adminSourceMongoFilter } from "../src/modules/announcements/mongo-announcement.repository.js";
import type {
  AnnouncementRepository,
  AnnouncementSourceRecord,
  UpsertAnnouncementSourceInput
} from "../src/modules/announcements/announcements.types.js";
import type { CatalogRepository } from "../src/modules/catalog/catalog.types.js";

describe("admin announcement-source query DTO", () => {
  it("accepts and transforms every supported server-side filter", async () => {
    const query = plainToInstance(AnnouncementSourcesQueryDto, {
      status: "inactive",
      trustStatus: "pending_review",
      contentType: "event",
      scopeType: "department",
      search: "mühendislik",
      limit: "101",
      offset: "200"
    });

    expect(await validate(query)).toEqual([]);
    expect(query).toMatchObject({
      status: "inactive",
      trustStatus: "pending_review",
      contentType: "event",
      scopeType: "department",
      search: "mühendislik",
      limit: 101,
      offset: 200
    });
  });

  it("rejects unsupported filters and unbounded search/page input", async () => {
    const query = plainToInstance(AnnouncementSourcesQueryDto, {
      status: "deleted",
      trustStatus: "unknown",
      contentType: "calendar",
      scopeType: "tenant",
      search: "x".repeat(201),
      limit: 102,
      offset: 1_000_001
    });

    const invalidProperties = new Set((await validate(query)).map((error) => error.property));
    expect(invalidProperties).toEqual(new Set([
      "status",
      "trustStatus",
      "contentType",
      "scopeType",
      "search",
      "limit",
      "offset"
    ]));
  });
});

describe("admin announcement-source Mongo query", () => {
  it("keeps legacy null/missing values in the default announcement and quarantine filters", () => {
    expect(adminSourceMongoFilter({
      trustStatus: "quarantined",
      contentType: "announcement"
    })).toEqual({
      $and: [
        { $or: [{ trustStatus: "quarantined" }, { trustStatus: { $exists: false } }, { trustStatus: null }] },
        { approvalPending: { $ne: true } },
        { $or: [{ contentType: "announcement" }, { contentType: { $exists: false } }, { contentType: null }] }
      ]
    });
  });

  it("maps pending review to the approval fence instead of a persisted trust value", () => {
    expect(adminSourceMongoFilter({ trustStatus: "pending_review" })).toEqual({ approvalPending: true });
  });

  it("combines authorization scope with filters and treats search as escaped literal text", () => {
    const filter = adminSourceMongoFilter({
      status: "active",
      trustStatus: "trusted",
      contentType: "news",
      scopeType: "faculty",
      search: "  A.+[B]  "
    }, { $or: [{ scopeType: "faculty", scopeId: "faculty-1" }] });

    const clauses = (filter.$and ?? []) as Array<Record<string, unknown>>;
    expect(clauses.slice(0, 6)).toEqual([
      { $or: [{ scopeType: "faculty", scopeId: "faculty-1" }] },
      { status: "active" },
      { trustStatus: "trusted" },
      { approvalPending: { $ne: true } },
      { contentType: "news" },
      { scopeType: "faculty" }
    ]);
    const searchBranches = clauses[6]?.$or as Array<Record<string, RegExp>>;
    expect(searchBranches).toHaveLength(3);
    for (const branch of searchBranches) {
      const expression = Object.values(branch)[0];
      expect(expression).toBeInstanceOf(RegExp);
      expect(expression?.test("prefix a.+[b] suffix")).toBe(true);
      expect(expression?.test("A-anything-B")).toBe(false);
    }
  });
});

describe("admin announcement-source filtering and pagination", () => {
  it("uses the dedicated admin repository query and defensively bounds pagination", async () => {
    const source = sourceRecord({
      id: "source-1",
      scopeType: "university",
      scopeId: "university-1",
      sourceName: "Campus news",
      sourceUrl: "https://www.ankara.edu.tr/haberler",
      contentType: "news",
      trustStatus: "quarantined"
    });
    const listAdminSources = vi.fn().mockResolvedValue([source]);
    const listSourcesByScopeSet = vi.fn(() => {
      throw new Error("student-visible source query must not be used by an admin listing");
    });
    const repository = {
      listAdminSources,
      listSourcesByScopeSet
    } as unknown as AnnouncementRepository;
    const service = new AnnouncementIngestionService({} as CatalogRepository, repository);

    const result = await service.listSourcesForAdmin({ kind: "global" }, {
      status: "inactive",
      trustStatus: "quarantined",
      contentType: "news",
      scopeType: "university",
      search: `  Campus${"x".repeat(250)}  `,
      limit: 4_000.9,
      offset: -20
    });

    expect(listAdminSources).toHaveBeenCalledWith({
      status: "inactive",
      trustStatus: "quarantined",
      contentType: "news",
      scopeType: "university",
      search: expect.stringMatching(/^Campus/),
      limit: 1_000,
      offset: 0
    });
    expect((listAdminSources.mock.calls[0]?.[0] as { search: string }).search).toHaveLength(200);
    expect(listSourcesByScopeSet).not.toHaveBeenCalled();
    expect(result).toEqual([expect.objectContaining({ id: source.id, reviewStatus: "pending_review" })]);
  });

  it("applies filters and pagination only inside the server-derived university scope", async () => {
    const repository = new InMemoryAnnouncementRepository();
    await repository.upsertSource(sourceInput({
      id: "own-university",
      scopeType: "university",
      scopeId: "university-1",
      sourceName: "University announcements",
      sourceUrl: "https://www.ankara.edu.tr/duyurular",
      contentType: "announcement",
      trustStatus: "trusted",
      status: "active",
      priority: 90
    }));
    await repository.upsertSource(sourceInput({
      id: "own-department",
      scopeType: "department",
      scopeId: "department-1",
      sourceName: "Aranan bölüm etkinlikleri",
      sourceUrl: "https://www.ankara.edu.tr/bolum-etkinlikleri",
      contentType: "event",
      trustStatus: "quarantined",
      status: "inactive",
      priority: 50
    }));
    await repository.upsertSource(sourceInput({
      id: "own-active-quarantine",
      scopeType: "faculty",
      scopeId: "faculty-1",
      sourceName: "Pending faculty news",
      sourceUrl: "https://www.ankara.edu.tr/fakulte-haberleri",
      contentType: "news",
      trustStatus: "trusted",
      approvalPending: true,
      status: "active",
      priority: 70
    }));
    await repository.upsertSource(sourceInput({
      id: "foreign-department",
      scopeType: "department",
      scopeId: "department-2",
      sourceName: "Aranan yabancı etkinlikler",
      sourceUrl: "https://www.hacettepe.edu.tr/bolum-etkinlikleri",
      contentType: "event",
      trustStatus: "quarantined",
      status: "inactive",
      priority: 100
    }));
    const catalog = {
      listFaculties: vi.fn(async (universityId: string) => universityId === "university-1"
        ? [{ id: "faculty-1" }]
        : []),
      listDepartments: vi.fn(async (facultyId: string) => facultyId === "faculty-1"
        ? [{ id: "department-1", universityId: "university-1" }]
        : [])
    } as unknown as CatalogRepository;
    const service = new AnnouncementIngestionService(catalog, repository);

    const visible = await service.listSourcesForAdmin(
      { kind: "university", universityId: "university-1" },
      {
        status: "inactive",
        trustStatus: "quarantined",
        contentType: "event",
        scopeType: "department",
        search: "ARANAN",
        limit: 1,
        offset: 0
      }
    );

    expect(visible).toEqual([
      expect.objectContaining({
        id: "own-department",
        scopeId: "department-1",
        reviewStatus: "pending_review"
      })
    ]);
    expect(visible.map((source) => source.id)).not.toContain("foreign-department");

    await expect(service.listSourcesForAdmin(
      { kind: "university", universityId: "university-1" },
      { trustStatus: "pending_review", limit: 10, offset: 0 }
    )).resolves.toEqual([
      expect.objectContaining({ id: "own-active-quarantine", reviewStatus: "pending_review" })
    ]);

    const ingest = vi.spyOn(service, "ingestSource").mockImplementation(async (source) => ({
      sourceId: source.id,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      status: "healthy",
      itemCount: 0,
      sampleTitles: []
    }));
    const ingestion = await service.runIngestionForAdmin({ kind: "university", universityId: "university-1" });
    expect(ingestion.results.map((result) => result.sourceId)).toEqual(["own-university"]);
    expect(ingest).toHaveBeenCalledTimes(1);
  });
});

function sourceInput(input: Pick<
  UpsertAnnouncementSourceInput,
  "id" | "scopeType" | "scopeId" | "sourceName" | "sourceUrl" | "contentType" | "trustStatus" | "status" | "priority"
> & Pick<UpsertAnnouncementSourceInput, "approvalPending">): UpsertAnnouncementSourceInput {
  return {
    ...input,
    parser: "html"
  };
}

function sourceRecord(input: Pick<
  AnnouncementSourceRecord,
  "id" | "scopeType" | "scopeId" | "sourceName" | "sourceUrl" | "contentType" | "trustStatus"
>): AnnouncementSourceRecord {
  const now = new Date("2026-09-10T00:00:00.000Z");
  return {
    ...input,
    parser: "html",
    priority: 10,
    status: "inactive",
    createdAt: now,
    updatedAt: now
  };
}
