import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
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
};

type CalendarPayload = {
  calendar: CalendarRecord;
  events: EventRecord[];
};

type NotificationPreferencePayload = {
  enabled: boolean;
  categories: Record<string, boolean>;
  reminderOffsets: number[];
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
const DEFAULT_REMINDER_OFFSETS = [7, 3, 1];

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
  "midterm_exam",
  "final_exam",
  "makeup_exam",
  "single_course_exam",
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
  academic_year_start: "Academic Year Start",
  academic_year_end: "Academic Year End",
  fall_term_start: "Fall Term Start",
  fall_term_end: "Fall Term End",
  spring_term_start: "Spring Term Start",
  spring_term_end: "Spring Term End",
  course_registration: "Course Registration",
  course_renewal: "Course Renewal",
  course_add_drop: "Add / Drop",
  midterm_exam: "Midterm",
  final_exam: "Final",
  makeup_exam: "Makeup",
  single_course_exam: "Single Course Exam",
  graduation_application: "Graduation Application",
  tuition_payment: "Tuition Payment",
  horizontal_transfer: "Horizontal Transfer",
  summer_school_registration: "Summer School Registration",
  summer_school_start: "Summer School Start",
  summer_school_end: "Summer School End",
  holiday: "Holiday",
  orientation: "Orientation",
  custom_event: "Custom Event"
};

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
  if (Number.isNaN(target)) return "tarih hatali";

  const deltaMs = target - Date.now();
  if (deltaMs <= 0) return "bugun";

  const totalHours = Math.floor(deltaMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days === 0) return `${hours}s kaldi`;
  return `${days}g ${hours}s kaldi`;
}

