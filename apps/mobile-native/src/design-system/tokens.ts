export type ThemeMode = "light" | "dark";
export type ThemePreference = ThemeMode | "system";

/**
 * The reference artwork's immutable brand swatches. Semantic tokens below may
 * use darker foreground variants when a swatch does not meet text contrast.
 */
export const referencePalette = {
  blue: "#2563EB",
  teal: "#14B8A6",
  orange: "#F97316",
  yellow: "#EAB308",
  slate: "#64748B",
  mist: "#F1F5F9",
  navy: "#0B1739",
  white: "#FFFFFF",
  academicBlue: "#1463F3",
  academicBlueDeep: "#0758E9",
  academicBlueSoft: "#EAF2FF",
  academicBlueTint: "#EEF5FF",
  academicBlueSurface: "#F6F9FF",
  academicBlueSurfaceStrong: "#DCE9FF",
  academicBlueBorder: "#CFE0FF",
  academicBlueBorderMuted: "#E0E9F8",
  academicBlueBorderStrong: "#BFD4FA",
  academicBorder: "#E2E8F0",
  academicBorderCool: "#E3E9F2",
  academicBorderBlueMuted: "#D7E5F7",
  academicTextSecondary: "#60708D",
  academicTextInfo: "#28436F",
  academicTextBody: "#263654",
  academicTextDate: "#354667",
  academicGreen: "#0BA977",
  academicGreenSoft: "#E6F8F2",
  academicGreenTint: "#EAF9F3",
  academicGreenSurface: "#FBFFFD",
  academicGreenBorder: "#D9EFE7",
  academicGreenBorderStrong: "#8EDBC1",
  academicTeal: "#10BBA2",
  academicTealSoft: "#E1F9F5",
  academicTealTitle: "#086A5B",
  academicTealAction: "#087765",
  academicTealSurface: "#F0FCFA",
  academicTealBorder: "#D2F3ED",
  academicTealBorderMuted: "#CDECE6",
  academicOrange: "#E99700",
  academicOrangeFeed: "#F08A00",
  academicOrangeSoft: "#FFF4D8",
  academicOrangeFeedSoft: "#FFF5E6",
  academicRed: "#F04B4B",
  academicRedFeed: "#F04444",
  academicRedSoft: "#FFF0F0",
  academicPurple: "#7047EB",
  academicPurpleSoft: "#F2EEFF",
  academicMutedIcon: "#A4AEC0",
  academicPlaceholder: "#8793A8",
  academicNeutralLine: "#B9C8DD",
  academicNeutralLineSoft: "#D3DEEB",
  whiteAlpha14: "#FFFFFF24",
  whiteAlpha24: "#FFFFFF3D",
  academicBlueDeepAlpha18: "#0758E92E",
  heart: "#FF7474",
  googleBlue: "#4285F4",
  googleGreen: "#34A853",
  googleYellow: "#FBBC05",
  googleRed: "#EA4335",
  violet: "#7C3AED",
  violetSoft: "#F3E8FF",
  violetText: "#6D28D9",
  emerald: "#10B981",
  emeraldSoft: "#E8F8F2",
  emeraldText: "#047857",
  emeraldStrong: "#059669",
  emeraldContainer: "#DDF8F2",
  amberStrong: "#D97706",
  amberContainer: "#FFF4D6",
} as const;

export interface SemanticColors {
  accent: {
    blue: string;
    blueText: string;
    teal: string;
    tealText: string;
    orange: string;
    orangeText: string;
    yellow: string;
    yellowText: string;
  };
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
    subtle: string;
    default: string;
    strong: string;
    focus: string;
  };
  action: {
    primary: string;
    onPrimary: string;
    primaryPressed: string;
    primaryRipple: string;
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
  accent: {
    blue: referencePalette.blue,
    blueText: "#1D4ED8",
    teal: referencePalette.teal,
    tealText: "#0F766E",
    orange: referencePalette.orange,
    orangeText: "#C2410C",
    yellow: referencePalette.yellow,
    yellowText: "#854D0E",
  },
  background: {
    canvas: referencePalette.white,
    surface: referencePalette.white,
    surfaceRaised: referencePalette.white,
    subtle: referencePalette.mist,
    inverse: referencePalette.navy,
  },
  text: {
    primary: referencePalette.navy,
    secondary: "#5B6577",
    disabled: "#5B6577",
    inverse: referencePalette.white,
    link: "#1D4ED8",
  },
  border: {
    subtle: "#E2E8F0",
    default: "#758197",
    strong: "#526079",
    focus: "#2563EB",
  },
  action: {
    primary: referencePalette.blue,
    onPrimary: referencePalette.white,
    primaryPressed: "#1D4ED8",
    primaryRipple: "#FFFFFF33",
    secondary: "#EFF6FF",
    secondaryPressed: "#DBEAFE",
    ghostPressed: "#EAF2FF",
    disabled: "#E8EDF5",
    onDisabled: "#526079",
    focus: "#2563EB",
  },
  status: {
    success: "#0F766E",
    successContainer: "#DDF8F2",
    onSuccessContainer: "#075E50",
    warning: "#854D0E",
    warningContainer: "#FFF4D6",
    onWarningContainer: "#704000",
    error: "#DC2626",
    errorPressed: "#B91C1C",
    errorContainer: "#FEF2F2",
    onError: referencePalette.white,
    onErrorContainer: "#991B1B",
    info: "#2563EB",
    infoContainer: "#EAF2FF",
    onInfoContainer: "#1746A2",
  },
  state: {
    pressed: "#2563EB1A",
    selected: "#EAF2FF",
    scrim: "#0B173999",
    skeleton: "#DDE7F3",
    skeletonHighlight: "#F2F6FB",
  },
};

const darkColors: SemanticColors = {
  accent: {
    blue: "#60A5FA",
    blueText: "#BFDBFE",
    teal: "#2DD4BF",
    tealText: "#99F6E4",
    orange: "#FB923C",
    orangeText: "#FED7AA",
    yellow: "#FACC15",
    yellowText: "#FEF08A",
  },
  background: {
    canvas: "#081120",
    surface: "#101B30",
    surfaceRaised: "#16233B",
    subtle: "#182842",
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
    subtle: "#334763",
    default: "#94A3B8",
    strong: "#CBD5E1",
    focus: "#60A5FA",
  },
  action: {
    primary: "#60A5FA",
    onPrimary: "#071326",
    primaryPressed: "#93C5FD",
    primaryRipple: "#07132626",
    secondary: "#1B3150",
    secondaryPressed: "#244266",
    ghostPressed: "#1B3150",
    disabled: "#26364D",
    onDisabled: "#94A3B8",
    focus: "#93C5FD",
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
    selected: "#173967",
    scrim: "#000000B3",
    skeleton: "#26364D",
    skeletonHighlight: "#334763",
  },
};

export const typography = {
  display: { fontSize: 26, lineHeight: 32, fontWeight: "700" as const },
  screenTitle: { fontSize: 22, lineHeight: 28, fontWeight: "700" as const },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: "700" as const },
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: "600" as const },
  body: { fontSize: 16, lineHeight: 23, fontWeight: "400" as const },
  bodyStrong: { fontSize: 16, lineHeight: 23, fontWeight: "600" as const },
  label: { fontSize: 14, lineHeight: 19, fontWeight: "600" as const },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
  metaStrong: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const },
  navLabel: { fontSize: 12, lineHeight: 16, fontWeight: "500" as const },
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
  control: 8,
  card: 10,
  prominent: 12,
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
