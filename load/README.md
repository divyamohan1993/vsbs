# `@vsbs/load` — load tests

Three k6 scenarios. Pass/fail criteria are encoded in each scenario's `thresholds` block; k6 exits non-zero when any threshold breaches.

## Tooling

We use **k6** (`https://k6.io`). It's a single-binary install:

```bash
# Linux: https://k6.io/docs/get-started/installation/
sudo apt-get update && sudo apt-get install -y k6
# macOS:
brew install k6
```

If k6 is unavailable in your environment, the scenarios are also runnable under Artillery 2.x with one rewrite per scenario (Artillery uses YAML; the JS engine is incompatible).

## Run

```bash
# Bring up the API in sim mode first
cd ../apps/api && LLM_PROFILE=sim PORT=8787 bun src/server.ts &

# Then from this directory:
pnpm test:booking          # 200 RPS booking burst, 5 minutes
pnpm test:sse              # 1000 SSE subscribers, ramped
pnpm test:auth             # 100 RPS auth/otp/request — exercises rate limiter
```

Override the target with `VSBS_API_BASE=https://staging.vsbs.example pnpm test:booking`.

## Pass criteria

| Scenario | Threshold |
|---|---|
| `booking-burst.js` | p95 < 500 ms, error rate < 1 % |
| `sse-fanout.js` | drop rate < 0.5 %, p95 connect < 250 ms |
| `auth-otp.js` | no 5xx burst, 429 carries `Retry-After` |

## CI

Load runs only on PRs labelled `load` — see `.github/workflows/quality.yml`.
