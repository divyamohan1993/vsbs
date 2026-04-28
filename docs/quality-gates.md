# Quality Gates

Per-merge-target green-check requirements. The CI workflow [`quality.yml`](../.github/workflows/quality.yml) implements every gate listed below; this doc is the authoritative table for what must pass before a merge or release.

## PR -> main

Every pull request to `main` must pass **all of the following** before merge:

| Gate | Source | Failure mode |
|---|---|---|
| Lint | `pnpm -r lint` | Hard fail |
| Typecheck (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes) | `pnpm -r typecheck` | Hard fail |
| Unit tests | `pnpm -r test` | Hard fail |
| Property tests (fast-check) | `pnpm test:property` | Hard fail |
| Build (libs + API + web) | `pnpm -r build` | Hard fail |
| Agent eval — BFCL function-calling >= 90 % accuracy | `pnpm test:agent-eval` | Hard fail |
| Agent eval — tau2 multi-turn scenarios | bundled in agent-eval | Hard fail |
| Agent eval — red-team corpus | bundled in agent-eval | Hard fail |
| Chaos scenarios (4) | `pnpm --filter @vsbs/chaos test` | Hard fail |
| Playwright e2e (Chromium + Firefox + WebKit) | `pnpm test:e2e` | Hard fail |
| Axe-core a11y — zero serious/critical violations | bundled in e2e | Hard fail |
| Lighthouse CI — Core Web Vitals (LCP < 2.5 s, INP < 200 ms, CLS < 0.1) | `lighthouse` job | Soft fail (warns) |

PRs labelled `load` additionally run:

| Gate | Source | Failure mode |
|---|---|---|
| k6 booking-burst (200 RPS, p95 < 500 ms, error < 1 %) | `pnpm --filter @vsbs/load test:booking` | Hard fail |

## main -> release

Tagging a release also requires:

| Gate | Tooling |
|---|---|
| Trivy SBOM + vuln scan (CRITICAL/HIGH = fail) | `aquasecurity/trivy-action` (in `ci.yml`) |
| OWASP ZAP baseline (passive scan against staging) | manual |
| External a11y audit | manual |
| DPIA + FRIA signed | manual |
| Insurance alignment review (autonomy paths only) | manual |
| Bug-bounty programme live | manual |

Once those external gates are green, the release candidate is promoted to staging via canary 5 % rollout (see `docs/roadmap-prod-deploy.md` Phase 12).

## Local checklist before pushing

```bash
pnpm -r typecheck
pnpm -r test
pnpm test:property
pnpm test:agent-eval
pnpm --filter @vsbs/chaos test
pnpm test:e2e          # requires Playwright browsers; npx playwright install --with-deps chromium first
```

The local fast lane (everything except e2e) finishes in under 60 s on a 2024-class laptop.

## Test counts (truth at HEAD)

| Suite | Tests | Source |
|---|---|---|
| `@vsbs/shared` unit + regression | 51 | `packages/shared/src/**/*.test.ts` |
| `@vsbs/shared` property | 37 | `packages/shared/tests/properties/**` |
| `@vsbs/sensors` unit | 17 | `packages/sensors/src/**/*.test.ts` |
| `@vsbs/api` unit | 35 | `apps/api/src/**/*.test.ts` |
| `@vsbs/agents` eval (BFCL + tau2 + red-team) | 102 | `packages/agents/tests/eval/**` |
| `@vsbs/chaos` scenarios | 27 | `chaos/**` |
| `@vsbs/e2e` Playwright | varies by browser project | `e2e/tests/**` |

## Bypass policy

There are three legitimate reasons to bypass a gate:

1. **Emergency security patch** — an off-cycle CVE fix can skip e2e + lighthouse, but never skip lint/typecheck/unit/property/agent-eval.
2. **Environment outage** — if a third-party (Playwright browser CDN, axe-core CDN) is down, the e2e gate may be deferred.
3. **Documentation-only change** — a PR that touches only `docs/**` may skip everything except lint.

All bypasses must be recorded in the PR description with the reviewer's explicit acknowledgement.

## Owner

Quality gates are owned by Divya Mohan (dmj.one, contact@dmj.one). Any change to this list requires a code review.
