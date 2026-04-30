# VSBS Key Ceremony — Operational Runbook

**Author:** Divya Mohan (dmj.one, contact@dmj.one)
**Status:** v1, 2026-04-30
**Scope:** Generation, custody, and rotation of long-lived cryptographic
secrets that, if leaked, would compromise vehicle-handover safety or
customer privacy. Live counterpart: `packages/security/src/key-ceremony.ts`.

This document is a *normative* runbook. Every step is auditable and
cross-referenced with the in-repo code that implements it. The companion
TypeScript module `@vsbs/security/key-ceremony` exposes the exact
primitives used here (`splitSecret`, `recombineShares`, `runCeremony`,
`verifyCeremonyRecord`).

---

## 1. What is split

Three classes of secret material are protected by this ceremony:

| Secret | Use | Algorithm | Length | Rotation |
|---|---|---|---|---|
| Root signing key | Witness co-signs every CommandGrant in the autonomous-handoff path. Compromise = forged grants that authorise unauthorised vehicle moves. | ML-DSA-65 (FIPS 204) | 4032 bytes | Annual or on incident |
| Release signing key | Pinned identity for SLSA build provenance. Compromise = supply-chain takeover. | ML-DSA-65 | 4032 bytes | Annual |
| KMS master wrap key | Encrypts every per-record envelope key in Firestore. Compromise = read of all PII at rest. | AES-256 + ML-KEM-768 hybrid wrap | 32 bytes (AES) + 2400 bytes (ML-KEM SK) | Bi-annual |

For each secret we run an independent ceremony. Shares are NEVER combined
across secrets.

## 2. Threshold policy

The ceremony policy is `5-of-7` for every secret in production:

