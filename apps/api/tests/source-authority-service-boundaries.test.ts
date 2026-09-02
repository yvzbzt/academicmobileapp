import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type SafeOutboundHopResponse
} from "../src/common/network/safe-outbound-request.js";
import { SourceAuthorityPolicy } from "../src/domain/source-authority-policy.js";
import { AnnouncementIngestionService } from "../src/modules/announcements/announcement-ingestion.service.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";

afterEach(() => {
  setSafeOutboundRequestDependenciesForTesting(undefined);
  vi.restoreAllMocks();
});

describe("announcement source authority boundaries", () => {
  it("uses the central policy at registration, fetch, redirect, and publication before persisting", async () => {
    const catalog = await createAguCatalog();
    const repository = new InMemoryAnnouncementRepository();
    await repository.upsertSource({
      scopeType: "university",
      scopeId: "abdullah-gul-universitesi-kayseri",
      sourceName: "AGU Duyurular",
      sourceUrl: "https://agu.edu.tr/duyurular",
      homepageUrl: "https://agu.edu.tr/",
      contentType: "announcement",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop: async (_url, pinnedAddress): Promise<SafeOutboundHopResponse> => ({
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from('<a href="/duyuru/1">Akademik takvim duyurusu</a>'),
        remoteAddress: pinnedAddress.address
      })
    });
    const evaluate = vi.spyOn(SourceAuthorityPolicy.prototype, "evaluate");

    const result = await new AnnouncementIngestionService(catalog, repository).runIngestion();

    expect(result.summary).toMatchObject({ healthy: 1, failed: 0 });
    expect(await repository.listItemsByScope({
      universityId: "abdullah-gul-universitesi-kayseri",
      limit: 10
    })).toHaveLength(1);
    const boundaries = evaluate.mock.calls.map(([input]) => input.boundary);
    expect(boundaries).toContain("registration");
    expect(boundaries).toContain("fetch");
    expect(boundaries).toContain("publication");
  });

  it("quarantines a cross-owner active source before transport or persistence", async () => {
    const catalog = await createAguCatalog();
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "abdullah-gul-universitesi-kayseri",
      sourceName: "Yanlış kurum kaynağı",
      sourceUrl: "https://www.ankara.edu.tr/duyurular",
      contentType: "announcement",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    const requestHop = vi.fn(async (): Promise<SafeOutboundHopResponse> => {
      throw new Error("transport must not run");
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop
    });

    const result = await new AnnouncementIngestionService(catalog, repository).runIngestion();
    const quarantined = await repository.findSourceById(source.id);

    expect(result.results[0]).toMatchObject({ status: "failed", error: "source_domain_mismatch" });
    expect(requestHop).not.toHaveBeenCalled();
    expect(quarantined).toMatchObject({
      status: "inactive",
      trustStatus: "quarantined",
      trustReasonCodes: ["source_domain_mismatch"]
    });
    expect(await repository.listItemsForSource(source.id)).toEqual([]);
  });

  it("records a rejected manual registration as inactive quarantine", async () => {
    const catalog = await createAguCatalog();
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog, repository);

    await expect(service.createManualSource({
      universityId: "abdullah-gul-universitesi-kayseri",
      scopeType: "university",
      sourceName: "Başka kurum duyuruları",
      sourceUrl: "https://www.ankara.edu.tr/duyurular",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      fetchIntervalMinutes: 180
    })).rejects.toThrow("source_domain_mismatch");

    expect(await repository.listAllSources({ limit: 10 })).toEqual([
      expect.objectContaining({
        status: "inactive",
        trustStatus: "quarantined",
        trustReasonCodes: ["source_domain_mismatch"]
      })
    ]);
  });

  it("activates a manual source on an explicitly evidenced owner alias", async () => {
    const catalog = new InMemoryCatalogRepository();
    await catalog.createUniversity({
      name: "Gaziantep Universitesi",
      slug: "gaziantep-universitesi",
      city: "Gaziantep",
      type: "state",
      websiteUrl: "https://www.gantep.edu.tr/",
      status: "active"
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop: async (_url, pinnedAddress): Promise<SafeOutboundHopResponse> => ({
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from('<a href="/duyuru/1">Akademik takvim duyurusu</a>'),
        remoteAddress: pinnedAddress.address
      })
    });
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog, repository);

    const result = await service.createManualSource({
      universityId: "gaziantep-universitesi",
      scopeType: "university",
      sourceName: "Gaziantep duyurular",
      sourceUrl: "https://www.gaziantep.edu.tr/duyurular",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      fetchIntervalMinutes: 180
    });

    expect(result.source).toMatchObject({
      sourceUrl: "https://www.gaziantep.edu.tr/duyurular",
      homepageUrl: "https://www.gaziantep.edu.tr/",
      status: "active",
      trustStatus: "trusted"
    });
    expect(result.ingestion).toMatchObject({ status: "healthy", itemCount: 1 });
  });

  it("revalidates and explicitly trusts a corrected quarantined source before activation", async () => {
    const catalog = await createAguCatalog();
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog, repository);
    await expect(service.createManualSource({
      universityId: "abdullah-gul-universitesi-kayseri",
      scopeType: "university",
      sourceName: "Correctable source",
      sourceUrl: "https://www.ankara.edu.tr/duyurular",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      fetchIntervalMinutes: 180
    })).rejects.toThrow("source_domain_mismatch");
    const [candidate] = await repository.listAllSources({ limit: 10 });
    expect(candidate).toMatchObject({ status: "inactive", trustStatus: "quarantined" });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop: async (_url, pinnedAddress): Promise<SafeOutboundHopResponse> => ({
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from('<a href="/duyuru/1">Akademik takvim duyurusu</a>'),
        remoteAddress: pinnedAddress.address
      })
    });

    const corrected = await service.updateManualSource(candidate!.id, {
      sourceUrl: "https://agu.edu.tr/duyurular",
      status: "active"
    });

    expect(corrected.source).toMatchObject({
      sourceUrl: "https://agu.edu.tr/duyurular",
      status: "active",
      trustStatus: "trusted",
      trustReasonCodes: []
    });
    expect(corrected.ingestion).toMatchObject({ status: "healthy", itemCount: 1 });
  });

  it("does not promote a mutable catalog website into authority evidence", async () => {
    const catalog = new InMemoryCatalogRepository();
    await catalog.createUniversity({
      name: "Unverified University",
      slug: "unverified-university",
      city: "Ankara",
      type: "state",
      websiteUrl: "https://www.ankara.edu.tr/",
      status: "active"
    });
    const requestHop = vi.fn(async (): Promise<SafeOutboundHopResponse> => {
      throw new Error("transport must not run");
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop
    });
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog, repository);

    await expect(service.createManualSource({
      universityId: "unverified-university",
      scopeType: "university",
      sourceName: "Claimed Ankara source",
      sourceUrl: "https://www.ankara.edu.tr/duyurular",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      fetchIntervalMinutes: 180
    })).rejects.toThrow("missing_resolved_owner_academic_entity_id");

    expect(requestHop).not.toHaveBeenCalled();
    expect(await repository.listAllSources({ limit: 10 })).toEqual([
      expect.objectContaining({
        status: "inactive",
        trustStatus: "quarantined",
        trustReasonCodes: ["missing_resolved_owner_academic_entity_id"]
      })
    ]);
  });
});

async function createAguCatalog(): Promise<InMemoryCatalogRepository> {
  const catalog = new InMemoryCatalogRepository();
  await catalog.createUniversity({
    name: "Abdullah Gül Üniversitesi",
    slug: "abdullah-gul-universitesi-kayseri",
    city: "Kayseri",
    type: "state",
    websiteUrl: "https://agu.edu.tr/",
    status: "active"
  });
  return catalog;
}
