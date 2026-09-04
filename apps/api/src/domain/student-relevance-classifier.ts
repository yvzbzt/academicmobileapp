export const STUDENT_RELEVANCE_CLASSIFICATION_VERSION = "student-relevance-rules-v1" as const;

export type StudentRelevance = "relevant" | "not_relevant" | "uncertain";

export type StudentContentTopic =
  | "academic_calendar"
  | "course_registration"
  | "exam"
  | "scholarship"
  | "internship"
  | "exchange"
  | "graduation"
  | "tuition"
  | "housing"
  | "student_event"
  | "personnel_recruitment"
  | "procurement"
  | "internal_operations"
  | "unknown";

export type StudentAudience =
  | "all_students"
  | "prospective_students"
  | "associate_students"
  | "bachelor_students"
  | "master_students"
  | "doctoral_students"
  | "graduates";

export type StudentActionType =
  | "apply"
  | "attend"
  | "pay"
  | "register"
  | "review"
  | "submit"
  | "unknown";

export type StudentContentUrgency = "critical" | "high" | "normal" | "unknown";

export type StudentEvidenceTargetField =
  | "studentRelevance"
  | "topic"
  | "audience"
  | "actionType"
  | "deadline"
  | "urgency";

export type StudentEvidenceSourceField =
  | "title"
  | "summary"
  | "body"
  | `keyDates[${number}].label`
  | `keyDates[${number}].value`;

/** A half-open range into the named, unmodified source field. */
export interface StudentEvidenceSpan {
  targetField: StudentEvidenceTargetField;
  sourceField: StudentEvidenceSourceField;
  start: number;
  end: number;
  text: string;
  ruleId: string;
}

export interface StudentContentKeyDate {
  /** The label exactly as supplied by the source adapter. */
  label: string;
  /** The date value exactly as supplied by the source adapter. */
  value: string;
}

export interface ClassifyStudentRelevanceInput {
  title: string;
  summary?: string;
  body?: string;
  /** Dates extracted by the source adapter; this classifier never creates dates. */
  keyDates?: readonly StudentContentKeyDate[];
}

/**
 * Optional enrichment that callers may attach to an existing content record.
 * It deliberately contains no source ownership, trust, publication, or visibility decision.
 */
export interface StudentRelevanceMetadata {
  studentRelevance: StudentRelevance;
  topic: StudentContentTopic;
  audience: readonly StudentAudience[] | "unknown";
  actionType: StudentActionType;
  deadline: string | "unknown";
  urgency: StudentContentUrgency;
  evidenceSpans: readonly StudentEvidenceSpan[];
  classificationVersion: typeof STUDENT_RELEVANCE_CLASSIFICATION_VERSION;
}

export interface StudentRelevanceAuditCounts {
  total: number;
  relevant: number;
  not_relevant: number;
  uncertain: number;
}

interface TextField {
  sourceField: "title" | "summary" | "body";
  text: string;
}

interface Rule<T> {
  value: T;
  ruleId: string;
  pattern: RegExp;
}

interface LocatedMatch {
  sourceField: StudentEvidenceSourceField;
  start: number;
  end: number;
  text: string;
  ruleId: string;
}

const exclusionRules: readonly Rule<Exclude<StudentContentTopic, "unknown">>[] = [
  {
    value: "personnel_recruitment",
    ruleId: "exclusion.personnel-recruitment",
    pattern: /(?:akademik|idari|s[oö]zle[sş]meli)\s+personel\s+al[ıi]m[ıi]?|personel\s+al[ıi]m\s+ilan[ıi]|(?:[oö][gğ]retim\s+(?:[uü]yesi|eleman[ıi])|i[sş][cç]i|memur)\s+al[ıi]m\s+ilan[ıi]|kadro\s+ilan[ıi]|g[oö]revde\s+y[uü]kselme/iu
  },
  {
    value: "procurement",
    ruleId: "exclusion.procurement",
    pattern: /(?:[iİ]hale\s+ilan[ıi]|sat[ıi]n\s+alma\s+ilan[ıi]|do[gğ]rudan\s+temin|(?:mal|hizmet)\s+al[ıi]m[ıi]|yap[ıi]m\s+i[sş]i|4734\s+say[ıi]l[ıi])/iu
  },
  {
    value: "internal_operations",
    ruleId: "exclusion.internal-operations",
    pattern: /(?:kurum|birim|personel)\s+i[cç]i|y[oö]netim\s+kurulu\s+karar[ıi]|senato\s+karar[ıi]|resm[iî]\s+yaz[ıi][sş]ma|ta[sş][ıi]n[ıi]r\s+(?:kay[ıi]t|i[sş]lemi)|harcama\s+yetkilisi/iu
  }
];

