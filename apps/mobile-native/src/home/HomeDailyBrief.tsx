import { Ionicons } from "@expo/vector-icons";
import { useNetworkState } from "expo-network";
import { useScrollToTop } from "@react-navigation/native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Banner,
  Button,
  Card,
  Skeleton,
  homeDailyBriefColors,
  referencePalette,
  usePlatformAdaptation,
  useTheme,
} from "../design-system";
import {
  admitTrustedContentRecord,
  contentTimestampLabel,
  type ContentCollectionState,
  type TrustedMobileContentRecord,
} from "../content/content-trust";
import {
  formatRemainingTime,
  homeAvailability,
  resolveActionableIntegration,
  resolveHomeLayout,
  resolveHomePrimaryState,
  selectImportantAnnouncement,
  selectHomeDayMarkerKind,
  selectNearestImportantItem,
  selectRecentAnnouncements,
  selectTodayItems,
  summarizeHomeWeek,
  type HomeAcademicEvent,
  type HomeImportantKind,
  type HomeImportantItem,
  type HomeManualExam,
  type HomeWeeklySummary,
} from "./home-model";
import {
  formatCalendarClock,
  formatCalendarDateRange,
  formatCalendarTemporal,
} from "../calendar/calendar-time";
import { academicCalendarDayNumber } from "../temporal/academic-temporal";
import {
  officialContentDomain,
  shortContentCardExcerpt,
  trustedContentDestinationUrl,
} from "../announcements/content-card";

export interface HomeDailyBriefProps {
  fullName: string;
  profileComplete: boolean;
  universityName?: string;
  facultyName?: string;
  departmentName?: string;
  events: readonly HomeAcademicEvent[];
  manualExams: readonly HomeManualExam[];
  announcements: readonly TrustedMobileContentRecord[];
  calendarLoading: boolean;
  calendarAttempted: boolean;
  calendarError?: string;
  calendarStale?: boolean;
  announcementLoading: boolean;
  announcementAttempted: boolean;
  announcementError?: string;
  announcementStale?: boolean;
  announcementState?: ContentCollectionState;
  /**
   * Authoritative unread/new count from a source that actually tracks that
   * state. Omit when only the total trusted announcement collection is known.
   */
  announcementNewCount?: number;
  offline?: boolean;
  googleCalendarState: string;
  notificationPermission: string;
  notificationPreferenceEnabled: boolean;
  notificationActive: boolean;
  onOpenAccountMenu?: () => void;
  onCompleteProfile: () => void;
  onOpenAnnouncement: (item: TrustedMobileContentRecord) => void;
  onOpenAnnouncements: () => void;
  onOpenCalendar: () => void;
  onCreatePersonalEvent: () => void;
  onOpenGoogleCalendarSettings: () => void;
  onOpenNotificationSettings: () => void;
  onRefresh: () => void;
  now?: Date;
  /**
   * Optional visual anchor for the compact week strip. Production callers omit
   * this so the strip and summary continue to follow `now`. Deterministic DEV
   * previews can focus the week containing the next highlighted event without
   * changing the clock used for countdowns.
   */
  weekAnchorDate?: Date;
  /** Deterministic DEV/reference previews only; production uses the computed model summary. */
  weeklySummaryOverride?: HomeWeeklySummary;
}

type BriefModule = "agenda" | "announcements" | "profile" | "integration";
type AgendaFilter = "all" | "academic" | "personal";

const academicCalendarLogo = require("../../assets/design-package/academic-calendar-logo.png");
const homeCampusSilhouette = require("../../assets/home-campus-silhouette-v1.png");

const REFERENCE_COLORS = {
  background: referencePalette.white,
  blue: referencePalette.academicBlue,
  blueDeep: referencePalette.academicBlueDeep,
  blueSoft: referencePalette.academicBlueSoft,
  border: referencePalette.academicBorder,
  green: referencePalette.academicGreen,
  greenSoft: referencePalette.academicGreenSoft,
  navy: referencePalette.navy,
  orange: referencePalette.academicOrange,
  orangeSoft: referencePalette.academicOrangeSoft,
  red: referencePalette.academicRed,
  redSoft: referencePalette.academicRedSoft,
  secondary: referencePalette.academicTextSecondary,
  teal: referencePalette.academicTeal,
  tealSoft: referencePalette.academicTealSoft,
  white: referencePalette.white,
} as const;

function boundedTextLineHeight(baseLineHeight: number, fontScale: number, maximumMultiplier: number): number {
  if (!Number.isFinite(fontScale) || fontScale <= maximumMultiplier) return baseLineHeight;
  return (baseLineHeight * maximumMultiplier) / fontScale;
}

