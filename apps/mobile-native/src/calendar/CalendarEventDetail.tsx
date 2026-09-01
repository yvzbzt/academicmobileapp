import { Ionicons } from "@expo/vector-icons";
import { useRef, useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type View as NativeView } from "react-native";
import {
  Banner,
  Button,
  Card,
  ErrorState,
  useTheme,
} from "../design-system";
import { canonicalizeOfficialAcademicUrl } from "../content/content-trust";
import { isDateOnlyValue } from "../temporal/academic-temporal";
import type { CalendarClassification, CalendarItem } from "./calendar-model";
import { formatCalendarTemporal } from "./calendar-time";
import {
  PersonalExamEditor,
  type PersonalExamMutationInput,
  type PersonalExamMutationResult,
} from "./PersonalExamEditor";

export interface CalendarEventDetailProps {
  item: CalendarItem | null;
  feedback?: ReactNode;
  academicYear?: string;
  universityName?: string;
  facultyName?: string;
  departmentName?: string;
  /** Used by headerless preview or host stacks that delegate chrome to this screen. */
  onBack?: () => void;
  onOpenOfficialSource?: (url: string) => void | Promise<unknown>;
  onUpdatePersonalExam: (
    id: string,
    input: PersonalExamMutationInput,
  ) => PersonalExamMutationResult;
  onDeletePersonalExam: (id: string) => PersonalExamMutationResult;
}

