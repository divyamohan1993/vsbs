

import {
  darkPalette,
  highContrastPalette,
  lightPalette,
  minTouchTarget,
  paletteFor,
} from "../src/theme/tokens";

describe("theme tokens", () => {
  it("paletteFor returns the correct palette for each mode", () => {
    expect(paletteFor("light")).toBe(lightPalette);
    expect(paletteFor("dark")).toBe(darkPalette);
    expect(paletteFor("high-contrast")).toBe(highContrastPalette);
  });

  it("min-touch-target is the WCAG 2.2 AAA pointer-target size (44pt)", () => {
    expect(minTouchTarget).toBe(44);
  });

  it("high-contrast palette has pure-black background and yellow accent", () => {
    expect(highContrastPalette.background).toBe("#000000");
    expect(highContrastPalette.accent).toBe("#ffe600");
  });

  it("every palette declares all required keys", () => {
    const required = [
      "background",
      "surface",
      "surfaceMuted",
      "onBackground",
      "onSurface",
      "muted",
      "accent",
      "accentOn",
      "danger",
      "dangerOn",
      "warn",
      "warnOn",
      "good",
      "goodOn",
      "border",
      "focus",
      "scrim",
    ] as const;
    for (const palette of [lightPalette, darkPalette, highContrastPalette]) {
      for (const key of required) {
        expect(palette[key]).toBeDefined();
      }
    }
  });
});
