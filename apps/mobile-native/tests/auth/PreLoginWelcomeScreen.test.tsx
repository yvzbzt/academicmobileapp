import { FlatList, SectionList } from "react-native";
import { act, fireEvent, renderAsync, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PreLoginWelcomeScreen } from "../../src/auth/PreLoginWelcomeScreen";
import { ThemeProvider } from "../../src/design-system/theme";

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

interface WelcomeViewport {
  bottomInset?: number;
  fontScale?: number;
  height?: number;
  width?: number;
}

function renderWelcome(
  onContinue: () => void,
  viewport: WelcomeViewport = {},
) {
  const {
    bottomInset = 24,
    fontScale = 1,
    height = 844,
    width = 390,
  } = viewport;
  mockWindowDimensions.mockReturnValue({ fontScale, height, scale: 3, width });
  return renderAsync(welcomeTestTree(onContinue, viewport));
}

function welcomeTestTree(
  onContinue: () => void,
  {
    bottomInset = 24,
    height = 844,
    width = 390,
  }: WelcomeViewport = {},
) {
  return (
    <ThemeProvider
      liquidGlassAvailable={false}
      platform="android"
      preference="light"
      reducedMotion
      reducedTransparency={false}
      windowWidth={width}
    >
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width, height },
        insets: { top: 0, right: 0, bottom: bottomInset, left: 0 },
      }}
    >
      <PreLoginWelcomeScreen onContinue={onContinue} />
    </SafeAreaProvider>
    </ThemeProvider>
  );
}

async function settleVirtualizedList(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
  });
}

