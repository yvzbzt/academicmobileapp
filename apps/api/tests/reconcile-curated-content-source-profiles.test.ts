import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VerifiedUniversitySource } from "../src/bootstrap/verified-source-registry.js";

const registry = vi.hoisted(() => ({
  listVerifiedUniversitySources: vi.fn<() => Promise<VerifiedUniversitySource[]>>()
}));

vi.mock("../src/bootstrap/verified-source-registry.js", () => registry);

import { reconcileCuratedContentSourceProfiles } from "../src/scripts/reconcile-curated-content-source-profiles.js";

type ReconciliationService = Parameters<typeof reconcileCuratedContentSourceProfiles>[0];

const makuNewsConfig = {
  itemSelector: "main a[href^='/content/'][href*='/1/']",
  titleSelector: ".text-left.font-thin.text-maku_text-500",
  linkSelector: "a[href^='/content/']",
  dateSelector: "div:has(> img[src='/calendar_gray.svg']) + div",
  contentSelector: ".text-sm.text-left.text-slate-400"
};
const makuEventConfig = {
  itemSelector: "main a[href^='/content/'][href*='/1/']",
  titleSelector: ".text-justify.text-slate-700.font-semibold",
  linkSelector: "a[href^='/content/']",
  dateSelector: "div:has(> img[src='/calendar_blue.svg']) + div",
  contentSelector: "div:has(> img[src='/location_blue.svg']) + div"
};
const ksuAnnouncementConfig = {
  itemSelector: "main article.card.blog-card",
  titleSelector: ".card-body h3 a[href]",
  linkSelector: ".card-body h3 a[href]",
  dateSelector: ".card-body > .text-muted.small",
  contentSelector: ".card-body > p"
};

function buildRegistrySources(): VerifiedUniversitySource[] {
  const fillers = Array.from({ length: 206 }, (_, index) => ({
    universityId: `university-${index}`,
    universityName: `University ${index}`
  }));
  return [
    ...fillers,
    {
      universityId: "burdur-mehmet-akif-ersoy-universitesi",
      universityName: "MAKU",
      newsUrl: "https://www.mehmetakif.edu.tr/tr/contents/47",
      eventUrl: "https://www.mehmetakif.edu.tr/tr/contents/46",
      parserProfiles: {
        news: { parser: "html", parserConfig: makuNewsConfig },
        event: { parser: "html", parserConfig: makuEventConfig }
      }
    },
    {
      universityId: "kahramanmaras-sutcu-imam-universitesi",
      universityName: "KSU",
      announcementUrl: "https://www.ksu.edu.tr/default?DId=KSU&MI=42546",
      parserProfiles: {
        announcement: { parser: "html", parserConfig: ksuAnnouncementConfig }
      }
    }
  ];
}

