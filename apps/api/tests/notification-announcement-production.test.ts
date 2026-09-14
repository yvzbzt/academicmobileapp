import { describe, expect, it } from "vitest";
import type { AuthUserRecord } from "../src/modules/auth/auth.types.js";
import { toPersistenceReference } from "../src/modules/announcements/announcement-persistence.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import type { AnnouncementItem, AnnouncementPersistenceDelta, AnnouncementRepository, AnnouncementSourceRecord } from "../src/modules/announcements/announcements.types.js";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";
import { announcementDestinationFingerprint } from "../src/modules/notifications/notification-destination.js";
import { NotificationWorkerService } from "../src/modules/notifications/notification-worker.service.js";
import { NotificationSchedulingService } from "../src/modules/notifications/notifications.service.js";
import { NOTIFICATION_DELIVERY_CONSENT_VERSION } from "../src/modules/notifications/notification.types.js";
import type { PushMessageInput, PushSender } from "../src/modules/notifications/push-sender.service.js";
import { InMemoryQueueService } from "../src/queue/in-memory-queue.service.js";

describe("announcement notification production", () => {
  it("replays a durable sync after response loss, acknowledges it once, and uses the authoritative persisted item ID", async () => {
    const announcements = new InMemoryAnnouncementRepository();
    const notifications = new ResponseLossNotificationRepository();
    const scheduler = new NotificationSchedulingService(notifications, announcements);
    const source = await announcements.upsertSource(sourceInput("university", "university-1", "source-replay"));
    const now = new Date("2026-08-04T08:00:00.000Z");

    const firstDelta = await announcements.replaceItemsForSource(source, [announcementItem(source, "parser-first")]);
    const persistedId = firstDelta.created[0]?.id;
    expect(persistedId).toBe("parser-first");
    const firstApproval = await approveReviewItem(announcements, persistedId!);
    await expect(scheduler.syncTrustedAnnouncementSource(source, firstApproval.delta, now)).rejects.toThrow("SIMULATED_SYNC_RESPONSE_LOSS");
    expect((await notifications.listDueJobs(now, 10))).toEqual([
      expect.objectContaining({ destinationId: persistedId, producerKeys: [`announcement-source:${source.id}`] })
    ]);

    const replayDelta = await announcements.replaceItemsForSource(source, [announcementItem(source, "parser-retry")]);
    expect(replayDelta).toEqual(expect.objectContaining({
      created: [],
      materiallyUpdated: [expect.objectContaining({ id: persistedId })]
    }));
    await expect(scheduler.syncTrustedAnnouncementSource(source, replayDelta, now)).resolves.toEqual(
      expect.objectContaining({ active: [expect.objectContaining({ destinationId: persistedId })] })
    );
    expect(await notifications.listDueJobs(now, 10)).toHaveLength(1);

    const acknowledgedDelta = await announcements.replaceItemsForSource(source, [announcementItem(source, "parser-third")]);
    expect(acknowledgedDelta.materiallyUpdated).toEqual([]);
    expect(acknowledgedDelta.unchanged).toEqual([expect.objectContaining({ id: persistedId })]);
    expect((await announcements.listItemsForSource(source.id))[0]?.id).toBe(persistedId);
  });

  it("delivers a faculty wildcard only to the exact faculty and a YOK wildcard across universities", async () => {
    const now = new Date("2026-08-04T09:00:00.000Z");

    const facultyAnnouncements = new InMemoryAnnouncementRepository();
    const facultyNotifications = new InMemoryNotificationRepository();
    const facultyScheduler = new NotificationSchedulingService(facultyNotifications, facultyAnnouncements);
    const facultySource = await facultyAnnouncements.upsertSource(sourceInput("faculty", "faculty-1", "faculty-source"));
    const facultyDelta = await facultyAnnouncements.replaceItemsForSource(facultySource, [announcementItem(facultySource, "faculty-item")]);
    const facultyApproval = await approveReviewItem(facultyAnnouncements, facultyDelta.created[0]!.id);
    const facultySync = await facultyScheduler.syncTrustedAnnouncementSource(facultySource, facultyApproval.delta, now);
    expect(facultySync.active).toEqual([
      expect.objectContaining({
        universityId: "*",
        facultyId: "faculty-1",
        category: "faculty_announcement",
        destinationId: facultyDelta.created[0]?.id
      })
    ]);
    await registerRecipient(facultyNotifications, "faculty-match", "faculty_announcement");
    await registerRecipient(facultyNotifications, "faculty-other", "faculty_announcement");
    const facultySender = new RecordingSender();
    const facultyUsers = new Map<string, AuthUserRecord>([
      ["faculty-match", student("faculty-match", "university-any", "faculty-1")],
      ["faculty-other", student("faculty-other", "university-any", "faculty-2")]
    ]);
    const facultyResult = await new NotificationWorkerService(
      facultyNotifications,
      new InMemoryQueueService(),
      facultySender,
      { findUserById: async (id: string) => facultyUsers.get(id) ?? null },
      facultyAnnouncements
    ).processDueJobs(now);
    expect(facultyResult).toEqual(expect.objectContaining({ sent: 1, skipped: 1 }));
    expect(facultySender.messages.map((message) => message.token)).toEqual(["token-faculty-match"]);

    const yokAnnouncements = new InMemoryAnnouncementRepository();
    const yokNotifications = new InMemoryNotificationRepository();
    const yokScheduler = new NotificationSchedulingService(yokNotifications, yokAnnouncements);
    const yokSource = await yokAnnouncements.upsertSource({
      ...sourceInput("university", "yok-council-of-higher-education", "yok-source"),
      sourceName: "YOK",
      sourceUrl: "https://www.yok.gov.tr/duyurular",
      homepageUrl: "https://www.yok.gov.tr/"
    });
    const yokDelta = await yokAnnouncements.replaceItemsForSource(yokSource, [
      { ...announcementItem(yokSource, "yok-item"), link: "https://www.yok.gov.tr/duyurular/yok-item" }
    ]);
    const yokApproval = await approveReviewItem(yokAnnouncements, yokDelta.created[0]!.id);
    const yokSync = await yokScheduler.syncTrustedAnnouncementSource(yokSource, yokApproval.delta, now);
    expect(yokSync.active).toEqual([
      expect.objectContaining({ universityId: "*", category: "yok_event", destinationId: yokDelta.created[0]?.id })
    ]);
    expect(yokSync.active[0]).not.toHaveProperty("facultyId");
    expect(yokSync.active[0]).not.toHaveProperty("departmentId");
    await registerRecipient(yokNotifications, "remote-university-student", "yok_event");
    const yokSender = new RecordingSender();
    const yokResult = await new NotificationWorkerService(
      yokNotifications,
      new InMemoryQueueService(),
      yokSender,
      { findUserById: async (id: string) => id === "remote-university-student" ? student(id, "university-remote") : null },
      yokAnnouncements
    ).processDueJobs(now);
    expect(yokResult).toEqual(expect.objectContaining({ sent: 1, skipped: 0 }));
    expect(yokSender.messages).toHaveLength(1);

    const yokItem = (await yokAnnouncements.listItemsForSource(yokSource.id))[0];
    if (!yokItem) throw new Error("Expected persisted YOK item.");
    const [corruptWildcard] = await yokNotifications.createNotificationJobs([{
      calendarId: "corrupt-global-announcement",
      eventId: "corrupt-global-announcement",
      destinationType: "announcement",
      destinationId: yokItem.id,
      destinationScopeType: "university",
      destinationScopeId: "yok-council-of-higher-education",
      destinationFingerprint: announcementDestinationFingerprint(yokItem, yokSource),
      universityId: "*",
      title: yokItem.title,
      category: "announcement",
      offsetDays: 0,
      trigger: "at_time",
      scheduledAt: now,
      status: "scheduled"
    }]);
    if (!corruptWildcard) throw new Error("Expected corrupt wildcard fixture.");
    const corruptResult = await new NotificationWorkerService(
      yokNotifications,
      new InMemoryQueueService(),
      yokSender,
      { findUserById: async (id: string) => id === "remote-university-student" ? student(id, "university-remote") : null },
      yokAnnouncements
    ).processDueJobs(now);
    expect(corruptResult).toEqual(expect.objectContaining({ sent: 0, skipped: 1 }));
    expect(yokSender.messages).toHaveLength(1);
    expect((await yokNotifications.listJobsByCalendar(corruptWildcard.calendarId))[0]?.status).toBe("cancelled");
  });

  it("retires the produced job only for an authoritative successful empty snapshot", async () => {
    const announcements = new InMemoryAnnouncementRepository();
    const notifications = new InMemoryNotificationRepository();
    const scheduler = new NotificationSchedulingService(notifications, announcements);
    const source = await announcements.upsertSource(sourceInput("university", "university-1", "source-empty"));
    const now = new Date("2026-08-04T10:00:00.000Z");
    const created = await announcements.replaceItemsForSource(source, [announcementItem(source, "empty-retirement-item")]);
    const approval = await approveReviewItem(announcements, created.created[0]!.id);
    await scheduler.syncTrustedAnnouncementSource(source, approval.delta, now);
    expect(await notifications.listDueJobs(now, 10)).toHaveLength(1);

    const nonAuthoritativeEmpty = await announcements.replaceItemsForSource(source, []);
    expect(nonAuthoritativeEmpty.removed).toEqual([]);
    expect(await announcements.listItemsForSource(source.id)).toHaveLength(1);

    const authoritativeEmpty = await announcements.replaceItemsForSource(source, [], { authoritativeEmpty: true });
    expect(authoritativeEmpty.removed).toEqual([expect.objectContaining({ id: created.created[0]?.id })]);
    await expect(scheduler.syncTrustedAnnouncementSource(source, authoritativeEmpty, now)).resolves.toEqual(
      expect.objectContaining({ active: [], retired: 1 })
    );
    expect(await notifications.listDueJobs(now, 10)).toEqual([]);
    expect((await notifications.listJobsByCalendar(`announcement-source:${source.id}`))[0]?.status).toBe("cancelled");
  });

  it("does not let a stale snapshot sync retire or overwrite the newer snapshot jobs", async () => {
    const snapshotA = "64a000000000000000000001";
    const snapshotB = "64a000000000000000000002";
    const baseSource: AnnouncementSourceRecord = {
      ...sourceInput("university", "university-1", "source-snapshot-race"),
      sourceDefinitionVersion: "64c000000000000000000001",
      createdAt: new Date("2026-08-04T00:00:00.000Z"),
      updatedAt: new Date("2026-08-04T00:00:00.000Z")
    };
    const sourceA = { ...baseSource, activeSnapshotId: snapshotA };
    const sourceB = { ...baseSource, activeSnapshotId: snapshotB };
    const itemA = snapshotAnnouncementItem(sourceA, snapshotA, "Snapshot A announcement");
    const itemB = snapshotAnnouncementItem(sourceB, snapshotB, "Snapshot B announcement");
    const referenceA = toPersistenceReference(itemA);
    const referenceB = toPersistenceReference(itemB);
    if (!referenceA || !referenceB) throw new Error("Expected snapshot references.");

    let currentSource = sourceA;
    let currentItem = itemA;
    const acknowledgedSnapshots: string[] = [];
    const announcements = {
      findSourceById: async (id: string) => id === currentSource.id ? currentSource : null,
      findTrustedItemByIdInScope: async (input: { announcementId: string }) =>
        input.announcementId === currentItem.id ? { source: currentSource, item: currentItem } : null,
      acknowledgeNotificationProduction: async (references: typeof referenceA[]) => {
        if (references.some((reference) => reference.snapshotId !== currentSource.activeSnapshotId)) return 0;
        acknowledgedSnapshots.push(...references.flatMap((reference) => reference.snapshotId ? [reference.snapshotId] : []));
        return references.length;
      }
    } as unknown as AnnouncementRepository;
    const notifications = new FirstSyncGateNotificationRepository();
    const scheduler = new NotificationSchedulingService(notifications, announcements);
    const now = new Date("2026-08-04T10:30:00.000Z");
    const deltaA: AnnouncementPersistenceDelta = {
      created: [referenceA],
      materiallyUpdated: [],
      unchanged: [],
      removed: [],
      snapshotId: snapshotA
    };
    const deltaB: AnnouncementPersistenceDelta = {
      created: [referenceB],
      materiallyUpdated: [],
      unchanged: [],
      removed: [referenceA],
      snapshotId: snapshotB,
      previousSnapshotId: snapshotA
    };

    const staleSync = scheduler.syncTrustedAnnouncementSource(sourceA, deltaA, now);
    await notifications.firstSyncStarted;

    currentSource = sourceB;
    currentItem = itemB;
    await expect(scheduler.syncTrustedAnnouncementSource(sourceB, deltaB, now)).resolves.toEqual(
      expect.objectContaining({ active: [expect.objectContaining({ title: itemB.title })] })
    );

    notifications.releaseFirstSync();
    await expect(staleSync).rejects.toThrow("NOTIFICATION_PRODUCTION_SNAPSHOT_CONFLICT");

    expect(acknowledgedSnapshots).toEqual([snapshotB]);
    await expect(notifications.listDueJobs(now, 10)).resolves.toEqual([
      expect.objectContaining({
        calendarId: `announcement-source:${sourceB.id}:snapshot:${snapshotB}`,
        title: itemB.title,
        status: "scheduled"
      })
    ]);
    await expect(notifications.listJobsByCalendar(
      `announcement-source:${sourceA.id}:snapshot:${snapshotA}`
    )).resolves.toEqual([
      expect.objectContaining({ title: itemA.title, status: "cancelled" })
    ]);
  });

  it("keeps reactivated snapshot jobs when stale quarantine cleanup arrives late", async () => {
    const snapshotA = "64a000000000000000000021";
    const snapshotB = "64a000000000000000000022";
    const baseSource: AnnouncementSourceRecord = {
      ...sourceInput("university", "university-1", "source-reactivation-race"),
      sourceDefinitionVersion: "64c000000000000000000021",
      createdAt: new Date("2026-08-04T00:00:00.000Z"),
      updatedAt: new Date("2026-08-04T00:00:00.000Z")
    };
    const sourceB = { ...baseSource, activeSnapshotId: snapshotB };
    const itemB = snapshotAnnouncementItem(sourceB, snapshotB, "Reactivated snapshot B announcement");
    const referenceB = toPersistenceReference(itemB);
    if (!referenceB) throw new Error("Expected snapshot B reference.");
    const announcements = {
      findSourceById: async (id: string) => id === sourceB.id ? sourceB : null,
      findTrustedItemByIdInScope: async (input: { announcementId: string }) =>
        input.announcementId === itemB.id ? { source: sourceB, item: itemB } : null,
      acknowledgeNotificationProduction: async () => 1
    } as unknown as AnnouncementRepository;
    const notifications = new InMemoryNotificationRepository();
    const scheduler = new NotificationSchedulingService(notifications, announcements);
    const now = new Date("2026-08-04T11:00:00.000Z");

    await scheduler.syncTrustedAnnouncementSource(sourceB, {
      created: [referenceB],
      materiallyUpdated: [],
      unchanged: [],
      removed: [],
      snapshotId: snapshotB,
      previousSnapshotId: snapshotA
    }, now);
    await scheduler.syncTrustedAnnouncementSource({
      ...baseSource,
      activeSnapshotId: snapshotA,
      status: "inactive",
      trustStatus: "quarantined"
    }, {
      created: [],
      materiallyUpdated: [],
      unchanged: [],
      removed: []
    }, now);

    await expect(notifications.listDueJobs(now, 10)).resolves.toEqual([
      expect.objectContaining({
        calendarId: `announcement-source:${sourceB.id}:snapshot:${snapshotB}`,
        title: itemB.title,
        status: "scheduled"
      })
    ]);
  });

  it("fences late cleanup when the same snapshot is reactivated under a new producer generation", async () => {
    const snapshotB = "64a000000000000000000052";
    const producerGenerationA = "64d000000000000000000051";
    const producerGenerationB = "64d000000000000000000052";
    const sourceA: AnnouncementSourceRecord = {
      ...sourceInput("university", "university-1", "source-same-snapshot-reactivation"),
      sourceDefinitionVersion: "64c000000000000000000051",
      notificationProducerVersion: producerGenerationA,
      activeSnapshotId: snapshotB,
      createdAt: new Date("2026-08-04T00:00:00.000Z"),
      updatedAt: new Date("2026-08-04T00:00:00.000Z")
    };
    const sourceB = {
      ...sourceA,
      notificationProducerVersion: producerGenerationB,
      updatedAt: new Date("2026-08-04T00:01:00.000Z")
    };
    const itemB = snapshotAnnouncementItem(sourceA, snapshotB, "Same snapshot announcement");
    const referenceB = toPersistenceReference(itemB);
    if (!referenceB) throw new Error("Expected same-snapshot reference.");
    let currentSource = sourceA;
    const announcements = {
      findSourceById: async (id: string) => id === currentSource.id ? currentSource : null,
      findTrustedItemByIdInScope: async (input: { announcementId: string }) =>
        input.announcementId === itemB.id ? { source: currentSource, item: itemB } : null,
      acknowledgeNotificationProduction: async () => 1
    } as unknown as AnnouncementRepository;
    const notifications = new TargetedRetireGateNotificationRepository();
    const scheduler = new NotificationSchedulingService(notifications, announcements);
    const now = new Date("2026-08-04T11:30:00.000Z");
    const producerKeyA = `announcement-source:${sourceA.id}:generation:${producerGenerationA}:snapshot:${snapshotB}`;
    const producerKeyB = `announcement-source:${sourceB.id}:generation:${producerGenerationB}:snapshot:${snapshotB}`;

    await scheduler.syncTrustedAnnouncementSource(sourceA, {
      created: [referenceB],
      materiallyUpdated: [],
      unchanged: [],
      removed: [],
      snapshotId: snapshotB
    }, now);
    notifications.gateNextRetirement(producerKeyA);
    const staleCleanup = scheduler.syncTrustedAnnouncementSource({
      ...sourceA,
      status: "inactive",
      trustStatus: "quarantined"
    }, {
      created: [],
      materiallyUpdated: [],
      unchanged: [],
      removed: []
    }, now);
    await notifications.retirementStarted;

    currentSource = sourceB;
    await scheduler.syncTrustedAnnouncementSource(sourceB, {
      created: [],
      materiallyUpdated: [referenceB],
      unchanged: [],
      removed: [],
      snapshotId: snapshotB
    }, now);

    notifications.releaseRetirement();
    await staleCleanup;

    await expect(notifications.listDueJobs(now, 10)).resolves.toEqual([
      expect.objectContaining({
        calendarId: producerKeyB,
        producerKey: producerKeyB,
        producerKeys: [producerKeyB],
        title: itemB.title,
        status: "scheduled"
      })
    ]);
  });
});

