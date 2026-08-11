import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, renderAsync, screen, waitFor, within } from "@testing-library/react-native";
import { Linking } from "react-native";
import {
  PHASE_10_PROFILE_PREVIEW_BOUNDARY,
  PROFILE_SETTINGS_PREVIEW_SCENARIOS,
  ProfileSettingsPreview,
  parseProfileSettingsPreviewUrl,
  type ProfileSettingsPreviewScenario,
} from "../../src/profile/ProfileSettingsPreview";

describe("Phase 10 profile/settings synthetic preview", () => {
  it("keeps the stable scenario and deep-link contract", () => {
    const expected: readonly ProfileSettingsPreviewScenario[] = [
      "profile-summary",
      "profile-incomplete",
      "academic-editor",
      "notifications-active",
      "notifications-denied",
      "notifications-settings-required",
      "notifications-registering",
      "notifications-error",
      "google-disconnected",
      "google-connected",
      "google-partial",
      "google-expired",
      "account-management",
      "danger-expanded",
      "data-confirm",
      "data-error",
      "account-confirm",
      "account-error",
    ];
    expect(PROFILE_SETTINGS_PREVIEW_SCENARIOS).toEqual(expected);
    expect(parseProfileSettingsPreviewUrl(
      "academicpulse://phase10-profile/notifications-settings-required?theme=dark",
    )).toEqual({
      preference: "dark",
      scenario: "notifications-settings-required",
    });
    expect(parseProfileSettingsPreviewUrl(
      "academicpulse://phase10-profile/profile-summary",
    )).toEqual({
      preference: "light",
      scenario: "profile-summary",
    });
    expect(parseProfileSettingsPreviewUrl(
      "academicpulse://phase10-profile/not-real?theme=light",
    )).toBeNull();
    expect(parseProfileSettingsPreviewUrl(
      "https://example.invalid/phase10-profile/profile-summary",
    )).toBeNull();
  });

  it("declares the host gate and contains no production data or provider wiring", () => {
    expect(PHASE_10_PROFILE_PREVIEW_BOUNDARY).toEqual({
      requiresDevAndExplicitEnvironmentGate: true,
      syntheticFixturesOnly: true,
      permitsProductionAccounts: false,
      permitsLiveProviders: false,
    });

    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/profile/ProfileSettingsPreview.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(
      /apiRequest|SecureStore|AsyncStorage|GoogleSignin|firebase|expo-network|expo-notifications|PRODUCTION_API|accessToken|refreshToken/u,
    );
    expect(source).toContain("example.invalid");
    expect(source).toContain("Örnek Üniversitesi");
    expect(source).toContain("syntheticFixturesOnly: true");
  });

  it("pushes the academic editor over Profile and returns through the real Back action", async () => {
    await renderAsync(<ProfileSettingsPreview scenario="academic-editor" />);

    expect(await screen.findByRole("header", { name: "Akademik profili düzenle" })).toBeVisible();
    const back = await screen.findByRole("button", { name: "Geri dön" });
    expect(back).toBeEnabled();
    fireEvent.press(back);

    await waitFor(() => {
      expect(screen.getByRole("header", { name: "Profil" })).toBeVisible();
    });
    expect(screen.getAllByText("Deniz Örnek").length).toBeGreaterThan(0);
  });

  it("updates the routed scenario from an accepted synthetic deep link", async () => {
    const urlHandlers: Array<(event: { url: string }) => void> = [];
    jest.spyOn(Linking, "addEventListener").mockImplementation((event, handler) => {
      if (event === "url") urlHandlers.push(handler as (event: { url: string }) => void);
      return { remove: jest.fn() } as unknown as ReturnType<typeof Linking.addEventListener>;
    });

    await renderAsync(<ProfileSettingsPreview scenario="profile-summary" />);
    expect(await screen.findByRole("header", { name: "Profil" })).toBeVisible();
    expect(urlHandlers.length).toBeGreaterThan(0);

    act(() => {
      urlHandlers.forEach((handler) => handler({
        url: "academicpulse://phase10-profile/google-partial?theme=dark",
      }));
    });

    await waitFor(() => {
      expect(screen.getByText("Google Takvim kısmen eşitlendi")).toBeVisible();
    });
    expect(screen.getByText("Bir sentetik akademik kayıt hedef takvimle eşleşmedi.")).toBeVisible();
  });

  it("renders the permanent-permission mismatch and opens the real account confirmation", async () => {
    const notificationView = await renderAsync(
      <ProfileSettingsPreview scenario="notifications-settings-required" />,
    );
    expect(await screen.findAllByRole("header", { name: "Bildirim tercihleri" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Geri dön" })).toHaveLength(1);
    expect(await screen.findByText("Bildirim izni gerekiyor")).toBeVisible();
    expect(screen.getByRole("button", { name: "Cihaz ayarlarını aç" })).toBeEnabled();
    await notificationView.unmountAsync();

    await renderAsync(<ProfileSettingsPreview scenario="data-confirm" />);
    expect(await screen.findByRole("header", { name: "Hesap ve veri" })).toBeVisible();
    fireEvent.press(screen.getByRole("button", { name: "Tehlikeli alanı göster" }));
    fireEvent.press(screen.getByRole("button", { name: "Uygulama verilerimi sil" }));
    const confirmation = screen.getByTestId("bottom-sheet");
    expect(confirmation).toHaveProp("accessibilityLabel", "Uygulama verileri silinsin mi?");
    expect(within(confirmation).getAllByText(/geri alınamaz/iu).length).toBeGreaterThan(0);
  });
});
