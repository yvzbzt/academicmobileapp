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

type AuthMode = "login" | "register";
type AlarmMode = "all_calendar" | "selected_fields";
type TabId = "profile" | "announcements" | "home" | "calendar" | "summer" | "yok";
type AcademicSelectionLevel = "university" | "faculty" | "department";
type AnnouncementContentType = "announcement" | "news" | "event";
type AnnouncementContentFilter = "all" | AnnouncementContentType;
type AnnouncementScopeType = "university" | "faculty" | "department";
type AuthStage = "auth" | "verify" | "profile_confirm";

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
  previewVerificationToken?: string;
};

type UserProfile = {
  id: string;
  fullName: string;
  email: string;
  role: string;
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

type ManualExamRecord = {
  id: string;
  title: string;
  examDate: string;
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
const DEVICE_ID_STORAGE_KEY = "native_device_id";
const MANUAL_EXAMS_STORAGE_KEY = "native_manual_exams";
const GOOGLE_CALENDAR_STORAGE_KEY = "native_google_calendar_connection";
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
const DEFAULT_GOOGLE_WEB_CLIENT_ID = "315186329318-785gu93pgok7un5rgtpup812rn00irfn.apps.googleusercontent.com";
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
const AUTH_INPUT_PLACEHOLDER_COLOR = "#94a3b8";

function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
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
    // Fall back to raw text when the server returns non-JSON errors.
  }

  return toUserFacingErrorMessage(trimmed, status);
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
  if (normalized.startsWith("{") || normalized.includes("statuscode") || normalized.includes("exception")) {
    return "İşlem tamamlanamadı. Bilgileri kontrol edip tekrar dene.";
  }

  const cleaned = message.replace(/\s+/g, " ").trim();
  if (!cleaned) return "İşlem tamamlanamadı. Lütfen tekrar dene.";
  return cleaned.length > 180 ? "İşlem tamamlanamadı. Lütfen tekrar dene." : cleaned;
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
    try {
      return getWebStorage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function setStoredValue(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      getWebStorage()?.setItem(key, value);
    } catch {
      // Ignore web storage write failures.
    }
    return;
  }

  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Ignore secure storage write failures.
  }
}

