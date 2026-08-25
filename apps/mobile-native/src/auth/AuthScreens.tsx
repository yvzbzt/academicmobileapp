import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  BackHandler,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
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
  authScreenColors,
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
import { AppleSignInButton } from "./AppleSignInButton";

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

interface AuthViewportMetrics {
  largeText: boolean;
  safeHeight: number;
  safeWidth: number;
  short: boolean;
}

const SHORT_AUTH_VIEWPORT_HEIGHT = 620;
const SHORT_LOGIN_CONTENT_MIN_HEIGHT = 620;
const LARGE_AUTH_FONT_SCALE = 1.3;

function useAuthViewportMetrics(): AuthViewportMetrics {
  const window = useWindowDimensions();
  const safeAreaFrame = useSafeAreaFrame();
  const safeAreaInsets = useSafeAreaInsets();
  const frameHeight = safeAreaFrame.height > 0 ? safeAreaFrame.height : window.height;
  const frameWidth = safeAreaFrame.width > 0 ? safeAreaFrame.width : window.width;
  const viewportHeight = Math.min(frameHeight, window.height);
  const viewportWidth = Math.min(frameWidth, window.width);
  const safeHeight = Math.max(
    0,
    viewportHeight - safeAreaInsets.top - safeAreaInsets.bottom,
  );
  const safeWidth = Math.max(
    0,
    viewportWidth - safeAreaInsets.left - safeAreaInsets.right,
  );
  const largeText = window.fontScale > LARGE_AUTH_FONT_SCALE;

  return {
    largeText,
    safeHeight,
    safeWidth,
    short:
      safeHeight < SHORT_AUTH_VIEWPORT_HEIGHT ||
      largeText,
  };
}

function ShortAuthViewportScroll({
  children,
  minContentHeight,
  testID,
}: {
  children: ReactNode;
  minContentHeight: number;
  testID: string;
}) {
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[
        styles.shortViewportScrollContent,
        { minHeight: minContentHeight },
      ]}
      contentInsetAdjustmentBehavior="never"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      onScrollBeginDrag={Platform.OS === "android" ? Keyboard.dismiss : undefined}
      showsVerticalScrollIndicator={false}
      style={styles.shortViewportScroll}
      testID={testID}
    >
      {children}
    </ScrollView>
  );
}

export interface LoginViewportLayout {
  compact: boolean;
  descriptionReserve: number;
  heroHeight: number;
  iconSize: number;
  sheetGap: number;
  sheetPadding: number;
  socialGap: number;
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
      descriptionReserve: 23,
      heroHeight: Math.max(132, Math.min(152, height * 0.27)),
      iconSize: 17,
      sheetGap: 4,
      sheetPadding: 8,
      socialGap: 8,
      titleFontSize: 24,
      titleLineHeight: 29,
    };
  }

  if (compact) {
    return {
      compact: true,
      descriptionReserve: 23,
      heroHeight: Math.min(188, height * 0.3),
      iconSize: 18,
      sheetGap: 8,
      sheetPadding: 12,
      socialGap: 10,
      titleFontSize: 26,
      titleLineHeight: 31,
    };
  }

  return {
    compact: false,
    descriptionReserve: 31,
    heroHeight: Math.min(350, height * 0.395),
    iconSize: 20,
    sheetGap: 12,
    sheetPadding: 20,
    socialGap: 12,
    titleFontSize: 28,
    titleLineHeight: 34,
  };
}

const LOGIN_FORM_COLORS = {
  fieldIcon: referencePalette.academicBlue,
  fieldIconSurface: authScreenColors.fieldIconSurface,
  fieldSurface: referencePalette.white,
  googleBorder: authScreenColors.googleBorder,
  googleSurface: referencePalette.white,
  link: referencePalette.academicBlue,
  primary: referencePalette.academicBlue,
  primaryBorder: referencePalette.academicBlueDeep,
  sheetSurface: referencePalette.white,
} as const;

const academicCalendarLogo = require("../../assets/design-package/academic-calendar-logo.png");
const loginHeroArtwork = require("../../assets/auth-campus-login-reference-v4.png");

