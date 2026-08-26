import { NavigationContainer, useScrollToTop } from "@react-navigation/native";
import {
  act,
  cleanup,
  fireEvent,
  renderAsync,
  screen,
  within,
} from "@testing-library/react-native";
import { AccessibilityInfo, Keyboard, StyleSheet, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  CalendarExperience,
  type CalendarExperienceProps,
} from "../../src/calendar/CalendarExperience";
import type { PersonalExamMutationInput } from "../../src/calendar/PersonalExamEditor";
import { ThemeProvider } from "../../src/design-system";

const mockWindowDimensions = jest.fn(() => ({
  fontScale: 2,
  height: 640,
  scale: 2,
  width: 320,
}));

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindowDimensions(),
}));

jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  return { ...actual, useScrollToTop: jest.fn() };
});

const callbacks = {
  onCreatePersonalExam: jest.fn((_input: PersonalExamMutationInput) => ({ ok: true as const })),
  onConsumeCreatePersonalExamRequest: jest.fn(),
  onManageApple: jest.fn(),
  onManageGoogle: jest.fn(),
  onOpenAccountMenu: jest.fn(),
  onOpenItem: jest.fn(),
  onRefresh: jest.fn(),
  onSyncApple: jest.fn(),
  onSyncGoogle: jest.fn(),
  onUpdatePersonalExam: jest.fn((_id: string, _input: PersonalExamMutationInput) => ({ ok: true as const })),
};

function props(overrides: Partial<CalendarExperienceProps> = {}): CalendarExperienceProps {
  return {
    academicEvents: [
      {
        id: "registration",
        title: "Ders kayıt dönemi",
        category: "course_registration",
        startDate: "2026-08-03",
        endDate: "2026-08-07",
        temporalKind: "date",
        endTemporalKind: "date",
      },
      {
        id: "final",
        title: "Final sınavı",
        category: "final_exam",
        startDate: "2026-08-10",
        temporalKind: "date",
      },
    ],
    personalExams: [{
      id: "personal",
      title: "Lineer Cebir",
      examDate: "2026-08-11T06:00:00.000Z",
    }],
    personalExamsReady: true,
    calendarTitle: "Örnek Üniversitesi Akademik Takvimi",
    academicYear: "2026-2027",
    universityName: "Örnek Üniversitesi",
    attempted: true,
    google: {
      state: "connected",
      stateLabel: "Bağlı",
      accountEmail: "ogrenci@example.invalid",
      verifiedCount: 3,
      lastSyncedLabel: "Son eşitleme: 5 Ağustos 2026 10:00",
      connected: true,
    },
    initialAnchorDate: "2026-08-05",
    now: new Date("2026-08-05T09:00:00.000+03:00"),
    ...callbacks,
    ...overrides,
  };
}

async function renderCalendar(
  input = props(),
  platform: "android" | "ios" = "android",
  safeAreaBottom = 0,
) {
  const dimensions = mockWindowDimensions();
  return renderAsync(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
        insets: { top: 0, right: 0, bottom: safeAreaBottom, left: 0 },
      }}
    >
      <ThemeProvider
        liquidGlassAvailable={platform === "ios"}
        platform={platform}
        preference="light"
        reducedMotion
        reducedTransparency={false}
        windowWidth={dimensions.width}
      >
        <NavigationContainer>
          <CalendarExperience {...input} />
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

function openCalendarOptions() {
  fireEvent.press(screen.getByRole("button", { name: "Takvim seçeneklerini aç" }));
}

