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
  selectNearestImportantItem,
  selectRecentAnnouncements,
  selectTodayItems,
  type HomeAcademicEvent,
  type HomeImportantItem,
  type HomeManualExam,
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
    ...(integration && primaryState !== "incomplete_profile" && primaryState !== "initial_loading"
      ? ["integration" as const]
      : []),
  ];

  const renderModule: ListRenderItem<BriefModule> = ({ item }) => {
    switch (item) {
      case "agenda":
        return (
          <BriefSection
            actionLabel="Tümünü Gör"
            onAction={props.onOpenCalendar}
            title="Bugün"
          >
            {agendaItems.length ? (
              <View style={styles.agendaList}>
                <Text accessibilityRole="header" style={styles.visuallyHidden}>Sıradaki önemli tarih</Text>
                {agendaItems.map((event) => (
                  <CompactAgendaRow event={event} key={`${event.kind}:${event.id}`} />
                ))}
              </View>
            ) : (
              <View style={{ gap: theme.spacing.sm }}>
                <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Yaklaşan akademik etkinlik veya kişisel sınav bulunamadı.</Text>
                <Button compact label="Takvimde aç" onPress={props.onOpenCalendar} variant="ghost" />
              </View>
            )}
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
            {integration === "notifications" ? (
              <Banner
                actionLabel="Ayarları aç"
                message="Akademik hatırlatmaların ulaşması için bildirim durumunu kontrol et."
                onAction={props.onOpenNotificationSettings}
                title="Bildirimlerini tamamla"
              />
            ) : null}
            <GoogleCalendarCard
              onPress={props.onOpenGoogleCalendarSettings}
              state={props.googleCalendarState}
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
          <HomeTopBar onOpenNotifications={props.onOpenNotificationSettings} />
          <View style={[styles.identityRow, { gap: theme.spacing.md }]}>
            <View
              accessible
              accessibilityLabel={`${firstName(props.fullName)}, günlük akademik özetin.`}
              style={styles.identityCopy}
            >
              <Text
                accessibilityRole="header"
                style={[theme.typography.screenTitle, styles.greetingTitle, { color: REFERENCE_COLORS.navy }]}
              >
                Merhaba {firstName(props.fullName)} 👋
              </Text>
              <Text
                numberOfLines={layout.supportsLargeText ? undefined : 1}
                style={[theme.typography.body, styles.greetingSubtitle, { color: REFERENCE_COLORS.secondary }]}
              >
                Bugün harika bir gün, planına sadık kal!
              </Text>
            </View>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.avatar,
                {
                  backgroundColor: REFERENCE_COLORS.blueSoft,
                  borderColor: REFERENCE_COLORS.white,
                },
              ]}
            >
              <Image
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                resizeMode="cover"
                source={require("../../assets/home-default-avatar.png")}
                style={styles.avatarImage}
              />
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
                  backgroundColor: REFERENCE_COLORS.blue,
                },
                pressed && adaptation.pressFeedback !== "ripple" ? styles.planHeroPressed : null,
              ]}
            >
              <Image
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                resizeMode="cover"
                source={require("../../assets/home-exam-calendar-art.png")}
                style={styles.heroBackgroundImage}
                testID="home-focus-artwork"
              />
              {compactHero ? <View style={styles.heroReadabilityPanel} /> : null}
              <View style={styles.heroMainRow}>
                <View style={styles.planHeroCopy}>
                  <View style={styles.focusPill}>
                    <Ionicons color={REFERENCE_COLORS.white} name={heroStatusIcon} size={16} />
                    <Text style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.white }]}>Bugünkü Odak</Text>
                  </View>
                  <Text
                    numberOfLines={2}
                    style={[theme.typography.screenTitle, styles.heroTitle, { color: REFERENCE_COLORS.white }]}
                  >
                    {nextItem ? heroTitle(nextItem) : "Akademik takvimin"}
                  </Text>
                  <View style={styles.heroCourseRow}>
                    <Ionicons color={REFERENCE_COLORS.white} name="book-outline" size={18} />
                    <Text
                      numberOfLines={1}
                      style={[theme.typography.body, styles.heroCourse, { color: REFERENCE_COLORS.white }]}
                    >
                      {nextItem?.courseName ?? nextItem?.title ?? props.universityName ?? "Akademik planın"}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.heroDivider} />
              <View style={styles.heroScheduleRow}>
                <View style={styles.countdownTile}>
                  <Text
                    style={[theme.typography.screenTitle, styles.countdownValue, { color: REFERENCE_COLORS.blue }]}
                  >
                    {countdownParts(nextItem, clock).value}
                  </Text>
                  <Text
                    style={[theme.typography.navLabel, { color: REFERENCE_COLORS.secondary }]}
                  >
                    {countdownParts(nextItem, clock).unit}
                  </Text>
                </View>
                <View style={styles.heroScheduleCopy}>
                  <View style={styles.heroScheduleLine}>
                    <Ionicons color={REFERENCE_COLORS.white} name="calendar-outline" size={17} />
                    <Text
                      ellipsizeMode="tail"
                      numberOfLines={1}
                      style={[theme.typography.metaStrong, styles.heroScheduleText, { color: REFERENCE_COLORS.white }]}
                    >
                      {nextItem ? compactTemporalDate(nextItem.date) : "Takvimi görüntüle"}
                    </Text>
                  </View>
                  <View style={styles.heroScheduleLine}>
                    <Ionicons color={REFERENCE_COLORS.white} name="time-outline" size={17} />
                    <Text
                      ellipsizeMode="tail"
                      numberOfLines={1}
                      style={[theme.typography.metaStrong, styles.heroScheduleText, { color: REFERENCE_COLORS.white }]}
                    >
                      {nextItem
                        ? compactTemporalTime(nextItem.date, nextItem.temporalKind, nextItem.timezone)
                        : heroBadgeLabel}
                    </Text>
                  </View>
                </View>
              </View>
            </Pressable>
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

