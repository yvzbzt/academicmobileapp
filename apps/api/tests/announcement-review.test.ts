import { afterEach, describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import {
  OPENAI_RESPONSES_URL,
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress,
  type SafeOutboundRequestDependencies
} from "../src/common/network/safe-outbound-request.js";
import { AnnouncementIngestionService } from "../src/modules/announcements/announcement-ingestion.service.js";
import { toTrustedAcademicContentDto } from "../src/modules/announcements/announcement-content-trust.js";
import { AnnouncementReviewService } from "../src/modules/announcements/announcement-review.service.js";
import { ContentLlmSettingsService } from "../src/modules/announcements/content-llm-settings.service.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import type {
  AnnouncementItem,
  AnnouncementReviewFence,
  AnnouncementReviewItemUpdate,
  AnnouncementSourceRecord
} from "../src/modules/announcements/announcements.types.js";

afterEach(() => {
  setSafeOutboundRequestDependenciesForTesting(undefined);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function sourceReviewRequest(source: AnnouncementSourceRecord, note?: string) {
  return {
    expectedSourceDefinitionVersion: source.sourceDefinitionVersion ?? "",
    expectedCanonicalUrl: source.canonicalUrl ?? source.sourceUrl,
    expectedTrustStatus: source.trustStatus ?? "quarantined" as const,
    expectedSourceStatus: source.status,
    expectedApprovalPending: source.approvalPending === true,
    ...(note ? { note } : {})
  };
}

function approvalCatalog(scopeId = "tekirdag-namik-kemal-universitesi") {
  const university = {
    id: scopeId,
    name: "Example University",
    slug: scopeId,
    city: "Ankara",
    type: "state" as const,
    status: "active" as const,
    websiteUrl: "https://www.nku.edu.tr",
    createdAt: new Date(),
    updatedAt: new Date()
  };
  return {
    university,
    catalog: {
      findUniversityById: vi.fn(async (id: string) => id === university.id ? university : null),
      listUniversities: vi.fn(async () => [university]),
      listFaculties: vi.fn(async () => []),
      listDepartments: vi.fn(async () => [])
    }
  };
}

function approvedSourceItem(source: AnnouncementSourceRecord, id: string): AnnouncementItem {
  return {
    id,
    sourceId: source.id,
    sourceName: source.sourceName,
    contentType: source.contentType ?? "announcement",
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    title: "Approved historical item",
    link: `${new URL(source.sourceUrl).origin}/duyurular/${id}`,
    trustStatus: "trusted",
    reviewStatus: "approved",
    fetchedAt: new Date().toISOString()
  };
}

describe("announcement review workflow", () => {
  it("keeps discovered sources quarantined until an explicit authorized approval and supports rejection", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const university = {
      id: "tekirdag-namik-kemal-universitesi",
      name: "TEKİRDAĞ NAMIK KEMAL ÜNİVERSİTESİ",
      slug: "tekirdag-namik-kemal-universitesi",
      city: "Tekirdağ",
      type: "state" as const,
      status: "active" as const,
      websiteUrl: "https://www.nku.edu.tr",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const catalog = {
      findUniversityById: vi.fn(async (id: string) => id === university.id ? university : null),
      listUniversities: vi.fn(async () => [university]),
      listFaculties: vi.fn(async () => []),
      listDepartments: vi.fn(async () => [])
    };
    const candidate = await repository.insertQuarantinedSourceCandidate({
      scopeType: "university" as const,
      scopeId: university.id,
      sourceName: "NKÜ duyuruları",
      sourceUrl: "https://www.nku.edu.tr/duyurular",
      homepageUrl: university.websiteUrl,
      contentType: "announcement",
      parser: "html",
      priority: 10,
      discoveryMethod: "catalog_website",
      trustReasonCodes: []
    });
    const ingestion = new AnnouncementIngestionService(catalog as never, repository);
    vi.spyOn(ingestion, "ingestSource").mockImplementation(async (source) => {
      await repository.recordSourceCheck(source.id, {
        healthStatus: "healthy",
        lastCheckedAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        itemCount: 1
      }, source, source.activeSnapshotId ?? null);
      return {
        sourceId: source.id,
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        status: "healthy",
        itemCount: 1,
        sampleTitles: []
      };
    });

    const approved = await ingestion.approveSourceForAdmin(
      { kind: "global" },
      candidate.id,
      "admin-1",
      sourceReviewRequest(candidate, "Resmî menüden doğrulandı")
    );
    expect(approved.source).toMatchObject({
      status: "active",
      trustStatus: "trusted",
      approvalPending: false,
      reviewedBy: "admin-1"
    });

    const rejected = await ingestion.rejectSourceForAdmin(
      { kind: "global" },
      candidate.id,
      "admin-2",
      sourceReviewRequest(approved.source, "Yanlış liste")
    );
    expect(rejected).toMatchObject({ status: "inactive", trustStatus: "rejected", reviewedBy: "admin-2" });
  });

  it("admits only one health check for the same observed non-pending approval fence", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const { university, catalog } = approvalCatalog();
    const candidate = await repository.insertQuarantinedSourceCandidate({
      scopeType: "university",
      scopeId: university.id,
      sourceName: "Duplicate approval candidate",
      sourceUrl: "https://www.nku.edu.tr/duyurular",
      homepageUrl: university.websiteUrl,
      contentType: "announcement",
      parser: "html",
      priority: 10,
      discoveryMethod: "manual",
      trustReasonCodes: []
    });
    const ingestion = new AnnouncementIngestionService(catalog as never, repository);
    let signalStarted!: () => void;
    let releaseHealthCheck!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const healthCheckRelease = new Promise<void>((resolve) => { releaseHealthCheck = resolve; });
    const ingest = vi.spyOn(ingestion, "ingestSource").mockImplementation(async (pending) => {
      signalStarted();
      await healthCheckRelease;
      const checked = await repository.recordSourceCheck(pending.id, {
        healthStatus: "healthy",
        lastCheckedAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        itemCount: 1
      }, pending, pending.activeSnapshotId ?? null);
      if (!checked) throw new Error("Test source health CAS failed.");
      return {
        sourceId: pending.id,
        sourceName: pending.sourceName,
        sourceUrl: pending.sourceUrl,
        status: "healthy",
        itemCount: 1,
        sampleTitles: []
      };
    });
    const observedFence = sourceReviewRequest(candidate);
    const firstApproval = ingestion.approveSourceForAdmin(
      { kind: "global" }, candidate.id, "admin-first", observedFence
    );
    await started;

    const pending = await repository.findSourceById(candidate.id);
    if (!pending) throw new Error("Expected pending source approval.");
    await expect(ingestion.approveSourceForAdmin(
      { kind: "global" }, candidate.id, "admin-pending-duplicate", sourceReviewRequest(pending)
    )).rejects.toMatchObject({ status: 409 });

    await expect(ingestion.approveSourceForAdmin(
      { kind: "global" }, candidate.id, "admin-duplicate", observedFence
    )).rejects.toMatchObject({ status: 409 });
    expect(ingest).toHaveBeenCalledTimes(1);

    releaseHealthCheck();
    await expect(firstApproval).resolves.toMatchObject({
      source: { approvalPending: false, reviewedBy: "admin-first" }
    });
    await expect(ingestion.approveSourceForAdmin(
      { kind: "global" }, candidate.id, "admin-late-duplicate", observedFence
    )).rejects.toMatchObject({ status: 409 });
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale source fence and quarantines an approval whose ingestion is unhealthy", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const university = {
      id: "tekirdag-namik-kemal-universitesi",
      name: "TEKİRDAĞ NAMIK KEMAL ÜNİVERSİTESİ",
      slug: "tekirdag-namik-kemal-universitesi",
      city: "Tekirdağ",
      type: "state" as const,
      status: "active" as const,
      websiteUrl: "https://www.nku.edu.tr",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const catalog = {
      findUniversityById: vi.fn(async (id: string) => id === university.id ? university : null),
      listUniversities: vi.fn(async () => [university]),
      listFaculties: vi.fn(async () => []),
      listDepartments: vi.fn(async () => [])
    };
    const candidate = await repository.insertQuarantinedSourceCandidate({
      scopeType: "university",
      scopeId: university.id,
      sourceName: "Original review candidate",
      sourceUrl: "https://www.nku.edu.tr/duyurular",
      homepageUrl: university.websiteUrl,
      contentType: "announcement",
      parser: "html",
      priority: 10,
      discoveryMethod: "manual",
      trustReasonCodes: []
    });
    const notificationScheduling = {
      syncTrustedAnnouncementSource: vi.fn(async () => ({ active: [], retired: 0 })),
      retireTrustedAnnouncementSource: vi.fn(async () => ({ retired: 0 }))
    };
    const ingestion = new AnnouncementIngestionService(catalog as never, repository, notificationScheduling as never);
    const ingest = vi.spyOn(ingestion, "ingestSource").mockImplementation(async (source) => ({
      sourceId: source.id,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      status: "degraded",
      itemCount: 0,
      sampleTitles: [],
      error: "database-secret"
    }));
    const staleFence = sourceReviewRequest(candidate);
    const concurrentEdit = await repository.upsertSource({
      id: candidate.id,
      scopeType: candidate.scopeType,
      scopeId: candidate.scopeId,
      sourceName: "Concurrent source edit",
      sourceUrl: "https://www.nku.edu.tr/haberler",
      ...(candidate.homepageUrl ? { homepageUrl: candidate.homepageUrl } : {}),
      contentType: "news",
      parser: candidate.parser,
      priority: candidate.priority,
      status: "inactive",
      trustStatus: "quarantined"
    });

    await expect(ingestion.approveSourceForAdmin(
      { kind: "global" }, candidate.id, "admin-stale", staleFence
    )).rejects.toMatchObject({ status: 409 });
    expect(ingest).not.toHaveBeenCalled();
    expect(await repository.findSourceById(candidate.id)).toMatchObject({
      sourceName: "Concurrent source edit",
      sourceUrl: "https://www.nku.edu.tr/haberler",
      trustStatus: "quarantined"
    });

    let approvalError: unknown;
    try {
      await ingestion.approveSourceForAdmin(
        { kind: "global" }, candidate.id, "admin-current", sourceReviewRequest(concurrentEdit)
      );
    } catch (error) {
      approvalError = error;
    }
    expect(approvalError).toMatchObject({ status: 400 });
    expect(approvalError instanceof Error ? approvalError.message : String(approvalError)).not.toContain("database-secret");
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(await repository.findSourceById(candidate.id)).toMatchObject({
      status: "inactive",
      trustStatus: "quarantined"
    });
    expect(notificationScheduling.retireTrustedAnnouncementSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: candidate.id, status: "inactive", trustStatus: "quarantined" })
    );
    expect(notificationScheduling.syncTrustedAnnouncementSource).not.toHaveBeenCalled();
  });

  it("never republishes an approved historical snapshot while a rejected source approval is delayed or fails", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const { university, catalog } = approvalCatalog();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: university.id,
      sourceName: "Example announcements",
      sourceUrl: "https://www.nku.edu.tr/duyurular",
      homepageUrl: university.websiteUrl,
      contentType: "announcement",
      parser: "html",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [approvedSourceItem(source, "historical-approved")]);
    const historicalItem = (await repository.findReviewItemById("historical-approved"))?.item;
    if (!historicalItem) throw new Error("Expected historical review item.");
    await repository.updateReviewItem(
      historicalItem.id,
      { reviewStatus: "approved" },
      reviewFenceFor(historicalItem)
    );
    const rejected = await repository.reviewSource(
      source.id,
      { decision: "reject" },
      sourceReviewRequest(source)
    );
    if (!rejected) throw new Error("Test source rejection failed.");

    let signalStarted!: () => void;
    let finishIngestion!: (result: {
      sourceId: string;
      sourceName: string;
      sourceUrl: string;
      status: "degraded";
      itemCount: number;
      sampleTitles: string[];
      error: string;
    }) => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const delayedIngestion = new Promise<{
      sourceId: string;
      sourceName: string;
      sourceUrl: string;
      status: "degraded";
      itemCount: number;
      sampleTitles: string[];
      error: string;
    }>((resolve) => { finishIngestion = resolve; });
    const ingestion = new AnnouncementIngestionService(catalog as never, repository);
    const ingest = vi.spyOn(ingestion, "ingestSource").mockImplementation((pending) => {
      signalStarted();
      return delayedIngestion.then((result) => ({ ...result, sourceId: pending.id }));
    });

    const approval = ingestion.approveSourceForAdmin(
      { kind: "global" },
      rejected.id,
      "admin-1",
      sourceReviewRequest(rejected)
    );
    const failedApproval = approval.catch((error: unknown) => error);
    await started;

    expect(await repository.findSourceById(source.id)).toMatchObject({
      status: "active",
      trustStatus: "trusted",
      approvalPending: true
    });
    await expect(repository.listSourcesByScope({ universityId: university.id })).resolves.toEqual([]);
    await expect(repository.listItemsForSource(source.id)).resolves.toEqual([]);
    await expect(repository.listItemsByScope({ universityId: university.id, limit: 10 })).resolves.toEqual([]);
    await expect(repository.findTrustedItemByIdInScope({
      announcementId: "historical-approved",
      universityId: university.id
    })).resolves.toBeNull();
    await expect(repository.listAllItems()).resolves.toEqual([]);
    await expect(ingestion.runIngestion()).resolves.toMatchObject({ summary: { checkedSources: 0 } });
    expect(ingest).toHaveBeenCalledTimes(1);

    finishIngestion({
      sourceId: source.id,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      status: "degraded",
      itemCount: 0,
      sampleTitles: [],
      error: "delayed health failure"
    });
    expect(await failedApproval).toMatchObject({ status: 400 });
    expect(await repository.findSourceById(source.id)).toMatchObject({
      status: "inactive",
      trustStatus: "quarantined",
      approvalPending: false
    });
    await expect(repository.listItemsForSource(source.id)).resolves.toEqual([]);
  });

  it("keeps a crash-stuck approval visible as pending and safely republishes it on retry", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const { university, catalog } = approvalCatalog();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: university.id,
      sourceName: "Example announcements",
      sourceUrl: "https://www.nku.edu.tr/duyurular",
      homepageUrl: university.websiteUrl,
      contentType: "announcement",
      parser: "html",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [approvedSourceItem(source, "retry-approved")]);
    const retryItem = (await repository.findReviewItemById("retry-approved"))?.item;
    if (!retryItem) throw new Error("Expected retry review item.");
    await repository.updateReviewItem(
      retryItem.id,
      { reviewStatus: "approved" },
      reviewFenceFor(retryItem)
    );
    const rejected = await repository.reviewSource(
      source.id,
      { decision: "reject" },
      sourceReviewRequest(source)
    );
    if (!rejected) throw new Error("Test source rejection failed.");
    const stuck = await repository.reviewSource(
      source.id,
      { decision: "approve", reviewedBy: "admin-before-crash" },
      sourceReviewRequest(rejected)
    );
    if (!stuck) throw new Error("Test approval staging failed.");

    const ingestion = new AnnouncementIngestionService(catalog as never, repository);
    await expect(ingestion.listSourcesForAdmin({ kind: "global" })).resolves.toEqual([
      expect.objectContaining({
        id: source.id,
        approvalPending: true,
        reviewStatus: "pending_review",
        evidence: expect.objectContaining({ status: "blocked" })
      })
    ]);
    await expect(repository.listItemsForSource(source.id)).resolves.toEqual([]);
    await expect(ingestion.ingestSourceById(source.id)).rejects.toMatchObject({ status: 400 });

    vi.spyOn(ingestion, "ingestSource").mockImplementation(async (pending) => {
      const checked = await repository.recordSourceCheck(pending.id, {
        healthStatus: "healthy",
        lastCheckedAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        itemCount: 1
      }, pending, pending.activeSnapshotId ?? null);
      if (!checked) throw new Error("Test health CAS failed.");
      return {
        sourceId: pending.id,
        sourceName: pending.sourceName,
        sourceUrl: pending.sourceUrl,
        status: "healthy",
        itemCount: 1,
        sampleTitles: ["Approved historical item"]
      };
    });

    const retried = await ingestion.approveSourceForAdmin(
      { kind: "global" },
      source.id,
      "admin-retry",
      sourceReviewRequest(stuck)
    );
    expect(retried.source).toMatchObject({
      status: "active",
      trustStatus: "trusted",
      approvalPending: false,
      reviewStatus: "trusted",
      reviewedBy: "admin-retry"
    });
    await expect(repository.listItemsForSource(source.id)).resolves.toEqual([
      expect.objectContaining({ id: "retry-approved", reviewStatus: "approved" })
    ]);
  });

  it("persists human corrections but resets approval when deterministic fields change", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Example announcements",
      sourceUrl: "https://www.example.edu.tr/duyurular",
      contentType: "announcement",
      parser: "html",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [{
      id: "review-item-1",
      sourceId: source.id,
      sourceName: source.sourceName,
      contentType: "announcement",
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      title: "Kayit duyurusu",
      rawTitle: "Personel alim ilani",
      link: "https://www.example.edu.tr/duyurular/kayit",
      publishedDate: "2026-09-09",
      trustStatus: "trusted",
      studentRelevance: "relevant",
      topic: "course_registration",
      audience: "unknown",
      actionType: "register",
      deadline: "unknown",
      urgency: "normal",
      evidenceSpans: [
        { targetField: "studentRelevance", sourceField: "title", start: 0, end: 5, text: "Kayit", ruleId: "test" },
        { targetField: "topic", sourceField: "title", start: 0, end: 5, text: "Kayit", ruleId: "test" }
      ],
      classificationVersion: "student-relevance-rules-v2"
    }]);
    const ingestion = new AnnouncementIngestionService({} as never, repository);
    const audit = { record: vi.fn(async () => undefined) };
    const llm = { classify: vi.fn() };
    const service = new AnnouncementReviewService(repository, ingestion, llm as never, audit as never);
    const initial = (await repository.findReviewItemById("review-item-1"))!.item;

    const updated = await service.updateItem(
      { kind: "global" },
      "review-item-1",
      {
        title: "Kayıt duyurusu",
        summary: "Öğrenci kayıt tarihleri.",
        studentRelevance: "relevant",
        topic: "scholarship",
        audience: ["all_students"],
        actionType: "apply",
        deadline: "2026-09-30",
        urgency: "high",
        reviewStatus: "approved",
        ...reviewFenceFor(initial)
      },
      "admin-1"
    );

    expect(updated).toMatchObject({
      title: "Kayıt duyurusu",
      summary: "Öğrenci kayıt tarihleri.",
      reviewStatus: "approved",
      reviewedBy: "admin-1",
      sourceUrl: "https://www.example.edu.tr/duyurular",
      humanOverride: {
        title: "Kayıt duyurusu",
        summary: "Öğrenci kayıt tarihleri.",
        studentRelevance: "relevant",
        topic: "scholarship",
        audience: ["all_students"],
        actionType: "apply",
        deadline: "2026-09-30",
        urgency: "high"
      }
    });
    expect(toTrustedAcademicContentDto(updated, source)).toMatchObject({
      title: updated.title,
      studentRelevance: "relevant",
      topic: "scholarship",
      audience: ["all_students"],
      actionType: "apply",
      deadline: "2026-09-30",
      urgency: "high",
      evidenceSpans: []
    });
    const legacyItem: AnnouncementItem = { ...updated };
    delete legacyItem.classificationVersion;
    delete legacyItem.evidenceSpans;
    const legacyPublicItem = toTrustedAcademicContentDto(legacyItem, source);
    expect(legacyPublicItem).toMatchObject({
      studentRelevance: "relevant",
      topic: "scholarship",
      audience: ["all_students"],
      actionType: "apply",
      deadline: "2026-09-30",
      urgency: "high"
    });
    expect(legacyPublicItem).not.toHaveProperty("classificationVersion");
    expect(legacyPublicItem).not.toHaveProperty("evidenceSpans");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "announcement_review_item.updated",
      entityId: "review-item-1"
    }));
    await expect(service.updateItem(
      { kind: "global" },
      "review-item-1",
      { deadline: "2026-02-30", ...reviewFenceFor(updated) },
      "admin-1"
    )).rejects.toMatchObject({ status: 400 });
    await expect(service.updateItem(
      { kind: "global" },
      "review-item-1",
      { summary: "x".repeat(1_201), ...reviewFenceFor(updated) },
      "admin-1"
    )).rejects.toMatchObject({ status: 400 });
    await expect(service.updateItem(
      { kind: "global" },
      "review-item-1",
      { body: Array.from({ length: 49 }, () => ({ type: "paragraph" as const, text: "x" })), ...reviewFenceFor(updated) },
      "admin-1"
    )).rejects.toMatchObject({ status: 400 });
    await expect(service.updateItem(
      { kind: "global" },
      "review-item-1",
      { body: [{ type: "paragraph", text: "x".repeat(801) }], ...reviewFenceFor(updated) },
      "admin-1"
    )).rejects.toMatchObject({ status: 400 });
    await expect(service.updateItem(
      { kind: "global" },
      "review-item-1",
      { body: Array.from({ length: 16 }, () => ({ type: "paragraph" as const, text: "x".repeat(800) })), ...reviewFenceFor(updated) },
      "admin-1"
    )).rejects.toMatchObject({ status: 400 });
    await expect(service.updateItem(
      { kind: "global" },
      "review-item-1",
      { reviewStatus: "rejected", ...reviewFenceFor(initial) },
      "admin-1"
    )).rejects.toMatchObject({ status: 409 });

    await repository.replaceItemsForSource(source, [{
      id: "parser-generated-id",
      sourceId: source.id,
      sourceName: source.sourceName,
      contentType: "announcement",
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      title: "Kayit duyurusu",
      rawTitle: "Personel alim ilani",
      link: "https://www.example.edu.tr/duyurular/kayit",
      publishedDate: "2026-09-09",
      trustStatus: "trusted",
      studentRelevance: "relevant",
      topic: "course_registration"
    }]);
    expect(await repository.findReviewItemById("review-item-1")).toMatchObject({
      item: { title: "Kayıt duyurusu", reviewStatus: "pending_review" }
    });

    const refreshed = (await repository.findReviewItemById("review-item-1"))!.item;
    await service.updateItem({ kind: "global" }, "review-item-1", {
      reviewStatus: "rejected",
      ...reviewFenceFor(refreshed)
    }, "admin-1");
    expect(await repository.listAllItems()).toEqual([]);
    expect(await repository.listReviewItems()).toHaveLength(1);
  });

  it("stores LLM suggestions separately and leaves final approval to an admin", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Example announcements",
      sourceUrl: "https://www.example.edu.tr/duyurular",
      parser: "html",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [{
      id: "review-item-2",
      sourceId: source.id,
      sourceName: source.sourceName,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      title: "Burs başvurusu",
      link: "https://www.example.edu.tr/duyurular/burs",
      publishedDate: "2026-09-09",
      trustStatus: "trusted"
    }]);
    const ingestion = new AnnouncementIngestionService({} as never, repository);
    const llmClassification = {
      provider: "openai" as const,
      model: "test-model",
      studentRelevance: "relevant" as const,
      topic: "scholarship" as const,
      audience: ["all_students"] as const,
      actionType: "apply" as const,
      deadline: "unknown",
      urgency: "normal" as const,
      confidence: 0.91,
      rationale: "Başlık burs başvurusu içeriyor.",
      analyzedAt: "2026-09-09T18:00:00.000Z"
    };
    const classify = vi.fn(async () => llmClassification);
    const service = new AnnouncementReviewService(
      repository,
      ingestion,
      { assertReviewReady: vi.fn(async () => undefined), classify } as never,
      { record: vi.fn(async () => undefined) } as never
    );

    const item = (await repository.findReviewItemById("review-item-2"))!.item;
    const updated = await service.runLlmReview(
      { kind: "global" },
      "review-item-2",
      reviewFenceFor(item),
      "admin-1"
    );

    expect(updated).toMatchObject({ reviewStatus: "pending_review", llmClassification });
    expect(updated.topic).toBeUndefined();

    const approved = await service.updateItem(
      { kind: "global" },
      updated.id,
      { reviewStatus: "approved", ...reviewFenceFor(updated) },
      "admin-1"
    );
    await expect(service.runLlmReview(
      { kind: "global" },
      approved.id,
      reviewFenceFor(approved),
      "admin-1"
    )).rejects.toMatchObject({ status: 409 });
    expect(classify).toHaveBeenCalledTimes(1);
    expect(await repository.listAllItems()).toEqual([
      expect.objectContaining({ id: approved.id, reviewStatus: "approved" })
    ]);
  });

  it("keeps pending edits unadjudicated and clears stale LLM state after human changes", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Example announcements",
      sourceUrl: "https://www.example.edu.tr/duyurular",
      parser: "html",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [{
      ...reviewQueueItem(source, "review-item-pending-edit", "Original title"),
      llmClassification: {
        provider: "openai",
        model: "old-model",
        confidence: 0.8,
        rationale: "Old suggestion",
        analyzedAt: "2026-09-10T09:00:00.000Z"
      },
      llmReviewFailure: {
        disposition: "retry_scheduled",
        reasonCode: "provider_unavailable",
        attemptCount: 1,
        lastAttemptedAt: "2026-09-10T09:00:00.000Z",
        retryAfter: "2026-09-10T09:01:00.000Z"
      }
    }]);
    const service = new AnnouncementReviewService(
      repository,
      new AnnouncementIngestionService({} as never, repository),
      {} as never,
      { record: vi.fn(async () => undefined) } as never
    );
    const initial = (await repository.findReviewItemById("review-item-pending-edit"))!.item;

    const updated = await service.updateItem({ kind: "global" }, initial.id, {
      title: "Human corrected title",
      reviewStatus: "pending_review",
      ...reviewFenceFor(initial)
    }, "admin-1");

    expect(updated).toMatchObject({
      reviewStatus: "pending_review",
      reviewedBy: null,
      reviewedAt: null,
      llmClassification: null,
      llmReviewFailure: null
    });
  });

  it("rejects an LLM result when the review revision changes during the remote call", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Example announcements",
      sourceUrl: "https://www.example.edu.tr/duyurular",
      parser: "html",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [{
      id: "review-item-race",
      sourceId: source.id,
      sourceName: source.sourceName,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      title: "Kayit duyurusu",
      link: "https://www.example.edu.tr/duyurular/race",
      trustStatus: "trusted"
    }]);
    const initial = (await repository.findReviewItemById("review-item-race"))!.item;
    let signalStarted!: () => void;
    let resolveClassification!: (value: Awaited<ReturnType<ContentLlmSettingsService["classify"]>>) => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const classification = new Promise<Awaited<ReturnType<ContentLlmSettingsService["classify"]>>>((resolve) => {
      resolveClassification = resolve;
    });
    const service = new AnnouncementReviewService(
      repository,
      new AnnouncementIngestionService({} as never, repository),
      {
        assertReviewReady: vi.fn(async () => undefined),
        classify: vi.fn(() => { signalStarted(); return classification; })
      } as never,
      { record: vi.fn(async () => undefined) } as never
    );
    const llmWrite = service.runLlmReview(
      { kind: "global" },
      initial.id,
      reviewFenceFor(initial),
      "admin-1"
    );
    const staleExpectation = expect(llmWrite).rejects.toMatchObject({ status: 409 });
    await started;
    const claimed = (await repository.findReviewItemById(initial.id))!.item;
    await repository.updateReviewItem(claimed.id, { reviewStatus: "approved", llmReviewClaim: null }, reviewFenceFor(claimed));
    resolveClassification({
      provider: "openai",
      model: "test-model",
      confidence: 0.9,
      rationale: "Test",
      analyzedAt: "2026-09-09T18:00:00.000Z"
    });
    await staleExpectation;
    const current = (await repository.findReviewItemById(initial.id))?.item;
    expect(current).toEqual(expect.objectContaining({ reviewStatus: "approved" }));
    expect(current).not.toHaveProperty("llmClassification");
  });

  it("admits only one paid LLM call for concurrent requests on the same review item", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Example announcements",
      sourceUrl: "https://www.example.edu.tr/duyurular",
      parser: "html",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [reviewQueueItem(source, "review-item-claim", "Concurrent review")]);
    let signalStarted!: () => void;
    let releaseProvider!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const provider = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const classify = vi.fn(async () => {
      signalStarted();
      await provider;
      return {
        provider: "openai" as const,
        model: "test-model",
        confidence: 0.9,
        rationale: "Test suggestion",
        analyzedAt: "2026-09-10T10:00:00.000Z"
      };
    });
    const service = new AnnouncementReviewService(
      repository,
      new AnnouncementIngestionService({} as never, repository),
      { assertReviewReady: vi.fn(async () => undefined), classify } as never,
      { record: vi.fn(async () => undefined) } as never
    );
    const initial = (await repository.findReviewItemById("review-item-claim"))!.item;
    const first = service.runLlmReview({ kind: "global" }, initial.id, reviewFenceFor(initial), "admin-1");
    await started;
    const claimed = (await repository.findReviewItemById(initial.id))!.item;

    await expect(service.runLlmReview(
      { kind: "global" },
      claimed.id,
      reviewFenceFor(claimed),
      "admin-1"
    )).rejects.toMatchObject({ status: 409 });
    expect(classify).toHaveBeenCalledTimes(1);

    releaseProvider();
    await expect(first).resolves.toMatchObject({ id: initial.id, llmReviewInFlight: false });
    expect((await repository.findReviewItemById(initial.id))!.item.llmReviewClaim).toBeNull();
  });

  it("lets an expired LLM lease be replaced and rejects the stale owner's result", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T10:00:00.000Z"));
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Example announcements",
      sourceUrl: "https://www.example.edu.tr/duyurular",
      parser: "html",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [reviewQueueItem(source, "review-item-expired-claim", "Expired claim")]);
    let signalFirstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => { signalFirstStarted = resolve; });
    const firstProvider = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const classify = vi.fn()
      .mockImplementationOnce(async () => {
        signalFirstStarted();
        await firstProvider;
        return {
          provider: "openai" as const,
          model: "old-owner-model",
          confidence: 0.8,
          rationale: "Old owner",
          analyzedAt: new Date().toISOString()
        };
      })
      .mockResolvedValueOnce({
        provider: "openai" as const,
        model: "new-owner-model",
        confidence: 0.9,
        rationale: "New owner",
        analyzedAt: "2026-09-10T10:02:00.000Z"
      });
    const service = new AnnouncementReviewService(
      repository,
      new AnnouncementIngestionService({} as never, repository),
      { assertReviewReady: vi.fn(async () => undefined), classify } as never,
      { record: vi.fn(async () => undefined) } as never
    );
    const initial = (await repository.findReviewItemById("review-item-expired-claim"))!.item;
    const oldOwner = service.runLlmReview({ kind: "global" }, initial.id, reviewFenceFor(initial), "admin-1");
    await firstStarted;
    vi.advanceTimersByTime(90_001);
    const expired = (await repository.findReviewItemById(initial.id))!.item;

    await expect(service.runLlmReview(
      { kind: "global" },
      expired.id,
      reviewFenceFor(expired),
      "admin-2"
    )).resolves.toMatchObject({ llmClassification: { model: "new-owner-model" } });
    releaseFirst();
    await expect(oldOwner).rejects.toMatchObject({ status: 409 });
    expect(classify).toHaveBeenCalledTimes(2);
    expect((await repository.findReviewItemById(initial.id))!.item).toMatchObject({
      llmClassification: { model: "new-owner-model" },
      llmReviewClaim: null
    });
    vi.useRealTimers();
  });

  it("preflights batch configuration without consuming an item's retry budget", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Example announcements",
      sourceUrl: "https://www.example.edu.tr/duyurular",
      parser: "html",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [reviewQueueItem(source, "review-item-no-config", "No config")]);
    const classify = vi.fn();
    const service = new AnnouncementReviewService(
      repository,
      new AnnouncementIngestionService({} as never, repository),
      {
        assertReviewReady: vi.fn(async () => { throw new BadRequestException("LLM review is disabled."); }),
        classify
      } as never,
      { record: vi.fn(async () => undefined) } as never
    );
    const before = (await repository.findReviewItemById("review-item-no-config"))!.item;

    await expect(service.runPendingLlmReviews({ kind: "global" }, "admin-1", 1))
      .rejects.toMatchObject({ status: 400 });
    const after = (await repository.findReviewItemById(before.id))!.item;
    expect(classify).not.toHaveBeenCalled();
    expect(after.reviewRevision).toBe(before.reviewRevision);
    expect(after.llmReviewFailure).toBeUndefined();
    expect(after.llmReviewClaim).toBeUndefined();
  });

  it("quarantines refusals, backs off transient failures, and continues past blocked queue heads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T10:00:00.000Z"));
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Example announcements",
      sourceUrl: "https://www.example.edu.tr/duyurular",
      parser: "html",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [
      reviewQueueItem(source, "a-refusal", "Provider refusal"),
      reviewQueueItem(source, "b-transient", "Transient provider failure"),
      reviewQueueItem(source, "c-success", "Successful suggestion"),
      reviewQueueItem(source, "z-approved", "Approved sibling")
    ]);
    const approvedSibling = (await repository.findReviewItemById("z-approved"))!.item;
    await repository.updateReviewItem(
      approvedSibling.id,
      { reviewStatus: "approved" },
      reviewFenceFor(approvedSibling)
    );
    const secretDiagnostic = "secret-provider-diagnostic";
    const classify = vi.fn(async (item: { id: string }) => {
      if (item.id === "a-refusal") {
        throw new UnprocessableEntityException(`provider refused: ${secretDiagnostic}`);
      }
      if (item.id === "b-transient") {
        throw new ServiceUnavailableException(`provider unavailable: ${secretDiagnostic}`);
      }
      return {
        provider: "openai" as const,
        model: "test-model",
        confidence: 0.9,
        rationale: "Test suggestion",
        analyzedAt: new Date().toISOString()
      };
    });
    const syncTrustedAnnouncementSource = vi.fn(async () => undefined);
    const service = new AnnouncementReviewService(
      repository,
      new AnnouncementIngestionService({} as never, repository),
      { assertReviewReady: vi.fn(async () => undefined), classify } as never,
      { record: vi.fn(async () => undefined) } as never,
      { syncTrustedAnnouncementSource } as never
    );

    const refusalRun = await service.runPendingLlmReviews({ kind: "global" }, "admin-1", 1);
    expect(refusalRun.results).toEqual([
      { itemId: "a-refusal", status: "failed", disposition: "manual_review" }
    ]);
    expect((await repository.findReviewItemById("a-refusal"))?.item.llmReviewFailure).toMatchObject({
      disposition: "manual_review",
      reasonCode: "provider_refusal",
      attemptCount: 1
    });
    expect(syncTrustedAnnouncementSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: source.id }),
      expect.objectContaining({
        unchanged: [expect.objectContaining({ id: "z-approved" })]
      })
    );

    const transientRun = await service.runPendingLlmReviews({ kind: "global" }, "admin-1", 1);
    expect(transientRun.results).toEqual([
      { itemId: "b-transient", status: "failed", disposition: "retry_scheduled" }
    ]);
    const firstTransient = (await repository.findReviewItemById("b-transient"))!.item;
    expect(firstTransient.llmReviewFailure).toMatchObject({
      disposition: "retry_scheduled",
      reasonCode: "provider_unavailable",
      attemptCount: 1
    });
    expect(JSON.stringify(firstTransient.llmReviewFailure)).not.toContain(secretDiagnostic);

    const continuedRun = await service.runPendingLlmReviews({ kind: "global" }, "admin-1", 1);
    expect(continuedRun.results).toEqual([{ itemId: "c-success", status: "reviewed" }]);
    expect((await repository.findReviewItemById("c-success"))?.item).toMatchObject({
      reviewStatus: "pending_review",
      llmClassification: { model: "test-model" }
    });
    expect((await repository.findReviewItemById("c-success"))?.item.topic).toBeUndefined();

    let retryState = firstTransient.llmReviewFailure!;
    for (let expectedAttempt = 2; expectedAttempt <= 4; expectedAttempt += 1) {
      vi.setSystemTime(new Date(Date.parse(retryState.retryAfter!) + 1));
      const retryRun = await service.runPendingLlmReviews({ kind: "global" }, "admin-1", 1);
      expect(retryRun.results[0]).toMatchObject({ itemId: "b-transient", status: "failed" });
      retryState = (await repository.findReviewItemById("b-transient"))!.item.llmReviewFailure!;
      expect(retryState.attemptCount).toBe(expectedAttempt);
    }
    expect(retryState).toMatchObject({
      disposition: "manual_review",
      reasonCode: "retry_exhausted",
      attemptCount: 4
    });
    expect(retryState.retryAfter).toBeUndefined();
    expect(JSON.stringify(retryState)).not.toContain(secretDiagnostic);
  });

  it("processes same-source items across fresh single-item requests while hard-capping each request", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Example announcements",
      sourceUrl: "https://www.example.edu.tr/duyurular",
      parser: "html",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [
      reviewQueueItem(source, "same-source-a", "First suggestion"),
      reviewQueueItem(source, "same-source-b", "Second suggestion")
    ]);

    let snapshotGeneration = 1;
    const currentSnapshotId = () => `snapshot-${snapshotGeneration}`;
    const withCurrentSnapshot = (item: AnnouncementItem): AnnouncementItem => ({
      ...item,
      snapshotId: currentSnapshotId()
    });
    const snapshotRepository = {
      listReviewItems: async (input: { sourceIds?: string[]; limit?: number; offset?: number } = {}) =>
        (await repository.listReviewItems(input)).map(withCurrentSnapshot),
      findReviewItemById: async (id: string) => {
        const result = await repository.findReviewItemById(id);
        return result ? { ...result, item: withCurrentSnapshot(result.item) } : null;
      },
      findSourceById: (id: string) => repository.findSourceById(id),
      updateReviewItem: async (
        id: string,
        input: AnnouncementReviewItemUpdate,
        fence: AnnouncementReviewFence
      ) => {
        if (fence.expectedSnapshotId !== currentSnapshotId()) throw new Error("STALE_TEST_SNAPSHOT");
        const mutation = await repository.updateReviewItem(id, input, {
          expectedContentFingerprint: fence.expectedContentFingerprint,
          ...(fence.expectedReviewRevision ? { expectedReviewRevision: fence.expectedReviewRevision } : {})
        });
        if (!mutation) return null;
        snapshotGeneration += 1;
        return { ...mutation, item: withCurrentSnapshot(mutation.item) };
      }
    };
    const classify = vi.fn(async () => ({
      provider: "openai" as const,
      model: "test-model",
      confidence: 0.9,
      rationale: "Test suggestion",
      analyzedAt: "2026-09-10T10:00:00.000Z"
    }));
    const service = new AnnouncementReviewService(
      snapshotRepository as never,
      { getSourceForAdminAccess: vi.fn(async () => source) } as never,
      { assertReviewReady: vi.fn(async () => undefined), classify } as never,
      { record: vi.fn(async () => undefined) } as never
    );

    const first = await service.runPendingLlmReviews({ kind: "global" }, "admin-1", 50);
    const second = await service.runPendingLlmReviews({ kind: "global" }, "admin-1", 50);
    const empty = await service.runPendingLlmReviews({ kind: "global" }, "admin-1", 50);

    expect(first).toMatchObject({ processed: 1, reviewed: 1, failed: 0, hasMore: true });
    expect(second).toMatchObject({ processed: 1, reviewed: 1, failed: 0, hasMore: false });
    expect(empty).toMatchObject({ processed: 0, reviewed: 0, failed: 0, hasMore: false });
    expect(classify).toHaveBeenCalledTimes(2);
    expect((await repository.findReviewItemById("same-source-a"))?.item.llmClassification).toBeDefined();
    expect((await repository.findReviewItemById("same-source-b"))?.item.llmClassification).toBeDefined();
  });

  it("counts a stale queue head and advertises the next eligible item", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Example announcements",
      sourceUrl: "https://www.example.edu.tr/duyurular",
      parser: "html",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [
      reviewQueueItem(source, "a-stale", "Stale queue head"),
      reviewQueueItem(source, "b-next", "Next suggestion")
    ]);

    let listCount = 0;
    const staleClassification = {
      provider: "openai" as const,
      model: "other-request",
      confidence: 0.9,
      rationale: "Already reviewed elsewhere",
      analyzedAt: "2026-09-10T10:00:00.000Z"
    };
    const racingRepository = {
      listReviewItems: async (input: { sourceIds?: string[]; limit?: number; offset?: number } = {}) => {
        const items = await repository.listReviewItems(input);
        listCount += 1;
        return listCount === 1 ? items : items.filter((item) => item.id !== "a-stale");
      },
      findReviewItemById: async (id: string) => {
        const result = await repository.findReviewItemById(id);
        return result && id === "a-stale"
          ? { ...result, item: { ...result.item, llmClassification: staleClassification } }
          : result;
      },
      findSourceById: (id: string) => repository.findSourceById(id),
      updateReviewItem: (
        id: string,
        input: AnnouncementReviewItemUpdate,
        fence: AnnouncementReviewFence
      ) => repository.updateReviewItem(id, input, fence)
    };
    const classify = vi.fn(async () => ({
      provider: "openai" as const,
      model: "test-model",
      confidence: 0.9,
      rationale: "Test suggestion",
      analyzedAt: "2026-09-10T10:00:00.000Z"
    }));
    const service = new AnnouncementReviewService(
      racingRepository as never,
      { getSourceForAdminAccess: vi.fn(async () => source) } as never,
      { assertReviewReady: vi.fn(async () => undefined), classify } as never,
      { record: vi.fn(async () => undefined) } as never
    );

    await expect(service.runPendingLlmReviews({ kind: "global" }, "admin-1", 50)).resolves.toMatchObject({
      processed: 1,
      reviewed: 0,
      failed: 1,
      hasMore: true,
      results: [{ itemId: "a-stale", status: "failed", disposition: "stale" }]
    });
    await expect(service.runPendingLlmReviews({ kind: "global" }, "admin-1", 50)).resolves.toMatchObject({
      processed: 1,
      reviewed: 1,
      failed: 0,
      hasMore: false
    });
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("keeps polling after the only queued item loses its snapshot race", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "example-university",
      sourceName: "Example announcements",
      sourceUrl: "https://www.example.edu.tr/duyurular",
      parser: "html",
      priority: 10,
      status: "active",
      trustStatus: "trusted"
    });
    await repository.replaceItemsForSource(source, [reviewQueueItem(source, "only-racing-item", "Racing suggestion")]);

    const racingRepository = {
      listReviewItems: (input: { sourceIds?: string[]; limit?: number; offset?: number } = {}) =>
        repository.listReviewItems(input),
      findReviewItemById: (id: string) => repository.findReviewItemById(id),
      findSourceById: (id: string) => repository.findSourceById(id),
      updateReviewItem: vi.fn(async () => {
        throw new ConflictException("Snapshot rotated.");
      })
    };
    const classify = vi.fn();
    const service = new AnnouncementReviewService(
      racingRepository as never,
      { getSourceForAdminAccess: vi.fn(async () => source) } as never,
      { assertReviewReady: vi.fn(async () => undefined), classify } as never,
      { record: vi.fn(async () => undefined) } as never
    );

    await expect(service.runPendingLlmReviews({ kind: "global" }, "admin-1", 1)).resolves.toMatchObject({
      processed: 1,
      reviewed: 0,
      failed: 1,
      hasMore: true,
      results: [{ itemId: "only-racing-item", status: "failed", disposition: "stale" }]
    });
    expect(classify).not.toHaveBeenCalled();
  });

  it("does not disguise a repository failure as a stale batch item", async () => {
    const infrastructureError = new ServiceUnavailableException("Review repository unavailable.");
    const service = new AnnouncementReviewService(
      {
        listReviewItems: vi.fn(async () => [reviewQueueItem({
          id: "source-1",
          sourceName: "Example announcements",
          scopeType: "university",
          scopeId: "example-university"
        }, "repository-failure", "Repository failure")]),
        findSourceById: vi.fn(async () => null),
        findReviewItemById: vi.fn(async () => { throw infrastructureError; })
      } as never,
      { getSourceForAdminAccess: vi.fn() } as never,
      { assertReviewReady: vi.fn(async () => undefined), classify: vi.fn() } as never,
      { record: vi.fn(async () => undefined) } as never
    );

    await expect(service.runPendingLlmReviews({ kind: "global" }, "admin-1", 1)).rejects.toBe(infrastructureError);
  });
});

