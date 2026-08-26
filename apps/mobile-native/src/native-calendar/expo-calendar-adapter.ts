import type * as ExpoCalendar from "expo-calendar";
import {
  DEFAULT_NATIVE_CALENDAR_TIMEZONE,
  calendarDateToISOString,
  instantToCalendarDate,
  isExactCalendarDate,
  normalizeCalendarTimestamp
} from "./calendar-date";
import {
  canonicalizeManagedEventMarker,
  createManagedPayloadFingerprint,
  managedEventMarkersMatch,
  normalizeReminderOffsets,
  parseManagedEventMarker
} from "./managed-event";
import { NativeCalendarSafetyError } from "./native-calendar-error";
import type {
  NativeCalendarDeviceAdapter,
  NativeCalendarDeviceEventRef,
  NativeCalendarEventSearchWindow,
  NativeCalendarPermissionState,
  NativeCalendarProvider,
  NativeCalendarSyncEvent,
  NativeCalendarWritableCalendar
} from "./types";

export const NATIVE_CALENDAR_APP_COLOR = "#1463F3";

export type ExpoCalendarAdapterOptions = {
  calendarModule?: typeof ExpoCalendar;
  platform?: string;
  appCalendarColor?: string;
  openSettings?: () => Promise<void>;
};

declare const require: (moduleName: string) => unknown;

export function createExpoCalendarAdapter(options: ExpoCalendarAdapterOptions = {}): NativeCalendarDeviceAdapter {
  const calendar = options.calendarModule ?? loadExpoCalendar();
  const platform = options.platform ?? loadReactNative().Platform.OS;
  const appCalendarColor = options.appCalendarColor ?? NATIVE_CALENDAR_APP_COLOR;
  const openSettings = options.openSettings ?? (() => loadReactNative().Linking.openSettings());

  async function isAvailable(): Promise<boolean> {
    if (platform !== "ios") return false;
    try {
      return await calendar.isAvailableAsync();
    } catch {
      return false;
    }
  }

  async function getPermissionStatus(): Promise<NativeCalendarPermissionState> {
    if (!await isAvailable()) return unavailablePermission();
    try {
      return mapPermission(await calendar.getCalendarPermissionsAsync());
    } catch {
      return unavailablePermission();
    }
  }

  async function requestPermission(): Promise<NativeCalendarPermissionState> {
    if (!await isAvailable()) return unavailablePermission();
    return mapPermission(await calendar.requestCalendarPermissionsAsync());
  }

  async function assertFullAccess(): Promise<void> {
    const permission = await getPermissionStatus();
    if (!permission.granted || permission.status !== "authorized") {
      throw new Error("Calendar full-access permission is not granted.");
    }
  }

  async function rawEventCalendars(): Promise<ExpoCalendar.Calendar[]> {
    await assertFullAccess();
    return (await calendar.getCalendarsAsync(calendar.EntityTypes.EVENT)).filter(isEventCalendar);
  }

  async function listWritableCalendars(): Promise<NativeCalendarWritableCalendar[]> {
    const calendars = await rawEventCalendars();
    return calendars
      .filter((item) => item.allowsModifications)
      .map((item) => toWritableCalendar(item, appCalendarColor))
      .sort((left, right) => left.title.localeCompare(right.title, "tr"));
  }

  async function getOrCreateAppCalendar(title: string): Promise<NativeCalendarWritableCalendar> {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new Error("App calendar title is required.");
    const existing = (await listWritableCalendars()).filter((item) => (
      item.title === normalizedTitle && item.isAppCalendar
    ));
    if (existing.length > 1) {
      throw new NativeCalendarSafetyError("ambiguous_marker", "More than one app calendar matches the managed identity.");
    }
    if (existing[0]) return existing[0];

    const defaultCalendar = await calendar.getDefaultCalendarAsync();
    if (!defaultCalendar.source?.id) throw new Error("The default iOS calendar source cannot create calendars.");
    const createdId = await calendar.createCalendarAsync({
      title: normalizedTitle,
      color: appCalendarColor,
      entityType: calendar.EntityTypes.EVENT,
      sourceId: defaultCalendar.source.id,
      source: defaultCalendar.source
    });
    const created = (await listWritableCalendars()).find((item) => item.id === createdId);
    if (!created) throw new Error("The app calendar was created but could not be verified.");
    return { ...created, isAppCalendar: true };
  }

  async function assertWritableCalendar(calendarId: string): Promise<void> {
    const target = (await listWritableCalendars()).find((item) => item.id === calendarId);
    if (!target) throw new Error("The selected iOS calendar is not writable.");
  }

  async function createEvent(calendarId: string, event: NativeCalendarSyncEvent): Promise<string> {
    await assertWritableCalendar(calendarId);
    const marker = requireManagedMarker(event.url);
    return calendar.createEventAsync(calendarId, toExpoEventData({ ...event, url: marker }, calendar));
  }

  async function updateEvent(
    nativeEventId: string,
    calendarId: string,
    event: NativeCalendarSyncEvent,
    expectedMarker?: string
  ): Promise<string> {
    const marker = requireExpectedMarker(expectedMarker);
    if (!managedEventMarkersMatch(event.url, marker)) {
      throw new NativeCalendarSafetyError("marker_mismatch", "Updated event marker mismatch.");
    }
    await assertWritableCalendar(calendarId);
    const current = await findEvent(nativeEventId, searchWindowForEvent(event));
    assertOwnedRef(current, marker);
    if (current!.calendarId !== calendarId) {
      throw new NativeCalendarSafetyError("moved_calendar", "The managed event was moved to another calendar.");
    }
    return calendar.updateEventAsync(nativeEventId, toExpoEventData({ ...event, url: marker }, calendar));
  }

  async function deleteEvent(nativeEventId: string, expectedMarker?: string): Promise<void> {
    const marker = requireExpectedMarker(expectedMarker);
    const current = await findEvent(nativeEventId);
    if (!current) return;
    assertOwnedRef(current, marker);
    await calendar.deleteEventAsync(nativeEventId);
  }

  async function findEvent(
    nativeEventId: string,
    expectedWindow?: NativeCalendarEventSearchWindow
  ): Promise<NativeCalendarDeviceEventRef | null> {
    await assertFullAccess();
    try {
      return toDeviceEventRef(await calendar.getEventAsync(nativeEventId), expectedWindow);
    } catch (error) {
      if (isEventNotFoundError(error)) return null;
      throw error;
    }
  }

  async function findManagedEvent(
    managedMarker: string,
    searchWindow: NativeCalendarEventSearchWindow
  ): Promise<NativeCalendarDeviceEventRef | null> {
    requireExpectedMarker(managedMarker);
    const calendars = await rawEventCalendars();
    if (calendars.length === 0) return null;
    const range = recoveryRange(searchWindow);
    const events = await calendar.getEventsAsync(calendars.map((item) => item.id), range.start, range.end);
    const matches = events.filter((event) => managedEventMarkersMatch(event.url, managedMarker));
    const uniqueMatches = [...new Map(matches.map((event) => [event.id, event])).values()];
    if (uniqueMatches.length > 1) {
      throw new NativeCalendarSafetyError("ambiguous_marker", "More than one event has the same managed marker.");
    }
    return uniqueMatches[0] ? toDeviceEventRef(uniqueMatches[0], searchWindow) : null;
  }

  async function openEvent(
    nativeEventId: string,
    expectedMarker?: string,
    options: { allowsEditing?: boolean } = {}
  ): Promise<void> {
    const marker = requireExpectedMarker(expectedMarker);
    const current = await findEvent(nativeEventId);
    assertOwnedRef(current, marker);
    await calendar.openEventInCalendarAsync(
      { id: nativeEventId },
      { allowsEditing: options.allowsEditing ?? false }
    );
  }

  return {
    isAvailable,
    getPermissionStatus,
    requestPermission,
    listWritableCalendars,
    getOrCreateAppCalendar,
    createEvent,
    updateEvent,
    deleteEvent,
    findEvent,
    findManagedEvent,
    openEvent,
    openSettings
  };
}

