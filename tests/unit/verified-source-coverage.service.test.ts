import { describe, expect, it } from "vitest";
import type {
  QuarantinedVerifiedSource,
  VerifiedAcademicUnitSource,
  VerifiedRegistrySourceEvidence,
  VerifiedUniversitySource
} from "../../apps/api/src/bootstrap/verified-source-registry.js";
import type { TurkiyeCatalogSeed } from "../../apps/api/src/bootstrap/yok-atlas-catalog-importer.js";
import {
  BUNDLED_SOURCE_COVERAGE_EXPECTATIONS,
  VERIFIED_SOURCE_COVERAGE_MAX_LIMIT,
  VerifiedSourceCoverageService,
  buildVerifiedSourceCoverageReadModel,
  loadBundledVerifiedSourceCoverageReadModel,
  queryVerifiedSourceCoverage
} from "../../apps/api/src/modules/source-discovery/verified-source-coverage.service.js";

const universityId = "test-universitesi";
const facultyId = `${universityId}__muhendislik-fakultesi`;
const departmentId = `${facultyId}__bilgisayar-muhendisligi`;

function fixtureCatalog(): TurkiyeCatalogSeed {
  return {
    source: "yok_atlas",
    sourceUrl: "https://catalog.example/",
    sourceRowCount: 1,
    includedRowCount: 1,
    universities: [{
      name: "Test Üniversitesi",
      slug: universityId,
      city: "Ankara",
      type: "state",
      faculties: [{
        name: "Mühendislik Fakültesi",
        slug: "muhendislik-fakultesi",
        departments: [{
          name: "Bilgisayar Mühendisliği",
          slug: "bilgisayar-muhendisligi",
          educationLevel: "bachelor"
        }]
      }]
    }]
  };
}

function evidence(
  sourceType: VerifiedRegistrySourceEvidence["sourceType"],
  url: string,
  publicationScope: VerifiedRegistrySourceEvidence["publicationScope"],
  unitType: VerifiedRegistrySourceEvidence["unitType"],
  scopeId: string
): VerifiedRegistrySourceEvidence {
  const digest = "a".repeat(64);
  const parserDigest = "c".repeat(64);
  const html = !url.endsWith(".pdf");
  const parserBacked = html && ["announcement", "news", "event", "course_schedule", "exam_schedule"].includes(sourceType);
  return {
    status: "verified",
    schemaVersion: 4,
    verifierVersion: "authority-pinned-browser-and-raw-v9",
    runId: "test-run",
    manifestHash: "b".repeat(64),
    universityId,
    unitType,
    scopeId,
    sourceType,
    sourceUrl: url,
    finalUrl: url,
    browserFinalUrl: url,
    rawFinalUrl: url,
    discoveryMethod: "navigation",
    publicationScope,
    httpStatus: 200,
    contentType: "text/html; charset=utf-8",
    officialDomain: true,
    semanticMatch: true,
    semanticReasons: [],
    parserCompatible: true,
    parserItemCount: ["announcement", "news", "event", "course_schedule", "exam_schedule"].includes(sourceType) ? 2 : 0,
    sampleItemUrls: [],
    sampleDetails: [],
    browserNetworkProofs: [{ hostname: "test.edu.tr", addresses: ["93.184.216.34"] }],
    verifiedAt: "2026-09-10T00:00:00.000Z",
    finalRevalidatedAt: "2026-09-10T01:00:00.000Z",
    sha256: digest,
    evidencePath: html ? `evidence/html/${digest}.html.gz` : `evidence/documents/${digest}.pdf`,
    ...(parserBacked ? {
      parserInputSha256: parserDigest,
      parserEvidencePath: `evidence/html/${parserDigest}.html.gz`
    } : {})
  };
}

function quarantine(field: string, url: string): QuarantinedVerifiedSource {
  return {
    id: `test:${field}`,
    status: "quarantined",
    field,
    url,
    reasonCode: "source_domain_mismatch",
    authorityDomains: ["test.edu.tr"]
  };
}

