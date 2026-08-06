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
  Chip,
  EmptyState,
  ErrorState,
  SearchField,
  Skeleton,
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
}> = [
  { value: "all", label: "Tümü" },
  { value: "announcement", label: "Duyurular" },
  { value: "news", label: "Haberler" },
  { value: "event", label: "Etkinlikler" },
];

const SOURCE_FILTERS: ReadonlyArray<{
  value: FeedSourceFilter;
  label: string;
}> = [
  { value: "all", label: "Tüm kaynaklar" },
  { value: "university", label: "Üniversitem" },
  { value: "faculty", label: "Fakültem" },
  { value: "department", label: "Bölümüm" },
  { value: "yok", label: "YÖK" },
  { value: "summer-school", label: "Yaz Okulu" },
];

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

  const renderItem: ListRenderItem<ContentFeedItem> = ({ item }) => (
    <FeedRow item={item} onPress={onOpenItem} />
  );

  const header = (
    <View style={[styles.header, { gap: theme.spacing.md }]}>
      <View style={{ gap: theme.spacing.xxs }}>
        <Text
          accessibilityRole="header"
          style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}
        >
          Duyurular
        </Text>
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>
          {context || "Resmî akademik kaynaklardan güvenilir içerikler."}
        </Text>
      </View>

      <SearchField
        label="Duyurularda ara"
        placeholder="Başlık, özet veya kaynak ara"
        value={searchText}
        onChangeText={(value) => {
          resultAnnouncementRequestedRef.current = true;
          setSearchText(value);
        }}
        onClear={() => {
          resultAnnouncementRequestedRef.current = true;
          setDebouncedSearchText("");
        }}
      />

      <FilterGroup title="İçerik türü">
        {CONTENT_FILTERS.map((option) => (
          <Chip
            key={option.value}
            accessibilityLabel={`${option.label} içerik türü filtresi`}
            label={option.label}
            selected={contentTypeFilter === option.value}
            onPress={() => {
              if (contentTypeFilter === option.value) return;
              resultAnnouncementRequestedRef.current = true;
              setContentTypeFilter(option.value);
            }}
            style={styles.filterChip}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="Akademik kapsam ve kaynak">
        {SOURCE_FILTERS.map((option) => (
          <Chip
            key={option.value}
            accessibilityLabel={`${option.label} kaynak filtresi`}
            label={option.label}
            selected={sourceFilter === option.value}
            onPress={() => {
              if (sourceFilter === option.value) return;
              resultAnnouncementRequestedRef.current = true;
              setSourceFilter(option.value);
            }}
            style={styles.filterChip}
          />
        ))}
      </FilterGroup>

      <View
        accessible
        accessibilityLabel={resultAnnouncement}
        accessibilityLiveRegion={adaptation.platform === "android" ? "polite" : undefined}
        style={[
          styles.filterSummary,
          {
            backgroundColor: theme.colors.background.subtle,
            borderColor: theme.colors.border.default,
            borderRadius: theme.radii.control,
            padding: theme.spacing.sm,
          },
        ]}
        testID="announcements-filter-summary"
      >
        <Text style={[theme.typography.metaStrong, { color: theme.colors.text.primary }]}>
          {selectedContentLabel} · {selectedSourceLabel}
          {searchActive ? " · Arama etkin" : ""}
        </Text>
        <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>
          {visibleItems.length} güvenilir içerik
        </Text>
      </View>

      {onOpenYok || onOpenSummerSchool ? (
        <View style={[styles.destinationActions, { gap: theme.spacing.xs }]}>
          {onOpenYok ? (
            <Button compact label="YÖK sayfasını aç" onPress={onOpenYok} variant="ghost" />
          ) : null}
          {onOpenSummerSchool ? (
            <Button
              compact
              label="Yaz Okulu sayfasını aç"
              onPress={onOpenSummerSchool}
              variant="ghost"
            />
          ) : null}
        </View>
      ) : null}

      {allItems.length > 0
        ? availabilityBanner(feedState, error, onRetry ?? onRefresh)
        : null}
    </View>
  );

  return (
    <FlatList
      ref={listRef}
      accessibilityLabel="Güvenilir akademik içerik akışı"
      accessibilityState={{ busy }}
      contentContainerStyle={[
        styles.listContent,
        {
          alignSelf: "center",
          gap: theme.spacing.sm,
          maxWidth: layout.maxWidth,
          paddingBottom: theme.spacing.xl,
          paddingHorizontal: layout.gutter,
          paddingTop: theme.spacing.md,
          width: "100%",
        },
      ]}
      data={visibleItems}
      initialNumToRender={10}
      keyExtractor={(item) => item.key}
      ListEmptyComponent={emptyContent(feedState, clearFilters, onRetry ?? onRefresh)}
      ListFooterComponent={paginationFooter({
        paginationLoading: visibleItems.length > 0 && paginationLoading,
        paginationError: visibleItems.length > 0 ? paginationError : undefined,
        onRetryPagination,
      })}
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
      style={{ backgroundColor: theme.colors.background.canvas, flex: 1 }}
      testID={`announcements-feed-${adaptation.platform}-${layout.filterGroupsStacked ? "stacked" : "wrapped"}-${layout.supportsLargeText ? "large-text" : "standard-text"}-limit-${serverLimit ?? "none"}`}
      windowSize={7}
    />
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View accessibilityLabel={title} style={{ gap: theme.spacing.xs }}>
      <Text
        accessibilityRole="header"
        style={[theme.typography.label, { color: theme.colors.text.primary }]}
      >
        {title}
      </Text>
      <View style={[styles.filterOptions, { gap: theme.spacing.xs }]}>{children}</View>
    </View>
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
    <Card
      accessibilityLabel={rowLabel}
      onPress={() => onPress(item)}
      style={[styles.feedRow, { gap: theme.spacing.sm, minHeight: 48 }]}
      testID={`announcement-feed-item-${item.key}`}
      variant="outlined"
    >
      <View style={[styles.sourceRow, { gap: theme.spacing.sm }]}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.sourceMark,
            {
              backgroundColor: theme.colors.state.selected,
              borderRadius: theme.radii.pill,
            },
          ]}
        >
          <Text style={[theme.typography.label, { color: theme.colors.text.link }]}>
            {sourceInitial(record.sourceName)}
          </Text>
        </View>
        <Text
          style={[
            theme.typography.bodyStrong,
            styles.flexibleText,
            { color: theme.colors.text.primary },
          ]}
        >
          {record.sourceName}
        </Text>
      </View>
      <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>
        {scopeLabel} · {typeLabel}
      </Text>
      <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>
        {timeLabel}
      </Text>
      <Text style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>
        {record.title}
      </Text>
      {record.summary ? (
        <Text
          ellipsizeMode="tail"
          numberOfLines={3}
          style={[theme.typography.body, { color: theme.colors.text.secondary }]}
        >
          {record.summary}
        </Text>
      ) : null}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.rowAction}
      >
        <Text style={[theme.typography.label, { color: theme.colors.text.link }]}>
          Ayrıntıyı aç
        </Text>
        <Ionicons color={theme.colors.text.link} name="chevron-forward" size={18} />
      </View>
    </Card>
  );
}

function scopeAndSourceLabel(item: ContentFeedItem): string {
  const familyLabels = [
    item.sourceFamilies.includes("yok") ? "YÖK" : null,
    item.sourceFamilies.includes("summer-school") ? "Yaz Okulu" : null,
  ].filter((value): value is string => Boolean(value));
  const scopeLabel = SCOPE_LABELS[item.record.scopeType];
  return [...familyLabels, scopeLabel].join(" · ");
}

function sourceInitial(sourceName: string): string {
  return Array.from(sourceName.trim())[0]?.toLocaleUpperCase("tr-TR") ?? "R";
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
  destinationActions: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  feedRow: {
    marginBottom: 4,
  },
  filterChip: {
    flexGrow: 0,
    minHeight: 48,
  },
  filterOptions: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  filterSummary: {
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  flexibleText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  header: {
    minWidth: 0,
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
  rowAction: {
    alignItems: "center",
    alignSelf: "flex-end",
    flexDirection: "row",
    minHeight: 48,
  },
  skeletons: {
    gap: 12,
  },
  sourceMark: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  sourceRow: {
    alignItems: "center",
    flexDirection: "row",
    minWidth: 0,
  },
});
