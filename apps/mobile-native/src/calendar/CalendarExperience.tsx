import { Ionicons } from "@expo/vector-icons";
import { useScrollToTop } from "@react-navigation/native";
import { useNetworkState } from "expo-network";
import { useMemo, useRef, useState } from "react";
import {
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
  EmptyState,
  ErrorState,
  SegmentedControl,
  Skeleton,
  usePlatformAdaptation,
  useTheme,
} from "../design-system";
import { formatAcademicTemporal, isDateOnlyValue } from "../temporal/academic-temporal";
import {
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
  initialView?: CalendarViewMode;
  initialAnchorDate?: string;
  now?: Date;
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
  heading?: string;
};

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
  initialView = "agenda",
  initialAnchorDate,
  now,
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
  useScrollToTop(listRef);
  const [view, setView] = useState<CalendarViewMode>(initialView);
  const [anchorDate, setAnchorDate] = useState(initialAnchorDate ?? todayDateOnly(now));
  const [editorExam, setEditorExam] = useState<CalendarPersonalExam | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const isOffline = offline ?? (
    networkState.isConnected === false || networkState.isInternetReachable === false
  );
  const gutter = width < 375 ? 16 : 20;

  const allItems = useMemo(() => buildCalendarItems({
    academicEvents,
    personalExams: personalExamsReady ? personalExams : [],
    academicSourceLabel: calendarTitle ?? universityName ?? "Resmî akademik takvim",
  }), [academicEvents, calendarTitle, personalExams, personalExamsReady, universityName]);
  const visibleItems = useMemo(() => selectCalendarItemsForView({
    items: allItems,
    view,
    anchorDate,
    now,
  }), [allItems, anchorDate, now, view]);
  const entries = useMemo(() => listEntries(visibleItems), [visibleItems]);
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
    () => view === "week" ? buildWeekSummary(allItems, anchorDate) : [],
    [allItems, anchorDate, view],
  );
  const month = useMemo(
    () => view === "month" ? buildMonthSummary(allItems, anchorDate) : [],
    [allItems, anchorDate, view],
  );

  const renderItem: ListRenderItem<CalendarListEntry> = ({ item: entry }) => (
    <View style={[styles.entry, { gap: theme.spacing.xs }]}>
      {entry.heading ? (
        <Text
          accessibilityRole="header"
          style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}
        >
          {entry.heading}
        </Text>
      ) : null}
      <CalendarItemCard item={entry.item} onPress={() => onOpenItem(entry.item)} />
    </View>
  );

  const listHeader = (
    <View style={[styles.header, { gap: theme.spacing.lg, paddingTop: theme.spacing.md }]}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text accessibilityRole="header" style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}>Akademik planın</Text>
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>
          {universityName ?? "Üniversite bağlamın"}
          {academicYear ? ` · ${academicYear}` : ""}
        </Text>
      </View>

      <SegmentedControl
        label="Takvim görünümü"
        onValueChange={setView}
        options={CALENDAR_VIEW_OPTIONS}
        orientation={width <= 360 && fontScale >= 1.6 ? "vertical" : "horizontal"}
        value={view}
      />

      {period ? (
        <View
          accessibilityLabel={`${view === "week" ? "Hafta" : "Ay"} dönemi. ${period.label}`}
          style={[styles.periodControls, { gap: theme.spacing.sm }]}
        >
          <Text accessibilityRole="header" style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>
            {period.label}
          </Text>
          <View style={[styles.wrappedActions, { gap: theme.spacing.sm }]}>
            <Button
              compact
              label={view === "week" ? "Önceki hafta" : "Önceki ay"}
              onPress={() => setAnchorDate((current) => moveCalendarAnchor(
                view === "week" ? "week" : "month",
                current,
                -1,
              ))}
              variant="secondary"
            />
            <Button compact label="Bugün" onPress={() => setAnchorDate(todayDateOnly(now))} variant="ghost" />
            <Button
              compact
              label={view === "week" ? "Sonraki hafta" : "Sonraki ay"}
              onPress={() => setAnchorDate((current) => moveCalendarAnchor(
                view === "week" ? "week" : "month",
                current,
                1,
              ))}
              variant="secondary"
            />
          </View>
        </View>
      ) : null}

      {view === "week" ? <WeekSummary days={week} /> : null}
      {view === "month" ? <MonthSummary days={month} fontScale={fontScale} /> : null}

      <Button
        aria-expanded={editorVisible}
        disabled={!personalExamsReady}
        fullWidth
        label={personalExamsReady ? "Kişisel sınav ekle" : "Kişisel sınavlar hazırlanıyor"}
        onPress={() => {
          setEditorExam(null);
          setEditorVisible(true);
        }}
      />

      <GoogleStatusCard
        google={google}
        onManage={onManageGoogle}
        onSync={onSyncGoogle}
      />

      <CalendarAvailability
        error={error}
        onRefresh={onRefresh}
        state={state}
      />

      {view === "agenda" ? (
        <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>Yaklaşan tarihler</Text>
      ) : (
        <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>Bu dönemdeki tarihler</Text>
      )}
    </View>
  );

  return (
    <>
      <FlatList
        ref={listRef}
        accessibilityLabel="Takvim etkinlikleri"
        contentContainerStyle={[
          styles.listContent,
          {
            gap: theme.spacing.md,
            paddingBottom: theme.spacing.xl,
            paddingHorizontal: gutter,
          },
        ]}
        data={entries}
        initialNumToRender={12}
        keyExtractor={(entry) => entry.item.key}
        ListEmptyComponent={(
          <View>
            {state !== "loading" && state !== "error" && state !== "offline" && state !== "partial" ? (
              <EmptyState
                actionLabel="Takvimi yenile"
                description={view === "agenda"
                  ? "Yaklaşan akademik tarih veya kişisel sınav bulunmuyor."
                  : "Seçili dönemde gösterilecek kayıt bulunmuyor."}
                illustration={<Ionicons color={theme.colors.status.info} name="calendar-clear-outline" size={28} />}
                onAction={onRefresh}
                title={view === "agenda" ? "Ajandan boş" : "Bu dönem boş"}
              />
            ) : null}
          </View>
        )}
        ListHeaderComponent={listHeader}
        onRefresh={onRefresh}
        refreshing={loading && allItems.length > 0}
        renderItem={renderItem}
        showsVerticalScrollIndicator
        style={{ backgroundColor: theme.colors.background.canvas }}
        windowSize={7}
      />

      <PersonalExamEditor
        exam={editorExam}
        onDismiss={() => setEditorVisible(false)}
        onSubmit={(input) => editorExam
          ? onUpdatePersonalExam(editorExam.id, input)
          : onCreatePersonalExam(input)}
        visible={editorVisible}
      />
    </>
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
  const color = classificationColor(item.classification, theme.colors);
  const dateOnly = item.temporalKind === "date" || isDateOnlyValue(item.startDate);
  const temporalLabel = formatAcademicTemporal(item);
  const semanticTime = dateOnly
    ? item.endDate && item.endDate !== item.startDate
      ? "Tüm gün · tarih aralığının son günü dahil"
      : "Tüm gün · saat bilgisi verilmemiş"
    : "Kaynak saati";
  return (
    <Card
      accessibilityLabel={`${item.classificationLabel}. ${item.title}. ${temporalLabel}. ${semanticTime}. ${item.sourceLabel}. Ayrıntıyı aç.`}
      onPress={onPress}
      style={{ gap: theme.spacing.sm }}
    >
      <View style={[styles.itemTopRow, { gap: theme.spacing.sm }]}>
        <View style={[styles.classification, {
          backgroundColor: theme.colors.background.subtle,
          borderColor: color,
          borderRadius: theme.radii.pill,
          gap: theme.spacing.xs,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
        }]}>
          <Ionicons color={color} name={item.icon} size={18} />
          <Text style={[theme.typography.metaStrong, { color }]}>{item.classificationLabel}</Text>
        </View>
        <Ionicons color={theme.colors.text.secondary} name="chevron-forward" size={20} />
      </View>
      <Text style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>{item.title}</Text>
      <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>{temporalLabel}</Text>
      <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{semanticTime}</Text>
      <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{item.sourceLabel}</Text>
    </Card>
  );
}

