# Simulation Policy — exact production logic, toggle-only promotion

> **Invariant:** every simulated external dependency in VSBS implements the identical state machine and behaviour as its production counterpart. Promotion to production is a single runtime toggle. No code path changes. No behaviour changes. No "cleanup pass before going live."

This is a load-bearing architectural rule. It is cited from the defensive publication ([docs/defensive-publication.md](defensive-publication.md) §10) and is enforced at code-review time.

## Why this rule exists

Two classes of failure kill autonomous systems:

1. **Silent logic drift** — the simulator takes shortcuts, the production adapter does the "real" thing, and the two slowly diverge. At go-live the system fails in a way no test caught, because no test was running against the real behaviour.
2. **Integration theatre** — the simulator looks plausible but doesn't exercise the same code paths (retry, idempotency, webhook ordering, state transitions). When real-world failures arrive, they hit ungrounded code.

Both are eliminated by one rule: **the adapter is the state machine. The mode toggle only chooses where the side-effect lands.**

## The rule, concretely

For every external dependency with a simulator (payments, SMS, connected-car, maps, autonomy hand-off, STT, identity), the adapter is structured as:

```
Adapter
  ├── shared state machine             (100 % of the logic)
  │   • idempotency keys
  │   • order/intent/grant state transitions
  │   • retry + backoff + circuit breaking
  │   • webhook / callback ordering guarantees
  │   • receipts / audit-log writes
  │   • error classification
  │
  └── transport driver                 (the only thing that differs)
        ├── live    → real HTTPS call to the vendor
        └── sim     → in-process deterministic driver
                       with the same success/error distribution
```

- The state machine is **unaware** of which driver is in use. It emits the same events, appends the same audit records, honours the same retries.
- The `sim` driver faithfully reproduces:
  - **Latency** drawn from a plausible distribution.
  - **Success / failure / partial states** including network timeouts, 429s, 5xx, vendor-specific rejection codes, duplicate webhooks, out-of-order webhooks.
  - **Idempotency replay behaviour** — the same idempotency key returns the same response.
  - **Webhooks / callbacks** — the simulator publishes webhook events on the same internal event bus that the live driver's webhook handler would publish on.
- Promotion is environment-driven: `PAYMENT_MODE=sim` → `PAYMENT_MODE=live`. Nothing else changes.
- Both drivers are exercised in CI: unit tests + property-based tests run against the `sim` driver; a small smoke suite runs against the `live` driver in a staging tenant with real vendor sandboxes (Razorpay Test, Stripe Test, Twilio Test).

## Ground rules for the simulator

1. **No shortcuts.** A simulated payment that never touches the state machine is a lie. If the state machine expects an "authorised → captured → settled" transition, the simulator must produce exactly that transition, in order, with the same delays the vendor produces.
2. **No decorative randomness.** Simulator variability is drawn from a seeded PRNG so tests are reproducible and failures are replayable.
3. **Origin stamping.** Every artefact the simulator produces carries a clear `origin: "sim"` marker. A simulated payment receipt is never presented to a real customer or written to a real customer's audit log.
4. **Feature parity.** When a new vendor feature lands in the live driver, the simulator must be updated in the same PR.
5. **Single toggle.** If promoting a subsystem from sim to live requires more than flipping one env var, the adapter is wrong and must be refactored.

## Where the policy applies today

| Subsystem | Sim driver | Live driver | Toggle |
|---|---|---|---|
| OTP auth | in-process code store + live-display to UI | Twilio Verify (or MSG91 for India) | `AUTH_MODE=sim\|live` |
| Payments — Razorpay | deterministic order/intent/capture/webhook | Razorpay Orders/Payments API | `PAYMENT_MODE=sim\|live`, `PAYMENT_PROVIDER=razorpay` |
| Payments — UPI | deterministic VPA validation + intent + callback | UPI PSP (Razorpay/Cashfree/PhonePe) | `PAYMENT_MODE=sim\|live`, `PAYMENT_PROVIDER=upi` |
| Payments — Stripe | deterministic PaymentIntent state machine | Stripe PaymentIntents | `PAYMENT_MODE=sim\|live`, `PAYMENT_PROVIDER=stripe` |
| Smartcar | deterministic OAuth + vehicle endpoints | Smartcar API | `SMARTCAR_MODE=sim\|live` |
| Maps — Routes API | deterministic ETA model using haversine + congestion factor | `routes.googleapis.com` | `MAPS_MODE=sim\|live` |
| Maps — Route Optimization | OR-Tools local VRPTW | GMPRO | `MAPS_MODE=sim\|live` |
| Autonomy — AVP | deterministic grant-accept / move / park simulation | OEM AVP API | `AUTONOMY_MODE=sim\|live` |
| Sensors | realistic simulator (brake pressure, TPMS, BMS, etc.) with fault injection | Smartcar / OBD dongle gateway | `SENSORS_MODE=sim\|live\|mixed` |
| STT (voice intake) | in-process stub with pre-canned transcripts | Gemini Live API / Cloud STT | `STT_MODE=sim\|live` |

Each of these lives behind the same adapter interface. Switching an environment from demo to production is a change to environment variables only. The code paths are identical.

## How the customer knows which mode they are in

- On any page where sim mode affects user-visible behaviour (OTP live-displayed, payments not actually settled, autonomy moves not real), a persistent, AAA-contrast banner reads `Demo mode — no real SMS or payments will be sent`. There is no ambiguity.
- The `/healthz` and `/readyz` endpoints return the active mode per subsystem so operators can confirm at a glance.
- Every audit-log entry in demo mode is tagged `env: "demo"` so it cannot be later confused with a real production event.