function toCategoryLabel(category: string): string {
  if (CATEGORY_LABELS[category]) return CATEGORY_LABELS[category];
  return category
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
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
  const [preferences, setPreferences] = useState<Loadable<NotificationPreferencePayload>>({ loading: false });
  const [manualExams, setManualExams] = useState<ManualExamRecord[]>([]);
  const [manualExamTitle, setManualExamTitle] = useState("");
  const [manualExamDate, setManualExamDate] = useState("");

  const [selectedUniversityId, setSelectedUniversityId] = useState("");
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [alarmMode, setAlarmMode] = useState<AlarmMode>("all_calendar");
  const [categoryDraft, setCategoryDraft] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
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
  const registerAcademicReady = Boolean(registerUniversityId && registerFacultyId && registerDepartmentId);

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

    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers
    });

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
      Alert.alert("Eksik alan", "E-posta ve sifre zorunludur.");
      return;
    }
    if (!deviceId) {
      Alert.alert("Hazirlaniyor", "Cihaz kimligi henuz hazir degil.");
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
        setMessage({ text: "Giris basarili.", tone: "success" });
        await bootstrapAuthenticatedContext(nextSession.accessToken);
        return;
      }

      if (!registerUniversityId || !registerFacultyId || !registerDepartmentId) {
        setMessage({ text: "Universite, fakulte ve bolum secimi zorunludur.", tone: "error" });
        return;
      }

      await apiRequest<RegisterResponse>(
        "/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            fullName: fullName.trim() || "Native Student",
            email: email.trim().toLowerCase(),
            password: password.trim(),
            deviceId,
            universityId: registerUniversityId,
            facultyId: registerFacultyId,
            departmentId: registerDepartmentId
          })
        }
      );

      setAuthStage("verify");
      setRegisterPicker("none");
      setVerificationToken("");
      setMessage({ text: "Dogrulama kodu e-postana gonderildi.", tone: "info" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Giris islemi tamamlanamadi",
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function resendVerificationEmail(): Promise<void> {
    if (!registerIdentityReady || !registerAcademicReady) {
      setMessage({ text: "Kodu tekrar gondermek icin once kayit bilgilerini tamamla.", tone: "error" });
      setAuthStage("auth");
      return;
    }

    if (!deviceId) {
      setMessage({ text: "Cihaz kimligi henuz hazir degil.", tone: "error" });
      return;
    }

    try {
      setBusy(true);
      await apiRequest<RegisterResponse>(
        "/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            fullName: fullName.trim() || "Native Student",
            email: email.trim().toLowerCase(),
            password: password.trim(),
            deviceId,
            universityId: registerUniversityId,
            facultyId: registerFacultyId,
            departmentId: registerDepartmentId
          })
        }
      );

      setVerificationToken("");
      setMessage({ text: "Dogrulama kodu tekrar gonderildi.", tone: "info" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Kod tekrar gonderilemedi",
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyEmail(): Promise<void> {
    if (!verificationToken.trim()) {
      setMessage({ text: "Dogrulama kodu gereklidir.", tone: "error" });
      return;
    }

    if (!deviceId) {
      setMessage({ text: "Cihaz kimligi henuz hazir degil.", tone: "error" });
      return;
    }

    try {
      setBusy(true);
      const nextSession = await apiRequest<SessionPayload>(
        "/auth/verify-email",
        {
          method: "POST",
          body: JSON.stringify({ token: verificationToken.trim(), deviceId })
        }
      );

      setPendingVerifiedSession(nextSession);
      setAuthStage("profile_confirm");
      setMessage({ text: "E-posta dogrulandi. Son adim: profilini onayla.", tone: "success" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "E-posta dogrulanamadi",
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmProfileAndStart(): Promise<void> {
    if (!pendingVerifiedSession) {
      setMessage({ text: "Oturum hazir degil. Dogrulama adimini tekrarla.", tone: "error" });
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
      setMessage({ text: "Profilin onaylandi. Uygulamayi kullanmaya baslayabilirsin.", tone: "success" });
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
      setMessage({ text: "Cikis yapildi.", tone: "info" });
    }
  }

  async function selectRegisterUniversity(universityId: string): Promise<void> {
    setRegisterUniversityId(universityId);
    setRegisterFacultyId("");
    setRegisterDepartmentId("");
    setFacultySearch("");
    setDepartmentSearch("");
    setDepartments({ loading: false, data: [] });
    setRegisterPicker("faculty");
    await loadFacultiesForRegistration(universityId);
  }

  async function loadUniversities(): Promise<void> {
    await withLoadable(setUniversities, () =>
      apiRequest<UniversityRecord[]>("/universities?limit=100&offset=0")
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
      setMessage({ text: "Universite baglamak icin once giris yapmalisin.", tone: "error" });
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
      await loadMyCalendar(accessToken);
      await loadUpcoming(accessToken);
      await loadAnnouncements(accessToken);
      await loadPreferences(accessToken);
      setMessage({ text: "Universite guncellendi.", tone: "success" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Universite secimi guncellenemedi",
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
      setMessage({ text: "Alarm ayarlari icin giris yapmalisin.", tone: "error" });
      return;
    }

    const categoryPayload: Record<string, boolean> = {};
    for (const category of availableCategories) {
      categoryPayload[category] = alarmMode === "all_calendar" ? true : Boolean(categoryDraft[category]);
    }

    const existing = preferences.data;
    const reminderOffsets = existing?.reminderOffsets.length ? existing.reminderOffsets : DEFAULT_REMINDER_OFFSETS;

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
      setMessage({ text: "Alarm ayarlari kaydedildi.", tone: "success" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Alarm ayarlari kaydedilemedi",
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function registerDevice(): Promise<void> {
    if (!accessToken) {
      setMessage({ text: "Cihaz kaydi icin giris yapmalisin.", tone: "error" });
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

      setMessage({ text: "Cihaz bildirimi etkinlestirildi.", tone: "success" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Cihaz kaydi basarisiz",
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function openAnnouncement(link: string): Promise<void> {
    const supported = await Linking.canOpenURL(link);
    if (!supported) {
      setMessage({ text: "Bu baglanti cihazda acilamiyor.", tone: "error" });
      return;
    }
    await Linking.openURL(link);
  }

  function addManualExam(): void {
    if (!manualExamTitle.trim() || !manualExamDate.trim()) {
      setMessage({ text: "Sinav adi ve tarihi zorunludur.", tone: "error" });
      return;
    }

    const isoCandidate = new Date(manualExamDate.trim());
    if (Number.isNaN(isoCandidate.getTime())) {
      setMessage({ text: "Sinav tarihi hatali. GG-AA-YYYY yerine YYYY-MM-DD kullan.", tone: "error" });
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
    setMessage({ text: "Sinav geri sayimina eklendi.", tone: "success" });
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={[styles.container, session ? styles.containerWithNav : undefined]}>
          {!session && (
            <View style={styles.authHero}>
              <Text style={styles.authHeroTitle}>Akademik Takvimine Hos Geldin</Text>
              <Text style={styles.authHeroSubtitle}>Sinavlarini ve duyurularini tek yerden takip et, tarihler kacmasin.</Text>
            </View>
          )}

          {message && (
            <View style={[styles.messageBox, message.tone === "error" ? styles.errorBox : message.tone === "success" ? styles.successBox : styles.infoBox]}>
              <Text style={styles.messageText}>{message.text}</Text>
            </View>
          )}

          {!session && authStage === "auth" && (
            <Section title="Giris ve Kayit">
              <View style={styles.row}>
                <Pressable
                  style={[styles.modeButton, authMode === "login" && styles.modeButtonActive]}
                  onPress={() => {
                    setAuthMode("login");
                    setAuthStage("auth");
                  }}
                >
                  <Text style={[styles.modeButtonText, authMode === "login" && styles.modeButtonTextActive]}>Giris Yap</Text>
                </Pressable>
                <Pressable
                  style={[styles.modeButton, authMode === "register" && styles.modeButtonActive]}
                  onPress={() => {
                    setAuthMode("register");
                    setAuthStage("auth");
                  }}
                >
                  <Text style={[styles.modeButtonText, authMode === "register" && styles.modeButtonTextActive]}>Kayit Ol</Text>
                </Pressable>
              </View>

              {authMode === "register" ? (
                <>
                  <View style={styles.progressRow}>
                    <View style={[styles.progressChip, registerIdentityReady && styles.progressChipDone]}>
                      <Text style={[styles.progressChipText, registerIdentityReady && styles.progressChipTextDone]}>Profil</Text>
                    </View>
                    <View style={[styles.progressChip, registerAcademicReady && styles.progressChipDone]}>
                      <Text style={[styles.progressChipText, registerAcademicReady && styles.progressChipTextDone]}>Akademik Secim</Text>
                    </View>
                    <View style={styles.progressChip}>
                      <Text style={styles.progressChipText}>Dogrulama</Text>
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
                    placeholder="Ogrenci e-posta adresi"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Sifre"
                    secureTextEntry
                    style={styles.input}
                  />

                  <Text style={styles.helperText}>Kisa kayit: universite, fakulte ve bolum secimi yapip hesabi olustur.</Text>

                  <View style={styles.selectorGroup}>
                    <Pressable
                      style={styles.selectorTrigger}
                      onPress={() => {
                        setRegisterPicker((prev) => (prev === "university" ? "none" : "university"));
                        if (!(universities.data ?? []).length) void loadUniversities();
                      }}
                      disabled={busy}
                    >
                      <Text style={styles.selectorLabel}>Universite</Text>
                      <Text style={styles.selectorValue}>{selectedUniversity?.name ?? "Secmek icin dokun"}</Text>
                    </Pressable>

                    {registerPicker === "university" && (
                      <View style={styles.selectorPanel}>
                        <TextInput
                          value={universitySearch}
                          onChangeText={setUniversitySearch}
                          placeholder="Universite ara"
                          style={styles.input}
                        />
                        {universities.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                        {universities.error && <Text style={styles.errorText}>{universities.error}</Text>}
                        {filteredUniversities.map((university) => (
                          <Pressable
                            key={university.id}
                            style={[styles.selectorOption, registerUniversityId === university.id && styles.selectorOptionSelected]}
                            onPress={() => void selectRegisterUniversity(university.id)}
                            disabled={busy}
                          >
                            <Text style={styles.universityName}>{university.name}</Text>
                            <Text style={styles.universityMeta}>{university.city}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}

                    <Pressable
                      style={[styles.selectorTrigger, !registerUniversityId && styles.selectorTriggerDisabled]}
                      onPress={() => setRegisterPicker((prev) => (prev === "faculty" ? "none" : "faculty"))}
                      disabled={!registerUniversityId || busy}
                    >
                      <Text style={styles.selectorLabel}>Fakulte</Text>
                      <Text style={styles.selectorValue}>{selectedFaculty?.name ?? "Secmek icin dokun"}</Text>
                    </Pressable>

                    {registerPicker === "faculty" && registerUniversityId && (
                      <View style={styles.selectorPanel}>
                        <TextInput
                          value={facultySearch}
                          onChangeText={setFacultySearch}
                          placeholder="Fakulte ara"
                          style={styles.input}
                        />
                        {faculties.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                        {filteredFaculties.map((faculty) => (
                          <Pressable
                            key={faculty.id}
                            style={[styles.selectorOption, registerFacultyId === faculty.id && styles.selectorOptionSelected]}
                            onPress={() => {
                              setRegisterFacultyId(faculty.id);
                              setRegisterDepartmentId("");
                              setDepartmentSearch("");
                              setRegisterPicker("department");
                              void loadDepartmentsForRegistration(faculty.id);
                            }}
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
                      <Text style={styles.selectorLabel}>Bolum</Text>
                      <Text style={styles.selectorValue}>{selectedDepartment?.name ?? "Secmek icin dokun"}</Text>
                    </Pressable>

                    {registerPicker === "department" && registerFacultyId && (
                      <View style={styles.selectorPanel}>
                        <TextInput
                          value={departmentSearch}
                          onChangeText={setDepartmentSearch}
                          placeholder="Bolum ara"
                          style={styles.input}
                        />
                        {departments.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                        {filteredDepartments.map((department) => (
                          <Pressable
                            key={department.id}
                            style={[styles.selectorOption, registerDepartmentId === department.id && styles.selectorOptionSelected]}
                            onPress={() => {
                              setRegisterDepartmentId(department.id);
                              setRegisterPicker("none");
                            }}
                            disabled={busy}
                          >
                            <Text style={styles.universityName}>{department.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>

                  <Pressable
                    style={[
                      styles.button,
                      styles.primaryButton,
                      (busy || !registerIdentityReady || !registerAcademicReady) && styles.buttonDisabled
                    ]}
                    onPress={() => void handleAuth()}
                    disabled={busy || !registerIdentityReady || !registerAcademicReady}
                  >
                    <Text style={styles.primaryButtonText}>Hesap Olustur</Text>
                  </Pressable>

                  <View style={styles.inlineInfoCard}>
                    <Text style={styles.inlineInfoTitle}>Sonraki adim: E-posta dogrulama</Text>
                    <Text style={styles.inlineInfoText}>Hesap olusturduktan sonra seni ayrica dogrulama ekranina yonlendirecegiz.</Text>
                  </View>
                </>
              ) : (
                <>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="Ogrenci e-posta adresi"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />

                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Sifre"
                    secureTextEntry
                    style={styles.input}
                  />

                  <Pressable style={[styles.button, styles.primaryButton, busy && styles.buttonDisabled]} onPress={() => void handleAuth()} disabled={busy}>
                    <Text style={styles.primaryButtonText}>Giris Yap</Text>
                  </Pressable>
                </>
              )}
            </Section>
          )}

          {!session && authStage === "verify" && (
            <Section title="E-posta Dogrulama">
              <View style={styles.progressRow}>
                <View style={[styles.progressChip, styles.progressChipDone]}>
                  <Text style={[styles.progressChipText, styles.progressChipTextDone]}>Profil</Text>
                </View>
                <View style={[styles.progressChip, styles.progressChipDone]}>
                  <Text style={[styles.progressChipText, styles.progressChipTextDone]}>Akademik Secim</Text>
                </View>
                <View style={[styles.progressChip, styles.progressChipDone]}>
                  <Text style={[styles.progressChipText, styles.progressChipTextDone]}>Dogrulama</Text>
                </View>
              </View>

              <View style={styles.verificationCard}>
                <Text style={styles.verificationTitle}>Kodunu Gir</Text>
                <Text style={styles.verificationSubtitle}>{email.trim().toLowerCase()} adresine gonderilen kodu girerek devam et.</Text>

                <TextInput
                  value={verificationToken}
                  onChangeText={setVerificationToken}
                  placeholder="Dogrulama kodu"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />

                <Pressable style={[styles.button, styles.primaryButton, busy && styles.buttonDisabled]} onPress={() => void handleVerifyEmail()} disabled={busy}>
                  <Text style={styles.primaryButtonText}>Dogrulamayi Tamamla</Text>
                </Pressable>

                <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void resendVerificationEmail()} disabled={busy}>
                  <Text style={styles.secondaryButtonText}>Kodu Tekrar Gonder</Text>
                </Pressable>

                <Pressable style={styles.textActionButton} onPress={returnToRegisterForm} disabled={busy}>
                  <Text style={styles.textActionText}>Kayit bilgilerimi duzenle</Text>
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
                  <Text style={[styles.progressChipText, styles.progressChipTextDone]}>Akademik Secim</Text>
                </View>
                <View style={[styles.progressChip, styles.progressChipDone]}>
                  <Text style={[styles.progressChipText, styles.progressChipTextDone]}>Dogrulama</Text>
                </View>
              </View>

              <Text style={styles.helperText}>Hesabin hazir. Son bir kez bilgilerini kontrol edip onayla.</Text>

              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryKey}>Ad Soyad</Text>
                  <Text style={styles.summaryValue}>{fullName || "-"}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryKey}>E-posta</Text>
                  <Text style={styles.summaryValue}>{email.trim().toLowerCase() || "-"}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryKey}>Universite</Text>
                  <Text style={styles.summaryValue}>{selectedUniversity?.name ?? "-"}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryKey}>Fakulte</Text>
                  <Text style={styles.summaryValue}>{selectedFaculty?.name ?? "-"}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryKey}>Bolum</Text>
                  <Text style={styles.summaryValue}>{selectedDepartment?.name ?? "-"}</Text>
                </View>
              </View>

              <Pressable style={[styles.button, styles.primaryButton, busy && styles.buttonDisabled]} onPress={() => void confirmProfileAndStart()} disabled={busy}>
                <Text style={styles.primaryButtonText}>Profili Onayla ve Basla</Text>
              </Pressable>

              <Pressable style={styles.textActionButton} onPress={returnToRegisterForm} disabled={busy}>
                <Text style={styles.textActionText}>Bilgilerimi duzenle</Text>
              </Pressable>
            </Section>
          )}

          {session && activeTab === "home" && (
            <>
              <Section title="Sinav Geri Sayimi">
                <Text style={styles.helperText}>Takvimindeki sinav tarihlerini takip et. Istersen manuel sinav da ekleyebilirsin.</Text>

                {examCountdownItems.length === 0 && (
                  <Text style={styles.caption}>Yaklasan sinav bulunamadi.</Text>
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
                  placeholder="Sinav adi"
                  style={styles.input}
                />
                <TextInput
                  value={manualExamDate}
                  onChangeText={setManualExamDate}
                  placeholder="Sinav tarihi (YYYY-MM-DD)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
                <Pressable style={[styles.button, styles.secondaryButton]} onPress={addManualExam} disabled={busy}>
                  <Text style={styles.secondaryButtonText}>Sinav Ekle</Text>
                </Pressable>
              </Section>

              <Section title="Yaklasan Etkinlikler">
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
                <Text style={styles.caption}>Durum: {calendar.data?.calendar.status ?? "yuklenmedi"}</Text>
                <Pressable style={[styles.buttonInline, styles.secondaryOutline]} onPress={() => void loadMyCalendar()} disabled={busy}>
                  <Text style={styles.secondaryOutlineText}>Yenile</Text>
                </Pressable>
              </View>
              {calendar.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
              {calendar.error && <Text style={styles.errorText}>{calendar.error}</Text>}
              {calendar.data?.calendar && (
                <View style={styles.cardMuted}>
                  <Text style={styles.cardTitle}>{calendar.data.calendar.title}</Text>
                  <Text style={styles.caption}>Akademik Yil: {calendar.data.calendar.academicYear}</Text>
                </View>
              )}
              {(calendar.data?.events ?? []).map((event) => (
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
              <Text style={styles.helperText}>Universite, fakulte ve bolum kaynaklarindan duyurular listelenir.</Text>

              <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void loadAnnouncements()} disabled={announcements.loading || busy}>
                <Text style={styles.secondaryButtonText}>Duyurulari Yenile</Text>
              </Pressable>

              {announcements.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
              {announcements.error && <Text style={styles.errorText}>{announcements.error}</Text>}

              {(announcements.data ?? []).map((item) => (
                <Pressable key={item.id} style={styles.eventCard} onPress={() => void openAnnouncement(item.link)}>
                  <Text style={styles.eventCategory}>{item.sourceName}</Text>
                  <Text style={styles.eventTitle}>{item.title}</Text>
                  {item.publishedAt && <Text style={styles.caption}>{new Date(item.publishedAt).toLocaleString()}</Text>}
                  <Text style={styles.linkText}>Kaynagi Ac</Text>
                </Pressable>
              ))}

              {!announcements.loading && (announcements.data ?? []).length === 0 && (
                <Text style={styles.caption}>Bu kapsamda duyuru bulunamadi.</Text>
              )}
            </Section>
          )}

          {session && activeTab === "profile" && (
            <>
              <Section title="Profilim">
                <View style={styles.sessionInfo}>
                  <Text style={styles.sessionText}>E-posta: {session.user.email}</Text>
                  <Text style={styles.sessionText}>Rol: {session.user.role}</Text>
                  <Text style={styles.sessionText}>Cihaz: {deviceId || "hazirlaniyor..."}</Text>
                  <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void handleLogout()} disabled={busy}>
                    <Text style={styles.secondaryButtonText}>Cikis Yap</Text>
                  </Pressable>
                </View>
              </Section>

              <Section title="Universite Secimi">
                <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void loadUniversities()} disabled={universities.loading || busy}>
                  <Text style={styles.secondaryButtonText}>Universiteleri Yenile</Text>
                </Pressable>

                {universities.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                {universities.error && <Text style={styles.errorText}>{universities.error}</Text>}

                {(universities.data ?? []).map((university) => (
                  <Pressable
                    key={university.id}
                    style={[styles.universityCard, selectedUniversityId === university.id && styles.universityCardSelected]}
                    onPress={() => void selectUniversity(university.id)}
                    disabled={busy}
                  >
                    <Text style={styles.universityName}>{university.name}</Text>
                    <Text style={styles.universityMeta}>{university.city} | {university.type}</Text>
                  </Pressable>
                ))}
              </Section>

              <Section title="Alarm Ayarlari">
                <Text style={styles.helperText}>Tum Takvim modu tum kategorilerde alarm acarken, Secili Alanlar sadece sectiklerin icin alarm acar.</Text>

                <View style={styles.rowBetween}>
                  <Text style={styles.label}>Alarmlari Etkinlestir</Text>
                  <Switch value={alarmEnabled} onValueChange={setAlarmEnabled} />
                </View>

                <View style={styles.row}>
                  <Pressable
                    style={[styles.modeButton, alarmMode === "all_calendar" && styles.modeButtonActive]}
                    onPress={() => updateAlarmMode("all_calendar")}
                  >
                    <Text style={[styles.modeButtonText, alarmMode === "all_calendar" && styles.modeButtonTextActive]}>Tum Takvim</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.modeButton, alarmMode === "selected_fields" && styles.modeButtonActive]}
                    onPress={() => updateAlarmMode("selected_fields")}
                  >
                    <Text style={[styles.modeButtonText, alarmMode === "selected_fields" && styles.modeButtonTextActive]}>Secili Alanlar</Text>
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
                  <Text style={styles.primaryButtonText}>Alarm Ayarlarini Kaydet</Text>
                </Pressable>
              </Section>

              <Section title="Cihaz Bildirimleri">
                <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void registerDevice()} disabled={busy}>
                  <Text style={styles.secondaryButtonText}>Cihazi Bildirim Icin Kaydet</Text>
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
