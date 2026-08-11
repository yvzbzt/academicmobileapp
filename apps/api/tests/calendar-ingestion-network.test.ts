import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress,
  type SafeOutboundHopResponse
} from "../src/common/network/safe-outbound-request.js";
import {
  discoverAtuAcademicCalendarPdf,
  discoverAcademicCalendarPdfFromHomepages,
  downloadPdf,
  fetchAtuCalendarRows
} from "../src/modules/calendars/calendar-ingestion.service.js";
import type { UniversityRecord } from "../src/modules/catalog/catalog.types.js";

const publicAddress: ResolvedOutboundAddress = { address: "93.184.216.34", family: 4 };
const university: UniversityRecord = {
  id: "university-1",
  name: "Example Üniversitesi",
  slug: "example-universitesi",
  city: "Ankara",
  type: "state",
  websiteUrl: "https://www.example.edu.tr",
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z")
};

afterEach(() => {
  setSafeOutboundRequestDependenciesForTesting(undefined);
});

describe("calendar PDF network trust", () => {
  it("downloads a PDF through the pinned safe transport and reports the validated final URL", async () => {
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => (
      url.endsWith("/calendar")
        ? {
            status: 302,
            headers: { location: "/files/academic-calendar.pdf" },
            body: Buffer.alloc(0),
            remoteAddress: pinnedAddress.address
          }
        : {
            status: 200,
            headers: { "content-type": "application/pdf" },
            body: Buffer.from("%PDF-1.7\nfixture"),
            remoteAddress: pinnedAddress.address
          }
    ));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    const result = await downloadPdf("https://example.edu.tr/calendar", 1_000);

    expect(result.finalUrl).toBe("https://example.edu.tr/files/academic-calendar.pdf");
    expect(result.fileName).toBe("academic-calendar.pdf");
    expect(result.magicBytesHex).toMatch(/^25504446/u);
    expect(requestHop).toHaveBeenCalledTimes(2);
  });

  it("rejects a PDF hostname resolving to a forbidden address before opening a socket", async () => {
    const requestHop = vi.fn();
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "169.254.169.254", family: 4 }],
      requestHop
    });

    await expect(downloadPdf("https://example.edu.tr/calendar.pdf", 1_000))
      .rejects.toThrow("OUTBOUND_DESTINATION_FORBIDDEN");
    expect(requestHop).not.toHaveBeenCalled();
  });

  it("keeps non-PDF responses quarantined after safe retrieval", async () => {
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop: async (_url, pinnedAddress) => ({
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from("<html>not a PDF</html>"),
        remoteAddress: pinnedAddress.address
      })
    });

    await expect(downloadPdf("https://example.edu.tr/calendar.pdf", 1_000))
      .rejects.toThrow("CALENDAR_SOURCE_IS_NOT_PDF");
  });

  it("does not trust a calendar PDF link on an unrelated domain discovered from an official page", async () => {
    const requestHop = vi.fn(async (_url: string, pinnedAddress: ResolvedOutboundAddress): Promise<SafeOutboundHopResponse> => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from('<a href="https://evil.example/akademik-takvim.pdf">Akademik Takvim</a>'),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    await expect(discoverAcademicCalendarPdfFromHomepages(
      university,
      ["https://www.example.edu.tr"],
      1_000,
      new Set(),
      () => true
    )).resolves.toBeNull();
    expect(requestHop).toHaveBeenCalled();
    expect(requestHop.mock.calls.every(([url]) => new URL(String(url)).hostname.endsWith("example.edu.tr"))).toBe(true);
  });

  it("rejects a PDF redirect that leaves the official university domain", async () => {
    const requestHop = vi.fn(async (_url: string, pinnedAddress: ResolvedOutboundAddress): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "https://evil.example/academic-calendar.pdf" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    await expect(downloadPdf("https://www.example.edu.tr/calendar.pdf", 1_000))
      .rejects.toThrow("CALENDAR_SOURCE_DOMAIN_UNTRUSTED");
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("retrieves ATU page discovery and OData JSON through the pinned safe transport", async () => {
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify(url.includes("AkademikTakvim")
        ? {
            d: [{
              ID: 1,
              AdTR: "Ders kayıtları",
              BaslamaTarihi: "/Date(1788210000000)/",
              Yil: 2026,
              Durum: 1
            }]
          }
        : {
            d: {
              HTMLicerik: '<a href="/Upload/2026-lisans.pdf">2026-2027 Ön Lisans - Lisans Akademik Takvimi</a>'
            }
          })),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    await expect(discoverAtuAcademicCalendarPdf("2026-2027", 1_000)).resolves.toEqual({
      sourceUrl: "https://www.atu.edu.tr/Upload/2026-lisans.pdf",
      title: "2026-2027 Ön Lisans - Lisans Akademik Takvimi"
    });
    await expect(fetchAtuCalendarRows(1_000)).resolves.toEqual([
      expect.objectContaining({ ID: 1, Yil: 2026 })
    ]);
    expect(requestHop).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["page discovery", () => discoverAtuAcademicCalendarPdf("2026-2027", 1_000)],
    ["OData fallback", () => fetchAtuCalendarRows(1_000)]
  ])("rejects forbidden DNS destinations for ATU %s", async (_label, request) => {
    const requestHop = vi.fn();
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
      requestHop
    });

    await expect(request()).rejects.toThrow("OUTBOUND_DESTINATION_FORBIDDEN");
    expect(requestHop).not.toHaveBeenCalled();
  });

  it.each([
    ["page discovery", () => discoverAtuAcademicCalendarPdf("2026-2027", 1_000)],
    ["OData fallback", () => fetchAtuCalendarRows(1_000)]
  ])("rejects a cross-domain redirect for ATU %s", async (_label, request) => {
    const requestHop = vi.fn(async (_url: string, pinnedAddress: ResolvedOutboundAddress): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "https://evil.example/atu-data.json" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    await expect(request()).rejects.toThrow("CALENDAR_SOURCE_DOMAIN_UNTRUSTED");
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid ATU JSON without exposing the response body", async () => {
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop: async (_url, pinnedAddress) => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from("not-json secret-provider-body"),
        remoteAddress: pinnedAddress.address
      })
    });

    const error = await fetchAtuCalendarRows(1_000).catch((reason: unknown) => reason);
    expect(String((error as Error).message)).toBe("ATU_CALENDAR_FETCH_FAILED:INVALID_JSON");
    expect(String((error as Error).message)).not.toContain("secret-provider-body");
  });
});
