import { describe, expect, it } from "vitest";
import {
  createPendingNotificationDestinationRecord,
  isSamePendingNotificationDestinationRecord,
  parseAcademicPulseNotificationUrl,
  parseNotificationDestination,
  parsePendingNotificationDestinationRecord,
  resolveNotificationDestination,
  serializePendingNotificationDestinationRecord,
  type CurrentNotificationOwner
} from "../../apps/mobile-native/src/notifications/notification-destination";

const announcementPayload = {
  schemaVersion: "1",
  destinationType: "announcement",
  destinationId: "announcement-42",
  recipientOwnerId: "owner-a"
};

describe("notification destination contract", () => {
  it("parses only the exact versioned announcement and calendar contracts", () => {
    expect(parseNotificationDestination(announcementPayload)).toEqual({
      destination: { schemaVersion: 1, type: "announcement", id: "announcement-42" },
      recipientOwnerId: "owner-a"
    });
    expect(parseNotificationDestination({
      ...announcementPayload,
      destinationType: "calendar_event",
      destinationId: "calendar-event:17"
    })).toEqual({
      destination: { schemaVersion: 1, type: "calendar_event", id: "calendar-event:17" },
      recipientOwnerId: "owner-a"
    });

    expect(parseNotificationDestination({ ...announcementPayload, schemaVersion: "2" })).toBeNull();
    expect(parseNotificationDestination({ ...announcementPayload, destinationType: "https://evil.example" })).toBeNull();
    expect(parseNotificationDestination({ ...announcementPayload, destinationId: "../unsafe" })).toBeNull();
    expect(parseNotificationDestination({ ...announcementPayload, url: "https://evil.example" })).toBeNull();
    expect(parseNotificationDestination(null)).toBeNull();
  });

  it("serializes an owner-bound pending destination without accepting extra data", () => {
    const parsed = parseNotificationDestination(announcementPayload)!;
    const record = createPendingNotificationDestinationRecord({
      destination: parsed.destination,
      ownerId: parsed.recipientOwnerId,
      receivedAt: new Date("2026-07-31T08:00:00.000Z")
    });
    const serialized = serializePendingNotificationDestinationRecord(record);

    expect(parsePendingNotificationDestinationRecord(serialized)).toEqual(record);
    expect(serialized).not.toContain("token");
    expect(parsePendingNotificationDestinationRecord(JSON.stringify({
      ...record,
      pushToken: "must-not-survive"
    }))).toBeNull();
    expect(isSamePendingNotificationDestinationRecord(record, record)).toBe(true);
    expect(isSamePendingNotificationDestinationRecord({
      ...record,
      receivedAt: "2026-07-31T08:00:01.000Z"
    }, record)).toBe(false);
    expect(isSamePendingNotificationDestinationRecord({
      ...record,
      destination: { ...record.destination, id: "announcement-newer" }
    }, record)).toBe(false);
  });

  it("parses the strict academicpulse smoke URL and rejects extras or duplicates", () => {
    const valid = "academicpulse://notification?schemaVersion=1&destinationType=announcement&destinationId=announcement-42&recipientOwnerId=owner-a";
    expect(parseAcademicPulseNotificationUrl(valid)).toEqual(parseNotificationDestination(announcementPayload));
    expect(parseAcademicPulseNotificationUrl(valid.replace("notification?", "profile?"))).toBeNull();
    expect(parseAcademicPulseNotificationUrl(`${valid}&destinationId=other`)).toBeNull();
    expect(parseAcademicPulseNotificationUrl(`${valid}&url=https%3A%2F%2Fevil.example`)).toBeNull();
    expect(parseAcademicPulseNotificationUrl(valid.replace("announcement-42", "%2E%2E%2Funsafe"))).toBeNull();
    expect(parseAcademicPulseNotificationUrl(`${valid}#fragment`)).toBeNull();
  });
});

describe("notification destination resume", () => {
  it("defers a signed-out destination until authentication", async () => {
    const record = pendingAnnouncement();
    const availabilityCalls: string[] = [];

    const resolution = await resolveNotificationDestination({
      record,
      currentOwner: null,
      getCurrentOwner: () => null,
      isAvailable: async (destination) => {
        availabilityCalls.push(destination.id);
        return true;
      }
    });

    expect(resolution).toEqual({ status: "authenticate", pending: record });
    expect(availabilityCalls).toHaveLength(0);
  });

  it("opens the exact trusted destination for the current owner", async () => {
    const record = pendingAnnouncement();
    const currentOwner = { ownerId: "owner-a", generation: 4 };

    const resolution = await resolveNotificationDestination({
      record,
      currentOwner,
      getCurrentOwner: () => currentOwner,
      isAvailable: async (destination) => destination.id === "announcement-42"
    });

    expect(resolution).toEqual({ status: "open", destination: record.destination });
  });

  it("ignores a pending destination for a different app owner", async () => {
    const resolution = await resolveNotificationDestination({
      record: pendingAnnouncement(),
      currentOwner: { ownerId: "owner-b", generation: 1 },
      getCurrentOwner: () => ({ ownerId: "owner-b", generation: 1 }),
      isAvailable: async () => true
    });

    expect(resolution).toEqual({ status: "ignored", reason: "wrong_owner" });
  });

  it("returns a safe unavailable state for removed content or lookup failure", async () => {
    const record = pendingAnnouncement();
    const currentOwner = { ownerId: "owner-a", generation: 2 };

    await expect(resolveNotificationDestination({
      record,
      currentOwner,
      getCurrentOwner: () => currentOwner,
      isAvailable: async () => false
    })).resolves.toEqual({
      status: "unavailable",
      destination: record.destination,
      reason: "content_missing"
    });
    await expect(resolveNotificationDestination({
      record,
      currentOwner,
      getCurrentOwner: () => currentOwner,
      isAvailable: async () => {
        throw new Error("raw provider detail");
      }
    })).resolves.toEqual({
      status: "unavailable",
      destination: record.destination,
      reason: "lookup_error"
    });
  });

  it("ignores lookup completion after the owner generation changes", async () => {
    const record = pendingAnnouncement();
    const lookup = deferred<boolean>();
    let currentOwner: CurrentNotificationOwner | null = { ownerId: "owner-a", generation: 3 };
    const resolution = resolveNotificationDestination({
      record,
      currentOwner,
      getCurrentOwner: () => currentOwner,
      isAvailable: () => lookup.promise
    });

    currentOwner = { ownerId: "owner-a", generation: 4 };
    lookup.resolve(true);

    await expect(resolution).resolves.toEqual({ status: "ignored", reason: "stale_owner" });
  });
});

function pendingAnnouncement() {
  return createPendingNotificationDestinationRecord({
    destination: { schemaVersion: 1, type: "announcement", id: "announcement-42" },
    ownerId: "owner-a",
    receivedAt: new Date("2026-07-31T08:00:00.000Z")
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
