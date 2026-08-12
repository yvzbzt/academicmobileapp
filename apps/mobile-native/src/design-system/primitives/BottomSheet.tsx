import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  type Text as NativeText,
  type View as NativeView,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { resolveElevationStyle } from "../platform";
import {
  usePlatformAdaptation,
  useReducedMotion,
  useTheme,
} from "../theme";

export interface BottomSheetProps {
  visible: boolean;
  title: string;
  children: ReactNode;
  onDismiss: () => void;
  description?: string;
  accessibilityLabel?: string;
  dismissAccessibilityLabel?: string;
  backdropAccessibilityLabel?: string;
  loadingLabel?: string;
  dismissible?: boolean;
  loading?: boolean;
  scrollable?: boolean;
  returnFocusRef?: RefObject<NativeView | null>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Centers the title and places the dismiss control on the leading edge. */
  headerLayout?: "default" | "centered-leading-dismiss";
}

/**
 * An intentionally small modal-sheet boundary. Feature screens own their
 * content and state; this primitive owns modal semantics, safe-area placement,
 * platform material, and the complete dismiss contract.
 */
export function BottomSheet({
  visible,
  title,
  children,
  onDismiss,
  description,
  accessibilityLabel,
  dismissAccessibilityLabel = "Alt sayfayı kapat",
  backdropAccessibilityLabel = "Alt sayfanın dışına dokunarak kapat",
  loadingLabel = "İşlem sürüyor",
  dismissible = true,
  loading = false,
  scrollable = false,
  returnFocusRef,
  style,
  testID = "bottom-sheet",
  headerLayout = "default",
}: BottomSheetProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const minimumTouchTarget = Math.max(48, adaptation.minimumTouchTarget);
  const reducedMotion = useReducedMotion();
  const headingRef = useRef<NativeText | null>(null);
  const wasVisibleRef = useRef(visible);
  const mayDismiss = dismissible && !loading;
  const handleDismiss = useCallback(() => {
    if (mayDismiss) {
      onDismiss();
    }
  }, [mayDismiss, onDismiss]);
  const isWide = adaptation.navigationLayout === "navigation-rail";

  useEffect(() => {
    if (!visible) return;
    const focusTimer = setTimeout(() => {
      const target = findNodeHandle(headingRef.current);
      if (target) AccessibilityInfo.setAccessibilityFocus(target);
    }, 100);
    return () => clearTimeout(focusTimer);
  }, [visible]);

  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (!wasVisible || visible || !returnFocusRef) return;
    const focusTimer = setTimeout(() => {
      const target = findNodeHandle(returnFocusRef.current);
      if (target) AccessibilityInfo.setAccessibilityFocus(target);
    }, 0);
    return () => clearTimeout(focusTimer);
  }, [returnFocusRef, visible]);

  return (
    <Modal
      animationType={
        reducedMotion ? "none" : adaptation.platform === "ios" ? "slide" : "fade"
      }
      hardwareAccelerated={adaptation.platform === "android"}
      onRequestClose={handleDismiss}
      presentationStyle="overFullScreen"
      statusBarTranslucent={adaptation.platform === "android"}
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel={backdropAccessibilityLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: !mayDismiss }}
          disabled={!mayDismiss}
          onPress={handleDismiss}
          style={[styles.backdrop, { backgroundColor: theme.colors.state.scrim }]}
          testID={`${testID}-backdrop`}
        />
        <KeyboardAwareSheetViewport>
          <SafeAreaView
            edges={["left", "right", "bottom"]}
            pointerEvents="box-none"
            style={styles.safeArea}
          >
            <View
            accessibilityLabel={accessibilityLabel ?? title}
            accessibilityState={{ busy: loading }}
            accessibilityViewIsModal
            importantForAccessibility="yes"
            onAccessibilityEscape={handleDismiss}
            role="dialog"
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.background.surfaceRaised,
                borderColor: theme.colors.border.subtle,
                borderTopLeftRadius: theme.radii.prominent,
                borderTopRightRadius: theme.radii.prominent,
                gap: theme.spacing.md,
                maxWidth: isWide ? theme.readableWidths.form : theme.readableWidths.content,
                paddingBottom: theme.spacing.md,
                paddingHorizontal: adaptation.screenGutter,
                paddingTop: theme.spacing.xs,
                ...resolveElevationStyle("high", adaptation.platform, theme),
              },
              style,
            ]}
            testID={testID}
          >
            {adaptation.platform === "ios" ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.grabber,
                  {
                    backgroundColor: theme.colors.border.strong,
                    borderRadius: theme.radii.pill,
                  },
                ]}
                testID={`${testID}-grabber`}
              />
            ) : null}
            <View style={[
              styles.header,
              headerLayout === "centered-leading-dismiss" && styles.centeredHeader,
              { gap: theme.spacing.sm },
            ]}>
              {headerLayout === "centered-leading-dismiss" ? (
                <DismissControl
                  disabled={!mayDismiss}
                  label={dismissAccessibilityLabel}
                  minimumTouchTarget={minimumTouchTarget}
                  onPress={handleDismiss}
                />
              ) : null}
              <View style={[
                styles.heading,
                headerLayout === "centered-leading-dismiss" && styles.centeredHeading,
                { gap: theme.spacing.xxs },
              ]}>
                <Text
                  accessibilityRole="header"
                  ref={headingRef}
                  style={[
                    theme.typography.sectionTitle,
                    headerLayout === "centered-leading-dismiss" && styles.centeredHeadingText,
                    { color: theme.colors.text.primary },
                  ]}
                >
                  {title}
                </Text>
                {description ? (
                  <Text
                    style={[
                      theme.typography.body,
                      { color: theme.colors.text.secondary },
                    ]}
                  >
                    {description}
                  </Text>
                ) : null}
              </View>
              {headerLayout === "centered-leading-dismiss" ? (
                <View accessibilityElementsHidden style={{ minHeight: minimumTouchTarget, minWidth: minimumTouchTarget }} />
              ) : (
                <DismissControl
                  disabled={!mayDismiss}
                  label={dismissAccessibilityLabel}
                  minimumTouchTarget={minimumTouchTarget}
                  onPress={handleDismiss}
                />
              )}
            </View>
            {loading ? (
              <View
                accessible
                accessibilityLabel={loadingLabel}
                accessibilityRole="progressbar"
                accessibilityState={{ busy: true }}
                style={[styles.loading, { gap: theme.spacing.xs }]}
              >
                <ActivityIndicator
                  accessibilityElementsHidden
                  color={theme.colors.action.primary}
                  importantForAccessibility="no-hide-descendants"
                />
                <Text
                  style={[theme.typography.meta, { color: theme.colors.text.secondary }]}
                >
                  {loadingLabel}
                </Text>
              </View>
            ) : null}
            {scrollable ? (
              <ScrollView
                contentContainerStyle={styles.scrollContentContainer}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator
                style={styles.scrollContent}
                testID={`${testID}-scroll`}
              >
                {children}
              </ScrollView>
            ) : (
              <View style={styles.content}>{children}</View>
            )}
            </View>
          </SafeAreaView>
        </KeyboardAwareSheetViewport>
      </View>
    </Modal>
  );
}

