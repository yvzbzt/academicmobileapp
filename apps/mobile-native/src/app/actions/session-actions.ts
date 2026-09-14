import { type PendingVerificationRecord, PENDING_VERIFICATION_STORAGE_KEY } from "../../auth/auth-recovery";
import {
  type AccountGenerationSnapshot,
  type AccountCleanupTarget,
  runObservableAccountCleanup,
} from "../../auth/session-integrity";
import { normalizeAccountAuthProvider } from "../../auth/recent-authentication";
import { deleteDeviceContentCache } from "../../content/device-content-cache";
import { type SessionPayload } from "../app-types";
import {
  setStoredValue,
  SESSION_STORAGE_KEY,
  SESSION_INVALIDATED_STORAGE_VALUE,
  deleteStoredValue,
} from "../app-storage";
import { StaleAccountRequestError, ApiRequestError } from "../app-errors";
import type { ApplicationActions } from "../application-actions";
import type { ApplicationState } from "../useApplicationState";
import type { PersonalCalendarRuntime } from "../usePersonalCalendarRuntime";

type Dependencies = Pick<ApplicationActions,
  "enqueueStorageMutation" | "abortAuthenticatedRequests" | "waitForAppleCalendarNativeMutation"
  | "waitForAuthenticatedMutations" | "resetUserScopedState" | "restoreManualExams"
  | "restoreGoogleCalendarConnection" | "restoreAppleCalendarConnection"
  | "restorePendingNotificationForSession" | "detachNotificationOwnerForCleanup"
  | "persistPendingNotificationDestination" | "clearAuthenticatedMemory" | "reportCleanupResult"
  | "persistGoogleCalendarConnection" | "runAbortableGoogleCleanup" | "queueGoogleSignOut"
> & Pick<ApplicationState,
  "accountCleanupInProgressRef" | "setPendingVerification" | "activationAttemptRef"
  | "googleSdkEpochRef" | "googleLifecycleGuardRef" | "accountGuardRef" | "setSessionOwner"
  | "onboardingOwnerRef" | "onboardingSaveAttemptRef" | "routeIntentCoordinatorRef"
  | "pendingDeepLinkRouteRef" | "refreshSessionPromiseRef" | "notificationNavigationRequestRef"
  | "clearNavigationRequest" | "setAuthenticatedContextPending" | "setCleanupIssue"
  | "setGoogleCalendarIntegration" | "setAppleCalendarStoredState" | "setAppleCalendarState"
  | "setAppleCalendarError" | "sessionRef" | "notificationCoordinatorOwnerTokenRef"
  | "setAccountAuthProvider" | "setSession" | "setActiveTab" | "setActiveRoute" | "setBusy"
  | "setHydrationError" | "setHydrationStatus" | "setMessage"
> & Pick<PersonalCalendarRuntime,
  "personalExamRuntime"
>;

export function createSessionActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "persistSession" | "persistPendingVerification" | "clearPendingVerification"
  | "invalidateAuthenticatedWork" | "activateSession" | "clearExpiredSession"
> {
  const {
    enqueueStorageMutation,
    accountCleanupInProgressRef,
    setPendingVerification,
    activationAttemptRef,
    googleSdkEpochRef,
    googleLifecycleGuardRef,
    accountGuardRef,
    setSessionOwner,
    onboardingOwnerRef,
    onboardingSaveAttemptRef,
    routeIntentCoordinatorRef,
    pendingDeepLinkRouteRef,
    abortAuthenticatedRequests,
    refreshSessionPromiseRef,
    notificationNavigationRequestRef,
    clearNavigationRequest,
    setAuthenticatedContextPending,
    waitForAppleCalendarNativeMutation,
    waitForAuthenticatedMutations,
    resetUserScopedState,
    setCleanupIssue,
    restoreManualExams,
    personalExamRuntime,
    restoreGoogleCalendarConnection,
    setGoogleCalendarIntegration,
    restoreAppleCalendarConnection,
    setAppleCalendarStoredState,
    setAppleCalendarState,
    setAppleCalendarError,
    sessionRef,
    notificationCoordinatorOwnerTokenRef,
    setAccountAuthProvider,
    setSession,
    setActiveTab,
    setActiveRoute,
    restorePendingNotificationForSession,
    setBusy,
    detachNotificationOwnerForCleanup,
    persistPendingNotificationDestination,
    clearAuthenticatedMemory,
    reportCleanupResult,
    setHydrationError,
    setHydrationStatus,
    persistGoogleCalendarConnection,
    runAbortableGoogleCleanup,
    queueGoogleSignOut,
    setMessage
  } = dependencies;

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
    abortAuthenticatedRequests();
    await waitForAppleCalendarNativeMutation();
    await waitForAuthenticatedMutations();
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
      await restoreAppleCalendarConnection(nextSession.user.id, snapshot);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) throw error;
      setAppleCalendarStoredState({ mappings: {} });
      setAppleCalendarState("error");
      setAppleCalendarError("Apple Takvim bağlantısı cihazdan okunamadı.");
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
    abortAuthenticatedRequests();
    await waitForAppleCalendarNativeMutation();
    invalidateAuthenticatedWork();
    const sessionStorageResult = await runObservableAccountCleanup([
      { target: "session_storage", run: () => persistSession(null) }
    ]);
    if (!sessionStorageResult.complete) {
      const emergencyResult = await runObservableAccountCleanup([
        { target: "device_registration", run: () => detachNotificationOwnerForCleanup() },
        { target: "pending_notification_storage", run: () => persistPendingNotificationDestination(null) },
        ...(ownerId ? [{ target: "device_content_cache" as const, run: () => deleteDeviceContentCache(ownerId) }] : []),
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
      ...(ownerId ? [{ target: "device_content_cache" as const, run: () => deleteDeviceContentCache(ownerId) }] : []),
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

  return {
    persistSession,
    persistPendingVerification,
    clearPendingVerification,
    invalidateAuthenticatedWork,
    activateSession,
    clearExpiredSession
  };
}
