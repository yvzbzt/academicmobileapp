import { Ionicons } from "@expo/vector-icons";
import { useNetworkState } from "expo-network";
import { useScrollToTop } from "@react-navigation/native";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ListRenderItem,
} from "react-native";
import {
  Banner,
  BottomSheet,
  EmptyState,
  ErrorState,
  Skeleton,
  referencePalette,
  usePlatformAdaptation,
  useTheme,
} from "../design-system";
import {
  contentTimestampLabel,
  type ContentCollectionState,
  type TrustedMobileContentRecord,
} from "../content/content-trust";
import {
  CONTENT_FEED_SEARCH_DEBOUNCE_MS,
  buildContentFeed,
  filterContentFeed,
  hasActiveContentFeedFilters,
  resolveContentFeedLayout,
  resolveContentFeedState,
  type ContentFeedItem,
  type FeedContentTypeFilter,
  type FeedSourceFilter,
} from "./feed-model";

const CONTENT_FILTERS: ReadonlyArray<{
  value: FeedContentTypeFilter;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { value: "all", label: "Tümü", icon: "apps-outline" },
  { value: "announcement", label: "Duyurular", icon: "megaphone-outline" },
  { value: "news", label: "Haberler", icon: "newspaper-outline" },
  { value: "event", label: "Etkinlikler", icon: "calendar-outline" },
];

const SOURCE_FILTERS: ReadonlyArray<{
  value: FeedSourceFilter;
  label: string;
  shortLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { value: "all", label: "Tüm kaynaklar", shortLabel: "Tümü", icon: "layers-outline" },
  { value: "university", label: "Üniversitem", shortLabel: "Üniversitem", icon: "business-outline" },
  { value: "faculty", label: "Fakültem", shortLabel: "Fakültem", icon: "library-outline" },
  { value: "department", label: "Bölümüm", shortLabel: "Bölümüm", icon: "people-outline" },
  { value: "yok", label: "YÖK", shortLabel: "YÖK", icon: "school-outline" },
  { value: "summer-school", label: "Yaz Okulu", shortLabel: "Yaz Okulu", icon: "sunny-outline" },
];

const REFERENCE_COLORS = {
  background: referencePalette.white,
  blue: referencePalette.academicBlue,
  blueSoft: referencePalette.academicBlueTint,
  border: referencePalette.academicBorderCool,
  green: referencePalette.academicGreen,
  greenSoft: referencePalette.academicGreenTint,
  navy: referencePalette.navy,
  orange: referencePalette.academicOrangeFeed,
  orangeSoft: referencePalette.academicOrangeFeedSoft,
  purple: referencePalette.academicPurple,
  purpleSoft: referencePalette.academicPurpleSoft,
  red: referencePalette.academicRedFeed,
  redSoft: referencePalette.academicRedSoft,
  secondary: referencePalette.academicTextSecondary,
} as const;

const CONTENT_TYPE_LABELS: Record<Exclude<FeedContentTypeFilter, "all">, string> = {
  announcement: "Duyuru",
  news: "Haber",
  event: "Etkinlik",
};

const SCOPE_LABELS: Record<TrustedMobileContentRecord["scopeType"], string> = {
  university: "Üniversite",
  faculty: "Fakülte",
  department: "Bölüm",
};

export interface AnnouncementsFeedProps {
  academicItems: readonly TrustedMobileContentRecord[];
  yokItems: readonly TrustedMobileContentRecord[];
  summerItems: readonly TrustedMobileContentRecord[];
  universityName?: string;
  facultyName?: string;
  departmentName?: string;
  loading?: boolean;
  attempted?: boolean;
  refreshing?: boolean;
  error?: string;
  offline?: boolean;
  stale?: boolean;
  partial?: boolean;
  collectionState?: ContentCollectionState;
  serverLimit?: number;
  hasMore?: boolean;
  paginationLoading?: boolean;
  paginationError?: string;
  initialSearchText?: string;
  initialContentTypeFilter?: FeedContentTypeFilter;
  initialSourceFilter?: FeedSourceFilter;
  onRefresh?: () => void;
  onRetry?: () => void;
  onLoadMore?: () => void;
  onRetryPagination?: () => void;
  onOpenItem: (item: ContentFeedItem) => void;
  onOpenYok?: () => void;
  onOpenSummerSchool?: () => void;
  onOpenNotificationSettings?: () => void;
}