function fixtureSources(): {
  universitySources: VerifiedUniversitySource[];
  academicUnitSources: VerifiedAcademicUnitSource[];
} {
  const universityEventUrl = "https://test.edu.tr/etkinlikler";
  const universityNewsUrl = "https://test.edu.tr/haberler";
  const universityCalendarUrl = "https://test.edu.tr/akademik-takvim.pdf";
  const facultyAnnouncementUrl = "https://test.edu.tr/fakulte/duyurular";
  const departmentHomepageUrl = "https://test.edu.tr/fakulte/bolum";
  const departmentExamUrl = "https://test.edu.tr/fakulte/bolum/sinav-programi.pdf";
  return {
    universitySources: [{
      universityId,
      universityName: "Test Üniversitesi",
      eventUrl: universityEventUrl,
      newsUrl: universityNewsUrl,
      calendarUrl: universityCalendarUrl,
      rawUrls: { eventUrl: universityEventUrl, newsUrl: universityNewsUrl, calendarUrl: universityCalendarUrl },
      verificationByField: {
        eventUrl: evidence("event", universityEventUrl, "university_system", "university", universityId),
        newsUrl: evidence("news", universityNewsUrl, "university_system", "university", universityId),
        calendarUrl: evidence("academic_calendar", universityCalendarUrl, "university_system", "university", universityId)
      },
      quarantinedSources: []
    }],
    academicUnitSources: [{
      scopeType: "faculty",
      universityId,
      universityName: "Test Üniversitesi",
      facultyId,
      facultyName: "Mühendislik Fakültesi",
      websiteUrl: "https://test.edu.tr/fakulte",
      announcementUrl: facultyAnnouncementUrl,
      rawUrls: {
        websiteUrl: "https://test.edu.tr/fakulte",
        announcementUrl: facultyAnnouncementUrl,
        newsUrl: "https://outside.example/fakulte/haberler"
      },
      verificationByField: {
        announcementUrl: evidence("announcement", facultyAnnouncementUrl, "faculty_shared", "faculty", facultyId)
      },
      quarantinedSources: [quarantine("newsUrl", "https://outside.example/fakulte/haberler")]
    }, {
      scopeType: "department",
      universityId,
      universityName: "Test Üniversitesi",
      facultyId,
      facultyName: "Mühendislik Fakültesi",
      departmentId,
      departmentName: "Bilgisayar Mühendisliği",
      websiteUrl: departmentHomepageUrl,
      eventUrl: "https://test.edu.tr/fakulte/bolum/etkinlikler",
      examScheduleUrl: departmentExamUrl,
      rawUrls: {
        websiteUrl: departmentHomepageUrl,
        newsUrl: "https://outside.example/bolum/haberler",
        eventUrl: "https://test.edu.tr/fakulte/bolum/etkinlikler",
        examScheduleUrl: departmentExamUrl
      },
      verificationByField: {
        websiteUrl: evidence("academic_unit_page", departmentHomepageUrl, "department_specific", "department", departmentId),
        examScheduleUrl: evidence("exam_schedule", departmentExamUrl, "department_specific", "department", departmentId)
      },
      quarantinedSources: [quarantine("newsUrl", "https://outside.example/bolum/haberler")]
    }]
  };
}

