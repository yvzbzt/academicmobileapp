export type NotificationDestination =
  | {
      schemaVersion: 1;
      type: "announcement";
      id: string;
    }
  | {
      schemaVersion: 1;
      type: "calendar_event";
      id: string;
    };

export interface ParsedNotificationDestination {
  destination: NotificationDestination;
  recipientOwnerId: string;
}

export interface PendingNotificationDestinationRecord {
  schemaVersion: 1;
  ownerId: string;
  destination: NotificationDestination;
  receivedAt: string;
}

export interface CurrentNotificationOwner {
  ownerId: string;
  generation: number;
}

export type NotificationDestinationResolution =
  | {
      status: "open";
      destination: NotificationDestination;
    }
  | {
      status: "authenticate";
      pending: PendingNotificationDestinationRecord;
    }
  | {
      status: "unavailable";
      destination: NotificationDestination;
      reason: "content_missing" | "lookup_error";
    }
  | {
      status: "ignored";
      reason: "wrong_owner" | "stale_owner";
    };

export function parseNotificationDestination(value: unknown): ParsedNotificationDestination | null {
  if (!isObject(value)) return null;
  if (!hasOnlyKeys(value, ["schemaVersion", "destinationType", "destinationId", "recipientOwnerId"])) return null;
  if (value.schemaVersion !== "1") return null;
  if (value.destinationType !== "announcement" && value.destinationType !== "calendar_event") return null;
  if (!isSafeIdentifier(value.destinationId) || !isSafeIdentifier(value.recipientOwnerId)) return null;

  return {
    destination: {
      schemaVersion: 1,
      type: value.destinationType,
      id: value.destinationId
    },
    recipientOwnerId: value.recipientOwnerId
  };
}

export function parseAcademicPulseNotificationUrl(value: string): ParsedNotificationDestination | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "academicpulse:"
    || url.hostname !== "notification"
    || (url.pathname !== "" && url.pathname !== "/")
    || url.username !== ""
    || url.password !== ""
    || url.port !== ""
    || url.hash !== ""
  ) {
    return null;
  }

  const allowedKeys = ["schemaVersion", "destinationType", "destinationId", "recipientOwnerId"];
  const actualKeys = [...url.searchParams.keys()];
  if (
    actualKeys.length !== allowedKeys.length
    || actualKeys.some((key) => !allowedKeys.includes(key))
    || allowedKeys.some((key) => url.searchParams.getAll(key).length !== 1)
  ) {
    return null;
  }

  return parseNotificationDestination({
    schemaVersion: url.searchParams.get("schemaVersion"),
    destinationType: url.searchParams.get("destinationType"),
    destinationId: url.searchParams.get("destinationId"),
    recipientOwnerId: url.searchParams.get("recipientOwnerId")
  });
}

export const parseNotificationDeepLink = parseAcademicPulseNotificationUrl;

export function createPendingNotificationDestinationRecord(input: {
  destination: NotificationDestination;
  ownerId: string;
  receivedAt?: Date;
}): PendingNotificationDestinationRecord {
  if (!isNotificationDestination(input.destination)) {
    throw new Error("A valid notification destination is required.");
  }
  if (!isSafeIdentifier(input.ownerId)) {
    throw new Error("A valid notification destination owner is required.");
  }
  return {
    schemaVersion: 1,
    ownerId: input.ownerId,
    destination: { ...input.destination },
    receivedAt: (input.receivedAt ?? new Date()).toISOString()
  };
}

export function serializePendingNotificationDestinationRecord(
  record: PendingNotificationDestinationRecord
): string {
  const normalized = parsePendingNotificationDestinationRecord(JSON.stringify(record));
  if (!normalized) throw new Error("A valid pending notification destination is required.");
  return JSON.stringify(normalized);
}

export function isSamePendingNotificationDestinationRecord(
  left: PendingNotificationDestinationRecord | null,
  right: PendingNotificationDestinationRecord
): boolean {
  return Boolean(
    left
    && left.schemaVersion === right.schemaVersion
    && left.ownerId === right.ownerId
    && left.receivedAt === right.receivedAt
    && left.destination.schemaVersion === right.destination.schemaVersion
    && left.destination.type === right.destination.type
    && left.destination.id === right.destination.id
  );
}

export function parsePendingNotificationDestinationRecord(
  value: string | null | undefined
): PendingNotificationDestinationRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isObject(parsed) || parsed.schemaVersion !== 1) return null;
    if (!hasOnlyKeys(parsed, ["schemaVersion", "ownerId", "destination", "receivedAt"])) return null;
    if (!isSafeIdentifier(parsed.ownerId) || !isNotificationDestination(parsed.destination)) return null;
    if (typeof parsed.receivedAt !== "string" || !isValidIsoDate(parsed.receivedAt)) return null;
    return {
      schemaVersion: 1,
      ownerId: parsed.ownerId,
      destination: { ...parsed.destination },
      receivedAt: parsed.receivedAt
    };
  } catch {
    return null;
  }
}

export async function resolveNotificationDestination(input: {
  record: PendingNotificationDestinationRecord;
  currentOwner: CurrentNotificationOwner | null;
  getCurrentOwner: () => CurrentNotificationOwner | null;
  isAvailable: (destination: NotificationDestination) => Promise<boolean>;
}): Promise<NotificationDestinationResolution> {
  if (!input.currentOwner) {
    return { status: "authenticate", pending: input.record };
  }
  if (input.currentOwner.ownerId !== input.record.ownerId) {
    return { status: "ignored", reason: "wrong_owner" };
  }

  const expectedOwner = { ...input.currentOwner };
  let available: boolean;
  try {
    available = await input.isAvailable(input.record.destination);
  } catch {
    if (!isSameOwner(input.getCurrentOwner(), expectedOwner)) {
      return { status: "ignored", reason: "stale_owner" };
    }
    return {
      status: "unavailable",
      destination: input.record.destination,
      reason: "lookup_error"
    };
  }

  if (!isSameOwner(input.getCurrentOwner(), expectedOwner)) {
    return { status: "ignored", reason: "stale_owner" };
  }
  if (!available) {
    return {
      status: "unavailable",
      destination: input.record.destination,
      reason: "content_missing"
    };
  }
  return { status: "open", destination: input.record.destination };
}

function isNotificationDestination(value: unknown): value is NotificationDestination {
  return isObject(value)
    && hasOnlyKeys(value, ["schemaVersion", "type", "id"])
    && value.schemaVersion === 1
    && (value.type === "announcement" || value.type === "calendar_event")
    && isSafeIdentifier(value.id);
}

function isSameOwner(
  actual: CurrentNotificationOwner | null,
  expected: CurrentNotificationOwner
): boolean {
  return actual?.ownerId === expected.ownerId && actual.generation === expected.generation;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === allowedKeys.length
    && actualKeys.every((key) => allowedKeys.includes(key));
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 200
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
}

function isValidIsoDate(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
