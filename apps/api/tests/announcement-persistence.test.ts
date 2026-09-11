import { describe, expect, it, vi } from "vitest";
import { announcementSnapshotSchema, announcementSourceSchema } from "../src/database/mongoose-schemas.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { MongoAnnouncementRepository } from "../src/modules/announcements/mongo-announcement.repository.js";
import { fingerprintFor } from "../src/modules/announcements/announcement-persistence.js";
import type { AnnouncementItem, AnnouncementSourceRecord, AnnouncementSourceVerificationEvidence } from "../src/modules/announcements/announcements.types.js";

describe("announcement source trust persistence", () => {
  it("quarantines new in-memory sources unless trust is explicit and preserves existing decisions on omitted updates", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const created = await repository.upsertSource(sourceInputWithoutTrust());

    expect(created.trustStatus).toBe("quarantined");
    expect(await repository.listAllSources({ status: "active" })).toEqual([]);

    const rejected = await repository.upsertSource({
      ...sourceInputWithoutTrust(),
      id: created.id,
      trustStatus: "rejected"
    });
    const updatedWithoutTrust = await repository.upsertSource({
      ...sourceInputWithoutTrust(),
      id: created.id,
      sourceName: "Updated source name"
    });

    expect(rejected.trustStatus).toBe("rejected");
    expect(updatedWithoutTrust).toEqual(expect.objectContaining({
      id: created.id,
      sourceName: "Updated source name",
      trustStatus: "rejected"
    }));

    const beforeCandidateInsert = JSON.stringify(updatedWithoutTrust);
    const existingCandidate = await repository.insertQuarantinedSourceCandidate(sourceCandidateInput());
    const missingCandidate = await repository.insertQuarantinedSourceCandidate(sourceCandidateInput("https://www.example.edu.tr/haberler"));
    expect(JSON.stringify(existingCandidate)).toBe(beforeCandidateInsert);
    expect(missingCandidate).toEqual(expect.objectContaining({ status: "inactive", trustStatus: "quarantined" }));
  });

  it("quarantines new Mongo sources and does not overwrite an existing trust decision when omitted", async () => {
    const store = new FakeAnnouncementSourceModel();
    const repository = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(repository, "model", { value: async () => store });

    const created = await repository.upsertSource(sourceInputWithoutTrust());
    expect(created.trustStatus).toBe("quarantined");
    expect(store.records[0]?.trustStatus).toBe("quarantined");

    const rejected = await repository.upsertSource({
      ...sourceInputWithoutTrust(),
      id: created.id,
      trustStatus: "rejected"
    });
    const updatedWithoutTrust = await repository.upsertSource({
      ...sourceInputWithoutTrust(),
      id: created.id,
      sourceName: "Updated source name"
    });

    expect(rejected.trustStatus).toBe("rejected");
    expect(updatedWithoutTrust.trustStatus).toBe("rejected");
    expect(store.records[0]).toEqual(expect.objectContaining({
      sourceName: "Updated source name",
      trustStatus: "rejected"
    }));

    const beforeCandidateInsert = JSON.stringify(updatedWithoutTrust);
    const existingCandidate = await repository.insertQuarantinedSourceCandidate(sourceCandidateInput());
    const missingCandidate = await repository.insertQuarantinedSourceCandidate(sourceCandidateInput("https://www.example.edu.tr/haberler"));
    expect(JSON.stringify(existingCandidate)).toBe(beforeCandidateInsert);
    expect(missingCandidate).toEqual(expect.objectContaining({ status: "inactive", trustStatus: "quarantined" }));
    expect(store.records).toHaveLength(2);

    const [concurrentLeft, concurrentRight] = await Promise.all([
      repository.insertQuarantinedSourceCandidate(sourceCandidateInput("http://www.example.edu.tr/etkinlikler/")),
      repository.insertQuarantinedSourceCandidate(sourceCandidateInput("https://example.edu.tr/etkinlikler"))
    ]);
    expect(concurrentLeft.id).toBe(concurrentRight.id);
    expect(store.records).toHaveLength(3);

    const [legacyRegistryCandidate, approvedRegistryCandidate] = await Promise.all([
      repository.insertQuarantinedSourceCandidate(sourceCandidateInput("https://www.gtu.edu.tr/tr/icerik/9/30904/display.aspx")),
      repository.insertQuarantinedSourceCandidate(sourceCandidateInput("https://www.gtu.edu.tr/icerik/9/30904/display.aspx"))
    ]);
    expect(legacyRegistryCandidate.id).toBe(approvedRegistryCandidate.id);
    expect(store.records).toHaveLength(4);
  });

  it("atomically fills missing Mongo source verification evidence and reports later conflicts without overwriting", async () => {
    const store = new FakeAnnouncementSourceModel();
    const repository = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(repository, "model", { value: async () => store });
    const source = await repository.upsertSource(sourceInputWithoutTrust());
    const evidence = sourceVerificationEvidence();

    expect(await repository.attachVerificationEvidenceIfMissing(source.id, evidence)).toMatchObject({ outcome: "attached" });
    expect(await repository.attachVerificationEvidenceIfMissing(source.id, evidence)).toMatchObject({ outcome: "unchanged" });
    expect(await repository.attachVerificationEvidenceIfMissing(source.id, {
      ...evidence,
      runId: "second-run"
    })).toMatchObject({ outcome: "conflict" });
    expect((await repository.findSourceById(source.id))?.verificationEvidence?.runId).toBe("run-1");
  });

  it("rejects mismatched or unbounded Mongo candidate evidence before persistence", async () => {
    const store = new FakeAnnouncementSourceModel();
    const repository = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(repository, "model", { value: async () => store });
    const source = await repository.upsertSource(sourceInputWithoutTrust());

    await expect(repository.attachVerificationEvidenceIfMissing(source.id, {
      ...sourceVerificationEvidence(),
      finalUrl: "https://www.example.edu.tr/haberler",
      browserFinalUrl: "https://www.example.edu.tr/haberler",
      rawFinalUrl: "https://www.example.edu.tr/haberler"
    })).rejects.toThrow("ANNOUNCEMENT_SOURCE_VERIFICATION_FINAL_URL_MISMATCH");
    await expect(repository.insertQuarantinedSourceCandidate({
      ...sourceCandidateInput("https://www.example.edu.tr/etkinlikler"),
      ownerUniversityId: "university-1",
      verificationEvidence: {
        ...sourceVerificationEvidence(),
        sourceUrl: "https://www.example.edu.tr/etkinlikler",
        finalUrl: "https://www.example.edu.tr/etkinlikler",
        browserFinalUrl: "https://www.example.edu.tr/etkinlikler",
        rawFinalUrl: "https://www.example.edu.tr/etkinlikler",
        evidencePath: "../outside/evidence.html"
      }
    })).rejects.toThrow("ANNOUNCEMENT_SOURCE_VERIFICATION_EVIDENCE_PATH_INVALID");

    expect(store.records).toHaveLength(1);
    expect((await repository.findSourceById(source.id))?.verificationEvidence).toBeUndefined();
  });

  it("rejects stale, partially bound, or cross-owned crawler evidence", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource(sourceInputWithoutTrust());
    const current = sourceVerificationEvidence();
    const { parserEvidencePath: _parserEvidencePath, ...partialParserEvidence } = current;
    void _parserEvidencePath;

    await expect(repository.attachVerificationEvidenceIfMissing(source.id, {
      ...current,
      unitType: "faculty"
    })).rejects.toThrow("ANNOUNCEMENT_SOURCE_VERIFICATION_SCOPE_MISMATCH");
    await expect(repository.attachVerificationEvidenceIfMissing(
      source.id,
      partialParserEvidence as AnnouncementSourceVerificationEvidence
    )).rejects.toThrow("EVIDENCE_PARSER_REFERENCE_PAIR_INVALID");
    await expect(repository.attachVerificationEvidenceIfMissing(source.id, {
      ...current,
      verifierVersion: "authority-pinned-browser-and-raw-v7"
    } as unknown as AnnouncementSourceVerificationEvidence)).rejects.toThrow("EVIDENCE_VERIFIER_INVALID");
    expect((await repository.findSourceById(source.id))?.verificationEvidence).toBeUndefined();
  });

  it("removes stale verification evidence when a source processing definition changes", async () => {
    const mongoStore = new FakeAnnouncementSourceModel();
    const mongo = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(mongo, "model", { value: async () => mongoStore });

    for (const repository of [new InMemoryAnnouncementRepository(), mongo]) {
      const source = await repository.upsertSource({
        ...sourceInputWithoutTrust(),
        verificationEvidence: sourceVerificationEvidence()
      });
      const updated = await repository.updateSource(source.id, {
        ...sourceInputWithoutTrust(),
        sourceUrl: "https://www.example.edu.tr/duyurular-yeni"
      }, sourceEditFenceFor(source));

      expect(updated).toMatchObject({ sourceUrl: "https://www.example.edu.tr/duyurular-yeni" });
      expect(updated?.verificationEvidence).toBeUndefined();
    }
  });

  it("keeps the same scoped URL distinct and idempotent across all content types", async () => {
    const mongoStore = new FakeAnnouncementSourceModel();
    const mongo = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(mongo, "model", { value: async () => mongoStore });

    for (const repository of [new InMemoryAnnouncementRepository(), mongo]) {
      const firstPass = await Promise.all((["announcement", "news", "event"] as const).map((contentType) =>
        repository.insertQuarantinedSourceCandidate({
          ...sourceCandidateInput("https://www.example.edu.tr/content"),
          sourceName: `${contentType} source`,
          contentType
        })));
      const secondPass = await Promise.all((["announcement", "news", "event"] as const).map((contentType) =>
        repository.insertQuarantinedSourceCandidate({
          ...sourceCandidateInput("https://www.example.edu.tr/content"),
          sourceName: `${contentType} source`,
          contentType
        })));

      expect(new Set(firstPass.map((source) => source.id))).toHaveProperty("size", 3);
      expect(secondPass.map((source) => source.id)).toEqual(firstPass.map((source) => source.id));
      expect(firstPass.map((source) => source.contentType).sort()).toEqual(["announcement", "event", "news"]);
    }
  });

  it.each(["trusted", "rejected", "quarantined"] as const)(
    "leaves an existing Mongo %s source byte-for-byte unchanged when inserting its alias as a candidate",
    async (trustStatus) => {
      const store = new FakeAnnouncementSourceModel();
      const repository = new MongoAnnouncementRepository({} as never);
      Object.defineProperty(repository, "model", { value: async () => store });
      const existing = await repository.upsertSource({
        ...sourceInputWithoutTrust(),
        sourceUrl: "https://www.gtu.edu.tr/tr/icerik/9/30904/display.aspx",
        homepageUrl: "https://www.gtu.edu.tr/",
        status: trustStatus === "trusted" ? "active" : "inactive",
        trustStatus,
        ...(trustStatus === "trusted" ? {} : { trustReasonCodes: ["unofficial_source" as const] })
      });
      const before = JSON.stringify(existing);

      const returned = await repository.insertQuarantinedSourceCandidate(
        sourceCandidateInput("https://www.gtu.edu.tr/icerik/9/30904/display.aspx")
      );

      expect(JSON.stringify(returned)).toBe(before);
      expect(JSON.stringify(await repository.findSourceById(existing.id))).toBe(before);
      expect(store.records).toHaveLength(1);
    }
  );

  it("matches a validated source URL upgrade during generic upsert without resetting trust", async () => {
    const inMemory = new InMemoryAnnouncementRepository();
    const inMemoryLegacy = await inMemory.upsertSource({
      ...sourceInputWithoutTrust(),
      sourceUrl: "https://www.gtu.edu.tr/tr/icerik/9/30904/display.aspx",
      homepageUrl: "https://www.gtu.edu.tr/",
      status: "inactive",
      trustStatus: "rejected"
    });
    const inMemoryUpgrade = await inMemory.upsertSource({
      ...sourceInputWithoutTrust(),
      sourceUrl: "https://www.gtu.edu.tr/icerik/9/30904/display.aspx",
      homepageUrl: "https://www.gtu.edu.tr/",
      status: "inactive"
    });
    expect(inMemoryUpgrade).toEqual(expect.objectContaining({
      id: inMemoryLegacy.id,
      trustStatus: "rejected"
    }));

    const store = new FakeAnnouncementSourceModel();
    const mongo = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(mongo, "model", { value: async () => store });
    const mongoLegacy = await mongo.upsertSource({
      ...sourceInputWithoutTrust(),
      sourceUrl: "https://www.gtu.edu.tr/tr/icerik/9/30904/display.aspx",
      homepageUrl: "https://www.gtu.edu.tr/",
      status: "inactive",
      trustStatus: "rejected"
    });
    const mongoUpgrade = await mongo.upsertSource({
      ...sourceInputWithoutTrust(),
      sourceUrl: "https://www.gtu.edu.tr/icerik/9/30904/display.aspx",
      homepageUrl: "https://www.gtu.edu.tr/",
      status: "inactive"
    });
    expect(mongoUpgrade).toEqual(expect.objectContaining({
      id: mongoLegacy.id,
      trustStatus: "rejected"
    }));
    expect(store.records).toHaveLength(1);
  });

  it("invalidates conditional-fetch validators and the public snapshot when the processing definition changes", async () => {
    const validators = {
      etag: "etag-v1",
      lastModified: "Tue, 01 Sep 2026 10:00:00 GMT",
      contentHash: "a".repeat(64),
      processingVersion: "announcement-ingestion-v1",
      lastContentChangedAt: new Date("2026-09-01T10:00:00.000Z"),
      activeSnapshotId: "64a000000000000000000001"
    };

    const inMemory = new InMemoryAnnouncementRepository();
    const inMemoryCreated = await inMemory.upsertSource({ ...sourceInput(), ...validators });
    const inMemorySource = (inMemory as unknown as {
      sources: Map<string, AnnouncementSourceRecord>;
    }).sources.get(inMemoryCreated.id);
    if (!inMemorySource) throw new Error("Expected in-memory source.");
    inMemorySource.activeSnapshotId = validators.activeSnapshotId;
    const inMemorySameDefinition = await inMemory.upsertSource({
      ...sourceInput(),
      id: inMemoryCreated.id,
      sourceName: "Yeni görünen ad"
    });
    expect(inMemorySameDefinition).toEqual(expect.objectContaining(validators));
    expect(inMemorySameDefinition.sourceDefinitionVersion).toBe(inMemoryCreated.sourceDefinitionVersion);
    const inMemoryChanged = await inMemory.upsertSource({
      ...sourceInput(),
      id: inMemoryCreated.id,
      parser: "rss"
    });
    expect(inMemoryChanged.activeSnapshotId).toBeUndefined();
    expect(inMemoryChanged.sourceDefinitionVersion).not.toBe(inMemoryCreated.sourceDefinitionVersion);
    for (const field of ["etag", "lastModified", "contentHash", "processingVersion", "lastContentChangedAt"] as const) {
      expect(inMemoryChanged[field]).toBeUndefined();
    }
    const staleInMemoryCheck = await inMemory.recordSourceCheck(inMemoryCreated.id, {
      healthStatus: "healthy",
      lastCheckedAt: new Date("2026-09-02T10:00:00.000Z"),
      consecutiveFailures: 0,
      itemCount: 99,
      etag: "stale-etag",
      contentHash: "b".repeat(64),
      processingVersion: "stale-processing-version"
    }, inMemoryCreated);
    expect(staleInMemoryCheck).toBeNull();
    const afterStaleInMemoryCheck = await inMemory.findSourceById(inMemoryCreated.id);
    expect(afterStaleInMemoryCheck?.sourceDefinitionVersion).toBe(inMemoryChanged.sourceDefinitionVersion);
    expect(afterStaleInMemoryCheck?.itemCount).toBeUndefined();
    expect(afterStaleInMemoryCheck?.etag).toBeUndefined();
    expect(afterStaleInMemoryCheck?.contentHash).toBeUndefined();
    expect(afterStaleInMemoryCheck?.processingVersion).toBeUndefined();
    await expect(inMemory.quarantineSource(
      inMemoryCreated.id,
      ["unofficial_source"],
      inMemoryCreated
    )).resolves.toBeNull();
    expect(await inMemory.findSourceById(inMemoryCreated.id)).toEqual(expect.objectContaining({
      status: "active",
      trustStatus: "trusted",
      sourceDefinitionVersion: inMemoryChanged.sourceDefinitionVersion
    }));

    const store = new FakeAnnouncementSourceModel();
    const mongo = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(mongo, "model", { value: async () => store });
    const mongoCreated = await mongo.upsertSource({ ...sourceInput(), ...validators });
    store.records[0]!.activeSnapshotId = validators.activeSnapshotId;
    store.records[0]!.pendingSnapshotId = "64a000000000000000000062";
    store.records[0]!.pendingSnapshotRevision = 1;
    store.records[0]!.pendingSnapshotExpiresAt = new Date("2026-09-12T00:00:00.000Z");
    const mongoSameDefinition = await mongo.upsertSource({
      ...sourceInput(),
      id: mongoCreated.id,
      sourceName: "Yeni görünen ad"
    });
    expect(mongoSameDefinition).toEqual(expect.objectContaining(validators));
    expect(mongoSameDefinition.sourceDefinitionVersion).toBe(mongoCreated.sourceDefinitionVersion);
    const mongoChanged = await mongo.upsertSource({
      ...sourceInput(),
      id: mongoCreated.id,
      contentType: "news"
    });
    expect(mongoChanged.activeSnapshotId).toBeUndefined();
    expect(mongoChanged.snapshotStateRevision).toBe(1);
    expect(mongoChanged.snapshotIntentRevision).toBe(1);
    expect(mongoChanged.sourceDefinitionVersion).not.toBe(mongoCreated.sourceDefinitionVersion);
    expect(mongoChanged.pendingSnapshotId).toBeUndefined();
    expect(mongoChanged.pendingSnapshotRevision).toBeUndefined();
    expect(mongoChanged.pendingSnapshotExpiresAt).toBeUndefined();
    for (const field of ["etag", "lastModified", "contentHash", "processingVersion", "lastContentChangedAt"] as const) {
      expect(mongoChanged[field]).toBeUndefined();
    }
  });

  it("rotates only the notification producer generation when a trusted source is reactivated", async () => {
    const validators = {
      etag: "etag-v1",
      contentHash: "a".repeat(64),
      processingVersion: "announcement-ingestion-v2",
      activeSnapshotId: "64a000000000000000000061"
    };
    const inMemory = new InMemoryAnnouncementRepository();
    const inMemoryCreated = await inMemory.upsertSource({ ...sourceInput(), ...validators });
    const inMemorySources = (inMemory as unknown as {
      sources: Map<string, AnnouncementSourceRecord>;
    }).sources;
    inMemorySources.set(inMemoryCreated.id, { ...inMemoryCreated, activeSnapshotId: validators.activeSnapshotId });
    await inMemory.deactivateSource(inMemoryCreated.id, sourceReviewFenceFor(inMemoryCreated));
    const inMemoryReactivated = await inMemory.upsertSource({
      ...sourceInput(),
      id: inMemoryCreated.id,
      ...validators
    });
    expect(inMemoryReactivated.sourceDefinitionVersion).toBe(inMemoryCreated.sourceDefinitionVersion);
    expect(inMemoryReactivated.notificationProducerVersion).not.toBe(inMemoryCreated.notificationProducerVersion);
    expect(inMemoryReactivated).toEqual(expect.objectContaining(validators));

    const store = new FakeAnnouncementSourceModel();
    const mongo = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(mongo, "model", { value: async () => store });
    const mongoCreated = await mongo.upsertSource({ ...sourceInput(), ...validators });
    store.records[0]!.activeSnapshotId = validators.activeSnapshotId;
    await mongo.deactivateSource(mongoCreated.id, sourceReviewFenceFor(mongoCreated));
    const mongoReactivated = await mongo.upsertSource({
      ...sourceInput(),
      id: mongoCreated.id,
      ...validators
    });
    expect(mongoReactivated.sourceDefinitionVersion).toBe(mongoCreated.sourceDefinitionVersion);
    expect(mongoReactivated.notificationProducerVersion).not.toBe(mongoCreated.notificationProducerVersion);
    expect(mongoReactivated).toEqual(expect.objectContaining(validators));
  });

  it("atomically rejects stale source deactivation fences in both repositories", async () => {
    const inMemory = new InMemoryAnnouncementRepository();
    const mongoStore = new FakeAnnouncementSourceModel();
    const mongo = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(mongo, "model", { value: async () => mongoStore });

    for (const repository of [inMemory, mongo]) {
      const created = await repository.upsertSource(sourceInput());
      await expect(repository.deactivateSource(created.id, {
        ...sourceReviewFenceFor(created),
        expectedSourceStatus: "inactive"
      })).resolves.toBeNull();
      await expect(repository.findSourceById(created.id)).resolves.toMatchObject({ status: "active" });
      await expect(repository.deactivateSource(created.id, sourceReviewFenceFor(created)))
        .resolves.toMatchObject({ status: "inactive", approvalPending: false });
    }
  });

  it("atomically fences source trust reviews without overwriting concurrent non-definition edits", async () => {
    const mongoStore = new FakeAnnouncementSourceModel();
    const mongo = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(mongo, "model", { value: async () => mongoStore });
    const repositories = [new InMemoryAnnouncementRepository(), mongo];

    for (const repository of repositories) {
      const candidate = await repository.insertQuarantinedSourceCandidate(sourceCandidateInput());
      const staleFence = sourceReviewFenceFor(candidate);
      const concurrentlyRenamed = await repository.upsertSource({
        ...sourceInputWithoutTrust(),
        id: candidate.id,
        sourceName: "Concurrent display-name edit",
        status: "inactive"
      });
      const approved = await repository.reviewSource(candidate.id, {
        decision: "approve",
        reviewedBy: "admin-1",
        reviewedAt: new Date("2026-09-10T08:00:00.000Z")
      }, staleFence);

      expect(approved).toMatchObject({
        sourceName: "Concurrent display-name edit",
        status: "active",
        trustStatus: "trusted",
        reviewedBy: "admin-1"
      });
      expect(approved?.notificationProducerVersion).not.toBe(concurrentlyRenamed.notificationProducerVersion);
      await expect(repository.reviewSource(candidate.id, { decision: "reject" }, staleFence)).resolves.toBeNull();
      expect(await repository.findSourceById(candidate.id)).toMatchObject({
        sourceName: "Concurrent display-name edit",
        status: "active",
        trustStatus: "trusted"
      });
    }
  });

  it("atomically rotates the persisted timestamp fence when a stuck approval lease is retried", async () => {
    const mongoStore = new FakeAnnouncementSourceModel();
    const mongo = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(mongo, "model", { value: async () => mongoStore });

    for (const repository of [new InMemoryAnnouncementRepository(), mongo]) {
      const candidate = await repository.insertQuarantinedSourceCandidate(sourceCandidateInput());
      const firstReviewedAt = new Date("2026-09-10T07:00:00.000Z");
      const initialFence = {
        ...sourceReviewFenceFor(candidate),
        expectedReviewedAt: null
      };
      const staged = await repository.reviewSource(candidate.id, {
        decision: "approve",
        reviewedBy: "admin-before-crash",
        reviewedAt: firstReviewedAt
      }, initialFence);
      if (!staged) throw new Error("Expected initial approval lease.");

      await expect(repository.reviewSource(candidate.id, {
        decision: "approve",
        reviewedBy: "duplicate-initial",
        reviewedAt: new Date("2026-09-10T07:01:00.000Z")
      }, initialFence)).resolves.toBeNull();

      const retryFence = {
        ...sourceReviewFenceFor(staged),
        expectedReviewedAt: firstReviewedAt
      };
      const retriedAt = new Date("2026-09-10T08:00:00.000Z");
      const retried = await repository.reviewSource(staged.id, {
        decision: "approve",
        reviewedBy: "admin-retry",
        reviewedAt: retriedAt
      }, retryFence);
      expect(retried).toEqual(expect.objectContaining({
        approvalPending: true,
        reviewedBy: "admin-retry",
        reviewedAt: retriedAt
      }));
      if (!retried) throw new Error("Expected replacement approval lease.");
      const healthyRetry = await repository.recordSourceCheck(retried.id, {
        healthStatus: "healthy",
        lastCheckedAt: retriedAt,
        lastSuccessAt: retriedAt,
        consecutiveFailures: 0,
        itemCount: 1
      }, retried, null);
      if (!healthyRetry) throw new Error("Expected replacement lease health write.");
      await expect(repository.recordSourceCheck(staged.id, {
        healthStatus: "failed",
        lastCheckedAt: new Date("2026-09-10T08:01:00.000Z"),
        consecutiveFailures: 1,
        itemCount: 0
      }, staged, null)).resolves.toBeNull();
      await expect(repository.quarantineSource(staged.id, ["unofficial_source"], staged)).resolves.toBeNull();
      await expect(repository.completeSourceApproval(staged.id, staged, null)).resolves.toBeNull();
      await expect(repository.completeSourceApproval(healthyRetry.id, healthyRetry, null)).resolves.toEqual(
        expect.objectContaining({ approvalPending: false, reviewedAt: retriedAt })
      );
      await expect(repository.reviewSource(staged.id, {
        decision: "approve",
        reviewedBy: "duplicate-retry",
        reviewedAt: new Date("2026-09-10T08:01:00.000Z")
      }, retryFence)).resolves.toBeNull();
    }
  });

  it("keeps staged approvals private and publishes only one healthy source generation with CAS", async () => {
    const mongoStore = new FakeAnnouncementSourceModel();
    const mongo = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(mongo, "model", { value: async () => mongoStore });

    for (const repository of [new InMemoryAnnouncementRepository(), mongo]) {
      const candidate = await repository.insertQuarantinedSourceCandidate(sourceCandidateInput());
      const staged = await repository.reviewSource(
        candidate.id,
        { decision: "approve", reviewedBy: "admin-1" },
        sourceReviewFenceFor(candidate)
      );
      if (!staged) throw new Error("Expected staged source approval.");

      expect(staged).toMatchObject({
        status: "active",
        trustStatus: "trusted",
        approvalPending: true
      });
      await expect(repository.listSourcesByScope({ universityId: staged.scopeId })).resolves.toEqual([]);
      const checked = await repository.recordSourceCheck(staged.id, {
        healthStatus: "healthy",
        lastCheckedAt: new Date("2026-09-10T09:00:00.000Z"),
        lastSuccessAt: new Date("2026-09-10T09:00:00.000Z"),
        consecutiveFailures: 0,
        itemCount: 1
      }, staged, null);
      if (!checked) throw new Error("Expected healthy staged source.");

      const published = await repository.completeSourceApproval(checked.id, checked, null);
      expect(published).toMatchObject({
        status: "active",
        trustStatus: "trusted",
        approvalPending: false,
        healthStatus: "healthy",
        itemCount: 1
      });
      await expect(repository.completeSourceApproval(checked.id, checked, null)).resolves.toBeNull();
      await expect(repository.listSourcesByScope({ universityId: staged.scopeId })).resolves.toEqual([
        expect.objectContaining({ id: staged.id, approvalPending: false })
      ]);
    }
  });

  it("atomically rejects a stale metadata edit after a concurrent trust decision", async () => {
    const mongoStore = new FakeAnnouncementSourceModel();
    const mongo = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(mongo, "model", { value: async () => mongoStore });
    const repositories = [new InMemoryAnnouncementRepository(), mongo];

    for (const repository of repositories) {
      const candidate = await repository.insertQuarantinedSourceCandidate(sourceCandidateInput());
      const staleEditFence = sourceEditFenceFor(candidate);
      const rejected = await repository.reviewSource(candidate.id, { decision: "reject" }, sourceReviewFenceFor(candidate));
      expect(rejected?.trustStatus).toBe("rejected");

      await expect(repository.updateSource(candidate.id, {
        ...sourceInput(),
        scopeType: candidate.scopeType,
        scopeId: candidate.scopeId
      }, staleEditFence)).resolves.toBeNull();
      await expect(repository.findSourceById(candidate.id)).resolves.toEqual(expect.objectContaining({
        status: "inactive",
        trustStatus: "rejected"
      }));
    }
  });
});

