import { Platform, InteractionManager } from "react-native";
import { runtimeDiagnostic } from "../../performance/runtime-diagnostics";
import { PENDING_VERIFICATION_STORAGE_KEY, parsePendingVerificationRecord } from "../../auth/auth-recovery";
import { type AccountCleanupTarget, type AccountGenerationSnapshot } from "../../auth/session-integrity";
import {
  PRELOGIN_WELCOME_COMPLETION_STORAGE_KEY,
  resolvePreloginWelcomeGate,
  PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE,
} from "../../auth/prelogin-welcome";
import { normalizeAccountAuthProvider } from "../../auth/recent-authentication";
import { profileDraftFromServer } from "../../profile/profile-model";
import {
  getStoredValue,
  SESSION_STORAGE_KEY,
  setStoredValue,
  SESSION_INVALIDATED_STORAGE_VALUE,
  deleteStoredValue,
  isSessionPayload,
  DEVICE_ID_STORAGE_KEY,
  createLocalId,
} from "../app-storage";
import { StaleAccountRequestError, ApiRequestError } from "../app-errors";
import { type SessionPayload, type UserProfile } from "../app-types";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationActions } from "../application-actions";
import type { PersonalCalendarRuntime } from "../usePersonalCalendarRuntime";

type Dependencies = Pick<ApplicationState,
  "hydrationInProgressRef" | "setHydrationStatus" | "setPreloginWelcomeGate" | "setHydrationError"
  | "setCleanupIssue" | "accountGuardRef" | "setSessionOwner" | "googleLifecycleGuardRef"
  | "sessionRef" | "notificationCoordinatorOwnerTokenRef" | "setAccountAuthProvider" | "setSession"
  | "setActiveTab" | "setActiveRoute" | "setGoogleCalendarIntegration"
  | "setAppleCalendarStoredState" | "setAppleCalendarState" | "setAppleCalendarError"
  | "setPendingVerification" | "setPassword" | "setVerificationToken" | "setAuthMode"
  | "setAuthStage" | "deviceIdRef" | "setDeviceId" | "setEmail" | "notificationCoordinatorRef"
  | "setMessage" | "setFullName" | "setSelectedUniversityId" | "setRegisterUniversityId"
  | "setRegisterFacultyId" | "setRegisterDepartmentId" | "setRegisterClassLevel"
  | "setOnboardingInitialDraft" | "onboardingOwnerRef" | "setAcademicProfileSaveState"
  | "setAcademicProfileSaveError"
> & Pick<ApplicationActions,
  "restoreManualExams" | "restoreGoogleCalendarConnection" | "restoreAppleCalendarConnection"
  | "clearPendingVerification" | "loadUniversities" | "restorePendingNotificationForSession"
  | "abortAuthenticatedRequests" | "ensureNotificationCoordinator" | "loadPreferences"
  | "reconcileNotificationDelivery" | "loadMyCalendar" | "loadCourseSchedule" | "loadUpcoming"
  | "loadFollowedUniversities" | "apiRequest" | "clearExpiredSession"
> & Pick<PersonalCalendarRuntime,
  "personalExamRuntime"
>;

export function createBootstrapActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "hydrateApplication" | "restoreSession" | "restoreDeviceId" | "restorePendingVerification"
  | "warmAuthenticatedContext" | "bootstrapAuthenticatedContext"
