import type { Collection, Document as MongoDocument } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import {
  applyMutations as applyPersistedMutations,
  buildOfficialScopeUrls
} from "../../../scripts/reconcile-announcement-content.js";
import {
  BUILT_IN_OFFICIAL_SCOPE_URLS,
  databaseNameFromMongoUri,
  parseReconciliationCliOptions,
  planAnnouncementContentReconciliation,
  toMongoReconciliationSet,
  type ContentReconciliationPlan,
  type ReconciliationItemDocument,
  type ReconciliationMutation,
  type ReconciliationSourceDocument
} from "../src/modules/announcements/announcement-content-reconciliation.js";

describe("announcement content reconciliation CLI safety", () => {
  it("defaults to a bounded dry run and requires an explicit database confirmation before apply", () => {
    expect(parseReconciliationCliOptions([])).toEqual({ apply: false, batchSize: 250 });
    expect(parseReconciliationCliOptions(["--batch-size=100"])).toEqual({ apply: false, batchSize: 100 });
    expect(() => parseReconciliationCliOptions(["--apply"]))
      .toThrow("CONTENT_RECONCILIATION_DATABASE_CONFIRMATION_REQUIRED");
    expect(parseReconciliationCliOptions([
      "--apply",
      "--confirm-database=academic_content_phase2",
      "--batch-size=1000"
    ])).toEqual({
      apply: true,
      confirmDatabase: "academic_content_phase2",
      batchSize: 1000
    });
    expect(() => parseReconciliationCliOptions(["--batch-size=0"]))
      .toThrow("CONTENT_RECONCILIATION_BATCH_SIZE_INVALID");
    expect(() => parseReconciliationCliOptions(["--unknown-option"]))
      .toThrow("CONTENT_RECONCILIATION_ARGUMENT_INVALID");
  });

  it("extracts the exact target database from direct, SRV, encoded, and replica-set Mongo URIs", () => {
    expect(databaseNameFromMongoUri("mongodb://127.0.0.1:27017/academic_content_phase2?retryWrites=true"))
      .toBe("academic_content_phase2");
    expect(databaseNameFromMongoUri("mongodb+srv://user:secret@cluster.example.test/academic_content_phase2"))
      .toBe("academic_content_phase2");
    expect(databaseNameFromMongoUri("mongodb://127.0.0.1:27017/academic%5Fcontent%5Fphase2"))
      .toBe("academic_content_phase2");
    expect(databaseNameFromMongoUri("mongodb://mongo-a:27017,mongo-b:27017/academic_content_phase2?replicaSet=rs0"))
      .toBe("academic_content_phase2");
    expect(databaseNameFromMongoUri("mongodb://127.0.0.1:27017/"))
      .toBeNull();
    expect(databaseNameFromMongoUri("not-a-mongo-uri"))
      .toBeNull();
  });

  it("keeps item timestamps as ISO strings while casting only source discovery time for Mongo", () => {
    const timestamp = "2026-07-30T08:00:00.000Z";
    expect(toMongoReconciliationSet({ discoveredAt: timestamp, publishedAt: timestamp }, "item"))
      .toEqual({ discoveredAt: timestamp, publishedAt: timestamp });
    expect(toMongoReconciliationSet({ discoveredAt: timestamp }, "source").discoveredAt)
      .toEqual(new Date(timestamp));
  });

  it("detects both preimage and updatedAt write conflicts without applying stale plans", async () => {
    const databaseId = "mongo-source-1";
    const plannedUpdatedAt = new Date("2026-07-30T08:00:00.000Z");
    const mutation: ReconciliationMutation = {
      id: "source-1",
      preimageHash: "expected-preimage",
      set: { sourceName: "Normalized source" },
      unset: []
    };
    const preimageUpdate = vi.fn(async () => ({ modifiedCount: 1 }));
    const preimageCollection = {
      findOne: vi.fn(async () => ({
        _id: databaseId,
        sourceName: "Concurrent source edit",
        updatedAt: plannedUpdatedAt
      })),
      updateOne: preimageUpdate
    } as unknown as Collection<MongoDocument>;

    await expect(applyPersistedMutations({
      collection: preimageCollection,
      ids: new Map([[mutation.id, databaseId]]),
      mutations: [mutation],
      batchSize: 1,
      documentType: "source",
      preimageHash: (document) => document.sourceName === "Concurrent source edit" ? "changed-preimage" : "expected-preimage"
    })).resolves.toEqual({ applied: 0, conflicts: 1 });
    expect(preimageUpdate).not.toHaveBeenCalled();

    const updatedAtUpdate = vi.fn(async (_filter: unknown, _update: unknown) => ({ modifiedCount: 0 }));
    const updatedAtCollection = {
      findOne: vi.fn(async () => ({
        _id: databaseId,
        sourceName: "Original source",
        updatedAt: plannedUpdatedAt
      })),
      updateOne: updatedAtUpdate
    } as unknown as Collection<MongoDocument>;

    await expect(applyPersistedMutations({
      collection: updatedAtCollection,
      ids: new Map([[mutation.id, databaseId]]),
      mutations: [mutation],
      batchSize: 1,
      documentType: "source",
      preimageHash: () => "expected-preimage"
    })).resolves.toEqual({ applied: 0, conflicts: 1 });
    expect(updatedAtUpdate).toHaveBeenCalledOnce();
    expect(updatedAtUpdate.mock.calls[0]?.[0]).toEqual({
      _id: databaseId,
      updatedAt: plannedUpdatedAt
    });
  });

  it("builds catalog-backed authority for university, faculty, and department scopes", () => {
    const authority = buildOfficialScopeUrls(
      [{
        _id: "university-1",
        slug: "synthetic-university",
        websiteUrl: " https://example.edu.tr ",
        announcementUrl: "https://news.example.edu.tr/duyurular",
        academicCalendarUrl: "https://example.edu.tr/takvim",
        emailDomains: ["example.edu.tr", 42]
      }],
      [{
        _id: "faculty-1",
        universityId: "university-1",
        websiteUrl: "https://faculty.example.edu.tr"
      }],
      [{
        _id: "department-1",
        facultyId: "faculty-1",
        websiteUrl: "https://department.example.edu.tr",
        courseScheduleUrl: "https://department.example.edu.tr/ders-programi"
      }]
    );

    expect(authority["university:university-1"]).toEqual([
      "https://example.edu.tr",
      "https://news.example.edu.tr/duyurular",
      "https://example.edu.tr/takvim"
    ]);
    expect(authority["faculty:faculty-1"]).toEqual([
      "https://faculty.example.edu.tr",
      "https://example.edu.tr",
      "https://news.example.edu.tr/duyurular",
      "https://example.edu.tr/takvim"
    ]);
    expect(authority["department:department-1"]).toEqual([
      "https://department.example.edu.tr",
      "https://department.example.edu.tr/ders-programi",
      "https://faculty.example.edu.tr",
      "https://example.edu.tr",
      "https://news.example.edu.tr/duyurular",
      "https://example.edu.tr/takvim"
    ]);
    expect(authority["university:yok-council-of-higher-education"])
      .toEqual(BUILT_IN_OFFICIAL_SCOPE_URLS["university:yok-council-of-higher-education"]);
  });
});

