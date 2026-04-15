// =============================================================================
// Grant chain store — in-memory append-only log backing the autonomy
// authority chain. Each entry is linked by SHA-256 Merkle hashing so
// tampering at any position invalidates every hash downstream.
//
// The store is intentionally minimal. A Firestore-backed store with the
// same interface will be dropped in for production; the sim and live
// drivers must share this interface.
// =============================================================================

import type { AutonomyAction, CommandGrant } from "@vsbs/shared";
import {
  appendAuthority,
  actionPayloadHash,
  buildRevocationAction,
} from "@vsbs/shared/commandgrant-lifecycle";

export interface GrantRecord {
  grant: CommandGrant;
  actions: AutonomyAction[];
}

export interface GrantChainStoreLike {
  putGrant(grant: CommandGrant): void;
  getGrant(grantId: string): GrantRecord | undefined;
  appendAction(
    grantId: string,
    next: Omit<AutonomyAction, "chainHash" | "prevChainHash">,
  ): Promise<AutonomyAction>;
  listActions(grantId: string): readonly AutonomyAction[];
}

export class MemoryGrantChainStore implements GrantChainStoreLike {
  readonly #records = new Map<string, GrantRecord>();

  putGrant(grant: CommandGrant): void {
    const existing = this.#records.get(grant.grantId);
    if (existing) {
      existing.grant = grant;
      return;
    }
    this.#records.set(grant.grantId, { grant, actions: [] });
  }

  getGrant(grantId: string): GrantRecord | undefined {
    return this.#records.get(grantId);
  }

  async appendAction(
    grantId: string,
    next: Omit<AutonomyAction, "chainHash" | "prevChainHash">,
  ): Promise<AutonomyAction> {
    const rec = this.#records.get(grantId);
    if (!rec) throw new Error(`grant ${grantId} not found`);
    const prev = rec.actions.length > 0 ? rec.actions[rec.actions.length - 1]! : null;
    const linked = await appendAuthority(prev, next);
    rec.actions.push(linked);
    return linked;
  }

  listActions(grantId: string): readonly AutonomyAction[] {
    return this.#records.get(grantId)?.actions ?? [];
  }
}

/**
 * Convenience: build + append a `grant-revoked` entry on the chain.
 */
export async function appendRevocation(
  store: GrantChainStoreLike,
  grantId: string,
  reason: string,
): Promise<AutonomyAction> {
  const entry = await buildRevocationAction(grantId, reason);
  return store.appendAction(grantId, entry);
}

/**
 * Convenience: build + append an arbitrary action on the chain. `kind`
 * must be one of the values in AutonomyAction["kind"].
 */
export async function appendKind(
  store: GrantChainStoreLike,
  grantId: string,
  kind: AutonomyAction["kind"],
  extra?: unknown,
): Promise<AutonomyAction> {
  const actionId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const payloadHash = await actionPayloadHash({ actionId, grantId, timestamp, kind }, extra);
  return store.appendAction(grantId, { actionId, grantId, timestamp, kind, payloadHash });
}