function mapPermission(response: ExpoCalendar.PermissionResponse): NativeCalendarPermissionState {
  if (response.granted && response.status === "granted") {
    return { status: "authorized", granted: true, canAskAgain: response.canAskAgain };
  }
  if (response.status === "undetermined") {
    return { status: "not_determined", granted: false, canAskAgain: response.canAskAgain };
  }
  return { status: "denied", granted: false, canAskAgain: response.canAskAgain };
}

function unavailablePermission(): NativeCalendarPermissionState {
  return { status: "unavailable", granted: false, canAskAgain: false };
}

function isEventCalendar(value: ExpoCalendar.Calendar): boolean {
  return value.entityType !== "reminder"
    && value.type !== "birthdays"
    && value.type !== "subscribed";
}

function toWritableCalendar(value: ExpoCalendar.Calendar, appColor: string): NativeCalendarWritableCalendar {
  return {
    id: value.id,
    title: value.title,
    provider: providerForSource(value.source),
    allowsModifications: value.allowsModifications,
    color: value.color,
    ...(value.source.name ? { sourceName: value.source.name } : {}),
    ...(value.source.id ? { sourceId: value.source.id } : {}),
    ...(value.source.type ? { sourceType: String(value.source.type) } : {}),
    ...(value.type ? { calendarType: String(value.type) } : {}),
    ...(value.isPrimary !== undefined ? { isPrimary: value.isPrimary } : {}),
    isAppCalendar: value.title === "Akademik Takvim" && normalizeColor(value.color) === normalizeColor(appColor)
  };
}

