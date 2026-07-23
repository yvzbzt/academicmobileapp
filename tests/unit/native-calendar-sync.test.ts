import { describe, expect, it } from "vitest";
import { NativeCalendarService, createEventFingerprint } from "../../apps/mobile-native/src/native-calendar/native-calendar-sync";
import { createNativeCalendarStorageKey } from "../../apps/mobile-native/src/native-calendar/storage-key";
import type {
  NativeCalendarDeviceAdapter,
  NativeCalendarPermissionState,
  NativeCalendarStorage,
  NativeCalendarStoredState,
  NativeCalendarSyncEvent,
  NativeCalendarWritableCalendar
} from "../../apps/mobile-native/src/native-calendar/types";

const context = { userId: "user-1", platform: "ios" as const, deviceId: "device-1" };

describe("NativeCalendarService", () => {
  it("does not connect when permission is denied", async () => {
    const adapter = new MemoryCalendarAdapter();
    adapter.permission = { status: "denied", canAskAgain: false, granted: false };
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);

    const state = await service.connect(context);

    expect(state.integration).toBeUndefined();
    expect(await storage.loadState(context)).toEqual({ mappings: {} });
  });

  it("creates events once and skips unchanged events on the next sync", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);

    const first = await service.syncEvents({ ...context, events: [event("a"), event("b")] });
    const second = await service.syncEvents({ ...context, events: [event("a"), event("b")] });

    expect(first.created).toBe(2);
    expect(second.skipped).toBe(2);
    expect(adapter.createdEventCount).toBe(2);
    expect(adapter.events.size).toBe(2);
  });

  it("updates an existing native event when the deterministic event hash changes", async () => {
    const adapter = new MemoryCalendarAdapter();
    const service = createService(adapter, new MemoryCalendarStorage());
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });

    const updated = await service.syncEvents({ ...context, events: [{ ...event("a"), title: "Updated title" }] });

    expect(updated.updated).toBe(1);
    expect(adapter.createdEventCount).toBe(1);
    expect([...adapter.events.values()][0]?.title).toBe("Updated title");
  });

  it("recreates a missing native event without duplicating stored mappings", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });
    adapter.events.clear();

    const recovered = await service.syncEvents({ ...context, events: [event("a")] });
    const state = await storage.loadState(context);

    expect(recovered.recovered).toBe(1);
    expect(Object.values(state.mappings).map((mapping) => mapping.appEventId)).toEqual(["a"]);
    expect(adapter.events.size).toBe(1);
  });

  it("deletes stale native events when source events disappear", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a"), event("b")] });

    const synced = await service.syncEvents({ ...context, events: [event("a")] });
    const state = await storage.loadState(context);

    expect(synced.deleted).toBe(1);
    expect(Object.values(state.mappings).map((mapping) => mapping.appEventId)).toEqual(["a"]);
    expect(adapter.events.size).toBe(1);
  });

  it("moves mapped events to a newly selected calendar by recreating them", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });

    await service.updateSettings({ ...context, selectedCalendarId: "calendar-2" });
    const synced = await service.syncEvents({ ...context, events: [event("a")] });
    const state = await storage.loadState(context);

    expect(synced.created).toBe(1);
    expect(synced.deleted).toBe(1);
    expect(adapter.createdEventCount).toBe(2);
    expect(Object.values(state.mappings)[0]?.deviceCalendarId).toBe("calendar-2");
    expect([...adapter.events.values()][0]?.calendarId).toBe("calendar-2");
  });

  it("syncs each event to multiple selected device calendars", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);

    const connected = await service.connect({ ...context, selectedCalendarIds: ["calendar-1", "calendar-2"] });
    const synced = await service.syncEvents({ ...context, events: [event("a")] });
    const state = await storage.loadState(context);

    expect(connected.integration?.deviceCalendarIds).toEqual(["calendar-1", "calendar-2"]);
    expect(synced.created).toBe(2);
    expect(Object.values(state.mappings).map((mapping) => mapping.deviceCalendarId).sort()).toEqual([
      "calendar-1",
      "calendar-2"
    ]);
    expect(adapter.events.size).toBe(2);
  });

  it("disconnects and removes native events when requested", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a"), event("b")] });

    const result = await service.disconnect({ ...context, removeNativeEvents: true });
    const state = await storage.loadState(context);

    expect(result.deleted).toBe(2);
    expect(state).toEqual({ mappings: {} });
    expect(adapter.events.size).toBe(0);
  });

  it("fingerprints equivalent reminder arrays deterministically", () => {
    expect(createEventFingerprint({ ...event("a"), reminderMinutesBefore: [60, 0] })).toBe(
      createEventFingerprint({ ...event("a"), reminderMinutesBefore: [0, 60] })
    );
  });

  it("creates a SecureStore-compatible persistence key", () => {
    const key = createNativeCalendarStorageKey({
      userId: "user:1@example.com",
      platform: "android",
      deviceId: "device/with spaces"
    });

    expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(key).not.toContain(":");
    expect(key).not.toContain("/");
    expect(key).not.toContain(" ");
  });
});

