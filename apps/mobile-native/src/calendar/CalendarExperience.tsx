import { Ionicons } from "@expo/vector-icons";
import { useScrollToTop } from "@react-navigation/native";
import { useNetworkState } from "expo-network";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ListRenderItem,
  type View as NativeView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Banner,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  referencePalette,
  usePlatformAdaptation,
  useTheme,
} from "../design-system";
import { runtimeDiagnostic } from "../performance/runtime-diagnostics";
import { isDateOnlyValue } from "../temporal/academic-temporal";
import {
  formatCalendarClock,
  formatCalendarTemporal,
} from "./calendar-time";
import {
  buildCalendarItems,
  buildMonthSummary,
  buildWeekSummary,
  calendarItemStartDateOnly,
  calendarPeriod,
  classificationLabel,
  formatCalendarCompactDay,
  formatCalendarDayHeading,
  moveCalendarAnchor,
  resolveCalendarPresentationState,
  selectCalendarItemsForView,
  todayDateOnly,
  type CalendarAcademicEvent,
  type CalendarClassification,
  type CalendarItem,
  type CalendarPersonalExam,
  type CalendarViewMode,
} from "./calendar-model";
import {
  PersonalExamEditor,
  type PersonalExamMutationInput,
  type PersonalExamMutationResult,
} from "./PersonalExamEditor";

export interface CalendarGoogleStatus {
  state: string;
  stateLabel: string;
  accountEmail?: string;
  verifiedCount?: number;
  lastSyncedLabel?: string;
  error?: string;
  warnings?: readonly string[];
  busy?: boolean;
  connected?: boolean;
}

export interface CalendarExperienceProps {
  academicEvents: readonly CalendarAcademicEvent[];
  personalExams: readonly CalendarPersonalExam[];
  personalExamsReady: boolean;
  calendarTitle?: string;
  academicYear?: string;
  universityName?: string;
  loading?: boolean;
  attempted?: boolean;
  error?: string;
  stale?: boolean;
  partial?: boolean;
  offline?: boolean;
  google: CalendarGoogleStatus;
  feedback?: ReactNode;
  initialView?: CalendarViewMode;
  initialAnchorDate?: string;
  now?: Date;
  /** Monotonic one-shot intent supplied by a host CTA that wants the create editor. */
  createPersonalExamRequestKey?: number;
  onConsumeCreatePersonalExamRequest?: (requestKey: number) => void;
  onOpenAccountMenu?: () => void;
  onRefresh: () => void;
  onOpenItem: (item: CalendarItem) => void;
  onCreatePersonalExam: (input: PersonalExamMutationInput) => PersonalExamMutationResult;
  onUpdatePersonalExam: (
    id: string,
    input: PersonalExamMutationInput,
  ) => PersonalExamMutationResult;
  onSyncGoogle: () => void;
  onManageGoogle: () => void;
}

type CalendarListEntry = {
  item: CalendarItem;
  headingDate?: string;
  headingLabel?: string;
  today?: boolean;
};

type CalendarListHeadingRange = {
  start: string;
  end?: string;
};

const compactWeekdayFormatter = new Intl.DateTimeFormat("tr-TR", {
  weekday: "short",
  timeZone: "UTC",
});
const agendaDayHeadingFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  weekday: "long",
  timeZone: "UTC",
});
const selectedDayHeadingFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  weekday: "long",
  timeZone: "UTC",
});
const agendaDayHeadingCache = new Map<string, string>();
const AGENDA_PAGE_SIZE = 12;
const IOS_MONTH_MIN_WIDTH = 7 * 44;
const IOS_WEEK_MIN_WIDTH = IOS_MONTH_MIN_WIDTH + (2 * 5) + (6 * 4);
const academicCalendarLogo = require("../../assets/design-package/academic-calendar-logo.png");
const PRIMARY_CALENDAR_VIEWS = [
  { value: "agenda", label: "Ajanda" },
  { value: "week", label: "Hafta" },
] as const;
const SECONDARY_CALENDAR_VIEWS = [
  { value: "day", label: "Gün" },
  { value: "month", label: "Ay" },
] as const;

