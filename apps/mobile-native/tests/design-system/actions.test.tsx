import { Text } from "react-native";
import {
  fireEventAsync,
  screen,
  userEvent,
} from "@testing-library/react-native";
import { darkTheme, lightTheme } from "../../src/design-system/tokens";
import { Button } from "../../src/design-system/primitives/Button";
import { IconButton } from "../../src/design-system/primitives/IconButton";
import {
  Chip,
  SegmentedControl,
} from "../../src/design-system/primitives/Content";
import { renderWithTheme } from "./test-utils";

describe("accessible action primitives", () => {
  it("renders and activates the default primary button by accessible name", async () => {
    const onPress = jest.fn();
    await renderWithTheme(<Button label="Kaydet" onPress={onPress} />);

    const button = screen.getByRole("button", { name: "Kaydet" });
    expect(button).toBeEnabled();
    expect(button).not.toBeBusy();
    expect(button).toHaveStyle({ backgroundColor: lightTheme.colors.action.primary });

    await userEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("exposes the pressed state without relying on color alone", async () => {
    await renderWithTheme(<Button label="Devam" onPress={jest.fn()} />, {
      platform: "ios",
    });
    const button = screen.getByRole("button", { name: "Devam" });

    await fireEventAsync(button, "pressIn");
    expect(button).toHaveStyle({
      backgroundColor: lightTheme.colors.action.primaryPressed,
      transform: [{ scale: 0.99 }],
    });
    await fireEventAsync(button, "pressOut");
    expect(button).toHaveStyle({ backgroundColor: lightTheme.colors.action.primary });
  });

  it("keeps disabled and loading button labels stable and blocks actions", async () => {
    const disabledPress = jest.fn();
    const loadingPress = jest.fn();
    await renderWithTheme(
      <>
        <Button disabled label="Sil" onPress={disabledPress} variant="danger" />
        <Button label="Takvime ekle" loading onPress={loadingPress} />
      </>,
    );

    const disabledButton = screen.getByRole("button", { name: "Sil" });
    const loadingButton = screen.getByRole("button", { name: "Takvime ekle" });
    expect(disabledButton).toBeDisabled();
    expect(disabledButton).toHaveStyle({
      backgroundColor: lightTheme.colors.action.disabled,
    });
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toBeBusy();

    await fireEventAsync.press(disabledButton);
    await fireEventAsync.press(loadingButton);
    expect(disabledPress).not.toHaveBeenCalled();
    expect(loadingPress).not.toHaveBeenCalled();
  });

  it("renders explicit success and error states in dark mode", async () => {
    await renderWithTheme(
      <>
        <Button label="Kaydet" status="success" statusLabel="Kaydedildi" />
        <Button label="Gönder" status="error" statusLabel="Tekrar dene" />
      </>,
      { preference: "dark" },
    );

    expect(screen.getByRole("button", { name: "Kaydedildi" })).toHaveStyle({
      backgroundColor: darkTheme.colors.status.success,
    });
    expect(screen.getByRole("button", { name: "Tekrar dene" })).toHaveStyle({
      backgroundColor: darkTheme.colors.status.error,
    });
  });

  it("exposes icon-button selection, busy, and disabled states", async () => {
    const onPress = jest.fn();
    await renderWithTheme(
      <>
        <IconButton
          accessibilityLabel="Duyuruyu kaydet"
          icon={<Text>K</Text>}
          onPress={onPress}
          selected
        />
        <IconButton
          accessibilityLabel="Paylaşım hazırlanıyor"
          icon={<Text>P</Text>}
          loading
        />
      </>,
    );

    const selected = screen.getByRole("button", { name: "Duyuruyu kaydet" });
    expect(selected).toBeSelected();
    await userEvent.press(selected);
    expect(onPress).toHaveBeenCalledTimes(1);

    const loading = screen.getByRole("button", { name: "Paylaşım hazırlanıyor" });
    expect(loading).toBeBusy();
    expect(loading).toBeDisabled();
  });

  it("uses selected semantics for chips and changes a radio segment", async () => {
    const onChipPress = jest.fn();
    const onValueChange = jest.fn();
    await renderWithTheme(
      <>
        <Chip label="Kaydedilenler" onPress={onChipPress} selected />
        <SegmentedControl
          label="Duyuru filtresi"
          onValueChange={onValueChange}
          options={[
            { value: "all", label: "Tümü" },
            { value: "official", label: "Resmî" },
          ]}
          value="all"
        />
      </>,
    );

    const chip = screen.getByRole("button", { name: "Kaydedilenler" });
    expect(chip).toBeSelected();
    expect(screen.getByTestId(
      "chip-selected-indicator",
      { includeHiddenElements: true },
    )).toBeTruthy();
    await userEvent.press(chip);
    expect(onChipPress).toHaveBeenCalledTimes(1);

    expect(screen.getByLabelText("Duyuru filtresi")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Tümü" })).toBeSelected();
    expect(screen.getByRole("radio", { name: "Resmî" })).not.toBeSelected();
    expect(screen.getByTestId(
      "segment-selected-indicator-all",
      { includeHiddenElements: true },
    )).toBeTruthy();
    expect(screen.queryByTestId(
      "segment-selected-indicator-official",
      { includeHiddenElements: true },
    )).toBeNull();
    await userEvent.press(screen.getByRole("radio", { name: "Resmî" }));
    expect(onValueChange).toHaveBeenCalledWith("official");
  });
});
