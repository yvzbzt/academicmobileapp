import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Platform,
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
import { Ionicons } from "@expo/vector-icons";
import { usePlatformAdaptation, useTheme } from "../theme";

export interface TextFieldProps
  extends Omit<TextInputProps, "style" | "editable"> {
  label: string;
  supportingText?: string;
  error?: string;
  disabled?: boolean;
  leadingAccessory?: ReactNode;
  trailingAccessory?: ReactNode;
  /** Keeps the programmatic label while removing duplicate visible copy in compact compositions. */
  labelVisuallyHidden?: boolean;
  /** Places the label and input copy together inside one list-style row. */
  inlineLabel?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  frameStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField({
  label,
  supportingText,
  error,
  disabled = false,
  leadingAccessory,
  trailingAccessory,
  labelVisuallyHidden = false,
  inlineLabel = false,
  containerStyle,
  frameStyle,
  inputStyle,
  accessibilityLabel,
  accessibilityHint,
  onFocus,
  onBlur,
  ...textInputProps
}, inputRef) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const minimumTouchTarget = Math.max(48, adaptation.minimumTouchTarget);
  const [focused, setFocused] = useState(false);
  const generatedId = useId();
  const labelId = `${generatedId}-label`;
  const errorId = `${generatedId}-error`;
  const helpText = error ?? supportingText;
  const automaticLeadingIcon = textInputProps.textContentType === "emailAddress"
    || textInputProps.keyboardType === "email-address"
    ? "mail-outline"
    : textInputProps.textContentType === "password"
      || textInputProps.textContentType === "newPassword"
      ? "lock-closed-outline"
      : textInputProps.textContentType === "name"
        ? "person-outline"
        : textInputProps.textContentType === "oneTimeCode"
          || textInputProps.keyboardType === "number-pad"
          ? "shield-checkmark-outline"
          : null;
  const resolvedLeadingAccessory = leadingAccessory ?? (automaticLeadingIcon ? (
    <Ionicons
      color={theme.colors.text.secondary}
      name={automaticLeadingIcon}
      size={20}
    />
  ) : null);
  const borderColor = error
    ? theme.colors.status.error
    : focused
      ? theme.colors.border.focus
      : theme.colors.border.default;
  const labelElement = (
    <Text
      nativeID={labelId}
      style={[
        theme.typography.label,
        { color: theme.colors.text.primary },
        labelVisuallyHidden && styles.visuallyHidden,
      ]}
    >
      {label}
    </Text>
  );
  const inputElement = (
    <TextInput
      {...textInputProps}
      ref={inputRef}
      accessibilityHint={accessibilityHint ?? helpText}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityLabelledBy={labelId}
      aria-errormessage={error ? errorId : undefined}
      aria-invalid={error ? true : undefined}
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
          minHeight: minimumTouchTarget - 4,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
        },
        inlineLabel && styles.inlineInput,
        inputStyle,
      ]}
    />
  );

  return (
    <View style={[styles.container, { gap: theme.spacing.xxs }, containerStyle]}>
      {!inlineLabel ? labelElement : null}
      <View
        style={[
          styles.inputFrame,
          {
            minHeight: minimumTouchTarget,
            backgroundColor: disabled
              ? theme.colors.action.disabled
              : theme.colors.background.surface,
            borderColor,
            borderRadius: theme.radii.card,
          },
          frameStyle,
        ]}
      >
        {resolvedLeadingAccessory ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.leadingAccessory, { paddingLeft: theme.spacing.sm }]}
          >
            {resolvedLeadingAccessory}
          </View>
        ) : null}
        {inlineLabel ? (
          <View style={[styles.inlineCopy, { paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs }]}>
            {labelElement}
            {inputElement}
          </View>
        ) : inputElement}
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
          nativeID={error ? errorId : undefined}
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
});

export interface PasswordFieldProps
  extends Omit<TextFieldProps, "secureTextEntry" | "trailingAccessory"> {
  initiallyRevealed?: boolean;
  revealed?: boolean;
  showPasswordLabel?: string;
  hidePasswordLabel?: string;
  onVisibilityChange?: (revealed: boolean) => void;
}

