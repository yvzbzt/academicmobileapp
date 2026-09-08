import {
  validatePasswordRecoveryRequest,
  AUTH_ENDPOINTS,
  createPendingPasswordRecoveryRecord,
  PASSWORD_RECOVERY_CODE_LENGTH,
  validatePasswordRecoveryConfirmation,
} from "../../auth/auth-recovery";
import { type PasswordRecoveryRequestResponse, type PasswordRecoveryConfirmResponse } from "../app-types";
import { userMessageFromError, ApiRequestError } from "../app-errors";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";
import type { ApplicationActions } from "../application-actions";

type Dependencies = Pick<ApplicationState,
  "email" | "setEmail" | "setPassword" | "setPasswordVisible" | "setPasswordRecoveryCode"
  | "setNewPassword" | "setPasswordConfirmation" | "setNewPasswordVisible"
  | "setPasswordConfirmationVisible" | "setPendingPasswordRecovery" | "setPasswordRecoveryFeedback"
  | "setAuthMode" | "setAuthStage" | "authOperationInProgressRef" | "accountCleanupInProgressRef"
  | "pendingPasswordRecovery" | "setBusy" | "setPasswordRecoveryClockMs" | "passwordRecoveryCode"
  | "newPassword" | "passwordConfirmation" | "setMessage"
> & Pick<ApplicationDerivedState,
  "passwordRecoveryTiming"
> & Pick<ApplicationActions,
  "apiRequest"
>;

export function createPasswordRecoveryActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "openPasswordRecovery" | "requestPasswordRecovery" | "confirmPasswordRecovery"
  | "continuePasswordRecoveryCode" | "returnToPasswordRecoveryCode"
  | "returnToPasswordRecoveryRequest" | "cancelPasswordRecovery"
> {
  const {
    email,
    setEmail,
    setPassword,
    setPasswordVisible,
    setPasswordRecoveryCode,
    setNewPassword,
    setPasswordConfirmation,
    setNewPasswordVisible,
    setPasswordConfirmationVisible,
    setPendingPasswordRecovery,
    setPasswordRecoveryFeedback,
    setAuthMode,
    setAuthStage,
    authOperationInProgressRef,
    accountCleanupInProgressRef,
    pendingPasswordRecovery,
    passwordRecoveryTiming,
    setBusy,
    apiRequest,
    setPasswordRecoveryClockMs,
    passwordRecoveryCode,
    newPassword,
    passwordConfirmation,
    setMessage
  } = dependencies;

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

  return {
    openPasswordRecovery,
    requestPasswordRecovery,
    confirmPasswordRecovery,
    continuePasswordRecoveryCode,
    returnToPasswordRecoveryCode,
    returnToPasswordRecoveryRequest,
    cancelPasswordRecovery
  };
}