function LoginFieldIcon({ name }: { name: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.loginFieldIconBadge}>
      <Ionicons color={LOGIN_FORM_COLORS.fieldIcon} name={name} size={18} />
    </View>
  );
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
  const viewport = useAuthViewportMetrics();
  const loginLayout = resolveLoginViewportLayout(viewport.safeHeight);
  const showHeroDescription = Boolean(description.trim());

  if (hero) {
    const heroContent = (
      <View
        style={[
          styles.screenStack,
          styles.heroScreenStack,
          {
            height: viewport.short ? undefined : viewport.safeHeight,
            minHeight: viewport.short
              ? Math.max(viewport.safeHeight, SHORT_LOGIN_CONTENT_MIN_HEIGHT)
              : undefined,
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
              borderRadius: 0,
              height: loginLayout.heroHeight,
              marginTop: 0,
            },
          ]}
        >
          <Image
            accessibilityIgnoresInvertColors
            accessibilityLabel="Kampüste akademik hayat"
            resizeMode="cover"
            source={loginHeroArtwork}
            style={styles.heroImage}
          />
        </View>

        {feedback ? (
          <View
            pointerEvents="box-none"
            style={[
              styles.heroFeedbackOverlay,
              {
                paddingHorizontal: loginLayout.sheetPadding,
                top: loginLayout.compact ? 8 : 12,
              },
            ]}
            testID="login-feedback-overlay"
          >
            <Banner
              message={viewport.short ? undefined : feedback.text}
              onDismiss={onDismissFeedback}
              style={[
                styles.heroFeedbackBanner,
                viewport.short && styles.authFeedbackCompact,
              ]}
              title={viewport.short
                ? feedback.text
                : feedback.tone === "error"
                  ? "İşlem tamamlanamadı"
                  : feedback.tone === "success"
                    ? "Tamamlandı"
                    : "Bilgi"}
              tone={feedback.tone}
            />
          </View>
        ) : null}

        <View
          accessibilityLabel={`${title} formu`}
          style={[
            styles.heroSheet,
            {
              backgroundColor: LOGIN_FORM_COLORS.sheetSurface,
              borderTopColor: theme.colors.border.subtle,
              borderTopWidth: StyleSheet.hairlineWidth,
              flex: 1,
              marginTop: loginLayout.compact ? -30 : -34,
              paddingBottom: loginLayout.compact ? 8 : 14,
              paddingHorizontal: loginLayout.sheetPadding,
              paddingTop: loginLayout.compact ? 18 : 28,
            },
            viewport.short && styles.heroSheetShort,
          ]}
          testID="login-form-sheet"
        >
          <View
            style={[
              styles.loginCenteredContent,
              {
                gap: loginLayout.compact ? 4 : 8,
                paddingBottom: 4,
                transform: [{
                  translateY: viewport.short
                    ? 0
                    : loginLayout.compact
                      ? -4
                      : -16,
                }],
              },
              viewport.short && styles.loginCenteredContentShort,
            ]}
            testID="login-form-content"
          >
            <View
              style={[
                styles.heroIdentity,
                {
                  gap: theme.spacing.xxs,
                  marginBottom: 0,
                },
              ]}
            >
              {eyebrow ? (
                <Text style={[theme.typography.label, styles.heroEyebrow, { color: theme.colors.text.link }]}>
                  {eyebrow}
                </Text>
              ) : null}
              <View
                style={[
                  styles.loginBrandRow,
                  viewport.largeText && styles.loginBrandRowLargeText,
                ]}
                testID="login-brand-lockup"
              >
                <Image
                  accessibilityIgnoresInvertColors
                  accessibilityLabel="Akademik Takvim logosu"
                  resizeMode="contain"
                  source={academicCalendarLogo}
                  style={[
                    styles.loginBrandLogo,
                    loginLayout.compact && styles.loginBrandLogoCompact,
                  ]}
                />
                <Text
                  accessibilityRole="header"
                  accessibilityLabel={title}
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={2}
                  testID="auth-hero-title"
                  style={[
                    theme.typography.screenTitle,
                    styles.heroTitle,
                    viewport.largeText && styles.heroTitleLargeText,
                    {
                      color: theme.colors.text.primary,
                      fontSize: loginLayout.titleFontSize,
                      lineHeight: loginLayout.titleLineHeight,
                    },
                  ]}
                >
                  {title === "Akademik Takvim" ? (
                    <>
                      Akademik{"\n"}
                      <Text style={styles.heroTitleAccent}>Takvim</Text>
                    </>
                  ) : title}
                </Text>
              </View>
              {showHeroDescription ? (
                <>
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
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.heroDescriptionUnderline}
                  />
                </>
              ) : null}
            </View>

            {children}
          </View>
        </View>
      </View>
    );

    return (
      <ShortAuthViewportScroll
        minContentHeight={Math.max(
          viewport.safeHeight,
          SHORT_LOGIN_CONTENT_MIN_HEIGHT,
        )}
        testID={viewport.short
          ? "auth-short-viewport-scroll-login"
          : "auth-login-scroll"}
      >
        {heroContent}
      </ShortAuthViewportScroll>
    );
  }

  const formContent = (
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

  return viewport.short ? (
    <ShortAuthViewportScroll
      minContentHeight={viewport.safeHeight}
      testID="auth-short-viewport-scroll-form"
    >
      {formContent}
    </ShortAuthViewportScroll>
  ) : formContent;
}