export function HomeDailyBrief(props: HomeDailyBriefProps) {
  const adaptation = usePlatformAdaptation();
  const theme = useTheme();
  const networkState = useNetworkState();
  const { fontScale, width } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const layout = resolveHomeLayout(width, fontScale);
  const compactHero = width < 375 || layout.supportsLargeText;
  const bottomNavigationClearance = adaptation.navigationLayout === "navigation-rail"
    ? theme.spacing.xxl
    : 64 + safeAreaInsets.bottom + theme.spacing.lg;
  const listRef = useRef<FlatList<BriefModule> | null>(null);
  useScrollToTop(listRef);
  const [clock, setClock] = useState(props.now ?? new Date());
  const [profilePromptDismissed, setProfilePromptDismissed] = useState(false);
  const [agendaFilter, setAgendaFilter] = useState<AgendaFilter>("all");
  const weekAnchorDate = props.weekAnchorDate ?? clock;

  useEffect(() => {
    if (props.now) {
      setClock(props.now);
      return;
    }
    const timer = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [props.now]);

  const futureEvents = useMemo(
    () => props.events
      .filter((event) => isHomeStartCurrentOrFuture(event.startDate, event.temporalKind, clock))
      .map((event) => ({ ...event, title: normalizeHomeScheduleTitle(event.title) })),
    [clock, props.events],
  );
  const futureManualExams = useMemo(
    () => props.manualExams
      .filter((exam) => isHomeStartCurrentOrFuture(exam.examDate, undefined, clock))
      .map((exam) => ({ ...exam, title: normalizeHomeScheduleTitle(exam.title) })),
    [clock, props.manualExams],
  );
  const todayItems = useMemo(
    () => selectTodayItems(futureEvents, futureManualExams, clock),
    [clock, futureEvents, futureManualExams],
  );
  const nextItem = useMemo(
    () => selectNearestImportantItem(futureEvents, futureManualExams, clock),
    [clock, futureEvents, futureManualExams],
  );
  const agendaItems = useMemo(
    () => selectAgendaItems(futureEvents, futureManualExams, todayItems, nextItem, clock),
    [clock, futureEvents, futureManualExams, nextItem, todayItems],
  );
  const filteredAgendaItems = useMemo(
    () => agendaItems.filter((item) => {
      if (agendaFilter === "all") return true;
      const personal = item.category.startsWith("personal_");
      return agendaFilter === "personal" ? personal : !personal;
    }),
    [agendaFilter, agendaItems],
  );
  const computedWeeklySummary = useMemo(
    () => summarizeHomeWeek(futureEvents, futureManualExams, weekAnchorDate),
    [futureEvents, futureManualExams, weekAnchorDate],
  );
  const weeklySummary = __DEV__ && props.weeklySummaryOverride
    ? props.weeklySummaryOverride
    : computedWeeklySummary;
  const trustedAnnouncements = useMemo(
    () => props.announcements.flatMap((item) => {
      const admitted = admitTrustedContentRecord(item);
      return admitted ? [admitted] : [];
    }),
    [props.announcements]
  );
  const importantAnnouncement = useMemo(
    () => selectImportantAnnouncement(trustedAnnouncements),
    [trustedAnnouncements]
  );
  const recentAnnouncements = useMemo(
    () => selectRecentAnnouncements(trustedAnnouncements, importantAnnouncement?.id),
    [importantAnnouncement?.id, trustedAnnouncements]
  );
  const profileComplete = props.profileComplete;
  const loading = props.calendarLoading || props.announcementLoading;
  const attempted = props.calendarAttempted && props.announcementAttempted;
  const hasUsefulData = Boolean(todayItems.length || nextItem || importantAnnouncement || recentAnnouncements.length);
  const error = props.calendarError ?? props.announcementError;
  const offline = props.offline ?? (
    networkState.isConnected === false || networkState.isInternetReachable === false
  );
  const primaryState = resolveHomePrimaryState({
    profileComplete,
    loading,
    attempted,
    hasData: hasUsefulData,
    error,
    contentState: props.announcementState,
    offline,
  });
  const availability = homeAvailability({
    loading,
    hasRetainedData: hasUsefulData,
    error,
    stale: props.calendarStale || props.announcementStale,
    contentState: props.announcementState,
    offline,
  });
  const nextItemRemaining = nextItem
    ? formatRemainingTime(
        nextItem.date,
        clock,
        nextItem.endDate,
        nextItem.temporalKind,
        nextItem.endTemporalKind,
      )
    : null;
  const heroBadgeLabel = availability === "refreshing"
    ? "Plan yenileniyor"
    : availability === "offline"
      ? "Son kayıtlı plan"
      : availability === "stale"
        ? "Son doğrulanan plan"
        : availability === "partial"
          ? "Kısmi plan"
          : nextItemRemaining ?? "Takvimi görüntüle";
  const focusAccessibilityLabel = nextItem
    ? [
        nextItem.title,
        agendaTypeLabel(nextItem),
        formatCalendarTemporal({
          startDate: nextItem.date,
          ...(nextItem.endDate ? { endDate: nextItem.endDate } : {}),
          ...(nextItem.temporalKind ? { temporalKind: nextItem.temporalKind } : {}),
          ...(nextItem.endTemporalKind ? { endTemporalKind: nextItem.endTemporalKind } : {}),
          ...(nextItem.timezone ? { timezone: nextItem.timezone } : {}),
        }),
        nextItem.courseName,
        nextItem.location,
        heroBadgeLabel,
        "Takvimi aç",
      ].filter(Boolean).join(". ") + "."
    : `Akademik takvimin. ${heroBadgeLabel}. Takvimi aç.`;
  const integration = resolveActionableIntegration({
    profileComplete,
    googleCalendarState: props.googleCalendarState,
    notificationPermission: props.notificationPermission,
    notificationPreferenceEnabled: props.notificationPreferenceEnabled,
    notificationActive: props.notificationActive,
  });
  const showAnnouncements = Boolean(importantAnnouncement || recentAnnouncements.length);
  const modules: BriefModule[] = [
    ...(primaryState === "populated" ? ["agenda"] as const : []),
    ...(primaryState === "populated" && showAnnouncements ? ["announcements"] as const : []),
    ...(primaryState === "populated"
      && !profilePromptDismissed
      && (!props.facultyName || !props.departmentName)
      ? ["profile"] as const
      : []),
    ...(integration === "notifications" && primaryState !== "incomplete_profile" && primaryState !== "initial_loading"
      ? ["integration" as const]
      : []),
  ];

  const renderModule: ListRenderItem<BriefModule> = ({ item }) => {
    switch (item) {
      case "agenda":
        return (
          <BriefSection
            title="Senin için"
          >
            <AgendaFilterControl selected={agendaFilter} onChange={setAgendaFilter} />
            {filteredAgendaItems.length ? (
              <View style={styles.agendaList}>
                <Text accessibilityRole="header" style={styles.visuallyHidden}>Sıradaki önemli tarih</Text>
                {filteredAgendaItems.map((event) => (
                  <CompactAgendaRow
                    event={event}
                    key={`${event.kind}:${event.id}`}
                    onPress={props.onOpenCalendar}
                  />
                ))}
              </View>
            ) : (
              <View style={{ gap: theme.spacing.sm }}>
                <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Bu filtrede yaklaşan bir tarih bulunamadı.</Text>
                <Button compact label="Takvimde aç" onPress={props.onOpenCalendar} variant="ghost" />
              </View>
            )}
            <Pressable
              accessibilityLabel="Kişisel etkinlik ekle"
              accessibilityRole="button"
              onPress={props.onCreatePersonalEvent}
              style={({ pressed }) => [
                styles.personalEventButton,
                pressed && styles.planHeroPressed,
              ]}
            >
              <View style={styles.personalEventIcon}>
                <Ionicons color={REFERENCE_COLORS.blueDeep} name="add" size={21} />
              </View>
              <Text style={[theme.typography.bodyStrong, styles.personalEventLabel]}>Kişisel etkinlik ekle</Text>
              <Ionicons color={REFERENCE_COLORS.white} name="chevron-forward" size={20} />
            </Pressable>
          </BriefSection>
        );
      case "announcements": {
        const previewItems = [
          ...(importantAnnouncement ? [importantAnnouncement] : []),
          ...recentAnnouncements,
        ].slice(0, 2);
        return (
          <BriefSection
            accessibilityTitle={importantAnnouncement ? "Önemli duyuru" : "Son duyurular"}
            actionAccessibilityLabel="Tümünü aç"
            actionLabel="Tümünü Gör"
            onAction={props.onOpenAnnouncements}
            title="Öne çıkan duyurular"
          >
            <View style={styles.announcementList}>
              {previewItems.map((announcement) => (
                <AnnouncementCard
                  item={announcement}
                  key={announcement.id}
                  onPress={props.onOpenAnnouncement}
                />
              ))}
            </View>
          </BriefSection>
        );
      }
      case "profile":
        return (
          <ProfileCompletionCard
            onDismiss={() => setProfilePromptDismissed(true)}
            onPress={props.onCompleteProfile}
          />
        );
      case "integration":
        return (
          <View style={{ gap: theme.spacing.sm }}>
            <Banner
              actionLabel="Ayarları aç"
              message="Akademik hatırlatmaların ulaşması için bildirim durumunu kontrol et."
              onAction={props.onOpenNotificationSettings}
              title="Bildirimlerini tamamla"
            />
          </View>
        );
    }
  };

  return (
    <FlatList
      ref={listRef}
      accessibilityLabel="Öğrenci günlük özeti"
      accessibilityState={{ busy: primaryState === "initial_loading" || availability === "refreshing" }}
      data={modules}
      keyExtractor={(item) => item}
      renderItem={renderModule}
      refreshing={availability === "refreshing"}
      onRefresh={profileComplete ? props.onRefresh : undefined}
      contentContainerStyle={[
        styles.list,
        {
          alignSelf: "center",
          gap: theme.spacing.lg,
          maxWidth: layout.maxWidth,
          paddingHorizontal: layout.gutter,
          paddingBottom: Math.max(theme.spacing.xxl, bottomNavigationClearance, 48),
          width: "100%",
        },
      ]}
      ListHeaderComponent={(
        <View style={styles.homeHeader}>
          <View
            style={[
              styles.brandHero,
              {
                marginHorizontal: -layout.gutter,
                paddingHorizontal: layout.gutter,
              },
            ]}
          >
            <Image
              accessibilityElementsHidden
              accessibilityIgnoresInvertColors
              importantForAccessibility="no-hide-descendants"
              resizeMode="cover"
              source={homeCampusSilhouette}
              style={styles.homeCampusSilhouette}
            />
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.homeHeroGlow} />
            <HomeTopBar
              fontScale={fontScale}
              fullName={props.fullName}
              onOpenAccount={props.onOpenAccountMenu}
              onOpenNotifications={props.onOpenNotificationSettings}
              showNotificationAttention={props.notificationPreferenceEnabled && !props.notificationActive}
            />
            <View
              accessible
              accessibilityLabel={`Merhaba, ${firstName(props.fullName)}. Derslerin, duyuruların ve takvimin burada.`}
              style={styles.identityCopy}
            >
              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={1.35}
                numberOfLines={1}
                style={[
                  theme.typography.screenTitle,
                  styles.greetingTitle,
                  {
                    color: REFERENCE_COLORS.white,
                    lineHeight: boundedTextLineHeight(styles.greetingTitle.lineHeight, fontScale, 1.35),
                  },
                ]}
              >
                Merhaba, {firstName(props.fullName)}
              </Text>
              <Text
                maxFontSizeMultiplier={1.3}
                style={styles.greetingSubtitle}
              >
                Derslerin, duyuruların ve takvimin burada.
              </Text>
            </View>
          </View>
          {primaryState === "populated" && nextItem ? (
            <Pressable
              accessibilityLabel={focusAccessibilityLabel}
              accessibilityRole="button"
              android_ripple={adaptation.pressFeedback === "ripple"
                ? { color: theme.colors.state.pressed, borderless: false }
                : undefined}
              onPress={props.onOpenCalendar}
              testID="home-focus-card"
              style={({ pressed }) => [
                styles.planHero,
                {
                  backgroundColor: theme.colors.background.surface,
                  borderColor: theme.colors.border.subtle,
                },
                pressed && adaptation.pressFeedback !== "ripple" ? styles.planHeroPressed : null,
              ]}
            >
              <View style={[styles.heroCountdownColumn, compactHero && styles.heroCountdownColumnCompact]}>
                <Ionicons color={REFERENCE_COLORS.blueDeep} name="calendar-outline" size={23} />
                <Text
                  maxFontSizeMultiplier={1.2}
                  numberOfLines={1}
                  style={[
                    theme.typography.display,
                    styles.heroCountdownValue,
                    {
                      color: REFERENCE_COLORS.navy,
                      lineHeight: boundedTextLineHeight(styles.heroCountdownValue.lineHeight, fontScale, 1.2),
                    },
                  ]}
                >
                  {countdownParts(nextItem, clock).value}
                </Text>
                <Text
                  adjustsFontSizeToFit={!layout.supportsLargeText}
                  maxFontSizeMultiplier={1.25}
                  minimumFontScale={0.78}
                  numberOfLines={layout.supportsLargeText ? 2 : 1}
                  style={[
                    theme.typography.metaStrong,
                    styles.heroCountdownLabel,
                    {
                      color: REFERENCE_COLORS.teal,
                      lineHeight: boundedTextLineHeight(theme.typography.metaStrong.lineHeight, fontScale, 1.25),
                    },
                  ]}
                >
                  gün kaldı
                </Text>
              </View>
              <View style={[styles.heroCopy, layout.supportsLargeText && styles.heroCopyLargeText]}>
                <View style={styles.focusHeader}>
                  <View style={styles.focusPill}>
                    <Text
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                      style={[
                        theme.typography.metaStrong,
                        {
                          color: REFERENCE_COLORS.blueDeep,
                          lineHeight: boundedTextLineHeight(theme.typography.metaStrong.lineHeight, fontScale, 1.3),
                        },
                      ]}
                    >
                      Sıradaki Etkinlik
                    </Text>
                  </View>
                </View>
                <Text
                  maxFontSizeMultiplier={1.35}
                  numberOfLines={layout.supportsLargeText ? 2 : 3}
                  style={[
                    theme.typography.sectionTitle,
                    styles.heroTitle,
                    {
                      color: REFERENCE_COLORS.navy,
                      lineHeight: boundedTextLineHeight(styles.heroTitle.lineHeight, fontScale, 1.35),
                    },
                  ]}
                >
                  {nextItem?.title ?? "Akademik takvimin"}
                </Text>
                {nextItem?.courseName ? (
                  <View style={styles.heroCourseRow}>
                    <Ionicons color={REFERENCE_COLORS.secondary} name="book-outline" size={14} />
                    <Text
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                      style={[
                        theme.typography.meta,
                        styles.heroCourse,
                        {
                          color: REFERENCE_COLORS.secondary,
                          lineHeight: boundedTextLineHeight(theme.typography.meta.lineHeight, fontScale, 1.3),
                        },
                      ]}
                    >
                      {nextItem.courseName}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.heroMetaRow}>
                  <View style={styles.heroMetaChip}>
                    <Ionicons color={REFERENCE_COLORS.blueDeep} name="calendar-outline" size={15} />
                    <Text
                      adjustsFontSizeToFit={!layout.supportsLargeText}
                      ellipsizeMode="tail"
                      maxFontSizeMultiplier={1.3}
                      minimumFontScale={0.78}
                      numberOfLines={1}
                      style={[
                        theme.typography.metaStrong,
                        styles.heroScheduleText,
                        {
                          color: REFERENCE_COLORS.navy,
                          lineHeight: boundedTextLineHeight(theme.typography.metaStrong.lineHeight, fontScale, 1.3),
                        },
                      ]}
                    >
                      {nextItem ? compactTemporalDate(nextItem.date, compactHero) : "Takvimi görüntüle"}
                    </Text>
                  </View>
                  <View style={styles.heroMetaChip}>
                    <Ionicons color={REFERENCE_COLORS.blueDeep} name="time-outline" size={15} />
                    <Text
                      ellipsizeMode="tail"
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                      style={[
                        theme.typography.metaStrong,
                        styles.heroScheduleText,
                        {
                          color: REFERENCE_COLORS.navy,
                          lineHeight: boundedTextLineHeight(theme.typography.metaStrong.lineHeight, fontScale, 1.3),
                        },
                      ]}
                    >
                      {nextItem
                        ? compactTemporalTime(nextItem.date, nextItem.temporalKind, nextItem.timezone)
                        : heroBadgeLabel}
                    </Text>
                  </View>
                </View>
              </View>
              <Ionicons color={REFERENCE_COLORS.blueDeep} name="chevron-forward" size={21} />
            </Pressable>
          ) : null}
          {primaryState === "populated" ? (
            <>
              <WeeklyCalendarStrip
                events={props.events}
                fontScale={fontScale}
                manualExams={props.manualExams}
                now={weekAnchorDate}
                onOpenCalendar={props.onOpenCalendar}
              />
              <View style={[styles.summaryGrid, layout.supportsLargeText && styles.summaryGridStacked]}>
                <WeeklySummaryCard
                  summary={weeklySummary}
                  onPress={props.onOpenCalendar}
                />
                <AnnouncementSummaryCard
                  count={trustedAnnouncements.length}
                  newCount={props.announcementNewCount}
                  onPress={props.onOpenAnnouncements}
                />
              </View>
            </>
          ) : null}
          {availability !== "ready" && primaryState === "populated" ? (
            <AvailabilityBanner availability={availability} error={error} onRefresh={props.onRefresh} />
          ) : null}
          {primaryState === "incomplete_profile" ? (
            <Card
              style={[
                styles.stateCard,
                {
                  borderColor: theme.colors.action.secondary,
                  borderRadius: theme.radii.prominent,
                  gap: theme.spacing.md,
                },
              ]}
              variant="elevated"
            >
              <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>Akademik profilin eksik</Text>
              <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Üniversiteni seçtiğinde takvim ve güvenilir duyurular günlük özetinde görünür.</Text>
              <Button label="Akademik profili tamamla" onPress={props.onCompleteProfile} />
            </Card>
          ) : primaryState === "initial_loading" ? (
            <View accessible accessibilityLabel="Günlük özet yükleniyor" accessibilityRole="progressbar" accessibilityState={{ busy: true }} style={{ gap: theme.spacing.sm }}>
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: theme.spacing.sm }}>
                <Skeleton decorative height={24} width="55%" />
                <Skeleton decorative height={92} />
                <Skeleton decorative height={128} />
              </View>
            </View>
          ) : primaryState === "offline_no_data" ? (
            <Banner title="Çevrimdışısın" message="Bu cihazda gösterilecek kayıtlı bir günlük özet yok. Bağlantını kontrol edip yeniden deneyebilirsin." tone="warning" actionLabel="Yeniden dene" onAction={props.onRefresh} />
          ) : primaryState === "partial_no_data" ? (
            <Banner title="Bazı kaynaklara ulaşılamadı" message="Ulaşılabilen kaynaklarda şu anda gösterilecek bir günlük özet bulunamadı." tone="warning" actionLabel="Yeniden dene" onAction={props.onRefresh} />
          ) : primaryState === "recoverable_error" ? (
            <Banner title="Günlük özet yüklenemedi" message={error ?? "Bağlantını kontrol edip yeniden deneyebilirsin."} tone="error" actionLabel="Tekrar dene" onAction={props.onRefresh} />
          ) : primaryState === "empty" ? (
            <Card
              style={[
                styles.stateCard,
                {
                  borderColor: theme.colors.action.secondary,
                  borderRadius: theme.radii.prominent,
                  gap: theme.spacing.md,
                },
              ]}
              variant="elevated"
            >
              <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>Bugün gündemin sakin</Text>
              <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Bugün veya yakında gösterilecek akademik tarih ve güvenilir duyuru bulunamadı.</Text>
              <Button label="Takvimi aç" onPress={props.onOpenCalendar} variant="secondary" />
            </Card>
          ) : null}
        </View>
      )}
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: REFERENCE_COLORS.background, flex: 1 }}
      testID={`home-${adaptation.platform}-${layout.gutter}-${layout.supportsLargeText ? "large-text" : "standard-text"}`}
    />
  );
}

