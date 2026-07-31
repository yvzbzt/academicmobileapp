import {
  GOOGLE_CALENDAR_SOURCE_TYPES,
  buildGoogleCalendarSyncItems,
  type GoogleCalendarAcademicEvent,
  type GoogleCalendarAnnouncement,
  type GoogleCalendarEventMapping,
  type GoogleCalendarSourceType,
  type GoogleCalendarSyncItem
} from "./google-calendar-sync";

export const GOOGLE_CALENDAR_CONNECTION_SCHEMA_VERSION = 3 as const;

export type GoogleCalendarLifecycleState =
  | "disconnected"
  | "checking"
  | "connected"
  | "expired"
  | "syncing"
  | "partial"
  | "error";

export type GoogleCalendarConnectionRecordV3 = {
  schemaVersion: typeof GOOGLE_CALENDAR_CONNECTION_SCHEMA_VERSION;
  ownerId: string;
  googleAccountId: string;
  accountEmail: string;
  state: GoogleCalendarLifecycleState;
  authorizationVerifiedAt?: string;
  lastSyncedAt?: string;
  mappings: GoogleCalendarEventMapping[];
};

export type GoogleCalendarMappingDuplicates = {
  sourceKeys: string[];
  googleEventIds: string[];
  hasDuplicates: boolean;
};

export type GoogleCalendarExactMappingLookup = {
  sourceType: GoogleCalendarSourceType;
  sourceId: string;
  recordId: string;
};

export type GoogleCalendarExactMappingLookupPlan = {
  lookups: GoogleCalendarExactMappingLookup[];
  malformedSourceTypes: GoogleCalendarSourceType[];
};

export function googleCalendarDeletionCandidateSourceTypes(input: {
  calendarSourceStatus?: "parsed" | "source_only";
  announcementState?: "fresh" | "partial" | "stale" | "error" | "empty";
}): GoogleCalendarSourceType[] {
  return [
    ...(input.calendarSourceStatus === "parsed" ? ["academic_event" as const] : []),
    ...(input.announcementState === "fresh" ? ["announcement" as const, "event" as const] : [])
  ];
}

export type GoogleCalendarNetworkState = {
  isConnected: boolean;
  isInternetReachable?: boolean | null;
};

export type GoogleCalendarPreflightBlockReason =
  | "duplicate_sync"
  | "owner_changed"
  | "academic_profile_missing"
  | "no_content"
  | "network_unavailable"
  | "network_check_failed"
  | "authorization_failed";

export type GoogleCalendarPreflightInput = {
  ownerId: string;
  activeOwnerId: string;
  operationInProgress: boolean;
  academicProfile: { universityId?: string | null } | null;
  calendarEvents: GoogleCalendarAcademicEvent[];
  trustedAnnouncements: GoogleCalendarAnnouncement[];
  deletionEligibleSourceTypes?: GoogleCalendarSourceType[];
  /** Allows an existing verified connection to remove its last stale items without opening consent UI. */
  hasManagedMappingsForCleanup?: boolean;
};

export type GoogleCalendarPreflightResult =
  | {
    ready: true;
    items: GoogleCalendarSyncItem[];
    deletionEligibleSourceTypes: GoogleCalendarSourceType[];
  }
  | { ready: false; reason: GoogleCalendarPreflightBlockReason };

export type GoogleCalendarNetworkProvider = {
  getState(signal?: AbortSignal): Promise<GoogleCalendarNetworkState>;
};

export type GoogleCalendarAuthorizationProvider<TAuthorization> = {
  authorize(signal?: AbortSignal): Promise<TAuthorization>;
};

export type GoogleCalendarAuthorizedPreflightResult<TAuthorization> =
  | {
    ready: true;
    items: GoogleCalendarSyncItem[];
    deletionEligibleSourceTypes: GoogleCalendarSourceType[];
    authorization: TAuthorization;
  }
  | { ready: false; reason: GoogleCalendarPreflightBlockReason };

export type GoogleCalendarLifecycleIntent =
  | "disconnect_only"
  | "disconnect_and_remove"
  | "revoke_access"
  | "account_switch_leave_managed_events"
  | "account_switch_remove_managed_events"
  | "logout"
  | "personal_data_deletion"
  | "account_deletion";

