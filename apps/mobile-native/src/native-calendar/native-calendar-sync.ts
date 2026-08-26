import {
  applyManagedEventMarker,
  createEventFingerprint,
  createManagedEventMarker,
  createManagedPayloadFingerprint,
  createNativeCalendarOwnerHash,
  getNativeCalendarEventIdentity,
  managedEventMarkersMatch,
  parseManagedEventMarker,
  normalizeNativeCalendarSourceType
} from "./managed-event";
import { isNativeCalendarSafetyError, NativeCalendarSafetyError } from "./native-calendar-error";
import type {
  NativeCalendarConflictReason,
  NativeCalendarDeviceAdapter,
  NativeCalendarDeviceEventRef,
  NativeCalendarEventMapping,
  NativeCalendarEventSearchWindow,
  NativeCalendarIntegrationRecord,
  NativeCalendarOpenEventOptions,
  NativeCalendarPermissionState,
  NativeCalendarPlatform,
  NativeCalendarStorage,
  NativeCalendarStoredState,
  NativeCalendarSyncEvent,
  NativeCalendarSyncResult,
  NativeCalendarWritableCalendar
} from "./types";

export { createEventFingerprint } from "./managed-event";

export const NATIVE_CALENDAR_APP_TITLE = "Akademik Takvim";

export type NativeCalendarContext = {
  userId: string;
  platform: NativeCalendarPlatform;
  deviceId: string;
};

export type NativeCalendarConnectInput = NativeCalendarContext & {
  selectedCalendarId?: string;
  selectedCalendarIds?: string[];
  autoSyncEnabled?: boolean;
  reminderMinutesBefore?: number[];
};

export type NativeCalendarSyncInput = NativeCalendarContext & {
  events: NativeCalendarSyncEvent[];
  removeStale?: boolean;
  deletionEligibleSourceTypes?: string[];
};

export type NativeCalendarUpdateSettingsInput = NativeCalendarContext & {
  selectedCalendarId?: string;
  selectedCalendarIds?: string[];
  autoSyncEnabled?: boolean;
  reminderMinutesBefore?: number[];
};

export type NativeCalendarDisconnectInput = NativeCalendarContext & {
  removeNativeEvents?: boolean;
};

type ManagedRefResolution = {
  ref: NativeCalendarDeviceEventRef | null;
  recovered: boolean;
  markerMismatch: boolean;
};

export class NativeCalendarService {
  private readonly activeOperations = new Set<string>();

  constructor(
    private readonly adapter: NativeCalendarDeviceAdapter,
    private readonly storage: NativeCalendarStorage,
    private readonly now: () => Date = () => new Date()
  ) {}

  async isAvailable(context?: Pick<NativeCalendarContext, "platform">): Promise<boolean> {
    if (context?.platform && context.platform !== "ios") return false;
    return this.adapter.isAvailable ? this.adapter.isAvailable() : true;
  }

  async getPermissionStatus(): Promise<NativeCalendarPermissionState> {
    return this.adapter.getPermissionStatus();
  }

  async requestPermission(): Promise<NativeCalendarPermissionState> {
    return this.adapter.requestPermission();
  }

  async openSettings(): Promise<void> {
    await this.adapter.openSettings?.();
  }

  async listWritableCalendars(): Promise<NativeCalendarWritableCalendar[]> {
    return this.adapter.listWritableCalendars();
  }

  async loadState(context: NativeCalendarContext): Promise<NativeCalendarStoredState> {
    return this.storage.loadState(context);
  }

  async connect(input: NativeCalendarConnectInput): Promise<NativeCalendarStoredState> {
    return this.withOperation(input, async () => {
      const current = await this.storage.loadState(input);
      if (input.platform !== "ios") return current;
      if (current.integration) assertStateOwner(current.integration, input);
      assertMappingsOwner(current.mappings, input.userId);

      const permission = await this.adapter.requestPermission();
      if (!permission.granted) return current;

      const calendars = await this.adapter.listWritableCalendars();
      const requestedCalendarIds = requestedCalendarIdsFor(input, current.integration);
      if (requestedCalendarIds.length > 1) {
        throw new Error("Only one native calendar destination can be selected.");
      }

      const selected = requestedCalendarIds[0]
        ? calendars.find((calendar) => calendar.id === requestedCalendarIds[0] && calendar.allowsModifications)
        : undefined;
      if (requestedCalendarIds[0] && !selected) throw new Error("The selected native calendar is not writable.");
      const target = selected ?? await this.adapter.getOrCreateAppCalendar(NATIVE_CALENDAR_APP_TITLE);
      assertWritableCalendar(target);

      const timestamp = this.timestamp();
      const integration: NativeCalendarIntegrationRecord = {
        schemaVersion: 3,
        enabled: true,
        platform: "ios",
        userId: input.userId,
        deviceId: input.deviceId,
        deviceCalendarId: target.id,
        deviceCalendarTitle: target.title,
        deviceCalendarIds: [target.id],
        deviceCalendars: [toDestination(target)],
        autoSyncEnabled: input.autoSyncEnabled ?? current.integration?.autoSyncEnabled ?? false,
        reminderMinutesBefore: input.reminderMinutesBefore ?? current.integration?.reminderMinutesBefore ?? [],
        connectedAt: current.integration?.connectedAt ?? timestamp,
        updatedAt: timestamp
      };
      const next = { integration, mappings: current.mappings };
      await this.storage.saveState(input, next);
      return next;
    });
  }

