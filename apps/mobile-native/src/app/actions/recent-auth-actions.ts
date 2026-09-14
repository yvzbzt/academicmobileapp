import { GoogleSignin, isCancelledResponse } from "@react-native-google-signin/google-signin";
import { Alert } from "react-native";
import {
  type AccountGenerationSnapshot,
  runObservableAccountCleanup,
  type AccountCleanupResult,
} from "../../auth/session-integrity";
import {
  type DestructiveAccountAction,
  type RecentAuthenticationMethod,
  recentAuthenticationPurpose,
  readRecentAuthenticationResponse,
  recentAuthenticationFailureMessage,
  recentAuthenticationHeader,
} from "../../auth/recent-authentication";
import { createManualExamStorageKey } from "../../session-integrity/manual-exam-storage";
import { deleteDeviceContentCache } from "../../content/device-content-cache";
import { deleteDeviceContentNotificationLedger } from "../../content/device-content-notification-ledger";
import { deleteDeviceSavedContent } from "../../content/device-saved-content";
import {
  GOOGLE_AUTH_CONFIGURED,
  GOOGLE_AUTH_CONFIGURATION_MESSAGE,
  clearGoogleAccountSelection,
  GOOGLE_ID_TOKEN_CONFIGURATION_MESSAGE,
  APPLE_AUTH_UNAVAILABLE_MESSAGE,
} from "../app-auth-providers";
import { type SessionPayload } from "../app-types";
import { StaleAccountRequestError, ApiRequestError, userMessageFromError } from "../app-errors";
import { deleteStoredValue } from "../app-storage";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationActions } from "../application-actions";
import type { PersonalCalendarRuntime } from "../usePersonalCalendarRuntime";

type Dependencies = Pick<ApplicationState,
  "recentAuthBusy" | "recentAuthAction" | "setRecentAuthAction" | "setRecentAuthPassword"
  | "setRecentAuthError" | "recentAuthReturnFocusRequestRef" | "setRecentAuthReturnFocus"
  | "sessionRef" | "accountCleanupInProgressRef" | "appleAvailable" | "accountGuardRef"
  | "recentAuthPassword" | "setRecentAuthBusy" | "session" | "googleCalendarIntegration" | "setBusy"
  | "setPendingVerification" | "setSessionOwner" | "onboardingOwnerRef" | "setAuthStage"
  | "googleLifecycleGuardRef" | "notificationCoordinatorRef" | "setMessage"
> & Pick<ApplicationActions,
  "enqueueGoogleSdkOperation" | "requestAppleCredential" | "apiRequest"
  | "readStoredGoogleCalendarConnection" | "abortAuthenticatedRequests"
  | "waitForAppleCalendarNativeMutation" | "waitForAuthenticatedMutations"
  | "invalidateAuthenticatedWork" | "resetUserScopedState" | "detachNotificationOwnerForCleanup"
  | "persistPendingNotificationDestination" | "removeAppleManagedEventsForDeletion"
  | "runAbortableGoogleCleanup" | "removeGoogleManagedEventsForDeletion"
  | "revokeGoogleCalendarAccessForConnection" | "persistPendingVerification"
  | "enqueueStorageMutation" | "persistGoogleCalendarConnection" | "queueGoogleSignOut"
  | "reportCleanupResult" | "persistSession" | "clearAuthenticatedMemory"
> & Pick<PersonalCalendarRuntime,
  "personalCalendarReminderCoordinator" | "personalExamRuntime"
>;

export function createRecentAuthActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "dismissRecentAuthentication" | "beginRecentAuthentication"
  | "freshGoogleIdTokenForRecentAuthentication" | "freshAppleCredentialForRecentAuthentication"
  | "requestRecentAuthenticationProof" | "submitRecentAuthentication" | "confirmDeleteMyData"
  | "deleteMyData" | "confirmDeleteAccount" | "deleteAccount"
