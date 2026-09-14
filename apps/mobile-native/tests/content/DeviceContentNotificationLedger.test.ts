import type { TrustedMobileContentRecord } from "../../src/content/content-trust";
import type { DeviceContentCacheStorage } from "../../src/content/device-content-cache";
import {
  acknowledgeDeviceContentNotifications,
  createDeviceContentNotificationLedgerKey,
  deleteDeviceContentNotificationLedger,
  findDeviceContentNotificationRecord,
  readPendingDeviceContentNotifications,
  recordDeviceContentDiscovery,
} from "../../src/content/device-content-notification-ledger";

const ownerId = "owner-1";
const initialNow = new Date("2026-09-14T12:00:00.000Z");
const source = {
  id: "source-1",
  definitionVersion: "definition-1",
  validUntil: "2026-09-16T00:00:00.000Z",
  fetchAllowed: true,
};

describe("device content notification ledger", () => {
  it("uses the first fetched snapshot as a baseline and durably retries only later discoveries", async () => {
    const storage = memoryStorage();
    const initial = record("1111111111111111", "Initial item");
    const discovered = record("2222222222222222", "Discovered item");

    await expect(recordDeviceContentDiscovery({
      ownerId,
      sources: [source],
      fetchedBySource: new Map([[source.id, [initial]]]),
      storage,
      now: initialNow,
    })).resolves.toEqual([]);

    await expect(recordDeviceContentDiscovery({
      ownerId,
      sources: [source],
      fetchedBySource: new Map([[source.id, [discovered, initial]]]),
      storage,
      now: new Date("2026-09-14T13:00:00.000Z"),
    })).resolves.toEqual([expect.objectContaining({ id: discovered.id })]);

    await expect(readPendingDeviceContentNotifications(ownerId, {
      storage,
      now: new Date("2026-09-14T13:05:00.000Z"),
    })).resolves.toEqual([expect.objectContaining({ id: discovered.id })]);

    await acknowledgeDeviceContentNotifications(ownerId, [discovered.id], {
      storage,
      now: new Date("2026-09-14T13:06:00.000Z"),
    });

    await expect(readPendingDeviceContentNotifications(ownerId, { storage, now: initialNow })).resolves.toEqual([]);
    await expect(findDeviceContentNotificationRecord(ownerId, discovered.id, { storage, now: initialNow }))
      .resolves.toEqual(expect.objectContaining({ id: discovered.id, title: discovered.title }));
    await expect(findDeviceContentNotificationRecord("owner-2", discovered.id, { storage, now: initialNow }))
      .resolves.toBeNull();
  });

  it("marks an empty bootstrap fetch as initialized so the first later item is new", async () => {
    const storage = memoryStorage();
    await recordDeviceContentDiscovery({
      ownerId,
      sources: [source],
      fetchedBySource: new Map([[source.id, []]]),
      storage,
      now: initialNow,
    });

    const firstLaterItem = record("3333333333333333", "First later item");
    await expect(recordDeviceContentDiscovery({
      ownerId,
      sources: [source],
      fetchedBySource: new Map([[source.id, [firstLaterItem]]]),
      storage,
      now: new Date("2026-09-14T13:00:00.000Z"),
    })).resolves.toEqual([expect.objectContaining({ id: firstLaterItem.id })]);
  });

  it("serializes owner writes so overlapping refreshes do not lose pending records", async () => {
    const storage = memoryStorage();
    const baseline = record("aaaaaaaaaaaaaaaa", "Baseline");
    const first = record("bbbbbbbbbbbbbbbb", "First concurrent item");
    const second = record("cccccccccccccccc", "Second concurrent item");
    await recordDeviceContentDiscovery({ ownerId, sources: [source], fetchedBySource: new Map([[source.id, [baseline]]]), storage, now: initialNow });

    await Promise.all([
      recordDeviceContentDiscovery({ ownerId, sources: [source], fetchedBySource: new Map([[source.id, [first, baseline]]]), storage, now: new Date("2026-09-14T12:01:00.000Z") }),
      recordDeviceContentDiscovery({ ownerId, sources: [source], fetchedBySource: new Map([[source.id, [second, first, baseline]]]), storage, now: new Date("2026-09-14T12:01:01.000Z") }),
    ]);

    await expect(readPendingDeviceContentNotifications(ownerId, { storage, now: initialNow })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id }),
      expect.objectContaining({ id: second.id }),
    ]));
  });

  it("drops pending delivery when the backend blocks fetching but keeps delivered archive taps lease-bound", async () => {
    const storage = memoryStorage();
    const baseline = record("5555555555555555", "Baseline item");
    const archived = record("6666666666666666", "Archived item");
    const pending = record("7777777777777777", "Pending item");
    await recordDeviceContentDiscovery({ ownerId, sources: [source], fetchedBySource: new Map([[source.id, [baseline]]]), storage, now: initialNow });
    await recordDeviceContentDiscovery({ ownerId, sources: [source], fetchedBySource: new Map([[source.id, [archived, baseline]]]), storage, now: new Date("2026-09-14T12:01:00.000Z") });
    await acknowledgeDeviceContentNotifications(ownerId, [archived.id], { storage, now: new Date("2026-09-14T12:02:00.000Z") });
    await recordDeviceContentDiscovery({ ownerId, sources: [source], fetchedBySource: new Map([[source.id, [pending, archived, baseline]]]), storage, now: new Date("2026-09-14T12:02:30.000Z") });

    await expect(recordDeviceContentDiscovery({
      ownerId,
      sources: [{ ...source, fetchAllowed: false }],
      fetchedBySource: new Map(),
      storage,
      now: new Date("2026-09-14T12:03:00.000Z"),
    })).resolves.toEqual([]);
    await expect(readPendingDeviceContentNotifications(ownerId, { storage, now: initialNow })).resolves.toEqual([]);
    await expect(findDeviceContentNotificationRecord(ownerId, archived.id, { storage, now: initialNow }))
      .resolves.toEqual(expect.objectContaining({ id: archived.id }));
  });

  it("fails closed on corrupt, expired, and explicitly deleted owner data", async () => {
    const storage = memoryStorage();
    const key = createDeviceContentNotificationLedgerKey(ownerId);
    storage.values.set(key, JSON.stringify({ schemaVersion: 1, ownerId, pending: "not-an-array" }));

    await expect(readPendingDeviceContentNotifications(ownerId, { storage, now: initialNow })).resolves.toEqual([]);
    expect(storage.values.has(key)).toBe(false);

    const baseline = record("8888888888888888", "Safe baseline");
    const unsafe = record("9999999999999999", "Tampered item");
    await recordDeviceContentDiscovery({ ownerId, sources: [source], fetchedBySource: new Map([[source.id, [baseline]]]), storage, now: initialNow });
    await recordDeviceContentDiscovery({ ownerId, sources: [source], fetchedBySource: new Map([[source.id, [unsafe, baseline]]]), storage, now: new Date("2026-09-14T12:00:30.000Z") });
    const tampered = JSON.parse(storage.values.get(key) ?? "null") as { pending?: Array<{ canonicalUrl?: string }> };
    if (tampered.pending?.[0]) tampered.pending[0].canonicalUrl = "javascript:alert(1)";
    storage.values.set(key, JSON.stringify(tampered));
    await expect(findDeviceContentNotificationRecord(ownerId, unsafe.id, { storage, now: initialNow })).resolves.toBeNull();
    expect(storage.values.has(key)).toBe(false);

    const item = record("4444444444444444", "Lease item");
    await recordDeviceContentDiscovery({
      ownerId,
      sources: [{ ...source, validUntil: "2026-09-14T12:05:00.000Z" }],
      fetchedBySource: new Map([[source.id, []]]),
      storage,
      now: initialNow,
    });
    await recordDeviceContentDiscovery({
      ownerId,
      sources: [{ ...source, validUntil: "2026-09-14T12:05:00.000Z" }],
      fetchedBySource: new Map([[source.id, [item]]]),
      storage,
      now: new Date("2026-09-14T12:01:00.000Z"),
    });
    await expect(findDeviceContentNotificationRecord(ownerId, item.id, {
      storage,
      now: new Date("2026-09-14T12:06:00.000Z"),
    })).resolves.toBeNull();

    await deleteDeviceContentNotificationLedger(ownerId, storage);
    expect(storage.values.has(key)).toBe(false);
  });
});

function memoryStorage(): DeviceContentCacheStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
}

function record(token: string, title: string): TrustedMobileContentRecord {
  const canonicalUrl = `https://example.edu.tr/announcements/${token}`;
  return {
    id: `device-${source.id}-${token}`,
    sourceId: source.id,
    sourceName: "Example University announcements",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    title,
    link: canonicalUrl,
    canonicalUrl,
    canonicalUrlAliases: [],
    officialSourceUrl: "https://example.edu.tr/announcements",
    sourceRelationships: [{
      sourceId: source.id,
      sourceName: "Example University announcements",
      officialSourceUrl: "https://example.edu.tr/announcements",
      scopeType: "university",
      scopeId: "university-1",
      canonicalUrl,
    }],
    freshness: "fresh",
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
  };
}