  async updateSettings(input: NativeCalendarUpdateSettingsInput): Promise<NativeCalendarStoredState> {
    return this.withOperation(input, async () => {
      const state = await this.storage.loadState(input);
      if (!state.integration) return state;
      assertStateOwner(state.integration, input);

      let target = destinationToWritable(state.integration);
      if (input.selectedCalendarId !== undefined || input.selectedCalendarIds !== undefined) {
        const selectedIds = uniqueCalendarIds(
          input.selectedCalendarIds ?? (input.selectedCalendarId ? [input.selectedCalendarId] : [])
        );
        if (selectedIds.length !== 1) throw new Error("Exactly one writable native calendar must be selected.");
        const calendars = await this.adapter.listWritableCalendars();
        const selected = calendars.find((calendar) => calendar.id === selectedIds[0] && calendar.allowsModifications);
        if (!selected) throw new Error("The selected native calendar is not writable.");
        target = selected;
      }

      const integration: NativeCalendarIntegrationRecord = {
        ...state.integration,
        schemaVersion: 3,
        deviceCalendarId: target.id,
        deviceCalendarTitle: target.title,
        deviceCalendarIds: [target.id],
        deviceCalendars: [toDestination(target)],
        autoSyncEnabled: input.autoSyncEnabled ?? state.integration.autoSyncEnabled,
        reminderMinutesBefore: input.reminderMinutesBefore ?? state.integration.reminderMinutesBefore,
        updatedAt: this.timestamp()
      };
      const next = { integration, mappings: state.mappings };
      await this.storage.saveState(input, next);
      return next;
    });
  }