export function CalendarExperience({
  academicEvents,
  personalExams,
  personalExamsReady,
  calendarTitle,
  academicYear,
  universityName,
  loading = false,
  attempted = false,
  error,
  stale = false,
  partial = false,
  offline,
  google,
  feedback,
  initialView = "agenda",
  initialAnchorDate,
  now,
  createPersonalExamRequestKey,
  onConsumeCreatePersonalExamRequest,
  onOpenAccountMenu,
  onRefresh,
  onOpenItem,
  onCreatePersonalExam,
  onUpdatePersonalExam,
  onSyncGoogle,
  onManageGoogle,
}: CalendarExperienceProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const safeAreaInsets = useSafeAreaInsets();
  const networkState = useNetworkState();
  const { fontScale, width } = useWindowDimensions();
  const listRef = useRef<FlatList<CalendarListEntry> | null>(null);
  const createExamRef = useRef<NativeView | null>(null);
  const optionsButtonRef = useRef<NativeView | null>(null);
  const calendarAnnouncementRequestedRef = useRef(false);
  const handledCreateRequestKeyRef = useRef<number | null>(null);
  useScrollToTop(listRef);
  const [view, setView] = useState<CalendarViewMode>(initialView);
  const [anchorDate, setAnchorDate] = useState(initialAnchorDate ?? todayDateOnly(now));
  const [editorExam, setEditorExam] = useState<CalendarPersonalExam | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [agendaLimit, setAgendaLimit] = useState(AGENDA_PAGE_SIZE);
  const isOffline = offline ?? (
    networkState.isConnected === false || networkState.isInternetReachable === false
  );
  const gutter = width < 375 ? 16 : 20;
  const today = todayDateOnly(now);
  const listBottomPadding = adaptation.navigationLayout === "navigation-rail"
    ? Math.max(48, safeAreaInsets.bottom + 32)
    : Math.max(132, safeAreaInsets.bottom + 112);

  useEffect(() => {
    if (
      !personalExamsReady
      || editorVisible
      || typeof createPersonalExamRequestKey !== "number"
      || !Number.isInteger(createPersonalExamRequestKey)
      || createPersonalExamRequestKey <= 0
      || handledCreateRequestKeyRef.current === createPersonalExamRequestKey
    ) return;
    handledCreateRequestKeyRef.current = createPersonalExamRequestKey;
    setEditorExam(null);
    setEditorVisible(true);
    onConsumeCreatePersonalExamRequest?.(createPersonalExamRequestKey);
  }, [
    createPersonalExamRequestKey,
    editorVisible,
    onConsumeCreatePersonalExamRequest,
    personalExamsReady,
  ]);

  const allItems = useMemo(() => {
    const startedAt = Date.now();
    const result = buildCalendarItems({
      academicEvents,
      personalExams: personalExamsReady ? personalExams : [],
      academicSourceLabel: calendarTitle ?? universityName ?? "Resmî akademik takvim",
    });
    runtimeDiagnostic("calendar.model", {
      phase: "build_items",
      inputCount: academicEvents.length + (personalExamsReady ? personalExams.length : 0),
      outputCount: result.length,
      elapsedMs: Date.now() - startedAt,
    });
    return result;
  }, [academicEvents, calendarTitle, personalExams, personalExamsReady, universityName]);
  const filteredItems = useMemo(
    () => filterCalendarItems(allItems, searchQuery),
    [allItems, searchQuery],
  );
  const periodItems = useMemo(() => selectCalendarItemsForView({
    items: filteredItems,
    view,
    anchorDate,
    now,
  }), [anchorDate, filteredItems, now, view]);
  const visibleItems = useMemo(
    () => view === "month"
      ? selectCalendarItemsForView({ items: filteredItems, view: "day", anchorDate, now })
      : periodItems,
    [anchorDate, filteredItems, now, periodItems, view],
  );
  const visibleHeadingRange = useMemo<CalendarListHeadingRange | undefined>(() => {
    if (view === "agenda") return { start: today };
    if (view === "week") {
      const weekPeriod = calendarPeriod("week", anchorDate);
      return { start: weekPeriod.start, end: weekPeriod.end };
    }
    return undefined;
  }, [anchorDate, today, view]);
  const entries = useMemo(() => {
    const startedAt = Date.now();
    const result = listEntries(
      visibleItems,
      view === "agenda" || view === "week",
      today,
      visibleHeadingRange,
    );
    runtimeDiagnostic("calendar.model", {
      phase: "build_entries",
      inputCount: visibleItems.length,
      outputCount: result.length,
      elapsedMs: Date.now() - startedAt,
    });
    return result;
  }, [today, view, visibleHeadingRange, visibleItems]);
  const displayedEntries = useMemo(
    () => view === "agenda" ? entries.slice(0, agendaLimit) : entries,
    [agendaLimit, entries, view],
  );
  const hasMoreAgendaItems = view === "agenda" && displayedEntries.length < entries.length;
  const state = resolveCalendarPresentationState({
    loading,
    attempted,
    hasItems: allItems.length > 0,
    error,
    stale,
    partial,
    offline: isOffline,
  });
  const period = view === "agenda" ? null : calendarPeriod(view, anchorDate);
  const week = useMemo(
    () => buildWeekSummary(filteredItems, anchorDate),
    [anchorDate, filteredItems],
  );
  const month = useMemo(
    () => view === "month" ? buildMonthSummary(filteredItems, anchorDate) : [],
    [anchorDate, filteredItems, view],
  );
  const calendarAnnouncement = view === "agenda"
    ? `Ajanda görünümü. ${displayedEntries.length} kayıt gösteriliyor${hasMoreAgendaItems ? ", daha fazla kayıt var" : ""}.`
    : `${view === "day" ? "Gün" : view === "week" ? "Hafta" : "Ay"} görünümü. ${period?.label ?? ""}. ${entries.length} kayıt.`;

  useEffect(() => {
    if (!calendarAnnouncementRequestedRef.current) return;
    calendarAnnouncementRequestedRef.current = false;
    if (adaptation.platform === "ios") {
      AccessibilityInfo.announceForAccessibility(calendarAnnouncement);
    }
  }, [adaptation.platform, anchorDate, calendarAnnouncement, view]);

  useEffect(() => {
    setAgendaLimit(AGENDA_PAGE_SIZE);
  }, [searchQuery, view]);

  const changeView = (nextView: CalendarViewMode) => {
    if (nextView === view) return;
    calendarAnnouncementRequestedRef.current = true;
    setView(nextView);
  };

  const changeAnchorDate = (nextDate: string) => {
    if (nextDate === anchorDate) return;
    calendarAnnouncementRequestedRef.current = true;
    setAnchorDate(nextDate);
  };

  const toggleSearch = () => {
    if (searchVisible) {
      Keyboard.dismiss();
      setSearchQuery("");
      setSearchVisible(false);
      return;
    }
    setSearchVisible(true);
  };

  const renderItem: ListRenderItem<CalendarListEntry> = ({ item: entry }) => (
    <View style={[styles.entry, { gap: theme.spacing.xs }]}>
      {entry.headingDate || entry.headingLabel ? (
        <View style={[styles.dayHeading, { gap: theme.spacing.xs }]}>
          <Ionicons
            accessibilityElementsHidden
            color={referencePalette.academicTealTitle}
            importantForAccessibility="no-hide-descendants"
            name="calendar-outline"
            size={21}
          />
          <Text
            accessibilityRole="header"
            style={[theme.typography.bodyStrong, styles.flexOne, { color: referencePalette.academicTealTitle }]}
          >
            {entry.headingLabel ?? formatAgendaDayHeading(entry.headingDate!)}
          </Text>
          {entry.today ? (
            <View style={[styles.todayPill, { backgroundColor: theme.colors.action.secondary, borderRadius: theme.radii.pill }]}>
              <Text style={[theme.typography.label, { color: theme.colors.text.link }]}>Bugün</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <CalendarItemCard item={entry.item} onPress={() => onOpenItem(entry.item)} />
    </View>
  );

  const listHeader = (
    <View style={[styles.header, { gap: theme.spacing.md, paddingTop: theme.spacing.sm }]}>
      {feedback}

      <CalendarScreenHeader
        compact={width < 375 || fontScale >= 1.6}
        onAccountMenuPress={onOpenAccountMenu}
        onOptionsPress={() => {
          Keyboard.dismiss();
          setOptionsVisible(true);
        }}
        optionsButtonRef={optionsButtonRef}
      />

      {searchVisible ? (
        <View style={[
          styles.searchFrame,
          {
            backgroundColor: theme.colors.background.surface,
            borderColor: theme.colors.border.subtle,
            borderRadius: theme.radii.prominent,
          },
        ]}>
          <Ionicons color={theme.colors.text.secondary} name="search-outline" size={22} />
          <TextInput
            accessibilityLabel="Takvimde ara"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => Keyboard.dismiss()}
            placeholder="Etkinlik, ders veya konum ara"
            placeholderTextColor={theme.colors.text.disabled}
            returnKeyType="search"
            selectionColor={theme.colors.action.focus}
            style={[theme.typography.body, styles.searchInput, { color: theme.colors.text.primary }]}
            value={searchQuery}
          />
          {searchQuery ? (
            <Pressable
              accessibilityLabel="Takvim aramasını temizle"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setSearchQuery("")}
              style={styles.searchClearButton}
            >
              <Ionicons color={theme.colors.text.secondary} name="close-circle" size={22} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <CalendarViewTabs
        compact={width <= 360 && fontScale >= 1.6}
        onValueChange={changeView}
        value={view}
      />

      {view === "week" || view === "day" ? (
        <PeriodNavigator
          label={period?.label ?? ""}
          onNext={() => changeAnchorDate(moveCalendarAnchor(view, anchorDate, 1))}
          onPrevious={() => changeAnchorDate(moveCalendarAnchor(view, anchorDate, -1))}
          onToday={() => changeAnchorDate(today)}
          view={view}
        />
      ) : null}

      {view === "agenda" || view === "week" ? (
        <WeekSummary
          compact={width <= 375 || fontScale >= 1.6}
          days={week}
          onSelectDate={(date) => {
            changeAnchorDate(date);
          }}
          selectedDate={anchorDate}
        />
      ) : null}

      {view === "month" ? (
        <>
          <MonthNavigator
            label={calendarPeriod("month", anchorDate).label}
            onNext={() => changeAnchorDate(moveCalendarAnchor("month", anchorDate, 1))}
            onPrevious={() => changeAnchorDate(moveCalendarAnchor("month", anchorDate, -1))}
          />
          <MonthSummary
            days={month}
            fontScale={fontScale}
            onSelectDate={changeAnchorDate}
            selectedDate={anchorDate}
          />
          <View style={[styles.selectedDayHeading, { gap: theme.spacing.xs }]}>
            <Text accessibilityRole="header" style={[theme.typography.bodyStrong, styles.flexOne, { color: theme.colors.text.primary }]}>
              {formatSelectedDayHeading(anchorDate)}
            </Text>
            <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>
              {visibleItems.length} etkinlik
            </Text>
          </View>
        </>
      ) : null}

      <CalendarAvailability error={error} onRefresh={onRefresh} state={state} />

      {displayedEntries.length > 0 ? (
        <View style={styles.eventsSectionHeading}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.4}
            style={[theme.typography.sectionTitle, { color: referencePalette.navy }]}
          >
            {view === "agenda" ? "Yaklaşan etkinlikler" : view === "week" ? "Haftanın etkinlikleri" : "Seçili günün etkinlikleri"}
          </Text>
          <View
            accessibilityLabel={`${view === "agenda" ? displayedEntries.length : entries.length} etkinlik gösteriliyor`}
            style={[styles.eventCountPill, { backgroundColor: referencePalette.academicBlueTint }]}
            testID="calendar-event-count"
          >
            <Text maxFontSizeMultiplier={1.3} style={[theme.typography.metaStrong, { color: referencePalette.academicBlueDeep }]}>
              {view === "agenda" ? displayedEntries.length : entries.length}
            </Text>
          </View>
        </View>
      ) : null}

      <Text
        accessibilityLabel={calendarAnnouncement}
        accessibilityLiveRegion={adaptation.platform === "android" ? "polite" : undefined}
        style={styles.liveAnnouncement}
        testID="calendar-view-announcement"
      >
        {calendarAnnouncement}
      </Text>
    </View>
  );

  return (
    <>
      <FlatList
        ref={listRef}
        accessibilityLabel="Takvim etkinlikleri"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.listContent,
          {
            gap: theme.spacing.md,
            paddingBottom: listBottomPadding,
            paddingHorizontal: gutter,
          },
        ]}
        data={displayedEntries}
        initialNumToRender={5}
        keyExtractor={(entry) => entry.item.key}
        ListEmptyComponent={(
          <View>
            {state !== "loading" && state !== "error" && state !== "offline" && state !== "partial" ? (
              <EmptyState
                actionLabel="Takvimi yenile"
                description={searchQuery
                  ? "Aramanla eşleşen bir takvim kaydı bulunmuyor."
                  : view === "agenda"
                    ? "Yaklaşan akademik tarih veya kişisel sınav bulunmuyor."
                    : view === "month" || view === "day"
                      ? "Seçili günde gösterilecek kayıt bulunmuyor."
                      : "Seçili haftada gösterilecek kayıt bulunmuyor."}
                illustration={<Ionicons color={theme.colors.status.info} name="calendar-clear-outline" size={28} />}
                onAction={onRefresh}
                title={searchQuery
                  ? "Sonuç bulunamadı"
                  : view === "agenda"
                    ? "Ajandan boş"
                    : "Bu dönem boş"}
              />
            ) : null}
          </View>
        )}
        ListFooterComponent={(
          <View style={[styles.listFooter, { gap: theme.spacing.md, marginTop: theme.spacing.sm }]}>
            {hasMoreAgendaItems ? (
              <View style={[styles.loadMorePanel, { borderColor: theme.colors.border.subtle }]}>
                <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>
                  {displayedEntries.length} / {entries.length} etkinlik gösteriliyor
                </Text>
                <Button
                  label="Daha fazla etkinlik göster"
                  onPress={() => setAgendaLimit((current) => current + AGENDA_PAGE_SIZE)}
                  variant="secondary"
                />
              </View>
            ) : null}
            <GoogleSyncBanner
              compact={width < 430 || fontScale >= 1.45}
              google={google}
              onManage={onManageGoogle}
              onSync={onSyncGoogle}
            />
            {view === "agenda" || view === "week" ? (
              <PersonalEventCta
                buttonRef={createExamRef}
                disabled={!personalExamsReady}
                onPress={() => {
                  setEditorExam(null);
                  setEditorVisible(true);
                }}
              />
            ) : null}
          </View>
        )}
        ListHeaderComponent={listHeader}
        keyboardDismissMode={adaptation.platform === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        maxToRenderPerBatch={4}
        onRefresh={onRefresh}
        removeClippedSubviews={Platform.OS === "android"}
        refreshing={loading && allItems.length > 0}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        style={{ backgroundColor: theme.colors.background.canvas }}
        updateCellsBatchingPeriod={50}
        windowSize={5}
      />

      <PersonalExamEditor
        exam={editorExam}
        onDismiss={() => setEditorVisible(false)}
        onSubmit={(input) => editorExam
          ? onUpdatePersonalExam(editorExam.id, input)
          : onCreatePersonalExam(input)}
        returnFocusRef={createExamRef}
        visible={editorVisible}
      />

      <CalendarOptionsSheet
        createDisabled={!personalExamsReady}
        onCreate={() => {
          setOptionsVisible(false);
          setEditorExam(null);
          setEditorVisible(true);
        }}
        onDismiss={() => setOptionsVisible(false)}
        onSearch={() => {
          setOptionsVisible(false);
          toggleSearch();
        }}
        onSelectView={(nextView) => {
          setOptionsVisible(false);
          changeView(nextView);
        }}
        onToday={() => {
          setOptionsVisible(false);
          changeAnchorDate(today);
        }}
        returnFocusRef={optionsButtonRef}
        searchVisible={searchVisible}
        value={view}
        visible={optionsVisible}
      />
    </>
  );
}

function CalendarScreenHeader({
  compact,
  onAccountMenuPress,
  onOptionsPress,
  optionsButtonRef,
}: {
  compact: boolean;
  onAccountMenuPress?: () => void;
  onOptionsPress: () => void;
  optionsButtonRef: RefObject<NativeView | null>;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.calendarHero, { gap: theme.spacing.md }]}>
      <View style={styles.brandBar}>
        <View accessibilityLabel="Akademik Takvim" style={styles.brandIdentity}>
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            source={academicCalendarLogo}
            style={styles.brandLogo}
          />
          <View style={styles.brandCopy}>
            <Text maxFontSizeMultiplier={1.25} numberOfLines={1} style={styles.brandName}>Akademik</Text>
            <Text maxFontSizeMultiplier={1.25} numberOfLines={1} style={styles.brandNameAccent}>Takvim</Text>
          </View>
        </View>
        <View style={styles.brandActions}>
          <CalendarIconButton
            buttonRef={optionsButtonRef}
            label="Takvim seçeneklerini aç"
            name="ellipsis-horizontal"
            onPress={onOptionsPress}
          />
          {onAccountMenuPress ? (
            <Pressable
              accessibilityLabel="Hesap menüsünü aç"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onAccountMenuPress}
              style={({ pressed }) => [
                styles.accountAvatar,
                { borderColor: referencePalette.academicBlue },
                pressed ? { backgroundColor: referencePalette.academicBlueTint } : null,
              ]}
            >
              <Ionicons color={referencePalette.academicBlue} name="person-outline" size={23} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.heroHeadingRow}>
        <View style={[styles.heroCopy, { gap: theme.spacing.xs }]}>
          <Text
            accessibilityRole="header"
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.3}
            minimumFontScale={0.75}
            numberOfLines={1}
            style={[theme.typography.display, styles.calendarTitle, { color: referencePalette.navy }]}
          >
            Takvim
          </Text>
          <Text
            maxFontSizeMultiplier={1.35}
            style={[theme.typography.body, { color: referencePalette.academicTextSecondary }]}
          >
            Zamanını planla, hedeflerine odaklan.
          </Text>
        </View>
        {!compact ? <CalendarHeroArtwork /> : null}
      </View>
    </View>
  );
}

function CalendarHeroArtwork() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.calendarArtwork}
      testID="calendar-hero-artwork"
    >
      <View style={styles.artPlant}>
        <View style={styles.artPlantStem} />
        <View style={[styles.artLeaf, styles.artLeafLeft]} />
        <View style={[styles.artLeaf, styles.artLeafRight]} />
        <View style={styles.artPot} />
      </View>
      <View style={styles.artCalendar}>
        <View style={styles.artCalendarBindingRow}>
          <View style={styles.artCalendarBinding} />
          <View style={styles.artCalendarBinding} />
          <View style={styles.artCalendarBinding} />
        </View>
        <Ionicons color={referencePalette.academicBlue} name="calendar-clear-outline" size={46} />
      </View>
      <View style={styles.artPen} />
    </View>
  );
}

