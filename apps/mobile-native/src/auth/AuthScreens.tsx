import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  BackHandler,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from "react-native";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Banner,
  Button,
  Card,
  IconButton,
  PasswordField,
  TextField,
  referencePalette,
  usePlatformAdaptation,
  useTheme,
  type FeedbackTone,
} from "../design-system";
import {
  AcademicProfileFields,
  AcademicProfileReview,
  type AcademicOption,
} from "../academic/AcademicProfileFields";
import {
  AUTH_PASSWORD_MIN_LENGTH,
  AUTH_PASSWORD_REQUIRED_CHARACTER_GROUPS,
  PASSWORD_RECOVERY_CODE_LENGTH,
  evaluateAuthPassword,
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

export type { AcademicOption } from "../academic/AcademicProfileFields";

interface AuthScaffoldProps {
  title: string;
  description: string;
  eyebrow?: string;
  feedback?: AuthFeedback | null;
  hero?: boolean;
  onDismissFeedback?: () => void;
  children: ReactNode;
}

export interface LoginViewportLayout {
  compact: boolean;
  heroHeight: number;
  sheetGap: number;
  sheetPadding: number;
  titleFontSize: number;
  titleLineHeight: number;
}

export function resolveLoginViewportLayout(safeViewportHeight: number): LoginViewportLayout {
  const height = Number.isFinite(safeViewportHeight) ? Math.max(0, safeViewportHeight) : 0;
  const short = height < 620;
  const compact = height < 760;

  if (short) {
    return {
      compact: true,
      heroHeight: Math.max(84, Math.min(98, height * 0.17)),
      sheetGap: 4,
      sheetPadding: 8,
      titleFontSize: 24,
      titleLineHeight: 29,
    };
  }

  if (compact) {
    return {
      compact: true,
      heroHeight: Math.min(128, height * 0.19),
      sheetGap: 8,
      sheetPadding: 12,
      titleFontSize: 26,
      titleLineHeight: 31,
    };
  }

  return {
    compact: false,
    heroHeight: Math.min(168, height * 0.2),
    sheetGap: 12,
    sheetPadding: 20,
    titleFontSize: 28,
    titleLineHeight: 34,
  };
}

function AuthScaffold({
  title,
  description,
  eyebrow,
  feedback,
  hero = false,
  onDismissFeedback,
  children,
}: AuthScaffoldProps) {
  const theme = useTheme();
  const safeAreaFrame = useSafeAreaFrame();
  const safeAreaInsets = useSafeAreaInsets();
  const safeViewportHeight = Math.max(
    0,
    safeAreaFrame.height - safeAreaInsets.top - safeAreaInsets.bottom,
  );
  const loginLayout = resolveLoginViewportLayout(safeViewportHeight);

  if (hero) {
    return (
      <View
        style={[
          styles.screenStack,
          styles.heroScreenStack,
          {
            height: safeViewportHeight,
          },
        ]}
        testID="login-hero-stack"
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="login-hero-frame"
          style={[
            styles.heroFrame,
            {
              backgroundColor: theme.colors.background.subtle,
              borderColor: theme.colors.border.subtle,
              borderRadius: theme.radii.card,
              height: loginLayout.heroHeight,
            },
          ]}
        >
          <View style={styles.loginPreviewHeader}>
            <View style={[styles.loginPreviewMark, { backgroundColor: theme.colors.action.primary, borderRadius: theme.radii.card }]}>
              <Ionicons color={theme.colors.action.onPrimary} name="calendar-clear-outline" size={23} />
            </View>
            <View style={styles.loginPreviewHeading}>
              <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>Bugünün planı</Text>
              <Text numberOfLines={1} style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Takvim ve duyurular tek görünümde</Text>
            </View>
            <View style={[styles.loginPreviewCount, { backgroundColor: theme.colors.action.secondary, borderRadius: theme.radii.control }]}>
              <Text style={[theme.typography.metaStrong, { color: theme.colors.text.link }]}>3 yaklaşan</Text>
            </View>
          </View>
          <View style={styles.loginPreviewRows}>
            <View style={[styles.loginPreviewRow, { borderTopColor: theme.colors.border.subtle }]}>
              <Ionicons color={referencePalette.academicRed} name="megaphone-outline" size={17} />
              <Text numberOfLines={1} style={[theme.typography.metaStrong, styles.loginPreviewRowTitle, { color: theme.colors.text.primary }]}>Üniversite duyuruları</Text>
              <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Güncel</Text>
            </View>
            {!loginLayout.compact ? (
              <View style={[styles.loginPreviewRow, { borderTopColor: theme.colors.border.subtle }]}>
                <Ionicons color={referencePalette.academicGreen} name="checkmark-circle-outline" size={17} />
                <Text numberOfLines={1} style={[theme.typography.metaStrong, styles.loginPreviewRowTitle, { color: theme.colors.text.primary }]}>Kişisel planlar</Text>
                <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Hatırlatmalı</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View
          accessibilityLabel={`${title} formu`}
          style={[
            styles.heroSheet,
            {
              backgroundColor: theme.colors.background.surface,
              flex: 1,
              gap: loginLayout.sheetGap,
              marginTop: theme.spacing.sm,
              padding: loginLayout.sheetPadding,
            },
          ]}
          testID="login-form-sheet"
        >
          <View style={[styles.heroIdentity, { gap: loginLayout.compact ? theme.spacing.xxs : theme.spacing.xs }]}>
            {eyebrow ? (
              <Text style={[theme.typography.label, { color: theme.colors.text.link }]}>
                {eyebrow}
              </Text>
            ) : null}
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={1.3}
              testID="auth-hero-title"
              style={[
                theme.typography.screenTitle,
                styles.heroTitle,
                {
                  color: theme.colors.text.primary,
                  fontSize: loginLayout.titleFontSize,
                  lineHeight: loginLayout.titleLineHeight,
                },
              ]}
            >
              {title}
            </Text>
            {!feedback ? (
              <Text
                maxFontSizeMultiplier={1.2}
                style={[
                  theme.typography.body,
                  styles.heroDescription,
                  loginLayout.compact && styles.heroDescriptionCompact,
                  { color: theme.colors.text.secondary },
                ]}
              >
                {description}
              </Text>
            ) : null}
          </View>

          {feedback ? (
            <Banner
              message={feedback.text}
              onDismiss={onDismissFeedback}
              title={feedback.tone === "error" ? "İşlem tamamlanamadı" : feedback.tone === "success" ? "Tamamlandı" : "Bilgi"}
              tone={feedback.tone}
            />
          ) : null}

          {children}
        </View>
      </View>
    );
  }

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
          <Ionicons color={theme.colors.text.link} name="calendar-outline" size={24} />
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
        style={[styles.authCard, { gap: theme.spacing.md }]}
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
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const validation = validateLoginForm({ email: props.email, password: props.password });
  const interactionBusy = props.busy || props.googleBusy;

  function submit() {
    setAttempted(true);
    if (!validation.valid) {
      if (validation.errors.email) {
        emailRef.current?.focus();
        return;
      }
      passwordRef.current?.focus();
      return;
    }
    props.onSubmit();
  }

  return (
    <AuthScaffold
      description="Sınavlarını, duyurularını ve akademik takvimini tek yerde takip et."
      feedback={props.feedback}
      hero
      onDismissFeedback={props.onDismissFeedback}
      title="Akademik Takvim"
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
        labelVisuallyHidden
        maxFontSizeMultiplier={1.2}
        onChangeText={props.onEmailChange}
        onSubmitEditing={() => passwordRef.current?.focus()}
        placeholder="E-posta adresiniz"
        ref={emailRef}
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
        labelVisuallyHidden
        maxFontSizeMultiplier={1.2}
        onChangeText={props.onPasswordChange}
        onSubmitEditing={submit}
        placeholder="Şifreniz"
        returnKeyType="done"
        textContentType="password"
        value={props.password}
      />
      <Button
        disabled={interactionBusy}
        fullWidth
        label="Giriş yap"
        leadingIcon={<Ionicons color={theme.colors.action.onPrimary} name="arrow-forward-circle" size={22} />}
        loading={props.busy}
        maxFontSizeMultiplier={1.2}
        onPress={submit}
        style={styles.loginPillButton}
      />
      {props.googleAvailable ? (
        <Button
          disabled={props.busy}
          fullWidth
          label="Google ile devam et"
          leadingIcon={<GoogleColorMark />}
          loading={props.googleBusy}
          maxFontSizeMultiplier={1.2}
          onPress={props.onGoogleSubmit}
          style={[
            styles.loginPillButton,
            {
              backgroundColor: theme.colors.background.surface,
              borderColor: theme.colors.border.subtle,
            },
          ]}
          variant="secondary"
        />
      ) : (
        <Banner message={props.googleUnavailableMessage} title="Google girişi kullanılamıyor" tone="info" />
      )}
      <View style={[styles.loginLinks, { gap: theme.spacing.xs }]}>
        <Button
          compact
          disabled={interactionBusy}
          label="Şifremi unuttum"
          maxFontSizeMultiplier={1.2}
          onPress={props.onForgotPassword}
          variant="ghost"
        />
        <Button
          compact
          disabled={interactionBusy}
          label="Kayıt ol"
          maxFontSizeMultiplier={1.2}
          onPress={props.onRegister}
          variant="ghost"
        />
      </View>
    </AuthScaffold>
  );
}

/** Code-native rendering of Google's multicolor G for the OAuth action. */
function GoogleColorMark() {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.googleMark}
      testID="google-color-mark"
    >
      <View style={styles.googleRing} />
      <View style={[styles.googleRingCutout, { backgroundColor: theme.colors.background.surface }]} />
      <View style={styles.googleCrossbar} />
    </View>
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
    <View
      style={[
        styles.registrationScreen,
        {
          gap: theme.spacing.md,
        },
      ]}
    >
      <View style={styles.registrationTopBar}>
        <IconButton
          accessibilityLabel="Geri dön"
          disabled={props.busy}
          icon={<Ionicons color={theme.colors.text.primary} name="arrow-back" size={25} />}
          onPress={props.onLogin}
          style={{ borderRadius: theme.radii.card }}
        />
      </View>

      <View
        style={[
          styles.registrationHero,
          {
            backgroundColor: theme.colors.background.subtle,
            borderColor: theme.colors.border.subtle,
            borderRadius: theme.radii.card,
            gap: theme.spacing.md,
            padding: theme.spacing.md,
          },
        ]}
      >
        <View
          style={[
            styles.registrationBrand,
            {
              backgroundColor: theme.colors.action.primary,
              borderRadius: theme.radii.card,
            },
          ]}
        >
          <Ionicons color={theme.colors.action.onPrimary} name="person-add-outline" size={25} />
        </View>
        <View style={[styles.registrationHeroCopy, { gap: theme.spacing.xxs }]}>
          <Text style={[theme.typography.label, { color: theme.colors.text.link }]}>Akademik Takvim</Text>
          <Text accessibilityRole="header" style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}>Hesabını oluştur</Text>
          <Text numberOfLines={2} style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Takvimini ve üniversite duyurularını kendi akademik profiline göre takip et.</Text>
        </View>
      </View>

      <View
        accessible
        accessibilityLabel="1 / 3. Hesap oluştur"
        style={[
          styles.registrationProgress,
          {
            backgroundColor: theme.colors.background.surface,
            borderColor: theme.colors.border.subtle,
            borderRadius: theme.radii.card,
            gap: theme.spacing.md,
            padding: theme.spacing.md,
          },
        ]}
      >
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}><Text style={[theme.typography.sectionTitle, { color: theme.colors.text.link }]}>1 / 3</Text>  ·  Hesap oluştur</Text>
        <View style={[styles.progressSegments, { gap: theme.spacing.xxs }]}>
          <View style={[styles.progressSegment, { backgroundColor: theme.colors.action.primary }]} />
          <View style={[styles.progressSegment, { backgroundColor: theme.colors.background.subtle }]} />
          <View style={[styles.progressSegment, { backgroundColor: theme.colors.background.subtle }]} />
        </View>
      </View>

      {props.feedback ? (
        <Banner
          message={props.feedback.text}
          onDismiss={props.onDismissFeedback}
          title={props.feedback.tone === "error" ? "İşlem tamamlanamadı" : props.feedback.tone === "success" ? "Tamamlandı" : "Bilgi"}
          tone={props.feedback.tone}
        />
      ) : null}

      <Card
        accessibilityLabel="Hesap oluşturma formu"
        style={styles.registrationForm}
        testID="registration-form-card"
        variant="elevated"
      >
        <TextField
          autoCapitalize="words"
          autoComplete="name"
          blurOnSubmit={false}
          disabled={props.busy}
          error={attempted ? validation.errors.fullName : undefined}
          frameStyle={styles.registrationFieldFrame}
          inlineLabel
          leadingAccessory={<AuthFieldIcon name="person-outline" />}
          ref={nameRef}
          label="Ad soyad"
          onChangeText={props.onFullNameChange}
          onSubmitEditing={() => emailRef.current?.focus()}
          placeholder="Adınızı ve soyadınızı girin"
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
          frameStyle={styles.registrationFieldFrame}
          inlineLabel
          leadingAccessory={<AuthFieldIcon name="mail-outline" />}
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
          frameStyle={styles.registrationFieldFrame}
          inlineLabel
          leadingAccessory={<AuthFieldIcon name="lock-closed-outline" />}
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
          frameStyle={[styles.registrationFieldFrame, styles.registrationFieldFrameLast]}
          inlineLabel
          leadingAccessory={<AuthFieldIcon name="lock-closed-outline" />}
          ref={confirmationRef}
          label="Şifre tekrar"
          onChangeText={props.onPasswordConfirmationChange}
          onSubmitEditing={submit}
          placeholder="Şifrenizi tekrar girin"
          returnKeyType="done"
          textContentType="newPassword"
          value={props.passwordConfirmation}
        />
      </Card>

      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.passwordStrength,
          {
            backgroundColor: theme.colors.background.surface,
            borderColor: theme.colors.border.subtle,
            borderRadius: theme.radii.card,
            gap: theme.spacing.sm,
            padding: theme.spacing.md,
          },
        ]}
      >
        <View style={[styles.passwordStrengthHeading, { gap: theme.spacing.sm }]}>
          <View style={[styles.passwordShield, { backgroundColor: theme.colors.status.successContainer, borderRadius: theme.radii.pill }]}>
            <Ionicons color={theme.colors.status.success} name="shield-checkmark-outline" size={30} />
          </View>
          <View style={styles.passwordStrengthCopy}>
            <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>Güçlü bir şifre, güvenli bir başlangıç</Text>
            <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Şifren en az {AUTH_PASSWORD_MIN_LENGTH} karakter olmalı ve aşağıdaki gruplardan en az {AUTH_PASSWORD_REQUIRED_CHARACTER_GROUPS} tanesini içermelidir.</Text>
          </View>
        </View>
        <View style={[styles.requirementChips, { gap: theme.spacing.xs }]}>
          <RequirementChip complete={validation.requirements.minimumLength} label={`${AUTH_PASSWORD_MIN_LENGTH}+ karakter`} />
          <RequirementChip complete={validation.requirements.uppercase} label="Büyük harf (A-Z)" />
          <RequirementChip complete={validation.requirements.lowercase} label="Küçük harf (a-z)" />
          <RequirementChip complete={validation.requirements.digit} label="Rakam (0-9)" />
          <RequirementChip complete={validation.requirements.special} label="Özel karakter (!@#?)" />
        </View>
      </View>

      <Button
        fullWidth
        label="Devam et"
        loading={props.busy}
        onPress={submit}
        trailingIcon={<Ionicons color={theme.colors.action.onPrimary} name="arrow-forward" size={23} />}
      />
      <View style={[styles.accountSwitch, { gap: theme.spacing.xs }]}>
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Zaten hesabın var mı?</Text>
        <Button compact disabled={props.busy} label="Giriş yap" onPress={props.onLogin} variant="ghost" />
      </View>
    </View>
  );
}

