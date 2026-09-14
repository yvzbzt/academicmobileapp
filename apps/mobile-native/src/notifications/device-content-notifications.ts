import type { TrustedMobileContentRecord } from "../content/content-trust";
import type { NotificationLifecycleState } from "./notification-lifecycle";
import { parseNotificationDestination } from "./notification-destination";
import {
  ACADEMIC_UPDATES_CHANNEL_ID,
  FOREGROUND_BRIDGE_CATEGORY,
} from "./native-notification-adapter";
import { Notifications, Platform } from "./native-notification-modules";

type ContentNotificationPreferences = {
  enabled: boolean;
  categories: Record<string, boolean>;
  quietHours?: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: "Europe/Istanbul";
  };
};

export type DeviceContentNotificationResult =
  | "scheduled"
  | "disabled"
  | "quiet_hours"
  | "no_new_items"
  | "invalid_destination"
  | "duplicate"
  | "failed";

export interface DeviceContentNotificationInput {
  ownerId: string;
  items: readonly TrustedMobileContentRecord[];
  lifecycle: NotificationLifecycleState;
  preferences?: ContentNotificationPreferences;
  now?: Date;
  isCurrent?: () => boolean;
  getCurrentDeliveryState?: () => {
    lifecycle: NotificationLifecycleState;
    preferences?: ContentNotificationPreferences;
  };
  onScheduledItems?: (itemIds: readonly string[]) => void;
}

const RECENT_DELIVERY_WINDOW_MS = 10 * 60 * 1_000;
const MAX_RECENT_DELIVERIES = 256;
const recentDeliveries = new Map<string, number>();

/** Schedules at most one local notification for a device-sync delta. */
export async function notifyNewDeviceContent(
  input: DeviceContentNotificationInput,
): Promise<DeviceContentNotificationResult> {
  if (input.items.length === 0) return "no_new_items";
  const now = input.now ?? new Date();
  const current = currentDeliveryState(input);
  if (!canDeliverForOwner(input.ownerId, current.lifecycle, current.preferences)) return "disabled";
  if (isQuietHours(current.preferences, now)) return "quiet_hours";

  const eligibleItems = input.items.filter((item) => categoryEnabled(item, current.preferences));
  if (eligibleItems.length === 0) return "disabled";
  const destinationItem = eligibleItems.find((item) => parseNotificationDestination({
    schemaVersion: "1",
    destinationType: "announcement",
    destinationId: item.id,
    recipientOwnerId: input.ownerId,
  }));
  if (!destinationItem) return "invalid_destination";
  if (input.isCurrent && !input.isCurrent()) return "disabled";

  const deliveryKey = `${input.ownerId}:${destinationItem.id}`;
  if (!reserveRecentDelivery(deliveryKey, now.getTime())) return "duplicate";
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: notificationTitle(destinationItem),
        body: notificationBody(destinationItem, eligibleItems.length),
        sound: "default",
        categoryIdentifier: FOREGROUND_BRIDGE_CATEGORY,
        data: {
          schemaVersion: "1",
          destinationType: "announcement",
          destinationId: destinationItem.id,
          recipientOwnerId: input.ownerId,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        ...(Platform.OS === "android" ? { channelId: ACADEMIC_UPDATES_CHANNEL_ID } : {}),
      },
    });
  } catch {
    recentDeliveries.delete(deliveryKey);
    return "failed";
  }
  input.onScheduledItems?.(eligibleItems.map((item) => item.id));
  return "scheduled";
}

function currentDeliveryState(input: DeviceContentNotificationInput): {
  lifecycle: NotificationLifecycleState;
  preferences?: ContentNotificationPreferences;
} {
  return input.getCurrentDeliveryState?.() ?? {
    lifecycle: input.lifecycle,
    ...(input.preferences ? { preferences: input.preferences } : {}),
  };
}

function canDeliverForOwner(
  ownerId: string,
  lifecycle: NotificationLifecycleState,
  preferences: ContentNotificationPreferences | undefined,
): boolean {
  return lifecycle.ownerId === ownerId
    && lifecycle.preferenceEnabled
    && lifecycle.permission === "granted"
    && lifecycle.registration === "registered"
    && lifecycle.active
    && preferences?.enabled !== false;
}

function categoryEnabled(
  item: TrustedMobileContentRecord,
  preferences: ContentNotificationPreferences | undefined,
): boolean {
  if (!preferences) return true;
  const category = item.scopeType === "department"
    ? "department_announcement"
    : item.scopeType === "faculty"
      ? "faculty_announcement"
      : "announcement";
  return preferences.categories[category] !== false;
}

function isQuietHours(preferences: ContentNotificationPreferences | undefined, now: Date): boolean {
  const quietHours = preferences?.quietHours;
  if (!quietHours?.enabled) return false;
  const current = new Date(now.getTime() + 3 * 60 * 60 * 1_000);
  const time = `${current.getUTCHours().toString().padStart(2, "0")}:${current.getUTCMinutes().toString().padStart(2, "0")}`;
  return quietHours.start <= quietHours.end
    ? time >= quietHours.start && time < quietHours.end
    : time >= quietHours.start || time < quietHours.end;
}

function notificationTitle(item: TrustedMobileContentRecord): string {
  if (item.contentType === "news") return "Yeni üniversite haberi";
  if (item.contentType === "event") return "Yeni üniversite etkinliği";
  return "Yeni üniversite duyurusu";
}

function notificationBody(item: TrustedMobileContentRecord, count: number): string {
  const title = item.title.slice(0, 180);
  return count > 1 ? `${title} ve ${count - 1} yeni içerik` : title;
}

function reserveRecentDelivery(key: string, now: number): boolean {
  for (const [candidate, deliveredAt] of recentDeliveries) {
    if (deliveredAt + RECENT_DELIVERY_WINDOW_MS <= now) recentDeliveries.delete(candidate);
  }
  if (recentDeliveries.has(key)) return false;
  recentDeliveries.set(key, now);
  while (recentDeliveries.size > MAX_RECENT_DELIVERIES) {
    const oldest = recentDeliveries.keys().next().value as string | undefined;
    if (!oldest) break;
    recentDeliveries.delete(oldest);
  }
  return true;
}
