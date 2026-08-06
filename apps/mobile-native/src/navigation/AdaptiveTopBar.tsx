import type { ReactNode, Ref } from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type Text as NativeText,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { IconButton } from "../design-system/primitives/IconButton";
import { NavigationSurface } from "../design-system/surfaces";
import {
  usePlatformAdaptation,
  useTheme,
} from "../design-system/theme";
import { APP_SHELL_COMPACT_WIDTH } from "./app-shell";

export type AdaptiveTopBarLayout = "compact" | "regular";

export interface AdaptiveTopBarAction {
  icon: ReactNode;
  accessibilityLabel: string;
  onPress: () => void;
  accessibilityHint?: string;
  disabled?: boolean;
  key?: string;
}

export interface AdaptiveTopBarProps {
  title: string;
  subtitle?: string;
  /** Context is used when no subtitle is supplied. */
  context?: string;
  leadingAction?: AdaptiveTopBarAction;
  trailingActions?: readonly AdaptiveTopBarAction[];
  accessibilityLabel?: string;
  titleRef?: Ref<NativeText>;
  onTitleLayoutTarget?: (target: number) => void;
  style?: StyleProp<ViewStyle>;
}

export function resolveAdaptiveTopBarLayout(
  windowWidth: number,
): AdaptiveTopBarLayout {
  return Number.isFinite(windowWidth) && windowWidth >= APP_SHELL_COMPACT_WIDTH
    ? "regular"
    : "compact";
}

export function AdaptiveTopBar({
  title,
  subtitle,
  context,
  leadingAction,
  trailingActions = [],
  accessibilityLabel = `${title} üst gezinme çubuğu`,
  titleRef,
  onTitleLayoutTarget,
  style,
}: AdaptiveTopBarProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const compact = adaptation.screenGutter === theme.spacing.md;
  const supportingText = subtitle ?? context;
  const titleTypography = compact
    ? theme.typography.cardTitle
    : theme.typography.screenTitle;

  return (
    <NavigationSurface
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="toolbar"
      kind="navigation-bar"
      style={[styles.surface, style]}
    >
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
        <View
          style={[
            styles.content,
            compact ? styles.compactContent : styles.regularContent,
            {
              gap: compact ? theme.spacing.xs : theme.spacing.sm,
              minHeight: adaptation.minimumTouchTarget,
              paddingHorizontal: adaptation.screenGutter,
              paddingVertical: compact ? theme.spacing.xs : theme.spacing.sm,
            },
          ]}
        >
          <View
            style={[
              styles.titleRow,
              { gap: compact ? theme.spacing.xxs : theme.spacing.xs },
            ]}
          >
            {leadingAction ? <TopBarAction action={leadingAction} /> : null}
            <View style={[styles.titleBlock, { gap: theme.spacing.xxs }]}>
              <Text
                accessibilityRole="header"
                adjustsFontSizeToFit={false}
                allowFontScaling
                onLayout={(event) => {
                  const target = Number(event.target);
                  if (Number.isFinite(target)) onTitleLayoutTarget?.(target);
                }}
                ref={titleRef}
                style={[
                  styles.wrappingText,
                  titleTypography,
                  { color: theme.colors.text.primary },
                ]}
              >
                {title}
              </Text>
              {supportingText ? (
                <Text
                  adjustsFontSizeToFit={false}
                  allowFontScaling
                  style={[
                    styles.wrappingText,
                    theme.typography.meta,
                    { color: theme.colors.text.secondary },
                  ]}
                >
                  {supportingText}
                </Text>
              ) : null}
            </View>
          </View>

          {trailingActions.length > 0 ? (
            <View
              style={[
                styles.trailingActions,
                compact && styles.compactTrailingActions,
                { gap: theme.spacing.xxs },
              ]}
            >
              {trailingActions.map((action, index) => (
                <TopBarAction
                  action={action}
                  key={action.key ?? `${action.accessibilityLabel}-${index}`}
                />
              ))}
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </NavigationSurface>
  );
}

function TopBarAction({ action }: { action: AdaptiveTopBarAction }) {
  return (
    <IconButton
      accessibilityHint={action.accessibilityHint}
      accessibilityLabel={action.accessibilityLabel}
      disabled={action.disabled}
      icon={action.icon}
      onPress={action.onPress}
      style={styles.action}
    />
  );
}

const styles = StyleSheet.create({
  action: {
    minHeight: 48,
    minWidth: 48,
  },
  surface: {
    alignSelf: "stretch",
  },
  safeArea: {
    alignSelf: "stretch",
  },
  content: {
    width: "100%",
  },
  compactContent: {
    alignItems: "stretch",
  },
  regularContent: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  titleBlock: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  wrappingText: {
    flexShrink: 1,
    flexWrap: "wrap",
  },
  trailingActions: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  compactTrailingActions: {
    alignSelf: "stretch",
  },
});