  async syncEvents(input: NativeCalendarSyncInput): Promise<NativeCalendarSyncResult> {
    return this.withOperation(input, async () => {
      await this.assertMutationAccess(input);
      const state = await this.storage.loadState(input);
      if (!state.integration?.enabled) throw new Error("Native calendar integration is not connected.");
      assertStateOwner(state.integration, input);

      const target = await this.resolveTargetCalendar(state.integration);
      const timestamp = this.timestamp();
      let integration: NativeCalendarIntegrationRecord = {
        ...state.integration,
        schemaVersion: 3,
        deviceCalendarId: target.id,
        deviceCalendarTitle: target.title,
        deviceCalendarIds: [target.id],
        deviceCalendars: [toDestination(target)],
        lastSyncStartedAt: timestamp,
        updatedAt: timestamp
      };
      const mappings = { ...state.mappings };
      const result = createEmptySyncResult();
      const desiredKeys = new Set<string>();
      const checkpoint = async () => this.storage.saveState(input, { integration, mappings });
      await checkpoint();

      for (const sourceEvent of input.events) {
        const managedEvent = applyManagedEventMarker(input.userId, sourceEvent);
        const identity = getNativeCalendarEventIdentity(managedEvent);
        const sourceKey = sourceIdentityKey(identity.sourceType, identity.sourceId);
        if (desiredKeys.has(sourceKey)) throw new Error("Duplicate native calendar source identity.");
        desiredKeys.add(sourceKey);

        const marker = createManagedEventMarker(input.userId, managedEvent);
        const sourceHash = createEventFingerprint(sourceEvent);
        const appliedHash = createManagedPayloadFingerprint(managedEvent);
        const existingMatch = findMapping(mappings, managedEvent, target.id);
        const existing = existingMatch?.mapping;

        try {
          if (existing) assertMappingOwner(existing, input.userId);
          const resolution = await this.resolveManagedRef(existing, marker, searchWindowForEvent(managedEvent));
          if (!resolution.ref) {
            if (existing) {
              const reason: NativeCalendarConflictReason = resolution.markerMismatch ? "marker_mismatch" : "user_deleted";
              upsertMapping(mappings, mappingWithConflict(existing, reason, timestamp));
              recordConflict(result, existing.appEventId, existing.nativeEventId, reason);
              await checkpoint();
              continue;
            }

            const nativeEventId = await this.adapter.createEvent(target.id, managedEvent);
            const mapping = createMapping(managedEvent, nativeEventId, target.id, marker, sourceHash, appliedHash, timestamp);
            upsertMapping(mappings, mapping);
            result.created += 1;
            await checkpoint();
            const verifiedRef = await this.verifyCreatedOrUpdatedEvent(mapping, marker, appliedHash);
            upsertMapping(mappings, mappingWithVerifiedRef(mapping, verifiedRef));
            await checkpoint();
            continue;
          }

          const ref = resolution.ref;
          if (!managedEventMarkersMatch(ref.managedMarker, marker)) {
            throw new NativeCalendarSafetyError("marker_mismatch", "Managed event marker mismatch.");
          }
          if (!ref.calendarId) throw new NativeCalendarSafetyError("moved_calendar", "Managed event calendar could not be verified.");

          const recoveredIdentity = resolution.recovered || !existing || existing.nativeEventId !== ref.id;
          const baseline = existing ?? createMapping(
            managedEvent,
            ref.id,
            ref.calendarId,
            marker,
            sourceHash,
            ref.eventHash ?? appliedHash,
            timestamp,
            ref
          );

          if (ref.calendarId !== target.id) {
            upsertMapping(mappings, mappingWithRefConflict(baseline, ref, "moved_calendar", timestamp));
            recordConflict(result, managedEvent.id, ref.id, "moved_calendar");
            await checkpoint();
            continue;
          }

          const expectedCurrentHash = existing?.appliedEventHash;
          const modificationBaselineMissing = Boolean(existing && !existing.lastKnownModifiedDate);
          const lastModifiedChanged = Boolean(
            existing?.lastKnownModifiedDate
            && ref.lastModifiedDate !== existing.lastKnownModifiedDate
          );
          const userModified = ref.destructiveSafety !== "verified"
            || modificationBaselineMissing
            || lastModifiedChanged
            || !ref.eventHash
            || (expectedCurrentHash ? ref.eventHash !== expectedCurrentHash : ref.eventHash !== appliedHash);
          if (userModified) {
            upsertMapping(mappings, mappingWithRefConflict(baseline, ref, "user_modified", timestamp));
            recordConflict(result, managedEvent.id, ref.id, "user_modified");
            await checkpoint();
            continue;
          }

          if (recoveredIdentity) result.recovered += 1;
          if (existing?.eventHash === sourceHash) {
            upsertMapping(mappings, createMapping(
              managedEvent,
              ref.id,
              target.id,
              marker,
              sourceHash,
              appliedHash,
              timestamp,
              ref
            ));
            if (!recoveredIdentity) result.skipped += 1;
            await checkpoint();
            continue;
          }

          const updatedId = await this.adapter.updateEvent(ref.id, target.id, managedEvent, marker) ?? ref.id;
          const updatedMapping = createMapping(
            managedEvent,
            updatedId,
            target.id,
            marker,
            sourceHash,
            appliedHash,
            timestamp
          );
          upsertMapping(mappings, updatedMapping);
          result.updated += 1;
          await checkpoint();
          const verifiedRef = await this.verifyCreatedOrUpdatedEvent(updatedMapping, marker, appliedHash);
          upsertMapping(mappings, mappingWithVerifiedRef(updatedMapping, verifiedRef));
          await checkpoint();
        } catch (error) {
          if (isNativeCalendarSafetyError(error)) {
            // Create/update checkpoints the real native ID before verification. Always
            // recover that latest ledger entry so a failed verification cannot orphan it.
            const checkpointed = findMapping(mappings, managedEvent, target.id)?.mapping;
            const fallback = checkpointed
              ?? existing
              ?? createUnresolvedMapping(managedEvent, target.id, marker, sourceHash, appliedHash, timestamp);
            upsertMapping(mappings, mappingWithConflict(fallback, error.reason, timestamp));
            recordConflict(result, managedEvent.id, fallback.nativeEventId, error.reason);
          } else {
            result.failed += 1;
            result.errors.push({ appEventId: managedEvent.id, message: safeErrorMessage(error), reason: "operation_failed" });
            if (existing) upsertMapping(mappings, { ...existing, lastError: safeErrorMessage(error) });
          }
          await checkpoint();
        }
      }

      const deletionEligible = new Set(
        input.removeStale === false
          ? []
          : (input.deletionEligibleSourceTypes ?? []).map(normalizeNativeCalendarSourceType)
      );
      for (const [mappingKey, mapping] of Object.entries({ ...mappings })) {
        const sourceType = mappingSourceType(mapping);
        const sourceId = mappingSourceId(mapping);
        if (desiredKeys.has(sourceIdentityKey(sourceType, sourceId))) continue;
        if (!deletionEligible.has(sourceType)) continue;

        try {
          assertMappingOwner(mapping, input.userId);
          const deleted = await this.deleteMappingIfUnmodified(mapping);
          if (deleted === "conflict") {
            const reason = mapping.conflictReason ?? "user_modified";
            upsertMapping(mappings, mappingWithConflict(mapping, reason, timestamp));
            recordConflict(result, mapping.appEventId, mapping.nativeEventId, reason);
          } else {
            delete mappings[mappingKey];
            if (deleted === "deleted") result.deleted += 1;
          }
        } catch (error) {
          if (isNativeCalendarSafetyError(error)) {
            upsertMapping(mappings, mappingWithConflict(mapping, error.reason, timestamp));
            recordConflict(result, mapping.appEventId, mapping.nativeEventId, error.reason);
          } else {
            result.failed += 1;
            result.errors.push({
              appEventId: mapping.appEventId,
              nativeEventId: mapping.nativeEventId,
              message: safeErrorMessage(error),
              reason: "operation_failed"
            });
            upsertMapping(mappings, { ...mapping, status: "delete_failed", lastError: safeErrorMessage(error) });
          }
        }
        await checkpoint();
      }

      integration = {
        ...integration,
        lastSyncResult: pickCounts(result),
        ...(result.failed === 0 && result.conflicted === 0 ? { lastSuccessfulSyncAt: timestamp } : {}),
        updatedAt: timestamp
      };
      await checkpoint();
      return result;
    });
  }