export type GoogleCalendarLifecycleStep =
  | "read_current_authorization"
  | "request_authorization_for_removal"
  | "remove_managed_events"
  | "revoke_access"
  | "sign_out"
  | "persist_disconnected_metadata"
  | "clear_connection_metadata"
  | "select_account";

export type GoogleCalendarLifecyclePolicy = Readonly<{
  intent: GoogleCalendarLifecycleIntent;
  authorizationMode: "none" | "current_only" | "interactive_for_removal";
  preservesManagedEvents: boolean;
  preservesGrant: boolean;
  steps: readonly GoogleCalendarLifecycleStep[];
}>;

export type GoogleCalendarLifecycleExecutionResult =
  | {
    complete: true;
    completedSteps: GoogleCalendarLifecycleStep[];
  }
  | {
    complete: false;
    reason: "owner_changed";
    completedSteps: GoogleCalendarLifecycleStep[];
  }
  | {
    complete: false;
    reason: "step_failed";
    failedStep: GoogleCalendarLifecycleStep;
    completedSteps: GoogleCalendarLifecycleStep[];
    error: unknown;
  };

/**
 * One explicit policy table for every lifecycle exit. In particular, revoke
 * and deletion use only an already-authorized provider session; they never
 * open consent UI merely to remove access.
 */
export function planGoogleCalendarLifecycle(
  intent: GoogleCalendarLifecycleIntent
): GoogleCalendarLifecyclePolicy {
  switch (intent) {
    case "disconnect_only":
      return Object.freeze({
        intent,
        authorizationMode: "none",
        preservesManagedEvents: true,
        preservesGrant: true,
        steps: Object.freeze(["sign_out", "persist_disconnected_metadata"] as const)
      });
    case "disconnect_and_remove":
      return Object.freeze({
        intent,
        authorizationMode: "interactive_for_removal",
        preservesManagedEvents: false,
        preservesGrant: true,
        steps: Object.freeze([
          "request_authorization_for_removal",
          "remove_managed_events",
          "sign_out",
          "clear_connection_metadata"
        ] as const)
      });
    case "revoke_access":
      return Object.freeze({
        intent,
        authorizationMode: "current_only",
        preservesManagedEvents: true,
        preservesGrant: false,
        steps: Object.freeze([
          "read_current_authorization",
          "revoke_access",
          "persist_disconnected_metadata"
        ] as const)
      });
    case "account_switch_leave_managed_events":
      return Object.freeze({
        intent,
        authorizationMode: "none",
        preservesManagedEvents: true,
        preservesGrant: true,
        steps: Object.freeze(["sign_out", "persist_disconnected_metadata", "select_account"] as const)
      });
    case "account_switch_remove_managed_events":
      return Object.freeze({
        intent,
        authorizationMode: "interactive_for_removal",
        preservesManagedEvents: false,
        preservesGrant: true,
        steps: Object.freeze([
          "request_authorization_for_removal",
          "remove_managed_events",
          "sign_out",
          "clear_connection_metadata",
          "select_account"
        ] as const)
      });
    case "logout":
      return Object.freeze({
        intent,
        authorizationMode: "none",
        preservesManagedEvents: true,
        preservesGrant: true,
        steps: Object.freeze(["clear_connection_metadata", "sign_out"] as const)
      });
    case "personal_data_deletion":
    case "account_deletion":
      return Object.freeze({
        intent,
        authorizationMode: "current_only",
        preservesManagedEvents: false,
        preservesGrant: false,
        steps: Object.freeze([
          "read_current_authorization",
          "remove_managed_events",
          "revoke_access",
          "clear_connection_metadata",
          "sign_out"
        ] as const)
      });
  }
}

/**
 * Executes policy steps in order and stops before any dependent mutation when
 * a step fails or the owning app session changes. Provider errors are returned
 * to the caller but are never stringified or logged here.
 */