export const PasswordField = forwardRef<TextInput, PasswordFieldProps>(function PasswordField({
  initiallyRevealed = false,
  revealed: controlledRevealed,
  showPasswordLabel = "Şifreyi göster",
  hidePasswordLabel = "Şifreyi gizle",
  onVisibilityChange,
  ...textFieldProps
}, inputRef) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const minimumTouchTarget = Math.max(48, adaptation.minimumTouchTarget);
  const [uncontrolledRevealed, setUncontrolledRevealed] = useState(initiallyRevealed);
  const [actionFocused, setActionFocused] = useState(false);
  const revealed = controlledRevealed ?? uncontrolledRevealed;
  const actionLabel = revealed ? hidePasswordLabel : showPasswordLabel;
  const keyboardType = textFieldProps.keyboardType
    ?? (Platform.OS === "android" && revealed ? "visible-password" : undefined);
  const nativeInputRef = useRef<TextInput | null>(null);
  const inputIsFocusedRef = useRef(false);
  const previousRevealedRef = useRef(revealed);
  const reconnectPhaseRef = useRef<"idle" | "scheduled" | "blurring" | "focusing">("idle");
  const blurFrameRef = useRef<number | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const settleFrameRef = useRef<number | null>(null);

  const cancelFocusReconnect = useCallback(() => {
    if (blurFrameRef.current !== null) {
      cancelAnimationFrame(blurFrameRef.current);
      blurFrameRef.current = null;
    }
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
    if (settleFrameRef.current !== null) {
      cancelAnimationFrame(settleFrameRef.current);
      settleFrameRef.current = null;
    }
    reconnectPhaseRef.current = "idle";
  }, []);

  const setInputRef = useCallback((node: TextInput | null) => {
    nativeInputRef.current = node;
    if (typeof inputRef === "function") {
      inputRef(node);
    } else if (inputRef) {
      inputRef.current = node;
    }
  }, [inputRef]);

  useEffect(() => {
    const visibilityChanged = previousRevealedRef.current !== revealed;
    previousRevealedRef.current = revealed;

    if (
      Platform.OS !== "android"
      || !visibilityChanged
      || !inputIsFocusedRef.current
      || !nativeInputRef.current?.isFocused()
    ) {
      return undefined;
    }

    // Android drops the active IME connection when secureTextEntry changes even
    // though the native input still reports itself as focused. Reconnect only an
    // input that was already focused; an idle password field must stay idle.
    cancelFocusReconnect();
    reconnectPhaseRef.current = "scheduled";
    blurFrameRef.current = requestAnimationFrame(() => {
      blurFrameRef.current = null;
      const input = nativeInputRef.current;
      if (!input || !inputIsFocusedRef.current || !input.isFocused()) {
        reconnectPhaseRef.current = "idle";
        return;
      }

      reconnectPhaseRef.current = "blurring";
      input.blur();
      focusFrameRef.current = requestAnimationFrame(() => {
        focusFrameRef.current = null;
        const currentInput = nativeInputRef.current;
        const focusedInput = TextInput.State.currentlyFocusedInput();
        if (!currentInput || (focusedInput && focusedInput !== currentInput)) {
          inputIsFocusedRef.current = false;
          reconnectPhaseRef.current = "idle";
          return;
        }

        reconnectPhaseRef.current = "focusing";
        currentInput.focus();
        settleFrameRef.current = requestAnimationFrame(() => {
          settleFrameRef.current = null;
          reconnectPhaseRef.current = "idle";
        });
      });
    });

    return cancelFocusReconnect;
  }, [cancelFocusReconnect, revealed]);

  useEffect(() => cancelFocusReconnect, [cancelFocusReconnect]);

  return (
    <TextField
      {...textFieldProps}
      ref={setInputRef}
      autoCapitalize={textFieldProps.autoCapitalize ?? "none"}
      autoCorrect={textFieldProps.autoCorrect ?? false}
      onBlur={(event) => {
        if (reconnectPhaseRef.current === "blurring") {
          return;
        }
        inputIsFocusedRef.current = false;
        cancelFocusReconnect();
        textFieldProps.onBlur?.(event);
      }}
      onFocus={(event) => {
        inputIsFocusedRef.current = true;
        if (reconnectPhaseRef.current === "focusing") {
          reconnectPhaseRef.current = "idle";
          if (settleFrameRef.current !== null) {
            cancelAnimationFrame(settleFrameRef.current);
            settleFrameRef.current = null;
          }
          return;
        }
        textFieldProps.onFocus?.(event);
      }}
      secureTextEntry={!revealed}
      textContentType={textFieldProps.textContentType ?? "password"}
      keyboardType={keyboardType}
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
            if (controlledRevealed === undefined) {
              setUncontrolledRevealed(nextValue);
            }
            onVisibilityChange?.(nextValue);
          }}
          style={({ pressed }) => [
            styles.fieldAction,
            {
              minHeight: minimumTouchTarget,
              minWidth: minimumTouchTarget,
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
          <Ionicons
            accessibilityElementsHidden
            color={theme.colors.text.secondary}
            importantForAccessibility="no-hide-descendants"
            name={revealed ? "eye-off-outline" : "eye-outline"}
            size={23}
          />
        </Pressable>
      }
    />
  );
});

export interface SearchFieldProps
  extends Omit<TextFieldProps, "leadingAccessory" | "trailingAccessory"> {
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
  const minimumTouchTarget = Math.max(48, adaptation.minimumTouchTarget);
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
      leadingAccessory={
        <Ionicons color={theme.colors.text.secondary} name="search-outline" size={20} />
      }
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
                minHeight: minimumTouchTarget,
                minWidth: minimumTouchTarget,
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
  inlineCopy: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
  },
  inlineInput: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  trailingAccessory: {
    alignItems: "center",
    justifyContent: "center",
  },
  leadingAccessory: {
    alignItems: "center",
    justifyContent: "center",
  },
  fieldAction: {
    alignItems: "center",
    borderWidth: 0,
    justifyContent: "center",
  },
  visuallyHidden: {
    height: 1,
    opacity: 0,
    position: "absolute",
    width: 1,
  },
});
