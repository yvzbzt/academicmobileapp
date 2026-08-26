import type { ReactNode, RefObject } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { GlassView } from "expo-glass-effect";
import { resolveElevationStyle } from "./platform";
import { usePlatformAdaptation, useTheme } from "./theme";

type ReadableWidth = "compact" | "form" | "content" | number;

export interface ScreenProps extends Omit<ViewProps, "style"> {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  readableWidth?: ReadableWidth;
  fullBleed?: boolean;
  centered?: boolean;
  keyboardSafe?: boolean;
  keyboardVerticalOffset?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  scrollViewProps?: Omit<ScrollViewProps, "contentContainerStyle">;
  scrollViewRef?: RefObject<ScrollView | null>;
}

function resolveReadableWidth(
  readableWidth: ReadableWidth,
  widths: { compact: number; form: number; content: number },
): number {
  return typeof readableWidth === "number" ? readableWidth : widths[readableWidth];
}

export function Screen({
  children,
  scroll = false,
  edges = ["top", "right", "bottom", "left"],
  readableWidth = "content",
  fullBleed = false,
  centered = false,
  keyboardSafe = false,
  keyboardVerticalOffset = 0,
  style,
  contentStyle,
  scrollViewProps,
  scrollViewRef,
  ...viewProps
}: ScreenProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const maxWidth = resolveReadableWidth(readableWidth, theme.readableWidths);
  const adaptiveContentStyle: StyleProp<ViewStyle> = [
    styles.content,
    scroll ? styles.scrollBody : styles.fill,
    {
      maxWidth,
      paddingHorizontal: fullBleed ? 0 : adaptation.screenGutter,
      paddingVertical: fullBleed ? 0 : theme.spacing.md,
    },
    centered && styles.centered,
    contentStyle,
  ];
  const content = scroll ? (
    <ScrollView
      ref={scrollViewRef}
      keyboardShouldPersistTaps="handled"
      {...scrollViewProps}
      automaticallyAdjustKeyboardInsets={
        keyboardSafe && Platform.OS === "ios"
          ? true
          : scrollViewProps?.automaticallyAdjustKeyboardInsets
      }
      contentContainerStyle={styles.scrollContent}
    >
      <View style={adaptiveContentStyle}>{children}</View>
    </ScrollView>
  ) : (
    <View style={adaptiveContentStyle}>{children}</View>
  );

  return (
    <SafeAreaView
      {...viewProps}
      edges={edges}
      style={[styles.screen, { backgroundColor: theme.colors.background.canvas }, style]}
    >
      {keyboardSafe && !scroll ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={keyboardVerticalOffset}
          style={styles.keyboardSafe}
        >
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export type NavigationSurfaceKind =
  | "navigation-bar"
  | "tab-bar"
  | "toolbar"
  | "sheet"
  | "floating-control";

export interface NavigationSurfaceProps extends ViewProps {
  children: ReactNode;
  kind?: NavigationSurfaceKind;
  material?: "automatic" | "opaque";
}

export function NavigationSurface({
  children,
  kind = "navigation-bar",
  material = "automatic",
  style,
  accessibilityRole = "toolbar",
  ...viewProps
}: NavigationSurfaceProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const useLiquidGlass =
    material === "automatic" &&
    adaptation.platform === "ios" &&
    adaptation.navigationMaterial === "liquid-glass";
  const kindStyle = navigationKindStyle(kind, theme.radii.prominent);
  const sharedStyle: StyleProp<ViewStyle> = [
    styles.navigationSurface,
    kindStyle,
    { borderColor: theme.colors.border.subtle },
    useLiquidGlass
      ? null
      : {
          backgroundColor: theme.colors.background.surfaceRaised,
          ...resolveElevationStyle("low", adaptation.platform, theme),
        },
    style,
  ];

  if (useLiquidGlass) {
    return (
      <GlassView
        {...viewProps}
        accessibilityRole={accessibilityRole}
        colorScheme={theme.mode}
        glassEffectStyle="regular"
        isInteractive={kind === "floating-control"}
        style={sharedStyle}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <View
      {...viewProps}
      accessibilityRole={accessibilityRole}
      style={sharedStyle}
    >
      {children}
    </View>
  );
}

function navigationKindStyle(kind: NavigationSurfaceKind, prominentRadius: number): ViewStyle {
  switch (kind) {
    case "tab-bar":
      return styles.tabBar;
    case "toolbar":
      return styles.toolbar;
    case "sheet":
      return { ...styles.sheet, borderTopLeftRadius: prominentRadius, borderTopRightRadius: prominentRadius };
    case "floating-control":
      return { ...styles.floatingControl, borderRadius: prominentRadius };
    case "navigation-bar":
    default:
      return styles.navigationBar;
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  keyboardSafe: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    alignSelf: "center",
    width: "100%",
  },
  fill: {
    flex: 1,
  },
  scrollBody: {
    flexGrow: 1,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
  },
  navigationSurface: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  navigationBar: {
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
  },
  tabBar: {
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
  },
  toolbar: {
    borderLeftWidth: 0,
    borderRightWidth: 0,
  },
  sheet: {
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
  },
  floatingControl: {},
});
