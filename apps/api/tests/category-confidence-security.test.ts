import { describe, expect, it } from "vitest";
import { mapAcademicEventCategory } from "../src/domain/category-mapper.js";
import { calculateConfidenceScore } from "../src/domain/confidence-score.js";
import { sanitizeQueryValue } from "../src/security/query-sanitizer.js";

describe("mapAcademicEventCategory", () => {
  it("maps academic Turkish phrases to canonical categories", () => {
    expect(mapAcademicEventCategory("Ders kayıt tarihleri")).toBe("course_registration");
    expect(mapAcademicEventCategory("Ara sınav haftası")).toBe("midterm_exam");
    expect(mapAcademicEventCategory("Final sınavları")).toBe("final_exam");
    expect(mapAcademicEventCategory("Bütünleme sınavları")).toBe("makeup_exam");
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
