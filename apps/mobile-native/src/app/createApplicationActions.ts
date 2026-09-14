import type { ApplicationActions } from "./application-actions";
import type { ApplicationState } from "./useApplicationState";
import type { ApplicationDerivedState } from "./useApplicationDerivedState";
import type { PersonalCalendarRuntime } from "./usePersonalCalendarRuntime";
import type { HomeContentData } from "./useHomeContentData";
import { type Dispatch, type SetStateAction } from "react";
import { type AuthOperation, type AccountGenerationSnapshot } from "../auth/session-integrity";
import { type Loadable } from "./app-types";
import { createApiActions } from "./actions/api-actions";
import { createBootstrapActions } from "./actions/bootstrap-actions";
import { createSessionActions } from "./actions/session-actions";
import { createAuthActions } from "./actions/auth-actions";
import { createVerificationActions } from "./actions/verification-actions";
import { createPasswordRecoveryActions } from "./actions/password-recovery-actions";
import { createAccountCleanupActions } from "./actions/account-cleanup-actions";
import { createRecentAuthActions } from "./actions/recent-auth-actions";
import { createCatalogActions } from "./actions/catalog-actions";
import { createContentActions } from "./actions/content-actions";
import { createNotificationActions } from "./actions/notification-actions";
import { createNotificationDestinationActions } from "./actions/notification-destination-actions";
import { createContentNavigationActions } from "./actions/content-navigation-actions";
import { createNavigationActions } from "./actions/navigation-actions";
import { createAppleCalendarActions } from "./actions/apple-calendar-actions";
import { createGoogleCalendarConnectionActions } from "./actions/google-calendar-connection-actions";
import { createGoogleCalendarActions } from "./actions/google-calendar-actions";
import { createPersonalCalendarActions } from "./actions/personal-calendar-actions";

