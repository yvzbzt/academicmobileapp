import { fetch as expoFetch } from "expo/fetch";
import { fetchDeviceContentSource } from "../../src/content/device-source-client";
import { readDeviceContentSourceManifest, type DeviceContentSource } from "../../src/content/device-source-manifest";
import { parseDeviceSourceDocument } from "../../src/content/device-source-parser";

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

const now = new Date("2026-09-14T12:00:00.000Z");

function source(overrides: Partial<DeviceContentSource> = {}): DeviceContentSource {
  return {
    id: "source-1",
    sourceName: "Example University announcements",
    sourceUrl: "https://example.edu.tr/announcements",
    allowedHostname: "example.edu.tr",
    allowedOfficialDomain: "example.edu.tr",
    fetchAllowed: true,
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    parser: "auto",
    definitionVersion: "definition-1",
    contentRevision: "a".repeat(64),
    checkedAt: "2026-09-14T11:00:00.000Z",
    validUntil: "2026-09-15T23:00:00.000Z",
    ...overrides,
  };
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    version: "b".repeat(64),
    refreshRequired: true,
    generatedAt: now.toISOString(),
    revalidateAfter: "2026-09-14T12:30:00.000Z",
    sources: [source()],
    ...overrides,
  };
}

describe("device content source manifest", () => {
  it("accepts a bounded backend-approved manifest", () => {
    expect(readDeviceContentSourceManifest(manifest())).toEqual(manifest());
  });

  it.each([
    { sources: [{ ...source(), sourceUrl: "http://example.edu.tr/announcements" }] },
    { sources: [{ ...source(), sourceUrl: "https://127.0.0.1/announcements", allowedHostname: "127.0.0.1" }] },
    { sources: [{ ...source(), allowedHostname: "other.edu.tr" }] },
    { sources: [{ ...source(), allowedOfficialDomain: "other.edu.tr" }] },
    { sources: [{ ...source(), contentRevision: "not-a-digest" }] },
    { sources: [{ ...source(), validUntil: "2026-09-14T11:59:59.000Z" }] },
    { sources: [source(), source()] },
  ])("rejects an unsafe or inconsistent recipe %#", (override) => {
    expect(readDeviceContentSourceManifest(manifest(override))).toBeNull();
  });

  it("accepts authoritative hierarchy and rejects a scope mismatch", () => {
    const hierarchical = source({
      scopeType: "department",
      scopeId: "department-1",
      universityId: "university-1",
      universityName: "Example University",
      facultyId: "faculty-1",
      facultyName: "Engineering Faculty",
      departmentId: "department-1",
      departmentName: "Computer Engineering",
    });
    expect(readDeviceContentSourceManifest(manifest({ sources: [hierarchical] }))?.sources[0]).toEqual(
      expect.objectContaining({
        universityName: "Example University",
        facultyName: "Engineering Faculty",
        departmentName: "Computer Engineering",
      }),
    );
    expect(readDeviceContentSourceManifest(manifest({
      sources: [{ ...hierarchical, departmentId: "department-2" }],
    }))).toBeNull();
  });
});

