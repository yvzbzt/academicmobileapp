import type { Collection, Document as MongoDocument } from "mongodb";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyMutations as applyPersistedMutations,
  assertApprovedSourceOutcome,
  assertApprovedSourcePostconditions,
  assertPostApplyFixedPoint,
  buildCheckedInVerifiedScopeUrls,
  buildOfficialScopeUrls,
  buildVerifiedRegistryScopeUrls,
  filterReconciliationPlanToApprovedDocuments,
  mergeVerifiedOfficialScopeUrls,
  readVerifiedSourceApprovalReport,
  selectVerifiedSourceDocuments,
  selectVerifiedPostApplyDocuments,
  summarizeApprovedTargetOutcome,
  validateVerifiedSourceApprovalReport,
  verifiedSourceUrlOverrides,
  verifiedSourceTrustOverrides,
  verifyApprovedSourceFences,
  type VerifiedSourceApprovalRecord,
  type VerifiedSourceApprovalReport
} from "../../../scripts/reconcile-announcement-content.js";
import {
  BUILT_IN_OFFICIAL_SCOPE_URLS,
  databaseNameFromMongoUri,
  itemReconciliationPreimageHash,
  parseReconciliationCliOptions,
  planAnnouncementContentReconciliation,
  reconciliationPreimageFilter,
  sourceReconciliationPreimageHash,
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
    expect(parseReconciliationCliOptions([
      "--verification-report=/tmp/verified.json",
      `--confirm-verification-sha256=${"a".repeat(64)}`
    ])).toEqual({
      apply: false,
      verificationReport: "/tmp/verified.json",
      confirmVerificationSha256: "a".repeat(64),
      batchSize: 250
    });
    expect(() => parseReconciliationCliOptions(["--apply"]))
      .toThrow("CONTENT_RECONCILIATION_DATABASE_CONFIRMATION_REQUIRED");
    expect(parseReconciliationCliOptions([
      "--apply",
      "--confirm-database=academic_content_phase2",
      "--verification-report=/tmp/verified.json",
      `--confirm-verification-sha256=${"a".repeat(64)}`,
      "--batch-size=1000"
    ])).toEqual({
      apply: true,
      confirmDatabase: "academic_content_phase2",
      verificationReport: "/tmp/verified.json",
      confirmVerificationSha256: "a".repeat(64),
      batchSize: 1000
    });
    expect(parseReconciliationCliOptions([
      "--verify-post-apply",
      "--confirm-database=academic_content_phase2",
      "--verification-report=/tmp/verified.json",
      `--confirm-verification-sha256=${"a".repeat(64)}`
    ])).toEqual({
      apply: false,
      verifyPostApply: true,
      confirmDatabase: "academic_content_phase2",
      verificationReport: "/tmp/verified.json",
      confirmVerificationSha256: "a".repeat(64),
      batchSize: 250
    });
    expect(() => parseReconciliationCliOptions(["--apply", "--verify-post-apply"]))
      .toThrow("CONTENT_RECONCILIATION_MODE_CONFLICT");
    expect(() => parseReconciliationCliOptions(["--verify-post-apply"]))
      .toThrow("CONTENT_RECONCILIATION_DATABASE_CONFIRMATION_REQUIRED");
    expect(() => parseReconciliationCliOptions(["--apply", "--confirm-database=academic_content_phase2"]))
      .toThrow("CONTENT_RECONCILIATION_VERIFICATION_REPORT_REQUIRED");
    expect(() => parseReconciliationCliOptions([
      "--apply",
      "--confirm-database=academic_content_phase2",
      "--verification-report=/tmp/verified.json"
    ])).toThrow("CONTENT_RECONCILIATION_VERIFICATION_HASH_REQUIRED");
    expect(() => parseReconciliationCliOptions(["--confirm-verification-sha256=wrong"]))
      .toThrow("CONTENT_RECONCILIATION_VERIFICATION_HASH_INVALID");
    expect(() => parseReconciliationCliOptions([`--confirm-verification-sha256=${"a".repeat(64)}`]))
      .toThrow("CONTENT_RECONCILIATION_VERIFICATION_REPORT_REQUIRED");
    expect(() => parseReconciliationCliOptions(["--batch-size=0"]))
      .toThrow("CONTENT_RECONCILIATION_BATCH_SIZE_INVALID");
    expect(() => parseReconciliationCliOptions(["--unknown-option"]))
      .toThrow("CONTENT_RECONCILIATION_ARGUMENT_INVALID");
  });

  it("reads only an exact v2 report, preserves the raw SHA, and rejects wrong databases or stale clocks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "content-trust-report-"));
    const reportPath = join(directory, "validation-report.json");
    try {
      const report = verificationReport(new Date());
      const sidecar = {
        parentReport: "validation-report.json",
        parentReportIdentity: {
          schemaVersion: report.schemaVersion,
          revision: report.revision,
          databaseName: report.databaseName,
          generatedAt: report.generatedAt,
          frozenAt: report.frozenAt
        }
      };
      const sidecarRaw = `${JSON.stringify(sidecar)}\n`;
      const manualReviewSha256 = createHash("sha256").update(sidecarRaw).digest("hex");
      report.manualReview.detailsSha256 = manualReviewSha256;
      const raw = `${JSON.stringify(report)}\n`;
      await writeFile(join(directory, "manual-review.json"), sidecarRaw, "utf8");
      await writeFile(reportPath, raw, "utf8");
      await expect(readVerifiedSourceApprovalReport(reportPath, "academic_content_phase2")).resolves.toEqual({
        report,
        sha256: createHash("sha256").update(raw).digest("hex"),
        manualReviewSha256
      });
      await expect(readVerifiedSourceApprovalReport(reportPath, "wrong_database"))
        .rejects.toThrow("CONTENT_RECONCILIATION_VERIFICATION_DATABASE_MISMATCH");

      const v1 = { ...report, schemaVersion: 1 };
      expect(() => validateVerifiedSourceApprovalReport(v1, "academic_content_phase2"))
        .toThrow("CONTENT_RECONCILIATION_VERIFICATION_SCHEMA_UNSUPPORTED");
      const supersededRevision5 = { ...report, revision: 5 };
      expect(() => validateVerifiedSourceApprovalReport(supersededRevision5, "academic_content_phase2"))
        .toThrow("CONTENT_RECONCILIATION_VERIFICATION_REPORT_NOT_FROZEN");
      const selfAssertedCollision = structuredClone(report);
      const duplicate = structuredClone(selfAssertedCollision.records[0]!);
      duplicate.id = "source-trusted-duplicate";
      const duplicateRisk = duplicate.duplicateRisk as Record<string, unknown>;
      duplicateRisk.exactUrlSourceIds = [duplicate.id];
      duplicateRisk.sameScopeAndTypeIds = [duplicate.id];
      duplicateRisk.survivorId = duplicate.id;
      duplicateRisk.finalCanonicalSurvivorId = duplicate.id;
      selfAssertedCollision.records.push(duplicate);
      selfAssertedCollision.recommended.trustedSourceIds.push(duplicate.id as string);
      selfAssertedCollision.summary.sourceDocuments = 2;
      selfAssertedCollision.summary.verdicts.trusted = 2;
      selfAssertedCollision.classificationGuarantees.checkedRecordCount = 2;
      selfAssertedCollision.classificationGuarantees.trustedRecordCount = 2;
      selfAssertedCollision.classificationGuarantees.trustedApprovedHttpsCount = 2;
      selfAssertedCollision.classificationGuarantees.trustedDirectHttpsCount = 2;
      expect(() => validateVerifiedSourceApprovalReport(selfAssertedCollision, "academic_content_phase2"))
        .toThrow("CONTENT_RECONCILIATION_VERIFICATION_TRUSTED_FINAL_COLLISION");
      const draft = { ...report, state: "draft" };
      expect(() => validateVerifiedSourceApprovalReport(draft, "academic_content_phase2"))
        .toThrow("CONTENT_RECONCILIATION_VERIFICATION_REPORT_NOT_FROZEN");
      const stale = { ...report, generatedAt: "2026-01-01T00:00:00.000Z" };
      expect(() => validateVerifiedSourceApprovalReport(stale, "academic_content_phase2"))
        .toThrow("CONTENT_RECONCILIATION_VERIFICATION_REPORT_STALE");
      const future = { ...report, generatedAt: new Date(Date.now() + 10 * 60_000).toISOString() };
      expect(() => validateVerifiedSourceApprovalReport(future, "academic_content_phase2"))
        .toThrow("CONTENT_RECONCILIATION_VERIFICATION_REPORT_STALE");
      await writeFile(join(directory, "manual-review.json"), `${sidecarRaw}tampered`, "utf8");
      await expect(readVerifiedSourceApprovalReport(reportPath, "academic_content_phase2"))
        .rejects.toThrow("CONTENT_RECONCILIATION_MANUAL_REVIEW_HASH_MISMATCH");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("selects only fresh, exact-preimage trusted source IDs and their owned items", () => {
    const updatedAt = new Date();
    const sourceRows = [
      {
        _id: "source-trusted",
        sourceUrl: "https://example.edu.tr/duyurular",
        canonicalUrl: undefined,
        scopeType: "university",
        scopeId: "example-university",
        contentType: "announcement",
        status: "active",
        trustStatus: undefined,
        updatedAt
      },
      {
        _id: "source-unverified",
        sourceUrl: "https://example.edu.tr/haberler",
        scopeType: "university",
        scopeId: "example-university",
        contentType: "news",
        status: "active",
        updatedAt
      }
    ] as unknown as MongoDocument[];
    const itemRows = [
      { _id: "item-selected", sourceId: "source-trusted" },
      { _id: "item-excluded", sourceId: "source-unverified" }
    ] as unknown as MongoDocument[];
    const report = verificationReport(updatedAt);

    const selected = selectVerifiedSourceDocuments(sourceRows, itemRows, report);

    expect(selected.approvedSourceIds).toEqual(["source-trusted"]);
    expect(selected.sources.map((row) => row._id)).toEqual(["source-trusted"]);
    expect(selected.items.map((row) => row._id)).toEqual(["item-selected"]);
  });

  it("verifies an exact trusted postimage and a zero-mutation fixed point without reusing the old preimage", () => {
    const report = verificationReport(new Date());
    const source = {
      _id: "source-trusted",
      sourceName: "Example source",
      sourceUrl: "https://example.edu.tr/duyurular",
      canonicalUrl: "https://example.edu.tr/duyurular",
      scopeType: "university",
      scopeId: "example-university",
      contentType: "announcement",
      status: "active",
      trustStatus: "trusted",
      trustReasonCodes: [],
      updatedAt: new Date()
    } as unknown as MongoDocument;
    const item = { _id: "item-selected", sourceId: "source-trusted" } as unknown as MongoDocument;

    const selected = selectVerifiedPostApplyDocuments([source], [item], report);
    expect(selected.approvedSourceIds).toEqual(["source-trusted"]);
    expect(selected.items).toEqual([item]);
    expect(verifiedSourceTrustOverrides([source], report, "post-apply")).toEqual({});

    const plan = planAnnouncementContentReconciliation({
      sources: [{ ...source, id: "source-trusted" } as unknown as ReconciliationSourceDocument],
      items: [],
      officialScopeUrls: { "university:example-university": ["https://example.edu.tr"] },
      verifiedSourceUrlOverrides: verifiedSourceUrlOverrides(report),
      verifiedSourceTrustOverrides: {}
    });
    expect(plan.sources).toEqual([]);
    expect(() => assertPostApplyFixedPoint(plan)).not.toThrow();
    expect(() => assertPostApplyFixedPoint({ ...plan, items: [{
      id: "item-needs-repair",
      preimageHash: "hash",
      set: { trustStatus: "trusted" },
      unset: []
    }] })).toThrow("CONTENT_RECONCILIATION_POST_APPLY_NOT_AT_FIXED_POINT");
    expect(() => selectVerifiedPostApplyDocuments([{ ...source, trustStatus: "rejected" }], [], report))
      .toThrow("CONTENT_RECONCILIATION_VERIFIED_SOURCE_POSTIMAGE_MISMATCH");
  });

  it("fails closed when a verified recommendation is missing, duplicated, stale, or no longer matches Mongo", () => {
    const updatedAt = new Date();
    const row = {
      _id: "source-trusted",
      sourceUrl: "https://example.edu.tr/duyurular",
      scopeType: "university",
      scopeId: "example-university",
      contentType: "announcement",
      status: "active",
      updatedAt
    } as unknown as MongoDocument;

    expect(() => selectVerifiedSourceDocuments([row], [], {
      ...verificationReport(updatedAt),
      recommended: {
        ...verificationReport(updatedAt).recommended,
        trustedSourceIds: ["source-trusted", "source-trusted"]
      }
    })).toThrow("CONTENT_RECONCILIATION_VERIFIED_SOURCE_IDS_INVALID");
    expect(() => selectVerifiedSourceDocuments([row], [], {
      ...verificationReport(updatedAt),
      recommended: {
        ...verificationReport(updatedAt).recommended,
        trustedSourceIds: ["missing-source"]
      }
    })).toThrow("CONTENT_RECONCILIATION_VERIFICATION_RECOMMENDATION_MISMATCH");
    expect(() => selectVerifiedSourceDocuments([{ ...row, sourceUrl: "https://example.edu.tr/changed" }], [], verificationReport(updatedAt)))
      .toThrow("CONTENT_RECONCILIATION_VERIFIED_SOURCE_PREIMAGE_MISMATCH");
    const stale = verificationReport(updatedAt);
    stale.records[0]!.verifiedAt = "2026-01-01T00:00:00.000Z";
    expect(() => selectVerifiedSourceDocuments([row], [], stale))
      .toThrow("CONTENT_RECONCILIATION_VERIFIED_AUTHORITY_EVIDENCE_INVALID");
    const crossDomainRedirect = verificationReport(updatedAt);
    crossDomainRedirect.records[0]!.finalUrl = "https://attacker.example/duyurular";
    expect(() => selectVerifiedSourceDocuments([row], [], crossDomainRedirect))
      .toThrow("CONTENT_RECONCILIATION_VERIFIED_AUTHORITY_EVIDENCE_INVALID");
  });

  it("rejects a self-asserted registry flag when the checked authority does not match the source", () => {
    const updatedAt = new Date();
    const row = {
      _id: "source-trusted",
      sourceUrl: "https://example.edu.tr/duyurular",
      scopeType: "university",
      scopeId: "example-university",
      contentType: "announcement",
      status: "active",
      updatedAt
    } as unknown as MongoDocument;
    const report = verificationReport(updatedAt);
    const record = report.records[0] as unknown as VerifiedSourceApprovalRecord;
    record.registryAuthorityUrls = ["https://attacker.edu.tr/duyurular"];
    record.authorityDomains = ["attacker.edu.tr"];

    expect(() => selectVerifiedSourceDocuments([row], [], report))
      .toThrow("CONTENT_RECONCILIATION_VERIFIED_AUTHORITY_EVIDENCE_INVALID");
  });

  it("merges only independently rechecked v2 registry authority into the approved scope", () => {
    const report = verificationReport(new Date());
    const merged = mergeVerifiedOfficialScopeUrls({
      "university:other-university": ["https://other.edu.tr"],
      "university:example-university": ["https://example.edu.tr"]
    }, report);

    expect(merged).toEqual({
      "university:other-university": ["https://other.edu.tr"],
      "university:example-university": ["https://example.edu.tr", "https://example.edu.tr/duyurular"]
    });
  });

  it("rejects a fully self-asserted manifest authority absent from the checked-in registry for that exact scope", () => {
    const report = verificationReport(new Date());
    const record = report.records[0] as unknown as VerifiedSourceApprovalRecord;
    record.sourceUrl = "https://attacker.edu.tr/duyurular";
    record.finalUrl = record.sourceUrl;
    record.approvedSourceUrl = record.finalUrl;
    record.preimage.sourceUrl = record.sourceUrl;
    record.registryAuthorityUrls = [record.sourceUrl];
    record.domainAuthorityUrls = [record.sourceUrl];
    record.authorityDomains = ["attacker.edu.tr"];
    record.http.finalHostname = "attacker.edu.tr";
    record.validationAttempts[0]!.finalUrl = record.finalUrl;
    record.duplicateRisk.finalCanonicalUrl = record.finalUrl;

    expect(() => mergeVerifiedOfficialScopeUrls({
      "university:example-university": ["https://example.edu.tr"]
    }, report)).toThrow("CONTENT_RECONCILIATION_VERIFIED_AUTHORITY_NOT_IN_REGISTRY");
  });

  it("rejects every trusted record that omits its approved final HTTPS URL", () => {
    const updatedAt = new Date();
    const report = verificationReport(updatedAt);
    const record = report.records[0] as unknown as Partial<VerifiedSourceApprovalRecord>;
    delete record.approvedSourceUrl;
    const row = {
      _id: "source-trusted",
      sourceUrl: "https://example.edu.tr/duyurular",
      scopeType: "university",
      scopeId: "example-university",
      contentType: "announcement",
      status: "active",
      updatedAt
    } as unknown as MongoDocument;

    expect(() => selectVerifiedSourceDocuments([row], [], report))
      .toThrow("CONTENT_RECONCILIATION_VERIFIED_AUTHORITY_EVIDENCE_INVALID");
  });

  it("derives exact university, faculty, and department authorities from the checked-in registry shape", () => {
    const authorities = buildVerifiedRegistryScopeUrls([{
      universityId: "example-university",
      universityName: "Example University",
      announcementUrl: "https://example.edu.tr/announcements"
    }], [{
      scopeType: "faculty",
      universityId: "example-university",
      facultyId: "example-faculty",
      websiteUrl: "https://faculty.example.edu.tr"
    }, {
      scopeType: "department",
      universityId: "example-university",
      facultyId: "example-faculty",
      departmentId: "example-department",
      announcementUrl: "https://department.example.edu.tr/announcements"
    }]);

    expect(authorities["university:example-university"]).toContain("https://example.edu.tr/announcements");
    expect(authorities["faculty:example-faculty"]).toEqual(expect.arrayContaining([
      "https://faculty.example.edu.tr",
      "https://example.edu.tr/announcements"
    ]));
    expect(authorities["department:example-department"]).toEqual(expect.arrayContaining([
      "https://department.example.edu.tr/announcements",
      "https://faculty.example.edu.tr",
      "https://example.edu.tr/announcements"
    ]));
  });

  it("loads the checked-in authority registry used by the production gate", async () => {
    const authorities = await buildCheckedInVerifiedScopeUrls();
    expect(Object.keys(authorities).length).toBeGreaterThan(200);
  });

  it("rejects private DNS evidence even when every manifest trust flag is self-asserted", () => {
    const updatedAt = new Date();
    const row = {
      _id: "source-trusted",
      sourceUrl: "https://example.edu.tr/duyurular",
      scopeType: "university",
      scopeId: "example-university",
      contentType: "announcement",
      status: "active",
      updatedAt
    } as unknown as MongoDocument;
    const report = verificationReport(updatedAt);
    const record = report.records[0] as unknown as VerifiedSourceApprovalRecord;
    record.http.dns.addresses = ["192.168.10.25"];

    expect(() => selectVerifiedSourceDocuments([row], [], report))
      .toThrow("CONTENT_RECONCILIATION_VERIFIED_AUTHORITY_EVIDENCE_INVALID");
  });

  it("upgrades a verified HTTP redirect with an official host rename in source and item postimages", () => {
    const report = verificationReport(new Date());
    const record = report.records[0] as unknown as VerifiedSourceApprovalRecord;
    record.sourceUrl = "http://bilnews.bilkent.edu.tr/";
    record.finalUrl = "https://bilkentnews.bilkent.edu.tr/";
    record.approvedSourceUrl = record.finalUrl;
    record.upgradeToHttps = true;
    record.registryAuthorityUrls = [record.sourceUrl];
    record.domainAuthorityUrls = [record.sourceUrl, record.finalUrl];
    record.authorityDomains = ["bilkent.edu.tr"];
    record.http.sourceProtocol = "http:";
    record.http.finalHostname = "bilkentnews.bilkent.edu.tr";
    record.http.redirects = [{ status: 301, from: record.sourceUrl, to: record.finalUrl }];
    record.redirectSafety.checkedHopCount = 1;
    record.validationAttempts[0]!.finalUrl = record.finalUrl;
    record.duplicateRisk.finalCanonicalUrl = record.finalUrl;
    const source: ReconciliationSourceDocument = {
      id: record.id,
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Bilkent News",
      contentType: "news",
      sourceUrl: record.sourceUrl,
      status: "active"
    };
    record.contentType = "news";
    const item: ReconciliationItemDocument = {
      id: "bilkent-item",
      sourceId: record.id,
      contentType: "news",
      scopeType: "university",
      scopeId: "example-university",
      title: "Kampüs haberi",
      link: "https://bilkentnews.bilkent.edu.tr/news/42"
    };

    const plan = planAnnouncementContentReconciliation({
      sources: [source],
      items: [item],
      officialScopeUrls: { "university:example-university": record.registryAuthorityUrls },
      verifiedSourceUrlOverrides: verifiedSourceUrlOverrides(report)
    });
    const applied = applyPlan([source], [item], plan);

    expect(applied.sources[0]).toEqual(expect.objectContaining({
      sourceUrl: record.finalUrl,
      canonicalUrl: record.finalUrl,
      trustStatus: "trusted"
    }));
    expect(applied.items[0]).toEqual(expect.objectContaining({
      officialSourceUrl: record.finalUrl,
      trustStatus: "trusted"
    }));
  });

  it("plans against the full source set before filtering approved mutations so legacy unique keys stay collision-safe", () => {
    const exact: ReconciliationSourceDocument = {
      id: "unapproved-exact",
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Exact",
      sourceUrl: "https://example.edu.tr/duyurular",
      status: "active"
    };
    const approvedAlias: ReconciliationSourceDocument = {
      ...exact,
      id: "approved-alias",
      sourceName: "Alias",
      sourceUrl: "https://example.edu.tr/duyurular?utm_source=legacy"
    };
    const fullPlan = planAnnouncementContentReconciliation({
      sources: [approvedAlias, exact],
      items: [],
      officialScopeUrls: { "university:example-university": ["https://example.edu.tr"] }
    });

    const selected = filterReconciliationPlanToApprovedDocuments(fullPlan, [approvedAlias.id], []);

    expect(selected.sources).toHaveLength(1);
    expect(selected.sources[0]).toEqual(expect.objectContaining({
      id: approvedAlias.id,
      set: expect.objectContaining({
        trustStatus: "rejected",
        duplicateOfId: exact.id
      })
    }));
    expect(selected.sources[0]!.set).not.toHaveProperty("sourceUrl");
  });

  it("uses frozen non-trusted verdicts in full planning context without selecting those rows for mutation", () => {
    const rejectedExact: ReconciliationSourceDocument = {
      id: "manifest-rejected-exact",
      scopeType: "university",
      scopeId: "example-university",
      contentType: "announcement",
      sourceName: "Rejected exact",
      sourceUrl: "https://example.edu.tr/duyurular",
      status: "active"
    };
    const approvedAlias: ReconciliationSourceDocument = {
      ...rejectedExact,
      id: "manifest-trusted-alias",
      sourceName: "Trusted alias",
      sourceUrl: "https://example.edu.tr/duyurular?utm_source=legacy"
    };

    const fullPlan = planAnnouncementContentReconciliation({
      sources: [rejectedExact, approvedAlias],
      items: [],
      officialScopeUrls: { "university:example-university": ["https://example.edu.tr"] },
      verifiedSourceTrustOverrides: {
        [rejectedExact.id]: { trustStatus: "rejected", trustReasonCodes: ["unofficial_source"] }
      }
    });
    const projected = applyPlan([rejectedExact, approvedAlias], [], fullPlan).sources;
    expect(projected.find((source) => source.id === rejectedExact.id)).toEqual(expect.objectContaining({
      trustStatus: "rejected",
      status: "inactive"
    }));
    expect(projected.find((source) => source.id === approvedAlias.id)).toEqual(expect.objectContaining({
      trustStatus: "trusted"
    }));
    expect(projected.find((source) => source.id === approvedAlias.id)).not.toHaveProperty("duplicateOfId");

    const selected = filterReconciliationPlanToApprovedDocuments(fullPlan, [approvedAlias.id], []);
    expect(selected.sources.every((mutation) => mutation.id === approvedAlias.id)).toBe(true);
  });

  it("requires every source row to match the frozen manifest planning preimage", () => {
    const updatedAt = new Date();
    const report = verificationReport(updatedAt);
    const record = report.records[0]!;
    record.verdict = "rejected";
    record.reasonCodes = ["official_domain_mismatch"];
    report.summary.verdicts = { trusted: 0, rejected: 1, quarantined: 0 };
    report.recommended = {
      trustedSourceIds: [],
      rejectedSourceIds: ["source-trusted"],
      quarantinedSourceIds: []
    };
    report.classificationGuarantees = {
      ...report.classificationGuarantees,
      trustedRecordCount: 0,
      trustedApprovedHttpsCount: 0,
      trustedDirectHttpsCount: 0,
      rejectedRecordCount: 1
    };
    const row = {
      _id: "source-trusted",
      sourceUrl: "https://example.edu.tr/duyurular",
      scopeType: "university",
      scopeId: "example-university",
      contentType: "announcement",
      status: "active",
      updatedAt
    } as unknown as MongoDocument;

    expect(verifiedSourceTrustOverrides([row], report)).toEqual({
      "source-trusted": { trustStatus: "rejected", trustReasonCodes: ["unofficial_source"] }
    });
    expect(() => verifiedSourceTrustOverrides([{ ...row, scopeId: "changed-university" }], report))
      .toThrow("CONTENT_RECONCILIATION_VERIFIED_PLANNING_CONTEXT_MISMATCH");
  });

  it("reports the exact projected outcome only for approved source and item documents", () => {
    const sources = [
      { _id: "source-trusted", status: "active", trustStatus: "trusted" },
      { _id: "source-rejected", status: "active", trustStatus: "trusted" },
      { _id: "source-quarantined", status: "inactive" }
    ] as unknown as MongoDocument[];
    const items = [
      { _id: "item-trusted", trustStatus: "trusted" },
      { _id: "item-rejected", trustStatus: "trusted" },
      { _id: "item-quarantined" }
    ] as unknown as MongoDocument[];
    const plan = {
      sources: [{
        id: "source-rejected",
        preimageHash: "source-preimage",
        set: { status: "inactive", trustStatus: "rejected", duplicateOfId: "source-trusted" },
        unset: []
      }],
      items: [{
        id: "item-rejected",
        preimageHash: "item-preimage",
        set: { trustStatus: "rejected", duplicateOfId: "item-trusted" },
        unset: []
      }]
    };

    const summary = summarizeApprovedTargetOutcome(sources, items, plan);
    expect(summary).toEqual({
      sources: { trusted: 1, rejected: 1, quarantined: 1, active: 1, inactive: 2 },
      items: { trusted: 1, rejected: 1, quarantined: 1 },
      sourceDuplicates: 1,
      itemDuplicates: 1,
      duplicates: 2
    });
    expect(() => assertApprovedSourceOutcome(3, summary))
      .toThrow("CONTENT_RECONCILIATION_APPROVED_SOURCE_OUTCOME_INVALID");
    expect(() => assertApprovedSourceOutcome(1, {
      ...summary,
      sources: { trusted: 1, rejected: 0, quarantined: 0, active: 1, inactive: 0 },
      sourceDuplicates: 0,
      duplicates: summary.itemDuplicates
    })).not.toThrow();
  });

  it("requires every approved source projection to use its exact verified HTTPS postcondition", () => {
    const updatedAt = new Date();
    const report = verificationReport(updatedAt);
    const source = {
      _id: "source-trusted",
      sourceUrl: "https://example.edu.tr/duyurular?utm_source=legacy",
      scopeType: "university",
      scopeId: "example-university",
      contentType: "announcement",
      status: "active",
      updatedAt
    } as unknown as MongoDocument;
    const validMutation: ReconciliationMutation = {
      id: "source-trusted",
      preimageHash: "hash",
      set: {
        sourceUrl: "https://example.edu.tr/duyurular",
        canonicalUrl: "https://example.edu.tr/duyurular",
        status: "active",
        trustStatus: "trusted",
        trustReasonCodes: []
      },
      unset: []
    };

    expect(() => assertApprovedSourcePostconditions([source], [validMutation], report)).not.toThrow();
    expect(() => assertApprovedSourcePostconditions([source], [{
      ...validMutation,
      set: { ...validMutation.set, sourceUrl: source.sourceUrl }
    }], report)).toThrow("CONTENT_RECONCILIATION_APPROVED_SOURCE_POSTCONDITION_INVALID");
  });

  it("rechecks an approved source with no source mutation immediately before item writes", async () => {
    const updatedAt = new Date();
    const original = {
      _id: "source-trusted",
      sourceUrl: "https://example.edu.tr/duyurular",
      scopeType: "university",
      scopeId: "example-university",
      contentType: "announcement",
      status: "active",
      updatedAt
    } as unknown as MongoDocument;
    const report = verificationReport(updatedAt);
    const record = report.records[0] as unknown as VerifiedSourceApprovalRecord;
    const stableCollection = {
      findOne: vi.fn(async () => ({ ...original }))
    } as unknown as Collection<MongoDocument>;
    await expect(verifyApprovedSourceFences({
      collection: stableCollection,
      selectedSources: [original],
      records: new Map([["source-trusted", record]]),
      mutations: []
    })).resolves.toEqual({ conflicts: 0 });

    const changedCollection = {
      findOne: vi.fn(async () => ({ ...original, sourceUrl: "https://example.edu.tr/changed" }))
    } as unknown as Collection<MongoDocument>;
    await expect(verifyApprovedSourceFences({
      collection: changedCollection,
      selectedSources: [original],
      records: new Map([["source-trusted", record]]),
      mutations: []
    })).resolves.toEqual({ conflicts: 1 });
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
      updatedAtPreimages: new Map([[mutation.id, plannedUpdatedAt]]),
      preimageHash: (document) => document.sourceName === "Concurrent source edit" ? "changed-preimage" : "expected-preimage"
    })).resolves.toEqual({ applied: 0, conflicts: 1 });
    expect(preimageUpdate).not.toHaveBeenCalled();

    const timestampOnlyUpdate = vi.fn(async () => ({ modifiedCount: 1 }));
    const timestampOnlyCollection = {
      findOne: vi.fn(async () => ({
        _id: databaseId,
        sourceName: "Original source",
        updatedAt: new Date("2026-07-30T08:01:00.000Z")
      })),
      updateOne: timestampOnlyUpdate
    } as unknown as Collection<MongoDocument>;
    await expect(applyPersistedMutations({
      collection: timestampOnlyCollection,
      ids: new Map([[mutation.id, databaseId]]),
      mutations: [mutation],
      batchSize: 1,
      documentType: "source",
      updatedAtPreimages: new Map([[mutation.id, plannedUpdatedAt]]),
      preimageHash: () => "expected-preimage"
    })).resolves.toEqual({ applied: 0, conflicts: 1 });
    expect(timestampOnlyUpdate).not.toHaveBeenCalled();

    const updatedAtUpdate = vi.fn(async (_filter: unknown, _update: unknown) => ({ modifiedCount: 0 }));
    const updatedAtCollection = {
      findOne: vi.fn(async () => ({
        _id: databaseId,
        scopeType: "university",
        scopeId: "example-university",
        contentType: "announcement",
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
      updatedAtPreimages: new Map([[mutation.id, plannedUpdatedAt]]),
      preimageHash: () => "expected-preimage"
    })).resolves.toEqual({ applied: 0, conflicts: 1 });
    expect(updatedAtUpdate).toHaveBeenCalledOnce();
    expect(updatedAtUpdate.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      _id: databaseId,
      updatedAt: plannedUpdatedAt,
      scopeType: { $exists: true, $eq: "university" },
      scopeId: { $exists: true, $eq: "example-university" },
      contentType: { $exists: true, $eq: "announcement" }
    }));
  });

  it("rejects concurrent source and item ownership changes even when updatedAt is unchanged", async () => {
    const updatedAt = new Date("2026-07-30T08:00:00.000Z");
    const source = {
      _id: "mongo-source-1",
      scopeType: "university",
      scopeId: "example-university",
      contentType: "announcement",
      sourceName: "Original source",
      sourceUrl: "https://example.edu.tr/announcements",
      updatedAt
    } as unknown as MongoDocument;
    const sourceMutation: ReconciliationMutation = {
      id: "source-1",
      preimageHash: sourceReconciliationPreimageHash(source),
      set: { sourceName: "Normalized source" },
      unset: []
    };
    const sourceUpdate = vi.fn(async () => ({ modifiedCount: 1 }));
    const sourceCollection = {
      findOne: vi.fn(async () => ({ ...source, scopeId: "attacker-university" })),
      updateOne: sourceUpdate
    } as unknown as Collection<MongoDocument>;

    await expect(applyPersistedMutations({
      collection: sourceCollection,
      ids: new Map([[sourceMutation.id, source._id]]),
      mutations: [sourceMutation],
      batchSize: 1,
      documentType: "source",
      updatedAtPreimages: new Map([[sourceMutation.id, updatedAt]]),
      preimageHash: sourceReconciliationPreimageHash
    })).resolves.toEqual({ applied: 0, conflicts: 1 });
    expect(sourceUpdate).not.toHaveBeenCalled();

    const item = {
      _id: "mongo-item-1",
      sourceId: "source-1",
      scopeType: "university",
      scopeId: "example-university",
      contentType: "announcement",
      title: "Announcement",
      link: "https://example.edu.tr/announcements/1",
      updatedAt
    } as unknown as MongoDocument;
    const itemMutation: ReconciliationMutation = {
      id: "item-1",
      preimageHash: itemReconciliationPreimageHash(item),
      set: { title: "Normalized announcement" },
      unset: []
    };
    const itemUpdate = vi.fn(async () => ({ modifiedCount: 1 }));
    const itemCollection = {
      findOne: vi.fn(async () => ({ ...item, sourceId: "attacker-source" })),
      updateOne: itemUpdate
    } as unknown as Collection<MongoDocument>;

    await expect(applyPersistedMutations({
      collection: itemCollection,
      ids: new Map([[itemMutation.id, item._id]]),
      mutations: [itemMutation],
      batchSize: 1,
      documentType: "item",
      updatedAtPreimages: new Map([[itemMutation.id, updatedAt]]),
      preimageHash: itemReconciliationPreimageHash
    })).resolves.toEqual({ applied: 0, conflicts: 1 });
    expect(itemUpdate).not.toHaveBeenCalled();
    expect(reconciliationPreimageFilter(item, "item")).toEqual(expect.objectContaining({
      sourceId: { $exists: true, $eq: "source-1" },
      scopeType: { $exists: true, $eq: "university" },
      scopeId: { $exists: true, $eq: "example-university" },
      contentType: { $exists: true, $eq: "announcement" }
    }));
  });

  it("builds catalog-backed authority for university, faculty, and department scopes", () => {
    const authority = buildOfficialScopeUrls(
      [{
        _id: "university-1",
        id: "university-catalog-id",
        slug: "synthetic-university",
        websiteUrl: " https://example.edu.tr ",
        announcementUrl: "https://news.example.edu.tr/duyurular",
        academicCalendarUrl: "https://example.edu.tr/takvim",
        emailDomains: ["example.edu.tr", 42]
      }],
      [{
        _id: "faculty-1",
        id: "synthetic-university__engineering-faculty",
        slug: "engineering-faculty",
        universityId: "synthetic-university",
        websiteUrl: "https://faculty.example.edu.tr"
      }],
      [{
        _id: "department-1",
        id: "synthetic-university__engineering-faculty__computer-engineering",
        slug: "computer-engineering",
        facultyId: "synthetic-university__engineering-faculty",
        websiteUrl: "https://department.example.edu.tr",
        courseScheduleUrl: "https://department.example.edu.tr/ders-programi"
      }]
    );

    expect(authority["university:university-1"]).toEqual([
      "https://example.edu.tr",
      "https://news.example.edu.tr/duyurular",
      "https://example.edu.tr/takvim"
    ]);
    expect(authority["university:university-catalog-id"]).toEqual(authority["university:university-1"]);
    expect(authority["university:synthetic-university"]).toEqual(authority["university:university-1"]);
    expect(authority["faculty:faculty-1"]).toEqual([
      "https://faculty.example.edu.tr",
      "https://example.edu.tr",
      "https://news.example.edu.tr/duyurular",
      "https://example.edu.tr/takvim"
    ]);
    expect(authority["faculty:synthetic-university__engineering-faculty"])
      .toEqual(authority["faculty:faculty-1"]);
    expect(authority["faculty:engineering-faculty"]).toEqual(authority["faculty:faculty-1"]);
    expect(authority["department:department-1"]).toEqual([
      "https://department.example.edu.tr",
      "https://department.example.edu.tr/ders-programi",
      "https://faculty.example.edu.tr",
      "https://example.edu.tr",
      "https://news.example.edu.tr/duyurular",
      "https://example.edu.tr/takvim"
    ]);
    expect(authority["department:synthetic-university__engineering-faculty__computer-engineering"])
      .toEqual(authority["department:department-1"]);
    expect(authority["department:computer-engineering"]).toEqual(authority["department:department-1"]);
    expect(authority["university:yok-council-of-higher-education"])
      .toEqual(BUILT_IN_OFFICIAL_SCOPE_URLS["university:yok-council-of-higher-education"]);
  });

  it("fails ambiguous catalog aliases closed instead of merging two universities' trust roots", () => {
    const authority = buildOfficialScopeUrls([
      { _id: "university-a", slug: "colliding-university", websiteUrl: "https://a.edu.tr" },
      { _id: "university-b", id: "colliding-university", websiteUrl: "https://b.edu.tr" }
    ], [], []);

    expect(authority["university:university-a"]).toEqual(["https://a.edu.tr"]);
    expect(authority["university:university-b"]).toEqual(["https://b.edu.tr"]);
    expect(authority).not.toHaveProperty("university:colliding-university");
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

function verificationReport(updatedAt: Date): VerifiedSourceApprovalReport {
  const verifiedAt = new Date().toISOString();
  return {
    schemaVersion: 2,
    revision: 6,
    state: "frozen",
    frozenAt: verifiedAt,
    generatedAt: verifiedAt,
    databaseName: "academic_content_phase2",
    policy: {
      authority: "exact URL in checked-in verified source registry for the same scope/content type"
    },
    summary: {
      sourceDocuments: 1,
      verdicts: { trusted: 1, rejected: 0, quarantined: 0 },
      multiTrustedFinalCanonicalGroups: 0
    },
    validationContract: {
      schemaVersion: 2,
      databaseName: "academic_content_phase2",
      trustedRequires: ["verified registry authority", "approved final HTTPS URL"],
      preimageFenceFields: ["sourceUrl", "canonicalUrl", "status", "trustStatus", "updatedAt"],
      nonTrustedAction: "No automatic trust approval"
    },
    classificationGuarantees: {
      checkedRecordCount: 1,
      trustedRecordCount: 1,
      trustedApprovedHttpsCount: 1,
      trustedHttpPreimageHttpsUpgradeCount: 0,
      trustedDirectHttpsCount: 1,
      trustedAllAssertionsPassed: true,
      rejectedRecordCount: 0,
      quarantinedRecordCount: 0,
      nonTrustedAllHaveReasons: true,
      recommendedListsAreExactPartition: true,
      multiTrustedFinalCanonicalGroups: 0,
      crossContentFinalGroupsChecked: 1,
      expectedRev6DemotionsChecked: 5
    },
    manualReview: {
      reviewedAt: verifiedAt,
      detailsArtifact: "manual-review.json",
      detailsSha256: "b".repeat(64)
    },
    recommended: {
      trustedSourceIds: ["source-trusted"],
      rejectedSourceIds: [],
      quarantinedSourceIds: []
    },
    records: [{
      id: "source-trusted",
      sourceUrl: "https://example.edu.tr/duyurular",
      canonicalUrl: null,
      finalUrl: "https://example.edu.tr/duyurular",
      approvedSourceUrl: "https://example.edu.tr/duyurular",
      upgradeToHttps: false,
      contentType: "announcement",
      scopeType: "university",
      scopeId: "example-university",
      verifiedAt,
      preimage: {
        sourceUrl: "https://example.edu.tr/duyurular",
        canonicalUrl: null,
        status: "active",
        trustStatus: null,
        updatedAt: updatedAt.toISOString()
      },
      officialDomainMatch: true,
      finalOfficialDomainMatch: true,
      verifiedRegistryMatch: true,
      registryAuthorityUrls: ["https://example.edu.tr/duyurular"],
      domainAuthorityUrls: ["https://example.edu.tr"],
      authorityDomains: ["example.edu.tr"],
      authorityValidatedAt: verifiedAt,
      http: {
        syntaxOk: true,
        sourceProtocol: "https:",
        status: 200,
        ok: true,
        error: null,
        redirects: [],
        finalHostname: "example.edu.tr",
        dns: { ok: true, addresses: ["93.184.216.34"] },
        contentTypeHeader: "text/html; charset=utf-8"
      },
      robots: { checked: true, disallowed: false },
      semanticSignals: {
        mediaType: "text/html",
        semanticScore: 10,
        challenge: false,
        login: false
      },
      duplicateRisk: {
        exactUrlSourceIds: ["source-trusted"],
        sameScopeAndTypeIds: ["source-trusted"],
        survivorId: "source-trusted",
        finalCanonicalUrl: "https://example.edu.tr/duyurular",
        finalCanonicalSurvivorId: "source-trusted"
      },
      validationAttempts: [{
        verifiedAt,
        status: 200,
        error: null,
        finalUrl: "https://example.edu.tr/duyurular",
        reasonCodes: []
      }],
      redirectSafety: {
        checkedHopCount: 0,
        everyHopOfficialDomain: true,
        everyTargetHttps: true,
        firstHopMatchesCheckedSource: true,
        lastHopMatchesFinalUrl: true,
        publicDnsResolvedBeforeEveryHop: true,
        evidenceContract: "public DNS is resolved before every request"
      },
      reasonCodes: [],
      verdict: "trusted"
    }]
  };
}
