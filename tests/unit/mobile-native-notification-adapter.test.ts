import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  messaging: { name: "messaging-instance" },
  platform: { OS: "android" },
  getMessaging: vi.fn(),
  getInitialNotification: vi.fn(),
  getToken: vi.fn(),
  isDeviceRegisteredForRemoteMessages: vi.fn(),
  onMessage: vi.fn(),
  onNotificationOpenedApp: vi.fn(),
  onTokenRefresh: vi.fn(),
  registerDeviceForRemoteMessages: vi.fn(),
  firebaseOpenedListener: null as ((message: { data?: unknown }) => void) | null,
  foregroundMessageListener: null as ((message: { data?: unknown }) => Promise<void>) | null,
  firebaseUnsubscribe: vi.fn(),
  foregroundUnsubscribe: vi.fn(),
  tokenRefreshUnsubscribe: vi.fn(),
  expoResponseListener: null as ((response: unknown) => void) | null,
  expoRemove: vi.fn(),
  getLastNotificationResponse: vi.fn(),
  clearLastNotificationResponse: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  setNotificationHandler: vi.fn(),
  openSettings: vi.fn(),
  getNetworkStateAsync: vi.fn()
}));

vi.mock("../../apps/mobile-native/src/notifications/native-notification-modules", () => ({
  getMessaging: nativeMocks.getMessaging,
  getInitialNotification: nativeMocks.getInitialNotification,
  getToken: nativeMocks.getToken,
  isDeviceRegisteredForRemoteMessages: nativeMocks.isDeviceRegisteredForRemoteMessages,
  onMessage: nativeMocks.onMessage,
  onNotificationOpenedApp: nativeMocks.onNotificationOpenedApp,
  onTokenRefresh: nativeMocks.onTokenRefresh,
  registerDeviceForRemoteMessages: nativeMocks.registerDeviceForRemoteMessages,
  Network: {
    getNetworkStateAsync: nativeMocks.getNetworkStateAsync
  },
  Notifications: {
    AndroidImportance: {
      DEFAULT: 3,
      HIGH: 4
    },
    AndroidNotificationVisibility: {
      PRIVATE: 0
    },
    SchedulableTriggerInputTypes: {
      TIME_INTERVAL: "timeInterval"
    },
    addNotificationResponseReceivedListener: nativeMocks.addNotificationResponseReceivedListener,
    clearLastNotificationResponse: nativeMocks.clearLastNotificationResponse,
    getLastNotificationResponse: nativeMocks.getLastNotificationResponse,
    getPermissionsAsync: nativeMocks.getPermissionsAsync,
    requestPermissionsAsync: nativeMocks.requestPermissionsAsync,
    scheduleNotificationAsync: nativeMocks.scheduleNotificationAsync,
    setNotificationChannelAsync: nativeMocks.setNotificationChannelAsync,
    setNotificationHandler: nativeMocks.setNotificationHandler
  },
  Linking: {
    openSettings: nativeMocks.openSettings
  },
  Platform: nativeMocks.platform
}));

const {
  ACADEMIC_REMINDERS_CHANNEL_ID,
  ACADEMIC_UPDATES_CHANNEL_ID,
  FirebaseNotificationTapAdapter,
  FirebaseNotificationTokenAdapter,
  configureAndroidNotificationChannels,
  configureForegroundNotificationPresentation,
  subscribeToForegroundRemoteNotifications
} = await import("../../apps/mobile-native/src/notifications/native-notification-adapter");

const announcementPayload = {
  schemaVersion: "1",
  destinationType: "announcement",
  destinationId: "announcement-42",
  recipientOwnerId: "owner-a"
};

const calendarPayload = {
  schemaVersion: "1",
  destinationType: "calendar_event",
  destinationId: "calendar-event:17",
  recipientOwnerId: "owner-b"
};