function providerForSource(source: ExpoCalendar.Source): NativeCalendarProvider {
  const identity = `${source.type} ${source.name}`.toLowerCase();
  if (identity.includes("icloud") || identity.includes("mobileme") || identity.includes("apple")) return "apple";
  if (identity.includes("google")) return "google";
  if (identity.includes("local")) return "device";
  return "other";
}

function toExpoEventData(
  event: NativeCalendarSyncEvent,
  calendar: typeof ExpoCalendar
): Partial<ExpoCalendar.Event> {
  const title = event.title.trim();
  if (!title) throw new Error("Native calendar event title is required.");
  const timezone = event.timezone ?? DEFAULT_NATIVE_CALENDAR_TIMEZONE;
  const dates = normalizeEventDates(event, timezone);
  return {
    title,
    startDate: dates.startDate,
    endDate: dates.endDate,
    allDay: event.allDay ?? false,
    timeZone: timezone,
    availability: calendar.Availability.FREE,
    alarms: normalizeReminderOffsets(event.reminderMinutesBefore).map((minutes) => ({ relativeOffset: -minutes })),
    recurrenceRule: toExpoRecurrenceRule(event.recurrenceRule, timezone, calendar) ?? null,
    ...(event.notes ? { notes: event.notes } : {}),
    ...(event.location ? { location: event.location } : {}),
    ...(event.url ? { url: event.url } : {})
  };
}

function normalizeEventDates(
  event: NativeCalendarSyncEvent,
  timezone: string
): { startDate: string; endDate: string } {
  if (event.allDay) {
    if (!isExactCalendarDate(event.startDate) || !event.endDate || !isExactCalendarDate(event.endDate)) {
      throw new Error("All-day events require date-only start and exclusive end dates.");
    }
    if (event.endDate <= event.startDate) throw new Error("All-day event end must follow its start.");
    return {
      startDate: calendarDateToISOString(event.startDate, timezone),
      endDate: calendarDateToISOString(event.endDate, timezone)
    };
  }

  const startDate = normalizeCalendarTimestamp(event.startDate);
  const endDate = event.endDate ? normalizeCalendarTimestamp(event.endDate) : null;
  if (!startDate || !endDate || Date.parse(endDate) <= Date.parse(startDate)) {
    throw new Error("Timed events require a valid end after their start.");
  }
  return { startDate, endDate };
}

function toExpoRecurrenceRule(
  value: NativeCalendarSyncEvent["recurrenceRule"],
  timezone: string,
  calendar: typeof ExpoCalendar
): ExpoCalendar.RecurrenceRule | undefined {
  if (!value) return undefined;
  const frequency = {
    daily: calendar.Frequency.DAILY,
    weekly: calendar.Frequency.WEEKLY,
    monthly: calendar.Frequency.MONTHLY,
    yearly: calendar.Frequency.YEARLY
  }[value.frequency];
  return {
    frequency,
    ...(value.interval !== undefined ? { interval: value.interval } : {}),
    ...(value.occurrence !== undefined ? { occurrence: value.occurrence } : {}),
    ...(value.endDate ? {
      endDate: isExactCalendarDate(value.endDate)
        ? calendarDateToISOString(value.endDate, timezone)
        : normalizeCalendarTimestamp(value.endDate) ?? undefined
    } : {})
  };
}

function toDeviceEventRef(
  event: ExpoCalendar.Event,
  expectedWindow?: NativeCalendarEventSearchWindow
): NativeCalendarDeviceEventRef {
  const marker = canonicalizeManagedEventMarker(event.url) ?? undefined;
  const markerIdentity = parseManagedEventMarker(marker);
  const lastModifiedDate = normalizeOptionalInstant(event.lastModifiedDate);
  let eventHash: string | undefined;

  if (markerIdentity && expectedWindow) {
    try {
      const timezone = expectedWindow.timezone ?? DEFAULT_NATIVE_CALENDAR_TIMEZONE;
      const syncEvent: NativeCalendarSyncEvent = {
        id: markerIdentity.sourceId,
        sourceId: markerIdentity.sourceId,
        sourceType: markerIdentity.sourceType,
        title: event.title,
        startDate: event.allDay
          ? instantToCalendarDate(event.startDate, timezone)
          : new Date(event.startDate).toISOString(),
        endDate: event.allDay
          ? instantToCalendarDate(event.endDate, timezone)
          : new Date(event.endDate).toISOString(),
        allDay: event.allDay,
        timezone,
        ...(event.notes ? { notes: event.notes } : {}),
        ...(event.location ? { location: event.location } : {}),
        url: marker,
        reminderMinutesBefore: normalizeReminderOffsets(
          event.alarms.map((alarm) => alarm.relativeOffset).filter((offset): offset is number => (
            typeof offset === "number" && offset <= 0
          )).map((offset) => Math.abs(offset))
        ),
        ...(event.recurrenceRule ? { recurrenceRule: fromExpoRecurrenceRule(event.recurrenceRule) } : {})
      };
      eventHash = createManagedPayloadFingerprint(syncEvent);
    } catch {
      eventHash = undefined;
    }
  }

  const destructiveSafety = eventHash
    && lastModifiedDate
    && isExpoEventDestructivelyVerifiable(event)
    ? "verified"
    : "uncertain";
  return {
    id: event.id,
    calendarId: event.calendarId,
    ...(marker ? { managedMarker: marker } : {}),
    ...(eventHash ? { eventHash } : {}),
    ...(lastModifiedDate ? { lastModifiedDate } : {}),
    destructiveSafety
  };
}