describe("PreLoginWelcomeScreen", () => {
  it("pages through the three design-package slides in the required order", async () => {
    const onContinue = jest.fn();
    const view = await renderWelcome(onContinue);
    await settleVirtualizedList();

    expect(screen.getByLabelText("Akademik Takvim logosu")).toBeVisible();
    expect(screen.getByTestId("prelogin-welcome-screen")).toHaveStyle({
      paddingBottom: 8,
    });
    expect(screen.getByTestId("prelogin-welcome-slides")).toHaveStyle({
      flexShrink: 1,
      minHeight: 0,
    });
    expect(screen.getByTestId("prelogin-action-area")).toHaveStyle({ flexShrink: 0 });
    expect(screen.getByTestId("prelogin-trust-footer")).toBeVisible();
    expect(screen.getByTestId("prelogin-slide-0")).toHaveProp(
      "accessibilityLabel",
      expect.stringMatching(/1 \/ 3\. Duyuruları tek yerden takip et/u),
    );
    for (const index of [1, 2]) {
      const offscreenSlide = screen.getByTestId(`prelogin-slide-${index}`, {
        includeHiddenElements: true,
      });
      expect(offscreenSlide).toHaveProp("accessible", false);
      expect(offscreenSlide).toHaveProp("accessibilityElementsHidden", true);
      expect(offscreenSlide).toHaveProp("importantForAccessibility", "no-hide-descendants");
      expect(offscreenSlide.props.accessibilityLabel).toBeUndefined();
    }
    expect(screen.queryByText("Bugünün planı")).toBeNull();
    expect(screen.queryByText("Ders kaydı son günü")).toBeNull();
    expect(screen.queryByText("Ana Sayfa")).toBeNull();

    const pagination = screen.getByRole("adjustable", {
      name: "1. tanıtım sayfası seçili",
    });
    expect(pagination).toHaveProp("accessibilityState", { disabled: false });
    expect(pagination).toHaveAccessibilityValue({ max: 3, min: 1, now: 1, text: "1 / 3" });

    for (const index of [0, 1, 2]) {
      const paginationTarget = screen.getByTestId(`prelogin-pagination-target-${index}`, {
        includeHiddenElements: true,
      });
      expect(paginationTarget).toHaveStyle({ height: 48, width: 48 });
      expect(paginationTarget).toHaveProp("hitSlop", 4);
      expect(paginationTarget).toHaveProp("accessible", false);
    }

    const continueButton = screen.getByTestId("prelogin-continue-button");
    expect(continueButton).toBeVisible();

    expect(view.UNSAFE_queryAllByType(FlatList)).toHaveLength(1);
    expect(view.UNSAFE_getByType(FlatList).props.horizontal).toBe(true);
    expect(view.UNSAFE_getByType(FlatList).props.pagingEnabled).toBe(true);
    expect(view.UNSAFE_queryAllByType(SectionList)).toHaveLength(0);

    fireEvent.press(continueButton);
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByTestId("prelogin-slide-1")).toHaveProp("accessible", true);
    expect(screen.getByTestId("prelogin-slide-0", {
      includeHiddenElements: true,
    })).toHaveProp("accessibilityElementsHidden", true);
    fireEvent.press(continueButton);
    expect(screen.getByRole("button", { name: "Başlayalım" })).toBeVisible();
    fireEvent.press(continueButton);
    expect(onContinue).toHaveBeenCalledTimes(1);
    await settleVirtualizedList();
    await view.unmountAsync();
  });

  it("keeps the CTA and trust footer above the inset at 320x640 and 200% text", async () => {
    const view = await renderWelcome(jest.fn(), {
      bottomInset: 34,
      fontScale: 2,
      height: 640,
      width: 320,
    });
    await settleVirtualizedList();

    expect(screen.getByTestId("prelogin-welcome-screen")).toHaveStyle({
      paddingBottom: 4,
    });
    expect(screen.getByTestId("prelogin-continue-button")).toBeVisible();
    expect(screen.getByTestId("prelogin-trust-footer")).toBeVisible();
    expect(screen.getByTestId("prelogin-illustration-0", {
      includeHiddenElements: true,
    })).toHaveStyle({
      height: 194,
      minHeight: 0,
    });
    expect(screen.getByText("Atla")).toHaveProp("maxFontSizeMultiplier", 2);
    expect(screen.getByText("Güvenilir akademik kaynaklar · Kontrol sende")).toHaveProp(
      "maxFontSizeMultiplier",
      1.6,
    );
    await view.unmountAsync();
  });

  it("shrinks the artwork without sacrificing the inset-protected actions in landscape", async () => {
    const view = await renderWelcome(jest.fn(), {
      bottomInset: 24,
      height: 320,
      width: 640,
    });
    await settleVirtualizedList();

    expect(screen.getByTestId("prelogin-welcome-screen")).toHaveStyle({
      paddingBottom: 4,
    });
    expect(screen.getByTestId("prelogin-illustration-0", {
      includeHiddenElements: true,
    })).toHaveStyle({
      height: 112,
      minHeight: 0,
    });
    expect(screen.getByTestId("prelogin-continue-button")).toBeVisible();
    expect(screen.getByTestId("prelogin-trust-footer")).toBeVisible();
    await view.unmountAsync();
  });

  it("keeps the bounded tablet artwork and bottom inset", async () => {
    const view = await renderWelcome(jest.fn(), {
      bottomInset: 20,
      height: 1366,
      width: 1024,
    });
    await settleVirtualizedList();

    expect(screen.getByTestId("prelogin-welcome-screen")).toHaveStyle({
      paddingBottom: 8,
    });
    expect(screen.getByTestId("prelogin-illustration-0", {
      includeHiddenElements: true,
    })).toHaveStyle({
      height: 680,
      minHeight: 0,
    });
    expect(screen.getByTestId("prelogin-action-area")).toBeVisible();
    await view.unmountAsync();
  });

  it("remounts the pager at the active slide after a viewport rotation", async () => {
    const onContinue = jest.fn();
    const portrait: WelcomeViewport = { bottomInset: 24, height: 844, width: 390 };
    const landscape: WelcomeViewport = { bottomInset: 24, height: 390, width: 844 };
    const view = await renderWelcome(onContinue, portrait);
    await settleVirtualizedList();

    fireEvent.press(screen.getByTestId("prelogin-continue-button"));
    const portraitList = view.UNSAFE_getByType(FlatList);
    expect(portraitList.props.initialScrollIndex).toBe(1);

    mockWindowDimensions.mockReturnValue({ fontScale: 1, height: 390, scale: 3, width: 844 });
    await view.rerenderAsync(welcomeTestTree(onContinue, landscape));

    const landscapeList = view.UNSAFE_getByType(FlatList);
    expect(landscapeList).not.toBe(portraitList);
    expect(landscapeList.props.initialScrollIndex).toBe(1);
    expect(screen.getByTestId("prelogin-welcome-slides")).toHaveStyle({ width: 680 });
    expect(screen.getByTestId("prelogin-slide-1")).toHaveProp("accessible", true);
    expect(screen.getByRole("adjustable")).toHaveAccessibilityValue({ now: 2, text: "2 / 3" });

    await view.unmountAsync();
  });
});
