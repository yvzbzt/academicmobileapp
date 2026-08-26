import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  fireEvent,
  renderAsync,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { ThemeProvider } from "../../src/design-system";
import {
  AppleCalendarSettingsScreen,
  type AppleCalendarPresentation,
  type AppleCalendarSettingsScreenProps,
} from "../../src/profile/ProfileSettings";

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

function testTree(child: ReactElement) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, right: 0, bottom: 34, left: 0 },
      }}
    >
      <ThemeProvider
        liquidGlassAvailable={false}
        platform="ios"
        preference="light"
        reducedMotion
        reducedTransparency={false}
        windowWidth={390}
      >
        {child}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function applePresentation(
  overrides: Partial<AppleCalendarPresentation> = {},
): AppleCalendarPresentation {
  return {
    state: "connected",
    label: "Bağlı",
    title: "Apple Takvim bağlı",
    detail: "Akademik kayıtlar bu cihazla eşitlenmeye hazır.",
    tone: "success",
    busy: false,
    connected: true,
    ...overrides,
  };
}

function appleScreenProps(
  overrides: Partial<AppleCalendarSettingsScreenProps> = {},
): AppleCalendarSettingsScreenProps {
  return {
    presentation: applePresentation(),
    calendarTitle: "Akademik Takvim",
    lastSyncedLabel: "26 Ağustos 2026 14:30",
    managedEventCount: 7,
    onEnable: jest.fn(),
    onSync: jest.fn(),
    onOpenSettings: jest.fn(),
    onDisconnect: jest.fn(),
    onRemoveManagedEvents: jest.fn(),
    onOpenCalendar: jest.fn(),
    ...overrides,
  };
}