describe("announcement normalized persistence identity", () => {
  it("resets approval when only the canonical source body changes", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource(sourceInput());
    await repository.replaceItemsForSource(source, [{
      ...item(source, "parser-body-before", "body-only"),
      body: [{ type: "paragraph", text: "Applications open on Monday." }]
    }]);
    const initial = await repository.findReviewItemById("parser-body-before");
    if (!initial?.item.contentFingerprint) throw new Error("Expected initial fingerprint.");
    const approved = await repository.updateReviewItem(initial.item.id, { reviewStatus: "approved" }, {
      expectedContentFingerprint: initial.item.contentFingerprint,
      ...(initial.item.reviewRevision ? { expectedReviewRevision: initial.item.reviewRevision } : {})
    });
    if (!approved) throw new Error("Expected approved review item.");

    const delta = await repository.replaceItemsForSource(source, [{
      ...item(source, "parser-body-after", "body-only"),
      body: [{ type: "paragraph", text: "Applications close on Monday." }]
    }]);
    const refreshed = await repository.findReviewItemById(initial.item.id);

    expect(delta.materiallyUpdated).toEqual([expect.objectContaining({ id: initial.item.id })]);
    expect(refreshed?.item.contentFingerprint).not.toBe(initial.item.contentFingerprint);
    expect(refreshed?.item.reviewStatus).toBe("pending_review");
    expect(refreshed?.item.reviewRevision).not.toBe(approved.item.reviewRevision);
  });

  it("resets approval when deterministic classifier output changes without changing the content fingerprint", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource(sourceInput());
    const classified = {
      ...item(source, "classifier-before", "classifier-only"),
      classificationVersion: "student-relevance-rules-v2" as const,
      keyDates: [{ label: "Deadline", startDate: "2026-09-20" }]
    };
    await repository.replaceItemsForSource(source, [classified]);
    const initial = await repository.findReviewItemById("classifier-before");
    if (!initial?.item.contentFingerprint) throw new Error("Expected initial classifier fingerprint.");
    const approved = await repository.updateReviewItem(initial.item.id, { reviewStatus: "approved" }, {
      expectedContentFingerprint: initial.item.contentFingerprint,
      ...(initial.item.reviewRevision ? { expectedReviewRevision: initial.item.reviewRevision } : {})
    });
    if (!approved) throw new Error("Expected approved classifier review item.");

    const delta = await repository.replaceItemsForSource(source, [{
      ...classified,
      id: "classifier-after",
      keyDates: [{ label: "Deadline", startDate: "2026-09-27" }]
    }]);
    const refreshed = await repository.findReviewItemById(initial.item.id);

    expect(refreshed?.item.contentFingerprint).toBe(initial.item.contentFingerprint);
    expect(refreshed?.item.deadline).toBe("2026-09-27");
    expect(refreshed?.item.reviewStatus).toBe("pending_review");
    expect(refreshed?.item.reviewRevision).not.toBe(approved.item.reviewRevision);
    expect(delta.materiallyUpdated).toEqual([expect.objectContaining({ id: initial.item.id })]);
  });

  it("resets approval when a previously unversioned deterministic classification is regenerated", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource(sourceInput());
    const raw = item(source, "classifier-version-before", "classifier-version");
    await repository.replaceItemsForSource(source, [raw]);
    const initial = await repository.findReviewItemById(raw.id);
    if (!initial?.item.contentFingerprint) throw new Error("Expected initial classifier-version fingerprint.");
    await repository.updateReviewItem(initial.item.id, { reviewStatus: "approved" }, {
      expectedContentFingerprint: initial.item.contentFingerprint,
      ...(initial.item.reviewRevision ? { expectedReviewRevision: initial.item.reviewRevision } : {})
    });

    await repository.replaceItemsForSource(source, [{
      ...raw,
      id: "classifier-version-after",
      classificationVersion: "student-relevance-rules-v2"
    }]);
    const refreshed = await repository.findReviewItemById(initial.item.id);

    expect(refreshed?.item.contentFingerprint).toBe(initial.item.contentFingerprint);
    expect(refreshed?.item.classificationVersion).toBe("student-relevance-rules-v2");
    expect(refreshed?.item.reviewStatus).toBe("pending_review");
  });

  it("keeps human review identity across a canonical URL move when raw content and adjudication are unchanged", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource(sourceInput());
    const raw = {
      ...item(source, "parser-original", "original-location"),
      classificationVersion: "student-relevance-rules-v2" as const
    };
    const created = await repository.replaceItemsForSource(source, [raw]);
    expect(await repository.acknowledgeNotificationProduction(created.created)).toBe(1);
    const initial = await repository.findReviewItemById(raw.id);
    if (!initial?.item.contentFingerprint) throw new Error("Expected original content fingerprint.");
    const humanTitle = "Admin-curated registration announcement";
    const approved = await repository.updateReviewItem(initial.item.id, {
      title: humanTitle,
      humanOverride: { title: humanTitle },
      reviewStatus: "approved"
    }, {
      expectedContentFingerprint: initial.item.contentFingerprint,
      ...(initial.item.reviewRevision ? { expectedReviewRevision: initial.item.reviewRevision } : {})
    });
    if (!approved) throw new Error("Expected approved human review.");

    const delta = await repository.replaceItemsForSource(source, [{
      ...raw,
      id: "parser-moved",
      link: "https://www.example.edu.tr/duyuru/moved-location"
    }]);
    const refreshed = await repository.findReviewItemById(initial.item.id);

    expect(delta.unchanged).toEqual([expect.objectContaining({ id: initial.item.id })]);
    expect(delta.created).toEqual([]);
    expect(delta.removed).toEqual([]);
    expect(refreshed?.item).toEqual(expect.objectContaining({
      id: initial.item.id,
      title: humanTitle,
      humanOverride: { title: humanTitle },
      reviewStatus: "approved",
      reviewRevision: approved.item.reviewRevision,
      canonicalUrl: "https://www.example.edu.tr/duyuru/moved-location"
    }));
    await expect(repository.findReviewItemById("parser-moved")).resolves.toBeNull();
  });

  it("keeps a real in-memory ID across URL aliases and reports material and authoritative-empty deltas", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource(sourceInput());

    const first = await repository.replaceItemsForSource(source, [item(source, "parser-first", "bir")]);
    expect(first).toEqual(expect.objectContaining({
      created: [expect.objectContaining({ id: "parser-first", scopeId: source.scopeId })],
      materiallyUpdated: [],
      unchanged: [],
      removed: []
    }));
    const retry = await repository.replaceItemsForSource(source, [item(source, "parser-retry", "bir")]);
    expect(retry.materiallyUpdated.map((reference) => reference.id)).toEqual(["parser-first"]);
    expect(await repository.acknowledgeNotificationProduction(first.created)).toBe(1);

    const alias = await repository.replaceItemsForSource(source, [item(source, "parser-alias", "iki")]);
    expect(alias.unchanged).toEqual([expect.objectContaining({
      id: "parser-first",
      sourceId: source.id,
      scopeType: source.scopeType,
      scopeId: source.scopeId
    })]);
    expect((await repository.listItemsForSource(source.id))[0]).toEqual(expect.objectContaining({
      id: "parser-first",
      canonicalUrl: "https://www.example.edu.tr/duyuru/iki",
      canonicalUrlAliases: [
        "https://www.example.edu.tr/duyuru/bir",
        "https://www.example.edu.tr/duyuru/iki"
      ]
    }));

    const changed = await repository.replaceItemsForSource(source, [item(source, "parser-changed", "iki", "Düzeltilmiş özet")]);
    expect(changed.materiallyUpdated).toEqual([expect.objectContaining({ id: "parser-first" })]);

    expect(await repository.replaceItemsForSource(source, [])).toEqual({
      created: [], materiallyUpdated: [], unchanged: [], removed: []
    });
    expect(await repository.listItemsForSource(source.id)).toHaveLength(1);
    const retired = await repository.replaceItemsForSource(source, [], { authoritativeEmpty: true });
    expect(retired.removed).toEqual([expect.objectContaining({ id: "parser-first" })]);
    expect(await repository.listItemsForSource(source.id)).toEqual([]);
  });

  it("uses Mongo-assigned IDs with the same alias/update/removal delta semantics", async () => {
    const source = mongoSource();
    const store = new FakeAnnouncementItemModel();
    const repository = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(repository, "model", { value: async () => store });

    const first = await repository.replaceItemsForSource(source, [item(source, "parser-first", "bir")]);
    const persistedId = first.created[0]?.id;
    expect(persistedId).toBe("64f000000000000000000001");
    expect(persistedId).not.toBe("parser-first");
    const retry = await repository.replaceItemsForSource(source, [item(source, "parser-retry", "bir")]);
    expect(retry.materiallyUpdated.map((reference) => reference.id)).toEqual([persistedId]);
    expect(await repository.acknowledgeNotificationProduction(first.created)).toBe(1);

    const alias = await repository.replaceItemsForSource(source, [item(source, "parser-alias", "iki")]);
    expect(alias.unchanged.map((reference) => reference.id)).toEqual([persistedId]);
    expect(store.records[0]).toEqual(expect.objectContaining({
      canonicalUrlAliases: [
        "https://www.example.edu.tr/duyuru/bir",
        "https://www.example.edu.tr/duyuru/iki"
      ]
    }));

    const changed = await repository.replaceItemsForSource(source, [item(source, "parser-changed", "iki", "Düzeltilmiş özet")]);
    expect(changed.materiallyUpdated.map((reference) => reference.id)).toEqual([persistedId]);

    expect(await repository.replaceItemsForSource(source, [])).toEqual({
      created: [], materiallyUpdated: [], unchanged: [], removed: []
    });
    expect(store.records).toHaveLength(1);
    const retired = await repository.replaceItemsForSource(source, [], { authoritativeEmpty: true });
    expect(retired.removed.map((reference) => reference.id)).toEqual([persistedId]);
    expect(store.records).toEqual([]);
  });

  it("does not mark legacy rows without runtime eligibility for notification replay", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource(sourceInput());
    await repository.replaceItemsForSource(source, [item(source, "legacy-id", "legacy")]);
    const stored = (repository as unknown as { items: Map<string, AnnouncementItem[]> }).items.get(source.id)?.[0];
    expect(stored).toBeDefined();
    delete stored!.notificationEligibleFingerprint;
    delete stored!.notificationProducedFingerprint;

    const delta = await repository.replaceItemsForSource(source, [item(source, "new-parser-id", "legacy")]);
    expect(delta.unchanged.map((reference) => reference.id)).toEqual(["legacy-id"]);
    expect(delta.materiallyUpdated).toEqual([]);
  });
});

