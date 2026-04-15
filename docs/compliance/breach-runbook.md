# Breach notification runbook (72 hours)

**Regulatory basis:** DPDP Rules 2025 Rule 7 (notification to the Data Protection Board of India within 72 hours of becoming aware). GDPR Art. 33 where EU principals are affected.
**Version:** 1.0.0
**Date:** 2026-04-15

## 1. Roles

| Role | Primary | Backup | Responsibility |
|---|---|---|---|
| Incident commander | SRE on-call | Eng lead | Owns the incident end-to-end |
| DPO | Divya Mohan (dmj.one) | Legal | Regulator communication, notification letter |
| Engineering lead | _pending_ | Senior engineer | Technical containment, evidence freeze |
| Legal counsel | _pending_ | External firm | Regulator wording, contractual notices |
| Exec sponsor | _pending_ | Board member | External spokesperson, customer comms sign-off |
| Communications | _pending_ | Support lead | Customer and press messaging |

## 2. Severity and escalation ladder

| Severity | Definition | Page who | Time to IC engaged |
|---|---|---|---|
| SEV-1 | Confirmed PII exfiltration, signed-grant compromise, or safety bypass in production | All roles | <= 5 min |
| SEV-2 | Likely exposure, not yet confirmed; or near-miss with attacker on system | IC, Eng lead, DPO | <= 15 min |
| SEV-3 | Control drift detected; no confirmed exposure | IC, DPO | <= 1 h |

Pager routes: PagerDuty service `vsbs-prod`, fallback phone tree in `ops/on-call.md`.

## 3. Timeline

| T+ | Action | Owner |
|---|---|---|
| 0 | Detection. Alert, SIEM row, or user report arrives. | Auto or reporter |
| 0:05 | IC engaged, incident channel opened, scribe assigned. | IC |
| 0:15 | Preliminary containment: feature flag kill switch, rotate affected secrets, revoke active `CommandGrant`s in the blast radius. | Eng lead |
| 0:30 | Evidence preservation: snapshot Firestore, BigQuery, Cloud Storage, Cloud KMS audit logs; freeze backup rotation; WORM-export the relevant `ai_decision_log` and `authority_log` range. | Eng lead |
| 1:00 | Scope assessment: which principals, which data categories, which purposes, which jurisdictions. | DPO |
| 4:00 | First legal review. Draft regulator notice. | Legal, DPO |
| 24:00 | Status update to exec sponsor. Draft customer notice. | IC, Comms |
| <= 72:00 | **File Rule 7 notification to the Data Protection Board of India.** | DPO |
| 72:00 | If EU principals affected: file GDPR Art. 33 notification to lead supervisory authority. | DPO |
| 72:00 onward | Notify affected principals without undue delay per DPDP s.8(6) and GDPR Art. 34 where applicable. | Comms, DPO |
| +7 days | Post-mortem draft circulated. | IC |
| +14 days | Post-mortem published internally; regression test added per incident. | Eng lead |

## 4. Containment playbook

1. Flip feature flag to disable the affected code path. Kill switches live in `configs/feature-flags/*.yaml`.
2. Rotate secrets in Cloud KMS; old KEK is retained for decryption only, marked `compromised`.
3. Revoke all active `CommandGrant`s whose `granteeSvcCenterId` or `vehicleId` is in scope. The revocation list is honoured within 10 s, per `docs/research/autonomy.md` §5.
4. Invalidate all sessions for affected `ownerId`s.
5. Block egress from any IP or service account identified in the SIEM as the attacker path via Cloud Armor and VPC-SC.

## 5. Evidence preservation rules

- Nothing is deleted. Backups are frozen; erasure workers are paused for the affected rows until legal hold is released.
- All collected evidence is hashed (SHA-256) and stored in a WORM bucket with object lock.
- Chain of custody log in `incidents/{id}/chain.md`; every handler signs off.

## 6. Notification template to the Data Protection Board (DPDP Rule 7)

```
To: The Data Protection Board of India
From: {data-fiduciary-name}, via DPO {dpo-name}, {dpo-email}
Date: {yyyy-mm-dd}
Subject: Notification of personal data breach under DPDP Rule 7

1. Nature of the breach
   - Date and time of occurrence: {range}
   - Date and time of detection: {ts}
   - Location: {systems}
   - Category of breach: {confidentiality | integrity | availability}

2. Categories and approximate number of data principals affected
   {count}, {segments}

3. Categories and approximate number of records affected
   {count}, {data categories}

4. Likely consequences
   {free-text}

5. Measures taken or proposed
   - Immediate containment: {...}
   - Technical and organisational mitigations: {...}
   - Communication to affected principals: {channel, timing, content}

6. Contact point
   DPO: {name}, {email}, {phone}

7. Cross-border implications
   {yes | no}, and if yes, which other authorities have been informed.

8. Attachments
   - Incident timeline
   - Technical root-cause summary
   - Sample notification to principals
```

## 7. Notification to affected principals

Short, plain, in the user's preferred locale. What happened, what data, what we did, what the user should do, how to contact the DPO, how to escalate to the Board. No legalese.

## 8. Post-mortem template

```
# Incident {ID}: {short title}
Severity: {SEV-1 | SEV-2 | SEV-3}
Duration: {start} to {end}
Author: {IC}

## Summary
## Impact
- Principals affected
- Records affected
- Financial impact
- Regulatory filings
## Timeline
## Root cause
## What went well
## What went wrong
## Action items
| Item | Owner | Due | Tracking |
## Regression tests added
## Lessons learned
```

## 9. Drill cadence

SEV-1 tabletop drill quarterly. Full failover drill every 6 months. Post-drill report appended to this file as an annex.
