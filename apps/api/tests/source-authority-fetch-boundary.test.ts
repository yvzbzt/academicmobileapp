import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress,
  type SafeOutboundHopResponse
} from "../src/common/network/safe-outbound-request.js";
import * as authorityEnforcement from "../src/domain/source-authority-enforcement.js";
import type { SourceAuthorityContext } from "../src/domain/source-authority-enforcement.js";
import {
  fetchSourceSnapshot,
  fetchText
} from "../src/modules/announcements/announcement-parser.js";

const publicAddress: ResolvedOutboundAddress = { address: "93.184.216.34", family: 4 };

const authority: SourceAuthorityContext = {
  ownerAcademicEntityId: "university-example",
  ownerUniversityId: "university-example",
  resolvedOwnerAcademicEntityId: "university-example",
  resolvedOwnerUniversityId: "university-example",
  scopeType: "university",
  scopeId: "university-example",
  authorityDomains: ["example.edu.tr"]
};

afterEach(() => {
  setSafeOutboundRequestDependenciesForTesting(undefined);
  vi.restoreAllMocks();
});

describe("announcement source-authority fetch boundary", () => {
  it("accepts an owner root and same-owner subdomain redirect and reports the final URL", async () => {
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => (
      url === "https://example.edu.tr/announcements"
        ? {
            status: 302,
            headers: { location: "https://news.example.edu.tr/announcements/" },
            body: Buffer.alloc(0),
            remoteAddress: pinnedAddress.address
          }
        : {
            status: 200,
            headers: { "content-type": "text/html" },
            body: Buffer.from("<html><main class=\"announcement-listing\">Duyuru bulunamadi.</main></html>"),
            remoteAddress: pinnedAddress.address
          }
    ));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });
    const requireAuthority = vi.spyOn(authorityEnforcement, "requireSourceAuthority");

    const snapshot = await fetchSourceSnapshot(
      "https://example.edu.tr/announcements",
      "html",
      1_000,
      { authority, resource: "announcement" }
    );

    expect(snapshot).toEqual({
      items: [],
      finalUrl: "https://news.example.edu.tr/announcements/"
    });
    expect(requestHop).toHaveBeenCalledTimes(2);
    expect(requireAuthority).toHaveBeenCalledTimes(2);
    expect(requireAuthority).toHaveBeenNthCalledWith(1, authority, {
      boundary: "fetch",
      resource: "announcement",
      url: "https://example.edu.tr/announcements"
    });
    expect(requireAuthority).toHaveBeenNthCalledWith(2, authority, {
      boundary: "fetch",
      resource: "announcement",
      url: "https://example.edu.tr/announcements",
      finalRedirectUrl: "https://news.example.edu.tr/announcements/"
    });
  });

  it("rejects a cross-owner redirect before issuing the redirected request", async () => {
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "https://attacker.edu.tr/announcements" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    await expect(fetchText("https://example.edu.tr/announcements", 1_000, {
      accept: "text/html",
      authority,
      resource: "announcement"
    })).rejects.toMatchObject({
      name: "SourceAuthorityError",
      decision: { reasonCode: "redirect_domain_mismatch" }
    });
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("allows a redirect across two explicitly evidenced domains of the same owner", async () => {
    const aliasAuthority: SourceAuthorityContext = {
      ...authority,
      authorityDomains: ["legacy.edu.tr", "current.edu.tr"]
    };
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => url.includes("legacy.edu.tr")
      ? {
          status: 302,
          headers: { location: "https://calendar.current.edu.tr/announcements" },
          body: Buffer.alloc(0),
          remoteAddress: pinnedAddress.address
        }
      : {
          status: 200,
          headers: { "content-type": "text/html" },
          body: Buffer.from("ok"),
          remoteAddress: pinnedAddress.address
        });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    const response = await fetchText("https://legacy.edu.tr/announcements", 1_000, {
      authority: aliasAuthority,
      resource: "announcement"
    });

    expect(response.finalUrl).toBe("https://calendar.current.edu.tr/announcements");
    expect(requestHop).toHaveBeenCalledTimes(2);
  });

  it("inherits the same authority context for ATU secondary OData requests", async () => {
    const atuAuthority: SourceAuthorityContext = {
      ...authority,
      ownerAcademicEntityId: "university-atu",
      ownerUniversityId: "university-atu",
      resolvedOwnerAcademicEntityId: "university-atu",
      resolvedOwnerUniversityId: "university-atu",
      scopeId: "university-atu",
      authorityDomains: ["atu.edu.tr"]
    };
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(url.includes("/Siteler?") ? '{"d":[{"ID":7}]}' : '{"d":[]}'),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });
    const requireAuthority = vi.spyOn(authorityEnforcement, "requireSourceAuthority");

    const snapshot = await fetchSourceSnapshot(
      "https://www.atu.edu.tr/#!/TR/duyurular/",
      "auto",
      1_000,
      { authority: atuAuthority, resource: "announcement" }
    );

    expect(snapshot.items).toEqual([]);
    expect(snapshot.finalUrl).toContain("https://odata.atu.edu.tr/odata/DataService.svc/V_GuncelIcerik?");
    expect(requestHop).toHaveBeenCalledTimes(2);
    expect(requireAuthority).toHaveBeenCalledTimes(2);
    for (const [, check] of requireAuthority.mock.calls) {
      expect(check).toEqual(expect.objectContaining({
        boundary: "fetch",
        resource: "announcement"
      }));
      expect(check.url).toMatch(/^https:\/\/odata\.atu\.edu\.tr\//u);
    }
  });
});