async function deleteStoredValue(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      getWebStorage()?.removeItem(key);
    } catch {
      // Ignore web storage delete failures.
    }
    return;
  }

  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Ignore secure storage delete failures.
  }
}

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authStage, setAuthStage] = useState<AuthStage>("auth");
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const apiBaseUrl = useMemo(() => resolveApiBaseUrl(), []);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationToken, setVerificationToken] = useState("");

  const [registerUniversityId, setRegisterUniversityId] = useState("");
  const [registerFacultyId, setRegisterFacultyId] = useState("");
  const [registerDepartmentId, setRegisterDepartmentId] = useState("");
  const [registerPicker, setRegisterPicker] = useState<"none" | "university" | "faculty" | "department">("none");
  const [universitySearch, setUniversitySearch] = useState("");
  const [facultySearch, setFacultySearch] = useState("");
  const [departmentSearch, setDepartmentSearch] = useState("");
  const [pendingVerifiedSession, setPendingVerifiedSession] = useState<SessionPayload | null>(null);

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
  const sessionRef = useRef<SessionPayload | null>(null);
  const refreshSessionPromiseRef = useRef<Promise<SessionPayload | null> | null>(null);
  const academicSelectionPendingRef = useRef<AcademicSelectionLevel | null>(null);

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

    const extraExams = manualExams.map((exam) => ({
      id: exam.id,
      title: exam.title,
      examDate: exam.examDate,
      source: "manual" as const
    }));

    return [...calendarExams, ...extraExams]
      .filter((exam) => !Number.isNaN(Date.parse(exam.examDate)))
      .filter((exam) => Date.parse(exam.examDate) >= Date.now())
      .sort((left, right) => Date.parse(left.examDate) - Date.parse(right.examDate));
  }, [calendar.data?.events, manualExams]);
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

  const registerIdentityReady = Boolean(fullName.trim() && email.trim() && password.trim());
  const loginReady = Boolean(email.trim() && password.trim());
  useEffect(() => {
    const initialize = async () => {
      await restoreDeviceId();
      await restoreManualExams();
      const restoredSession = await restoreSession();
      await restoreGoogleCalendarConnection(restoredSession?.user.id);
      await loadUniversities();

      if (restoredSession) {
        await bootstrapAuthenticatedContext(restoredSession.accessToken);
      }
    };

    void initialize();
  }, []);

  useEffect(() => {
    void setStoredValue(MANUAL_EXAMS_STORAGE_KEY, JSON.stringify(manualExams));
  }, [manualExams]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);

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
    if (authMode !== "register") {
      setAuthStage("auth");
      setRegisterPicker("none");
      setPendingVerifiedSession(null);
      setVerificationToken("");
      return;
    }

    if (authStage !== "auth") return;

    if (!(universities.data?.length) && !universities.loading) {
      void loadUniversities();
    }
  }, [authMode, authStage, universities.data?.length, universities.loading]);

  async function restoreSession(): Promise<SessionPayload | null> {
    try {
      const stored = await getStoredValue(SESSION_STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as SessionPayload;
      sessionRef.current = parsed;
      setSession(parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  async function restoreDeviceId(): Promise<void> {
    const stored = await getStoredValue(DEVICE_ID_STORAGE_KEY);
    if (stored) {
      setDeviceId(stored);
      return;
    }

    const created = createLocalId("rn-device");
    await setStoredValue(DEVICE_ID_STORAGE_KEY, created);
    setDeviceId(created);
  }

  async function restoreManualExams(): Promise<void> {
    try {
      const stored = await getStoredValue(MANUAL_EXAMS_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as ManualExamRecord[];
      if (!Array.isArray(parsed)) return;
      setManualExams(parsed.filter((item) => typeof item.title === "string" && typeof item.examDate === "string"));
    } catch {
      setManualExams([]);
    }
  }

  async function restoreGoogleCalendarConnection(ownerId?: string): Promise<void> {
    try {
      const stored = await getStoredValue(GOOGLE_CALENDAR_STORAGE_KEY);
      if (!stored || !ownerId) return;
      const parsed = JSON.parse(stored) as GoogleCalendarConnectionRecord;
      if (
        parsed.ownerId !== ownerId
        || typeof parsed.accountEmail !== "string"
        || typeof parsed.lastSyncedAt !== "string"
        || typeof parsed.result?.verified !== "number"
      ) return;
      setGoogleCalendarIntegration(parsed);
    } catch {
      setGoogleCalendarIntegration(null);
    }
  }

  async function persistGoogleCalendarConnection(record: GoogleCalendarConnectionRecord | null): Promise<void> {
    if (!record) {
      await deleteStoredValue(GOOGLE_CALENDAR_STORAGE_KEY);
      return;
    }
    await setStoredValue(GOOGLE_CALENDAR_STORAGE_KEY, JSON.stringify(record));
  }

  async function persistSession(nextSession: SessionPayload | null): Promise<void> {
    if (!nextSession) {
      await deleteStoredValue(SESSION_STORAGE_KEY);
      return;
    }

    await setStoredValue(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
  }

  async function activateSession(nextSession: SessionPayload): Promise<void> {
    sessionRef.current = nextSession;
    setSession(nextSession);
    await persistSession(nextSession);
  }

  async function clearExpiredSession(): Promise<void> {
    sessionRef.current = null;
    setSession(null);
    setAuthStage("auth");
    setActiveTab("home");
    setSelectedUniversityId("");
    await persistSession(null);
  }

  async function refreshAuthenticatedSession(expiredAccessToken?: string): Promise<SessionPayload | null> {
    const currentSession = sessionRef.current;
    if (!currentSession || !deviceId) return null;
    if (expiredAccessToken && currentSession.accessToken !== expiredAccessToken) return currentSession;
    if (refreshSessionPromiseRef.current) return refreshSessionPromiseRef.current;

    refreshSessionPromiseRef.current = (async () => {
      try {
        const nextSession = await apiRequest<SessionPayload>(
          "/auth/refresh-token",
          {
            method: "POST",
            body: JSON.stringify({
              refreshToken: currentSession.refreshToken,
              deviceId
            })
          },
          undefined,
          { skipAuthRefresh: true }
        );
        await activateSession(nextSession);
        return nextSession;
      } catch {
        await clearExpiredSession();
        return null;
      } finally {
        refreshSessionPromiseRef.current = null;
      }
    })();

    return refreshSessionPromiseRef.current;
  }

  async function apiRequest<T>(
    path: string,
    options: RequestInit = {},
    token?: string,
    requestOptions: { skipAuthRefresh?: boolean } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined)
    };

    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}${path}`, {
        ...options,
        headers
      });
    } catch {
      throw new ApiRequestError("Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.", 0);
    }

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 401 && token && !requestOptions.skipAuthRefresh) {
        const refreshedSession = await refreshAuthenticatedSession(token);
        if (refreshedSession) {
          return apiRequest<T>(path, options, refreshedSession.accessToken, { skipAuthRefresh: true });
        }
      }
      throw new ApiRequestError(parseApiErrorMessage(body, `${response.status} ${response.statusText}`, response.status), response.status);
    }

    return (await response.json()) as T;
  }

  async function withLoadable<T>(
    setter: (state: Loadable<T>) => void,
    action: () => Promise<T>
  ): Promise<T | null> {
    setter({ loading: true });
    try {
      const data = await action();
      setter({ loading: false, data });
      return data;
    } catch (error) {
      setter({
        loading: false,
        error: userMessageFromError(error, "İşlem tamamlanamadı. Lütfen tekrar dene.")
      });
      return null;
    }
  }

  async function bootstrapAuthenticatedContext(token: string): Promise<void> {
    const profile = await apiRequest<UserProfile>("/me", {}, token).catch(() => null);
    await loadPreferences(token);
    const profileUniversityId = profile?.universityId ?? "";
    if (profile?.universityId) {
      setSelectedUniversityId(profile.universityId);
      setRegisterUniversityId(profile.universityId);
      if (profile.facultyId) setRegisterFacultyId(profile.facultyId);
      if (profile.departmentId) setRegisterDepartmentId(profile.departmentId);
      await loadMyCalendar(token);
      await loadUpcoming(token);
    }
    await loadAnnouncements(token, profileUniversityId);
  }

  async function handleAuth(): Promise<void> {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Eksik alan", "E-posta ve şifre zorunludur.");
      return;
    }
    if (!deviceId) {
      Alert.alert("Hazırlanıyor", "Cihaz kimliği henüz hazır değil.");
      return;
    }

    try {
      setBusy(true);
      const isRegister = authMode === "register";
      if (!isRegister) {
        const nextSession = await apiRequest<SessionPayload>(
          "/auth/login",
          {
            method: "POST",
            body: JSON.stringify({
              email: email.trim().toLowerCase(),
              password: password.trim(),
              deviceId
            })
          }
        );

        setAuthStage("auth");
        setPendingVerifiedSession(null);
        await activateSession(nextSession);
        setActiveTab("home");
        setMessage({ text: "Giriş başarılı.", tone: "success" });
        await bootstrapAuthenticatedContext(nextSession.accessToken);
        return;
      }

      const registerResult = await apiRequest<RegisterResponse>(
        "/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            fullName: fullName.trim() || "Mobil Öğrenci",
            email: email.trim().toLowerCase(),
            password: password.trim(),
            passwordConfirmation: password.trim()
          })
        }
      );

      setAuthStage("verify");
      setRegisterPicker("none");
      setVerificationToken(registerResult.previewVerificationToken ?? "");
      setMessage({
        text: registerResult.previewVerificationToken ? "Doğrulama kodu hazır. Devam etmek için doğrulamayı tamamla." : "Doğrulama kodu e-postana gönderildi.",
        tone: "info"
      });
    } catch (error) {
      setMessage({
        text: userMessageFromError(error, "Giriş işlemi tamamlanamadı"),
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleAuth(): Promise<void> {
    if (!GOOGLE_AUTH_CONFIGURED) {
      setMessage({ text: GOOGLE_AUTH_CONFIGURATION_MESSAGE, tone: "error" });
      return;
    }
    if (!deviceId) {
      setMessage({ text: "Cihaz kimliği henüz hazır değil.", tone: "error" });
      return;
    }

    try {
      setGoogleBusy(true);
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      await clearGoogleAccountSelection();

      const result = await GoogleSignin.signIn();
      if (isCancelledResponse(result)) {
        setMessage({ text: "Google girişi tamamlanmadan kapatıldı.", tone: "info" });
        return;
      }

      let idToken = result.data.idToken;
      if (!idToken) {
        try {
          idToken = (await GoogleSignin.getTokens()).idToken;
        } catch {
          idToken = null;
        }
      }
      if (!idToken) {
        await clearGoogleAccountSelection();
        setMessage({ text: GOOGLE_ID_TOKEN_CONFIGURATION_MESSAGE, tone: "error" });
        return;
      }

      const nextSession = await apiRequest<SessionPayload>(
        "/auth/google",
        {
          method: "POST",
          body: JSON.stringify({ idToken, deviceId })
        }
      );

      setAuthStage("auth");
      setPendingVerifiedSession(null);
      await activateSession(nextSession);
      setActiveTab("home");
      setMessage({ text: "Google ile giriş başarılı.", tone: "success" });
      await bootstrapAuthenticatedContext(nextSession.accessToken);
    } catch (error) {
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
      if (error instanceof ApiRequestError && error.status === 401) {
        await clearGoogleAccountSelection();
        setMessage({
          text: "Google oturumu doğrulanamadı. Hesap seçimi sıfırlandı; tekrar deneyip farklı bir Google hesabı seçebilirsin.",
          tone: "error"
        });
        return;
      }
      setMessage({
        text: userMessageFromError(error, "Google girişi tamamlanamadı"),
        tone: "error"
      });
    } finally {
      setGoogleBusy(false);
    }
  }

  async function resendVerificationEmail(): Promise<void> {
    if (!registerIdentityReady) {
      setMessage({ text: "Kodu tekrar göndermek için önce kayıt bilgilerini tamamla.", tone: "error" });
      setAuthStage("auth");
      return;
    }

    if (!deviceId) {
      setMessage({ text: "Cihaz kimliği henüz hazır değil.", tone: "error" });
      return;
    }

    try {
      setBusy(true);
      const registerResult = await apiRequest<RegisterResponse>(
        "/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            fullName: fullName.trim() || "Mobil Öğrenci",
            email: email.trim().toLowerCase(),
            password: password.trim(),
            passwordConfirmation: password.trim()
          })
        }
      );

      setVerificationToken(registerResult.previewVerificationToken ?? "");
      setMessage({
        text: registerResult.previewVerificationToken ? "Doğrulama kodu yenilendi ve dolduruldu." : "Doğrulama kodu tekrar gönderildi.",
        tone: "info"
      });
    } catch (error) {
      setMessage({
        text: userMessageFromError(error, "Kod tekrar gönderilemedi"),
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyEmail(): Promise<void> {
    if (!verificationToken.trim()) {
      setMessage({ text: "Doğrulama kodu gereklidir.", tone: "error" });
      return;
    }

    if (!deviceId) {
      setMessage({ text: "Cihaz kimliği henüz hazır değil.", tone: "error" });
      return;
    }

    try {
      setBusy(true);
      await apiRequest<{ status: "verified"; email: string }>(
        "/auth/verify-email",
        {
          method: "POST",
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            code: verificationToken.trim(),
            deviceId
          })
        }
      );

      const nextSession = await apiRequest<SessionPayload>(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password: password.trim(),
            deviceId
          })
        }
      );

      setPendingVerifiedSession(nextSession);
      setAuthStage("profile_confirm");
      setMessage({ text: "E-posta doğrulandı. Son adım: profilini onayla.", tone: "success" });
    } catch (error) {
      setMessage({
        text: userMessageFromError(error, "E-posta doğrulanamadı"),
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmProfileAndStart(): Promise<void> {
    if (!pendingVerifiedSession) {
      setMessage({ text: "Oturum hazır değil. Doğrulama adımını tekrarla.", tone: "error" });
      setAuthStage("verify");
      return;
    }

    try {
      setBusy(true);
      const nextSession = pendingVerifiedSession;
      await activateSession(nextSession);
      setPendingVerifiedSession(null);
      setAuthStage("auth");
      setActiveTab("home");
      setMessage({ text: "Profilin onaylandı. Uygulamayı kullanmaya başlayabilirsin.", tone: "success" });
      await bootstrapAuthenticatedContext(nextSession.accessToken);
    } finally {
      setBusy(false);
    }
  }

  function returnToRegisterForm(): void {
    setAuthMode("register");
    setAuthStage("auth");
    setPendingVerifiedSession(null);
    setRegisterPicker("none");
    setVerificationToken("");
  }

  async function handleLogout(): Promise<void> {
    if (!session) return;

    try {
      setBusy(true);
      await apiRequest<{ status: "ok" }>(
        "/auth/logout",
        {
          method: "POST",
          body: JSON.stringify({ refreshToken: session.refreshToken })
        },
        session.accessToken,
        { skipAuthRefresh: true }
      );
    } catch {
      // Deliberately ignore logout network errors and continue local cleanup.
    } finally {
      setBusy(false);
      sessionRef.current = null;
      setSession(null);
      setAuthStage("auth");
      setActiveTab("home");
      setSelectedUniversityId("");
      setCalendar({ loading: false });
      setUpcoming({ loading: false });
      setAnnouncements({ loading: false });
      setYokAnnouncements({ loading: false });
      setSummerSchool({ loading: false });
      setPreferences({ loading: false });
      setGoogleCalendarIntegration(null);
      setGoogleCalendarError(null);
      if (GOOGLE_AUTH_CONFIGURED) {
        try {
          await GoogleSignin.signOut();
        } catch {
          // Ignore native Google sign-out failures during local cleanup.
        }
      }
      await persistSession(null);
      await persistGoogleCalendarConnection(null);
      setMessage({ text: "Çıkış yapıldı.", tone: "info" });
    }
  }

  async function loadUniversities(): Promise<void> {
    await withLoadable(setUniversities, () =>
      apiRequest<UniversityRecord[]>("/universities?limit=500&offset=0")
    );
  }

  async function loadFacultiesForRegistration(universityId: string): Promise<void> {
    if (!universityId) {
      setFaculties({ loading: false, data: [] });
      return;
    }

    await withLoadable(setFaculties, () =>
      apiRequest<FacultyRecord[]>(`/universities/${universityId}/faculties`)
    );
  }

  async function loadDepartmentsForRegistration(facultyId: string): Promise<void> {
    if (!facultyId) {
      setDepartments({ loading: false, data: [] });
      return;
    }

    await withLoadable(setDepartments, () =>
      apiRequest<DepartmentRecord[]>(`/faculties/${facultyId}/departments`)
    );
  }

  async function selectUniversity(universityId: string): Promise<void> {
    if (!accessToken) {
      setMessage({ text: "Üniversite bağlamak için önce giriş yapmalısın.", tone: "error" });
      return;
    }
    if (academicSelectionPendingRef.current) return;

    try {
      academicSelectionPendingRef.current = "university";
      setAcademicSelectionPending("university");
      await apiRequest<UserProfile>(
        "/me/university",
        {
          method: "PATCH",
          body: JSON.stringify({ universityId, classLevel: 2 })
        },
        accessToken
      );

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
    if (academicSelectionPendingRef.current) return;

    try {
      academicSelectionPendingRef.current = "faculty";
      setAcademicSelectionPending("faculty");
      await apiRequest<UserProfile>(
        "/me/university",
        {
          method: "PATCH",
          body: JSON.stringify({ universityId: registerUniversityId, facultyId, classLevel: 2 })
        },
        accessToken
      );

      setRegisterFacultyId(facultyId);
      setRegisterDepartmentId("");
      setDepartmentSearch("");
      setRegisterPicker("department");
      setAcademicProfileExpanded(true);
      setSummerSchool({ loading: false });
      setMessage({ text: "Fakülte güncellendi.", tone: "success" });

      void loadAnnouncements(accessToken, registerUniversityId);
    } catch (error) {
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
    if (academicSelectionPendingRef.current) return;

    try {
      academicSelectionPendingRef.current = "department";
      setAcademicSelectionPending("department");
      await apiRequest<UserProfile>(
        "/me/university",
        {
          method: "PATCH",
          body: JSON.stringify({
            universityId: registerUniversityId,
            facultyId: registerFacultyId,
            departmentId,
            classLevel: 2
          })
        },
        accessToken
      );

      setRegisterDepartmentId(departmentId);
      setRegisterPicker("none");
      setSummerSchool({ loading: false });
      setMessage({ text: "Bölüm güncellendi.", tone: "success" });

      void loadAnnouncements(accessToken, registerUniversityId);
    } catch (error) {
      setMessage({
        text: userMessageFromError(error, "Bölüm seçimi güncellenemedi"),
        tone: "error"
      });
    } finally {
      academicSelectionPendingRef.current = null;
      setAcademicSelectionPending(null);
    }
  }

  async function loadMyCalendar(tokenOverride?: string): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(setCalendar, () => apiRequest<CalendarPayload>("/calendar/my", {}, token));
  }

  async function loadUpcoming(tokenOverride?: string): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(setUpcoming, () => apiRequest<EventRecord[]>("/calendar/upcoming?limit=10", {}, token));
  }

  async function loadAnnouncements(tokenOverride?: string, universityIdOverride?: string): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    const universityId = universityIdOverride ?? registerUniversityId;
    if (!universityId) {
      setAnnouncements({ loading: false, data: [] });
      return;
    }

    await withLoadable(setAnnouncements, () => apiRequest<AnnouncementRecord[]>("/announcements/my?limit=60", {}, token));
  }

  async function loadYokAnnouncements(): Promise<void> {
    await withLoadable(setYokAnnouncements, () => apiRequest<AnnouncementRecord[]>("/announcements/yok?limit=30"));
  }

  async function loadSummerSchool(tokenOverride?: string, universityIdOverride?: string): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    const universityId = universityIdOverride ?? registerUniversityId;
    if (!universityId) {
      setSummerSchool({ loading: false });
      return;
    }

    await withLoadable(setSummerSchool, () => apiRequest<SummerSchoolPayload>("/calendar/summer-school/my", {}, token));
  }

  async function loadPreferences(tokenOverride?: string): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(setPreferences, () => apiRequest<NotificationPreferencePayload>("/notification-preferences", {}, token));
  }

  async function authorizeGoogleCalendar(forceAccountSelection: boolean): Promise<{ accessToken: string; accountEmail: string }> {
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
  }

  async function syncGoogleCalendar(forceAccountSelection = false): Promise<void> {
    const currentSession = sessionRef.current;
    if (!currentSession?.accessToken) {
      setGoogleCalendarError("Google Takvim bağlantısı için yeniden giriş yapmalısın.");
      return;
    }

    setGoogleCalendarError(null);
    setMessage(null);
    setGoogleCalendarBusy(true);
    let googleAccessToken: string | undefined;

    try {
      const authorization = await authorizeGoogleCalendar(forceAccountSelection);
      googleAccessToken = authorization.accessToken;
      const [calendarResult, announcementResult] = await Promise.allSettled([
        apiRequest<CalendarPayload>("/calendar/my", {}, currentSession.accessToken),
        apiRequest<AnnouncementRecord[]>("/announcements/my?limit=100", {}, currentSession.accessToken)
      ]);
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
        replaceSourceTypes
      });
      const connection: GoogleCalendarConnectionRecord = {
        ownerId: currentSession.user.id,
        accountEmail: authorization.accountEmail,
        lastSyncedAt: new Date().toISOString(),
        result,
        ...(warnings.length > 0 ? { warnings } : {})
      };
      setGoogleCalendarIntegration(connection);
      await persistGoogleCalendarConnection(connection);

      if (result.verified === 0) {
        setGoogleCalendarError("Profiline ait aktarılabilir akademik tarih, duyuru veya etkinlik bulunamadı.");
      } else {
        setMessage({
          text: `${result.verified} kayıt ${authorization.accountEmail} hesabının Google Takvimi'nde doğrulandı.`,
          tone: "success"
        });
      }
    } catch (error) {
      if (error instanceof Error && error.message === "GOOGLE_CALENDAR_CANCELLED") {
        setGoogleCalendarError("Google hesabı veya Takvim izni seçimi tamamlanmadı.");
      } else if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
        setGoogleCalendarError("Google hesabı veya Takvim izni seçimi tamamlanmadı.");
      } else if (isErrorWithCode(error) && error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setGoogleCalendarError("Google Play Hizmetleri bu cihazda hazır değil veya güncellenmeli.");
      } else if (isErrorWithCode(error) && error.code === statusCodes.IN_PROGRESS) {
        setGoogleCalendarError("Google hesabı seçimi zaten devam ediyor.");
      } else {
        if (
          googleAccessToken
          && error instanceof GoogleCalendarSyncError
          && error.code === "GOOGLE_CALENDAR_AUTH_EXPIRED"
        ) {
          await GoogleSignin.clearCachedAccessToken(googleAccessToken).catch(() => null);
        }
        setGoogleCalendarError(googleCalendarUserMessage(error));
      }
    } finally {
      setGoogleCalendarBusy(false);
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

    const categoryPayload: Record<string, boolean> = {};
    for (const category of availableCategories) {
      categoryPayload[category] = alarmMode === "all_calendar" ? true : Boolean(categoryDraft[category]);
    }

    const existing = preferences.data;
    const reminderOffsets = existing?.reminderOffsets.length ? existing.reminderOffsets : DEFAULT_REMINDER_OFFSETS;
    const reminderRules = existing?.reminderRules?.length ? existing.reminderRules : DEFAULT_REMINDER_RULES;

    try {
      setBusy(true);
      const updated = await apiRequest<NotificationPreferencePayload>(
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
      );

      setPreferences({ loading: false, data: updated });
      setMessage({ text: "Alarm ayarları kaydedildi.", tone: "success" });
    } catch (error) {
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

          {!session && authStage === "auth" && (
            <Section title="Giriş ve Kayıt">
              <View style={styles.row}>
                <Pressable
                  style={[styles.modeButton, authMode === "login" && styles.modeButtonActive]}
                  onPress={() => {
                    setAuthMode("login");
                    setAuthStage("auth");
                  }}
                >
                  <Text style={[styles.modeButtonText, authMode === "login" && styles.modeButtonTextActive]}>Giriş Yap</Text>
                </Pressable>
                <Pressable
                  style={[styles.modeButton, authMode === "register" && styles.modeButtonActive]}
                  onPress={() => {
                    setAuthMode("register");
                    setAuthStage("auth");
                  }}
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
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      placeholder="En az 8 karakter önerilir"
                      placeholderTextColor={AUTH_INPUT_PLACEHOLDER_COLOR}
                      secureTextEntry
                      textContentType="newPassword"
                      autoComplete="new-password"
                      style={styles.input}
                    />
                  </View>

                  <Text style={styles.helperText}>Kayıt yalnızca hesap bilgileriyle tamamlanır. Üniversite, fakülte ve bölümünü uygulama içinde seçebilirsin.</Text>

                  <Pressable
                    style={[
                      styles.button,
                      styles.primaryButton,
                      (busy || !registerIdentityReady) && styles.buttonDisabled
                    ]}
                    onPress={() => void handleAuth()}
                    disabled={busy || !registerIdentityReady}
                  >
                    <Text style={styles.primaryButtonText}>Hesap Oluştur</Text>
                  </Pressable>
                  {!registerIdentityReady && (
                    <Text style={styles.caption}>Devam etmek için ad soyad, e-posta ve şifre alanlarını doldur.</Text>
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
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      placeholder="Şifreni gir"
                      placeholderTextColor={AUTH_INPUT_PLACEHOLDER_COLOR}
                      secureTextEntry
                      textContentType="password"
                      autoComplete="password"
                      style={styles.input}
                    />
                  </View>

                  <Pressable
                    style={[styles.button, styles.primaryButton, (busy || !loginReady) && styles.buttonDisabled]}
                    onPress={() => void handleAuth()}
                    disabled={busy || !loginReady}
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

                <TextInput
                  value={verificationToken}
                  onChangeText={setVerificationToken}
                  placeholder="Doğrulama kodu"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />

                <Pressable style={[styles.button, styles.primaryButton, busy && styles.buttonDisabled]} onPress={() => void handleVerifyEmail()} disabled={busy}>
                  <Text style={styles.primaryButtonText}>Doğrulamayı Tamamla</Text>
                </Pressable>

                <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void resendVerificationEmail()} disabled={busy}>
                  <Text style={styles.secondaryButtonText}>Kodu Tekrar Gönder</Text>
                </Pressable>

                <Pressable style={styles.textActionButton} onPress={returnToRegisterForm} disabled={busy}>
                  <Text style={styles.textActionText}>Kayıt bilgilerimi düzenle</Text>
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

              <Text style={styles.helperText}>Hesabın hazır. Akademik profilini giriş yaptıktan sonra içeride seçeceksin.</Text>

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
                <Text style={styles.primaryButtonText}>Profili Onayla ve Başla</Text>
              </Pressable>

              <Pressable style={styles.textActionButton} onPress={returnToRegisterForm} disabled={busy}>
                <Text style={styles.textActionText}>Bilgilerimi düzenle</Text>
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
                    style={[styles.button, styles.primaryButton, googleCalendarBusy && styles.buttonDisabled]}
                    onPress={() => void syncGoogleCalendar(!googleCalendarIntegration)}
                    disabled={googleCalendarBusy}
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
                      style={[styles.button, styles.secondaryButton, googleCalendarBusy && styles.buttonDisabled]}
                      onPress={() => void syncGoogleCalendar(true)}
                      disabled={googleCalendarBusy}
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
                      style={[styles.button, styles.secondaryButton, (universities.loading || academicSelectionPending) && styles.buttonDisabled]}
                      onPress={() => void loadUniversities()}
                      disabled={universities.loading || Boolean(academicSelectionPending)}
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
                    style={styles.selectorTrigger}
                    onPress={() => {
                      setRegisterPicker((prev) => (prev === "university" ? "none" : "university"));
                      if (!(universities.data ?? []).length) void loadUniversities();
                    }}
                    disabled={Boolean(academicSelectionPending)}
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
                          disabled={Boolean(academicSelectionPending)}
                        >
                          <Text style={styles.universityName}>{university.name}</Text>
                          <Text style={styles.universityMeta}>{university.city} | {UNIVERSITY_TYPE_LABELS[university.type] ?? university.type}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  <Pressable
                    style={[styles.selectorTrigger, !registerUniversityId && styles.selectorTriggerDisabled]}
                    onPress={() => setRegisterPicker((prev) => (prev === "faculty" ? "none" : "faculty"))}
                    disabled={!registerUniversityId || Boolean(academicSelectionPending)}
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
                          disabled={Boolean(academicSelectionPending)}
                        >
                          <Text style={styles.universityName}>{faculty.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  <Pressable
                    style={[styles.selectorTrigger, !registerFacultyId && styles.selectorTriggerDisabled]}
                    onPress={() => setRegisterPicker((prev) => (prev === "department" ? "none" : "department"))}
                    disabled={!registerFacultyId || Boolean(academicSelectionPending)}
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
                          disabled={Boolean(academicSelectionPending)}
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

                <Pressable style={[styles.button, styles.primaryButton]} onPress={() => void saveAlarmSettings()} disabled={busy}>
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
    fontSize: 15
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
    backgroundColor: "#5c6ef0",
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
    minHeight: 44
  },
  modeButtonActive: {
    backgroundColor: "#5c6ef0",
    borderColor: "#5c6ef0",
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
  textActionButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36
  },
  textActionText: {
    color: "#5c6ef0",
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
