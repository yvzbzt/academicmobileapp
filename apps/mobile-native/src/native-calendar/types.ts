export type NativeCalendarPlatform = "ios" | "android";
export type NativeCalendarProvider = "google" | "apple" | "device" | "other";

export type NativeCalendarPermissionStatus =
  | "authorized"
  | "denied"
  | "limited"
  | "not_determined"
  | "restricted"
  | "unavailable";

export type NativeCalendarPermissionState = {
  status: NativeCalendarPermissionStatus;
  canAskAgain: boolean;
  granted: boolean;
};

export type NativeCalendarWritableCalendar = {
  id: string;
  title: string;
  sourceName?: string;
  sourceId?: string;
  sourceType?: string;
  calendarType?: string;
  color?: string;
  provider: NativeCalendarProvider;
  allowsModifications: boolean;
  isPrimary?: boolean;
  isAppCalendar?: boolean;
};

export type NativeCalendarDestination = Pick<
  NativeCalendarWritableCalendar,
  "id" | "title" | "sourceName" | "sourceId" | "sourceType" | "provider" | "isAppCalendar"
>;

export type NativeCalendarRecurrenceRule = {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  endDate?: string;
  occurrence?: number;
};

export type NativeCalendarSyncEvent = {
  id: string;
  sourceId?: string;
  sourceType?: string;
  title: string;
  startDate: string;
  endDate?: string;
  allDay?: boolean;
  timezone?: string;
  notes?: string;
  location?: string;
  url?: string;
  sourceUrl?: string;
  category?: string;
  recurrenceRule?: NativeCalendarRecurrenceRule;
  reminderMinutesBefore?: number[];
};

export type NativeCalendarIntegrationRecord = {
  schemaVersion?: 3;
  enabled: boolean;
  platform: NativeCalendarPlatform;
  userId: string;
  deviceId: string;
  deviceCalendarId: string;
  deviceCalendarTitle: string;
  deviceCalendarIds: string[];
  deviceCalendars: NativeCalendarDestination[];
  autoSyncEnabled: boolean;
  reminderMinutesBefore: number[];
  connectedAt: string;
  updatedAt: string;
  lastSyncStartedAt?: string;
  lastSuccessfulSyncAt?: string;
  lastSyncResult?: NativeCalendarSyncCounts;
};

export type NativeCalendarEventMapping = {
  appEventId: string;
  sourceId?: string;
  sourceType?: string;
  nativeEventId: string;
  deviceCalendarId: string;
  managedMarker?: string;
  eventHash: string;
  appliedEventHash?: string;
  status?: NativeCalendarMappingStatus;
  conflictReason?: NativeCalendarConflictReason;
  lastKnownStartDate?: string;
  lastKnownEndDate?: string;
  lastKnownAllDay?: boolean;
  lastKnownTimezone?: string;
  lastKnownModifiedDate?: string;
  lastSyncedAt: string;
  lastError?: string;
};

export type NativeCalendarMappingStatus = "managed" | "user_deleted" | "user_modified" | "moved" | "delete_failed";

export type NativeCalendarConflictReason =
  | "marker_mismatch"
  | "user_deleted"
  | "user_modified"
  | "moved_calendar"
  | "ambiguous_marker";

export type NativeCalendarStoredState = {
  integration?: NativeCalendarIntegrationRecord;
  mappings: Record<string, NativeCalendarEventMapping>;
};

export type NativeCalendarSyncCounts = {
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  recovered: number;
  conflicted: number;
  failed: number;
};

export type NativeCalendarSyncError = {
  appEventId?: string;
  nativeEventId?: string;
  message: string;
  reason?: NativeCalendarConflictReason | "operation_failed";
};

export type NativeCalendarSyncResult = NativeCalendarSyncCounts & {
  errors: NativeCalendarSyncError[];
};

export type NativeCalendarDeviceEventRef = {
  id: string;
  calendarId?: string;
  managedMarker?: string;
  eventHash?: string;
  lastModifiedDate?: string;
  destructiveSafety: "verified" | "uncertain";
};

export type NativeCalendarEventSearchWindow = {
  startDate: string;
  endDate?: string;
  allDay?: boolean;
  timezone?: string;
};

export type NativeCalendarOpenEventOptions = {
  allowsEditing?: boolean;
};

export type NativeCalendarDeviceAdapter = {
  isAvailable?(): Promise<boolean>;
  getPermissionStatus(): Promise<NativeCalendarPermissionState>;
  requestPermission(): Promise<NativeCalendarPermissionState>;
  listWritableCalendars(): Promise<NativeCalendarWritableCalendar[]>;
  getOrCreateAppCalendar(title: string): Promise<NativeCalendarWritableCalendar>;
  createEvent(calendarId: string, event: NativeCalendarSyncEvent): Promise<string>;
  updateEvent(nativeEventId: string, calendarId: string, event: NativeCalendarSyncEvent, expectedMarker?: string): Promise<string | void>;
  deleteEvent(nativeEventId: string, expectedMarker?: string): Promise<void>;
  findEvent(
    nativeEventId: string,
    expectedWindow?: NativeCalendarEventSearchWindow
  ): Promise<NativeCalendarDeviceEventRef | null>;
  findManagedEvent?(
    managedMarker: string,
    searchWindow: NativeCalendarEventSearchWindow
  ): Promise<NativeCalendarDeviceEventRef | null>;
  openEvent?(
    nativeEventId: string,
    expectedMarker?: string,
    options?: NativeCalendarOpenEventOptions
  ): Promise<void>;
  openSettings?(): Promise<void>;
};

export type NativeCalendarStorageKey = {
  userId: string;
  platform: NativeCalendarPlatform;
  deviceId: string;
};

export type NativeCalendarStorage = {
  loadState(key: NativeCalendarStorageKey): Promise<NativeCalendarStoredState>;
  saveState(key: NativeCalendarStorageKey, state: NativeCalendarStoredState): Promise<void>;
  clearState(key: NativeCalendarStorageKey): Promise<void>;
};

export type NativeCalendarMetadataSource =
  | "async_storage"
  | "secure_store_v3"
  | "secure_store_v2"
  | "migration_pending"
  | "recovery_pending";

export type NativeCalendarMetadataRecoveryResult = {
  quarantineKey: string;
  quarantinedAt: string;
  quarantinedSources: NativeCalendarMetadataSource[];
  resumed: boolean;
};

export type NativeCalendarRecoverableStorage = NativeCalendarStorage & {
  /**
   * Metadata-only escape hatch. It refuses valid state, never touches EventKit,
   * and preserves every available raw value before installing an empty state.
   */
  quarantineAndResetCorruptState(
    key: NativeCalendarStorageKey
  ): Promise<NativeCalendarMetadataRecoveryResult>;
};
