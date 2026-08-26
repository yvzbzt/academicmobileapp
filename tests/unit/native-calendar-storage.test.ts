import { beforeEach, describe, expect, it, vi } from "vitest";
import { createManagedEventMarker } from "../../apps/mobile-native/src/native-calendar/managed-event";
import { NativeCalendarStorageError } from "../../apps/mobile-native/src/native-calendar/native-calendar-error";
import { createSecureNativeCalendarStorage } from "../../apps/mobile-native/src/native-calendar/secure-calendar-storage";
import {
  createLegacyNativeCalendarStorageKey,
  createNativeCalendarMigrationKey,
  createNativeCalendarRecoveryKey,
  createNativeCalendarStorageKey
} from "../../apps/mobile-native/src/native-calendar/storage-key";
import {
  deserializeNativeCalendarStoredState,
  parseNativeCalendarStoredState,
  serializeNativeCalendarStoredState
} from "../../apps/mobile-native/src/native-calendar/storage-schema";
import type {
  NativeCalendarEventMapping,
  NativeCalendarStoredState
} from "../../apps/mobile-native/src/native-calendar/types";

const storageIdentity = {
  userId: "user-1",
  platform: "ios",
  deviceId: "device-1"
} as const;
const asyncValues = new Map<string, string>();
const secureValues = new Map<string, string>();
const asyncStorageMock = {
  getItem: vi.fn(async (key: string) => asyncValues.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => {
    asyncValues.set(key, value);
  }),
  removeItem: vi.fn(async (key: string) => {
    asyncValues.delete(key);
  })
};
const secureStoreMock = {
  getItemAsync: vi.fn(async (key: string) => secureValues.get(key) ?? null),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureValues.delete(key);
  })
};

