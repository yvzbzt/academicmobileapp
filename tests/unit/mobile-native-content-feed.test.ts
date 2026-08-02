import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTENT_FEED_INITIAL_LIMIT,
  CONTENT_FEED_LIMITS,
  CONTENT_FEED_MAX_LIMIT,
  CONTENT_FEED_SEARCH_DEBOUNCE_MS,
  buildContentFeed,
  createContentFeedRequestCoordinator,
  filterContentFeed,
  foldContentFeedSearchText,
  hasActiveContentFeedFilters,
  inferContentFeedHasMore,
  nextContentFeedLimit,
  resolveContentFeedLayout,
  resolveContentFeedState,
  settleContentFeedLoading,
  type ContentFeedBuildInput,
  type ContentFeedStateInput,
} from "../../apps/mobile-native/src/announcements/feed-model";
import {
  normalizeTrustedContentCollection,
  type MobileContentRecordInput,
  type TrustedMobileContentRecord,
} from "../../apps/mobile-native/src/content/content-trust";

describe("Phase 8 trusted academic content feed", () => {
  it("renders only explicitly trusted, attributed records with matching safe official URLs", () => {
    const valid = record();
    const candidates: TrustedMobileContentRecord[] = [
      valid,
      record({ id: " ", canonicalUrl: "https://example.edu.tr/duyuru/no-id", link: "https://example.edu.tr/duyuru/no-id" }),
      record({ id: "no-source-id", sourceId: "", canonicalUrl: "https://example.edu.tr/duyuru/no-source-id", link: "https://example.edu.tr/duyuru/no-source-id" }),
      record({ id: "no-source-name", sourceName: "\u200b", canonicalUrl: "https://example.edu.tr/duyuru/no-source-name", link: "https://example.edu.tr/duyuru/no-source-name" }),
      record({ id: "no-scope", scopeId: "\t", canonicalUrl: "https://example.edu.tr/duyuru/no-scope", link: "https://example.edu.tr/duyuru/no-scope" }),
      record({ id: "missing-official", officialSourceUrl: undefined, canonicalUrl: "https://example.edu.tr/duyuru/missing-official", link: "https://example.edu.tr/duyuru/missing-official" }),
      record({ id: "wrong-authority", officialSourceUrl: "https://other.edu.tr", canonicalUrl: "https://example.edu.tr/duyuru/wrong-authority", link: "https://example.edu.tr/duyuru/wrong-authority" }),
      record({ id: "unsafe-canonical", canonicalUrl: "javascript:alert(1)", link: "javascript:alert(1)" }),
      record({ id: "unsafe-link", canonicalUrl: "https://example.edu.tr/duyuru/unsafe-link", link: "https://127.0.0.1/unsafe-link" }),
      { ...record({ id: "not-explicit", canonicalUrl: "https://example.edu.tr/duyuru/not-explicit", link: "https://example.edu.tr/duyuru/not-explicit" }), trustStatus: undefined } as unknown as TrustedMobileContentRecord,
      { ...record({ id: "quarantined", canonicalUrl: "https://example.edu.tr/duyuru/quarantined", link: "https://example.edu.tr/duyuru/quarantined" }), trustStatus: "quarantined" } as unknown as TrustedMobileContentRecord,
    ];

    const items = buildContentFeed(feedInput({ academic: candidates }));

    expect(items).toHaveLength(1);
    expect(items.map((item) => item.record.id)).toEqual(["content-1"]);
    expect(items[0]?.record.trustStatus).toBe("trusted");
  });

  it("rejects a source-less record even when the Phase 2 compatibility normalizer supplied its generic fallback", () => {
    const normalized = normalizeTrustedContentCollection([
      rawRecord({ sourceName: "", officialSourceUrl: "https://example.edu.tr" }),
    ]);

    expect(normalized.items[0]?.sourceName).toBe("Resmî kaynak");
    expect(buildContentFeed(feedInput({ academic: normalized.items }))).toEqual([]);
  });

  it("accepts only the sanitized normalized form so raw HTML and entities cannot reach a feed row", () => {
    const normalized = normalizeTrustedContentCollection([
      rawRecord({
        sourceName: "Örnek&nbsp;Üniversitesi",
        title: "<strong>Uzun dönem öğrenci başvuru duyurusu &amp; kayıt ayrıntıları</strong>",
        summary: "<p>Başvurular çevrim içi alınacaktır.</p>",
        officialSourceUrl: "https://example.edu.tr",
      }),
    ]);
    const rawTrusted = record({
      id: "raw-markup",
      canonicalUrl: "https://example.edu.tr/duyuru/raw",
      link: "https://example.edu.tr/duyuru/raw",
      title: "<b>Ham başlık</b>",
    });

    const items = buildContentFeed(feedInput({ academic: [...normalized.items, rawTrusted] }));

    expect(items).toHaveLength(1);
    expect(items[0]?.record).toEqual(expect.objectContaining({
      sourceName: "Örnek Üniversitesi",
      title: "Uzun dönem öğrenci başvuru duyurusu & kayıt ayrıntıları",
      summary: "Başvurular çevrim içi alınacaktır.",
    }));
  });

  it("accepts a canonical item URL and official source URL on matching institutional subdomains", () => {
    const items = buildContentFeed(feedInput({
      academic: [record({
        canonicalUrl: "https://duyuru.example.edu.tr/ogrenci/kayit",
        link: "https://duyuru.example.edu.tr/ogrenci/kayit",
        officialSourceUrl: "https://www.example.edu.tr/",
      })],
    }));

    expect(items).toHaveLength(1);
    expect(items[0]?.record.id).toBe("content-1");
  });

  it("deduplicates equivalent canonical URLs and retains every deterministic source family", () => {
    const academic = record({
      id: "academic-copy",
      canonicalUrl: "https://www.example.edu.tr/ortak/ilan",
      link: "https://www.example.edu.tr/ortak/ilan",
      publishedAt: "2026-07-29T09:00:00.000Z",
    });
    const yok = record({
      id: "yok-copy",
      canonicalUrl: "https://example.edu.tr/ortak/ilan",
      link: "https://example.edu.tr/ortak/ilan",
      publishedAt: "2026-07-30T09:00:00.000Z",
    });
    const summer = record({
      id: "summer-copy",
      canonicalUrl: "https://example.edu.tr/ortak/ilan",
      link: "https://example.edu.tr/ortak/ilan",
      publishedAt: "2026-07-28T09:00:00.000Z",
    });

    const items = buildContentFeed({ academic: [academic], yok: [yok], summerSchool: [summer] });

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      key: "feed:example.edu.tr/ortak/ilan",
      sourceFamilies: ["university", "yok", "summer-school"],
    }));
    expect(items[0]?.record.id).toBe("yok-copy");
  });

  it("uses canonical identity for stable unique keys when distinct records repeat the same API id", () => {
    const firstInput = feedInput({
      academic: [
        record({ canonicalUrl: "https://example.edu.tr/duyuru/a", link: "https://example.edu.tr/duyuru/a" }),
        record({ canonicalUrl: "https://example.edu.tr/duyuru/b", link: "https://example.edu.tr/duyuru/b" }),
      ],
    });
    const secondInput = feedInput({ academic: [...firstInput.academic].reverse() });

    const firstKeys = buildContentFeed(firstInput).map((item) => item.key);
    const secondKeys = buildContentFeed(secondInput).map((item) => item.key);

    expect(new Set(firstKeys).size).toBe(2);
    expect(firstKeys).toEqual(["feed:example.edu.tr/duyuru/a", "feed:example.edu.tr/duyuru/b"]);
    expect(secondKeys).toEqual(firstKeys);
  });

  it("orders newest first by publication time with source update as the truthful fallback", () => {
    const items = buildContentFeed(feedInput({
      academic: [
        record({ id: "published-new", canonicalUrl: "https://example.edu.tr/1", link: "https://example.edu.tr/1", publishedAt: "2026-07-31T08:00:00.000Z", sourceUpdatedAt: "2026-07-31T10:00:00.000Z" }),
        record({ id: "updated-only", canonicalUrl: "https://example.edu.tr/2", link: "https://example.edu.tr/2", sourceUpdatedAt: "2026-07-30T12:00:00.000Z" }),
        record({ id: "published-old", canonicalUrl: "https://example.edu.tr/3", link: "https://example.edu.tr/3", publishedAt: "2026-07-29T08:00:00.000Z" }),
        record({ id: "undated", canonicalUrl: "https://example.edu.tr/4", link: "https://example.edu.tr/4" }),
      ],
    }));

    expect(items.map((item) => item.record.id)).toEqual([
      "published-new",
      "updated-only",
      "published-old",
      "undated",
    ]);
    expect(items.map(({ displayTimestampKind }) => displayTimestampKind)).toEqual([
      "published",
      "updated",
      "published",
      null,
    ]);
    expect(items[1]?.displayTimestamp).toBe("2026-07-30T12:00:00.000Z");
  });

  it("never uses discovery or fetch timestamps for display, ordering, or duplicate selection", () => {
    const items = buildContentFeed(feedInput({
      academic: [
        record({ id: "a", canonicalUrl: "https://example.edu.tr/a", link: "https://example.edu.tr/a", discoveredAt: "2099-01-01T00:00:00.000Z", fetchedAt: "2099-01-01T00:00:00.000Z" }),
        record({ id: "b", canonicalUrl: "https://example.edu.tr/b", link: "https://example.edu.tr/b", discoveredAt: "2020-01-01T00:00:00.000Z", fetchedAt: "2020-01-01T00:00:00.000Z" }),
      ],
      yok: [
        record({ id: "lexically-later", canonicalUrl: "https://example.edu.tr/duplicate", link: "https://example.edu.tr/duplicate", discoveredAt: "2099-01-01T00:00:00.000Z" }),
        record({ id: "lexically-earlier", canonicalUrl: "https://www.example.edu.tr/duplicate", link: "https://www.example.edu.tr/duplicate", discoveredAt: "2020-01-01T00:00:00.000Z" }),
      ],
    }));

    expect(items.slice(0, 2).map((item) => item.record.id)).toEqual(["a", "b"]);
    expect(items.every((item) => item.displayTimestamp === null)).toBe(true);
    expect(items.find((item) => item.key.endsWith("/duplicate"))?.record.id).toBe("lexically-earlier");
  });
});

