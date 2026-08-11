import { Ionicons } from "@expo/vector-icons";
import {
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from "react-native";
import { Button, referencePalette, useTheme } from "../design-system";

const welcomeHero = require("../../assets/prelogin-welcome-hero.png") as ImageSourcePropType;
const appMark = require("../../assets/icon-reference.png") as ImageSourcePropType;

type WelcomeIconName = "calendar-clear-outline" | "megaphone-outline" | "notifications-outline";

interface WelcomeFeature {
  accent: string;
  background: string;
  icon: WelcomeIconName;
  title: string;
  detail: string;
}

const FEATURES: readonly WelcomeFeature[] = [
  {
    accent: referencePalette.blue,
    background: referencePalette.academicBlueSoft,
    icon: "calendar-clear-outline",
    title: "Tüm tarihler tek yerde",
    detail: "Sınav, kayıt ve etkinliklerini birlikte planla.",
  },
  {
    accent: referencePalette.academicRed,
    background: referencePalette.academicRedSoft,
    icon: "megaphone-outline",
    title: "Resmî duyuruları kaçırma",
    detail: "Üniversite, fakülte ve bölüm haberlerini izle.",
  },
  {
    accent: referencePalette.academicGreen,
    background: referencePalette.academicGreenSoft,
    icon: "notifications-outline",
    title: "Zamanında hatırlan",
    detail: "Önemli akademik günlerden önce haber al.",
  },
] as const;

export interface PreLoginWelcomeScreenProps {
  busy?: boolean;
  onContinue: () => void;
}

/**
 * Installation-level introduction shown before Login. It intentionally owns a
 * fixed viewport with one visible composition and one primary action.
 */
export function PreLoginWelcomeScreen({
  busy = false,
  onContinue,
}: PreLoginWelcomeScreenProps) {
  const theme = useTheme();
  const { fontScale, height, width } = useWindowDimensions();
  const compact = height < 700 || width < 360 || fontScale > 1.2;
  const veryCompact = height < 610 || width < 330 || fontScale > 1.45;
  const heroHeight = veryCompact ? 86 : compact ? 118 : Math.min(230, height * 0.27);

  return (
    <View
      accessibilityLabel="Akademik Takvim uygulama tanıtımı"
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.background.canvas,
          paddingHorizontal: compact ? 16 : 24,
          paddingBottom: compact ? 10 : 16,
          paddingTop: compact ? 6 : 12,
        },
      ]}
      testID="prelogin-welcome-screen"
    >
      <View accessibilityRole="header" style={[styles.brandRow, compact && styles.brandRowCompact]}>
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel="Akademik Takvim simgesi"
          source={appMark}
          style={[styles.appMark, compact && styles.appMarkCompact]}
        />
        <View style={styles.brandCopy}>
          <Text
            allowFontScaling
            maxFontSizeMultiplier={1.25}
            numberOfLines={1}
            style={[
              theme.typography.cardTitle,
              styles.brandTitle,
              { color: theme.colors.text.primary },
              compact && styles.brandTitleCompact,
            ]}
          >
            Akademik Takvim
          </Text>
          {!veryCompact ? (
            <Text
              allowFontScaling
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={[
                theme.typography.meta,
                styles.brandTagline,
                { color: theme.colors.text.secondary },
              ]}
            >
              Akademik yolculuğunda bir adım önde
            </Text>
          ) : null}
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.trustBadge}
        >
          <Ionicons color={referencePalette.academicGreen} name="shield-checkmark" size={compact ? 18 : 20} />
        </View>
      </View>

      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.heroFrame, { height: heroHeight }]}
      >
        <View style={styles.heroBlueGlow} />
        <View style={styles.heroTealGlow} />
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={welcomeHero}
          style={styles.heroImage}
        />
      </View>

      <View style={[styles.introCopy, compact && styles.introCopyCompact]}>
        <Text
          accessibilityRole="header"
          allowFontScaling
          maxFontSizeMultiplier={1.2}
          numberOfLines={2}
          style={[
            theme.typography.display,
            styles.headline,
            { color: theme.colors.text.primary },
            compact && styles.headlineCompact,
          ]}
        >
          Akademik hayatın, tek bir yerde.
        </Text>
        <Text
          allowFontScaling
          maxFontSizeMultiplier={1.2}
          numberOfLines={veryCompact ? 2 : 3}
          style={[
            theme.typography.body,
            styles.subtitle,
            { color: theme.colors.text.secondary },
            compact && styles.subtitleCompact,
          ]}
        >
          Takvimini planla, resmî duyuruları takip et ve önemli tarihleri kaçırma.
        </Text>
      </View>

      <View
        accessibilityLabel="Uygulama özellikleri"
        style={[styles.features, compact && styles.featuresCompact]}
      >
        {FEATURES.map((feature) => (
          <View
            accessibilityLabel={`${feature.title}. ${feature.detail}`}
            key={feature.title}
            style={[
              styles.featureCard,
              {
                backgroundColor: theme.colors.background.surfaceRaised,
                borderColor: theme.colors.border.subtle,
              },
              compact && styles.featureCardCompact,
            ]}
            testID={`prelogin-feature-${feature.icon}`}
          >
            <View style={[styles.featureIcon, { backgroundColor: feature.background }]}>
              <Ionicons color={feature.accent} name={feature.icon} size={compact ? 19 : 22} />
            </View>
            <View style={styles.featureCopy}>
              <Text
                allowFontScaling
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                style={[
                  theme.typography.bodyStrong,
                  styles.featureTitle,
                  { color: theme.colors.text.primary },
                  compact && styles.featureTitleCompact,
                ]}
              >
                {feature.title}
              </Text>
              {!veryCompact ? (
                <Text
                  allowFontScaling
                  maxFontSizeMultiplier={1.15}
                  numberOfLines={1}
                  style={[
                    theme.typography.meta,
                    styles.featureDetail,
                    { color: theme.colors.text.secondary },
                    compact && styles.featureDetailCompact,
                  ]}
                >
                  {feature.detail}
                </Text>
              ) : null}
            </View>
            <Ionicons color={feature.accent} name="checkmark-circle" size={compact ? 18 : 20} />
          </View>
        ))}
      </View>

      <View style={[styles.actionArea, compact && styles.actionAreaCompact]}>
        <Button
          accessibilityHint="Giriş ekranını açar ve bu tanıtımı tamamlar."
          fullWidth
          label="Başlayalım"
          loading={busy}
          onPress={onContinue}
          testID="prelogin-continue-button"
          trailingIcon={<Ionicons color={referencePalette.white} name="arrow-forward" size={21} />}
        />
        {!veryCompact ? (
          <View
            accessibilityLabel="Güvenilir kaynaklar ve gizliliğine saygılı tasarım"
            style={styles.footerTrust}
          >
            <Ionicons color={referencePalette.academicGreen} name="shield-checkmark-outline" size={15} />
            <Text
              allowFontScaling
              maxFontSizeMultiplier={1.15}
              numberOfLines={1}
              style={[theme.typography.meta, styles.footerText, { color: theme.colors.text.secondary }]}
            >
              Güvenilir kaynaklar  •  Gizliliğine saygılı
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    gap: 10,
    overflow: "hidden",
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 11,
    minHeight: 52,
  },
  brandRowCompact: {
    gap: 9,
    minHeight: 40,
  },
  appMark: {
    borderRadius: 13,
    height: 48,
    width: 48,
  },
  appMarkCompact: {
    borderRadius: 10,
    height: 38,
    width: 38,
  },
  brandCopy: {
    flex: 1,
    minWidth: 0,
  },
  brandTitle: {
    fontSize: 18,
    lineHeight: 23,
  },
  brandTitleCompact: {
    fontSize: 16,
    lineHeight: 20,
  },
  brandTagline: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  trustBadge: {
    alignItems: "center",
    backgroundColor: referencePalette.academicGreenSoft,
    borderRadius: 999,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  heroFrame: {
    alignSelf: "stretch",
    borderRadius: 22,
    overflow: "hidden",
    position: "relative",
  },
  heroBlueGlow: {
    backgroundColor: referencePalette.academicBlueTint,
    borderRadius: 999,
    height: "94%",
    left: "6%",
    position: "absolute",
    top: "3%",
    width: "64%",
  },
  heroTealGlow: {
    backgroundColor: referencePalette.academicTealSurface,
    borderRadius: 999,
    bottom: "4%",
    height: "62%",
    position: "absolute",
    right: "4%",
    width: "48%",
  },
  heroImage: {
    height: "100%",
    width: "100%",
  },
  introCopy: {
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  introCopyCompact: {
    gap: 3,
    paddingHorizontal: 2,
  },
  headline: {
    fontSize: 29,
    lineHeight: 35,
    textAlign: "center",
  },
  headlineCompact: {
    fontSize: 23,
    lineHeight: 28,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    maxWidth: 520,
    textAlign: "center",
  },
  subtitleCompact: {
    fontSize: 13,
    lineHeight: 18,
  },
  features: {
    flex: 1,
    gap: 8,
    justifyContent: "center",
    minHeight: 196,
  },
  featuresCompact: {
    gap: 5,
    minHeight: 129,
  },
  featureCard: {
    alignItems: "center",
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: referencePalette.navy,
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 7,
    elevation: 1,
  },
  featureCardCompact: {
    borderRadius: 12,
    gap: 9,
    minHeight: 41,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  featureIcon: {
    alignItems: "center",
    borderRadius: 11,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  featureCopy: {
    flex: 1,
    minWidth: 0,
  },
  featureTitle: {
    fontSize: 14,
    lineHeight: 18,
  },
  featureTitleCompact: {
    fontSize: 12,
    lineHeight: 15,
  },
  featureDetail: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  featureDetailCompact: {
    fontSize: 10,
    lineHeight: 13,
  },
  actionArea: {
    gap: 8,
  },
  actionAreaCompact: {
    gap: 4,
  },
  footerTrust: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 5,
    minHeight: 20,
  },
  footerText: {
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
  },
});
