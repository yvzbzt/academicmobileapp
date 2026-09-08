import { readFileSync } from "node:fs";
import { functionSource } from "../../apps/mobile-native/tests/helpers/source-inspection";
import { describe, expect, it } from "vitest";
import {
  canonicalizeHttpUrl,
  canonicalizeOfficialAcademicUrl,
  contentTimestampLabel,
  decodeHtmlEntities,
  isNavigationContentTitle,
  logicalContentIdentityKey,
  normalizeDisplayText,
  normalizeTrustedApiContentEnvelope,
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
      record({
        id: "pagination-prefix",
        sourceName: "Ankara Üniversitesi",
        title: "6 of 10 -- Burs Başvurusu",
        link: "https://www.ankara.edu.tr/duyurular/burs",
        officialSourceUrl: "https://www.ankara.edu.tr/duyurular"
      }),
      record({
        id: "academic-year",
        sourceName: "Ankara Üniversitesi",
        title: "2026/2027 Eğitim-Öğretim Yılı Duyurusu",
        link: "https://www.ankara.edu.tr/duyurular/akademik-yil",
        officialSourceUrl: "https://www.ankara.edu.tr/duyurular"
      })
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

  it("preserves a complete trusted academic hierarchy", () => {
    const collection = normalizeTrustedApiContentEnvelope({
      items: [scopedRecord("academic-hierarchy", {
        scopeType: "department",
        scopeId: "department-42",
        universityId: "university-1",
        universityName: "Example University",
        facultyId: "faculty-7",
        facultyName: "Engineering Faculty",
        departmentId: "department-42",
        departmentName: "Computer Engineering Department"
      })]
    });

    expect(collection.items).toHaveLength(1);
    expect(collection.items[0]).toEqual(expect.objectContaining({
      universityId: "university-1",
      universityName: "Example University",
      facultyId: "faculty-7",
      facultyName: "Engineering Faculty",
      departmentId: "department-42",
      departmentName: "Computer Engineering Department"
    }));
  });

  it("rejects every partial academic hierarchy id-name pair", () => {
    const collection = normalizeTrustedApiContentEnvelope({
      items: [
        scopedRecord("university-id-only", { universityId: "university-1" }),
        scopedRecord("university-name-only", { universityName: "Example University" }),
        scopedRecord("faculty-id-only", {
          universityId: "university-1",
          universityName: "Example University",
          facultyId: "faculty-7"
        }),
        scopedRecord("faculty-name-only", {
          universityId: "university-1",
          universityName: "Example University",
          facultyName: "Engineering Faculty"
        }),
        scopedRecord("department-id-only", {
          universityId: "university-1",
          universityName: "Example University",
          facultyId: "faculty-7",
          facultyName: "Engineering Faculty",
          departmentId: "department-42"
        }),
        scopedRecord("department-name-only", {
          universityId: "university-1",
          universityName: "Example University",
          facultyId: "faculty-7",
          facultyName: "Engineering Faculty",
          departmentName: "Computer Engineering Department"
        })
      ]
    });

    expect(collection.items).toEqual([]);
    expect(collection.omittedCount).toBe(6);
    expect(collection.state).toBe("partial");
  });

  it("rejects hierarchy ids that do not match the record scope id", () => {
    const hierarchy = {
      universityId: "university-1",
      universityName: "Example University",
      facultyId: "faculty-7",
      facultyName: "Engineering Faculty",
      departmentId: "department-42",
      departmentName: "Computer Engineering Department"
    };
    const collection = normalizeTrustedApiContentEnvelope({
      items: [
        scopedRecord("university-scope-mismatch", {
          ...hierarchy,
          scopeType: "university",
          scopeId: "other-university"
        }),
        scopedRecord("faculty-scope-mismatch", {
          ...hierarchy,
          scopeType: "faculty",
          scopeId: "other-faculty"
        }),
        scopedRecord("department-scope-mismatch", {
          ...hierarchy,
          scopeType: "department",
          scopeId: "other-department"
        })
      ]
    });

    expect(collection.items).toEqual([]);
    expect(collection.omittedCount).toBe(3);
    expect(collection.state).toBe("partial");
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

  it("uses one strict trust predicate for item, active source, attribution, scope, and official authority", () => {
    const crossScope = scopedRecord("cross-scope");
    const candidates = [
      scopedRecord("valid"),
      scopedRecord("missing-official", { officialSourceUrl: undefined }),
      scopedRecord("generic-source", { sourceName: "Resmî akademik kaynak" }),
      scopedRecord("missing-source-id", { sourceId: "" }),
      scopedRecord("inactive-source", { sourceStatus: "inactive" }),
      scopedRecord("rejected-source", { sourceTrustStatus: "rejected" }),
      scopedRecord("rejected-item", { trustStatus: "rejected" }),
      scopedRecord("quarantined-item", { trustStatus: "quarantined" }),
      scopedRecord("wrong-authority", { officialSourceUrl: "https://www.yok.gov.tr" }),
      scopedRecord("unsafe-url", { link: "http://127.0.0.1/private", canonicalUrl: "http://127.0.0.1/private" }),
      {
        ...crossScope,
        sourceRelationships: [{
          sourceId: crossScope.sourceId,
          sourceName: crossScope.sourceName,
          officialSourceUrl: crossScope.officialSourceUrl!,
          scopeType: "faculty" as const,
          scopeId: "faculty-other",
          canonicalUrl: crossScope.canonicalUrl ?? crossScope.link
        }]
      }
    ];

    const collection = normalizeTrustedContentCollection(candidates);

    expect(collection.items.map((item) => item.id)).toEqual(["valid"]);
    expect(collection.omittedCount).toBe(10);
  });

  it("admits production-shaped university, faculty, department, YÖK, and Summer sources", () => {
    const positives = [
      scopedRecord("university"),
      scopedRecord("faculty", { sourceId: "faculty-source", sourceName: "Mühendislik Fakültesi", scopeType: "faculty", scopeId: "faculty-1" }),
      scopedRecord("department", { sourceId: "department-source", sourceName: "Bilgisayar Mühendisliği Bölümü", scopeType: "department", scopeId: "department-1" }),
      scopedRecord("yok", {
        sourceId: "yok-source",
        sourceName: "Yükseköğretim Kurulu",
        link: "https://www.yok.gov.tr/duyurular/yok",
        canonicalUrl: "https://www.yok.gov.tr/duyurular/yok",
        officialSourceUrl: "https://www.yok.gov.tr/duyurular"
      }),
      scopedRecord("summer", { sourceId: "summer-source", sourceName: "Örnek Üniversitesi Yaz Okulu" })
    ];

    expect(normalizeTrustedContentCollection(positives).items.map((item) => item.id))
      .toEqual(["university", "faculty", "department", "yok", "summer"]);
  });

  it("keeps stored ids separate from collision-safe source-and-scope logical identity", () => {
    const fingerprint = "a".repeat(64);
    const sameIdentity = normalizeTrustedContentCollection([
      scopedRecord("stored-a", { contentFingerprint: fingerprint, link: "https://example.edu.tr/duyuru/a", canonicalUrl: "https://example.edu.tr/duyuru/a" }),
      scopedRecord("stored-b", { contentFingerprint: fingerprint, link: "https://www.example.edu.tr/duyuru/b", canonicalUrl: "https://www.example.edu.tr/duyuru/b" })
    ]);
    const distinct = normalizeTrustedContentCollection([
      scopedRecord("source-a", { contentFingerprint: fingerprint }),
      scopedRecord("source-b", { sourceId: "source-2", contentFingerprint: fingerprint }),
      scopedRecord("scope-b", { scopeType: "faculty", scopeId: "faculty-1", contentFingerprint: fingerprint }),
      scopedRecord("fingerprint-b", { contentFingerprint: "b".repeat(64) })
    ]);
    const legacy = normalizeTrustedContentCollection([
      scopedRecord("legacy-a", { contentFingerprint: "MALFORMED", link: "https://example.edu.tr/duyuru/legacy?utm_source=a", canonicalUrl: "https://example.edu.tr/duyuru/legacy?utm_source=a" }),
      scopedRecord("legacy-b", { link: "https://www.example.edu.tr/duyuru/legacy", canonicalUrl: "https://www.example.edu.tr/duyuru/legacy" })
    ]);

    expect(sameIdentity.items).toHaveLength(1);
    expect(sameIdentity.duplicateCount).toBe(1);
    expect(distinct.items).toHaveLength(4);
    expect(legacy.items).toHaveLength(1);
    expect(logicalContentIdentityKey(scopedRecord("tuple", { sourceId: "a\u0000b", scopeId: "c" })))
      .toBeNull();
    expect(logicalContentIdentityKey(scopedRecord("tuple-safe", { sourceId: "a", scopeId: "b\u0000c" })))
      .toBeNull();
  });

  it("preserves raw pagination evidence before filtering or deduplication", () => {
    const rawItems = Array.from({ length: 20 }, (_, index) => scopedRecord(`raw-${index}`, {
      ...(index >= 12 ? { trustStatus: "rejected" as const } : {}),
      ...(index < 12 ? { sourceId: `source-${index}` } : {})
    }));
    const envelope = normalizeTrustedApiContentEnvelope({
      items: rawItems,
      rawCount: 20,
      hasMore: true,
      nextCursor: "page-2"
    });

    expect(envelope.items).toHaveLength(12);
    expect(envelope.rawItemCount).toBe(20);
    expect(envelope.explicitRawCount).toBe(20);
    expect(envelope.hasMore).toBe(true);
    expect(envelope.nextCursor).toBe("page-2");
  });

  it("revalidates optional rich body and structured key dates from the trusted API", () => {
    const envelope = normalizeTrustedApiContentEnvelope({
      items: [scopedRecord("rich", {
        body: [
          { type: "paragraph", text: "<script>çıkar</script><strong>Takvim güncellendi.</strong>" },
          { type: "bullet", text: "Sınav yerinizi kontrol edin." },
        ],
        keyDates: [
          { label: "Final Sınavları", startDate: "2026-06-23", endDate: "2026-07-04" },
          { label: "Geçersiz", startDate: "2026-02-31" },
        ],
      })],
    });

    expect(envelope.items[0]?.body).toEqual([
      { type: "paragraph", text: "Takvim güncellendi." },
      { type: "bullet", text: "Sınav yerinizi kontrol edin." },
    ]);
    expect(envelope.items[0]?.keyDates).toEqual([
      { label: "Final Sınavları", startDate: "2026-06-23", endDate: "2026-07-04" },
    ]);
  });
});

describe("mobile native content-state wiring", () => {
  const contentSource = applicationModule("actions/content-actions.ts");
  const contentNavigationSource = applicationModule("actions/content-navigation-actions.ts");
  const derivedSource = applicationModule("useApplicationDerivedState.ts");
  const screensSource = applicationModule("screens/content-screens.tsx");

  it("refreshes both Summer payload ownership sources and does not render URL-less no-op pressables", () => {
    const refreshHandler = functionSource(contentSource, "refreshSummerSchool");
    const destinationScreens = readFileSync(new URL("../../apps/mobile-native/src/announcements/SourceDestinationScreens.tsx", import.meta.url), "utf8");

    expect(refreshHandler).toContain("loadMyCalendar(undefined, ownerSnapshot, true)");
    expect(refreshHandler).toContain("loadSummerSchool(undefined, undefined, ownerSnapshot, true)");
    expect(screensSource).toContain("<SummerSchoolScreen");
    expect(destinationScreens).not.toContain("item.sourceUrl ? void openAnnouncement(item.sourceUrl) : undefined");
    expect(destinationScreens).not.toContain("option.sourceUrl ? void openAnnouncement(option.sourceUrl) : undefined");
    expect(destinationScreens.match(/Resmî bağlantı mevcut değil\./gu)).toHaveLength(2);
    expect(destinationScreens).toContain('onPress={item.requirement.sourceUrl ? () => void onOpenOfficialSource(item.requirement.sourceUrl!) : undefined}');
    expect(destinationScreens).toContain('onPress={item.option.sourceUrl ? () => void onOpenOfficialSource(item.option.sourceUrl!) : undefined}');
    expect(applicationModule("app-content.ts")).toContain("payload.announcementStatus?.failedSourceCount");
  });

  it("retains prior verified data after refresh errors and suppresses conflicting error/empty states", () => {
    const loadableHandler = functionSource(applicationModule("actions/api-actions.ts"), "withLoadable");

    expect(loadableHandler).toContain("preserveDataOnRefresh && previous.data !== undefined");
    expect(loadableHandler).toContain("data: previous.data, error: message");
    expect(loadableHandler).toContain("stale: true");
    expect(derivedSource).toContain("const contentFeedAttempted = Boolean(");
    expect(derivedSource).toContain("announcements.attempted");
    expect(applicationModule("useApplicationEffects.ts")).toContain("yokAnnouncements.attempted");
    expect(applicationModule("useApplicationEffects.ts")).toContain("summerSchool.attempted");
    expect(screensSource).toContain("attempted={contentFeedAttempted}");
    expect(screensSource).toContain("refreshing={contentFeedLoading && contentFeedHasRetainedData}");
    expect(contentSource).toContain("`/announcements/my/trusted?limit=${limitOverride}`");
    expect(contentSource).toContain("`/announcements/yok/trusted?limit=${limitOverride}`");
    expect(contentSource).toContain("const nextLimit = nextContentFeedLimit(contentFeedLimit)");
    expect(contentSource).toContain("contentFeedRequestCoordinatorRef.current.beginRefresh()");
    expect(contentSource).toContain("contentFeedRequestCoordinatorRef.current.beginPagination()");
    expect(contentSource).toContain("contentFeedRequestCoordinatorRef.current.isCurrent(requestLease)");
    expect(contentSource).toContain("contentFeedRequestCoordinatorRef.current.captureGeneration()");
    expect(contentSource).toContain("contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)");
    expect(functionSource(contentNavigationSource, "invalidateContentFeedOwnership").match(/settleContentFeedLoading\(previous\)/gu)).toHaveLength(3);
    expect(loadableHandler).toContain("isOperationCurrent: () => boolean = () => true");
    expect(screensSource).toContain("onRefresh={() => void refreshContentFeed()}");
    expect(screensSource).toContain("Promise.allSettled([loadMyCalendar(), loadCourseSchedule(), loadUpcoming(), refreshContentFeed()])");
    expect(screensSource).not.toContain("onPress={() => void loadYokAnnouncements()}");
    expect(contentSource).toContain("Mevcut doğrulanmış kayıtlar korunuyor.");
    expect(contentSource).toContain("normalizeTrustedApiContentEnvelope");
  });

  it("binds protected announcement detail routes to the requested trusted identifier", () => {
    const protectedDetailHandler = functionSource(contentNavigationSource, "loadProtectedAnnouncementDetail");

    expect(protectedDetailHandler).toContain("++announcementDetailRequestGenerationRef.current");
    expect(protectedDetailHandler).toContain("item.record.id === announcementId");
    expect(protectedDetailHandler).toContain("/announcements/my/trusted/${encodeURIComponent(announcementId)}");
    expect(protectedDetailHandler).toContain(".find((item) => item.id === announcementId)");
    expect(protectedDetailHandler).toContain("requestGeneration !== announcementDetailRequestGenerationRef.current");
    expect(screensSource).toContain("activeTrustedDetail.id === announcementDetailLoad.id");
    const invalidationCallSites = ["selectUniversity", "selectFaculty", "selectDepartment", "toggleFollowedUniversity"];
    const catalogSource = applicationModule("actions/catalog-actions.ts");
    for (const action of invalidationCallSites) {
      expect(functionSource(catalogSource, action).match(/invalidateContentFeedOwnership\(\);/gu)).toHaveLength(1);
    }
  });

  it("revalidates official HTTP(S) links at handoff and contains Linking failures", () => {
    const openHandler = functionSource(contentNavigationSource, "openAnnouncement");

    expect(openHandler).toContain("canonicalizeOfficialAcademicUrl(link)");
    expect(openHandler).toContain("try {");
    expect(openHandler).toContain("await Linking.canOpenURL(safeLink)");
    expect(openHandler).toContain("await Linking.openURL(safeLink)");
    expect(openHandler).toContain("} catch {");
  });
});

function applicationModule(relativePath: string): string {
  return readFileSync(new URL(`../../apps/mobile-native/src/app/${relativePath}`, import.meta.url), "utf8").replace(/\r\n?/gu, "\n");
}

function record(overrides: Partial<MobileContentRecordInput> = {}): MobileContentRecordInput {
  const candidate: MobileContentRecordInput = {
    id: "content-1",
    sourceId: "source-1",
    sourceName: "Örnek &amp; Üniversitesi",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    title: "Öğrenci kayıt duyurusu",
    link: "https://example.edu.tr/duyuru/1",
    officialSourceUrl: "https://example.edu.tr/duyurular",
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
    ...overrides
  };
  return {
    ...candidate,
    sourceRelationships: candidate.sourceRelationships ?? [{
      sourceId: candidate.sourceId,
      sourceName: candidate.sourceName,
      officialSourceUrl: candidate.officialSourceUrl ?? "",
      scopeType: candidate.scopeType,
      scopeId: candidate.scopeId,
      canonicalUrl: candidate.canonicalUrl ?? candidate.link
    }]
  };
}

function scopedRecord(
  id: string,
  overrides: Partial<MobileContentRecordInput> = {}
): MobileContentRecordInput {
  return record({
    id,
    link: `https://example.edu.tr/duyuru/${id}`,
    canonicalUrl: `https://example.edu.tr/duyuru/${id}`,
    ...overrides
  });
}
