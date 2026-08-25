import { FlatList, SectionList } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PreLoginWelcomeScreen } from "../../src/auth/PreLoginWelcomeScreen";
import { renderWithTheme } from "../design-system/test-utils";

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
  {
    bottomInset = 24,
    fontScale = 1,
    height = 844,
    width = 390,
  }: WelcomeViewport = {},
) {
  mockWindowDimensions.mockReturnValue({ fontScale, height, scale: 3, width });
  return renderWithTheme(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width, height },
        insets: { top: 0, right: 0, bottom: bottomInset, left: 0 },
      }}
    >
      <PreLoginWelcomeScreen onContinue={onContinue} />
    </SafeAreaProvider>,
    { windowWidth: width },
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
      paddingBottom: 32,
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
    expect(screen.getByTestId("prelogin-slide-1")).toHaveProp(
      "accessibilityLabel",
      expect.stringMatching(/2 \/ 3\. Dönemini rahatça planla/u),
    );
    expect(screen.getByTestId("prelogin-slide-2")).toHaveProp(
      "accessibilityLabel",
      expect.stringMatching(/3 \/ 3\. Kendi düzenini oluştur/u),
    );
    expect(screen.queryByText("Bugünün planı")).toBeNull();
    expect(screen.queryByText("Ders kaydı son günü")).toBeNull();
    expect(screen.queryByText("Ana Sayfa")).toBeNull();

    for (const index of [1, 2, 3]) {
      const paginationTarget = screen.getByRole("button", {
        name: `${index}. tanıtım sayfasına git`,
      });
      expect(paginationTarget).toHaveStyle({ height: 48, width: 48 });
      expect(paginationTarget).toHaveProp("hitSlop", 4);
    }

    const continueButton = screen.getByTestId("prelogin-continue-button");
    expect(continueButton).toBeVisible();

    expect(view.UNSAFE_queryAllByType(FlatList)).toHaveLength(1);
    expect(view.UNSAFE_getByType(FlatList).props.horizontal).toBe(true);
    expect(view.UNSAFE_getByType(FlatList).props.pagingEnabled).toBe(true);
    expect(view.UNSAFE_queryAllByType(SectionList)).toHaveLength(0);

    fireEvent.press(continueButton);
    expect(onContinue).not.toHaveBeenCalled();
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
      paddingBottom: 38,
    });
    expect(screen.getByTestId("prelogin-continue-button")).toBeVisible();
    expect(screen.getByTestId("prelogin-trust-footer")).toBeVisible();
    expect(screen.getByTestId("prelogin-illustration-0", {
      includeHiddenElements: true,
    })).toHaveStyle({
      height: 242.4,
      minHeight: 0,
    });
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
      paddingBottom: 28,
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
      paddingBottom: 28,
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
});