function reviewQueueItem(
  source: { id: string; sourceName: string; scopeType: "university" | "faculty" | "department"; scopeId: string },
  id: string,
  title: string
) {
  return {
    id,
    sourceId: source.id,
    sourceName: source.sourceName,
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    title,
    link: `https://www.example.edu.tr/duyurular/${id}`,
    trustStatus: "trusted" as const
  };
}

function reviewFenceFor(item: {
  snapshotId?: string;
  contentFingerprint?: string;
  reviewRevision?: string;
}) {
  if (!item.contentFingerprint) throw new Error("Test item is missing contentFingerprint.");
  return {
    ...(item.snapshotId ? { expectedSnapshotId: item.snapshotId } : {}),
    expectedContentFingerprint: item.contentFingerprint,
    ...(item.reviewRevision ? { expectedReviewRevision: item.reviewRevision } : {})
  };
}

describe("content LLM settings", () => {
  it("encrypts the API key at rest, masks reads, and parses structured Responses API output", async () => {
    const model = new FakeSettingsModel();
    const audit = { record: vi.fn(async () => undefined) };
    const service = new ContentLlmSettingsService({} as never, audit as never);
    Object.defineProperty(service, "model", { value: async () => model });
    const apiKey = "test-api-key-that-is-long-enough-1234";

    const view = await service.updateSettings({
      expectedRevision: 0,
      enabled: true,
      provider: "openai",
      model: "test-model",
      apiKey
    }, "admin-1");

    expect(view).toMatchObject({ apiKeyConfigured: true, keyLastFour: "1234", enabled: true });
    expect(JSON.stringify(view)).not.toContain(apiKey);
    expect(model.record?.encryptedApiKey).not.toBe(apiKey);
    expect(String(model.record?.encryptedApiKey)).toMatch(/^enc:v1:/u);
    expect(model.lastOptions).toMatchObject({ runValidators: true, upsert: true });
    expect(model.lastFilter).toEqual({ _id: "academic-content-review", revision: { $exists: false } });
    expect(model.updateCalls).toBe(1);

    const publicAddress: ResolvedOutboundAddress = { address: "93.184.216.34", family: 4 };
    const requestHop = vi.fn<NonNullable<SafeOutboundRequestDependencies["requestHop"]>>(async (_url, pinnedAddress) => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify({
              studentRelevance: "relevant",
              topic: "course_registration",
              audience: ["all_students"],
              actionType: "register",
              deadline: "2026-09-20",
              urgency: "high",
              confidence: 0.94,
              rationale: "Kayıt tarihi ve son başvuru tarihi açıkça belirtilmiş."
            })
          }]
        }]
      })),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    const item = {
      id: "item-1",
      sourceId: "source-1",
      sourceName: "Source",
      scopeType: "university" as const,
      scopeId: "example-university",
      title: "Ders kayıtları",
      link: "https://www.example.edu.tr/duyuru/1",
      trustStatus: "trusted" as const
    };
    const classification = await service.classify(item);

    expect(classification).toMatchObject({ topic: "course_registration", confidence: 0.94, provider: "openai" });
    expect(requestHop).toHaveBeenCalledOnce();
    const [requestUrl, pinnedAddress, request] = requestHop.mock.calls[0]!;
    expect(requestUrl).toBe(OPENAI_RESPONSES_URL);
    expect(pinnedAddress).toEqual(publicAddress);
    expect(request.providerPolicy).toBe("openai-responses");
    expect(request.method).toBe("POST");
    expect(request.body?.toString("utf8")).not.toContain(apiKey);
    expect(request.headers.authorization).toBe(`Bearer ${apiKey}`);

    requestHop.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({
        output_text: JSON.stringify({
          studentRelevance: "relevant",
          topic: "course_registration",
          audience: ["all_students"],
          actionType: "register",
          deadline: "2026-02-30",
          urgency: "high",
          confidence: 0.94,
          rationale: "Invalid calendar date fixture."
        })
      })),
      remoteAddress: publicAddress.address
    });
    await expect(service.classify(item)).rejects.toMatchObject({ status: 503 });

    requestHop.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({
        output: [{ type: "message", content: [{ type: "refusal", refusal: "fixture refusal" }] }]
      })),
      remoteAddress: publicAddress.address
    });
    await expect(service.classify(item)).rejects.toMatchObject({
      status: 422,
      message: "LLM provider refused to classify this content."
    });

    requestHop.mockRejectedValueOnce(new Error(`network failure ${apiKey}`));
    const networkFailure = service.classify(item);
    await expect(networkFailure).rejects.toMatchObject({
      status: 503,
      message: "LLM provider is temporarily unavailable."
    });
    await expect(networkFailure).rejects.not.toThrow(apiKey);

    const secretResponseBody = `provider diagnostic containing ${apiKey}`;
    requestHop.mockResolvedValueOnce({
      status: 500,
      headers: { "content-type": "application/json" },
      body: Buffer.from(secretResponseBody),
      remoteAddress: publicAddress.address
    });
    const providerFailure = service.classify(item);
    await expect(providerFailure).rejects.toMatchObject({
      status: 503,
      message: "LLM provider request failed."
    });
    await expect(providerFailure).rejects.not.toThrow(secretResponseBody);

    model.record = {
      ...model.record,
      lastTestStatus: "success",
      lastTestedAt: new Date("2026-09-09T18:00:00.000Z")
    };
    const changedModel = await service.updateSettings({
      expectedRevision: view.revision,
      enabled: true,
      provider: "openai",
      model: "test-model-v2"
    }, "admin-1");
    expect(changedModel).toMatchObject({ lastTestStatus: "untested", model: "test-model-v2" });
    expect(changedModel.lastTestedAt).toBeUndefined();

    model.record = {
      ...model.record,
      lastTestStatus: "success",
      lastTestedAt: new Date("2026-09-09T18:00:00.000Z")
    };
    const rotatedKey = await service.updateSettings({
      expectedRevision: changedModel.revision,
      enabled: true,
      provider: "openai",
      model: "test-model-v2",
      apiKey: "replacement-api-key-that-is-long-enough-5678"
    }, "admin-1");
    expect(rotatedKey).toMatchObject({ lastTestStatus: "untested", keyLastFour: "5678" });
    expect(rotatedKey.lastTestedAt).toBeUndefined();

    const withoutKey = await service.deleteApiKey("admin-1", rotatedKey.revision);
    await expect(service.updateSettings({
      expectedRevision: withoutKey.revision,
      enabled: true,
      provider: "openai",
      model: "test-model"
    }, "admin-1")).rejects.toMatchObject({ status: 400 });
    expect(model.record?.encryptedApiKey).toBeUndefined();

    await expect(service.updateSettings({
      expectedRevision: withoutKey.revision,
      enabled: false,
      provider: "openai",
      model: "m".repeat(129)
    }, "admin-1")).rejects.toMatchObject({ status: 400 });
  });

  it("does not let a stale connection test overwrite rotated credentials", async () => {
    const model = new FakeSettingsModel();
    const service = new ContentLlmSettingsService({} as never, { record: vi.fn(async () => undefined) } as never);
    Object.defineProperty(service, "model", { value: async () => model });
    await service.updateSettings({
      expectedRevision: 0,
      enabled: true,
      provider: "openai",
      model: "test-model",
      apiKey: "test-api-key-that-is-long-enough-1234"
    }, "admin-1");
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestHop: async (_url, pinnedAddress) => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          output_text: JSON.stringify({
            studentRelevance: "relevant",
            topic: "course_registration",
            audience: ["all_students"],
            actionType: "register",
            deadline: "unknown",
            urgency: "normal",
            confidence: 0.9,
            rationale: "Connection test fixture."
          })
        })),
        remoteAddress: pinnedAddress.address
      })
    });
    model.beforeNextUpdate = () => {
      model.record = {
        ...model.record,
        revision: Number(model.record?.revision ?? 0) + 1,
        lastTestStatus: "untested"
      };
    };

    await expect(service.testConnection("admin-1")).rejects.toMatchObject({ status: 409 });
    expect(model.record?.lastTestStatus).toBe("untested");
    expect(model.lastFilter).toMatchObject({ model: "test-model", revision: 1 });
  });

  it("does not let a stale key deletion remove rotated credentials", async () => {
    const model = new FakeSettingsModel();
    const service = new ContentLlmSettingsService({} as never, { record: vi.fn(async () => undefined) } as never);
    Object.defineProperty(service, "model", { value: async () => model });
    const initial = await service.updateSettings({
      expectedRevision: 0,
      enabled: true,
      provider: "openai",
      model: "test-model",
      apiKey: "test-api-key-that-is-long-enough-1234"
    }, "admin-1");
    model.beforeNextUpdate = () => {
      model.record = {
        ...model.record,
        encryptedApiKey: "rotated-ciphertext",
        keyLastFour: "5678",
        revision: Number(model.record?.revision ?? 0) + 1
      };
    };

    await expect(service.deleteApiKey("admin-1", initial.revision)).rejects.toMatchObject({ status: 409 });
    expect(model.record?.encryptedApiKey).toBe("rotated-ciphertext");
    expect(model.record?.keyLastFour).toBe("5678");
  });

  it("rejects a stale settings form before it can overwrite a newer disable, model, or key decision", async () => {
    const model = new FakeSettingsModel();
    const audit = { record: vi.fn(async () => undefined) };
    const service = new ContentLlmSettingsService({} as never, audit as never);
    Object.defineProperty(service, "model", { value: async () => model });
    model.record = {
      enabled: true,
      provider: "openai",
      model: "server-model",
      encryptedApiKey: "server-ciphertext",
      keyLastFour: "9876",
      revision: 2
    };

    await expect(service.updateSettings({
      expectedRevision: 1,
      enabled: false,
      provider: "openai",
      model: "stale-model",
      apiKey: "stale-api-key-that-is-long-enough-1234"
    }, "admin-1")).rejects.toMatchObject({ status: 409 });

    expect(model.updateCalls).toBe(0);
    expect(model.record).toMatchObject({
      enabled: true,
      model: "server-model",
      encryptedApiKey: "server-ciphertext",
      keyLastFour: "9876",
      revision: 2
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not retry a lost update CAS with stale form values", async () => {
    const model = new FakeSettingsModel();
    const service = new ContentLlmSettingsService(
      {} as never,
      { record: vi.fn(async () => undefined) } as never
    );
    Object.defineProperty(service, "model", { value: async () => model });
    model.record = {
      enabled: false,
      provider: "openai",
      model: "loaded-model",
      encryptedApiKey: "loaded-ciphertext",
      keyLastFour: "1234",
      revision: 1
    };
    model.beforeNextUpdate = () => {
      model.record = {
        enabled: true,
        provider: "openai",
        model: "server-winner-model",
        encryptedApiKey: "server-winner-ciphertext",
        keyLastFour: "9876",
        revision: 2
      };
    };

    await expect(service.updateSettings({
      expectedRevision: 1,
      enabled: false,
      provider: "openai",
      model: "stale-model",
      apiKey: "stale-api-key-that-is-long-enough-1234"
    }, "admin-1")).rejects.toMatchObject({ status: 409 });

    expect(model.updateCalls).toBe(1);
    expect(model.record).toMatchObject({
      enabled: true,
      model: "server-winner-model",
      encryptedApiKey: "server-winner-ciphertext",
      keyLastFour: "9876",
      revision: 2
    });
  });

  it("loses an initial-create race with one fenced CAS and preserves the winner", async () => {
    const model = new FakeSettingsModel();
    const service = new ContentLlmSettingsService(
      {} as never,
      { record: vi.fn(async () => undefined) } as never
    );
    Object.defineProperty(service, "model", { value: async () => model });
    model.beforeNextUpdate = () => {
      model.record = {
        enabled: true,
        provider: "openai",
        model: "winner-model",
        encryptedApiKey: "winner-ciphertext",
        keyLastFour: "5678",
        revision: 1
      };
    };

    await expect(service.updateSettings({
      expectedRevision: 0,
      enabled: true,
      provider: "openai",
      model: "loser-model",
      apiKey: "loser-api-key-that-is-long-enough-1234"
    }, "admin-1")).rejects.toMatchObject({ status: 409 });

    expect(model.updateCalls).toBe(1);
    expect(model.record).toMatchObject({
      enabled: true,
      model: "winner-model",
      encryptedApiKey: "winner-ciphertext",
      keyLastFour: "5678",
      revision: 1
    });
  });
});

