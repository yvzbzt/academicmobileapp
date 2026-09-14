import {
  createDeviceSavedContentKey,
  deleteDeviceSavedContent,
  isDeviceContentRecordId,
  isDeviceContentSaved,
  setDeviceContentSaved,
  type DeviceSavedContentStorage,
} from "../../src/content/device-saved-content";

function memoryStorage(): DeviceSavedContentStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async (key) => { values.delete(key); },
  };
}

describe("device saved content", () => {
  const ownerId = "owner-1";
  const firstId = "device-source-1-0123456789abcdef";
  const secondId = "device-source-2-fedcba9876543210";

  it("recognizes only bounded deterministic device record identifiers", () => {
    expect(isDeviceContentRecordId(firstId)).toBe(true);
    expect(isDeviceContentRecordId("backend-record")) .toBe(false);
    expect(isDeviceContentRecordId("device-source-1-not-a-digest")).toBe(false);
    expect(isDeviceContentRecordId(`device-${"x".repeat(513)}-0123456789abcdef`)).toBe(false);
  });

  it("persists owner-scoped saved state and removes empty storage", async () => {
    const storage = memoryStorage();
    await setDeviceContentSaved(ownerId, firstId, true, storage);
    await setDeviceContentSaved(ownerId, secondId, true, storage);
    expect(await isDeviceContentSaved(ownerId, firstId, storage)).toBe(true);
    expect(await isDeviceContentSaved("owner-2", firstId, storage)).toBe(false);

    await setDeviceContentSaved(ownerId, firstId, false, storage);
    expect(await isDeviceContentSaved(ownerId, firstId, storage)).toBe(false);
    expect(await isDeviceContentSaved(ownerId, secondId, storage)).toBe(true);
    await setDeviceContentSaved(ownerId, secondId, false, storage);
    expect(storage.values.has(createDeviceSavedContentKey(ownerId))).toBe(false);
  });

  it("fails closed and deletes malformed persisted state", async () => {
    const storage = memoryStorage();
    storage.values.set(createDeviceSavedContentKey(ownerId), JSON.stringify({
      schemaVersion: 1,
      ownerId,
      ids: ["backend-record"],
    }));
    expect(await isDeviceContentSaved(ownerId, firstId, storage)).toBe(false);
    expect(storage.values.has(createDeviceSavedContentKey(ownerId))).toBe(false);
  });

  it("deletes all saved state for the exact owner", async () => {
    const storage = memoryStorage();
    await setDeviceContentSaved(ownerId, firstId, true, storage);
    await setDeviceContentSaved("owner-2", secondId, true, storage);
    await deleteDeviceSavedContent(ownerId, storage);
    expect(await isDeviceContentSaved(ownerId, firstId, storage)).toBe(false);
    expect(await isDeviceContentSaved("owner-2", secondId, storage)).toBe(true);
  });
});
