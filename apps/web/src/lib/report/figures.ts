// =============================================================================
// Capstone report figure paths. SVG sources live under
// apps/web/public/report/figures/ so they are served as static assets and
// browsers render them natively via <img src>. The DOCX route pre-rasterises
// the same files to PNG (apps/web/public/report/figures/png/) so Word can
// embed them. Captions live with the chapter content in content.ts.
//
// Add a new figure: drop a .svg under public/report/figures/ and reference
// it from a content block as { kind: "svg", src: "/report/figures/x.svg" }.
// =============================================================================

export const FIGURE_PATHS = {
	architecture: "/report/figures/architecture.svg",
	conciergeFlow: "/report/figures/concierge-flow.svg",
	defenseInDepth: "/report/figures/defense-in-depth.svg",
	r157: "/report/figures/r157.svg",
	testLadder: "/report/figures/test-ladder.svg",
	auditClosure: "/report/figures/audit-closure.svg",
	personas: "/report/figures/personas.svg",
	techStack: "/report/figures/tech-stack.svg",
	paymentFsm: "/report/figures/payment-fsm.svg",
	ekfFusion: "/report/figures/ekf-fusion.svg",
	wellbeingRadar: "/report/figures/wellbeing-radar.svg",
	rulKnee: "/report/figures/rul-knee.svg",
	roadmap: "/report/figures/roadmap.svg",
} as const;

export type FigureKey = keyof typeof FIGURE_PATHS;