function GoogleStatusCard({
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
      style={{ gap: theme.spacing.sm }}
      variant="tonal"
    >
      <View style={[styles.itemTopRow, { gap: theme.spacing.sm }]}>
        <View style={[styles.googleTitle, { gap: theme.spacing.sm }]}>
          <Ionicons color={theme.colors.status.info} name="logo-google" size={22} />
          <View style={styles.flexOne}>
            <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>Google Takvim</Text>
            <Text style={[theme.typography.metaStrong, { color: theme.colors.text.secondary }]}>{google.stateLabel}</Text>
          </View>
        </View>
        {google.busy ? <ActivityIndicator color={theme.colors.action.primary} /> : null}
      </View>
      {google.accountEmail ? (
        <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{google.accountEmail}</Text>
      ) : null}
      {typeof google.verifiedCount === "number" ? (
        <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{google.verifiedCount} uygulama kaydı doğrulandı</Text>
      ) : null}
      {google.lastSyncedLabel ? (
        <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{google.lastSyncedLabel}</Text>
      ) : null}
      <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Yalnızca uygulamanın oluşturduğu kayıtlar yönetilir; kişisel Google etkinlikleri değiştirilmez.</Text>
      {google.error ? <Banner message={google.error} title="Google Takvim işlemi tamamlanamadı" tone="error" /> : null}
      {google.warnings?.length ? (
        <Banner message={`${google.warnings.length} eşitleme uyarısı var. Ayrıntılar yönetim ekranında.`} title="Kısmi eşitleme" tone="warning" />
      ) : null}
      <View style={[styles.wrappedActions, { gap: theme.spacing.sm }]}>
        <Button
          compact
          label={google.connected ? "Şimdi eşitle" : "Bağlan ve eşitle"}
          loading={google.busy}
          onPress={onSync}
        />
        <Button compact label="Google Takvim'i yönet" onPress={onManage} variant="secondary" />
      </View>
    </Card>
  );
}

