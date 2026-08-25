import { createRef, useState } from "react";
import { Text, TextInput } from "react-native";
import {
  act,
  fireEvent,
  fireEventAsync,
  screen,
  userEvent,
} from "@testing-library/react-native";
import { Platform } from "react-native";
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

function ControlledPasswordField() {
  const [revealed, setRevealed] = useState(false);
  return (
    <PasswordField
      label="Denetimli şifre"
      onVisibilityChange={setRevealed}
      revealed={revealed}
      value="gizli-parola"
    />
  );
}

function mockAnimationFrames() {
  let nextFrameId = 1;
  const callbacks = new Map<number, Parameters<typeof requestAnimationFrame>[0]>();
  jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    callbacks.set(frameId, callback);
    return frameId;
  });
  jest.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((frameId) => {
    callbacks.delete(frameId);
  });

  return {
    pending: () => callbacks.size,
    runNext: async () => {
      const next = callbacks.entries().next().value;
      if (!next) {
        throw new Error("No animation frame is pending.");
      }
      const [frameId, callback] = next;
      callbacks.delete(frameId);
      await act(async () => callback(16));
    },
  };
}

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
    const error = screen.getByRole("alert", {
      name: "Geçerli bir e-posta adresi girin.",
    });
    expect(field).toHaveDisplayValue("yanlış");
    expect(field).toHaveProp("accessibilityHint", "Geçerli bir e-posta adresi girin.");
    expect(field).toHaveProp("aria-invalid", true);
    expect(field).toHaveProp("aria-errormessage", error.props.nativeID);
    expect(error).toBeVisible();

    await fireEventAsync.changeText(field, "ogrenci@example.edu.tr");
    expect(onChangeText).toHaveBeenCalledWith("ogrenci@example.edu.tr");
  });

  it("forwards a typed ref to the native text input", async () => {
    const inputRef = createRef<TextInput>();

    await renderWithTheme(
      <TextField label="Odaklanabilir alan" ref={inputRef} value="" />,
    );

    expect(inputRef.current).not.toBeNull();
    expect(typeof inputRef.current?.focus).toBe("function");
  });

  it("forwards password inputs through callback refs and clears them on unmount", async () => {
    const callbackRef = jest.fn((_input: TextInput | null) => undefined);
    const view = await renderWithTheme(
      <PasswordField label="Password" ref={callbackRef} value="" />,
    );

    expect(callbackRef).toHaveBeenCalledWith(expect.anything());
    await view.unmountAsync();
    expect(callbackRef).toHaveBeenLastCalledWith(null);
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

  it("supports parent-controlled password visibility", async () => {
    await renderWithTheme(<ControlledPasswordField />);

    const password = screen.getByLabelText("Denetimli şifre");
    expect(password).toHaveProp("secureTextEntry", true);

    await userEvent.press(screen.getByRole("button", { name: "Şifreyi göster" }));
    expect(password).toHaveProp("secureTextEntry", false);

    await userEvent.press(screen.getByRole("button", { name: "Şifreyi gizle" }));
    expect(password).toHaveProp("secureTextEntry", true);
  });

  it("reconnects an already-focused Android password input without exposing a synthetic blur", async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    const frames = mockAnimationFrames();
    const inputRef = createRef<TextInput>();
    const onBlur = jest.fn();
    const onFocus = jest.fn();

    try {
      await renderWithTheme(
        <PasswordField
          hidePasswordLabel="Hide password"
          label="Password"
          onBlur={onBlur}
          onFocus={onFocus}
          ref={inputRef}
          selection={{ start: 4, end: 4 }}
          showPasswordLabel="Show password"
          value="gizli-parola"
        />,
      );

      const password = screen.getByLabelText("Password");
      const nativeInput = inputRef.current!;
      const blur = jest.spyOn(nativeInput, "blur").mockImplementation(() => undefined);
      const focus = jest.spyOn(nativeInput, "focus").mockImplementation(() => undefined);
      jest.spyOn(nativeInput, "isFocused").mockReturnValue(true);
      jest.spyOn(TextInput.State, "currentlyFocusedInput").mockImplementation(() => null as never);

      fireEvent(password, "focus");
      expect(onFocus).toHaveBeenCalledTimes(1);
      fireEvent.press(screen.getByRole("button", { name: "Show password" }));

      expect(password).toHaveProp("secureTextEntry", false);
      expect(password).toHaveProp("keyboardType", "visible-password");
      expect(password).toHaveProp("selection", { start: 4, end: 4 });
      expect(frames.pending()).toBe(1);

      await frames.runNext();
      expect(blur).toHaveBeenCalledTimes(1);
      fireEvent(password, "blur");
      expect(onBlur).not.toHaveBeenCalled();

      await frames.runNext();
      expect(focus).toHaveBeenCalledTimes(1);
      fireEvent(password, "focus");
      expect(onFocus).toHaveBeenCalledTimes(1);
      expect(frames.pending()).toBe(0);

      fireEvent(password, "blur");
      expect(onBlur).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(Platform, "OS", { configurable: true, value: originalPlatform });
    }
  });

  it("does not focus an idle password input when visibility changes", async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    const frames = mockAnimationFrames();
    const inputRef = createRef<TextInput>();

    try {
      await renderWithTheme(
        <PasswordField
          hidePasswordLabel="Hide password"
          label="Password"
          ref={inputRef}
          showPasswordLabel="Show password"
          value="gizli-parola"
        />,
      );
      const password = screen.getByLabelText("Password");
      const nativeInput = inputRef.current!;
      const blur = jest.spyOn(nativeInput, "blur").mockImplementation(() => undefined);
      const focus = jest.spyOn(nativeInput, "focus").mockImplementation(() => undefined);
      jest.spyOn(nativeInput, "isFocused").mockReturnValue(false);

      fireEvent.press(screen.getByRole("button", { name: "Show password" }));

      expect(password).toHaveProp("secureTextEntry", false);
      expect(password).toHaveProp("keyboardType", "visible-password");
      expect(frames.pending()).toBe(0);
      expect(blur).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, "OS", { configurable: true, value: originalPlatform });
    }
  });

  it("does not reconnect focused password inputs on iOS", async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    const frames = mockAnimationFrames();
    const inputRef = createRef<TextInput>();

    try {
      await renderWithTheme(
        <PasswordField
          hidePasswordLabel="Hide password"
          label="Password"
          ref={inputRef}
          showPasswordLabel="Show password"
          value="gizli-parola"
        />,
      );
      const password = screen.getByLabelText("Password");
      const nativeInput = inputRef.current!;
      const blur = jest.spyOn(nativeInput, "blur").mockImplementation(() => undefined);
      const focus = jest.spyOn(nativeInput, "focus").mockImplementation(() => undefined);
      jest.spyOn(nativeInput, "isFocused").mockReturnValue(true);

      fireEvent(password, "focus");
      fireEvent.press(screen.getByRole("button", { name: "Show password" }));

      expect(password).toHaveProp("secureTextEntry", false);
      expect(password.props.keyboardType).toBeUndefined();
      expect(frames.pending()).toBe(0);
      expect(blur).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, "OS", { configurable: true, value: originalPlatform });
    }
  });

  it("preserves an explicit password keyboard type on Android", async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });

    try {
      await renderWithTheme(
        <PasswordField
          hidePasswordLabel="Hide password"
          keyboardType="number-pad"
          label="PIN"
          showPasswordLabel="Show password"
          value="1234"
        />,
      );
      const password = screen.getByLabelText("PIN");

      expect(password).toHaveProp("keyboardType", "number-pad");
      fireEvent.press(screen.getByRole("button", { name: "Show password" }));
      expect(password).toHaveProp("keyboardType", "number-pad");
    } finally {
      Object.defineProperty(Platform, "OS", { configurable: true, value: originalPlatform });
    }
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