describe("AppleCalendarSettingsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWindowDimensions.mockReturnValue({
      fontScale: 1,
      height: 844,
      scale: 3,
      width: 390,
    });
  });

  it("routes denied permission to iOS Settings with accessible status copy", async () => {
    const onOpenSettings = jest.fn();
    const props = appleScreenProps({
      onOpenSettings,
      permissionDetail: "Takvim erişimini iOS Ayarlar uygulamasından açmalısın.",
      presentation: applePresentation({
        state: "denied",
        label: "İzin gerekli",
        title: "Apple Takvim izni reddedildi",
        detail: "Bu cihaz takvim erişimine izin vermiyor.",
        tone: "warning",
        connected: false,
      }),
    });
    await renderAsync(testTree(<AppleCalendarSettingsScreen {...props} />));

    expect(screen.getByRole("header", { name: "Apple Takvim" })).toBeVisible();
    expect(screen.getByLabelText(
      "Apple Takvim izni reddedildi. Bu cihaz takvim erişimine izin vermiyor.",
    )).toHaveProp("accessibilityLiveRegion", "polite");
    expect(screen.getByLabelText(
      "Apple Takvim bağlantı özeti. İzin gerekli.",
    )).toBeVisible();
    expect(screen.getByText(
      "Takvim erişimini iOS Ayarlar uygulamasından açmalısın.",
    )).toBeVisible();
    expect(screen.getByText("Kişisel etkinliklerin korunur")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Apple Takvim'i etkinleştir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Şimdi eşitle" })).toBeNull();

    fireEvent.press(screen.getByRole("button", { name: "Takvim ayarlarını aç" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("enables Apple Calendar only from the disconnected state", async () => {
    const onEnable = jest.fn();
    const props = appleScreenProps({
      onEnable,
      presentation: applePresentation({
        state: "disconnected",
        label: "Bağlı değil",
        title: "Apple Takvim kapalı",
        detail: "Etkinleştirdiğinde bu cihazda uygulamaya özel bir takvim hazırlanır.",
        tone: "neutral",
        connected: false,
      }),
    });
    const view = await renderAsync(testTree(<AppleCalendarSettingsScreen {...props} />));

    const enable = screen.getByRole("button", { name: "Apple Takvim'i etkinleştir" });
    expect(enable).toBeEnabled();
    fireEvent.press(enable);
    expect(onEnable).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Şimdi eşitle" })).toBeNull();

    await view.rerenderAsync(testTree(
      <AppleCalendarSettingsScreen
        {...props}
        presentation={applePresentation({
          state: "checking",
          label: "Kontrol ediliyor",
          title: "Apple Takvim hazırlanıyor",
          detail: "Takvim izni ve cihaz bağlantısı kontrol ediliyor.",
          tone: "info",
          busy: true,
          connected: false,
        })}
      />,
    ));
    expect(screen.getByRole("button", { name: "Apple Takvim'i etkinleştir" })).toBeBusy();
    expect(screen.getByRole("button", { name: "Apple Takvim'i etkinleştir" })).toBeDisabled();
  });

  it("shows connected metadata and routes sync separately", async () => {
    const onSync = jest.fn();
    const onOpenCalendar = jest.fn();
    await renderAsync(testTree(
      <AppleCalendarSettingsScreen
        {...appleScreenProps({
          onOpenCalendar,
          onSync,
          warnings: ["Bir akademik kayıt daha sonra yeniden denenecek."],
        })}
      />,
    ));

    expect(screen.getByText("Akademik Takvim")).toBeVisible();
    expect(screen.getByText("26 Ağustos 2026 14:30")).toBeVisible();
    expect(screen.getByText("7")).toBeVisible();
    expect(screen.getByText("Bir akademik kayıt daha sonra yeniden denenecek.")).toBeVisible();

    fireEvent.press(screen.getByRole("button", { name: "Şimdi eşitle" }));
    fireEvent.press(screen.getByRole("button", { name: "Apple Takvim'de aç" }));
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onOpenCalendar).toHaveBeenCalledTimes(1);
  });

  it("requires a cancellable confirmation before disconnecting", async () => {
    const onDisconnect = jest.fn();
    await renderAsync(testTree(
      <AppleCalendarSettingsScreen
        {...appleScreenProps({ onDisconnect })}
      />,
    ));

    fireEvent.press(screen.getByRole("button", { name: "Bağlantıyı kes" }));
    let sheet = screen.getByTestId("bottom-sheet");
    expect(sheet).toHaveProp(
      "accessibilityLabel",
      "Apple Takvim bağlantısı kesilsin mi?",
    );
    expect(within(sheet).getByText(/uygulama yönetimli kayıtlar Apple Takvim'de kalır/iu)).toBeVisible();
    expect(within(sheet).getByText(/Kişisel etkinliklerin değiştirilmez/iu)).toBeVisible();

    fireEvent.press(within(sheet).getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(screen.queryByTestId("bottom-sheet")).toBeNull());
    expect(onDisconnect).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole("button", { name: "Bağlantıyı kes" }));
    sheet = screen.getByTestId("bottom-sheet");
    fireEvent.press(within(sheet).getByRole("button", { name: "Bağlantıyı kes" }));
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("bottom-sheet")).toBeNull());
  });

  it("confirms removal with the managed count and personal-event safety boundary", async () => {
    const onDisconnect = jest.fn();
    const onRemoveManagedEvents = jest.fn();
    await renderAsync(testTree(
      <AppleCalendarSettingsScreen
        {...appleScreenProps({ onDisconnect, onRemoveManagedEvents })}
      />,
    ));

    fireEvent.press(screen.getByRole("button", { name: "Yönetilen kayıtları kaldır" }));
    const sheet = screen.getByTestId("bottom-sheet");
    expect(sheet).toHaveProp("accessibilityLabel", "Yönetilen kayıtlar kaldırılsın mı?");
    expect(within(sheet).getByText(/7 yönetilen kayıt hedeflenecek/iu)).toBeVisible();
    expect(within(sheet).getByText(/Kişisel etkinliklerin korunur/iu)).toBeVisible();

    fireEvent.press(within(sheet).getByRole("button", {
      name: "Yönetilen kayıtları kaldır",
    }));
    await waitFor(() => expect(onRemoveManagedEvents).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("bottom-sheet")).toBeNull());
    expect(onDisconnect).not.toHaveBeenCalled();
  });
});
