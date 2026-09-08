import * as AppleAuthentication from "expo-apple-authentication";
import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { Alert, Platform } from "react-native";
import { runtimeDiagnostic } from "../../performance/runtime-diagnostics";
import { AUTH_ENDPOINTS, createPendingVerificationRecord } from "../../auth/auth-recovery";
import { type SessionPayload, type RegisterResponse } from "../app-types";
import { StaleAccountRequestError, ApiRequestError, userMessageFromError } from "../app-errors";
import {
  GOOGLE_AUTH_CONFIGURED,
  GOOGLE_AUTH_CONFIGURATION_MESSAGE,
  GOOGLE_ID_TOKEN_CONFIGURATION_MESSAGE,
  createAppleAuthenticationNonce,
  APPLE_ID_TOKEN_ERROR_MESSAGE,
  APPLE_AUTH_UNAVAILABLE_MESSAGE,
} from "../app-auth-providers";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";
import type { ApplicationActions } from "../application-actions";

type Dependencies = Pick<ApplicationState,
  "accountCleanupInProgressRef" | "authOperationInProgressRef" | "setMessage" | "authMode"
  | "deviceIdRef" | "email" | "setBusy" | "password" | "setAuthStage" | "setPassword" | "sessionRef"
  | "setHydrationError" | "setHydrationStatus" | "setAuthenticatedContextPending" | "fullName"
  | "registrationPasswordConfirmation" | "setPendingVerification"
  | "setRegistrationPasswordConfirmation" | "setRegisterPicker" | "setVerificationToken"
  | "setCleanupIssue" | "deviceId" | "setGoogleBusy" | "appleAvailable" | "setAppleBusy"
> & Pick<ApplicationDerivedState,
  "registrationValidation" | "loginValidation"
> & Pick<ApplicationActions,
  "apiRequest" | "activateSession" | "bootstrapAuthenticatedContext" | "persistPendingVerification"
  | "openVerificationRecovery" | "enqueueGoogleSdkOperation" | "queueGoogleSignOut"
>;