export async function executeGoogleCalendarLifecycle(
  policy: GoogleCalendarLifecyclePolicy,
  dependencies: {
    isOwnerCurrent: () => boolean;
    runStep: (step: GoogleCalendarLifecycleStep) => void | Promise<void>;
  }
): Promise<GoogleCalendarLifecycleExecutionResult> {
  const completedSteps: GoogleCalendarLifecycleStep[] = [];
  for (const step of policy.steps) {
    if (!dependencies.isOwnerCurrent()) {
      return { complete: false, reason: "owner_changed", completedSteps };
    }
    try {
      await dependencies.runStep(step);
    } catch (error) {
      return { complete: false, reason: "step_failed", failedStep: step, completedSteps, error };
    }
    completedSteps.push(step);
    if (!dependencies.isOwnerCurrent()) {
      return { complete: false, reason: "owner_changed", completedSteps };
    }
  }
  return { complete: true, completedSteps };
}

/**
 * Parses only the durable, non-secret v3 contract. Unknown fields (including
 * accidentally supplied credentials) are discarded rather than reserialized.
 */
export function readGoogleCalendarConnectionRecordV3(
  value: string | unknown,
  expectedOwnerId: string
): GoogleCalendarConnectionRecordV3 | null {
  let candidate: unknown = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(candidate)) return null;
  if (candidate.schemaVersion !== GOOGLE_CALENDAR_CONNECTION_SCHEMA_VERSION) return null;
  if (!isNonEmptyString(candidate.ownerId) || candidate.ownerId !== expectedOwnerId) return null;
  if (!isNonEmptyString(candidate.googleAccountId) || !isNonEmptyString(candidate.accountEmail)) return null;
  if (!isLifecycleState(candidate.state) || !Array.isArray(candidate.mappings)) return null;

  const mappings = candidate.mappings.flatMap((mapping) => {
    if (!isRecord(mapping)) return [];
    if (
      !isNonEmptyString(mapping.sourceId)
      || !isGoogleCalendarSourceType(mapping.sourceType)
      || !isNonEmptyString(mapping.googleEventId)
      || !isNonEmptyString(mapping.fingerprint)
    ) {
      return [];
    }
    return [{
      sourceId: mapping.sourceId,
      sourceType: mapping.sourceType,
      googleEventId: mapping.googleEventId,
      fingerprint: mapping.fingerprint
    }];
  });
  if (mappings.length !== candidate.mappings.length) return null;
  if (findDuplicateGoogleCalendarMappings(mappings).hasDuplicates) return null;

  const authorizationVerifiedAt = readIsoTimestamp(candidate.authorizationVerifiedAt);
  const lastSyncedAt = readIsoTimestamp(candidate.lastSyncedAt);
  if (candidate.authorizationVerifiedAt !== undefined && !authorizationVerifiedAt) return null;
  if (candidate.lastSyncedAt !== undefined && !lastSyncedAt) return null;
  if ((candidate.state === "connected" || candidate.state === "partial") && !authorizationVerifiedAt) {
    return null;
  }

  return {
    schemaVersion: GOOGLE_CALENDAR_CONNECTION_SCHEMA_VERSION,
    ownerId: candidate.ownerId,
    googleAccountId: candidate.googleAccountId,
    accountEmail: candidate.accountEmail,
    state: candidate.state,
    ...(authorizationVerifiedAt ? { authorizationVerifiedAt } : {}),
    ...(lastSyncedAt ? { lastSyncedAt } : {}),
    mappings
  };
}

