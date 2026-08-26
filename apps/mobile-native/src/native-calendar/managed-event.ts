import type { NativeCalendarSyncEvent } from "./types";

export const NATIVE_CALENDAR_MANAGED_SCHEME = "academicpulse";
export const NATIVE_CALENDAR_MANAGED_HOST = "calendar-managed";
export const NATIVE_CALENDAR_MANAGED_VERSION = "v1";

export type NativeCalendarManagedIdentity = {
  ownerHash: string;
  sourceType: string;
  sourceId: string;
};

export function getNativeCalendarEventIdentity(
  event: Pick<NativeCalendarSyncEvent, "id" | "sourceId" | "sourceType" | "category">
): Pick<NativeCalendarManagedIdentity, "sourceType" | "sourceId"> {
  const sourceId = (event.sourceId ?? event.id).trim();
  if (!sourceId || sourceId.length > 512) throw new Error("Invalid native calendar source ID.");
  return {
    sourceType: normalizeNativeCalendarSourceType(event.sourceType ?? event.category ?? sourceTypeFromId(event.id)),
    sourceId
  };
}

export function normalizeNativeCalendarSourceType(value: string | undefined): string {
  const normalized = (value ?? "event")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 64);
  return normalized || "event";
}

export function createNativeCalendarOwnerHash(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) throw new Error("Native calendar owner is required.");
  return hashString64(`native-calendar-owner\0${normalized}`);
}

export function createManagedEventMarker(
  userId: string,
  event: Pick<NativeCalendarSyncEvent, "id" | "sourceId" | "sourceType" | "category">
): string {
  const identity = getNativeCalendarEventIdentity(event);
  return formatManagedEventMarker({
    ownerHash: createNativeCalendarOwnerHash(userId),
    ...identity
  });
}

export function parseManagedEventMarker(value: unknown): NativeCalendarManagedIdentity | null {
  if (typeof value !== "string") return null;
  const match = /^academicpulse:\/\/calendar-managed\/v1\/([a-f0-9]{16})\/([^/?#]+)\/(.+)$/u.exec(value);
  if (!match) return null;

  try {
    const sourceType = decodeURIComponent(match[2]!);
    const sourceId = decodeURIComponent(match[3]!);
    if (normalizeNativeCalendarSourceType(sourceType) !== sourceType || !sourceId || sourceId.length > 512) return null;
    return { ownerHash: match[1]!, sourceType, sourceId };
  } catch {
    return null;
  }
}

export function canonicalizeManagedEventMarker(value: unknown): string | null {
  const identity = parseManagedEventMarker(value);
  return identity ? formatManagedEventMarker(identity) : null;
}

export function managedEventMarkersMatch(left: unknown, right: unknown): boolean {
  const leftIdentity = parseManagedEventMarker(left);
  const rightIdentity = parseManagedEventMarker(right);
  return Boolean(
    leftIdentity
    && rightIdentity
    && leftIdentity.ownerHash === rightIdentity.ownerHash
    && leftIdentity.sourceType === rightIdentity.sourceType
    && leftIdentity.sourceId === rightIdentity.sourceId
  );
}

export function applyManagedEventMarker(userId: string, event: NativeCalendarSyncEvent): NativeCalendarSyncEvent {
  const identity = getNativeCalendarEventIdentity(event);
  const marker = createManagedEventMarker(userId, event);
  const sourceUrl = event.sourceUrl ?? (event.url && !parseManagedEventMarker(event.url) ? event.url : undefined);
  return {
    ...event,
    sourceId: identity.sourceId,
    sourceType: identity.sourceType,
    ...(sourceUrl ? { sourceUrl } : {}),
    url: marker
  };
}

export function createEventFingerprint(event: NativeCalendarSyncEvent): string {
  const identity = getNativeCalendarEventIdentity(event);
  return hashStableValue({
    id: event.id,
    sourceId: identity.sourceId,
    sourceType: identity.sourceType,
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate ?? null,
    allDay: event.allDay ?? false,
    timezone: event.timezone ?? null,
    notes: normalizeOptionalText(event.notes),
    location: normalizeOptionalText(event.location),
    sourceUrl: normalizeOptionalText(event.sourceUrl ?? (parseManagedEventMarker(event.url) ? undefined : event.url)),
    category: event.category ?? null,
    recurrenceRule: normalizeRecurrenceRule(event.recurrenceRule),
    reminderMinutesBefore: normalizeReminderOffsets(event.reminderMinutesBefore)
  });
}

/** Fingerprints only fields written to EventKit, allowing safe user-edit conflict detection. */
export function createManagedPayloadFingerprint(event: NativeCalendarSyncEvent): string {
  const allDay = event.allDay ?? false;
  const managedMarker = canonicalizeManagedEventMarker(event.url);
  return hashStableValue({
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate ?? null,
    allDay,
    timezone: allDay ? null : event.timezone ?? null,
    notes: normalizeOptionalText(event.notes),
    location: normalizeOptionalText(event.location),
    url: managedMarker,
    recurrenceRule: normalizeRecurrenceRule(event.recurrenceRule),
    reminderMinutesBefore: normalizeReminderOffsets(event.reminderMinutesBefore)
  });
}

function formatManagedEventMarker(identity: NativeCalendarManagedIdentity): string {
  return `${NATIVE_CALENDAR_MANAGED_SCHEME}://${NATIVE_CALENDAR_MANAGED_HOST}/${NATIVE_CALENDAR_MANAGED_VERSION}/${identity.ownerHash}/${encodeURIComponent(identity.sourceType)}/${encodeURIComponent(identity.sourceId)}`;
}

export function normalizeReminderOffsets(value: readonly number[] | undefined): number[] {
  return [...new Set((value ?? [])
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 0)
    .map((minutes) => Math.round(minutes)))]
    .sort((left, right) => left - right);
}

function sourceTypeFromId(id: string): string {
  const separator = id.indexOf(":");
  return separator > 0 ? id.slice(0, separator) : "event";
}

function normalizeOptionalText(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

function normalizeRecurrenceRule(value: NativeCalendarSyncEvent["recurrenceRule"]): unknown {
  if (!value) return null;
  return {
    frequency: value.frequency,
    interval: value.interval ?? null,
    endDate: value.endDate ?? null,
    occurrence: value.occurrence ?? null
  };
}

function hashStableValue(value: unknown): string {
  return hashString64(stableStringify(value));
}

function hashString64(value: string): string {
  return `${fnv1a(value, 2166136261)}${fnv1a(value, 2246822507)}`;
}

function fnv1a(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
