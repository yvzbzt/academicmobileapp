import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  darkTheme,
  lightTheme,
  type SemanticTheme,
} from "../../apps/mobile-native/src/design-system/tokens";
import { resolvePlatformAdaptation } from "../../apps/mobile-native/src/design-system/platform";
import { resolveAuthResponsiveContract } from "../../apps/mobile-native/src/auth/auth-ui";
import { resolveHomeLayout } from "../../apps/mobile-native/src/home/home-model";
import { resolveContentFeedLayout } from "../../apps/mobile-native/src/announcements/feed-model";
import { resolveProfileSettingsLayout } from "../../apps/mobile-native/src/profile/profile-model";
import { resolveAppShellLayoutContract } from "../../apps/mobile-native/src/navigation/app-shell";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const nativeSourceRoot = resolve(repositoryRoot, "apps/mobile-native/src");
const auditedWidths = [320, 360, 393, 430, 853] as const;
const auditedFontScales = [1.3, 1.5, 2] as const;

function source(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8").replace(/\r\n?/gu, "\n");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    return /\.[cm]?tsx?$/u.test(entry.name) ? [absolutePath] : [];
  });
}

function expectMinimumContrast(
  theme: SemanticTheme,
  foregrounds: readonly string[],
  backgrounds: readonly string[],
  minimum: number,
) {
  for (const foreground of foregrounds) {
    for (const background of backgrounds) {
      expect(
        contrastRatio(foreground, background),
        `${theme.mode}: ${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(minimum);
    }
  }
}

describe("mobile-native Phase 11 cross-platform quality", () => {
  it("keeps every normal semantic text pair at 4.5:1 in light and dark themes", () => {
    for (const theme of [lightTheme, darkTheme]) {
      const surfaces = [
        theme.colors.background.canvas,
        theme.colors.background.surface,
        theme.colors.background.surfaceRaised,
        theme.colors.background.subtle,
      ];
      expectMinimumContrast(theme, [
        theme.colors.text.primary,
        theme.colors.text.secondary,
        theme.colors.text.disabled,
        theme.colors.text.link,
      ], surfaces, 4.5);
      expectMinimumContrast(theme, [theme.colors.action.onDisabled], [theme.colors.action.disabled], 4.5);
      expectMinimumContrast(theme, [theme.colors.action.onPrimary], [theme.colors.action.primary], 4.5);
      expectMinimumContrast(theme, [theme.colors.status.onSuccessContainer], [theme.colors.status.successContainer], 4.5);
      expectMinimumContrast(theme, [theme.colors.status.onWarningContainer], [theme.colors.status.warningContainer], 4.5);
      expectMinimumContrast(theme, [theme.colors.status.onErrorContainer], [theme.colors.status.errorContainer], 4.5);
      expectMinimumContrast(theme, [theme.colors.status.onInfoContainer], [theme.colors.status.infoContainer], 4.5);
    }
  });

  it("keeps control, focus, status, and disabled boundaries at 3:1", () => {
    for (const theme of [lightTheme, darkTheme]) {
      const surfaces = [
        theme.colors.background.canvas,
        theme.colors.background.surface,
        theme.colors.background.surfaceRaised,
        theme.colors.background.subtle,
      ];
      expectMinimumContrast(theme, [
        theme.colors.border.default,
        theme.colors.border.strong,
        theme.colors.border.focus,
        theme.colors.action.primary,
        theme.colors.status.success,
        theme.colors.status.warning,
        theme.colors.status.error,
        theme.colors.status.info,
      ], surfaces, 3);
      expectMinimumContrast(theme, [theme.colors.border.default], [theme.colors.action.disabled], 3);
    }
  });

  it("keeps the complete width and font-scale matrix single-column, readable, and unclipped", () => {
    for (const width of auditedWidths) {
      for (const fontScale of auditedFontScales) {
        const auth = resolveAuthResponsiveContract({ platform: "android", windowWidth: width, fontScale });
        const home = resolveHomeLayout(width, fontScale);
        const feed = resolveContentFeedLayout(width, fontScale);
        const profile = resolveProfileSettingsLayout(width, fontScale);
        const shell = resolveAppShellLayoutContract({ platform: "android", windowWidth: width, fontScale });

        expect(auth.horizontalScrollingAllowed).toBe(false);
        expect(auth.textScalePolicy).toBe("system-unbounded");
        expect(home).toMatchObject({ columns: 1, maxWidth: 720 });
        expect(feed).toMatchObject({ columns: 1, maxWidth: 720, allowsHorizontalClipping: false, minTouchTarget: 48 });
        expect(profile).toMatchObject({ columns: 1, maxWidth: 720, horizontalScrollingAllowed: false, minimumTouchTarget: 48 });
        expect(shell.navigationLabelLines).toBe(1);
        expect(shell.navigationLabelMaxFontSizeMultiplier).toBeLessThanOrEqual(1.35);

        if (width < 375 || fontScale === 2) {
          expect(feed.filterGroupsStacked).toBe(true);
        }
        if (width < 375) {
          expect(profile.notificationModeOrientation).toBe("vertical");
        }
      }
    }
    expect(resolveProfileSettingsLayout(853, 1.5).gutter).toBe(24);
  });

  it("selects tablet, touch-target, and reduced-effect policies deterministically", () => {
    const androidPhone = resolvePlatformAdaptation({
      platform: "android",
      windowWidth: 320,
      reducedMotion: false,
      reducedTransparency: false,
      liquidGlassAvailable: true,
    });
    const androidTablet = resolvePlatformAdaptation({
      platform: "android",
      windowWidth: 853,
      reducedMotion: true,
      reducedTransparency: false,
      liquidGlassAvailable: true,
    });
    const iosReducedTransparency = resolvePlatformAdaptation({
      platform: "ios",
      windowWidth: 430,
      reducedMotion: true,
      reducedTransparency: true,
      liquidGlassAvailable: true,
    });

    expect(androidPhone).toMatchObject({ minimumTouchTarget: 48, navigationLayout: "bottom-tabs", navigationMaterial: "opaque-tonal" });
    expect(androidTablet).toMatchObject({ minimumTouchTarget: 48, navigationLayout: "navigation-rail", motionPolicy: "reduced" });
    expect(iosReducedTransparency).toMatchObject({ minimumTouchTarget: 44, navigationMaterial: "opaque-tonal", motionPolicy: "reduced" });
  });

  it("confines raw application colors to the semantic token source", () => {
    const violations = sourceFiles(nativeSourceRoot).flatMap((absolutePath) => {
      if (absolutePath.endsWith(`${join("design-system", "tokens.ts")}`)) return [];
      const matches = readFileSync(absolutePath, "utf8").match(/#[0-9a-f]{3,8}\b|rgba?\s*\(/giu);
      return matches?.map((match) => ({
        file: relative(nativeSourceRoot, absolutePath).replaceAll("\\", "/"),
        match,
      })) ?? [];
    });
    expect(violations).toEqual([]);
  });

  it("preserves non-color selection, invalid, busy, and classification semantics", () => {
    const buttons = source("apps/mobile-native/src/design-system/primitives/Button.tsx");
    const contentPrimitives = source("apps/mobile-native/src/design-system/primitives/Content.tsx");
    const fields = source("apps/mobile-native/src/design-system/primitives/Fields.tsx");
    const selectors = source("apps/mobile-native/src/design-system/primitives/SelectField.tsx");
    const calendar = source("apps/mobile-native/src/calendar/CalendarExperience.tsx");

    expect(buttons).toContain("key={theme.mode}");
    expect(buttons).toContain("android_ripple=");
    expect(contentPrimitives).toContain('accessibilityRole="radio"');
    expect(contentPrimitives).toContain("accessibilityState={{ disabled: optionDisabled, selected }}");
    expect(fields).toContain("aria-invalid={error ? true : undefined}");
    expect(selectors).toContain("expanded: open");
    expect(calendar).toContain("{item.classificationLabel}");
    expect(calendar).toContain('name={useBell ? "notifications-outline" : "chevron-forward"}');
    expect(calendar).toContain("accessibilityState={{ busy: true }}");
  });

  it("keeps route, modal, validation, save, and result focus or announcement handoffs explicit", () => {
    const navigator = source("apps/mobile-native/src/navigation/AppNavigator.tsx");
    const sheet = source("apps/mobile-native/src/design-system/primitives/BottomSheet.tsx");
    const selector = source("apps/mobile-native/src/design-system/primitives/SelectField.tsx");
    const auth = source("apps/mobile-native/src/auth/AuthScreens.tsx");
    const examEditor = source("apps/mobile-native/src/calendar/PersonalExamEditor.tsx");
    const recentAuthentication = source("apps/mobile-native/src/auth/RecentAuthenticationPanel.tsx");
    const profile = source("apps/mobile-native/src/profile/ProfileSettings.tsx");
    const announcements = source("apps/mobile-native/src/announcements/AnnouncementsFeed.tsx");
    const calendar = source("apps/mobile-native/src/calendar/CalendarExperience.tsx");

    expect(navigator).toContain("AccessibilityInfo.setAccessibilityFocus(target)");
    expect(navigator).toContain("AccessibilityInfo.announceForAccessibility(");
    expect(sheet).toContain("AccessibilityInfo.setAccessibilityFocus(target)");
    expect(sheet).toContain("returnFocusRef");
    expect(selector).toContain("focusOnError");
    expect(selector).toContain("[focusOnError, focusOnErrorKey]");
    expect(selector).toContain("AccessibilityInfo.setAccessibilityFocus(reactTag)");
    expect(auth).toContain("emailRef.current?.focus()");
    expect(auth).toContain("passwordRef.current?.focus()");
    expect(auth).toContain("setValidationAttempt((current) => current + 1)");
    expect(examEditor).toContain("nextErrors.title");
    expect(examEditor).toContain("AccessibilityInfo.setAccessibilityFocus(target)");
    expect(recentAuthentication).toContain("AccessibilityInfo.setAccessibilityFocus(target)");
    expect(profile).toContain("restoreFocus(");
    expect(profile).toContain("validationAttempt={validationAttempt}");
    expect(announcements).toContain("AccessibilityInfo.announceForAccessibility(resultAnnouncement)");
    expect(calendar).toContain("AccessibilityInfo.announceForAccessibility(calendarAnnouncement)");
  });

  it("keeps all unbounded product datasets virtualized without speculative tuning", () => {
    const virtualizedSources = [
      "apps/mobile-native/src/home/HomeDailyBrief.tsx",
      "apps/mobile-native/src/announcements/AnnouncementsFeed.tsx",
      "apps/mobile-native/src/calendar/CalendarExperience.tsx",
      "apps/mobile-native/src/design-system/primitives/SelectField.tsx",
    ].map(source);

    for (const implementation of virtualizedSources) {
      expect(implementation).toContain("FlatList");
    }
    expect(source("apps/mobile-native/src/calendar/CalendarExperience.tsx"))
      .toContain('removeClippedSubviews={Platform.OS === "android"}');
    expect(source("apps/mobile-native/src/announcements/AnnouncementsFeed.tsx")).toContain("initialNumToRender={10}");
    expect(source("apps/mobile-native/src/calendar/CalendarExperience.tsx")).toContain("initialNumToRender={5}");
    expect(source("apps/mobile-native/src/design-system/primitives/SelectField.tsx")).toContain("windowSize={7}");
  });

  it("keeps reduced motion/transparency and opaque reading-surface boundaries explicit", () => {
    const themeSource = source("apps/mobile-native/src/design-system/theme.tsx");
    const sheetSource = source("apps/mobile-native/src/design-system/primitives/BottomSheet.tsx");
    const feedbackSource = source("apps/mobile-native/src/design-system/primitives/Feedback.tsx");
    const surfaceSource = source("apps/mobile-native/src/design-system/surfaces.tsx");
    const packageJson = source("apps/mobile-native/package.json");

    expect(themeSource).toContain('AccessibilityInfo.addEventListener(\n      "reduceMotionChanged"');
    expect(themeSource).toContain('AccessibilityInfo.addEventListener(\n      "reduceTransparencyChanged"');
    expect(sheetSource).toContain('reducedMotion ? "none"');
    expect(feedbackSource).toContain("if (reducedMotion)");
    expect(surfaceSource).toContain('adaptation.navigationMaterial === "liquid-glass"');
    expect(surfaceSource).toContain("backgroundColor: theme.colors.background.surfaceRaised");
    expect(packageJson).not.toMatch(/"three"\s*:/u);
  });

  it("retains canonicalized HTTP(S) external-link handling", () => {
    const appSource = source("apps/mobile-native/App.tsx");
    const start = appSource.indexOf("async function openAnnouncement");
    const end = appSource.indexOf("function renderAnnouncementCard", start);
    const implementation = appSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(implementation).toContain("canonicalizeOfficialAcademicUrl(link)");
    expect(implementation.indexOf("canonicalizeOfficialAcademicUrl(link)")).toBeLessThan(implementation.indexOf("Linking.canOpenURL"));
    expect(implementation).toContain("Linking.openURL(safeLink)");
    expect(implementation).not.toContain("Linking.openURL(link)");
  });
});