describe("device source parser", () => {
  it("preserves an approved event-date selector through the manifest without inventing publication metadata", () => {
    const approved = readDeviceContentSourceManifest(manifest({ sources: [source({
      sourceUrl: "https://example.edu.tr/events", contentType: "event", parser: "html",
      parserConfig: { itemSelector: "article", linkSelector: "a", eventDateSelector: ".event-date" },
    })] }))!.sources[0]!;
    expect(approved.parserConfig?.eventDateSelector).toBe(".event-date");
    const records = parseDeviceSourceDocument('<article><a href="/event/congress">Future research congress</a><span class="event-date">07 May 2027</span></article>', approved, now);
    expect(records).toHaveLength(1);
    expect(records[0]?.keyDates).toEqual([{ label: "Etkinlik tarihi", startDate: "2027-05-07" }]);
    expect(records[0]?.publicationKind).toBeUndefined();
    expect(records[0]?.publishedAt).toBeUndefined();
    expect(records[0]?.publishedDate).toBeUndefined();
    expect(readDeviceContentSourceManifest(manifest({ sources: [{ ...approved,
      parserConfig: { ...approved.parserConfig, eventDateSelector: "x".repeat(301) },
    }] }))).toBeNull();
  });

  it("uses configured selectors, permits the approved official domain and rejects other universities", () => {
    const records = parseDeviceSourceDocument(`
      <main>
        <article><h2>Registration dates announced</h2><a href="/announcements/registration">Open</a><time datetime="2026-09-12">12 Sep</time><p>Official registration details.</p></article>
        <article><h2>Next</h2><a href="/announcements?page=2">Next</a></article>
        <article><h2>Official PDF</h2><a href="https://files.example.edu.tr/docs/calendar.pdf">Open</a><time>Yayın tarihi: 14 Eylül 2026</time></article>
        <article><h2>Insecure PDF</h2><a href="http://files.example.edu.tr/docs/calendar.pdf">Open</a></article>
        <article><h2>External advert</h2><a href="https://evil.edu.tr/tracker">Open</a></article>
      </main>
    `, source({
      universityId: "university-1",
      universityName: "Example University",
      parser: "html",
      parserConfig: {
        itemSelector: "article",
        titleSelector: "h2",
        linkSelector: "a",
        dateSelector: "time",
        contentSelector: "p",
      },
    }), now);

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(expect.objectContaining({
      title: "Registration dates announced",
      canonicalUrl: "https://example.edu.tr/announcements/registration",
      publicationKind: "date",
      publishedDate: "2026-09-12",
      summary: "Official registration details.",
      universityId: "university-1",
      universityName: "Example University",
      trustStatus: "trusted",
      sourceStatus: "active",
      sourceTrustStatus: "trusted",
    }));
    expect(records[1]).toEqual(expect.objectContaining({
      title: "Official PDF",
      canonicalUrl: "https://files.example.edu.tr/docs/calendar.pdf",
      publicationKind: "date",
      publishedDate: "2026-09-14",
    }));
  });

  it.each([
    ["14.09.2026", "2026-09-14"],
    ["Yayın: 7/1/2027", undefined],
    ["31 Şubat 2026", undefined],
  ])("normalizes common Turkish listing dates (%s)", (dateText, publishedDate) => {
    const records = parseDeviceSourceDocument(
      `<article><h2>Academic notice</h2><a href='/notice'>Open</a><time>${dateText}</time></article>`,
      source({
        parser: "html",
        parserConfig: { itemSelector: "article", titleSelector: "h2", linkSelector: "a", dateSelector: "time" },
      }),
      now,
    );

    expect(records[0]?.publishedDate).toBe(publishedDate);
  });

  it("parses RSS and JSON without accepting a different host", () => {
    const rss = parseDeviceSourceDocument(`
      <rss><channel>
        <item><title>Scholarship applications</title><link>https://example.edu.tr/announcements/scholarship</link><pubDate>Sun, 13 Sep 2026 08:00:00 GMT</pubDate></item>
        <item><title>External</title><link>https://other.edu.tr/external</link></item>
      </channel></rss>
    `, source({ parser: "rss" }), now);
    const json = parseDeviceSourceDocument(JSON.stringify({ items: [{
      title: "Research event",
      url: "/events/research",
      publishedAt: "2026-09-13T09:00:00.000Z",
    }] }), source({ contentType: "event" }), now);

    expect(rss).toHaveLength(1);
    expect(rss[0]?.publishedAt).toBe("2026-09-13T08:00:00.000Z");
    expect(json).toEqual([expect.objectContaining({
      contentType: "event",
      canonicalUrl: "https://example.edu.tr/events/research",
    })]);
  });
});

