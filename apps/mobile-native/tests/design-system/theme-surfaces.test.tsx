import { KeyboardAvoidingView, ScrollView, Text } from "react-native";
import {
  screen,
  within,
} from "@testing-library/react-native";
import {
  NavigationSurface,
  Screen,
} from "../../src/design-system/surfaces";
import {
  usePlatformAdaptation,
  useReducedMotion,
  useReducedTransparency,
  useTheme,
} from "../../src/design-system/theme";
import { renderWithTheme } from "./test-utils";

function EnvironmentProbe() {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const reducedMotion = useReducedMotion();
  const reducedTransparency = useReducedTransparency();
  return (
    <Text accessibilityLabel="Tema ortamı" accessibilityRole="summary">
      {[
        theme.mode,
        adaptation.platform,
        adaptation.navigationMaterial,
        adaptation.navigationLayout,
        adaptation.screenGutter,
        reducedMotion ? "reduced-motion" : "system-motion",
        reducedTransparency ? "reduced-transparency" : "system-transparency",
      ].join("|")}
    </Text>
  );
}

describe("theme provider and adaptive surfaces", () => {
  it("provides deterministic dark, reduced-accessibility, and 320 dp values", async () => {
    await renderWithTheme(<EnvironmentProbe />, {
      platform: "android",
      preference: "dark",
      reducedMotion: true,
      reducedTransparency: true,
      windowWidth: 320,
    });

    expect(screen.getByRole("summary", { name: "Tema ortamı" })).toHaveTextContent(
      "dark|android|opaque-tonal|bottom-tabs|16|reduced-motion|reduced-transparency",
    );
  });

  it("selects a Material navigation rail at tablet width", async () => {
    await renderWithTheme(<EnvironmentProbe />, {
      platform: "android",
      windowWidth: 900,
    });

    expect(screen.getByRole("summary", { name: "Tema ortamı" })).toHaveTextContent(
      "light|android|opaque-tonal|navigation-rail|24|reduced-motion|system-transparency",
    );
  });

  it("renders readable screen content through a semantic screen boundary", async () => {
    await renderWithTheme(
      <Screen accessibilityLabel="Duyuru ekranı" readableWidth="form" scroll>
        <Text accessibilityRole="header">Duyurular</Text>
        <Text>Uzun içerik okunabilir genişlikte kalır.</Text>
      </Screen>,
      { windowWidth: 320 },
    );

    const screenBoundary = screen.getByLabelText("Duyuru ekranı");
    expect(within(screenBoundary).getByRole("header", { name: "Duyurular" })).toBeVisible();
    expect(
      within(screenBoundary).getByText("Uzun içerik okunabilir genişlikte kalır."),
    ).toBeVisible();
  });

  it("opts into keyboard avoidance and automatic scroll keyboard insets", async () => {
    await renderWithTheme(
      <Screen
        accessibilityLabel="Klavye güvenli form"
        keyboardSafe
        keyboardVerticalOffset={12}
        scroll
        scrollViewProps={{ automaticallyAdjustKeyboardInsets: false }}
      >
        <Text>Form içeriği</Text>
      </Screen>,
    );

    expect(
      screen.UNSAFE_getByType(KeyboardAvoidingView).props.keyboardVerticalOffset,
    ).toBe(12);
    expect(
      screen.UNSAFE_getByType(ScrollView).props.automaticallyAdjustKeyboardInsets,
    ).toBe(true);
  });

  it("uses Liquid Glass only for eligible iOS chrome", async () => {
    await renderWithTheme(
      <NavigationSurface accessibilityLabel="Alt gezinme" kind="tab-bar">
        <Text>Ana Sayfa</Text>
      </NavigationSurface>,
      {
        liquidGlassAvailable: true,
        platform: "ios",
        reducedTransparency: false,
      },
    );

    expect(screen.getByLabelText("Alt gezinme")).toBeVisible();
    expect(screen.getByTestId("mock-liquid-glass")).toBeVisible();
  });

  it("uses opaque chrome when transparency is reduced", async () => {
    await renderWithTheme(
      <NavigationSurface accessibilityLabel="Üst gezinme">
        <Text>Takvim</Text>
      </NavigationSurface>,
      {
        liquidGlassAvailable: true,
        platform: "ios",
        reducedTransparency: true,
      },
    );

    expect(screen.getByLabelText("Üst gezinme")).toBeVisible();
    expect(screen.queryByTestId("mock-liquid-glass")).toBeNull();
  });
});
