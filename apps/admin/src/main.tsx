import React, { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Archive,
  BellRing,
  BookOpen,
  Building2,
  CalendarCheck,
  Check,
  Download,
  FileText,
  History,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Pencil,
  Play,
  RefreshCcw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X
} from "lucide-react";
import "./styles.css";

type ApiState<T> = { loading: boolean; data?: T; error?: string };
type JsonRecord = Record<string, unknown>;
type AdminRoute = "dashboard" | "inputs" | "catalog" | "pdf" | "calendar" | "notifications" | "audit" | "users";
type AdminRole = "content_editor" | "university_admin" | "super_admin";
type AuthSession = { accessToken: string; refreshToken?: string; user: { id: string; fullName: string; email: string; role: AdminRole | "student" } };

interface UniversityRecord { id: string; name: string; city: string; type: string; status: string; websiteUrl?: string; announcementUrl?: string; academicCalendarUrl?: string; emailDomains?: string[]; }
interface FacultyRecord { id: string; universityId?: string; name: string; websiteUrl?: string; announcementUrl?: string; }
interface DepartmentRecord { id: string; universityId?: string; facultyId?: string; name: string; websiteUrl?: string; announcementUrl?: string; courseScheduleUrl?: string; examScheduleUrl?: string; }
interface DomainSuggestionRecord { domain: string; userCount: number; sampleEmails: string[]; }
interface AcademicUnitSuggestionRecord { id: string; userEmail: string; universityId: string; facultyName: string; departmentName?: string; educationLevel: string; status: string; createdAt: string; }
interface ExtractedEventRecord { id: string; pdfSourceId: string; normalizedTitle: string; normalizedCategory: string; startDate: string; endDate?: string; status: string; confidence: number; }
interface ProcessPdfResult { pdfSource: { id: string; parseStatus?: string }; extractedEvents: ExtractedEventRecord[]; }
interface AuditLogRecord { id: string; actorId: string; action: string; entityType: string; entityId: string; createdAt: string; }
interface WorkerResult { processedJobs: number; sent: number; failed: number; deferred?: number; skipped?: number; }
interface NotificationJobRecord { id: string; title: string; status: string; scheduledAt: string; }
interface NotificationDeliveryRecord { id: string; jobId: string; userId: string; token: string; status: string; providerMessageId?: string; failureReason?: string; createdAt: string; }
interface AdminUserRecord {
  id: string;
  fullName: string;
  email: string;
  role: "student" | "content_editor" | "university_admin" | "super_admin";
  status: "active" | "inactive" | "locked";
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
  classLevel?: number;
  emailVerifiedAt?: string;
  createdAt?: string;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const mainAppUrl = import.meta.env.VITE_MAIN_APP_URL ?? "https://fir-8868b.web.app/";
const adminRoles = new Set(["content_editor", "university_admin", "super_admin"]);
const adminSessionStorageKey = "academic-calendar-admin-session";

const routes: Array<{ id: AdminRoute; label: string; icon: ReactNode; description: string }> = [
  { id: "dashboard", label: "Panel", icon: <LayoutDashboard size={18} />, description: "Operasyon özeti ve hızlı giriş noktaları" },
  { id: "inputs", label: "Girişler", icon: <Pencil size={18} />, description: "Manuel katalog, alan adı ve takvim girişi" },
  { id: "catalog", label: "Katalog", icon: <Building2 size={18} />, description: "Üniversiteler, fakülteler ve bölümler" },
  { id: "pdf", label: "PDF İşlemleri", icon: <FileText size={18} />, description: "Kaynak oluşturma ve çıkarım incelemesi" },
  { id: "calendar", label: "Yayınla", icon: <CalendarCheck size={18} />, description: "Takvimleri taslak yap, yayınla ve geri al" },
  { id: "notifications", label: "Bildirimler", icon: <BellRing size={18} />, description: "Kuyruk işleme ve teslimat inceleme" },
  { id: "audit", label: "Denetim", icon: <History size={18} />, description: "Varlık işlem geçmişi ve dışa aktarımlar" },
  { id: "users", label: "Kullanıcılar", icon: <Users size={18} />, description: "Kayıtlı kullanıcıları görüntüle, düzenle ve kaldır" }
];

const roleLabels: Record<AdminUserRecord["role"], string> = {
  student: "Öğrenci",
  content_editor: "İçerik Editörü",
  university_admin: "Üniversite Yöneticisi",
  super_admin: "Süper Yönetici"
};

const statusLabels: Record<AdminUserRecord["status"], string> = {
  active: "Aktif",
  inactive: "Pasif",
  locked: "Kilitli"
};

const universityTypeLabels: Record<string, string> = {
  state: "Devlet",
  foundation: "Vakıf",
  private: "Özel"
};

const educationLevelLabels: Record<string, string> = {
  associate: "Ön lisans",
  bachelor: "Lisans",
  master: "Yüksek lisans",
  doctorate: "Doktora"
};

const termLabels: Record<string, string> = {
  fall: "Güz",
  spring: "Bahar",
  summer: "Yaz",
  full_year: "Tüm yıl",
  unknown: "Bilinmiyor"
};

const eventCategoryLabels: Record<string, string> = {
  course_registration: "Ders kaydı",
  course_add_drop: "Ekle-sil",
  course_schedule: "Course schedule",
  midterm_exam: "Ara sınav",
  final_exam: "Final sınavı",
  department_exam_schedule: "Exam schedule",
  summer_school_registration: "Yaz okulu kaydı",
  summer_school_start: "Yaz okulu başlangıcı",
  holiday: "Tatil",
  custom_event: "Özel"
};

const reviewStatusLabels: Record<string, string> = {
  pending_review: "İncelemede",
  approved: "Onaylandı",
  rejected: "Reddedildi"
};

const jobStatusLabels: Record<string, string> = {
  scheduled: "Planlandı",
  processing: "İşleniyor",
  sent: "Gönderildi",
  failed: "Başarısız",
  deferred: "Ertelendi",
  skipped: "Atlandı",
  cancelled: "İptal edildi",
  delivered: "Teslim edildi"
};

const auditActionLabels: Record<string, string> = {
  "calendar.published": "Takvim yayınlandı",
  "calendar.rollback": "Takvim geri alındı",
  "calendar.rollback_archived": "Takvim geri alındı ve arşivlendi"
};

function routeFromHash(): AdminRoute {
  const candidate = window.location.hash.replace("#/", "").replace("#", "").split("?")[0] as AdminRoute;
  return routes.some((route) => route.id === candidate) ? candidate : "dashboard";
}

function handoffTokenFromHash(): string {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash.startsWith("handoff?")) return "";
  return new URLSearchParams(hash.slice("handoff?".length)).get("accessToken") ?? "";
}

