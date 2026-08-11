import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button, ErrorState, useTheme } from "../design-system";

export function BootstrapLoadingState() {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel="Uygulama hazırlanıyor. Cihaz ve hesap bilgilerin güvenli biçimde yükleniyor."
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      style={[styles.centered, { gap: theme.spacing.sm }]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.stateIcon,
          {
            backgroundColor: theme.colors.action.secondary,
            borderRadius: theme.radii.prominent,
          },
        ]}
      >
        <Ionicons color={theme.colors.action.primary} name="calendar-outline" size={32} />
        <ActivityIndicator color={theme.colors.action.primary} size="small" />
      </View>
      <Text
        accessibilityRole="header"
        style={[theme.typography.sectionTitle, styles.centerText, { color: theme.colors.text.primary }]}
      >
        Uygulama hazırlanıyor
      </Text>
      <Text style={[theme.typography.body, styles.centerText, { color: theme.colors.text.secondary }]}>Cihaz ve hesap bilgilerin güvenli biçimde yükleniyor.</Text>
    </View>
  );
}

export function BootstrapErrorState({ error, onRetry }: { error?: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <ErrorState
      actionLabel="Tekrar dene"
      description={error || "Cihaz ve hesap bilgileri yüklenemedi."}
      onAction={onRetry}
      illustration={<Ionicons color={theme.colors.status.error} name="cloud-offline-outline" size={36} />}
      title="Başlangıç tamamlanamadı"
    />
  );
}

export function UnknownRouteState({
  authenticated,
  onReturn,
}: {
  authenticated: boolean;
  onReturn: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.unknown, { gap: theme.spacing.md }]}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.unknownIcon,
          {
            backgroundColor: theme.colors.action.secondary,
            borderRadius: theme.radii.prominent,
          },
        ]}
      >
        <Ionicons color={theme.colors.action.primary} name="compass-outline" size={32} />
      </View>
      <View accessible accessibilityRole="summary" style={{ gap: theme.spacing.sm }}>
        <Text accessibilityRole="header" style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}>Sayfa bulunamadı</Text>
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Bu bağlantı güvenli bir uygulama rotasıyla eşleşmedi.</Text>
      </View>
      <Button
        fullWidth
        label={authenticated ? "Ana sayfaya dön" : "Girişe dön"}
        onPress={onReturn}
        variant="secondary"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: "center",
    alignSelf: "center",
    justifyContent: "center",
    maxWidth: 420,
    width: "100%",
  },
  centerText: {
    textAlign: "center",
  },
  stateIcon: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    height: 72,
    justifyContent: "center",
    width: 112,
  },
  unknown: {
    alignSelf: "center",
    maxWidth: 560,
    width: "100%",
  },
  unknownIcon: {
    alignItems: "center",
    height: 64,
    justifyContent: "center",
    width: 64,
  },
});
