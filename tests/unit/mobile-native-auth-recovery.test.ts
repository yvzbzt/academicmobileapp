import { readFileSync } from "node:fs";
import { functionSource, sourceBetween } from "../../apps/mobile-native/tests/helpers/source-inspection";
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
import {
  EMAIL_VERIFICATION_CODE_LENGTH,
  isPasswordRecoveryCodeComplete,
  isVerificationCodeComplete,
  maskEmail,
  normalizeNumericCode,
  validateRegistrationForm
} from "../../apps/mobile-native/src/auth/auth-ui";
import { classifyAuthError } from "../../apps/mobile-native/src/auth/session-integrity";
import { AUTH_PASSWORD_MIN_LENGTH as API_PASSWORD_MIN_LENGTH } from "../../apps/api/src/modules/auth/auth.constants";

describe("mobile authentication recovery contract", () => {
  it("uses the resend endpoint instead of registering the account again", () => {
    expect(AUTH_ENDPOINTS.resendVerificationCode).toBe("/auth/resend-verification-code");
    expect(AUTH_ENDPOINTS.resendVerificationCode).not.toBe(AUTH_ENDPOINTS.register);
    const resendHandler = functionSource(applicationModule("actions/verification-actions.ts"), "resendVerificationEmail");
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
    const hydrationHandler = functionSource(applicationModule("actions/bootstrap-actions.ts"), "hydrateApplication");
    const verificationRestore = functionSource(applicationModule("actions/bootstrap-actions.ts"), "restorePendingVerification");

    expect(hydrationHandler).toContain("const [, storedWelcomeCompletion, storedSessionValue] = await Promise.all([");
    expect(hydrationHandler.indexOf("restoreDeviceId()"))
      .toBeLessThan(hydrationHandler.indexOf("let restoredSession = await restoreSession(storedSessionValue)"));
    expect(hydrationHandler).toContain("await restorePendingVerification()");
    expect(verificationRestore).toContain("PENDING_VERIFICATION_STORAGE_KEY");
    expect(verificationRestore).toContain('setPassword("")');
    expect(verificationRestore).toContain('setAuthStage("verify")');
  });

  it("keeps the native registration rule in parity with the API", () => {
    expect(AUTH_PASSWORD_MIN_LENGTH).toBe(API_PASSWORD_MIN_LENGTH);
    expect(AUTH_PASSWORD_MIN_LENGTH).toBe(8);
    expect(validateRegistrationForm({
      fullName: "Student Example",
      email: "student@example.com",
      password: "Abcdef12",
      passwordConfirmation: "Abcdef12"
    })).toMatchObject({
      valid: true,
      requirements: { minimumLength: true, characterGroupCount: 3, characterGroupsComplete: true, confirmationMatches: true }
    });
    expect(validateRegistrationForm({
      fullName: "Student Example",
      email: "student@example.com",
      password: "Abcdef12",
      passwordConfirmation: "different-password"
    })).toMatchObject({
      valid: false,
      errors: { passwordConfirmation: expect.any(String) },
      requirements: { minimumLength: true, confirmationMatches: false }
    });

    const authHandler = functionSource(applicationModule("actions/auth-actions.ts"), "handleAuth");
    expect(authHandler).not.toContain("password.trim()");
    expect(authHandler).toContain('authMode === "register" ? registrationValidation : loginValidation');
    expect(authHandler).toContain("passwordConfirmation: registrationPasswordConfirmation");
    expect(authHandler).not.toContain("passwordConfirmation: password");
  });

  it("auto logs in after verification when the registration password is still in memory", () => {
    const appSource = applicationModule("useApplicationDerivedState.ts");
    const verificationHandler = functionSource(applicationModule("actions/verification-actions.ts"), "handleVerifyEmail");
    const onboardingHandler = functionSource(applicationModule("actions/verification-actions.ts"), "saveAcademicOnboarding");
    const rootSurfaceRouting = sourceBetween(applicationModule("useApplicationDerivedState.ts"), "const navigatorRootSurface", "const googleCalendarLive");
    const authenticatedInvalidation = functionSource(applicationModule("actions/session-actions.ts"), "invalidateAuthenticatedWork");
    const authenticatedMemoryClear = functionSource(applicationModule("actions/account-cleanup-actions.ts"), "clearAuthenticatedMemory");

    expect(verificationHandler).toContain("AUTH_ENDPOINTS.verifyEmail");
    expect(verificationHandler).toContain("AUTH_ENDPOINTS.login");
    expect(verificationHandler).toContain("activateSession(nextSession)");
    expect(verificationHandler).toContain("bootstrapAuthenticatedContext(nextSession.accessToken, snapshot)");
    expect(verificationHandler).not.toContain('"/me/university"');
    expect(verificationHandler).toContain('setAuthMode("login")');
    expect(verificationHandler).toContain('setAuthStage("auth")');
    expect(verificationHandler).not.toContain('setAuthStage("academic_onboarding")');

    const sessionCheck = onboardingHandler.indexOf("!activeSession");
    const draftOwnerCheck = onboardingHandler.indexOf("!draftOwner");
    const ownerGenerationCheck = onboardingHandler.indexOf("draftOwner.generation !== snapshot.generation");
    const payloadBuild = onboardingHandler.indexOf("buildAcademicSelectionPayload(academicOnboardingDraft)");
    const universityPatch = onboardingHandler.indexOf('"/me/university"');
    const authoritativeProfile = onboardingHandler.indexOf("profileDraftFromServer(savedProfile)");
    const onboardingOwnerRelease = onboardingHandler.indexOf("onboardingOwnerRef.current = null");
    const contextGateRelease = onboardingHandler.indexOf("setAuthenticatedContextPending(false)");
    const returnToAuth = onboardingHandler.indexOf('setAuthStage("auth")');
    const contextWarmup = onboardingHandler.indexOf("warmAuthenticatedContext(activeSession.accessToken");
    expect(sessionCheck).toBeGreaterThan(-1);
    expect(draftOwnerCheck).toBeGreaterThan(sessionCheck);
    expect(ownerGenerationCheck).toBeGreaterThan(draftOwnerCheck);
    expect(payloadBuild).toBeGreaterThan(ownerGenerationCheck);
    expect(onboardingHandler).not.toContain("AUTH_ENDPOINTS.login");
    expect(onboardingHandler).not.toContain("activateSession(activeSession)");
    expect(universityPatch).toBeGreaterThan(payloadBuild);
    expect(authoritativeProfile).toBeGreaterThan(universityPatch);
    expect(onboardingOwnerRelease).toBeGreaterThan(authoritativeProfile);
    expect(contextGateRelease).toBeGreaterThan(onboardingOwnerRelease);
    expect(returnToAuth).toBeGreaterThan(contextGateRelease);
    expect(contextWarmup).toBeGreaterThan(returnToAuth);
    expect(onboardingHandler).not.toContain("await bootstrapAuthenticatedContext");
    expect(onboardingHandler.match(/"\/me\/university"/gu)).toHaveLength(1);
    expect(onboardingHandler).toContain('method: "PATCH"');
    expect(onboardingHandler).toContain("body: JSON.stringify(payload)");
    expect(onboardingHandler).toContain("{ ownerSnapshot: snapshot }");
    expect(onboardingHandler).toContain("const onboardingAttempt = ++onboardingSaveAttemptRef.current");
    expect(onboardingHandler).toContain("onboardingSaveAttemptRef.current !== onboardingAttempt");
    expect(authenticatedInvalidation).toContain("onboardingOwnerRef.current = null");
    expect(authenticatedInvalidation).toContain("onboardingSaveAttemptRef.current += 1");
    expect(authenticatedMemoryClear).toContain("authOperationInProgressRef.current = false");

    expect(appSource).toContain("const rootRouteResolution = resolveRootRoute({");
    expect(appSource).toContain("sessionOwner: session ? sessionOwner : null");
    expect(appSource).toContain("currentOwner: currentRouteOwner");
    expect(rootSurfaceRouting).toContain('rootRouteResolution.surface === "onboarding"');
  });

  it("releases authenticated routing after the mandatory profile and warms data recoverably", () => {
    const warmup = functionSource(applicationModule("actions/bootstrap-actions.ts"), "warmAuthenticatedContext");
    const bootstrap = functionSource(applicationModule("actions/bootstrap-actions.ts"), "bootstrapAuthenticatedContext");

    expect(warmup).toContain("void Promise.allSettled");
    expect(warmup).toContain("loadPreferences(token, ownerSnapshot)");
    expect(warmup).toContain("loadMyCalendar(token, ownerSnapshot)");
    expect(warmup).toContain("loadCourseSchedule(token, ownerSnapshot)");
    expect(warmup).toContain("loadUpcoming(token, ownerSnapshot)");
    expect(warmup).toContain("loadFollowedUniversities(token, ownerSnapshot)");
    expect(warmup).not.toContain("loadAnnouncements(token, profileUniversityId, ownerSnapshot)");
    expect(bootstrap).toContain('apiRequest<UserProfile>("/me"');
    expect(bootstrap).toContain('setAuthStage(profileUniversityId ? "auth" : "academic_onboarding")');
    expect(bootstrap).toContain("warmAuthenticatedContext(activeToken, profileUniversityId, ownerSnapshot)");
    expect(bootstrap).toContain("sessionRef.current.accessToken");
    expect(bootstrap).not.toContain("await loadMyCalendar");
    expect(bootstrap).not.toContain("await loadUpcoming");
    expect(bootstrap).not.toContain("await loadAnnouncements");
  });

  it("gates protected continuation until the activated owner context is ready", () => {
    const appSource = applicationModule("useApplicationDerivedState.ts");
    const navigatorSource = readFileSync(
      new URL("../../apps/mobile-native/src/navigation/AppNavigator.tsx", import.meta.url),
      "utf8"
    );
    const activationHandler = functionSource(applicationModule("actions/session-actions.ts"), "activateSession");
    const loginHandler = functionSource(applicationModule("actions/auth-actions.ts"), "handleAuth");
    const rootSurfaceRouting = sourceBetween(applicationModule("useApplicationDerivedState.ts"), "const navigatorRootSurface", "const googleCalendarLive");
    const requestEffectStart = navigatorSource.indexOf("if (!request) {");
    const requestEffect = navigatorSource.slice(
      requestEffectStart,
      navigatorSource.indexOf("useEffect(() => {", requestEffectStart)
    );
    const requestRootMatching = navigatorSource.slice(
      navigatorSource.indexOf("function requestMatchesRootSurface"),
      navigatorSource.indexOf("function isVisibleRoute")
    );

    const gateActivation = activationHandler.indexOf("setAuthenticatedContextPending(true)");
    const sessionExposure = activationHandler.indexOf("setSession(nextSession)");
    expect(gateActivation).toBeGreaterThan(-1);
    expect(sessionExposure).toBeGreaterThan(gateActivation);
    expect(activationHandler).not.toContain("setAuthenticatedContextPending(false)");

    const loginActivation = loginHandler.indexOf("await activateSession(nextSession)");
    const loginBootstrap = loginHandler.indexOf("await bootstrapAuthenticatedContext(nextSession.accessToken, snapshot)");
    const loginGateRelease = loginHandler.indexOf("setAuthenticatedContextPending(false)");
    expect(loginBootstrap).toBeGreaterThan(loginActivation);
    expect(loginGateRelease).toBeGreaterThan(loginBootstrap);

    expect(appSource.indexOf("const rootRouteResolution = resolveRootRoute({"))
      .toBeLessThan(appSource.indexOf("const navigatorRootSurface"));
    expect(rootSurfaceRouting).toContain("authenticatedContextPending");
    expect(rootSurfaceRouting).toContain('? "hydration_loading"');
    expect(requestRootMatching).toContain('return surface === "authenticated";');
    expect(requestEffect).toContain("!requestMatchesRootSurface(request.route, rootSurface)");
    expect(requestEffect).toContain("pendingRequestRef.current = { key: request.key, expectedLeaf }");
    expect(requestEffect).not.toContain("onRequestHandled?.(request.key)");
    expect(navigatorSource).toContain("acknowledgeVisibleRequest(leaf)");
  });

  it("keeps Phase 1 cleanup retry UI ahead of every auth and onboarding screen", () => {
    const feedbackSource = readFileSync(
      new URL("../../apps/mobile-native/src/design-system/primitives/Feedback.tsx", import.meta.url),
      "utf8"
    );
    const cleanupRenderer = functionSource(applicationModule("screens/auth-screens.tsx"), "renderCleanupIssue");
    const routedScreens = functionSource(applicationModule("screens/auth-screens.tsx"), "renderRoutedScreen");
    const authAndOnboardingBoundary = routedScreens;

    expect(cleanupRenderer).toContain("if (!cleanupIssue) return null;");
    expect(cleanupRenderer).toContain("<Banner");
    expect(cleanupRenderer).toContain(
      'title={cleanupIssue.action === "logout" ? "Çıkış tamamlandı" : "Tamamlanamayan güvenli temizlik"}',
    );
    expect(cleanupRenderer).toContain('tone="warning"');
    expect(cleanupRenderer).toContain('actionLabel={hasRetryableTarget && !busy && !googleBusy ? "Temizliği tekrar dene" : undefined}');
    expect(cleanupRenderer).toContain("onAction={hasRetryableTarget && !busy && !googleBusy ? () => void retryFailedCleanup() : undefined}");
    expect(feedbackSource).toContain('accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}');
    expect(feedbackSource).toContain('accessibilityRole="alert"');
    expect(feedbackSource).toMatch(
      /<Button compact label=\{actionLabel\}[^>]*onPress=\{onAction\}[^>]*variant="secondary" \/>/u,
    );
    expect(authAndOnboardingBoundary).toContain('AUTH_ROUTE_NAMES.has(route) || route === "AcademicOnboarding"');
    expect(authAndOnboardingBoundary.indexOf("renderCleanupIssue()")).toBeGreaterThan(-1);
    expect(authAndOnboardingBoundary.indexOf("renderCleanupIssue()"))
      .toBeLessThan(authAndOnboardingBoundary.indexOf("{renderAuthOnboardingScreen(route)}"));
    expect(routedScreens.match(/renderCleanupIssue\(\)/gu)).toHaveLength(1);
    expect(authAndOnboardingBoundary).toContain('cleanupIssue?.action === "logout" ? null : renderCleanupIssue()');
    expect(cleanupRenderer.match(/retryFailedCleanup\(\)/gu)).toHaveLength(1);
  });

  it("preserves the disabled-account error before generic Google 401 recovery", () => {
    const googleHandler = functionSource(applicationModule("actions/auth-actions.ts"), "handleGoogleAuth");
    const disabledAccountBranch = googleHandler.indexOf('error.code === "disabled_account"');
    const genericUnauthorizedBranch = googleHandler.indexOf("error.status === 401");

    expect(disabledAccountBranch).toBeGreaterThan(-1);
    expect(genericUnauthorizedBranch).toBeGreaterThan(disabledAccountBranch);
  });

  it("uses the complete password-recovery endpoints and six-digit backend contract", () => {
    expect(AUTH_ENDPOINTS.passwordRecoveryRequest).toBe("/auth/password-recovery/request");
    expect(AUTH_ENDPOINTS.passwordRecoveryConfirm).toBe("/auth/password-recovery/confirm");
    expect(PASSWORD_RECOVERY_CODE_LENGTH).toBe(6);

    const requestHandler = functionSource(applicationModule("actions/password-recovery-actions.ts"), "requestPasswordRecovery");
    const confirmHandler = functionSource(applicationModule("actions/password-recovery-actions.ts"), "confirmPasswordRecovery");
    const codeHandler = functionSource(applicationModule("actions/password-recovery-actions.ts"), "continuePasswordRecoveryCode");

    expect(requestHandler).toContain("AUTH_ENDPOINTS.passwordRecoveryRequest");
    expect(requestHandler).toContain('body: JSON.stringify({ email: normalizedEmail })');
    expect(requestHandler).toContain('setAuthStage("password_recovery_code")');
    expect(codeHandler).toContain("PASSWORD_RECOVERY_CODE_LENGTH");
    expect(codeHandler).toContain('setAuthStage("password_recovery_confirm")');
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

    const appSource = applicationModule("actions/password-recovery-actions.ts");
    const recoveryHandlers = appSource;
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
      newPassword: "Abcdef12",
      passwordConfirmation: "Abcdef12"
    })).toEqual({ valid: true });
    expect(validatePasswordRecoveryConfirmation({
      code: "12345",
      newPassword: "Abcdef12",
      passwordConfirmation: "Abcdef12"
    })).toMatchObject({ valid: false, code: "invalid_code" });
    expect(validatePasswordRecoveryConfirmation({
      code: "123456",
      newPassword: "short",
      passwordConfirmation: "short"
    })).toMatchObject({ valid: false, code: "password_too_short" });
    expect(validatePasswordRecoveryConfirmation({
      code: "123456",
      newPassword: "12345678",
      passwordConfirmation: "12345678"
    })).toMatchObject({ valid: false, code: "password_too_weak" });
    expect(validatePasswordRecoveryConfirmation({
      code: "123456",
      newPassword: "Abcdef12",
      passwordConfirmation: "different-value"
    })).toMatchObject({ valid: false, code: "password_confirmation_mismatch" });
  });

  it("normalizes numeric OTP input and masks auth destination email addresses", () => {
    expect(EMAIL_VERIFICATION_CODE_LENGTH).toBe(6);
    expect(normalizeNumericCode("1a2 34x56", EMAIL_VERIFICATION_CODE_LENGTH)).toBe("123456");
    expect(normalizeNumericCode("12-34 56 78", PASSWORD_RECOVERY_CODE_LENGTH)).toBe("123456");
    expect(isVerificationCodeComplete("123456")).toBe(true);
    expect(isVerificationCodeComplete("12345")).toBe(false);
    expect(isPasswordRecoveryCodeComplete("123456")).toBe(true);
    expect(isPasswordRecoveryCodeComplete("12345a")).toBe(false);
    expect(maskEmail(" Student@Example.com ")).toBe("s***t@example.com");
    expect(maskEmail("not-an-email")).toBe("e-posta adresin");
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
    const appSource = applicationModule("screens/auth-screens.tsx");
    const authScreensSource = readFileSync(
      new URL("../../apps/mobile-native/src/auth/AuthScreens.tsx", import.meta.url),
      "utf8"
    );
    const fieldsSource = readFileSync(
      new URL("../../apps/mobile-native/src/design-system/primitives/Fields.tsx", import.meta.url),
      "utf8"
    );
    const navigatorSource = readFileSync(
      new URL("../../apps/mobile-native/src/navigation/AppNavigator.tsx", import.meta.url),
      "utf8"
    );
    const authScaffold = authScreensSource.slice(
      authScreensSource.indexOf("function AuthScaffold"),
      authScreensSource.indexOf("export interface LoginScreenProps")
    );
    const loginScreen = authScreensSource.slice(
      authScreensSource.indexOf("export function LoginScreen"),
      authScreensSource.indexOf("export interface RegistrationScreenProps")
    );
    const registrationScreen = authScreensSource.slice(
      authScreensSource.indexOf("export function RegistrationScreen"),
      authScreensSource.indexOf("export interface VerificationScreenProps")
    );
    const verificationScreen = authScreensSource.slice(
      authScreensSource.indexOf("export function VerificationScreen"),
      authScreensSource.indexOf("export interface PasswordRecoveryRequestScreenProps")
    );
    const recoveryRequestScreen = authScreensSource.slice(
      authScreensSource.indexOf("export function PasswordRecoveryRequestScreen"),
      authScreensSource.indexOf("export interface PasswordRecoveryCodeScreenProps")
    );
    const recoveryCodeScreen = authScreensSource.slice(
      authScreensSource.indexOf("export function PasswordRecoveryCodeScreen"),
      authScreensSource.indexOf("export interface PasswordRecoveryConfirmScreenProps")
    );
    const recoveryConfirmScreen = authScreensSource.slice(
      authScreensSource.indexOf("export function PasswordRecoveryConfirmScreen"),
      authScreensSource.indexOf("export interface AcademicOnboardingScreenProps")
    );
    const authRouteMap = functionSource(applicationModule("app-routes.ts"), "routeForAuthState");

    expect(loginScreen).toContain('label="Şifremi unuttum"');
    expect(loginScreen).toMatch(/onPress=\{\(\) => \{[\s\S]*?Keyboard\.dismiss\(\);[\s\S]*?props\.onForgotPassword\(\);[\s\S]*?\}\}/u);
    expect(loginScreen).toContain('autoComplete={Platform.OS === "ios" ? "username" : "email"}');
    expect(loginScreen).toContain('autoComplete={Platform.OS === "ios" ? "current-password" : "password"}');
    expect(loginScreen).not.toContain('label="Beni hatırla"');
    expect(registrationScreen.match(/autoComplete="new-password"/gu)).toHaveLength(2);
    expect(registrationScreen).toContain("KVKK Aydınlatma Metni");
    expect(registrationScreen).toContain("Gizlilik Politikası");
    expect(registrationScreen).toContain("Kullanım Koşulları");
    expect(registrationScreen).toContain("onPasswordConfirmationChange");
    expect(authRouteMap).toContain('case "password_recovery_request": return "PasswordRecoveryRequest";');
    expect(authRouteMap).toContain('case "password_recovery_code": return "PasswordRecoveryCode";');
    expect(authRouteMap).toContain('case "password_recovery_confirm": return "PasswordRecoveryConfirm";');
    expect(verificationScreen).toContain("maskEmail(props.email)");
    expect(verificationScreen).toContain('autoComplete="one-time-code"');
    expect(verificationScreen).toContain('inputMode="numeric"');
    expect(verificationScreen).toContain('keyboardType="number-pad"');
    expect(verificationScreen).toContain('textContentType="oneTimeCode"');
    expect(verificationScreen).toContain("maxLength={EMAIL_VERIFICATION_CODE_LENGTH}");
    expect(recoveryRequestScreen).toContain('autoComplete="email"');
    expect(recoveryRequestScreen).toContain("props.timing?.resendInSeconds");
    expect(recoveryRequestScreen).toContain("loading={props.busy}");
    expect(recoveryCodeScreen).toContain("maskEmail(props.email)");
    expect(recoveryCodeScreen).toContain('autoComplete="one-time-code"');
    expect(recoveryCodeScreen).toContain('inputMode="numeric"');
    expect(recoveryCodeScreen).toContain('keyboardType="number-pad"');
    expect(recoveryCodeScreen).toContain('textContentType="oneTimeCode"');
    expect(recoveryCodeScreen).toContain("maxLength={PASSWORD_RECOVERY_CODE_LENGTH}");
    expect(recoveryCodeScreen).toContain("props.timing?.resendInSeconds");
    expect(recoveryConfirmScreen.match(/<PasswordField/gu)).toHaveLength(2);
    expect(recoveryConfirmScreen).not.toContain("onCodeChange");
    expect(recoveryConfirmScreen.match(/autoComplete="new-password"/gu)).toHaveLength(2);
    expect(recoveryConfirmScreen).toContain("onPasswordConfirmationChange");
    expect(recoveryConfirmScreen).toContain("loading={props.busy}");
    expect(fieldsSource).toContain("secureTextEntry={!revealed}");
    expect(fieldsSource).toContain("accessibilityLabel={actionLabel}");
    expect(navigatorSource).toContain('BackHandler.addEventListener("hardwareBackPress"');
    expect(navigatorSource).toContain("gestureEnabled: !navigationLocked");
    expect(appSource).toContain('case "PasswordRecoveryRequest":');
    expect(appSource).toContain('case "PasswordRecoveryCode":');
    expect(appSource).toContain('case "PasswordRecoveryConfirm":');
    expect(appSource).toContain("onBack={returnToPasswordRecoveryRequest}");
    expect(appSource).toContain("onBack={returnToPasswordRecoveryCode}");
    expect(appSource).toContain("onCancel={cancelPasswordRecovery}");
    expect(authScaffold).toContain("message={feedback.text}");
    expect(authScaffold).toContain("tone={feedback.tone}");
    expect(applicationModule("useApplicationEffects.ts")).toContain('if (!message || navigatorRootSurface !== "authenticated") return;');

    const successCleanup = sourceBetween(
      functionSource(applicationModule("actions/password-recovery-actions.ts"), "confirmPasswordRecovery"),
      "async function confirmPasswordRecovery", "} catch (error)"
    );
    expect(successCleanup).toContain('setPasswordRecoveryCode("")');
    expect(successCleanup).toContain('setNewPassword("")');
    expect(successCleanup).toContain('setPasswordConfirmation("")');
    expect(successCleanup).toContain('setAuthMode("login")');
    expect(successCleanup).toContain('setAuthStage("auth")');
  });
});

function applicationModule(relativePath: string): string {
  return readFileSync(new URL(`../../apps/mobile-native/src/app/${relativePath}`, import.meta.url), "utf8").replace(/\r\n?/gu, "\n");
}
