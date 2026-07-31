export type ThemeMode = "light" | "dark";
export type ThemePreference = ThemeMode | "system";

export interface SemanticColors {
  background: {
    canvas: string;
    surface: string;
    surfaceRaised: string;
    subtle: string;
    inverse: string;
  };
  text: {
    primary: string;
    secondary: string;
    disabled: string;
    inverse: string;
    link: string;
  };
  border: {
    default: string;
    strong: string;
    focus: string;
  };
  action: {
    primary: string;
    onPrimary: string;
    primaryPressed: string;
    secondary: string;
    secondaryPressed: string;
    ghostPressed: string;
    disabled: string;
    onDisabled: string;
    focus: string;
  };
  status: {
    success: string;
    successContainer: string;
    onSuccessContainer: string;
    warning: string;
    warningContainer: string;
    onWarningContainer: string;
    error: string;
    errorPressed: string;
    errorContainer: string;
    onError: string;
    onErrorContainer: string;
    info: string;
    infoContainer: string;
    onInfoContainer: string;
  };
  state: {
    pressed: string;
    selected: string;
    scrim: string;
    skeleton: string;
    skeletonHighlight: string;
  };
}

const lightColors: SemanticColors = {
  background: {
    canvas: "#F6F7FB",
    surface: "#FFFFFF",
    surfaceRaised: "#FFFFFF",
    subtle: "#EEF1F7",
    inverse: "#172033",
  },
  text: {
    primary: "#172033",
    secondary: "#526079",
    disabled: "#758197",
    inverse: "#FFFFFF",
    link: "#3730A3",
  },
  border: {
    default: "#D7DEEA",
    strong: "#AAB5C7",
    focus: "#6D5CE7",
  },
  action: {
    primary: "#4338CA",
    onPrimary: "#FFFFFF",
    primaryPressed: "#3730A3",
    secondary: "#EEF2FF",
    secondaryPressed: "#E0E7FF",
    ghostPressed: "#E7EAF1",
    disabled: "#E2E6EE",
    onDisabled: "#758197",
    focus: "#6D5CE7",
  },
  status: {
    success: "#137A4B",
    successContainer: "#DDF7E9",
    onSuccessContainer: "#075C37",
    warning: "#8A5200",
    warningContainer: "#FFF1CC",
    onWarningContainer: "#6B3F00",
    error: "#B42318",
    errorPressed: "#8F1B13",
    errorContainer: "#FDE7E4",
    onError: "#FFFFFF",
    onErrorContainer: "#8F1B13",
    info: "#1D4ED8",
    infoContainer: "#E1EAFF",
    onInfoContainer: "#173EA7",
  },
  state: {
    pressed: "#1720331F",
    selected: "#E0E7FF",
    scrim: "#0E132199",
    skeleton: "#DDE2EB",
    skeletonHighlight: "#EEF1F7",
  },
};

const darkColors: SemanticColors = {
  background: {
    canvas: "#0E1321",
    surface: "#151C2E",
    surfaceRaised: "#1D263A",
    subtle: "#1D263A",
    inverse: "#F8FAFC",
  },
  text: {
    primary: "#F8FAFC",
    secondary: "#CBD5E1",
    disabled: "#94A3B8",
    inverse: "#111827",
    link: "#C7D2FE",
  },
  border: {
    default: "#344158",
    strong: "#64748B",
    focus: "#C7D2FE",
  },
  action: {
    primary: "#A5B4FC",
    onPrimary: "#111827",
    primaryPressed: "#C7D2FE",
    secondary: "#29334A",
    secondaryPressed: "#344158",
    ghostPressed: "#29334A",
    disabled: "#29334A",
    onDisabled: "#94A3B8",
    focus: "#C7D2FE",
  },
  status: {
    success: "#6EE7B7",
    successContainer: "#123D31",
    onSuccessContainer: "#A7F3D0",
    warning: "#FCD34D",
    warningContainer: "#473613",
    onWarningContainer: "#FDE68A",
    error: "#FDA4AF",
    errorPressed: "#FECDD3",
    errorContainer: "#4A2028",
    onError: "#3F0A13",
    onErrorContainer: "#FECDD3",
    info: "#93C5FD",
    infoContainer: "#1E3154",
    onInfoContainer: "#BFDBFE",
  },
  state: {
    pressed: "#F8FAFC24",
    selected: "#303A61",
    scrim: "#000000B3",
    skeleton: "#29334A",
    skeletonHighlight: "#344158",
  },
};

