import { describe, expect, it } from "vitest";
import { createManagedEventMarker } from "../../apps/mobile-native/src/native-calendar/managed-event";
import {
  deserializeNativeCalendarStoredState,
  parseNativeCalendarStoredState,
  serializeNativeCalendarStoredState
} from "../../apps/mobile-native/src/native-calendar/storage-schema";
import type { NativeCalendarStoredState } from "../../apps/mobile-native/src/native-calendar/types";

describe("native calendar storage v3", () => {
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

  it("drops malformed records and markers whose identity disagrees with the mapping", () => {
    const state = validState();
    const parsed = parseNativeCalendarStoredState({
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
    });

    expect(parsed.integration).toBeUndefined();
    expect(Object.keys(parsed.mappings)).toEqual(["valid"]);
  });

  it("returns an empty safe state for corrupt JSON", () => {
    expect(deserializeNativeCalendarStoredState("{not-json")).toEqual({ mappings: {} });
  });
});

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
        lastSyncedAt: "2026-07-07T12:00:00.000Z"
      }
    }
  };
}