describe("standalone Mongo announcement snapshot activation", () => {
  it("indexes review-item lookup by embedded id and snapshot recency", () => {
    expect(announcementSnapshotSchema.indexes()).toEqual(expect.arrayContaining([[
      { "items.id": 1, createdAt: -1 },
      expect.objectContaining({ name: "announcement_snapshots_review_item_lookup" })
    ]]));
    expect(announcementSnapshotSchema.indexes()).toEqual(expect.arrayContaining([[
      { nextRetentionCheckAt: 1, createdAt: 1, purgeAfter: 1, activationLeaseUntil: 1 },
      expect.objectContaining({ name: "announcement_snapshots_retention_candidates" })
    ], [
      { purgeAfter: 1 },
      expect.objectContaining({
        expireAfterSeconds: 0,
        name: "announcement_snapshots_purge_after_ttl"
      })
    ]]));
    expect(announcementSnapshotSchema.path("sourceRevision")).toBeDefined();
    expect(announcementSnapshotSchema.path("activationLeaseUntil")).toBeDefined();
    expect(announcementSnapshotSchema.path("nextRetentionCheckAt")).toBeDefined();
    expect(announcementSnapshotSchema.path("purgeAfter")).toBeDefined();
    expect(announcementSourceSchema.path("snapshotStateRevision")).toBeDefined();
  });

  it("applies review pagination inside the Mongo aggregation", async () => {
    const aggregate = vi.fn(async (_pipeline: Array<Record<string, unknown>>) => []);
    const repository = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(repository, "model", { value: async () => ({ aggregate }) });

    await repository.listReviewItems({ limit: 25, offset: 50 });

    const pipeline = aggregate.mock.calls[0]![0];
    expect(pipeline).toEqual(expect.arrayContaining([{ $skip: 50 }, { $limit: 25 }]));
  });

  it("fails closed for legacy trusted items that are not approved", async () => {
    const source = snapshotMongoSource();
    const itemId = "64f000000000000000000071";
    const legacyItem: AnnouncementItem = {
      ...item(source, itemId, "legacy-review-gate"),
      id: itemId,
      reviewStatus: "pending_review"
    };
    const sourceModel = {
      find: vi.fn(async () => [new FakeDocument(source.id, source as unknown as Record<string, unknown>)])
    };
    const legacyFindOne = vi.fn(async () => new FakeDocument(itemId, legacyItem as unknown as Record<string, unknown>));
    const repository = new MongoAnnouncementRepository({} as never);
    Object.defineProperty(repository, "model", {
      value: async (name: string) => name === "AnnouncementSource"
        ? sourceModel
        : { findOne: legacyFindOne }
    });

    await expect(repository.findTrustedItemByIdInScope({
      announcementId: itemId,
      universityId: source.scopeId
    })).resolves.toBeNull();
    expect(legacyFindOne).toHaveBeenLastCalledWith(expect.objectContaining({ reviewStatus: "approved" }));

    legacyItem.reviewStatus = "approved";
    await expect(repository.findTrustedItemByIdInScope({
      announcementId: itemId,
      universityId: source.scopeId
    })).resolves.toEqual(expect.objectContaining({ item: expect.objectContaining({ id: itemId, reviewStatus: "approved" }) }));
  });

  it("resolves a review item through the source activeSnapshotId without a latest-history cap", async () => {
    const source = snapshotMongoSource();
    const itemId = "64f000000000000000000072";
    const snapshotId = "64a000000000000000000072";
    const activeItem = {
      ...item(source, itemId, "active-review-item"),
      id: itemId,
      reviewStatus: "pending_review" as const
    };
    const { id: _sourceId, ...sourceFields } = source;
    const aggregate = vi.fn(async (_pipeline: Array<Record<string, unknown>>) => [{
      ...sourceFields,
      _id: source.id,
      activeSnapshotId: snapshotId,
      activeReviewSnapshot: {
        _id: snapshotId,
        sourceId: source.id,
        items: [activeItem]
      }
    }]);
    const legacyFindOne = vi.fn(async () => null);
    const repository = new MongoAnnouncementRepository({
      getConnection: () => ({}),
      connect: async () => ({})
    } as never);
    Object.defineProperty(repository, "model", {
      value: async (name: string) => name === "AnnouncementSource"
        ? { aggregate }
        : name === "AnnouncementItem"
          ? { findOne: legacyFindOne }
          : (() => { throw new Error(`Unexpected model: ${name}`); })()
    });

    await expect(repository.findReviewItemById(itemId)).resolves.toEqual({
      source: expect.objectContaining({ id: source.id, activeSnapshotId: snapshotId }),
      item: expect.objectContaining({ id: itemId, snapshotId })
    });
    expect(legacyFindOne).not.toHaveBeenCalled();
    const pipeline = aggregate.mock.calls[0]![0];
    expect(pipeline).toEqual(expect.arrayContaining([
      { $match: { status: "active", trustStatus: "trusted", activeSnapshotId: { $type: "string" } } },
      expect.objectContaining({ $lookup: expect.objectContaining({ from: "announcement_snapshots" }) })
    ]));
    expect(JSON.stringify(pipeline)).not.toContain('"$limit":8');
  });

  it.each([
    ["deactivation", { status: "inactive" as const }],
    ["rejection", { trustStatus: "rejected" as const }]
  ])("does not commit a legacy review after concurrent source %s", async (_scenario, concurrentSourceState) => {
    const source = snapshotMongoSource();
    const legacy = {
      ...item(source, "64f000000000000000000073", "legacy-review-race"),
      id: "64f000000000000000000073",
      reviewStatus: "pending_review" as const
    };
    legacy.contentFingerprint = fingerprintFor(legacy);
    const harness = snapshotHarness(source, [legacy], { concurrentSourceState });
    const observed = await harness.repository.findReviewItemById(legacy.id);
    if (!observed?.item.contentFingerprint) throw new Error("Expected legacy review item.");

    await expect(harness.repository.updateReviewItem(legacy.id, { reviewStatus: "approved" }, {
      expectedContentFingerprint: observed.item.contentFingerprint
    })).rejects.toThrow("ANNOUNCEMENT_REVIEW_SNAPSHOT_CONFLICT");

    expect(harness.sourceState).toEqual(expect.objectContaining(concurrentSourceState));
    expect(legacy.reviewStatus).toBe("pending_review");
    expect(harness.snapshots).toEqual([]);
  });

  it("migrates a successful legacy review through one active snapshot CAS", async () => {
    const source = snapshotMongoSource();
    const legacy = {
      ...item(source, "64f000000000000000000074", "legacy-review-success"),
      id: "64f000000000000000000074",
      reviewStatus: "pending_review" as const
    };
    legacy.contentFingerprint = fingerprintFor(legacy);
    const harness = snapshotHarness(source, [legacy]);

    const mutation = await harness.repository.updateReviewItem(legacy.id, { reviewStatus: "approved" }, {
      expectedContentFingerprint: legacy.contentFingerprint
    });

    expect(mutation).toEqual(expect.objectContaining({
      item: expect.objectContaining({ id: legacy.id, reviewStatus: "approved", snapshotId: harness.sourceState.activeSnapshotId }),
      source: expect.objectContaining({ activeSnapshotId: harness.sourceState.activeSnapshotId })
    }));
    expect(harness.snapshots).toHaveLength(1);
    expect(legacy.reviewStatus).toBe("pending_review");
    await expect(harness.repository.findReviewItemById(legacy.id)).resolves.toEqual(expect.objectContaining({
      item: expect.objectContaining({ reviewStatus: "approved", snapshotId: harness.sourceState.activeSnapshotId })
    }));
  });

  it("rejects a legacy-review activation expired by Mongo server time", async () => {
    const source = snapshotMongoSource();
    const legacy = {
      ...item(source, "64f000000000000000000075", "legacy-review-expiry"),
      id: "64f000000000000000000075",
      reviewStatus: "pending_review" as const
    };
    legacy.contentFingerprint = fingerprintFor(legacy);
    const controls: Parameters<typeof snapshotHarness>[2] = {};
    const harness = snapshotHarness(source, [legacy], controls);
    controls.beforeSourceUpdate = async () => {
      const expiresAt = harness.sourceState.pendingSnapshotExpiresAt;
      if (!(expiresAt instanceof Date)) throw new Error("Expected pending legacy-review expiry.");
      controls.serverNow = new Date(expiresAt.getTime() + 1);
    };

    await expect(harness.repository.updateReviewItem(legacy.id, { reviewStatus: "approved" }, {
      expectedContentFingerprint: legacy.contentFingerprint
    })).rejects.toThrow("ANNOUNCEMENT_REVIEW_SNAPSHOT_CONFLICT");

    expect(harness.sourceState.activeSnapshotId).toBeUndefined();
    expect(Number(harness.sourceState.snapshotStateRevision ?? 0)).toBe(0);
    expect(harness.sourceState.pendingSnapshotId).toBeUndefined();
    expect(harness.snapshots).toEqual([]);
    expect(legacy.reviewStatus).toBe("pending_review");
  });

  it("preserves a legacy-review stage when its activation response is indeterminate", async () => {
    const source = snapshotMongoSource();
    const legacy = {
      ...item(source, "64f000000000000000000077", "legacy-review-delayed"),
      id: "64f000000000000000000077",
      reviewStatus: "pending_review" as const
    };
    legacy.contentFingerprint = fingerprintFor(legacy);
    const harness = snapshotHarness(source, [legacy], {
      delayActivationAfterResponseLoss: true,
      failIntentClear: true
    });

    await expect(harness.repository.updateReviewItem(legacy.id, { reviewStatus: "approved" }, {
      expectedContentFingerprint: legacy.contentFingerprint
    })).rejects.toThrow("SIMULATED_DELAYED_RESPONSE_LOSS");

    const stagedSnapshotId = String(harness.sourceState.pendingSnapshotId);
    expect(harness.snapshots.map((snapshot) => snapshot._id)).toEqual([stagedSnapshotId]);
    await expect(harness.runDelayedActivation()).resolves.toBe(true);
    expect(harness.sourceState.activeSnapshotId).toBe(stagedSnapshotId);
    expect(harness.snapshots[0]?.items).toEqual([
      expect.objectContaining({ id: legacy.id, reviewStatus: "approved" })
    ]);
  });

  it("rejects an active-snapshot review activation expired by Mongo server time", async () => {
    const activeSnapshotId = "64a000000000000000000076";
    const source = {
      ...snapshotMongoSource(),
      activeSnapshotId,
      snapshotStateRevision: 1
    };
    const activeItem = {
      ...item(source, "64f000000000000000000076", "snapshot-review-expiry"),
      id: "64f000000000000000000076",
      snapshotId: activeSnapshotId,
      reviewStatus: "pending_review" as const,
      reviewRevision: "64d000000000000000000076"
    };
    activeItem.contentFingerprint = fingerprintFor(activeItem);
    const controls: Parameters<typeof snapshotHarness>[2] = {};
    const harness = snapshotHarness(source, [], controls);
    harness.snapshots.push({
      _id: activeSnapshotId,
      sourceId: source.id,
      sourceRevision: 1,
      items: [activeItem],
      snapshotHash: "7".repeat(64),
      createdAt: new Date()
    });
    vi.spyOn(harness.repository, "findReviewItemById").mockResolvedValue({ source, item: activeItem });
    controls.beforeSourceUpdate = async () => {
      const expiresAt = harness.sourceState.pendingSnapshotExpiresAt;
      if (!(expiresAt instanceof Date)) throw new Error("Expected pending snapshot-review expiry.");
      controls.serverNow = new Date(expiresAt.getTime() + 1);
    };

    await expect(harness.repository.updateReviewItem(activeItem.id, { reviewStatus: "approved" }, {
      expectedSnapshotId: activeSnapshotId,
      expectedContentFingerprint: activeItem.contentFingerprint,
      expectedReviewRevision: activeItem.reviewRevision
    })).rejects.toThrow("ANNOUNCEMENT_REVIEW_SNAPSHOT_CONFLICT");

    expect(harness.sourceState.activeSnapshotId).toBe(activeSnapshotId);
    expect(harness.sourceState.snapshotStateRevision).toBe(1);
    expect(harness.sourceState.pendingSnapshotId).toBeUndefined();
    expect(harness.snapshots.map((snapshot) => snapshot._id)).toEqual([activeSnapshotId]);
    expect(activeItem.reviewStatus).toBe("pending_review");
  });

  it("preserves an active-review stage when its activation response is indeterminate", async () => {
    const activeSnapshotId = "64a000000000000000000078";
    const source = {
      ...snapshotMongoSource(),
      activeSnapshotId,
      snapshotStateRevision: 1
    };
    const activeItem = {
      ...item(source, "64f000000000000000000078", "snapshot-review-delayed"),
      id: "64f000000000000000000078",
      snapshotId: activeSnapshotId,
      reviewStatus: "pending_review" as const,
      reviewRevision: "64d000000000000000000078"
    };
    activeItem.contentFingerprint = fingerprintFor(activeItem);
    const harness = snapshotHarness(source, [], {
      delayActivationAfterResponseLoss: true,
      failIntentClear: true
    });
    harness.snapshots.push({
      _id: activeSnapshotId,
      sourceId: source.id,
      sourceRevision: 1,
      items: [activeItem],
      snapshotHash: "8".repeat(64),
      createdAt: new Date()
    });
    vi.spyOn(harness.repository, "findReviewItemById").mockResolvedValue({ source, item: activeItem });

    await expect(harness.repository.updateReviewItem(activeItem.id, { reviewStatus: "approved" }, {
      expectedSnapshotId: activeSnapshotId,
      expectedContentFingerprint: activeItem.contentFingerprint,
      expectedReviewRevision: activeItem.reviewRevision
    })).rejects.toThrow("SIMULATED_DELAYED_RESPONSE_LOSS");

    const stagedSnapshotId = String(harness.sourceState.pendingSnapshotId);
    expect(harness.snapshots.map((snapshot) => snapshot._id)).toEqual([activeSnapshotId, stagedSnapshotId]);
    await expect(harness.runDelayedActivation()).resolves.toBe(true);
    expect(harness.sourceState.activeSnapshotId).toBe(stagedSnapshotId);
    expect(harness.snapshots.find((snapshot) => snapshot._id === stagedSnapshotId)?.items).toEqual([
      expect.objectContaining({ id: activeItem.id, reviewStatus: "approved" })
    ]);
  });

  it("stages a complete snapshot, flips only the source pointer, and reads and acknowledges through it", async () => {
    const source = snapshotMongoSource();
    const legacy = { ...item(source, source.id, "same", "Eski özet"), id: "64f000000000000000000099" };
    const harness = snapshotHarness(source, [legacy]);
    const repository = harness.repository;

    const delta = await repository.replaceItemsForSource(source, [
      item(source, "parser-new", "same", "Yeni özet")
    ]);

    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.sourceState.activeSnapshotId).toMatch(/^[a-f\d]{24}$/u);
    expect(harness.snapshots).toHaveLength(1);
    expect(delta.materiallyUpdated).toEqual([
      expect.objectContaining({
        id: legacy.id,
        snapshotId: harness.sourceState.activeSnapshotId
      })
    ]);

    await expect(repository.listItemsForSource(source.id)).resolves.toEqual([
      expect.objectContaining({ id: legacy.id, summary: "Yeni özet" })
    ]);
    await expect(repository.listItemsByScope({ universityId: source.scopeId, limit: 10 }))
      .resolves.toEqual([]);
    await expect(repository.findTrustedItemByIdInScope({
      announcementId: legacy.id,
      universityId: source.scopeId
    })).resolves.toBeNull();

    expect(await repository.acknowledgeNotificationProduction(delta.materiallyUpdated)).toBe(1);
    await expect(repository.listItemsForSource(source.id)).resolves.toEqual([
      expect.objectContaining({
        id: legacy.id,
        notificationProducedFingerprint: delta.materiallyUpdated[0]?.contentFingerprint
      })
    ]);

    const retrySource = {
      ...source,
      activeSnapshotId: String(harness.sourceState.activeSnapshotId),
      snapshotStateRevision: Number(harness.sourceState.snapshotStateRevision)
    };
    const retry = await repository.replaceItemsForSource(retrySource, [
      item(source, "parser-retry", "same", "Yeni özet")
    ]);
    expect(retry.unchanged).toEqual([
      expect.objectContaining({ id: legacy.id, snapshotId: harness.sourceState.activeSnapshotId })
    ]);
    expect(harness.snapshots).toHaveLength(2);
  });

  it("reserves the source before create and lets a same-generation writer take over the intent", async () => {
    const source = snapshotMongoSource();
    const controls: Parameters<typeof snapshotHarness>[2] = {};
    const harness = snapshotHarness(source, [], controls);
    const firstWriterReachedCreate = deferred<void>();
    const releaseFirstWriter = deferred<void>();
    let firstSnapshotId: string | undefined;
    controls.beforeSnapshotCreate = async (value) => {
      if (firstSnapshotId) return;
      firstSnapshotId = String(value._id);
      firstWriterReachedCreate.resolve();
      await releaseFirstWriter.promise;
    };

    const firstWriter = harness.repository.replaceItemsForSource(source, [
      item(source, "writer-one", "intent-takeover", "Writer one")
    ]);
    await firstWriterReachedCreate.promise;

    expect(harness.snapshots).toEqual([]);
    expect(harness.sourceState.pendingSnapshotId).toBe(firstSnapshotId);
    expect(harness.sourceState.pendingSnapshotRevision).toBe(1);
    expect(harness.sourceState.pendingSnapshotExpiresAt).toBeInstanceOf(Date);
    expect(harness.operations.slice(0, 2)).toEqual([
      `reserve:${firstSnapshotId}`,
      `create:${firstSnapshotId}`
    ]);

    const secondWriterReachedActivation = deferred<void>();
    const releaseSecondWriter = deferred<void>();
    let heldSecondWriter = false;
    controls.beforeSourceUpdate = async () => {
      if (heldSecondWriter) return;
      heldSecondWriter = true;
      secondWriterReachedActivation.resolve();
      await releaseSecondWriter.promise;
    };
    const secondWriter = harness.restartRepository().replaceItemsForSource(source, [
      item(source, "writer-two", "intent-takeover", "Writer two")
    ]);
    await secondWriterReachedActivation.promise;
    const winnerSnapshotId = String(harness.sourceState.pendingSnapshotId);
    expect(winnerSnapshotId).not.toBe(firstSnapshotId);

    releaseFirstWriter.resolve();
    await expect(firstWriter).rejects.toThrow("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");
    expect(harness.sourceState.pendingSnapshotId).toBe(winnerSnapshotId);
    expect(harness.sourceState.activeSnapshotId).toBeUndefined();
    expect(Number(harness.sourceState.snapshotStateRevision ?? 0)).toBe(0);

    releaseSecondWriter.resolve();
    const winner = await secondWriter;

    expect(winner.snapshotId).toBe(winnerSnapshotId);
    expect(harness.sourceState.activeSnapshotId).toBe(winnerSnapshotId);
    expect(harness.sourceState.pendingSnapshotId).toBeUndefined();
    expect(harness.sourceState.snapshotStateRevision).toBe(1);
    expect(harness.snapshots.map((snapshot) => snapshot._id)).toEqual([winnerSnapshotId]);
    await expect(harness.repository.listItemsForSource(source.id)).resolves.toEqual([
      expect.objectContaining({ summary: "Writer two" })
    ]);
  });

  it("fences a delayed ambiguous reservation before a newer writer claims the generation", async () => {
    const source = snapshotMongoSource();
    const controls: Parameters<typeof snapshotHarness>[2] = {
      delayReservationAfterResponseLoss: true,
      failIntentClear: true
    };
    const harness = snapshotHarness(source, [], controls);

    await expect(harness.repository.replaceItemsForSource(source, [
      item(source, "writer-one", "delayed-reservation", "Writer one")
    ])).rejects.toThrow("SIMULATED_DELAYED_RESERVATION_RESPONSE_LOSS");
    expect(harness.sourceState.pendingSnapshotId).toBeUndefined();
    expect(Number(harness.sourceState.snapshotIntentRevision ?? 0)).toBe(0);

    controls.delayReservationAfterResponseLoss = false;
    controls.failIntentClear = false;
    const secondWriterReachedActivation = deferred<void>();
    const releaseSecondWriter = deferred<void>();
    controls.beforeSourceUpdate = async () => {
      secondWriterReachedActivation.resolve();
      await releaseSecondWriter.promise;
    };
    const secondWriter = harness.restartRepository().replaceItemsForSource(source, [
      item(source, "writer-two", "delayed-reservation", "Writer two")
    ]);
    await secondWriterReachedActivation.promise;
    const winnerSnapshotId = String(harness.sourceState.pendingSnapshotId);
    expect(harness.sourceState.snapshotIntentRevision).toBe(1);

    await expect(harness.runDelayedReservation()).resolves.toBe(false);
    expect(harness.sourceState.pendingSnapshotId).toBe(winnerSnapshotId);
    expect(harness.sourceState.snapshotIntentRevision).toBe(1);

    releaseSecondWriter.resolve();
    const winner = await secondWriter;
    expect(winner.snapshotId).toBe(winnerSnapshotId);
    expect(harness.sourceState.activeSnapshotId).toBe(winnerSnapshotId);
    expect(harness.sourceState.snapshotIntentRevision).toBe(1);
  });

  it("clears only its exact intent when snapshot creation fails", async () => {
    const source = snapshotMongoSource();
    const controls: Parameters<typeof snapshotHarness>[2] = {
      beforeSnapshotCreate: () => {
        throw new Error("SIMULATED_CREATE_FAILURE");
      }
    };
    const harness = snapshotHarness(source, [], controls);

    await expect(harness.repository.replaceItemsForSource(source, [
      item(source, "writer", "create-failure")
    ])).rejects.toThrow("SIMULATED_CREATE_FAILURE");

    expect(harness.sourceState.pendingSnapshotId).toBeUndefined();
    expect(harness.sourceState.pendingSnapshotRevision).toBeUndefined();
    expect(harness.sourceState.pendingSnapshotExpiresAt).toBeUndefined();
    expect(harness.sourceState.activeSnapshotId).toBeUndefined();
    expect(Number(harness.sourceState.snapshotStateRevision ?? 0)).toBe(0);
    expect(harness.sourceState.snapshotIntentRevision).toBe(2);
    expect(harness.snapshots).toEqual([]);
  });

  it("rejects ingestion when Mongo server time crosses the intent deadline after the CAS filter is built", async () => {
    const source = snapshotMongoSource();
    const controls: Parameters<typeof snapshotHarness>[2] = {};
    const harness = snapshotHarness(source, [], controls);
    let gcScheduledPurge = false;
    controls.beforeSourceUpdate = async () => {
      const expiresAt = harness.sourceState.pendingSnapshotExpiresAt;
      if (!(expiresAt instanceof Date)) throw new Error("Expected pending snapshot expiry.");
      controls.serverNow = new Date(expiresAt.getTime() + 1);
      const stage = harness.snapshots.find((snapshot) => snapshot._id === harness.sourceState.pendingSnapshotId);
      if (!stage) throw new Error("Expected staged snapshot.");
      const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
      stage.createdAt = oldDate;
      stage.activationLeaseUntil = oldDate;
      stage.nextRetentionCheckAt = oldDate;
      await harness.restartRepository().reconcileSnapshotRetention();
      gcScheduledPurge = stage.purgeAfter instanceof Date;
    };

    await expect(harness.repository.replaceItemsForSource(source, [
      item(source, "writer", "expired-intent")
    ])).rejects.toThrow("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");

    expect(harness.sourceState.pendingSnapshotId).toBeUndefined();
    expect(harness.sourceState.activeSnapshotId).toBeUndefined();
    expect(Number(harness.sourceState.snapshotStateRevision ?? 0)).toBe(0);
    expect(harness.snapshots).toEqual([]);
    expect(gcScheduledPurge).toBe(true);
  });

  it("preserves an indeterminate ingestion stage for a delayed activation and GC protects it once active", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, [], {
      delayActivationAfterResponseLoss: true,
      failIntentClear: true
    });

    await expect(harness.repository.replaceItemsForSource(source, [
      item(source, "writer", "delayed-activation")
    ])).rejects.toThrow("SIMULATED_DELAYED_RESPONSE_LOSS");

    const stagedSnapshotId = String(harness.sourceState.pendingSnapshotId);
    expect(harness.snapshots.map((snapshot) => snapshot._id)).toEqual([stagedSnapshotId]);
    expect(harness.snapshotDelete).not.toHaveBeenCalled();
    await expect(harness.runDelayedActivation()).resolves.toBe(true);
    expect(harness.sourceState.activeSnapshotId).toBe(stagedSnapshotId);

    const stage = harness.snapshots[0]!;
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
    stage.createdAt = oldDate;
    stage.activationLeaseUntil = oldDate;
    stage.nextRetentionCheckAt = oldDate;
    await harness.restartRepository().reconcileSnapshotRetention();
    expect(stage.purgeAfter).toBeUndefined();
    expect(stage.nextRetentionCheckAt).toBeInstanceOf(Date);
  });

  it("observes a delayed activation with one source read before deciding whether to retire its stage", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, [], {
      delayActivationAfterResponseLoss: true,
      commitDelayedActivationBeforeVerificationRead: true
    });

    const delta = await harness.repository.replaceItemsForSource(source, [
      item(source, "writer", "activation-between-verification-reads")
    ]);

    expect(harness.sourceState.activeSnapshotId).toBe(delta.snapshotId);
    expect(harness.sourceState.pendingSnapshotId).toBeUndefined();
    expect(harness.snapshots).toHaveLength(1);
    expect(harness.snapshots[0]?.purgeAfter).toBeUndefined();
    expect(harness.snapshotDelete).not.toHaveBeenCalled();
  });

  it("does not create a new snapshot when only fetchedAt changes", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, []);
    const first = item(source, "parser-first", "stable-body");
    await harness.repository.replaceItemsForSource(source, [first]);
    const activeSnapshotId = String(harness.sourceState.activeSnapshotId);
    const activeRevision = Number(harness.sourceState.snapshotStateRevision);
    const activeSnapshot = harness.snapshots.find((snapshot) => snapshot._id === activeSnapshotId)!;
    activeSnapshot.purgeAfter = new Date(Date.now() - 1_000);
    activeSnapshot.activationLeaseUntil = new Date(Date.now() - 1_000);
    activeSnapshot.nextRetentionCheckAt = new Date(Date.now() - 1_000);

    const retry = await harness.repository.replaceItemsForSource(
      snapshotSourceFromState(harness.sourceState),
      [{ ...first, id: "parser-retry", fetchedAt: "2026-09-11T12:00:00.000Z" }]
    );

    expect(retry).toEqual(expect.objectContaining({
      snapshotId: activeSnapshotId,
      materiallyUpdated: [expect.objectContaining({ snapshotId: activeSnapshotId })]
    }));
    expect(harness.snapshotCreate).toHaveBeenCalledTimes(1);
    expect(harness.sourceState.activeSnapshotId).toBe(activeSnapshotId);
    expect(harness.sourceState.snapshotStateRevision).toBe(activeRevision);
    expect(activeSnapshot.purgeAfter).toBeUndefined();
    expect(activeSnapshot.activationLeaseUntil).toBeInstanceOf(Date);
    expect(activeSnapshot.nextRetentionCheckAt).toBeInstanceOf(Date);
  });

  it("heals a purge-scheduled active snapshot before a no-op replacement returns", async () => {
    const activeSnapshotId = "64a000000000000000000070";
    const source = {
      ...snapshotMongoSource(),
      activeSnapshotId,
      snapshotStateRevision: 1
    };
    const harness = snapshotHarness(source, []);
    const expired = new Date(Date.now() - 1_000);
    harness.snapshots.push({
      _id: activeSnapshotId,
      sourceId: source.id,
      sourceRevision: 1,
      items: [],
      snapshotHash: "0".repeat(64),
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000),
      purgeAfter: expired,
      activationLeaseUntil: expired,
      nextRetentionCheckAt: expired
    });

    await expect(harness.repository.replaceItemsForSource(source, [])).resolves.toEqual({
      created: [],
      materiallyUpdated: [],
      unchanged: [],
      removed: []
    });

    expect(harness.snapshots[0]?.purgeAfter).toBeUndefined();
    expect(harness.snapshots[0]?.activationLeaseUntil).toBeInstanceOf(Date);
    expect(harness.snapshots[0]?.nextRetentionCheckAt).toBeInstanceOf(Date);
    expect(harness.sourceState.activeSnapshotId).toBe(activeSnapshotId);
    expect(harness.sourceState.snapshotStateRevision).toBe(1);
  });

  it("migrates a legacy notification acknowledgement through the generation CAS", async () => {
    const source = snapshotMongoSource();
    const legacy = {
      ...item(source, "64f000000000000000000081", "legacy-notification"),
      id: "64f000000000000000000081"
    };
    legacy.contentFingerprint = fingerprintFor(legacy);
    legacy.notificationEligibleFingerprint = legacy.contentFingerprint;
    const harness = snapshotHarness(source, [legacy]);

    expect(await harness.repository.acknowledgeNotificationProduction([{
      id: legacy.id,
      sourceId: source.id,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      canonicalUrl: legacy.link,
      contentFingerprint: legacy.contentFingerprint
    }])).toBe(1);

    expect(harness.sourceState.snapshotStateRevision).toBe(1);
    expect(harness.snapshots).toEqual([
      expect.objectContaining({
        _id: harness.sourceState.activeSnapshotId,
        sourceRevision: 1,
        items: [expect.objectContaining({
          id: legacy.id,
          notificationProducedFingerprint: legacy.contentFingerprint
        })]
      })
    ]);
    expect(legacy.notificationProducedFingerprint).toBeUndefined();
  });

  it("fences a writer that cloned before a notification acknowledgement", async () => {
    const source = snapshotMongoSource();
    const controls: Parameters<typeof snapshotHarness>[2] = {};
    const harness = snapshotHarness(source, [], controls);
    const initial = await harness.repository.replaceItemsForSource(source, [
      item(source, "parser-initial", "ack-race", "Initial body")
    ]);
    const staleSource = snapshotSourceFromState(harness.sourceState);
    const writerReachedCas = deferred<void>();
    const releaseWriter = deferred<void>();
    let heldWriter = false;
    controls.beforeSourceUpdate = async () => {
      if (heldWriter) return;
      heldWriter = true;
      writerReachedCas.resolve();
      await releaseWriter.promise;
    };

    const staleWriter = harness.repository.replaceItemsForSource(staleSource, [
      item(source, "parser-updated", "ack-race", "Writer body")
    ]);
    await writerReachedCas.promise;
    expect(await harness.repository.acknowledgeNotificationProduction(initial.created)).toBe(1);
    releaseWriter.resolve();
    await expect(staleWriter).rejects.toThrow("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");

    const visible = await harness.repository.listItemsForSource(source.id);
    expect(visible).toEqual([expect.objectContaining({
      summary: "Initial body",
      notificationProducedFingerprint: initial.created[0]?.contentFingerprint
    })]);
    expect(harness.sourceState.snapshotStateRevision).toBe(2);
  });

  it("rejects a writer that starts from the generation before an acknowledgement", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, []);
    const initial = await harness.repository.replaceItemsForSource(source, [
      item(source, "parser-initial", "ack-first", "Initial body")
    ]);
    const staleSource = snapshotSourceFromState(harness.sourceState);
    expect(await harness.repository.acknowledgeNotificationProduction(initial.created)).toBe(1);

    await expect(harness.repository.replaceItemsForSource(staleSource, [
      item(source, "parser-updated", "ack-first", "Stale writer body")
    ])).rejects.toThrow("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");
    await expect(harness.repository.listItemsForSource(source.id)).resolves.toEqual([
      expect.objectContaining({
        summary: "Initial body",
        notificationProducedFingerprint: initial.created[0]?.contentFingerprint
      })
    ]);
  });

  it("merges concurrent acknowledgements instead of letting either overwrite the other", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, []);
    const initial = await harness.repository.replaceItemsForSource(source, [
      item(source, "parser-one", "concurrent-one", "First body"),
      item(source, "parser-two", "concurrent-two", "Second body")
    ]);

    await expect(Promise.all(initial.created.map((reference) =>
      harness.repository.acknowledgeNotificationProduction([reference])))).resolves.toEqual([1, 1]);

    const visible = await harness.repository.listItemsForSource(source.id);
    expect(visible).toHaveLength(2);
    for (const reference of initial.created) {
      expect(visible).toContainEqual(expect.objectContaining({
        id: reference.id,
        notificationProducedFingerprint: reference.contentFingerprint
      }));
    }
  });

  it("recovers an acknowledgement whose successful CAS response was lost", async () => {
    const source = snapshotMongoSource();
    const controls: Parameters<typeof snapshotHarness>[2] = {};
    const harness = snapshotHarness(source, [], controls);
    const initial = await harness.repository.replaceItemsForSource(source, [
      item(source, "parser-initial", "uncertain-ack")
    ]);
    controls.throwAfterActivation = true;

    expect(await harness.repository.acknowledgeNotificationProduction(initial.created)).toBe(1);
    await expect(harness.repository.listItemsForSource(source.id)).resolves.toEqual([
      expect.objectContaining({
        notificationProducedFingerprint: initial.created[0]?.contentFingerprint
      })
    ]);
  });

  it("preserves an acknowledgement stage when its activation response is indeterminate", async () => {
    const source = snapshotMongoSource();
    const controls: Parameters<typeof snapshotHarness>[2] = {};
    const harness = snapshotHarness(source, [], controls);
    const initial = await harness.repository.replaceItemsForSource(source, [
      item(source, "parser-initial", "delayed-ack")
    ]);
    controls.delayActivationAfterResponseLoss = true;
    controls.failIntentClear = true;

    await expect(harness.repository.acknowledgeNotificationProduction(initial.created))
      .rejects.toThrow("SIMULATED_DELAYED_RESPONSE_LOSS");

    const stagedSnapshotId = String(harness.sourceState.pendingSnapshotId);
    expect(harness.snapshots.map((snapshot) => snapshot._id)).toContain(stagedSnapshotId);
    expect(harness.snapshotDelete).not.toHaveBeenCalledWith({ _id: stagedSnapshotId });
    await expect(harness.runDelayedActivation()).resolves.toBe(true);
    expect(harness.sourceState.activeSnapshotId).toBe(stagedSnapshotId);
    await expect(harness.repository.listItemsForSource(source.id)).resolves.toEqual([
      expect.objectContaining({
        notificationProducedFingerprint: initial.created[0]?.contentFingerprint
      })
    ]);
  });

  it("does not acknowledge success when TTL removes the ACK snapshot after its source CAS", async () => {
    const source = snapshotMongoSource();
    const controls: Parameters<typeof snapshotHarness>[2] = {};
    const harness = snapshotHarness(source, [], controls);
    const initial = await harness.repository.replaceItemsForSource(source, [
      item(source, "parser-initial", "missing-ack-snapshot")
    ]);
    controls.afterSnapshotPointerSwap = (_sourceState, snapshots, snapshotId) => {
      const index = snapshots.findIndex((snapshot) => snapshot._id === snapshotId);
      if (index >= 0) snapshots.splice(index, 1);
    };

    await expect(harness.repository.acknowledgeNotificationProduction(initial.created))
      .rejects.toThrow("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_FINALIZATION_FAILED");

    expect(harness.sourceState.activeSnapshotId).toBeUndefined();
    expect(harness.sourceState.snapshotStateRevision).toBe(3);
  });

  it("rejects every ACK activation whose intent expires at Mongo evaluation time", async () => {
    const source = snapshotMongoSource();
    const controls: Parameters<typeof snapshotHarness>[2] = {};
    const harness = snapshotHarness(source, [], controls);
    const initial = await harness.repository.replaceItemsForSource(source, [
      item(source, "parser-initial", "expired-ack-intent")
    ]);
    const activeSnapshotId = String(harness.sourceState.activeSnapshotId);
    controls.beforeSourceUpdate = async () => {
      const expiresAt = harness.sourceState.pendingSnapshotExpiresAt;
      if (!(expiresAt instanceof Date)) throw new Error("Expected pending ACK expiry.");
      controls.serverNow = new Date(expiresAt.getTime() + 1);
    };

    await expect(harness.repository.acknowledgeNotificationProduction(initial.created)).resolves.toBe(0);

    expect(harness.sourceState.activeSnapshotId).toBe(activeSnapshotId);
    expect(harness.sourceState.snapshotStateRevision).toBe(1);
    expect(harness.sourceState.pendingSnapshotId).toBeUndefined();
    expect(harness.snapshots.map((snapshot) => snapshot._id)).toEqual([activeSnapshotId]);
  });

  it("grace-retires a predecessor only after the replacement pointer commits", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, []);
    await harness.repository.replaceItemsForSource(source, [
      item(source, "parser-initial", "retention", "Initial body")
    ]);
    const predecessorId = String(harness.sourceState.activeSnapshotId);
    const predecessor = harness.snapshots.find((snapshot) => snapshot._id === predecessorId)!;
    expect(predecessor.purgeAfter).toBeUndefined();

    await harness.repository.replaceItemsForSource(snapshotSourceFromState(harness.sourceState), [
      item(source, "parser-next", "retention", "Changed body")
    ]);

    const activeSnapshotId = String(harness.sourceState.activeSnapshotId);
    expect(predecessor.purgeAfter).toBeInstanceOf(Date);
    expect(predecessor.nextRetentionCheckAt).toEqual(predecessor.purgeAfter);
    expect(harness.snapshots.find((snapshot) => snapshot._id === activeSnapshotId)?.purgeAfter).toBeUndefined();
    // The active lease closes the interval between retention candidate
    // selection and its fenced updateMany. It expires naturally and the
    // source pointer/revision join protects the active snapshot thereafter.
    expect(harness.snapshots.find((snapshot) => snapshot._id === activeSnapshotId)?.activationLeaseUntil).toBeInstanceOf(Date);
    expect(harness.snapshots.find((snapshot) => snapshot._id === activeSnapshotId)?.nextRetentionCheckAt)
      .toBeInstanceOf(Date);
  });

  it("atomically revives a grace-retired stage before activation and leaves the active snapshot unexpired", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, [], { retireStageOnCreate: true });

    await harness.repository.replaceItemsForSource(source, [
      item(source, "parser-initial", "revived-stage")
    ]);

    const active = harness.snapshots.find((snapshot) => snapshot._id === harness.sourceState.activeSnapshotId);
    expect(active).toBeDefined();
    expect(active?.purgeAfter).toBeUndefined();
    expect(active?.activationLeaseUntil).toBeInstanceOf(Date);
    expect(active?.nextRetentionCheckAt).toBeInstanceOf(Date);
  });

  it("does not retire the active predecessor when replacement activation loses", async () => {
    const source = {
      ...snapshotMongoSource(),
      activeSnapshotId: "64a000000000000000000080",
      snapshotStateRevision: 1
    };
    const activeItem = {
      ...item(source, "64f000000000000000000080", "retention-cas-loss", "Initial body"),
      id: "64f000000000000000000080",
      snapshotId: source.activeSnapshotId
    };
    activeItem.contentFingerprint = fingerprintFor(activeItem);
    const harness = snapshotHarness(source, [], { rejectActivation: true });
    harness.snapshots.push({
      _id: source.activeSnapshotId,
      sourceId: source.id,
      sourceRevision: 1,
      snapshotHash: "a".repeat(64),
      items: [activeItem],
      createdAt: new Date()
    });

    await expect(harness.repository.replaceItemsForSource(source, [
      item(source, "parser-next", "retention-cas-loss", "Changed body")
    ])).rejects.toThrow("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");

    expect(harness.snapshots).toHaveLength(1);
    expect(harness.snapshots[0]?.purgeAfter).toBeUndefined();
    expect(harness.sourceState.activeSnapshotId).toBe(source.activeSnapshotId);
  });

  it("reconciles only unreachable old generations and aged abandoned stages", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, []);
    await harness.repository.replaceItemsForSource(source, [
      item(source, "parser-initial", "retention-reconcile")
    ]);
    const activeSnapshotId = String(harness.sourceState.activeSnapshotId);
    const currentRevision = Number(harness.sourceState.snapshotStateRevision);
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
    const freshDate = new Date();
    harness.snapshots.find((snapshot) => snapshot._id === activeSnapshotId)!.createdAt = oldDate;
    harness.snapshots.push(
      {
        _id: "64a000000000000000000081",
        sourceId: source.id,
        sourceRevision: Math.max(0, currentRevision - 1),
        snapshotHash: "a".repeat(64),
        items: [],
        createdAt: freshDate
      },
      {
        _id: "64a000000000000000000082",
        sourceId: source.id,
        sourceRevision: currentRevision,
        snapshotHash: "b".repeat(64),
        items: [],
        createdAt: oldDate
      },
      {
        _id: "64a000000000000000000083",
        sourceId: source.id,
        sourceRevision: currentRevision,
        snapshotHash: "c".repeat(64),
        items: [],
        createdAt: freshDate
      },
      {
        _id: "64a000000000000000000084",
        sourceId: source.id,
        sourceRevision: currentRevision + 1,
        snapshotHash: "d".repeat(64),
        items: [],
        createdAt: oldDate
      },
      {
        _id: "64a000000000000000000085",
        sourceId: source.id,
        sourceRevision: currentRevision + 1,
        snapshotHash: "e".repeat(64),
        items: [],
        createdAt: freshDate
      },
      {
        _id: "64a000000000000000000086",
        sourceId: source.id,
        sourceRevision: currentRevision + 1,
        snapshotHash: "f".repeat(64),
        items: [],
        createdAt: oldDate,
        activationLeaseUntil: new Date(Date.now() + 60 * 60 * 1_000)
      },
      {
        _id: "64a000000000000000000087",
        sourceId: "deleted-source",
        sourceRevision: 99,
        snapshotHash: "0".repeat(64),
        items: [],
        createdAt: oldDate
      }
    );

    await harness.repository.reconcileSnapshotRetention();

    expect(harness.snapshots.find((snapshot) => snapshot._id === "64a000000000000000000081")?.purgeAfter).toBeUndefined();
    expect(harness.snapshots.find((snapshot) => snapshot._id === "64a000000000000000000082")?.purgeAfter).toBeInstanceOf(Date);
    expect(harness.snapshots.find((snapshot) => snapshot._id === "64a000000000000000000083")?.purgeAfter).toBeUndefined();
    expect(harness.snapshots.find((snapshot) => snapshot._id === "64a000000000000000000084")?.purgeAfter).toBeInstanceOf(Date);
    expect(harness.snapshots.find((snapshot) => snapshot._id === "64a000000000000000000085")?.purgeAfter).toBeUndefined();
    expect(harness.snapshots.find((snapshot) => snapshot._id === "64a000000000000000000086")?.purgeAfter).toBeUndefined();
    expect(harness.snapshots.find((snapshot) => snapshot._id === "64a000000000000000000087")?.purgeAfter).toBeInstanceOf(Date);
    expect(harness.snapshots.find((snapshot) => snapshot._id === activeSnapshotId)?.purgeAfter).toBeUndefined();
  });

  it("does not purge a stage claimed after retention lookup but before its fenced update", async () => {
    const source = snapshotMongoSource();
    const stageId = "64a000000000000000000088";
    const controls: Parameters<typeof snapshotHarness>[2] = {};
    const harness = snapshotHarness(source, [], controls);
    const stage = {
      _id: stageId,
      sourceId: source.id,
      sourceRevision: 1,
      snapshotHash: "8".repeat(64),
      items: [],
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000)
    };
    harness.snapshots.push(stage);
    controls.beforeSnapshotUpdateMany = () => {
      const until = new Date(Date.now() + 24 * 60 * 60 * 1_000);
      Object.assign(stage, {
        activationLeaseUntil: until,
        nextRetentionCheckAt: until
      });
      harness.sourceState.activeSnapshotId = stageId;
      harness.sourceState.snapshotStateRevision = 1;
    };

    await harness.repository.reconcileSnapshotRetention();

    expect(stage).not.toHaveProperty("purgeAfter");
    expect(harness.snapshots.find((snapshot) => snapshot._id === stageId)?.activationLeaseUntil)
      .toBeInstanceOf(Date);
    expect(harness.snapshotUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("protects an unexpired pending intent and reclaims its abandoned stage after expiry", async () => {
    const source = snapshotMongoSource();
    const stageId = "64a000000000000000000089";
    const controls: Parameters<typeof snapshotHarness>[2] = {};
    const harness = snapshotHarness(source, [], controls);
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
    const pendingExpiresAt = new Date(Date.now() + 60 * 60 * 1_000);
    harness.sourceState.pendingSnapshotId = stageId;
    harness.sourceState.pendingSnapshotRevision = 1;
    harness.sourceState.pendingSnapshotExpiresAt = pendingExpiresAt;
    controls.serverNow = new Date(pendingExpiresAt.getTime() - 1);
    harness.snapshots.push({
      _id: stageId,
      sourceId: source.id,
      sourceRevision: 1,
      snapshotHash: "9".repeat(64),
      items: [],
      createdAt: oldDate,
      activationLeaseUntil: oldDate,
      nextRetentionCheckAt: oldDate
    });

    await harness.repository.reconcileSnapshotRetention();

    const stage = harness.snapshots[0]!;
    expect(stage.purgeAfter).toBeUndefined();
    expect(stage.nextRetentionCheckAt).toBeInstanceOf(Date);

    controls.serverNow = new Date(pendingExpiresAt.getTime() + 1);
    stage.activationLeaseUntil = oldDate;
    stage.nextRetentionCheckAt = oldDate;
    await harness.restartRepository().reconcileSnapshotRetention();

    expect(stage.purgeAfter).toBeInstanceOf(Date);
    const lookupJson = JSON.stringify(harness.snapshotAggregate.mock.calls[0]?.[0]);
    expect(lookupJson).toContain('["$pendingSnapshotExpiresAt","$$NOW"]');
    expect(lookupJson).not.toContain("retentionDueAt");
  });

  it("keeps an active snapshot safe after a process dies immediately after pointer CAS", async () => {
    const activeSnapshotId = "64a000000000000000000090";
    const source = {
      ...snapshotMongoSource(),
      activeSnapshotId,
      snapshotStateRevision: 4
    };
    const harness = snapshotHarness(source, []);
    const expired = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
    harness.snapshots.push({
      _id: activeSnapshotId,
      sourceId: source.id,
      sourceRevision: 4,
      snapshotHash: "a".repeat(64),
      items: [],
      createdAt: expired,
      activationLeaseUntil: expired,
      nextRetentionCheckAt: expired
    });

    await harness.repository.reconcileSnapshotRetention();

    expect(harness.snapshots[0]?.purgeAfter).toBeUndefined();
    expect(harness.snapshots[0]?.nextRetentionCheckAt).toBeInstanceOf(Date);
    expect(harness.sourceState.activeSnapshotId).toBe(activeSnapshotId);
    expect(harness.sourceState.snapshotStateRevision).toBe(4);
  });

  it("bounds source lookups and update targets to one stale-snapshot batch", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, []);
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
    for (let index = 0; index < 550; index += 1) {
      harness.snapshots.push({
        _id: `64a${index.toString(16).padStart(21, "0")}`,
        sourceId: source.id,
        sourceRevision: index + 1,
        snapshotHash: index.toString(16).padStart(64, "0"),
        items: [],
        createdAt: oldDate
      });
    }

    await harness.repository.reconcileSnapshotRetention();

    expect(harness.snapshots.filter((snapshot) => snapshot.purgeAfter instanceof Date)).toHaveLength(500);
    expect(harness.snapshotUpdateMany).toHaveBeenCalledTimes(1);
    expect((harness.snapshotUpdateMany.mock.calls[0]?.[0] as {
      _id?: { $in?: string[] };
    })._id?.$in).toHaveLength(500);
    expect(harness.sourceFind).not.toHaveBeenCalled();
    expect(harness.snapshotAggregate).toHaveBeenCalledTimes(1);
    const pipeline = harness.snapshotAggregate.mock.calls[0]?.[0] ?? [];
    expect(pipeline).toEqual(expect.arrayContaining([
      { $limit: 500 },
      expect.objectContaining({ $lookup: expect.objectContaining({ from: "announcement_sources" }) })
    ]));
    expect(pipeline.findIndex((stage) => "$limit" in stage))
      .toBeLessThan(pipeline.findIndex((stage) => "$lookup" in stage));
    expect(pipeline.findIndex((stage) => "$sort" in stage))
      .toBeLessThan(pipeline.findIndex((stage) => "$lookup" in stage));
    expect(pipeline.find((stage) => "$sort" in stage)).toEqual({
      $sort: { nextRetentionCheckAt: 1, createdAt: 1 }
    });
    const lookupStage = pipeline.find((stage) => "$lookup" in stage);
    const lookupJson = JSON.stringify(lookupStage);
    expect(lookupJson).toContain('"$convert":{"input":"$sourceId","to":"objectId"');
    expect(lookupJson).toContain('{"$eq":["$_id","$$sourceObjectId"]}');
    expect(lookupJson).toContain('"$pendingSnapshotId"');
    expect(lookupJson).toContain('"$pendingSnapshotRevision"');
    expect(lookupJson).toContain('"$pendingSnapshotExpiresAt"');
    expect(lookupJson).not.toContain('{"$eq":[{"$toString":"$_id"},"$$sourceId"]}');
    await harness.repository.reconcileSnapshotRetention();
    expect(harness.snapshotAggregate).toHaveBeenCalledTimes(1);
  });

  it("persists active checks so a full active prefix cannot starve an orphan after restart", async () => {
    const source = snapshotMongoSource();
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
    const activeIds = new Set(Array.from({ length: 500 }, (_, index) =>
      `64a${index.toString(16).padStart(21, "0")}`));
    const orphanId = "64b000000000000000000001";
    const harness = snapshotHarness(source, [], { retentionActiveSnapshotIds: activeIds });
    for (const [index, snapshotId] of [...activeIds, orphanId].entries()) {
      harness.snapshots.push({
        _id: snapshotId,
        sourceId: source.id,
        sourceRevision: index + 1,
        snapshotHash: index.toString(16).padStart(64, "0"),
        items: [],
        createdAt: oldDate
      });
    }

    await harness.repository.reconcileSnapshotRetention();

    expect(harness.snapshots.find((snapshot) => snapshot._id === orphanId)?.purgeAfter).toBeUndefined();
    expect(harness.snapshots
      .filter((snapshot) => activeIds.has(snapshot._id))
      .every((snapshot) => snapshot.nextRetentionCheckAt instanceof Date)).toBe(true);
    const firstPipeline = harness.snapshotAggregate.mock.calls[0]?.[0] ?? [];
    expect(firstPipeline.findIndex((stage) => "$limit" in stage))
      .toBeLessThan(firstPipeline.findIndex((stage) => "$lookup" in stage));
    expect((harness.snapshotUpdateMany.mock.calls[0]?.[0] as {
      _id?: { $in?: string[] };
    })._id?.$in).toHaveLength(500);
    expect(harness.snapshotUpdateMany).toHaveBeenCalledTimes(1);

    await harness.restartRepository().reconcileSnapshotRetention();

    expect(harness.snapshots.find((snapshot) => snapshot._id === orphanId)?.purgeAfter)
      .toBeInstanceOf(Date);
    expect(harness.snapshotAggregate).toHaveBeenCalledTimes(2);
    expect((harness.snapshotUpdateMany.mock.calls[1]?.[0] as {
      _id?: { $in?: string[] };
    })._id?.$in).toEqual([orphanId]);
  });

  it("does not expose or migrate legacy rows after a snapshot-state invalidation", async () => {
    const source = { ...snapshotMongoSource(), snapshotStateRevision: 1 };
    const legacy = {
      ...item(source, "64f000000000000000000085", "invalidated-legacy"),
      id: "64f000000000000000000085"
    };
    legacy.contentFingerprint = fingerprintFor(legacy);
    legacy.notificationEligibleFingerprint = legacy.contentFingerprint;
    const harness = snapshotHarness(source, [legacy]);

    await expect(harness.repository.listItemsForSource(source.id)).resolves.toEqual([]);
    expect(await harness.repository.acknowledgeNotificationProduction([{
      id: legacy.id,
      sourceId: source.id,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      canonicalUrl: legacy.link,
      contentFingerprint: legacy.contentFingerprint
    }])).toBe(0);
    expect(harness.snapshots).toEqual([]);
  });

  it("does not carry legacy review state into ingestion after an invalidation", async () => {
    const source = { ...snapshotMongoSource(), snapshotStateRevision: 1 };
    const legacy = {
      ...item(source, "64f000000000000000000086", "invalidated-ingestion"),
      reviewStatus: "approved" as const,
      notificationProducedFingerprint: "legacy-produced"
    };
    const harness = snapshotHarness(source, [legacy]);
    const {
      notificationProducedFingerprint: _legacyProduced,
      ...incoming
    } = legacy;
    void _legacyProduced;

    await harness.repository.replaceItemsForSource(source, [{
      ...incoming,
      id: "parser-item",
      reviewStatus: "pending_review"
    }]);

    const activated = harness.snapshots.find((snapshot) =>
      snapshot._id === harness.sourceState.activeSnapshotId);
    const [persisted] = (activated?.items ?? []) as AnnouncementItem[];
    expect(persisted?.id).not.toBe(legacy.id);
    expect(persisted?.reviewStatus).toBe("pending_review");
    expect(persisted?.notificationProducedFingerprint).toBeUndefined();
    expect(harness.sourceState.snapshotStateRevision).toBe(2);
  });

  it("keeps the legacy trusted snapshot visible and does not replay stale items when CAS activation loses", async () => {
    const source = snapshotMongoSource();
    const legacy = { ...item(source, source.id, "legacy"), id: "64f000000000000000000098" };
    const harness = snapshotHarness(source, [legacy], { rejectActivation: true });

    await expect(harness.repository.replaceItemsForSource(source, [item(source, "new", "replacement")]))
      .rejects.toThrow("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");

    expect(harness.sourceState.activeSnapshotId).toBeUndefined();
    expect(harness.snapshots).toEqual([]);
    expect(harness.snapshotCreate).toHaveBeenCalledTimes(1);
    expect(harness.snapshotDelete).toHaveBeenCalledTimes(1);
    await expect(harness.repository.listItemsForSource(source.id)).resolves.toEqual([
      expect.objectContaining({ id: legacy.id, link: legacy.link })
    ]);
  });

  it("does not delete a snapshot when CAS succeeded but its response was lost", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, [], { throwAfterActivation: true });

    const delta = await harness.repository.replaceItemsForSource(source, [item(source, "new", "created")]);

    expect(delta.created).toHaveLength(1);
    expect(harness.sourceState.activeSnapshotId).toBe(delta.created[0]?.snapshotId);
    expect(harness.snapshots).toHaveLength(1);
    expect(harness.snapshotDelete).not.toHaveBeenCalled();
  });

  it("atomically clears an expired purge marker during mandatory post-CAS finalization", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, [], {
      afterSnapshotPointerSwap: (_sourceState, snapshots, snapshotId) => {
        const staged = snapshots.find((snapshot) => snapshot._id === snapshotId)!;
        staged.purgeAfter = new Date(Date.now() - 1_000);
        staged.activationLeaseUntil = new Date(Date.now() - 1_000);
        staged.nextRetentionCheckAt = new Date(Date.now() - 1_000);
      }
    });

    const delta = await harness.repository.replaceItemsForSource(source, [item(source, "new", "expired-finalize")]);

    const active = harness.snapshots.find((snapshot) => snapshot._id === delta.snapshotId);
    expect(active?.purgeAfter).toBeUndefined();
    expect(active?.activationLeaseUntil).toBeInstanceOf(Date);
    expect(active?.nextRetentionCheckAt).toBeInstanceOf(Date);
    expect(harness.sourceState.activeSnapshotId).toBe(delta.snapshotId);
    expect(harness.sourceState.snapshotStateRevision).toBe(1);
  });

  it("invalidates the exact active pointer when TTL wins after source CAS", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, [], {
      afterSnapshotPointerSwap: (_sourceState, snapshots, snapshotId) => {
        const index = snapshots.findIndex((snapshot) => snapshot._id === snapshotId);
        if (index >= 0) snapshots.splice(index, 1);
      }
    });

    await expect(harness.repository.replaceItemsForSource(source, [item(source, "new", "ttl-won")]))
      .rejects.toThrow("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_FINALIZATION_FAILED");

    expect(harness.sourceState.activeSnapshotId).toBeUndefined();
    expect(harness.sourceState.snapshotStateRevision).toBe(2);
    expect(harness.sourceState.snapshotIntentRevision).toBe(2);
    expect(harness.snapshots).toEqual([]);
  });

  it("does not let failed-activation compensation clear a newer reserved intent", async () => {
    const source = snapshotMongoSource();
    const firstFinalizerReached = deferred<void>();
    const releaseFirstFinalizer = deferred<void>();
    const secondActivationReached = deferred<void>();
    const releaseSecondActivation = deferred<void>();
    let activationAttempts = 0;
    let heldFirstFinalizer = false;
    const controls: Parameters<typeof snapshotHarness>[2] = {
      beforeSourceUpdate: async () => {
        activationAttempts += 1;
        if (activationAttempts !== 2) return;
        secondActivationReached.resolve();
        await releaseSecondActivation.promise;
      },
      beforeSnapshotFinalization: async () => {
        if (heldFirstFinalizer) return;
        heldFirstFinalizer = true;
        firstFinalizerReached.resolve();
        await releaseFirstFinalizer.promise;
      }
    };
    const harness = snapshotHarness(source, [], controls);

    const firstWriter = harness.repository.replaceItemsForSource(source, [
      item(source, "writer-one", "compensation-epoch", "Writer one")
    ]);
    await firstFinalizerReached.promise;
    const firstSnapshotId = String(harness.sourceState.activeSnapshotId);
    const secondWriter = harness.restartRepository().replaceItemsForSource(
      snapshotSourceFromState(harness.sourceState),
      [item(source, "writer-two", "compensation-epoch", "Writer two")]
    );
    await secondActivationReached.promise;
    const secondSnapshotId = String(harness.sourceState.pendingSnapshotId);
    const firstSnapshotIndex = harness.snapshots.findIndex((snapshot) => snapshot._id === firstSnapshotId);
    expect(firstSnapshotIndex).toBeGreaterThanOrEqual(0);
    harness.snapshots.splice(firstSnapshotIndex, 1);

    releaseFirstFinalizer.resolve();
    await expect(firstWriter).rejects.toThrow("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_FINALIZATION_FAILED");
    const stateAfterCompensation = { ...harness.sourceState };
    releaseSecondActivation.resolve();

    expect(stateAfterCompensation).toEqual(expect.objectContaining({
      activeSnapshotId: firstSnapshotId,
      snapshotStateRevision: 1,
      pendingSnapshotId: secondSnapshotId,
      pendingSnapshotRevision: 2,
      snapshotIntentRevision: 2
    }));
    await expect(secondWriter).resolves.toEqual(expect.objectContaining({ snapshotId: secondSnapshotId }));
    expect(harness.sourceState.activeSnapshotId).toBe(secondSnapshotId);
    expect(harness.sourceState.pendingSnapshotId).toBeUndefined();
    expect(harness.sourceState.snapshotStateRevision).toBe(2);
  });

  it("does not let failed-activation compensation overwrite a newer pointer", async () => {
    const source = snapshotMongoSource();
    const newerSnapshotId = "64b000000000000000000099";
    const harness = snapshotHarness(source, [], {
      afterSnapshotPointerSwap: (sourceState, snapshots, snapshotId) => {
        const index = snapshots.findIndex((snapshot) => snapshot._id === snapshotId);
        if (index >= 0) snapshots.splice(index, 1);
        sourceState.activeSnapshotId = newerSnapshotId;
        sourceState.snapshotStateRevision = Number(sourceState.snapshotStateRevision) + 1;
      }
    });

    await expect(harness.repository.replaceItemsForSource(source, [item(source, "new", "newer-won")]))
      .rejects.toThrow("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_FINALIZATION_FAILED");

    expect(harness.sourceState.activeSnapshotId).toBe(newerSnapshotId);
    expect(harness.sourceState.snapshotStateRevision).toBe(2);
  });

  it("does not refresh retention for an activation already superseded by a newer pointer", async () => {
    const source = snapshotMongoSource();
    const newerSnapshotId = "64b000000000000000000098";
    const harness = snapshotHarness(source, [], {
      afterSnapshotPointerSwap: (sourceState) => {
        sourceState.activeSnapshotId = newerSnapshotId;
        sourceState.snapshotStateRevision = Number(sourceState.snapshotStateRevision) + 1;
      }
    });

    const delta = await harness.repository.replaceItemsForSource(source, [item(source, "new", "stale-cleanup")]);

    const superseded = harness.snapshots.find((snapshot) => snapshot._id === delta.snapshotId);
    expect(harness.sourceState.activeSnapshotId).toBe(newerSnapshotId);
    expect(harness.sourceState.snapshotStateRevision).toBe(2);
    expect(superseded?.purgeAfter).toBeInstanceOf(Date);
    expect(superseded?.activationLeaseUntil).toBeUndefined();
  });

  it("retains an indeterminate snapshot when its lost CAS response is followed by a newer pointer", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, [], {
      throwAfterActivation: true,
      advancePointerAfterLostResponse: true
    });

    await expect(harness.repository.replaceItemsForSource(source, [item(source, "new", "created")]))
      .rejects.toThrow("SIMULATED_RESPONSE_LOSS");

    expect(harness.sourceState.activeSnapshotId).toBe("64b000000000000000000099");
    expect(harness.snapshots).toHaveLength(1);
    expect(harness.snapshotDelete).not.toHaveBeenCalled();
  });

  it("fences snapshot activation when the source definition changes after fetch", async () => {
    const source = snapshotMongoSource();
    const harness = snapshotHarness(source, [], { editDefinitionBeforeActivation: true });

    await expect(harness.repository.replaceItemsForSource(source, [item(source, "old-source", "created")]))
      .rejects.toThrow("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");

    expect(harness.sourceState).toEqual(expect.objectContaining({
      parser: "rss",
      sourceDefinitionVersion: "64c000000000000000000099"
    }));
    expect(harness.sourceState.activeSnapshotId).toBeUndefined();
    expect(harness.snapshotCreate).toHaveBeenCalledTimes(1);
    expect(harness.snapshotDelete).toHaveBeenCalledTimes(1);
    await expect(harness.repository.recordSourceCheck(source.id, {
      healthStatus: "healthy",
      lastCheckedAt: new Date("2026-09-02T10:00:00.000Z"),
      consecutiveFailures: 0,
      itemCount: 1,
      etag: "stale-etag",
      processingVersion: "stale-processing-version"
    }, source)).resolves.toBeNull();
    expect(harness.sourceState.etag).toBeUndefined();
    expect(harness.sourceState.processingVersion).toBeUndefined();
    await expect(harness.repository.quarantineSource(
      source.id,
      ["unofficial_source"],
      source
    )).resolves.toBeNull();
    expect(harness.sourceState).toEqual(expect.objectContaining({ status: "active", trustStatus: "trusted" }));
  });

  it("rejects a stale writer before planning against a newer active snapshot", async () => {
    const staleSource = snapshotMongoSource();
    const currentSnapshotId = "64a000000000000000000077";
    const currentSource = { ...staleSource, activeSnapshotId: currentSnapshotId };
    const current = {
      ...item(currentSource, "current", "current", "Current snapshot"),
      id: "64f000000000000000000077",
      snapshotId: currentSnapshotId
    };
    const harness = snapshotHarness(currentSource, []);
    harness.snapshots.push({
      _id: currentSnapshotId,
      sourceId: currentSource.id,
      items: [current],
      snapshotHash: "current-hash"
    });

    await expect(harness.repository.replaceItemsForSource(staleSource, [
      item(staleSource, "stale", "stale", "Stale fetched snapshot")
    ])).rejects.toThrow("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");

    expect(harness.sourceState.activeSnapshotId).toBe(currentSnapshotId);
    expect(harness.snapshotCreate).not.toHaveBeenCalled();
    expect(harness.snapshotDelete).not.toHaveBeenCalled();
    await expect(harness.repository.recordSourceCheck(staleSource.id, {
      healthStatus: "degraded",
      lastCheckedAt: new Date("2026-09-02T10:00:00.000Z"),
      lastError: "stale writer",
      consecutiveFailures: 1,
      itemCount: 0
    }, staleSource, null)).resolves.toBeNull();
    expect(harness.sourceState.healthStatus).not.toBe("degraded");
    expect(harness.sourceState.lastError).toBeUndefined();
  });

  it("fails closed instead of exposing legacy rows behind a missing active snapshot", async () => {
    const source = snapshotMongoSource();
    const legacy = { ...item(source, source.id, "legacy"), id: "64f000000000000000000097" };
    const harness = snapshotHarness(source, [legacy]);
    harness.sourceState.activeSnapshotId = "64a000000000000000000099";

    const currentSource = {
      ...source,
      activeSnapshotId: String(harness.sourceState.activeSnapshotId)
    };

    await expect(harness.repository.listItemsForSource(source.id)).resolves.toEqual([]);
    await expect(harness.repository.replaceItemsForSource(currentSource, [item(source, "new", "replacement")]))
      .rejects.toThrow("ANNOUNCEMENT_ACTIVE_SNAPSHOT_MISSING");
  });
});

