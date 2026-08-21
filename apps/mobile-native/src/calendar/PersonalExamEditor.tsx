import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  AccessibilityInfo,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  findNodeHandle,
  useWindowDimensions,
  type TextInput as NativeTextInput,
  type View as NativeView,
} from "react-native";
import {
  Banner,
  BottomSheet,
  Button,
  SelectField,
  referencePalette,
  useTheme,
} from "../design-system";
import {
  applyDateSelection,
  applyTimeSelection,
  composePersonalExamTimestamp,
  emptyPersonalExamDraft,
  formatSelectedDate,
  formatSelectedTime,
  PERSONAL_CALENDAR_KIND_OPTIONS,
  PERSONAL_CALENDAR_REMINDER_OPTIONS,
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
  returnFocusRef?: RefObject<NativeView | null>;
}

export function PersonalExamEditor({
  visible,
  exam,
  busy = false,
  onDismiss,
  onSubmit,
  returnFocusRef,
}: PersonalExamEditorProps) {
  const theme = useTheme();
  const { fontScale, width } = useWindowDimensions();
  const compact = width < 360 || fontScale >= 1.7;
  const [draft, setDraft] = useState<PersonalExamDraft>(emptyPersonalExamDraft);
  const [initialDraft, setInitialDraft] = useState<PersonalExamDraft>(emptyPersonalExamDraft);
  const [errors, setErrors] = useState<PersonalExamDraftErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pickerMode, setPickerMode] = useState<"date" | "time" | null>(null);
  const titleRef = useRef<NativeTextInput | null>(null);
  const dateButtonRef = useRef<NativeView | null>(null);
  const timeButtonRef = useRef<NativeView | null>(null);

  useEffect(() => {
    if (!visible) return;
    const nextDraft = exam ? personalExamDraftFromRecord(exam) : emptyPersonalExamDraft();
    setDraft(nextDraft);
    setInitialDraft(nextDraft);
    setErrors({});
    setFormError(undefined);
    setPickerMode(null);
  }, [exam?.examDate, exam?.id, exam?.kind, exam?.locationNote, exam?.reminderMinutesBefore, exam?.title, visible]);

  const pickerValue = useMemo(() => selectionDateFromDraft(draft), [draft]);
  const hasUnsavedChanges = useMemo(
    () => !personalExamDraftsEqual(draft, initialDraft),
    [draft, initialDraft],
  );

  const requestDismiss = () => {
    if (busy) return;
    if (!hasUnsavedChanges) {
      onDismiss();
      return;
    }
    Alert.alert(
      "Değişiklikler kaydedilmedi",
      "Bu formdaki değişikliklerden vazgeçmek istiyor musun?",
      [
        { text: "Düzenlemeye devam et", style: "cancel" },
        { text: "Değişikliklerden vazgeç", style: "destructive", onPress: onDismiss },
      ],
    );
  };

  const restorePickerFocus = (closingMode: "date" | "time") => {
    setTimeout(() => {
      const target = findNodeHandle(
        closingMode === "date" ? dateButtonRef.current : timeButtonRef.current,
      );
      if (target) AccessibilityInfo.setAccessibilityFocus(target);
    }, 0);
  };

  const submit = () => {
    const nextErrors = validatePersonalExamDraft(draft);
    setErrors(nextErrors);
    setFormError(undefined);
    if (Object.keys(nextErrors).length > 0) {
      setTimeout(() => {
        if (nextErrors.title) {
          titleRef.current?.focus();
          return;
        }
        const target = findNodeHandle(nextErrors.date ? dateButtonRef.current : timeButtonRef.current);
        if (target) AccessibilityInfo.setAccessibilityFocus(target);
      }, 0);
      return;
    }

    const examDate = composePersonalExamTimestamp(draft);
    if (!examDate) {
      setFormError("Tarih ve saat birlikte doğrulanamadı. Sistem seçicilerini yeniden kullan.");
      return;
    }
    const locationNote = (draft.locationNote ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
    const result = onSubmit({
      title: draft.title.trim(),
      examDate,
      ...(locationNote ? { locationNote } : {}),
      kind: draft.kind,
      ...(draft.reminderMinutesBefore !== null ? { reminderMinutesBefore: draft.reminderMinutesBefore } : {}),
    });
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    onDismiss();
  };

  return (
    <BottomSheet
      accessibilityLabel={exam ? "Kişisel etkinlik düzenleme alt sayfası" : "Kişisel etkinlik ekleme alt sayfası"}
      dismissAccessibilityLabel="Kişisel etkinlik formunu kapat"
      dismissible={!busy}
      headerLayout="centered-leading-dismiss"
      loading={busy}
      onDismiss={requestDismiss}
      returnFocusRef={returnFocusRef}
      style={styles.sheet}
      title={exam ? "Kişisel etkinliği düzenle" : "Kişisel etkinlik ekle"}
      visible={visible}
    >
      <View style={styles.editorContent}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { gap: theme.spacing.sm, paddingBottom: theme.spacing.xs },
          ]}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          style={styles.fieldsScroll}
          testID="personal-exam-fields-scroll"
        >
        {formError ? (
          <Banner
            message={formError}
            onDismiss={() => setFormError(undefined)}
            title="Etkinlik kaydedilemedi"
            tone="error"
          />
        ) : null}

        <View
          style={[
            styles.formRow,
            {
              backgroundColor: theme.colors.background.surface,
              borderColor: errors.title ? theme.colors.status.error : theme.colors.border.subtle,
              borderRadius: theme.radii.card,
              minHeight: compact ? 86 : 72,
            },
          ]}
        >
          <FieldIcon color={referencePalette.violet} container={referencePalette.violetSoft} name="book-outline" />
          <View style={[styles.fieldLabel, { width: compact ? 82 : 104 }]}>
            <Text maxFontSizeMultiplier={1.45} style={[theme.typography.label, { color: theme.colors.text.primary }]}>Başlık</Text>
          </View>
          <View style={[styles.fieldDivider, { backgroundColor: theme.colors.border.subtle }]} />
          <TextInput
            accessibilityHint={errors.title}
            accessibilityLabel="Etkinlik adı"
            autoCapitalize="sentences"
            maxLength={160}
            onChangeText={(title) => {
              setDraft((current) => ({ ...current, title }));
              setErrors((current) => ({ ...current, title: undefined }));
            }}
            placeholder="Etkinlik adını yaz"
            placeholderTextColor={theme.colors.text.disabled}
            ref={titleRef}
            returnKeyType="done"
            selectionColor={theme.colors.action.focus}
            style={[theme.typography.body, styles.inlineInput, { color: theme.colors.text.primary }]}
            value={draft.title}
          />
        </View>
        <FieldError message={errors.title} />

        <SelectField
          inlineLabel
          label="Etkinlik türü"
          onValueChange={(kind) => setDraft((current) => ({ ...current, kind }))}
          options={PERSONAL_CALENDAR_KIND_OPTIONS}
          sheetTitle="Etkinlik türü"
          value={draft.kind}
          visualLabel="Tür"
        />

        <Pressable
          ref={dateButtonRef}
          accessibilityHint="Cihazın sistem tarih seçicisini açar."
          accessibilityLabel={formatSelectedDate(draft.date)}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, expanded: pickerMode === "date" }}
          disabled={busy}
          onPress={() => setPickerMode("date")}
          style={({ pressed }) => [
            styles.formRow,
            {
              backgroundColor: pressed ? theme.colors.action.ghostPressed : theme.colors.background.surface,
              borderColor: errors.date ? theme.colors.status.error : theme.colors.border.subtle,
              borderRadius: theme.radii.card,
              minHeight: compact ? 82 : 72,
            },
          ]}
        >
          <FieldIcon color={theme.colors.action.primary} container={theme.colors.action.secondary} name="calendar-outline" />
          <View style={[styles.fieldLabel, { width: compact ? 82 : 104 }]}>
            <Text maxFontSizeMultiplier={1.45} style={[theme.typography.label, { color: theme.colors.text.primary }]}>Tarih</Text>
          </View>
          <View style={[styles.fieldDivider, { backgroundColor: theme.colors.border.subtle }]} />
          <Text maxFontSizeMultiplier={1.45} numberOfLines={compact ? 2 : 1} style={[
            theme.typography.body,
            styles.fieldValue,
            { color: draft.date ? theme.colors.text.primary : theme.colors.text.disabled },
          ]}>{formatSelectedDate(draft.date)}</Text>
          <Ionicons color={theme.colors.action.primary} name="calendar-outline" size={24} />
        </Pressable>
        <FieldError message={errors.date} />

        <Pressable
          ref={timeButtonRef}
          accessibilityHint="Cihazın sistem saat seçicisini açar."
          accessibilityLabel={formatSelectedTime(draft.time)}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, expanded: pickerMode === "time" }}
          disabled={busy}
          onPress={() => setPickerMode("time")}
          style={({ pressed }) => [
            styles.formRow,
            {
              backgroundColor: pressed ? theme.colors.action.ghostPressed : theme.colors.background.surface,
              borderColor: errors.time ? theme.colors.status.error : theme.colors.border.subtle,
              borderRadius: theme.radii.card,
              minHeight: compact ? 82 : 72,
            },
          ]}
        >
          <FieldIcon color={referencePalette.emeraldStrong} container={referencePalette.emeraldContainer} name="time-outline" />
          <View style={[styles.fieldLabel, { width: compact ? 82 : 104 }]}>
            <Text maxFontSizeMultiplier={1.45} style={[theme.typography.label, { color: theme.colors.text.primary }]}>Saat</Text>
          </View>
          <View style={[styles.fieldDivider, { backgroundColor: theme.colors.border.subtle }]} />
          <Text maxFontSizeMultiplier={1.45} style={[
            theme.typography.body,
            styles.fieldValue,
            { color: draft.time ? theme.colors.text.primary : theme.colors.text.disabled },
          ]}>{formatSelectedTime(draft.time)}</Text>
          <Ionicons color={theme.colors.action.primary} name="time-outline" size={24} />
        </Pressable>
        <FieldError message={errors.time} />

        {pickerMode ? (
          <View
            accessibilityLabel={`${pickerMode === "date" ? "Tarih" : "Saat"} seçici açık`}
            accessibilityState={{ expanded: true }}
            style={[
              styles.picker,
              {
                backgroundColor: theme.colors.background.surfaceRaised,
                borderColor: theme.colors.border.focus,
                borderRadius: theme.radii.card,
                gap: theme.spacing.sm,
                padding: theme.spacing.sm,
              },
            ]}
          >
            <NativeDateTimePicker
              mode={pickerMode}
              onDismiss={() => {
                const closingMode = pickerMode;
                setPickerMode(null);
                restorePickerFocus(closingMode);
              }}
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
                onPress={() => {
                  const closingMode = pickerMode;
                  setPickerMode(null);
                  restorePickerFocus(closingMode);
                }}
                variant="ghost"
              />
            ) : null}
          </View>
        ) : null}

        <View
          style={[
            styles.formRow,
            {
              backgroundColor: theme.colors.background.surface,
              borderColor: theme.colors.border.subtle,
              borderRadius: theme.radii.card,
              minHeight: compact ? 104 : 84,
            },
          ]}
        >
          <FieldIcon color={referencePalette.amberStrong} container={referencePalette.amberContainer} name="document-text-outline" />
          <View style={styles.noteContent}>
            <Text maxFontSizeMultiplier={1.4} style={[theme.typography.label, { color: theme.colors.text.primary }]}>Konum / not (isteğe bağlı)</Text>
            <TextInput
              accessibilityLabel="Konum veya not"
              autoCapitalize="sentences"
              maxLength={240}
              multiline
              onChangeText={(locationNote) => setDraft((current) => ({ ...current, locationNote }))}
              placeholder="Örn. D-101 veya kısa not ekleyin"
              placeholderTextColor={theme.colors.text.disabled}
              selectionColor={theme.colors.action.focus}
              style={[theme.typography.body, styles.noteInput, { color: theme.colors.text.primary }]}
              value={draft.locationNote ?? ""}
            />
          </View>
        </View>

        <SelectField
          inlineLabel
          label="Hatırlatma"
          onValueChange={(value) => setDraft((current) => ({
            ...current,
            reminderMinutesBefore: value === "none" ? null : Number(value),
          }))}
          options={PERSONAL_CALENDAR_REMINDER_OPTIONS}
          sheetTitle="Hatırlatma zamanı"
          value={draft.reminderMinutesBefore === null ? "none" : String(draft.reminderMinutesBefore)}
          visualLabel="Hatırlatma"
        />

        </ScrollView>

        <View
          style={[styles.actions, { gap: theme.spacing.sm, marginTop: theme.spacing.sm }]}
          testID="personal-exam-actions"
        >
          <Button
            accessibilityLabel="Vazgeç"
            disabled={busy}
            label="İptal"
            onPress={requestDismiss}
            style={styles.cancelAction}
            variant="secondary"
          />
          <Button
            accessibilityLabel={exam ? "Değişiklikleri kaydet" : "Etkinliği ekle"}
            disabled={busy}
            label="Kaydet"
            loading={busy}
            onPress={submit}
            style={styles.saveAction}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

