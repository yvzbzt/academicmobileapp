import { DarkTheme, DefaultTheme } from "@react-navigation/native";
import type { SemanticTheme } from "../design-system";

export function resolveNavigationTheme(
  theme: SemanticTheme,
): typeof DefaultTheme {
  const baseTheme = theme.isDark ? DarkTheme : DefaultTheme;

  return {
    ...baseTheme,
    dark: theme.isDark,
    colors: {
      primary: theme.colors.action.primary,
      background: theme.colors.background.canvas,
      card: theme.colors.background.surfaceRaised,
      text: theme.colors.text.primary,
      border: theme.colors.border.subtle,
      notification: theme.colors.status.error,
    },
  };
}