export function AnnouncementsFeed({
  academicItems,
  yokItems,
  summerItems,
  universityName,
  facultyName,
  departmentName,
  loading = false,
  attempted = false,
  refreshing = false,
  error,
  offline,
  stale = false,
  partial = false,
  collectionState,
  serverLimit,
  hasMore = false,
  paginationLoading = false,
  paginationError,
  initialSearchText = "",
  initialContentTypeFilter = "all",
  initialSourceFilter = "all",
  onRefresh,
  onRetry,
  onLoadMore,
  onRetryPagination,
  onOpenItem,
  onOpenYok,
  onOpenSummerSchool,
  onOpenNotificationSettings,
}: AnnouncementsFeedProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const networkState = useNetworkState();
  const { fontScale, width } = useWindowDimensions();
  const layout = resolveContentFeedLayout(width, fontScale);
  const listRef = useRef<FlatList<ContentFeedItem> | null>(null);
  useScrollToTop(listRef);
  const [searchText, setSearchText] = useState(initialSearchText);
  const [debouncedSearchText, setDebouncedSearchText] = useState(initialSearchText);
  const [contentTypeFilter, setContentTypeFilter] = useState<FeedContentTypeFilter>(
    initialContentTypeFilter,
  );
  const [sourceFilter, setSourceFilter] = useState<FeedSourceFilter>(initialSourceFilter);
  const [sourceMenuVisible, setSourceMenuVisible] = useState(false);
  const resultAnnouncementRequestedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearchText(searchText),
      CONTENT_FEED_SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchText]);

  const allItems = useMemo(
    () => buildContentFeed({
      academic: academicItems,
      yok: yokItems,
      summerSchool: summerItems,
    }),
    [academicItems, summerItems, yokItems],
  );
  const visibleItems = useMemo(
    () => filterContentFeed(allItems, {
      contentType: contentTypeFilter,
      source: sourceFilter,
      query: debouncedSearchText,
    }),
    [allItems, contentTypeFilter, debouncedSearchText, sourceFilter],
  );
  const hasActiveFilters = hasActiveContentFeedFilters({
    contentType: contentTypeFilter,
    source: sourceFilter,
    query: debouncedSearchText,
  });
  const searchActive = hasActiveContentFeedFilters({
    contentType: "all",
    source: "all",
    query: debouncedSearchText,
  });
  const effectiveCollectionState: ContentCollectionState | undefined = partial
    ? "partial"
    : stale
      ? "stale"
      : collectionState;
  const effectiveOffline = offline ?? (
    networkState.isConnected === false || networkState.isInternetReachable === false
  );
  const feedState = resolveContentFeedState({
    loading: loading || refreshing,
    attempted,
    totalItemCount: allItems.length,
    visibleItemCount: visibleItems.length,
    hasActiveFilters,
    error,
    offline: effectiveOffline,
    stale,
    collectionState: effectiveCollectionState,
    paginationLoading,
    paginationError,
  });
  const busy = feedState === "initial_loading"
    || loading
    || refreshing
    || paginationLoading;
  const context = [universityName, facultyName, departmentName]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const selectedContentLabel = CONTENT_FILTERS.find(
    (option) => option.value === contentTypeFilter,
  )?.label ?? "Tümü";
  const selectedSourceLabel = SOURCE_FILTERS.find(
    (option) => option.value === sourceFilter,
  )?.label ?? "Tüm kaynaklar";
  const resultAnnouncement = `Seçili filtreler: ${selectedContentLabel}, ${selectedSourceLabel}${searchActive ? ", arama etkin" : ""}. ${visibleItems.length} sonuç.`;

  useEffect(() => {
    if (!resultAnnouncementRequestedRef.current) return;
    resultAnnouncementRequestedRef.current = false;
    if (adaptation.platform === "ios") {
      AccessibilityInfo.announceForAccessibility(resultAnnouncement);
    }
  }, [
    adaptation.platform,
    contentTypeFilter,
    debouncedSearchText,
    resultAnnouncement,
    sourceFilter,
  ]);

  const clearFilters = () => {
    resultAnnouncementRequestedRef.current = true;
    setSearchText("");
    setDebouncedSearchText("");
    setContentTypeFilter("all");
    setSourceFilter("all");
  };

  const selectContentType = (value: FeedContentTypeFilter) => {
    if (contentTypeFilter === value) return;
    resultAnnouncementRequestedRef.current = true;
    setContentTypeFilter(value);
  };

  const selectSource = (value: FeedSourceFilter) => {
    if (sourceFilter !== value) {
      resultAnnouncementRequestedRef.current = true;
      setSourceFilter(value);
    }
    setSourceMenuVisible(false);
  };

  const renderItem: ListRenderItem<ContentFeedItem> = ({ item }) => (
    <FeedRow item={item} onPress={onOpenItem} />
  );

  const header = (
    <View style={[styles.header, { gap: theme.spacing.md }]}>
      <View style={styles.pageTitleRow} testID="announcements-top-bar">
        <Text
          accessibilityRole="header"
          style={[theme.typography.screenTitle, styles.pageTitle, { color: REFERENCE_COLORS.navy }]}
        >
          Duyurular
        </Text>
        <Pressable
          accessibilityLabel="Bildirim tercihlerini aç"
          accessibilityRole="button"
          disabled={!onOpenNotificationSettings}
          hitSlop={8}
          onPress={onOpenNotificationSettings}
          style={({ pressed }) => [styles.notificationGlyph, pressed && styles.pressed]}
        >
          <Ionicons color={REFERENCE_COLORS.navy} name="notifications-outline" size={26} />
          <View style={styles.notificationDot} />
        </Pressable>
      </View>

      <View
        accessible={false}
        style={styles.searchFrame}
        testID="announcements-search-frame"
      >
        <Ionicons color={REFERENCE_COLORS.secondary} name="search-outline" size={22} />
        <TextInput
          accessibilityLabel="Duyurularda ara"
          accessibilityRole="search"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(value) => {
            resultAnnouncementRequestedRef.current = true;
            setSearchText(value);
          }}
          placeholder="Başlık, özet veya kaynak ara"
          placeholderTextColor={referencePalette.academicPlaceholder}
          returnKeyType="search"
          selectionColor={REFERENCE_COLORS.blue}
          style={[theme.typography.body, styles.searchInput]}
          value={searchText}
        />
        {searchText ? (
          <Pressable
            accessibilityLabel="Aramayı temizle"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              resultAnnouncementRequestedRef.current = true;
              setSearchText("");
              setDebouncedSearchText("");
            }}
            style={styles.clearSearch}
          >
            <Ionicons color={REFERENCE_COLORS.secondary} name="close-circle" size={20} />
          </Pressable>
        ) : null}
      </View>

      <FilterGroup title="İçerik türü">
        <ScrollView
          contentContainerStyle={styles.filterRail}
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
        >
          {CONTENT_FILTERS.map((option) => (
            <FilterPill
              accessibilityLabel={`${option.label} içerik türü filtresi`}
              icon={option.icon}
              key={option.value}
              label={option.label}
              onPress={() => selectContentType(option.value)}
              selected={contentTypeFilter === option.value}
            />
          ))}
        </ScrollView>
      </FilterGroup>

      <FilterGroup title="Kaynak">
        <Pressable
          aria-expanded={sourceMenuVisible}
          accessibilityLabel={`Kaynak filtresi. ${selectedSourceLabel}`}
          accessibilityRole="button"
          onPress={() => setSourceMenuVisible(true)}
          style={({ pressed }) => [
            styles.sourceFilterButton,
            {
              backgroundColor: pressed ? REFERENCE_COLORS.blueSoft : REFERENCE_COLORS.background,
              borderColor: sourceFilter === "all" ? REFERENCE_COLORS.border : REFERENCE_COLORS.blue,
            },
          ]}
          testID="announcements-source-filter"
        >
          <Ionicons color={REFERENCE_COLORS.secondary} name="options-outline" size={19} />
          <View style={styles.sourceFilterCopy}>
            <Text style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}>Kaynak</Text>
            <Text numberOfLines={1} style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.navy }]}>{selectedSourceLabel}</Text>
          </View>
          {sourceFilter !== "all" ? (
            <View style={[styles.activeFilterDot, { backgroundColor: REFERENCE_COLORS.blue }]} />
          ) : null}
          <Ionicons color={REFERENCE_COLORS.secondary} name="chevron-down" size={18} />
        </Pressable>
      </FilterGroup>

      <View
        accessible
        accessibilityLabel={resultAnnouncement}
        accessibilityLiveRegion={adaptation.platform === "android" ? "polite" : undefined}
        style={styles.visuallyHidden}
        testID="announcements-filter-summary"
      />

      {allItems.length > 0
        ? availabilityBanner(feedState, error, onRetry ?? onRefresh)
        : null}
    </View>
  );

  return (
    <>
    <FlatList
      ref={listRef}
      accessibilityLabel="Güvenilir akademik içerik akışı"
      accessibilityState={{ busy }}
      contentContainerStyle={[
        styles.listContent,
        {
          alignSelf: "center",
          maxWidth: layout.maxWidth,
          paddingBottom: theme.spacing.xxl,
          paddingHorizontal: layout.gutter,
          paddingTop: theme.spacing.lg,
          width: "100%",
        },
      ]}
      data={visibleItems}
      initialNumToRender={10}
      keyExtractor={(item) => item.key}
      ListEmptyComponent={emptyContent(feedState, clearFilters, onRetry ?? onRefresh)}
      ListFooterComponent={visibleItems.length > 0 ? (
        <View style={styles.feedFooter}>
          {paginationFooter({
            paginationLoading,
            paginationError,
            onRetryPagination,
          })}
          <AnnouncementReminderBanner onPress={onOpenNotificationSettings} />
        </View>
      ) : null}
      ListHeaderComponent={header}
      maxToRenderPerBatch={10}
      onEndReached={() => {
        if (hasMore && !paginationLoading && !paginationError) onLoadMore?.();
      }}
      onEndReachedThreshold={0.35}
      onRefresh={onRefresh}
      refreshing={refreshing}
      renderItem={renderItem}
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: REFERENCE_COLORS.background, flex: 1 }}
      testID={`announcements-feed-${adaptation.platform}-${layout.filterGroupsStacked ? "stacked" : "wrapped"}-${layout.supportsLargeText ? "large-text" : "standard-text"}-limit-${serverLimit ?? "none"}`}
      windowSize={7}
    />
    <BottomSheet
      onDismiss={() => setSourceMenuVisible(false)}
      title="Kaynak filtresi"
      visible={sourceMenuVisible}
    >
      <View accessibilityRole="radiogroup" style={styles.sourceMenuList}>
        {SOURCE_FILTERS.map((option) => {
          const selected = sourceFilter === option.value;
          const destinationAction = option.value === "yok"
            ? onOpenYok
            : option.value === "summer-school"
              ? onOpenSummerSchool
              : undefined;
          return (
            <View key={option.value} style={[styles.sourceMenuRow, { borderBottomColor: REFERENCE_COLORS.border }]}>
              <Pressable
                accessibilityLabel={`${option.label} kaynak filtresi`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => selectSource(option.value)}
                style={({ pressed }) => [
                  styles.sourceMenuOption,
                  pressed && { backgroundColor: REFERENCE_COLORS.blueSoft },
                ]}
              >
                <Ionicons color={selected ? REFERENCE_COLORS.blue : REFERENCE_COLORS.secondary} name={option.icon} size={20} />
                <Text style={[theme.typography.body, styles.flexibleText, { color: REFERENCE_COLORS.navy }]}>{option.label}</Text>
                {selected ? <Ionicons color={REFERENCE_COLORS.blue} name="checkmark" size={20} /> : null}
              </Pressable>
              {destinationAction ? (
                <SourceDestinationButton
                  accessibilityLabel={`${option.label} sayfasını aç`}
                  onPress={() => {
                    setSourceMenuVisible(false);
                    destinationAction();
                  }}
                />
              ) : null}
            </View>
          );
        })}
      </View>
    </BottomSheet>
    </>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View accessibilityLabel={title} style={styles.filterGroup}>
      <Text
        accessibilityRole="header"
        style={styles.visuallyHidden}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function FilterPill({
  accessibilityLabel,
  icon,
  label,
  onPress,
  selected,
}: {
  accessibilityLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterPill,
        {
          backgroundColor: selected ? REFERENCE_COLORS.blueSoft : REFERENCE_COLORS.background,
          borderColor: selected ? REFERENCE_COLORS.blue : REFERENCE_COLORS.border,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <Ionicons
        accessibilityElementsHidden
        color={selected ? REFERENCE_COLORS.blue : REFERENCE_COLORS.secondary}
        importantForAccessibility="no-hide-descendants"
        name={icon}
        size={17}
      />
      <Text
        numberOfLines={1}
        style={[
          theme.typography.metaStrong,
          { color: selected ? REFERENCE_COLORS.blue : REFERENCE_COLORS.secondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SourceDestinationButton({
  accessibilityLabel,
  onPress,
}: {
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.sourceDestinationButton, pressed && styles.pressed]}
    >
      <Ionicons color={REFERENCE_COLORS.blue} name="arrow-forward" size={15} />
    </Pressable>
  );
}

function FeedRow({
  item,
  onPress,
}: {
  item: ContentFeedItem;
  onPress: (item: ContentFeedItem) => void;
}) {
  const theme = useTheme();
  const record = item.record;
  const scopeLabel = scopeAndSourceLabel(item);
  const typeLabel = CONTENT_TYPE_LABELS[item.contentType];
  const timeLabel = contentTimestampLabel(record);
  const palette = feedItemPalette(item);
  const rowLabel = [
    record.sourceName,
    scopeLabel,
    typeLabel,
    timeLabel,
    record.title,
    record.summary,
    "Ayrıntıyı aç",
  ].filter(Boolean).join(". ");

  return (
    <Pressable
      accessibilityLabel={rowLabel}
      accessibilityRole="button"
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.feedRow, pressed && styles.feedRowPressed]}
      testID={`announcement-feed-item-${item.key}`}
    >
      <View style={styles.feedMetaRow}>
        <View
          style={[styles.typeBadge, { backgroundColor: palette.soft }]}
        >
          <Text style={[theme.typography.navLabel, { color: palette.accent }]}>{typeLabel}</Text>
        </View>
        <View style={styles.sourceIdentity}>
          <Text
            numberOfLines={1}
            style={[theme.typography.metaStrong, styles.sourceName, { color: REFERENCE_COLORS.secondary }]}
          >
            {record.sourceName}
          </Text>
          <Ionicons color={REFERENCE_COLORS.blue} name="checkmark-circle" size={15} />
        </View>
        <Text
          numberOfLines={1}
          style={[theme.typography.meta, styles.timestamp, { color: REFERENCE_COLORS.secondary }]}
        >
          {timeLabel}
        </Text>
      </View>
      <View style={styles.feedBodyRow}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.feedIconTile, { backgroundColor: palette.soft }]}
        >
          <Ionicons color={palette.accent} name={palette.icon} size={31} />
        </View>
        <View style={styles.feedCopy}>
          <Text
            style={[theme.typography.cardTitle, styles.feedTitle, { color: REFERENCE_COLORS.navy }]}
          >
            {record.title}
          </Text>
          {record.summary ? (
            <Text
              ellipsizeMode="tail"
              numberOfLines={3}
              style={[theme.typography.meta, styles.feedSummary, { color: REFERENCE_COLORS.secondary }]}
            >
              {record.summary}
            </Text>
          ) : null}
          <Text
            style={[theme.typography.navLabel, styles.scopeLabel, { color: palette.accent }]}
          >
            {scopeLabel}
          </Text>
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.feedActions}
        >
          <Ionicons color={REFERENCE_COLORS.secondary} name="bookmark-outline" size={20} />
          <Ionicons color={REFERENCE_COLORS.secondary} name="arrow-redo-outline" size={21} />
        </View>
      </View>
    </Pressable>
  );
}