function isExpoEventDestructivelyVerifiable(event: ExpoCalendar.Event): boolean {
  if (event.organizer || event.isDetached) return false;
  if (event.status !== "none" && event.status !== "confirmed") return false;
  if (event.availability !== "free" && event.availability !== "notSupported") return false;
  if (event.alarms.some((alarm) => (
    alarm.absoluteDate !== undefined
    || alarm.structuredLocation !== undefined
    || typeof alarm.relativeOffset !== "number"
    || alarm.relativeOffset > 0
  ))) return false;
  const recurrence = event.recurrenceRule;
  if (!recurrence) return true;
  return !recurrence.daysOfTheWeek?.length
    && !recurrence.daysOfTheMonth?.length
    && !recurrence.monthsOfTheYear?.length
    && !recurrence.weeksOfTheYear?.length
    && !recurrence.daysOfTheYear?.length
    && !recurrence.setPositions?.length;
}

function normalizeOptionalInstant(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function fromExpoRecurrenceRule(
  value: ExpoCalendar.RecurrenceRule
): NonNullable<NativeCalendarSyncEvent["recurrenceRule"]> {
  const frequency = String(value.frequency) as NonNullable<NativeCalendarSyncEvent["recurrenceRule"]>["frequency"];
  return {
    frequency,
    ...(value.interval !== undefined ? { interval: value.interval } : {}),
    ...(value.occurrence !== undefined ? { occurrence: value.occurrence } : {}),
    ...(value.endDate ? { endDate: new Date(value.endDate).toISOString() } : {})
  };
}

function recoveryRange(window: NativeCalendarEventSearchWindow): { start: Date; end: Date } {
  const timezone = window.timezone ?? DEFAULT_NATIVE_CALENDAR_TIMEZONE;
  const startValue = window.allDay && isExactCalendarDate(window.startDate)
    ? calendarDateToISOString(window.startDate, timezone)
    : normalizeCalendarTimestamp(window.startDate);
  const endValue = window.endDate
    ? window.allDay && isExactCalendarDate(window.endDate)
      ? calendarDateToISOString(window.endDate, timezone)
      : normalizeCalendarTimestamp(window.endDate)
    : startValue;
  if (!startValue || !endValue) throw new Error("Managed event recovery window is invalid.");
  const padding = 370 * 24 * 60 * 60 * 1000;
  return {
    start: new Date(Date.parse(startValue) - padding),
    end: new Date(Date.parse(endValue) + padding)
  };
}

function requireManagedMarker(value: string | undefined): string {
  const canonical = canonicalizeManagedEventMarker(value);
  if (!canonical) {
    throw new NativeCalendarSafetyError("marker_mismatch", "A valid managed event marker is required.");
  }
  return canonical;
}

function requireExpectedMarker(value: string | undefined): string {
  return requireManagedMarker(value);
}

function assertOwnedRef(ref: NativeCalendarDeviceEventRef | null, expectedMarker: string): asserts ref is NativeCalendarDeviceEventRef {
  if (!ref) throw new NativeCalendarSafetyError("user_deleted", "Managed event no longer exists.");
  if (!managedEventMarkersMatch(ref.managedMarker, expectedMarker)) {
    throw new NativeCalendarSafetyError("marker_mismatch", "Managed event ownership could not be verified.");
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

function isEventNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = typeof (error as Error & { code?: unknown }).code === "string"
    ? (error as Error & { code: string }).code
    : "";
  return error.name.includes("EventNotFound")
    || code.includes("EVENT_NOT_FOUND")
    || /^Event with id .+ could not be found$/u.test(error.message);
}

function normalizeColor(value: string): string {
  return value.trim().toLowerCase();
}

function loadReactNative(): {
  Platform: { OS: string };
  Linking: { openSettings(): Promise<void> };
} {
  return require("react-native") as {
    Platform: { OS: string };
    Linking: { openSettings(): Promise<void> };
  };
}

function loadExpoCalendar(): typeof ExpoCalendar {
  return require("expo-calendar") as typeof ExpoCalendar;
}
