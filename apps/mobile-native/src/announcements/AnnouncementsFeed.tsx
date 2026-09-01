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
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import {
  officialContentDomain,
  primaryContentKeyDate,
  shortContentCardExcerpt,
  trustedContentDestinationUrl,
} from "./content-card";

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
  { value: "university", label: "Üniversitem", shortLabel: "Üniversite", icon: "business-outline" },
  { value: "faculty", label: "Fakültem", shortLabel: "Fakülte", icon: "library-outline" },
  { value: "department", label: "Bölümüm", shortLabel: "Bölüm", icon: "people-outline" },
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

const academicCalendarLogo = require("../../assets/design-package/academic-calendar-logo.png");

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
  notificationPreferenceEnabled: boolean;
  notificationActive: boolean;
  initialSearchText?: string;
  initialContentTypeFilter?: FeedContentTypeFilter;
  initialSourceFilter?: FeedSourceFilter;
  onRefresh?: () => void;
  onRetry?: () => void;
  onLoadMore?: () => void;
  onRetryPagination?: () => void;
  onOpenOfficialSource: (url: string) => void | Promise<unknown>;
  onOpenYok?: () => void;
  onOpenSummerSchool?: () => void;
  onOpenNotificationSettings?: () => void;
  onOpenAccountMenu?: () => void;
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
  notificationPreferenceEnabled,
  notificationActive,
  initialSearchText = "",
  initialContentTypeFilter = "all",
  initialSourceFilter = "all",
  onRefresh,
  onRetry,
  onLoadMore,
  onRetryPagination,
  onOpenOfficialSource,
  onOpenYok,
  onOpenSummerSchool,
  onOpenNotificationSettings,
  onOpenAccountMenu,
}: AnnouncementsFeedProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const networkState = useNetworkState();
  const { fontScale, width } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const layout = resolveContentFeedLayout(width, fontScale);
  const bottomNavigationClearance = adaptation.navigationLayout === "navigation-rail"
    ? theme.spacing.xxl
    : 64 + safeAreaInsets.bottom + theme.spacing.lg;
  const listRef = useRef<FlatList<ContentFeedItem> | null>(null);
  useScrollToTop(listRef);
  const [searchText, setSearchText] = useState(initialSearchText);
  const [debouncedSearchText, setDebouncedSearchText] = useState(initialSearchText);
  const [contentTypeFilter, setContentTypeFilter] = useState<FeedContentTypeFilter>(
    initialContentTypeFilter,
  );
  const [sourceFilter, setSourceFilter] = useState<FeedSourceFilter>(initialSourceFilter);
  const [filterMenuVisible, setFilterMenuVisible] = useState(false);
  const resultAnnouncementRequestedRef = useRef(false);
  const showNotificationReminder = Boolean(
    onOpenNotificationSettings
    && (!notificationPreferenceEnabled || !notificationActive),
  );

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
    Keyboard.dismiss();
    resultAnnouncementRequestedRef.current = true;
    setSearchText("");
    setDebouncedSearchText("");
    setContentTypeFilter("all");
    setSourceFilter("all");
  };

  const selectContentType = (value: FeedContentTypeFilter) => {
    Keyboard.dismiss();
    if (contentTypeFilter !== value) {
      resultAnnouncementRequestedRef.current = true;
      setContentTypeFilter(value);
    }
    setFilterMenuVisible(false);
  };

  const selectSource = (value: FeedSourceFilter) => {
    Keyboard.dismiss();
    if (sourceFilter !== value) {
      resultAnnouncementRequestedRef.current = true;
      setSourceFilter(value);
    }
    setFilterMenuVisible(false);
  };

  const renderItem: ListRenderItem<ContentFeedItem> = ({ item }) => (
    <FeedRow
      item={item}
      onOpenOfficialSource={onOpenOfficialSource}
      stacked={layout.supportsLargeText}
    />
  );

  const header = (
    <View
      style={[
        styles.header,
        layout.supportsLargeText ? styles.headerLargeText : styles.headerStandardText,
      ]}
    >
      <View style={styles.brandBar} testID="announcements-top-bar">
        <View accessibilityLabel="Akademik Takvim" style={styles.brandIdentity}>
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            source={academicCalendarLogo}
            style={styles.brandLogo}
          />
          <View style={styles.brandCopy}>
            <Text
              maxFontSizeMultiplier={1.25}
              numberOfLines={1}
              style={styles.brandName}
            >
              Akademik
            </Text>
            <Text
              maxFontSizeMultiplier={1.25}
              numberOfLines={1}
              style={styles.brandNameAccent}
            >
              Takvim
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="Bildirim tercihlerini aç"
            accessibilityRole="button"
            disabled={!onOpenNotificationSettings}
            hitSlop={8}
            onPress={onOpenNotificationSettings}
            style={({ pressed }) => [styles.notificationGlyph, pressed && styles.pressed]}
          >
            <Ionicons color={REFERENCE_COLORS.navy} name="notifications-outline" size={27} />
          </Pressable>
          {onOpenAccountMenu ? (
            <Pressable
              accessibilityLabel="Hesap menüsünü aç"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onOpenAccountMenu}
              style={({ pressed }) => [styles.accountAvatar, pressed && styles.pressed]}
            >
              <Ionicons color={REFERENCE_COLORS.blue} name="person-outline" size={23} />
            </Pressable>
          ) : (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.accountAvatar}
            >
              <Ionicons color={REFERENCE_COLORS.blue} name="person-outline" size={23} />
            </View>
          )}
        </View>
      </View>

      <View style={styles.heroHeader}>
        <View style={styles.heroCopy}>
          <Text
            accessibilityRole="header"
            adjustsFontSizeToFit={!layout.supportsLargeText}
            maxFontSizeMultiplier={layout.supportsLargeText ? undefined : 1.3}
            minimumFontScale={layout.supportsLargeText ? undefined : 0.8}
            numberOfLines={layout.supportsLargeText ? undefined : 1}
            style={[theme.typography.screenTitle, styles.pageTitle, { color: REFERENCE_COLORS.navy }]}
          >
            Duyurular
          </Text>
          <Text
            maxFontSizeMultiplier={1.35}
            style={[theme.typography.body, styles.pageSubtitle, { color: REFERENCE_COLORS.secondary }]}
          >
            Resmî akademik kaynaklardan güvenilir içerikler.
          </Text>
        </View>
        {!layout.supportsLargeText ? <AnnouncementArtwork /> : null}
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
          maxFontSizeMultiplier={layout.supportsLargeText ? undefined : 1.3}
          onChangeText={(value) => {
            resultAnnouncementRequestedRef.current = true;
            setSearchText(value);
          }}
          onSubmitEditing={() => Keyboard.dismiss()}
          placeholder="Duyuru ara..."
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
        <Pressable
          aria-expanded={filterMenuVisible}
          accessibilityLabel={`İçerik türü filtresi. ${selectedContentLabel}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: filterMenuVisible }}
          onPress={() => {
            Keyboard.dismiss();
            setFilterMenuVisible(true);
          }}
          style={({ pressed }) => [
            styles.filterMenuButton,
            pressed && styles.pressed,
          ]}
          testID="announcements-content-filter"
        >
          <Ionicons
            color={contentTypeFilter === "all" ? REFERENCE_COLORS.secondary : REFERENCE_COLORS.blue}
            name="options-outline"
            size={20}
          />
          {contentTypeFilter !== "all" ? (
            <View style={[styles.activeFilterDot, { backgroundColor: REFERENCE_COLORS.blue }]} />
          ) : null}
        </Pressable>
      </View>

      <FilterGroup title="Kaynak">
        <ScrollView
          contentContainerStyle={styles.scopeRail}
          horizontal
          keyboardDismissMode={adaptation.platform === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          testID="announcements-source-filter-rail"
        >
          {SOURCE_FILTERS.map((option) => (
            <FilterPill
              accessibilityLabel={`${option.label} kaynak filtresi`}
              key={option.value}
              label={option.shortLabel}
              onPress={() => selectSource(option.value)}
              selected={sourceFilter === option.value}
            />
          ))}
        </ScrollView>
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
          paddingBottom: Math.max(theme.spacing.xxl, bottomNavigationClearance),
          paddingHorizontal: layout.gutter,
          paddingTop: layout.supportsLargeText ? theme.spacing.lg : theme.spacing.sm,
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
          {showNotificationReminder && onOpenNotificationSettings ? (
            <AnnouncementReminderBanner
              preferenceEnabled={notificationPreferenceEnabled}
              onPress={onOpenNotificationSettings}
            />
          ) : null}
        </View>
      ) : null}
      ListHeaderComponent={header}
      keyboardDismissMode={adaptation.platform === "ios" ? "interactive" : "on-drag"}
      keyboardShouldPersistTaps="handled"
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
      onDismiss={() => setFilterMenuVisible(false)}
      scrollable
      title="Filtreler"
      visible={filterMenuVisible}
    >
      <View style={styles.filterMenuContent}>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.35}
          style={[theme.typography.bodyStrong, { color: REFERENCE_COLORS.navy }]}
        >
          İçerik türü
        </Text>
        <View accessibilityRole="radiogroup" style={styles.sourceMenuList}>
          {CONTENT_FILTERS.map((option) => {
            const selected = contentTypeFilter === option.value;
            return (
              <Pressable
                accessibilityLabel={`${option.label} içerik türü filtresi`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                key={option.value}
                onPress={() => selectContentType(option.value)}
                style={({ pressed }) => [
                  styles.filterMenuOption,
                  { borderBottomColor: REFERENCE_COLORS.border },
                  pressed && { backgroundColor: REFERENCE_COLORS.blueSoft },
                ]}
              >
                <Ionicons
                  color={selected ? REFERENCE_COLORS.blue : REFERENCE_COLORS.secondary}
                  name={option.icon}
                  size={20}
                />
                <Text
                  maxFontSizeMultiplier={2}
                  numberOfLines={2}
                  style={[theme.typography.body, styles.flexibleText, { color: REFERENCE_COLORS.navy }]}
                >
                  {option.label}
                </Text>
                {selected ? <Ionicons color={REFERENCE_COLORS.blue} name="checkmark" size={20} /> : null}
              </Pressable>
            );
          })}
        </View>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.35}
          style={[theme.typography.bodyStrong, styles.filterMenuSectionTitle, { color: REFERENCE_COLORS.navy }]}
        >
          Kaynaklar
        </Text>
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
                  <Text maxFontSizeMultiplier={2} numberOfLines={2} style={[theme.typography.body, styles.flexibleText, { color: REFERENCE_COLORS.navy }]}>{option.label}</Text>
                  {selected ? <Ionicons color={REFERENCE_COLORS.blue} name="checkmark" size={20} /> : null}
                </Pressable>
                {destinationAction ? (
                  <SourceDestinationButton
                    accessibilityLabel={`${option.label} sayfasını aç`}
                    onPress={() => {
                      setFilterMenuVisible(false);
                      destinationAction();
                    }}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    </BottomSheet>
    </>
  );
}

function AnnouncementArtwork() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.announcementArtwork}
    >
      <View style={styles.artworkHalo}>
        <Ionicons color={REFERENCE_COLORS.blue} name="megaphone" size={49} />
      </View>
      <View style={[styles.artworkRay, styles.artworkRayTop]} />
      <View style={[styles.artworkRay, styles.artworkRayMiddle]} />
      <View style={[styles.artworkRay, styles.artworkRayBottom]} />
      <View style={styles.artworkDot} />
      <View style={styles.artworkRing} />
    </View>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View accessible={false} style={styles.filterGroup}>
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
  label,
  onPress,
  selected,
}: {
  accessibilityLabel: string;
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
          backgroundColor: selected ? REFERENCE_COLORS.blue : REFERENCE_COLORS.background,
          borderColor: selected ? REFERENCE_COLORS.blue : REFERENCE_COLORS.border,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <Text
        maxFontSizeMultiplier={1.25}
        numberOfLines={1}
        style={[
          theme.typography.metaStrong,
          { color: selected ? REFERENCE_COLORS.background : REFERENCE_COLORS.secondary },
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
  onOpenOfficialSource,
  stacked,
}: {
  item: ContentFeedItem;
  onOpenOfficialSource: (url: string) => void | Promise<unknown>;
  stacked: boolean;
}) {
  const theme = useTheme();
  const record = item.record;
  const scopeLabel = scopeAndSourceLabel(item);
  const typeLabel = CONTENT_TYPE_LABELS[item.contentType];
  const timeLabel = contentTimestampLabel(record);
  const keyDate = primaryContentKeyDate(record);
  const palette = feedItemPalette(item);
  const excerpt = shortContentCardExcerpt(record);
  const destinationUrl = trustedContentDestinationUrl(record);
  const destinationDomain = destinationUrl ? officialContentDomain(destinationUrl) : null;
  const rowLabel = [
    record.sourceName,
    scopeLabel,
    typeLabel,
    keyDate?.text,
    timeLabel,
    record.title,
    excerpt,
    destinationDomain,
    destinationUrl ? "Resmî duyuruyu aç" : "Resmî bağlantı kullanılamıyor",
  ].filter(Boolean).join(". ");

  return (
    <Pressable
      accessibilityLabel={rowLabel}
      accessibilityRole={destinationUrl ? "link" : undefined}
      disabled={!destinationUrl}
      onPress={destinationUrl ? () => void onOpenOfficialSource(destinationUrl) : undefined}
      style={({ pressed }) => [styles.feedRow, pressed && styles.feedRowPressed]}
      testID={`announcement-feed-item-${item.key}`}
    >
      <View style={[styles.feedAccent, { backgroundColor: palette.accent }]} />
      <View style={styles.feedSourceRow}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.feedIconTile,
            { backgroundColor: palette.soft },
          ]}
        >
          <Ionicons color={palette.accent} name={palette.icon} size={22} />
        </View>
        <View style={styles.feedSourceCopy}>
          <Text
            maxFontSizeMultiplier={stacked ? undefined : 1.25}
            numberOfLines={stacked ? undefined : 2}
            style={[theme.typography.metaStrong, styles.feedSourceName, { color: REFERENCE_COLORS.navy }]}
          >
            {record.sourceName}
          </Text>
          <Text style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}>
            {typeLabel} · {scopeLabel}
          </Text>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Ionicons color={palette.accent} name="shield-checkmark-outline" size={21} />
        </View>
      </View>

      <View style={styles.feedCopy}>
        <Text
          maxFontSizeMultiplier={stacked ? undefined : 1.35}
          numberOfLines={stacked ? undefined : 3}
          style={[theme.typography.cardTitle, styles.feedTitle, { color: REFERENCE_COLORS.navy }]}
        >
          {record.title}
        </Text>
        {excerpt ? (
          <Text
            ellipsizeMode="tail"
            maxFontSizeMultiplier={stacked ? undefined : 1.3}
            numberOfLines={stacked ? undefined : 3}
            style={[theme.typography.meta, styles.feedSummary, { color: REFERENCE_COLORS.secondary }]}
          >
            {excerpt}
          </Text>
        ) : null}
      </View>

      <View style={[styles.feedFooterRow, stacked && styles.feedFooterRowStacked]}>
        <View style={styles.feedMetaColumn}>
          {keyDate ? (
            <View style={styles.feedMetaRow}>
              <Ionicons
                color={keyDate.kind === "deadline" ? palette.accent : REFERENCE_COLORS.secondary}
                name={contentKeyDateIcon(keyDate.kind)}
                size={15}
              />
              <Text
                maxFontSizeMultiplier={1.2}
                style={[
                  keyDate.kind === "deadline" ? theme.typography.metaStrong : theme.typography.meta,
                  styles.timestamp,
                  { color: keyDate.kind === "deadline" ? palette.accent : REFERENCE_COLORS.secondary },
                ]}
              >
                {keyDate.text}
              </Text>
            </View>
          ) : null}
          <View style={styles.feedMetaRow}>
            <Ionicons color={REFERENCE_COLORS.secondary} name="calendar-outline" size={15} />
            <Text
              maxFontSizeMultiplier={1.2}
              style={[theme.typography.meta, styles.timestamp, { color: REFERENCE_COLORS.secondary }]}
            >
              {timeLabel}
            </Text>
          </View>
        </View>
        {destinationDomain ? (
          <View style={styles.feedLinkAction}>
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={[theme.typography.metaStrong, styles.feedLinkLabel, { color: palette.accent }]}
            >
              {destinationDomain}
            </Text>
            <Ionicons color={palette.accent} name="open-outline" size={17} />
          </View>
        ) : null}
      </View>
      {destinationDomain ? (
        <Text style={[theme.typography.navLabel, styles.feedLinkPrompt, { color: palette.accent }]}>Resmî kaynağa git</Text>
      ) : (
        <Text style={[theme.typography.meta, styles.feedLinkPrompt, { color: REFERENCE_COLORS.secondary }]}>Resmî bağlantı kullanılamıyor</Text>
      )}
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

function contentKeyDateIcon(
  kind: NonNullable<ReturnType<typeof primaryContentKeyDate>>["kind"],
): keyof typeof Ionicons.glyphMap {
  if (kind === "deadline") return "hourglass-outline";
  if (kind === "range") return "calendar-number-outline";
  if (kind === "start") return "play-circle-outline";
  return "calendar-outline";
}

function scopeAndSourceLabel(item: ContentFeedItem): string {
  const familyLabels = [
    item.sourceFamilies.includes("yok") ? "YÖK" : null,
    item.sourceFamilies.includes("summer-school") ? "Yaz Okulu" : null,
  ].filter((value): value is string => Boolean(value));
  const scopeLabel = SCOPE_LABELS[item.record.scopeType];
  return [...familyLabels, scopeLabel].join(" · ");
}

function AnnouncementReminderBanner({
  preferenceEnabled,
  onPress,
}: {
  preferenceEnabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const accessibilityLabel = preferenceEnabled
    ? "Bildirim tercihin açık ancak bu cihazda etkin değil. Bildirim ayarlarını aç."
    : "Hiçbir duyuruyu kaçırma. Bildirimleri aç.";
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
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
          maxFontSizeMultiplier={1.3}
          style={[theme.typography.bodyStrong, styles.reminderTitle, { color: REFERENCE_COLORS.navy }]}
        >
          {preferenceEnabled ? "Bildirim ayarını tamamla" : "Duyurular için bildirim al"}
        </Text>
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={2}
          style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}
        >
          {preferenceEnabled
            ? "Bildirim tercihin açık; bu cihazda etkinleştirmek için ayarlarını gözden geçir."
            : "Önemli duyurular için bildirimlerini açmayı unutma."}
        </Text>
        <View style={styles.reminderAction}>
          <Text maxFontSizeMultiplier={1.25} numberOfLines={1} style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.blue }]}>
            {preferenceEnabled ? "Ayarları Aç" : "Bildirimleri Aç"}
          </Text>
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
  accountAvatar: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.blueSoft,
    borderColor: referencePalette.academicBlueBorderStrong,
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  activeFilterDot: {
    borderRadius: 3,
    height: 6,
    position: "absolute",
    right: 7,
    top: 7,
    width: 6,
  },
  announcementArtwork: {
    height: 88,
    position: "relative",
    width: 108,
  },
  artworkDot: {
    backgroundColor: REFERENCE_COLORS.blue,
    borderRadius: 4,
    height: 8,
    left: 1,
    opacity: 0.48,
    position: "absolute",
    top: 20,
    width: 8,
  },
  artworkHalo: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.blueSoft,
    borderRadius: 38,
    bottom: 3,
    height: 76,
    justifyContent: "center",
    left: 13,
    position: "absolute",
    transform: [{ rotate: "-9deg" }],
    width: 76,
  },
  artworkRay: {
    backgroundColor: REFERENCE_COLORS.blue,
    borderRadius: 3,
    height: 4,
    position: "absolute",
    right: 1,
    width: 18,
  },
  artworkRayBottom: {
    bottom: 15,
    transform: [{ rotate: "20deg" }],
  },
  artworkRayMiddle: {
    top: 40,
  },
  artworkRayTop: {
    top: 21,
    transform: [{ rotate: "-24deg" }],
  },
  artworkRing: {
    borderColor: REFERENCE_COLORS.orange,
    borderRadius: 12,
    borderWidth: 3,
    bottom: 5,
    height: 23,
    left: 0,
    opacity: 0.35,
    position: "absolute",
    width: 23,
  },
  brandBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 50,
  },
  brandCopy: {
    flexShrink: 1,
    minWidth: 0,
  },
  brandIdentity: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
  },
  brandLogo: {
    height: 46,
    width: 46,
  },
  brandName: {
    color: REFERENCE_COLORS.navy,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 20,
  },
  brandNameAccent: {
    color: REFERENCE_COLORS.blue,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 20,
  },
  clearSearch: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  feedAccent: {
    borderBottomLeftRadius: 20,
    borderTopLeftRadius: 20,
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
    width: 5,
  },
  feedCopy: {
    gap: 5,
    minWidth: 0,
  },
  feedFooter: {
    gap: 14,
    paddingTop: 14,
  },
  feedFooterRow: {
    alignItems: "center",
    borderTopColor: REFERENCE_COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    minWidth: 0,
    paddingTop: 9,
  },
  feedFooterRowStacked: {
    alignItems: "flex-start",
    flexDirection: "column",
  },
  feedIconTile: {
    alignItems: "center",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  feedLinkAction: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 5,
    justifyContent: "flex-end",
    minWidth: 0,
  },
  feedLinkLabel: {
    flexShrink: 1,
  },
  feedLinkPrompt: {
    alignSelf: "flex-end",
  },
  feedMetaColumn: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  feedMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minWidth: 0,
  },
  feedRow: {
    backgroundColor: REFERENCE_COLORS.background,
    borderColor: REFERENCE_COLORS.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 3,
    gap: 9,
    marginBottom: 10,
    minHeight: 148,
    paddingBottom: 13,
    paddingLeft: 16,
    paddingRight: 14,
    paddingTop: 13,
    position: "relative",
    shadowColor: REFERENCE_COLORS.navy,
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 13,
  },
  feedRowPressed: {
    backgroundColor: REFERENCE_COLORS.blueSoft,
  },
  feedSummary: {
    lineHeight: 18,
  },
  feedSourceCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  feedSourceName: {
    lineHeight: 18,
  },
  feedSourceRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
  },
  feedTitle: {
    fontSize: 16,
    lineHeight: 20,
  },
  filterGroup: {
    minWidth: 0,
  },
  filterMenuButton: {
    alignItems: "center",
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    position: "relative",
    width: 48,
  },
  filterMenuContent: {
    gap: 4,
    minHeight: 0,
  },
  filterMenuOption: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    minHeight: 52,
    minWidth: 0,
    paddingHorizontal: 8,
  },
  filterMenuSectionTitle: {
    marginTop: 12,
  },
  filterPill: {
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  flexibleText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  header: {
    minWidth: 0,
    paddingBottom: 10,
  },
  headerLargeText: {
    gap: 12,
  },
  headerStandardText: {
    gap: 9,
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },
  heroCopy: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  heroHeader: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 88,
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
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 40,
    textAlign: "left",
  },
  pageSubtitle: {
    fontSize: 16,
    lineHeight: 23,
    maxWidth: 410,
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
    backgroundColor: REFERENCE_COLORS.background,
    borderColor: referencePalette.academicBorderBlueMuted,
    borderRadius: 18,
    borderWidth: 1,
    elevation: 2,
    flexDirection: "row",
    gap: 12,
    minHeight: 96,
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingVertical: 13,
    shadowColor: REFERENCE_COLORS.navy,
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
  },
  reminderIcon: {
    alignItems: "center",
    borderRadius: 24,
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
  notificationGlyph: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  scopeRail: {
    alignItems: "center",
    gap: 8,
    paddingRight: 12,
  },
  searchFrame: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.background,
    borderColor: REFERENCE_COLORS.border,
    borderRadius: 17,
    borderWidth: 1,
    elevation: 2,
    flexDirection: "row",
    minHeight: 52,
    paddingLeft: 16,
    paddingRight: 7,
    shadowColor: REFERENCE_COLORS.navy,
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
  },
  searchInput: {
    color: REFERENCE_COLORS.navy,
    flex: 1,
    minHeight: 48,
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
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    width: 48,
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
  timestamp: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
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