describe("announcement content reconciliation planning", () => {
  it("removes a crawler time masquerading as publication while preserving and normalizing the raw title", () => {
    const source = trustedSource();
    const crawlerTime = "2026-07-30T08:00:00.000Z";
    const rawTitle = "&raquo;&nbsp;Araştırma &amp; Geliştirme&nbsp;Duyurusu";
    const item: ReconciliationItemDocument = {
      id: "crawler-time-item",
      sourceId: source.id,
      sourceName: "Ankara &amp; Üniversitesi",
      contentType: "announcement",
      scopeType: "university",
      scopeId: "ankara-university",
      title: rawTitle,
      link: "https://www.ankara.edu.tr/duyuru/42?utm_source=crawler",
      publishedAt: crawlerTime,
      discoveredAt: "2026-07-29T10:00:00.000Z",
      fetchedAt: crawlerTime,
      summary: "<p>Başvurular&nbsp;açıldı.</p>"
    };

    const plan = planAnnouncementContentReconciliation({ sources: [source], items: [item] });
    const applied = applyPlan([source], [item], plan);
    const reconciledSource = applied.sources[0]!;
    const reconciledItem = applied.items[0]!;

    expect(reconciledSource).toEqual(expect.objectContaining({
      sourceName: "Ankara & Üniversitesi",
      sourceUrl: "https://www.ankara.edu.tr/duyurular",
      canonicalUrl: "https://www.ankara.edu.tr/duyurular",
      trustStatus: "trusted"
    }));
    expect(reconciledItem.rawTitle).toBe(rawTitle);
    expect(reconciledItem.title).toBe("Araştırma & Geliştirme Duyurusu");
    expect(reconciledItem.link).toBe("https://www.ankara.edu.tr/duyuru/42");
    expect(reconciledItem).not.toHaveProperty("publishedAt");
    expect(reconciledItem).not.toHaveProperty("publicationTimeSource");
    expect(reconciledItem.discoveredAt).toBe("2026-07-29T10:00:00.000Z");
    expect(reconciledItem.fetchedAt).toBe(crawlerTime);
    expect(reconciledItem.summary).toBe("Başvurular açıldı.");
    expect(reconciledItem.trustStatus).toBe("trusted");
    expect(reconciledItem.trustReasonCodes).toContain("legacy_crawl_time_removed");
    expect(plan.summary.removedCrawlerPublicationTimes).toBe(1);
  });

  it("keeps source publication, source update, discovery, and fetch timestamps separate", () => {
    const source = trustedSource();
    const item: ReconciliationItemDocument = {
      id: "separate-timestamps",
      sourceId: source.id,
      sourceName: "Ankara &amp; Üniversitesi",
      contentType: "announcement",
      scopeType: "university",
      scopeId: "ankara-university",
      title: "Öğrenci kayıt duyurusu",
      link: "https://www.ankara.edu.tr/duyuru/kayit",
      publishedAt: new Date("2026-07-25T06:00:00.000Z"),
      publicationTimeSource: "source",
      sourceUpdatedAt: new Date("2026-07-26T07:00:00.000Z"),
      sourceUpdateTimeSource: "source",
      discoveredAt: new Date("2026-07-27T08:00:00.000Z"),
      fetchedAt: new Date("2026-07-28T09:00:00.000Z")
    };

    const plan = planAnnouncementContentReconciliation({ sources: [source], items: [item] });
    const reconciled = applyPlan([source], [item], plan).items[0]!;

    expect(asIsoString(reconciled.publishedAt)).toBe("2026-07-25T06:00:00.000Z");
    expect(reconciled.publicationTimeSource).toBe("source");
    expect(asIsoString(reconciled.sourceUpdatedAt)).toBe("2026-07-26T07:00:00.000Z");
    expect(reconciled.sourceUpdateTimeSource).toBe("source");
    expect(asIsoString(reconciled.discoveredAt)).toBe("2026-07-27T08:00:00.000Z");
    expect(asIsoString(reconciled.fetchedAt)).toBe("2026-07-28T09:00:00.000Z");
  });

  it("rejects unsafe URLs, unofficial URLs, and navigation records", () => {
    const source = trustedSource();
    const items: ReconciliationItemDocument[] = [
      legacyItem({ id: "unsafe", sourceId: source.id, title: "Güvenli görünen duyuru", link: "javascript:alert(1)" }),
      legacyItem({ id: "unofficial", sourceId: source.id, title: "Başvuru duyurusu", link: "https://www.yok.gov.tr/tr/duyuru/1" }),
      legacyItem({ id: "navigation", sourceId: source.id, title: "Devamını Oku", link: "https://www.ankara.edu.tr/duyuru/3" })
    ];

    const plan = planAnnouncementContentReconciliation({ sources: [source], items });
    const reconciled = new Map(applyPlan([source], items, plan).items.map((item) => [item.id, item]));

    expect(reconciled.get("unsafe")).toEqual(expect.objectContaining({
      trustStatus: "rejected",
      trustReasonCodes: ["unsafe_url"]
    }));
    expect(reconciled.get("unofficial")).toEqual(expect.objectContaining({
      trustStatus: "rejected",
      trustReasonCodes: ["unofficial_source"]
    }));
    expect(reconciled.get("navigation")).toEqual(expect.objectContaining({
      rawTitle: "Devamını Oku",
      trustStatus: "rejected",
      trustReasonCodes: ["navigation_or_chrome"]
    }));
  });

  it("marks the later canonical duplicate while preserving the survivor and a separate scope relationship", () => {
    const source = trustedSource();
    const facultySource: ReconciliationSourceDocument = {
      ...source,
      id: "faculty-source",
      scopeType: "faculty",
      scopeId: "law-faculty"
    };
    const items: ReconciliationItemDocument[] = [
      legacyItem({
        id: "duplicate-old",
        sourceId: source.id,
        title: "Yatay geçiş duyurusu",
        link: "https://ankara.edu.tr/duyuru/1?utm_source=old",
        discoveredAt: "2026-07-20T10:00:00.000Z"
      }),
      legacyItem({
        id: "duplicate-new",
        sourceId: source.id,
        title: "Yatay Geçiş Duyurusu Güncellendi",
        link: "https://www.ankara.edu.tr/duyuru/1/",
        discoveredAt: "2026-07-21T10:00:00.000Z"
      }),
      legacyItem({
        id: "duplicate-other-scope",
        sourceId: facultySource.id,
        scopeType: "faculty",
        scopeId: "law-faculty",
        title: "Fakülte yatay geçiş duyurusu",
        link: "https://www.ankara.edu.tr/duyuru/1",
        discoveredAt: "2026-07-22T10:00:00.000Z"
      })
    ];

    const plan = planAnnouncementContentReconciliation({ sources: [source, facultySource], items });
    const reconciled = new Map(applyPlan([source, facultySource], items, plan).items.map((item) => [item.id, item]));

    expect(reconciled.get("duplicate-old")).toEqual(expect.objectContaining({ trustStatus: "trusted" }));
    expect(reconciled.get("duplicate-old")).not.toHaveProperty("duplicateOfId");
    expect(reconciled.get("duplicate-new")).toEqual(expect.objectContaining({
      trustStatus: "rejected",
      duplicateOfId: "duplicate-old"
    }));
    expect(reconciled.get("duplicate-new")?.trustReasonCodes).toContain("duplicate_canonical_url");
    expect(reconciled.get("duplicate-other-scope")).toEqual(expect.objectContaining({ trustStatus: "trusted" }));
    expect(reconciled.get("duplicate-other-scope")).not.toHaveProperty("duplicateOfId");
    expect(plan.summary.duplicates).toBe(1);
    expect(new Set([reconciled.get("duplicate-old")?.link, reconciled.get("duplicate-new")?.link]).size).toBe(2);
  });

  it("quarantines missing scope authority, rejects a cross-scope official source, and never revives explicit rejection", () => {
    const unknown = { ...trustedSource(), id: "unknown", scopeId: "unknown-university" };
    const tekirdag = {
      ...trustedSource(),
      id: "tekirdag-yok",
      scopeId: "tekirdag-namik-kemal-universitesi",
      sourceUrl: "https://www.yok.gov.tr/tr/announcements"
    };
    const manuallyRejected = { ...trustedSource(), id: "manual", trustStatus: "rejected" as const, status: "inactive" as const, trustReasonCodes: ["unofficial_source"] };
    const plan = planAnnouncementContentReconciliation({
      sources: [unknown, tekirdag, manuallyRejected],
      items: [],
      officialScopeUrls: {
        "university:tekirdag-namik-kemal-universitesi": ["https://nku.edu.tr"],
        "university:ankara-university": ["https://ankara.edu.tr"]
      }
    });
    const reconciled = new Map(applyPlan([unknown, tekirdag, manuallyRejected], [], plan).sources.map((source) => [source.id, source]));
    expect(reconciled.get("unknown")).toEqual(expect.objectContaining({ status: "inactive", trustStatus: "quarantined" }));
    expect(reconciled.get("tekirdag-yok")).toEqual(expect.objectContaining({ status: "inactive", trustStatus: "rejected", trustReasonCodes: ["unofficial_source"] }));
    expect(reconciled.get("manual")).toEqual(expect.objectContaining({ status: "inactive", trustStatus: "rejected" }));
  });

  it("authorizes the runtime YÖK scope id and its stable legacy alias", () => {
    expect(BUILT_IN_OFFICIAL_SCOPE_URLS).toEqual(expect.objectContaining({
      "university:yok-council-of-higher-education": ["https://www.yok.gov.tr/tr"],
      "university:yok": ["https://www.yok.gov.tr/tr"]
    }));
    const sources: ReconciliationSourceDocument[] = [
      {
        id: "yok-runtime-source",
        scopeType: "university",
        scopeId: "yok-council-of-higher-education",
        sourceName: "YÖK",
        sourceUrl: "https://www.yok.gov.tr/tr/announcements"
      },
      {
        id: "yok-legacy-source",
        scopeType: "university",
        scopeId: "yok",
        sourceName: "YÖK",
        sourceUrl: "https://www.yok.gov.tr/tr/announcements"
      }
    ];
    const plan = planAnnouncementContentReconciliation({
      sources,
      items: [],
      officialScopeUrls: BUILT_IN_OFFICIAL_SCOPE_URLS
    });
    expect(applyPlan(sources, [], plan).sources).toEqual([
      expect.objectContaining({ trustStatus: "trusted" }),
      expect.objectContaining({ trustStatus: "trusted" })
    ]);
  });

  it("unsets invalid and unverified timestamps instead of fabricating source provenance", () => {
    const source = trustedSource();
    const item = legacyItem({
      id: "invalid-times",
      sourceId: source.id,
      title: "Kayıt duyurusu",
      link: "https://www.ankara.edu.tr/duyuru/invalid-times",
      publishedAt: "2026-07-20T08:00:00.000Z",
      sourceUpdatedAt: "2026-07-21T08:00:00.000Z",
      discoveredAt: "not-a-date",
      fetchedAt: "also-not-a-date"
    });
    const plan = planAnnouncementContentReconciliation({ sources: [source], items: [item] });
    const reconciled = applyPlan([source], [item], plan).items[0]!;
    expect(reconciled).not.toHaveProperty("publishedAt");
    expect(reconciled).not.toHaveProperty("sourceUpdatedAt");
    expect(reconciled).not.toHaveProperty("discoveredAt");
    expect(reconciled).not.toHaveProperty("fetchedAt");
    expect(reconciled.trustReasonCodes).toEqual(expect.arrayContaining(["invalid_timestamp", "unverified_source_time_removed"]));
  });

  it("repairs malformed source-less content while preserving exact raw title audit evidence", () => {
    const crawlerTime = "2026-07-30T08:00:00.000Z";
    const rawTitle = "&raquo;&nbsp;<strong>Kayıt &amp; Başvuru Duyurusu</strong>";
    const item = legacyItem({
      id: "source-less-malformed",
      sourceId: "missing-source",
      title: rawTitle,
      link: "javascript:alert(1)",
      officialSourceUrl: "https://forged.edu.tr/duyurular",
      publishedAt: crawlerTime,
      sourceUpdatedAt: "not-a-date",
      discoveredAt: "also-not-a-date",
      fetchedAt: crawlerTime,
      summary: "<p>Başvurular&nbsp;<strong>açıldı.</strong></p>",
      dedupeKey: "stale-dedupe-key"
    });

    const first = planAnnouncementContentReconciliation({ sources: [], items: [item] });
    const reconciled = applyPlan([], [item], first).items[0]!;

    expect(reconciled.rawTitle).toBe(rawTitle);
    expect(reconciled.title).toBe("Kayıt & Başvuru Duyurusu");
    expect(reconciled.summary).toBe("Başvurular açıldı.");
    expect(reconciled).not.toHaveProperty("link");
    expect(reconciled).not.toHaveProperty("canonicalUrl");
    expect(reconciled).not.toHaveProperty("officialSourceUrl");
    expect(reconciled).not.toHaveProperty("publishedAt");
    expect(reconciled).not.toHaveProperty("sourceUpdatedAt");
    expect(reconciled.discoveredAt).toBe(crawlerTime);
    expect(reconciled.fetchedAt).toBe(crawlerTime);
    expect(reconciled).not.toHaveProperty("dedupeKey");
    expect(reconciled).toEqual(expect.objectContaining({
      trustStatus: "rejected",
      trustReasonCodes: expect.arrayContaining([
        "missing_source",
        "unsafe_url",
        "invalid_timestamp",
        "legacy_crawl_time_removed",
        "unverified_source_time_removed"
      ])
    }));
    expect(planAnnouncementContentReconciliation({ sources: [], items: [reconciled] }).items).toEqual([]);
  });

  it.each(["rejected", "quarantined"] as const)("deterministically repairs and quarantines content owned by a %s source", (sourceTrustStatus) => {
    const sourceReason = sourceTrustStatus === "rejected" ? "unofficial_source" : "missing_source";
    const source: ReconciliationSourceDocument = {
      ...trustedSource(),
      id: `${sourceTrustStatus}-source`,
      sourceUrl: "https://www.ankara.edu.tr/duyurular/?utm_source=legacy",
      status: "inactive",
      trustStatus: sourceTrustStatus,
      trustReasonCodes: [sourceReason]
    };
    const rawTitle = "&raquo;&nbsp;Öğrenci &amp; Kayıt Duyurusu";
    const item = legacyItem({
      id: "untrusted-source-item",
      sourceId: source.id,
      title: "<b>bozuk başlık</b>",
      rawTitle,
      link: "HTTPS://WWW.ANKARA.EDU.TR/duyuru/kayit/?utm_source=legacy&b=2&a=1",
      canonicalUrl: "HTTPS://WWW.ANKARA.EDU.TR/duyuru/kayit/?utm_source=legacy&b=2&a=1",
      officialSourceUrl: "https://forged.edu.tr/duyurular",
      publishedAt: "2026-07-25T06:00:00.000Z",
      publicationTimeSource: "source",
      sourceUpdatedAt: "invalid-update",
      sourceUpdateTimeSource: "source",
      discoveredAt: "invalid-discovery",
      createdAt: "2026-07-26T07:00:00.000Z",
      fetchedAt: "invalid-fetch",
      summary: "<p>Belgeler&nbsp;&amp; tarihler açıklandı.</p>",
      trustStatus: "trusted",
      dedupeKey: "stale-dedupe-key"
    });

    const first = planAnnouncementContentReconciliation({ sources: [source], items: [item] });
    const reordered = planAnnouncementContentReconciliation({ sources: [source], items: [item].reverse() });
    expect(reordered).toEqual(first);
    const applied = applyPlan([source], [item], first);
    const reconciled = applied.items[0]!;

    expect(reconciled.rawTitle).toBe(rawTitle);
    expect(reconciled.title).toBe("Öğrenci & Kayıt Duyurusu");
    expect(reconciled.summary).toBe("Belgeler & tarihler açıklandı.");
    expect(reconciled.link).toBe("https://www.ankara.edu.tr/duyuru/kayit?a=1&b=2");
    expect(reconciled.canonicalUrl).toBe(reconciled.link);
    expect(reconciled).not.toHaveProperty("officialSourceUrl");
    expect(reconciled.publishedAt).toBe("2026-07-25T06:00:00.000Z");
    expect(reconciled.publicationTimeSource).toBe("source");
    expect(reconciled).not.toHaveProperty("sourceUpdatedAt");
    expect(reconciled).not.toHaveProperty("sourceUpdateTimeSource");
    expect(reconciled.discoveredAt).toBe("2026-07-26T07:00:00.000Z");
    expect(reconciled).not.toHaveProperty("fetchedAt");
    expect(reconciled).not.toHaveProperty("dedupeKey");
    expect(reconciled).toEqual(expect.objectContaining({
      trustStatus: "quarantined",
      trustReasonCodes: expect.arrayContaining(["missing_source", sourceReason, "invalid_timestamp"])
    }));
    expect(planAnnouncementContentReconciliation(applied).items).toEqual([]);
  });

  it("selects collision-safe source and item survivors under legacy unique indexes", () => {
    const exact = {
      ...trustedSource(),
      id: "source-exact",
      sourceUrl: "https://www.ankara.edu.tr/duyurular",
      discoveredAt: "2026-07-22T08:00:00.000Z"
    };
    const alias = {
      ...trustedSource(),
      id: "source-alias",
      sourceUrl: "https://www.ankara.edu.tr/duyurular/?utm_source=legacy",
      discoveredAt: "2026-07-20T08:00:00.000Z"
    };
    const plan = planAnnouncementContentReconciliation({ sources: [alias, exact], items: [] });
    const sources = new Map(applyPlan([alias, exact], [], plan).sources.map((source) => [source.id, source]));
    expect(sources.get("source-exact")).toEqual(expect.objectContaining({ trustStatus: "trusted" }));
    expect(sources.get("source-alias")).toEqual(expect.objectContaining({
      sourceUrl: alias.sourceUrl,
      trustStatus: "rejected",
      duplicateOfId: exact.id
    }));
    expect(new Set([...sources.values()].map((source) => source.sourceUrl)).size).toBe(2);
    expect(plan.summary.duplicates).toBe(1);
    const second = planAnnouncementContentReconciliation({ sources: [...sources.values()], items: [] });
    expect(second.sources).toEqual([]);
  });

  it.each(["rejected", "quarantined"] as const)(
    "keeps a trusted source alias collision-safe when an explicitly %s exact URL occupies the unique key",
    (occupiedTrustStatus) => {
      const occupiedReason = occupiedTrustStatus === "rejected" ? "unofficial_source" : "missing_source";
      const exact = {
        ...trustedSource(),
        id: `source-exact-${occupiedTrustStatus}`,
        sourceUrl: "https://www.ankara.edu.tr/duyurular",
        status: "inactive" as const,
        trustStatus: occupiedTrustStatus,
        trustReasonCodes: [occupiedReason]
      };
      const alias = {
        ...trustedSource(),
        id: `source-alias-${occupiedTrustStatus}`,
        sourceUrl: "https://www.ankara.edu.tr/duyurular/?utm_source=legacy"
      };
      const plan = planAnnouncementContentReconciliation({ sources: [exact, alias], items: [] });
      expect(planAnnouncementContentReconciliation({ sources: [alias, exact], items: [] })).toEqual(plan);
      const aliasMutation = plan.sources.find((mutation) => mutation.id === alias.id);
      expect(aliasMutation).toBeDefined();
      expect(aliasMutation!.set).not.toHaveProperty("sourceUrl");
      const applied = applyPlan([exact, alias], [], plan);
      const sources = new Map(applied.sources.map((source) => [source.id, source]));
      expect(sources.get(exact.id)).toEqual(expect.objectContaining({
        sourceUrl: exact.sourceUrl,
        trustStatus: occupiedTrustStatus,
        trustReasonCodes: expect.arrayContaining([occupiedReason])
      }));
      expect(sources.get(alias.id)).toEqual(expect.objectContaining({
        sourceUrl: alias.sourceUrl,
        canonicalUrl: exact.sourceUrl,
        trustStatus: "trusted"
      }));
      expect(new Set(applied.sources.map((source) => `${source.scopeType}|${source.scopeId}|${source.sourceUrl}`)).size).toBe(2);
      expect(planAnnouncementContentReconciliation(applied).sources).toEqual([]);
    }
  );

  it.each(["rejected", "quarantined"] as const)(
    "keeps a trusted item alias collision-safe when an explicitly %s exact link occupies the unique key",
    (occupiedTrustStatus) => {
      const occupiedReason = occupiedTrustStatus === "rejected" ? "navigation_or_chrome" : "missing_source";
      const source = trustedSource();
      const exact = legacyItem({
        id: `item-exact-${occupiedTrustStatus}`,
        sourceId: source.id,
        title: "Kayıt duyurusu",
        link: "https://www.ankara.edu.tr/duyuru/collision",
        trustStatus: occupiedTrustStatus,
        trustReasonCodes: [occupiedReason]
      });
      const alias = legacyItem({
        id: `item-alias-${occupiedTrustStatus}`,
        sourceId: source.id,
        title: "Kayıt duyurusu güncellendi",
        link: "https://www.ankara.edu.tr/duyuru/collision?utm_source=legacy"
      });
      const plan = planAnnouncementContentReconciliation({ sources: [source], items: [exact, alias] });
      expect(planAnnouncementContentReconciliation({ sources: [source], items: [alias, exact] })).toEqual(plan);
      const aliasMutation = plan.items.find((mutation) => mutation.id === alias.id);
      expect(aliasMutation).toBeDefined();
      expect(aliasMutation!.set).not.toHaveProperty("link");
      const applied = applyPlan([source], [exact, alias], plan);
      const items = new Map(applied.items.map((item) => [item.id, item]));
      expect(items.get(exact.id)).toEqual(expect.objectContaining({
        link: exact.link,
        trustStatus: occupiedTrustStatus,
        trustReasonCodes: expect.arrayContaining([occupiedReason])
      }));
      expect(items.get(alias.id)).toEqual(expect.objectContaining({
        link: alias.link,
        canonicalUrl: exact.link,
        trustStatus: "trusted"
      }));
      expect(new Set(applied.items.map((item) => `${item.sourceId}|${item.link}`)).size).toBe(2);
      expect(planAnnouncementContentReconciliation(applied).items).toEqual([]);
    }
  );

  it("produces the same deterministic plan for reordered input and no mutations after applying it once", () => {
    const source = trustedSource();
    const crawlerTime = "2026-07-30T08:00:00.000Z";
    const items: ReconciliationItemDocument[] = [
      legacyItem({
        id: "stable-valid",
        sourceId: source.id,
        title: "&raquo; Akademik kurul duyurusu",
        link: "https://www.ankara.edu.tr/duyuru/stable?utm_source=crawler",
        publishedAt: "2026-07-25T06:00:00.000Z",
        publicationTimeSource: "source",
        discoveredAt: "2026-07-27T08:00:00.000Z",
        fetchedAt: crawlerTime
      }),
      legacyItem({
        id: "stable-crawler-time",
        sourceId: source.id,
        title: "Kayıt yenileme duyurusu",
        link: "https://www.ankara.edu.tr/duyuru/crawl-time",
        publishedAt: crawlerTime,
        discoveredAt: crawlerTime,
        fetchedAt: crawlerTime
      })
    ];

    const first = planAnnouncementContentReconciliation({ sources: [source], items });
    const reordered = planAnnouncementContentReconciliation({
      sources: [source].reverse(),
      items: [...items].reverse()
    });
    expect(reordered).toEqual(first);

    const applied = applyPlan([source], items, first);
    const second = planAnnouncementContentReconciliation(applied);

    expect(second.sources).toEqual([]);
    expect(second.items).toEqual([]);
    expect(second.summary.sourceMutations).toBe(0);
    expect(second.summary.itemMutations).toBe(0);
  });
});

