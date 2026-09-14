jest.mock("../../src/notifications/native-notification-modules", () => ({
  Platform: { OS: "android" },
  Notifications: {},
  Network: {},
  Linking: {},
}));

jest.mock("../../src/content/device-content-cache", () => ({
  readDeviceContentCache: jest.fn(),
}));

jest.mock("../../src/content/device-content-notification-ledger", () => ({
  findDeviceContentNotificationRecord: jest.fn(),
}));

jest.mock("../../src/app/app-storage", () => ({
  PENDING_NOTIFICATION_STORAGE_KEY: "pending-notification",
  getStoredValue: jest.fn(),
  setStoredValue: jest.fn(async () => undefined),
  deleteStoredValue: jest.fn(async () => undefined),
}));

import { createNotificationDestinationActions } from "../../src/app/actions/notification-destination-actions";
import { readDeviceContentCache } from "../../src/content/device-content-cache";
import { findDeviceContentNotificationRecord } from "../../src/content/device-content-notification-ledger";
import { getStoredValue } from "../../src/app/app-storage";
import {
  createPendingNotificationDestinationRecord,
  serializePendingNotificationDestinationRecord,
} from "../../src/notifications/notification-destination";
import { RouteIntentCoordinator } from "../../src/navigation/route-intent";
import { AccountGenerationGuard } from "../../src/auth/session-integrity";
import { PersonalExamRuntime } from "../../src/calendar/personal-exam-runtime";
import type { TrustedMobileContentRecord } from "../../src/content/content-trust";

describe("device content notification destinations", () => {
  it("opens an owner-scoped delivered record after display-cache eviction without calling the legacy backend", async () => {
    const item = trustedRecord();
    const accountGuard = new AccountGenerationGuard();
    const ownerSnapshot = accountGuard.activate("owner-1");
    const personalExamRuntime = new PersonalExamRuntime({
      ownerGuard: accountGuard,
      createId: () => "personal-1",
      storage: {
        getItemAsync: async () => null,
        setItemAsync: async () => undefined,
        deleteItemAsync: async () => undefined,
      },
    });
    const pending = createPendingNotificationDestinationRecord({
      ownerId: ownerSnapshot.ownerId,
      destination: { schemaVersion: 1, type: "announcement", id: item.id },
      receivedAt: new Date("2026-09-14T12:00:00.000Z"),
    });
    jest.mocked(getStoredValue).mockResolvedValue(serializePendingNotificationDestinationRecord(pending));
    jest.mocked(readDeviceContentCache).mockResolvedValue({ items: [] } as unknown as Awaited<ReturnType<typeof readDeviceContentCache>>);
    jest.mocked(findDeviceContentNotificationRecord).mockResolvedValue(item);
    const apiRequest = jest.fn(async () => {
      throw new Error("legacy endpoint must not be called");
    });
    const session = {
      user: {
        id: ownerSnapshot.ownerId,
        fullName: "Test Student",
        email: "student@example.test",
        role: "student",
      },
      accessToken: "test-token",
      refreshToken: "test-refresh-token",
      expiresInSeconds: 900,
    };
    const setActiveTrustedDetail = jest.fn();
    const requestAppRoute = jest.fn(() => "request-1");
    const notificationNavigationRequestRef = { current: null };
    const actions = createNotificationDestinationActions({
      enqueueStorageMutation: async (operation) => operation(),
      accountGuardRef: { current: accountGuard },
      personalExamRuntime,
      apiRequest,
      setAnnouncements: jest.fn(),
      sessionRef: { current: session },
      setNotificationDestinationNotice: jest.fn(),
      routeIntentCoordinatorRef: { current: new RouteIntentCoordinator() },
      notificationNavigationRequestRef,
      announcementDetailRequestGenerationRef: { current: 0 },
      setActiveTrustedDetail,
      setAnnouncementDetailLoad: jest.fn(),
      courseSchedule: { loading: false },
      calendar: { loading: false },
      selectedUniversity: undefined,
      setActiveCalendarDetail: jest.fn(),
      requestAppRoute,
      setActiveTab: jest.fn(),
      setMessage: jest.fn(),
    } as Parameters<typeof createNotificationDestinationActions>[0]);

    await actions.resolvePendingNotificationForSession(
      pending,
      session,
      ownerSnapshot,
    );

    expect(readDeviceContentCache).toHaveBeenCalledWith(ownerSnapshot.ownerId);
    expect(findDeviceContentNotificationRecord).toHaveBeenCalledWith(ownerSnapshot.ownerId, item.id);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(setActiveTrustedDetail).toHaveBeenCalledWith(expect.objectContaining({
      type: "announcement",
      id: item.id,
      title: item.title,
    }));
    expect(requestAppRoute).toHaveBeenCalledWith("AnnouncementDetail", { announcementId: item.id });
    expect(notificationNavigationRequestRef.current).toEqual(expect.objectContaining({ requestKey: "request-1" }));
  });
});

function trustedRecord(): TrustedMobileContentRecord {
  return {
    id: "device-source-1-1111111111111111",
    sourceId: "source-1",
    sourceName: "Example University",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    title: "New device announcement",
    link: "https://example.edu.tr/announcements/item",
    canonicalUrl: "https://example.edu.tr/announcements/item",
    canonicalUrlAliases: [],
    officialSourceUrl: "https://example.edu.tr/announcements",
    sourceRelationships: [{
      sourceId: "source-1",
      sourceName: "Example University",
      officialSourceUrl: "https://example.edu.tr/announcements",
      scopeType: "university",
      scopeId: "university-1",
      canonicalUrl: "https://example.edu.tr/announcements/item",
    }],
    freshness: "fresh",
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
  };
}
