import { describe, expect, it } from "vitest";
import {
  APP_SHELL_ANDROID_BOTTOM_NAVIGATION_CONTENT_HEIGHT,
  APP_SHELL_COMPACT_LARGE_TEXT_MAX_FONT_SIZE_MULTIPLIER,
  APP_SHELL_IOS_BOTTOM_NAVIGATION_CONTENT_HEIGHT,
  APP_SHELL_LABEL_MAX_FONT_SIZE_MULTIPLIER,
  PRIMARY_TABS,
  primaryTabDefinition,
  resolveAppShellLayoutContract,
} from "../../apps/mobile-native/src/navigation/app-shell";

describe("Phase 5 app-shell contract", () => {
  it("publishes exactly four Turkish primary tabs with stable route ownership", () => {
    expect(PRIMARY_TABS).toEqual([
      expect.objectContaining({ route: "HomeTab", rootRoute: "Home", label: "Ana Sayfa" }),
      expect.objectContaining({ route: "AnnouncementsTab", rootRoute: "Announcements", label: "Duyurular" }),
      expect.objectContaining({ route: "CalendarTab", rootRoute: "Calendar", label: "Takvim" }),
      expect.objectContaining({ route: "ProfileTab", rootRoute: "Profile", label: "Profil" }),
    ]);
    expect(PRIMARY_TABS).toHaveLength(4);
    expect(PRIMARY_TABS.map((tab) => tab.rootRoute)).not.toContain("SummerSchool");
    expect(PRIMARY_TABS.map((tab) => tab.rootRoute)).not.toContain("YokAnnouncements");
  });

  it("defines distinct selected and unselected icon shapes for every tab", () => {
    for (const tab of PRIMARY_TABS) {
      expect(tab.icon).toMatch(/-outline$/);
      expect(tab.selectedIcon).not.toBe(tab.icon);
      expect(primaryTabDefinition(tab.route)).toBe(tab);
    }
  });

  it("keeps compact Android labels at 12 logical units with a bounded 200% fallback", () => {
    expect(resolveAppShellLayoutContract({
      platform: "android",
      windowWidth: 320,
      fontScale: 2,
    })).toEqual({
      topBarDensity: "compact",
      navigationLabelFontSize: 12,
      navigationLabelLines: 1,
      navigationLabelMaxFontSizeMultiplier:
        APP_SHELL_COMPACT_LARGE_TEXT_MAX_FONT_SIZE_MULTIPLIER,
      largeTextFallback: "bounded-label-full-accessible-name",
      bottomNavigationContentHeight:
        APP_SHELL_ANDROID_BOTTOM_NAVIGATION_CONTENT_HEIGHT,
    });
  });

  it("keeps iOS labels at 11 logical units and selects regular width deterministically", () => {
    expect(resolveAppShellLayoutContract({
      platform: "ios",
      windowWidth: 390,
      fontScale: 1,
    })).toMatchObject({
      topBarDensity: "regular",
      navigationLabelFontSize: 11,
      navigationLabelMaxFontSizeMultiplier:
        APP_SHELL_LABEL_MAX_FONT_SIZE_MULTIPLIER,
      largeTextFallback: "native-scaling",
      bottomNavigationContentHeight:
        APP_SHELL_IOS_BOTTOM_NAVIGATION_CONTENT_HEIGHT,
    });
  });

  it("reserves unclipped bottom-tab content height across the Phase 11 size matrix", () => {
    for (const platform of ["android", "ios"] as const) {
      for (const windowWidth of [320, 360, 393, 430, 853]) {
        for (const fontScale of [1, 1.3, 1.5, 2]) {
          const contract = resolveAppShellLayoutContract({
            platform,
            windowWidth,
            fontScale,
          });
          const scaledLineHeight =
            (contract.navigationLabelFontSize + 4)
            * Math.min(fontScale, contract.navigationLabelMaxFontSizeMultiplier);
          expect(contract.navigationLabelLines).toBe(1);
          expect(contract.bottomNavigationContentHeight).toBeGreaterThanOrEqual(
            24 + scaledLineHeight + 16,
          );
        }
      }
    }
  });
});
