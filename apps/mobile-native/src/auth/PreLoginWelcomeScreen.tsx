import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  Button,
  referencePalette,
  useReducedMotion,
  useTheme,
} from "../design-system";

const appMark = require("../../assets/icon-reference.png") as ImageSourcePropType;

type WelcomeIllustration = "calendar" | "announcements" | "planner";

interface WelcomeSlide {
  accent: string;
  background: string;
  detail: string;
  illustration: WelcomeIllustration;
  title: string;
}

const WELCOME_SLIDES: readonly WelcomeSlide[] = [
  {
    accent: referencePalette.welcomeBlue,
    background: referencePalette.welcomeBlueSoft,
    detail: "Akademik tarihlerini, derslerini ve kişisel planlarını aynı akışta düzenle.",
    illustration: "calendar",
    title: "Dönemini rahatça planla",
  },
  {
    accent: referencePalette.academicGreen,
    background: referencePalette.academicGreenSoft,
    detail: "Üniversite, fakülte ve bölüm kaynaklarından gelen içerikleri tek yerde takip et.",
    illustration: "announcements",
    title: "Duyuruları tek yerden takip et",
  },
  {
    accent: referencePalette.welcomeOrange,
    background: referencePalette.welcomeOrangeSoft,
    detail: "Kendi etkinliğini ekle, hatırlatma kur ve önemli günlere hazırlıklı gir.",
    illustration: "planner",
    title: "Kendi düzenini oluştur",
  },
] as const;

export interface PreLoginWelcomeScreenProps {
  busy?: boolean;
  onContinue: () => void;
}

