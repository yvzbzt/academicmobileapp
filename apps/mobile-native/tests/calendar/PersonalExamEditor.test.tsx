import { ScrollView } from "react-native";
import { screen, within } from "@testing-library/react-native";
import { PersonalExamEditor } from "../../src/calendar/PersonalExamEditor";
import { renderWithTheme } from "../design-system/test-utils";

describe("PersonalExamEditor", () => {
  it("keeps its actions visible outside the scrollable field region", async () => {
    const view = await renderWithTheme(
      <PersonalExamEditor
        onDismiss={jest.fn()}
        onSubmit={() => ({ ok: true })}
        visible
      />,
    );

    const fieldScroll = screen.getByTestId("personal-exam-fields-scroll");
    const actions = screen.getByTestId("personal-exam-actions");

    expect(view.UNSAFE_getAllByType(ScrollView)).toHaveLength(1);
    expect(within(fieldScroll).getByLabelText("Etkinlik adı")).toBeVisible();
    expect(within(fieldScroll).getByLabelText("Konum veya not")).toBeVisible();
    expect(within(fieldScroll).queryByRole("button", { name: "Vazgeç" })).toBeNull();
    expect(within(fieldScroll).queryByRole("button", { name: "Etkinliği ekle" })).toBeNull();
    expect(within(actions).getByRole("button", { name: "Vazgeç" })).toBeVisible();
    expect(within(actions).getByRole("button", { name: "Etkinliği ekle" })).toBeVisible();
  });
});