class ResponseLossNotificationRepository extends InMemoryNotificationRepository {
  private loseResponse = true;

  override async syncProducedJobs(input: Parameters<InMemoryNotificationRepository["syncProducedJobs"]>[0]) {
    const result = await super.syncProducedJobs(input);
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error("SIMULATED_SYNC_RESPONSE_LOSS");
    }
    return result;
  }
}

class FirstSyncGateNotificationRepository extends InMemoryNotificationRepository {
  private syncCalls = 0;
  private signalFirstSyncStarted!: () => void;
  private continueFirstSync!: () => void;
  readonly firstSyncStarted = new Promise<void>((resolve) => {
    this.signalFirstSyncStarted = resolve;
  });
  private readonly firstSyncRelease = new Promise<void>((resolve) => {
    this.continueFirstSync = resolve;
  });

  releaseFirstSync(): void {
    this.continueFirstSync();
  }

  override async syncProducedJobs(input: Parameters<InMemoryNotificationRepository["syncProducedJobs"]>[0]) {
    this.syncCalls += 1;
    if (this.syncCalls === 1) {
      this.signalFirstSyncStarted();
      await this.firstSyncRelease;
    }
    return super.syncProducedJobs(input);
  }
}

class TargetedRetireGateNotificationRepository extends InMemoryNotificationRepository {
  private targetProducerKey: string | undefined;
  private didGate = false;
  private signalRetirementStarted!: () => void;
  private continueRetirement!: () => void;
  readonly retirementStarted = new Promise<void>((resolve) => {
    this.signalRetirementStarted = resolve;
  });
  private readonly retirementRelease = new Promise<void>((resolve) => {
    this.continueRetirement = resolve;
  });

