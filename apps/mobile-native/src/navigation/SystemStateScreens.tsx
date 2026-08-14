import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Button, ErrorState, useReducedMotion, useTheme } from "../design-system";

export function BootstrapLoadingState() {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(0.5);
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          duration: 900,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          duration: 360,
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);

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
        <View style={[styles.loaderCalendar, { backgroundColor: theme.colors.background.surfaceRaised }]}>
          <View style={[styles.loaderCalendarHeader, { backgroundColor: theme.colors.action.primary }]}>
            <View style={[styles.loaderBinding, { backgroundColor: theme.colors.action.onPrimary }]} />
            <View style={[styles.loaderBinding, { backgroundColor: theme.colors.action.onPrimary }]} />
          </View>
          <View style={styles.loaderGrid}>
            {Array.from({ length: 6 }, (_, index) => (
              <View
                key={index}
                style={[
                  styles.loaderCell,
                  { backgroundColor: index === 4 ? theme.colors.action.secondary : theme.colors.border.subtle },
                ]}
              />
            ))}
          </View>
          <Animated.View
            style={[
              styles.loaderCheck,
              {
                backgroundColor: theme.colors.status.success,
                opacity: progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.45, 1, 1] }),
                transform: [{
                  translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-18, 18] }),
                }],
              },
            ]}
          >
            <Ionicons color={theme.colors.action.onPrimary} name="checkmark" size={17} />
          </Animated.View>
        </View>
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
    height: 116,
    justifyContent: "center",
    width: 148,
  },
  loaderCalendar: {
    borderRadius: 8,
    elevation: 3,
    height: 82,
    overflow: "visible",
    width: 106,
  },
  loaderCalendarHeader: {
    alignItems: "center",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    flexDirection: "row",
    gap: 8,
    height: 24,
    paddingHorizontal: 12,
  },
  loaderBinding: {
    borderRadius: 2,
    height: 12,
    width: 4,
  },
  loaderGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    padding: 10,
  },
  loaderCell: {
    borderRadius: 3,
    height: 10,
    width: 22,
  },
  loaderCheck: {
    alignItems: "center",
    borderRadius: 18,
    bottom: -17,
    height: 34,
    justifyContent: "center",
    left: 36,
    position: "absolute",
    width: 34,
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
