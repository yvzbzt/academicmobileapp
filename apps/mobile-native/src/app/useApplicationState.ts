import { useRef, useState, useMemo, useEffect } from "react";
import { Platform } from "react-native";
import { runtimeDiagnostic } from "../performance/runtime-diagnostics";
import { useAppRouteRequest } from "../navigation/useAppRouteRequest";
import { RouteIntentCoordinator } from "../navigation";
import { type GoogleCalendarSyncResult } from "../google-calendar/google-calendar-sync";
import {
  type GoogleCalendarConnectionRecordV3,
  type GoogleCalendarLifecycleState,
  GoogleCalendarLifecycleGuard,
} from "../google-calendar/google-calendar-lifecycle";
import {
  type NotificationLifecycleState,
  NotificationLifecycleCoordinator,
  FirebaseNotificationTapAdapter,
  createPendingNotificationDestinationRecord,
} from "../notifications";
import {
  type PendingVerificationRecord,
  type PendingPasswordRecoveryRecord,
  type HydrationStatus,
} from "../auth/auth-recovery";
import {
  type AccountGenerationSnapshot,
  type AccountCleanupTarget,
  AccountGenerationGuard,
} from "../auth/session-integrity";
import { type PreloginWelcomeGate } from "../auth/prelogin-welcome";
import { type AccountAuthProvider, type DestructiveAccountAction } from "../auth/recent-authentication";
import {
  type AcademicClassLevel,
  type AcademicOnboardingDraft,
  EMPTY_ACADEMIC_ONBOARDING_DRAFT,
} from "../auth/auth-ui";
import { type FollowedUniversityRecord } from "../profile/FollowedUniversitiesSettings";
import { type TrustedContentCollection } from "../content/content-trust";
import { type CalendarItem } from "../calendar/calendar-model";
import { type PersonalExamRuntimeState } from "../calendar/personal-exam-runtime";
import {
  NativeCalendarService,
  createExpoCalendarAdapter,
  createSecureNativeCalendarStorage,
  type NativeCalendarStoredState,
  type NativeCalendarPermissionState,
  type NativeCalendarSyncResult,
} from "../native-calendar";
import {
  type ContentFeedItem,
  CONTENT_FEED_INITIAL_LIMIT,
  createContentFeedRequestCoordinator,
} from "../announcements/feed-model";
import {
  type AuthMode,
  type AuthStage,
  type TabId,
  type PendingDeepLinkRoute,
  type SessionPayload,
  type Loadable,
  type UniversityRecord,
  type FacultyRecord,
  type DepartmentRecord,
  type CalendarPayload,
  type DepartmentSchedulePayload,
  type EventRecord,
  type SummerSchoolPayload,
  type NotificationPreferencePayload,
  type AlarmMode,
  type AcademicSelectionLevel,
  type AppleCalendarLifecycleState,
  type NotificationDestinationNotice,
} from "./app-types";
import { resolveApiBaseUrl } from "./app-config";

