import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  preLoginWelcomeColors,
  referencePalette,
  useReducedMotion,
} from "../design-system";

const appMark = require("../../assets/design-package/academic-calendar-logo.png") as ImageSourcePropType;
const announcementsArtwork = require("../../assets/design-package/onboarding-announcements-reference-v2.png") as ImageSourcePropType;
const planningArtwork = require("../../assets/design-package/onboarding-planning-reference-v2.png") as ImageSourcePropType;
const remindersArtwork = require("../../assets/design-package/onboarding-reminders-reference-v2.png") as ImageSourcePropType;

const BRAND_NAVY = preLoginWelcomeColors.brandNavy;
const BRAND_BLUE = referencePalette.academicBlue;
const BRAND_BLUE_PRESSED = referencePalette.academicBlueDeep;
const BRAND_BODY = preLoginWelcomeColors.body;
const TRUST_BLUE = preLoginWelcomeColors.trust;
const WELCOME_PRIMARY_MAX_FONT_SIZE_MULTIPLIER = 2;
const WELCOME_COMPACT_MAX_FONT_SIZE_MULTIPLIER = 1.6;

interface WelcomeSlide {
  artwork: ImageSourcePropType;
  artworkLabel: string;
  background: string;
  detail: string;
  id: "announcements" | "planning" | "reminders";
  layout: "artwork-first" | "copy-first";
  title: string;
}

