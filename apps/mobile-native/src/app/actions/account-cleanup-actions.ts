import { Platform } from "react-native";
import { runObservableAccountCleanup, type AccountCleanupResult } from "../../auth/session-integrity";
import { EMPTY_ACADEMIC_ONBOARDING_DRAFT } from "../../auth/auth-ui";
import { createManualExamStorageKey } from "../../session-integrity/manual-exam-storage";
import { CONTENT_FEED_INITIAL_LIMIT } from "../../announcements/feed-model";
import { deleteDeviceContentCache } from "../../content/device-content-cache";
import { deleteDeviceContentNotificationLedger } from "../../content/device-content-notification-ledger";
import { deleteDeviceSavedContent } from "../../content/device-saved-content";
import { StaleAccountRequestError } from "../app-errors";
import { deleteStoredValue } from "../app-storage";
import { GOOGLE_AUTH_CONFIGURED } from "../app-auth-providers";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationActions } from "../application-actions";
import type { PersonalCalendarRuntime } from "../usePersonalCalendarRuntime";

type Dependencies = Pick<ApplicationState,
  "session" | "accountCleanupInProgressRef" | "setBusy" | "setMessage" | "setSelectedUniversityId"
  | "setRegisterUniversityId" | "setRegisterFacultyId" | "setRegisterDepartmentId"
  | "setRegisterClassLevel" | "setOnboardingInitialDraft" | "onboardingOwnerRef"
  | "setRegisterPicker" | "setFaculties" | "setDepartments" | "setFollowedUniversities"
  | "setFollowedUniversityBusyId" | "setCalendar" | "setCourseSchedule" | "setUpcoming"
  | "setAnnouncements" | "setYokAnnouncements" | "setSummerSchool" | "setContentFeedLimit"
  | "setContentFeedPagination" | "contentFeedAbortControllerRef"
  | "contentFeedRequestCoordinatorRef" | "announcementDetailRequestGenerationRef"
  | "announcementSaveRequestGenerationRef" | "setAnnouncementDetailLoad"
  | "setAnnouncementSaveStatus" | "setActiveTrustedDetail" | "setActiveCalendarDetail"
  | "setPreferences" | "setAlarmEnabled" | "setAlarmMode" | "setCategoryDraft"
  | "setAlarmCategoriesExpanded" | "setAcademicProfileSaveState" | "setAcademicProfileSaveError"
  | "setNotificationPreferenceOutcome" | "setNotificationPreferenceError"
  | "setGoogleCalendarIntegration" | "setGoogleCalendarState" | "setGoogleCalendarLastResult"
  | "setGoogleCalendarWarnings" | "setGoogleCalendarError" | "setGoogleCalendarBusy"
  | "setAppleCalendarStoredState" | "setAppleCalendarPermission" | "setAppleCalendarState"
  | "setAppleCalendarLastResult" | "setAppleCalendarWarnings" | "setAppleCalendarError"
  | "setAppleCalendarBusy" | "setGoogleBusy" | "setAppleBusy" | "academicSelectionPendingRef"
  | "setAcademicSelectionPending" | "setNotificationDestinationNotice"
  | "authOperationInProgressRef" | "sessionRef" | "notificationCoordinatorOwnerTokenRef"
  | "setAccountAuthProvider" | "setRecentAuthAction" | "setRecentAuthReturnFocus"
  | "setRecentAuthPassword" | "setRecentAuthBusy" | "setRecentAuthError" | "setSession"
  | "setSessionOwner" | "setAuthenticatedContextPending" | "setAuthMode" | "setAuthStage"
  | "setActiveTab" | "setEmail" | "setPassword" | "setRegistrationPasswordConfirmation"
  | "setPasswordVisible" | "setFullName" | "setVerificationToken" | "setPendingVerification"
  | "setCleanupIssue" | "cleanupIssue" | "accountGuardRef" | "notificationCoordinatorRef"
  | "pendingVerification"
> & Pick<ApplicationActions,
  "abortAuthenticatedRequests" | "waitForAppleCalendarNativeMutation"
  | "waitForAuthenticatedMutations" | "persistSession" | "invalidateAuthenticatedWork"
  | "detachNotificationOwnerForCleanup" | "persistPendingNotificationDestination"
  | "persistPendingVerification" | "enqueueStorageMutation" | "persistGoogleCalendarConnection"
  | "queueGoogleSignOut" | "apiRequest" | "beginRecentAuthentication"
  | "readStoredGoogleCalendarConnection" | "restoreManualExams" | "runAbortableGoogleCleanup"
  | "removeGoogleManagedEventsForDeletion" | "revokeGoogleCalendarAccessForConnection"
  | "restoreGoogleCalendarConnection" | "removeAppleManagedEventsForDeletion"
> & Pick<PersonalCalendarRuntime,
  "personalExamRuntime" | "personalCalendarReminderCoordinator"
>;

export function createAccountCleanupActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "handleLogout" | "resetUserScopedState" | "clearAuthenticatedMemory" | "reportCleanupResult"
  | "retryFailedCleanup"
