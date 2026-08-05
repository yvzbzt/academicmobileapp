import {
  buildAcademicSelectionPayload,
  type AcademicClassLevel,
  type AcademicOnboardingDraft,
} from "../auth/auth-ui";
import type { GoogleCalendarLifecycleState } from "../google-calendar/google-calendar-lifecycle";
import type {
  NotificationPermissionState,
  NotificationRegistrationState,
} from "../notifications/notification-lifecycle";

export const PROFILE_SECTION_ORDER = [
  "profile_summary",
  "personal_information",
  "academic_profile",
  "notifications",
  "calendar_connections",
  "appearance_and_preferences",
  "help_privacy_and_app_info",
  "account_management",
  "dangerous_area",
] as const;

export type ProfileSectionId = (typeof PROFILE_SECTION_ORDER)[number];

export interface ProfileSectionCapabilities {
  appearancePreferences: boolean;
  helpPrivacyOrAppInfo: boolean;
}

/**
 * Keeps optional sections honest without allowing their absence to reorder the
 * required identity, integration, account, or dangerous-action hierarchy.
 */
export function visibleProfileSectionOrder(
  capabilities: ProfileSectionCapabilities,
): ProfileSectionId[] {
  return PROFILE_SECTION_ORDER.filter((section) => {
    if (section === "appearance_and_preferences") return capabilities.appearancePreferences;
    if (section === "help_privacy_and_app_info") return capabilities.helpPrivacyOrAppInfo;
    return true;
  });
}

export interface AcademicProfileFields {
  universityId?: string | null;
  facultyId?: string | null;
  departmentId?: string | null;
  classLevel?: number | null;
}

export interface AcademicProfileLabels {
  universityName?: string | null;
  facultyName?: string | null;
  departmentName?: string | null;
}

export interface AcademicProfileSummary {
  complete: boolean;
  status: "complete" | "incomplete";
  universityLabel: string;
  facultyLabel?: string;
  departmentLabel?: string;
  classLevelLabel?: string;
  supportingText: string;
  actionLabel: "Akademik bilgileri düzenle" | "Akademik profili tamamla";
  nameResolutionPending: boolean;
}

export type AcademicSelectionPayload = NonNullable<
  ReturnType<typeof buildAcademicSelectionPayload>
>;

export type AcademicProfileCommitResult<Profile extends AcademicProfileFields> =
  | {
      ok: false;
      reason: "university_required";
    }
  | {
      ok: true;
      profile: Profile;
      draft: AcademicOnboardingDraft;
    };

/** Converts the server-owned profile into a valid local editing draft. */
export function profileDraftFromServer(profile: AcademicProfileFields): AcademicOnboardingDraft {
  const universityId = normalizeIdentifier(profile.universityId);
  if (!universityId) return emptyAcademicDraft();

  const facultyId = normalizeIdentifier(profile.facultyId);
  const departmentId = facultyId ? normalizeIdentifier(profile.departmentId) : "";
  const classLevel = departmentId && isAcademicClassLevel(profile.classLevel)
    ? profile.classLevel
    : null;

  return {
    universityId,
    facultyId,
    departmentId,
    classLevel,
  };
}

export function resolveAcademicProfileSummary(
  profile: AcademicProfileFields,
  labels: AcademicProfileLabels = {},
): AcademicProfileSummary {
  const draft = profileDraftFromServer(profile);
  if (!draft.universityId) {
    return {
      complete: false,
      status: "incomplete",
      universityLabel: "Üniversite seçilmedi",
      supportingText: "Akademik içerikleri kişiselleştirmek için üniversiteni ekle.",
      actionLabel: "Akademik profili tamamla",
      nameResolutionPending: false,
    };
  }

  const universityName = normalizeLabel(labels.universityName);
  const facultyName = draft.facultyId ? normalizeLabel(labels.facultyName) : "";
  const departmentName = draft.departmentId ? normalizeLabel(labels.departmentName) : "";
  const universityLabel = universityName || "Üniversite bilgisi kayıtlı";
  const facultyLabel = draft.facultyId
    ? facultyName || "Fakülte bilgisi kayıtlı"
    : undefined;
  const departmentLabel = draft.departmentId
    ? departmentName || "Bölüm bilgisi kayıtlı"
    : undefined;
  const detailLabels = [facultyLabel, departmentLabel].filter(
    (value): value is string => Boolean(value),
  );

  return {
    complete: true,
    status: "complete",
    universityLabel,
    ...(facultyLabel ? { facultyLabel } : {}),
    ...(departmentLabel ? { departmentLabel } : {}),
    ...(draft.classLevel !== null ? { classLevelLabel: `${draft.classLevel}. sınıf` } : {}),
    supportingText: detailLabels.length > 0
      ? detailLabels.join(" · ")
      : "Fakülte, bölüm ve sınıf bilgileri isteğe bağlıdır.",
    actionLabel: "Akademik bilgileri düzenle",
    nameResolutionPending: !universityName
      || Boolean(draft.facultyId && !facultyName)
      || Boolean(draft.departmentId && !departmentName),
  };
}

