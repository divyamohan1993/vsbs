// =============================================================================
// Design tokens for the VSBS mobile app.
//
// The web app uses OKLCH colour values via Tailwind 4. React Native does not
// parse oklch() strings yet, so we precompute the sRGB hex equivalents using
// the CSS Color Module Level 4 conversion that Tailwind itself ships. The
// hex values below were generated with the same OKLCH coordinates that
// `apps/web/src/app/globals.css` uses, so the two surfaces stay visually
// identical.
//
// Three palettes are exported: light, dark, and high-contrast. Selection at
// runtime is driven by `Appearance.getColorScheme()` and the user's stored
// preference. Reduced-motion is handled separately via `useReducedMotion()`.
// =============================================================================

export type Palette = {
  background: string;
  surface: string;
  surfaceMuted: string;
  onBackground: string;
  onSurface: string;
  muted: string;
  accent: string;
  accentOn: string;
  danger: string;
  dangerOn: string;
  warn: string;
  warnOn: string;
  good: string;
  goodOn: string;
  border: string;
  focus: string;
  scrim: string;
};

export const lightPalette: Palette = {
  background: "#f7f8fb",
  surface: "#ffffff",
  surfaceMuted: "#eceff5",
  onBackground: "#0c0e13",
  onSurface: "#0c0e13",
  muted: "#5a6173",
  accent: "#1e4dd8",
  accentOn: "#ffffff",
  danger: "#a8131a",
  dangerOn: "#ffffff",
  warn: "#7a4a00",
  warnOn: "#ffffff",
  good: "#0c5d2a",
  goodOn: "#ffffff",
  border: "#cdd1dc",
  focus: "#1e4dd8",
  scrim: "rgba(8,10,16,0.55)",
};

export const darkPalette: Palette = {
  background: "#0b0d12",
  surface: "#13161d",
  surfaceMuted: "#1a1e27",
  onBackground: "#f3f5fa",
  onSurface: "#f3f5fa",
  muted: "#a3aac0",
  accent: "#7ea4ff",
  accentOn: "#0a1230",
  danger: "#ff8a8f",
  dangerOn: "#3a0509",
  warn: "#ffc56b",
  warnOn: "#2a1500",
  good: "#7be0a0",
  goodOn: "#062b13",
  border: "#2a2f3c",
  focus: "#7ea4ff",
  scrim: "rgba(0,0,0,0.7)",
};

export const highContrastPalette: Palette = {
  background: "#000000",
  surface: "#000000",
  surfaceMuted: "#0a0a0a",
  onBackground: "#ffffff",
  onSurface: "#ffffff",
  muted: "#ffffff",
  accent: "#ffe600",
  accentOn: "#000000",
  danger: "#ff5151",
  dangerOn: "#000000",
  warn: "#ffd233",
  warnOn: "#000000",
  good: "#7cffa3",
  goodOn: "#000000",
  border: "#ffffff",
  focus: "#ffe600",
  scrim: "rgba(0,0,0,0.85)",
};

export const spacing = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 18,
  pill: 999,
};

export const minTouchTarget = 44;

export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: "700" as const },
  headline: { fontSize: 24, lineHeight: 30, fontWeight: "700" as const },
  title: { fontSize: 18, lineHeight: 24, fontWeight: "600" as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: "400" as const },
  label: { fontSize: 14, lineHeight: 18, fontWeight: "500" as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" as const },
};

export type ThemeMode = "light" | "dark" | "high-contrast";

export function paletteFor(mode: ThemeMode): Palette {
  switch (mode) {
    case "light":
      return lightPalette;
    case "dark":
      return darkPalette;
    case "high-contrast":
      return highContrastPalette;
  }
}
