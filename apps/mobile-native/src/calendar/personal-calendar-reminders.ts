import { ACADEMIC_REMINDERS_CHANNEL_ID, FOREGROUND_BRIDGE_CATEGORY } from "../notifications";
import { Notifications, Platform } from "../notifications/native-notification-modules";
import type { ManualExamRecord } from "../session-integrity/manual-exam-storage";

const REMINDER_ENVELOPE_VERSION = 1;
const REMINDER_STORAGE_PREFIX = "native_personal_calendar_reminders_v1";

type ReminderMapping = {
  notificationId: string;
  signature: string;
};

type ReminderEnvelope = {
  schemaVersion: typeof REMINDER_ENVELOPE_VERSION;
  ownerId: string;
  mappings: Record<string, ReminderMapping>;
};

export type PersonalCalendarReminderResult =
  | "scheduled"
  | "disabled"
  | "past"
  | "permission_denied";

export interface PersonalCalendarReminderStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export class PersonalCalendarReminderCoordinator {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: PersonalCalendarReminderStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  sync(ownerId: string, item: ManualExamRecord): Promise<PersonalCalendarReminderResult> {
    return this.enqueue(() => this.syncNow(requireOwner(ownerId), item));
  }

  cancel(ownerId: string, itemId: string): Promise<void> {
    return this.enqueue(async () => {
      const normalizedOwner = requireOwner(ownerId);
      const envelope = await this.read(normalizedOwner);
      const mapping = envelope.mappings[itemId];
      if (mapping) await cancelBestEffort(mapping.notificationId);
      delete envelope.mappings[itemId];
      await this.write(normalizedOwner, envelope);
    });
  }

  reconcile(ownerId: string, items: readonly ManualExamRecord[]): Promise<void> {
    return this.enqueue(async () => {
      const normalizedOwner = requireOwner(ownerId);
      const envelope = await this.read(normalizedOwner);
      const itemIds = new Set(items.map((item) => item.id));
      for (const [itemId, mapping] of Object.entries(envelope.mappings)) {
        if (itemIds.has(itemId)) continue;
        await cancelBestEffort(mapping.notificationId);
        delete envelope.mappings[itemId];
      }
      await this.write(normalizedOwner, envelope);
      for (const item of items) await this.syncNow(normalizedOwner, item);
    });
  }

  cancelOwner(ownerId: string): Promise<void> {
    return this.enqueue(async () => {
      const normalizedOwner = requireOwner(ownerId);
      const envelope = await this.read(normalizedOwner);
      await Promise.all(Object.values(envelope.mappings).map((mapping) => cancelBestEffort(mapping.notificationId)));
      await this.storage.deleteItemAsync(storageKey(normalizedOwner));
    });
  }

  private async syncNow(ownerId: string, item: ManualExamRecord): Promise<PersonalCalendarReminderResult> {
    const envelope = await this.read(ownerId);
    const existing = envelope.mappings[item.id];
    const signature = reminderSignature(item);
    if (existing?.signature === signature) return "scheduled";
    if (existing) {
      await cancelBestEffort(existing.notificationId);
      delete envelope.mappings[item.id];
    }

    if (item.reminderMinutesBefore === undefined) {
      await this.write(ownerId, envelope);
      return "disabled";
    }
    const triggerAt = Date.parse(item.examDate) - item.reminderMinutesBefore * 60_000;
    if (!Number.isFinite(triggerAt) || triggerAt <= this.now().getTime()) {
      await this.write(ownerId, envelope);
      return "past";
    }
    if (!await ensurePermission()) {
      await this.write(ownerId, envelope);
      return "permission_denied";
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: item.title,
        body: reminderBody(item.reminderMinutesBefore),
        sound: "default",
        categoryIdentifier: FOREGROUND_BRIDGE_CATEGORY,
        data: {
          schemaVersion: "1",
          destinationType: "calendar_event",
          destinationId: `personal:${item.id}`,
          recipientOwnerId: ownerId,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerAt,
        ...(Platform.OS === "android" ? { channelId: ACADEMIC_REMINDERS_CHANNEL_ID } : {}),
      },
    });
    envelope.mappings[item.id] = { notificationId, signature };
    await this.write(ownerId, envelope);
    return "scheduled";
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.catch(() => undefined).then(operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read(ownerId: string): Promise<ReminderEnvelope> {
    const raw = await this.storage.getItemAsync(storageKey(ownerId));
    if (!raw) return emptyEnvelope(ownerId);
    try {
      const parsed = JSON.parse(raw) as Partial<ReminderEnvelope>;
      if (parsed.schemaVersion !== REMINDER_ENVELOPE_VERSION || parsed.ownerId !== ownerId || !isMappingRecord(parsed.mappings)) {
        return emptyEnvelope(ownerId);
      }
      return { schemaVersion: REMINDER_ENVELOPE_VERSION, ownerId, mappings: parsed.mappings };
    } catch {
      return emptyEnvelope(ownerId);
    }
  }

  private async write(ownerId: string, envelope: ReminderEnvelope): Promise<void> {
    if (Object.keys(envelope.mappings).length === 0) {
      await this.storage.deleteItemAsync(storageKey(ownerId));
      return;
    }
    await this.storage.setItemAsync(storageKey(ownerId), JSON.stringify(envelope));
  }
}

async function ensurePermission(): Promise<boolean> {
  let permission = await Notifications.getPermissionsAsync();
  if (permission.status === "undetermined" && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
  }
  return permission.status === "granted";
}

async function cancelBestEffort(notificationId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
}

function reminderSignature(item: ManualExamRecord): string {
  return JSON.stringify([item.title, item.examDate, item.reminderMinutesBefore]);
}

function reminderBody(minutesBefore: number): string {
  if (minutesBefore === 0) return "Kişisel takvim etkinliğin şimdi başlıyor.";
  if (minutesBefore === 60) return "Kişisel takvim etkinliğine 1 saat kaldı.";
  if (minutesBefore === 1_440) return "Kişisel takvim etkinliğine 1 gün kaldı.";
  return `Kişisel takvim etkinliğine ${minutesBefore} dakika kaldı.`;
}

function emptyEnvelope(ownerId: string): ReminderEnvelope {
  return { schemaVersion: REMINDER_ENVELOPE_VERSION, ownerId, mappings: {} };
}

function isMappingRecord(value: unknown): value is Record<string, ReminderMapping> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === "object" && entry !== null
      && typeof (entry as ReminderMapping).notificationId === "string"
      && typeof (entry as ReminderMapping).signature === "string");
}

function storageKey(ownerId: string): string {
  const encoded = Array.from(ownerId, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("_");
  return `${REMINDER_STORAGE_PREFIX}_${encoded}`;
}

function requireOwner(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("A personal-calendar reminder owner is required.");
  return normalized;
}
