import { Ionicons } from "@expo/vector-icons";
import { useNetworkState } from "expo-network";
import { useMemo, type ReactNode } from "react";
import {
  FlatList,
  SectionList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItem,
  type SectionListRenderItem,
} from "react-native";
import {
  contentTimestampLabel,
  type ContentCollectionState,
  type TrustedMobileContentRecord,
} from "../content/content-trust";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  useTheme,
} from "../design-system";
import {
  formatAcademicTemporal,
  type AcademicTemporalKind,
} from "../temporal/academic-temporal";
import { resolveContentFeedLayout } from "./feed-model";

export interface YokAnnouncementsScreenProps {
  feedback?: ReactNode;
  items: readonly TrustedMobileContentRecord[];
  loading: boolean;
  attempted: boolean;
  error?: string;
  stale?: boolean;
  collectionState?: ContentCollectionState;
  offline?: boolean;
  refreshDisabled?: boolean;
  onRefresh: () => void;
  onOpenItem: (item: TrustedMobileContentRecord) => void;
}

export interface SummerSchoolEvent {
  id: string;
  title: string;
  category: string;
  startDate: string;
  endDate?: string;
  temporalKind?: AcademicTemporalKind;
  endTemporalKind?: AcademicTemporalKind;
  timezone?: string;
}

export interface SummerSchoolRequirement {
  message: string;
  date?: string;
  sourceUrl?: string;
  eventId?: string;
}

export interface SummerSchoolOption {
  universityId: string;
  universityName: string;
  academicYear: string;
  sourceUrl?: string;
  events: readonly SummerSchoolEvent[];
  matchingDepartments?: readonly {
    facultyId: string;
    facultyName: string;
    departmentId: string;
    departmentName: string;
    educationLevel: string;
  }[];
}

export interface SummerSchoolScreenProps {
  feedback?: ReactNode;
  universitySelected: boolean;
  universityName?: string;
  events: readonly SummerSchoolEvent[];
  requirements: readonly SummerSchoolRequirement[];
  announcements: readonly TrustedMobileContentRecord[];
  sameDepartmentOptions: readonly SummerSchoolOption[];
  calendarLoading: boolean;
  calendarAttempted: boolean;
  calendarError?: string;
  calendarStale?: boolean;
  contentLoading: boolean;
  contentAttempted: boolean;
  contentError?: string;
  contentStale?: boolean;
  contentState?: ContentCollectionState;
  offline?: boolean;
  refreshDisabled?: boolean;
  onRefresh: () => void;
  onOpenAnnouncement: (item: TrustedMobileContentRecord) => void;
  onOpenOfficialSource: (url: string) => void | Promise<unknown>;
}

type SummerSectionKey = "dates" | "announcements" | "options";

type SummerRow =
  | { key: string; kind: "event"; event: SummerSchoolEvent }
  | { key: string; kind: "requirement"; requirement: SummerSchoolRequirement }
  | { key: string; kind: "announcement"; announcement: TrustedMobileContentRecord }
  | { key: string; kind: "option"; option: SummerSchoolOption }
  | {
      key: string;
      kind: "state";
      state: "loading" | "error" | "offline" | "empty" | "idle";
      title: string;
      description: string;
    };

interface SummerSection {
  key: SummerSectionKey;
  title: string;
  data: SummerRow[];
}