const topicRules: readonly Rule<Exclude<StudentContentTopic, "personnel_recruitment" | "procurement" | "internal_operations" | "unknown">>[] = [
  { value: "course_registration", ruleId: "topic.course-registration-label", pattern: /(?:ders\s+kay(?:i|\u0131)t(?:lar(?:i|\u0131))?|kay(?:i|\u0131)t\s+yenileme)/iu },
  { value: "exam", ruleId: "topic.exam-label", pattern: /(?:vize|final|b(?:u|\u00fc)t(?:u|\u00fc)nleme)\s+s(?:i|\u0131)nav(?:i|\u0131)?/iu },
  { value: "course_registration", ruleId: "topic.course-registration", pattern: /(?:ders\s+(?:kayd[ıi]|se[cç]imi)|kay[ıi]t\s+yenileme|ders\s+ekle(?:me)?\s*[/-]?\s*b[ıi]rak(?:ma)?)/iu },
  { value: "exam", ruleId: "topic.exam", pattern: /(?:s[ıi]nav\s+(?:program[ıi]|takvimi|sonu[cç]lar[ıi])|vize\s+program[ıi]|final\s+program[ıi]|b[uü]t[uü]nleme\s+s[ıi]nav[ıi])/iu },
  { value: "scholarship", ruleId: "topic.scholarship", pattern: /(?:[oö][gğ]renci\s+bursu|burs\s+ba[sş]vurusu|maddi\s+destek\s+ba[sş]vurusu)/iu },
  { value: "internship", ruleId: "topic.internship", pattern: /(?:staj\s+(?:ba[sş]vurusu|duyurusu|takvimi)|i[sş]yeri\s+e[gğ]itimi)/iu },
  { value: "exchange", ruleId: "topic.exchange", pattern: /(?:erasmus|farabi|mevlana)\s+(?:ba[sş]vurusu|program[ıi]|de[gğ]i[sş]im)/iu },
  { value: "graduation", ruleId: "topic.graduation", pattern: /(?:mezuniyet\s+(?:ba[sş]vurusu|t[oö]reni|i[sş]lemleri)|diploma\s+teslimi)/iu },
  { value: "tuition", ruleId: "topic.tuition", pattern: /(?:[oö][gğ]renim\s+[uü]creti|katk[ıi]\s+pay[ıi]|har[cç]\s+[oö]deme)/iu },
  { value: "housing", ruleId: "topic.housing", pattern: /(?:[oö][gğ]renci\s+yurdu|yurt\s+ba[sş]vurusu|bar[ıi]nma\s+deste[gğ]i)/iu },
  { value: "academic_calendar", ruleId: "topic.academic-calendar", pattern: /(?:akademik\s+takvim|e[gğ]itim\s+[oö][gğ]retim\s+takvimi)/iu },
  { value: "student_event", ruleId: "topic.student-event", pattern: /(?:[oö][gğ]renci(?:lere|lerimize)?\s+y[oö]nelik\s+(?:seminer|konferans|panel|at[oö]lye|s[oö]yle[sş]i)|[oö][gğ]renci\s+kul[uü]b[uü]\s+etkinli[gğ]i)/iu }
];

const audienceRules: readonly Rule<StudentAudience>[] = [
  { value: "all_students", ruleId: "audience.all-students", pattern: /(?:t[uü]m\s+[oö][gğ]renciler|[oö][gğ]rencilerimizin\s+dikkatine)/iu },
  { value: "prospective_students", ruleId: "audience.prospective-students", pattern: /aday\s+[oö][gğ]renciler/iu },
  { value: "associate_students", ruleId: "audience.associate-students", pattern: /[oö]n\s*lisans\s+[oö][gğ]rencileri/iu },
  { value: "master_students", ruleId: "audience.master-students", pattern: /y[uü]ksek\s+lisans\s+[oö][gğ]rencileri/iu },
  { value: "doctoral_students", ruleId: "audience.doctoral-students", pattern: /doktora\s+[oö][gğ]rencileri/iu },
  { value: "bachelor_students", ruleId: "audience.bachelor-students", pattern: /(?<![oö]n\s)(?<!y[uü]ksek\s)lisans\s+[oö][gğ]rencileri/iu },
  { value: "graduates", ruleId: "audience.graduates", pattern: /mezunlar(?:[ıi]m[ıi]z)?/iu }
];

