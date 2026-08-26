import { parseManagedEventMarker } from "./managed-event";
import { NativeCalendarStorageError } from "./native-calendar-error";
import type {
  NativeCalendarConflictReason,
  NativeCalendarDestination,
  NativeCalendarEventMapping,
  NativeCalendarIntegrationRecord,
  NativeCalendarMappingStatus,
  NativeCalendarProvider,
  NativeCalendarStoredState,
  NativeCalendarSyncCounts
} from "./types";

export const NATIVE_CALENDAR_STORAGE_VERSION = 3 as const;

type NativeCalendarStorageEnvelope = {
  version: typeof NATIVE_CALENDAR_STORAGE_VERSION;
  state: NativeCalendarStoredState;
};

const PROVIDERS = new Set<NativeCalendarProvider>(["google", "apple", "device", "other"]);
const MAPPING_STATUSES = new Set<NativeCalendarMappingStatus>([
  "managed", "user_deleted", "user_modified", "moved", "delete_failed"
]);
const CONFLICT_REASONS = new Set<NativeCalendarConflictReason>([
  "marker_mismatch", "user_deleted", "user_modified", "moved_calendar", "ambiguous_marker"
]);

export function deserializeNativeCalendarStoredState(value: string): NativeCalendarStoredState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw new NativeCalendarStorageError("corrupt", "Native calendar state contains invalid JSON.", { cause });
  }
  return parseNativeCalendarStoredStateStrict(parsed);
}

export function serializeNativeCalendarStoredState(state: NativeCalendarStoredState): string {
  const envelope: NativeCalendarStorageEnvelope = {
    version: NATIVE_CALENDAR_STORAGE_VERSION,
    state: parseNativeCalendarStoredStateStrict(state)
  };
  return JSON.stringify(envelope);
}

/** Accepts the v3 envelope and the old unversioned state while dropping unsafe records. */
export function parseNativeCalendarStoredState(value: unknown): NativeCalendarStoredState {
  const root = isRecord(value) && value.version === NATIVE_CALENDAR_STORAGE_VERSION && isRecord(value.state)
    ? value.state
    : value;
  if (!isRecord(root)) return { mappings: {} };

  const mappings: Record<string, NativeCalendarEventMapping> = {};
  if (isRecord(root.mappings)) {
    for (const [key, candidate] of Object.entries(root.mappings)) {
      const mapping = parseMapping(candidate);
      if (mapping) mappings[key] = mapping;
    }
  }
  const integration = parseIntegration(root.integration);
  return { ...(integration ? { integration } : {}), mappings };
}

function parseNativeCalendarStoredStateStrict(value: unknown): NativeCalendarStoredState {
  let root: unknown = value;
  if (isRecord(value) && "version" in value) {
    if (value.version !== NATIVE_CALENDAR_STORAGE_VERSION) {
      throw new NativeCalendarStorageError(
        "unsupported_version",
        "Native calendar state uses an unsupported storage version."
      );
    }
    if (!isRecord(value.state)) {
      throw new NativeCalendarStorageError("corrupt", "Native calendar state envelope is malformed.");
    }
    root = value.state;
  }
  if (!isRecord(root)) {
    throw new NativeCalendarStorageError("corrupt", "Native calendar state is not an object.");
  }

  if (!isRecord(root.mappings)) {
    throw new NativeCalendarStorageError("corrupt", "Native calendar mappings are malformed.");
  }
  const mappings: Record<string, NativeCalendarEventMapping> = {};
  for (const [key, candidate] of Object.entries(root.mappings)) {
    const mapping = parseMapping(candidate);
    if (!mapping) {
      throw new NativeCalendarStorageError("corrupt", "A native calendar mapping is malformed.");
    }
    mappings[key] = mapping;
  }

  if (
    isRecord(root.integration)
    && root.integration.schemaVersion !== undefined
    && root.integration.schemaVersion !== NATIVE_CALENDAR_STORAGE_VERSION
  ) {
    throw new NativeCalendarStorageError(
      "unsupported_version",
      "Native calendar integration uses an unsupported schema version."
    );
  }
  const integration = root.integration === undefined ? undefined : parseIntegration(root.integration);
  if (root.integration !== undefined && !integration) {
    throw new NativeCalendarStorageError("corrupt", "Native calendar integration metadata is malformed.");
  }
  return { ...(integration ? { integration } : {}), mappings };
}