const WELCOME_SLIDES: readonly WelcomeSlide[] = [
  {
    artwork: announcementsArtwork,
    artworkLabel: "Üniversite, fakülte ve bölüm duyurularını tek akışta gösteren illüstrasyon",
    background: preLoginWelcomeColors.canvasCool,
    detail: "Üniversite, fakülte ve bölüm kaynaklarından gelen içerikleri tek yerde takip et.",
    id: "announcements",
    layout: "artwork-first",
    title: "Duyuruları tek yerden takip et",
  },
  {
    artwork: planningArtwork,
    artworkLabel: "Haftalık dersleri ve kişisel planları birlikte gösteren illüstrasyon",
    background: preLoginWelcomeColors.canvasWarm,
    detail: "Akademik tarihlerini, derslerini ve kişisel planlarını aynı akışta düzenle.",
    id: "planning",
    layout: "copy-first",
    title: "Dönemini rahatça planla",
  },
  {
    artwork: remindersArtwork,
    artworkLabel: "Sınav, ödev, başvuru ve kişisel etkinlik hatırlatmalarını gösteren illüstrasyon",
    background: preLoginWelcomeColors.canvasCool,
    detail: "Kendi etkinliğini ekle, hatırlatma kur ve önemli günlere hazırlıklı gir.",
    id: "reminders",
    layout: "copy-first",
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
  const reducedMotion = useReducedMotion();
  const safeAreaInsets = useSafeAreaInsets();
  const { fontScale, height, width } = useWindowDimensions();
  const safeHeight = Math.max(0, height - safeAreaInsets.top - safeAreaInsets.bottom);
  const safeWidth = Math.max(0, width - safeAreaInsets.left - safeAreaInsets.right);
  const landscape = safeWidth > safeHeight;
  const tablet = Math.min(safeWidth, safeHeight) >= 700;
  const compact = safeHeight < 720 || safeWidth < 360 || fontScale > 1.2;
  const veryCompact = safeHeight < 610 || safeWidth < 330 || fontScale > 1.45;
  const gutter = veryCompact ? 12 : compact ? 16 : 24;
  const contentWidth = Math.min(
    tablet ? 720 : landscape ? 680 : 560,
    Math.max(240, safeWidth - gutter * 2),
  );
  const illustrationHeight = landscape
    ? Math.max(96, Math.min(210, safeHeight - (veryCompact ? 184 : 208)))
    : veryCompact
      ? fontScale > 1.45
        ? Math.max(150, Math.min(210, Math.round(safeHeight * 0.32)))
        : Math.max(190, Math.min(245, safeHeight * 0.4))
      : compact
        ? Math.min(390, contentWidth * 1.28, safeHeight * 0.49)
        : Math.min(tablet ? 680 : 520, contentWidth * 1.28, safeHeight * 0.56);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList<WelcomeSlide> | null>(null);
  const activeSlide = WELCOME_SLIDES[activeIndex];
  const finalSlide = activeIndex === WELCOME_SLIDES.length - 1;

  const selectSlide = (index: number) => {
    const boundedIndex = Math.max(0, Math.min(WELCOME_SLIDES.length - 1, index));
    setActiveIndex(boundedIndex);
    listRef.current?.scrollToIndex({
      animated: !reducedMotion,
      index: boundedIndex,
    });
  };

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / contentWidth);
    setActiveIndex(Math.max(0, Math.min(WELCOME_SLIDES.length - 1, index)));
  };

  return (
    <View
      accessibilityLabel="Akademik Takvim uygulama tanıtımı"
      style={[
        styles.root,
        {
          backgroundColor: activeSlide.background,
          paddingBottom: veryCompact ? 4 : 8,
          paddingHorizontal: gutter,
          paddingTop: compact ? 4 : 8,
        },
      ]}
      testID="prelogin-welcome-screen"
    >
      <View style={[styles.brandRow, compact && styles.brandRowCompact, { width: contentWidth }]}>
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel="Akademik Takvim logosu"
          resizeMode="contain"
          source={appMark}
          style={[styles.appMark, compact && styles.appMarkCompact]}
        />
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={WELCOME_COMPACT_MAX_FONT_SIZE_MULTIPLIER}
          numberOfLines={2}
          style={[styles.brandTitle, compact && styles.brandTitleCompact]}
        >
          Akademik Takvim
        </Text>
        <Pressable
          accessibilityLabel="Tanıtımı atla"
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          hitSlop={8}
          onPress={onContinue}
          style={({ pressed }) => [
            styles.skipButton,
            pressed && styles.skipButtonPressed,
          ]}
        >
          <Text maxFontSizeMultiplier={WELCOME_PRIMARY_MAX_FONT_SIZE_MULTIPLIER} style={styles.skipText}>Atla</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        accessibilityLabel="Uygulama tanıtım sayfaları"
        data={WELCOME_SLIDES}
        decelerationRate="fast"
        extraData={activeIndex}
        getItemLayout={(_data, index) => ({
          index,
          length: contentWidth,
          offset: contentWidth * index,
        })}
        horizontal
        initialScrollIndex={activeIndex}
        initialNumToRender={WELCOME_SLIDES.length}
        key={`prelogin-welcome-slides-${contentWidth}`}
        keyExtractor={(item) => item.id}
        onMomentumScrollEnd={handleScrollEnd}
        pagingEnabled
        removeClippedSubviews={false}
        renderItem={({ item, index }) => (
          <View
            accessible={index === activeIndex}
            accessibilityElementsHidden={index !== activeIndex}
            accessibilityLabel={index === activeIndex
              ? `${index + 1} / ${WELCOME_SLIDES.length}. ${item.title}. ${item.detail}`
              : undefined}
            importantForAccessibility={index === activeIndex ? "yes" : "no-hide-descendants"}
            style={[styles.slide, landscape && styles.slideLandscape, { width: contentWidth }]}
            testID={`prelogin-slide-${index}`}
          >
            {item.layout === "copy-first" ? (
              <WelcomeSlideCopy
                compact={compact}
                landscape={landscape}
                slide={item}
                veryCompact={veryCompact}
              />
            ) : null}
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.illustrationFrame,
                landscape && styles.illustrationFrameLandscape,
                { backgroundColor: item.background, height: illustrationHeight },
              ]}
              testID={`prelogin-illustration-${index}`}
            >
              <Image
                accessibilityIgnoresInvertColors
                accessibilityLabel={item.artworkLabel}
                fadeDuration={0}
                resizeMode="contain"
                source={item.artwork}
                style={styles.illustrationImage}
              />
            </View>
            {item.layout === "artwork-first" ? (
              <WelcomeSlideCopy
                compact={compact}
                landscape={landscape}
                slide={item}
                veryCompact={veryCompact}
              />
            ) : null}
          </View>
        )}
        scrollEnabled={!busy}
        showsHorizontalScrollIndicator={false}
        style={[styles.slider, { width: contentWidth }]}
        testID="prelogin-welcome-slides"
      />

      <View
        accessible
        accessibilityActions={[
          { name: "decrement", label: "Önceki tanıtım sayfası" },
          { name: "increment", label: "Sonraki tanıtım sayfası" },
        ]}
        accessibilityLabel={`${activeIndex + 1}. tanıtım sayfası seçili`}
        accessibilityRole="adjustable"
        accessibilityState={{ disabled: busy }}
        accessibilityValue={{
          max: WELCOME_SLIDES.length,
          min: 1,
          now: activeIndex + 1,
          text: `${activeIndex + 1} / ${WELCOME_SLIDES.length}`,
        }}
        onAccessibilityAction={(event) => {
          if (busy) return;
          if (event.nativeEvent.actionName === "increment") {
            selectSlide(activeIndex + 1);
          } else if (event.nativeEvent.actionName === "decrement") {
            selectSlide(activeIndex - 1);
          }
        }}
        style={[styles.pagination, veryCompact && styles.paginationVeryCompact]}
      >
        {WELCOME_SLIDES.map((slide, index) => (
          <Pressable
            accessible={false}
            accessibilityElementsHidden
            disabled={busy}
            hitSlop={4}
            importantForAccessibility="no-hide-descendants"
            key={slide.id}
            onPress={() => selectSlide(index)}
            style={styles.paginationTarget}
            testID={`prelogin-pagination-target-${index}`}
          >
            <View
              style={[
                styles.paginationDot,
                index === activeIndex ? styles.paginationDotActive : styles.paginationDotIdle,
              ]}
            />
          </Pressable>
        ))}
      </View>

      <View
        style={[styles.actionArea, { width: contentWidth }]}
        testID="prelogin-action-area"
      >
        <Button
          accessibilityHint={finalSlide
            ? "Giriş ekranını açar ve tanıtımı tamamlar."
            : "Sonraki tanıtım sayfasını gösterir."}
          fullWidth
          label={finalSlide ? "Başlayalım" : "Devam et"}
          labelStyle={[styles.actionLabel, compact && styles.actionLabelCompact]}
          loading={busy}
          maxFontSizeMultiplier={WELCOME_PRIMARY_MAX_FONT_SIZE_MULTIPLIER}
          onPress={finalSlide ? onContinue : () => selectSlide(activeIndex + 1)}
          style={[
            styles.actionButton,
            compact && styles.actionButtonCompact,
            { backgroundColor: busy ? BRAND_BLUE_PRESSED : BRAND_BLUE, borderColor: BRAND_BLUE },
          ]}
          testID="prelogin-continue-button"
          trailingIcon={finalSlide
            ? <Ionicons color={preLoginWelcomeColors.success} name="checkmark" size={24} />
            : <Ionicons color={referencePalette.white} name="chevron-forward" size={23} />}
        />
        <View style={styles.footerTrust} testID="prelogin-trust-footer">
          <Ionicons color={TRUST_BLUE} name="shield-checkmark-outline" size={17} />
          <Text
            maxFontSizeMultiplier={WELCOME_COMPACT_MAX_FONT_SIZE_MULTIPLIER}
            numberOfLines={2}
            style={[styles.footerText, veryCompact && styles.footerTextVeryCompact]}
          >
            Güvenilir akademik kaynaklar · Kontrol sende
          </Text>
        </View>
      </View>
    </View>
  );
}

