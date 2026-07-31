import { useState } from "react";
import {
  fireEvent,
  screen,
  userEvent,
} from "@testing-library/react-native";
import { BottomSheet } from "../../src/design-system/primitives/BottomSheet";
import {
  SelectField,
  type SelectFieldOption,
} from "../../src/design-system/primitives/SelectField";
import { Text } from "react-native";
import { renderWithTheme } from "./test-utils";

const options = [
  { value: "ankara", label: "Ankara Üniversitesi", supportingText: "Başkent" },
  { value: "ege", label: "Ege Üniversitesi", supportingText: "İzmir" },
  { value: "disabled", label: "Kullanılamayan kurum", disabled: true },
] as const satisfies readonly SelectFieldOption[];

function SelectHarness({ onValueChange }: { onValueChange: jest.Mock }) {
  const [value, setValue] = useState<"ankara" | "ege" | "disabled">("ankara");
  return (
    <SelectField
      label="Üniversite"
      onValueChange={(nextValue) => {
        setValue(nextValue);
        onValueChange(nextValue);
      }}
      options={options}
      supportingText="Akademik profil kapsamı"
      value={value}
    />
  );
}

describe("accessible SelectField", () => {
  it("announces the controlled value, opens a radio sheet, selects once, and dismisses", async () => {
    const onValueChange = jest.fn();
    await renderWithTheme(<SelectHarness onValueChange={onValueChange} />);

    const field = screen.getByRole("combobox", { name: "Üniversite" });
    expect(field).toHaveProp("accessibilityValue", { text: "Ankara Üniversitesi" });
    expect(field).toHaveProp(
      "accessibilityState",
      expect.objectContaining({ busy: false, disabled: false, expanded: false }),
    );

    await userEvent.press(field);
    expect(screen.getByTestId("bottom-sheet")).toHaveProp("role", "dialog");
    expect(field).toHaveProp(
      "accessibilityState",
      expect.objectContaining({ expanded: true }),
    );
    expect(screen.getByRole("radio", { name: "Ankara Üniversitesi" })).toBeSelected();
    expect(screen.getByRole("radio", { name: "Ege Üniversitesi" })).not.toBeSelected();

    await userEvent.press(screen.getByRole("radio", { name: "Ege Üniversitesi" }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("ege");
    expect(screen.queryByTestId("bottom-sheet")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Üniversite" })).toHaveProp(
      "accessibilityValue",
      { text: "Ege Üniversitesi" },
    );
  });

  it("keeps disabled and loading selectors closed with explicit accessible state", async () => {
    const onValueChange = jest.fn();
    await renderWithTheme(
      <>
        <SelectField
          disabled
          label="Devre dışı seçici"
          onValueChange={onValueChange}
          options={options}
          value="ankara"
        />
        <SelectField
          label="Yüklenen seçici"
          loading
          onValueChange={onValueChange}
          options={options}
          value={null}
        />
      </>,
    );

    const disabled = screen.getByRole("combobox", { name: "Devre dışı seçici" });
    const loading = screen.getByRole("combobox", { name: "Yüklenen seçici" });
    expect(disabled).toBeDisabled();
    expect(loading).toBeDisabled();
    expect(loading).toBeBusy();
    expect(loading).toHaveTextContent("Seçenekler yükleniyor");

    await userEvent.press(disabled);
    await userEvent.press(loading);
    expect(screen.queryByTestId("bottom-sheet")).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("marks the current option selected and blocks an unavailable option", async () => {
    const onValueChange = jest.fn();
    await renderWithTheme(<SelectHarness onValueChange={onValueChange} />);
    await userEvent.press(screen.getByRole("combobox", { name: "Üniversite" }));

    const unavailable = screen.getByRole("radio", { name: "Kullanılamayan kurum" });
    expect(unavailable).toBeDisabled();
    await userEvent.press(unavailable);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("bottom-sheet")).toHaveProp(
      "accessibilityLabel",
      "Üniversite seçenekleri",
    );
  });

  it("renders an accessible empty-state message instead of an empty option list", async () => {
    await renderWithTheme(
      <SelectField
        emptyLabel="Henüz kurum yok."
        label="Boş seçici"
        onValueChange={jest.fn()}
        options={[]}
        value={null}
      />,
    );
    await userEvent.press(screen.getByRole("combobox", { name: "Boş seçici" }));

    expect(screen.getByRole("summary", { name: "Henüz kurum yok." })).toBeVisible();
  });
});

describe("accessible BottomSheet", () => {
  it("supports explicit, backdrop, and accessibility-escape dismissal", async () => {
    const onDismiss = jest.fn();
    const view = await renderWithTheme(
      <BottomSheet onDismiss={onDismiss} title="Filtreler" visible>
        <Text>Filtre içeriği</Text>
      </BottomSheet>,
    );

    const dialog = screen.getByTestId("bottom-sheet");
    expect(dialog).toHaveProp("role", "dialog");
    expect(dialog).toHaveProp("accessibilityViewIsModal", true);
    expect(dialog).not.toBeBusy();
    expect(screen.getByRole("header", { name: "Filtreler" })).toBeVisible();

    await userEvent.press(screen.getByRole("button", { name: "Alt sayfayı kapat" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await userEvent.press(screen.getByTestId("bottom-sheet-backdrop"));
    expect(onDismiss).toHaveBeenCalledTimes(2);
    fireEvent(dialog, "accessibilityEscape");
    expect(onDismiss).toHaveBeenCalledTimes(3);

    await view.unmountAsync();
  });

  it("locks every dismiss path and announces progress while loading", async () => {
    const onDismiss = jest.fn();
    await renderWithTheme(
      <BottomSheet loading onDismiss={onDismiss} title="Kaydediliyor" visible>
        <Text>Korunan içerik</Text>
      </BottomSheet>,
    );

    const dialog = screen.getByTestId("bottom-sheet");
    const close = screen.getByRole("button", { name: "Alt sayfayı kapat" });
    const backdrop = screen.getByTestId("bottom-sheet-backdrop");
    expect(dialog).toBeBusy();
    expect(close).toBeDisabled();
    expect(backdrop).toBeDisabled();
    expect(screen.getByRole("progressbar", { name: "İşlem sürüyor" })).toBeBusy();

    await userEvent.press(close);
    await userEvent.press(backdrop);
    fireEvent(dialog, "accessibilityEscape");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("uses semantic iOS and Android sheet treatments", async () => {
    const iosView = await renderWithTheme(
      <BottomSheet onDismiss={jest.fn()} title="iOS sayfası" visible>
        <Text>İçerik</Text>
      </BottomSheet>,
      { platform: "ios", reducedMotion: false },
    );
    expect(
      screen.getByTestId("bottom-sheet-grabber", { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("bottom-sheet")).toHaveStyle({
      shadowOpacity: 0.2,
    });
    await iosView.unmountAsync();

    await renderWithTheme(
      <BottomSheet onDismiss={jest.fn()} title="Android sayfası" visible>
        <Text>İçerik</Text>
      </BottomSheet>,
      { platform: "android" },
    );
    expect(screen.queryByTestId("bottom-sheet-grabber")).toBeNull();
    expect(screen.getByTestId("bottom-sheet")).toHaveStyle({
      elevation: 6,
    });
  });
});
