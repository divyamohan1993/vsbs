# `@vsbs/e2e` — Playwright e2e + a11y suite

End-to-end + accessibility tests for the VSBS web app and API. Three browser projects (Chromium, Firefox, WebKit) on every spec.

## Run

```bash
# 1. Install (if browsers are not already installed):
pnpm --filter @vsbs/e2e install
npx playwright install --with-deps chromium firefox webkit

# 2. From the repo root:
pnpm test:e2e            # full suite, all projects
pnpm test:e2e:a11y       # axe-core only
pnpm test:e2e -- --project=chromium  # one browser
```

Set `E2E_NO_AUTOSTART=1` if you already have the API on `:8787` and the web on `:3000`.

## What is covered

| Spec | Goal |
|---|---|
| `booking-happy.spec.ts` | Home → Book → 4 steps → Confirm → Status timeline |
| `booking-edge.spec.ts` | VIN typo recovery, offline mid-step, back/forward, deep-link |
| `safety-redflag.spec.ts` | Hard red-flag triggers tow path; cannot bypass |
| `autonomy.spec.ts` | `/autonomy/[id]` SSE updates and override button |
| `consent.spec.ts` | DPDP consent grant + revoke + re-consent |
| `i18n.spec.ts` | hi locale renders non-empty headings |
| `a11y/axe.spec.ts` | Zero serious/critical axe violations on every public route |
| `carla-replay.spec.ts` | Optional Carla replay smoke (skipped when binary absent) |

## CI

`.github/workflows/quality.yml` runs the suite headless on Ubuntu with three browsers; load tests are gated to PRs labelled `load`.