function createService(adapter: MemoryCalendarAdapter, storage: MemoryCalendarStorage): NativeCalendarService {
  return new NativeCalendarService(adapter, storage, () => new Date("2026-07-07T12:00:00.000Z"));
}

function event(id: string): NativeCalendarSyncEvent {
  return {
    id,
    title: `Event ${id}`,
    startDate: "2026-08-01T09:00:00.000Z",
    endDate: "2026-08-01T10:00:00.000Z",
    allDay: false,
    timezone: "Europe/Istanbul",
    notes: "Academic event",
    reminderMinutesBefore: [60]
  };
}

class MemoryCalendarStorage implements NativeCalendarStorage {
  private state: NativeCalendarStoredState = { mappings: {} };

  async loadState(): Promise<NativeCalendarStoredState> {
    return structuredClone(this.state);
  }

  async saveState(_key: unknown, state: NativeCalendarStoredState): Promise<void> {
    this.state = structuredClone(state);
  }

  async clearState(): Promise<void> {
    this.state = { mappings: {} };
  }
}

class MemoryCalendarAdapter implements NativeCalendarDeviceAdapter {
  permission: NativeCalendarPermissionState = { status: "authorized", canAskAgain: true, granted: true };
  calendars: NativeCalendarWritableCalendar[] = [
    { id: "calendar-1", title: "Academic Mobile App", provider: "device", allowsModifications: true, isAppCalendar: true },
    { id: "calendar-2", title: "Personal", provider: "google", allowsModifications: true }
  ];
  events = new Map<string, NativeCalendarSyncEvent & { id: string; calendarId: string }>();
  createdEventCount = 0;
  private sequence = 0;

  async getPermissionStatus(): Promise<NativeCalendarPermissionState> {
    return this.permission;
  }

  async requestPermission(): Promise<NativeCalendarPermissionState> {
    return this.permission;
  }

  async listWritableCalendars(): Promise<NativeCalendarWritableCalendar[]> {
    return this.calendars;
  }

  async getOrCreateAppCalendar(): Promise<NativeCalendarWritableCalendar> {
    return this.calendars[0]!;
  }

  async createEvent(calendarId: string, syncEvent: NativeCalendarSyncEvent): Promise<string> {
    this.sequence += 1;
    this.createdEventCount += 1;
    const nativeEventId = `native-${this.sequence}`;
    this.events.set(nativeEventId, { ...syncEvent, id: nativeEventId, calendarId });
    return nativeEventId;
  }

  async updateEvent(nativeEventId: string, calendarId: string, syncEvent: NativeCalendarSyncEvent): Promise<void> {
    if (!this.events.has(nativeEventId)) throw new Error("Missing native event");
    this.events.set(nativeEventId, { ...syncEvent, id: nativeEventId, calendarId });
  }

  async deleteEvent(nativeEventId: string): Promise<void> {
    this.events.delete(nativeEventId);
  }

  async findEvent(nativeEventId: string): Promise<{ id: string; calendarId?: string } | null> {
    const existing = this.events.get(nativeEventId);
    if (!existing) return null;
    return { id: nativeEventId, calendarId: existing.calendarId };
  }
}
