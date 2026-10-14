import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnouncementIngestionService } from "../src/modules/announcements/announcement-ingestion.service.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { setSafeOutboundRequestDependenciesForTesting } from "../src/common/network/safe-outbound-request.js";
import { AnnouncementsService } from "../src/modules/announcements/announcements.service.js";

const url = "https://www.ktun.edu.tr/tr/Birim/DuyuruDetay/bOlUmUmUzden_haberler_6877";
const selectors = { itemSelector: "main table.MsoTableGrid tbody tr", titleSelector: "td:nth-child(2) p:not(:has(strong))",
  linkSelector: "td:nth-child(3) a[href]", dateSelector: "td:nth-child(2) strong" };
const html = (date: string) => `<main><table class="MsoTableGrid"><tbody><tr><td>Fotoğraf</td><td><p><strong>${date}</strong></p><p>Kimya Mühendisliği öğrencilerinin teknik gezisi</p></td><td><a href="/tr/Birim/DuyuruDetay/teknIk_gezI_6883">Detay</a></td></tr></tbody></table></main>`;
const fence = (source: any) => ({ expectedSourceDefinitionVersion: source.sourceDefinitionVersion ?? "", expectedCanonicalUrl: source.canonicalUrl ?? source.sourceUrl,
  expectedTrustStatus: source.trustStatus, expectedSourceStatus: source.status, expectedApprovalPending: source.approvalPending === true });

afterEach(() => { setSafeOutboundRequestDependenciesForTesting(undefined); vi.restoreAllMocks(); vi.useRealTimers(); });

async function setup(parserConfig = selectors) {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T11:00:00.000Z"));
  const university = { id: "konya-teknik-universitesi", slug: "konya-teknik-universitesi", name: "Konya Teknik Üniversitesi", websiteUrl: "https://www.ktun.edu.tr/",
    status: "active", city: "Konya", type: "state", createdAt: new Date(), updatedAt: new Date() };
  const catalog = { findUniversityById: async (id: string) => id === university.id ? university : null,
    listUniversities: async () => [university], listFaculties: async () => [], listDepartments: async () => [] };
  const repository = new InMemoryAnnouncementRepository();
  const source = await repository.upsertSource({ scopeType: "university", scopeId: university.id, ownerUniversityId: university.id,
    sourceName: "Kimya Mühendisliği Haberler", sourceUrl: url, homepageUrl: university.websiteUrl, contentType: "news",
    parser: "html", parserConfig, priority: 40, status: "inactive", trustStatus: "quarantined" });
  const notifications = { retireTrustedAnnouncementSource: vi.fn(async () => undefined), syncTrustedAnnouncementSource: vi.fn(async () => undefined) };
  const service = new AnnouncementIngestionService(catalog as never, repository, notifications as never);
  const mobile = new AnnouncementsService({ findUserById: async () => ({ universityId: university.id }) } as never, repository, catalog as never);
  let body = html("09.10.2025");
  let redirect = "";
  setSafeOutboundRequestDependenciesForTesting({ resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    requestHop: async (_url, pinned) => ({ status: redirect ? 302 : 200, headers: redirect ? { location: redirect } : { "content-type": "text/html" },
      body: Buffer.from(body), remoteAddress: pinned.address }) });
  return { source, repository, service, mobile, notifications, setBody: (value: string) => { body = value; }, setRedirect: (value: string) => { redirect = value; } };
}

describe("verified stale source approval", () => {
  it("approves only the recipe with a warning, publishes no old items, and recovers on fresh content", async () => {
    const test = await setup();
    const result = await test.service.approveSourceForAdmin({ kind: "global" }, test.source.id, "admin", fence(test.source));
    expect(result.source).toMatchObject({ status: "active", trustStatus: "trusted", approvalPending: false, healthStatus: "degraded", itemCount: 0, lastError: "SOURCE_LISTING_STALE" });
    expect(await test.repository.listItemsForSource(test.source.id, 100)).toEqual([]);
    expect(test.notifications.syncTrustedAnnouncementSource).not.toHaveBeenCalled();
    expect((await test.mobile.getMySourceManifest("student")).sources).toEqual([]);
    expect(await test.service.probeSourceForDeviceManifestById(test.source.id)).toMatchObject({ status: "degraded", error: "SOURCE_LISTING_STALE" });
    for (let day = 15; day < 19; day++) {
      vi.setSystemTime(new Date(`2026-10-${day}T11:00:00.000Z`));
      expect(await test.service.ingestSource((await test.repository.findSourceById(test.source.id))!)).toMatchObject({ status: "degraded", error: "SOURCE_LISTING_STALE" });
    }
    expect(await test.repository.findSourceById(test.source.id)).toMatchObject({ status: "active", consecutiveFailures: 0 });
    test.setBody(html("18.10.2026"));
    expect(await test.service.ingestSource((await test.repository.findSourceById(test.source.id))!)).toMatchObject({ status: "healthy", itemCount: 1 });
    expect(await test.service.probeSourceForDeviceManifestById(test.source.id)).toMatchObject({ status: "healthy", itemCount: 1 });
    expect((await test.mobile.getMySourceManifest("student")).sources).toEqual([expect.objectContaining({ id: test.source.id, fetchAllowed: true })]);
  });

  it.each(["missing layout", "malformed selector", "empty page", "unsafe redirect"])("blocks %s instead of treating it as a stale warning", async (scenario) => {
    const test = await setup(scenario === "malformed selector" ? { ...selectors, itemSelector: "[[[" } : selectors);
    if (scenario === "missing layout") test.setBody("<main><div>Changed layout</div></main>");
    if (scenario === "empty page") test.setBody("<main></main>");
    if (scenario === "unsafe redirect") test.setRedirect("https://untrusted.example/news");
    await expect(test.service.approveSourceForAdmin({ kind: "global" }, test.source.id, "admin", fence(test.source))).rejects.toThrow();
    expect(await test.repository.findSourceById(test.source.id)).toMatchObject({ status: "inactive", trustStatus: "quarantined", approvalPending: false });
    expect(test.notifications.syncTrustedAnnouncementSource).not.toHaveBeenCalled();
  });

  it("retains CAS protection if health changes just before the warning approval commits", async () => {
    const test = await setup();
    const complete = test.repository.completeSourceApproval.bind(test.repository);
    vi.spyOn(test.repository, "completeSourceApproval").mockImplementation(async (id, definition, snapshot, checkedAt) => {
      await test.repository.recordSourceCheck(id, { healthStatus: "failed", lastError: "SOURCE_HTML_SELECTOR_LAYOUT_INVALID", lastCheckedAt: new Date(), consecutiveFailures: 1, itemCount: 0 }, definition, snapshot);
      return complete(id, definition, snapshot, checkedAt);
    });
    await expect(test.service.approveSourceForAdmin({ kind: "global" }, test.source.id, "admin", fence(test.source))).rejects.toMatchObject({ status: 409 });
    expect((await test.repository.findSourceById(test.source.id))?.approvalPending).toBe(true);
    expect(test.notifications.syncTrustedAnnouncementSource).not.toHaveBeenCalled();
  });
});
