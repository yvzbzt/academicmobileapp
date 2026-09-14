import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress
} from "../src/common/network/safe-outbound-request.js";
import { AnnouncementIngestionService } from "../src/modules/announcements/announcement-ingestion.service.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import type { AnnouncementSourceRecord } from "../src/modules/announcements/announcements.types.js";
import type { CatalogRepository, UniversityRecord } from "../src/modules/catalog/catalog.types.js";

const university: UniversityRecord = {
  id: "abdullah-gul-universitesi-kayseri",
  name: "Abdullah Gul Universitesi",
  slug: "abdullah-gul-universitesi-kayseri",
  city: "Kayseri",
  type: "state",
  websiteUrl: "https://agu.edu.tr/",
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date()
};

afterEach(() => {
  setSafeOutboundRequestDependenciesForTesting(undefined);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("daily announcement source health probe", () => {
  it("rejects a stale health result after the source definition changes", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await createSource(repository);

    const updated = await repository.recordSourceHealthProbe(source.id, {
      healthStatus: "healthy",
      lastCheckedAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
      itemCount: 1,
      contentHash: "a".repeat(64)
    }, { ...source, parser: "rss" });

    expect(updated).toBeNull();
    expect((await repository.findSourceById(source.id))?.healthProbe).toBeUndefined();
  });

  it("exposes only a bounded probe summary to administrators", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await createSource(repository);
    await repository.recordSourceHealthProbe(source.id, {
      healthStatus: "failed",
      lastCheckedAt: new Date("2026-09-14T11:00:00.000Z"),
      lastError: "request to https://internal.example failed with token=secret",
      consecutiveFailures: 50_000,
      itemCount: 500_000,
      etag: '"private-validator"',
      lastModified: "private-validator",
      contentHash: "a".repeat(64)
    }, source);
    const service = new AnnouncementIngestionService(catalogRepository(), repository);

    const [presented] = await service.listSourcesForAdmin({ kind: "global" });

    expect(presented?.healthProbe).toEqual({
      healthStatus: "failed",
      lastCheckedAt: new Date("2026-09-14T11:00:00.000Z"),
      lastError: "SOURCE_HEALTH_PROBE_FAILED",
      consecutiveFailures: 10_000,
      itemCount: 100_000
    });
  });

  it("uses isolated validators, advances the device revision, and never publishes or schedules", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await createSource(repository, {
      healthStatus: "healthy",
      lastSuccessAt: new Date("2026-09-13T05:30:00.000Z"),
      etag: '"ingestion-v7"',
      contentHash: "f".repeat(64)
    });
    const seenHeaders: OutgoingHttpHeaders[] = [];
    let responseIndex = 0;
    stubRequest(async (_url, headers) => {
      seenHeaders.push(headers);
      responseIndex += 1;
      if (responseIndex === 3) {
        return { status: 304, headers: { etag: '"probe-v2"' }, body: "" };
      }
      const title = responseIndex === 1 ? "Kayit duyurusu" : "Kayit duyurusu guncellendi";
      return {
        status: 200,
        headers: { "content-type": "text/html", etag: `"probe-v${responseIndex}"` },
        body: `<article class="item"><a href="/duyuru/1"><span class="title">${title}</span></a></article>`
      };
    });
    const replaceItems = vi.spyOn(repository, "replaceItemsForSource");
    const notifications = { syncTrustedAnnouncementSource: vi.fn() };
    const service = new AnnouncementIngestionService(catalogRepository(), repository, notifications as never);

    const first = await service.runDailyHealthCycle();
    const firstSource = await repository.findSourceById(source.id);
    const firstProbeHash = firstSource?.healthProbe?.contentHash;
    const second = await service.runDailyHealthCycle();
    const secondSource = await repository.findSourceById(source.id);
    const unchanged = await service.runDailyHealthCycle();

    expect(first).toMatchObject({ checkedSources: 1, healthy: 1, changed: 1 });
    expect(second).toMatchObject({ checkedSources: 1, healthy: 1, changed: 1 });
    expect(unchanged).toMatchObject({ checkedSources: 1, healthy: 1, changed: 0 });
    expect(firstProbeHash).toMatch(/^[a-f\d]{64}$/u);
    expect(secondSource?.healthProbe?.contentHash).toMatch(/^[a-f\d]{64}$/u);
    expect(secondSource?.healthProbe?.contentHash).not.toBe(firstProbeHash);
    expect(seenHeaders[0]).not.toHaveProperty("If-None-Match");
    expect(seenHeaders[1]).toMatchObject({ "If-None-Match": '"probe-v1"' });
    expect(seenHeaders[2]).toMatchObject({ "If-None-Match": '"probe-v2"' });
    expect(secondSource).toMatchObject({
      etag: '"ingestion-v7"',
      contentHash: "f".repeat(64),
      healthStatus: "healthy"
    });
    expect(await repository.listItemsForSource(source.id)).toEqual([]);
    expect(replaceItems).not.toHaveBeenCalled();
    expect(notifications.syncTrustedAnnouncementSource).not.toHaveBeenCalled();
  });

  it("records parser/empty failures without replacing content or quarantining the source", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await createSource(repository, {
      healthStatus: "healthy",
      lastSuccessAt: new Date("2026-09-13T05:30:00.000Z"),
      itemCount: 4
    });
    stubRequest(async () => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<html><body><p>Listing layout changed.</p></body></html>"
    }));
    const service = new AnnouncementIngestionService(catalogRepository(), repository);

    const statuses = [];
    for (let index = 0; index < 3; index += 1) {
      statuses.push((await service.runDailyHealthCycle()).results[0]?.status);
    }
    const checked = await repository.findSourceById(source.id);

    expect(statuses).toEqual(["degraded", "degraded", "failed"]);
    expect(checked).toMatchObject({
      status: "active",
      trustStatus: "trusted",
      healthStatus: "healthy",
      itemCount: 4,
      healthProbe: {
        healthStatus: "failed",
        lastError: "SOURCE_HTML_SELECTOR_LAYOUT_INVALID",
        consecutiveFailures: 3
      }
    });
  });

  it("quarantines an authority-breaking redirect while keeping errors bounded", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await createSource(repository);
    stubRequest(async () => ({
      status: 302,
      headers: { location: "https://untrusted.example.com/announcements" },
      body: ""
    }));
    const notifications = { syncTrustedAnnouncementSource: vi.fn() };
    const service = new AnnouncementIngestionService(catalogRepository(), repository, notifications as never);

    const result = await service.runDailyHealthCycle();
    const checked = await repository.findSourceById(source.id);

    expect(result).toMatchObject({ checkedSources: 1, healthy: 0, failed: 1 });
    expect(checked).toMatchObject({
      status: "inactive",
      trustStatus: "quarantined",
      healthProbe: {
        healthStatus: "failed",
        lastError: expect.stringMatching(/^SOURCE_AUTHORITY_[A-Z0-9_]+$/u)
      }
    });
    expect(notifications.syncTrustedAnnouncementSource).not.toHaveBeenCalled();
  });
});

