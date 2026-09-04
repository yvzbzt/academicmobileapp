import { describe, expect, it, vi } from "vitest";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { MongoAnnouncementRepository } from "../src/modules/announcements/mongo-announcement.repository.js";
import type { AnnouncementItem, AnnouncementSourceRecord } from "../src/modules/announcements/announcements.types.js";

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

  it("invalidates conditional-fetch validators when the processing definition changes but keeps the active snapshot", async () => {
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
    expect(inMemoryChanged).toEqual(expect.objectContaining({ activeSnapshotId: validators.activeSnapshotId }));
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
    expect(mongoChanged).toEqual(expect.objectContaining({ activeSnapshotId: validators.activeSnapshotId }));
    expect(mongoChanged.sourceDefinitionVersion).not.toBe(mongoCreated.sourceDefinitionVersion);
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
    await inMemory.deactivateSource(inMemoryCreated.id);
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
    await mongo.deactivateSource(mongoCreated.id);
    const mongoReactivated = await mongo.upsertSource({
      ...sourceInput(),
      id: mongoCreated.id,
      ...validators
    });
    expect(mongoReactivated.sourceDefinitionVersion).toBe(mongoCreated.sourceDefinitionVersion);
    expect(mongoReactivated.notificationProducerVersion).not.toBe(mongoCreated.notificationProducerVersion);
    expect(mongoReactivated).toEqual(expect.objectContaining(validators));
  });
});