function personalExamDraftsEqual(left: PersonalExamDraft, right: PersonalExamDraft): boolean {
  return left.title === right.title
    && left.date === right.date
    && left.time === right.time
    && (left.locationNote ?? "") === (right.locationNote ?? "")
    && left.kind === right.kind
    && left.reminderMinutesBefore === right.reminderMinutesBefore;
}

function FieldIcon({
  color,
  container,
  name,
}: {
  color: string;
  container: string;
  name: "book-outline" | "calendar-outline" | "time-outline" | "document-text-outline";
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.iconContainer,
        { backgroundColor: container, borderRadius: theme.radii.control },
      ]}
    >
      <Ionicons color={color} name={name} size={22} />
    </View>
  );
}

function FieldError({ message }: { message?: string }) {
  const theme = useTheme();
  return message ? (
    <Text accessibilityRole="alert" style={[theme.typography.meta, styles.errorText, { color: theme.colors.status.error }]}>
      {message}
    </Text>
  ) : null;
}

const styles = StyleSheet.create({
  sheet: {
    maxHeight: "94%",
  },
  content: {
    alignSelf: "stretch",
  },
  editorContent: {
    flexShrink: 1,
    minHeight: 0,
  },
  fieldsScroll: {
    flexShrink: 1,
    minHeight: 0,
  },
  formRow: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  iconContainer: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  fieldLabel: {
    justifyContent: "center",
  },
  fieldDivider: {
    alignSelf: "stretch",
    width: StyleSheet.hairlineWidth,
  },
  inlineInput: {
    flex: 1,
    minHeight: 48,
    minWidth: 0,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  fieldValue: {
    flex: 1,
    minWidth: 0,
  },
  errorText: {
    marginHorizontal: 12,
    marginTop: -6,
  },
  picker: {
    alignSelf: "stretch",
    borderWidth: 1,
  },
  noteContent: {
    flex: 1,
    minWidth: 0,
  },
  noteInput: {
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: 6,
    textAlignVertical: "top",
  },
  actions: {
    alignItems: "stretch",
    flexDirection: "row",
    flexShrink: 0,
  },
  cancelAction: {
    flex: 1,
  },
  saveAction: {
    flex: 1.35,
  },
});
