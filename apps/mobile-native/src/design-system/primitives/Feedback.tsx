import { useEffect, useRef, type ReactNode } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { resolveElevationStyle } from "../platform";
import {
  usePlatformAdaptation,
  useReducedMotion,
  useTheme,
} from "../theme";
import type { SemanticTheme } from "../tokens";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

export type FeedbackTone = "info" | "success" | "warning" | "error";

function resolveFeedbackPalette(theme: SemanticTheme, tone: FeedbackTone) {
  switch (tone) {
    case "success":
      return {
        background: theme.colors.status.successContainer,
        foreground: theme.colors.status.onSuccessContainer,
        accent: theme.colors.status.success,
      };
    case "warning":
      return {
        background: theme.colors.status.warningContainer,
        foreground: theme.colors.status.onWarningContainer,
        accent: theme.colors.status.warning,
      };
    case "error":
      return {
        background: theme.colors.status.errorContainer,
        foreground: theme.colors.status.onErrorContainer,
        accent: theme.colors.status.error,
      };
    case "info":
    default:
      return {
        background: theme.colors.status.infoContainer,
        foreground: theme.colors.status.onInfoContainer,
        accent: theme.colors.status.info,
      };
  }
}

export interface BannerProps {
  title: string;
  message?: string;
  tone?: FeedbackTone;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  dismissAccessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Banner({
  title,
  message,
  tone = "info",
  actionLabel,
  onAction,
  onDismiss,
  dismissAccessibilityLabel = "Bildirimi kapat",
  style,
}: BannerProps) {
  const theme = useTheme();
  const palette = resolveFeedbackPalette(theme, tone);

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: palette.background,
          borderColor: theme.colors.border.subtle,
          borderRadius: theme.radii.card,
          gap: theme.spacing.sm,
          padding: theme.spacing.md,
        },
        style,
      ]}
    >
      <View style={[styles.feedbackCopy, { gap: theme.spacing.xs }]}>
        <View
          accessible
          accessibilityLabel={message ? `${title}. ${message}` : title}
          accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
          accessibilityRole="alert"
          style={{ gap: theme.spacing.xxs }}
        >
          <Text maxFontSizeMultiplier={1.35} numberOfLines={2} style={[theme.typography.bodyStrong, { color: palette.foreground }]}>
            {title}
          </Text>
          {message ? (
            <Text maxFontSizeMultiplier={1.35} numberOfLines={4} style={[theme.typography.body, { color: palette.foreground }]}>
              {message}
            </Text>
          ) : null}
        </View>
        {actionLabel && onAction ? (
          <View>
            <Button compact label={actionLabel} maxFontSizeMultiplier={1.3} onPress={onAction} variant="secondary" />
          </View>
        ) : null}
      </View>
      {onDismiss ? (
        <IconButton
          accessibilityLabel={dismissAccessibilityLabel}
          icon={
            <Text maxFontSizeMultiplier={1.2} style={[theme.typography.bodyStrong, { color: palette.foreground }]}>×</Text>
          }
          onPress={onDismiss}
        />
      ) : null}
    </View>
  );
}

export interface ToastProps extends Omit<BannerProps, "style"> {
  style?: StyleProp<ViewStyle>;
}

export function Toast({ style, ...bannerProps }: ToastProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  return (
    <View
      style={[
        styles.toast,
        { maxWidth: theme.readableWidths.compact },
        resolveElevationStyle("medium", adaptation.platform, theme),
        style,
      ]}
    >
      <Banner {...bannerProps} />
    </View>
  );
}

export interface SkeletonProps {
  accessibilityLabel?: string;
  decorative?: boolean;
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({
  accessibilityLabel = "İçerik yükleniyor",
  decorative = false,
  width = "100%",
  height = 20,
  radius,
  style,
}: SkeletonProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.stopAnimation();
      opacity.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          duration: theme.motion.duration.long,
          easing: Easing.inOut(Easing.ease),
          toValue: 0.45,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          duration: theme.motion.duration.long,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion, theme.motion.duration.long]);

  return (
    <Animated.View
      accessible={!decorative}
      accessibilityElementsHidden={decorative}
      accessibilityLabel={decorative ? undefined : accessibilityLabel}
      accessibilityRole={decorative ? undefined : "progressbar"}
      accessibilityState={decorative ? undefined : { busy: true }}
      importantForAccessibility={decorative ? "no-hide-descendants" : "auto"}
      style={[
        {
          width,
          height,
          borderRadius: radius ?? theme.radii.small,
          backgroundColor: theme.colors.state.skeleton,
          opacity,
        },
        style,
      ]}
    />
  );
}

export interface EmptyStateProps {
  title: string;
  description: string;
  illustration?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  title,
  description,
  illustration,
  actionLabel,
  onAction,
  style,
}: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.state,
        { gap: theme.spacing.sm, padding: theme.spacing.xl },
        style,
      ]}
    >
      {illustration ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {illustration}
        </View>
      ) : null}
      <View
        accessible
        accessibilityLabel={`${title}. ${description}`}
        accessibilityRole="summary"
        style={[styles.stateCopy, { gap: theme.spacing.sm }]}
      >
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.4}
          numberOfLines={3}
          style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}
        >
          {title}
        </Text>
        <Text maxFontSizeMultiplier={1.35} style={[theme.typography.body, { color: theme.colors.text.secondary }]}>
          {description}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <Button label={actionLabel} maxFontSizeMultiplier={1.35} onPress={onAction} variant="secondary" />
      ) : null}
    </View>
  );
}

export interface ErrorStateProps extends EmptyStateProps {
  technicalDetails?: string;
}

export function ErrorState({
  title,
  description,
  illustration,
  actionLabel,
  onAction,
  technicalDetails,
  style,
}: ErrorStateProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.state,
        { gap: theme.spacing.sm, padding: theme.spacing.xl },
        style,
      ]}
    >
      {illustration ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {illustration}
        </View>
      ) : null}
      <View
        accessible
        accessibilityLabel={`${title}. ${description}`}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[styles.stateCopy, { gap: theme.spacing.sm }]}
      >
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.4}
          numberOfLines={3}
          style={[theme.typography.sectionTitle, { color: theme.colors.status.error }]}
        >
          {title}
        </Text>
        <Text maxFontSizeMultiplier={1.35} style={[theme.typography.body, { color: theme.colors.text.secondary }]}>
          {description}
        </Text>
        {technicalDetails ? (
          <Text maxFontSizeMultiplier={1.3} style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>
            {technicalDetails}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Button label={actionLabel} maxFontSizeMultiplier={1.35} onPress={onAction} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: "flex-start",
    borderLeftWidth: 3,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  feedbackCopy: {
    flex: 1,
  },
  toast: {
    alignSelf: "center",
    width: "100%",
  },
  state: {
    alignItems: "center",
    justifyContent: "center",
  },
  stateCopy: {
    alignItems: "center",
  },
});
