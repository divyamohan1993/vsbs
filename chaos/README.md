# `@vsbs/chaos` — chaos / fault-injection scenarios

Vitest-driven chaos scenarios. Each scenario installs a `chaosWrapper` around an adapter call and asserts the system fails closed (typed errors, no silent retries, no data loss).

## Run

```bash
# From this directory:
pnpm test                  # all scenarios
pnpm test:dependency       # network / adapter faults
pnpm test:db               # Firestore-sim unavailable for 30 s
pnpm test:llm              # concierge LLM timeout
pnpm test:sensors          # 100k samples/s storm
```

Or from the repo root:

```bash
pnpm --filter @vsbs/chaos test
```

## Scenarios

| Scenario | Failure injected | Invariant tested |
|---|---|---|
| `dependency-fail.ts` | latency / error / drop on adapter calls | Typed `ChaosError` surfaced; no silent retries |
| `db-unavailable.ts` | Firestore down 30 s | Writes return 503; reads serve cached value flagged stale |
| `llm-timeout.ts` | LLM provider 504s | Concierge degrades to friendly message; no hang, no loop |
| `sensor-storm.ts` | 100k samples/s burst | Token-bucket back-pressure with `Retry-After` |

## Schedule format

```ts
import { buildSchedule, chaosWrapper } from "@vsbs/chaos/runner";

const schedule = buildSchedule([
  { atSecond: 0, action: "ok" },
  { atSecond: 5, action: "latency", ms: 800 },
  { atSecond: 10, action: "error", code: "ECONNRESET" },
  { atSecond: 12, action: "timeout" },
]);

const wrapped = chaosWrapper(adapter.readState.bind(adapter), schedule);
```
