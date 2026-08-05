import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  SearchField,
  SelectField,
  useTheme,
  type SelectFieldOption,
} from "../design-system";
import type {
  AcademicClassLevel,
  AcademicOnboardingDraft,
} from "../auth/auth-ui";

export interface AcademicOption {
  value: string;
  label: string;
  supportingText?: string;
}

export interface AcademicProfileFieldsProps {
  draft: AcademicOnboardingDraft;
  universities: readonly AcademicOption[];
  faculties: readonly AcademicOption[];
  departments: readonly AcademicOption[];
  classLevels: readonly { value: AcademicClassLevel; label: string }[];
  universitiesLoading: boolean;
  facultiesLoading: boolean;
  departmentsLoading: boolean;
  universitiesError?: string;
  facultiesError?: string;
  departmentsError?: string;
  busy: boolean;
  universityRequiredError?: string;
  onUniversityChange: (value: string) => void;
  onFacultyChange: (value: string | null) => void;
  onDepartmentChange: (value: string | null) => void;
  onClassLevelChange: (value: AcademicClassLevel | null) => void;
  onRetryUniversities: () => void;
  onRetryFaculties: () => void;
  onRetryDepartments: () => void;
  showReview?: boolean;
}

/**
 * Shared academic hierarchy fields. Callers retain ownership of the draft and
 * apply the cascade helpers from auth-ui when a parent selection changes.
 */
export function AcademicProfileFields({
  showReview = true,
  ...props
}: AcademicProfileFieldsProps) {
  const theme = useTheme();
  const [universityQuery, setUniversityQuery] = useState("");
  const [facultyQuery, setFacultyQuery] = useState("");
  const [departmentQuery, setDepartmentQuery] = useState("");
  const filteredUniversities = useMemo(
    () => filterAcademicOptions(props.universities, universityQuery),
    [props.universities, universityQuery],
  );
  const filteredFaculties = useMemo(
    () => filterAcademicOptions(props.faculties, facultyQuery),
    [props.faculties, facultyQuery],
  );
  const filteredDepartments = useMemo(
    () => filterAcademicOptions(props.departments, departmentQuery),
    [props.departments, departmentQuery],
  );
  const classOptions: SelectFieldOption[] = props.classLevels.map((option) => ({
    value: String(option.value),
    label: option.label,
  }));

  useEffect(() => setFacultyQuery(""), [props.draft.universityId]);
  useEffect(() => setDepartmentQuery(""), [props.draft.facultyId]);

  return (
    <>
      <SelectorSearch
        disabled={props.busy}
        error={props.universitiesError}
        label="Üniversite ara"
        loading={props.universitiesLoading}
        onQueryChange={setUniversityQuery}
        onRetry={props.onRetryUniversities}
        onValueChange={props.onUniversityChange}
        options={filteredUniversities}
        placeholder="Üniversiteni seç"
        query={universityQuery}
        requiredError={props.universityRequiredError}
        selectorLabel="Üniversite"
        value={props.draft.universityId || null}
      />

      <SelectorSearch
        disabled={props.busy || !props.draft.universityId}
        error={props.facultiesError}
        label="Fakülte ara"
        loading={props.facultiesLoading}
        onClear={props.draft.facultyId ? () => props.onFacultyChange(null) : undefined}
        onQueryChange={setFacultyQuery}
        onRetry={props.onRetryFaculties}
        onValueChange={props.onFacultyChange}
        options={filteredFaculties}
        placeholder="İsteğe bağlı"
        query={facultyQuery}
        selectorLabel="Fakülte"
        value={props.draft.facultyId || null}
      />

      <SelectorSearch
        disabled={props.busy || !props.draft.facultyId}
        error={props.departmentsError}
        label="Bölüm ara"
        loading={props.departmentsLoading}
        onClear={props.draft.departmentId ? () => props.onDepartmentChange(null) : undefined}
        onQueryChange={setDepartmentQuery}
        onRetry={props.onRetryDepartments}
        onValueChange={props.onDepartmentChange}
        options={filteredDepartments}
        placeholder="İsteğe bağlı"
        query={departmentQuery}
        selectorLabel="Bölüm"
        value={props.draft.departmentId || null}
      />

      <View style={{ gap: theme.spacing.xs }}>
        <SelectField
          disabled={props.busy || !props.draft.departmentId}
          emptyLabel="Önce bölüm seç."
          label="Sınıf"
          onValueChange={(value) => props.onClassLevelChange(Number(value) as AcademicClassLevel)}
          options={classOptions}
          placeholder="İsteğe bağlı"
          supportingText="Bölümünü seçtiğinde uygun sınıflar gösterilir."
          value={props.draft.classLevel === null ? null : String(props.draft.classLevel)}
        />
        {props.draft.classLevel !== null ? (
          <Button compact disabled={props.busy} label="Sınıf seçimini temizle" onPress={() => props.onClassLevelChange(null)} variant="ghost" />
        ) : null}
      </View>

      {showReview ? (
        <AcademicProfileReview
          classLevels={props.classLevels}
          departments={props.departments}
          draft={props.draft}
          faculties={props.faculties}
          universities={props.universities}
        />
      ) : null}
    </>
  );
}