/** Plain, per-render wiring: factories do not invoke cross-domain callbacks during construction. */
export function createApplicationActions(
  state: ApplicationState,
  derived: ApplicationDerivedState,
  runtime: PersonalCalendarRuntime,
  homeData: HomeContentData,
): ApplicationActions {
  const apiActions = createApiActions({
    storageMutationQueueRef: state.storageMutationQueueRef,
    accountCleanupInProgressRef: state.accountCleanupInProgressRef,
    activeAuthenticatedMutationsRef: state.activeAuthenticatedMutationsRef,
    authenticatedRequestControllersRef: state.authenticatedRequestControllersRef,
    sessionRef: state.sessionRef,
    accountGuardRef: state.accountGuardRef,
    deviceIdRef: state.deviceIdRef,
    refreshSessionPromiseRef: state.refreshSessionPromiseRef,
    notificationCoordinatorOwnerTokenRef: state.notificationCoordinatorOwnerTokenRef,
    setAccountAuthProvider: state.setAccountAuthProvider,
    setSession: state.setSession,
    clearExpiredSession: (...args) => sessionActions.clearExpiredSession(...args),
    setMessage: state.setMessage,
    apiBaseUrl: state.apiBaseUrl,
  });

  const bootstrapActions = createBootstrapActions({
    hydrationInProgressRef: state.hydrationInProgressRef,
    setHydrationStatus: state.setHydrationStatus,
    setPreloginWelcomeGate: state.setPreloginWelcomeGate,
    setHydrationError: state.setHydrationError,
    setCleanupIssue: state.setCleanupIssue,
    accountGuardRef: state.accountGuardRef,
    setSessionOwner: state.setSessionOwner,
    googleLifecycleGuardRef: state.googleLifecycleGuardRef,
    sessionRef: state.sessionRef,
    notificationCoordinatorOwnerTokenRef: state.notificationCoordinatorOwnerTokenRef,
    setAccountAuthProvider: state.setAccountAuthProvider,
    setSession: state.setSession,
    setActiveTab: state.setActiveTab,
    setActiveRoute: state.setActiveRoute,
    restoreManualExams: (...args) => personalCalendarActions.restoreManualExams(...args),
    personalExamRuntime: runtime.personalExamRuntime,
    restoreGoogleCalendarConnection: (...args) => googleCalendarConnectionActions.restoreGoogleCalendarConnection(...args),
    setGoogleCalendarIntegration: state.setGoogleCalendarIntegration,
    restoreAppleCalendarConnection: (...args) => appleCalendarActions.restoreAppleCalendarConnection(...args),
    setAppleCalendarStoredState: state.setAppleCalendarStoredState,
    setAppleCalendarState: state.setAppleCalendarState,
    setAppleCalendarError: state.setAppleCalendarError,
    clearPendingVerification: (...args) => sessionActions.clearPendingVerification(...args),
    setPendingVerification: state.setPendingVerification,
    setPassword: state.setPassword,
    setVerificationToken: state.setVerificationToken,
    setAuthMode: state.setAuthMode,
    setAuthStage: state.setAuthStage,
    loadUniversities: (...args) => catalogActions.loadUniversities(...args),
    restorePendingNotificationForSession: (...args) => notificationDestinationActions.restorePendingNotificationForSession(...args),
    abortAuthenticatedRequests: (...args) => apiActions.abortAuthenticatedRequests(...args),
    deviceIdRef: state.deviceIdRef,
    setDeviceId: state.setDeviceId,
    ensureNotificationCoordinator: (...args) => notificationActions.ensureNotificationCoordinator(...args),
    setEmail: state.setEmail,
    loadPreferences: (...args) => notificationActions.loadPreferences(...args),
    notificationCoordinatorRef: state.notificationCoordinatorRef,
    reconcileNotificationDelivery: (...args) => notificationActions.reconcileNotificationDelivery(...args),
    loadMyCalendar: (...args) => contentActions.loadMyCalendar(...args),
    loadCourseSchedule: (...args) => contentActions.loadCourseSchedule(...args),
    loadUpcoming: (...args) => contentActions.loadUpcoming(...args),
    loadFollowedUniversities: (...args) => catalogActions.loadFollowedUniversities(...args),
    apiRequest: <T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    }) => apiActions.apiRequest<T>(path, options, token, requestOptions),
    clearExpiredSession: (...args) => sessionActions.clearExpiredSession(...args),
    setMessage: state.setMessage,
    setFullName: state.setFullName,
    setSelectedUniversityId: state.setSelectedUniversityId,
    setRegisterUniversityId: state.setRegisterUniversityId,
    setRegisterFacultyId: state.setRegisterFacultyId,
    setRegisterDepartmentId: state.setRegisterDepartmentId,
    setRegisterClassLevel: state.setRegisterClassLevel,
    setOnboardingInitialDraft: state.setOnboardingInitialDraft,
    onboardingOwnerRef: state.onboardingOwnerRef,
    setAcademicProfileSaveState: state.setAcademicProfileSaveState,
    setAcademicProfileSaveError: state.setAcademicProfileSaveError,
  });

  const sessionActions = createSessionActions({
    enqueueStorageMutation: <T>(action: () => Promise<T>) => apiActions.enqueueStorageMutation<T>(action),
    accountCleanupInProgressRef: state.accountCleanupInProgressRef,
    setPendingVerification: state.setPendingVerification,
    activationAttemptRef: state.activationAttemptRef,
    googleSdkEpochRef: state.googleSdkEpochRef,
    googleLifecycleGuardRef: state.googleLifecycleGuardRef,
    accountGuardRef: state.accountGuardRef,
    setSessionOwner: state.setSessionOwner,
    onboardingOwnerRef: state.onboardingOwnerRef,
    onboardingSaveAttemptRef: state.onboardingSaveAttemptRef,
    routeIntentCoordinatorRef: state.routeIntentCoordinatorRef,
    pendingDeepLinkRouteRef: state.pendingDeepLinkRouteRef,
    abortAuthenticatedRequests: (...args) => apiActions.abortAuthenticatedRequests(...args),
    refreshSessionPromiseRef: state.refreshSessionPromiseRef,
    notificationNavigationRequestRef: state.notificationNavigationRequestRef,
    clearNavigationRequest: state.clearNavigationRequest,
    setAuthenticatedContextPending: state.setAuthenticatedContextPending,
    waitForAppleCalendarNativeMutation: (...args) => appleCalendarActions.waitForAppleCalendarNativeMutation(...args),
    waitForAuthenticatedMutations: (...args) => apiActions.waitForAuthenticatedMutations(...args),
    resetUserScopedState: (...args) => accountCleanupActions.resetUserScopedState(...args),
    setCleanupIssue: state.setCleanupIssue,
    restoreManualExams: (...args) => personalCalendarActions.restoreManualExams(...args),
    personalExamRuntime: runtime.personalExamRuntime,
    restoreGoogleCalendarConnection: (...args) => googleCalendarConnectionActions.restoreGoogleCalendarConnection(...args),
    setGoogleCalendarIntegration: state.setGoogleCalendarIntegration,
    restoreAppleCalendarConnection: (...args) => appleCalendarActions.restoreAppleCalendarConnection(...args),
    setAppleCalendarStoredState: state.setAppleCalendarStoredState,
    setAppleCalendarState: state.setAppleCalendarState,
    setAppleCalendarError: state.setAppleCalendarError,
    sessionRef: state.sessionRef,
    notificationCoordinatorOwnerTokenRef: state.notificationCoordinatorOwnerTokenRef,
    setAccountAuthProvider: state.setAccountAuthProvider,
    setSession: state.setSession,
    setActiveTab: state.setActiveTab,
    setActiveRoute: state.setActiveRoute,
    restorePendingNotificationForSession: (...args) => notificationDestinationActions.restorePendingNotificationForSession(...args),
    setBusy: state.setBusy,
    detachNotificationOwnerForCleanup: (...args) => notificationActions.detachNotificationOwnerForCleanup(...args),
    persistPendingNotificationDestination: (...args) => notificationDestinationActions.persistPendingNotificationDestination(...args),
    clearAuthenticatedMemory: (...args) => accountCleanupActions.clearAuthenticatedMemory(...args),
    reportCleanupResult: (...args) => accountCleanupActions.reportCleanupResult(...args),
    setHydrationError: state.setHydrationError,
    setHydrationStatus: state.setHydrationStatus,
    persistGoogleCalendarConnection: (...args) => googleCalendarConnectionActions.persistGoogleCalendarConnection(...args),
    runAbortableGoogleCleanup: (...args) => googleCalendarConnectionActions.runAbortableGoogleCleanup(...args),
    queueGoogleSignOut: (...args) => googleCalendarConnectionActions.queueGoogleSignOut(...args),
    setMessage: state.setMessage,
  });

  const authActions = createAuthActions({
    accountCleanupInProgressRef: state.accountCleanupInProgressRef,
    authOperationInProgressRef: state.authOperationInProgressRef,
    setMessage: state.setMessage,
    authMode: state.authMode,
    registrationValidation: derived.registrationValidation,
    loginValidation: derived.loginValidation,
    deviceIdRef: state.deviceIdRef,
    email: state.email,
    setBusy: state.setBusy,
    apiRequest: <T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    }) => apiActions.apiRequest<T>(path, options, token, requestOptions),
    password: state.password,
    setAuthStage: state.setAuthStage,
    activateSession: (...args) => sessionActions.activateSession(...args),
    setPassword: state.setPassword,
    bootstrapAuthenticatedContext: (...args) => bootstrapActions.bootstrapAuthenticatedContext(...args),
    sessionRef: state.sessionRef,
    setHydrationError: state.setHydrationError,
    setHydrationStatus: state.setHydrationStatus,
    setAuthenticatedContextPending: state.setAuthenticatedContextPending,
    fullName: state.fullName,
    registrationPasswordConfirmation: state.registrationPasswordConfirmation,
    setPendingVerification: state.setPendingVerification,
    setRegistrationPasswordConfirmation: state.setRegistrationPasswordConfirmation,
    setRegisterPicker: state.setRegisterPicker,
    setVerificationToken: state.setVerificationToken,
    persistPendingVerification: (...args) => sessionActions.persistPendingVerification(...args),
    setCleanupIssue: state.setCleanupIssue,
    openVerificationRecovery: (...args) => verificationActions.openVerificationRecovery(...args),
    deviceId: state.deviceId,
    setGoogleBusy: state.setGoogleBusy,
    enqueueGoogleSdkOperation: <T>(action: () => Promise<T>) => googleCalendarConnectionActions.enqueueGoogleSdkOperation<T>(action),
    queueGoogleSignOut: (...args) => googleCalendarConnectionActions.queueGoogleSignOut(...args),
    appleAvailable: state.appleAvailable,
    setAppleBusy: state.setAppleBusy,
  });

  const verificationActions = createVerificationActions({
    authOperationInProgressRef: state.authOperationInProgressRef,
    accountCleanupInProgressRef: state.accountCleanupInProgressRef,
    email: state.email,
    setMessage: state.setMessage,
    verificationTiming: derived.verificationTiming,
    setBusy: state.setBusy,
    apiRequest: <T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    }) => apiActions.apiRequest<T>(path, options, token, requestOptions),
    setPendingVerification: state.setPendingVerification,
    setVerificationToken: state.setVerificationToken,
    persistPendingVerification: (...args) => sessionActions.persistPendingVerification(...args),
    setCleanupIssue: state.setCleanupIssue,
    pendingVerification: state.pendingVerification,
    verificationToken: state.verificationToken,
    deviceIdRef: state.deviceIdRef,
    setRegisterUniversityId: state.setRegisterUniversityId,
    setRegisterFacultyId: state.setRegisterFacultyId,
    setRegisterDepartmentId: state.setRegisterDepartmentId,
    setRegisterClassLevel: state.setRegisterClassLevel,
    setOnboardingInitialDraft: state.setOnboardingInitialDraft,
    password: state.password,
    setAuthMode: state.setAuthMode,
    setAuthStage: state.setAuthStage,
    activateSession: (...args) => sessionActions.activateSession(...args),
    setPassword: state.setPassword,
    bootstrapAuthenticatedContext: (...args) => bootstrapActions.bootstrapAuthenticatedContext(...args),
    sessionRef: state.sessionRef,
    setHydrationError: state.setHydrationError,
    setHydrationStatus: state.setHydrationStatus,
    setAuthenticatedContextPending: state.setAuthenticatedContextPending,
    accountGuardRef: state.accountGuardRef,
    onboardingOwnerRef: state.onboardingOwnerRef,
    academicOnboardingDraft: derived.academicOnboardingDraft,
    onboardingSaveAttemptRef: state.onboardingSaveAttemptRef,
    trackAuthenticatedMutation: <T>(action: () => Promise<T>) => apiActions.trackAuthenticatedMutation<T>(action),
    setSelectedUniversityId: state.setSelectedUniversityId,
    setFullName: state.setFullName,
    setEmail: state.setEmail,
    setAccountAuthProvider: state.setAccountAuthProvider,
    setActiveTab: state.setActiveTab,
    setActiveRoute: state.setActiveRoute,
    warmAuthenticatedContext: (...args) => bootstrapActions.warmAuthenticatedContext(...args),
    setRegistrationPasswordConfirmation: state.setRegistrationPasswordConfirmation,
    setPasswordVisible: state.setPasswordVisible,
    setPasswordRecoveryCode: state.setPasswordRecoveryCode,
    setNewPassword: state.setNewPassword,
    setPasswordConfirmation: state.setPasswordConfirmation,
    setNewPasswordVisible: state.setNewPasswordVisible,
    setPasswordConfirmationVisible: state.setPasswordConfirmationVisible,
    setPendingPasswordRecovery: state.setPendingPasswordRecovery,
    setPasswordRecoveryFeedback: state.setPasswordRecoveryFeedback,
    setRegisterPicker: state.setRegisterPicker,
  });

  const passwordRecoveryActions = createPasswordRecoveryActions({
    email: state.email,
    setEmail: state.setEmail,
    setPassword: state.setPassword,
    setPasswordVisible: state.setPasswordVisible,
    setPasswordRecoveryCode: state.setPasswordRecoveryCode,
    setNewPassword: state.setNewPassword,
    setPasswordConfirmation: state.setPasswordConfirmation,
    setNewPasswordVisible: state.setNewPasswordVisible,
    setPasswordConfirmationVisible: state.setPasswordConfirmationVisible,
    setPendingPasswordRecovery: state.setPendingPasswordRecovery,
    setPasswordRecoveryFeedback: state.setPasswordRecoveryFeedback,
    setAuthMode: state.setAuthMode,
    setAuthStage: state.setAuthStage,
    authOperationInProgressRef: state.authOperationInProgressRef,
    accountCleanupInProgressRef: state.accountCleanupInProgressRef,
    pendingPasswordRecovery: state.pendingPasswordRecovery,
    passwordRecoveryTiming: derived.passwordRecoveryTiming,
    setBusy: state.setBusy,
    apiRequest: <T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    }) => apiActions.apiRequest<T>(path, options, token, requestOptions),
    setPasswordRecoveryClockMs: state.setPasswordRecoveryClockMs,
    passwordRecoveryCode: state.passwordRecoveryCode,
    newPassword: state.newPassword,
    passwordConfirmation: state.passwordConfirmation,
    setMessage: state.setMessage,
  });

  const accountCleanupActions = createAccountCleanupActions({
    session: state.session,
    accountCleanupInProgressRef: state.accountCleanupInProgressRef,
    setBusy: state.setBusy,
    abortAuthenticatedRequests: (...args) => apiActions.abortAuthenticatedRequests(...args),
    waitForAppleCalendarNativeMutation: (...args) => appleCalendarActions.waitForAppleCalendarNativeMutation(...args),
    waitForAuthenticatedMutations: (...args) => apiActions.waitForAuthenticatedMutations(...args),
    persistSession: (...args) => sessionActions.persistSession(...args),
    invalidateAuthenticatedWork: (...args) => sessionActions.invalidateAuthenticatedWork(...args),
    setMessage: state.setMessage,
    detachNotificationOwnerForCleanup: (...args) => notificationActions.detachNotificationOwnerForCleanup(...args),
    persistPendingNotificationDestination: (...args) => notificationDestinationActions.persistPendingNotificationDestination(...args),
    persistPendingVerification: (...args) => sessionActions.persistPendingVerification(...args),
    enqueueStorageMutation: <T>(action: () => Promise<T>) => apiActions.enqueueStorageMutation<T>(action),
    persistGoogleCalendarConnection: (...args) => googleCalendarConnectionActions.persistGoogleCalendarConnection(...args),
    queueGoogleSignOut: (...args) => googleCalendarConnectionActions.queueGoogleSignOut(...args),
    apiRequest: <T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    }) => apiActions.apiRequest<T>(path, options, token, requestOptions),
    personalExamRuntime: runtime.personalExamRuntime,
    setSelectedUniversityId: state.setSelectedUniversityId,
    setRegisterUniversityId: state.setRegisterUniversityId,
    setRegisterFacultyId: state.setRegisterFacultyId,
    setRegisterDepartmentId: state.setRegisterDepartmentId,
    setRegisterClassLevel: state.setRegisterClassLevel,
    setOnboardingInitialDraft: state.setOnboardingInitialDraft,
    onboardingOwnerRef: state.onboardingOwnerRef,
    setRegisterPicker: state.setRegisterPicker,
    setFaculties: state.setFaculties,
    setDepartments: state.setDepartments,
    setFollowedUniversities: state.setFollowedUniversities,
    setFollowedUniversityBusyId: state.setFollowedUniversityBusyId,
    setCalendar: state.setCalendar,
    setCourseSchedule: state.setCourseSchedule,
    setUpcoming: state.setUpcoming,
    setAnnouncements: state.setAnnouncements,
    setYokAnnouncements: state.setYokAnnouncements,
    setSummerSchool: state.setSummerSchool,
    setContentFeedLimit: state.setContentFeedLimit,
    setContentFeedPagination: state.setContentFeedPagination,
    contentFeedAbortControllerRef: state.contentFeedAbortControllerRef,
    contentFeedRequestCoordinatorRef: state.contentFeedRequestCoordinatorRef,
    announcementDetailRequestGenerationRef: state.announcementDetailRequestGenerationRef,
    announcementSaveRequestGenerationRef: state.announcementSaveRequestGenerationRef,
    setAnnouncementDetailLoad: state.setAnnouncementDetailLoad,
    setAnnouncementSaveStatus: state.setAnnouncementSaveStatus,
    setActiveTrustedDetail: state.setActiveTrustedDetail,
    setActiveCalendarDetail: state.setActiveCalendarDetail,
    setPreferences: state.setPreferences,
    setAlarmEnabled: state.setAlarmEnabled,
    setAlarmMode: state.setAlarmMode,
    setCategoryDraft: state.setCategoryDraft,
    setAlarmCategoriesExpanded: state.setAlarmCategoriesExpanded,
    setAcademicProfileSaveState: state.setAcademicProfileSaveState,
    setAcademicProfileSaveError: state.setAcademicProfileSaveError,
    setNotificationPreferenceOutcome: state.setNotificationPreferenceOutcome,
    setNotificationPreferenceError: state.setNotificationPreferenceError,
    setGoogleCalendarIntegration: state.setGoogleCalendarIntegration,
    setGoogleCalendarState: state.setGoogleCalendarState,
    setGoogleCalendarLastResult: state.setGoogleCalendarLastResult,
    setGoogleCalendarWarnings: state.setGoogleCalendarWarnings,
    setGoogleCalendarError: state.setGoogleCalendarError,
    setGoogleCalendarBusy: state.setGoogleCalendarBusy,
    setAppleCalendarStoredState: state.setAppleCalendarStoredState,
    setAppleCalendarPermission: state.setAppleCalendarPermission,
    setAppleCalendarState: state.setAppleCalendarState,
    setAppleCalendarLastResult: state.setAppleCalendarLastResult,
    setAppleCalendarWarnings: state.setAppleCalendarWarnings,
    setAppleCalendarError: state.setAppleCalendarError,
    setAppleCalendarBusy: state.setAppleCalendarBusy,
    setGoogleBusy: state.setGoogleBusy,
    setAppleBusy: state.setAppleBusy,
    academicSelectionPendingRef: state.academicSelectionPendingRef,
    setAcademicSelectionPending: state.setAcademicSelectionPending,
    setNotificationDestinationNotice: state.setNotificationDestinationNotice,
    authOperationInProgressRef: state.authOperationInProgressRef,
    sessionRef: state.sessionRef,
    notificationCoordinatorOwnerTokenRef: state.notificationCoordinatorOwnerTokenRef,
    setAccountAuthProvider: state.setAccountAuthProvider,
    setRecentAuthAction: state.setRecentAuthAction,
    setRecentAuthReturnFocus: state.setRecentAuthReturnFocus,
    setRecentAuthPassword: state.setRecentAuthPassword,
    setRecentAuthBusy: state.setRecentAuthBusy,
    setRecentAuthError: state.setRecentAuthError,
    setSession: state.setSession,
    setSessionOwner: state.setSessionOwner,
    setAuthenticatedContextPending: state.setAuthenticatedContextPending,
    setAuthMode: state.setAuthMode,
    setAuthStage: state.setAuthStage,
    setActiveTab: state.setActiveTab,
    setEmail: state.setEmail,
    setPassword: state.setPassword,
    setRegistrationPasswordConfirmation: state.setRegistrationPasswordConfirmation,
    setPasswordVisible: state.setPasswordVisible,
    setFullName: state.setFullName,
    setVerificationToken: state.setVerificationToken,
    setPendingVerification: state.setPendingVerification,
    setCleanupIssue: state.setCleanupIssue,
    cleanupIssue: state.cleanupIssue,
    beginRecentAuthentication: (...args) => recentAuthActions.beginRecentAuthentication(...args),
    accountGuardRef: state.accountGuardRef,
    readStoredGoogleCalendarConnection: (...args) => googleCalendarConnectionActions.readStoredGoogleCalendarConnection(...args),
    notificationCoordinatorRef: state.notificationCoordinatorRef,
    pendingVerification: state.pendingVerification,
    restoreManualExams: (...args) => personalCalendarActions.restoreManualExams(...args),
    personalCalendarReminderCoordinator: runtime.personalCalendarReminderCoordinator,
    runAbortableGoogleCleanup: (...args) => googleCalendarConnectionActions.runAbortableGoogleCleanup(...args),
    removeGoogleManagedEventsForDeletion: (...args) => googleCalendarConnectionActions.removeGoogleManagedEventsForDeletion(...args),
    revokeGoogleCalendarAccessForConnection: (...args) => googleCalendarConnectionActions.revokeGoogleCalendarAccessForConnection(...args),
    restoreGoogleCalendarConnection: (...args) => googleCalendarConnectionActions.restoreGoogleCalendarConnection(...args),
    removeAppleManagedEventsForDeletion: (...args) => appleCalendarActions.removeAppleManagedEventsForDeletion(...args),
  });

  const recentAuthActions = createRecentAuthActions({
    recentAuthBusy: state.recentAuthBusy,
    recentAuthAction: state.recentAuthAction,
    setRecentAuthAction: state.setRecentAuthAction,
    setRecentAuthPassword: state.setRecentAuthPassword,
    setRecentAuthError: state.setRecentAuthError,
    recentAuthReturnFocusRequestRef: state.recentAuthReturnFocusRequestRef,
    setRecentAuthReturnFocus: state.setRecentAuthReturnFocus,
    sessionRef: state.sessionRef,
    accountCleanupInProgressRef: state.accountCleanupInProgressRef,
    enqueueGoogleSdkOperation: <T>(action: () => Promise<T>) => googleCalendarConnectionActions.enqueueGoogleSdkOperation<T>(action),
    appleAvailable: state.appleAvailable,
    requestAppleCredential: (...args) => authActions.requestAppleCredential(...args),
    accountGuardRef: state.accountGuardRef,
    apiRequest: <T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    }) => apiActions.apiRequest<T>(path, options, token, requestOptions),
    recentAuthPassword: state.recentAuthPassword,
    setRecentAuthBusy: state.setRecentAuthBusy,
    session: state.session,
    googleCalendarIntegration: state.googleCalendarIntegration,
    readStoredGoogleCalendarConnection: (...args) => googleCalendarConnectionActions.readStoredGoogleCalendarConnection(...args),
    setBusy: state.setBusy,
    abortAuthenticatedRequests: (...args) => apiActions.abortAuthenticatedRequests(...args),
    waitForAppleCalendarNativeMutation: (...args) => appleCalendarActions.waitForAppleCalendarNativeMutation(...args),
    waitForAuthenticatedMutations: (...args) => apiActions.waitForAuthenticatedMutations(...args),
    invalidateAuthenticatedWork: (...args) => sessionActions.invalidateAuthenticatedWork(...args),
    resetUserScopedState: (...args) => accountCleanupActions.resetUserScopedState(...args),
    setPendingVerification: state.setPendingVerification,
    setSessionOwner: state.setSessionOwner,
    onboardingOwnerRef: state.onboardingOwnerRef,
    setAuthStage: state.setAuthStage,
    googleLifecycleGuardRef: state.googleLifecycleGuardRef,
    detachNotificationOwnerForCleanup: (...args) => notificationActions.detachNotificationOwnerForCleanup(...args),
    persistPendingNotificationDestination: (...args) => notificationDestinationActions.persistPendingNotificationDestination(...args),
    removeAppleManagedEventsForDeletion: (...args) => appleCalendarActions.removeAppleManagedEventsForDeletion(...args),
    runAbortableGoogleCleanup: (...args) => googleCalendarConnectionActions.runAbortableGoogleCleanup(...args),
    removeGoogleManagedEventsForDeletion: (...args) => googleCalendarConnectionActions.removeGoogleManagedEventsForDeletion(...args),
    revokeGoogleCalendarAccessForConnection: (...args) => googleCalendarConnectionActions.revokeGoogleCalendarAccessForConnection(...args),
    persistPendingVerification: (...args) => sessionActions.persistPendingVerification(...args),
    enqueueStorageMutation: <T>(action: () => Promise<T>) => apiActions.enqueueStorageMutation<T>(action),
    personalCalendarReminderCoordinator: runtime.personalCalendarReminderCoordinator,
    persistGoogleCalendarConnection: (...args) => googleCalendarConnectionActions.persistGoogleCalendarConnection(...args),
    queueGoogleSignOut: (...args) => googleCalendarConnectionActions.queueGoogleSignOut(...args),
    notificationCoordinatorRef: state.notificationCoordinatorRef,
    personalExamRuntime: runtime.personalExamRuntime,
    reportCleanupResult: (...args) => accountCleanupActions.reportCleanupResult(...args),
    setMessage: state.setMessage,
    persistSession: (...args) => sessionActions.persistSession(...args),
    clearAuthenticatedMemory: (...args) => accountCleanupActions.clearAuthenticatedMemory(...args),
  });

  const catalogActions = createCatalogActions({
    accountGuardRef: state.accountGuardRef,
    withLoadable: <T>(setter: Dispatch<SetStateAction<Loadable<T>>>, action: () => Promise<T>, ownerSnapshot?: AccountGenerationSnapshot | null, preserveDataOnRefresh?: boolean, isOperationCurrent?: () => boolean) => apiActions.withLoadable<T>(setter, action, ownerSnapshot, preserveDataOnRefresh, isOperationCurrent),
    setUniversities: state.setUniversities,
    apiRequest: <T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    }) => apiActions.apiRequest<T>(path, options, token, requestOptions),
    setFaculties: state.setFaculties,
    setDepartments: state.setDepartments,
    accessToken: derived.accessToken,
    setMessage: state.setMessage,
    academicSelectionPendingRef: state.academicSelectionPendingRef,
    accountCleanupInProgressRef: state.accountCleanupInProgressRef,
    setAcademicSelectionPending: state.setAcademicSelectionPending,
    trackAuthenticatedMutation: <T>(action: () => Promise<T>) => apiActions.trackAuthenticatedMutation<T>(action),
    setSelectedUniversityId: state.setSelectedUniversityId,
    setRegisterUniversityId: state.setRegisterUniversityId,
    setRegisterFacultyId: state.setRegisterFacultyId,
    setRegisterDepartmentId: state.setRegisterDepartmentId,
    setRegisterClassLevel: state.setRegisterClassLevel,
    setFacultySearch: state.setFacultySearch,
    setDepartmentSearch: state.setDepartmentSearch,
    setRegisterPicker: state.setRegisterPicker,
    setAcademicProfileExpanded: state.setAcademicProfileExpanded,
    setSummerSchool: state.setSummerSchool,
    invalidateContentFeedOwnership: (...args) => contentNavigationActions.invalidateContentFeedOwnership(...args),
    loadMyCalendar: (...args) => contentActions.loadMyCalendar(...args),
    loadCourseSchedule: (...args) => contentActions.loadCourseSchedule(...args),
    loadUpcoming: (...args) => contentActions.loadUpcoming(...args),
    loadPreferences: (...args) => notificationActions.loadPreferences(...args),
    registerUniversityId: state.registerUniversityId,
    registerFacultyId: state.registerFacultyId,
    setFollowedUniversities: state.setFollowedUniversities,
    sessionRef: state.sessionRef,
    followedUniversityBusyId: state.followedUniversityBusyId,
    followedUniversities: state.followedUniversities,
    setFollowedUniversityBusyId: state.setFollowedUniversityBusyId,
    refreshContentFeed: (...args) => contentActions.refreshContentFeed(...args),
    setAcademicProfileSaveState: state.setAcademicProfileSaveState,
    setAcademicProfileSaveError: state.setAcademicProfileSaveError,
    onboardingInitialDraft: state.onboardingInitialDraft,
    academicOnboardingDraft: derived.academicOnboardingDraft,
    setOnboardingInitialDraft: state.setOnboardingInitialDraft,
    setFullName: state.setFullName,
    setEmail: state.setEmail,
    setAccountAuthProvider: state.setAccountAuthProvider,
  });

  const contentActions = createContentActions({
    accountGuardRef: state.accountGuardRef,
    accessToken: derived.accessToken,
    withLoadable: <T>(setter: Dispatch<SetStateAction<Loadable<T>>>, action: () => Promise<T>, ownerSnapshot?: AccountGenerationSnapshot | null, preserveDataOnRefresh?: boolean, isOperationCurrent?: () => boolean) => apiActions.withLoadable<T>(setter, action, ownerSnapshot, preserveDataOnRefresh, isOperationCurrent),
    setCalendar: state.setCalendar,
    apiRequest: <T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    }) => apiActions.apiRequest<T>(path, options, token, requestOptions),
    setCourseSchedule: state.setCourseSchedule,
    setUpcoming: state.setUpcoming,
    contentFeedLimit: state.contentFeedLimit,
    contentFeedRequestCoordinatorRef: state.contentFeedRequestCoordinatorRef,
    registerUniversityId: state.registerUniversityId,
    setAnnouncements: state.setAnnouncements,
    setYokAnnouncements: state.setYokAnnouncements,
    setSummerSchool: state.setSummerSchool,
    trackAuthenticatedMutation: <T>(action: () => Promise<T>) => apiActions.trackAuthenticatedMutation<T>(action),
    contentFeedAbortControllerRef: state.contentFeedAbortControllerRef,
    setContentFeedPagination: state.setContentFeedPagination,
    contentFeedPagination: state.contentFeedPagination,
    announcements: state.announcements,
    yokAnnouncements: state.yokAnnouncements,
    setContentFeedLimit: state.setContentFeedLimit,
    notificationLifecycleRef: state.notificationLifecycleRef,
    notificationPreferencesRef: state.notificationPreferencesRef,
  });

  const notificationActions = createNotificationActions({
    setNotificationLifecycle: state.setNotificationLifecycle,
    notificationCoordinatorRef: state.notificationCoordinatorRef,
    notificationCoordinatorOwnerTokenRef: state.notificationCoordinatorOwnerTokenRef,
    accountGuardRef: state.accountGuardRef,
    apiRequest: <T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    }) => apiActions.apiRequest<T>(path, options, token, requestOptions),
    notificationUnsubscribeRef: state.notificationUnsubscribeRef,
    notificationRotationUnsubscribeRef: state.notificationRotationUnsubscribeRef,
    notificationForegroundUnsubscribeRef: state.notificationForegroundUnsubscribeRef,
    sessionRef: state.sessionRef,
    setAlarmEnabled: state.setAlarmEnabled,
    setCleanupIssue: state.setCleanupIssue,
    setMessage: state.setMessage,
    personalCalendarReminderCoordinator: runtime.personalCalendarReminderCoordinator,
    accessToken: derived.accessToken,
    withLoadable: <T>(setter: Dispatch<SetStateAction<Loadable<T>>>, action: () => Promise<T>, ownerSnapshot?: AccountGenerationSnapshot | null, preserveDataOnRefresh?: boolean, isOperationCurrent?: () => boolean) => apiActions.withLoadable<T>(setter, action, ownerSnapshot, preserveDataOnRefresh, isOperationCurrent),
    setPreferences: state.setPreferences,
    notificationReconcilePromiseRef: state.notificationReconcilePromiseRef,
    notificationFailClosedPromiseRef: state.notificationFailClosedPromiseRef,
    categoryDraftRef: state.categoryDraftRef,
    setCategoryDraft: state.setCategoryDraft,
    setNotificationPreferenceOutcome: state.setNotificationPreferenceOutcome,
    setNotificationPreferenceError: state.setNotificationPreferenceError,
    alarmModeRef: state.alarmModeRef,
    setAlarmMode: state.setAlarmMode,
    availableCategories: derived.availableCategories,
    alarmEnabledRef: state.alarmEnabledRef,
    initialNotificationPreference: derived.initialNotificationPreference,
    accountCleanupInProgressRef: state.accountCleanupInProgressRef,
    preferences: state.preferences,
    setBusy: state.setBusy,
    trackAuthenticatedMutation: <T>(action: () => Promise<T>) => apiActions.trackAuthenticatedMutation<T>(action),
  });

  const notificationDestinationActions = createNotificationDestinationActions({
    enqueueStorageMutation: <T>(action: () => Promise<T>) => apiActions.enqueueStorageMutation<T>(action),
    accountGuardRef: state.accountGuardRef,
    personalExamRuntime: runtime.personalExamRuntime,
    apiRequest: <T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    }) => apiActions.apiRequest<T>(path, options, token, requestOptions),
    setAnnouncements: state.setAnnouncements,
    sessionRef: state.sessionRef,
    setNotificationDestinationNotice: state.setNotificationDestinationNotice,
    routeIntentCoordinatorRef: state.routeIntentCoordinatorRef,
    notificationNavigationRequestRef: state.notificationNavigationRequestRef,
    announcementDetailRequestGenerationRef: state.announcementDetailRequestGenerationRef,
    setActiveTrustedDetail: state.setActiveTrustedDetail,
    setAnnouncementDetailLoad: state.setAnnouncementDetailLoad,
    courseSchedule: state.courseSchedule,
    calendar: state.calendar,
    selectedUniversity: derived.selectedUniversity,
    setActiveCalendarDetail: state.setActiveCalendarDetail,
    requestAppRoute: state.requestAppRoute,
    setActiveTab: state.setActiveTab,
    setMessage: state.setMessage,
  });

  const contentNavigationActions = createContentNavigationActions({
    announcementDetailRequestGenerationRef: state.announcementDetailRequestGenerationRef,
    announcementSaveRequestGenerationRef: state.announcementSaveRequestGenerationRef,
    setAnnouncementDetailLoad: state.setAnnouncementDetailLoad,
    setAnnouncementSaveStatus: state.setAnnouncementSaveStatus,
    setActiveTrustedDetail: state.setActiveTrustedDetail,
    contentFeedAbortControllerRef: state.contentFeedAbortControllerRef,
    contentFeedRequestCoordinatorRef: state.contentFeedRequestCoordinatorRef,
    setAnnouncements: state.setAnnouncements,
    setYokAnnouncements: state.setYokAnnouncements,
    setSummerSchool: state.setSummerSchool,
    setContentFeedPagination: state.setContentFeedPagination,
    requestAppRoute: state.requestAppRoute,
    setMessage: state.setMessage,
    sessionRef: state.sessionRef,
    accountGuardRef: state.accountGuardRef,
    apiRequest: <T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    }) => apiActions.apiRequest<T>(path, options, token, requestOptions),
    announcementSaveStatus: state.announcementSaveStatus,
    trackAuthenticatedMutation: <T>(action: () => Promise<T>) => apiActions.trackAuthenticatedMutation<T>(action),
    announcementFeed: derived.announcementFeed,
  });

  const navigationActions = createNavigationActions({
    loadProtectedAnnouncementDetail: (...args) => contentNavigationActions.loadProtectedAnnouncementDetail(...args),
    invalidateAnnouncementDetailOwnership: (...args) => contentNavigationActions.invalidateAnnouncementDetailOwnership(...args),
    setActiveTab: state.setActiveTab,
    requestAppRoute: state.requestAppRoute,
    accountGuardRef: state.accountGuardRef,
    routeIntentCoordinatorRef: state.routeIntentCoordinatorRef,
    receiveNotificationDestination: (...args) => notificationDestinationActions.receiveNotificationDestination(...args),
    sessionRef: state.sessionRef,
    hydrationStatusRef: state.hydrationStatusRef,
    navigatorRootSurface: derived.navigatorRootSurface,
    authOperationInProgressRef: state.authOperationInProgressRef,
    busy: state.busy,
    pendingDeepLinkRouteRef: state.pendingDeepLinkRouteRef,
    setActiveCalendarDetail: state.setActiveCalendarDetail,
    homeEvents: homeData.homeEvents,
    homeManualExams: homeData.homeManualExams,
    calendar: state.calendar,
    selectedUniversity: derived.selectedUniversity,
    openAnnouncement: (...args) => contentNavigationActions.openAnnouncement(...args),
    setMessage: state.setMessage,
    acknowledgeNavigationRequest: state.acknowledgeNavigationRequest,
    notificationNavigationRequestRef: state.notificationNavigationRequestRef,
    clearPendingNotificationDestinationIfCurrent: (...args) => notificationDestinationActions.clearPendingNotificationDestinationIfCurrent(...args),
    setCleanupIssue: state.setCleanupIssue,
    setActiveRoute: state.setActiveRoute,
    authStage: state.authStage,
    cancelPasswordRecovery: (...args) => passwordRecoveryActions.cancelPasswordRecovery(...args),
    authMode: state.authMode,
    returnToLoginForm: (...args) => verificationActions.returnToLoginForm(...args),
    setAuthMode: state.setAuthMode,
    setAuthStage: state.setAuthStage,
    returnToPasswordRecoveryRequest: (...args) => passwordRecoveryActions.returnToPasswordRecoveryRequest(...args),
    pendingPasswordRecovery: state.pendingPasswordRecovery,
    activeTrustedDetail: state.activeTrustedDetail,
    announcementDetailLoad: state.announcementDetailLoad,
    universities: state.universities,
    loadUniversities: (...args) => catalogActions.loadUniversities(...args),
    followedUniversities: state.followedUniversities,
    loadFollowedUniversities: (...args) => catalogActions.loadFollowedUniversities(...args),
    preloginWelcomeGate: state.preloginWelcomeGate,
    setPreloginWelcomeGate: state.setPreloginWelcomeGate,
  });

  const appleCalendarActions = createAppleCalendarActions({
    deviceIdRef: state.deviceIdRef,
    accountGuardRef: state.accountGuardRef,
    setAppleCalendarStoredState: state.setAppleCalendarStoredState,
    setAppleCalendarLastResult: state.setAppleCalendarLastResult,
    setAppleCalendarWarnings: state.setAppleCalendarWarnings,
    setAppleCalendarError: state.setAppleCalendarError,
    setAppleCalendarPermission: state.setAppleCalendarPermission,
    setAppleCalendarState: state.setAppleCalendarState,
    nativeCalendarService: state.nativeCalendarService,
    accountCleanupInProgressRef: state.accountCleanupInProgressRef,
    appleCalendarNativeMutationRef: state.appleCalendarNativeMutationRef,
    appleCalendarOperationRef: state.appleCalendarOperationRef,
    sessionRef: state.sessionRef,
    authenticatedRequestControllersRef: state.authenticatedRequestControllersRef,
    setAppleCalendarBusy: state.setAppleCalendarBusy,
    setMessage: state.setMessage,
    apiRequest: <T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    }) => apiActions.apiRequest<T>(path, options, token, requestOptions),
    setCalendar: state.setCalendar,
    loadDeviceAnnouncementCollection: (...args) => contentActions.loadDeviceAnnouncementCollection(...args),
    appleCalendarPermission: state.appleCalendarPermission,
    appleCalendarStoredState: state.appleCalendarStoredState,
  });

  const googleCalendarConnectionActions = createGoogleCalendarConnectionActions({
    accountGuardRef: state.accountGuardRef,
    setGoogleCalendarIntegration: state.setGoogleCalendarIntegration,
    setGoogleCalendarLastResult: state.setGoogleCalendarLastResult,
    setGoogleCalendarWarnings: state.setGoogleCalendarWarnings,
    setGoogleCalendarError: state.setGoogleCalendarError,
    setGoogleCalendarState: state.setGoogleCalendarState,
    enqueueStorageMutation: <T>(action: () => Promise<T>) => apiActions.enqueueStorageMutation<T>(action),
    authenticatedRequestControllersRef: state.authenticatedRequestControllersRef,
    googleCalendarService: derived.googleCalendarService,
    googleSdkQueueRef: state.googleSdkQueueRef,
    googleSdkEpochRef: state.googleSdkEpochRef,
  });

  const googleCalendarActions = createGoogleCalendarActions({
    accountCleanupInProgressRef: state.accountCleanupInProgressRef,
    sessionRef: state.sessionRef,
    accountGuardRef: state.accountGuardRef,
    setGoogleCalendarError: state.setGoogleCalendarError,
    googleLifecycleGuardRef: state.googleLifecycleGuardRef,
    googleCalendarIntegration: state.googleCalendarIntegration,
    setMessage: state.setMessage,
    setGoogleCalendarBusy: state.setGoogleCalendarBusy,
    setGoogleCalendarState: state.setGoogleCalendarState,
    authenticatedRequestControllersRef: state.authenticatedRequestControllersRef,
    apiRequest: <T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    }) => apiActions.apiRequest<T>(path, options, token, requestOptions),
    setCalendar: state.setCalendar,
    loadDeviceAnnouncementCollection: (...args) => contentActions.loadDeviceAnnouncementCollection(...args),
    readCurrentGoogleCalendarAuthorization: (...args) => googleCalendarConnectionActions.readCurrentGoogleCalendarAuthorization(...args),
    authorizeGoogleCalendar: (...args) => googleCalendarConnectionActions.authorizeGoogleCalendar(...args),
    queueGoogleSignOut: (...args) => googleCalendarConnectionActions.queueGoogleSignOut(...args),
    googleCalendarService: derived.googleCalendarService,
    enqueueStorageMutation: <T>(action: () => Promise<T>) => apiActions.enqueueStorageMutation<T>(action),
    persistGoogleCalendarConnection: (...args) => googleCalendarConnectionActions.persistGoogleCalendarConnection(...args),
    setGoogleCalendarIntegration: state.setGoogleCalendarIntegration,
    setGoogleCalendarLastResult: state.setGoogleCalendarLastResult,
    setGoogleCalendarWarnings: state.setGoogleCalendarWarnings,
    enqueueGoogleSdkOperation: <T>(action: () => Promise<T>) => googleCalendarConnectionActions.enqueueGoogleSdkOperation<T>(action),
    runAbortableGoogleCleanup: (...args) => googleCalendarConnectionActions.runAbortableGoogleCleanup(...args),
    revokeGoogleCalendarAccessForConnection: (...args) => googleCalendarConnectionActions.revokeGoogleCalendarAccessForConnection(...args),
  });

  const personalCalendarActions = createPersonalCalendarActions({
    accountGuardRef: state.accountGuardRef,
    personalExamRuntime: runtime.personalExamRuntime,
    personalCalendarReminderCoordinator: runtime.personalCalendarReminderCoordinator,
    setMessage: state.setMessage,
    accountCleanupInProgressRef: state.accountCleanupInProgressRef,
    sessionRef: state.sessionRef,
    setActiveCalendarDetail: state.setActiveCalendarDetail,
    requestAppRoute: state.requestAppRoute,
  });

  return {
    ...apiActions,
    ...bootstrapActions,
    ...sessionActions,
    ...authActions,
    ...verificationActions,
    ...passwordRecoveryActions,
    ...accountCleanupActions,
    ...recentAuthActions,
    ...catalogActions,
    ...contentActions,
    ...notificationActions,
    ...notificationDestinationActions,
    ...contentNavigationActions,
    ...navigationActions,
    ...appleCalendarActions,
    ...googleCalendarConnectionActions,
    ...googleCalendarActions,
    ...personalCalendarActions,
  };
}