  async removeEvent(context: NativeCalendarContext, appEventId: string): Promise<void> {
    await this.withOperation(context, async () => {
      await this.assertMutationAccess(context);
      const state = await this.storage.loadState(context);
      if (state.integration) assertStateOwner(state.integration, context);
      const mappings = { ...state.mappings };
      const matches = Object.entries(mappings).filter(([, mapping]) => (
        mapping.appEventId === appEventId || mappingSourceId(mapping) === appEventId
      ));

      for (const [key, mapping] of matches) {
        assertMappingOwner(mapping, context.userId);
        const outcome = await this.deleteMappingIfUnmodified(mapping);
        if (outcome === "conflict") throw new NativeCalendarSafetyError(
          mapping.conflictReason ?? "user_modified",
          "A user-modified calendar event was preserved."
        );
        delete mappings[key];
      }
      await this.storage.saveState(context, { ...(state.integration ? { integration: state.integration } : {}), mappings });
    });
  }

  async openEvent(
    context: NativeCalendarContext,
    appEventId: string,
    options: NativeCalendarOpenEventOptions = {}
  ): Promise<void> {
    if (!this.adapter.openEvent) throw new Error("Opening native calendar events is unavailable.");
    await this.assertMutationAccess(context);
    const state = await this.storage.loadState(context);
    if (state.integration) assertStateOwner(state.integration, context);
    const mapping = Object.values(state.mappings).find((candidate) => (
      candidate.appEventId === appEventId || mappingSourceId(candidate) === appEventId
    ));
    if (!mapping?.managedMarker) throw new Error("Managed native calendar event was not found.");
    assertMappingOwner(mapping, context.userId);
    const resolution = await this.resolveManagedRef(mapping, mapping.managedMarker, searchWindowForMapping(mapping));
    if (!resolution.ref || !managedEventMarkersMatch(resolution.ref.managedMarker, mapping.managedMarker)) {
      throw new NativeCalendarSafetyError("user_deleted", "Managed native calendar event was removed.");
    }
    await this.adapter.openEvent(resolution.ref.id, mapping.managedMarker, options);
  }

