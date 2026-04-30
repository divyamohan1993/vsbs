# VSBS — Web Style Guide

This is the design language reference for every agent that touches the
`apps/web` surface from Phase 2 onward. It is a living document; if a section
no longer matches the code, update both.

The goal is one sentence: **build like Mercedes-Benz Magazine prints, not
like a SaaS dashboard**. Calm, expensive, engineered, inevitable.

## Design ethos

1. **Calm before clever.** The page should feel still. Motion is a punctuation
   mark, not a paragraph.
2. **Earn every word.** First five words are the pitch. If a sentence
   survives unchanged on a billboard, ship it.
3. **Architecture over decoration.** Light is structural. Hairlines do the
   work that drop shadows do in lesser interfaces.
4. **Numerical truth.** Serif numerals, mono units. Show the number. Then
   show the state of the number.
5. **Restraint with the accents.** Copper means *earned*. EQ-blue means
   *primary*. Reserve them; they pay you back when used sparingly.

## Palette

Tokens live in `src/lib/luxe-tokens.ts`. CSS custom properties live in
`src/app/globals.css` under `@theme`. Tailwind utilities are auto-generated
from the `@theme` block (Tailwind v4).

### Layers (background depth, low → high)

| Token       | Hex       | CSS var              | Tailwind        | Use                                           |
| ----------- | --------- | -------------------- | --------------- | --------------------------------------------- |
| `obsidian`  | `#08090C` | `--color-obsidian`   | `bg-obsidian`   | Default page background                       |
| `midnight`  | `#0C0F14` | `--color-midnight`   | `bg-midnight`   | Aurora mid-stop                               |
| `navy`      | `#11151D` | `--color-navy`       | `bg-navy`       | Aurora bottom stop, low-emphasis panels       |
| `ink`       | `#161B25` | `--color-ink`        | `bg-ink`        | Section dividers, embedded panels             |
| `graphite`  | `#1B2230` | `--color-graphite`   | `bg-graphite`   | Form field fill, scrollbar thumb              |

### Glass surfaces

| Token              | Value                                  | Use                                         |
| ------------------ | -------------------------------------- | ------------------------------------------- |
| `glass`            | `rgba(255,255,255,0.04)` + 24px blur   | Default cards (`luxe-glass`)                |
| `glass-elevated`   | `rgba(255,255,255,0.06)` + 40px blur   | Dialogs, top-of-stack (`luxe-glass-elevated`) |
| `glass-muted`      | `rgba(255,255,255,0.025)` + 24px blur  | Footers, sidebars, ambient panels           |

### Foreground

| Token          | Hex / rgba                  | Tailwind            | Contrast on obsidian | Use                              |
| -------------- | --------------------------- | ------------------- | -------------------: | -------------------------------- |
| `pearl`        | `#F2EEE6`                   | `text-pearl`        |              17.4:1  | Primary text                     |
| `pearl-muted`  | `rgba(242,238,230,0.72)`    | `text-pearl-muted`  |              12.5:1  | Secondary text                   |
| `pearl-soft`   | `rgba(242,238,230,0.56)`    | `text-pearl-soft`   |               9.7:1  | Spec labels, captions            |
| `pearl-faint`  | `rgba(242,238,230,0.36)`    | `text-pearl-faint`  |               6.2:1  | Placeholders only (not body)     |

### Accents

| Token         | Hex       | CSS var              | Reserved for                             |
| ------------- | --------- | -------------------- | ---------------------------------------- |
| `accent-sky`  | `#4FB7FF` | `--color-accent-sky` | Primary CTA gradient (top stop), focus rings |
| `accent-deep` | `#1E6FE6` | `--color-accent-deep`| Primary CTA gradient (bottom stop)       |
| `copper`      | `#C9A36A` | `--color-copper`     | Earned moments: signed grants, completed services, focus ring outline |
| `copper-deep` | `#A07E48` | `--color-copper-deep`| Inset/edge use of the copper accent      |

### Status

| Token      | Hex       | Use                                          |
| ---------- | --------- | -------------------------------------------- |
| `emerald`  | `#1F8F66` | Healthy state, "ok" hairline under KPIBlocks |
| `amber`    | `#D9A441` | Watch state, caution                         |
| `crimson`  | `#B23A48` | Hazard, danger button, alert hairline        |

### Hairlines

`--color-hairline` is `rgba(255,255,255,0.06)`; on hover, `--color-hairline-hover`
at `0.12`. Borders use 1 px exclusively. There are **no drop shadows**, only:

- `--shadow-hairline-top` — inset 1 px on top edge of glass panels.
- `--shadow-halo` — long, low-opacity black halo behind raised cards.

## Typography

| Token       | Family                              | rem     | Weight | Tracking         | Use                                |
| ----------- | ----------------------------------- | ------- | ------ | ---------------- | ---------------------------------- |
| `hero`      | display serif                       | 6       | 500    | `tight`          | Home hero only                     |
| `display`   | display serif                       | 4.25    | 500    | `tight`          | Section openers, dashboard counters|
| `h1`        | display serif                       | 3.25    | 500    | `tight`          | Page titles                        |
| `h2`        | display serif                       | 2.5     | 500    | `tight`          | Section headings                   |
| `h3`        | display serif                       | 2       | 500    | `tight`          | Subsection headings, dialog titles |
| `h4`        | display serif                       | 1.5     | 500    | `tight`          | Card titles                        |
| `lead`      | sans                                | 1.25    | 400    | `normal`         | Hero subtitle, lead paragraph      |
| `bodyLg`    | sans                                | 1.125   | 400    | `normal`         | First paragraph below a heading    |
| `body`      | sans                                | 1       | 400    | `normal`         | Default body                       |
| `control`   | sans                                | 0.875   | 500    | `wide` (0.04em)  | Buttons, links, form values        |
| `small`     | sans                                | 0.8125  | 400    | `normal`         | Captions inside cards              |
| `caption`   | sans                                | 0.75    | 500    | `caps` (0.16em)  | SpecLabel text (uppercase)         |
| `micro`     | sans                                | 0.6875  | 500    | `caps`           | Demo pill, footer micro            |