export function useApplicationState() {
  const renderDiagnosticStartedAt = Date.now();

  const renderDiagnosticSequenceRef = useRef(0);

  const renderDiagnosticId = ++renderDiagnosticSequenceRef.current;

  const [authMode, setAuthMode] = useState<AuthMode>("login");

  const [authStage, setAuthStage] = useState<AuthStage>("auth");

  const [preloginWelcomeGate, setPreloginWelcomeGate] = useState<
    PreloginWelcomeGate | "loading" | "saving"
  >("loading");

  const [activeTab, setActiveTab] = useState<TabId>("home");

  const calendarCreateRequestSequenceRef = useRef(0);

  const [calendarCreateIntent, setCalendarCreateIntent] = useState<{
    key: number;
    ownerId: string;
  } | null>(null);

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

  const nativeCalendarService = useMemo(() => new NativeCalendarService(
    createExpoCalendarAdapter(),
    createSecureNativeCalendarStorage(),
  ), []);

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

  const [courseSchedule, setCourseSchedule] = useState<Loadable<DepartmentSchedulePayload>>({ loading: false });

  const [upcoming, setUpcoming] = useState<Loadable<EventRecord[]>>({ loading: false });

  const [announcements, setAnnouncements] = useState<Loadable<TrustedContentCollection>>({ loading: false });

  const [yokAnnouncements, setYokAnnouncements] = useState<Loadable<TrustedContentCollection>>({ loading: false });

  const [summerSchool, setSummerSchool] = useState<Loadable<SummerSchoolPayload>>({ loading: false });

  const [preferences, setPreferences] = useState<Loadable<NotificationPreferencePayload>>({ loading: false });

  const [followedUniversities, setFollowedUniversities] = useState<Loadable<FollowedUniversityRecord[]>>({ loading: false });

  const [followedUniversityBusyId, setFollowedUniversityBusyId] = useState<string | undefined>();

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

  const alarmEnabledRef = useRef(false);

  const alarmModeRef = useRef<AlarmMode>("all_calendar");

  const categoryDraftRef = useRef<Record<string, boolean>>({});

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

  const [appleBusy, setAppleBusy] = useState(false);

  const [appleAvailable, setAppleAvailable] = useState(false);

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

  const [appleCalendarState, setAppleCalendarState] = useState<AppleCalendarLifecycleState>(
    Platform.OS === "ios" ? "disconnected" : "unavailable",
  );

  const [appleCalendarStoredState, setAppleCalendarStoredState] = useState<NativeCalendarStoredState>({ mappings: {} });

  const [appleCalendarPermission, setAppleCalendarPermission] = useState<NativeCalendarPermissionState>({
    status: Platform.OS === "ios" ? "not_determined" : "unavailable",
    granted: false,
    canAskAgain: Platform.OS === "ios",
  });

  const [appleCalendarLastResult, setAppleCalendarLastResult] = useState<NativeCalendarSyncResult | null>(null);

  const [appleCalendarWarnings, setAppleCalendarWarnings] = useState<string[]>([]);

  const [appleCalendarError, setAppleCalendarError] = useState<string | null>(null);

  const [appleCalendarBusy, setAppleCalendarBusy] = useState(false);

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

  const [accountDrawerVisible, setAccountDrawerVisible] = useState(false);

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

  const appleCalendarOperationRef = useRef(false);

  const appleCalendarNativeMutationRef = useRef<Promise<void> | null>(null);

  const notificationCoordinatorRef = useRef<NotificationLifecycleCoordinator | null>(null);

  const notificationCoordinatorOwnerTokenRef = useRef<SessionPayload | null>(null);

  const notificationUnsubscribeRef = useRef<(() => void) | null>(null);

  const notificationRotationUnsubscribeRef = useRef<(() => void) | null>(null);

  const notificationForegroundUnsubscribeRef = useRef<(() => void) | null>(null);

  const notificationTapAdapterRef = useRef<FirebaseNotificationTapAdapter | null>(null);

  const notificationFailClosedPromiseRef = useRef<Promise<void> | null>(null);

  const notificationReconcilePromiseRef = useRef<{
    ownerId: string;
    operation: Promise<void>;
  } | null>(null);

  const notificationNavigationRequestRef = useRef<{
    requestKey: string;
    record: ReturnType<typeof createPendingNotificationDestinationRecord>;
    ownerSnapshot: AccountGenerationSnapshot;
  } | null>(null);

  const accountCleanupInProgressRef = useRef(false);

  const authOperationInProgressRef = useRef(false);

  const activationAttemptRef = useRef(0);

  const hydrationInProgressRef = useRef(false);

  useEffect(() => {
    runtimeDiagnostic("render.commit", {
      id: renderDiagnosticId,
      activeTab,
      elapsedMs: Date.now() - renderDiagnosticStartedAt,
    });
  });

  return {
    renderDiagnosticStartedAt,
    renderDiagnosticSequenceRef,
    renderDiagnosticId,
    authMode,
    setAuthMode,
    authStage,
    setAuthStage,
    preloginWelcomeGate,
    setPreloginWelcomeGate,
    activeTab,
    setActiveTab,
    calendarCreateRequestSequenceRef,
    calendarCreateIntent,
    setCalendarCreateIntent,
    acknowledgeNavigationRequest,
    activeRoute,
    clearNavigationRequest,
    navigationRequest,
    requestAppRoute,
    setActiveRoute,
    pendingDeepLinkRouteRef,
    apiBaseUrl,
    nativeCalendarService,
    fullName,
    setFullName,
    email,
    setEmail,
    password,
    setPassword,
    registrationPasswordConfirmation,
    setRegistrationPasswordConfirmation,
    passwordVisible,
    setPasswordVisible,
    verificationToken,
    setVerificationToken,
    pendingVerification,
    setPendingVerification,
    verificationClockMs,
    setVerificationClockMs,
    passwordRecoveryCode,
    setPasswordRecoveryCode,
    newPassword,
    setNewPassword,
    passwordConfirmation,
    setPasswordConfirmation,
    newPasswordVisible,
    setNewPasswordVisible,
    passwordConfirmationVisible,
    setPasswordConfirmationVisible,
    pendingPasswordRecovery,
    setPendingPasswordRecovery,
    passwordRecoveryClockMs,
    setPasswordRecoveryClockMs,
    passwordRecoveryFeedback,
    setPasswordRecoveryFeedback,
    hydrationStatus,
    setHydrationStatus,
    hydrationStatusRef,
    hydrationError,
    setHydrationError,
    authenticatedContextPending,
    setAuthenticatedContextPending,
    registerUniversityId,
    setRegisterUniversityId,
    registerFacultyId,
    setRegisterFacultyId,
    registerDepartmentId,
    setRegisterDepartmentId,
    registerClassLevel,
    setRegisterClassLevel,
    onboardingInitialDraft,
    setOnboardingInitialDraft,
    registerPicker,
    setRegisterPicker,
    universitySearch,
    setUniversitySearch,
    facultySearch,
    setFacultySearch,
    departmentSearch,
    setDepartmentSearch,
    session,
    setSession,
    sessionOwner,
    setSessionOwner,
    deviceId,
    setDeviceId,
    universities,
    setUniversities,
    faculties,
    setFaculties,
    departments,
    setDepartments,
    calendar,
    setCalendar,
    courseSchedule,
    setCourseSchedule,
    upcoming,
    setUpcoming,
    announcements,
    setAnnouncements,
    yokAnnouncements,
    setYokAnnouncements,
    summerSchool,
    setSummerSchool,
    preferences,
    setPreferences,
    followedUniversities,
    setFollowedUniversities,
    followedUniversityBusyId,
    setFollowedUniversityBusyId,
    manualExamState,
    setManualExamState,
    manualExams,
    manualExamOwnerId,
    manualExamsHydrated,
    selectedUniversityId,
    setSelectedUniversityId,
    alarmEnabled,
    setAlarmEnabled,
    alarmMode,
    setAlarmMode,
    categoryDraft,
    setCategoryDraft,
    alarmEnabledRef,
    alarmModeRef,
    categoryDraftRef,
    academicProfileSaveState,
    setAcademicProfileSaveState,
    academicProfileSaveError,
    setAcademicProfileSaveError,
    notificationPreferenceOutcome,
    setNotificationPreferenceOutcome,
    notificationPreferenceError,
    setNotificationPreferenceError,
    busy,
    setBusy,
    academicSelectionPending,
    setAcademicSelectionPending,
    googleBusy,
    setGoogleBusy,
    appleBusy,
    setAppleBusy,
    appleAvailable,
    setAppleAvailable,
    accountAuthProvider,
    setAccountAuthProvider,
    recentAuthAction,
    setRecentAuthAction,
    recentAuthReturnFocus,
    setRecentAuthReturnFocus,
    recentAuthReturnFocusRequestRef,
    recentAuthPassword,
    setRecentAuthPassword,
    recentAuthBusy,
    setRecentAuthBusy,
    recentAuthError,
    setRecentAuthError,
    message,
    setMessage,
    googleCalendarBusy,
    setGoogleCalendarBusy,
    googleCalendarIntegration,
    setGoogleCalendarIntegration,
    googleCalendarState,
    setGoogleCalendarState,
    googleCalendarLastResult,
    setGoogleCalendarLastResult,
    googleCalendarWarnings,
    setGoogleCalendarWarnings,
    googleCalendarError,
    setGoogleCalendarError,
    appleCalendarState,
    setAppleCalendarState,
    appleCalendarStoredState,
    setAppleCalendarStoredState,
    appleCalendarPermission,
    setAppleCalendarPermission,
    appleCalendarLastResult,
    setAppleCalendarLastResult,
    appleCalendarWarnings,
    setAppleCalendarWarnings,
    appleCalendarError,
    setAppleCalendarError,
    appleCalendarBusy,
    setAppleCalendarBusy,
    notificationLifecycle,
    setNotificationLifecycle,
    notificationDestinationNotice,
    setNotificationDestinationNotice,
    activeTrustedDetail,
    setActiveTrustedDetail,
    activeCalendarDetail,
    setActiveCalendarDetail,
    announcementDetailLoad,
    setAnnouncementDetailLoad,
    announcementSaveStatus,
    setAnnouncementSaveStatus,
    academicProfileExpanded,
    setAcademicProfileExpanded,
    accountDrawerVisible,
    setAccountDrawerVisible,
    alarmCategoriesExpanded,
    setAlarmCategoriesExpanded,
    contentFeedLimit,
    setContentFeedLimit,
    contentFeedPagination,
    setContentFeedPagination,
    cleanupIssue,
    setCleanupIssue,
    sessionRef,
    deviceIdRef,
    refreshSessionPromiseRef,
    academicSelectionPendingRef,
    accountGuardRef,
    onboardingOwnerRef,
    onboardingSaveAttemptRef,
    routeIntentCoordinatorRef,
    announcementDetailRequestGenerationRef,
    announcementSaveRequestGenerationRef,
    contentFeedRequestCoordinatorRef,
    contentFeedAbortControllerRef,
    authenticatedRequestControllersRef,
    storageMutationQueueRef,
    googleSdkQueueRef,
    activeAuthenticatedMutationsRef,
    googleSdkEpochRef,
    googleLifecycleGuardRef,
    appleCalendarOperationRef,
    appleCalendarNativeMutationRef,
    notificationCoordinatorRef,
    notificationCoordinatorOwnerTokenRef,
    notificationUnsubscribeRef,
    notificationRotationUnsubscribeRef,
    notificationForegroundUnsubscribeRef,
    notificationTapAdapterRef,
    notificationFailClosedPromiseRef,
    notificationReconcilePromiseRef,
    notificationNavigationRequestRef,
    accountCleanupInProgressRef,
    authOperationInProgressRef,
    activationAttemptRef,
    hydrationInProgressRef
  };
}

export type ApplicationState = ReturnType<typeof useApplicationState>;