/**
 * Validates once, performs exactly one caller-owned mutation, and then treats
 * only the returned profile as the post-save authority.
 */
export async function commitAcademicProfileDraft<Profile extends AcademicProfileFields>(
  draft: AcademicOnboardingDraft,
  save: (payload: AcademicSelectionPayload) => Promise<Profile>,
): Promise<AcademicProfileCommitResult<Profile>> {
  const payload = buildAcademicSelectionPayload(draft);
  if (!payload) return { ok: false, reason: "university_required" };

  const profile = await save(payload);
  return {
    ok: true,
    profile,
    draft: profileDraftFromServer(profile),
  };
}

export type NotificationPreferenceMode = "all_calendar" | "selected_fields";

export interface NotificationPreferenceComparable {
  enabled: boolean;
  mode: NotificationPreferenceMode;
  categories: Readonly<Record<string, boolean>>;
}

export type NotificationPreferenceSaveState =
  | "loading"
  | "saved"
  | "dirty"
  | "saving"
  | "error";

export interface NotificationTruthInput {
  preferenceEnabled: boolean;
  permission: NotificationPermissionState;
  registration: NotificationRegistrationState;
  saveState: NotificationPreferenceSaveState;
  errorMessage?: string;
}

export interface NotificationTruth {
  active: boolean;
  kind:
    | "active"
    | "disabled"
    | "permission_mismatch"
    | "registration_mismatch"
    | "busy"
    | "error";
  tone: "neutral" | "info" | "success" | "warning" | "error";
  title: string;
  detail: string;
  permissionLabel: string;
  registrationLabel: string;
  preferenceLabel: string;
  busy: boolean;
  mismatch: boolean;
  openSettingsRequired: boolean;
}

export function hasNotificationPreferenceChanges(
  initial: NotificationPreferenceComparable,
  current: NotificationPreferenceComparable,
): boolean {
  if (initial.enabled !== current.enabled || initial.mode !== current.mode) return true;

  const categoryKeys = new Set([
    ...Object.keys(initial.categories),
    ...Object.keys(current.categories),
  ]);
  for (const category of categoryKeys) {
    // The Phase 3 preference contract treats an omitted category as enabled.
    if ((initial.categories[category] !== false) !== (current.categories[category] !== false)) {
      return true;
    }
  }
  return false;
}

export function resolveNotificationTruth(input: NotificationTruthInput): NotificationTruth {
  const active = input.preferenceEnabled
    && input.permission === "granted"
    && input.registration === "registered";
  const lifecycleError = input.permission === "error" || input.registration === "error";
  const busy = input.saveState === "loading"
    || input.saveState === "saving"
    || input.permission === "checking"
    || input.registration === "registering"
    || input.registration === "detaching";
  const permissionMismatch = input.preferenceEnabled && input.permission !== "granted";
  const registrationMismatch = (
    input.preferenceEnabled
    && input.permission === "granted"
    && input.registration !== "registered"
  ) || (!input.preferenceEnabled && input.registration === "registered");
  const openSettingsRequired = input.permission === "permanently_denied";
  const permissionLabel = NOTIFICATION_PERMISSION_LABELS[input.permission];
  const registrationLabel = NOTIFICATION_REGISTRATION_LABELS[input.registration];
  const preferenceLabel = input.preferenceEnabled ? "Açık" : "Kapalı";

  const shared = {
    active,
    permissionLabel,
    registrationLabel,
    preferenceLabel,
    busy,
    openSettingsRequired,
  };

  if (input.saveState === "error" || lifecycleError) {
    return {
      ...shared,
      kind: "error",
      tone: "error",
      title: "Bildirim durumu doğrulanamadı",
      detail: normalizeLabel(input.errorMessage)
        || "Tercihin veya bu cihazın teslimat kaydı doğrulanamadı. Tekrar deneyebilirsin.",
      mismatch: permissionMismatch || registrationMismatch,
    };
  }

  if (busy) {
    return {
      ...shared,
      kind: "busy",
      tone: "info",
      title: input.saveState === "saving" ? "Bildirim tercihi kaydediliyor" : "Bildirim durumu kontrol ediliyor",
      detail: "İzin, tercih ve cihaz kaydı birlikte doğrulanıyor.",
      mismatch: false,
    };
  }

  if (active) {
    return {
      ...shared,
      kind: "active",
      tone: "success",
      title: "Bildirimler etkin",
      detail: "Tercihin açık, işletim sistemi izni verilmiş ve bu cihaz kayıtlı.",
      mismatch: false,
    };
  }

  if (permissionMismatch) {
    return {
      ...shared,
      kind: "permission_mismatch",
      tone: "warning",
      title: "Bildirim izni gerekiyor",
      detail: openSettingsRequired
        ? "Tercihin açık, ancak izin cihaz ayarlarından kapalı. Bildirimler etkin değil."
        : "Tercihin açık, ancak işletim sistemi izni geçerli değil. Bildirimler etkin değil.",
      mismatch: true,
    };
  }

  if (registrationMismatch) {
    return {
      ...shared,
      kind: "registration_mismatch",
      tone: "warning",
      title: "Cihaz kaydı eşleşmiyor",
      detail: input.preferenceEnabled
        ? "Tercihin ve iznin açık, ancak bu cihaz teslimat için kayıtlı değil."
        : "Tercihin kapalı, ancak cihaz kaydı hâlâ etkin görünüyor.",
      mismatch: true,
    };
  }

  return {
    ...shared,
    kind: "disabled",
    tone: "neutral",
    title: "Bildirimler kapalı",
    detail: "Bildirim tercihin kapalı; bu cihaz için teslimat etkin değil.",
    mismatch: false,
  };
}