  gateNextRetirement(producerKey: string): void {
    this.targetProducerKey = producerKey;
  }

  releaseRetirement(): void {
    this.continueRetirement();
  }

  override async retireProducedJobs(producerKey: string): Promise<number> {
    if (!this.didGate && producerKey === this.targetProducerKey) {
      this.didGate = true;
      this.signalRetirementStarted();
      await this.retirementRelease;
    }
    return super.retireProducedJobs(producerKey);
  }
}

class RecordingSender implements PushSender {
  readonly messages: PushMessageInput[] = [];

  async send(input: PushMessageInput) {
    this.messages.push(input);
    return { status: "sent" as const, providerMessageId: `provider-${this.messages.length}` };
  }
}

function sourceInput(scopeType: "university" | "faculty" | "department", scopeId: string, id: string) {
  return {
    id,
    scopeType,
    scopeId,
    sourceName: "Official source",
    sourceUrl: "https://www.example.edu.tr/announcements",
    homepageUrl: "https://www.example.edu.tr/",
    contentType: "announcement" as const,
    parser: "html" as const,
    priority: 10,
    status: "active" as const,
    trustStatus: "trusted" as const
  };
}

function announcementItem(source: AnnouncementSourceRecord, id: string): AnnouncementItem {
  return {
    id,
    sourceId: source.id,
    sourceName: source.sourceName,
    contentType: "announcement",
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    title: "Trusted announcement",
    summary: "Stable summary",
    link: "https://www.example.edu.tr/announcements/stable-item",
    publicationKind: "date",
    publishedDate: "2026-08-04",
    publicationTimeSource: "source",
    fetchedAt: "2026-08-04T08:00:00.000Z",
    trustStatus: "trusted"
  };
}

