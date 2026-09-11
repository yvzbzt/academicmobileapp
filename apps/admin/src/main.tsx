import React, { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
  Eye,
  FileText,
  History,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Pencil,
  Play,
  RefreshCcw,
  Rss,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X
} from "lucide-react";
import "./styles.css";
import {
  contentReviewBodyMaxBlocks,
  contentReviewBodyMaxLength,
  contentReviewFenceKey,
  contentReviewSummaryMaxLength,
  applyContentReviewClassificationSuggestion,
  createContentReviewMutationPayload,
  createContentReviewFormDraft,
  serializeContentReviewBody,
  type ContentReviewBodyBlock,
  type ContentReviewFormDraft
} from "./content-review-form";
import { confirmAdminDestructiveAction } from "./destructive-actions";
import {
  adminRoles,
  canAccessAdminRoute,
  canManageGlobalAdminData,
  type AdminRole,
  type AdminRoute
} from "./routes";

type ApiState<T> = { loading: boolean; data?: T; error?: string };
type JsonRecord = Record<string, unknown>;
type AuthSession = { accessToken: string; refreshToken?: string; user: { id: string; fullName: string; email: string; role: AdminRole | "student" } };
const LOGOUT_REVOCATION_TIMEOUT_MS = 2_000;

interface UniversityRecord { id: string; name: string; city: string; type: string; status: string; websiteUrl?: string; announcementUrl?: string; academicCalendarUrl?: string; emailDomains?: string[]; }
interface FacultyRecord { id: string; universityId?: string; name: string; websiteUrl?: string; announcementUrl?: string; courseScheduleUrl?: string; examScheduleUrl?: string; }
interface DepartmentRecord { id: string; universityId?: string; facultyId?: string; name: string; websiteUrl?: string; announcementUrl?: string; courseScheduleUrl?: string; examScheduleUrl?: string; }
interface AnnouncementSourceRecord {
  id: string;
  scopeType: "university" | "faculty" | "department";
  scopeId: string;
  ownerUniversityId?: string;
  sourceName: string;
  sourceUrl: string;
  contentType?: "announcement" | "news" | "event";
  parser: "auto" | "rss" | "html";
  parserConfig?: {
    itemSelector?: string;
    titleSelector?: string;
    linkSelector?: string;
    dateSelector?: string;
    contentSelector?: string;
  };
  priority: number;
  status: "active" | "inactive";
  healthStatus?: "pending" | "healthy" | "degraded" | "failed";
  fetchIntervalMinutes?: number;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  itemCount?: number;
  canonicalUrl?: string;
  sourceDefinitionVersion?: string;
  homepageUrl?: string;
  discoveryMethod?: string;
  trustStatus?: "trusted" | "rejected" | "quarantined" | "pending_review";
  reviewStatus?: "trusted" | "rejected" | "quarantined" | "pending_review";
  trustReasonCodes?: string[];
  approvalPending?: boolean;
  evidence?: SourceVerificationEvidence;
  verification?: SourceVerificationEvidence;
  updatedAt: string;
}
interface AnnouncementIngestionPreview {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  status: "healthy" | "degraded" | "failed";
  itemCount: number;
  sampleTitles: string[];
  error?: string;
}
interface AnnouncementSourcePreview {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  finalUrl?: string;
  status: "healthy" | "degraded" | "failed";
  parsedItemCount: number;
  acceptedItemCount: number;
  testedAt: string;
  activationStatus?: string;
  activationError?: string;
  detectedContentType?: string;
  samples: Array<{
    title: string;
    url: string;
    publishedAt?: string;
    publishedDate?: string;
    summary?: string;
    body?: ContentReviewBodyBlock[];
  }>;
  error?: string;
}
type UniversityContentSourceType = "announcement" | "news" | "event" | "academic_calendar";
interface UniversitySourceProfileSlot {
  contentType: UniversityContentSourceType;
  suggestedUrl?: string;
  sourceUrl?: string;
  candidateUrl?: string;
  sourceId?: string;
  sourceName?: string;
  parser: "auto" | "rss" | "html";
  parserConfig?: AnnouncementSourceRecord["parserConfig"];
  status: string;
  trustStatus: string;
  reviewStatus?: string;
  resolution: string;
  sourceStatus: string;
  evidenceStatus: string;
  siteStructure: {
    kind?: string;
    detectedFormat?: string;
    extractionMode?: string;
    description?: string;
    selectorHints?: Record<string, string[]>;
  };
  lastTest: { status: string; checkedAt?: string; successAt?: string; itemCount?: number; error?: string };
  adminPath?: string;
}
interface UniversitySourceProfile {
  universityId: string;
  universityName: string;
  city?: string;
  authority: { status?: string; homepageUrl?: string; domains?: string[]; reasonCodes?: string[] };
  slots: UniversitySourceProfileSlot[];
}
interface UniversitySourceProfilesResponse {
  summary: {
    universities: number;
    sourceSlots: number;
    returnedUniversities: number;
    returnedSourceSlots: number;
    authoritiesVerified?: number;
    authoritiesQuarantined?: number;
  };
  universities: UniversitySourceProfile[];
}
interface AnnouncementSourcesQuery {
  search: string;
  trustStatus: "" | "trusted" | "rejected" | "quarantined" | "pending_review";
  contentType: "" | "announcement" | "news" | "event";
  scopeType: "" | "university" | "faculty" | "department";
  limit: number;
  offset: number;
}
interface SourceVerificationEvidence {
  status?: "verified" | "rejected" | "blocked" | "request_failed" | string;
  schemaVersion?: number;
  verifierVersion?: string;
  runId?: string;
  manifestHash?: string;
  universityId?: string;
  unitType?: "university" | "faculty" | "department";
  scopeId?: string;
  sourceType?: string;
  sourceUrl?: string;
  finalUrl?: string;
  browserFinalUrl?: string;
  rawFinalUrl?: string;
  discoveryMethod?: string;
  httpStatus?: number;
  contentType?: string;
  officialDomain?: boolean;
  semanticMatch?: boolean;
  semanticReasons?: string[];
  selector?: string;
  listingItemCount?: number;
  parserProfile?: string;
  parserCompatible?: boolean;
  parserItemCount?: number;
  sampleItemUrls?: string[];
  sampleDetails?: Array<{ url: string; finalUrl?: string; title?: string; status: string; httpStatus?: number; reasonCodes?: string[] }>;
  verifiedAt?: string;
  finalRevalidatedAt?: string;
  evidencePath?: string;
  sha256?: string;
  parserEvidencePath?: string;
  parserInputSha256?: string;
}
type SourceCoverageResolution = "missing" | "quarantined" | "verified" | "legacy_unverified";
type SourceCoverageType = "homepage" | "announcement" | "news" | "event" | "academic_calendar" | "course_schedule" | "exam_schedule";
interface SourceCoverageItem {
  id: string;
  universityId: string;
  universityName: string;
  scopeType: "faculty" | "department";
  scopeId: string;
  scopeName: string;
  facultyName: string;
  facultyId: string;
  departmentId?: string;
  departmentName?: string;
  sourceType: SourceCoverageType;
  resolution: SourceCoverageResolution;
  url?: string;
  evidencePresent: boolean;
  evidenceArtifactReferencePresent: boolean;
  finalRevalidatedAt?: string;
  publicationScope?: "university" | "faculty_shared" | "department_specific" | "university_system";
  inheritedFromScopeType?: "faculty" | "university";
  inheritedFromScopeId?: string;
  quarantineReason?: string;
  missingReason?: string;
  legacyReason?: string;
}
interface SourceCoverageResponse {
  total: number;
  items: SourceCoverageItem[];
  summary: {
    catalog: { universities: number; academicUnits: number; faculties: number; departments: number };
    filteredSourceSlots: number;
    byResolution: Record<SourceCoverageResolution, number>;
  };
}
interface SourceCoverageQuery {
  search: string;
  universityId: string;
  scopeType: "" | "faculty" | "department";
  sourceType: "" | SourceCoverageType;
  resolution: "" | SourceCoverageResolution;
  limit: number;
  offset: number;
}
interface ContentClassification {
  studentRelevance?: string;
  topic?: string;
  audience?: string[] | "unknown";
  actionType?: string;
  deadline?: string;
  urgency?: string;
  evidenceSpans?: Array<{
    targetField: "studentRelevance" | "topic" | "audience" | "actionType" | "deadline" | "urgency";
    sourceField: string;
    start: number;
    end: number;
    text: string;
    ruleId: string;
  }>;
  classificationVersion?: string;
}
interface ReviewItemRecord extends ContentClassification {
  id: string;
  sourceId: string;
  sourceName?: string;
  sourceUrl?: string;
  officialSourceUrl?: string;
  link?: string;
  canonicalUrl?: string;
  contentType?: "announcement" | "news" | "event";
  scopeType?: "university" | "faculty" | "department";
  scopeId?: string;
  title: string;
  rawTitle?: string;
  summary?: string;
  body?: ContentReviewBodyBlock[] | string;
  reviewStatus?: "pending_review" | "approved" | "rejected";
  status?: "pending_review" | "approved" | "rejected";
  trustReasonCodes?: string[];
  llmClassification?: (ContentClassification & { provider?: string; model?: string; confidence?: number; rationale?: string; analyzedAt?: string }) | null;
  llmReviewFailure?: {
    disposition: "retry_scheduled" | "manual_review";
    reasonCode: "provider_unavailable" | "provider_refusal" | "configuration_unavailable" | "retry_exhausted";
    attemptCount: number;
    lastAttemptedAt: string;
    retryAfter?: string;
  } | null;
  llmReviewInFlight?: boolean;
  snapshotId?: string;
  contentFingerprint: string;
  reviewRevision?: string;
  updatedAt?: string;
}
interface ReviewItemsPage {
  items: ReviewItemRecord[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
interface ReviewItemsQuery {
  reviewStatus?: "pending_review" | "approved" | "rejected";
  contentType?: "announcement" | "news" | "event";
  limit: number;
  offset: number;
}
interface LlmSettingsRecord {
  enabled: boolean;
  provider: string;
  model: string;
  apiKeyConfigured: boolean;
  keyLastFour?: string;
  lastTestStatus?: "success" | "failed" | "untested" | string;
  lastTestedAt?: string;
  updatedAt?: string;
  revision: number;
}
interface CourseScheduleEventRecord {
  id: string;
  scheduleSeriesId?: string;
  title: string;
  courseName?: string;
  location?: string;
  academicYear: string;
  term: string;
  startDate: string;
  endDate?: string;
  facultyId?: string;
  departmentId?: string;
}
interface DomainSuggestionRecord { domain: string; userCount: number; sampleEmails: string[]; }
interface AcademicUnitSuggestionRecord { id: string; userEmail: string; universityId: string; facultyName: string; departmentName?: string; educationLevel: string; status: string; createdAt: string; }
interface ExtractedEventRecord { id: string; pdfSourceId: string; normalizedTitle: string; normalizedCategory: string; startDate: string; endDate?: string; status: string; confidence: number; }
interface ProcessPdfResult { pdfSource: { id: string; parseStatus?: string }; extractedEvents: ExtractedEventRecord[]; }
interface AuditLogRecord { id: string; actorId: string; action: string; entityType: string; entityId: string; createdAt: string; }
interface WorkerResult { processedJobs: number; sent: number; failed: number; deferred?: number; skipped?: number; }
interface NotificationJobRecord { id: string; title: string; status: string; scheduledAt: string; }
interface NotificationDeliveryRecord { id: string; jobId: string; userId: string; deviceTokenId: string; status: string; providerMessageId?: string; failureReason?: string; deliveredAt?: string; createdAt: string; updatedAt: string; }
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

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "https://academic-api.anssoft.com.tr";
const adminRoleSet = new Set<string>(adminRoles);
const adminSessionStorageKey = "academic-calendar-admin-session";

const routes: Array<{ id: AdminRoute; label: string; icon: ReactNode; description: string }> = [
  { id: "dashboard", label: "Panel", icon: <LayoutDashboard size={18} />, description: "Operasyon özeti ve hızlı giriş noktaları" },
  { id: "inputs", label: "Girişler", icon: <Pencil size={18} />, description: "Ders programı ve yetkili katalog girişleri" },
  { id: "catalog", label: "Katalog", icon: <Building2 size={18} />, description: "Üniversiteler, fakülteler ve bölümler" },
  { id: "sources", label: "Duyuru Kaynakları", icon: <Rss size={18} />, description: "Resmî duyuru ve etkinlik kaynaklarını yönetin" },
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
  course_schedule: "Ders programı",
  midterm_exam: "Ara sınav",
  final_exam: "Final sınavı",
  department_exam_schedule: "Sınav programı",
  summer_school_registration: "Yaz okulu kaydı",
  summer_school_start: "Yaz okulu başlangıcı",
  holiday: "Tatil",
  custom_event: "Özel"
};

const sourceScopeLabels: Record<AnnouncementSourceRecord["scopeType"], string> = {
  university: "Üniversite",
  faculty: "Fakülte",
  department: "Bölüm"
};

const sourceHealthLabels: Record<NonNullable<AnnouncementSourceRecord["healthStatus"]>, string> = {
  pending: "Bekliyor",
  healthy: "Sağlıklı",
  degraded: "Sorunlu",
  failed: "Başarısız"
};

const sourceTrustLabels: Record<string, string> = {
  trusted: "Güvenilir",
  rejected: "Reddedildi",
  quarantined: "Karantinada",
  pending_review: "İnceleme bekliyor"
};

const contentTypeLabels: Record<string, string> = {
  announcement: "Duyuru",
  news: "Haber",
  event: "Etkinlik"
};

const studentRelevanceLabels: Record<string, string> = {
  relevant: "Öğrenciyle ilgili",
  not_relevant: "Öğrenciyle ilgili değil",
  uncertain: "Belirsiz"
};

const contentTopicLabels: Record<string, string> = {
  academic_calendar: "Akademik takvim",
  admission: "Öğrenci kabulü",
  course_registration: "Kayıt",
  course_schedule: "Ders programı",
  double_major_minor: "Çift ana dal / yan dal",
  education_opportunity: "Eğitim fırsatı",
  exam: "Sınav",
  horizontal_transfer: "Yatay geçiş",
  scholarship: "Burs",
  internship: "Staj",
  exchange: "Değişim programı",
  graduation: "Mezuniyet",
  tuition: "Ücret / harç",
  housing: "Barınma",
  competition: "Yarışma",
  student_achievement: "Öğrenci başarısı",
  student_event: "Öğrenci etkinliği",
  personnel_recruitment: "Personel ilanı",
  procurement: "İhale / satın alma",
  internal_operations: "Kurum içi işlem",
  unknown: "Belirsiz"
};

const audienceLabels: Record<string, string> = {
  all_students: "Tüm öğrenciler",
  prospective_students: "Aday öğrenciler",
  associate_students: "Ön lisans öğrencileri",
  bachelor_students: "Lisans öğrencileri",
  master_students: "Yüksek lisans öğrencileri",
  doctoral_students: "Doktora öğrencileri",
  graduates: "Mezunlar",
  unknown: "Belirsiz"
};

const actionTypeLabels: Record<string, string> = {
  register: "Kayıt ol",
  apply: "Başvur",
  attend: "Katıl",
  pay: "Öde",
  review: "İncele",
  submit: "Gönder",
  unknown: "Belirsiz"
};

const urgencyLabels: Record<string, string> = {
  critical: "Kritik",
  high: "Yüksek",
  normal: "Normal",
  low: "Düşük",
  unknown: "Belirsiz"
};

const evidenceTargetLabels: Record<NonNullable<ContentClassification["evidenceSpans"]>[number]["targetField"], string> = {
  studentRelevance: "Öğrenci ilgisi",
  topic: "Grup",
  audience: "Hedef kitle",
  actionType: "Eylem",
  deadline: "Son tarih",
  urgency: "Aciliyet"
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
    if (!parsed.accessToken || !parsed.user || !adminRoleSet.has(parsed.user.role)) return null;
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

function istanbulTemporalValue(date: string, time: string): string {
  if (!time) return date;
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  return `${date}T${normalizedTime}+03:00`;
}
interface AcademicUnitScheduleCandidateRecord {
  rowNumber: number;
  rawText: string;
  title?: string;
  date?: string;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  location?: string;
}
interface AcademicUnitScheduleSourceRecord {
  id: string;
  universityId: string;
  facultyId: string;
  departmentId: string;
  scheduleType: "course_schedule" | "exam_schedule";
  sourceUrl: string;
  verifiedFinalUrl: string;
  lifecycle: "ready" | "processing" | "review_required" | "quarantined" | "materializing" | "staged" | "published" | "rejected" | "disabled";
  revision: number;
  reviewResult?: {
    outcome: string;
    reasonCode?: string;
    format: string;
    finalUrl?: string;
    contentSha256?: string;
    candidateCount: number;
    candidates: AcademicUnitScheduleCandidateRecord[];
    checkedAt: string;
  };
  reviewDecision?: {
    decision: "approved" | "rejected";
    materializationStatus?: "materializing" | "staged" | "reopening" | "publishing" | "published";
    calendarId?: string;
    approvedRowNumbers: number[];
    rejectedRowNumbers: number[];
    reviewedBy: string;
    reviewedAt: string;
  };
  updatedAt: string;
}

interface AcademicUnitScheduleSourcesQuery {
  universityId: string;
  scheduleType: "" | AcademicUnitScheduleSourceRecord["scheduleType"];
  lifecycle: "" | AcademicUnitScheduleSourceRecord["lifecycle"];
  limit: number;
  offset: number;
}

class AdminApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AdminApiError";
  }
}

class StaleAdminSessionRequestError extends Error {}

async function responseErrorMessage(response: Response): Promise<string> {
  const fallback = response.statusText || "İşlem tamamlanamadı";
  try {
    const raw = await response.text();
    if (!raw) return `${response.status} ${fallback}`;
    const parsed = JSON.parse(raw) as { message?: unknown };
    const message = Array.isArray(parsed.message)
      ? parsed.message.filter((item): item is string => typeof item === "string").join(" ")
      : typeof parsed.message === "string"
        ? parsed.message
        : fallback;
    return `${response.status} ${message}`;
  } catch {
    return `${response.status} ${fallback}`;
  }
}

function collectionItems<T>(payload: T[] | { items?: T[] }): T[] {
  return Array.isArray(payload) ? payload : payload.items ?? [];
}

function reviewItemStatus(item: ReviewItemRecord): "pending_review" | "approved" | "rejected" {
  return item.reviewStatus ?? item.status ?? "pending_review";
}

function llmReviewFailureMessage(failure: NonNullable<ReviewItemRecord["llmReviewFailure"]>): string {
  const reasons: Record<typeof failure.reasonCode, string> = {
    provider_unavailable: "Sağlayıcı geçici olarak kullanılamadı.",
    provider_refusal: "Sağlayıcı bu içeriği sınıflandırmayı reddetti; insan incelemesi gerekiyor.",
    configuration_unavailable: "LLM ayarı veya API anahtarı kullanılamıyor.",
    retry_exhausted: "Otomatik deneme sınırına ulaşıldı; insan incelemesi gerekiyor."
  };
  const retryAt = failure.disposition === "retry_scheduled" && failure.retryAfter
    ? ` Sonraki deneme: ${new Date(failure.retryAfter).toLocaleString("tr-TR")}.`
    : "";
  return `${reasons[failure.reasonCode]} Deneme: ${failure.attemptCount}.${retryAt}`;
}

function sourceObservedTrustStatus(source: AnnouncementSourceRecord): "trusted" | "rejected" | "quarantined" {
  if (source.trustStatus) return source.trustStatus === "pending_review" ? "quarantined" : source.trustStatus;
  if (source.reviewStatus === "trusted" || source.reviewStatus === "rejected") return source.reviewStatus;
  return "quarantined";
}

function sourceTrustStatus(source: AnnouncementSourceRecord): "trusted" | "rejected" | "quarantined" | "pending_review" {
  return source.approvalPending === true ? "pending_review" : sourceObservedTrustStatus(source);
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
  const [session, setSession] = useState<AuthSession | null>(null);
  const [token, setToken] = useState("");
  const [authState, setAuthState] = useState<ApiState<AuthSession>>({ loading: Boolean(initialHandoffToken || initialStoredSession) });
  const [entityType, setEntityType] = useState("academic_calendar");
  const [entityId, setEntityId] = useState("");
  const [jobId, setJobId] = useState("");
  const [pdfSourceId, setPdfSourceId] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [universityId, setUniversityId] = useState("");
  const [facultyId, setFacultyId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userStatus, setUserStatus] = useState("");
  const [editingUserId, setEditingUserId] = useState("");
  const [manualEvents, setManualEvents] = useState([
    { title: "", courseName: "", location: "", category: "course_registration", term: "fall", startDate: "", startTime: "", endDate: "", endTime: "", repeatWeekly: false, repeatUntil: "", facultyId: "", departmentId: "", offset7: true, offset1: true }
  ]);
  const [universities, setUniversities] = useState<ApiState<UniversityRecord[]>>({ loading: false });
  const [faculties, setFaculties] = useState<ApiState<FacultyRecord[]>>({ loading: false });
  const [departments, setDepartments] = useState<ApiState<DepartmentRecord[]>>({ loading: false });
  const [announcementSources, setAnnouncementSources] = useState<ApiState<AnnouncementSourceRecord[]>>({ loading: false });
  const [announcementSourcesQuery, setAnnouncementSourcesQuery] = useState<AnnouncementSourcesQuery>({
    search: "",
    trustStatus: "",
    contentType: "",
    scopeType: "",
    limit: 100,
    offset: 0
  });
  const [announcementSourcesHasMore, setAnnouncementSourcesHasMore] = useState(false);
  const [sourceLoadProgress, setSourceLoadProgress] = useState("");
  const [sourceTestPreviews, setSourceTestPreviews] = useState<Record<string, AnnouncementSourcePreview>>({});
  const [sourceProfiles, setSourceProfiles] = useState<ApiState<UniversitySourceProfilesResponse>>({ loading: false });
  const [sourceCoverage, setSourceCoverage] = useState<ApiState<SourceCoverageResponse>>({ loading: false });
  const [sourceCoverageQuery, setSourceCoverageQuery] = useState<SourceCoverageQuery>({
    search: "",
    universityId: "",
    scopeType: "",
    sourceType: "",
    resolution: "missing",
    limit: 50,
    offset: 0
  });
  const [reviewItems, setReviewItems] = useState<ApiState<ReviewItemsPage>>({ loading: false });
  const [reviewItemsQuery, setReviewItemsQuery] = useState<ReviewItemsQuery>({ reviewStatus: "pending_review", limit: 50, offset: 0 });
  const [llmSettings, setLlmSettings] = useState<ApiState<LlmSettingsRecord>>({ loading: false });
  const [scheduleReviewSources, setScheduleReviewSources] = useState<ApiState<AcademicUnitScheduleSourceRecord[]>>({ loading: false });
  const [scheduleReviewSourcesQuery, setScheduleReviewSourcesQuery] = useState<AcademicUnitScheduleSourcesQuery>({
    universityId: "",
    scheduleType: "",
    lifecycle: "",
    limit: 50,
    offset: 0
  });
  const [scheduleReviewSourcesHasMore, setScheduleReviewSourcesHasMore] = useState(false);
  const [courseSchedules, setCourseSchedules] = useState<ApiState<CourseScheduleEventRecord[]>>({ loading: false });
  const [events, setEvents] = useState<ApiState<ExtractedEventRecord[]>>({ loading: false });
  const [auditState, setAuditState] = useState<ApiState<AuditLogRecord[]>>({ loading: false });
  const [workerState, setWorkerState] = useState<ApiState<WorkerResult>>({ loading: false });
  const [failedState, setFailedState] = useState<ApiState<NotificationJobRecord[]>>({ loading: false });
  const [deliveryState, setDeliveryState] = useState<ApiState<NotificationDeliveryRecord[]>>({ loading: false });
  const [usersState, setUsersState] = useState<ApiState<AdminUserRecord[]>>({ loading: false });
  const [domainSuggestions, setDomainSuggestions] = useState<ApiState<DomainSuggestionRecord[]>>({ loading: false });
  const [academicUnitSuggestions, setAcademicUnitSuggestions] = useState<ApiState<AcademicUnitSuggestionRecord[]>>({ loading: false });
  const sessionGenerationRef = useRef(0);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const hasToken = token.trim().length > 0;
  const currentRole = session?.user.role === "student" ? undefined : session?.user.role;
  const visibleRoutes = routes.filter((route) => canAccessAdminRoute(currentRole, route.id));
  const renderedRoute = canAccessAdminRoute(currentRole, activeRoute) ? activeRoute : "dashboard";
  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);
  const activeRouteConfig = routes.find((route) => route.id === renderedRoute) ?? routes[0]!;

