# Image manifest — VSBS web

This directory holds the photography that backs the luxury surfaces. Every
filename below is referenced by name in the React tree. If a file is missing,
the consuming component falls back to a CSS gradient so the page never
collapses; the visual cost is real, but the page still renders.

Generation prompt notes are at the end. The art direction is consistent:
calm, expensive, engineered. No people unless explicitly required. No
synthetic clutter. Light is always architectural — never lifestyle.

## Inventory

| Filename                            | Aspect | Pixel target | Where it appears                                            | Fallback if missing                                  |
| ----------------------------------- | -----: | -----------: | ----------------------------------------------------------- | ---------------------------------------------------- |
| `hero-eqs-garage.jpg`               |  16:9  |  2880 x 1620 | Home hero (`apps/web/src/app/page.tsx`) desktop / tablet    | Ink-to-graphite diagonal gradient                    |
| `hero-eqs-garage-portrait.jpg`      |   3:4  |  1500 x 2000 | Home hero on viewports below 640 px wide                    | Same gradient as the desktop hero                    |
| `dashboard-grille.jpg`              |  16:9  |  2880 x 1620 | Autonomy dashboard hero (Phase 2 owner: dashboard agent)    | Aurora gradient + ambient glow                       |
| `wizard-bay.jpg`                    |   1:1  |  2000 x 2000 | Booking wizard right rail (Phase 2 owner: booking agent)    | Glass panel with copper hairline                     |
| `concierge-hand.jpg`                |   3:4  |  1500 x 2000 | Concierge step backdrop (Phase 2 owner: booking agent)      | Glass panel + AmbientGlow tone="copper"              |
| `loading-gauge.jpg`                 |  16:9  |  2880 x 1620 | Long-running task hero (Phase 2 owner: states agent)        | Skeleton + AmbientGlow tone="sky"                    |
| `service-centre.jpg`                |   4:3  |  2000 x 1500 | Dispatch / status timeline (Phase 2 owner: status agent)    | Navy panel + sodium-amber accent                     |
| `route-topo.jpg`                    |  16:9  |  2880 x 1620 | Route preview tile on the dashboard                         | Ink panel with grid hairlines                        |
| `phm-sphere.jpg`                    |   1:1  |  2000 x 2000 | Prognostics health module hero                              | Radial gradient sphere on glass                      |
| `seal-platinum.jpg`                 |   1:1  |  2000 x 2000 | Signed grant detail page (Phase 2 owner: autonomy agent)    | GoldSeal primitive in lieu of photography            |

## Format notes

- **JPG** for photographic content, mozjpeg quality 82, progressive on.
- **PNG** only for diagrams or anything with hard edges; otherwise prefer JPG.
- **WebP/AVIF** is welcome but ship the JPG too; the components reference the
  `.jpg` filename and the browser's native `accept` headers determine which
  variant Next serves when it is wired through `next/image` (Phase 2).
- Colour profile **sRGB**. No P3 wides — they collapse on older mobile.
- File size budget: hero ≤ 320 KB, secondary ≤ 220 KB, tile ≤ 140 KB.
- Strip EXIF + GPS on export. The author and licence go in the project NOTICE,
  not the image metadata.

## Generation prompts (Nano Banana 2 Pro)

Hand these in verbatim. Keep the seed across regenerations to preserve light
direction across the set.

- `hero-eqs-garage.jpg`: A Mercedes EQS in a private architectural garage at
  dusk. Brushed concrete walls, a single architectural skylight casting a
  pearl-cool gradient onto the bonnet. The car is three-quarter front,
  parked. No people. No reflections of crew. Mood: calm, inevitable, clean.
  Photographed on a medium format camera, f/8, ISO 100. Background recedes
  into deep navy. No text. No logos visible.
- `hero-eqs-garage-portrait.jpg`: Same scene, recomposed for portrait. Tighter
  on the bonnet and front fascia. The skylight enters from upper left.
- `dashboard-grille.jpg`: Close-up macro of an EQS grille at low key, the
  illuminated tri-star pattern reduced to soft constellations. Negative space
  on the left for headline overlay. Tone: midnight blue with a copper rim
  light from the right.
- `wizard-bay.jpg`: A spotless concierge service bay, square crop. A single
  EQS centred on a polished concrete pad. Soft directional light from
  overhead. No tools visible. No people. Cool grey + obsidian palette.
- `concierge-hand.jpg`: A close-up of a hand holding an iPhone displaying a
  glass UI, photographed on a dark walnut surface. Soft window light from
  upper left. Portrait orientation. The phone screen is intentionally blurred
  so we can overlay live screenshots later.
- `loading-gauge.jpg`: A polished analogue tachometer-style gauge ring, tightly
  cropped, ring sweeping from 0% to 100% in cool sky-blue. Architectural
  lighting. The rim is matte titanium.
- `service-centre.jpg`: Aerial 4:3 view of a service centre forecourt at
  sodium-amber dusk. Parking grid visible, minimalist, no humans. Deep
  blacks; rim of light along the building edge.
- `route-topo.jpg`: Stylised topographic line drawing of a route between two
  pins, etched on a deep navy field. Lines in pearl, accent ring in copper at
  the destination pin. No streets named. Treat as architectural drawing.
- `phm-sphere.jpg`: A chrome sphere on a smoked glass plinth, photographed
  from slightly above, lit so the highlight reads as a horizon line.
- `seal-platinum.jpg`: A platinum guilloché seal disc, square crop, copper
  inner rim and a dark engraved monogram. Deep navy background. The disc
  occupies 60% of the frame, centred.
