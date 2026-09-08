import { type ReactNode } from "react";
import { type AppVisibleRoute } from "../../navigation/AppNavigator";
import { BootstrapLoadingState, BootstrapErrorState } from "../../navigation/SystemStateScreens";
import { Banner } from "../../design-system";
import { PASSWORD_RECOVERY_CODE_LENGTH } from "../../auth/auth-recovery";
import {
  type AuthFeedback,
  LoginScreen,
  RegistrationScreen,
  VerificationScreen,
  PasswordRecoveryRequestScreen,
  PasswordRecoveryCodeScreen,
  PasswordRecoveryConfirmScreen,
  AcademicOnboardingScreen,
} from "../../auth/AuthScreens";
import {
  normalizeNumericCode,
  selectAcademicClassLevel,
  selectAcademicDepartment,
  selectAcademicFaculty,
  selectAcademicUniversity,
} from "../../auth/auth-ui";
import { GOOGLE_AUTH_CONFIGURED, GOOGLE_AUTH_CONFIGURATION_MESSAGE } from "../app-auth-providers";
import { cleanupTargetLabel } from "../app-errors";
import { AUTH_ROUTE_NAMES } from "../app-routes";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationActions } from "../application-actions";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";

type Dependencies = Pick<ApplicationState,
  "hydrationError" | "message" | "busy" | "email" | "googleBusy" | "appleAvailable" | "appleBusy"
  | "setMessage" | "setEmail" | "setPassword" | "setAuthMode" | "setAuthStage" | "password"
  | "fullName" | "setFullName" | "setRegistrationPasswordConfirmation"
  | "registrationPasswordConfirmation" | "verificationToken" | "setVerificationToken"
  | "passwordRecoveryFeedback" | "setPasswordRecoveryFeedback" | "pendingPasswordRecovery"
  | "passwordRecoveryCode" | "setPasswordRecoveryCode" | "newPassword" | "setNewPassword"
  | "setPasswordConfirmation" | "passwordConfirmation" | "departments" | "session" | "faculties"
  | "onboardingInitialDraft" | "registerFacultyId" | "registerUniversityId" | "universities"
  | "cleanupIssue"
> & Pick<ApplicationActions,
  "hydrateApplication" | "openPasswordRecovery" | "handleGoogleAuth" | "handleAppleAuth"
  | "handleAuth" | "openVerificationRecovery" | "returnToLoginForm" | "resendVerificationEmail"
  | "handleVerifyEmail" | "cancelPasswordRecovery" | "requestPasswordRecovery"
  | "returnToPasswordRecoveryRequest" | "continuePasswordRecoveryCode"
  | "returnToPasswordRecoveryCode" | "confirmPasswordRecovery" | "handleLogout"
  | "updateOnboardingDraft" | "loadDepartmentsForRegistration" | "loadFacultiesForRegistration"
  | "loadUniversities" | "saveAcademicOnboarding" | "skipAcademicOnboarding" | "retryFailedCleanup"
> & Pick<ApplicationDerivedState,
  "verificationTiming" | "passwordRecoveryTiming" | "academicClassLevelOptions"
  | "academicOnboardingDraft"
>;