function sourceInput() {
  return {
    scopeType: "university" as const,
    scopeId: "university-1",
    sourceName: "Örnek Üniversitesi",
    sourceUrl: "https://www.example.edu.tr/duyurular",
    homepageUrl: "https://www.example.edu.tr/",
    contentType: "announcement" as const,
    parser: "auto" as const,
    priority: 20,
    status: "active" as const,
    trustStatus: "trusted" as const
  };
}

function sourceInputWithoutTrust() {
  const { trustStatus: _trustStatus, ...input } = sourceInput();
  void _trustStatus;
  return input;
}

function sourceCandidateInput(sourceUrl = "https://www.example.edu.tr/duyurular") {
  const { status: _status, ...input } = sourceInputWithoutTrust();
  void _status;
  return { ...input, sourceUrl, homepageUrl: new URL(sourceUrl).origin };
}

function sourceVerificationEvidence(): AnnouncementSourceVerificationEvidence {
  return {
    status: "verified",
    schemaVersion: 4,
    verifierVersion: "authority-pinned-browser-and-raw-v9",
    runId: "run-1",
    manifestHash: "a".repeat(64),
    universityId: "university-1",
    unitType: "university",
    scopeId: "university-1",
    sourceType: "announcement",
    sourceUrl: "https://www.example.edu.tr/duyurular",
    finalUrl: "https://www.example.edu.tr/duyurular",
    browserFinalUrl: "https://www.example.edu.tr/duyurular",
    rawFinalUrl: "https://www.example.edu.tr/duyurular",
    discoveryMethod: "navigation",
    publicationScope: "university_system",
    httpStatus: 200,
    contentType: "text/html",
    officialDomain: true,
    semanticMatch: true,
    semanticReasons: ["semantic_match"],
    parserProfile: "auto",
    parserCompatible: true,
    parserItemCount: 2,
    listingItemCount: 2,
    sampleItemUrls: ["https://www.example.edu.tr/duyuru/1"],
    sampleDetails: [],
    browserNetworkProofs: [{ hostname: "www.example.edu.tr", addresses: ["93.184.216.34"] }],
    verifiedAt: "2026-09-10T00:00:00.000Z",
    finalRevalidatedAt: "2026-09-10T01:00:00.000Z",
    sha256: "b".repeat(64),
    evidencePath: `evidence/html/${"b".repeat(64)}.html.gz`,
    parserInputSha256: "c".repeat(64),
    parserEvidencePath: `evidence/html/${"c".repeat(64)}.html.gz`
  };
}

