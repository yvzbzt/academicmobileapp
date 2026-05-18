import React, { FormEvent, useEffect, useMemo, useState } from "react";
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
  LoaderCircle,
  Play,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X
} from "lucide-react";
import "./styles.css";

type ApiState<T> = { loading: boolean; data?: T; error?: string };
type JsonRecord = Record<string, unknown>;

interface UniversityRecord { id: string; name: string; city: string; type: string; status: string; }
interface FacultyRecord { id: string; name: string; }
interface ExtractedEventRecord { id: string; pdfSourceId: string; normalizedTitle: string; normalizedCategory: string; startDate: string; endDate?: string; status: string; confidence: number; }
interface AuditLogRecord { id: string; actorId: string; action: string; entityType: string; entityId: string; createdAt: string; }
interface WorkerResult { processedJobs: number; sent: number; failed: number; deferred?: number; skipped?: number; }
interface NotificationJobRecord { id: string; title: string; status: string; scheduledAt: string; }
interface NotificationDeliveryRecord { id: string; jobId: string; userId: string; token: string; status: string; providerMessageId?: string; failureReason?: string; createdAt: string; }

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

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

function App() {
  const [token, setToken] = useState("");
  const [entityType, setEntityType] = useState("academic_calendar");
  const [entityId, setEntityId] = useState("");
  const [jobId, setJobId] = useState("");
  const [pdfSourceId, setPdfSourceId] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [universityId, setUniversityId] = useState("");
  const [facultyId, setFacultyId] = useState("");
  const [message, setMessage] = useState("");
  const [universities, setUniversities] = useState<ApiState<UniversityRecord[]>>({ loading: false });
  const [faculties, setFaculties] = useState<ApiState<FacultyRecord[]>>({ loading: false });
  const [events, setEvents] = useState<ApiState<ExtractedEventRecord[]>>({ loading: false });
  const [auditState, setAuditState] = useState<ApiState<AuditLogRecord[]>>({ loading: false });
  const [workerState, setWorkerState] = useState<ApiState<WorkerResult>>({ loading: false });
  const [failedState, setFailedState] = useState<ApiState<NotificationJobRecord[]>>({ loading: false });
  const [deliveryState, setDeliveryState] = useState<ApiState<NotificationDeliveryRecord[]>>({ loading: false });
  const hasToken = token.trim().length > 0;
  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  useEffect(() => {
    if (!message) return;
    const handle = setTimeout(() => setMessage(""), 3600);
    return () => clearTimeout(handle);
  }, [message]);

  function ensureToken() {
    if (!hasToken) {
      setMessage("Admin JWT token is required for protected operations.");
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

  async function loadUniversities() {
    if (!ensureToken()) return;
    await runAction(setUniversities, () => request<UniversityRecord[]>("/universities?includeInactive=true&limit=100&offset=0"));
  }

  async function createUniversity(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken()) return;
    const values = formData(event);
    await request<UniversityRecord>("/admin/universities", { method: "POST", body: JSON.stringify({ name: values.name, city: values.city, type: values.type }) });
    await loadUniversities();
    setMessage("University created");
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
    await request<FacultyRecord>(`/admin/universities/${values.universityId}/faculties`, { method: "POST", body: JSON.stringify({ name: values.name }) });
    setUniversityId(values.universityId);
    await loadFaculties(values.universityId);
  }

  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken()) return;
    const values = formData(event);
    await request<JsonRecord>(`/admin/universities/${values.universityId}/faculties/${values.facultyId}/departments`, { method: "POST", body: JSON.stringify({ name: values.name, educationLevel: values.educationLevel }) });
    setMessage("Department created");
  }

  async function createPdfSource(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken()) return;
    const values = formData(event);
    const source = await request<{ id: string }>("/admin/pdf-sources", { method: "POST", body: JSON.stringify({ universityId: values.universityId, fileName: values.fileName, mimeType: "application/pdf", magicBytesHex: "255044462d312e37", fileSize: Number(values.fileSize), pageCount: Number(values.pageCount), academicYear: values.academicYear, rawText: values.rawText }) });
    setPdfSourceId(source.id);
    setMessage("PDF source created");
  }

  async function processPdf() {
    if (!ensureToken()) return;
    if (!pdfSourceId) {
      setMessage("PDF source id is required.");
      return;
    }

    const processed = await request<{ id: string }>(`/admin/pdf-sources/${pdfSourceId}/process`, { method: "POST" });
    setMessage(`PDF processed: ${processed.id}`);
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
    await request<JsonRecord>(`/admin/extracted-events/${id}/reject`, { method: "POST", body: JSON.stringify({ adminNote: "Rejected from operations console" }) });
    await loadExtractedEvents();
  }

  async function createCalendarDraft(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken()) return;
    const values = formData(event);
    const draft = await request<{ calendar: { id: string } }>("/admin/calendars", { method: "POST", body: JSON.stringify({ universityId: values.universityId, academicYear: values.academicYear, title: values.title, sourcePdfId: values.sourcePdfId }) });
    setCalendarId(draft.calendar.id);
    setEntityId(draft.calendar.id);
  }

  async function publishCalendar() {
    if (!ensureToken()) return;
    if (!calendarId) {
      setMessage("Calendar id is required.");
      return;
    }

    await request<JsonRecord>(`/admin/calendars/${calendarId}/publish`, { method: "POST" });
    setMessage("Calendar published");
  }

  async function rollbackCalendar() {
    if (!ensureToken()) return;
    if (!calendarId) {
      setMessage("Calendar id is required.");
      return;
    }

    await request<JsonRecord>(`/admin/calendars/${calendarId}/rollback`, { method: "POST" });
    setMessage("Calendar rolled back");
  }

  async function loadAudit() {
    if (!ensureToken()) return;
    if (!entityId) {
      setMessage("Entity id is required.");
      return;
    }

    const query = new URLSearchParams({ entityType, entityId, limit: "50", offset: "0" });
    await runAction(setAuditState, () => request<AuditLogRecord[]>(`/admin/audit-logs?${query}`));
  }

  async function exportAudit() {
    if (!ensureToken()) return;
    if (!entityId) {
      setMessage("Entity id is required.");
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

  return (
    <main className="shell">
      <div className="ambientGlow" aria-hidden="true" />
      <aside className="sidebar">
        <div className="brand"><ShieldCheck size={22} /> Academic Calendar OS</div>
        <p className="sidebarTagline">Operations cockpit for catalog, publish and notification safety.</p>
        <nav>
          <a href="#catalog"><Building2 size={18} /> Catalog</a>
          <a href="#pdf"><FileText size={18} /> PDF Ops</a>
          <a href="#calendar"><CalendarCheck size={18} /> Publish</a>
          <a href="#notifications"><BellRing size={18} /> Notifications</a>
          <a href="#audit"><History size={18} /> Audit</a>
        </nav>
      </aside>
      <section className="content">
        <header className="topbar">
          <div>
            <h1>Admin Operations</h1>
            <p>Catalog, PDF, calendar and notification control plane</p>
          </div>
          <label className="tokenField">
            <span>Admin JWT Token</span>
            <input aria-label="Admin JWT token" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste access token" />
          </label>
        </header>
        {!hasToken && (
          <div className="inlineHint" role="status" aria-live="polite">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>Protected actions are disabled until an admin JWT token is provided.</span>
          </div>
        )}
        {message && (
          <div className="notice" role="status" aria-live="polite">
            <Sparkles size={16} aria-hidden="true" />
            <span>{message}</span>
          </div>
        )}

        <section id="catalog" className="panel wide">
          <div className="panelHeader">
            <div>
              <h2><Building2 size={20} /> Catalog</h2>
              <p className="panelSub">Create institutions and keep academic hierarchy clean.</p>
            </div>
            <button className="btn btn-secondary" type="button" onClick={loadUniversities} title="Refresh" disabled={!hasToken || universities.loading}>
              <RefreshCcw size={18} /> Refresh
            </button>
          </div>
          <form className="toolbar five" onSubmit={createUniversity}>
            <input name="name" placeholder="University" required aria-label="University name" />
            <input name="city" placeholder="City" required aria-label="University city" />
            <select name="type" defaultValue="state" aria-label="University type">
              <option value="state">State</option>
              <option value="foundation">Foundation</option>
              <option value="private">Private</option>
            </select>
            <button className="btn btn-primary" disabled={!hasToken || universities.loading}><Check size={18} /> Create University</button>
          </form>
          {universities.loading && <PanelState kind="loading" text="Loading universities..." />}
          {universities.error && <PanelState kind="error" text={universities.error} />}
          {!universities.loading && !universities.error && (universities.data?.length ?? 0) === 0 && <PanelState kind="empty" text="No university records yet. Create the first one to continue." />}
          <div className="table">
            {(universities.data ?? []).map((university) => (
              <div className="row catalog" key={university.id}>
                <span>{university.name}</span>
                <span>{university.city}</span>
                <span className="statusBadge">{university.status}</span>
                <button className="btn btn-secondary" type="button" onClick={() => { setUniversityId(university.id); void loadFaculties(university.id); }} disabled={!hasToken || faculties.loading}>
                  <BookOpen size={16} /> Faculties
                </button>
                <button className="btn btn-danger" type="button" onClick={() => void archiveUniversity(university.id)} disabled={!hasToken}>
                  <Archive size={16} /> Archive
                </button>
              </div>
            ))}
          </div>
          <form className="toolbar four" onSubmit={createFaculty}>
            <input name="universityId" value={universityId} onChange={(event) => setUniversityId(event.target.value)} placeholder="University ID" required aria-label="University id for faculty" />
            <input name="name" placeholder="Faculty" required aria-label="Faculty name" />
            <button className="btn btn-primary" disabled={!hasToken}><Check size={18} /> Add Faculty</button>
          </form>
          {faculties.loading && <PanelState kind="loading" text="Loading faculties..." />}
          {faculties.error && <PanelState kind="error" text={faculties.error} />}
          <div className="chips">{(faculties.data ?? []).map((faculty) => <button className="btn btn-chip" type="button" key={faculty.id} onClick={() => setFacultyId(faculty.id)}>{faculty.name}</button>)}</div>
          <form className="toolbar five" onSubmit={createDepartment}>
            <input name="universityId" value={universityId} onChange={(event) => setUniversityId(event.target.value)} placeholder="University ID" required aria-label="University id for department" />
            <input name="facultyId" value={facultyId} onChange={(event) => setFacultyId(event.target.value)} placeholder="Faculty ID" required aria-label="Faculty id for department" />
            <input name="name" placeholder="Department" required aria-label="Department name" />
            <select name="educationLevel" defaultValue="bachelor" aria-label="Education level">
              <option value="associate">Associate</option>
              <option value="bachelor">Bachelor</option>
              <option value="master">Master</option>
              <option value="doctorate">Doctorate</option>
            </select>
            <button className="btn btn-primary" disabled={!hasToken}><Check size={18} /> Add Department</button>
          </form>
        </section>

        <section id="pdf" className="panel wide">
          <div className="panelHeader">
            <div>
              <h2><FileText size={20} /> PDF Processing</h2>
              <p className="panelSub">Create source entries, process text extraction and review candidates.</p>
            </div>
          </div>
          <form className="gridForm" onSubmit={createPdfSource}>
            <input name="universityId" value={universityId} onChange={(event) => setUniversityId(event.target.value)} placeholder="University ID" required aria-label="University id for pdf source" />
            <input name="academicYear" placeholder="2026-2027" required aria-label="Academic year" />
            <input name="fileName" placeholder="calendar.pdf" required aria-label="File name" />
            <input name="fileSize" type="number" min="1" defaultValue="4096" required aria-label="File size" />
            <input name="pageCount" type="number" min="1" max="100" defaultValue="2" required aria-label="Page count" />
            <textarea name="rawText" placeholder="PDF extracted text" required aria-label="Raw extracted text" />
            <button className="btn btn-primary" disabled={!hasToken}><Check size={18} /> Create Source</button>
          </form>
          <div className="toolbar three">
            <input value={pdfSourceId} onChange={(event) => setPdfSourceId(event.target.value)} placeholder="PDF source ID" aria-label="PDF source id" />
            <button className="btn btn-primary" type="button" onClick={processPdf} disabled={!hasToken || !pdfSourceId}><Play size={18} /> Process Source</button>
            <button className="btn btn-secondary" type="button" onClick={loadExtractedEvents} disabled={!hasToken || events.loading}><RefreshCcw size={18} /> Load Review Queue</button>
          </div>
          {events.loading && <PanelState kind="loading" text="Loading extracted events..." />}
          {events.error && <PanelState kind="error" text={events.error} />}
          {!events.loading && !events.error && (events.data?.length ?? 0) === 0 && <PanelState kind="empty" text="No extracted events yet. Process a PDF source to populate review queue." />}
          <div className="table">
            {(events.data ?? []).map((item) => (
              <div className="row review" key={item.id}>
                <span>{item.normalizedTitle}</span>
                <span>{item.normalizedCategory}</span>
                <span>{new Date(item.startDate).toLocaleDateString("tr-TR")}</span>
                <span className="statusBadge">{item.status}</span>
                <button className="btn btn-primary" type="button" onClick={() => void approveEvent(item.id)} disabled={!hasToken}><Check size={16} /> Approve</button>
                <button className="btn btn-danger" type="button" onClick={() => void rejectEvent(item.id)} disabled={!hasToken}><X size={16} /> Reject</button>
              </div>
            ))}
          </div>
        </section>

        <section id="calendar" className="panel">
          <div className="panelHeader">
            <div>
              <h2><CalendarCheck size={20} /> Calendar Publish</h2>
              <p className="panelSub">Promote approved events into production student timeline.</p>
            </div>
          </div>
          <form className="gridForm compact" onSubmit={createCalendarDraft}>
            <input name="universityId" value={universityId} onChange={(event) => setUniversityId(event.target.value)} placeholder="University ID" required aria-label="University id for draft" />
            <input name="sourcePdfId" value={pdfSourceId} onChange={(event) => setPdfSourceId(event.target.value)} placeholder="PDF source ID" required aria-label="Source pdf id" />
            <input name="academicYear" placeholder="2026-2027" required aria-label="Academic year for draft" />
            <input name="title" placeholder="Calendar title" required aria-label="Calendar title" />
            <button className="btn btn-primary" disabled={!hasToken}><Check size={18} /> Create Draft</button>
          </form>
          <div className="toolbar three">
            <input value={calendarId} onChange={(event) => setCalendarId(event.target.value)} placeholder="Calendar ID" aria-label="Calendar id" />
            <button className="btn btn-primary" type="button" onClick={publishCalendar} disabled={!hasToken || !calendarId}><CalendarCheck size={18} /> Publish Calendar</button>
            <button className="btn btn-danger" type="button" onClick={rollbackCalendar} disabled={!hasToken || !calendarId}><RotateCcw size={18} /> Rollback</button>
          </div>
        </section>

        <section id="notifications" className="panel">
          <div className="panelHeader">
            <div>
              <h2><BellRing size={20} /> Notifications</h2>
              <p className="panelSub">Process due queues, retry failures and inspect delivery outcomes.</p>
            </div>
          </div>
          <div className="toolbar four">
            <button className="btn btn-primary" type="button" onClick={processDue} disabled={!hasToken || workerState.loading}><Play size={18} /> Process Due</button>
            <button className="btn btn-secondary" type="button" onClick={loadFailed} disabled={!hasToken || failedState.loading}><RefreshCcw size={18} /> Failed Jobs</button>
            <input value={jobId} onChange={(event) => setJobId(event.target.value)} placeholder="Job ID" aria-label="Notification job id" />
            <button className="btn btn-secondary" type="button" onClick={() => void loadDeliveries()} disabled={!hasToken || !jobId || deliveryState.loading}><History size={18} /> Load Deliveries</button>
          </div>
          {workerState.loading && <PanelState kind="loading" text="Processing due jobs..." />}
          {workerState.data && <pre>{JSON.stringify(workerState.data, null, 2)}</pre>}
          {workerState.error && <PanelState kind="error" text={workerState.error} />}
          {failedState.loading && <PanelState kind="loading" text="Loading failed jobs..." />}
          {failedState.error && <PanelState kind="error" text={failedState.error} />}
          {!failedState.loading && !failedState.error && (failedState.data?.length ?? 0) === 0 && <PanelState kind="empty" text="No failed jobs found." />}
          <div className="table">
            {(failedState.data ?? []).map((job) => (
              <div className="row failed" key={job.id}>
                <span>{job.title}</span>
                <span className="statusBadge">{job.status}</span>
                <span>{new Date(job.scheduledAt).toLocaleString("tr-TR")}</span>
                <button className="btn btn-secondary" type="button" onClick={() => void retryJob(job.id)} disabled={!hasToken}><RotateCcw size={16} /> Retry</button>
                <button className="btn btn-secondary" type="button" onClick={() => { setJobId(job.id); void loadDeliveries(job.id); }} disabled={!hasToken}><History size={16} /> Deliveries</button>
              </div>
            ))}
          </div>
          {deliveryState.loading && <PanelState kind="loading" text="Loading delivery logs..." />}
          {deliveryState.error && <PanelState kind="error" text={deliveryState.error} />}
          {!deliveryState.loading && !deliveryState.error && (deliveryState.data?.length ?? 0) === 0 && <PanelState kind="empty" text="No delivery records for this job yet." />}
          <div className="table">
            {(deliveryState.data ?? []).map((delivery) => (
              <div className="row delivery" key={delivery.id}>
                <span className="statusBadge">{delivery.status}</span>
                <span>{delivery.userId}</span>
                <span>{delivery.failureReason ?? delivery.providerMessageId ?? "-"}</span>
                <span>{new Date(delivery.createdAt).toLocaleString("tr-TR")}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="audit" className="panel">
          <div className="panelHeader">
            <div>
              <h2><History size={20} /> Audit Timeline</h2>
              <p className="panelSub">Inspect immutable operation history and export as JSONL.</p>
            </div>
          </div>
          <div className="toolbar four">
            <input value={entityType} onChange={(event) => setEntityType(event.target.value)} placeholder="entityType" aria-label="Audit entity type" />
            <input value={entityId} onChange={(event) => setEntityId(event.target.value)} placeholder="entityId" aria-label="Audit entity id" />
            <button className="btn btn-secondary" type="button" onClick={loadAudit} disabled={!hasToken || auditState.loading}><RefreshCcw size={18} /> Load Audit</button>
            <button className="btn btn-secondary" type="button" onClick={exportAudit} disabled={!hasToken || !entityId}><Download size={18} /> Export JSONL</button>
          </div>
          {auditState.loading && <PanelState kind="loading" text="Loading audit logs..." />}
          {auditState.error && <PanelState kind="error" text={auditState.error} />}
          {!auditState.loading && !auditState.error && (auditState.data?.length ?? 0) === 0 && <PanelState kind="empty" text="No audit events found for the selected entity." />}
          <div className="table">{(auditState.data ?? []).map((log) => <div className="row audit" key={log.id}><span>{log.action}</span><span>{log.actorId}</span><span>{new Date(log.createdAt).toLocaleString("tr-TR")}</span></div>)}</div>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
