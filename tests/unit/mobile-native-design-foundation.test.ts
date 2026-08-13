import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  darkTheme,
  lightTheme,
  readableWidths,
  resolveTheme,
  resolveThemeMode,
  spacing,
  touchTargets,
  typography,
} from "../../apps/mobile-native/src/design-system/tokens";
import {
  normalizePlatform,
  resolveElevationStyle,
  resolvePlatformAdaptation,
  resolveScreenGutter,
} from "../../apps/mobile-native/src/design-system/platform";

describe("mobile-native design foundation", () => {
  it("resolves explicit and system theme preferences without mutating shared themes", () => {
    expect(resolveThemeMode("light", "dark")).toBe("light");
    expect(resolveThemeMode("dark", "light")).toBe("dark");
    expect(resolveThemeMode("system", "dark")).toBe("dark");
    expect(resolveThemeMode("system", null)).toBe("light");
    expect(resolveTheme("system", "dark")).toBe(darkTheme);
    expect(resolveTheme("system", "light")).toBe(lightTheme);
  });

  it("provides complete light and dark semantic roles", () => {
    for (const theme of [lightTheme, darkTheme]) {
      expect(theme.colors.background.canvas).toMatch(/^#[0-9A-F]{6}$/);
      expect(theme.colors.background.surface).toMatch(/^#[0-9A-F]{6}$/);
      expect(theme.colors.text.primary).toMatch(/^#[0-9A-F]{6}$/);
      expect(theme.colors.action.primary).toMatch(/^#[0-9A-F]{6}$/);
      expect(theme.colors.status.success).toMatch(/^#[0-9A-F]{6}$/);
      expect(theme.colors.status.warning).toMatch(/^#[0-9A-F]{6}$/);
      expect(theme.colors.status.error).toMatch(/^#[0-9A-F]{6}$/);
      expect(theme.colors.status.info).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(lightTheme.colors.background.canvas).not.toBe(
      darkTheme.colors.background.canvas,
    );
  });

  it("keeps primary reading and action pairs at accessible contrast", () => {
    for (const theme of [lightTheme, darkTheme]) {
      expect(
        contrastRatio(theme.colors.text.primary, theme.colors.background.surface),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.colors.text.secondary, theme.colors.background.surface),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.colors.action.onPrimary, theme.colors.action.primary),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps feedback copy readable on every semantic feedback container", () => {
    for (const theme of [lightTheme, darkTheme]) {
      expect(
        contrastRatio(
          theme.colors.status.onSuccessContainer,
          theme.colors.status.successContainer,
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(
          theme.colors.status.onWarningContainer,
          theme.colors.status.warningContainer,
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(
          theme.colors.status.onErrorContainer,
          theme.colors.status.errorContainer,
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(
          theme.colors.status.onInfoContainer,
          theme.colors.status.infoContainer,
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("rejects non-opaque colors in contrast checks", () => {
    expect(() => contrastRatio("transparent", "#FFFFFF")).toThrow(
      "Expected a six-digit opaque hex color",
    );
    expect(() => contrastRatio("#FFFFFF80", "#000000")).toThrow(
      "Expected a six-digit opaque hex color",
    );
  });

  it("exposes the accepted type, spacing, radius, motion, and readable-width scales", () => {
    expect(Object.values(spacing)).toEqual([4, 8, 12, 16, 20, 24, 32, 40]);
    expect(typography.body).toEqual({
      fontSize: 16,
      lineHeight: 23,
      fontWeight: "400",
    });
    expect(typography.navLabel.fontSize).toBeGreaterThanOrEqual(12);
    expect(lightTheme.radii).toMatchObject({ small: 6, control: 8, card: 10, prominent: 12 });
    expect(lightTheme.motion.duration).toMatchObject({ immediate: 80, short: 160, medium: 240 });
    expect(readableWidths.content).toBeGreaterThanOrEqual(680);
    expect(readableWidths.content).toBeLessThanOrEqual(720);
  });

  it("normalizes supported native platforms and safe fallback platforms", () => {
    expect(normalizePlatform("ios")).toBe("ios");
    expect(normalizePlatform("android")).toBe("android");
    expect(normalizePlatform("web")).toBe("fallback");
    expect(normalizePlatform("windows")).toBe("fallback");
  });

  it("selects Liquid Glass only for eligible iOS navigation chrome", () => {
    const adaptation = resolvePlatformAdaptation({
      platform: "ios",
      windowWidth: 390,
      reducedMotion: false,
      reducedTransparency: false,
      liquidGlassAvailable: true,
    });

    expect(adaptation.navigationMaterial).toBe("liquid-glass");
    expect(adaptation.pressFeedback).toBe("highlight");
    expect(adaptation.minimumTouchTarget).toBe(touchTargets.ios);
    expect(adaptation.navigationLayout).toBe("bottom-tabs");
  });

  it("fails iOS glass to opaque chrome for reduced transparency or unavailable material", () => {
    const reducedTransparency = resolvePlatformAdaptation({
      platform: "ios",
      windowWidth: 390,
      reducedMotion: false,
      reducedTransparency: true,
      liquidGlassAvailable: true,
    });
    const unavailable = resolvePlatformAdaptation({
      platform: "ios",
      windowWidth: 390,
      reducedMotion: false,
      reducedTransparency: false,
      liquidGlassAvailable: false,
    });

    expect(reducedTransparency.navigationMaterial).toBe("opaque-tonal");
    expect(unavailable.navigationMaterial).toBe("opaque-tonal");
  });

  it("selects Android ripple, Material touch targets, and a wide navigation rail", () => {
    const phone = resolvePlatformAdaptation({
      platform: "android",
      windowWidth: 360,
      reducedMotion: false,
      reducedTransparency: false,
      liquidGlassAvailable: true,
    });
    const tablet = resolvePlatformAdaptation({
      platform: "android",
      windowWidth: 900,
      reducedMotion: false,
      reducedTransparency: false,
      liquidGlassAvailable: true,
    });

    expect(phone.navigationMaterial).toBe("opaque-tonal");
    expect(phone.pressFeedback).toBe("ripple");
    expect(phone.minimumTouchTarget).toBe(touchTargets.android);
    expect(phone.navigationLayout).toBe("bottom-tabs");
    expect(tablet.navigationLayout).toBe("navigation-rail");
  });

  it("maps reduced motion and phone/tablet gutters deterministically", () => {
    const adaptation = resolvePlatformAdaptation({
      platform: "android",
      windowWidth: 320,
      reducedMotion: true,
      reducedTransparency: false,
      liquidGlassAvailable: false,
    });

    expect(adaptation.motionPolicy).toBe("reduced");
    expect(resolveScreenGutter(320)).toBe(spacing.md);
    expect(resolveScreenGutter(390)).toBe(spacing.lg);
    expect(resolveScreenGutter(900)).toBe(spacing.xl);
    expect(resolveScreenGutter(Number.NaN)).toBe(spacing.md);
  });

  it("resolves semantic elevation without importing native platform state", () => {
    expect(resolveElevationStyle("medium", "android", lightTheme)).toEqual({ elevation: 3 });
    expect(resolveElevationStyle("none", "fallback", lightTheme)).toEqual({});
    expect(resolveElevationStyle("low", "ios", darkTheme)).toEqual({
      shadowColor: darkTheme.colors.state.scrim,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.12,
      shadowRadius: 2,
    });
    expect(resolveElevationStyle("low", "ios", lightTheme)).toMatchObject({
      shadowColor: lightTheme.colors.background.inverse,
    });
  });
});
