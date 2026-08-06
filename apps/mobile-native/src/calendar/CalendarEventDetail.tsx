import { Ionicons } from "@expo/vector-icons";
import { useRef, useState, type ReactNode } from "react";
import { Alert, ScrollView, StyleSheet, Text, View, useWindowDimensions, type View as NativeView } from "react-native";
import {
  Banner,
  Button,
  Card,
  ErrorState,
  useTheme,
} from "../design-system";
import { formatAcademicTemporal, isDateOnlyValue } from "../temporal/academic-temporal";
import type { CalendarItem } from "./calendar-model";
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

  const confirmDelete = () => {
    Alert.alert(
      "Kişisel sınavı sil",
      `“${item.title}” yalnızca bu hesaba ait cihaz planından kaldırılacak. Bu işlem Google Takvim'deki kişisel etkinliklere dokunmaz.`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Sınavı sil",
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
        {feedback}

        {actionError ? (
          <Banner
            message={actionError}
            onDismiss={() => setActionError(undefined)}
            title="İşlem tamamlanamadı"
            tone="error"
          />
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          <View style={[styles.classification, {
            backgroundColor: theme.colors.background.subtle,
            borderColor: theme.colors.border.default,
            borderRadius: theme.radii.pill,
            gap: theme.spacing.xs,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.xs,
          }]}>
            <Ionicons color={theme.colors.action.primary} name={item.icon} size={20} />
            <Text style={[theme.typography.metaStrong, { color: theme.colors.text.primary }]}>{item.classificationLabel}</Text>
          </View>
          <Text accessibilityRole="header" style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}>{item.title}</Text>
        </View>

        <Card style={{ gap: theme.spacing.sm }}>
          <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>Tarih ve zaman</Text>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>{formatAcademicTemporal(item)}</Text>
          <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>{semanticTime}</Text>
        </Card>

        <Card style={{ gap: theme.spacing.sm }}>
          <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>Kaynak ve kapsam</Text>
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
            <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Kayıt kimliği: {item.id}</Text>
          </View>
        </Card>

        {item.source === "personal" ? (
          <View style={[styles.actions, { gap: theme.spacing.sm }]}>
            <Button
              aria-expanded={editing}
              fullWidth
              label="Kişisel sınavı düzenle"
              onPress={() => setEditing(true)}
              ref={editExamRef}
              variant="secondary"
            />
            <Button
              fullWidth
              label="Kişisel sınavı sil"
              onPress={confirmDelete}
              variant="danger"
            />
          </View>
        ) : null}
      </ScrollView>

      {item.source === "personal" ? (
        <PersonalExamEditor
          exam={{ id: item.id, title: item.title, examDate: item.startDate }}
          onDismiss={() => setEditing(false)}
          onSubmit={(input) => onUpdatePersonalExam(item.id, input)}
          returnFocusRef={editExamRef}
          visible={editing}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    maxWidth: 720,
    width: "100%",
  },
  classification: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    flexDirection: "row",
    flexShrink: 1,
  },
  actions: {
    alignSelf: "stretch",
  },
});
