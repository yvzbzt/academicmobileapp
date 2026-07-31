import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  Card,
  Chip,
  Screen,
  ThemeProvider,
  useTheme,
} from "../design-system";
import {
  AcademicOnboardingScreen,
  LoginScreen,
  PasswordRecoveryCodeScreen,
  PasswordRecoveryConfirmScreen,
  PasswordRecoveryRequestScreen,
  RegistrationScreen,
  VerificationScreen,
  type AcademicOnboardingScreenProps,
  type AcademicOption,
  type AuthFeedback,
  type AuthTiming,
} from "./AuthScreens";

export type AuthOnboardingPreviewScenario =
  | "login"
  | "login-loading"
  | "login-error"
  | "register"
  | "verification-cooldown"
  | "recovery-request"
  | "recovery-code"
  | "recovery-confirm"
  | "recovery-success"
  | "onboarding"
  | "onboarding-loading"
  | "onboarding-error"
  | "onboarding-success";

export interface AuthOnboardingPreviewProps {
  initialScenario?: AuthOnboardingPreviewScenario;
  preference?: "light" | "dark";
  showScenarioControls?: boolean;
}

interface PreviewScenarioDefinition {
  id: AuthOnboardingPreviewScenario;
  controlLabel: string;
  evidenceLabel: string;
}

const SYNTHETIC_EMAIL = "ogrenci@phase6.invalid";
const SYNTHETIC_PASSWORD = "phase6-parola";
const SYNTHETIC_VERIFICATION_CODE = "4242";
const SYNTHETIC_RECOVERY_CODE = "616161";

const ACTIVE_TIMING: AuthTiming = {
  expired: false,
  expiresInSeconds: 481,
  resendInSeconds: 37,
};

const UNIVERSITIES: readonly AcademicOption[] = [
  {
    value: "universite.phase6.invalid",
    label: "Phase 6 Sentetik Üniversitesi",
    supportingText: "universite.phase6.invalid",
  },
  {
    value: "ikinci-universite.phase6.invalid",
    label: "Phase 6 İkinci Sentetik Üniversitesi",
    supportingText: "ikinci-universite.phase6.invalid",
  },
];

const FACULTIES: readonly AcademicOption[] = [
  {
    value: "fakulte.phase6.invalid",
    label: "Sentetik Mühendislik Fakültesi",
    supportingText: "fakulte.phase6.invalid",
  },
];

const DEPARTMENTS: readonly AcademicOption[] = [
  {
    value: "bolum.phase6.invalid",
    label: "Sentetik Bilgisayar Mühendisliği",
    supportingText: "bolum.phase6.invalid",
  },
];

const CLASS_LEVELS: AcademicOnboardingScreenProps["classLevels"] = [
  { value: 1, label: "1. sınıf" },
  { value: 2, label: "2. sınıf" },
  { value: 3, label: "3. sınıf" },
  { value: 4, label: "4. sınıf" },
];

const INITIAL_ACADEMIC_DRAFT: AcademicOnboardingScreenProps["initialDraft"] = {
  universityId: "universite.phase6.invalid",
  facultyId: "fakulte.phase6.invalid",
  departmentId: "bolum.phase6.invalid",
  classLevel: 2,
};

const SCENARIOS: readonly PreviewScenarioDefinition[] = [
  { id: "login", controlLabel: "Giriş", evidenceLabel: "giriş" },
  {
    id: "login-loading",
    controlLabel: "Giriş · yükleniyor",
    evidenceLabel: "giriş yükleniyor",
  },
  { id: "login-error", controlLabel: "Giriş · hata", evidenceLabel: "giriş hata" },
  { id: "register", controlLabel: "Kayıt", evidenceLabel: "kayıt" },
  {
    id: "verification-cooldown",
    controlLabel: "Doğrulama",
    evidenceLabel: "doğrulama",
  },
  {
    id: "recovery-request",
    controlLabel: "Kurtarma · istek",
    evidenceLabel: "kurtarma istek",
  },
  {
    id: "recovery-code",
    controlLabel: "Kurtarma · kod",
    evidenceLabel: "kurtarma kod",
  },
  {
    id: "recovery-confirm",
    controlLabel: "Kurtarma · onay",
    evidenceLabel: "kurtarma onay",
  },
  {
    id: "recovery-success",
    controlLabel: "Kurtarma · başarı",
    evidenceLabel: "kurtarma başarı",
  },
  { id: "onboarding", controlLabel: "Akademik profil", evidenceLabel: "akademik profil" },
  {
    id: "onboarding-loading",
    controlLabel: "Profil · yükleniyor",
    evidenceLabel: "akademik profil yükleniyor",
  },
  {
    id: "onboarding-error",
    controlLabel: "Profil · hata",
    evidenceLabel: "akademik profil hata",
  },
  {
    id: "onboarding-success",
    controlLabel: "Profil · başarı",
    evidenceLabel: "akademik profil başarı",
  },
];

