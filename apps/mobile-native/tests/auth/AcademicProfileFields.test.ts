import {
  filterAcademicOptions,
  normalizeAcademicSearch,
} from "../../src/academic/AcademicProfileFields";

const universities = [
  { value: "agu", label: "ABDULLAH GÜL ÜNİVERSİTESİ", supportingText: "Kayseri" },
  { value: "acibadem", label: "Acıbadem Mehmet Ali Aydınlar Üniversitesi", supportingText: "İstanbul" },
] as const;

describe("academic option search", () => {
  it("matches Turkish labels when the query omits diacritics", () => {
    expect(filterAcademicOptions(universities, "abdullah gul universitesi")).toEqual([
      universities[0],
    ]);
    expect(filterAcademicOptions(universities, "acibadem istanbul")).toEqual([
      universities[1],
    ]);
  });

  it("normalizes dotted and dotless i consistently", () => {
    expect(normalizeAcademicSearch("İSTANBUL IĞDIR")).toBe("istanbul igdir");
  });
});
