import type { ReactElement, ReactNode } from "react";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  act,
  fireEvent,
  fireEventAsync,
  renderAsync,
  screen,
  userEvent,
  within,
} from "@testing-library/react-native";
import {
  AcademicOnboardingScreen,
  LoginScreen,
  PasswordRecoveryCodeScreen,
  PasswordRecoveryConfirmScreen,
  PasswordRecoveryRequestScreen,
  RegistrationScreen,
  resolveLoginViewportLayout,
  VerificationScreen,
  type AcademicOnboardingScreenProps,
  type LoginScreenProps,
  type PasswordRecoveryCodeScreenProps,
  type PasswordRecoveryConfirmScreenProps,
  type PasswordRecoveryRequestScreenProps,
  type RegistrationScreenProps,
  type VerificationScreenProps,
} from "../../src/auth/AuthScreens";
import type { AcademicOnboardingDraft } from "../../src/auth/auth-ui";
import {
  ThemeProvider,
  type ThemeProviderProps,
} from "../../src/design-system/theme";
import {
  NativeTestEnvironmentProvider,
  signedInLargeTextFixture,
} from "../fixtures/native-test-environment";

const safeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function authTestTree(
  child: ReactElement,
  overrides: Omit<ThemeProviderProps, "children"> = {},
  frame: { width?: number; height?: number } = {},
) {
  const width = frame.width ?? overrides.windowWidth ?? 390;
  const height = frame.height ?? 844;
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width, height },
        insets: safeAreaInsets,
      }}
    >
      <ThemeProvider
        liquidGlassAvailable={false}
        platform="android"
        preference="light"
        reducedMotion
        reducedTransparency={false}
        windowWidth={390}
        {...overrides}
      >
        {child}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function renderAuth(
  child: ReactElement,
  overrides: Omit<ThemeProviderProps, "children"> = {},
  frame: { width?: number; height?: number } = {},
) {
  return renderAsync(authTestTree(child, overrides, frame));
}

function spyOnInputFocus(label: string) {
  const input = screen.getByLabelText(label);
  let current: typeof input | null = input;
  while (current) {
    const instance = current.instance as { focus?: () => void } | null;
    if (instance && typeof instance.focus === "function") {
      return jest.spyOn(instance, "focus");
    }
    current = current.parent;
  }
  throw new Error(`No focusable native instance found for ${label}`);
}

function loginProps(overrides: Partial<LoginScreenProps> = {}): LoginScreenProps {
  return {
    email: "student@example.edu",
    password: "valid-password",
    busy: false,
    googleBusy: false,
    googleAvailable: true,
    googleUnavailableMessage: "Google yapılandırması eksik.",
    feedback: null,
    onEmailChange: jest.fn(),
    onPasswordChange: jest.fn(),
    onSubmit: jest.fn(),
    onGoogleSubmit: jest.fn(),
    onForgotPassword: jest.fn(),
    onVerificationRecovery: jest.fn(),
    onRegister: jest.fn(),
    onDismissFeedback: jest.fn(),
    ...overrides,
  };
}

function registrationProps(
  overrides: Partial<RegistrationScreenProps> = {},
): RegistrationScreenProps {
  return {
    fullName: "Ada Lovelace",
    email: "ada@example.edu",
    password: "Strong1!",
    passwordConfirmation: "Strong1!",
    busy: false,
    feedback: null,
    onFullNameChange: jest.fn(),
    onEmailChange: jest.fn(),
    onPasswordChange: jest.fn(),
    onPasswordConfirmationChange: jest.fn(),
    onSubmit: jest.fn(),
    onLogin: jest.fn(),
    onDismissFeedback: jest.fn(),
    ...overrides,
  };
}

function verificationProps(
  overrides: Partial<VerificationScreenProps> = {},
): VerificationScreenProps {
  return {
    email: "Student.Name@Example.EDU",
    code: "",
    timing: { expired: false, expiresInSeconds: 95, resendInSeconds: 30 },
    busy: false,
    feedback: null,
    onCodeChange: jest.fn(),
    onSubmit: jest.fn(),
    onResend: jest.fn(),
    onChangeEmail: jest.fn(),
    onDismissFeedback: jest.fn(),
    ...overrides,
  };
}

function recoveryRequestProps(
  overrides: Partial<PasswordRecoveryRequestScreenProps> = {},
): PasswordRecoveryRequestScreenProps {
  return {
    email: "student@example.edu",
    timing: null,
    busy: false,
    feedback: null,
    onEmailChange: jest.fn(),
    onSubmit: jest.fn(),
    onCancel: jest.fn(),
    ...overrides,
  };
}

