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

  it("keeps explicit start and end times", () => {
    const range = normalizeAcademicDate("24.07.2026 09:30 - 25.07.2026 17:45");
    expect(range.startDate).toBe("2026-07-24");
    expect(range.endDate).toBe("2026-07-25");
    expect(range.startTime).toBe("09:30");
    expect(range.endTime).toBe("17:45");

    const sameDay = normalizeAcademicDate("24.07.2026 09:30-11:00");
    expect(sameDay.startTime).toBe("09:30");
    expect(sameDay.endTime).toBe("11:00");
    expect(sameDay.endDate).toBe("2026-07-24");
  });

  it("detects academic year and term expressions", () => {
    expect(normalizeAcademicDate("2026-2027 Akademik Yılı").academicYear).toBe("2026-2027");
    expect(normalizeAcademicDate("Güz Yarıyılı").term).toBe("fall");
    expect(normalizeAcademicDate("Bahar Yarıyılı").term).toBe("spring");
    expect(normalizeAcademicDate("Yaz Okulu").term).toBe("summer");
  });
});
