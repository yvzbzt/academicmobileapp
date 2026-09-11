import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type SafeOutboundHopResponse
} from "../src/common/network/safe-outbound-request.js";
import { SourceAuthorityPolicy } from "../src/domain/source-authority-policy.js";
import { AnnouncementIngestionService } from "../src/modules/announcements/announcement-ingestion.service.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import type { AnnouncementSourceRecord, AnnouncementSourceVerificationEvidence } from "../src/modules/announcements/announcements.types.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";

afterEach(() => {
  setSafeOutboundRequestDependenciesForTesting(undefined);
  vi.restoreAllMocks();
});

describe("announcement source authority boundaries", () => {
  it("uses the central policy at registration, fetch, redirect, and publication before persisting", async () => {
    const catalog = await createAguCatalog();
    const repository = new InMemoryAnnouncementRepository();
    await repository.upsertSource({
      scopeType: "university",
      scopeId: "abdullah-gul-universitesi-kayseri",
      sourceName: "AGU Duyurular",
      sourceUrl: "https://agu.edu.tr/duyurular",
      homepageUrl: "https://agu.edu.tr/",
      contentType: "announcement",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    const requestHop = vi.fn(async (_url, pinnedAddress): Promise<SafeOutboundHopResponse> => ({
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from('<a href="/duyuru/1">Akademik takvim duyurusu</a>'),
        remoteAddress: pinnedAddress.address
      }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop
    });
    const evaluate = vi.spyOn(SourceAuthorityPolicy.prototype, "evaluate");

    const result = await new AnnouncementIngestionService(catalog, repository).runIngestion();
    const [reviewItem] = await repository.listReviewItems({ limit: 10 });
    expect(reviewItem?.contentFingerprint).toBeTruthy();
    await repository.updateReviewItem(reviewItem!.id, { reviewStatus: "approved" }, {
      ...(reviewItem!.snapshotId ? { expectedSnapshotId: reviewItem!.snapshotId } : {}),
      expectedContentFingerprint: reviewItem!.contentFingerprint!,
      ...(reviewItem!.reviewRevision ? { expectedReviewRevision: reviewItem!.reviewRevision } : {})
    });

    expect(result.summary).toMatchObject({ healthy: 1, failed: 0 });
    expect(await repository.listItemsByScope({
      universityId: "abdullah-gul-universitesi-kayseri",
      limit: 10
    })).toHaveLength(1);
    const boundaries = evaluate.mock.calls.map(([input]) => input.boundary);
    expect(boundaries).toContain("registration");
    expect(boundaries).toContain("fetch");
    expect(boundaries).toContain("publication");
  });

  it("quarantines a cross-owner active source before transport or persistence", async () => {
    const catalog = await createAguCatalog();
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "abdullah-gul-universitesi-kayseri",
      sourceName: "Yanlış kurum kaynağı",
      sourceUrl: "https://www.ankara.edu.tr/duyurular",
      contentType: "announcement",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    const requestHop = vi.fn(async (): Promise<SafeOutboundHopResponse> => {
      throw new Error("transport must not run");
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop
    });

    const result = await new AnnouncementIngestionService(catalog, repository).runIngestion();
    const quarantined = await repository.findSourceById(source.id);

    expect(result.results[0]).toMatchObject({ status: "failed", error: "source_domain_mismatch" });
    expect(requestHop).not.toHaveBeenCalled();
    expect(quarantined).toMatchObject({
      status: "inactive",
      trustStatus: "quarantined",
      trustReasonCodes: ["source_domain_mismatch"]
    });
    expect(await repository.listItemsForSource(source.id)).toEqual([]);
  });

  it("records a rejected manual registration as inactive quarantine", async () => {
    const catalog = await createAguCatalog();
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog, repository);

    await expect(service.createManualSource({
      universityId: "abdullah-gul-universitesi-kayseri",
      scopeType: "university",
      sourceName: "Başka kurum duyuruları",
      sourceUrl: "https://www.ankara.edu.tr/duyurular",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      fetchIntervalMinutes: 180
    })).rejects.toThrow("source_domain_mismatch");

    expect(await repository.listAllSources({ limit: 10 })).toEqual([
      expect.objectContaining({
        status: "inactive",
        trustStatus: "quarantined",
        trustReasonCodes: ["source_domain_mismatch"]
      })
    ]);
  });

  it("quarantines an authority-valid manual source until explicit human approval", async () => {
    const catalog = new InMemoryCatalogRepository();
    await catalog.createUniversity({
      name: "Gaziantep Universitesi",
      slug: "gaziantep-universitesi",
      city: "Gaziantep",
      type: "state",
      websiteUrl: "https://www.gantep.edu.tr/",
      status: "active"
    });
    const requestHop = vi.fn(async (_url, pinnedAddress): Promise<SafeOutboundHopResponse> => ({
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from('<a href="/duyuru/1">Akademik takvim duyurusu</a>'),
        remoteAddress: pinnedAddress.address
      }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop
    });
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog, repository);

    const result = await service.createManualSource({
      universityId: "gaziantep-universitesi",
      scopeType: "university",
      sourceName: "Gaziantep duyurular",
      sourceUrl: "https://www.gaziantep.edu.tr/duyurular",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      fetchIntervalMinutes: 180
    });

    expect(result.source).toMatchObject({
      ownerUniversityId: "gaziantep-universitesi",
      sourceUrl: "https://www.gaziantep.edu.tr/duyurular",
      homepageUrl: "https://www.gaziantep.edu.tr/",
      status: "inactive",
      trustStatus: "quarantined"
    });
    expect(result.ingestion).toBeNull();
    expect(requestHop).not.toHaveBeenCalled();
  });

  it("revalidates and explicitly trusts a corrected quarantined source before activation", async () => {
    const catalog = await createAguCatalog();
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog, repository);
    await expect(service.createManualSource({
      universityId: "abdullah-gul-universitesi-kayseri",
      scopeType: "university",
      sourceName: "Correctable source",
      sourceUrl: "https://www.ankara.edu.tr/duyurular",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      fetchIntervalMinutes: 180
    })).rejects.toThrow("source_domain_mismatch");
    const [candidate] = await repository.listAllSources({ limit: 10 });
    expect(candidate).toMatchObject({ status: "inactive", trustStatus: "quarantined" });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop: async (_url, pinnedAddress): Promise<SafeOutboundHopResponse> => ({
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from('<a href="/duyuru/1">Akademik takvim duyurusu</a>'),
        remoteAddress: pinnedAddress.address
      })
    });

    const corrected = await service.updateManualSource(candidate!.id, {
      expectedSourceDefinitionVersion: candidate!.sourceDefinitionVersion ?? "",
      expectedCanonicalUrl: candidate!.canonicalUrl ?? candidate!.sourceUrl,
      expectedTrustStatus: candidate!.trustStatus ?? "quarantined",
      expectedSourceStatus: candidate!.status,
      expectedApprovalPending: candidate!.approvalPending === true,
      expectedUpdatedAt: candidate!.updatedAt.toISOString(),
      sourceUrl: "https://agu.edu.tr/duyurular",
      status: "active"
    });

    expect(corrected.source).toMatchObject({
      sourceUrl: "https://agu.edu.tr/duyurular",
      status: "inactive",
      trustStatus: "quarantined",
      trustReasonCodes: []
    });
    expect(corrected.ingestion).toBeNull();

    const approved = await service.approveSourceForAdmin(
      { kind: "global" },
      candidate!.id,
      "admin-1",
      {
        expectedSourceDefinitionVersion: corrected.source.sourceDefinitionVersion ?? "",
        expectedCanonicalUrl: corrected.source.canonicalUrl ?? corrected.source.sourceUrl,
        expectedTrustStatus: corrected.source.trustStatus ?? "quarantined",
        expectedSourceStatus: corrected.source.status,
        expectedApprovalPending: corrected.source.approvalPending === true,
        note: "Corrected official URL reviewed"
      }
    );
    expect(approved.source).toMatchObject({
      sourceUrl: "https://agu.edu.tr/duyurular",
      status: "active",
      trustStatus: "trusted",
      trustReasonCodes: []
    });
    expect(approved.ingestion).toMatchObject({ status: "healthy", itemCount: 1 });
  });

  it("does not promote a mutable catalog website into authority evidence", async () => {
    const catalog = new InMemoryCatalogRepository();
    await catalog.createUniversity({
      name: "Unverified University",
      slug: "unverified-university",
      city: "Ankara",
      type: "state",
      websiteUrl: "https://www.ankara.edu.tr/",
      status: "active"
    });
    const requestHop = vi.fn(async (): Promise<SafeOutboundHopResponse> => {
      throw new Error("transport must not run");
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop
    });
    const repository = new InMemoryAnnouncementRepository();
    const service = new AnnouncementIngestionService(catalog, repository);

    await expect(service.createManualSource({
      universityId: "unverified-university",
      scopeType: "university",
      sourceName: "Claimed Ankara source",
      sourceUrl: "https://www.ankara.edu.tr/duyurular",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      fetchIntervalMinutes: 180
    })).rejects.toThrow("missing_resolved_owner_academic_entity_id");

    expect(requestHop).not.toHaveBeenCalled();
    expect(await repository.listAllSources({ limit: 10 })).toEqual([
      expect.objectContaining({
        status: "inactive",
        trustStatus: "quarantined",
        trustReasonCodes: ["missing_resolved_owner_academic_entity_id"]
      })
    ]);
  });

  it("resolves department ownership with a constant number of owner-scoped catalog queries", async () => {
    const catalog = await createAguCatalog();
    const faculty = await catalog.createFaculty({
      universityId: "abdullah-gul-universitesi-kayseri",
      name: "Mühendislik Fakültesi",
      slug: "muhendislik-fakultesi",
      status: "active"
    });
    const department = await catalog.createDepartment({
      universityId: "abdullah-gul-universitesi-kayseri",
      facultyId: faculty.id,
      name: "Elektrik-Elektronik Mühendisliği",
      slug: "elektrik-elektronik-muhendisligi",
      educationLevel: "bachelor",
      status: "active"
    });
    const findUniversityById = vi.spyOn(catalog, "findUniversityById");
    const listUniversities = vi.spyOn(catalog, "listUniversities");
    const listFaculties = vi.spyOn(catalog, "listFaculties");
    const listDepartments = vi.spyOn(catalog, "listDepartments");
    const service = new AnnouncementIngestionService(catalog, new InMemoryAnnouncementRepository());
    const source = departmentSource({
      scopeId: department.id,
      ownerUniversityId: "abdullah-gul-universitesi-kayseri",
      ownerFacultyId: faculty.id
    });

    const resolved = await (service as unknown as {
      resolveAuthorityForSource(value: AnnouncementSourceRecord): Promise<unknown>;
    }).resolveAuthorityForSource(source);

    expect(resolved).toBeTruthy();
    expect(findUniversityById).toHaveBeenCalledTimes(1);
    expect(listFaculties).toHaveBeenCalledTimes(1);
    expect(listFaculties).toHaveBeenCalledWith("abdullah-gul-universitesi-kayseri", "active");
    expect(listDepartments).toHaveBeenCalledTimes(1);
    expect(listDepartments).toHaveBeenCalledWith(faculty.id, "active");
    expect(listUniversities).not.toHaveBeenCalled();
  });

  it("fails closed on persisted owner mismatch without falling back to a national catalog scan", async () => {
    const catalog = await createAguCatalog();
    const faculty = await catalog.createFaculty({
      universityId: "abdullah-gul-universitesi-kayseri",
      name: "Mühendislik Fakültesi",
      slug: "muhendislik-fakultesi",
      status: "active"
    });
    const listUniversities = vi.spyOn(catalog, "listUniversities");
    const listDepartments = vi.spyOn(catalog, "listDepartments");
    const service = new AnnouncementIngestionService(catalog, new InMemoryAnnouncementRepository());

    const resolved = await (service as unknown as {
      resolveAuthorityForSource(value: AnnouncementSourceRecord): Promise<unknown>;
    }).resolveAuthorityForSource(departmentSource({
      scopeId: `${faculty.id}__elektrik-elektronik-muhendisligi`,
      ownerUniversityId: "abdullah-gul-universitesi-kayseri",
      ownerFacultyId: "other-university__wrong-faculty"
    }));

    expect(resolved).toBeNull();
    expect(listUniversities).not.toHaveBeenCalled();
    expect(listDepartments).not.toHaveBeenCalled();
  });

  it("keeps source owners immutable and atomically attaches crawler evidence only once", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "department",
      scopeId: "university-1__faculty-1__department-1",
      ownerUniversityId: "university-1",
      ownerFacultyId: "university-1__faculty-1",
      sourceName: "Department announcements",
      sourceUrl: "https://example.edu.tr/announcements",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      status: "inactive",
      trustStatus: "quarantined"
    });
    const evidence = verificationEvidence({
      universityId: "university-1",
      unitType: "department",
      scopeId: "university-1__faculty-1__department-1"
    });

    await expect(repository.upsertSource({
      ...sourceInput(source),
      ownerUniversityId: "other-university",
      ownerFacultyId: "other-university__faculty-1"
    })).rejects.toThrow("ANNOUNCEMENT_SOURCE_OWNER_IMMUTABLE");
    expect(await repository.attachVerificationEvidenceIfMissing(source.id, evidence)).toMatchObject({ outcome: "attached" });
    expect(await repository.attachVerificationEvidenceIfMissing(source.id, evidence)).toMatchObject({ outcome: "unchanged" });
    expect(await repository.attachVerificationEvidenceIfMissing(source.id, {
      ...evidence,
      runId: "different-run"
    })).toMatchObject({ outcome: "conflict" });
    expect((await repository.findSourceById(source.id))?.verificationEvidence?.runId).toBe("run-1");
  });

  it("rejects unbounded or unsafe verification evidence before persistence", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "university-1",
      ownerUniversityId: "university-1",
      sourceName: "Announcements",
      sourceUrl: "https://example.edu.tr/announcements",
      contentType: "announcement",
      parser: "auto",
      priority: 10,
      status: "inactive",
      trustStatus: "quarantined"
    });

    await expect(repository.attachVerificationEvidenceIfMissing(source.id, {
      ...verificationEvidence(),
      sampleDetails: Array.from({ length: 3 }, (_, index) => ({
        url: `https://example.edu.tr/announcements/${index}`,
        status: "verified" as const,
        reasonCodes: []
      }))
    })).rejects.toThrow("ANNOUNCEMENT_SOURCE_VERIFICATION_SAMPLE_DETAILS_INVALID");
    await expect(repository.attachVerificationEvidenceIfMissing(source.id, {
      ...verificationEvidence(),
      evidencePath: "../outside/evidence.html"
    })).rejects.toThrow("ANNOUNCEMENT_SOURCE_VERIFICATION_EVIDENCE_PATH_INVALID");
    await expect(repository.attachVerificationEvidenceIfMissing(source.id, {
      ...verificationEvidence(),
      finalUrl: "https://example.edu.tr/announcements/other",
      browserFinalUrl: "https://example.edu.tr/announcements/other",
      rawFinalUrl: "https://example.edu.tr/announcements/other"
    })).rejects.toThrow("ANNOUNCEMENT_SOURCE_VERIFICATION_FINAL_URL_MISMATCH");
    expect((await repository.findSourceById(source.id))?.verificationEvidence).toBeUndefined();
  });
});

