import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  BackHandler,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from "react-native";
import {
  Banner,
  Button,
  Card,
  PasswordField,
  SearchField,
  SelectField,
  TextField,
  useTheme,
  type FeedbackTone,
  type SelectFieldOption,
} from "../design-system";
import {
  AUTH_PASSWORD_MIN_LENGTH,
  PASSWORD_RECOVERY_CODE_LENGTH,
  validatePasswordRecoveryConfirmation,
} from "./auth-recovery";
import {
  EMAIL_VERIFICATION_CODE_LENGTH,
  isPasswordRecoveryCodeComplete,
  isVerificationCodeComplete,
  maskEmail,
  normalizeNumericCode,
  validateLoginForm,
  validateRegistrationForm,
  type AcademicClassLevel,
  type AcademicOnboardingDraft,
} from "./auth-ui";

export interface AuthFeedback {
  text: string;
  tone: FeedbackTone;
}

export interface AuthTiming {
  expired: boolean;
  expiresInSeconds: number;
  resendInSeconds: number;
}

export interface AcademicOption {
  value: string;
  label: string;
  supportingText?: string;
}

interface AuthScaffoldProps {
  title: string;
  description: string;
  eyebrow?: string;
  feedback?: AuthFeedback | null;
  onDismissFeedback?: () => void;
  children: ReactNode;
}

function AuthScaffold({
  title,
  description,
  eyebrow,
  feedback,
  onDismissFeedback,
  children,
}: AuthScaffoldProps) {
  const theme = useTheme();
  return (
    <View style={[styles.screenStack, { gap: theme.spacing.lg }]}>
      <View style={[styles.identity, { gap: theme.spacing.sm }]}>
        <View
          accessible
          accessibilityLabel="Akademik Takvim"
          style={[
            styles.identityMark,
            {
              backgroundColor: theme.colors.action.secondary,
              borderColor: theme.colors.border.default,
              borderRadius: theme.radii.card,
            },
          ]}
        >
          <Text style={[theme.typography.cardTitle, { color: theme.colors.text.link }]}>AT</Text>
        </View>
        <View style={[styles.identityCopy, { gap: theme.spacing.xxs }]}>
          <Text style={[theme.typography.label, { color: theme.colors.text.link }]}>
            {eyebrow ?? "Akademik Takvim"}
          </Text>
          <Text
            accessibilityRole="header"
            style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}
          >
            {title}
          </Text>
          <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>
            {description}
          </Text>
        </View>
      </View>

      {feedback ? (
        <Banner
          message={feedback.text}
          onDismiss={onDismissFeedback}
          title={feedback.tone === "error" ? "İşlem tamamlanamadı" : feedback.tone === "success" ? "Tamamlandı" : "Bilgi"}
          tone={feedback.tone}
        />
      ) : null}

      <Card
        accessibilityLabel={`${title} formu`}
        style={{ gap: theme.spacing.md }}
        variant="elevated"
      >
        {children}
      </Card>
    </View>
  );
}

export interface LoginScreenProps {
  email: string;
  password: string;
  busy: boolean;
  googleBusy: boolean;
  googleAvailable: boolean;
  googleUnavailableMessage: string;
  feedback?: AuthFeedback | null;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onGoogleSubmit: () => void;
  onForgotPassword: () => void;
  onVerificationRecovery: () => void;
  onRegister: () => void;
  onDismissFeedback?: () => void;
}

