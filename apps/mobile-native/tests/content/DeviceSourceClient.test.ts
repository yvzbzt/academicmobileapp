import { fetchDeviceContentSource } from "../../src/content/device-source-client";
import { readDeviceContentSourceManifest, type DeviceContentSource } from "../../src/content/device-source-manifest";
import { parseDeviceSourceDocument } from "../../src/content/device-source-parser";

const now = new Date("2026-09-14T12:00:00.000Z");

function source(overrides: Partial<DeviceContentSource> = {}): DeviceContentSource {
  return {
    id: "source-1",
    sourceName: "Example University announcements",
    sourceUrl: "https://example.edu.tr/announcements",
    allowedHostname: "example.edu.tr",
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
    schemaVersion: 1,
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
    { sources: [{ ...source(), contentRevision: "not-a-digest" }] },
    { sources: [{ ...source(), validUntil: "2026-09-14T11:59:59.000Z" }] },
    { sources: [source(), source()] },
  ])("rejects an unsafe or inconsistent recipe %#", (override) => {
    expect(readDeviceContentSourceManifest(manifest(override))).toBeNull();
  });
});

describe("device source parser", () => {
  it("uses configured selectors, permits the approved official domain and rejects other universities", () => {
    const records = parseDeviceSourceDocument(`
      <main>
        <article><h2>Registration dates announced</h2><a href="/announcements/registration">Open</a><time datetime="2026-09-12">12 Sep</time><p>Official registration details.</p></article>
        <article><h2>Next</h2><a href="/announcements?page=2">Next</a></article>
        <article><h2>Official PDF</h2><a href="https://files.example.edu.tr/docs/calendar.pdf">Open</a><time>Yayın tarihi: 14 Eylül 2026</time></article>
        <article><h2>External advert</h2><a href="https://evil.edu.tr/tracker">Open</a></article>
      </main>
    `, source({
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
    ["Yayın: 7/1/2027", "2027-01-07"],
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
  it("sends no credentials, rechecks the final URL and returns normalized records", async () => {
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.credentials).toBe("omit");
      expect(init?.headers).toEqual({
        Accept: "text/html,application/json,application/rss+xml,application/xml;q=0.9,text/plain;q=0.8",
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

  it("accepts a redirect within the backend-approved university domain", async () => {
    const collection = await fetchDeviceContentSource(source(), {
      fetchImpl: jest.fn(async () => response({
        url: "https://www.example.edu.tr/announcements",
        contentType: "text/html",
        body: "<main><article><a href='https://files.example.edu.tr/announcements/one.pdf'>Official PDF notice</a></article></main>",
      })) as unknown as typeof fetch,
      now,
    });

    expect(collection.items).toEqual([expect.objectContaining({
      canonicalUrl: "https://files.example.edu.tr/announcements/one.pdf",
    })]);
  });

  it.each([
    ["redirect_rejected", response({ url: "https://other.edu.tr/announcements", contentType: "text/html", body: "<a href='/one'>Valid title</a>" })],
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
});

function response(input: { url: string; contentType: string; body: string; contentLength?: string }): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url: input.url,
    headers: {
      get(name: string) {
        if (name.toLocaleLowerCase("en-US") === "content-type") return input.contentType;
        if (name.toLocaleLowerCase("en-US") === "content-length") return input.contentLength ?? null;
        return null;
      },
    },
    text: async () => input.body,
  } as unknown as Response;
}
