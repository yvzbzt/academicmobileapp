import { screen, userEvent } from "@testing-library/react-native";
import { DesignSystemPreview } from "../../src/design-system/DesignSystemPreview";
import { renderWithTheme } from "./test-utils";

describe("DesignSystemPreview", () => {
  it("renders the deterministic primitive state matrix behind an isolated component", async () => {
    await renderWithTheme(<DesignSystemPreview />);

    expect(
      screen.getByRole("header", { name: "Tasarım sistemi durum matrisi" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Birincil eylem" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Devre dışı eylem" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Yüklenen eylem" })).toBeBusy();
    expect(screen.getByRole("combobox", { name: "Üniversite" })).toBeVisible();
    expect(screen.getByRole("alert", { name: "Hata. İşlem tamamlanamadı." })).toBeVisible();
    expect(screen.queryByTestId("bottom-sheet")).toBeNull();

    await userEvent.press(
      screen.getByRole("button", { name: "Alt sayfa önizlemesini aç" }),
    );
    expect(screen.getByTestId("bottom-sheet")).toHaveProp("role", "dialog");
    await userEvent.press(screen.getByRole("button", { name: "Alt sayfayı kapat" }));
    expect(screen.queryByTestId("bottom-sheet")).toBeNull();
  });
});