export function LoginScreen(props: LoginScreenProps) {
  const theme = useTheme();
  const [attempted, setAttempted] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const validation = validateLoginForm({ email: props.email, password: props.password });
  const interactionBusy = props.busy || props.googleBusy;

  function submit() {
    setAttempted(true);
    if (!validation.valid) {
      if (validation.errors.email) return;
      passwordRef.current?.focus();
      return;
    }
    props.onSubmit();
  }

  return (
    <AuthScaffold
      description="Takvimini, sınavlarını ve akademik duyurularını güvenle takip et."
      feedback={props.feedback}
      onDismissFeedback={props.onDismissFeedback}
      title="Tekrar hoş geldin"
    >
      <TextField
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        blurOnSubmit={false}
        disabled={interactionBusy}
        error={attempted ? validation.errors.email : undefined}
        keyboardType="email-address"
        label="E-posta adresi"
        onChangeText={props.onEmailChange}
        onSubmitEditing={() => passwordRef.current?.focus()}
        placeholder="ornek@universite.edu.tr"
        returnKeyType="next"
        submitBehavior="submit"
        textContentType="emailAddress"
        value={props.email}
      />
      <PasswordField
        autoComplete="password"
        disabled={interactionBusy}
        error={attempted ? validation.errors.password : undefined}
        ref={passwordRef}
        label="Şifre"
        onChangeText={props.onPasswordChange}
        onSubmitEditing={submit}
        placeholder="Şifreni gir"
        returnKeyType="done"
        textContentType="password"
        value={props.password}
      />
      <View style={[styles.inlineActions, { gap: theme.spacing.xs }]}>
        <Button
          compact
          disabled={interactionBusy}
          label="Şifremi unuttum"
          onPress={props.onForgotPassword}
          variant="ghost"
        />
        <Button
          compact
          disabled={interactionBusy || props.email.trim().length === 0}
          label="E-postamı doğrula"
          onPress={props.onVerificationRecovery}
          variant="ghost"
        />
      </View>
      <Button
        disabled={interactionBusy}
        fullWidth
        label="Giriş yap"
        loading={props.busy}
        onPress={submit}
      />
      {props.googleAvailable ? (
        <Button
          disabled={props.busy}
          fullWidth
          label="Google ile devam et"
          loading={props.googleBusy}
          onPress={props.onGoogleSubmit}
          variant="secondary"
        />
      ) : (
        <Banner message={props.googleUnavailableMessage} title="Google girişi kullanılamıyor" tone="info" />
      )}
      <View style={[styles.accountSwitch, { gap: theme.spacing.xs }]}>
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Hesabın yok mu?</Text>
        <Button compact disabled={interactionBusy} label="Kayıt ol" onPress={props.onRegister} variant="ghost" />
      </View>
    </AuthScaffold>
  );
}

export interface RegistrationScreenProps {
  fullName: string;
  email: string;
  password: string;
  passwordConfirmation: string;
  busy: boolean;
  feedback?: AuthFeedback | null;
  onFullNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onPasswordConfirmationChange: (value: string) => void;
  onSubmit: () => void;
  onLogin: () => void;
  onDismissFeedback?: () => void;
}