function parseIntegration(value: unknown): NativeCalendarIntegrationRecord | undefined {
  if (!isRecord(value)) return undefined;
  const enabled = booleanValue(value.enabled);
  const platform = value.platform === "ios" || value.platform === "android" ? value.platform : undefined;
  const userId = boundedString(value.userId, 512);
  const deviceId = boundedString(value.deviceId, 512);
  const deviceCalendarId = boundedString(value.deviceCalendarId, 512);
  const deviceCalendarTitle = boundedString(value.deviceCalendarTitle, 512);
  const autoSyncEnabled = booleanValue(value.autoSyncEnabled);
  const connectedAt = isoTimestamp(value.connectedAt);
  const updatedAt = isoTimestamp(value.updatedAt);
  if (
    enabled === undefined
    || !platform
    || !userId
    || !deviceId
    || !deviceCalendarId
    || !deviceCalendarTitle
    || autoSyncEnabled === undefined
    || !connectedAt
    || !updatedAt
  ) return undefined;

  const destinations = Array.isArray(value.deviceCalendars)
    ? value.deviceCalendars.map(parseDestination).filter((item): item is NativeCalendarDestination => Boolean(item))
    : [];
  const calendarIds = Array.isArray(value.deviceCalendarIds)
    ? uniqueStrings(value.deviceCalendarIds, 512)
    : [];
  const lastSyncResult = parseCounts(value.lastSyncResult);

  return {
    schemaVersion: 3,
    enabled,
    platform,
    userId,
    deviceId,
    deviceCalendarId,
    deviceCalendarTitle,
    deviceCalendarIds: calendarIds.length ? calendarIds : [deviceCalendarId],
    deviceCalendars: destinations.length ? destinations : [{
      id: deviceCalendarId,
      title: deviceCalendarTitle,
      provider: platform === "ios" ? "apple" : "device"
    }],
    autoSyncEnabled,
    reminderMinutesBefore: finiteNonNegativeNumbers(value.reminderMinutesBefore),
    connectedAt,
    updatedAt,
    ...(isoTimestamp(value.lastSyncStartedAt) ? { lastSyncStartedAt: isoTimestamp(value.lastSyncStartedAt)! } : {}),
    ...(isoTimestamp(value.lastSuccessfulSyncAt) ? { lastSuccessfulSyncAt: isoTimestamp(value.lastSuccessfulSyncAt)! } : {}),
    ...(lastSyncResult ? { lastSyncResult } : {})
  };
}

function parseDestination(value: unknown): NativeCalendarDestination | undefined {
  if (!isRecord(value)) return undefined;
  const id = boundedString(value.id, 512);
  const title = boundedString(value.title, 512);
  const provider = typeof value.provider === "string" && PROVIDERS.has(value.provider as NativeCalendarProvider)
    ? value.provider as NativeCalendarProvider
    : undefined;
  if (!id || !title || !provider) return undefined;
  return {
    id,
    title,
    provider,
    ...(boundedString(value.sourceName, 512) ? { sourceName: boundedString(value.sourceName, 512)! } : {}),
    ...(boundedString(value.sourceId, 512) ? { sourceId: boundedString(value.sourceId, 512)! } : {}),
    ...(boundedString(value.sourceType, 128) ? { sourceType: boundedString(value.sourceType, 128)! } : {}),
    ...(typeof value.isAppCalendar === "boolean" ? { isAppCalendar: value.isAppCalendar } : {})
  };
}

