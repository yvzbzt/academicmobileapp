import type { AdaptivePlatform } from "../design-system/platform";
import type { MainTabRouteName } from "./routes";

export type PrimaryTabRootRoute = "Home" | "Announcements" | "Calendar" | "Profile";

export interface PrimaryTabDefinition {
  route: MainTabRouteName;
  rootRoute: PrimaryTabRootRoute;
  label: string;
  icon: "home-outline" | "newspaper-outline" | "calendar-outline" | "options-outline";
  selectedIcon: "home" | "newspaper" | "calendar" | "options";
}

export const PRIMARY_TABS = [
  {
    route: "HomeTab",
    rootRoute: "Home",
    label: "Ana Sayfa",
    icon: "home-outline",
    selectedIcon: "home",
  },
  {
    route: "AnnouncementsTab",
    rootRoute: "Announcements",
    label: "Duyurular",
    icon: "newspaper-outline",
    selectedIcon: "newspaper",
  },
  {
    route: "CalendarTab",
    rootRoute: "Calendar",
    label: "Takvim",
    icon: "calendar-outline",
    selectedIcon: "calendar",
  },
  {
    route: "ProfileTab",
    rootRoute: "Profile",
    label: "Ayarlar",
    icon: "options-outline",
    selectedIcon: "options",
  },
] as const satisfies readonly PrimaryTabDefinition[];

export const APP_SHELL_COMPACT_WIDTH = 375;
export const APP_SHELL_LABEL_MAX_FONT_SIZE_MULTIPLIER = 1.35;
export const APP_SHELL_COMPACT_LARGE_TEXT_MAX_FONT_SIZE_MULTIPLIER = 1.2;
export const APP_SHELL_ANDROID_BOTTOM_NAVIGATION_CONTENT_HEIGHT = 64;
export const APP_SHELL_IOS_BOTTOM_NAVIGATION_CONTENT_HEIGHT = 64;
export type ShellTopBarDensity = "compact" | "regular";
export type ShellLargeTextFallback = "native-scaling" | "bounded-label-full-accessible-name";

export interface AppShellLayoutContract {
  topBarDensity: ShellTopBarDensity;
  navigationLabelFontSize: 11 | 12;
  navigationLabelLines: 1;
  navigationLabelMaxFontSizeMultiplier: number;
  largeTextFallback: ShellLargeTextFallback;
  bottomNavigationContentHeight?: 64 | 80;
}

export function resolveAppShellLayoutContract(input: {
  platform: AdaptivePlatform;
  windowWidth: number;
  fontScale: number;
}): AppShellLayoutContract {
  const fontScale = Number.isFinite(input.fontScale) && input.fontScale > 0
    ? input.fontScale
    : 1;
  const usesCompactLargeTextFallback =
    Number.isFinite(input.windowWidth)
    && input.windowWidth < APP_SHELL_COMPACT_WIDTH
    && fontScale > APP_SHELL_LABEL_MAX_FONT_SIZE_MULTIPLIER;

  return {
    topBarDensity:
      Number.isFinite(input.windowWidth) && input.windowWidth < APP_SHELL_COMPACT_WIDTH
        ? "compact"
        : "regular",
    navigationLabelFontSize: input.platform === "ios" ? 11 : 12,
    navigationLabelLines: 1,
    navigationLabelMaxFontSizeMultiplier: usesCompactLargeTextFallback
      ? APP_SHELL_COMPACT_LARGE_TEXT_MAX_FONT_SIZE_MULTIPLIER
      : APP_SHELL_LABEL_MAX_FONT_SIZE_MULTIPLIER,
    largeTextFallback:
      fontScale > APP_SHELL_LABEL_MAX_FONT_SIZE_MULTIPLIER
        ? "bounded-label-full-accessible-name"
        : "native-scaling",
    bottomNavigationContentHeight:
      input.platform === "android"
        ? APP_SHELL_ANDROID_BOTTOM_NAVIGATION_CONTENT_HEIGHT
        : input.platform === "ios"
          ? APP_SHELL_IOS_BOTTOM_NAVIGATION_CONTENT_HEIGHT
          : undefined,
  };
}

export function primaryTabDefinition(route: MainTabRouteName): PrimaryTabDefinition {
  const definition = PRIMARY_TABS.find((item) => item.route === route);
  if (!definition) {
    throw new Error(`Unsupported primary tab route: ${route}`);
  }
  return definition;
}