export function RegistrationScreen(props: RegistrationScreenProps) {
  const theme = useTheme();
  const [attempted, setAttempted] = useState(false);
  const nameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmationRef = useRef<TextInput>(null);
  const validation = validateRegistrationForm(props);

  function submit() {
    setAttempted(true);
    if (!validation.valid) {
      if (validation.errors.fullName) nameRef.current?.focus();
      else if (validation.errors.email) emailRef.current?.focus();
      else if (validation.errors.password) passwordRef.current?.focus();
      else confirmationRef.current?.focus();
      return;
    }
    props.onSubmit();
  }

  return (
    <AuthScaffold
      description="Hesabını oluştur; e-postanı doğruladıktan sonra akademik profilini tek adımda tamamla."
      feedback={props.feedback}
      onDismissFeedback={props.onDismissFeedback}
      title="Akademik yolculuğuna başla"
    >
      <TextField
        autoCapitalize="words"
        autoComplete="name"
        blurOnSubmit={false}
        disabled={props.busy}
        error={attempted ? validation.errors.fullName : undefined}
        ref={nameRef}
        label="Ad soyad"
        onChangeText={props.onFullNameChange}
        onSubmitEditing={() => emailRef.current?.focus()}
        placeholder="Adın ve soyadın"
        returnKeyType="next"
        submitBehavior="submit"
        textContentType="name"
        value={props.fullName}
      />
      <TextField
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        blurOnSubmit={false}
        disabled={props.busy}
        error={attempted ? validation.errors.email : undefined}
        ref={emailRef}
        keyboardType="email-address"
        label="E-posta adresi"
        onChangeText={props.onEmailChange}
        onSubmitEditing={() => passwordRef.current?.focus()}
        placeholder="ornek@universite.edu.tr"
        returnKeyType="next"
        submitBehavior="submit"
        textContentType="emailAddress"
        value={props.email}
      />
      <PasswordField
        autoComplete="new-password"
        blurOnSubmit={false}
        disabled={props.busy}
        error={attempted ? validation.errors.password : undefined}
        ref={passwordRef}
        label="Şifre"
        onChangeText={props.onPasswordChange}
        onSubmitEditing={() => confirmationRef.current?.focus()}
        placeholder={`En az ${AUTH_PASSWORD_MIN_LENGTH} karakter`}
        returnKeyType="next"
        submitBehavior="submit"
        textContentType="newPassword"
        value={props.password}
      />
      <PasswordField
        autoComplete="new-password"
        disabled={props.busy}
        error={attempted ? validation.errors.passwordConfirmation : undefined}
        ref={confirmationRef}
        label="Şifre tekrar"
        onChangeText={props.onPasswordConfirmationChange}
        onSubmitEditing={submit}
        placeholder="Şifreni yeniden gir"
        returnKeyType="done"
        textContentType="newPassword"
        value={props.passwordConfirmation}
      />
      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.requirements,
          {
            backgroundColor: theme.colors.background.subtle,
            borderColor: theme.colors.border.default,
            borderRadius: theme.radii.control,
            gap: theme.spacing.xxs,
            padding: theme.spacing.sm,
          },
        ]}
      >
        <RequirementLine complete={validation.requirements.minimumLength} label={`En az ${AUTH_PASSWORD_MIN_LENGTH} karakter`} />
        <RequirementLine complete={validation.requirements.confirmationMatches} label="Şifreler birbiriyle aynı" />
      </View>
      <Button fullWidth label="Hesap oluştur" loading={props.busy} onPress={submit} />
      <View style={[styles.accountSwitch, { gap: theme.spacing.xs }]}>
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Zaten hesabın var mı?</Text>
        <Button compact disabled={props.busy} label="Giriş yap" onPress={props.onLogin} variant="ghost" />
      </View>
    </AuthScaffold>
  );
}

function RequirementLine({ complete, label }: { complete: boolean; label: string }) {
  const theme = useTheme();
  return (
    <Text style={[theme.typography.meta, { color: complete ? theme.colors.status.success : theme.colors.text.secondary }]}>
      {complete ? "✓" : "○"} {label}
    </Text>
  );
}

export interface VerificationScreenProps {
  email: string;
  code: string;
  timing: AuthTiming | null;
  busy: boolean;
  feedback?: AuthFeedback | null;
  onCodeChange: (value: string) => void;
  onSubmit: () => void;
  onResend: () => void;
  onChangeEmail: () => void;
  onDismissFeedback?: () => void;
}

export function VerificationScreen(props: VerificationScreenProps) {
  const complete = isVerificationCodeComplete(props.code);
  return (
    <AuthScaffold
      description={`${maskEmail(props.email)} adresine gönderilen ${EMAIL_VERIFICATION_CODE_LENGTH} haneli kodu gir.`}
      eyebrow="2 / 3 · E-posta doğrulama"
      feedback={props.feedback}
      onDismissFeedback={props.onDismissFeedback}
      title="E-postanı doğrula"
    >
      <TimingPanel timing={props.timing} />
      <TextField
        autoCapitalize="none"
        autoComplete="one-time-code"
        autoCorrect={false}
        disabled={props.busy}
        error={props.timing?.expired ? "Kodun süresi doldu. Yeni bir kod iste." : undefined}
        inputMode="numeric"
        keyboardType="number-pad"
        label="Doğrulama kodu"
        maxLength={EMAIL_VERIFICATION_CODE_LENGTH}
        onChangeText={(value) => props.onCodeChange(normalizeNumericCode(value, EMAIL_VERIFICATION_CODE_LENGTH))}
        onSubmitEditing={() => complete && !props.timing?.expired && props.onSubmit()}
        placeholder="0000"
        returnKeyType="done"
        textContentType="oneTimeCode"
        value={props.code}
      />
      <Button
        disabled={props.busy || !complete || props.timing?.expired}
        fullWidth
        label="Doğrulamayı tamamla"
        loading={props.busy}
        onPress={props.onSubmit}
      />
      <Button
        disabled={props.busy || Boolean(props.timing?.resendInSeconds)}
        fullWidth
        label={props.timing?.resendInSeconds ? `Tekrar gönder (${formatDuration(props.timing.resendInSeconds)})` : "Kodu tekrar gönder"}
        onPress={props.onResend}
        variant="secondary"
      />
      <Button compact disabled={props.busy} label="E-posta adresini değiştir" onPress={props.onChangeEmail} variant="ghost" />
    </AuthScaffold>
  );
}

