import { Text } from "react-native";
import {
  fireEventAsync,
  screen,
  userEvent,
} from "@testing-library/react-native";
import {
  PasswordField,
  SearchField,
  TextField,
} from "../../src/design-system/primitives/Fields";
import {
  Card,
  ListItem,
} from "../../src/design-system/primitives/Content";
import { renderWithTheme } from "./test-utils";

describe("accessible field and content primitives", () => {
  it("keeps a persistent field label and announces validation guidance", async () => {
    const onChangeText = jest.fn();
    await renderWithTheme(
      <TextField
        error="Geçerli bir e-posta adresi girin."
        keyboardType="email-address"
        label="E-posta"
        onChangeText={onChangeText}
        value="yanlış"
      />,
    );

    const field = screen.getByLabelText("E-posta");
    expect(field).toHaveDisplayValue("yanlış");
    expect(field).toHaveProp("accessibilityHint", "Geçerli bir e-posta adresi girin.");
    expect(
      screen.getByRole("alert", { name: "Geçerli bir e-posta adresi girin." }),
    ).toBeVisible();

    await fireEventAsync.changeText(field, "ogrenci@example.edu.tr");
    expect(onChangeText).toHaveBeenCalledWith("ogrenci@example.edu.tr");
  });

  it("renders supporting text and a non-color disabled field state", async () => {
    await renderWithTheme(
      <TextField
        disabled
        label="Üniversite"
        supportingText="Profil kapsamından yönetilir."
        value="Ankara Üniversitesi"
      />,
    );

    const field = screen.getByLabelText("Üniversite");
    expect(field).toHaveProp("editable", false);
    expect(field).toHaveProp("accessibilityHint", "Profil kapsamından yönetilir.");
    expect(screen.getByText("Profil kapsamından yönetilir.")).toBeVisible();
  });

  it("toggles password visibility through an explicitly named control", async () => {
    const onVisibilityChange = jest.fn();
    await renderWithTheme(
      <PasswordField
        label="Şifre"
        onVisibilityChange={onVisibilityChange}
        value="gizli-parola"
      />,
    );

    const password = screen.getByLabelText("Şifre");
    expect(password).toHaveProp("secureTextEntry", true);
    await userEvent.press(screen.getByRole("button", { name: "Şifreyi göster" }));
    expect(password).toHaveProp("secureTextEntry", false);
    expect(onVisibilityChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Şifreyi gizle" })).toBeVisible();
  });

  it("clears search input through a named clear action", async () => {
    const onChangeText = jest.fn();
    const onClear = jest.fn();
    await renderWithTheme(
      <SearchField
        label="Duyurularda ara"
        onChangeText={onChangeText}
        onClear={onClear}
        value="sınav"
      />,
    );

    expect(screen.getByRole("search", { name: "Duyurularda ara" })).toHaveDisplayValue(
      "sınav",
    );
    await userEvent.press(screen.getByRole("button", { name: "Aramayı temizle" }));
    expect(onChangeText).toHaveBeenCalledWith("");
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("keeps cards opaque and gives actionable cards button semantics", async () => {
    const onPress = jest.fn();
    await renderWithTheme(
      <>
        <Card
          accessibilityLabel="Akademik takvim duyurusu"
          onPress={onPress}
          selected
          variant="elevated"
        >
          <Text>2026–2027 kayıt tarihleri</Text>
        </Card>
        <Card variant="tonal">
          <Text>Salt okunur özet</Text>
        </Card>
      </>,
      { platform: "ios", liquidGlassAvailable: true },
    );

    const actionCard = screen.getByRole("button", {
      name: "Akademik takvim duyurusu",
    });
    expect(actionCard).toBeSelected();
    await userEvent.press(actionCard);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("mock-liquid-glass")).toBeNull();
    expect(screen.getByText("Salt okunur özet")).toBeVisible();
  });

  it("renders wrapping list copy and blocks disabled row actions", async () => {
    const onPress = jest.fn();
    await renderWithTheme(
      <>
        <ListItem
          onPress={onPress}
          supportingText="Resmî üniversite kaynağındaki ayrıntıları açar."
          title="Duyuru ayrıntısı"
        />
        <ListItem disabled onPress={onPress} title="Kullanılamayan ayar" />
      </>,
      { windowWidth: 320 },
    );

    await userEvent.press(screen.getByRole("button", { name: "Duyuru ayrıntısı" }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Resmî üniversite kaynağındaki ayrıntıları açar."),
    ).toBeVisible();

    const disabledRow = screen.getByRole("button", { name: "Kullanılamayan ayar" });
    expect(disabledRow).toBeDisabled();
    await fireEventAsync.press(disabledRow);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
