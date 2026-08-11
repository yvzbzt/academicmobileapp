import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { getRedirectResult, signInWithPopup, signInWithRedirect, type UserCredential } from "firebase/auth";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ExternalLink,
  GraduationCap,
  LoaderCircle,
  LogIn,
  LogOut,
  Megaphone,
  RefreshCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  University,
  UserRound
} from "lucide-react";
import { createGoogleProvider, formatGoogleAuthError, getGoogleAuthClient, shouldUseGoogleRedirect } from "./firebase-auth";
import "./styles.css";

type UserRole = "student" | "content_editor" | "university_admin" | "super_admin";
type EducationLevel = "associate" | "bachelor" | "master" | "doctorate";
type Session = { accessToken: string; refreshToken: string; user: { id: string; fullName?: string; email: string; role: UserRole } };
type RegisterResponse = { status: "verification_required"; email: string; verificationExpiresAt: string; resendAvailableAt: string; previewVerificationToken?: string };
type ApiState<T> = { loading: boolean; data?: T; error?: string };
type AuthNotice = { kind: "success" | "error" | "info"; text: string };
type StudentPage = "landing" | "calendar" | "announcements" | "summer" | "yok" | "settings";
type AnnouncementContentType = "announcement" | "news" | "event";
type AnnouncementScopeType = "university" | "faculty" | "department";

interface UniversityRecord { id: string; name: string; city: string; type: string; }
interface FacultyRecord { id: string; name: string; websiteUrl?: string; announcementUrl?: string; }
interface DepartmentRecord { id: string; universityId?: string; facultyId?: string; name: string; educationLevel?: EducationLevel; websiteUrl?: string; announcementUrl?: string; courseScheduleUrl?: string; examScheduleUrl?: string; }
interface CalendarRecord { id: string; title: string; academicYear: string; status: string; sourceUrl?: string; }
interface EventRecord { id: string; title: string; category: string; startDate: string; endDate?: string; universityId?: string; facultyId?: string; departmentId?: string; description?: string; }
interface CalendarPayload { calendar: CalendarRecord; events: EventRecord[]; scope?: "university"; sourceStatus?: "parsed" | "source_only"; }
interface DepartmentSchedulePayload { profile: { universityId: string; facultyId?: string; departmentId?: string }; events: EventRecord[]; sourceUrl?: string; sourceStatus?: "parsed" | "source_only" | "missing"; }
interface AnnouncementRecord { id: string; sourceName: string; contentType?: AnnouncementContentType; scopeType?: AnnouncementScopeType; scopeId?: string; title: string; link: string; publishedAt?: string; summary?: string; fetchedAt?: string; }
interface SummerSchoolRequirementRecord { message: string; date?: string; sourceUrl?: string; eventId?: string; }
interface SummerSchoolDepartmentMatch { facultyId: string; facultyName: string; departmentId: string; departmentName: string; educationLevel?: EducationLevel; }
interface SummerSchoolUniversityOption { universityId: string; universityName: string; academicYear: string; sourceUrl?: string; events: EventRecord[]; matchingDepartments?: SummerSchoolDepartmentMatch[]; }
interface SummerSchoolPayload {
  profile: { universityId: string; universityName?: string; facultyId?: string; facultyName?: string; departmentId?: string; departmentName?: string; };
  requirements: SummerSchoolRequirementRecord[];
  ownAnnouncements?: AnnouncementRecord[];
  sameDepartmentAnnouncements?: AnnouncementRecord[];
  sameDepartmentOptions: SummerSchoolUniversityOption[];
  generatedAt: string;
}
interface CalendarIntegrationPayload { feedUrl: string; webcalUrl: string; appleSubscribeUrl: string; googleSubscribeUrl: string; generatedAt: string; }
interface PreferencesPayload { enabled: boolean; categories: Record<string, boolean>; reminderOffsets: number[]; reminderRules?: Array<{ trigger: "before" | "at_time" | "approaching"; amount: number; unit: "days" | "hours"; enabled: boolean }>; quietHours?: { enabled: boolean; start: string; end: string; timezone: string }; }
interface ProfilePayload { id: string; fullName: string; email: string; role: UserRole; universityId?: string; facultyId?: string; departmentId?: string; classLevel?: number; status: string; emailVerifiedAt?: string; }
interface AffiliationOptionsPayload { emailDomain?: string; university?: UniversityRecord | null; faculties: FacultyRecord[]; departments: DepartmentRecord[]; classLevelOptions?: number[]; needsUniversityReview: boolean; }

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "https://academic-api.anssoft.com.tr";
const adminDashboardUrl = import.meta.env.VITE_ADMIN_DASHBOARD_URL ?? "https://academic-api.anssoft.com.tr/admin/";
const calendarListPreviewLimit = 5;
const webInstallationStorageKey = "academic-mobile.web-installation-id.v1";
const categoryLabels: Record<string, string> = {
  academic_year_start: "Akademik yıl başlangıcı",
  academic_year_end: "Akademik yıl bitişi",
  fall_term_start: "Güz dönemi başlangıcı",
  fall_term_end: "Güz dönemi bitişi",
  spring_term_start: "Bahar dönemi başlangıcı",
  spring_term_end: "Bahar dönemi bitişi",
  registration: "Kayıt",
  course_registration: "Ders Kaydı",
  course_renewal: "Kayıt yenileme",
  add_drop: "Ekle-Sil",
  course_add_drop: "Ders Ekle-Sil",
  course_schedule: "Ders programı",
  midterm_exam: "Ara Sınav",
  final_exam: "Final",
  department_exam_schedule: "Sınav programı",
  makeup_exam: "Bütünleme",
  single_course_exam: "Tek ders sınavı",
  graduation_application: "Mezuniyet başvurusu",
  tuition_payment: "Harç ödemesi",
  horizontal_transfer: "Yatay geçiş",
  holiday: "Tatil",
  graduation: "Mezuniyet",
  orientation: "Oryantasyon",
  summer_school_registration: "Yaz Okulu Kaydı",
  summer_school_start: "Yaz Okulu Başlangıcı",
  summer_school_end: "Yaz Okulu Bitişi",
  custom_event: "Akademik etkinlik",
  other: "Diğer"
};
const roleLabels: Record<UserRole, string> = {
  student: "Öğrenci",
  content_editor: "İçerik Editörü",
  university_admin: "Üniversite Yöneticisi",
  super_admin: "Süper Yönetici"
};
const adminRoles = new Set<UserRole>(["content_editor", "university_admin", "super_admin"]);
function classLevelOptionsForDepartment(department?: DepartmentRecord | null): number[] {
  const maxLevel = maxClassLevelForDepartment(department);
  return Array.from({ length: maxLevel }, (_, index) => index + 1);
}

function maxClassLevelForDepartment(department?: DepartmentRecord | null): number {
  if (!department) return 4;
  if (department.educationLevel === "associate") return 2;
  if (department.educationLevel === "master") return 2;
  if (department.educationLevel === "doctorate") return 4;

  const name = foldForClassMatch(department.name);
  if (name.includes("tip") || name.includes("medicine")) return 6;
  if (name.includes("dis hekimligi") || name.includes("dentistry") || name.includes("eczacilik") || name.includes("pharmacy") || name.includes("veteriner") || name.includes("veterinary")) return 5;
  return 4;
}

function foldForClassMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/gu, "i")
    .replace(/\u0130/gu, "I")
    .replace(/\u011f/gu, "g")
    .replace(/\u011e/gu, "G")
    .replace(/\u00fc/gu, "u")
    .replace(/\u00dc/gu, "U")
    .replace(/\u015f/gu, "s")
    .replace(/\u015e/gu, "S")
    .replace(/\u00f6/gu, "o")
    .replace(/\u00d6/gu, "O")
    .replace(/\u00e7/gu, "c")
    .replace(/\u00c7/gu, "C")
    .replace(/[^\p{L}\d]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function getOrCreateWebInstallationId(): string {
  const createId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `web-${crypto.randomUUID()}`;
    return `web-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  };
  try {
    const existing = window.localStorage.getItem(webInstallationStorageKey)?.trim();
    if (existing && existing.length >= 8 && existing.length <= 256) return existing;
    const created = createId();
    window.localStorage.setItem(webInstallationStorageKey, created);
    return created;
  } catch {
    return createId();
  }
}

function findDepartmentById(departments: DepartmentRecord[], id?: string): DepartmentRecord | null {
  if (!id) return null;
  return departments.find((department) => department.id === id) ?? null;
}

function ClassLevelSelect({ defaultValue, options, required = false }: { defaultValue?: number | string; options: number[]; required?: boolean }) {
  return (
    <select key={`${options.join("-")}-${defaultValue ?? ""}`} name="classLevel" defaultValue={defaultValue ?? ""} required={required} aria-label="Sınıf seviyesi">
      <option value="">Sınıf seçin</option>
      {options.map((level) => <option key={level} value={level}>{level}. sınıf</option>)}
    </select>
  );
}

function handoffTokenFromHash(): string {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash.startsWith("handoff?")) return "";
  return new URLSearchParams(hash.slice("handoff?".length)).get("accessToken") ?? "";
}

type PanelStateProps = {
  kind: "loading" | "error" | "empty";
  text: string;
};

function PanelState({ kind, text }: PanelStateProps) {
  const icon = kind === "loading"
    ? <LoaderCircle size={16} className="spin" aria-hidden="true" />
    : <AlertTriangle size={16} aria-hidden="true" />;

  return (
    <div className={`panelState panelState-${kind}`} role={kind === "error" ? "alert" : "status"} aria-live="polite">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function ShieldBadge() {
  return <UserRound size={28} aria-hidden="true" />;
}

function isDisplayableCalendarEvent(event: EventRecord): boolean {
  if (event.facultyId || event.departmentId) return false;
  if (event.category === "course_schedule" || event.category === "department_exam_schedule") return false;
  const title = event.title.trim();
  if (title.length < 3) return false;
  return !/^[\d\s./\-"()–—]+$/u.test(title);
}

function eventAlarmType(event: EventRecord): "exam" | "calendar_event" | "course" {
  if (event.category === "course_schedule") return "course";
  return ["midterm_exam", "final_exam", "makeup_exam", "single_course_exam", "department_exam_schedule"].includes(event.category) ? "exam" : "calendar_event";
}

function formatEventDateRange(event: EventRecord): string {
  const start = formatDateValue(event.startDate);
  const end = formatDateValue(event.endDate);
  if (end && end !== start) return `${start} - ${end}`;
  return start;
}

function formatDateValue(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("tr-TR");
}

function nextAnnouncementReminderIso(): string {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(6, 0, 0, 0);
  return next.toISOString();
}

function splitAnnouncementsByFreshness(items: AnnouncementRecord[]) {
  const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent: AnnouncementRecord[] = [];
  const older: AnnouncementRecord[] = [];

  for (const item of items) {
    const timestamp = announcementTimestamp(item);
    if (timestamp >= cutoffMs) recent.push(item);
    else older.push(item);
  }

  return { recent, older };
}

function announcementTimestamp(item: AnnouncementRecord): number {
  const parsed = Date.parse(item.publishedAt ?? item.fetchedAt ?? "");
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

const announcementContentOrder: AnnouncementContentType[] = ["announcement", "news", "event"];
const announcementScopeOrder: AnnouncementScopeType[] = ["university", "faculty", "department"];
const announcementContentLabels: Record<AnnouncementContentType, string> = {
  announcement: "Duyurular",
  news: "Haberler",
  event: "Etkinlikler"
};
const announcementScopeLabels: Record<AnnouncementScopeType, string> = {
  university: "Üniversite",
  faculty: "Fakülte",
  department: "Bölüm"
};
const announcementOpenLabels: Record<AnnouncementContentType, string> = {
  announcement: "Duyuruyu Aç",
  news: "Haberi Aç",
  event: "Etkinliği Aç"
};

interface AnnouncementSection {
  key: string;
  title: string;
  items: AnnouncementRecord[];
  visibleItems: AnnouncementRecord[];
  hiddenOlderCount: number;
}

function normalizeAnnouncementContentType(item: AnnouncementRecord): AnnouncementContentType {
  return item.contentType === "news" || item.contentType === "event" ? item.contentType : "announcement";
}

function normalizeAnnouncementScopeType(item: AnnouncementRecord): AnnouncementScopeType {
  return item.scopeType === "faculty" || item.scopeType === "department" ? item.scopeType : "university";
}

function groupAnnouncementsForDisplay(items: AnnouncementRecord[], showOlder: boolean): AnnouncementSection[] {
  const sections: AnnouncementSection[] = [];
  for (const contentType of announcementContentOrder) {
    for (const scopeType of announcementScopeOrder) {
      const scopedItems = items.filter((item) => normalizeAnnouncementContentType(item) === contentType && normalizeAnnouncementScopeType(item) === scopeType);
      if (scopedItems.length === 0) continue;
      const freshness = splitAnnouncementsByFreshness(scopedItems);
      const visibleItems = showOlder ? [...freshness.recent, ...freshness.older] : freshness.recent;
      sections.push({
        key: `${scopeType}-${contentType}`,
        title: `${announcementScopeLabels[scopeType]} ${announcementContentLabels[contentType]}`,
        items: scopedItems,
        visibleItems,
        hiddenOlderCount: freshness.older.length
      });
    }
  }
  return sections;
}

function announcementOpenLabel(item: AnnouncementRecord): string {
  return announcementOpenLabels[normalizeAnnouncementContentType(item)];
}

function formatApiError(status: number, body: string): string {
  const fallback = `${status} ${body}`;
  let serverMessage = body;

  try {
    const parsed = JSON.parse(body) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) serverMessage = parsed.message.join(" ");
    else if (parsed.message) serverMessage = parsed.message;
  } catch {
    serverMessage = body;
  }

  if (status === 400 && serverMessage.includes("Password confirmation")) return "Şifre doğrulaması eşleşmiyor.";
  if (status === 400 && serverMessage.includes("University")) return "Geçerli bir üniversite, fakülte ve bölüm seçin.";
  if (status === 401 && serverMessage.includes("Google")) return serverMessage;
  if (status === 401 && serverMessage.includes("Email verification")) return "Giriş yapmadan önce e-postanızı doğrulayın.";
  if (status === 401 && serverMessage.includes("verification code")) return "Doğrulama kodu doğru değil.";
  if (status === 404 && (serverMessage.includes("Published calendar not found") || serverMessage.includes("academic calendar is not available"))) return "Seçtiğiniz üniversite için akademik takvim henüz bulunamadı. Kaynak taraması tamamlandığında burada görünecek.";
  if (status === 429) return "Yeni doğrulama kodu istemeden önce lütfen bekleyin.";
  if (status === 401) return "E-posta veya şifre doğru değil.";
  if (status === 409) return "Bu e-posta zaten kayıtlı. Giriş sekmesine geçin veya farklı bir e-posta kullanın.";
  if (status === 503 && serverMessage.includes("Email delivery")) return "Doğrulama e-postası şu anda gönderilemiyor. Lütfen daha sonra tekrar deneyin.";
  if (status >= 500) return "Servis geçici olarak kullanılamıyor. Birazdan tekrar deneyin.";
  return serverMessage || fallback;
}

function App() {
  const initialHandoffToken = handoffTokenFromHash();
  const [session, setSession] = useState<Session | null>(null);
  const [studentPage, setStudentPage] = useState<StudentPage>("landing");
  const [showAdminDecision, setShowAdminDecision] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register" | "verify">("login");
  const [selectedUniversityId, setSelectedUniversityId] = useState("");
  const [profileUniversityId, setProfileUniversityId] = useState("");
  const [affiliationFacultyId, setAffiliationFacultyId] = useState("");
  const [affiliationDepartmentId, setAffiliationDepartmentId] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [verificationExpiresAt, setVerificationExpiresAt] = useState("");
  const [resendAvailableAt, setResendAvailableAt] = useState("");
  const [clockNow, setClockNow] = useState(Date.now());
  const [universities, setUniversities] = useState<ApiState<UniversityRecord[]>>({ loading: false });
  const [profileFaculties, setProfileFaculties] = useState<ApiState<FacultyRecord[]>>({ loading: false });
  const [profileDepartments, setProfileDepartments] = useState<ApiState<DepartmentRecord[]>>({ loading: false });
  const [calendar, setCalendar] = useState<ApiState<CalendarPayload>>({ loading: false });
  const [courseSchedules, setCourseSchedules] = useState<ApiState<DepartmentSchedulePayload>>({ loading: false });
  const [examSchedules, setExamSchedules] = useState<ApiState<DepartmentSchedulePayload>>({ loading: false });
  const [announcements, setAnnouncements] = useState<ApiState<AnnouncementRecord[]>>({ loading: false });
  const [yokAnnouncements, setYokAnnouncements] = useState<ApiState<AnnouncementRecord[]>>({ loading: false });
  const [summerSchool, setSummerSchool] = useState<ApiState<SummerSchoolPayload>>({ loading: false });
  const [calendarIntegrations, setCalendarIntegrations] = useState<ApiState<CalendarIntegrationPayload>>({ loading: false });
  const [upcoming, setUpcoming] = useState<ApiState<EventRecord[]>>({ loading: false });
  const [preferences, setPreferences] = useState<ApiState<PreferencesPayload>>({ loading: false });
  const [profile, setProfile] = useState<ApiState<ProfilePayload>>({ loading: false });
  const [affiliationOptions, setAffiliationOptions] = useState<ApiState<AffiliationOptionsPayload>>({ loading: false });
  const [message, setMessage] = useState("");
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(null);
  const [showOlderAnnouncements, setShowOlderAnnouncements] = useState(false);
  const [showOlderYokAnnouncements, setShowOlderYokAnnouncements] = useState(false);
  const [showAllCalendarEvents, setShowAllCalendarEvents] = useState(false);
  const [showAllCourseScheduleEvents, setShowAllCourseScheduleEvents] = useState(false);
  const [showAllExamScheduleEvents, setShowAllExamScheduleEvents] = useState(false);
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [handoffState, setHandoffState] = useState<ApiState<ProfilePayload>>({ loading: Boolean(initialHandoffToken) });
  const clientDeviceId = useMemo(getOrCreateWebInstallationId, []);
  const isAuthenticated = Boolean(session);
  const isAdmin = Boolean(session && adminRoles.has(session.user.role));
  const headers = useMemo(() => (session ? { Authorization: `Bearer ${session.accessToken}` } : {}), [session]);

  useEffect(() => {
    if (!message) return;
    const handle = setTimeout(() => setMessage(""), 3400);
    return () => clearTimeout(handle);
  }, [message]);

  useEffect(() => {
    void loadUniversities();
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadProfile();
    void loadAffiliationOptions();
  }, [session?.accessToken]);

  useEffect(() => {
    if (!profile.data) return;
    setProfileUniversityId(profile.data.universityId ?? "");
    setAffiliationFacultyId(profile.data.facultyId ?? "");
    setAffiliationDepartmentId(profile.data.departmentId ?? "");
    if (profile.data.universityId) void loadProfileFaculties(profile.data.universityId);
    else {
      setProfileFaculties({ loading: false, data: [] });
      setProfileDepartments({ loading: false, data: [] });
    }
    if (profile.data.facultyId) void loadProfileDepartments(profile.data.facultyId);
  }, [profile.data?.universityId, profile.data?.facultyId, profile.data?.departmentId]);

  useEffect(() => {
    const matchedUniversityId = affiliationOptions.data?.university?.id;
    if (profile.data?.universityId || profileUniversityId || !matchedUniversityId) return;
    setProfileUniversityId(matchedUniversityId);
    void loadProfileFaculties(matchedUniversityId);
  }, [affiliationOptions.data?.university?.id, profile.data?.universityId, profileUniversityId]);

  useEffect(() => {
    const handoffToken = handoffTokenFromHash();
    if (handoffToken) void acceptHandoffToken(handoffToken);
  }, []);

  useEffect(() => {
    void completeGoogleRedirectSignIn();
  }, []);

  useEffect(() => {
    setAuthNotice(null);
    if (authMode !== "verify") setRegisteredEmail("");
  }, [authMode]);

  useEffect(() => {
    if (authMode !== "verify") return;
    const handle = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [authMode]);

  function ensureSession() {
    if (!session) {
      setMessage("Bu işlem için giriş yapmanız gerekiyor.");
      return false;
    }

    return true;
  }

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers: { "Content-Type": "application/json", ...headers, ...(options.headers ?? {}) } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(formatApiError(response.status, body || response.statusText));
    }
    return response.json() as Promise<T>;
  }

  async function runAction<T>(setter: (state: ApiState<T>) => void, action: () => Promise<T>, success?: string) {
    setter({ loading: true });
    try {
      const data = await action();
      setter({ loading: false, data });
      if (success) setMessage(success);
    } catch (error) {
      setter({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  function acceptSession(nextSession: Session) {
    setSession(nextSession);
    setStudentPage("landing");
    setShowAdminDecision(adminRoles.has(nextSession.user.role));
  }

  async function acceptHandoffToken(accessToken: string) {
    setHandoffState({ loading: true });
    try {
      const response = await fetch(`${apiBaseUrl}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error(formatApiError(response.status, await response.text()));
      const user = await response.json() as Session["user"];
      setSession({ accessToken, refreshToken: "", user });
      setStudentPage("landing");
      setShowAdminDecision(false);
      setAuthNotice(null);
      setHandoffState({ loading: false, data: user as ProfilePayload });
      window.history.replaceState(null, "", window.location.pathname);
      await loadUniversities();
    } catch (error) {
      setSession(null);
      setShowAdminDecision(false);
      setHandoffState({ loading: false, error: error instanceof Error ? error.message : String(error) });
      setAuthNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  function formData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    const values = formData(event);

    try {
      if (authMode === "login") {
        const nextSession = await request<Session>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: values.email, password: values.password, deviceId: clientDeviceId })
        });
        acceptSession(nextSession);
        setAuthNotice({ kind: "success", text: adminRoles.has(nextSession.user.role) ? "Yönetici oturumu hazır. Açmak istediğiniz paneli seçin." : "Giriş yaptınız. Takviminiz ve hatırlatmalarınız hazır." });
        setMessage("Oturum hazır");
        await loadUniversities();
        return;
      }

      if (values.password !== values.passwordConfirmation) {
        setAuthNotice({ kind: "error", text: "Şifre doğrulaması eşleşmiyor." });
        return;
      }

      const registerResult = await request<RegisterResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          passwordConfirmation: values.passwordConfirmation
        })
      });

      setAuthNotice({
        kind: "success",
        text: registerResult.previewVerificationToken
          ? "Hesap oluşturuldu. Doğrulama kodu aşağıya dolduruldu; tamamlamak için E-postayı Doğrula'ya dokunun."
          : `${registerResult.email} için hesap oluşturuldu. 4 haneli doğrulama kodu için e-postanızı kontrol edin.`
      });
      setMessage(registerResult.previewVerificationToken ? "Doğrulama kodu hazır" : "Doğrulama e-postası gönderildi");
      setRegisteredEmail(registerResult.email);
      setVerificationExpiresAt(registerResult.verificationExpiresAt);
      setResendAvailableAt(registerResult.resendAvailableAt);
      if (registerResult.previewVerificationToken) setVerificationToken(registerResult.previewVerificationToken);
      setAuthMode("verify");
    } catch (error) {
      setAuthNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function submitGoogleAuth() {
    const auth = getGoogleAuthClient();
    if (!auth) {
      setAuthNotice({ kind: "error", text: "Bu sürüm için Google ile giriş yapılandırılmamış." });
      return;
    }

    let redirectStarted = false;
    setGoogleAuthLoading(true);
    setAuthNotice(null);
    try {
      const credential = await signInWithPopup(auth, createGoogleProvider());
      await completeGoogleCredential(credential);
    } catch (error) {
      if (shouldUseGoogleRedirect(error)) {
        redirectStarted = true;
        await signInWithRedirect(auth, createGoogleProvider());
        return;
      }
      setAuthNotice({ kind: "error", text: formatGoogleAuthError(error) });
    } finally {
      if (!redirectStarted) setGoogleAuthLoading(false);
    }
  }

  async function completeGoogleRedirectSignIn() {
    const auth = getGoogleAuthClient();
    if (!auth) return;

    try {
      const credential = await getRedirectResult(auth);
      if (!credential) return;
      setGoogleAuthLoading(true);
      await completeGoogleCredential(credential);
    } catch (error) {
      setAuthNotice({ kind: "error", text: formatGoogleAuthError(error) });
    } finally {
      setGoogleAuthLoading(false);
    }
  }

  async function completeGoogleCredential(credential: UserCredential) {
    const idToken = await credential.user.getIdToken();
    const nextSession = await request<Session>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken, deviceId: clientDeviceId })
    });
    acceptSession(nextSession);
    setAuthNotice({ kind: "success", text: adminRoles.has(nextSession.user.role) ? "Yönetici oturumu hazır. Açmak istediğiniz paneli seçin." : "Google ile giriş yaptınız." });
    setMessage("Google oturumu hazır");
    await loadUniversities();
  }

  async function submitVerifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!verificationToken.trim()) {
      setAuthNotice({ kind: "error", text: "Devam etmeden önce 4 haneli doğrulama kodunu girin." });
      return;
    }

    try {
      await request<{ status: "verified"; email: string }>("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ email: registeredEmail, code: verificationToken.trim(), deviceId: clientDeviceId })
      });

      setAuthMode("login");
      setVerificationToken("");
      setRegisteredEmail("");
      setAuthNotice({ kind: "success", text: "E-posta doğrulandı. Artık giriş yapabilirsiniz." });
      setMessage("E-posta doğrulandı");
    } catch (error) {
      setAuthNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function resendVerificationCode() {
    if (!registeredEmail) return;
    try {
      const result = await request<RegisterResponse>("/auth/resend-verification-code", {
        method: "POST",
        body: JSON.stringify({ email: registeredEmail })
      });
      setVerificationExpiresAt(result.verificationExpiresAt);
      setResendAvailableAt(result.resendAvailableAt);
      if (result.previewVerificationToken) setVerificationToken(result.previewVerificationToken);
      setAuthNotice({ kind: "success", text: "Yeni bir doğrulama kodu gönderildi." });
      setMessage("Doğrulama kodu yeniden gönderildi");
    } catch (error) {
      setAuthNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function loadUniversities() {
    await runAction(setUniversities, () => request<UniversityRecord[]>("/universities?limit=500&offset=0"));
  }

  async function loadProfileFaculties(universityId: string) {
    if (!universityId) {
      setProfileFaculties({ loading: false, data: [] });
      return;
    }
    await runAction(setProfileFaculties, () => request<FacultyRecord[]>(`/universities/${universityId}/faculties`));
  }

  async function loadProfileDepartments(facultyId: string) {
    if (!facultyId) {
      setProfileDepartments({ loading: false, data: [] });
      return;
    }
    await runAction(setProfileDepartments, () => request<DepartmentRecord[]>(`/faculties/${facultyId}/departments`));
  }

  async function selectUniversity(id: string) {
    setSelectedUniversityId(id);
    if (session) {
      await request("/me/university", { method: "PATCH", body: JSON.stringify({ universityId: id }) });
      await runAction(setCalendar, () => request<CalendarPayload>("/calendar/my"), "Üniversite seçildi");
      await loadUpcoming();
      await loadMyAnnouncements();
      await loadSummerSchool();
      return;
    }
    await runAction(setCalendar, () => request<CalendarPayload>(`/calendar/university/${id}`), "Üniversite seçildi");
  }

  async function loadUpcoming() {
    if (!ensureSession()) return;
    await runAction(setUpcoming, () => request<EventRecord[]>("/calendar/upcoming?limit=10"));
  }

  async function loadMyCalendar() {
    if (!ensureSession()) return;
    setShowAllCalendarEvents(false);
    await runAction(setCalendar, () => request<CalendarPayload>("/calendar/my"));
  }

  async function loadCourseSchedules() {
    if (!ensureSession()) return;
    setShowAllCourseScheduleEvents(false);
    await runAction(setCourseSchedules, () => request<DepartmentSchedulePayload>("/calendar/my/course-schedules"));
  }

  async function loadExamSchedules() {
    if (!ensureSession()) return;
    setShowAllExamScheduleEvents(false);
    await runAction(setExamSchedules, () => request<DepartmentSchedulePayload>("/calendar/my/exam-schedules"));
  }

  async function loadMyAnnouncements() {
    if (!ensureSession()) return;
    setShowOlderAnnouncements(false);
    await runAction(setAnnouncements, () => request<AnnouncementRecord[]>("/announcements/my?limit=80"));
  }

  async function loadYokAnnouncements() {
    setShowOlderYokAnnouncements(false);
    await runAction(setYokAnnouncements, () => request<AnnouncementRecord[]>("/announcements/yok?limit=80"));
  }

  async function loadSummerSchool() {
    if (!ensureSession()) return;
    await runAction(setSummerSchool, () => request<SummerSchoolPayload>("/calendar/summer-school/my"));
  }

  async function loadCalendarIntegrations() {
    if (!ensureSession()) return;
    await runAction(setCalendarIntegrations, () => request<CalendarIntegrationPayload>("/calendar/integrations"));
  }

  async function loadPreferences() {
    if (!ensureSession()) return;
    await runAction(setPreferences, () => request<PreferencesPayload>("/notification-preferences"));
  }

  async function loadProfile() {
    if (!ensureSession()) return;
    await runAction(setProfile, () => request<ProfilePayload>("/me"));
  }

  async function loadAffiliationOptions() {
    if (!ensureSession()) return;
    await runAction(setAffiliationOptions, () => request<AffiliationOptionsPayload>("/me/affiliation-options"));
  }

  async function saveAffiliation(event: FormEvent<HTMLFormElement>) {
    if (!ensureSession()) return;
    const values = formData(event);
    await runAction(
      setProfile,
      () => request<ProfilePayload>("/me/university", {
        method: "PATCH",
        body: JSON.stringify({
          universityId: values.universityId,
          facultyId: values.facultyId || undefined,
          departmentId: values.departmentId || undefined,
          classLevel: values.classLevel ? Number(values.classLevel) : undefined
        })
      }),
      "Akademik profil kaydedildi"
    );
    await loadAffiliationOptions();
  }

  async function suggestAcademicUnit(event: FormEvent<HTMLFormElement>) {
    if (!ensureSession()) return;
    const values = formData(event);
    await request("/me/academic-suggestions", {
      method: "POST",
      body: JSON.stringify({
        universityId: values.universityId,
        facultyName: values.facultyName,
        departmentName: values.departmentName || undefined,
        educationLevel: values.educationLevel || "bachelor"
      })
    });
    setMessage("Öneri yönetici incelemesine gönderildi");
    event.currentTarget.reset();
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    if (!ensureSession()) return;
    const values = formData(event);
    await runAction(
      setProfile,
      () => request<ProfilePayload>("/me", { method: "PATCH", body: JSON.stringify({ fullName: values.fullName, classLevel: values.classLevel ? Number(values.classLevel) : undefined }) }),
      "Profil kaydedildi"
    );
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    if (!ensureSession()) return;
    const values = formData(event);
    const reminderMode = values.reminderMode || "at_time";
    const dayBeforeDays = Math.min(30, Math.max(1, Number(values.dayBeforeDays || 1)));
    const hourBeforeHours = Math.min(720, Math.max(1, Number(values.hourBeforeHours || 3)));
    const enabledReminderRules = reminderMode === "days_before"
      ? [{ trigger: "before" as const, amount: dayBeforeDays, unit: "days" as const, enabled: true }]
      : reminderMode === "hours_before"
        ? [{ trigger: "before" as const, amount: hourBeforeHours, unit: "hours" as const, enabled: true }]
        : reminderMode === "approaching"
          ? [{ trigger: "approaching" as const, amount: 0, unit: "days" as const, enabled: true }]
          : [{ trigger: "at_time" as const, amount: 0, unit: "days" as const, enabled: true }];
    const body = {
      // This responsive web client has no real Web Push subscription flow.
      // Never create a fake device registration or claim delivery here.
      enabled: false,
      categories: {
        course_registration: true,
        course_schedule: true,
        final_exam: true,
        midterm_exam: true,
        department_exam_schedule: true,
        announcement: true,
        yok_event: true,
        holiday: true
      },
      reminderOffsets: enabledReminderRules
        .filter((rule) => rule.trigger !== "approaching" && rule.unit === "days")
        .map((rule) => rule.amount),
      reminderRules: enabledReminderRules,
      quietHours: { enabled: values.quietHours !== "disabled", start: values.start || "22:00", end: values.end || "07:00", timezone: "Europe/Istanbul" }
    };
    await runAction(setPreferences, () => request<PreferencesPayload>("/notification-preferences", { method: "PATCH", body: JSON.stringify(body) }), "Tercihler kaydedildi");
  }

  async function createStudentAlarm(input: { eventType: "exam" | "calendar_event" | "announcement" | "course"; targetId: string; title: string; scheduledFor: string; trigger: "at_time" | "before"; amount: number; unit: "days" | "hours"; sourceUrl?: string }) {
    if (!ensureSession()) return;
    await request("/notification-alarms", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        ...(profile.data?.universityId ? { universityId: profile.data.universityId } : {}),
        ...(profile.data?.facultyId ? { facultyId: profile.data.facultyId } : {}),
        ...(profile.data?.departmentId ? { departmentId: profile.data.departmentId } : {})
      })
    });
    setMessage("Hatırlatma kuruldu");
  }

  function logout() {
    const closingSession = session;
    setSession(null);
    setStudentPage("landing");
    setShowAdminDecision(false);
    setCalendar({ loading: false });
    setCourseSchedules({ loading: false });
    setExamSchedules({ loading: false });
    setShowAllCalendarEvents(false);
    setShowAllCourseScheduleEvents(false);
    setShowAllExamScheduleEvents(false);
    setAnnouncements({ loading: false });
    setYokAnnouncements({ loading: false });
    setSummerSchool({ loading: false });
    setCalendarIntegrations({ loading: false });
    setUpcoming({ loading: false });
    setPreferences({ loading: false });
    setProfile({ loading: false });
    setSelectedUniversityId("");
    setProfileUniversityId("");
    setAffiliationFacultyId("");
    setAffiliationDepartmentId("");
    setProfileFaculties({ loading: false, data: [] });
    setProfileDepartments({ loading: false, data: [] });
    setAuthNotice({ kind: "info", text: "Çıkış yaptınız." });
    setMessage("");

    if (!closingSession) return;
    const authenticatedHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${closingSession.accessToken}`
    };
    const detachRequests: Promise<Response>[] = [
      fetch(`${apiBaseUrl}/devices/current`, {
        method: "DELETE",
        headers: authenticatedHeaders,
        body: JSON.stringify({ deviceId: clientDeviceId })
      })
    ];
    if (closingSession.refreshToken) {
      detachRequests.push(fetch(`${apiBaseUrl}/auth/logout`, {
        method: "POST",
        headers: authenticatedHeaders,
        body: JSON.stringify({ refreshToken: closingSession.refreshToken })
      }));
    }
    void Promise.allSettled(detachRequests);
  }

  function universityName(id?: string) {
    if (!id) return "Bilinmeyen üniversite";
    return universities.data?.find((university) => university.id === id)?.name ?? "Üniversite bilgisi yükleniyor";
  }

  function facultyName(id?: string, fallback = "Fakülte ayarlı değil") {
    if (!id) return fallback;
    return (profileFaculties.data ?? []).find((faculty) => faculty.id === id)?.name ?? "Fakülte bilgisi yükleniyor";
  }

  function departmentName(id?: string, fallback = "Bölüm ayarlı değil") {
    if (!id) return fallback;
    return (profileDepartments.data ?? []).find((department) => department.id === id)?.name ?? "Bölüm bilgisi yükleniyor";
  }

  function openStudentPage(page: StudentPage) {
    setStudentPage(page);
    if (page === "landing") void loadUpcoming();
    if (page === "calendar") {
      void loadProfile();
      void loadMyCalendar();
      void loadCourseSchedules();
      void loadExamSchedules();
      void loadCalendarIntegrations();
    }
    if (page === "announcements") {
      void loadProfile();
      void loadMyAnnouncements();
    }
    if (page === "summer") {
      void loadProfile();
      void loadSummerSchool();
    }
    if (page === "yok") {
      void loadYokAnnouncements();
    }
    if (page === "settings") {
      void loadProfile();
      void loadPreferences();
      void loadAffiliationOptions();
    }
  }

  function adminPanelHandoffUrl() {
    if (!session) return adminDashboardUrl;
    return `${adminDashboardUrl.replace(/\/$/, "")}/#/handoff?accessToken=${encodeURIComponent(session.accessToken)}`;
  }

  function renderScheduleItem(event: EventRecord) {
    return (
      <article className="eventItem" key={event.id}>
        <span>{categoryLabels[event.category] ?? event.category}</span>
        <strong>{event.title}</strong>
        <time>{formatEventDateRange(event)}</time>
        {event.description && <p>{event.description}</p>}
        <div className="alarmActions">
          <button className="btn btn-secondary" type="button" onClick={() => createStudentAlarm({ eventType: eventAlarmType(event), targetId: event.id, title: event.title, scheduledFor: event.startDate, trigger: "at_time", amount: 0, unit: "days" })}><Bell size={14} /> Zamanında</button>
          <button className="btn btn-secondary" type="button" onClick={() => createStudentAlarm({ eventType: eventAlarmType(event), targetId: event.id, title: event.title, scheduledFor: event.startDate, trigger: "before", amount: 1, unit: "days" })}>1 gün</button>
          <button className="btn btn-secondary" type="button" onClick={() => createStudentAlarm({ eventType: eventAlarmType(event), targetId: event.id, title: event.title, scheduledFor: event.startDate, trigger: "before", amount: 3, unit: "hours" })}>3 saat</button>
        </div>
      </article>
    );
  }

  const matchedUniversity = affiliationOptions.data?.university ?? null;
  const profileUniversity = universities.data?.find((university) => university.id === profileUniversityId) ?? matchedUniversity;
  const availableFaculties = profileFaculties.data ?? [];
  const availableDepartments = profileDepartments.data ?? [];
  const needsAffiliation = Boolean(session && !isAdmin && !profile.data?.universityId);
  const resendRemainingSeconds = Math.max(0, Math.ceil((new Date(resendAvailableAt || 0).getTime() - clockNow) / 1000));
  const verificationExpiryText = verificationExpiresAt ? new Date(verificationExpiresAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "";
  const displayableCalendarEvents = (calendar.data?.events ?? []).filter(isDisplayableCalendarEvent);
  const courseScheduleEvents = courseSchedules.data?.events ?? [];
  const examScheduleEvents = examSchedules.data?.events ?? [];
  const visibleCalendarEvents = showAllCalendarEvents ? displayableCalendarEvents : displayableCalendarEvents.slice(0, calendarListPreviewLimit);
  const visibleCourseScheduleEvents = showAllCourseScheduleEvents ? courseScheduleEvents : courseScheduleEvents.slice(0, calendarListPreviewLimit);
  const visibleExamScheduleEvents = showAllExamScheduleEvents ? examScheduleEvents : examScheduleEvents.slice(0, calendarListPreviewLimit);
  const hiddenCalendarEventCount = Math.max(0, displayableCalendarEvents.length - visibleCalendarEvents.length);
  const hiddenCourseScheduleEventCount = Math.max(0, courseScheduleEvents.length - visibleCourseScheduleEvents.length);
  const hiddenExamScheduleEventCount = Math.max(0, examScheduleEvents.length - visibleExamScheduleEvents.length);
  const announcementFeed = announcements.data ?? [];
  const announcementSections = groupAnnouncementsForDisplay(announcementFeed, showOlderAnnouncements);
  const hasVisibleAnnouncements = announcementSections.some((section) => section.visibleItems.length > 0);
  const hiddenOlderAnnouncementCount = announcementSections.reduce((total, section) => total + section.hiddenOlderCount, 0);
  const yokAnnouncementGroups = splitAnnouncementsByFreshness(yokAnnouncements.data ?? []);
  const visibleYokAnnouncements = showOlderYokAnnouncements ? [...yokAnnouncementGroups.recent, ...yokAnnouncementGroups.older] : yokAnnouncementGroups.recent;
  const summerRequirements = summerSchool.data?.requirements ?? [];
  const summerOwnAnnouncements = summerSchool.data?.ownAnnouncements ?? [];
  const summerSameDepartmentAnnouncements = summerSchool.data?.sameDepartmentAnnouncements ?? [];
  const summerOptions = summerSchool.data?.sameDepartmentOptions ?? [];
  const hasSummerSchoolContent = summerRequirements.length > 0 || summerOwnAnnouncements.length > 0 || summerSameDepartmentAnnouncements.length > 0 || summerOptions.length > 0;
  const knownDepartments = [
    ...(profileDepartments.data ?? []),
    ...(affiliationOptions.data?.departments ?? [])
  ];
  const profileClassLevelOptions = classLevelOptionsForDepartment(findDepartmentById(knownDepartments, profile.data?.departmentId));
  const affiliationClassLevelOptions = classLevelOptionsForDepartment(findDepartmentById(knownDepartments, affiliationDepartmentId || profile.data?.departmentId));
  const activeReminderRule = preferences.data?.reminderRules?.find((rule) => rule.enabled) ?? preferences.data?.reminderRules?.[0];
  const defaultReminderMode = activeReminderRule?.trigger === "before" && activeReminderRule.unit === "hours"
    ? "hours_before"
    : activeReminderRule?.trigger === "before"
      ? "days_before"
      : activeReminderRule?.trigger === "approaching"
        ? "approaching"
        : "at_time";
  const defaultReminderDays = preferences.data?.reminderRules?.find((rule) => rule.trigger === "before" && rule.unit === "days")?.amount ?? 1;
  const defaultReminderHours = preferences.data?.reminderRules?.find((rule) => rule.trigger === "before" && rule.unit === "hours")?.amount ?? 3;

  const authPanel = (
    <>
        <section className="panel authPanel">
          <div className="sectionIntro">
            <h2>Kimlik Doğrulama</h2>
            <p>{authMode === "login" ? "Akademik takviminize devam etmek için giriş yapın." : authMode === "verify" ? "E-postanıza gönderdiğimiz 4 haneli kodu girin." : "E-posta ve şifreyle hesabınızı oluşturun, ardından e-postanızı doğrulayın."}</p>
          </div>
          {authMode !== "verify" && (
            <div className="tabs">
              <button className={authMode === "login" ? "tabButton active" : "tabButton"} type="button" onClick={() => setAuthMode("login")}><LogIn size={16} /> Giriş</button>
              <button className={authMode === "register" ? "tabButton active" : "tabButton"} type="button" onClick={() => setAuthMode("register")}><Check size={16} /> Kayıt</button>
            </div>
          )}
          {authNotice && (
            <div className={`authNotice authNotice-${authNotice.kind}`} role={authNotice.kind === "error" ? "alert" : "status"} aria-live="polite">
              {authNotice.kind === "error" ? <AlertTriangle size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
              <span>{authNotice.text}</span>
            </div>
          )}
          {authMode !== "verify" && (
            <>
              <div className="oauthStack">
                <button className="btn btn-google fullWidth" type="button" onClick={submitGoogleAuth} disabled={googleAuthLoading}>
                  {googleAuthLoading ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}
                  Google ile Devam Et
                </button>
                <div className="authDivider"><span>veya</span></div>
              </div>
              <form className="stack" onSubmit={submitAuth}>
                <input name="email" type="email" placeholder="E-posta" required aria-label="E-posta" />
                <input name="password" type="password" placeholder="Şifre" required aria-label="Şifre" />
                {authMode === "register" && (
                  <>
                    <input name="passwordConfirmation" type="password" placeholder="Şifreyi doğrula" required aria-label="Şifreyi doğrula" />
                    <p className="sectionHint">Okul, fakülte ve bölüm bilgilerini hesabını oluşturduktan sonra profilinden seçebilirsin.</p>
                  </>
                )}

                <button className="btn btn-primary"><LogIn size={18} /> Devam Et</button>
              </form>
            </>
          )}

          {authMode === "verify" && (
            <form className="stack" onSubmit={submitVerifyEmail}>
              <div className="emailAuthNextStep">
                <span>{registeredEmail}</span>
                <span>{verificationExpiryText ? `${verificationExpiryText} saatinde sona erer` : "E-postanızı kontrol edin"}</span>
              </div>
              <input
                name="verificationToken"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]{4}"
                value={verificationToken}
                onChange={(event) => setVerificationToken(event.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="4 haneli kod"
                aria-label="4 haneli doğrulama kodu"
                required
              />
              <button className="btn btn-primary" type="submit"><Check size={18} /> E-postayı Doğrula</button>
              <button className="btn btn-secondary" type="button" disabled={resendRemainingSeconds > 0} onClick={resendVerificationCode}>
                <RefreshCcw size={18} /> {resendRemainingSeconds > 0 ? `${resendRemainingSeconds} sn sonra gönder` : "E-postayı Yeniden Gönder"}
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => setAuthMode("login")}><LogIn size={18} /> Girişe Dön</button>
            </form>
          )}
        </section>
        {message && <div className="toast" role="status" aria-live="polite"><Sparkles size={16} aria-hidden="true" /> {message}</div>}
    </>
  );

  if (!session) {
    if (handoffState.loading) {
      return (
        <main className="appShell authShell">
          <div className="ambientBackdrop" aria-hidden="true" />
          <section className="phoneSurface authSurface">
            <header className="appHeader authHeader">
              <div>
                <h1>Akademik Takvim</h1>
                <p>Kullanıcı paneli açılıyor</p>
              </div>
              <GraduationCap size={28} />
            </header>
            <section className="panel authPanel">
              <PanelState kind="loading" text="Oturumunuz doğrulanıyor..." />
            </section>
          </section>
        </main>
      );
    }

    return (
      <main className="appShell authShell">
        <div className="ambientBackdrop" aria-hidden="true" />
        <section className="phoneSurface authSurface">
          <header className="appHeader authHeader">
            <div>
              <h1>Akademik Takvim</h1>
              <p>Öğrenci takvimi erişimi</p>
            </div>
            <GraduationCap size={28} />
          </header>
          {authPanel}
        </section>
      </main>
    );
  }

  if (showAdminDecision) {
    return (
      <main className="appShell authShell">
        <section className="phoneSurface authSurface">
          <header className="appHeader authHeader">
            <div>
              <h1>Panel Seçin</h1>
              <p>{session.user.email}</p>
            </div>
            <ShieldBadge />
          </header>
          <section className="panel decisionPanel">
            <div className="sectionIntro">
              <h2>Yönetici hesabı algılandı</h2>
              <p>Yönetim operasyon paneline devam edebilir veya öğrenci deneyimini görüntüleyebilirsiniz.</p>
            </div>
            <div className="decisionGrid">
              <a className="decisionCard" href={adminPanelHandoffUrl()}>
                <ExternalLink size={22} />
                <strong>Yönetici Paneli</strong>
                <span>Katalog, kullanıcılar, yayınlama ve operasyonları yönetin.</span>
              </a>
              <button className="decisionCard" type="button" onClick={() => setShowAdminDecision(false)}>
                <GraduationCap size={22} />
                <strong>Kullanıcı Paneli</strong>
                <span>Öğrenci takvimi ve ayarlar deneyimini açın.</span>
              </button>
            </div>
            <button className="btn btn-secondary fullWidth" type="button" onClick={logout}><LogOut size={18} /> Çıkış Yap</button>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="appShell">
      <div className="ambientBackdrop" aria-hidden="true" />
      <section className="phoneSurface">
        <header className="appHeader">
          <div>
            <h1>Akademik Takvim</h1>
            <p>{session.user.email}</p>
          </div>
          <div className="headerActions">
            <button className="headerButton" type="button" onClick={logout} title="Çıkış yap" aria-label="Çıkış yap"><LogOut size={18} /></button>
            <GraduationCap size={28} />
          </div>
        </header>

        {isAdmin && (
          <section className="panel compactPanel">
            <div className="sectionTitle">
              <UserRound size={18} />
              <h2>Yönetici Erişimi</h2>
              <a className="btn btn-secondary" href={adminPanelHandoffUrl()}><ExternalLink size={16} /> Yönetici Paneli</a>
            </div>
          </section>
        )}

        {needsAffiliation && (
          <section className="panel compactPanel">
            <div className="sectionTitle"><University size={18} /><h2>Akademik Profil</h2></div>
            {affiliationOptions.loading && <PanelState kind="loading" text="Akademik katalog seçenekleri kontrol ediliyor..." />}
            {affiliationOptions.data?.needsUniversityReview && (
              <PanelState kind="empty" text={`${affiliationOptions.data.emailDomain ?? ""} e-posta alan adı otomatik eşleşmedi; aşağıdan manuel seçim yapabilirsiniz.`} />
            )}
            {(universities.data?.length ?? 0) > 0 && (
              <>
                <p className="sectionHint">{matchedUniversity ? `${matchedUniversity.name} e-posta alan adınızla eşleşiyor.` : "Türkiye üniversite kataloğundan okulunuzu seçin."} Ardından fakülte ve bölümünüzü kaydedin.</p>
                <form className="settingsGrid" onSubmit={saveAffiliation}>
                  <label className="fieldLabel">Üniversite
                    <select
                      name="universityId"
                      value={profileUniversityId}
                      onChange={(event) => {
                        const universityId = event.target.value;
                        setProfileUniversityId(universityId);
                        setAffiliationFacultyId("");
                        setAffiliationDepartmentId("");
                        setProfileDepartments({ loading: false, data: [] });
                        void loadProfileFaculties(universityId);
                      }}
                      required
                    >
                      <option value="">Üniversite seçin</option>
                      {(universities.data ?? []).map((university) => <option key={university.id} value={university.id}>{university.name}</option>)}
                    </select>
                  </label>
                  <label className="fieldLabel">Fakülte
                    <select
                      name="facultyId"
                      value={affiliationFacultyId}
                      onChange={(event) => {
                        const facultyId = event.target.value;
                        setAffiliationFacultyId(facultyId);
                        setAffiliationDepartmentId("");
                        void loadProfileDepartments(facultyId);
                      }}
                      disabled={!profileUniversityId || profileFaculties.loading}
                      required
                    >
                      <option value="">{profileFaculties.loading ? "Fakülteler yükleniyor" : "Fakülte seçin"}</option>
                      {availableFaculties.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}
                    </select>
                  </label>
                  <label className="fieldLabel">Bölüm
                    <select
                      name="departmentId"
                      value={affiliationDepartmentId}
                      onChange={(event) => setAffiliationDepartmentId(event.target.value)}
                      disabled={!affiliationFacultyId || profileDepartments.loading}
                      required
                    >
                      <option value="">{profileDepartments.loading ? "Bölümler yükleniyor" : "Bölüm seçin"}</option>
                      {availableDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                    </select>
                  </label>
                  <label className="fieldLabel">Sınıf seviyesi<ClassLevelSelect options={affiliationClassLevelOptions} /></label>
                  <button className="btn btn-primary" type="submit"><Check size={18} /> Akademik Profili Kaydet</button>
                </form>
                {profileUniversity && <form className="settingsGrid" onSubmit={suggestAcademicUnit}>
                  <input type="hidden" name="universityId" value={profileUniversity.id} />
                  <label className="fieldLabel">Eksik fakülte<input name="facultyName" placeholder="Fakülte adı" required /></label>
                  <label className="fieldLabel">Eksik bölüm<input name="departmentName" placeholder="Bölüm adı" /></label>
                  <select name="educationLevel" defaultValue="bachelor" aria-label="Eğitim düzeyi">
                    <option value="associate">Ön lisans</option>
                    <option value="bachelor">Lisans</option>
                    <option value="master">Yüksek lisans</option>
                    <option value="doctorate">Doktora</option>
                  </select>
                  <button className="btn btn-secondary" type="submit"><Sparkles size={18} /> İncelemeye Gönder</button>
                </form>}
              </>
            )}
          </section>
        )}

        <nav className="studentNav" aria-label="Öğrenci paneli bölümleri">
          <button className={studentPage === "landing" ? "tabButton active" : "tabButton"} type="button" onClick={() => openStudentPage("landing")}><GraduationCap size={16} /> Ana Sayfa</button>
          <button
            className={studentPage === "calendar" ? "tabButton active" : "tabButton"}
            type="button"
            onClick={() => openStudentPage("calendar")}
          >
            <CalendarDays size={16} /> Takvim
          </button>
          <button
            className={studentPage === "announcements" ? "tabButton active" : "tabButton"}
            type="button"
            onClick={() => openStudentPage("announcements")}
          >
            <Megaphone size={16} /> Duyurular
          </button>
          <button
            className={studentPage === "summer" ? "tabButton active" : "tabButton"}
            type="button"
            onClick={() => openStudentPage("summer")}
          >
            <Search size={16} /> Yaz Okulu
          </button>
          <button
            className={studentPage === "yok" ? "tabButton active" : "tabButton"}
            type="button"
            onClick={() => openStudentPage("yok")}
          >
            <BookOpen size={16} /> YÖK
          </button>
          <button
            className={studentPage === "settings" ? "tabButton active" : "tabButton"}
            type="button"
            onClick={() => openStudentPage("settings")}
          >
            <SlidersHorizontal size={16} /> Ayarlar
          </button>
        </nav>

        {studentPage === "landing" && (
          <section className="pageStack">
            <section className="panel landingPanel">
              <div className="sectionTitle"><GraduationCap size={18} /><h2>Öğrenci Ana Sayfası</h2></div>
              <p className="sectionHint">Merkezi akademik takviminize, üniversite duyurularına, yaz okulu fırsatlarına ve hesap ayarlarınıza hızlı erişim.</p>
              <div className="actionGrid">
                <button className="actionCard" type="button" onClick={() => openStudentPage("calendar")}><CalendarDays size={22} /><strong>Akademik Takvimim</strong><span>Üniversitenizin tek merkezi akademik takvimini görün.</span></button>
                <button className="actionCard" type="button" onClick={() => openStudentPage("announcements")}><Megaphone size={22} /><strong>Üniversite Duyuruları</strong><span>Seçtiğiniz üniversitenin resmi duyurularını kaynak sayfasından açın.</span></button>
                <button className="actionCard" type="button" onClick={() => openStudentPage("summer")}><Search size={22} /><strong>Yaz Okulu</strong><span>Bölümünüz için yayımlanmış yaz okulu tarihlerini ve kaynakları kontrol edin.</span></button>
                <button className="actionCard" type="button" onClick={() => openStudentPage("yok")}><BookOpen size={22} /><strong>YÖK Duyuruları</strong><span>Yükseköğretim Kurulu duyurularını resmi kaynaktan takip edin.</span></button>
                <button className="actionCard" type="button" onClick={() => openStudentPage("settings")}><Settings size={22} /><strong>Ayarlar</strong><span>Profil, hatırlatmalar, sessiz saatler ve cihazları yönetin.</span></button>
              </div>
            </section>

            <section className="panel">
              <div className="sectionTitle"><Bell size={18} /><h2>Yaklaşanlar</h2><button className="btn btn-secondary" type="button" onClick={loadUpcoming} title="Yenile" disabled={!isAuthenticated || upcoming.loading}><RefreshCcw size={16} /> Yenile</button></div>
              {upcoming.loading && <PanelState kind="loading" text="Yaklaşan etkinlikler yükleniyor..." />}
              {upcoming.error && <PanelState kind="error" text={upcoming.error} />}
              {!upcoming.loading && !upcoming.error && (upcoming.data?.length ?? 0) === 0 && <PanelState kind="empty" text="Zaman çizelgenizde yaklaşan etkinlik yok." />}
              <div className="eventList compact">{(upcoming.data ?? []).map((event) => <article className="eventItem" key={event.id}><strong>{event.title}</strong><time>{new Date(event.startDate).toLocaleDateString("tr-TR")}</time></article>)}</div>
            </section>
          </section>
        )}

        {studentPage === "calendar" && (
          <section className="pageStack">
            <section className="panel">
              <div className="sectionTitle"><Smartphone size={18} /><h2>Mobil Takvim</h2><button className="btn btn-secondary" type="button" onClick={loadCalendarIntegrations} disabled={calendarIntegrations.loading}><RefreshCcw size={16} /> Yenile</button></div>
              {calendarIntegrations.loading && <PanelState kind="loading" text="Takvim baglantilari hazirlaniyor..." />}
              {calendarIntegrations.error && <PanelState kind="error" text={calendarIntegrations.error} />}
              {calendarIntegrations.data && (
                <div className="calendarIntegrationGrid">
                  <a className="btn btn-primary" href={calendarIntegrations.data.appleSubscribeUrl}><Smartphone size={16} /> Apple Calendar</a>
                  <a className="btn btn-secondary" href={calendarIntegrations.data.googleSubscribeUrl} target="_blank" rel="noreferrer"><CalendarDays size={16} /> Google Calendar</a>
                  <a className="btn btn-secondary" href={calendarIntegrations.data.feedUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> ICS</a>
                </div>
              )}
            </section>
            <section className="panel">
              <div className="sectionTitle"><CalendarDays size={18} /><h2>Akademik Takvimim</h2><button className="btn btn-secondary" type="button" onClick={() => { void loadMyCalendar(); void loadCourseSchedules(); void loadExamSchedules(); }} disabled={calendar.loading || courseSchedules.loading || examSchedules.loading}><RefreshCcw size={16} /> Yenile</button></div>
              <p className="sectionHint">Bu tarihler, seçili üniversitenin tek merkezi akademik takviminden gelir.</p>
              {profile.data && <div className="profileStrip"><span>{universityName(profile.data.universityId)}</span></div>}
              {calendar.data?.calendar && (
                <div className="calendarTitle">
                  <div>
                    <strong>{calendar.data.calendar.title}</strong>
                    <span>{calendar.data.calendar.academicYear}</span>
                  </div>
                  {calendar.data.calendar.sourceUrl && <a className="sourceLink" href={calendar.data.calendar.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Başvuru / Kaynak</a>}
                </div>
              )}
              {calendar.loading && <PanelState kind="loading" text="Akademik takviminiz yükleniyor..." />}
              {calendar.error && <PanelState kind="error" text={calendar.error} />}
              {!calendar.loading && !calendar.error && displayableCalendarEvents.length === 0 && <PanelState kind="empty" text="Henüz yayınlanmış akademik takvim etkinliği yok." />}
              <div className="eventList">{visibleCalendarEvents.map((event) => (
                <article className="eventItem" key={event.id}>
                  <span>{categoryLabels[event.category] ?? event.category}</span>
                  <strong>{event.title}</strong>
                  <time>{formatEventDateRange(event)}</time>
                  <div className="alarmActions">
                    <button className="btn btn-secondary" type="button" onClick={() => createStudentAlarm({ eventType: eventAlarmType(event), targetId: event.id, title: event.title, scheduledFor: event.startDate, trigger: "at_time", amount: 0, unit: "days" })}><Bell size={14} /> Zamanında</button>
                    <button className="btn btn-secondary" type="button" onClick={() => createStudentAlarm({ eventType: eventAlarmType(event), targetId: event.id, title: event.title, scheduledFor: event.startDate, trigger: "before", amount: 1, unit: "days" })}>1 gün</button>
                    <button className="btn btn-secondary" type="button" onClick={() => createStudentAlarm({ eventType: eventAlarmType(event), targetId: event.id, title: event.title, scheduledFor: event.startDate, trigger: "before", amount: 3, unit: "hours" })}>3 saat</button>
                  </div>
                </article>
              ))}</div>
              {hiddenCalendarEventCount > 0 && (
                <button className="btn btn-secondary fullWidth seeMoreButton" type="button" onClick={() => setShowAllCalendarEvents(true)}>
                  Daha fazla gör ({hiddenCalendarEventCount})
                </button>
              )}
            </section>
            <section className="panel">
              <div className="sectionTitle"><BookOpen size={18} /><h2>Bölüm Ders Programı</h2><button className="btn btn-secondary" type="button" onClick={loadCourseSchedules} disabled={courseSchedules.loading}><RefreshCcw size={16} /> Yenile</button></div>
              {profile.data && <div className="profileStrip"><span>{departmentName(profile.data.departmentId)}</span></div>}
              {courseSchedules.data?.sourceUrl && (
                <div className="calendarTitle">
                  <div><strong>Resmi ders programı kaynağı</strong><span>{courseSchedules.data.sourceStatus === "parsed" ? "Yapılandırılmış" : "Kaynak"}</span></div>
                  <a className="sourceLink" href={courseSchedules.data.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Kaynağı Aç</a>
                </div>
              )}
              {courseSchedules.loading && <PanelState kind="loading" text="Ders programı yükleniyor..." />}
              {courseSchedules.error && <PanelState kind="error" text={courseSchedules.error} />}
              {!courseSchedules.loading && !courseSchedules.error && courseScheduleEvents.length === 0 && !courseSchedules.data?.sourceUrl && <PanelState kind="empty" text="Bu bölüm için yayımlanmış ders programı henüz bulunamadı." />}
              <div className="eventList">{visibleCourseScheduleEvents.map(renderScheduleItem)}</div>
              {hiddenCourseScheduleEventCount > 0 && (
                <button className="btn btn-secondary fullWidth seeMoreButton" type="button" onClick={() => setShowAllCourseScheduleEvents(true)}>
                  Daha fazla gör ({hiddenCourseScheduleEventCount})
                </button>
              )}
            </section>
            <section className="panel">
              <div className="sectionTitle"><AlertTriangle size={18} /><h2>Bölüm Sınav Programı</h2><button className="btn btn-secondary" type="button" onClick={loadExamSchedules} disabled={examSchedules.loading}><RefreshCcw size={16} /> Yenile</button></div>
              {profile.data && <div className="profileStrip"><span>{departmentName(profile.data.departmentId)}</span></div>}
              {examSchedules.data?.sourceUrl && (
                <div className="calendarTitle">
                  <div><strong>Resmi sınav programı kaynağı</strong><span>{examSchedules.data.sourceStatus === "parsed" ? "Yapılandırılmış" : "Kaynak"}</span></div>
                  <a className="sourceLink" href={examSchedules.data.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Kaynağı Aç</a>
                </div>
              )}
              {examSchedules.loading && <PanelState kind="loading" text="Sınav programı yükleniyor..." />}
              {examSchedules.error && <PanelState kind="error" text={examSchedules.error} />}
              {!examSchedules.loading && !examSchedules.error && examScheduleEvents.length === 0 && !examSchedules.data?.sourceUrl && <PanelState kind="empty" text="Bu bölüm için yayımlanmış sınav programı henüz bulunamadı." />}
              <div className="eventList">{visibleExamScheduleEvents.map(renderScheduleItem)}</div>
              {hiddenExamScheduleEventCount > 0 && (
                <button className="btn btn-secondary fullWidth seeMoreButton" type="button" onClick={() => setShowAllExamScheduleEvents(true)}>
                  Daha fazla gör ({hiddenExamScheduleEventCount})
                </button>
              )}
            </section>
          </section>
        )}

        {studentPage === "announcements" && (
          <section className="pageStack">
            <section className="panel">
              <div className="sectionTitle"><Megaphone size={18} /><h2>Duyurular, Haberler ve Etkinlikler</h2><button className="btn btn-secondary" type="button" onClick={() => loadMyAnnouncements()} disabled={announcements.loading}><RefreshCcw size={16} /> Yenile</button></div>
              <p className="sectionHint">Üniversite, fakülte ve bölüm kaynaklarından gelen içerikler ayrı başlıklar altında gösterilir.</p>
              {profile.data && <div className="profileStrip"><span>{universityName(profile.data.universityId)}</span></div>}
              {announcements.loading && <PanelState kind="loading" text="Duyurular yükleniyor..." />}
              {announcements.error && <PanelState kind="error" text={announcements.error} />}
              {!announcements.loading && !announcements.error && announcementFeed.length === 0 && <PanelState kind="empty" text="Bu profil için henüz duyuru, haber veya etkinlik bulunamadı." />}
              {!announcements.loading && !announcements.error && announcementFeed.length > 0 && !hasVisibleAnnouncements && <PanelState kind="empty" text="Son bir haftada yeni içerik yok. Eski kayıtlar için daha fazla gösterin." />}
              <div className="announcementGroupedList">
                {announcementSections.map((section) => (
                  <section className="announcementGroup" key={section.key}>
                    <div className="announcementGroupHeader"><strong>{section.title}</strong><span>{section.items.length} kayıt</span></div>
                    <div className="eventList">
                      {section.visibleItems.map((announcement) => (
                        <article className="eventItem announcementItem" key={announcement.id}>
                          <span>{announcement.sourceName}</span>
                          <strong>{announcement.title}</strong>
                          {announcement.summary && <p>{announcement.summary}</p>}
                          {(announcement.publishedAt ?? announcement.fetchedAt) && <time>{new Date(announcement.publishedAt ?? announcement.fetchedAt ?? "").toLocaleDateString("tr-TR")}</time>}
                          <a className="sourceLink" href={announcement.link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {announcementOpenLabel(announcement)}</a>
                          <div className="alarmActions">
                            <button className="btn btn-secondary" type="button" onClick={() => createStudentAlarm({ eventType: "announcement", targetId: announcement.id, title: announcement.title, scheduledFor: nextAnnouncementReminderIso(), trigger: "at_time", amount: 0, unit: "days", sourceUrl: announcement.link })}><Bell size={14} /> Hatırlat</button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              {!announcements.loading && !announcements.error && hiddenOlderAnnouncementCount > 0 && !showOlderAnnouncements && (
                <button className="btn btn-secondary fullWidth" type="button" onClick={() => setShowOlderAnnouncements(true)}>Daha fazla göster ({hiddenOlderAnnouncementCount})</button>
              )}
            </section>
          </section>
        )}

        {studentPage === "summer" && (
          <section className="pageStack">
            <section className="panel">
              <div className="sectionTitle"><Search size={18} /><h2>Yaz Okulu</h2><button className="btn btn-secondary" type="button" onClick={loadSummerSchool} disabled={summerSchool.loading}><RefreshCcw size={16} /> Yenile</button></div>
              <p className="sectionHint">Yaz okulu bilgileri, seçtiğiniz üniversitenin duyurularından, fakülte/bölüm kaynaklarından ve yayımlanmış akademik takvim satırlarından alınır.</p>
              {summerSchool.data?.profile && (
                <div className="profileStrip">
                  <span>{summerSchool.data.profile.universityName ?? universityName(summerSchool.data.profile.universityId)}</span>
                  <span>{summerSchool.data.profile.facultyName ?? facultyName(summerSchool.data.profile.facultyId)}</span>
                  <span>{summerSchool.data.profile.departmentName ?? departmentName(summerSchool.data.profile.departmentId)}</span>
                </div>
              )}
              {summerSchool.loading && <PanelState kind="loading" text="Yaz okulu bilgileri yükleniyor..." />}
              {summerSchool.error && <PanelState kind="error" text={summerSchool.error} />}
              {!summerSchool.loading && !summerSchool.error && !hasSummerSchoolContent && <PanelState kind="empty" text="Bu bölüm için yayımlanmış yaz okulu bilgisi henüz bulunamadı." />}
              {summerRequirements.length > 0 && (
                <div className="eventList">
                  {summerRequirements.map((requirement) => (
                    <article className="eventItem announcementItem" key={requirement.eventId ?? `${requirement.message}-${requirement.date ?? ""}`}>
                      <span>Şart / Başvuru</span>
                      <strong>{requirement.message}</strong>
                      {requirement.date && <time>{new Date(requirement.date).toLocaleDateString("tr-TR")}</time>}
                      {requirement.sourceUrl && <a className="sourceLink" href={requirement.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Başvuru / Kaynak</a>}
                    </article>
                  ))}
                </div>
              )}
              {summerOwnAnnouncements.length > 0 && (
                <div className="eventList">
                  {summerOwnAnnouncements.map((announcement) => (
                    <article className="eventItem announcementItem" key={`summer-own-${announcement.id}`}>
                      <span>{announcement.sourceName}</span>
                      <strong>{announcement.title}</strong>
                      {announcement.summary && <p>{announcement.summary}</p>}
                      {(announcement.publishedAt ?? announcement.fetchedAt) && <time>{new Date(announcement.publishedAt ?? announcement.fetchedAt ?? "").toLocaleDateString("tr-TR")}</time>}
                      <a className="sourceLink" href={announcement.link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Duyuruyu Aç</a>
                      <div className="alarmActions">
                        <button className="btn btn-secondary" type="button" onClick={() => createStudentAlarm({ eventType: "announcement", targetId: announcement.id, title: announcement.title, scheduledFor: nextAnnouncementReminderIso(), trigger: "at_time", amount: 0, unit: "days", sourceUrl: announcement.link })}><Bell size={14} /> Hatırlat</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {summerSameDepartmentAnnouncements.length > 0 && (
              <section className="panel">
                <div className="sectionTitle"><Megaphone size={18} /><h2>Aynı Bölüm Duyuruları</h2></div>
                <div className="eventList">
                  {summerSameDepartmentAnnouncements.map((announcement) => (
                    <article className="eventItem announcementItem" key={`summer-department-${announcement.id}`}>
                      <span>{announcement.sourceName}</span>
                      <strong>{announcement.title}</strong>
                      {announcement.summary && <p>{announcement.summary}</p>}
                      {(announcement.publishedAt ?? announcement.fetchedAt) && <time>{new Date(announcement.publishedAt ?? announcement.fetchedAt ?? "").toLocaleDateString("tr-TR")}</time>}
                      <a className="sourceLink" href={announcement.link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Duyuruyu Aç</a>
                      <div className="alarmActions">
                        <button className="btn btn-secondary" type="button" onClick={() => createStudentAlarm({ eventType: "announcement", targetId: announcement.id, title: announcement.title, scheduledFor: nextAnnouncementReminderIso(), trigger: "at_time", amount: 0, unit: "days", sourceUrl: announcement.link })}><Bell size={14} /> Hatırlat</button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {summerOptions.length > 0 && (
              <section className="panel">
                <div className="sectionTitle"><University size={18} /><h2>Aynı Bölüm Seçenekleri</h2></div>
                <div className="eventList">
                  {summerOptions.map((option) => (
                    <article className="eventItem announcementItem" key={`${option.universityId}-${option.academicYear}`}>
                      <span>{option.academicYear}</span>
                      <strong>{option.universityName}</strong>
                      {(option.matchingDepartments?.length ?? 0) > 0 && (
                        <p>{option.matchingDepartments?.map((match) => `${match.departmentName} - ${match.facultyName}`).join(" · ")}</p>
                      )}
                      <p>{option.events.map((event) => `${categoryLabels[event.category] ?? event.category}: ${new Date(event.startDate).toLocaleDateString("tr-TR")}`).join(" · ")}</p>
                      {option.sourceUrl && <a className="sourceLink" href={option.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Başvuru / Kaynak</a>}
                    </article>
                  ))}
                </div>
              </section>
            )}
          </section>
        )}

        {studentPage === "yok" && (
          <section className="pageStack">
            <section className="panel">
              <div className="sectionTitle"><BookOpen size={18} /><h2>YÖK Duyuruları</h2><button className="btn btn-secondary" type="button" onClick={loadYokAnnouncements} disabled={yokAnnouncements.loading}><RefreshCcw size={16} /> Yenile</button></div>
              <p className="sectionHint">Yükseköğretim Kurulu duyuruları resmi YÖK kaynağından alınır. Son bir haftanın duyuruları önde gösterilir.</p>
              {yokAnnouncements.loading && <PanelState kind="loading" text="YÖK duyuruları yükleniyor..." />}
              {yokAnnouncements.error && <PanelState kind="error" text={yokAnnouncements.error} />}
              {!yokAnnouncements.loading && !yokAnnouncements.error && (yokAnnouncements.data?.length ?? 0) === 0 && <PanelState kind="empty" text="Henüz YÖK duyurusu bulunamadı." />}
              {!yokAnnouncements.loading && !yokAnnouncements.error && (yokAnnouncements.data?.length ?? 0) > 0 && visibleYokAnnouncements.length === 0 && <PanelState kind="empty" text="Son bir haftada yeni YÖK duyurusu yok. Eski duyurular için daha fazla gösterin." />}
              <div className="eventList">
                {visibleYokAnnouncements.map((announcement) => (
                  <article className="eventItem announcementItem" key={announcement.id}>
                    <span>{announcement.sourceName}</span>
                    <strong>{announcement.title}</strong>
                    {announcement.summary && <p>{announcement.summary}</p>}
                    {(announcement.publishedAt ?? announcement.fetchedAt) && <time>{new Date(announcement.publishedAt ?? announcement.fetchedAt ?? "").toLocaleDateString("tr-TR")}</time>}
                    <a className="sourceLink" href={announcement.link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Duyuruyu Aç</a>
                    <div className="alarmActions">
                      <button className="btn btn-secondary" type="button" onClick={() => createStudentAlarm({ eventType: "announcement", targetId: announcement.id, title: announcement.title, scheduledFor: nextAnnouncementReminderIso(), trigger: "at_time", amount: 0, unit: "days", sourceUrl: announcement.link })}><Bell size={14} /> Hatırlat</button>
                    </div>
                  </article>
                ))}
              </div>
              {!yokAnnouncements.loading && !yokAnnouncements.error && yokAnnouncementGroups.older.length > 0 && !showOlderYokAnnouncements && (
                <button className="btn btn-secondary fullWidth" type="button" onClick={() => setShowOlderYokAnnouncements(true)}>Daha fazla göster</button>
              )}
            </section>
          </section>
        )}

        {studentPage === "settings" && (
        <section className="panel">
          <div className="sectionTitle"><Settings size={18} /><h2>Detaylı Ayarlar</h2><button className="btn btn-secondary" type="button" onClick={() => { void loadProfile(); void loadPreferences(); }} title="Yenile" disabled={!isAuthenticated || preferences.loading || profile.loading}><RefreshCcw size={16} /> Yenile</button></div>
          <p className="sectionHint">Profilinizi, akademik seviyenizi, bildirim kategorilerini, hatırlatmaları ve cihaz kaydını yönetin.</p>
          <p className="sectionHint">Akademik takvim yalnızca üniversitenize göre gösterilir; fakülte veya bölüm takvimi ayrıca gösterilmez.</p>
          {profile.loading && <PanelState kind="loading" text="Profil yükleniyor..." />}
          {profile.error && <PanelState kind="error" text={profile.error} />}
          <form className="settingsGrid profileSettings" onSubmit={saveProfile}>
            <label className="fieldLabel">Ad soyad<input name="fullName" defaultValue={profile.data?.fullName ?? session.user.fullName ?? ""} placeholder="Ad soyad" /></label>
            <label className="fieldLabel">E-posta<input value={profile.data?.email ?? session.user.email} disabled aria-label="E-posta adresi" /></label>
            <label className="fieldLabel">Rol<input value={roleLabels[profile.data?.role ?? session.user.role]} disabled aria-label="Rol" /></label>
            <label className="fieldLabel">Sınıf seviyesi<ClassLevelSelect options={profileClassLevelOptions} defaultValue={profile.data?.classLevel ?? ""} /></label>
            <button className="btn btn-primary" disabled={!isAuthenticated}><Check size={18} /> Profili Kaydet</button>
          </form>
          {(universities.data?.length ?? 0) > 0 && (
            <form className="settingsGrid" onSubmit={saveAffiliation}>
              <label className="fieldLabel">Üniversitem
                <select
                  name="universityId"
                  value={profileUniversityId}
                  onChange={(event) => {
                    const universityId = event.target.value;
                    setProfileUniversityId(universityId);
                    setAffiliationFacultyId("");
                    setAffiliationDepartmentId("");
                    setProfileDepartments({ loading: false, data: [] });
                    void loadProfileFaculties(universityId);
                  }}
                  required
                >
                  <option value="">Üniversite seçin</option>
                  {(universities.data ?? []).map((university) => <option key={university.id} value={university.id}>{university.name}</option>)}
                </select>
              </label>
              <label className="fieldLabel">Fakültem
                <select
                  name="facultyId"
                  value={affiliationFacultyId}
                  onChange={(event) => {
                    const facultyId = event.target.value;
                    setAffiliationFacultyId(facultyId);
                    setAffiliationDepartmentId("");
                    void loadProfileDepartments(facultyId);
                  }}
                  disabled={!profileUniversityId || profileFaculties.loading}
                  required
                >
                  <option value="">{profileFaculties.loading ? "Fakülteler yükleniyor" : "Fakülte seçin"}</option>
                  {availableFaculties.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}
                </select>
              </label>
              <label className="fieldLabel">Bölümüm
                <select
                  name="departmentId"
                  value={affiliationDepartmentId}
                  onChange={(event) => setAffiliationDepartmentId(event.target.value)}
                  disabled={!affiliationFacultyId || profileDepartments.loading}
                  required
                >
                  <option value="">{profileDepartments.loading ? "Bölümler yükleniyor" : "Bölüm seçin"}</option>
                  {availableDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </label>
              <label className="fieldLabel">Sınıf seviyesi<ClassLevelSelect options={affiliationClassLevelOptions} defaultValue={profile.data?.classLevel ?? ""} /></label>
              <button className="btn btn-primary" disabled={!isAuthenticated}><University size={18} /> Akademik Profili Kaydet</button>
            </form>
          )}
          {preferences.loading && <PanelState kind="loading" text="Tercihler yükleniyor..." />}
          <form className="settingsGrid" onSubmit={savePreferences}>
            <label className="fieldLabel">Bildirim durumu
              <select name="enabled" value="disabled" disabled>
                <option value="disabled">Kapalı</option>
              </select>
            </label>
            <p className="helperText">Web Push bu istemcide yapılandırılmadı. Gerçek cihaz teslimatı yalnızca desteklenen native uygulamada, açık iznin ardından etkinleştirilebilir.</p>
            <label className="fieldLabel">Varsayılan hatırlatma
              <select name="reminderMode" defaultValue={defaultReminderMode}>
                <option value="at_time">Tam saatinde</option>
                <option value="approaching">Yaklaşırken</option>
                <option value="days_before">Gün önce</option>
                <option value="hours_before">Saat önce</option>
              </select>
            </label>
            <label className="fieldLabel">Gün sayısı<input name="dayBeforeDays" type="number" min="1" max="30" defaultValue={defaultReminderDays} /></label>
            <label className="fieldLabel">Saat sayısı<input name="hourBeforeHours" type="number" min="1" max="720" defaultValue={defaultReminderHours} /></label>
            <label className="fieldLabel">Sessiz saatler
              <select name="quietHours" defaultValue={preferences.data?.quietHours?.enabled === false ? "disabled" : "enabled"}>
                <option value="enabled">Etkin</option>
                <option value="disabled">Kapalı</option>
              </select>
            </label>
            <label className="fieldLabel">Sessiz başlangıç<input name="start" type="time" defaultValue={preferences.data?.quietHours?.start ?? "22:00"} /></label>
            <label className="fieldLabel">Sessiz bitiş<input name="end" type="time" defaultValue={preferences.data?.quietHours?.end ?? "07:00"} /></label>
            <button className="btn btn-primary" disabled={!isAuthenticated}><Check size={18} /> Tercihleri Kaydet</button>
          </form>
          {preferences.error && <PanelState kind="error" text={preferences.error} />}
        </section>
        )}
        {message && <div className="toast" role="status" aria-live="polite"><Sparkles size={16} aria-hidden="true" /> {message}</div>}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
