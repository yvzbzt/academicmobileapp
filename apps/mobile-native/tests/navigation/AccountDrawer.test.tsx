import { fireEvent, renderAsync, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../../src/design-system";
import { AccountDrawer } from "../../src/navigation/AccountDrawer";

describe("AccountDrawer", () => {
  it("owns personal identity, account management, and logout outside the settings tab", async () => {
    const onClose = jest.fn();
    const onLogout = jest.fn();
    const onOpenAccount = jest.fn();
    await renderAsync(
      <SafeAreaProvider
        initialMetrics={{
          frame: { height: 844, width: 390, x: 0, y: 0 },
          insets: { bottom: 0, left: 0, right: 0, top: 24 },
        }}
      >
        <ThemeProvider platform="android" preference="light" reducedMotion windowWidth={390}>
          <AccountDrawer
            email="ada@example.invalid"
            fullName="Ada Lovelace"
            onClose={onClose}
            onLogout={onLogout}
            onOpenAccount={onOpenAccount}
            universityName="Örnek Üniversitesi"
            visible
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId("account-drawer")).toBeVisible();
    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.getByText("ada@example.invalid")).toBeVisible();
    expect(screen.getByText("Örnek Üniversitesi")).toBeVisible();

    fireEvent.press(screen.getByRole("button", { name: "Kişisel profil ve hesap" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenAccount).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole("button", { name: "Çıkış yap" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
