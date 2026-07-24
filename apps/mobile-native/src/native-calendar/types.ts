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
  provider: NativeCalendarProvider;
  allowsModifications: boolean;
  isPrimary?: boolean;
  isAppCalendar?: boolean;
};

export type NativeCalendarDestination = Pick<
  NativeCalendarWritableCalendar,
  "id" | "title" | "sourceName" | "provider"
>;

export type NativeCalendarRecurrenceRule = {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  endDate?: string;
  occurrence?: number;
};

export type NativeCalendarSyncEvent = {
  id: string;
  title: string;
  startDate: string;
  endDate?: string;
  allDay?: boolean;
  timezone?: string;
  notes?: string;
  location?: string;
  url?: string;
  category?: string;
  recurrenceRule?: NativeCalendarRecurrenceRule;
  reminderMinutesBefore?: number[];
};

export type NativeCalendarIntegrationRecord = {
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
  nativeEventId: string;
  deviceCalendarId: string;
  eventHash: string;
  lastSyncedAt: string;
  lastError?: string;
};

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
  failed: number;
};

export type NativeCalendarSyncError = {
  appEventId?: string;
  nativeEventId?: string;
  message: string;
};

export type NativeCalendarSyncResult = NativeCalendarSyncCounts & {
  errors: NativeCalendarSyncError[];
};

export type NativeCalendarDeviceEventRef = {
  id: string;
  calendarId?: string;
};

export type NativeCalendarDeviceAdapter = {
  getPermissionStatus(): Promise<NativeCalendarPermissionState>;
  requestPermission(): Promise<NativeCalendarPermissionState>;
  listWritableCalendars(): Promise<NativeCalendarWritableCalendar[]>;
  getOrCreateAppCalendar(title: string): Promise<NativeCalendarWritableCalendar>;
  createEvent(calendarId: string, event: NativeCalendarSyncEvent): Promise<string>;
  updateEvent(nativeEventId: string, calendarId: string, event: NativeCalendarSyncEvent): Promise<void>;
  deleteEvent(nativeEventId: string): Promise<void>;
  findEvent(nativeEventId: string): Promise<NativeCalendarDeviceEventRef | null>;
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
