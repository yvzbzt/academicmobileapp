jest.mock("../../src/notifications/native-notification-modules", () => ({
  Platform: { OS: "android" },
  Notifications: {
    SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval" },
    scheduleNotificationAsync: jest.fn(),
  },
}));

import { notifyNewDeviceContent } from "../../src/notifications/device-content-notifications";
import { Notifications } from "../../src/notifications/native-notification-modules";
import type { TrustedMobileContentRecord } from "../../src/content/content-trust";
import type { NotificationLifecycleState } from "../../src/notifications/notification-lifecycle";

const mockedNotifications = Notifications as jest.Mocked<typeof Notifications>;

describe("device content discovery notifications", () => {
  beforeEach(() => {
    mockedNotifications.scheduleNotificationAsync.mockReset().mockResolvedValue("notification-1");
  });

  it("schedules one owner-scoped notification for a multi-item sync delta", async () => {
    const items = [record("device-source-1-1111111111111111", "Newest"), record("device-source-1-2222222222222222", "Second")];
    const onScheduledItems = jest.fn();

    await expect(notifyNewDeviceContent({
      ownerId: "owner-1",
      items,
      lifecycle: activeLifecycle("owner-1"),
      preferences: { enabled: true, categories: { announcement: true } },
      now: new Date("2026-09-14T12:00:00.000Z"),
      onScheduledItems,
    })).resolves.toBe("scheduled");

    expect(mockedNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockedNotifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: expect.objectContaining({
        title: "Yeni üniversite duyurusu",
        body: "Newest ve 1 yeni içerik",
        data: {
          schemaVersion: "1",
          destinationType: "announcement",
          destinationId: items[0]?.id,
          recipientOwnerId: "owner-1",
        },
      }),
      trigger: expect.objectContaining({ channelId: "academic-updates", seconds: 1 }),
    });
    expect(onScheduledItems).toHaveBeenCalledWith(items.map((item) => item.id));
  });

  it("reports only categories included in the aggregate notification as scheduled", async () => {
    const announcement = record("device-source-1-8888888888888888", "Announcement");
    const faculty = {
      ...record("device-source-1-9999999999999999", "Faculty announcement"),
      scopeType: "faculty" as const,
      scopeId: "faculty-1",
    };
    const onScheduledItems = jest.fn();

    await expect(notifyNewDeviceContent({
      ownerId: "owner-mixed-category",
      items: [announcement, faculty],
      lifecycle: activeLifecycle("owner-mixed-category"),
      preferences: {
        enabled: true,
        categories: { announcement: true, faculty_announcement: false },
      },
      onScheduledItems,
    })).resolves.toBe("scheduled");

    expect(onScheduledItems).toHaveBeenCalledWith([announcement.id]);
    expect(mockedNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({ body: announcement.title }),
    }));
  });

  it.each([
    ["wrong owner", activeLifecycle("another-owner"), { enabled: true, categories: { announcement: true } }],
    ["permission denied", { ...activeLifecycle("owner-2"), permission: "denied", active: false }, { enabled: true, categories: { announcement: true } }],
    ["preference disabled", activeLifecycle("owner-2"), { enabled: false, categories: { announcement: true } }],
    ["category disabled", activeLifecycle("owner-2"), { enabled: true, categories: { announcement: false } }],
  ] as const)("does not schedule when %s", async (_label, lifecycle, preferences) => {
    await expect(notifyNewDeviceContent({
      ownerId: "owner-2",
      items: [record("device-source-2-3333333333333333", "Ignored")],
      lifecycle,
      preferences,
    })).resolves.toBe("disabled");

    expect(mockedNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("respects Istanbul quiet hours and treats local scheduling as best-effort", async () => {
    await expect(notifyNewDeviceContent({
      ownerId: "owner-quiet",
      items: [record("device-source-3-4444444444444444", "Quiet")],
      lifecycle: activeLifecycle("owner-quiet"),
      preferences: {
        enabled: true,
        categories: { announcement: true },
        quietHours: { enabled: true, start: "22:00", end: "07:00", timezone: "Europe/Istanbul" },
      },
      now: new Date("2026-09-14T20:00:00.000Z"),
    })).resolves.toBe("quiet_hours");
    expect(mockedNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();

    mockedNotifications.scheduleNotificationAsync.mockRejectedValueOnce(new Error("native failure"));
    await expect(notifyNewDeviceContent({
      ownerId: "owner-failure",
      items: [record("device-source-4-5555555555555555", "Best effort")],
      lifecycle: activeLifecycle("owner-failure"),
    })).resolves.toBe("failed");
  });

  it("reads current consent at scheduling time instead of using a captured enabled state", async () => {
    await expect(notifyNewDeviceContent({
      ownerId: "owner-current-consent",
      items: [record("device-source-1-6666666666666666", "Current consent")],
      lifecycle: activeLifecycle("owner-current-consent"),
      preferences: { enabled: true, categories: { announcement: true } },
      getCurrentDeliveryState: () => ({
        lifecycle: { ...activeLifecycle("owner-current-consent"), preferenceEnabled: false, active: false },
        preferences: { enabled: false, categories: { announcement: true } },
      }),
    })).resolves.toBe("disabled");

    expect(mockedNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("releases a failed scheduling reservation so the durable pending item can retry", async () => {
    mockedNotifications.scheduleNotificationAsync
      .mockRejectedValueOnce(new Error("native failure"))
      .mockResolvedValueOnce("notification-retry");
    const input = {
      ownerId: "owner-retry",
      items: [record("device-source-1-7777777777777777", "Retry")],
      lifecycle: activeLifecycle("owner-retry"),
      now: new Date("2026-09-14T12:00:00.000Z"),
    };

    await expect(notifyNewDeviceContent(input)).resolves.toBe("failed");
    await expect(notifyNewDeviceContent(input)).resolves.toBe("scheduled");
    expect(mockedNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });
});

function activeLifecycle(ownerId: string): NotificationLifecycleState {
  return {
    schemaVersion: 1,
    ownerId,
    preferenceEnabled: true,
    permission: "granted",
    registration: "registered",
    active: true,
  };
}

function record(id: string, title: string): TrustedMobileContentRecord {
  return {
    id,
    sourceId: "source-1",
    sourceName: "Example University",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    title,
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
