import { describe, expect, it, vi } from "vitest";

vi.mock("expo-calendar", () => ({
  EntityTypes: { EVENT: "event", REMINDER: "reminder" },
  CalendarType: { BIRTHDAYS: "birthdays", SUBSCRIBED: "subscribed" },
  Availability: { FREE: "free" },
  Frequency: { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" }
}));

import type * as ExpoCalendar from "expo-calendar";
import { createExpoCalendarAdapter } from "../../apps/mobile-native/src/native-calendar/expo-calendar-adapter";
import { createManagedEventMarker } from "../../apps/mobile-native/src/native-calendar/managed-event";
import type { NativeCalendarSyncEvent } from "../../apps/mobile-native/src/native-calendar/types";

describe("Expo iOS calendar adapter", () => {
  it("is unavailable on Android without touching EventKit APIs", async () => {
    const fake = new FakeExpoCalendar();
    const adapter = createExpoCalendarAdapter({
      platform: "android",
      calendarModule: fake.module
    });

    expect(await adapter.isAvailable?.()).toBe(false);
    expect(await adapter.getPermissionStatus()).toEqual({
      status: "unavailable",
      granted: false,
      canAskAgain: false
    });
    expect(fake.isAvailableCalls).toBe(0);
    expect(fake.permissionCalls).toBe(0);
  });

  it("maps Expo full-access permission states without requesting during status checks", async () => {
    const fake = new FakeExpoCalendar();
    fake.permission = { status: "undetermined", granted: false, canAskAgain: true, expires: "never" };
    const adapter = createExpoCalendarAdapter({ platform: "ios", calendarModule: fake.module });

    expect(await adapter.getPermissionStatus()).toEqual({
      status: "not_determined",
      granted: false,
      canAskAgain: true
    });
    expect(fake.requestCalls).toBe(0);

    fake.permission = { status: "granted", granted: true, canAskAgain: true, expires: "never" };
    expect(await adapter.requestPermission()).toMatchObject({ status: "authorized", granted: true });
    expect(fake.requestCalls).toBe(1);
  });

  it("creates and then reuses one verified writable app calendar", async () => {
    const fake = new FakeExpoCalendar();
    const adapter = createExpoCalendarAdapter({ platform: "ios", calendarModule: fake.module });

    const created = await adapter.getOrCreateAppCalendar("Akademik Takvim");
    const reused = await adapter.getOrCreateAppCalendar("Akademik Takvim");

    expect(created).toMatchObject({
      id: "calendar-created",
      title: "Akademik Takvim",
      allowsModifications: true,
      isAppCalendar: true
    });
    expect(reused.id).toBe(created.id);
    expect(fake.createCalendarCalls).toBe(1);
  });

  it("converts local all-day dates and reminder offsets at the EventKit boundary", async () => {
    const fake = new FakeExpoCalendar();
    const adapter = createExpoCalendarAdapter({ platform: "ios", calendarModule: fake.module });
    const managedEvent = event();

    const id = await adapter.createEvent("calendar-1", managedEvent);

    expect(id).toBe("event-1");
    expect(fake.lastCreatedDetails).toMatchObject({
      startDate: "2026-03-07T21:00:00.000Z",
      endDate: "2026-03-08T21:00:00.000Z",
      allDay: true,
      timeZone: "Europe/Istanbul",
      alarms: [{ relativeOffset: -60 }]
    });
    expect((await adapter.findEvent(id))?.managedMarker).toBe(managedEvent.url);
  });

  it("requires the exact marker before update, delete, or open", async () => {
    const fake = new FakeExpoCalendar();
    const adapter = createExpoCalendarAdapter({ platform: "ios", calendarModule: fake.module });
    const managedEvent = event();
    const id = await adapter.createEvent("calendar-1", managedEvent);

    await expect(adapter.updateEvent(id, "calendar-1", managedEvent, event("other").url)).rejects.toMatchObject({
      reason: "marker_mismatch"
    });
    await expect(adapter.deleteEvent(id, event("other").url)).rejects.toMatchObject({ reason: "marker_mismatch" });
    await expect(adapter.openEvent?.(id, event("other").url)).rejects.toMatchObject({ reason: "marker_mismatch" });

    await adapter.openEvent?.(id, managedEvent.url);
    expect(fake.openCalls).toEqual([{ id, allowsEditing: false }]);
    expect(fake.events.has(id)).toBe(true);
  });
});

function event(sourceId = "a"): NativeCalendarSyncEvent {
  const base = {
    id: `academic:${sourceId}`,
    sourceId,
    sourceType: "academic_event",
    title: "Registration",
    startDate: "2026-03-08",
    endDate: "2026-03-09",
    allDay: true,
    timezone: "Europe/Istanbul",
    reminderMinutesBefore: [60]
  } satisfies NativeCalendarSyncEvent;
  return { ...base, url: createManagedEventMarker("user-1", base) };
}

class FakeExpoCalendar {
  permission = { status: "granted", granted: true, canAskAgain: true, expires: "never" };
  isAvailableCalls = 0;
  permissionCalls = 0;
  requestCalls = 0;
  createCalendarCalls = 0;
  lastCreatedDetails: Record<string, unknown> | undefined;
  openCalls: Array<{ id: string; allowsEditing: boolean }> = [];
  calendars: Array<Record<string, unknown>> = [{
    id: "calendar-1",
    title: "Personal",
    sourceId: "source-1",
    source: { id: "source-1", type: "caldav", name: "iCloud" },
    type: "caldav",
    color: "#FF0000",
    entityType: "event",
    allowsModifications: true,
    allowedAvailabilities: ["free"]
  }];
  events = new Map<string, Record<string, unknown>>();

  readonly module = {
    EntityTypes: { EVENT: "event", REMINDER: "reminder" },
    CalendarType: { BIRTHDAYS: "birthdays", SUBSCRIBED: "subscribed" },
    Availability: { FREE: "free" },
    Frequency: { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" },
    isAvailableAsync: async () => {
      this.isAvailableCalls += 1;
      return true;
    },
    getCalendarPermissionsAsync: async () => {
      this.permissionCalls += 1;
      return this.permission;
    },
    requestCalendarPermissionsAsync: async () => {
      this.requestCalls += 1;
      return this.permission;
    },
    getCalendarsAsync: async () => this.calendars,
    getDefaultCalendarAsync: async () => this.calendars[0],
    createCalendarAsync: async (details: Record<string, unknown>) => {
      this.createCalendarCalls += 1;
      this.calendars.push({
        id: "calendar-created",
        title: details.title,
        sourceId: "source-1",
        source: { id: "source-1", type: "caldav", name: "iCloud" },
        type: "caldav",
        color: details.color,
        entityType: "event",
        allowsModifications: true,
        allowedAvailabilities: ["free"]
      });
      return "calendar-created";
    },
    createEventAsync: async (calendarId: string, details: Record<string, unknown>) => {
      this.lastCreatedDetails = details;
      const id = `event-${this.events.size + 1}`;
      this.events.set(id, expoEvent(id, calendarId, details));
      return id;
    },
    updateEventAsync: async (id: string, details: Record<string, unknown>) => {
      const current = this.events.get(id);
      if (!current) throw new Error(`Event with id ${id} could not be found`);
      this.events.set(id, expoEvent(id, current.calendarId as string, details));
      return id;
    },
    deleteEventAsync: async (id: string) => {
      this.events.delete(id);
    },
    getEventAsync: async (id: string) => {
      const found = this.events.get(id);
      if (!found) throw new Error(`Event with id ${id} could not be found`);
      return found;
    },
    getEventsAsync: async () => [...this.events.values()],
    openEventInCalendarAsync: async (
      params: { id: string },
      options: { allowsEditing?: boolean }
    ) => {
      this.openCalls.push({ id: params.id, allowsEditing: options.allowsEditing ?? false });
      return { action: "done" };
    }
  } as unknown as typeof ExpoCalendar;
}

function expoEvent(id: string, calendarId: string, details: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    calendarId,
    title: details.title,
    location: details.location ?? null,
    timeZone: details.timeZone,
    url: details.url,
    notes: details.notes ?? "",
    alarms: details.alarms ?? [],
    recurrenceRule: details.recurrenceRule ?? null,
    startDate: details.startDate,
    endDate: details.endDate,
    allDay: details.allDay,
    availability: details.availability,
    status: "confirmed"
  };
}