function HomeTopBar({
  fontScale,
  fullName,
  onOpenAccount,
  onOpenNotifications,
  showNotificationAttention,
}: {
  fontScale: number;
  fullName: string;
  onOpenAccount?: () => void;
  onOpenNotifications: () => void;
  showNotificationAttention: boolean;
}) {
  return (
    <View style={styles.topBar} testID="home-top-bar">
      <View accessibilityLabel="Akademik Takvim" style={styles.homeBrand}>
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={academicCalendarLogo}
          style={styles.homeBrandLogo}
        />
        <Text
          adjustsFontSizeToFit
          maxFontSizeMultiplier={1.35}
          minimumFontScale={0.8}
          numberOfLines={2}
          style={[
            styles.homeBrandTitle,
            { lineHeight: boundedTextLineHeight(styles.homeBrandTitle.lineHeight, fontScale, 1.35) },
          ]}
        >
          Akademik Takvim
        </Text>
      </View>
      <View style={styles.topBarActions}>
        <Pressable
          accessibilityLabel={showNotificationAttention
            ? "Bildirim tercihlerini aç. Bildirimlerin etkinleştirilmesi gerekiyor."
            : "Bildirim tercihlerini aç"}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onOpenNotifications}
          style={({ pressed }) => [styles.notificationButton, pressed && styles.planHeroPressed]}
        >
          <Ionicons color={REFERENCE_COLORS.white} name="notifications-outline" size={24} />
          {showNotificationAttention ? (
            <View style={styles.notificationDot} testID="notification-attention-indicator" />
          ) : null}
        </Pressable>
        <Pressable
          accessibilityLabel="Hesap menüsünü aç"
          accessibilityRole="button"
          disabled={!onOpenAccount}
          hitSlop={8}
          onPress={onOpenAccount}
          style={({ pressed }) => [styles.avatar, pressed && styles.planHeroPressed]}
        >
          <Text maxFontSizeMultiplier={1.25} numberOfLines={1} style={styles.avatarLabel}>{initialsForName(fullName)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function WeeklyCalendarStrip({
  events,
  fontScale,
  manualExams,
  now,
  onOpenCalendar,
}: {
  events: readonly HomeAcademicEvent[];
  fontScale: number;
  manualExams: readonly HomeManualExam[];
  now: Date;
  onOpenCalendar: () => void;
}) {
  const theme = useTheme();
  const weekStart = startOfLocalWeek(now);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });

  return (
    <View style={[
      styles.weeklyCalendar,
      fontScale <= 1.45 && styles.weeklyCalendarStandard,
    ]}>
      {fontScale > 1.45 ? (
        <View style={[styles.weeklyCalendarHeader, styles.weeklyCalendarHeaderLargeText]}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            style={[
              theme.typography.sectionTitle,
              styles.weeklyCalendarTitle,
              styles.weeklyCalendarTitleLargeText,
              { lineHeight: boundedTextLineHeight(theme.typography.sectionTitle.lineHeight, fontScale, 1.3) },
            ]}
          >
            Haftalık Takvim
          </Text>
          <Pressable
            accessibilityLabel="Takvimi gör"
            accessibilityRole="button"
            onPress={onOpenCalendar}
            style={({ pressed }) => [
              styles.calendarLinkLargeText,
              pressed && styles.planHeroPressed,
            ]}
          >
            <View style={styles.calendarLinkSurface}>
              <Ionicons color={REFERENCE_COLORS.blueDeep} name="calendar-outline" size={16} />
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                style={[
                  theme.typography.metaStrong,
                  {
                    color: REFERENCE_COLORS.blueDeep,
                    lineHeight: boundedTextLineHeight(theme.typography.metaStrong.lineHeight, fontScale, 1.2),
                  },
                ]}
              >
                Takvimi Gör
              </Text>
            </View>
          </Pressable>
        </View>
      ) : (
        <Text accessibilityRole="header" style={styles.visuallyHidden}>Haftalık Takvim</Text>
      )}
      <View style={styles.weekDays}>
        {days.map((day) => {
          const selected = sameLocalDay(day, now);
          const marker = markerColorForDay(day, events, manualExams);
          const dayName = day.toLocaleDateString("tr-TR", { weekday: "short" })
            .replace(".", "")
            .toLocaleUpperCase("tr-TR");
          return (
            <Pressable
              accessibilityLabel={`${dayName}, ${day.getDate()} ${day.toLocaleDateString("tr-TR", { month: "long" })}. Takvimi aç.`}
              accessibilityRole="button"
              key={day.toISOString()}
              onPress={onOpenCalendar}
              style={({ pressed }) => [styles.weekDayTarget, pressed && styles.planHeroPressed]}
            >
              <Text
                maxFontSizeMultiplier={1.15}
                numberOfLines={1}
                style={[
                  theme.typography.navLabel,
                  styles.weekDayName,
                  { lineHeight: boundedTextLineHeight(theme.typography.navLabel.lineHeight, fontScale, 1.15) },
                ]}
              >
                {dayName}
              </Text>
              <View style={[styles.weekDayCard, selected && styles.weekDayCardSelected]}>
                <Text style={[
                  theme.typography.bodyStrong,
                  styles.weekDayNumber,
                  selected && styles.weekDayNumberSelected,
                  { lineHeight: boundedTextLineHeight(theme.typography.bodyStrong.lineHeight, fontScale, 1.2) },
                ]} maxFontSizeMultiplier={1.2} numberOfLines={1}>
                  {day.getDate()}
                </Text>
                <View
                  style={[
                    styles.weekDayMarker,
                    { backgroundColor: selected ? REFERENCE_COLORS.white : marker ?? "transparent" },
                  ]}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function WeeklySummaryCard({
  summary,
  onPress,
}: {
  summary: HomeWeeklySummary;
  onPress: () => void;
}) {
  const theme = useTheme();
  const breakdown = [
    summary.applications ? `${summary.applications} başvuru` : null,
    summary.registrations ? `${summary.registrations} kayıt` : null,
    summary.exams ? `${summary.exams} sınav` : null,
  ].filter(Boolean).join(" · ") || "Planlanan önemli tarih yok";
  return (
    <Pressable
      accessibilityLabel={`Bu hafta ${summary.total} önemli tarih. ${breakdown}. Haftayı görüntüle.`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.weekSummaryCard, pressed && styles.planHeroPressed]}
    >
      <View style={styles.summaryIconSurface}>
        <Ionicons color={REFERENCE_COLORS.teal} name="calendar-clear-outline" size={26} />
      </View>
      <View style={styles.summaryCopy}>
        <Text style={[theme.typography.metaStrong, styles.summaryCardEyebrow]}>Bu hafta</Text>
        <View style={styles.summaryValueRow}>
          <Text style={[theme.typography.display, styles.summaryCardValue]}>{summary.total}</Text>
          <Text numberOfLines={2} style={[theme.typography.metaStrong, styles.summaryCardDetail]}>önemli tarih</Text>
        </View>
      </View>
      <Text style={styles.visuallyHidden}>{breakdown}</Text>
    </Pressable>
  );
}

function AnnouncementSummaryCard({
  count,
  newCount,
  onPress,
}: {
  count: number;
  newCount?: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const hasAuthoritativeNewCount = Number.isFinite(newCount) && (newCount ?? -1) >= 0;
  const displayCount = hasAuthoritativeNewCount
    ? Math.min(count, Math.floor(newCount ?? 0))
    : count;
  const detail = hasAuthoritativeNewCount ? "yeni" : "duyuru";
  const accessibilityHint = hasAuthoritativeNewCount
    ? `${displayCount} yeni duyuru bulunuyor; toplam ${count} güncel duyuru var.`
    : `${count} güncel duyuru bulunuyor.`;
  return (
    <Pressable
      accessible
      accessibilityHint={accessibilityHint}
      accessibilityLabel="Duyuru özeti"
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.announcementSummaryCard, pressed && styles.planHeroPressed]}
    >
      <View style={[styles.summaryIconSurface, styles.announcementSummaryIconSurface]}>
        <Ionicons color={REFERENCE_COLORS.orange} name="megaphone-outline" size={27} />
      </View>
      <View style={styles.summaryCopy}>
        <Text style={[theme.typography.metaStrong, styles.announcementSummaryEyebrow]}>Duyurular</Text>
        <View style={styles.summaryValueRow}>
          <Text style={[theme.typography.display, styles.announcementSummaryValue]}>{displayCount}</Text>
          <Text numberOfLines={2} style={[theme.typography.metaStrong, styles.announcementSummaryDetail]}>{detail}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function AgendaFilterControl({
  selected,
  onChange,
}: {
  selected: AgendaFilter;
  onChange: (filter: AgendaFilter) => void;
}) {
  const theme = useTheme();
  const { fontScale, width } = useWindowDimensions();
  const scrollable = width < 360 || fontScale >= 1.35;
  const options: readonly { label: string; value: AgendaFilter }[] = [
    { label: "Tümü", value: "all" },
    { label: "Akademik", value: "academic" },
    { label: "Kişisel", value: "personal" },
  ];
  const controls = options.map((option) => {
    const active = selected === option.value;
    return (
      <Pressable
        accessibilityLabel={option.label}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        key={option.value}
        onPress={() => onChange(option.value)}
        style={({ pressed }) => [
          styles.agendaFilterTarget,
          pressed && styles.planHeroPressed,
        ]}
      >
        <View style={[
          styles.agendaFilterSurface,
          active && styles.agendaFilterActive,
        ]}>
          <Text style={[
            theme.typography.metaStrong,
            styles.agendaFilterLabel,
            active && styles.agendaFilterLabelActive,
          ]}>
            {option.label}
          </Text>
        </View>
      </Pressable>
    );
  });

  if (scrollable) {
    return (
      <ScrollView
        accessibilityLabel="Etkinlik filtresi"
        accessibilityRole="tablist"
        alwaysBounceHorizontal={false}
        contentContainerStyle={styles.agendaFiltersScrollableContent}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.agendaFiltersScrollable}
        testID="home-agenda-filters-scroll"
      >
        {controls}
      </ScrollView>
    );
  }

  return (
    <View accessibilityLabel="Etkinlik filtresi" accessibilityRole="tablist" style={styles.agendaFilters}>
      {controls}
    </View>
  );
}

function ProfileCompletionCard({
  onDismiss,
  onPress,
}: {
  onDismiss: () => void;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.profilePrompt} testID="home-profile-completion-card">
      <Pressable
        accessibilityLabel="Akademik profil önerisini kapat"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onDismiss}
        style={({ pressed }) => [styles.profilePromptDismiss, pressed && styles.planHeroPressed]}
      >
        <Ionicons color={REFERENCE_COLORS.secondary} name="close" size={19} />
      </Pressable>
      <View style={styles.profilePromptBody}>
        <View style={styles.profilePromptIcon}>
          <Ionicons color={REFERENCE_COLORS.teal} name="person-outline" size={23} />
        </View>
        <View style={styles.profilePromptCopy}>
          <Text style={[theme.typography.bodyStrong, { color: referencePalette.academicTealTitle }]}>Akademik profilini tamamla</Text>
          <Text
            style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}
          >
            Fakülte, bölüm ve sınıf bilgilerinle sana özel öneriler sunalım.
          </Text>
        </View>
        <ProfileCompletionArtwork />
      </View>
      <Pressable
        accessibilityLabel="Akademik profili tamamla"
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.profilePromptAction, pressed && styles.planHeroPressed]}
      >
        <View style={styles.profilePromptActionSurface}>
          <Text style={[theme.typography.metaStrong, { color: referencePalette.academicTealAction }]}>Profili Tamamla</Text>
          <Ionicons color={referencePalette.academicTealAction} name="chevron-forward" size={17} />
        </View>
      </Pressable>
    </View>
  );
}

