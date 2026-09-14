import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress
} from "../src/common/network/safe-outbound-request.js";
import { AnnouncementIngestionService, healthProbeContentHash } from "../src/modules/announcements/announcement-ingestion.service.js";
import { DEVICE_SOURCE_RUNTIME_VERSION } from "../../../packages/shared/src/device-source-runtime.js";
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
  it("changes the device revision for body-only and event-date changes", () => {
    const baseline = [{
      title: "Student event",
      link: "https://agu.edu.tr/event/1",
      summary: "First summary",
      body: [{ type: "paragraph", text: "First body" }],
      keyDates: [{ label: "Etkinlik tarihi", startDate: "2026-09-20" }]
    }];
    expect(healthProbeContentHash([{ ...baseline[0]!, summary: "Changed summary" }]))
      .not.toBe(healthProbeContentHash(baseline));
    expect(healthProbeContentHash([{
      ...baseline[0]!,
      keyDates: [{ label: "Etkinlik tarihi", startDate: "2026-09-21" }]
    }])).not.toBe(healthProbeContentHash(baseline));
  });

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"));
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
    const notifications = {
      syncTrustedAnnouncementSource: vi.fn(),
      retireTrustedAnnouncementSource: vi.fn(async () => ({ retired: 0 }))
    };
    const service = new AnnouncementIngestionService(catalogRepository(), repository, notifications as never);

    const first = await service.runDailyHealthCycle();
    const firstSource = await repository.findSourceById(source.id);
    const firstProbeHash = firstSource?.healthProbe?.contentHash;
    const duplicateDaily = await service.runDailyHealthCycle();
    const second = await service.runDeviceRevisionCycle();
    const secondSource = await repository.findSourceById(source.id);
    const unchanged = await service.runDeviceRevisionCycle();
    vi.setSystemTime(new Date("2026-09-15T12:00:00.000Z"));
    const dailyFullParse = await service.runDailyHealthCycle();

    expect(first).toMatchObject({ checkedSources: 1, healthy: 1, changed: 1 });
    expect(duplicateDaily).toMatchObject({ checkedSources: 0, healthy: 0, changed: 0 });
    expect(second).toMatchObject({ checkedSources: 1, healthy: 1, changed: 1 });
    expect(unchanged).toMatchObject({ checkedSources: 1, healthy: 1, changed: 0 });
    expect(dailyFullParse).toMatchObject({ checkedSources: 1, healthy: 1, changed: 0 });
    expect(firstProbeHash).toMatch(/^[a-f\d]{64}$/u);
    expect(firstSource?.healthProbe?.lastFullCheckedAt).toEqual(new Date("2026-09-14T12:00:00.000Z"));
    expect(secondSource?.healthProbe?.contentHash).toMatch(/^[a-f\d]{64}$/u);
    expect(secondSource?.healthProbe?.contentHash).not.toBe(firstProbeHash);
    expect(secondSource?.healthProbe?.engineVersion).toBe(DEVICE_SOURCE_RUNTIME_VERSION);
    expect(seenHeaders[0]).not.toHaveProperty("If-None-Match");
    expect(seenHeaders[1]).toMatchObject({ "If-None-Match": '"probe-v1"' });
    expect(seenHeaders[2]).toMatchObject({ "If-None-Match": '"probe-v2"' });
    expect(seenHeaders[3]).not.toHaveProperty("If-None-Match");
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
    vi.useFakeTimers();
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
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 14 + index, 12)));
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

  it("does not turn 30-minute revision transport failures into daily security failures", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await createSource(repository);
    const baselineCheckedAt = new Date("2026-09-14T05:30:00.000Z");
    await repository.recordSourceHealthProbe(source.id, {
      engineVersion: DEVICE_SOURCE_RUNTIME_VERSION,
      healthStatus: "degraded",
      lastCheckedAt: baselineCheckedAt,
      lastSuccessAt: new Date("2026-09-13T05:30:00.000Z"),
      lastError: "SOURCE_RUNTIME_REQUEST_FAILED",
      consecutiveFailures: 2,
      itemCount: 4,
      contentHash: "a".repeat(64),
    }, source);
    stubRequest(async () => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<html><body><p>Listing layout changed.</p></body></html>",
    }));
    const service = new AnnouncementIngestionService(catalogRepository(), repository);

    for (let index = 0; index < 3; index += 1) await service.runDeviceRevisionCycle();
    const afterRevision = await repository.findSourceById(source.id);
    const daily = await service.runDailyHealthCycle();
    const afterDaily = await repository.findSourceById(source.id);

    expect(afterRevision?.healthProbe).toMatchObject({
      healthStatus: "degraded",
      lastCheckedAt: baselineCheckedAt,
      consecutiveFailures: 2,
      itemCount: 4,
    });
    expect(daily.results[0]?.status).toBe("failed");
    expect(afterDaily?.healthProbe).toMatchObject({ healthStatus: "failed", consecutiveFailures: 3 });
  });

  it("does not let a revision 304 mask a failed daily full parse", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T02:30:00.000Z"));
    const repository = new InMemoryAnnouncementRepository();
    const source = await createSource(repository);
    const priorSuccess = new Date("2026-09-13T02:30:00.000Z");
    await repository.recordSourceHealthProbe(source.id, {
      engineVersion: DEVICE_SOURCE_RUNTIME_VERSION,
      healthStatus: "healthy",
      lastCheckedAt: priorSuccess,
      lastFullCheckedAt: priorSuccess,
      lastSuccessAt: priorSuccess,
      consecutiveFailures: 0,
      itemCount: 4,
      etag: '"known"',
      contentHash: "a".repeat(64),
    }, source);
    let requestCount = 0;
    stubRequest(async () => {
      requestCount += 1;
      return requestCount === 1
        ? { status: 200, headers: { "content-type": "text/html" }, body: "<p>Changed layout</p>" }
        : { status: 304, headers: { etag: '"known"' }, body: "" };
    });
    const service = new AnnouncementIngestionService(catalogRepository(), repository);

    const daily = await service.runDailyHealthCycle();
    vi.setSystemTime(new Date("2026-09-14T03:00:00.000Z"));
    const revision = await service.runDeviceRevisionCycle();
    const checked = await repository.findSourceById(source.id);

    expect(daily.results[0]?.status).toBe("degraded");
    expect(revision.results[0]?.status).toBe("degraded");
    expect(checked?.healthProbe).toMatchObject({
      healthStatus: "degraded",
      lastCheckedAt: new Date("2026-09-14T03:00:00.000Z"),
      lastFullCheckedAt: new Date("2026-09-14T02:30:00.000Z"),
      lastSuccessAt: priorSuccess,
      lastError: "SOURCE_HTML_SELECTOR_LAYOUT_INVALID",
      consecutiveFailures: 1,
      itemCount: 4,
    });
  });

  it("deduplicates full probes by Istanbul calendar day across restart hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T02:30:00.000Z"));
    const repository = new InMemoryAnnouncementRepository();
    const source = await createSource(repository);
    await repository.recordSourceHealthProbe(source.id, {
      engineVersion: DEVICE_SOURCE_RUNTIME_VERSION,
      healthStatus: "healthy",
      lastCheckedAt: new Date("2026-09-13T22:30:00.000Z"),
      lastFullCheckedAt: new Date("2026-09-13T22:30:00.000Z"),
      lastSuccessAt: new Date("2026-09-13T22:30:00.000Z"),
      consecutiveFailures: 0,
      itemCount: 1,
      contentHash: "a".repeat(64),
    }, source);
    const request = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<article class='item'><a href='/one'><span class='title'>Notice</span></a></article>",
    }));
    stubRequest(request);
    const service = new AnnouncementIngestionService(catalogRepository(), repository);

    const result = await service.runDailyHealthCycle();

    expect(result).toMatchObject({ checkedSources: 0, healthy: 0, degraded: 0, failed: 0 });
    expect(request).not.toHaveBeenCalled();
  });

  it("can immediately establish the device-manifest probe for one published source", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await createSource(repository);
    await createSource(repository, {
      id: "unrelated-source",
      sourceUrl: "https://agu.edu.tr/other-announcements"
    });
    const request = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<article class='item'><a href='/one'><span class='title'>Registration announcement</span></a></article>"
    }));
    stubRequest(request);
    const service = new AnnouncementIngestionService(catalogRepository(), repository);

    await expect(service.probeSourceForDeviceManifestById(source.id)).resolves.toMatchObject({
      sourceId: source.id,
      status: "healthy",
      itemCount: 1
    });
    expect((await repository.findSourceById(source.id))?.healthProbe).toMatchObject({
      engineVersion: DEVICE_SOURCE_RUNTIME_VERSION,
      healthStatus: "healthy",
      itemCount: 1
    });
    expect((await repository.findSourceById("unrelated-source"))?.healthProbe).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("quarantines an authority-breaking redirect while keeping errors bounded", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await createSource(repository);
    stubRequest(async () => ({
      status: 302,
      headers: { location: "https://untrusted.example.com/announcements" },
      body: ""
    }));
    const notifications = {
      syncTrustedAnnouncementSource: vi.fn(),
      retireTrustedAnnouncementSource: vi.fn(async () => ({ retired: 0 }))
    };
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
    expect(notifications.retireTrustedAnnouncementSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: source.id, status: "inactive", trustStatus: "quarantined" })
    );
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