const actionRules: readonly Rule<Exclude<StudentActionType, "unknown">>[] = [
  { value: "register", ruleId: "action.register-label", pattern: /(?:ders\s+kay(?:i|\u0131)t(?:lar(?:i|\u0131))?|kay(?:i|\u0131)t\s+yenileme)/iu },
  { value: "register", ruleId: "action.register", pattern: /(?:ders\s+kayd[ıi]|ders\s+se[cç]imi|kay[ıi]t\s+yenileme|kay[ıi]t\s+yapt[ıi]r)/iu },
  { value: "apply", ruleId: "action.apply", pattern: /ba[sş]vur(?:u|ular|mak)/iu },
  { value: "pay", ruleId: "action.pay", pattern: /(?:[oö]deme\s+yap|[uü]cret(?:in)?\s+[oö]de|har[cç]\s+yat[ıi]r)/iu },
  { value: "submit", ruleId: "action.submit", pattern: /(?:belge|form|dilek[cç]e)\s+(?:teslim\s+et|y[uü]kle|g[oö]nder)/iu },
  { value: "attend", ruleId: "action.attend", pattern: /(?:kat[ıi]l[ıi]m|kat[ıi]lmak|davetlisiniz)/iu },
  { value: "review", ruleId: "action.review", pattern: /(?:sonu[cç]lar[ıi]\s+incele|listeyi\s+kontrol|ilan\s+edildi)/iu }
];

const urgencyRules: readonly Rule<Exclude<StudentContentUrgency, "normal" | "unknown">>[] = [
  { value: "critical", ruleId: "urgency.critical", pattern: /(?:acil|ivedi)/iu },
  { value: "high", ruleId: "urgency.high", pattern: /(?:son\s+g[uü]n|s[uü]re\s+uzat[ıi]m[ıi]|[oö]nemli\s+hat[ıi]rlatma)/iu }
];

const explicitDeadlineLabelPattern = /(?:son\s+(?:ba[sş]vuru|kay[ıi]t|teslim|[oö]deme|g[uü]n|tarih)|(?:ba[sş]vuru|kay[ıi]t|teslim|[oö]deme)\s+(?:i[cç]in\s+)?son\s+tarih|deadline)/iu;

/** Pure, deterministic, rules-only shadow classification. */
export function classifyStudentRelevance(input: ClassifyStudentRelevanceInput): StudentRelevanceMetadata {
  const fields = textFields(input);
  const evidence: StudentEvidenceSpan[] = [];

  const excluded = firstRuleMatch(fields, exclusionRules);
  const topicMatch = excluded ?? firstRuleMatch(fields, topicRules);
  const audienceMatches = allRuleMatches(fields, audienceRules);
  const actionMatch = firstRuleMatch(fields, actionRules);
  const urgencyMatch = firstRuleMatch(fields, urgencyRules);
  const deadlineMatch = explicitDeadline(input.keyDates ?? []);

  const studentRelevance: StudentRelevance = excluded
    ? "not_relevant"
    : topicMatch || audienceMatches.length > 0
      ? "relevant"
      : "uncertain";

  if (excluded) {
    evidence.push(toEvidence("studentRelevance", excluded));
  } else if (topicMatch) {
    evidence.push(toEvidence("studentRelevance", topicMatch));
  } else if (audienceMatches[0]) {
    evidence.push(toEvidence("studentRelevance", audienceMatches[0]));
  }

  if (topicMatch) {
    evidence.push(toEvidence("topic", topicMatch));
  }
  for (const audienceMatch of audienceMatches) {
    evidence.push(toEvidence("audience", audienceMatch));
  }
  if (actionMatch) {
    evidence.push(toEvidence("actionType", actionMatch));
  }
  if (deadlineMatch) {
    evidence.push(toEvidence("deadline", deadlineMatch.labelEvidence));
    evidence.push(toEvidence("deadline", deadlineMatch.valueEvidence));
  }
  if (urgencyMatch) {
    evidence.push(toEvidence("urgency", urgencyMatch));
  }

  return {
    studentRelevance,
    topic: topicMatch?.value ?? "unknown",
    audience: audienceMatches.length > 0
      ? [...new Set(audienceMatches.map((match) => match.value))]
      : "unknown",
    actionType: actionMatch?.value ?? "unknown",
    deadline: deadlineMatch?.value ?? "unknown",
    urgency: urgencyMatch?.value ?? "unknown",
    evidenceSpans: sortEvidence(evidence),
    classificationVersion: STUDENT_RELEVANCE_CLASSIFICATION_VERSION
  };
}

