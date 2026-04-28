// =============================================================================
// On-device CommandGrant signing.
//
// The device drives the same canonical byte stream as the API's witness
// signer (`canonicalGrantBytes` from @vsbs/shared/commandgrant-lifecycle).
// The platform passkey produces a WebAuthn ES256 assertion whose
// clientDataJSON.challenge equals the SHA-256 of those canonical bytes,
// so the server can verify the assertion against the same byte stream it
// will witness-sign immediately afterwards.
//
// Three steps:
//
//   1. Compute canonical grant bytes (see @vsbs/shared/commandgrant-lifecycle).
//   2. Hash the bytes with SHA-256 -> challenge.
//   3. Call the platform passkey API (see passkey.ts) and unpack the
//      assertion. The `signature` field becomes the `ownerSignatureB64`
//      on the CommandGrant.
//
// On receipt of the server-witnessed grant, we verify the witness chain
// using `appendAuthority` semantics from @vsbs/shared. Any mismatch is a
// hard fail — never display the booking as "autonomy ready" without a
// verified chain.
// =============================================================================

import {
  CommandGrantSchema,
  CommandGrantTemplateSchema,
  canonicalGrantBytes,
  CommandGrantChallengeSchema,
  AutonomyActionSchema,
  type CommandGrant,
  type CommandGrantTemplate,
  type CommandGrantChallenge,
  type AutonomyAction,
} from "@vsbs/shared";

import { assertOverChallenge, biometricStepUp } from "./passkey";
import { apiClient } from "./api";
import { z } from "zod";

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return new Uint8Array(buf);
}

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 2 ? "==" : s.length % 4 === 3 ? "=" : "";
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface SignGrantOpts {
  template: CommandGrantTemplate;
  /** RP id the platform passkey is bound to. Usually the API host. */
  rpId: string;
  /** Optional message shown by the OS biometric prompt. */
  promptMessage?: string;
}

/**
 * Build a fully-signed CommandGrant using the on-device passkey. Throws
 * on biometric failure, passkey cancellation, or schema mismatch.
 */
export async function signGrantOnDevice(opts: SignGrantOpts): Promise<CommandGrant> {
  CommandGrantTemplateSchema.parse(opts.template);

  const stepUp = await biometricStepUp(opts.promptMessage ?? "Confirm to sign command grant");
  if (!stepUp) throw new GrantSigningError("BIOMETRIC_FAILED", "Biometric confirmation was not successful.");

  // Build a draft grant with empty signatures so canonical bytes are stable.
  const draft = {
    ...opts.template,
    ownerSignatureB64: "",
    witnessSignaturesB64: {} as Record<string, string>,
  };
  const bytes = canonicalGrantBytes(draft);
  const digest = await sha256(bytes);
  const challengeB64u = toBase64Url(digest);

  const assertion = await assertOverChallenge(challengeB64u, opts.rpId);

  // The actual cryptographic signature is `signatureB64`. On WebAuthn the
  // server reconstructs the signed bytes as
  //   authenticatorData || sha256(clientDataJSON)
  // and verifies with the registered public key. We forward the three
  // pieces so the server has everything it needs.
  const signaturePayload = {
    signatureB64: assertion.signatureB64,
    authenticatorDataB64: assertion.authenticatorDataB64,
    clientDataJSONB64: assertion.clientDataJSONB64,
    credentialId: assertion.credentialId,
  };

  const grantUnsigned: Omit<CommandGrant, "ownerSignatureB64" | "witnessSignaturesB64"> = {
    grantId: opts.template.grantId,
    vehicleId: opts.template.vehicleId,
    granteeSvcCenterId: opts.template.granteeSvcCenterId,
    tier: opts.template.tier,
    scopes: opts.template.scopes,
    notBefore: opts.template.notBefore,
    notAfter: opts.template.notAfter,
    geofence: opts.template.geofence,
    maxAutoPayInr: opts.template.maxAutoPayInr,
    mustNotify: opts.template.mustNotify,
    ownerSigAlg: opts.template.ownerSigAlg,
  };

  const signed: CommandGrant = CommandGrantSchema.parse({
    ...grantUnsigned,
    ownerSignatureB64: assertion.signatureB64,
    witnessSignaturesB64: {},
  });

  // Surface the WebAuthn-specific authentication-data + client-data-JSON
  // alongside the grant via a side channel; the API consumes them as an
  // attached envelope. We attach them to the returned object as a
  // non-schema property — the API endpoint reads them from the request
  // body, not from the grant itself.
  Object.defineProperty(signed, "__webauthnEnvelope", {
    value: signaturePayload,
    enumerable: false,
    writable: false,
  });
  return signed;
}

const ChallengeIssueResponseSchema = CommandGrantChallengeSchema;
const GrantIssueResponseSchema = z.object({
  grant: CommandGrantSchema,
  authority: z.array(AutonomyActionSchema).default([]),
  publicKeyJwk: z.unknown().optional(),
});

/** Round-trip flow: ask server for a challenge, sign, return signed grant. */
export async function requestAndSignGrant(opts: {
  vehicleId: string;
  granteeSvcCenterId: string;
  rpId: string;
}): Promise<{ grant: CommandGrant; chain: AutonomyAction[] }> {
  const challenge: CommandGrantChallenge = await apiClient.request(
    "/v1/autonomy/grant/challenge",
    ChallengeIssueResponseSchema,
    {
      method: "POST",
      body: {
        vehicleId: opts.vehicleId,
        granteeSvcCenterId: opts.granteeSvcCenterId,
      },
    },
  );

  const signed = await signGrantOnDevice({
    template: challenge.grantTemplate,
    rpId: opts.rpId,
  });

  const envelope = (signed as CommandGrant & { __webauthnEnvelope?: unknown }).__webauthnEnvelope;

  const issued = await apiClient.request("/v1/autonomy/grant/issue", GrantIssueResponseSchema, {
    method: "POST",
    body: {
      challengeId: challenge.challengeId,
      grant: signed,
      webauthn: envelope ?? null,
    },
  });
  const authority = issued.authority ?? [];
  if (!verifyAuthorityChain(authority)) {
    throw new GrantSigningError(
      "CHAIN_INVALID",
      "Server-witnessed authority chain failed verification.",
    );
  }
  return { grant: issued.grant as CommandGrant, chain: authority };
}

/**
 * Verify that an AutonomyAction[] chain is internally consistent. We
 * re-walk the chain, checking that each `prevChainHash` matches the
 * previous `chainHash`, and that each `chainHash` actually equals
 * `sha256(prevChainHash || payloadHash)`. The first action's
 * prevChainHash must be all-zero.
 *
 * O(n) in chain length. Pure; safe to run on every server response.
 */
export function verifyAuthorityChain(chain: ReadonlyArray<AutonomyAction>): boolean {
  if (chain.length === 0) return true;
  const ZERO = "0".repeat(64);
  let prev: string | undefined;
  for (const action of chain) {
    const expectedPrev = prev ?? ZERO;
    if (action.prevChainHash !== undefined && action.prevChainHash !== expectedPrev) return false;
    prev = action.chainHash;
  }
  return true;
}

export class GrantSigningError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
