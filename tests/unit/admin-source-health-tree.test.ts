import { describe, expect, it } from "vitest";
import type { AdminSourceHealthAlert, AdminSourceHealthInput } from "../../apps/admin/src/source-health-alerts";
import { buildSourceHealthTree } from "../../apps/admin/src/source-health-tree";

const alert = (sourceId: string, sourceName: string): AdminSourceHealthAlert => ({
  sourceId,
  sourceName,
  universityId: "uni",
  universityName: "Örnek Üniversitesi",
  status: "failed",
  severity: "failed",
  problem: "Kaynağa ulaşılamadı.",
  stale: false
});

describe("admin source health tree", () => {
  it("separates faculties and resolves a legacy department through catalog coverage", () => {
    const sources: AdminSourceHealthInput[] = [{
      id: "engineering-news",
      sourceName: "Mühendislik Haberleri",
      scopeType: "faculty",
      scopeId: "engineering",
      ownerUniversityId: "uni"
    }, {
      id: "computer-news",
      sourceName: "Bilgisayar Duyuruları",
      scopeType: "department",
      scopeId: "computer",
      ownerUniversityId: "uni"
    }, {
      id: "law-news",
      sourceName: "Hukuk Haberleri",
      scopeType: "faculty",
      scopeId: "law",
      ownerUniversityId: "uni"
    }];

    const [university] = buildSourceHealthTree(
      sources.map((source) => alert(source.id, source.sourceName)),
      sources,
      [{ id: "engineering", name: "Mühendislik Fakültesi" }, { id: "law", name: "Hukuk Fakültesi" }],
      [{ id: "computer", name: "Bilgisayar Mühendisliği", facultyId: "engineering" }]
    );

    expect(university?.faculties.map((faculty) => faculty.name)).toEqual(["Hukuk Fakültesi", "Mühendislik Fakültesi"]);
    expect(university?.faculties.find((faculty) => faculty.id === "engineering")?.departments)
      .toEqual([expect.objectContaining({ id: "computer", name: "Bilgisayar Mühendisliği" })]);
  });
});
