import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";
import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  statusCodes
} from "@react-native-google-signin/google-signin";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Linking,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GoogleCalendarService,
  GoogleCalendarSyncError,
  type GoogleCalendarSyncResult
} from "./src/google-calendar/google-calendar-sync";
import {
  AUTH_ENDPOINTS,
  AUTH_PASSWORD_MIN_LENGTH,
  PASSWORD_RECOVERY_CODE_LENGTH,
  PENDING_VERIFICATION_STORAGE_KEY,
  createPendingPasswordRecoveryRecord,
  createPendingVerificationRecord,
  getPasswordRecoveryTiming,
  getVerificationTiming,
  isValidPasswordRecoveryEmail,
  parsePendingVerificationRecord,
  rootSurfaceForHydration,
  validatePasswordRecoveryConfirmation,
  validatePasswordRecoveryRequest,
  type HydrationStatus,
  type PendingPasswordRecoveryRecord,
  type PendingVerificationRecord
} from "./src/auth/auth-recovery";
import {
  AccountGenerationGuard,
  classifyAuthError,
  runObservableAccountCleanup,
  type AccountCleanupResult,
  type AccountCleanupTarget,
  type AccountGenerationSnapshot,
  type AuthOperation
} from "./src/auth/session-integrity";
import {
  LEGACY_MANUAL_EXAMS_STORAGE_KEY,
  createManualExamStorageKey,
  planLegacyManualExamMigration,
  readManualExamEnvelope,
  serializeManualExamEnvelope,
  type ManualExamRecord
} from "./src/session-integrity/manual-exam-storage";

type AuthMode = "login" | "register";
type AlarmMode = "all_calendar" | "selected_fields";
type TabId = "profile" | "announcements" | "home" | "calendar" | "summer" | "yok";
type AcademicSelectionLevel = "university" | "faculty" | "department";
type AnnouncementContentType = "announcement" | "news" | "event";
type AnnouncementContentFilter = "all" | AnnouncementContentType;
type AnnouncementScopeType = "university" | "faculty" | "department";
type AuthStage =
  | "auth"
  | "verify"
  | "profile_confirm"
  | "password_recovery_request"
  | "password_recovery_confirm";

type SessionPayload = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    fullName: string;
    email: string;
    role: string;
  };
};

type RegisterResponse = {
  status: "verification_required";
  email: string;
  verificationExpiresAt: string;
  resendAvailableAt?: string;
  previewVerificationToken?: string;
};

type PasswordRecoveryRequestResponse = {
  status: "recovery_requested";
  message: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  previewRecoveryCode?: string;
};

type PasswordRecoveryConfirmResponse = {
  status: "password_reset";
};

type UserProfile = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  status: "active" | "inactive" | "locked";
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
};

type UniversityRecord = {
  id: string;
  name: string;
  city: string;
  type: string;
};

type FacultyRecord = {
  id: string;
  name: string;
};

type DepartmentRecord = {
  id: string;
  name: string;
};

type AnnouncementRecord = {
  id: string;
  sourceId: string;
  sourceName: string;
  contentType?: AnnouncementContentType;
  scopeType: AnnouncementScopeType;
  scopeId: string;
  title: string;
  link: string;
  publishedAt?: string;
  fetchedAt?: string;
  summary?: string;
};

type CalendarRecord = {
  id: string;
  title: string;
  academicYear: string;
  status: string;
};

type EventRecord = {
  id: string;
  title: string;
  category: string;
  startDate: string;
  endDate?: string;
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
};

type CalendarPayload = {
  calendar: CalendarRecord;
  events: EventRecord[];
};

type GoogleCalendarConnectionRecord = {
  ownerId: string;
  accountEmail: string;
  lastSyncedAt: string;
  result: GoogleCalendarSyncResult;
  warnings?: string[];
};

type SummerSchoolPayload = {
  profile: {
    universityId: string;
    universityName?: string;
    facultyId?: string;
    facultyName?: string;
    departmentId?: string;
    departmentName?: string;
  };
  requirements: Array<{
    message: string;
    date?: string;
    sourceUrl?: string;
    eventId?: string;
  }>;
  ownAnnouncements: AnnouncementRecord[];
  sameDepartmentAnnouncements: AnnouncementRecord[];
  sameDepartmentOptions: Array<{
    universityId: string;
    universityName: string;
    academicYear: string;
    sourceUrl?: string;
    events: EventRecord[];
    matchingDepartments?: Array<{
      facultyId: string;
      facultyName: string;
      departmentId: string;
      departmentName: string;
      educationLevel: string;
    }>;
  }>;
  generatedAt: string;
};

type NotificationPreferencePayload = {
  enabled: boolean;
  categories: Record<string, boolean>;
  reminderOffsets: number[];
  reminderRules?: Array<{
    trigger: "before" | "at_time" | "approaching";
    amount: number;
    unit: "days" | "hours";
    enabled: boolean;
  }>;
  quietHours?: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: "Europe/Istanbul";
  };
};

type Loadable<T> = {
  loading: boolean;
  data?: T;
  error?: string;
};

const SESSION_STORAGE_KEY = "native_session";
const SESSION_INVALIDATED_STORAGE_VALUE = "native_session_invalidated_v1";
const DEVICE_ID_STORAGE_KEY = "native_device_id";
const LEGACY_GOOGLE_CALENDAR_STORAGE_KEY = "native_google_calendar_connection";
const GOOGLE_CALENDAR_STORAGE_PREFIX = "native_google_calendar_connection_v2";
const DEFAULT_REMINDER_OFFSETS = [7, 1, 0];
const DEFAULT_REMINDER_RULES: NonNullable<NotificationPreferencePayload["reminderRules"]> = [
  { trigger: "before", amount: 7, unit: "days", enabled: true },
  { trigger: "before", amount: 1, unit: "days", enabled: true },
  { trigger: "at_time", amount: 0, unit: "days", enabled: true },
  { trigger: "approaching", amount: 0, unit: "days", enabled: true }
];

const DEFAULT_CATEGORY_OPTIONS = [
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
  "custom_event"
];

const CATEGORY_LABELS: Record<string, string> = {
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
  custom_event: "Özel etkinlik"
};

const ROLE_LABELS: Record<string, string> = {
  student: "Öğrenci",
  content_editor: "İçerik Editörü",
  university_admin: "Üniversite Yöneticisi",
  super_admin: "Süper Yönetici"
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  published: "Yayında",
  archived: "Arşivlendi",
  active: "Aktif",
  inactive: "Pasif",
  locked: "Kilitli"
};

const UNIVERSITY_TYPE_LABELS: Record<string, string> = {
  state: "Devlet",
  foundation: "Vakıf",
  private: "Özel"
};

const PRODUCTION_API_BASE_URL = "https://academic-api.anssoft.com.tr";
const DEFAULT_GOOGLE_WEB_CLIENT_ID = "315186329318-911ks4c825vjrd5lpk608ugie7m8lujj.apps.googleusercontent.com";
const DEFAULT_GOOGLE_ANDROID_CLIENT_ID = "315186329318-mbbpc4rjd1ipirfnsl3vdetjfi8ir2ff.apps.googleusercontent.com";

const GOOGLE_EXPO_CLIENT_ID = cleanEnvValue(process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID);
const GOOGLE_WEB_CLIENT_ID = cleanEnvValue(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) ?? GOOGLE_EXPO_CLIENT_ID ?? DEFAULT_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = cleanEnvValue(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
const GOOGLE_ANDROID_CLIENT_ID = cleanEnvValue(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID) ?? DEFAULT_GOOGLE_ANDROID_CLIENT_ID;
const GOOGLE_PLATFORM_CLIENT_ID = Platform.select({
  android: GOOGLE_ANDROID_CLIENT_ID,
  ios: GOOGLE_IOS_CLIENT_ID,
  default: GOOGLE_WEB_CLIENT_ID
});
const GOOGLE_AUTH_CONFIGURED = Boolean(GOOGLE_PLATFORM_CLIENT_ID);
const GOOGLE_AUTH_CONFIGURATION_MESSAGE = Platform.select({
  android: "Bu APK Google Android OAuth Client ID olmadan oluşturulmuş. Şimdilik e-posta ve şifre ile devam edebilirsin.",
  ios: "Bu iOS derlemesi Google iOS Client ID olmadan oluşturulmuş. Şimdilik e-posta ve şifre ile devam edebilirsin.",
  default: "Bu derleme Google Web Client ID olmadan oluşturulmuş. Şimdilik e-posta ve şifre ile devam edebilirsin."
}) ?? "Bu derleme Google Client ID olmadan oluşturulmuş. Şimdilik e-posta ve şifre ile devam edebilirsin.";
const GOOGLE_ID_TOKEN_CONFIGURATION_MESSAGE =
  "Google oturumu tamamlanamadı. Lütfen tekrar dene veya e-posta ile giriş yap.";
const AUTH_INPUT_PLACEHOLDER_COLOR = "#64748b";
const API_REQUEST_TIMEOUT_MS = 15_000;

function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

class StaleAccountRequestError extends Error {
  constructor() {
    super("Stale account request ignored.");
    this.name = "StaleAccountRequestError";
  }
}

type ApiErrorPayload = {
  errorCode?: string;
  message?: unknown;
  error?: unknown;
  resendAvailableAt?: string;
  details?: Record<string, unknown>;
};

function readApiErrorPayload(body: string): ApiErrorPayload {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const payload = parsed as Record<string, unknown>;
    const details = payload.details && typeof payload.details === "object" && !Array.isArray(payload.details)
      ? payload.details as Record<string, unknown>
      : undefined;
    return {
      ...(typeof payload.errorCode === "string" ? { errorCode: payload.errorCode } : {}),
      ...(typeof payload.message === "string" || Array.isArray(payload.message) ? { message: payload.message } : {}),
      ...(typeof payload.error === "string" ? { error: payload.error } : {}),
      ...(typeof payload.resendAvailableAt === "string" ? { resendAvailableAt: payload.resendAvailableAt } : {}),
      ...(details ? { details } : {})
    };
  } catch {
    return {};
  }
}

function parseApiErrorMessage(body: string, fallback: string, status?: number): string {
  const trimmed = body.trim();
  if (!trimmed) return toUserFacingErrorMessage(fallback, status);

  try {
    const payload = JSON.parse(trimmed) as { message?: unknown; error?: unknown };
    if (Array.isArray(payload.message)) return toUserFacingErrorMessage(payload.message.map(String).join(" "), status);
    if (typeof payload.message === "string" && payload.message.trim()) return toUserFacingErrorMessage(payload.message.trim(), status);
    if (typeof payload.error === "string" && payload.error.trim()) return toUserFacingErrorMessage(payload.error.trim(), status);
  } catch {
    // Never surface an untrusted raw response body.
  }

  return toUserFacingErrorMessage(fallback, status);
}

function toUserFacingErrorMessage(message: string, status?: number): string {
  const normalized = message.toLocaleLowerCase("tr-TR");

  if (status === 0 || normalized.includes("network request failed") || normalized.includes("failed to fetch")) {
    return "Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.";
  }
  if (status === 401 || normalized.includes("unauthorized") || normalized.includes("token") || normalized.includes("jwt")) {
    return "Oturum süren dolmuş olabilir. Lütfen tekrar giriş yap.";
  }
  if (status === 403 || normalized.includes("forbidden")) {
    return "Bu işlem için yetkin yok.";
  }
  if (status === 404 || normalized.includes("not found")) {
    return "İstenen bilgi bulunamadı.";
  }
  if (status === 429 || normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Çok sık denedin. Biraz bekleyip tekrar dene.";
  }
  if (status && status >= 500) {
    return "Şu anda işlem tamamlanamadı. Biraz sonra tekrar dene.";
  }
  if (normalized.includes("user must select a university")) {
    return "Devam etmek için önce Profil sekmesinden üniversiteni seçmelisin.";
  }
  if (normalized.includes("invalid") && normalized.includes("google")) {
    return "Google oturumu doğrulanamadı. Lütfen tekrar dene.";
  }
  if (
    normalized.includes("react-native-google-signin")
    || normalized.includes("developer_error")
    || normalized.includes("api_exception: 10")
    || normalized.includes("status code: 10")
    || normalized.includes("troubleshooting")
  ) {
    return "Bu APK için Google giriş ayarları tamamlanmamış görünüyor. Lütfen uygulamanın güncel sürümünü kullan veya e-posta ile giriş yap.";
  }
  if (normalized.startsWith("{") || normalized.includes("statuscode") || normalized.includes("exception")) {
    return "İşlem tamamlanamadı. Bilgileri kontrol edip tekrar dene.";
  }

  return "İşlem tamamlanamadı. Lütfen tekrar dene.";
}

function userMessageFromError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return toUserFacingErrorMessage(error.message);
  if (typeof error === "string") return toUserFacingErrorMessage(error);
  return fallback;
}

function googleCalendarUserMessage(error: unknown): string {
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

async function clearGoogleAccountSelection(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // No cached account to clear.
  }
}

function normalizeBaseUrl(input: string): string | null {
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

function resolveApiBaseUrl(): string {
  const fromEnv = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL ?? "");
  if (fromEnv) return fromEnv;

  if (!__DEV__) return PRODUCTION_API_BASE_URL;

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

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
}

function formatRemainingDuration(targetIsoDate: string): string {
  const target = Date.parse(targetIsoDate);
  if (Number.isNaN(target)) return "tarih hatalı";

  const deltaMs = target - Date.now();
  if (deltaMs <= 0) return "bugün";

  const totalHours = Math.floor(deltaMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days === 0) return `${hours} sa kaldı`;
  return `${days} gün ${hours} sa kaldı`;
}

function toCategoryLabel(category: string): string {
  if (CATEGORY_LABELS[category]) return CATEGORY_LABELS[category];
  return category.split("_").join(" ");
}

function isUniversityAcademicCalendarEvent(event: EventRecord): boolean {
  if (event.facultyId || event.departmentId) return false;
  return event.category !== "course_schedule" && event.category !== "department_exam_schedule";
}

const ANNOUNCEMENT_CONTENT_ORDER: AnnouncementContentType[] = ["announcement", "news", "event"];
const ANNOUNCEMENT_SCOPE_ORDER: AnnouncementScopeType[] = ["university", "faculty", "department"];
const ANNOUNCEMENT_CONTENT_LABELS: Record<AnnouncementContentType, string> = {
  announcement: "Duyurular",
  news: "Haberler",
  event: "Etkinlikler"
};
const ANNOUNCEMENT_SCOPE_LABELS: Record<AnnouncementScopeType, string> = {
  university: "Üniversite",
  faculty: "Fakülte",
  department: "Bölüm"
};
const ANNOUNCEMENT_OPEN_LABELS: Record<AnnouncementContentType, string> = {
  announcement: "Duyuruyu Aç",
  news: "Haberi Aç",
  event: "Etkinliği Aç"
};
const ANNOUNCEMENT_FILTER_OPTIONS: Array<{
  value: AnnouncementContentFilter;
  label: string;
  icon: "apps-outline" | "megaphone-outline" | "newspaper-outline" | "calendar-outline";
}> = [
  { value: "all", label: "Tümü", icon: "apps-outline" },
  { value: "announcement", label: "Duyurular", icon: "megaphone-outline" },
  { value: "news", label: "Haberler", icon: "newspaper-outline" },
  { value: "event", label: "Etkinlikler", icon: "calendar-outline" }
];

type AnnouncementSection = {
  key: string;
  title: string;
  items: AnnouncementRecord[];
};

function normalizeAnnouncementContentType(item: AnnouncementRecord): AnnouncementContentType {
  return item.contentType === "news" || item.contentType === "event" ? item.contentType : "announcement";
}

function normalizeAnnouncementScopeType(item: AnnouncementRecord): AnnouncementScopeType {
  return item.scopeType === "faculty" || item.scopeType === "department" ? item.scopeType : "university";
}

function groupAnnouncementsForDisplay(items: AnnouncementRecord[]): AnnouncementSection[] {
  const sections: AnnouncementSection[] = [];
  for (const contentType of ANNOUNCEMENT_CONTENT_ORDER) {
    for (const scopeType of ANNOUNCEMENT_SCOPE_ORDER) {
      const scopedItems = items.filter((item) => normalizeAnnouncementContentType(item) === contentType && normalizeAnnouncementScopeType(item) === scopeType);
      if (scopedItems.length === 0) continue;
      sections.push({
        key: `${scopeType}-${contentType}`,
        title: `${ANNOUNCEMENT_SCOPE_LABELS[scopeType]} ${ANNOUNCEMENT_CONTENT_LABELS[contentType]}`,
        items: scopedItems
      });
    }
  }
  return sections;
}

function announcementOpenLabel(item: AnnouncementRecord): string {
  return ANNOUNCEMENT_OPEN_LABELS[normalizeAnnouncementContentType(item)];
}

function formatDateShort(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
}