export interface LoginScreenProps {
  email: string;
  password: string;
  busy: boolean;
  googleBusy: boolean;
  googleAvailable: boolean;
  googleUnavailableMessage: string;
  appleBusy: boolean;
  appleAvailable: boolean;
  feedback?: AuthFeedback | null;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onGoogleSubmit: () => void;
  onAppleSubmit: () => void;
  onForgotPassword: () => void;
  onVerificationRecovery: () => void;
  onRegister: () => void;
  onDismissFeedback?: () => void;
}

export function LoginScreen(props: LoginScreenProps) {
  const theme = useTheme();
  const viewport = useAuthViewportMetrics();
  const [attempted, setAttempted] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const validation = validateLoginForm({ email: props.email, password: props.password });
  const interactionBusy = props.busy || props.googleBusy || props.appleBusy;

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
    Keyboard.dismiss();
    props.onSubmit();
  }

  return (
    <AuthScaffold
      description="Üniversite hayatını planla, zamanı verimli kullan."
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
        frameStyle={[styles.loginInputFrame, styles.loginPillField]}
        keyboardType="email-address"
        label="E-posta adresi"
        labelVisuallyHidden
        leadingAccessory={<LoginFieldIcon name="mail-outline" />}
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
        frameStyle={[styles.loginInputFrame, styles.loginPillField]}
        ref={passwordRef}
        label="Şifre"
        labelVisuallyHidden
        leadingAccessory={<LoginFieldIcon name="lock-closed-outline" />}
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
        loading={props.busy}
        maxFontSizeMultiplier={1.2}
        onPress={submit}
        style={[
          styles.loginPillButton,
          !interactionBusy && styles.loginPrimaryButton,
        ]}
        trailingIcon={!interactionBusy ? <Ionicons color={referencePalette.white} name="arrow-forward" size={18} /> : undefined}
      />
      {props.appleAvailable ? (
        <AppleSignInButton
          busy={props.busy || props.googleBusy || props.appleBusy}
          onPress={props.onAppleSubmit}
          testID="apple-sign-in-button"
        />
      ) : null}
      {props.googleAvailable ? (
        <Button
          disabled={props.busy || props.appleBusy}
          fullWidth
          label="Google ile devam et"
          leadingIcon={<GoogleColorMark />}
          loading={props.googleBusy}
          maxFontSizeMultiplier={1.2}
          onPress={() => {
            Keyboard.dismiss();
            props.onGoogleSubmit();
          }}
          style={[
            styles.loginPillButton,
            !(props.busy || props.googleBusy || props.appleBusy) && styles.loginGoogleButton,
          ]}
          labelStyle={!(props.busy || props.googleBusy || props.appleBusy) && styles.loginGoogleLabel}
          variant="secondary"
        />
      ) : (
        <Banner message={props.googleUnavailableMessage} title="Google girişi kullanılamıyor" tone="info" />
      )}
      <View
        style={[
          styles.loginLinks,
          { gap: theme.spacing.xs },
          viewport.largeText && styles.loginLinksLargeText,
        ]}
        testID="login-link-row"
      >
        <Button
          compact
          disabled={interactionBusy}
          fullWidth={viewport.largeText}
          label="Şifremi unuttum"
          labelStyle={!interactionBusy && styles.loginLinkLabel}
          leadingIcon={!interactionBusy ? <Ionicons color={LOGIN_FORM_COLORS.link} name="lock-closed-outline" size={17} /> : undefined}
          maxFontSizeMultiplier={1.2}
          onPress={() => {
            Keyboard.dismiss();
            props.onForgotPassword();
          }}
          variant="ghost"
        />
        <Button
          compact
          disabled={interactionBusy}
          fullWidth={viewport.largeText}
          label="Kayıt ol"
          labelStyle={!interactionBusy && styles.loginLinkLabel}
          leadingIcon={!interactionBusy ? <Ionicons color={LOGIN_FORM_COLORS.link} name="person-add-outline" size={18} /> : undefined}
          maxFontSizeMultiplier={1.2}
          onPress={() => {
            Keyboard.dismiss();
            props.onRegister();
          }}
          variant="ghost"
        />
      </View>
    </AuthScaffold>
  );
}

