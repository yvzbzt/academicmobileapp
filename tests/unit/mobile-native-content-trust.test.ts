import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalizeHttpUrl,
  canonicalizeOfficialAcademicUrl,
  contentTimestampLabel,
  decodeHtmlEntities,
  isNavigationContentTitle,
  normalizeDisplayText,
  normalizeTrustedContentCollection,
  normalizeTrustedContentEnvelope,
  type MobileContentRecordInput
} from "../../apps/mobile-native/src/content/content-trust";

describe("mobile native content trust", () => {
  it("decodes named, nested, decimal, and hexadecimal HTML entities", () => {
    expect(decodeHtmlEntities("A &raquo; B &amp; C&nbsp;&#286;&#x11E; &amp;raquo; D"))
      .toBe("A » B & C ĞĞ » D");
    expect(decodeHtmlEntities("Y&uuml;ksek &Ouml;ğretim ve &Scedil;ube &deg;&ensp;&unknown;"))
      .toBe("Yüksek Öğretim ve Şube °  ");
    expect(normalizeDisplayText("Burs &amp;amp;amp;amp;raquo; &deg; Duyurusu"))
      .toBe("Burs » ° Duyurusu");
    expect(normalizeDisplayText("<strong>Başvuru&nbsp;&amp; kayıt</strong>"))
      .toBe("Başvuru & kayıt");
  });

  it.each([
    "Sonraki",
    "Önceki",
    "Ana Sayfa",
    "Bağlı Kuruluşlar",
    "Geçmiş Duyurular",
    "Tüm Duyurular",
    "Devamını Oku",
    "Menu",
    "Menü",
    "Breadcrumb",
    "Sidebar",
    "Footer",
    "Yan Menü",
    "Alt Bilgi",
    "1 2 3 4",
    "6 of 10 --",
    "&raquo;"
  ])("recognizes navigation and non-content title %s", (title) => {
    expect(isNavigationContentTitle(title)).toBe(true);
  });

  it("removes a pagination prefix from a trusted compatibility record", () => {
    const result = normalizeTrustedContentCollection([
      {
        id: "pagination-prefix",
        sourceName: "Ankara Üniversitesi",
        title: "6 of 10 -- Burs Başvurusu",
        link: "https://www.ankara.edu.tr/duyurular/burs",
        officialSourceUrl: "https://www.ankara.edu.tr/duyurular"
      },
      {
        id: "academic-year",
        sourceName: "Ankara Üniversitesi",
        title: "2026/2027 Eğitim-Öğretim Yılı Duyurusu",
        link: "https://www.ankara.edu.tr/duyurular/akademik-yil",
        officialSourceUrl: "https://www.ankara.edu.tr/duyurular"
      }
    ]);

    expect(result.items).toHaveLength(2);
    expect(result.items.find((item) => item.id === "pagination-prefix")?.title).toBe("Burs Başvurusu");
    expect(result.items.find((item) => item.id === "academic-year")?.title)
      .toBe("2026/2027 Eğitim-Öğretim Yılı Duyurusu");
  });

  it("accepts only credential-free HTTP(S) URLs and produces a stable canonical URL", () => {
    expect(canonicalizeHttpUrl("HTTPS://EXAMPLE.EDU.TR:443/duyuru//kayit/?utm_source=x&b=2&a=1#footer"))
      .toBe("https://example.edu.tr/duyuru/kayit?a=1&b=2");
    expect(canonicalizeHttpUrl("https://example.edu.tr/#!/duyuru/123"))
      .toBe("https://example.edu.tr/#!/duyuru/123");
    expect(canonicalizeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeHttpUrl("data:text/html,test")).toBeNull();
    expect(canonicalizeHttpUrl("ftp://example.edu.tr/file")).toBeNull();
    expect(canonicalizeHttpUrl("https://user:secret@example.edu.tr/duyuru")).toBeNull();
    expect(canonicalizeHttpUrl("http://127.0.0.1/internal")).toBeNull();
    expect(canonicalizeHttpUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(canonicalizeHttpUrl("http://[::ffff:127.0.0.1]/internal")).toBeNull();
    expect(canonicalizeHttpUrl("http://[::ffff:7f00:1]/internal")).toBeNull();
    expect(canonicalizeHttpUrl("https://example.edu.tr:8443/duyuru")).toBeNull();
    expect(canonicalizeOfficialAcademicUrl("https://www.yok.gov.tr/duyurular"))
      .toBe("https://www.yok.gov.tr/duyurular");
    expect(canonicalizeOfficialAcademicUrl("https://example.com/duyuru")).toBeNull();
  });

  it("never labels discovery or crawl time as publication time", () => {
    expect(contentTimestampLabel({
      discoveredAt: "2026-07-29T08:00:00.000Z",
      fetchedAt: "2026-07-30T08:00:00.000Z"
    })).toBe("Yayın tarihi belirtilmemiş");
    expect(contentTimestampLabel({
      sourceUpdatedAt: "2026-07-30T08:00:00.000Z",
      fetchedAt: "2026-07-31T08:00:00.000Z"
    })).toMatch(/^Güncellendi /u);
    expect(contentTimestampLabel({
      publishedAt: "2026-07-28T08:00:00.000Z",
      sourceUpdatedAt: "2026-07-30T08:00:00.000Z"
    })).toMatch(/^Yayınlandı /u);
    expect(contentTimestampLabel({
      publishedAt: "not-a-timestamp",
      discoveredAt: "2026-07-29T08:00:00.000Z",
      fetchedAt: "2026-07-30T08:00:00.000Z"
    })).toBe("Yayın tarihi belirtilmemiş");
    expect(contentTimestampLabel({ publishedAt: "2026-02-30T08:00:00.000Z" }))
      .toBe("Yayın tarihi belirtilmemiş");
    expect(contentTimestampLabel({ publishedAt: "07/08/2026" }))
      .toBe("Yayın tarihi belirtilmemiş");
    expect(contentTimestampLabel({ publishedAt: "0" }))
      .toBe("Yayın tarihi belirtilmemiş");
    expect(contentTimestampLabel({ publishedAt: "0000-01-01T00:00:00.000Z" }))
      .toBe("Yayın tarihi belirtilmemiş");
  });

  it("filters unsafe, rejected, quarantined, and navigation records and deduplicates canonical URLs", () => {
    const records: MobileContentRecordInput[] = [
      record({
        id: "trusted-stale",
        title: "Kayıt &amp; başvuru duyurusu",
        link: "https://example.edu.tr/duyuru/kayit/?utm_source=feed",
        freshness: "stale"
      }),
      record({
        id: "trusted-fresh",
        title: "Kayıt ve başvuru duyurusu",
        link: "https://EXAMPLE.edu.tr/duyuru/kayit#content",
        officialSourceUrl: "https://www.example.edu.tr/duyurular",
        freshness: "fresh"
      }),
      record({ id: "navigation", title: "Geçmiş Duyurular", link: "https://example.edu.tr/gecmis-duyurular" }),
      record({ id: "missing-link", link: "" }),
      record({ id: "unsafe", link: "javascript:alert(1)" }),
      record({ id: "unofficial", link: "https://example.com/duyuru" }),
      record({ id: "unsafe-official-source", officialSourceUrl: "data:text/html,test" }),
      record({
        id: "mismatched-official-source",
        link: "https://example.edu.tr/duyuru/2",
        officialSourceUrl: "https://www.yok.gov.tr/duyurular"
      }),
      record({ id: "rejected", trustStatus: "rejected" }),
      record({ id: "quarantined", trustStatus: "quarantined" })
    ];

    const collection = normalizeTrustedContentCollection(records);

    expect(collection.items).toHaveLength(1);
    expect(collection.items[0]).toEqual(expect.objectContaining({
      id: "trusted-fresh",
      title: "Kayıt ve başvuru duyurusu",
      canonicalUrl: "https://example.edu.tr/duyuru/kayit",
      trustStatus: "trusted"
    }));
    expect(collection.duplicateCount).toBe(1);
    expect(collection.omittedCount).toBe(8);
    expect(collection.state).toBe("partial");
  });

  it("normalizes display fields without truncating a long Turkish title and preserves source scope", () => {
    const title = "2026–2027 eğitim öğretim yılı lisansüstü öğrenci başvuru ve kayıt takvimi hakkında önemli duyuru";
    const collection = normalizeTrustedContentCollection([
      record({
        title: `<strong>${title}&nbsp;&amp; ayrıntılar</strong>`,
        sourceName: "Örnek&nbsp;&amp; Üniversitesi",
        summary: "<p>Başvurular&nbsp;çevrim içi alınacaktır.</p>",
        scopeType: "department",
        scopeId: "department-42"
      })
    ]);

    expect(collection.items[0]).toEqual(expect.objectContaining({
      title: `${title} & ayrıntılar`,
      sourceName: "Örnek & Üniversitesi",
      summary: "Başvurular çevrim içi alınacaktır.",
      scopeType: "department",
      scopeId: "department-42"
    }));
  });

  it("distinguishes stale collections from mixed partial collections", () => {
    const stale = normalizeTrustedContentCollection([
      record({ id: "stale-1", link: "https://example.edu.tr/duyuru/1", freshness: "stale" }),
      record({ id: "stale-2", link: "https://example.edu.tr/duyuru/2", freshness: "stale" })
    ]);
    const partial = normalizeTrustedContentCollection([
      record({ id: "fresh", link: "https://example.edu.tr/duyuru/3", freshness: "fresh" }),
      record({ id: "stale", link: "https://example.edu.tr/duyuru/4", freshness: "stale" })
    ]);

    expect(stale.state).toBe("stale");
    expect(partial.state).toBe("partial");
  });

  it("selects the canonical duplicate with the latest authoritative source change", () => {
    const collection = normalizeTrustedContentCollection([
      record({
        id: "newer-publication",
        link: "https://example.edu.tr/duyuru/duzeltme",
        publishedAt: "2026-07-25T08:00:00.000Z",
        sourceUpdatedAt: "2026-07-26T08:00:00.000Z"
      }),
      record({
        id: "newer-correction",
        link: "https://WWW.EXAMPLE.edu.tr/duyuru/duzeltme#content",
        publishedAt: "2026-07-20T08:00:00.000Z",
        sourceUpdatedAt: "2026-07-30T08:00:00.000Z"
      })
    ]);

    expect(collection.items).toHaveLength(1);
    expect(collection.items[0]?.id).toBe("newer-correction");
    expect(collection.duplicateCount).toBe(1);
  });

  it("preserves case-sensitive path and query semantics when detecting duplicates", () => {
    const collection = normalizeTrustedContentCollection([
      record({ id: "upper", link: "https://example.edu.tr/Duyuru/FileA?Key=Value" }),
      record({ id: "lower", link: "https://www.example.edu.tr/duyuru/filea?Key=value" })
    ]);

    expect(collection.items.map((item) => item.id)).toEqual(["upper", "lower"]);
    expect(collection.duplicateCount).toBe(0);
  });

  it("preserves an API-reported source failure even when that source has no item", () => {
    const collection = normalizeTrustedContentEnvelope({
      items: [record()],
      state: "partial",
      sourceCount: 2,
      failedSourceCount: 1
    });
    const emptyFailedCollection = normalizeTrustedContentEnvelope({
      items: [],
      state: "partial",
      sourceCount: 1,
      failedSourceCount: 1
    });

    expect(collection.state).toBe("partial");
    expect(emptyFailedCollection).toEqual(expect.objectContaining({ items: [], state: "partial" }));
  });
});

describe("mobile native content-state wiring", () => {
  const appSource = readFileSync(new URL("../../apps/mobile-native/App.tsx", import.meta.url), "utf8");

  it("refreshes both Summer payload ownership sources and does not render URL-less no-op pressables", () => {
    const refreshHandler = appSource.slice(
      appSource.indexOf("async function refreshSummerSchool"),
      appSource.indexOf("async function loadPreferences")
    );

    expect(refreshHandler).toContain("loadMyCalendar(undefined, ownerSnapshot, true)");
    expect(refreshHandler).toContain("loadSummerSchool(undefined, undefined, ownerSnapshot, true)");
    expect(appSource).not.toContain("item.sourceUrl ? void openAnnouncement(item.sourceUrl) : undefined");
    expect(appSource).not.toContain("option.sourceUrl ? void openAnnouncement(option.sourceUrl) : undefined");
    expect(appSource.match(/Resmî bağlantı mevcut değil\./gu)).toHaveLength(2);
    expect(appSource).toContain("payload.announcementStatus?.failedSourceCount");
  });

  it("retains prior verified data after refresh errors and suppresses conflicting error/empty states", () => {
    const loadableHandler = appSource.slice(
      appSource.indexOf("async function withLoadable"),
      appSource.indexOf("async function bootstrapAuthenticatedContext")
    );

    expect(loadableHandler).toContain("preserveDataOnRefresh && previous.data !== undefined");
    expect(loadableHandler).toContain("data: previous.data, error: message");
    expect(loadableHandler).toContain("stale: true");
    expect(appSource).toContain("const contentFeedAttempted = Boolean(");
    expect(appSource).toContain("announcements.attempted");
    expect(appSource).toContain("yokAnnouncements.attempted");
    expect(appSource).toContain("summerSchool.attempted");
    expect(appSource).toContain("attempted={contentFeedAttempted}");
    expect(appSource).toContain("refreshing={contentFeedLoading && contentFeedHasRetainedData}");
    expect(appSource).toContain("`/announcements/my/trusted?limit=${limitOverride}`");
    expect(appSource).toContain("`/announcements/yok/trusted?limit=${limitOverride}`");
    expect(appSource).toContain("const nextLimit = nextContentFeedLimit(contentFeedLimit)");
    expect(appSource).toContain("contentFeedRequestCoordinatorRef.current.beginRefresh()");
    expect(appSource).toContain("contentFeedRequestCoordinatorRef.current.beginPagination()");
    expect(appSource).toContain("contentFeedRequestCoordinatorRef.current.isCurrent(requestLease)");
    expect(appSource).toContain("contentFeedRequestCoordinatorRef.current.captureGeneration()");
    expect(appSource).toContain("contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)");
    expect(appSource.match(/settleContentFeedLoading\(previous\)/gu)).toHaveLength(3);
    expect(appSource).toContain("isOperationCurrent: () => boolean = () => true");
    expect(appSource).toContain("onPress={() => void refreshContentFeed()}");
    expect(appSource).toContain("Promise.allSettled([loadMyCalendar(), loadUpcoming(), refreshContentFeed()])");
    expect(appSource).not.toContain("onPress={() => void loadYokAnnouncements()}");
    expect(appSource).toContain("Mevcut doğrulanmış kayıtlar korunuyor.");
    expect(appSource).toContain("normalizeTrustedContentEnvelope");
  });

  it("binds protected announcement detail routes to the requested trusted identifier", () => {
    const protectedDetailHandler = appSource.slice(
      appSource.indexOf("function loadProtectedAnnouncementDetail"),
      appSource.indexOf("function openProtectedAppRoute")
    );

    expect(protectedDetailHandler).toContain("++announcementDetailRequestGenerationRef.current");
    expect(protectedDetailHandler).toContain("item.record.id === announcementId");
    expect(protectedDetailHandler).toContain("/announcements/my/trusted/${encodeURIComponent(announcementId)}");
    expect(protectedDetailHandler).toContain(".find((item) => item.id === announcementId)");
    expect(protectedDetailHandler).toContain("requestGeneration !== announcementDetailRequestGenerationRef.current");
    expect(appSource).toContain("activeTrustedDetail.id === announcementDetailLoad.id");
    expect(appSource.match(/invalidateContentFeedOwnership\(\);/gu)).toHaveLength(3);
  });

  it("revalidates official HTTP(S) links at handoff and contains Linking failures", () => {
    const openHandler = appSource.slice(
      appSource.indexOf("async function openAnnouncement"),
      appSource.indexOf("function renderAnnouncementCard")
    );

    expect(openHandler).toContain("canonicalizeOfficialAcademicUrl(link)");
    expect(openHandler).toContain("try {");
    expect(openHandler).toContain("await Linking.canOpenURL(safeLink)");
    expect(openHandler).toContain("await Linking.openURL(safeLink)");
    expect(openHandler).toContain("} catch {");
  });
});

function record(overrides: Partial<MobileContentRecordInput> = {}): MobileContentRecordInput {
  return {
    id: "content-1",
    sourceId: "source-1",
    sourceName: "Örnek &amp; Üniversitesi",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    title: "Öğrenci kayıt duyurusu",
    link: "https://example.edu.tr/duyuru/1",
    ...overrides
  };
}