> {
  const {
    recentAuthBusy,
    recentAuthAction,
    setRecentAuthAction,
    setRecentAuthPassword,
    setRecentAuthError,
    recentAuthReturnFocusRequestRef,
    setRecentAuthReturnFocus,
    sessionRef,
    accountCleanupInProgressRef,
    enqueueGoogleSdkOperation,
    appleAvailable,
    requestAppleCredential,
    accountGuardRef,
    apiRequest,
    recentAuthPassword,
    setRecentAuthBusy,
    session,
    googleCalendarIntegration,
    readStoredGoogleCalendarConnection,
    setBusy,
    abortAuthenticatedRequests,
    waitForAppleCalendarNativeMutation,
    waitForAuthenticatedMutations,
    invalidateAuthenticatedWork,
    resetUserScopedState,
    setPendingVerification,
    setSessionOwner,
    onboardingOwnerRef,
    setAuthStage,
    googleLifecycleGuardRef,
    detachNotificationOwnerForCleanup,
    persistPendingNotificationDestination,
    removeAppleManagedEventsForDeletion,
    runAbortableGoogleCleanup,
    removeGoogleManagedEventsForDeletion,
    revokeGoogleCalendarAccessForConnection,
    persistPendingVerification,
    enqueueStorageMutation,
    personalCalendarReminderCoordinator,
    persistGoogleCalendarConnection,
    queueGoogleSignOut,
    notificationCoordinatorRef,
    personalExamRuntime,
    reportCleanupResult,
    setMessage,
    persistSession,
    clearAuthenticatedMemory
  } = dependencies;

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

  async function freshAppleCredentialForRecentAuthentication(): Promise<{
    identityToken: string;
    nonce: string;
  }> {
    if (!appleAvailable) throw new Error(APPLE_AUTH_UNAVAILABLE_MESSAGE);
    return requestAppleCredential(false);
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
      : method === "google"
        ? { method, purpose, idToken: await freshGoogleIdTokenForRecentAuthentication() }
        : { method, purpose, ...await freshAppleCredentialForRecentAuthentication() };
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
        const controlledMessage = error instanceof ApiRequestError
          ? recentAuthenticationFailureMessage(method, error.code)
          : undefined;
        setRecentAuthError(
          controlledMessage
          ?? userMessageFromError(error, "Kimliğin doğrulanamadı. Tekrar deneyebilirsin."),
        );
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
      "Okul seçimin, bildirim tercihlerin, cihaz bildirim kaydın, kişisel alarm ve sınav verilerin silinir. Google ve Apple Takvim'e bu uygulamanın eklediği doğrulanmış kayıtlar temizlenir; kişisel etkinliklerin korunur. Hesabın açık kalır.",
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
      abortAuthenticatedRequests();
      await waitForAppleCalendarNativeMutation();
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
          target: "apple_managed_events",
          run: () => removeAppleManagedEventsForDeletion(currentSession.user.id)
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
          run: () => Promise.all([
            enqueueStorageMutation(() => deleteStoredValue(createManualExamStorageKey(currentSession.user.id))),
            personalCalendarReminderCoordinator.cancelOwner(currentSession.user.id)
          ]).then(() => undefined)
        },
        {
          target: "device_content_cache",
          run: () => Promise.all([
            deleteDeviceContentCache(currentSession.user.id),
            deleteDeviceContentNotificationLedger(currentSession.user.id),
            deleteDeviceSavedContent(currentSession.user.id),
          ]).then(() => undefined)
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
      "Hesabın kapatılır; cihaz bildirim kaydı ile Google ve Apple Takvim'e bu uygulamanın eklediği doğrulanmış kayıtlar temizlenmeye çalışılır. Kişisel takvim etkinliklerine dokunulmaz. Bu işlem geri alınamaz.",
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
    abortAuthenticatedRequests();
    await waitForAppleCalendarNativeMutation();
    await waitForAuthenticatedMutations();
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
        target: "apple_managed_events",
        run: () => removeAppleManagedEventsForDeletion(ownerId)
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
        run: () => Promise.all([
          enqueueStorageMutation(() => deleteStoredValue(createManualExamStorageKey(ownerId))),
          personalCalendarReminderCoordinator.cancelOwner(ownerId)
        ]).then(() => undefined)
      },
      {
        target: "device_content_cache",
        run: () => Promise.all([
          deleteDeviceContentCache(ownerId),
          deleteDeviceContentNotificationLedger(ownerId),
          deleteDeviceSavedContent(ownerId),
        ]).then(() => undefined)
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

  return {
    dismissRecentAuthentication,
    beginRecentAuthentication,
    freshGoogleIdTokenForRecentAuthentication,
    freshAppleCredentialForRecentAuthentication,
    requestRecentAuthenticationProof,
    submitRecentAuthentication,
    confirmDeleteMyData,
    deleteMyData,
    confirmDeleteAccount,
    deleteAccount
  };
}
