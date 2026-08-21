import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  Image,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";
import {
  Button,
  ErrorState,
  referencePalette,
  useReducedMotion,
  useTheme,
} from "../design-system";

const finalLogo = require("../../assets/design-package/academic-calendar-logo.png") as ImageSourcePropType;
const spinnerFrames: readonly ImageSourcePropType[] = [
  require("../../assets/design-package/spinner-frame-1.png") as ImageSourcePropType,
  require("../../assets/design-package/spinner-frame-2.png") as ImageSourcePropType,
  require("../../assets/design-package/spinner-frame-3.png") as ImageSourcePropType,
  require("../../assets/design-package/spinner-frame-4.png") as ImageSourcePropType,
  require("../../assets/design-package/spinner-frame-5.png") as ImageSourcePropType,
];
const spinnerFrameDurations = [160, 160, 260, 220, 650] as const;
const finalSpinnerFrameIndex = spinnerFrames.length - 1;

export function BootstrapLoadingState() {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [frameIndex, setFrameIndex] = useState(
    reducedMotion ? finalSpinnerFrameIndex : 0,
  );

  useEffect(() => {
    if (reducedMotion) {
      setFrameIndex(finalSpinnerFrameIndex);
      return undefined;
    }

    let activeFrame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setFrameIndex(activeFrame);

    const scheduleNextFrame = () => {
      timer = setTimeout(() => {
        activeFrame = (activeFrame + 1) % spinnerFrames.length;
        setFrameIndex(activeFrame);
        scheduleNextFrame();
      }, spinnerFrameDurations[activeFrame]);
    };

    scheduleNextFrame();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [reducedMotion]);

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
        style={styles.logoSpinner}
        testID="bootstrap-logo-spinner"
      >
        {reducedMotion ? (
          <Image
            accessibilityIgnoresInvertColors
            fadeDuration={0}
            resizeMode="contain"
            source={finalLogo}
            style={styles.staticLogo}
            testID="bootstrap-spinner-static-logo"
          />
        ) : spinnerFrames.map((source, index) => (
          <Image
            accessibilityIgnoresInvertColors
            fadeDuration={0}
            key={index}
            resizeMode="cover"
            source={source}
            style={[styles.spinnerFrame, { opacity: index === frameIndex ? 1 : 0 }]}
            testID={`bootstrap-spinner-frame-${index + 1}`}
          />
        ))}
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
  logoSpinner: {
    alignItems: "center",
    backgroundColor: referencePalette.academicBlueTint,
    borderRadius: 12,
    height: 160,
    justifyContent: "center",
    overflow: "hidden",
    width: 133,
  },
  spinnerFrame: {
    height: 160,
    left: 0,
    position: "absolute",
    top: 0,
    width: 133,
  },
  staticLogo: {
    height: 126,
    width: 126,
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
