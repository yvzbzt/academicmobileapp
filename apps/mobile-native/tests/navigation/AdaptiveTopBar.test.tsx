import { Platform, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  fireEventAsync,
  renderAsync,
  screen,
} from "@testing-library/react-native";
import {
  AdaptiveTopBar,
  resolveAdaptiveTopBarLayout,
  type AdaptiveTopBarProps,
} from "../../src/navigation/AdaptiveTopBar";
import { ThemeProvider, type ThemeProviderProps } from "../../src/design-system/theme";
import { lightTheme } from "../../src/design-system/tokens";

async function renderTopBar(
  props: AdaptiveTopBarProps,
  themeOverrides: Omit<ThemeProviderProps, "children"> = {},
  windowWidth = 390,
) {
  return renderAsync(
    <SafeAreaProvider>
      <ThemeProvider
        liquidGlassAvailable={false}
        platform="android"
        preference="light"
        reducedMotion
        reducedTransparency={false}
        windowWidth={windowWidth}
        {...themeOverrides}
      >
        <AdaptiveTopBar {...props} />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe("AdaptiveTopBar", () => {
  it("renders a labelled toolbar with a wrapping title and optional subtitle", async () => {
    await renderTopBar({
      title: "Akademik Takvim",
      subtitle: "2026–2027 Güz Dönemi",
    });

    const toolbar = screen.getByLabelText("Akademik Takvim üst gezinme çubuğu");
    expect(toolbar).toBeVisible();
    expect(toolbar).toHaveProp("accessibilityRole", "toolbar");

    const title = screen.getByRole("header", { name: "Akademik Takvim" });
    expect(title).toHaveProp("allowFontScaling", true);
    expect(title).not.toHaveProp("numberOfLines");
    expect(title).toHaveStyle({ flexShrink: 1, flexWrap: "wrap" });

    const subtitle = screen.getByText("2026–2027 Güz Dönemi");
    expect(subtitle).toHaveProp("allowFontScaling", true);
    expect(subtitle).not.toHaveProp("numberOfLines");
    expect(subtitle).toHaveStyle({ flexShrink: 1, flexWrap: "wrap" });
  });

  it("activates named leading and trailing actions and exposes disabled state", async () => {
    const goBack = jest.fn();
    const openSearch = jest.fn();
    const openOverflow = jest.fn();

    await renderTopBar({
      title: "Duyurular",
      leadingAction: {
        accessibilityLabel: "Geri dön",
        icon: <Text>G</Text>,
        onPress: goBack,
      },
      trailingActions: [
        {
          accessibilityLabel: "Duyurularda ara",
          icon: <Text>A</Text>,
          onPress: openSearch,
        },
        {
          accessibilityLabel: "Diğer işlemler",
          disabled: true,
          icon: <Text>D</Text>,
          onPress: openOverflow,
        },
      ],
    });

    const back = screen.getByRole("button", { name: "Geri dön" });
    const search = screen.getByRole("button", { name: "Duyurularda ara" });
    const disabled = screen.getByRole("button", { name: "Diğer işlemler" });

    expect(back).toBeEnabled();
    expect(search).toBeEnabled();
    expect(disabled).toBeDisabled();
    expect(back).toHaveStyle({ minHeight: 48, minWidth: 48 });
    expect(search).toHaveStyle({ minHeight: 48, minWidth: 48 });

    await fireEventAsync.press(back);
    await fireEventAsync.press(search);
    await fireEventAsync.press(disabled);

    expect(goBack).toHaveBeenCalledTimes(1);
    expect(openSearch).toHaveBeenCalledTimes(1);
    expect(openOverflow).not.toHaveBeenCalled();
  });

  it("switches at the 375 dp boundary without truncating scalable copy", async () => {
    expect(resolveAdaptiveTopBarLayout(320)).toBe("compact");
    expect(resolveAdaptiveTopBarLayout(374)).toBe("compact");
    expect(resolveAdaptiveTopBarLayout(375)).toBe("regular");
    expect(resolveAdaptiveTopBarLayout(390)).toBe("regular");
    expect(resolveAdaptiveTopBarLayout(Number.NaN)).toBe("compact");

    const compactView = await renderTopBar(
      { title: "Duyurular ve Akademik Bağlam" },
      {},
      320,
    );
    expect(
      screen.getByRole("header", { name: "Duyurular ve Akademik Bağlam" }),
    ).toHaveStyle(lightTheme.typography.cardTitle);
    await compactView.unmountAsync();

    await renderTopBar(
      { title: "Duyurular ve Akademik Bağlam" },
      {},
      390,
    );
    expect(
      screen.getByRole("header", { name: "Duyurular ve Akademik Bağlam" }),
    ).toHaveStyle(lightTheme.typography.screenTitle);
  });

  it("uses Liquid Glass only for eligible iOS navigation chrome", async () => {
    await renderTopBar(
      { title: "Profil" },
      {
        liquidGlassAvailable: true,
        platform: "ios",
        reducedTransparency: false,
      },
    );

    const toolbar = screen.getByLabelText("Profil üst gezinme çubuğu");
    expect(toolbar).toBeVisible();
    expect(toolbar).toHaveProp("accessibilityRole", "toolbar");
    expect(screen.getByTestId("mock-liquid-glass")).toBeVisible();
  });

  it("uses opaque tonal chrome for iOS fallback and Android ripple controls", async () => {
    const iosFallback = await renderTopBar(
      { title: "Takvim" },
      {
        liquidGlassAvailable: true,
        platform: "ios",
        reducedTransparency: true,
      },
    );

    expect(screen.queryByTestId("mock-liquid-glass")).toBeNull();
    expect(
      screen.getByLabelText("Takvim üst gezinme çubuğu"),
    ).toHaveStyle({ backgroundColor: lightTheme.colors.background.surfaceRaised });
    await iosFallback.unmountAsync();

    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    try {
      const androidView = await renderTopBar({
        title: "Ana Sayfa",
        trailingActions: [
          {
            accessibilityLabel: "Bildirimleri aç",
            icon: <Text>B</Text>,
            onPress: jest.fn(),
          },
        ],
      });

      expect(screen.queryByTestId("mock-liquid-glass")).toBeNull();
      expect(
        screen.getByLabelText("Ana Sayfa üst gezinme çubuğu"),
      ).toHaveStyle({
        backgroundColor: lightTheme.colors.background.surfaceRaised,
      });
      expect(
        screen.getByRole("button", { name: "Bildirimleri aç" }).props
          .nativeBackgroundAndroid,
      ).toMatchObject({
        borderless: true,
        color: expect.any(Number),
        type: "RippleAndroid",
      });
      await androidView.unmountAsync();
    } finally {
      Object.defineProperty(Platform, "OS", {
        configurable: true,
        value: originalPlatform,
      });
    }
  });
});
