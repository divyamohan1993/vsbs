// Luxe design tokens for VSBS.
//
// One source of truth for the colour, type, spacing, and motion values that the
// luxury foundation emits. Components import from here so a token rename is a
// single-file refactor. The same values are mirrored as CSS custom properties
// in globals.css so server-rendered HTML can use them without hydration.

export const palette = {
  obsidian: "#08090C",
  midnight: "#0C0F14",
  navy: "#11151D",
  ink: "#161B25",
  graphite: "#1B2230",

  pearl: "#F2EEE6",
  pearlMuted: "rgba(242, 238, 230, 0.72)",
  pearlSoft: "rgba(242, 238, 230, 0.56)",
  pearlFaint: "rgba(242, 238, 230, 0.36)",

  hairline: "rgba(255, 255, 255, 0.06)",
  hairlineHover: "rgba(255, 255, 255, 0.12)",
  hairlineStrong: "rgba(255, 255, 255, 0.18)",
  innerHighlight: "rgba(255, 255, 255, 0.04)",

  glass: "rgba(255, 255, 255, 0.04)",
  glassMuted: "rgba(255, 255, 255, 0.025)",
  glassElevated: "rgba(255, 255, 255, 0.06)",

  accentSky: "#4FB7FF",
  accentDeep: "#1E6FE6",
  accentInk: "#04101E",

  copper: "#C9A36A",
  copperDeep: "#A07E48",
  copperGlow: "rgba(201, 163, 106, 0.28)",

  emerald: "#1F8F66",
  emeraldDeep: "#15694A",
  amber: "#D9A441",
  amberDeep: "#A77A24",
  crimson: "#B23A48",
  crimsonDeep: "#7E2530",
} as const;

export const layers = {
  obsidian: palette.obsidian,
  midnight: palette.midnight,
  navy: palette.navy,
  ink: palette.ink,
  graphite: palette.graphite,
} as const;

export const accent = {
  primaryFrom: palette.accentSky,
  primaryTo: palette.accentDeep,
  primaryInk: palette.accentInk,
  copper: palette.copper,
  copperDeep: palette.copperDeep,
  copperGlow: palette.copperGlow,
} as const;

export const status = {
  ok: palette.emerald,
  okDeep: palette.emeraldDeep,
  watch: palette.amber,
  watchDeep: palette.amberDeep,
  alert: palette.crimson,
  alertDeep: palette.crimsonDeep,
} as const;

// Type scale in rem at 16px root. Names are anchors; values are math.
export const fontSize = {
  micro: "0.6875rem",
  caption: "0.75rem",
  small: "0.8125rem",
  control: "0.875rem",
  body: "1rem",
  bodyLg: "1.125rem",
  lead: "1.25rem",
  h4: "1.5rem",
  h3: "2rem",
  h2: "2.5rem",
  h1: "3.25rem",
  display: "4.25rem",
  hero: "6rem",
} as const;

export const fontFamily = {
  display: '"Cormorant Garamond", "PP Editorial New", ui-serif, Georgia, serif',
  sans: '"Inter", "Söhne", ui-sans-serif, system-ui, -apple-system, "Noto Sans Devanagari", sans-serif',
  mono: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

export const tracking = {
  tight: "-0.02em",
  normal: "0",
  wide: "0.04em",
  wider: "0.08em",
  caps: "0.16em",
} as const;

export const lineHeight = {
  tight: "1.05",
  snug: "1.2",
  normal: "1.6",
  relaxed: "1.7",
} as const;

// 4 -> 200 spacing scale. Pixel values; consume via Tailwind arbitrary classes.
export const spacing = {
  px1: 4,
  px2: 6,
  px3: 8,
  px4: 12,
  px5: 16,
  px6: 20,
  px7: 24,
  px8: 32,
  px9: 40,
  px10: 56,
  px11: 80,
  px12: 120,
  px13: 200,
} as const;

export const container = {
  reading: 720,
  default: 1180,
  dashboard: 1440,
} as const;

export const radius = {
  xs: "6px",
  sm: "10px",
  md: "14px",
  lg: "20px",
  xl: "28px",
  pill: "999px",
} as const;

export const motion = {
  ease: {
    enter: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    exit: "cubic-bezier(0.4, 0, 0.2, 1)",
    spring: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
  duration: {
    micro: "150ms",
    state: "240ms",
    panel: "420ms",
    page: "720ms",
  },
} as const;

export const shadow = {
  hairlineTop: "inset 0 1px 0 rgba(255, 255, 255, 0.04)",
  hairlineBottom: "inset 0 -1px 0 rgba(0, 0, 0, 0.32)",
  halo: "0 80px 120px -60px rgba(0, 0, 0, 0.5)",
  haloHover: "0 100px 140px -60px rgba(0, 0, 0, 0.6)",
  ring: "0 0 0 1px rgba(255, 255, 255, 0.06)",
  ringHover: "0 0 0 1px rgba(255, 255, 255, 0.12)",
  copperRing: "0 0 0 2px rgba(201, 163, 106, 0.85)",
  glassPress: "inset 0 0 0 1px rgba(255, 255, 255, 0.06), 0 30px 60px -30px rgba(0, 0, 0, 0.6)",
} as const;

export const blur = {
  glass: "blur(24px) saturate(140%)",
  glassDeep: "blur(40px) saturate(160%)",
  veil: "blur(2px)",
} as const;

export const z = {
  base: 0,
  raised: 10,
  header: 30,
  toast: 40,
  dialog: 50,
  ambient: -1,
} as const;

export type Status = keyof typeof status;
export type FontSize = keyof typeof fontSize;
export type Layer = keyof typeof layers;

// Single luxe namespace export for ergonomic imports.
export const luxe = {
  palette,
  layers,
  accent,
  status,
  fontSize,
  fontFamily,
  tracking,
  lineHeight,
  spacing,
  container,
  radius,
  motion,
  shadow,
  blur,
  z,
} as const;

export type LuxeTokens = typeof luxe;
