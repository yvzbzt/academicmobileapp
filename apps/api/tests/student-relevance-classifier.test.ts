import { describe, expect, it } from "vitest";
import {
  STUDENT_RELEVANCE_CLASSIFICATION_VERSION,
  classifyStudentRelevance,
  summarizeStudentRelevanceAudit,
  type ClassifyStudentRelevanceInput,
  type StudentEvidenceSpan
} from "../src/domain/student-relevance-classifier.js";

describe("student relevance classifier", () => {
  it("produces evidence-backed student metadata without needing university context", () => {
    const input: ClassifyStudentRelevanceInput = {
      title: "Tüm öğrenciler için ders kaydı duyurusu",
      body: "Ders kaydı yaptırın. Önemli hatırlatma.",
      keyDates: [{ label: "Başvuru son tarihi", value: "  2026-09-18  " }]
    };

    const result = classifyStudentRelevance(input);

    expect(result).toMatchObject({
      studentRelevance: "relevant",
      topic: "course_registration",
      audience: ["all_students"],
      actionType: "register",
      deadline: "2026-09-18",
      urgency: "high",
      classificationVersion: STUDENT_RELEVANCE_CLASSIFICATION_VERSION
    });
    expect(result.evidenceSpans.length).toBeGreaterThan(0);
    expectEvidenceToBeExactAndBounded(input, result.evidenceSpans);
  });

  it.each([
    {
      title: "Öğrencilerimizin dikkatine: Sözleşmeli personel alım ilanı",
      topic: "personnel_recruitment"
    },
    {
      title: "2026 yılı ihale ilanı ve mal alımı",
      topic: "procurement"
    },
    {
      title: "Yönetim kurulu kararı hakkında kurum içi duyuru",
      topic: "internal_operations"
    }
  ])("gives exclusion rules precedence for $topic", ({ title, topic }) => {
    const result = classifyStudentRelevance({
      title,
      body: "Tüm öğrenciler başvuru yapabilir."
    });

    expect(result.studentRelevance).toBe("not_relevant");
    expect(result.topic).toBe(topic);
    expect(result.evidenceSpans).toContainEqual(expect.objectContaining({
      targetField: "studentRelevance",
      ruleId: expect.stringMatching(/^exclusion\./)
    }));
  });

  it("does not invent audience, deadline, topic, or urgency from an ordinary date", () => {
    const input: ClassifyStudentRelevanceInput = {
      title: "Kampüs bilgilendirmesi",
      body: "Etkinlik 12.10.2026 tarihinde yapılacaktır.",
      keyDates: [{ label: "Etkinlik tarihi", value: "2026-10-12" }]
    };

    expect(classifyStudentRelevance(input)).toStrictEqual({
      studentRelevance: "uncertain",
      topic: "unknown",
      audience: "unknown",
      actionType: "unknown",
      deadline: "unknown",
      urgency: "unknown",
      evidenceSpans: [],
      classificationVersion: STUDENT_RELEVANCE_CLASSIFICATION_VERSION
    });
  });

  it("accepts a deadline only from a non-empty key date explicitly labeled as a deadline", () => {
    const withoutDeadlineLabel = classifyStudentRelevance({
      title: "Burs başvurusu",
      keyDates: [{ label: "İlan tarihi", value: "2026-09-01" }]
    });
    const withDeadlineLabel = classifyStudentRelevance({
      title: "Burs başvurusu",
      keyDates: [
        { label: "Son başvuru tarihi", value: "   " },
        { label: "Başvuru için son tarih", value: "2026-09-30" }
      ]
    });

    expect(withoutDeadlineLabel.deadline).toBe("unknown");
    expect(withoutDeadlineLabel.evidenceSpans.some((span) => span.targetField === "deadline")).toBe(false);
    expect(withDeadlineLabel.deadline).toBe("2026-09-30");
    expect(withDeadlineLabel.evidenceSpans.filter((span) => span.targetField === "deadline"))
      .toHaveLength(2);
    expect(classifyStudentRelevance({
      title: "Burs basvurusu",
      keyDates: [{ label: "Son basvuru tarihi", value: "2026-02-31" }]
    }).deadline).toBe("unknown");
  });

  it("is deterministic and summarizes shadow classifications without a visibility decision", () => {
    const inputs: ClassifyStudentRelevanceInput[] = [
      { title: "Final sınav programı" },
      { title: "İhale ilanı" },
      { title: "Rektörlük bilgilendirmesi" },
      { title: "Ders seçimi başladı" }
    ];
    const first = inputs.map(classifyStudentRelevance);
    const second = inputs.map(classifyStudentRelevance);

    expect(second).toStrictEqual(first);
    expect(summarizeStudentRelevanceAudit(first)).toStrictEqual({
      total: 4,
      relevant: 2,
      not_relevant: 1,
      uncertain: 1
    });
  });
});

function expectEvidenceToBeExactAndBounded(
  input: ClassifyStudentRelevanceInput,
  evidenceSpans: readonly StudentEvidenceSpan[]
): void {
  for (const span of evidenceSpans) {
    const source = sourceText(input, span.sourceField);
    expect(span.start).toBeGreaterThanOrEqual(0);
    expect(span.end).toBeGreaterThan(span.start);
    expect(span.end).toBeLessThanOrEqual(source.length);
    expect(source.slice(span.start, span.end)).toBe(span.text);
  }
}

function sourceText(input: ClassifyStudentRelevanceInput, sourceField: StudentEvidenceSpan["sourceField"]): string {
  if (sourceField === "title") {
    return input.title;
  }
  if (sourceField === "summary") {
    return input.summary ?? "";
  }
  if (sourceField === "body") {
    return input.body ?? "";
  }

  const match = /^keyDates\[(\d+)]\.(label|value)$/.exec(sourceField);
  if (!match) {
    throw new Error(`Unknown evidence source field: ${sourceField}`);
  }
  const keyDate = input.keyDates?.[Number(match[1])];
  if (!keyDate) {
    throw new Error(`Missing key date for evidence source field: ${sourceField}`);
  }
  return keyDate[match[2] as "label" | "value"];
}