export function createAuthScreens(dependencies: Dependencies) {
  const {
    hydrationError,
    hydrateApplication,
    message,
    busy,
    email,
    googleBusy,
    appleAvailable,
    appleBusy,
    setMessage,
    setEmail,
    openPasswordRecovery,
    handleGoogleAuth,
    handleAppleAuth,
    setPassword,
    setAuthMode,
    setAuthStage,
    handleAuth,
    openVerificationRecovery,
    password,
    fullName,
    setFullName,
    returnToLoginForm,
    setRegistrationPasswordConfirmation,
    registrationPasswordConfirmation,
    verificationToken,
    setVerificationToken,
    resendVerificationEmail,
    handleVerifyEmail,
    verificationTiming,
    passwordRecoveryFeedback,
    cancelPasswordRecovery,
    setPasswordRecoveryFeedback,
    requestPasswordRecovery,
    pendingPasswordRecovery,
    passwordRecoveryTiming,
    passwordRecoveryCode,
    returnToPasswordRecoveryRequest,
    setPasswordRecoveryCode,
    continuePasswordRecoveryCode,
    newPassword,
    returnToPasswordRecoveryCode,
    setNewPassword,
    setPasswordConfirmation,
    confirmPasswordRecovery,
    passwordConfirmation,
    academicClassLevelOptions,
    departments,
    academicOnboardingDraft,
    session,
    faculties,
    onboardingInitialDraft,
    handleLogout,
    updateOnboardingDraft,
    loadDepartmentsForRegistration,
    registerFacultyId,
    loadFacultiesForRegistration,
    registerUniversityId,
    loadUniversities,
    saveAcademicOnboarding,
    skipAcademicOnboarding,
    universities,
    cleanupIssue,
    retryFailedCleanup
  } = dependencies;

  const bootstrapLoading = (
    <BootstrapLoadingState />
  );

  const bootstrapError = (
    <BootstrapErrorState error={hydrationError ?? undefined} onRetry={() => void hydrateApplication()} />
  );

  function renderAuthOnboardingScreen(route: AppVisibleRoute): ReactNode {
    const sharedFeedback = message as AuthFeedback | null;
    switch (route) {
      case "Login":
        return (
          <LoginScreen
            busy={busy}
            email={email}
            feedback={sharedFeedback}
            googleAvailable={GOOGLE_AUTH_CONFIGURED}
            googleBusy={googleBusy}
            googleUnavailableMessage={GOOGLE_AUTH_CONFIGURATION_MESSAGE}
            appleAvailable={appleAvailable}
            appleBusy={appleBusy}
            onDismissFeedback={() => setMessage(null)}
            onEmailChange={(value) => {
              setEmail(value);
              setMessage(null);
            }}
            onForgotPassword={() => openPasswordRecovery()}
            onGoogleSubmit={() => void handleGoogleAuth()}
            onAppleSubmit={() => void handleAppleAuth()}
            onPasswordChange={(value) => {
              setPassword(value);
              setMessage(null);
            }}
            onRegister={() => {
              setAuthMode("register");
              setAuthStage("auth");
              setMessage(null);
            }}
            onSubmit={() => void handleAuth()}
            onVerificationRecovery={() => void openVerificationRecovery()}
            password={password}
          />
        );
      case "Register":
        return (
          <RegistrationScreen
            busy={busy}
            email={email}
            feedback={sharedFeedback}
            fullName={fullName}
            onDismissFeedback={() => setMessage(null)}
            onEmailChange={(value) => {
              setEmail(value);
              setMessage(null);
            }}
            onFullNameChange={(value) => {
              setFullName(value);
              setMessage(null);
            }}
            onLogin={returnToLoginForm}
            onPasswordChange={(value) => {
              setPassword(value);
              setMessage(null);
            }}
            onPasswordConfirmationChange={(value) => {
              setRegistrationPasswordConfirmation(value);
              setMessage(null);
            }}
            onSubmit={() => void handleAuth()}
            password={password}
            passwordConfirmation={registrationPasswordConfirmation}
          />
        );
      case "Verification":
        return (
          <VerificationScreen
            busy={busy}
            code={verificationToken}
            email={email}
            feedback={sharedFeedback}
            onChangeEmail={returnToLoginForm}
            onCodeChange={(value) => {
              setVerificationToken(normalizeNumericCode(value, 6));
              setMessage(null);
            }}
            onDismissFeedback={() => setMessage(null)}
            onResend={() => void resendVerificationEmail()}
            onSubmit={() => void handleVerifyEmail()}
            timing={verificationTiming}
          />
        );
      case "PasswordRecoveryRequest":
        return (
          <PasswordRecoveryRequestScreen
            busy={busy}
            email={email}
            feedback={passwordRecoveryFeedback}
            onCancel={cancelPasswordRecovery}
            onEmailChange={(value) => {
              setEmail(value);
              setPasswordRecoveryFeedback(null);
            }}
            onSubmit={() => void requestPasswordRecovery()}
            timing={pendingPasswordRecovery?.email === email.trim().toLowerCase()
              ? passwordRecoveryTiming
              : null}
          />
        );
      case "PasswordRecoveryCode":
        return (
          <PasswordRecoveryCodeScreen
            busy={busy}
            code={passwordRecoveryCode}
            email={pendingPasswordRecovery?.email ?? email}
            feedback={passwordRecoveryFeedback}
            onBack={returnToPasswordRecoveryRequest}
            onCancel={cancelPasswordRecovery}
            onCodeChange={(value) => {
              setPasswordRecoveryCode(normalizeNumericCode(value, PASSWORD_RECOVERY_CODE_LENGTH));
              setPasswordRecoveryFeedback(null);
            }}
            onContinue={continuePasswordRecoveryCode}
            onResend={() => void requestPasswordRecovery()}
            timing={passwordRecoveryTiming}
          />
        );
      case "PasswordRecoveryConfirm":
        return (
          <PasswordRecoveryConfirmScreen
            busy={busy}
            code={passwordRecoveryCode}
            feedback={passwordRecoveryFeedback}
            newPassword={newPassword}
            onBack={returnToPasswordRecoveryCode}
            onCancel={cancelPasswordRecovery}
            onNewPasswordChange={(value) => {
              setNewPassword(value);
              setPasswordRecoveryFeedback(null);
            }}
            onPasswordConfirmationChange={(value) => {
              setPasswordConfirmation(value);
              setPasswordRecoveryFeedback(null);
            }}
            onSubmit={() => void confirmPasswordRecovery()}
            passwordConfirmation={passwordConfirmation}
          />
        );
      case "AcademicOnboarding":
        return (
          <AcademicOnboardingScreen
            busy={busy}
            classLevels={academicClassLevelOptions}
            departments={(departments.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
            departmentsError={departments.error}
            departmentsLoading={departments.loading}
            draft={academicOnboardingDraft}
            email={session?.user.email ?? email}
            faculties={(faculties.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
            facultiesError={faculties.error}
            facultiesLoading={faculties.loading}
            feedback={sharedFeedback}
            fullName={session?.user.fullName ?? fullName}
            initialDraft={onboardingInitialDraft}
            needsPassword={!session}
            onBack={() => {
              if (session) void handleLogout();
              else returnToLoginForm();
            }}
            onClassLevelChange={(value) => updateOnboardingDraft(
              selectAcademicClassLevel(academicOnboardingDraft, value)
            )}
            onDepartmentChange={(value) => updateOnboardingDraft(
              selectAcademicDepartment(academicOnboardingDraft, value)
            )}
            onDismissFeedback={() => setMessage(null)}
            onFacultyChange={(value) => updateOnboardingDraft(
              selectAcademicFaculty(academicOnboardingDraft, value)
            )}
            onPasswordChange={(value) => {
              setPassword(value);
              setMessage(null);
            }}
            onRetryDepartments={() => void loadDepartmentsForRegistration(registerFacultyId)}
            onRetryFaculties={() => void loadFacultiesForRegistration(registerUniversityId)}
            onRetryUniversities={() => void loadUniversities()}
            onSave={() => void saveAcademicOnboarding()}
            onSkip={skipAcademicOnboarding}
            onUniversityChange={(value) => updateOnboardingDraft(
              selectAcademicUniversity(academicOnboardingDraft, value)
            )}
            password={password}
            universities={(universities.data ?? []).map((item) => ({
              value: item.id,
              label: item.name,
              supportingText: item.city
            }))}
            universitiesError={universities.error}
            universitiesLoading={universities.loading}
          />
        );
      default:
        return null;
    }
  }

  function renderCleanupIssue(): ReactNode {
    if (!cleanupIssue) return null;
    const hasRetryableTarget = cleanupIssue.failedTargets.some(
      (target) => target !== "server_session"
        && target !== "server_account"
        && (target !== "device_registration" || Boolean(session))
    );
    return (
      <Banner
        actionLabel={hasRetryableTarget && !busy && !googleBusy ? "Temizliği tekrar dene" : undefined}
        message={cleanupIssue.action === "logout"
          ? `${cleanupIssue.failedTargets.map(cleanupTargetLabel).join(", ")} temizliği doğrulanamadı. Yeniden girişte tekrar uzlaştırılacak.`
          : cleanupIssue.failedTargets.map(cleanupTargetLabel).join(", ")}
        onAction={hasRetryableTarget && !busy && !googleBusy ? () => void retryFailedCleanup() : undefined}
        title={cleanupIssue.action === "logout" ? "Çıkış tamamlandı" : "Tamamlanamayan güvenli temizlik"}
        tone="warning"
      />
    );
  }

  function renderRoutedScreen(route: AppVisibleRoute): ReactNode {
    if (AUTH_ROUTE_NAMES.has(route) || route === "AcademicOnboarding") {
      return (
        <>
          {cleanupIssue?.action === "logout" ? null : renderCleanupIssue()}
          {renderAuthOnboardingScreen(route)}
        </>
      );
    }
    return null;
  }

  return {
    bootstrapLoading,
    bootstrapError,
    renderAuthOnboardingScreen,
    renderCleanupIssue,
    renderRoutedScreen
  };
}