export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: "700" as const },
  screenTitle: { fontSize: 24, lineHeight: 30, fontWeight: "700" as const },
  sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700" as const },
  cardTitle: { fontSize: 17, lineHeight: 23, fontWeight: "600" as const },
  body: { fontSize: 16, lineHeight: 23, fontWeight: "400" as const },
  bodyStrong: { fontSize: 16, lineHeight: 23, fontWeight: "600" as const },
  label: { fontSize: 14, lineHeight: 19, fontWeight: "600" as const },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
  metaStrong: { fontSize: 13, lineHeight: 18, fontWeight: "600" as const },
  navLabel: { fontSize: 12, lineHeight: 16, fontWeight: "600" as const },
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radii = {
  small: 6,
  control: 10,
  card: 14,
  prominent: 18,
  pill: 999,
} as const;

export const elevation = {
  none: {
    android: 0,
    ios: { shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0 },
  },
  low: {
    android: 1,
    ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.12, shadowRadius: 2 },
  },
  medium: {
    android: 3,
    ios: { shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.16, shadowRadius: 6 },
  },
  high: {
    android: 6,
    ios: { shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12 },
  },
} as const;

export const motion = {
  duration: {
    none: 0,
    immediate: 80,
    short: 160,
    medium: 240,
    long: 360,
  },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    enter: "cubic-bezier(0, 0, 0, 1)",
    exit: "cubic-bezier(0.3, 0, 1, 1)",
  },
} as const;

export const safeArea = {
  minimumInset: 0,
  chromeGap: spacing.xs,
  floatingControlInset: spacing.md,
} as const;

export const readableWidths = {
  compact: 420,
  form: 560,
  content: 720,
  tabletBreakpoint: 768,
  navigationRailBreakpoint: 840,
} as const;

export const touchTargets = {
  ios: 44,
  android: 48,
  fallback: 44,
} as const;

export interface SemanticTheme {
  mode: ThemeMode;
  isDark: boolean;
  colors: SemanticColors;
  typography: typeof typography;
  spacing: typeof spacing;
  radii: typeof radii;
  elevation: typeof elevation;
  motion: typeof motion;
  safeArea: typeof safeArea;
  readableWidths: typeof readableWidths;
  touchTargets: typeof touchTargets;
}

export const lightTheme: SemanticTheme = {
  mode: "light",
  isDark: false,
  colors: lightColors,
  typography,
  spacing,
  radii,
  elevation,
  motion,
  safeArea,
  readableWidths,
  touchTargets,
};

export const darkTheme: SemanticTheme = {
  mode: "dark",
  isDark: true,
  colors: darkColors,
  typography,
  spacing,
  radii,
  elevation,
  motion,
  safeArea,
  readableWidths,
  touchTargets,
};

export function resolveThemeMode(
  preference: ThemePreference,
  systemMode: ThemeMode | null | undefined,
): ThemeMode {
  if (preference !== "system") {
    return preference;
  }

  return systemMode === "dark" ? "dark" : "light";
}

export function resolveTheme(
  preference: ThemePreference,
  systemMode: ThemeMode | null | undefined,
): SemanticTheme {
  return resolveThemeMode(preference, systemMode) === "dark" ? darkTheme : lightTheme;
}

function channelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hexColor: string): number {
  const normalized = hexColor.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(`Expected a six-digit opaque hex color, received ${hexColor}`);
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return (
    0.2126 * channelToLinear(red) +
    0.7152 * channelToLinear(green) +
    0.0722 * channelToLinear(blue)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}
