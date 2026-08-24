import { fireEvent, renderAsync, screen } from "@testing-library/react-native";
import { RecentAuthenticationPanel } from "../../src/auth/RecentAuthenticationPanel";
import type { RecentAuthenticationPanelProps } from "../../src/auth/RecentAuthenticationPanel";
import { ThemeProvider } from "../../src/design-system";

async function renderPanel(props: RecentAuthenticationPanelProps) {
  await renderAsync(
    <ThemeProvider platform="android" preference="light" reducedMotion windowWidth={360}>
      <RecentAuthenticationPanel {...props} />
    </ThemeProvider>
  );
}

describe("RecentAuthenticationPanel", () => {
  it("collects a password securely and submits it explicitly", async () => {
    const onPasswordChange = jest.fn();
    const onSubmitPassword = jest.fn();
    await renderPanel({
      action: "data",
      busy: false,
      methods: ["password"],
      onCancel: jest.fn(),
      onPasswordChange,
      onSubmitApple: jest.fn(),
      onSubmitGoogle: jest.fn(),
      onSubmitPassword,
      password: "owner-password"
    });

    const passwordInput = screen.getByLabelText("Hesap şifresi");
    expect(passwordInput.props.secureTextEntry).toBe(true);
    fireEvent.changeText(passwordInput, "next-password");
    expect(onPasswordChange).toHaveBeenCalledWith("next-password");
    fireEvent.press(screen.getByRole("button", { name: "Şifre ile Doğrula" }));
    expect(onSubmitPassword).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Google ile Doğrula" })).toBeNull();
  });

  it("offers a Google proof without rendering a password field for a Google-only account", async () => {
    const onSubmitGoogle = jest.fn();
    await renderPanel({
      action: "account",
      busy: false,
      methods: ["google"],
      onCancel: jest.fn(),
      onPasswordChange: jest.fn(),
      onSubmitApple: jest.fn(),
      onSubmitGoogle,
      onSubmitPassword: jest.fn(),
      password: ""
    });

    expect(screen.queryByLabelText("Hesap şifresi")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Google ile Doğrula" }));
    expect(onSubmitGoogle).toHaveBeenCalledTimes(1);
  });

  it("keeps controls disabled while proof creation is in progress and exposes controlled errors", async () => {
    await renderPanel({
      action: "account",
      busy: true,
      error: "Kimliğin doğrulanamadı.",
      methods: ["password", "google"],
      onCancel: jest.fn(),
      onPasswordChange: jest.fn(),
      onSubmitApple: jest.fn(),
      onSubmitGoogle: jest.fn(),
      onSubmitPassword: jest.fn(),
      password: "owner-password"
    });

    expect(screen.getByRole("progressbar")).toBeBusy();

    expect(screen.getByRole("button", { name: "Şifre ile Doğrula" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Google ile Doğrula" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Vazgeç" })).toBeDisabled();
    expect(screen.getByText("Kimliğin doğrulanamadı.")).toBeOnTheScreen();
  });

  it("offers the native Apple proof action for an Apple-only account", async () => {
    const onSubmitApple = jest.fn();
    await renderPanel({
      action: "account",
      busy: false,
      methods: ["apple"],
      onCancel: jest.fn(),
      onPasswordChange: jest.fn(),
      onSubmitApple,
      onSubmitGoogle: jest.fn(),
      onSubmitPassword: jest.fn(),
      password: "",
    });

    fireEvent.press(screen.getByRole("button", { name: "Apple ile doğrula" }));
    expect(onSubmitApple).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Hesap şifresi")).toBeNull();
  });
});