function KeyboardAwareSheetViewport({ children }: { children: ReactNode }) {
  if (Platform.OS === "ios") {
    return (
      <KeyboardAvoidingView
        behavior="padding"
        pointerEvents="box-none"
        style={styles.keyboardAvoidingView}
      >
        {children}
      </KeyboardAvoidingView>
    );
  }

  return (
    <View pointerEvents="box-none" style={styles.keyboardAvoidingView}>
      {children}
    </View>
  );
}

function DismissControl({
  disabled,
  label,
  minimumTouchTarget,
  onPress,
}: {
  disabled: boolean;
  label: string;
  minimumTouchTarget: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={theme.spacing.xs}
      onPress={onPress}
      style={({ pressed }) => [
        styles.dismissButton,
        {
          backgroundColor: pressed
            ? theme.colors.action.ghostPressed
            : theme.colors.background.subtle,
          borderColor: theme.colors.border.subtle,
          borderRadius: theme.radii.pill,
          minHeight: minimumTouchTarget,
          minWidth: minimumTouchTarget,
        },
      ]}
    >
      <Text
        style={[
          theme.typography.sectionTitle,
          { color: disabled ? theme.colors.text.disabled : theme.colors.text.primary },
        ]}
      >
        ×
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  keyboardAvoidingView: {
    flex: 1,
    justifyContent: "flex-end",
    width: "100%",
  },
  safeArea: {
    flex: 1,
    justifyContent: "flex-end",
    width: "100%",
  },
  sheet: {
    alignSelf: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: "88%",
    overflow: "hidden",
    width: "100%",
  },
  grabber: {
    alignSelf: "center",
    height: 5,
    width: 36,
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  centeredHeader: {
    alignItems: "center",
  },
  heading: {
    flex: 1,
    minWidth: 0,
  },
  centeredHeading: {
    alignItems: "center",
  },
  centeredHeadingText: {
    textAlign: "center",
  },
  dismissButton: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
  },
  loading: {
    alignItems: "center",
    flexDirection: "row",
  },
  content: {
    flexShrink: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexShrink: 1,
    minHeight: 0,
  },
  scrollContentContainer: {
    flexGrow: 0,
  },
});