function feedItemPalette(item: ContentFeedItem): {
  accent: string;
  soft: string;
  icon: keyof typeof Ionicons.glyphMap;
} {
  if (item.sourceFamilies.includes("summer-school")) {
    return { accent: REFERENCE_COLORS.orange, soft: REFERENCE_COLORS.orangeSoft, icon: "document-text-outline" };
  }
  if (item.contentType === "news") {
    return { accent: REFERENCE_COLORS.green, soft: REFERENCE_COLORS.greenSoft, icon: "school-outline" };
  }
  if (item.contentType === "event") {
    return { accent: REFERENCE_COLORS.purple, soft: REFERENCE_COLORS.purpleSoft, icon: "calendar-outline" };
  }
  if (item.record.scopeType === "faculty") {
    return { accent: REFERENCE_COLORS.orange, soft: REFERENCE_COLORS.orangeSoft, icon: "document-text-outline" };
  }
  return { accent: REFERENCE_COLORS.blue, soft: REFERENCE_COLORS.blueSoft, icon: "megaphone" };
}

function scopeAndSourceLabel(item: ContentFeedItem): string {
  const familyLabels = [
    item.sourceFamilies.includes("yok") ? "YÖK" : null,
    item.sourceFamilies.includes("summer-school") ? "Yaz Okulu" : null,
  ].filter((value): value is string => Boolean(value));
  const scopeLabel = SCOPE_LABELS[item.record.scopeType];
  return [...familyLabels, scopeLabel].join(" · ");
}