describe("Phase 8 feed search and filters", () => {
  const items = buildContentFeed({
    academic: [
      record({
        id: "registration",
        title: "ÖĞRENCİ kayıt başvurusu",
        summary: "Çevrim içi işlemler başladı",
        sourceName: "İstanbul Üniversitesi",
        canonicalUrl: "https://istanbul.edu.tr/duyuru/kayit",
        link: "https://istanbul.edu.tr/duyuru/kayit",
        officialSourceUrl: "https://istanbul.edu.tr/",
        scopeType: "department",
        contentType: "announcement",
      }),
      record({
        id: "faculty-news",
        title: "Araştırma haberi",
        sourceName: "Mühendislik Fakültesi",
        canonicalUrl: "https://example.edu.tr/haber/arastirma",
        link: "https://example.edu.tr/haber/arastirma",
        scopeType: "faculty",
        contentType: "news",
      }),
    ],
    yok: [record({
      id: "yok-event",
      title: "Yükseköğretim etkinliği",
      sourceName: "YÖK",
      canonicalUrl: "https://yok.gov.tr/etkinlik/1",
      link: "https://yok.gov.tr/etkinlik/1",
      officialSourceUrl: "https://yok.gov.tr/",
      contentType: "event",
    })],
    summerSchool: [record({
      id: "summer-news",
      title: "Yaz okulu kontenjanları",
      canonicalUrl: "https://example.edu.tr/yaz-okulu/kontenjan",
      link: "https://example.edu.tr/yaz-okulu/kontenjan",
      contentType: "news",
    })],
  });

  it("folds Turkish characters and searches title, summary, and official source without word-order coupling", () => {
    expect(foldContentFeedSearchText("I İ ı i ŞĞÜÖÇ")).toBe("i i i i sguoc");
    expect(search(items, "ogrenci kayit").map((item) => item.record.id)).toEqual(["registration"]);
    expect(search(items, "cevrim basladi").map((item) => item.record.id)).toEqual(["registration"]);
    expect(search(items, "universitesi istanbul").map((item) => item.record.id)).toEqual(["registration"]);
  });

  it("applies deterministic content and source filters, including YÖK and Summer School", () => {
    expect(filterContentFeed(items, { contentType: "news", source: "faculty", query: "" })
      .map((item) => item.record.id)).toEqual(["faculty-news"]);
    expect(filterContentFeed(items, { contentType: "event", source: "yok", query: "" })
      .map((item) => item.record.id)).toEqual(["yok-event"]);
    expect(filterContentFeed(items, { contentType: "news", source: "summer-school", query: "yaz" })
      .map((item) => item.record.id)).toEqual(["summer-news"]);
    expect(filterContentFeed(items, { contentType: "announcement", source: "university", query: "" })).toEqual([]);
    expect(items).toHaveLength(4);
  });

  it("detects a real query or selected filter without retaining raw search text", () => {
    expect(hasActiveContentFeedFilters({ contentType: "all", source: "all", query: "  " })).toBe(false);
    expect(hasActiveContentFeedFilters({ contentType: "news", source: "all", query: "" })).toBe(true);
    expect(hasActiveContentFeedFilters({ contentType: "all", source: "yok", query: "" })).toBe(true);
    expect(hasActiveContentFeedFilters({ contentType: "all", source: "all", query: "öğrenci" })).toBe(true);
    expect(CONTENT_FEED_SEARCH_DEBOUNCE_MS).toBe(300);
  });
});