function ProfileCompletionArtwork() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.profileArtwork}
    >
      <View style={styles.profileArtworkCard}>
        <View style={styles.profileArtworkAvatar}>
          <Ionicons color={REFERENCE_COLORS.blue} name="person" size={12} />
        </View>
        <View style={styles.profileArtworkLines}>
          <View style={styles.profileArtworkLineStrong} />
          <View style={styles.profileArtworkLine} />
          <View style={styles.profileArtworkLineShort} />
        </View>
      </View>
      <View style={styles.profileArtworkCheck}>
        <Ionicons color={REFERENCE_COLORS.white} name="checkmark" size={14} />
      </View>
    </View>
  );
}

function countdownParts(
  item: HomeImportantItem | null,
  now: Date,
): { value: string; unit: string } {
  if (!item) return { value: "–", unit: "TAKVİM" };
  const date = parseHomeDate(item.date);
  if (!date) return { value: "–", unit: "GÜN KALDI" };
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.max(0, Math.ceil((dateStart - todayStart) / 86_400_000));
  return days === 0
    ? { value: "0", unit: "BUGÜN" }
    : { value: String(days), unit: "GÜN KALDI" };
}

function isHomeStartCurrentOrFuture(
  value: string,
  temporalKind: HomeImportantItem["temporalKind"] | undefined,
  now: Date,
): boolean {
  const dateOnly = temporalKind === "date" || /^\d{4}-\d{2}-\d{2}$/u.test(value);
  if (dateOnly) {
    const startDay = academicCalendarDayNumber(value);
    const today = academicCalendarDayNumber(now.toISOString());
    return startDay !== null && today !== null && startDay >= today;
  }
  const start = Date.parse(value);
  return Number.isFinite(start) && start >= now.getTime();
}

