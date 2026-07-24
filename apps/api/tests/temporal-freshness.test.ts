import { describe, expect, it } from "vitest";
import { currentAcademicYear, isFreshAcademicContent } from "../src/domain/temporal-freshness.js";

describe("temporal freshness policy", () => {
  const now = new Date("2026-07-03T00:00:00.000Z");

  it("uses the active July 2026 academic year window", () => {
    expect(currentAcademicYear(now)).toBe("2026-2027");
  });

  it("rejects stale 2022-2024 academic artifacts and keeps current-year content", () => {
    expect(isFreshAcademicContent({
      title: "2022-2023 Bahar Donemi Formasyon Final Programi",
      url: "https://www.agri.edu.tr/upload/formasyon-2023.pdf",
      now
    })).toEqual(expect.objectContaining({ accepted: false, reason: "stale_academic_year" }));

    expect(isFreshAcademicContent({
      title: "2024 Sinav Programi",
      url: "https://www.agri.edu.tr/upload/sinav-programi-2024.pdf",
      now
    })).toEqual(expect.objectContaining({ accepted: false, reason: "stale_year" }));

    expect(isFreshAcademicContent({
      title: "2024_2025 Egitim Ogretim Yili Yaz Okulu",
      url: "https://example.edu.tr/2024_2025_yaz_okulu.pdf",
      now
    })).toEqual(expect.objectContaining({ accepted: false, reason: "stale_academic_year" }));

    expect(isFreshAcademicContent({
      title: "20252026 Akademik Takvim",
      url: "https://www.agri.edu.tr/upload/2025-2026-akademik-takvim.pdf",
      now
    })).toEqual(expect.objectContaining({ accepted: true, reason: "current_academic_year" }));
  });
});