function sourceReviewFenceFor(source: AnnouncementSourceRecord) {
  return {
    ...(source.sourceDefinitionVersion ? { expectedSourceDefinitionVersion: source.sourceDefinitionVersion } : {}),
    expectedCanonicalUrl: source.canonicalUrl ?? source.sourceUrl,
    expectedTrustStatus: source.trustStatus ?? "quarantined" as const,
    expectedSourceStatus: source.status,
    expectedApprovalPending: source.approvalPending === true
  };
}

function sourceEditFenceFor(source: AnnouncementSourceRecord) {
  return {
    ...sourceReviewFenceFor(source),
    expectedUpdatedAt: source.updatedAt
  };
}

function mongoSource(): AnnouncementSourceRecord {
  const now = new Date("2026-08-04T08:00:00.000Z");
  return {
    ...sourceInput(),
    id: "source-1",
    canonicalUrl: "https://www.example.edu.tr/duyurular",
    trustStatus: "trusted",
    createdAt: now,
    updatedAt: now
  };
}

function snapshotMongoSource(): AnnouncementSourceRecord {
  return {
    ...mongoSource(),
    id: "64e000000000000000000001",
    sourceDefinitionVersion: "64c000000000000000000001"
  };
}

function snapshotSourceFromState(
  state: Record<string, unknown> & { _id: string }
): AnnouncementSourceRecord {
  const { _id, ...source } = structuredClone(state);
  return { ...source, id: _id } as unknown as AnnouncementSourceRecord;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function item(
  source: AnnouncementSourceRecord,
  id: string,
  slug: string,
  summary = "Aynı özet"
): AnnouncementItem {
  return {
    id,
    sourceId: source.id,
    sourceName: source.sourceName,
    contentType: "announcement",
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    title: "Kayıt başvurusu duyurusu",
    summary,
    link: `https://www.example.edu.tr/duyuru/${slug}`,
    publicationKind: "date",
    publishedDate: "2026-08-04",
    publicationTimeSource: "source",
    fetchedAt: "2026-08-04T08:00:00.000Z",
    trustStatus: "trusted"
  };
}

class FakeDocument {
  constructor(readonly id: string, private readonly record: Record<string, unknown>) {}

  toObject(): Record<string, unknown> {
    return { _id: this.id, ...this.record };
  }
}

class FakeAnnouncementSourceModel {
  records: Array<Record<string, unknown> & { _id: string }> = [];
  private nextId = 1;

  async findById(id: string): Promise<FakeDocument | null> {
    const record = this.records.find((candidate) => candidate._id === id);
    return record ? new FakeDocument(record._id, record) : null;
  }

  async findOne(filter: Record<string, unknown>): Promise<FakeDocument | null> {
    const record = this.records.find((candidate) => matchesMongoFilter(candidate, filter));
    return record ? new FakeDocument(record._id, record) : null;
  }

  find(filter: Record<string, unknown>): FakeQuery<FakeDocument> {
    return new FakeQuery(this.records
      .filter((candidate) => matchesMongoFilter(candidate, filter))
      .map((candidate) => new FakeDocument(candidate._id, candidate)));
  }

  async create(value: Record<string, unknown>, forcedId?: string): Promise<FakeDocument> {
    const _id = forcedId ?? `64e${String(this.nextId++).padStart(21, "0")}`;
    const now = new Date("2026-08-27T00:00:00.000Z");
    const stored = { ...value, _id, createdAt: now, updatedAt: now };
    this.records.push(stored);
    return new FakeDocument(_id, stored);
  }

  async findByIdAndUpdate(id: string, value: Record<string, unknown>): Promise<FakeDocument | null> {
    const index = this.records.findIndex((record) => record._id === id);
    if (index < 0) return null;
    const set = value.$set && typeof value.$set === "object"
      ? value.$set as Record<string, unknown>
      : value;
    const stored: Record<string, unknown> & { _id: string } = {
      ...this.records[index]!,
      ...set,
      _id: id,
      updatedAt: new Date("2026-08-27T00:01:00.000Z")
    };
    const unset = value.$unset && typeof value.$unset === "object"
      ? value.$unset as Record<string, unknown>
      : {};
    for (const field of Object.keys(unset)) delete stored[field];
    this.records[index] = stored;
    return new FakeDocument(id, stored);
  }

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: {
      $set?: Record<string, unknown>;
      $setOnInsert?: Record<string, unknown>;
      $unset?: Record<string, unknown>;
      $addToSet?: Record<string, { $each?: unknown[] }>;
      $inc?: Record<string, number>;
    },
    options: { upsert?: boolean }
  ): Promise<FakeDocument | null> {
    const existing = this.records.find((record) => matchesMongoFilter(record, filter));
    if (existing) {
      Object.assign(existing, update.$set ?? {});
      for (const field of Object.keys(update.$unset ?? {})) delete existing[field];
      for (const [field, instruction] of Object.entries(update.$addToSet ?? {})) {
        const values = Array.isArray(existing[field]) ? existing[field] as unknown[] : [];
        existing[field] = [...new Set([...values, ...(instruction.$each ?? [])])];
      }
      for (const [field, increment] of Object.entries(update.$inc ?? {})) {
        existing[field] = Number(existing[field] ?? 0) + increment;
      }
      if (update.$set || update.$unset || update.$addToSet || update.$inc) {
        existing.updatedAt = new Date("2026-08-27T00:01:00.000Z");
      }
      return new FakeDocument(existing._id, existing);
    }
    if (!options.upsert || !update.$setOnInsert) return null;
    return this.create(update.$setOnInsert, typeof filter._id === "string" ? filter._id : undefined);
  }
}

