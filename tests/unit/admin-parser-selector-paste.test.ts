import { describe, expect, it } from "vitest";
import { parseSelectorBlock } from "../../apps/admin/src/parser-selector-fields";

describe("bulk selector paste", () => {
  it("accepts JSON and fenced JSON with explicit empty fields", () => {
    const fields = { itemSelector: "table > tbody > tr", titleSelector: "td:first-child > a", contentSelector: "" };
    expect(parseSelectorBlock(JSON.stringify(fields))).toEqual(fields);
    expect(parseSelectorBlock(`\`\`\`json\n${JSON.stringify(fields)}\n\`\`\``)).toEqual(fields);
  });
  it("accepts the copied Turkish table and preserves CSS punctuation", () => {
    expect(parseSelectorBlock("| Alan | Değer |\n|---|---|\n| Liste öğesi | `table > tbody > tr` |\n| Başlık | `td:first-child > a` |\n| Yayın tarihi | `td:nth-child(2)` |\n| Özet / gövde | Boş bırak |")).toEqual({
      itemSelector: "table > tbody > tr", titleSelector: "td:first-child > a", dateSelector: "td:nth-child(2)", contentSelector: ""
    });
    expect(parseSelectorBlock("Liste öğesi\t.row\nBaşlık\ttd:first-child > a")).toEqual({ itemSelector: ".row", titleSelector: "td:first-child > a" });
    expect(parseSelectorBlock("itemSelector: .row\ntitleSelector: td:first-child > a")).toEqual({ itemSelector: ".row", titleSelector: "td:first-child > a" });
  });
  it("leaves ordinary single CSS paste alone", () => {
    expect(parseSelectorBlock("main#mainContent table > tbody > tr")).toBeNull();
  });
  it("rejects malformed or unsafe values atomically", () => {
    for (const value of ['{"itemSelector":', '{"itemSelector":".row","unknown":"x"}', '{"itemSelector":123}', '{"__proto__":{}}', '{}', JSON.stringify({ itemSelector: "x".repeat(301) })]) {
      expect(() => parseSelectorBlock(value)).toThrow();
    }
  });
});
