import { describe, expect, it } from "vitest";
import {
  NativeCalendarService,
  createEventFingerprint
} from "../../apps/mobile-native/src/native-calendar/native-calendar-sync";
import {
  createManagedPayloadFingerprint,
  parseManagedEventMarker
} from "../../apps/mobile-native/src/native-calendar/managed-event";
import { NativeCalendarStorageError } from "../../apps/mobile-native/src/native-calendar/native-calendar-error";
import { createNativeCalendarStorageKey } from "../../apps/mobile-native/src/native-calendar/storage-key";
import type {
  NativeCalendarDeviceAdapter,
  NativeCalendarDeviceEventRef,
  NativeCalendarEventSearchWindow,
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

    const state = await createService(adapter, storage).connect(context);

    expect(state.integration).toBeUndefined();
    expect(await storage.loadState(context)).toEqual({ mappings: {} });
  });

  it("does not invoke iOS calendar permission from an Android context", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();

    const state = await createService(adapter, storage).connect({ ...context, platform: "android" });

    expect(state).toEqual({ mappings: {} });
    expect(adapter.permissionRequestCount).toBe(0);
  });

  it("validates stored marker ownership before requesting permission", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });
    const state = await storage.loadState(context);
    await storage.saveState(context, { mappings: state.mappings });
    adapter.permissionRequestCount = 0;

    await expect(service.connect({ ...context, userId: "user-2" })).rejects.toMatchObject({
      reason: "marker_mismatch"
    });
    expect(adapter.permissionRequestCount).toBe(0);
  });

  it("creates managed events once and skips unchanged events", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);

    const first = await service.syncEvents({ ...context, events: [event("a"), event("b")] });
    const second = await service.syncEvents({ ...context, events: [event("a"), event("b")] });

    expect(first.created).toBe(2);
    expect(second.skipped).toBe(2);
    expect(adapter.createdEventCount).toBe(2);
    expect([...adapter.events.values()].every((item) => parseManagedEventMarker(item.event.url))).toBe(true);
  });

  it("updates an unmodified managed event when its source fingerprint changes", async () => {
    const adapter = new MemoryCalendarAdapter();
    const service = createService(adapter, new MemoryCalendarStorage());
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });

    const updated = await service.syncEvents({ ...context, events: [{ ...event("a"), title: "Updated title" }] });

    expect(updated.updated).toBe(1);
    expect(adapter.createdEventCount).toBe(1);
    expect([...adapter.events.values()][0]?.event.title).toBe("Updated title");
  });

  it("recovers a changed native ID by exact managed marker without creating a duplicate", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });
    adapter.rekeyEvent("native-1", "native-recovered");

    const result = await service.syncEvents({ ...context, events: [event("a")] });
    const mapping = Object.values((await storage.loadState(context)).mappings)[0];

    expect(result.recovered).toBe(1);
    expect(result.created).toBe(0);
    expect(mapping?.nativeEventId).toBe("native-recovered");
    expect(adapter.events.size).toBe(1);
  });

  it("treats a user-deleted event as a conflict and does not silently recreate it", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });
    adapter.events.clear();

    const result = await service.syncEvents({ ...context, events: [event("a")] });
    const mapping = Object.values((await storage.loadState(context)).mappings)[0];

    expect(result.conflicted).toBe(1);
    expect(result.errors[0]?.reason).toBe("user_deleted");
    expect(adapter.createdEventCount).toBe(1);
    expect(mapping?.status).toBe("user_deleted");
  });

  it("preserves a user-modified event instead of overwriting source changes", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });
    adapter.patchEvent("native-1", { title: "My own title" });

    const result = await service.syncEvents({ ...context, events: [{ ...event("a"), title: "Source title" }] });
    const mapping = Object.values((await storage.loadState(context)).mappings)[0];

    expect(result.updated).toBe(0);
    expect(result.conflicted).toBe(1);
    expect(mapping?.status).toBe("user_modified");
    expect(adapter.events.get("native-1")?.event.title).toBe("My own title");
  });

  it("deletes stale events only for source families explicitly known to be complete", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a"), event("b")] });

    const partial = await service.syncEvents({ ...context, events: [event("a")] });
    const unrelated = await service.syncEvents({
      ...context,
      events: [event("a")],
      deletionEligibleSourceTypes: ["announcement"]
    });
    const complete = await service.syncEvents({
      ...context,
      events: [event("a")],
      deletionEligibleSourceTypes: ["academic_event"]
    });

    expect(partial.deleted).toBe(0);
    expect(unrelated.deleted).toBe(0);
    expect(complete.deleted).toBe(1);
    expect(adapter.events.size).toBe(1);
  });

  it("preserves a moved event instead of duplicating it in the selected calendar", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });
    adapter.moveEvent("native-1", "calendar-2");

    const result = await service.syncEvents({ ...context, events: [event("a")] });

    expect(result.conflicted).toBe(1);
    expect(result.errors[0]?.reason).toBe("moved_calendar");
    expect(adapter.createdEventCount).toBe(1);
    expect(adapter.events.get("native-1")?.calendarId).toBe("calendar-2");
  });

  it("rejects multiple native destinations", async () => {
    const service = createService(new MemoryCalendarAdapter(), new MemoryCalendarStorage());

    await expect(service.connect({
      ...context,
      selectedCalendarIds: ["calendar-1", "calendar-2"]
    })).rejects.toThrow("Only one native calendar destination");
  });

  it("retains the real create ID when post-create verification reports a conflict", async () => {
    const adapter = new MemoryCalendarAdapter();
    adapter.corruptHashAfterCreate = true;
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);

    const result = await service.syncEvents({ ...context, events: [event("a")] });
    const mapping = Object.values((await storage.loadState(context)).mappings)[0];

    expect(result.created).toBe(1);
    expect(result.conflicted).toBe(1);
    expect(mapping).toMatchObject({ nativeEventId: "native-1", status: "user_modified" });
    expect(mapping?.nativeEventId).not.toContain("unresolved:");
    expect(adapter.events.has(mapping!.nativeEventId)).toBe(true);
  });

  it("retains the replacement update ID when post-update verification reports a conflict", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });
    adapter.replaceIdOnUpdate = true;
    adapter.corruptHashAfterUpdate = true;

    const result = await service.syncEvents({ ...context, events: [{ ...event("a"), title: "Changed" }] });
    const mapping = Object.values((await storage.loadState(context)).mappings)[0];

    expect(result.updated).toBe(1);
    expect(result.conflicted).toBe(1);
    expect(mapping).toMatchObject({ nativeEventId: "native-updated-2", status: "user_modified" });
    expect(adapter.events.has("native-updated-2")).toBe(true);
    expect(adapter.events.has("native-1")).toBe(false);
  });

  it("disconnects and removes verified managed events", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a"), event("b")] });

    const result = await service.disconnect({ ...context, removeNativeEvents: true });

    expect(result.deleted).toBe(2);
    expect(await storage.loadState(context)).toEqual({ mappings: {} });
    expect(adapter.events.size).toBe(0);
  });

  it("preserves a managed event when its native modification timestamp changes", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });
    adapter.touchEvent("native-1");

    const result = await service.disconnect({ ...context, removeNativeEvents: true });

    expect(result.conflicted).toBe(1);
    expect(adapter.events.has("native-1")).toBe(true);
    expect(Object.values((await storage.loadState(context)).mappings)[0]?.status).toBe("user_modified");
  });

  it("preserves events whose destructive safety cannot be verified", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });
    adapter.markEventUncertain("native-1");

    const result = await service.disconnect({ ...context, removeNativeEvents: true });

    expect(result.conflicted).toBe(1);
    expect(adapter.events.has("native-1")).toBe(true);
  });

  it("does not delete a mapping owned by another account hash", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });
    const state = await storage.loadState(context);
    await storage.saveState(context, { mappings: state.mappings });

    const result = await service.disconnect({
      ...context,
      userId: "user-2",
      removeNativeEvents: true
    });

    expect(result.conflicted).toBe(1);
    expect(result.errors[0]?.reason).toBe("marker_mismatch");
    expect(adapter.events.has("native-1")).toBe(true);
  });

  it("fails closed when calendar state cannot be read during destructive cleanup", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });
    const unreadableStorage: NativeCalendarStorage = {
      loadState: async () => {
        throw new NativeCalendarStorageError("read_failed", "Injected read failure.");
      },
      saveState: (key, state) => storage.saveState(key, state),
      clearState: () => storage.clearState()
    };

    await expect(createService(adapter, unreadableStorage).disconnect({
      ...context,
      removeNativeEvents: true
    })).rejects.toMatchObject({ code: "read_failed" });
    expect(adapter.events.has("native-1")).toBe(true);
    expect(adapter.deleteCallCount).toBe(0);
  });

  it("retains failed delete mappings in a disabled integration for retry", async () => {
    const adapter = new MemoryCalendarAdapter();
    const storage = new MemoryCalendarStorage();
    const service = createService(adapter, storage);
    await service.connect(context);
    await service.syncEvents({ ...context, events: [event("a")] });
    adapter.failDeletes = true;

    const result = await service.disconnect({ ...context, removeNativeEvents: true });
    const retained = await storage.loadState(context);

    expect(result.failed).toBe(1);
    expect(Object.values(retained.mappings)[0]).toMatchObject({
      nativeEventId: "native-1",
      status: "delete_failed"
    });
    expect(retained.integration?.enabled).toBe(false);
  });

  it("fingerprints equivalent reminder arrays deterministically", () => {
    expect(createEventFingerprint({ ...event("a"), reminderMinutesBefore: [60, 0] })).toBe(
      createEventFingerprint({ ...event("a"), reminderMinutesBefore: [0, 60] })
    );
  });

  it("creates a v3 storage-safe persistence key", () => {
    const key = createNativeCalendarStorageKey({
      userId: "user:1@example.com",
      platform: "ios",
      deviceId: "device/with spaces"
    });

    expect(key).toContain("native_calendar_state_v3");
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
    id: `academic:${id}`,
    sourceId: id,
    sourceType: "academic_event",
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

type StoredNativeEvent = {
  calendarId: string;
  event: NativeCalendarSyncEvent;
  reportedHash?: string;
  lastModifiedDate: string;
  destructiveSafety: "verified" | "uncertain";
};

class MemoryCalendarAdapter implements NativeCalendarDeviceAdapter {
  permission: NativeCalendarPermissionState = { status: "authorized", canAskAgain: true, granted: true };
  calendars: NativeCalendarWritableCalendar[] = [
    { id: "calendar-1", title: "Akademik Takvim", provider: "apple", allowsModifications: true, isAppCalendar: true },
    { id: "calendar-2", title: "Personal", provider: "google", allowsModifications: true }
  ];
  events = new Map<string, StoredNativeEvent>();
  createdEventCount = 0;
  deleteCallCount = 0;
  permissionRequestCount = 0;
  failDeletes = false;
  corruptHashAfterCreate = false;
  corruptHashAfterUpdate = false;
  replaceIdOnUpdate = false;
  private sequence = 0;
  private modificationSequence = 0;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getPermissionStatus(): Promise<NativeCalendarPermissionState> {
    return this.permission;
  }

  async requestPermission(): Promise<NativeCalendarPermissionState> {
    this.permissionRequestCount += 1;
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
    this.events.set(nativeEventId, {
      calendarId,
      event: structuredClone(syncEvent),
      lastModifiedDate: this.nextModifiedDate(),
      destructiveSafety: "verified",
      ...(this.corruptHashAfterCreate ? { reportedHash: "user-modified" } : {})
    });
    return nativeEventId;
  }

  async updateEvent(
    nativeEventId: string,
    calendarId: string,
    syncEvent: NativeCalendarSyncEvent,
    expectedMarker?: string
  ): Promise<string> {
    const current = this.events.get(nativeEventId);
    if (!current) throw new Error("Missing native event");
    if (current.event.url !== expectedMarker) throw new Error("Marker mismatch");
    this.sequence += 1;
    const nextId = this.replaceIdOnUpdate ? `native-updated-${this.sequence}` : nativeEventId;
    if (nextId !== nativeEventId) this.events.delete(nativeEventId);
    this.events.set(nextId, {
      calendarId,
      event: structuredClone(syncEvent),
      lastModifiedDate: this.nextModifiedDate(),
      destructiveSafety: "verified",
      ...(this.corruptHashAfterUpdate ? { reportedHash: "user-modified" } : {})
    });
    return nextId;
  }

  async deleteEvent(nativeEventId: string, expectedMarker?: string): Promise<void> {
    this.deleteCallCount += 1;
    if (this.failDeletes) throw new Error("Injected delete failure");
    const current = this.events.get(nativeEventId);
    if (current && current.event.url !== expectedMarker) throw new Error("Marker mismatch");
    this.events.delete(nativeEventId);
  }

  async findEvent(nativeEventId: string): Promise<NativeCalendarDeviceEventRef | null> {
    const current = this.events.get(nativeEventId);
    return current ? this.ref(nativeEventId, current) : null;
  }

  async findManagedEvent(
    managedMarker: string,
    _searchWindow: NativeCalendarEventSearchWindow
  ): Promise<NativeCalendarDeviceEventRef | null> {
    const match = [...this.events.entries()].find(([, current]) => current.event.url === managedMarker);
    return match ? this.ref(match[0], match[1]) : null;
  }

  rekeyEvent(from: string, to: string): void {
    const current = this.events.get(from);
    if (!current) throw new Error("Missing native event");
    this.events.delete(from);
    this.events.set(to, current);
  }

  patchEvent(nativeEventId: string, patch: Partial<NativeCalendarSyncEvent>): void {
    const current = this.events.get(nativeEventId);
    if (!current) throw new Error("Missing native event");
    current.event = { ...current.event, ...patch };
    current.lastModifiedDate = this.nextModifiedDate();
  }

  touchEvent(nativeEventId: string): void {
    const current = this.events.get(nativeEventId);
    if (!current) throw new Error("Missing native event");
    current.lastModifiedDate = this.nextModifiedDate();
  }

  markEventUncertain(nativeEventId: string): void {
    const current = this.events.get(nativeEventId);
    if (!current) throw new Error("Missing native event");
    current.destructiveSafety = "uncertain";
    current.lastModifiedDate = this.nextModifiedDate();
  }

  moveEvent(nativeEventId: string, calendarId: string): void {
    const current = this.events.get(nativeEventId);
    if (!current) throw new Error("Missing native event");
    current.calendarId = calendarId;
  }

  private ref(nativeEventId: string, current: StoredNativeEvent): NativeCalendarDeviceEventRef {
    return {
      id: nativeEventId,
      calendarId: current.calendarId,
      ...(current.event.url ? { managedMarker: current.event.url } : {}),
      eventHash: current.reportedHash ?? createManagedPayloadFingerprint(current.event),
      lastModifiedDate: current.lastModifiedDate,
      destructiveSafety: current.destructiveSafety
    };
  }

  private nextModifiedDate(): string {
    this.modificationSequence += 1;
    return new Date(Date.parse("2026-07-07T12:00:00.000Z") + this.modificationSequence * 1_000).toISOString();
  }
}