describe("Phase 8 exclusive feed states", () => {
  const base: ContentFeedStateInput = {
    loading: false,
    attempted: true,
    totalItemCount: 1,
    visibleItemCount: 1,
    hasActiveFilters: false,
  };

  it.each([
    ["initial loading", { ...base, attempted: false, totalItemCount: 0, visibleItemCount: 0, loading: true }, "initial_loading"],
    ["background refresh", { ...base, loading: true }, "background_refresh"],
    ["populated", base, "populated"],
    ["genuine empty", { ...base, totalItemCount: 0, visibleItemCount: 0 }, "empty"],
    ["filtered no-results", { ...base, visibleItemCount: 0, hasActiveFilters: true }, "no_results"],
    ["stale", { ...base, stale: true }, "stale"],
    ["partial", { ...base, collectionState: "partial" as const }, "partial"],
    ["offline", { ...base, offline: true }, "offline"],
    ["recoverable error", { ...base, totalItemCount: 0, visibleItemCount: 0, error: "temporary" }, "recoverable_error"],
    ["pagination loading", { ...base, paginationLoading: true }, "pagination_loading"],
    ["pagination failure", { ...base, paginationError: "temporary" }, "pagination_failure"],
  ])("resolves %s as one state", (_label, input, expected) => {
    expect(resolveContentFeedState(input)).toBe(expected);
  });

  it("retains useful records after refresh failure and never resolves error or empty over them", () => {
    expect(resolveContentFeedState({ ...base, error: "refresh failed" })).toBe("stale");
    expect(resolveContentFeedState({
      ...base,
      error: "one source failed",
      collectionState: "partial",
    })).toBe("partial");
    expect(resolveContentFeedState({ ...base, loading: true, error: "old failure" })).toBe("background_refresh");
    expect(resolveContentFeedState({ ...base, visibleItemCount: 0, hasActiveFilters: true, error: "refresh failed" }))
      .toBe("no_results");
  });

  it("keeps offline and initial error surfaces exclusive from genuine empty", () => {
    const noItems = { ...base, totalItemCount: 0, visibleItemCount: 0 };
    expect(resolveContentFeedState({ ...noItems, offline: true, error: "network" })).toBe("offline");
    expect(resolveContentFeedState({ ...noItems, attempted: false })).toBe("initial_loading");
    expect(resolveContentFeedState({ ...noItems, collectionState: "partial" })).toBe("partial");
    expect(resolveContentFeedState(noItems)).toBe("empty");
  });
});