export function createAuthActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "handleAuth" | "handleGoogleAuth" | "requestAppleCredential" | "handleAppleAuth"
> {
  const {
    accountCleanupInProgressRef,
    authOperationInProgressRef,
    setMessage,
    authMode,
    registrationValidation,
    loginValidation,
    deviceIdRef,
    email,
    setBusy,
    apiRequest,
    password,
    setAuthStage,
    activateSession,
    setPassword,
    bootstrapAuthenticatedContext,
    sessionRef,
    setHydrationError,
    setHydrationStatus,
    setAuthenticatedContextPending,
    fullName,
    registrationPasswordConfirmation,
    setPendingVerification,
    setRegistrationPasswordConfirmation,
    setRegisterPicker,
    setVerificationToken,
    persistPendingVerification,
    setCleanupIssue,
    openVerificationRecovery,
    deviceId,
    setGoogleBusy,
    enqueueGoogleSdkOperation,
    queueGoogleSignOut,
    appleAvailable,
    setAppleBusy
  } = dependencies;

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
    const normalizedEmail = email.trim().toLowerCase();
    authOperationInProgressRef.current = true;
    try {
      setBusy(true);
      if (!isRegister) {
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
            email: normalizedEmail,
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
    runtimeDiagnostic("google_auth.start", {
      platform: Platform.OS,
      configured: GOOGLE_AUTH_CONFIGURED,
      deviceReady: Boolean(deviceId),
    });
    if (accountCleanupInProgressRef.current || authOperationInProgressRef.current) {
      runtimeDiagnostic("google_auth.blocked", { reason: "operation_in_progress" });
      setMessage({ text: "Başka bir hesap işlemi tamamlanıyor. Lütfen kısa bir süre bekle.", tone: "info" });
      return;
    }
    if (!GOOGLE_AUTH_CONFIGURED) {
      runtimeDiagnostic("google_auth.blocked", { reason: "configuration_missing" });
      setMessage({ text: GOOGLE_AUTH_CONFIGURATION_MESSAGE, tone: "error" });
      return;
    }
    if (!deviceId) {
      runtimeDiagnostic("google_auth.blocked", { reason: "device_id_pending" });
      setMessage({ text: "Cihaz kimliği henüz hazır değil.", tone: "error" });
      return;
    }

    authOperationInProgressRef.current = true;
    try {
      setGoogleBusy(true);
      const nativeAuth = await enqueueGoogleSdkOperation(async () => {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        runtimeDiagnostic("google_auth.play_services_ready");
        const result = await GoogleSignin.signIn();
        if (isCancelledResponse(result)) {
          runtimeDiagnostic("google_auth.native_result", { cancelled: true, hasIdToken: false });
          return { cancelled: true as const, idToken: null };
        }

        let idToken = result.data.idToken;
        if (!idToken) {
          try {
            idToken = (await GoogleSignin.getTokens()).idToken;
          } catch {
            idToken = null;
          }
        }
        runtimeDiagnostic("google_auth.native_result", {
          cancelled: false,
          hasIdToken: Boolean(idToken),
        });
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
      runtimeDiagnostic("google_auth.success");
    } catch (error) {
      runtimeDiagnostic("google_auth.failure", {
        kind: error instanceof ApiRequestError
          ? "api"
          : isErrorWithCode(error)
            ? "native_sdk"
            : "unknown",
        code: error instanceof ApiRequestError
          ? error.code
          : isErrorWithCode(error)
            ? String(error.code)
            : undefined,
        status: error instanceof ApiRequestError ? error.status : undefined,
      });
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

  async function requestAppleCredential(requestProfile: boolean): Promise<{
    identityToken: string;
    nonce: string;
    fullName?: string;
  }> {
    const nonce = await createAppleAuthenticationNonce();
    const credential = await AppleAuthentication.signInAsync({
      nonce,
      state: nonce,
      requestedScopes: requestProfile
        ? [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ]
        : [],
    });
    if (credential.state !== nonce) throw new Error("APPLE_AUTH_STATE_MISMATCH");
    if (!credential.identityToken) throw new Error(APPLE_ID_TOKEN_ERROR_MESSAGE);
    const fullName = credential.fullName
      ? AppleAuthentication.formatFullName(credential.fullName).trim()
      : "";
    return {
      identityToken: credential.identityToken,
      nonce,
      ...(fullName ? { fullName } : {}),
    };
  }

  async function handleAppleAuth(): Promise<void> {
    if (accountCleanupInProgressRef.current || authOperationInProgressRef.current) {
      setMessage({ text: "Başka bir hesap işlemi tamamlanıyor. Lütfen kısa bir süre bekle.", tone: "info" });
      return;
    }
    if (!appleAvailable) {
      setMessage({ text: APPLE_AUTH_UNAVAILABLE_MESSAGE, tone: "error" });
      return;
    }
    if (!deviceId) {
      setMessage({ text: "Cihaz kimliği henüz hazır değil.", tone: "error" });
      return;
    }

    authOperationInProgressRef.current = true;
    try {
      setAppleBusy(true);
      const credential = await requestAppleCredential(true);
      const nextSession = await apiRequest<SessionPayload>(
        "/auth/apple",
        {
          method: "POST",
          body: JSON.stringify({
            identityToken: credential.identityToken,
            nonce: credential.nonce,
            deviceId: deviceIdRef.current,
            ...(credential.fullName ? { fullName: credential.fullName } : {}),
          }),
        },
        undefined,
        { authOperation: "apple_sign_in" },
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
      if (isErrorWithCode(error) && error.code === "ERR_REQUEST_CANCELED") {
        setMessage({ text: "Apple girişi tamamlanmadan kapatıldı.", tone: "info" });
        return;
      }
      setMessage({
        text: userMessageFromError(error, "Apple girişi tamamlanamadı"),
        tone: "error",
      });
    } finally {
      authOperationInProgressRef.current = false;
      setAuthenticatedContextPending(false);
      setAppleBusy(false);
    }
  }

  return {
    handleAuth,
    handleGoogleAuth,
    requestAppleCredential,
    handleAppleAuth
  };
}