function HomeTopBar({ onOpenNotifications }: { onOpenNotifications: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.topBar} testID="home-top-bar">
      <View style={styles.topBarSpacer} />
      <Text
        accessibilityRole="header"
        style={[theme.typography.cardTitle, styles.topBarTitle, { color: REFERENCE_COLORS.navy }]}
      >
        Ana Sayfa
      </Text>
      <Pressable
        accessibilityLabel="Bildirim tercihlerini aç"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onOpenNotifications}
        style={({ pressed }) => [styles.notificationButton, pressed && styles.planHeroPressed]}
      >
        <Ionicons color={REFERENCE_COLORS.navy} name="notifications-outline" size={25} />
        <View style={styles.notificationDot} />
      </Pressable>
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

function compactTemporalDate(value: string): string {
  const date = parseHomeDate(value);
  if (!date) return "Tarih belirtilmedi";
  const formatted = date.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });
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

function CompactAgendaRow({ event }: { event: HomeImportantItem }) {
  const theme = useTheme();
  const palette = agendaPalette(event);
  const dateParts = academicDateParts(event.date);
  const temporalLabel = formatCalendarTemporal({
    startDate: event.date,
    ...(event.endDate ? { endDate: event.endDate } : {}),
    ...(event.temporalKind ? { temporalKind: event.temporalKind } : {}),
    ...(event.endTemporalKind ? { endTemporalKind: event.endTemporalKind } : {}),
    ...(event.timezone ? { timezone: event.timezone } : {}),
  });

  return (
    <View
      accessible
      accessibilityLabel={`${event.title}. ${agendaTypeLabel(event)}. ${temporalLabel}.${event.location ? ` ${event.location}.` : ""}`}
      style={[
        styles.agendaCard,
        {
          borderColor: theme.colors.border.subtle,
        },
      ]}
    >
      <View style={[styles.agendaAccent, { backgroundColor: palette.text }]} />
      <View style={styles.agendaTimeColumn}>
        <Text
          style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.navy }]}
        >
          {compactTemporalTime(event.date, event.temporalKind, event.timezone)}
        </Text>
        {event.endDate ? (
          <Text
            style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}
          >
            {compactTemporalTime(
              event.endDate,
              event.endTemporalKind ?? event.temporalKind,
              event.timezone,
            )}
          </Text>
        ) : null}
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.agendaIcon,
          {
            backgroundColor: palette.container,
          },
        ]}
      >
        <Ionicons color={palette.text} name={agendaIconName(event)} size={24} />
      </View>
      <View style={styles.agendaCopy}>
        <Text
          style={[theme.typography.bodyStrong, styles.agendaTitle, { color: REFERENCE_COLORS.navy }]}
        >
          {event.title}
        </Text>
        <Text
          numberOfLines={1}
          style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}
        >
          {event.location || `${dateParts.day} ${dateParts.month} · ${temporalLabel}`}
        </Text>
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.agendaType,
          {
            backgroundColor: palette.container,
          },
        ]}
      >
        <Text style={[theme.typography.navLabel, { color: palette.text }]}>
          {agendaTypeLabel(event)}
        </Text>
      </View>
      <Ionicons color={referencePalette.academicMutedIcon} name="chevron-forward" size={18} />
    </View>
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
          borderRadius: 18,
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
            size={30}
          />
        </View>
        <View style={styles.announcementCopy}>
          <Text
            style={[theme.typography.navLabel, styles.trustedLabel, { color: REFERENCE_COLORS.blue }]}
          >
            GÜVENİLİR DUYURU
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

