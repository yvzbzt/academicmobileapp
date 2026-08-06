import { NavigationContainer, useScrollToTop } from "@react-navigation/native";
import {
  act,
  cleanup,
  fireEvent,
  renderAsync,
  screen,
} from "@testing-library/react-native";
import { AccessibilityInfo, StyleSheet, Text } from "react-native";
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
  onManageGoogle: jest.fn(),
  onOpenItem: jest.fn(),
  onRefresh: jest.fn(),
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
) {
  return renderAsync(
    <SafeAreaProvider>
      <ThemeProvider
        liquidGlassAvailable={platform === "ios"}
        platform={platform}
        preference="light"
        reducedMotion
        reducedTransparency={false}
        windowWidth={320}
      >
        <NavigationContainer>
          <CalendarExperience {...input} />
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
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
    expect(screen.getByText("Yaklaşan tarihler")).toBeOnTheScreen();
    expect(screen.getByTestId("calendar-view-announcement").props.accessibilityLiveRegion)
      .toBe("polite");

    fireEvent.press(screen.getByRole("radio", { name: "Hafta" }));
    expect(screen.getByRole("radio", { name: "Hafta" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByLabelText("Haftalık takvim özeti")).toBeOnTheScreen();
    expect(screen.getByText("3 Ağu 2026 – 9 Ağu 2026")).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("radio", { name: "Ay" }));
    expect(screen.getByRole("radio", { name: "Ay" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByLabelText("Aylık takvim özeti")).toBeOnTheScreen();
    expect(screen.getByText("Ağustos 2026")).toBeOnTheScreen();
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
    expect(screen.getByText("Sınav")).toBeOnTheScreen();
    expect(screen.getByText("Kişisel sınav")).toBeOnTheScreen();
    expect(screen.getAllByText("Tüm gün · saat bilgisi verilmemiş").length).toBeGreaterThan(0);
    expect(screen.queryByText(/00:00/u)).not.toBeOnTheScreen();
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

  it("creates a personal exam only after native date and time selection", async () => {
    await renderCalendar();
    fireEvent.press(screen.getByRole("button", { name: "Kişisel sınav ekle" }));
    expect(screen.getByTestId("bottom-sheet").props.accessibilityLabel).toBe(
      "Kişisel sınav ekleme alt sayfası",
    );

    fireEvent.press(screen.getByRole("button", { name: "Sınavı ekle" }));
    expect(screen.getByText("Tarihi sistem seçicisinden seç.")).toBeOnTheScreen();
    expect(screen.getByText("Saati sistem seçicisinden seç.")).toBeOnTheScreen();

    fireEvent.changeText(screen.getByLabelText("Sınav adı"), "Veri Yapıları finali");
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
    fireEvent.press(screen.getByRole("button", { name: "Sınavı ekle" }));

    expect(callbacks.onCreatePersonalExam).toHaveBeenCalledWith(expect.objectContaining({
      title: "Veri Yapıları finali",
    }));
    const submitted = callbacks.onCreatePersonalExam.mock.calls[0]?.[0];
    expect(submitted).toBeDefined();
    if (!submitted) throw new Error("Expected personal-exam submission");
    expect(new Date(submitted.examDate).getHours()).toBe(14);
    expect(new Date(submitted.examDate).getMinutes()).toBe(30);
  });

  it("uses one compact Google status card and routes sync and lifecycle management", async () => {
    await renderCalendar();
    expect(screen.getByLabelText(/Google Takvim durumu.*Bağlı/u)).toBeOnTheScreen();
    expect(screen.getByText("3 uygulama kaydı doğrulandı")).toBeOnTheScreen();
    expect(screen.getByText(/kişisel Google etkinlikleri değiştirilmez/u)).toBeOnTheScreen();
    expect(screen.queryByText("Kullanmak istediğin Gmail hesabını seç.")).not.toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Şimdi eşitle" }));
    fireEvent.press(screen.getByRole("button", { name: "Google Takvim'i yönet" }));
    expect(callbacks.onSyncGoogle).toHaveBeenCalledTimes(1);
    expect(callbacks.onManageGoogle).toHaveBeenCalledTimes(1);
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