class FakeAnnouncementItemModel {
  records: Array<Record<string, unknown> & { _id: string }> = [];
  private nextId = 1;

  async find(filter: { sourceId?: string }): Promise<FakeDocument[]> {
    return this.records
      .filter((record) => !filter.sourceId || record.sourceId === filter.sourceId)
      .map((record) => new FakeDocument(record._id, record));
  }

  async create(value: Record<string, unknown>): Promise<FakeDocument> {
    const _id = `64f${String(this.nextId++).padStart(21, "0")}`;
    const { id: _parserId, ...record } = value;
    const stored = { ...record, _id };
    this.records.push(stored);
    return new FakeDocument(_id, stored);
  }

  async findByIdAndUpdate(id: string, value: Record<string, unknown>): Promise<FakeDocument | null> {
    const index = this.records.findIndex((record) => record._id === id);
    if (index < 0) return null;
    const { id: _parserId, ...update } = value;
    const stored = { ...this.records[index]!, ...update, _id: id };
    this.records[index] = stored;
    return new FakeDocument(id, stored);
  }

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: { $set?: Record<string, unknown> }
  ): Promise<FakeDocument | null> {
    const index = this.records.findIndex((record) => Object.entries(filter).every(([key, value]) =>
      (key === "_id" ? record._id : record[key]) === value));
    if (index < 0) return null;
    const stored = { ...this.records[index]!, ...(update.$set ?? {}) };
    this.records[index] = stored;
    return new FakeDocument(stored._id, stored);
  }

  async deleteMany(filter: { _id?: { $in?: string[] }; trustStatus?: string }): Promise<void> {
    const ids = new Set(filter._id?.$in ?? []);
    this.records = this.records.filter((record) =>
      !(ids.has(record._id) && (!filter.trustStatus || record.trustStatus === filter.trustStatus)));
  }
}