function WeekSummary({ days }: { days: ReturnType<typeof buildWeekSummary> }) {
  const theme = useTheme();
  return (
    <View accessibilityLabel="Haftalık takvim özeti" style={[styles.weekSummary, { gap: theme.spacing.xs }]}>
      {days.map((day) => (
        <View
          key={day.date}
          accessible
          accessibilityLabel={`${formatCalendarCompactDay(day.date)}. ${day.itemCount} kayıt.`}
          style={[styles.weekDay, {
            backgroundColor: day.itemCount ? theme.colors.state.selected : theme.colors.background.surface,
            borderColor: theme.colors.border.default,
            borderRadius: theme.radii.small,
            padding: theme.spacing.xs,
          }]}
        >
          <Text maxFontSizeMultiplier={1.35} style={[theme.typography.metaStrong, { color: theme.colors.text.primary }]}>{formatCalendarCompactDay(day.date)}</Text>
          <Text maxFontSizeMultiplier={1.35} style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{day.itemCount} kayıt</Text>
        </View>
      ))}
    </View>
  );
}

function MonthSummary({
  days,
  fontScale,
}: {
  days: ReturnType<typeof buildMonthSummary>;
  fontScale: number;
}) {
  const theme = useTheme();
  const weekdayLabels = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  return (
    <View accessibilityLabel="Aylık takvim özeti" style={[styles.month, {
      borderColor: theme.colors.border.default,
      borderRadius: theme.radii.card,
      padding: theme.spacing.xs,
    }]}>
      <View style={styles.monthRow}>
        {weekdayLabels.map((label) => (
          <View key={label} style={styles.monthCell}>
            <Text maxFontSizeMultiplier={1.2} style={[theme.typography.metaStrong, styles.centerText, { color: theme.colors.text.secondary }]}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.monthGrid}>
        {days.map((day) => (
          <View
            key={day.date}
            accessible
            accessibilityLabel={`${formatCalendarDayHeading(day.date)}. ${day.itemCount} kayıt${day.classifications.length ? `. ${day.classifications.map(classificationLabel).join(", ")}` : ""}.`}
            style={[styles.monthCell, styles.monthDay, {
              backgroundColor: day.itemCount ? theme.colors.state.selected : theme.colors.background.surface,
              borderColor: theme.colors.border.default,
              opacity: day.inPeriod ? 1 : 0.45,
              paddingVertical: fontScale >= 2 ? theme.spacing.xs : theme.spacing.sm,
            }]}
          >
            <Text maxFontSizeMultiplier={1.2} style={[theme.typography.metaStrong, { color: theme.colors.text.primary }]}>{day.dayNumber}</Text>
            {day.itemCount ? (
              <View style={styles.monthCount}>
                <Ionicons color={theme.colors.status.info} name="ellipse" size={7} />
                <Text maxFontSizeMultiplier={1.2} style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{day.itemCount}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>
      <Text style={[theme.typography.meta, { color: theme.colors.text.secondary, marginTop: theme.spacing.xs }]}>Gün hücreleri özet amaçlıdır; tam tarih ve türler aşağıdaki erişilebilir listede yer alır.</Text>
    </View>
  );
}

function listEntries(items: readonly CalendarItem[]): CalendarListEntry[] {
  let previousDate = "";
  return items.map((item) => {
    const date = calendarItemStartDateOnly(item);
    const heading = date === previousDate ? undefined : formatCalendarDayHeading(date);
    previousDate = date;
    return { item, ...(heading ? { heading } : {}) };
  });
}

function classificationColor(
  classification: CalendarClassification,
  colors: ReturnType<typeof useTheme>["colors"],
): string {
  switch (classification) {
    case "personal_exam": return colors.action.primary;
    case "exam": return colors.status.error;
    case "registration": return colors.status.warning;
    case "holiday": return colors.status.success;
    case "academic": return colors.status.info;
  }
}

const styles = StyleSheet.create({
  listContent: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 720,
  },
  header: {
    alignSelf: "stretch",
  },
  entry: {
    alignSelf: "stretch",
  },
  periodControls: {
    alignSelf: "stretch",
  },
  wrappedActions: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  itemTopRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  classification: {
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
    flexShrink: 1,
  },
  googleTitle: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  weekSummary: {
    alignSelf: "stretch",
  },
  weekDay: {
    borderWidth: 1,
    minHeight: 48,
  },
  month: {
    alignSelf: "stretch",
    borderWidth: 1,
    overflow: "hidden",
  },
  monthRow: {
    flexDirection: "row",
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
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
    paddingHorizontal: 2,
  },
  monthCount: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
  },
  centerText: {
    textAlign: "center",
  },
});
