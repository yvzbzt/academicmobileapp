import { fireEvent, renderAsync, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../../src/design-system";
import { AccountDrawer } from "../../src/navigation/AccountDrawer";

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

describe("AccountDrawer", () => {
  beforeEach(() => {
    mockWindowDimensions.mockReturnValue({
      fontScale: 1,
      height: 844,
      scale: 3,
      width: 390,
    });
  });

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

  it("keeps every action scroll-reachable in landscape with accessibility text sizes", async () => {
    mockWindowDimensions.mockReturnValue({
      fontScale: 2,
      height: 320,
      scale: 2,
      width: 844,
    });
    await renderAsync(
      <SafeAreaProvider
        initialMetrics={{
          frame: { height: 320, width: 844, x: 0, y: 0 },
          insets: { bottom: 21, left: 44, right: 44, top: 0 },
        }}
      >
        <ThemeProvider platform="ios" preference="light" reducedMotion windowWidth={844}>
          <AccountDrawer
            email="ada.lovelace.with.a.long.address@example.invalid"
            fullName="Ada Augusta King Lovelace"
            onClose={jest.fn()}
            onLogout={jest.fn()}
            onOpenAccount={jest.fn()}
            universityName="Çok Uzun Örnek Üniversitesi Mühendislik Yerleşkesi"
            visible
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId("account-drawer")).toHaveProp("accessible", false);
    expect(screen.getByTestId("account-drawer")).toHaveStyle({ width: 344 });
    const scroll = screen.getByTestId("account-drawer-scroll");
    expect(scroll).toHaveProp("keyboardShouldPersistTaps", "handled");
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
      flexGrow: 1,
      paddingBottom: 18,
    });
    expect(StyleSheet.flatten(screen.getByTestId("account-drawer-identity").props.style))
      .toMatchObject({ alignItems: "flex-start", flexDirection: "column" });
    expect(screen.getByText("Ada Augusta King Lovelace").props.numberOfLines).toBeUndefined();
    expect(screen.getByRole("button", { name: "Çıkış yap" })).toBeOnTheScreen();
  });
});
