import { NativeModules, Platform } from "react-native";
import { type NotificationPreferencePayload } from "./app-types";

// Sourced from app.json; kept visible here so Profile never reports a package-only placeholder.
export const NATIVE_APP_VERSION = "0.1.5";

export const DEFAULT_REMINDER_OFFSETS = [7, 1, 0];

export const DEFAULT_REMINDER_RULES: NonNullable<NotificationPreferencePayload["reminderRules"]> = [
  { trigger: "before", amount: 7, unit: "days", enabled: true },
  { trigger: "before", amount: 1, unit: "days", enabled: true },
  { trigger: "at_time", amount: 0, unit: "days", enabled: true },
  { trigger: "approaching", amount: 0, unit: "days", enabled: true }
];

export const DEFAULT_CATEGORY_OPTIONS = [
  "academic_year_start",
  "academic_year_end",
  "fall_term_start",
  "fall_term_end",
  "spring_term_start",
  "spring_term_end",
  "course_registration",
  "course_renewal",
  "course_add_drop",
  "course_schedule",
  "midterm_exam",
  "final_exam",
  "makeup_exam",
  "single_course_exam",
  "department_exam_schedule",
  "graduation_application",
  "tuition_payment",
  "horizontal_transfer",
  "summer_school_registration",
  "summer_school_start",
  "summer_school_end",
  "holiday",
  "orientation",
  "custom_event",
  "announcement",
  "faculty_announcement",
  "department_announcement",
  "yok_event"
];

export const CATEGORY_LABELS: Record<string, string> = {
  academic_year_start: "Akademik yıl başlangıcı",
  academic_year_end: "Akademik yıl bitişi",
  fall_term_start: "Güz dönemi başlangıcı",
  fall_term_end: "Güz dönemi bitişi",
  spring_term_start: "Bahar dönemi başlangıcı",
  spring_term_end: "Bahar dönemi bitişi",
  course_registration: "Ders kaydı",
  course_renewal: "Kayıt yenileme",
  course_add_drop: "Ekle-sil",
  course_schedule: "Ders programı",
  midterm_exam: "Ara sınav",
  final_exam: "Final sınavı",
  makeup_exam: "Bütünleme sınavı",
  single_course_exam: "Tek ders sınavı",
  department_exam_schedule: "Sınav programı",
  graduation_application: "Mezuniyet başvurusu",
  tuition_payment: "Harç ödemesi",
  horizontal_transfer: "Yatay geçiş",
  summer_school_registration: "Yaz okulu kaydı",
  summer_school_start: "Yaz okulu başlangıcı",
  summer_school_end: "Yaz okulu bitişi",
  holiday: "Tatil",
  orientation: "Oryantasyon",
  custom_event: "Özel etkinlik",
  announcement: "Üniversite duyuruları",
  faculty_announcement: "Fakülte duyuruları",
  department_announcement: "Bölüm duyuruları",
  yok_event: "YÖK duyuru ve etkinlikleri"
};

export const ROLE_LABELS: Record<string, string> = {
  student: "Öğrenci",
  content_editor: "İçerik Editörü",
  university_admin: "Üniversite Yöneticisi",
  super_admin: "Süper Yönetici"
};

export const STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  published: "Yayında",
  archived: "Arşivlendi",
  active: "Aktif",
  inactive: "Pasif",
  locked: "Kilitli"
};

export const UNIVERSITY_TYPE_LABELS: Record<string, string> = {
  state: "Devlet",
  foundation: "Vakıf",
  private: "Özel"
};

export const PRODUCTION_API_BASE_URL = "https://academic-api.anssoft.com.tr";

export const API_REQUEST_TIMEOUT_MS = 15_000;

export function normalizeBaseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const parsed = new URL(candidate);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function resolveApiBaseUrl(): string {
  const fromEnv = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL ?? "");
  if (fromEnv) return fromEnv;

  const useLocalDevApi = process.env.EXPO_PUBLIC_USE_LOCAL_API === "1";
  if (!__DEV__ || !useLocalDevApi) return PRODUCTION_API_BASE_URL;

  const scriptUrl =
    typeof NativeModules?.SourceCode?.scriptURL === "string"
      ? (NativeModules.SourceCode.scriptURL as string)
      : undefined;

  if (scriptUrl) {
    try {
      const host = new URL(scriptUrl).hostname;
      if (host) return `http://${host}:3000`;
    } catch {
      // Ignore malformed dev script URL and continue with platform defaults.
    }
  }

  if (Platform.OS === "android") return "http://10.0.2.2:3000";
  return "http://localhost:3000";
}