function recoveryCodeProps(
  overrides: Partial<PasswordRecoveryCodeScreenProps> = {},
): PasswordRecoveryCodeScreenProps {
  return {
    email: "student@example.edu",
    code: "",
    timing: { expired: false, expiresInSeconds: 600, resendInSeconds: 0 },
    busy: false,
    feedback: null,
    onCodeChange: jest.fn(),
    onContinue: jest.fn(),
    onResend: jest.fn(),
    onBack: jest.fn(),
    onCancel: jest.fn(),
    ...overrides,
  };
}

function recoveryConfirmProps(
  overrides: Partial<PasswordRecoveryConfirmScreenProps> = {},
): PasswordRecoveryConfirmScreenProps {
  return {
    code: "123456",
    newPassword: "Strong1!",
    passwordConfirmation: "Strong1!",
    busy: false,
    feedback: null,
    onNewPasswordChange: jest.fn(),
    onPasswordConfirmationChange: jest.fn(),
    onSubmit: jest.fn(),
    onBack: jest.fn(),
    onCancel: jest.fn(),
    ...overrides,
  };
}

const emptyDraft: AcademicOnboardingDraft = {
  universityId: "",
  facultyId: "",
  departmentId: "",
  classLevel: null,
};

const completeDraft: AcademicOnboardingDraft = {
  universityId: "ankara",
  facultyId: "engineering",
  departmentId: "computer",
  classLevel: 4,
};

const universities = [
  { value: "ankara", label: "Ankara Üniversitesi", supportingText: "Ankara" },
  { value: "ege", label: "Ege Üniversitesi", supportingText: "İzmir" },
  { value: "bogazici", label: "Boğaziçi Üniversitesi", supportingText: "İstanbul" },
] as const;

const faculties = [
  { value: "engineering", label: "Mühendislik Fakültesi" },
  { value: "medicine", label: "Tıp Fakültesi" },
] as const;

const departments = [
  { value: "computer", label: "Bilgisayar Mühendisliği" },
  { value: "electrical", label: "Elektrik-Elektronik Mühendisliği" },
] as const;

const classLevels = [
  { value: 1 as const, label: "1. sınıf" },
  { value: 2 as const, label: "2. sınıf" },
  { value: 3 as const, label: "3. sınıf" },
  { value: 4 as const, label: "4. sınıf" },
] as const;

function onboardingProps(
  overrides: Partial<AcademicOnboardingScreenProps> = {},
): AcademicOnboardingScreenProps {
  return {
    fullName: "Ada Lovelace",
    email: "ada@example.edu",
    password: "",
    needsPassword: false,
    draft: emptyDraft,
    initialDraft: emptyDraft,
    universities,
    faculties,
    departments,
    classLevels,
    universitiesLoading: false,
    facultiesLoading: false,
    departmentsLoading: false,
    busy: false,
    feedback: null,
    onPasswordChange: jest.fn(),
    onUniversityChange: jest.fn(),
    onFacultyChange: jest.fn(),
    onDepartmentChange: jest.fn(),
    onClassLevelChange: jest.fn(),
    onRetryUniversities: jest.fn(),
    onRetryFaculties: jest.fn(),
    onRetryDepartments: jest.fn(),
    onSave: jest.fn(),
    onBack: jest.fn(),
    onDismissFeedback: jest.fn(),
    ...overrides,
  };
}