  function transitionSession(nextSession: AuthSession | null) {
    sessionGenerationRef.current += 1;
    setSessionGeneration(sessionGenerationRef.current);
    setUniversities({ loading: false });
    setFaculties({ loading: false });
    setDepartments({ loading: false });
    setAnnouncementSources({ loading: false });
    setAnnouncementSourcesHasMore(false);
    setSourceLoadProgress("");
    setSourceTestPreviews({});
    setSourceProfiles({ loading: false });
    setSourceCoverage({ loading: false });
    setReviewItems({ loading: false });
    setLlmSettings({ loading: false });
    setScheduleReviewSources({ loading: false });
    setScheduleReviewSourcesHasMore(false);
    setCourseSchedules({ loading: false });
    setEvents({ loading: false });
    setAuditState({ loading: false });
    setWorkerState({ loading: false });
    setFailedState({ loading: false });
    setDeliveryState({ loading: false });
    setUsersState({ loading: false });
    setDomainSuggestions({ loading: false });
    setAcademicUnitSuggestions({ loading: false });
    setSession(nextSession);
    setToken(nextSession?.accessToken ?? "");
    storeSession(nextSession);
  }

  useEffect(() => {
    const onHashChange = () => {
      setActiveRoute(routeFromHash());
      setActionError("");
    };
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
    if (renderedRoute === "users" && !usersState.data && !usersState.loading) void loadUsers();
    if (renderedRoute === "inputs") {
      if (!universities.data && !universities.loading) void loadUniversities();
      if (canManageGlobalAdminData(currentRole)) {
        if (!domainSuggestions.data && !domainSuggestions.loading) void loadDomainSuggestions();
        if (!academicUnitSuggestions.data && !academicUnitSuggestions.loading) void loadAcademicUnitSuggestions();
      }
    }
    if (renderedRoute === "sources") {
      if (!universities.data && !universities.loading) void loadUniversities();
      if (!announcementSources.data && !announcementSources.loading) void loadAnnouncementSources();
      if (!sourceProfiles.data && !sourceProfiles.loading) void loadSourceProfiles();
      if (!sourceCoverage.data && !sourceCoverage.loading) void loadSourceCoverage();
      if (!reviewItems.data && !reviewItems.loading) void loadReviewItems();
      if (!scheduleReviewSources.data && !scheduleReviewSources.loading) void loadScheduleReviewSources();
      if (canManageGlobalAdminData(currentRole) && !llmSettings.data && !llmSettings.loading) void loadLlmSettings();
    }
  }, [renderedRoute, hasToken, currentRole, sessionGeneration]);

  useEffect(() => {
    if (!hasToken || canAccessAdminRoute(currentRole, activeRoute)) return;
    window.history.replaceState(null, "", `${window.location.pathname}#/dashboard`);
    setActiveRoute("dashboard");
    setActionError("Bu bölüm için hesabınızın yetkisi yok.");
  }, [activeRoute, currentRole, hasToken]);

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
      if (!response.ok) throw new Error("Yönetici oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.");
      const user = await response.json() as AuthSession["user"];
      if (!adminRoleSet.has(user.role)) {
        transitionSession(null);
        setAuthState({ loading: false, error: "Bu hesap yönetici paneline erişemez." });
        return;
      }