function trustedSource(): ReconciliationSourceDocument {
  return {
    id: "ankara-source",
    scopeType: "university",
    scopeId: "ankara-university",
    sourceName: "Ankara &amp; Üniversitesi",
    sourceUrl: "HTTPS://WWW.ANKARA.EDU.TR/duyurular/?utm_source=registry#footer",
    status: "active",
    createdAt: "2026-07-19T09:00:00.000Z"
  };
}

function legacyItem(
  input: Pick<ReconciliationItemDocument, "id" | "sourceId" | "title" | "link"> & Partial<ReconciliationItemDocument>
): ReconciliationItemDocument {
  return {
    sourceName: "Ankara Üniversitesi",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "ankara-university",
    fetchedAt: "2026-07-30T08:00:00.000Z",
    ...input
  };
}

function applyPlan(
  sources: ReconciliationSourceDocument[],
  items: ReconciliationItemDocument[],
  plan: ContentReconciliationPlan
): { sources: ReconciliationSourceDocument[]; items: ReconciliationItemDocument[] } {
  return {
    sources: applyFixtureMutations(sources, plan.sources),
    items: applyFixtureMutations(items, plan.items)
  };
}

function applyFixtureMutations<T extends { id: string }>(documents: T[], mutations: ReconciliationMutation[]): T[] {
  const documentsById = new Map(documents.map((document) => [document.id, { ...document }]));
  for (const mutation of mutations) {
    const current = documentsById.get(mutation.id);
    if (!current) throw new Error(`Missing reconciliation fixture document: ${mutation.id}`);
    const next = current as Record<string, unknown>;
    Object.assign(next, mutation.set);
    for (const field of mutation.unset) delete next[field];
  }
  return documents.map((document) => documentsById.get(document.id)!);
}

function asIsoString(value: string | Date | undefined): string | undefined {
  return value instanceof Date ? value.toISOString() : value;
}
