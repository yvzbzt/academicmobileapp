jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: { clearCachedAccessToken: jest.fn() },
  isErrorWithCode: jest.fn(() => false),
  statusCodes: {
    IN_PROGRESS: "IN_PROGRESS",
    PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
    SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED",
  },
}));

jest.mock("../../src/notifications", () => ({
  ExpoNetworkAdapter: class {
    async getState() {
      return { connected: true, internetReachable: true };
    }
  },
}));

const mockHydrateDeviceAcademicPdfEvents = jest.fn(async (input: { serverEvents: unknown[] }) => (
  [...input.serverEvents]
));
jest.mock("../../src/calendar/device-academic-pdf", () => ({
  hydrateDeviceAcademicPdfEvents: (input: { serverEvents: unknown[] }) => (
    mockHydrateDeviceAcademicPdfEvents(input)
  ),
}));

import { Platform } from "react-native";
import { createAppleCalendarActions } from "../../src/app/actions/apple-calendar-actions";
import { createGoogleCalendarActions } from "../../src/app/actions/google-calendar-actions";
import type { TrustedContentCollection, TrustedMobileContentRecord } from "../../src/content/content-trust";

const ownerSnapshot = { ownerId: "owner-1", generation: 1 };
const emptyDeviceCollection: TrustedContentCollection = {
  items: [],
  state: "fresh",
  omittedCount: 0,
  duplicateCount: 0,
  rawItemCount: 0,
  explicitRawCount: 0,
  hasMore: false,
};
const parsedEmptyCalendar = {
  calendar: {
    id: "calendar-1",
    universityId: "university-1",
    title: "Akademik Takvim",
    academicYear: "2026-2027",
    status: "published",
  },
  events: [],
  sourceStatus: "parsed",
} as const;

function googleFixture(
  deviceMapping = false,
  deviceCollection: TrustedContentCollection = emptyDeviceCollection,
) {
  const deviceId = "device-source-1-0123456789abcdef";
  const mapping = {
    sourceId: `announcement:${deviceId}`,
    sourceType: "announcement" as const,
    googleEventId: "google-event-1",
    fingerprint: "old-fingerprint",
  };
  const integration = deviceMapping ? {
    schemaVersion: 3 as const,
    ownerId: "owner-1",
    googleAccountId: "google-owner-1",
    accountEmail: "student@example.test",
    state: "connected" as const,
    mappings: [mapping],
  } : null;
  const apiRequest = jest.fn(async (path: string) => {
    if (path === "/me") return { id: "owner-1", universityId: "university-1" };
    if (path === "/calendar/my") return parsedEmptyCalendar;
    throw new Error(`Unexpected API request: ${path}`);
  });
  const loadDeviceAnnouncementCollection = jest.fn(async () => deviceCollection);
  const setAnnouncements = jest.fn();
  const authorization = {
    accessToken: "google-access-token",
    googleAccountId: "google-owner-1",
    accountEmail: "student@example.test",
  };
  const googleCalendarService = {
    verifyAuthorization: jest.fn(async () => ({
      authorized: true as const,
      managedEventCount: integration?.mappings.length ?? 0,
      mappings: integration?.mappings ?? [],
    })),
    sync: jest.fn(async () => ({
      created: 0,
      updated: 0,
      deleted: integration ? 1 : 0,
      skipped: 0,
      failed: 0,
      total: 0,
      verified: 0,
      partial: false,
      failures: [],
      mappings: [],
    })),
  };
  const value = {
    accountCleanupInProgressRef: { current: false },
    sessionRef: { current: { accessToken: "access-token", user: { id: "owner-1" } } },
    accountGuardRef: {
      current: {
        capture: () => ownerSnapshot,
        isCurrent: (candidate: typeof ownerSnapshot) => candidate === ownerSnapshot,
      },
    },
    googleLifecycleGuardRef: {
      current: {
        begin: jest.fn(() => ({ ownerId: "owner-1", generation: 1 })),
        settle: jest.fn(),
      },
    },
    googleCalendarIntegration: integration,
    authenticatedRequestControllersRef: { current: new Set<AbortController>() },
    apiRequest,
    loadDeviceAnnouncementCollection,
    googleCalendarService,
    readCurrentGoogleCalendarAuthorization: jest.fn(async () => authorization),
    authorizeGoogleCalendar: jest.fn(async () => authorization),
    queueGoogleSignOut: jest.fn(),
    enqueueStorageMutation: jest.fn(async (action: () => Promise<unknown>) => action()),
    persistGoogleCalendarConnection: jest.fn(async () => undefined),
    enqueueGoogleSdkOperation: jest.fn(),
    runAbortableGoogleCleanup: jest.fn(),
    revokeGoogleCalendarAccessForConnection: jest.fn(),
    setGoogleCalendarError: jest.fn(),
    setMessage: jest.fn(),
    setGoogleCalendarBusy: jest.fn(),
    setGoogleCalendarState: jest.fn(),
    setCalendar: jest.fn(),
    setGoogleCalendarIntegration: jest.fn(),
    setGoogleCalendarLastResult: jest.fn(),
    setGoogleCalendarWarnings: jest.fn(),
    setAnnouncements,
  };
  return {
    actions: createGoogleCalendarActions(value as never),
    apiRequest,
    googleCalendarService,
    loadDeviceAnnouncementCollection,
    setAnnouncements,
  };
}