export function findDuplicateGoogleCalendarMappings(
  mappings: readonly GoogleCalendarEventMapping[]
): GoogleCalendarMappingDuplicates {
  const sourceCounts = new Map<string, number>();
  const eventCounts = new Map<string, number>();
  for (const mapping of mappings) {
    const sourceKey = JSON.stringify([mapping.sourceType, mapping.sourceId]);
    sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) ?? 0) + 1);
    eventCounts.set(mapping.googleEventId, (eventCounts.get(mapping.googleEventId) ?? 0) + 1);
  }
  const sourceKeys = [...sourceCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
  const googleEventIds = [...eventCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
  return {
    sourceKeys,
    googleEventIds,
    hasDuplicates: sourceKeys.length > 0 || googleEventIds.length > 0
  };
}

/**
 * Plans exact backend lookups for managed mappings omitted by a capped
 * collection response. Malformed source IDs block deletion for that family.
 */
export function planGoogleCalendarExactMappingLookups(
  mappings: readonly GoogleCalendarEventMapping[],
  desiredItems: readonly Pick<GoogleCalendarSyncItem, "sourceId" | "sourceType">[],
  candidateSourceTypes: readonly GoogleCalendarSourceType[]
): GoogleCalendarExactMappingLookupPlan {
  const candidates = new Set(candidateSourceTypes);
  const desiredIds = new Set(desiredItems.map((item) => `${item.sourceType}\0${item.sourceId}`));
  const lookups = new Map<string, GoogleCalendarExactMappingLookup>();
  const malformedSourceTypes = new Set<GoogleCalendarSourceType>();

  for (const mapping of mappings) {
    if (!candidates.has(mapping.sourceType)) continue;
    if (desiredIds.has(`${mapping.sourceType}\0${mapping.sourceId}`)) continue;
    const prefix = mapping.sourceType === "academic_event"
      ? "academic-event:"
      : `${mapping.sourceType}:`;
    if (!mapping.sourceId.startsWith(prefix) || mapping.sourceId.length === prefix.length) {
      malformedSourceTypes.add(mapping.sourceType);
      continue;
    }
    const recordId = mapping.sourceId.slice(prefix.length);
    lookups.set(`${mapping.sourceType}\0${recordId}`, {
      sourceType: mapping.sourceType,
      sourceId: mapping.sourceId,
      recordId
    });
  }

  return {
    lookups: [...lookups.values()].sort((left, right) => (
      left.sourceType.localeCompare(right.sourceType, "en-US")
      || left.recordId.localeCompare(right.recordId, "en-US")
    )),
    malformedSourceTypes: [...malformedSourceTypes]
      .sort((left, right) => left.localeCompare(right, "en-US"))
  };
}

export function evaluateGoogleCalendarPreflight(
  input: GoogleCalendarPreflightInput,
  networkState: GoogleCalendarNetworkState
): GoogleCalendarPreflightResult {
  const contentGate = evaluateContentGates(input);
  if (!contentGate.ready) return contentGate;
  if (!networkState.isConnected || networkState.isInternetReachable === false) {
    return { ready: false, reason: "network_unavailable" };
  }
  return contentGate;
}

/**
 * Provider authorization is invoked only after owner/profile/content/network
 * gates pass. Provider exceptions are reduced to a controlled outcome.
 */
export async function authorizeAfterGoogleCalendarPreflight<TAuthorization>(
  input: GoogleCalendarPreflightInput,
  dependencies: {
    network: GoogleCalendarNetworkProvider;
    authorization: GoogleCalendarAuthorizationProvider<TAuthorization>;
  },
  signal?: AbortSignal
): Promise<GoogleCalendarAuthorizedPreflightResult<TAuthorization>> {
  const contentGate = evaluateContentGates(input);
  if (!contentGate.ready) return contentGate;

  let networkState: GoogleCalendarNetworkState;
  try {
    networkState = await dependencies.network.getState(signal);
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    return { ready: false, reason: "network_check_failed" };
  }
  const networkGate = evaluateGoogleCalendarPreflight(input, networkState);
  if (!networkGate.ready) return networkGate;

  try {
    const authorization = await dependencies.authorization.authorize(signal);
    return { ...networkGate, authorization };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    return { ready: false, reason: "authorization_failed" };
  }
}

export type GoogleCalendarAccountSwitchChoice =
  | "cancel"
  | "leave_managed_events"
  | "remove_managed_events";

export type GoogleCalendarAccountSwitchStep =
  | "remove_managed_events"
  | "disconnect"
  | "select_account";

export function planGoogleCalendarAccountSwitch(choice: GoogleCalendarAccountSwitchChoice): {
  proceed: boolean;
  removeManagedEvents: boolean;
  steps: GoogleCalendarAccountSwitchStep[];
} {
  if (choice === "cancel") return { proceed: false, removeManagedEvents: false, steps: [] };
  if (choice === "remove_managed_events") {
    return {
      proceed: true,
      removeManagedEvents: true,
      steps: ["remove_managed_events", "disconnect", "select_account"]
    };
  }
  return {
    proceed: true,
    removeManagedEvents: false,
    steps: ["disconnect", "select_account"]
  };
}

export type GoogleCalendarOperationSnapshot = Readonly<{
  ownerId: string;
  epoch: number;
  operationId: number;
}>;

export type GoogleCalendarSettlement<T> =
  | { accepted: true; value: T }
  | { accepted: false; reason: "owner_changed" | "epoch_changed" | "operation_replaced" };

/** Owner/epoch guard for non-abortable native SDK completion and duplicate sync. */
export class GoogleCalendarLifecycleGuard {
  private ownerId: string | null = null;
  private epoch = 0;
  private operationSequence = 0;
  private activeOperation: GoogleCalendarOperationSnapshot | null = null;

  activate(ownerId: string): void {
    const normalized = requireNonEmpty(ownerId);
    this.ownerId = normalized;
    this.epoch += 1;
    this.activeOperation = null;
  }

  invalidate(): void {
    this.ownerId = null;
    this.epoch += 1;
    this.activeOperation = null;
  }

  begin(ownerId: string): GoogleCalendarOperationSnapshot | null {
    if (!this.ownerId || this.ownerId !== ownerId) return null;
    if (this.activeOperation?.epoch === this.epoch) return null;
    this.operationSequence += 1;
    this.activeOperation = Object.freeze({
      ownerId,
      epoch: this.epoch,
      operationId: this.operationSequence
    });
    return this.activeOperation;
  }

  isCurrent(snapshot: GoogleCalendarOperationSnapshot | null | undefined): boolean {
    return Boolean(
      snapshot
      && this.ownerId === snapshot.ownerId
      && this.epoch === snapshot.epoch
      && this.activeOperation?.operationId === snapshot.operationId
    );
  }

  settle<T>(snapshot: GoogleCalendarOperationSnapshot, value: T): GoogleCalendarSettlement<T> {
    let rejection: GoogleCalendarSettlement<T> | null = null;
    if (this.ownerId !== snapshot.ownerId) rejection = { accepted: false, reason: "owner_changed" };
    else if (this.epoch !== snapshot.epoch) rejection = { accepted: false, reason: "epoch_changed" };
    else if (this.activeOperation?.operationId !== snapshot.operationId) {
      rejection = { accepted: false, reason: "operation_replaced" };
    }
    if (this.activeOperation?.operationId === snapshot.operationId) this.activeOperation = null;
    return rejection ?? { accepted: true, value };
  }

  /** Releases a current or failed operation without accepting a settlement value. */
  finish(snapshot: GoogleCalendarOperationSnapshot): void {
    if (this.activeOperation?.operationId === snapshot.operationId) this.activeOperation = null;
  }
}

function evaluateContentGates(input: GoogleCalendarPreflightInput): GoogleCalendarPreflightResult {
  if (input.operationInProgress) return { ready: false, reason: "duplicate_sync" };
  if (!input.ownerId.trim() || input.ownerId !== input.activeOwnerId) {
    return { ready: false, reason: "owner_changed" };
  }
  if (!input.academicProfile?.universityId?.trim()) {
    return { ready: false, reason: "academic_profile_missing" };
  }
  const items = buildGoogleCalendarSyncItems(input.calendarEvents, input.trustedAnnouncements);
  if (items.length === 0 && !input.hasManagedMappingsForCleanup) {
    return { ready: false, reason: "no_content" };
  }
  return {
    ready: true,
    items,
    deletionEligibleSourceTypes: uniqueSourceTypes(
      input.deletionEligibleSourceTypes ?? GOOGLE_CALENDAR_SOURCE_TYPES
    )
  };
}

function uniqueSourceTypes(values: readonly GoogleCalendarSourceType[]): GoogleCalendarSourceType[] {
  return GOOGLE_CALENDAR_SOURCE_TYPES.filter((sourceType) => values.includes(sourceType));
}

function isGoogleCalendarSourceType(value: unknown): value is GoogleCalendarSourceType {
  return typeof value === "string" && GOOGLE_CALENDAR_SOURCE_TYPES.some((candidate) => candidate === value);
}

function isLifecycleState(value: unknown): value is GoogleCalendarLifecycleState {
  return value === "disconnected"
    || value === "checking"
    || value === "connected"
    || value === "expired"
    || value === "syncing"
    || value === "partial"
    || value === "error";
}

function readIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function requireNonEmpty(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("A Google Calendar lifecycle owner is required.");
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
