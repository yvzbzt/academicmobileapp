import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress,
  type SafeOutboundHopResponse
} from "../src/common/network/safe-outbound-request.js";
import { CatalogService } from "../src/modules/catalog/catalog.service.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import {
  discoverAkuGsfCourseSchedules,
  discoverAkuSbfSchedules
} from "../src/modules/calendars/academic-unit-schedule-discovery.js";
import { AcademicSourceDiscoveryService } from "../src/modules/source-discovery/academic-source-discovery.service.js";

const publicAddress: ResolvedOutboundAddress = { address: "93.184.216.34", family: 4 };

afterEach(() => {
  setSafeOutboundRequestDependenciesForTesting(undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("academic source-discovery authority boundaries", () => {
  it("omits cross-owner catalog candidates even when they use a plausible edu.tr host", async () => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "");
    const repository = new InMemoryCatalogRepository();
    const catalog = new CatalogService(repository);
    const university = await catalog.createUniversity({
      name: "Abdullah Gul Universitesi Kayseri",
      city: "Kayseri",
      type: "state",
      websiteUrl: "https://agu.edu.tr",
      announcementUrl: "https://announcements.other.edu.tr/duyurular",
      academicCalendarUrl: "https://calendar.agu.edu.tr/2026-2027.pdf"
    });

    const result = await new AcademicSourceDiscoveryService(repository)
      .discoverSources({ universityId: university.id });

    expect(result.candidates.some((candidate) => candidate.url.includes("other.edu.tr"))).toBe(false);
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "homepage", url: "https://agu.edu.tr/" }),
      expect.objectContaining({ sourceType: "academic_calendar", url: "https://calendar.agu.edu.tr/2026-2027.pdf" })
    ]));
  });

  it("validates returned web-search URLs against the academic owner while keeping provider policy separate", async () => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "https://search.example/api/search");
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify([
        { url: "https://news.agu.edu.tr/duyurular", title: "Duyurular" },
        { url: "https://agu-login.attacker.edu.tr/duyurular", title: "Duyurular" }
      ])),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });
    const repository = new InMemoryCatalogRepository();
    const university = await new CatalogService(repository).createUniversity({
      name: "Abdullah Gul Universitesi Kayseri",
      city: "Kayseri",
      type: "state",
      websiteUrl: "https://agu.edu.tr"
    });

    const result = await new AcademicSourceDiscoveryService(repository)
      .discoverSources({ universityId: university.id });

    expect(requestHop).toHaveBeenCalledTimes(1);
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ discoveryMethod: "web_search", url: "https://news.agu.edu.tr/duyurular" })
    ]));
    expect(result.candidates.some((candidate) => candidate.url.includes("attacker.edu.tr"))).toBe(false);
  });

  it("does not issue an Ankara official-directory nested request to a cross-owner URL", async () => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "");
    const requestedUrls: string[] = [];
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop: async (url, pinnedAddress): Promise<SafeOutboundHopResponse> => {
        requestedUrls.push(url);
        return {
          status: 200,
          headers: { "content-type": "text/html" },
          body: Buffer.from('<a href="https://engineering.attacker.edu.tr/">Engineering Faculty</a>'),
          remoteAddress: pinnedAddress.address
        };
      }
    });
    const repository = new InMemoryCatalogRepository();
    const catalog = new CatalogService(repository);
    const university = await catalog.createUniversity({
      name: "Ankara Universitesi",
      city: "Ankara",
      type: "state",
      websiteUrl: "https://www.ankara.edu.tr"
    });
    await catalog.createFaculty({ universityId: university.id, name: "Engineering Faculty" });

    const result = await new AcademicSourceDiscoveryService(repository)
      .discoverSources({ universityId: university.id });

    expect(requestedUrls).toEqual([
      "https://www.ankara.edu.tr/akademik-ve-idari-birimler/Fakulteler"
    ]);
    expect(result.candidates.some((candidate) => candidate.url.includes("attacker.edu.tr"))).toBe(false);
  });

  it("filters cross-owner AKU schedule links before they become candidates", async () => {
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from('<a href="https://schedules.attacker.edu.tr/2026-2027-ders-programi.pdf">Ders Programi 2026-2027</a>'),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    const result = await discoverAkuGsfCourseSchedules({
      departmentPageUrls: ["https://gsf.aku.edu.tr/department/"],
      academicYear: "2026-2027",
      timeoutMs: 1_000
    });

    expect(result).toEqual([]);
    expect(requestHop).toHaveBeenCalledTimes(1);
    expect(requestHop.mock.calls[0]?.[0]).toBe("https://gsf.aku.edu.tr/department/");
  });

  it("rejects an AKU page redirect before requesting a cross-owner hop", async () => {
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "https://sbf.attacker.edu.tr/" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    await expect(discoverAkuSbfSchedules({
      academicYear: "2026-2027",
      timeoutMs: 1_000
    })).rejects.toMatchObject({
      name: "SourceAuthorityError",
      decision: { reasonCode: "redirect_domain_mismatch" }
    });
    expect(requestHop).toHaveBeenCalledTimes(1);
  });
});