> {
  const {
    session,
    accountCleanupInProgressRef,
    setBusy,
    abortAuthenticatedRequests,
    waitForAppleCalendarNativeMutation,
    waitForAuthenticatedMutations,
    persistSession,
    invalidateAuthenticatedWork,
    setMessage,
    detachNotificationOwnerForCleanup,
    persistPendingNotificationDestination,
    persistPendingVerification,
    enqueueStorageMutation,
    persistGoogleCalendarConnection,
    queueGoogleSignOut,
    apiRequest,
    personalExamRuntime,
    setSelectedUniversityId,
    setRegisterUniversityId,
    setRegisterFacultyId,
    setRegisterDepartmentId,
    setRegisterClassLevel,
    setOnboardingInitialDraft,
    onboardingOwnerRef,
    setRegisterPicker,
    setFaculties,
    setDepartments,
    setFollowedUniversities,
    setFollowedUniversityBusyId,
    setCalendar,
    setCourseSchedule,
    setUpcoming,
    setAnnouncements,
    setYokAnnouncements,
    setSummerSchool,
    setContentFeedLimit,
    setContentFeedPagination,
    contentFeedAbortControllerRef,
    contentFeedRequestCoordinatorRef,
    announcementDetailRequestGenerationRef,
    announcementSaveRequestGenerationRef,
    setAnnouncementDetailLoad,
    setAnnouncementSaveStatus,
    setActiveTrustedDetail,
    setActiveCalendarDetail,
    setPreferences,
    setAlarmEnabled,
    setAlarmMode,
    setCategoryDraft,
    setAlarmCategoriesExpanded,
    setAcademicProfileSaveState,
    setAcademicProfileSaveError,
    setNotificationPreferenceOutcome,
    setNotificationPreferenceError,
    setGoogleCalendarIntegration,
    setGoogleCalendarState,
    setGoogleCalendarLastResult,
    setGoogleCalendarWarnings,
    setGoogleCalendarError,
    setGoogleCalendarBusy,
    setAppleCalendarStoredState,
    setAppleCalendarPermission,
    setAppleCalendarState,
    setAppleCalendarLastResult,
    setAppleCalendarWarnings,
    setAppleCalendarError,
    setAppleCalendarBusy,
    setGoogleBusy,
    setAppleBusy,
    academicSelectionPendingRef,
    setAcademicSelectionPending,
    setNotificationDestinationNotice,
    authOperationInProgressRef,
    sessionRef,
    notificationCoordinatorOwnerTokenRef,
    setAccountAuthProvider,
    setRecentAuthAction,
    setRecentAuthReturnFocus,
    setRecentAuthPassword,
    setRecentAuthBusy,
    setRecentAuthError,
    setSession,
    setSessionOwner,
    setAuthenticatedContextPending,
    setAuthMode,
    setAuthStage,
    setActiveTab,
    setEmail,
    setPassword,
    setRegistrationPasswordConfirmation,
    setPasswordVisible,
    setFullName,
    setVerificationToken,
    setPendingVerification,
    setCleanupIssue,
    cleanupIssue,
    beginRecentAuthentication,
    accountGuardRef,
    readStoredGoogleCalendarConnection,
    notificationCoordinatorRef,
    pendingVerification,
    restoreManualExams,
    personalCalendarReminderCoordinator,
    runAbortableGoogleCleanup,
    removeGoogleManagedEventsForDeletion,
    revokeGoogleCalendarAccessForConnection,
    restoreGoogleCalendarConnection,
    removeAppleManagedEventsForDeletion
  } = dependencies;

  async function handleLogout(): Promise<void> {
    if (!session || accountCleanupInProgressRef.current) return;
    const closingSession = session;
    const ownerId = closingSession.user.id;
    accountCleanupInProgressRef.current = true;
    setBusy(true);
    abortAuthenticatedRequests();
    await waitForAppleCalendarNativeMutation();
    await waitForAuthenticatedMutations();
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
      { target: "device_content_cache", run: () => deleteDeviceContentCache(ownerId) },
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
      setMessage(null);
    } else {
      // The cleanup banner owns this partial-success state. Rendering a second
      // auth error banner makes the fixed login viewport needlessly cramped.
      setMessage(null);
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
    setFollowedUniversities({ loading: false });
    setFollowedUniversityBusyId(undefined);
    setCalendar({ loading: false });
    setCourseSchedule({ loading: false });
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
    setAppleCalendarStoredState({ mappings: {} });
    setAppleCalendarPermission({
      status: Platform.OS === "ios" ? "not_determined" : "unavailable",
      granted: false,
      canAskAgain: Platform.OS === "ios",
    });
    setAppleCalendarState(Platform.OS === "ios" ? "disconnected" : "unavailable");
    setAppleCalendarLastResult(null);
    setAppleCalendarWarnings([]);
    setAppleCalendarError(null);
    setAppleCalendarBusy(false);
    setGoogleBusy(false);
    setAppleBusy(false);
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
      abortAuthenticatedRequests();
      await waitForAppleCalendarNativeMutation();
      await waitForAuthenticatedMutations();
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
              await Promise.all([
                enqueueStorageMutation(() => deleteStoredValue(createManualExamStorageKey(issue.ownerId as string))),
                personalCalendarReminderCoordinator.cancelOwner(issue.ownerId as string)
              ]);
            }
          } else if (target === "pending_notification_storage") {
            await persistPendingNotificationDestination(null);
          } else if (target === "device_content_cache" && issue.ownerId) {
            await deleteDeviceContentCache(issue.ownerId);
            if (issue.action === "data_deletion" || issue.action === "account_deletion") {
              await deleteDeviceContentNotificationLedger(issue.ownerId);
              await deleteDeviceSavedContent(issue.ownerId);
            }
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
          } else if (target === "apple_managed_events" && issue.ownerId) {
            await removeAppleManagedEventsForDeletion(issue.ownerId);
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

  return {
    handleLogout,
    resetUserScopedState,
    clearAuthenticatedMemory,
    reportCleanupResult,
    retryFailedCleanup
  };
}
