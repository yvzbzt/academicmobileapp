import { Ionicons } from "@expo/vector-icons";
import { useNetworkState } from "expo-network";
import { useScrollToTop } from "@react-navigation/native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItem,
} from "react-native";
import { Banner, Button, Card, Skeleton, usePlatformAdaptation, useTheme } from "../design-system";
import {
  contentTimestampLabel,
  normalizeTrustedContentCollection,
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
  type HomeManualExam,
} from "./home-model";

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

type BriefModule = "today" | "next" | "important" | "recent" | "integration";

export function HomeDailyBrief(props: HomeDailyBriefProps) {
  const adaptation = usePlatformAdaptation();
  const theme = useTheme();
  const networkState = useNetworkState();
  const { fontScale, width } = useWindowDimensions();
  const layout = resolveHomeLayout(width, fontScale);
  const listRef = useRef<FlatList<BriefModule> | null>(null);
  useScrollToTop(listRef);
  const [clock, setClock] = useState(props.now ?? new Date());

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
  const trustedAnnouncements = useMemo(
    () => normalizeTrustedContentCollection(
      props.announcements.filter((item) => item.trustStatus === "trusted")
    ).items.filter(
      (item) => Boolean(item.sourceId.trim() && item.sourceName.trim())
    ),
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
  const primaryState = resolveHomePrimaryState({
    profileComplete,
    loading,
    attempted,
    hasData: hasUsefulData,
    error,
  });
  const availability = homeAvailability({
    loading,
    hasRetainedData: hasUsefulData,
    error,
    stale: props.calendarStale || props.announcementStale,
    contentState: props.announcementState,
    offline: props.offline ?? (
      networkState.isConnected === false || networkState.isInternetReachable === false
    ),
  });
  const integration = resolveActionableIntegration({
    profileComplete,
    googleCalendarState: props.googleCalendarState,
    notificationPermission: props.notificationPermission,
    notificationPreferenceEnabled: props.notificationPreferenceEnabled,
    notificationActive: props.notificationActive,
  });
  const modules: BriefModule[] = primaryState === "populated"
    ? ["today", "next", "important", "recent", ...(integration ? ["integration" as const] : [])]
    : [];

  const renderModule: ListRenderItem<BriefModule> = ({ item }) => {
    switch (item) {
      case "today":
        return (
          <BriefSection title="Bugün">
            {todayItems.length ? todayItems.map((event) => (
              <View key={`${event.kind}:${event.id}`} style={[styles.row, { borderColor: theme.colors.border.default }]}>
                <View style={styles.rowCopy}>
                  <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>{event.title}</Text>
                  <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>
                    {event.kind === "exam" ? "Sınav" : "Akademik tarih"} · {formatLocalDateTime(event.date)}
                  </Text>
                </View>
              </View>
            )) : (
              <View style={{ gap: theme.spacing.sm }}>
                <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Bugün için kayıtlı bir akademik etkinlik veya kişisel sınav yok.</Text>
                <Button compact label="Takvimde aç" onPress={props.onOpenCalendar} variant="ghost" />
              </View>
            )}
          </BriefSection>
        );
      case "next":
        return (
          <BriefSection title="Sıradaki önemli tarih">
            {nextItem ? (
              <Card variant="tonal" accessibilityLabel={`${nextItem.title}. ${formatRemainingTime(nextItem.date, clock)}`}>
                <View style={{ gap: theme.spacing.xs }}>
                  <Text style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>{nextItem.title}</Text>
                  <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.link }]}>{formatRemainingTime(nextItem.date, clock)}</Text>
                  <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{formatLocalDateTime(nextItem.date)}</Text>
                </View>
              </Card>
            ) : (
              <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Yaklaşan önemli bir tarih bulunamadı.</Text>
            )}
          </BriefSection>
        );
      case "important":
        return importantAnnouncement ? (
          <BriefSection title="Önemli duyuru">
            <AnnouncementCard item={importantAnnouncement} emphasized onPress={props.onOpenAnnouncement} />
          </BriefSection>
        ) : null;
      case "recent":
        return (
          <BriefSection title="Son duyurular" actionLabel="Tümünü aç" onAction={props.onOpenAnnouncements}>
            {recentAnnouncements.length ? recentAnnouncements.map((announcement) => (
              <AnnouncementCard key={announcement.id} item={announcement} onPress={props.onOpenAnnouncement} />
            )) : (
              <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Başka yeni duyuru yok.</Text>
            )}
          </BriefSection>
        );
      case "integration":
        return (
          <Banner
            title={integration === "notifications" ? "Bildirimlerini tamamla" : "Google Takvim bağlantısı hazır değil"}
            message={integration === "notifications"
              ? "Seçtiğin akademik hatırlatmaların ulaşması için bildirim durumunu kontrol et."
              : "Akademik tarihleri kendi takviminde görmek için bağlantıyı tamamlayabilirsin."}
            actionLabel="Ayarları aç"
            onAction={integration === "notifications"
              ? props.onOpenNotificationSettings
              : props.onOpenGoogleCalendarSettings}
          />
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
          paddingBottom: theme.spacing.xl,
          width: "100%",
        },
      ]}
      ListHeaderComponent={(
        <View style={{ gap: theme.spacing.md }}>
          <View accessible accessibilityLabel={`${firstName(props.fullName)}, günlük akademik özetin.`} style={{ gap: theme.spacing.xxs }}>
            <Text accessibilityRole="header" style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}>Merhaba {firstName(props.fullName)}</Text>
            <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>
              {[props.universityName, props.facultyName, props.departmentName].filter(Boolean).join(" · ") || "Akademik profilini tamamlayarak günlük özetini kişiselleştir."}
            </Text>
          </View>
          {availability !== "ready" && primaryState === "populated" ? (
            <AvailabilityBanner availability={availability} error={error} onRefresh={props.onRefresh} />
          ) : null}
          {primaryState === "incomplete_profile" ? (
            <Card variant="tonal" style={{ gap: theme.spacing.md }}>
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
          ) : primaryState === "recoverable_error" ? (
            <Banner title="Günlük özet yüklenemedi" message={error ?? "Bağlantını kontrol edip yeniden deneyebilirsin."} tone="error" actionLabel="Tekrar dene" onAction={props.onRefresh} />
          ) : primaryState === "empty" ? (
            <Card variant="tonal" style={{ gap: theme.spacing.md }}>
              <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>Bugün gündemin sakin</Text>
              <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Bugün veya yakında gösterilecek akademik tarih ve güvenilir duyuru bulunamadı.</Text>
              <Button label="Takvimi aç" onPress={props.onOpenCalendar} variant="secondary" />
            </Card>
          ) : null}
        </View>
      )}
      ListFooterComponent={primaryState === "populated" ? (
        <Text style={[theme.typography.meta, { color: theme.colors.text.secondary, textAlign: "center" }]}>Saatler cihazının yerel saatine göre gösterilir.</Text>
      ) : null}
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: theme.colors.background.canvas, flex: 1 }}
      testID={`home-${adaptation.platform}-${layout.gutter}-${layout.supportsLargeText ? "large-text" : "standard-text"}`}
    />
  );
}

