import {
  contrastRatio,
  lightTheme,
  referencePalette,
  typography,
} from "../../src/design-system/tokens";

describe("reference design tokens", () => {
  it("publishes the supplied palette without mutating its brand swatches", () => {
    expect(referencePalette).toEqual(expect.objectContaining({
      blue: "#2563EB",
      teal: "#14B8A6",
      orange: "#F97316",
      yellow: "#EAB308",
      slate: "#64748B",
      mist: "#F1F5F9",
      navy: "#0B1739",
      white: "#FFFFFF",
    }));
    expect(lightTheme.colors.accent).toMatchObject({
      blue: referencePalette.blue,
      teal: referencePalette.teal,
      orange: referencePalette.orange,
      yellow: referencePalette.yellow,
    });
    expect(lightTheme.colors.background.subtle).toBe(referencePalette.mist);
    expect(lightTheme.colors.text.primary).toBe(referencePalette.navy);
  });

  it("uses contrast-safe foreground variants for text roles", () => {
    const textColors = [
      lightTheme.colors.text.primary,
      lightTheme.colors.text.secondary,
      lightTheme.colors.accent.blueText,
      lightTheme.colors.accent.tealText,
      lightTheme.colors.accent.orangeText,
      lightTheme.colors.accent.yellowText,
    ];
    for (const color of textColors) {
      expect(contrastRatio(color, referencePalette.white)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses the native platform typeface throughout the text hierarchy", () => {
    expect(Object.values(typography).every((token) => !("fontFamily" in token))).toBe(true);
  });
});
