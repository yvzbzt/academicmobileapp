import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
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
  validationAttempt?: number;
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
    <View style={[styles.fieldsStack, { gap: theme.spacing.md }]}>
      <SelectorSearch
        disabled={props.busy}
        error={props.universitiesError}
        label="Üniversite ara"
        loading={props.universitiesLoading}
        onQueryChange={setUniversityQuery}
        onRetry={props.onRetryUniversities}
        onValueChange={props.onUniversityChange}
        options={filteredUniversities}
        placeholder="Üniversite ara veya seç"
        query={universityQuery}
        requiredError={props.universityRequiredError}
        validationAttempt={props.validationAttempt}
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
        placeholder="Fakülte ara veya seç"
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
        placeholder="Bölüm ara veya seç"
        query={departmentQuery}
        selectorLabel="Bölüm"
        value={props.draft.departmentId || null}
      />

      <View style={styles.selectorGroup}>
        <SelectField
          disabled={props.busy || !props.draft.departmentId}
          emptyLabel="Önce bölüm seç."
          inlineLabel
          label="Sınıf"
          leadingAccessory={<AcademicFieldIcon icon="school-outline" tone="navy" />}
          onValueChange={(value) => props.onClassLevelChange(Number(value) as AcademicClassLevel)}
          options={classOptions}
          placeholder="Sınıf seç"
          value={props.draft.classLevel === null ? null : String(props.draft.classLevel)}
          visualLabel="Sınıf  ·  Opsiyonel"
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
    </View>
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
    <Card
      accessibilityLabel="Akademik seçim özeti"
      style={[
        styles.reviewCard,
        {
          backgroundColor: theme.colors.background.surface,
          borderColor: theme.colors.border.subtle,
          borderRadius: theme.radii.prominent,
          gap: theme.spacing.sm,
        },
      ]}
      variant="tonal"
    >
      <View style={[styles.reviewHeading, { gap: theme.spacing.sm }]}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.reviewHeadingIcon,
            {
              backgroundColor: theme.colors.action.primary,
              borderRadius: theme.radii.card,
            },
          ]}
        >
          <Ionicons color={theme.colors.action.onPrimary} name="list-outline" size={18} />
        </View>
        <View style={[styles.reviewHeadingCopy, { gap: theme.spacing.xxs }]}>
          <Text accessibilityRole="header" style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>Seçilen bilgiler</Text>
        </View>
      </View>
      <View style={[styles.reviewPills, { gap: theme.spacing.xs }]}>
        {rows.map(([label, value], index) => (
          <View
            key={label}
            style={[
              styles.reviewPill,
              {
                backgroundColor: index === 0
                  ? theme.colors.action.secondary
                  : theme.colors.background.subtle,
                borderColor: theme.colors.border.subtle,
                borderRadius: theme.radii.pill,
                gap: theme.spacing.xs,
              },
            ]}
          >
            {index === 0 ? <Ionicons color={theme.colors.action.primary} name="school-outline" size={16} /> : null}
            <Text
              style={[
                theme.typography.metaStrong,
                styles.reviewPillText,
                { color: index === 0 ? theme.colors.text.link : theme.colors.text.secondary },
              ]}
            >
              {value === "Seçilmedi" ? `${label} seçilmedi` : value}
            </Text>
            {value !== "Seçilmedi" ? <Ionicons color={theme.colors.status.success} name="checkmark-circle" size={14} /> : null}
          </View>
        ))}
      </View>
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
  validationAttempt?: number;
  disabled?: boolean;
  onQueryChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onRetry: () => void;
  onClear?: () => void;
}

function SelectorSearch(props: SelectorSearchProps) {
  const theme = useTheme();
  const presentation = selectorPresentation(props.selectorLabel);
  return (
    <View
      style={[
        styles.selectorGroup,
        {
          gap: theme.spacing.xs,
        },
      ]}
    >
      <SelectField
        disabled={props.disabled}
        emptyLabel={props.query ? "Aramana uygun sonuç bulunamadı." : "Kullanılabilir seçenek yok."}
        error={props.requiredError ?? props.error}
        focusOnError={Boolean(props.requiredError)}
        focusOnErrorKey={props.validationAttempt}
        inlineLabel
        label={props.selectorLabel}
        leadingAccessory={<AcademicFieldIcon icon={presentation.icon} tone={props.selectorLabel === "Üniversite" ? "blue" : "navy"} />}
        loading={props.loading}
        onValueChange={props.onValueChange}
        onSearchValueChange={props.onQueryChange}
        options={props.options}
        placeholder={props.placeholder}
        searchLabel={props.label}
        searchValue={props.query}
        value={props.value}
        visualLabel={`${props.selectorLabel}  ·  ${props.selectorLabel === "Üniversite" ? "Zorunlu" : "Opsiyonel"}`}
      />
      {props.error || props.onClear ? (
        <View style={[styles.selectorActions, { gap: theme.spacing.xs }]}>
          {props.error ? <Button compact disabled={props.disabled} label="Seçenekleri tekrar yükle" onPress={props.onRetry} variant="secondary" /> : null}
          {props.onClear ? <Button compact disabled={props.disabled} label={`${props.selectorLabel} seçimini temizle`} onPress={props.onClear} variant="ghost" /> : null}
        </View>
      ) : null}
    </View>
  );
}

function AcademicFieldIcon({
  icon,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: "blue" | "navy";
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.academicFieldIcon,
        {
          backgroundColor: theme.colors.action.secondary,
          borderRadius: theme.radii.control,
        },
      ]}
    >
      <Ionicons
        color={tone === "blue" ? theme.colors.action.primary : theme.colors.text.secondary}
        name={icon}
        size={22}
      />
    </View>
  );
}

function selectorPresentation(selectorLabel: string): {
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
} {
  if (selectorLabel === "Üniversite") {
    return { description: "Akademik takvim ve duyuru kapsamın için üniversiteni seç.", icon: "school-outline" };
  }
  if (selectorLabel === "Fakülte") {
    return { description: "İstersen fakülte kapsamını ekle.", icon: "business-outline" };
  }
  return { description: "İstersen bölüm kapsamını ekle.", icon: "book-outline" };
}

export function filterAcademicOptions(
  options: readonly AcademicOption[],
  query: string,
): AcademicOption[] {
  const normalized = normalizeAcademicSearch(query);
  if (!normalized) return [...options];
  const searchTerms = normalized.split(/\s+/).filter(Boolean);
  return options.filter((option) => {
    const searchableText = normalizeAcademicSearch(
      `${option.label} ${option.supportingText ?? ""}`,
    );
    return searchTerms.every((term) => searchableText.includes(term));
  });
}

export function normalizeAcademicSearch(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i");
}

function optionLabel(options: readonly AcademicOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? "Seçilmedi";
}

const styles = StyleSheet.create({
  fieldsStack: {
    gap: 10,
    width: "100%",
  },
  reviewCard: {
  },
  reviewHeading: {
    alignItems: "center",
    flexDirection: "row",
    minWidth: 0,
  },
  reviewHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  reviewHeadingIcon: {
    alignItems: "center",
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  reviewPills: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  reviewPill: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    maxWidth: "100%",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  reviewPillText: {
    flexShrink: 1,
  },
  academicFieldIcon: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  selectorActions: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  selectorGroup: {
    width: "100%",
  },
});
