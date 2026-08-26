import { fireEvent, renderAsync, screen } from "@testing-library/react-native";
import { Keyboard } from "react-native";
import { ThemeProvider } from "../../src/design-system";
import { FollowedUniversitiesSettingsScreen } from "../../src/profile/FollowedUniversitiesSettings";

function tree(onToggle = jest.fn()) {
  return (
    <ThemeProvider
      liquidGlassAvailable={false}
      platform="android"
      preference="light"
      reducedMotion
      reducedTransparency={false}
      windowWidth={360}
    >
      <FollowedUniversitiesSettingsScreen
        followed={[{ id: "follow-1", universityId: "uni-2", createdAt: "2026-08-13T10:00:00.000Z" }]}
        onRetry={jest.fn()}
        onToggle={onToggle}
        primaryUniversityId="uni-1"
        universities={[
          { id: "uni-1", name: "Birincil Üniversitesi", city: "İstanbul" },
          { id: "uni-2", name: "Ege Üniversitesi", city: "İzmir" },
          { id: "uni-3", name: "Ankara Üniversitesi", city: "Ankara" },
        ]}
      />
    </ThemeProvider>
  );
}

describe("FollowedUniversitiesSettingsScreen", () => {
  it("keeps the primary university out, exposes current state, and toggles additional universities", async () => {
    const onToggle = jest.fn();
    await renderAsync(tree(onToggle));

    expect(screen.queryByText("Birincil Üniversitesi")).toBeNull();
    expect(screen.getByText("1 ek üniversite")).toBeVisible();
    const followed = screen.getByRole("switch", { name: "Ege Üniversitesi. Takip ediliyor" });
    expect(followed.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));

    fireEvent.press(screen.getByRole("switch", { name: "Ankara Üniversitesi. Takip edilmiyor" }));
    expect(onToggle).toHaveBeenCalledWith("uni-3", true);
    fireEvent.press(followed);
    expect(onToggle).toHaveBeenCalledWith("uni-2", false);
  });

  it("filters by Turkish university or city name", async () => {
    await renderAsync(tree());

    fireEvent.changeText(screen.getByRole("search", { name: "Üniversite ara" }), "ankara");

    expect(screen.getByText("Ankara Üniversitesi")).toBeVisible();
    expect(screen.queryByText("Ege Üniversitesi")).toBeNull();
    expect(screen.getByRole("button", { name: "Aramayı temizle" }))
      .toHaveStyle({ height: 44, width: 44 });
  });

  it("dismisses the keyboard for completed searches and keeps one VoiceOver switch per row", async () => {
    const dismiss = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => undefined);
    try {
      await renderAsync(tree());

      const search = screen.getByRole("search", { name: "Üniversite ara" });
      fireEvent(search, "submitEditing");
      expect(dismiss).toHaveBeenCalledTimes(1);
      fireEvent.press(screen.getByRole("switch", { name: "Ankara Üniversitesi. Takip edilmiyor" }));
      expect(dismiss).toHaveBeenCalledTimes(2);

      expect(screen.getByTestId("followed-universities-list")).toHaveProp("accessible", false);
      expect(screen.getByTestId("followed-university-switch-visual-uni-3", { includeHiddenElements: true }))
        .toHaveProp("accessibilityElementsHidden", true);
      expect(screen.getByTestId("followed-university-switch-visual-uni-3", { includeHiddenElements: true }))
        .toHaveProp("importantForAccessibility", "no-hide-descendants");
    } finally {
      dismiss.mockRestore();
    }
  });
});
