import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Check,
  GraduationCap,
  LoaderCircle,
  LogIn,
  RefreshCcw,
  Search,
  Settings,
  Smartphone,
  Sparkles
} from "lucide-react";
import "./styles.css";

type Session = { accessToken: string; refreshToken: string; user: { id: string; email: string; role: string } };
type RegisterResponse = { status: "verification_required"; email: string; verificationExpiresAt: string; previewVerificationToken?: string };
type ApiState<T> = { loading: boolean; data?: T; error?: string };

interface UniversityRecord { id: string; name: string; city: string; type: string; }
interface FacultyRecord { id: string; name: string; }
interface DepartmentRecord { id: string; name: string; }
interface CalendarRecord { id: string; title: string; academicYear: string; status: string; }
interface EventRecord { id: string; title: string; category: string; startDate: string; endDate?: string; }
interface CalendarPayload { calendar: CalendarRecord; events: EventRecord[]; }
interface PreferencesPayload { enabled: boolean; categories: Record<string, boolean>; reminderOffsets: number[]; quietHours?: { enabled: boolean; start: string; end: string; timezone: string }; }

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const categoryLabels: Record<string, string> = { registration: "Registration", add_drop: "Add Drop", midterm_exam: "Midterm", final_exam: "Final", holiday: "Holiday", graduation: "Graduation", other: "Other" };

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

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [selectedUniversityId, setSelectedUniversityId] = useState("");
  const [registerUniversityId, setRegisterUniversityId] = useState("");
  const [registerFacultyId, setRegisterFacultyId] = useState("");
  const [registerDepartmentId, setRegisterDepartmentId] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [universities, setUniversities] = useState<ApiState<UniversityRecord[]>>({ loading: false });
  const [faculties, setFaculties] = useState<ApiState<FacultyRecord[]>>({ loading: false });
  const [departments, setDepartments] = useState<ApiState<DepartmentRecord[]>>({ loading: false });
  const [calendar, setCalendar] = useState<ApiState<CalendarPayload>>({ loading: false });
  const [upcoming, setUpcoming] = useState<ApiState<EventRecord[]>>({ loading: false });
  const [preferences, setPreferences] = useState<ApiState<PreferencesPayload>>({ loading: false });
  const [message, setMessage] = useState("");
  const clientDeviceId = useMemo(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `web-${crypto.randomUUID()}`;
    return `web-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  }, []);
  const isAuthenticated = Boolean(session);
  const headers = useMemo(() => (session ? { Authorization: `Bearer ${session.accessToken}` } : {}), [session]);

  useEffect(() => {
    if (!message) return;
    const handle = setTimeout(() => setMessage(""), 3400);
    return () => clearTimeout(handle);
  }, [message]);

  useEffect(() => {
    void loadUniversities();
  }, []);

  function ensureSession() {
    if (!session) {
      setMessage("Login is required for this action.");
      return false;
    }

    return true;
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

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    const values = formData(event);

    if (authMode === "login") {
      const nextSession = await request<Session>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: values.email, password: values.password, deviceId: clientDeviceId })
      });
      setSession(nextSession);
      setMessage("Session ready");
      await loadUniversities();
      return;
    }

    if (!registerUniversityId || !registerFacultyId || !registerDepartmentId) {
      setMessage("University, faculty and department are required for registration.");
      return;
    }

    const registerResult = await request<RegisterResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: values.email,
        password: values.password,
        fullName: values.fullName,
        deviceId: clientDeviceId,
        universityId: registerUniversityId,
        facultyId: registerFacultyId,
        departmentId: registerDepartmentId
      })
    });

    setMessage("Verification email sent. Confirm your email before login.");
    if (registerResult.previewVerificationToken) setVerificationToken(registerResult.previewVerificationToken);
  }

  async function submitVerifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!verificationToken.trim()) {
      setMessage("Verification token is required.");
      return;
    }

    const nextSession = await request<Session>("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token: verificationToken.trim(), deviceId: clientDeviceId })
    });

    setSession(nextSession);
    setMessage("Email verified. Session ready.");
    await loadUniversities();
  }

  async function loadUniversities() {
    await runAction(setUniversities, () => request<UniversityRecord[]>("/universities?limit=100&offset=0"));
  }

  async function loadFacultiesForRegistration(universityId: string) {
    if (!universityId) {
      setFaculties({ loading: false, data: [] });
      return;
    }
    await runAction(setFaculties, () => request<FacultyRecord[]>(`/universities/${universityId}/faculties`));
  }

  async function loadDepartmentsForRegistration(facultyId: string) {
    if (!facultyId) {
      setDepartments({ loading: false, data: [] });
      return;
    }
    await runAction(setDepartments, () => request<DepartmentRecord[]>(`/faculties/${facultyId}/departments`));
  }

  async function selectUniversity(id: string) {
    setSelectedUniversityId(id);
    if (session) {
      await request("/me/university", { method: "PATCH", body: JSON.stringify({ universityId: id }) });
      await runAction(setCalendar, () => request<CalendarPayload>("/calendar/my"), "University selected");
      await loadUpcoming();
      return;
    }
    await runAction(setCalendar, () => request<CalendarPayload>(`/calendar/university/${id}`), "University selected");
  }

  async function loadUpcoming() {
    if (!ensureSession()) return;
    await runAction(setUpcoming, () => request<EventRecord[]>("/calendar/upcoming?limit=10"));
  }

  async function loadPreferences() {
    if (!ensureSession()) return;
    await runAction(setPreferences, () => request<PreferencesPayload>("/notification-preferences"));
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    if (!ensureSession()) return;
    const values = formData(event);
    const body = {
      enabled: values.enabled === "on",
      categories: {
        registration: values.registration === "on",
        final_exam: values.final_exam === "on",
        midterm_exam: values.midterm_exam === "on",
        holiday: values.holiday === "on"
      },
      reminderOffsets: [1, 3, 7],
      quietHours: { enabled: values.quietHours === "on", start: values.start || "22:00", end: values.end || "07:00", timezone: "Europe/Istanbul" }
    };
    await runAction(setPreferences, () => request<PreferencesPayload>("/notification-preferences", { method: "PATCH", body: JSON.stringify(body) }), "Preferences saved");
  }

  async function registerDevice() {
    if (!ensureSession()) return;
    await request("/devices/register", { method: "POST", body: JSON.stringify({ platform: "web", token: `web-demo-${Date.now()}` }) });
    setMessage("Device registered");
  }

  return (
    <main className="appShell">
      <div className="ambientBackdrop" aria-hidden="true" />
      <section className="phoneSurface">
        <header className="appHeader">
          <div>
            <h1>Academic Pulse</h1>
            <p>{session ? session.user.email : "Student workspace"}</p>
          </div>
          <GraduationCap size={28} />
        </header>

        <section className="panel authPanel">
          <div className="sectionIntro">
            <h2>Authentication</h2>
            <p>Sign in to sync preferences, device token and personalized upcoming events.</p>
          </div>
          <div className="tabs">
            <button className={authMode === "login" ? "tabButton active" : "tabButton"} type="button" onClick={() => setAuthMode("login")}><LogIn size={16} /> Login</button>
            <button className={authMode === "register" ? "tabButton active" : "tabButton"} type="button" onClick={() => setAuthMode("register")}><Check size={16} /> Register</button>
          </div>
          <form className="stack" onSubmit={submitAuth}>
            {authMode === "register" && <input name="fullName" placeholder="Full name" required aria-label="Full name" />}
            <input name="email" type="email" placeholder="Email" required aria-label="Email" />
            <input name="password" type="password" placeholder="Password" required aria-label="Password" />

            {authMode === "register" && (
              <>
                <select
                  name="universityId"
                  value={registerUniversityId}
                  aria-label="University for registration"
                  onChange={(event) => {
                    const nextUniversityId = event.target.value;
                    setRegisterUniversityId(nextUniversityId);
                    setRegisterFacultyId("");
                    setRegisterDepartmentId("");
                    setDepartments({ loading: false, data: [] });
                    void loadFacultiesForRegistration(nextUniversityId);
                  }}
                  required
                >
                  <option value="">Select university</option>
                  {(universities.data ?? []).map((university) => <option key={university.id} value={university.id}>{university.name}</option>)}
                </select>

                <select
                  name="facultyId"
                  value={registerFacultyId}
                  aria-label="Faculty for registration"
                  onChange={(event) => {
                    const nextFacultyId = event.target.value;
                    setRegisterFacultyId(nextFacultyId);
                    setRegisterDepartmentId("");
                    void loadDepartmentsForRegistration(nextFacultyId);
                  }}
                  required
                  disabled={!registerUniversityId || faculties.loading}
                >
                  <option value="">Select faculty</option>
                  {(faculties.data ?? []).map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}
                </select>

                <select
                  name="departmentId"
                  value={registerDepartmentId}
                  aria-label="Department for registration"
                  onChange={(event) => setRegisterDepartmentId(event.target.value)}
                  required
                  disabled={!registerFacultyId || departments.loading}
                >
                  <option value="">Select department</option>
                  {(departments.data ?? []).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </>
            )}

            <button className="btn btn-primary"><LogIn size={18} /> Continue</button>
          </form>

          {authMode === "register" && (
            <form className="stack" onSubmit={submitVerifyEmail}>
              <input
                name="verificationToken"
                value={verificationToken}
                onChange={(event) => setVerificationToken(event.target.value)}
                placeholder="Verification token"
                aria-label="Verification token"
              />
              <button className="btn btn-secondary" type="submit"><Check size={18} /> Verify Email</button>
            </form>
          )}
        </section>

        <section className="panel">
          <div className="sectionTitle">
            <Search size={18} />
            <h2>University</h2>
            <button className="btn btn-secondary iconOnly" type="button" onClick={loadUniversities} title="Refresh" disabled={universities.loading}><RefreshCcw size={16} /></button>
          </div>
          <p className="sectionHint">Select your university to view current published calendar.</p>
          {universities.loading && <PanelState kind="loading" text="Loading universities..." />}
          {universities.error && <PanelState kind="error" text={universities.error} />}
          {!universities.loading && !universities.error && (universities.data?.length ?? 0) === 0 && <PanelState kind="empty" text="No active universities found." />}
          <div className="choiceList">{(universities.data ?? []).map((university) => <button type="button" key={university.id} className={selectedUniversityId === university.id ? "choice selected" : "choice"} onClick={() => void selectUniversity(university.id)}><span>{university.name}</span><small>{university.city}</small></button>)}</div>
        </section>

        <section className="panel">
          <div className="sectionTitle"><CalendarDays size={18} /><h2>Calendar</h2><span className="pill">{selectedUniversityId ? "Linked" : "Not linked"}</span></div>
          {calendar.data?.calendar && <div className="calendarTitle"><strong>{calendar.data.calendar.title}</strong><span>{calendar.data.calendar.academicYear}</span></div>}
          {calendar.loading && <PanelState kind="loading" text="Loading calendar..." />}
          {calendar.error && <PanelState kind="error" text={calendar.error} />}
          {!calendar.loading && !calendar.error && (calendar.data?.events.length ?? 0) === 0 && <PanelState kind="empty" text="No published events for selected university yet." />}
          <div className="eventList">{(calendar.data?.events ?? []).map((event) => <article className="eventItem" key={event.id}><span>{categoryLabels[event.category] ?? event.category}</span><strong>{event.title}</strong><time>{new Date(event.startDate).toLocaleDateString("tr-TR")}</time></article>)}</div>
        </section>

        <section className="panel">
          <div className="sectionTitle"><Bell size={18} /><h2>Upcoming</h2><button className="btn btn-secondary" type="button" onClick={loadUpcoming} title="Refresh" disabled={!isAuthenticated || upcoming.loading}><RefreshCcw size={16} /> Refresh</button></div>
          {!isAuthenticated && <PanelState kind="empty" text="Login to load personalized upcoming events." />}
          {upcoming.loading && <PanelState kind="loading" text="Loading upcoming events..." />}
          {upcoming.error && <PanelState kind="error" text={upcoming.error} />}
          {!upcoming.loading && !upcoming.error && isAuthenticated && (upcoming.data?.length ?? 0) === 0 && <PanelState kind="empty" text="No upcoming events in your timeline." />}
          <div className="eventList compact">{(upcoming.data ?? []).map((event) => <article className="eventItem" key={event.id}><strong>{event.title}</strong><time>{new Date(event.startDate).toLocaleDateString("tr-TR")}</time></article>)}</div>
        </section>

        <section className="panel">
          <div className="sectionTitle"><Settings size={18} /><h2>Notifications</h2><button className="btn btn-secondary" type="button" onClick={loadPreferences} title="Refresh" disabled={!isAuthenticated || preferences.loading}><RefreshCcw size={16} /> Refresh</button></div>
          <p className="sectionHint">Tune reminder categories and quiet hours for your device.</p>
          {!isAuthenticated && <PanelState kind="empty" text="Login to manage notification preferences." />}
          {preferences.loading && <PanelState kind="loading" text="Loading preferences..." />}
          <form className="settingsGrid" onSubmit={savePreferences}>
            <label><input type="checkbox" name="enabled" defaultChecked={preferences.data?.enabled ?? true} /> Enabled</label>
            <label><input type="checkbox" name="registration" defaultChecked={preferences.data?.categories.registration ?? true} /> Registration</label>
            <label><input type="checkbox" name="final_exam" defaultChecked={preferences.data?.categories.final_exam ?? true} /> Final</label>
            <label><input type="checkbox" name="midterm_exam" defaultChecked={preferences.data?.categories.midterm_exam ?? true} /> Midterm</label>
            <label><input type="checkbox" name="holiday" defaultChecked={preferences.data?.categories.holiday ?? true} /> Holiday</label>
            <label><input type="checkbox" name="quietHours" defaultChecked={preferences.data?.quietHours?.enabled ?? true} /> Quiet hours</label>
            <input name="start" defaultValue={preferences.data?.quietHours?.start ?? "22:00"} />
            <input name="end" defaultValue={preferences.data?.quietHours?.end ?? "07:00"} />
            <button className="btn btn-primary" disabled={!isAuthenticated}><Check size={18} /> Save Preferences</button>
            <button className="btn btn-secondary" type="button" onClick={registerDevice} disabled={!isAuthenticated}><Smartphone size={18} /> Register Device</button>
          </form>
          {preferences.error && <PanelState kind="error" text={preferences.error} />}
        </section>
        {message && <div className="toast" role="status" aria-live="polite"><Sparkles size={16} aria-hidden="true" /> {message}</div>}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
