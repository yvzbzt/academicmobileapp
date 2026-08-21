import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Platform,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import {
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import {
  resolveTheme,
  type SemanticTheme,
  type ThemeMode,
  type ThemePreference,
} from "./tokens";
import {
  resolvePlatformAdaptation,
  type PlatformAdaptation,
} from "./platform";

interface ThemeContextValue {
  theme: SemanticTheme;
  preference: ThemePreference;
  reducedMotion: boolean;
  reducedTransparency: boolean;
  adaptation: PlatformAdaptation;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
  preference?: ThemePreference;
  systemMode?: ThemeMode | null;
  platform?: string;
  windowWidth?: number;
  reducedMotion?: boolean;
  reducedTransparency?: boolean;
  liquidGlassAvailable?: boolean;
}

function safelyResolveLiquidGlassAvailability(platform: string): boolean {
  if (platform !== "ios") {
    return false;
  }

  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
}

export function ThemeProvider({
  children,
  preference = "system",
  systemMode,
  platform,
  windowWidth,
  reducedMotion,
  reducedTransparency,
  liquidGlassAvailable,
}: ThemeProviderProps) {
  const detectedSystemMode = useColorScheme();
  const dimensions = useWindowDimensions();
  const [detectedReducedMotion, setDetectedReducedMotion] = useState(true);
  const [detectedReducedTransparency, setDetectedReducedTransparency] = useState(true);
  const platformName = platform ?? Platform.OS;
  const resolvedReducedMotion = reducedMotion ?? detectedReducedMotion;
  const resolvedReducedTransparency =
    reducedTransparency ?? detectedReducedTransparency;

  useEffect(() => {
    if (reducedMotion !== undefined) {
      return;
    }

    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          setDetectedReducedMotion(enabled);
        }
      })
      .catch(() => {
        // Fail safe: the initial value keeps non-essential motion disabled.
      });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setDetectedReducedMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedTransparency !== undefined) {
      return;
    }

    if (typeof AccessibilityInfo.isReduceTransparencyEnabled !== "function") {
      return;
    }

    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (mounted) {
          setDetectedReducedTransparency(enabled);
        }
      })
      .catch(() => {
        // Fail safe: the initial value keeps navigation chrome opaque.
      });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      setDetectedReducedTransparency,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [reducedTransparency]);

  const theme = resolveTheme(
    preference,
    systemMode ?? (detectedSystemMode === "dark" ? "dark" : "light"),
  );
  const resolvedWindowWidth = windowWidth ?? dimensions.width;
  const resolvedLiquidGlassAvailability =
    liquidGlassAvailable ?? safelyResolveLiquidGlassAvailability(platformName);
  const adaptation = resolvePlatformAdaptation({
    platform: platformName,
    windowWidth: resolvedWindowWidth,
    reducedMotion: resolvedReducedMotion,
    reducedTransparency: resolvedReducedTransparency,
    liquidGlassAvailable: resolvedLiquidGlassAvailability,
  });

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme,
      preference,
      reducedMotion: resolvedReducedMotion,
      reducedTransparency: resolvedReducedTransparency,
      adaptation,
    }),
    [
      adaptation,
      preference,
      resolvedReducedMotion,
      resolvedReducedTransparency,
      theme,
    ],
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}

function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error("Design-system components must be rendered inside ThemeProvider");
  }

  return context;
}

export function useTheme(): SemanticTheme {
  return useThemeContext().theme;
}

export function useReducedMotion(): boolean {
  return useThemeContext().reducedMotion;
}

export function useReducedTransparency(): boolean {
  return useThemeContext().reducedTransparency;
}

export function usePlatformAdaptation(): PlatformAdaptation {
  return useThemeContext().adaptation;
}