function parseMapping(value: unknown): NativeCalendarEventMapping | undefined {
  if (!isRecord(value)) return undefined;
  const appEventId = boundedString(value.appEventId, 512);
  const nativeEventId = boundedString(value.nativeEventId, 1024);
  const deviceCalendarId = boundedString(value.deviceCalendarId, 512);
  const eventHash = boundedString(value.eventHash, 128);
  const lastSyncedAt = isoTimestamp(value.lastSyncedAt);
  if (!appEventId || !nativeEventId || !deviceCalendarId || !eventHash || !lastSyncedAt) return undefined;

  const sourceId = boundedString(value.sourceId, 512);
  const sourceType = boundedString(value.sourceType, 64);
  const managedMarker = boundedString(value.managedMarker, 2048);
  const markerIdentity = managedMarker ? parseManagedEventMarker(managedMarker) : null;
  if (managedMarker && !markerIdentity) return undefined;
  if (markerIdentity && (
    (sourceId && sourceId !== markerIdentity.sourceId)
    || (sourceType && sourceType !== markerIdentity.sourceType)
  )) return undefined;

  const status = typeof value.status === "string" && MAPPING_STATUSES.has(value.status as NativeCalendarMappingStatus)
    ? value.status as NativeCalendarMappingStatus
    : undefined;
  const conflictReason = typeof value.conflictReason === "string"
    && CONFLICT_REASONS.has(value.conflictReason as NativeCalendarConflictReason)
    ? value.conflictReason as NativeCalendarConflictReason
    : undefined;

  return {
    appEventId,
    ...(sourceId || markerIdentity?.sourceId ? { sourceId: sourceId ?? markerIdentity!.sourceId } : {}),
    ...(sourceType || markerIdentity?.sourceType ? { sourceType: sourceType ?? markerIdentity!.sourceType } : {}),
    nativeEventId,
    deviceCalendarId,
    ...(managedMarker ? { managedMarker } : {}),
    eventHash,
    ...(boundedString(value.appliedEventHash, 128) ? { appliedEventHash: boundedString(value.appliedEventHash, 128)! } : {}),
    ...(status ? { status } : {}),
    ...(conflictReason ? { conflictReason } : {}),
    ...(boundedString(value.lastKnownStartDate, 64) ? { lastKnownStartDate: boundedString(value.lastKnownStartDate, 64)! } : {}),
    ...(boundedString(value.lastKnownEndDate, 64) ? { lastKnownEndDate: boundedString(value.lastKnownEndDate, 64)! } : {}),
    ...(typeof value.lastKnownAllDay === "boolean" ? { lastKnownAllDay: value.lastKnownAllDay } : {}),
    ...(boundedString(value.lastKnownTimezone, 128) ? { lastKnownTimezone: boundedString(value.lastKnownTimezone, 128)! } : {}),
    ...(isoTimestamp(value.lastKnownModifiedDate) ? { lastKnownModifiedDate: isoTimestamp(value.lastKnownModifiedDate)! } : {}),
    lastSyncedAt,
    ...(boundedString(value.lastError, 512) ? { lastError: boundedString(value.lastError, 512)! } : {})
  };
}

function parseCounts(value: unknown): NativeCalendarSyncCounts | undefined {
  if (!isRecord(value)) return undefined;
  const names = ["created", "updated", "skipped", "deleted", "recovered", "failed"] as const;
  if (names.some((name) => !isNonNegativeInteger(value[name]))) return undefined;
  return {
    created: value.created as number,
    updated: value.updated as number,
    skipped: value.skipped as number,
    deleted: value.deleted as number,
    recovered: value.recovered as number,
    conflicted: isNonNegativeInteger(value.conflicted) ? value.conflicted as number : 0,
    failed: value.failed as number
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

function finiteNonNegativeNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is number => typeof item === "number" && Number.isFinite(item) && item >= 0)
    .map((item) => Math.round(item)))]
    .sort((left, right) => left - right);
}

function uniqueStrings(value: unknown[], maxLength: number): string[] {
  return [...new Set(value.map((item) => boundedString(item, maxLength)).filter((item): item is string => Boolean(item)))];
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
