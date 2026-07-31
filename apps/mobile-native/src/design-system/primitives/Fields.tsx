import { useId, useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { usePlatformAdaptation, useTheme } from "../theme";

export interface TextFieldProps
  extends Omit<TextInputProps, "style" | "editable"> {
  label: string;
  supportingText?: string;
  error?: string;
  disabled?: boolean;
  trailingAccessory?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

export function TextField({
  label,
  supportingText,
  error,
  disabled = false,
  trailingAccessory,
  containerStyle,
  inputStyle,
  accessibilityLabel,
  accessibilityHint,
  onFocus,
  onBlur,
  ...textInputProps
}: TextFieldProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const [focused, setFocused] = useState(false);
  const generatedId = useId();
  const labelId = `${generatedId}-label`;
  const helpText = error ?? supportingText;
  const borderColor = error
    ? theme.colors.status.error
    : focused
      ? theme.colors.border.focus
      : theme.colors.border.default;

  return (
    <View style={[styles.container, { gap: theme.spacing.xxs }, containerStyle]}>
      <Text
        nativeID={labelId}
        style={[theme.typography.label, { color: theme.colors.text.primary }]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.inputFrame,
          {
            minHeight: adaptation.minimumTouchTarget,
            backgroundColor: disabled
              ? theme.colors.action.disabled
              : theme.colors.background.surface,
            borderColor,
            borderRadius: theme.radii.control,
          },
        ]}
      >
        <TextInput
          {...textInputProps}
          accessibilityHint={accessibilityHint ?? helpText}
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityLabelledBy={labelId}
          editable={!disabled}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          placeholderTextColor={theme.colors.text.disabled}
          selectionColor={theme.colors.action.focus}
          style={[
            styles.input,
            theme.typography.body,
            {
              color: disabled
                ? theme.colors.text.disabled
                : theme.colors.text.primary,
              minHeight: adaptation.minimumTouchTarget - 4,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: theme.spacing.xs,
            },
            inputStyle,
          ]}
        />
        {trailingAccessory ? (
          <View
            style={[styles.trailingAccessory, { paddingRight: theme.spacing.xxs }]}
          >
            {trailingAccessory}
          </View>
        ) : null}
      </View>
      {helpText ? (
        <Text
          accessibilityLiveRegion={error ? "polite" : "none"}
          accessibilityRole={error ? "alert" : undefined}
          style={[
            theme.typography.meta,
            {
              color: error ? theme.colors.status.error : theme.colors.text.secondary,
            },
          ]}
        >
          {helpText}
        </Text>
      ) : null}
    </View>
  );
}

export interface PasswordFieldProps
  extends Omit<TextFieldProps, "secureTextEntry" | "trailingAccessory"> {
  initiallyRevealed?: boolean;
  showPasswordLabel?: string;
  hidePasswordLabel?: string;
  onVisibilityChange?: (revealed: boolean) => void;
}

export function PasswordField({
  initiallyRevealed = false,
  showPasswordLabel = "Şifreyi göster",
  hidePasswordLabel = "Şifreyi gizle",
  onVisibilityChange,
  ...textFieldProps
}: PasswordFieldProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const [revealed, setRevealed] = useState(initiallyRevealed);
  const [actionFocused, setActionFocused] = useState(false);
  const actionLabel = revealed ? hidePasswordLabel : showPasswordLabel;

  return (
    <TextField
      {...textFieldProps}
      autoCapitalize={textFieldProps.autoCapitalize ?? "none"}
      autoCorrect={textFieldProps.autoCorrect ?? false}
      secureTextEntry={!revealed}
      textContentType={textFieldProps.textContentType ?? "password"}
      trailingAccessory={
        <Pressable
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: textFieldProps.disabled }}
          disabled={textFieldProps.disabled}
          hitSlop={theme.spacing.xs}
          onBlur={() => setActionFocused(false)}
          onFocus={() => setActionFocused(true)}
          onPress={() => {
            const nextValue = !revealed;
            setRevealed(nextValue);
            onVisibilityChange?.(nextValue);
          }}
          style={({ pressed }) => [
            styles.fieldAction,
            {
              minHeight: adaptation.minimumTouchTarget,
              minWidth: adaptation.minimumTouchTarget,
              backgroundColor: pressed
                ? theme.colors.action.ghostPressed
                : theme.colors.background.surface,
              borderColor: actionFocused
                ? theme.colors.border.focus
                : theme.colors.background.surface,
              borderRadius: theme.radii.control,
            },
          ]}
        >
          <Text style={[theme.typography.metaStrong, { color: theme.colors.text.link }]}>
            {revealed ? "Gizle" : "Göster"}
          </Text>
        </Pressable>
      }
    />
  );
}

export interface SearchFieldProps
  extends Omit<TextFieldProps, "trailingAccessory"> {
  onClear?: () => void;
  clearAccessibilityLabel?: string;
}

export function SearchField({
  value,
  onChangeText,
  onClear,
  clearAccessibilityLabel = "Aramayı temizle",
  ...textFieldProps
}: SearchFieldProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const hasValue = typeof value === "string" && value.length > 0;
  const [actionFocused, setActionFocused] = useState(false);

  return (
    <TextField
      {...textFieldProps}
      accessibilityRole="search"
      autoCapitalize={textFieldProps.autoCapitalize ?? "none"}
      autoCorrect={textFieldProps.autoCorrect ?? false}
      onChangeText={onChangeText}
      returnKeyType={textFieldProps.returnKeyType ?? "search"}
      value={value}
      trailingAccessory={
        hasValue ? (
          <Pressable
            accessibilityLabel={clearAccessibilityLabel}
            accessibilityRole="button"
            hitSlop={theme.spacing.xs}
            onBlur={() => setActionFocused(false)}
            onFocus={() => setActionFocused(true)}
            onPress={() => {
              onChangeText?.("");
              onClear?.();
            }}
            style={({ pressed }) => [
              styles.fieldAction,
              {
                minHeight: adaptation.minimumTouchTarget,
                minWidth: adaptation.minimumTouchTarget,
                backgroundColor: pressed
                  ? theme.colors.action.ghostPressed
                  : theme.colors.background.surface,
                borderColor: actionFocused
                  ? theme.colors.border.focus
                  : theme.colors.background.surface,
                borderRadius: theme.radii.pill,
              },
            ]}
          >
            <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.secondary }]}>
              ×
            </Text>
          </Pressable>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  inputFrame: {
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
  },
  input: {
    flex: 1,
    minWidth: 0,
  },
  trailingAccessory: {
    alignItems: "center",
    justifyContent: "center",
  },
  fieldAction: {
    alignItems: "center",
    borderWidth: 1,
    justifyContent: "center",
  },
});
