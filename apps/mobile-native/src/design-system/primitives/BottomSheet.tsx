import { useCallback, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
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
  style?: StyleProp<ViewStyle>;
  testID?: string;
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
  style,
  testID = "bottom-sheet",
}: BottomSheetProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const minimumTouchTarget = Math.max(48, adaptation.minimumTouchTarget);
  const reducedMotion = useReducedMotion();
  const mayDismiss = dismissible && !loading;
  const handleDismiss = useCallback(() => {
    if (mayDismiss) {
      onDismiss();
    }
  }, [mayDismiss, onDismiss]);
  const isWide = adaptation.navigationLayout === "navigation-rail";

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
                borderColor: theme.colors.border.default,
                borderTopLeftRadius:
                  adaptation.platform === "ios"
                    ? theme.radii.prominent
                    : theme.radii.card,
                borderTopRightRadius:
                  adaptation.platform === "ios"
                    ? theme.radii.prominent
                    : theme.radii.card,
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
            <View style={[styles.header, { gap: theme.spacing.sm }]}>
              <View style={[styles.heading, { gap: theme.spacing.xxs }]}>
                <Text
                  accessibilityRole="header"
                  style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}
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
              <Pressable
                accessibilityLabel={dismissAccessibilityLabel}
                accessibilityRole="button"
                accessibilityState={{ disabled: !mayDismiss }}
                disabled={!mayDismiss}
                hitSlop={theme.spacing.xs}
                onPress={handleDismiss}
                style={({ pressed }) => [
                  styles.dismissButton,
                  {
                    backgroundColor: pressed
                      ? theme.colors.action.ghostPressed
                      : theme.colors.background.subtle,
                    borderColor: theme.colors.border.default,
                    borderRadius: theme.radii.pill,
                    minHeight: minimumTouchTarget,
                    minWidth: minimumTouchTarget,
                  },
                ]}
              >
                <Text
                  style={[
                    theme.typography.bodyStrong,
                    {
                      color: mayDismiss
                        ? theme.colors.text.primary
                        : theme.colors.text.disabled,
                    },
                  ]}
                >
                  ×
                </Text>
              </Pressable>
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
            <View style={styles.content}>{children}</View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
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
  safeArea: {
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
  heading: {
    flex: 1,
    minWidth: 0,
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
  },
});
