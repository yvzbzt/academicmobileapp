import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  type AppRouteLeaveGuard,
  type AppScreenSlots,
  AppNavigator,
  type AppVisibleRoute,
} from "../navigation/AppNavigator";
import { AccountDrawer } from "../navigation/AccountDrawer";
import { ThemeProvider } from "../design-system";
import { referencePalette } from "../design-system/tokens";
import { PreLoginWelcomeScreen } from "../auth/PreLoginWelcomeScreen";
import { useApplicationState } from "./useApplicationState";
import { usePersonalCalendarRuntime } from "./usePersonalCalendarRuntime";
import { useApplicationDerivedState } from "./useApplicationDerivedState";
import { useApplicationEffects } from "./useApplicationEffects";
import { useHomeContentData } from "./useHomeContentData";
import { createAuthScreens } from "./screens/auth-screens";
import { createContentScreens } from "./screens/content-screens";
import { createProfileScreens } from "./screens/profile-screens";
import { createApplicationActions } from "./createApplicationActions";

export function MainApplication() {
  const state = useApplicationState();
  // Constructors store these callbacks; they do not invoke them before actions are wired.
  const runtime = usePersonalCalendarRuntime({
    enqueueStorageMutation: (...args) => actions.enqueueStorageMutation(...args),
    accountGuardRef: state.accountGuardRef,
    setManualExamState: state.setManualExamState,
    setCleanupIssue: state.setCleanupIssue,
    setMessage: state.setMessage,
  });
  const derived = useApplicationDerivedState({
    session: state.session,
    accountAuthProvider: state.accountAuthProvider,
    appleAvailable: state.appleAvailable,
    calendar: state.calendar,
    preferences: state.preferences,
    manualExamOwnerId: state.manualExamOwnerId,
    manualExamsHydrated: state.manualExamsHydrated,
    manualExams: state.manualExams,
    announcements: state.announcements,
    yokAnnouncements: state.yokAnnouncements,
    courseSchedule: state.courseSchedule,
    summerSchool: state.summerSchool,
    contentFeedLimit: state.contentFeedLimit,
    upcoming: state.upcoming,
    universities: state.universities,
    registerUniversityId: state.registerUniversityId,
    followedUniversities: state.followedUniversities,
    selectedUniversityId: state.selectedUniversityId,
    faculties: state.faculties,
    registerFacultyId: state.registerFacultyId,
    departments: state.departments,
    registerDepartmentId: state.registerDepartmentId,
    universitySearch: state.universitySearch,
    facultySearch: state.facultySearch,
    departmentSearch: state.departmentSearch,
    fullName: state.fullName,
    email: state.email,
    password: state.password,
    registrationPasswordConfirmation: state.registrationPasswordConfirmation,
    registerClassLevel: state.registerClassLevel,
    onboardingInitialDraft: state.onboardingInitialDraft,
    alarmEnabled: state.alarmEnabled,
    alarmMode: state.alarmMode,
    categoryDraft: state.categoryDraft,
    notificationPreferenceOutcome: state.notificationPreferenceOutcome,
    notificationLifecycle: state.notificationLifecycle,
    notificationPreferenceError: state.notificationPreferenceError,
    googleCalendarState: state.googleCalendarState,
    appleCalendarState: state.appleCalendarState,
    pendingVerification: state.pendingVerification,
    verificationClockMs: state.verificationClockMs,
    pendingPasswordRecovery: state.pendingPasswordRecovery,
    passwordRecoveryClockMs: state.passwordRecoveryClockMs,
    passwordRecoveryCode: state.passwordRecoveryCode,
    newPassword: state.newPassword,
    passwordConfirmation: state.passwordConfirmation,
    accountGuardRef: state.accountGuardRef,
    hydrationStatus: state.hydrationStatus,
    sessionOwner: state.sessionOwner,
    authMode: state.authMode,
    authStage: state.authStage,
    preloginWelcomeGate: state.preloginWelcomeGate,
    authenticatedContextPending: state.authenticatedContextPending,
    activeTab: state.activeTab,
    activeRoute: state.activeRoute,
    googleCalendarIntegration: state.googleCalendarIntegration,
  });
  // Preserve the original hook order. Effects run after render, when actions are initialized.
  useApplicationEffects({
    hydrateApplication: (...args) => actions.hydrateApplication(...args),
    message: state.message,
    navigatorRootSurface: derived.navigatorRootSurface,
    setMessage: state.setMessage,
    setActiveRoute: state.setActiveRoute,
    expectedBaseRoute: derived.expectedBaseRoute,
    activeTab: state.activeTab,
    authMode: state.authMode,
    authStage: state.authStage,
    pendingVerification: state.pendingVerification,
    setVerificationClockMs: state.setVerificationClockMs,
    pendingPasswordRecovery: state.pendingPasswordRecovery,
    setPasswordRecoveryClockMs: state.setPasswordRecoveryClockMs,
    sessionRef: state.sessionRef,
    session: state.session,
    notificationCoordinatorOwnerTokenRef: state.notificationCoordinatorOwnerTokenRef,
    hydrationStatusRef: state.hydrationStatusRef,
    hydrationStatus: state.hydrationStatus,
    notificationUnsubscribeRef: state.notificationUnsubscribeRef,
    notificationRotationUnsubscribeRef: state.notificationRotationUnsubscribeRef,
    notificationForegroundUnsubscribeRef: state.notificationForegroundUnsubscribeRef,
    notificationCoordinatorRef: state.notificationCoordinatorRef,
    notificationTapAdapterRef: state.notificationTapAdapterRef,
    receiveNotificationDestination: (...args) => actions.receiveNotificationDestination(...args),
    receiveAcademicPulseUrl: (...args) => actions.receiveAcademicPulseUrl(...args),
    notificationNavigationRequestRef: state.notificationNavigationRequestRef,
    pendingDeepLinkRouteRef: state.pendingDeepLinkRouteRef,
    resumePendingDeepLinkIfEligible: (...args) => actions.resumePendingDeepLinkIfEligible(...args),
    authenticatedContextPending: state.authenticatedContextPending,
    busy: state.busy,
    accountGuardRef: state.accountGuardRef,
    accountCleanupInProgressRef: state.accountCleanupInProgressRef,
    appleCalendarOperationRef: state.appleCalendarOperationRef,
    restoreAppleCalendarConnection: (...args) => actions.restoreAppleCalendarConnection(...args),
    setAppleCalendarState: state.setAppleCalendarState,
    setAppleCalendarError: state.setAppleCalendarError,
    reconcileNotificationDelivery: (...args) => actions.reconcileNotificationDelivery(...args),
    setAlarmEnabled: state.setAlarmEnabled,
    setCleanupIssue: state.setCleanupIssue,
    setAppleAvailable: state.setAppleAvailable,
    alarmEnabledRef: state.alarmEnabledRef,
    alarmEnabled: state.alarmEnabled,
    alarmModeRef: state.alarmModeRef,
    alarmMode: state.alarmMode,
    categoryDraftRef: state.categoryDraftRef,
    categoryDraft: state.categoryDraft,
    preferences: state.preferences,
    availableCategories: derived.availableCategories,
    setCategoryDraft: state.setCategoryDraft,
    setAlarmMode: state.setAlarmMode,
    setNotificationPreferenceOutcome: state.setNotificationPreferenceOutcome,
    registerUniversityId: state.registerUniversityId,
    loadFacultiesForRegistration: (...args) => actions.loadFacultiesForRegistration(...args),
    registerFacultyId: state.registerFacultyId,
    loadDepartmentsForRegistration: (...args) => actions.loadDepartmentsForRegistration(...args),
    announcements: state.announcements,
    loadAnnouncements: (...args) => actions.loadAnnouncements(...args),
    yokAnnouncements: state.yokAnnouncements,
    summerSchool: state.summerSchool,
    loadYokAnnouncements: (...args) => actions.loadYokAnnouncements(...args),
    contentFeedLimit: state.contentFeedLimit,
    contentFeedLimitRef: state.contentFeedLimitRef,
    loadSummerSchool: (...args) => actions.loadSummerSchool(...args),
    controlledActiveRoute: derived.controlledActiveRoute,
    universities: state.universities,
    loadUniversities: (...args) => actions.loadUniversities(...args),
  });
  const homeData = useHomeContentData({
    calendar: state.calendar,
    courseSchedule: state.courseSchedule,
    selectedUniversity: derived.selectedUniversity,
    upcoming: state.upcoming,
    session: state.session,
    manualExamOwnerId: state.manualExamOwnerId,
    manualExamsHydrated: state.manualExamsHydrated,
    manualExams: state.manualExams,
  });
  const actions = createApplicationActions(state, derived, runtime, homeData);

  const authScreens = createAuthScreens({
    hydrationError: state.hydrationError,
    hydrateApplication: actions.hydrateApplication,
    message: state.message,
    busy: state.busy,
    email: state.email,
    googleBusy: state.googleBusy,
    appleAvailable: state.appleAvailable,
    appleBusy: state.appleBusy,
    setMessage: state.setMessage,
    setEmail: state.setEmail,
    openPasswordRecovery: actions.openPasswordRecovery,
    handleGoogleAuth: actions.handleGoogleAuth,
    handleAppleAuth: actions.handleAppleAuth,
    setPassword: state.setPassword,
    setAuthMode: state.setAuthMode,
    setAuthStage: state.setAuthStage,
    handleAuth: actions.handleAuth,
    openVerificationRecovery: actions.openVerificationRecovery,
    password: state.password,
    fullName: state.fullName,
    setFullName: state.setFullName,
    returnToLoginForm: actions.returnToLoginForm,
    setRegistrationPasswordConfirmation: state.setRegistrationPasswordConfirmation,
    registrationPasswordConfirmation: state.registrationPasswordConfirmation,
    verificationToken: state.verificationToken,
    setVerificationToken: state.setVerificationToken,
    resendVerificationEmail: actions.resendVerificationEmail,
    handleVerifyEmail: actions.handleVerifyEmail,
    verificationTiming: derived.verificationTiming,
    passwordRecoveryFeedback: state.passwordRecoveryFeedback,
    cancelPasswordRecovery: actions.cancelPasswordRecovery,
    setPasswordRecoveryFeedback: state.setPasswordRecoveryFeedback,
    requestPasswordRecovery: actions.requestPasswordRecovery,
    pendingPasswordRecovery: state.pendingPasswordRecovery,
    passwordRecoveryTiming: derived.passwordRecoveryTiming,
    passwordRecoveryCode: state.passwordRecoveryCode,
    returnToPasswordRecoveryRequest: actions.returnToPasswordRecoveryRequest,
    setPasswordRecoveryCode: state.setPasswordRecoveryCode,
    continuePasswordRecoveryCode: actions.continuePasswordRecoveryCode,
    newPassword: state.newPassword,
    returnToPasswordRecoveryCode: actions.returnToPasswordRecoveryCode,
    setNewPassword: state.setNewPassword,
    setPasswordConfirmation: state.setPasswordConfirmation,
    confirmPasswordRecovery: actions.confirmPasswordRecovery,
    passwordConfirmation: state.passwordConfirmation,
    academicClassLevelOptions: derived.academicClassLevelOptions,
    departments: state.departments,
    academicOnboardingDraft: derived.academicOnboardingDraft,
    session: state.session,
    faculties: state.faculties,
    onboardingInitialDraft: state.onboardingInitialDraft,
    handleLogout: actions.handleLogout,
    updateOnboardingDraft: actions.updateOnboardingDraft,
    loadDepartmentsForRegistration: actions.loadDepartmentsForRegistration,
    registerFacultyId: state.registerFacultyId,
    loadFacultiesForRegistration: actions.loadFacultiesForRegistration,
    registerUniversityId: state.registerUniversityId,
    loadUniversities: actions.loadUniversities,
    saveAcademicOnboarding: actions.saveAcademicOnboarding,
    skipAcademicOnboarding: actions.skipAcademicOnboarding,
    universities: state.universities,
    cleanupIssue: state.cleanupIssue,
    retryFailedCleanup: actions.retryFailedCleanup,
  });
  const contentScreens = createContentScreens({
    session: state.session,
    registerUniversityId: state.registerUniversityId,
    selectedUniversity: derived.selectedUniversity,
    selectedFaculty: derived.selectedFaculty,
    selectedDepartment: derived.selectedDepartment,
    homeEvents: homeData.homeEvents,
    homeManualExams: homeData.homeManualExams,
    announcementFeed: derived.announcementFeed,
    calendar: state.calendar,
    upcoming: state.upcoming,
    announcements: state.announcements,
    googleCalendarState: state.googleCalendarState,
    notificationLifecycle: state.notificationLifecycle,
    setAccountDrawerVisible: state.setAccountDrawerVisible,
    requestAppRoute: state.requestAppRoute,
    openTrustedContentRecord: actions.openTrustedContentRecord,
    openHomeImportantItem: actions.openHomeImportantItem,
    calendarCreateRequestSequenceRef: state.calendarCreateRequestSequenceRef,
    setCalendarCreateIntent: state.setCalendarCreateIntent,
    loadMyCalendar: actions.loadMyCalendar,
    loadCourseSchedule: actions.loadCourseSchedule,
    loadUpcoming: actions.loadUpcoming,
    refreshContentFeed: actions.refreshContentFeed,
    yokAnnouncementItems: derived.yokAnnouncementItems,
    summerSchoolAnnouncements: derived.summerSchoolAnnouncements,
    contentFeedLoading: derived.contentFeedLoading,
    contentFeedAttempted: derived.contentFeedAttempted,
    contentFeedHasRetainedData: derived.contentFeedHasRetainedData,
    contentFeedError: derived.contentFeedError,
    contentFeedStale: derived.contentFeedStale,
    contentFeedPartial: derived.contentFeedPartial,
    contentFeedLimit: state.contentFeedLimit,
    contentFeedHasMore: derived.contentFeedHasMore,
    contentFeedPagination: state.contentFeedPagination,
    loadMoreContentFeed: actions.loadMoreContentFeed,
    openContentFeedItem: actions.openContentFeedItem,
    openAnnouncement: actions.openAnnouncement,
    controlledActiveRoute: derived.controlledActiveRoute,
    message: state.message,
    setMessage: state.setMessage,
    notificationDestinationNotice: state.notificationDestinationNotice,
    retryPendingNotificationDestination: actions.retryPendingNotificationDestination,
    setNotificationDestinationNotice: state.setNotificationDestinationNotice,
    summerSchool: state.summerSchool,
    summerSchoolEvents: derived.summerSchoolEvents,
    refreshSummerSchool: actions.refreshSummerSchool,
    busy: state.busy,
    yokAnnouncements: state.yokAnnouncements,
    universityAcademicCalendarEvents: derived.universityAcademicCalendarEvents,
    calendarCreateIntent: state.calendarCreateIntent,
    manualExamsHydrated: state.manualExamsHydrated,
    manualExamOwnerId: state.manualExamOwnerId,
    courseSchedule: state.courseSchedule,
    appleCalendarState: state.appleCalendarState,
    appleCalendarPresentation: derived.appleCalendarPresentation,
    appleCalendarStoredState: state.appleCalendarStoredState,
    appleCalendarError: state.appleCalendarError,
    appleCalendarWarnings: state.appleCalendarWarnings,
    appleCalendarBusy: state.appleCalendarBusy,
    googleCalendarIntegration: state.googleCalendarIntegration,
    googleCalendarLastResult: state.googleCalendarLastResult,
    googleCalendarError: state.googleCalendarError,
    googleCalendarWarnings: state.googleCalendarWarnings,
    googleCalendarBusy: state.googleCalendarBusy,
    googleCalendarLive: derived.googleCalendarLive,
    openCalendarItem: actions.openCalendarItem,
    createPersonalExam: actions.createPersonalExam,
    updatePersonalExam: actions.updatePersonalExam,
    syncAppleCalendar: actions.syncAppleCalendar,
    syncGoogleCalendar: actions.syncGoogleCalendar,
    activeTrustedDetail: state.activeTrustedDetail,
    announcementDetailLoad: state.announcementDetailLoad,
    loadProtectedAnnouncementDetail: actions.loadProtectedAnnouncementDetail,
    toggleAnnouncementSaved: actions.toggleAnnouncementSaved,
    announcementSaveStatus: state.announcementSaveStatus,
    activeCalendarDetail: state.activeCalendarDetail,
    deletePersonalExam: actions.deletePersonalExam,
  });
  const profileScreens = createProfileScreens({
    cleanupIssue: state.cleanupIssue,
    session: state.session,
    busy: state.busy,
    googleBusy: state.googleBusy,
    retryFailedCleanup: actions.retryFailedCleanup,
    controlledActiveRoute: derived.controlledActiveRoute,
    message: state.message,
    academicProfileSaveState: state.academicProfileSaveState,
    academicProfileDirty: derived.academicProfileDirty,
    recentAuthAction: state.recentAuthAction,
    recentAuthBusy: state.recentAuthBusy,
    dismissRecentAuthentication: actions.dismissRecentAuthentication,
    recentAuthError: state.recentAuthError,
    availableRecentAuthMethods: derived.availableRecentAuthMethods,
    setRecentAuthPassword: state.setRecentAuthPassword,
    setRecentAuthError: state.setRecentAuthError,
    submitRecentAuthentication: actions.submitRecentAuthentication,
    recentAuthPassword: state.recentAuthPassword,
    academicProfileSummary: derived.academicProfileSummary,
    email: state.email,
    universities: state.universities,
    fullName: state.fullName,
    additionalFollowedUniversities: derived.additionalFollowedUniversities,
    googleCalendarIntegration: state.googleCalendarIntegration,
    googleCalendarPresentation: derived.googleCalendarPresentation,
    appleCalendarPresentation: derived.appleCalendarPresentation,
    notificationTruth: derived.notificationTruth,
    setAccountDrawerVisible: state.setAccountDrawerVisible,
    requestAppRoute: state.requestAppRoute,
    setMessage: state.setMessage,
    loadUniversities: actions.loadUniversities,
    handleLogout: actions.handleLogout,
    academicClassLevelOptions: derived.academicClassLevelOptions,
    departments: state.departments,
    academicOnboardingDraft: derived.academicOnboardingDraft,
    faculties: state.faculties,
    updateOnboardingDraft: actions.updateOnboardingDraft,
    loadDepartmentsForRegistration: actions.loadDepartmentsForRegistration,
    registerFacultyId: state.registerFacultyId,
    loadFacultiesForRegistration: actions.loadFacultiesForRegistration,
    registerUniversityId: state.registerUniversityId,
    saveAcademicProfileSettings: actions.saveAcademicProfileSettings,
    academicProfileSaveError: state.academicProfileSaveError,
    followedUniversityBusyId: state.followedUniversityBusyId,
    followedUniversities: state.followedUniversities,
    loadFollowedUniversities: actions.loadFollowedUniversities,
    toggleFollowedUniversity: actions.toggleFollowedUniversity,
    selectedUniversityId: state.selectedUniversityId,
    availableCategories: derived.availableCategories,
    categoryDraft: state.categoryDraft,
    notificationPreferenceDirty: derived.notificationPreferenceDirty,
    notificationPreferenceError: state.notificationPreferenceError,
    preferences: state.preferences,
    alarmMode: state.alarmMode,
    updateCategory: actions.updateCategory,
    updateAlarmMode: actions.updateAlarmMode,
    updateAlarmEnabled: actions.updateAlarmEnabled,
    retryNotificationSettings: actions.retryNotificationSettings,
    saveAlarmSettings: actions.saveAlarmSettings,
    alarmEnabled: state.alarmEnabled,
    notificationPreferenceSaveState: derived.notificationPreferenceSaveState,
    appleCalendarStoredState: state.appleCalendarStoredState,
    appleCalendarError: state.appleCalendarError,
    disconnectAppleCalendar: actions.disconnectAppleCalendar,
    syncAppleCalendar: actions.syncAppleCalendar,
    openFirstManagedAppleCalendarEvent: actions.openFirstManagedAppleCalendarEvent,
    nativeCalendarService: state.nativeCalendarService,
    appleCalendarState: state.appleCalendarState,
    appleCalendarPermission: state.appleCalendarPermission,
    appleCalendarWarnings: state.appleCalendarWarnings,
    googleCalendarError: state.googleCalendarError,
    googleCalendarLastResult: state.googleCalendarLastResult,
    syncGoogleCalendar: actions.syncGoogleCalendar,
    disconnectGoogleCalendar: actions.disconnectGoogleCalendar,
    promptGoogleCalendarAccountSwitch: actions.promptGoogleCalendarAccountSwitch,
    googleCalendarBusy: state.googleCalendarBusy,
    googleCalendarWarnings: state.googleCalendarWarnings,
    beginRecentAuthentication: actions.beginRecentAuthentication,
    recentAuthReturnFocus: state.recentAuthReturnFocus,
  });

  const { academicProfileSaveState, notificationPreferenceOutcome, preloginWelcomeGate, busy, googleBusy, googleCalendarBusy, appleCalendarBusy, followedUniversityBusyId, navigationRequest, session, setAccountDrawerVisible, setMessage, requestAppRoute, accountDrawerVisible } = state;
  const { academicProfileDirty, notificationPreferenceDirty, controlledActiveRoute, navigatorRootSurface, selectedUniversity } = derived;
  const { bootstrapLoading, bootstrapError, renderRoutedScreen } = authScreens;
  const { homeDailyBrief, announcementsContentFeed, summerSchoolScreen, yokAnnouncementsScreen, announcementDetail, calendarExperience, calendarTrustedDetail, unknownRoute } = contentScreens;
  const { profileOverviewScreen, academicProfileSettingsScreen, followedUniversitiesSettingsScreen, notificationSettingsScreen, appleCalendarSettingsScreen, googleCalendarSettingsScreen, accountDataSettingsScreen } = profileScreens;
  const { discardAcademicProfileChanges, discardNotificationPreferenceChanges, completePreloginWelcome, handleNavigationRequestHandled, handleVisibleRouteChange, handleLogout } = actions;

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
    FollowedUniversitiesSettings: followedUniversitiesSettingsScreen,
    NotificationSettings: notificationSettingsScreen,
    AppleCalendarSettings: appleCalendarSettingsScreen,
    GoogleCalendarSettings: googleCalendarSettingsScreen,
    AccountDataSettings: accountDataSettingsScreen,
    UnknownRoute: unknownRoute
  };

  return (
    <SafeAreaProvider>
      <ThemeProvider preference="light">
        <RoutedStatusBar activeRoute={controlledActiveRoute} />
        <AppNavigator
          rootSurface={navigatorRootSurface}
          activeRoute={controlledActiveRoute}
          screens={screens}
          navigationLocked={
            busy
            || googleBusy
            || googleCalendarBusy
            || appleCalendarBusy
            || Boolean(followedUniversityBusyId)
            || academicProfileSaveState === "saving"
          }
          routeLeaveGuard={routeLeaveGuard}
          request={navigationRequest}
          onRequestHandled={handleNavigationRequestHandled}
          onVisibleRouteChange={handleVisibleRouteChange}
        />
        {session ? (
          <AccountDrawer
            email={session.user.email}
            fullName={session.user.fullName}
            onClose={() => setAccountDrawerVisible(false)}
            onLogout={() => handleLogout()}
            onOpenAccount={() => {
              setMessage(null);
              requestAppRoute("AccountDataSettings");
            }}
            universityName={selectedUniversity?.name}
            visible={accountDrawerVisible}
          />
        ) : null}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RoutedStatusBar({ activeRoute }: { activeRoute: AppVisibleRoute }) {
  const homeActive = activeRoute === "Home";
  return (
    <StatusBar
      backgroundColor={homeActive ? referencePalette.academicBlueDeep : referencePalette.white}
      style={homeActive ? "light" : "dark"}
      translucent={false}
    />
  );
}