beforeEach(() => {
  vi.clearAllMocks();
  nativeMocks.platform.OS = "android";
  nativeMocks.firebaseOpenedListener = null;
  nativeMocks.foregroundMessageListener = null;
  nativeMocks.expoResponseListener = null;
  nativeMocks.getMessaging.mockReturnValue(nativeMocks.messaging);
  nativeMocks.getInitialNotification.mockResolvedValue(null);
  nativeMocks.getToken.mockResolvedValue("native-secret-token");
  nativeMocks.isDeviceRegisteredForRemoteMessages.mockReturnValue(true);
  nativeMocks.registerDeviceForRemoteMessages.mockResolvedValue(undefined);
  nativeMocks.onTokenRefresh.mockReturnValue(nativeMocks.tokenRefreshUnsubscribe);
  nativeMocks.onNotificationOpenedApp.mockImplementation((_messaging, listener) => {
    nativeMocks.firebaseOpenedListener = listener;
    return nativeMocks.firebaseUnsubscribe;
  });
  nativeMocks.onMessage.mockImplementation((_messaging, listener) => {
    nativeMocks.foregroundMessageListener = listener;
    return nativeMocks.foregroundUnsubscribe;
  });
  nativeMocks.getLastNotificationResponse.mockReturnValue(null);
  nativeMocks.addNotificationResponseReceivedListener.mockImplementation((listener) => {
    nativeMocks.expoResponseListener = listener;
    return { remove: nativeMocks.expoRemove };
  });
  nativeMocks.getPermissionsAsync.mockResolvedValue({
    status: "undetermined",
    canAskAgain: true
  });
  nativeMocks.requestPermissionsAsync.mockResolvedValue({
    status: "granted",
    canAskAgain: true
  });
  nativeMocks.scheduleNotificationAsync.mockResolvedValue("local-notification-id");
  nativeMocks.setNotificationChannelAsync.mockResolvedValue(null);
  nativeMocks.openSettings.mockResolvedValue(undefined);
});

