import {
  getMessaging,
  getInitialNotification,
  getToken,
  isDeviceRegisteredForRemoteMessages,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  registerDeviceForRemoteMessages,
  type Messaging,
  Network,
  Notifications,
  Linking,
  Platform
} from "./native-notification-modules";
import {
  parseNotificationDestination,
  type ParsedNotificationDestination
} from "./notification-destination";
import type {
  NativeNotificationPermissionSnapshot,
  NotificationPermissionAdapter,
  NotificationTokenAdapter
} from "./notification-lifecycle";

export const ACADEMIC_REMINDERS_CHANNEL_ID = "academic-reminders";
export const ACADEMIC_UPDATES_CHANNEL_ID = "academic-updates";
export const DEFAULT_NOTIFICATION_CHANNEL_ID = ACADEMIC_UPDATES_CHANNEL_ID;
const FOREGROUND_BRIDGE_CATEGORY = "academic-phase3-foreground";

export interface NativeNetworkState {
  connected: boolean;
  internetReachable: boolean | null;
}

export class ExpoNotificationPermissionAdapter implements NotificationPermissionAdapter {
  async inspect(): Promise<NativeNotificationPermissionSnapshot> {
    if (!isNativeNotificationPlatform()) return unavailablePermission();
    return toPermissionSnapshot(await Notifications.getPermissionsAsync());
  }

  async request(): Promise<NativeNotificationPermissionSnapshot> {
    if (!isNativeNotificationPlatform()) return unavailablePermission();
    const permission = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true
      }
    });
    return toPermissionSnapshot(permission);
  }
}

export class FirebaseNotificationTokenAdapter implements NotificationTokenAdapter {
  private messagingInstance: Messaging | null;

  constructor(messaging?: Messaging) {
    this.messagingInstance = messaging ?? null;
  }

  async getToken(): Promise<string> {
    const messaging = this.getMessaging();
    if (Platform.OS === "ios" && !isDeviceRegisteredForRemoteMessages(messaging)) {
      await registerDeviceForRemoteMessages(messaging);
    }
    return getToken(messaging);
  }

  onTokenRefresh(listener: (token: string) => void): () => void {
    return onTokenRefresh(this.getMessaging(), listener);
  }

  private getMessaging(): Messaging {
    this.messagingInstance ??= getMessaging();
    return this.messagingInstance;
  }
}

export class FirebaseNotificationTapAdapter {
  private messagingInstance: Messaging | null;

  constructor(messaging?: Messaging) {
    this.messagingInstance = messaging ?? null;
  }

  async consumeInitialDestination(): Promise<ParsedNotificationDestination | null> {
    // Read both providers independently: Firebase can reject while its native
    // service is still initializing, and Expo may retain an older response even
    // when Firebase has the authoritative cold-start destination.
    let remoteData: unknown;
    try {
      remoteData = (await getInitialNotification(this.getMessaging()))?.data;
    } catch {
      remoteData = undefined;
    }
    const response = Notifications.getLastNotificationResponse();
    if (response) Notifications.clearLastNotificationResponse();

    const remoteDestination = parseNotificationDestination(remoteData);
    if (remoteDestination) return remoteDestination;

    // Fallback covers local/test notifications handled by expo-notifications.
    return parseNotificationDestination(response?.notification.request.content.data);
  }

  subscribe(listener: (destination: ParsedNotificationDestination | null) => void): () => void {
    let lastDeliveryKey = "";
    let lastDeliveryAt = 0;
    const deliver = (destination: ParsedNotificationDestination | null) => {
      if (!destination) {
        listener(null);
        return;
      }
      const key = `${destination.recipientOwnerId}:${destination.destination.type}:${destination.destination.id}`;
      const now = Date.now();
      if (key === lastDeliveryKey && now - lastDeliveryAt < 2_000) return;
      lastDeliveryKey = key;
      lastDeliveryAt = now;
      listener(destination);
    };
    const unsubscribeFirebase = onNotificationOpenedApp(this.getMessaging(), (remoteMessage) => {
      deliver(parseNotificationDestination(remoteMessage.data));
    });
    const expoSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      deliver(parseNotificationDestination(response.notification.request.content.data));
    });
    return () => {
      unsubscribeFirebase();
      expoSubscription.remove();
    };
  }

  private getMessaging(): Messaging {
    this.messagingInstance ??= getMessaging();
    return this.messagingInstance;
  }
}

