import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  fireEvent,
  renderAsync,
  screen,
  userEvent,
} from "@testing-library/react-native";
import { FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  AuthOnboardingPreview,
  resolveAuthPreviewSafeAreaMetrics,
  type AuthOnboardingPreviewScenario,
} from "../../src/auth/AuthOnboardingPreview";

const PREVIEW_SOURCE = resolve(
  __dirname,
  "../../src/auth/AuthOnboardingPreview.tsx",
);

const mockWindowDimensions = jest.fn(() => ({
  fontScale: 1,
  height: 844,
  scale: 3,
  width: 390,
}));

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindowDimensions(),
}));

describe("AuthOnboardingPreview", () => {
  it("uses real capture-window metrics and keeps a deterministic test fallback", () => {
    const emulatorMetrics = {
      frame: { x: 0, y: 0, width: 471, height: 1024 },
      insets: { top: 40, right: 0, bottom: 77, left: 0 },
    };

    expect(resolveAuthPreviewSafeAreaMetrics(emulatorMetrics)).toBe(emulatorMetrics);
    expect(resolveAuthPreviewSafeAreaMetrics(null)).toEqual({
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, right: 0, bottom: 34, left: 0 },
    });
  });

  it("keeps the development renderer behind a presentation-only import boundary", () => {
    const source = readFileSync(PREVIEW_SOURCE, "utf8");
    const importSpecifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu)]
      .map((match) => match[1]);

    expect(importSpecifiers).toEqual([
      "react",
      "react-native",
      "react-native-safe-area-context",
      "../design-system",
      "./AuthScreens",
      "./PreLoginWelcomeScreen",
    ]);
    expect(
      importSpecifiers.some((specifier) => (
        /api|secure-store|google-signin|firebase|notification|persist|storage/iu
          .test(specifier)
      )),
    ).toBe(false);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/\baxios\b/u);
    expect(source).not.toMatch(/\bSecureStore\b/u);
    expect(source).not.toMatch(/\bGoogleSignin\b/u);
  });

  it("renders real extracted screens and switches across the synthetic state matrix", async () => {
    await renderAsync(
      <AuthOnboardingPreview initialScenario="login" preference="dark" />,
    );

    expectEvidence("giriş");
    expect(screen.getByLabelText("E-posta adresi")).toHaveDisplayValue(
      "ogrenci@phase6.invalid",
    );
    expect(
      screen.getByRole("button", { name: "Giriş senaryosunu göster" }),
    ).toBeSelected();

    await selectScenario("Giriş · yükleniyor", "giriş yükleniyor");
    expect(screen.getByRole("button", { name: "Giriş yap" })).toBeBusy();

    await selectScenario("Giriş · hata", "giriş hata");
    expect(screen.getByText("phase6.invalid sentetik giriş hatası.")).toBeVisible();

    await selectScenario("Kayıt", "kayıt");
    expect(screen.getByLabelText("Ad soyad")).toHaveDisplayValue(
      "Phase 6 Sentetik Öğrenci",
    );

    await selectScenario("Doğrulama", "doğrulama");
    expect(screen.getByLabelText("Doğrulama kodu")).toHaveDisplayValue("4242");

    await selectScenario("Kurtarma · istek", "kurtarma istek");
    expect(screen.getByRole("header", { name: "Sıfırlama kodu iste" })).toBeVisible();

    await selectScenario("Kurtarma · kod", "kurtarma kod");
    expect(screen.getByLabelText("Sıfırlama kodu")).toHaveDisplayValue("616161");

    await selectScenario("Kurtarma · onay", "kurtarma onay");
    expect(screen.getByLabelText("Yeni şifre")).toHaveDisplayValue(
      "Phase6-Yeni1",
    );

    await selectScenario("Kurtarma · başarı", "kurtarma başarı");
    expect(
      screen.getByText("Sentetik şifre yenilendi. Yeni şifrenle giriş yapabilirsin."),
    ).toBeVisible();
    expect(screen.getByRole("header", { name: "Akademik Takvim" })).toBeVisible();

    await selectScenario("Akademik profil", "akademik profil");
    expect(screen.getByRole("combobox", { name: "Üniversite" })).toHaveAccessibilityValue({
      text: "Phase 6 Sentetik Üniversitesi",
    });

    await selectScenario("Profil · yükleniyor", "akademik profil yükleniyor");
    expect(screen.getByRole("combobox", { name: "Üniversite" })).toBeBusy();
    expect(screen.getByRole("button", { name: "Profili kaydet" })).toBeBusy();

    await selectScenario("Profil · hata", "akademik profil hata");
    expect(
      screen.getByText("phase6.invalid sentetik üniversite yükleme hatası."),
    ).toBeVisible();

    await selectScenario("Profil · başarı", "akademik profil başarı");
    expect(
      screen.getByText("phase6.invalid sentetik akademik profil kaydı tamamlandı."),
    ).toBeVisible();
  }, 15_000);

  it("boots capture automation directly into a stable named scenario", async () => {
    await renderAsync(
      <AuthOnboardingPreview
        initialScenario="verification-cooldown"
        preference="light"
      />,
    );

    expectEvidence("doğrulama");
    expect(screen.getByLabelText("Doğrulama kodu")).toHaveDisplayValue("4242");
    expect(
      screen.getByRole("button", { name: "Tekrar gönder (00:37)" }),
    ).toBeDisabled();
  });

  it.each([
    "login",
    "login-loading",
    "login-error",
    "recovery-success",
  ] as const)("matches production bottom-edge rendering for the %s capture", async (scenario) => {
    await renderAsync(
      <AuthOnboardingPreview
        initialScenario={scenario}
        preference="light"
        showScenarioControls={false}
      />,
    );

    expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toEqual([
      "top",
      "left",
      "right",
    ]);
  });

  it("keeps the bottom safe edge for non-Login form captures", async () => {
    await renderAsync(
      <AuthOnboardingPreview
        initialScenario="register"
        preference="light"
        showScenarioControls={false}
      />,
    );

    expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toContain("bottom");
  });

  it("boots the welcome capture without controls and keeps all slides reachable", async () => {
    const view = await renderAsync(
      <AuthOnboardingPreview
        initialMetrics={null}
        initialScenario="welcome"
        preference="light"
      />,
    );

    expect(screen.getByTestId("prelogin-welcome-screen")).toBeVisible();
    expect(screen.getByTestId("prelogin-welcome-screen")).toHaveStyle({
      paddingBottom: 42,
    });
    expect(screen.queryByLabelText("Phase 6 sentetik senaryo kontrolleri")).toBeNull();
    expect(screen.queryByTestId("phase-6-synthetic-evidence")).toBeNull();

    const slides = view.UNSAFE_getByType(FlatList);
    expect(slides.props.horizontal).toBe(true);
    expect(slides.props.pagingEnabled).toBe(true);
    const pageWidth = slides.props.getItemLayout(undefined, 0).length;
    fireEvent(slides, "momentumScrollEnd", {
      nativeEvent: { contentOffset: { x: pageWidth, y: 0 } },
    });
    expect(screen.getByRole("button", {
      name: "2. tanıtım sayfasına git",
    })).toBeSelected();

    await userEvent.press(screen.getByRole("button", {
      name: "3. tanıtım sayfasına git",
    }));
    expect(screen.getByRole("button", {
      name: "3. tanıtım sayfasına git",
    })).toBeSelected();
    expect(screen.getByRole("button", { name: "Başlayalım" })).toBeVisible();
  });
});

function expectEvidence(label: string) {
  expect(
    screen.getByRole("header", {
      name: `Phase 6 sentetik ${label} kanıtı`,
    }),
  ).toBeVisible();
}

async function selectScenario(
  controlLabel: string,
  evidenceLabel: string,
) {
  await userEvent.press(
    screen.getByRole("button", {
      name: `${controlLabel} senaryosunu göster`,
    }),
  );
  expectEvidence(evidenceLabel);
  expect(
    screen.getByRole("button", {
      name: `${controlLabel} senaryosunu göster`,
    }),
  ).toBeSelected();
}

type _ScenarioCoverage = Record<AuthOnboardingPreviewScenario, true>;

const _scenarioCoverage: _ScenarioCoverage = {
  welcome: true,
  login: true,
  "login-loading": true,
  "login-error": true,
  register: true,
  "verification-cooldown": true,
  "recovery-request": true,
  "recovery-code": true,
  "recovery-confirm": true,
  "recovery-success": true,
  onboarding: true,
  "onboarding-loading": true,
  "onboarding-error": true,
  "onboarding-success": true,
};

void _scenarioCoverage;