function readStoredSession(): AuthSession | null {
  try {
    const raw = window.sessionStorage.getItem(adminSessionStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.accessToken || !parsed.user || !adminRoles.has(parsed.user.role)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storeSession(session: AuthSession | null) {
  if (!session) {
    window.sessionStorage.removeItem(adminSessionStorageKey);
    return;
  }

  window.sessionStorage.setItem(adminSessionStorageKey, JSON.stringify(session));
}

type PanelStateProps = {
  kind: "loading" | "error" | "empty";
  text: string;
};

function PanelState({ kind, text }: PanelStateProps) {
  const icon = kind === "loading"
    ? <LoaderCircle size={18} className="spin" aria-hidden="true" />
    : <AlertTriangle size={18} aria-hidden="true" />;

  return (
    <div className={`panelState panelState-${kind}`} role={kind === "error" ? "alert" : "status"} aria-live="polite">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function PageHeader({ route }: { route: (typeof routes)[number] }) {
  return (
    <div className="pageTitle">
      <div className="pageIcon">{route.icon}</div>
      <div>
        <h1>{route.label}</h1>
        <p>{route.description}</p>
      </div>
    </div>
  );
}

function App() {
  const initialHandoffToken = handoffTokenFromHash();
  const initialStoredSession = readStoredSession();
  const [activeRoute, setActiveRoute] = useState<AdminRoute>(routeFromHash);
  const [session, setSession] = useState<AuthSession | null>(() => initialStoredSession);
  const [token, setToken] = useState(() => initialStoredSession?.accessToken ?? "");
  const [authState, setAuthState] = useState<ApiState<AuthSession>>({ loading: Boolean(initialHandoffToken || initialStoredSession) });
  const [entityType, setEntityType] = useState("academic_calendar");
  const [entityId, setEntityId] = useState("");
  const [jobId, setJobId] = useState("");
  const [pdfSourceId, setPdfSourceId] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [universityId, setUniversityId] = useState("");
  const [facultyId, setFacultyId] = useState("");
  const [message, setMessage] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userStatus, setUserStatus] = useState("");
  const [editingUserId, setEditingUserId] = useState("");
  const [manualEvents, setManualEvents] = useState([
    { title: "", category: "course_registration", term: "fall", startDate: "", endDate: "", facultyId: "", departmentId: "", offset7: true, offset1: true }
  ]);
  const [universities, setUniversities] = useState<ApiState<UniversityRecord[]>>({ loading: false });
  const [faculties, setFaculties] = useState<ApiState<FacultyRecord[]>>({ loading: false });
  const [events, setEvents] = useState<ApiState<ExtractedEventRecord[]>>({ loading: false });
  const [auditState, setAuditState] = useState<ApiState<AuditLogRecord[]>>({ loading: false });
  const [workerState, setWorkerState] = useState<ApiState<WorkerResult>>({ loading: false });
  const [failedState, setFailedState] = useState<ApiState<NotificationJobRecord[]>>({ loading: false });
  const [deliveryState, setDeliveryState] = useState<ApiState<NotificationDeliveryRecord[]>>({ loading: false });
  const [usersState, setUsersState] = useState<ApiState<AdminUserRecord[]>>({ loading: false });
  const [domainSuggestions, setDomainSuggestions] = useState<ApiState<DomainSuggestionRecord[]>>({ loading: false });
  const [academicUnitSuggestions, setAcademicUnitSuggestions] = useState<ApiState<AcademicUnitSuggestionRecord[]>>({ loading: false });
  const hasToken = token.trim().length > 0;
  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);
  const activeRouteConfig = routes.find((route) => route.id === activeRoute) ?? routes[0]!;

  useEffect(() => {
    const onHashChange = () => setActiveRoute(routeFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const handoffToken = handoffTokenFromHash();
    if (handoffToken) {
      void acceptHandoffToken(handoffToken);
      return;
    }

    const storedSession = readStoredSession();
    if (storedSession) void verifyStoredSession(storedSession);
  }, []);

  useEffect(() => {
    if (!message) return;
    const handle = setTimeout(() => setMessage(""), 3600);
    return () => clearTimeout(handle);
  }, [message]);

  useEffect(() => {
    if (!hasToken) return;
    if (activeRoute === "users" && !usersState.data && !usersState.loading) void loadUsers();
    if (activeRoute === "inputs") {
      if (!universities.data && !universities.loading) void loadUniversities();
      if (!domainSuggestions.data && !domainSuggestions.loading) void loadDomainSuggestions();
      if (!academicUnitSuggestions.data && !academicUnitSuggestions.loading) void loadAcademicUnitSuggestions();
    }
  }, [activeRoute, hasToken]);

  function ensureToken() {
    if (!hasToken) {
      setMessage("Yönetici panelini ana uygulamadan bir yönetici hesabıyla açın.");
      return false;
    }

    return true;
  }

  async function verifyStoredSession(storedSession: AuthSession) {
    setAuthState({ loading: true });
    try {
      const response = await fetch(`${apiBaseUrl}/me`, { headers: { Authorization: `Bearer ${storedSession.accessToken}` } });
      if (!response.ok) throw new Error("Yönetici oturumunuzun süresi doldu. Ana uygulamadan tekrar giriş yapın.");
      const user = await response.json() as AuthSession["user"];
      if (!adminRoles.has(user.role)) {
        storeSession(null);
        setSession(null);
        setToken("");
        setAuthState({ loading: false, error: "403 Yetkisiz. Bu hesapta yönetici yetkisi yok." });
        return;
      }

      const nextSession = { ...storedSession, user };
      setSession(nextSession);
      setToken(nextSession.accessToken);
      storeSession(nextSession);
      setAuthState({ loading: false, data: nextSession });
    } catch (error) {
      storeSession(null);
      setSession(null);
      setToken("");
      setAuthState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function acceptHandoffToken(accessToken: string) {
    setAuthState({ loading: true });
    try {
      const response = await fetch(`${apiBaseUrl}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error("Yönetici oturumu doğrulanamadı.");
      const user = await response.json() as AuthSession["user"];
      if (!adminRoles.has(user.role)) {
        storeSession(null);
        setSession(null);
        setToken("");
        setAuthState({ loading: false, error: "403 Yetkisiz. Bu hesapta yönetici yetkisi yok." });
        window.history.replaceState(null, "", `${window.location.pathname}#/dashboard`);
        return;
      }

      const nextSession = { accessToken, user };
      setSession(nextSession);
      setToken(accessToken);
      storeSession(nextSession);
      setAuthState({ loading: false, data: nextSession });
      setMessage("Yönetici oturumu hazır");
      window.history.replaceState(null, "", `${window.location.pathname}#/dashboard`);
      setActiveRoute("dashboard");
    } catch (error) {
      setAuthState({ loading: false, error: error instanceof Error ? error.message : String(error) });
      window.history.replaceState(null, "", `${window.location.pathname}#/dashboard`);
    }
  }

  function logout() {
    setSession(null);
    setToken("");
    storeSession(null);
    setAuthState({ loading: false });
    setMessage("");
    window.location.assign(mainAppUrl);
  }

  function switchToUserPanel() {
    const target = token ? `${mainAppUrl.replace(/\/$/, "")}/#/handoff?accessToken=${encodeURIComponent(token)}` : mainAppUrl;
    window.location.assign(target);
  }

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers: { "Content-Type": "application/json", ...headers, ...(options.headers ?? {}) } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body ? `${response.status} ${body}` : `${response.status} ${response.statusText}`);
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

  function formData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
  }

  function sourceFields(values: Record<string, string>, scope: "university" | "faculty" | "department") {
    const keys = scope === "university"
      ? ["websiteUrl", "announcementUrl", "academicCalendarUrl"]
      : scope === "faculty"
        ? ["websiteUrl", "announcementUrl"]
        : ["websiteUrl", "announcementUrl", "courseScheduleUrl", "examScheduleUrl"];
    return Object.fromEntries(
      keys
        .map((key) => [key, values[key]?.trim()])
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
    );
  }

  async function loadUniversities() {
    if (!ensureToken()) return;
    await runAction(setUniversities, () => request<UniversityRecord[]>("/universities?includeInactive=true&limit=500&offset=0"));
  }

  async function createUniversity(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken()) return;
    const values = formData(event);
    const emailDomains = values.emailDomains?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
    await request<UniversityRecord>("/admin/universities", { method: "POST", body: JSON.stringify({ name: values.name, city: values.city, type: values.type, ...sourceFields(values, "university"), ...(emailDomains.length ? { emailDomains } : {}) }) });
    await loadUniversities();
    setMessage("Üniversite oluşturuldu");
  }

  async function archiveUniversity(id: string) {
    if (!ensureToken()) return;
    await request<JsonRecord>(`/admin/universities/${id}`, { method: "DELETE" });
    await loadUniversities();
  }

  async function loadFaculties(targetUniversityId = universityId) {
    if (!ensureToken()) return;
    if (!targetUniversityId) return;
    await runAction(setFaculties, () => request<FacultyRecord[]>(`/universities/${targetUniversityId}/faculties`));
  }

  async function createFaculty(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken()) return;
    const values = formData(event);
    await request<FacultyRecord>(`/admin/universities/${values.universityId}/faculties`, { method: "POST", body: JSON.stringify({ name: values.name, ...sourceFields(values, "faculty") }) });
    setUniversityId(values.universityId);
    await loadFaculties(values.universityId);
    setMessage("Fakülte oluşturuldu");
  }

  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken()) return;
    const values = formData(event);
    await request<JsonRecord>(`/admin/universities/${values.universityId}/faculties/${values.facultyId}/departments`, { method: "POST", body: JSON.stringify({ name: values.name, educationLevel: values.educationLevel, ...sourceFields(values, "department") }) });
    setMessage("Bölüm oluşturuldu");
  }

  async function addUniversityEmailDomain(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken()) return;
    const values = formData(event);
    await request<UniversityRecord>(`/admin/universities/${values.universityId}/email-domains`, { method: "POST", body: JSON.stringify({ domain: values.domain }) });
    await loadUniversities();
    await loadDomainSuggestions();
    setMessage("E-posta alan adı ilişkilendirildi");
  }

  async function loadDomainSuggestions() {
    if (!ensureToken()) return;
    await runAction(setDomainSuggestions, () => request<DomainSuggestionRecord[]>("/admin/users/unassociated-email-domains"));
  }

  async function loadAcademicUnitSuggestions() {
    if (!ensureToken()) return;
    await runAction(setAcademicUnitSuggestions, () => request<AcademicUnitSuggestionRecord[]>("/admin/users/academic-unit-suggestions?status=pending"));
  }

  async function approveAcademicUnitSuggestion(id: string) {
    if (!ensureToken()) return;
    await request<AcademicUnitSuggestionRecord>(`/admin/users/academic-unit-suggestions/${id}/approve`, { method: "POST" });
    await loadAcademicUnitSuggestions();
    setMessage("Akademik birim önerisi onaylandı");
  }

  async function rejectAcademicUnitSuggestion(id: string) {
    if (!ensureToken()) return;
    await request<AcademicUnitSuggestionRecord>(`/admin/users/academic-unit-suggestions/${id}/reject`, { method: "POST" });
    await loadAcademicUnitSuggestions();
    setMessage("Akademik birim önerisi reddedildi");
  }

  function updateManualEvent(index: number, key: string, value: string | boolean) {
    setManualEvents((events) => events.map((event, eventIndex) => eventIndex === index ? { ...event, [key]: value } : event));
  }

  function addManualEventRow() {
    setManualEvents((events) => [...events, { title: "", category: "course_registration", term: "fall", startDate: "", endDate: "", facultyId: "", departmentId: "", offset7: true, offset1: true }]);
  }

  function removeManualEventRow(index: number) {
    setManualEvents((events) => events.length === 1 ? events : events.filter((_, eventIndex) => eventIndex !== index));
  }

  async function createManualCalendar(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken()) return;
    const values = formData(event);
    const created = await request<{ calendar: { id: string } }>("/admin/calendars/manual", {
      method: "POST",
      body: JSON.stringify({
        universityId: values.universityId,
        academicYear: values.academicYear,
        title: values.title,
        events: manualEvents
          .filter((row) => row.title && row.startDate)
          .map((row) => ({
            title: row.title,
            category: row.category,
            term: row.term,
            startDate: row.startDate,
            ...(row.endDate ? { endDate: row.endDate } : {}),
            ...(row.facultyId ? { facultyId: row.facultyId } : {}),
            ...(row.departmentId ? { departmentId: row.departmentId } : {}),
            notificationRules: [
              ...(row.offset7 ? [{ offsetDays: 7, enabled: true }] : []),
              ...(row.offset1 ? [{ offsetDays: 1, enabled: true }] : [])
            ]
          }))
      })
    });
    setCalendarId(created.calendar.id);
    setMessage("Manuel takvim taslağı oluşturuldu");
  }

  async function createPdfSource(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken()) return;
    const values = formData(event);
    const source = await request<{ id: string }>("/admin/pdf-sources", { method: "POST", body: JSON.stringify({ universityId: values.universityId, fileName: values.fileName, mimeType: "application/pdf", magicBytesHex: "255044462d312e37", fileSize: Number(values.fileSize), pageCount: Number(values.pageCount), academicYear: values.academicYear, rawText: values.rawText }) });
    setPdfSourceId(source.id);
    setMessage("PDF kaynağı oluşturuldu");
  }

  async function processPdf() {
    if (!ensureToken()) return;
    if (!pdfSourceId) {
      setMessage("PDF kaynak ID'si gerekli.");
      return;
    }

    const processed = await request<ProcessPdfResult>(`/admin/pdf-sources/${pdfSourceId}/process`, { method: "POST" });
    setMessage(`PDF işlendi: ${processed.extractedEvents.length} etkinlik çıkarıldı`);
    await loadExtractedEvents();
  }

  async function loadExtractedEvents() {
    if (!ensureToken()) return;
    const query = new URLSearchParams({ limit: "50", offset: "0" });
    if (pdfSourceId) query.set("pdfSourceId", pdfSourceId);
    await runAction(setEvents, () => request<ExtractedEventRecord[]>(`/admin/extracted-events?${query}`));
  }

  async function approveEvent(id: string) {
    if (!ensureToken()) return;
    await request<JsonRecord>(`/admin/extracted-events/${id}/approve`, { method: "POST" });
    await loadExtractedEvents();
  }

  async function rejectEvent(id: string) {
    if (!ensureToken()) return;
    await request<JsonRecord>(`/admin/extracted-events/${id}/reject`, { method: "POST", body: JSON.stringify({ adminNote: "Operasyon konsolundan reddedildi" }) });
    await loadExtractedEvents();
  }

  async function createCalendarDraft(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken()) return;
    const values = formData(event);
    const draft = await request<{ calendar: { id: string } }>("/admin/calendars", { method: "POST", body: JSON.stringify({ universityId: values.universityId, academicYear: values.academicYear, title: values.title, sourcePdfId: values.sourcePdfId }) });
    setCalendarId(draft.calendar.id);
    setEntityId(draft.calendar.id);
    setMessage("Takvim taslağı oluşturuldu");
  }

  async function publishCalendar() {
    if (!ensureToken()) return;
    if (!calendarId) {
      setMessage("Takvim ID'si gerekli.");
      return;
    }

    await request<JsonRecord>(`/admin/calendars/${calendarId}/publish`, { method: "POST" });
    setMessage("Takvim yayınlandı");
  }

  async function rollbackCalendar() {
    if (!ensureToken()) return;
    if (!calendarId) {
      setMessage("Takvim ID'si gerekli.");
      return;
    }

    await request<JsonRecord>(`/admin/calendars/${calendarId}/rollback`, { method: "POST" });
    setMessage("Takvim geri alındı");
  }

  async function loadAudit() {
    if (!ensureToken()) return;
    if (!entityId) {
      setMessage("Varlık ID'si gerekli.");
      return;
    }

    const query = new URLSearchParams({ entityType, entityId, limit: "50", offset: "0" });
    await runAction(setAuditState, () => request<AuditLogRecord[]>(`/admin/audit-logs?${query}`));
  }

  async function exportAudit() {
    if (!ensureToken()) return;
    if (!entityId) {
      setMessage("Varlık ID'si gerekli.");
      return;
    }

    const payload = await request<{ data: string; fileName: string }>(`/admin/audit-logs/export?${new URLSearchParams({ entityType, entityId })}`);
    const url = URL.createObjectURL(new Blob([payload.data], { type: "application/x-ndjson" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = payload.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function processDue() {
    if (!ensureToken()) return;
    await runAction(setWorkerState, () => request<WorkerResult>("/admin/notification-jobs/process-due?limit=100", { method: "POST" }));
  }

  async function loadFailed() {
    if (!ensureToken()) return;
    await runAction(setFailedState, () => request<NotificationJobRecord[]>("/admin/notification-jobs/failed?limit=50&offset=0"));
  }

  async function retryJob(id: string) {
    if (!ensureToken()) return;
    await request<JsonRecord>(`/admin/notification-jobs/retry?jobId=${encodeURIComponent(id)}`, { method: "POST" });
    await loadFailed();
  }

  async function loadDeliveries(targetJobId = jobId) {
    if (!ensureToken()) return;
    if (!targetJobId) return;
    await runAction(setDeliveryState, () => request<NotificationDeliveryRecord[]>(`/admin/notification-jobs/deliveries?jobId=${encodeURIComponent(targetJobId)}&limit=100&offset=0`));
  }

  async function loadUsers() {
    if (!ensureToken()) return;
    const query = new URLSearchParams({ limit: "100", offset: "0" });
    if (userSearch.trim()) query.set("search", userSearch.trim());
    if (userStatus) query.set("status", userStatus);
    await runAction(setUsersState, () => request<AdminUserRecord[]>(`/admin/users?${query}`));
  }

  async function updateUser(event: FormEvent<HTMLFormElement>, userId: string) {
    if (!ensureToken()) return;
    const values = formData(event);
    await request<AdminUserRecord>(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({
        fullName: values.fullName,
        role: values.role,
        status: values.status,
        universityId: values.universityId || undefined,
        facultyId: values.facultyId || undefined,
        departmentId: values.departmentId || undefined,
        classLevel: values.classLevel ? Number(values.classLevel) : undefined
      })
    });
    setEditingUserId("");
    await loadUsers();
    setMessage("Kullanıcı güncellendi");
  }

  async function deleteUser(id: string) {
    if (!ensureToken()) return;
    const confirmed = window.confirm("Bu kullanıcıyı yönetimden silmek istiyor musunuz?");
    if (!confirmed) return;
    await request<JsonRecord>(`/admin/users/${id}`, { method: "DELETE" });
    await loadUsers();
    setMessage("Kullanıcı silindi");
  }

  const pageProps = {
    hasToken,
    universities,
    faculties,
    events,
    auditState,
    workerState,
    failedState,
    deliveryState,
    usersState,
    domainSuggestions,
    academicUnitSuggestions,
    manualEvents,
    universityId,
    facultyId,
    pdfSourceId,
    calendarId,
    entityType,
    entityId,
    jobId,
    userSearch,
    userStatus,
    editingUserId,
    setUniversityId,
    setFacultyId,
    setPdfSourceId,
    setCalendarId,
    setEntityType,
    setEntityId,
    setJobId,
    setUserSearch,
    setUserStatus,
    setEditingUserId,
    updateManualEvent,
    addManualEventRow,
    removeManualEventRow,
    loadUniversities,
    createUniversity,
    archiveUniversity,
    loadFaculties,
    createFaculty,
    createDepartment,
    addUniversityEmailDomain,
    loadDomainSuggestions,
    loadAcademicUnitSuggestions,
    approveAcademicUnitSuggestion,
    rejectAcademicUnitSuggestion,
    createManualCalendar,
    createPdfSource,
    processPdf,
    loadExtractedEvents,
    approveEvent,
    rejectEvent,
    createCalendarDraft,
    publishCalendar,
    rollbackCalendar,
    loadAudit,
    exportAudit,
    processDue,
    loadFailed,
    retryJob,
    loadDeliveries,
    loadUsers,
    updateUser,
    deleteUser
  };

  if (!hasToken) {
    if (authState.loading) {
      return (
        <main className="adminLoginShell">
          <section className="adminLoginPanel">
            <div className="brand loginBrand"><ShieldCheck size={22} /> Akademik Takvim OS</div>
            <div className="sectionIntro">
              <h1>Yönetici Paneli Açılıyor</h1>
              <p>Oturumunuz doğrulanıyor.</p>
            </div>
            <PanelState kind="loading" text="Yönetici oturumu doğrulanıyor..." />
          </section>
        </main>
      );
    }

    return (
      <main className="adminLoginShell">
        <section className="adminLoginPanel">
          <div className="brand loginBrand"><ShieldCheck size={22} /> Akademik Takvim OS</div>
          <div className="sectionIntro">
            <h1>403 Yetkisiz</h1>
            <p>Yönetici erişimi yalnızca ana giriş ekranından açılır. Orada bir yönetici hesabıyla giriş yapıp Yönetici Paneli'ni seçin.</p>
          </div>
          <button className="btn btn-primary" type="button" onClick={() => window.location.assign(mainAppUrl)}><ShieldCheck size={18} /> Girişe Git</button>
          {authState.loading && <PanelState kind="loading" text="Yönetici oturumu doğrulanıyor..." />}
          {authState.error && <PanelState kind="error" text={authState.error} />}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><ShieldCheck size={22} /> Akademik Takvim OS</div>
        <p className="sidebarTagline">Katalog, yayınlama, kullanıcılar ve bildirim güvenliği için operasyon merkezi.</p>
        <nav aria-label="Yönetici bölümleri">
          {routes.map((route) => (
            <a key={route.id} href={`#/${route.id}`} className={activeRoute === route.id ? "active" : ""}>
              {route.icon}
              <span>{route.label}</span>
            </a>
          ))}
        </nav>
      </aside>
      <section className="content">
        <header className="topbar">
          <PageHeader route={activeRouteConfig} />
          <div className="accountBox">
            <span>{session?.user.email ?? "Yönetici oturumu"}</span>
            <button className="btn btn-secondary" type="button" onClick={switchToUserPanel}><BookOpen size={18} /> Kullanıcı Paneli</button>
            <button className="btn btn-secondary" type="button" onClick={logout}><LogOut size={18} /> Çıkış Yap</button>
          </div>
        </header>
        {message && (
          <div className="notice" role="status" aria-live="polite">
            <Sparkles size={16} aria-hidden="true" />
            <span>{message}</span>
          </div>
        )}
        {activeRoute === "dashboard" && <DashboardPage {...pageProps} />}
        {activeRoute === "inputs" && <InputsPage {...pageProps} />}
        {activeRoute === "catalog" && <CatalogPage {...pageProps} />}
        {activeRoute === "pdf" && <PdfPage {...pageProps} />}
        {activeRoute === "calendar" && <CalendarPage {...pageProps} />}
        {activeRoute === "notifications" && <NotificationsPage {...pageProps} />}
        {activeRoute === "audit" && <AuditPage {...pageProps} />}
        {activeRoute === "users" && <UsersPage {...pageProps} />}
      </section>
    </main>
  );
}

function DashboardPage(props: any) {
  const tiles = [
    { href: "#/catalog", icon: <Building2 size={20} />, title: "Katalog", body: "Üniversiteleri oluşturup arşivleyin, fakülte ve bölümleri bağlayın." },
    { href: "#/inputs", icon: <Pencil size={20} />, title: "Girişler", body: "Üniversite, bölüm, e-posta alan adı ve manuel takvim satırları girin." },
    { href: "#/pdf", icon: <FileText size={20} />, title: "PDF İşlemleri", body: "Kaynak oluşturun, çıkarımı işleyin ve inceleme adaylarını onaylayın." },
    { href: "#/calendar", icon: <CalendarCheck size={20} />, title: "Yayınlama", body: "Onaylanan etkinlikleri öğrenciye açık takvim sürümlerine dönüştürün." },
    { href: "#/users", icon: <Users size={20} />, title: "Kullanıcılar", body: "Kullanıcı arayın, rolleri düzenleyin, hesapları kilitleyin veya kayıtları kaldırın." }
  ];

  return (
    <section className="dashboardGrid">
      {tiles.map((tile) => (
        <a className="dashboardTile" href={tile.href} key={tile.title}>
          <span className="tileIcon">{tile.icon}</span>
          <strong>{tile.title}</strong>
          <span>{tile.body}</span>
        </a>
      ))}
      <section className="panel wide dashboardPanel">
        <div className="panelHeader">
          <div>
            <h2><Sparkles size={20} /> Geçerli Çalışma Alanı</h2>
            <p className="panelSub">Paylaşılan ID'ler katalog kurulumundan PDF işlemeye ve yayınlamaya geçişi kolaylaştırır.</p>
          </div>
        </div>
        <div className="summaryGrid">
          <span><strong>Üniversite</strong>{props.universityId || "-"}</span>
          <span><strong>Fakülte</strong>{props.facultyId || "-"}</span>
          <span><strong>PDF Kaynağı</strong>{props.pdfSourceId || "-"}</span>
          <span><strong>Takvim</strong>{props.calendarId || "-"}</span>
        </div>
      </section>
    </section>
  );
}

function InputsPage(props: any) {
  return (
    <section className="pageStack">
      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <h2><Building2 size={20} /> Üniversiteler, Bölümler ve Alan Adları</h2>
            <p className="panelSub">Katalog kayıtları oluşturun ve kurum e-posta alan adlarını üniversitelerle ilişkilendirin.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={props.loadUniversities} disabled={!props.hasToken || props.universities.loading}><RefreshCcw size={18} /> Yenile</button>
        </div>
        <form className="gridForm sourceForm" onSubmit={props.createUniversity}>
          <input name="name" placeholder="Üniversite" required aria-label="Üniversite adı" />
          <input name="city" placeholder="Şehir" required aria-label="Üniversite şehri" />
          <select name="type" defaultValue="state" aria-label="Üniversite türü">
            <option value="state">{universityTypeLabels.state}</option>
            <option value="foundation">{universityTypeLabels.foundation}</option>
            <option value="private">{universityTypeLabels.private}</option>
          </select>
          <input name="emailDomains" placeholder="E-posta alan adları, virgülle ayrılmış" aria-label="E-posta alan adları" />
          <input name="websiteUrl" type="url" placeholder="Official website URL" aria-label="Official website URL" />
          <input name="announcementUrl" type="url" placeholder="University announcements URL" aria-label="University announcements URL" />
          <input name="academicCalendarUrl" type="url" placeholder="Academic calendar URL" aria-label="Academic calendar URL" />
          <button className="btn btn-primary" disabled={!props.hasToken}><Check size={18} /> Üniversite Ekle</button>
        </form>
        <div className="table">
          {(props.universities.data ?? []).map((university: UniversityRecord) => (
            <div className="row domain" key={university.id}>
              <span>{university.name}</span>
              <span>{university.city}</span>
              <span>{(university.emailDomains ?? []).join(", ") || "Alan adı yok"}</span>
              <button className="btn btn-secondary" type="button" onClick={() => { props.setUniversityId(university.id); void props.loadFaculties(university.id); }}><BookOpen size={16} /> Seç</button>
            </div>
          ))}
        </div>
        <form className="toolbar four" onSubmit={props.addUniversityEmailDomain}>
          <input name="universityId" value={props.universityId} onChange={(event) => props.setUniversityId(event.target.value)} placeholder="Üniversite ID" required aria-label="E-posta alan adı için üniversite ID" />
          <input name="domain" placeholder="university.edu.tr" required aria-label="E-posta alan adı" />
          <button className="btn btn-primary" disabled={!props.hasToken}><Check size={18} /> Alan Adını İlişkilendir</button>
        </form>
        <form className="gridForm sourceForm" onSubmit={props.createFaculty}>
          <input name="universityId" value={props.universityId} onChange={(event) => props.setUniversityId(event.target.value)} placeholder="Üniversite ID" required />
          <input name="name" placeholder="Fakülte" required />
          <input name="websiteUrl" type="url" placeholder="Faculty website URL" aria-label="Faculty website URL" />
          <input name="announcementUrl" type="url" placeholder="Announcement URL" aria-label="Faculty announcement URL" />
          <button className="btn btn-primary" disabled={!props.hasToken}><Check size={18} /> Fakülte Ekle</button>
        </form>
        <div className="chips">{(props.faculties.data ?? []).map((faculty: FacultyRecord) => <button className="btn btn-chip" type="button" key={faculty.id} onClick={() => props.setFacultyId(faculty.id)}>{faculty.name}</button>)}</div>
        <form className="gridForm sourceForm" onSubmit={props.createDepartment}>
          <input name="universityId" value={props.universityId} onChange={(event) => props.setUniversityId(event.target.value)} placeholder="Üniversite ID" required />
          <input name="facultyId" value={props.facultyId} onChange={(event) => props.setFacultyId(event.target.value)} placeholder="Fakülte ID" required />
          <input name="name" placeholder="Bölüm" required />
          <select name="educationLevel" defaultValue="bachelor">
            <option value="associate">{educationLevelLabels.associate}</option>
            <option value="bachelor">{educationLevelLabels.bachelor}</option>
            <option value="master">{educationLevelLabels.master}</option>
            <option value="doctorate">{educationLevelLabels.doctorate}</option>
          </select>
          <input name="websiteUrl" type="url" placeholder="Department website URL" aria-label="Department website URL" />
          <input name="announcementUrl" type="url" placeholder="Announcement URL" aria-label="Department announcement URL" />
          <input name="courseScheduleUrl" type="url" placeholder="Course schedule URL" aria-label="Department course schedule URL" />
          <input name="examScheduleUrl" type="url" placeholder="Exam schedule URL" aria-label="Department exam schedule URL" />
          <button className="btn btn-primary" disabled={!props.hasToken}><Check size={18} /> Bölüm Ekle</button>
        </form>
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <h2><Sparkles size={20} /> Fakülte ve Bölüm İncelemesi</h2>
            <p className="panelSub">Öğrencilerin gönderdiği eksik fakülte ve bölüm önerileri katalog doğrulaması bekliyor.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={props.loadAcademicUnitSuggestions} disabled={!props.hasToken || props.academicUnitSuggestions.loading}><RefreshCcw size={18} /> Yenile</button>
        </div>
        {props.academicUnitSuggestions.loading && <PanelState kind="loading" text="Akademik birim önerileri yükleniyor..." />}
        {props.academicUnitSuggestions.error && <PanelState kind="error" text={props.academicUnitSuggestions.error} />}
        {!props.academicUnitSuggestions.loading && !props.academicUnitSuggestions.error && (props.academicUnitSuggestions.data?.length ?? 0) === 0 && <PanelState kind="empty" text="İnceleme bekleyen fakülte veya bölüm önerisi yok." />}
        <div className="table">
          {(props.academicUnitSuggestions.data ?? []).map((item: AcademicUnitSuggestionRecord) => (
            <div className="row domain" key={item.id}>
              <span>{item.facultyName}{item.departmentName ? ` / ${item.departmentName}` : ""}</span>
              <span>{educationLevelLabels[item.educationLevel] ?? item.educationLevel}</span>
              <span>{item.userEmail}</span>
              <span>{item.universityId}</span>
              <button className="btn btn-primary" type="button" onClick={() => props.approveAcademicUnitSuggestion(item.id)}><Check size={16} /> Onayla</button>
              <button className="btn btn-danger" type="button" onClick={() => props.rejectAcademicUnitSuggestion(item.id)}><X size={16} /> Reddet</button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <h2><Users size={20} /> İlişkilendirilmemiş Kayıt Alan Adları</h2>
            <p className="panelSub">Kayıt olan `.edu` kullanıcılarından gelen ve henüz bir üniversiteyle eşleşmeyen alan adları.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={props.loadDomainSuggestions} disabled={!props.hasToken || props.domainSuggestions.loading}><RefreshCcw size={18} /> Yenile</button>
        </div>
        {props.domainSuggestions.loading && <PanelState kind="loading" text="Alan adı önerileri yükleniyor..." />}
        {props.domainSuggestions.error && <PanelState kind="error" text={props.domainSuggestions.error} />}
        {!props.domainSuggestions.loading && !props.domainSuggestions.error && (props.domainSuggestions.data?.length ?? 0) === 0 && <PanelState kind="empty" text="İlişkilendirilmemiş edu alan adı bulunamadı." />}
        <div className="table">
          {(props.domainSuggestions.data ?? []).map((item: DomainSuggestionRecord) => (
            <div className="row domain" key={item.domain}>
              <span>{item.domain}</span>
              <span>{item.userCount} kullanıcı</span>
              <span>{item.sampleEmails.join(", ")}</span>
              <button className="btn btn-secondary" type="button" onClick={() => navigator.clipboard?.writeText(item.domain)}><Pencil size={16} /> Kopyala</button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <h2><CalendarCheck size={20} /> Manuel Akademik Takvim</h2>
            <p className="panelSub">Elle girilen satırlardan taslak oluşturun. İncelemeden sonra Yayınla sayfasından yayınlayın.</p>
          </div>
        </div>
        <form className="manualCalendar" onSubmit={props.createManualCalendar}>
          <div className="toolbar four">
            <input name="universityId" value={props.universityId} onChange={(event) => props.setUniversityId(event.target.value)} placeholder="Üniversite ID" required />
            <input name="academicYear" placeholder="2026-2027" required />
            <input name="title" placeholder="Takvim başlığı" required />
            <button className="btn btn-secondary" type="button" onClick={props.addManualEventRow}><Pencil size={18} /> Satır Ekle</button>
          </div>
          <div className="table">
            {props.manualEvents.map((row: any, index: number) => (
              <div className="row manualEvent" key={index}>
                <input value={row.title} onChange={(event) => props.updateManualEvent(index, "title", event.target.value)} placeholder="Etkinlik başlığı" required />
                <select value={row.category} onChange={(event) => props.updateManualEvent(index, "category", event.target.value)}>
                  <option value="course_registration">{eventCategoryLabels.course_registration}</option>
                  <option value="course_add_drop">{eventCategoryLabels.course_add_drop}</option>
                  <option value="course_schedule">{eventCategoryLabels.course_schedule}</option>
                  <option value="midterm_exam">{eventCategoryLabels.midterm_exam}</option>
                  <option value="final_exam">{eventCategoryLabels.final_exam}</option>
                  <option value="department_exam_schedule">{eventCategoryLabels.department_exam_schedule}</option>
                  <option value="summer_school_registration">{eventCategoryLabels.summer_school_registration}</option>
                  <option value="summer_school_start">{eventCategoryLabels.summer_school_start}</option>
                  <option value="holiday">{eventCategoryLabels.holiday}</option>
                  <option value="custom_event">{eventCategoryLabels.custom_event}</option>
                </select>
                <select value={row.term} onChange={(event) => props.updateManualEvent(index, "term", event.target.value)}>
                  <option value="fall">{termLabels.fall}</option>
                  <option value="spring">{termLabels.spring}</option>
                  <option value="summer">{termLabels.summer}</option>
                  <option value="full_year">{termLabels.full_year}</option>
                  <option value="unknown">{termLabels.unknown}</option>
                </select>
                <input type="date" value={row.startDate} onChange={(event) => props.updateManualEvent(index, "startDate", event.target.value)} required />
                <input type="date" value={row.endDate} onChange={(event) => props.updateManualEvent(index, "endDate", event.target.value)} />
                <input value={row.facultyId} onChange={(event) => props.updateManualEvent(index, "facultyId", event.target.value)} placeholder="Fakülte ID" />
                <input value={row.departmentId} onChange={(event) => props.updateManualEvent(index, "departmentId", event.target.value)} placeholder="Bölüm ID" />
                <label className="miniCheck"><input type="checkbox" checked={row.offset7} onChange={(event) => props.updateManualEvent(index, "offset7", event.target.checked)} /> 7 gün</label>
                <label className="miniCheck"><input type="checkbox" checked={row.offset1} onChange={(event) => props.updateManualEvent(index, "offset1", event.target.checked)} /> 1 gün</label>
                <button className="btn btn-danger" type="button" onClick={() => props.removeManualEventRow(index)}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" disabled={!props.hasToken}><Save size={18} /> Manuel Taslak Oluştur</button>
        </form>
      </section>
    </section>
  );
}

function CatalogPage(props: any) {
  return (
    <section className="pageStack">
      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <h2><Building2 size={20} /> Üniversiteler</h2>
            <p className="panelSub">Kurumları oluşturun ve akademik hiyerarşiyi düzenli tutun.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={props.loadUniversities} title="Yenile" disabled={!props.hasToken || props.universities.loading}>
            <RefreshCcw size={18} /> Yenile
          </button>
        </div>
        <form className="gridForm sourceForm" onSubmit={props.createUniversity}>
          <input name="name" placeholder="Üniversite" required aria-label="Üniversite adı" />
          <input name="city" placeholder="Şehir" required aria-label="Üniversite şehri" />
          <select name="type" defaultValue="state" aria-label="Üniversite türü">
            <option value="state">{universityTypeLabels.state}</option>
            <option value="foundation">{universityTypeLabels.foundation}</option>
            <option value="private">{universityTypeLabels.private}</option>
          </select>
          <input name="websiteUrl" type="url" placeholder="Official website URL" aria-label="Official website URL" />
          <input name="announcementUrl" type="url" placeholder="University announcements URL" aria-label="University announcements URL" />
          <input name="academicCalendarUrl" type="url" placeholder="Academic calendar URL" aria-label="Academic calendar URL" />
          <button className="btn btn-primary" disabled={!props.hasToken || props.universities.loading}><Check size={18} /> Oluştur</button>
        </form>
        {props.universities.loading && <PanelState kind="loading" text="Üniversiteler yükleniyor..." />}
        {props.universities.error && <PanelState kind="error" text={props.universities.error} />}
        {!props.universities.loading && !props.universities.error && (props.universities.data?.length ?? 0) === 0 && <PanelState kind="empty" text="Henüz üniversite kaydı yok." />}
        <div className="table">
          {(props.universities.data ?? []).map((university: UniversityRecord) => (
            <div className="row catalog" key={university.id}>
              <span>{university.name}</span>
              <span>{university.city}</span>
              <span className="statusBadge">{statusLabels[university.status as AdminUserRecord["status"]] ?? university.status}</span>
              <button className="btn btn-secondary" type="button" onClick={() => { props.setUniversityId(university.id); void props.loadFaculties(university.id); }} disabled={!props.hasToken || props.faculties.loading}>
                <BookOpen size={16} /> Fakülteler
              </button>
              <button className="btn btn-danger" type="button" onClick={() => void props.archiveUniversity(university.id)} disabled={!props.hasToken}>
                <Archive size={16} /> Arşivle
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <h2><BookOpen size={20} /> Fakülteler ve Bölümler</h2>
            <p className="panelSub">Hiyerarşiyi genişletmek için seçili üniversite ve fakülte ID'lerini kullanın.</p>
          </div>
        </div>
        <form className="gridForm sourceForm" onSubmit={props.createFaculty}>
          <input name="universityId" value={props.universityId} onChange={(event) => props.setUniversityId(event.target.value)} placeholder="Üniversite ID" required aria-label="Fakülte için üniversite ID" />
          <input name="name" placeholder="Fakülte" required aria-label="Fakülte adı" />
          <input name="websiteUrl" type="url" placeholder="Faculty website URL" aria-label="Faculty website URL" />
          <input name="announcementUrl" type="url" placeholder="Announcement URL" aria-label="Faculty announcement URL" />
          <button className="btn btn-primary" disabled={!props.hasToken}><Check size={18} /> Fakülte Ekle</button>
        </form>
        {props.faculties.loading && <PanelState kind="loading" text="Fakülteler yükleniyor..." />}
        {props.faculties.error && <PanelState kind="error" text={props.faculties.error} />}
        <div className="chips">{(props.faculties.data ?? []).map((faculty: FacultyRecord) => <button className="btn btn-chip" type="button" key={faculty.id} onClick={() => props.setFacultyId(faculty.id)}>{faculty.name}</button>)}</div>
        <form className="gridForm sourceForm" onSubmit={props.createDepartment}>
          <input name="universityId" value={props.universityId} onChange={(event) => props.setUniversityId(event.target.value)} placeholder="Üniversite ID" required aria-label="Bölüm için üniversite ID" />
          <input name="facultyId" value={props.facultyId} onChange={(event) => props.setFacultyId(event.target.value)} placeholder="Fakülte ID" required aria-label="Bölüm için fakülte ID" />
          <input name="name" placeholder="Bölüm" required aria-label="Bölüm adı" />
          <select name="educationLevel" defaultValue="bachelor" aria-label="Eğitim düzeyi">
            <option value="associate">{educationLevelLabels.associate}</option>
            <option value="bachelor">{educationLevelLabels.bachelor}</option>
            <option value="master">{educationLevelLabels.master}</option>
            <option value="doctorate">{educationLevelLabels.doctorate}</option>
          </select>
          <input name="websiteUrl" type="url" placeholder="Department website URL" aria-label="Department website URL" />
          <input name="announcementUrl" type="url" placeholder="Announcement URL" aria-label="Department announcement URL" />
          <input name="courseScheduleUrl" type="url" placeholder="Course schedule URL" aria-label="Department course schedule URL" />
          <input name="examScheduleUrl" type="url" placeholder="Exam schedule URL" aria-label="Department exam schedule URL" />
          <button className="btn btn-primary" disabled={!props.hasToken}><Check size={18} /> Bölüm Ekle</button>
        </form>
      </section>
    </section>
  );
}

function PdfPage(props: any) {
  return (
    <section className="pageStack">
      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <h2><FileText size={20} /> Kaynak Alımı</h2>
            <p className="panelSub">Kaynak kayıtları oluşturun ve metin çıkarımını işleyin.</p>
          </div>
        </div>
        <form className="gridForm" onSubmit={props.createPdfSource}>
          <input name="universityId" value={props.universityId} onChange={(event) => props.setUniversityId(event.target.value)} placeholder="Üniversite ID" required aria-label="PDF kaynağı için üniversite ID" />
          <input name="academicYear" placeholder="2026-2027" required aria-label="Akademik yıl" />
          <input name="fileName" placeholder="calendar.pdf" required aria-label="Dosya adı" />
          <input name="fileSize" type="number" min="1" defaultValue="4096" required aria-label="Dosya boyutu" />
          <input name="pageCount" type="number" min="1" max="100" defaultValue="2" required aria-label="Sayfa sayısı" />
          <textarea name="rawText" placeholder="PDF'den çıkarılan metin" required aria-label="Ham çıkarılmış metin" />
          <button className="btn btn-primary" disabled={!props.hasToken}><Check size={18} /> Kaynak Oluştur</button>
        </form>
        <div className="toolbar three">
          <input value={props.pdfSourceId} onChange={(event) => props.setPdfSourceId(event.target.value)} placeholder="PDF kaynak ID" aria-label="PDF kaynak ID" />
          <button className="btn btn-primary" type="button" onClick={props.processPdf} disabled={!props.hasToken || !props.pdfSourceId}><Play size={18} /> İşle</button>
          <button className="btn btn-secondary" type="button" onClick={props.loadExtractedEvents} disabled={!props.hasToken || props.events.loading}><RefreshCcw size={18} /> Kuyruğu Yükle</button>
        </div>
      </section>
      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <h2><Check size={20} /> İnceleme Kuyruğu</h2>
            <p className="panelSub">Normalleştirilmiş etkinlik adaylarını onaylayın veya reddedin.</p>
          </div>
        </div>
        {props.events.loading && <PanelState kind="loading" text="Çıkarılan etkinlikler yükleniyor..." />}
        {props.events.error && <PanelState kind="error" text={props.events.error} />}
        {!props.events.loading && !props.events.error && (props.events.data?.length ?? 0) === 0 && <PanelState kind="empty" text="Henüz çıkarılmış etkinlik yok." />}
        <div className="table">
          {(props.events.data ?? []).map((item: ExtractedEventRecord) => (
            <div className="row review" key={item.id}>
              <span>{item.normalizedTitle}</span>
              <span>{eventCategoryLabels[item.normalizedCategory] ?? item.normalizedCategory}</span>
              <span>{new Date(item.startDate).toLocaleDateString("tr-TR")}</span>
              <span className="statusBadge">{reviewStatusLabels[item.status] ?? item.status}</span>
              <button className="btn btn-primary" type="button" onClick={() => void props.approveEvent(item.id)} disabled={!props.hasToken}><Check size={16} /> Onayla</button>
              <button className="btn btn-danger" type="button" onClick={() => void props.rejectEvent(item.id)} disabled={!props.hasToken}><X size={16} /> Reddet</button>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function CalendarPage(props: any) {
  return (
    <section className="panel wide">
      <div className="panelHeader">
        <div>
          <h2><CalendarCheck size={20} /> Takvim Yayınlama</h2>
          <p className="panelSub">Onaylanan etkinlikleri öğrenci zaman çizelgesine taşıyın.</p>
        </div>
      </div>
      <form className="gridForm compact" onSubmit={props.createCalendarDraft}>
        <input name="universityId" value={props.universityId} onChange={(event) => props.setUniversityId(event.target.value)} placeholder="Üniversite ID" required aria-label="Taslak için üniversite ID" />
        <input name="sourcePdfId" value={props.pdfSourceId} onChange={(event) => props.setPdfSourceId(event.target.value)} placeholder="PDF kaynak ID" required aria-label="Kaynak PDF ID" />
        <input name="academicYear" placeholder="2026-2027" required aria-label="Taslak akademik yılı" />
        <input name="title" placeholder="Takvim başlığı" required aria-label="Takvim başlığı" />
        <button className="btn btn-primary" disabled={!props.hasToken}><Check size={18} /> Taslak Oluştur</button>
      </form>
      <div className="toolbar three">
        <input value={props.calendarId} onChange={(event) => props.setCalendarId(event.target.value)} placeholder="Takvim ID" aria-label="Takvim ID" />
        <button className="btn btn-primary" type="button" onClick={props.publishCalendar} disabled={!props.hasToken || !props.calendarId}><CalendarCheck size={18} /> Yayınla</button>
        <button className="btn btn-danger" type="button" onClick={props.rollbackCalendar} disabled={!props.hasToken || !props.calendarId}><RotateCcw size={18} /> Geri Al</button>
      </div>
    </section>
  );
}

function NotificationsPage(props: any) {
  return (
    <section className="panel wide">
      <div className="panelHeader">
        <div>
          <h2><BellRing size={20} /> Bildirim Operasyonları</h2>
          <p className="panelSub">Zamanı gelen kuyrukları işleyin, başarısız işleri yeniden deneyin ve teslimat sonuçlarını inceleyin.</p>
        </div>
      </div>
      <div className="toolbar four">
        <button className="btn btn-primary" type="button" onClick={props.processDue} disabled={!props.hasToken || props.workerState.loading}><Play size={18} /> Zamanı Gelenleri İşle</button>
        <button className="btn btn-secondary" type="button" onClick={props.loadFailed} disabled={!props.hasToken || props.failedState.loading}><RefreshCcw size={18} /> Başarısız İşler</button>
        <input value={props.jobId} onChange={(event) => props.setJobId(event.target.value)} placeholder="İş ID" aria-label="Bildirim işi ID" />
        <button className="btn btn-secondary" type="button" onClick={() => void props.loadDeliveries()} disabled={!props.hasToken || !props.jobId || props.deliveryState.loading}><History size={18} /> Teslimatlar</button>
      </div>
      {props.workerState.loading && <PanelState kind="loading" text="Zamanı gelen işler işleniyor..." />}
      {props.workerState.data && (
        <div className="summaryGrid">
          <span><strong>İşlenen</strong>{props.workerState.data.processedJobs}</span>
          <span><strong>Gönderilen</strong>{props.workerState.data.sent}</span>
          <span><strong>Başarısız</strong>{props.workerState.data.failed}</span>
          <span><strong>Ertelenen</strong>{props.workerState.data.deferred ?? 0}</span>
          <span><strong>Atlanan</strong>{props.workerState.data.skipped ?? 0}</span>
        </div>
      )}
      {props.workerState.error && <PanelState kind="error" text={props.workerState.error} />}
      {props.failedState.loading && <PanelState kind="loading" text="Başarısız işler yükleniyor..." />}
      {props.failedState.error && <PanelState kind="error" text={props.failedState.error} />}
      {!props.failedState.loading && !props.failedState.error && (props.failedState.data?.length ?? 0) === 0 && <PanelState kind="empty" text="Başarısız iş bulunamadı." />}
      <div className="table">
        {(props.failedState.data ?? []).map((job: NotificationJobRecord) => (
          <div className="row failed" key={job.id}>
            <span>{job.title}</span>
            <span className="statusBadge">{jobStatusLabels[job.status] ?? job.status}</span>
            <span>{new Date(job.scheduledAt).toLocaleString("tr-TR")}</span>
            <button className="btn btn-secondary" type="button" onClick={() => void props.retryJob(job.id)} disabled={!props.hasToken}><RotateCcw size={16} /> Tekrar Dene</button>
            <button className="btn btn-secondary" type="button" onClick={() => { props.setJobId(job.id); void props.loadDeliveries(job.id); }} disabled={!props.hasToken}><History size={16} /> Teslimatlar</button>
          </div>
        ))}
      </div>
      {props.deliveryState.loading && <PanelState kind="loading" text="Teslimat kayıtları yükleniyor..." />}
      {props.deliveryState.error && <PanelState kind="error" text={props.deliveryState.error} />}
      {!props.deliveryState.loading && !props.deliveryState.error && (props.deliveryState.data?.length ?? 0) === 0 && <PanelState kind="empty" text="Bu iş için teslimat kaydı yok." />}
      <div className="table">
        {(props.deliveryState.data ?? []).map((delivery: NotificationDeliveryRecord) => (
          <div className="row delivery" key={delivery.id}>
            <span className="statusBadge">{jobStatusLabels[delivery.status] ?? delivery.status}</span>
            <span>{delivery.userId}</span>
            <span>{delivery.failureReason ?? delivery.providerMessageId ?? "-"}</span>
            <span>{new Date(delivery.createdAt).toLocaleString("tr-TR")}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function AuditPage(props: any) {
  return (
    <section className="panel wide">
      <div className="panelHeader">
        <div>
          <h2><History size={20} /> Denetim Zaman Çizelgesi</h2>
          <p className="panelSub">Değiştirilemeyen operasyon geçmişini inceleyin ve JSONL olarak dışa aktarın.</p>
        </div>
      </div>
      <div className="toolbar four">
        <input value={props.entityType} onChange={(event) => props.setEntityType(event.target.value)} placeholder="entityType" aria-label="Denetim varlık türü" />
        <input value={props.entityId} onChange={(event) => props.setEntityId(event.target.value)} placeholder="entityId" aria-label="Denetim varlık ID" />
        <button className="btn btn-secondary" type="button" onClick={props.loadAudit} disabled={!props.hasToken || props.auditState.loading}><RefreshCcw size={18} /> Denetimi Yükle</button>
        <button className="btn btn-secondary" type="button" onClick={props.exportAudit} disabled={!props.hasToken || !props.entityId}><Download size={18} /> JSONL Dışa Aktar</button>
      </div>
      {props.auditState.loading && <PanelState kind="loading" text="Denetim kayıtları yükleniyor..." />}
      {props.auditState.error && <PanelState kind="error" text={props.auditState.error} />}
      {!props.auditState.loading && !props.auditState.error && (props.auditState.data?.length ?? 0) === 0 && <PanelState kind="empty" text="Seçilen varlık için denetim olayı yok." />}
      <div className="table">{(props.auditState.data ?? []).map((log: AuditLogRecord) => <div className="row audit" key={log.id}><span>{auditActionLabels[log.action] ?? log.action}</span><span>{log.actorId}</span><span>{new Date(log.createdAt).toLocaleString("tr-TR")}</span></div>)}</div>
    </section>
  );
}

function UsersPage(props: any) {
  return (
    <section className="panel wide">
      <div className="panelHeader">
        <div>
          <h2><Users size={20} /> Kullanıcı Yönetimi</h2>
          <p className="panelSub">Kayıtlı kullanıcıları görüntüleyin, erişimleri güncelleyin ve hesapları aktif dizinden kaldırın.</p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={props.loadUsers} disabled={!props.hasToken || props.usersState.loading}>
          <RefreshCcw size={18} /> Yenile
        </button>
      </div>
      <div className="toolbar four">
        <input value={props.userSearch} onChange={(event) => props.setUserSearch(event.target.value)} placeholder="Ad veya e-posta ara" aria-label="Kullanıcı ara" />
        <select value={props.userStatus} onChange={(event) => props.setUserStatus(event.target.value)} aria-label="Kullanıcı durumuna göre filtrele">
          <option value="">Tüm durumlar</option>
          <option value="active">{statusLabels.active}</option>
          <option value="inactive">{statusLabels.inactive}</option>
          <option value="locked">{statusLabels.locked}</option>
        </select>
        <button className="btn btn-secondary" type="button" onClick={props.loadUsers} disabled={!props.hasToken || props.usersState.loading}><RefreshCcw size={18} /> Ara</button>
      </div>
      {props.usersState.loading && <PanelState kind="loading" text="Kullanıcılar yükleniyor..." />}
      {props.usersState.error && <PanelState kind="error" text={props.usersState.error} />}
      {!props.usersState.loading && !props.usersState.error && (props.usersState.data?.length ?? 0) === 0 && <PanelState kind="empty" text="Kullanıcı bulunamadı." />}
      <div className="table">
        {(props.usersState.data ?? []).map((user: AdminUserRecord) => (
          props.editingUserId === user.id ? (
            <form className="row userEdit" key={user.id} onSubmit={(event) => props.updateUser(event, user.id)}>
              <input name="fullName" defaultValue={user.fullName} required aria-label="Ad soyad" />
              <select name="role" defaultValue={user.role} aria-label="Kullanıcı rolü">
                <option value="student">{roleLabels.student}</option>
                <option value="content_editor">{roleLabels.content_editor}</option>
                <option value="university_admin">{roleLabels.university_admin}</option>
                <option value="super_admin">{roleLabels.super_admin}</option>
              </select>
              <select name="status" defaultValue={user.status} aria-label="Kullanıcı durumu">
                <option value="active">{statusLabels.active}</option>
                <option value="inactive">{statusLabels.inactive}</option>
                <option value="locked">{statusLabels.locked}</option>
              </select>
              <input name="universityId" defaultValue={user.universityId ?? ""} placeholder="Üniversite ID" aria-label="Kullanıcı üniversite ID" />
              <input name="facultyId" defaultValue={user.facultyId ?? ""} placeholder="Fakülte ID" aria-label="Kullanıcı fakülte ID" />
              <input name="departmentId" defaultValue={user.departmentId ?? ""} placeholder="Bölüm ID" aria-label="Kullanıcı bölüm ID" />
              <input name="classLevel" type="number" min="1" max="6" defaultValue={user.classLevel ?? ""} placeholder="1-6" aria-label="Sınıf seviyesi" />
              <button className="btn btn-primary" disabled={!props.hasToken}><Save size={16} /> Kaydet</button>
              <button className="btn btn-secondary" type="button" onClick={() => props.setEditingUserId("")}><X size={16} /> İptal</button>
            </form>
          ) : (
            <div className="row users" key={user.id}>
              <span>{user.fullName}</span>
              <span>{user.email}</span>
              <span className="statusBadge">{roleLabels[user.role]}</span>
              <span className="statusBadge">{statusLabels[user.status]}</span>
              <span>{user.emailVerifiedAt ? "Doğrulandı" : "Doğrulanmadı"}</span>
              <button className="btn btn-secondary" type="button" onClick={() => props.setEditingUserId(user.id)} disabled={!props.hasToken}><Pencil size={16} /> Düzenle</button>
              <button className="btn btn-danger" type="button" onClick={() => void props.deleteUser(user.id)} disabled={!props.hasToken}><Trash2 size={16} /> Sil</button>
            </div>
          )
        ))}
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
