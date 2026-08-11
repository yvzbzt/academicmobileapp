import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  statusCodes
} from "@react-native-google-signin/google-signin";
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Alert,
  AppState,
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
  AppNavigator,
  type AppRootSurface,
  type AppRouteLeaveGuard,
  type AppScreenSlots,
  type AppVisibleRoute
} from "./src/navigation/AppNavigator";
import { AppShellPreview } from "./src/navigation/AppShellPreview";
import {
  BootstrapErrorState,
  BootstrapLoadingState,
  UnknownRouteState,
} from "./src/navigation/SystemStateScreens";
import { useAppRouteRequest } from "./src/navigation/useAppRouteRequest";
import {
  RouteIntentCoordinator,
  createVerifiedNotificationIntent,
  parseAcademicPulseRouteUrl,
  resolveRootRoute,
  type AppRoute,
  type AppRouteIntent,
  type ProtectedAppRoute,
  type RouteOwner,
  type UnknownRoute
} from "./src/navigation";
import { Banner, DesignSystemPreview, ListItem, ThemeProvider } from "./src/design-system";
import { Section } from "./src/components/Section";
import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GoogleCalendarService,
  GoogleCalendarSyncError,
  type GoogleCalendarEventMapping,
  type GoogleCalendarSyncResult
} from "./src/google-calendar/google-calendar-sync";
import {
  GOOGLE_CALENDAR_CONNECTION_SCHEMA_VERSION,
  GoogleCalendarLifecycleGuard,
  executeGoogleCalendarLifecycle,
  evaluateGoogleCalendarPreflight,
  findDuplicateGoogleCalendarMappings,
  googleCalendarDeletionCandidateSourceTypes,
  planGoogleCalendarAccountSwitch,
  planGoogleCalendarExactMappingLookups,
  planGoogleCalendarLifecycle,
  readGoogleCalendarConnectionRecordV3,
  settledGoogleCalendarLifecycleState,
  type GoogleCalendarConnectionRecordV3,
  type GoogleCalendarLifecycleState
} from "./src/google-calendar/google-calendar-lifecycle";
import {
  ExpoNetworkAdapter,
  ExpoNotificationPermissionAdapter,
  FirebaseNotificationTapAdapter,
  FirebaseNotificationTokenAdapter,
  NotificationLifecycleCoordinator,
  configureAndroidNotificationChannels,
  configureForegroundNotificationPresentation,
  createPendingNotificationDestinationRecord,
  isSamePendingNotificationDestinationRecord,
  openNotificationSettings,
  notificationReminderRulesForMutation,
  parsePendingNotificationDestinationRecord,
  resolveNotificationDestination,
  serializePendingNotificationDestinationRecord,
  subscribeToForegroundRemoteNotifications,
  type NotificationBackendAdapter,
  type NotificationDestination,
  type NotificationLifecycleState,
  type ParsedNotificationDestination
} from "./src/notifications";
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
  AcademicOnboardingScreen,
  LoginScreen,
  PasswordRecoveryCodeScreen,
  PasswordRecoveryConfirmScreen,
  PasswordRecoveryRequestScreen,
  RegistrationScreen,
  VerificationScreen,
  type AuthFeedback
} from "./src/auth/AuthScreens";
import { PreLoginWelcomeScreen } from "./src/auth/PreLoginWelcomeScreen";
import {
  PRELOGIN_WELCOME_COMPLETION_STORAGE_KEY,
  PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE,
  resolvePreloginWelcomeGate,
  type PreloginWelcomeGate,
} from "./src/auth/prelogin-welcome";
import { RecentAuthenticationPanel } from "./src/auth/RecentAuthenticationPanel";
import {
  normalizeAccountAuthProvider,
  readRecentAuthenticationResponse,
  recentAuthenticationHeader,
  recentAuthenticationMethods,
  recentAuthenticationPurpose,
  type AccountAuthProvider,
  type DestructiveAccountAction,
  type RecentAuthenticationMethod
} from "./src/auth/recent-authentication";
import {
  EMPTY_ACADEMIC_ONBOARDING_DRAFT,
  buildAcademicSelectionPayload,
  classLevelOptionsForAcademicDepartment,
  hasAcademicOnboardingChanges,
  isVerificationCodeComplete,
  normalizeNumericCode,
  selectAcademicClassLevel,
  selectAcademicDepartment,
  selectAcademicFaculty,
  selectAcademicUniversity,
  validateLoginForm,
  validateRegistrationForm,
  type AcademicClassLevel,
  type AcademicOnboardingDraft
} from "./src/auth/auth-ui";
import {
  commitAcademicProfileDraft,
  hasNotificationPreferenceChanges,
  profileDraftFromServer,
  resolveAcademicProfileSummary,
  resolveGoogleCalendarPresentation,
  resolveNotificationTruth,
  type NotificationPreferenceSaveState
} from "./src/profile/profile-model";
import {
  AccountDataSettingsScreen,
  AcademicProfileSettingsScreen,
  GoogleCalendarSettingsScreen,
  NotificationSettingsScreen,
  ProfileOverviewScreen
} from "./src/profile/ProfileSettings";
import {
  ProfileSettingsPreview,
  type ProfileSettingsPreviewScenario
} from "./src/profile/ProfileSettingsPreview";
import {
  AuthOnboardingPreview,
  type AuthOnboardingPreviewScenario
} from "./src/auth/AuthOnboardingPreview";
import {
  createManualExamStorageKey
} from "./src/session-integrity/manual-exam-storage";
import {
  canonicalizeOfficialAcademicUrl,
  contentTimestampLabel,
  isNavigationContentTitle,
  normalizeDisplayText,
  normalizeTrustedApiContentCollection,
  normalizeTrustedApiContentEnvelope,
  normalizeTrustedContentCollection,
  type ContentCollectionState,
  type MobileContentCollectionInput,
  type MobileContentRecordInput,
  type TrustedContentCollection,
  type TrustedMobileContentRecord
} from "./src/content/content-trust";
import { HomeDailyBrief } from "./src/home/HomeDailyBrief";
import { selectExamCountdownItems } from "./src/home/home-model";
import { CalendarExperience } from "./src/calendar/CalendarExperience";
import { CalendarEventDetail } from "./src/calendar/CalendarEventDetail";
import {
  buildCalendarItems,
  selectUniversityAcademicCalendarEvents,
  type CalendarItem
} from "./src/calendar/calendar-model";
import {
  PersonalExamRuntime,
  StalePersonalExamOperationError,
  type PersonalExamRuntimeState,
  type PersonalExamMutationInput,
  type PersonalExamMutationResult
} from "./src/calendar/personal-exam-runtime";
import {
  CalendarPreview,
  type CalendarPreviewScenario
} from "./src/calendar/CalendarPreview";
import {
  compareAcademicTemporalStart,
  formatAcademicRemainingTime,
  formatAcademicTemporal,
  isAcademicTemporalActiveOnDay,
  isAcademicTemporalCurrentOrFuture,
  type AcademicTemporalKind
} from "./src/temporal/academic-temporal";
import {
  HomeDailyBriefPreview,
  type HomeDailyBriefPreviewScenario
} from "./src/home/HomeDailyBriefPreview";
import { AnnouncementsFeed } from "./src/announcements/AnnouncementsFeed";
import { AnnouncementDetail } from "./src/announcements/AnnouncementDetail";
import {
  SummerSchoolScreen,
  YokAnnouncementsScreen,
} from "./src/announcements/SourceDestinationScreens";
import {
  CONTENT_FEED_INITIAL_LIMIT,
  CONTENT_FEED_MAX_LIMIT,
  buildContentFeed,
  createContentFeedRequestCoordinator,
  nextContentFeedLimit,
  resolveContentFeedHasMore,
  settleContentFeedLoading,
  type ContentFeedItem
} from "./src/announcements/feed-model";
import {
  ContentFeedPreview,
  type ContentFeedPreviewScenario
} from "./src/announcements/ContentFeedPreview";

type AuthMode = "login" | "register";
type AlarmMode = "all_calendar" | "selected_fields";
type TabId = "profile" | "announcements" | "home" | "calendar" | "summer" | "yok";
type AcademicSelectionLevel = "university" | "faculty" | "department";
type AuthStage =
  | "auth"
  | "verify"
  | "academic_onboarding"
  | "password_recovery_request"
  | "password_recovery_code"
  | "password_recovery_confirm";

type PendingDeepLinkRoute = {
  route: ProtectedAppRoute | UnknownRoute;
  owner: RouteOwner | null;
};

const AUTH_ROUTE_NAMES = new Set<AppVisibleRoute>([
  "Login",
  "Register",
  "Verification",
  "PasswordRecoveryRequest",
  "PasswordRecoveryCode",
  "PasswordRecoveryConfirm"
]);

const AUTHENTICATED_ROUTE_NAMES = new Set<AppVisibleRoute>([
  "Home",
  "Announcements",
  "SummerSchool",
  "YokAnnouncements",
  "AnnouncementDetail",
  "Calendar",
  "CalendarEventDetail",
  "Profile",
  "AcademicProfileSettings",
  "NotificationSettings",
  "GoogleCalendarSettings",
  "AccountDataSettings",
  "UnknownRoute"
]);

function routeForAuthState(authStage: AuthStage, authMode: AuthMode): AppVisibleRoute {
  switch (authStage) {
    case "verify": return "Verification";
    case "academic_onboarding": return "AcademicOnboarding";
    case "password_recovery_request": return "PasswordRecoveryRequest";
    case "password_recovery_code": return "PasswordRecoveryCode";
    case "password_recovery_confirm": return "PasswordRecoveryConfirm";
    case "auth": return authMode === "register" ? "Register" : "Login";
  }
}

function routeForLegacyTab(tab: TabId): AppVisibleRoute {
  switch (tab) {
    case "home": return "Home";
    case "announcements": return "Announcements";
    case "summer": return "SummerSchool";
    case "yok": return "YokAnnouncements";
    case "calendar": return "Calendar";
    case "profile": return "Profile";
  }
}

function routeBelongsToLegacyTab(route: AppVisibleRoute, tab: TabId): boolean {
  switch (tab) {
    case "home": return route === "Home";
    case "announcements":
      return route === "Announcements"
        || route === "SummerSchool"
        || route === "YokAnnouncements"
        || route === "AnnouncementDetail";
    case "summer": return route === "SummerSchool";
    case "yok": return route === "YokAnnouncements";
    case "calendar": return route === "Calendar" || route === "CalendarEventDetail";
    case "profile":
      return route === "Profile"
        || route === "AcademicProfileSettings"
        || route === "NotificationSettings"
        || route === "GoogleCalendarSettings"
        || route === "AccountDataSettings";
  }
}

function navigationTargetForProtectedRoute(route: ProtectedAppRoute): {
  route: AppVisibleRoute;
  legacyTab: TabId;
  params?: Readonly<Record<string, string>>;
} {
  switch (route.name) {
    case "Home":
      return { route: "Home", legacyTab: "home" };
    case "Announcements":
      return { route: "Announcements", legacyTab: "announcements" };
    case "SummerSchool":
      return { route: "SummerSchool", legacyTab: "summer" };
    case "YokAnnouncements":
      return { route: "YokAnnouncements", legacyTab: "yok" };
    case "AnnouncementDetail":
      return {
        route: "AnnouncementDetail",
        legacyTab: "announcements",
        params: { announcementId: route.params.announcementId }
      };
    case "Calendar":
      return { route: "Calendar", legacyTab: "calendar" };
    case "CalendarEventDetail":
      return {
        route: "CalendarEventDetail",
        legacyTab: "calendar",
        params: { eventId: route.params.eventId }
      };
    case "Profile":
    case "AcademicProfileSettings":
    case "NotificationSettings":
    case "GoogleCalendarSettings":
    case "AccountDataSettings":
      return { route: route.name, legacyTab: "profile" };
  }
}

function visibleRouteForResolvedRoot(route: AppRoute): AppVisibleRoute {
  if (route.name === "Hydration") {
    return route.params.status === "loading" ? "BootstrapLoading" : "BootstrapError";
  }
  if (route.name === "Unknown") return "UnknownRoute";
  return route.name;
}

type SessionPayload = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    authProvider?: AccountAuthProvider;
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
  authProvider?: AccountAuthProvider;
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
  classLevel?: AcademicClassLevel;
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
  educationLevel?: string;
};

type AnnouncementApiRecord = MobileContentRecordInput;
type AnnouncementCollectionApiPayload = MobileContentCollectionInput;
type AnnouncementRecord = TrustedMobileContentRecord;
type SavedAnnouncementApiStatus = {
  announcementId: string;
  saved: boolean;
  savedAt?: string;
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
  courseName?: string;
  description?: string;
  location?: string;
  category: string;
  startDate: string;
  endDate?: string;
  temporalKind?: AcademicTemporalKind;
  endTemporalKind?: AcademicTemporalKind;
  timezone?: string;
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
};

type CalendarPayload = {
  calendar: CalendarRecord;
  events: EventRecord[];
  scope?: "university";
  sourceStatus?: "parsed" | "source_only";
};

type LegacyGoogleCalendarConnectionRecord = {
  ownerId: string;
  accountEmail: string;
  lastSyncedAt: string;
};

type NotificationDestinationNotice = {
  status: "opened" | "unavailable" | "temporarily_unavailable";
  destination: NotificationDestination;
  title?: string;
};