function WelcomeSlideCopy({
  compact,
  landscape,
  slide,
  veryCompact,
}: {
  compact: boolean;
  landscape: boolean;
  slide: WelcomeSlide;
  veryCompact: boolean;
}) {
  const title = slide.id === "announcements" ? (
    <>
      Duyuruları{"\n"}
      <Text style={styles.slideTitleAccent}>tek yerden takip et</Text>
    </>
  ) : slide.id === "planning" ? (
    <>
      Dönemini{"\n"}
      <Text style={styles.slideTitleAccent}>rahatça</Text> planla
    </>
  ) : (
    <>
      Kendi düzenini{"\n"}oluştur
    </>
  );

  return (
    <View
      style={[
        styles.slideCopy,
        slide.layout === "copy-first" && styles.slideCopyFirst,
        compact && styles.slideCopyCompact,
        veryCompact && styles.slideCopyVeryCompact,
        landscape && styles.slideCopyLandscape,
      ]}
    >
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={WELCOME_PRIMARY_MAX_FONT_SIZE_MULTIPLIER}
        numberOfLines={landscape ? 4 : 3}
        style={[
          styles.slideTitle,
          compact && styles.slideTitleCompact,
          veryCompact && styles.slideTitleVeryCompact,
          landscape && styles.slideTitleLandscape,
        ]}
      >
        {title}
      </Text>
      <Text
        maxFontSizeMultiplier={WELCOME_PRIMARY_MAX_FONT_SIZE_MULTIPLIER}
        numberOfLines={veryCompact && !landscape ? 3 : 4}
        style={[
          styles.slideDetail,
          compact && styles.slideDetailCompact,
          landscape && styles.slideDetailLandscape,
        ]}
      >
        {slide.detail}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    flex: 1,
    overflow: "hidden",
  },
  brandRow: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 10,
    flexShrink: 0,
    minHeight: 58,
  },
  brandRowCompact: {
    gap: 8,
    minHeight: 48,
  },
  appMark: {
    height: 54,
    width: 54,
  },
  appMarkCompact: {
    height: 44,
    width: 44,
  },
  brandTitle: {
    color: BRAND_NAVY,
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 24,
  },
  brandTitleCompact: {
    fontSize: 18,
    lineHeight: 22,
  },
  skipButton: {
    alignItems: "center",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 48,
    paddingHorizontal: 6,
  },
  skipButtonPressed: {
    backgroundColor: referencePalette.academicBlueSoft,
  },
  skipText: {
    color: BRAND_BLUE,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 22,
  },
  slider: {
    alignSelf: "center",
    flex: 1,
    flexShrink: 1,
    minHeight: 0,
  },
  slide: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 0,
  },
  slideLandscape: {
    flexDirection: "row",
  },
  illustrationFrame: {
    alignItems: "center",
    alignSelf: "stretch",
    flexShrink: 1,
    justifyContent: "center",
    minHeight: 0,
    overflow: "hidden",
  },
  illustrationFrameLandscape: {
    alignSelf: "center",
    flex: 1.35,
    minHeight: 0,
  },
  illustrationImage: {
    height: "100%",
    width: "100%",
  },
  slideCopy: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 12,
  },
  slideCopyFirst: {
    paddingBottom: 14,
    paddingTop: 2,
  },
  slideCopyCompact: {
    gap: 5,
    paddingTop: 8,
  },
  slideCopyVeryCompact: {
    paddingHorizontal: 4,
    paddingTop: 5,
  },
  slideCopyLandscape: {
    flex: 1,
    paddingBottom: 4,
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  slideTitle: {
    color: BRAND_NAVY,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 36,
    textAlign: "center",
  },
  slideTitleAccent: {
    color: BRAND_BLUE,
  },
  slideTitleCompact: {
    fontSize: 24,
    lineHeight: 29,
  },
  slideTitleVeryCompact: {
    fontSize: 21,
    lineHeight: 25,
  },
  slideTitleLandscape: {
    fontSize: 20,
    lineHeight: 23,
  },
  slideDetail: {
    color: BRAND_BODY,
    fontSize: 16,
    fontWeight: "400",
    letterSpacing: 0,
    lineHeight: 23,
    maxWidth: 500,
    textAlign: "center",
  },
  slideDetailCompact: {
    fontSize: 14,
    lineHeight: 20,
  },
  slideDetailLandscape: {
    fontSize: 12,
    lineHeight: 17,
  },
  pagination: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    flexShrink: 0,
    minHeight: 48,
  },
  paginationVeryCompact: {
    minHeight: 48,
  },
  paginationTarget: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  paginationDot: {
    borderRadius: 5,
    height: 8,
  },
  paginationDotActive: {
    backgroundColor: BRAND_BLUE,
    width: 30,
  },
  paginationDotIdle: {
    backgroundColor: preLoginWelcomeColors.paginationIdle,
    width: 8,
  },
  actionArea: {
    flexShrink: 0,
    gap: 3,
  },
  actionButton: {
    minHeight: 58,
  },
  actionButtonCompact: {
    minHeight: 52,
  },
  actionLabel: {
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 24,
  },
  actionLabelCompact: {
    fontSize: 17,
    lineHeight: 22,
  },
  footerTrust: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 5,
    minHeight: 20,
  },
  footerText: {
    color: BRAND_BODY,
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0,
    lineHeight: 15,
    textAlign: "center",
  },
  footerTextVeryCompact: {
    fontSize: 10,
    lineHeight: 13,
  },
});
