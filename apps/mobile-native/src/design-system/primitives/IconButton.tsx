import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { usePlatformAdaptation, useTheme } from "../theme";

export interface IconButtonProps
  extends Omit<PressableProps, "children" | "style" | "disabled" | "accessibilityState"> {
  icon: ReactNode;
  accessibilityLabel: string;
  selected?: boolean;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon,
  accessibilityLabel,
  selected = false,
  loading = false,
  disabled = false,
  destructive = false,
  style,
  onFocus,
  onBlur,
  ...pressableProps
}: IconButtonProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const [focused, setFocused] = useState(false);
  const interactionDisabled = disabled || loading;
  const foreground = interactionDisabled
    ? theme.colors.action.onDisabled
    : destructive
      ? theme.colors.status.error
      : theme.colors.text.primary;
  const background = interactionDisabled
    ? theme.colors.action.disabled
    : selected
      ? theme.colors.state.selected
      : theme.colors.background.surface;

  return (
    <Pressable
      {...pressableProps}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{
        disabled: interactionDisabled,
        busy: loading,
        selected,
      }}
      android_ripple={
        adaptation.pressFeedback === "ripple"
          ? { color: theme.colors.state.pressed, borderless: true }
          : undefined
      }
      disabled={interactionDisabled}
      focusable={!interactionDisabled}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      style={({ pressed }) => [
        styles.iconButton,
        {
          minHeight: adaptation.minimumTouchTarget,
          minWidth: adaptation.minimumTouchTarget,
          backgroundColor:
            pressed && adaptation.pressFeedback !== "ripple"
              ? theme.colors.action.ghostPressed
              : background,
          borderColor: focused ? theme.colors.border.focus : theme.colors.border.default,
          borderRadius: theme.radii.pill,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        icon
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    alignItems: "center",
    borderWidth: 1,
    justifyContent: "center",
  },
});