function heroTitle(item: HomeImportantItem): string {
  if (item.category === "final_exam") return "Final Sınavı";
  if (item.category === "midterm_exam") return "Ara Sınav";
  if (item.category === "makeup_exam") return "Bütünleme Sınavı";
  if (item.category === "single_course_exam") return "Tek ders sınavı";
  if (item.kind === "registration") return "Kayıt Dönemi";
  return item.title;
}

function agendaTypeLabel(item: HomeImportantItem): string {
  if (item.kind === "exam") return "Sınav";
  if (item.kind === "registration") return "Kayıt";
  if (item.kind === "deadline") return "Son tarih";
  return "Etkinlik";
}

function agendaPalette(item: HomeImportantItem): { container: string; text: string } {
  if (item.kind === "registration") {
    return {
      container: REFERENCE_COLORS.redSoft,
      text: REFERENCE_COLORS.red,
    };
  }
  if (item.kind === "deadline") {
    return {
      container: REFERENCE_COLORS.orangeSoft,
      text: REFERENCE_COLORS.orange,
    };
  }
  if (item.kind === "event") {
    return {
      container: REFERENCE_COLORS.greenSoft,
      text: REFERENCE_COLORS.green,
    };
  }
  return {
    container: REFERENCE_COLORS.blueSoft,
    text: REFERENCE_COLORS.blue,
  };
}

function academicDateParts(value: string): { day: string; month: string } {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return { day: "--", month: "" };
  return {
    day: String(date.getDate()),
    month: date
      .toLocaleDateString("tr-TR", { month: "short" })
      .replace(".", "")
      .toLocaleUpperCase("tr-TR"),
  };
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
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    minHeight: 76,
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
  agendaIcon: {
    alignItems: "center",
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  agendaList: {
    gap: 6,
  },
  agendaTimeColumn: {
    alignItems: "flex-start",
    flexShrink: 0,
    width: 45,
  },
  agendaTitle: {
    fontSize: 15,
    lineHeight: 20,
  },
  agendaType: {
    alignItems: "center",
    borderRadius: 9,
    flexShrink: 0,
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 5,
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
    borderRadius: 14,
    height: 72,
    justifyContent: "center",
    width: 66,
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
    borderRadius: 30,
    borderWidth: 2,
    height: 56,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: 56,
  },
  avatarImage: {
    height: "100%",
    width: "100%",
  },
  briefSection: {
    gap: 10,
  },
  countdownTile: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.white,
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 56,
    width: 72,
  },
  countdownValue: {
    fontSize: 23,
    lineHeight: 27,
  },
  focusPill: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: referencePalette.whiteAlpha14,
    borderRadius: 16,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
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
  greetingSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  greetingTitle: {
    fontSize: 25,
    lineHeight: 31,
  },
  heroBackgroundImage: {
    bottom: 0,
    height: "100%",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: "100%",
  },
  heroReadabilityPanel: {
    backgroundColor: referencePalette.academicBlueDeepAlpha18,
    borderBottomRightRadius: 96,
    borderTopRightRadius: 96,
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
    width: "64%",
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
    maxWidth: 205,
  },
  heroDivider: {
    backgroundColor: referencePalette.whiteAlpha24,
    height: StyleSheet.hairlineWidth,
    marginTop: 9,
    width: "58%",
  },
  heroMainRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    minHeight: 102,
    width: "100%",
  },
  heroScheduleCopy: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  heroScheduleLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    minWidth: 0,
  },
  heroScheduleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
    width: "58%",
  },
  heroScheduleText: {
    flexShrink: 1,
    minWidth: 0,
  },
  heroTitle: {
    fontSize: 25,
    lineHeight: 30,
    maxWidth: 205,
  },
  homeHeader: {
    gap: 17,
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
    paddingTop: 10,
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
    borderRadius: 19,
    minHeight: 196,
    overflow: "hidden",
    padding: 16,
  },
  planHeroCopy: {
    gap: 7,
    maxWidth: "58%",
    minWidth: 0,
    zIndex: 2,
  },
  planHeroPressed: {
    opacity: 0.9,
  },
  profilePrompt: {
    alignItems: "stretch",
    backgroundColor: referencePalette.academicTealSurface,
    borderColor: referencePalette.academicTealBorder,
    borderRadius: 18,
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
  stateCard: {
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
  },
  topBarSpacer: {
    height: 44,
    width: 44,
  },
  topBarTitle: {
    flex: 1,
    textAlign: "center",
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