/** Code-native rendering of Google's multicolor G for the OAuth action. */
function GoogleColorMark() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.googleMark}
      testID="google-color-mark"
    >
      <View style={styles.googleRing} />
      <View style={[styles.googleRingCutout, { backgroundColor: LOGIN_FORM_COLORS.googleSurface }]} />
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
  const viewport = useAuthViewportMetrics();
  const registrationCompact = viewport.safeHeight < 900 || viewport.safeWidth < 380;
  const [attempted, setAttempted] = useState(false);
  const nameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmationRef = useRef<TextInput>(null);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [legalAttempted, setLegalAttempted] = useState(false);
  const validation = validateRegistrationForm(props);
  const fullNameValid = Boolean(props.fullName.trim()) && !validation.errors.fullName;
  const emailValid = Boolean(props.email.trim()) && !validation.errors.email;
  const passwordRuleText = `En az ${AUTH_PASSWORD_MIN_LENGTH} karakter; büyük/küçük harf, rakam ve özel karakter gruplarından en az ${AUTH_PASSWORD_REQUIRED_CHARACTER_GROUPS} tanesi.`;

  function submit() {
    setAttempted(true);
    setLegalAttempted(true);
    if (!validation.valid) {
      if (validation.errors.fullName) nameRef.current?.focus();
      else if (validation.errors.email) emailRef.current?.focus();
      else if (validation.errors.password) passwordRef.current?.focus();
      else confirmationRef.current?.focus();
      return;
    }
    if (!legalAccepted) {
      Keyboard.dismiss();
      return;
    }
    Keyboard.dismiss();
    props.onSubmit();
  }

  const registrationContent = (
    <View
      style={[
        styles.registrationScreen,
        {
          gap: theme.spacing.sm,
          justifyContent: viewport.safeHeight >= 1000 ? "center" : "flex-start",
        },
        registrationCompact && styles.registrationScreenCompact,
      ]}
    >
      <View style={styles.registrationBrandBar}>
        <Pressable
          accessibilityLabel="Geri dön"
          accessibilityRole="button"
          disabled={props.busy}
          hitSlop={8}
          onPress={() => {
            Keyboard.dismiss();
            props.onLogin();
          }}
          style={({ pressed }) => [
            styles.registrationBackButton,
            pressed && styles.authControlPressed,
          ]}
        >
          <Ionicons color={referencePalette.navy} name="arrow-back" size={27} />
        </Pressable>
        <View
          accessibilityLabel="Akademik Takvim"
          style={styles.registrationBrandIdentity}
        >
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            source={academicCalendarLogo}
            style={[
              styles.registrationBrandLogo,
              registrationCompact && styles.registrationBrandLogoCompact,
            ]}
          />
          <Text
            maxFontSizeMultiplier={1.15}
            numberOfLines={2}
            style={[theme.typography.bodyStrong, styles.registrationBrandTitle]}
          >
            Akademik Takvim
          </Text>
        </View>
        <View accessibilityElementsHidden style={styles.registrationBrandSpacer} />
      </View>

      <View style={[styles.registrationHeader, { gap: theme.spacing.xxs }]}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.registrationHeaderSparkle}
        >
          <Ionicons
            color={referencePalette.academicBlue}
            name="sparkles-outline"
            size={20}
          />
        </View>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          style={[
            theme.typography.screenTitle,
            styles.registrationTitle,
            registrationCompact && styles.registrationTitleCompact,
          ]}
        >
          Hesabını oluştur
        </Text>
        <Text
          maxFontSizeMultiplier={1.15}
          style={[
            theme.typography.body,
            styles.registrationDescription,
            { color: theme.colors.text.secondary },
          ]}
        >
          Öğrenci hesabın için gerekli bilgileri doldur.
        </Text>
      </View>

      {props.feedback ? (
        <Banner
          message={props.feedback.text}
          onDismiss={props.onDismissFeedback}
          title={props.feedback.tone === "error" ? "İşlem tamamlanamadı" : props.feedback.tone === "success" ? "Tamamlandı" : "Bilgi"}
          tone={props.feedback.tone}
        />
      ) : null}

      <View
        accessibilityLabel="Hesap oluşturma formu"
        style={[
          styles.registrationForm,
          !registrationCompact && styles.registrationFormSpacious,
          {
            gap: theme.spacing.sm,
          },
        ]}
        testID="registration-form-card"
      >
        <TextField
          autoCapitalize="words"
          autoComplete="name"
          blurOnSubmit={false}
          disabled={props.busy}
          error={attempted ? validation.errors.fullName : undefined}
          frameStyle={styles.registrationInputFrame}
          leadingAccessory={<AuthFieldIcon name="person-outline" />}
          trailingAccessory={fullNameValid ? <RegistrationValidAccessory /> : undefined}
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
          frameStyle={styles.registrationInputFrame}
          leadingAccessory={<AuthFieldIcon name="mail-outline" />}
          trailingAccessory={emailValid ? <RegistrationValidAccessory /> : undefined}
          ref={emailRef}
          keyboardType="email-address"
          label="E-posta adresi"
          onChangeText={props.onEmailChange}
          onSubmitEditing={() => passwordRef.current?.focus()}
          placeholder="E-posta adresinizi girin"
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
          frameStyle={styles.registrationInputFrame}
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
        <PasswordStrengthMeter password={props.password} ruleText={passwordRuleText} />
        <PasswordField
          autoComplete="new-password"
          disabled={props.busy}
          error={attempted ? validation.errors.passwordConfirmation : undefined}
          frameStyle={styles.registrationInputFrame}
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
        <View style={styles.registrationDivider} />
        <View
          style={[
            styles.legalConsent,
            {
              backgroundColor: theme.colors.background.surface,
              gap: theme.spacing.xs,
            },
          ]}
        >
          <CheckRow
            checked={legalAccepted}
            disabled={props.busy}
            error={legalAttempted && !legalAccepted ? "Devam etmek için kayıt onaylarını kabul et." : undefined}
            label="KVKK Aydınlatma Metni, Gizlilik Politikası ve Kullanım Koşulları'nı okudum ve kabul ediyorum."
            onChange={setLegalAccepted}
            testID="registration-legal-consent"
          />
        </View>
      </View>

      <Button
        fullWidth
        label="Devam et"
        loading={props.busy}
        onPress={submit}
        style={[
          styles.loginPillButton,
          styles.registrationPrimaryButton,
          !props.busy && styles.loginPrimaryButton,
        ]}
        trailingIcon={<Ionicons color={referencePalette.white} name="arrow-forward" size={23} />}
      />
      <View style={[styles.accountSwitch, { gap: theme.spacing.xs }]}>
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Zaten hesabın var mı?</Text>
        <Button
          compact
          disabled={props.busy}
          label="Giriş yap"
          onPress={() => {
            Keyboard.dismiss();
            props.onLogin();
          }}
          variant="ghost"
        />
      </View>
    </View>
  );

  return (
    <ShortAuthViewportScroll
      minContentHeight={viewport.safeHeight}
      testID={viewport.short
        ? "auth-short-viewport-scroll-registration"
        : "auth-registration-scroll"}
    >
      {registrationContent}
    </ShortAuthViewportScroll>
  );
}

