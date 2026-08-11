import { forwardRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type View as NativeView,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { usePlatformAdaptation, useTheme } from "../theme";
import type { SemanticTheme } from "../tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonStatus = "idle" | "success" | "error";

export interface ButtonProps
  extends Omit<PressableProps, "children" | "style" | "disabled" | "accessibilityState"> {
  label: string;
  variant?: ButtonVariant;
  status?: ButtonStatus;
  statusLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  compact?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

interface ButtonPalette {
  background: string;
  foreground: string;
  border: string;
  pressedBackground: string;
}

function resolveButtonPalette(
  theme: SemanticTheme,
  variant: ButtonVariant,
  status: ButtonStatus,
  disabled: boolean,
): ButtonPalette {
  if (disabled) {
    return {
      background: theme.colors.action.disabled,
      foreground: theme.colors.action.onDisabled,
      border: theme.colors.border.default,
      pressedBackground: theme.colors.action.disabled,
    };
  }

  if (status === "success") {
    return {
      background: theme.colors.status.success,
      foreground: theme.colors.text.inverse,
      border: theme.colors.status.success,
      pressedBackground: theme.colors.status.success,
    };
  }

  if (status === "error" || variant === "danger") {
    return {
      background: theme.colors.status.error,
      foreground: theme.colors.status.onError,
      border: theme.colors.status.error,
      pressedBackground: theme.colors.status.errorPressed,
    };
  }

  if (variant === "secondary") {
    return {
      background: theme.colors.action.secondary,
      foreground: theme.colors.text.link,
      border: theme.colors.border.default,
      pressedBackground: theme.colors.action.secondaryPressed,
    };
  }

  if (variant === "ghost") {
    return {
      background: "transparent",
      foreground: theme.colors.text.link,
      border: "transparent",
      pressedBackground: theme.colors.action.ghostPressed,
    };
  }

  return {
    background: theme.colors.action.primary,
    foreground: theme.colors.action.onPrimary,
    border: theme.colors.action.primary,
    pressedBackground: theme.colors.action.primaryPressed,
  };
}

export const Button = forwardRef<NativeView, ButtonProps>(function Button({
  label,
  variant = "primary",
  status = "idle",
  statusLabel,
  loading = false,
  disabled = false,
  fullWidth = false,
  compact = false,
  leadingIcon,
  trailingIcon,
  style,
  labelStyle,
  accessibilityLabel,
  onFocus,
  onBlur,
  onPressIn,
  onPressOut,
  ...pressableProps
}: ButtonProps, ref) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const [focused, setFocused] = useState(false);
  const [pressedByEvent, setPressedByEvent] = useState(false);
  const interactionDisabled = disabled || loading;
  const palette = resolveButtonPalette(theme, variant, status, interactionDisabled);
  const visibleLabel = status === "idle" ? label : (statusLabel ?? label);
  const minimumHeight = compact
    ? Math.max(48, adaptation.minimumTouchTarget)
    : Math.max(adaptation.minimumTouchTarget, 52);

  return (
    <Pressable
      {...pressableProps}
      // Android's native ripple drawable can retain the previous mode's
      // background. Remount the native control so foreground/background
      // tokens always change as one contrast-safe pair.
      key={theme.mode}
      ref={ref}
      accessibilityLabel={accessibilityLabel ?? visibleLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: interactionDisabled, busy: loading }}
      android_ripple={
        adaptation.pressFeedback === "ripple"
          ? { color: theme.colors.state.pressed, borderless: false }
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
      onPressIn={(event) => {
        setPressedByEvent(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressedByEvent(false);
        onPressOut?.(event);
      }}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: minimumHeight,
          backgroundColor:
            pressed || pressedByEvent ? palette.pressedBackground : palette.background,
          borderColor: focused ? theme.colors.border.focus : palette.border,
          borderRadius: theme.radii.pill,
          paddingHorizontal: compact ? theme.spacing.sm : theme.spacing.lg,
        },
        fullWidth && styles.fullWidth,
        (pressed || pressedByEvent) &&
          adaptation.pressFeedback !== "ripple" &&
          styles.pressed,
        style,
      ]}
    >
      <View style={styles.labelFrame}>
        {leadingIcon && !loading ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {leadingIcon}
          </View>
        ) : null}
        <Text
          allowFontScaling
          style={[
            theme.typography.bodyStrong,
            styles.label,
            { color: palette.foreground },
            loading && styles.hiddenLabel,
            labelStyle,
          ]}
        >
          {visibleLabel}
        </Text>
        {trailingIcon && !loading ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {trailingIcon}
          </View>
        ) : null}
        {loading ? (
          <ActivityIndicator
            accessibilityElementsHidden
            color={palette.foreground}
            importantForAccessibility="no-hide-descendants"
            style={styles.spinner}
          />
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderWidth: 1,
    justifyContent: "center",
  },
  fullWidth: {
    alignSelf: "stretch",
  },
  pressed: {
    transform: [{ scale: 0.99 }],
  },
  labelFrame: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 8,
    maxWidth: "100%",
    justifyContent: "center",
    minWidth: 24,
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
    textAlign: "center",
  },
  hiddenLabel: {
    opacity: 0,
  },
  spinner: {
    position: "absolute",
  },
});