export interface PasswordRecoveryRequestScreenProps {
  email: string;
  timing: AuthTiming | null;
  busy: boolean;
  feedback?: AuthFeedback | null;
  onEmailChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function PasswordRecoveryRequestScreen(props: PasswordRecoveryRequestScreenProps) {
  const [attempted, setAttempted] = useState(false);
  const validation = validateLoginForm({ email: props.email, password: "placeholder" });
  function submit() {
    setAttempted(true);
    if (!validation.errors.email) props.onSubmit();
  }
  return (
    <AuthScaffold
      description="E-posta adresini gir. Hesap uygunsa altı haneli sıfırlama kodu gönderilir."
      eyebrow="Şifre kurtarma · 1 / 3"
      feedback={props.feedback}
      title="Sıfırlama kodu iste"
    >
      <TextField
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        disabled={props.busy}
        error={attempted ? validation.errors.email : undefined}
        keyboardType="email-address"
        label="E-posta adresi"
        onChangeText={props.onEmailChange}
        onSubmitEditing={submit}
        placeholder="ornek@universite.edu.tr"
        returnKeyType="send"
        textContentType="emailAddress"
        value={props.email}
      />
      {props.timing ? <TimingPanel timing={props.timing} /> : null}
      <Button
        disabled={Boolean(props.timing?.resendInSeconds)}
        fullWidth
        label={props.timing?.resendInSeconds ? `Yeni kod iste (${formatDuration(props.timing.resendInSeconds)})` : "Kodu gönder"}
        loading={props.busy}
        onPress={submit}
      />
      <Button compact disabled={props.busy} label="Giriş ekranına dön" onPress={props.onCancel} variant="ghost" />
    </AuthScaffold>
  );
}

export interface PasswordRecoveryCodeScreenProps {
  email: string;
  code: string;
  timing: AuthTiming | null;
  busy: boolean;
  feedback?: AuthFeedback | null;
  onCodeChange: (value: string) => void;
  onContinue: () => void;
  onResend: () => void;
  onBack: () => void;
  onCancel: () => void;
}

export function PasswordRecoveryCodeScreen(props: PasswordRecoveryCodeScreenProps) {
  const complete = isPasswordRecoveryCodeComplete(props.code);
  return (
    <AuthScaffold
      description={`${maskEmail(props.email)} adresine gönderilen altı haneli kodu gir.`}
      eyebrow="Şifre kurtarma · 2 / 3"
      feedback={props.feedback}
      title="Sıfırlama kodunu doğrula"
    >
      <TimingPanel timing={props.timing} />
      <TextField
        autoComplete="one-time-code"
        autoCorrect={false}
        disabled={props.busy}
        error={props.timing?.expired ? "Kodun süresi doldu. Yeni bir kod iste." : undefined}
        inputMode="numeric"
        keyboardType="number-pad"
        label="Sıfırlama kodu"
        maxLength={PASSWORD_RECOVERY_CODE_LENGTH}
        onChangeText={(value) => props.onCodeChange(normalizeNumericCode(value, PASSWORD_RECOVERY_CODE_LENGTH))}
        onSubmitEditing={() => complete && !props.timing?.expired && props.onContinue()}
        placeholder="000000"
        returnKeyType="next"
        textContentType="oneTimeCode"
        value={props.code}
      />
      <Button
        disabled={props.busy || !complete || props.timing?.expired}
        fullWidth
        label="Yeni şifreye devam et"
        onPress={props.onContinue}
      />
      <Button
        disabled={props.busy || Boolean(props.timing?.resendInSeconds)}
        fullWidth
        label={props.timing?.resendInSeconds ? `Yeni kod iste (${formatDuration(props.timing.resendInSeconds)})` : "Yeni kod iste"}
        loading={props.busy}
        onPress={props.onResend}
        variant="secondary"
      />
      <View style={styles.inlineActions}>
        <Button compact disabled={props.busy} label="Geri" onPress={props.onBack} variant="ghost" />
        <Button compact disabled={props.busy} label="İptal et" onPress={props.onCancel} variant="ghost" />
      </View>
    </AuthScaffold>
  );
}

export interface PasswordRecoveryConfirmScreenProps {
  code: string;
  newPassword: string;
  passwordConfirmation: string;
  busy: boolean;
  feedback?: AuthFeedback | null;
  onNewPasswordChange: (value: string) => void;
  onPasswordConfirmationChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  onCancel: () => void;
}

export function PasswordRecoveryConfirmScreen(props: PasswordRecoveryConfirmScreenProps) {
  const [attempted, setAttempted] = useState(false);
  const confirmationRef = useRef<TextInput>(null);
  const validation = validatePasswordRecoveryConfirmation({
    code: props.code,
    newPassword: props.newPassword,
    passwordConfirmation: props.passwordConfirmation,
  });
  const passwordError = attempted && props.newPassword.length < AUTH_PASSWORD_MIN_LENGTH
    ? `Şifren en az ${AUTH_PASSWORD_MIN_LENGTH} karakter olmalıdır.`
    : undefined;
  const confirmationError = attempted && props.passwordConfirmation !== props.newPassword
    ? "Şifreler eşleşmiyor."
    : undefined;
  function submit() {
    setAttempted(true);
    if (validation.valid) props.onSubmit();
  }
  return (
    <AuthScaffold
      description="Güçlü yeni şifreni oluştur. Sıfırlama tamamlandığında tüm eski oturumlar kapatılır."
      eyebrow="Şifre kurtarma · 3 / 3"
      feedback={props.feedback}
      title="Yeni şifreni belirle"
    >
      <PasswordField
        autoComplete="new-password"
        blurOnSubmit={false}
        disabled={props.busy}
        error={passwordError}
        label="Yeni şifre"
        onChangeText={props.onNewPasswordChange}
        onSubmitEditing={() => confirmationRef.current?.focus()}
        placeholder={`En az ${AUTH_PASSWORD_MIN_LENGTH} karakter`}
        returnKeyType="next"
        submitBehavior="submit"
        textContentType="newPassword"
        value={props.newPassword}
      />
      <PasswordField
        autoComplete="new-password"
        disabled={props.busy}
        error={confirmationError}
        ref={confirmationRef}
        label="Yeni şifre tekrar"
        onChangeText={props.onPasswordConfirmationChange}
        onSubmitEditing={submit}
        placeholder="Yeni şifreni yeniden gir"
        returnKeyType="done"
        textContentType="newPassword"
        value={props.passwordConfirmation}
      />
      <Button fullWidth label="Şifreyi yenile" loading={props.busy} onPress={submit} />
      <View style={styles.inlineActions}>
        <Button compact disabled={props.busy} label="Koda dön" onPress={props.onBack} variant="ghost" />
        <Button compact disabled={props.busy} label="İptal et" onPress={props.onCancel} variant="ghost" />
      </View>
    </AuthScaffold>
  );
}

export interface AcademicOnboardingScreenProps {
  fullName: string;
  email: string;
  password: string;
  needsPassword: boolean;
  draft: AcademicOnboardingDraft;
  initialDraft: AcademicOnboardingDraft;
  universities: readonly AcademicOption[];
  faculties: readonly AcademicOption[];
  departments: readonly AcademicOption[];
  classLevels: readonly { value: AcademicClassLevel; label: string }[];
  universitiesLoading: boolean;
  facultiesLoading: boolean;
  departmentsLoading: boolean;
  universitiesError?: string;
  facultiesError?: string;
  departmentsError?: string;
  busy: boolean;
  feedback?: AuthFeedback | null;
  onPasswordChange: (value: string) => void;
  onUniversityChange: (value: string) => void;
  onFacultyChange: (value: string | null) => void;
  onDepartmentChange: (value: string | null) => void;
  onClassLevelChange: (value: AcademicClassLevel | null) => void;
  onRetryUniversities: () => void;
  onRetryFaculties: () => void;
  onRetryDepartments: () => void;
  onSave: () => void;
  onBack: () => void;
  onDismissFeedback?: () => void;
}

export function AcademicOnboardingScreen(props: AcademicOnboardingScreenProps) {
  const theme = useTheme();
  const [attempted, setAttempted] = useState(false);
  const [universityQuery, setUniversityQuery] = useState("");
  const [facultyQuery, setFacultyQuery] = useState("");
  const [departmentQuery, setDepartmentQuery] = useState("");
  const passwordRef = useRef<TextInput>(null);
  const dirty = props.initialDraft.universityId !== props.draft.universityId
    || props.initialDraft.facultyId !== props.draft.facultyId
    || props.initialDraft.departmentId !== props.draft.departmentId
    || props.initialDraft.classLevel !== props.draft.classLevel;
  const filteredUniversities = useMemo(
    () => filterAcademicOptions(props.universities, universityQuery),
    [props.universities, universityQuery],
  );
  const filteredFaculties = useMemo(
    () => filterAcademicOptions(props.faculties, facultyQuery),
    [props.faculties, facultyQuery],
  );
  const filteredDepartments = useMemo(
    () => filterAcademicOptions(props.departments, departmentQuery),
    [props.departments, departmentQuery],
  );
  const classOptions: SelectFieldOption[] = props.classLevels.map((option) => ({
    value: String(option.value),
    label: option.label,
  }));

  useEffect(() => setFacultyQuery(""), [props.draft.universityId]);
  useEffect(() => setDepartmentQuery(""), [props.draft.facultyId]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      requestBack();
      return true;
    });
    return () => subscription.remove();
  }, [dirty, props.busy]);

  function requestBack() {
    if (props.busy) return;
    if (!dirty) {
      props.onBack();
      return;
    }
    Alert.alert(
      "Kaydedilmemiş seçimler",
      "Akademik profilindeki değişiklikler kaybolacak.",
      [
        { text: "Vazgeç", style: "cancel" },
        { text: "Değişiklikleri sil", style: "destructive", onPress: props.onBack },
      ],
    );
  }

  function save() {
    setAttempted(true);
    if (!props.draft.universityId) return;
    if (props.needsPassword && !props.password) {
      passwordRef.current?.focus();
      return;
    }
    props.onSave();
  }

  return (
    <AuthScaffold
      description="İçerikleri sana göre hazırlamak için üniversiteni seç. Diğer alanları şimdi ya da daha sonra tamamlayabilirsin."
      eyebrow="3 / 3 · Akademik profil"
      feedback={props.feedback}
      onDismissFeedback={props.onDismissFeedback}
      title="Akademik profilini tamamla"
    >
      <Card style={{ gap: theme.spacing.xxs }} variant="tonal">
        <Text style={[theme.typography.label, { color: theme.colors.text.secondary }]}>Hesap</Text>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>{props.fullName || "Öğrenci"}</Text>
        <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{maskEmail(props.email)}</Text>
      </Card>

      <SelectorSearch
        disabled={props.busy}
        error={props.universitiesError}
        label="Üniversite ara"
        loading={props.universitiesLoading}
        onQueryChange={setUniversityQuery}
        onRetry={props.onRetryUniversities}
        onValueChange={props.onUniversityChange}
        options={filteredUniversities}
        placeholder="Üniversiteni seç"
        query={universityQuery}
        requiredError={attempted && !props.draft.universityId ? "Üniversite seçimi zorunludur." : undefined}
        selectorLabel="Üniversite"
        value={props.draft.universityId || null}
      />

      <SelectorSearch
        disabled={props.busy || !props.draft.universityId}
        error={props.facultiesError}
        label="Fakülte ara"
        loading={props.facultiesLoading}
        onClear={props.draft.facultyId ? () => props.onFacultyChange(null) : undefined}
        onQueryChange={setFacultyQuery}
        onRetry={props.onRetryFaculties}
        onValueChange={props.onFacultyChange}
        options={filteredFaculties}
        placeholder="İsteğe bağlı"
        query={facultyQuery}
        selectorLabel="Fakülte"
        value={props.draft.facultyId || null}
      />

      <SelectorSearch
        disabled={props.busy || !props.draft.facultyId}
        error={props.departmentsError}
        label="Bölüm ara"
        loading={props.departmentsLoading}
        onClear={props.draft.departmentId ? () => props.onDepartmentChange(null) : undefined}
        onQueryChange={setDepartmentQuery}
        onRetry={props.onRetryDepartments}
        onValueChange={props.onDepartmentChange}
        options={filteredDepartments}
        placeholder="İsteğe bağlı"
        query={departmentQuery}
        selectorLabel="Bölüm"
        value={props.draft.departmentId || null}
      />

      <View style={{ gap: theme.spacing.xs }}>
        <SelectField
          disabled={props.busy || !props.draft.departmentId}
          emptyLabel="Önce bölüm seç."
          label="Sınıf"
          onValueChange={(value) => props.onClassLevelChange(Number(value) as AcademicClassLevel)}
          options={classOptions}
          placeholder="İsteğe bağlı"
          supportingText="Bölümünü seçtiğinde uygun sınıflar gösterilir."
          value={props.draft.classLevel === null ? null : String(props.draft.classLevel)}
        />
        {props.draft.classLevel !== null ? (
          <Button compact disabled={props.busy} label="Sınıf seçimini temizle" onPress={() => props.onClassLevelChange(null)} variant="ghost" />
        ) : null}
      </View>

      {props.needsPassword ? (
        <PasswordField
          autoComplete="password"
          disabled={props.busy}
          error={attempted && !props.password ? "Devam etmek için şifreni gir." : undefined}
          ref={passwordRef}
          label="Hesap şifresi"
          onChangeText={props.onPasswordChange}
          onSubmitEditing={save}
          placeholder="Oturum açmak için şifren"
          returnKeyType="done"
          supportingText="Doğrulama ayrı tamamlandı; akademik seçimini hesabına kaydetmek için güvenli oturum açılır."
          textContentType="password"
          value={props.password}
        />
      ) : null}

      <AcademicReview
        classLevels={props.classLevels}
        departments={props.departments}
        draft={props.draft}
        faculties={props.faculties}
        universities={props.universities}
      />
      <Button fullWidth label="Kaydet ve devam et" loading={props.busy} onPress={save} />
      <Button compact disabled={props.busy} label="Geri dön" onPress={requestBack} variant="ghost" />
    </AuthScaffold>
  );
}

