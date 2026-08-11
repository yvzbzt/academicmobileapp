import { Ionicons } from "@expo/vector-icons";
import {
  AccessibilityInfo,
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  type Text as NativeText,
} from "react-native";
import { useEffect, useRef } from "react";
import { Banner, Button, PasswordField, useTheme } from "../design-system";
import type {
  DestructiveAccountAction,
  RecentAuthenticationMethod
} from "./recent-authentication";

export interface RecentAuthenticationPanelProps {
  action: DestructiveAccountAction;
  methods: readonly RecentAuthenticationMethod[];
  password: string;
  busy: boolean;
  error?: string;
  onPasswordChange: (password: string) => void;
  onSubmitPassword: () => void;
  onSubmitGoogle: () => void;
  onCancel: () => void;
}

export function RecentAuthenticationPanel(props: RecentAuthenticationPanelProps) {
  const theme = useTheme();
  const headingRef = useRef<NativeText | null>(null);
  const actionLabel = props.action === "account" ? "hesabını silmek" : "verilerini silmek";
  const passwordAvailable = props.methods.includes("password");
  const googleAvailable = props.methods.includes("google");

  useEffect(() => {
    const timeout = setTimeout(() => {
      const target = findNodeHandle(headingRef.current);
      if (target) AccessibilityInfo.setAccessibilityFocus(target);
    }, 100);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <View
      accessibilityLabel="Kimliğini yeniden doğrula"
      style={[
        styles.panel,
        {
          backgroundColor: theme.colors.background.surfaceRaised,
          borderColor: theme.colors.action.secondary,
          borderRadius: theme.radii.prominent,
          gap: theme.spacing.md,
          padding: theme.spacing.md,
        }
      ]}
    >
      <View style={[styles.headingRow, { gap: theme.spacing.sm }]}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.headingIcon,
            {
              backgroundColor: theme.colors.action.secondary,
              borderRadius: theme.radii.card,
            },
          ]}
        >
          <Ionicons color={theme.colors.action.primary} name="shield-checkmark-outline" size={24} />
        </View>
        <View style={[styles.headingCopy, { gap: theme.spacing.xxs }]}>
          <Text style={[theme.typography.metaStrong, { color: theme.colors.action.primary }]}>GÜVENLİK KONTROLÜ</Text>
          <Text
            accessibilityRole="header"
            ref={headingRef}
            style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}
          >
            Kimliğini yeniden doğrula
          </Text>
        </View>
      </View>
      <View
        style={[
          styles.securityNotice,
          {
            backgroundColor: theme.colors.action.secondary,
            borderRadius: theme.radii.card,
            gap: theme.spacing.sm,
            padding: theme.spacing.sm,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={theme.colors.action.primary}
          importantForAccessibility="no-hide-descendants"
          name="lock-closed-outline"
          size={19}
        />
        <Text style={[theme.typography.body, styles.securityNoticeCopy, { color: theme.colors.text.secondary }]}>
          {actionLabel.charAt(0).toLocaleUpperCase("tr-TR") + actionLabel.slice(1)} için kısa süreli bir güvenlik doğrulaması gerekiyor.
        </Text>
      </View>

      {props.busy ? (
        <View
          accessible
          accessibilityLabel="Kimlik doğrulanıyor"
          accessibilityRole="progressbar"
          accessibilityState={{ busy: true }}
          style={[
            styles.progress,
            {
              backgroundColor: theme.colors.status.infoContainer,
              borderRadius: theme.radii.control,
              gap: theme.spacing.xs,
              padding: theme.spacing.sm,
            },
          ]}
        >
          <ActivityIndicator
            accessibilityElementsHidden
            color={theme.colors.action.primary}
            importantForAccessibility="no-hide-descendants"
          />
          <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Kimlik doğrulanıyor</Text>
        </View>
      ) : null}

      {passwordAvailable && (
        <View
          style={[
            styles.methodCard,
            {
              backgroundColor: theme.colors.background.subtle,
              borderColor: theme.colors.background.subtle,
              borderRadius: theme.radii.card,
              gap: theme.spacing.sm,
              padding: theme.spacing.sm,
            },
          ]}
        >
          <MethodHeading icon="key-outline" title="Şifre ile doğrulama" />
          <PasswordField
            label="Hesap şifresi"
            autoCapitalize="none"
            autoComplete="current-password"
            disabled={props.busy}
            onChangeText={props.onPasswordChange}
            onSubmitEditing={props.onSubmitPassword}
            placeholder="Hesap şifren"
            returnKeyType="done"
            value={props.password}
          />
          <Button
            disabled={props.busy || !props.password}
            fullWidth
            label="Şifre ile Doğrula"
            leadingIcon={<Ionicons color={theme.colors.action.onPrimary} name="shield-checkmark-outline" size={19} />}
            onPress={props.onSubmitPassword}
            style={styles.pillButton}
          />
        </View>
      )}

      {googleAvailable && (
        <View
          style={[
            styles.methodCard,
            {
              backgroundColor: theme.colors.background.subtle,
              borderColor: theme.colors.background.subtle,
              borderRadius: theme.radii.card,
              gap: theme.spacing.sm,
              padding: theme.spacing.sm,
            },
          ]}
        >
          <MethodHeading icon="logo-google" title="Google hesabı" />
          <Button
            disabled={props.busy}
            fullWidth
            label="Google ile Doğrula"
            leadingIcon={<Ionicons color={theme.colors.text.link} name="logo-google" size={19} />}
            onPress={props.onSubmitGoogle}
            style={styles.pillButton}
            variant="secondary"
          />
        </View>
      )}

      {!passwordAvailable && !googleAvailable && (
        <Banner
          title="Bu hesap için kullanılabilir doğrulama yöntemi bulunamadı."
          tone="error"
        />
      )}
      {props.error && (
        <Banner title={props.error} tone="error" />
      )}

      <Button
        disabled={props.busy}
        fullWidth
        label="Vazgeç"
        onPress={props.onCancel}
        variant="ghost"
      />
    </View>
  );
}

function MethodHeading({
  icon,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.methodHeading, { gap: theme.spacing.xs }]}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.methodIcon,
          {
            backgroundColor: theme.colors.background.surface,
            borderRadius: theme.radii.pill,
          },
        ]}
      >
        <Ionicons color={theme.colors.action.primary} name={icon} size={17} />
      </View>
      <Text style={[theme.typography.label, styles.methodHeadingCopy, { color: theme.colors.text.primary }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headingCopy: {
    flex: 1,
    minWidth: 0,
  },
  headingIcon: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  headingRow: {
    alignItems: "center",
    flexDirection: "row",
    minWidth: 0,
  },
  methodCard: {
    borderWidth: StyleSheet.hairlineWidth,
    width: "100%",
  },
  methodHeading: {
    alignItems: "center",
    flexDirection: "row",
    minWidth: 0,
  },
  methodHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  methodIcon: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  panel: {
    borderWidth: 1,
    width: "100%"
  },
  pillButton: {
    borderRadius: 999,
  },
  progress: {
    alignItems: "center",
    flexDirection: "row",
  },
  securityNotice: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  securityNoticeCopy: {
    flex: 1,
    minWidth: 0,
  },
});
