import { describe, expect, it } from "vitest";
import { groupCoverageItems } from "../../apps/admin/src/source-coverage-groups";

const item = (id: string, overrides = {}) => ({
  id, universityId: "agu", universityName: "Abdullah Gül Üniversitesi",
  facultyId: "engineering", facultyName: "Mühendislik Fakültesi",
  scopeId: "computer", scopeType: "department" as const, scopeName: "Bilgisayar Mühendisliği", ...overrides
});

describe("source coverage page grouping", () => {
  it("collects multiple source types under one department without dropping records", () => {
    const records = [item("announcement"), item("news"), item("exam")];
    const [university] = groupCoverageItems(records);
    expect(university.count).toBe(3);
    expect(university.faculties).toHaveLength(1);
    expect(university.faculties[0].departments).toHaveLength(1);
    expect(university.faculties[0].departments[0].items).toEqual(records);
  });
  it("keeps faculty-wide records separate from departments and equally named faculties separate by ID", () => {
    const records = [item("faculty", { scopeId: "engineering", scopeType: "faculty" }), item("computer"),
      item("second-faculty", { facultyId: "engineering-2", scopeId: "computer-2" }),
      item("other-university", { universityId: "selcuk", universityName: "Selçuk Üniversitesi" })];
    const groups = groupCoverageItems(records);
    expect(groups.map((group) => [group.id, group.count])).toEqual([["agu", 3], ["selcuk", 1]]);
    expect(groups[0].faculties.map((group) => [group.id, group.count])).toEqual([["engineering", 2], ["engineering-2", 1]]);
    expect(groups[0].faculties[0].items.map((record) => record.id)).toEqual(["faculty"]);
    expect(groups[0].faculties[0].departments[0].items.map((record) => record.id)).toEqual(["computer"]);
  });
  it("returns no group for an empty page and only counts the supplied page", () => {
    expect(groupCoverageItems([])).toEqual([]);
    expect(groupCoverageItems([item("one")])[0].count).toBe(1);
  });
});