      const nextSession = { ...storedSession, user };
      transitionSession(nextSession);
      setAuthState({ loading: false, data: nextSession });
    } catch (error) {
      transitionSession(null);
      setAuthState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function acceptHandoffToken(accessToken: string) {
    setAuthState({ loading: true });
    try {
      const response = await fetch(`${apiBaseUrl}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error("Yönetici oturumu doğrulanamadı.");
      const user = await response.json() as AuthSession["user"];
      if (!adminRoleSet.has(user.role)) {
        transitionSession(null);
        setAuthState({ loading: false, error: "Bu hesap yönetici paneline erişemez." });
        window.history.replaceState(null, "", `${window.location.pathname}#/dashboard`);
        return;
      }

      const nextSession = { accessToken, user };
      transitionSession(nextSession);
      setAuthState({ loading: false, data: nextSession });
      setMessage("Yönetici oturumu hazır");
      window.history.replaceState(null, "", `${window.location.pathname}#/dashboard`);
      setActiveRoute("dashboard");
    } catch (error) {
      transitionSession(null);
      setAuthState({ loading: false, error: error instanceof Error ? error.message : String(error) });
      window.history.replaceState(null, "", `${window.location.pathname}#/dashboard`);
    }
  }

  async function logout() {
    const refreshToken = session?.refreshToken;
    transitionSession(null);
    setAuthState({ loading: false });
    setMessage("");
    window.history.replaceState(null, "", `${window.location.pathname}#/dashboard`);
    setActiveRoute("dashboard");
    if (!refreshToken) return;
    try {
      await request<{ status: "ok" }>("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
        signal: AbortSignal.timeout(LOGOUT_REVOCATION_TIMEOUT_MS)
      });
    } catch {
      // Local logout must still complete when revocation is unavailable.
    }
  }

  async function loginAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = formData(event);
    setAuthState({ loading: true });
    setMessage("");

    try {
      const response = await fetch(`${apiBaseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          deviceId: "admin-web"
        })
      });

      if (!response.ok) throw new Error("E-posta veya şifre doğru değil.");

      const nextSession = await response.json() as AuthSession;
      if (!nextSession.accessToken || !nextSession.user || !adminRoleSet.has(nextSession.user.role)) {
        throw new Error("Bu hesap yönetici paneline erişemez.");
      }

      transitionSession(nextSession);
      setAuthState({ loading: false, data: nextSession });
      setMessage("Yönetici oturumu açıldı");
      window.history.replaceState(null, "", `${window.location.pathname}#/dashboard`);
      setActiveRoute("dashboard");
    } catch (error) {
      transitionSession(null);
      setAuthState({
        loading: false,
        error: error instanceof Error ? error.message : "Giriş yapılamadı. Bilgileri kontrol edip tekrar deneyin."
      });
    }
  }

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const requestGeneration = sessionGenerationRef.current;
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers: { "Content-Type": "application/json", ...headers, ...(options.headers ?? {}) } });
    } catch (error) {
      if (requestGeneration !== sessionGenerationRef.current) throw new StaleAdminSessionRequestError();
      throw error;
    }
    if (requestGeneration !== sessionGenerationRef.current) throw new StaleAdminSessionRequestError();
    if (!response.ok) {
      const message = await responseErrorMessage(response);
      if (requestGeneration !== sessionGenerationRef.current) throw new StaleAdminSessionRequestError();
      throw new AdminApiError(response.status, message);
    }
    if (response.status === 204) return undefined as T;
    const raw = await response.text();
    if (requestGeneration !== sessionGenerationRef.current) throw new StaleAdminSessionRequestError();
    return (raw ? JSON.parse(raw) : undefined) as T;
  }

  function uiAction<TArgs extends unknown[]>(action: (...args: TArgs) => Promise<unknown>) {
    return (...args: TArgs) => {
      setMessage("");
      setActionError("");
      return action(...args).catch((error) => {
        if (error instanceof StaleAdminSessionRequestError) return;
        setActionError(error instanceof Error ? error.message : String(error));
      });
    };
  }

  async function runAction<T>(setter: (state: ApiState<T>) => void, action: () => Promise<T>, success?: string) {
    const requestGeneration = sessionGenerationRef.current;
    setter({ loading: true });
    try {
      const data = await action();
      if (requestGeneration !== sessionGenerationRef.current) return;
      setter({ loading: false, data });
      if (success) setMessage(success);
    } catch (error) {
      if (requestGeneration !== sessionGenerationRef.current || error instanceof StaleAdminSessionRequestError) return;
      setter({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  function formData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
  }

  function sourceParserConfig(values: Record<string, string>) {
    const keys = ["itemSelector", "titleSelector", "linkSelector", "dateSelector", "contentSelector"];
    if (!keys.some((key) => key in values)) return undefined;
    return Object.fromEntries(
      keys
        .map((key) => [key, values[key]?.trim()])
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
    );
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

  async function loadSourceProfiles() {
    if (!ensureToken()) return;
    await runAction(
      setSourceProfiles,
      () => request<UniversitySourceProfilesResponse>("/admin/announcements/source-profiles")
    );
  }

  async function saveUniversitySourceProfile(
    event: FormEvent<HTMLFormElement>,
    universityId: string,
    contentType: UniversityContentSourceType
  ) {
    if (!ensureToken()) return;
    const values = formData(event);
    await request<JsonRecord>(
      `/admin/announcements/source-profiles/${encodeURIComponent(universityId)}/${contentType}`,
      {
        method: "PUT",
        body: JSON.stringify({
          sourceUrl: values.sourceUrl.trim(),
          ...(values.sourceName?.trim() ? { sourceName: values.sourceName.trim() } : {}),
          parser: values.parser,
          parserConfig: sourceParserConfig(values),
          status: values.status === "active" ? "active" : "inactive"
        })
      }
    );
    await loadSourceProfiles();
    setMessage(`${contentType === "academic_calendar" ? "Akademik takvim" : contentTypeLabels[contentType]} kaynak profili kaydedildi`);
  }

  async function previewUniversitySourceProfile(universityId: string, contentType: UniversityContentSourceType) {
    if (!ensureToken()) return;
    const preview = await request<AnnouncementSourcePreview>(
      `/admin/announcements/source-profiles/${encodeURIComponent(universityId)}/${contentType}/preview`,
      { method: "POST", body: JSON.stringify({ activateWhenHealthy: true }) }
    );
    setSourceTestPreviews((current) => ({ ...current, [`${universityId}\u0000${contentType}`]: preview }));
    await loadSourceProfiles();
    setMessage(`Kaynak testi tamamlandı: ${preview.acceptedItemCount}/${preview.parsedItemCount} içerik kabul edildi`);
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
    if (!confirmAdminDestructiveAction("archiveUniversity")) return;
    await request<JsonRecord>(`/admin/universities/${id}`, { method: "DELETE" });
    await loadUniversities();
  }

  async function updateCatalogSourceUrls(
    event: FormEvent<HTMLFormElement>,
    scope: "university" | "faculty" | "department",
    id: string,
    parentId?: string
  ) {
    if (!ensureToken()) return;
    const values = formData(event);
    const path = scope === "university" ? `/admin/universities/${id}`
      : scope === "faculty" ? `/admin/faculties/${id}`
        : `/admin/departments/${id}`;
    await request<JsonRecord>(path, {
      method: "PATCH",
      body: JSON.stringify(nullableSourceFields(values, scope))
    });
    if (scope === "university") await loadUniversities();
    else if (scope === "faculty") await loadFaculties(parentId ?? universityId);
    else await loadDepartments(parentId ?? facultyId);
    setMessage("Kaynak adresleri güncellendi");
  }

  async function syncVerifiedCatalogSources() {
    if (!ensureToken() || !canManageGlobalAdminData(currentRole)) return;
    const result = await request<{ filled?: number; unchanged?: number; conflicts?: number; missingOwners?: number }>(
      "/admin/catalog/sync-verified-sources",
      { method: "POST" }
    );
    await loadUniversities();
    if (universityId) await loadFaculties(universityId);
    if (facultyId) await loadDepartments(facultyId);
    setMessage(`Doğrulanmış katalog kaynakları: ${result.filled ?? 0} eklendi, ${result.unchanged ?? 0} aynı, ${result.conflicts ?? 0} insan düzeltmesiyle çakıştı`);
  }

  async function loadFaculties(targetUniversityId = universityId) {
    if (!ensureToken()) return;
    if (!targetUniversityId) return;
    await runAction(setFaculties, () => request<FacultyRecord[]>(`/universities/${targetUniversityId}/faculties`));
  }

  async function loadDepartments(targetFacultyId = facultyId) {
    if (!ensureToken()) return;
    if (!targetFacultyId) return;
    await runAction(setDepartments, () => request<DepartmentRecord[]>(`/faculties/${targetFacultyId}/departments`));
  }

  async function loadAnnouncementSources(nextQuery: Partial<AnnouncementSourcesQuery> = {}) {
    if (!ensureToken()) return;
    const requestGeneration = sessionGenerationRef.current;
    const query = { ...announcementSourcesQuery, ...nextQuery };
    setAnnouncementSourcesQuery(query);
    const params = new URLSearchParams({ limit: String(query.limit + 1), offset: String(query.offset) });
    if (query.search.trim()) params.set("search", query.search.trim());
    if (query.trustStatus) params.set("trustStatus", query.trustStatus);
    if (query.contentType) params.set("contentType", query.contentType);
    if (query.scopeType) params.set("scopeType", query.scopeType);
    setAnnouncementSources({ loading: true });
    setSourceLoadProgress("Filtrelenen kaynak sayfası yükleniyor...");
    try {
      const payload = await request<AnnouncementSourceRecord[] | { items?: AnnouncementSourceRecord[]; hasMore?: boolean }>(
        `/admin/announcements/sources?${params}`
      );
      const page = collectionItems(payload);
      const serverHasMore = Array.isArray(payload) ? page.length > query.limit : payload.hasMore ?? page.length > query.limit;
      setAnnouncementSourcesHasMore(serverHasMore);
      setAnnouncementSources({ loading: false, data: page.slice(0, query.limit) });
    } catch (error) {
      if (error instanceof StaleAdminSessionRequestError) return;
      setAnnouncementSourcesHasMore(false);
      setAnnouncementSources({ loading: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (requestGeneration === sessionGenerationRef.current) setSourceLoadProgress("");
    }
  }

  function nullableSourceFields(values: Record<string, string>, scope: "university" | "faculty" | "department") {
    const keys = scope === "university"
      ? ["websiteUrl", "announcementUrl", "academicCalendarUrl"]
      : scope === "faculty"
        ? ["websiteUrl", "announcementUrl"]
        : ["websiteUrl", "announcementUrl", "courseScheduleUrl", "examScheduleUrl"];
    return Object.fromEntries(keys.map((key) => [key, values[key]?.trim() || null]));
  }

  async function loadSourceCoverage(nextQuery: Partial<SourceCoverageQuery> = {}) {
    if (!ensureToken()) return;
    const query = { ...sourceCoverageQuery, ...nextQuery };
    setSourceCoverageQuery(query);
    const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) });
    if (query.search.trim()) params.set("search", query.search.trim());
    if (query.universityId) params.set("universityId", query.universityId);
    if (query.scopeType) params.set("scopeType", query.scopeType);
    if (query.sourceType) params.set("sourceType", query.sourceType);
    if (query.resolution) params.set("resolution", query.resolution);
    await runAction(setSourceCoverage, () => request<SourceCoverageResponse>(`/admin/source-coverage?${params}`));
  }

  async function createAnnouncementSource(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken()) return;
    const form = event.currentTarget;
    const values = formData(event);
    const scopeType = values.scopeType as AnnouncementSourceRecord["scopeType"];
    await request<JsonRecord>("/admin/announcements/sources", {
      method: "POST",
      body: JSON.stringify({
        scopeType,
        universityId: values.universityId,
        ...(scopeType !== "university" && values.facultyId ? { facultyId: values.facultyId } : {}),
        ...(scopeType === "department" && values.departmentId ? { departmentId: values.departmentId } : {}),
        sourceName: values.sourceName,
        sourceUrl: values.sourceUrl,
        contentType: values.contentType,
        parser: values.parser,
        parserConfig: sourceParserConfig(values),
        priority: Number(values.priority),
        fetchIntervalMinutes: Number(values.fetchIntervalMinutes)
      })
    });
    form.reset();
    await loadAnnouncementSources();
    setMessage("Duyuru kaynağı inceleme kuyruğuna eklendi");
  }

  async function updateAnnouncementSource(event: FormEvent<HTMLFormElement>, source: AnnouncementSourceRecord) {
    if (!ensureToken()) return;
    const values = formData(event);
    try {
      await request<JsonRecord>(`/admin/announcements/sources/${source.id}`, {
        method: "PUT",
        body: JSON.stringify({
          expectedSourceDefinitionVersion: source.sourceDefinitionVersion ?? "",
          expectedCanonicalUrl: source.canonicalUrl ?? source.sourceUrl,
          expectedTrustStatus: sourceObservedTrustStatus(source),
          expectedSourceStatus: source.status,
          expectedApprovalPending: source.approvalPending === true,
          expectedUpdatedAt: source.updatedAt,
          sourceName: values.sourceName,
          sourceUrl: values.sourceUrl,
          contentType: values.contentType,
          parser: values.parser,
          parserConfig: sourceParserConfig(values),
          priority: Number(values.priority),
          fetchIntervalMinutes: Number(values.fetchIntervalMinutes),
          status: values.status
        })
      });
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 409) {
        await loadAnnouncementSources();
        setMessage("Kaynak başka bir işlemde değişti; eski düzenleme kaydedilmedi ve liste yenilendi");
        return;
      }
      throw error;
    }
    await loadAnnouncementSources();
    setMessage("Kaynak ayarları güncellendi");
  }

  async function deactivateAnnouncementSource(source: AnnouncementSourceRecord) {
    if (!ensureToken()) return;
    if (!confirmAdminDestructiveAction("deactivateAnnouncementSource")) return;
    try {
      await request<JsonRecord>(`/admin/announcements/sources/${source.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          expectedSourceDefinitionVersion: source.sourceDefinitionVersion ?? "",
          expectedCanonicalUrl: source.canonicalUrl ?? source.sourceUrl,
          expectedTrustStatus: sourceObservedTrustStatus(source),
          expectedSourceStatus: source.status,
          expectedApprovalPending: source.approvalPending === true
        })
      });
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 409) {
        await loadAnnouncementSources();
        setMessage("Kaynak başka bir işlemde değişti; eski pasife alma isteği uygulanmadı ve liste yenilendi");
        return;
      }
      throw error;
    }
    await loadAnnouncementSources();
    setMessage("Kaynak pasife alındı");
  }

  async function ingestAnnouncementSource(id: string) {
    if (!ensureToken()) return;
    const result = await request<AnnouncementIngestionPreview>(`/admin/announcements/sources/${id}/ingest`, { method: "POST" });
    await loadAnnouncementSources();
    setMessage(`Kaynak şimdi yenilendi: ${result.itemCount} içerik ayrıştırıldı`);
  }

  async function reviewAnnouncementSource(source: AnnouncementSourceRecord, decision: "approve" | "reject", note: string) {
    if (!ensureToken()) return;
    await request<JsonRecord>(`/admin/announcements/sources/${source.id}/${decision}`, {
      method: "POST",
      body: JSON.stringify({
        expectedSourceDefinitionVersion: source.sourceDefinitionVersion ?? "",
        expectedCanonicalUrl: source.canonicalUrl ?? source.sourceUrl,
        expectedTrustStatus: sourceObservedTrustStatus(source),
        expectedSourceStatus: source.status,
        expectedApprovalPending: source.approvalPending === true,
        ...(note.trim() ? { note: note.trim() } : {})
      })
    });
    await loadAnnouncementSources();
    setMessage(decision === "approve" ? "Kaynak güvenilir olarak onaylandı" : "Kaynak reddedildi");
  }

  async function provisionRegistrySources() {
    if (!ensureToken() || !canManageGlobalAdminData(currentRole)) return;
    await request<JsonRecord>("/admin/announcements/sources/provision-registry", { method: "POST" });
    await loadAnnouncementSources();
    setMessage("Resmî kayıt kaynakları karantinaya alındı; güvenilir olmaları için insan onayı gerekiyor");
  }

  async function loadScheduleReviewSources(nextQuery: Partial<AcademicUnitScheduleSourcesQuery> = {}) {
    if (!ensureToken()) return;
    const query = { ...scheduleReviewSourcesQuery, ...nextQuery };
    setScheduleReviewSourcesQuery(query);
    const params = new URLSearchParams({ limit: String(query.limit + 1), offset: String(query.offset) });
    if (query.universityId) params.set("universityId", query.universityId);
    if (query.scheduleType) params.set("scheduleType", query.scheduleType);
    if (query.lifecycle) params.set("lifecycle", query.lifecycle);
    setScheduleReviewSources({ loading: true });
    try {
      const page = await request<AcademicUnitScheduleSourceRecord[]>(`/admin/calendars/schedule-sources?${params}`);
      setScheduleReviewSourcesHasMore(page.length > query.limit);
      setScheduleReviewSources({ loading: false, data: page.slice(0, query.limit) });
    } catch (error) {
      if (error instanceof StaleAdminSessionRequestError) return;
      setScheduleReviewSourcesHasMore(false);
      setScheduleReviewSources({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function provisionScheduleReviewSources() {
    if (!ensureToken() || !canManageGlobalAdminData(currentRole)) return;
    await request<JsonRecord>("/admin/calendars/schedule-sources/provision-registry", { method: "POST" });
    await loadScheduleReviewSources();
    setMessage("Doğrulanmış ders ve sınav programı kaynakları inceleme kuyruğuna alındı");
  }

  async function ingestScheduleReviewSource(source: AcademicUnitScheduleSourceRecord) {
    if (!ensureToken() || !canManageGlobalAdminData(currentRole)) return;
    await request<AcademicUnitScheduleSourceRecord>(`/admin/calendars/schedule-sources/${source.id}/ingest`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision: source.revision })
    });
    await loadScheduleReviewSources();
    setMessage("Program kaynağı ayrıştırıldı; satırlar insan incelemesini bekliyor");
  }

  async function updateScheduleCandidate(
    event: FormEvent<HTMLFormElement>,
    source: AcademicUnitScheduleSourceRecord,
    candidate: AcademicUnitScheduleCandidateRecord
  ) {
    if (!ensureToken()) return;
    const values = formData(event);
    await request<AcademicUnitScheduleSourceRecord>(
      `/admin/calendars/schedule-sources/${source.id}/candidates/${candidate.rowNumber}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: source.revision,
          title: values.title || null,
          date: values.date || null,
          dayOfWeek: values.dayOfWeek === "" ? null : Number(values.dayOfWeek),
          startTime: values.startTime || null,
          endTime: values.endTime || null,
          location: values.location || null
        })
      }
    );
    await loadScheduleReviewSources();
    setMessage(`Program satırı ${candidate.rowNumber} kaydedildi`);
  }

  async function reviewScheduleSource(
    event: FormEvent<HTMLFormElement>,
    source: AcademicUnitScheduleSourceRecord,
    decision: "approve" | "reject"
  ) {
    if (!ensureToken()) return;
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const approvedRowNumbers = data.getAll("approvedRowNumbers").map(Number).filter(Number.isSafeInteger);
    await request<AcademicUnitScheduleSourceRecord>(`/admin/calendars/schedule-sources/${source.id}/review`, {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: source.revision,
        decision,
        ...(decision === "approve" ? {
          academicYear: String(data.get("academicYear") ?? ""),
          term: String(data.get("term") ?? ""),
          ...(source.scheduleType === "course_schedule" ? {
            courseRangeStart: String(data.get("courseRangeStart") ?? ""),
            courseRangeEnd: String(data.get("courseRangeEnd") ?? "")
          } : {}),
          approvedRowNumbers
        } : { reason: String(data.get("reason") ?? "") })
      })
    });
    await loadScheduleReviewSources();
    setMessage(decision === "approve"
      ? "Onaylı program satırları görünmez olarak sahnelendi; süper yönetici yayını bekleniyor"
      : "Program kaynağı reddedildi");
  }

  async function publishScheduleReviewSource(source: AcademicUnitScheduleSourceRecord) {
    if (!ensureToken() || !canManageGlobalAdminData(currentRole)) return;
    await request<AcademicUnitScheduleSourceRecord>(`/admin/calendars/schedule-sources/${source.id}/publish`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision: source.revision })
    });
    await loadScheduleReviewSources();
    setMessage("Sahnelenen program satırları süper yönetici tarafından yayınlandı");
  }

  async function reopenScheduleReviewSource(source: AcademicUnitScheduleSourceRecord) {
    if (!ensureToken() || !canManageGlobalAdminData(currentRole)) return;
    await request<AcademicUnitScheduleSourceRecord>(`/admin/calendars/schedule-sources/${source.id}/reopen-review`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision: source.revision })
    });
    await loadScheduleReviewSources();
    setMessage("Sahnelenen program geri alındı; kaynak yeniden insan incelemesine açıldı");
  }

  async function loadReviewItems(nextQuery: Partial<ReviewItemsQuery> = {}) {
    if (!ensureToken()) return;
    const query = { ...reviewItemsQuery, ...nextQuery };
    setReviewItemsQuery(query);
    const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) });
    if (query.reviewStatus) params.set("reviewStatus", query.reviewStatus);
    if (query.contentType) params.set("contentType", query.contentType);
    await runAction(
      setReviewItems,
      async () => {
        const payload = await request<ReviewItemRecord[] | ReviewItemsPage>(`/admin/announcements/review-items?${params}`);
        if (!Array.isArray(payload)) return payload;
        return { items: payload, total: payload.length, limit: query.limit, offset: query.offset, hasMore: payload.length === query.limit };
      }
    );
  }

  async function handleStaleReviewWrite(error: unknown): Promise<boolean> {
    if (!(error instanceof AdminApiError) || error.status !== 409) return false;
    await loadReviewItems();
    setMessage("İçerik tarama sırasında değişti; eski sürüm kaydedilmedi ve kuyruk yenilendi");
    return true;
  }

  async function updateReviewItem(
    item: ReviewItemRecord,
    draft: ContentReviewFormDraft & { body: ContentReviewBodyBlock[] },
    forcedReviewStatus?: "approved" | "rejected"
  ) {
    if (!ensureToken()) return;
    try {
      await request<ReviewItemRecord>(`/admin/announcements/review-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify(createContentReviewMutationPayload(item, draft, draft.body, forcedReviewStatus))
      });
    } catch (error) {
      if (await handleStaleReviewWrite(error)) return;
      throw error;
    }
    await loadReviewItems();
    setMessage(forcedReviewStatus === "approved"
      ? "İçerik, düzeltmeleriyle birlikte onaylandı"
      : "İçerik ve sınıflandırma düzeltmeleri kaydedildi");
  }

  async function setReviewItemStatus(item: ReviewItemRecord, reviewStatus: "approved" | "rejected") {
    if (!ensureToken()) return;
    try {
      await request<ReviewItemRecord>(`/admin/announcements/review-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          reviewStatus,
          ...(item.snapshotId ? { expectedSnapshotId: item.snapshotId } : {}),
          expectedContentFingerprint: item.contentFingerprint,
          ...(item.reviewRevision !== undefined ? { expectedReviewRevision: item.reviewRevision } : {})
        })
      });
    } catch (error) {
      if (await handleStaleReviewWrite(error)) return;
      throw error;
    }
    await loadReviewItems();
    setMessage(reviewStatus === "approved" ? "İçerik onaylandı" : "İçerik reddedildi");
  }

  async function runReviewItemLlm(item: ReviewItemRecord) {
    if (!ensureToken() || !canManageGlobalAdminData(currentRole)) return;
    try {
      await request<ReviewItemRecord>(`/admin/announcements/review-items/${item.id}/llm-review`, {
        method: "POST",
        body: JSON.stringify({
          ...(item.snapshotId ? { expectedSnapshotId: item.snapshotId } : {}),
          expectedContentFingerprint: item.contentFingerprint,
          ...(item.reviewRevision !== undefined ? { expectedReviewRevision: item.reviewRevision } : {})
        })
      });
    } catch (error) {
      if (await handleStaleReviewWrite(error)) return;
      await loadReviewItems();
      throw error;
    }
    await loadReviewItems();
    setMessage("İçerik LLM ile incelendi; insan onayı bekliyor");
  }

  async function runPendingLlmReviews() {
    if (!ensureToken() || !canManageGlobalAdminData(currentRole)) return;
    let processed = 0;
    let reviewed = 0;
    let failed = 0;
    let hasMore = false;
    try {
      for (let requestCount = 0; requestCount < 20; requestCount += 1) {
        const result = await request<{ processed: number; reviewed: number; failed: number; hasMore: boolean }>(
          "/admin/announcements/review-items/llm-review",
          { method: "POST", body: JSON.stringify({ limit: 1 }) }
        );
        hasMore = result.hasMore;
        if (result.processed === 0) break;
        processed += result.processed;
        reviewed += result.reviewed;
        failed += result.failed;
        if (!hasMore) break;
      }
    } finally {
      await loadReviewItems({ reviewStatus: "pending_review", offset: 0 });
    }
    setMessage(`LLM kuyruğu: ${reviewed}/${processed} incelendi${failed ? `, ${failed} başarısız` : ""}${hasMore ? "; ilk 20 kayıt işlendi, kuyrukta içerik kaldı" : ""}`);
  }

  async function loadLlmSettings() {
    if (!ensureToken() || !canManageGlobalAdminData(currentRole)) return;
    await runAction(setLlmSettings, () => request<LlmSettingsRecord>("/admin/announcements/llm-settings"));
  }

  async function updateLlmSettings(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken() || !canManageGlobalAdminData(currentRole)) return;
    const form = event.currentTarget;
    const values = formData(event);
    const apiKey = values.apiKey.trim();
    const saved = await request<LlmSettingsRecord>("/admin/announcements/llm-settings", {
      method: "PUT",
      body: JSON.stringify({
        expectedRevision: Number(values.expectedRevision),
        provider: values.provider,
        model: values.model.trim(),
        enabled: values.enabled === "on",
        ...(apiKey ? { apiKey } : {})
      })
    });
    form.reset();
    setLlmSettings({ loading: false, data: saved });
    setMessage(apiKey ? "LLM ayarları ve yeni API anahtarı güvenle kaydedildi" : "LLM ayarları kaydedildi");
  }

  async function deleteLlmKey() {
    if (!ensureToken() || !canManageGlobalAdminData(currentRole)) return;
    const current = llmSettings.data;
    if (!current) return;
    const saved = await request<LlmSettingsRecord>("/admin/announcements/llm-settings/key", {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision: current.revision })
    });
    setLlmSettings({ loading: false, data: saved });
    setMessage("LLM API anahtarı kaldırıldı");
  }

  async function testLlmSettings() {
    if (!ensureToken() || !canManageGlobalAdminData(currentRole)) return;
    const tested = await request<LlmSettingsRecord>("/admin/announcements/llm-settings/test", { method: "POST" });
    setLlmSettings({ loading: false, data: tested });
    setMessage(tested.lastTestStatus === "success" ? "LLM bağlantısı doğrulandı" : "LLM bağlantı testi tamamlandı");
  }

  async function loadCourseSchedules(
    targetUniversityId = universityId,
    targetDepartmentId = departmentId,
    academicYear?: string
  ) {
    if (!ensureToken()) return;
    if (!targetUniversityId || !targetDepartmentId) {
      setCourseSchedules({ loading: false, data: [] });
      return;
    }
    const query = new URLSearchParams({ universityId: targetUniversityId, departmentId: targetDepartmentId });
    if (academicYear) query.set("academicYear", academicYear);
    await runAction(setCourseSchedules, () => request<CourseScheduleEventRecord[]>(`/admin/calendars/course-schedules?${query}`));
  }

  async function createCourseSchedule(event: FormEvent<HTMLFormElement>) {
    if (!ensureToken()) return;
    const form = event.currentTarget;
    const values = formData(event);
    const response = await request<{ seriesId: string; events: CourseScheduleEventRecord[] }>("/admin/calendars/course-schedules", {
      method: "POST",
      body: JSON.stringify({
        universityId: values.universityId,
        facultyId: values.facultyId,
        departmentId: values.departmentId,
        academicYear: values.academicYear,
        term: values.term,
        title: values.title,
        ...(values.courseName ? { courseName: values.courseName } : {}),
        ...(values.location ? { location: values.location } : {}),
        startDate: istanbulTemporalValue(values.startDate, values.startTime),
        endDate: istanbulTemporalValue(values.startDate, values.endTime),
        repeatWeekly: values.repeatWeekly === "on",
        ...(values.repeatWeekly === "on" ? { repeatUntil: values.repeatUntil } : {})
      })
    });
    form.reset();
    await loadCourseSchedules(values.universityId, values.departmentId, values.academicYear);
    setMessage(`${response.events.length} ders oturumu yayınlandı`);
  }

  async function deleteCourseScheduleSeries(seriesId: string) {
    if (!ensureToken()) return;
    if (!confirmAdminDestructiveAction("removeCourseScheduleSeries")) return;
    await request<JsonRecord>(`/admin/calendars/course-schedules/${seriesId}`, { method: "DELETE" });
    await loadCourseSchedules();
    setMessage("Ders programı satırı kaldırıldı");
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
    if (!confirmAdminDestructiveAction("rejectAcademicUnitSuggestion")) return;
    await request<AcademicUnitSuggestionRecord>(`/admin/users/academic-unit-suggestions/${id}/reject`, { method: "POST" });
    await loadAcademicUnitSuggestions();
    setMessage("Akademik birim önerisi reddedildi");
  }

  function updateManualEvent(index: number, key: string, value: string | boolean) {
    setManualEvents((events) => events.map((event, eventIndex) => eventIndex === index ? { ...event, [key]: value } : event));
  }

  function addManualEventRow() {
    setManualEvents((events) => [...events, { title: "", courseName: "", location: "", category: "course_registration", term: "fall", startDate: "", startTime: "", endDate: "", endTime: "", repeatWeekly: false, repeatUntil: "", facultyId: "", departmentId: "", offset7: true, offset1: true }]);
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
          .filter((row) => (row.title || row.courseName) && row.startDate)
          .map((row) => ({
            title: row.title || row.courseName,
            ...(row.courseName ? { courseName: row.courseName } : {}),
            ...(row.location ? { location: row.location } : {}),
            category: row.category,
            term: row.term,
            startDate: istanbulTemporalValue(row.startDate, row.startTime),
            ...((row.endDate || row.endTime) ? {
              endDate: istanbulTemporalValue(row.endDate || row.startDate, row.endTime || row.startTime)
            } : {}),
            ...(row.repeatWeekly && row.repeatUntil ? { repeatWeekly: true, repeatUntil: row.repeatUntil } : {}),
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
    const source = await request<{ id: string }>("/admin/pdf-sources", { method: "POST", body: JSON.stringify({ universityId: values.universityId, fileName: values.fileName, mimeType: "application/pdf", magicBytesHex: "255044462d312e37", fileSize: Number(values.fileSize), pageCount: Number(values.pageCount), academicYear: values.academicYear, url: values.url }) });
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
    if (!confirmAdminDestructiveAction("rejectExtractedEvent")) return;
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
    if (!confirmAdminDestructiveAction("rollbackPublishedCalendar")) return;

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
    if (!confirmAdminDestructiveAction("deleteUser")) return;
    await request<JsonRecord>(`/admin/users/${id}`, { method: "DELETE" });
    await loadUsers();
    setMessage("Kullanıcı silindi");
  }

  const pageProps = {
    hasToken,
    role: currentRole,
    universities,
    faculties,
    departments,
    announcementSources,
    announcementSourcesQuery,
    announcementSourcesHasMore,
    sourceLoadProgress,
    sourceTestPreviews,
    sourceProfiles,
    sourceCoverage,
    sourceCoverageQuery,
    reviewItems,
    llmSettings,
    scheduleReviewSources,
    scheduleReviewSourcesQuery,
    scheduleReviewSourcesHasMore,
    courseSchedules,
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
    departmentId,
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
    setDepartmentId,
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
    loadUniversities: uiAction(loadUniversities),
    loadSourceProfiles: uiAction(loadSourceProfiles),
    saveUniversitySourceProfile: uiAction(saveUniversitySourceProfile),
    previewUniversitySourceProfile: uiAction(previewUniversitySourceProfile),
    createUniversity: uiAction(createUniversity),
    archiveUniversity: uiAction(archiveUniversity),
    updateCatalogSourceUrls: uiAction(updateCatalogSourceUrls),
    syncVerifiedCatalogSources: uiAction(syncVerifiedCatalogSources),
    loadFaculties: uiAction(loadFaculties),
    loadDepartments: uiAction(loadDepartments),
    loadAnnouncementSources: uiAction(loadAnnouncementSources),
    loadSourceCoverage: uiAction(loadSourceCoverage),
    createAnnouncementSource: uiAction(createAnnouncementSource),
    updateAnnouncementSource: uiAction(updateAnnouncementSource),
    deactivateAnnouncementSource: uiAction(deactivateAnnouncementSource),
    ingestAnnouncementSource: uiAction(ingestAnnouncementSource),
    reviewAnnouncementSource: uiAction(reviewAnnouncementSource),
    provisionRegistrySources: uiAction(provisionRegistrySources),
    loadScheduleReviewSources: uiAction(loadScheduleReviewSources),
    provisionScheduleReviewSources: uiAction(provisionScheduleReviewSources),
    ingestScheduleReviewSource: uiAction(ingestScheduleReviewSource),
    updateScheduleCandidate: uiAction(updateScheduleCandidate),
    reviewScheduleSource: uiAction(reviewScheduleSource),
    reopenScheduleReviewSource: uiAction(reopenScheduleReviewSource),
    publishScheduleReviewSource: uiAction(publishScheduleReviewSource),
    loadReviewItems: uiAction(loadReviewItems),
    updateReviewItem: uiAction(updateReviewItem),
    setReviewItemStatus: uiAction(setReviewItemStatus),
    runReviewItemLlm: uiAction(runReviewItemLlm),
    runPendingLlmReviews: uiAction(runPendingLlmReviews),
    loadLlmSettings: uiAction(loadLlmSettings),
    updateLlmSettings: uiAction(updateLlmSettings),
    deleteLlmKey: uiAction(deleteLlmKey),
    testLlmSettings: uiAction(testLlmSettings),
    loadCourseSchedules: uiAction(loadCourseSchedules),
    createCourseSchedule: uiAction(createCourseSchedule),
    deleteCourseScheduleSeries: uiAction(deleteCourseScheduleSeries),
    createFaculty: uiAction(createFaculty),
    createDepartment: uiAction(createDepartment),
    addUniversityEmailDomain: uiAction(addUniversityEmailDomain),
    loadDomainSuggestions: uiAction(loadDomainSuggestions),
    loadAcademicUnitSuggestions: uiAction(loadAcademicUnitSuggestions),
    approveAcademicUnitSuggestion: uiAction(approveAcademicUnitSuggestion),
    rejectAcademicUnitSuggestion: uiAction(rejectAcademicUnitSuggestion),
    createManualCalendar: uiAction(createManualCalendar),
    createPdfSource: uiAction(createPdfSource),
    processPdf: uiAction(processPdf),
    loadExtractedEvents: uiAction(loadExtractedEvents),
    approveEvent: uiAction(approveEvent),
    rejectEvent: uiAction(rejectEvent),
    createCalendarDraft: uiAction(createCalendarDraft),
    publishCalendar: uiAction(publishCalendar),
    rollbackCalendar: uiAction(rollbackCalendar),
    loadAudit: uiAction(loadAudit),
    exportAudit: uiAction(exportAudit),
    processDue: uiAction(processDue),
    loadFailed: uiAction(loadFailed),
    retryJob: uiAction(retryJob),
    loadDeliveries: uiAction(loadDeliveries),
    loadUsers: uiAction(loadUsers),
    updateUser: uiAction(updateUser),
    deleteUser: uiAction(deleteUser)
  };

  if (!hasToken) {
    if (authState.loading) {
      return (
        <main className="adminLoginShell">
          <section className="adminLoginPanel">
            <div className="brand loginBrand"><ShieldCheck size={22} /> Akademik Takvim Yönetimi</div>
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
          <div className="brand loginBrand"><ShieldCheck size={22} /> Akademik Takvim Yönetimi</div>
          <div className="sectionIntro">
            <h1>Admin Girişi</h1>
            <p>Yönetici hesabınızla giriş yapın. Bu panel mobil uygulamadan bağımsız çalışır.</p>
          </div>
          <form className="loginForm" onSubmit={loginAdmin}>
            <label>
              E-posta
              <input name="email" type="email" autoComplete="email" placeholder="admin@anssoft.com.tr" required />
            </label>
            <label>
              Şifre
              <input name="password" type="password" autoComplete="current-password" placeholder="Şifrenizi girin" required />
            </label>
            <button className="btn btn-primary" disabled={authState.loading}>
              <ShieldCheck size={18} /> Admin Paneline Gir
            </button>
          </form>
          {authState.loading && <PanelState kind="loading" text="Yönetici oturumu doğrulanıyor..." />}
          {authState.error && <PanelState kind="error" text={authState.error} />}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><ShieldCheck size={22} /> Akademik Takvim Yönetimi</div>
        <p className="sidebarTagline">Katalog, yayınlama, kullanıcılar ve bildirim güvenliği için operasyon merkezi.</p>
        <nav aria-label="Yönetici bölümleri">
          {visibleRoutes.map((route) => (
            <a
              key={route.id}
              href={`#/${route.id}`}
              className={renderedRoute === route.id ? "active" : ""}
              aria-current={renderedRoute === route.id ? "page" : undefined}
            >
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
            <button className="btn btn-secondary" type="button" onClick={logout}><LogOut size={18} /> Çıkış Yap</button>
          </div>
        </header>
        {message && (
          <div className="notice" role="status" aria-live="polite">
            <Check size={16} aria-hidden="true" />
            <span>{message}</span>
          </div>
        )}
        {actionError && <PanelState kind="error" text={actionError} />}
        {renderedRoute === "dashboard" && <DashboardPage {...pageProps} />}
        {renderedRoute === "inputs" && <InputsPage {...pageProps} />}
        {renderedRoute === "catalog" && <CatalogPage {...pageProps} />}
        {renderedRoute === "sources" && <AnnouncementSourcesPage {...pageProps} />}
        {renderedRoute === "pdf" && <PdfPage {...pageProps} />}
        {renderedRoute === "calendar" && <CalendarPage {...pageProps} />}
        {renderedRoute === "notifications" && <NotificationsPage {...pageProps} />}
        {renderedRoute === "audit" && <AuditPage {...pageProps} />}
        {renderedRoute === "users" && <UsersPage {...pageProps} />}
      </section>
    </main>
  );
}

function DashboardPage(props: any) {
  const canManageGlobalData = canManageGlobalAdminData(props.role);
  const tiles = [
    { route: "sources" as const, href: "#/sources", icon: <Rss size={20} />, title: "Duyuru Kaynakları", body: "Resmî duyuru, haber ve etkinlik sayfalarını ve yenileme sıklıklarını yönetin." },
    { route: "catalog" as const, href: "#/catalog", icon: <Building2 size={20} />, title: "Katalog", body: "Üniversiteleri oluşturup arşivleyin, fakülte ve bölümleri bağlayın." },
    { route: "inputs" as const, href: "#/inputs", icon: <Pencil size={20} />, title: "Girişler", body: canManageGlobalData ? "Üniversite, bölüm, e-posta alan adı ve manuel takvim satırları girin." : "Yetkili olduğunuz akademik birimler için ders programı satırlarını yönetin." },
    { route: "pdf" as const, href: "#/pdf", icon: <FileText size={20} />, title: "PDF İşlemleri", body: "Kaynak oluşturun, çıkarımı işleyin ve inceleme adaylarını onaylayın." },
    { route: "calendar" as const, href: "#/calendar", icon: <CalendarCheck size={20} />, title: "Yayınlama", body: "Onaylanan etkinlikleri öğrenciye açık takvim sürümlerine dönüştürün." },
    { route: "users" as const, href: "#/users", icon: <Users size={20} />, title: "Kullanıcılar", body: "Kullanıcı arayın, rolleri düzenleyin, hesapları kilitleyin veya kayıtları kaldırın." }
  ].filter((tile) => canAccessAdminRoute(props.role, tile.route));

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
            <h2><LayoutDashboard size={20} /> Geçerli Çalışma Alanı</h2>
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
  const canManageGlobalData = canManageGlobalAdminData(props.role);
  const [repeatWeekly, setRepeatWeekly] = useState(true);
  const courseScheduleSeries = new Map<string, { first: CourseScheduleEventRecord; count: number }>();
  for (const event of props.courseSchedules.data ?? []) {
    const key = event.scheduleSeriesId ?? event.id;
    const current = courseScheduleSeries.get(key);
    courseScheduleSeries.set(key, current ? { ...current, count: current.count + 1 } : { first: event, count: 1 });
  }

  return (
    <section className="pageStack">
      {canManageGlobalData && <>
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
          <input name="websiteUrl" type="url" placeholder="Resmî web sitesi" aria-label="Resmî web sitesi" />
          <input name="announcementUrl" type="url" placeholder="Üniversite duyuru adresi" aria-label="Üniversite duyuru adresi" />
          <input name="academicCalendarUrl" type="url" placeholder="Akademik takvim adresi" aria-label="Akademik takvim adresi" />
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
          <input name="universityId" value={props.universityId} onChange={(event) => props.setUniversityId(event.target.value)} placeholder="Üniversite ID" required aria-label="Fakülte için üniversite ID" />
          <input name="name" placeholder="Fakülte" required aria-label="Fakülte adı" />
          <input name="websiteUrl" type="url" placeholder="Fakülte web sitesi" aria-label="Fakülte web sitesi" />
          <input name="announcementUrl" type="url" placeholder="Duyuru adresi" aria-label="Fakülte duyuru adresi" />
          <button className="btn btn-primary" disabled={!props.hasToken}><Check size={18} /> Fakülte Ekle</button>
        </form>
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
          <input name="websiteUrl" type="url" placeholder="Bölüm web sitesi" aria-label="Bölüm web sitesi" />
          <input name="announcementUrl" type="url" placeholder="Duyuru adresi" aria-label="Bölüm duyuru adresi" />
          <input name="courseScheduleUrl" type="url" placeholder="Ders programı adresi" aria-label="Bölüm ders programı adresi" />
          <input name="examScheduleUrl" type="url" placeholder="Sınav programı adresi" aria-label="Bölüm sınav programı adresi" />
          <button className="btn btn-primary" disabled={!props.hasToken}><Check size={18} /> Bölüm Ekle</button>
        </form>
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <h2><Building2 size={20} /> Fakülte ve Bölüm İncelemesi</h2>
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

      </>}

      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <h2><BookOpen size={20} /> Ders Programı</h2>
            <p className="panelSub">Bir dersin ilk gününü, saatini ve yerini girin. Haftalık tekrar seçilirse dönem sonuna kadar oturumlar doğrudan öğrenci takviminde yayınlanır.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={() => props.loadCourseSchedules()} disabled={!props.hasToken || !props.departmentId || props.courseSchedules.loading}><RefreshCcw size={18} /> Programı Yükle</button>
        </div>
        <form className="gridForm scheduleForm" onSubmit={props.createCourseSchedule}>
          <select name="universityId" value={props.universityId} onChange={(event) => { props.setUniversityId(event.target.value); props.setFacultyId(""); props.setDepartmentId(""); if (event.target.value) void props.loadFaculties(event.target.value); }} required aria-label="Üniversite">
            <option value="">Üniversite seçin</option>
            {(props.universities.data ?? []).map((university: UniversityRecord) => <option value={university.id} key={university.id}>{university.name}</option>)}
          </select>
          <select name="facultyId" value={props.facultyId} onChange={(event) => { props.setFacultyId(event.target.value); props.setDepartmentId(""); if (event.target.value) void props.loadDepartments(event.target.value); }} required aria-label="Fakülte">
            <option value="">Fakülte seçin</option>
            {(props.faculties.data ?? []).map((faculty: FacultyRecord) => <option value={faculty.id} key={faculty.id}>{faculty.name}</option>)}
          </select>
          <select name="departmentId" value={props.departmentId} onChange={(event) => props.setDepartmentId(event.target.value)} required aria-label="Bölüm">
            <option value="">Bölüm seçin</option>
            {(props.departments.data ?? []).map((department: DepartmentRecord) => <option value={department.id} key={department.id}>{department.name}</option>)}
          </select>
          <input name="academicYear" placeholder="2026-2027" required aria-label="Akademik yıl" />
          <select name="term" defaultValue="fall" aria-label="Dönem"><option value="fall">Güz</option><option value="spring">Bahar</option><option value="summer">Yaz</option></select>
          <input name="title" placeholder="Ders başlığı" required aria-label="Ders başlığı" />
          <input name="courseName" placeholder="Ders kodu / tam adı" aria-label="Ders kodu veya tam adı" />
          <input name="location" placeholder="Derslik / yer" aria-label="Derslik veya yer" />
          <label className="fieldLabel">İlk ders günü<input name="startDate" type="date" required /></label>
          <label className="fieldLabel">Başlangıç<input name="startTime" type="time" defaultValue="09:00" required /></label>
          <label className="fieldLabel">Bitiş<input name="endTime" type="time" defaultValue="10:00" required /></label>
          <label className="fieldLabel">Tekrar sonu<input name="repeatUntil" type="date" required={repeatWeekly} disabled={!repeatWeekly} /></label>
          <label className="miniCheck"><input name="repeatWeekly" type="checkbox" checked={repeatWeekly} onChange={(event) => setRepeatWeekly(event.target.checked)} /> Haftalık tekrarla</label>
          <button className="btn btn-primary" disabled={!props.hasToken}><Save size={18} /> Dersi Yayınla</button>
        </form>
        {props.courseSchedules.loading && <PanelState kind="loading" text="Ders programı yükleniyor..." />}
        {props.courseSchedules.error && <PanelState kind="error" text={props.courseSchedules.error} />}
        <div className="table">
          {[...courseScheduleSeries.entries()].map(([seriesId, entry]) => (
            <div className="row courseSchedule" key={seriesId}>
              <span><strong>{entry.first.title}</strong>{entry.first.courseName ? ` · ${entry.first.courseName}` : ""}</span>
              <span>{new Date(entry.first.startDate).toLocaleString("tr-TR", { weekday: "long", hour: "2-digit", minute: "2-digit" })}</span>
              <span>{entry.first.location || "Yer belirtilmedi"}</span>
              <span>{entry.count} oturum</span>
              <button className="btn btn-danger" type="button" onClick={() => props.deleteCourseScheduleSeries(seriesId)} disabled={!entry.first.scheduleSeriesId}><Trash2 size={16} /> Kaldır</button>
            </div>
          ))}
        </div>
      </section>

      {canManageGlobalData && <section className="panel wide">
        <div className="panelHeader">
          <div>
            <h2><CalendarCheck size={20} /> Manuel Akademik Takvim</h2>
            <p className="panelSub">Elle girilen satırlardan taslak oluşturun. İncelemeden sonra Yayınla sayfasından yayınlayın.</p>
          </div>
        </div>
        <form className="manualCalendar" onSubmit={props.createManualCalendar}>
          <div className="toolbar four">
            <input name="universityId" value={props.universityId} onChange={(event) => props.setUniversityId(event.target.value)} placeholder="Üniversite ID" required aria-label="Manuel takvim üniversite ID" />
            <input name="academicYear" placeholder="2026-2027" required aria-label="Manuel takvim akademik yılı" />
            <input name="title" placeholder="Takvim başlığı" required aria-label="Manuel takvim başlığı" />
            <button className="btn btn-secondary" type="button" onClick={props.addManualEventRow}><Pencil size={18} /> Satır Ekle</button>
          </div>
          <div className="table">
            {props.manualEvents.map((row: any, index: number) => (
              <div className="row manualEvent" key={index}>
                <input value={row.title} onChange={(event) => props.updateManualEvent(index, "title", event.target.value)} placeholder="Etkinlik başlığı" required aria-label={`${index + 1}. etkinlik başlığı`} />
                <input value={row.courseName} onChange={(event) => props.updateManualEvent(index, "courseName", event.target.value)} placeholder="Ders adı / kodu" aria-label={`${index + 1}. etkinlik ders adı veya kodu`} />
                <input value={row.location} onChange={(event) => props.updateManualEvent(index, "location", event.target.value)} placeholder="Derslik / yer" aria-label={`${index + 1}. etkinlik yeri`} />
                <select value={row.category} onChange={(event) => props.updateManualEvent(index, "category", event.target.value)} aria-label={`${index + 1}. etkinlik kategorisi`}>
                  <option value="course_registration">{eventCategoryLabels.course_registration}</option>
                  <option value="course_add_drop">{eventCategoryLabels.course_add_drop}</option>
                  <option value="midterm_exam">{eventCategoryLabels.midterm_exam}</option>
                  <option value="final_exam">{eventCategoryLabels.final_exam}</option>
                  <option value="department_exam_schedule">{eventCategoryLabels.department_exam_schedule}</option>
                  <option value="summer_school_registration">{eventCategoryLabels.summer_school_registration}</option>
                  <option value="summer_school_start">{eventCategoryLabels.summer_school_start}</option>
                  <option value="holiday">{eventCategoryLabels.holiday}</option>
                  <option value="custom_event">{eventCategoryLabels.custom_event}</option>
                </select>
                <select value={row.term} onChange={(event) => props.updateManualEvent(index, "term", event.target.value)} aria-label={`${index + 1}. etkinlik dönemi`}>
                  <option value="fall">{termLabels.fall}</option>
                  <option value="spring">{termLabels.spring}</option>
                  <option value="summer">{termLabels.summer}</option>
                  <option value="full_year">{termLabels.full_year}</option>
                  <option value="unknown">{termLabels.unknown}</option>
                </select>
                <input type="date" value={row.startDate} onChange={(event) => props.updateManualEvent(index, "startDate", event.target.value)} required aria-label={`${index + 1}. etkinlik başlangıç tarihi`} />
                <input type="time" value={row.startTime} onChange={(event) => props.updateManualEvent(index, "startTime", event.target.value)} aria-label={`${index + 1}. etkinlik başlangıç saati`} />
                <input type="date" value={row.endDate} onChange={(event) => props.updateManualEvent(index, "endDate", event.target.value)} aria-label={`${index + 1}. etkinlik bitiş tarihi`} />
                <input type="time" value={row.endTime} onChange={(event) => props.updateManualEvent(index, "endTime", event.target.value)} aria-label={`${index + 1}. etkinlik bitiş saati`} />
                <input type="date" value={row.repeatUntil} onChange={(event) => props.updateManualEvent(index, "repeatUntil", event.target.value)} disabled={!row.repeatWeekly} aria-label={`${index + 1}. etkinlik haftalık tekrar bitişi`} />
                <input value={row.facultyId} onChange={(event) => props.updateManualEvent(index, "facultyId", event.target.value)} placeholder="Fakülte ID" aria-label={`${index + 1}. etkinlik fakülte ID`} />
                <input value={row.departmentId} onChange={(event) => props.updateManualEvent(index, "departmentId", event.target.value)} placeholder="Bölüm ID" aria-label={`${index + 1}. etkinlik bölüm ID`} />
                <label className="miniCheck"><input type="checkbox" checked={row.offset7} onChange={(event) => props.updateManualEvent(index, "offset7", event.target.checked)} /> 7 gün</label>
                <label className="miniCheck"><input type="checkbox" checked={row.offset1} onChange={(event) => props.updateManualEvent(index, "offset1", event.target.checked)} /> 1 gün</label>
                <label className="miniCheck"><input type="checkbox" checked={row.repeatWeekly} onChange={(event) => props.updateManualEvent(index, "repeatWeekly", event.target.checked)} /> Haftalık</label>
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={() => props.removeManualEventRow(index)}
                  disabled={props.manualEvents.length === 1}
                  aria-label={`${index + 1}. etkinlik satırını kaldır`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" disabled={!props.hasToken}><Save size={18} /> Manuel Taslak Oluştur</button>
        </form>
      </section>}
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
          <div className="panelHeaderActions">
            {canManageGlobalAdminData(props.role) && (
              <button className="btn btn-secondary" type="button" onClick={props.syncVerifiedCatalogSources} disabled={!props.hasToken || props.universities.loading}>
                <ShieldCheck size={18} /> Doğrulanmış Adresleri Eşitle
              </button>
            )}
            <button className="btn btn-secondary" type="button" onClick={props.loadUniversities} title="Yenile" disabled={!props.hasToken || props.universities.loading}>
              <RefreshCcw size={18} /> Yenile
            </button>
          </div>
        </div>
        <form className="gridForm sourceForm" onSubmit={props.createUniversity}>
          <input name="name" placeholder="Üniversite" required aria-label="Üniversite adı" />
          <input name="city" placeholder="Şehir" required aria-label="Üniversite şehri" />
          <select name="type" defaultValue="state" aria-label="Üniversite türü">
            <option value="state">{universityTypeLabels.state}</option>
            <option value="foundation">{universityTypeLabels.foundation}</option>
            <option value="private">{universityTypeLabels.private}</option>
          </select>
          <input name="websiteUrl" type="url" placeholder="Resmî web sitesi" aria-label="Resmî web sitesi" />
          <input name="announcementUrl" type="url" placeholder="Duyuru sayfası adresi" aria-label="Duyuru sayfası adresi" />
          <input name="academicCalendarUrl" type="url" placeholder="Akademik takvim adresi" aria-label="Akademik takvim adresi" />
          <button className="btn btn-primary" disabled={!props.hasToken || props.universities.loading}><Check size={18} /> Oluştur</button>
        </form>
        {props.universities.loading && <PanelState kind="loading" text="Üniversiteler yükleniyor..." />}
        {props.universities.error && <PanelState kind="error" text={props.universities.error} />}
        {!props.universities.loading && !props.universities.error && (props.universities.data?.length ?? 0) === 0 && <PanelState kind="empty" text="Henüz üniversite kaydı yok." />}
        <div className="table">
          {(props.universities.data ?? []).map((university: UniversityRecord) => (
            <div className="catalogRecord" key={university.id}>
              <div className="row catalog">
                <span>{university.name}</span>
                <span>{university.city}</span>
                <span className="statusBadge">{statusLabels[university.status as AdminUserRecord["status"]] ?? university.status}</span>
                <button className="btn btn-secondary" type="button" onClick={() => { props.setUniversityId(university.id); props.setFacultyId(""); props.setDepartmentId(""); void props.loadFaculties(university.id); }} disabled={!props.hasToken || props.faculties.loading}>
                  <BookOpen size={16} /> Fakülteler
                </button>
                <button className="btn btn-danger" type="button" onClick={() => void props.archiveUniversity(university.id)} disabled={!props.hasToken}>
                  <Archive size={16} /> Arşivle
                </button>
              </div>
              <CatalogUrlEditor
                entries={[
                  ["websiteUrl", "Web sitesi", university.websiteUrl],
                  ["announcementUrl", "Duyuru", university.announcementUrl],
                  ["academicCalendarUrl", "Akademik takvim", university.academicCalendarUrl]
                ]}
                disabled={!props.hasToken}
                onSubmit={(event) => props.updateCatalogSourceUrls(event, "university", university.id)}
              />
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
          <input name="websiteUrl" type="url" placeholder="Fakülte web sitesi" aria-label="Fakülte web sitesi" />
          <input name="announcementUrl" type="url" placeholder="Duyuru adresi" aria-label="Fakülte duyuru adresi" />
          <button className="btn btn-primary" disabled={!props.hasToken}><Check size={18} /> Fakülte Ekle</button>
        </form>
        {props.faculties.loading && <PanelState kind="loading" text="Fakülteler yükleniyor..." />}
        {props.faculties.error && <PanelState kind="error" text={props.faculties.error} />}
        <div className="chips">{(props.faculties.data ?? []).map((faculty: FacultyRecord) => <button className="btn btn-chip" type="button" key={faculty.id} onClick={() => { props.setFacultyId(faculty.id); props.setDepartmentId(""); void props.loadDepartments(faculty.id); }}>{faculty.name}</button>)}</div>
        <div className="catalogUnitList">
          {(props.faculties.data ?? []).map((faculty: FacultyRecord) => (
            <article className={`catalogUnitCard ${props.facultyId === faculty.id ? "selected" : ""}`} key={faculty.id}>
              <div className="catalogUnitHeading"><strong>{faculty.name}</strong><span>{faculty.id}</span></div>
              <CatalogUrlList
                fieldNames={["websiteUrl", "announcementUrl"]}
                disabled={!props.hasToken}
                onSubmit={(event) => props.updateCatalogSourceUrls(event, "faculty", faculty.id, faculty.universityId ?? props.universityId)}
                entries={[
                ["Web sitesi", faculty.websiteUrl],
                ["Duyuru", faculty.announcementUrl],
                ["Ders programı", faculty.courseScheduleUrl],
                ["Sınav programı", faculty.examScheduleUrl]
              ]} />
            </article>
          ))}
        </div>
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
          <input name="websiteUrl" type="url" placeholder="Bölüm web sitesi" aria-label="Bölüm web sitesi" />
          <input name="announcementUrl" type="url" placeholder="Duyuru adresi" aria-label="Bölüm duyuru adresi" />
          <input name="courseScheduleUrl" type="url" placeholder="Ders programı adresi" aria-label="Bölüm ders programı adresi" />
          <input name="examScheduleUrl" type="url" placeholder="Sınav programı adresi" aria-label="Bölüm sınav programı adresi" />
          <button className="btn btn-primary" disabled={!props.hasToken}><Check size={18} /> Bölüm Ekle</button>
        </form>
        {props.departments.loading && <PanelState kind="loading" text="Bölümler yükleniyor..." />}
        {props.departments.error && <PanelState kind="error" text={props.departments.error} />}
        {!props.departments.loading && !props.departments.error && props.facultyId && (props.departments.data?.length ?? 0) === 0 && <PanelState kind="empty" text="Bu fakülte için bölüm bulunamadı." />}
        <div className="catalogUnitList departmentCatalogList">
          {(props.departments.data ?? []).map((department: DepartmentRecord) => (
            <article className="catalogUnitCard" key={department.id}>
              <div className="catalogUnitHeading"><strong>{department.name}</strong><span>{department.id}</span></div>
              <CatalogUrlList
                fieldNames={["websiteUrl", "announcementUrl", "courseScheduleUrl", "examScheduleUrl"]}
                disabled={!props.hasToken}
                onSubmit={(event) => props.updateCatalogSourceUrls(event, "department", department.id, department.facultyId ?? props.facultyId)}
                entries={[
                ["Web sitesi", department.websiteUrl],
                ["Duyuru", department.announcementUrl],
                ["Ders programı", department.courseScheduleUrl],
                ["Sınav programı", department.examScheduleUrl]
              ]} />
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function CatalogUrlEditor(props: {
  entries: Array<[string, string, string | undefined]>;
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <CatalogUrlList
      entries={props.entries.map(([, label, url]) => [label, url])}
      fieldNames={props.entries.map(([name]) => name)}
      disabled={props.disabled}
      onSubmit={props.onSubmit}
    />
  );
}

function CatalogUrlList(props: {
  entries: Array<[string, string | undefined]>;
  fieldNames: string[];
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="catalogUrlEditor" onSubmit={props.onSubmit}>
      {props.entries.slice(0, props.fieldNames.length).map(([label, url], index) => (
        <label className="fieldLabel" key={props.fieldNames[index]!}>{label}
          <input name={props.fieldNames[index]!} type="url" defaultValue={url ?? ""} placeholder="https://..." aria-label={`${label} adresi`} />
          {url ? <a className="catalogUrlOpen" href={url} target="_blank" rel="noreferrer">Mevcut adresi aç</a> : <span className="missingUrl">Bulunamadı</span>}
        </label>
      ))}
      <button className="btn btn-secondary" disabled={props.disabled}><Save size={16} /> Adresleri Kaydet</button>
      <span className="inlineHint">Boş bırakılan adres kaldırılır.</span>
    </form>
  );
}

function CatalogUrlDisplay({ entries }: { entries: Array<[string, string | undefined]> }) {
  return (
    <dl className="catalogUrlList">
      {entries.map(([label, url]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{url ? <a href={url} target="_blank" rel="noreferrer">{url}</a> : <span className="missingUrl">Bulunamadı</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function SourceCoveragePanel(props: any) {
  const [searchDraft, setSearchDraft] = useState(props.sourceCoverageQuery.search);
  const query = props.sourceCoverageQuery as SourceCoverageQuery;
  const response = props.sourceCoverage.data as SourceCoverageResponse | undefined;
  const sourceLabels: Record<SourceCoverageType, string> = {
    homepage: "Web sitesi",
    announcement: "Duyuru",
    news: "Haber",
    event: "Etkinlik",
    academic_calendar: "Akademik takvim",
    course_schedule: "Ders programı",
    exam_schedule: "Sınav programı"
  };
  const resolutionLabels: Record<SourceCoverageResolution, string> = {
    missing: "Eksik",
    quarantined: "Karantinada",
    verified: "Final doğrulandı",
    legacy_unverified: "Kanıtsız eski kayıt"
  };
  const setSelection = (item: SourceCoverageItem) => {
    props.setUniversityId(item.universityId);
    props.setFacultyId(item.facultyId);
    props.setDepartmentId(item.departmentId ?? "");
    void props.loadFaculties(item.universityId);
    if (item.facultyId) void props.loadDepartments(item.facultyId);
  };
  return (
    <section className="panel wide sourceCoveragePanel">
      <div className="panelHeader">
        <div>
          <h2><AlertTriangle size={20} /> Eksik / Çözülemeyen Kaynaklar</h2>
          <p className="panelSub">17.360 akademik birimin web, içerik, üniversite akademik takvimi ve program kaynaklarını ayrı gösterir. Eski URL, final crawler kanıtı yoksa doğrulanmış sayılmaz.</p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => props.loadSourceCoverage()} disabled={!props.hasToken || props.sourceCoverage.loading}>
          <RefreshCcw size={18} /> Yenile
        </button>
      </div>
      <form className="coverageFilters" onSubmit={(event) => { event.preventDefault(); void props.loadSourceCoverage({ search: searchDraft, offset: 0 }); }}>
        <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={200} placeholder="Üniversite, fakülte, bölüm veya ID ara" aria-label="Kaynak kapsamında ara" />
        <select value={query.universityId} onChange={(event) => void props.loadSourceCoverage({ universityId: event.target.value, offset: 0 })} aria-label="Kapsam üniversitesi">
          <option value="">Tüm üniversiteler</option>
          {(props.universities.data ?? []).map((university: UniversityRecord) => <option key={university.id} value={university.id}>{university.name}</option>)}
        </select>
        <select value={query.scopeType} onChange={(event) => void props.loadSourceCoverage({ scopeType: event.target.value, offset: 0 })} aria-label="Akademik birim türü">
          <option value="">Fakülte + bölüm</option><option value="faculty">Fakülte</option><option value="department">Bölüm</option>
        </select>
        <select value={query.sourceType} onChange={(event) => void props.loadSourceCoverage({ sourceType: event.target.value, offset: 0 })} aria-label="Kaynak türü">
          <option value="">Tüm kaynak türleri</option>
          {(Object.entries(sourceLabels) as Array<[SourceCoverageType, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={query.resolution} onChange={(event) => void props.loadSourceCoverage({ resolution: event.target.value, offset: 0 })} aria-label="Kaynak çözüm durumu">
          <option value="">Tüm durumlar</option>
          {(Object.entries(resolutionLabels) as Array<[SourceCoverageResolution, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button className="btn btn-secondary"><Eye size={16} /> Filtrele</button>
      </form>
      {response && (
        <div className="coverageSummary" aria-label="Kaynak kapsamı özeti">
          <span><strong>{response.summary.catalog.universities.toLocaleString("tr-TR")}</strong> üniversite</span>
          <span><strong>{response.summary.catalog.academicUnits.toLocaleString("tr-TR")}</strong> birim</span>
          <span><strong>{response.summary.byResolution.missing.toLocaleString("tr-TR")}</strong> eksik</span>
          <span><strong>{response.summary.byResolution.quarantined.toLocaleString("tr-TR")}</strong> karantina</span>
          <span><strong>{response.summary.byResolution.legacy_unverified.toLocaleString("tr-TR")}</strong> kanıtsız</span>
          <span><strong>{response.summary.byResolution.verified.toLocaleString("tr-TR")}</strong> doğrulandı</span>
        </div>
      )}
      {props.sourceCoverage.loading && <PanelState kind="loading" text="115.656 kaynak yuvasından filtrelenen sayfa hazırlanıyor..." />}
      {props.sourceCoverage.error && <PanelState kind="error" text={props.sourceCoverage.error} />}
      {!props.sourceCoverage.loading && !props.sourceCoverage.error && response?.items.length === 0 && <PanelState kind="empty" text="Bu filtrede kaynak kaydı yok." />}
      <div className="coverageList">
        {(response?.items ?? []).map((item) => (
          <article className="coverageItem" key={item.id}>
            <div>
              <strong>{item.universityName}</strong>
              <span>{item.facultyName}{item.departmentName ? ` · ${item.departmentName}` : ""}</span>
              <code>{item.scopeId}</code>
            </div>
            <div><span>{sourceLabels[item.sourceType]}</span><span className={`statusBadge coverage-${item.resolution}`}>{resolutionLabels[item.resolution]}</span></div>
            <div className="coverageReason">
              {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a> : <span>{item.quarantineReason ?? item.missingReason ?? item.legacyReason ?? "Kaynak yok"}</span>}
              {item.finalRevalidatedAt && <small>Final kontrol: {new Date(item.finalRevalidatedAt).toLocaleString("tr-TR")}</small>}
              {item.inheritedFromScopeType && (
                <small>
                  {item.sourceType === "academic_calendar" && item.publicationScope === "university_system"
                    ? "Üniversite geneli akademik takvimden devralındı"
                    : `${item.inheritedFromScopeType} kapsamından paylaşıldı`}
                </small>
              )}
            </div>
            <button className="btn btn-secondary" type="button" onClick={() => setSelection(item)}><Pencil size={16} /> Düzeltme kapsamını seç</button>
          </article>
        ))}
      </div>
      {response && response.total > 0 && (
        <div className="reviewPagination">
          <button className="btn btn-secondary" type="button" disabled={query.offset === 0 || props.sourceCoverage.loading} onClick={() => props.loadSourceCoverage({ offset: Math.max(0, query.offset - query.limit) })}>Önceki</button>
          <span>{(query.offset + 1).toLocaleString("tr-TR")}–{Math.min(query.offset + query.limit, response.total).toLocaleString("tr-TR")} / {response.total.toLocaleString("tr-TR")}</span>
          <button className="btn btn-secondary" type="button" disabled={query.offset + query.limit >= response.total || props.sourceCoverage.loading} onClick={() => props.loadSourceCoverage({ offset: query.offset + query.limit })}>Sonraki</button>
        </div>
      )}
    </section>
  );
}

const scheduleLifecycleLabels: Record<AcademicUnitScheduleSourceRecord["lifecycle"], string> = {
  ready: "Alıma hazır",
  processing: "İşleniyor",
  review_required: "İnsan incelemesi gerekli",
  quarantined: "Tanım sapması karantinası",
  materializing: "Sahneleniyor",
  staged: "Yayın bekliyor",
  published: "Yayınlandı",
  rejected: "Reddedildi",
  disabled: "Devre dışı"
};

function ScheduleReviewPanel(props: any) {
  const sources = (props.scheduleReviewSources.data ?? []) as AcademicUnitScheduleSourceRecord[];
  const query = props.scheduleReviewSourcesQuery as AcademicUnitScheduleSourcesQuery;
  return (
    <section className="panel wide scheduleReviewPanel">
      <div className="panelHeader">
        <div>
          <h2><CalendarCheck size={20} /> Ders / Sınav Programı İncelemesi</h2>
          <p className="panelSub">Ayrıştırılan bölüm satırlarını düzeltin ve seçin. Onay, satırları yalnızca sahneler; öğrenci yayını süper yönetici eylemi olmadan açılmaz.</p>
        </div>
        <div className="sourceActions">
          {canManageGlobalAdminData(props.role) && <button className="btn btn-secondary" type="button" onClick={props.provisionScheduleReviewSources}><ShieldCheck size={16} /> Program Kaynaklarını Hazırla</button>}
          <button className="btn btn-secondary" type="button" onClick={() => props.loadScheduleReviewSources({})} disabled={props.scheduleReviewSources.loading}><RefreshCcw size={16} /> Program Kuyruğunu Yenile</button>
        </div>
      </div>
      <div className="reviewFilters" aria-label="Program inceleme filtreleri">
        <label className="fieldLabel">Üniversite
          <select value={query.universityId} onChange={(event) => props.loadScheduleReviewSources({ universityId: event.target.value, offset: 0 })}>
            <option value="">Tüm üniversiteler</option>
            {(props.universities.data ?? []).map((university: UniversityRecord) => <option key={university.id} value={university.id}>{university.name}</option>)}
          </select>
        </label>
        <label className="fieldLabel">Program türü
          <select value={query.scheduleType} onChange={(event) => props.loadScheduleReviewSources({ scheduleType: event.target.value, offset: 0 })}>
            <option value="">Tüm program türleri</option>
            <option value="course_schedule">Ders programı</option>
            <option value="exam_schedule">Sınav programı</option>
          </select>
        </label>
        <label className="fieldLabel">Program durumu
          <select value={query.lifecycle} onChange={(event) => props.loadScheduleReviewSources({ lifecycle: event.target.value, offset: 0 })}>
            <option value="">Tüm durumlar</option>
            {(Object.entries(scheduleLifecycleLabels) as Array<[AcademicUnitScheduleSourceRecord["lifecycle"], string]>).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <button className="btn btn-secondary" type="button" onClick={() => props.loadScheduleReviewSources({ universityId: "", scheduleType: "", lifecycle: "", offset: 0 })} disabled={props.scheduleReviewSources.loading}>Filtreleri Temizle</button>
      </div>
      {props.scheduleReviewSources.loading && <PanelState kind="loading" text="Program inceleme kuyruğu yükleniyor..." />}
      {props.scheduleReviewSources.error && <PanelState kind="error" text={props.scheduleReviewSources.error} />}
      {!props.scheduleReviewSources.loading && !props.scheduleReviewSources.error && sources.length === 0 && <PanelState kind="empty" text="Henüz ders veya sınav programı kaynağı yok." />}
      <div className="scheduleReviewList">
        {sources.map((source) => <ScheduleReviewCard key={`${source.id}:${source.revision}`} source={source} {...props} />)}
      </div>
      {!props.scheduleReviewSources.loading && !props.scheduleReviewSources.error && (sources.length > 0 || query.offset > 0) && (
        <div className="reviewPagination">
          <button className="btn btn-secondary" type="button" disabled={query.offset === 0} onClick={() => props.loadScheduleReviewSources({ offset: Math.max(0, query.offset - query.limit) })}>Önceki</button>
          <span>{(query.offset + 1).toLocaleString("tr-TR")}–{(query.offset + sources.length).toLocaleString("tr-TR")} arası program kaynağı</span>
          <button className="btn btn-secondary" type="button" disabled={!props.scheduleReviewSourcesHasMore} onClick={() => props.loadScheduleReviewSources({ offset: query.offset + query.limit })}>Sonraki</button>
        </div>
      )}
    </section>
  );
}

function ScheduleReviewCard(props: any) {
  const source = props.source as AcademicUnitScheduleSourceRecord;
  const candidates = source.reviewResult?.candidates ?? [];
  const canReview = source.lifecycle === "review_required" && source.reviewResult?.outcome === "parsed_pending_review";
  const publicationInProgress = source.lifecycle === "published" && source.reviewDecision?.materializationStatus === "publishing";
  const currentYear = new Date().getFullYear();
  return (
    <article className="scheduleReviewCard">
      <header className="scheduleReviewHeader">
        <div>
          <strong>{source.scheduleType === "course_schedule" ? "Ders programı" : "Sınav programı"}</strong>
          <span>{source.universityId} · {source.facultyId} · {source.departmentId}</span>
          <a href={source.verifiedFinalUrl} target="_blank" rel="noreferrer">{source.verifiedFinalUrl}</a>
        </div>
        <div className="scheduleReviewStatus">
          <span className={`statusBadge schedule-${publicationInProgress ? "publishing" : source.lifecycle}`}>
            {publicationInProgress ? "Yayınlanıyor" : scheduleLifecycleLabels[source.lifecycle]}
          </span>
          <span>Revision {source.revision}</span>
        </div>
      </header>
      {source.reviewResult && (
        <p className="inlineHint">
          <ShieldCheck size={16} /> {source.reviewResult.format.toUpperCase()} · {source.reviewResult.candidateCount} aday · {source.reviewResult.outcome}
          {source.reviewResult.reasonCode ? ` · ${source.reviewResult.reasonCode}` : ""}
        </p>
      )}
      {source.lifecycle === "quarantined" && <p className="sourceError">İndirilen son adres doğrulanmış kayıt tanımıyla eşleşmiyor. Bu kayıt onaylanamaz; kaynak yeniden doğrulanmalıdır.</p>}
      {canManageGlobalAdminData(props.role) && ["ready", "review_required", "quarantined", "rejected"].includes(source.lifecycle) && (
        <button className="btn btn-secondary" type="button" onClick={() => props.ingestScheduleReviewSource(source)}><RefreshCcw size={16} /> Kaynağı Ayrıştır</button>
      )}
      {candidates.length > 0 && (
        <div className="scheduleCandidateList">
          {candidates.map((candidate) => (
            <form className="scheduleCandidateEditor" key={candidate.rowNumber} onSubmit={(event) => props.updateScheduleCandidate(event, source, candidate)}>
              <div className="scheduleCandidateRaw"><strong>Satır {candidate.rowNumber}</strong><span>{candidate.rawText}</span></div>
              <input name="title" defaultValue={candidate.title ?? ""} maxLength={240} placeholder="Başlık / ders" aria-label={`${candidate.rowNumber}. satır başlığı`} disabled={!canReview} />
              <input name="date" type="date" defaultValue={candidate.date ?? ""} aria-label={`${candidate.rowNumber}. satır tarihi`} disabled={!canReview} />
              <select name="dayOfWeek" defaultValue={candidate.dayOfWeek ?? ""} aria-label={`${candidate.rowNumber}. satır günü`} disabled={!canReview}>
                <option value="">Gün yok</option><option value="1">Pazartesi</option><option value="2">Salı</option><option value="3">Çarşamba</option><option value="4">Perşembe</option><option value="5">Cuma</option><option value="6">Cumartesi</option><option value="0">Pazar</option>
              </select>
              <input name="startTime" type="time" defaultValue={candidate.startTime ?? ""} aria-label={`${candidate.rowNumber}. satır başlangıç saati`} disabled={!canReview} />
              <input name="endTime" type="time" defaultValue={candidate.endTime ?? ""} aria-label={`${candidate.rowNumber}. satır bitiş saati`} disabled={!canReview} />
              <input name="location" defaultValue={candidate.location ?? ""} maxLength={240} placeholder="Konum" aria-label={`${candidate.rowNumber}. satır konumu`} disabled={!canReview} />
              {canReview && <button className="btn btn-secondary" type="submit"><Save size={16} /> Satırı Kaydet</button>}
            </form>
          ))}
        </div>
      )}
      {canReview && (
        <div className="scheduleDecisionGrid">
          <form className="scheduleApprovalForm" onSubmit={(event) => props.reviewScheduleSource(event, source, "approve")}>
            <strong>Sahnelenecek satırlar</strong>
            <p className="inlineHint">Önce aynı akademik yıl için standart takvimi yayınlayın; program satırları yalnız bu yayınlanmış takvime sahnelenir.</p>
            <div className="scheduleCandidateSelection">
              {candidates.map((candidate) => <label key={candidate.rowNumber}><input type="checkbox" name="approvedRowNumbers" value={candidate.rowNumber} defaultChecked /> Satır {candidate.rowNumber}</label>)}
            </div>
            <input name="academicYear" defaultValue={`${currentYear}-${currentYear + 1}`} pattern="\d{4}-\d{4}" required aria-label="Program akademik yılı" />
            <select name="term" defaultValue="fall" required aria-label="Program dönemi"><option value="fall">Güz</option><option value="spring">Bahar</option><option value="summer">Yaz</option><option value="full_year">Tüm yıl</option><option value="unknown">Bilinmiyor</option></select>
            {source.scheduleType === "course_schedule" && <><label className="fieldLabel">Ders başlangıç tarihi<input name="courseRangeStart" type="date" required /></label><label className="fieldLabel">Ders bitiş tarihi<input name="courseRangeEnd" type="date" required /></label></>}
            <button className="btn btn-primary" type="submit"><Check size={16} /> Seçilenleri Onayla ve Sahnele</button>
          </form>
          <form className="scheduleRejectForm" onSubmit={(event) => props.reviewScheduleSource(event, source, "reject")}>
            <textarea name="reason" maxLength={500} placeholder="Red gerekçesi" aria-label="Program red gerekçesi" />
            <button className="btn btn-danger" type="submit"><X size={16} /> Programı Reddet</button>
          </form>
        </div>
      )}
      {source.reviewDecision?.calendarId && <p className="inlineHint"><CalendarCheck size={16} /> Takvim: {source.reviewDecision.calendarId} · {source.reviewDecision.approvedRowNumbers.length} onaylı, {source.reviewDecision.rejectedRowNumbers.length} dışlanan satır</p>}
      {["materializing", "staged"].includes(source.lifecycle) && canManageGlobalAdminData(props.role) && (
        <button className="btn btn-secondary" type="button" onClick={() => props.reopenScheduleReviewSource(source)}><RotateCcw size={16} /> İncelemeye Geri Aç</button>
      )}
      {(source.lifecycle === "staged" || publicationInProgress) && canManageGlobalAdminData(props.role) && (
        <button className="btn btn-primary" type="button" onClick={() => props.publishScheduleReviewSource(source)}><ShieldCheck size={16} /> Sahnelenen Programı Yayınla</button>
      )}
    </article>
  );
}

const universityContentSourceTypes: UniversityContentSourceType[] = ["announcement", "news", "event", "academic_calendar"];

function UniversitySourceWorkbench(props: any) {
  const [search, setSearch] = useState("");
  const [selectedUniversityId, setSelectedUniversityId] = useState("");
  const response = props.sourceProfiles.data as UniversitySourceProfilesResponse | undefined;
  const universities = response?.universities ?? [];
  const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR");
  const filteredUniversities = universities.filter((university) => !normalizedSearch
    || `${university.universityName}\u0000${university.city ?? ""}\u0000${university.universityId}`.toLocaleLowerCase("tr-TR").includes(normalizedSearch));
  const selectedUniversity = universities.find((university) => university.universityId === selectedUniversityId);

  return (
    <section className="panel wide universitySourceWorkbench" aria-label="208 üniversite kaynak çalışma alanı">
      <div className="panelHeader">
        <div>
          <h2><Building2 size={20} /> 208 Üniversite Kaynak Haritası</h2>
          <p className="panelSub">Üniversiteyi seçin; çekilen URL'yi, site yapısını, parserı ve son test sonucunu tek yerde görün ve değiştirin.</p>
        </div>
        <div className="sourceActions">
          {response && <span className="statusBadge">{response.summary.returnedUniversities.toLocaleString("tr-TR")} üniversite · {response.summary.returnedSourceSlots.toLocaleString("tr-TR")} kaynak alanı</span>}
          <button className="btn btn-secondary" type="button" onClick={props.loadSourceProfiles} disabled={props.sourceProfiles.loading}><RefreshCcw size={16} /> Haritayı Yenile</button>
        </div>
      </div>
      {props.sourceProfiles.loading && <PanelState kind="loading" text="208 üniversite ve 832 kaynak alanı yükleniyor..." />}
      {props.sourceProfiles.error && <PanelState kind="error" text={props.sourceProfiles.error} />}
      {!props.sourceProfiles.loading && !props.sourceProfiles.error && universities.length === 0 && <PanelState kind="empty" text="Üniversite kaynak envanteri bulunamadı." />}
      {universities.length > 0 && (
      <div className="universitySourceLayout">
        <aside className="universityPicker" aria-label="Üniversite listesi">
          <label className="fieldLabel">Üniversite ara
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ad, şehir veya ID" maxLength={160} aria-label="208 üniversitede ara" />
          </label>
          <span className="universityPickerCount">{filteredUniversities.length.toLocaleString("tr-TR")} / {universities.length.toLocaleString("tr-TR")}</span>
          <div className="universityPickerList">
            {filteredUniversities.map((university) => (
              <button
                className={`universityPickerItem ${selectedUniversity?.universityId === university.universityId ? "selected" : ""}`}
                type="button"
                key={university.universityId}
                aria-pressed={selectedUniversity?.universityId === university.universityId}
                onClick={() => setSelectedUniversityId(university.universityId)}
              >
                <strong>{university.universityName}</strong>
                <span>{university.city ?? "Şehir belirtilmedi"} · {university.universityId}</span>
              </button>
            ))}
          </div>
        </aside>
        <div className="universitySourceDetail">
          {!selectedUniversity && <PanelState kind="empty" text="Kaynak yapısını görmek için soldan bir üniversite seçin." />}
          {selectedUniversity && (
            <>
              <header className="selectedUniversityHeader">
                <div><strong>{selectedUniversity.universityName}</strong><span>{selectedUniversity.city ?? "Şehir belirtilmedi"} · {selectedUniversity.universityId}</span></div>
                {selectedUniversity.authority.homepageUrl && <a href={selectedUniversity.authority.homepageUrl} target="_blank" rel="noreferrer">Resmî siteyi aç</a>}
              </header>
              <div className="universitySourceCards">
                {universityContentSourceTypes.map((contentType) => {
                  const slot = selectedUniversity.slots.find((candidate) => candidate.contentType === contentType);
                  return slot
                    ? <UniversitySourceProfileCard key={contentType} university={selectedUniversity} slot={slot} {...props} />
                    : <PanelState key={contentType} kind="error" text={`${contentType} kaynak alanı envanterde eksik.`} />;
                })}
              </div>
            </>
          )}
        </div>
      </div>
      )}
    </section>
  );
}

function UniversitySourceProfileCard(props: any) {
  const university = props.university as UniversitySourceProfile;
  const slot = props.slot as UniversitySourceProfileSlot;
  const label = slot.contentType === "academic_calendar" ? "Akademik Takvim" : contentTypeLabels[slot.contentType];
  const previewKey = `${university.universityId}\u0000${slot.contentType}`;
  const preview = (props.sourceTestPreviews as Record<string, AnnouncementSourcePreview>)[previewKey];
  const configured = slot.contentType === "academic_calendar" ? slot.trustStatus === "configured" : Boolean(slot.sourceId);
  const displayedUrl = slot.sourceUrl ?? slot.suggestedUrl ?? slot.candidateUrl ?? "";
  const lastTestLabel = slot.lastTest.checkedAt
    ? `${new Date(slot.lastTest.checkedAt).toLocaleString("tr-TR")} · ${slot.lastTest.itemCount ?? 0} içerik`
    : "Henüz test edilmedi";
  return (
    <article className="universitySourceCard" data-source-type={slot.contentType}>
      <header>
        <strong>{label}</strong>
        <span className={`statusBadge status-${slot.lastTest.status}`}>{slot.lastTest.status === "not_tested" ? "Test edilmedi" : sourceHealthLabels[slot.lastTest.status as keyof typeof sourceHealthLabels] ?? slot.lastTest.status}</span>
      </header>
      <form
        className="universitySourceForm"
        key={`${university.universityId}:${slot.contentType}:${displayedUrl}:${JSON.stringify(slot.parserConfig ?? {})}`}
        onSubmit={(event) => props.saveUniversitySourceProfile(event, university.universityId, slot.contentType)}
      >
        <input type="hidden" name="sourceName" value={slot.sourceName ?? `${university.universityName} ${label}`} />
        <div className="sourceCardStatus">
          <span className={`statusBadge trust-${slot.trustStatus}`}>{slot.trustStatus === "configured" ? "Yapılandırıldı" : sourceTrustLabels[slot.trustStatus] ?? slot.trustStatus}</span>
          <span className="statusBadge">{slot.sourceStatus === "source_found" ? "URL bulundu" : "Ana sayfa adayı"}</span>
        </div>
        {!configured && <p className="inlineHint">Bu alan henüz kaydedilmemiş. Gösterilen adres {slot.sourceStatus === "source_found" ? "bulunan kaynak adayıdır" : "resmî ana sayfa adayıdır"}; düzeltip Kaydet'e basın.</p>}
        <label className="fieldLabel">Çekilen URL
          <input name="sourceUrl" type="url" defaultValue={displayedUrl} placeholder="https://..." required aria-label={`${label} çekilen URL`} />
        </label>
        <label className="fieldLabel">Parser
          <select name="parser" defaultValue={slot.parser} aria-label={`${label} parser`}><option value="auto">Otomatik</option><option value="rss">RSS / Atom</option><option value="html">HTML</option></select>
        </label>
        <SourceParserConfigFields label={label} config={slot.parserConfig} />
        <label className="fieldLabel">Çalışma durumu
          <select name="status" defaultValue={slot.status === "active" ? "active" : "inactive"} aria-label={`${label} çalışma durumu`}><option value="inactive">Pasif</option><option value="active">Aktif</option></select>
        </label>
        <dl className="sourceStructure">
          <div><dt>Site / çekme yapısı</dt><dd>{slot.siteStructure.description ?? `${label} liste sayfası otomatik ayrıştırılır.`}</dd></div>
          <div><dt>Teknik akış</dt><dd>{slot.siteStructure.detectedFormat ?? "auto"} · {slot.siteStructure.extractionMode ?? "auto"} · {slot.siteStructure.kind ?? "listing"}</dd></div>
          <div><dt>Nereden çekiyoruz</dt><dd>{displayedUrl || university.authority.homepageUrl || "URL bekleniyor"}</dd></div>
          <div><dt>Son test</dt><dd>{lastTestLabel}{slot.lastTest.error ? ` · ${slot.lastTest.error}` : ""}</dd></div>
        </dl>
        {slot.siteStructure.selectorHints && (
          <details className="selectorHints">
            <summary>Otomatik selector önerilerini göster</summary>
            {Object.entries(slot.siteStructure.selectorHints).map(([field, hints]) => <div key={field}><strong>{field}</strong><code>{hints.join(", ")}</code></div>)}
          </details>
        )}
        {preview && <SourceProfilePreview preview={preview} />}
        {!configured && <p className="inlineHint">Önizleme için önce URL ve parser yapısını kaydedin.</p>}
        <div className="sourceActions">
          <button className="btn btn-primary" disabled={!props.hasToken}><Save size={16} /> Kaydet</button>
          <button className="btn btn-secondary" type="button" onClick={() => props.previewUniversitySourceProfile(university.universityId, slot.contentType)} disabled={!props.hasToken || !configured}><Play size={16} /> Test Et / Önizle ve Devreye Al</button>
        </div>
        {slot.adminPath && <span className="inlineHint">İşlenen takvimlerin yayın yönetimi: {slot.adminPath}</span>}
      </form>
    </article>
  );
}

function SourceProfilePreview({ preview }: { preview: AnnouncementSourcePreview }) {
  const activationLabel = preview.activationStatus === "active"
    ? "Aktif"
    : preview.activationStatus === "inactive" ? "Devreye alınmadı" : preview.activationStatus === "not_requested" ? "İstenmedi" : preview.activationStatus;
  return (
    <div className={`sourcePreview preview-${preview.status}`} role="status">
      <strong>Test önizlemesi: {preview.status} · {preview.acceptedItemCount}/{preview.parsedItemCount} içerik kabul edildi</strong>
      {activationLabel && <span>Devreye alma: {activationLabel}</span>}
      {preview.detectedContentType && <span>Algılanan içerik: {preview.detectedContentType}</span>}
      {preview.activationError && <span>{preview.activationError}</span>}
      {preview.finalUrl && <a href={preview.finalUrl} target="_blank" rel="noreferrer">Test edilen son URL</a>}
      {preview.samples.length > 0 && <div className="sourcePreviewItems">{preview.samples.map((sample) => (
        <article key={sample.url}>
          <a href={sample.url} target="_blank" rel="noreferrer"><strong>{sample.title}</strong></a>
          <span>{sample.publishedAt || sample.publishedDate || "Tarih bulunamadı"}</span>
          {sample.summary && <p>{sample.summary}</p>}
          {(sample.body?.length ?? 0) > 0 && <p>{sample.body!.map((block) => block.text).join(" ")}</p>}
        </article>
      ))}</div>}
      {preview.error && <span>{preview.error}</span>}
    </div>
  );
}

function SourceParserConfigFields(props: {
  label: string;
  config?: AnnouncementSourceRecord["parserConfig"];
}) {
  const fields: Array<[keyof NonNullable<AnnouncementSourceRecord["parserConfig"]>, string, string]> = [
    ["itemSelector", "Liste öğesi", "article, .news-item"],
    ["titleSelector", "Başlık", "h2, .title"],
    ["linkSelector", "İçerik bağlantısı", "a"],
    ["dateSelector", "Tarih", "time, .date"],
    ["contentSelector", "Özet / gövde", ".summary, .content"]
  ];
  return (
    <fieldset className="parserConfigFields">
      <legend>CSS seçicileri <span>(boşsa otomatik)</span></legend>
      {fields.map(([name, label, placeholder]) => (
        <label className="fieldLabel" key={name}>{label}
          <input
            name={name}
            defaultValue={props.config?.[name] ?? ""}
            placeholder={placeholder}
            maxLength={300}
            aria-label={`${props.label} ${label.toLocaleLowerCase("tr-TR")} seçici`}
          />
        </label>
      ))}
    </fieldset>
  );
}

function AnnouncementSourcesPage(props: any) {
  const [scopeType, setScopeType] = useState<AnnouncementSourceRecord["scopeType"]>("university");
  const query = props.announcementSourcesQuery as AnnouncementSourcesQuery;
  const visibleSources = (props.announcementSources.data ?? []) as AnnouncementSourceRecord[];

  return (
    <section className="pageStack">
      <section className="mobileAdminBoundary" aria-label="Yönetim alanı bilgisi">
        <ShieldCheck size={20} aria-hidden="true" />
        <div>
          <strong>Mobil İçerik Admini</strong>
          <span>Bu çalışma alanı mobil uygulamanın akademik kaynaklarını yönetir; tenant yönetim paneli değildir.</span>
        </div>
      </section>
      <UniversitySourceWorkbench {...props} />
      <SourceCoveragePanel {...props} />
      <ScheduleReviewPanel {...props} />
      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <h2><Rss size={20} /> Yeni Resmî Kaynak</h2>
            <p className="panelSub">Üniversite, fakülte veya bölümün resmî duyuru, haber ve etkinlik sayfasını inceleme kuyruğuna ekleyin. İnsan onayı olmadan öğrenciye yayınlanmaz.</p>
          </div>
          {canManageGlobalAdminData(props.role) && (
            <button className="btn btn-secondary" type="button" onClick={props.provisionRegistrySources} disabled={!props.hasToken || props.announcementSources.loading}>
              <RefreshCcw size={18} /> Resmî Kayıt Kaynaklarını Kuyruğa Al
            </button>
          )}
        </div>
        {canManageGlobalAdminData(props.role) && <p className="inlineHint"><ShieldCheck size={16} /> Bu işlem kaynakları yalnızca karantinaya alır; hiçbir kaynağı otomatik olarak güvenilir yapmaz.</p>}
        <form className="gridForm sourceManagerForm" onSubmit={props.createAnnouncementSource}>
          <select name="scopeType" value={scopeType} onChange={(event) => setScopeType(event.target.value as AnnouncementSourceRecord["scopeType"])} aria-label="Kaynak kapsamı">
            <option value="university">Üniversite</option>
            <option value="faculty">Fakülte</option>
            <option value="department">Bölüm</option>
          </select>
          <select
            name="universityId"
            value={props.universityId}
            onChange={(event) => {
              props.setUniversityId(event.target.value);
              props.setFacultyId("");
              props.setDepartmentId("");
              if (event.target.value) void props.loadFaculties(event.target.value);
            }}
            required
            aria-label="Üniversite"
          >
            <option value="">Üniversite seçin</option>
            {(props.universities.data ?? []).map((university: UniversityRecord) => <option value={university.id} key={university.id}>{university.name}</option>)}
          </select>
          <select
            name="facultyId"
            value={props.facultyId}
            onChange={(event) => {
              props.setFacultyId(event.target.value);
              props.setDepartmentId("");
              if (event.target.value) void props.loadDepartments(event.target.value);
            }}
            disabled={scopeType === "university"}
            required={scopeType !== "university"}
            aria-label="Fakülte"
          >
            <option value="">Fakülte seçin</option>
            {(props.faculties.data ?? []).map((faculty: FacultyRecord) => <option value={faculty.id} key={faculty.id}>{faculty.name}</option>)}
          </select>
          <select
            name="departmentId"
            value={props.departmentId}
            onChange={(event) => props.setDepartmentId(event.target.value)}
            disabled={scopeType !== "department"}
            required={scopeType === "department"}
            aria-label="Bölüm"
          >
            <option value="">Bölüm seçin</option>
            {(props.departments.data ?? []).map((department: DepartmentRecord) => <option value={department.id} key={department.id}>{department.name}</option>)}
          </select>
          <input name="sourceName" placeholder="Kaynak adı" required aria-label="Kaynak adı" />
          <input name="sourceUrl" type="url" placeholder="https://universite.edu.tr/duyurular" required aria-label="Kaynak adresi" />
          <select name="contentType" defaultValue="announcement" aria-label="İçerik türü">
            <option value="announcement">Duyuru</option>
            <option value="news">Haber</option>
            <option value="event">Etkinlik</option>
          </select>
          <select name="parser" defaultValue="auto" aria-label="Ayrıştırıcı">
            <option value="auto">Otomatik</option>
            <option value="rss">RSS</option>
            <option value="html">HTML</option>
          </select>
          <input name="priority" type="number" min="1" max="100" defaultValue="50" required aria-label="Öncelik" />
          <label className="fieldLabel">Yenileme (dakika)<input name="fetchIntervalMinutes" type="number" min="5" max="10080" defaultValue="180" required /></label>
          <button className="btn btn-primary" disabled={!props.hasToken || props.announcementSources.loading}><Check size={18} /> Kaynağı Ekle</button>
        </form>
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <h2><RefreshCcw size={20} /> Kaynak Durumu</h2>
            <p className="panelSub">Sunucu taraflı filtreleme ve sayfalama ile kaynağı bulun; beklemeden kontrol edin, düzeltin veya pasife alın.</p>
          </div>
        </div>
        <form
          className="sourceFilterForm"
          key={JSON.stringify([query.search, query.trustStatus, query.contentType, query.scopeType])}
          onSubmit={(event) => {
            const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
            event.preventDefault();
            props.loadAnnouncementSources({
              search: values.search?.trim() ?? "",
              trustStatus: values.trustStatus ?? "",
              contentType: values.contentType ?? "",
              scopeType: values.scopeType ?? "",
              offset: 0
            });
          }}
        >
          <label className="fieldLabel">Ara<input name="search" defaultValue={query.search} maxLength={160} placeholder="Kaynak adı, URL veya kapsam kimliği" /></label>
          <label className="fieldLabel">Güven durumu
            <select name="trustStatus" defaultValue={query.trustStatus} aria-label="Kaynak güven durumuna göre filtrele">
              <option value="">Tüm güven durumları</option>
              <option value="quarantined">Karantinada</option>
              <option value="pending_review">İnceleme bekliyor</option>
              <option value="trusted">Güvenilir</option>
              <option value="rejected">Reddedildi</option>
            </select>
          </label>
          <label className="fieldLabel">İçerik türü
            <select name="contentType" defaultValue={query.contentType}>
              <option value="">Tüm içerik türleri</option>
              <option value="announcement">Duyuru</option>
              <option value="news">Haber</option>
              <option value="event">Etkinlik</option>
            </select>
          </label>
          <label className="fieldLabel">Kapsam
            <select name="scopeType" defaultValue={query.scopeType}>
              <option value="">Tüm kapsamlar</option>
              <option value="university">Üniversite</option>
              <option value="faculty">Fakülte</option>
              <option value="department">Bölüm</option>
            </select>
          </label>
          <div className="sourceFilterActions">
            <button className="btn btn-primary" disabled={!props.hasToken || props.announcementSources.loading}><Eye size={18} /> Filtrele</button>
            <button className="btn btn-secondary" type="button" onClick={() => props.loadAnnouncementSources({ search: "", trustStatus: "", contentType: "", scopeType: "", offset: 0 })} disabled={!props.hasToken || props.announcementSources.loading}>Temizle</button>
            <button className="btn btn-secondary" type="button" onClick={() => props.loadAnnouncementSources({})} disabled={!props.hasToken || props.announcementSources.loading}><RefreshCcw size={18} /> Yenile</button>
          </div>
        </form>
        {props.announcementSources.loading && <PanelState kind="loading" text={props.sourceLoadProgress || "Kaynaklar yükleniyor..."} />}
        {props.announcementSources.error && <PanelState kind="error" text={props.announcementSources.error} />}
        {!props.announcementSources.loading && !props.announcementSources.error && (props.announcementSources.data?.length ?? 0) === 0 && <PanelState kind="empty" text="Henüz duyuru kaynağı yok." />}
        <div className="sourceList">
          {visibleSources.map((source: AnnouncementSourceRecord) => (
            <form
              className="sourceEditor"
              key={JSON.stringify([source.id, source.updatedAt, source.sourceDefinitionVersion ?? "", source.canonicalUrl ?? source.sourceUrl, sourceTrustStatus(source), source.status])}
              onSubmit={(event) => props.updateAnnouncementSource(event, source)}
            >
              <div className="sourceIdentity">
                <strong>{source.sourceName}</strong>
                <span>{sourceScopeLabels[source.scopeType]} · {source.scopeId}</span>
                <span className={`statusBadge status-${source.healthStatus ?? "pending"}`}>{sourceHealthLabels[source.healthStatus ?? "pending"]} · {source.itemCount ?? 0} kayıt</span>
                <span className={`statusBadge trust-${sourceTrustStatus(source)}`}>{sourceTrustLabels[sourceTrustStatus(source)] ?? sourceTrustStatus(source)}</span>
                <span>{source.lastCheckedAt ? `Son kontrol: ${new Date(source.lastCheckedAt).toLocaleString("tr-TR")}` : "Henüz kontrol edilmedi"}</span>
              </div>
              <div className="sourceFields">
                <input name="sourceName" defaultValue={source.sourceName} required aria-label="Kaynak adı" />
                <input name="sourceUrl" type="url" defaultValue={source.sourceUrl} required aria-label="Kaynak adresi" />
                <select name="contentType" defaultValue={source.contentType ?? "announcement"} aria-label="İçerik türü">
                  <option value="announcement">Duyuru</option><option value="news">Haber</option><option value="event">Etkinlik</option>
                </select>
                <select name="parser" defaultValue={source.parser} aria-label="Ayrıştırıcı">
                  <option value="auto">Otomatik</option><option value="rss">RSS</option><option value="html">HTML</option>
                </select>
                <input name="priority" type="number" min="1" max="100" defaultValue={source.priority} aria-label="Öncelik" />
                <input name="fetchIntervalMinutes" type="number" min="5" max="10080" defaultValue={source.fetchIntervalMinutes ?? 180} aria-label="Yenileme dakikası" />
                <select name="status" defaultValue={source.status} aria-label="Kaynak durumu"><option value="active">Aktif</option><option value="inactive">Pasif</option></select>
              </div>
              {source.lastError && <p className="sourceError">{source.lastError}</p>}
              <SourceEvidencePanel source={source} />
              <div className="sourceActions">
                <button className="btn btn-primary" disabled={!props.hasToken}><Save size={16} /> Kaydet</button>
                <button className="btn btn-secondary" type="button" onClick={() => props.ingestAnnouncementSource(source.id)} disabled={!props.hasToken || source.status !== "active" || source.approvalPending === true}><Play size={16} /> Şimdi Tara</button>
                <button className="btn btn-danger" type="button" onClick={() => props.deactivateAnnouncementSource(source)} disabled={!props.hasToken || source.status === "inactive"}><Archive size={16} /> Pasife Al</button>
              </div>
              <SourceTrustControls source={source} disabled={!props.hasToken} onReview={props.reviewAnnouncementSource} />
            </form>
          ))}
        </div>
        {!props.announcementSources.loading && !props.announcementSources.error && visibleSources.length > 0 && (
          <div className="reviewPagination">
            <button className="btn btn-secondary" type="button" disabled={query.offset === 0} onClick={() => props.loadAnnouncementSources({ offset: Math.max(0, query.offset - query.limit) })}>Önceki</button>
            <span>{(query.offset + 1).toLocaleString("tr-TR")}–{(query.offset + visibleSources.length).toLocaleString("tr-TR")} arası kaynak</span>
            <button className="btn btn-secondary" type="button" disabled={!props.announcementSourcesHasMore} onClick={() => props.loadAnnouncementSources({ offset: query.offset + query.limit })}>Sonraki</button>
          </div>
        )}
      </section>

      <ContentReviewPanel {...props} />
      {canManageGlobalAdminData(props.role) && <LlmSettingsPanel {...props} />}
    </section>
  );
}

function SourceEvidencePanel({ source }: { source: AnnouncementSourceRecord }) {
  const evidence = source.evidence ?? source.verification;
  if (!evidence) {
    return (
      <details className="sourceEvidence">
        <summary><Eye size={16} aria-hidden="true" /> Doğrulama kanıtını göster</summary>
        <p className="evidenceNote">Bu kaynak için kalıcı crawler doğrulama kanıtı yok. Sağlık durumu doğrulama kanıtı yerine kullanılmaz.</p>
      </details>
    );
  }
  const reasons = [...(source.trustReasonCodes ?? []), ...(evidence.semanticReasons ?? [])];

  return (
    <details className="sourceEvidence">
      <summary><Eye size={16} aria-hidden="true" /> Doğrulama kanıtını göster</summary>
      <dl className="evidenceGrid">
        <div><dt>Kaynak URL</dt><dd><a href={evidence.sourceUrl ?? source.sourceUrl} target="_blank" rel="noreferrer">{evidence.sourceUrl ?? source.sourceUrl}</a></dd></div>
        <div><dt>Son URL</dt><dd><a href={evidence.finalUrl ?? source.sourceUrl} target="_blank" rel="noreferrer">{evidence.finalUrl ?? source.sourceUrl}</a></dd></div>
        {evidence.browserFinalUrl && <div><dt>Tarayıcı son URL</dt><dd><a href={evidence.browserFinalUrl} target="_blank" rel="noreferrer">{evidence.browserFinalUrl}</a></dd></div>}
        {evidence.rawFinalUrl && <div><dt>Ham son URL</dt><dd><a href={evidence.rawFinalUrl} target="_blank" rel="noreferrer">{evidence.rawFinalUrl}</a></dd></div>}
        <div><dt>Sahiplik</dt><dd>{evidence.universityId && evidence.unitType && evidence.scopeId ? `${evidence.universityId} · ${evidence.unitType} · ${evidence.scopeId}` : "-"}</dd></div>
        <div><dt>Keşif</dt><dd>{evidence.discoveryMethod ?? "Belirtilmedi"}</dd></div>
        <div><dt>HTTP</dt><dd>{evidence.httpStatus ?? "-"} {evidence.contentType ? `· ${evidence.contentType}` : ""}</dd></div>
        <div><dt>Resmî alan adı</dt><dd>{evidence.officialDomain === true ? "Doğrulandı" : evidence.officialDomain === false ? "Doğrulanmadı" : "Kanıt bekleniyor"}</dd></div>
        <div><dt>İçerik eşleşmesi</dt><dd>{evidence.semanticMatch === true ? "Eşleşti" : evidence.semanticMatch === false ? "Eşleşmedi" : evidence.status ?? "Kanıt bekleniyor"}</dd></div>
        <div><dt>Parser</dt><dd>{evidence.parserProfile ?? "-"}{evidence.parserCompatible !== undefined ? ` · ${evidence.parserCompatible ? "uyumlu" : "uyumsuz"}` : ""}{evidence.parserItemCount !== undefined ? ` · ${evidence.parserItemCount} öğe` : ""}</dd></div>
        <div><dt>Liste öğesi</dt><dd>{evidence.listingItemCount ?? 0}</dd></div>
        <div><dt>Son doğrulama</dt><dd>{evidence.finalRevalidatedAt || evidence.verifiedAt ? new Date(evidence.finalRevalidatedAt ?? evidence.verifiedAt!).toLocaleString("tr-TR") : "Henüz doğrulanmadı"}</dd></div>
        <div><dt>Doğrulayıcı</dt><dd>{evidence.verifierVersion ?? "-"}{evidence.schemaVersion ? ` · şema ${evidence.schemaVersion}` : ""}</dd></div>
        <div><dt>Çalıştırma</dt><dd>{evidence.runId ?? "-"}</dd></div>
        <div><dt>Kanıt dosyası</dt><dd>{evidence.evidencePath ?? "-"}{evidence.sha256 ? ` · ${evidence.sha256.slice(0, 12)}…` : ""}</dd></div>
        {evidence.parserEvidencePath && <div><dt>Parser kanıtı</dt><dd>{evidence.parserEvidencePath}{evidence.parserInputSha256 ? ` · ${evidence.parserInputSha256.slice(0, 12)}…` : ""}</dd></div>}
      </dl>
      {evidence?.selector && <p className="evidenceNote"><strong>Seçici:</strong> <code>{evidence.selector}</code></p>}
      {reasons.length > 0 && <p className="evidenceNote"><strong>Gerekçeler:</strong> {reasons.join(", ")}</p>}
      {(evidence?.sampleItemUrls?.length ?? 0) > 0 && (
        <div className="sampleLinks">
          <strong>Örnek içerikler</strong>
          {evidence!.sampleItemUrls!.slice(0, 3).map((url) => <a href={url} target="_blank" rel="noreferrer" key={url}>{url}</a>)}
        </div>
      )}
    </details>
  );
}

function SourceTrustControls(props: {
  source: AnnouncementSourceRecord;
  disabled: boolean;
  onReview: (source: AnnouncementSourceRecord, decision: "approve" | "reject", note: string) => void;
}) {
  const [note, setNote] = useState("");
  const trustStatus = sourceTrustStatus(props.source);

  return (
    <div className="sourceTrustControls">
      <label className="fieldLabel">İnceleme notu
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Kanıt veya düzeltme notu" aria-label={`${props.source.sourceName} inceleme notu`} />
      </label>
      <div className="sourceReviewActions">
        <button className="btn btn-primary" type="button" onClick={() => props.onReview(props.source, "approve", note)} disabled={props.disabled || trustStatus === "trusted"}><ShieldCheck size={16} /> Güvenilir Olarak Onayla</button>
        <button className="btn btn-danger" type="button" onClick={() => props.onReview(props.source, "reject", note)} disabled={props.disabled || trustStatus === "rejected"}><X size={16} /> Kaynağı Reddet</button>
      </div>
    </div>
  );
}

function ContentReviewPanel(props: any) {
  const [statusFilter, setStatusFilter] = useState("pending_review");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [isBatchLlmSubmitting, setIsBatchLlmSubmitting] = useState(false);
  const batchLlmSubmittingRef = useRef(false);
  const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR");
  const page = props.reviewItems.data as ReviewItemsPage | undefined;
  const llmSettings = props.llmSettings.data as LlmSettingsRecord | undefined;
  const llmReady = Boolean(llmSettings?.enabled && llmSettings.apiKeyConfigured);
  const visibleItems = (page?.items ?? []).filter((item: ReviewItemRecord) => {
    if (!normalizedSearch) return true;
    return `${item.title} ${item.sourceName ?? ""} ${item.summary ?? ""}`.toLocaleLowerCase("tr-TR").includes(normalizedSearch);
  });
  const requestPage = (offset: number, nextStatus = statusFilter, nextType = typeFilter) => props.loadReviewItems({
    reviewStatus: nextStatus === "all" ? undefined : nextStatus,
    contentType: nextType === "all" ? undefined : nextType,
    limit: page?.limit ?? 50,
    offset
  });

  async function runPendingLlmReviews() {
    if (batchLlmSubmittingRef.current) return;
    batchLlmSubmittingRef.current = true;
    setIsBatchLlmSubmitting(true);
    try {
      await props.runPendingLlmReviews();
    } finally {
      batchLlmSubmittingRef.current = false;
      setIsBatchLlmSubmitting(false);
    }
  }

  return (
    <section className="panel wide" aria-labelledby="content-review-heading">
      <div className="panelHeader">
        <div>
          <h2 id="content-review-heading"><Eye size={20} /> İçerik ve Sınıflandırma İncelemesi</h2>
          <p className="panelSub">Filtrelerden ve LLM süzgecinden geçen başlık, içerik ve sınıflandırmayı açıp düzeltin. Bekleyen içerik insan onayından önce yayınlanmaz.</p>
        </div>
        <div className="panelHeaderActions">
          {canManageGlobalAdminData(props.role) && <button className="btn btn-secondary" type="button" onClick={runPendingLlmReviews} disabled={!props.hasToken || !llmReady || props.reviewItems.loading || isBatchLlmSubmitting}><Sparkles size={18} /> {isBatchLlmSubmitting ? "LLM İnceliyor..." : "Bekleyenleri LLM ile İncele"}</button>}
          <button className="btn btn-secondary" type="button" onClick={() => requestPage(page?.offset ?? 0)} disabled={!props.hasToken || props.reviewItems.loading}><RefreshCcw size={18} /> Kuyruğu Yenile</button>
        </div>
      </div>
      <div className="reviewFilters" aria-label="İçerik inceleme filtreleri">
        <label className="fieldLabel">İnceleme durumu
          <select value={statusFilter} onChange={(event) => { const value = event.target.value; setStatusFilter(value); requestPage(0, value, typeFilter); }}>
            <option value="pending_review">İnceleme bekliyor</option>
            <option value="approved">Onaylandı</option>
            <option value="rejected">Reddedildi</option>
            <option value="all">Tümü</option>
          </select>
        </label>
        <label className="fieldLabel">İçerik türü
          <select value={typeFilter} onChange={(event) => { const value = event.target.value; setTypeFilter(value); requestPage(0, statusFilter, value); }}>
            <option value="all">Tüm türler</option>
            <option value="announcement">Duyuru</option>
            <option value="news">Haber</option>
            <option value="event">Etkinlik</option>
          </select>
        </label>
        <label className="fieldLabel">Bu sayfadaki başlık veya kaynakta ara
          <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Kayıt, sınav, fakülte..." />
        </label>
      </div>
      {props.reviewItems.loading && <PanelState kind="loading" text="İnceleme kuyruğu yükleniyor..." />}
      {props.reviewItems.error && <PanelState kind="error" text={props.reviewItems.error} />}
      {!props.reviewItems.loading && !props.reviewItems.error && visibleItems.length === 0 && <PanelState kind="empty" text="Bu filtrelerle eşleşen inceleme kaydı yok." />}
      <div className="reviewItemList">
        {visibleItems.map((item: ReviewItemRecord) => (
          <ContentReviewItemCard
            item={item}
            key={contentReviewFenceKey(item)}
            disabled={!props.hasToken}
            canRunLlm={canManageGlobalAdminData(props.role)}
            llmReady={llmReady}
            onSave={props.updateReviewItem}
            onStatus={props.setReviewItemStatus}
            onRunLlm={props.runReviewItemLlm}
          />
        ))}
      </div>
      {page && (page.offset > 0 || page.hasMore) && (
        <nav className="reviewPagination" aria-label="İçerik inceleme sayfaları">
          <button className="btn btn-secondary" type="button" onClick={() => requestPage(Math.max(0, page.offset - page.limit))} disabled={props.reviewItems.loading || page.offset === 0}>Önceki</button>
          <span>{page.offset + 1}-{page.offset + page.items.length} arası gösteriliyor{page.total ? ` · en az ${page.total} eşleşme` : ""}</span>
          <button className="btn btn-secondary" type="button" onClick={() => requestPage(page.offset + page.limit)} disabled={props.reviewItems.loading || !page.hasMore}>Sonraki</button>
        </nav>
      )}
    </section>
  );
}

function ContentReviewItemCard(props: {
  item: ReviewItemRecord;
  disabled: boolean;
  canRunLlm: boolean;
  llmReady: boolean;
  onSave: (item: ReviewItemRecord, draft: ContentReviewFormDraft & { body: ContentReviewBodyBlock[] }, forcedReviewStatus?: "approved" | "rejected") => Promise<unknown>;
  onStatus: (item: ReviewItemRecord, status: "approved" | "rejected") => Promise<unknown>;
  onRunLlm: (item: ReviewItemRecord) => Promise<unknown> | void;
}) {
  const item = props.item;
  const status = reviewItemStatus(item);
  const destination = item.canonicalUrl ?? item.link ?? item.officialSourceUrl ?? item.sourceUrl;
  const [draft, setDraft] = useState(() => createContentReviewFormDraft(item));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLlmSubmitting, setIsLlmSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const llmSubmittingRef = useRef(false);
  const serializedBody = useMemo(() => serializeContentReviewBody(draft.body), [draft.body]);

  function updateBodyBlock(index: number, field: "type" | "text", value: string) {
    setDraft((current) => ({
      ...current,
      body: current.body.map((block, blockIndex) => blockIndex === index
        ? { ...block, [field]: value } as ContentReviewBodyBlock
        : block)
    }));
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!serializedBody.ok || submittingRef.current) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const forcedReviewStatus = submitter instanceof HTMLButtonElement && submitter.value === "approve"
      ? "approved" as const
      : undefined;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await props.onSave(item, { ...draft, body: serializedBody.blocks }, forcedReviewStatus);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function runLlmReview() {
    if (llmSubmittingRef.current) return;
    llmSubmittingRef.current = true;
    setIsLlmSubmitting(true);
    try {
      await props.onRunLlm(item);
    } finally {
      llmSubmittingRef.current = false;
      setIsLlmSubmitting(false);
    }
  }

  return (
    <details className="reviewItemCard">
      <summary>
        <span className="reviewSummaryTitle">{item.title}</span>
        <span>{item.sourceName ?? item.sourceId}</span>
        <span className="statusBadge">{contentTypeLabels[item.contentType ?? "announcement"]}</span>
        <span className={`statusBadge review-${status}`}>{reviewStatusLabels[status] ?? status}</span>
      </summary>
      <form className="reviewItemForm" onSubmit={submitDraft}>
        <div className="reviewSourceLine">
          <span>{item.scopeType ? `${sourceScopeLabels[item.scopeType]} · ${item.scopeId ?? "-"}` : "Kapsam bilgisi bekleniyor"}</span>
          {destination && <a href={destination} target="_blank" rel="noreferrer">Resmî kaynakta aç</a>}
        </div>
        <label className="fieldLabel">Çekilen başlık
          <input name="title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} minLength={2} maxLength={500} required />
        </label>
        <label className="fieldLabel">Özet
          <textarea name="summary" value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} maxLength={contentReviewSummaryMaxLength} />
          <span>{draft.summary.length}/{contentReviewSummaryMaxLength} karakter</span>
        </label>
        <fieldset className="reviewBodyField">
          <legend>Çekilen içerik</legend>
          <p className="bodyEditorHint">Başlık, paragraf ve madde yapısı korunur. Uzun bloklar kayıtta 800 karakterlik API bloklarına ayrılır.</p>
          <div className="reviewBodyBlocks">
            {draft.body.map((block, index) => (
              <div className="reviewBodyBlock" key={index}>
                <label className="fieldLabel">Blok türü
                  <select value={block.type} onChange={(event) => updateBodyBlock(index, "type", event.target.value)} aria-label={`${index + 1}. içerik bloğu türü`}>
                    <option value="heading">Başlık</option>
                    <option value="paragraph">Paragraf</option>
                    <option value="bullet">Madde</option>
                  </select>
                </label>
                <label className="fieldLabel bodyBlockText">Metin
                  <textarea value={block.text} onChange={(event) => updateBodyBlock(index, "text", event.target.value)} aria-label={`${index + 1}. içerik bloğu metni`} />
                </label>
                <button className="btn btn-danger bodyBlockRemove" type="button" onClick={() => setDraft((current) => ({ ...current, body: current.body.filter((_, blockIndex) => blockIndex !== index) }))} aria-label={`${index + 1}. içerik bloğunu kaldır`}><Trash2 size={16} /> Kaldır</button>
              </div>
            ))}
          </div>
          <div className="bodyEditorFooter">
            <button className="btn btn-secondary" type="button" onClick={() => setDraft((current) => ({ ...current, body: [...current.body, { type: "paragraph", text: "" }] }))}>Paragraf bloğu ekle</button>
            {serializedBody.ok
              ? <span>{serializedBody.blocks.length}/{contentReviewBodyMaxBlocks} API bloğu · {serializedBody.characterCount}/{contentReviewBodyMaxLength} karakter</span>
              : serializedBody.reason === "block_count"
                ? <span className="bodyEditorError" role="alert">Metin {serializedBody.blockCount} API bloğu gerektiriyor; en fazla {contentReviewBodyMaxBlocks} blok kaydedilebilir.</span>
                : <span className="bodyEditorError" role="alert">Metin {serializedBody.characterCount} karakter; en fazla {contentReviewBodyMaxLength} karakter kaydedilebilir.</span>}
          </div>
        </fieldset>
        <fieldset className="classificationEditor">
          <legend>Sınıflandırma</legend>
          <label className="fieldLabel">Öğrenci ilgisi
            <select name="studentRelevance" value={draft.studentRelevance} onChange={(event) => setDraft((current) => ({ ...current, studentRelevance: event.target.value }))}>
              {Object.entries(studentRelevanceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label className="fieldLabel">Grup
            <select name="topic" value={draft.topic} onChange={(event) => setDraft((current) => ({ ...current, topic: event.target.value }))}>
              {Object.entries(contentTopicLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label className="fieldLabel">Hedef kitle
            <input name="audience" value={draft.audience} onChange={(event) => setDraft((current) => ({ ...current, audience: event.target.value }))} placeholder="all_students, bachelor_students" />
          </label>
          <label className="fieldLabel">Eylem
            <select name="actionType" value={draft.actionType} onChange={(event) => setDraft((current) => ({ ...current, actionType: event.target.value }))}>
              <option value="unknown">Belirsiz</option><option value="register">Kayıt ol</option><option value="apply">Başvur</option><option value="attend">Katıl</option><option value="pay">Öde</option><option value="review">İncele</option><option value="submit">Gönder</option>
            </select>
          </label>
          <label className="fieldLabel">Son tarih
            <input name="deadline" value={draft.deadline} onChange={(event) => setDraft((current) => ({ ...current, deadline: event.target.value }))} placeholder="YYYY-AA-GG" pattern="\d{4}-\d{2}-\d{2}" />
          </label>
          <label className="fieldLabel">Aciliyet
            <select name="urgency" value={draft.urgency} onChange={(event) => setDraft((current) => ({ ...current, urgency: event.target.value }))}>
              <option value="unknown">Belirsiz</option><option value="critical">Kritik</option><option value="high">Yüksek</option><option value="normal">Normal</option><option value="low">Düşük</option>
            </select>
          </label>
          <label className="fieldLabel">İnceleme sonucu
            <select name="reviewStatus" value={draft.reviewStatus} onChange={(event) => setDraft((current) => ({ ...current, reviewStatus: event.target.value }))}>
              <option value="pending_review">İnceleme bekliyor</option><option value="approved">Onaylandı</option><option value="rejected">Reddedildi</option>
            </select>
          </label>
        </fieldset>
        {item.llmClassification && (
          <aside className="llmSuggestion" aria-label="LLM sınıflandırma önerisi">
            <div className="llmSuggestionHeader">
              <strong><Sparkles size={16} /> LLM önerisi</strong>
              <span>{item.llmClassification.provider ?? "LLM"}{item.llmClassification.model ? ` / ${item.llmClassification.model}` : ""}</span>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setDraft((current) => applyContentReviewClassificationSuggestion(current, item.llmClassification!))}
                disabled={props.disabled || isSubmitting}
              >
                Öneriyi forma uygula
              </button>
            </div>
            <dl className="llmSuggestionGrid">
              <div><dt>Öğrenci ilgisi</dt><dd>{studentRelevanceLabels[item.llmClassification.studentRelevance ?? "uncertain"] ?? item.llmClassification.studentRelevance ?? "Belirsiz"}</dd></div>
              <div><dt>Grup</dt><dd>{contentTopicLabels[item.llmClassification.topic ?? "unknown"] ?? item.llmClassification.topic ?? "Belirsiz"}</dd></div>
              <div><dt>Hedef kitle</dt><dd>{item.llmClassification.audience === "unknown" || !item.llmClassification.audience?.length ? "Belirsiz" : item.llmClassification.audience.map((entry) => audienceLabels[entry] ?? entry).join(", ")}</dd></div>
              <div><dt>Eylem</dt><dd>{actionTypeLabels[item.llmClassification.actionType ?? "unknown"] ?? item.llmClassification.actionType ?? "Belirsiz"}</dd></div>
              <div><dt>Son tarih</dt><dd>{item.llmClassification.deadline && item.llmClassification.deadline !== "unknown" ? item.llmClassification.deadline : "Belirsiz"}</dd></div>
              <div><dt>Aciliyet</dt><dd>{urgencyLabels[item.llmClassification.urgency ?? "unknown"] ?? item.llmClassification.urgency ?? "Belirsiz"}</dd></div>
              <div><dt>Güven</dt><dd>{typeof item.llmClassification.confidence === "number" ? `%${Math.round(item.llmClassification.confidence * 100)}` : "Belirsiz"}</dd></div>
              <div className="llmRationale"><dt>Gerekçe</dt><dd>{item.llmClassification.rationale ?? "Gerekçe sağlanmadı."}</dd></div>
            </dl>
          </aside>
        )}
        {(item.evidenceSpans?.length ?? 0) > 0 && (
          <aside className="deterministicEvidence" aria-label="Deterministik sınıflandırma kanıtları">
            <strong>Deterministik kural kanıtları</strong>
            <ul>
              {item.evidenceSpans!.map((evidence, index) => (
                <li key={`${evidence.ruleId}-${evidence.sourceField}-${evidence.start}-${index}`}>
                  <code>{evidence.ruleId}</code>
                  <span>{evidenceTargetLabels[evidence.targetField]} · {evidence.sourceField}</span>
                  <q>{evidence.text}</q>
                </li>
              ))}
            </ul>
          </aside>
        )}
        {(item.trustReasonCodes?.length ?? 0) > 0 && <p className="evidenceNote"><strong>Filtre gerekçeleri:</strong> {item.trustReasonCodes!.join(", ")}</p>}
        {item.llmReviewInFlight && <p className="evidenceNote" role="status"><strong>LLM incelemesi:</strong> Bu içerik başka bir istekte inceleniyor.</p>}
        {item.llmReviewFailure && (
          <p className="evidenceNote" role="status">
            <strong>LLM inceleme durumu:</strong> {llmReviewFailureMessage(item.llmReviewFailure)}
          </p>
        )}
        <div className="reviewItemActions">
          <button className="btn btn-secondary" disabled={props.disabled || isSubmitting || !serializedBody.ok}><Save size={16} /> {isSubmitting ? "Kaydediliyor..." : "Düzeltmeleri Kaydet"}</button>
          {props.canRunLlm && status === "pending_review" && <button className="btn btn-secondary" type="button" onClick={runLlmReview} disabled={props.disabled || !props.llmReady || item.llmReviewInFlight || isSubmitting || isLlmSubmitting}><Sparkles size={16} /> {isLlmSubmitting ? "LLM İnceliyor..." : "LLM ile İncele"}</button>}
          <button className="btn btn-primary" type="submit" name="contentReviewAction" value="approve" disabled={props.disabled || isSubmitting || status === "approved" || !serializedBody.ok}><Check size={16} /> Onayla</button>
          <button className="btn btn-danger" type="button" onClick={() => props.onStatus(item, "rejected")} disabled={props.disabled || isSubmitting || status === "rejected"}><X size={16} /> Reddet</button>
        </div>
      </form>
    </details>
  );
}

function LlmSettingsPanel(props: any) {
  const [removeKeyArmed, setRemoveKeyArmed] = useState(false);
  const settings = props.llmSettings.data as LlmSettingsRecord | undefined;

  return (
    <section className="panel wide" aria-labelledby="llm-settings-heading">
      <div className="panelHeader">
        <div>
          <h2 id="llm-settings-heading"><KeyRound size={20} /> LLM API Ayarları</h2>
          <p className="panelSub">Anahtar yalnızca sunucuya yazılır; tarayıcıya geri okunmaz, sayfada veya oturum depolamasında tutulmaz.</p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={props.loadLlmSettings} disabled={!props.hasToken || props.llmSettings.loading}><RefreshCcw size={18} /> Durumu Yenile</button>
      </div>
      {props.llmSettings.loading && <PanelState kind="loading" text="LLM ayarları yükleniyor..." />}
      {props.llmSettings.error && <PanelState kind="error" text={props.llmSettings.error} />}
      {settings && (
        <>
          <div className="llmStatusGrid">
            <span><strong>Anahtar</strong>{settings.apiKeyConfigured ? `Tanımlı · •••• ${settings.keyLastFour ?? "****"}` : "Tanımlı değil"}</span>
            <span><strong>Bağlantı testi</strong>{settings.lastTestStatus === "success" ? "Başarılı" : settings.lastTestStatus === "failed" ? "Başarısız" : "Henüz test edilmedi"}</span>
            <span><strong>Son test</strong>{settings.lastTestedAt ? new Date(settings.lastTestedAt).toLocaleString("tr-TR") : "-"}</span>
          </div>
          <form className="llmSettingsForm" key={`${settings.provider}-${settings.model}-${settings.revision}`} onSubmit={props.updateLlmSettings}>
            <input name="expectedRevision" type="hidden" value={settings.revision} />
            <label className="fieldLabel">Sağlayıcı
              <select name="provider" defaultValue={settings.provider || "openai"}>
                <option value="openai">OpenAI (resmî API)</option>
              </select>
            </label>
            <label className="fieldLabel">Model
              <input name="model" defaultValue={settings.model} placeholder="Model adı" required />
            </label>
            <label className="fieldLabel">Yeni API anahtarı
              <input name="apiKey" type="password" autoComplete="new-password" defaultValue="" placeholder={settings.apiKeyConfigured ? "Değiştirmek için yeni anahtar girin" : "API anahtarını girin"} />
            </label>
            <label className="miniCheck llmEnabled"><input name="enabled" type="checkbox" defaultChecked={settings.enabled} /> LLM incelemesini etkinleştir</label>
            <button className="btn btn-primary"><Save size={16} /> Ayarları Kaydet</button>
          </form>
          <div className="llmKeyActions">
            <button className="btn btn-secondary" type="button" onClick={props.testLlmSettings} disabled={!settings.apiKeyConfigured}><Play size={16} /> Bağlantıyı Test Et</button>
            {!removeKeyArmed ? (
              <button className="btn btn-danger" type="button" onClick={() => setRemoveKeyArmed(true)} disabled={!settings.apiKeyConfigured}><Trash2 size={16} /> API Anahtarını Kaldır</button>
            ) : (
              <div className="inlineConfirmation" role="alert">
                <span>API anahtarı kaldırılsın mı?</span>
                <button className="btn btn-danger" type="button" onClick={() => { setRemoveKeyArmed(false); props.deleteLlmKey(); }}>Evet, kaldır</button>
                <button className="btn btn-secondary" type="button" onClick={() => setRemoveKeyArmed(false)}>Vazgeç</button>
              </div>
            )}
          </div>
        </>
      )}
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
          <input name="url" type="url" placeholder="Resmî doğrudan PDF adresi" required aria-label="Resmî doğrudan PDF adresi" />
          <input name="fileName" placeholder="calendar.pdf" required aria-label="Dosya adı" />
          <input name="fileSize" type="number" min="1" defaultValue="4096" required aria-label="Dosya boyutu" />
          <input name="pageCount" type="number" min="1" max="100" defaultValue="2" required aria-label="Sayfa sayısı" />
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
