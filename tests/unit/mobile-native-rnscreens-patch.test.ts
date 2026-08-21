import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("mobile react-native-screens Android patch", () => {
  it("moves Fabric removal transitions onto the UI thread after install", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(root, "apps/mobile-native/package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const patchScript = readFileSync(
      resolve(root, "apps/mobile-native/scripts/patch-react-native-screens-removal.mjs"),
      "utf8",
    );

    expect(packageJson.scripts?.postinstall).toBe(
      "node ./scripts/patch-react-native-screens-removal.mjs",
    );
    expect(patchScript).toContain("screen.post {");
    expect(patchScript).toContain("screen.startRemovalTransition()");
    expect(patchScript).toContain("if (source.includes(uiThreadBlock)) process.exit(0)");
  });
});