const PREVIEW_SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, right: 0, bottom: 34, left: 0 },
};

/**
 * Purely local Phase 6 evidence surface. The application can select it only
 * behind its __DEV__ evidence gate; all actions mutate synthetic preview state.
 */
export function AuthOnboardingPreview({
  initialScenario = "login",
  preference = "light",
  showScenarioControls = true,
}: AuthOnboardingPreviewProps) {
  if (!__DEV__) return null;

  return (
    <SafeAreaProvider initialMetrics={PREVIEW_SAFE_AREA_METRICS}>
      <ThemeProvider
        liquidGlassAvailable={false}
        preference={preference}
        reducedMotion
        reducedTransparency={false}
        systemMode={preference}
      >
        <AuthOnboardingPreviewContent
          initialScenario={initialScenario}
          showScenarioControls={showScenarioControls}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AuthOnboardingPreviewContent({
  initialScenario,
  showScenarioControls,
}: {
  initialScenario: AuthOnboardingPreviewScenario;
  showScenarioControls: boolean;
}) {
  const theme = useTheme();
  const safeInitialScenario = SCENARIOS.some((item) => item.id === initialScenario)
    ? initialScenario
    : "login";
  const [scenario, setScenario] = useState<AuthOnboardingPreviewScenario>(safeInitialScenario);
  const [fullName, setFullName] = useState("Phase 6 Sentetik Öğrenci");
  const [email, setEmail] = useState(SYNTHETIC_EMAIL);
  const [password, setPassword] = useState(SYNTHETIC_PASSWORD);
  const [passwordConfirmation, setPasswordConfirmation] = useState(SYNTHETIC_PASSWORD);
  const [verificationCode, setVerificationCode] = useState(SYNTHETIC_VERIFICATION_CODE);
  const [recoveryCode, setRecoveryCode] = useState(SYNTHETIC_RECOVERY_CODE);
  const [newPassword, setNewPassword] = useState("phase6-yeni-parola");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState(
    "phase6-yeni-parola",
  );
  const [draft, setDraft] = useState<AcademicOnboardingScreenProps["draft"]>({
    ...INITIAL_ACADEMIC_DRAFT,
  });
  const selectedScenario = SCENARIOS.find((item) => item.id === scenario) ?? SCENARIOS[0];
  const evidenceMarker = `Phase 6 sentetik ${selectedScenario.evidenceLabel} kanıtı`;

  function selectUniversity(value: string) {
    setDraft({ universityId: value, facultyId: "", departmentId: "", classLevel: null });
  }

  function selectFaculty(value: string | null) {
    setDraft((current) => ({
      ...current,
      facultyId: value ?? "",
      departmentId: "",
      classLevel: null,
    }));
  }

  function selectDepartment(value: string | null) {
    setDraft((current) => ({
      ...current,
      departmentId: value ?? "",
      classLevel: null,
    }));
  }

  return (
    <Screen
      accessibilityLabel="Phase 6 sentetik kimlik ve akademik profil önizlemesi"
      contentStyle={{ gap: theme.spacing.lg }}
      keyboardSafe
      readableWidth="form"
      scroll
    >
      <Card
        accessibilityLabel="Phase 6 sentetik senaryo kontrolleri"
        style={{ gap: theme.spacing.sm }}
        variant="tonal"
      >
        <Text
          accessibilityRole="header"
          testID="phase-6-synthetic-evidence"
          style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}
        >
          {evidenceMarker}
        </Text>
        <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>
          Yalnızca yerel sunum kanıtıdır; tüm kimlikler phase6.invalid alan adını kullanır.
        </Text>
        {showScenarioControls ? (
          <View style={[styles.scenarioControls, { gap: theme.spacing.xs }]}>
            {SCENARIOS.map((item) => (
              <Chip
                accessibilityLabel={`${item.controlLabel} senaryosunu göster`}
                key={item.id}
                label={item.controlLabel}
                onPress={() => setScenario(item.id)}
                selected={item.id === scenario}
              />
            ))}
          </View>
        ) : null}
      </Card>

      <View key={scenario} style={styles.screenFixture}>
        {renderScenario({
          scenario,
          fullName,
          email,
          password,
          passwordConfirmation,
          verificationCode,
          recoveryCode,
          newPassword,
          newPasswordConfirmation,
          draft,
          setScenario,
          setFullName,
          setEmail,
          setPassword,
          setPasswordConfirmation,
          setVerificationCode,
          setRecoveryCode,
          setNewPassword,
          setNewPasswordConfirmation,
          selectUniversity,
          selectFaculty,
          selectDepartment,
          setClassLevel: (value) => setDraft((current) => ({ ...current, classLevel: value })),
        })}
      </View>
    </Screen>
  );
}

interface ScenarioRenderInput {
  scenario: AuthOnboardingPreviewScenario;
  fullName: string;
  email: string;
  password: string;
  passwordConfirmation: string;
  verificationCode: string;
  recoveryCode: string;
  newPassword: string;
  newPasswordConfirmation: string;
  draft: AcademicOnboardingScreenProps["draft"];
  setScenario: (value: AuthOnboardingPreviewScenario) => void;
  setFullName: (value: string) => void;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setPasswordConfirmation: (value: string) => void;
  setVerificationCode: (value: string) => void;
  setRecoveryCode: (value: string) => void;
  setNewPassword: (value: string) => void;
  setNewPasswordConfirmation: (value: string) => void;
  selectUniversity: (value: string) => void;
  selectFaculty: (value: string | null) => void;
  selectDepartment: (value: string | null) => void;
  setClassLevel: AcademicOnboardingScreenProps["onClassLevelChange"];
}

function renderScenario(input: ScenarioRenderInput): ReactNode {
  const loginFeedback: AuthFeedback | null = input.scenario === "login-error"
    ? { tone: "error", text: "phase6.invalid sentetik giriş hatası." }
    : input.scenario === "recovery-success"
      ? { tone: "success", text: "Sentetik şifre yenilendi. Yeni şifrenle giriş yapabilirsin." }
    : null;

  if (
    input.scenario === "login"
    || input.scenario === "login-loading"
    || input.scenario === "login-error"
    || input.scenario === "recovery-success"
  ) {
    return (
      <LoginScreen
        busy={input.scenario === "login-loading"}
        email={input.email}
        feedback={loginFeedback}
        googleAvailable={false}
        googleBusy={false}
        googleUnavailableMessage="phase6.invalid sentetik sağlayıcı durumu."
        onDismissFeedback={() => input.setScenario("login")}
        onEmailChange={input.setEmail}
        onForgotPassword={() => input.setScenario("recovery-request")}
        onGoogleSubmit={() => input.setScenario("login-loading")}
        onPasswordChange={input.setPassword}
        onRegister={() => input.setScenario("register")}
        onSubmit={() => input.setScenario("login-loading")}
        onVerificationRecovery={() => input.setScenario("verification-cooldown")}
        password={input.password}
      />
    );
  }

  if (input.scenario === "register") {
    return (
      <RegistrationScreen
        busy={false}
        email={input.email}
        fullName={input.fullName}
        onEmailChange={input.setEmail}
        onFullNameChange={input.setFullName}
        onLogin={() => input.setScenario("login")}
        onPasswordChange={input.setPassword}
        onPasswordConfirmationChange={input.setPasswordConfirmation}
        onSubmit={() => input.setScenario("verification-cooldown")}
        password={input.password}
        passwordConfirmation={input.passwordConfirmation}
      />
    );
  }

  if (input.scenario === "verification-cooldown") {
    return (
      <VerificationScreen
        busy={false}
        code={input.verificationCode}
        email={input.email}
        onChangeEmail={() => input.setScenario("register")}
        onCodeChange={input.setVerificationCode}
        onResend={() => input.setVerificationCode(SYNTHETIC_VERIFICATION_CODE)}
        onSubmit={() => input.setScenario("onboarding")}
        timing={ACTIVE_TIMING}
      />
    );
  }

  if (input.scenario === "recovery-request") {
    return (
      <PasswordRecoveryRequestScreen
        busy={false}
        email={input.email}
        onCancel={() => input.setScenario("login")}
        onEmailChange={input.setEmail}
        onSubmit={() => input.setScenario("recovery-code")}
        timing={null}
      />
    );
  }

  if (input.scenario === "recovery-code") {
    return (
      <PasswordRecoveryCodeScreen
        busy={false}
        code={input.recoveryCode}
        email={input.email}
        onBack={() => input.setScenario("recovery-request")}
        onCancel={() => input.setScenario("login")}
        onCodeChange={input.setRecoveryCode}
        onContinue={() => input.setScenario("recovery-confirm")}
        onResend={() => input.setRecoveryCode(SYNTHETIC_RECOVERY_CODE)}
        timing={ACTIVE_TIMING}
      />
    );
  }

  if (input.scenario === "recovery-confirm") {
    return (
      <PasswordRecoveryConfirmScreen
        busy={false}
        code={input.recoveryCode}
        newPassword={input.newPassword}
        onBack={() => input.setScenario("recovery-code")}
        onCancel={() => input.setScenario("login")}
        onNewPasswordChange={input.setNewPassword}
        onPasswordConfirmationChange={input.setNewPasswordConfirmation}
        onSubmit={() => input.setScenario("recovery-success")}
        passwordConfirmation={input.newPasswordConfirmation}
      />
    );
  }

  const loading = input.scenario === "onboarding-loading";
  const error = input.scenario === "onboarding-error";
  const successFeedback: AuthFeedback | null = input.scenario === "onboarding-success"
    ? { tone: "success", text: "phase6.invalid sentetik akademik profil kaydı tamamlandı." }
    : null;

  return (
    <AcademicOnboardingScreen
      busy={loading}
      classLevels={CLASS_LEVELS}
      departments={DEPARTMENTS}
      departmentsError={error ? "phase6.invalid sentetik bölüm yükleme hatası." : undefined}
      departmentsLoading={loading}
      draft={input.draft}
      email={input.email}
      faculties={FACULTIES}
      facultiesError={error ? "phase6.invalid sentetik fakülte yükleme hatası." : undefined}
      facultiesLoading={loading}
      feedback={successFeedback}
      fullName={input.fullName}
      initialDraft={INITIAL_ACADEMIC_DRAFT}
      needsPassword
      onBack={() => input.setScenario("verification-cooldown")}
      onClassLevelChange={input.setClassLevel}
      onDepartmentChange={input.selectDepartment}
      onDismissFeedback={() => input.setScenario("onboarding")}
      onFacultyChange={input.selectFaculty}
      onPasswordChange={input.setPassword}
      onRetryDepartments={() => input.setScenario("onboarding")}
      onRetryFaculties={() => input.setScenario("onboarding")}
      onRetryUniversities={() => input.setScenario("onboarding")}
      onSave={() => input.setScenario("onboarding-success")}
      onUniversityChange={input.selectUniversity}
      password={input.password}
      universities={UNIVERSITIES}
      universitiesError={error ? "phase6.invalid sentetik üniversite yükleme hatası." : undefined}
      universitiesLoading={loading}
    />
  );
}

const styles = StyleSheet.create({
  scenarioControls: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  screenFixture: {
    width: "100%",
  },
});
