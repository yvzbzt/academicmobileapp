import { Platform } from "react-native";
import {
  buildGoogleCalendarSyncItems,
  GoogleCalendarSyncError,
  type GoogleCalendarEventMapping,
} from "../google-calendar/google-calendar-sync";
import {
  type GoogleCalendarLifecycleState,
  findDuplicateGoogleCalendarMappings,
} from "../google-calendar/google-calendar-lifecycle";
import { type NotificationLifecycleState } from "../notifications";
import { type NativeCalendarSyncEvent } from "../native-calendar";
import { type EventRecord, type AnnouncementRecord, type AppleCalendarLifecycleState } from "./app-types";
import { userMessageFromError } from "./app-errors";

export function buildNativeCalendarSyncEvents(
  calendarEvents: EventRecord[],
  announcementItems: AnnouncementRecord[],
): NativeCalendarSyncEvent[] {
  return buildGoogleCalendarSyncItems(calendarEvents, announcementItems).map((item) => ({
    id: item.sourceId,
    sourceId: item.sourceId,
    sourceType: item.sourceType,
    title: item.summary,
    startDate: item.startDate,
    endDate: item.endDate,
    allDay: item.allDay,
    ...(item.timeZone ? { timezone: item.timeZone } : {}),
    notes: item.description,
    ...(item.location ? { location: item.location } : {}),
    category: item.sourceType,
  }));
}

export function googleCalendarUserMessage(error: unknown): string {
  if (error instanceof GoogleCalendarSyncError) {
    switch (error.code) {
      case "GOOGLE_CALENDAR_AUTH_EXPIRED":
        return "Google Takvim oturumunun süresi doldu. Hesabını yeniden seçip tekrar dene.";
      case "GOOGLE_CALENDAR_PERMISSION_DENIED":
        return "Takvime ekleme izni verilmedi. Google izin ekranında Takvim erişimine izin verip tekrar dene.";
      case "GOOGLE_CALENDAR_API_UNAVAILABLE":
        return "Google Takvim hizmeti şu anda bu uygulama için kullanılamıyor. Biraz sonra tekrar dene.";
      case "GOOGLE_CALENDAR_NETWORK_ERROR":
        return "Google Takvim'e ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.";
      case "GOOGLE_CALENDAR_VERIFICATION_FAILED":
        return "Tarihler gönderildi ancak Google Takvim'de doğrulanamadı. Tekrar eşitlemeyi dene.";
      default:
        return "Google Takvim eşitlemesi tamamlanamadı. Lütfen tekrar dene.";
    }
  }
  return userMessageFromError(error, "Google Takvim eşitlemesi tamamlanamadı. Lütfen tekrar dene.");
}

export function googleCalendarLifecycleLabel(state: GoogleCalendarLifecycleState): string {
  const labels: Record<GoogleCalendarLifecycleState, string> = {
    disconnected: "Bağlı değil",
    checking: "Doğrulanıyor",
    connected: "Bağlı",
    expired: "Süresi doldu",
    syncing: "Eşitleniyor",
    partial: "Kısmi",
    error: "Hata"
  };
  return labels[state];
}

export function resolveAppleCalendarPresentation(state: AppleCalendarLifecycleState) {
  const presentations = {
    unavailable: {
      label: "Kullanılamıyor",
      title: "Apple Takvim bu cihazda kullanılamıyor",
      detail: "Bu bağlantı yalnızca iPhone ve iPad cihazlarında kullanılabilir.",
      tone: "neutral" as const,
    },
    disconnected: {
      label: "Bağlı değil",
      title: "Apple Takvim bağlı değil",
      detail: "Akademik kayıtlarını cihazındaki Apple Takvim ile eşitleyebilirsin.",
      tone: "neutral" as const,
    },
    checking: {
      label: "Kontrol ediliyor",
      title: "Apple Takvim bağlantısı kontrol ediliyor",
      detail: "Cihaz izni, uygulama takvimi ve yönetilen kayıtlar doğrulanıyor.",
      tone: "info" as const,
    },
    connected: {
      label: "Bağlı",
      title: "Apple Takvim bağlı",
      detail: "Yalnızca uygulamanın yönettiği akademik kayıtlar eşitlenir.",
      tone: "success" as const,
    },
    syncing: {
      label: "Eşitleniyor",
      title: "Apple Takvim eşitleniyor",
      detail: "Akademik kayıtlar cihazında doğrulanıyor.",
      tone: "info" as const,
    },
    partial: {
      label: "Kontrol gerekli",
      title: "Apple Takvim kısmen eşitlendi",
      detail: "Kullanıcı tarafından değiştirilen veya doğrulanamayan kayıtlar korunarak atlandı.",
      tone: "warning" as const,
    },
    denied: {
      label: "İzin gerekli",
      title: "Apple Takvim izni kapalı",
      detail: "Eşitlemek için cihaz ayarlarından tam takvim erişimi vermelisin.",
      tone: "warning" as const,
    },
    error: {
      label: "Hata",
      title: "Apple Takvim işlemi tamamlanamadı",
      detail: "Takvim ve izin durumunu kontrol edip yeniden deneyebilirsin.",
      tone: "error" as const,
    },
  };
  const presentation = presentations[state];
  return {
    state,
    ...presentation,
    busy: state === "checking" || state === "syncing",
    connected: state === "connected" || state === "syncing" || state === "partial",
  };
}

export function notificationLifecycleMessage(state: NotificationLifecycleState): string {
  if (state.active) return "Bildirim izni verildi ve bu cihaz teslimat için kayıtlı.";
  if (Platform.OS === "web" || state.permission === "unavailable") {
    return "Push bildirimleri bu platformda kullanılamıyor.";
  }
  if (state.permission === "permanently_denied") {
    return "Bildirim izni cihaz ayarlarından kapalı. Teslimat etkin değil.";
  }
  if (state.permission === "denied") return "Bildirim izni verilmedi. Teslimat etkin değil.";
  if (state.permission === "not_requested") return "Bildirim izni henüz istenmedi. Yalnızca sen açtığında sorulur.";
  if (state.registration === "registering" || state.permission === "checking") return "Bildirim durumu doğrulanıyor.";
  if (state.registration === "error" || state.permission === "error") {
    return "Bu cihazın bildirim teslimatı doğrulanamadı. Tercihlerin kaydedilebilir, ancak teslimat etkin değil.";
  }
  return "Bildirim teslimatı etkin değil.";
}

export function mappingsMatchDesiredContent(
  desired: readonly { sourceId: string; sourceType: string; fingerprint: string }[],
  remote: readonly GoogleCalendarEventMapping[],
  deletionEligibleSourceTypes: readonly string[]
): boolean {
  if (findDuplicateGoogleCalendarMappings(remote).hasDuplicates) return false;
  const remoteBySource = new Map(remote.map((mapping) => [
    `${mapping.sourceType}:${mapping.sourceId}`,
    mapping
  ]));
  if (!desired.every((item) => remoteBySource.get(`${item.sourceType}:${item.sourceId}`)?.fingerprint === item.fingerprint)) {
    return false;
  }
  const desiredKeys = new Set(desired.map((item) => `${item.sourceType}:${item.sourceId}`));
  return remote.every((mapping) => (
    !deletionEligibleSourceTypes.includes(mapping.sourceType)
    || desiredKeys.has(`${mapping.sourceType}:${mapping.sourceId}`)
  ));
}
