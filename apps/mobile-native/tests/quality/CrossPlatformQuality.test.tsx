import { useRef, useState } from "react";
import {
  AccessibilityInfo,
  Text,
  type View as NativeView,
} from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";
import {
  BottomSheet,
  Button,
  Card,
  SelectField,
} from "../../src/design-system";
import { darkTheme, lightTheme } from "../../src/design-system/tokens";
import {
  BootstrapErrorState,
  BootstrapLoadingState,
  UnknownRouteState,
} from "../../src/navigation/SystemStateScreens";
import { renderWithTheme } from "../design-system/test-utils";

function SheetFocusHarness() {
  const [visible, setVisible] = useState(false);
  const openerRef = useRef<NativeView | null>(null);
  return (
    <>
      <Button label="Alt sayfayı aç" onPress={() => setVisible(true)} ref={openerRef} />
      <BottomSheet
        onDismiss={() => setVisible(false)}
        returnFocusRef={openerRef}
        title="Odak başlığı"
        visible={visible}
      >
        <Text>Odak içeriği</Text>
      </BottomSheet>
    </>
  );
}

function InvalidSelectorHarness() {
  const [validationAttempt, setValidationAttempt] = useState(0);
  const attempted = validationAttempt > 0;
  const longLabel = "İstanbul Teknik Üniversitesi Kuzey Kıbrıs Türk Cumhuriyeti Eğitim Araştırma Yerleşkesi";
  return (
    <>
      <SelectField
        error={attempted ? "Üniversite seçimi zorunludur." : undefined}
        focusOnError={attempted}
        focusOnErrorKey={validationAttempt}
        label="Üniversite"
        onValueChange={jest.fn()}
        options={[{ value: "itu-kktc", label: longLabel }]}
        value="itu-kktc"
      />
      <Button
        label="Doğrulamayı dene"
        onPress={() => setValidationAttempt((current) => current + 1)}
      />
    </>
  );
}

describe("Phase 11 shared cross-platform semantics", () => {
  it("preserves static Card roles and busy states", async () => {
    await renderWithTheme(
      <Card accessibilityLabel="Profil özeti yükleniyor" accessibilityRole="alert" busy>
        <Text>Yükleniyor</Text>
      </Card>,
    );

    expect(screen.getByRole("alert", { name: "Profil özeti yükleniyor" })).toBeBusy();
  });

  it("keeps disabled button boundaries explicit in light and dark themes", async () => {
    const light = await renderWithTheme(<Button disabled label="Kaydet" />);
    expect(screen.getByRole("button", { name: "Kaydet" })).toHaveStyle({
      backgroundColor: lightTheme.colors.action.disabled,
      borderColor: lightTheme.colors.border.default,
      minHeight: 52,
    });
    await light.unmountAsync();

    await renderWithTheme(<Button disabled label="Kaydet" />, { preference: "dark" });
    expect(screen.getByRole("button", { name: "Kaydet" })).toHaveStyle({
      backgroundColor: darkTheme.colors.action.disabled,
      borderColor: darkTheme.colors.border.default,
    });
  });

  it("keeps a named sheet heading and the opener available across dismissal", async () => {
    await renderWithTheme(<SheetFocusHarness />);
    const opener = screen.getByRole("button", { name: "Alt sayfayı aç" });
    fireEvent.press(opener);
    expect(screen.getByRole("header", { name: "Odak başlığı" })).toBeVisible();

    fireEvent.press(screen.getByRole("button", { name: "Alt sayfayı kapat" }));
    expect(screen.queryByTestId("bottom-sheet")).toBeNull();
    expect(opener).toBeVisible();
  });

  it("exposes a newly invalid selector without truncating its selected value", async () => {
    const focus = jest
      .spyOn(AccessibilityInfo, "setAccessibilityFocus")
      .mockImplementation(() => undefined);
    await renderWithTheme(<InvalidSelectorHarness />, { windowWidth: 320 });
    jest.useFakeTimers();
    try {
      const selectedValue = screen.getByText("İstanbul Teknik Üniversitesi Kuzey Kıbrıs Türk Cumhuriyeti Eğitim Araştırma Yerleşkesi");
      expect(selectedValue.props.numberOfLines).toBeUndefined();
      const selector = screen.getByRole("combobox", { name: "Üniversite" });
      fireEvent(selector, "layout", {
        target: 91,
        nativeEvent: { layout: { height: 52, width: 288, x: 0, y: 0 } },
      });

      fireEvent.press(screen.getByRole("button", { name: "Doğrulamayı dene" }));
      await act(async () => jest.runOnlyPendingTimers());
      expect(selector).toHaveProp("aria-invalid", true);
      expect(focus).toHaveBeenLastCalledWith(91);

      focus.mockClear();
      fireEvent.press(screen.getByRole("button", { name: "Doğrulamayı dene" }));
      await act(async () => jest.runOnlyPendingTimers());
      expect(focus).toHaveBeenCalledWith(91);
    } finally {
      jest.useRealTimers();
      focus.mockRestore();
    }
  });

  it("renders startup, error, and unknown-route states semantically in dark mode", async () => {
    const loading = await renderWithTheme(<BootstrapLoadingState />, { preference: "dark", windowWidth: 320 });
    expect(screen.getByRole("progressbar", { name: /Uygulama hazırlanıyor/u })).toBeBusy();
    await loading.unmountAsync();

    const retry = jest.fn();
    const error = await renderWithTheme(<BootstrapErrorState error="Yerel sentetik hata" onRetry={retry} />, { preference: "dark" });
    expect(screen.getByRole("alert", { name: /Başlangıç tamamlanamadı/u })).toBeVisible();
    fireEvent.press(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(retry).toHaveBeenCalledTimes(1);
    await error.unmountAsync();

    const onReturn = jest.fn();
    await renderWithTheme(<UnknownRouteState authenticated onReturn={onReturn} />, { preference: "dark" });
    expect(screen.getByRole("summary", { name: /Sayfa bulunamadı/u })).toBeVisible();
    fireEvent.press(screen.getByRole("button", { name: "Ana sayfaya dön" }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});
