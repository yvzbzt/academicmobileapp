import { Ionicons } from "@expo/vector-icons";
import { useNetworkState } from "expo-network";
import { useScrollToTop } from "@react-navigation/native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItem,
} from "react-native";
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
  formatCalendarTemporal,
} from "../calendar/calendar-time";

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
  onOpenGoogleCalendarSettings: () => void;
  onOpenNotificationSettings: () => void;
  onRefresh: () => void;
  now?: Date;
}

type BriefModule = "agenda" | "announcements" | "profile" | "integration";
type AgendaFilter = "all" | "academic" | "personal";

const academicCalendarLogo = require("../../assets/design-package/academic-calendar-logo.png");

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
  const layout = resolveHomeLayout(width, fontScale);
  const compactHero = width < 375 || layout.supportsLargeText;
  const listRef = useRef<FlatList<BriefModule> | null>(null);
  useScrollToTop(listRef);
  const [clock, setClock] = useState(props.now ?? new Date());
  const [profilePromptDismissed, setProfilePromptDismissed] = useState(false);
  const [agendaFilter, setAgendaFilter] = useState<AgendaFilter>("all");

  useEffect(() => {
    if (props.now) {
      setClock(props.now);
      return;
    }
    const timer = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [props.now]);

  const todayItems = useMemo(
    () => selectTodayItems(props.events, props.manualExams, clock),
    [clock, props.events, props.manualExams]
  );
  const nextItem = useMemo(
    () => selectNearestImportantItem(props.events, props.manualExams, clock),
    [clock, props.events, props.manualExams]
  );
  const agendaItems = useMemo(
    () => selectAgendaItems(props.events, props.manualExams, todayItems, clock),
    [clock, props.events, props.manualExams, todayItems],
  );
  const filteredAgendaItems = useMemo(
    () => agendaItems.filter((item) => {
      if (agendaFilter === "all") return true;
      const personal = item.category.startsWith("personal_");
      return agendaFilter === "personal" ? personal : !personal;
    }),
    [agendaFilter, agendaItems],
  );
  const weeklySummary = useMemo(
    () => summarizeHomeWeek(props.events, props.manualExams, clock),
    [clock, props.events, props.manualExams],
  );
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
  const heroStatusIcon = availability === "ready"
    ? "checkmark"
    : availability === "refreshing"
      ? "refresh"
      : availability === "offline"
        ? "cloud-offline-outline"
        : "alert-circle-outline";
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
              onPress={props.onOpenCalendar}
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
          paddingBottom: theme.spacing.xxl,
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
            <HomeTopBar
              fontScale={fontScale}
              fullName={props.fullName}
              onOpenAccount={props.onOpenAccountMenu}
              onOpenNotifications={props.onOpenNotificationSettings}
            />
            <View
              accessible
              accessibilityLabel={`${firstName(props.fullName)}, günlük akademik özetin.`}
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
            </View>
          </View>
          {primaryState === "populated" ? (
            <Pressable
              accessibilityLabel={`Akademik takvimin. ${heroBadgeLabel}. Takvimi aç.`}
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
              <View style={styles.heroCountdownColumn}>
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
                  Gün kaldı
                </Text>
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
                <View style={styles.heroCountdownTrack}>
                  <View style={styles.heroCountdownProgress} />
                </View>
              </View>
              <View style={[styles.heroCopy, layout.supportsLargeText && styles.heroCopyLargeText]}>
                <View style={styles.focusHeader}>
                  <View style={styles.focusPill}>
                    <Ionicons color={REFERENCE_COLORS.green} name={heroStatusIcon} size={15} />
                    <Text
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                      style={[
                        theme.typography.metaStrong,
                        {
                          color: REFERENCE_COLORS.green,
                          lineHeight: boundedTextLineHeight(theme.typography.metaStrong.lineHeight, fontScale, 1.3),
                        },
                      ]}
                    >
                      Sıradaki
                    </Text>
                  </View>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={[
                      theme.typography.meta,
                      styles.focusStatus,
                      {
                        color: REFERENCE_COLORS.secondary,
                        lineHeight: boundedTextLineHeight(theme.typography.meta.lineHeight, fontScale, 1.3),
                      },
                    ]}
                  >
                    {heroBadgeLabel}
                  </Text>
                </View>
                <Text
                  maxFontSizeMultiplier={1.35}
                  numberOfLines={layout.supportsLargeText ? 2 : compactHero ? 3 : 2}
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
                now={clock}
                onOpenCalendar={props.onOpenCalendar}
              />
              <View style={styles.summaryGrid}>
                <WeeklySummaryCard
                  summary={weeklySummary}
                  onPress={props.onOpenCalendar}
                />
                <AnnouncementSummaryCard
                  count={trustedAnnouncements.length}
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
}: {
  fontScale: number;
  fullName: string;
  onOpenAccount?: () => void;
  onOpenNotifications: () => void;
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
          numberOfLines={1}
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
          accessibilityLabel="Bildirim tercihlerini aç"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onOpenNotifications}
          style={({ pressed }) => [styles.notificationButton, pressed && styles.planHeroPressed]}
        >
          <Ionicons color={REFERENCE_COLORS.white} name="notifications-outline" size={24} />
          <View style={styles.notificationDot} />
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
    <View style={styles.weeklyCalendar}>
      <View style={[
        styles.weeklyCalendarHeader,
        fontScale > 1.45 && styles.weeklyCalendarHeaderLargeText,
      ]}>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={[
            theme.typography.sectionTitle,
            styles.weeklyCalendarTitle,
            fontScale > 1.45 && styles.weeklyCalendarTitleLargeText,
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
            styles.calendarLink,
            fontScale > 1.45 && styles.calendarLinkLargeText,
            pressed && styles.planHeroPressed,
          ]}
        >
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
        </Pressable>
      </View>
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
      <View style={styles.summaryCardHeader}>
        <Text style={[theme.typography.bodyStrong, styles.summaryCardEyebrow]}>Bu hafta</Text>
        <Ionicons color={REFERENCE_COLORS.white} name="calendar-clear-outline" size={24} />
      </View>
      <Text style={[theme.typography.display, styles.summaryCardValue]}>{summary.total}</Text>
      <Text numberOfLines={1} style={[theme.typography.meta, styles.summaryCardDetail]}>{breakdown}</Text>
      <View style={styles.summaryCardAction}>
        <Text style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.white }]}>Haftayı görüntüle</Text>
        <Ionicons color={REFERENCE_COLORS.white} name="chevron-forward" size={18} />
      </View>
    </Pressable>
  );
}

