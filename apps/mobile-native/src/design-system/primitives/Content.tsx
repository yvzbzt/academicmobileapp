import { useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
  type GestureResponderEvent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { resolveElevationStyle } from "../platform";
import { usePlatformAdaptation, useTheme } from "../theme";

export type CardVariant = "outlined" | "elevated" | "tonal";

export interface CardProps extends Omit<ViewProps, "style"> {
  children: ReactNode;
  variant?: CardVariant;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  selected?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  style?: StyleProp<ViewStyle>;
}

export function Card({
  children,
  variant = "outlined",
  onPress,
  disabled = false,
  selected = false,
  busy = false,
  accessibilityLabel,
  accessibilityRole,
  style,
  ...viewProps
}: CardProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const [focused, setFocused] = useState(false);
  const backgroundColor =
    variant === "tonal"
      ? theme.colors.background.subtle
      : theme.colors.background.surface;
  const cardStyle: StyleProp<ViewStyle> = [
    styles.card,
    {
      backgroundColor,
      borderColor: selected ? theme.colors.border.focus : theme.colors.border.default,
      borderRadius: theme.radii.card,
      padding: theme.spacing.md,
    },
    variant === "elevated"
      ? resolveElevationStyle("low", adaptation.platform, theme)
      : null,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        {...viewProps}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole ?? "button"}
        accessibilityState={{ busy, disabled, selected }}
        android_ripple={
          adaptation.pressFeedback === "ripple"
            ? { color: theme.colors.state.pressed, borderless: false }
            : undefined
        }
        disabled={disabled}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onPress={onPress}
        style={({ pressed }) => [
          cardStyle,
          pressed && adaptation.pressFeedback !== "ripple"
            ? { backgroundColor: theme.colors.action.ghostPressed }
            : null,
          focused ? { borderColor: theme.colors.border.focus, borderWidth: 2 } : null,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View
      {...viewProps}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={
        busy || disabled || selected ? { busy, disabled, selected } : undefined
      }
      style={cardStyle}
    >
      {children}
    </View>
  );
}

export interface ListItemProps extends Omit<ViewProps, "style"> {
  title: string;
  supportingText?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ListItem({
  title,
  supportingText,
  leading,
  trailing,
  onPress,
  disabled = false,
  selected = false,
  accessibilityLabel,
  style,
  ...viewProps
}: ListItemProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const [focused, setFocused] = useState(false);
  const content = (
    <>
      {leading ? <View importantForAccessibility="no">{leading}</View> : null}
      <View style={[styles.listText, { gap: theme.spacing.xxs }]}>
        <Text
          style={[
            theme.typography.bodyStrong,
            {
              color: disabled ? theme.colors.text.disabled : theme.colors.text.primary,
            },
          ]}
        >
          {title}
        </Text>
        {supportingText ? (
          <Text
            style={[
              theme.typography.meta,
              {
                color: disabled
                  ? theme.colors.text.disabled
                  : theme.colors.text.secondary,
              },
            ]}
          >
            {supportingText}
          </Text>
        ) : null}
      </View>
      {trailing ? <View importantForAccessibility="no">{trailing}</View> : null}
    </>
  );
  const rowStyle: StyleProp<ViewStyle> = [
    styles.listItem,
    {
      minHeight: adaptation.minimumTouchTarget,
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      backgroundColor: selected
        ? theme.colors.state.selected
        : theme.colors.background.surface,
      borderColor: theme.colors.border.default,
    },
    style,
  ];

  if (!onPress) {
    return (
      <View {...viewProps} accessibilityLabel={accessibilityLabel} style={rowStyle}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      {...viewProps}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      android_ripple={
        adaptation.pressFeedback === "ripple"
          ? { color: theme.colors.state.pressed, borderless: false }
          : undefined
      }
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        rowStyle,
        pressed && adaptation.pressFeedback !== "ripple"
          ? { backgroundColor: theme.colors.action.ghostPressed }
          : null,
        focused ? { borderColor: theme.colors.border.focus, borderWidth: 2 } : null,
      ]}
    >
      {content}
    </Pressable>
  );
}

export interface ChipProps {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Chip({
  label,
  selected = false,
  disabled = false,
  onPress,
  accessibilityLabel,
  style,
}: ChipProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      android_ripple={
        adaptation.pressFeedback === "ripple"
          ? { color: theme.colors.state.pressed, borderless: false }
          : undefined
      }
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          minHeight: adaptation.minimumTouchTarget,
          backgroundColor: disabled
            ? theme.colors.action.disabled
            : selected
              ? theme.colors.state.selected
              : theme.colors.background.surface,
          borderColor: focused ? theme.colors.border.focus : theme.colors.border.default,
          borderRadius: theme.radii.pill,
          paddingHorizontal: theme.spacing.sm,
        },
        pressed && adaptation.pressFeedback !== "ripple"
          ? { backgroundColor: theme.colors.action.ghostPressed }
          : null,
        style,
      ]}
    >
      <Text
        style={[
          theme.typography.label,
          {
            color: disabled
              ? theme.colors.text.disabled
              : selected
                ? theme.colors.text.link
                : theme.colors.text.primary,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface SegmentedControlOption<Value extends string = string> {
  value: Value;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<Value extends string = string> {
  label: string;
  options: readonly SegmentedControlOption<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  disabled?: boolean;
  orientation?: "horizontal" | "vertical";
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<Value extends string = string>({
  label,
  options,
  value,
  onValueChange,
  disabled = false,
  orientation = "horizontal",
  style,
}: SegmentedControlProps<Value>) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const [focusedValue, setFocusedValue] = useState<Value | null>(null);

  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="radiogroup"
      style={[
        styles.segmentedControl,
        orientation === "vertical" && styles.segmentedControlVertical,
        {
          backgroundColor: theme.colors.background.subtle,
          borderColor: theme.colors.border.default,
          borderRadius: theme.radii.control,
          gap: theme.spacing.xxs,
          padding: theme.spacing.xxs,
        },
        style,
      ]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const optionDisabled = disabled || option.disabled === true;
        return (
          <Pressable
            key={option.value}
            accessibilityLabel={option.label}
            accessibilityRole="radio"
            accessibilityState={{ disabled: optionDisabled, selected }}
            disabled={optionDisabled}
            onBlur={() => setFocusedValue(null)}
            onFocus={() => setFocusedValue(option.value)}
            onPress={() => onValueChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              orientation === "vertical" && styles.segmentVertical,
              {
                minHeight: adaptation.minimumTouchTarget,
                backgroundColor: selected
                  ? theme.colors.background.surface
                  : pressed
                    ? theme.colors.action.ghostPressed
                    : theme.colors.background.subtle,
                borderColor: focusedValue === option.value
                  ? theme.colors.border.focus
                  : selected
                    ? theme.colors.border.default
                    : theme.colors.background.subtle,
                borderRadius: theme.radii.small,
                paddingHorizontal: theme.spacing.sm,
              },
            ]}
          >
            <Text
              style={[
                theme.typography.label,
                {
                  color: optionDisabled
                    ? theme.colors.text.disabled
                    : selected
                      ? theme.colors.text.primary
                      : theme.colors.text.secondary,
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
  },
  listItem: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  listText: {
    flex: 1,
  },
  chip: {
    alignItems: "center",
    borderWidth: 1,
    justifyContent: "center",
  },
  segmentedControl: {
    borderWidth: 1,
    flexDirection: "row",
  },
  segmentedControlVertical: {
    flexDirection: "column",
  },
  segment: {
    alignItems: "center",
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
  },
  segmentVertical: {
    flex: undefined,
    width: "100%",
  },
});