/** Aggregates shadow-mode outcomes without changing feed ordering or visibility. */
export function summarizeStudentRelevanceAudit(
  classifications: readonly Pick<StudentRelevanceMetadata, "studentRelevance">[]
): StudentRelevanceAuditCounts {
  const counts: StudentRelevanceAuditCounts = {
    total: classifications.length,
    relevant: 0,
    not_relevant: 0,
    uncertain: 0
  };

  for (const classification of classifications) {
    counts[classification.studentRelevance] += 1;
  }

  return counts;
}

function textFields(input: ClassifyStudentRelevanceInput): TextField[] {
  return [
    { sourceField: "title", text: input.title },
    { sourceField: "summary", text: input.summary ?? "" },
    { sourceField: "body", text: input.body ?? "" }
  ];
}

function firstRuleMatch<T>(fields: readonly TextField[], rules: readonly Rule<T>[]): (LocatedMatch & { value: T }) | undefined {
  for (const rule of rules) {
    for (const field of fields) {
      const match = matchPattern(field, rule.pattern, rule.ruleId);
      if (match) {
        return { ...match, value: rule.value };
      }
    }
  }
  return undefined;
}

function allRuleMatches<T>(fields: readonly TextField[], rules: readonly Rule<T>[]): Array<LocatedMatch & { value: T }> {
  const matches: Array<LocatedMatch & { value: T }> = [];
  for (const rule of rules) {
    for (const field of fields) {
      const match = matchPattern(field, rule.pattern, rule.ruleId);
      if (match) {
        matches.push({ ...match, value: rule.value });
        break;
      }
    }
  }
  return matches;
}

function matchPattern(field: TextField, pattern: RegExp, ruleId: string): LocatedMatch | undefined {
  pattern.lastIndex = 0;
  const match = pattern.exec(field.text);
  if (!match || match.index < 0 || match[0].length === 0) {
    return undefined;
  }
  return {
    sourceField: field.sourceField,
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
    ruleId
  };
}

function explicitDeadline(keyDates: readonly StudentContentKeyDate[]): {
  value: string;
  labelEvidence: LocatedMatch;
  valueEvidence: LocatedMatch;
} | undefined {
  for (let index = 0; index < keyDates.length; index += 1) {
    const keyDate = keyDates[index]!;
    explicitDeadlineLabelPattern.lastIndex = 0;
    const labelMatch = explicitDeadlineLabelPattern.exec(keyDate.label);
    const value = keyDate.value.trim();
    if (!labelMatch || !isValidSourceDate(value)) {
      continue;
    }

    const valueStart = keyDate.value.indexOf(value);
    return {
      value,
      labelEvidence: {
        sourceField: `keyDates[${index}].label`,
        start: labelMatch.index,
        end: labelMatch.index + labelMatch[0].length,
        text: labelMatch[0],
        ruleId: "deadline.explicit-label"
      },
      valueEvidence: {
        sourceField: `keyDates[${index}].value`,
        start: valueStart,
        end: valueStart + value.length,
        text: value,
        ruleId: "deadline.explicit-value"
      }
    };
  }
  return undefined;
}

function isValidSourceDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000
    && year <= 2100
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function toEvidence(targetField: StudentEvidenceTargetField, match: LocatedMatch): StudentEvidenceSpan {
  return {
    targetField,
    sourceField: match.sourceField,
    start: match.start,
    end: match.end,
    text: match.text,
    ruleId: match.ruleId
  };
}

function sortEvidence(evidence: readonly StudentEvidenceSpan[]): StudentEvidenceSpan[] {
  return [...evidence].sort((left, right) => (
    left.sourceField.localeCompare(right.sourceField)
    || left.start - right.start
    || left.end - right.end
    || left.targetField.localeCompare(right.targetField)
    || left.ruleId.localeCompare(right.ruleId)
  ));
}