  async disconnect(input: NativeCalendarDisconnectInput): Promise<NativeCalendarSyncResult> {
    return this.withOperation(input, async () => {
      const state = await this.storage.loadState(input);
      const result = createEmptySyncResult();
      if (!input.removeNativeEvents) {
        await this.storage.clearState(input);
        return result;
      }
      if (state.integration) assertStateOwner(state.integration, input);

      const mappings = { ...state.mappings };
      try {
        await this.assertMutationAccess(input);
      } catch (error) {
        for (const mapping of Object.values(mappings)) {
          mapping.status = "delete_failed";
          mapping.lastError = safeErrorMessage(error);
          result.failed += 1;
          result.errors.push({
            appEventId: mapping.appEventId,
            nativeEventId: mapping.nativeEventId,
            message: safeErrorMessage(error),
            reason: "operation_failed"
          });
        }
        await this.saveDisconnectedState(input, state.integration, mappings, result);
        return result;
      }

      for (const [key, mapping] of Object.entries({ ...mappings })) {
        try {
          assertMappingOwner(mapping, input.userId);
          const outcome = await this.deleteMappingIfUnmodified(mapping);
          if (outcome === "conflict") {
            const reason = mapping.conflictReason ?? "user_modified";
            upsertMapping(mappings, mappingWithConflict(mapping, reason, this.timestamp()));
            recordConflict(result, mapping.appEventId, mapping.nativeEventId, reason);
            continue;
          }
          delete mappings[key];
          if (outcome === "deleted") result.deleted += 1;
        } catch (error) {
          if (isNativeCalendarSafetyError(error)) {
            upsertMapping(mappings, mappingWithConflict(mapping, error.reason, this.timestamp()));
            recordConflict(result, mapping.appEventId, mapping.nativeEventId, error.reason);
          } else {
            result.failed += 1;
            result.errors.push({
              appEventId: mapping.appEventId,
              nativeEventId: mapping.nativeEventId,
              message: safeErrorMessage(error),
              reason: "operation_failed"
            });
            upsertMapping(mappings, { ...mapping, status: "delete_failed", lastError: safeErrorMessage(error) });
          }
        }
        await this.saveDisconnectedState(input, state.integration, mappings, result);
      }

      await this.saveDisconnectedState(input, state.integration, mappings, result);
      return result;
    });
  }

  private async resolveTargetCalendar(integration: NativeCalendarIntegrationRecord): Promise<NativeCalendarWritableCalendar> {
    const calendars = await this.adapter.listWritableCalendars();
    const current = calendars.find((calendar) => (
      calendar.id === integration.deviceCalendarId && calendar.allowsModifications
    ));
    if (current) return current;

    const destination = integration.deviceCalendars[0];
    if (destination?.isAppCalendar || integration.deviceCalendarTitle === NATIVE_CALENDAR_APP_TITLE) {
      const recovered = await this.adapter.getOrCreateAppCalendar(NATIVE_CALENDAR_APP_TITLE);
      assertWritableCalendar(recovered);
      return recovered;
    }
    throw new Error("The selected native calendar is no longer writable.");
  }

  private async resolveManagedRef(
    mapping: NativeCalendarEventMapping | undefined,
    marker: string,
    searchWindow: NativeCalendarEventSearchWindow | null
  ): Promise<ManagedRefResolution> {
    let markerMismatch = false;
    if (mapping?.nativeEventId) {
      const direct = await this.adapter.findEvent(mapping.nativeEventId, searchWindow ?? undefined);
      if (direct && managedEventMarkersMatch(direct.managedMarker, marker)) {
        return { ref: direct, recovered: false, markerMismatch: false };
      }
      markerMismatch = Boolean(direct);
    }

    if (searchWindow && this.adapter.findManagedEvent) {
      const recovered = await this.adapter.findManagedEvent(marker, searchWindow);
      if (recovered) {
        if (!managedEventMarkersMatch(recovered.managedMarker, marker)) {
          throw new NativeCalendarSafetyError("marker_mismatch", "Recovered native event marker mismatch.");
        }
        return { ref: recovered, recovered: true, markerMismatch };
      }
    }
    return { ref: null, recovered: false, markerMismatch };
  }

  private async verifyCreatedOrUpdatedEvent(
    mapping: NativeCalendarEventMapping,
    marker: string,
    appliedHash: string
  ): Promise<NativeCalendarDeviceEventRef> {
    const ref = await this.adapter.findEvent(mapping.nativeEventId, searchWindowForMapping(mapping) ?? undefined);
    if (!ref || !managedEventMarkersMatch(ref.managedMarker, marker)) {
      throw new NativeCalendarSafetyError("marker_mismatch", "Native calendar mutation could not be verified.");
    }
    if (
      ref.destructiveSafety !== "verified"
      || !ref.lastModifiedDate
      || !ref.eventHash
      || ref.eventHash !== appliedHash
    ) {
      throw new NativeCalendarSafetyError("user_modified", "Native calendar payload could not be verified.");
    }
    return ref;
  }