function snapshotHarness(
  source: AnnouncementSourceRecord,
  legacyItems: AnnouncementItem[],
  options: {
    rejectActivation?: boolean;
    throwAfterActivation?: boolean;
    advancePointerAfterLostResponse?: boolean;
    editDefinitionBeforeActivation?: boolean;
    concurrentSourceState?: Partial<Pick<AnnouncementSourceRecord, "status" | "trustStatus">>;
    beforeSourceUpdate?: () => Promise<void>;
    beforeSnapshotCreate?: (value: Record<string, unknown>) => void | Promise<void>;
    beforeSnapshotFinalization?: (snapshotId: string) => void | Promise<void>;
    afterSnapshotPointerSwap?: (
      sourceState: Record<string, unknown> & { _id: string; activeSnapshotId?: string },
      snapshots: Array<Record<string, unknown> & { _id: string }>,
      snapshotId: string
    ) => void | Promise<void>;
    beforeSnapshotUpdateMany?: () => void | Promise<void>;
    retireStageOnCreate?: boolean;
    retentionActiveSnapshotIds?: ReadonlySet<string>;
    serverNow?: Date;
    delayActivationAfterResponseLoss?: boolean;
    commitDelayedActivationBeforeVerificationRead?: boolean;
    delayReservationAfterResponseLoss?: boolean;
    failIntentClear?: boolean;
  } = {}
) {
  const sourceState: Record<string, unknown> & { _id: string; activeSnapshotId?: string } = {
    ...source,
    _id: source.id
  };
  delete sourceState.id;
  const snapshots: Array<Record<string, unknown> & { _id: string }> = [];
  const operations: string[] = [];
  const transaction = vi.fn();
  type SourceUpdate = {
    $set?: Record<string, unknown>;
    $inc?: Record<string, number>;
    $unset?: Record<string, unknown>;
  };
  let delayedActivation: { filter: Record<string, unknown>; update: SourceUpdate } | undefined;
  let delayedReservation: { filter: Record<string, unknown>; update: SourceUpdate } | undefined;
  const applySourceUpdate = (update: SourceUpdate) => {
    Object.assign(sourceState, update.$set ?? {});
    for (const [field, increment] of Object.entries(update.$inc ?? {})) {
      sourceState[field] = Number(sourceState[field] ?? 0) + increment;
    }
    for (const field of Object.keys(update.$unset ?? {})) delete sourceState[field];
  };
  const commitDelayedActivation = () => {
    const delayed = delayedActivation;
    delayedActivation = undefined;
    if (!delayed || !matchesMongoFilter(sourceState, delayed.filter, options.serverNow)) return false;
    applySourceUpdate(delayed.update);
    const snapshotId = delayed.update.$set?.activeSnapshotId;
    if (typeof snapshotId === "string") operations.push(`activate-delayed:${snapshotId}`);
    return true;
  };
  const sourceFind = vi.fn(async (filter: Record<string, unknown> = {}) =>
    matchesMongoFilter(sourceState, filter, options.serverNow) ? [new FakeDocument(source.id, sourceState)] : []);

  const sourceModel = {
    findOne: vi.fn(async (filter: Record<string, unknown>) => {
      if (
        options.commitDelayedActivationBeforeVerificationRead
        && !("activeSnapshotId" in filter)
      ) commitDelayedActivation();
      return matchesMongoFilter(sourceState, filter, options.serverNow)
        ? new FakeDocument(source.id, sourceState)
        : null;
    }),
    find: sourceFind,
    findOneAndUpdate: vi.fn(async (
      filter: Record<string, unknown>,
      update: SourceUpdate
    ) => {
      const activatingSnapshotId = update.$set?.activeSnapshotId;
      const pendingSnapshotId = update.$set?.pendingSnapshotId;
      const activatesSnapshot = typeof activatingSnapshotId === "string";
      const reservesSnapshot = typeof pendingSnapshotId === "string" && !activatesSnapshot;
      if (activatesSnapshot) await options.beforeSourceUpdate?.();
      if (activatesSnapshot) Object.assign(sourceState, options.concurrentSourceState);
      if (activatesSnapshot && options.editDefinitionBeforeActivation) {
        sourceState.parser = "rss";
        sourceState.sourceDefinitionVersion = "64c000000000000000000099";
        sourceState.snapshotStateRevision = Number(sourceState.snapshotStateRevision ?? 0) + 1;
        delete sourceState.activeSnapshotId;
        delete sourceState.pendingSnapshotId;
        delete sourceState.pendingSnapshotRevision;
        delete sourceState.pendingSnapshotExpiresAt;
      }
      if (activatesSnapshot && options.rejectActivation) return null;
      if (!activatesSnapshot && update.$unset?.pendingSnapshotId && options.failIntentClear) {
        throw new Error("SIMULATED_INTENT_CLEAR_FAILURE");
      }
      if (activatesSnapshot && options.delayActivationAfterResponseLoss && !delayedActivation) {
        delayedActivation = { filter, update };
        throw new Error("SIMULATED_DELAYED_RESPONSE_LOSS");
      }
      if (reservesSnapshot && options.delayReservationAfterResponseLoss && !delayedReservation) {
        delayedReservation = { filter, update };
        throw new Error("SIMULATED_DELAYED_RESERVATION_RESPONSE_LOSS");
      }
      if (!matchesMongoFilter(sourceState, filter, options.serverNow)) return null;
      applySourceUpdate(update);
      if (typeof pendingSnapshotId === "string") operations.push(`reserve:${pendingSnapshotId}`);
      if (activatesSnapshot) {
        operations.push(`activate:${activatingSnapshotId}`);
        await options.afterSnapshotPointerSwap?.(sourceState, snapshots, activatingSnapshotId);
      }
      if (activatesSnapshot && options.throwAfterActivation) {
        if (options.advancePointerAfterLostResponse) {
          sourceState.activeSnapshotId = "64b000000000000000000099";
          sourceState.snapshotStateRevision = Number(sourceState.snapshotStateRevision ?? 0) + 1;
        }
        throw new Error("SIMULATED_RESPONSE_LOSS");
      }
      return new FakeDocument(source.id, sourceState);
    })
  };

  const snapshotCreate = vi.fn(async (value: Record<string, unknown>) => {
    const _id = String(value._id);
    operations.push(`create:${_id}`);
    await options.beforeSnapshotCreate?.(value);
    const stored = structuredClone({
      createdAt: new Date(),
      updatedAt: new Date(),
      ...value,
      _id
    }) as Record<string, unknown> & { _id: string };
    if (options.retireStageOnCreate) {
      stored.purgeAfter = new Date(Date.now() + 60 * 60 * 1_000);
    }
    snapshots.push(stored);
    return new FakeDocument(_id, stored);
  });
  const snapshotDelete = vi.fn(async (filter: { _id?: string }) => {
    const index = snapshots.findIndex((snapshot) => snapshot._id === filter._id);
    if (index >= 0) snapshots.splice(index, 1);
    return { deletedCount: index >= 0 ? 1 : 0 };
  });
  const snapshotFind = vi.fn((filter: Record<string, unknown>) => new FakeQuery(snapshots
    .filter((snapshot) => matchesMongoFilter(snapshot, filter, options.serverNow))
    .map((snapshot) => new FakeDocument(snapshot._id, snapshot))));
  const snapshotUpdateMany = vi.fn(async (filter: Record<string, unknown>, update: {
    $set?: Record<string, unknown>;
    $unset?: Record<string, unknown>;
  }) => {
    await options.beforeSnapshotUpdateMany?.();
    let modifiedCount = 0;
    for (const snapshot of snapshots.filter((candidate) => matchesMongoFilter(candidate, filter, options.serverNow))) {
      Object.assign(snapshot, update.$set ?? {});
      for (const field of Object.keys(update.$unset ?? {})) delete snapshot[field];
      modifiedCount += 1;
    }
    return { matchedCount: modifiedCount, modifiedCount };
  });
  const snapshotAggregate = vi.fn(async (pipeline: Array<Record<string, unknown>>) => {
    const initialMatch = (pipeline[0]?.$match ?? {}) as Record<string, unknown>;
    const lookupIndex = pipeline.findIndex((stage) => "$lookup" in stage);
    const lookup = (pipeline[lookupIndex]?.$lookup ?? {}) as {
      let?: Record<string, unknown>;
      pipeline?: Array<{ $match?: { $expr?: unknown } }>;
    };
    const lookupExpression = lookup.pipeline?.[0]?.$match?.$expr;
    const preLookupLimit = pipeline
      .slice(0, lookupIndex < 0 ? pipeline.length : lookupIndex)
      .find((stage) => "$limit" in stage);
    const limit = Number(preLookupLimit?.$limit ?? snapshots.length);
    return snapshots
      .filter((snapshot) => matchesMongoFilter(snapshot, initialMatch, options.serverNow))
      .slice(0, limit)
      .map((snapshot) => {
        const now = options.serverNow ?? new Date();
        const variables = Object.fromEntries(Object.entries(lookup.let ?? {}).map(([name, expression]) => [
          name,
          mongoExpressionValue(snapshot, expression, now, {})
        ]));
        return {
          _id: snapshot._id,
          protected: options.retentionActiveSnapshotIds?.has(snapshot._id) === true
            || matchesMongoExpression(sourceState, lookupExpression, now, variables)
        };
      });
  });
  const snapshotModel = {
    create: snapshotCreate,
    aggregate: snapshotAggregate,
    deleteOne: snapshotDelete,
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: {
      $set?: Record<string, unknown>;
      $unset?: Record<string, unknown>;
    }) => {
      const snapshot = snapshots.find((candidate) => matchesMongoFilter(candidate, filter, options.serverNow));
      if (!snapshot) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(snapshot, update.$set ?? {});
      for (const field of Object.keys(update.$unset ?? {})) delete snapshot[field];
      return { matchedCount: 1, modifiedCount: 1 };
    }),
    updateMany: snapshotUpdateMany,
    findOne: vi.fn(async (filter: { _id?: string; sourceId?: string }) => {
      const snapshot = snapshots.find((candidate) =>
        (!filter._id || candidate._id === filter._id)
        && (!filter.sourceId || candidate.sourceId === filter.sourceId));
      return snapshot ? new FakeDocument(snapshot._id, snapshot) : null;
    }),
    find: snapshotFind,
    findOneAndUpdate: vi.fn(async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }
    ) => {
      if (!("$or" in filter) && typeof filter._id === "string") {
        await options.beforeSnapshotFinalization?.(filter._id);
      }
      const snapshot = snapshots.find((candidate) => matchesMongoFilter(candidate, filter, options.serverNow));
      if (!snapshot) return null;
      Object.assign(snapshot, update.$set ?? {});
      for (const field of Object.keys(update.$unset ?? {})) delete snapshot[field];
      return new FakeDocument(snapshot._id, snapshot);
    })
  };

  const legacyModel = {
    find: vi.fn((filter: { sourceId?: string | { $in?: string[] }; trustStatus?: string }) => {
      const allowedIds = typeof filter.sourceId === "string"
        ? new Set([filter.sourceId])
        : new Set(filter.sourceId?.$in ?? []);
      const documents = legacyItems
        .filter((candidate) => allowedIds.size === 0 || allowedIds.has(candidate.sourceId))
        .filter((candidate) => !filter.trustStatus || candidate.trustStatus === filter.trustStatus)
        .map((candidate) => new FakeDocument(candidate.id, candidate as unknown as Record<string, unknown>));
      return new FakeQuery(documents);
    }),
    findOne: vi.fn(async (filter: { _id?: string }) => {
      const candidate = legacyItems.find((item) => item.id === filter._id);
      return candidate ? new FakeDocument(candidate.id, candidate as unknown as Record<string, unknown>) : null;
    }),
    findOneAndUpdate: vi.fn(async () => null)
  };

  const createRepository = () => {
    const value = new MongoAnnouncementRepository({
      getConnection: () => ({ transaction }),
      connect: async () => ({ transaction })
    } as never);
    Object.defineProperty(value, "model", {
      value: async (name: string) => {
        if (name === "AnnouncementSource") return sourceModel;
        if (name === "AnnouncementSnapshot") return snapshotModel;
        if (name === "AnnouncementItem") return legacyModel;
        throw new Error(`Unexpected model: ${name}`);
      }
    });
    return value;
  };
  const repository = createRepository();
  const runDelayedActivation = async () => commitDelayedActivation();
  const runDelayedReservation = async () => {
    const delayed = delayedReservation;
    delayedReservation = undefined;
    if (!delayed || !matchesMongoFilter(sourceState, delayed.filter, options.serverNow)) return false;
    applySourceUpdate(delayed.update);
    const snapshotId = delayed.update.$set?.pendingSnapshotId;
    if (typeof snapshotId === "string") operations.push(`reserve-delayed:${snapshotId}`);
    return true;
  };

  return {
    repository,
    sourceState,
    sourceFind,
    operations,
    snapshots,
    snapshotCreate,
    snapshotDelete,
    snapshotFind,
    snapshotAggregate,
    snapshotUpdateMany,
    runDelayedActivation,
    runDelayedReservation,
    restartRepository: createRepository,
    transaction
  };
}

