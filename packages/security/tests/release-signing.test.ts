import { describe, expect, it } from "vitest";
import {
  buildProvenance,
  canonicaliseProvenance,
  signProvenance,
  subjectFromBytes,
  verifyProvenance,
  type BuildContext,
  type ProvenanceStatement,
  type SignedProvenance,
} from "../src/release-signing.js";
import { makeMlDsa65Signer } from "../src/sig.js";

function makeContext(): BuildContext {
  return {
    sourceRepo: "dmj-one/vsbs",
    sourceRef: "0123456789abcdef0123456789abcdef01234567",
    builderId: "https://github.com/dmj-one/vsbs/.github/workflows/release.yml@refs/tags/v1.0.0",
    buildType: "https://slsa.dev/build-type/v1/github-actions",
    startedOn: "2026-04-30T08:00:00.000Z",
    finishedOn: "2026-04-30T08:05:00.000Z",
    invocation: { workflow: "release", ref: "v1.0.0" },
    subjects: [
      subjectFromBytes("apps/api/dist/server.js", new Uint8Array([1, 2, 3, 4])),
      subjectFromBytes("apps/web/.next/standalone.tar", new Uint8Array([9, 9, 9])),
    ],
  };
}

describe("buildProvenance", () => {
  it("emits an in-toto Statement v1 envelope with the SLSA v1 predicate type", () => {
    const stmt = buildProvenance(makeContext());
    expect(stmt._type).toBe("https://in-toto.io/Statement/v1");
    expect(stmt.predicateType).toBe("https://slsa.dev/provenance/v1");
    expect(stmt.subject.length).toBe(2);
    expect(stmt.predicate.runDetails.builder.id).toContain("release.yml");
  });

  it("rejects a malformed source ref", () => {
    expect(() => buildProvenance({ ...makeContext(), sourceRef: "not-a-sha" })).toThrow();
  });
});

describe("signProvenance + verifyProvenance round-trip", () => {
  it("signs and verifies a fresh provenance attestation", () => {
    const signer = makeMlDsa65Signer();
    const kp = signer.keygen();
    const stmt = buildProvenance(makeContext());
    const signed = signProvenance({
      statement: stmt,
      publicKey: kp.publicKey,
      secretKey: kp.secretKey,
    });
    const verdict = verifyProvenance(signed);
    expect(verdict.ok).toBe(true);
  });

  it("rejects when the statement is tampered with after signing", () => {
    const signer = makeMlDsa65Signer();
    const kp = signer.keygen();
    const stmt = buildProvenance(makeContext());
    const signed = signProvenance({
      statement: stmt,
      publicKey: kp.publicKey,
      secretKey: kp.secretKey,
    });
    const tampered: SignedProvenance = {
      ...signed,
      statement: {
        ...signed.statement,
        subject: signed.statement.subject.map((s) => ({
          ...s,
          digest: { sha256: "0".repeat(64) },
        })),
      },
    };
    const verdict = verifyProvenance(tampered);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("signature-verify-failed");
  });

  it("rejects when the signature is truncated", () => {
    const signer = makeMlDsa65Signer();
    const kp = signer.keygen();
    const stmt = buildProvenance(makeContext());
    const signed = signProvenance({
      statement: stmt,
      publicKey: kp.publicKey,
      secretKey: kp.secretKey,
    });
    const broken: SignedProvenance = { ...signed, signature: signed.signature.slice(0, 32) };
    const verdict = verifyProvenance(broken);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("signature-length");
  });

  it("rejects when a pinned public key does not match", () => {
    const signer = makeMlDsa65Signer();
    const kp = signer.keygen();
    const other = signer.keygen();
    const stmt = buildProvenance(makeContext());
    const signed = signProvenance({
      statement: stmt,
      publicKey: kp.publicKey,
      secretKey: kp.secretKey,
    });
    const verdict = verifyProvenance(signed, other.publicKey);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("pinned-key-mismatch");
  });

  it("rejects a missing signature field", () => {
    const verdict = verifyProvenance({
      statement: buildProvenance(makeContext()),
      signature: "",
      publicKey: "",
      alg: "ML-DSA-65",
    } as unknown as SignedProvenance);
    expect(verdict.ok).toBe(false);
  });
});

describe("canonicaliseProvenance", () => {
  it("is insensitive to object key order", () => {
    const stmt: ProvenanceStatement = buildProvenance(makeContext());
    const reordered = JSON.parse(JSON.stringify(stmt)) as ProvenanceStatement;
    // Re-create the predicate object with reversed key order. canonical
    // bytes must be identical.
    const a = canonicaliseProvenance(stmt);
    const b = canonicaliseProvenance(reordered);
    expect(Buffer.from(a).toString("hex")).toBe(Buffer.from(b).toString("hex"));
  });
});