export class ExpoNetworkAdapter {
  async getState(signal?: AbortSignal): Promise<NativeNetworkState> {
    throwIfAborted(signal);
    const state = await Network.getNetworkStateAsync();
    throwIfAborted(signal);
    return {
      connected: state.isConnected === true,
      internetReachable: state.isInternetReachable ?? null
    };
  }

  async isConnected(signal?: AbortSignal): Promise<boolean> {
    const state = await this.getState(signal);
    return state.connected && state.internetReachable !== false;
  }
}

export function configureForegroundNotificationPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const shouldPresent = notification.request.content.categoryIdentifier === FOREGROUND_BRIDGE_CATEGORY;
      return {
        shouldShowBanner: shouldPresent,
        shouldShowList: shouldPresent,
        shouldPlaySound: shouldPresent,
        shouldSetBadge: false
      };
    }
  });
}

/** Bridges an eligible foreground FCM message to one local notification. */
export function subscribeToForegroundRemoteNotifications(messaging: Messaging = getMessaging()): () => void {
  return onMessage(messaging, async (remoteMessage) => {
    const parsed = parseNotificationDestination(remoteMessage.data);
    if (!parsed) return;
    const isReminder = parsed.destination.type === "calendar_event";
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: isReminder ? "Akademik tarih hatırlatması" : "Yeni akademik güncelleme",
          body: "Güvenilir içeriği açmak için bildirime dokun.",
          sound: "default",
          categoryIdentifier: FOREGROUND_BRIDGE_CATEGORY,
          data: {
            schemaVersion: "1",
            destinationType: parsed.destination.type,
            destinationId: parsed.destination.id,
            recipientOwnerId: parsed.recipientOwnerId
          }
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 1,
          channelId: isReminder ? ACADEMIC_REMINDERS_CHANNEL_ID : ACADEMIC_UPDATES_CHANNEL_ID
        }
      });
    } catch {
      // Foreground presentation is best-effort. Do not surface provider details or payloads.
    }
  });
}

export async function configureAndroidNotificationChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ACADEMIC_REMINDERS_CHANNEL_ID, {
    name: "Akademik hatırlatmalar",
    description: "Sınav, kayıt ve yaklaşan akademik tarih hatırlatmaları.",
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    showBadge: true,
    sound: "default",
    enableLights: true,
    lightColor: "#4F46E5",
    enableVibrate: true,
    vibrationPattern: [0, 250, 200, 250]
  });
  await Notifications.setNotificationChannelAsync(ACADEMIC_UPDATES_CHANNEL_ID, {
    name: "Akademik güncellemeler",
    description: "Duyuru ve akademik içerik güncellemeleri.",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    showBadge: true,
    sound: "default",
    enableLights: true,
    lightColor: "#4F46E5",
    enableVibrate: true,
    vibrationPattern: [0, 200]
  });
}

export function openNotificationSettings(): Promise<void> {
  return Linking.openSettings();
}

function toPermissionSnapshot(
  permission: Notifications.NotificationPermissionsStatus
): NativeNotificationPermissionSnapshot {
  const status = permission.status;
  return {
    available: true,
    status: status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined",
    canAskAgain: permission.canAskAgain
  };
}

function unavailablePermission(): NativeNotificationPermissionSnapshot {
  return {
    available: false,
    status: "undetermined",
    canAskAgain: false
  };
}

function isNativeNotificationPlatform(): boolean {
  return Platform.OS === "android" || Platform.OS === "ios";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw Object.assign(new Error("Network inspection aborted."), { name: "AbortError" });
}