async function createAguCatalog(): Promise<InMemoryCatalogRepository> {
  const catalog = new InMemoryCatalogRepository();
  await catalog.createUniversity({
    name: "Abdullah Gül Üniversitesi",
    slug: "abdullah-gul-universitesi-kayseri",
    city: "Kayseri",
    type: "state",
    websiteUrl: "https://agu.edu.tr/",
    status: "active"
  });
  return catalog;
}

function departmentSource(input: Pick<AnnouncementSourceRecord, "scopeId" | "ownerUniversityId" | "ownerFacultyId">): AnnouncementSourceRecord {
  const now = new Date("2026-09-10T00:00:00.000Z");
  return {
    id: "department-source",
    scopeType: "department",
    ...input,
    sourceName: "Department announcements",
    sourceUrl: "https://agu.edu.tr/duyurular",
    contentType: "announcement",
    parser: "auto",
    priority: 10,
    status: "active",
    trustStatus: "trusted",
    createdAt: now,
    updatedAt: now
  };
}

function sourceInput(source: AnnouncementSourceRecord) {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = source;
  return input;
}

function verificationEvidence(ownership: {
  universityId: string;
  unitType: "university" | "faculty" | "department";
  scopeId: string;
} = { universityId: "university-1", unitType: "university", scopeId: "university-1" }): AnnouncementSourceVerificationEvidence {
  return {
    status: "verified",
    schemaVersion: 4,
    verifierVersion: "authority-pinned-browser-and-raw-v9",
    runId: "run-1",
    manifestHash: "a".repeat(64),
    ...ownership,
    sourceType: "announcement",
    sourceUrl: "https://example.edu.tr/announcements",
    finalUrl: "https://example.edu.tr/announcements",
    browserFinalUrl: "https://example.edu.tr/announcements",
    rawFinalUrl: "https://example.edu.tr/announcements",
    discoveryMethod: "navigation",
    publicationScope: ownership.unitType === "university"
      ? "university_system"
      : ownership.unitType === "faculty" ? "faculty_shared" : "department_specific",
    httpStatus: 200,
    contentType: "text/html",
    officialDomain: true,
    semanticMatch: true,
    semanticReasons: ["semantic_match"],
    parserProfile: "auto",
    parserCompatible: true,
    parserItemCount: 3,
    listingItemCount: 3,
    sampleItemUrls: ["https://example.edu.tr/announcements/1"],
    sampleDetails: [{
      url: "https://example.edu.tr/announcements/1",
      status: "verified",
      httpStatus: 200,
      reasonCodes: []
    }],
    browserNetworkProofs: [{ hostname: "example.edu.tr", addresses: ["93.184.216.34"] }],
    verifiedAt: "2026-09-10T00:00:00.000Z",
    finalRevalidatedAt: "2026-09-10T01:00:00.000Z",
    sha256: "b".repeat(64),
    evidencePath: `evidence/html/${"b".repeat(64)}.html.gz`,
    parserInputSha256: "c".repeat(64),
    parserEvidencePath: `evidence/html/${"c".repeat(64)}.html.gz`
  };
}