function formatDateTimeShort(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function cleanupTargetLabel(target: AccountCleanupTarget): string {
  const labels: Record<AccountCleanupTarget, string> = {
    server_session: "sunucu oturumu",
    server_account: "sunucudaki hesap silme işlemi",
    session_storage: "cihaz oturumu",
    pending_verification_storage: "doğrulama kurtarma kaydı",
    manual_exam_storage: "kişisel sınav kaydı",
    google_connection_storage: "Google Takvim bağlantı kaydı",
    google_sign_in: "Google hesap seçimi",
    in_memory_state: "ekrandaki hesap verileri"
  };
  return labels[target];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function getWebStorage(): Storage | null {
  if (typeof globalThis === "undefined") return null;
  if (typeof globalThis.localStorage === "undefined") return null;
  return globalThis.localStorage;
}

async function getStoredValue(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return getWebStorage()?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

function createGoogleCalendarStorageKey(ownerId: string): string {
  const normalized = ownerId.trim();
  if (!normalized) throw new Error("A Google Calendar connection owner is required.");
  const encoded = Array.from(normalized, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("_");
  return `${GOOGLE_CALENDAR_STORAGE_PREFIX}_${encoded}`;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SessionPayload>;
  return typeof candidate.accessToken === "string"
    && Boolean(candidate.accessToken)
    && typeof candidate.refreshToken === "string"
    && Boolean(candidate.refreshToken)
    && typeof candidate.expiresInSeconds === "number"
    && Boolean(candidate.user)
    && typeof candidate.user?.id === "string"
    && Boolean(candidate.user.id)
    && typeof candidate.user?.email === "string"
    && typeof candidate.user?.fullName === "string"
    && typeof candidate.user?.role === "string";
}

async function setStoredValue(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    const storage = getWebStorage();
    if (!storage) throw new Error("Web storage is unavailable.");
    storage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteStoredValue(key: string): Promise<void> {
  if (Platform.OS === "web") {
    const storage = getWebStorage();
    if (!storage) throw new Error("Web storage is unavailable.");
    storage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authStage, setAuthStage] = useState<AuthStage>("auth");
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const apiBaseUrl = useMemo(() => resolveApiBaseUrl(), []);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [verificationToken, setVerificationToken] = useState("");
  const [pendingVerification, setPendingVerification] = useState<PendingVerificationRecord | null>(null);
  const [verificationClockMs, setVerificationClockMs] = useState(Date.now());
  const [passwordRecoveryCode, setPasswordRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const [passwordConfirmationVisible, setPasswordConfirmationVisible] = useState(false);
  const [pendingPasswordRecovery, setPendingPasswordRecovery] = useState<PendingPasswordRecoveryRecord | null>(null);
  const [passwordRecoveryClockMs, setPasswordRecoveryClockMs] = useState(Date.now());
  const [passwordRecoveryFeedback, setPasswordRecoveryFeedback] = useState<{
    text: string;
    tone: "info" | "success" | "error";
  } | null>(null);
  const [hydrationStatus, setHydrationStatus] = useState<HydrationStatus>("loading");
  const [hydrationError, setHydrationError] = useState<string | null>(null);

  const [registerUniversityId, setRegisterUniversityId] = useState("");
  const [registerFacultyId, setRegisterFacultyId] = useState("");
  const [registerDepartmentId, setRegisterDepartmentId] = useState("");
  const [registerPicker, setRegisterPicker] = useState<"none" | "university" | "faculty" | "department">("none");
  const [universitySearch, setUniversitySearch] = useState("");
  const [facultySearch, setFacultySearch] = useState("");
  const [departmentSearch, setDepartmentSearch] = useState("");
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [deviceId, setDeviceId] = useState("");

  const [universities, setUniversities] = useState<Loadable<UniversityRecord[]>>({ loading: false });
  const [faculties, setFaculties] = useState<Loadable<FacultyRecord[]>>({ loading: false });
  const [departments, setDepartments] = useState<Loadable<DepartmentRecord[]>>({ loading: false });
  const [calendar, setCalendar] = useState<Loadable<CalendarPayload>>({ loading: false });
  const [upcoming, setUpcoming] = useState<Loadable<EventRecord[]>>({ loading: false });
  const [announcements, setAnnouncements] = useState<Loadable<AnnouncementRecord[]>>({ loading: false });
  const [yokAnnouncements, setYokAnnouncements] = useState<Loadable<AnnouncementRecord[]>>({ loading: false });
  const [summerSchool, setSummerSchool] = useState<Loadable<SummerSchoolPayload>>({ loading: false });
  const [preferences, setPreferences] = useState<Loadable<NotificationPreferencePayload>>({ loading: false });
  const [manualExams, setManualExams] = useState<ManualExamRecord[]>([]);
  const [manualExamOwnerId, setManualExamOwnerId] = useState<string | null>(null);
  const [manualExamsHydrated, setManualExamsHydrated] = useState(false);
  const [manualExamTitle, setManualExamTitle] = useState("");
  const [manualExamDate, setManualExamDate] = useState("");

  const [selectedUniversityId, setSelectedUniversityId] = useState("");
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [alarmMode, setAlarmMode] = useState<AlarmMode>("all_calendar");
  const [categoryDraft, setCategoryDraft] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [academicSelectionPending, setAcademicSelectionPending] = useState<AcademicSelectionLevel | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "success" | "error" } | null>(null);
  const [googleCalendarBusy, setGoogleCalendarBusy] = useState(false);
  const [googleCalendarIntegration, setGoogleCalendarIntegration] = useState<GoogleCalendarConnectionRecord | null>(null);
  const [googleCalendarError, setGoogleCalendarError] = useState<string | null>(null);
  const [academicProfileExpanded, setAcademicProfileExpanded] = useState(false);
  const [alarmCategoriesExpanded, setAlarmCategoriesExpanded] = useState(false);
  const [announcementContentFilter, setAnnouncementContentFilter] = useState<AnnouncementContentFilter>("all");
  const [cleanupIssue, setCleanupIssue] = useState<{
    action: "logout" | "session_expiry" | "data_deletion" | "account_deletion" | "verification_save" | "verification_clear" | "activation" | "manual_exam_save";
    failedTargets: AccountCleanupTarget[];
    ownerId?: string;
  } | null>(null);
  const sessionRef = useRef<SessionPayload | null>(null);
  const deviceIdRef = useRef("");
  const refreshSessionPromiseRef = useRef<Promise<SessionPayload | null> | null>(null);
  const academicSelectionPendingRef = useRef<AcademicSelectionLevel | null>(null);
  const accountGuardRef = useRef(new AccountGenerationGuard());
  const authenticatedRequestControllersRef = useRef(new Set<AbortController>());
  const storageMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const googleSdkQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeAuthenticatedMutationsRef = useRef(new Set<Promise<unknown>>());
  const googleSdkEpochRef = useRef(0);
  const accountCleanupInProgressRef = useRef(false);
  const authOperationInProgressRef = useRef(false);
  const activationAttemptRef = useRef(0);
  const hydrationInProgressRef = useRef(false);

  const accessToken = session?.accessToken;
  const googleCalendarService = useMemo(() => new GoogleCalendarService(), []);
  const availableCategories = useMemo(() => {
    const keys = new Set<string>(DEFAULT_CATEGORY_OPTIONS);
    for (const event of calendar.data?.events ?? []) keys.add(event.category);
    for (const category of Object.keys(preferences.data?.categories ?? {})) keys.add(category);
    return [...keys];
  }, [calendar.data?.events, preferences.data?.categories]);
  const examCountdownItems = useMemo(() => {
    const examCategories = new Set(["midterm_exam", "final_exam", "makeup_exam", "single_course_exam"]);
    const calendarExams = (calendar.data?.events ?? [])
      .filter((event) => examCategories.has(event.category))
      .map((event) => ({
        id: event.id,
        title: event.title,
        examDate: event.startDate,
        source: "calendar" as const
      }));

    const visibleManualExams = session?.user.id === manualExamOwnerId && manualExamsHydrated
      ? manualExams
      : [];
    const extraExams = visibleManualExams.map((exam) => ({
      id: exam.id,
      title: exam.title,
      examDate: exam.examDate,
      source: "manual" as const
    }));

    return [...calendarExams, ...extraExams]
      .filter((exam) => !Number.isNaN(Date.parse(exam.examDate)))
      .filter((exam) => Date.parse(exam.examDate) >= Date.now())
      .sort((left, right) => Date.parse(left.examDate) - Date.parse(right.examDate));
  }, [calendar.data?.events, manualExams, manualExamOwnerId, manualExamsHydrated, session?.user.id]);
  const announcementFeed = useMemo(
    () => announcements.data ?? [],
    [announcements.data]
  );
  const announcementContentCounts = useMemo(() => ({
    all: announcementFeed.length,
    announcement: announcementFeed.filter((item) => normalizeAnnouncementContentType(item) === "announcement").length,
    news: announcementFeed.filter((item) => normalizeAnnouncementContentType(item) === "news").length,
    event: announcementFeed.filter((item) => normalizeAnnouncementContentType(item) === "event").length
  }), [announcementFeed]);
  const filteredAnnouncementFeed = useMemo(
    () => announcementContentFilter === "all"
      ? announcementFeed
      : announcementFeed.filter((item) => normalizeAnnouncementContentType(item) === announcementContentFilter),
    [announcementContentFilter, announcementFeed]
  );
  const announcementSections = useMemo(
    () => groupAnnouncementsForDisplay(filteredAnnouncementFeed),
    [filteredAnnouncementFeed]
  );
  const yokAnnouncementItems = useMemo(
    () => yokAnnouncements.data ?? [],
    [yokAnnouncements.data]
  );
  const summerSchoolEvents = useMemo(
    () => (calendar.data?.events ?? []).filter((event) => event.category.startsWith("summer_school")),
    [calendar.data?.events]
  );
  const summerSchoolAnnouncements = useMemo(
    () => [
      ...(summerSchool.data?.ownAnnouncements ?? []),
      ...(summerSchool.data?.sameDepartmentAnnouncements ?? [])
    ],
    [summerSchool.data]
  );
  const nextUpcomingEvent = useMemo(() => {
    return (upcoming.data ?? [])
      .filter((event) => !Number.isNaN(Date.parse(event.startDate)))
      .filter((event) => Date.parse(event.startDate) >= Date.now())
      .sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate))[0];
  }, [upcoming.data]);
  const todayEventCount = useMemo(() => {
    const today = new Date();
    return (calendar.data?.events ?? []).filter((event) => {
      const eventDate = new Date(event.startDate);
      return (
        !Number.isNaN(eventDate.getTime()) &&
        eventDate.getFullYear() === today.getFullYear() &&
        eventDate.getMonth() === today.getMonth() &&
        eventDate.getDate() === today.getDate()
      );
    }).length;
  }, [calendar.data?.events]);
  const nextExam = examCountdownItems[0];

  const selectedUniversity = useMemo(
    () => (universities.data ?? []).find((item) => item.id === registerUniversityId),
    [universities.data, registerUniversityId]
  );

  const selectedFaculty = useMemo(
    () => (faculties.data ?? []).find((item) => item.id === registerFacultyId),
    [faculties.data, registerFacultyId]
  );

  const selectedDepartment = useMemo(
    () => (departments.data ?? []).find((item) => item.id === registerDepartmentId),
    [departments.data, registerDepartmentId]
  );

  const filteredUniversities = useMemo(() => {
    const query = universitySearch.trim().toLocaleLowerCase("tr-TR");
    const list = universities.data ?? [];
    if (!query) return list.slice(0, 30);

    return list
      .filter((item) => `${item.name} ${item.city}`.toLocaleLowerCase("tr-TR").includes(query))
      .slice(0, 30);
  }, [universities.data, universitySearch]);

  const filteredFaculties = useMemo(() => {
    const query = facultySearch.trim().toLocaleLowerCase("tr-TR");
    const list = faculties.data ?? [];
    if (!query) return list;

    return list.filter((item) => item.name.toLocaleLowerCase("tr-TR").includes(query));
  }, [faculties.data, facultySearch]);

  const filteredDepartments = useMemo(() => {
    const query = departmentSearch.trim().toLocaleLowerCase("tr-TR");
    const list = departments.data ?? [];
    if (!query) return list;

    return list.filter((item) => item.name.toLocaleLowerCase("tr-TR").includes(query));
  }, [departments.data, departmentSearch]);

  const registerIdentityReady = Boolean(
    fullName.trim()
    && email.trim()
    && password.length >= AUTH_PASSWORD_MIN_LENGTH
  );
  const loginReady = Boolean(email.trim() && password.length > 0);
  const verificationTiming = pendingVerification
    ? getVerificationTiming(pendingVerification, verificationClockMs)
    : null;
  const passwordRecoveryTiming = pendingPasswordRecovery
    ? getPasswordRecoveryTiming(pendingPasswordRecovery, passwordRecoveryClockMs)
    : null;
  const passwordRecoveryRequestReady = isValidPasswordRecoveryEmail(email);
  const passwordRecoveryConfirmationValidation = validatePasswordRecoveryConfirmation({
    code: passwordRecoveryCode,
    newPassword,
    passwordConfirmation
  });
  const passwordRecoveryConfirmReady = passwordRecoveryConfirmationValidation.valid
    && !passwordRecoveryTiming?.expired;
  const rootSurface = rootSurfaceForHydration(hydrationStatus, Boolean(session));

  useEffect(() => {
    void hydrateApplication();
  }, []);

  useEffect(() => {
    if (!manualExamsHydrated || !manualExamOwnerId || session?.user.id !== manualExamOwnerId) return;
    const snapshot = accountGuardRef.current.capture();
    if (!snapshot || snapshot.ownerId !== manualExamOwnerId) return;

    void enqueueStorageMutation(async () => {
      if (!accountGuardRef.current.isCurrent(snapshot)) return;
      await setStoredValue(
        createManualExamStorageKey(manualExamOwnerId),
        serializeManualExamEnvelope(manualExamOwnerId, manualExams)
      );
    }).catch(() => {
      if (!accountGuardRef.current.isCurrent(snapshot)) return;
      setCleanupIssue({
        action: "manual_exam_save",
        failedTargets: ["manual_exam_storage"],
        ownerId: manualExamOwnerId
      });
      setMessage({ text: "Sınavlar cihazda saklanamadı. Lütfen tekrar dene.", tone: "error" });
    });
  }, [manualExams, manualExamsHydrated, manualExamOwnerId, session?.user.id]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (authStage !== "verify" || !pendingVerification) return;
    setVerificationClockMs(Date.now());
    const timer = setInterval(() => setVerificationClockMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [authStage, pendingVerification?.email, pendingVerification?.verificationExpiresAt, pendingVerification?.resendAvailableAt]);

  useEffect(() => {
    if (!authStage.startsWith("password_recovery") || !pendingPasswordRecovery) return;
    setPasswordRecoveryClockMs(Date.now());
    const timer = setInterval(() => setPasswordRecoveryClockMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [
    authStage,
    pendingPasswordRecovery?.email,
    pendingPasswordRecovery?.recoveryExpiresAt,
    pendingPasswordRecovery?.resendAvailableAt
  ]);

  useEffect(() => {
    if (authStage !== "password_recovery_request" && authStage !== "password_recovery_confirm") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (busy) return true;
      if (authStage === "password_recovery_confirm") returnToPasswordRecoveryRequest();
      else cancelPasswordRecovery();
      return true;
    });
    return () => subscription.remove();
  }, [authStage, busy]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!GOOGLE_AUTH_CONFIGURED) return;

    GoogleSignin.configure({
      scopes: ["email", "profile"],
      ...(GOOGLE_WEB_CLIENT_ID ? { webClientId: GOOGLE_WEB_CLIENT_ID } : {}),
      ...(GOOGLE_IOS_CLIENT_ID ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {})
    });
  }, []);

  useEffect(() => {
    if (!preferences.data) return;

    const draft: Record<string, boolean> = {};
    for (const category of availableCategories) {
      draft[category] = preferences.data.categories[category] !== false;
    }

    const allEnabled = availableCategories.every((category) => draft[category] !== false);
    setCategoryDraft(draft);
    setAlarmEnabled(preferences.data.enabled);
    setAlarmMode(allEnabled ? "all_calendar" : "selected_fields");
  }, [preferences.data, availableCategories]);

  useEffect(() => {
    if (!registerUniversityId) return;
    void loadFacultiesForRegistration(registerUniversityId);
  }, [registerUniversityId]);

  useEffect(() => {
    if (!registerFacultyId) return;
    void loadDepartmentsForRegistration(registerFacultyId);
  }, [registerFacultyId]);

  useEffect(() => {
    if (!session) return;

    if (activeTab === "yok" && !yokAnnouncements.loading && !yokAnnouncements.data) {
      void loadYokAnnouncements();
    }

    if (activeTab === "summer" && registerUniversityId && !summerSchool.loading && !summerSchool.data) {
      void loadSummerSchool();
    }
  }, [activeTab, session?.user.id, registerUniversityId]);

  useEffect(() => {
    if (authMode !== "register" || authStage !== "auth") return;

    if (!(universities.data?.length) && !universities.loading) {
      void loadUniversities();
    }
  }, [authMode, authStage, universities.data?.length, universities.loading]);

  async function hydrateApplication(): Promise<void> {
    if (hydrationInProgressRef.current) return;
    hydrationInProgressRef.current = true;
    setHydrationStatus("loading");
    setHydrationError(null);
    setCleanupIssue(null);
    try {
      await restoreDeviceId();
      let restoredSession = await restoreSession();
      const recoverableTargets: AccountCleanupTarget[] = [];

      if (restoredSession) {
        const storedSession = restoredSession;
        const snapshot = accountGuardRef.current.activate(storedSession.user.id);
        try {
          const refreshedSession = await apiRequest<SessionPayload>(
            "/auth/refresh-token",
            {
              method: "POST",
              body: JSON.stringify({
                refreshToken: storedSession.refreshToken,
                deviceId: deviceIdRef.current
              })
            },
            undefined,
            {
              skipAuthRefresh: true,
              authOperation: "refresh_session",
              ownerSnapshot: snapshot
            }
          );
          if (refreshedSession.user.id !== storedSession.user.id) {
            await persistSession(null);
            accountGuardRef.current.invalidate();
            clearAuthenticatedMemory();
            restoredSession = null;
            setMessage({ text: "Kayıtlı oturum bu hesapla eşleşmedi. Lütfen tekrar giriş yap.", tone: "error" });
          } else {
            await persistSession(refreshedSession);
            sessionRef.current = refreshedSession;
            setSession(refreshedSession);
            restoredSession = refreshedSession;
          }
        } catch (error) {
          if (
            error instanceof ApiRequestError
            && (error.code === "session_expired" || error.code === "disabled_account")
          ) {
            await persistSession(null);
            accountGuardRef.current.invalidate();
            clearAuthenticatedMemory();
            restoredSession = null;
            setMessage({ text: error.message, tone: "info" });
          } else {
            throw error;
          }
        }
      }

      if (restoredSession) {
        const snapshot = accountGuardRef.current.capture();
        if (!snapshot) throw new StaleAccountRequestError();
        try {
          await restoreManualExams(restoredSession.user.id, snapshot);
        } catch (error) {
          if (error instanceof StaleAccountRequestError) throw error;
          setManualExams([]);
          setManualExamOwnerId(null);
          setManualExamsHydrated(false);
          recoverableTargets.push("manual_exam_storage");
        }
        try {
          await restoreGoogleCalendarConnection(restoredSession.user.id, snapshot);
        } catch (error) {
          if (error instanceof StaleAccountRequestError) throw error;
          setGoogleCalendarIntegration(null);
          recoverableTargets.push("google_connection_storage");
        }
        try {
          await clearPendingVerification();
        } catch {
          recoverableTargets.push("pending_verification_storage");
        }
      } else {
        accountGuardRef.current.invalidate();
        setManualExams([]);
        setManualExamOwnerId(null);
        setManualExamsHydrated(false);
        try {
          await restoreGoogleCalendarConnection();
        } catch {
          setGoogleCalendarIntegration(null);
          recoverableTargets.push("google_connection_storage");
        }
        try {
          await restorePendingVerification();
        } catch {
          setPendingVerification(null);
          setPassword("");
          setVerificationToken("");
          setAuthMode("login");
          setAuthStage("auth");
          recoverableTargets.push("pending_verification_storage");
        }
      }

      if (recoverableTargets.length > 0) {
        setCleanupIssue({
          action: "activation",
          failedTargets: [...new Set(recoverableTargets)],
          ...(restoredSession ? { ownerId: restoredSession.user.id } : {})
        });
      }

      await loadUniversities();
      if (restoredSession) {
        const snapshot = accountGuardRef.current.capture();
        if (snapshot) await bootstrapAuthenticatedContext(restoredSession.accessToken, snapshot);
      }
      setHydrationStatus("ready");
    } catch {
      abortAuthenticatedRequests();
      accountGuardRef.current.invalidate();
      sessionRef.current = null;
      setSession(null);
      setManualExams([]);
      setManualExamOwnerId(null);
      setManualExamsHydrated(false);
      setHydrationError("Cihazdaki oturum bilgileri güvenli biçimde okunamadı. Tekrar deneyebilirsin.");
      setHydrationStatus("error");
    } finally {
      hydrationInProgressRef.current = false;
    }
  }

  async function restoreSession(): Promise<SessionPayload | null> {
    const stored = await getStoredValue(SESSION_STORAGE_KEY);
    if (!stored) return null;
    if (stored === SESSION_INVALIDATED_STORAGE_VALUE) {
      await deleteStoredValue(SESSION_STORAGE_KEY).catch(() => undefined);
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      await deleteStoredValue(SESSION_STORAGE_KEY);
      return null;
    }
    if (!isSessionPayload(parsed)) {
      await deleteStoredValue(SESSION_STORAGE_KEY);
      return null;
    }
    sessionRef.current = parsed;
    setSession(parsed);
    return parsed;
  }

  async function restoreDeviceId(): Promise<string> {
    const stored = await getStoredValue(DEVICE_ID_STORAGE_KEY);
    if (stored) {
      deviceIdRef.current = stored;
      setDeviceId(stored);
      return stored;
    }

    const created = createLocalId("rn-device");
    await setStoredValue(DEVICE_ID_STORAGE_KEY, created);
    deviceIdRef.current = created;
    setDeviceId(created);
    return created;
  }

  async function restorePendingVerification(): Promise<void> {
    const stored = await getStoredValue(PENDING_VERIFICATION_STORAGE_KEY);
    const restored = parsePendingVerificationRecord(stored);
    if (!restored) {
      if (stored) await deleteStoredValue(PENDING_VERIFICATION_STORAGE_KEY);
      return;
    }
    setPendingVerification(restored);
    setEmail(restored.email);
    setPassword("");
    setVerificationToken("");
    setAuthMode("login");
    setAuthStage("verify");
  }

  async function restoreManualExams(
    ownerId: string,
    ownerSnapshot?: AccountGenerationSnapshot | null
  ): Promise<void> {
    if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
    setManualExamsHydrated(false);
    const storageKey = createManualExamStorageKey(ownerId);
    const stored = await getStoredValue(storageKey);
    const result = readManualExamEnvelope(stored, ownerId);
    if (result.shouldDelete) await deleteStoredValue(storageKey);

    const legacyValue = await getStoredValue(LEGACY_MANUAL_EXAMS_STORAGE_KEY);
    const migration = planLegacyManualExamMigration({ legacyValue, currentOwnerId: ownerId });
    if (migration.status !== "no_data") {
      await deleteStoredValue(LEGACY_MANUAL_EXAMS_STORAGE_KEY);
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      setMessage({
        text: "Sahibi doğrulanamayan eski cihaz sınavları güvenlik için bu hesaba aktarılmadı.",
        tone: "info"
      });
    }

    if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
    setManualExams(result.status === "loaded" ? result.exams : []);
    setManualExamOwnerId(ownerId);
    setManualExamsHydrated(true);
  }

  async function restoreGoogleCalendarConnection(
    ownerId?: string,
    ownerSnapshot?: AccountGenerationSnapshot | null
  ): Promise<void> {
    if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
    setGoogleCalendarIntegration(null);
    const legacy = await getStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY);
    if (!ownerId) {
      if (legacy) await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY);
      return;
    }

    const storageKey = createGoogleCalendarStorageKey(ownerId);
    const stored = await getStoredValue(storageKey);
    const candidate = stored ?? legacy;
    if (!candidate) return;

    let parsed: GoogleCalendarConnectionRecord | null = null;
    try {
      parsed = JSON.parse(candidate) as GoogleCalendarConnectionRecord;
    } catch {
      parsed = null;
    }
    const valid = parsed
      && parsed.ownerId === ownerId
      && typeof parsed.accountEmail === "string"
      && typeof parsed.lastSyncedAt === "string"
      && typeof parsed.result?.verified === "number";
    if (!valid) {
      if (stored) await deleteStoredValue(storageKey);
      if (legacy) await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY);
      return;
    }

    if (!stored) await setStoredValue(storageKey, JSON.stringify(parsed));
    if (legacy) await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY);
    if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
    setGoogleCalendarIntegration(parsed);
  }

  function enqueueStorageMutation(action: () => Promise<void>): Promise<void> {
    const next = storageMutationQueueRef.current.catch(() => undefined).then(action);
    storageMutationQueueRef.current = next;
    return next;
  }

  function enqueueGoogleSdkOperation<T>(action: () => Promise<T>): Promise<T> {
    const next = googleSdkQueueRef.current.catch(() => undefined).then(action);
    googleSdkQueueRef.current = next.then(() => undefined, () => undefined);
    return next;
  }

  function trackAuthenticatedMutation<T>(action: () => Promise<T>): Promise<T> {
    if (accountCleanupInProgressRef.current) return Promise.reject(new StaleAccountRequestError());
    const operation = action();
    activeAuthenticatedMutationsRef.current.add(operation);
    const remove = () => activeAuthenticatedMutationsRef.current.delete(operation);
    operation.then(remove, remove);
    return operation;
  }

  async function waitForAuthenticatedMutations(): Promise<void> {
    while (activeAuthenticatedMutationsRef.current.size > 0) {
      await Promise.allSettled([...activeAuthenticatedMutationsRef.current]);
    }
  }

  function queueGoogleSignOut(): Promise<void> {
    if (!GOOGLE_AUTH_CONFIGURED) return Promise.resolve();
    const epoch = googleSdkEpochRef.current;
    return enqueueGoogleSdkOperation(async () => {
      if (googleSdkEpochRef.current !== epoch) return;
      await GoogleSignin.signOut();
    });
  }

  async function persistGoogleCalendarConnection(
    record: GoogleCalendarConnectionRecord | null,
    ownerId = record?.ownerId
  ): Promise<void> {
    if (!record) {
      if (ownerId) await deleteStoredValue(createGoogleCalendarStorageKey(ownerId));
      await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY);
      return;
    }
    await setStoredValue(createGoogleCalendarStorageKey(record.ownerId), JSON.stringify(record));
  }

  async function persistSession(
    nextSession: SessionPayload | null,
    afterDurableInvalidation?: () => void
  ): Promise<void> {
    await enqueueStorageMutation(async () => {
      if (!nextSession) {
        // Overwrite tokens before best-effort deletion so a deletion failure
        // cannot resurrect the previous account on the next launch.
        await setStoredValue(SESSION_STORAGE_KEY, SESSION_INVALIDATED_STORAGE_VALUE);
        afterDurableInvalidation?.();
        await deleteStoredValue(SESSION_STORAGE_KEY).catch(() => undefined);
        return;
      }
      if (accountCleanupInProgressRef.current) throw new StaleAccountRequestError();
      await setStoredValue(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
    });
  }

  async function persistPendingVerification(record: PendingVerificationRecord | null): Promise<void> {
    await enqueueStorageMutation(async () => {
      if (!record) {
        await deleteStoredValue(PENDING_VERIFICATION_STORAGE_KEY);
        return;
      }
      await setStoredValue(PENDING_VERIFICATION_STORAGE_KEY, JSON.stringify(record));
    });
  }

  async function clearPendingVerification(): Promise<void> {
    setPendingVerification(null);
    await persistPendingVerification(null);
  }

  function abortAuthenticatedRequests(): void {
    for (const controller of authenticatedRequestControllersRef.current) controller.abort();
    authenticatedRequestControllersRef.current.clear();
  }

  function invalidateAuthenticatedWork(): void {
    activationAttemptRef.current += 1;
    googleSdkEpochRef.current += 1;
    accountGuardRef.current.invalidate();
    abortAuthenticatedRequests();
    refreshSessionPromiseRef.current = null;
  }

  async function activateSession(nextSession: SessionPayload): Promise<AccountGenerationSnapshot> {
    invalidateAuthenticatedWork();
    const activationAttempt = activationAttemptRef.current;
    resetUserScopedState();
    try {
      await persistSession(nextSession);
    } catch {
      await persistSession(null).catch(() => undefined);
      setCleanupIssue({ action: "logout", failedTargets: ["session_storage"], ownerId: nextSession.user.id });
      throw new ApiRequestError("Oturum cihazda güvenli biçimde saklanamadı. Lütfen tekrar dene.", 0);
    }
    if (activationAttemptRef.current !== activationAttempt || accountCleanupInProgressRef.current) {
      try {
        await persistSession(null);
      } catch {
        setCleanupIssue({ action: "logout", failedTargets: ["session_storage"], ownerId: nextSession.user.id });
      }
      throw new StaleAccountRequestError();
    }
    const snapshot = accountGuardRef.current.activate(nextSession.user.id);
    const failedTargets: AccountCleanupTarget[] = [];
    try {
      await restoreManualExams(nextSession.user.id, snapshot);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) throw error;
      setManualExams([]);
      setManualExamOwnerId(null);
      setManualExamsHydrated(false);
      failedTargets.push("manual_exam_storage");
    }
    try {
      await restoreGoogleCalendarConnection(nextSession.user.id, snapshot);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) throw error;
      setGoogleCalendarIntegration(null);
      failedTargets.push("google_connection_storage");
    }
    try {
      await clearPendingVerification();
    } catch {
      failedTargets.push("pending_verification_storage");
    }
    if (
      activationAttemptRef.current !== activationAttempt
      || accountCleanupInProgressRef.current
      || !accountGuardRef.current.isCurrent(snapshot)
    ) {
      throw new StaleAccountRequestError();
    }
    sessionRef.current = nextSession;
    setSession(nextSession);
    if (failedTargets.length > 0) {
      setCleanupIssue({ action: "activation", failedTargets, ownerId: nextSession.user.id });
    } else {
      setCleanupIssue(null);
    }
    return snapshot;
  }

  async function clearExpiredSession(
    userMessage = "Oturumunun süresi doldu. Lütfen tekrar giriş yap."
  ): Promise<void> {
    if (accountCleanupInProgressRef.current) return;
    accountCleanupInProgressRef.current = true;
    setBusy(true);
    const ownerId = sessionRef.current?.user.id;
    invalidateAuthenticatedWork();
    const sessionStorageResult = await runObservableAccountCleanup([
      { target: "session_storage", run: () => persistSession(null) }
    ]);
    if (!sessionStorageResult.complete) {
      clearAuthenticatedMemory();
      reportCleanupResult("session_expiry", sessionStorageResult, ownerId);
      setHydrationError("Süresi dolan oturum cihazdan güvenli biçimde kaldırılamadı. Depolama erişimini kontrol edip tekrar dene.");
      setHydrationStatus("error");
      accountCleanupInProgressRef.current = false;
      setBusy(false);
      return;
    }
    const result = await runObservableAccountCleanup([
      { target: "in_memory_state", run: () => clearAuthenticatedMemory() },
      {
        target: "pending_verification_storage",
        run: () => persistPendingVerification(null)
      },
      {
        target: "google_connection_storage",
        run: () => enqueueStorageMutation(() => persistGoogleCalendarConnection(null, ownerId))
      },
      {
        target: "google_sign_in",
        run: async () => {
          await queueGoogleSignOut();
        }
      }
    ]);
    reportCleanupResult("session_expiry", result, ownerId);
    accountCleanupInProgressRef.current = false;
    setBusy(false);
    setMessage({ text: userMessage, tone: "info" });
  }

  async function refreshAuthenticatedSession(expiredAccessToken?: string): Promise<SessionPayload | null> {
    const currentSession = sessionRef.current;
    const snapshot = accountGuardRef.current.capture();
    const currentDeviceId = deviceIdRef.current;
    if (!currentSession || !snapshot || !currentDeviceId) return null;
    if (expiredAccessToken && currentSession.accessToken !== expiredAccessToken) return currentSession;
    if (refreshSessionPromiseRef.current) return refreshSessionPromiseRef.current;

    let refreshPromise!: Promise<SessionPayload | null>;
    refreshPromise = (async () => {
      let sessionWasRotated = false;
      try {
        const nextSession = await apiRequest<SessionPayload>(
          "/auth/refresh-token",
          {
            method: "POST",
            body: JSON.stringify({
              refreshToken: currentSession.refreshToken,
              deviceId: currentDeviceId
            })
          },
          undefined,
          {
            skipAuthRefresh: true,
            authOperation: "refresh_session",
            ownerSnapshot: snapshot
          }
        );
        sessionWasRotated = true;
        if (!accountGuardRef.current.isCurrent(snapshot) || nextSession.user.id !== snapshot.ownerId) return null;
        await enqueueStorageMutation(async () => {
          if (!accountGuardRef.current.isCurrent(snapshot) || accountCleanupInProgressRef.current) return;
          await setStoredValue(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
        });
        if (!accountGuardRef.current.isCurrent(snapshot)) return null;
        sessionRef.current = nextSession;
        setSession(nextSession);
        return nextSession;
      } catch (error) {
        if (error instanceof StaleAccountRequestError || !accountGuardRef.current.isCurrent(snapshot)) return null;
        if (sessionWasRotated) {
          await clearExpiredSession("Oturum yenilendi ancak cihazda güvenli biçimde saklanamadı. Lütfen tekrar giriş yap.");
        } else if (
          error instanceof ApiRequestError
          && (error.code === "session_expired" || error.code === "disabled_account")
        ) {
          await clearExpiredSession(error.message);
        } else {
          setMessage({ text: "Oturum şu anda yenilenemedi. Bağlantını kontrol edip tekrar dene.", tone: "error" });
        }
        return null;
      } finally {
        if (refreshSessionPromiseRef.current === refreshPromise) refreshSessionPromiseRef.current = null;
      }
    })();
    refreshSessionPromiseRef.current = refreshPromise;
    return refreshPromise;
  }

  async function apiRequest<T>(
    path: string,
    options: RequestInit = {},
    token?: string,
    requestOptions: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined)
    };

    if (token) headers.Authorization = `Bearer ${token}`;

    const ownerSnapshot = requestOptions.ownerSnapshot ?? (
      token && !requestOptions.detached ? accountGuardRef.current.capture() : null
    );
    if (token && !requestOptions.detached && !ownerSnapshot) throw new StaleAccountRequestError();
    if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();

    const effectiveTimeoutMs = requestOptions.timeoutMs ?? API_REQUEST_TIMEOUT_MS;
    const controller = ownerSnapshot || effectiveTimeoutMs > 0 ? new AbortController() : null;
    const upstreamSignal = options.signal;
    const abortFromUpstream = () => controller?.abort();
    let requestTimedOut = false;
    const timeout = effectiveTimeoutMs > 0 && controller
      ? setTimeout(() => {
        requestTimedOut = true;
        controller.abort();
      }, effectiveTimeoutMs)
      : null;
    if (controller) {
      authenticatedRequestControllersRef.current.add(controller);
      if (upstreamSignal?.aborted) controller.abort();
      else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
    }

    try {
      const response = await fetch(`${apiBaseUrl}${path}`, {
        ...options,
        headers,
        ...(controller ? { signal: controller.signal } : {})
      });
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();

      if (!response.ok) {
        const body = await response.text();
        if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
        const payload = readApiErrorPayload(body);
        if (response.status === 401 && token && !requestOptions.skipAuthRefresh) {
          const refreshedSession = await refreshAuthenticatedSession(token);
          if (refreshedSession && (!ownerSnapshot || accountGuardRef.current.isCurrent(ownerSnapshot))) {
            return apiRequest<T>(path, options, refreshedSession.accessToken, {
              ...requestOptions,
              skipAuthRefresh: true,
              ownerSnapshot
            });
          }
        }
        const details = {
          ...(payload.details ?? {}),
          ...(payload.resendAvailableAt ? { resendAvailableAt: payload.resendAvailableAt } : {})
        };
        if (requestOptions.authOperation) {
          const controlled = classifyAuthError({
            operation: requestOptions.authOperation,
            status: response.status,
            body: payload
          });
          throw new ApiRequestError(controlled.message, response.status, controlled.code, details);
        }
        throw new ApiRequestError(
          parseApiErrorMessage(body, `${response.status} ${response.statusText}`, response.status),
          response.status,
          payload.errorCode,
          details
        );
      }

      const data = (await response.json()) as T;
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      return data;
    } catch (error) {
      if (requestTimedOut) {
        throw new ApiRequestError("Sunucu zamanında yanıt vermedi. Lütfen tekrar dene.", 0, "network_unavailable");
      }
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) {
        throw new StaleAccountRequestError();
      }
      if (error instanceof StaleAccountRequestError || error instanceof ApiRequestError) throw error;
      if (controller?.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new StaleAccountRequestError();
      }
      throw new ApiRequestError("Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.", 0);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (controller) authenticatedRequestControllersRef.current.delete(controller);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  }

  async function withLoadable<T>(
    setter: (state: Loadable<T>) => void,
    action: () => Promise<T>,
    ownerSnapshot: AccountGenerationSnapshot | null = accountGuardRef.current.capture()
  ): Promise<T | null> {
    if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) return null;
    setter({ loading: true });
    try {
      const data = await action();
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) return null;
      setter({ loading: false, data });
      return data;
    } catch (error) {
      if (error instanceof StaleAccountRequestError || (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot))) {
        setter({ loading: false });
        return null;
      }
      setter({
        loading: false,
        error: userMessageFromError(error, "İşlem tamamlanamadı. Lütfen tekrar dene.")
      });
      return null;
    }
  }

  async function bootstrapAuthenticatedContext(
    token: string,
    ownerSnapshot = accountGuardRef.current.capture()
  ): Promise<void> {
    if (!ownerSnapshot || !accountGuardRef.current.isCurrent(ownerSnapshot)) return;
    let profile: UserProfile;
    try {
      profile = await apiRequest<UserProfile>("/me", {}, token, { ownerSnapshot });
    } catch (error) {
      if (error instanceof StaleAccountRequestError || !accountGuardRef.current.isCurrent(ownerSnapshot)) return;
      if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403 || error.status === 404)) {
        await clearExpiredSession("Bu hesap artık kullanılamıyor. Lütfen farklı bir hesapla giriş yap.");
        return;
      }
      setMessage({ text: "Hesap bilgileri şu anda yenilenemedi. Bağlantını kontrol edip tekrar dene.", tone: "error" });
      return;
    }
    if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
    if (profile.id !== ownerSnapshot.ownerId || profile.status !== "active") {
      await clearExpiredSession("Bu hesap artık kullanılamıyor. Lütfen farklı bir hesapla giriş yap.");
      return;
    }
    await loadPreferences(token, ownerSnapshot);
    if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
    const profileUniversityId = profile.universityId ?? "";
    setSelectedUniversityId(profileUniversityId);
    setRegisterUniversityId(profileUniversityId);
    setRegisterFacultyId(profile.facultyId ?? "");
    setRegisterDepartmentId(profile.departmentId ?? "");
    if (profileUniversityId) {
      await loadMyCalendar(token, ownerSnapshot);
      await loadUpcoming(token, ownerSnapshot);
    }
    await loadAnnouncements(token, profileUniversityId, ownerSnapshot);
  }

  async function handleAuth(): Promise<void> {
    if (accountCleanupInProgressRef.current || authOperationInProgressRef.current) {
      setMessage({ text: "Başka bir hesap işlemi tamamlanıyor. Lütfen kısa bir süre bekle.", tone: "info" });
      return;
    }
    if (!email.trim() || password.length === 0) {
      Alert.alert("Eksik alan", "E-posta ve şifre zorunludur.");
      return;
    }
    if (authMode === "register" && password.length < AUTH_PASSWORD_MIN_LENGTH) {
      Alert.alert("Şifre çok kısa", `Şifren en az ${AUTH_PASSWORD_MIN_LENGTH} karakter olmalıdır.`);
      return;
    }
    const currentDeviceId = deviceIdRef.current;
    if (!currentDeviceId) {
      Alert.alert("Hazırlanıyor", "Cihaz kimliği henüz hazır değil.");
      return;
    }

    const isRegister = authMode === "register";
    authOperationInProgressRef.current = true;
    try {
      setBusy(true);
      if (!isRegister) {
        const nextSession = await apiRequest<SessionPayload>(
          AUTH_ENDPOINTS.login,
          {
            method: "POST",
            body: JSON.stringify({
              email: email.trim().toLowerCase(),
              password,
              deviceId: currentDeviceId
            })
          },
          undefined,
          { authOperation: "login" }
        );

        setAuthStage("auth");
        const snapshot = await activateSession(nextSession);
        setPassword("");
        setActiveTab("home");
        setMessage({ text: "Giriş başarılı.", tone: "success" });
        await bootstrapAuthenticatedContext(nextSession.accessToken, snapshot);
        return;
      }

      const registerResult = await apiRequest<RegisterResponse>(
        AUTH_ENDPOINTS.register,
        {
          method: "POST",
          body: JSON.stringify({
            fullName: fullName.trim() || "Mobil Öğrenci",
            email: email.trim().toLowerCase(),
            password,
            passwordConfirmation: password
          })
        },
        undefined,
        { authOperation: "register" }
      );

      const record = createPendingVerificationRecord(registerResult);
      setPendingVerification(record);
      setAuthStage("verify");
      setRegisterPicker("none");
      setVerificationToken(registerResult.previewVerificationToken ?? "");
      try {
        await persistPendingVerification(record);
        setMessage({
          text: registerResult.previewVerificationToken ? "Doğrulama kodu hazır. Devam etmek için doğrulamayı tamamla." : "Doğrulama kodu e-postana gönderildi.",
          tone: "info"
        });
      } catch {
        setCleanupIssue({ action: "verification_save", failedTargets: ["pending_verification_storage"] });
        setMessage({
          text: "Hesap oluşturuldu ve kod gönderildi; ancak doğrulama adımı cihazda saklanamadı. Bu ekranı kapatmadan doğrulamayı tamamla.",
          tone: "error"
        });
      }
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      if (!isRegister && error instanceof ApiRequestError && error.code === "email_not_verified") {
        await openVerificationRecovery(email).catch(() => undefined);
      }
      setMessage({
        text: userMessageFromError(error, "Giriş işlemi tamamlanamadı"),
        tone: "error"
      });
    } finally {
      authOperationInProgressRef.current = false;
      setBusy(false);
    }
  }

  async function handleGoogleAuth(): Promise<void> {
    if (accountCleanupInProgressRef.current || authOperationInProgressRef.current) {
      setMessage({ text: "Başka bir hesap işlemi tamamlanıyor. Lütfen kısa bir süre bekle.", tone: "info" });
      return;
    }
    if (!GOOGLE_AUTH_CONFIGURED) {
      setMessage({ text: GOOGLE_AUTH_CONFIGURATION_MESSAGE, tone: "error" });
      return;
    }
    if (!deviceId) {
      setMessage({ text: "Cihaz kimliği henüz hazır değil.", tone: "error" });
      return;
    }

    authOperationInProgressRef.current = true;
    try {
      setGoogleBusy(true);
      const nativeAuth = await enqueueGoogleSdkOperation(async () => {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        await clearGoogleAccountSelection();
        const result = await GoogleSignin.signIn();
        if (isCancelledResponse(result)) return { cancelled: true as const, idToken: null };

        let idToken = result.data.idToken;
        if (!idToken) {
          try {
            idToken = (await GoogleSignin.getTokens()).idToken;
          } catch {
            idToken = null;
          }
        }
        return { cancelled: false as const, idToken };
      });
      if (nativeAuth.cancelled) {
        setMessage({ text: "Google girişi tamamlanmadan kapatıldı.", tone: "info" });
        return;
      }
      const idToken = nativeAuth.idToken;
      if (!idToken) {
        await queueGoogleSignOut();
        setMessage({ text: GOOGLE_ID_TOKEN_CONFIGURATION_MESSAGE, tone: "error" });
        return;
      }

      const nextSession = await apiRequest<SessionPayload>(
        "/auth/google",
        {
          method: "POST",
          body: JSON.stringify({ idToken, deviceId: deviceIdRef.current })
        },
        undefined,
        { authOperation: "google_sign_in" }
      );

      setAuthStage("auth");
      const snapshot = await activateSession(nextSession);
      setPassword("");
      setActiveTab("home");
      setMessage({ text: "Google ile giriş başarılı.", tone: "success" });
      await bootstrapAuthenticatedContext(nextSession.accessToken, snapshot);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      if (isErrorWithCode(error)) {
        if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          setMessage({ text: "Google Play Hizmetleri bu cihazda hazır değil veya güncellenmeli.", tone: "error" });
          return;
        }
        if (error.code === statusCodes.IN_PROGRESS) {
          setMessage({ text: "Google girişi zaten devam ediyor.", tone: "info" });
          return;
        }
        if (error.code === statusCodes.SIGN_IN_CANCELLED) {
          setMessage({ text: "Google girişi tamamlanmadan kapatıldı.", tone: "info" });
          return;
        }
      }
      if (error instanceof ApiRequestError && error.code === "disabled_account") {
        await queueGoogleSignOut();
        setMessage({ text: error.message, tone: "error" });
        return;
      }
      if (error instanceof ApiRequestError && error.status === 401) {
        await queueGoogleSignOut();
        setMessage({
          text: "Google oturumu doğrulanamadı. Hesap seçimi sıfırlandı; tekrar deneyip farklı bir Google hesabı seçebilirsin.",
          tone: "error"
        });
        return;
      }
      await queueGoogleSignOut();
      setMessage({
        text: userMessageFromError(error, "Google girişi tamamlanamadı"),
        tone: "error"
      });
    } finally {
      authOperationInProgressRef.current = false;
      setGoogleBusy(false);
    }
  }

  async function resendVerificationEmail(): Promise<void> {
    if (authOperationInProgressRef.current || accountCleanupInProgressRef.current) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setMessage({ text: "Kod istemek için e-posta adresini gir.", tone: "error" });
      return;
    }
    if (verificationTiming && verificationTiming.resendInSeconds > 0) {
      setMessage({ text: "Yeni kod istemeden önce geri sayımın bitmesini bekle.", tone: "info" });
      return;
    }

    authOperationInProgressRef.current = true;
    try {
      setBusy(true);
      const registerResult = await apiRequest<RegisterResponse>(
        AUTH_ENDPOINTS.resendVerificationCode,
        {
          method: "POST",
          body: JSON.stringify({ email: normalizedEmail })
        },
        undefined,
        { authOperation: "resend_verification" }
      );

      const record = createPendingVerificationRecord(registerResult);
      setPendingVerification(record);
      setVerificationToken(registerResult.previewVerificationToken ?? "");
      try {
        await persistPendingVerification(record);
        setMessage({
          text: registerResult.previewVerificationToken ? "Doğrulama kodu yenilendi ve dolduruldu." : "Doğrulama kodu tekrar gönderildi.",
          tone: "info"
        });
      } catch {
        setCleanupIssue({ action: "verification_save", failedTargets: ["pending_verification_storage"] });
        setMessage({
          text: "Yeni kod gönderildi; ancak doğrulama süresi cihazda saklanamadı.",
          tone: "error"
        });
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const resendAvailableAt = error.details?.resendAvailableAt;
        if (typeof resendAvailableAt === "string" && pendingVerification) {
          const record = createPendingVerificationRecord({
            ...pendingVerification,
            resendAvailableAt
          });
          setPendingVerification(record);
          await persistPendingVerification(record).catch(() => undefined);
        }
      }
      setMessage({
        text: userMessageFromError(error, "Kod tekrar gönderilemedi"),
        tone: "error"
      });
    } finally {
      authOperationInProgressRef.current = false;
      setBusy(false);
    }
  }

  async function handleVerifyEmail(): Promise<void> {
    if (authOperationInProgressRef.current || accountCleanupInProgressRef.current) return;
    if (!verificationToken.trim()) {
      setMessage({ text: "Doğrulama kodu gereklidir.", tone: "error" });
      return;
    }

    const currentDeviceId = deviceIdRef.current;
    if (!currentDeviceId) {
      setMessage({ text: "Cihaz kimliği henüz hazır değil.", tone: "error" });
      return;
    }

    authOperationInProgressRef.current = true;
    try {
      setBusy(true);
      await apiRequest<{ status: "verified"; email: string }>(
        AUTH_ENDPOINTS.verifyEmail,
        {
          method: "POST",
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            code: verificationToken.trim(),
            deviceId: currentDeviceId
          })
        },
        undefined,
        { authOperation: "verify_email" }
      );

      setPendingVerification(null);
      try {
        await persistPendingVerification(null);
      } catch {
        setCleanupIssue({ action: "verification_clear", failedTargets: ["pending_verification_storage"] });
      }
      setAuthStage("profile_confirm");
      setMessage({ text: "E-posta doğrulandı. Son adım: profilini onayla.", tone: "success" });
    } catch (error) {
      setMessage({
        text: userMessageFromError(error, "E-posta doğrulanamadı"),
        tone: "error"
      });
    } finally {
      authOperationInProgressRef.current = false;
      setBusy(false);
    }
  }

  async function confirmProfileAndStart(): Promise<void> {
    if (authOperationInProgressRef.current || accountCleanupInProgressRef.current) return;
    if (password.length === 0) {
      setAuthMode("login");
      setAuthStage("auth");
      setVerificationToken("");
      setMessage({ text: "E-posta doğrulandı. Devam etmek için şifrenle giriş yap.", tone: "success" });
      return;
    }

    authOperationInProgressRef.current = true;
    try {
      setBusy(true);
      const nextSession = await apiRequest<SessionPayload>(
        AUTH_ENDPOINTS.login,
        {
          method: "POST",
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password,
            deviceId: deviceIdRef.current
          })
        },
        undefined,
        { authOperation: "login" }
      );
      const snapshot = await activateSession(nextSession);
      setAuthStage("auth");
      setActiveTab("home");
      setPassword("");
      setMessage({ text: "Profilin onaylandı. Uygulamayı kullanmaya başlayabilirsin.", tone: "success" });
      await bootstrapAuthenticatedContext(nextSession.accessToken, snapshot);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      setAuthMode("login");
      setAuthStage("auth");
      setMessage({
        text: `E-posta doğrulandı ancak giriş tamamlanamadı. ${userMessageFromError(error, "Şifreni girip tekrar dene.")}`,
        tone: "error"
      });
    } finally {
      authOperationInProgressRef.current = false;
      setBusy(false);
    }
  }

  function openPasswordRecovery(candidateEmail = email): void {
    setEmail(candidateEmail.trim().toLowerCase());
    setPassword("");
    setPasswordVisible(false);
    setPasswordRecoveryCode("");
    setNewPassword("");
    setPasswordConfirmation("");
    setNewPasswordVisible(false);
    setPasswordConfirmationVisible(false);
    setPendingPasswordRecovery(null);
    setPasswordRecoveryFeedback(null);
    setAuthMode("login");
    setAuthStage("password_recovery_request");
  }

  async function requestPasswordRecovery(): Promise<void> {
    if (authOperationInProgressRef.current || accountCleanupInProgressRef.current) return;
    const normalizedEmail = email.trim().toLowerCase();
    const validation = validatePasswordRecoveryRequest(normalizedEmail);
    if (!validation.valid) {
      setPasswordRecoveryFeedback({ text: validation.message, tone: "error" });
      return;
    }
    if (
      pendingPasswordRecovery?.email === normalizedEmail
      && passwordRecoveryTiming
      && passwordRecoveryTiming.resendInSeconds > 0
    ) {
      setPasswordRecoveryFeedback({
        text: "Yeni kod istemeden önce geri sayımın bitmesini bekle.",
        tone: "info"
      });
      return;
    }

    authOperationInProgressRef.current = true;
    try {
      setBusy(true);
      setPasswordRecoveryFeedback(null);
      const result = await apiRequest<PasswordRecoveryRequestResponse>(
        AUTH_ENDPOINTS.passwordRecoveryRequest,
        {
          method: "POST",
          body: JSON.stringify({ email: normalizedEmail })
        },
        undefined,
        { authOperation: "request_password_recovery" }
      );

      const nowMs = Date.now();
      const expiresInSeconds = Number.isFinite(result.expiresInSeconds)
        ? Math.max(1, Math.floor(result.expiresInSeconds))
        : 600;
      const resendAfterSeconds = Number.isFinite(result.resendAfterSeconds)
        ? Math.max(0, Math.floor(result.resendAfterSeconds))
        : 60;
      const record = createPendingPasswordRecoveryRecord({
        email: normalizedEmail,
        recoveryExpiresAt: new Date(nowMs + expiresInSeconds * 1_000).toISOString(),
        resendAvailableAt: new Date(nowMs + resendAfterSeconds * 1_000).toISOString()
      });
      const previewCode = typeof result.previewRecoveryCode === "string"
        && new RegExp(`^\\d{${PASSWORD_RECOVERY_CODE_LENGTH}}$`).test(result.previewRecoveryCode)
        ? result.previewRecoveryCode
        : "";

      setPendingPasswordRecovery(record);
      setPasswordRecoveryClockMs(nowMs);
      setPasswordRecoveryCode(previewCode);
      setNewPassword("");
      setPasswordConfirmation("");
      setNewPasswordVisible(false);
      setPasswordConfirmationVisible(false);
      setAuthStage("password_recovery_confirm");
      setPasswordRecoveryFeedback({
        text: previewCode
          ? "Sıfırlama kodu hazır. Yeni şifreni belirleyebilirsin."
          : "Hesap uygunsa sıfırlama kodu e-posta adresine gönderildi.",
        tone: "success"
      });
    } catch (error) {
      setPasswordRecoveryFeedback({
        text: userMessageFromError(error, "Şifre sıfırlama isteği tamamlanamadı."),
        tone: "error"
      });
    } finally {
      authOperationInProgressRef.current = false;
      setBusy(false);
    }
  }

  async function confirmPasswordRecovery(): Promise<void> {
    if (authOperationInProgressRef.current || accountCleanupInProgressRef.current) return;
    if (!pendingPasswordRecovery) {
      setAuthStage("password_recovery_request");
      setPasswordRecoveryFeedback({
        text: "Önce e-posta adresin için yeni bir sıfırlama kodu iste.",
        tone: "error"
      });
      return;
    }
    const validation = validatePasswordRecoveryConfirmation({
      code: passwordRecoveryCode,
      newPassword,
      passwordConfirmation
    });
    if (!validation.valid) {
      setPasswordRecoveryFeedback({ text: validation.message, tone: "error" });
      return;
    }
    if (passwordRecoveryTiming?.expired) {
      setPasswordRecoveryFeedback({
        text: "Şifre sıfırlama kodunun süresi dolmuş. Yeni bir kod iste.",
        tone: "error"
      });
      return;
    }

    authOperationInProgressRef.current = true;
    try {
      setBusy(true);
      setPasswordRecoveryFeedback(null);
      await apiRequest<PasswordRecoveryConfirmResponse>(
        AUTH_ENDPOINTS.passwordRecoveryConfirm,
        {
          method: "POST",
          body: JSON.stringify({
            email: pendingPasswordRecovery.email,
            code: passwordRecoveryCode.trim(),
            newPassword,
            passwordConfirmation
          })
        },
        undefined,
        { authOperation: "confirm_password_recovery" }
      );

      setPasswordRecoveryCode("");
      setNewPassword("");
      setPasswordConfirmation("");
      setNewPasswordVisible(false);
      setPasswordConfirmationVisible(false);
      setPendingPasswordRecovery(null);
      setPasswordRecoveryFeedback(null);
      setPassword("");
      setPasswordVisible(false);
      setAuthMode("login");
      setAuthStage("auth");
      setMessage({
        text: "Şifren başarıyla yenilendi. Yeni şifrenle giriş yapabilirsin.",
        tone: "success"
      });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "password_recovery_code_expired") {
        setPendingPasswordRecovery(createPendingPasswordRecoveryRecord({
          ...pendingPasswordRecovery,
          recoveryExpiresAt: new Date().toISOString()
        }));
      }
      setPasswordRecoveryFeedback({
        text: userMessageFromError(error, "Şifre yenilenemedi. Bilgilerini kontrol edip tekrar dene."),
        tone: "error"
      });
    } finally {
      authOperationInProgressRef.current = false;
      setBusy(false);
    }
  }

  function returnToPasswordRecoveryRequest(): void {
    setPasswordRecoveryCode("");
    setNewPassword("");
    setPasswordConfirmation("");
    setNewPasswordVisible(false);
    setPasswordConfirmationVisible(false);
    setPasswordRecoveryFeedback(null);
    setAuthStage("password_recovery_request");
  }

  function cancelPasswordRecovery(): void {
    setPasswordRecoveryCode("");
    setNewPassword("");
    setPasswordConfirmation("");
    setNewPasswordVisible(false);
    setPasswordConfirmationVisible(false);
    setPendingPasswordRecovery(null);
    setPasswordRecoveryFeedback(null);
    setPassword("");
    setPasswordVisible(false);
    setAuthMode("login");
    setAuthStage("auth");
  }

  async function openVerificationRecovery(candidateEmail = email): Promise<void> {
    const normalizedEmail = candidateEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setMessage({ text: "Önce doğrulamak istediğin e-posta adresini gir.", tone: "error" });
      return;
    }
    const record = createPendingVerificationRecord({
      email: normalizedEmail,
      verificationExpiresAt: new Date().toISOString()
    });
    setEmail(normalizedEmail);
    setPassword("");
    setPendingVerification(record);
    setVerificationToken("");
    setAuthMode("login");
    setAuthStage("verify");
    try {
      await persistPendingVerification(record);
    } catch {
      setCleanupIssue({ action: "verification_save", failedTargets: ["pending_verification_storage"] });
      setMessage({
        text: "Doğrulama ekranı açıldı; ancak bu adım cihazda saklanamadı.",
        tone: "error"
      });
    }
  }

  function returnToLoginForm(): void {
    setAuthMode("login");
    setAuthStage("auth");
    setPassword("");
    setPasswordVisible(false);
    setPasswordRecoveryCode("");
    setNewPassword("");
    setPasswordConfirmation("");
    setNewPasswordVisible(false);
    setPasswordConfirmationVisible(false);
    setPendingPasswordRecovery(null);
    setPasswordRecoveryFeedback(null);
    setRegisterPicker("none");
    setVerificationToken("");
  }

  async function handleLogout(): Promise<void> {
    if (!session || accountCleanupInProgressRef.current) return;
    const closingSession = session;
    const ownerId = closingSession.user.id;
    accountCleanupInProgressRef.current = true;
    setBusy(true);
    const sessionStorageResult = await runObservableAccountCleanup([
      { target: "session_storage", run: () => persistSession(null, invalidateAuthenticatedWork) }
    ]);
    if (!sessionStorageResult.complete) {
      reportCleanupResult("logout", sessionStorageResult, ownerId);
      accountCleanupInProgressRef.current = false;
      setBusy(false);
      setMessage({
        text: "Çıkış tamamlanamadı; cihaz oturumu güvenli biçimde kaldırılamadığı için bu hesap açık bırakıldı. Tekrar deneyebilirsin.",
        tone: "error"
      });
      return;
    }
    const result = await runObservableAccountCleanup([
      { target: "in_memory_state", run: () => clearAuthenticatedMemory() },
      {
        target: "pending_verification_storage",
        run: () => persistPendingVerification(null)
      },
      {
        target: "google_connection_storage",
        run: () => enqueueStorageMutation(() => persistGoogleCalendarConnection(null, ownerId))
      },
      {
        target: "google_sign_in",
        run: async () => {
          await queueGoogleSignOut();
        }
      },
      {
        target: "server_session",
        timeoutMs: 8_000,
        run: () => apiRequest<{ status: "ok" }>(
          "/auth/logout",
          {
            method: "POST",
            body: JSON.stringify({ refreshToken: closingSession.refreshToken })
          },
          closingSession.accessToken,
          { skipAuthRefresh: true, authOperation: "logout", detached: true, timeoutMs: 8_000 }
        ).then(() => undefined)
      }
    ]);
    accountCleanupInProgressRef.current = false;
    setBusy(false);
    reportCleanupResult("logout", result, ownerId);
    if (result.complete) {
      setMessage({ text: "Çıkış yapıldı.", tone: "info" });
    } else if (result.failedTargets.every((target) => target === "server_session")) {
      setMessage({
        text: "Bu cihazdaki çıkış tamamlandı; sunucudaki oturumun sonlandırıldığı doğrulanamadı.",
        tone: "info"
      });
    } else {
      setMessage({
        text: "Çıkış ekranda tamamlandı; bazı cihaz kayıtları temizlenemedi. Aşağıdan tekrar deneyebilirsin.",
        tone: "error"
      });
    }
  }

  function resetUserScopedState(): void {
    setManualExamsHydrated(false);
    setManualExamOwnerId(null);
    setSelectedUniversityId("");
    setRegisterUniversityId("");
    setRegisterFacultyId("");
    setRegisterDepartmentId("");
    setRegisterPicker("none");
    setFaculties({ loading: false, data: [] });
    setDepartments({ loading: false, data: [] });
    setCalendar({ loading: false });
    setUpcoming({ loading: false });
    setAnnouncements({ loading: false });
    setYokAnnouncements({ loading: false });
    setSummerSchool({ loading: false });
    setPreferences({ loading: false });
    setAlarmEnabled(true);
    setAlarmMode("all_calendar");
    setCategoryDraft({});
    setAlarmCategoriesExpanded(false);
    setGoogleCalendarIntegration(null);
    setGoogleCalendarError(null);
    setGoogleCalendarBusy(false);
    setGoogleBusy(false);
    academicSelectionPendingRef.current = null;
    setAcademicSelectionPending(null);
    setManualExams([]);
    setManualExamTitle("");
    setManualExamDate("");
  }

  function clearAuthenticatedMemory(): void {
    sessionRef.current = null;
    setSession(null);
    setAuthMode("login");
    setAuthStage("auth");
    setActiveTab("home");
    setEmail("");
    setPassword("");
    setPasswordVisible(false);
    setFullName("");
    setVerificationToken("");
    setPendingVerification(null);
    resetUserScopedState();
  }

  function reportCleanupResult(
    action: "logout" | "session_expiry" | "data_deletion" | "account_deletion" | "verification_save" | "verification_clear" | "activation" | "manual_exam_save",
    result: AccountCleanupResult,
    ownerId?: string
  ): void {
    setCleanupIssue(result.complete ? null : { action, failedTargets: result.failedTargets, ownerId });
  }

  async function retryFailedCleanup(): Promise<void> {
    if (!cleanupIssue || accountCleanupInProgressRef.current || authOperationInProgressRef.current) return;
    const issue = cleanupIssue;
    if (
      issue.action === "logout"
      && issue.failedTargets.includes("session_storage")
      && sessionRef.current
      && (!issue.ownerId || sessionRef.current.user.id === issue.ownerId)
    ) {
      setCleanupIssue(null);
      await handleLogout();
      return;
    }
    if (
      issue.action === "account_deletion"
      && issue.failedTargets.includes("session_storage")
      && sessionRef.current
      && (!issue.ownerId || sessionRef.current.user.id === issue.ownerId)
    ) {
      setCleanupIssue(null);
      await deleteAccount();
      return;
    }
    const currentSnapshot = accountGuardRef.current.capture();
    if (
      issue.ownerId
      && currentSnapshot
      && currentSnapshot.ownerId !== issue.ownerId
    ) {
      setCleanupIssue(null);
      setMessage({ text: "Hesap değiştiği için eski hesaba ait tekrar deneme iptal edildi.", tone: "info" });
      return;
    }

    accountCleanupInProgressRef.current = true;
    setBusy(true);
    try {
      const localTargets = issue.failedTargets.filter(
        (target) => target !== "server_session" && target !== "server_account"
      );
      const tasks = localTargets.map((target) => ({
        target,
        run: async () => {
          if (target === "session_storage") await persistSession(null);
          else if (target === "pending_verification_storage") {
            if (issue.action === "verification_save") {
              if (!pendingVerification) throw new Error("Pending verification state is no longer available.");
              await persistPendingVerification(pendingVerification);
            } else {
              await persistPendingVerification(null);
            }
          }
          else if (target === "manual_exam_storage" && issue.ownerId) {
            if (issue.action === "activation") {
              await restoreManualExams(issue.ownerId, currentSnapshot);
            } else if (issue.action === "manual_exam_save") {
              if (!currentSnapshot || !accountGuardRef.current.isCurrent(currentSnapshot)) throw new StaleAccountRequestError();
              await enqueueStorageMutation(async () => {
                if (!accountGuardRef.current.isCurrent(currentSnapshot)) throw new StaleAccountRequestError();
                await setStoredValue(
                  createManualExamStorageKey(issue.ownerId as string),
                  serializeManualExamEnvelope(issue.ownerId as string, manualExams)
                );
              });
            } else {
              await enqueueStorageMutation(() => deleteStoredValue(createManualExamStorageKey(issue.ownerId as string)));
            }
          } else if (target === "google_connection_storage") {
            if (issue.action === "activation" && issue.ownerId) {
              await restoreGoogleCalendarConnection(issue.ownerId, currentSnapshot);
            } else {
              await enqueueStorageMutation(() => persistGoogleCalendarConnection(null, issue.ownerId));
            }
          } else if (target === "google_sign_in" && GOOGLE_AUTH_CONFIGURED) {
            await queueGoogleSignOut();
          } else if (target === "in_memory_state") {
            clearAuthenticatedMemory();
          }
        }
      }));
      const retryResult = await runObservableAccountCleanup(tasks);
      const unresolvedServer = issue.failedTargets.filter(
        (target) => target === "server_session" || target === "server_account"
      );
      const failedTargets = [...unresolvedServer, ...retryResult.failedTargets];
      if (failedTargets.length === 0) {
        setCleanupIssue(null);
        if (issue.action === "data_deletion" && issue.ownerId && sessionRef.current?.user.id === issue.ownerId) {
          setManualExams([]);
          setManualExamOwnerId(issue.ownerId);
          setManualExamsHydrated(true);
        }
        setMessage({ text: "Cihazdaki temizlik tamamlandı.", tone: "success" });
      } else {
        setCleanupIssue({ ...issue, failedTargets });
        setMessage({ text: "Bazı temizlik adımları hâlâ tamamlanamadı.", tone: "error" });
      }
    } finally {
      accountCleanupInProgressRef.current = false;
      setBusy(false);
    }
  }

  function confirmDeleteMyData(): void {
    if (!session) return;
    Alert.alert(
      "Verilerimi sil",
      "Okul seçimin, bildirim tercihlerin, cihaz bildirim kaydın, kişisel alarm ve sınav verilerin silinir. Hesabın açık kalır.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Verileri Sil",
          style: "destructive",
          onPress: () => void deleteMyData()
        }
      ]
    );
  }

  async function deleteMyData(): Promise<void> {
    if (!session || accountCleanupInProgressRef.current) return;
    const currentSession = session;
    accountCleanupInProgressRef.current = true;
    setBusy(true);
    try {
      await waitForAuthenticatedMutations();
      await apiRequest<{ status: "deleted" }>(
        "/me/data",
        { method: "DELETE" },
        currentSession.accessToken,
        { skipAuthRefresh: true, detached: true }
      );
      invalidateAuthenticatedWork();
      resetUserScopedState();
      setPendingVerification(null);
      accountGuardRef.current.activate(currentSession.user.id);
      const result = await runObservableAccountCleanup([
        {
          target: "pending_verification_storage",
          run: () => persistPendingVerification(null)
        },
        {
          target: "manual_exam_storage",
          run: () => enqueueStorageMutation(
            () => deleteStoredValue(createManualExamStorageKey(currentSession.user.id))
          )
        },
        {
          target: "google_connection_storage",
          run: () => enqueueStorageMutation(
            () => persistGoogleCalendarConnection(null, currentSession.user.id)
          )
        },
        {
          target: "google_sign_in",
          run: async () => {
            await queueGoogleSignOut();
          }
        }
      ]);
      setManualExamOwnerId(currentSession.user.id);
      setManualExamsHydrated(!result.failedTargets.includes("manual_exam_storage"));
      reportCleanupResult("data_deletion", result, currentSession.user.id);
      setMessage({
        text: result.complete
          ? "Uygulama verilerin silindi. Hesabın açık kalmaya devam ediyor."
          : "Sunucudaki veriler silindi; bazı cihaz kayıtları temizlenemedi.",
        tone: result.complete ? "success" : "error"
      });
    } catch (error) {
      setMessage({ text: userMessageFromError(error, "Veriler silinemedi. Lütfen tekrar dene."), tone: "error" });
    } finally {
      accountCleanupInProgressRef.current = false;
      setBusy(false);
    }
  }

  function confirmDeleteAccount(): void {
    if (!session) return;
    Alert.alert(
      "Hesabımı sil",
      "Hesabın kapatılır, oturumların sonlandırılır ve hesabına bağlı uygulama verileri silinir. Bu işlem geri alınamaz.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Hesabımı Sil",
          style: "destructive",
          onPress: () => void deleteAccount()
        }
      ]
    );
  }

  async function deleteAccount(): Promise<void> {
    if (!session || accountCleanupInProgressRef.current) return;
    const closingSession = session;
    const ownerId = closingSession.user.id;
    accountCleanupInProgressRef.current = true;
    setBusy(true);
    const sessionStorageResult = await runObservableAccountCleanup([
      { target: "session_storage", run: () => persistSession(null, invalidateAuthenticatedWork) }
    ]);
    if (!sessionStorageResult.complete) {
      reportCleanupResult("account_deletion", sessionStorageResult, ownerId);
      accountCleanupInProgressRef.current = false;
      setBusy(false);
      setMessage({
        text: "Hesap silme başlatılmadı; cihaz oturumu güvenli biçimde kaldırılamadı. Tekrar deneyebilirsin.",
        tone: "error"
      });
      return;
    }
    const result = await runObservableAccountCleanup([
      { target: "in_memory_state", run: () => clearAuthenticatedMemory() },
      {
        target: "pending_verification_storage",
        run: () => persistPendingVerification(null)
      },
      {
        target: "manual_exam_storage",
        run: () => enqueueStorageMutation(() => deleteStoredValue(createManualExamStorageKey(ownerId)))
      },
      {
        target: "google_connection_storage",
        run: () => enqueueStorageMutation(() => persistGoogleCalendarConnection(null, ownerId))
      },
      {
        target: "google_sign_in",
        run: async () => {
          await queueGoogleSignOut();
        }
      },
      {
        target: "server_account",
        timeoutMs: 8_000,
        run: () => apiRequest<{ status: "deleted" }>(
          "/me",
          { method: "DELETE", body: JSON.stringify({ deleteData: true }) },
          closingSession.accessToken,
          { skipAuthRefresh: true, authOperation: "delete_account", detached: true, timeoutMs: 8_000 }
        ).then(() => undefined)
      }
    ]);
    accountCleanupInProgressRef.current = false;
    setBusy(false);
    reportCleanupResult("account_deletion", result, ownerId);
    setMessage({
      text: result.complete
        ? "Hesabın ve uygulama verilerin silindi."
        : result.failedTargets.includes("server_account")
          ? "Bu cihazdaki oturum temizlendi; sunucudaki hesabın silindiği doğrulanamadı. Tekrar giriş yapıp hesap silmeyi yeniden deneyebilirsin."
          : "Bu cihazdaki hesap kapatıldı; bazı yerel silme adımları tamamlanamadı.",
      tone: result.complete ? "success" : "error"
    });
  }

  async function loadUniversities(): Promise<void> {
    const ownerSnapshot = accountGuardRef.current.capture();
    await withLoadable(setUniversities, () =>
      apiRequest<UniversityRecord[]>("/universities?limit=500&offset=0", {}, undefined, { ownerSnapshot })
    , ownerSnapshot);
  }

  async function loadFacultiesForRegistration(universityId: string): Promise<void> {
    if (!universityId) {
      setFaculties({ loading: false, data: [] });
      return;
    }

    const ownerSnapshot = accountGuardRef.current.capture();
    await withLoadable(setFaculties, () =>
      apiRequest<FacultyRecord[]>(`/universities/${universityId}/faculties`, {}, undefined, { ownerSnapshot })
    , ownerSnapshot);
  }

  async function loadDepartmentsForRegistration(facultyId: string): Promise<void> {
    if (!facultyId) {
      setDepartments({ loading: false, data: [] });
      return;
    }

    const ownerSnapshot = accountGuardRef.current.capture();
    await withLoadable(setDepartments, () =>
      apiRequest<DepartmentRecord[]>(`/faculties/${facultyId}/departments`, {}, undefined, { ownerSnapshot })
    , ownerSnapshot);
  }

  async function selectUniversity(universityId: string): Promise<void> {
    if (!accessToken) {
      setMessage({ text: "Üniversite bağlamak için önce giriş yapmalısın.", tone: "error" });
      return;
    }
    if (academicSelectionPendingRef.current || accountCleanupInProgressRef.current) return;

    try {
      academicSelectionPendingRef.current = "university";
      setAcademicSelectionPending("university");
      await trackAuthenticatedMutation(() => apiRequest<UserProfile>(
        "/me/university",
        {
          method: "PATCH",
          body: JSON.stringify({ universityId })
        },
        accessToken
      ));

      setSelectedUniversityId(universityId);
      setRegisterUniversityId(universityId);
      setRegisterFacultyId("");
      setRegisterDepartmentId("");
      setFacultySearch("");
      setDepartmentSearch("");
      setRegisterPicker("faculty");
      setAcademicProfileExpanded(true);
      setDepartments({ loading: false, data: [] });
      setSummerSchool({ loading: false });
      setMessage({ text: "Üniversite güncellendi.", tone: "success" });

      void Promise.allSettled([
        loadMyCalendar(accessToken),
        loadUpcoming(accessToken),
        loadAnnouncements(accessToken, universityId),
        loadPreferences(accessToken)
      ]);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      setMessage({
        text: userMessageFromError(error, "Üniversite seçimi güncellenemedi"),
        tone: "error"
      });
    } finally {
      academicSelectionPendingRef.current = null;
      setAcademicSelectionPending(null);
    }
  }

  async function selectFaculty(facultyId: string): Promise<void> {
    if (!accessToken || !registerUniversityId) {
      setMessage({ text: "Fakülte seçmek için önce üniversite seçmelisin.", tone: "error" });
      return;
    }
    if (academicSelectionPendingRef.current || accountCleanupInProgressRef.current) return;

    try {
      academicSelectionPendingRef.current = "faculty";
      setAcademicSelectionPending("faculty");
      await trackAuthenticatedMutation(() => apiRequest<UserProfile>(
        "/me/university",
        {
          method: "PATCH",
          body: JSON.stringify({ universityId: registerUniversityId, facultyId })
        },
        accessToken
      ));

      setRegisterFacultyId(facultyId);
      setRegisterDepartmentId("");
      setDepartmentSearch("");
      setRegisterPicker("department");
      setAcademicProfileExpanded(true);
      setSummerSchool({ loading: false });
      setMessage({ text: "Fakülte güncellendi.", tone: "success" });

      void loadAnnouncements(accessToken, registerUniversityId);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      setMessage({
        text: userMessageFromError(error, "Fakülte seçimi güncellenemedi"),
        tone: "error"
      });
    } finally {
      academicSelectionPendingRef.current = null;
      setAcademicSelectionPending(null);
    }
  }

  async function selectDepartment(departmentId: string): Promise<void> {
    if (!accessToken || !registerUniversityId || !registerFacultyId) {
      setMessage({ text: "Bölüm seçmek için önce üniversite ve fakülte seçmelisin.", tone: "error" });
      return;
    }
    if (academicSelectionPendingRef.current || accountCleanupInProgressRef.current) return;

    try {
      academicSelectionPendingRef.current = "department";
      setAcademicSelectionPending("department");
      await trackAuthenticatedMutation(() => apiRequest<UserProfile>(
        "/me/university",
        {
          method: "PATCH",
          body: JSON.stringify({
            universityId: registerUniversityId,
            facultyId: registerFacultyId,
            departmentId
          })
        },
        accessToken
      ));

      setRegisterDepartmentId(departmentId);
      setRegisterPicker("none");
      setSummerSchool({ loading: false });
      setMessage({ text: "Bölüm güncellendi.", tone: "success" });

      void loadAnnouncements(accessToken, registerUniversityId);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      setMessage({
        text: userMessageFromError(error, "Bölüm seçimi güncellenemedi"),
        tone: "error"
      });
    } finally {
      academicSelectionPendingRef.current = null;
      setAcademicSelectionPending(null);
    }
  }

  async function loadMyCalendar(
    tokenOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture()
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(
      setCalendar,
      () => apiRequest<CalendarPayload>("/calendar/my", {}, token, { ownerSnapshot }),
      ownerSnapshot
    );
  }

  async function loadUpcoming(
    tokenOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture()
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(
      setUpcoming,
      () => apiRequest<EventRecord[]>("/calendar/upcoming?limit=10", {}, token, { ownerSnapshot }),
      ownerSnapshot
    );
  }

  async function loadAnnouncements(
    tokenOverride?: string,
    universityIdOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture()
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    const universityId = universityIdOverride ?? registerUniversityId;
    if (!universityId) {
      setAnnouncements({ loading: false, data: [] });
      return;
    }

    await withLoadable(
      setAnnouncements,
      () => apiRequest<AnnouncementRecord[]>("/announcements/my?limit=60", {}, token, { ownerSnapshot }),
      ownerSnapshot
    );
  }

  async function loadYokAnnouncements(): Promise<void> {
    const ownerSnapshot = accountGuardRef.current.capture();
    await withLoadable(
      setYokAnnouncements,
      () => apiRequest<AnnouncementRecord[]>("/announcements/yok?limit=30", {}, undefined, { ownerSnapshot }),
      ownerSnapshot
    );
  }

  async function loadSummerSchool(
    tokenOverride?: string,
    universityIdOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture()
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    const universityId = universityIdOverride ?? registerUniversityId;
    if (!universityId) {
      setSummerSchool({ loading: false });
      return;
    }

    await withLoadable(
      setSummerSchool,
      () => apiRequest<SummerSchoolPayload>("/calendar/summer-school/my", {}, token, { ownerSnapshot }),
      ownerSnapshot
    );
  }

  async function loadPreferences(
    tokenOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture()
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(
      setPreferences,
      () => apiRequest<NotificationPreferencePayload>("/notification-preferences", {}, token, { ownerSnapshot }),
      ownerSnapshot
    );
  }

  async function authorizeGoogleCalendar(forceAccountSelection: boolean): Promise<{ accessToken: string; accountEmail: string }> {
    return enqueueGoogleSdkOperation(async () => {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      if (forceAccountSelection) await clearGoogleAccountSelection();
      let currentUser = GoogleSignin.getCurrentUser();
      if (!currentUser) {
        const signInResult = await GoogleSignin.signIn();
        if (isCancelledResponse(signInResult)) throw new Error("GOOGLE_CALENDAR_CANCELLED");
        currentUser = signInResult.data;
      }

      const scopeResult = await GoogleSignin.addScopes({
        scopes: [GOOGLE_CALENDAR_EVENTS_SCOPE]
      });
      if (scopeResult && isCancelledResponse(scopeResult)) throw new Error("GOOGLE_CALENDAR_CANCELLED");

      const tokens = await GoogleSignin.getTokens();
      const accountEmail = GoogleSignin.getCurrentUser()?.user.email ?? currentUser.user.email;
      if (!tokens.accessToken || !accountEmail) throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
      return { accessToken: tokens.accessToken, accountEmail };
    });
  }

  async function syncGoogleCalendar(forceAccountSelection = false): Promise<void> {
    if (accountCleanupInProgressRef.current) return;
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession?.accessToken || !ownerSnapshot) {
      setGoogleCalendarError("Google Takvim bağlantısı için yeniden giriş yapmalısın.");
      return;
    }

    const expectedAccountEmail = googleCalendarIntegration?.ownerId === currentSession.user.id
      ? googleCalendarIntegration.accountEmail.trim().toLowerCase()
      : null;
    if (forceAccountSelection && googleCalendarIntegration) {
      setGoogleCalendarIntegration(null);
      try {
        await enqueueStorageMutation(async () => {
          if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
          await persistGoogleCalendarConnection(null, currentSession.user.id);
        });
      } catch {
        setCleanupIssue({
          action: "data_deletion",
          failedTargets: ["google_connection_storage"],
          ownerId: currentSession.user.id
        });
        setGoogleCalendarError("Eski Google Takvim bağlantı kaydı temizlenemedi. Hesap değiştirme başlatılmadı.");
        return;
      }
    }

    setGoogleCalendarError(null);
    setMessage(null);
    setGoogleCalendarBusy(true);
    let googleAccessToken: string | undefined;
    const syncController = new AbortController();
    authenticatedRequestControllersRef.current.add(syncController);

    try {
      const authorization = await authorizeGoogleCalendar(forceAccountSelection);
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) {
        throw new StaleAccountRequestError();
      }
      if (
        !forceAccountSelection
        && expectedAccountEmail
        && authorization.accountEmail.trim().toLowerCase() !== expectedAccountEmail
      ) {
        setGoogleCalendarIntegration(null);
        try {
          await enqueueStorageMutation(async () => {
            if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
            await persistGoogleCalendarConnection(null, currentSession.user.id);
          });
        } catch {
          setCleanupIssue({
            action: "data_deletion",
            failedTargets: ["google_connection_storage"],
            ownerId: currentSession.user.id
          });
        }
        await queueGoogleSignOut();
        throw new Error("GOOGLE_CALENDAR_ACCOUNT_MISMATCH");
      }
      googleAccessToken = authorization.accessToken;
      const [calendarResult, announcementResult] = await Promise.allSettled([
        apiRequest<CalendarPayload>(
          "/calendar/my",
          { signal: syncController.signal },
          currentSession.accessToken,
          { ownerSnapshot }
        ),
        apiRequest<AnnouncementRecord[]>(
          "/announcements/my?limit=100",
          { signal: syncController.signal },
          currentSession.accessToken,
          { ownerSnapshot }
        )
      ]);
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      if (calendarResult.status === "rejected" && announcementResult.status === "rejected") {
        throw calendarResult.reason;
      }

      const calendarEvents = calendarResult.status === "fulfilled" ? calendarResult.value.events : [];
      const announcementItems = announcementResult.status === "fulfilled" ? announcementResult.value : [];
      const replaceSourceTypes: Array<"academic_event" | "announcement" | "event"> = [];
      const warnings: string[] = [];

      if (calendarResult.status === "fulfilled") {
        replaceSourceTypes.push("academic_event");
        setCalendar({ loading: false, data: calendarResult.value });
      } else {
        warnings.push("Akademik takvim kaynağı bu eşitlemede alınamadı.");
        setCalendar({
          loading: false,
          error: userMessageFromError(calendarResult.reason, "Akademik takvim şu anda alınamadı.")
        });
      }
      if (announcementResult.status === "fulfilled") {
        replaceSourceTypes.push("announcement", "event");
        setAnnouncements({ loading: false, data: announcementResult.value });
      } else {
        warnings.push("Duyuru ve etkinlik kaynakları bu eşitlemede alınamadı.");
        setAnnouncements({
          loading: false,
          error: userMessageFromError(announcementResult.reason, "Duyurular şu anda alınamadı.")
        });
      }

      const result = await googleCalendarService.sync({
        accessToken: authorization.accessToken,
        ownerId: currentSession.user.id,
        calendarEvents,
        announcements: announcementItems,
        replaceSourceTypes,
        signal: syncController.signal
      });
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      const connection: GoogleCalendarConnectionRecord = {
        ownerId: currentSession.user.id,
        accountEmail: authorization.accountEmail,
        lastSyncedAt: new Date().toISOString(),
        result,
        ...(warnings.length > 0 ? { warnings } : {})
      };
      setGoogleCalendarIntegration(connection);
      await enqueueStorageMutation(async () => {
        if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
        await persistGoogleCalendarConnection(connection);
      });
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();

      if (result.verified === 0) {
        setGoogleCalendarError("Profiline ait aktarılabilir akademik tarih, duyuru veya etkinlik bulunamadı.");
      } else {
        setMessage({
          text: `${result.verified} kayıt ${authorization.accountEmail} hesabının Google Takvimi'nde doğrulandı.`,
          tone: "success"
        });
      }
    } catch (error) {
      if (
        error instanceof StaleAccountRequestError
        || (error instanceof Error && error.name === "AbortError")
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
      ) {
        return;
      } else if (error instanceof Error && error.message === "GOOGLE_CALENDAR_CANCELLED") {
        setGoogleCalendarError("Google hesabı veya Takvim izni seçimi tamamlanmadı.");
      } else if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
        setGoogleCalendarError("Google hesabı veya Takvim izni seçimi tamamlanmadı.");
      } else if (isErrorWithCode(error) && error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setGoogleCalendarError("Google Play Hizmetleri bu cihazda hazır değil veya güncellenmeli.");
      } else if (isErrorWithCode(error) && error.code === statusCodes.IN_PROGRESS) {
        setGoogleCalendarError("Google hesabı seçimi zaten devam ediyor.");
      } else if (error instanceof Error && error.message === "GOOGLE_CALENDAR_ACCOUNT_MISMATCH") {
        setGoogleCalendarIntegration(null);
        setGoogleCalendarError("Google hesabı değişmiş. Devam etmek için hesabını yeniden seç.");
      } else {
        if (
          googleAccessToken
          && error instanceof GoogleCalendarSyncError
          && error.code === "GOOGLE_CALENDAR_AUTH_EXPIRED"
        ) {
          await enqueueGoogleSdkOperation(() => GoogleSignin.clearCachedAccessToken(googleAccessToken as string)).catch(() => null);
        }
        setGoogleCalendarError(googleCalendarUserMessage(error));
      }
    } finally {
      authenticatedRequestControllersRef.current.delete(syncController);
      if (accountGuardRef.current.isCurrent(ownerSnapshot)) setGoogleCalendarBusy(false);
    }
  }

  function updateCategory(category: string, enabled: boolean): void {
    setCategoryDraft((previous) => ({
      ...previous,
      [category]: enabled
    }));
  }

  function updateAlarmMode(mode: AlarmMode): void {
    setAlarmMode(mode);
    if (mode === "all_calendar") {
      const everythingOn: Record<string, boolean> = {};
      for (const category of availableCategories) everythingOn[category] = true;
      setCategoryDraft(everythingOn);
    }
  }

  async function saveAlarmSettings(): Promise<void> {
    if (!accessToken) {
      setMessage({ text: "Alarm ayarları için giriş yapmalısın.", tone: "error" });
      return;
    }
    if (accountCleanupInProgressRef.current) return;

    const categoryPayload: Record<string, boolean> = {};
    for (const category of availableCategories) {
      categoryPayload[category] = alarmMode === "all_calendar" ? true : Boolean(categoryDraft[category]);
    }

    const existing = preferences.data;
    const reminderOffsets = existing?.reminderOffsets.length ? existing.reminderOffsets : DEFAULT_REMINDER_OFFSETS;
    const reminderRules = existing?.reminderRules?.length ? existing.reminderRules : DEFAULT_REMINDER_RULES;

    try {
      setBusy(true);
      const updated = await trackAuthenticatedMutation(() => apiRequest<NotificationPreferencePayload>(
        "/notification-preferences",
        {
          method: "PATCH",
          body: JSON.stringify({
            enabled: alarmEnabled,
            categories: categoryPayload,
            reminderOffsets,
            reminderRules,
            quietHours: existing?.quietHours ?? {
              enabled: true,
              start: "22:00",
              end: "07:00",
              timezone: "Europe/Istanbul"
            }
          })
        },
        accessToken
      ));

      setPreferences({ loading: false, data: updated });
      setMessage({ text: "Alarm ayarları kaydedildi.", tone: "success" });
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      setMessage({
        text: userMessageFromError(error, "Alarm ayarları kaydedilemedi"),
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function openAnnouncement(link: string): Promise<void> {
    const supported = await Linking.canOpenURL(link);
    if (!supported) {
      setMessage({ text: "Bu bağlantı cihazda açılamıyor.", tone: "error" });
      return;
    }
    await Linking.openURL(link);
  }

  function renderAnnouncementCard(item: AnnouncementRecord) {
    return (
      <Pressable key={item.id} style={styles.announcementCard} onPress={() => void openAnnouncement(item.link)}>
        <View style={styles.announcementTopRow}>
          <Text style={styles.announcementSourcePill}>{item.sourceName}</Text>
          <Text style={styles.announcementDate}>{formatDateTimeShort(item.publishedAt)}</Text>
        </View>
        <Text style={styles.announcementTitle}>{item.title}</Text>
        {item.summary && <Text style={styles.announcementSummary}>{item.summary}</Text>}
        <View style={styles.announcementActionRow}>
          <Text style={styles.linkText}>{announcementOpenLabel(item)}</Text>
          <Ionicons name="open-outline" size={16} color="#2563eb" />
        </View>
      </Pressable>
    );
  }

  function addManualExam(): void {
    if (accountCleanupInProgressRef.current) return;
    if (!session || !manualExamsHydrated || manualExamOwnerId !== session.user.id) {
      setMessage({ text: "Hesaba ait sınav alanı henüz hazır değil.", tone: "error" });
      return;
    }
    if (!manualExamTitle.trim() || !manualExamDate.trim()) {
      setMessage({ text: "Sınav adı ve tarihi zorunludur.", tone: "error" });
      return;
    }

    const isoCandidate = new Date(manualExamDate.trim());
    if (Number.isNaN(isoCandidate.getTime())) {
      setMessage({ text: "Sınav tarihi hatalı. GG-AA-YYYY yerine YYYY-MM-DD kullan.", tone: "error" });
      return;
    }

    const record: ManualExamRecord = {
      id: createLocalId("manual-exam"),
      title: manualExamTitle.trim(),
      examDate: isoCandidate.toISOString()
    };

    setManualExams((previous) => [...previous, record]);
    setManualExamTitle("");
    setManualExamDate("");
    setMessage({ text: "Sınav geri sayımına eklendi.", tone: "success" });
  }

  if (rootSurface === "hydration_loading" || rootSurface === "hydration_error") {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea}>
          <StatusBar style="dark" />
          <View style={styles.hydrationContainer} accessibilityLiveRegion="polite">
            {rootSurface === "hydration_loading" ? (
              <>
                <ActivityIndicator size="large" color="#4338ca" />
                <Text style={styles.hydrationTitle}>Uygulama hazırlanıyor</Text>
                <Text style={styles.hydrationText}>Cihaz ve hesap bilgilerin güvenli biçimde yükleniyor.</Text>
              </>
            ) : (
              <>
                <Ionicons name="warning-outline" size={34} color="#b45309" />
                <Text style={styles.hydrationTitle}>Başlangıç tamamlanamadı</Text>
                <Text style={styles.hydrationText}>{hydrationError}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Başlangıcı tekrar dene"
                  style={[styles.button, styles.primaryButton, styles.hydrationRetryButton]}
                  onPress={() => void hydrateApplication()}
                >
                  <Text style={styles.primaryButtonText}>Tekrar Dene</Text>
                </Pressable>
              </>
            )}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView
          contentContainerStyle={[styles.container, session ? styles.containerWithNav : undefined]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          {!session && (
            <View style={styles.authHero}>
              <Text style={styles.authHeroTitle}>Akademik Takvimine Hoş Geldin</Text>
              <Text style={styles.authHeroSubtitle}>Sınavlarını ve duyurularını tek yerden takip et, tarihler kaçmasın.</Text>
            </View>
          )}

          {message && (
            <View style={[styles.messageBox, message.tone === "error" ? styles.errorBox : message.tone === "success" ? styles.successBox : styles.infoBox]}>
              <Text style={styles.messageText}>{message.text}</Text>
            </View>
          )}

          {cleanupIssue && (
            <View style={styles.cleanupIssueCard} accessibilityLiveRegion="polite">
              <Text style={styles.cleanupIssueTitle}>Tamamlanamayan güvenli temizlik</Text>
              <Text style={styles.cleanupIssueText}>
                {cleanupIssue.failedTargets.map(cleanupTargetLabel).join(", ")}
              </Text>
              {cleanupIssue.failedTargets.some(
                (target) => target !== "server_session" && target !== "server_account"
              ) && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cihaz temizliğini tekrar dene"
                  style={[styles.button, styles.secondaryButton, (busy || googleBusy) && styles.buttonDisabled]}
                  onPress={() => void retryFailedCleanup()}
                  disabled={busy || googleBusy}
                >
                  <Text style={styles.secondaryButtonText}>Temizliği Tekrar Dene</Text>
                </Pressable>
              )}
            </View>
          )}

          {!session && authStage === "auth" && (
            <Section title="Giriş ve Kayıt">
              <View style={styles.row}>
                <Pressable
                  style={[
                    styles.modeButton,
                    authMode === "login" && styles.modeButtonActive,
                    (busy || googleBusy) && styles.buttonDisabled
                  ]}
                  onPress={() => {
                    setAuthMode("login");
                    setAuthStage("auth");
                  }}
                  disabled={busy || googleBusy}
                >
                  <Text style={[styles.modeButtonText, authMode === "login" && styles.modeButtonTextActive]}>Giriş Yap</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modeButton,
                    authMode === "register" && styles.modeButtonActive,
                    (busy || googleBusy) && styles.buttonDisabled
                  ]}
                  onPress={() => {
                    setAuthMode("register");
                    setAuthStage("auth");
                  }}
                  disabled={busy || googleBusy}
                >
                  <Text style={[styles.modeButtonText, authMode === "register" && styles.modeButtonTextActive]}>Kayıt Ol</Text>
                </Pressable>
              </View>

              {GOOGLE_AUTH_CONFIGURED ? (
                <Pressable
                  style={[styles.button, styles.googleButton, (busy || googleBusy) && styles.buttonDisabled]}
                  onPress={() => void handleGoogleAuth()}
                  disabled={busy || googleBusy}
                >
                  <Ionicons name="logo-google" size={19} color="#1f2937" />
                  <Text style={styles.googleButtonText}>{googleBusy ? "Google açılıyor..." : "Google ile Devam Et"}</Text>
                </Pressable>
              ) : (
                <View style={styles.inlineInfoCard}>
                  <Text style={styles.inlineInfoTitle}>Google ile giriş bu APK'da kapalı</Text>
                  <Text style={styles.inlineInfoText}>{GOOGLE_AUTH_CONFIGURATION_MESSAGE}</Text>
                </View>
              )}

              {authMode === "register" ? (
                <>
                  <View style={styles.progressRow}>
                    <View style={[styles.progressChip, registerIdentityReady && styles.progressChipDone]}>
                      <Text style={[styles.progressChipText, registerIdentityReady && styles.progressChipTextDone]}>Profil</Text>
                    </View>
                    <View style={styles.progressChip}>
                      <Text style={styles.progressChipText}>Doğrulama</Text>
                    </View>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Ad Soyad</Text>
                    <TextInput
                      value={fullName}
                      onChangeText={setFullName}
                      placeholder="Ad Soyad"
                      placeholderTextColor={AUTH_INPUT_PLACEHOLDER_COLOR}
                      textContentType="name"
                      autoComplete="name"
                      style={styles.input}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>E-posta adresi</Text>
                    <TextInput
                      value={email}
                      onChangeText={setEmail}
                      placeholder="ornek@email.com"
                      placeholderTextColor={AUTH_INPUT_PLACEHOLDER_COLOR}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="emailAddress"
                      autoComplete="email"
                      style={styles.input}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Şifre</Text>
                    <View style={styles.passwordInputShell}>
                      <TextInput
                        accessibilityLabel="Yeni şifre"
                        value={password}
                        onChangeText={setPassword}
                        placeholder={`En az ${AUTH_PASSWORD_MIN_LENGTH} karakter`}
                        placeholderTextColor={AUTH_INPUT_PLACEHOLDER_COLOR}
                        secureTextEntry={!passwordVisible}
                        textContentType="newPassword"
                        autoComplete="new-password"
                        style={[styles.input, styles.passwordInput]}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={passwordVisible ? "Şifreyi gizle" : "Şifreyi göster"}
                        style={styles.passwordVisibilityButton}
                        onPress={() => setPasswordVisible((visible) => !visible)}
                      >
                        <Ionicons name={passwordVisible ? "eye-off-outline" : "eye-outline"} size={21} color="#475569" />
                      </Pressable>
                    </View>
                  </View>

                  <Text style={styles.helperText}>Kayıt yalnızca hesap bilgileriyle tamamlanır. Üniversite, fakülte ve bölümünü uygulama içinde seçebilirsin.</Text>

                  <Pressable
                    style={[
                      styles.button,
                      styles.primaryButton,
                      (busy || googleBusy || !registerIdentityReady) && styles.buttonDisabled
                    ]}
                    onPress={() => void handleAuth()}
                    disabled={busy || googleBusy || !registerIdentityReady}
                  >
                    <Text style={styles.primaryButtonText}>Hesap Oluştur</Text>
                  </Pressable>
                  {!registerIdentityReady && (
                    <Text style={styles.caption}>Ad soyad ve e-posta alanlarını doldur; şifren en az {AUTH_PASSWORD_MIN_LENGTH} karakter olsun.</Text>
                  )}

                  <View style={styles.inlineInfoCard}>
                    <Text style={styles.inlineInfoTitle}>Sonraki adım: E-posta doğrulama</Text>
                    <Text style={styles.inlineInfoText}>Hesap oluşturduktan sonra seni ayrıca doğrulama ekranına yönlendireceğiz.</Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>E-posta adresi</Text>
                    <TextInput
                      value={email}
                      onChangeText={setEmail}
                      placeholder="ornek@email.com"
                      placeholderTextColor={AUTH_INPUT_PLACEHOLDER_COLOR}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="emailAddress"
                      autoComplete="email"
                      style={styles.input}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Şifre</Text>
                    <View style={styles.passwordInputShell}>
                      <TextInput
                        accessibilityLabel="Şifre"
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Şifreni gir"
                        placeholderTextColor={AUTH_INPUT_PLACEHOLDER_COLOR}
                        secureTextEntry={!passwordVisible}
                        textContentType="password"
                        autoComplete="password"
                        style={[styles.input, styles.passwordInput]}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={passwordVisible ? "Şifreyi gizle" : "Şifreyi göster"}
                        style={styles.passwordVisibilityButton}
                        onPress={() => setPasswordVisible((visible) => !visible)}
                      >
                        <Ionicons name={passwordVisible ? "eye-off-outline" : "eye-outline"} size={21} color="#475569" />
                      </Pressable>
                    </View>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Şifremi unuttum"
                    style={[styles.textActionButton, (busy || googleBusy) && styles.buttonDisabled]}
                    onPress={() => openPasswordRecovery()}
                    disabled={busy || googleBusy}
                  >
                    <Text style={styles.textActionText}>Şifremi unuttum</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="E-posta doğrulamasına devam et"
                    style={[styles.textActionButton, (!email.trim() || busy || googleBusy) && styles.buttonDisabled]}
                    onPress={() => void openVerificationRecovery()}
                    disabled={!email.trim() || busy || googleBusy}
                  >
                    <Text style={styles.textActionText}>E-postamı doğrula</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.button, styles.primaryButton, (busy || googleBusy || !loginReady) && styles.buttonDisabled]}
                    onPress={() => void handleAuth()}
                    disabled={busy || googleBusy || !loginReady}
                  >
                    <Text style={styles.primaryButtonText}>Giriş Yap</Text>
                  </Pressable>
                  {!loginReady && (
                    <Text style={styles.caption}>Giriş yapmak için e-posta ve şifre alanlarını doldur.</Text>
                  )}
                </>
              )}
            </Section>
          )}

          {!session && authStage === "password_recovery_request" && (
            <Section title="Şifre Kurtarma">
              <View style={styles.verificationCard}>
                <Text style={styles.verificationTitle}>Sıfırlama kodu iste</Text>
                <Text style={styles.verificationSubtitle}>
                  E-posta adresini gir. Hesap uygunsa altı haneli sıfırlama kodu gönderilir.
                </Text>

                {passwordRecoveryFeedback && (
                  <View
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.passwordRecoveryFeedback,
                      passwordRecoveryFeedback.tone === "error"
                        ? styles.passwordRecoveryFeedbackError
                        : passwordRecoveryFeedback.tone === "success"
                          ? styles.passwordRecoveryFeedbackSuccess
                          : styles.passwordRecoveryFeedbackInfo
                    ]}
                  >
                    <Text style={styles.passwordRecoveryFeedbackText}>{passwordRecoveryFeedback.text}</Text>
                  </View>
                )}

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>E-posta adresi</Text>
                  <TextInput
                    accessibilityLabel="Şifre kurtarma e-posta adresi"
                    value={email}
                    onChangeText={(value) => {
                      setEmail(value);
                      setPasswordRecoveryFeedback(null);
                    }}
                    placeholder="ornek@email.com"
                    placeholderTextColor={AUTH_INPUT_PLACEHOLDER_COLOR}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="emailAddress"
                    autoComplete="email"
                    editable={!busy}
                    style={styles.input}
                  />
                </View>

                {!passwordRecoveryRequestReady && (
                  <Text style={styles.caption}>Devam etmek için geçerli bir e-posta adresi gir.</Text>
                )}

                {pendingPasswordRecovery?.email === email.trim().toLowerCase() && passwordRecoveryTiming && (
                  <View style={styles.verificationTimingCard} accessibilityLiveRegion="polite">
                    <Text style={styles.verificationTimingText}>
                      {passwordRecoveryTiming.resendInSeconds > 0
                        ? `Yeni kod isteyebilme: ${formatDuration(passwordRecoveryTiming.resendInSeconds)}`
                        : "Yeni kod isteyebilirsin."}
                    </Text>
                  </View>
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Şifre sıfırlama kodu iste"
                  accessibilityState={{
                    disabled: busy
                      || !passwordRecoveryRequestReady
                      || Boolean(
                        pendingPasswordRecovery?.email === email.trim().toLowerCase()
                        && passwordRecoveryTiming?.resendInSeconds
                      ),
                    busy
                  }}
                  style={[
                    styles.button,
                    styles.primaryButton,
                    (
                      busy
                      || !passwordRecoveryRequestReady
                      || Boolean(
                        pendingPasswordRecovery?.email === email.trim().toLowerCase()
                        && passwordRecoveryTiming?.resendInSeconds
                      )
                    ) && styles.buttonDisabled
                  ]}
                  onPress={() => void requestPasswordRecovery()}
                  disabled={
                    busy
                    || !passwordRecoveryRequestReady
                    || Boolean(
                      pendingPasswordRecovery?.email === email.trim().toLowerCase()
                      && passwordRecoveryTiming?.resendInSeconds
                    )
                  }
                >
                  {busy && <ActivityIndicator size="small" color="#ffffff" />}
                  <Text style={styles.primaryButtonText}>
                    {busy ? "Kod isteniyor..." : pendingPasswordRecovery ? "Yeni Kod İste" : "Kodu İste"}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Şifre kurtarmayı iptal et ve giriş ekranına dön"
                  style={[styles.textActionButton, busy && styles.buttonDisabled]}
                  onPress={cancelPasswordRecovery}
                  disabled={busy}
                >
                  <Text style={styles.textActionText}>İptal et ve giriş ekranına dön</Text>
                </Pressable>
              </View>
            </Section>
          )}

          {!session && authStage === "password_recovery_confirm" && (
            <Section title="Şifre Kurtarma">
              <View style={styles.verificationCard}>
                <Text style={styles.verificationTitle}>Yeni şifreni belirle</Text>
                <Text style={styles.verificationSubtitle}>
                  {pendingPasswordRecovery?.email} adresine gönderilen altı haneli kodu ve yeni şifreni gir.
                </Text>

                {passwordRecoveryFeedback && (
                  <View
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.passwordRecoveryFeedback,
                      passwordRecoveryFeedback.tone === "error"
                        ? styles.passwordRecoveryFeedbackError
                        : passwordRecoveryFeedback.tone === "success"
                          ? styles.passwordRecoveryFeedbackSuccess
                          : styles.passwordRecoveryFeedbackInfo
                    ]}
                  >
                    <Text style={styles.passwordRecoveryFeedbackText}>{passwordRecoveryFeedback.text}</Text>
                  </View>
                )}

                {passwordRecoveryTiming && (
                  <View style={styles.verificationTimingCard} accessibilityLiveRegion="polite">
                    <Text style={styles.verificationTimingText}>
                      {passwordRecoveryTiming.expired
                        ? "Sıfırlama kodunun süresi doldu. Yeni bir kod iste."
                        : `Kodun kalan süresi: ${formatDuration(passwordRecoveryTiming.expiresInSeconds)}`}
                    </Text>
                    <Text style={styles.verificationTimingText}>
                      {passwordRecoveryTiming.resendInSeconds > 0
                        ? `Yeni kod isteyebilme: ${formatDuration(passwordRecoveryTiming.resendInSeconds)}`
                        : "Yeni kod isteyebilirsin."}
                    </Text>
                  </View>
                )}

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Sıfırlama kodu</Text>
                  <TextInput
                    accessibilityLabel="Altı haneli şifre sıfırlama kodu"
                    value={passwordRecoveryCode}
                    onChangeText={(value) => {
                      setPasswordRecoveryCode(value.replace(/\D/g, ""));
                      setPasswordRecoveryFeedback(null);
                    }}
                    placeholder="000000"
                    placeholderTextColor={AUTH_INPUT_PLACEHOLDER_COLOR}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    maxLength={PASSWORD_RECOVERY_CODE_LENGTH}
                    editable={!busy}
                    style={styles.input}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Yeni şifre</Text>
                  <View style={styles.passwordInputShell}>
                    <TextInput
                      accessibilityLabel="Yeni şifre"
                      value={newPassword}
                      onChangeText={(value) => {
                        setNewPassword(value);
                        setPasswordRecoveryFeedback(null);
                      }}
                      placeholder={`En az ${AUTH_PASSWORD_MIN_LENGTH} karakter`}
                      placeholderTextColor={AUTH_INPUT_PLACEHOLDER_COLOR}
                      secureTextEntry={!newPasswordVisible}
                      textContentType="newPassword"
                      autoComplete="new-password"
                      editable={!busy}
                      style={[styles.input, styles.passwordInput]}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={newPasswordVisible ? "Yeni şifreyi gizle" : "Yeni şifreyi göster"}
                      accessibilityState={{ disabled: busy }}
                      style={[styles.passwordVisibilityButton, busy && styles.buttonDisabled]}
                      onPress={() => setNewPasswordVisible((visible) => !visible)}
                      disabled={busy}
                    >
                      <Ionicons name={newPasswordVisible ? "eye-off-outline" : "eye-outline"} size={21} color="#475569" />
                    </Pressable>
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Yeni şifre tekrarı</Text>
                  <View style={styles.passwordInputShell}>
                    <TextInput
                      accessibilityLabel="Yeni şifre tekrarı"
                      value={passwordConfirmation}
                      onChangeText={(value) => {
                        setPasswordConfirmation(value);
                        setPasswordRecoveryFeedback(null);
                      }}
                      placeholder="Yeni şifreni tekrar gir"
                      placeholderTextColor={AUTH_INPUT_PLACEHOLDER_COLOR}
                      secureTextEntry={!passwordConfirmationVisible}
                      textContentType="newPassword"
                      autoComplete="new-password"
                      editable={!busy}
                      style={[styles.input, styles.passwordInput]}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={passwordConfirmationVisible ? "Şifre tekrarını gizle" : "Şifre tekrarını göster"}
                      accessibilityState={{ disabled: busy }}
                      style={[styles.passwordVisibilityButton, busy && styles.buttonDisabled]}
                      onPress={() => setPasswordConfirmationVisible((visible) => !visible)}
                      disabled={busy}
                    >
                      <Ionicons name={passwordConfirmationVisible ? "eye-off-outline" : "eye-outline"} size={21} color="#475569" />
                    </Pressable>
                  </View>
                </View>

                {!passwordRecoveryConfirmationValidation.valid && (
                  <Text style={styles.passwordRecoveryValidationText} accessibilityLiveRegion="polite">
                    {passwordRecoveryConfirmationValidation.message}
                  </Text>
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Şifre sıfırlamayı tamamla"
                  accessibilityState={{ disabled: busy || !passwordRecoveryConfirmReady, busy }}
                  style={[
                    styles.button,
                    styles.primaryButton,
                    (busy || !passwordRecoveryConfirmReady) && styles.buttonDisabled
                  ]}
                  onPress={() => void confirmPasswordRecovery()}
                  disabled={busy || !passwordRecoveryConfirmReady}
                >
                  {busy && <ActivityIndicator size="small" color="#ffffff" />}
                  <Text style={styles.primaryButtonText}>{busy ? "Şifre yenileniyor..." : "Şifreyi Yenile"}</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Yeni şifre sıfırlama kodu iste"
                  accessibilityState={{ disabled: busy || Boolean(passwordRecoveryTiming?.resendInSeconds), busy }}
                  style={[
                    styles.button,
                    styles.secondaryButton,
                    (busy || Boolean(passwordRecoveryTiming?.resendInSeconds)) && styles.buttonDisabled
                  ]}
                  onPress={() => void requestPasswordRecovery()}
                  disabled={busy || Boolean(passwordRecoveryTiming?.resendInSeconds)}
                >
                  <Text style={styles.secondaryButtonText}>
                    {passwordRecoveryTiming?.resendInSeconds
                      ? `Yeni Kod İste (${formatDuration(passwordRecoveryTiming.resendInSeconds)})`
                      : "Yeni Kod İste"}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Şifre kurtarma e-posta adımına dön"
                  style={[styles.textActionButton, busy && styles.buttonDisabled]}
                  onPress={returnToPasswordRecoveryRequest}
                  disabled={busy}
                >
                  <Text style={styles.textActionText}>Geri</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Şifre kurtarmayı iptal et ve giriş ekranına dön"
                  style={[styles.textActionButton, busy && styles.buttonDisabled]}
                  onPress={cancelPasswordRecovery}
                  disabled={busy}
                >
                  <Text style={styles.textActionText}>İptal et ve giriş ekranına dön</Text>
                </Pressable>
              </View>
            </Section>
          )}

          {!session && authStage === "verify" && (
            <Section title="E-posta Doğrulama">
              <View style={styles.progressRow}>
                <View style={[styles.progressChip, styles.progressChipDone]}>
                  <Text style={[styles.progressChipText, styles.progressChipTextDone]}>Profil</Text>
                </View>
                <View style={[styles.progressChip, styles.progressChipDone]}>
                  <Text style={[styles.progressChipText, styles.progressChipTextDone]}>Doğrulama</Text>
                </View>
              </View>

              <View style={styles.verificationCard}>
                <Text style={styles.verificationTitle}>Kodunu Gir</Text>
                <Text style={styles.verificationSubtitle}>{email.trim().toLowerCase()} adresine gönderilen kodu girerek devam et.</Text>

                {verificationTiming && (
                  <View style={styles.verificationTimingCard} accessibilityLiveRegion="polite">
                    <Text style={styles.verificationTimingText}>
                      {verificationTiming.expired
                        ? "Kodun süresi doldu. Yeni bir kod iste."
                        : `Kodun kalan süresi: ${formatDuration(verificationTiming.expiresInSeconds)}`}
                    </Text>
                    <Text style={styles.verificationTimingText}>
                      {verificationTiming.resendInSeconds > 0
                        ? `Yeni kod isteyebilme: ${formatDuration(verificationTiming.resendInSeconds)}`
                        : "Yeni kod isteyebilirsin."}
                    </Text>
                  </View>
                )}

                <TextInput
                  accessibilityLabel="Dört haneli doğrulama kodu"
                  value={verificationToken}
                  onChangeText={setVerificationToken}
                  placeholder="Doğrulama kodu"
                  placeholderTextColor={AUTH_INPUT_PLACEHOLDER_COLOR}
                  keyboardType="number-pad"
                  maxLength={4}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />

                <Pressable
                  accessibilityRole="button"
                  style={[styles.button, styles.primaryButton, (busy || verificationToken.trim().length !== 4) && styles.buttonDisabled]}
                  onPress={() => void handleVerifyEmail()}
                  disabled={busy || verificationToken.trim().length !== 4}
                >
                  <Text style={styles.primaryButtonText}>Doğrulamayı Tamamla</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  style={[
                    styles.button,
                    styles.secondaryButton,
                    (busy || Boolean(verificationTiming?.resendInSeconds)) && styles.buttonDisabled
                  ]}
                  onPress={() => void resendVerificationEmail()}
                  disabled={busy || Boolean(verificationTiming?.resendInSeconds)}
                >
                  <Text style={styles.secondaryButtonText}>
                    {verificationTiming?.resendInSeconds
                      ? `Tekrar Gönder (${formatDuration(verificationTiming.resendInSeconds)})`
                      : "Kodu Tekrar Gönder"}
                  </Text>
                </Pressable>

                <Pressable style={styles.textActionButton} onPress={returnToLoginForm} disabled={busy}>
                  <Text style={styles.textActionText}>Giriş ekranına dön</Text>
                </Pressable>
              </View>
            </Section>
          )}

          {!session && authStage === "profile_confirm" && (
            <Section title="Profilini Onayla">
              <View style={styles.progressRow}>
                <View style={[styles.progressChip, styles.progressChipDone]}>
                  <Text style={[styles.progressChipText, styles.progressChipTextDone]}>Profil</Text>
                </View>
                <View style={[styles.progressChip, styles.progressChipDone]}>
                  <Text style={[styles.progressChipText, styles.progressChipTextDone]}>Doğrulama</Text>
                </View>
              </View>

              <Text style={styles.helperText}>
                E-posta doğrulaman tamamlandı. Akademik profilini giriş yaptıktan sonra içeride seçeceksin.
              </Text>

              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryKey}>Ad Soyad</Text>
                  <Text style={styles.summaryValue}>{fullName || "-"}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryKey}>E-posta</Text>
                  <Text style={styles.summaryValue}>{email.trim().toLowerCase() || "-"}</Text>
                </View>
              </View>

              <Pressable style={[styles.button, styles.primaryButton, busy && styles.buttonDisabled]} onPress={() => void confirmProfileAndStart()} disabled={busy}>
                <Text style={styles.primaryButtonText}>{password.length > 0 ? "Giriş Yap ve Başla" : "Giriş Ekranına Geç"}</Text>
              </Pressable>

              <Pressable style={styles.textActionButton} onPress={returnToLoginForm} disabled={busy}>
                <Text style={styles.textActionText}>Giriş ekranına dön</Text>
              </Pressable>
            </Section>
          )}

          {session && activeTab === "home" && (
            <>
              <View style={styles.homeHero}>
                <View style={styles.rowBetween}>
                  <View style={styles.flexOne}>
                    <Text style={styles.homeHeroEyebrow}>Merhaba {session.user.fullName.split(" ")[0] || "öğrenci"}</Text>
                    <Text style={styles.homeHeroTitle}>Bugün neyi kaçırmamalısın?</Text>
                    <Text style={styles.homeHeroSubtitle}>
                      Sınav, duyuru ve takvim bağlantılarını tek ekranda takip et.
                    </Text>
                  </View>
                  <View style={styles.homeHeroIcon}>
                    <Ionicons name="school-outline" size={28} color="#0f766e" />
                  </View>
                </View>
                <View style={styles.homeStatsRow}>
                  <View style={styles.homeStatItem}>
                    <Text style={styles.homeStatValue}>{todayEventCount}</Text>
                    <Text style={styles.homeStatLabel}>Bugün</Text>
                  </View>
                  <View style={styles.homeStatItem}>
                    <Text style={styles.homeStatValue}>{examCountdownItems.length}</Text>
                    <Text style={styles.homeStatLabel}>Sınav</Text>
                  </View>
                  <View style={styles.homeStatItem}>
                    <Text style={styles.homeStatValue}>{announcementFeed.length}</Text>
                    <Text style={styles.homeStatLabel}>Duyuru</Text>
                  </View>
                </View>
              </View>

              <View style={styles.quickActionGrid}>
                <Pressable style={styles.quickActionCard} onPress={() => setActiveTab("calendar")}>
                  <Ionicons name="calendar-outline" size={20} color="#2563eb" />
                  <Text style={styles.quickActionTitle}>Takvimi aç</Text>
                  <Text style={styles.quickActionText}>{googleCalendarIntegration ? `${googleCalendarIntegration.result.verified} kayıt eşitlendi` : "Google Takvim'e bağla"}</Text>
                </Pressable>
                <Pressable style={styles.quickActionCard} onPress={() => setActiveTab("announcements")}>
                  <Ionicons name="notifications-outline" size={20} color="#b45309" />
                  <Text style={styles.quickActionTitle}>Duyurular</Text>
                  <Text style={styles.quickActionText}>Resmi kaynakları kontrol et</Text>
                </Pressable>
                <Pressable style={styles.quickActionCard} onPress={() => setActiveTab("summer")}>
                  <Ionicons name="sunny-outline" size={20} color="#ea580c" />
                  <Text style={styles.quickActionTitle}>Yaz Okulu</Text>
                  <Text style={styles.quickActionText}>Başvuru ve ders alma fırsatları</Text>
                </Pressable>
                <Pressable style={styles.quickActionCard} onPress={() => setActiveTab("yok")}>
                  <Ionicons name="newspaper-outline" size={20} color="#0f766e" />
                  <Text style={styles.quickActionTitle}>YÖK</Text>
                  <Text style={styles.quickActionText}>Ulusal duyuruları takip et</Text>
                </Pressable>
              </View>

              <Section title="Sınav Odağı">
                <Text style={styles.helperText}>Yaklaşan sınavlarını gör, kişisel sınavını ekle ve takvimini canlı tut.</Text>

                {examCountdownItems.length === 0 && (
                  <View style={styles.emptyStatePanel}>
                    <Ionicons name="checkmark-circle-outline" size={24} color="#16a34a" />
                    <Text style={styles.emptyStateTitle}>Yaklaşan sınav görünmüyor</Text>
                    <Text style={styles.caption}>Takvim yüklendiğinde sınavlar burada geri sayımla görünecek.</Text>
                    </View>
                )}

                {nextExam && (
                  <View style={styles.focusCard}>
                    <Text style={styles.eventCategory}>Sıradaki sınav</Text>
                    <Text style={styles.eventTitle}>{nextExam.title}</Text>
                    <Text style={styles.countdownBadge}>{formatRemainingDuration(nextExam.examDate)}</Text>
                    <Text style={styles.caption}>{formatDateTimeShort(nextExam.examDate)}</Text>
                  </View>
                )}

                {examCountdownItems.slice(nextExam ? 1 : 0, nextExam ? 4 : 3).map((exam) => (
                  <View key={exam.id} style={styles.eventCard}>
                    <Text style={styles.eventTitle}>{exam.title}</Text>
                    <Text style={styles.countdownBadge}>{formatRemainingDuration(exam.examDate)}</Text>
                    <Text style={styles.caption}>{formatDateTimeShort(exam.examDate)}</Text>
                  </View>
                ))}

                <TextInput
                  value={manualExamTitle}
                  onChangeText={setManualExamTitle}
                  placeholder="Sınav adı"
                  style={styles.input}
                />
                <TextInput
                  value={manualExamDate}
                  onChangeText={setManualExamDate}
                  placeholder="Sınav tarihi (YYYY-MM-DD)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
                <Pressable style={[styles.button, styles.secondaryButton]} onPress={addManualExam} disabled={busy}>
                  <Text style={styles.secondaryButtonText}>Sınav Ekle</Text>
                </Pressable>
              </Section>

              <Section title="Yaklaşan Etkinlikler">
                <View style={styles.rowBetween}>
                  <View style={styles.flexOne}>
                    <Text style={styles.helperText}>Akademik takvimden yaklaşan kritik tarihleri takip et.</Text>
                  </View>
                  <Pressable style={[styles.iconButton, (upcoming.loading || busy) && styles.buttonDisabled]} onPress={() => void loadUpcoming()} disabled={upcoming.loading || busy}>
                    <Ionicons name="refresh-outline" size={18} color="#1e293b" />
                  </Pressable>
                </View>

                {upcoming.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                {upcoming.error && <Text style={styles.errorText}>{upcoming.error}</Text>}

                {nextUpcomingEvent && (
                  <View style={styles.eventHighlightRow}>
                    <View style={styles.eventDateBadge}>
                      <Text style={styles.eventDateBadgeText}>{formatDateShort(nextUpcomingEvent.startDate)}</Text>
                    </View>
                    <View style={styles.flexOne}>
                      <Text style={styles.eventTitle}>{nextUpcomingEvent.title}</Text>
                      <Text style={styles.caption}>{toCategoryLabel(nextUpcomingEvent.category)}</Text>
                    </View>
                  </View>
                )}

                {(upcoming.data ?? []).filter((event) => event.id !== nextUpcomingEvent?.id).map((event) => (
                  <View key={event.id} style={styles.eventCard}>
                    <Text style={styles.eventTitle}>{event.title}</Text>
                    <Text style={styles.caption}>{formatDateShort(event.startDate)}</Text>
                  </View>
                ))}
              </Section>
            </>
          )}

          {session && activeTab === "calendar" && (
            <>
              <Section title="Takvim Özeti">
                <View style={styles.rowBetween}>
                  <View style={styles.flexOne}>
                    <Text style={styles.cardTitle}>{calendar.data?.calendar?.title ?? "Akademik takvim"}</Text>
                    <Text style={styles.caption}>
                      {calendar.data?.calendar?.academicYear ? `Akademik yıl: ${calendar.data.calendar.academicYear}` : "Takvim henüz yüklenmedi"}
                    </Text>
                  </View>
                  <Pressable style={[styles.iconButton, busy && styles.buttonDisabled]} onPress={() => void loadMyCalendar()} disabled={busy}>
                    <Ionicons name="refresh-outline" size={18} color="#1e293b" />
                  </Pressable>
                </View>

                {calendar.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                {calendar.error && <Text style={styles.errorText}>{calendar.error}</Text>}

                <View style={styles.calendarMiniGrid}>
                  <View style={styles.calendarMiniCard}>
                    <Text style={styles.calendarMiniValue}>{(calendar.data?.events ?? []).length}</Text>
                    <Text style={styles.calendarMiniLabel}>Tarih</Text>
                  </View>
                  <View style={styles.calendarMiniCard}>
                    <Text style={styles.calendarMiniValue}>{calendar.data?.calendar.status ? STATUS_LABELS[calendar.data.calendar.status] ?? calendar.data.calendar.status : "-"}</Text>
                    <Text style={styles.calendarMiniLabel}>Durum</Text>
                  </View>
                </View>
              </Section>

              <Section title="Google Takvim">
                <View style={styles.calendarConnectionHero}>
                  <View style={styles.calendarPanelIcon}>
                    <Ionicons name="logo-google" size={24} color="#2563eb" />
                  </View>
                  <View style={styles.flexOne}>
                    <Text style={styles.cardTitle}>Akademik bilgilerini Google Takvim'e eşitle</Text>
                    <Text style={styles.caption}>
                      {googleCalendarIntegration
                        ? googleCalendarIntegration.accountEmail
                        : "Takvim hesabını sen seçersin"}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, googleCalendarIntegration ? styles.statusPillSuccess : styles.statusPillNeutral]}>
                    <Text style={[styles.statusPillText, googleCalendarIntegration ? styles.statusPillTextSuccess : styles.statusPillTextNeutral]}>
                      {googleCalendarIntegration ? "Bağlı" : "Bağlı değil"}
                    </Text>
                  </View>
                </View>

                <Text style={styles.calendarConnectionNote}>
                  Hedef: Seçtiğin Gmail hesabının birincil Google Takvimi. Uygulama yalnızca kendi eklediği kayıtları günceller veya kaldırır; kişisel etkinliklerine dokunmaz.
                </Text>

                {googleCalendarError && (
                  <View style={styles.calendarErrorPanel}>
                    <Ionicons name="alert-circle-outline" size={20} color="#be123c" />
                    <Text style={styles.calendarErrorText}>{googleCalendarError}</Text>
                  </View>
                )}

                <View style={styles.calendarExplainPanel}>
                  <View style={styles.calendarExplainStep}>
                    <Text style={styles.calendarExplainNumber}>1</Text>
                    <Text style={styles.calendarExplainText}>Kullanmak istediğin Gmail hesabını seç.</Text>
                  </View>
                  <View style={styles.calendarExplainStep}>
                    <Text style={styles.calendarExplainNumber}>2</Text>
                    <Text style={styles.calendarExplainText}>Google Takvim'e etkinlik ekleme izni ver.</Text>
                  </View>
                  <View style={styles.calendarExplainStep}>
                    <Text style={styles.calendarExplainNumber}>3</Text>
                    <Text style={styles.calendarExplainText}>Akademik tarihler, duyurular ve etkinlikler gönderilip Google'da doğrulanır.</Text>
                  </View>
                </View>

                {googleCalendarIntegration && (
                  <View style={styles.calendarSyncSummary}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.calendarSyncSummaryLabel}>Google'da doğrulanan</Text>
                      <Text style={styles.calendarSyncSummaryValue}>{googleCalendarIntegration.result.verified}</Text>
                    </View>
                    <Text style={styles.caption}>
                      Son eşitleme: {formatDateTimeShort(googleCalendarIntegration.lastSyncedAt)}
                    </Text>
                    <Text style={styles.caption}>
                      {googleCalendarIntegration.result.created} yeni, {googleCalendarIntegration.result.updated} güncellenen, {googleCalendarIntegration.result.deleted} kaldırılan
                    </Text>
                    {googleCalendarIntegration.warnings?.map((warning) => (
                      <Text key={warning} style={styles.calendarSyncWarning}>{warning}</Text>
                    ))}
                  </View>
                )}

                <View style={styles.nativeCalendarActions}>
                  <Pressable
                    style={[styles.button, styles.primaryButton, (busy || googleCalendarBusy) && styles.buttonDisabled]}
                    onPress={() => void syncGoogleCalendar(!googleCalendarIntegration)}
                    disabled={busy || googleCalendarBusy}
                  >
                    {googleCalendarBusy ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <View style={styles.buttonContent}>
                        <Ionicons name="logo-google" size={20} color="#ffffff" />
                        <Text style={styles.primaryButtonText}>{googleCalendarIntegration ? "Şimdi Eşitle" : "Bağlan ve Eşitle"}</Text>
                      </View>
                    )}
                  </Pressable>
                  {googleCalendarIntegration && (
                    <Pressable
                      style={[styles.button, styles.secondaryButton, (busy || googleCalendarBusy) && styles.buttonDisabled]}
                      onPress={() => void syncGoogleCalendar(true)}
                      disabled={busy || googleCalendarBusy}
                    >
                      <View style={styles.buttonContent}>
                        <Ionicons name="swap-horizontal-outline" size={19} color="#1e293b" />
                        <Text style={styles.secondaryButtonText}>Google Hesabını Değiştir</Text>
                      </View>
                    </Pressable>
                  )}
                </View>
              </Section>

              <Section title="Akademik Tarihler">
                {(calendar.data?.events ?? []).filter(isUniversityAcademicCalendarEvent).slice(0, 8).map((event) => (
                  <View key={event.id} style={styles.eventCard}>
                    <Text style={styles.eventCategory}>{toCategoryLabel(event.category)}</Text>
                    <Text style={styles.eventTitle}>{event.title}</Text>
                    <Text style={styles.caption}>{formatDateShort(event.startDate)}</Text>
                  </View>
                ))}
                {!calendar.loading && (calendar.data?.events ?? []).filter(isUniversityAcademicCalendarEvent).length === 0 && (
                  <View style={styles.emptyStatePanel}>
                    <Ionicons name="calendar-clear-outline" size={24} color="#2563eb" />
                    <Text style={styles.emptyStateTitle}>Takvim tarihi bulunamadı</Text>
                    <Text style={styles.caption}>Üniversite takvimi yüklendiğinde önemli tarihler burada görünecek.</Text>
                  </View>
                )}
              </Section>
            </>
          )}

          {session && activeTab === "summer" && (
            <>
              <Section title="Yaz Okulu">
                <View style={styles.announcementHeader}>
                  <View style={styles.flexOne}>
                    <Text style={styles.helperText}>Yaz okulu tarihlerini, başvuru duyurularını ve aynı bölümdeki fırsatları takip et.</Text>
                    <Text style={styles.caption}>{selectedUniversity?.name ?? "Üniversite seçilmedi"}</Text>
                  </View>
                  <View style={styles.announcementCountBadge}>
                    <Text style={styles.announcementCountValue}>
                      {summerSchoolEvents.length + summerSchoolAnnouncements.length + (summerSchool.data?.sameDepartmentOptions.length ?? 0)}
                    </Text>
                    <Text style={styles.announcementCountLabel}>kayıt</Text>
                  </View>
                </View>

                <Pressable
                  style={[
                    styles.button,
                    styles.secondaryButton,
                    (!registerUniversityId || summerSchool.loading || busy) && styles.buttonDisabled
                  ]}
                  onPress={() => void loadSummerSchool()}
                  disabled={!registerUniversityId || summerSchool.loading || busy}
                >
                  <Ionicons name="refresh-outline" size={18} color="#1e293b" />
                  <Text style={styles.secondaryButtonText}>Yaz Okulunu Yenile</Text>
                </Pressable>

                {summerSchool.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                {summerSchool.error && registerUniversityId && <Text style={styles.errorText}>{summerSchool.error}</Text>}

                {!registerUniversityId && (
                  <View style={styles.emptyStatePanel}>
                    <Ionicons name="school-outline" size={24} color="#ea580c" />
                    <Text style={styles.emptyStateTitle}>Üniversite seçildiğinde hazır</Text>
                    <Text style={styles.caption}>Profil sekmesinden üniversiteni seçtiğinde yaz okulu bilgileri burada görünecek.</Text>
                  </View>
                )}
              </Section>

              {registerUniversityId && (
                <>
                  <Section title="Yaz Okulu Tarihleri">
                    {summerSchoolEvents.map((event) => (
                      <View key={event.id} style={styles.eventCard}>
                        <Text style={styles.eventCategory}>{toCategoryLabel(event.category)}</Text>
                        <Text style={styles.eventTitle}>{event.title}</Text>
                        <Text style={styles.caption}>{formatDateShort(event.startDate)}</Text>
                      </View>
                    ))}

                    {!calendar.loading && summerSchoolEvents.length === 0 && (
                      <View style={styles.emptyStatePanel}>
                        <Ionicons name="sunny-outline" size={24} color="#ea580c" />
                        <Text style={styles.emptyStateTitle}>Henüz yaz okulu tarihi yok</Text>
                        <Text style={styles.caption}>Üniversite takviminde yaz okulu tarihleri bulunduğunda burada listelenecek.</Text>
                      </View>
                    )}
                  </Section>

                  <Section title="Yaz Okulu Duyuruları">
                    {(summerSchool.data?.requirements ?? []).map((item) => (
                      <Pressable
                        key={`${item.eventId ?? item.message}-${item.date ?? "date"}`}
                        style={styles.announcementCard}
                        onPress={() => item.sourceUrl ? void openAnnouncement(item.sourceUrl) : undefined}
                      >
                        <View style={styles.announcementTopRow}>
                          <Text style={styles.announcementSourcePill}>Koşul</Text>
                          <Text style={styles.announcementDate}>{formatDateShort(item.date)}</Text>
                        </View>
                        <Text style={styles.announcementTitle}>{item.message}</Text>
                      </Pressable>
                    ))}
                    {summerSchoolAnnouncements.map(renderAnnouncementCard)}

                    {!summerSchool.loading && (summerSchool.data?.requirements ?? []).length === 0 && summerSchoolAnnouncements.length === 0 && (
                      <View style={styles.emptyStatePanel}>
                        <Ionicons name="megaphone-outline" size={24} color="#b45309" />
                        <Text style={styles.emptyStateTitle}>Henüz yaz okulu duyurusu yok</Text>
                        <Text style={styles.caption}>Kaynaklar güncellendiğinde başvuru ve ders alma duyuruları burada görünecek.</Text>
                      </View>
                    )}
                  </Section>

                  <Section title="Aynı Bölümde Seçenekler">
                    {(summerSchool.data?.sameDepartmentOptions ?? []).map((option) => (
                      <Pressable
                        key={`${option.universityId}-${option.academicYear}`}
                        style={styles.announcementCard}
                        onPress={() => option.sourceUrl ? void openAnnouncement(option.sourceUrl) : undefined}
                      >
                        <View style={styles.announcementTopRow}>
                          <Text style={styles.announcementSourcePill}>{option.academicYear}</Text>
                          <Text style={styles.announcementDate}>{option.events.length} tarih</Text>
                        </View>
                        <Text style={styles.announcementTitle}>{option.universityName}</Text>
                        <Text style={styles.announcementSummary}>
                          {(option.matchingDepartments ?? []).map((item) => item.departmentName).slice(0, 3).join(", ") || "Benzer bölüm bilgisi"}
                        </Text>
                      </Pressable>
                    ))}

                    {!summerSchool.loading && (summerSchool.data?.sameDepartmentOptions ?? []).length === 0 && (
                      <View style={styles.emptyStatePanel}>
                        <Ionicons name="search-outline" size={24} color="#2563eb" />
                        <Text style={styles.emptyStateTitle}>Eşleşen bölüm bulunmadı</Text>
                        <Text style={styles.caption}>Diğer üniversitelerde aynı bölümden yaz okulu fırsatı bulunduğunda burada listelenecek.</Text>
                      </View>
                    )}
                  </Section>
                </>
              )}
            </>
          )}

          {session && activeTab === "yok" && (
            <Section title="YÖK Duyuruları">
              <View style={styles.announcementHeader}>
                <View style={styles.flexOne}>
                  <Text style={styles.helperText}>Yükseköğretim Kurulu tarafından yayımlanan ulusal duyuruları takip et.</Text>
                  <Text style={styles.caption}>YÖK resmi duyuru kaynağı</Text>
                </View>
                <View style={styles.announcementCountBadge}>
                  <Text style={styles.announcementCountValue}>{yokAnnouncementItems.length}</Text>
                  <Text style={styles.announcementCountLabel}>duyuru</Text>
                </View>
              </View>

              <Pressable
                style={[styles.button, styles.secondaryButton, (yokAnnouncements.loading || busy) && styles.buttonDisabled]}
                onPress={() => void loadYokAnnouncements()}
                disabled={yokAnnouncements.loading || busy}
              >
                <Ionicons name="refresh-outline" size={18} color="#1e293b" />
                <Text style={styles.secondaryButtonText}>YÖK Duyurularını Yenile</Text>
              </Pressable>

              {yokAnnouncements.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
              {yokAnnouncements.error && <Text style={styles.errorText}>{yokAnnouncements.error}</Text>}
              {yokAnnouncementItems.map(renderAnnouncementCard)}

              {!yokAnnouncements.loading && yokAnnouncementItems.length === 0 && (
                <View style={styles.emptyStatePanel}>
                  <Ionicons name="newspaper-outline" size={24} color="#0f766e" />
                  <Text style={styles.emptyStateTitle}>YÖK duyurusu bulunamadı</Text>
                  <Text style={styles.caption}>Resmi kaynak yanıt verdiğinde duyurular burada listelenecek.</Text>
                </View>
              )}
            </Section>
          )}

          {session && activeTab === "announcements" && (
            <Section title="Duyurular, Haberler ve Etkinlikler">
              <View style={styles.announcementHeader}>
                <View style={styles.flexOne}>
                  <Text style={styles.helperText}>Üniversite, fakülte ve bölüm kaynaklarından gelen içerikleri ayrı ayrı takip et.</Text>
                  <Text style={styles.caption}>{selectedUniversity?.name ?? "Üniversite seçilmedi"}</Text>
                </View>
                <View style={styles.announcementCountBadge}>
                  <Text style={styles.announcementCountValue}>{announcementFeed.length}</Text>
                  <Text style={styles.announcementCountLabel}>kayıt</Text>
                </View>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.contentFilterRow}>
                {ANNOUNCEMENT_FILTER_OPTIONS.map((option) => {
                  const selected = announcementContentFilter === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      style={[styles.contentFilterOption, selected && styles.contentFilterOptionActive]}
                      onPress={() => setAnnouncementContentFilter(option.value)}
                    >
                      <Ionicons name={option.icon} size={17} color={selected ? "#ffffff" : "#475569"} />
                      <Text style={[styles.contentFilterText, selected && styles.contentFilterTextActive]}>{option.label}</Text>
                      <Text style={[styles.contentFilterCount, selected && styles.contentFilterCountActive]}>
                        {announcementContentCounts[option.value]}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Pressable
                style={[
                  styles.button,
                  styles.secondaryButton,
                  (!registerUniversityId || announcements.loading || busy) && styles.buttonDisabled
                ]}
                onPress={() => void loadAnnouncements()}
                disabled={!registerUniversityId || announcements.loading || busy}
              >
                <Ionicons name="refresh-outline" size={18} color="#1e293b" />
                <Text style={styles.secondaryButtonText}>Kaynakları Yenile</Text>
              </Pressable>

              {announcements.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
              {announcements.error && registerUniversityId && <Text style={styles.errorText}>{announcements.error}</Text>}

              {announcementSections.map((section) => (
                <View key={section.key} style={styles.announcementGroup}>
                  <View style={styles.announcementGroupHeader}>
                    <Text style={styles.announcementGroupTitle}>{section.title}</Text>
                    <Text style={styles.announcementGroupCount}>{section.items.length} kayıt</Text>
                  </View>
                  {section.items.map(renderAnnouncementCard)}
                </View>
              ))}

              {!announcements.loading && filteredAnnouncementFeed.length === 0 && (
                <View style={styles.emptyStatePanel}>
                  <Ionicons
                    name={announcementContentFilter === "news" ? "newspaper-outline" : announcementContentFilter === "event" ? "calendar-outline" : "megaphone-outline"}
                    size={24}
                    color="#b45309"
                  />
                  <Text style={styles.emptyStateTitle}>
                    {!registerUniversityId
                      ? "Üniversite seçildiğinde hazır"
                      : announcementContentFilter === "news"
                        ? "Henüz haber yok"
                        : announcementContentFilter === "event"
                          ? "Henüz etkinlik yok"
                          : announcementContentFilter === "announcement"
                            ? "Henüz duyuru yok"
                            : "Henüz içerik yok"}
                  </Text>
                  <Text style={styles.caption}>
                    {registerUniversityId
                      ? "Resmi kaynaklar güncellendiğinde yeni içerikler burada listelenecek."
                      : "Profil sekmesinden üniversiteni seçtiğinde içerikler burada listelenecek."}
                  </Text>
                </View>
              )}
            </Section>
          )}

          {session && activeTab === "profile" && (
            <>
              <Section title="Profil">
                <View style={styles.profileSummaryPanel}>
                  <View style={styles.profileAvatar}>
                    <Ionicons name="person-outline" size={24} color="#0f766e" />
                  </View>
                  <View style={styles.flexOne}>
                    <Text style={styles.profileMetaLabel}>Hesap</Text>
                    <Text style={styles.profileEmail}>{session.user.email}</Text>
                    <Text style={styles.caption}>{selectedUniversity?.name ?? "Okul bilgisi seçilmedi"}</Text>
                  </View>
                </View>

                <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void handleLogout()} disabled={busy}>
                  <Ionicons name="log-out-outline" size={18} color="#1e293b" />
                  <Text style={styles.secondaryButtonText}>Çıkış Yap</Text>
                </Pressable>
              </Section>

              <Section title="Hesap ve Veri">
                <View style={styles.accountDangerPanel}>
                  <View style={styles.accountDangerIcon}>
                    <Ionicons name="shield-checkmark-outline" size={22} color="#be123c" />
                  </View>
                  <View style={styles.flexOne}>
                    <Text style={styles.accountDangerTitle}>Verilerini sen yönetirsin</Text>
                    <Text style={styles.caption}>Önce uygulama verilerini silebilir, sonra istersen hesabını tamamen kapatabilirsin.</Text>
                  </View>
                </View>

                <Pressable
                  style={[styles.button, styles.secondaryButton, busy && styles.buttonDisabled]}
                  onPress={confirmDeleteMyData}
                  disabled={busy}
                >
                  <Ionicons name="trash-bin-outline" size={18} color="#1e293b" />
                  <Text style={styles.secondaryButtonText}>Verilerimi Sil</Text>
                </Pressable>

                <Pressable
                  style={[styles.button, styles.dangerButton, busy && styles.buttonDisabled]}
                  onPress={confirmDeleteAccount}
                  disabled={busy}
                >
                  <Ionicons name="person-remove-outline" size={18} color="#ffffff" />
                  <Text style={styles.dangerButtonText}>Hesabımı Sil</Text>
                </Pressable>
              </Section>

              <Section title="Okul Bilgilerim">
                <Pressable
                  style={styles.academicCompactCard}
                  onPress={() => {
                    setAcademicProfileExpanded((previous) => !previous);
                    if (!(universities.data ?? []).length) void loadUniversities();
                  }}
                  disabled={busy}
                >
                  <View style={styles.academicIcon}>
                    <Ionicons name="school-outline" size={20} color="#2563eb" />
                  </View>
                  <View style={styles.flexOne}>
                    <Text style={styles.academicCompactTitle}>{selectedUniversity?.name ?? "Üniversite seç"}</Text>
                    <Text style={styles.caption}>
                      {[selectedFaculty?.name, selectedDepartment?.name].filter(Boolean).join(" • ") || "Fakülte ve bölüm isteğe bağlı"}
                    </Text>
                  </View>
                  <Ionicons name={academicProfileExpanded ? "chevron-up-outline" : "chevron-down-outline"} size={20} color="#64748b" />
                </Pressable>

                {academicProfileExpanded && (
                  <View style={styles.profileEditorPanel}>
                    <Pressable
                      style={[styles.button, styles.secondaryButton, (universities.loading || academicSelectionPending || busy) && styles.buttonDisabled]}
                      onPress={() => void loadUniversities()}
                      disabled={universities.loading || Boolean(academicSelectionPending) || busy}
                    >
                      <Ionicons name="refresh-outline" size={18} color="#1e293b" />
                      <Text style={styles.secondaryButtonText}>Üniversiteleri Yenile</Text>
                    </Pressable>

                {universities.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                {universities.error && <Text style={styles.errorText}>{universities.error}</Text>}
                {academicSelectionPending && (
                  <View style={styles.selectionSavingRow}>
                    <ActivityIndicator size="small" color="#2563eb" />
                    <Text style={styles.selectionSavingText}>Seçimin kaydediliyor...</Text>
                  </View>
                )}

                <View style={styles.selectorGroup}>
                  <Pressable
                    style={[styles.selectorTrigger, busy && styles.selectorTriggerDisabled]}
                    onPress={() => {
                      setRegisterPicker((prev) => (prev === "university" ? "none" : "university"));
                      if (!(universities.data ?? []).length) void loadUniversities();
                    }}
                    disabled={Boolean(academicSelectionPending) || busy}
                  >
                    <Text style={styles.selectorLabel}>Üniversite</Text>
                    <Text style={styles.selectorValue}>{selectedUniversity?.name ?? "Seçmek için dokun"}</Text>
                  </Pressable>

                  {registerPicker === "university" && (
                    <View style={styles.selectorPanel}>
                      <TextInput
                        value={universitySearch}
                        onChangeText={setUniversitySearch}
                        placeholder="Üniversite ara"
                        style={styles.input}
                      />
                      {filteredUniversities.map((university) => (
                        <Pressable
                          key={university.id}
                          style={[styles.selectorOption, selectedUniversityId === university.id && styles.selectorOptionSelected]}
                          onPress={() => void selectUniversity(university.id)}
                          disabled={Boolean(academicSelectionPending) || busy}
                        >
                          <Text style={styles.universityName}>{university.name}</Text>
                          <Text style={styles.universityMeta}>{university.city} | {UNIVERSITY_TYPE_LABELS[university.type] ?? university.type}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  <Pressable
                    style={[styles.selectorTrigger, (!registerUniversityId || busy) && styles.selectorTriggerDisabled]}
                    onPress={() => setRegisterPicker((prev) => (prev === "faculty" ? "none" : "faculty"))}
                    disabled={!registerUniversityId || Boolean(academicSelectionPending) || busy}
                  >
                    <Text style={styles.selectorLabel}>Fakülte</Text>
                    <Text style={styles.selectorValue}>{selectedFaculty?.name ?? "Seçmek için dokun"}</Text>
                  </Pressable>

                  {registerPicker === "faculty" && registerUniversityId && (
                    <View style={styles.selectorPanel}>
                      <TextInput
                        value={facultySearch}
                        onChangeText={setFacultySearch}
                        placeholder="Fakülte ara"
                        style={styles.input}
                      />
                      {faculties.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                      {filteredFaculties.map((faculty) => (
                        <Pressable
                          key={faculty.id}
                          style={[styles.selectorOption, registerFacultyId === faculty.id && styles.selectorOptionSelected]}
                          onPress={() => void selectFaculty(faculty.id)}
                          disabled={Boolean(academicSelectionPending) || busy}
                        >
                          <Text style={styles.universityName}>{faculty.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  <Pressable
                    style={[styles.selectorTrigger, (!registerFacultyId || busy) && styles.selectorTriggerDisabled]}
                    onPress={() => setRegisterPicker((prev) => (prev === "department" ? "none" : "department"))}
                    disabled={!registerFacultyId || Boolean(academicSelectionPending) || busy}
                  >
                    <Text style={styles.selectorLabel}>Bölüm</Text>
                    <Text style={styles.selectorValue}>{selectedDepartment?.name ?? "Seçmek için dokun"}</Text>
                  </Pressable>

                  {registerPicker === "department" && registerFacultyId && (
                    <View style={styles.selectorPanel}>
                      <TextInput
                        value={departmentSearch}
                        onChangeText={setDepartmentSearch}
                        placeholder="Bölüm ara"
                        style={styles.input}
                      />
                      {departments.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                      {filteredDepartments.map((department) => (
                        <Pressable
                          key={department.id}
                          style={[styles.selectorOption, registerDepartmentId === department.id && styles.selectorOptionSelected]}
                          onPress={() => void selectDepartment(department.id)}
                          disabled={Boolean(academicSelectionPending) || busy}
                        >
                          <Text style={styles.universityName}>{department.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  </View>
                  </View>
                )}
              </Section>

              <Section title="Bildirim Tercihleri">
                <View style={styles.notificationStatusPanel}>
                  <View style={styles.notificationIcon}>
                    <Ionicons name="notifications-outline" size={22} color="#b45309" />
                  </View>
                  <View style={styles.flexOne}>
                    <Text style={styles.notificationTitle}>Akademik hatırlatmalar</Text>
                    <Text style={styles.caption}>Sınav, kayıt ve önemli tarihleri kaçırmamak için bildirimleri aç.</Text>
                  </View>
                  <Switch value={alarmEnabled} onValueChange={setAlarmEnabled} />
                </View>

                <View style={styles.notificationModeGrid}>
                  <Pressable
                    style={[styles.notificationModeCard, alarmMode === "all_calendar" && styles.notificationModeCardActive]}
                    onPress={() => {
                      updateAlarmMode("all_calendar");
                      setAlarmCategoriesExpanded(false);
                    }}
                  >
                    <Ionicons name="calendar-outline" size={18} color={alarmMode === "all_calendar" ? "#ffffff" : "#2563eb"} />
                    <Text style={[styles.notificationModeTitle, alarmMode === "all_calendar" && styles.notificationModeTitleActive]}>Tüm önemli tarihler</Text>
                    <Text style={[styles.notificationModeText, alarmMode === "all_calendar" && styles.notificationModeTextActive]}>Takvimdeki her kategori</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.notificationModeCard, alarmMode === "selected_fields" && styles.notificationModeCardActive]}
                    onPress={() => {
                      updateAlarmMode("selected_fields");
                      setAlarmCategoriesExpanded(true);
                    }}
                  >
                    <Ionicons name="options-outline" size={18} color={alarmMode === "selected_fields" ? "#ffffff" : "#2563eb"} />
                    <Text style={[styles.notificationModeTitle, alarmMode === "selected_fields" && styles.notificationModeTitleActive]}>Ben seçeyim</Text>
                    <Text style={[styles.notificationModeText, alarmMode === "selected_fields" && styles.notificationModeTextActive]}>Sadece seçtiğin başlıklar</Text>
                  </Pressable>
                </View>

                {alarmMode === "selected_fields" && (
                  <>
                    <Pressable style={styles.dropdownHeader} onPress={() => setAlarmCategoriesExpanded((previous) => !previous)}>
                      <View style={styles.flexOne}>
                        <Text style={styles.dropdownTitle}>Bildirim kategorileri</Text>
                        <Text style={styles.caption}>{availableCategories.filter((category) => Boolean(categoryDraft[category])).length} kategori seçili</Text>
                      </View>
                      <Ionicons name={alarmCategoriesExpanded ? "chevron-up-outline" : "chevron-down-outline"} size={20} color="#64748b" />
                    </Pressable>

                    {alarmCategoriesExpanded && (
                      <View style={styles.categoryListPanel}>
                        {availableCategories.map((category) => (
                          <View key={category} style={styles.categoryToggleRow}>
                            <Text style={styles.categoryToggleLabel}>{toCategoryLabel(category)}</Text>
                            <Switch
                              value={Boolean(categoryDraft[category])}
                              onValueChange={(enabled) => updateCategory(category, enabled)}
                            />
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )}

                <Pressable style={[styles.button, styles.primaryButton, busy && styles.buttonDisabled]} onPress={() => void saveAlarmSettings()} disabled={busy}>
                  <Text style={styles.primaryButtonText}>Bildirim Tercihlerini Kaydet</Text>
                </Pressable>
              </Section>
            </>
          )}
        </ScrollView>

        {session && (
          <View style={styles.bottomNavShell}>
            {([
              { id: "home" as TabId, label: "Ana Sayfa", icon: "home" },
              { id: "calendar" as TabId, label: "Takvim", icon: "calendar" },
              { id: "summer" as TabId, label: "Yaz Okulu", icon: "sunny" },
              { id: "yok" as TabId, label: "YÖK", icon: "newspaper" },
              { id: "announcements" as TabId, label: "Gündem", icon: "sparkles" },
              { id: "profile" as TabId, label: "Profil", icon: "person" },
            ]).map(({ id, label, icon }) => {
              const active = activeTab === id;
              return (
                <Pressable
                  key={id}
                  style={[styles.bottomNavItem, active && styles.bottomNavItemActive]}
                  onPress={() => setActiveTab(id)}
                >
                  <Ionicons
                    name={(active ? icon : `${icon}-outline`) as any}
                    size={22}
                    color={active ? "#ffffff" : "#94a3b8"}
                  />
                  <Text style={[styles.bottomNavLabel, active && styles.bottomNavLabelActive]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f5f6ff"
  },
  container: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 30,
    gap: 14
  },
  containerWithNav: {
    paddingBottom: 142
  },
  hydrationContainer: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#f5f6ff"
  },
  hydrationTitle: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center"
  },
  hydrationText: {
    color: "#475569",
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 360
  },
  hydrationRetryButton: {
    width: "100%",
    maxWidth: 360,
    marginTop: 6
  },
  authHero: {
    marginTop: 8,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 22,
    backgroundColor: "#4f46e5",
    gap: 6,
    elevation: 6
  },
  authHeroTitle: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 0
  },
  authHeroSubtitle: {
    color: "rgba(255,255,255,0.75)",
    lineHeight: 20,
    fontWeight: "500"
  },
  homeHero: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#99f6e4",
    backgroundColor: "#ecfdf5",
    padding: 16,
    gap: 14
  },
  homeHeroEyebrow: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800"
  },
  homeHeroTitle: {
    color: "#0f172a",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0
  },
  homeHeroSubtitle: {
    color: "#334155",
    lineHeight: 20,
    marginTop: 4
  },
  homeHeroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#ccfbf1",
    alignItems: "center",
    justifyContent: "center"
  },
  homeStatsRow: {
    flexDirection: "row",
    gap: 8
  },
  homeStatItem: {
    flex: 1,
    minHeight: 64,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1fae5",
    paddingHorizontal: 10,
    paddingVertical: 9,
    justifyContent: "center"
  },
  homeStatValue: {
    color: "#0f766e",
    fontSize: 20,
    fontWeight: "900"
  },
  homeStatLabel: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "700"
  },
  quickActionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  quickActionCard: {
    flexGrow: 1,
    width: "48%",
    minHeight: 104,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#ffffff",
    padding: 14,
    gap: 7,
    justifyContent: "center"
  },
  quickActionTitle: {
    color: "#111827",
    fontWeight: "900"
  },
  quickActionText: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 17
  },
  messageBox: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11
  },
  messageText: {
    color: "#ffffff",
    fontWeight: "700"
  },
  infoBox: {
    backgroundColor: "#1e293b"
  },
  successBox: {
    backgroundColor: "#16a34a"
  },
  errorBox: {
    backgroundColor: "#be123c"
  },
  cleanupIssueCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#f59e0b",
    backgroundColor: "#fffbeb",
    padding: 14,
    gap: 8
  },
  cleanupIssueTitle: {
    color: "#92400e",
    fontWeight: "800"
  },
  cleanupIssueText: {
    color: "#78350f",
    lineHeight: 19
  },
  section: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    elevation: 2
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: 0
  },
  helperText: {
    color: "#475569",
    lineHeight: 20,
    fontSize: 14
  },
  stepLabel: {
    color: "#3442c4",
    fontWeight: "800",
    marginTop: 6
  },
  selectionHint: {
    color: "#4554e0",
    fontWeight: "600"
  },
  caption: {
    color: "#64748b",
    lineHeight: 19
  },
  fieldGroup: {
    gap: 6
  },
  fieldLabel: {
    color: "#1e293b",
    fontSize: 13,
    fontWeight: "800"
  },
  input: {
    borderColor: "#e2e8f0",
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: "#ffffff",
    color: "#111827",
    fontSize: 15,
    minHeight: 50
  },
  passwordInputShell: {
    position: "relative",
    justifyContent: "center"
  },
  passwordInput: {
    paddingRight: 58
  },
  passwordVisibilityButton: {
    position: "absolute",
    right: 2,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center"
  },
  button: {
    minHeight: 50,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    flexDirection: "row",
    gap: 8
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  buttonDisabled: {
    opacity: 0.5
  },
  primaryButton: {
    backgroundColor: "#4554e0",
    elevation: 3
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
    letterSpacing: 0
  },
  googleButton: {
    backgroundColor: "#ffffff",
    borderColor: "#d1d5db",
    borderWidth: 1.5,
    flexDirection: "row",
    gap: 8
  },
  googleButtonText: {
    color: "#1f2937",
    fontWeight: "800",
    fontSize: 15
  },
  secondaryButton: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderWidth: 1.5
  },
  secondaryButtonText: {
    color: "#1e293b",
    fontWeight: "700",
    fontSize: 15
  },
  dangerButton: {
    backgroundColor: "#be123c",
    elevation: 3
  },
  dangerButtonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 15
  },
  row: {
    flexDirection: "row",
    gap: 8
  },
  progressRow: {
    flexDirection: "row",
    gap: 8
  },
  progressChip: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
    paddingHorizontal: 10
  },
  progressChipDone: {
    borderColor: "#a5b4fc",
    backgroundColor: "#eef0fd"
  },
  progressChipText: {
    color: "#64748b",
    fontWeight: "700",
    fontSize: 12
  },
  progressChipTextDone: {
    color: "#4554e0"
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  flexOne: {
    flex: 1
  },
  modeButton: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48
  },
  modeButtonActive: {
    backgroundColor: "#4554e0",
    borderColor: "#4554e0",
    elevation: 2
  },
  modeButtonText: {
    color: "#64748b",
    fontWeight: "700"
  },
  modeButtonTextActive: {
    color: "#ffffff"
  },
  sessionInfo: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#dde1fb",
    backgroundColor: "#eef0fd",
    padding: 12,
    gap: 6
  },
  sessionText: {
    color: "#1e293b"
  },
  profileSummaryPanel: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d1fae5",
    backgroundColor: "#ecfdf5",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#ccfbf1",
    alignItems: "center",
    justifyContent: "center"
  },
  profileMetaLabel: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "900"
  },
  profileEmail: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "900"
  },
  accountDangerPanel: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#fecdd3",
    backgroundColor: "#fff1f2",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  accountDangerIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#ffe4e6",
    alignItems: "center",
    justifyContent: "center"
  },
  accountDangerTitle: {
    color: "#111827",
    fontWeight: "900"
  },
  academicCompactCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#eff6ff",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  academicIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#dbeafe",
    alignItems: "center",
    justifyContent: "center"
  },
  academicCompactTitle: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "900"
  },
  profileEditorPanel: {
    gap: 10
  },
  notificationStatusPanel: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#fed7aa",
    backgroundColor: "#fff7ed",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  notificationIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#ffedd5",
    alignItems: "center",
    justifyContent: "center"
  },
  notificationTitle: {
    color: "#111827",
    fontWeight: "900"
  },
  notificationModeGrid: {
    flexDirection: "row",
    gap: 10
  },
  notificationModeCard: {
    flex: 1,
    minHeight: 104,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#dbeafe",
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 7,
    justifyContent: "center"
  },
  notificationModeCardActive: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb"
  },
  notificationModeTitle: {
    color: "#111827",
    fontWeight: "900",
    fontSize: 13
  },
  notificationModeTitleActive: {
    color: "#ffffff"
  },
  notificationModeText: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 16
  },
  notificationModeTextActive: {
    color: "#dbeafe"
  },
  dropdownHeader: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  dropdownTitle: {
    color: "#111827",
    fontWeight: "900"
  },
  categoryListPanel: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 8
  },
  categoryToggleRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  categoryToggleLabel: {
    flex: 1,
    color: "#1e293b",
    fontWeight: "700",
    lineHeight: 18
  },
  loader: {
    marginVertical: 8
  },
  errorText: {
    color: "#be123c",
    fontWeight: "600"
  },
  universityCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 3
  },
  universityCardSelected: {
    borderColor: "#5c6ef0",
    backgroundColor: "#eef0fd"
  },
  universityName: {
    fontSize: 15,
    color: "#111827",
    fontWeight: "800"
  },
  universityMeta: {
    color: "#94a3b8",
    fontSize: 13
  },
  selectorGroup: {
    gap: 10
  },
  selectionSavingRow: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9
  },
  selectionSavingText: {
    color: "#1d4ed8",
    fontSize: 13,
    fontWeight: "800"
  },
  selectorTrigger: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4
  },
  selectorTriggerDisabled: {
    opacity: 0.5
  },
  selectorLabel: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0,
    textTransform: "uppercase"
  },
  selectorValue: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "700"
  },
  selectorPanel: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 8
  },
  selectorOption: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 2
  },
  selectorOptionSelected: {
    borderColor: "#5c6ef0",
    backgroundColor: "#eef0fd"
  },
  selectorCalendarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  selectAllCalendarsButton: {
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#99f6e4",
    backgroundColor: "#f0fdfa",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10
  },
  selectAllCalendarsText: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800"
  },
  inlineInfoCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 4
  },
  inlineInfoTitle: {
    color: "#92400e",
    fontWeight: "800"
  },
  inlineInfoText: {
    color: "#78350f",
    lineHeight: 19
  },
  verificationCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 16,
    gap: 12
  },
  verificationTitle: {
    color: "#111827",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0
  },
  verificationSubtitle: {
    color: "#475569",
    lineHeight: 20
  },
  verificationTimingCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#c7d2fe",
    backgroundColor: "#eef2ff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3
  },
  verificationTimingText: {
    color: "#3730a3",
    fontWeight: "700",
    lineHeight: 19
  },
  passwordRecoveryFeedback: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  passwordRecoveryFeedbackInfo: {
    borderColor: "#c7d2fe",
    backgroundColor: "#eef2ff"
  },
  passwordRecoveryFeedbackSuccess: {
    borderColor: "#86efac",
    backgroundColor: "#f0fdf4"
  },
  passwordRecoveryFeedbackError: {
    borderColor: "#fda4af",
    backgroundColor: "#fff1f2"
  },
  passwordRecoveryFeedbackText: {
    color: "#1e293b",
    fontWeight: "700",
    lineHeight: 19
  },
  passwordRecoveryValidationText: {
    color: "#be123c",
    fontWeight: "700",
    lineHeight: 19
  },
  textActionButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48
  },
  textActionText: {
    color: "#4554e0",
    fontWeight: "800"
  },
  summaryCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 14,
    gap: 10
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10
  },
  summaryKey: {
    color: "#64748b",
    fontWeight: "700"
  },
  summaryValue: {
    color: "#111827",
    fontWeight: "700",
    flexShrink: 1,
    textAlign: "right"
  },
  cardMuted: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    padding: 12,
    gap: 4
  },
  calendarMiniGrid: {
    flexDirection: "row",
    gap: 10
  },
  calendarMiniCard: {
    flex: 1,
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#dbeafe",
    backgroundColor: "#eff6ff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center"
  },
  calendarMiniValue: {
    color: "#1d4ed8",
    fontSize: 18,
    fontWeight: "900"
  },
  calendarMiniLabel: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "800"
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: 0
  },
  calendarConnectionHero: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#bae6fd",
    backgroundColor: "#f0f9ff",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  calendarConnectionNote: {
    color: "#475569",
    fontSize: 13,
    lineHeight: 19
  },
  calendarErrorPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fecdd3",
    backgroundColor: "#fff1f2",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8
  },
  calendarErrorText: {
    flex: 1,
    color: "#9f1239",
    fontWeight: "700",
    lineHeight: 19
  },
  calendarProviderGrid: {
    gap: 8
  },
  calendarProviderCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4
  },
  calendarProviderCardConnected: {
    borderColor: "#99f6e4",
    backgroundColor: "#f0fdfa"
  },
  calendarProviderTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  calendarProviderTitle: {
    flex: 1,
    color: "#1e293b",
    fontSize: 14,
    fontWeight: "800"
  },
  calendarProviderDetail: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 17
  },
  calendarDetailsPanel: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 12
  },
  nativeCalendarPanel: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#bae6fd",
    backgroundColor: "#f0f9ff",
    padding: 14,
    gap: 12
  },
  calendarPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  calendarPanelIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ccfbf1",
    alignItems: "center",
    justifyContent: "center"
  },
  calendarExplainPanel: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#bae6fd",
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 10
  },
  calendarExplainStep: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10
  },
  calendarExplainNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#0f766e",
    color: "#ffffff",
    textAlign: "center",
    lineHeight: 24,
    fontWeight: "900"
  },
  calendarExplainText: {
    flex: 1,
    color: "#334155",
    lineHeight: 19
  },
  calendarSyncSummary: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    backgroundColor: "#f0fdf4",
    padding: 12,
    gap: 5
  },
  calendarSyncSummaryLabel: {
    color: "#166534",
    fontWeight: "800"
  },
  calendarSyncSummaryValue: {
    color: "#166534",
    fontSize: 20,
    fontWeight: "900"
  },
  calendarSyncWarning: {
    color: "#92400e",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700"
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  statusPillSuccess: {
    backgroundColor: "#dcfce7"
  },
  statusPillNeutral: {
    backgroundColor: "#e2e8f0"
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: "900"
  },
  statusPillTextSuccess: {
    color: "#166534"
  },
  statusPillTextNeutral: {
    color: "#475569"
  },
  nativeCalendarActions: {
    gap: 8
  },
  nativeCalendarReminderGroup: {
    gap: 8
  },
  reminderOption: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8
  },
  reminderOptionActive: {
    backgroundColor: "#5c6ef0",
    borderColor: "#5c6ef0"
  },
  reminderOptionText: {
    color: "#64748b",
    fontWeight: "700",
    fontSize: 12,
    textAlign: "center"
  },
  reminderOptionTextActive: {
    color: "#ffffff"
  },
  eventCard: {
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: "#5c6ef0",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 13,
    gap: 5
  },
  focusCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    backgroundColor: "#f0fdf4",
    padding: 14,
    gap: 7
  },
  emptyStatePanel: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    padding: 14,
    gap: 6,
    alignItems: "flex-start"
  },
  emptyStateTitle: {
    color: "#111827",
    fontWeight: "900"
  },
  eventHighlightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#fed7aa",
    backgroundColor: "#fff7ed",
    padding: 12
  },
  eventDateBadge: {
    width: 58,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#ffedd5",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6
  },
  eventDateBadgeText: {
    color: "#9a3412",
    fontWeight: "900",
    textAlign: "center",
    fontSize: 12
  },
  eventCategory: {
    color: "#5c6ef0",
    fontWeight: "700",
    fontSize: 11,
    letterSpacing: 0,
    textTransform: "uppercase"
  },
  eventTitle: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21
  },
  countdownBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#eef0fd",
    color: "#4554e0",
    fontWeight: "800",
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: "hidden"
  },
  linkText: {
    color: "#2563eb",
    fontWeight: "800"
  },
  announcementHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  announcementCountBadge: {
    minWidth: 76,
    borderRadius: 14,
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#fed7aa",
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center"
  },
  announcementCountValue: {
    color: "#b45309",
    fontSize: 18,
    fontWeight: "900"
  },
  announcementCountLabel: {
    color: "#92400e",
    fontSize: 11,
    fontWeight: "700"
  },
  contentFilterRow: {
    gap: 8,
    paddingVertical: 2
  },
  contentFilterOption: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11
  },
  contentFilterOptionActive: {
    borderColor: "#5c6ef0",
    backgroundColor: "#5c6ef0"
  },
  contentFilterText: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "800"
  },
  contentFilterTextActive: {
    color: "#ffffff"
  },
  contentFilterCount: {
    minWidth: 22,
    borderRadius: 7,
    backgroundColor: "#f1f5f9",
    color: "#475569",
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 2,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "900"
  },
  contentFilterCountActive: {
    backgroundColor: "#ffffff",
    color: "#4554e0"
  },
  announcementGroup: {
    gap: 10,
    marginTop: 16
  },
  announcementGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingBottom: 8
  },
  announcementGroupTitle: {
    color: "#1e293b",
    fontSize: 14,
    fontWeight: "900"
  },
  announcementGroupCount: {
    flexShrink: 0,
    borderRadius: 999,
    backgroundColor: "#eef2ff",
    color: "#3730a3",
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: "900"
  },
  announcementCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 14,
    gap: 8
  },
  announcementTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8
  },
  announcementSourcePill: {
    flexShrink: 1,
    borderRadius: 999,
    backgroundColor: "#eef2ff",
    color: "#3730a3",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: "900"
  },
  announcementDate: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700"
  },
  announcementTitle: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 22
  },
  announcementSummary: {
    color: "#475569",
    lineHeight: 20
  },
  announcementActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5
  },
  label: {
    color: "#1e293b",
    fontWeight: "700",
    flex: 1,
    marginRight: 8
  },
  buttonInline: {
    minHeight: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryOutline: {
    borderWidth: 1.5,
    borderColor: "#e2e8f0"
  },
  secondaryOutlineText: {
    color: "#1e293b",
    fontWeight: "700"
  },
  bottomNavShell: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 16,
    borderRadius: 24,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 6,
    elevation: 12
  },
  bottomNavItem: {
    flex: 1,
    minHeight: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 2,
    gap: 2
  },
  bottomNavItemActive: {
    backgroundColor: "#5c6ef0"
  },
  bottomNavLabel: {
    color: "#94a3b8",
    fontSize: 9,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 11,
    letterSpacing: 0
  },
  bottomNavLabelActive: {
    color: "#ffffff",
    fontWeight: "700"
  }
});