  private async deleteMappingIfUnmodified(
    mapping: NativeCalendarEventMapping
  ): Promise<"deleted" | "missing" | "conflict"> {
    if (mapping.status === "user_modified" || mapping.status === "moved") return "conflict";
    if (!mapping.managedMarker || !mapping.appliedEventHash) {
      throw new NativeCalendarSafetyError("marker_mismatch", "Legacy native event ownership cannot be verified.");
    }
    const resolution = await this.resolveManagedRef(
      mapping,
      mapping.managedMarker,
      searchWindowForMapping(mapping)
    );
    if (!resolution.ref) {
      if (resolution.markerMismatch) throw new NativeCalendarSafetyError("marker_mismatch", "Native event ID was reused.");
      return "missing";
    }
    if (resolution.ref.calendarId && resolution.ref.calendarId !== mapping.deviceCalendarId) {
      mapping.conflictReason = "moved_calendar";
      return "conflict";
    }
    if (
      resolution.ref.destructiveSafety !== "verified"
      || !mapping.lastKnownModifiedDate
      || !resolution.ref.lastModifiedDate
      || resolution.ref.lastModifiedDate !== mapping.lastKnownModifiedDate
      || !resolution.ref.eventHash
      || resolution.ref.eventHash !== mapping.appliedEventHash
    ) {
      mapping.conflictReason = "user_modified";
      return "conflict";
    }
    await this.adapter.deleteEvent(resolution.ref.id, mapping.managedMarker);
    return "deleted";
  }

  private async assertMutationAccess(context: NativeCalendarContext): Promise<void> {
    if (context.platform !== "ios") throw new Error("Native calendar integration is only available on iOS.");
    if (this.adapter.isAvailable && !await this.adapter.isAvailable()) {
      throw new Error("Native calendar integration is unavailable.");
    }
    const permission = await this.adapter.getPermissionStatus();
    if (!permission.granted || permission.status !== "authorized") {
      throw new Error("Calendar full-access permission is not granted.");
    }
  }

