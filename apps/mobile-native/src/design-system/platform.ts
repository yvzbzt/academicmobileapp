import {
  elevation,
  readableWidths,
  spacing,
  touchTargets,
  type SemanticTheme,
} from "./tokens";

export type AdaptivePlatform = "ios" | "android" | "fallback";
export type NavigationMaterial = "liquid-glass" | "opaque-tonal";
export type NavigationLayout = "bottom-tabs" | "navigation-rail";
export type PressFeedback = "highlight" | "ripple" | "tonal";
export type MotionPolicy = "system" | "reduced";

export interface PlatformResolutionInput {
  platform: string;
  windowWidth: number;
  reducedMotion: boolean;
  reducedTransparency: boolean;
  liquidGlassAvailable: boolean;
}

export interface PlatformAdaptation {
  platform: AdaptivePlatform;
  navigationMaterial: NavigationMaterial;
  navigationLayout: NavigationLayout;
  pressFeedback: PressFeedback;
  motionPolicy: MotionPolicy;
  minimumTouchTarget: number;
  screenGutter: number;
  readableContentWidth: number;
}

export function normalizePlatform(platform: string): AdaptivePlatform {
  if (platform === "ios" || platform === "android") {
    return platform;
  }

  return "fallback";
}

export function resolveScreenGutter(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) {
    return spacing.md;
  }

  if (windowWidth < 375) {
    return spacing.md;
  }

  if (windowWidth < readableWidths.tabletBreakpoint) {
    return spacing.lg;
  }

  return spacing.xl;
}

export function resolvePlatformAdaptation(
  input: PlatformResolutionInput,
): PlatformAdaptation {
  const platform = normalizePlatform(input.platform);
  const mayUseLiquidGlass =
    platform === "ios" &&
    input.liquidGlassAvailable &&
    !input.reducedTransparency;
  const useNavigationRail =
    platform === "android" &&
    input.windowWidth >= readableWidths.navigationRailBreakpoint;

  return {
    platform,
    navigationMaterial: mayUseLiquidGlass ? "liquid-glass" : "opaque-tonal",
    navigationLayout: useNavigationRail ? "navigation-rail" : "bottom-tabs",
    pressFeedback:
      platform === "android" ? "ripple" : platform === "ios" ? "highlight" : "tonal",
    motionPolicy: input.reducedMotion ? "reduced" : "system",
    minimumTouchTarget:
      platform === "ios"
        ? touchTargets.ios
        : platform === "android"
          ? touchTargets.android
          : touchTargets.fallback,
    screenGutter: resolveScreenGutter(input.windowWidth),
    readableContentWidth: readableWidths.content,
  };
}

export type ElevationLevel = keyof typeof elevation;

export function resolveElevationStyle(
  level: ElevationLevel,
  platform: AdaptivePlatform,
  theme: SemanticTheme,
): Record<string, number | string | { width: number; height: number }> {
  const token = theme.elevation[level];
  if (platform === "android") {
    return { elevation: token.android };
  }

  if (platform === "ios") {
    return {
      shadowColor: theme.colors.background.inverse,
      shadowOffset: token.ios.shadowOffset,
      shadowOpacity: token.ios.shadowOpacity,
      shadowRadius: token.ios.shadowRadius,
    };
  }

  return {};
}