/** A semantic, virtualized destination for the nested YÖK route. */
export function YokAnnouncementsScreen({
  feedback,
  items,
  loading,
  attempted,
  error,
  stale = false,
  collectionState,
  offline,
  refreshDisabled = false,
  onRefresh,
  onOpenItem,
}: YokAnnouncementsScreenProps) {
  const theme = useTheme();
  const networkState = useNetworkState();
  const { fontScale, width } = useWindowDimensions();
  const layout = resolveContentFeedLayout(width, fontScale);
  const isOffline = offline ?? (
    networkState.isConnected === false || networkState.isInternetReachable === false
  );
  const hasItems = items.length > 0;
  const mayRefresh = !refreshDisabled && !loading;
  const visiblyLoading = loading && !isOffline;
  const renderItem: ListRenderItem<TrustedMobileContentRecord> = ({ item }) => (
    <TrustedDestinationCard
      item={item}
      onPress={() => onOpenItem(item)}
      scopeLabel="YÖK resmî duyurusu"
    />
  );

  return (
    <FlatList
      accessibilityLabel="YÖK duyuruları listesi"
      contentContainerStyle={[
        styles.listContent,
        {
          gap: theme.spacing.sm,
          maxWidth: layout.maxWidth,
          paddingBottom: theme.spacing.xl,
          paddingHorizontal: layout.gutter,
          paddingTop: theme.spacing.md,
        },
      ]}
      data={[...items]}
      initialNumToRender={12}
      keyExtractor={(item) => item.canonicalUrl}
      ListHeaderComponent={(
        <View style={{ gap: theme.spacing.md }}>
          {feedback}
          <DestinationHeading
            count={items.length}
            countLabel="duyuru"
            description="Yükseköğretim Kurulu tarafından yayımlanan güvenilir ulusal duyurular."
            icon="newspaper-outline"
            title="YÖK duyuruları"
          />
          <Button
            disabled={!mayRefresh}
            fullWidth
            label={error && !hasItems ? "Tekrar dene" : "YÖK duyurularını yenile"}
            loading={visiblyLoading && hasItems}
            onPress={onRefresh}
            variant="secondary"
          />
          {hasItems ? (
            <RetainedAvailability
              collectionState={collectionState}
              error={error}
              loading={visiblyLoading}
              offline={isOffline}
              stale={stale}
            />
          ) : null}
        </View>
      )}
      ListEmptyComponent={(
        <DestinationEmptyState
          attempted={attempted}
          emptyDescription="Resmî kaynak yanıt verdiğinde doğrulanmış duyurular burada listelenecek."
          emptyTitle="YÖK duyurusu bulunamadı"
          error={error}
          loading={visiblyLoading}
          offline={isOffline}
          onRetry={mayRefresh ? onRefresh : undefined}
        />
      )}
      maxToRenderPerBatch={12}
      onRefresh={mayRefresh ? onRefresh : undefined}
      refreshing={visiblyLoading && hasItems}
      renderItem={renderItem}
      showsVerticalScrollIndicator
      style={{ backgroundColor: theme.colors.background.canvas, flex: 1 }}
      testID={`yok-destination-${layout.gutter}-${layout.supportsLargeText ? "large-text" : "standard-text"}`}
      windowSize={7}
    />
  );
}