function AnnouncementSummaryCard({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessible
      accessibilityHint={`${count} güncel içerik bulunuyor.`}
      accessibilityLabel="Duyuru özeti"
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.announcementSummaryCard, pressed && styles.planHeroPressed]}
    >
      <View style={styles.summaryCardHeader}>
        <Text style={[theme.typography.bodyStrong, styles.announcementSummaryEyebrow]}>Duyurular</Text>
        <Ionicons color={REFERENCE_COLORS.navy} name="megaphone-outline" size={25} />
      </View>
      <Text style={[theme.typography.display, styles.announcementSummaryValue]}>{count}</Text>
      <Text numberOfLines={1} style={[theme.typography.meta, styles.announcementSummaryDetail]}>güncel içerik</Text>
      <View style={styles.announcementSummaryAction}>
        <Text style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.navy }]}>Tüm duyurular</Text>
        <Ionicons color={REFERENCE_COLORS.navy} name="chevron-forward" size={18} />
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
  const options: readonly { label: string; value: AgendaFilter }[] = [
    { label: "Tümü", value: "all" },
    { label: "Akademik", value: "academic" },
    { label: "Kişisel", value: "personal" },
  ];
  return (
    <View accessibilityLabel="Etkinlik filtresi" accessibilityRole="tablist" style={styles.agendaFilters}>
      {options.map((option) => {
        const active = selected === option.value;
        return (
          <Pressable
            accessibilityLabel={option.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.agendaFilter,
              active && styles.agendaFilterActive,
              pressed && styles.planHeroPressed,
            ]}
          >
            <Text style={[
              theme.typography.metaStrong,
              styles.agendaFilterLabel,
              active && styles.agendaFilterLabelActive,
            ]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
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
        <Text style={[theme.typography.metaStrong, { color: referencePalette.academicTealAction }]}>Profili Tamamla</Text>
        <Ionicons color={referencePalette.academicTealAction} name="chevron-forward" size={17} />
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
  const palette = agendaPalette(event);
  const allDay = event.temporalKind === "date" || /^\d{4}-\d{2}-\d{2}$/u.test(event.date);
  const temporalLabel = formatCalendarTemporal({
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
      style={({ pressed }) => [
        styles.agendaCard,
        { borderColor: theme.colors.border.subtle },
        pressed && styles.planHeroPressed,
      ]}
    >
      <View style={[styles.agendaAccent, { backgroundColor: palette.text }]} />
      <View style={styles.agendaTimeColumn}>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.85}
          numberOfLines={1}
          style={[theme.typography.metaStrong, styles.agendaTimeLabel, { color: REFERENCE_COLORS.navy }]}
        >
          {compactTemporalTime(event.date, event.temporalKind, event.timezone)}
        </Text>
        {event.endDate && !allDay ? (
          <Text
            numberOfLines={1}
            style={[theme.typography.meta, styles.agendaTimeLabel, { color: REFERENCE_COLORS.secondary }]}
          >
            {compactTemporalTime(
              event.endDate,
              event.endTemporalKind ?? event.temporalKind,
              event.timezone,
            )}
          </Text>
        ) : null}
      </View>
      <View style={styles.agendaCopy}>
        <View style={styles.agendaMetaRow}>
          <Ionicons color={palette.text} name={agendaIconName(event)} size={15} />
          <Text style={[theme.typography.metaStrong, { color: palette.text }]}>
            {agendaTypeLabel(event)}
          </Text>
        </View>
        <Text
          numberOfLines={3}
          style={[theme.typography.bodyStrong, styles.agendaTitle, { color: REFERENCE_COLORS.navy }]}
        >
          {event.title}
        </Text>
        <Text
          numberOfLines={1}
          style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}
        >
          {event.location || temporalLabel}
        </Text>
      </View>
      <Ionicons color={referencePalette.academicMutedIcon} name="chevron-forward" size={18} />
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
  return (
    <Card
      accessibilityLabel={`${item.sourceName}. ${item.title}. ${contentTimestampLabel(item)}. Ayrıntıyı aç.`}
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
            style={[theme.typography.bodyStrong, styles.announcementTitle, { color: REFERENCE_COLORS.navy }]}
          >
            {item.title}
          </Text>
          {item.summary ? (
            <Text
              ellipsizeMode="tail"
              numberOfLines={2}
              style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}
            >
              {item.summary}
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
  now: Date,
): HomeImportantItem[] {
  const agenda = [...todayItems];
  const seenIds = new Set(agenda.map((item) => item.id));
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
  agendaAccent: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
    width: 4,
  },
  agendaCard: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.background,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    minHeight: 88,
    minWidth: 0,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  agendaCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  agendaMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
  },
  agendaList: {
    gap: 6,
  },
  agendaFilters: {
    alignItems: "center",
    alignSelf: "flex-end",
    flexDirection: "row",
    gap: 7,
  },
  agendaFilter: {
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
    color: REFERENCE_COLORS.teal,
  },
  agendaFilterLabelActive: {
    color: REFERENCE_COLORS.white,
  },
  agendaTimeColumn: {
    alignItems: "flex-start",
    flexShrink: 0,
    width: 52,
  },
  agendaTimeLabel: {
    width: "100%",
  },
  agendaTitle: {
    fontSize: 15,
    lineHeight: 20,
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
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: 44,
  },
  avatarLabel: {
    color: REFERENCE_COLORS.white,
    fontSize: 16,
    fontWeight: "800",
  },
  brandHero: {
    backgroundColor: REFERENCE_COLORS.blueDeep,
    gap: 18,
    minHeight: 150,
    paddingBottom: 38,
    paddingTop: 8,
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
    flexDirection: "row",
    gap: 5,
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
    fontSize: 23,
    fontWeight: "800",
    lineHeight: 29,
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
    backgroundColor: referencePalette.academicGreenSurface,
    borderColor: referencePalette.academicGreenBorder,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 8,
    width: 70,
  },
  heroCountdownLabel: {
    maxWidth: "100%",
    textAlign: "center",
  },
  heroCountdownValue: {
    fontSize: 35,
    lineHeight: 39,
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
    fontSize: 16,
    lineHeight: 21,
    maxWidth: "100%",
  },
  homeHeader: {
    gap: 16,
  },
  homeBrand: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 9,
    minWidth: 0,
  },
  homeBrandLogo: {
    height: 46,
    width: 46,
  },
  homeBrandTitle: {
    color: REFERENCE_COLORS.white,
    flexShrink: 1,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 23,
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
    height: 44,
    justifyContent: "center",
    position: "relative",
    width: 44,
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
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 4,
    flexDirection: "row",
    gap: 10,
    marginTop: -38,
    minHeight: 132,
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
    borderRadius: 8,
    flexDirection: "row",
    gap: 10,
    minHeight: 54,
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
    minWidth: 0,
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
    backgroundColor: REFERENCE_COLORS.white,
    borderColor: referencePalette.academicTealBorderMuted,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: "flex-end",
    flexDirection: "row",
    gap: 5,
    marginLeft: "auto",
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
  weekSummaryCard: {
    backgroundColor: REFERENCE_COLORS.teal,
    borderRadius: 8,
    flex: 1,
    gap: 4,
    justifyContent: "space-between",
    minHeight: 154,
    minWidth: 0,
    overflow: "hidden",
    padding: 13,
  },
  announcementSummaryCard: {
    backgroundColor: homeDailyBriefColors.announcementSurface,
    borderRadius: 8,
    flex: 1,
    gap: 4,
    justifyContent: "space-between",
    minHeight: 154,
    minWidth: 0,
    overflow: "hidden",
    padding: 13,
  },
  summaryCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  summaryCardEyebrow: {
    color: REFERENCE_COLORS.white,
    flexShrink: 1,
  },
  summaryCardValue: {
    color: REFERENCE_COLORS.white,
    fontSize: 30,
    lineHeight: 34,
  },
  summaryCardDetail: {
    color: REFERENCE_COLORS.white,
    opacity: 0.95,
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
    color: REFERENCE_COLORS.navy,
    fontSize: 30,
    lineHeight: 34,
  },
  announcementSummaryDetail: {
    color: REFERENCE_COLORS.navy,
    opacity: 0.85,
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
    gap: 8,
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
  calendarLink: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.blueSoft,
    borderRadius: 999,
    flexDirection: "row",
    gap: 5,
    minHeight: 38,
    paddingHorizontal: 11,
  },
  calendarLinkLargeText: {
    alignSelf: "flex-end",
  },
  weekDays: {
    flexDirection: "row",
    gap: 4,
    justifyContent: "space-between",
  },
  weekDayTarget: {
    alignItems: "center",
    flex: 1,
    gap: 5,
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
    borderColor: referencePalette.academicBorderCool,
    borderRadius: 8,
    borderWidth: 1,
    height: 56,
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
    minHeight: 50,
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
