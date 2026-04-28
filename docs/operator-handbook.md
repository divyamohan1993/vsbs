# VSBS Operator Handbook

This handbook is for the human operator on duty at a VSBS service centre. It maps every page of the admin console (`apps/admin`) to the action you take, the signals you watch, and the escalation path you follow when something is off.

The console is gated by Cloud IAP in production and an HttpOnly dev cookie in local sim mode. There is no anonymous read path. Everything you do leaves an audit trail with your IAP subject attached.

## Author and audience

- **Author**: Divya Mohan (dmj.one, contact@dmj.one)
- **Audience**: shift operators, on-call leads, and the regional incident commander.
- **Read time**: 25 minutes for the first pass; bookmark sections you use daily.

## How to log in

| Mode | URL | Auth |
| --- | --- | --- |
| Production | `https://admin.vsbs.in` | Cloud IAP, `roles: ["admin"]` claim required. |
| Staging | `https://admin.staging.vsbs.in` | Cloud IAP. |
| Local sim | `http://localhost:3001` | `/api/dev-login` issues a signed dev cookie. Refuses to operate when `APP_ENV=production`. |

If you see a 401 or 403, your IAP membership lapsed. Ask the regional lead to re-add you to the `admin@vsbs.in` Google Group.

## Page-by-page

### 1. Operator home

Tile grid that links to every page below. Use it as your start screen.

### 2. Bookings (`/[locale]/bookings`)

What you see: every active booking, sortable on each column. Filter by status, region, and date range. The bar at the top shows whether the live SSE feed is connected; if it says "Live updates not connected", refresh the page.

What you watch:
- A booking sitting at `accepted` for more than the SLA response window. Reassign it.
- A booking with `safety: red`. Click in, verify the safety override log explains the call, and escalate if the rationale looks weak.
- Any `escalated` row: the regional lead is supposed to own it; ping them if the row sits more than 10 minutes.

Bulk actions: tick rows -> *Reassign*, *Cancel*, or *Escalate*. Each action requires a free-text reason that lands in the audit log. Reasons are mandatory; the form will not submit without one.

### 3. Capacity heat map (`/[locale]/capacity`)

What you see: a 7 day x 24 hour grid per service centre, colour-coded by utilisation. Click any cell to drill in to the per-slot detail. Cells are keyboard-navigable and screen-reader-friendly (table semantics, percentage values are read out).

When to act:
- Two consecutive cells > 90% means slots are about to overflow. Open *Slots* and add capacity.
- A whole row near 0% mid-day is a staffing/scheduling miss; talk to the SC manager.

### 4. Technician routing (`/[locale]/routing`)

What you see: every active technician route, the GMPRO-solved ETA today, and what the optimiser would do if you re-ran it now. Hit *Re-run solver* to recompute against the current pickups. Use the override form to swap a technician without waiting for the solver.

When to act:
- A new tow request needs a route within minutes; if the optimiser's new ETA is much better than the current one, accept the rerun.
- A specific technician is sick: override every route they own to a teammate before the next pickup.

### 5. Slots (`/[locale]/slots`)

CRUD per service centre, day-of-week, and time window. Each save is versioned; the previous slot row stays in audit history. Capacity is bay count, not technician count.

### 6. Fairness monitor (`/[locale]/fairness`)

Allocation symmetry across regions, cohorts, and time windows. We do not use any protected attribute. The cohort is region-derived (urban-core vs suburban vs tier-2). Watch:
- Mode mix that is overwhelmingly *tow* in one cohort and *valet* in another. Flag to the regional lead.
- Mean-wait or p95-wait spread > 2x between cohorts. Investigate routing or capacity.

### 7. Safety overrides (`/[locale]/safety-overrides`)

Every safety override the system saw, by user, by agent, by operator. Click a row to expand the rationale, the signals at the time, and the downstream effect.

Daily checklist: scan rows where `decision = downgrade` and `actor.kind = agent`. The supervisor agent is the most frequent downgrader; if its rationale is "PHM agreed", pull up the linked booking and verify the PHM screen agrees.

### 8. Pricing (`/[locale]/pricing`)

Versioned parts + labour catalogue per service centre. State machine:

```
draft -> review -> published
```

Operators with `pricing.write` can create drafts; only the regional lead role can publish. The diff button compares any two versions. **Never delete a published version**; create a new draft with the corrected numbers and publish.

### 9. SLA manager (`/[locale]/sla`)

Per-SC response and resolution targets. The burn-down number on each card is updated in real time from the API. > 75% red = page the on-call.

### 10. Audit viewer (`/[locale]/audit`)

Find a command grant by id, vehicle, or owner. The detail page shows:
- The full grant payload (RFC 8785 canonical form).
- The owner signature, server witness signatures.
- The Merkle inclusion proof against the published authority root.
- A *Verify* button that recomputes the digest in your browser and walks the proof. Green check on every line means the grant is sound. Any red line means the grant has been tampered with or revoked; freeze the booking and call the regional lead.

The Merkle subpage (`/audit/merkle`) lists every published authority root. Use it when you need to point an external auditor at a specific root index. The verify-by-grant-id form on this page is the same as the detail page's button; either is enough.

## Daily checklist

1. Bookings page: scan red-tier rows; resolve or escalate within 10 minutes of arrival.
2. Capacity page: check the next-three-hour band on every active SC.
3. Routing page: re-run solver on every route older than an hour.
4. Safety overrides: review the last hour's overrides and confirm the rationales.
5. SLA page: any burn > 75% gets a Slack ping to the on-call.
6. Audit page: spot-check three random grants; run the verify button.

## Weekly review

- Pricing diff between this week's published version and last week's. Flag drift > 5%.
- Fairness metrics: complaint rate trend per cohort. Flag any cohort up > 10% week-over-week.
- Safety overrides: distribution by `actor.kind`. Operator-overrides should be rare; spike means agent confidence is degrading or operators are losing trust in the system. Report both up.
- Authority log: confirm the latest Merkle root is signed and published. Compare against the dmj.one transparency log.

## Escalation

| Severity | Page on call | Then notify |
| --- | --- | --- |
| Burn > 90% on any SC SLA | regional.lead@vsbs.in | incident.cmdr@vsbs.in |
| Tampered grant detected (audit verify red) | incident.cmdr@vsbs.in | author (Divya Mohan) |
| Wide fairness spread across cohorts | regional.lead@vsbs.in | head.fairness@vsbs.in |
| API not responding for 60 s | platform on-call | regional.lead@vsbs.in |

## Audit log verification by hand

If the in-browser verifier ever disagrees with the API:

1. Copy the canonical bytes shown on the grant detail page.
2. Compute `sha256` locally (`shasum -a 256 < file`).
3. Compare against the `canonicalDigestHex` field on the page.
4. If they disagree, the API has lied or the page has been tampered with. Treat it as a security incident.

## Sources

- VSBS architecture: [`docs/architecture.md`](architecture.md).
- Command-grant lifecycle and Merkle authority chain: [`packages/shared/src/commandgrant-lifecycle.ts`](../packages/shared/src/commandgrant-lifecycle.ts).
- Wellbeing scoring: [`docs/research/wellbeing.md`](research/wellbeing.md).
- Compliance and breach runbook: [`docs/compliance/`](compliance).
