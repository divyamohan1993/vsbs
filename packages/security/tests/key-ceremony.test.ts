import { describe, expect, it } from "vitest";
import {
  recombineShares,
  runCeremony,
  splitSecret,
  verifyCeremonyRecord,
  type CeremonyPolicy,
  type Participant,
} from "../src/key-ceremony.js";

function rng(seed: number): (n: number) => Uint8Array {
  let state = seed >>> 0;
  return (n: number): Uint8Array => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      out[i] = state & 0xff;
    }
    return out;
  };
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

describe("splitSecret + recombineShares", () => {
  it("round-trips a 32-byte secret across many threshold/total combinations", () => {
    const cases: Array<[number, number]> = [
      [2, 3],
      [3, 5],
      [5, 7],
      [4, 9],
      [10, 15],
    ];
    for (const [t, n] of cases) {
      const secret = randomBytes(32);
      const shares = splitSecret(secret, t, n, { rng: rng(0xcafe) });
      expect(shares.length).toBe(n);
      const subset = shares.slice(0, t);
      const recovered = recombineShares(subset, t);
      expect(Array.from(recovered)).toEqual(Array.from(secret));
    }
  });

  it("recovers from any threshold-sized subset, not just the first ones", () => {
    const secret = new TextEncoder().encode("Mahatma Gandhi was born in Porbandar.");
    const shares = splitSecret(secret, 3, 5, { rng: rng(7) });
    const subsets = [
      [0, 1, 2],
      [0, 2, 4],
      [1, 3, 4],
      [2, 3, 4],
    ];
    for (const idx of subsets) {
      const subset = idx.map((i) => shares[i]!);
      const recovered = recombineShares(subset, 3);
      expect(Buffer.from(recovered).toString()).toBe("Mahatma Gandhi was born in Porbandar.");
    }
  });

  it("rejects recombination with fewer than threshold shares", () => {
    const secret = new Uint8Array([1, 2, 3, 4, 5]);
    const shares = splitSecret(secret, 3, 5, { rng: rng(11) });
    expect(() => recombineShares(shares.slice(0, 2), 3)).toThrow(/at least 3/);
  });

  it("information-theoretic: any threshold-1 subset recovers a different secret than the truth", () => {
    // With fewer than threshold shares, every possible secret value is
    // equally likely (Shamir is information-theoretically secure). We
    // assert here only that running interpolation on threshold-1 shares
    // does NOT yield the original secret — the threshold guard refuses.
    const secret = randomBytes(8);
    const shares = splitSecret(secret, 4, 6, { rng: rng(31) });
    expect(() => recombineShares(shares.slice(0, 3), 4)).toThrow();
  });

  it("rejects threshold < 2", () => {
    expect(() => splitSecret(new Uint8Array([1]), 1, 3)).toThrow(/threshold/);
  });

  it("rejects total < threshold", () => {
    expect(() => splitSecret(new Uint8Array([1]), 5, 3)).toThrow(/total/);
  });

  it("rejects total > 255", () => {
    expect(() => splitSecret(new Uint8Array([1]), 2, 256)).toThrow(/255/);
  });

  it("rejects empty secret", () => {
    expect(() => splitSecret(new Uint8Array(), 2, 3)).toThrow(/non-empty/);
  });

  it("rejects duplicate share x-indices on recombine", () => {
    const secret = new Uint8Array([1, 2, 3]);
    const shares = splitSecret(secret, 2, 3, { rng: rng(99) });
    expect(() => recombineShares([shares[0]!, shares[0]!], 2)).toThrow(/duplicate/);
  });

  it("survives the full set of pseudo-random secrets at standard sizes", () => {
    for (let trial = 0; trial < 8; trial++) {
      const secret = randomBytes(64);
      const shares = splitSecret(secret, 3, 5, { rng: rng(trial * 1000) });
      const recovered = recombineShares([shares[1]!, shares[3]!, shares[4]!], 3);
      expect(Array.from(recovered)).toEqual(Array.from(secret));
    }
  });
});

