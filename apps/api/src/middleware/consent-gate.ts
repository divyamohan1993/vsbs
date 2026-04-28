// =============================================================================
// requireConsent — middleware factory that gates a route on a specific
// consent purpose for the current owner. Returns 409 with a structured error
// shape `{error: {code: 'consent-required', purpose, currentVersion,
// noticeUrl}}` if the owner has not granted, has revoked, or holds a stale
// version of the consent.
//
// Owner identity is derived from the same `x-vsbs-owner` header used in
// /v1/me; real auth replaces this in v1.0 (Phase 6 hardening).
// =============================================================================

import type { Context, MiddlewareHandler } from "hono";
import {
  type ConsentManager,
  DEFAULT_PURPOSE_REGISTRY,
  latestVersions,
} from "@vsbs/compliance";
import type { ConsentPurpose } from "@vsbs/shared";

import type { AppEnv } from "./security.js";
import { errBody } from "./security.js";

export interface ConsentGateOptions {
  manager: ConsentManager;
  ownerOf?: (c: Context<AppEnv>) => string;
}

const defaultOwnerOf = (c: Context<AppEnv>): string =>
  c.req.header("x-vsbs-owner") ?? "demo-owner";

export function requireConsent(
  purpose: ConsentPurpose,
  opts: ConsentGateOptions,
): MiddlewareHandler<AppEnv> {
  const ownerOf = opts.ownerOf ?? defaultOwnerOf;
  const desc = DEFAULT_PURPOSE_REGISTRY[purpose];
  const versions = latestVersions();
  return async (c, next) => {
    const owner = ownerOf(c);
    const granted = await opts.manager.hasEffective(owner, purpose);
    if (!granted) {
      return c.json(
        {
          error: {
            code: "consent-required",
            message: `Consent for purpose '${purpose}' is required for this action.`,
            purpose,
            currentVersion: versions[purpose],
            noticeUrl: desc.noticeUrl ?? null,
            requestId: c.get("requestId"),
          },
        },
        409,
      );
    }
    // Stale version? Treat as needs-reconsent for opt-in purposes; the user
    // should bump their consent version before proceeding. The contract
    // is the same 409 envelope.
    const need = await opts.manager.requiresReConsent(owner, versions);
    if (need.includes(purpose)) {
      return c.json(
        {
          error: {
            code: "consent-stale",
            message: `Consent for purpose '${purpose}' is on an older notice version. Please re-consent.`,
            purpose,
            currentVersion: versions[purpose],
            noticeUrl: desc.noticeUrl ?? null,
            requestId: c.get("requestId"),
          },
        },
        409,
      );
    }
    await next();
  };
}

export { DEFAULT_PURPOSE_REGISTRY };

// Convenience helper to build a process-wide ConsentManager + the matching
// gate factory. Tests construct their own inside route builders.
export function buildConsentGate(manager: ConsentManager): {
  gate: (purpose: ConsentPurpose) => MiddlewareHandler<AppEnv>;
} {
  return {
    gate: (purpose: ConsentPurpose) => requireConsent(purpose, { manager }),
  };
}

// errBody is re-exported for routes that want to fail closed in unusual
// shapes; in normal use the gate response above suffices.
export { errBody };