function CalendarIconButton({
  buttonRef,
  disabled = false,
  label,
  name,
  onPress,
}: {
  buttonRef?: RefObject<NativeView | null>;
  disabled?: boolean;
  label: string;
  name: "add" | "calendar-outline" | "close-outline" | "ellipsis-horizontal" | "list-outline" | "search-outline";
  onPress: () => void;
}) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  return (
    <Pressable
      ref={buttonRef}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      android_ripple={adaptation.pressFeedback === "ripple"
        ? { color: theme.colors.state.pressed, borderless: true }
        : undefined}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.headerIconButton,
        {
          backgroundColor: theme.colors.background.surface,
          borderColor: theme.colors.border.subtle,
          borderRadius: theme.radii.pill,
        },
        pressed && adaptation.pressFeedback !== "ripple" ? { backgroundColor: theme.colors.action.ghostPressed } : null,
      ]}
    >
      <Ionicons color={disabled ? theme.colors.text.disabled : theme.colors.action.primary} name={name} size={25} />
    </Pressable>
  );
}

function CalendarViewTabs({
  compact,
  onValueChange,
  value,
}: {
  compact: boolean;
  onValueChange: (view: CalendarViewMode) => void;
  value: CalendarViewMode;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel="Takvim görünümü"
      accessibilityRole="radiogroup"
      style={[
        styles.viewTabs,
        compact && styles.viewTabsCompact,
      ]}
    >
      <View style={[
        styles.primaryViewTabs,
        compact && styles.primaryViewTabsCompact,
        {
          backgroundColor: theme.colors.background.surface,
          borderColor: referencePalette.academicBlueBorderMuted,
          borderRadius: 24,
        },
      ]}>
        {PRIMARY_CALENDAR_VIEWS.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityLabel={option.label}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onValueChange(option.value)}
              style={({ pressed }) => [
                styles.primaryViewTab,
                compact && styles.viewTabCompact,
                {
                  backgroundColor: selected
                    ? referencePalette.academicBlue
                    : pressed
                      ? theme.colors.action.ghostPressed
                      : "transparent",
                  borderRadius: 21,
                },
              ]}
            >
              <Text maxFontSizeMultiplier={1.35} style={[
                theme.typography.label,
                { color: selected ? referencePalette.white : referencePalette.academicTextSecondary },
              ]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function CalendarOptionsSheet({
  createDisabled,
  onCreate,
  onDismiss,
  onSearch,
  onSelectView,
  onToday,
  returnFocusRef,
  searchVisible,
  value,
  visible,
}: {
  createDisabled: boolean;
  onCreate: () => void;
  onDismiss: () => void;
  onSearch: () => void;
  onSelectView: (view: CalendarViewMode) => void;
  onToday: () => void;
  returnFocusRef: RefObject<NativeView | null>;
  searchVisible: boolean;
  value: CalendarViewMode;
  visible: boolean;
}) {
  const theme = useTheme();
  const viewOptions = [...PRIMARY_CALENDAR_VIEWS, ...SECONDARY_CALENDAR_VIEWS];
  return (
    <BottomSheet
      accessibilityLabel="Takvim seçenekleri"
      onDismiss={onDismiss}
      returnFocusRef={returnFocusRef}
      scrollable
      title="Takvim seçenekleri"
      visible={visible}
    >
      <View style={styles.optionsSheetContent}>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.4}
          style={[theme.typography.bodyStrong, { color: referencePalette.navy }]}
        >
          Görünüm
        </Text>
        <View accessibilityLabel="Tüm takvim görünümleri" accessibilityRole="radiogroup" style={styles.optionGroup}>
          {viewOptions.map((option) => {
            const selected = option.value === value;
            return (
              <CalendarOptionRow
                icon={selected ? "radio-button-on" : "radio-button-off"}
                key={option.value}
                label={option.label}
                onPress={() => onSelectView(option.value)}
                selected={selected}
              />
            );
          })}
        </View>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.4}
          style={[theme.typography.bodyStrong, styles.optionSectionHeading, { color: referencePalette.navy }]}
        >
          İşlemler
        </Text>
        <View style={styles.optionGroup}>
          <CalendarOptionRow
            icon={searchVisible ? "close-outline" : "search-outline"}
            label={searchVisible ? "Takvim aramasını kapat" : "Takvimde ara"}
            onPress={onSearch}
          />
          <CalendarOptionRow icon="calendar-outline" label="Bugüne git" onPress={onToday} />
          <CalendarOptionRow
            disabled={createDisabled}
            icon="add-circle-outline"
            label={createDisabled ? "Kişisel takvim hazırlanıyor" : "Kişisel etkinlik ekle"}
            onPress={onCreate}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

function CalendarOptionRow({
  disabled = false,
  icon,
  label,
  onPress,
  selected,
}: {
  disabled?: boolean;
  icon: "add-circle-outline" | "calendar-outline" | "close-outline" | "radio-button-off" | "radio-button-on" | "search-outline";
  label: string;
  onPress: () => void;
  selected?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole={selected === undefined ? "button" : "radio"}
      accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        { borderBottomColor: theme.colors.border.subtle },
        pressed ? { backgroundColor: theme.colors.action.ghostPressed } : null,
      ]}
    >
      <Ionicons
        color={disabled
          ? theme.colors.text.disabled
          : selected
            ? referencePalette.academicBlue
            : theme.colors.text.secondary}
        name={icon}
        size={23}
      />
      <Text
        maxFontSizeMultiplier={2}
        style={[
          theme.typography.body,
          styles.optionRowLabel,
          { color: disabled ? theme.colors.text.disabled : theme.colors.text.primary },
        ]}
      >
        {label}
      </Text>
      {selected ? <Ionicons color={referencePalette.academicBlue} name="checkmark" size={21} /> : null}
    </Pressable>
  );
}

function PeriodNavigator({
  label,
  onNext,
  onPrevious,
  onToday,
  view,
}: {
  label: string;
  onNext: () => void;
  onPrevious: () => void;
  onToday: () => void;
  view: "day" | "week";
}) {
  const theme = useTheme();
  return (
    <View accessibilityLabel={`${view === "day" ? "Gün" : "Hafta"} dönemi. ${label}`} style={styles.periodNavigator}>
      <Pressable
        accessibilityLabel={view === "day" ? "Önceki gün" : "Önceki hafta"}
        accessibilityRole="button"
        onPress={onPrevious}
        style={styles.arrowButton}
      >
        <Ionicons color={theme.colors.text.primary} name="chevron-back" size={25} />
      </Pressable>
      <Pressable accessibilityLabel="Bugüne git" accessibilityRole="button" onPress={onToday} style={styles.periodLabel}>
        <Text numberOfLines={2} style={[theme.typography.bodyStrong, { color: theme.colors.text.primary, textAlign: "center" }]}>{label}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel={view === "day" ? "Sonraki gün" : "Sonraki hafta"}
        accessibilityRole="button"
        onPress={onNext}
        style={styles.arrowButton}
      >
        <Ionicons color={theme.colors.text.primary} name="chevron-forward" size={25} />
      </Pressable>
    </View>
  );
}

function MonthNavigator({
  label,
  onNext,
  onPrevious,
}: {
  label: string;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const theme = useTheme();
  return (
    <View accessibilityLabel={`Ay dönemi. ${label}`} style={styles.monthNavigator}>
      <Pressable accessibilityLabel="Önceki ay" accessibilityRole="button" hitSlop={10} onPress={onPrevious} style={styles.arrowButton}>
        <Ionicons color={theme.colors.text.primary} name="chevron-back" size={27} />
      </Pressable>
      <View style={styles.monthTitle}>
        <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>{label}</Text>
      </View>
      <Pressable accessibilityLabel="Sonraki ay" accessibilityRole="button" hitSlop={10} onPress={onNext} style={styles.arrowButton}>
        <Ionicons color={theme.colors.text.primary} name="chevron-forward" size={27} />
      </Pressable>
    </View>
  );
}

function CalendarAvailability({
  state,
  error,
  onRefresh,
}: {
  state: ReturnType<typeof resolveCalendarPresentationState>;
  error?: string;
  onRefresh: () => void;
}) {
  const theme = useTheme();
  if (state === "loading") {
    return (
      <View
        accessible
        accessibilityLabel="Takvim yükleniyor"
        accessibilityRole="progressbar"
        accessibilityState={{ busy: true }}
        style={{ gap: theme.spacing.sm }}
      >
        <ActivityIndicator accessibilityElementsHidden color={theme.colors.action.primary} />
        <Skeleton decorative height={72} />
      </View>
    );
  }
  if (state === "error") {
    return (
      <ErrorState
        actionLabel="Tekrar dene"
        description="Akademik takvim şu anda yüklenemedi."
        onAction={onRefresh}
        title="Takvim alınamadı"
      />
    );
  }
  if (state === "offline") {
    return (
      <Banner
        actionLabel="Yeniden dene"
        message="Cihaz çevrimdışı. Varsa doğrulanmış kayıtlar korunur."
        onAction={onRefresh}
        title="Çevrimdışı"
        tone="warning"
      />
    );
  }
  if (state === "partial") {
    return (
      <Banner
        actionLabel="Kaynağı yenile"
        message="Ulaşılabilen akademik tarihler gösteriliyor; eksik kaynaklar silme kanıtı sayılmaz."
        onAction={onRefresh}
        title="Takvim kısmen güncel"
        tone="warning"
      />
    );
  }
  if (state === "refreshing") {
    return <Banner message="Doğrulanmış kayıtlar görünür kalırken kaynaklar yenileniyor." title="Takvim yenileniyor" />;
  }
  if (state === "stale") {
    return (
      <Banner
        actionLabel="Tekrar dene"
        message={error ? "Son doğrulanmış kayıtlar gösteriliyor; yenileme tamamlanamadı." : "Son doğrulanmış kayıtlar gösteriliyor."}
        onAction={onRefresh}
        title="Takvim güncel olmayabilir"
        tone="warning"
      />
    );
  }
  return null;
}

function CalendarItemCard({ item, onPress }: { item: CalendarItem; onPress: () => void }) {
  const theme = useTheme();
  const palette = classificationPalette(item.classification, theme.colors);
  const dateOnly = item.temporalKind === "date" || isDateOnlyValue(item.startDate);
  const startTime = formatCalendarClock(item.startDate, item.temporalKind, item.timezone);
  const endTime = formatEndClock(item, dateOnly);
  const temporalLabel = formatCalendarTemporal(item);
  const location = item.location ?? item.sourceLabel;
  const useBell = item.source === "academic"
    && (item.classification === "exam" || item.classification === "academic")
    && !dateOnly;
  return (
    <Card
      accessibilityLabel={`${item.classificationLabel}. ${item.title}. ${temporalLabel}. ${location}. Ayrıntıyı aç.`}
      onPress={onPress}
      style={[
        styles.eventCard,
        {
          backgroundColor: theme.colors.background.surface,
          borderColor: theme.colors.border.subtle,
          borderRadius: 20,
          padding: 0,
        },
      ]}
      variant="elevated"
    >
      <View style={styles.eventCardLayout}>
        <View style={[styles.eventAccent, { backgroundColor: palette.accent }]} />
        <View style={[styles.timeColumn, { paddingVertical: theme.spacing.md }]}>
          <Text
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.25}
            minimumFontScale={0.82}
            numberOfLines={1}
            style={[theme.typography.metaStrong, styles.timeLabel, { color: theme.colors.text.primary }]}
          >
            {startTime}
          </Text>
          {endTime ? (
            <Text
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.25}
              minimumFontScale={0.82}
              numberOfLines={1}
              style={[theme.typography.meta, styles.timeLabel, { color: theme.colors.text.secondary }]}
            >
              {endTime}
            </Text>
          ) : null}
        </View>
        <View style={[styles.eventContent, { gap: 3, paddingVertical: theme.spacing.sm }]}>
          <View style={[
            styles.categoryPill,
            { backgroundColor: palette.container, borderRadius: theme.radii.small },
          ]}>
            <Text maxFontSizeMultiplier={1.25} style={[theme.typography.metaStrong, { color: palette.foreground }]}>{item.classificationLabel}</Text>
          </View>
          <Text maxFontSizeMultiplier={1.4} numberOfLines={3} style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>{item.title}</Text>
          <View style={styles.locationRow}>
            <Ionicons color={theme.colors.text.secondary} name="location-outline" size={14} />
            <Text maxFontSizeMultiplier={1.35} numberOfLines={1} style={[theme.typography.meta, styles.flexOne, { color: theme.colors.text.secondary }]}>{location}</Text>
          </View>
        </View>
        <View style={styles.eventTrailing}>
          <Ionicons
            color={theme.colors.text.secondary}
            name={useBell ? "notifications-outline" : "chevron-forward"}
            size={useBell ? 21 : 20}
          />
        </View>
      </View>
    </Card>
  );
}

