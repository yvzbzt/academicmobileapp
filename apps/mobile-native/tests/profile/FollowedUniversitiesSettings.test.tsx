import { fireEvent, renderAsync, screen } from "@testing-library/react-native";
import { Keyboard } from "react-native";
import { ThemeProvider } from "../../src/design-system";
import {
  FollowedUniversitiesSettingsScreen,
  type FollowedUniversityRecord,
} from "../../src/profile/FollowedUniversitiesSettings";

const defaultFollowed: FollowedUniversityRecord[] = [
  { id: "follow-1", universityId: "uni-2", createdAt: "2026-08-13T10:00:00.000Z" },
];

const universityOptions = [
  { id: "uni-1", name: "Birincil Üniversitesi", city: "İstanbul" },
  { id: "uni-2", name: "Ege Üniversitesi", city: "İzmir" },
  { id: "uni-3", name: "Ankara Üniversitesi", city: "Ankara" },
  { id: "uni-4", name: "Boğaziçi Üniversitesi", city: "İstanbul" },
];

function tree(
  onToggle = jest.fn(),
  options: {
    followed?: readonly FollowedUniversityRecord[];
    primaryUniversityId?: string;
    windowWidth?: number;
  } = {},
) {
  return (
    <ThemeProvider
      liquidGlassAvailable={false}
      platform="android"
      preference="light"
      reducedMotion
      reducedTransparency={false}
      windowWidth={options.windowWidth ?? 360}
    >
      <FollowedUniversitiesSettingsScreen
        followed={options.followed ?? defaultFollowed}
        onRetry={jest.fn()}
        onToggle={onToggle}
        primaryUniversityId={options.primaryUniversityId ?? "uni-1"}
        universities={universityOptions}
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
    expect(screen.getByText(
      "Bu seçimler Duyurular ve ana sayfadaki duyuru özetini genişletir. Takvim birincil üniversitene bağlı kalır.",
    )).toBeVisible();
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

  it.each([0, 1, 2, 3])(
    "reports and exposes %i distinct additional university selections",
    async (count) => {
      const followed = universityOptions.slice(1, count + 1).map((university, index) => ({
        id: `follow-${index + 1}`,
        universityId: university.id,
        createdAt: `2026-08-${13 + index}T10:00:00.000Z`,
      }));
      await renderAsync(tree(jest.fn(), { followed }));

      expect(screen.getByText(`${count} ek üniversite`)).toBeVisible();
      expect(screen.getAllByRole("switch").filter(
        (row) => row.props.accessibilityState?.checked === true,
      )).toHaveLength(count);
    },
  );

  it("does not count a duplicate primary or repeated and nested follow rows, while removal stays reachable", async () => {
    const onToggle = jest.fn();
    await renderAsync(tree(onToggle, {
      followed: [
        { id: "primary-copy", universityId: "uni-1", createdAt: "2026-08-10T10:00:00.000Z" },
        { id: "follow-2", universityId: "uni-2", createdAt: "2026-08-11T10:00:00.000Z" },
        { id: "follow-2-copy", universityId: "uni-2", createdAt: "2026-08-12T10:00:00.000Z" },
        {
          id: "nested-follow",
          universityId: "uni-3",
          facultyId: "faculty-3",
          createdAt: "2026-08-13T10:00:00.000Z",
        },
      ],
    }));

    expect(screen.getByText("1 ek üniversite")).toBeVisible();
    expect(screen.queryByText("Birincil Üniversitesi")).toBeNull();
    const followed = screen.getByRole("switch", { name: "Ege Üniversitesi. Takip ediliyor" });
    fireEvent.press(followed);
    expect(onToggle).toHaveBeenCalledWith("uni-2", false);
    expect(screen.getByRole("switch", { name: "Ankara Üniversitesi. Takip edilmiyor" }))
      .toBeVisible();
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