function appleFixture(deviceCollection: TrustedContentCollection = emptyDeviceCollection) {
  const apiRequest = jest.fn(async (path: string) => {
    if (path === "/calendar/my") return parsedEmptyCalendar;
    throw new Error(`Unexpected API request: ${path}`);
  });
  const loadDeviceAnnouncementCollection = jest.fn(async () => deviceCollection);
  const setAnnouncements = jest.fn();
  const nativeCalendarService = {
    loadState: jest.fn(async () => ({ integration: { enabled: true }, mappings: {} })),
    getPermissionStatus: jest.fn(async () => ({
      status: "granted" as const,
      granted: true,
      canAskAgain: true,
    })),
    syncEvents: jest.fn(async () => ({
      created: 0,
      updated: 0,
      skipped: 0,
      deleted: 0,
      recovered: 0,
      conflicted: 0,
      failed: 0,
      errors: [],
    })),
  };
  const value = {
    deviceIdRef: { current: "device-1" },
    accountGuardRef: {
      current: {
        capture: () => ownerSnapshot,
        isCurrent: (candidate: typeof ownerSnapshot) => candidate === ownerSnapshot,
      },
    },
    accountCleanupInProgressRef: { current: false },
    appleCalendarNativeMutationRef: { current: null },
    appleCalendarOperationRef: { current: false },
    sessionRef: { current: { accessToken: "access-token", user: { id: "owner-1" } } },
    authenticatedRequestControllersRef: { current: new Set<AbortController>() },
    nativeCalendarService,
    apiRequest,
    loadDeviceAnnouncementCollection,
    setAppleCalendarStoredState: jest.fn(),
    setAppleCalendarLastResult: jest.fn(),
    setAppleCalendarWarnings: jest.fn(),
    setAppleCalendarError: jest.fn(),
    setAppleCalendarPermission: jest.fn(),
    setAppleCalendarState: jest.fn(),
    setAppleCalendarBusy: jest.fn(),
    setMessage: jest.fn(),
    setCalendar: jest.fn(),
    appleCalendarPermission: { status: "granted", granted: true, canAskAgain: true },
    appleCalendarStoredState: { mappings: {} },
    setAnnouncements,
  };
  return {
    actions: createAppleCalendarActions(value as never),
    apiRequest,
    loadDeviceAnnouncementCollection,
    nativeCalendarService,
    setAnnouncements,
  };
}

