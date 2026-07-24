import type {
  NativeCalendarDeviceAdapter,
  NativeCalendarEventMapping,
  NativeCalendarIntegrationRecord,
  NativeCalendarPermissionState,
  NativeCalendarPlatform,
  NativeCalendarStorage,
  NativeCalendarStoredState,
  NativeCalendarSyncEvent,
  NativeCalendarSyncResult,
  NativeCalendarWritableCalendar
} from "./types";

const APP_CALENDAR_TITLE = "Academic Mobile App";

type NativeCalendarContext = {
  userId: string;
  platform: NativeCalendarPlatform;
  deviceId: string;
};

type ConnectInput = NativeCalendarContext & {
  selectedCalendarId?: string;
  selectedCalendarIds?: string[];
  autoSyncEnabled?: boolean;
  reminderMinutesBefore?: number[];
};

type SyncInput = NativeCalendarContext & {
  events: NativeCalendarSyncEvent[];
  removeStale?: boolean;
};

type UpdateSettingsInput = NativeCalendarContext & {
  selectedCalendarId?: string;
  selectedCalendarIds?: string[];
  autoSyncEnabled?: boolean;
  reminderMinutesBefore?: number[];
};

type DisconnectInput = NativeCalendarContext & {
  removeNativeEvents?: boolean;
};

export class NativeCalendarService {
  constructor(
    private readonly adapter: NativeCalendarDeviceAdapter,
    private readonly storage: NativeCalendarStorage,
    private readonly now: () => Date = () => new Date()
  ) {}

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

  async connect(input: ConnectInput): Promise<NativeCalendarStoredState> {
    const permission = await this.adapter.requestPermission();
    if (!permission.granted) {
      return this.storage.loadState(input);
    }

    const state = await this.storage.loadState(input);
    const calendars = await this.adapter.listWritableCalendars();
    const requestedCalendarIds = getRequestedCalendarIds(input, state.integration);
    const selectedCalendars = requestedCalendarIds
      .map((calendarId) => calendars.find((calendar) => calendar.id === calendarId && calendar.allowsModifications))
      .filter((calendar): calendar is NativeCalendarWritableCalendar => Boolean(calendar));
    const targetCalendars = selectedCalendars.length > 0
      ? selectedCalendars
      : [await this.adapter.getOrCreateAppCalendar(APP_CALENDAR_TITLE)];
    const targetCalendar = targetCalendars[0]!;
    const timestamp = this.now().toISOString();

    const integration: NativeCalendarIntegrationRecord = {
      enabled: true,
      platform: input.platform,
      userId: input.userId,
      deviceId: input.deviceId,
      deviceCalendarId: targetCalendar.id,
      deviceCalendarTitle: targetCalendar.title,
      deviceCalendarIds: targetCalendars.map((calendar) => calendar.id),
      deviceCalendars: targetCalendars.map(toDestination),
      autoSyncEnabled: input.autoSyncEnabled ?? state.integration?.autoSyncEnabled ?? true,
      reminderMinutesBefore: input.reminderMinutesBefore ?? state.integration?.reminderMinutesBefore ?? [],
      connectedAt: state.integration?.connectedAt ?? timestamp,
      updatedAt: timestamp
    };

    const nextState = { integration, mappings: state.mappings };
    await this.storage.saveState(input, nextState);
    return nextState;
  }

  async updateSettings(input: UpdateSettingsInput): Promise<NativeCalendarStoredState> {
    const state = await this.storage.loadState(input);
    if (!state.integration) return state;

    let deviceCalendarIds = getIntegrationCalendarIds(state.integration);
    let deviceCalendars = getIntegrationDestinations(state.integration);

    if (input.selectedCalendarIds !== undefined || input.selectedCalendarId !== undefined) {
      const requestedCalendarIds = uniqueCalendarIds(
        input.selectedCalendarIds ?? (input.selectedCalendarId ? [input.selectedCalendarId] : [])
      );
      if (requestedCalendarIds.length === 0) throw new Error("At least one writable device calendar must be selected.");

      const calendars = await this.adapter.listWritableCalendars();
      const selectedCalendars = requestedCalendarIds
        .map((calendarId) => calendars.find((calendar) => calendar.id === calendarId && calendar.allowsModifications))
        .filter((calendar): calendar is NativeCalendarWritableCalendar => Boolean(calendar));
      if (selectedCalendars.length !== requestedCalendarIds.length) {
        throw new Error("One or more selected device calendars are not writable.");
      }
      deviceCalendarIds = selectedCalendars.map((calendar) => calendar.id);
      deviceCalendars = selectedCalendars.map(toDestination);
    }

    const primaryCalendar = deviceCalendars[0];
    if (!primaryCalendar) throw new Error("No writable device calendar was found.");

    const integration: NativeCalendarIntegrationRecord = {
      ...state.integration,
      deviceCalendarId: primaryCalendar.id,
      deviceCalendarTitle: primaryCalendar.title,
      deviceCalendarIds,
      deviceCalendars,
      autoSyncEnabled: input.autoSyncEnabled ?? state.integration.autoSyncEnabled,
      reminderMinutesBefore: input.reminderMinutesBefore ?? state.integration.reminderMinutesBefore,
      updatedAt: this.now().toISOString()
    };

    const nextState = { ...state, integration };
    await this.storage.saveState(input, nextState);
    return nextState;
  }

