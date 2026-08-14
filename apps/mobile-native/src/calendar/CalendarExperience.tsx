import { Ionicons } from "@expo/vector-icons";
import { useScrollToTop } from "@react-navigation/native";
import { useNetworkState } from "expo-network";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
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
import {
  Banner,
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
  ACADEMIC_CALENDAR_VIEW_OPTIONS,
  CALENDAR_VIEW_OPTIONS,
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
  today?: boolean;
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
  const networkState = useNetworkState();
  const { fontScale, width } = useWindowDimensions();
  const listRef = useRef<FlatList<CalendarListEntry> | null>(null);
  const createExamRef = useRef<NativeView | null>(null);
  const calendarAnnouncementRequestedRef = useRef(false);
  useScrollToTop(listRef);
  const [view, setView] = useState<CalendarViewMode>(initialView);
  const [anchorDate, setAnchorDate] = useState(initialAnchorDate ?? todayDateOnly(now));
  const [editorExam, setEditorExam] = useState<CalendarPersonalExam | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [agendaLimit, setAgendaLimit] = useState(AGENDA_PAGE_SIZE);
  const isOffline = offline ?? (
    networkState.isConnected === false || networkState.isInternetReachable === false
  );
  const gutter = width < 375 ? 16 : 20;
  const today = todayDateOnly(now);

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
  const entries = useMemo(() => {
    const startedAt = Date.now();
    const result = listEntries(visibleItems, view === "agenda" || view === "week", today);
    runtimeDiagnostic("calendar.model", {
      phase: "build_entries",
      inputCount: visibleItems.length,
      outputCount: result.length,
      elapsedMs: Date.now() - startedAt,
    });
    return result;
  }, [today, view, visibleItems]);
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
    ? `Ajanda görünümü. ${entries.length} kayıt.`
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

  const renderItem: ListRenderItem<CalendarListEntry> = ({ item: entry }) => (
    <View style={[styles.entry, { gap: theme.spacing.xs }]}>
      {entry.headingDate ? (
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
            {formatAgendaDayHeading(entry.headingDate)}
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
        createButtonRef={createExamRef}
        createDisabled={!personalExamsReady}
        onAccountMenuPress={onOpenAccountMenu}
        onCalendarPress={() => changeAnchorDate(today)}
        onCreatePress={() => {
          setEditorExam(null);
          setEditorVisible(true);
        }}
        onMenuPress={() => changeView("agenda")}
        onSearchPress={() => setSearchVisible((current) => !current)}
        searchVisible={searchVisible}
        view={view}
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

      {view === "week" ? (
        <WeekSummary
          compact={width <= 375 || fontScale >= 1.6}
          days={week}
          onSelectDate={(date) => {
            changeAnchorDate(date);
            changeView("day");
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
            paddingBottom: 108,
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
              google={google}
              onManage={onManageGoogle}
              onSync={onSyncGoogle}
            />
          </View>
        )}
        ListHeaderComponent={listHeader}
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
    </>
  );
}

function CalendarScreenHeader({
  createButtonRef,
  createDisabled,
  onAccountMenuPress,
  onCalendarPress,
  onCreatePress,
  onMenuPress,
  onSearchPress,
  searchVisible,
  view,
}: {
  createButtonRef: RefObject<NativeView | null>;
  createDisabled: boolean;
  onAccountMenuPress?: () => void;
  onCalendarPress: () => void;
  onCreatePress: () => void;
  onMenuPress: () => void;
  onSearchPress: () => void;
  searchVisible: boolean;
  view: CalendarViewMode;
}) {
  const theme = useTheme();
  const agenda = view === "agenda";
  return (
    <View style={styles.screenHeader}>
      <CalendarIconButton
        disabled={!onAccountMenuPress}
        label="Hesap menüsünü aç"
        name="menu-outline"
        onPress={onAccountMenuPress ?? (() => undefined)}
      />
      <Text
        accessibilityRole="header"
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.3}
        minimumFontScale={0.75}
        numberOfLines={1}
        style={[theme.typography.display, styles.flexOne, { color: theme.colors.text.primary }]}
      >
        Takvim
      </Text>
      <View style={styles.headerActions}>
        {agenda ? (
          <CalendarIconButton
            label={searchVisible ? "Takvim aramasını kapat" : "Takvimde ara"}
            name={searchVisible ? "close-outline" : "search-outline"}
            onPress={onSearchPress}
          />
        ) : null}
        <CalendarIconButton label="Bugüne git" name="calendar-outline" onPress={onCalendarPress} />
        <CalendarIconButton
          buttonRef={createButtonRef}
          disabled={createDisabled}
          label={createDisabled ? "Kişisel takvim hazırlanıyor" : "Kişisel etkinlik ekle"}
          name="add"
          onPress={onCreatePress}
        />
        {!agenda ? (
          <CalendarIconButton label="Ajanda görünümünü aç" name="list-outline" onPress={onMenuPress} />
        ) : null}
      </View>
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
  name: "add" | "calendar-outline" | "close-outline" | "list-outline" | "menu-outline" | "search-outline";
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
  const options = value === "agenda" ? CALENDAR_VIEW_OPTIONS : ACADEMIC_CALENDAR_VIEW_OPTIONS;
  return (
    <View
      accessibilityLabel="Takvim görünümü"
      accessibilityRole="radiogroup"
      style={[
        styles.viewTabs,
        compact && styles.viewTabsCompact,
        {
          backgroundColor: theme.colors.background.subtle,
          borderColor: theme.colors.border.subtle,
          borderRadius: theme.radii.prominent,
        },
      ]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const filled = selected && value === "month";
        return (
          <Pressable
            key={option.value}
            accessibilityLabel={option.label}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onValueChange(option.value)}
            style={({ pressed }) => [
              styles.viewTab,
              compact && styles.viewTabCompact,
              {
                backgroundColor: filled
                  ? theme.colors.action.primary
                  : selected
                    ? theme.colors.background.surface
                    : pressed
                      ? theme.colors.action.ghostPressed
                      : "transparent",
                borderColor: selected ? theme.colors.border.subtle : "transparent",
                borderRadius: theme.radii.card,
              },
            ]}
          >
            <Text maxFontSizeMultiplier={1.35} style={[
              theme.typography.label,
              { color: filled
                ? theme.colors.action.onPrimary
                : selected
                  ? theme.colors.text.link
                  : theme.colors.text.secondary },
            ]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
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
        <Ionicons color={theme.colors.text.primary} name="chevron-down" size={18} />
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
          borderRadius: theme.radii.card,
          padding: 0,
        },
      ]}
      variant="outlined"
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
  google,
  onSync,
  onManage,
}: {
  google: CalendarGoogleStatus;
  onSync: () => void;
  onManage: () => void;
}) {
  const theme = useTheme();
  return (
    <Card
      accessibilityLabel={`Google Takvim durumu. ${google.stateLabel}. ${google.accountEmail ?? "Hesap seçilmedi"}.`}
      busy={google.busy}
      style={[styles.googleBanner, { gap: theme.spacing.sm, padding: theme.spacing.sm }]}
      variant="elevated"
    >
      <View style={[styles.googleRow, { gap: theme.spacing.sm }]}>
        <View style={[styles.googleIcon, { backgroundColor: theme.colors.status.successContainer, borderRadius: theme.radii.control }]}>
          <Ionicons color={theme.colors.action.primary} name="logo-google" size={25} />
        </View>
        <View style={[styles.flexOne, { gap: 2 }]}>
          <Text maxFontSizeMultiplier={1.35} style={[theme.typography.label, { color: theme.colors.text.primary }]}>Google Takvim ile senkronize</Text>
          <Text maxFontSizeMultiplier={1.35} numberOfLines={2} style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Etkinliklerini otomatik olarak senkronize et.</Text>
          {typeof google.verifiedCount === "number" ? (
            <Text maxFontSizeMultiplier={1.3} style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{google.verifiedCount} uygulama kaydı doğrulandı</Text>
          ) : null}
        </View>
        <Button
          compact
          label="Senkronize"
          loading={google.busy}
          onPress={onSync}
          variant="secondary"
        />
        {google.connected ? <Ionicons color={theme.colors.status.success} name="checkmark-circle" size={24} /> : null}
        <Pressable accessibilityLabel="Google Takvim'i yönet" accessibilityRole="button" hitSlop={8} onPress={onManage}>
          <Ionicons color={theme.colors.text.secondary} name="settings-outline" size={20} />
        </Pressable>
      </View>
      {google.error ? <Banner message={google.error} title="Google Takvim işlemi tamamlanamadı" tone="error" /> : null}
      {google.warnings?.length ? (
        <Banner message={`${google.warnings.length} eşitleme uyarısı var.`} title="Kısmi eşitleme" tone="warning" />
      ) : null}
    </Card>
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
  return (
    <ScrollView
      accessibilityLabel="Haftalık takvim özeti"
      contentContainerStyle={[styles.weekSummary, { gap: theme.spacing.xxs }]}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {days.map((day) => {
        const date = new Date(`${day.date}T12:00:00Z`);
        const selected = day.date === selectedDate;
        return (
          <Pressable
            key={day.date}
            accessibilityLabel={`${formatCalendarCompactDay(day.date)}. ${day.itemCount} kayıt.`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelectDate(day.date)}
            style={({ pressed }) => [
              styles.weekDay,
              {
                backgroundColor: selected ? theme.colors.action.primary : theme.colors.background.surface,
                borderColor: selected ? theme.colors.action.primary : theme.colors.border.subtle,
                borderRadius: theme.radii.card,
                minWidth: compact ? 45 : 50,
              },
              pressed ? { opacity: 0.85 } : null,
            ]}
          >
            <Text maxFontSizeMultiplier={1.3} style={[theme.typography.metaStrong, { color: selected ? theme.colors.action.onPrimary : theme.colors.text.secondary }]}>
              {compactWeekdayFormatter.format(date)}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={[theme.typography.bodyStrong, { color: selected ? theme.colors.action.onPrimary : theme.colors.text.primary }]}>
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
      })}
    </ScrollView>
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
  const weekdayLabels = ["PZT", "SAL", "ÇAR", "PER", "CUM", "CMT", "PZR"];
  return (
    <View
      accessibilityLabel="Aylık takvim özeti"
      style={[
        styles.month,
        {
          backgroundColor: theme.colors.background.surface,
          borderColor: theme.colors.border.subtle,
          borderRadius: theme.radii.card,
        },
      ]}
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
              style={({ pressed }) => [
                styles.monthCell,
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
}

function listEntries(
  items: readonly CalendarItem[],
  showHeadings: boolean,
  today: string,
): CalendarListEntry[] {
  let previousDate = "";
  return items.map((item) => {
    const date = calendarItemStartDateOnly(item);
    const headingDate = showHeadings && date !== previousDate ? date : undefined;
    previousDate = date;
    return { item, ...(headingDate ? { headingDate, today: date === today } : {}) };
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
  screenHeader: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 56,
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
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
  viewTabs: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 3,
    padding: 3,
  },
  viewTabsCompact: {
    flexDirection: "column",
  },
  viewTab: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 8,
  },
  viewTabCompact: {
    flex: undefined,
    width: "100%",
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
  googleIcon: {
    alignItems: "center",
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  weekSummary: {
    alignItems: "stretch",
    flexDirection: "row",
    flexGrow: 1,
  },
  weekDay: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexGrow: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: 64,
    paddingHorizontal: 6,
    paddingVertical: 6,
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
});