describe("verified source coverage read model", () => {
  it("represents every catalog unit/source slot honestly without discovery artifacts", () => {
    const sources = fixtureSources();
    const model = buildVerifiedSourceCoverageReadModel({
      catalog: fixtureCatalog(),
      ...sources
    });

    expect(model.catalog).toEqual({ universities: 1, academicUnits: 2, faculties: 1, departments: 1 });
    expect(model.items).toHaveLength(12);
    expect(new Set(model.items.map((item) => item.id)).size).toBe(12);

    const item = (scopeId: string, sourceType: string) => model.items.find((entry) => entry.scopeId === scopeId && entry.sourceType === sourceType);
    expect(item(facultyId, "homepage")).toMatchObject({
      resolution: "legacy_unverified",
      evidencePresent: false,
      legacyReason: "final_revalidation_evidence_missing"
    });
    expect(item(facultyId, "news")).toMatchObject({
      resolution: "quarantined",
      quarantineReason: "source_domain_mismatch"
    });
    expect(item(facultyId, "event")).toMatchObject({
      resolution: "verified",
      inheritedFromScopeType: "university",
      inheritedFromScopeId: universityId,
      evidencePresent: true,
      evidenceArtifactReferencePresent: true,
      finalRevalidatedAt: "2026-09-10T01:00:00.000Z"
    });
    expect(item(facultyId, "event")).not.toHaveProperty("missingReason");
    expect(item(facultyId, "academic_calendar")).toMatchObject({
      resolution: "verified",
      publicationScope: "university_system",
      inheritedFromScopeType: "university",
      inheritedFromScopeId: universityId,
      evidencePresent: true,
      evidenceArtifactReferencePresent: true
    });
    expect(item(departmentId, "announcement")).toMatchObject({
      resolution: "verified",
      inheritedFromScopeType: "faculty",
      inheritedFromScopeId: facultyId,
      publicationScope: "faculty_shared"
    });
    expect(item(departmentId, "news")).toMatchObject({
      resolution: "quarantined",
      quarantineReason: "source_domain_mismatch"
    });
    expect(item(departmentId, "event")).toMatchObject({ resolution: "legacy_unverified" });
    expect(item(departmentId, "event")).not.toHaveProperty("inheritedFromScopeId");
    expect(item(departmentId, "academic_calendar")).toMatchObject({
      resolution: "verified",
      publicationScope: "university_system",
      inheritedFromScopeType: "university",
      inheritedFromScopeId: universityId
    });
    expect(item(departmentId, "course_schedule")).toMatchObject({
      resolution: "missing",
      missingReason: "no_registered_department_course_schedule_source",
      evidencePresent: false
    });
    expect(item(departmentId, "exam_schedule")).toMatchObject({ resolution: "verified" });
  });

  it("demotes stale or cross-owned evidence instead of reporting verified coverage", () => {
    const crossOwned = fixtureSources();
    crossOwned.academicUnitSources[0]!.verificationByField!.announcementUrl!.unitType = "department";
    const crossOwnedModel = buildVerifiedSourceCoverageReadModel({ catalog: fixtureCatalog(), ...crossOwned });
    expect(crossOwnedModel.items.find((item) => item.scopeId === facultyId && item.sourceType === "announcement"))
      .toMatchObject({ resolution: "legacy_unverified", evidencePresent: false });

    const stale = fixtureSources();
    Object.assign(
      stale.academicUnitSources[1]!.verificationByField!.websiteUrl as unknown as { verifierVersion: string },
      { verifierVersion: "authority-pinned-browser-and-raw-v7" }
    );
    const staleModel = buildVerifiedSourceCoverageReadModel({ catalog: fixtureCatalog(), ...stale });
    expect(staleModel.items.find((item) => item.scopeId === departmentId && item.sourceType === "homepage"))
      .toMatchObject({ resolution: "legacy_unverified", evidencePresent: false });
  });

  it("filters, summarizes, paginates, and orders deterministically", () => {
    const model = buildVerifiedSourceCoverageReadModel({ catalog: fixtureCatalog(), ...fixtureSources() });
    const departmentSearch = queryVerifiedSourceCoverage(model, {
      search: "Bilgisayar Mühendisliği",
      scopeType: "department",
      resolution: "verified",
      limit: 2,
      offset: 1
    });
    expect(departmentSearch.total).toBe(4);
    expect(departmentSearch.items.map((item) => item.sourceType)).toEqual(["announcement", "academic_calendar"]);
    expect(departmentSearch.summary).toMatchObject({
      catalog: { universities: 1, academicUnits: 2, faculties: 1, departments: 1 },
      filteredAcademicUnits: 1,
      filteredSourceSlots: 4,
      byResolution: { verified: 4, missing: 0, quarantined: 0, legacy_unverified: 0 },
      bySourceType: {
        homepage: { total: 1, verified: 1 },
        announcement: { total: 1, verified: 1 },
        academic_calendar: { total: 1, verified: 1 },
        exam_schedule: { total: 1, verified: 1 }
      }
    });

    const missingCourse = queryVerifiedSourceCoverage(model, {
      sourceType: "course_schedule",
      resolution: "missing",
      limit: 100,
      offset: 0
    });
    expect(missingCourse.total).toBe(1);
    expect(missingCourse.items[0]?.id).toBe(`${departmentId}:course_schedule`);

    const inheritedCalendars = queryVerifiedSourceCoverage(model, {
      sourceType: "academic_calendar",
      limit: 100,
      offset: 0
    });
    expect(inheritedCalendars.total).toBe(2);
    expect(inheritedCalendars.summary.bySourceType.academic_calendar).toMatchObject({ total: 2, verified: 2 });
    expect(inheritedCalendars.items.every((item) => item.inheritedFromScopeType === "university")).toBe(true);
  });

  it("fails closed for inherited university calendars without final university-system evidence", () => {
    const noEvidenceSources = fixtureSources();
    delete noEvidenceSources.universitySources[0]?.verificationByField?.calendarUrl;
    const legacyModel = buildVerifiedSourceCoverageReadModel({ catalog: fixtureCatalog(), ...noEvidenceSources });
    const legacyCalendars = legacyModel.items.filter((item) => item.sourceType === "academic_calendar");
    expect(legacyCalendars).toHaveLength(2);
    expect(legacyCalendars).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scopeId: facultyId,
        resolution: "legacy_unverified",
        evidencePresent: false,
        legacyReason: "final_revalidation_evidence_missing"
      }),
      expect.objectContaining({
        scopeId: departmentId,
        resolution: "legacy_unverified",
        evidencePresent: false,
        legacyReason: "final_revalidation_evidence_missing"
      })
    ]));

    const wrongScopeSources = fixtureSources();
    wrongScopeSources.universitySources[0]!.verificationByField!.calendarUrl = evidence(
      "academic_calendar",
      wrongScopeSources.universitySources[0]!.calendarUrl!,
      "university",
      "university",
      universityId
    );
    const quarantinedModel = buildVerifiedSourceCoverageReadModel({ catalog: fixtureCatalog(), ...wrongScopeSources });
    expect(quarantinedModel.items.filter((item) => item.sourceType === "academic_calendar")).toEqual([
      expect.objectContaining({
        scopeId: facultyId,
        resolution: "quarantined",
        evidencePresent: true,
        quarantineReason: "academic_calendar_publication_scope_not_university_system"
      }),
      expect.objectContaining({
        scopeId: departmentId,
        resolution: "quarantined",
        evidencePresent: true,
        quarantineReason: "academic_calendar_publication_scope_not_university_system"
      })
    ]);

    const missingSources = fixtureSources();
    delete missingSources.universitySources[0]!.calendarUrl;
    delete missingSources.universitySources[0]!.verificationByField!.calendarUrl;
    const missingModel = buildVerifiedSourceCoverageReadModel({ catalog: fixtureCatalog(), ...missingSources });
    expect(missingModel.items.filter((item) => item.sourceType === "academic_calendar"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ resolution: "missing", missingReason: "no_registered_university_academic_calendar_source" }),
        expect.objectContaining({ resolution: "missing", missingReason: "no_registered_university_academic_calendar_source" })
      ]));
  });

  it("rejects unsafe query bounds and invalid runtime enum values", () => {
    const model = buildVerifiedSourceCoverageReadModel({ catalog: fixtureCatalog(), ...fixtureSources() });
    expect(() => queryVerifiedSourceCoverage(model, { limit: VERIFIED_SOURCE_COVERAGE_MAX_LIMIT + 1 })).toThrow("SOURCE_COVERAGE_LIMIT_INVALID");
    expect(() => queryVerifiedSourceCoverage(model, { offset: -1 })).toThrow("SOURCE_COVERAGE_OFFSET_INVALID");
    expect(() => queryVerifiedSourceCoverage(model, { search: "x".repeat(201) })).toThrow("SOURCE_COVERAGE_SEARCH_INVALID");
    expect(() => queryVerifiedSourceCoverage(model, { universityId: "../escape" })).toThrow("SOURCE_COVERAGE_UNIVERSITY_ID_INVALID");
    expect(() => queryVerifiedSourceCoverage(model, { sourceType: "calendar" as never })).toThrow("SOURCE_COVERAGE_SOURCE_TYPE_INVALID");
    expect(() => queryVerifiedSourceCoverage(model, { resolution: "unknown" as never })).toThrow("SOURCE_COVERAGE_RESOLUTION_INVALID");
  });

  it("fails closed on duplicate catalog identities, wrong registry ownership, and count drift", () => {
    const duplicateCatalog = fixtureCatalog();
    duplicateCatalog.universities[0]?.faculties.push(structuredClone(duplicateCatalog.universities[0].faculties[0]!));
    expect(() => buildVerifiedSourceCoverageReadModel({
      catalog: duplicateCatalog,
      universitySources: [],
      academicUnitSources: []
    })).toThrow(`SOURCE_COVERAGE_DUPLICATE_CATALOG_SCOPE:${facultyId}`);

    const sources = fixtureSources();
    sources.academicUnitSources[0] = { ...sources.academicUnitSources[0]!, universityId: "wrong-university" };
    expect(() => buildVerifiedSourceCoverageReadModel({ catalog: fixtureCatalog(), ...sources }))
      .toThrow(`SOURCE_COVERAGE_REGISTRY_OWNERSHIP_MISMATCH:${facultyId}`);

    expect(() => buildVerifiedSourceCoverageReadModel({
      catalog: fixtureCatalog(),
      universitySources: [],
      academicUnitSources: [],
      expectedCatalog: { universities: 208, academicUnits: 17_360, departments: 14_428 }
    })).toThrow("SOURCE_COVERAGE_CATALOG_COUNT_MISMATCH");

    expect(() => buildVerifiedSourceCoverageReadModel({
      catalog: fixtureCatalog(),
      universitySources: [],
      academicUnitSources: [],
      expectedCatalog: { universities: 1, academicUnits: 2, departments: 1, sourceSlots: 10 }
    })).toThrow("SOURCE_COVERAGE_SOURCE_SLOT_COUNT_MISMATCH:12/10");
  });

  it("loads and caches the deploy-bundled 208/17,360 catalog and registries", async () => {
    const first = loadBundledVerifiedSourceCoverageReadModel();
    const second = loadBundledVerifiedSourceCoverageReadModel();
    expect(second).toBe(first);
    const model = await first;
    expect(model.catalog).toEqual({
      universities: BUNDLED_SOURCE_COVERAGE_EXPECTATIONS.universities,
      academicUnits: BUNDLED_SOURCE_COVERAGE_EXPECTATIONS.academicUnits,
      faculties: BUNDLED_SOURCE_COVERAGE_EXPECTATIONS.academicUnits - BUNDLED_SOURCE_COVERAGE_EXPECTATIONS.departments,
      departments: BUNDLED_SOURCE_COVERAGE_EXPECTATIONS.departments
    });
    expect(model.items).toHaveLength(model.catalog.faculties * 5 + model.catalog.departments * 7);
    expect(model.items).toHaveLength(BUNDLED_SOURCE_COVERAGE_EXPECTATIONS.sourceSlots);
    expect(BUNDLED_SOURCE_COVERAGE_EXPECTATIONS.sourceSlots).toBe(115_656);

    const response = await new VerifiedSourceCoverageService().listCoverage({ limit: 1, offset: 0 });
    expect(response.total).toBe(model.items.length);
    expect(response.items).toHaveLength(1);
    expect(response.summary.catalog.academicUnits).toBe(17_360);
  }, 30_000);
});