function BriefSection({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary, flex: 1 }]}>{title}</Text>
        {actionLabel && onAction ? <Button compact label={actionLabel} onPress={onAction} variant="ghost" /> : null}
      </View>
      {children}
    </View>
  );
}

function AnnouncementCard({
  item,
  emphasized = false,
  onPress,
}: {
  item: TrustedMobileContentRecord;
  emphasized?: boolean;
  onPress: (item: TrustedMobileContentRecord) => void;
}) {
  const theme = useTheme();
  return (
    <Card
      accessibilityLabel={`${item.sourceName}. ${item.title}. ${contentTimestampLabel(item)}. Ayrıntıyı aç.`}
      onPress={() => onPress(item)}
      style={{ gap: theme.spacing.sm, marginBottom: emphasized ? 0 : theme.spacing.xs }}
      variant={emphasized ? "elevated" : "outlined"}
    >
      <Text style={[theme.typography.label, { color: theme.colors.text.secondary }]}>{item.sourceName}</Text>
      <Text style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>{item.title}</Text>
      {emphasized && item.summary ? <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>{item.summary}</Text> : null}
      <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{contentTimestampLabel(item)}</Text>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.actionRow}>
        <Text style={[theme.typography.label, { color: theme.colors.text.link }]}>Ayrıntıyı aç</Text>
        <Ionicons color={theme.colors.text.link} name="chevron-forward" size={18} />
      </View>
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

function formatLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tarih belirtilmemiş";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  list: {
    flexGrow: 1,
    paddingTop: 16,
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
    paddingVertical: 12,
  },
  rowCopy: {
    flex: 1,
    gap: 4,
  },
  sectionHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
  },
});
