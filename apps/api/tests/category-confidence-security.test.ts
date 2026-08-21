import { describe, expect, it } from "vitest";
import { mapAcademicEventCategory } from "../src/domain/category-mapper.js";
import { calculateConfidenceScore } from "../src/domain/confidence-score.js";
import { sanitizeQueryValue } from "../src/security/query-sanitizer.js";

describe("mapAcademicEventCategory", () => {
  it("maps academic Turkish phrases to canonical categories", () => {
    expect(mapAcademicEventCategory("Ders kayıt tarihleri")).toBe("course_registration");
    expect(mapAcademicEventCategory("Haftalık ders programı")).toBe("course_schedule");
    expect(mapAcademicEventCategory("Bölüm sınav programı")).toBe("department_exam_schedule");
    expect(mapAcademicEventCategory("Ara sınav haftası")).toBe("midterm_exam");
    expect(mapAcademicEventCategory("Final sınavları")).toBe("final_exam");
    expect(mapAcademicEventCategory("Bütünleme sınavları")).toBe("makeup_exam");
    expect(mapAcademicEventCategory("Yaz Okulu başvuru ve ders seçimi")).toBe("summer_school_registration");
  });

  it.each([
    ["Lisansüstü Programlara Yatay Geçiş Başvuruları", "horizontal_transfer"],
    ["Lisans Programlarına Çift Anadal ve Yan Dal Kayıtları", "course_registration"],
    ["Azami Süreyi Dolduran Öğrenciler için Ek Sınavlar", "department_exam_schedule"],
    ["Yeni Kayıt Uluslararası Öğrenciler için İngilizce Hazırlık Sınıfı Yeterlik ve Seviye Tespit Sınavı (İMS)", "department_exam_schedule"],
    ["Yaz Okulu başvurularının alınması", "summer_school_registration"],
    ["Mezuniyet başvurularının alınması", "graduation_application"],
    ["Staj başvuruları", "course_registration"],
    ["Sınav başvuruları", "course_registration"],
    ["Final sınavı başvuruları", "course_registration"],
    ["Başvuru sınavı", "department_exam_schedule"],
  ] as const)("classifies production-style title %s as %s", (title, expected) => {
    expect(mapAcademicEventCategory(title)).toBe(expected);
  });

  it.each([
    "Başvuru sonuçlarının ilanı",
    "Final sınavı sonuçları",
    "Kayıt yenileme duyurusu",
    "2026 yılında kayıtlı öğrenciler için bilgilendirme",
    "Yaz okulu başvurularının sonuçları",
    "Yatay geçiş başvurularının sonuçları",
  ])("does not turn informational title %s into an actionable category", (title) => {
    expect(mapAcademicEventCategory(title)).toBe("custom_event");
  });

  it("does not confuse Turkish application stems with term starts", () => {
    expect(mapAcademicEventCategory("Güz dönemi başvuruları")).toBe("course_registration");
    expect(mapAcademicEventCategory("Güz dönemi başlangıcı")).toBe("fall_term_start");
  });

  it("falls back to custom_event for unknown university-specific events", () => {
    expect(mapAcademicEventCategory("Senato özel etkinliği")).toBe("custom_event");
  });
});

describe("calculateConfidenceScore", () => {
  it("returns high band for clear extracted events", () => {
    const result = calculateConfidenceScore({
      dateClarity: 100,
      titleClarity: 95,
      categoryClarity: 95,
      ocrQuality: 100,
      tableRowQuality: 95,
      academicYearClarity: 90,
      scopeClarity: 90,
      duplicateRisk: 0,
      sourcePageClarity: 100
    });

    expect(result.band).toBe("high");
    expect(result.reviewRequired).toBe(false);
  });

  it("forces review for low quality OCR and duplicate risk", () => {
    const result = calculateConfidenceScore({
      dateClarity: 60,
      titleClarity: 50,
      categoryClarity: 50,
      ocrQuality: 20,
      tableRowQuality: 30,
      academicYearClarity: 40,
      scopeClarity: 50,
      duplicateRisk: 90,
      sourcePageClarity: 70
    });

    expect(result.reviewRequired).toBe(true);
    expect(result.score).toBeLessThan(60);
  });
});

describe("sanitizeQueryValue", () => {
  it("removes MongoDB operator and dotted keys from user input", () => {
    const sanitized = sanitizeQueryValue({
      email: { $ne: null },
      "profile.role": "super_admin",
      name: "Student",
      nested: { $where: "return true", city: "Ankara" }
    });

    expect(sanitized).toEqual({ name: "Student", nested: { city: "Ankara" } });
  });
});