function AnnouncementReminderBanner({ onPress }: { onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel="Hiçbir duyuruyu kaçırma. Bildirimleri aç."
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.reminderBanner, pressed && styles.pressed]}
      testID="announcements-reminder-banner"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.reminderIcon, { backgroundColor: theme.colors.action.secondary }]}
      >
        <Ionicons color={theme.colors.action.primary} name="notifications-outline" size={25} />
      </View>
      <View style={styles.reminderCopy}>
        <Text
          style={[theme.typography.bodyStrong, styles.reminderTitle, { color: REFERENCE_COLORS.navy }]}
        >
          Duyurular için bildirim al
        </Text>
        <Text
          numberOfLines={2}
          style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}
        >
          Önemli duyurular için bildirimlerini açmayı unutma.
        </Text>
        <View style={styles.reminderAction}>
          <Text style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.blue }]}>Bildirimleri Aç</Text>
          <Ionicons color={REFERENCE_COLORS.blue} name="chevron-forward" size={17} />
        </View>
      </View>
    </Pressable>
  );
}

function availabilityBanner(
  state: ReturnType<typeof resolveContentFeedState>,
  error: string | undefined,
  onRetry: (() => void) | undefined,
): ReactElement | null {
  if (state === "background_refresh") {
    return <Banner title="İçerikler yenileniyor" message="Mevcut güvenilir içerikler ekranda tutuluyor." />;
  }
  if (state === "offline") {
    return (
      <Banner
        title="Çevrimdışısın"
        message="Daha önce yüklenen güvenilir içerikler gösteriliyor."
        tone="warning"
        actionLabel={onRetry ? "Yeniden dene" : undefined}
        onAction={onRetry}
      />
    );
  }
  if (state === "stale") {
    return (
      <Banner
        title="Son doğrulanan içerikler gösteriliyor"
        message={error ?? "Kaynaklar şu anda yenilenemedi."}
        tone="warning"
        actionLabel={onRetry ? "Yeniden dene" : undefined}
        onAction={onRetry}
      />
    );
  }
  if (state === "partial") {
    return (
      <Banner
        title="Bazı kaynaklara ulaşılamadı"
        message="Ulaşılabilen güvenilir içerikler gösteriliyor."
        tone="warning"
        actionLabel={onRetry ? "Yeniden dene" : undefined}
        onAction={onRetry}
      />
    );
  }
  return null;
}