interface SelectorSearchProps {
  label: string;
  selectorLabel: string;
  query: string;
  options: readonly AcademicOption[];
  value: string | null;
  placeholder: string;
  loading: boolean;
  error?: string;
  requiredError?: string;
  disabled?: boolean;
  onQueryChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onRetry: () => void;
  onClear?: () => void;
}

function SelectorSearch(props: SelectorSearchProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <SearchField
        disabled={props.disabled || props.loading}
        label={props.label}
        onChangeText={props.onQueryChange}
        placeholder="Ada göre ara"
        value={props.query}
      />
      <SelectField
        disabled={props.disabled}
        emptyLabel={props.query ? "Aramana uygun sonuç bulunamadı." : "Kullanılabilir seçenek yok."}
        error={props.requiredError ?? props.error}
        label={props.selectorLabel}
        loading={props.loading}
        onValueChange={props.onValueChange}
        options={props.options}
        placeholder={props.placeholder}
        value={props.value}
      />
      {props.error ? <Button compact disabled={props.disabled} label="Seçenekleri tekrar yükle" onPress={props.onRetry} variant="secondary" /> : null}
      {props.onClear ? <Button compact disabled={props.disabled} label={`${props.selectorLabel} seçimini temizle`} onPress={props.onClear} variant="ghost" /> : null}
    </View>
  );
}

