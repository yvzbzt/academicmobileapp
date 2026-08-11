import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  renderAsync,
  screen,
  userEvent,
} from "@testing-library/react-native";
import {
  AuthOnboardingPreview,
  type AuthOnboardingPreviewScenario,
} from "../../src/auth/AuthOnboardingPreview";

const PREVIEW_SOURCE = resolve(
  __dirname,
  "../../src/auth/AuthOnboardingPreview.tsx",
);

describe("AuthOnboardingPreview", () => {
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
  });

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