- **5 custodians** must combine their shares to recover the secret.
- **7 custodians** are issued shares total.
- **Loss of up to 2 custodians** does not block recovery.
- **Compromise of up to 4 custodians** does not leak the secret
  (Shamir's information-theoretic guarantee).

The threshold and participant set are recorded in the ceremony's genesis
entry and bound into every subsequent entry's hash chain. Changing them
requires a full new ceremony.

In tests, smaller policies (2-of-3, 3-of-5) are used for speed; the
math is identical.

## 3. Custodians

The seven custodian roles (filled by named individuals at activation):

1. **Lead engineer (orchestrator).** Currently Divya Mohan. Drives the ceremony; never holds a share.
2. **CTO / engineering principal.**
3. **Head of security.**
4. **Head of platform reliability (oncall manager).**
5. **External legal counsel** (DPDP / GDPR fiduciary; geographically separated).
6. **External advisor / board nominee** (geographically separated, different jurisdiction).
7. **Cold storage keeper** — share is kept in a sealed envelope inside a bank safety-deposit box; this share is broken only in disaster-recovery.

No two custodians may share the same hardware token vendor or the same
physical location. The cold-storage share has its own safety profile (see §6).

## 4. Hardware tokens

Each custodian's share is encrypted-at-rest to a hardware-bound public key
on a FIDO2 / OpenPGP smartcard or a YubiKey 5C (NIST SP 800-73 PIV applet).
Public-key fingerprints are recorded in the ceremony policy
(`Participant.publicKeyFingerprint`) and re-verified on every recombination.

A custodian **cannot** export their share off the device in the clear.
Recombination requires the custodian to physically present the token and
unlock it with their PIN; the share is decrypted and immediately consumed
by `recombineShares()` running on an air-gapped reconstitution host.

Lost or stolen token = immediate rotation (see §8).

## 5. Ceremony procedure (split phase)

The procedure below is run on an air-gapped Linux laptop that has been
freshly imaged from a SHA-256-pinned ISO and never connected to the
network. The laptop is destroyed (drive shredded) after the ceremony.

1. **Witnessing.** The orchestrator and at least four custodians (≥ threshold)
   are physically present. The room is swept for recording devices.
   Times are noted by an external auditor.

2. **Generation.** The orchestrator runs the secret-generation ritual on
   the air-gapped host:

   ```
   pnpm --filter @vsbs/security build
   node ceremony.mjs split \
     --policy 5-of-7 \
     --secret-length 4032 \
     --purpose "VSBS root signing key 2026-Q2" \
     --participants policy.json
   ```

   `ceremony.mjs` calls `runCeremony({ participants, policy, secret })`.
   The `secret` is produced from the in-process `crypto.getRandomValues()`
   plus 32 additional bytes drawn from a hardware noise source (typically
   the host's TPM RNG); the two are XORed before splitting.

3. **Distribution.** The output is a `CeremonyResult` with:
   - A `Map<participantId, Share>` of seven base64 shares (in-memory only).
   - A `CeremonyRecord` with the hash-chained entries.

   The orchestrator writes each share to the corresponding custodian's
   hardware token (encrypted-at-rest under that custodian's public key).
   Each custodian then verifies that the SHA-256 of their decrypted share
   matches the `shareDigest` in the corresponding `attestation` entry of
   the ceremony record. The digest is read aloud and compared against
   the printed transcript.

4. **Sealing.** The orchestrator runs `verifyCeremonyRecord(record)` and
   reads the `finalHash` aloud. The auditor signs a printed copy of the
   record and stores it in a tamper-evident envelope. The original digital
   record is committed to a write-once log (immutable GCS bucket with
   bucket-lock retention enabled), AND filed as a paper hash with the
   external legal custodian.

5. **Erasure.** The orchestrator zeroises the in-memory secret, the
   in-memory share map, and the air-gapped host's RAM (via deliberate
   memory-pressure-induced swap-out followed by drive shredding).

The ceremony lasts approximately three hours.

## 6. Cold storage share

Custodian #7's share is exported from their hardware token under a one-time
asymmetric wrap to a paper QR. The QR is printed in two copies on
acid-free archival paper, each placed in a tamper-evident envelope inside
a bank safety-deposit box in two different cities (Delhi and Bangalore).
The QR is itself further protected by a Brain-wallet passphrase known only
to two custodians; this is the one place we depart from "shares-only" in
exchange for a clean DR profile.

The cold share is broken **only** when threshold custodians cannot be
assembled within 96 hours during a declared incident.

## 7. Recombination procedure (combine phase)

Recombination is required for:

- Routine signing of a release artefact when the online signer's key
  envelope expires (annual).
- Disaster recovery (signer host destroyed).
- Audit-driven verification of the secret's integrity.

Procedure:

1. Threshold custodians physically assemble at the secure room.
2. A fresh air-gapped host is provisioned (same recipe as §5).
3. Each custodian inserts their hardware token; the host runs:

   ```
   node ceremony.mjs recombine \
     --threshold 5 \
     --record record.json \
     --shares share1.bin share2.bin share3.bin share4.bin share5.bin
   ```

   This calls `recombineShares()`. The reconstructed secret is held in
   memory only.
4. The reconstructed secret is verified against a published commitment
   (a hash of the original secret, produced and signed by the orchestrator
   at split time and stored in `keys.md`).
5. The secret is consumed for its intended purpose (sign one or more
   release artefacts; rewrap a KMS key) and zeroised in memory.
6. The host is destroyed.

`verifyCeremonyRecord(record)` MUST be run before recombination. If it
returns `ok: false`, the ceremony is aborted and an incident is declared.

## 8. Rotation cadence

| Trigger | Action |
|---|---|
| Annual | Re-run the full ceremony with fresh randomness. Old shares are revoked. New shares replace them on the same hardware tokens. |
| Custodian leaves / loses token | Run a "key-recovery" rotation within 30 days. |
| Suspected compromise | Run rotation within 24 hours; declare incident; notify regulators per DPDP §24 if PII keys affected. |
| Algorithm break | Out-of-band rotation to the post-quantum successor; documented separately. |

## 9. Audit trail

Every ceremony produces a `CeremonyRecord` whose hash chain is committed
to:

1. A write-once GCS bucket (`gs://vsbs-ceremonies/`, retention 10 years).
2. A printed transcript signed by the external auditor.
3. The OpenTimestamps mainnet (Bitcoin-anchored timestamp) for an
   independent existence proof.
4. The DPIA appendix in `docs/compliance/dpia.md` referenced by ceremony
   `finalHash`.

Auditors retrieve the record from any of these and run
`verifyCeremonyRecord()` to confirm the chain has not been altered.

## 10. References

- Shamir, "How to share a secret", *CACM* 22(11), 1979.
- FIPS 197 (AES) §4.2 — GF(2^8) field used in our implementation.
- NIST SP 800-57 Pt 2 — key custody and ceremony procedures.
- NIST FIPS 204 (ML-DSA) — algorithm of the protected signing keys.
- DPDP Act 2023 §8(5), §24 — security safeguards and incident reporting.
- In-repo: `packages/security/src/key-ceremony.ts` (implementation).
- In-repo: `packages/security/tests/key-ceremony.test.ts` (proofs).
- In-repo: `docs/security/keys.md` (key inventory and rotation schedule).
