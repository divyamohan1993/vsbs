// @vsbs/shared — single public surface.
//
// Every type, schema, and policy exported from this package is a *contract*
// between the web app, the API, the agent tool layer, and any future
// integrators. The schemas (Zod) are the single source of truth for
// validation; the types are inferred from them so they cannot drift.
//
// References: see docs/architecture.md and the individual research docs
// in docs/research/*.md.

export * from "./schema/index.js";
export * from "./safety.js";
export * from "./wellbeing.js";
export * from "./autonomy.js";
export * from "./phm.js";
export * from "./sensors.js";
export * from "./constants.js";
export * from "./demo.js";
export * from "./payment.js";
export * from "./auth.js";
export * from "./takeover.js";
export * from "./commandgrant-lifecycle.js";
export * from "./autonomy-registry.js";