describe("native calendar scalable storage", () => {
  beforeEach(() => {
    asyncValues.clear();
    secureValues.clear();
    vi.clearAllMocks();
    asyncStorageMock.getItem.mockImplementation(async (key: string) => asyncValues.get(key) ?? null);
    asyncStorageMock.setItem.mockImplementation(async (key: string, value: string) => {
      asyncValues.set(key, value);
    });
    asyncStorageMock.removeItem.mockImplementation(async (key: string) => {
      asyncValues.delete(key);
    });
    secureStoreMock.getItemAsync.mockImplementation(async (key: string) => secureValues.get(key) ?? null);
    secureStoreMock.deleteItemAsync.mockImplementation(async (key: string) => {
      secureValues.delete(key);
    });
  });

  it("round-trips a validated versioned envelope", () => {
    const state = validState();
    const serialized = serializeNativeCalendarStoredState(state);

    expect(JSON.parse(serialized)).toMatchObject({ version: 3 });
    expect(deserializeNativeCalendarStoredState(serialized)).toEqual(state);
  });

  it("migrates a valid unversioned v2 shape and defaults the conflict count", () => {
    const state = validState();
    const legacy = {
      ...state,
      integration: {
        ...state.integration,
        schemaVersion: undefined,
        lastSyncResult: {
          created: 1,
          updated: 0,
          skipped: 0,
          deleted: 0,
          recovered: 0,
          failed: 0
        }
      }
    };

    const parsed = parseNativeCalendarStoredState(legacy);

    expect(parsed.integration?.schemaVersion).toBe(3);
    expect(parsed.integration?.lastSyncResult?.conflicted).toBe(0);
    expect(Object.keys(parsed.mappings)).toEqual(["mapping"]);
  });

  it("keeps the tolerant parser for inspection while strict persistence rejects malformed records", () => {
    const state = validState();
    const malformed = {
      version: 3,
      state: {
        integration: { enabled: "yes" },
        mappings: {
          malformed: { appEventId: "a" },
          mismatch: {
            ...state.mappings.mapping,
            sourceId: "different"
          },
          valid: state.mappings.mapping
        }
      }
    };

    expect(Object.keys(parseNativeCalendarStoredState(malformed).mappings)).toEqual(["valid"]);
    expect(() => deserializeNativeCalendarStoredState(JSON.stringify(malformed))).toThrowError(
      NativeCalendarStorageError
    );
  });

  it("distinguishes corrupt JSON and unsupported versions", () => {
    expectStorageError(() => deserializeNativeCalendarStoredState("{not-json"), "corrupt");
    expectStorageError(
      () => deserializeNativeCalendarStoredState(JSON.stringify({ version: 99, state: { mappings: {} } })),
      "unsupported_version"
    );
  });

  it("returns an empty state only when AsyncStorage and both SecureStore keys are missing", async () => {
    await expect(createTestStorage().loadState(storageIdentity)).resolves.toEqual({ mappings: {} });

    expect(asyncStorageMock.getItem).toHaveBeenCalledWith(createNativeCalendarStorageKey(storageIdentity));
    expect(secureStoreMock.getItemAsync).toHaveBeenCalledTimes(2);
    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("surfaces AsyncStorage read failures without deleting metadata", async () => {
    asyncStorageMock.getItem.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(createTestStorage().loadState(storageIdentity)).rejects.toMatchObject({ code: "read_failed" });
    expect(asyncStorageMock.removeItem).not.toHaveBeenCalled();
    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("surfaces corrupt AsyncStorage metadata without falling back to SecureStore", async () => {
    asyncValues.set(createNativeCalendarStorageKey(storageIdentity), "{not-json");
    secureValues.set(createLegacyNativeCalendarStorageKey(storageIdentity), serializeNativeCalendarStoredState(validState()));

    await expect(createTestStorage().loadState(storageIdentity)).rejects.toMatchObject({ code: "corrupt" });
    expect(secureStoreMock.getItemAsync).not.toHaveBeenCalled();
    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("stores payloads larger than SecureStore's value limit only in AsyncStorage", async () => {
    const storage = createTestStorage();
    const state = largeState();
    const serialized = serializeNativeCalendarStoredState(state);
    expect(new TextEncoder().encode(serialized).byteLength).toBeGreaterThan(2_048);

    await storage.saveState(storageIdentity, state);

    expect(asyncValues.get(createNativeCalendarStorageKey(storageIdentity))).toBe(serialized);
    expect(secureStoreMock.getItemAsync).not.toHaveBeenCalled();
    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
    await expect(storage.loadState(storageIdentity)).resolves.toEqual(state);
  });

  it.each([
    ["v3", createNativeCalendarStorageKey(storageIdentity)],
    ["v2", createLegacyNativeCalendarStorageKey(storageIdentity)]
  ])("migrates SecureStore %s only after an AsyncStorage write is verified", async (_label, legacyKey) => {
    const storageKey = createNativeCalendarStorageKey(storageIdentity);
    const serialized = serializeNativeCalendarStoredState(validState());
    secureValues.set(legacyKey, serialized);
    secureStoreMock.deleteItemAsync.mockImplementation(async (key: string) => {
      expect(asyncValues.get(storageKey)).toBe(serialized);
      secureValues.delete(key);
    });

    await expect(createTestStorage().loadState(storageIdentity)).resolves.toEqual(validState());

    expect(asyncValues.get(storageKey)).toBe(serialized);
    expect(asyncValues.has(createNativeCalendarMigrationKey(storageIdentity))).toBe(false);
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(createNativeCalendarStorageKey(storageIdentity));
    expect(secureStoreMock.deleteItemAsync).toHaveBeenCalledWith(createLegacyNativeCalendarStorageKey(storageIdentity));
  });

  it("retains SecureStore metadata when the AsyncStorage migration write fails", async () => {
    const storageKey = createNativeCalendarStorageKey(storageIdentity);
    const serialized = serializeNativeCalendarStoredState(validState());
    secureValues.set(storageKey, serialized);
    asyncStorageMock.setItem.mockImplementation(async (key: string, value: string) => {
      if (key === storageKey) throw new Error("disk full");
      asyncValues.set(key, value);
    });

    await expect(createTestStorage().loadState(storageIdentity)).rejects.toMatchObject({ code: "write_failed" });

    expect(secureValues.get(storageKey)).toBe(serialized);
    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
    expect(asyncValues.has(createNativeCalendarMigrationKey(storageIdentity))).toBe(true);
  });

  it("quarantines corrupt raw metadata before installing an empty state", async () => {
    const storageKey = createNativeCalendarStorageKey(storageIdentity);
    asyncValues.set(storageKey, "{not-json");

    const result = await createTestStorage().quarantineAndResetCorruptState(storageIdentity);

    expect(result).toMatchObject({
      quarantinedAt: "2026-08-26T12:00:00.000Z",
      quarantinedSources: ["async_storage"],
      resumed: false
    });
    expect(JSON.parse(asyncValues.get(result.quarantineKey)!)).toMatchObject({
      version: 1,
      sources: [{ source: "async_storage", key: storageKey, value: "{not-json" }]
    });
    expect(deserializeNativeCalendarStoredState(asyncValues.get(storageKey)!)).toEqual({ mappings: {} });
    expect(asyncValues.has(createNativeCalendarRecoveryKey(storageIdentity))).toBe(false);
    await expect(createTestStorage().loadState(storageIdentity)).resolves.toEqual({ mappings: {} });
  });

  it("refuses explicit recovery when active metadata is valid", async () => {
    const storage = createTestStorage();
    await storage.saveState(storageIdentity, validState());

    await expect(storage.quarantineAndResetCorruptState(storageIdentity)).rejects.toMatchObject({
      code: "recovery_not_required"
    });
    await expect(storage.loadState(storageIdentity)).resolves.toEqual(validState());
  });

  it("leaves corrupt metadata active when quarantine cannot be persisted", async () => {
    const storageKey = createNativeCalendarStorageKey(storageIdentity);
    asyncValues.set(storageKey, "{not-json");
    asyncStorageMock.setItem.mockImplementation(async (key: string, value: string) => {
      if (key.includes("native_calendar_quarantine_v1")) throw new Error("disk full");
      asyncValues.set(key, value);
    });

    await expect(createTestStorage().quarantineAndResetCorruptState(storageIdentity)).rejects.toMatchObject({
      code: "quarantine_failed"
    });
    expect(asyncValues.get(storageKey)).toBe("{not-json");
    expect(secureStoreMock.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("blocks normal access and resumes an interrupted metadata-only recovery", async () => {
    const storageKey = createNativeCalendarStorageKey(storageIdentity);
    asyncValues.set(storageKey, "{not-json");
    secureValues.set(createLegacyNativeCalendarStorageKey(storageIdentity), "{legacy-corrupt");
    secureStoreMock.deleteItemAsync.mockRejectedValueOnce(new Error("keychain busy"));
    const storage = createTestStorage();

    await expect(storage.quarantineAndResetCorruptState(storageIdentity)).rejects.toMatchObject({
      code: "delete_failed"
    });
    await expect(storage.loadState(storageIdentity)).rejects.toMatchObject({ code: "recovery_incomplete" });

    const result = await storage.quarantineAndResetCorruptState(storageIdentity);

    expect(result.resumed).toBe(true);
    expect(result.quarantinedSources).toEqual(["async_storage", "secure_store_v2"]);
    expect(secureValues.size).toBe(0);
    await expect(storage.loadState(storageIdentity)).resolves.toEqual({ mappings: {} });
  });

  it("serializes recovery with a concurrent save so the newer valid state wins", async () => {
    const storageKey = createNativeCalendarStorageKey(storageIdentity);
    asyncValues.set(storageKey, "{not-json");
    let notifyQuarantineStarted!: () => void;
    let releaseQuarantine!: () => void;
    const quarantineStarted = new Promise<void>((resolve) => {
      notifyQuarantineStarted = resolve;
    });
    const quarantineReleased = new Promise<void>((resolve) => {
      releaseQuarantine = resolve;
    });
    asyncStorageMock.setItem.mockImplementation(async (key: string, value: string) => {
      if (key.includes("native_calendar_quarantine_v1")) {
        notifyQuarantineStarted();
        await quarantineReleased;
      }
      asyncValues.set(key, value);
    });
    const storage = createTestStorage();

    const recovery = storage.quarantineAndResetCorruptState(storageIdentity);
    await quarantineStarted;
    const save = storage.saveState(storageIdentity, validState());
    releaseQuarantine();
    await recovery;
    await save;

    await expect(storage.loadState(storageIdentity)).resolves.toEqual(validState());
  });
});

function createTestStorage() {
  return createSecureNativeCalendarStorage({
    platform: "ios",
    asyncStorage: asyncStorageMock,
    secureStore: secureStoreMock,
    now: () => new Date("2026-08-26T12:00:00.000Z")
  });
}

function expectStorageError(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error("Expected native calendar storage error.");
  } catch (error) {
    expect(error).toBeInstanceOf(NativeCalendarStorageError);
    expect(error).toMatchObject({ code });
  }
}

function largeState(): NativeCalendarStoredState {
  const state = validState();
  const mappings: Record<string, NativeCalendarEventMapping> = {};
  for (let index = 0; index < 4; index += 1) {
    const sourceId = `event-${index}-${"x".repeat(180)}`;
    const marker = createManagedEventMarker("user-1", {
      id: `academic:${sourceId}`,
      sourceId,
      sourceType: "academic_event"
    });
    mappings[`mapping-${index}`] = {
      ...state.mappings.mapping!,
      appEventId: `academic:${sourceId}`,
      sourceId,
      nativeEventId: `native-${index}`,
      managedMarker: marker
    };
  }
  return { ...state, mappings };
}

function validState(): NativeCalendarStoredState {
  const marker = createManagedEventMarker("user-1", {
    id: "academic:a",
    sourceId: "a",
    sourceType: "academic_event"
  });
  return {
    integration: {
      schemaVersion: 3,
      enabled: true,
      platform: "ios",
      userId: "user-1",
      deviceId: "device-1",
      deviceCalendarId: "calendar-1",
      deviceCalendarTitle: "Akademik Takvim",
      deviceCalendarIds: ["calendar-1"],
      deviceCalendars: [{
        id: "calendar-1",
        title: "Akademik Takvim",
        provider: "apple",
        isAppCalendar: true
      }],
      autoSyncEnabled: false,
      reminderMinutesBefore: [],
      connectedAt: "2026-07-07T12:00:00.000Z",
      updatedAt: "2026-07-07T12:00:00.000Z"
    },
    mappings: {
      mapping: {
        appEventId: "academic:a",
        sourceId: "a",
        sourceType: "academic_event",
        nativeEventId: "native-1",
        deviceCalendarId: "calendar-1",
        managedMarker: marker,
        eventHash: "source-hash",
        appliedEventHash: "payload-hash",
        status: "managed",
        lastKnownStartDate: "2026-08-01",
        lastKnownEndDate: "2026-08-02",
        lastKnownAllDay: true,
        lastKnownTimezone: "Europe/Istanbul",
        lastKnownModifiedDate: "2026-07-07T12:00:00.000Z",
        lastSyncedAt: "2026-07-07T12:00:00.000Z"
      }
    }
  };
}
