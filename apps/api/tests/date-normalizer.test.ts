import { describe, expect, it } from "vitest";
import { normalizeAcademicDate } from "../src/domain/date-normalizer.js";

describe("normalizeAcademicDate", () => {
  it("normalizes numeric Turkish date formats", () => {
    expect(normalizeAcademicDate("01.10.2026").startDate).toBe("2026-10-01");
    expect(normalizeAcademicDate("01/10/2026").startDate).toBe("2026-10-01");
    expect(normalizeAcademicDate("01-10-2026").startDate).toBe("2026-10-01");
  });

  it("normalizes textual single date", () => {
    const result = normalizeAcademicDate("1 Ekim 2026");
    expect(result.startDate).toBe("2026-10-01");
    expect(result.datePrecision).toBe("day");
  });

  it("normalizes same-month ranges", () => {
    const result = normalizeAcademicDate("01-05 Ekim 2026");
    expect(result.startDate).toBe("2026-10-01");
    expect(result.endDate).toBe("2026-10-05");
    expect(result.datePrecision).toBe("date_range");
  });

  it("normalizes different-month ranges", () => {
    const result = normalizeAcademicDate("30 Eylül - 04 Ekim 2026");
    expect(result.startDate).toBe("2026-09-30");
    expect(result.endDate).toBe("2026-10-04");
  });

  it("detects academic year and term expressions", () => {
    expect(normalizeAcademicDate("2026-2027 Akademik Yılı").academicYear).toBe("2026-2027");
    expect(normalizeAcademicDate("Güz Yarıyılı").term).toBe("fall");
    expect(normalizeAcademicDate("Bahar Yarıyılı").term).toBe("spring");
    expect(normalizeAcademicDate("Yaz Okulu").term).toBe("summer");
  });
});