describe("device source fetch boundary", () => {
  it("uses Expo's streaming fetch by default", async () => {
    const expoFetchMock = expoFetch as jest.MockedFunction<typeof expoFetch>;
    expoFetchMock.mockResolvedValueOnce(response({
      url: "https://example.edu.tr/announcements",
      contentType: "text/html; charset=utf-8",
      body: "<main><article><a href='/announcements/expo'>Expo transport announcement</a></article></main>",
    }) as never);

    const collection = await fetchDeviceContentSource(source(), { now });

    expect(expoFetchMock).toHaveBeenCalledWith(
      "https://example.edu.tr/announcements",
      expect.objectContaining({ redirect: "manual", credentials: "omit" }),
    );
    expect(collection.items[0]?.canonicalUrl).toBe("https://example.edu.tr/announcements/expo");
  });

  it("sends no credentials, rechecks the final URL and returns normalized records", async () => {
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("manual");
      expect(init?.headers).toEqual({
        Accept: "text/html,application/json,application/rss+xml,application/xml;q=0.9,text/plain;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.7,en;q=0.6",
        "User-Agent": "AcademicMobileContent/1.0",
      });
      expect(JSON.stringify(init)).not.toMatch(/authorization|bearer|cookie|device/iu);
      return response({
        url: "https://example.edu.tr/announcements",
        contentType: "text/html; charset=utf-8",
        body: "<main><article><a href='/announcements/one'>Enrollment announcement</a></article></main>",
      });
    });

    const collection = await fetchDeviceContentSource(source(), { fetchImpl: fetchImpl as typeof fetch, now });

    expect(collection.items).toEqual([expect.objectContaining({
      title: "Enrollment announcement",
      canonicalUrl: "https://example.edu.tr/announcements/one",
    })]);
  });

  it.each([
    ["2026-09-14T11:30:00.000Z", "2026-09-14T11:30:00.000Z"],
    ["2026-09-14T12:30:00.000Z", undefined],
  ])("evaluates publication %s against device fetch time without changing the source trust check", async (publishedAt, expectedPublication) => {
    const approvedSource = Object.freeze(source({ contentType: "news" }));
    const fetchImpl = jest.fn(async () => response({
      url: approvedSource.sourceUrl,
      contentType: "application/json",
      body: JSON.stringify({ items: [{
        title: "Recent university news",
        url: "/news/recent",
        publishedAt,
      }] }),
    }));

    const collection = await fetchDeviceContentSource(approvedSource, { fetchImpl: fetchImpl as typeof fetch, now });

    expect(collection.items).toHaveLength(1);
    expect(collection.items[0]?.publishedAt).toBe(expectedPublication);
    expect(collection.items[0]?.publicationKind).toBe(expectedPublication ? "timestamp" : undefined);
    expect(collection.items[0]?.fetchedAt).toBe(now.toISOString());
    expect(approvedSource.checkedAt).toBe("2026-09-14T11:00:00.000Z");
  });

  it("accepts a redirect within the backend-approved university domain", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input) === "https://example.edu.tr/announcements"
      ? response({
          url: "https://example.edu.tr/announcements",
          status: 302,
          location: "https://www.example.edu.tr/announcements",
          contentType: "text/html",
          body: "",
        })
      : response({
          url: "https://www.example.edu.tr/announcements",
          contentType: "text/html",
          body: "<main><article><a href='https://files.example.edu.tr/announcements/one.pdf'>Official PDF notice</a></article></main>",
        }));
    const collection = await fetchDeviceContentSource(source(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    });

    expect(collection.items).toEqual([expect.objectContaining({
      canonicalUrl: "https://files.example.edu.tr/announcements/one.pdf",
    })]);
    expect(fetchImpl.mock.calls.map(([target]) => String(target))).toEqual([
      "https://example.edu.tr/announcements",
      "https://www.example.edu.tr/announcements",
    ]);
  });

  it.each([
    "https://example.edu.tr/announcements/",
    "https://example.edu.tr/announcements/?z=1&a=first&a=second&utm_source=official",
  ])("preserves the exact safe redirect target %s instead of rewriting its request identity", async (destination) => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === source().sourceUrl) return response({
        url, status: 301, location: destination, contentType: "text/html", body: "",
      });
      if (url !== destination) throw new Error("REDIRECT_TARGET_WAS_REWRITTEN");
      return response({ url, contentType: "text/html",
        body: "<main><article><a href='/announcements/one'>Registration announcement</a></article></main>",
      });
    });

    const collection = await fetchDeviceContentSource(source(), { fetchImpl: fetchImpl as typeof fetch, now });

    expect(collection.items).toHaveLength(1);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([source().sourceUrl, destination]);
  });

  it.each([
    "https://example.edu.tr/announcements/",
    "https://example.edu.tr/announcements?utm_source=hidden-redirect",
  ])("rejects an automatically followed redirect even when %s has the same canonical identity", async (url) => {
    const fetchImpl = jest.fn(async () => response({ url, contentType: "text/html",
      body: "<main><article><a href='/announcements/one'>Registration announcement</a></article></main>",
    }));
    await expect(fetchDeviceContentSource(source(), { fetchImpl: fetchImpl as typeof fetch, now }))
      .rejects.toMatchObject({ code: "redirect_rejected" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("executes the shared ATU OData multi-hop recipe on device", async () => {
    const requested: string[] = [];
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      return response({
        url,
        contentType: "application/json",
        body: url.includes("/Siteler?")
          ? JSON.stringify({ d: [{ ID: 7 }] })
          : JSON.stringify({ d: [{ GuID: "official-guid", Baslik: "Student registration announcement" }] }),
      });
    });

    const collection = await fetchDeviceContentSource(source({
      sourceUrl: "https://www.atu.edu.tr/#!/TR/duyurular/",
      allowedHostname: "www.atu.edu.tr",
      allowedOfficialDomain: "atu.edu.tr",
    }), { fetchImpl: fetchImpl as unknown as typeof fetch, now });

    expect(requested).toHaveLength(2);
    expect(requested[0]).toContain("https://odata.atu.edu.tr/odata/DataService.svc/Siteler?");
    expect(requested[1]).toContain("https://odata.atu.edu.tr/odata/DataService.svc/V_GuncelIcerik?");
    expect(collection.items).toEqual([expect.objectContaining({
      title: "Student registration announcement",
      canonicalUrl: "https://www.atu.edu.tr/#!/duyuru/official-guid",
    })]);
  });

  it.each([
    "https://evil.edu.tr/stolen",
    "http://127.0.0.1/internal",
    "http://example.edu.tr/insecure",
    "https://user:password@example.edu.tr/credentials",
    "https://example.edu.tr:8443/unsupported-port",
  ])("rejects an unsafe redirect before issuing a request to %s", async (location) => {
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL) => response({
      url: "https://example.edu.tr/announcements",
      status: 302,
      location,
      contentType: "text/html",
      body: "",
    }));

    await expect(fetchDeviceContentSource(source(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    })).rejects.toMatchObject({ code: "redirect_rejected" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://example.edu.tr/announcements");
  });

  it("rejects an unbounded response before calling all-at-once text()", async () => {
    const fake = response({
      url: "https://example.edu.tr/announcements",
      contentType: "text/html",
      body: "x".repeat(101),
      omitContentLength: true,
    });
    const text = jest.fn(async () => "x".repeat(101));
    Object.assign(fake, { text, body: null });

    await expect(fetchDeviceContentSource(source(), {
      fetchImpl: jest.fn(async () => fake) as unknown as typeof fetch,
      now,
      maximumResponseBytes: 100,
    })).rejects.toMatchObject({ code: "response_too_large" });
    expect(text).not.toHaveBeenCalled();
  });

  it.each([
    ["redirect_rejected", response({ url: "https://other.edu.tr/announcements", contentType: "text/html", body: "<a href='/one'>Valid title</a>" })],
    ["redirect_rejected", response({ url: "http://example.edu.tr/announcements", contentType: "text/html", body: "<a href='/one'>Valid title</a>" })],
    ["media_type_rejected", response({ url: "https://example.edu.tr/announcements", contentType: "application/octet-stream", body: "binary" })],
    ["response_too_large", response({ url: "https://example.edu.tr/announcements", contentType: "text/html", body: "x".repeat(101), contentLength: "101" })],
  ])("fails closed with %s", async (code, fakeResponse) => {
    await expect(fetchDeviceContentSource(source(), {
      fetchImpl: jest.fn(async () => fakeResponse) as unknown as typeof fetch,
      now,
      maximumResponseBytes: 100,
    })).rejects.toMatchObject({ code });
  });

  it("does not call the network after the backend trust lease expires", async () => {
    const fetchImpl = jest.fn();
    await expect(fetchDeviceContentSource(source({ validUntil: "2026-09-14T11:59:59.000Z" }), {
      fetchImpl: fetchImpl as typeof fetch,
      now,
    })).rejects.toMatchObject({ code: "source_expired" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not call the network while the backend retains but blocks a degraded source", async () => {
    const fetchImpl = jest.fn();
    await expect(fetchDeviceContentSource(source({ fetchAllowed: false }), {
      fetchImpl: fetchImpl as typeof fetch,
      now,
    })).rejects.toMatchObject({ code: "source_expired" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function response(input: {
  url: string;
  contentType: string;
  body: string;
  contentLength?: string;
  location?: string;
  status?: number;
  omitContentLength?: boolean;
}): Response {
  const status = input.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    url: input.url,
    headers: {
      get(name: string) {
        if (name.toLocaleLowerCase("en-US") === "content-type") return input.contentType;
        if (name.toLocaleLowerCase("en-US") === "content-length") {
          return input.omitContentLength ? null : input.contentLength ?? String(new TextEncoder().encode(input.body).byteLength);
        }
        if (name.toLocaleLowerCase("en-US") === "location") return input.location ?? null;
        return null;
      },
    },
    text: async () => input.body,
  } as unknown as Response;
}