  async syncEvents(input: SyncInput): Promise<NativeCalendarSyncResult> {
    const permission = await this.adapter.getPermissionStatus();
    if (!permission.granted) throw new Error("Calendar permission is not granted.");

    const state = await this.storage.loadState(input);
    if (!state.integration?.enabled) throw new Error("Native calendar integration is not connected.");

    const targetCalendarIds = getIntegrationCalendarIds(state.integration);
    if (targetCalendarIds.length === 0) throw new Error("No writable device calendar was found.");

    const timestamp = this.now().toISOString();
    const integration = { ...state.integration, lastSyncStartedAt: timestamp, updatedAt: timestamp };
    const result = createEmptySyncResult();
    const mappings = { ...state.mappings };
    const currentMappingKeys = new Set<string>();

    for (const event of input.events) {
      const eventHash = createEventFingerprint(event);
      for (const calendarId of targetCalendarIds) {
        const mappingKey = createMappingKey(event.id, calendarId);
        currentMappingKeys.add(mappingKey);
        const existingMatch = findMapping(mappings, event.id, calendarId);
        const existing = existingMatch?.mapping;

        if (existingMatch && existingMatch.key !== mappingKey) delete mappings[existingMatch.key];

        try {
          if (existing) {
            const found = await this.adapter.findEvent(existing.nativeEventId);
            if (found) {
              if (existing.eventHash === eventHash) {
                mappings[mappingKey] = { ...existing, lastSyncedAt: timestamp };
                result.skipped += 1;
                continue;
              }

              await this.adapter.updateEvent(existing.nativeEventId, calendarId, event);
              mappings[mappingKey] = createMapping(event.id, existing.nativeEventId, calendarId, eventHash, timestamp);
              result.updated += 1;
              continue;
            }

            const nativeEventId = await this.adapter.createEvent(calendarId, event);
            mappings[mappingKey] = createMapping(event.id, nativeEventId, calendarId, eventHash, timestamp);
            result.recovered += 1;
            continue;
          }

          const nativeEventId = await this.adapter.createEvent(calendarId, event);
          mappings[mappingKey] = createMapping(event.id, nativeEventId, calendarId, eventHash, timestamp);
          result.created += 1;
        } catch (error) {
          result.failed += 1;
          result.errors.push({ appEventId: event.id, message: getErrorMessage(error) });
          if (existing) mappings[mappingKey] = { ...existing, lastError: getErrorMessage(error) };
        }
      }
    }

    if (input.removeStale !== false) {
      for (const [appEventId, mapping] of Object.entries(mappings)) {
        if (currentMappingKeys.has(appEventId)) continue;

        try {
          const found = await this.adapter.findEvent(mapping.nativeEventId);
          if (found) await this.adapter.deleteEvent(mapping.nativeEventId);
          delete mappings[appEventId];
          result.deleted += 1;
        } catch (error) {
          result.failed += 1;
          result.errors.push({ appEventId, nativeEventId: mapping.nativeEventId, message: getErrorMessage(error) });
          mappings[appEventId] = { ...mapping, lastError: getErrorMessage(error) };
        }
      }
    }

    const nextIntegration: NativeCalendarIntegrationRecord = {
      ...integration,
      deviceCalendarIds: targetCalendarIds,
      deviceCalendars: getIntegrationDestinations(integration),
      lastSyncResult: pickCounts(result),
      updatedAt: timestamp
    };
    if (result.failed === 0) nextIntegration.lastSuccessfulSyncAt = timestamp;

    await this.storage.saveState(input, { integration: nextIntegration, mappings });
    return result;
  }

