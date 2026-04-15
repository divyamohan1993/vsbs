# Research: Frontend Stack — April 2026

> Goal: out-of-world positive-aura dashboard on a slow phone and bad network, WCAG 2.2 AAA, offline-first, Hindi + regional.

## 1. Framework

**Next.js 15 (App Router) + React 19**, deployed on **Cloud Run**. Rationale:

- Next.js 15 GA ships with React 19 support in the App Router and **Partial Prerendering (PPR)** as an experimental opt-in. Next.js 16 (released late 2025 / early 2026) productionises PPR under the **Cache Components** model ([Next.js 15 blog](https://nextjs.org/blog/next-15), [PPR getting-started](https://nextjs.org/docs/15/app/getting-started/partial-prerendering), [Jishu Labs "Next.js 15 & 16" 2026 guide](https://jishulabs.com/blog/nextjs-15-16-features-migration-guide-2026), [TheVsHub "RSC in 2026"](https://www.thevshub.in/2026/04/react-19-nextjs-15-server-components.html)).
- We pin **Next.js 15.x stable** for launch and set `experimental.ppr = 'incremental'` only on pages whose shell is static (landing, status). The live intake conversation is fully dynamic and streams via React Server Components + Suspense.
- Streaming + RSC give us small shipped JS per route — critical for `LCP < 2.5s` on the 3G-ish network the target user is on.

**Why not Astro / SvelteKit / Remix?** Astro is the lightest, but we need real-time SSE / WebSocket status and complex form state; React ecosystem + Next.js has the best offline-first + PWA + i18n story.

## 2. Design system

**shadcn/ui v1 + Radix Primitives** — copy-in components, Radix passes accessibility audits consistently ([Radix docs](https://www.radix-ui.com/)), shadcn is not a runtime dependency, so no version drift pain. **Tailwind CSS v4** for theme tokens + OKLCH color + contrast utilities. Motion via **Motion (née framer-motion)** with reduced-motion media query honoured.

## 3. Offline-first

- **next-pwa** (or Serwist) service worker, precaches the app shell and routes the user has visited.
- **Dexie.js** (IndexedDB wrapper) as the local store.
- **Automerge** CRDT for the intake draft so a customer filling the form in a parking garage with no signal resumes cleanly on any device.
- **Background Sync API** queues write-through intents; server dedupes via idempotency keys.

Sources: [web.dev offline-first](https://web.dev/learn/pwa/offline-data), [Automerge docs](https://automerge.org/).

## 4. Realtime

**Server-Sent Events** from Cloud Run over HTTP/2 for the intake stream, diagnosis progress, and service-status ticker. Falls back to long-poll. WebSocket is reserved for the autonomous-handoff live camera/sensor view (bidirectional low-latency needed). Server side: Hono's `streamSSE` on Cloud Run with `concurrency=80`.

## 5. Conversational + multimodal intake

- **Voice** via Web Speech API with a server fallback to **Cloud Speech-to-Text Chirp 3** (best Indic language quality on GCP as of 2025–2026 — [Chirp 3](https://cloud.google.com/speech-to-text/v2/docs/chirp_3-model)).
- **Photo upload** of dashboard cluster + damage + odometer; processed server-side with Vertex Gemini 2.5 Pro multimodal.
- **Audio clip** of engine/brake noise, 10 s max, mel-spectrogram is part of the diagnostic evidence.
- **Live camera preview** (only when user explicitly opts in) for guided capture — "point at your instrument cluster, hold still 2 s."

## 6. Performance budgets

| Page | JS shipped | LCP target | CLS | INP | Pattern |
|---|---|---|---|---|---|
| `/` landing | ≤ 60 KB gzip | 1.8s | < 0.05 | < 150ms | static + RSC |
| `/book` intake | ≤ 110 KB gzip | 2.4s | < 0.05 | < 200ms | dynamic RSC + streamed |
| `/status/:id` | ≤ 80 KB gzip | 2.0s | < 0.05 | < 150ms | PPR shell + SSE |
| `/me` account | ≤ 90 KB gzip | 2.2s | < 0.1 | < 200ms | dynamic RSC |
| `/autonomy` | ≤ 130 KB gzip | 2.4s | < 0.05 | < 200ms | dynamic + WebSocket |

Enforced in CI via **Lighthouse CI** and **Bundle Analyzer** fail-thresholds.

## 7. i18n

- **next-intl v4** with file-based namespaces per route. RTL-ready (none in our primary set but future-proof).
- Languages at launch: **en, hi**. Ready for **ta, te, bn, mr, gu, kn, ml, pa**.
- Number/currency/date via `Intl` — always locale-aware, never hardcoded.
- Text expansion budget: up to 40 % vs English; Devanagari uses `Noto Sans Devanagari` subset.

## 8. WCAG 2.2 AAA specifics ([W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/))

AAA criteria we enforce (not just AA):
- **1.4.6 Contrast (Enhanced)** 7:1 for text.
- **1.4.9 Images of Text (No Exception)** — none used.
- **2.3.2 Three Flashes** — motion capped.
- **2.4.8 Location** — breadcrumbs everywhere.
- **2.4.9 Link Purpose (Link Only)**.
- **2.4.12 Focus Not Obscured (Enhanced)** — sticky header never covers focused element.
- **2.5.5 Target Size (Enhanced)** 44 × 44 CSS px for all interactive elements.
- **2.5.7 Dragging Movements** — every drag has a non-drag alternative.
- **3.1.5 Reading Level** — copy targeted at Class 6 reading level.
- **3.2.6 Consistent Help** — the help button is in the same place on every page.
- **3.3.9 Accessible Authentication (Enhanced)** — no cognitive tests; OTP + passkey.

Automated: **axe-core** + **Playwright a11y** in CI. Manual: weekly screen-reader audit (NVDA, VoiceOver).

## 9. Aura design

The "aura" is earned by ruthless taste + research-backed micro-interactions, not by flashy motion:

- **Operational transparency** — Buell & Norton 2011: show the work being done, don't hide it. E.g., the diagnosis screen literally shows the retrieved TSB being reasoned over.
- **Warm explanatory copy** — tone of a senior service advisor who respects the user.
- **Sound design** — soft confirm chime on commit, subtle progress ticks, all respecting prefers-reduced-motion + mute default.
- **Colour system** — OKLCH palette with guaranteed 7:1 contrast pairs; accent-colour adapts to booking status.
- **Micro-animations** — all under 200 ms, all cancellable, all behind `prefers-reduced-motion`.
- **No dark patterns** — cost is visible before commit; withdrawal of consent is as easy as granting.

## Page inventory (v1)

| Route | Purpose |
|---|---|
| `/` | Landing + one-tap "Book service" |
| `/book` | 6-step conversational intake |
| `/book/confirm` | Review + explainable recommendation + override |
| `/status/:id` | Live booking status + SSE ticker |
| `/autonomy/:id` | Autonomous-handoff dashboard (camera + sensor + command state) |
| `/me` | Profile + vehicles + consent centre + erasure |
| `/me/history` | Service history timeline |
| `/help` | Searchable help, accessible from any page |
| `/legal/*` | Notices, policies, DPDP consent registry |
| `/admin/*` | SIEM + ops dashboard (IAP-gated) |

## Sources

- [Next.js 15 blog](https://nextjs.org/blog/next-15)
- [Next.js PPR docs](https://nextjs.org/docs/15/app/getting-started/partial-prerendering)
- [Jishu Labs Next.js 15 & 16 Guide 2026](https://jishulabs.com/blog/nextjs-15-16-features-migration-guide-2026)
- [TheVsHub RSC in 2026](https://www.thevshub.in/2026/04/react-19-nextjs-15-server-components.html)
- [Radix UI](https://www.radix-ui.com/)
- [Web.dev offline-first](https://web.dev/learn/pwa/offline-data)
- [Automerge CRDT docs](https://automerge.org/)
- [Cloud Speech-to-Text Chirp 3](https://cloud.google.com/speech-to-text/v2/docs/chirp_3-model)
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Buell & Norton 2011 Operational Transparency](https://doi.org/10.1287/mnsc.1110.1418)
- [axe-core](https://github.com/dequelabs/axe-core)
