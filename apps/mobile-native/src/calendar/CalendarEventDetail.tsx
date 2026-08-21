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
      ? "Tüm gün süren tarih aralığı · son gün dahildir · saat bilgisi verilmemiştir"
      : "Tüm gün · kaynakta saat bilgisi verilmemiştir"
    : "Saat, kaynakta belirtilen gerçek zaman bilgisidir";
  const academicContext = [universityName, facultyName, departmentName].filter(Boolean).join(" · ");
  const accentColor = classificationColor(item.classification, theme.colors);

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
          <View style={[styles.cardHeading, { gap: theme.spacing.sm }]}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.cardIcon,
                {
                  backgroundColor: theme.colors.action.secondary,
                  borderRadius: theme.radii.control,
                },
              ]}
            >
              <Ionicons color={accentColor} name={dateOnly ? "calendar-outline" : "time-outline"} size={21} />
            </View>
            <View style={[styles.flexOne, { gap: theme.spacing.xxs }]}>
              <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>Tarih ve zaman</Text>
              <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>{formatCalendarTemporal(item)}</Text>
            </View>
          </View>
          <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>{semanticTime}</Text>
        </Card>

        <Card style={[styles.detailCard, { gap: theme.spacing.sm }]} variant="elevated">
          <View style={[styles.cardHeading, { gap: theme.spacing.sm }]}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.cardIcon,
                {
                  backgroundColor: theme.colors.action.secondary,
                  borderRadius: theme.radii.control,
                },
              ]}
            >
              <Ionicons color={accentColor} name="school-outline" size={21} />
            </View>
            <Text accessibilityRole="header" style={[theme.typography.sectionTitle, styles.flexOne, { color: theme.colors.text.primary }]}>Kaynak ve kapsam</Text>
          </View>
          <View style={{ gap: theme.spacing.xs }}>
            <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>{item.sourceLabel}</Text>
            <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>
              {item.source === "personal"
                ? "Bu kayıt yalnızca açık hesabın cihaz planında saklanır."
                : academicContext || "Üniversite akademik kapsamı"}
            </Text>
            {academicYear && item.source === "academic" ? (
              <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Akademik yıl: {academicYear}</Text>
            ) : null}
            <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Tür: {item.classificationLabel}</Text>
            {item.location ? (
              <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Konum / not: {item.location}</Text>
            ) : null}
            <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Kayıt kimliği: {item.id}</Text>
          </View>
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
  cardHeading: {
    alignItems: "center",
    flexDirection: "row",
  },
  cardIcon: {
    alignItems: "center",
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  actions: {
    alignSelf: "stretch",
    borderWidth: StyleSheet.hairlineWidth,
  },
});
