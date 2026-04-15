// =============================================================================
// Mercedes-Benz + Bosch Intelligent Park Pilot (IPP) adapter.
//
// Sim and live drivers share the same state machine. The sim driver walks
// the full Stuttgart P6 flow deterministically:
//   handshake -> acceptGrant -> slot reservation -> autonomous parking ->
//   arrival ping -> revocation on stop.
// The live driver posts to MERCEDES_IPP_BASE using a bearer token. When
// keys are absent in live mode, the adapter fails fast with a clear error
// so operators see the misconfiguration at startup, not in production.
//
// References:
//   Mercedes-Benz Group press release 2022-12-05 "Mercedes-Benz and
//     Bosch receive approval for driverless parking service at APCOA P6".
//   Bosch "Automated Valet Parking — SAE Level 4" technical brief.
//   UNECE R157 Annex 3 — geofenced operation conditions.
// =============================================================================

import type { CommandGrant, AutonomyAction, GrantScope } from "@vsbs/shared";
import type { AvpAdapter, AvpAuthResult, AvpState, AvpPerformScope, AvpPerformResult } from "./types.js";
import {
  type GrantChainStoreLike,
  appendKind,
  appendRevocation,
} from "../grant-chain.js";

export interface MercedesIppConfig {
  mode: "sim" | "live";
  store: GrantChainStoreLike;
  base?: string | undefined;
  token?: string | undefined;
  fetchImpl?: typeof fetch;
}

const SCOPE_KIND_MAP: Readonly<Record<GrantScope, AutonomyAction["kind"]>> = Object.freeze({
  diagnose: "diagnose-start",
  "drive-to-bay": "move-start",
  repair: "repair-start",
  "test-drive": "move-start",
  "drive-home": "move-start",
});

export class MercedesBoschAvpAdapter implements AvpAdapter {
  readonly provider = "mercedes-bosch-ipp" as const;
  readonly mode: "sim" | "live";
  readonly #cfg: MercedesIppConfig;
  readonly #state = new Map<string, AvpState>();

  constructor(cfg: MercedesIppConfig) {
    this.#cfg = cfg;
    this.mode = cfg.mode;
    if (cfg.mode === "live") {
      if (!cfg.base || !cfg.token) {
        throw new Error(
          "Mercedes IPP live mode requires MERCEDES_IPP_BASE and MERCEDES_IPP_TOKEN",
        );
      }
    }
  }

  async authenticate(): Promise<AvpAuthResult> {
    if (this.mode === "sim") {
      return {
        sessionId: `ipp_sim_${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
    }
    const res = await this.#fetch(`${this.#cfg.base}/v1/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#cfg.token}` },
    });
    if (!res.ok) throw new Error(`Mercedes IPP auth failed ${res.status}`);
    const body = (await res.json()) as AvpAuthResult;
    return body;
  }

  async readState(vehicleId: string): Promise<AvpState> {
    if (this.mode === "sim") {
      return (
        this.#state.get(vehicleId) ?? {
          vehicleId,
          stage: "awaiting",
          slotId: null,
          updatedAt: new Date().toISOString(),
        }
      );
    }
    const res = await this.#fetch(
      `${this.#cfg.base}/v1/vehicles/${encodeURIComponent(vehicleId)}/state`,
      { headers: { authorization: `Bearer ${this.#cfg.token}` } },
    );
    if (!res.ok) throw new Error(`Mercedes IPP readState failed ${res.status}`);
    return (await res.json()) as AvpState;
  }

  async acceptGrant(grant: CommandGrant): Promise<AutonomyAction> {
    this.#cfg.store.putGrant(grant);
    const action = await appendKind(this.#cfg.store, grant.grantId, "grant-accepted", {
      provider: this.provider,
      geofence: grant.geofence,
    });
    if (this.mode === "live") {
      const res = await this.#fetch(`${this.#cfg.base}/v1/grants`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#cfg.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ grantId: grant.grantId, vehicleId: grant.vehicleId }),
      });
      if (!res.ok) throw new Error(`Mercedes IPP acceptGrant failed ${res.status}`);
    } else {
      this.#state.set(grant.vehicleId, {
        vehicleId: grant.vehicleId,
        stage: "arrived",
        slotId: `P6-${grant.grantId.slice(0, 4).toUpperCase()}`,
        updatedAt: new Date().toISOString(),
      });
    }
    return action;
  }

  async performScope(input: AvpPerformScope): Promise<AvpPerformResult> {
    const rec = this.#cfg.store.getGrant(input.grantId);
    if (!rec) throw new Error(`grant ${input.grantId} not found`);
    const vehicleId = rec.grant.vehicleId;

    const startKind = SCOPE_KIND_MAP[input.scope];
    const startAction = await appendKind(this.#cfg.store, input.grantId, startKind, {
      scope: input.scope,
    });
    this.#setSimStage(vehicleId, "driving");

    // Final stage depends on the scope. drive-to-bay -> parked; diagnose/repair ->
    // finish event; drive-home / test-drive -> released.
    const endKind: AutonomyAction["kind"] =
      input.scope === "diagnose"
        ? "diagnose-finish"
        : input.scope === "repair"
          ? "repair-finish"
          : "move-stop";
    const endAction = await appendKind(this.#cfg.store, input.grantId, endKind, {
      scope: input.scope,
    });
    const nextStage: AvpState["stage"] =
      input.scope === "drive-to-bay"
        ? "parked"
        : input.scope === "drive-home" || input.scope === "test-drive"
          ? "released"
          : "parked";
    this.#setSimStage(vehicleId, nextStage);

    if (this.mode === "live") {
      const res = await this.#fetch(
        `${this.#cfg.base}/v1/grants/${encodeURIComponent(input.grantId)}/scopes/${encodeURIComponent(input.scope)}`,
        { method: "POST", headers: { authorization: `Bearer ${this.#cfg.token}` } },
      );
      if (!res.ok) throw new Error(`Mercedes IPP performScope failed ${res.status}`);
    }

    const state = await this.readState(vehicleId);
    return { actions: [startAction, endAction], state };
  }

  async revokeGrant(grantId: string, reason: string): Promise<AutonomyAction> {
    const action = await appendRevocation(this.#cfg.store, grantId, reason);
    const rec = this.#cfg.store.getGrant(grantId);
    if (rec) this.#setSimStage(rec.grant.vehicleId, "released");
    if (this.mode === "live") {
      const res = await this.#fetch(
        `${this.#cfg.base}/v1/grants/${encodeURIComponent(grantId)}`,
        { method: "DELETE", headers: { authorization: `Bearer ${this.#cfg.token}` } },
      );
      if (!res.ok) throw new Error(`Mercedes IPP revokeGrant failed ${res.status}`);
    }
    return action;
  }

  // ---------- helpers ----------

  #setSimStage(vehicleId: string, stage: AvpState["stage"]): void {
    if (this.mode !== "sim") return;
    const prev = this.#state.get(vehicleId);
    this.#state.set(vehicleId, {
      vehicleId,
      stage,
      slotId: prev?.slotId ?? null,
      updatedAt: new Date().toISOString(),
    });
  }

  #fetch(url: string, init?: RequestInit): Promise<Response> {
    const impl = this.#cfg.fetchImpl ?? fetch;
    return impl(url, init);
  }
}
