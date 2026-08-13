jest.mock("../../src/notifications", () => ({
  ACADEMIC_REMINDERS_CHANNEL_ID: "academic-reminders",
  FOREGROUND_BRIDGE_CATEGORY: "foreground-bridge",
}));

jest.mock("../../src/notifications/native-notification-modules", () => ({
  Platform: { OS: "android" },
  Notifications: {
    SchedulableTriggerInputTypes: { DATE: "date" },
    getPermissionsAsync: jest.fn(async () => ({ status: "granted", canAskAgain: true })),
    requestPermissionsAsync: jest.fn(async () => ({ status: "granted", canAskAgain: true })),
    scheduleNotificationAsync: jest.fn(),
    cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  },
}));

import { PersonalCalendarReminderCoordinator } from "../../src/calendar/personal-calendar-reminders";
import { Notifications } from "../../src/notifications/native-notification-modules";

const mockedNotifications = Notifications as jest.Mocked<typeof Notifications>;

class MemoryStorage {
  readonly values = new Map<string, string>();

  async getItemAsync(key: string) { return this.values.get(key) ?? null; }
  async setItemAsync(key: string, value: string) { this.values.set(key, value); }
  async deleteItemAsync(key: string) { this.values.delete(key); }
}

describe("PersonalCalendarReminderCoordinator", () => {
  beforeEach(() => {
    mockedNotifications.scheduleNotificationAsync
      .mockReset()
      .mockResolvedValueOnce("notification-1")
      .mockResolvedValueOnce("notification-2");
    mockedNotifications.cancelScheduledNotificationAsync.mockClear();
  });

  it("schedules, deduplicates, and reschedules an owner-scoped reminder", async () => {
    const storage = new MemoryStorage();
    const coordinator = new PersonalCalendarReminderCoordinator(storage, () => new Date("2026-09-01T00:00:00.000Z"));
    const item = {
      id: "personal-1",
      title: "Proje teslimi",
      examDate: "2026-09-02T12:00:00.000Z",
      kind: "task" as const,
      reminderMinutesBefore: 60,
    };

    await expect(coordinator.sync("student-1", item)).resolves.toBe("scheduled");
    await expect(coordinator.sync("student-1", item)).resolves.toBe("scheduled");
    expect(mockedNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockedNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({
        title: "Proje teslimi",
        data: expect.objectContaining({ destinationId: "personal:personal-1", recipientOwnerId: "student-1" }),
      }),
      trigger: expect.objectContaining({ date: Date.parse(item.examDate) - 60 * 60_000, channelId: "academic-reminders" }),
    }));

    await expect(coordinator.sync("student-1", { ...item, reminderMinutesBefore: 30 })).resolves.toBe("scheduled");
    expect(mockedNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("notification-1");
    expect(mockedNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    expect(storage.values.size).toBe(1);
  });

  it("cancels removed items during reconciliation and clears the owner envelope", async () => {
    const storage = new MemoryStorage();
    const coordinator = new PersonalCalendarReminderCoordinator(storage, () => new Date("2026-09-01T00:00:00.000Z"));
    await coordinator.sync("student-1", {
      id: "personal-1",
      title: "Çalışma oturumu",
      examDate: "2026-09-02T12:00:00.000Z",
      kind: "study",
      reminderMinutesBefore: 10,
    });

    await coordinator.reconcile("student-1", []);

    expect(mockedNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("notification-1");
    expect(storage.values.size).toBe(0);
  });
});
