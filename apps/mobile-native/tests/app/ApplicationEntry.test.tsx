import { fireEvent, renderAsync, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as SecureStore from "expo-secure-store";
import App from "../../App";
import { GOOGLE_WEB_CLIENT_ID } from "../../src/app/app-auth-providers";
import {
  PRELOGIN_WELCOME_COMPLETION_STORAGE_KEY,
  PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE,
} from "../../src/auth/prelogin-welcome";

const mockStorage = new Map<string, string>();
const mockFirebaseUnsubscribe = jest.fn();
const mockNotificationUnsubscribe = jest.fn();

// Mock only device/provider boundaries. The entry point, hooks, action factories,
// navigation, and screen factories below all run their production implementations.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => { mockStorage.delete(key); }),
}));

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: {
    configure: jest.fn(),
    signOut: jest.fn(async () => undefined),
    signIn: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
  },
  isCancelledResponse: jest.fn(() => false),
  isErrorWithCode: jest.fn(() => false),
  statusCodes: { SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED", IN_PROGRESS: "IN_PROGRESS" },
}));

jest.mock("@react-native-firebase/app", () => ({
  getApp: jest.fn(() => ({ options: { clientId: "smoke-ios.apps.googleusercontent.com" } })),
}));

jest.mock("@react-native-firebase/messaging", () => ({
  getMessaging: jest.fn(() => ({})),
  getInitialNotification: jest.fn(async () => null),
  getToken: jest.fn(async () => "smoke-device-token"),
  isDeviceRegisteredForRemoteMessages: jest.fn(() => true),
  registerDeviceForRemoteMessages: jest.fn(async () => undefined),
  onNotificationOpenedApp: jest.fn(() => mockFirebaseUnsubscribe),
  onTokenRefresh: jest.fn(() => jest.fn()),
  onMessage: jest.fn(() => jest.fn()),
}));

jest.mock("expo-notifications", () => ({
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: mockNotificationUnsubscribe })),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: "undetermined", canAskAgain: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval" },
}));

jest.mock("expo-calendar", () => ({
  isAvailableAsync: jest.fn(async () => false),
}));

describe("real application module wiring", () => {
  afterEach(() => {
    mockStorage.clear();
  });

  it("hydrates, rerenders, enters Login, and disposes listeners without replacing app modules", async () => {
    jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null);
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (!url.endsWith("/universities?limit=500&offset=0")) {
        throw new Error(`Unexpected smoke-test network request: ${url}`);
      }
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    });

    const app = await renderAsync(<App />);
    await waitFor(() => {
      expect(screen.getByText("Duyuruları tek yerden takip et")).toBeTruthy();
    });
    expect(GoogleSignin.configure).toHaveBeenCalledWith(expect.objectContaining({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      scopes: ["email", "profile"],
      offlineAccess: false,
    }));
    expect(GOOGLE_WEB_CLIENT_ID).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/universities?limit=500&offset=0"),
      expect.objectContaining({ signal: expect.anything() }),
    );

    await app.rerenderAsync(<App />);
    expect(screen.getByText("Duyuruları tek yerden takip et")).toBeTruthy();
    expect(GoogleSignin.configure).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole("button", { name: "Tanıtımı atla" }));
    await waitFor(() => {
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        PRELOGIN_WELCOME_COMPLETION_STORAGE_KEY,
        PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE,
      );
      expect(screen.getByRole("button", { name: "Giriş yap" })).toBeTruthy();
    });

    await app.unmountAsync();
    expect(mockFirebaseUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockNotificationUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
