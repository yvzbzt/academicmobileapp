import { FlatList, ScrollView, SectionList } from "react-native";
import { fireEvent, screen } from "@testing-library/react-native";
import { PreLoginWelcomeScreen } from "../../src/auth/PreLoginWelcomeScreen";
import { renderWithTheme } from "../design-system/test-utils";

describe("PreLoginWelcomeScreen", () => {
  it("keeps all introduction content and its CTA visible without a scrolling primitive", async () => {
    const onContinue = jest.fn();
    const view = await renderWithTheme(
      <PreLoginWelcomeScreen onContinue={onContinue} />,
    );

    expect(screen.getByTestId("prelogin-feature-calendar-clear-outline")).toBeVisible();
    expect(screen.getByTestId("prelogin-feature-megaphone-outline")).toBeVisible();
    expect(screen.getByTestId("prelogin-feature-notifications-outline")).toBeVisible();

    const continueButton = screen.getByTestId("prelogin-continue-button");
    expect(continueButton).toBeVisible();

    expect(view.UNSAFE_queryAllByType(ScrollView)).toHaveLength(0);
    expect(view.UNSAFE_queryAllByType(FlatList)).toHaveLength(0);
    expect(view.UNSAFE_queryAllByType(SectionList)).toHaveLength(0);

    fireEvent.press(continueButton);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