function GoogleSyncBanner({
  compact,
  google,
  onSync,
  onManage,
}: {
  compact: boolean;
  google: CalendarGoogleStatus;
  onSync: () => void;
  onManage: () => void;
}) {
  const theme = useTheme();
  return (
    <Card
      accessible={false}
      busy={google.busy}
      style={[
        styles.googleBanner,
        {
          backgroundColor: theme.colors.background.surface,
          borderColor: referencePalette.academicBlueBorderMuted,
          borderRadius: 22,
          gap: theme.spacing.sm,
          padding: theme.spacing.md,
        },
      ]}
      testID="calendar-google-sync-card"
      variant="elevated"
    >
      <View style={[styles.googleRow, compact && styles.googleRowCompact, { gap: theme.spacing.sm }]}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.googleIcon, { backgroundColor: theme.colors.status.successContainer, borderRadius: theme.radii.control }]}
        >
          <Ionicons color={theme.colors.action.primary} name="logo-google" size={25} />
        </View>
        <View
          accessible
          accessibilityLabel={`Google Takvim durumu. ${google.stateLabel}. ${google.accountEmail ?? "Hesap seçilmedi"}.`}
          accessibilityState={{ busy: Boolean(google.busy) }}
          style={[styles.flexOne, { gap: 2 }]}
          testID="calendar-google-sync-status"
        >
          <Text maxFontSizeMultiplier={compact ? undefined : 1.35} style={[theme.typography.label, { color: theme.colors.text.primary }]}>Google Takvim ile senkronize</Text>
          <Text maxFontSizeMultiplier={compact ? undefined : 1.35} numberOfLines={compact ? undefined : 2} style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Etkinliklerini otomatik olarak senkronize et.</Text>
          {typeof google.verifiedCount === "number" ? (
            <Text maxFontSizeMultiplier={compact ? undefined : 1.3} style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{google.verifiedCount} uygulama kaydı doğrulandı</Text>
          ) : null}
        </View>
        <View style={[styles.googleActions, compact && styles.googleActionsCompact]}>
          <Button
            compact
            label="Senkronize"
            loading={google.busy}
            onPress={onSync}
            variant="secondary"
          />
          {google.connected ? <Ionicons color={theme.colors.status.success} name="checkmark-circle" size={24} /> : null}
          <Pressable
            accessibilityLabel="Google Takvim'i yönet"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onManage}
            style={styles.googleManageButton}
          >
            <Ionicons color={theme.colors.text.secondary} name="settings-outline" size={20} />
          </Pressable>
        </View>
      </View>
      {google.error ? <Banner message={google.error} title="Google Takvim işlemi tamamlanamadı" tone="error" /> : null}
      {google.warnings?.length ? (
        <Banner message={`${google.warnings.length} eşitleme uyarısı var.`} title="Kısmi eşitleme" tone="warning" />
      ) : null}
    </Card>
  );
}