describe("native notification cold-start routing", () => {
  it("uses and clears the Expo fallback when Firebase initial notification rejects", async () => {
    nativeMocks.getInitialNotification.mockRejectedValueOnce(new Error("native initialization failed"));
    nativeMocks.getLastNotificationResponse.mockReturnValue(notificationResponse(announcementPayload));

    const destination = await new FirebaseNotificationTapAdapter(nativeMocks.messaging as never)
      .consumeInitialDestination();

    expect(destination).toEqual({
      destination: { schemaVersion: 1, type: "announcement", id: "announcement-42" },
      recipientOwnerId: "owner-a"
    });
    expect(nativeMocks.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it("prefers Firebase but still consumes a stale cached Expo response", async () => {
    nativeMocks.getInitialNotification.mockResolvedValueOnce({ data: calendarPayload });
    nativeMocks.getLastNotificationResponse.mockReturnValue(notificationResponse(announcementPayload));

    const destination = await new FirebaseNotificationTapAdapter(nativeMocks.messaging as never)
      .consumeInitialDestination();

    expect(destination).toEqual({
      destination: { schemaVersion: 1, type: "calendar_event", id: "calendar-event:17" },
      recipientOwnerId: "owner-b"
    });
    expect(nativeMocks.getLastNotificationResponse).toHaveBeenCalledTimes(1);
    expect(nativeMocks.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it("strictly rejects malformed Firebase data before using a valid Expo destination", async () => {
    nativeMocks.getInitialNotification.mockResolvedValueOnce({
      data: { ...calendarPayload, unexpectedUrl: "https://evil.example" }
    });
    nativeMocks.getLastNotificationResponse.mockReturnValue(notificationResponse(announcementPayload));

    const destination = await new FirebaseNotificationTapAdapter(nativeMocks.messaging as never)
      .consumeInitialDestination();

    expect(destination?.destination).toEqual({
      schemaVersion: 1,
      type: "announcement",
      id: "announcement-42"
    });
  });

  it("routes opened notifications once across Firebase and Expo and tears both listeners down", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const listener = vi.fn();
    const unsubscribe = new FirebaseNotificationTapAdapter(nativeMocks.messaging as never).subscribe(listener);

    nativeMocks.firebaseOpenedListener?.({ data: announcementPayload });
    nativeMocks.expoResponseListener?.(notificationResponse(announcementPayload));
    nativeMocks.firebaseOpenedListener?.({ data: { ...announcementPayload, schemaVersion: "2" } });

    expect(listener).toHaveBeenNthCalledWith(1, {
      destination: { schemaVersion: 1, type: "announcement", id: "announcement-42" },
      recipientOwnerId: "owner-a"
    });
    expect(listener).toHaveBeenNthCalledWith(2, null);

    unsubscribe();
    expect(nativeMocks.firebaseUnsubscribe).toHaveBeenCalledTimes(1);
    expect(nativeMocks.expoRemove).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });
});

describe("Firebase notification token adapter", () => {
  it("reads an Android FCM token without attempting iOS remote-message registration", async () => {
    nativeMocks.platform.OS = "android";
    const adapter = new FirebaseNotificationTokenAdapter(nativeMocks.messaging as never);

    await expect(adapter.getToken()).resolves.toBe("native-secret-token");

    expect(nativeMocks.isDeviceRegisteredForRemoteMessages).not.toHaveBeenCalled();
    expect(nativeMocks.registerDeviceForRemoteMessages).not.toHaveBeenCalled();
    expect(nativeMocks.getToken).toHaveBeenCalledWith(nativeMocks.messaging);
  });

  it("registers an unregistered iOS device before reading its FCM token", async () => {
    nativeMocks.platform.OS = "ios";
    nativeMocks.isDeviceRegisteredForRemoteMessages.mockReturnValue(false);
    const adapter = new FirebaseNotificationTokenAdapter(nativeMocks.messaging as never);

    await adapter.getToken();

    expect(nativeMocks.isDeviceRegisteredForRemoteMessages).toHaveBeenCalledWith(nativeMocks.messaging);
    expect(nativeMocks.registerDeviceForRemoteMessages).toHaveBeenCalledWith(nativeMocks.messaging);
    expect(nativeMocks.registerDeviceForRemoteMessages.mock.invocationCallOrder[0])
      .toBeLessThan(nativeMocks.getToken.mock.invocationCallOrder[0]!);
  });

  it("forwards token-refresh registration and its native unsubscribe handle", () => {
    const listener = vi.fn();
    const adapter = new FirebaseNotificationTokenAdapter(nativeMocks.messaging as never);

    const unsubscribe = adapter.onTokenRefresh(listener);

    expect(nativeMocks.onTokenRefresh).toHaveBeenCalledWith(nativeMocks.messaging, listener);
    expect(unsubscribe).toBe(nativeMocks.tokenRefreshUnsubscribe);
  });
});

describe("foreground notification bridge", () => {
  it("presents only locally bridged notifications while the app is foregrounded", async () => {
    configureForegroundNotificationPresentation();
    const handler = nativeMocks.setNotificationHandler.mock.calls[0]?.[0];

    await expect(handler.handleNotification(notification("academic-phase3-foreground"))).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false
    });
    await expect(handler.handleNotification(notification("provider-category"))).resolves.toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false
    });
  });

  it("bridges one strictly valid foreground FCM message with sanitized local content", async () => {
    const unsubscribe = subscribeToForegroundRemoteNotifications(nativeMocks.messaging as never);

    await nativeMocks.foregroundMessageListener?.({
      data: { ...announcementPayload, url: "https://evil.example" }
    });
    expect(nativeMocks.scheduleNotificationAsync).not.toHaveBeenCalled();

    await nativeMocks.foregroundMessageListener?.({
      data: announcementPayload,
      notification: { title: "untrusted remote title", body: "untrusted remote body" }
    } as never);

    expect(nativeMocks.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(nativeMocks.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: expect.objectContaining({
        categoryIdentifier: "academic-phase3-foreground",
        data: announcementPayload,
        sound: "default"
      }),
      trigger: {
        type: "timeInterval",
        seconds: 1,
        channelId: ACADEMIC_UPDATES_CHANNEL_ID
      }
    });
    expect(JSON.stringify(nativeMocks.scheduleNotificationAsync.mock.calls[0]?.[0]))
      .not.toContain("untrusted remote");

    unsubscribe();
    expect(nativeMocks.foregroundUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("uses the reminder channel for calendar events and contains presentation failures", async () => {
    nativeMocks.scheduleNotificationAsync.mockRejectedValueOnce(new Error("local presentation failed"));
    subscribeToForegroundRemoteNotifications(nativeMocks.messaging as never);

    await expect(nativeMocks.foregroundMessageListener?.({ data: calendarPayload })).resolves.toBeUndefined();
    expect(nativeMocks.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      trigger: expect.objectContaining({ channelId: ACADEMIC_REMINDERS_CHANNEL_ID })
    }));
  });
});

describe("Android notification channels", () => {
  it("defines private reminder and update channels with distinct importance", async () => {
    nativeMocks.platform.OS = "android";

    await configureAndroidNotificationChannels();

    expect(nativeMocks.setNotificationChannelAsync).toHaveBeenNthCalledWith(
      1,
      ACADEMIC_REMINDERS_CHANNEL_ID,
      expect.objectContaining({
        importance: 4,
        lockscreenVisibility: 0,
        showBadge: true,
        sound: "default",
        enableVibrate: true
      })
    );
    expect(nativeMocks.setNotificationChannelAsync).toHaveBeenNthCalledWith(
      2,
      ACADEMIC_UPDATES_CHANNEL_ID,
      expect.objectContaining({
        importance: 3,
        lockscreenVisibility: 0,
        showBadge: true,
        sound: "default",
        enableVibrate: true
      })
    );
  });

  it("does not create Android channels on iOS", async () => {
    nativeMocks.platform.OS = "ios";

    await configureAndroidNotificationChannels();

    expect(nativeMocks.setNotificationChannelAsync).not.toHaveBeenCalled();
  });
});

function notificationResponse(data: unknown) {
  return {
    notification: {
      request: {
        content: { data }
      }
    }
  };
}

function notification(categoryIdentifier: string) {
  return {
    request: {
      content: { categoryIdentifier }
    }
  };
}
