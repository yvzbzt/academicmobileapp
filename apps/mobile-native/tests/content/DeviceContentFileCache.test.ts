jest.mock("expo-file-system/legacy", () => {
  const files = new Map<string, string>();
  return {
    cacheDirectory: "file:///private-cache/",
    __files: files,
    getInfoAsync: jest.fn(async (uri: string) => files.has(uri)
      ? { exists: true, size: Buffer.byteLength(files.get(uri)!) }
      : { exists: false }),
    readAsStringAsync: jest.fn(async (uri: string) => files.get(uri)),
    writeAsStringAsync: jest.fn(async (uri: string, value: string) => { files.set(uri, value); }),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
    deleteAsync: jest.fn(async (uri: string) => { files.delete(uri); }),
  };
});
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => (
    require("crypto").createHash("sha256").update(value).digest("hex")
  )),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import {
  createDeviceContentCacheKey,
  deleteDeviceContentCache,
  readDeviceContentCache,
  writeDeviceContentCache,
  type DeviceContentCacheRecord,
} from "../../src/content/device-content-cache";
import { normalizeTrustedContentCollection } from "../../src/content/content-trust";
import { createDeviceContentNotificationLedgerKey, recordDeviceContentDiscovery } from "../../src/content/device-content-notification-ledger";

const now = new Date("2026-09-15T12:00:00.000Z");
const files = (FileSystem as unknown as { __files: Map<string, string> }).__files;

function cacheRecord(itemCount = 1, largeBody = false): DeviceContentCacheRecord {
  const items = normalizeTrustedContentCollection(Array.from({ length: itemCount }, (_, index) => {
    const sourceId = `source-${Math.floor(index / 60)}`;
    const url = `https://example.edu.tr/item-${index}`;
    return {
      id: `device-${sourceId}-${index}`,
      sourceId,
      sourceName: "Example University",
      scopeType: "university",
      scopeId: "university-1",
      contentType: "announcement",
      title: `Announcement ${index}`,
      link: url,
      canonicalUrl: url,
      officialSourceUrl: "https://example.edu.tr/announcements",
      sourceRelationships: [{ sourceId, sourceName: "Example University", scopeType: "university", scopeId: "university-1", canonicalUrl: url, officialSourceUrl: "https://example.edu.tr/announcements" }],
      ...(largeBody ? { body: Array.from({ length: 48 }, () => ({ type: "paragraph" as const, text: "a".repeat(800) })) } : {}),
      freshness: "fresh",
      trustStatus: "trusted",
      sourceStatus: "active",
      sourceTrustStatus: "trusted",
    };
  })).items;
  const sourceIds = [...new Set(items.map((item) => item.sourceId))];
  return {
    ownerId: "owner-1",
    manifestVersion: "b".repeat(64),
    revalidateAfter: "2026-09-15T12:30:00.000Z",
    snapshotIncomplete: false,
    sourceRevisions: Object.fromEntries(sourceIds.map((id) => [id, `definition-1:${"a".repeat(64)}`])),
    sourceValidUntil: Object.fromEntries(sourceIds.map((id) => [id, "2026-09-16T12:00:00.000Z"])),
    failedSourceIds: [],
    items,
    storedAt: now.toISOString(),
  };
}

describe("private device content file cache", () => {
  beforeEach(async () => {
    files.clear();
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it("keeps a snapshot larger than the entire Android SQLite budget outside AsyncStorage", async () => {
    const record = cacheRecord(540, true);
    expect(JSON.stringify(record).length).toBeGreaterThan(6 * 1_024 * 1_024);
    await writeDeviceContentCache(record);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(files.size).toBe(1);
    expect([...files.keys()][0]).toMatch(/^file:\/\/\/private-cache\/device-content-[a-f\d]{64}\.json$/u);
    const cached = await readDeviceContentCache("owner-1", { now });
    expect(cached?.items).toHaveLength(540);
    expect(cached?.snapshotIncomplete).toBe(false);
    await expect(readDeviceContentCache("owner-2", { now })).resolves.toBeNull();
    await deleteDeviceContentCache("owner-1");
    expect(files.size).toBe(0);
    await expect(readDeviceContentCache("owner-1", { now })).resolves.toBeNull();
  });

  it("invalidates populated v3 snapshots once without clearing the separate notification ledger", async () => {
    const record = cacheRecord();
    await recordDeviceContentDiscovery({
      ownerId: record.ownerId, now,
      sources: [{ id: "source-0", definitionVersion: "definition-1", validUntil: record.sourceValidUntil["source-0"]!, fetchAllowed: true }],
      fetchedBySource: new Map([["source-0", record.items]]),
    });
    const ledgerKey = createDeviceContentNotificationLedgerKey(record.ownerId);
    const ledgerBefore = await AsyncStorage.getItem(ledgerKey);
    expect(ledgerBefore).not.toBeNull();
    await writeDeviceContentCache(record);
    const filename = [...files.keys()][0]!;
    files.set(filename, JSON.stringify({ schemaVersion: 3, ...record }));
    await expect(readDeviceContentCache(record.ownerId, { now })).resolves.toBeNull();
    expect(files.has(filename)).toBe(false);
    expect(await AsyncStorage.getItem(ledgerKey)).toBe(ledgerBefore);
    await writeDeviceContentCache(record);
    expect(JSON.parse(files.get(filename)!).schemaVersion).toBe(4);
    await expect(readDeviceContentCache(record.ownerId, { now })).resolves.toEqual(record);
    expect(await AsyncStorage.getItem(ledgerKey)).toBe(ledgerBefore);
  });

  it("migrates a current-schema owner cache only after a file write succeeds", async () => {
    const record = cacheRecord();
    const key = createDeviceContentCacheKey("owner-1");
    await AsyncStorage.setItem(key, JSON.stringify({ schemaVersion: 4, ...record }));
    await expect(readDeviceContentCache("owner-1", { now })).resolves.toMatchObject({ items: record.items });
    jest.mocked(FileSystem.writeAsStringAsync).mockRejectedValueOnce(new Error("disk full"));
    await expect(writeDeviceContentCache(record)).rejects.toThrow("disk full");
    expect(files.size).toBe(0);
    expect(await AsyncStorage.getItem(key)).not.toBeNull();
    await writeDeviceContentCache(record);
    expect(await AsyncStorage.getItem(key)).toBeNull();
    const replacement = cacheRecord(2);
    jest.mocked(FileSystem.writeAsStringAsync).mockRejectedValueOnce(new Error("disk full"));
    await expect(writeDeviceContentCache(replacement)).rejects.toThrow("disk full");
    expect(files.size).toBe(1);
    await expect(readDeviceContentCache("owner-1", { now })).resolves.toMatchObject({ items: record.items });
  });

  it("keeps lease expiry fail-closed and bounds each source independently", async () => {
    const record = cacheRecord(61);
    record.items[60] = { ...record.items[60]!, sourceId: "source-0" };
    await expect(writeDeviceContentCache(record)).rejects.toThrow("DEVICE_CONTENT_CACHE_INVALID");
    await writeDeviceContentCache(cacheRecord());
    const expired = await readDeviceContentCache("owner-1", { now: new Date("2026-09-16T13:00:00.000Z") });
    expect(expired?.items).toEqual([]);
    expect(expired?.sourceRevisions).toEqual({});
  });
});