describe("announcement normalized persistence identity", () => {
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
      .resolves.toEqual([expect.objectContaining({ id: legacy.id })]);
    await expect(repository.findTrustedItemByIdInScope({
      announcementId: legacy.id,
      universityId: source.scopeId
    })).resolves.toEqual(expect.objectContaining({
      item: expect.objectContaining({ id: legacy.id }),
      source: expect.objectContaining({ id: source.id })
    }));

    expect(await repository.acknowledgeNotificationProduction(delta.materiallyUpdated)).toBe(1);
    await expect(repository.listItemsForSource(source.id)).resolves.toEqual([
      expect.objectContaining({
        id: legacy.id,
        notificationProducedFingerprint: delta.materiallyUpdated[0]?.contentFingerprint
      })
    ]);

    const retrySource = {
      ...source,
      activeSnapshotId: String(harness.sourceState.activeSnapshotId)
    };
    const retry = await repository.replaceItemsForSource(retrySource, [
      item(source, "parser-retry", "same", "Yeni özet")
    ]);
    expect(retry.unchanged).toEqual([
      expect.objectContaining({ id: legacy.id, snapshotId: harness.sourceState.activeSnapshotId })
    ]);
    expect(harness.snapshots).toHaveLength(1);
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
    const record = this.records.find((candidate) => Object.entries(filter).every(([key, value]) => candidate[key] === value));
    return record ? new FakeDocument(record._id, record) : null;
  }

  async find(filter: Record<string, unknown>): Promise<FakeDocument[]> {
    return this.records
      .filter((candidate) => Object.entries(filter).every(([key, value]) => candidate[key] === value))
      .map((candidate) => new FakeDocument(candidate._id, candidate));
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
    update: { $setOnInsert?: Record<string, unknown> },
    options: { upsert?: boolean }
  ): Promise<FakeDocument | null> {
    const matches = (record: Record<string, unknown>) => Object.entries(filter).every(([key, value]) => {
      if (key === "$or") {
        return (value as Array<Record<string, unknown>>).some((branch) =>
          Object.entries(branch).every(([branchKey, branchValue]) => record[branchKey] === branchValue));
      }
      return record[key] === value;
    });
    const existing = this.records.find(matches);
    if (existing) return new FakeDocument(existing._id, existing);
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
  } = {}
) {
  const sourceState: Record<string, unknown> & { _id: string; activeSnapshotId?: string } = {
    ...source,
    _id: source.id
  };
  delete sourceState.id;
  const snapshots: Array<Record<string, unknown> & { _id: string }> = [];
  const transaction = vi.fn();

  const sourceModel = {
    findOne: vi.fn(async (filter: Record<string, unknown>) =>
      matchesMongoFilter(sourceState, filter) ? new FakeDocument(source.id, sourceState) : null),
    find: vi.fn(async () => [new FakeDocument(source.id, sourceState)]),
    findOneAndUpdate: vi.fn(async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown> }
    ) => {
      if (options.editDefinitionBeforeActivation) {
        sourceState.parser = "rss";
        sourceState.sourceDefinitionVersion = "64c000000000000000000099";
      }
      if (options.rejectActivation) return null;
      if (!matchesMongoFilter(sourceState, filter)) return null;
      Object.assign(sourceState, update.$set ?? {});
      if (options.throwAfterActivation) {
        if (options.advancePointerAfterLostResponse) {
          sourceState.activeSnapshotId = "64b000000000000000000099";
        }
        throw new Error("SIMULATED_RESPONSE_LOSS");
      }
      return new FakeDocument(source.id, sourceState);
    })
  };

  const snapshotCreate = vi.fn(async (value: Record<string, unknown>) => {
    const _id = String(value._id);
    const stored = structuredClone({ ...value, _id }) as Record<string, unknown> & { _id: string };
    snapshots.push(stored);
    return new FakeDocument(_id, stored);
  });
  const snapshotDelete = vi.fn(async (filter: { _id?: string }) => {
    const index = snapshots.findIndex((snapshot) => snapshot._id === filter._id);
    if (index >= 0) snapshots.splice(index, 1);
    return { deletedCount: index >= 0 ? 1 : 0 };
  });
  const snapshotModel = {
    create: snapshotCreate,
    deleteOne: snapshotDelete,
    findOne: vi.fn(async (filter: { _id?: string; sourceId?: string }) => {
      const snapshot = snapshots.find((candidate) =>
        (!filter._id || candidate._id === filter._id)
        && (!filter.sourceId || candidate.sourceId === filter.sourceId));
      return snapshot ? new FakeDocument(snapshot._id, snapshot) : null;
    }),
    find: vi.fn(async (filter: { _id?: { $in?: Array<string | undefined> } }) => {
      const ids = new Set(filter._id?.$in?.filter((id): id is string => Boolean(id)) ?? []);
      return snapshots
        .filter((snapshot) => ids.size === 0 || ids.has(snapshot._id))
        .map((snapshot) => new FakeDocument(snapshot._id, snapshot));
    }),
    findOneAndUpdate: vi.fn(async (
      filter: { _id?: string; sourceId?: string; items?: { $elemMatch?: Record<string, unknown> } },
      update: { $set?: Record<string, unknown> }
    ) => {
      const snapshot = snapshots.find((candidate) =>
        candidate._id === filter._id && candidate.sourceId === filter.sourceId);
      if (!snapshot || !Array.isArray(snapshot.items)) return null;
      const criteria = filter.items?.$elemMatch ?? {};
      const target = (snapshot.items as Array<Record<string, unknown>>).find((candidate) =>
        Object.entries(criteria).every(([key, value]) => candidate[key] === value));
      if (!target) return null;
      const producedFingerprint = update.$set?.["items.$[item].notificationProducedFingerprint"];
      if (typeof producedFingerprint === "string") {
        target.notificationProducedFingerprint = producedFingerprint;
      }
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

  const repository = new MongoAnnouncementRepository({
    getConnection: () => ({ transaction }),
    connect: async () => ({ transaction })
  } as never);
  Object.defineProperty(repository, "model", {
    value: async (name: string) => {
      if (name === "AnnouncementSource") return sourceModel;
      if (name === "AnnouncementSnapshot") return snapshotModel;
      if (name === "AnnouncementItem") return legacyModel;
      throw new Error(`Unexpected model: ${name}`);
    }
  });

  return {
    repository,
    sourceState,
    snapshots,
    snapshotCreate,
    snapshotDelete,
    transaction
  };
}

function matchesMongoFilter(record: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") {
      return (expected as Record<string, unknown>[]).some((branch) => matchesMongoFilter(record, branch));
    }
    const actual = record[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const operators = expected as Record<string, unknown>;
      if ("$exists" in operators) return (key in record) === Boolean(operators.$exists);
    }
    return actual === expected;
  });
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