export function CalendarEventDetail({
  item,
  feedback,
  academicYear,
  universityName,
  facultyName,
  departmentName,
  onBack,
  onOpenOfficialSource,
  onUpdatePersonalExam,
  onDeletePersonalExam,
}: CalendarEventDetailProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const gutter = width < 375 ? 16 : 20;
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const editExamRef = useRef<NativeView | null>(null);

  if (!item) {
    return (
      <ErrorState
        description="Bu rota güncel hesapta doğrulanmış bir takvim kaydıyla eşleşmiyor. Geri dönerek takvimden yeniden seç."
        title="Takvim kaydı kullanılamıyor"
      />
    );
  }

  const dateOnly = item.temporalKind === "date" || isDateOnlyValue(item.startDate);
  const semanticTime = dateOnly
    ? item.endDate && item.endDate !== item.startDate
      ? "Tüm gün · Bitiş günü dâhil · Saat belirtilmemiş"
      : "Tüm gün · Saat belirtilmemiş"
    : "Kaynakta belirtilen saat";
  const accentColor = classificationColor(item.classification, theme.colors);
  const scopeLabel = calendarScopeLabel(item, {
    universityName,
    facultyName,
    departmentName,
  });
  const officialSourceUrl = item.source === "academic"
    ? canonicalizeOfficialAcademicUrl(item.sourceUrl)
    : null;
  const officialSourceDomain = officialSourceUrl ? sourceDomain(officialSourceUrl) : null;

  const confirmDelete = () => {
    Alert.alert(
      "Kişisel etkinliği sil",
      `“${item.title}” yalnızca bu hesaba ait cihaz planından kaldırılacak. Bu işlem Google Takvim'deki kişisel etkinliklere dokunmaz.`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Etkinliği sil",
          style: "destructive",
          onPress: () => {
            const result = onDeletePersonalExam(item.id);
            if (!result.ok) setActionError(result.error);
          },
        },
      ],
    );
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            gap: theme.spacing.lg,
            paddingBottom: theme.spacing.xl,
            paddingHorizontal: gutter,
            paddingTop: theme.spacing.md,
          },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator
        style={{ backgroundColor: theme.colors.background.canvas }}
      >
        {onBack ? (
          <View style={styles.detailHeader}>
            <Pressable
              accessibilityLabel="Geri"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onBack}
              style={({ pressed }) => [
                styles.backButton,
                {
                  backgroundColor: pressed ? theme.colors.action.ghostPressed : theme.colors.background.surface,
                  borderColor: theme.colors.border.subtle,
                  borderRadius: theme.radii.pill,
                },
              ]}
            >
              <Ionicons color={theme.colors.action.primary} name="chevron-back" size={26} />
            </Pressable>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[theme.typography.sectionTitle, styles.detailHeaderTitle, { color: theme.colors.text.primary }]}
            >
              Takvim Ayrıntısı
            </Text>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.headerSpacer} />
          </View>
        ) : null}

        {feedback}

        {actionError ? (
          <Banner
            message={actionError}
            onDismiss={() => setActionError(undefined)}
            title="İşlem tamamlanamadı"
            tone="error"
          />
        ) : null}

        <Card style={[styles.heroCard, { gap: theme.spacing.sm }]} variant="elevated">
          <View style={[styles.heroLayout, { gap: theme.spacing.sm }]}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.heroAccent,
                { backgroundColor: accentColor, borderRadius: theme.radii.pill },
              ]}
            />
            <View style={[styles.heroContent, { gap: theme.spacing.sm }]}>
              <View style={[styles.classification, {
                backgroundColor: theme.colors.background.subtle,
                borderColor: accentColor,
                borderRadius: theme.radii.pill,
                gap: theme.spacing.xs,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: theme.spacing.xs,
              }]}>
                <Ionicons color={accentColor} name={item.icon} size={20} />
                <Text style={[theme.typography.metaStrong, styles.classificationLabel, { color: accentColor }]}>{item.classificationLabel}</Text>
              </View>
              <Text accessibilityRole="header" style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}>{item.title}</Text>
            </View>
          </View>
        </Card>

        <Card style={[styles.detailCard, { gap: theme.spacing.sm }]} variant="elevated">
          <View style={[styles.infoHeading, { gap: theme.spacing.sm }]}>
            <Text accessibilityRole="header" style={[theme.typography.sectionTitle, styles.flexOne, { color: theme.colors.text.primary }]}>Etkinlik bilgileri</Text>
            {academicYear && item.source === "academic" ? (
              <View style={[styles.yearBadge, { backgroundColor: theme.colors.background.subtle, borderRadius: theme.radii.pill }]}>
                <Text style={[theme.typography.metaStrong, { color: theme.colors.text.secondary }]}>{academicYear}</Text>
              </View>
            ) : null}
          </View>

          <CalendarInfoRow
            accentColor={accentColor}
            detail={semanticTime}
            icon={dateOnly ? "calendar-outline" : "time-outline"}
            label="Tarih ve saat"
            value={formatCalendarTemporal(item)}
          />
          <View style={[styles.infoDivider, { backgroundColor: theme.colors.border.subtle }]} />
          <CalendarInfoRow
            accentColor={accentColor}
            icon="layers-outline"
            label="Kapsam"
            value={scopeLabel}
          />
          <View style={[styles.infoDivider, { backgroundColor: theme.colors.border.subtle }]} />
          <CalendarInfoRow
            accentColor={accentColor}
            accessibilityLabel={officialSourceUrl
              ? `${item.sourceLabel}. ${officialSourceDomain}. Resmî takvim kaynağını aç.`
              : undefined}
            detail={item.source === "personal"
              ? "Yalnızca bu hesaptaki kişisel planda saklanır"
              : officialSourceDomain ?? "Bağlantı paylaşılmamış"}
            icon="school-outline"
            label="Kaynak"
            onPress={officialSourceUrl && onOpenOfficialSource
              ? () => void onOpenOfficialSource(officialSourceUrl)
              : undefined}
            value={item.sourceLabel}
          />
          {item.location ? (
            <>
              <View style={[styles.infoDivider, { backgroundColor: theme.colors.border.subtle }]} />
              <CalendarInfoRow
                accentColor={accentColor}
                icon="location-outline"
                label="Konum / not"
                value={item.location}
              />
            </>
          ) : null}
        </Card>

        {item.source === "personal" ? (
          <View
            style={[
              styles.actions,
              {
                backgroundColor: theme.colors.background.surface,
                borderColor: theme.colors.border.subtle,
                borderRadius: theme.radii.prominent,
                gap: theme.spacing.sm,
                padding: theme.spacing.sm,
              },
            ]}
          >
            <Button
              aria-expanded={editing}
              fullWidth
              label="Kişisel etkinliği düzenle"
              onPress={() => setEditing(true)}
              ref={editExamRef}
            />
            <Button
              fullWidth
              label="Kişisel etkinliği sil"
              onPress={confirmDelete}
              variant="danger"
            />
          </View>
        ) : null}
      </ScrollView>

      {item.source === "personal" ? (
        <PersonalExamEditor
          exam={{
            id: item.id,
            title: item.title,
            examDate: item.startDate,
            ...(item.location ? { locationNote: item.location } : {}),
            ...(item.personalKind ? { kind: item.personalKind } : {}),
            ...(item.reminderMinutesBefore !== undefined ? { reminderMinutesBefore: item.reminderMinutesBefore } : {}),
          }}
          onDismiss={() => setEditing(false)}
          onSubmit={(input) => onUpdatePersonalExam(item.id, input)}
          returnFocusRef={editExamRef}
          visible={editing}
        />
      ) : null}
    </>
  );
}