describe("calendar sync device announcement migration", () => {
  it("loads Google Calendar content from the device collection without replacing the UI feed", async () => {
    const fixture = googleFixture();

    await fixture.actions.syncGoogleCalendar();

    expect(fixture.loadDeviceAnnouncementCollection).toHaveBeenCalledWith(
      "access-token",
      ownerSnapshot,
      100,
      expect.anything(),
      undefined,
      true,
    );
    expect(fixture.apiRequest.mock.calls.map(([path]) => path)).not.toContain(
      "/announcements/my/trusted?limit=100",
    );
    expect(fixture.setAnnouncements).not.toHaveBeenCalled();
    expect(mockHydrateDeviceAcademicPdfEvents).toHaveBeenCalledWith(expect.objectContaining({
      serverEvents: parsedEmptyCalendar.events,
    }));
  });

  it("treats a missing device mapping as local without querying a backend trusted detail", async () => {
    const fixture = googleFixture(true);

    await fixture.actions.syncGoogleCalendar();

    expect(fixture.googleCalendarService.verifyAuthorization).toHaveBeenCalledTimes(1);
    expect(fixture.googleCalendarService.sync).toHaveBeenCalledTimes(1);
    expect(fixture.apiRequest.mock.calls.some(([path]) => (
      path.startsWith("/announcements/my/trusted/")
    ))).toBe(false);
  });

  it("does not make a Google mapping below an incomplete top-100 snapshot eligible for deletion", async () => {
    const fixture = googleFixture(true, boundedDeviceCollection());

    await fixture.actions.syncGoogleCalendar();

    expect(fixture.googleCalendarService.sync).toHaveBeenCalledWith(expect.objectContaining({
      deletionEligibleSourceTypes: ["academic_event"],
    }));
    expect(fixture.apiRequest.mock.calls.some(([path]) => (
      path.startsWith("/announcements/my/trusted/")
    ))).toBe(false);
  });

  it("loads Apple Calendar content from the device collection without replacing the UI feed", async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    try {
      const fixture = appleFixture();

      await fixture.actions.syncAppleCalendar();

      expect(fixture.loadDeviceAnnouncementCollection).toHaveBeenCalledWith(
        "access-token",
        ownerSnapshot,
        100,
        expect.anything(),
        undefined,
        true,
      );
      expect(fixture.apiRequest.mock.calls.map(([path]) => path)).not.toContain(
        "/announcements/my/trusted?limit=100",
      );
      expect(fixture.setAnnouncements).not.toHaveBeenCalled();
      expect(mockHydrateDeviceAcademicPdfEvents).toHaveBeenCalledWith(expect.objectContaining({
        serverEvents: parsedEmptyCalendar.events,
      }));
    } finally {
      Object.defineProperty(Platform, "OS", { configurable: true, value: originalPlatform });
    }
  });

  it("does not make Apple mappings below an incomplete top-100 snapshot eligible for deletion", async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    try {
      const fixture = appleFixture(boundedDeviceCollection());

      await fixture.actions.syncAppleCalendar();

      expect(fixture.nativeCalendarService.syncEvents).toHaveBeenCalledWith(expect.objectContaining({
        removeStale: true,
        deletionEligibleSourceTypes: ["academic_event"],
      }));
    } finally {
      Object.defineProperty(Platform, "OS", { configurable: true, value: originalPlatform });
    }
  });
});

function boundedDeviceCollection(): TrustedContentCollection {
  return {
    items: Array.from({ length: 100 }, (_, index) => trustedDeviceRecord(index)),
    state: "fresh",
    omittedCount: 0,
    duplicateCount: 0,
    rawItemCount: 100,
    hasMore: true,
  };
}

function trustedDeviceRecord(index: number): TrustedMobileContentRecord {
  const id = `device-source-1-${index.toString(16).padStart(16, "0")}`;
  const canonicalUrl = `https://example.edu.tr/announcements/${index}`;
  return {
    id,
    sourceId: "source-1",
    sourceName: "Example University",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    title: `Visible item ${index}`,
    link: canonicalUrl,
    canonicalUrl,
    canonicalUrlAliases: [],
    officialSourceUrl: "https://example.edu.tr/announcements",
    sourceRelationships: [{
      sourceId: "source-1",
      sourceName: "Example University",
      officialSourceUrl: "https://example.edu.tr/announcements",
      scopeType: "university",
      scopeId: "university-1",
      canonicalUrl,
    }],
    publicationKind: "date",
    publishedDate: "2026-09-14",
    freshness: "fresh",
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
  };
}