Display family: `Cormorant Garamond` (Google Fonts, self-hosted via
`next/font/google`). Sans: `Inter`. Mono: `JetBrains Mono`. All three are
loaded in `src/app/layout.tsx`.

`luxe-mono` class enables the mono family with `tnum` + `ss01` features for
VINs, grant ids, and timestamps.

## Spacing scale

Pixels: `4, 6, 8, 12, 16, 20, 24, 32, 40, 56, 80, 120, 200`.
Section vertical rhythm: 120 px desktop, 80 px tablet, 56 px mobile.
Container max widths: 720 (reading), 1180 (default), 1440 (dashboard).
Grid gutter: 24 px desktop, 16 px mobile.

## Motion

| Duration | Easing             | Use                                |
| -------: | ------------------ | ---------------------------------- |
| 150 ms   | `--ease-enter`     | Hover state, ripple cancel         |
| 240 ms   | `--ease-enter`     | Default state changes              |
| 420 ms   | `--ease-enter`     | Panel reveal, dialog enter         |
| 720 ms   | `--ease-enter`     | Page transitions                   |

`prefers-reduced-motion: reduce` collapses every duration to `0.01ms` via the
global `*` rule; the marquee shimmer is also turned off.

## Primitive index

Single import surface: `@/components/luxe`.

| Primitive       | Purpose                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `AuroraGradient`| Fixed full-bleed background. Mount once per page in `layout.tsx`.       |
| `AmbientGlow`   | Soft radial bloom you can position absolutely behind any hero element.  |
| `GlassPanel`    | Canonical raised surface; variants `default | elevated | muted`.        |
| `SpecLabel`     | Small caps section announcer. Goes above headings and KPI values.       |
| `SpecValue`     | Serif numeric display with optional mono unit suffix.                   |
| `KPIBlock`      | Label + value + status hairline + optional description.                 |
| `GoldSeal`      | Copper ring + dot — denotes signed/witnessed/earned items.              |
| `Brand`         | Wordmark. `size="sm"` for header, `lg` for hero placements.             |
| `Hero`          | Full-bleed layout primitive with image backdrop + AmbientGlow + content.|
| `SiteHeader`    | Sticky thin glass strip. Already mounted in `layout.tsx`.               |
| `SiteFooter`    | Quiet closing bar. Already mounted in `layout.tsx`.                     |

The legacy `@/components/ui` primitives (`Button`, `Card`, `Dialog`, `Input`,
`Toast`, `Badge`, `Alert`, etc.) are still the default for forms and
controls. They have been restyled internally; **their exported props are
unchanged**.

## Copy voice

- Write like Mercedes-Benz Magazine, never like a SaaS app.
- Plain English. Short sentences. Active voice.
- No em-dashes anywhere.
- No emoji in UI copy.
- Numbers are pretty. Use thin-space thousand separators (` `) when typesetting
  long counts (`1 169` not `1,169`) — but never inside data fields, only in
  display copy.
- The brand uses period punctuation in two places: tagline (`Your vehicle.
  Served.`) and metadata. Elsewhere, sentences end where they should.

### Words to avoid

`leverage`, `utilize`, `streamline`, `seamless`, `cutting-edge`, `robust`,
`innovative`, `revolutionize`, `holistic`, `synergy`, `paradigm`,
`comprehensive`, `furthermore`, `additionally`, `essentially`, `fundamentally`.

## Accessibility floor

- WCAG 2.2 AAA contrast: every body text pair on the canonical layers is ≥ 7:1.
- `:focus-visible` is a 2 px copper outline at 3 px offset (set globally in
  `globals.css`). Do not override it locally.
- Minimum touch target 44 × 44 px (AAA §2.5.5). The default `<button>` rule in
  `globals.css` enforces this.
- Every interactive element has a name (aria or text), a role, and a state.
- All animations respect `prefers-reduced-motion`.
- Skip link is in `layout.tsx`; do not remove.

## Image use

Every image filename the design references is documented in
`public/images/MANIFEST.md`. Until those files are generated, the consuming
component falls back to a CSS gradient. **Never reference a filename that is
not in the manifest.** Add the row to the manifest first, then use the file.

## Don'ts

- **No bright drop shadows.** Use the inset highlight + black halo combo.
- **No pure white text.** `pearl` (`#F2EEE6`) is the floor.
- **No pure red.** Use `crimson` (`#B23A48`).
- **No skeuomorphic gradients on cards.** Glass + hairline only.
- **No hardcoded `oklch(...)`.** Use the tokens.
- **No `font-display: optional`** — every font load uses `swap` so the layout
  is stable.
- **No layout shifts on font load.** Variable fonts only.
- **No animation longer than 720 ms.** If you need longer, you need a
  different idea.