  private async saveDisconnectedState(
    context: NativeCalendarContext,
    integration: NativeCalendarIntegrationRecord | undefined,
    mappings: Record<string, NativeCalendarEventMapping>,
    result: NativeCalendarSyncResult
  ): Promise<void> {
    if (Object.keys(mappings).length === 0) {
      await this.storage.clearState(context);
      return;
    }
    const nextIntegration = integration ? {
      ...integration,
      schemaVersion: 3 as const,
      enabled: false,
      lastSyncResult: pickCounts(result),
      updatedAt: this.timestamp()
    } : undefined;
    await this.storage.saveState(context, { ...(nextIntegration ? { integration: nextIntegration } : {}), mappings });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private async withOperation<T>(context: NativeCalendarContext, run: () => Promise<T>): Promise<T> {
    const key = `${context.platform}\0${context.userId}\0${context.deviceId}`;
    if (this.activeOperations.has(key)) throw new Error("A native calendar operation is already in progress.");
    this.activeOperations.add(key);
    try {
      return await run();
    } finally {
      this.activeOperations.delete(key);
    }
  }
}

function requestedCalendarIdsFor(
  input: Pick<NativeCalendarConnectInput, "selectedCalendarId" | "selectedCalendarIds">,
  integration: NativeCalendarIntegrationRecord | undefined
): string[] {
  if (input.selectedCalendarIds !== undefined) return uniqueCalendarIds(input.selectedCalendarIds);
  if (input.selectedCalendarId) return [input.selectedCalendarId];
  return integration ? uniqueCalendarIds([integration.deviceCalendarId]) : [];
}

function destinationToWritable(integration: NativeCalendarIntegrationRecord): NativeCalendarWritableCalendar {
  const destination = integration.deviceCalendars[0];
  return {
    id: destination?.id ?? integration.deviceCalendarId,
    title: destination?.title ?? integration.deviceCalendarTitle,
    provider: destination?.provider ?? "apple",
    allowsModifications: true,
    ...(destination?.sourceName ? { sourceName: destination.sourceName } : {}),
    ...(destination?.sourceId ? { sourceId: destination.sourceId } : {}),
    ...(destination?.sourceType ? { sourceType: destination.sourceType } : {}),
    ...(destination?.isAppCalendar !== undefined ? { isAppCalendar: destination.isAppCalendar } : {})
  };
}

function uniqueCalendarIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toDestination(calendar: NativeCalendarWritableCalendar) {
  return {
    id: calendar.id,
    title: calendar.title,
    provider: calendar.provider,
    ...(calendar.sourceName ? { sourceName: calendar.sourceName } : {}),
    ...(calendar.sourceId ? { sourceId: calendar.sourceId } : {}),
    ...(calendar.sourceType ? { sourceType: calendar.sourceType } : {}),
    ...(calendar.isAppCalendar !== undefined ? { isAppCalendar: calendar.isAppCalendar } : {})
  };
}

function assertWritableCalendar(calendar: NativeCalendarWritableCalendar): void {
  if (!calendar.id.trim() || !calendar.title.trim() || !calendar.allowsModifications) {
    throw new Error("No writable native calendar was found.");
  }
}

function assertStateOwner(integration: NativeCalendarIntegrationRecord, context: NativeCalendarContext): void {
  if (
    integration.userId !== context.userId
    || integration.deviceId !== context.deviceId
    || integration.platform !== context.platform
  ) throw new Error("Native calendar state owner changed.");
}

function assertMappingsOwner(
  mappings: Record<string, NativeCalendarEventMapping>,
  userId: string
): void {
  for (const mapping of Object.values(mappings)) assertMappingOwner(mapping, userId);
}

function assertMappingOwner(mapping: NativeCalendarEventMapping, userId: string): void {
  const marker = parseManagedEventMarker(mapping.managedMarker);
  if (
    !marker
    || marker.ownerHash !== createNativeCalendarOwnerHash(userId)
    || marker.sourceType !== mappingSourceType(mapping)
    || marker.sourceId !== mappingSourceId(mapping)
  ) {
    throw new NativeCalendarSafetyError("marker_mismatch", "Native calendar mapping owner could not be verified.");
  }
}

function findMapping(
  mappings: Record<string, NativeCalendarEventMapping>,
  event: NativeCalendarSyncEvent,
  targetCalendarId: string
): { key: string; mapping: NativeCalendarEventMapping } | undefined {
  const identity = getNativeCalendarEventIdentity(event);
  const matches = Object.entries(mappings).filter(([, mapping]) => (
    mapping.appEventId === event.id
    || (mappingSourceType(mapping) === identity.sourceType && mappingSourceId(mapping) === identity.sourceId)
  ));
  const match = matches.find(([, mapping]) => mapping.deviceCalendarId === targetCalendarId)
    ?? matches[0];
  return match ? { key: match[0], mapping: match[1] } : undefined;
}

function upsertMapping(
  mappings: Record<string, NativeCalendarEventMapping>,
  mapping: NativeCalendarEventMapping
): void {
  for (const [key, candidate] of Object.entries(mappings)) {
    if (
      candidate.appEventId === mapping.appEventId
      || (mappingSourceType(candidate) === mappingSourceType(mapping) && mappingSourceId(candidate) === mappingSourceId(mapping))
    ) delete mappings[key];
  }
  mappings[mappingKey(mapping)] = mapping;
}

function mappingKey(mapping: NativeCalendarEventMapping): string {
  return JSON.stringify([mappingSourceType(mapping), mappingSourceId(mapping), mapping.deviceCalendarId]);
}

function mappingSourceType(mapping: NativeCalendarEventMapping): string {
  return normalizeNativeCalendarSourceType(mapping.sourceType ?? sourceTypeFromAppEventId(mapping.appEventId));
}

function mappingSourceId(mapping: NativeCalendarEventMapping): string {
  return mapping.sourceId?.trim() || mapping.appEventId;
}

function sourceTypeFromAppEventId(appEventId: string): string {
  const separator = appEventId.indexOf(":");
  return separator > 0 ? appEventId.slice(0, separator) : "event";
}

function sourceIdentityKey(sourceType: string, sourceId: string): string {
  return JSON.stringify([normalizeNativeCalendarSourceType(sourceType), sourceId]);
}

function createMapping(
  event: NativeCalendarSyncEvent,
  nativeEventId: string,
  calendarId: string,
  marker: string,
  sourceHash: string,
  appliedHash: string,
  timestamp: string,
  verifiedRef?: NativeCalendarDeviceEventRef
): NativeCalendarEventMapping {
  const identity = getNativeCalendarEventIdentity(event);
  return {
    appEventId: event.id,
    sourceId: identity.sourceId,
    sourceType: identity.sourceType,
    nativeEventId,
    deviceCalendarId: calendarId,
    managedMarker: marker,
    eventHash: sourceHash,
    appliedEventHash: appliedHash,
    status: "managed",
    lastKnownStartDate: event.startDate,
    ...(event.endDate ? { lastKnownEndDate: event.endDate } : {}),
    lastKnownAllDay: event.allDay ?? false,
    ...(event.timezone ? { lastKnownTimezone: event.timezone } : {}),
    ...(verifiedRef?.lastModifiedDate ? { lastKnownModifiedDate: verifiedRef.lastModifiedDate } : {}),
    lastSyncedAt: timestamp
  };
}

function mappingWithVerifiedRef(
  mapping: NativeCalendarEventMapping,
  ref: NativeCalendarDeviceEventRef
): NativeCalendarEventMapping {
  return {
    ...mapping,
    nativeEventId: ref.id,
    ...(ref.calendarId ? { deviceCalendarId: ref.calendarId } : {}),
    ...(ref.lastModifiedDate ? { lastKnownModifiedDate: ref.lastModifiedDate } : {}),
    status: "managed",
    conflictReason: undefined,
    lastError: undefined
  };
}

function createUnresolvedMapping(
  event: NativeCalendarSyncEvent,
  calendarId: string,
  marker: string,
  sourceHash: string,
  appliedHash: string,
  timestamp: string
): NativeCalendarEventMapping {
  return createMapping(event, `unresolved:${marker.slice(-24)}`, calendarId, marker, sourceHash, appliedHash, timestamp);
}

function mappingWithConflict(
  mapping: NativeCalendarEventMapping,
  reason: NativeCalendarConflictReason,
  timestamp: string
): NativeCalendarEventMapping {
  return {
    ...mapping,
    status: statusForConflict(reason),
    conflictReason: reason,
    lastSyncedAt: timestamp,
    lastError: conflictMessage(reason)
  };
}

function mappingWithRefConflict(
  mapping: NativeCalendarEventMapping,
  ref: NativeCalendarDeviceEventRef,
  reason: NativeCalendarConflictReason,
  timestamp: string
): NativeCalendarEventMapping {
  return mappingWithConflict({
    ...mapping,
    nativeEventId: ref.id,
    ...(ref.calendarId ? { deviceCalendarId: ref.calendarId } : {}),
    ...(ref.lastModifiedDate ? { lastKnownModifiedDate: ref.lastModifiedDate } : {})
  }, reason, timestamp);
}

function statusForConflict(reason: NativeCalendarConflictReason): NativeCalendarEventMapping["status"] {
  if (reason === "user_deleted") return "user_deleted";
  if (reason === "moved_calendar") return "moved";
  return "user_modified";
}

function recordConflict(
  result: NativeCalendarSyncResult,
  appEventId: string,
  nativeEventId: string | undefined,
  reason: NativeCalendarConflictReason
): void {
  result.conflicted += 1;
  result.errors.push({
    appEventId,
    ...(nativeEventId ? { nativeEventId } : {}),
    message: conflictMessage(reason),
    reason
  });
}

function conflictMessage(reason: NativeCalendarConflictReason): string {
  switch (reason) {
    case "user_deleted": return "The managed calendar event was deleted by the user and was preserved as deleted.";
    case "user_modified": return "The managed calendar event was modified by the user and was not overwritten.";
    case "moved_calendar": return "The managed calendar event was moved and was not changed.";
    case "ambiguous_marker": return "More than one calendar event has the same managed marker.";
    case "marker_mismatch": return "The native event ownership marker could not be verified.";
  }
}

function searchWindowForEvent(event: NativeCalendarSyncEvent): NativeCalendarEventSearchWindow {
  return {
    startDate: event.startDate,
    ...(event.endDate ? { endDate: event.endDate } : {}),
    allDay: event.allDay ?? false,
    ...(event.timezone ? { timezone: event.timezone } : {})
  };
}

function searchWindowForMapping(mapping: NativeCalendarEventMapping): NativeCalendarEventSearchWindow | null {
  if (!mapping.lastKnownStartDate) return null;
  return {
    startDate: mapping.lastKnownStartDate,
    ...(mapping.lastKnownEndDate ? { endDate: mapping.lastKnownEndDate } : {}),
    allDay: mapping.lastKnownAllDay ?? false,
    ...(mapping.lastKnownTimezone ? { timezone: mapping.lastKnownTimezone } : {})
  };
}

function createEmptySyncResult(): NativeCalendarSyncResult {
  return {
    created: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
    recovered: 0,
    conflicted: 0,
    failed: 0,
    errors: []
  };
}

function pickCounts(result: NativeCalendarSyncResult) {
  const { created, updated, skipped, deleted, recovered, conflicted, failed } = result;
  return { created, updated, skipped, deleted, recovered, conflicted, failed };
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || !error.message.trim()) return "Native calendar operation failed.";
  return error.message.replace(/[\r\n]+/gu, " ").slice(0, 240);
}