function healthyService(initialApprovalPending = false) {
  const savedProfiles = new Map<string, unknown>([
    ["burdur-mehmet-akif-ersoy-universitesi:news", {
      id: "burdur-mehmet-akif-ersoy-universitesi:news",
      scopeType: "university",
      scopeId: "burdur-mehmet-akif-ersoy-universitesi",
      contentType: "news",
      sourceUrl: "https://mehmetakif.edu.tr/sciencenews.aspx?type=1",
      canonicalUrl: "https://mehmetakif.edu.tr/sciencenews.aspx?type=1",
      sourceDefinitionVersion: "legacy-definition",
      parser: "auto",
      status: "active",
      trustStatus: "trusted",
      approvalPending: initialApprovalPending
    }]
  ]);
  const duplicateSources: Array<Record<string, unknown>> = [];
  const save = vi.fn(async (_access, universityId: string, contentType: string, input) => {
    const key = `${universityId}:${contentType}`;
    const existing = savedProfiles.get(key) as Record<string, unknown> | undefined;
    const source = {
      id: typeof existing?.id === "string" ? existing.id : key,
      scopeType: "university",
      scopeId: universityId,
      contentType,
      ...input,
      canonicalUrl: input.sourceUrl,
      sourceDefinitionVersion: "current-definition",
      status: "inactive",
      trustStatus: "quarantined",
      approvalPending: false
    };
    savedProfiles.set(key, source);
    return { source, ingestion: null };
  });
  const preview = vi.fn(async (_access, universityId: string, contentType: string, input) => {
    const staged = savedProfiles.get(`${universityId}:${contentType}`) as Record<string, unknown>;
    expect(input).toEqual({ activateWhenHealthy: true });
    expect(staged.status).toBe("inactive");
    const source = {
      ...staged,
      id: `${universityId}:${contentType}`,
      status: "active",
      trustStatus: "trusted",
      approvalPending: false
    };
    savedProfiles.set(`${universityId}:${contentType}`, source);
    return {
      sourceId: `${universityId}:${contentType}`,
      sourceName: contentType,
      sourceUrl: String(staged.sourceUrl),
      status: "healthy" as const,
      parsedItemCount: 2,
      acceptedItemCount: 2,
      testedAt: new Date().toISOString(),
      samples: [],
      activationStatus: "active" as const,
      source
    };
  });
  const probe = vi.fn<ReconciliationService["probeSourceForDeviceManifestById"]>(async (sourceId: string) => ({
    sourceId,
    status: "healthy" as const,
    itemCount: 2,
    contentChanged: false
  }));
  const list = vi.fn(async (_access, input: { scopeType?: string; contentType?: string; limit?: number; offset?: number }) => (
    [...savedProfiles.values(), ...duplicateSources]
      .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate && typeof candidate === "object"))
      .filter((candidate) => (!input.scopeType || candidate.scopeType === input.scopeType)
        && (!input.contentType || candidate.contentType === input.contentType))
      .slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 1_000))
  ));
  const deactivate = vi.fn(async (_access, id: string) => {
    const primaryEntry = [...savedProfiles.entries()]
      .find(([, candidate]) => (candidate as Record<string, unknown>).id === id);
    if (primaryEntry) {
      const source = { ...(primaryEntry[1] as Record<string, unknown>), status: "inactive", approvalPending: false };
      savedProfiles.set(primaryEntry[0], source);
      return source;
    }
    const duplicate = duplicateSources.find((candidate) => candidate.id === id);
    if (!duplicate) throw new Error("missing source");
    Object.assign(duplicate, { status: "inactive", approvalPending: false });
    return duplicate;
  });
  return {
    service: {
      saveUniversityContentSourceProfileForAdmin: save,
      previewUniversityContentSourceProfileForAdmin: preview,
      probeSourceForDeviceManifestById: probe,
      listSourcesForAdmin: list,
      deactivateManualSourceForAdmin: deactivate
    } as unknown as ReconciliationService,
    save,
    preview,
    probe,
    list,
    deactivate,
    savedProfiles,
    duplicateSources
  };
}

beforeEach(() => {
  registry.listVerifiedUniversitySources.mockReset().mockResolvedValue(buildRegistrySources());
});