function emptyContent(
  state: ReturnType<typeof resolveContentFeedState>,
  clearFilters: () => void,
  onRetry: (() => void) | undefined,
): ReactElement | null {
  if (state === "initial_loading") {
    return (
      <View
        accessible
        accessibilityLabel="Duyurular yükleniyor"
        accessibilityRole="progressbar"
        accessibilityState={{ busy: true }}
        style={styles.loadingState}
      >
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.skeletons}>
          <Skeleton decorative height={22} width="48%" />
          <Skeleton decorative height={118} />
          <Skeleton decorative height={118} />
        </View>
      </View>
    );
  }
  if (state === "offline") {
    return (
      <ErrorState
        title="Çevrimdışısın"
        description="İçerikleri yüklemek için bağlantını kontrol edip yeniden deneyebilirsin."
        actionLabel={onRetry ? "Yeniden dene" : undefined}
        onAction={onRetry}
      />
    );
  }
  if (state === "recoverable_error") {
    return (
      <ErrorState
        title="Duyurular yüklenemedi"
        description="Bağlantını kontrol edip yeniden deneyebilirsin."
        actionLabel={onRetry ? "Tekrar dene" : undefined}
        onAction={onRetry}
      />
    );
  }
  if (state === "partial") {
    return (
      <ErrorState
        title="Bazı kaynaklara ulaşılamadı"
        description="Ulaşılabilen kaynaklarda gösterilecek güvenilir içerik bulunamadı."
        actionLabel={onRetry ? "Yeniden dene" : undefined}
        onAction={onRetry}
      />
    );
  }
  if (state === "no_results") {
    return (
      <EmptyState
        title="Bu filtrelerde sonuç yok"
        description="Arama metnini veya seçili filtreleri değiştirerek tekrar deneyebilirsin."
        actionLabel="Filtreleri temizle"
        onAction={clearFilters}
      />
    );
  }
  if (state === "empty") {
    return (
      <EmptyState
        title="Henüz güvenilir içerik yok"
        description="Resmî kaynaklarda yeni içerik yayımlandığında burada görünecek."
      />
    );
  }
  return null;
}

