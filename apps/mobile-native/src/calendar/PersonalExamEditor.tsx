import { useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  Banner,
  BottomSheet,
  Button,
  TextField,
  useTheme,
} from "../design-system";
import {
  applyDateSelection,
  applyTimeSelection,
  composePersonalExamTimestamp,
  emptyPersonalExamDraft,
  formatSelectedDate,
  formatSelectedTime,
  personalExamDraftFromRecord,
  selectionDateFromDraft,
  validatePersonalExamDraft,
  type CalendarPersonalExam,
  type PersonalExamDraft,
  type PersonalExamDraftErrors,
} from "./calendar-model";
import { NativeDateTimePicker } from "./NativeDateTimePicker";
import type {
  PersonalExamMutationInput,
  PersonalExamMutationResult,
} from "./personal-exam-runtime";

export type {
  PersonalExamMutationInput,
  PersonalExamMutationResult,
} from "./personal-exam-runtime";

export interface PersonalExamEditorProps {
  visible: boolean;
  exam?: CalendarPersonalExam | null;
  busy?: boolean;
  onDismiss: () => void;
  onSubmit: (input: PersonalExamMutationInput) => PersonalExamMutationResult;
}

export function PersonalExamEditor({
  visible,
  exam,
  busy = false,
  onDismiss,
  onSubmit,
}: PersonalExamEditorProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState<PersonalExamDraft>(emptyPersonalExamDraft);
  const [errors, setErrors] = useState<PersonalExamDraftErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pickerMode, setPickerMode] = useState<"date" | "time" | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDraft(exam ? personalExamDraftFromRecord(exam) : emptyPersonalExamDraft());
    setErrors({});
    setFormError(undefined);
    setPickerMode(null);
  }, [exam?.examDate, exam?.id, exam?.title, visible]);

  const pickerValue = useMemo(() => selectionDateFromDraft(draft), [draft]);

  const submit = () => {
    const nextErrors = validatePersonalExamDraft(draft);
    setErrors(nextErrors);
    setFormError(undefined);
    if (Object.keys(nextErrors).length > 0) return;
    const examDate = composePersonalExamTimestamp(draft);
    if (!examDate) {
      setFormError("Tarih ve saat birlikte doğrulanamadı. Sistem seçicilerini yeniden kullan.");
      return;
    }
    const result = onSubmit({ title: draft.title.trim(), examDate });
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    onDismiss();
  };

  return (
    <BottomSheet
      accessibilityLabel={exam ? "Kişisel sınav düzenleme alt sayfası" : "Kişisel sınav ekleme alt sayfası"}
      dismissible={!busy}
      loading={busy}
      onDismiss={onDismiss}
      title={exam ? "Kişisel sınavı düzenle" : "Kişisel sınav ekle"}
      visible={visible}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { gap: theme.spacing.md }]}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>
          Tarih ve saat yalnızca cihazın sistem seçicileriyle belirlenir.
        </Text>

        {formError ? (
          <Banner
            message={formError}
            onDismiss={() => setFormError(undefined)}
            title="Sınav kaydedilemedi"
            tone="error"
          />
        ) : null}

        <TextField
          autoCapitalize="sentences"
          error={errors.title}
          label="Sınav adı"
          maxLength={160}
          onChangeText={(title) => {
            setDraft((current) => ({ ...current, title }));
            setErrors((current) => ({ ...current, title: undefined }));
          }}
          placeholder="Örn. Lineer Cebir finali"
          returnKeyType="done"
          value={draft.title}
        />

        <View style={[styles.selectionGroup, { gap: theme.spacing.xs }]}>
          <Text style={[theme.typography.label, { color: theme.colors.text.primary }]}>Sınav tarihi</Text>
          <Button
            accessibilityHint="Cihazın sistem tarih seçicisini açar."
            aria-invalid={Boolean(errors.date)}
            label={formatSelectedDate(draft.date)}
            onPress={() => setPickerMode("date")}
            variant="secondary"
          />
          {errors.date ? (
            <Text accessibilityRole="alert" style={[theme.typography.meta, { color: theme.colors.status.error }]}>
              {errors.date}
            </Text>
          ) : null}
        </View>

        <View style={[styles.selectionGroup, { gap: theme.spacing.xs }]}>
          <Text style={[theme.typography.label, { color: theme.colors.text.primary }]}>Sınav saati</Text>
          <Button
            accessibilityHint="Cihazın sistem saat seçicisini açar."
            aria-invalid={Boolean(errors.time)}
            label={formatSelectedTime(draft.time)}
            onPress={() => setPickerMode("time")}
            variant="secondary"
          />
          {errors.time ? (
            <Text accessibilityRole="alert" style={[theme.typography.meta, { color: theme.colors.status.error }]}>
              {errors.time}
            </Text>
          ) : null}
        </View>

        {pickerMode ? (
          <View
            accessibilityLabel={`${pickerMode === "date" ? "Tarih" : "Saat"} seçici açık`}
            accessibilityState={{ expanded: true }}
            style={[styles.picker, {
              backgroundColor: theme.colors.background.subtle,
              borderColor: theme.colors.border.default,
              borderRadius: theme.radii.control,
              gap: theme.spacing.sm,
              padding: theme.spacing.sm,
            }]}
          >
            <NativeDateTimePicker
              mode={pickerMode}
              onDismiss={() => setPickerMode(null)}
              onSelect={(selected) => {
                setDraft((current) => pickerMode === "date"
                  ? applyDateSelection(current, selected)
                  : applyTimeSelection(current, selected));
                setErrors((current) => ({
                  ...current,
                  ...(pickerMode === "date" ? { date: undefined } : { time: undefined }),
                }));
              }}
              value={pickerValue}
            />
            {Platform.OS === "ios" ? (
              <Button
                compact
                label="Seçimi tamamla"
                onPress={() => setPickerMode(null)}
                variant="ghost"
              />
            ) : null}
          </View>
        ) : null}

        <View style={[styles.actions, { gap: theme.spacing.sm }]}>
          <Button
            disabled={busy}
            fullWidth
            label={exam ? "Değişiklikleri kaydet" : "Sınavı ekle"}
            loading={busy}
            onPress={submit}
          />
          <Button
            disabled={busy}
            fullWidth
            label="Vazgeç"
            onPress={onDismiss}
            variant="ghost"
          />
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 24,
  },
  selectionGroup: {
    alignSelf: "stretch",
  },
  picker: {
    alignSelf: "stretch",
    borderWidth: 1,
  },
  actions: {
    alignSelf: "stretch",
  },
});