function normalizeHomeScheduleTitle(value: string): string {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const withoutPagination = normalized.replace(
    /^\s*(?:[-–—:|>\u00bb]+\s*)?(?:\d{1,4}\s*(?:of|\/)\s*\d{1,4})\s*(?:[-–—:|>\u00bb]+\s*)?/iu,
    "",
  ).trim();
  return withoutPagination || normalized;
}

function compactTemporalDate(value: string, short = false): string {
  const date = parseHomeDate(value);
  if (!date) return "Tarih belirtilmedi";
  const formatted = date.toLocaleDateString("tr-TR", short
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "long", weekday: "long", year: "numeric" });
  return formatted.charAt(0).toLocaleUpperCase("tr-TR") + formatted.slice(1);
}

function compactTemporalTime(
  value: string,
  temporalKind?: HomeImportantItem["temporalKind"],
  timezone?: string,
): string {
  return formatCalendarClock(value, temporalKind, timezone);
}

function parseHomeDate(value: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function agendaIconName(item: HomeImportantItem): keyof typeof Ionicons.glyphMap {
  if (item.kind === "exam") return "document-text-outline";
  if (item.kind === "registration") return "book-outline";
  if (item.kind === "deadline") return "calendar-outline";
  return "people-outline";
}

function CompactAgendaRow({
  event,
  onPress,
}: {
  event: HomeImportantItem;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { fontScale, width } = useWindowDimensions();
  const palette = agendaPalette(event);
  const allDay = event.temporalKind === "date" || /^\d{4}-\d{2}-\d{2}$/u.test(event.date);
  const stackHeader = width < 360 || fontScale >= 1.35;
  const temporalLabel = formatCalendarTemporal({
    startDate: event.date,
    ...(event.endDate ? { endDate: event.endDate } : {}),
    ...(event.temporalKind ? { temporalKind: event.temporalKind } : {}),
    ...(event.endTemporalKind ? { endTemporalKind: event.endTemporalKind } : {}),
    ...(event.timezone ? { timezone: event.timezone } : {}),
  });
  const startClock = compactTemporalTime(event.date, event.temporalKind, event.timezone);
  const endClock = event.endDate && !allDay
    ? compactTemporalTime(
      event.endDate,
      event.endTemporalKind ?? event.temporalKind,
      event.timezone,
    )
    : null;
  const timeLabel = endClock ? `${startClock} – ${endClock}` : startClock;
  const dateLabel = formatCalendarDateRange({
    startDate: event.date,
    ...(event.endDate ? { endDate: event.endDate } : {}),
    ...(event.temporalKind ? { temporalKind: event.temporalKind } : {}),
    ...(event.endTemporalKind ? { endTemporalKind: event.endTemporalKind } : {}),
    ...(event.timezone ? { timezone: event.timezone } : {}),
  });

  return (
    <Pressable
      accessibilityLabel={`${event.title}. ${agendaTypeLabel(event)}. ${temporalLabel}.${event.location ? ` ${event.location}.` : ""}`}
      accessibilityRole="button"
      onPress={onPress}
      testID="home-agenda-card"
      style={({ pressed }) => [
        styles.agendaCard,
        { borderColor: theme.colors.border.subtle },
        pressed && styles.planHeroPressed,
      ]}
    >
      <View
        style={[
          styles.agendaCardHeader,
          stackHeader && styles.agendaCardHeaderStacked,
        ]}
        testID="home-agenda-card-header"
      >
        <View style={[styles.agendaCategoryGroup, stackHeader && styles.agendaCategoryGroupStacked]}>
          <View style={[styles.agendaCategoryIcon, { backgroundColor: palette.container }]}>
            <Ionicons color={palette.text} name={agendaIconName(event)} size={17} />
          </View>
          <Text
            numberOfLines={2}
            style={[theme.typography.metaStrong, styles.agendaCategoryLabel, { color: REFERENCE_COLORS.navy }]}
            testID="home-agenda-category-label"
          >
            {agendaTypeLabel(event)}
          </Text>
        </View>
        <View
          style={[
            styles.agendaTimePill,
            { backgroundColor: palette.container },
            stackHeader && styles.agendaTimePillStacked,
          ]}
          testID="home-agenda-time-pill"
        >
          <Ionicons
            color={palette.text}
            name={allDay ? "sunny-outline" : "time-outline"}
            size={14}
          />
          <Text
            numberOfLines={1}
            style={[theme.typography.metaStrong, styles.agendaTimePillLabel, { color: REFERENCE_COLORS.navy }]}
            testID="home-agenda-time-label"
          >
            {timeLabel}
          </Text>
        </View>
      </View>
      <Text
        numberOfLines={3}
        style={[theme.typography.bodyStrong, styles.agendaTitle, { color: REFERENCE_COLORS.navy }]}
      >
        {event.title}
      </Text>
      <View style={styles.agendaCardFooter} testID="home-agenda-footer">
        <View style={styles.agendaFooterMeta}>
          <View style={styles.agendaFooterMetaLine}>
            <Ionicons color={REFERENCE_COLORS.secondary} name="calendar-clear-outline" size={15} />
            <Text
              numberOfLines={stackHeader ? 2 : 1}
              style={[theme.typography.meta, styles.agendaFooterLabel, { color: REFERENCE_COLORS.secondary }]}
            >
              {dateLabel}
            </Text>
          </View>
          {event.location ? (
            <View style={styles.agendaFooterMetaLine}>
              <Ionicons color={REFERENCE_COLORS.secondary} name="location-outline" size={15} />
              <Text
                numberOfLines={stackHeader ? 2 : 1}
                style={[theme.typography.meta, styles.agendaFooterLabel, { color: REFERENCE_COLORS.secondary }]}
              >
                {event.location}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={[styles.agendaDisclosure, { borderColor: theme.colors.border.subtle }]}>
          <Ionicons color={REFERENCE_COLORS.blue} name="arrow-forward" size={16} />
        </View>
      </View>
    </Pressable>
  );
}

function BriefSection({
  title,
  accessibilityTitle,
  actionLabel,
  actionAccessibilityLabel,
  onAction,
  children,
}: {
  title: string;
  accessibilityTitle?: string;
  actionLabel?: string;
  actionAccessibilityLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.briefSection}>
      <View style={styles.sectionHeading}>
        <Text
          accessibilityLabel={accessibilityTitle}
          accessibilityRole="header"
          style={[theme.typography.sectionTitle, styles.sectionTitle, { color: REFERENCE_COLORS.navy }]}
        >
          {title}
        </Text>
        {actionLabel && onAction ? (
          <Pressable
            accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onAction}
            style={({ pressed }) => [styles.sectionAction, pressed && styles.planHeroPressed]}
          >
            <Text style={[theme.typography.label, { color: REFERENCE_COLORS.blue }]}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function AnnouncementCard({
  item,
  onPress,
}: {
  item: TrustedMobileContentRecord;
  onPress: (item: TrustedMobileContentRecord) => void;
}) {
  const theme = useTheme();
  const palette = homeAnnouncementPalette(item);
  const excerpt = shortContentCardExcerpt(item);
  const destinationUrl = trustedContentDestinationUrl(item);
  const destinationDomain = destinationUrl ? officialContentDomain(destinationUrl) : null;
  return (
    <Card
      accessibilityLabel={`${item.sourceName}. ${homeScopeLabel(item.scopeType)}. ${item.title}. ${contentTimestampLabel(item)}. Resmî duyuruyu aç.`}
      accessibilityRole="link"
      onPress={() => onPress(item)}
      style={[
        styles.announcementCard,
        {
          borderColor: REFERENCE_COLORS.border,
          borderRadius: 10,
          padding: 14,
        },
      ]}
      variant="outlined"
    >
      <View style={styles.announcementContentRow}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.announcementSourceIcon, { backgroundColor: palette.container }]}
        >
          <Ionicons
            color={palette.accent}
            name="shield-checkmark"
            size={22}
          />
        </View>
        <View style={styles.announcementCopy}>
          <Text
            style={[theme.typography.navLabel, styles.trustedLabel, { color: REFERENCE_COLORS.blue }]}
          >
            Güvenilir kaynak
          </Text>
          <Text
            numberOfLines={2}
            style={[theme.typography.meta, styles.announcementSourceName, { color: REFERENCE_COLORS.secondary }]}
          >
            {item.sourceName}
          </Text>
          <Text
            style={[theme.typography.bodyStrong, styles.announcementTitle, { color: REFERENCE_COLORS.navy }]}
          >
            {item.title}
          </Text>
          {excerpt ? (
            <Text
              ellipsizeMode="tail"
              numberOfLines={3}
              style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}
            >
              {excerpt}
            </Text>
          ) : null}
          <View style={styles.announcementMetaRow}>
            <Ionicons color={REFERENCE_COLORS.secondary} name="calendar-outline" size={15} />
            <Text
              style={[theme.typography.meta, styles.announcementTimestamp, { color: REFERENCE_COLORS.secondary }]}
            >
              {contentTimestampLabel(item)}
            </Text>
            <Text
              numberOfLines={1}
              style={[theme.typography.navLabel, styles.announcementScope, { color: palette.text }]}
            >
              {homeScopeLabel(item.scopeType)}
            </Text>
          </View>
          {destinationDomain ? (
            <Text numberOfLines={1} style={[theme.typography.navLabel, { color: REFERENCE_COLORS.blue }]}>Resmî kaynak · {destinationDomain}</Text>
          ) : null}
        </View>
        <Ionicons
          accessibilityElementsHidden
          color={REFERENCE_COLORS.blue}
          importantForAccessibility="no-hide-descendants"
          name="open-outline"
          size={20}
        />
      </View>
    </Card>
  );
}

function GoogleCalendarCard({ state, onPress }: { state: string; onPress: () => void }) {
  const theme = useTheme();
  const connected = state === "connected";
  const needsRenewal = state === "expired" || state === "error";
  return (
    <Card
      accessibilityLabel={`Google Takvim. ${connected ? "Bağlı" : "Bağlantı gerekli"}.`}
      style={[
        styles.googleCalendarCard,
        {
          backgroundColor: theme.colors.action.secondary,
          borderColor: theme.colors.border.subtle,
          borderRadius: theme.radii.card,
          gap: theme.spacing.sm,
          padding: theme.spacing.sm,
        },
      ]}
      variant="elevated"
    >
      <View style={[styles.googleCalendarRow, { gap: theme.spacing.sm }]}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.googleCalendarIcon,
            {
              backgroundColor: theme.colors.background.surface,
              borderRadius: theme.radii.control,
            },
          ]}
        >
          <Ionicons color={theme.colors.action.primary} name="calendar" size={23} />
        </View>
        <View style={[styles.googleCalendarCopy, { gap: theme.spacing.xxs }]}>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>
            {connected
              ? "Google Takvim senkronizasyonu açık"
              : needsRenewal
                ? "Google Takvim bağlantısını yenile"
                : "Google Takvim bağlantısı hazır değil"}
          </Text>
          <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>
            {connected
              ? "Akademik tarihler kendi takviminde güncel kalır."
              : "Etkinliklerini kendi takviminde görmek için bağlantıyı tamamla."}
          </Text>
        </View>
      </View>
      <Button
        compact
        fullWidth
        label={connected ? "Yönet" : "Ayarları aç"}
        onPress={onPress}
      />
    </Card>
  );
}

function AvailabilityBanner({
  availability,
  error,
  onRefresh,
}: {
  availability: "refreshing" | "offline" | "stale" | "partial";
  error?: string;
  onRefresh: () => void;
}) {
  if (availability === "refreshing") return <Banner title="Günlük özet yenileniyor" message="Mevcut bilgiler ekranda tutuluyor." />;
  if (availability === "offline") return <Banner title="Çevrimdışısın" message="Daha önce yüklenen bilgiler gösteriliyor." tone="warning" actionLabel="Yeniden dene" onAction={onRefresh} />;
  if (availability === "stale") return <Banner title="Son bilgiler gösteriliyor" message={error ?? "Kaynaklar şu anda yenilenemedi."} tone="warning" actionLabel="Yeniden dene" onAction={onRefresh} />;
  return <Banner title="Bazı kaynaklara ulaşılamadı" message="Ulaşılabilen güvenilir içerikler gösteriliyor." tone="warning" actionLabel="Yeniden dene" onAction={onRefresh} />;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/u)[0] || "öğrenci";
}

