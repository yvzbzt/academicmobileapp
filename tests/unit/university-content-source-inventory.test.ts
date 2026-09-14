import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inventory = readJson("../../apps/api/src/bootstrap/university-content-source-inventory.json") as {
  schemaVersion: number;
  summary: { universities: number; sourceSlots: number };
  universities: Array<{
    universityId: string;
    authority: { status: "verified" | "quarantined"; homepageUrl?: string; domains: string[] };
    slots: Array<{
      contentType: string;
      sourceUrl?: string;
      candidateUrl?: string;
      status: "candidate_found" | "needs_review" | "authority_unavailable";
      evidenceStatus: "final_revalidated" | "not_attached";
      verificationEvidence?: unknown;
      parser: string;
      siteStructure: { description: string; detectedFormat: string; extractionMode: string; selectorHints: Record<string, string[]> };
    }>;
  }>;
};
const catalog = readJson("../../apps/api/src/bootstrap/turkiye-catalog-seed.json") as {
  universities: Array<{ slug: string }>;
};
const expectedContentTypes = ["academic_calendar", "announcement", "event", "news"];

describe("208-university content source inventory", () => {
  it("represents every catalog university with four editable source slots without inventing verified evidence", () => {
    expect(inventory.schemaVersion).toBe(1);
    expect(inventory.summary).toMatchObject({ universities: 208, sourceSlots: 832 });
    expect(inventory.universities.map(({ universityId }) => universityId).sort())
      .toEqual(catalog.universities.map(({ slug }) => slug).sort());

    for (const university of inventory.universities) {
      expect(university.slots.map(({ contentType }) => contentType).sort()).toEqual(expectedContentTypes);
      for (const slot of university.slots) {
        expect(slot.parser).toBe("auto");
        expect(slot.siteStructure.description).toBeTruthy();
        expect(slot.siteStructure.selectorHints.link).toBeTruthy();
        if (slot.status === "candidate_found") {
          expect(slot.sourceUrl).toMatch(/^https:\/\//u);
          const hostname = new URL(slot.sourceUrl!).hostname;
          expect(university.authority.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))).toBe(true);
        }
        if (slot.status === "needs_review") {
          expect(slot.sourceUrl).toBeUndefined();
          expect(slot.candidateUrl).toBe(university.authority.homepageUrl);
        }
        if (slot.status === "authority_unavailable") {
          expect(slot.sourceUrl).toBeUndefined();
          expect(slot.candidateUrl).toBeUndefined();
        }
        expect(Boolean(slot.verificationEvidence)).toBe(slot.evidenceStatus === "final_revalidated");
      }
    }
  });

  it("shows feed and JSON API sources with their actual extraction flow", () => {
    const afsu = inventory.universities.find(({ universityId }) => universityId === "afyonkarahisar-saglik-bilimleri-universitesi");
    const atlas = inventory.universities.find(({ universityId }) => universityId === "istanbul-atlas-universitesi");
    const tnku = inventory.universities.find(({ universityId }) => universityId === "tekirdag-namik-kemal-universitesi");

    expect(afsu?.slots.find(({ contentType }) => contentType === "announcement")?.siteStructure)
      .toMatchObject({ detectedFormat: "feed", extractionMode: "feed_auto" });
    expect(atlas?.slots.find(({ contentType }) => contentType === "news")?.siteStructure)
      .toMatchObject({ detectedFormat: "json", extractionMode: "json_auto" });
    expect(tnku?.slots.find(({ contentType }) => contentType === "event")?.siteStructure)
      .toMatchObject({ detectedFormat: "json", extractionMode: "json_auto" });
  });
});

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown;
}