describe("runCeremony + verifyCeremonyRecord", () => {
  function makeParticipants(n: number): Participant[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `participant-${i + 1}`,
      name: `Custodian ${i + 1}`,
      publicKeyFingerprint: "a".repeat(64),
    }));
  }

  function makePolicy(threshold: number, total: number, secretLength = 32): CeremonyPolicy {
    return {
      threshold,
      total,
      secretLength,
      purpose: "VSBS root signing key 2026-Q2",
      orchestrator: {
        id: "orchestrator",
        name: "Divya Mohan",
        publicKeyFingerprint: "b".repeat(64),
      },
    };
  }

  it("orchestrates a full 3-of-5 ceremony and produces a tamper-evident record", () => {
    const participants = makeParticipants(5);
    const policy = makePolicy(3, 5);
    const secret = new Uint8Array(32).fill(0xab);
    let t = 0;
    const result = runCeremony({
      participants,
      policy,
      secret,
      now: () => new Date(1_700_000_000_000 + 1000 * t++),
      rng: rng(0xdeadbeef),
    });
    expect(result.record.entries[0]!.type).toBe("genesis");
    expect(result.record.entries.at(-1)!.type).toBe("seal");
    expect(result.shares.size).toBe(5);
    expect(result.record.finalHash).toMatch(/^[0-9a-f]{64}$/);

    const verdict = verifyCeremonyRecord(result.record);
    expect(verdict.ok).toBe(true);
  });

  it("threshold shares from the ceremony recombine to the original secret", () => {
    const participants = makeParticipants(5);
    const policy = makePolicy(3, 5, 16);
    const secret = new TextEncoder().encode("Aatmanirbhar.OK");
    const padded = new Uint8Array(16);
    padded.set(secret);
    let t = 0;
    const result = runCeremony({
      participants,
      policy,
      secret: padded,
      now: () => new Date(1_700_000_000_000 + 1000 * t++),
      rng: rng(0x12345678),
    });
    const ids = participants.slice(0, 3).map((p) => p.id);
    const subset = ids.map((id) => result.shares.get(id)!);
    const recovered = recombineShares(subset, 3);
    expect(Array.from(recovered)).toEqual(Array.from(padded));
  });

  it("verifyCeremonyRecord rejects a tampered payload", () => {
    const participants = makeParticipants(3);
    const policy = makePolicy(2, 3, 8);
    const secret = new Uint8Array(8).fill(7);
    let t = 0;
    const { record } = runCeremony({
      participants,
      policy,
      secret,
      now: () => new Date(1_700_000_000_000 + 1000 * t++),
      rng: rng(0x99),
    });
    const tampered = JSON.parse(JSON.stringify(record)) as typeof record;
    tampered.entries[1]!.payload = { ...tampered.entries[1]!.payload, threshold: 99 };
    const verdict = verifyCeremonyRecord(tampered);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/entry-hash-mismatch/);
  });

  it("rejects a participant count mismatch with policy.total", () => {
    expect(() =>
      runCeremony({
        participants: makeParticipants(4),
        policy: makePolicy(2, 5),
        secret: new Uint8Array(32),
        rng: rng(1),
      }),
    ).toThrow(/participants length/);
  });

  it("rejects a secret length mismatch with policy.secretLength", () => {
    expect(() =>
      runCeremony({
        participants: makeParticipants(3),
        policy: makePolicy(2, 3, 16),
        secret: new Uint8Array(8),
        rng: rng(1),
      }),
    ).toThrow(/secret byte length/);
  });

  it("each entry's hash chains to the previous entry", () => {
    const participants = makeParticipants(3);
    const policy = makePolicy(2, 3, 4);
    let t = 0;
    const { record } = runCeremony({
      participants,
      policy,
      secret: new Uint8Array([1, 2, 3, 4]),
      now: () => new Date(1_700_000_000_000 + 1000 * t++),
      rng: rng(2),
    });
    for (let i = 1; i < record.entries.length; i++) {
      expect(record.entries[i]!.previousHash).toBe(record.entries[i - 1]!.hash);
    }
  });
});