async function approveReviewItem(repository: InMemoryAnnouncementRepository, itemId: string) {
  const current = await repository.findReviewItemById(itemId);
  if (!current?.item.contentFingerprint) throw new Error("Expected reviewable announcement item.");
  const approved = await repository.updateReviewItem(itemId, { reviewStatus: "approved" }, {
    expectedContentFingerprint: current.item.contentFingerprint,
    ...(current.item.reviewRevision ? { expectedReviewRevision: current.item.reviewRevision } : {})
  });
  if (!approved) throw new Error("Expected approved announcement item.");
  return approved;
}

function snapshotAnnouncementItem(
  source: AnnouncementSourceRecord,
  snapshotId: string,
  title: string
): AnnouncementItem {
  const item = {
    ...announcementItem(source, "item-stable"),
    snapshotId,
    title,
    summary: `${title} summary`,
    link: "https://www.example.edu.tr/announcements/stable-item",
    canonicalUrl: "https://www.example.edu.tr/announcements/stable-item"
  };
  const reference = toPersistenceReference(item);
  if (!reference) throw new Error("Expected a valid announcement item.");
  return {
    ...item,
    contentFingerprint: reference.contentFingerprint,
    notificationEligibleFingerprint: reference.contentFingerprint
  };
}

async function registerRecipient(repository: InMemoryNotificationRepository, userId: string, category: string) {
  await repository.upsertDeviceToken({
    userId,
    platform: "android",
    token: `token-${userId}`,
    installationHash: `installation-${userId}`
  });
  await repository.upsertPreferences({
    userId,
    enabled: true,
    deliveryConsentVersion: NOTIFICATION_DELIVERY_CONSENT_VERSION,
    categories: { [category]: true },
    reminderOffsets: [0]
  });
}

function student(id: string, universityId: string, facultyId?: string): AuthUserRecord {
  const now = new Date("2026-08-04T00:00:00.000Z");
  return {
    id,
    credentialGeneration: 0,
    fullName: id,
    email: `${id}@example.test`,
    passwordHash: "not-a-real-hash",
    role: "student",
    status: "active",
    universityId,
    ...(facultyId ? { facultyId } : {}),
    createdAt: now,
    updatedAt: now
  };
}