export interface GoogleCalendarPresentation {
  state: GoogleCalendarLifecycleState;
  label: string;
  title: string;
  detail: string;
  tone: "neutral" | "info" | "success" | "warning" | "error";
  busy: boolean;
  connected: boolean;
  requiresReconnect: boolean;
}

export function resolveGoogleCalendarPresentation(
  state: GoogleCalendarLifecycleState,
): GoogleCalendarPresentation {
  const presentation = GOOGLE_CALENDAR_PRESENTATIONS[state];
  return {
    state,
    ...presentation,
    busy: state === "checking" || state === "syncing",
    connected: state === "connected" || state === "syncing" || state === "partial",
    requiresReconnect: state === "expired",
  };
}

export interface ProfileSettingsLayout {
  compact: boolean;
  largeText: boolean;
  gutter: 16 | 20 | 24;
  maxWidth: 720;
  columns: 1;
  notificationModeOrientation: "horizontal" | "vertical";
  minimumTouchTarget: 48;
  horizontalScrollingAllowed: false;
}

export function resolveProfileSettingsLayout(
  windowWidth: number,
  fontScale: number,
): ProfileSettingsLayout {
  const safeWidth = Number.isFinite(windowWidth) && windowWidth > 0 ? windowWidth : 320;
  const safeFontScale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const compact = safeWidth < 375;
  const largeText = safeFontScale >= 1.8;
  return {
    compact,
    largeText,
    gutter: compact ? 16 : safeWidth >= 840 ? 24 : 20,
    maxWidth: 720,
    columns: 1,
    notificationModeOrientation: compact || largeText ? "vertical" : "horizontal",
    minimumTouchTarget: 48,
    horizontalScrollingAllowed: false,
  };
}

const NOTIFICATION_PERMISSION_LABELS: Record<NotificationPermissionState, string> = {
  not_requested: "Henüz istenmedi",
  checking: "Kontrol ediliyor",
  granted: "İzin verildi",
  denied: "İzin verilmedi",
  permanently_denied: "Cihaz ayarlarından kapalı",
  unavailable: "Bu cihazda kullanılamıyor",
  error: "Doğrulanamadı",
};

const NOTIFICATION_REGISTRATION_LABELS: Record<NotificationRegistrationState, string> = {
  unregistered: "Kayıtlı değil",
  registering: "Kaydediliyor",
  registered: "Kayıtlı",
  detaching: "Kayıt kaldırılıyor",
  error: "Kayıt doğrulanamadı",
};

const GOOGLE_CALENDAR_PRESENTATIONS: Record<
  GoogleCalendarLifecycleState,
  Omit<GoogleCalendarPresentation, "state" | "busy" | "connected" | "requiresReconnect">
> = {
  disconnected: {
    label: "Bağlı değil",
    title: "Google Takvim bağlı değil",
    detail: "Akademik kayıtlarını eşitlemek için bir Google hesabı bağlayabilirsin.",
    tone: "neutral",
  },
  checking: {
    label: "Kontrol ediliyor",
    title: "Google Takvim bağlantısı kontrol ediliyor",
    detail: "Hesap, izin ve takvim erişimi doğrulanıyor.",
    tone: "info",
  },
  connected: {
    label: "Bağlı",
    title: "Google Takvim bağlı",
    detail: "Yalnızca uygulamanın yönettiği akademik kayıtlar eşitlenir.",
    tone: "success",
  },
  expired: {
    label: "İzin süresi doldu",
    title: "Google Takvim izni yenilenmeli",
    detail: "Yeniden bağlanmadan yeni bir eşitleme yapılamaz.",
    tone: "warning",
  },
  syncing: {
    label: "Eşitleniyor",
    title: "Google Takvim eşitleniyor",
    detail: "Uygulamanın yönettiği akademik kayıtlar doğrulanıyor.",
    tone: "info",
  },
  partial: {
    label: "Kısmi başarı",
    title: "Google Takvim kısmen eşitlendi",
    detail: "Doğrulanan kayıtlar korundu; tamamlanamayanları yeniden deneyebilirsin.",
    tone: "warning",
  },
  error: {
    label: "Hata",
    title: "Google Takvim işlemi tamamlanamadı",
    detail: "Bağlantı durumunu kontrol edip yeniden deneyebilirsin.",
    tone: "error",
  },
};

function normalizeIdentifier(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLabel(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function isAcademicClassLevel(value: number | null | undefined): value is AcademicClassLevel {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;
}

function emptyAcademicDraft(): AcademicOnboardingDraft {
  return {
    universityId: "",
    facultyId: "",
    departmentId: "",
    classLevel: null,
  };
}
