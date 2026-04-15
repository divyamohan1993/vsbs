// =============================================================================
// AVP adapter interface. Every commercial Automated Valet Parking provider
// (Mercedes-Bosch IPP, Ford BlueCruise Park, Valeo Cyber Valet, etc.) must
// implement this 5-method contract. The sim and live drivers of a given
// adapter implement the same interface; promotion from sim to live is an
// env var flip and nothing else.
//
// The method names are fixed per the VSBS architecture brief and must not
// be renamed — the command-grant router is wired to these exact names.
// =============================================================================

import type { CommandGrant, AutonomyAction, GrantScope } from "@vsbs/shared";

export interface AvpAuthResult {
  sessionId: string;
  expiresAt: string;
}

export interface AvpState {
  vehicleId: string;
  /** Current location in the AVP site. "awaiting" before the vehicle is handed to the site. */
  stage: "awaiting" | "arrived" | "driving" | "parked" | "returning" | "released";
  slotId: string | null;
  updatedAt: string;
}

export interface AvpPerformScope {
  grantId: string;
  scope: GrantScope;
}

export interface AvpPerformResult {
  /** A chain of authority entries the adapter emitted. */
  actions: AutonomyAction[];
  /** The new observable state after the scope executed. */
  state: AvpState;
}

export interface AvpAdapter {
  readonly provider: string;
  readonly mode: "sim" | "live";

  authenticate(): Promise<AvpAuthResult>;
  readState(vehicleId: string): Promise<AvpState>;
  acceptGrant(grant: CommandGrant): Promise<AutonomyAction>;
  performScope(input: AvpPerformScope): Promise<AvpPerformResult>;
  revokeGrant(grantId: string, reason: string): Promise<AutonomyAction>;
}