  async removeEvent(context: NativeCalendarContext, appEventId: string): Promise<void> {
    const state = await this.storage.loadState(context);
    const mappings = { ...state.mappings };
    const matches = Object.entries(mappings).filter(([, mapping]) => mapping.appEventId === appEventId);
    if (matches.length === 0) return;

    for (const [mappingKey, mapping] of matches) {
      const found = await this.adapter.findEvent(mapping.nativeEventId);
      if (found) await this.adapter.deleteEvent(mapping.nativeEventId);
      delete mappings[mappingKey];
    }
    await this.storage.saveState(context, { integration: state.integration, mappings });
  }

  async disconnect(input: DisconnectInput): Promise<NativeCalendarSyncResult> {
    const state = await this.storage.loadState(input);
    const result = createEmptySyncResult();

    if (input.removeNativeEvents) {
      for (const mapping of Object.values(state.mappings)) {
        try {
          const found = await this.adapter.findEvent(mapping.nativeEventId);
          if (found) await this.adapter.deleteEvent(mapping.nativeEventId);
          result.deleted += 1;
        } catch (error) {
          result.failed += 1;
          result.errors.push({ appEventId: mapping.appEventId, nativeEventId: mapping.nativeEventId, message: getErrorMessage(error) });
        }
      }
    }

    await this.storage.clearState(input);
    return result;
  }
}

function getRequestedCalendarIds(
  input: Pick<ConnectInput, "selectedCalendarId" | "selectedCalendarIds">,
  integration: NativeCalendarIntegrationRecord | undefined
): string[] {
  if (input.selectedCalendarIds !== undefined) return uniqueCalendarIds(input.selectedCalendarIds);
  if (input.selectedCalendarId) return [input.selectedCalendarId];
  return integration ? getIntegrationCalendarIds(integration) : [];
}

function getIntegrationCalendarIds(integration: NativeCalendarIntegrationRecord): string[] {
  return uniqueCalendarIds(
    integration.deviceCalendarIds?.length ? integration.deviceCalendarIds : [integration.deviceCalendarId]
  );
}

function getIntegrationDestinations(integration: NativeCalendarIntegrationRecord) {
  if (integration.deviceCalendars?.length) return integration.deviceCalendars;
  return [{
    id: integration.deviceCalendarId,
    title: integration.deviceCalendarTitle,
    provider: integration.platform === "ios" ? "apple" as const : "device" as const
  }];
}

function uniqueCalendarIds(calendarIds: string[]): string[] {
  return [...new Set(calendarIds.map((calendarId) => calendarId.trim()).filter(Boolean))];
}

function toDestination(calendar: NativeCalendarWritableCalendar) {
  return {
    id: calendar.id,
    title: calendar.title,
    sourceName: calendar.sourceName,
    provider: calendar.provider
  };
}

function createMappingKey(appEventId: string, calendarId: string): string {
  return JSON.stringify([appEventId, calendarId]);
}

function findMapping(
  mappings: Record<string, NativeCalendarEventMapping>,
  appEventId: string,
  calendarId: string
): { key: string; mapping: NativeCalendarEventMapping } | undefined {
  const directKey = createMappingKey(appEventId, calendarId);
  const direct = mappings[directKey];
  if (direct?.appEventId === appEventId && direct.deviceCalendarId === calendarId) {
    return { key: directKey, mapping: direct };
  }

  const legacy = Object.entries(mappings).find(([, mapping]) => (
    mapping.appEventId === appEventId && mapping.deviceCalendarId === calendarId
  ));
  return legacy ? { key: legacy[0], mapping: legacy[1] } : undefined;
}

export function createEventFingerprint(event: NativeCalendarSyncEvent): string {
  return hashStableStringify({
    id: event.id,
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate ?? null,
    allDay: event.allDay ?? false,
    timezone: event.timezone ?? null,
    notes: event.notes ?? null,
    location: event.location ?? null,
    url: event.url ?? null,
    category: event.category ?? null,
    recurrenceRule: event.recurrenceRule ?? null,
    reminderMinutesBefore: [...(event.reminderMinutesBefore ?? [])].sort((left, right) => left - right)
  });
}

function createMapping(
  appEventId: string,
  nativeEventId: string,
  deviceCalendarId: string,
  eventHash: string,
  timestamp: string
): NativeCalendarEventMapping {
  return {
    appEventId,
    nativeEventId,
    deviceCalendarId,
    eventHash,
    lastSyncedAt: timestamp
  };
}

function createEmptySyncResult(): NativeCalendarSyncResult {
  return {
    created: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
    recovered: 0,
    failed: 0,
    errors: []
  };
}

function pickCounts(result: NativeCalendarSyncResult) {
  const { created, updated, skipped, deleted, recovered, failed } = result;
  return { created, updated, skipped, deleted, recovered, failed };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Native calendar operation failed.";
}

function hashStableStringify(value: unknown): string {
  const stable = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
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
