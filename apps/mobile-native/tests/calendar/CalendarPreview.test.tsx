import fs from "node:fs";
import path from "node:path";
import {
  fireEvent,
  renderAsync,
  screen,
} from "@testing-library/react-native";
import {
  CALENDAR_PREVIEW_SCENARIOS,
  CalendarPreview,
  parseCalendarPreviewUrl,
} from "../../src/calendar/CalendarPreview";

describe("Phase 9 Calendar synthetic preview", () => {
  it("keeps the stable synthetic scenario inventory", () => {
    expect(CALENDAR_PREVIEW_SCENARIOS).toEqual([
      "populated",
      "week",
      "month",
      "loading",
      "refreshing",
      "empty",
      "stale",
      "partial",
      "offline",
      "error",
      "google-partial",
      "detail-academic",
      "detail-personal",
      "long-title",
    ]);
    expect(parseCalendarPreviewUrl("academicpulse://phase9-calendar/refreshing?theme=dark")).toEqual({
      preference: "dark",
      scenario: "refreshing",
    });
    expect(parseCalendarPreviewUrl("academicpulse://phase9-calendar/not-real")).toBeNull();
  });

  it("imports no API, persistence, production-data, account, or provider module", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/calendar/CalendarPreview.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/apiRequest|SecureStore|AsyncStorage|GoogleSignin|expo-network|notifications|session-integrity|PRODUCTION_API/u);
    expect(source).toContain("example.invalid");
    expect(source).toContain("Örnek Üniversitesi");
  });

  it("renders Agenda, Week, Month, and both detail types", async () => {
    const populated = await renderAsync(<CalendarPreview scenario="populated" />);
    expect(screen.getByRole("radio", { name: "Ajanda" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    await populated.unmountAsync();

    const week = await renderAsync(<CalendarPreview scenario="week" />);
    expect(screen.getByRole("radio", { name: "Hafta" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    await week.unmountAsync();

    const month = await renderAsync(<CalendarPreview scenario="month" />);
    expect(screen.getByRole("radio", { name: "Ay" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    await month.unmountAsync();

    const academicDetail = await renderAsync(<CalendarPreview scenario="detail-academic" />);
    expect(screen.getByText("Kaynak ve kapsam")).toBeOnTheScreen();
    await academicDetail.unmountAsync();

    await renderAsync(<CalendarPreview scenario="detail-personal" />);
    expect(screen.getByRole("button", { name: "Kişisel sınavı düzenle" })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Kişisel sınavı düzenle" }));
    expect(screen.getByTestId("bottom-sheet").props.accessibilityLabel).toBe(
      "Kişisel sınav düzenleme alt sayfası",
    );
  });
});
