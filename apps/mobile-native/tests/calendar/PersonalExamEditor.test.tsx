import { Alert, Modal, ScrollView } from "react-native";
import { fireEvent, screen, within } from "@testing-library/react-native";
import { PersonalExamEditor } from "../../src/calendar/PersonalExamEditor";
import { renderWithTheme } from "../design-system/test-utils";

describe("PersonalExamEditor", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps its actions visible outside the scrollable field region", async () => {
    const view = await renderWithTheme(
      <PersonalExamEditor
        onDismiss={jest.fn()}
        onSubmit={() => ({ ok: true })}
        visible
      />,
    );

    const fieldScroll = screen.getByTestId("personal-exam-fields-scroll");
    const actions = screen.getByTestId("personal-exam-actions");

    expect(view.UNSAFE_getAllByType(ScrollView)).toHaveLength(1);
    expect(within(fieldScroll).getByLabelText("Etkinlik adı")).toBeVisible();
    expect(within(fieldScroll).getByLabelText("Konum veya not")).toBeVisible();
    expect(within(fieldScroll).queryByRole("button", { name: "Vazgeç" })).toBeNull();
    expect(within(fieldScroll).queryByRole("button", { name: "Etkinliği ekle" })).toBeNull();
    expect(within(actions).getByRole("button", { name: "Vazgeç" })).toBeVisible();
    expect(within(actions).getByRole("button", { name: "Etkinliği ekle" })).toBeVisible();
  });

  it.each(["X", "İptal", "backdrop", "Android geri"] as const)(
    "asks for discard confirmation when a changed form closes through %s",
    async (dismissPath) => {
      const onDismiss = jest.fn();
      const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
      const view = await renderWithTheme(
        <PersonalExamEditor
          onDismiss={onDismiss}
          onSubmit={() => ({ ok: true })}
          visible
        />,
      );
      fireEvent.changeText(screen.getByLabelText("Etkinlik adı"), "Kaydedilmemiş etkinlik");

      if (dismissPath === "X") {
        fireEvent.press(screen.getByRole("button", { name: "Kişisel etkinlik formunu kapat" }));
      } else if (dismissPath === "İptal") {
        fireEvent.press(screen.getByRole("button", { name: "Vazgeç" }));
      } else if (dismissPath === "backdrop") {
        fireEvent.press(screen.getByTestId("bottom-sheet-backdrop"));
      } else {
        fireEvent(view.UNSAFE_getByType(Modal), "requestClose");
      }

      expect(onDismiss).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        "Değişiklikler kaydedilmedi",
        "Bu formdaki değişikliklerden vazgeçmek istiyor musun?",
        expect.any(Array),
      );
      const actions = alertSpy.mock.calls[0]?.[2];
      expect(actions).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: "Düzenlemeye devam et", style: "cancel" }),
        expect.objectContaining({ text: "Değişikliklerden vazgeç", style: "destructive" }),
      ]));

      actions?.find((action) => action.text === "Düzenlemeye devam et")?.onPress?.();
      expect(onDismiss).not.toHaveBeenCalled();
      actions?.find((action) => action.text === "Değişikliklerden vazgeç")?.onPress?.();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    },
  );

  it("closes an empty create form directly", async () => {
    const onDismiss = jest.fn();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await renderWithTheme(
      <PersonalExamEditor
        onDismiss={onDismiss}
        onSubmit={() => ({ ok: true })}
        visible
      />,
    );

    fireEvent.press(screen.getByRole("button", { name: "Vazgeç" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("closes an unchanged edit form directly using its initial draft", async () => {
    const onDismiss = jest.fn();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await renderWithTheme(
      <PersonalExamEditor
        exam={{
          id: "personal-1",
          title: "Lineer Cebir",
          examDate: "2026-08-21T11:30:00.000Z",
          kind: "exam",
          locationNote: "D-101",
          reminderMinutesBefore: 15,
        }}
        onDismiss={onDismiss}
        onSubmit={() => ({ ok: true })}
        visible
      />,
    );

    fireEvent.press(screen.getByRole("button", { name: "Kişisel etkinlik formunu kapat" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("closes directly after a draft is restored to its initial value", async () => {
    const onDismiss = jest.fn();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await renderWithTheme(
      <PersonalExamEditor
        onDismiss={onDismiss}
        onSubmit={() => ({ ok: true })}
        visible
      />,
    );

    fireEvent.changeText(screen.getByLabelText("Etkinlik adı"), "Geçici metin");
    fireEvent.changeText(screen.getByLabelText("Etkinlik adı"), "");
    fireEvent.press(screen.getByRole("button", { name: "Vazgeç" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
