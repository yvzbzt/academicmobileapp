import { AUTH_ENDPOINTS, createPendingVerificationRecord } from "../../auth/auth-recovery";
import { normalizeAccountAuthProvider } from "../../auth/recent-authentication";
import {
  isVerificationCodeComplete,
  EMPTY_ACADEMIC_ONBOARDING_DRAFT,
  buildAcademicSelectionPayload,
} from "../../auth/auth-ui";
import { profileDraftFromServer } from "../../profile/profile-model";
import { type RegisterResponse, type SessionPayload, type UserProfile } from "../app-types";
import { ApiRequestError, userMessageFromError, StaleAccountRequestError } from "../app-errors";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";
import type { ApplicationActions } from "../application-actions";

type Dependencies = Pick<ApplicationState,
  "authOperationInProgressRef" | "accountCleanupInProgressRef" | "email" | "setMessage" | "setBusy"
  | "setPendingVerification" | "setVerificationToken" | "setCleanupIssue" | "pendingVerification"
  | "verificationToken" | "deviceIdRef" | "setRegisterUniversityId" | "setRegisterFacultyId"
  | "setRegisterDepartmentId" | "setRegisterClassLevel" | "setOnboardingInitialDraft" | "password"
  | "setAuthMode" | "setAuthStage" | "setPassword" | "sessionRef" | "setHydrationError"
  | "setHydrationStatus" | "setAuthenticatedContextPending" | "accountGuardRef"
  | "onboardingOwnerRef" | "onboardingSaveAttemptRef" | "setSelectedUniversityId" | "setFullName"
  | "setEmail" | "setAccountAuthProvider" | "setActiveTab" | "setActiveRoute"
  | "setRegistrationPasswordConfirmation" | "setPasswordVisible" | "setPasswordRecoveryCode"
  | "setNewPassword" | "setPasswordConfirmation" | "setNewPasswordVisible"
  | "setPasswordConfirmationVisible" | "setPendingPasswordRecovery" | "setPasswordRecoveryFeedback"
  | "setRegisterPicker"
> & Pick<ApplicationDerivedState,
  "verificationTiming" | "academicOnboardingDraft"
> & Pick<ApplicationActions,
  "apiRequest" | "persistPendingVerification" | "activateSession" | "bootstrapAuthenticatedContext"
  | "trackAuthenticatedMutation" | "warmAuthenticatedContext"
>;

export function createVerificationActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "resendVerificationEmail" | "handleVerifyEmail" | "saveAcademicOnboarding"
  | "skipAcademicOnboarding" | "openVerificationRecovery" | "returnToLoginForm"
> {
  const {
    authOperationInProgressRef,
    accountCleanupInProgressRef,
    email,
    setMessage,
    verificationTiming,
    setBusy,
    apiRequest,
    setPendingVerification,
    setVerificationToken,
    persistPendingVerification,
    setCleanupIssue,
    pendingVerification,
    verificationToken,
    deviceIdRef,
    setRegisterUniversityId,
    setRegisterFacultyId,
    setRegisterDepartmentId,
    setRegisterClassLevel,
    setOnboardingInitialDraft,
    password,
    setAuthMode,
    setAuthStage,
    activateSession,
    setPassword,
    bootstrapAuthenticatedContext,
    sessionRef,
    setHydrationError,
    setHydrationStatus,
    setAuthenticatedContextPending,
    accountGuardRef,
    onboardingOwnerRef,
    academicOnboardingDraft,
    onboardingSaveAttemptRef,
    trackAuthenticatedMutation,
    setSelectedUniversityId,
    setFullName,
    setEmail,
    setAccountAuthProvider,
    setActiveTab,
    setActiveRoute,
    warmAuthenticatedContext,
    setRegistrationPasswordConfirmation,
    setPasswordVisible,
    setPasswordRecoveryCode,
    setNewPassword,
    setPasswordConfirmation,
    setNewPasswordVisible,
    setPasswordConfirmationVisible,
    setPendingPasswordRecovery,
    setPasswordRecoveryFeedback,
    setRegisterPicker
  } = dependencies;

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
      setMessage({ text: "Altı haneli doğrulama kodunu eksiksiz gir.", tone: "error" });
      return;
    }

    const currentDeviceId = deviceIdRef.current;
    if (!currentDeviceId) {
      setMessage({ text: "Cihaz kimliği henüz hazır değil.", tone: "error" });
      return;
    }

    authOperationInProgressRef.current = true;
    let verificationCompleted = false;
    try {
      setBusy(true);
      const normalizedEmail = email.trim().toLowerCase();
      await apiRequest<{ status: "verified"; email: string }>(
        AUTH_ENDPOINTS.verifyEmail,
        {
          method: "POST",
          body: JSON.stringify({
            email: normalizedEmail,
            code: verificationToken.trim(),
            deviceId: currentDeviceId
          })
        },
        undefined,
        { authOperation: "verify_email" }
      );
      verificationCompleted = true;

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
      if (!password) {
        setAuthMode("login");
        setAuthStage("auth");
        setMessage({ text: "E-posta doğrulandı. Giriş yapmak için şifreni gir.", tone: "success" });
        return;
      }

      const nextSession = await apiRequest<SessionPayload>(
        AUTH_ENDPOINTS.login,
        {
          method: "POST",
          body: JSON.stringify({
            email: normalizedEmail,
            password,
            deviceId: currentDeviceId
          })
        },
        undefined,
        { authOperation: "login" }
      );
      setAuthMode("login");
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
      if (verificationCompleted) {
        setAuthMode("login");
        setAuthStage("auth");
      }
      setMessage({
        text: userMessageFromError(
          error,
          verificationCompleted
            ? "E-posta doğrulandı ancak giriş otomatik tamamlanamadı. Şifrenle giriş yap."
            : "E-posta doğrulanamadı"
        ),
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

  return {
    resendVerificationEmail,
    handleVerifyEmail,
    saveAcademicOnboarding,
    skipAcademicOnboarding,
    openVerificationRecovery,
    returnToLoginForm
  };
}