describe("reconcileCuratedContentSourceProfiles", () => {
  it("stages legacy definitions inactive with the current parser config before activating them", async () => {
    const { service, save, preview, probe } = healthyService();

    const results = await reconcileCuratedContentSourceProfiles(service);

    expect(results).toHaveLength(3);
    expect(save).toHaveBeenCalledTimes(3);
    expect(preview).toHaveBeenCalledTimes(3);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenCalledWith(
      { kind: "global" },
      "burdur-mehmet-akif-ersoy-universitesi",
      "news",
      {
        sourceUrl: "https://www.mehmetakif.edu.tr/tr/contents/47",
        parser: "html",
        parserConfig: makuNewsConfig,
        status: "inactive"
      }
    );
    expect(save).toHaveBeenCalledWith(
      { kind: "global" },
      "kahramanmaras-sutcu-imam-universitesi",
      "announcement",
      {
        sourceUrl: "https://www.ksu.edu.tr/default?DId=KSU&MI=42546",
        parser: "html",
        parserConfig: ksuAnnouncementConfig,
        status: "inactive"
      }
    );
    expect(results.every((result) => result.activationStatus === "active" && result.itemCount === 2)).toBe(true);
    expect(save.mock.invocationCallOrder[2]).toBeLessThan(preview.mock.invocationCallOrder[0]!);
    expect(preview.mock.invocationCallOrder[0]).toBeLessThan(probe.mock.invocationCallOrder[0]!);
  });

  it("clears an old pending approval by staging inactive before requesting activation", async () => {
    const { service, save, preview } = healthyService(true);

    await reconcileCuratedContentSourceProfiles(service);

    expect(save.mock.invocationCallOrder[0]).toBeLessThan(preview.mock.invocationCallOrder[0]!);
    expect(save.mock.calls[0]?.[3]).toMatchObject({ status: "inactive" });
    expect(preview.mock.calls[0]?.[3]).toEqual({ activateWhenHealthy: true });
  });

  it("fails instead of reporting success when the registry loader returns no universities", async () => {
    registry.listVerifiedUniversitySources.mockResolvedValue([]);
    const { service, save, preview } = healthyService();

    await expect(reconcileCuratedContentSourceProfiles(service))
      .rejects.toThrow("CURATED_CONTENT_SOURCE_REGISTRY_COUNT_MISMATCH:0");
    expect(save).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
  });

  it("requires exactly three fully configured curated profiles", async () => {
    registry.listVerifiedUniversitySources.mockResolvedValue(
      buildRegistrySources().map(({ parserProfiles: _parserProfiles, ...source }) => source)
    );
    const { service } = healthyService();

    await expect(reconcileCuratedContentSourceProfiles(service))
      .rejects.toThrow("CURATED_CONTENT_SOURCE_PROFILE_COUNT_MISMATCH:0");
  });

  it("continues fail-closed staging after one target save fails", async () => {
    const { service, save, savedProfiles } = healthyService();
    save.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(reconcileCuratedContentSourceProfiles(service))
      .rejects.toThrow("CURATED_CONTENT_SOURCE_STAGING_FAILED:burdur-mehmet-akif-ersoy-universitesi:news");
    expect([...savedProfiles.values()]).toHaveLength(3);
    expect([...savedProfiles.values()].every((candidate) => (
      (candidate as Record<string, unknown>).status === "inactive"
    ))).toBe(true);
  });

  it("rejects healthy previews that contain no accepted items or remain approval-pending", async () => {
    const { service, save } = healthyService();
    vi.mocked(service.previewUniversityContentSourceProfileForAdmin).mockResolvedValueOnce({
      sourceId: "source",
      sourceName: "source",
      sourceUrl: "https://www.mehmetakif.edu.tr/tr/contents/47",
      status: "healthy",
      parsedItemCount: 0,
      acceptedItemCount: 0,
      testedAt: new Date().toISOString(),
      samples: [],
      activationStatus: "active",
      source: {
        id: "source",
        status: "active",
        trustStatus: "trusted",
        approvalPending: true
      }
    } as unknown as Awaited<ReturnType<ReconciliationService["previewUniversityContentSourceProfileForAdmin"]>>);

    await expect(reconcileCuratedContentSourceProfiles(service))
      .rejects.toThrow("CURATED_CONTENT_SOURCE_RECONCILIATION_FAILED:burdur-mehmet-akif-ersoy-universitesi:news");
    expect(save).toHaveBeenCalledTimes(6);
  });

  it("restages inactive when preview activation throws", async () => {
    const { service, save, preview, probe } = healthyService();
    preview.mockRejectedValueOnce(new Error("activation failed"));

    await expect(reconcileCuratedContentSourceProfiles(service))
      .rejects.toThrow("CURATED_CONTENT_SOURCE_RECONCILIATION_FAILED:burdur-mehmet-akif-ersoy-universitesi:news");
    expect(save).toHaveBeenCalledTimes(6);
    expect(save.mock.calls.slice(3).every((call) => call[3]?.status === "inactive")).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });

  it("restages every curated target when a later activation fails", async () => {
    const { service, preview, probe, savedProfiles } = healthyService();
    const successfulPreview = preview.getMockImplementation();
    if (!successfulPreview) throw new Error("Expected preview implementation.");
    preview.mockImplementationOnce(successfulPreview);
    preview.mockRejectedValueOnce(new Error("second activation failed"));

    await expect(reconcileCuratedContentSourceProfiles(service))
      .rejects.toThrow("CURATED_CONTENT_SOURCE_RECONCILIATION_FAILED");

    expect([...savedProfiles.values()]).toHaveLength(3);
    expect([...savedProfiles.values()].every((candidate) => (
      (candidate as Record<string, unknown>).status === "inactive"
      && (candidate as Record<string, unknown>).approvalPending === false
    ))).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("reports cleanup failure when an activated target cannot be proven inactive", async () => {
    const { service, save, probe, deactivate, savedProfiles } = healthyService();
    const saveImplementation = save.getMockImplementation();
    if (!saveImplementation) throw new Error("Expected save implementation.");
    save
      .mockImplementationOnce(saveImplementation)
      .mockImplementationOnce(saveImplementation)
      .mockImplementationOnce(saveImplementation)
      .mockRejectedValueOnce(new Error("cleanup save failed"));
    probe.mockRejectedValueOnce(new Error("device probe failed"));
    deactivate.mockRejectedValueOnce(new Error("cleanup deactivate failed"));

    await expect(reconcileCuratedContentSourceProfiles(service))
      .rejects.toThrow("CURATED_CONTENT_SOURCE_CLEANUP_FAILED:burdur-mehmet-akif-ersoy-universitesi:news");
    expect(savedProfiles.get("burdur-mehmet-akif-ersoy-universitesi:news"))
      .toMatchObject({ status: "active", trustStatus: "trusted" });
    expect([...savedProfiles.entries()]
      .filter(([key]) => key !== "burdur-mehmet-akif-ersoy-universitesi:news")
      .every(([, candidate]) => (candidate as Record<string, unknown>).status === "inactive"))
      .toBe(true);
  });

  it("deactivates a competing active source for the same university slot", async () => {
    const { service, duplicateSources, deactivate } = healthyService();
    duplicateSources.push({
      id: "legacy-maku-news-duplicate",
      scopeType: "university",
      scopeId: "burdur-mehmet-akif-ersoy-universitesi",
      contentType: "news",
      sourceUrl: "https://sciencenews.mehmetakif.edu.tr/haberler/",
      canonicalUrl: "https://sciencenews.mehmetakif.edu.tr/haberler/",
      sourceDefinitionVersion: "legacy-duplicate-definition",
      status: "active",
      trustStatus: "trusted",
      approvalPending: false
    });

    await expect(reconcileCuratedContentSourceProfiles(service)).resolves.toHaveLength(3);

    expect(deactivate).toHaveBeenCalledWith(
      { kind: "global" },
      "legacy-maku-news-duplicate",
      expect.objectContaining({
        expectedSourceDefinitionVersion: "legacy-duplicate-definition",
        expectedSourceStatus: "active",
        expectedTrustStatus: "trusted",
        expectedApprovalPending: false
      })
    );
    expect(duplicateSources[0]).toMatchObject({ status: "inactive", approvalPending: false });
  });

  it.each(["unhealthy", "throws"] as const)("deactivates an activated source when its device probe %s", async (failure) => {
    const { service, save, probe } = healthyService();
    if (failure === "throws") probe.mockRejectedValueOnce(new Error("network failure"));
    else probe.mockResolvedValueOnce({
      sourceId: "burdur-mehmet-akif-ersoy-universitesi:news",
      status: "failed",
      itemCount: 0,
      contentChanged: false
    });

    await expect(reconcileCuratedContentSourceProfiles(service))
      .rejects.toThrow("CURATED_CONTENT_SOURCE_DEVICE_PROBE_FAILED:burdur-mehmet-akif-ersoy-universitesi:news");
    expect(save).toHaveBeenCalledTimes(6);
    expect(save.mock.calls[3]?.[3]).toMatchObject({
      sourceUrl: "https://www.mehmetakif.edu.tr/tr/contents/47",
      parser: "html",
      parserConfig: makuNewsConfig,
      status: "inactive"
    });
  });
});