describe("Phase 9 Calendar experience", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockWindowDimensions.mockReturnValue({ fontScale: 2, height: 640, scale: 2, width: 320 });
  });

  afterEach(async () => {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    cleanup();
    jest.useRealTimers();
  });

  it("starts in Agenda and exposes Week and Month as selected semantic views", async () => {
    await renderCalendar();
    expect(screen.getByRole("radio", { name: "Ajanda" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByText("Akademik")).toBeOnTheScreen();
    expect(screen.getByText("Zamanını planla, hedeflerine odaklan.")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Takvim" })).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Yaklaşan etkinlikler" })).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Devam eden etkinlikler" })).toBeOnTheScreen();
    expect(screen.queryByRole("header", { name: "3 Ağustos Pazartesi" })).not.toBeOnTheScreen();
    expect(screen.getByTestId("calendar-view-announcement").props.accessibilityLiveRegion)
      .toBe("polite");
    fireEvent.press(screen.getByRole("button", { name: "Hesap menüsünü aç" }));
    expect(callbacks.onOpenAccountMenu).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole("radio", { name: "Hafta" }));
    expect(screen.getByRole("radio", { name: "Hafta" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByLabelText("Haftalık takvim özeti")).toBeOnTheScreen();
    expect(screen.getByText("3 Ağu 2026 – 9 Ağu 2026")).toBeOnTheScreen();

    openCalendarOptions();
    fireEvent.press(screen.getByRole("radio", { name: "Ay" }));
    openCalendarOptions();
    expect(screen.getByRole("radio", { name: "Ay" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    fireEvent.press(screen.getByRole("button", { name: "Alt sayfayı kapat" }));
    expect(screen.getByLabelText("Aylık takvim özeti")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Takvim" })).toBeOnTheScreen();
    expect(screen.getByText("Ağustos 2026")).toBeOnTheScreen();
  });

  it("shows the code-native calendar artwork at regular phone and tablet text sizes", async () => {
    mockWindowDimensions.mockReturnValue({ fontScale: 1, height: 900, scale: 3, width: 430 });
    await renderCalendar();
    expect(
      screen.getByTestId("calendar-hero-artwork", { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  it("renders the account avatar only when the host supplies a real account action", async () => {
    await renderCalendar(props({ onOpenAccountMenu: undefined }));

    expect(screen.queryByRole("button", { name: "Hesap menüsünü aç" })).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Takvim seçeneklerini aç" })).toBeOnTheScreen();
  });

  it("fits all seven week days without horizontal clipping on a narrow, enlarged-text phone", async () => {
    await renderCalendar();

    const strip = screen.getByTestId("calendar-week-strip");
    expect(StyleSheet.flatten(strip.props.style)).toMatchObject({
      alignSelf: "stretch",
      flexDirection: "row",
      width: "100%",
    });
    const dayButtons = Array.from({ length: 7 }, (_, index) => (
      screen.getByTestId(`calendar-week-day-2026-08-${String(index + 3).padStart(2, "0")}`)
    ));
    expect(dayButtons).toHaveLength(7);
    dayButtons.forEach((button) => {
      const buttonStyle = typeof button.props.style === "function"
        ? button.props.style({ pressed: false })
        : button.props.style;
      expect(StyleSheet.flatten(buttonStyle)).toMatchObject({ flexBasis: 0, minWidth: 0 });
    });
  });

  it("uses scrollable 44 point week and month day targets on narrow iOS layouts", async () => {
    await renderCalendar(props(), "ios");

    const list = screen.getByLabelText("Takvim etkinlikleri");
    expect(list).toHaveProp("keyboardDismissMode", "interactive");
    expect(list).toHaveProp("keyboardShouldPersistTaps", "handled");

    const strip = screen.getByTestId("calendar-week-strip");
    expect(StyleSheet.flatten(strip.props.contentContainerStyle)).toMatchObject({
      minWidth: 342,
    });
    const weekDay = screen.getByTestId("calendar-week-day-2026-08-05");
    const weekDayStyle = typeof weekDay.props.style === "function"
      ? weekDay.props.style({ pressed: false })
      : weekDay.props.style;
    expect(StyleSheet.flatten(weekDayStyle)).toMatchObject({
      flexBasis: 44,
      minWidth: 44,
    });

    openCalendarOptions();
    fireEvent.press(screen.getByRole("radio", { name: "Ay" }));
    expect(screen.getByTestId("calendar-month-grid")).toHaveStyle({ width: 308 });
    const monthDay = screen.getByTestId("calendar-month-day-2026-08-05");
    const monthDayStyle = typeof monthDay.props.style === "function"
      ? monthDay.props.style({ pressed: false })
      : monthDay.props.style;
    expect(StyleSheet.flatten(monthDayStyle)).toMatchObject({ minWidth: 44 });
  });

  it("keeps the explicit Agenda view selected when a day in its summary is chosen", async () => {
    await renderCalendar();

    fireEvent.press(screen.getByTestId("calendar-week-day-2026-08-06"));

    expect(screen.getByRole("radio", { name: "Ajanda" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByTestId("calendar-week-day-2026-08-06").props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });

  it("groups an overlapping record as continuing instead of showing a date outside the visible range", async () => {
    await renderCalendar(props({
      academicEvents: [{
        id: "continuing-window",
        title: "Devam eden sınav tarihleri",
        category: "department_exam_schedule",
        startDate: "2026-08-17",
        endDate: "2026-08-28",
        temporalKind: "date",
        endTemporalKind: "date",
      }, {
        id: "week-event",
        title: "Hafta içi etkinlik",
        category: "event",
        startDate: "2026-08-26",
        temporalKind: "date",
      }],
      initialAnchorDate: "2026-08-25",
      now: new Date("2026-08-25T09:00:00.000+03:00"),
      personalExams: [],
    }));

    expect(screen.getByRole("header", { name: "Devam eden etkinlikler" })).toBeOnTheScreen();
    expect(screen.queryByRole("header", { name: "17 Ağustos Pazartesi" })).not.toBeOnTheScreen();
    expect(screen.getByText("Devam eden sınav tarihleri")).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("radio", { name: "Hafta" }));

    expect(screen.getByText("24 Ağu 2026 – 30 Ağu 2026")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Devam eden etkinlikler" })).toBeOnTheScreen();
    expect(screen.queryByRole("header", { name: "17 Ağustos Pazartesi" })).not.toBeOnTheScreen();
    expect(screen.getByText("Devam eden sınav tarihleri")).toBeOnTheScreen();
  });

  it("uses the selected Month cell as the event-list range", async () => {
    await renderCalendar();
    openCalendarOptions();
    fireEvent.press(screen.getByRole("radio", { name: "Ay" }));
    expect(screen.getByText("Ders kayıt dönemi")).toBeOnTheScreen();
    expect(screen.queryByText("Final sınavı")).not.toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: /10 Ağustos 2026.*1 kayıt/u }));
    expect(screen.getByText("Final sınavı")).toBeOnTheScreen();
    expect(screen.queryByText("Ders kayıt dönemi")).not.toBeOnTheScreen();
    expect(screen.getByText("1 etkinlik")).toBeOnTheScreen();
  });

  it("clears the active query when calendar search is closed", async () => {
    await renderCalendar();

    expect(screen.queryByRole("button", { name: "Takvimde ara" })).not.toBeOnTheScreen();
    openCalendarOptions();
    fireEvent.press(screen.getByRole("button", { name: "Takvimde ara" }));
    fireEvent.changeText(screen.getByLabelText("Takvimde ara"), "Lineer");
    expect(screen.getByRole("button", { name: "Takvim aramasını temizle" }))
      .toHaveStyle({ height: 44, width: 44 });
    expect(screen.getByText("Lineer Cebir")).toBeOnTheScreen();
    expect(screen.queryByText("Final sınavı")).not.toBeOnTheScreen();

    openCalendarOptions();
    fireEvent.press(screen.getByRole("button", { name: "Takvim aramasını kapat" }));
    expect(screen.queryByPlaceholderText("Etkinlik, ders veya konum ara")).not.toBeOnTheScreen();
    expect(screen.getByText("Final sınavı")).toBeOnTheScreen();

    openCalendarOptions();
    fireEvent.press(screen.getByRole("button", { name: "Takvimde ara" }));
    expect(screen.getByPlaceholderText("Etkinlik, ders veya konum ara")).toHaveDisplayValue("");
  });

  it("dismisses the keyboard before opening options and when search is submitted", async () => {
    const dismiss = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => undefined);
    try {
      await renderCalendar();

      openCalendarOptions();
      expect(dismiss).toHaveBeenCalledTimes(1);
      fireEvent.press(screen.getByRole("button", { name: "Takvimde ara" }));
      fireEvent(screen.getByLabelText("Takvimde ara"), "submitEditing");
      expect(dismiss).toHaveBeenCalledTimes(2);
    } finally {
      dismiss.mockRestore();
    }
  });

  it("keeps the month heading non-interactive without a misleading down chevron", async () => {
    const view = await renderCalendar(props({ initialView: "month" }));

    expect(screen.getByRole("header", { name: "Ağustos 2026" })).toBeOnTheScreen();
    expect(view.UNSAFE_queryAllByProps({ name: "chevron-down" })).toHaveLength(0);
  });

  it("announces committed iOS view and period changes without an initial announcement", async () => {
    const announceSpy = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => undefined);

    try {
      await renderCalendar(props(), "ios");
      expect(announceSpy).not.toHaveBeenCalled();

      fireEvent.press(screen.getByRole("radio", { name: "Hafta" }));
      expect(announceSpy).toHaveBeenLastCalledWith(
        screen.getByTestId("calendar-view-announcement").props.accessibilityLabel,
      );
      expect(announceSpy).toHaveBeenLastCalledWith(
        "Hafta görünümü. 3 Ağu 2026 – 9 Ağu 2026. 1 kayıt.",
      );

      announceSpy.mockClear();
      fireEvent.press(screen.getByRole("button", { name: "Sonraki hafta" }));
      expect(announceSpy).toHaveBeenLastCalledWith(
        screen.getByTestId("calendar-view-announcement").props.accessibilityLabel,
      );
      expect(announceSpy).toHaveBeenLastCalledWith(
        "Hafta görünümü. 10 Ağu 2026 – 16 Ağu 2026. 2 kayıt.",
      );
    } finally {
      announceSpy.mockRestore();
    }
  });

  it("labels event type with icon-backed text and never invents a clock for date-only data", async () => {
    await renderCalendar();
    expect(screen.getByText("Kayıt ve başvuru")).toBeOnTheScreen();
    expect(screen.getAllByText("Sınav").length).toBeGreaterThan(0);
    expect(screen.getByText("Kişisel planın")).toBeOnTheScreen();
    expect(screen.getAllByText("Tüm gün").length).toBeGreaterThan(0);
    expect(screen.queryByText(/00:00/u)).not.toBeOnTheScreen();
  });

  it("presents legacy VPS custom_event titles with defensive title fallback", async () => {
    await renderCalendar(props({
      academicEvents: [
        {
          id: "application",
          title: "Lisansüstü Programlara Yatay Geçiş Başvuruları",
          category: "custom_event",
          startDate: "2026-08-27",
        },
        {
          id: "registration",
          title: "Lisans Programlarına Çift Anadal ve Yan Dal Kayıtları",
          category: "custom_event",
          startDate: "2026-08-28",
        },
        {
          id: "exam",
          title: "Azami Süreyi Dolduran Öğrenciler için Ek Sınavlar",
          category: "custom_event",
          startDate: "2026-08-29",
        },
        {
          id: "results",
          title: "Final sınavı sonuçları",
          category: "custom_event",
          startDate: "2026-08-30",
        },
      ],
      initialAnchorDate: "2026-08-27",
      now: new Date("2026-08-27T09:00:00.000+03:00"),
      personalExams: [],
    }));

    expect(screen.getByRole("button", { name: /Kayıt ve başvuru.*Yatay Geçiş Başvuruları/u })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /Kayıt ve başvuru.*Yan Dal Kayıtları/u })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /Sınav.*Ek Sınavlar/u })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /Etkinlik.*Final sınavı sonuçları/u })).toBeOnTheScreen();
  });

  it("renders timestamp ranges in the academic event timezone", async () => {
    await renderCalendar(props({
      academicEvents: [{
        id: "istanbul-final",
        title: "Saat dilimi finali",
        category: "final_exam",
        startDate: "2026-08-11T07:00:00.000Z",
        endDate: "2026-08-11T09:00:00.000Z",
        temporalKind: "timestamp",
        endTemporalKind: "timestamp",
        timezone: "Europe/Istanbul",
      }],
      personalExams: [],
      initialAnchorDate: "2026-08-11",
      now: new Date("2026-08-11T06:00:00.000Z"),
    }));

    expect(screen.getByText("10:00")).toBeOnTheScreen();
    expect(screen.getByText("12:00")).toBeOnTheScreen();
    expect(screen.queryByText("07:00")).not.toBeOnTheScreen();
    expect(screen.queryByText("09:00")).not.toBeOnTheScreen();
  });

  it("opens event detail with the exact selected item", async () => {
    await renderCalendar();
    fireEvent.press(screen.getByRole("button", { name: /Final sınavı.*Ayrıntıyı aç/u }));
    expect(callbacks.onOpenItem).toHaveBeenCalledWith(expect.objectContaining({
      id: "final",
      source: "academic",
      temporalKind: "date",
    }));
  });

  it("keeps secondary views and actions behind one 48dp header menu", async () => {
    mockWindowDimensions.mockReturnValue({ fontScale: 1, height: 891, scale: 3, width: 411 });
    await renderCalendar(props({ initialView: "month" }));

    expect(screen.getByRole("button", { name: "Takvim seçeneklerini aç" })).toHaveStyle({ height: 48, width: 48 });
    expect(screen.queryByRole("button", { name: "Takvimde ara" })).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Bugüne git" })).not.toBeOnTheScreen();
    expect(screen.queryByRole("radio", { name: "Gün" })).not.toBeOnTheScreen();
    expect(screen.queryByRole("radio", { name: "Ay" })).not.toBeOnTheScreen();
    expect(screen.queryByText("Diğer")).not.toBeOnTheScreen();
    expect(screen.queryByText("Kişisel etkinlik ekle")).not.toBeOnTheScreen();

    openCalendarOptions();
    expect(screen.getByTestId("bottom-sheet")).toHaveProp("accessibilityLabel", "Takvim seçenekleri");
    expect(screen.getByRole("radio", { name: "Gün" })).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: "Ay" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByRole("button", { name: "Takvimde ara" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Bugüne git" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Kişisel etkinlik ekle" })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Kişisel etkinlik ekle" }));
    expect(screen.getByTestId("bottom-sheet")).toHaveProp(
      "accessibilityLabel",
      "Kişisel etkinlik ekleme alt sayfası",
    );
  });

  it("keeps the today action functional inside the options sheet", async () => {
    await renderCalendar(props({ initialAnchorDate: "2026-08-10", initialView: "day" }));
    expect(screen.getByLabelText(/Gün dönemi.*10 Ağustos 2026/u)).toBeOnTheScreen();

    openCalendarOptions();
    fireEvent.press(within(screen.getByTestId("bottom-sheet")).getByRole("button", { name: "Bugüne git" }));

    expect(screen.getByLabelText(/Gün dönemi.*5 Ağustos 2026/u)).toBeOnTheScreen();
  });

  it("creates a personal exam only after native date and time selection", async () => {
    await renderCalendar();
    const createButton = screen.getByRole("button", { name: "Kişisel etkinlik ekle" });
    expect(createButton).toHaveStyle({ minHeight: 58, width: "100%" });
    fireEvent.press(createButton);
    expect(screen.getByTestId("bottom-sheet").props.accessibilityLabel).toBe(
      "Kişisel etkinlik ekleme alt sayfası",
    );

    fireEvent.press(screen.getByRole("button", { name: "Etkinliği ekle" }));
    expect(screen.getByText("Tarihi sistem seçicisinden seç.")).toBeOnTheScreen();
    expect(screen.getByText("Saati sistem seçicisinden seç.")).toBeOnTheScreen();

    fireEvent.changeText(screen.getByLabelText("Etkinlik adı"), "Veri Yapıları finali");
    fireEvent.changeText(screen.getByLabelText("Konum veya not"), "D-101");
    fireEvent.press(screen.getByRole("button", { name: "Tarih seçilmedi" }));
    fireEvent(
      screen.getByLabelText("Sistem tarih seçici"),
      "change",
      { type: "set" },
      new Date(2026, 7, 21, 12, 0),
    );
    fireEvent.press(screen.getByRole("button", { name: "Saat seçilmedi" }));
    fireEvent(
      screen.getByLabelText("Sistem saat seçici"),
      "change",
      { type: "set" },
      new Date(2026, 7, 21, 14, 30),
    );
    fireEvent.press(screen.getByRole("button", { name: "Etkinliği ekle" }));

    expect(callbacks.onCreatePersonalExam).toHaveBeenCalledWith(expect.objectContaining({
      title: "Veri Yapıları finali",
      locationNote: "D-101",
      kind: "event",
    }));
    const submitted = callbacks.onCreatePersonalExam.mock.calls[0]?.[0];
    expect(submitted).toBeDefined();
    if (!submitted) throw new Error("Expected personal-exam submission");
    expect(new Date(submitted.examDate).getHours()).toBe(14);
    expect(new Date(submitted.examDate).getMinutes()).toBe(30);
  });

  it("uses one compact Google status card and routes sync and lifecycle management", async () => {
    await renderCalendar();
    expect(screen.getByTestId("calendar-google-sync-card")).toHaveProp("accessible", false);
    expect(screen.getByTestId("calendar-google-sync-status")).toHaveProp("accessible", true);
    expect(screen.getByLabelText(/Google Takvim durumu.*Bağlı/u)).toBeOnTheScreen();
    expect(screen.getByText("3 uygulama kaydı doğrulandı")).toBeOnTheScreen();
    expect(screen.getByText("Etkinliklerini otomatik olarak senkronize et.")).toBeOnTheScreen();
    expect(screen.queryByText("Kullanmak istediğin Gmail hesabını seç.")).not.toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Senkronize" }));
    fireEvent.press(screen.getByRole("button", { name: "Google Takvim'i yönet" }));
    expect(callbacks.onSyncGoogle).toHaveBeenCalledTimes(1);
    expect(callbacks.onManageGoogle).toHaveBeenCalledTimes(1);
  });

  it("shows the device Apple Calendar lifecycle only when the iOS host supplies it", async () => {
    await renderCalendar(props({
      apple: {
        state: "connected",
        stateLabel: "Bağlı",
        managedCount: 4,
        connected: true,
      },
    }), "ios");

    expect(screen.getByTestId("calendar-apple-sync-card")).toHaveProp("accessible", false);
    expect(screen.getByLabelText(/Apple Takvim durumu.*Bağlı/u)).toBeOnTheScreen();
    expect(screen.getByText("4 uygulama kaydı yönetiliyor")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Eşitle" }));
    fireEvent.press(screen.getByRole("button", { name: "Apple Takvim'i yönet" }));
    expect(callbacks.onSyncApple).toHaveBeenCalledTimes(1);
    expect(callbacks.onManageApple).toHaveBeenCalledTimes(1);
  });

  it("consumes a Home create intent once when personal exams become ready", async () => {
    const initial = props({
      createPersonalExamRequestKey: 7,
      personalExamsReady: false,
    });
    const view = await renderCalendar(initial);
    expect(screen.queryByTestId("bottom-sheet")).not.toBeOnTheScreen();
    expect(callbacks.onConsumeCreatePersonalExamRequest).not.toHaveBeenCalled();

    const ready = { ...initial, personalExamsReady: true };
    await view.rerenderAsync(
      <SafeAreaProvider>
        <ThemeProvider
          liquidGlassAvailable={false}
          platform="android"
          preference="light"
          reducedMotion
          reducedTransparency={false}
          windowWidth={320}
        >
          <NavigationContainer>
            <CalendarExperience {...ready} />
          </NavigationContainer>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId("bottom-sheet")).toHaveProp(
      "accessibilityLabel",
      "Kişisel etkinlik ekleme alt sayfası",
    );
    expect(callbacks.onConsumeCreatePersonalExamRequest).toHaveBeenCalledTimes(1);
    expect(callbacks.onConsumeCreatePersonalExamRequest).toHaveBeenCalledWith(7);

    fireEvent.press(screen.getByRole("button", { name: "Vazgeç" }));
    expect(screen.queryByTestId("bottom-sheet")).not.toBeOnTheScreen();

    await view.rerenderAsync(
      <SafeAreaProvider>
        <ThemeProvider
          liquidGlassAvailable={false}
          platform="android"
          preference="light"
          reducedMotion
          reducedTransparency={false}
          windowWidth={320}
        >
          <NavigationContainer>
            <CalendarExperience {...ready} />
          </NavigationContainer>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    expect(screen.queryByTestId("bottom-sheet")).not.toBeOnTheScreen();
    expect(callbacks.onConsumeCreatePersonalExamRequest).toHaveBeenCalledTimes(1);
  });

  it("limits a long agenda to twelve items and reveals the next page on demand", async () => {
    const academicEvents = Array.from({ length: 15 }, (_, index) => ({
      id: `event-${index + 1}`,
      title: `Etkinlik ${index + 1}`,
      category: "event",
      startDate: `2026-08-${String(index + 6).padStart(2, "0")}`,
      temporalKind: "date" as const,
    }));
    await renderCalendar(props({ academicEvents, personalExams: [] }));

    expect(screen.getByTestId("calendar-event-count")).toHaveProp(
      "accessibilityLabel",
      "12 etkinlik gösteriliyor",
    );
    expect(within(screen.getByTestId("calendar-event-count")).getByText("12")).toBeOnTheScreen();
    expect(screen.getByText("12 / 15 etkinlik gösteriliyor")).toBeOnTheScreen();
    expect(screen.queryByText("Etkinlik 13")).not.toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Daha fazla etkinlik göster" }));
    expect(screen.UNSAFE_getByType(require("react-native").FlatList).props.data).toHaveLength(15);
    expect(screen.getByTestId("calendar-event-count")).toHaveProp(
      "accessibilityLabel",
      "15 etkinlik gösteriliyor",
    );
    expect(screen.queryByRole("button", { name: "Daha fazla etkinlik göster" })).not.toBeOnTheScreen();
  });

  it("keeps the final calendar content above an iOS home indicator and bottom navigation", async () => {
    await renderCalendar(props(), "ios", 34);
    const list = screen.getByLabelText("Takvim etkinlikleri");
    expect(StyleSheet.flatten(list.props.contentContainerStyle)).toMatchObject({
      paddingBottom: 146,
    });
  });

  it("keeps route-scoped personal-exam results reachable in the virtualized header", async () => {
    await renderCalendar(props({
      feedback: <Text accessibilityRole="alert">Kişisel sınav eklendi</Text>,
    }));
    expect(screen.getByRole("alert", { name: "Kişisel sınav eklendi" })).toBeOnTheScreen();
  });

  it.each([
    [{ academicEvents: [], personalExams: [], loading: true, attempted: false }, "Takvim yükleniyor"],
    [{ academicEvents: [], personalExams: [], loading: false, attempted: true }, "Ajandan boş"],
    [{ academicEvents: [], personalExams: [], loading: false, attempted: true, error: "failed" }, "Takvim alınamadı"],
    [{ academicEvents: [], personalExams: [], loading: false, attempted: true, partial: true }, "Takvim kısmen güncel"],
    [{ academicEvents: [], personalExams: [], loading: false, attempted: true, offline: true }, "Çevrimdışı"],
    [{ loading: true, attempted: true }, "Takvim yenileniyor"],
    [{ loading: false, attempted: true, stale: true }, "Takvim güncel olmayabilir"],
  ])("renders a non-contradictory %s state", async (overrides, expected) => {
    await renderCalendar(props(overrides));
    expect(screen.queryByText(expected) ?? screen.queryByLabelText(expected)).toBeOnTheScreen();
    if (expected !== "Ajandan boş") expect(screen.queryByText("Ajandan boş")).not.toBeOnTheScreen();
  });

  it("keeps compact 320 dp and 200% font layout vertically reachable", async () => {
    await renderCalendar();
    expect(useScrollToTop).toHaveBeenCalled();
    expect(screen.UNSAFE_getAllByType(require("react-native").FlatList)).toHaveLength(1);
    expect(StyleSheet.flatten(screen.getByLabelText("Takvim görünümü").props.style)).toMatchObject({
      flexDirection: "column",
    });
    expect(screen.queryByText(/YYYY-MM-DD/u)).not.toBeOnTheScreen();
  });
});
