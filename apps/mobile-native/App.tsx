import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, useEffect, useMemo, useState } from "react";
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

WebBrowser.maybeCompleteAuthSession();

type AuthMode = "login" | "register";
type AlarmMode = "all_calendar" | "selected_fields";
type TabId = "profile" | "announcements" | "home" | "calendar";
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
  scopeType: "university" | "faculty" | "department";
  scopeId: string;
  title: string;
  link: string;
  publishedAt?: string;
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

const GOOGLE_EXPO_CLIENT_ID = cleanEnvValue(process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID);
const GOOGLE_WEB_CLIENT_ID = cleanEnvValue(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) ?? GOOGLE_EXPO_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = cleanEnvValue(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
const GOOGLE_ANDROID_CLIENT_ID = cleanEnvValue(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID);
const GOOGLE_PLACEHOLDER_CLIENT_ID = "google-auth-not-configured.apps.googleusercontent.com";
const GOOGLE_PLATFORM_CLIENT_ID = Platform.select({
  android: GOOGLE_ANDROID_CLIENT_ID,
  ios: GOOGLE_IOS_CLIENT_ID,
  default: GOOGLE_WEB_CLIENT_ID
});
const GOOGLE_AUTH_CONFIGURED = Boolean(GOOGLE_PLATFORM_CLIENT_ID);
const GOOGLE_AUTH_CONFIGURATION_MESSAGE = Platform.select({
  android: "Google girişi için EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID değeri gerekiyor.",
  ios: "Google girişi için EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID değeri gerekiyor.",
  default: "Google girişi için EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID değeri gerekiyor."
}) ?? "Google girişi için platform client ID değeri gerekiyor.";

function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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

function isUniversityAnnouncement(item: AnnouncementRecord): boolean {
  return !item.scopeType || item.scopeType === "university";
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
  const [googleRequest, , promptGoogleAuth] = Google.useIdTokenAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID ?? GOOGLE_PLACEHOLDER_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID ?? GOOGLE_PLACEHOLDER_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID ?? GOOGLE_PLACEHOLDER_CLIENT_ID,
    selectAccount: true
  });

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
  const [preferences, setPreferences] = useState<Loadable<NotificationPreferencePayload>>({ loading: false });
  const [manualExams, setManualExams] = useState<ManualExamRecord[]>([]);
  const [manualExamTitle, setManualExamTitle] = useState("");
  const [manualExamDate, setManualExamDate] = useState("");

  const [selectedUniversityId, setSelectedUniversityId] = useState("");
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [alarmMode, setAlarmMode] = useState<AlarmMode>("all_calendar");
  const [categoryDraft, setCategoryDraft] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "success" | "error" } | null>(null);

  const accessToken = session?.accessToken;
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
  useEffect(() => {
    const initialize = async () => {
      await restoreDeviceId();
      await restoreManualExams();
      const restoredSession = await restoreSession();
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

  async function persistSession(nextSession: SessionPayload | null): Promise<void> {
    if (!nextSession) {
      await deleteStoredValue(SESSION_STORAGE_KEY);
      return;
    }

    await setStoredValue(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
  }

  async function apiRequest<T>(
    path: string,
    options: RequestInit = {},
    token?: string
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
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`API bağlantısı kurulamadı (${apiBaseUrl}). Telefon ve bilgisayarın aynı Wi-Fi ağında olduğundan ve 3000 portunun erişilebilir olduğundan emin ol. ${detail}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `${response.status} ${response.statusText}`);
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
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async function bootstrapAuthenticatedContext(token: string): Promise<void> {
    const profile = await apiRequest<UserProfile>("/me", {}, token).catch(() => null);
    await loadPreferences(token);
    await loadAnnouncements(token);
    if (profile?.universityId) {
      setSelectedUniversityId(profile.universityId);
      setRegisterUniversityId(profile.universityId);
      if (profile.facultyId) setRegisterFacultyId(profile.facultyId);
      if (profile.departmentId) setRegisterDepartmentId(profile.departmentId);
      await loadMyCalendar(token);
      await loadUpcoming(token);
    }
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
        setSession(nextSession);
        await persistSession(nextSession);
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
        text: error instanceof Error ? error.message : "Giriş işlemi tamamlanamadı",
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
    if (!googleRequest) {
      setMessage({ text: "Google girişi hazırlanıyor. Birkaç saniye sonra tekrar dene.", tone: "info" });
      return;
    }
    if (!deviceId) {
      setMessage({ text: "Cihaz kimliği henüz hazır değil.", tone: "error" });
      return;
    }

    try {
      setGoogleBusy(true);
      const result = await promptGoogleAuth();
      if (result.type === "cancel" || result.type === "dismiss") {
        setMessage({ text: "Google girişi tamamlanmadan kapatıldı.", tone: "info" });
        return;
      }
      if (result.type !== "success") {
        setMessage({ text: "Google girişi tamamlanamadı.", tone: "error" });
        return;
      }

      const idToken = result.params.id_token;
      if (!idToken) {
        setMessage({ text: "Google kimlik belirteci alınamadı.", tone: "error" });
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
      setSession(nextSession);
      await persistSession(nextSession);
      setActiveTab("home");
      setMessage({ text: "Google ile giriş başarılı.", tone: "success" });
      await bootstrapAuthenticatedContext(nextSession.accessToken);
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Google girişi tamamlanamadı",
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
        text: error instanceof Error ? error.message : "Kod tekrar gönderilemedi",
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
        text: error instanceof Error ? error.message : "E-posta doğrulanamadı",
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
      setSession(nextSession);
      await persistSession(nextSession);
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
        session.accessToken
      );
    } catch {
      // Deliberately ignore logout network errors and continue local cleanup.
    } finally {
      setBusy(false);
      setSession(null);
      setAuthStage("auth");
      setActiveTab("home");
      setSelectedUniversityId("");
      setCalendar({ loading: false });
      setUpcoming({ loading: false });
      setAnnouncements({ loading: false });
      setPreferences({ loading: false });
      await persistSession(null);
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

    try {
      setBusy(true);
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
      setDepartments({ loading: false, data: [] });
      await loadFacultiesForRegistration(universityId);
      await loadMyCalendar(accessToken);
      await loadUpcoming(accessToken);
      await loadAnnouncements(accessToken);
      await loadPreferences(accessToken);
      setMessage({ text: "Üniversite güncellendi.", tone: "success" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Üniversite seçimi güncellenemedi",
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function selectFaculty(facultyId: string): Promise<void> {
    if (!accessToken || !registerUniversityId) {
      setMessage({ text: "Fakülte seçmek için önce üniversite seçmelisin.", tone: "error" });
      return;
    }

    try {
      setBusy(true);
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
      await loadDepartmentsForRegistration(facultyId);
      await loadMyCalendar(accessToken);
      await loadUpcoming(accessToken);
      await loadAnnouncements(accessToken);
      setMessage({ text: "Fakülte güncellendi.", tone: "success" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Fakülte seçimi güncellenemedi",
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function selectDepartment(departmentId: string): Promise<void> {
    if (!accessToken || !registerUniversityId || !registerFacultyId) {
      setMessage({ text: "Bölüm seçmek için önce üniversite ve fakülte seçmelisin.", tone: "error" });
      return;
    }

    try {
      setBusy(true);
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
      await loadMyCalendar(accessToken);
      await loadUpcoming(accessToken);
      await loadAnnouncements(accessToken);
      setMessage({ text: "Bölüm güncellendi.", tone: "success" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Bölüm seçimi güncellenemedi",
        tone: "error"
      });
    } finally {
      setBusy(false);
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

  async function loadAnnouncements(tokenOverride?: string): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(setAnnouncements, () => apiRequest<AnnouncementRecord[]>("/announcements/my?limit=20", {}, token));
  }

  async function loadPreferences(tokenOverride?: string): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(setPreferences, () => apiRequest<NotificationPreferencePayload>("/notification-preferences", {}, token));
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
        text: error instanceof Error ? error.message : "Alarm ayarları kaydedilemedi",
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function registerDevice(): Promise<void> {
    if (!accessToken) {
      setMessage({ text: "Cihaz kaydı için giriş yapmalısın.", tone: "error" });
      return;
    }

    try {
      setBusy(true);
      const token = `rn-demo-${deviceId}-${Date.now()}`;
      const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";

      await apiRequest<{ status: string }>(
        "/devices/register",
        {
          method: "POST",
          body: JSON.stringify({ platform, token })
        },
        accessToken
      );

      setMessage({ text: "Cihaz bildirimi etkinleştirildi.", tone: "success" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Cihaz kaydı başarısız",
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
        <ScrollView contentContainerStyle={[styles.container, session ? styles.containerWithNav : undefined]}>
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

              <Pressable
                style={[styles.button, styles.googleButton, (busy || googleBusy || !GOOGLE_AUTH_CONFIGURED) && styles.buttonDisabled]}
                onPress={() => void handleGoogleAuth()}
                disabled={busy || googleBusy || !GOOGLE_AUTH_CONFIGURED}
              >
                <Ionicons name="logo-google" size={19} color="#1f2937" />
                <Text style={styles.googleButtonText}>{googleBusy ? "Google açılıyor..." : "Google ile Devam Et"}</Text>
              </Pressable>
              {!GOOGLE_AUTH_CONFIGURED && (
                <Text style={styles.caption}>{GOOGLE_AUTH_CONFIGURATION_MESSAGE}</Text>
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

                  <TextInput
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder="Ad Soyad"
                    style={styles.input}
                  />
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="Öğrenci e-posta adresi"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Şifre"
                    secureTextEntry
                    style={styles.input}
                  />

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

                  <View style={styles.inlineInfoCard}>
                    <Text style={styles.inlineInfoTitle}>Sonraki adım: E-posta doğrulama</Text>
                    <Text style={styles.inlineInfoText}>Hesap oluşturduktan sonra seni ayrıca doğrulama ekranına yönlendireceğiz.</Text>
                  </View>
                </>
              ) : (
                <>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="Öğrenci e-posta adresi"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />

                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Şifre"
                    secureTextEntry
                    style={styles.input}
                  />

                  <Pressable style={[styles.button, styles.primaryButton, busy && styles.buttonDisabled]} onPress={() => void handleAuth()} disabled={busy}>
                    <Text style={styles.primaryButtonText}>Giriş Yap</Text>
                  </Pressable>
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
              <Section title="Sınav Geri Sayımı">
                <Text style={styles.helperText}>Takvimindeki sınav tarihlerini takip et. İstersen manuel sınav da ekleyebilirsin.</Text>

                {examCountdownItems.length === 0 && (
                  <Text style={styles.caption}>Yaklaşan sınav bulunamadı.</Text>
                )}

                {examCountdownItems.map((exam) => (
                  <View key={exam.id} style={styles.eventCard}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.eventTitle}>{exam.title}</Text>
                      <Text style={styles.countdownBadge}>{formatRemainingDuration(exam.examDate)}</Text>
                    </View>
                    <Text style={styles.caption}>{new Date(exam.examDate).toLocaleString()}</Text>
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
                <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void loadUpcoming()} disabled={upcoming.loading || busy}>
                  <Text style={styles.secondaryButtonText}>Listeyi Yenile</Text>
                </Pressable>

                {upcoming.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                {upcoming.error && <Text style={styles.errorText}>{upcoming.error}</Text>}

                {(upcoming.data ?? []).map((event) => (
                  <View key={event.id} style={styles.eventCard}>
                    <Text style={styles.eventTitle}>{event.title}</Text>
                    <Text style={styles.caption}>{new Date(event.startDate).toLocaleDateString()}</Text>
                  </View>
                ))}
              </Section>
            </>
          )}

          {session && activeTab === "calendar" && (
            <Section title="Akademik Takvim">
              <View style={styles.rowBetween}>
                <Text style={styles.caption}>Durum: {calendar.data?.calendar.status ? STATUS_LABELS[calendar.data.calendar.status] ?? calendar.data.calendar.status : "yüklenmedi"}</Text>
                <Pressable style={[styles.buttonInline, styles.secondaryOutline]} onPress={() => void loadMyCalendar()} disabled={busy}>
                  <Text style={styles.secondaryOutlineText}>Yenile</Text>
                </Pressable>
              </View>
              {calendar.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
              {calendar.error && <Text style={styles.errorText}>{calendar.error}</Text>}
              {calendar.data?.calendar && (
                <View style={styles.cardMuted}>
                  <Text style={styles.cardTitle}>{calendar.data.calendar.title}</Text>
                  <Text style={styles.caption}>Akademik Yıl: {calendar.data.calendar.academicYear}</Text>
                </View>
              )}
              <Text style={styles.helperText}>Seçili üniversitenin tek merkezi akademik takvimi gösterilir.</Text>
              {(calendar.data?.events ?? []).filter(isUniversityAcademicCalendarEvent).map((event) => (
                <View key={event.id} style={styles.eventCard}>
                  <Text style={styles.eventCategory}>{toCategoryLabel(event.category)}</Text>
                  <Text style={styles.eventTitle}>{event.title}</Text>
                  <Text style={styles.caption}>{new Date(event.startDate).toLocaleDateString()}</Text>
                </View>
              ))}
            </Section>
          )}

          {session && activeTab === "announcements" && (
            <Section title="Duyurular">
              <Text style={styles.helperText}>Seçili üniversitenin resmi duyuruları listelenir.</Text>

              <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void loadAnnouncements()} disabled={announcements.loading || busy}>
                <Text style={styles.secondaryButtonText}>Duyuruları Yenile</Text>
              </Pressable>

              {announcements.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
              {announcements.error && <Text style={styles.errorText}>{announcements.error}</Text>}

              {(announcements.data ?? []).filter(isUniversityAnnouncement).map((item) => (
                <Pressable key={item.id} style={styles.eventCard} onPress={() => void openAnnouncement(item.link)}>
                  <Text style={styles.eventCategory}>{item.sourceName}</Text>
                  <Text style={styles.eventTitle}>{item.title}</Text>
                  {item.publishedAt && <Text style={styles.caption}>{new Date(item.publishedAt).toLocaleString()}</Text>}
                  <Text style={styles.linkText}>Kaynağı Aç</Text>
                </Pressable>
              ))}

              {!announcements.loading && (announcements.data ?? []).filter(isUniversityAnnouncement).length === 0 && (
                <Text style={styles.caption}>Bu üniversite için duyuru bulunamadı.</Text>
              )}
            </Section>
          )}

          {session && activeTab === "profile" && (
            <>
              <Section title="Profilim">
                <View style={styles.sessionInfo}>
                  <Text style={styles.sessionText}>E-posta: {session.user.email}</Text>
                  <Text style={styles.sessionText}>Rol: {ROLE_LABELS[session.user.role] ?? session.user.role}</Text>
                  <Text style={styles.sessionText}>Cihaz: {deviceId || "hazırlanıyor..."}</Text>
                  <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void handleLogout()} disabled={busy}>
                    <Text style={styles.secondaryButtonText}>Çıkış Yap</Text>
                  </Pressable>
                </View>
              </Section>

              <Section title="Akademik Profil">
                <View style={styles.summaryCard}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryKey}>Üniversite</Text>
                    <Text style={styles.summaryValue}>{selectedUniversity?.name ?? "Seçilmedi"}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryKey}>Fakülte</Text>
                    <Text style={styles.summaryValue}>{selectedFaculty?.name ?? "Seçilmedi"}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryKey}>Bölüm</Text>
                    <Text style={styles.summaryValue}>{selectedDepartment?.name ?? "Seçilmedi"}</Text>
                  </View>
                </View>

                <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void loadUniversities()} disabled={universities.loading || busy}>
                  <Text style={styles.secondaryButtonText}>Üniversiteleri Yenile</Text>
                </Pressable>

                {universities.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                {universities.error && <Text style={styles.errorText}>{universities.error}</Text>}

                <View style={styles.selectorGroup}>
                  <Pressable
                    style={styles.selectorTrigger}
                    onPress={() => {
                      setRegisterPicker((prev) => (prev === "university" ? "none" : "university"));
                      if (!(universities.data ?? []).length) void loadUniversities();
                    }}
                    disabled={busy}
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
                          disabled={busy}
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
                    disabled={!registerUniversityId || busy}
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
                          disabled={busy}
                        >
                          <Text style={styles.universityName}>{faculty.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  <Pressable
                    style={[styles.selectorTrigger, !registerFacultyId && styles.selectorTriggerDisabled]}
                    onPress={() => setRegisterPicker((prev) => (prev === "department" ? "none" : "department"))}
                    disabled={!registerFacultyId || busy}
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
                          disabled={busy}
                        >
                          <Text style={styles.universityName}>{department.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              </Section>

              <Section title="Alarm Ayarları">
                <Text style={styles.helperText}>Tüm Takvim modu tüm kategorilerde alarm açarken, Seçili Alanlar sadece seçtiklerin için alarm açar.</Text>

                <View style={styles.rowBetween}>
                  <Text style={styles.label}>Alarmları Etkinleştir</Text>
                  <Switch value={alarmEnabled} onValueChange={setAlarmEnabled} />
                </View>

                <View style={styles.row}>
                  <Pressable
                    style={[styles.modeButton, alarmMode === "all_calendar" && styles.modeButtonActive]}
                    onPress={() => updateAlarmMode("all_calendar")}
                  >
                    <Text style={[styles.modeButtonText, alarmMode === "all_calendar" && styles.modeButtonTextActive]}>Tüm Takvim</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.modeButton, alarmMode === "selected_fields" && styles.modeButtonActive]}
                    onPress={() => updateAlarmMode("selected_fields")}
                  >
                    <Text style={[styles.modeButtonText, alarmMode === "selected_fields" && styles.modeButtonTextActive]}>Seçili Alanlar</Text>
                  </Pressable>
                </View>

                {alarmMode === "selected_fields" && availableCategories.map((category) => (
                  <View key={category} style={styles.rowBetween}>
                    <Text style={styles.label}>{toCategoryLabel(category)}</Text>
                    <Switch
                      value={Boolean(categoryDraft[category])}
                      onValueChange={(enabled) => updateCategory(category, enabled)}
                    />
                  </View>
                ))}

                <Pressable style={[styles.button, styles.primaryButton]} onPress={() => void saveAlarmSettings()} disabled={busy}>
                  <Text style={styles.primaryButtonText}>Alarm Ayarlarını Kaydet</Text>
                </Pressable>
              </Section>

              <Section title="Cihaz Bildirimleri">
                <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void registerDevice()} disabled={busy}>
                  <Text style={styles.secondaryButtonText}>Cihazı Bildirim İçin Kaydet</Text>
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
              { id: "announcements" as TabId, label: "Duyurular", icon: "notifications" },
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
    paddingBottom: 106
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
    letterSpacing: -0.5
  },
  authHeroSubtitle: {
    color: "rgba(255,255,255,0.75)",
    lineHeight: 20,
    fontWeight: "500"
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
    letterSpacing: -0.3
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
    color: "#94a3b8"
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
    paddingHorizontal: 16
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
    letterSpacing: -0.1
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
    letterSpacing: 0.5,
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
    letterSpacing: -0.3
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
  cardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.2
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
  eventCategory: {
    color: "#5c6ef0",
    fontWeight: "700",
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase"
  },
  eventTitle: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "700"
  },
  countdownBadge: {
    borderRadius: 999,
    backgroundColor: "#eef0fd",
    color: "#4554e0",
    fontWeight: "800",
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: "hidden"
  },
  linkText: {
    color: "#5c6ef0",
    fontWeight: "800"
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
    left: 12,
    right: 12,
    bottom: 16,
    borderRadius: 28,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 6,
    elevation: 12
  },
  bottomNavItem: {
    flex: 1,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 2
  },
  bottomNavItemActive: {
    backgroundColor: "#5c6ef0"
  },
  bottomNavLabel: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: 0.2
  },
  bottomNavLabelActive: {
    color: "#ffffff",
    fontWeight: "700"
  }
});