describe("Phase 8 controlled incremental loading and responsive policy", () => {
  it("serializes pagination and invalidates a late page when refresh wins", () => {
    const requests = createContentFeedRequestCoordinator();
    const firstPage = requests.beginPagination();
    expect(firstPage).not.toBeNull();
    expect(requests.beginPagination()).toBeNull();

    const refresh = requests.beginRefresh();
    expect(refresh).not.toBeNull();
    expect(requests.isCurrent(firstPage!)).toBe(false);
    expect(requests.beginPagination()).toBeNull();

    requests.finish(firstPage!);
    expect(requests.isCurrent(refresh!)).toBe(true);
    requests.finish(refresh!);
    expect(requests.beginPagination()).not.toBeNull();
  });

  it("invalidates both request kinds when account or academic ownership resets", () => {
    const requests = createContentFeedRequestCoordinator();
    const pagination = requests.beginPagination()!;
    requests.reset();
    expect(requests.isCurrent(pagination)).toBe(false);
    const refresh = requests.beginRefresh()!;
    requests.reset();
    expect(requests.isCurrent(refresh)).toBe(false);
  });

  it("settles every retained source and rejects late responses when scope resets during refresh", () => {
    const requests = createContentFeedRequestCoordinator();
    const refresh = requests.beginRefresh()!;
    const refreshGeneration = requests.captureGeneration();
    const retainedSources = [
      { loading: true, data: ["academic"], attempted: true, stale: false },
      { loading: true, data: ["yok"], attempted: true, stale: true },
      { loading: true, data: ["summer"], attempted: true, error: "prior warning" },
    ];

    requests.reset();

    expect(requests.isCurrent(refresh)).toBe(false);
    expect(requests.isGenerationCurrent(refreshGeneration)).toBe(false);
    expect(retainedSources.map(settleContentFeedLoading)).toEqual([
      { loading: false, data: ["academic"], attempted: true, stale: false },
      { loading: false, data: ["yok"], attempted: true, stale: true },
      { loading: false, data: ["summer"], attempted: true, error: "prior warning" },
    ]);
  });

  it("escalates 20 at a time and stops at the API ceiling of 100", () => {
    expect(CONTENT_FEED_LIMITS).toEqual([20, 40, 60, 80, 100]);
    expect(CONTENT_FEED_INITIAL_LIMIT).toBe(20);
    expect(CONTENT_FEED_MAX_LIMIT).toBe(100);
    expect([0, 20, 40, 60, 80, 100].map(nextContentFeedLimit)).toEqual([20, 40, 60, 80, 100, 100]);
  });

  it("infers more only from a full response below the hard ceiling", () => {
    expect(inferContentFeedHasMore({ requestedLimit: 20, receivedCount: 20 })).toBe(true);
    expect(inferContentFeedHasMore({ requestedLimit: 40, receivedCount: 55 })).toBe(true);
    expect(inferContentFeedHasMore({ requestedLimit: 60, receivedCount: 59 })).toBe(false);
    expect(inferContentFeedHasMore({ requestedLimit: 100, receivedCount: 100 })).toBe(false);
    expect(inferContentFeedHasMore({ requestedLimit: 0, receivedCount: 100 })).toBe(false);
  });

  it("stays single-column and unclipped at 320 dp and 200% font scale", () => {
    expect(resolveContentFeedLayout(320, 2)).toEqual({
      gutter: 16,
      maxWidth: 720,
      columns: 1,
      minTouchTarget: 48,
      filterGroupsStacked: true,
      supportsLargeText: true,
      allowsHorizontalClipping: false,
    });
    expect(resolveContentFeedLayout(430, 1)).toEqual(expect.objectContaining({
      gutter: 20,
      columns: 1,
      filterGroupsStacked: false,
      allowsHorizontalClipping: false,
    }));
  });

  it("contains no invented social-network vocabulary or operational-ordering helper", () => {
    const source = readFileSync(
      new URL("../../apps/mobile-native/src/announcements/feed-model.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\b(?:likes?|comments?|reposts?|connections?)\b/iu);
    expect(source).not.toMatch(/(?:beğeni|yorum|yeniden\s+paylaş|bağlantı\s+sayısı)/iu);
    expect(source).not.toContain("contentOperationalTimestamp");
  });
});

function search(items: ReturnType<typeof buildContentFeed>, query: string) {
  return filterContentFeed(items, { contentType: "all", source: "all", query });
}

function feedInput(overrides: Partial<ContentFeedBuildInput> = {}): ContentFeedBuildInput {
  return {
    academic: [],
    yok: [],
    summerSchool: [],
    ...overrides,
  };
}

function record(overrides: Partial<TrustedMobileContentRecord> = {}): TrustedMobileContentRecord {
  return {
    id: "content-1",
    sourceId: "source-1",
    sourceName: "Örnek Üniversitesi",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    title: "Öğrenci kayıt duyurusu",
    summary: "Başvuru ayrıntıları",
    link: "https://example.edu.tr/duyuru/1",
    canonicalUrl: "https://example.edu.tr/duyuru/1",
    officialSourceUrl: "https://example.edu.tr/",
    trustStatus: "trusted",
    ...overrides,
  };
}

function rawRecord(overrides: Partial<MobileContentRecordInput> = {}): MobileContentRecordInput {
  return {
    id: "content-1",
    sourceId: "source-1",
    sourceName: "Örnek Üniversitesi",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    title: "Öğrenci kayıt duyurusu",
    link: "https://example.edu.tr/duyuru/1",
    trustStatus: "trusted",
    ...overrides,
  };
}