function CalendarInfoRow({
  accentColor,
  accessibilityLabel,
  detail,
  icon,
  label,
  onPress,
  value,
}: {
  accentColor: string;
  accessibilityLabel?: string;
  detail?: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  value: string;
}) {
  const theme = useTheme();
  const content = (
    <>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.infoIcon,
          {
            backgroundColor: theme.colors.action.secondary,
            borderRadius: theme.radii.control,
          },
        ]}
      >
        <Ionicons color={accentColor} name={icon} size={20} />
      </View>
      <View style={[styles.flexOne, { gap: theme.spacing.xxs }]}>
        <Text style={[theme.typography.metaStrong, { color: theme.colors.text.secondary }]}>{label}</Text>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>{value}</Text>
        {detail ? (
          <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>{detail}</Text>
        ) : null}
      </View>
      {onPress ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Ionicons color={theme.colors.text.link} name="open-outline" size={20} />
        </View>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="link"
        onPress={onPress}
        style={({ pressed }) => [
          styles.infoRow,
          pressed && { backgroundColor: theme.colors.action.ghostPressed },
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={styles.infoRow}>{content}</View>;
}

function calendarScopeLabel(
  item: CalendarItem,
  context: {
    universityName?: string;
    facultyName?: string;
    departmentName?: string;
  },
): string {
  if (item.source === "personal") return "Kişisel plan";
  if (item.departmentId) return context.departmentName
    ? `Bölüm · ${context.departmentName}`
    : "Bölüm";
  if (item.facultyId) return context.facultyName
    ? `Fakülte · ${context.facultyName}`
    : "Fakülte";
  return context.universityName
    ? `${context.universityName} · Üniversite geneli`
    : "Üniversite geneli";
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return "Resmî kaynak";
  }
}

function classificationColor(
  classification: CalendarClassification,
  colors: ReturnType<typeof useTheme>["colors"],
): string {
  switch (classification) {
    case "personal_exam": return colors.action.primary;
    case "personal": return colors.accent.teal;
    case "exam": return colors.status.error;
    case "registration": return colors.status.warning;
    case "holiday": return colors.status.success;
    case "academic": return colors.status.info;
  }
}

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    maxWidth: 720,
    width: "100%",
  },
  detailHeader: {
    alignItems: "center",
    alignSelf: "stretch",
    flexDirection: "row",
    minHeight: 56,
  },
  backButton: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  detailHeaderTitle: {
    flex: 1,
    minWidth: 0,
    textAlign: "center",
  },
  headerSpacer: {
    height: 48,
    width: 48,
  },
  classification: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    flexDirection: "row",
    flexShrink: 1,
    maxWidth: "100%",
  },
  classificationLabel: {
    flexShrink: 1,
    minWidth: 0,
  },
  heroCard: {
    alignSelf: "stretch",
  },
  heroLayout: {
    alignItems: "stretch",
    flexDirection: "row",
  },
  heroAccent: {
    alignSelf: "stretch",
    minHeight: 88,
    width: 4,
  },
  heroContent: {
    flex: 1,
    minWidth: 0,
  },
  detailCard: {
    alignSelf: "stretch",
  },
  infoHeading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  infoDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 52,
  },
  infoIcon: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  infoRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 56,
    minWidth: 0,
    paddingVertical: 5,
  },
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  actions: {
    alignSelf: "stretch",
    borderWidth: StyleSheet.hairlineWidth,
  },
  yearBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});
