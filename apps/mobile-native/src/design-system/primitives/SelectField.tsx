import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  findNodeHandle,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { usePlatformAdaptation, useTheme } from "../theme";
import { BottomSheet } from "./BottomSheet";

export interface SelectFieldOption<Value extends string = string> {
  value: Value;
  label: string;
  supportingText?: string;
  disabled?: boolean;
}

export interface SelectFieldProps<Value extends string = string> {
  label: string;
  options: readonly SelectFieldOption<Value>[];
  value: Value | null;
  onValueChange: (value: Value) => void;
  placeholder?: string;
  supportingText?: string;
  error?: string;
  sheetTitle?: string;
  sheetDescription?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  emptyLabel?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  focusOnError?: boolean;
  focusOnErrorKey?: string | number;
  onOpenChange?: (open: boolean) => void;
  inlineLabel?: boolean;
  visualLabel?: string;
  leadingAccessory?: ReactNode;
  searchLabel?: string;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchValueChange?: (value: string) => void;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A controlled selector whose modal presentation stays out of feature code. */
export function SelectField<Value extends string = string>({
  label,
  options,
  value,
  onValueChange,
  placeholder = "Seçim yapın",
  supportingText,
  error,
  sheetTitle,
  sheetDescription,
  disabled = false,
  loading = false,
  loadingLabel = "Seçenekler yükleniyor",
  emptyLabel = "Kullanılabilir seçenek yok.",
  accessibilityLabel,
  accessibilityHint,
  focusOnError = false,
  focusOnErrorKey,
  onOpenChange,
  inlineLabel = false,
  visualLabel,
  leadingAccessory,
  searchLabel,
  searchPlaceholder = "Ada göre ara",
  searchValue,
  onSearchValueChange,
  containerStyle,
  testID,
}: SelectFieldProps<Value>) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const minimumTouchTarget = Math.max(48, adaptation.minimumTouchTarget);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const triggerRef = useRef<View>(null);
  const searchInputRef = useRef<TextInput>(null);
  const optionListRef = useRef<FlatList<SelectFieldOption<Value>>>(null);
  const triggerNativeTagRef = useRef<number | null>(null);
  const restoreFocusAfterDismissRef = useRef(false);
  const generatedId = useId();
  const labelId = `${generatedId}-label`;
  const interactionDisabled = disabled || loading;
  const searchable = Boolean(onSearchValueChange);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );
  const visibleValue = selectedOption?.label ?? placeholder;
  const helpText = error ?? supportingText;

  useEffect(() => {
    if (open || !restoreFocusAfterDismissRef.current) {
      return;
    }

    const focusTimer = setTimeout(() => {
      restoreFocusAfterDismissRef.current = false;
      try {
        const trigger = triggerRef.current;
        const reactTag = triggerNativeTagRef.current
          ?? (trigger ? findNodeHandle(trigger) : null);
        if (typeof reactTag !== "number") {
          return;
        }

        AccessibilityInfo.setAccessibilityFocus(reactTag);
      } catch {
        // The opener may have unmounted while the native modal was closing.
      }
    }, 0);

    return () => clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!focusOnError) return;
    const focusTimer = setTimeout(() => {
      const trigger = triggerRef.current;
      const reactTag = triggerNativeTagRef.current
        ?? (trigger ? findNodeHandle(trigger) : null);
      if (typeof reactTag === "number") {
        AccessibilityInfo.setAccessibilityFocus(reactTag);
      }
    }, 0);
    return () => clearTimeout(focusTimer);
  }, [focusOnError, focusOnErrorKey]);

  useEffect(() => {
    if (!open || !searchable) return;
    const focusTimer = setTimeout(() => {
      searchInputRef.current?.focus();
      optionListRef.current?.scrollToOffset({ animated: false, offset: 0 });
    }, Platform.OS === "android" ? 180 : 80);
    return () => clearTimeout(focusTimer);
  }, [open, options, searchable]);

  function updateOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  function openOptions(event: GestureResponderEvent) {
    if (!interactionDisabled) {
      const nativeTarget = event.nativeEvent.target;
      if (typeof nativeTarget === "number") {
        triggerNativeTagRef.current = nativeTarget;
      }
      updateOpen(true);
    }
  }

  function dismissOptions() {
    restoreFocusAfterDismissRef.current = true;
    updateOpen(false);
  }

  function selectOption(option: SelectFieldOption<Value>) {
    if (option.disabled) {
      return;
    }

    if (option.value !== value) {
      onValueChange(option.value);
    }
    dismissOptions();
  }

  return (
    <View style={[styles.container, { gap: theme.spacing.xxs }, containerStyle]}>
      <Text
        nativeID={labelId}
        style={[
          theme.typography.label,
          { color: theme.colors.text.primary },
          inlineLabel && styles.visuallyHidden,
        ]}
      >
        {label}
      </Text>
      <Pressable
        ref={triggerRef}
        aria-invalid={error ? true : undefined}
        accessibilityHint={accessibilityHint ?? helpText}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityLabelledBy={labelId}
        accessibilityRole="combobox"
        accessibilityState={{
          busy: loading,
          disabled: interactionDisabled,
          expanded: open,
        }}
        accessibilityValue={{ text: visibleValue }}
        android_ripple={
          adaptation.pressFeedback === "ripple"
            ? { color: theme.colors.state.pressed, borderless: false }
            : undefined
        }
        disabled={interactionDisabled}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onLayout={(event) => {
          const nativeTarget = Number(event.target);
          if (Number.isFinite(nativeTarget) && nativeTarget > 0) {
            triggerNativeTagRef.current = nativeTarget;
          }
        }}
        onPress={openOptions}
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: interactionDisabled
              ? theme.colors.action.disabled
              : pressed && adaptation.pressFeedback !== "ripple"
                ? theme.colors.action.ghostPressed
                : theme.colors.background.surface,
            borderColor: error
              ? theme.colors.status.error
              : focused
                ? theme.colors.border.focus
                : theme.colors.border.default,
            borderRadius: theme.radii.card,
            gap: theme.spacing.sm,
            minHeight: minimumTouchTarget,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.xs,
          },
        ]}
        testID={testID}
      >
        {leadingAccessory ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.leadingAccessory}
          >
            {leadingAccessory}
          </View>
        ) : null}
        <View style={styles.valueCopy}>
          {inlineLabel ? (
            <Text style={[theme.typography.label, { color: theme.colors.text.primary }]}>
              {visualLabel ?? label}
            </Text>
          ) : null}
          <Text
            style={[
              theme.typography.body,
              styles.value,
              {
                color: interactionDisabled
                  ? theme.colors.text.disabled
                  : selectedOption
                    ? theme.colors.text.primary
                    : theme.colors.text.secondary,
              },
            ]}
          >
            {loading ? loadingLabel : visibleValue}
          </Text>
        </View>
        {loading ? (
          <ActivityIndicator
            accessibilityElementsHidden
            color={theme.colors.text.disabled}
            importantForAccessibility="no-hide-descendants"
            size="small"
          />
        ) : (
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              theme.typography.bodyStrong,
              {
                color: interactionDisabled
                  ? theme.colors.text.disabled
                  : theme.colors.text.secondary,
              },
            ]}
          >
            {open ? "⌃" : "⌄"}
          </Text>
        )}
      </Pressable>
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
      {open ? (
        <BottomSheet
          accessibilityLabel={`${label} seçenekleri`}
          dismissAccessibilityLabel={`${label} seçeneklerini kapat`}
          onDismiss={dismissOptions}
          title={sheetTitle ?? label}
          description={sheetDescription}
          visible
        >
        {onSearchValueChange ? (
          <View
            style={[
              styles.sheetSearchFrame,
              {
                backgroundColor: theme.colors.background.surface,
                borderColor: theme.colors.border.default,
                borderRadius: theme.radii.card,
                marginBottom: theme.spacing.sm,
                paddingHorizontal: theme.spacing.sm,
              },
            ]}
          >
            <TextInput
              accessibilityLabel={searchLabel ?? `${label} ara`}
              accessibilityRole="search"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              blurOnSubmit={false}
              onChangeText={onSearchValueChange}
              placeholder={searchPlaceholder}
              placeholderTextColor={theme.colors.text.disabled}
              returnKeyType="search"
              ref={searchInputRef}
              selectionColor={theme.colors.action.focus}
              style={[
                theme.typography.body,
                styles.sheetSearchInput,
                { color: theme.colors.text.primary },
              ]}
              value={searchValue ?? ""}
            />
          </View>
        ) : null}
        <FlatList
          ref={optionListRef}
          accessibilityLabel={`${label} seçenek listesi`}
          accessibilityRole="radiogroup"
          contentContainerStyle={[
            styles.options,
            { gap: theme.spacing.xxs },
          ]}
          data={options}
          initialNumToRender={12}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="always"
          keyExtractor={(option) => option.value}
          ListEmptyComponent={(
            <Text
              accessibilityRole="summary"
              style={[theme.typography.body, { color: theme.colors.text.secondary }]}
            >
              {emptyLabel}
            </Text>
          )}
          maxToRenderPerBatch={12}
          renderItem={({ item: option }) => {
              const selected = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityHint={option.supportingText}
                  accessibilityLabel={option.label}
                  accessibilityRole="radio"
                  accessibilityState={{ disabled: option.disabled, selected }}
                  disabled={option.disabled}
                  onPress={() => selectOption(option)}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: option.disabled
                        ? theme.colors.action.disabled
                        : selected
                          ? theme.colors.state.selected
                          : pressed
                            ? theme.colors.action.ghostPressed
                            : theme.colors.background.surface,
                      borderColor: selected
                        ? theme.colors.border.focus
                        : theme.colors.border.default,
                      borderRadius: theme.radii.card,
                      gap: theme.spacing.xxs,
                      minHeight: minimumTouchTarget,
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.sm,
                    },
                  ]}
                >
                  <View style={styles.optionCopy}>
                    <Text
                      style={[
                        theme.typography.bodyStrong,
                        {
                          color: option.disabled
                            ? theme.colors.text.disabled
                            : theme.colors.text.primary,
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                    {option.supportingText ? (
                      <Text
                        style={[
                          theme.typography.meta,
                          {
                            color: option.disabled
                              ? theme.colors.text.disabled
                              : theme.colors.text.secondary,
                          },
                        ]}
                      >
                        {option.supportingText}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? (
                    <Text
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      style={[
                        theme.typography.bodyStrong,
                        { color: theme.colors.text.link },
                      ]}
                    >
                      ✓
                    </Text>
                  ) : null}
                </Pressable>
              );
          }}
          style={styles.optionList}
          windowSize={7}
        />
        </BottomSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  field: {
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
  },
  value: {
    minWidth: 0,
  },
  valueCopy: {
    flex: 1,
    minWidth: 0,
  },
  leadingAccessory: {
    alignItems: "center",
    justifyContent: "center",
  },
  sheetSearchFrame: {
    borderWidth: 1,
    flexShrink: 0,
  },
  sheetSearchInput: {
    minHeight: 48,
    paddingVertical: 8,
  },
  options: {
    paddingBottom: 1,
  },
  optionList: {
    flexShrink: 1,
    maxHeight: 420,
    minHeight: 0,
  },
  option: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
  },
  visuallyHidden: {
    height: 1,
    opacity: 0,
    position: "absolute",
    width: 1,
  },
});