/** A semantic SectionList destination for dates, requirements, and trusted content. */
export function SummerSchoolScreen({
  feedback,
  universitySelected,
  universityName,
  events,
  requirements,
  announcements,
  sameDepartmentOptions,
  calendarLoading,
  calendarAttempted,
  calendarError,
  calendarStale = false,
  contentLoading,
  contentAttempted,
  contentError,
  contentStale = false,
  contentState,
  offline,
  refreshDisabled = false,
  onRefresh,
  onOpenAnnouncement,
  onOpenOfficialSource,
}: SummerSchoolScreenProps) {
  const theme = useTheme();
  const networkState = useNetworkState();
  const { fontScale, width } = useWindowDimensions();
  const layout = resolveContentFeedLayout(width, fontScale);
  const isOffline = offline ?? (
    networkState.isConnected === false || networkState.isInternetReachable === false
  );
  const hasContent = events.length > 0
    || requirements.length > 0
    || announcements.length > 0
    || sameDepartmentOptions.length > 0;
  const contentHasRetainedData = requirements.length > 0
    || announcements.length > 0
    || sameDepartmentOptions.length > 0;
  const loading = calendarLoading || contentLoading;
  const visiblyLoading = loading && !isOffline;
  const mayRefresh = universitySelected && !refreshDisabled && !loading;
  const sections = useMemo<SummerSection[]>(() => {
    if (!universitySelected) return [];
    const dateRows: SummerRow[] = events.length
      ? events.map((event) => ({ key: `event:${event.id}`, kind: "event", event }))
      : [sourceStateRow({
          key: "dates",
          sourceTitle: "Yaz okulu tarihleri",
          loading: calendarLoading,
          attempted: calendarAttempted,
          error: calendarError,
          offline: isOffline,
          emptyTitle: "Henüz yaz okulu tarihi yok",
          emptyDescription: "Üniversite takviminde yaz okulu tarihleri bulunduğunda burada listelenecek.",
        })];
    const announcementRows: SummerRow[] = [
      ...requirements.map((requirement, index) => ({
        key: `requirement:${requirement.eventId ?? requirement.date ?? index}`,
        kind: "requirement" as const,
        requirement,
      })),
      ...announcements.map((announcement) => ({
        key: `announcement:${announcement.canonicalUrl}`,
        kind: "announcement" as const,
        announcement,
      })),
    ];
    if (announcementRows.length === 0) {
      announcementRows.push(sourceStateRow({
        key: "announcements",
        sourceTitle: "Yaz okulu duyuruları",
        loading: contentLoading,
        attempted: contentAttempted,
        error: contentError,
        offline: isOffline,
        emptyTitle: "Henüz yaz okulu duyurusu yok",
        emptyDescription: "Kaynaklar güncellendiğinde başvuru ve ders alma duyuruları burada listelenecek.",
      }));
    }
    const optionRows: SummerRow[] = sameDepartmentOptions.length
      ? sameDepartmentOptions.map((option) => ({
          key: `option:${option.universityId}:${option.academicYear}`,
          kind: "option" as const,
          option,
        }))
      : [sourceStateRow({
          key: "options",
          sourceTitle: "Aynı bölüm seçenekleri",
          loading: contentLoading,
          attempted: contentAttempted,
          error: contentError,
          offline: isOffline,
          emptyTitle: "Eşleşen bölüm bulunamadı",
          emptyDescription: "Diğer üniversitelerde aynı bölümden yaz okulu fırsatı bulunduğunda burada listelenecek.",
        })];
    return [
      { key: "dates", title: "Yaz okulu tarihleri", data: dateRows },
      { key: "announcements", title: "Yaz okulu duyuruları", data: announcementRows },
      { key: "options", title: "Aynı bölümde seçenekler", data: optionRows },
    ];
  }, [
    announcements,
    calendarAttempted,
    calendarError,
    calendarLoading,
    contentAttempted,
    contentError,
    contentLoading,
    events,
    isOffline,
    requirements,
    sameDepartmentOptions,
    universitySelected,
  ]);

  const renderItem: SectionListRenderItem<SummerRow, SummerSection> = ({ item }) => (
    <View style={{ marginBottom: theme.spacing.sm }}>
      <SummerRowContent
        item={item}
        onOpenAnnouncement={onOpenAnnouncement}
        onOpenOfficialSource={onOpenOfficialSource}
        onRetry={mayRefresh ? onRefresh : undefined}
      />
    </View>
  );

  return (
    <SectionList
      accessibilityLabel="Yaz okulu bilgi listesi"
      contentContainerStyle={[
        styles.listContent,
        {
          maxWidth: layout.maxWidth,
          paddingBottom: theme.spacing.xl,
          paddingHorizontal: layout.gutter,
          paddingTop: theme.spacing.md,
        },
      ]}
      initialNumToRender={14}
      keyExtractor={(item) => item.key}
      ListHeaderComponent={(
        <View style={{ gap: theme.spacing.md }}>
          {feedback}
          <DestinationHeading
            count={events.length + requirements.length + announcements.length + sameDepartmentOptions.length}
            countLabel="kayıt"
            description="Yaz okulu tarihlerini, başvuru duyurularını ve aynı bölümdeki güvenilir seçenekleri takip et."
            icon="sunny-outline"
            supportingText={universityName ?? "Üniversite seçilmedi"}
            title="Yaz okulu"
          />
          <Button
            disabled={!mayRefresh}
            fullWidth
            label={(calendarError || contentError) && !hasContent ? "Tekrar dene" : "Yaz okulunu yenile"}
            loading={visiblyLoading && hasContent}
            onPress={onRefresh}
            variant="secondary"
          />
          {!universitySelected ? (
            <EmptyState
              description="Profil sekmesinden üniversiteni seçtiğinde yaz okulu bilgileri burada görünür."
              title="Üniversite seçildiğinde hazır"
            />
          ) : hasContent ? (
            <View style={{ gap: theme.spacing.sm }}>
              {isOffline ? (
                <Banner
                  message="Son doğrulanmış yaz okulu bilgileri gösteriliyor."
                  title="Çevrimdışısın"
                  tone="warning"
                />
              ) : null}
              {!isOffline ? (
                <CalendarRetainedAvailability
                  error={calendarError}
                  hasEvents={events.length > 0}
                  loading={calendarLoading}
                  stale={calendarStale}
                />
              ) : null}
              {!isOffline ? (
                <SummerContentRetainedAvailability
                  collectionState={contentState}
                  error={contentError}
                  hasContent={contentHasRetainedData}
                  loading={contentLoading}
                  stale={contentStale}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      )}
      maxToRenderPerBatch={14}
      onRefresh={mayRefresh ? onRefresh : undefined}
      refreshing={visiblyLoading && hasContent}
      renderItem={renderItem}
      renderSectionHeader={({ section }) => (
        <Text
          accessibilityRole="header"
          style={[
            theme.typography.sectionTitle,
            styles.sectionHeader,
            { color: theme.colors.text.primary, marginBottom: theme.spacing.sm, marginTop: theme.spacing.lg },
          ]}
        >
          {section.title}
        </Text>
      )}
      sections={sections}
      showsVerticalScrollIndicator
      stickySectionHeadersEnabled={false}
      style={{ backgroundColor: theme.colors.background.canvas, flex: 1 }}
      testID={`summer-destination-${layout.gutter}-${layout.supportsLargeText ? "large-text" : "standard-text"}`}
      windowSize={7}
    />
  );
}

function DestinationHeading({
  title,
  description,
  supportingText,
  count,
  countLabel,
  icon,
}: {
  title: string;
  description: string;
  supportingText?: string;
  count: number;
  countLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={[styles.headingRow, { gap: theme.spacing.sm }]}>
        <View style={[styles.headingCopy, { gap: theme.spacing.xxs }]}>
          <View style={[styles.iconTitleRow, { gap: theme.spacing.xs }]}>
            <Ionicons
              accessibilityElementsHidden
              color={theme.colors.text.link}
              importantForAccessibility="no-hide-descendants"
              name={icon}
              size={24}
            />
            <Text accessibilityRole="header" style={[theme.typography.screenTitle, styles.headingCopy, { color: theme.colors.text.primary }]}>
              {title}
            </Text>
          </View>
          <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>{description}</Text>
          {supportingText ? <Text style={[theme.typography.metaStrong, { color: theme.colors.text.secondary }]}>{supportingText}</Text> : null}
        </View>
        <Card
          accessibilityLabel={`${count} ${countLabel}`}
          style={[styles.countCard, { gap: theme.spacing.xxs }]}
          variant="tonal"
        >
          <Text style={[theme.typography.cardTitle, { color: theme.colors.text.link }]}>{count}</Text>
          <Text style={[theme.typography.metaStrong, { color: theme.colors.text.secondary }]}>{countLabel}</Text>
        </Card>
      </View>
    </View>
  );
}

function TrustedDestinationCard({
  item,
  scopeLabel,
  onPress,
}: {
  item: TrustedMobileContentRecord;
  scopeLabel: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const timestamp = contentTimestampLabel(item);
  return (
    <Card
      accessibilityLabel={`${item.sourceName}. ${scopeLabel}. ${timestamp}. ${item.title}. Ayrıntıyı aç.`}
      onPress={onPress}
      style={{ gap: theme.spacing.sm }}
      variant="outlined"
    >
      <View style={[styles.metadataRow, { gap: theme.spacing.xs }]}>
        <Ionicons
          accessibilityElementsHidden
          color={theme.colors.text.link}
          importantForAccessibility="no-hide-descendants"
          name="shield-checkmark-outline"
          size={20}
        />
        <Text style={[theme.typography.metaStrong, styles.flexOne, { color: theme.colors.text.secondary }]}>{item.sourceName}</Text>
      </View>
      <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{scopeLabel} · {timestamp}</Text>
      <Text style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>{item.title}</Text>
      {item.summary ? <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>{item.summary}</Text> : null}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.actionRow, { gap: theme.spacing.xs }]}>
        <Text style={[theme.typography.label, { color: theme.colors.text.link }]}>Ayrıntıyı aç</Text>
        <Ionicons color={theme.colors.text.link} name="chevron-forward" size={18} />
      </View>
    </Card>
  );
}

function SummerRowContent({
  item,
  onOpenAnnouncement,
  onOpenOfficialSource,
  onRetry,
}: {
  item: SummerRow;
  onOpenAnnouncement: (item: TrustedMobileContentRecord) => void;
  onOpenOfficialSource: (url: string) => void | Promise<unknown>;
  onRetry?: () => void;
}) {
  const theme = useTheme();
  if (item.kind === "event") {
    const dateLabel = formatAcademicTemporal(item.event);
    return (
      <Card accessibilityLabel={`Yaz okulu tarihi. ${item.event.title}. ${dateLabel}.`} style={{ gap: theme.spacing.xs }}>
        <View style={[styles.metadataRow, { gap: theme.spacing.xs }]}>
          <Ionicons accessibilityElementsHidden color={theme.colors.status.warning} importantForAccessibility="no-hide-descendants" name="calendar-outline" size={20} />
          <Text style={[theme.typography.metaStrong, { color: theme.colors.status.warning }]}>Yaz okulu tarihi</Text>
        </View>
        <Text style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>{item.event.title}</Text>
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>{dateLabel}</Text>
      </Card>
    );
  }
  if (item.kind === "requirement") {
    const dateLabel = item.requirement.date
      ? formatAcademicTemporal({ startDate: item.requirement.date })
      : "Tarih belirtilmedi";
    const card = (
      <Card
        accessibilityLabel={`Başvuru koşulu. ${item.requirement.message}. ${dateLabel}.${item.requirement.sourceUrl ? " Resmî kaynağı aç." : " Resmî bağlantı mevcut değil."}`}
        accessibilityRole={item.requirement.sourceUrl ? "link" : undefined}
        onPress={item.requirement.sourceUrl ? () => void onOpenOfficialSource(item.requirement.sourceUrl!) : undefined}
        style={{ gap: theme.spacing.xs }}
      >
        <View style={[styles.metadataRow, { gap: theme.spacing.xs }]}>
          <Ionicons accessibilityElementsHidden color={theme.colors.status.info} importantForAccessibility="no-hide-descendants" name="document-text-outline" size={20} />
          <Text style={[theme.typography.metaStrong, styles.flexOne, { color: theme.colors.status.info }]}>Başvuru koşulu</Text>
          <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{dateLabel}</Text>
        </View>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>{item.requirement.message}</Text>
        <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>
          {item.requirement.sourceUrl ? "Resmî kaynağı aç" : "Resmî bağlantı mevcut değil"}
        </Text>
      </Card>
    );
    return card;
  }
  if (item.kind === "announcement") {
    return (
      <TrustedDestinationCard
        item={item.announcement}
        onPress={() => onOpenAnnouncement(item.announcement)}
        scopeLabel="Yaz okulu duyurusu"
      />
    );
  }
  if (item.kind === "option") {
    const departmentLabel = item.option.matchingDepartments
      ?.map((match) => match.departmentName)
      .slice(0, 3)
      .join(", ") || "Benzer bölüm bilgisi";
    return (
      <Card
        accessibilityLabel={`${item.option.universityName}. ${item.option.academicYear}. ${item.option.events.length} tarih. ${departmentLabel}.${item.option.sourceUrl ? " Resmî kaynağı aç." : " Resmî bağlantı mevcut değil."}`}
        accessibilityRole={item.option.sourceUrl ? "link" : undefined}
        onPress={item.option.sourceUrl ? () => void onOpenOfficialSource(item.option.sourceUrl!) : undefined}
        style={{ gap: theme.spacing.xs }}
      >
        <View style={[styles.metadataRow, { gap: theme.spacing.xs }]}>
          <Ionicons accessibilityElementsHidden color={theme.colors.status.success} importantForAccessibility="no-hide-descendants" name="school-outline" size={20} />
          <Text style={[theme.typography.metaStrong, styles.flexOne, { color: theme.colors.status.success }]}>{item.option.academicYear}</Text>
          <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{item.option.events.length} tarih</Text>
        </View>
        <Text style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>{item.option.universityName}</Text>
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>{departmentLabel}</Text>
        <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>
          {item.option.sourceUrl ? "Resmî kaynağı aç" : "Resmî bağlantı mevcut değil"}
        </Text>
      </Card>
    );
  }
  if (item.state === "loading") {
    return (
      <View accessible accessibilityLabel={item.title} accessibilityRole="progressbar" accessibilityState={{ busy: true }} style={{ gap: theme.spacing.sm }}>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>{item.title}</Text>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: theme.spacing.xs }}>
          <Skeleton decorative height={20} width="58%" />
          <Skeleton decorative height={72} />
        </View>
      </View>
    );
  }
  if (item.state === "error") {
    return <ErrorState actionLabel={onRetry ? "Tekrar dene" : undefined} description={item.description} onAction={onRetry} title={item.title} />;
  }
  return <EmptyState actionLabel={item.state === "offline" && onRetry ? "Yeniden dene" : undefined} description={item.description} onAction={item.state === "offline" ? onRetry : undefined} title={item.title} />;
}

function RetainedAvailability({
  loading,
  offline,
  error,
  stale,
  collectionState,
}: {
  loading: boolean;
  offline: boolean;
  error?: string;
  stale: boolean;
  collectionState?: ContentCollectionState;
}) {
  if (offline) return <Banner message="Son doğrulanmış YÖK duyuruları gösteriliyor." title="Çevrimdışısın" tone="warning" />;
  if (loading) return <Banner message="Mevcut duyurular ekranda tutuluyor." title="YÖK duyuruları yenileniyor" />;
  if (error || stale || collectionState === "stale") {
    return <Banner message={error ?? "Son doğrulanmış duyurular gösteriliyor."} title="YÖK duyuruları yenilenemedi" tone="warning" />;
  }
  if (collectionState === "partial") {
    return <Banner message="Kullanılabilen doğrulanmış resmî duyurular gösteriliyor." title="Bazı YÖK kaynaklarına ulaşılamadı" tone="warning" />;
  }
  return null;
}

function CalendarRetainedAvailability({
  error,
  hasEvents,
  loading,
  stale,
}: {
  error?: string;
  hasEvents: boolean;
  loading: boolean;
  stale: boolean;
}) {
  if (loading && hasEvents) {
    return <Banner message="Mevcut tarihler ekranda tutuluyor." title="Takvim tarihleri yenileniyor" />;
  }
  if ((error || stale) && hasEvents) {
    return (
      <Banner
        message={error ?? "Son doğrulanmış takvim tarihleri gösteriliyor."}
        title="Takvim tarihleri yenilenemedi"
        tone="warning"
      />
    );
  }
  return null;
}

function SummerContentRetainedAvailability({
  collectionState,
  error,
  hasContent,
  loading,
  stale,
}: {
  collectionState?: ContentCollectionState;
  error?: string;
  hasContent: boolean;
  loading: boolean;
  stale: boolean;
}) {
  if (loading && hasContent) {
    return <Banner message="Mevcut duyuru ve seçenekler ekranda tutuluyor." title="Yaz okulu kaynakları yenileniyor" />;
  }
  if ((error || stale || collectionState === "stale") && hasContent) {
    return (
      <Banner
        message={error ?? "Son doğrulanmış yaz okulu içerikleri gösteriliyor."}
        title="Yaz okulu kaynakları yenilenemedi"
        tone="warning"
      />
    );
  }
  if (collectionState === "partial") {
    return (
      <Banner
        message="Kullanılabilen doğrulanmış resmî içerikler gösteriliyor."
        title="Bazı yaz okulu kaynaklarına ulaşılamadı"
        tone="warning"
      />
    );
  }
  return null;
}

function DestinationEmptyState({
  loading,
  attempted,
  error,
  offline,
  emptyTitle,
  emptyDescription,
  onRetry,
}: {
  loading: boolean;
  attempted: boolean;
  error?: string;
  offline: boolean;
  emptyTitle: string;
  emptyDescription: string;
  onRetry?: () => void;
}) {
  const theme = useTheme();
  if (offline) return <EmptyState actionLabel={onRetry ? "Yeniden dene" : undefined} description="Bu cihazda gösterilecek kayıtlı bir YÖK duyurusu yok." onAction={onRetry} title="Çevrimdışısın" />;
  if (loading) {
    return (
      <View accessible accessibilityLabel="YÖK duyuruları yükleniyor" accessibilityRole="progressbar" accessibilityState={{ busy: true }} style={{ gap: theme.spacing.sm }}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: theme.spacing.sm }}>
          <Skeleton decorative height={22} width="48%" />
          <Skeleton decorative height={112} />
          <Skeleton decorative height={112} />
        </View>
      </View>
    );
  }
  if (error) return <ErrorState actionLabel={onRetry ? "Tekrar dene" : undefined} description={error} onAction={onRetry} title="YÖK duyuruları yüklenemedi" />;
  if (!attempted) return <EmptyState actionLabel={onRetry ? "Duyuruları yükle" : undefined} description="Resmî YÖK kaynağını denetleyerek başlayabilirsin." onAction={onRetry} title="YÖK duyuruları henüz yüklenmedi" />;
  return <EmptyState description={emptyDescription} title={emptyTitle} />;
}