function matchesMongoFilter(
  record: Record<string, unknown>,
  filter: Record<string, unknown>,
  now = new Date()
): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$and") {
      return (expected as Record<string, unknown>[]).every((branch) => matchesMongoFilter(record, branch, now));
    }
    if (key === "$or") {
      return (expected as Record<string, unknown>[]).some((branch) => matchesMongoFilter(record, branch, now));
    }
    if (key === "$expr") return matchesMongoExpression(record, expected, now);
    const actual = record[key];
    if (expected === null) return actual === null || actual === undefined;
    if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime();
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const operators = expected as Record<string, unknown>;
      if ("$exists" in operators && (key in record) !== Boolean(operators.$exists)) return false;
      if ("$ne" in operators && actual === operators.$ne) return false;
      if ("$gt" in operators && !compareMongoTestValues(actual, operators.$gt, (left, right) => left > right)) return false;
      if ("$lt" in operators && !compareMongoTestValues(actual, operators.$lt, (left, right) => left < right)) return false;
      if ("$lte" in operators && !compareMongoTestValues(actual, operators.$lte, (left, right) => left <= right)) return false;
      if ("$in" in operators && !(operators.$in as unknown[]).some((value) =>
        value === actual || (value === null && actual === undefined))) return false;
      return true;
    }
    return actual === expected;
  });
}

function matchesMongoExpression(
  record: Record<string, unknown>,
  expression: unknown,
  now: Date,
  variables: Record<string, unknown> = {}
): boolean {
  if (!expression || typeof expression !== "object" || Array.isArray(expression)) return false;
  const operators = expression as Record<string, unknown>;
  if (Array.isArray(operators.$and)) {
    return operators.$and.every((candidate) => matchesMongoExpression(record, candidate, now, variables));
  }
  if (Array.isArray(operators.$or)) {
    return operators.$or.some((candidate) => matchesMongoExpression(record, candidate, now, variables));
  }
  if (Array.isArray(operators.$eq) && operators.$eq.length === 2) {
    const [left, right] = operators.$eq;
    return mongoExpressionValue(record, left, now, variables) === mongoExpressionValue(record, right, now, variables);
  }
  if (Array.isArray(operators.$gt) && operators.$gt.length === 2) {
    const [left, right] = operators.$gt;
    return compareMongoTestValues(
      mongoExpressionValue(record, left, now, variables),
      mongoExpressionValue(record, right, now, variables),
      (leftValue, rightValue) => leftValue > rightValue
    );
  }
  return false;
}

function mongoExpressionValue(
  record: Record<string, unknown>,
  expression: unknown,
  now: Date,
  variables: Record<string, unknown>
): unknown {
  if (expression === "$$NOW") return now;
  if (typeof expression === "string" && expression.startsWith("$$")) return variables[expression.slice(2)];
  if (typeof expression === "string" && expression.startsWith("$")) return record[expression.slice(1)];
  if (expression && typeof expression === "object" && !Array.isArray(expression)) {
    const operators = expression as Record<string, unknown>;
    const ifNull = operators.$ifNull;
    if (Array.isArray(ifNull) && ifNull.length === 2) {
      return mongoExpressionValue(record, ifNull[0], now, variables)
        ?? mongoExpressionValue(record, ifNull[1], now, variables);
    }
    if (operators.$toString !== undefined) {
      const value = mongoExpressionValue(record, operators.$toString, now, variables);
      return value === null || value === undefined ? null : String(value);
    }
    if (operators.$convert && typeof operators.$convert === "object" && !Array.isArray(operators.$convert)) {
      const conversion = operators.$convert as Record<string, unknown>;
      const value = mongoExpressionValue(record, conversion.input, now, variables);
      if (conversion.to === "objectId") {
        return typeof value === "string" && /^[a-f\d]{24}$/iu.test(value)
          ? value
          : mongoExpressionValue(record, conversion.onError, now, variables);
      }
    }
  }
  return expression;
}

function compareMongoTestValues(
  actual: unknown,
  expected: unknown,
  compare: (left: number, right: number) => boolean
): boolean {
  const left = actual instanceof Date ? actual.getTime() : typeof actual === "number" ? actual : Number.NaN;
  const right = expected instanceof Date ? expected.getTime() : typeof expected === "number" ? expected : Number.NaN;
  return Number.isFinite(left) && Number.isFinite(right) && compare(left, right);
}

class FakeQuery<T> implements PromiseLike<T[]> {
  private values: T[];

  constructor(values: T[]) {
    this.values = [...values];
  }

  sort(): this {
    return this;
  }

  skip(count: number): this {
    this.values = this.values.slice(count);
    return this;
  }

  limit(count: number): this {
    this.values = this.values.slice(0, count);
    return this;
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.values).then(onfulfilled, onrejected);
  }
}
