import fs from "node:fs";
import path from "node:path";
import {
  act,
  fireEvent,
  renderAsync,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { Linking } from "react-native";
import {
  CALENDAR_PREVIEW_SCENARIOS,
  CalendarPreview,
  parseCalendarPreviewUrl,
  REFERENCE_CALENDAR_EVENTS,
  WEEK_RANGE_REGRESSION_EVENT,
} from "../../src/calendar/CalendarPreview";

async function settleVirtualizedList(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
  });
}

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
      "reference",
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
    expect(source).toContain("Kampüs Üniversitesi");
    expect(source).toContain("if (!__DEV__) return null");
  });

  it("renders the supplied 22 May 2025 agenda as a deterministic reference scenario", async () => {
    expect(REFERENCE_CALENDAR_EVENTS).toEqual([
      expect.objectContaining({
        title: "Vize Sınavı",
        startDate: "2025-05-22T09:00:00.000+03:00",
        endDate: "2025-05-22T10:50:00.000+03:00",
      }),
      expect.objectContaining({
        title: "Ödev Teslimi",
        startDate: "2025-05-22T14:00:00.000+03:00",
        endDate: "2025-05-22T15:30:00.000+03:00",
      }),
      expect.objectContaining({
        title: "Burs Başvurusu",
        startDate: "2025-05-22T17:00:00.000+03:00",
        endDate: "2025-05-22T19:00:00.000+03:00",
      }),
    ]);

    const view = await renderAsync(<CalendarPreview scenario="reference" />);
    await settleVirtualizedList();

    expect(screen.getByRole("radio", { name: "Ajanda" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    const selectedReferenceDay = screen.getAllByRole("button", { name: /22 May/u }).find(
      (node) => node.props.accessibilityState?.selected === true,
    );
    expect(selectedReferenceDay?.props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByText("Vize Sınavı")).toBeOnTheScreen();
    expect(screen.getByText("Ödev Teslimi")).toBeOnTheScreen();
    expect(screen.getByText("Burs Başvurusu")).toBeOnTheScreen();
    expect(screen.getByText("09:00")).toBeOnTheScreen();
    expect(screen.getByText("10:50")).toBeOnTheScreen();
    expect(screen.getByText("14:00")).toBeOnTheScreen();
    expect(screen.getByText("15:30")).toBeOnTheScreen();
    expect(screen.getByText("17:00")).toBeOnTheScreen();
    expect(screen.getByText("19:00")).toBeOnTheScreen();
    expect(screen.getByLabelText("Google Takvim durumu. Bağlı değil. Hesap seçilmedi.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Hesap menüsünü aç" })).toBeOnTheScreen();
    await view.unmountAsync();
  });

  it("renders Agenda, Week, Month, and both detail types", async () => {
    const populated = await renderAsync(<CalendarPreview scenario="populated" />);
    await settleVirtualizedList();
    expect(screen.getByRole("radio", { name: "Ajanda" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    await populated.unmountAsync();

    const week = await renderAsync(<CalendarPreview scenario="week" />);
    await settleVirtualizedList();
    expect(screen.getByRole("radio", { name: "Hafta" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(WEEK_RANGE_REGRESSION_EVENT).toEqual(expect.objectContaining({
      startDate: "2026-08-17",
      endDate: "2026-08-28",
    }));
    expect(screen.getByText("24 Ağu 2026 – 30 Ağu 2026")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Devam eden etkinlikler" })).toBeOnTheScreen();
    expect(screen.queryByRole("header", { name: "17 Ağustos Pazartesi" })).not.toBeOnTheScreen();
    expect(screen.getByText("Devam eden sınav tarihleri")).toBeOnTheScreen();
    await week.unmountAsync();

    const month = await renderAsync(<CalendarPreview scenario="month" />);
    await settleVirtualizedList();
    fireEvent.press(screen.getByRole("button", { name: "Takvim seçeneklerini aç" }));
    expect(screen.getByRole("radio", { name: "Ay" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    await month.unmountAsync();

    const academicDetail = await renderAsync(<CalendarPreview scenario="detail-academic" />);
    await settleVirtualizedList();
    expect(screen.getByText("Kaynak ve kapsam")).toBeOnTheScreen();
    await academicDetail.unmountAsync();

    const personalDetail = await renderAsync(<CalendarPreview scenario="detail-personal" />);
    await settleVirtualizedList();
    expect(screen.getByRole("button", { name: "Kişisel etkinliği düzenle" })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Kişisel etkinliği düzenle" }));
    expect(screen.getByTestId("bottom-sheet").props.accessibilityLabel).toBe(
      "Kişisel etkinlik düzenleme alt sayfası",
    );
    await personalDetail.unmountAsync();
  });

  it("remounts scenario-owned calendar state after an accepted preview deep link", async () => {
    const urlHandlers: Array<(event: { url: string }) => void> = [];
    jest.spyOn(Linking, "addEventListener").mockImplementation((event, handler) => {
      if (event === "url") urlHandlers.push(handler as (event: { url: string }) => void);
      return { remove: jest.fn() } as unknown as ReturnType<typeof Linking.addEventListener>;
    });

    const view = await renderAsync(<CalendarPreview scenario="month" />);
    await settleVirtualizedList();
    fireEvent.press(screen.getByRole("button", { name: "Takvim seçeneklerini aç" }));
    expect(screen.getByRole("radio", { name: "Ay" }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    fireEvent.press(screen.getByRole("button", { name: "Alt sayfayı kapat" }));
    expect(urlHandlers).not.toHaveLength(0);

    act(() => {
      urlHandlers.forEach((handler) => handler({
        url: "academicpulse://phase9-calendar/week?theme=dark",
      }));
    });

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Hafta" }).props.accessibilityState).toEqual(
        expect.objectContaining({ selected: true }),
      );
    });
    await settleVirtualizedList();
    await view.unmountAsync();
  });
});