> {
  const {
    hydrationInProgressRef,
    setHydrationStatus,
    setPreloginWelcomeGate,
    setHydrationError,
    setCleanupIssue,
    accountGuardRef,
    setSessionOwner,
    googleLifecycleGuardRef,
    sessionRef,
    notificationCoordinatorOwnerTokenRef,
    setAccountAuthProvider,
    setSession,
    setActiveTab,
    setActiveRoute,
    restoreManualExams,
    personalExamRuntime,
    restoreGoogleCalendarConnection,
    setGoogleCalendarIntegration,
    restoreAppleCalendarConnection,
    setAppleCalendarStoredState,
    setAppleCalendarState,
    setAppleCalendarError,
    clearPendingVerification,
    setPendingVerification,
    setPassword,
    setVerificationToken,
    setAuthMode,
    setAuthStage,
    loadUniversities,
    restorePendingNotificationForSession,
    abortAuthenticatedRequests,
    deviceIdRef,
    setDeviceId,
    ensureNotificationCoordinator,
    setEmail,
    loadPreferences,
    notificationCoordinatorRef,
    reconcileNotificationDelivery,
    loadMyCalendar,
    loadCourseSchedule,
    loadUpcoming,
    loadFollowedUniversities,
    apiRequest,
    clearExpiredSession,
    setMessage,
    setFullName,
    setSelectedUniversityId,
    setRegisterUniversityId,
    setRegisterFacultyId,
    setRegisterDepartmentId,
    setRegisterClassLevel,
    setOnboardingInitialDraft,
    onboardingOwnerRef,
    setAcademicProfileSaveState,
    setAcademicProfileSaveError
  } = dependencies;

  async function hydrateApplication(): Promise<void> {
    if (hydrationInProgressRef.current) return;
    const hydrationDiagnosticStartedAt = Date.now();
    runtimeDiagnostic("bootstrap.start");
    hydrationInProgressRef.current = true;
    setHydrationStatus("loading");
    setPreloginWelcomeGate("loading");
    setHydrationError(null);
    setCleanupIssue(null);
    try {
      const [, storedWelcomeCompletion, storedSessionValue] = await Promise.all([
        restoreDeviceId(),
        getStoredValue(PRELOGIN_WELCOME_COMPLETION_STORAGE_KEY),
        getStoredValue(SESSION_STORAGE_KEY),
      ]);
      runtimeDiagnostic("bootstrap.storage_ready", {
        elapsedMs: Date.now() - hydrationDiagnosticStartedAt,
        hasStoredSession: Boolean(storedSessionValue),
      });
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
      let restoredSession = await restoreSession(storedSessionValue);
      const recoverableTargets: AccountCleanupTarget[] = [];

      if (restoredSession) {
        const snapshot = accountGuardRef.current.activate(restoredSession.user.id);
        setSessionOwner(snapshot);
        googleLifecycleGuardRef.current.activate(restoredSession.user.id);
        sessionRef.current = restoredSession;
        notificationCoordinatorOwnerTokenRef.current = restoredSession;
        setAccountAuthProvider(normalizeAccountAuthProvider(restoredSession.user.authProvider));
        setSession(restoredSession);
        setActiveTab("home");
        setActiveRoute("Home");
        runtimeDiagnostic("bootstrap.session_restored", {
          elapsedMs: Date.now() - hydrationDiagnosticStartedAt,
        });
      }

      let authenticatedContextReady: boolean | null = null;
      if (restoredSession) {
        const snapshot = accountGuardRef.current.capture();
        if (!snapshot) throw new StaleAccountRequestError();
        const [contextReady] = await Promise.all([
          bootstrapAuthenticatedContext(restoredSession.accessToken, snapshot),
          Promise.all([
            restoreManualExams(restoredSession.user.id, snapshot).catch((error: unknown) => {
              if (error instanceof StaleAccountRequestError) throw error;
              personalExamRuntime.reset();
              recoverableTargets.push("manual_exam_storage");
            }),
            restoreGoogleCalendarConnection(restoredSession.user.id, snapshot).catch((error: unknown) => {
              if (error instanceof StaleAccountRequestError) throw error;
              setGoogleCalendarIntegration(null);
              recoverableTargets.push("google_connection_storage");
            }),
            restoreAppleCalendarConnection(restoredSession.user.id, snapshot).catch((error: unknown) => {
              if (error instanceof StaleAccountRequestError) throw error;
              setAppleCalendarStoredState({ mappings: {} });
              setAppleCalendarState("error");
              setAppleCalendarError("Apple Takvim bağlantısı cihazdan okunamadı.");
            }),
            clearPendingVerification().catch(() => {
              recoverableTargets.push("pending_verification_storage");
            }),
          ]),
        ]);
        authenticatedContextReady = contextReady;
        runtimeDiagnostic("bootstrap.profile_ready", {
          elapsedMs: Date.now() - hydrationDiagnosticStartedAt,
          ready: contextReady,
        });
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
        await restoreAppleCalendarConnection().catch(() => {
          setAppleCalendarStoredState({ mappings: {} });
          setAppleCalendarState(Platform.OS === "ios" ? "disconnected" : "unavailable");
        });
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
          const contextReady = authenticatedContextReady
            ?? await bootstrapAuthenticatedContext(restoredSession.accessToken, snapshot);
          if (!contextReady && sessionRef.current?.user.id === restoredSession.user.id) {
            setHydrationError("Hesap bağlamı hazırlanamadı. Bağlantını kontrol edip tekrar dene.");
            setHydrationStatus("error");
            return;
          }
          if (accountGuardRef.current.isCurrent(snapshot)) {
            void restorePendingNotificationForSession(restoredSession, snapshot).catch(() => {
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
      runtimeDiagnostic("bootstrap.ready", {
        elapsedMs: Date.now() - hydrationDiagnosticStartedAt,
      });
    } catch (error) {
      runtimeDiagnostic("bootstrap.failure", {
        elapsedMs: Date.now() - hydrationDiagnosticStartedAt,
        errorType: error instanceof Error ? error.name : "unknown",
      });
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

  async function restoreSession(storedValue?: string | null): Promise<SessionPayload | null> {
    const stored = storedValue === undefined
      ? await getStoredValue(SESSION_STORAGE_KEY)
      : storedValue;
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

  function warmAuthenticatedContext(
    token: string,
    profileUniversityId: string,
    ownerSnapshot: AccountGenerationSnapshot
  ): void {
    setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;

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
            loadCourseSchedule(token, ownerSnapshot),
            loadUpcoming(token, ownerSnapshot),
            loadFollowedUniversities(token, ownerSnapshot)
          ]
          : [];

        void Promise.allSettled([preferenceWarmup(), ...contentWarmups]);
      });
    }, 1_500);
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
    const activeToken = sessionRef.current?.user.id === ownerSnapshot.ownerId
      ? sessionRef.current.accessToken
      : token;
    warmAuthenticatedContext(activeToken, profileUniversityId, ownerSnapshot);
    return accountGuardRef.current.isCurrent(ownerSnapshot);
  }

  return {
    hydrateApplication,
    restoreSession,
    restoreDeviceId,
    restorePendingVerification,
    warmAuthenticatedContext,
    bootstrapAuthenticatedContext
  };
}