export function AcademicProfileReview(props: {
  draft: AcademicOnboardingDraft;
  universities: readonly AcademicOption[];
  faculties: readonly AcademicOption[];
  departments: readonly AcademicOption[];
  classLevels: readonly { value: AcademicClassLevel; label: string }[];
}) {
  const theme = useTheme();
  const rows = [
    ["Üniversite", optionLabel(props.universities, props.draft.universityId)],
    ["Fakülte", optionLabel(props.faculties, props.draft.facultyId)],
    ["Bölüm", optionLabel(props.departments, props.draft.departmentId)],
    ["Sınıf", props.classLevels.find((item) => item.value === props.draft.classLevel)?.label ?? "Seçilmedi"],
  ];
  return (
    <Card accessibilityLabel="Akademik seçim özeti" style={{ gap: theme.spacing.sm }} variant="tonal">
      <Text accessibilityRole="header" style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>Seçim özeti</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={[styles.reviewRow, { gap: theme.spacing.sm }]}>
          <Text style={[theme.typography.meta, styles.reviewKey, { color: theme.colors.text.secondary }]}>{label}</Text>
          <Text style={[theme.typography.bodyStrong, styles.reviewValue, { color: theme.colors.text.primary }]}>{value}</Text>
        </View>
      ))}
    </Card>
  );
}

interface SelectorSearchProps {
  label: string;
  selectorLabel: string;
  query: string;
  options: readonly AcademicOption[];
  value: string | null;
  placeholder: string;
  loading: boolean;
  error?: string;
  requiredError?: string;
  disabled?: boolean;
  onQueryChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onRetry: () => void;
  onClear?: () => void;
}

function SelectorSearch(props: SelectorSearchProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <SearchField
        disabled={props.disabled || props.loading}
        label={props.label}
        onChangeText={props.onQueryChange}
        placeholder="Ada göre ara"
        value={props.query}
      />
      <SelectField
        disabled={props.disabled}
        emptyLabel={props.query ? "Aramana uygun sonuç bulunamadı." : "Kullanılabilir seçenek yok."}
        error={props.requiredError ?? props.error}
        label={props.selectorLabel}
        loading={props.loading}
        onValueChange={props.onValueChange}
        options={props.options}
        placeholder={props.placeholder}
        value={props.value}
      />
      {props.error ? <Button compact disabled={props.disabled} label="Seçenekleri tekrar yükle" onPress={props.onRetry} variant="secondary" /> : null}
      {props.onClear ? <Button compact disabled={props.disabled} label={`${props.selectorLabel} seçimini temizle`} onPress={props.onClear} variant="ghost" /> : null}
    </View>
  );
}

export function filterAcademicOptions(
  options: readonly AcademicOption[],
  query: string,
): AcademicOption[] {
  const normalized = query.trim().toLocaleLowerCase("tr-TR");
  if (!normalized) return [...options];
  return options.filter((option) => `${option.label} ${option.supportingText ?? ""}`.toLocaleLowerCase("tr-TR").includes(normalized));
}

function optionLabel(options: readonly AcademicOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? "Seçilmedi";
}

const styles = StyleSheet.create({
  reviewRow: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  reviewKey: {
    flexBasis: 90,
    flexShrink: 0,
  },
  reviewValue: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
  },
});