function PersonalEventCta({
  buttonRef,
  disabled,
  onPress,
}: {
  buttonRef: RefObject<NativeView | null>;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const label = disabled ? "Kişisel takvim hazırlanıyor" : "Kişisel etkinlik ekle";
  return (
    <Pressable
      ref={buttonRef}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      android_ripple={adaptation.pressFeedback === "ripple" ? { color: referencePalette.whiteAlpha24 } : undefined}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.personalEventCta,
        {
          backgroundColor: disabled ? theme.colors.action.disabled : referencePalette.academicBlue,
          borderRadius: 22,
          opacity: pressed && adaptation.pressFeedback !== "ripple" ? 0.88 : 1,
        },
      ]}
    >
      <Ionicons color={disabled ? theme.colors.text.disabled : referencePalette.white} name="add" size={28} />
      <Text maxFontSizeMultiplier={1.4} style={[theme.typography.bodyStrong, { color: disabled ? theme.colors.text.disabled : referencePalette.white }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function WeekSummary({
  compact,
  days,
  onSelectDate,
  selectedDate,
}: {
  compact: boolean;
  days: ReturnType<typeof buildWeekSummary>;
  onSelectDate: (date: string) => void;
  selectedDate: string;
}) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const dayButtons = days.map((day) => {
    const date = new Date(`${day.date}T12:00:00Z`);
    const selected = day.date === selectedDate;
    return (
      <Pressable
        key={day.date}
        accessibilityLabel={`${formatCalendarCompactDay(day.date)}. ${day.itemCount} kayıt.`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => onSelectDate(day.date)}
        testID={`calendar-week-day-${day.date}`}
        style={({ pressed }) => [
          styles.weekDay,
          adaptation.platform === "ios" && styles.weekDayIos,
          compact && styles.weekDayCompact,
          {
            backgroundColor: selected ? theme.colors.action.primary : theme.colors.background.surface,
            borderColor: selected ? theme.colors.action.primary : theme.colors.border.subtle,
            borderRadius: theme.radii.card,
          },
          pressed ? { opacity: 0.85 } : null,
        ]}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={[theme.typography.metaStrong, { color: selected ? theme.colors.action.onPrimary : theme.colors.text.secondary }]}
        >
          {compactWeekdayFormatter.format(date).replace(/\.$/u, "").toLocaleUpperCase("tr-TR")}
        </Text>
        <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={[theme.typography.bodyStrong, { color: selected ? theme.colors.action.onPrimary : theme.colors.text.primary }]}>
          {day.dayNumber}
        </Text>
        <View style={[
          styles.weekDayDot,
          { backgroundColor: day.itemCount
            ? selected ? theme.colors.action.onPrimary : theme.colors.action.primary
            : "transparent" },
        ]} />
      </Pressable>
    );
  });
  const stripStyle = [
    styles.weekSummary,
    adaptation.platform === "ios" && styles.weekSummaryIos,
    { gap: theme.spacing.xxs },
  ];
  return (
    <View style={styles.summarySection}>
      <Text
        accessibilityLabel="Haftalık takvim özeti"
        accessibilityRole="header"
        style={styles.summaryHeading}
      >
        Haftalık takvim özeti
      </Text>
      {adaptation.platform === "ios" ? (
        <ScrollView
          contentContainerStyle={stripStyle}
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={styles.summaryScroll}
          testID="calendar-week-strip"
        >
          {dayButtons}
        </ScrollView>
      ) : (
        <View style={stripStyle} testID="calendar-week-strip">
          {dayButtons}
        </View>
      )}
    </View>
  );
}

function MonthSummary({
  days,
  fontScale,
  onSelectDate,
  selectedDate,
}: {
  days: ReturnType<typeof buildMonthSummary>;
  fontScale: number;
  onSelectDate: (date: string) => void;
  selectedDate: string;
}) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const { width } = useWindowDimensions();
  const weekdayLabels = ["PZT", "SAL", "ÇAR", "PER", "CUM", "CMT", "PZR"];
  const gutter = width < 375 ? 16 : 20;
  const monthWidth = Math.max(IOS_MONTH_MIN_WIDTH, Math.min(720, width - (gutter * 2)));
  const calendar = (
    <View
      style={[
        styles.month,
        adaptation.platform === "ios" ? { width: monthWidth } : null,
        {
          backgroundColor: theme.colors.background.surface,
          borderColor: theme.colors.border.subtle,
          borderRadius: theme.radii.card,
        },
      ]}
      testID="calendar-month-grid"
    >
      <View style={styles.monthWeekdayRow}>
        {weekdayLabels.map((label) => (
          <View key={label} style={styles.monthCell}>
            <Text maxFontSizeMultiplier={1.15} style={[theme.typography.meta, styles.centerText, { color: theme.colors.text.secondary }]}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.monthGrid}>
        {days.map((day) => {
          const selected = day.date === selectedDate;
          const markerColor = day.classifications[0]
            ? classificationPalette(day.classifications[0], theme.colors).accent
            : "transparent";
          return (
            <Pressable
              key={day.date}
              accessibilityLabel={`${formatCalendarDayHeading(day.date)}. ${day.itemCount} kayıt${day.classifications.length ? `. ${day.classifications.map(classificationLabel).join(", ")}` : ""}.`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSelectDate(day.date)}
              testID={`calendar-month-day-${day.date}`}
              style={({ pressed }) => [
                styles.monthCell,
                adaptation.platform === "ios" && styles.monthCellIos,
                styles.monthDay,
                {
                  backgroundColor: pressed ? theme.colors.action.ghostPressed : theme.colors.background.surface,
                  borderColor: theme.colors.border.subtle,
                  minHeight: fontScale >= 1.8 ? 62 : 56,
                  opacity: day.inPeriod ? 1 : 0.52,
                },
              ]}
            >
              <View style={[
                styles.dayNumberCircle,
                {
                  backgroundColor: selected ? theme.colors.action.primary : "transparent",
                  borderRadius: theme.radii.pill,
                },
              ]}>
                <Text maxFontSizeMultiplier={1.2} style={[
                  theme.typography.bodyStrong,
                  { color: selected ? theme.colors.action.onPrimary : theme.colors.text.primary },
                ]}>{day.dayNumber}</Text>
              </View>
              {day.itemCount ? (
                <View style={[
                  styles.monthMarker,
                  {
                    backgroundColor: selected ? theme.colors.action.primary : markerColor,
                    borderRadius: theme.radii.pill,
                  },
                ]} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
  return (
    <View style={styles.summarySection}>
      <Text
        accessibilityLabel="Aylık takvim özeti"
        accessibilityRole="header"
        style={styles.summaryHeading}
      >
        Aylık takvim özeti
      </Text>
      {adaptation.platform === "ios" ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={styles.summaryScroll}
        >
          {calendar}
        </ScrollView>
      ) : calendar}
    </View>
  );
}

function listEntries(
  items: readonly CalendarItem[],
  showHeadings: boolean,
  today: string,
  headingRange?: CalendarListHeadingRange,
): CalendarListEntry[] {
  let previousGroup = "";
  return items.map((item) => {
    const date = calendarItemStartDateOnly(item);
    const continuesIntoRange = headingRange !== undefined && date < headingRange.start;
    const group = continuesIntoRange ? `continuing:${headingRange.start}` : date;
    const showHeading = showHeadings && group !== previousGroup;
    previousGroup = group;
    if (!showHeading) return { item };
    if (continuesIntoRange) return { item, headingLabel: "Devam eden etkinlikler" };
    return { item, headingDate: date, today: date === today };
  });
}

function filterCalendarItems(items: readonly CalendarItem[], query: string): CalendarItem[] {
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("tr-TR");
  if (!normalized) return [...items];
  return items.filter((item) => [
    item.title,
    item.classificationLabel,
    item.location,
    item.sourceLabel,
  ].some((value) => value?.toLocaleLowerCase("tr-TR").includes(normalized)));
}

function formatAgendaDayHeading(date: string): string {
  const cached = agendaDayHeadingCache.get(date);
  if (cached) return cached;
  const heading = agendaDayHeadingFormatter.format(new Date(`${date}T12:00:00.000Z`));
  if (agendaDayHeadingCache.size >= 512) agendaDayHeadingCache.clear();
  agendaDayHeadingCache.set(date, heading);
  return heading;
}

function formatSelectedDayHeading(date: string): string {
  return selectedDayHeadingFormatter.format(new Date(`${date}T12:00:00.000Z`));
}

function formatEndClock(item: CalendarItem, dateOnly: boolean): string | undefined {
  if (dateOnly || !item.endDate || item.endTemporalKind === "date" || isDateOnlyValue(item.endDate)) return undefined;
  return formatCalendarClock(
    item.endDate,
    item.endTemporalKind ?? item.temporalKind,
    item.timezone,
  );
}

function classificationPalette(
  classification: CalendarClassification,
  colors: ReturnType<typeof useTheme>["colors"],
): { accent: string; container: string; foreground: string } {
  switch (classification) {
    case "personal_exam":
      return { accent: referencePalette.violet, container: referencePalette.violetSoft, foreground: referencePalette.violetText };
    case "personal":
      return { accent: colors.accent.teal, container: colors.status.successContainer, foreground: colors.accent.tealText };
    case "exam":
      return { accent: colors.action.primary, container: colors.action.secondary, foreground: colors.text.link };
    case "registration":
      return { accent: colors.accent.orange, container: colors.status.warningContainer, foreground: colors.accent.orangeText };
    case "holiday":
      return { accent: colors.accent.teal, container: colors.status.successContainer, foreground: colors.accent.tealText };
    case "academic":
      return { accent: referencePalette.emerald, container: referencePalette.emeraldSoft, foreground: referencePalette.emeraldText };
  }
}

const styles = StyleSheet.create({
  listContent: {
    alignSelf: "center",
    maxWidth: 720,
    width: "100%",
  },
  header: {
    alignSelf: "stretch",
  },
  calendarHero: {
    minWidth: 0,
  },
  brandBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 58,
  },
  brandIdentity: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
  },
  brandLogo: {
    height: 54,
    width: 54,
  },
  brandCopy: {
    flexShrink: 1,
    minWidth: 0,
  },
  brandActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginLeft: 8,
  },
  brandName: {
    color: referencePalette.navy,
    fontSize: 19,
    fontWeight: "800",
    lineHeight: 21,
  },
  brandNameAccent: {
    color: referencePalette.academicBlue,
    fontSize: 19,
    fontWeight: "800",
    lineHeight: 21,
  },
  accountAvatar: {
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 1.5,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  heroHeadingRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 112,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
  },
  calendarTitle: {
    fontSize: 40,
    fontWeight: "800",
    lineHeight: 47,
  },
  calendarArtwork: {
    height: 106,
    position: "relative",
    width: 154,
  },
  artCalendar: {
    alignItems: "center",
    backgroundColor: referencePalette.academicBlueSurface,
    borderColor: referencePalette.academicBlueBorder,
    borderRadius: 13,
    borderWidth: 1.5,
    height: 79,
    justifyContent: "center",
    position: "absolute",
    right: 10,
    top: 2,
    transform: [{ rotate: "7deg" }],
    width: 72,
  },
  artCalendarBindingRow: {
    flexDirection: "row",
    gap: 8,
    left: 10,
    position: "absolute",
    top: -5,
  },
  artCalendarBinding: {
    backgroundColor: referencePalette.academicBlue,
    borderRadius: 2,
    height: 12,
    width: 4,
  },
  artPlant: {
    bottom: 12,
    height: 65,
    left: 12,
    position: "absolute",
    width: 55,
  },
  artPlantStem: {
    backgroundColor: referencePalette.academicGreen,
    bottom: 16,
    height: 37,
    left: 26,
    position: "absolute",
    width: 3,
  },
  artLeaf: {
    backgroundColor: referencePalette.academicTealSoft,
    borderColor: referencePalette.academicTeal,
    borderRadius: 12,
    borderWidth: 1,
    height: 21,
    position: "absolute",
    width: 12,
  },
  artLeafLeft: {
    left: 14,
    top: 18,
    transform: [{ rotate: "-42deg" }],
  },
  artLeafRight: {
    right: 13,
    top: 8,
    transform: [{ rotate: "38deg" }],
  },
  artPot: {
    backgroundColor: referencePalette.academicBlueSoft,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
    bottom: 0,
    height: 19,
    left: 15,
    width: 27,
  },
  artPen: {
    backgroundColor: referencePalette.academicBlue,
    borderRadius: 4,
    bottom: 5,
    height: 7,
    position: "absolute",
    right: 0,
    transform: [{ rotate: "-10deg" }],
    width: 91,
  },
  headerIconButton: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  listFooter: {
    alignSelf: "stretch",
  },
  loadMorePanel: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingTop: 14,
  },
  searchFrame: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    minHeight: 48,
    minWidth: 0,
    paddingVertical: 8,
  },
  searchClearButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  viewTabs: {
    alignItems: "stretch",
    flexDirection: "column",
    gap: 8,
  },
  viewTabsCompact: {
    flexDirection: "column",
  },
  primaryViewTabs: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 3,
    padding: 3,
  },
  primaryViewTabsCompact: {
    flexDirection: "column",
  },
  primaryViewTab: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 8,
  },
  viewTabCompact: {
    flex: undefined,
    width: "100%",
  },
  optionsSheetContent: {
    gap: 8,
  },
  optionGroup: {
    alignSelf: "stretch",
  },
  optionSectionHeading: {
    marginTop: 12,
  },
  optionRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  optionRowLabel: {
    flex: 1,
    minWidth: 0,
  },
  periodNavigator: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  periodLabel: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 8,
  },
  arrowButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  monthNavigator: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  monthTitle: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  selectedDayHeading: {
    alignItems: "center",
    flexDirection: "row",
    paddingHorizontal: 4,
  },
  eventsSectionHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  eventCountPill: {
    alignItems: "center",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 28,
    minWidth: 34,
    paddingHorizontal: 9,
  },
  entry: {
    alignSelf: "stretch",
  },
  dayHeading: {
    alignItems: "center",
    flexDirection: "row",
    paddingHorizontal: 2,
  },
  todayPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  liveAnnouncement: {
    height: 1,
    opacity: 0,
    position: "absolute",
    width: 1,
  },
  eventCard: {
    alignSelf: "stretch",
    overflow: "hidden",
  },
  eventCardLayout: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 96,
  },
  eventAccent: {
    alignSelf: "stretch",
    width: 4,
  },
  timeColumn: {
    alignItems: "flex-start",
    alignSelf: "stretch",
    justifyContent: "center",
    paddingHorizontal: 10,
    width: 62,
  },
  timeLabel: {
    width: "100%",
  },
  eventContent: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
  },
  categoryPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  locationRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
  },
  eventTrailing: {
    alignItems: "center",
    justifyContent: "center",
    paddingRight: 12,
    width: 34,
  },
  googleBanner: {
    alignSelf: "stretch",
  },
  googleRow: {
    alignItems: "center",
    flexDirection: "row",
  },
  googleRowCompact: {
    alignItems: "stretch",
    flexWrap: "wrap",
  },
  googleActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  googleActionsCompact: {
    justifyContent: "flex-end",
    paddingLeft: 58,
    width: "100%",
  },
  googleManageButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  googleIcon: {
    alignItems: "center",
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  personalEventCta: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    minHeight: 58,
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingVertical: 14,
    width: "100%",
  },
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  weekSummary: {
    alignItems: "stretch",
    alignSelf: "stretch",
    backgroundColor: referencePalette.white,
    borderColor: referencePalette.academicBlueBorderMuted,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    padding: 5,
    width: "100%",
  },
  weekSummaryIos: {
    minWidth: IOS_WEEK_MIN_WIDTH,
  },
  weekDay: {
    alignItems: "center",
    borderWidth: 0,
    flexBasis: 0,
    flexGrow: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: 64,
    minWidth: 0,
    paddingHorizontal: 3,
    paddingVertical: 6,
  },
  weekDayCompact: {
    paddingHorizontal: 1,
  },
  weekDayIos: {
    flexBasis: 44,
    minWidth: 44,
  },
  weekDayDot: {
    height: 4,
    width: 4,
  },
  month: {
    alignSelf: "stretch",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  monthWeekdayRow: {
    flexDirection: "row",
    paddingVertical: 8,
  },
  monthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  monthCell: {
    minWidth: 0,
    width: "14.285714%",
  },
  monthCellIos: {
    minWidth: 44,
  },
  monthDay: {
    alignItems: "center",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  dayNumberCircle: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  monthMarker: {
    height: 4,
    marginTop: 2,
    width: 10,
  },
  centerText: {
    textAlign: "center",
  },
  summaryHeading: {
    height: 1,
    left: -10000,
    opacity: 0,
    position: "absolute",
    top: 0,
    width: 1,
  },
  summaryScroll: {
    alignSelf: "stretch",
  },
  summarySection: {
    alignSelf: "stretch",
  },
});