describe("Phase 6 rendered authentication screens", () => {
  describe("LoginScreen", () => {
    it("fits the hero to the safe viewport while preserving title scale and the Google mark", async () => {
      await renderAuth(<LoginScreen {...loginProps()} />);

      expect(screen.getByTestId("login-hero-stack")).toHaveStyle({ height: 844 });
      expect(screen.getByTestId("login-hero-frame", { includeHiddenElements: true })).toHaveStyle({ height: 168 });
      expect(screen.getByTestId("login-form-sheet")).toHaveStyle({ flex: 1 });
      expect(screen.getByTestId("auth-hero-title")).toHaveStyle({ fontSize: 28, lineHeight: 34 });
      expect(screen.getByLabelText("Kampüste akademik hayat", { includeHiddenElements: true })).toBeOnTheScreen();
      expect(screen.queryByText("Bugünün planı")).toBeNull();
      expect(screen.getByTestId("google-color-mark", { includeHiddenElements: true })).toBeOnTheScreen();
      expect(screen.queryByText("E-postamı doğrula")).toBeNull();
    });

    it("uses a bounded hero on a short 320 by 568 phone viewport", async () => {
      await renderAuth(<LoginScreen {...loginProps()} />, {}, { width: 320, height: 568 });

      expect(screen.getByTestId("login-hero-stack")).toHaveStyle({ height: 568 });
      expect(screen.getByTestId("login-hero-frame", { includeHiddenElements: true })).toHaveStyle({ height: 96.56 });
      expect(screen.getByTestId("auth-hero-title")).toHaveStyle({ fontSize: 24, lineHeight: 29 });
      expect(screen.getByTestId("login-form-sheet")).toBeVisible();
      expect(screen.getByRole("button", { name: "Şifremi unuttum" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Kayıt ol" })).toBeVisible();
    });

    it.each([
      [568, 96.56, true],
      [640, 121.6, true],
      [932, 168, false],
      [1280, 168, false],
    ])("resolves a bounded one-page layout for a %ipx safe height", (height, heroHeight, compact) => {
      const layout = resolveLoginViewportLayout(height);

      expect(layout.heroHeight).toBe(heroHeight);
      expect(layout.compact).toBe(compact);
      expect(layout.heroHeight).toBeLessThan(height);
      expect(layout.sheetPadding).toBeGreaterThanOrEqual(8);
    });

    it("focuses the first invalid field and moves IME focus to password", async () => {
      const onSubmit = jest.fn();
      const invalid = loginProps({ email: "invalid", password: "", onSubmit });
      const view = await renderAuth(<LoginScreen {...invalid} />);
      const emailFocus = spyOnInputFocus("E-posta adresi");

      await userEvent.press(screen.getByRole("button", { name: "Giriş yap" }));

      const alerts = screen.getAllByRole("alert");
      expect(alerts[0]).toHaveTextContent("Geçerli bir e-posta adresi gir.");
      expect(alerts[1]).toHaveTextContent("Şifre zorunludur.");
      expect(screen.getByLabelText("E-posta adresi")).toHaveProp("aria-invalid", true);
      expect(emailFocus).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
      emailFocus.mockRestore();

      const passwordOnlyInvalid = loginProps({
        email: "student@example.edu",
        password: "",
        onSubmit,
      });
      await view.rerenderAsync(authTestTree(<LoginScreen {...passwordOnlyInvalid} />));

      const passwordFocus = spyOnInputFocus("Şifre");
      fireEvent(screen.getByLabelText("E-posta adresi"), "submitEditing");
      expect(passwordFocus).toHaveBeenCalledTimes(1);
      await userEvent.press(screen.getByRole("button", { name: "Giriş yap" }));
      expect(screen.getByRole("alert", { name: "Şifre zorunludur." })).toBeVisible();
      expect(passwordFocus).toHaveBeenCalledTimes(2);
    });

    it("submits from the password IME only when the form is ready", async () => {
      const onSubmit = jest.fn();
      await renderAuth(<LoginScreen {...loginProps({ onSubmit })} />);

      fireEvent(screen.getByLabelText("Şifre"), "submitEditing");
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("E-posta adresi")).toHaveProp("returnKeyType", "next");
      expect(screen.getByLabelText("E-posta adresi")).toHaveProp("submitBehavior", "submit");
      expect(screen.getByLabelText("Şifre")).toHaveProp("returnKeyType", "done");
    });

    it("blocks duplicate actions and exposes busy semantics while submitting", async () => {
      const onSubmit = jest.fn();
      const onGoogleSubmit = jest.fn();
      await renderAuth(
        <LoginScreen
          {...loginProps({ busy: true, onSubmit, onGoogleSubmit })}
        />,
      );

      const submit = screen.getByRole("button", { name: "Giriş yap" });
      const google = screen.getByRole("button", { name: "Google ile devam et" });
      expect(submit).toBeBusy();
      expect(submit).toBeDisabled();
      expect(google).toBeDisabled();
      expect(screen.getByLabelText("E-posta adresi")).toHaveProp("editable", false);

      await fireEventAsync.press(submit);
      await fireEventAsync.press(submit);
      await fireEventAsync.press(google);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onGoogleSubmit).not.toHaveBeenCalled();
    });

    it("renders Google cancellation as polite feedback with a dismiss action", async () => {
      const onDismissFeedback = jest.fn();
      await renderAuth(
        <LoginScreen
          {...loginProps({
            feedback: {
              text: "Google girişi tamamlanmadan kapatıldı.",
              tone: "info",
            },
            onDismissFeedback,
          })}
        />,
      );

      const feedback = screen.getByRole("alert", {
        name: "Bilgi. Google girişi tamamlanmadan kapatıldı.",
      });
      expect(feedback).toHaveProp("accessibilityLiveRegion", "polite");
      await userEvent.press(screen.getByRole("button", { name: "Bildirimi kapat" }));
      expect(onDismissFeedback).toHaveBeenCalledTimes(1);
    });

    it("preserves the typed password while visibility changes", async () => {
      const onPasswordChange = jest.fn();
      await renderAuth(
        <LoginScreen
          {...loginProps({ password: "typed-secret", onPasswordChange })}
        />,
      );

      const password = screen.getByLabelText("Şifre");
      expect(password).toHaveDisplayValue("typed-secret");
      expect(password).toHaveProp("secureTextEntry", true);

      await userEvent.press(screen.getByRole("button", { name: "Şifreyi göster" }));
      expect(password).toHaveDisplayValue("typed-secret");
      expect(password).toHaveProp("secureTextEntry", false);

      await userEvent.press(screen.getByRole("button", { name: "Şifreyi gizle" }));
      expect(password).toHaveDisplayValue("typed-secret");
      expect(password).toHaveProp("secureTextEntry", true);
      expect(onPasswordChange).not.toHaveBeenCalled();
    });

    it("keeps forgot-password, verification recovery, and registration actions reachable", async () => {
      const onForgotPassword = jest.fn();
      const onVerificationRecovery = jest.fn();
      const onRegister = jest.fn();
      await renderAuth(
        <LoginScreen
          {...loginProps({
            onForgotPassword,
            onVerificationRecovery,
            onRegister,
          })}
        />,
      );

      await userEvent.press(screen.getByRole("button", { name: "Şifremi unuttum" }));
      await userEvent.press(screen.getByRole("button", { name: "Kayıt ol" }));
      expect(onForgotPassword).toHaveBeenCalledTimes(1);
      expect(onVerificationRecovery).not.toHaveBeenCalled();
      expect(onRegister).toHaveBeenCalledTimes(1);
    });
  });

  describe("RegistrationScreen", () => {
    it("renders four labelled fields and focuses the first invalid field", async () => {
      const onSubmit = jest.fn();
      await renderAuth(
        <RegistrationScreen
          {...registrationProps({
            fullName: "A",
            email: "invalid",
            password: "Aa1!234",
            passwordConfirmation: "",
            onSubmit,
          })}
        />,
      );

      expect(screen.getByLabelText("Ad soyad")).toBeVisible();
      expect(screen.getByLabelText("E-posta adresi")).toBeVisible();
      expect(screen.getByLabelText("Şifre")).toBeVisible();
      expect(screen.getByLabelText("Şifre tekrar")).toBeVisible();
      expect(screen.getByTestId("registration-form-card")).toHaveStyle({ overflow: "hidden", padding: 0 });
      expect(screen.getAllByRole("button", { name: "Şifreyi göster" })).toHaveLength(2);
      expect(screen.getByLabelText("1 / 3. Hesap oluştur")).toBeVisible();
      const nameFocus = spyOnInputFocus("Ad soyad");
      await userEvent.press(screen.getByRole("button", { name: "Devam et" }));

      expect(screen.getByRole("alert", { name: "Ad soyad en az 2 karakter olmalıdır." })).toBeVisible();
      expect(screen.getByRole("alert", { name: "Şifren en az 8 karakter olmalıdır." })).toBeVisible();
      expect(screen.getByRole("alert", { name: "Şifre tekrarı zorunludur." })).toBeVisible();
      expect(nameFocus).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("distinguishes the min-8 rule and a confirmation mismatch", async () => {
      const view = await renderAuth(
        <RegistrationScreen
          {...registrationProps({
            password: "Aa1!234",
            passwordConfirmation: "Aa1!234",
          })}
        />,
      );
      await userEvent.press(screen.getByRole("button", { name: "Devam et" }));
      expect(screen.getByRole("alert", { name: "Şifren en az 8 karakter olmalıdır." })).toBeVisible();
      expect(screen.getByLabelText("8+ karakter. Henüz karşılanmadı.")).toBeVisible();

      await view.rerenderAsync(authTestTree(
        <RegistrationScreen
          {...registrationProps({
            password: "Strong1!",
            passwordConfirmation: "Strong2!",
          })}
        />,
      ));
      expect(screen.getByRole("alert", { name: "Şifreler eşleşmiyor." })).toBeVisible();
      expect(screen.getByLabelText("8+ karakter. Karşılandı.")).toBeVisible();
    });

    it("calls the ready callback from the confirmation IME exactly once", async () => {
      const onSubmit = jest.fn();
      await renderAuth(
        <RegistrationScreen {...registrationProps({ onSubmit })} />,
      );

      fireEvent(screen.getByLabelText("Şifre tekrar"), "submitEditing");
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("8+ karakter. Karşılandı.")).toBeVisible();
      expect(screen.getByLabelText("Büyük harf (A-Z). Karşılandı.")).toBeVisible();
      expect(screen.getByLabelText("Küçük harf (a-z). Karşılandı.")).toBeVisible();
      expect(screen.getByLabelText("Rakam (0-9). Karşılandı.")).toBeVisible();
      expect(screen.getByLabelText("Özel karakter (!@#?). Karşılandı.")).toBeVisible();
    });
  });

  describe("VerificationScreen", () => {
    it("masks the destination and filters the numeric four-digit OTP field", async () => {
      const onCodeChange = jest.fn();
      await renderAuth(
        <VerificationScreen {...verificationProps({ onCodeChange })} />,
      );

      expect(
        screen.getByText("s***e@example.edu adresine gönderilen 4 haneli kodu gir."),
      ).toBeVisible();
      expect(screen.getByText("2 / 3 · E-posta doğrulama")).toBeVisible();
      const code = screen.getByLabelText("Doğrulama kodu");
      expect(code).toHaveProp("keyboardType", "number-pad");
      expect(code).toHaveProp("inputMode", "numeric");
      expect(code).toHaveProp("maxLength", 4);
      expect(code).toHaveProp("textContentType", "oneTimeCode");
      expect(code).toHaveProp("autoComplete", "one-time-code");

      await fireEventAsync.changeText(code, "a1 2-3x45");
      expect(onCodeChange).toHaveBeenCalledWith("1234");
    });

    it("requires exactly four digits and enforces resend cooldown", async () => {
      const onSubmit = jest.fn();
      const onResend = jest.fn();
      const initial = verificationProps({ code: "123", onSubmit, onResend });
      const view = await renderAuth(<VerificationScreen {...initial} />);

      expect(screen.getByRole("button", { name: "Doğrulamayı tamamla" })).toBeDisabled();
      const cooldown = screen.getByRole("button", { name: "Tekrar gönder (00:30)" });
      expect(cooldown).toBeDisabled();
      expect(screen.getByText("Kodun kalan süresi: 01:35")).toBeVisible();

      const ready = verificationProps({
        code: "1234",
        timing: { expired: false, expiresInSeconds: 65, resendInSeconds: 0 },
        onSubmit,
        onResend,
      });
      await view.rerenderAsync(authTestTree(<VerificationScreen {...ready} />));

      await userEvent.press(screen.getByRole("button", { name: "Doğrulamayı tamamla" }));
      await userEvent.press(screen.getByRole("button", { name: "Kodu tekrar gönder" }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onResend).toHaveBeenCalledTimes(1);
    });

    it("announces expiry, blocks verification, and still allows a fresh resend", async () => {
      const onSubmit = jest.fn();
      const onResend = jest.fn();
      await renderAuth(
        <VerificationScreen
          {...verificationProps({
            code: "1234",
            timing: { expired: true, expiresInSeconds: 0, resendInSeconds: 0 },
            onSubmit,
            onResend,
          })}
        />,
      );

      const code = screen.getByLabelText("Doğrulama kodu");
      expect(code).toHaveProp("aria-invalid", true);
      expect(screen.getByRole("alert", { name: "Kodun süresi doldu. Yeni bir kod iste." })).toBeVisible();
      expect(screen.getByText("Kodun süresi doldu.")).toBeVisible();
      expect(screen.getByRole("button", { name: "Doğrulamayı tamamla" })).toBeDisabled();
      await userEvent.press(screen.getByRole("button", { name: "Kodu tekrar gönder" }));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onResend).toHaveBeenCalledTimes(1);
    });
  });

  describe("password-recovery surfaces", () => {
    it("validates and submits the request surface without exposing account existence", async () => {
      const onSubmit = jest.fn();
      const onCancel = jest.fn();
      const view = await renderAuth(
        <PasswordRecoveryRequestScreen
          {...recoveryRequestProps({ email: "invalid", onSubmit, onCancel })}
        />,
      );

      expect(screen.getByRole("header", { name: "Sıfırlama kodu iste" })).toBeVisible();
      await userEvent.press(screen.getByRole("button", { name: "Kodu gönder" }));
      expect(screen.getByRole("alert", { name: "Geçerli bir e-posta adresi gir." })).toBeVisible();
      expect(onSubmit).not.toHaveBeenCalled();

      await view.rerenderAsync(authTestTree(
        <PasswordRecoveryRequestScreen
          {...recoveryRequestProps({ email: "student@example.edu", onSubmit, onCancel })}
        />,
      ));
      await userEvent.press(screen.getByRole("button", { name: "Kodu gönder" }));
      await userEvent.press(screen.getByRole("button", { name: "Giriş ekranına dön" }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("uses an exact six-digit OTP on the code surface and exposes recovery navigation", async () => {
      const onCodeChange = jest.fn();
      const onContinue = jest.fn();
      const onResend = jest.fn();
      const onBack = jest.fn();
      const onCancel = jest.fn();
      const view = await renderAuth(
        <PasswordRecoveryCodeScreen
          {...recoveryCodeProps({
            code: "12345",
            onCodeChange,
            onContinue,
            onResend,
            onBack,
            onCancel,
          })}
        />,
      );

      expect(screen.getByText("s***t@example.edu adresine gönderilen altı haneli kodu gir.")).toBeVisible();
      const code = screen.getByLabelText("Sıfırlama kodu");
      expect(code).toHaveProp("maxLength", 6);
      expect(code).toHaveProp("keyboardType", "number-pad");
      expect(code).toHaveProp("textContentType", "oneTimeCode");
      expect(screen.getByRole("button", { name: "Yeni şifreye devam et" })).toBeDisabled();
      await fireEventAsync.changeText(code, "1a2 3-4567");
      expect(onCodeChange).toHaveBeenCalledWith("123456");

      await view.rerenderAsync(authTestTree(
        <PasswordRecoveryCodeScreen
          {...recoveryCodeProps({
            code: "123456",
            onCodeChange,
            onContinue,
            onResend,
            onBack,
            onCancel,
          })}
        />,
      ));
      fireEvent(screen.getByLabelText("Sıfırlama kodu"), "submitEditing");
      await userEvent.press(screen.getByRole("button", { name: "Yeni kod iste" }));
      await userEvent.press(screen.getByRole("button", { name: "Geri" }));
      await userEvent.press(screen.getByRole("button", { name: "İptal et" }));
      expect(onContinue).toHaveBeenCalledTimes(1);
      expect(onResend).toHaveBeenCalledTimes(1);
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("requires a min-8 matching password on the confirmation surface", async () => {
      const onSubmit = jest.fn();
      const view = await renderAuth(
        <PasswordRecoveryConfirmScreen
          {...recoveryConfirmProps({
            newPassword: "Aa1!234",
            passwordConfirmation: "different",
            onSubmit,
          })}
        />,
      );

      expect(screen.getByRole("header", { name: "Yeni şifreni belirle" })).toBeVisible();
      await userEvent.press(screen.getByRole("button", { name: "Şifreyi yenile" }));
      expect(screen.getByRole("alert", { name: "Şifren en az 8 karakter olmalıdır." })).toBeVisible();
      expect(screen.getByRole("alert", { name: "Şifreler eşleşmiyor." })).toBeVisible();
      expect(onSubmit).not.toHaveBeenCalled();

      await view.rerenderAsync(authTestTree(
        <PasswordRecoveryConfirmScreen
          {...recoveryConfirmProps({
            newPassword: "Strong1!",
            passwordConfirmation: "Strong1!",
            onSubmit,
          })}
        />,
      ));
      fireEvent(screen.getByLabelText("Yeni şifre tekrar"), "submitEditing");
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe("AcademicOnboardingScreen", () => {
    it("requires university while keeping optional descendants disabled", async () => {
      const onSave = jest.fn();
      await renderAuth(
        <AcademicOnboardingScreen {...onboardingProps({ onSave })} />,
      );

      expect(screen.getByText("3 / 3 · Akademik profil")).toBeVisible();
      expect(screen.getByRole("combobox", { name: "Fakülte" })).toBeDisabled();
      expect(screen.getByRole("combobox", { name: "Bölüm" })).toBeDisabled();
      expect(screen.getByRole("combobox", { name: "Sınıf" })).toBeDisabled();
      await userEvent.press(screen.getByRole("button", { name: "Profili kaydet" }));

      const university = screen.getByRole("combobox", { name: "Üniversite" });
      expect(university).toHaveProp("accessibilityHint", "Üniversite seçimi zorunludur.");
      expect(screen.getByRole("alert", { name: "Üniversite seçimi zorunludur." })).toBeVisible();
      expect(onSave).not.toHaveBeenCalled();
    });

    it("filters a virtualized selector and exposes expanded selection semantics", async () => {
      const onUniversityChange = jest.fn();
      await renderAuth(
        <AcademicOnboardingScreen
          {...onboardingProps({ onUniversityChange })}
        />,
      );

      const university = screen.getByRole("combobox", { name: "Üniversite" });
      await userEvent.press(university);
      await fireEventAsync.changeText(
        screen.getByRole("search", { name: "Üniversite ara" }),
        "ege",
      );
      expect(university).toHaveProp(
        "accessibilityState",
        expect.objectContaining({ expanded: true }),
      );
      expect(screen.getByRole("radio", { name: "Ege Üniversitesi" })).toBeVisible();
      expect(screen.queryByRole("radio", { name: "Ankara Üniversitesi" })).toBeNull();

      await userEvent.press(screen.getByRole("radio", { name: "Ege Üniversitesi" }));
      expect(onUniversityChange).toHaveBeenCalledWith("ege");
      expect(screen.queryByTestId("bottom-sheet")).toBeNull();
    });

    it("shows a query-specific no-result state", async () => {
      await renderAuth(<AcademicOnboardingScreen {...onboardingProps()} />);

      await userEvent.press(screen.getByRole("combobox", { name: "Üniversite" }));
      await fireEventAsync.changeText(
        screen.getByRole("search", { name: "Üniversite ara" }),
        "sonuç-yok",
      );
      expect(
        screen.getByRole("summary", { name: "Aramana uygun sonuç bulunamadı." }),
      ).toBeVisible();
    });

    it("announces selector loading and error states and retries explicitly", async () => {
      const onRetryUniversities = jest.fn();
      await renderAuth(
        <AcademicOnboardingScreen
          {...onboardingProps({
            universitiesLoading: true,
            universitiesError: "Üniversiteler yüklenemedi.",
            onRetryUniversities,
          })}
        />,
      );

      const university = screen.getByRole("combobox", { name: "Üniversite" });
      expect(university).toBeBusy();
      expect(university).toBeDisabled();
      expect(screen.getByText("Seçenekler yükleniyor")).toBeVisible();
      expect(screen.getByRole("alert", { name: "Üniversiteler yüklenemedi." })).toBeVisible();
      await userEvent.press(screen.getByRole("button", { name: "Seçenekleri tekrar yükle" }));
      expect(onRetryUniversities).toHaveBeenCalledTimes(1);
    });

    it("surfaces explicit child clears and parent selection callbacks", async () => {
      const onUniversityChange = jest.fn();
      const onFacultyChange = jest.fn();
      const onDepartmentChange = jest.fn();
      const onClassLevelChange = jest.fn();
      await renderAuth(
        <AcademicOnboardingScreen
          {...onboardingProps({
            draft: completeDraft,
            initialDraft: completeDraft,
            onUniversityChange,
            onFacultyChange,
            onDepartmentChange,
            onClassLevelChange,
          })}
        />,
      );

      await userEvent.press(screen.getByRole("button", { name: "Fakülte seçimini temizle" }));
      await userEvent.press(screen.getByRole("button", { name: "Bölüm seçimini temizle" }));
      await userEvent.press(screen.getByRole("button", { name: "Sınıf seçimini temizle" }));
      expect(onFacultyChange).toHaveBeenCalledWith(null);
      expect(onDepartmentChange).toHaveBeenCalledWith(null);
      expect(onClassLevelChange).toHaveBeenCalledWith(null);

      await userEvent.press(screen.getByRole("combobox", { name: "Üniversite" }));
      await userEvent.press(screen.getByRole("radio", { name: "Ege Üniversitesi" }));
      expect(onUniversityChange).toHaveBeenCalledWith("ege");
    });

    it("renders the final review and saves a complete draft once", async () => {
      const onSave = jest.fn();
      await renderAuth(
        <AcademicOnboardingScreen
          {...onboardingProps({
            draft: completeDraft,
            initialDraft: completeDraft,
            onSave,
          })}
        />,
      );

      const review = screen.getByLabelText("Akademik seçim özeti");
      expect(within(review).getByRole("header", { name: "Seçilen bilgiler" })).toBeVisible();
      expect(within(review).getByText("Ankara Üniversitesi")).toBeVisible();
      expect(within(review).getByText("Mühendislik Fakültesi")).toBeVisible();
      expect(within(review).getByText("Bilgisayar Mühendisliği")).toBeVisible();
      expect(within(review).getByText("4. sınıf")).toBeVisible();

      await userEvent.press(screen.getByRole("button", { name: "Profili kaydet" }));
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("requires the resumed email user's password before final save", async () => {
      const onSave = jest.fn();
      const view = await renderAuth(
        <AcademicOnboardingScreen
          {...onboardingProps({
            draft: { ...emptyDraft, universityId: "ankara" },
            initialDraft: emptyDraft,
            needsPassword: true,
            password: "",
            onSave,
          })}
        />,
      );

      const passwordFocus = spyOnInputFocus("Hesap şifresi");
      await userEvent.press(screen.getByRole("button", { name: "Profili kaydet" }));
      expect(screen.getByRole("alert", { name: "Devam etmek için şifreni gir." })).toBeVisible();
      expect(passwordFocus).toHaveBeenCalledTimes(1);
      expect(onSave).not.toHaveBeenCalled();

      await view.rerenderAsync(authTestTree(
        <AcademicOnboardingScreen
          {...onboardingProps({
            draft: { ...emptyDraft, universityId: "ankara" },
            initialDraft: emptyDraft,
            needsPassword: true,
            password: "Strong1!",
            onSave,
          })}
        />,
      ));
      fireEvent(screen.getByLabelText("Hesap şifresi"), "submitEditing");
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("allows the optional academic profile step to be skipped explicitly", async () => {
      const onSkip = jest.fn();
      await renderAuth(<AcademicOnboardingScreen {...onboardingProps({ onSkip })} />);

      await userEvent.press(screen.getByRole("button", { name: "Şimdilik geç" }));
      expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it("warns before discarding a dirty draft and invokes Back only after confirmation", async () => {
      const onBack = jest.fn();
      const alert = jest.spyOn(Alert, "alert");
      await renderAuth(
        <AcademicOnboardingScreen
          {...onboardingProps({
            draft: completeDraft,
            initialDraft: emptyDraft,
            onBack,
          })}
        />,
      );

      await userEvent.press(screen.getByRole("button", { name: "Geri dön" }));
      expect(onBack).not.toHaveBeenCalled();
      expect(alert).toHaveBeenCalledWith(
        "Kaydedilmemiş seçimler",
        "Akademik profilindeki değişiklikler kaybolacak.",
        expect.arrayContaining([
          expect.objectContaining({ text: "Vazgeç", style: "cancel" }),
          expect.objectContaining({ text: "Değişiklikleri sil", style: "destructive" }),
        ]),
      );

      const buttons = alert.mock.calls[0]?.[2];
      const discard = buttons?.find((button) => button.style === "destructive");
      await act(async () => discard?.onPress?.());
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the complete four-field form structurally reachable at 320dp and 200% font scale", async () => {
    const fixture = {
      ...signedInLargeTextFixture,
      session: { status: "signed_out" as const, ownerId: null },
    };
    expect(fixture.appearance.windowWidth).toBe(320);
    expect(fixture.appearance.fontScale).toBe(2);

    await renderAsync(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 320, height: 640 },
          insets: safeAreaInsets,
        }}
      >
        <NativeTestEnvironmentProvider fixture={fixture}>
          <RegistrationScreen {...registrationProps()} />
        </NativeTestEnvironmentProvider>
      </SafeAreaProvider>,
    );

    const title = screen.getByRole("header", { name: "Hesabını oluştur" });
    expect(title).not.toHaveProp("numberOfLines");
    expect(screen.getByLabelText("Ad soyad")).toBeVisible();
    expect(screen.getByLabelText("E-posta adresi")).toBeVisible();
    expect(screen.getByLabelText("Şifre")).toBeVisible();
    expect(screen.getByLabelText("Şifre tekrar")).toBeVisible();
    expect(screen.getByRole("button", { name: "Devam et" })).toBeVisible();
  });
});
