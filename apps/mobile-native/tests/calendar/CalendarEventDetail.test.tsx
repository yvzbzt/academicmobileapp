import {
  fireEvent,
  renderAsync,
  screen,
} from "@testing-library/react-native";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CalendarEventDetail } from "../../src/calendar/CalendarEventDetail";
import type { CalendarItem } from "../../src/calendar/calendar-model";
import { ThemeProvider } from "../../src/design-system";

const academicItem: CalendarItem = {
  key: "academic:range",
  routeId: "range",
  id: "range",
  title: "Ders kayıt dönemi",
  category: "course_registration",
  classification: "registration",
  classificationLabel: "Kayıt ve başvuru",
  icon: "flag-outline",
  source: "academic",
  sourceLabel: "Örnek Üniversitesi Akademik Takvimi",
  startDate: "2026-08-03",
  endDate: "2026-08-07",
  temporalKind: "date",
  endTemporalKind: "date",
};

const personalItem: CalendarItem = {
  key: "personal:exam",
  routeId: "personal:exam",
  id: "exam",
  title: "Lineer Cebir",
  category: "personal_exam",
  classification: "personal_exam",
  classificationLabel: "Kişisel sınav",
  icon: "school-outline",
  source: "personal",
  sourceLabel: "Kişisel planın",
  startDate: new Date(2026, 7, 11, 9, 0).toISOString(),
  temporalKind: "timestamp",
};

const onUpdate = jest.fn(() => ({ ok: true as const }));
const onDelete = jest.fn(() => ({ ok: true as const }));

async function renderDetail(item: CalendarItem | null) {
  return renderAsync(
    <SafeAreaProvider>
      <ThemeProvider preference="light">
        <CalendarEventDetail
          academicYear="2026-2027"
          departmentName="Bilgisayar Mühendisliği"
          facultyName="Mühendislik Fakültesi"
          item={item}
          onDeletePersonalExam={onDelete}
          onUpdatePersonalExam={onUpdate}
          universityName="Örnek Üniversitesi"
        />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe("Phase 9 Calendar detail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows trusted academic source context and inclusive date-only semantics", async () => {
    await renderDetail(academicItem);
    expect(screen.getByRole("header", { name: "Ders kayıt dönemi" })).toBeOnTheScreen();
    expect(screen.getByText("3 Ağustos 2026 – 7 Ağustos 2026")).toBeOnTheScreen();
    expect(screen.getByText(/son gün dahildir.*saat bilgisi verilmemiştir/u)).toBeOnTheScreen();
    expect(screen.getByText("Örnek Üniversitesi Akademik Takvimi")).toBeOnTheScreen();
    expect(screen.getByText("Örnek Üniversitesi · Mühendislik Fakültesi · Bilgisayar Mühendisliği")).toBeOnTheScreen();
    expect(screen.queryByText(/00:00/u)).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Kişisel sınavı düzenle" })).not.toBeOnTheScreen();
  });

  it("edits an owner-scoped personal exam through the same native picker form", async () => {
    await renderDetail(personalItem);
    fireEvent.press(screen.getByRole("button", { name: "Kişisel sınavı düzenle" }));
    expect(screen.getByTestId("bottom-sheet").props.accessibilityLabel).toBe(
      "Kişisel sınav düzenleme alt sayfası",
    );
    fireEvent.changeText(screen.getByLabelText("Sınav adı"), "Lineer Cebir finali");
    fireEvent.press(screen.getByRole("button", { name: "Değişiklikleri kaydet" }));
    expect(onUpdate).toHaveBeenCalledWith("exam", expect.objectContaining({ title: "Lineer Cebir finali" }));
  });

  it("requires a native destructive confirmation before delete", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await renderDetail(personalItem);
    fireEvent.press(screen.getByRole("button", { name: "Kişisel sınavı sil" }));
    expect(alert).toHaveBeenCalledTimes(1);
    const options = alert.mock.calls[0][2];
    expect(options?.map((option) => option.text)).toEqual(["Vazgeç", "Sınavı sil"]);
    options?.[1].onPress?.();
    expect(onDelete).toHaveBeenCalledWith("exam");
  });

  it("fails closed when route memory has no exact item", async () => {
    await renderDetail(null);
    expect(screen.getByText("Takvim kaydı kullanılamıyor")).toBeOnTheScreen();
    expect(screen.getByText(/güncel hesapta doğrulanmış/u)).toBeOnTheScreen();
  });
});
