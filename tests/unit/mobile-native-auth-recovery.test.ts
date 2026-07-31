import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUTH_ENDPOINTS,
  AUTH_PASSWORD_MIN_LENGTH,
  PASSWORD_RECOVERY_CODE_LENGTH,
  createPendingPasswordRecoveryRecord,
  createPendingVerificationRecord,
  getPasswordRecoveryTiming,
  getVerificationTiming,
  parsePendingVerificationRecord,
  rootSurfaceForHydration,
  validatePasswordRecoveryConfirmation,
  validatePasswordRecoveryRequest
} from "../../apps/mobile-native/src/auth/auth-recovery";
import { classifyAuthError } from "../../apps/mobile-native/src/auth/session-integrity";
import { AUTH_PASSWORD_MIN_LENGTH as API_PASSWORD_MIN_LENGTH } from "../../apps/api/src/modules/auth/auth.constants";

describe("mobile authentication recovery contract", () => {
  it("uses the resend endpoint instead of registering the account again", () => {
    expect(AUTH_ENDPOINTS.resendVerificationCode).toBe("/auth/resend-verification-code");
    expect(AUTH_ENDPOINTS.resendVerificationCode).not.toBe(AUTH_ENDPOINTS.register);
    const appSource = readFileSync(new URL("../../apps/mobile-native/App.tsx", import.meta.url), "utf8");
    const resendHandler = appSource.slice(
      appSource.indexOf("async function resendVerificationEmail"),
      appSource.indexOf("async function handleVerifyEmail")
    );
    expect(resendHandler).toContain("AUTH_ENDPOINTS.resendVerificationCode");
    expect(resendHandler).not.toContain("AUTH_ENDPOINTS.register");
  });

  it("keeps only resumable non-secret verification state across relaunch", () => {
    const pending = createPendingVerificationRecord({
      email: " INFO@Example.com ",
      verificationExpiresAt: "2026-07-29T12:10:00.000Z",
      resendAvailableAt: "2026-07-29T12:01:00.000Z"
    });
    const restored = parsePendingVerificationRecord(JSON.stringify(pending));

    expect(restored).toEqual({
      email: "info@example.com",
      verificationExpiresAt: "2026-07-29T12:10:00.000Z",
      resendAvailableAt: "2026-07-29T12:01:00.000Z"
    });
    expect(JSON.stringify(restored)).not.toMatch(/password|token|code/i);
  });

  it("retains expiration and resend cooldown timing", () => {
    const pending = createPendingVerificationRecord({
      email: "student@example.com",
      verificationExpiresAt: "2026-07-29T12:10:00.000Z",
      resendAvailableAt: "2026-07-29T12:01:00.000Z"
    });

    expect(getVerificationTiming(pending, Date.parse("2026-07-29T12:00:30.000Z"))).toEqual({
      expired: false,
      expiresInSeconds: 570,
      resendInSeconds: 30
    });
  });

  it("never exposes Login or Home as stable surfaces while hydration is incomplete", () => {
    expect(rootSurfaceForHydration("loading", false)).toBe("hydration_loading");
    expect(rootSurfaceForHydration("loading", true)).toBe("hydration_loading");
    expect(rootSurfaceForHydration("error", true)).toBe("hydration_error");
    expect(rootSurfaceForHydration("ready", false)).toBe("login");
    expect(rootSurfaceForHydration("ready", true)).toBe("home");
  });

  it("restores the device identity before refresh and resumes verification without restoring a password", () => {
    const appSource = readFileSync(new URL("../../apps/mobile-native/App.tsx", import.meta.url), "utf8");
    const hydrationHandler = appSource.slice(
      appSource.indexOf("async function hydrateApplication"),
      appSource.indexOf("async function restoreSession")
    );
    const verificationRestore = appSource.slice(
      appSource.indexOf("async function restorePendingVerification"),
      appSource.indexOf("async function restoreManualExams")
    );

    expect(hydrationHandler.indexOf("await restoreDeviceId()"))
      .toBeLessThan(hydrationHandler.indexOf("let restoredSession = await restoreSession()"));
    expect(hydrationHandler).toContain("await restorePendingVerification()");
    expect(verificationRestore).toContain("PENDING_VERIFICATION_STORAGE_KEY");
    expect(verificationRestore).toContain('setPassword("")');
    expect(verificationRestore).toContain('setAuthStage("verify")');
  });

  it("keeps the native registration rule in parity with the API", () => {
    expect(AUTH_PASSWORD_MIN_LENGTH).toBe(API_PASSWORD_MIN_LENGTH);
    expect(AUTH_PASSWORD_MIN_LENGTH).toBe(10);

    const appSource = readFileSync(new URL("../../apps/mobile-native/App.tsx", import.meta.url), "utf8");
    expect(appSource).not.toContain("password.trim()");
    expect(appSource).toContain("password.length >= AUTH_PASSWORD_MIN_LENGTH");
    expect(appSource).toContain("passwordConfirmation: password");
  });

  it("represents verification success before the separate login attempt", () => {
    const appSource = readFileSync(new URL("../../apps/mobile-native/App.tsx", import.meta.url), "utf8");
    const verificationHandler = appSource.slice(
      appSource.indexOf("async function handleVerifyEmail"),
      appSource.indexOf("async function confirmProfileAndStart")
    );
    const loginAfterVerificationHandler = appSource.slice(
      appSource.indexOf("async function confirmProfileAndStart"),
      appSource.indexOf("async function openVerificationRecovery")
    );

    expect(verificationHandler).toContain("AUTH_ENDPOINTS.verifyEmail");
    expect(verificationHandler).not.toContain("AUTH_ENDPOINTS.login");
    expect(verificationHandler).toContain('setAuthStage("profile_confirm")');
    expect(loginAfterVerificationHandler).toContain("AUTH_ENDPOINTS.login");
    expect(loginAfterVerificationHandler).toContain("E-posta doğrulandı ancak giriş tamamlanamadı");
  });

  it("preserves the disabled-account error before generic Google 401 recovery", () => {
    const appSource = readFileSync(new URL("../../apps/mobile-native/App.tsx", import.meta.url), "utf8");
    const googleHandler = appSource.slice(
      appSource.indexOf("async function handleGoogleAuth"),
      appSource.indexOf("async function resendVerificationEmail")
    );
    const disabledAccountBranch = googleHandler.indexOf('error.code === "disabled_account"');
    const genericUnauthorizedBranch = googleHandler.indexOf("error.status === 401");

    expect(disabledAccountBranch).toBeGreaterThan(-1);
    expect(genericUnauthorizedBranch).toBeGreaterThan(disabledAccountBranch);
  });

  it("uses the complete password-recovery endpoints and six-digit backend contract", () => {
    expect(AUTH_ENDPOINTS.passwordRecoveryRequest).toBe("/auth/password-recovery/request");
    expect(AUTH_ENDPOINTS.passwordRecoveryConfirm).toBe("/auth/password-recovery/confirm");
    expect(PASSWORD_RECOVERY_CODE_LENGTH).toBe(6);

    const appSource = readFileSync(new URL("../../apps/mobile-native/App.tsx", import.meta.url), "utf8");
    const requestHandler = appSource.slice(
      appSource.indexOf("async function requestPasswordRecovery"),
      appSource.indexOf("async function confirmPasswordRecovery")
    );
    const confirmHandler = appSource.slice(
      appSource.indexOf("async function confirmPasswordRecovery"),
      appSource.indexOf("function returnToPasswordRecoveryRequest")
    );

    expect(requestHandler).toContain("AUTH_ENDPOINTS.passwordRecoveryRequest");
    expect(requestHandler).toContain('body: JSON.stringify({ email: normalizedEmail })');
    expect(confirmHandler).toContain("AUTH_ENDPOINTS.passwordRecoveryConfirm");
    expect(confirmHandler).toContain("code: passwordRecoveryCode.trim()");
    expect(confirmHandler).toContain("newPassword");
    expect(confirmHandler).toContain("passwordConfirmation");
  });

  it("keeps recovery timing in memory without putting codes or passwords in the resumable record", () => {
    const pending = createPendingPasswordRecoveryRecord({
      email: " Student@Example.com ",
      recoveryExpiresAt: "2026-07-29T12:10:00.000Z",
      resendAvailableAt: "2026-07-29T12:01:00.000Z"
    });

    expect(pending).toEqual({
      email: "student@example.com",
      recoveryExpiresAt: "2026-07-29T12:10:00.000Z",
      resendAvailableAt: "2026-07-29T12:01:00.000Z"
    });
    expect(getPasswordRecoveryTiming(pending, Date.parse("2026-07-29T12:00:30.000Z"))).toEqual({
      expired: false,
      expiresInSeconds: 570,
      resendInSeconds: 30
    });
    expect(JSON.stringify(pending)).not.toMatch(/code|password|token/i);

    const appSource = readFileSync(new URL("../../apps/mobile-native/App.tsx", import.meta.url), "utf8");
    const recoveryHandlers = appSource.slice(
      appSource.indexOf("function openPasswordRecovery"),
      appSource.indexOf("async function openVerificationRecovery")
    );
    expect(recoveryHandlers).not.toContain("setStoredValue");
    expect(recoveryHandlers).not.toContain("SecureStore");
    expect(recoveryHandlers).not.toContain("console.");
  });

  it("validates recovery email, password parity, code shape, and confirmation mismatch locally", () => {
    expect(validatePasswordRecoveryRequest("student@example.com")).toEqual({ valid: true });
    expect(validatePasswordRecoveryRequest("not-an-email")).toMatchObject({
      valid: false,
      code: "invalid_email"
    });
    expect(validatePasswordRecoveryConfirmation({
      code: "123456",
      newPassword: "1234567890",
      passwordConfirmation: "1234567890"
    })).toEqual({ valid: true });
    expect(validatePasswordRecoveryConfirmation({
      code: "12345",
      newPassword: "1234567890",
      passwordConfirmation: "1234567890"
    })).toMatchObject({ valid: false, code: "invalid_code" });
    expect(validatePasswordRecoveryConfirmation({
      code: "123456",
      newPassword: "short",
      passwordConfirmation: "short"
    })).toMatchObject({ valid: false, code: "password_too_short" });
    expect(validatePasswordRecoveryConfirmation({
      code: "123456",
      newPassword: "1234567890",
      passwordConfirmation: "different-value"
    })).toMatchObject({ valid: false, code: "password_confirmation_mismatch" });
  });

  it.each([
    ["AUTH_PASSWORD_RECOVERY_CODE_INVALID", "invalid_password_recovery_code"],
    ["AUTH_PASSWORD_RECOVERY_CODE_EXPIRED", "password_recovery_code_expired"],
    ["AUTH_PASSWORD_CONFIRMATION_MISMATCH", "password_confirmation_mismatch"],
    ["AUTH_PASSWORD_INVALID", "password_invalid"],
    ["AUTH_RATE_LIMITED", "rate_limited"]
  ] as const)("maps password-recovery error %s to controlled native state", (errorCode, expectedCode) => {
    const result = classifyAuthError({
      operation: "confirm_password_recovery",
      status: errorCode === "AUTH_RATE_LIMITED" ? 429 : 400,
      body: {
        errorCode,
        message: "private@example.com code 123456 password private-password"
      }
    });

    expect(result.code).toBe(expectedCode);
    expect(JSON.stringify(result)).not.toMatch(/private@example\.com|123456|private-password/);
  });

  it("provides reachable recovery, loading, cooldown, visibility, back, cancellation, and secret cleanup UI", () => {
    const appSource = readFileSync(new URL("../../apps/mobile-native/App.tsx", import.meta.url), "utf8");
    const navigatorSource = readFileSync(
      new URL("../../apps/mobile-native/src/navigation/AppNavigator.tsx", import.meta.url),
      "utf8"
    );
    expect(appSource).toContain('accessibilityLabel="Şifremi unuttum"');
    expect(appSource).toContain('authStage === "password_recovery_request"');
    expect(appSource).toContain('authStage === "password_recovery_confirm"');
    expect(appSource).toContain('accessibilityLabel="Altı haneli şifre sıfırlama kodu"');
    expect(appSource).toContain('maxLength={PASSWORD_RECOVERY_CODE_LENGTH}');
    expect(appSource).toContain('accessibilityLabel={newPasswordVisible ? "Yeni şifreyi gizle" : "Yeni şifreyi göster"}');
    expect(appSource).toContain('accessibilityLabel={passwordConfirmationVisible ? "Şifre tekrarını gizle" : "Şifre tekrarını göster"}');
    expect(navigatorSource).toContain('BackHandler.addEventListener("hardwareBackPress"');
    expect(navigatorSource).toContain("gestureEnabled: !navigationLocked");
    expect(appSource).toContain('case "PasswordRecoveryRequest":');
    expect(appSource).toContain("returnToPasswordRecoveryRequest()");
    expect(appSource).toContain("cancelPasswordRecovery()");
    expect(appSource).toContain("Yeni Kod İste (");
    expect(appSource).toContain("Kod isteniyor...");
    expect(appSource).toContain("Şifre yenileniyor...");

    const successCleanup = appSource.slice(
      appSource.indexOf("async function confirmPasswordRecovery"),
      appSource.indexOf("} catch (error)", appSource.indexOf("async function confirmPasswordRecovery"))
    );
    expect(successCleanup).toContain('setPasswordRecoveryCode("")');
    expect(successCleanup).toContain('setNewPassword("")');
    expect(successCleanup).toContain('setPasswordConfirmation("")');
    expect(successCleanup).toContain('setAuthMode("login")');
    expect(successCleanup).toContain('setAuthStage("auth")');
  });
});