async function createSource(
  repository: InMemoryAnnouncementRepository,
  overrides: Partial<AnnouncementSourceRecord> = {}
) {
  return repository.upsertSource({
    scopeType: "university",
    scopeId: university.id,
    ownerUniversityId: university.id,
    sourceName: "AGU announcements",
    sourceUrl: "https://agu.edu.tr/duyurular",
    homepageUrl: "https://agu.edu.tr/",
    contentType: "announcement",
    parser: "html",
    parserConfig: { itemSelector: ".item", titleSelector: ".title", linkSelector: "a" },
    priority: 20,
    status: "active",
    trustStatus: "trusted",
    ...overrides
  });
}

function catalogRepository(): CatalogRepository {
  return {
    async createUniversity() { throw new Error("not used"); },
    async updateUniversity() { throw new Error("not used"); },
    async archiveUniversity() { throw new Error("not used"); },
    async findUniversityById(id) { return id === university.id ? university : null; },
    async listUniversities(input) { return input.offset === 0 ? [university].slice(0, input.limit) : []; },
    async findUniversityByEmailDomain() { return null; },
    async createFaculty() { throw new Error("not used"); },
    async updateFaculty() { throw new Error("not used"); },
    async listFaculties() { return []; },
    async createDepartment() { throw new Error("not used"); },
    async updateDepartment() { throw new Error("not used"); },
    async listDepartments() { return []; }
  };
}

function stubRequest(handler: (
  url: string,
  headers: OutgoingHttpHeaders
) => Promise<{ status: number; headers: Record<string, string>; body: string }>): void {
  const publicAddress: ResolvedOutboundAddress = { address: "93.184.216.34", family: 4 };
  setSafeOutboundRequestDependenciesForTesting({
    resolveHostname: async () => [publicAddress],
    requestHop: async (url, pinnedAddress, input) => {
      const response = await handler(url, input.headers);
      return {
        ...response,
        body: Buffer.from(response.body),
        remoteAddress: pinnedAddress.address
      };
    }
  });
}
