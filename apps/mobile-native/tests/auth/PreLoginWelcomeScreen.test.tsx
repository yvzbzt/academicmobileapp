import { FlatList, SectionList } from "react-native";
import { fireEvent, screen } from "@testing-library/react-native";
import { PreLoginWelcomeScreen } from "../../src/auth/PreLoginWelcomeScreen";
import { renderWithTheme } from "../design-system/test-utils";

describe("PreLoginWelcomeScreen", () => {
  it("pages through three instructional vector slides without fake agenda data", async () => {
    const onContinue = jest.fn();
    const view = await renderWithTheme(
      <PreLoginWelcomeScreen onContinue={onContinue} />,
    );

    expect(screen.getByTestId("prelogin-slide-0")).toBeVisible();
    expect(screen.getByTestId("prelogin-slide-1")).toBeVisible();
    expect(screen.getByTestId("prelogin-slide-2")).toBeVisible();
    expect(screen.queryByText("Bugünün planı")).toBeNull();
    expect(screen.queryByText("Ders kaydı son günü")).toBeNull();
    expect(screen.queryByText("Ana Sayfa")).toBeNull();

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
  });
});