function AuthFieldIcon({ name }: { name: keyof typeof Ionicons.glyphMap }) {
  const theme = useTheme();
  return (
    <View style={[styles.authFieldIcon, { backgroundColor: theme.colors.action.secondary, borderRadius: theme.radii.control }]}>
      <Ionicons color={theme.colors.action.primary} name={name} size={20} />
    </View>
  );
}

function RequirementChip({ complete, label }: { complete: boolean; label: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}. ${complete ? "Karşılandı" : "Henüz karşılanmadı"}.`}
      style={[
        styles.requirementChip,
        {
          backgroundColor: complete ? theme.colors.status.successContainer : theme.colors.status.errorContainer,
          borderRadius: theme.radii.small,
          gap: theme.spacing.xxs,
        },
      ]}
    >
      <Ionicons color={complete ? theme.colors.status.success : theme.colors.status.error} name={complete ? "checkmark-circle" : "ellipse"} size={14} />
      <Text style={[theme.typography.meta, { color: complete ? theme.colors.status.success : theme.colors.status.error }]}>{label}</Text>
    </View>
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
  const emailRef = useRef<TextInput>(null);
  const validation = validateLoginForm({ email: props.email, password: "placeholder" });
  function submit() {
    setAttempted(true);
    if (validation.errors.email) {
      emailRef.current?.focus();
      return;
    }
    props.onSubmit();
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
        ref={emailRef}
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
  const passwordRef = useRef<TextInput>(null);
  const confirmationRef = useRef<TextInput>(null);
  const validation = validatePasswordRecoveryConfirmation({
    code: props.code,
    newPassword: props.newPassword,
    passwordConfirmation: props.passwordConfirmation,
  });
  const passwordRequirements = evaluateAuthPassword(props.newPassword);
  const passwordError = attempted
    ? !passwordRequirements.minimumLength
      ? `Şifren en az ${AUTH_PASSWORD_MIN_LENGTH} karakter olmalıdır.`
      : !passwordRequirements.characterGroupsComplete
        ? "Şifren büyük harf, küçük harf, rakam ve özel karakter gruplarından en az üçünü içermelidir."
        : undefined
    : undefined;
  const confirmationError = attempted && props.passwordConfirmation !== props.newPassword
    ? "Şifreler eşleşmiyor."
    : undefined;
  function submit() {
    setAttempted(true);
    if (!validation.valid) {
      if (!passwordRequirements.minimumLength || !passwordRequirements.characterGroupsComplete) {
        passwordRef.current?.focus();
      } else {
        confirmationRef.current?.focus();
      }
      return;
    }
    props.onSubmit();
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
        ref={passwordRef}
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
  onSkip?: () => void;
  onDismissFeedback?: () => void;
}

export function AcademicOnboardingScreen(props: AcademicOnboardingScreenProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const [attempted, setAttempted] = useState(false);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const passwordRef = useRef<TextInput>(null);
  const dirty = props.initialDraft.universityId !== props.draft.universityId
    || props.initialDraft.facultyId !== props.draft.facultyId
    || props.initialDraft.departmentId !== props.draft.departmentId
    || props.initialDraft.classLevel !== props.draft.classLevel;
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
    setValidationAttempt((current) => current + 1);
    if (!props.draft.universityId) return;
    if (props.needsPassword && !props.password) {
      passwordRef.current?.focus();
      return;
    }
    props.onSave();
  }

  return (
    <View
      style={[
        styles.onboardingScreen,
        {
          gap: theme.spacing.md,
          marginHorizontal: -adaptation.screenGutter,
          paddingHorizontal: adaptation.screenGutter,
        },
      ]}
    >
      <View style={styles.onboardingTopRow}>
        <IconButton
          accessibilityLabel="Geri dön"
          disabled={props.busy}
          icon={<Ionicons color={theme.colors.text.primary} name="arrow-back" size={25} />}
          onPress={requestBack}
          style={{ borderRadius: theme.radii.card }}
        />
        <View style={[styles.onboardingProgressBlock, { gap: theme.spacing.xxs }]}>
          <View style={styles.onboardingSteps}>
            <StepCircle complete label="1" />
            <View style={[styles.stepLine, { backgroundColor: theme.colors.action.primary }]} />
            <StepCircle complete label="2" />
            <View style={[styles.stepLine, { backgroundColor: theme.colors.action.primary }]} />
            <StepCircle active label="3" />
          </View>
          <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}><Text style={[theme.typography.bodyStrong, { color: theme.colors.text.link }]}>3 / 3</Text>  ·  Akademik profil</Text>
        </View>
        <View style={styles.onboardingTopSpacer} />
      </View>

      <View
        style={[
          styles.onboardingIdentity,
          {
            backgroundColor: theme.colors.background.subtle,
            borderColor: theme.colors.border.subtle,
            borderRadius: theme.radii.card,
            gap: theme.spacing.md,
            padding: theme.spacing.md,
          },
        ]}
      >
        <View style={[styles.onboardingIdentityIcon, { backgroundColor: theme.colors.action.secondary, borderRadius: theme.radii.card }]}>
          <Ionicons color={theme.colors.action.primary} name="school-outline" size={26} />
        </View>
        <View style={[styles.onboardingIdentityCopy, { gap: theme.spacing.xxs }]}>
          <Text accessibilityRole="header" style={[theme.typography.screenTitle, styles.onboardingTitle, { color: theme.colors.text.primary }]}>Akademik profilini tamamla</Text>
          <Text style={[theme.typography.body, styles.onboardingDescription, { color: theme.colors.text.secondary }]}>Üniversiteni seç; takvim ve duyuru kapsamını sana göre hazırlayalım.</Text>
        </View>
      </View>

      {props.feedback ? (
        <Banner
          message={props.feedback.text}
          onDismiss={props.onDismissFeedback}
          title={props.feedback.tone === "error" ? "İşlem tamamlanamadı" : props.feedback.tone === "success" ? "Tamamlandı" : "Bilgi"}
          tone={props.feedback.tone}
        />
      ) : null}

      <AcademicProfileFields
        busy={props.busy}
        classLevels={props.classLevels}
        departments={props.departments}
        departmentsError={props.departmentsError}
        departmentsLoading={props.departmentsLoading}
        draft={props.draft}
        faculties={props.faculties}
        facultiesError={props.facultiesError}
        facultiesLoading={props.facultiesLoading}
        onClassLevelChange={props.onClassLevelChange}
        onDepartmentChange={props.onDepartmentChange}
        onFacultyChange={props.onFacultyChange}
        onRetryDepartments={props.onRetryDepartments}
        onRetryFaculties={props.onRetryFaculties}
        onRetryUniversities={props.onRetryUniversities}
        onUniversityChange={props.onUniversityChange}
        showReview={false}
        universities={props.universities}
        universitiesError={props.universitiesError}
        universitiesLoading={props.universitiesLoading}
        universityRequiredError={attempted && !props.draft.universityId ? "Üniversite seçimi zorunludur." : undefined}
        validationAttempt={validationAttempt}
      />

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

      <AcademicProfileReview
        classLevels={props.classLevels}
        departments={props.departments}
        draft={props.draft}
        faculties={props.faculties}
        universities={props.universities}
      />
      <View
        style={[
          styles.onboardingInfo,
          {
            backgroundColor: theme.colors.status.infoContainer,
            borderRadius: theme.radii.card,
            gap: theme.spacing.sm,
            padding: theme.spacing.md,
          },
        ]}
      >
        <View style={[styles.onboardingInfoIcon, { backgroundColor: theme.colors.action.primary, borderRadius: theme.radii.pill }]}>
          <Ionicons color={theme.colors.action.onPrimary} name="information-outline" size={22} />
        </View>
        <Text style={[theme.typography.bodyStrong, styles.onboardingInfoText, { color: theme.colors.status.onInfoContainer }]}>Doğru bilgilerle sınav tarihleri, kayıt dönemleri ve bölümüne özel duyurular sana özel gelir.</Text>
      </View>
      <Button
        fullWidth
        label="Profili kaydet"
        leadingIcon={<Ionicons color={theme.colors.action.onPrimary} name="checkmark-circle-outline" size={21} />}
        loading={props.busy}
        onPress={save}
      />
      {props.onSkip ? (
        <Button compact disabled={props.busy} label="Şimdilik geç" onPress={props.onSkip} variant="secondary" />
      ) : null}
    </View>
  );
}

function StepCircle({
  label,
  active = false,
  complete = false,
}: {
  label: string;
  active?: boolean;
  complete?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.stepNode}>
      <View
        style={[
          styles.stepCircle,
          {
            backgroundColor: active ? theme.colors.action.primary : theme.colors.background.surface,
            borderColor: theme.colors.action.primary,
            borderRadius: theme.radii.pill,
          },
        ]}
      >
        <Text style={[theme.typography.bodyStrong, { color: active ? theme.colors.action.onPrimary : theme.colors.text.link }]}>{label}</Text>
      </View>
      {complete ? <Ionicons color={theme.colors.action.primary} name="checkmark" size={13} /> : null}
    </View>
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

export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  authCard: {
    padding: 20,
  },
  screenStack: {
    width: "100%",
  },
  identity: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  heroIdentity: {
    alignItems: "flex-start",
    paddingBottom: 2,
    paddingHorizontal: 2,
  },
  heroScreenStack: {
    alignSelf: "stretch",
    minHeight: 0,
    width: "auto",
  },
  heroFrame: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: "100%",
  },
  loginPreviewHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    minHeight: 40,
  },
  loginPreviewMark: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  loginPreviewHeading: {
    flex: 1,
    minWidth: 0,
  },
  loginPreviewCount: {
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  loginPreviewRows: {
    flex: 1,
    justifyContent: "center",
  },
  loginPreviewRow: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    minHeight: 32,
    paddingVertical: 5,
  },
  loginPreviewRowTitle: {
    flex: 1,
    minWidth: 0,
  },
  heroSheet: {
    minHeight: 0,
    overflow: "hidden",
  },
  heroTitle: {
    fontWeight: "800",
    letterSpacing: 0,
    textAlign: "center",
  },
  heroDescription: {
    maxWidth: 390,
    textAlign: "center",
  },
  heroDescriptionCompact: {
    fontSize: 14,
    lineHeight: 19,
  },
  loginPillButton: {
    borderRadius: 999,
  },
  googleMark: {
    height: 24,
    position: "relative",
    width: 24,
  },
  googleRing: {
    borderBottomColor: referencePalette.googleGreen,
    borderLeftColor: referencePalette.googleYellow,
    borderRadius: 999,
    borderRightColor: referencePalette.googleBlue,
    borderTopColor: referencePalette.googleRed,
    borderWidth: 4,
    height: 22,
    left: 1,
    position: "absolute",
    top: 1,
    width: 22,
  },
  googleRingCutout: {
    height: 7,
    position: "absolute",
    right: 0,
    top: 6,
    width: 9,
  },
  googleCrossbar: {
    backgroundColor: referencePalette.googleBlue,
    height: 4,
    position: "absolute",
    right: 0,
    top: 10,
    width: 11,
  },
  loginLinks: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
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
  registrationScreen: {
    alignSelf: "stretch",
    width: "auto",
  },
  registrationTopBar: {
    alignItems: "flex-start",
  },
  registrationHero: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 112,
  },
  registrationHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  registrationBrand: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  registrationProgress: {
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressSegments: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    maxWidth: 150,
  },
  progressSegment: {
    borderRadius: 999,
    flex: 1,
    height: 6,
  },
  registrationForm: {
    overflow: "hidden",
    padding: 0,
  },
  registrationFieldFrame: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 0,
    borderRadius: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    minHeight: 82,
  },
  registrationFieldFrameLast: {
    borderBottomWidth: 0,
  },
  authFieldIcon: {
    alignItems: "center",
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  passwordStrength: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  passwordStrengthHeading: {
    alignItems: "center",
    flexDirection: "row",
  },
  passwordShield: {
    alignItems: "center",
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  passwordStrengthCopy: {
    flex: 1,
    minWidth: 0,
  },
  requirementChips: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  requirementChip: {
    alignItems: "center",
    flexDirection: "row",
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  onboardingScreen: {
    alignSelf: "stretch",
    width: "auto",
  },
  onboardingTopRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  onboardingProgressBlock: {
    alignItems: "center",
    flex: 1,
  },
  onboardingTopSpacer: {
    width: 48,
  },
  onboardingSteps: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  stepNode: {
    alignItems: "center",
    minWidth: 34,
  },
  stepCircle: {
    alignItems: "center",
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  stepLine: {
    height: 1,
    marginTop: 17,
    width: 52,
  },
  onboardingIdentity: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  onboardingIdentityIcon: {
    alignItems: "center",
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  onboardingIdentityCopy: {
    flex: 1,
    minWidth: 0,
  },
  onboardingTitle: {
  },
  onboardingDescription: {
    maxWidth: 470,
  },
  onboardingInfo: {
    alignItems: "center",
    flexDirection: "row",
  },
  onboardingInfoIcon: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  onboardingInfoText: {
    flex: 1,
    minWidth: 0,
  },
  timing: {
    borderWidth: 1,
  },
});
