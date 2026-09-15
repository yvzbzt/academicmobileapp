import { afterEach, describe, expect, it, vi } from "vitest";
import * as registry from "../src/bootstrap/verified-source-registry.js";
import { AnnouncementIngestionService, type ManualAnnouncementSourceInput } from "../src/modules/announcements/announcement-ingestion.service.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";

const input: ManualAnnouncementSourceInput = {
  universityId: "bartin-universitesi",
  scopeType: "university",
  sourceName: "Bartin announcements",
  sourceUrl: "https://www.bartin.edu.tr/duyurular.html",
  contentType: "announcement",
  parser: "auto",
  priority: 10,
  fetchIntervalMinutes: 180
};

afterEach(() => vi.restoreAllMocks());

async function setup(status: "active" | "archived" = "active") {
  const catalog = new InMemoryCatalogRepository();
  await catalog.createUniversity({
    name: "Bartin Universitesi",
    slug: input.universityId,
    city: "Bartin",
    type: "state",
    status
  });
  const repository = new InMemoryAnnouncementRepository();
  return { catalog, repository, service: new AnnouncementIngestionService(catalog, repository) };
}

describe("manual source verified homepage fallback", () => {
  it("uses Bartin's independently verified homepage when the catalog website is missing", async () => {
    const { catalog, service } = await setup();

    const result = await service.createManualSource(input);

    expect(result.source).toMatchObject({
      homepageUrl: "https://www.bartin.edu.tr/",
      sourceUrl: input.sourceUrl,
      ownerUniversityId: input.universityId,
      status: "inactive",
      trustStatus: "quarantined",
      trustReasonCodes: []
    });
    expect(result.ingestion).toBeNull();
    expect((await catalog.findUniversityById(input.universityId))?.websiteUrl).toBeUndefined();
  });

  it.each([
    { name: "missing authority", authority: null },
    { name: "quarantined authority", authority: { status: "quarantined" as const } },
    { name: "foreign homepage", authority: { authorityUrls: ["https://www.ankara.edu.tr/"] } },
    { name: "unsafe homepage", authority: { authorityUrls: ["file:///etc/passwd"] } },
    { name: "missing homepage evidence", authority: { authorityUrls: [] } }
  ])("rejects $name without inventing authority from the candidate URL", async ({ authority }) => {
    const verified = await registry.findVerifiedSourceAuthority(input.universityId);
    expect(verified?.status).toBe("verified");
    vi.spyOn(registry, "findVerifiedSourceAuthority").mockResolvedValue(authority === null ? null : {
      ...verified!,
      ...authority
    });
    const { repository, service } = await setup();

    await expect(service.createManualSource(input)).rejects.toThrow("Selected university has no verified active website.");
    expect(await repository.listAllSources({ limit: 10 })).toEqual([]);
  });

  it("still quarantines a foreign source even when the fallback homepage is verified", async () => {
    const { repository, service } = await setup();

    await expect(service.createManualSource({ ...input, sourceUrl: "https://www.ankara.edu.tr/duyurular" }))
      .rejects.toThrow("source_domain_mismatch");
    expect(await repository.listAllSources({ limit: 10 })).toEqual([
      expect.objectContaining({ status: "inactive", trustStatus: "quarantined", trustReasonCodes: ["source_domain_mismatch"] })
    ]);
  });

  it("does not reactivate an archived university through its verified homepage", async () => {
    const { repository, service } = await setup("archived");

    await expect(service.createManualSource(input)).rejects.toThrow("Selected university has no verified active website.");
    expect(await repository.listAllSources({ limit: 10 })).toEqual([]);
  });
});