class FakeSettingsDocument {
  constructor(readonly id: string, private readonly value: Record<string, unknown>) {}

  toObject(): Record<string, unknown> {
    return { _id: this.id, ...this.value };
  }
}

class FakeSettingsModel {
  record?: Record<string, unknown>;
  lastFilter?: Record<string, unknown>;
  lastOptions?: Record<string, unknown>;
  beforeNextUpdate?: () => void;
  updateCalls = 0;

  async findById(id: string): Promise<FakeSettingsDocument | null> {
    return this.record ? new FakeSettingsDocument(id, this.record) : null;
  }

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: {
      $set?: Record<string, unknown>;
      $setOnInsert?: Record<string, unknown>;
      $unset?: Record<string, unknown>;
      $inc?: Record<string, number>;
    },
    options: Record<string, unknown> = {}
  ): Promise<FakeSettingsDocument | null> {
    this.updateCalls += 1;
    this.lastFilter = filter;
    this.lastOptions = options;
    this.beforeNextUpdate?.();
    delete this.beforeNextUpdate;
    if (!matchesFakeSettingsFilter(this.record, filter)) return null;
    if (!this.record && options.upsert !== true) return null;
    const now = new Date("2026-09-09T18:00:00.000Z");
    this.record = { ...(this.record ?? update.$setOnInsert ?? {}), ...(update.$set ?? {}), updatedAt: now };
    for (const field of Object.keys(update.$unset ?? {})) delete this.record[field];
    for (const [field, increment] of Object.entries(update.$inc ?? {})) {
      this.record[field] = Number(this.record[field] ?? 0) + increment;
    }
    return new FakeSettingsDocument(String(filter._id), this.record);
  }
}

function matchesFakeSettingsFilter(record: Record<string, unknown> | undefined, filter: Record<string, unknown>): boolean {
  for (const [field, expected] of Object.entries(filter)) {
    if (field === "_id") continue;
    if (expected && typeof expected === "object") {
      const condition = expected as { $exists?: boolean; $type?: string; $ne?: unknown };
      const value = record?.[field];
      if (condition.$exists === true && value === undefined) return false;
      if (condition.$exists === false && value !== undefined) return false;
      if (condition.$type === "string" && typeof value !== "string") return false;
      if (Object.hasOwn(condition, "$ne") && value === condition.$ne) return false;
    } else if (record?.[field] !== expected) {
      return false;
    }
  }
  return true;
}