function sourceStateRow(input: {
  key: SummerSectionKey;
  sourceTitle: string;
  loading: boolean;
  attempted: boolean;
  error?: string;
  offline: boolean;
  emptyTitle: string;
  emptyDescription: string;
}): Extract<SummerRow, { kind: "state" }> {
  if (input.offline) return { key: `state:${input.key}:offline`, kind: "state", state: "offline", title: "Çevrimdışısın", description: `Bu cihazda gösterilecek kayıtlı ${input.key === "dates" ? "yaz okulu tarihi" : "yaz okulu içeriği"} yok.` };
  if (input.loading) return { key: `state:${input.key}:loading`, kind: "state", state: "loading", title: `${input.sourceTitle} yükleniyor`, description: "" };
  if (input.error) return { key: `state:${input.key}:error`, kind: "state", state: "error", title: `${input.sourceTitle} yüklenemedi`, description: input.error };
  if (!input.attempted) return { key: `state:${input.key}:idle`, kind: "state", state: "idle", title: `${input.sourceTitle} henüz yüklenmedi`, description: "Yaz okulunu yenileyerek resmî kaynakları denetleyebilirsin." };
  return { key: `state:${input.key}:empty`, kind: "state", state: "empty", title: input.emptyTitle, description: input.emptyDescription };
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: "center",
    alignSelf: "flex-end",
    flexDirection: "row",
    minHeight: 48,
  },
  countCard: {
    alignItems: "center",
    flexShrink: 0,
    minWidth: 76,
    padding: 12,
  },
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  headingCopy: {
    flex: 1,
    minWidth: 0,
  },
  headingRow: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  iconTitleRow: {
    alignItems: "center",
    flexDirection: "row",
  },
  listContent: {
    alignSelf: "center",
    flexGrow: 1,
    width: "100%",
  },
  metadataRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  sectionHeader: {
    alignSelf: "stretch",
  },
});
