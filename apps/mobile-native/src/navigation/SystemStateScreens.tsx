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
      <ActivityIndicator
        accessibilityElementsHidden
        color={theme.colors.action.primary}
        importantForAccessibility="no-hide-descendants"
        size="large"
      />
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
  return (
    <ErrorState
      actionLabel="Tekrar dene"
      description={error || "Cihaz ve hesap bilgileri yüklenemedi."}
      onAction={onRetry}
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
  unknown: {
    alignSelf: "center",
    maxWidth: 560,
    width: "100%",
  },
});