type PasswordStrengthLevel = 1 | 2 | 3 | 4;

const PASSWORD_STRENGTH_LABELS: Record<PasswordStrengthLevel, string> = {
  1: "Zayıf",
  2: "Orta",
  3: "İyi",
  4: "Güçlü",
};

function passwordStrengthLevel(password: string): PasswordStrengthLevel {
  const requirements = evaluateAuthPassword(password);
  if (requirements.minimumLength && requirements.characterGroupCount === 4 && password.length >= 12) {
    return 4;
  }
  if (requirements.minimumLength && requirements.characterGroupsComplete) {
    return 3;
  }
  if (requirements.characterGroupCount >= 2 || password.length >= AUTH_PASSWORD_MIN_LENGTH) {
    return 2;
  }
  return 1;
}

function PasswordStrengthMeter({
  password,
  ruleText,
}: {
  password: string;
  ruleText: string;
}) {
  const theme = useTheme();
  const level = password ? passwordStrengthLevel(password) : 0;

  if (!password) return null;

  const strengthLabel = PASSWORD_STRENGTH_LABELS[level as PasswordStrengthLevel];
  const staticFillColor = level === 1
    ? authScreenColors.passwordWeak
    : level === 2
      ? authScreenColors.passwordMedium
      : level === 3
        ? authScreenColors.passwordGood
        : authScreenColors.passwordStrong;
  const activeSegmentCount = level === 1 ? 1 : level === 2 ? 3 : level === 3 ? 5 : 6;
  const labelColor = level === 1
    ? authScreenColors.passwordWeakText
    : level === 2
      ? authScreenColors.passwordMediumText
      : level === 3
        ? authScreenColors.passwordGoodText
        : authScreenColors.passwordStrongText;

  return (
    <View
      accessibilityLabel={`Şifre gücü: ${strengthLabel}. ${ruleText}`}
      accessibilityRole="summary"
      style={styles.passwordStrength}
      testID="registration-password-strength"
    >
      <View style={styles.passwordStrengthVisualRow}>
        <View style={styles.passwordStrengthSegments}>
          {Array.from({ length: 6 }, (_, segmentIndex) => (
            <View
              key={`password-strength-${segmentIndex}`}
              style={[
                styles.passwordStrengthSegment,
                {
                  backgroundColor: segmentIndex < activeSegmentCount
                    ? staticFillColor
                    : authScreenColors.disabledSurface,
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.passwordStrengthStatus}>
          <Ionicons color={labelColor} name="shield-checkmark" size={17} />
          <Text
            maxFontSizeMultiplier={1.15}
            style={[
              theme.typography.label,
              styles.passwordStrengthLabel,
              { color: labelColor },
            ]}
          >
            {strengthLabel}
          </Text>
        </View>
      </View>
      <Text
        maxFontSizeMultiplier={1.15}
        style={[theme.typography.meta, styles.passwordRuleText, { color: theme.colors.text.secondary }]}
      >
        {ruleText}
      </Text>
    </View>
  );
}

function CheckRow({
  checked,
  disabled = false,
  error,
  label,
  onChange,
  testID,
}: {
  checked: boolean;
  disabled?: boolean;
  error?: string;
  label: string;
  onChange: (value: boolean) => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.checkRowStack, { gap: theme.spacing.xxs }]}>
      <Pressable
        accessibilityHint={error}
        accessibilityLabel={label}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        disabled={disabled}
        onPress={() => onChange(!checked)}
        style={({ pressed }) => [
          styles.checkRow,
          {
            backgroundColor: pressed ? theme.colors.action.ghostPressed : "transparent",
            borderRadius: theme.radii.control,
            gap: theme.spacing.sm,
            opacity: disabled ? 0.65 : 1,
          },
        ]}
        testID={testID}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.checkboxBox,
            {
              backgroundColor: checked ? LOGIN_FORM_COLORS.primary : theme.colors.background.surface,
              borderColor: checked ? LOGIN_FORM_COLORS.primaryBorder : theme.colors.border.default,
              borderRadius: theme.radii.small,
            },
          ]}
        >
          {checked ? <Ionicons color={referencePalette.white} name="checkmark" size={17} /> : null}
        </View>
        <Text style={[theme.typography.metaStrong, styles.checkRowLabel, { color: theme.colors.text.primary }]}>{label}</Text>
      </Pressable>
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[theme.typography.meta, { color: theme.colors.status.error }]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function AuthFieldIcon({ name }: { name: keyof typeof Ionicons.glyphMap }) {
  const theme = useTheme();
  return (
    <View style={[styles.authFieldIcon, { backgroundColor: LOGIN_FORM_COLORS.fieldIconSurface, borderRadius: theme.radii.control }]}>
      <Ionicons color={LOGIN_FORM_COLORS.fieldIcon} name={name} size={19} />
    </View>
  );
}

function RegistrationValidAccessory() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.registrationValidAccessory}
    >
      <Ionicons
        color={referencePalette.academicGreen}
        name="checkmark-circle-outline"
        size={24}
      />
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
  shortViewportScroll: {
    flex: 1,
    width: "100%",
  },
  shortViewportScrollContent: {
    flexGrow: 1,
    width: "100%",
  },
  screenStack: {
    width: "100%",
  },
  identity: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  heroIdentity: {
    alignItems: "center",
    paddingBottom: 2,
    paddingHorizontal: 2,
    width: "100%",
  },
  loginBrandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    maxWidth: "100%",
  },
  loginBrandRowLargeText: {
    flexDirection: "column",
    gap: 4,
    width: "100%",
  },
  loginBrandLogo: {
    height: 64,
    width: 64,
  },
  loginBrandLogoCompact: {
    height: 50,
    width: 50,
  },
  heroScreenStack: {
    alignSelf: "stretch",
    backgroundColor: LOGIN_FORM_COLORS.sheetSurface,
    minHeight: 0,
    width: "auto",
  },
  heroFrame: {
    borderWidth: 0,
    overflow: "hidden",
    width: "100%",
  },
  heroImage: {
    height: "100%",
    width: "100%",
  },
  heroSheet: {
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    elevation: 0,
    justifyContent: "space-between",
    minHeight: 0,
    overflow: "visible",
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    zIndex: 2,
  },
  heroFeedbackOverlay: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 4,
  },
  heroFeedbackBanner: {
    maxWidth: 500,
    width: "100%",
  },
  heroSheetShort: {
    flex: 0,
    overflow: "visible",
  },
  loginCenteredContent: {
    alignSelf: "center",
    flex: 1,
    justifyContent: "center",
    maxWidth: 500,
    minHeight: 0,
    width: "100%",
  },
  loginCenteredContentShort: {
    flex: 0,
    justifyContent: "flex-start",
  },
  heroEyebrow: {
    textAlign: "center",
    width: "100%",
  },
  heroTitle: {
    flexShrink: 1,
    fontWeight: "800",
    letterSpacing: 0,
    maxWidth: 150,
    textAlign: "center",
    width: "auto",
  },
  heroTitleLargeText: {
    flexShrink: 0,
    maxWidth: "100%",
    width: "100%",
  },
  heroTitleAccent: {
    color: referencePalette.academicBlue,
  },
  heroDescription: {
    fontSize: 15,
    lineHeight: 21,
    maxWidth: 390,
    textAlign: "center",
  },
  heroDescriptionCompact: {
    fontSize: 14,
    lineHeight: 19,
  },
  heroDescriptionUnderline: {
    backgroundColor: referencePalette.academicTeal,
    borderRadius: 3,
    height: 3,
    marginTop: 1,
    width: 54,
  },
  authFeedbackCompact: {
    gap: 4,
    padding: 8,
  },
  loginPillButton: {
    borderRadius: 999,
    minHeight: 56,
  },
  loginFieldIconBadge: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 999,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  loginInputFrame: {
    backgroundColor: LOGIN_FORM_COLORS.fieldSurface,
    shadowColor: referencePalette.navy,
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.035,
    shadowRadius: 6,
  },
  loginPillField: {
    borderRadius: 999,
    minHeight: 56,
    overflow: "hidden",
  },
  loginPrimaryButton: {
    backgroundColor: LOGIN_FORM_COLORS.primary,
    borderColor: LOGIN_FORM_COLORS.primaryBorder,
    shadowColor: LOGIN_FORM_COLORS.primaryBorder,
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 2,
  },
  loginGoogleButton: {
    backgroundColor: LOGIN_FORM_COLORS.googleSurface,
    borderColor: LOGIN_FORM_COLORS.googleBorder,
  },
  loginGoogleLabel: {
    color: LOGIN_FORM_COLORS.link,
  },
  loginLinkLabel: {
    color: LOGIN_FORM_COLORS.link,
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
  loginLinksLargeText: {
    alignItems: "stretch",
    flexDirection: "column",
    width: "100%",
  },
  checkRowStack: {
    width: "100%",
  },
  checkRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  checkboxBox: {
    alignItems: "center",
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  checkRowLabel: {
    flex: 1,
    minWidth: 0,
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
    backgroundColor: referencePalette.white,
    width: "auto",
  },
  registrationScreenCompact: {
    paddingVertical: 0,
  },
  registrationBrandBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 70,
  },
  registrationBackButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  registrationBrandIdentity: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    flex: 1,
    minWidth: 0,
  },
  registrationBrandLogo: {
    height: 62,
    width: 62,
  },
  registrationBrandLogoCompact: {
    height: 54,
    width: 54,
  },
  registrationBrandSpacer: {
    width: 48,
  },
  registrationBrandTitle: {
    color: referencePalette.navy,
    flexShrink: 1,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 22,
    maxWidth: 130,
  },
  registrationHeader: {
    alignItems: "center",
    paddingHorizontal: 4,
    paddingTop: 10,
    position: "relative",
  },
  registrationHeaderSparkle: {
    left: 0,
    position: "absolute",
    top: 50,
  },
  registrationTitle: {
    color: referencePalette.navy,
    fontSize: 36,
    fontWeight: "800",
    lineHeight: 42,
    letterSpacing: 0,
    textAlign: "center",
  },
  registrationTitleCompact: {
    fontSize: 31,
    lineHeight: 37,
  },
  registrationDescription: {
    maxWidth: 440,
    textAlign: "center",
  },
  registrationForm: {
    alignSelf: "stretch",
    backgroundColor: referencePalette.white,
    borderColor: referencePalette.academicBorderCool,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 3,
    padding: 18,
    shadowColor: referencePalette.navy,
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  registrationFormSpacious: {
    padding: 24,
  },
  registrationInputFrame: {
    alignSelf: "center",
    backgroundColor: referencePalette.white,
    borderColor: referencePalette.academicBlueBorderMuted,
    borderRadius: 17,
    borderWidth: 1,
    minHeight: 58,
    width: "100%",
  },
  authFieldIcon: {
    alignItems: "center",
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  legalConsent: {
    borderWidth: 0,
    borderRadius: 14,
    padding: 4,
  },
  registrationDivider: {
    backgroundColor: referencePalette.academicBorderCool,
    height: StyleSheet.hairlineWidth,
    marginTop: 2,
    width: "100%",
  },
  passwordStrength: {
    alignItems: "stretch",
    gap: 6,
    paddingHorizontal: 4,
    width: "100%",
  },
  passwordStrengthVisualRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  passwordStrengthSegments: {
    flex: 1,
    flexDirection: "row",
    gap: 5,
    minWidth: 0,
  },
  passwordStrengthSegment: {
    borderRadius: 4,
    flex: 1,
    height: 7,
  },
  passwordStrengthStatus: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 5,
  },
  passwordRuleText: {
    textAlign: "left",
  },
  passwordStrengthLabel: {
    fontWeight: "700",
    textAlign: "right",
  },
  registrationValidAccessory: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  registrationPrimaryButton: {
    minHeight: 58,
  },
  authControlPressed: {
    backgroundColor: referencePalette.academicBlueSoft,
    opacity: 0.84,
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