function initialsForName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "Ö";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`
    .toLocaleUpperCase("tr-TR");
}

function startOfLocalWeek(value: Date): Date {
  const start = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

function sameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function markerColorForDay(
  day: Date,
  events: readonly HomeAcademicEvent[],
  manualExams: readonly HomeManualExam[],
): string | null {
  const kind = selectHomeDayMarkerKind(day, events, manualExams);
  return kind ? homeEventPalette(kind).text : null;
}

function selectAgendaItems(
  events: readonly HomeAcademicEvent[],
  manualExams: readonly HomeManualExam[],
  todayItems: readonly HomeImportantItem[],
  highlightedItem: HomeImportantItem | null,
  now: Date,
): HomeImportantItem[] {
  const agenda = todayItems.filter((item) => item.id !== highlightedItem?.id);
  const seenIds = new Set(agenda.map((item) => item.id));
  if (highlightedItem) seenIds.add(highlightedItem.id);
  let remainingEvents = [...events];
  let remainingExams = [...manualExams];
  const maximumIterations = remainingEvents.length + remainingExams.length;

  for (let index = 0; agenda.length < 3 && index < maximumIterations; index += 1) {
    const candidate = selectNearestImportantItem(remainingEvents, remainingExams, now);
    if (!candidate) break;
    remainingEvents = remainingEvents.filter((event) => event.id !== candidate.id);
    remainingExams = remainingExams.filter((exam) => exam.id !== candidate.id);
    if (seenIds.has(candidate.id)) continue;
    seenIds.add(candidate.id);
    agenda.push(candidate);
  }

  return agenda.slice(0, 3);
}

function agendaTypeLabel(item: HomeImportantItem): string {
  if (item.kind === "exam") return "Sınav";
  if (item.kind === "registration") return "Kayıt";
  if (item.kind === "deadline") return "Başvuru";
  return "Etkinlik";
}

function agendaPalette(item: HomeImportantItem): { container: string; text: string } {
  return homeEventPalette(item.kind);
}

function homeEventPalette(kind: HomeImportantKind): { container: string; text: string } {
  if (kind === "exam") return { container: REFERENCE_COLORS.redSoft, text: REFERENCE_COLORS.red };
  if (kind === "registration") {
    return { container: referencePalette.academicPurpleSoft, text: referencePalette.academicPurple };
  }
  if (kind === "deadline") {
    return { container: REFERENCE_COLORS.orangeSoft, text: REFERENCE_COLORS.orange };
  }
  return { container: REFERENCE_COLORS.blueSoft, text: REFERENCE_COLORS.blue };
}

function homeScopeLabel(scopeType: TrustedMobileContentRecord["scopeType"]): string {
  if (scopeType === "faculty") return "Fakülte";
  if (scopeType === "department") return "Bölüm";
  return "Üniversite";
}

function homeAnnouncementPalette(
  item: TrustedMobileContentRecord,
): { accent: string; container: string; text: string } {
  if (item.scopeType === "faculty") {
    return {
      accent: REFERENCE_COLORS.red,
      container: REFERENCE_COLORS.redSoft,
      text: REFERENCE_COLORS.red,
    };
  }
  if (item.scopeType === "department") {
    return {
      accent: REFERENCE_COLORS.green,
      container: REFERENCE_COLORS.greenSoft,
      text: REFERENCE_COLORS.green,
    };
  }
  return {
    accent: REFERENCE_COLORS.blue,
    container: REFERENCE_COLORS.blueSoft,
    text: REFERENCE_COLORS.blue,
  };
}

const styles = StyleSheet.create({
  agendaCard: {
    backgroundColor: REFERENCE_COLORS.white,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 2,
    gap: 9,
    minHeight: 124,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 13,
    shadowColor: REFERENCE_COLORS.navy,
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.07,
    shadowRadius: 9,
  },
  agendaCardFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
  },
  agendaCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    minWidth: 0,
  },
  agendaCardHeaderStacked: {
    alignItems: "flex-start",
    flexDirection: "column",
    gap: 8,
  },
  agendaCategoryGroup: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
  },
  agendaCategoryIcon: {
    alignItems: "center",
    borderRadius: 9,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  agendaCategoryGroupStacked: {
    flex: 0,
    width: "100%",
  },
  agendaCategoryLabel: {
    flex: 1,
    minWidth: 0,
  },
  agendaDisclosure: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  agendaFooterLabel: {
    flex: 1,
    minWidth: 0,
  },
  agendaFooterMeta: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  agendaFooterMetaLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minWidth: 0,
  },
  agendaList: {
    gap: 10,
  },
  agendaFilters: {
    alignItems: "center",
    alignSelf: "flex-end",
    flexDirection: "row",
    gap: 7,
  },
  agendaFiltersScrollable: {
    alignSelf: "stretch",
  },
  agendaFiltersScrollableContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    paddingRight: 1,
  },
  agendaFilterTarget: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  agendaFilterSurface: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.white,
    borderColor: referencePalette.academicBlueBorder,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 14,
  },
  agendaFilterActive: {
    backgroundColor: REFERENCE_COLORS.blueDeep,
    borderColor: REFERENCE_COLORS.blueDeep,
  },
  agendaFilterLabel: {
    color: referencePalette.academicTealAction,
  },
  agendaFilterLabelActive: {
    color: REFERENCE_COLORS.white,
  },
  agendaTimePill: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 999,
    flexDirection: "row",
    flexShrink: 0,
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 10,
  },
  agendaTimePillLabel: {
    flexShrink: 1,
  },
  agendaTimePillStacked: {
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  agendaTitle: {
    fontSize: 16,
    lineHeight: 21,
  },
  announcementCard: {
    marginHorizontal: 1,
  },
  announcementContentRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minWidth: 0,
  },
  announcementCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  announcementList: {
    gap: 8,
  },
  announcementMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 2,
    minWidth: 0,
  },
  announcementScope: {
    flexShrink: 1,
    minWidth: 0,
  },
  announcementSourceIcon: {
    alignItems: "center",
    borderRadius: 8,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  announcementSourceName: {
    lineHeight: 17,
  },
  announcementTimestamp: {
    flex: 1,
    flexShrink: 1,
    minWidth: 44,
  },
  announcementTitle: {
    fontSize: 15,
    lineHeight: 20,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.blue,
    borderColor: homeDailyBriefColors.avatarBorder,
    borderRadius: 25,
    borderWidth: 1,
    height: 50,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: 50,
  },
  avatarLabel: {
    color: REFERENCE_COLORS.white,
    fontSize: 16,
    fontWeight: "800",
  },
  brandHero: {
    backgroundColor: REFERENCE_COLORS.blueDeep,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
    gap: 16,
    minHeight: 210,
    overflow: "hidden",
    paddingBottom: 64,
    paddingTop: 10,
    position: "relative",
  },
  briefSection: {
    gap: 10,
  },
  countdownTile: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.white,
    borderRadius: 8,
    flexShrink: 0,
    height: 40,
    justifyContent: "center",
    paddingHorizontal: 6,
    width: 70,
  },
  countdownValue: {
    fontSize: 17,
    lineHeight: 19,
  },
  countdownUnit: {
    fontSize: 8,
    lineHeight: 10,
    textAlign: "center",
  },
  focusPill: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: REFERENCE_COLORS.blueSoft,
    borderRadius: 999,
    flexDirection: "row",
    minHeight: 28,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  focusHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
  },
  focusStatus: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
  },
  googleCalendarCard: {
    marginHorizontal: 1,
  },
  googleCalendarCopy: {
    flex: 1,
    minWidth: 0,
  },
  googleCalendarIcon: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  googleCalendarRow: {
    alignItems: "center",
    flexDirection: "row",
    minWidth: 0,
  },
  greetingTitle: {
    fontSize: 26,
    fontWeight: "800",
    lineHeight: 32,
  },
  greetingSubtitle: {
    color: REFERENCE_COLORS.white,
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.9,
  },
  heroCopy: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  heroCopyLargeText: {
    gap: 3,
  },
  heroCountdownColumn: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: REFERENCE_COLORS.blueSoft,
    borderRadius: 17,
    justifyContent: "center",
    paddingHorizontal: 8,
    width: 96,
  },
  heroCountdownColumnCompact: {
    width: 76,
  },
  heroCountdownLabel: {
    maxWidth: "100%",
    textAlign: "center",
  },
  heroCountdownValue: {
    fontSize: 42,
    lineHeight: 46,
  },
  heroCountdownTrack: {
    backgroundColor: referencePalette.academicNeutralLineSoft,
    borderRadius: 3,
    height: 5,
    marginTop: 5,
    overflow: "hidden",
    width: "86%",
  },
  heroCountdownProgress: {
    backgroundColor: REFERENCE_COLORS.teal,
    borderRadius: 3,
    height: "100%",
    width: "52%",
  },
  heroCourse: {
    flex: 1,
    minWidth: 0,
    opacity: 0.96,
  },
  heroCourseRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    maxWidth: "100%",
  },
  heroMetaChip: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 6,
    minWidth: 0,
    width: "100%",
  },
  heroMetaRow: {
    gap: 3,
    width: "100%",
  },
  heroScheduleText: {
    flexShrink: 1,
    minWidth: 0,
  },
  heroTitle: {
    fontSize: 18,
    lineHeight: 23,
    maxWidth: "100%",
  },
  homeHeader: {
    gap: 14,
  },
  homeBrand: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 9,
    minWidth: 0,
  },
  homeBrandLogo: {
    height: 54,
    width: 54,
  },
  homeBrandTitle: {
    color: REFERENCE_COLORS.white,
    flexShrink: 1,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 21,
    maxWidth: 104,
  },
  homeCampusSilhouette: {
    bottom: -14,
    height: 150,
    left: 0,
    opacity: 0.2,
    position: "absolute",
    right: 0,
    width: "100%",
  },
  homeHeroGlow: {
    backgroundColor: referencePalette.academicBlueDeepAlpha18,
    borderRadius: 180,
    height: 260,
    position: "absolute",
    right: -110,
    top: -150,
    width: 260,
  },
  identityCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  identityRow: {
    alignItems: "center",
    flexDirection: "row",
    minWidth: 0,
  },
  list: {
    flexGrow: 1,
    paddingTop: 0,
  },
  notificationButton: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    position: "relative",
    width: 48,
  },
  notificationDot: {
    backgroundColor: REFERENCE_COLORS.red,
    borderColor: REFERENCE_COLORS.white,
    borderRadius: 5,
    borderWidth: 2,
    height: 10,
    position: "absolute",
    right: 5,
    top: 5,
    width: 10,
  },
  planHero: {
    alignItems: "center",
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 4,
    flexDirection: "row",
    gap: 10,
    marginTop: -62,
    minHeight: 150,
    overflow: "hidden",
    padding: 12,
    shadowColor: REFERENCE_COLORS.navy,
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.13,
    shadowRadius: 12,
  },
  planHeroCopy: {
    gap: 7,
    maxWidth: "100%",
    minWidth: 0,
    zIndex: 2,
  },
  planHeroPressed: {
    opacity: 0.9,
  },
  personalEventButton: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.blueDeep,
    borderRadius: 999,
    flexDirection: "row",
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 14,
  },
  personalEventIcon: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.white,
    borderRadius: 6,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  personalEventLabel: {
    color: REFERENCE_COLORS.white,
    flex: 1,
    fontSize: 17,
    minWidth: 0,
    textAlign: "center",
  },
  profilePrompt: {
    alignItems: "stretch",
    backgroundColor: referencePalette.academicTealSurface,
    borderColor: referencePalette.academicTealBorder,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    minHeight: 138,
    overflow: "hidden",
    padding: 14,
    paddingTop: 18,
    position: "relative",
  },
  profilePromptBody: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
  },
  profilePromptAction: {
    alignItems: "center",
    alignSelf: "flex-end",
    justifyContent: "center",
    marginLeft: "auto",
    minHeight: 48,
  },
  profilePromptActionSurface: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.white,
    borderColor: referencePalette.academicTealBorderMuted,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  profilePromptCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  profilePromptDismiss: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    position: "absolute",
    right: 4,
    top: 3,
    width: 36,
    zIndex: 4,
  },
  profilePromptIcon: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.tealSoft,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  profileArtwork: {
    height: 70,
    justifyContent: "center",
    marginRight: 4,
    marginTop: 7,
    position: "relative",
    width: 72,
  },
  profileArtworkAvatar: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.blueSoft,
    borderRadius: 13,
    height: 26,
    justifyContent: "center",
    width: 26,
  },
  profileArtworkCard: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.white,
    borderColor: referencePalette.academicTealBorderMuted,
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    height: 54,
    paddingHorizontal: 7,
    shadowColor: REFERENCE_COLORS.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    transform: [{ rotate: "-5deg" }],
    width: 66,
  },
  profileArtworkCheck: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.teal,
    borderColor: REFERENCE_COLORS.white,
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: "center",
    position: "absolute",
    right: 0,
    top: 0,
    width: 22,
  },
  profileArtworkLine: {
    backgroundColor: referencePalette.academicNeutralLine,
    borderRadius: 2,
    height: 3,
    width: 22,
  },
  profileArtworkLineShort: {
    backgroundColor: referencePalette.academicNeutralLineSoft,
    borderRadius: 2,
    height: 3,
    width: 15,
  },
  profileArtworkLineStrong: {
    backgroundColor: REFERENCE_COLORS.teal,
    borderRadius: 2,
    height: 4,
    width: 25,
  },
  profileArtworkLines: {
    gap: 4,
  },
  sectionAction: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
  },
  sectionHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 20,
    lineHeight: 26,
  },
  summaryGrid: {
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
  },
  summaryGridStacked: {
    flexDirection: "column",
  },
  weekSummaryCard: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.tealSoft,
    borderColor: referencePalette.academicTealBorder,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 88,
    minWidth: 0,
    overflow: "hidden",
    padding: 10,
  },
  announcementSummaryCard: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.orangeSoft,
    borderColor: referencePalette.academicBorder,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 88,
    minWidth: 0,
    overflow: "hidden",
    padding: 10,
  },
  summaryIconSurface: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.white,
    borderRadius: 25,
    elevation: 2,
    height: 50,
    justifyContent: "center",
    shadowColor: REFERENCE_COLORS.navy,
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    width: 50,
  },
  announcementSummaryIconSurface: {
    backgroundColor: REFERENCE_COLORS.white,
  },
  summaryCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  summaryValueRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 7,
    minWidth: 0,
  },
  summaryCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  summaryCardEyebrow: {
    color: referencePalette.academicTealTitle,
    flexShrink: 1,
  },
  summaryCardValue: {
    color: referencePalette.academicTealTitle,
    fontSize: 25,
    lineHeight: 29,
  },
  summaryCardDetail: {
    color: referencePalette.academicTealTitle,
    flex: 1,
  },
  summaryCardAction: {
    alignItems: "center",
    borderTopColor: homeDailyBriefColors.summaryDivider,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: -13,
    marginTop: 5,
    minHeight: 36,
    paddingHorizontal: 13,
    paddingTop: 7,
  },
  announcementSummaryEyebrow: {
    color: REFERENCE_COLORS.navy,
    flexShrink: 1,
  },
  announcementSummaryValue: {
    color: referencePalette.academicOrangeFeed,
    fontSize: 25,
    lineHeight: 29,
  },
  announcementSummaryDetail: {
    color: referencePalette.academicOrangeFeed,
    flex: 1,
  },
  announcementSummaryAction: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.white,
    borderRadius: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
    minHeight: 36,
    paddingHorizontal: 10,
  },
  weeklyCalendar: {
    backgroundColor: REFERENCE_COLORS.white,
    borderColor: referencePalette.academicBorderCool,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 2,
    gap: 8,
    padding: 11,
    shadowColor: REFERENCE_COLORS.navy,
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
  },
  weeklyCalendarHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  weeklyCalendarHeaderLargeText: {
    alignItems: "flex-start",
    flexDirection: "column",
    gap: 6,
  },
  weeklyCalendarTitle: {
    color: REFERENCE_COLORS.navy,
    flex: 1,
    fontSize: 18,
    lineHeight: 24,
  },
  weeklyCalendarTitleLargeText: {
    flex: 0,
    width: "100%",
  },
  weeklyCalendarStandard: {
    gap: 0,
    paddingVertical: 9,
  },
  calendarLinkSurface: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.blueSoft,
    borderRadius: 999,
    flexDirection: "row",
    gap: 5,
    minHeight: 38,
    paddingHorizontal: 11,
  },
  calendarLinkLargeText: {
    alignItems: "center",
    alignSelf: "flex-end",
    justifyContent: "center",
    minHeight: 48,
  },
  weekDays: {
    flexDirection: "row",
    gap: 4,
    justifyContent: "space-between",
  },
  weekDayTarget: {
    alignItems: "center",
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  weekDayName: {
    color: REFERENCE_COLORS.navy,
    fontSize: 9,
    lineHeight: 12,
    textAlign: "center",
  },
  weekDayCard: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.white,
    borderColor: "transparent",
    borderRadius: 14,
    borderWidth: 1,
    height: 50,
    justifyContent: "center",
    width: "100%",
  },
  weekDayCardSelected: {
    backgroundColor: REFERENCE_COLORS.blueDeep,
    borderColor: REFERENCE_COLORS.blueDeep,
  },
  weekDayNumber: {
    color: REFERENCE_COLORS.navy,
    fontSize: 16,
    lineHeight: 21,
  },
  weekDayNumberSelected: {
    color: REFERENCE_COLORS.white,
  },
  weekDayMarker: {
    borderRadius: 4,
    height: 7,
    marginTop: 3,
    width: 7,
  },
  stateCard: {
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 58,
  },
  topBarActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  trustedLabel: {
    letterSpacing: 0.3,
  },
  visuallyHidden: {
    height: 1,
    left: -10000,
    opacity: 0,
    position: "absolute",
    top: 0,
    width: 1,
  },
});