type SummerSchoolApiPayload = {
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
  ownAnnouncements: AnnouncementApiRecord[];
  sameDepartmentAnnouncements: AnnouncementApiRecord[];
  announcementStatus?: {
    state: ContentCollectionState;
    sourceCount: number;
    failedSourceCount: number;
  };
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

type SummerSchoolPayload = Omit<SummerSchoolApiPayload, "ownAnnouncements" | "sameDepartmentAnnouncements"> & {
  ownAnnouncements: AnnouncementRecord[];
  sameDepartmentAnnouncements: AnnouncementRecord[];
  contentState: ContentCollectionState;
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
  attempted?: boolean;
  stale?: boolean;
};

const SESSION_STORAGE_KEY = "native_session";
const SESSION_INVALIDATED_STORAGE_VALUE = "native_session_invalidated_v1";
const DEVICE_ID_STORAGE_KEY = "native_device_id";
const PENDING_NOTIFICATION_STORAGE_KEY = "native_pending_notification_destination_v1";
const LEGACY_GOOGLE_CALENDAR_STORAGE_KEY = "native_google_calendar_connection";
const GOOGLE_CALENDAR_V2_STORAGE_PREFIX = "native_google_calendar_connection_v2";
const GOOGLE_CALENDAR_STORAGE_PREFIX = "native_google_calendar_connection_v3";
// Sourced from app.json; kept visible here so Profile never reports a package-only placeholder.
const NATIVE_APP_VERSION = "0.1.3";
const NATIVE_ANDROID_BUILD_NUMBER = 14;
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
  "custom_event",
  "announcement",
  "faculty_announcement",
  "department_announcement",
  "yok_event"
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
  custom_event: "Özel etkinlik",
  announcement: "Üniversite duyuruları",
  faculty_announcement: "Fakülte duyuruları",
  department_announcement: "Bölüm duyuruları",
  yok_event: "YÖK duyuru ve etkinlikleri"
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

function normalizeEventRecordsForDisplay(events: EventRecord[]): EventRecord[] {
  return events.flatMap((event) => {
    const title = normalizeDisplayText(event.title);
    if (!title || isNavigationContentTitle(title)) return [];
    const courseName = normalizeDisplayText(event.courseName).slice(0, 240).trim();
    const description = normalizeDisplayText(event.description).slice(0, 2_000).trim();
    const location = normalizeDisplayText(event.location).slice(0, 240).trim();
    const {
      courseName: _courseName,
      description: _description,
      location: _location,
      ...baseEvent
    } = event;
    return [{
      ...baseEvent,
      title,
      ...(courseName ? { courseName } : {}),
      ...(description ? { description } : {}),
      ...(location ? { location } : {})
    }];
  });
}

function normalizeCalendarPayloadForDisplay(payload: CalendarPayload): CalendarPayload {
  return {
    ...payload,
    calendar: {
      ...payload.calendar,
      title: normalizeDisplayText(payload.calendar.title) || "Akademik takvim"
    },
    events: normalizeEventRecordsForDisplay(payload.events)
  };
}

function normalizeSummerSchoolPayloadForDisplay(payload: SummerSchoolApiPayload): SummerSchoolPayload {
  const ownAnnouncements = normalizeTrustedApiContentCollection(payload.ownAnnouncements);
  const sameDepartmentAnnouncements = normalizeTrustedApiContentCollection(payload.sameDepartmentAnnouncements);
  let omittedContentCount = 0;

  const requirements = payload.requirements.flatMap((requirement) => {
    const message = normalizeDisplayText(requirement.message);
    if (!message || isNavigationContentTitle(message)) {
      omittedContentCount += 1;
      return [];
    }
    const { sourceUrl: rawSourceUrl, ...safeRequirement } = requirement;
    const sourceUrl = canonicalizeOfficialAcademicUrl(rawSourceUrl);
    if (rawSourceUrl && !sourceUrl) omittedContentCount += 1;
    return [{
      ...safeRequirement,
      message,
      ...(sourceUrl ? { sourceUrl } : {})
    }];
  });

  const sameDepartmentOptions = payload.sameDepartmentOptions.map((option) => {
    const { sourceUrl: rawSourceUrl, ...safeOption } = option;
    const sourceUrl = canonicalizeOfficialAcademicUrl(rawSourceUrl);
    if (rawSourceUrl && !sourceUrl) omittedContentCount += 1;
    const events = normalizeEventRecordsForDisplay(option.events);
    omittedContentCount += option.events.length - events.length;
    const matchingDepartments = option.matchingDepartments?.map((match) => ({
      ...match,
      facultyName: normalizeDisplayText(match.facultyName) || "Fakülte",
      departmentName: normalizeDisplayText(match.departmentName) || "Bölüm"
    }));
    return {
      ...safeOption,
      universityName: normalizeDisplayText(option.universityName) || "Üniversite",
      events,
      ...(matchingDepartments ? { matchingDepartments } : {}),
      ...(sourceUrl ? { sourceUrl } : {})
    };
  });

  const announcementCollections = [ownAnnouncements, sameDepartmentAnnouncements];
  const announcementItems = announcementCollections.flatMap((collection) => collection.items);
  const hasStale = announcementItems.some((item) => item.freshness === "stale");
  const hasFresh = announcementItems.some((item) => item.freshness !== "stale");
  const contentState: ContentCollectionState = omittedContentCount > 0
    || announcementCollections.some((collection) => collection.state === "partial")
    || payload.announcementStatus?.state === "partial"
    || (payload.announcementStatus?.failedSourceCount ?? 0) > 0
    || (hasFresh && hasStale)
    ? "partial"
    : hasStale || payload.announcementStatus?.state === "stale"
      ? "stale"
      : "fresh";

  const profile = payload.profile;
  return {
    ...payload,
    profile: {
      universityId: profile.universityId,
      ...(profile.universityName ? { universityName: normalizeDisplayText(profile.universityName) } : {}),
      ...(profile.facultyId ? { facultyId: profile.facultyId } : {}),
      ...(profile.facultyName ? { facultyName: normalizeDisplayText(profile.facultyName) } : {}),
      ...(profile.departmentId ? { departmentId: profile.departmentId } : {}),
      ...(profile.departmentName ? { departmentName: normalizeDisplayText(profile.departmentName) } : {})
    },
    requirements,
    ownAnnouncements: ownAnnouncements.items,
    sameDepartmentAnnouncements: sameDepartmentAnnouncements.items,
    sameDepartmentOptions,
    contentState
  };
}

function contentAvailabilityMessage(state: ContentCollectionState | undefined, retainedAfterError: boolean | undefined): string | null {
  if (retainedAfterError) return "Yenileme tamamlanamadı. Son doğrulanmış içerik gösteriliyor.";
  if (state === "partial") return "Bazı kaynaklar doğrulanamadı. Kullanılabilir resmî içerik gösteriliyor.";
  if (state === "stale") return "Kaynakların son doğrulanmış içeriği gösteriliyor.";
  return null;
}

function trustedContentCollectionHasMore(
  collection: TrustedContentCollection | undefined,
  requestedLimit: number
): boolean {
  return Boolean(collection && resolveContentFeedHasMore({
    requestedLimit,
    nextCursor: collection.nextCursor,
    hasMore: collection.hasMore,
    explicitRawCount: collection.explicitRawCount,
    rawItemCount: collection.rawItemCount
  }));
}

function appendTrustedContentItems(
  collection: TrustedContentCollection | undefined,
  items: readonly TrustedMobileContentRecord[]
): TrustedContentCollection {
  const merged = normalizeTrustedContentCollection([...(collection?.items ?? []), ...items]);
  if (!collection) return merged;
  return {
    ...merged,
    state: collection.state,
    rawItemCount: collection.rawItemCount,
    ...(collection.explicitRawCount === undefined ? {} : { explicitRawCount: collection.explicitRawCount }),
    ...(collection.nextCursor ? { nextCursor: collection.nextCursor } : {}),
    ...(typeof collection.hasMore === "boolean" ? { hasMore: collection.hasMore } : {})
  };
}

function contentFeedDetailItem(
  record: AnnouncementRecord,
  origin: "academic" | "yok" | "summer-school"
): ContentFeedItem | null {
  return buildContentFeed({
    academic: origin === "academic" ? [record] : [],
    yok: origin === "yok" ? [record] : [],
    summerSchool: origin === "summer-school" ? [record] : []
  })[0] ?? null;
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
    device_registration: "cihaz bildirim kaydı",
    session_storage: "cihaz oturumu",
    pending_verification_storage: "doğrulama kurtarma kaydı",
    pending_notification_storage: "bekleyen bildirim hedefi",
    manual_exam_storage: "kişisel sınav kaydı",
    google_connection_storage: "Google Takvim bağlantı kaydı",
    google_managed_events: "Google Takvim'e eklenen uygulama kayıtları",
    google_access: "Google erişim izni",
    google_sign_in: "Google hesap seçimi",
    in_memory_state: "ekrandaki hesap verileri"
  };
  return labels[target];
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

function createGoogleCalendarV2StorageKey(ownerId: string): string {
  const normalized = ownerId.trim();
  if (!normalized) throw new Error("A Google Calendar connection owner is required.");
  const encoded = Array.from(normalized, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("_");
  return `${GOOGLE_CALENDAR_V2_STORAGE_PREFIX}_${encoded}`;
}

function googleCalendarLifecycleLabel(state: GoogleCalendarLifecycleState): string {
  const labels: Record<GoogleCalendarLifecycleState, string> = {
    disconnected: "Bağlı değil",
    checking: "Doğrulanıyor",
    connected: "Bağlı",
    expired: "Süresi doldu",
    syncing: "Eşitleniyor",
    partial: "Kısmi",
    error: "Hata"
  };
  return labels[state];
}

function notificationLifecycleMessage(state: NotificationLifecycleState): string {
  if (state.active) return "Bildirim izni verildi ve bu cihaz teslimat için kayıtlı.";
  if (Platform.OS === "web" || state.permission === "unavailable") {
    return "Push bildirimleri bu platformda kullanılamıyor.";
  }
  if (state.permission === "permanently_denied") {
    return "Bildirim izni cihaz ayarlarından kapalı. Teslimat etkin değil.";
  }
  if (state.permission === "denied") return "Bildirim izni verilmedi. Teslimat etkin değil.";
  if (state.permission === "not_requested") return "Bildirim izni henüz istenmedi. Yalnızca sen açtığında sorulur.";
  if (state.registration === "registering" || state.permission === "checking") return "Bildirim durumu doğrulanıyor.";
  if (state.registration === "error" || state.permission === "error") {
    return "Bu cihazın bildirim teslimatı doğrulanamadı. Tercihlerin kaydedilebilir, ancak teslimat etkin değil.";
  }
  return "Bildirim teslimatı etkin değil.";
}

function mappingsMatchDesiredContent(
  desired: readonly { sourceId: string; sourceType: string; fingerprint: string }[],
  remote: readonly GoogleCalendarEventMapping[],
  deletionEligibleSourceTypes: readonly string[]
): boolean {
  if (findDuplicateGoogleCalendarMappings(remote).hasDuplicates) return false;
  const remoteBySource = new Map(remote.map((mapping) => [
    `${mapping.sourceType}:${mapping.sourceId}`,
    mapping
  ]));
  if (!desired.every((item) => remoteBySource.get(`${item.sourceType}:${item.sourceId}`)?.fingerprint === item.fingerprint)) {
    return false;
  }
  const desiredKeys = new Set(desired.map((item) => `${item.sourceType}:${item.sourceId}`));
  return remote.every((mapping) => (
    !deletionEligibleSourceTypes.includes(mapping.sourceType)
    || desiredKeys.has(`${mapping.sourceType}:${mapping.sourceId}`)
  ));
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

function MainApplication() {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authStage, setAuthStage] = useState<AuthStage>("auth");
  const [preloginWelcomeGate, setPreloginWelcomeGate] = useState<
    PreloginWelcomeGate | "loading" | "saving"
  >("loading");
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const {
    acknowledgeNavigationRequest,
    activeRoute,
    clearNavigationRequest,
    navigationRequest,
    requestAppRoute,
    setActiveRoute
  } = useAppRouteRequest("BootstrapLoading");
  const pendingDeepLinkRouteRef = useRef<PendingDeepLinkRoute | null>(null);
  const apiBaseUrl = useMemo(() => resolveApiBaseUrl(), []);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registrationPasswordConfirmation, setRegistrationPasswordConfirmation] = useState("");
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
  const hydrationStatusRef = useRef<HydrationStatus>("loading");
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [authenticatedContextPending, setAuthenticatedContextPending] = useState(false);

  const [registerUniversityId, setRegisterUniversityId] = useState("");
  const [registerFacultyId, setRegisterFacultyId] = useState("");
  const [registerDepartmentId, setRegisterDepartmentId] = useState("");
  const [registerClassLevel, setRegisterClassLevel] = useState<AcademicClassLevel | null>(null);
  const [onboardingInitialDraft, setOnboardingInitialDraft] = useState<AcademicOnboardingDraft>(
    EMPTY_ACADEMIC_ONBOARDING_DRAFT
  );
  const [registerPicker, setRegisterPicker] = useState<"none" | "university" | "faculty" | "department">("none");
  const [universitySearch, setUniversitySearch] = useState("");
  const [facultySearch, setFacultySearch] = useState("");
  const [departmentSearch, setDepartmentSearch] = useState("");
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [sessionOwner, setSessionOwner] = useState<AccountGenerationSnapshot | null>(null);
  const [deviceId, setDeviceId] = useState("");

  const [universities, setUniversities] = useState<Loadable<UniversityRecord[]>>({ loading: false });
  const [faculties, setFaculties] = useState<Loadable<FacultyRecord[]>>({ loading: false });
  const [departments, setDepartments] = useState<Loadable<DepartmentRecord[]>>({ loading: false });
  const [calendar, setCalendar] = useState<Loadable<CalendarPayload>>({ loading: false });
  const [upcoming, setUpcoming] = useState<Loadable<EventRecord[]>>({ loading: false });
  const [announcements, setAnnouncements] = useState<Loadable<TrustedContentCollection>>({ loading: false });
  const [yokAnnouncements, setYokAnnouncements] = useState<Loadable<TrustedContentCollection>>({ loading: false });
  const [summerSchool, setSummerSchool] = useState<Loadable<SummerSchoolPayload>>({ loading: false });
  const [preferences, setPreferences] = useState<Loadable<NotificationPreferencePayload>>({ loading: false });
  const [manualExamState, setManualExamState] = useState<PersonalExamRuntimeState>({
    ownerId: null,
    hydrated: false,
    exams: []
  });
  const manualExams = manualExamState.exams;
  const manualExamOwnerId = manualExamState.ownerId;
  const manualExamsHydrated = manualExamState.hydrated;

  const [selectedUniversityId, setSelectedUniversityId] = useState("");
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [alarmMode, setAlarmMode] = useState<AlarmMode>("all_calendar");
  const [categoryDraft, setCategoryDraft] = useState<Record<string, boolean>>({});
  const [academicProfileSaveState, setAcademicProfileSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [academicProfileSaveError, setAcademicProfileSaveError] = useState<string | undefined>();
  const [notificationPreferenceOutcome, setNotificationPreferenceOutcome] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [notificationPreferenceError, setNotificationPreferenceError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [academicSelectionPending, setAcademicSelectionPending] = useState<AcademicSelectionLevel | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [accountAuthProvider, setAccountAuthProvider] = useState<AccountAuthProvider | undefined>();
  const [recentAuthAction, setRecentAuthAction] = useState<DestructiveAccountAction | null>(null);
  const [recentAuthReturnFocus, setRecentAuthReturnFocus] = useState<{
    action: DestructiveAccountAction;
    requestId: number;
  } | undefined>();
  const recentAuthReturnFocusRequestRef = useRef(0);
  const [recentAuthPassword, setRecentAuthPassword] = useState("");
  const [recentAuthBusy, setRecentAuthBusy] = useState(false);
  const [recentAuthError, setRecentAuthError] = useState<string | undefined>();
  const [message, setMessage] = useState<{ text: string; tone: "info" | "success" | "error" } | null>(null);
  const [googleCalendarBusy, setGoogleCalendarBusy] = useState(false);
  const [googleCalendarIntegration, setGoogleCalendarIntegration] = useState<GoogleCalendarConnectionRecordV3 | null>(null);
  const [googleCalendarState, setGoogleCalendarState] = useState<GoogleCalendarLifecycleState>("disconnected");
  const [googleCalendarLastResult, setGoogleCalendarLastResult] = useState<GoogleCalendarSyncResult | null>(null);
  const [googleCalendarWarnings, setGoogleCalendarWarnings] = useState<string[]>([]);
  const [googleCalendarError, setGoogleCalendarError] = useState<string | null>(null);
  const [notificationLifecycle, setNotificationLifecycle] = useState<NotificationLifecycleState>({
    schemaVersion: 1,
    ownerId: null,
    preferenceEnabled: false,
    permission: Platform.OS === "web" ? "unavailable" : "not_requested",
    registration: "unregistered",
    active: false
  });
  const [notificationDestinationNotice, setNotificationDestinationNotice] = useState<NotificationDestinationNotice | null>(null);
  const [activeTrustedDetail, setActiveTrustedDetail] = useState<
    | { type: "announcement"; id: string; title: string; item: ContentFeedItem }
    | { type: "calendar_event"; id: string; title: string }
    | null
  >(null);
  const [activeCalendarDetail, setActiveCalendarDetail] = useState<CalendarItem | null>(null);
  const [announcementDetailLoad, setAnnouncementDetailLoad] = useState<{
    id: string;
    loading: boolean;
    error?: string;
  } | null>(null);
  const [announcementSaveStatus, setAnnouncementSaveStatus] = useState<{
    id: string;
    saved: boolean;
    loading: boolean;
    mutating: boolean;
    error?: string;
  } | null>(null);
  const [academicProfileExpanded, setAcademicProfileExpanded] = useState(false);
  const [alarmCategoriesExpanded, setAlarmCategoriesExpanded] = useState(false);
  const [contentFeedLimit, setContentFeedLimit] = useState(CONTENT_FEED_INITIAL_LIMIT);
  const [contentFeedPagination, setContentFeedPagination] = useState<{
    loading: boolean;
    error?: string;
  }>({ loading: false });
  const [cleanupIssue, setCleanupIssue] = useState<{
    action: "logout" | "session_expiry" | "data_deletion" | "account_deletion" | "verification_save" | "verification_clear" | "activation" | "manual_exam_save" | "notification_settings";
    failedTargets: AccountCleanupTarget[];
    ownerId?: string;
  } | null>(null);
  const sessionRef = useRef<SessionPayload | null>(null);
  const deviceIdRef = useRef("");
  const refreshSessionPromiseRef = useRef<Promise<SessionPayload | null> | null>(null);
  const academicSelectionPendingRef = useRef<AcademicSelectionLevel | null>(null);
  const accountGuardRef = useRef(new AccountGenerationGuard());
  const onboardingOwnerRef = useRef<AccountGenerationSnapshot | null>(null);
  const onboardingSaveAttemptRef = useRef(0);
  const routeIntentCoordinatorRef = useRef(new RouteIntentCoordinator());
  const announcementDetailRequestGenerationRef = useRef(0);
  const announcementSaveRequestGenerationRef = useRef(0);
  const contentFeedRequestCoordinatorRef = useRef(createContentFeedRequestCoordinator());
  const contentFeedAbortControllerRef = useRef<AbortController | null>(null);
  const authenticatedRequestControllersRef = useRef(new Set<AbortController>());
  const storageMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const googleSdkQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeAuthenticatedMutationsRef = useRef(new Set<Promise<unknown>>());
  const googleSdkEpochRef = useRef(0);
  const googleLifecycleGuardRef = useRef(new GoogleCalendarLifecycleGuard());
  const notificationCoordinatorRef = useRef<NotificationLifecycleCoordinator | null>(null);
  const notificationCoordinatorOwnerTokenRef = useRef<SessionPayload | null>(null);
  const notificationUnsubscribeRef = useRef<(() => void) | null>(null);
  const notificationRotationUnsubscribeRef = useRef<(() => void) | null>(null);
  const notificationForegroundUnsubscribeRef = useRef<(() => void) | null>(null);
  const notificationTapAdapterRef = useRef<FirebaseNotificationTapAdapter | null>(null);
  const notificationFailClosedPromiseRef = useRef<Promise<void> | null>(null);
  const notificationNavigationRequestRef = useRef<{
    requestKey: string;
    record: ReturnType<typeof createPendingNotificationDestinationRecord>;
    ownerSnapshot: AccountGenerationSnapshot;
  } | null>(null);
  const accountCleanupInProgressRef = useRef(false);
  const authOperationInProgressRef = useRef(false);
  const activationAttemptRef = useRef(0);
  const hydrationInProgressRef = useRef(false);
  const personalExamRuntimeRef = useRef<PersonalExamRuntime | null>(null);
  if (!personalExamRuntimeRef.current) {
    personalExamRuntimeRef.current = new PersonalExamRuntime({
      storage: {
        getItemAsync: getStoredValue,
        setItemAsync: (key, value) => enqueueStorageMutation(() => setStoredValue(key, value)),
        deleteItemAsync: (key) => enqueueStorageMutation(() => deleteStoredValue(key))
      },
      ownerGuard: accountGuardRef.current,
      createId: () => createLocalId("manual-exam"),
      onStateChange: setManualExamState,
      onPersistenceError: (ownerId) => {
        const snapshot = accountGuardRef.current.capture();
        if (!snapshot || snapshot.ownerId !== ownerId) return;
        setCleanupIssue({
          action: "manual_exam_save",
          failedTargets: ["manual_exam_storage"],
          ownerId
        });
        setMessage({ text: "Sınavlar cihazda saklanamadı. Lütfen tekrar dene.", tone: "error" });
      }
    });
  }
  const personalExamRuntime = personalExamRuntimeRef.current;

  const accessToken = session?.accessToken;
  const availableRecentAuthMethods = recentAuthenticationMethods(
    accountAuthProvider ?? normalizeAccountAuthProvider(session?.user.authProvider),
    GOOGLE_AUTH_CONFIGURED
  );
  const googleCalendarService = useMemo(() => new GoogleCalendarService(), []);
  const availableCategories = useMemo(() => {
    const keys = new Set<string>(DEFAULT_CATEGORY_OPTIONS);
    for (const event of calendar.data?.events ?? []) keys.add(event.category);
    for (const category of Object.keys(preferences.data?.categories ?? {})) keys.add(category);
    return [...keys];
  }, [calendar.data?.events, preferences.data?.categories]);
  const examCountdownItems = useMemo(() => {
    const visibleManualExams = session?.user.id === manualExamOwnerId && manualExamsHydrated
      ? manualExams
      : [];
    return selectExamCountdownItems(calendar.data?.events ?? [], visibleManualExams, new Date());
  }, [calendar.data?.events, manualExams, manualExamOwnerId, manualExamsHydrated, session?.user.id]);
  const announcementFeed = useMemo(
    () => announcements.data?.items ?? [],
    [announcements.data]
  );
  const yokAnnouncementItems = useMemo(
    () => yokAnnouncements.data?.items ?? [],
    [yokAnnouncements.data]
  );
  const summerSchoolEvents = useMemo(
    () => (calendar.data?.events ?? []).filter((event) => event.category.startsWith("summer_school")),
    [calendar.data?.events]
  );
  const summerSchoolAnnouncements = useMemo(
    () => normalizeTrustedContentCollection([
      ...(summerSchool.data?.ownAnnouncements ?? []),
      ...(summerSchool.data?.sameDepartmentAnnouncements ?? [])
    ]).items,
    [summerSchool.data]
  );
  const contentFeedHasRetainedData = announcementFeed.length > 0
    || yokAnnouncementItems.length > 0
    || summerSchoolAnnouncements.length > 0;
  const contentFeedHasMore = trustedContentCollectionHasMore(announcements.data, contentFeedLimit)
    || trustedContentCollectionHasMore(yokAnnouncements.data, contentFeedLimit);
  const contentFeedSourceErrors = [announcements.error, yokAnnouncements.error, summerSchool.error]
    .filter((value): value is string => Boolean(value));
  const contentFeedError = contentFeedSourceErrors.join(" ") || undefined;
  const contentFeedPartial = announcements.data?.state === "partial"
    || yokAnnouncements.data?.state === "partial"
    || summerSchool.data?.contentState === "partial"
    || (
      contentFeedHasRetainedData
      && contentFeedSourceErrors.length > 0
      && contentFeedSourceErrors.length < 3
    );
  const contentFeedStale = Boolean(
    announcements.stale
    || yokAnnouncements.stale
    || summerSchool.stale
    || announcements.data?.state === "stale"
    || yokAnnouncements.data?.state === "stale"
    || summerSchool.data?.contentState === "stale"
  );
  const contentFeedLoading = announcements.loading
    || yokAnnouncements.loading
    || summerSchool.loading;
  const contentFeedAttempted = Boolean(
    announcements.attempted
    && yokAnnouncements.attempted
    && summerSchool.attempted
  );
  const yokAvailabilityMessage = contentAvailabilityMessage(yokAnnouncements.data?.state, yokAnnouncements.stale);
  const summerAvailabilityMessage = contentAvailabilityMessage(summerSchool.data?.contentState, summerSchool.stale);
  const summerDateAvailabilityMessage = contentAvailabilityMessage(undefined, calendar.stale);
  const calendarAvailabilityMessage = contentAvailabilityMessage(undefined, calendar.stale);
  const upcomingAvailabilityMessage = contentAvailabilityMessage(undefined, upcoming.stale);
  const nextUpcomingEvent = useMemo(() => {
    const now = new Date();
    return (upcoming.data ?? [])
      .filter((event) => isAcademicTemporalCurrentOrFuture(event, now))
      .sort(compareAcademicTemporalStart)[0];
  }, [upcoming.data]);
  const todayEventCount = useMemo(() => {
    const today = new Date();
    return (calendar.data?.events ?? [])
      .filter((event) => isAcademicTemporalActiveOnDay(event, today))
      .length;
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

  const registrationValidation = validateRegistrationForm({
    fullName,
    email,
    password,
    passwordConfirmation: registrationPasswordConfirmation
  });
  const loginValidation = validateLoginForm({ email, password });
  const registerIdentityReady = registrationValidation.valid;
  const loginReady = loginValidation.valid;
  const academicOnboardingDraft = useMemo<AcademicOnboardingDraft>(() => ({
    universityId: registerUniversityId,
    facultyId: registerFacultyId,
    departmentId: registerDepartmentId,
    classLevel: registerClassLevel
  }), [registerUniversityId, registerFacultyId, registerDepartmentId, registerClassLevel]);
  const academicProfileDirty = hasAcademicOnboardingChanges(
    onboardingInitialDraft,
    academicOnboardingDraft
  );
  const academicClassLevelOptions = useMemo(
    () => classLevelOptionsForAcademicDepartment(selectedDepartment),
    [selectedDepartment]
  );
  const academicProfileSummary = resolveAcademicProfileSummary(
    academicOnboardingDraft,
    {
      universityName: selectedUniversity?.name,
      facultyName: selectedFaculty?.name,
      departmentName: selectedDepartment?.name
    }
  );
  const initialNotificationPreference = useMemo(() => {
    const categories: Record<string, boolean> = {};
    for (const category of availableCategories) {
      categories[category] = preferences.data?.categories[category] !== false;
    }
    return {
      enabled: preferences.data?.enabled ?? false,
      mode: availableCategories.every((category) => categories[category] !== false)
        ? "all_calendar" as const
        : "selected_fields" as const,
      categories
    };
  }, [availableCategories, preferences.data]);
  const currentNotificationPreference = useMemo(() => ({
    enabled: alarmEnabled,
    mode: alarmMode,
    categories: categoryDraft
  }), [alarmEnabled, alarmMode, categoryDraft]);
  const notificationPreferenceDirty = hasNotificationPreferenceChanges(
    initialNotificationPreference,
    currentNotificationPreference
  );
  const notificationPreferenceSaveState: NotificationPreferenceSaveState =
    preferences.loading && !preferences.data
      ? "loading"
      : notificationPreferenceOutcome === "saving"
        ? "saving"
        : notificationPreferenceOutcome === "error" || Boolean(preferences.error)
          ? "error"
          : notificationPreferenceDirty
            ? "dirty"
            : "saved";
  const notificationTruth = resolveNotificationTruth({
    preferenceEnabled: notificationLifecycle.preferenceEnabled,
    permission: notificationLifecycle.permission,
    registration: notificationLifecycle.registration,
    saveState: notificationPreferenceSaveState,
    errorMessage: notificationPreferenceError ?? preferences.error
  });
  const googleCalendarPresentation = resolveGoogleCalendarPresentation(googleCalendarState);
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
  const currentRouteOwner = accountGuardRef.current.capture();
  const rootRouteResolution = resolveRootRoute({
    hydrationStatus,
    sessionOwner: session ? sessionOwner : null,
    currentOwner: currentRouteOwner,
    authMode,
    authStage,
    hasPendingVerification: Boolean(pendingVerification),
    hasPendingPasswordRecovery: Boolean(pendingPasswordRecovery)
  });
  const shouldShowPreloginWelcome = hydrationStatus === "ready"
    && !session
    && (preloginWelcomeGate === "pending" || preloginWelcomeGate === "saving")
    && rootRouteResolution.surface === "auth"
    && authMode === "login"
    && authStage === "auth"
    && !pendingVerification
    && !pendingPasswordRecovery;
  const navigatorRootSurface: AppRootSurface = shouldShowPreloginWelcome
    ? "introduction"
    : rootRouteResolution.surface === "hydration"
    ? rootRouteResolution.route.name === "Hydration" && rootRouteResolution.route.params.status === "error"
      ? "hydration_error"
      : "hydration_loading"
    : authenticatedContextPending
      && (rootRouteResolution.surface === "authenticated" || rootRouteResolution.surface === "onboarding")
      ? "hydration_loading"
      : rootRouteResolution.surface === "authenticated"
        ? "authenticated"
        : rootRouteResolution.surface === "onboarding"
          ? "onboarding"
          : "auth";
  const expectedBaseRoute: AppVisibleRoute = navigatorRootSurface === "hydration_loading"
    ? "BootstrapLoading"
    : navigatorRootSurface === "hydration_error"
      ? "BootstrapError"
      : navigatorRootSurface === "introduction"
        ? "Introduction"
      : navigatorRootSurface === "authenticated"
        ? routeForLegacyTab(activeTab)
        : visibleRouteForResolvedRoot(rootRouteResolution.route);
  const controlledActiveRoute = navigatorRootSurface === "authenticated"
    ? (AUTHENTICATED_ROUTE_NAMES.has(activeRoute) ? activeRoute : expectedBaseRoute)
    : navigatorRootSurface === "introduction"
      ? "Introduction"
    : navigatorRootSurface === "auth"
      ? (AUTH_ROUTE_NAMES.has(activeRoute) ? activeRoute : expectedBaseRoute)
      : navigatorRootSurface === "onboarding"
        ? "AcademicOnboarding"
        : expectedBaseRoute;
  const googleCalendarLive = Boolean(
    googleCalendarIntegration
    && (googleCalendarState === "connected" || googleCalendarState === "partial")
    && googleCalendarIntegration.authorizationVerifiedAt
  );

  function ensureNotificationCoordinator(installationId: string): NotificationLifecycleCoordinator | null {
    if (Platform.OS !== "android" && Platform.OS !== "ios") {
      setNotificationLifecycle((previous) => ({
        ...previous,
        permission: "unavailable",
        registration: "unregistered",
        active: false
      }));
      return null;
    }
    if (notificationCoordinatorRef.current) return notificationCoordinatorRef.current;

    const backendAdapter: NotificationBackendAdapter = {
      registerDevice: async ({ ownerId, installationId: currentInstallationId, platform, token }) => {
        const ownerSession = notificationCoordinatorOwnerTokenRef.current;
        const ownerSnapshot = accountGuardRef.current.capture();
        if (
          !ownerSession
          || ownerSession.user.id !== ownerId
          || !ownerSnapshot
          || ownerSnapshot.ownerId !== ownerId
        ) throw new StaleAccountRequestError();
        await apiRequest<{ status: "registered" }>(
          "/devices/register",
          {
            method: "POST",
            body: JSON.stringify({ platform, token, deviceId: currentInstallationId })
          },
          ownerSession.accessToken,
          { ownerSnapshot }
        );
      },
      detachDevice: async ({ ownerId, installationId: currentInstallationId }) => {
        const ownerSession = notificationCoordinatorOwnerTokenRef.current;
        if (!ownerSession || ownerSession.user.id !== ownerId) throw new StaleAccountRequestError();
        await apiRequest<{ status: "unregistered" }>(
          "/devices/current",
          {
            method: "DELETE",
            body: JSON.stringify({ deviceId: currentInstallationId })
          },
          ownerSession.accessToken,
          { skipAuthRefresh: true, detached: true }
        );
      }
    };

    try {
      const coordinator = new NotificationLifecycleCoordinator({
        installationId,
        platform: Platform.OS,
        permissionAdapter: new ExpoNotificationPermissionAdapter(),
        tokenAdapter: new FirebaseNotificationTokenAdapter(),
        backendAdapter
      });
      notificationCoordinatorRef.current = coordinator;
      notificationUnsubscribeRef.current = coordinator.subscribe((state) => {
        setNotificationLifecycle(state);
        const rotationEligible = state.preferenceEnabled && state.permission === "granted";
        if (rotationEligible && !notificationRotationUnsubscribeRef.current) {
          notificationRotationUnsubscribeRef.current = coordinator.startTokenRotationListener();
        } else if (!rotationEligible && notificationRotationUnsubscribeRef.current) {
          notificationRotationUnsubscribeRef.current();
          notificationRotationUnsubscribeRef.current = null;
        }
        const foregroundEligible = state.active;
        if (foregroundEligible && !notificationForegroundUnsubscribeRef.current) {
          notificationForegroundUnsubscribeRef.current = subscribeToForegroundRemoteNotifications();
        } else if (!foregroundEligible && notificationForegroundUnsubscribeRef.current) {
          notificationForegroundUnsubscribeRef.current();
          notificationForegroundUnsubscribeRef.current = null;
        }
        if (state.preferenceEnabled && state.registration === "error") {
          const currentSession = sessionRef.current;
          if (currentSession?.user.id === state.ownerId) {
            void disableNotificationDeliveryFailClosed(currentSession, coordinator).catch(() => {
              setAlarmEnabled(false);
              setCleanupIssue({
                action: "notification_settings",
                failedTargets: ["device_registration"],
                ownerId: currentSession.user.id
              });
              setMessage({
                text: "Cihaz kaydı doğrulanamadığı için bildirim teslimatı güvenli biçimde kapatılamadı. Lütfen tekrar dene.",
                tone: "error"
              });
            });
          }
        }
      });
      configureForegroundNotificationPresentation();
      void configureAndroidNotificationChannels().catch(() => undefined);
      return coordinator;
    } catch {
      setNotificationLifecycle({
        schemaVersion: 1,
        ownerId: null,
        preferenceEnabled: false,
        permission: "unavailable",
        registration: "error",
        active: false,
        errorCode: "token_unavailable"
      });
      return null;
    }
  }

  async function persistPendingNotificationDestination(
    record: ReturnType<typeof createPendingNotificationDestinationRecord> | null
  ): Promise<void> {
    await enqueueStorageMutation(async () => {
      if (!record) {
        await deleteStoredValue(PENDING_NOTIFICATION_STORAGE_KEY);
        return;
      }
      await setStoredValue(
        PENDING_NOTIFICATION_STORAGE_KEY,
        serializePendingNotificationDestinationRecord(record)
      );
    });
  }

  async function readPendingNotificationDestination(): Promise<ReturnType<typeof createPendingNotificationDestinationRecord> | null> {
    return enqueueStorageMutation(async () => {
      const stored = await getStoredValue(PENDING_NOTIFICATION_STORAGE_KEY);
      const record = parsePendingNotificationDestinationRecord(stored);
      if (stored && !record) await deleteStoredValue(PENDING_NOTIFICATION_STORAGE_KEY);
      return record;
    });
  }

  async function pendingNotificationDestinationIsCurrent(
    expected: ReturnType<typeof createPendingNotificationDestinationRecord>
  ): Promise<boolean> {
    return enqueueStorageMutation(async () => {
      const current = parsePendingNotificationDestinationRecord(
        await getStoredValue(PENDING_NOTIFICATION_STORAGE_KEY)
      );
      return isSamePendingNotificationDestinationRecord(current, expected);
    });
  }

  async function clearPendingNotificationDestinationIfCurrent(
    expected: ReturnType<typeof createPendingNotificationDestinationRecord>
  ): Promise<boolean> {
    return enqueueStorageMutation(async () => {
      const current = parsePendingNotificationDestinationRecord(
        await getStoredValue(PENDING_NOTIFICATION_STORAGE_KEY)
      );
      if (!isSamePendingNotificationDestinationRecord(current, expected)) return false;
      await deleteStoredValue(PENDING_NOTIFICATION_STORAGE_KEY);
      return true;
    });
  }

  async function resolvePendingNotificationForSession(
    record: ReturnType<typeof createPendingNotificationDestinationRecord>,
    currentSession: SessionPayload,
    ownerSnapshot: AccountGenerationSnapshot
  ): Promise<void> {
    let destinationTitle: string | undefined;
    let destinationAnnouncement: AnnouncementRecord | undefined;
    let destinationCalendarEvent: EventRecord | undefined;
    const resolution = await resolveNotificationDestination({
      record,
      currentOwner: { ownerId: ownerSnapshot.ownerId, generation: ownerSnapshot.generation },
      getCurrentOwner: () => {
        const current = accountGuardRef.current.capture();
        return current ? { ownerId: current.ownerId, generation: current.generation } : null;
      },
      isAvailable: async (destination) => {
        if (destination.type === "calendar_event") {
          let payload: EventRecord;
          try {
            payload = await apiRequest<EventRecord>(
              `/calendar/my/trusted/${encodeURIComponent(destination.id)}`,
              {},
              currentSession.accessToken,
              { ownerSnapshot }
            );
          } catch (error) {
            if (error instanceof ApiRequestError && error.status === 404) return false;
            throw error;
          }
          const match = normalizeEventRecordsForDisplay([payload])
            .find((event) => event.id === destination.id);
          if (match) {
            destinationTitle = match.title;
            destinationCalendarEvent = match;
          }
          return Boolean(match);
        }

        let payload: AnnouncementApiRecord;
        try {
          payload = await apiRequest<AnnouncementApiRecord>(
            `/announcements/my/trusted/${encodeURIComponent(destination.id)}`,
            {},
            currentSession.accessToken,
            { ownerSnapshot }
          );
        } catch (error) {
          if (error instanceof ApiRequestError && error.status === 404) return false;
          throw error;
        }
        const normalized = normalizeTrustedApiContentCollection([payload]);
        const match = normalized.items.find((item) => item.id === destination.id);
        if (match) {
          destinationTitle = match.title;
          destinationAnnouncement = match;
        }
        setAnnouncements((previous) => ({
          loading: false,
          data: appendTrustedContentItems(previous.data, normalized.items),
          attempted: true,
          stale: false
        }));
        return Boolean(match);
      }
    });

    if (resolution.status === "ignored") return;
    if (
      !accountGuardRef.current.isCurrent(ownerSnapshot)
      || sessionRef.current?.user.id !== ownerSnapshot.ownerId
    ) return;
    if (resolution.status === "unavailable") {
      if (resolution.reason === "lookup_error") {
        if (!await pendingNotificationDestinationIsCurrent(record)) return;
        if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
        setNotificationDestinationNotice({
          status: "temporarily_unavailable",
          destination: resolution.destination
        });
        return;
      }
      if (!await clearPendingNotificationDestinationIfCurrent(record).catch(() => false)) return;
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
      setNotificationDestinationNotice({ status: "unavailable", destination: resolution.destination });
      return;
    }
    if (resolution.status === "open") {
      if (!await pendingNotificationDestinationIsCurrent(record).catch(() => false)) return;
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
      const notificationIntent = createVerifiedNotificationIntent(resolution.destination);
      const enqueueResult = routeIntentCoordinatorRef.current.enqueue(notificationIntent, ownerSnapshot);
      if (enqueueResult !== "enqueued" && enqueueResult !== "promoted") {
        const inFlightRequest = notificationNavigationRequestRef.current;
        if (
          enqueueResult === "deduplicated"
          && inFlightRequest
          && accountGuardRef.current.isCurrent(inFlightRequest.ownerSnapshot)
          && inFlightRequest.record.destination.type === record.destination.type
          && inFlightRequest.record.destination.id === record.destination.id
        ) {
          // The newest duplicate replaced the durable record. Keep it until the
          // already-mounted semantic destination acknowledges its visible leaf.
          notificationNavigationRequestRef.current = { ...inFlightRequest, record };
          return;
        }
        await clearPendingNotificationDestinationIfCurrent(record).catch(() => false);
        return;
      }
      const selectedIntent = routeIntentCoordinatorRef.current.consumeFor(
        ownerSnapshot.ownerId,
        ownerSnapshot.generation
      );
      if (!selectedIntent || selectedIntent.source !== "notification") return;
      const target = navigationTargetForProtectedRoute(selectedIntent.route);
      if (resolution.destination.type === "announcement") {
        announcementDetailRequestGenerationRef.current += 1;
        setActiveTrustedDetail((previous) => previous?.type === "announcement" ? null : previous);
        const detailItem = destinationAnnouncement
          ? contentFeedDetailItem(destinationAnnouncement, "academic")
          : null;
        if (detailItem) {
          setAnnouncementDetailLoad(null);
          setActiveTrustedDetail({
            type: "announcement",
            id: detailItem.record.id,
            title: detailItem.record.title,
            item: detailItem
          });
        } else {
          setAnnouncementDetailLoad({
            id: resolution.destination.id,
            loading: false,
            error: "Güvenilir içerik doğrulanamadı."
          });
        }
      } else if (resolution.destination.type === "calendar_event") {
        announcementDetailRequestGenerationRef.current += 1;
        setAnnouncementDetailLoad(null);
        const detailItem = destinationCalendarEvent
          ? buildCalendarItems({
            academicEvents: [destinationCalendarEvent],
            personalExams: [],
            academicSourceLabel: calendar.data?.calendar.title
              ?? selectedUniversity?.name
              ?? "Resmî akademik takvim"
          })[0]
          : undefined;
        setActiveCalendarDetail(detailItem ?? null);
      }
      const requestKey = requestAppRoute(
        target.route,
        target.params
      );
      notificationNavigationRequestRef.current = { requestKey, record, ownerSnapshot };
      setNotificationDestinationNotice({
        status: "opened",
        destination: resolution.destination,
        ...(destinationTitle ? { title: destinationTitle } : {})
      });
      setActiveTab(target.legacyTab);
    }
  }

  async function receiveNotificationDestination(parsed: ParsedNotificationDestination | null): Promise<void> {
    if (!parsed) return;
    const record = createPendingNotificationDestinationRecord({
      destination: parsed.destination,
      ownerId: parsed.recipientOwnerId
    });
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot) {
      try {
        await persistPendingNotificationDestination(record);
      } catch {
        setMessage({
          text: "Bildirim hedefi bu cihazda saklanamadı. Bildirimi yeniden açmayı deneyebilirsin.",
          tone: "error"
        });
        return;
      }
      const resumedSession = sessionRef.current;
      const resumedSnapshot = accountGuardRef.current.capture();
      if (
        resumedSession?.user.id === record.ownerId
        && resumedSnapshot?.ownerId === record.ownerId
      ) {
        await resolvePendingNotificationForSession(record, resumedSession, resumedSnapshot);
      }
      return;
    }
    if (ownerSnapshot.ownerId !== record.ownerId || currentSession.user.id !== record.ownerId) {
      await clearPendingNotificationDestinationIfCurrent(record).catch(() => false);
      return;
    }
    try {
      await persistPendingNotificationDestination(record);
    } catch {
      setMessage({
        text: "Bildirim hedefi bu cihazda saklanamadı. Bildirimi yeniden açmayı deneyebilirsin.",
        tone: "error"
      });
      return;
    }
    await resolvePendingNotificationForSession(record, currentSession, ownerSnapshot);
  }

  function invalidateAnnouncementDetailOwnership(): void {
    announcementDetailRequestGenerationRef.current += 1;
    announcementSaveRequestGenerationRef.current += 1;
    setAnnouncementDetailLoad(null);
    setAnnouncementSaveStatus(null);
    setActiveTrustedDetail((previous) => previous?.type === "announcement" ? null : previous);
  }

  function invalidateContentFeedOwnership(): void {
    contentFeedAbortControllerRef.current?.abort();
    contentFeedAbortControllerRef.current = null;
    contentFeedRequestCoordinatorRef.current.reset();
    setAnnouncements((previous) => settleContentFeedLoading(previous));
    setYokAnnouncements((previous) => settleContentFeedLoading(previous));
    setSummerSchool((previous) => settleContentFeedLoading(previous));
    setContentFeedPagination({ loading: false });
    invalidateAnnouncementDetailOwnership();
  }

  function openContentFeedItem(item: ContentFeedItem): void {
    announcementDetailRequestGenerationRef.current += 1;
    setAnnouncementDetailLoad(null);
    setActiveTrustedDetail({
      type: "announcement",
      id: item.record.id,
      title: item.record.title,
      item
    });
    loadAnnouncementSavedStatus(item.record.id);
    requestAppRoute("AnnouncementDetail", { announcementId: item.record.id });
  }

  function loadAnnouncementSavedStatus(announcementId: string): void {
    const requestGeneration = ++announcementSaveRequestGenerationRef.current;
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    setAnnouncementSaveStatus({
      id: announcementId,
      saved: false,
      loading: true,
      mutating: false
    });
    if (!currentSession || !ownerSnapshot || currentSession.user.id !== ownerSnapshot.ownerId) {
      setAnnouncementSaveStatus({
        id: announcementId,
        saved: false,
        loading: false,
        mutating: false,
        error: "Kaydetme durumu doğrulanamadı."
      });
      return;
    }

    void apiRequest<SavedAnnouncementApiStatus>(
      `/announcements/my/saved/${encodeURIComponent(announcementId)}`,
      {},
      currentSession.accessToken,
      { ownerSnapshot }
    ).then((payload) => {
      if (
        requestGeneration !== announcementSaveRequestGenerationRef.current
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
        || payload.announcementId !== announcementId
      ) return;
      setAnnouncementSaveStatus({
        id: announcementId,
        saved: payload.saved === true,
        loading: false,
        mutating: false
      });
    }).catch((error: unknown) => {
      if (
        error instanceof StaleAccountRequestError
        || requestGeneration !== announcementSaveRequestGenerationRef.current
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
      ) return;
      setAnnouncementSaveStatus({
        id: announcementId,
        saved: false,
        loading: false,
        mutating: false,
        error: "Kaydetme durumu şu anda yüklenemedi."
      });
    });
  }

  async function toggleAnnouncementSaved(announcementId: string): Promise<void> {
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    const current = announcementSaveStatus?.id === announcementId
      ? announcementSaveStatus
      : null;
    if (!currentSession || !ownerSnapshot || currentSession.user.id !== ownerSnapshot.ownerId || current?.mutating) return;
    const targetSaved = !current?.saved;
    const requestGeneration = ++announcementSaveRequestGenerationRef.current;
    setAnnouncementSaveStatus({
      id: announcementId,
      saved: current?.saved ?? false,
      loading: false,
      mutating: true
    });
    try {
      const payload = await trackAuthenticatedMutation(() => apiRequest<SavedAnnouncementApiStatus>(
        `/announcements/my/saved/${encodeURIComponent(announcementId)}`,
        { method: targetSaved ? "PUT" : "DELETE" },
        currentSession.accessToken,
        { ownerSnapshot }
      ));
      if (
        requestGeneration !== announcementSaveRequestGenerationRef.current
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
        || payload.announcementId !== announcementId
        || payload.saved !== targetSaved
      ) return;
      setAnnouncementSaveStatus({
        id: announcementId,
        saved: targetSaved,
        loading: false,
        mutating: false
      });
    } catch (error) {
      if (
        error instanceof StaleAccountRequestError
        || requestGeneration !== announcementSaveRequestGenerationRef.current
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
      ) return;
      setAnnouncementSaveStatus({
        id: announcementId,
        saved: current?.saved ?? false,
        loading: false,
        mutating: false,
        error: targetSaved
          ? "Duyuru kaydedilemedi. Lütfen tekrar dene."
          : "Duyuru kayıtlı içeriklerden çıkarılamadı. Lütfen tekrar dene."
      });
    }
  }

  function loadProtectedAnnouncementDetail(announcementId: string): void {
    loadAnnouncementSavedStatus(announcementId);
    const requestGeneration = ++announcementDetailRequestGenerationRef.current;
    const cachedItem = buildContentFeed({
      academic: announcementFeed,
      yok: [],
      summerSchool: []
    }).find((item) => item.record.id === announcementId);

    setActiveTrustedDetail((previous) => previous?.type === "announcement" ? null : previous);
    if (cachedItem) {
      setAnnouncementDetailLoad(null);
      setActiveTrustedDetail({
        type: "announcement",
        id: cachedItem.record.id,
        title: cachedItem.record.title,
        item: cachedItem
      });
      return;
    }

    setAnnouncementDetailLoad({ id: announcementId, loading: true });
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot || currentSession.user.id !== ownerSnapshot.ownerId) {
      setAnnouncementDetailLoad({
        id: announcementId,
        loading: false,
        error: "Güvenilir içerik doğrulanamadı."
      });
      return;
    }

    void apiRequest<AnnouncementApiRecord>(
      `/announcements/my/trusted/${encodeURIComponent(announcementId)}`,
      {},
      currentSession.accessToken,
      { ownerSnapshot }
    ).then((payload) => {
      if (
        requestGeneration !== announcementDetailRequestGenerationRef.current
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
      ) return;
      const record = normalizeTrustedApiContentCollection([payload]).items
        .find((item) => item.id === announcementId);
      const detailItem = record ? contentFeedDetailItem(record, "academic") : null;
      if (!detailItem) {
        setAnnouncementDetailLoad({
          id: announcementId,
          loading: false,
          error: "Güvenilir içerik doğrulanamadı."
        });
        return;
      }
      setActiveTrustedDetail({
        type: "announcement",
        id: detailItem.record.id,
        title: detailItem.record.title,
        item: detailItem
      });
      setAnnouncementDetailLoad(null);
    }).catch((error: unknown) => {
      if (
        error instanceof StaleAccountRequestError
        || requestGeneration !== announcementDetailRequestGenerationRef.current
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
      ) return;
      setAnnouncementDetailLoad({
        id: announcementId,
        loading: false,
        error: "Güvenilir içerik şu anda yüklenemedi."
      });
    });
  }

  function openProtectedAppRoute(route: ProtectedAppRoute): void {
    if (route.name === "AnnouncementDetail") {
      loadProtectedAnnouncementDetail(route.params.announcementId);
    } else if (route.name === "CalendarEventDetail") {
      invalidateAnnouncementDetailOwnership();
    }
    const target = navigationTargetForProtectedRoute(route);
    setActiveTab(target.legacyTab);
    requestAppRoute(target.route, target.params);
  }

  function dispatchProtectedRouteIntent(
    intent: AppRouteIntent,
    ownerSnapshot: AccountGenerationSnapshot
  ): boolean {
    if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return false;
    const result = routeIntentCoordinatorRef.current.enqueue(intent, ownerSnapshot);
    if (result !== "enqueued" && result !== "promoted") return false;
    const selected = routeIntentCoordinatorRef.current.consumeFor(
      ownerSnapshot.ownerId,
      ownerSnapshot.generation
    );
    if (!selected) return false;
    if (selected.route.name === "Unknown") {
      requestAppRoute("UnknownRoute");
      return true;
    }
    openProtectedAppRoute(selected.route);
    return true;
  }

  function receiveAcademicPulseUrl(url: unknown): void {
    const resolution = parseAcademicPulseRouteUrl(url);
    if (resolution.kind === "notification") {
      void receiveNotificationDestination(resolution.notification);
      return;
    }

    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    const exactOwner = currentSession && ownerSnapshot && currentSession.user.id === ownerSnapshot.ownerId
      ? ownerSnapshot
      : null;
    if (
      hydrationStatusRef.current !== "ready"
      || navigatorRootSurface !== "authenticated"
      || authOperationInProgressRef.current
      || busy
      || !exactOwner
    ) {
      pendingDeepLinkRouteRef.current = { route: resolution.route, owner: exactOwner };
      return;
    }
    pendingDeepLinkRouteRef.current = null;
    dispatchProtectedRouteIntent({ source: "deep_link", route: resolution.route }, exactOwner);
  }

  function resumePendingDeepLinkIfEligible(): void {
    const pending = pendingDeepLinkRouteRef.current;
    if (!pending || hydrationStatusRef.current !== "ready") return;
    if (navigatorRootSurface !== "authenticated" || authOperationInProgressRef.current || busy) return;
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot || currentSession.user.id !== ownerSnapshot.ownerId) return;
    if (
      pending.owner
      && (
        pending.owner.ownerId !== ownerSnapshot.ownerId
        || pending.owner.generation !== ownerSnapshot.generation
      )
    ) {
      pendingDeepLinkRouteRef.current = null;
      return;
    }
    pendingDeepLinkRouteRef.current = { ...pending, owner: ownerSnapshot };
    pendingDeepLinkRouteRef.current = null;
    dispatchProtectedRouteIntent({ source: "deep_link", route: pending.route }, ownerSnapshot);
  }

  async function restorePendingNotificationForSession(
    currentSession: SessionPayload,
    ownerSnapshot: AccountGenerationSnapshot
  ): Promise<void> {
    const record = await readPendingNotificationDestination();
    if (!record) return;
    if (record.ownerId !== currentSession.user.id) {
      await clearPendingNotificationDestinationIfCurrent(record);
      return;
    }
    await resolvePendingNotificationForSession(record, currentSession, ownerSnapshot);
  }

  async function retryPendingNotificationDestination(): Promise<void> {
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot) return;
    await restorePendingNotificationForSession(currentSession, ownerSnapshot).catch(() => {
      setNotificationDestinationNotice((previous) => previous
        ? { ...previous, status: "temporarily_unavailable" }
        : previous);
    });
  }

  useEffect(() => {
    void hydrateApplication();
  }, []);

  useEffect(() => {
    if (!message || navigatorRootSurface !== "authenticated") return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message, navigatorRootSurface]);

  useEffect(() => {
    setActiveRoute((current) => {
      if (navigatorRootSurface !== "authenticated") return expectedBaseRoute;
      return routeBelongsToLegacyTab(current, activeTab) ? current : expectedBaseRoute;
    });
  }, [activeTab, authMode, authStage, expectedBaseRoute, navigatorRootSurface]);

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
    sessionRef.current = session;
    notificationCoordinatorOwnerTokenRef.current = session;
  }, [session]);

  useEffect(() => {
    hydrationStatusRef.current = hydrationStatus;
  }, [hydrationStatus]);

  useEffect(() => () => {
    notificationUnsubscribeRef.current?.();
    notificationRotationUnsubscribeRef.current?.();
    notificationForegroundUnsubscribeRef.current?.();
    notificationCoordinatorRef.current?.dispose();
    notificationCoordinatorRef.current = null;
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android" && Platform.OS !== "ios") return;
    const tapAdapter = new FirebaseNotificationTapAdapter();
    notificationTapAdapterRef.current = tapAdapter;
    void tapAdapter.consumeInitialDestination()
      .then((destination) => receiveNotificationDestination(destination))
      .catch(() => undefined);
    const unsubscribeTap = tapAdapter.subscribe((destination) => {
      void receiveNotificationDestination(destination);
    });
    void Linking.getInitialURL().then((url) => {
      if (url) receiveAcademicPulseUrl(url);
    }).catch(() => undefined);
    const linkingSubscription = Linking.addEventListener("url", ({ url }) => {
      receiveAcademicPulseUrl(url);
    });
    return () => {
      unsubscribeTap();
      linkingSubscription.remove();
      notificationTapAdapterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (hydrationStatus !== "ready") return;
    if (notificationNavigationRequestRef.current) {
      pendingDeepLinkRouteRef.current = null;
      return;
    }
    resumePendingDeepLinkIfEligible();
  }, [authStage, authenticatedContextPending, busy, hydrationStatus, session?.user.id]);

  useEffect(() => {
    if (Platform.OS !== "android" && Platform.OS !== "ios") return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      const currentSession = sessionRef.current;
      const coordinator = notificationCoordinatorRef.current;
      if (!currentSession || !coordinator) return;
      void reconcileNotificationDelivery(currentSession, coordinator).catch(async () => {
        if (sessionRef.current?.user.id !== currentSession.user.id) return;
        await coordinator.setPreferenceEnabled(false).catch(() => undefined);
        setAlarmEnabled(false);
        setCleanupIssue({
          action: "notification_settings",
          failedTargets: ["device_registration"],
          ownerId: currentSession.user.id
        });
        setMessage({
          text: "Bildirim durumu yenilenemediği için teslimat etkin gösterilmiyor. Bağlantını kontrol edip tekrar dene.",
          tone: "error"
        });
      });
    });
    return () => subscription.remove();
  }, []);

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
    setNotificationPreferenceOutcome((current) => current === "error" ? current : "saved");
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
    const announcementsExperienceVisible = activeTab === "announcements"
      || activeTab === "yok"
      || activeTab === "summer";
    if (!announcementsExperienceVisible) return;

    if (!yokAnnouncements.loading && !yokAnnouncements.data) {
      void loadYokAnnouncements(true, contentFeedLimit);
    }

    if (registerUniversityId && !summerSchool.loading && !summerSchool.data) {
      void loadSummerSchool();
    }
  }, [activeTab, contentFeedLimit, session?.user.id, registerUniversityId]);

  useEffect(() => {
    const needsPublicCatalog = (authMode === "register" && authStage === "auth")
      || authStage === "academic_onboarding"
      || (Boolean(session) && (
        controlledActiveRoute === "Profile"
        || controlledActiveRoute === "AcademicProfileSettings"
      ));
    if (!needsPublicCatalog) return;

    if (!(universities.data?.length) && !universities.loading && !universities.attempted) {
      void loadUniversities();
    }
  }, [
    authMode,
    authStage,
    controlledActiveRoute,
    session?.user.id,
    universities.attempted,
    universities.data?.length,
    universities.loading
  ]);

  async function hydrateApplication(): Promise<void> {
    if (hydrationInProgressRef.current) return;
    hydrationInProgressRef.current = true;
    setHydrationStatus("loading");
    setPreloginWelcomeGate("loading");
    setHydrationError(null);
    setCleanupIssue(null);
    try {
      await restoreDeviceId();
      const [storedWelcomeCompletion, storedSessionValue] = await Promise.all([
        getStoredValue(PRELOGIN_WELCOME_COMPLETION_STORAGE_KEY),
        getStoredValue(SESSION_STORAGE_KEY),
      ]);
      const resolvedWelcomeGate = resolvePreloginWelcomeGate({
        storedCompletion: storedWelcomeCompletion,
        storedSession: storedSessionValue,
      });
      if (resolvedWelcomeGate === "restorable_session") {
        setPreloginWelcomeGate("completed");
        await setStoredValue(
          PRELOGIN_WELCOME_COMPLETION_STORAGE_KEY,
          PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE,
        ).catch(() => undefined);
      } else {
        setPreloginWelcomeGate(resolvedWelcomeGate);
      }
      let restoredSession = await restoreSession();
      const recoverableTargets: AccountCleanupTarget[] = [];

      if (restoredSession) {
        const storedSession = restoredSession;
        const snapshot = accountGuardRef.current.activate(storedSession.user.id);
        setSessionOwner(snapshot);
        googleLifecycleGuardRef.current.activate(storedSession.user.id);
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
            notificationCoordinatorOwnerTokenRef.current = refreshedSession;
            setSession(refreshedSession);
            setActiveTab("home");
            setActiveRoute("Home");
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
          personalExamRuntime.reset();
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
        setSessionOwner(null);
        personalExamRuntime.reset();
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

      if (restoredSession) {
        void loadUniversities();
        const snapshot = accountGuardRef.current.capture();
        if (snapshot) {
          const contextReady = await bootstrapAuthenticatedContext(restoredSession.accessToken, snapshot);
          if (!contextReady && sessionRef.current?.user.id === restoredSession.user.id) {
            setHydrationError("Hesap bağlamı hazırlanamadı. Bağlantını kontrol edip tekrar dene.");
            setHydrationStatus("error");
            return;
          }
          if (accountGuardRef.current.isCurrent(snapshot)) {
            await restorePendingNotificationForSession(restoredSession, snapshot).catch(() => {
              recoverableTargets.push("pending_notification_storage");
            });
          }
        }
      } else {
        // Public catalog data is useful on Register, but must not delay the
        // fixed first-launch introduction or Login becoming interactive.
        void loadUniversities();
      }
      setHydrationStatus("ready");
    } catch {
      abortAuthenticatedRequests();
      accountGuardRef.current.invalidate();
      setSessionOwner(null);
      sessionRef.current = null;
      notificationCoordinatorOwnerTokenRef.current = null;
      setSession(null);
      personalExamRuntime.reset();
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
    notificationCoordinatorOwnerTokenRef.current = parsed;
    setAccountAuthProvider(normalizeAccountAuthProvider(parsed.user.authProvider));
    setSession(parsed);
    return parsed;
  }

  async function restoreDeviceId(): Promise<string> {
    const stored = await getStoredValue(DEVICE_ID_STORAGE_KEY);
    if (stored) {
      deviceIdRef.current = stored;
      setDeviceId(stored);
      ensureNotificationCoordinator(stored);
      return stored;
    }

    const created = createLocalId("rn-device");
    await setStoredValue(DEVICE_ID_STORAGE_KEY, created);
    deviceIdRef.current = created;
    setDeviceId(created);
    ensureNotificationCoordinator(created);
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
    const snapshot = ownerSnapshot ?? accountGuardRef.current.capture();
    if (!snapshot) throw new StaleAccountRequestError();
    try {
      const result = await personalExamRuntime.hydrate(ownerId, snapshot);
      if (result.legacyDiscarded) {
        setMessage({
          text: "Sahibi doğrulanamayan eski cihaz sınavları güvenlik için bu hesaba aktarılmadı.",
          tone: "info"
        });
      }
    } catch (error) {
      if (error instanceof StalePersonalExamOperationError) throw new StaleAccountRequestError();
      throw error;
    }
  }

  async function restoreGoogleCalendarConnection(
    ownerId?: string,
    ownerSnapshot?: AccountGenerationSnapshot | null
  ): Promise<void> {
    if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
    setGoogleCalendarIntegration(null);
    setGoogleCalendarLastResult(null);
    setGoogleCalendarWarnings([]);
    setGoogleCalendarError(null);
    setGoogleCalendarState(ownerId ? "checking" : "disconnected");
    const legacy = await getStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY);
    if (!ownerId) {
      if (legacy) await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY);
      setGoogleCalendarState("disconnected");
      return;
    }

    const storageKey = createGoogleCalendarStorageKey(ownerId);
    const v2StorageKey = createGoogleCalendarV2StorageKey(ownerId);
    const stored = await getStoredValue(storageKey);
    const storedV2 = await getStoredValue(v2StorageKey);
    const parsedV3 = stored ? readGoogleCalendarConnectionRecordV3(stored, ownerId) : null;
    const legacyCandidate = storedV2 ?? legacy;
    let parsedLegacy: LegacyGoogleCalendarConnectionRecord | null = null;
    try {
      const parsed = legacyCandidate ? JSON.parse(legacyCandidate) as Partial<LegacyGoogleCalendarConnectionRecord> : null;
      parsedLegacy = parsed
        && parsed.ownerId === ownerId
        && typeof parsed.accountEmail === "string"
        && Boolean(parsed.accountEmail.trim())
        && typeof parsed.lastSyncedAt === "string"
        && !Number.isNaN(Date.parse(parsed.lastSyncedAt))
        ? parsed as LegacyGoogleCalendarConnectionRecord
        : null;
    } catch {
      parsedLegacy = null;
    }
    if (!parsedV3 && !parsedLegacy) {
      await enqueueStorageMutation(async () => {
        if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
        if (stored) await deleteStoredValue(storageKey);
        if (storedV2) await deleteStoredValue(v2StorageKey);
        if (legacy) await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY);
      });
      setGoogleCalendarState("disconnected");
      return;
    }

    if (parsedV3?.state === "disconnected") {
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      setGoogleCalendarIntegration(parsedV3);
      setGoogleCalendarState("disconnected");
      await enqueueStorageMutation(async () => {
        if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
        await deleteStoredValue(v2StorageKey).catch(() => undefined);
        await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY).catch(() => undefined);
      });
      return;
    }

    if (!GOOGLE_AUTH_CONFIGURED) {
      if (parsedV3) setGoogleCalendarIntegration({ ...parsedV3, state: "expired" });
      setGoogleCalendarState("expired");
      return;
    }

    const restoreController = new AbortController();
    authenticatedRequestControllersRef.current.add(restoreController);
    try {
      const authorization = await readCurrentGoogleCalendarAuthorization();
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      if (
        (parsedV3 && parsedV3.googleAccountId !== authorization.googleAccountId)
        || (parsedLegacy && parsedLegacy.accountEmail.trim().toLowerCase() !== authorization.accountEmail.trim().toLowerCase())
      ) {
        throw new Error("GOOGLE_CALENDAR_ACCOUNT_MISMATCH");
      }
      const verification = await googleCalendarService.verifyAuthorization({
        accessToken: authorization.accessToken,
        ownerId,
        signal: restoreController.signal
      });
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      const record: GoogleCalendarConnectionRecordV3 = {
        schemaVersion: GOOGLE_CALENDAR_CONNECTION_SCHEMA_VERSION,
        ownerId,
        googleAccountId: authorization.googleAccountId,
        accountEmail: authorization.accountEmail,
        state: "connected",
        authorizationVerifiedAt: new Date().toISOString(),
        ...(parsedV3?.lastSyncedAt
          ? { lastSyncedAt: parsedV3.lastSyncedAt }
          : parsedLegacy?.lastSyncedAt
            ? { lastSyncedAt: parsedLegacy.lastSyncedAt }
            : {}),
        mappings: verification.mappings
      };
      await enqueueStorageMutation(async () => {
        if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) {
          throw new StaleAccountRequestError();
        }
        await persistGoogleCalendarConnection(record);
        await deleteStoredValue(v2StorageKey).catch(() => undefined);
        await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY).catch(() => undefined);
      });
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      setGoogleCalendarIntegration(record);
      setGoogleCalendarState("connected");
    } catch (error) {
      if (error instanceof StaleAccountRequestError || (error instanceof Error && error.name === "AbortError")) {
        throw new StaleAccountRequestError();
      }
      if (!parsedV3) {
        await enqueueStorageMutation(async () => {
          if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
          await deleteStoredValue(v2StorageKey).catch(() => undefined);
          await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY).catch(() => undefined);
        });
      } else {
        const state: GoogleCalendarLifecycleState = error instanceof GoogleCalendarSyncError
          && error.code !== "GOOGLE_CALENDAR_AUTH_EXPIRED"
          ? "error"
          : "expired";
        setGoogleCalendarIntegration({ ...parsedV3, state });
        setGoogleCalendarState(state);
      }
      setGoogleCalendarError(
        error instanceof Error && error.message === "GOOGLE_CALENDAR_ACCOUNT_MISMATCH"
          ? "Google hesabı değişmiş. Devam etmek için hesabını yeniden seç."
          : "Google Takvim bağlantısı canlı olarak doğrulanamadı. Yeniden bağlanabilirsin."
      );
      if (!parsedV3) setGoogleCalendarState("disconnected");
    } finally {
      authenticatedRequestControllersRef.current.delete(restoreController);
    }
  }

  function enqueueStorageMutation<T>(action: () => Promise<T>): Promise<T> {
    const next = storageMutationQueueRef.current.catch(() => undefined).then(action);
    storageMutationQueueRef.current = next.then(() => undefined, () => undefined);
    return next;
  }

  function enqueueGoogleSdkOperation<T>(action: () => Promise<T>): Promise<T> {
    const next = googleSdkQueueRef.current.catch(() => undefined).then(action);
    googleSdkQueueRef.current = next.then(() => undefined, () => undefined);
    return next;
  }

  function readCurrentGoogleCalendarAuthorization(): Promise<{
    accessToken: string;
    accountEmail: string;
    googleAccountId: string;
  }> {
    return enqueueGoogleSdkOperation(async () => {
      const currentUser = GoogleSignin.getCurrentUser();
      if (!currentUser?.user.id || !currentUser.user.email) throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
      const tokens = await GoogleSignin.getTokens();
      if (!tokens.accessToken) throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
      return {
        accessToken: tokens.accessToken,
        accountEmail: currentUser.user.email,
        googleAccountId: currentUser.user.id
      };
    });
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

  function queueGoogleSignOut(signal?: AbortSignal): Promise<void> {
    if (!GOOGLE_AUTH_CONFIGURED) return Promise.resolve();
    const epoch = googleSdkEpochRef.current;
    return enqueueGoogleSdkOperation(async () => {
      if (signal?.aborted || googleSdkEpochRef.current !== epoch) return;
      await GoogleSignin.signOut();
    });
  }

  function revokeGoogleCalendarAccessForConnection(
    connection: GoogleCalendarConnectionRecordV3,
    signal?: AbortSignal
  ): Promise<void> {
    return enqueueGoogleSdkOperation(async () => {
      if (signal?.aborted) throw Object.assign(new Error("Google cleanup aborted."), { name: "AbortError" });
      const currentUser = GoogleSignin.getCurrentUser();
      if (!currentUser?.user.id || currentUser.user.id !== connection.googleAccountId) {
        throw new Error("GOOGLE_CALENDAR_ACCOUNT_MISMATCH");
      }
      const tokens = await GoogleSignin.getTokens();
      if (signal?.aborted) throw Object.assign(new Error("Google cleanup aborted."), { name: "AbortError" });
      if (!tokens.accessToken || GoogleSignin.getCurrentUser()?.user.id !== connection.googleAccountId) {
        throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
      }
      await GoogleSignin.revokeAccess();
    });
  }

  async function persistGoogleCalendarConnection(
    record: GoogleCalendarConnectionRecordV3 | null,
    ownerId = record?.ownerId
  ): Promise<void> {
    if (!record) {
      if (ownerId) {
        await deleteStoredValue(createGoogleCalendarStorageKey(ownerId));
        await deleteStoredValue(createGoogleCalendarV2StorageKey(ownerId));
      }
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
    googleLifecycleGuardRef.current.invalidate();
    const previousOwner = accountGuardRef.current.capture();
    accountGuardRef.current.invalidate();
    setSessionOwner(null);
    onboardingOwnerRef.current = null;
    onboardingSaveAttemptRef.current += 1;
    routeIntentCoordinatorRef.current.invalidate();
    if (
      previousOwner
      && pendingDeepLinkRouteRef.current?.owner
      && pendingDeepLinkRouteRef.current.owner.ownerId === previousOwner.ownerId
      && pendingDeepLinkRouteRef.current.owner.generation === previousOwner.generation
    ) {
      pendingDeepLinkRouteRef.current = null;
    }
    abortAuthenticatedRequests();
    refreshSessionPromiseRef.current = null;
    notificationNavigationRequestRef.current = null;
    clearNavigationRequest();
  }

  async function activateSession(nextSession: SessionPayload): Promise<AccountGenerationSnapshot> {
    setAuthenticatedContextPending(true);
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
    googleLifecycleGuardRef.current.activate(nextSession.user.id);
    const failedTargets: AccountCleanupTarget[] = [];
    try {
      await restoreManualExams(nextSession.user.id, snapshot);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) throw error;
      personalExamRuntime.reset();
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
    notificationCoordinatorOwnerTokenRef.current = nextSession;
    setAccountAuthProvider(normalizeAccountAuthProvider(nextSession.user.authProvider));
    setSession(nextSession);
    setSessionOwner(snapshot);
    setActiveTab("home");
    setActiveRoute("Home");
    await restorePendingNotificationForSession(nextSession, snapshot).catch(() => {
      failedTargets.push("pending_notification_storage");
    });
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
      const emergencyResult = await runObservableAccountCleanup([
        { target: "device_registration", run: () => detachNotificationOwnerForCleanup() },
        { target: "pending_notification_storage", run: () => persistPendingNotificationDestination(null) },
        { target: "in_memory_state", run: () => clearAuthenticatedMemory() }
      ]);
      reportCleanupResult("session_expiry", {
        complete: false,
        attemptedCount: sessionStorageResult.attemptedCount + emergencyResult.attemptedCount,
        succeededTargets: emergencyResult.succeededTargets,
        failedTargets: [...sessionStorageResult.failedTargets, ...emergencyResult.failedTargets]
      }, ownerId);
      setHydrationError("Süresi dolan oturum cihazdan güvenli biçimde kaldırılamadı. Depolama erişimini kontrol edip tekrar dene.");
      setHydrationStatus("error");
      accountCleanupInProgressRef.current = false;
      setBusy(false);
      return;
    }
    const result = await runObservableAccountCleanup([
      {
        target: "device_registration",
        run: async () => {
          await detachNotificationOwnerForCleanup();
        }
      },
      {
        target: "pending_notification_storage",
        run: () => persistPendingNotificationDestination(null)
      },
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
          await runAbortableGoogleCleanup((signal) => queueGoogleSignOut(signal));
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
        notificationCoordinatorOwnerTokenRef.current = nextSession;
        setAccountAuthProvider(normalizeAccountAuthProvider(nextSession.user.authProvider));
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
    setter: Dispatch<SetStateAction<Loadable<T>>>,
    action: () => Promise<T>,
    ownerSnapshot: AccountGenerationSnapshot | null = accountGuardRef.current.capture(),
    preserveDataOnRefresh = false,
    isOperationCurrent: () => boolean = () => true
  ): Promise<T | null> {
    if ((ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) || !isOperationCurrent()) return null;
    setter((previous) => preserveDataOnRefresh && previous.data !== undefined
      ? { loading: true, data: previous.data, attempted: true, stale: Boolean(previous.stale) }
      : { loading: true, attempted: true });
    try {
      const data = await action();
      if ((ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) || !isOperationCurrent()) return null;
      setter({ loading: false, data, attempted: true, stale: false });
      return data;
    } catch (error) {
      if (
        error instanceof StaleAccountRequestError
        || (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot))
        || !isOperationCurrent()
      ) {
        return null;
      }
      const message = userMessageFromError(error, "İşlem tamamlanamadı. Lütfen tekrar dene.");
      setter((previous) => preserveDataOnRefresh && previous.data !== undefined
        ? { loading: false, data: previous.data, error: message, attempted: true, stale: true }
        : { loading: false, error: message, attempted: true, stale: false });
      return null;
    }
  }

  function warmAuthenticatedContext(
    token: string,
    profileUniversityId: string,
    ownerSnapshot: AccountGenerationSnapshot
  ): void {
    const preferenceWarmup = async () => {
      const loadedPreferences = await loadPreferences(token, ownerSnapshot);
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
      const coordinator = notificationCoordinatorRef.current;
      const notificationSession = sessionRef.current;
      if (coordinator && loadedPreferences && notificationSession?.user.id === ownerSnapshot.ownerId) {
        await coordinator.activateOwner(ownerSnapshot.ownerId, loadedPreferences.enabled);
        await reconcileNotificationDelivery(
          { ...notificationSession, accessToken: token },
          coordinator,
          loadedPreferences,
          ownerSnapshot
        );
      }
    };
    const contentWarmups = profileUniversityId
      ? [
          loadMyCalendar(token, ownerSnapshot),
          loadUpcoming(token, ownerSnapshot),
          loadAnnouncements(token, profileUniversityId, ownerSnapshot)
        ]
      : [loadAnnouncements(token, "", ownerSnapshot)];

    void Promise.allSettled([preferenceWarmup(), ...contentWarmups]);
  }

  async function bootstrapAuthenticatedContext(
    token: string,
    ownerSnapshot = accountGuardRef.current.capture()
  ): Promise<boolean> {
    if (!ownerSnapshot || !accountGuardRef.current.isCurrent(ownerSnapshot)) return false;
    let profile: UserProfile;
    try {
      profile = await apiRequest<UserProfile>("/me", {}, token, { ownerSnapshot });
    } catch (error) {
      if (error instanceof StaleAccountRequestError || !accountGuardRef.current.isCurrent(ownerSnapshot)) return false;
      if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403 || error.status === 404)) {
        await clearExpiredSession("Bu hesap artık kullanılamıyor. Lütfen farklı bir hesapla giriş yap.");
        return false;
      }
      setMessage({ text: "Hesap bilgileri şu anda yenilenemedi. Bağlantını kontrol edip tekrar dene.", tone: "error" });
      return false;
    }
    if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return false;
    if (profile.id !== ownerSnapshot.ownerId || profile.status !== "active") {
      await clearExpiredSession("Bu hesap artık kullanılamıyor. Lütfen farklı bir hesapla giriş yap.");
      return false;
    }
    const profileUniversityId = profile.universityId ?? "";
    setFullName(profile.fullName);
    setEmail(profile.email);
    setAccountAuthProvider(normalizeAccountAuthProvider(profile.authProvider ?? sessionRef.current?.user.authProvider));
    setSelectedUniversityId(profileUniversityId);
    setRegisterUniversityId(profileUniversityId);
    setRegisterFacultyId(profile.facultyId ?? "");
    setRegisterDepartmentId(profile.departmentId ?? "");
    setRegisterClassLevel(profile.classLevel ?? null);
    setOnboardingInitialDraft(profileDraftFromServer(profile));
    onboardingOwnerRef.current = profileUniversityId ? null : ownerSnapshot;
    setAcademicProfileSaveState("idle");
    setAcademicProfileSaveError(undefined);
    setAuthStage(profileUniversityId ? "auth" : "academic_onboarding");
    warmAuthenticatedContext(token, profileUniversityId, ownerSnapshot);
    return accountGuardRef.current.isCurrent(ownerSnapshot);
  }

  async function handleAuth(): Promise<void> {
    if (accountCleanupInProgressRef.current || authOperationInProgressRef.current) {
      setMessage({ text: "Başka bir hesap işlemi tamamlanıyor. Lütfen kısa bir süre bekle.", tone: "info" });
      return;
    }
    const currentValidation = authMode === "register" ? registrationValidation : loginValidation;
    if (!currentValidation.valid) {
      setMessage({
        text: authMode === "register"
          ? "Kayıt bilgilerini kontrol edip işaretlenen alanları düzelt."
          : "Geçerli e-posta adresini ve şifreni gir.",
        tone: "error"
      });
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
        setMessage(null);
        const contextReady = await bootstrapAuthenticatedContext(nextSession.accessToken, snapshot);
        if (!contextReady) {
          if (sessionRef.current?.user.id === nextSession.user.id) {
            setHydrationError("Hesap bağlamı hazırlanamadı. Bağlantını kontrol edip tekrar dene.");
            setHydrationStatus("error");
          }
          return;
        }
        setAuthenticatedContextPending(false);
        return;
      }

      const registerResult = await apiRequest<RegisterResponse>(
        AUTH_ENDPOINTS.register,
        {
          method: "POST",
          body: JSON.stringify({
            fullName: fullName.trim(),
            email: email.trim().toLowerCase(),
            password,
            passwordConfirmation: registrationPasswordConfirmation
          })
        },
        undefined,
        { authOperation: "register" }
      );

      const record = createPendingVerificationRecord(registerResult);
      setPendingVerification(record);
      setAuthStage("verify");
      setRegistrationPasswordConfirmation("");
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
      setAuthenticatedContextPending(false);
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
      setMessage(null);
      const contextReady = await bootstrapAuthenticatedContext(nextSession.accessToken, snapshot);
      if (!contextReady) {
        if (sessionRef.current?.user.id === nextSession.user.id) {
          setHydrationError("Hesap bağlamı hazırlanamadı. Bağlantını kontrol edip tekrar dene.");
          setHydrationStatus("error");
        }
        return;
      }
      setAuthenticatedContextPending(false);
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
      setAuthenticatedContextPending(false);
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
    if (!isVerificationCodeComplete(verificationToken)) {
      setMessage({ text: "Dört haneli doğrulama kodunu eksiksiz gir.", tone: "error" });
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
      setRegisterUniversityId("");
      setRegisterFacultyId("");
      setRegisterDepartmentId("");
      setRegisterClassLevel(null);
      setOnboardingInitialDraft(EMPTY_ACADEMIC_ONBOARDING_DRAFT);
      setAuthMode("login");
      setAuthStage("auth");
      setMessage({ text: "E-posta doğrulandı. Giriş yaptıktan sonra akademik profilini tamamlayabilirsin.", tone: "success" });
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

  async function saveAcademicOnboarding(): Promise<void> {
    if (authOperationInProgressRef.current || accountCleanupInProgressRef.current) return;
    const activeSession = sessionRef.current;
    const snapshot = accountGuardRef.current.capture();
    const draftOwner = onboardingOwnerRef.current;
    if (
      !activeSession
      || !snapshot
      || !draftOwner
      || activeSession.user.id !== snapshot.ownerId
      || draftOwner.ownerId !== snapshot.ownerId
      || draftOwner.generation !== snapshot.generation
      || !accountGuardRef.current.isCurrent(draftOwner)
    ) {
      setMessage({ text: "Akademik profil yalnızca doğrulanmış etkin oturum için kaydedilebilir.", tone: "error" });
      return;
    }
    const payload = buildAcademicSelectionPayload(academicOnboardingDraft);
    if (!payload) {
      setMessage({ text: "Devam etmek için üniversiteni seç.", tone: "error" });
      return;
    }

    const onboardingAttempt = ++onboardingSaveAttemptRef.current;
    authOperationInProgressRef.current = true;
    try {
      setBusy(true);
      setMessage(null);
      const savedProfile = await trackAuthenticatedMutation(() => apiRequest<UserProfile>(
        "/me/university",
        {
          method: "PATCH",
          body: JSON.stringify(payload)
        },
        activeSession.accessToken,
        { ownerSnapshot: snapshot }
      ));
      if (!accountGuardRef.current.isCurrent(snapshot)) throw new StaleAccountRequestError();
      const authoritativeDraft = profileDraftFromServer(savedProfile);
      if (!authoritativeDraft.universityId) {
        throw new Error("ACADEMIC_PROFILE_CONFIRMATION_FAILED");
      }
      setSelectedUniversityId(authoritativeDraft.universityId);
      setRegisterUniversityId(authoritativeDraft.universityId);
      setRegisterFacultyId(authoritativeDraft.facultyId);
      setRegisterDepartmentId(authoritativeDraft.departmentId);
      setRegisterClassLevel(authoritativeDraft.classLevel);
      setOnboardingInitialDraft(authoritativeDraft);
      setFullName(savedProfile.fullName);
      setEmail(savedProfile.email);
      setAccountAuthProvider(normalizeAccountAuthProvider(savedProfile.authProvider));
      setPassword("");
      setVerificationToken("");
      onboardingOwnerRef.current = null;
      setMessage(null);
      setAuthenticatedContextPending(false);
      setActiveTab("home");
      setActiveRoute("Home");
      setAuthStage("auth");
      warmAuthenticatedContext(activeSession.accessToken, authoritativeDraft.universityId, snapshot);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      if (onboardingSaveAttemptRef.current !== onboardingAttempt) return;
      setMessage({
        text: userMessageFromError(error, "Akademik profil kaydedilemedi. Bilgilerini kontrol edip tekrar dene."),
        tone: "error"
      });
    } finally {
      if (onboardingSaveAttemptRef.current === onboardingAttempt) {
        authOperationInProgressRef.current = false;
        setAuthenticatedContextPending(false);
        setBusy(false);
      }
    }
  }

  function skipAcademicOnboarding(): void {
    const activeSession = sessionRef.current;
    const snapshot = accountGuardRef.current.capture();
    const draftOwner = onboardingOwnerRef.current;
    if (
      !activeSession
      || !snapshot
      || !draftOwner
      || activeSession.user.id !== snapshot.ownerId
      || draftOwner.ownerId !== snapshot.ownerId
      || draftOwner.generation !== snapshot.generation
      || !accountGuardRef.current.isCurrent(draftOwner)
    ) {
      setMessage({ text: "Bu adım yalnızca doğrulanmış etkin oturum için geçilebilir.", tone: "error" });
      return;
    }

    onboardingOwnerRef.current = null;
    setMessage(null);
    setAuthenticatedContextPending(false);
    setActiveTab("home");
    setActiveRoute("Home");
    setAuthStage("auth");
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
      setAuthStage("password_recovery_code");
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

  function continuePasswordRecoveryCode(): void {
    if (!pendingPasswordRecovery) {
      setAuthStage("password_recovery_request");
      setPasswordRecoveryFeedback({
        text: "Önce e-posta adresin için yeni bir sıfırlama kodu iste.",
        tone: "error"
      });
      return;
    }
    if (!new RegExp(`^\\d{${PASSWORD_RECOVERY_CODE_LENGTH}}$`, "u").test(passwordRecoveryCode)) {
      setPasswordRecoveryFeedback({ text: "Altı haneli sıfırlama kodunu eksiksiz gir.", tone: "error" });
      return;
    }
    if (passwordRecoveryTiming?.expired) {
      setPasswordRecoveryFeedback({ text: "Sıfırlama kodunun süresi doldu. Yeni bir kod iste.", tone: "error" });
      return;
    }
    setPasswordRecoveryFeedback(null);
    setAuthStage("password_recovery_confirm");
  }

  function returnToPasswordRecoveryCode(): void {
    if (!pendingPasswordRecovery) {
      returnToPasswordRecoveryRequest();
      return;
    }
    setPasswordRecoveryFeedback(null);
    setAuthStage("password_recovery_code");
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
    setRegistrationPasswordConfirmation("");
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

  async function readStoredGoogleCalendarConnection(ownerId: string): Promise<GoogleCalendarConnectionRecordV3 | null> {
    const stored = await getStoredValue(createGoogleCalendarStorageKey(ownerId));
    return stored ? readGoogleCalendarConnectionRecordV3(stored, ownerId) : null;
  }

  async function removeGoogleManagedEventsForDeletion(
    ownerId: string,
    connection: GoogleCalendarConnectionRecordV3,
    signal?: AbortSignal
  ): Promise<void> {
    const authorization = await readCurrentGoogleCalendarAuthorization();
    if (signal?.aborted) throw Object.assign(new Error("Google cleanup aborted."), { name: "AbortError" });
    if (authorization.googleAccountId !== connection.googleAccountId) {
      throw new Error("GOOGLE_CALENDAR_ACCOUNT_MISMATCH");
    }
    const removal = await googleCalendarService.removeManagedEvents({
      accessToken: authorization.accessToken,
      ownerId,
      signal
    });
    if (signal?.aborted) throw Object.assign(new Error("Google cleanup aborted."), { name: "AbortError" });
    if (removal.partial || removal.remaining > 0) {
      await persistGoogleCalendarConnection({
        ...connection,
        state: "partial",
        mappings: removal.mappings
      });
      throw new Error("GOOGLE_CALENDAR_REMOVE_PARTIAL");
    }
    await persistGoogleCalendarConnection({
      ...connection,
      state: "partial",
      mappings: []
    });
  }

  async function runAbortableGoogleCleanup(
    action: (signal: AbortSignal) => Promise<void>,
    timeoutMs = 8_000
  ): Promise<void> {
    const controller = new AbortController();
    let rejectTimeout!: (reason?: unknown) => void;
    const timeoutFailure = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timeout = setTimeout(() => {
      controller.abort();
      rejectTimeout(new Error("Google cleanup timed out."));
    }, timeoutMs);
    try {
      await Promise.race([action(controller.signal), timeoutFailure]);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function detachNotificationOwnerForCleanup(): Promise<void> {
    const coordinator = notificationCoordinatorRef.current;
    if (!coordinator || !coordinator.getState().ownerId) return;
    const detached = await coordinator.detachCurrentOwner();
    if (detached.registration === "error") throw new Error("DEVICE_DETACH_FAILED");
    await coordinator.clearOwner();
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
      {
        target: "device_registration",
        run: async () => {
          await detachNotificationOwnerForCleanup();
        }
      },
      {
        target: "pending_notification_storage",
        run: () => persistPendingNotificationDestination(null)
      },
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
    const serverLogoutDetachedDevice = result.succeededTargets.includes("server_session");
    const reconciledResult: AccountCleanupResult = serverLogoutDetachedDevice
      ? {
          ...result,
          complete: result.failedTargets.filter((target) => target !== "device_registration").length === 0,
          succeededTargets: [...new Set([...result.succeededTargets, "device_registration" as const])],
          failedTargets: result.failedTargets.filter((target) => target !== "device_registration")
        }
      : result;
    accountCleanupInProgressRef.current = false;
    setBusy(false);
    reportCleanupResult("logout", reconciledResult, ownerId);
    if (reconciledResult.complete) {
      setMessage({
        text: "Çıkış yapıldı. Google Takvim'e daha önce eklenen uygulama kayıtları korunur.",
        tone: "info"
      });
    } else if (reconciledResult.failedTargets.every((target) => target === "server_session")) {
      setMessage({
        text: "Bu cihazdaki çıkış tamamlandı; sunucudaki oturumun sonlandırıldığı doğrulanamadı.",
        tone: "info"
      });
    } else {
      setMessage({
        text: reconciledResult.failedTargets.includes("device_registration")
          ? "Çıkış ekranda tamamlandı; cihaz bildirim kaydı ile sunucu oturumunun temizlendiği doğrulanamadı. Aynı hesapla yeniden giriş yaptığında kayıt yeniden uzlaştırılabilir."
          : "Çıkış ekranda tamamlandı; bazı cihaz kayıtları temizlenemedi. Aşağıdan tekrar deneyebilirsin.",
        tone: "error"
      });
    }
  }

  function resetUserScopedState(): void {
    personalExamRuntime.reset();
    setSelectedUniversityId("");
    setRegisterUniversityId("");
    setRegisterFacultyId("");
    setRegisterDepartmentId("");
    setRegisterClassLevel(null);
    setOnboardingInitialDraft(EMPTY_ACADEMIC_ONBOARDING_DRAFT);
    onboardingOwnerRef.current = null;
    setRegisterPicker("none");
    setFaculties({ loading: false, data: [] });
    setDepartments({ loading: false, data: [] });
    setCalendar({ loading: false });
    setUpcoming({ loading: false });
    setAnnouncements({ loading: false });
    setYokAnnouncements({ loading: false });
    setSummerSchool({ loading: false });
    setContentFeedLimit(CONTENT_FEED_INITIAL_LIMIT);
    setContentFeedPagination({ loading: false });
    contentFeedAbortControllerRef.current?.abort();
    contentFeedAbortControllerRef.current = null;
    contentFeedRequestCoordinatorRef.current.reset();
    announcementDetailRequestGenerationRef.current += 1;
    announcementSaveRequestGenerationRef.current += 1;
    setAnnouncementDetailLoad(null);
    setAnnouncementSaveStatus(null);
    setActiveTrustedDetail(null);
    setActiveCalendarDetail(null);
    setPreferences({ loading: false });
    setAlarmEnabled(false);
    setAlarmMode("all_calendar");
    setCategoryDraft({});
    setAlarmCategoriesExpanded(false);
    setAcademicProfileSaveState("idle");
    setAcademicProfileSaveError(undefined);
    setNotificationPreferenceOutcome("idle");
    setNotificationPreferenceError(undefined);
    setGoogleCalendarIntegration(null);
    setGoogleCalendarState("disconnected");
    setGoogleCalendarLastResult(null);
    setGoogleCalendarWarnings([]);
    setGoogleCalendarError(null);
    setGoogleCalendarBusy(false);
    setGoogleBusy(false);
    academicSelectionPendingRef.current = null;
    setAcademicSelectionPending(null);
    setNotificationDestinationNotice(null);
  }

  function clearAuthenticatedMemory(): void {
    authOperationInProgressRef.current = false;
    sessionRef.current = null;
    notificationCoordinatorOwnerTokenRef.current = null;
    setAccountAuthProvider(undefined);
    setRecentAuthAction(null);
    setRecentAuthReturnFocus(undefined);
    setRecentAuthPassword("");
    setRecentAuthBusy(false);
    setRecentAuthError(undefined);
    setSession(null);
    setSessionOwner(null);
    setAuthenticatedContextPending(false);
    setAuthMode("login");
    setAuthStage("auth");
    setActiveTab("home");
    setEmail("");
    setPassword("");
    setRegistrationPasswordConfirmation("");
    setPasswordVisible(false);
    setFullName("");
    setVerificationToken("");
    setPendingVerification(null);
    resetUserScopedState();
  }

  function reportCleanupResult(
    action: "logout" | "session_expiry" | "data_deletion" | "account_deletion" | "verification_save" | "verification_clear" | "activation" | "manual_exam_save" | "notification_settings",
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
      beginRecentAuthentication("account");
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
      const cleanupGoogleConnection = issue.ownerId
        ? await readStoredGoogleCalendarConnection(issue.ownerId).catch(() => null)
        : null;
      let googleManagedEventsRemoved = !cleanupGoogleConnection
        || !issue.failedTargets.includes("google_managed_events");
      let googleAccessRevoked = !cleanupGoogleConnection || !issue.failedTargets.includes("google_access");
      const localTargets = issue.failedTargets.filter(
        (target) => target !== "server_session" && target !== "server_account"
      );
      const tasks = localTargets.map((target) => ({
        target,
        run: async () => {
          if (target === "session_storage") await persistSession(null);
          else if (target === "device_registration") {
            const coordinator = notificationCoordinatorRef.current;
            if (!coordinator || !issue.ownerId || !notificationCoordinatorOwnerTokenRef.current) {
              throw new Error("DEVICE_DETACH_REQUIRES_SESSION");
            }
            if (coordinator.getState().ownerId !== issue.ownerId) {
              await coordinator.activateOwner(issue.ownerId, false);
            }
            await detachNotificationOwnerForCleanup();
          }
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
              if (!await personalExamRuntime.persistCurrent(currentSnapshot)) throw new StaleAccountRequestError();
            } else {
              await enqueueStorageMutation(() => deleteStoredValue(createManualExamStorageKey(issue.ownerId as string)));
            }
          } else if (target === "pending_notification_storage") {
            await persistPendingNotificationDestination(null);
          } else if (target === "google_managed_events" && issue.ownerId) {
            if (!cleanupGoogleConnection) return;
            await runAbortableGoogleCleanup((signal) => (
              removeGoogleManagedEventsForDeletion(issue.ownerId as string, cleanupGoogleConnection, signal)
            ));
            googleManagedEventsRemoved = true;
          } else if (target === "google_access") {
            if (!cleanupGoogleConnection) return;
            if (!googleManagedEventsRemoved) throw new Error("GOOGLE_CALENDAR_REMOVE_INCOMPLETE");
            await runAbortableGoogleCleanup((signal) => (
              revokeGoogleCalendarAccessForConnection(cleanupGoogleConnection, signal)
            ));
            googleAccessRevoked = true;
          } else if (target === "google_connection_storage") {
            if (issue.action === "activation" && issue.ownerId) {
              await restoreGoogleCalendarConnection(issue.ownerId, currentSnapshot);
            } else {
              if (!googleAccessRevoked) throw new Error("GOOGLE_ACCESS_CLEANUP_INCOMPLETE");
              await enqueueStorageMutation(() => persistGoogleCalendarConnection(null, issue.ownerId));
            }
          } else if (target === "google_sign_in" && GOOGLE_AUTH_CONFIGURED) {
            if (!googleAccessRevoked) throw new Error("GOOGLE_ACCESS_CLEANUP_INCOMPLETE");
            await runAbortableGoogleCleanup((signal) => queueGoogleSignOut(signal));
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
          personalExamRuntime.replaceAfterOwnerCleanup(issue.ownerId, true);
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

  function dismissRecentAuthentication(): void {
    if (recentAuthBusy) return;
    const action = recentAuthAction;
    setRecentAuthAction(null);
    setRecentAuthPassword("");
    setRecentAuthError(undefined);
    if (action) {
      recentAuthReturnFocusRequestRef.current += 1;
      setRecentAuthReturnFocus({
        action,
        requestId: recentAuthReturnFocusRequestRef.current,
      });
    }
  }

  function beginRecentAuthentication(action: DestructiveAccountAction): void {
    if (!sessionRef.current || accountCleanupInProgressRef.current || recentAuthBusy) return;
    setRecentAuthReturnFocus(undefined);
    setRecentAuthPassword("");
    setRecentAuthError(undefined);
    setRecentAuthAction(action);
  }

  async function freshGoogleIdTokenForRecentAuthentication(): Promise<string> {
    if (!GOOGLE_AUTH_CONFIGURED) throw new Error(GOOGLE_AUTH_CONFIGURATION_MESSAGE);
    return enqueueGoogleSdkOperation(async () => {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      await clearGoogleAccountSelection();
      const result = await GoogleSignin.signIn();
      if (isCancelledResponse(result)) throw new Error("Google doğrulaması tamamlanmadan kapatıldı.");

      let idToken = result.data.idToken;
      if (!idToken) {
        try {
          idToken = (await GoogleSignin.getTokens()).idToken;
        } catch {
          idToken = null;
        }
      }
      if (!idToken) throw new Error(GOOGLE_ID_TOKEN_CONFIGURATION_MESSAGE);
      return idToken;
    });
  }

  async function requestRecentAuthenticationProof(
    action: DestructiveAccountAction,
    method: RecentAuthenticationMethod,
    currentSession: SessionPayload,
    ownerSnapshot: AccountGenerationSnapshot,
    passwordCredential?: string
  ): Promise<string> {
    const purpose = recentAuthenticationPurpose(action);
    const body = method === "password"
      ? { method, purpose, password: passwordCredential ?? "" }
      : { method, purpose, idToken: await freshGoogleIdTokenForRecentAuthentication() };
    if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
    const response = await apiRequest<unknown>(
      "/auth/recent-authentication",
      { method: "POST", body: JSON.stringify(body) },
      currentSession.accessToken,
      { ownerSnapshot }
    );
    return readRecentAuthenticationResponse(response).proof;
  }

  async function submitRecentAuthentication(method: RecentAuthenticationMethod): Promise<void> {
    const action = recentAuthAction;
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!action || !currentSession || !ownerSnapshot || recentAuthBusy) return;
    if (method === "password" && !recentAuthPassword) {
      setRecentAuthError("Hesap şifreni gir.");
      return;
    }

    setRecentAuthBusy(true);
    setRecentAuthError(undefined);
    const passwordCredential = method === "password" ? recentAuthPassword : undefined;
    setRecentAuthPassword("");
    try {
      const proof = await requestRecentAuthenticationProof(
        action,
        method,
        currentSession,
        ownerSnapshot,
        passwordCredential
      );
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      setRecentAuthAction(null);
      setRecentAuthPassword("");
      if (action === "data") await deleteMyData(proof);
      else await deleteAccount(proof);
    } catch (error) {
      if (!(error instanceof StaleAccountRequestError)) {
        setRecentAuthError(userMessageFromError(error, "Kimliğin doğrulanamadı. Tekrar deneyebilirsin."));
      }
    } finally {
      setRecentAuthPassword("");
      setRecentAuthBusy(false);
    }
  }

  function confirmDeleteMyData(): void {
    if (!session || recentAuthAction) return;
    Alert.alert(
      "Verilerimi sil",
      "Okul seçimin, bildirim tercihlerin, cihaz bildirim kaydın, kişisel alarm ve sınav verilerin silinir. Şu anda bağlı Google hesabındaki uygulama kayıtları kaldırılır ve erişim geri alınır; daha önce hesap değiştirirken özellikle bıraktığın kayıtlar için ilgili hesabı yeniden bağlamalısın. Kişisel etkinliklerin korunur. Hesabın açık kalır.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Verileri Sil",
          style: "destructive",
          onPress: () => beginRecentAuthentication("data")
        }
      ]
    );
  }

  async function deleteMyData(recentAuthenticationProof: string): Promise<void> {
    if (!session || accountCleanupInProgressRef.current) return;
    const currentSession = session;
    accountCleanupInProgressRef.current = true;
    const googleConnection = googleCalendarIntegration?.ownerId === currentSession.user.id
      ? googleCalendarIntegration
      : await readStoredGoogleCalendarConnection(currentSession.user.id).catch(() => null);
    let googleManagedEventsRemoved = !googleConnection;
    let googleAccessRevoked = !googleConnection;
    setBusy(true);
    try {
      await waitForAuthenticatedMutations();
      await apiRequest<{ status: "deleted" }>(
        "/me/data",
        { method: "DELETE", headers: recentAuthenticationHeader(recentAuthenticationProof) },
        currentSession.accessToken,
        { skipAuthRefresh: true, detached: true }
      );
      invalidateAuthenticatedWork();
      resetUserScopedState();
      setPendingVerification(null);
      const replacementOwner = accountGuardRef.current.activate(currentSession.user.id);
      setSessionOwner(replacementOwner);
      onboardingOwnerRef.current = replacementOwner;
      setAuthStage("academic_onboarding");
      googleLifecycleGuardRef.current.activate(currentSession.user.id);
      const result = await runObservableAccountCleanup([
        {
          target: "device_registration",
          run: async () => {
            await detachNotificationOwnerForCleanup();
          }
        },
        {
          target: "pending_notification_storage",
          run: () => persistPendingNotificationDestination(null)
        },
        {
          target: "google_managed_events",
          run: async () => {
            if (!googleConnection) return;
            await runAbortableGoogleCleanup((signal) => (
              removeGoogleManagedEventsForDeletion(currentSession.user.id, googleConnection, signal)
            ));
            googleManagedEventsRemoved = true;
          }
        },
        {
          target: "google_access",
          run: async () => {
            if (!googleConnection) return;
            if (!googleManagedEventsRemoved) throw new Error("GOOGLE_CALENDAR_REMOVE_INCOMPLETE");
            await runAbortableGoogleCleanup((signal) => (
              revokeGoogleCalendarAccessForConnection(googleConnection, signal)
            ));
            googleAccessRevoked = true;
          }
        },
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
          run: () => {
            if (!googleAccessRevoked) throw new Error("GOOGLE_ACCESS_CLEANUP_INCOMPLETE");
            return enqueueStorageMutation(() => persistGoogleCalendarConnection(null, currentSession.user.id));
          }
        },
        {
          target: "google_sign_in",
          run: async () => {
            if (!googleAccessRevoked) throw new Error("GOOGLE_ACCESS_CLEANUP_INCOMPLETE");
            await runAbortableGoogleCleanup((signal) => queueGoogleSignOut(signal));
          }
        }
      ]);
      await notificationCoordinatorRef.current?.activateOwner(currentSession.user.id, false);
      personalExamRuntime.replaceAfterOwnerCleanup(
        currentSession.user.id,
        !result.failedTargets.includes("manual_exam_storage")
      );
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
    if (!session || recentAuthAction) return;
    Alert.alert(
      "Hesabımı sil",
      "Hesabın kapatılır; cihaz bildirim kaydı, şu anda bağlı Google hesabındaki uygulama kayıtları ve Google erişimi temizlenmeye çalışılır. Hesap değiştirirken özellikle bıraktığın eski hesaptaki kayıtlar bu işlemde kaldırılamaz. Kişisel Google Takvim etkinliklerine dokunulmaz. Bu işlem geri alınamaz.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Hesabımı Sil",
          style: "destructive",
          onPress: () => beginRecentAuthentication("account")
        }
      ]
    );
  }

  async function deleteAccount(recentAuthenticationProof: string): Promise<void> {
    if (!session || accountCleanupInProgressRef.current) return;
    const closingSession = session;
    const ownerId = closingSession.user.id;
    accountCleanupInProgressRef.current = true;
    const googleConnection = googleCalendarIntegration?.ownerId === ownerId
      ? googleCalendarIntegration
      : await readStoredGoogleCalendarConnection(ownerId).catch(() => null);
    let googleManagedEventsRemoved = !googleConnection;
    let googleAccessRevoked = !googleConnection;
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
      {
        target: "device_registration",
        run: async () => {
          await detachNotificationOwnerForCleanup();
        }
      },
      {
        target: "pending_notification_storage",
        run: () => persistPendingNotificationDestination(null)
      },
      {
        target: "google_managed_events",
        run: async () => {
          if (!googleConnection) return;
          await runAbortableGoogleCleanup((signal) => (
            removeGoogleManagedEventsForDeletion(ownerId, googleConnection, signal)
          ));
          googleManagedEventsRemoved = true;
        }
      },
      {
        target: "google_access",
        run: async () => {
          if (!googleConnection) return;
          if (!googleManagedEventsRemoved) throw new Error("GOOGLE_CALENDAR_REMOVE_INCOMPLETE");
          await runAbortableGoogleCleanup((signal) => (
            revokeGoogleCalendarAccessForConnection(googleConnection, signal)
          ));
          googleAccessRevoked = true;
        }
      },
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
        run: () => {
          if (!googleAccessRevoked) throw new Error("GOOGLE_ACCESS_CLEANUP_INCOMPLETE");
          return enqueueStorageMutation(() => persistGoogleCalendarConnection(null, ownerId));
        }
      },
      {
        target: "google_sign_in",
        run: async () => {
          if (!googleAccessRevoked) throw new Error("GOOGLE_ACCESS_CLEANUP_INCOMPLETE");
          await runAbortableGoogleCleanup((signal) => queueGoogleSignOut(signal));
        }
      },
      {
        target: "server_account",
        timeoutMs: 8_000,
        run: () => apiRequest<{ status: "deleted" }>(
          "/me",
          {
            method: "DELETE",
            body: JSON.stringify({ deleteData: true }),
            headers: recentAuthenticationHeader(recentAuthenticationProof)
          },
          closingSession.accessToken,
          { skipAuthRefresh: true, authOperation: "delete_account", detached: true, timeoutMs: 8_000 }
        ).then(() => undefined)
      },
      { target: "in_memory_state", run: () => clearAuthenticatedMemory() }
    ]);
    const serverDeletionRemovedDevice = result.succeededTargets.includes("server_account");
    const reconciledResult: AccountCleanupResult = serverDeletionRemovedDevice
      ? {
          ...result,
          complete: result.failedTargets.filter((target) => target !== "device_registration").length === 0,
          succeededTargets: [...new Set([...result.succeededTargets, "device_registration" as const])],
          failedTargets: result.failedTargets.filter((target) => target !== "device_registration")
        }
      : result;
    accountCleanupInProgressRef.current = false;
    setBusy(false);
    reportCleanupResult("account_deletion", reconciledResult, ownerId);
    setMessage({
      text: reconciledResult.complete
        ? "Hesabın ve uygulama verilerin silindi."
        : reconciledResult.failedTargets.includes("server_account")
          ? "Bu cihazdaki oturum temizlendi; sunucudaki hesabın silindiği doğrulanamadı. Tekrar giriş yapıp hesap silmeyi yeniden deneyebilirsin."
          : "Bu cihazdaki hesap kapatıldı; bazı yerel silme adımları tamamlanamadı.",
      tone: reconciledResult.complete ? "success" : "error"
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
      setRegisterClassLevel(null);
      setFacultySearch("");
      setDepartmentSearch("");
      setRegisterPicker("faculty");
      setAcademicProfileExpanded(true);
      setDepartments({ loading: false, data: [] });
      setSummerSchool({ loading: false });
      invalidateContentFeedOwnership();
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
      setRegisterClassLevel(null);
      setDepartmentSearch("");
      setRegisterPicker("department");
      setAcademicProfileExpanded(true);
      setSummerSchool({ loading: false });
      invalidateContentFeedOwnership();
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
      setRegisterClassLevel(null);
      setRegisterPicker("none");
      setSummerSchool({ loading: false });
      invalidateContentFeedOwnership();
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
    ownerSnapshot = accountGuardRef.current.capture(),
    preserveDataOnRefresh = tokenOverride === undefined
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(
      setCalendar,
      () => apiRequest<CalendarPayload>("/calendar/my", {}, token, { ownerSnapshot })
        .then(normalizeCalendarPayloadForDisplay),
      ownerSnapshot,
      preserveDataOnRefresh
    );
  }

  async function loadUpcoming(
    tokenOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture(),
    preserveDataOnRefresh = tokenOverride === undefined
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(
      setUpcoming,
      () => apiRequest<EventRecord[]>("/calendar/upcoming?limit=10", {}, token, { ownerSnapshot })
        .then(normalizeEventRecordsForDisplay),
      ownerSnapshot,
      preserveDataOnRefresh
    );
  }

  async function loadAnnouncements(
    tokenOverride?: string,
    universityIdOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture(),
    preserveDataOnRefresh = tokenOverride === undefined && universityIdOverride === undefined,
    limitOverride = contentFeedLimit,
    signal?: AbortSignal,
    requestGeneration = contentFeedRequestCoordinatorRef.current.captureGeneration()
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token || !contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)) return;

    const universityId = universityIdOverride ?? registerUniversityId;
    if (!universityId) {
      setAnnouncements({ loading: false, data: normalizeTrustedContentCollection([]), attempted: true, stale: false });
      return;
    }

    await withLoadable(
      setAnnouncements,
      () => apiRequest<AnnouncementCollectionApiPayload>(
        `/announcements/my/trusted?limit=${limitOverride}`,
        signal ? { signal } : {},
        token,
        { ownerSnapshot }
      )
        .then(normalizeTrustedApiContentEnvelope),
      ownerSnapshot,
      preserveDataOnRefresh,
      () => contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)
    );
  }

  async function loadYokAnnouncements(
    preserveDataOnRefresh = true,
    limitOverride = contentFeedLimit,
    signal?: AbortSignal,
    requestGeneration = contentFeedRequestCoordinatorRef.current.captureGeneration()
  ): Promise<void> {
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)) return;
    await withLoadable(
      setYokAnnouncements,
      () => apiRequest<AnnouncementCollectionApiPayload>(
        `/announcements/yok/trusted?limit=${limitOverride}`,
        signal ? { signal } : {},
        undefined,
        { ownerSnapshot }
      )
        .then(normalizeTrustedApiContentEnvelope),
      ownerSnapshot,
      preserveDataOnRefresh,
      () => contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)
    );
  }

  async function loadSummerSchool(
    tokenOverride?: string,
    universityIdOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture(),
    preserveDataOnRefresh = tokenOverride === undefined && universityIdOverride === undefined,
    signal?: AbortSignal,
    requestGeneration = contentFeedRequestCoordinatorRef.current.captureGeneration()
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token || !contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)) return;

    const universityId = universityIdOverride ?? registerUniversityId;
    if (!universityId) {
      setSummerSchool({ loading: false });
      return;
    }

    await withLoadable(
      setSummerSchool,
      () => apiRequest<SummerSchoolApiPayload>(
        "/calendar/summer-school/my",
        signal ? { signal } : {},
        token,
        { ownerSnapshot }
      )
        .then(normalizeSummerSchoolPayloadForDisplay),
      ownerSnapshot,
      preserveDataOnRefresh,
      () => contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)
    );
  }

  async function refreshSummerSchool(): Promise<void> {
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!ownerSnapshot) return;
    await Promise.all([
      loadMyCalendar(undefined, ownerSnapshot, true),
      loadSummerSchool(undefined, undefined, ownerSnapshot, true)
    ]);
  }

  async function refreshContentFeed(): Promise<void> {
    const requestLease = contentFeedRequestCoordinatorRef.current.beginRefresh();
    if (!requestLease) return;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!ownerSnapshot) {
      contentFeedRequestCoordinatorRef.current.finish(requestLease);
      return;
    }
    contentFeedAbortControllerRef.current?.abort();
    const requestController = new AbortController();
    contentFeedAbortControllerRef.current = requestController;
    setContentFeedPagination({ loading: false });
    try {
      await Promise.allSettled([
        loadAnnouncements(undefined, undefined, ownerSnapshot, true, contentFeedLimit, requestController.signal),
        loadYokAnnouncements(true, contentFeedLimit, requestController.signal),
        loadSummerSchool(undefined, undefined, ownerSnapshot, true, requestController.signal)
      ]);
    } finally {
      if (contentFeedAbortControllerRef.current === requestController) {
        contentFeedAbortControllerRef.current = null;
      }
      contentFeedRequestCoordinatorRef.current.finish(requestLease);
    }
  }

  async function loadMoreContentFeed(): Promise<void> {
    if (contentFeedPagination.loading || contentFeedLimit >= CONTENT_FEED_MAX_LIMIT) return;
    const requestLease = contentFeedRequestCoordinatorRef.current.beginPagination();
    if (!requestLease) return;
    const ownerSnapshot = accountGuardRef.current.capture();
    const token = accessToken;
    if (!ownerSnapshot || !token || !registerUniversityId) {
      contentFeedRequestCoordinatorRef.current.finish(requestLease);
      return;
    }
    const requestController = new AbortController();
    contentFeedAbortControllerRef.current = requestController;

    const nextLimit = nextContentFeedLimit(contentFeedLimit);
    const requests: Array<{
      kind: "academic" | "yok";
      promise: Promise<TrustedContentCollection>;
    }> = [];
    if (trustedContentCollectionHasMore(announcements.data, contentFeedLimit)) {
      requests.push({
        kind: "academic",
        promise: apiRequest<AnnouncementCollectionApiPayload>(
          `/announcements/my/trusted?limit=${nextLimit}`,
          { signal: requestController.signal },
          token,
          { ownerSnapshot }
        ).then(normalizeTrustedApiContentEnvelope)
      });
    }
    if (trustedContentCollectionHasMore(yokAnnouncements.data, contentFeedLimit)) {
      requests.push({
        kind: "yok",
        promise: apiRequest<AnnouncementCollectionApiPayload>(
          `/announcements/yok/trusted?limit=${nextLimit}`,
          { signal: requestController.signal },
          undefined,
          { ownerSnapshot }
        ).then(normalizeTrustedApiContentEnvelope)
      });
    }
    if (requests.length === 0) {
      if (contentFeedAbortControllerRef.current === requestController) {
        contentFeedAbortControllerRef.current = null;
      }
      contentFeedRequestCoordinatorRef.current.finish(requestLease);
      return;
    }

    setContentFeedPagination({ loading: true });
    const results = await Promise.allSettled(requests.map((request) => request.promise));
    if (
      !accountGuardRef.current.isCurrent(ownerSnapshot)
      || !contentFeedRequestCoordinatorRef.current.isCurrent(requestLease)
    ) {
      if (contentFeedAbortControllerRef.current === requestController) {
        contentFeedAbortControllerRef.current = null;
      }
      contentFeedRequestCoordinatorRef.current.finish(requestLease);
      return;
    }

    let failed = false;
    results.forEach((result, index) => {
      const request = requests[index];
      if (!request) return;
      if (result.status === "rejected") {
        failed = true;
        return;
      }
      const nextState: Loadable<TrustedContentCollection> = {
        loading: false,
        data: result.value,
        attempted: true,
        stale: false
      };
      if (request.kind === "academic") setAnnouncements(nextState);
      else setYokAnnouncements(nextState);
    });

    if (failed) {
      if (contentFeedAbortControllerRef.current === requestController) {
        contentFeedAbortControllerRef.current = null;
      }
      contentFeedRequestCoordinatorRef.current.finish(requestLease);
      setContentFeedPagination({
        loading: false,
        error: "Daha fazla içerik yüklenemedi. Mevcut doğrulanmış kayıtlar korunuyor."
      });
      return;
    }
    if (contentFeedAbortControllerRef.current === requestController) {
      contentFeedAbortControllerRef.current = null;
    }
    contentFeedRequestCoordinatorRef.current.finish(requestLease);
    setContentFeedLimit(nextLimit);
    setContentFeedPagination({ loading: false });
  }

  async function loadPreferences(
    tokenOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture()
  ): Promise<NotificationPreferencePayload | null> {
    const token = tokenOverride ?? accessToken;
    if (!token) return null;

    return withLoadable(
      setPreferences,
      () => apiRequest<NotificationPreferencePayload>("/notification-preferences", {}, token, { ownerSnapshot }),
      ownerSnapshot
    );
  }

  async function writeNotificationPreferences(
    currentSession: SessionPayload,
    existing: NotificationPreferencePayload,
    enabled: boolean,
    ownerSnapshot: AccountGenerationSnapshot
  ): Promise<NotificationPreferencePayload> {
    return apiRequest<NotificationPreferencePayload>(
      "/notification-preferences",
      {
        method: "PATCH",
        body: JSON.stringify({
          enabled,
          ...(enabled ? { deliveryConsentVersion: "phase3-v1" } : {}),
          categories: existing.categories,
          reminderOffsets: existing.reminderOffsets.length ? existing.reminderOffsets : DEFAULT_REMINDER_OFFSETS,
          reminderRules: notificationReminderRulesForMutation(existing.reminderRules, DEFAULT_REMINDER_RULES),
          quietHours: existing.quietHours ?? {
            enabled: true,
            start: "22:00",
            end: "07:00",
            timezone: "Europe/Istanbul"
          }
        })
      },
      currentSession.accessToken,
      { ownerSnapshot }
    );
  }

  async function reconcileNotificationDelivery(
    currentSession: SessionPayload,
    coordinator: NotificationLifecycleCoordinator,
    knownPreferences?: NotificationPreferencePayload,
    knownSnapshot?: AccountGenerationSnapshot
  ): Promise<void> {
    const ownerSnapshot = knownSnapshot ?? accountGuardRef.current.capture();
    if (!ownerSnapshot || ownerSnapshot.ownerId !== currentSession.user.id) return;
    let currentPreferences = knownPreferences;
    if (!currentPreferences) {
      currentPreferences = await apiRequest<NotificationPreferencePayload>(
        "/notification-preferences",
        {},
        currentSession.accessToken,
        { ownerSnapshot }
      );
      setPreferences({ loading: false, data: currentPreferences, attempted: true, stale: false });
    }
    const coordinatorState = coordinator.getState();
    if (
      coordinatorState.ownerId !== currentSession.user.id
      || coordinatorState.preferenceEnabled !== currentPreferences.enabled
    ) {
      await coordinator.activateOwner(currentSession.user.id, currentPreferences.enabled);
    }
    const deliveryState = await coordinator.registerIfAlreadyGranted();
    if (currentPreferences.enabled && !deliveryState.active) {
      await disableNotificationDeliveryFailClosed(
        currentSession,
        coordinator,
        currentPreferences,
        ownerSnapshot
      );
    }
  }

  function disableNotificationDeliveryFailClosed(
    currentSession: SessionPayload,
    coordinator: NotificationLifecycleCoordinator,
    knownPreferences?: NotificationPreferencePayload,
    knownSnapshot?: AccountGenerationSnapshot
  ): Promise<void> {
    if (notificationFailClosedPromiseRef.current) return notificationFailClosedPromiseRef.current;
    const operation = (async () => {
      const ownerSnapshot = knownSnapshot ?? accountGuardRef.current.capture();
      if (
        !ownerSnapshot
        || ownerSnapshot.ownerId !== currentSession.user.id
        || coordinator.getState().ownerId !== currentSession.user.id
      ) return;
      const detachedState = await coordinator.setPreferenceEnabled(false);
      const currentPreferences = knownPreferences ?? await apiRequest<NotificationPreferencePayload>(
        "/notification-preferences",
        {},
        currentSession.accessToken,
        { ownerSnapshot }
      );
      const updated = await writeNotificationPreferences(
        currentSession,
        currentPreferences,
        false,
        ownerSnapshot
      );
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
      setPreferences({ loading: false, data: updated, attempted: true, stale: false });
      setAlarmEnabled(false);
      if (detachedState.registration === "error") {
        setCleanupIssue({
          action: "notification_settings",
          failedTargets: ["device_registration"],
          ownerId: currentSession.user.id
        });
      }
    })();
    notificationFailClosedPromiseRef.current = operation;
    void operation.finally(() => {
      if (notificationFailClosedPromiseRef.current === operation) {
        notificationFailClosedPromiseRef.current = null;
      }
    }).catch(() => undefined);
    return operation;
  }

  async function authorizeGoogleCalendar(forceAccountSelection: boolean): Promise<{
    accessToken: string;
    accountEmail: string;
    googleAccountId: string;
  }> {
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
      const selectedUser = GoogleSignin.getCurrentUser()?.user ?? currentUser.user;
      if (!tokens.accessToken || !selectedUser.email || !selectedUser.id) {
        throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
      }
      return {
        accessToken: tokens.accessToken,
        accountEmail: selectedUser.email,
        googleAccountId: selectedUser.id
      };
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

    const operationSnapshot = googleLifecycleGuardRef.current.begin(currentSession.user.id);
    if (!operationSnapshot) {
      setGoogleCalendarError("Google Takvim işlemi zaten devam ediyor.");
      return;
    }
    const expectedGoogleAccountId = googleCalendarIntegration?.ownerId === currentSession.user.id
      ? googleCalendarIntegration.googleAccountId
      : null;
    const authorizationInterruptionState = settledGoogleCalendarLifecycleState(
      googleCalendarIntegration?.state,
    );

    setGoogleCalendarError(null);
    setMessage(null);
    setGoogleCalendarBusy(true);
    setGoogleCalendarState("syncing");
    let googleAccessToken: string | undefined;
    const syncController = new AbortController();
    authenticatedRequestControllersRef.current.add(syncController);

    try {
      const [networkResult, profileResult, calendarResult, announcementResult] = await Promise.allSettled([
        new ExpoNetworkAdapter().getState(syncController.signal),
        apiRequest<UserProfile>(
          "/me",
          { signal: syncController.signal },
          currentSession.accessToken,
          { ownerSnapshot }
        ),
        apiRequest<CalendarPayload>(
          "/calendar/my",
          { signal: syncController.signal },
          currentSession.accessToken,
          { ownerSnapshot }
        ),
        apiRequest<AnnouncementCollectionApiPayload>(
          "/announcements/my/trusted?limit=100",
          { signal: syncController.signal },
          currentSession.accessToken,
          { ownerSnapshot }
        )
      ]);
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      if (profileResult.status === "rejected") throw profileResult.reason;
      if (calendarResult.status === "rejected" && announcementResult.status === "rejected") {
        throw calendarResult.reason;
      }

      const normalizedCalendar = calendarResult.status === "fulfilled"
        ? normalizeCalendarPayloadForDisplay(calendarResult.value)
        : null;
      const calendarEvents = normalizedCalendar?.events ?? [];
      const trustedAnnouncements = announcementResult.status === "fulfilled"
        ? normalizeTrustedApiContentEnvelope(announcementResult.value)
        : null;
      const announcementItems = trustedAnnouncements?.items ?? [];
      const deletionCandidateSourceTypes = googleCalendarDeletionCandidateSourceTypes({
        calendarSourceStatus: normalizedCalendar?.sourceStatus,
        announcementState: trustedAnnouncements?.state
      });
      const warnings: string[] = [];

      if (calendarResult.status === "fulfilled") {
        if (normalizedCalendar?.sourceStatus !== "parsed") {
          warnings.push("Akademik takvim kaynağı tam olarak ayrıştırılmadığı için bu gruptan silme yapılmadı.");
        }
        setCalendar({
          loading: false,
          data: normalizedCalendar ?? normalizeCalendarPayloadForDisplay(calendarResult.value),
          attempted: true,
          stale: false
        });
      } else {
        warnings.push("Akademik takvim kaynağı bu eşitlemede alınamadı.");
        setCalendar({
          loading: false,
          error: userMessageFromError(calendarResult.reason, "Akademik takvim şu anda alınamadı."),
          attempted: true,
          stale: false
        });
      }
      if (announcementResult.status === "fulfilled") {
        if (trustedAnnouncements?.state !== "fresh") {
          warnings.push("Duyuru kaynakları kısmi veya eski olduğu için bu gruptan silme yapılmadı.");
        }
        setAnnouncements({
          loading: false,
          data: trustedAnnouncements ?? normalizeTrustedContentCollection([]),
          attempted: true,
          stale: false
        });
      } else {
        warnings.push("Duyuru ve etkinlik kaynakları bu eşitlemede alınamadı.");
        setAnnouncements({
          loading: false,
          error: userMessageFromError(announcementResult.reason, "Duyurular şu anda alınamadı."),
          attempted: true,
          stale: false
        });
      }

      if (networkResult.status === "rejected") {
        setGoogleCalendarError("Ağ durumu doğrulanamadı. Google hesap izni istenmedi.");
        setGoogleCalendarState(authorizationInterruptionState);
        return;
      }
      const preflight = evaluateGoogleCalendarPreflight({
        ownerId: currentSession.user.id,
        activeOwnerId: ownerSnapshot.ownerId,
        operationInProgress: false,
        academicProfile: profileResult.value,
        calendarEvents,
        trustedAnnouncements: announcementItems,
        deletionEligibleSourceTypes: [],
        hasManagedMappingsForCleanup: Boolean(
          googleCalendarIntegration?.mappings.some((mapping) => (
            deletionCandidateSourceTypes.includes(mapping.sourceType)
          ))
        )
      }, {
        isConnected: networkResult.value.connected,
        isInternetReachable: networkResult.value.internetReachable
      });
      if (!preflight.ready) {
        const preflightMessages: Record<typeof preflight.reason, string> = {
          duplicate_sync: "Google Takvim işlemi zaten devam ediyor.",
          owner_changed: "Hesap değiştiği için Google Takvim işlemi iptal edildi.",
          academic_profile_missing: "Google izni istenmedi. Önce profilinden üniversiteni seç.",
          no_content: "Google izni istenmedi. Profiline ait aktarılabilir, kaynak tarihli içerik bulunamadı.",
          network_unavailable: "İnternet bağlantısı yok. Google hesap izni istenmedi.",
          network_check_failed: "Ağ durumu doğrulanamadı. Google hesap izni istenmedi.",
          authorization_failed: "Google Takvim yetkilendirmesi tamamlanamadı."
        };
        setGoogleCalendarError(preflightMessages[preflight.reason]);
        setGoogleCalendarState(authorizationInterruptionState);
        return;
      }
      if (
        googleCalendarIntegration
        && findDuplicateGoogleCalendarMappings(googleCalendarIntegration.mappings).hasDuplicates
      ) {
        setGoogleCalendarError("Kaydedilmiş Google Takvim eşlemesinde çakışma bulundu. Yeniden bağlanmadan işlem yapılmadı.");
        setGoogleCalendarState("error");
        return;
      }

      // This is the first point at which account or scope UI may be shown.
      const emptyManagedCleanup = preflight.items.length === 0 && Boolean(googleCalendarIntegration);
      const authorization = emptyManagedCleanup
        ? await readCurrentGoogleCalendarAuthorization()
        : await authorizeGoogleCalendar(forceAccountSelection);
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      if (
        (emptyManagedCleanup || !forceAccountSelection)
        && expectedGoogleAccountId
        && authorization.googleAccountId !== expectedGoogleAccountId
      ) {
        await queueGoogleSignOut();
        throw new Error("GOOGLE_CALENDAR_ACCOUNT_MISMATCH");
      }
      googleAccessToken = authorization.accessToken;
      const verification = await googleCalendarService.verifyAuthorization({
        accessToken: authorization.accessToken,
        ownerId: currentSession.user.id,
        signal: syncController.signal
      });
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();

      const exactLookupPlan = planGoogleCalendarExactMappingLookups(
        verification.mappings,
        preflight.items,
        deletionCandidateSourceTypes
      );
      const deletionBlockedSourceTypes = new Set(exactLookupPlan.malformedSourceTypes);
      const reconciledCalendarEvents = [...calendarEvents];
      const reconciledAnnouncementItems = [...announcementItems];
      const exactLookupResults: Array<{
        sourceType: "academic_event" | "announcement" | "event";
        recordId: string;
        status: "found" | "missing" | "error";
        calendarEvent?: EventRecord;
        announcement?: AnnouncementApiRecord;
      }> = [];
      for (let offset = 0; offset < exactLookupPlan.lookups.length; offset += 8) {
        const batch = exactLookupPlan.lookups.slice(offset, offset + 8);
        exactLookupResults.push(...await Promise.all(batch.map(async (lookup) => {
          try {
            if (lookup.sourceType === "academic_event") {
              const calendarEvent = await apiRequest<EventRecord>(
                `/calendar/my/trusted/${encodeURIComponent(lookup.recordId)}`,
                { signal: syncController.signal },
                currentSession.accessToken,
                { ownerSnapshot }
              );
              return { ...lookup, status: "found" as const, calendarEvent };
            }
            const announcement = await apiRequest<AnnouncementApiRecord>(
              `/announcements/my/trusted/${encodeURIComponent(lookup.recordId)}`,
              { signal: syncController.signal },
              currentSession.accessToken,
              { ownerSnapshot }
            );
            return { ...lookup, status: "found" as const, announcement };
          } catch (error) {
            if (error instanceof ApiRequestError && error.status === 404) {
              return { ...lookup, status: "missing" as const };
            }
            return { ...lookup, status: "error" as const };
          }
        })));
        if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      }

      for (const lookup of exactLookupResults) {
        if (lookup.status === "error") {
          deletionBlockedSourceTypes.add(lookup.sourceType);
          continue;
        }
        if (lookup.status !== "found") continue;
        if (lookup.sourceType === "academic_event") {
          if (!lookup.calendarEvent || lookup.calendarEvent.id !== lookup.recordId) {
            deletionBlockedSourceTypes.add(lookup.sourceType);
            continue;
          }
          const normalized = normalizeEventRecordsForDisplay([lookup.calendarEvent]);
          if (normalized[0] && !reconciledCalendarEvents.some((event) => event.id === normalized[0]?.id)) {
            reconciledCalendarEvents.push(normalized[0]);
          }
          continue;
        }
        if (!lookup.announcement || lookup.announcement.id !== lookup.recordId) {
          deletionBlockedSourceTypes.add(lookup.sourceType);
          continue;
        }
        const normalized = normalizeTrustedApiContentCollection([lookup.announcement]).items[0];
        if (normalized && !reconciledAnnouncementItems.some((item) => item.id === normalized.id)) {
          reconciledAnnouncementItems.push(normalized);
        }
      }

      const deletionEligibleSourceTypes = deletionCandidateSourceTypes
        .filter((sourceType) => !deletionBlockedSourceTypes.has(sourceType));
      if (deletionBlockedSourceTypes.size > 0) {
        warnings.push("Eksik eşlemeler kesin olarak doğrulanamadığı için ilgili Google Takvim kayıtları silinmedi.");
      }
      const reconciledPreflight = evaluateGoogleCalendarPreflight({
        ownerId: currentSession.user.id,
        activeOwnerId: ownerSnapshot.ownerId,
        operationInProgress: false,
        academicProfile: profileResult.value,
        calendarEvents: reconciledCalendarEvents,
        trustedAnnouncements: reconciledAnnouncementItems,
        deletionEligibleSourceTypes,
        hasManagedMappingsForCleanup: verification.mappings.some((mapping) => (
          deletionEligibleSourceTypes.includes(mapping.sourceType)
        ))
      }, {
        isConnected: networkResult.value.connected,
        isInternetReachable: networkResult.value.internetReachable
      });
      if (!reconciledPreflight.ready) {
        throw new Error("GOOGLE_CALENDAR_RECONCILIATION_INCOMPLETE");
      }

      let result: GoogleCalendarSyncResult;
      if (mappingsMatchDesiredContent(
        reconciledPreflight.items,
        verification.mappings,
        reconciledPreflight.deletionEligibleSourceTypes
      )) {
        result = {
          created: 0,
          updated: 0,
          deleted: 0,
          skipped: reconciledPreflight.items.length,
          failed: 0,
          total: reconciledPreflight.items.length,
          verified: reconciledPreflight.items.length,
          partial: false,
          failures: [],
          mappings: verification.mappings
        };
      } else {
        result = await googleCalendarService.sync({
          accessToken: authorization.accessToken,
          ownerId: currentSession.user.id,
          calendarEvents: reconciledCalendarEvents,
          announcements: reconciledAnnouncementItems,
          deletionEligibleSourceTypes: reconciledPreflight.deletionEligibleSourceTypes,
          signal: syncController.signal
        });
      }
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      const lifecycleState: GoogleCalendarLifecycleState = result.partial || warnings.length > 0
        ? "partial"
        : "connected";
      const connection: GoogleCalendarConnectionRecordV3 = {
        schemaVersion: GOOGLE_CALENDAR_CONNECTION_SCHEMA_VERSION,
        ownerId: currentSession.user.id,
        googleAccountId: authorization.googleAccountId,
        accountEmail: authorization.accountEmail,
        state: lifecycleState,
        authorizationVerifiedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
        mappings: result.mappings
      };
      await enqueueStorageMutation(async () => {
        if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
        await persistGoogleCalendarConnection(connection);
      });
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      setGoogleCalendarIntegration(connection);
      setGoogleCalendarState(lifecycleState);
      setGoogleCalendarLastResult(result);
      setGoogleCalendarWarnings(warnings);

      if (result.total === 0) {
        setMessage({
          text: result.deleted > 0
            ? `${result.deleted} kaldırılmış kaynak kaydı Google Takvim'den temizlendi.`
            : "Google Takvim'de kaldırılması gereken uygulama kaydı bulunmadı.",
          tone: "success"
        });
      } else if (result.verified === 0) {
        setGoogleCalendarError("Aktarılabilir içerik bulundu ancak Google Takvim'de doğrulanamadı.");
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
        setGoogleCalendarState(authorizationInterruptionState);
        setGoogleCalendarError("Google hesabı veya Takvim izni seçimi tamamlanmadı.");
      } else if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
        setGoogleCalendarState(authorizationInterruptionState);
        setGoogleCalendarError("Google hesabı veya Takvim izni seçimi tamamlanmadı.");
      } else if (isErrorWithCode(error) && error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setGoogleCalendarState(authorizationInterruptionState);
        setGoogleCalendarError("Google Play Hizmetleri bu cihazda hazır değil veya güncellenmeli.");
      } else if (isErrorWithCode(error) && error.code === statusCodes.IN_PROGRESS) {
        setGoogleCalendarState(authorizationInterruptionState);
        setGoogleCalendarError("Google hesabı seçimi zaten devam ediyor.");
      } else if (error instanceof Error && error.message === "GOOGLE_CALENDAR_ACCOUNT_MISMATCH") {
        setGoogleCalendarState("expired");
        setGoogleCalendarError("Google hesabı değişmiş. Devam etmek için hesabını yeniden seç.");
      } else {
        if (
          googleAccessToken
          && error instanceof GoogleCalendarSyncError
          && error.code === "GOOGLE_CALENDAR_AUTH_EXPIRED"
        ) {
          await enqueueGoogleSdkOperation(() => GoogleSignin.clearCachedAccessToken(googleAccessToken as string)).catch(() => null);
        }
        setGoogleCalendarState(
          error instanceof GoogleCalendarSyncError && error.code === "GOOGLE_CALENDAR_AUTH_EXPIRED"
            ? "expired"
            : "error"
        );
        setGoogleCalendarError(googleCalendarUserMessage(error));
      }
    } finally {
      googleLifecycleGuardRef.current.settle(operationSnapshot, true);
      authenticatedRequestControllersRef.current.delete(syncController);
      if (accountGuardRef.current.isCurrent(ownerSnapshot)) setGoogleCalendarBusy(false);
    }
  }

  async function disconnectGoogleCalendar(options: {
    removeManagedEvents: boolean;
    revokeAccess: boolean;
  }): Promise<boolean> {
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot || accountCleanupInProgressRef.current) return false;
    const operationSnapshot = googleLifecycleGuardRef.current.begin(currentSession.user.id);
    if (!operationSnapshot) {
      setGoogleCalendarError("Google Takvim işlemi zaten devam ediyor.");
      return false;
    }
    const operationController = new AbortController();
    authenticatedRequestControllersRef.current.add(operationController);
    const assertCurrentOperation = () => {
      if (
        !accountGuardRef.current.isCurrent(ownerSnapshot)
        || !googleLifecycleGuardRef.current.isCurrent(operationSnapshot)
      ) throw new StaleAccountRequestError();
    };
    setGoogleCalendarBusy(true);
    setGoogleCalendarError(null);
    const lifecyclePolicy = planGoogleCalendarLifecycle(
      options.removeManagedEvents
        ? "disconnect_and_remove"
        : options.revokeAccess
          ? "revoke_access"
          : "disconnect_only"
    );
    try {
      let authorization: Awaited<ReturnType<typeof authorizeGoogleCalendar>> | null = null;
      const disconnectedRecord = googleCalendarIntegration && !options.removeManagedEvents
        ? { ...googleCalendarIntegration, state: "disconnected" as const }
        : null;
      const execution = await executeGoogleCalendarLifecycle(lifecyclePolicy, {
        isOwnerCurrent: () => (
          accountGuardRef.current.isCurrent(ownerSnapshot)
          && googleLifecycleGuardRef.current.isCurrent(operationSnapshot)
        ),
        runStep: async (step) => {
          if (step === "request_authorization_for_removal") {
            authorization = await authorizeGoogleCalendar(false);
            if (
              googleCalendarIntegration
              && authorization.googleAccountId !== googleCalendarIntegration.googleAccountId
            ) throw new Error("GOOGLE_CALENDAR_ACCOUNT_MISMATCH");
            return;
          }
          if (step === "read_current_authorization") {
            authorization = await readCurrentGoogleCalendarAuthorization();
            if (
              googleCalendarIntegration
              && authorization.googleAccountId !== googleCalendarIntegration.googleAccountId
            ) throw new Error("GOOGLE_CALENDAR_ACCOUNT_MISMATCH");
            return;
          }
          if (step === "remove_managed_events") {
            if (!authorization) throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
        const removal = await googleCalendarService.removeManagedEvents({
          accessToken: authorization.accessToken,
          ownerId: currentSession.user.id,
          signal: operationController.signal
        });
        assertCurrentOperation();
        if (removal.partial || removal.remaining > 0) {
          const partialRecord = googleCalendarIntegration
            ? { ...googleCalendarIntegration, state: "partial" as const, mappings: removal.mappings }
            : null;
          if (partialRecord) {
            await enqueueStorageMutation(async () => {
              assertCurrentOperation();
              await persistGoogleCalendarConnection(partialRecord);
              assertCurrentOperation();
            });
          }
          assertCurrentOperation();
          if (partialRecord) setGoogleCalendarIntegration(partialRecord);
          setGoogleCalendarState("partial");
          setGoogleCalendarError("Uygulamanın eklediği bazı Google Takvim kayıtları kaldırılamadı. Bağlantı korunuyor; tekrar deneyebilirsin.");
          throw new Error("GOOGLE_CALENDAR_REMOVE_PARTIAL");
        }
            return;
          }
          if (step === "revoke_access") {
            if (!googleCalendarIntegration) throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
            await runAbortableGoogleCleanup((signal) => (
              revokeGoogleCalendarAccessForConnection(googleCalendarIntegration, signal)
            ));
            return;
          }
          if (step === "sign_out") {
            await runAbortableGoogleCleanup((signal) => queueGoogleSignOut(signal));
            return;
          }
          if (step === "persist_disconnected_metadata") {
            await enqueueStorageMutation(async () => {
              assertCurrentOperation();
              await persistGoogleCalendarConnection(disconnectedRecord, currentSession.user.id);
              assertCurrentOperation();
            });
            return;
          }
          if (step === "clear_connection_metadata") {
            await enqueueStorageMutation(async () => {
              assertCurrentOperation();
              await persistGoogleCalendarConnection(null, currentSession.user.id);
              assertCurrentOperation();
            });
            return;
          }
          throw new Error("GOOGLE_CALENDAR_UNEXPECTED_LIFECYCLE_STEP");
        }
      });
      if (!execution.complete) {
        if (execution.reason === "owner_changed") throw new StaleAccountRequestError();
        throw execution.error;
      }
      assertCurrentOperation();
      setGoogleCalendarIntegration(disconnectedRecord);
      setGoogleCalendarLastResult(null);
      setGoogleCalendarWarnings([]);
      setGoogleCalendarState("disconnected");
      setMessage({
        text: options.removeManagedEvents
          ? "Uygulamanın Google Takvim'e eklediği kayıtlar kaldırıldı ve bağlantı kesildi."
          : options.revokeAccess
            ? "Google Takvim erişimi geri alındı; daha önce eklenmiş kayıtlar korundu."
            : "Google Takvim bağlantısı kesildi; daha önce eklenmiş kayıtlar korundu.",
        tone: "info"
      });
      return true;
    } catch (error) {
      if (
        error instanceof StaleAccountRequestError
        || (error instanceof Error && error.name === "AbortError")
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
      ) return false;
      if (error instanceof Error && error.message === "GOOGLE_CALENDAR_REMOVE_PARTIAL") return false;
      setGoogleCalendarState(error instanceof Error && error.message === "GOOGLE_CALENDAR_ACCOUNT_MISMATCH" ? "expired" : "error");
      setGoogleCalendarError(
        error instanceof Error && error.message === "GOOGLE_CALENDAR_ACCOUNT_MISMATCH"
          ? "Açık Google hesabı bu bağlantıyla eşleşmiyor. Kayıtlara dokunulmadı."
          : googleCalendarUserMessage(error)
      );
      return false;
    } finally {
      googleLifecycleGuardRef.current.settle(operationSnapshot, true);
      authenticatedRequestControllersRef.current.delete(operationController);
      if (accountGuardRef.current.isCurrent(ownerSnapshot)) setGoogleCalendarBusy(false);
    }
  }

  function promptGoogleCalendarAccountSwitch(): void {
    const continueSwitch = async (choice: "leave_managed_events" | "remove_managed_events") => {
      const plan = planGoogleCalendarAccountSwitch(choice);
      if (!plan.proceed) return;
      if (await disconnectGoogleCalendar({
        removeManagedEvents: plan.removeManagedEvents,
        revokeAccess: false
      })) {
        await syncGoogleCalendar(true);
      }
    };
    Alert.alert(
      "Google hesabını değiştir",
      "Eski hesaptaki uygulama kayıtları kalsın mı, yoksa hesap seçiciyi açmadan önce kaldırılsın mı? Kalan kayıtlar artık bu bağlantı tarafından otomatik temizlenmez; o hesabı yeniden bağlayarak yönetebilirsin. Kişisel etkinliklere dokunulmaz.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Kayıtlar Kalsın",
          onPress: () => void continueSwitch("leave_managed_events")
        },
        {
          text: "Kayıtları Kaldır",
          style: "destructive",
          onPress: () => void continueSwitch("remove_managed_events")
        }
      ]
    );
  }

  function updateCategory(category: string, enabled: boolean): void {
    setCategoryDraft((previous) => ({
      ...previous,
      [category]: enabled
    }));
    setNotificationPreferenceOutcome("idle");
    setNotificationPreferenceError(undefined);
  }

  function updateAlarmMode(mode: AlarmMode): void {
    setAlarmMode(mode);
    setNotificationPreferenceOutcome("idle");
    setNotificationPreferenceError(undefined);
    if (mode === "all_calendar") {
      const everythingOn: Record<string, boolean> = {};
      for (const category of availableCategories) everythingOn[category] = true;
      setCategoryDraft(everythingOn);
    }
  }

  function updateAlarmEnabled(enabled: boolean): void {
    setAlarmEnabled(enabled);
    setNotificationPreferenceOutcome("idle");
    setNotificationPreferenceError(undefined);
  }

  function discardNotificationPreferenceChanges(): void {
    setAlarmEnabled(initialNotificationPreference.enabled);
    setAlarmMode(initialNotificationPreference.mode);
    setCategoryDraft({ ...initialNotificationPreference.categories });
    setNotificationPreferenceOutcome("saved");
    setNotificationPreferenceError(undefined);
    setMessage(null);
  }

  async function saveAlarmSettings(): Promise<void> {
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession?.accessToken || !ownerSnapshot) {
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
    const reminderRules = notificationReminderRulesForMutation(existing?.reminderRules, DEFAULT_REMINDER_RULES);

    try {
      setBusy(true);
      setNotificationPreferenceOutcome("saving");
      setNotificationPreferenceError(undefined);
      const coordinator = notificationCoordinatorRef.current;
      if (alarmEnabled) {
        if (!coordinator) {
          setAlarmEnabled(false);
          setNotificationPreferenceOutcome("error");
          setNotificationPreferenceError("Push bildirimleri bu platformda kullanılamıyor; teslimat açılmadı.");
          setMessage({ text: "Push bildirimleri bu platformda kullanılamıyor; teslimat açılmadı.", tone: "error" });
          return;
        }
        if (coordinator.getState().ownerId !== currentSession.user.id) {
          await coordinator.activateOwner(currentSession.user.id, false);
        }
        const enabledState = await coordinator.enableAfterUserIntent({
          ownerId: currentSession.user.id,
          intent: "enable_notifications"
        });
        if (!enabledState.active) {
          await disableNotificationDeliveryFailClosed(
            currentSession,
            coordinator,
            existing,
            ownerSnapshot
          );
          setAlarmEnabled(false);
          setNotificationPreferenceOutcome("error");
          setNotificationPreferenceError("Bildirim izni veya cihaz kaydı geçerli olmadığı için teslimat açılmadı.");
          setMessage({
            text: enabledState.permission === "permanently_denied"
              ? "Bildirim izni cihaz ayarlarından kapalı. Teslimat açılmadı."
              : enabledState.permission === "denied"
                ? "Bildirim izni verilmedi. Teslimat açılmadı."
                : "Bu cihaz teslimat için kaydedilemedi. Bildirimler açılmadı.",
            tone: "error"
          });
          return;
        }
      }
      const updated = await trackAuthenticatedMutation(() => apiRequest<NotificationPreferencePayload>(
        "/notification-preferences",
        {
          method: "PATCH",
          body: JSON.stringify({
            enabled: alarmEnabled && Boolean(coordinator?.getState().active),
            ...(alarmEnabled && coordinator?.getState().active
              ? { deliveryConsentVersion: "phase3-v1" }
              : {}),
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
        currentSession.accessToken,
        { ownerSnapshot }
      ));

      if (!alarmEnabled && coordinator) {
        const detachedState = await coordinator.setPreferenceEnabled(false);
        if (detachedState.registration === "error") {
          setCleanupIssue({
            action: "notification_settings",
            failedTargets: ["device_registration"],
            ownerId: currentSession.user.id
          });
          setPreferences({ loading: false, data: updated, attempted: true, stale: false });
          setNotificationPreferenceOutcome("error");
          setNotificationPreferenceError("Tercih kapatıldı; cihaz kaydının kaldırıldığı doğrulanamadı.");
          setMessage({
            text: "Bildirim tercihi kapatıldı; cihaz kaydının sunucudan kaldırıldığı doğrulanamadı.",
            tone: "error"
          });
          return;
        }
      }
      setPreferences({ loading: false, data: updated, attempted: true, stale: false });
      setNotificationPreferenceOutcome("saved");
      setNotificationPreferenceError(undefined);
      setMessage({
        text: updated.enabled
          ? "Bildirim izni, cihaz kaydı ve alarm tercihleri doğrulandı."
          : "Bildirim teslimatı kapatıldı; cihaz kaydı kaldırıldı.",
        tone: "success"
      });
    } catch (error) {
      if (alarmEnabled) await notificationCoordinatorRef.current?.setPreferenceEnabled(false).catch(() => undefined);
      if (error instanceof StaleAccountRequestError) return;
      const controlledNotificationError = userMessageFromError(error, "Alarm ayarları kaydedilemedi");
      setNotificationPreferenceOutcome("error");
      setNotificationPreferenceError(controlledNotificationError);
      setMessage({
        text: userMessageFromError(error, "Alarm ayarları kaydedilemedi"),
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function retryNotificationSettings(): Promise<void> {
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot) return;
    setNotificationPreferenceOutcome("idle");
    setNotificationPreferenceError(undefined);
    const loaded = await loadPreferences(currentSession.accessToken, ownerSnapshot);
    const coordinator = notificationCoordinatorRef.current;
    if (!loaded || !coordinator || !accountGuardRef.current.isCurrent(ownerSnapshot)) return;
    try {
      await reconcileNotificationDelivery(currentSession, coordinator, loaded, ownerSnapshot);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      const controlledError = userMessageFromError(error, "Bildirim durumu doğrulanamadı");
      setNotificationPreferenceOutcome("error");
      setNotificationPreferenceError(controlledError);
    }
  }

  async function openAnnouncement(link: string): Promise<boolean> {
    const safeLink = canonicalizeOfficialAcademicUrl(link);
    if (!safeLink) {
      setMessage({ text: "Yalnızca doğrulanmış HTTP veya HTTPS bağlantıları açılabilir.", tone: "error" });
      return false;
    }
    try {
      const supported = await Linking.canOpenURL(safeLink);
      if (!supported) {
        setMessage({ text: "Bu resmî bağlantı cihazda açılamıyor.", tone: "error" });
        return false;
      }
      await Linking.openURL(safeLink);
      return true;
    } catch {
      setMessage({ text: "Resmî bağlantı açılamadı. Lütfen tekrar dene.", tone: "error" });
      return false;
    }
  }

  function renderAnnouncementCard(
    item: AnnouncementRecord,
    origin: "academic" | "yok" | "summer-school"
  ) {
    return (
      <Pressable
        key={item.canonicalUrl}
        accessibilityRole="button"
        accessibilityLabel={`${item.sourceName}. ${item.title}. ${contentTimestampLabel(item)}. Ayrıntıyı aç.`}
        style={styles.announcementCard}
        onPress={() => {
          const detailItem = contentFeedDetailItem(item, origin);
          if (!detailItem) {
            setMessage({ text: "Bu içerik güvenilir ayrıntı sınırında doğrulanamadı.", tone: "error" });
            return;
          }
          openContentFeedItem(detailItem);
        }}
      >
        <View style={styles.announcementTopRow}>
          <Text style={styles.announcementSourcePill}>{item.sourceName}</Text>
          <Text style={styles.announcementDate}>{contentTimestampLabel(item)}</Text>
        </View>
        <Text style={styles.announcementTitle}>{item.title}</Text>
        {item.summary && <Text style={styles.announcementSummary}>{item.summary}</Text>}
        <View style={styles.announcementActionRow}>
          <Text style={styles.linkText}>Ayrıntıyı aç</Text>
          <Ionicons name="chevron-forward" size={16} color="#2563eb" />
        </View>
      </Pressable>
    );
  }

  function personalExamMutationSnapshot(): AccountGenerationSnapshot | null {
    if (accountCleanupInProgressRef.current) return null;
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    const personalExamState = personalExamRuntime.getSnapshot();
    if (!currentSession
      || !ownerSnapshot
      || !personalExamState.hydrated
      || personalExamState.ownerId !== currentSession.user.id
      || ownerSnapshot.ownerId !== currentSession.user.id) return null;
    return ownerSnapshot;
  }

  function createPersonalExam(input: PersonalExamMutationInput): PersonalExamMutationResult {
    const ownerSnapshot = personalExamMutationSnapshot();
    if (!ownerSnapshot) return { ok: false, error: "Hesaba ait sınav alanı henüz hazır değil." };
    const result = personalExamRuntime.create(input, ownerSnapshot);
    if (!result.ok) return result;
    setMessage({ text: "Kişisel sınav hesabının cihaz planına eklendi.", tone: "success" });
    return result;
  }

  function updatePersonalExam(
    id: string,
    input: PersonalExamMutationInput
  ): PersonalExamMutationResult {
    const ownerSnapshot = personalExamMutationSnapshot();
    if (!ownerSnapshot) return { ok: false, error: "Hesaba ait sınav alanı henüz hazır değil." };
    const result = personalExamRuntime.update(id, input, ownerSnapshot);
    if (!result.ok) return result;
    const updatedExam = personalExamRuntime.getSnapshot().exams.find((exam) => exam.id === id);
    setActiveCalendarDetail((current) => current?.source === "personal" && current.id === id
      && updatedExam ? {
        ...current,
        title: updatedExam.title,
        startDate: updatedExam.examDate,
        temporalKind: "timestamp"
      }
      : current);
    setMessage({ text: "Kişisel sınav güncellendi.", tone: "success" });
    return result;
  }

  function deletePersonalExam(id: string): PersonalExamMutationResult {
    const ownerSnapshot = personalExamMutationSnapshot();
    if (!ownerSnapshot) return { ok: false, error: "Hesaba ait sınav alanı henüz hazır değil." };
    const result = personalExamRuntime.delete(id, ownerSnapshot);
    if (!result.ok) return result;
    setActiveCalendarDetail(null);
    setMessage({ text: "Kişisel sınav silindi.", tone: "success" });
    requestAppRoute("Calendar");
    return result;
  }

  function openCalendarItem(item: CalendarItem): void {
    setActiveCalendarDetail(item);
    setActiveTab("calendar");
    requestAppRoute("CalendarEventDetail", { eventId: item.routeId });
  }

  function handleNavigationRequestHandled(requestKey: string): void {
    acknowledgeNavigationRequest(requestKey);
    const notificationRequest = notificationNavigationRequestRef.current;
    if (!notificationRequest || notificationRequest.requestKey !== requestKey) return;
    notificationNavigationRequestRef.current = null;
    if (
      !accountGuardRef.current.isCurrent(notificationRequest.ownerSnapshot)
      || sessionRef.current?.user.id !== notificationRequest.ownerSnapshot.ownerId
    ) return;
    void clearPendingNotificationDestinationIfCurrent(notificationRequest.record)
      .then((cleared) => {
        if (cleared || !accountGuardRef.current.isCurrent(notificationRequest.ownerSnapshot)) return;
        setCleanupIssue({
          action: "activation",
          failedTargets: ["pending_notification_storage"],
          ownerId: notificationRequest.ownerSnapshot.ownerId
        });
      })
      .catch(() => {
        if (!accountGuardRef.current.isCurrent(notificationRequest.ownerSnapshot)) return;
        setCleanupIssue({
          action: "activation",
          failedTargets: ["pending_notification_storage"],
          ownerId: notificationRequest.ownerSnapshot.ownerId
        });
      });
  }

  function handleVisibleRouteChange(route: AppVisibleRoute): void {
    setActiveRoute(route);
    switch (route) {
      case "Login":
        if (authStage.startsWith("password_recovery")) {
          cancelPasswordRecovery();
        } else if (authStage !== "auth" || authMode !== "login") {
          returnToLoginForm();
        }
        return;
      case "Register":
        setAuthMode("register");
        setAuthStage("auth");
        return;
      case "Verification":
        setAuthMode("login");
        setAuthStage("verify");
        return;
      case "PasswordRecoveryRequest":
        if (authStage === "password_recovery_code" || authStage === "password_recovery_confirm") returnToPasswordRecoveryRequest();
        else setAuthStage("password_recovery_request");
        return;
      case "PasswordRecoveryCode":
        if (pendingPasswordRecovery) setAuthStage("password_recovery_code");
        else setAuthStage("password_recovery_request");
        return;
      case "PasswordRecoveryConfirm":
        if (pendingPasswordRecovery) setAuthStage("password_recovery_confirm");
        else setAuthStage("password_recovery_request");
        return;
      case "AcademicOnboarding":
        setAuthStage("academic_onboarding");
        return;
      case "Home":
        setActiveTab("home");
        return;
      case "Announcements":
        setActiveTab("announcements");
        return;
      case "AnnouncementDetail":
        setActiveTab("announcements");
        if (activeTrustedDetail?.type !== "announcement" && !announcementDetailLoad) {
          requestAppRoute("Announcements");
        }
        return;
      case "SummerSchool":
        setActiveTab("summer");
        return;
      case "YokAnnouncements":
        setActiveTab("yok");
        return;
      case "Calendar":
      case "CalendarEventDetail":
        setActiveTab("calendar");
        return;
      case "Profile":
      case "AcademicProfileSettings":
      case "NotificationSettings":
      case "GoogleCalendarSettings":
      case "AccountDataSettings":
        setActiveTab("profile");
        return;
      case "BootstrapLoading":
      case "BootstrapError":
      case "UnknownRoute":
        return;
    }
  }

  const bootstrapLoading = (
    <BootstrapLoadingState />
  );
  const bootstrapError = (
    <BootstrapErrorState error={hydrationError ?? undefined} onRetry={() => void hydrateApplication()} />
  );

  function updateOnboardingDraft(nextDraft: AcademicOnboardingDraft): void {
    setRegisterUniversityId(nextDraft.universityId);
    setRegisterFacultyId(nextDraft.facultyId);
    setRegisterDepartmentId(nextDraft.departmentId);
    setRegisterClassLevel(nextDraft.classLevel);
    setAcademicProfileSaveState("idle");
    setAcademicProfileSaveError(undefined);
    setMessage(null);
  }

  function discardAcademicProfileChanges(): void {
    setRegisterUniversityId(onboardingInitialDraft.universityId);
    setRegisterFacultyId(onboardingInitialDraft.facultyId);
    setRegisterDepartmentId(onboardingInitialDraft.departmentId);
    setRegisterClassLevel(onboardingInitialDraft.classLevel);
    setAcademicProfileSaveState("idle");
    setAcademicProfileSaveError(undefined);
    setMessage(null);
  }

  async function saveAcademicProfileSettings(): Promise<void> {
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot || accountCleanupInProgressRef.current) return;

    setAcademicProfileSaveState("saving");
    setAcademicProfileSaveError(undefined);
    setMessage(null);
    try {
      const result = await commitAcademicProfileDraft(
        academicOnboardingDraft,
        (payload) => trackAuthenticatedMutation(() => apiRequest<UserProfile>(
          "/me/university",
          { method: "PATCH", body: JSON.stringify(payload) },
          currentSession.accessToken,
          { ownerSnapshot }
        ))
      );
      if (!result.ok) {
        setAcademicProfileSaveState("error");
        setAcademicProfileSaveError("Üniversite seçimi zorunludur.");
        return;
      }
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();

      const authoritativeDraft = result.draft;
      setSelectedUniversityId(authoritativeDraft.universityId);
      setRegisterUniversityId(authoritativeDraft.universityId);
      setRegisterFacultyId(authoritativeDraft.facultyId);
      setRegisterDepartmentId(authoritativeDraft.departmentId);
      setRegisterClassLevel(authoritativeDraft.classLevel);
      setOnboardingInitialDraft(authoritativeDraft);
      setFullName(result.profile.fullName);
      setEmail(result.profile.email);
      setAccountAuthProvider(normalizeAccountAuthProvider(result.profile.authProvider));
      setAcademicProfileSaveState("saved");
      setAcademicProfileSaveError(undefined);
      setSummerSchool({ loading: false });
      const resetOwnedAcademicContent = invalidateContentFeedOwnership;
      resetOwnedAcademicContent();
      setMessage({ text: "Akademik profil kaydedildi.", tone: "success" });
      void Promise.allSettled([
        loadMyCalendar(currentSession.accessToken, ownerSnapshot),
        loadUpcoming(currentSession.accessToken, ownerSnapshot),
        loadAnnouncements(currentSession.accessToken, authoritativeDraft.universityId, ownerSnapshot),
        loadPreferences(currentSession.accessToken, ownerSnapshot)
      ]);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      const controlledError = userMessageFromError(
        error,
        "Akademik profil kaydedilemedi. Bilgilerini kontrol edip tekrar dene."
      );
      setAcademicProfileSaveState("error");
      setAcademicProfileSaveError(controlledError);
      setMessage({ text: controlledError, tone: "error" });
    }
  }

  function renderAuthOnboardingScreen(route: AppVisibleRoute): ReactNode {
    const sharedFeedback = message as AuthFeedback | null;
    switch (route) {
      case "Login":
        return (
          <LoginScreen
            busy={busy}
            email={email}
            feedback={sharedFeedback}
            googleAvailable={GOOGLE_AUTH_CONFIGURED}
            googleBusy={googleBusy}
            googleUnavailableMessage={GOOGLE_AUTH_CONFIGURATION_MESSAGE}
            onDismissFeedback={() => setMessage(null)}
            onEmailChange={(value) => {
              setEmail(value);
              setMessage(null);
            }}
            onForgotPassword={() => openPasswordRecovery()}
            onGoogleSubmit={() => void handleGoogleAuth()}
            onPasswordChange={(value) => {
              setPassword(value);
              setMessage(null);
            }}
            onRegister={() => {
              setAuthMode("register");
              setAuthStage("auth");
              setMessage(null);
            }}
            onSubmit={() => void handleAuth()}
            onVerificationRecovery={() => void openVerificationRecovery()}
            password={password}
          />
        );
      case "Register":
        return (
          <RegistrationScreen
            busy={busy}
            email={email}
            feedback={sharedFeedback}
            fullName={fullName}
            onDismissFeedback={() => setMessage(null)}
            onEmailChange={(value) => {
              setEmail(value);
              setMessage(null);
            }}
            onFullNameChange={(value) => {
              setFullName(value);
              setMessage(null);
            }}
            onLogin={returnToLoginForm}
            onPasswordChange={(value) => {
              setPassword(value);
              setMessage(null);
            }}
            onPasswordConfirmationChange={(value) => {
              setRegistrationPasswordConfirmation(value);
              setMessage(null);
            }}
            onSubmit={() => void handleAuth()}
            password={password}
            passwordConfirmation={registrationPasswordConfirmation}
          />
        );
      case "Verification":
        return (
          <VerificationScreen
            busy={busy}
            code={verificationToken}
            email={email}
            feedback={sharedFeedback}
            onChangeEmail={returnToLoginForm}
            onCodeChange={(value) => {
              setVerificationToken(normalizeNumericCode(value, 4));
              setMessage(null);
            }}
            onDismissFeedback={() => setMessage(null)}
            onResend={() => void resendVerificationEmail()}
            onSubmit={() => void handleVerifyEmail()}
            timing={verificationTiming}
          />
        );
      case "PasswordRecoveryRequest":
        return (
          <PasswordRecoveryRequestScreen
            busy={busy}
            email={email}
            feedback={passwordRecoveryFeedback}
            onCancel={cancelPasswordRecovery}
            onEmailChange={(value) => {
              setEmail(value);
              setPasswordRecoveryFeedback(null);
            }}
            onSubmit={() => void requestPasswordRecovery()}
            timing={pendingPasswordRecovery?.email === email.trim().toLowerCase()
              ? passwordRecoveryTiming
              : null}
          />
        );
      case "PasswordRecoveryCode":
        return (
          <PasswordRecoveryCodeScreen
            busy={busy}
            code={passwordRecoveryCode}
            email={pendingPasswordRecovery?.email ?? email}
            feedback={passwordRecoveryFeedback}
            onBack={returnToPasswordRecoveryRequest}
            onCancel={cancelPasswordRecovery}
            onCodeChange={(value) => {
              setPasswordRecoveryCode(normalizeNumericCode(value, PASSWORD_RECOVERY_CODE_LENGTH));
              setPasswordRecoveryFeedback(null);
            }}
            onContinue={continuePasswordRecoveryCode}
            onResend={() => void requestPasswordRecovery()}
            timing={passwordRecoveryTiming}
          />
        );
      case "PasswordRecoveryConfirm":
        return (
          <PasswordRecoveryConfirmScreen
            busy={busy}
            code={passwordRecoveryCode}
            feedback={passwordRecoveryFeedback}
            newPassword={newPassword}
            onBack={returnToPasswordRecoveryCode}
            onCancel={cancelPasswordRecovery}
            onNewPasswordChange={(value) => {
              setNewPassword(value);
              setPasswordRecoveryFeedback(null);
            }}
            onPasswordConfirmationChange={(value) => {
              setPasswordConfirmation(value);
              setPasswordRecoveryFeedback(null);
            }}
            onSubmit={() => void confirmPasswordRecovery()}
            passwordConfirmation={passwordConfirmation}
          />
        );
      case "AcademicOnboarding":
        return (
          <AcademicOnboardingScreen
            busy={busy}
            classLevels={academicClassLevelOptions}
            departments={(departments.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
            departmentsError={departments.error}
            departmentsLoading={departments.loading}
            draft={academicOnboardingDraft}
            email={session?.user.email ?? email}
            faculties={(faculties.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
            facultiesError={faculties.error}
            facultiesLoading={faculties.loading}
            feedback={sharedFeedback}
            fullName={session?.user.fullName ?? fullName}
            initialDraft={onboardingInitialDraft}
            needsPassword={!session}
            onBack={() => {
              if (session) void handleLogout();
              else returnToLoginForm();
            }}
            onClassLevelChange={(value) => updateOnboardingDraft(
              selectAcademicClassLevel(academicOnboardingDraft, value)
            )}
            onDepartmentChange={(value) => updateOnboardingDraft(
              selectAcademicDepartment(academicOnboardingDraft, value)
            )}
            onDismissFeedback={() => setMessage(null)}
            onFacultyChange={(value) => updateOnboardingDraft(
              selectAcademicFaculty(academicOnboardingDraft, value)
            )}
            onPasswordChange={(value) => {
              setPassword(value);
              setMessage(null);
            }}
            onRetryDepartments={() => void loadDepartmentsForRegistration(registerFacultyId)}
            onRetryFaculties={() => void loadFacultiesForRegistration(registerUniversityId)}
            onRetryUniversities={() => void loadUniversities()}
            onSave={() => void saveAcademicOnboarding()}
            onSkip={skipAcademicOnboarding}
            onUniversityChange={(value) => updateOnboardingDraft(
              selectAcademicUniversity(academicOnboardingDraft, value)
            )}
            password={password}
            universities={(universities.data ?? []).map((item) => ({
              value: item.id,
              label: item.name,
              supportingText: item.city
            }))}
            universitiesError={universities.error}
            universitiesLoading={universities.loading}
          />
        );
      default:
        return null;
    }
  }

  function renderCleanupIssue(): ReactNode {
    if (!cleanupIssue) return null;
    const hasRetryableTarget = cleanupIssue.failedTargets.some(
      (target) => target !== "server_session"
        && target !== "server_account"
        && (target !== "device_registration" || Boolean(session))
    );
    return (
      <Banner
        actionLabel={hasRetryableTarget && !busy && !googleBusy ? "Temizliği tekrar dene" : undefined}
        message={cleanupIssue.failedTargets.map(cleanupTargetLabel).join(", ")}
        onAction={hasRetryableTarget && !busy && !googleBusy ? () => void retryFailedCleanup() : undefined}
        title="Tamamlanamayan güvenli temizlik"
        tone="warning"
      />
    );
  }

  function renderRoutedScreen(route: AppVisibleRoute): ReactNode {
    if (AUTH_ROUTE_NAMES.has(route) || route === "AcademicOnboarding") {
      return (
        <>
          {renderCleanupIssue()}
          {renderAuthOnboardingScreen(route)}
        </>
      );
    }
    const showsAuthHero = false;
    return (
      <>
          {showsAuthHero && (
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

          {session && notificationDestinationNotice && (
            <View style={styles.inlineInfoCard} accessibilityLiveRegion="polite">
              <Text style={styles.inlineInfoTitle}>
                {notificationDestinationNotice.status === "opened"
                  ? "Bildirim hedefi doğrulandı"
                  : notificationDestinationNotice.status === "temporarily_unavailable"
                    ? "Bildirim hedefi şu anda doğrulanamıyor"
                    : "Bildirim hedefi artık kullanılamıyor"}
              </Text>
              <Text style={styles.inlineInfoText}>
                {notificationDestinationNotice.status === "opened"
                  ? notificationDestinationNotice.title ?? "İstenen içerik güvenli biçimde açıldı."
                  : notificationDestinationNotice.status === "temporarily_unavailable"
                    ? "Bağlantı veya sunucu hatası nedeniyle hedef doğrulanamadı. Kayıt korundu; tekrar deneyebilirsin."
                    : "İçerik bu hesaba ait güncel ve güvenilir kaynaklarda bulunamadığı için başka bir kayıt açılmadı."}
              </Text>
              {notificationDestinationNotice.status === "temporarily_unavailable" && (
                <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void retryPendingNotificationDestination()}>
                  <Text style={styles.secondaryButtonText}>Hedefi Tekrar Doğrula</Text>
                </Pressable>
              )}
              <Pressable style={styles.textActionButton} onPress={() => setNotificationDestinationNotice(null)}>
                <Text style={styles.textActionText}>Kapat</Text>
              </Pressable>
            </View>
          )}

          {renderCleanupIssue()}

          {(route === "Login" || route === "Register") && (
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

          {route === "PasswordRecoveryRequest" && (
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

          {route === "PasswordRecoveryConfirm" && (
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

          {route === "Verification" && (
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

          {session && route === "Home" && (
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
                  <Text style={styles.quickActionText}>
                    {googleCalendarLive
                      ? `${googleCalendarIntegration?.mappings.length ?? 0} kayıt doğrulandı`
                      : googleCalendarLifecycleLabel(googleCalendarState)}
                  </Text>
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
                    <Text style={styles.countdownBadge}>{formatAcademicRemainingTime(nextExam, new Date())}</Text>
                    <Text style={styles.caption}>{formatAcademicTemporal(nextExam)}</Text>
                  </View>
                )}

                {examCountdownItems.slice(nextExam ? 1 : 0, nextExam ? 4 : 3).map((exam) => (
                  <View key={exam.id} style={styles.eventCard}>
                    <Text style={styles.eventTitle}>{exam.title}</Text>
                    <Text style={styles.countdownBadge}>{formatAcademicRemainingTime(exam, new Date())}</Text>
                    <Text style={styles.caption}>{formatAcademicTemporal(exam)}</Text>
                  </View>
                ))}

                <Pressable
                  accessibilityRole="button"
                  style={[styles.button, styles.secondaryButton]}
                  onPress={() => requestAppRoute("Calendar")}
                  disabled={busy}
                >
                  <Text style={styles.secondaryButtonText}>Kişisel sınavları Takvim'de yönet</Text>
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
                {upcomingAvailabilityMessage && <Text style={styles.caption}>{upcomingAvailabilityMessage}</Text>}

                {nextUpcomingEvent && (
                  <View style={styles.eventHighlightRow}>
                    <View style={styles.eventDateBadge}>
                      <Text style={styles.eventDateBadgeText}>{formatAcademicTemporal(nextUpcomingEvent)}</Text>
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
                    <Text style={styles.caption}>{formatAcademicTemporal(event)}</Text>
                  </View>
                ))}
              </Section>
            </>
          )}

          {session && route === "GoogleCalendarSettings" && (
            <>
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
                  <View style={[styles.statusPill, googleCalendarLive ? styles.statusPillSuccess : styles.statusPillNeutral]}>
                    <Text style={[styles.statusPillText, googleCalendarLive ? styles.statusPillTextSuccess : styles.statusPillTextNeutral]}>
                      {googleCalendarLifecycleLabel(googleCalendarState)}
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

                <View style={styles.calendarSyncSummary} accessible accessibilityLabel="Google Takvim güvenlik sınırı">
                  <Text style={styles.calendarSyncSummaryLabel}>Güvenli eşitleme sınırı</Text>
                  <Text style={styles.caption}>Hesabını seçip izin verdiğinde akademik kayıtlar gönderilir ve doğrulanır. Kişisel Google etkinliklerin hiçbir zaman değiştirilmez.</Text>
                </View>

                {googleCalendarIntegration && (
                  <View style={styles.calendarSyncSummary}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.calendarSyncSummaryLabel}>Google'da doğrulanan</Text>
                      <Text style={styles.calendarSyncSummaryValue}>
                        {googleCalendarLastResult?.verified ?? googleCalendarIntegration.mappings.length}
                      </Text>
                    </View>
                    <Text style={styles.caption}>
                      {googleCalendarIntegration.lastSyncedAt
                        ? `Son eşitleme: ${formatDateTimeShort(googleCalendarIntegration.lastSyncedAt)}`
                        : `Yetki doğrulaması: ${formatDateTimeShort(googleCalendarIntegration.authorizationVerifiedAt ?? "")}`}
                    </Text>
                    {googleCalendarLastResult && (
                      <Text style={styles.caption}>
                        {googleCalendarLastResult.created} yeni, {googleCalendarLastResult.updated} güncellenen, {googleCalendarLastResult.deleted} kaldırılan, {googleCalendarLastResult.failed} başarısız
                      </Text>
                    )}
                    {googleCalendarWarnings.map((warning) => (
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
                        <Text style={styles.primaryButtonText}>{googleCalendarLive ? "Şimdi Eşitle" : "Bağlan ve Eşitle"}</Text>
                      </View>
                    )}
                  </Pressable>
                  {googleCalendarIntegration && (
                    <Pressable
                      style={[styles.button, styles.secondaryButton, (busy || googleCalendarBusy) && styles.buttonDisabled]}
                      onPress={promptGoogleCalendarAccountSwitch}
                      disabled={busy || googleCalendarBusy}
                    >
                      <View style={styles.buttonContent}>
                        <Ionicons name="swap-horizontal-outline" size={19} color="#1e293b" />
                        <Text style={styles.secondaryButtonText}>Google Hesabını Değiştir</Text>
                      </View>
                    </Pressable>
                  )}
                  {googleCalendarIntegration && (
                    <>
                      <Pressable
                        style={[styles.button, styles.secondaryButton, (busy || googleCalendarBusy) && styles.buttonDisabled]}
                        onPress={() => void disconnectGoogleCalendar({ removeManagedEvents: false, revokeAccess: false })}
                        disabled={busy || googleCalendarBusy}
                      >
                        <Text style={styles.secondaryButtonText}>Bağlantıyı Kes · Kayıtlar Kalsın</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.button, styles.secondaryButton, (busy || googleCalendarBusy) && styles.buttonDisabled]}
                        onPress={() => void disconnectGoogleCalendar({ removeManagedEvents: true, revokeAccess: false })}
                        disabled={busy || googleCalendarBusy}
                      >
                        <Text style={styles.secondaryButtonText}>Uygulama Kayıtlarını Kaldır ve Kes</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.button, styles.dangerButton, (busy || googleCalendarBusy) && styles.buttonDisabled]}
                        onPress={() => void disconnectGoogleCalendar({ removeManagedEvents: false, revokeAccess: true })}
                        disabled={busy || googleCalendarBusy}
                      >
                        <Text style={styles.dangerButtonText}>Google Erişimini Geri Al · Kayıtlar Kalsın</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </Section>

            </>
          )}

          {session && route === "SummerSchool" && (
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
                    (!registerUniversityId || summerSchool.loading || calendar.loading || busy) && styles.buttonDisabled
                  ]}
                  onPress={() => void refreshSummerSchool()}
                  disabled={!registerUniversityId || summerSchool.loading || calendar.loading || busy}
                >
                  <Ionicons name="refresh-outline" size={18} color="#1e293b" />
                  <Text style={styles.secondaryButtonText}>{summerSchool.error || calendar.error ? "Tekrar Dene" : "Yaz Okulunu Yenile"}</Text>
                </Pressable>

                {(summerSchool.loading || calendar.loading) && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                {summerSchool.error && registerUniversityId && <Text style={styles.errorText}>{summerSchool.error}</Text>}
                {calendar.error && registerUniversityId && <Text style={styles.errorText}>{calendar.error}</Text>}
                {summerAvailabilityMessage && <Text style={styles.caption}>{summerAvailabilityMessage}</Text>}

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
                    {summerDateAvailabilityMessage && <Text style={styles.caption}>{summerDateAvailabilityMessage}</Text>}
                    {summerSchoolEvents.map((event) => (
                      <View key={event.id} style={styles.eventCard}>
                        <Text style={styles.eventCategory}>{toCategoryLabel(event.category)}</Text>
                        <Text style={styles.eventTitle}>{event.title}</Text>
                        <Text style={styles.caption}>{formatAcademicTemporal(event)}</Text>
                      </View>
                    ))}

                    {calendar.attempted && !calendar.loading && !calendar.error && summerSchoolEvents.length === 0 && (
                      <View style={styles.emptyStatePanel}>
                        <Ionicons name="sunny-outline" size={24} color="#ea580c" />
                        <Text style={styles.emptyStateTitle}>Henüz yaz okulu tarihi yok</Text>
                        <Text style={styles.caption}>Üniversite takviminde yaz okulu tarihleri bulunduğunda burada listelenecek.</Text>
                      </View>
                    )}
                  </Section>

                  <Section title="Yaz Okulu Duyuruları">
                    {(summerSchool.data?.requirements ?? []).map((item) => {
                      const sourceUrl = item.sourceUrl;
                      const content = (
                        <>
                          <View style={styles.announcementTopRow}>
                            <Text style={styles.announcementSourcePill}>Koşul</Text>
                            <Text style={styles.announcementDate}>{item.date ? formatAcademicTemporal({ startDate: item.date }) : "-"}</Text>
                          </View>
                          <Text style={styles.announcementTitle}>{item.message}</Text>
                          {!sourceUrl && <Text style={styles.caption}>Resmî bağlantı mevcut değil.</Text>}
                        </>
                      );
                      return sourceUrl ? (
                        <Pressable
                          key={`${item.eventId ?? item.message}-${item.date ?? "date"}`}
                          style={styles.announcementCard}
                          onPress={() => void openAnnouncement(sourceUrl)}
                        >
                          {content}
                        </Pressable>
                      ) : (
                        <View key={`${item.eventId ?? item.message}-${item.date ?? "date"}`} style={styles.announcementCard}>
                          {content}
                        </View>
                      );
                    })}
                    {summerSchoolAnnouncements.map((item) => renderAnnouncementCard(item, "summer-school"))}

                    {summerSchool.attempted && !summerSchool.loading && !summerSchool.error && (summerSchool.data?.requirements ?? []).length === 0 && summerSchoolAnnouncements.length === 0 && (
                      <View style={styles.emptyStatePanel}>
                        <Ionicons name="megaphone-outline" size={24} color="#b45309" />
                        <Text style={styles.emptyStateTitle}>Henüz yaz okulu duyurusu yok</Text>
                        <Text style={styles.caption}>Kaynaklar güncellendiğinde başvuru ve ders alma duyuruları burada görünecek.</Text>
                      </View>
                    )}
                  </Section>

                  <Section title="Aynı Bölümde Seçenekler">
                    {(summerSchool.data?.sameDepartmentOptions ?? []).map((option) => {
                      const sourceUrl = option.sourceUrl;
                      const content = (
                        <>
                          <View style={styles.announcementTopRow}>
                            <Text style={styles.announcementSourcePill}>{option.academicYear}</Text>
                            <Text style={styles.announcementDate}>{option.events.length} tarih</Text>
                          </View>
                          <Text style={styles.announcementTitle}>{option.universityName}</Text>
                          <Text style={styles.announcementSummary}>
                            {(option.matchingDepartments ?? []).map((item) => item.departmentName).slice(0, 3).join(", ") || "Benzer bölüm bilgisi"}
                          </Text>
                          {!sourceUrl && <Text style={styles.caption}>Resmî bağlantı mevcut değil.</Text>}
                        </>
                      );
                      return sourceUrl ? (
                        <Pressable
                          key={`${option.universityId}-${option.academicYear}`}
                          style={styles.announcementCard}
                          onPress={() => void openAnnouncement(sourceUrl)}
                        >
                          {content}
                        </Pressable>
                      ) : (
                        <View key={`${option.universityId}-${option.academicYear}`} style={styles.announcementCard}>
                          {content}
                        </View>
                      );
                    })}

                    {summerSchool.attempted && !summerSchool.loading && !summerSchool.error && (summerSchool.data?.sameDepartmentOptions ?? []).length === 0 && (
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

          {session && route === "YokAnnouncements" && (
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
                onPress={() => void refreshContentFeed()}
                disabled={yokAnnouncements.loading || busy}
              >
                <Ionicons name="refresh-outline" size={18} color="#1e293b" />
                <Text style={styles.secondaryButtonText}>{yokAnnouncements.error ? "Tekrar Dene" : "YÖK Duyurularını Yenile"}</Text>
              </Pressable>

              {yokAnnouncements.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
              {yokAnnouncements.error && <Text style={styles.errorText}>{yokAnnouncements.error}</Text>}
              {yokAvailabilityMessage && <Text style={styles.caption}>{yokAvailabilityMessage}</Text>}
              {yokAnnouncementItems.map((item) => renderAnnouncementCard(item, "yok"))}

              {yokAnnouncements.attempted && !yokAnnouncements.loading && !yokAnnouncements.error && yokAnnouncementItems.length === 0 && (
                <View style={styles.emptyStatePanel}>
                  <Ionicons name="newspaper-outline" size={24} color="#0f766e" />
                  <Text style={styles.emptyStateTitle}>YÖK duyurusu bulunamadı</Text>
                  <Text style={styles.caption}>Resmi kaynak yanıt verdiğinde duyurular burada listelenecek.</Text>
                </View>
              )}
            </Section>
          )}

          {session && (
            route === "Profile"
            || route === "AcademicProfileSettings"
            || route === "NotificationSettings"
            || route === "AccountDataSettings"
          ) && (
            <>
              {route === "Profile" && (
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

                <View style={styles.settingsRouteList}>
                  <ListItem title="Akademik Profil" onPress={() => requestAppRoute("AcademicProfileSettings")} />
                  <ListItem title="Bildirimler" onPress={() => requestAppRoute("NotificationSettings")} />
                  <ListItem title="Google Takvim" onPress={() => requestAppRoute("GoogleCalendarSettings")} />
                  <ListItem title="Hesap ve Veri" onPress={() => requestAppRoute("AccountDataSettings")} />
                </View>

                <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void handleLogout()} disabled={busy}>
                  <Ionicons name="log-out-outline" size={18} color="#1e293b" />
                  <Text style={styles.secondaryButtonText}>Çıkış Yap</Text>
                </Pressable>
                </Section>
              )}

              {(route === "Profile" || route === "AccountDataSettings") && (
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

                {recentAuthAction && (
                  <RecentAuthenticationPanel
                    action={recentAuthAction}
                    busy={recentAuthBusy}
                    error={recentAuthError}
                    methods={availableRecentAuthMethods}
                    onCancel={dismissRecentAuthentication}
                    onPasswordChange={(value) => {
                      setRecentAuthPassword(value);
                      setRecentAuthError(undefined);
                    }}
                    onSubmitGoogle={() => void submitRecentAuthentication("google")}
                    onSubmitPassword={() => void submitRecentAuthentication("password")}
                    password={recentAuthPassword}
                  />
                )}

                <Pressable
                  style={[styles.button, styles.secondaryButton, (busy || Boolean(recentAuthAction)) && styles.buttonDisabled]}
                  onPress={confirmDeleteMyData}
                  disabled={busy || Boolean(recentAuthAction)}
                >
                  <Ionicons name="trash-bin-outline" size={18} color="#1e293b" />
                  <Text style={styles.secondaryButtonText}>Verilerimi Sil</Text>
                </Pressable>

                <Pressable
                  style={[styles.button, styles.dangerButton, (busy || Boolean(recentAuthAction)) && styles.buttonDisabled]}
                  onPress={confirmDeleteAccount}
                  disabled={busy || Boolean(recentAuthAction)}
                >
                  <Ionicons name="person-remove-outline" size={18} color="#ffffff" />
                  <Text style={styles.dangerButtonText}>Hesabımı Sil</Text>
                </Pressable>
                </Section>
              )}

              {(route === "Profile" || route === "AcademicProfileSettings") && (
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
                      {universities.loading && <ActivityIndicator color="#0f5f80" style={styles.loader} />}
                      {universities.error && <Text style={styles.errorText}>{universities.error}</Text>}
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
                      {universities.attempted && !universities.loading && !universities.error && filteredUniversities.length === 0 && (
                        <Text style={styles.caption}>Eşleşen üniversite bulunamadı.</Text>
                      )}
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
                      {faculties.error && <Text style={styles.errorText}>{faculties.error}</Text>}
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
                      {faculties.attempted && !faculties.loading && !faculties.error && filteredFaculties.length === 0 && (
                        <Text style={styles.caption}>Eşleşen fakülte bulunamadı.</Text>
                      )}
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
                      {departments.error && <Text style={styles.errorText}>{departments.error}</Text>}
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
                      {departments.attempted && !departments.loading && !departments.error && filteredDepartments.length === 0 && (
                        <Text style={styles.caption}>Eşleşen bölüm bulunamadı.</Text>
                      )}
                    </View>
                  )}
                  </View>
                  </View>
                )}
                </Section>
              )}

              {(route === "Profile" || route === "NotificationSettings") && (
                <Section title="Bildirim Tercihleri">
                <View style={styles.notificationStatusPanel}>
                  <View style={styles.notificationIcon}>
                    <Ionicons name="notifications-outline" size={22} color="#b45309" />
                  </View>
                  <View style={styles.flexOne}>
                    <Text style={styles.notificationTitle}>Akademik hatırlatmalar</Text>
                    <Text style={styles.caption}>{notificationLifecycleMessage(notificationLifecycle)}</Text>
                  </View>
                  <Switch value={alarmEnabled} onValueChange={setAlarmEnabled} />
                </View>

                <View style={styles.calendarSyncSummary} accessibilityLiveRegion="polite">
                  <View style={styles.rowBetween}>
                    <Text style={styles.calendarSyncSummaryLabel}>Teslimat durumu</Text>
                    <Text style={styles.calendarSyncSummaryValue}>
                      {notificationLifecycle.active ? "Etkin" : "Etkin değil"}
                    </Text>
                  </View>
                  <Text style={styles.caption}>
                    İzin: {notificationLifecycle.permission} · Cihaz kaydı: {notificationLifecycle.registration}
                  </Text>
                  {notificationLifecycle.permission === "permanently_denied" && (
                    <Pressable
                      style={[styles.button, styles.secondaryButton]}
                      onPress={() => void openNotificationSettings()}
                    >
                      <Text style={styles.secondaryButtonText}>Cihaz Bildirim Ayarlarını Aç</Text>
                    </Pressable>
                  )}
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
              )}
            </>
          )}
      </>
    );
  }

  const homeEvents = [
    ...(calendar.data?.events ?? []),
    ...(upcoming.data ?? []).filter(
      (event) => !(calendar.data?.events ?? []).some((calendarEvent) => calendarEvent.id === event.id)
    )
  ];
  const homeManualExams = session?.user.id === manualExamOwnerId && manualExamsHydrated
    ? manualExams
    : [];
  const homeDailyBrief = session ? (
    <HomeDailyBrief
      fullName={session.user.fullName}
      profileComplete={Boolean(registerUniversityId)}
      universityName={selectedUniversity?.name ?? (registerUniversityId ? "Üniversite bilgisi kayıtlı" : undefined)}
      facultyName={selectedFaculty?.name}
      departmentName={selectedDepartment?.name}
      events={homeEvents}
      manualExams={homeManualExams}
      announcements={announcementFeed}
      calendarLoading={calendar.loading || upcoming.loading}
      calendarAttempted={Boolean(calendar.attempted && upcoming.attempted)}
      calendarError={calendar.error ?? upcoming.error}
      calendarStale={calendar.stale || upcoming.stale}
      announcementLoading={announcements.loading}
      announcementAttempted={Boolean(announcements.attempted)}
      announcementError={announcements.error}
      announcementStale={announcements.stale}
      announcementState={announcements.data?.state}
      googleCalendarState={googleCalendarState}
      notificationPermission={notificationLifecycle.permission}
      notificationPreferenceEnabled={notificationLifecycle.preferenceEnabled}
      notificationActive={notificationLifecycle.active}
      onCompleteProfile={() => requestAppRoute("AcademicProfileSettings")}
      onOpenAnnouncement={(item) => {
        const detailItem = contentFeedDetailItem(item, "academic");
        if (!detailItem) return;
        openContentFeedItem(detailItem);
      }}
      onOpenAnnouncements={() => requestAppRoute("Announcements")}
      onOpenCalendar={() => requestAppRoute("Calendar")}
      onOpenGoogleCalendarSettings={() => requestAppRoute("GoogleCalendarSettings")}
      onOpenNotificationSettings={() => requestAppRoute("NotificationSettings")}
      onRefresh={() => {
        void Promise.allSettled([loadMyCalendar(), loadUpcoming(), refreshContentFeed()]);
      }}
    />
  ) : null;

  const announcementsContentFeed = session ? (
    <AnnouncementsFeed
      academicItems={announcementFeed}
      yokItems={yokAnnouncementItems}
      summerItems={summerSchoolAnnouncements}
      universityName={selectedUniversity?.name}
      facultyName={selectedFaculty?.name}
      departmentName={selectedDepartment?.name}
      loading={contentFeedLoading}
      attempted={contentFeedAttempted}
      refreshing={contentFeedLoading && contentFeedHasRetainedData}
      error={contentFeedError}
      stale={contentFeedStale}
      partial={contentFeedPartial}
      serverLimit={contentFeedLimit}
      hasMore={contentFeedHasMore}
      paginationLoading={contentFeedPagination.loading}
      paginationError={contentFeedPagination.error}
      onRefresh={() => void refreshContentFeed()}
      onRetry={() => void refreshContentFeed()}
      onLoadMore={() => void loadMoreContentFeed()}
      onRetryPagination={() => void loadMoreContentFeed()}
      onOpenItem={openContentFeedItem}
      onOpenNotificationSettings={() => requestAppRoute("NotificationSettings")}
      onOpenYok={() => requestAppRoute("YokAnnouncements")}
      onOpenSummerSchool={() => requestAppRoute("SummerSchool")}
    />
  ) : null;
  const announcementDestinationActive = controlledActiveRoute === "SummerSchool"
    || controlledActiveRoute === "YokAnnouncements";
  const announcementDestinationFeedback = (
    <>
      {announcementDestinationActive && message ? (
        <Banner
          dismissAccessibilityLabel="İşlem mesajını kapat"
          message={message.text}
          onDismiss={() => setMessage(null)}
          title={message.tone === "error"
            ? "İşlem tamamlanamadı"
            : message.tone === "success"
              ? "İşlem tamamlandı"
              : "Bilgi"}
          tone={message.tone}
        />
      ) : null}
      {announcementDestinationActive && session && notificationDestinationNotice ? (
        <Banner
          actionLabel={notificationDestinationNotice.status === "temporarily_unavailable"
            ? "Hedefi tekrar doğrula"
            : undefined}
          dismissAccessibilityLabel="Bildirim hedefi mesajını kapat"
          message={notificationDestinationNotice.status === "opened"
            ? notificationDestinationNotice.title ?? "İstenen içerik güvenli biçimde açıldı."
            : notificationDestinationNotice.status === "temporarily_unavailable"
              ? "Bağlantı veya sunucu hatası nedeniyle hedef doğrulanamadı. Kayıt korundu; tekrar deneyebilirsin."
              : "İçerik bu hesaba ait güncel ve güvenilir kaynaklarda bulunamadığı için başka bir kayıt açılmadı."}
          onAction={notificationDestinationNotice.status === "temporarily_unavailable"
            ? () => void retryPendingNotificationDestination()
            : undefined}
          onDismiss={() => setNotificationDestinationNotice(null)}
          title={notificationDestinationNotice.status === "opened"
            ? "Bildirim hedefi doğrulandı"
            : notificationDestinationNotice.status === "temporarily_unavailable"
              ? "Bildirim hedefi şu anda doğrulanamıyor"
              : "Bildirim hedefi artık kullanılamıyor"}
          tone={notificationDestinationNotice.status === "opened" ? "success" : "warning"}
        />
      ) : null}
    </>
  );
  const summerSchoolScreen = session ? (
    <SummerSchoolScreen
      announcements={summerSchoolAnnouncements}
      calendarAttempted={Boolean(calendar.attempted)}
      calendarError={calendar.error}
      calendarLoading={calendar.loading}
      calendarStale={calendar.stale}
      contentAttempted={Boolean(summerSchool.attempted)}
      contentError={summerSchool.error}
      contentLoading={summerSchool.loading}
      contentStale={summerSchool.stale}
      contentState={summerSchool.data?.contentState}
      events={summerSchoolEvents}
      feedback={announcementDestinationFeedback}
      onOpenAnnouncement={(item) => {
        const detailItem = contentFeedDetailItem(item, "summer-school");
        if (!detailItem) {
          setMessage({ text: "Bu içerik güvenilir ayrıntı sınırında doğrulanamadı.", tone: "error" });
          return;
        }
        openContentFeedItem(detailItem);
      }}
      onOpenOfficialSource={(url) => openAnnouncement(url)}
      onRefresh={() => void refreshSummerSchool()}
      refreshDisabled={busy}
      requirements={summerSchool.data?.requirements ?? []}
      sameDepartmentOptions={summerSchool.data?.sameDepartmentOptions ?? []}
      universityName={selectedUniversity?.name}
      universitySelected={Boolean(registerUniversityId)}
    />
  ) : null;
  const yokAnnouncementsScreen = session ? (
    <YokAnnouncementsScreen
      attempted={Boolean(yokAnnouncements.attempted)}
      collectionState={yokAnnouncements.data?.state}
      error={yokAnnouncements.error}
      feedback={announcementDestinationFeedback}
      items={yokAnnouncementItems}
      loading={yokAnnouncements.loading}
      onOpenItem={(item) => {
        const detailItem = contentFeedDetailItem(item, "yok");
        if (!detailItem) {
          setMessage({ text: "Bu içerik güvenilir ayrıntı sınırında doğrulanamadı.", tone: "error" });
          return;
        }
        openContentFeedItem(detailItem);
      }}
      onRefresh={() => void refreshContentFeed()}
      refreshDisabled={busy}
      stale={yokAnnouncements.stale}
    />
  ) : null;

  const calendarRouteFeedback = (
    (controlledActiveRoute === "Calendar" || controlledActiveRoute === "CalendarEventDetail") && message ? (
      <Banner
        dismissAccessibilityLabel="Takvim işlem mesajını kapat"
        message={message.text}
        onDismiss={() => setMessage(null)}
        title={message.tone === "error"
          ? "İşlem tamamlanamadı"
          : message.tone === "success"
            ? "İşlem tamamlandı"
            : "Bilgi"}
        tone={message.tone}
      />
    ) : null
  );

  const calendarExperience = session ? (
    <CalendarExperience
      academicEvents={selectUniversityAcademicCalendarEvents(calendar.data?.events ?? [])}
      personalExams={homeManualExams}
      personalExamsReady={manualExamsHydrated && manualExamOwnerId === session.user.id}
      calendarTitle={calendar.data?.calendar.title}
      academicYear={calendar.data?.calendar.academicYear}
      universityName={selectedUniversity?.name}
      loading={calendar.loading}
      attempted={Boolean(calendar.attempted)}
      error={calendar.error}
      stale={calendar.stale}
      partial={calendar.data?.sourceStatus === "source_only"}
      google={{
        state: googleCalendarState,
        stateLabel: googleCalendarLifecycleLabel(googleCalendarState),
        accountEmail: googleCalendarIntegration?.accountEmail,
        verifiedCount: googleCalendarIntegration
          ? googleCalendarLastResult?.verified ?? googleCalendarIntegration.mappings.length
          : undefined,
        lastSyncedLabel: googleCalendarIntegration?.lastSyncedAt
          ? `Son eşitleme: ${formatDateTimeShort(googleCalendarIntegration.lastSyncedAt)}`
          : undefined,
        error: googleCalendarError ?? undefined,
        warnings: googleCalendarWarnings,
        busy: googleCalendarBusy,
        connected: googleCalendarLive
      }}
      feedback={calendarRouteFeedback}
      onRefresh={() => void loadMyCalendar()}
      onOpenItem={openCalendarItem}
      onCreatePersonalExam={createPersonalExam}
      onUpdatePersonalExam={updatePersonalExam}
      onSyncGoogle={() => void syncGoogleCalendar(!googleCalendarIntegration)}
      onManageGoogle={() => requestAppRoute("GoogleCalendarSettings")}
    />
  ) : null;

  const routeBoundAnnouncementDetail = activeTrustedDetail?.type === "announcement"
    && (!announcementDetailLoad || activeTrustedDetail.id === announcementDetailLoad.id)
    ? activeTrustedDetail
    : null;
  const announcementDetail = (
    <AnnouncementDetail
      item={routeBoundAnnouncementDetail?.item ?? null}
      loading={Boolean(announcementDetailLoad?.loading)}
      error={announcementDetailLoad?.error}
      onRetry={announcementDetailLoad?.error
        ? () => loadProtectedAnnouncementDetail(announcementDetailLoad.id)
        : undefined}
      onOpenOfficialSource={openAnnouncement}
      onOpenNotificationSettings={() => requestAppRoute("NotificationSettings")}
      onToggleSaved={() => routeBoundAnnouncementDetail
        ? toggleAnnouncementSaved(routeBoundAnnouncementDetail.id)
        : Promise.resolve()}
      saved={Boolean(
        routeBoundAnnouncementDetail
        && announcementSaveStatus?.id === routeBoundAnnouncementDetail.id
        && announcementSaveStatus.saved
      )}
      saveError={routeBoundAnnouncementDetail && announcementSaveStatus?.id === routeBoundAnnouncementDetail.id
        ? announcementSaveStatus.error
        : undefined}
      saveLoading={Boolean(
        routeBoundAnnouncementDetail
        && announcementSaveStatus?.id === routeBoundAnnouncementDetail.id
        && (announcementSaveStatus.loading || announcementSaveStatus.mutating)
      )}
    />
  );
  const calendarTrustedDetail = (
    <CalendarEventDetail
      item={activeCalendarDetail}
      feedback={calendarRouteFeedback}
      academicYear={calendar.data?.calendar.academicYear}
      universityName={selectedUniversity?.name}
      facultyName={selectedFaculty?.name}
      departmentName={selectedDepartment?.name}
      onUpdatePersonalExam={updatePersonalExam}
      onDeletePersonalExam={deletePersonalExam}
    />
  );

  const unknownRoute = (
    <UnknownRouteState
      authenticated={Boolean(session)}
      onReturn={() => requestAppRoute(session ? "Home" : "Login")}
    />
  );

  const profileCleanupCanRetry = Boolean(cleanupIssue?.failedTargets.some(
    (target) => target !== "server_session"
      && target !== "server_account"
      && (target !== "device_registration" || Boolean(session))
  ));
  const profileCleanupIssue = cleanupIssue ? (
    <Banner
      actionLabel={profileCleanupCanRetry && !busy && !googleBusy ? "Temizliği tekrar dene" : undefined}
      message={cleanupIssue.failedTargets.map(cleanupTargetLabel).join(", ")}
      onAction={profileCleanupCanRetry && !busy && !googleBusy ? () => void retryFailedCleanup() : undefined}
      title="Tamamlanamayan güvenli temizlik"
      tone="warning"
    />
  ) : null;
  const profileRouteFeedback = (
    <>
      {controlledActiveRoute === "Profile" && message && !cleanupIssue ? (
        <Banner
          message={message.text}
          title={message.tone === "error"
            ? "İşlem tamamlanamadı"
            : message.tone === "success"
              ? "İşlem tamamlandı"
              : "Bilgi"}
          tone={message.tone}
        />
      ) : null}
      {controlledActiveRoute === "Profile" ? profileCleanupIssue : null}
    </>
  );
  const academicScreenSaveState = academicProfileSaveState === "idle" && academicProfileDirty
    ? "dirty" as const
    : academicProfileSaveState;
  const recentAuthenticationPanel = recentAuthAction ? (
    <RecentAuthenticationPanel
      action={recentAuthAction}
      busy={recentAuthBusy}
      error={recentAuthError}
      methods={availableRecentAuthMethods}
      onCancel={dismissRecentAuthentication}
      onPasswordChange={(value) => {
        setRecentAuthPassword(value);
        setRecentAuthError(undefined);
      }}
      onSubmitGoogle={() => void submitRecentAuthentication("google")}
      onSubmitPassword={() => void submitRecentAuthentication("password")}
      password={recentAuthPassword}
    />
  ) : undefined;
  const profileOverviewScreen = session ? (
    <>
      {profileRouteFeedback}
      <ProfileOverviewScreen
        academicSummary={academicProfileSummary}
        appVersion={NATIVE_APP_VERSION}
        buildNumber={Platform.OS === "android"
          ? NATIVE_ANDROID_BUILD_NUMBER
          : Platform.OS === "ios"
            ? "Belirtilmedi"
            : `${NATIVE_ANDROID_BUILD_NUMBER} (Android)`}
        email={email}
        error={academicProfileSummary.nameResolutionPending ? universities.error : undefined}
        fullName={fullName}
        googleAccountEmail={googleCalendarIntegration?.accountEmail}
        googleCalendar={googleCalendarPresentation}
        loading={false}
        notificationTruth={notificationTruth}
        onOpenAcademicProfile={() => requestAppRoute("AcademicProfileSettings")}
        onOpenAccountManagement={() => {
          setMessage(null);
          requestAppRoute("AccountDataSettings");
        }}
        onOpenGoogleCalendar={() => requestAppRoute("GoogleCalendarSettings")}
        onOpenNotifications={() => requestAppRoute("NotificationSettings")}
        onRetry={() => void loadUniversities()}
      />
    </>
  ) : null;
  const academicProfileSettingsScreen = session ? (
    <>
      <AcademicProfileSettingsScreen
        busy={busy}
        classLevels={academicClassLevelOptions}
        departments={(departments.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
        departmentsError={departments.error}
        departmentsLoading={departments.loading}
        dirty={academicProfileDirty}
        draft={academicOnboardingDraft}
        faculties={(faculties.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
        facultiesError={faculties.error}
        facultiesLoading={faculties.loading}
        onCancel={() => requestAppRoute("Profile")}
        onClassLevelChange={(value) => updateOnboardingDraft(
          selectAcademicClassLevel(academicOnboardingDraft, value)
        )}
        onDepartmentChange={(value) => updateOnboardingDraft(
          selectAcademicDepartment(academicOnboardingDraft, value)
        )}
        onFacultyChange={(value) => updateOnboardingDraft(
          selectAcademicFaculty(academicOnboardingDraft, value)
        )}
        onRetryDepartments={() => void loadDepartmentsForRegistration(registerFacultyId)}
        onRetryFaculties={() => void loadFacultiesForRegistration(registerUniversityId)}
        onRetryUniversities={() => void loadUniversities()}
        onSave={() => void saveAcademicProfileSettings()}
        onUniversityChange={(value) => updateOnboardingDraft(
          selectAcademicUniversity(academicOnboardingDraft, value)
        )}
        saveError={academicProfileSaveError}
        saveState={academicScreenSaveState}
        universities={(universities.data ?? []).map((item) => ({
          value: item.id,
          label: item.name,
          supportingText: [item.city, UNIVERSITY_TYPE_LABELS[item.type] ?? item.type].filter(Boolean).join(" · ")
        }))}
        universitiesError={universities.error}
        universitiesLoading={universities.loading}
        universityRequiredError={!academicOnboardingDraft.universityId && academicProfileSaveState === "error"
          ? "Üniversite seçimi zorunludur."
          : undefined}
      />
    </>
  ) : null;
  const notificationSettingsScreen = session ? (
    <>
      <NotificationSettingsScreen
        categories={availableCategories.map((category) => ({
          key: category,
          label: toCategoryLabel(category),
          enabled: categoryDraft[category] !== false
        }))}
        dirty={notificationPreferenceDirty}
        error={notificationPreferenceError ?? preferences.error}
        mode={alarmMode}
        onCategoryChange={updateCategory}
        onModeChange={updateAlarmMode}
        onBack={() => requestAppRoute("Profile")}
        onOpenSettings={() => openNotificationSettings()}
        onPreferenceEnabledChange={updateAlarmEnabled}
        onRetry={() => void retryNotificationSettings()}
        onSave={() => void saveAlarmSettings()}
        preferenceEnabled={alarmEnabled}
        quietHoursSummary={preferences.data?.quietHours
          ? preferences.data.quietHours.enabled
            ? `${preferences.data.quietHours.start}–${preferences.data.quietHours.end} · ${preferences.data.quietHours.timezone}`
            : "Kapalı"
          : undefined}
        reminderSummary={preferences.data?.reminderOffsets.length
          ? preferences.data.reminderOffsets
            .map((offset) => offset === 0 ? "aynı gün" : `${offset} gün önce`)
            .join(", ")
          : undefined}
        saveState={notificationPreferenceSaveState}
        truth={notificationTruth}
      />
    </>
  ) : null;
  const googleCalendarSettingsScreen = session ? (
    <>
      <GoogleCalendarSettingsScreen
        accountEmail={googleCalendarIntegration?.accountEmail}
        connectionExists={Boolean(googleCalendarIntegration)}
        error={googleCalendarError ?? undefined}
        lastSyncedLabel={googleCalendarIntegration?.lastSyncedAt
          ? formatDateTimeShort(googleCalendarIntegration.lastSyncedAt)
          : undefined}
        managedEventCount={googleCalendarIntegration?.mappings.length ?? googleCalendarLastResult?.verified}
        mappingWarning={googleCalendarIntegration
          && findDuplicateGoogleCalendarMappings(googleCalendarIntegration.mappings).hasDuplicates
          ? "Yönetilen kayıt eşlemelerinde yinelenen kimlikler bulundu; silme işlemi doğrulanmadan uygulanmaz."
          : undefined}
        onConnect={() => syncGoogleCalendar(true)}
        onDisconnect={async () => {
          await disconnectGoogleCalendar({ removeManagedEvents: false, revokeAccess: false });
        }}
        onRemoveManagedEvents={async () => {
          await disconnectGoogleCalendar({ removeManagedEvents: true, revokeAccess: false });
        }}
        onRevokeAccess={async () => {
          await disconnectGoogleCalendar({ removeManagedEvents: false, revokeAccess: true });
        }}
        onSwitchAccount={promptGoogleCalendarAccountSwitch}
        onSync={() => syncGoogleCalendar(false)}
        operationBusy={googleCalendarBusy}
        presentation={googleCalendarPresentation}
        warnings={googleCalendarWarnings}
      />
    </>
  ) : null;
  const accountDataSettingsScreen = session ? (
    <>
      {controlledActiveRoute === "AccountDataSettings" ? profileCleanupIssue : null}
      <AccountDataSettingsScreen
        busy={busy || recentAuthBusy}
        email={email}
        feedback={controlledActiveRoute === "AccountDataSettings" ? message ?? undefined : undefined}
        onDeleteAccount={() => beginRecentAuthentication("account")}
        onDeleteData={() => beginRecentAuthentication("data")}
        onLogout={() => handleLogout()}
        recentAuthentication={recentAuthenticationPanel}
        recentAuthenticationReturnFocus={recentAuthReturnFocus}
      />
    </>
  ) : null;

  async function completePreloginWelcome(): Promise<void> {
    if (preloginWelcomeGate === "saving") return;
    setPreloginWelcomeGate("saving");
    try {
      await setStoredValue(
        PRELOGIN_WELCOME_COMPLETION_STORAGE_KEY,
        PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE,
      );
    } catch {
      // Continue in memory; the next successful session restore repairs the
      // installation flag without exposing a low-level storage error.
    } finally {
      // A transient storage failure must never trap someone on the welcome
      // screen. Persistence is retried on a later successful session restore.
      setPreloginWelcomeGate("completed");
      setAuthMode("login");
      setAuthStage("auth");
      setActiveRoute("Login");
    }
  }

  const routeLeaveGuard: AppRouteLeaveGuard | null =
    academicProfileDirty
      ? {
          route: "AcademicProfileSettings",
          enabled: academicProfileSaveState !== "saving",
          title: "Kaydedilmemiş akademik bilgiler",
          message: "Değişikliklerin kaydedilmedi. Bu sayfadan ayrılırsan değişiklikler silinir.",
          discardLabel: "Değişiklikleri Sil",
          onDiscard: discardAcademicProfileChanges
        }
      : notificationPreferenceDirty
        ? {
            route: "NotificationSettings",
            enabled: notificationPreferenceOutcome !== "saving",
            title: "Kaydedilmemiş bildirim tercihleri",
            message: "Bildirim değişikliklerin kaydedilmedi. Bu sayfadan ayrılmak istiyor musun?",
            discardLabel: "Değişiklikleri Sil",
            onDiscard: discardNotificationPreferenceChanges
          }
        : null;

  const screens: AppScreenSlots = {
    BootstrapLoading: bootstrapLoading,
    BootstrapError: bootstrapError,
    Introduction: (
      <PreLoginWelcomeScreen
        busy={preloginWelcomeGate === "saving"}
        onContinue={() => void completePreloginWelcome()}
      />
    ),
    Login: renderRoutedScreen("Login"),
    Register: renderRoutedScreen("Register"),
    Verification: renderRoutedScreen("Verification"),
    PasswordRecoveryRequest: renderRoutedScreen("PasswordRecoveryRequest"),
    PasswordRecoveryCode: renderRoutedScreen("PasswordRecoveryCode"),
    PasswordRecoveryConfirm: renderRoutedScreen("PasswordRecoveryConfirm"),
    AcademicOnboarding: renderRoutedScreen("AcademicOnboarding"),
    Home: homeDailyBrief,
    Announcements: announcementsContentFeed,
    SummerSchool: summerSchoolScreen,
    YokAnnouncements: yokAnnouncementsScreen,
    AnnouncementDetail: announcementDetail,
    Calendar: calendarExperience,
    CalendarEventDetail: calendarTrustedDetail,
    Profile: profileOverviewScreen,
    AcademicProfileSettings: academicProfileSettingsScreen,
    NotificationSettings: notificationSettingsScreen,
    GoogleCalendarSettings: googleCalendarSettingsScreen,
    AccountDataSettings: accountDataSettingsScreen,
    UnknownRoute: unknownRoute
  };

  return (
    <SafeAreaProvider>
      <ThemeProvider preference="light">
        <RoutedStatusBar />
        <AppNavigator
          rootSurface={navigatorRootSurface}
          activeRoute={controlledActiveRoute}
          screens={screens}
          navigationLocked={
            busy
            || googleBusy
            || googleCalendarBusy
            || academicProfileSaveState === "saving"
          }
          routeLeaveGuard={routeLeaveGuard}
          request={navigationRequest}
          onRequestHandled={handleNavigationRequestHandled}
          onVisibleRouteChange={handleVisibleRouteChange}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RoutedStatusBar() {
  return (
    <StatusBar
      style="dark"
      translucent
    />
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const showPhase10ProfilePreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE10_PROFILE_PREVIEW === "1";
  const showPhase9CalendarPreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE9_CALENDAR_PREVIEW === "1";
  const showPhase8ContentFeedPreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW === "1";
  const showPhase7HomePreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE7_HOME_PREVIEW === "1";
  const showPhase6AuthPreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE6_AUTH_PREVIEW === "1";
  const showPhase5AppShellPreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE5_APP_SHELL_PREVIEW === "1";
  const showPhase4DesignPreview = __DEV__
    && process.env.EXPO_PUBLIC_PHASE4_DESIGN_PREVIEW === "1";

  if (!fontsLoaded && !fontError) {
    return null;
  }

  if (showPhase10ProfilePreview) {
    const previewTheme = process.env.EXPO_PUBLIC_PHASE10_PROFILE_PREVIEW_THEME === "dark"
      ? "dark"
      : "light";
    return (
      <ProfileSettingsPreview
        preference={previewTheme}
        scenario={process.env.EXPO_PUBLIC_PHASE10_PROFILE_PREVIEW_SCENARIO as ProfileSettingsPreviewScenario | undefined}
      />
    );
  }

  if (showPhase9CalendarPreview) {
    const previewTheme = process.env.EXPO_PUBLIC_PHASE9_CALENDAR_PREVIEW_THEME === "dark"
      ? "dark"
      : "light";
    return (
      <CalendarPreview
        preference={previewTheme}
        scenario={process.env.EXPO_PUBLIC_PHASE9_CALENDAR_PREVIEW_SCENARIO as CalendarPreviewScenario | undefined}
      />
    );
  }

  if (showPhase8ContentFeedPreview) {
    const previewTheme = process.env.EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW_THEME === "dark"
      ? "dark"
      : "light";
    return (
      <ContentFeedPreview
        preference={previewTheme}
        scenario={process.env.EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW_SCENARIO as ContentFeedPreviewScenario | undefined}
      />
    );
  }

  if (showPhase7HomePreview) {
    const previewTheme = process.env.EXPO_PUBLIC_PHASE7_HOME_PREVIEW_THEME === "dark"
      ? "dark"
      : "light";
    return (
      <HomeDailyBriefPreview
        preference={previewTheme}
        scenario={process.env.EXPO_PUBLIC_PHASE7_HOME_PREVIEW_SCENARIO as HomeDailyBriefPreviewScenario | undefined}
      />
    );
  }

  if (showPhase6AuthPreview) {
    const previewTheme = process.env.EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_THEME === "dark"
      ? "dark"
      : "light";
    const previewScenario = process.env.EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_SCENARIO as AuthOnboardingPreviewScenario | undefined;
    return (
      <AuthOnboardingPreview
        initialScenario={previewScenario}
        preference={previewTheme}
        showScenarioControls={!previewScenario}
      />
    );
  }

  if (showPhase5AppShellPreview) {
    const previewTheme = process.env.EXPO_PUBLIC_PHASE5_APP_SHELL_PREVIEW_THEME === "dark"
      ? "dark"
      : process.env.EXPO_PUBLIC_PHASE5_APP_SHELL_PREVIEW_THEME === "light"
        ? "light"
        : "system";

    return (
      <SafeAreaProvider>
        <ThemeProvider preference={previewTheme}>
          <StatusBar
            style={previewTheme === "dark" ? "light" : previewTheme === "light" ? "dark" : "auto"}
          />
          <AppShellPreview />
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  if (showPhase4DesignPreview) {
    return (
      <SafeAreaProvider>
        <ThemeProvider preference="light">
          <StatusBar style="dark" />
          <DesignSystemPreview />
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  return <MainApplication />;
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
  settingsRouteList: {
    borderRadius: 14,
    gap: 1,
    overflow: "hidden"
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