function AcademicReview(props: {
  draft: AcademicOnboardingDraft;
  universities: readonly AcademicOption[];
  faculties: readonly AcademicOption[];
  departments: readonly AcademicOption[];
  classLevels: readonly { value: AcademicClassLevel; label: string }[];
}) {
  const theme = useTheme();
  const rows = [
    ["Üniversite", optionLabel(props.universities, props.draft.universityId)],
    ["Fakülte", optionLabel(props.faculties, props.draft.facultyId)],
    ["Bölüm", optionLabel(props.departments, props.draft.departmentId)],
    ["Sınıf", props.classLevels.find((item) => item.value === props.draft.classLevel)?.label ?? "Seçilmedi"],
  ];
  return (
    <Card accessibilityLabel="Akademik seçim özeti" style={{ gap: theme.spacing.sm }} variant="tonal">
      <Text accessibilityRole="header" style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>Seçim özeti</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={[styles.reviewRow, { gap: theme.spacing.sm }]}>
          <Text style={[theme.typography.meta, styles.reviewKey, { color: theme.colors.text.secondary }]}>{label}</Text>
          <Text style={[theme.typography.bodyStrong, styles.reviewValue, { color: theme.colors.text.primary }]}>{value}</Text>
        </View>
      ))}
    </Card>
  );
}

