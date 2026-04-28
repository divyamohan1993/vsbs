# Region failover runbook

VSBS runs two independent data planes:

- **India** — `asia-south1`, FQDNs `vsbs-in.dmj.one` / `api-in.dmj.one`. DPDP-residency-locked (no replication out of country).
- **US** — `us-central1`, FQDNs `vsbs-us.dmj.one` / `api-us.dmj.one`. CCPA + CPRA in scope.

The two planes share *nothing* at the data layer: each has its own Firestore database, its own Secret Manager replicas, its own Identity Platform tenant. They only share the global Cloud Load Balancer, Cloud DNS, and Cloud Armor policy.

This runbook covers two scenarios:

1. **In-region failover.** A regional Cloud Run revision is bad, or the regional Firestore is degraded.
2. **Cross-region degraded mode.** An entire region is unreachable. We do *not* migrate users — that would violate residency. We surface honest "service unavailable" with a regional ETA.

---

## 1. In-region failover

### 1a. Bad Cloud Run revision

Symptoms: error rate on `api-{in,us}-be` (Cloud Logging filter `resource.type="cloud_run_revision" severity>=ERROR`) climbs above the SLO burn rate alert.

Steps:

```
# 1. Pin traffic away from the bad revision (immediate)
gcloud run services update-traffic vsbs-${REGION_SHORT}-api \
  --region=${REGION} \
  --to-revisions=$(gcloud run revisions list \
    --service=vsbs-${REGION_SHORT}-api --region=${REGION} \
    --filter='status.conditions.type:Ready AND status.conditions.status:True' \
    --format='value(metadata.name)' | sed -n '2p')=100

# 2. Verify recovery
curl -sf https://api-${REGION_SHORT}.dmj.one/readyz | jq

# 3. File the post-mortem with the bad revision ref + error sample
```

The previous-good revision is always retained because Cloud Run keeps the last 3 by default. If three bad revisions stack up, redeploy from CI by re-running the last green build.

### 1b. Firestore degradation

Firestore in a single region uses synchronous in-region replicas; PITR is on. If the database itself returns errors:

1. Confirm in `https://status.cloud.google.com` whether it is the regional incident or our app.
2. If our app: check IAM bindings, recent rule changes (`gcloud firestore operations list`).
3. If the regional incident is genuine and short (< 30 min): wait it out; reads served from cache where possible.
4. If long: invoke 2 (cross-region degraded) and revoke `vsbs-${REGION_SHORT}-api` invoker permissions so the global LB returns 503 for that region's hosts. Users on the affected region see a maintenance page.

### 1c. PITR restore

Only required if data corruption (vs. service degradation) is confirmed.

```
# Pick a timestamp 5 min before the bad write
gcloud firestore databases restore \
  --source-database=projects/${PROJECT}/databases/vsbs-${REGION_SHORT} \
  --destination-database=vsbs-${REGION_SHORT}-restore-$(date +%Y%m%d%H%M) \
  --snapshot-time=2026-04-28T07:00:00Z

# Verify, then update the API env to point at the restored db, redeploy
```

PITR window is 7 days; restores land in a *new* database, never overwriting in place. The API needs `FIRESTORE_DB` updated to the restored name; revert once the live db is fixed.

---

## 2. Cross-region degraded mode

VSBS does **not** route users across regions. India residents stay on `asia-south1`; their data cannot be served from `us-central1` without violating DPDP. So if `asia-south1` is fully down:

1. **Detect.** Cloud Monitoring uptime check `VSBS API uptime — asia-south1` flips red. Alert routing wakes the on-call.
2. **Communicate.** Post the incident on the status page (`https://status.dmj.one`) within 15 min — that is the DPDP-friendly "transparent communication" obligation (Rule 2025 §6(3)).
3. **Drain new bookings.** Update the Cloud Armor policy to add a rule at priority 100 that returns 503 for `request.path.startsWith('/v1/bookings') && request.headers['x-vsbs-region'] == 'asia-south1'`. Users see "Sorry, we are restoring service in your region — try again in N minutes". They are *not* offered a US fallback.
4. **Hold writes.** No background job re-points India writes to US. There is no such job by design.
5. **Recover.** When `asia-south1` returns, remove the Cloud Armor 503 rule. Background sync replays Pub/Sub buffered events into Firestore.

If the whole region is down for more than 4 hours, the operator MUST file a DPDP breach notification under Rule 2025 §15 (downtime is treated as availability impact, not just confidentiality). The 72-hour notification template lives at `docs/compliance/dpdp-breach-notice-template.md`.

### Regional FQDN sanity check

To rule out DNS as the cause, dig each FQDN against `8.8.8.8` and Cloudflare:

```
dig +short api-in.dmj.one @8.8.8.8
dig +short api-us.dmj.one @8.8.8.8
dig +short vsbs-in.dmj.one @1.1.1.1
dig +short vsbs-us.dmj.one @1.1.1.1
```

All four should resolve to the same anycast IP — the global LB. If only one differs, the DNS A record drift is the issue; redeploy `infra/terraform/global/`.

### Region pinning sanity check

A user reports "I am in India but the site says US". To diagnose:

```
curl -sv https://api.dmj.one/v1/region/me \
  -H "x-appengine-country: IN" \
  | jq .data
```

Expected:

```
{
  "detected": "asia-south1",
  "pinned":   "asia-south1",
  "reason":   "geo",
  "country":  "IN",
  "allowedSwitch": true,
  "knownRegions": ["asia-south1", "us-central1"],
  "pendingBookings": 0
}
```

If `pinned` differs from `detected`, the user has a sticky cookie from a previous session on the wrong region. Tell them to call `DELETE /v1/region/cookie` (the Switch Region UI does this for them).

---

## 3. Common false alarms

- **PITR backup write spike.** Every 6 hours Firestore takes a snapshot; the writer identity shows up in `audit-log` as `cloud-firestore-pitr@system.gserviceaccount.com`. Do not page on this.
- **Cloud Armor 403 spikes.** OWASP CRS at sensitivity 4 has a small false-positive tail; if a legitimate path consistently triggers SQLi or XSS rules, exempt the path with a higher-priority allow rule rather than lowering sensitivity globally.
- **308s on `/v1/auth/otp` from VPN users.** Expected: a German VPN endpoint pins them to `asia-south1` if they then claim to be Indian. Their cookie corrects on the next request.

## 4. Post-incident

- Append the incident to `docs/compliance/incident-log.md` with: time, region, blast radius (users, requests, dollars if applicable), root cause, fix.
- If the incident touched personal data (any read of PII during a degraded write window), file the DPDP / GDPR breach notice within 72 h.
- Add a regression test for the symptom under `apps/api/src/middleware/region.test.ts` or `region-residency.test.ts` — the test must reproduce the failure on the prior code and pass after the fix.

---

Author: Divya Mohan (dmj.one) — last reviewed 2026-04-28.
