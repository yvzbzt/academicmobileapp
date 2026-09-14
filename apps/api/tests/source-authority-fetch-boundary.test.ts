import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress,
  type SafeOutboundHopResponse
} from "../src/common/network/safe-outbound-request.js";
import * as authorityEnforcement from "../src/domain/source-authority-enforcement.js";
import type { SourceAuthorityContext } from "../src/domain/source-authority-enforcement.js";
import {
  ANNOUNCEMENT_DETAIL_CONCURRENCY,
  ANNOUNCEMENT_DETAIL_MAX_ITEMS,
  ANNOUNCEMENT_DETAIL_MAX_RESPONSE_BYTES,
  fetchSourceSnapshot,
  fetchText,
  hydrateGenericAnnouncementDetails
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
      finalUrl: "https://news.example.edu.tr/announcements/",
      fetchStatus: "fetched",
      contentHash: "bd02dd856212291f308b99f94a074ff0d5aa38584462a60b4f929b2d8a82de6a"
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

  it.each([
    {
      contentType: "news" as const,
      resource: "news" as const,
      endpoint: "GetMainNews",
      publicRoute: "haber",
      slug: "ogrenciler-icin-akademik-basari-haberi",
      title: "Öğrenciler İçin Akademik Başarı Haberi",
      publishedAt: "2026-09-13T10:15:00Z"
    },
    {
      contentType: "event" as const,
      resource: "event" as const,
      endpoint: "GetMainevents",
      publicRoute: "etkinlik",
      slug: "ogrenci-kariyer-bulusmasi",
      title: "Öğrenci Kariyer Buluşması",
      publishedAt: "2026-09-10T11:39:24.67Z"
    }
  ])("fetches Ankara University's official UBYS $contentType endpoint with its required origin", async ({
    contentType,
    resource,
    endpoint,
    publicRoute,
    slug,
    title,
    publishedAt
  }) => {
    const sourceUrl = `https://ubys.ankara.edu.tr/api/CMS/${endpoint}?Page=0&PageSize=20&websiteId=1&languageCode=tr-TR`;
    const ankaraAuthority: SourceAuthorityContext = {
      ...authority,
      ownerAcademicEntityId: "ankara-universitesi",
      ownerUniversityId: "ankara-universitesi",
      resolvedOwnerAcademicEntityId: "ankara-universitesi",
      resolvedOwnerUniversityId: "ankara-universitesi",
      scopeId: "ankara-universitesi",
      authorityDomains: ["ankara.edu.tr"]
    };
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: Buffer.from(JSON.stringify({
        items: [{
          baslik: title,
          aciklama: "Öğrenciler için resmi üniversite içeriği.",
          icerik: "<p>Güvenli ayrıntı metni.</p>",
          url: slug,
          publishDate: publishedAt,
          ...(contentType === "event" ? {
            eventDateTime: "2026-09-14T07:00:00Z",
            eventEndDateTime: "2026-09-18T14:30:00Z"
          } : {})
        }]
      })),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({ resolveHostname: async () => [publicAddress], requestHop });

    const snapshot = await fetchSourceSnapshot(
      sourceUrl,
      "auto",
      1_000,
      { authority: ankaraAuthority, resource },
      {},
      contentType
    );

    expect(snapshot.items).toEqual([expect.objectContaining({
      title,
      link: `https://www.ankara.edu.tr/${publicRoute}/${slug}`,
      publicationKind: "timestamp",
      publishedAt: new Date(publishedAt),
      summary: "Öğrenciler için resmi üniversite içeriği.",
      ...(contentType === "event" ? {
        keyDates: [{ label: "Etkinlik tarihi", startDate: "2026-09-14", endDate: "2026-09-18" }]
      } : {})
    })]);
    expect(requestHop).toHaveBeenCalledOnce();
    expect(requestHop).toHaveBeenCalledWith(
      expect.stringMatching(`^https://ubys\\.ankara\\.edu\\.tr/api/CMS/${endpoint}\\?`),
      publicAddress,
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
          Origin: "https://www.ankara.edu.tr"
        })
      })
    );
  });

  it.each([
    ["https://ubys.ankara.edu.tr/api/CMS/GetMainNews?Page=0&PageSize=20&websiteId=1&languageCode=tr-TR", "event"],
    ["https://ubys.ankara.edu.tr/api/CMS/GetMainNews?Page=0&PageSize=20&websiteId=2&languageCode=tr-TR", "news"],
    ["https://ubys.ankara.edu.tr/api/CMS/GetMainNewsPreview?Page=0&PageSize=20&websiteId=1&languageCode=tr-TR", "news"]
  ] as const)("rejects an Ankara UBYS source whose endpoint contract is not exact", async (sourceUrl, contentType) => {
    const requestHop = vi.fn();
    setSafeOutboundRequestDependenciesForTesting({ resolveHostname: async () => [publicAddress], requestHop });

    await expect(fetchSourceSnapshot(sourceUrl, "auto", 1_000, undefined, {}, contentType))
      .rejects.toThrow("ANKARA_CMS_SOURCE_INVALID");
    expect(requestHop).not.toHaveBeenCalled();
  });

  it("rejects a cross-owner UBYS redirect before issuing the redirected request", async () => {
    const sourceUrl = "https://ubys.ankara.edu.tr/api/CMS/GetMainNews?Page=0&PageSize=20&websiteId=1&languageCode=tr-TR";
    const ankaraAuthority: SourceAuthorityContext = {
      ...authority,
      ownerAcademicEntityId: "ankara-universitesi",
      ownerUniversityId: "ankara-universitesi",
      resolvedOwnerAcademicEntityId: "ankara-universitesi",
      resolvedOwnerUniversityId: "ankara-universitesi",
      scopeId: "ankara-universitesi",
      authorityDomains: ["ankara.edu.tr"]
    };
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "https://attacker.example/api/CMS/GetMainNews" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({ resolveHostname: async () => [publicAddress], requestHop });

    await expect(fetchSourceSnapshot(
      sourceUrl,
      "auto",
      1_000,
      { authority: ankaraAuthority, resource: "news" },
      {},
      "news"
    )).rejects.toMatchObject({
      name: "SourceAuthorityError",
      decision: { reasonCode: "redirect_domain_mismatch" }
    });
    expect(requestHop).toHaveBeenCalledOnce();
  });

  it.each([
    ["text/html", JSON.stringify({ items: [] }), "ANKARA_CMS_CONTENT_TYPE_INVALID"],
    ["application/json", JSON.stringify({
      items: [{
        baslik: "Güvenli görünen haber",
        aciklama: "Açıklama",
        icerik: "<p>İçerik</p>",
        url: "https://attacker.example/stolen",
        publishDate: "2026-09-13T10:15:00Z"
      }]
    }), "ANKARA_CMS_RESPONSE_INVALID"]
  ])("rejects an invalid Ankara UBYS response before publishing items", async (responseContentType, body, errorCode) => {
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 200,
      headers: { "content-type": responseContentType },
      body: Buffer.from(body),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({ resolveHostname: async () => [publicAddress], requestHop });

    await expect(fetchSourceSnapshot(
      "https://ubys.ankara.edu.tr/api/CMS/GetMainNews?Page=0&PageSize=20&websiteId=1&languageCode=tr-TR",
      "auto",
      1_000,
      undefined,
      {},
      "news"
    )).rejects.toThrow(errorCode);
  });

  it("hydrates only a bounded number of generic detail pages with bounded concurrency and response size", async () => {
    let activeDetails = 0;
    let maximumActiveDetails = 0;
    const detailRequests: string[] = [];
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress,
      input: { maximumResponseBytes: number }
    ): Promise<SafeOutboundHopResponse> => {
      if (url === "https://example.edu.tr/announcements") {
        return {
          status: 200,
          headers: { "content-type": "text/html" },
          body: Buffer.from(`<main class="announcement-listing">${Array.from({ length: 9 }, (_, index) => (
            `<article><a href="/announcements/${index + 1}">2026 Öğrenci kayıt duyurusu ${index + 1}</a></article>`
          )).join("")}</main>`),
          remoteAddress: pinnedAddress.address
        };
      }
      detailRequests.push(url);
      expect(input.maximumResponseBytes).toBe(ANNOUNCEMENT_DETAIL_MAX_RESPONSE_BYTES);
      activeDetails += 1;
      maximumActiveDetails = Math.max(maximumActiveDetails, activeDetails);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeDetails -= 1;
      const number = url.split("/").at(-1);
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: Buffer.from(`<html><body><article class="announcement-detail"><h1>2026 Kesin kayıt duyurusu ${number}</h1><p class="summary">Kayıt işlemleri açıldı.</p><h2>Son başvuru</h2><p>30 Eylül 2026</p></article></body></html>`),
        remoteAddress: pinnedAddress.address
      };
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    const snapshot = await fetchSourceSnapshot(
      "https://example.edu.tr/announcements",
      "html",
      1_000,
      { authority, resource: "announcement" }
    );

    expect(detailRequests).toHaveLength(ANNOUNCEMENT_DETAIL_MAX_ITEMS);
    expect(maximumActiveDetails).toBeLessThanOrEqual(ANNOUNCEMENT_DETAIL_CONCURRENCY);
    expect(snapshot.items).toHaveLength(9);
    expect(snapshot.items[0]).toMatchObject({
      title: "2026 Kesin kayıt duyurusu 1",
      summary: "Kayıt işlemleri açıldı.",
      body: expect.arrayContaining([
        { type: "heading", text: "Son başvuru" },
        { type: "paragraph", text: "30 Eylül 2026" }
      ]),
      keyDates: [{ label: "Son başvuru", startDate: "2026-09-30" }]
    });
    expect(snapshot.items[ANNOUNCEMENT_DETAIL_MAX_ITEMS]?.body).toBeUndefined();
  });

  it("keeps listing items when detail redirects cross authority or exceed the detail byte limit", async () => {
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => {
      if (url === "https://example.edu.tr/announcements") {
        return {
          status: 200,
          headers: { "content-type": "text/html" },
          body: Buffer.from(`<main class="announcement-listing">
            <article><a href="/announcements/good">2026 Öğrenci kayıt duyurusu iyi</a></article>
            <article><a href="/announcements/redirect">2026 Öğrenci kayıt duyurusu yönlendirme</a></article>
            <article><a href="/announcements/large">2026 Öğrenci kayıt duyurusu büyük</a></article>
          </main>`),
          remoteAddress: pinnedAddress.address
        };
      }
      if (url.endsWith("/redirect")) {
        return {
          status: 302,
          headers: { location: "https://attacker.edu.tr/announcements/stolen" },
          body: Buffer.alloc(0),
          remoteAddress: pinnedAddress.address
        };
      }
      if (url.endsWith("/large")) {
        return {
          status: 200,
          headers: { "content-type": "text/html" },
          body: Buffer.alloc(ANNOUNCEMENT_DETAIL_MAX_RESPONSE_BYTES + 1, 97),
          remoteAddress: pinnedAddress.address
        };
      }
      return {
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from("<article><h1>2026 Kesin kayıt duyurusu</h1><p>Güvenli ayrıntı içeriği.</p></article>"),
        remoteAddress: pinnedAddress.address
      };
    });
    setSafeOutboundRequestDependenciesForTesting({ resolveHostname: async () => [publicAddress], requestHop });

    const snapshot = await fetchSourceSnapshot(
      "https://example.edu.tr/announcements",
      "html",
      1_000,
      { authority, resource: "announcement" }
    );

    expect(snapshot.items).toHaveLength(3);
    expect(snapshot.items.find((item) => item.link.endsWith("/good"))?.body).toBeDefined();
    expect(snapshot.items.find((item) => item.link.endsWith("/redirect"))?.body).toBeUndefined();
    expect(snapshot.items.find((item) => item.link.endsWith("/large"))?.body).toBeUndefined();
    expect(requestHop.mock.calls.some(([url]) => String(url).includes("attacker.edu.tr"))).toBe(false);
  });

  it("does not request an unowned item URL and treats a detail timeout as an item-local failure", async () => {
    const requestHop = vi.fn(async (): Promise<SafeOutboundHopResponse> => new Promise(() => undefined));
    setSafeOutboundRequestDependenciesForTesting({ resolveHostname: async () => [publicAddress], requestHop });
    const listingItems = [{
      title: "2026 Öğrenci kayıt duyurusu",
      link: "https://example.edu.tr/announcements/slow"
    }, {
      title: "2026 Sahte öğrenci kayıt duyurusu",
      link: "https://attacker.edu.tr/announcements/stolen"
    }];

    await expect(hydrateGenericAnnouncementDetails(
      listingItems,
      "https://example.edu.tr/announcements",
      10,
      { authority, resource: "announcement" }
    )).resolves.toEqual(listingItems);
    expect(requestHop).toHaveBeenCalledTimes(1);
    expect(requestHop).toHaveBeenCalledWith(
      "https://example.edu.tr/announcements/slow",
      publicAddress,
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
  });
});