function TimingPanel({ timing }: { timing: AuthTiming | null }) {
  const theme = useTheme();
  if (!timing) return null;
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      style={[
        styles.timing,
        {
          backgroundColor: timing.expired ? theme.colors.status.errorContainer : theme.colors.background.subtle,
          borderColor: timing.expired ? theme.colors.status.error : theme.colors.border.default,
          borderRadius: theme.radii.control,
          gap: theme.spacing.xxs,
          padding: theme.spacing.sm,
        },
      ]}
    >
      <Text style={[theme.typography.metaStrong, { color: timing.expired ? theme.colors.status.onErrorContainer : theme.colors.text.primary }]}>
        {timing.expired ? "Kodun süresi doldu." : `Kodun kalan süresi: ${formatDuration(timing.expiresInSeconds)}`}
      </Text>
      <Text style={[theme.typography.meta, { color: timing.expired ? theme.colors.status.onErrorContainer : theme.colors.text.secondary }]}>
        {timing.resendInSeconds > 0 ? `Yeni kod: ${formatDuration(timing.resendInSeconds)}` : "Yeni kod isteyebilirsin."}
      </Text>
    </View>
  );
}

function filterAcademicOptions(options: readonly AcademicOption[], query: string): AcademicOption[] {
  const normalized = query.trim().toLocaleLowerCase("tr-TR");
  if (!normalized) return [...options];
  return options.filter((option) => `${option.label} ${option.supportingText ?? ""}`.toLocaleLowerCase("tr-TR").includes(normalized));
}

function optionLabel(options: readonly AcademicOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? "Seçilmedi";
}

export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  screenStack: {
    width: "100%",
  },
  identity: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  identityMark: {
    alignItems: "center",
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 48,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  inlineActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  accountSwitch: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  requirements: {
    borderWidth: 1,
  },
  timing: {
    borderWidth: 1,
  },
  reviewRow: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  reviewKey: {
    flexBasis: 90,
    flexShrink: 0,
  },
  reviewValue: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
  },
});