export function PreLoginWelcomeScreen({
  busy = false,
  onContinue,
}: PreLoginWelcomeScreenProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const { fontScale, height, width } = useWindowDimensions();
  const compact = height < 700 || width < 360 || fontScale > 1.2;
  const veryCompact = height < 610 || width < 330 || fontScale > 1.45;
  const gutter = compact ? 16 : 24;
  const contentWidth = Math.max(280, Math.min(620, width - gutter * 2));
  const illustrationHeight = veryCompact
    ? 142
    : compact
      ? 176
      : Math.min(272, height * 0.31);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList<WelcomeSlide> | null>(null);
  const floatProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) {
      floatProgress.setValue(0);
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(floatProgress, {
          duration: 1200,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(floatProgress, {
          duration: 1200,
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [floatProgress, reducedMotion]);

  const selectSlide = (index: number) => {
    const boundedIndex = Math.max(0, Math.min(WELCOME_SLIDES.length - 1, index));
    setActiveIndex(boundedIndex);
    listRef.current?.scrollToIndex({ animated: !reducedMotion, index: boundedIndex });
  };

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / contentWidth);
    setActiveIndex(Math.max(0, Math.min(WELCOME_SLIDES.length - 1, index)));
  };

  const finalSlide = activeIndex === WELCOME_SLIDES.length - 1;

  return (
    <View
      accessibilityLabel="Akademik Takvim uygulama tanıtımı"
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.background.canvas,
          paddingBottom: compact ? 10 : 16,
          paddingHorizontal: gutter,
          paddingTop: compact ? 6 : 12,
        },
      ]}
      testID="prelogin-welcome-screen"
    >
      <View style={[styles.brandRow, { width: contentWidth }]}>
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel="Akademik Takvim simgesi"
          source={appMark}
          style={[styles.appMark, compact && styles.appMarkCompact]}
        />
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.25}
          numberOfLines={1}
          style={[
            theme.typography.cardTitle,
            styles.brandTitle,
            { color: theme.colors.text.primary },
          ]}
        >
          Akademik Takvim
        </Text>
        <Pressable
          accessibilityLabel="Tanıtımı atla"
          accessibilityRole="button"
          disabled={busy}
          hitSlop={8}
          onPress={onContinue}
          style={({ pressed }) => [
            styles.skipButton,
            pressed && { backgroundColor: theme.colors.action.ghostPressed },
          ]}
        >
          <Text style={[theme.typography.metaStrong, { color: theme.colors.text.link }]}>Atla</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        accessibilityLabel="Uygulama tanıtım sayfaları"
        data={WELCOME_SLIDES}
        decelerationRate="fast"
        getItemLayout={(_data, index) => ({
          index,
          length: contentWidth,
          offset: contentWidth * index,
        })}
        horizontal
        keyExtractor={(item) => item.illustration}
        onMomentumScrollEnd={handleScrollEnd}
        pagingEnabled
        renderItem={({ item, index }) => (
          <View
            accessibilityLabel={`${index + 1} / ${WELCOME_SLIDES.length}. ${item.title}. ${item.detail}`}
            style={[styles.slide, { width: contentWidth }]}
            testID={`prelogin-slide-${index}`}
          >
            <View
              style={[
                styles.illustrationFrame,
                { backgroundColor: item.background, height: illustrationHeight },
              ]}
            >
              <Animated.View
                style={{
                  transform: [{
                    translateY: floatProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -6],
                    }),
                  }],
                }}
              >
                <WelcomeVectorIllustration accent={item.accent} kind={item.illustration} />
              </Animated.View>
            </View>
            <View style={[styles.slideCopy, compact && styles.slideCopyCompact]}>
              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={1.25}
                numberOfLines={2}
                style={[
                  theme.typography.display,
                  styles.slideTitle,
                  compact && styles.slideTitleCompact,
                  { color: theme.colors.text.primary },
                ]}
              >
                {item.title}
              </Text>
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={veryCompact ? 2 : 3}
                style={[
                  theme.typography.body,
                  styles.slideDetail,
                  compact && styles.slideDetailCompact,
                  { color: theme.colors.text.secondary },
                ]}
              >
                {item.detail}
              </Text>
            </View>
          </View>
        )}
        showsHorizontalScrollIndicator={false}
        style={[styles.slider, { width: contentWidth }]}
      />

      <View
        accessibilityLabel={`${activeIndex + 1}. tanıtım sayfası seçili`}
        accessibilityRole="adjustable"
        style={styles.pagination}
      >
        {WELCOME_SLIDES.map((slide, index) => (
          <Pressable
            accessibilityLabel={`${index + 1}. tanıtım sayfasına git`}
            accessibilityRole="button"
            key={slide.illustration}
            onPress={() => selectSlide(index)}
            style={styles.paginationTarget}
          >
            <View
              style={[
                styles.paginationDot,
                {
                  backgroundColor: index === activeIndex
                    ? theme.colors.action.primary
                    : theme.colors.border.default,
                  width: index === activeIndex ? 22 : 7,
                },
              ]}
            />
          </Pressable>
        ))}
      </View>

      <View style={[styles.actionArea, { width: contentWidth }]}>
        <Button
          accessibilityHint={finalSlide
            ? "Giriş ekranını açar ve tanıtımı tamamlar."
            : "Sonraki tanıtım sayfasını gösterir."}
          fullWidth
          label={finalSlide ? "Başlayalım" : "Devam et"}
          loading={busy}
          onPress={finalSlide ? onContinue : () => selectSlide(activeIndex + 1)}
          testID="prelogin-continue-button"
          trailingIcon={finalSlide
            ? <Ionicons color={theme.colors.action.onPrimary} name="checkmark" size={21} />
            : <Ionicons color={theme.colors.action.onPrimary} name="chevron-forward" size={21} />}
        />
        {!veryCompact ? (
          <View style={styles.footerTrust}>
            <Ionicons color={referencePalette.academicGreen} name="shield-checkmark-outline" size={15} />
            <Text
              maxFontSizeMultiplier={1.15}
              numberOfLines={1}
              style={[theme.typography.meta, styles.footerText, { color: theme.colors.text.secondary }]}
            >
              Güvenilir akademik kaynaklar · Kontrol sende
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function WelcomeVectorIllustration({
  accent,
  kind,
}: {
  accent: string;
  kind: WelcomeIllustration;
}) {
  if (kind === "announcements") {
    return (
      <View style={styles.vectorScene}>
        <View style={[styles.vectorAccentDisc, { backgroundColor: accent }]}>
          <Ionicons color={referencePalette.white} name="megaphone" size={48} />
        </View>
        <View style={styles.noticeStack}>
          {["business-outline", "library-outline", "people-outline"].map((icon, index) => (
            <View key={icon} style={[styles.noticeRow, { marginLeft: index * 7 }]}>
              <View style={[styles.noticeIcon, { backgroundColor: `${accent}20` }]}>
                <Ionicons color={accent} name={icon as keyof typeof Ionicons.glyphMap} size={15} />
              </View>
              <View style={styles.noticeLines}>
                <View style={[styles.vectorLineStrong, { backgroundColor: accent }]} />
                <View style={styles.vectorLine} />
              </View>
              <Ionicons color={accent} name="checkmark-circle" size={17} />
            </View>
          ))}
        </View>
        <View style={[styles.floatingBadge, styles.floatingBadgeTop, { backgroundColor: referencePalette.academicOrangeSoft }]}>
          <Ionicons color={referencePalette.academicOrange} name="sparkles" size={18} />
        </View>
      </View>
    );
  }

  if (kind === "planner") {
    return (
      <View style={styles.vectorScene}>
        <View style={styles.plannerBoard}>
          <View style={[styles.plannerHeader, { backgroundColor: accent }]}>
            <Ionicons color={referencePalette.white} name="create-outline" size={19} />
            <View style={styles.plannerHeaderLine} />
          </View>
          {[0, 1, 2].map((item) => (
            <View key={item} style={styles.plannerRow}>
              <Ionicons
                color={item === 1 ? referencePalette.academicGreen : accent}
                name={item === 1 ? "checkmark-circle" : "ellipse-outline"}
                size={17}
              />
              <View style={[styles.plannerLine, item === 2 && styles.plannerLineShort]} />
            </View>
          ))}
        </View>
        <View style={[styles.vectorAccentDisc, styles.plannerBell, { backgroundColor: accent }]}>
          <Ionicons color={referencePalette.white} name="notifications" size={37} />
        </View>
        <View style={[styles.floatingBadge, styles.floatingBadgeBottom, { backgroundColor: referencePalette.academicGreenSoft }]}>
          <Ionicons color={referencePalette.academicGreen} name="add" size={22} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.vectorScene}>
      <View style={styles.calendarBoard}>
        <View style={[styles.calendarHeader, { backgroundColor: accent }]}>
          <View style={styles.calendarBinding} />
          <View style={styles.calendarBinding} />
          <Text style={styles.calendarHeaderText}>HAFTA</Text>
        </View>
        <View style={styles.calendarGrid}>
          {Array.from({ length: 12 }, (_, index) => (
            <View
              key={index}
              style={[
                styles.calendarCell,
                index === 6 && { backgroundColor: accent },
              ]}
            >
              {index === 6 ? <Ionicons color={referencePalette.white} name="checkmark" size={17} /> : null}
            </View>
          ))}
        </View>
      </View>
      <View style={[styles.vectorAccentDisc, styles.calendarClock, { backgroundColor: referencePalette.academicGreen }]}>
        <Ionicons color={referencePalette.white} name="time" size={36} />
      </View>
      <View style={[styles.floatingBadge, styles.floatingBadgeTop, { backgroundColor: referencePalette.academicOrangeSoft }]}>
        <Ionicons color={referencePalette.academicOrange} name="school" size={19} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    flex: 1,
    gap: 8,
    overflow: "hidden",
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    minHeight: 44,
  },
  appMark: {
    borderRadius: 10,
    height: 42,
    width: 42,
  },
  appMarkCompact: {
    borderRadius: 8,
    height: 36,
    width: 36,
  },
  brandTitle: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  skipButton: {
    alignItems: "center",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 40,
    minWidth: 48,
    paddingHorizontal: 8,
  },
  slider: {
    flex: 1,
  },
  slide: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  illustrationFrame: {
    alignItems: "center",
    alignSelf: "stretch",
    borderRadius: 8,
    justifyContent: "center",
    overflow: "hidden",
  },
  slideCopy: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 18,
  },
  slideCopyCompact: {
    gap: 5,
    paddingTop: 11,
  },
  slideTitle: {
    fontSize: 28,
    lineHeight: 34,
    textAlign: "center",
  },
  slideTitleCompact: {
    fontSize: 23,
    lineHeight: 28,
  },
  slideDetail: {
    maxWidth: 500,
    textAlign: "center",
  },
  slideDetailCompact: {
    fontSize: 14,
    lineHeight: 19,
  },
  pagination: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 28,
  },
  paginationTarget: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 34,
  },
  paginationDot: {
    borderRadius: 4,
    height: 7,
  },
  actionArea: {
    gap: 6,
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
  vectorScene: {
    height: 176,
    position: "relative",
    width: 270,
  },
  vectorAccentDisc: {
    alignItems: "center",
    borderRadius: 48,
    height: 86,
    justifyContent: "center",
    left: 14,
    position: "absolute",
    top: 46,
    width: 86,
  },
  floatingBadge: {
    alignItems: "center",
    borderRadius: 22,
    height: 42,
    justifyContent: "center",
    position: "absolute",
    width: 42,
  },
  floatingBadgeTop: {
    right: 8,
    top: 15,
  },
  floatingBadgeBottom: {
    bottom: 7,
    left: 0,
  },
  noticeStack: {
    gap: 7,
    position: "absolute",
    right: 3,
    top: 45,
  },
  noticeRow: {
    alignItems: "center",
    backgroundColor: referencePalette.white,
    borderRadius: 8,
    elevation: 2,
    flexDirection: "row",
    gap: 7,
    height: 39,
    paddingHorizontal: 8,
    width: 164,
  },
  noticeIcon: {
    alignItems: "center",
    borderRadius: 6,
    height: 27,
    justifyContent: "center",
    width: 27,
  },
  noticeLines: {
    flex: 1,
    gap: 4,
  },
  vectorLineStrong: {
    borderRadius: 2,
    height: 5,
    opacity: 0.75,
    width: "80%",
  },
  vectorLine: {
    backgroundColor: referencePalette.academicNeutralLineSoft,
    borderRadius: 2,
    height: 4,
    width: "100%",
  },
  plannerBoard: {
    backgroundColor: referencePalette.white,
    borderRadius: 8,
    elevation: 3,
    left: 37,
    overflow: "hidden",
    position: "absolute",
    top: 18,
    width: 174,
  },
  plannerHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    height: 43,
    paddingHorizontal: 12,
  },
  plannerHeaderLine: {
    backgroundColor: referencePalette.whiteAlpha24,
    borderRadius: 2,
    height: 6,
    width: 84,
  },
  plannerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    height: 34,
    paddingHorizontal: 12,
  },
  plannerLine: {
    backgroundColor: referencePalette.academicNeutralLineSoft,
    borderRadius: 2,
    height: 5,
    width: 106,
  },
  plannerLineShort: {
    width: 72,
  },
  plannerBell: {
    left: undefined,
    right: 1,
    top: 78,
  },
  calendarBoard: {
    backgroundColor: referencePalette.white,
    borderRadius: 8,
    elevation: 3,
    left: 30,
    overflow: "hidden",
    position: "absolute",
    top: 13,
    width: 202,
  },
  calendarHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    height: 43,
    paddingHorizontal: 13,
  },
  calendarBinding: {
    backgroundColor: referencePalette.white,
    borderRadius: 2,
    height: 17,
    opacity: 0.9,
    width: 5,
  },
  calendarHeaderText: {
    color: referencePalette.white,
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 3,
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    padding: 13,
  },
  calendarCell: {
    alignItems: "center",
    backgroundColor: referencePalette.academicBlueSurfaceStrong,
    borderRadius: 6,
    height: 23,
    justifyContent: "center",
    width: 37,
  },
  calendarClock: {
    bottom: 0,
    left: undefined,
    right: 1,
    top: undefined,
  },
});
