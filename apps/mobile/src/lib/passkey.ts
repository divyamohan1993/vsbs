// =============================================================================
// Native passkey (WebAuthn / FIDO2) integration for the mobile owner app.
//
// We layer two libraries:
//
//   * react-native-passkey  — bridges to Apple's ASAuthorizationController
//                              (iOS 16+) and Android Credential Manager
//                              (Android 13+) for actual platform-key
//                              registration + assertion.
//
//   * expo-local-authentication — Face ID / Touch ID / fingerprint /
//                              pattern as a "step-up confirmation" before
//                              we even ask the platform for a passkey
//                              assertion. Catches the case where the user
//                              has a passkey but is asleep / phone is
//                              borrowed.
//
// The endpoint contract matches `apps/api/src/routes/passkey.ts` (owned by
// the security peer agent):
//
//   POST /v1/auth/passkey/register/begin
//   POST /v1/auth/passkey/register/finish
//   POST /v1/auth/passkey/auth/begin
//   POST /v1/auth/passkey/auth/finish
//
// Each "begin" returns a server challenge; each "finish" submits the
// authenticator response. We never trust the client to choose its own
// challenge.
// =============================================================================

import * as LocalAuthentication from "expo-local-authentication";
import { Passkey, type PasskeyCreateResult, type PasskeyGetResult } from "react-native-passkey";

import { apiClient } from "./api";
import { z } from "zod";

const RegisterBeginResponseSchema = z.object({
  rp: z.object({ id: z.string(), name: z.string() }),
  user: z.object({ id: z.string(), name: z.string(), displayName: z.string() }),
  challenge: z.string(),
  pubKeyCredParams: z.array(z.object({ type: z.literal("public-key"), alg: z.number().int() })),
  timeout: z.number().int().positive(),
  attestation: z.enum(["none", "direct", "indirect", "enterprise"]),
  authenticatorSelection: z.object({
    authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
    userVerification: z.enum(["required", "preferred", "discouraged"]),
    residentKey: z.enum(["required", "preferred", "discouraged"]).optional(),
  }),
});

const AuthBeginResponseSchema = z.object({
  rpId: z.string(),
  challenge: z.string(),
  timeout: z.number().int().positive(),
  userVerification: z.enum(["required", "preferred", "discouraged"]),
  allowCredentials: z
    .array(z.object({ id: z.string(), type: z.literal("public-key") }))
    .default([]),
});

export interface PasskeyAvailability {
  hardware: boolean;
  enrolled: boolean;
  passkeySupported: boolean;
}

export async function passkeyAvailability(): Promise<PasskeyAvailability> {
  const [hardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  let supported = false;
  try {
    supported = Passkey.isSupported();
  } catch {
    supported = false;
  }
  return { hardware, enrolled, passkeySupported: supported };
}

export async function biometricStepUp(prompt: string): Promise<boolean> {
  const avail = await passkeyAvailability();
  if (!avail.hardware || !avail.enrolled) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: prompt,
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });
  return result.success;
}

export async function registerPasskey(opts: { username: string }): Promise<PasskeyCreateResult> {
  const begin = await apiClient.request("/v1/auth/passkey/register/begin", RegisterBeginResponseSchema, {
    method: "POST",
    body: { username: opts.username },
  });
  const authenticatorSelection: NonNullable<Parameters<typeof Passkey.create>[0]["authenticatorSelection"]> = {
    userVerification: begin.authenticatorSelection.userVerification,
    ...(begin.authenticatorSelection.authenticatorAttachment !== undefined
      ? { authenticatorAttachment: begin.authenticatorSelection.authenticatorAttachment }
      : {}),
    ...(begin.authenticatorSelection.residentKey !== undefined
      ? { residentKey: begin.authenticatorSelection.residentKey }
      : {}),
  };
  const result = await Passkey.create({
    challenge: begin.challenge,
    rp: begin.rp,
    user: begin.user,
    pubKeyCredParams: begin.pubKeyCredParams,
    timeout: begin.timeout,
    attestation: begin.attestation,
    authenticatorSelection,
  });
  await apiClient.request(
    "/v1/auth/passkey/register/finish",
    z.object({ ok: z.literal(true), credentialId: z.string() }),
    {
      method: "POST",
      body: { username: opts.username, attestation: result },
    },
  );
  return result;
}

export async function signInWithPasskey(opts: { username?: string }): Promise<PasskeyGetResult> {
  const begin = await apiClient.request("/v1/auth/passkey/auth/begin", AuthBeginResponseSchema, {
    method: "POST",
    body: opts.username ? { username: opts.username } : {},
    authenticated: false,
  });
  const result = await Passkey.get({
    challenge: begin.challenge,
    rpId: begin.rpId,
    timeout: begin.timeout,
    userVerification: begin.userVerification,
    allowCredentials: begin.allowCredentials ?? [],
  });
  const finish = await apiClient.request(
    "/v1/auth/passkey/auth/finish",
    z.object({ ok: z.literal(true), token: z.string(), subject: z.string() }),
    {
      method: "POST",
      body: { assertion: result },
      authenticated: false,
    },
  );
  await apiClient.setToken(finish.token, finish.subject);
  return result;
}

export interface AssertionForGrant {
  clientDataJSONB64: string;
  authenticatorDataB64: string;
  signatureB64: string;
  credentialId: string;
}

/**
 * Drive a passkey assertion whose `clientDataJSON.challenge` is the
 * canonical-grant SHA-256 we pass in. Used by grant-signing to mint a
 * WebAuthn signature over the exact bytes the server later co-signs.
 */
export async function assertOverChallenge(challengeB64u: string, rpId: string): Promise<AssertionForGrant> {
  const result = await Passkey.get({
    challenge: challengeB64u,
    rpId,
    timeout: 60_000,
    userVerification: "required",
    allowCredentials: [],
  });
  // react-native-passkey returns base64-url encoded fields.
  const response = result.response;
  return {
    clientDataJSONB64: response.clientDataJSON,
    authenticatorDataB64: response.authenticatorData,
    signatureB64: response.signature,
    credentialId: result.id,
  };
}
