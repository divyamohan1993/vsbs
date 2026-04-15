// =============================================================================
// Agent roles — each corresponds to a LangGraph node in the supervisor.
// The role is what picks the (provider, model); business logic is invariant.
// =============================================================================

export const AgentRole = {
  Concierge: "concierge",
  Intake: "intake",
  Diagnosis: "diagnosis",
  Dispatch: "dispatch",
  Wellbeing: "wellbeing",
  Verifier: "verifier",
  Autonomy: "autonomy",
  Payment: "payment",
} as const;
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

export const ALL_ROLES: readonly AgentRole[] = Object.values(AgentRole);