function paginationFooter({
  paginationLoading,
  paginationError,
  onRetryPagination,
}: {
  paginationLoading: boolean;
  paginationError?: string;
  onRetryPagination?: () => void;
}): ReactElement | null {
  if (paginationError) {
    return (
      <Banner
        title="Daha fazla içerik yüklenemedi"
        message="Mevcut içerikler korunuyor."
        tone="warning"
        actionLabel={onRetryPagination ? "Tekrar dene" : undefined}
        onAction={onRetryPagination}
        style={styles.paginationFooter}
      />
    );
  }
  if (paginationLoading) {
    return (
      <View
        accessible
        accessibilityLabel="Daha fazla içerik yükleniyor"
        accessibilityRole="progressbar"
        accessibilityState={{ busy: true }}
        style={styles.paginationLoading}
      >
        <ActivityIndicator />
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  clearSearch: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  activeFilterDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  feedActions: {
    alignItems: "center",
    gap: 14,
    justifyContent: "flex-end",
    paddingBottom: 2,
    width: 24,
  },
  feedBodyRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 12,
    minWidth: 0,
  },
  feedCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  feedFooter: {
    gap: 14,
    paddingTop: 14,
  },
  feedIconTile: {
    alignItems: "center",
    borderRadius: 16,
    justifyContent: "center",
    minHeight: 76,
    width: 62,
  },
  feedMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
  },
  feedRow: {
    borderBottomColor: REFERENCE_COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    minHeight: 132,
    paddingVertical: 16,
  },
  feedRowPressed: {
    backgroundColor: REFERENCE_COLORS.blueSoft,
  },
  feedSummary: {
    lineHeight: 19,
  },
  feedTitle: {
    fontSize: 16,
    lineHeight: 22,
  },
  filterGroup: {
    minWidth: 0,
  },
  filterPill: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 44,
    paddingHorizontal: 13,
  },
  filterRail: {
    alignItems: "center",
    gap: 8,
    paddingRight: 12,
  },
  flexibleText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  header: {
    minWidth: 0,
    paddingBottom: 2,
  },
  listContent: {
    flexGrow: 1,
  },
  loadingState: {
    paddingVertical: 24,
  },
  paginationFooter: {
    marginTop: 12,
  },
  paginationLoading: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 64,
  },
  pageTitle: {
    fontSize: 28,
    lineHeight: 34,
  },
  pageTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
  },
  pressed: {
    opacity: 0.65,
  },
  reminderAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
    marginTop: 2,
  },
  reminderBanner: {
    alignItems: "center",
    borderColor: referencePalette.academicBorderBlueMuted,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 96,
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  reminderIcon: {
    alignItems: "center",
    borderRadius: 8,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  reminderCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  reminderTitle: {
    fontSize: 14,
    lineHeight: 19,
  },
  notificationDot: {
    backgroundColor: REFERENCE_COLORS.blue,
    borderColor: REFERENCE_COLORS.background,
    borderRadius: 5,
    borderWidth: 2,
    height: 10,
    position: "absolute",
    right: 1,
    top: 1,
    width: 10,
  },
  notificationGlyph: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  scopeLabel: {
    marginTop: 2,
  },
  searchFrame: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.background,
    borderColor: REFERENCE_COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 58,
    paddingLeft: 16,
    paddingRight: 7,
  },
  searchInput: {
    color: REFERENCE_COLORS.navy,
    flex: 1,
    minHeight: 56,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  skeletons: {
    gap: 12,
  },
  sourceDestinationButton: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.blueSoft,
    borderRadius: 8,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  sourceFilterButton: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 12,
  },
  sourceFilterCopy: {
    flex: 1,
    minWidth: 0,
  },
  sourceMenuList: {
    minHeight: 0,
  },
  sourceMenuOption: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 52,
    minWidth: 0,
    paddingHorizontal: 8,
  },
  sourceMenuRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 52,
  },
  sourceIdentity: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 4,
    minWidth: 0,
  },
  sourceName: {
    flexShrink: 1,
    minWidth: 0,
  },
  timestamp: {
    flexShrink: 1,
    maxWidth: 118,
    textAlign: "right",
  },
  typeBadge: {
    alignItems: "center",
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
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
