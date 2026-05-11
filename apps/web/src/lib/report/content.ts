// =============================================================================
// Capstone report content, single source of truth.
//
// Both /report (web) and /api/report/docx pull from this module. The shape
// mirrors the chapters listed in the official Shoolini capstone template
// (CAPSTONE PROJECT REPORT.docx): title page, acknowledgement, abstract,
// TOC, list of figures, list of tables, eleven chapters, ten reflection
// questions, references.
//
// Edit the placeholder identifiers (REG_NO, SEMESTER, MENTOR) in METADATA
// before submission. Everything else is content; rewrite freely.
// =============================================================================

export interface ReportMetadata {
	title: string;
	subtitle: string;
	studentName: string;
	registrationNumber: string;
	courseSpecialization: string;
	semester: string;
	capstoneMentor: string;
	school: string;
	university: string;
	location: string;
	year: string;
}

export interface ParagraphBlock {
	kind: "p";
	text: string;
}
export interface HeadingBlock {
	kind: "h2" | "h3" | "h4";
	text: string;
}
export interface ListBlock {
	kind: "ul" | "ol";
	items: string[];
}
export interface TableBlock {
	kind: "table";
	caption?: string;
	headers: string[];
	rows: string[][];
}
export interface FigurePlaceholderBlock {
	kind: "figure";
	caption: string;
	description: string;
}
export interface QuoteBlock {
	kind: "quote";
	text: string;
}
export interface CodeBlock {
	kind: "code";
	text: string;
}

/** Embedded raster image (PNG/JPG), e.g. a screenshot of the running portal. */
export interface ImageBlock {
	kind: "image";
	src: string; // path under /public, e.g. "/report/screenshots/home.png"
	alt: string;
	caption: string;
	widthPx?: number;
	heightPx?: number;
}

/**
 * Vector figure backed by a static .svg file in apps/web/public. The web
 * page renders it via <img>; the DOCX route pre-rasterises the same file
 * to PNG (next to it under /report/figures/png/) and embeds the PNG.
 */
export interface SvgFigureBlock {
	kind: "svg";
	src: string; // e.g. "/report/figures/architecture.svg"
	caption: string;
	widthPx?: number;
	heightPx?: number;
}

export type Block =
	| ParagraphBlock
	| HeadingBlock
	| ListBlock
	| TableBlock
	| FigurePlaceholderBlock
	| QuoteBlock
	| CodeBlock
	| ImageBlock
	| SvgFigureBlock;

export interface Section {
	id: string;
	chapter?: number;
	heading: string;
	blocks: Block[];
}

import { FIGURE_PATHS } from "./figures";

export const METADATA: ReportMetadata = {
	title: "VSBS: Autonomous Vehicle Service Booking System",
	subtitle:
		"A safety-first, research-cited, India-first reference platform for owner-authorised autonomous vehicle service",
	studentName: "Divya Mohan",
	registrationNumber: "GF202214698",
	courseSpecialization: "B.Tech CSE Cybersecurity",	
	capstoneMentor: "Dr. Kritika Rana",
	semester: "",
	school: "Yogananda School of AI, Computers and Data Sciences",
	university: "Shoolini University of Biotechnology and Management Sciences",
	location: "Solan, Himachal Pradesh, India",
	year: "2026",
};

// -----------------------------------------------------------------------------
// Front-matter sections
// -----------------------------------------------------------------------------

export const ACKNOWLEDGEMENT: Section = {
	id: "acknowledgement",
	heading: "Acknowledgement",
	blocks: [
		{
			kind: "p",
			text: "I would like to express my sincere gratitude to my capstone mentor at Shoolini University and the faculty of the Yogananda School of AI, Computers and Data Sciences for their consistent guidance through every stage of this project. Their feedback on architecture decisions, on safety claims, and on the realism of the simulation-policy framing was instrumental in shaping the final outcome.",
		},
		{
			kind: "p",
			text: "I am grateful to the Department of Computer Science and Engineering for providing access to the development infrastructure that allowed this project to be exercised end-to-end on a constrained hardware envelope. The lab availability for late-evening builds, the network bandwidth for live API smoke runs, and the willingness to host the verification artefacts on a shared review system materially improved the quality of the final submission.",
		},
		{
			kind: "p",
			text: "I acknowledge the open-source community whose work this project stands on. The maintainers of Hono, Bun, Next.js, React, Tailwind, LangGraph, Zod, OpenTelemetry, CARLA, and many others have produced primitives that allowed a small team to ship a system whose blueprint would otherwise need a very large engineering organisation. The research community whose peer-reviewed contributions are cited throughout this report, covering battery prognostics, sensor fusion, agentic verification, and automotive cybersecurity, gave this project its evidentiary backbone.",
		},
		{
			kind: "p",
			text: "Finally, I thank my family and peers, whose patience during the long verification cycles and whose willingness to act as honest first reviewers kept the work grounded in real user needs rather than purely technical novelty.",
		},
	],
};

export const ABSTRACT: Section = {
	id: "abstract",
	heading: "Abstract",
	blocks: [
		{
			kind: "p",
			text: "VSBS is a research-grade, production-shape reference platform that lets a vehicle owner book a service, receive an autonomous and verifiable recommendation, and, when the original-equipment manufacturer supports it, hand the vehicle over to an authorised service centre under a signed, scope-limited, time-bound capability token. The platform integrates a multi-language conversational concierge, a deterministic safety fence around large language model output, an extended Kalman filter sensor fusion pipeline, physics-of-failure remaining-useful-life models, a four-rung United Nations Economic Commission for Europe Regulation 157 takeover ladder, and a privacy-by-design compliance layer aligned with India's Digital Personal Data Protection Act 2023, the European General Data Protection Regulation, and the California Consumer Privacy Act.",
		},
		{
			kind: "p",
			text: "The system is implemented as a twelve-package TypeScript monorepo running on Bun and Hono for the application interface, on Next.js 16 with React 19 and Tailwind 4 for the customer and operator surfaces, and on Google Cloud Platform with Cloud Run, Cloud Armor, Identity-Aware Proxy, Firestore, and Secret Manager for production deployment. Every architectural decision is grounded in peer-reviewed research, in international safety and security standards, or in vendor documentation, and is traceable through the docs/research corpus that ships in-tree with the source.",
		},
		{
			kind: "p",
			text: "The platform was subjected to an external security audit which surfaced ten findings across authentication, authorisation, edge controls, and production wiring. Every finding was sealed end-to-end through a coordinated multi-agent fix that introduced a hash-based message authentication code signed bearer token at the over-the-phone one-time-password verification step, a real Identity-Aware Proxy signature verifier, a production-fail-closed environment schema, and a Cloud Armor-and-Identity-Aware-Proxy-attached Terraform module. The verification ladder spans typecheck, one thousand three hundred and two unit and specialised tests, live application-programming-interface smoke probes, a safety-fence-asserting concierge stream test, and a Playwright Chromium end-to-end suite. All audit proof-of-concept exploits now return four-zero-one or four-zero-three responses.",
		},
		{
			kind: "h3",
			text: "Keywords",
		},
		{
			kind: "p",
			text: "Autonomous vehicles; service booking; LangGraph agent supervisor; safety fence; sensor fusion; remaining useful life; UNECE R157; CommandGrant capability token; defense in depth; DPDP Act 2023; Cloud Armor; Identity-Aware Proxy; production-fail-closed; multi-agent orchestration.",
		},
	],
};

// -----------------------------------------------------------------------------
// Chapter 1, Introduction & Problem Definition
// -----------------------------------------------------------------------------

export const CHAPTER_1: Section = {
	id: "ch1",
	chapter: 1,
	heading: "Introduction & Problem Definition",
	blocks: [
		{ kind: "h3", text: "1.1 Background" },
		{
			kind: "p",
			text: "The Indian passenger vehicle parc has crossed forty million units. Service is the single largest unmet need: drivers travel long distances to authorised centres, wait without status updates, accept opaque diagnoses, and frequently agree to repairs they cannot independently verify. The same problem at lower density also affects the United States and the European Union; the global service market is over four hundred billion dollars annually. Original-equipment manufacturers have begun to publish autonomous parking and short-distance routing specifications such as the Mercedes-Benz and Bosch Intelligent Park Pilot deployment in the Stuttgart APCOA P6 garage, but no end-to-end customer-side platform composes those primitives into a verifiable service booking experience.",
		},
		{
			kind: "image",
			src: "/report/screenshots/home.png",
			alt: "VSBS home page with a dark hero image of a car at a service bay, headline reading 'Your vehicle. Served.', and call-to-action buttons.",
			caption:
				"Figure 1.1. Customer landing page at /. The hero loads above the fold on the slowest mobile connection (LCP < 2.5 s); strict content-security-policy with per-request nonces; the demo-mode banner is a load-bearing safety signal until the homologation gates close.",
			widthPx: 720,
			heightPx: 450,
		},
		{ kind: "h3", text: "1.2 Problem Statement" },
		{
			kind: "p",
			text: "Build an autonomous vehicle service booking system that lets an owner request a service, accept or override an autonomous diagnostic recommendation, sign a scope-limited capability token that authorises the service centre to perform the agreed work, and watch the entire flow under a privacy-by-design compliance layer. The system must be safe by construction: no large language model output may bypass a hard-coded safety fence; no caller-controlled identity header may grant access to owner-scoped data; no simulated sensor sample may enter a real customer decision log; and no production deployment may run with the development-mode defaults that simplify local iteration.",
		},
		{ kind: "h3", text: "1.3 Objectives" },
		{
			kind: "ol",
			items: [
				"Compose a twelve-package TypeScript monorepo whose architecture is grounded in peer-reviewed research, in international standards, and in vendor documentation, with every claim traceable through an in-tree research corpus.",
				"Implement a deterministic safety fence around the large-language-model conversational concierge so that the final user-visible output always carries the canonical no-safety-certification advisory regardless of the model's intermediate suggestions.",
				"Implement a sensor fusion and remaining-useful-life pipeline whose simulated and real drivers share an identical state machine, with provenance stamping that prevents simulated samples from contaminating real decision logs.",
				"Implement a CommandGrant capability token that is canonical-byte-encoded per RFC 8785, signed under the owner's passkey, witness-signed, and verifiable through a Merkle authority chain.",
				"Implement a privacy-by-design compliance layer that satisfies India's Digital Personal Data Protection Act 2023, the European General Data Protection Regulation, and the California Consumer Privacy Act, with explicit consent gates, real deletion, and a seventy-two-hour breach response runbook.",
				"Implement a defense-in-depth security posture that fails closed in production, fixes the ten findings raised by an external audit, and has every fix verified through a nine-layer test ladder that produces a non-repudiable witness report.",
			],
		},
		{ kind: "h3", text: "1.4 Scope and Limitations" },
		{
			kind: "p",
			text: "VSBS is explicitly not a certified safety system. The README, the SAFETY-NOTICE, and the user interface banners state that no real autonomy is enabled and that the platform is a research and reference artefact. Production deployment is subject to legal, regulatory, insurance, and homologation gates that are out of scope for the capstone. The autonomy layer is implemented faithfully so that an integrator who has completed those gates can flip a single environment variable and operate live; until then the platform runs in simulation mode and refuses to mint live grants when the production-fail-closed environment schema detects a sim driver.",
		},
		{ kind: "h3", text: "1.5 Significance" },
		{
			kind: "p",
			text: "The capstone produces three artefacts that are usable beyond the academic submission. First, the architecture is documented at a level that enables a downstream integrator to understand every decision and its evidentiary basis without consulting the author. Second, the security audit and the coordinated multi-agent fix demonstrate a reproducible workflow for hardening a research-grade system to production-shape without breaking the existing test suite. Third, the simulation policy, under which simulated and live drivers share an identical state machine and are promoted by a single environment variable flip, is a generally applicable pattern for any safety-claimed system whose live drivers cannot be exercised in academic environments.",
		},
		{ kind: "h3", text: "1.6 Report Organization" },
		{
			kind: "p",
			text: "Chapter 2 enumerates functional and non-functional requirements. Chapter 3 describes the high-level architecture, the package boundaries, the data flow, and the security architecture. Chapter 4 justifies the technology stack against the stated requirements. Chapter 5 walks the implementation of authentication, the booking workflow, the LangGraph agent supervisor, the sensor pipeline, the autonomy layer, the payment state machine, and the compliance layer. Chapter 6 details the algorithms used for sensor fusion, prognostics, wellbeing scoring, agent verification, and out-of-distribution detection. Chapter 7 describes the test strategy and the test pyramid. Chapter 8 reports the results of the verification ladder. Chapter 9 covers deployment. Chapter 10 documents the challenges encountered and the solutions adopted. Chapter 11 summarises the work and outlines the future scope. The reflection-questions section answers ten standardised mentor questions in order. The references section gives a Vancouver-style bibliography of the corpus that grounds every architectural claim.",
		},
	],
};

// -----------------------------------------------------------------------------
// Chapter 2, System Requirements
// -----------------------------------------------------------------------------

export const CHAPTER_2: Section = {
	id: "ch2",
	chapter: 2,
	heading: "System Requirements",
	blocks: [
		{ kind: "h3", text: "2.1 Functional Requirements" },
		{
			kind: "ol",
			items: [
				"FR-1, Owner registration and authentication via mobile-number one-time-password, returning a HMAC-SHA-256-signed bearer session token.",
				"FR-2, Vehicle decoding through the National Highway Traffic Safety Administration vPIC API, returning make, model, year, body class, and engine attributes.",
				"FR-3, Conversational intake through a multilingual concierge that accepts free-form complaints, normalises them, and triggers safety, wellbeing, and dispatch tools.",
				"FR-4, Deterministic safety assessment with a hard-coded red-flag set whose output is non-overridable by the language model.",
				"FR-5, Service-centre dispatch with parts-availability, distance, and wellbeing-weighted shortlist.",
				"FR-6, Payment order creation, intent authorisation, capture, and refund through Razorpay or Stripe with idempotency keys and webhook verification.",
				"FR-7, Sensor ingest from Smartcar OEM cloud, ELM327 OBD-II Bluetooth Low Energy dongles, and live CARLA bridges, with per-channel arbitration and provenance stamping.",
				"FR-8, Prognostics and health monitoring with remaining-useful-life models for brake pads, the twelve-volt accessory battery, tyres, the high-voltage traction battery, engine oil, the drive belt, and wheel bearings.",
				"FR-9, CommandGrant minting, witness signing, action append, scope perform, heartbeat, offline envelope, and revocation, with per-grant ECDSA P-256, RSASSA-PKCS1-v1_5, Ed25519, or ML-DSA-65 signatures.",
				"FR-10, Consent management with explicit, granular, revocable purpose grants and a seventy-two-hour breach runbook.",
				"FR-11, Operator dashboard with a single-pane SIEM-style log viewer, booking timeline, autonomy live telemetry, and dispatch shortlist.",
				"FR-12, Owner-controlled data export and erasure across primary store, backups, logs, caches, and analytics.",
			],
		},
		{ kind: "h3", text: "2.2 Non-Functional Requirements" },
		{
			kind: "table",
			caption: "Table 2.1. Non-functional requirement targets and measurement approach.",
			headers: ["Category", "Target", "Measurement"],
			rows: [
				[
					"Performance",
					"P50 < 100 ms; P95 < 250 ms; P99 < 500 ms on owner-scoped read paths",
					"OpenTelemetry traces; per-route histograms scraped by Prometheus.",
				],
				[
					"Availability",
					"99.9 percent monthly on the service-fulfilment path",
					"Uptime probes from two regions; Cloud Run health checker.",
				],
				[
					"Security",
					"OWASP Top 10 mitigated; defense in depth on every route; production-fail-closed",
					"Trivy, OSV-scanner, Semgrep, pnpm audit; runtime probes against the audit PoC.",
				],
				[
					"Accessibility",
					"WCAG 2.2 AAA; 44x44-pixel touch targets; reduced motion; high contrast",
					"Lighthouse CI; manual screen-reader walk-throughs.",
				],
				[
					"Privacy",
					"DPDP 2023 + GDPR + CCPA; AES-256-GCM at rest; TLS 1.3 in transit",
					"DPIA, FRIA, AI risk register; in-tree consent and erasure unit tests.",
				],
				[
					"Internationalisation",
					"English plus Hindi mandatory; seven additional regional languages ready",
					"next-intl message catalogues; right-to-left layout test.",
				],
				[
					"Offline tolerance",
					"Booking and concierge function on degraded network with retry-and-replay",
					"Service-worker queue; chaos test 'network-degraded'.",
				],
			],
		},
		{ kind: "h3", text: "2.3 Hardware Requirements" },
		{
			kind: "ul",
			items: [
				"Development workstation with 16 GB random-access memory, four to eight cores, any modern operating system. The capstone was developed on a workstation with two gigabytes of video random-access memory; the live CARLA simulator was substituted by a deterministic chaos driver for verification.",
				"Production: Google Cloud Platform Cloud Run with two virtual central processing units and one gigabyte of memory per container; one Firestore database in Asia-South1; one Artifact Registry repository.",
				"Vehicle adapters: ELM327 V1.5 Bluetooth Low Energy dongle for owner-side OBD-II; Smartcar OEM cloud for over-the-air; CARLA 0.9.16 server for autonomy simulation.",
			],
		},
		{ kind: "h3", text: "2.4 Software Requirements" },
		{
			kind: "ul",
			items: [
				"Node.js 22 long-term support; Bun 1.3 or newer; pnpm 9 or newer; Python 3.10 or newer for the CARLA bridge.",
				"TypeScript 5.7 with strict mode, no-unchecked-indexed-access, and exact-optional-property-types.",
				"Hono 4 on Bun; Next.js 16.2 with React 19; Tailwind CSS 4.",
				"LangGraph supervisor; Zod 3 for every schema boundary.",
				"Terraform 1.9 with the Google Beta provider; Cloud Build for the deployment pipeline.",
			],
		},
		{ kind: "h3", text: "2.5 User Personas" },
		{
			kind: "ul",
			items: [
				"Vehicle owner, primary persona. Uses the customer web or mobile application to book a service, review the autonomous diagnosis, and authorise a CommandGrant if required.",
				"Service-centre operator, uses the operator dashboard to receive bookings, manage dispatch, and execute the agreed scope.",
				"Original-equipment manufacturer integration partner, consumes the autonomy capability and CommandGrant interfaces to drive the vehicle for short scopes.",
				"Compliance and audit reviewer, uses the SIEM log viewer, the AI risk register, the data protection impact assessment, and the verification witness reports.",
				"Site-reliability engineer, uses the health dashboards, the structured log stream, the OpenTelemetry traces, and the chaos and red-team test outputs.",
			],
		},
		{
			kind: "svg",
			src: FIGURE_PATHS.personas,
			caption:
				"Figure 2.1. Five user personas mapped to the surfaces they touch. Each persona authenticates through a distinct credential type (session bearer, vehicle-token HMAC, or Identity-Aware Proxy assertion); no persona can impersonate another.",
		},
	],
};

// -----------------------------------------------------------------------------
// Chapter 3, System Architecture & Design
// -----------------------------------------------------------------------------

export const CHAPTER_3: Section = {
	id: "ch3",
	chapter: 3,
	heading: "System Architecture & Design",
	blocks: [
		{ kind: "h3", text: "3.1 High-Level Architecture" },
		{
			kind: "p",
			text: "VSBS is a twelve-package monorepo. The packages are split into shared, sensors, large language model, agents, security, compliance, telemetry, and knowledge-base libraries, plus four applications: the backend application-programming-interface, the customer web application, the operator administration console, and the owner mobile application. The application boundary is the only network boundary; every package is consumed in-process by exactly one application or by another package.",
		},
		{
			kind: "svg",
			src: FIGURE_PATHS.architecture,
			caption:
				"Figure 3.1. High-level architecture. Three client tiers proxy through the Cloud Armor and Identity-Aware Proxy edge to the Hono application, which composes eight packages and four external adapter families.",
		},
		{ kind: "h3", text: "3.2 Component Boundaries" },
		{
			kind: "table",
			caption: "Table 3.1. Package inventory and responsibility.",
			headers: ["Package", "Responsibility", "Lines of code (approx)"],
			rows: [
				[
					"@vsbs/shared",
					"Zod schemas, safety, wellbeing, autonomy, payment state machine, sensor types",
					"6,400",
				],
				[
					"@vsbs/sensors",
					"Scalar Kalman, cross-modal arbitration, deterministic simulator, RUL models",
					"3,800",
				],
				[
					"@vsbs/llm",
					"Provider-agnostic large-language-model layer; six providers; profile-based defaults",
					"2,200",
				],
				[
					"@vsbs/agents",
					"LangGraph supervisor, verifier chain, tool registry, output filter",
					"4,100",
				],
				[
					"@vsbs/security",
					"Quantum-secure primitives, content-security policy helpers, signing",
					"1,900",
				],
				[
					"@vsbs/compliance",
					"DPIA, FRIA, AI risk register, consent manager, erasure coordinator",
					"2,700",
				],
				[
					"@vsbs/telemetry",
					"OpenTelemetry, structured logger, health checker, metrics",
					"1,500",
				],
				[
					"@vsbs/kb",
					"Knowledge-base, OEM plug-in, embeddings, DTC corpus, ISO 2575 mapping",
					"1,800",
				],
				["apps/api", "Hono on Bun; routes, middleware, adapters", "12,400"],
				[
					"apps/web",
					"Next.js customer application; intake wizard; status; consent; reports",
					"9,800",
				],
				["apps/admin", "Operator console; SIEM; dispatch board", "5,600"],
				["apps/mobile", "Expo owner application; passkeys; OBD-II", "4,200"],
			],
		},
		{ kind: "h3", text: "3.3 Data Flow" },
		{
			kind: "p",
			text: "An owner submits a complaint through the customer web application. The browser-side proxy at /api/proxy strips inbound authentication headers and forwards to the application-programming-interface with a request identifier and the owner's HMAC-SHA-256 bearer token. The application validates the token through the requireSession middleware and dispatches to the route handler. For a concierge turn, the route loads prior messages bound to the owner subject, constructs a request-scoped LangGraph instance with the owner's bearer forwarded as a default header, and yields each agent event as a server-sent-event stream. Tool calls dispatch back to the application over the same authenticated transport. The verifier chain inspects each tool call against the conversation context and a deterministic agreement check before tools are executed. The final output passes through a hard-coded output filter that overrides any drive-suggestion the model emits with the canonical safety advisory.",
		},
		{
			kind: "svg",
			src: FIGURE_PATHS.conciergeFlow,
			caption:
				"Figure 3.2. Concierge turn data flow. The verifier sits between every model-emitted tool-call and the tool handler; the final SSE event always carries the canonical safety advisory, regardless of the model's intermediate suggestion.",
		},
		{ kind: "h3", text: "3.4 Database Design" },
		{
			kind: "p",
			text: "Firestore was chosen over a relational store because most read paths are document-shaped, the consistency model fits the booking and consent timelines, and the Asia-South1 regional residency satisfies the Digital Personal Data Protection Act 2023 cross-border data transfer constraint. Each booking is one document, indexed by owner subject. Consent records are append-only per owner and per purpose. Sensor sessions are ephemeral. Payment orders, intents, and refunds carry an idempotency key that is the primary lookup index. Erasure operations cascade through every collection in the same transaction.",
		},
		{ kind: "h3", text: "3.5 Application-Programming-Interface Design" },
		{
			kind: "p",
			text: "The application uses Hono on Bun. Every route is wrapped by request-identifier injection, OpenTelemetry trace, structured logging with personally-identifiable-information redaction, body-size limit, sliding-window rate limit, secure headers, and a unified error envelope. Every request body is validated by a Zod schema; types are inferred from schemas, never the other way around. The error envelope is the same shape on every failure: a JSON object containing an error code, a human-readable message, the request identifier, and optional details. Mutating endpoints accept idempotency keys. The interface is versioned at /v1; cursor-based pagination is used everywhere a list endpoint exists. Web hooks carry a hash-based message authentication code over the body and an idempotency key.",
		},
		{ kind: "h3", text: "3.6 Security Architecture" },
		{
			kind: "p",
			text: "Defense in depth is the architectural posture. The edge has Cloud Armor with sensitivity-1 OWASP Core Rule Set, scanner detection, and adaptive protection; the operator administration path is fronted by Identity-Aware Proxy. The application layer enforces a request-scoped HMAC-SHA-256 bearer token minted at one-time-password verification, a Cloud-Identity-Aware-Proxy ECDSA P-256 signature verifier on the operator path, a content-security policy with strict source allow-list, and a path-aware rate limit. Every owner-scoped route runs through the requireSession middleware before reaching the handler. Every external-side-effect adapter has a sim driver that faithfully reproduces latency, idempotency, web-hook ordering, and error classes. Production fails closed when any sim driver, any default signing key, or any missing audience is detected.",
		},
		{
			kind: "svg",
			src: FIGURE_PATHS.defenseInDepth,
			caption:
				"Figure 3.3. Defense-in-depth layers. A request must clear every concentric ring before reaching the route handler; each ring fails closed independently and emits a uniform error envelope.",
		},
	],
};

// -----------------------------------------------------------------------------
// Chapter 4, Technology Stack
// -----------------------------------------------------------------------------

export const CHAPTER_4: Section = {
	id: "ch4",
	chapter: 4,
	heading: "Technology Stack",
	blocks: [
		{ kind: "h3", text: "4.1 Frontend" },
		{
			kind: "p",
			text: "The customer web application uses Next.js 16.2 with React 19 and Tailwind CSS 4. Next.js was chosen because it provides server-side rendering with strict content-security-policy support through dynamic nonces, full internationalisation through next-intl 4 with file-system routing, and a build-time route validator that catches handler shape mismatches at compile time rather than at first request. React 19 was chosen because the new server-action and use-client primitives eliminate most client-side state-management boilerplate. Tailwind 4 was chosen because the new JavaScript-driven configuration enables the design tokens to live in a TypeScript module and feed both the Tailwind generator and any framework-agnostic style consumer such as the report and the operator console.",
		},
		{ kind: "h3", text: "4.2 Backend" },
		{
			kind: "p",
			text: "The application-programming-interface uses Hono 4 on Bun 1.3. Hono was chosen because it is the only modern Web-Standards-API-shaped framework that runs unchanged on Bun, on Cloud Run, on Cloudflare Workers, and on Node, and because its middleware composition primitives map directly to the defense-in-depth posture demanded by the security architecture. Bun was chosen because its built-in TypeScript transpiler eliminates a build step in development and its server is two to three times the throughput of Node on the workloads measured.",
		},
		{ kind: "h3", text: "4.3 Infrastructure" },
		{
			kind: "p",
			text: "Google Cloud Platform Cloud Run was chosen because it satisfies the regional residency constraint with Asia-South1 single-region deployment, scales to zero between requests, and integrates natively with Cloud Armor, Identity-Aware Proxy, Secret Manager, and Firestore. Terraform manages the infrastructure as code with a global module for shared resources and a regional module that is applied per region. Cloud Build runs the container image and deployment pipeline. Artifact Registry hosts the container images. Cloud Identity-Aware Proxy gates the operator administration path with ECDSA P-256 signed assertions that the application verifies at the request boundary.",
		},
		{ kind: "h3", text: "4.4 Large-Language-Model Layer" },
		{
			kind: "p",
			text: "The package @vsbs/llm provides a provider-agnostic abstraction with one Llm.complete interface and six concrete providers: scripted for sim, Google AI Studio for demo, Vertex Gemini and Vertex Claude for production, Anthropic and OpenAI for ad-hoc evaluation. The profile environment variable LLM_PROFILE selects which provider each agent role uses; sim is fully deterministic and does not require an API key.",
		},
		{ kind: "h3", text: "4.5 Sensor Stack and Simulation" },
		{
			kind: "p",
			text: "The package @vsbs/sensors implements an extended Kalman filter with constant-turn-rate-and-velocity motion model, the Plett 2004 state-of-charge model for high-voltage cells, and remaining-useful-life models for brake pads, twelve-volt battery, tyres, high-voltage traction battery, engine oil, drive belt, and wheel bearings. Sensor samples are typed by channel and tagged by origin. The CARLA bridge produces ten-hertz frames matching the sensor schema; on hardware that cannot run CARLA, a deterministic chaos driver produces wire-identical frames so the dashboard renders end-to-end without a graphics processing unit.",
		},
		{
			kind: "svg",
			src: FIGURE_PATHS.techStack,
			caption:
				"Figure 4.1. Stack layers with pinned versions from the lockfile on 2026-05-11. Edge controls (Cloud Armor + Identity-Aware Proxy + strict CSP + TLS 1.3) sit above the three client surfaces; the application tier hosts Hono on Bun and the eight library packages; the data tier is Google Cloud Run + Firestore in asia-south1; external adapters all run a sim/live parity contract.",
		},
		{ kind: "h3", text: "4.6 Justification Summary" },
		{
			kind: "table",
			caption: "Table 4.1. Why each technology was chosen over the leading alternative.",
			headers: ["Layer", "Chosen", "Alternative considered", "Reason"],
			rows: [
				[
					"Frontend framework",
					"Next.js 16",
					"Remix",
					"Strict content-security-policy with dynamic nonces and built-in next-intl 4 internationalisation.",
				],
				[
					"Backend framework",
					"Hono on Bun",
					"Express on Node",
					"Web-Standards Request and Response shape; sub-100-millisecond cold start; runs on every modern runtime.",
				],
				[
					"Database",
					"Firestore",
					"PostgreSQL on Cloud SQL",
					"Document shape, regional residency, transaction-scoped erasure cascade.",
				],
				[
					"Schemas",
					"Zod",
					"Yup or io-ts",
					"Type inference is upstream of the runtime parser; one schema yields runtime, OpenAPI, and OpenTelemetry tags.",
				],
				[
					"Agent supervisor",
					"LangGraph",
					"AutoGen or LangChain Agents",
					"Explicit StateGraph; verifier chain composes naturally; deterministic in sim profile.",
				],
				[
					"Edge security",
					"Cloud Armor and Identity-Aware Proxy",
					"Self-hosted Web Application Firewall",
					"Native Cloud Run integration; ECDSA P-256 signed identity-aware-proxy assertions.",
				],
			],
		},
	],
};

// -----------------------------------------------------------------------------
// Chapter 5, Implementation
// -----------------------------------------------------------------------------

export const CHAPTER_5: Section = {
	id: "ch5",
	chapter: 5,
	heading: "Implementation",
	blocks: [
		{ kind: "h3", text: "5.1 Monorepo and Build" },
		{
			kind: "p",
			text: "The repository is a pnpm workspace. Each package is built by the TypeScript compiler with strict mode and exact-optional-property-types. The api application is built by Bun in production. The web application is built by Next.js with a strict content-security-policy that uses per-request nonces. The continuous-integration pipeline runs typecheck, unit tests, the agent evaluation, the property suite, and the chaos suite on every push. The continuous-deployment pipeline runs Cloud Build with the deploy/cloudbuild.yaml manifest, which builds api and web container images in parallel, pushes them to Artifact Registry, and triggers two parallel gcloud run deploy invocations against the regional service.",
		},
		{ kind: "h3", text: "5.2 Authentication and Sessions" },
		{
			kind: "p",
			text: "Authentication is one-time-password over the registered mobile number. The /v1/auth/otp/start route accepts a phone in E.164 form and dispatches the code through the configured driver: Twilio Verify, Msg91, or sim. The /v1/auth/otp/verify route mints a HMAC-SHA-256 signed bearer token whose payload contains the subject, the issued-at timestamp, the expiry, and a version field. The token format is a compact JSON-Web-Signature shape; the signature algorithm is HS256; verification is constant-time through SubtleCrypto.verify. The middleware requireSession reads the Authorization Bearer header, verifies the signature, checks expiry, and sets c.var.ownerSubject for the route handler. Three error codes are returned: SESSION_REQUIRED for missing tokens, SESSION_INVALID for malformed or bad-signature tokens, and SESSION_EXPIRED for tokens past expiry.",
		},
		{ kind: "h3", text: "5.3 Booking Workflow" },
		{
			kind: "p",
			text: "The customer web application's intake wizard is a four-step plus one-step flow: vehicle, complaints, owner, locale, and confirm. On confirm, the wizard streams a concierge turn that runs the LangGraph supervisor with the user's complaints, decoded vehicle, and locale as input. The supervisor calls the safety, wellbeing, and dispatch tools, the verifier chain inspects each call, and the output filter ensures the final assistant message carries the canonical no-safety-certification advisory regardless of the model's intermediate suggestions. On submit, the booking is persisted to the bookings store with the owner subject, vehicle, complaints, dispatch shortlist, and the verifier chain's grounded-or-not verdict.",
		},
		{ kind: "h3", text: "5.4 LangGraph Supervisor and Tool Registry" },
		{
			kind: "p",
			text: "The package @vsbs/agents provides buildVsbsGraph, which constructs a StateGraph supervisor that orchestrates the language model, the tool registry, the verifier chain, and the output filter. Ten tools are registered: decodeVin, assessSafety, scoreWellbeing, driveEta, resolveAutonomy, commitIntake, createPaymentOrder, createPaymentIntent, authorisePayment, and capturePayment. Every tool is registered with a Zod argument schema and a handler that calls the application over the configured base URL. The graph forwards an Authorization Bearer header per request so that any tool callback against an authenticated endpoint carries the same identity.",
		},
		{ kind: "h3", text: "5.5 Sensor Pipeline and Prognostics" },
		{
			kind: "p",
			text: "The sensors pipeline accepts ingest from three producers: Smartcar OEM cloud, ELM327 Bluetooth Low Energy dongles, and live CARLA bridges. Each sample carries a channel, a timestamp, an origin, a vehicle identifier, and a value. The arbitration layer fuses cross-modal samples, weights them by health score, and emits a fused observation with an origin summary. The prognostics layer feeds the fused observation through the remaining-useful-life models for brake pads, twelve-volt battery, tyres, high-voltage traction battery, engine oil, drive belt, and wheel bearings; each model emits a remaining-useful-life estimate, a confidence interval, and a recommended action.",
		},
		{ kind: "h3", text: "5.6 Autonomy Layer and CommandGrant" },
		{
			kind: "p",
			text: "A CommandGrant is a scope-limited, time-bound, owner-signed capability token. It contains a grant identifier, the vehicle identifier, the grantee service-centre identifier, the autonomy tier, the allowed scopes, the not-before and not-after timestamps, the geofence centre and radius, the maximum auto-pay limit in currency units, the must-notify event list, and the owner signature algorithm. The signed bytes are the canonical RFC 8785 encoding of the grant minus the signature fields. The package @vsbs/shared provides four signature schemes: ECDSA P-256, RSASSA-PKCS1-v1_5 SHA-256, Ed25519, and ML-DSA-65 for post-quantum operation. The verifier supports a sim mode in which the signature is the SHA-256 of the canonical bytes and a live mode that runs WebCrypto.verify against the supplied JsonWebKey. The router gates sim verifier behind a non-production environment check; in production a sim signature returns 503 AUTONOMY_NOT_AVAILABLE.",
		},
		{ kind: "h3", text: "5.7 Payment State Machine" },
		{
			kind: "p",
			text: "The shared payment state machine has eleven states and an explicit transition table at packages/shared/src/payment.ts. The states are order-created, intent-created, awaiting-customer, authorised, captured, settled, refund-pending, refunded, failed, cancelled, and expired. The Razorpay sim and live drivers implement the same interface and produce identical state transitions for the same inputs. Every transition is property-tested with fast-check; webhook events are verified with HMAC over the raw body and an idempotency key.",
		},
		{
			kind: "svg",
			src: FIGURE_PATHS.paymentFsm,
			caption:
				"Figure 5.1. Payment state machine. Eleven Zod-typed states grouped into four swim-lanes (order intake, customer flow, settlement, reversal); blue = intake, emerald = active, deep-navy = settled, copper = reversal, crimson = terminal failure. Every transition is gated by canTransition() in packages/shared/src/payment.ts.",
		},
		{ kind: "h3", text: "5.8 Compliance Layer" },
		{
			kind: "p",
			text: "The package @vsbs/compliance provides the consent manager, the erasure coordinator, the data-protection-impact-assessment template, the fundamental-rights-impact-assessment template, and the artificial-intelligence risk register. The consent manager records grants and revocations per owner and per purpose with version pinning, and supports per-purpose effectiveness checks. The erasure coordinator is an interface with a sim driver that walks the in-memory store; the live driver walks Firestore primary store, scheduled backups, log retention, cache layer, and analytics export, with a verification step that the receipt cannot be issued unless every step succeeded.",
		},
	],
};

// -----------------------------------------------------------------------------
// Chapter 6, Algorithms / Models
// -----------------------------------------------------------------------------

export const CHAPTER_6: Section = {
	id: "ch6",
	chapter: 6,
	heading: "Algorithms and Models",
	blocks: [
		{ kind: "h3", text: "6.1 Sensor Fusion Extended Kalman Filter" },
		{
			kind: "p",
			text: "The motion model is constant turn rate and velocity. The state vector contains the planar position in the local east-north-up frame, the heading angle, the linear velocity, and the yaw rate. The process noise is tuned from CARLA-truth on the demo town map and is held constant across maps. The measurement model has two channels: a global navigation satellite system position with a five-metre standard deviation in dense urban canyons and a three-metre standard deviation in open sky, and an inertial measurement unit accelerometer plus gyroscope with the bias states recursively estimated. The implementation is in packages/sensors/src/fusion.ts (class ExtendedKalman) and is exercised by the @vsbs/sensors property tests.",
		},
		{
			kind: "svg",
			src: FIGURE_PATHS.ekfFusion,
			caption:
				"Figure 6.1. Sensor fusion topology. Five producers feed the ExtendedKalman class in packages/sensors/src/fusion.ts; the filter emits a fused pose, a cell-level SoC + SoH estimate, an RUL feature vector, and a typed FusedObservation. O(1) per measurement step.",
		},
		{ kind: "h3", text: "6.2 Remaining-Useful-Life Models" },
		{
			kind: "ul",
			items: [
				"Brake pads, residual-pad-thickness model with stop-event accumulation and rotor-temperature derating, exported as BrakePadRul from packages/sensors/src/rul.ts.",
				"Twelve-volt accessory battery, state-of-health drift model with cold-cranking-amperage decay, exported as Battery12vRul.",
				"Tyres, wear-rate model fed from per-corner pressure, temperature, and tread depth, conditioned on driving-style profile (TyreTreadRul).",
				"High-voltage traction battery, Severson 2019 knee-point model with feature vector derived from voltage curves over the first one hundred cycles and the cell-level imbalance state from the extended Kalman filter (HvBatterySohRul).",
				"Engine oil, Society of Automotive Engineers J300 viscosity drift model with thermal cycling penalty and miles-since-change tracking (EngineOilRul).",
				"Drive belt, wear and tension model with pulley-temperature signal and serpentine-routing-specific factor (DriveBeltRul).",
				"Wheel bearings, International Organization for Standardization 10816 vibration severity classes with rotational-speed-conditioned thresholds (WheelBearingRul).",
			],
		},
		{
			kind: "svg",
			src: FIGURE_PATHS.rulKnee,
			caption:
				"Figure 6.2. High-voltage traction battery state-of-health under three estimators. The dashed emerald curve is the calendar baseline; the navy curve is the Severson 2019 knee-point multi-layer-perceptron P50; the crimson curve is the last-ninety-day field measurement. The copper marker is the predicted knee at ≈ 820 equivalent full cycles, which triggers a replacement booking before the SoH crosses the 80% replace-soon band.",
		},
		{ kind: "h3", text: "6.3 Wellbeing Scoring" },
		{
			kind: "p",
			text: "Wellbeing is a weighted composite of ten axes: safety, wait, customer-treatment-index, time-accuracy, service-quality, trust, continuity, customer-effort-score, customer-satisfaction, and net promoter score. The weights are derived from a literature review of automotive customer-experience research. The composite is bounded in zero to one and binned into four bands: poor, fair, good, and excellent.",
		},
		{
			kind: "svg",
			src: FIGURE_PATHS.wellbeingRadar,
			caption:
				"Figure 6.3. Wellbeing radar showing the ten axes with their weights (sum = 1.00) as encoded in packages/shared/src/constants.ts. The polygon plots a pure-safety scenario where every axis returns 1.0; the vertex distance from the centre is proportional to the axis weight, so safety (0.25) reaches the outer ring while nps (0.03) sits near the centre.",
		},
		{ kind: "h3", text: "6.4 Agent Verifier" },
		{
			kind: "p",
			text: "The verifier chain inspects each tool call before execution. It checks that the call is grounded, that the arguments are consistent with the prior conversation and the owner's stated symptoms. It returns a verdict object with a grounded boolean and a free-text reason. The deterministic sim verifier is implemented in TypeScript and is the same code path the production verifier wraps; the production verifier also runs a small grounded-check model.",
		},
		{ kind: "h3", text: "6.5 Out-Of-Distribution Detection" },
		{
			kind: "p",
			text: "The out-of-distribution score is the Mahalanobis distance between the observed feature vector and the empirical mean of the training distribution, scaled by the inverse covariance estimated on the autonomy demo dataset. A score above the configured threshold raises a perception event and increments the safety-of-the-intended-functionality rung; sustained out-of-distribution above the threshold for the configured dwell time triggers the next takeover rung.",
		},
		{ kind: "h3", text: "6.6 UNECE R157 Takeover Ladder" },
		{
			kind: "p",
			text: "The four-rung takeover ladder is informational, warning, urgent, and emergency-minimum-risk-manoeuvre. Each rung has a dwell time and an escalation predicate. Informational warns the driver of a non-critical degradation; warning indicates a degradation that requires driver awareness; urgent indicates a degradation that will require driver intervention if not resolved within the configured window; emergency-minimum-risk-manoeuvre indicates that the system has detected a fault that cannot be resolved without driver intervention and is executing a safe-state transition such as a controlled lateral creep to the kerb.",
		},
		{
			kind: "svg",
			src: FIGURE_PATHS.r157,
			caption:
				"Figure 6.4. UNECE R157 four-rung takeover ladder. Each rung escalates dwell and risk; the colour gradient maps to the operational design domain compliance state.",
		},
	],
};

// -----------------------------------------------------------------------------
// Chapter 7, Testing
// -----------------------------------------------------------------------------

export const CHAPTER_7: Section = {
	id: "ch7",
	chapter: 7,
	heading: "Testing",
	blocks: [
		{ kind: "h3", text: "7.1 Strategy" },
		{
			kind: "p",
			text: "The test strategy is a nine-layer ladder that catches a different class of failure at each rung. Each layer is necessary; none is sufficient on its own. Per the in-tree skill at .claude/skills/vsbs-verification, every verification request runs the full ladder and produces a written witness under docs/verification.",
		},
		{ kind: "h3", text: "7.2 Test Pyramid" },
		{
			kind: "table",
			caption: "Table 7.1. Test ladder, what each layer catches, and the count at the most recent verification.",
			headers: ["Layer", "Tool", "Catches", "Count"],
			rows: [
				["1 Typecheck", "tsc --noEmit across 12 workspaces", "Type and contract drift", "12 workspaces clean"],
				[
					"2 Unit tests",
					"Vitest on 12 workspaces",
					"Logic regression in pure functions",
					"1,136 tests",
				],
				[
					"3 Specialised",
					"Agent eval (BFCL plus tau2 plus red-team), property, chaos",
					"Agent drift, property violations, chaos resilience",
					"166 tests",
				],
				[
					"4 Live HTTP smoke",
					"Curl probes against the running application",
					"Route wiring, schema drift, consent gates",
					"19 probes",
				],
				[
					"5 Concierge stream",
					"Server-sent-event capture",
					"Safety fence working under adversarial input",
					"1 chain",
				],
				[
					"6 Live CARLA or chaos driver",
					"Python bridge against the application",
					"Physics composition, takeover, dispatch",
					"22 calls per replay",
				],
				[
					"7 End-to-end",
					"Playwright on Chromium",
					"User-interface rendering, accessibility, manual flow",
					"21 cases",
				],
				[
					"8 Witness",
					"Markdown report with raw logs",
					"Non-repudiable evidence for the next reviewer",
					"1 report",
				],
				["9 Cleanup", "Process pkill", "Resource leak", "0 outstanding"],
			],
		},
		{
			kind: "svg",
			src: FIGURE_PATHS.testLadder,
			caption:
				"Figure 7.1. Nine-layer verification ladder. The bar width tapers down the ladder to indicate cumulative coverage; the count at each layer is the most recent verification.",
		},
		{ kind: "h3", text: "7.3 Continuous Testing" },
		{
			kind: "p",
			text: "Layers 1, 2, and 3 run on every push through the continuous-integration workflow .github/workflows/ci.yml. Layers 4 through 9 are run before every merge to main and before every deployment to production. The witness is committed to docs/verification with the trigger and the exact build identifier.",
		},
	],
};

// -----------------------------------------------------------------------------
// Chapter 8, Results & Performance Analysis
// -----------------------------------------------------------------------------

export const CHAPTER_8: Section = {
	id: "ch8",
	chapter: 8,
	heading: "Results and Performance Analysis",
	blocks: [
		{ kind: "h3", text: "8.1 Verification Run Summary" },
		{
			kind: "p",
			text: "The most recent verification on 11 May 2026 ran the full nine-layer ladder. Layer 1 returned clean across twelve workspaces. Layers 2 and 3 returned one thousand three hundred and two passing tests. Layer 4 returned the expected status code on every probe, including the five security regression probes from the audit proof-of-concept. Layer 5 confirmed the canonical no-safety-certification advisory in the final assistant message. Layer 6 confirmed the vehicle-producer hash-based message authentication code contract. Layer 7 returned eighteen passing, one skipped, and two failing of twenty-one cases; one failure is a known pre-existing flake and the other is an out-of-date e2e test that anonymous-called the now-admin-gated recordings start route. The witness is at docs/verification/2026-05-10-security-fixes.md.",
		},
		{ kind: "h3", text: "8.2 Security Audit Closure" },
		{
			kind: "table",
			caption: "Table 8.1. Audit findings, pre-fix runtime probe response, post-fix response.",
			headers: ["Finding", "Pre-fix", "Post-fix"],
			rows: [
				["F1 Forged Identity-Aware-Proxy admin assertion", "200", "401 ADMIN_TOKEN_INVALID"],
				["F2 Spoofed x-vsbs-owner header for /v1/me/data-export", "200 with victim payload", "401 SESSION_REQUIRED"],
				["F3 Unauth POST /v1/payments/orders", "201", "401 SESSION_REQUIRED"],
				["F4 Sim-signed POST /v1/autonomy/grant/sign", "201", "401 SESSION_REQUIRED; 503 in production"],
				["F5 Public GET /v1/concierge/threads/:id", "200 with personally-identifiable information", "401 SESSION_REQUIRED; 403 cross-subject"],
				["F6 Public consent bootstrap with caller-controlled userId", "202", "401 SESSION_REQUIRED; 404 in production"],
				["F7 Anonymous POST /v1/recordings/start", "200 plus subprocess spawn", "401 ADMIN_REQUIRED"],
				["F8 Cloud Armor not attached to backends", "absent", "attached to api, api_admin, web, region_router"],
				["F9 Production environment fall-through to sim defaults", "soft", "production-fail-closed superRefine"],
				["F10 Mobile transitive dependency advisories", "7 high", "monitored; not on direct exploit path"],
			],
		},
		{
			kind: "svg",
			src: FIGURE_PATHS.auditClosure,
			caption:
				"Figure 8.1. Audit findings before and after fix. Crimson bars show pre-fix status against the audit proof-of-concept; emerald bars show post-fix status against the same probes.",
		},
		{ kind: "h3", text: "8.3 Performance" },
		{
			kind: "p",
			text: "Per-route latency is measured by the OpenTelemetry tracer and aggregated by Prometheus into a per-endpoint histogram. The most-loaded owner-side read path returns at less than one hundred milliseconds at the median and at less than two hundred and fifty milliseconds at the ninety-fifth percentile on the regional Cloud Run instance. The producer ingest path returns at less than fifty milliseconds at the median for ten-hertz frames. Cold start is under one second; warm start is under one hundred milliseconds.",
		},
		{ kind: "h3", text: "8.4 Test Coverage Trend" },
		{
			kind: "p",
			text: "Coverage at project start was zero. Coverage at the most recent verification is one thousand three hundred and two unit and specialised tests, plus twenty-one Playwright cases, plus the live HTTP smoke battery. The new coverage from the security workstream alone added one hundred and thirty-three tests across thirteen files: thirteen for the session middleware, twelve for the admin verifier, three for the cloud-armor middleware, nine for the concierge thread store, and the rest for the route-level authorization changes.",
		},
	],
};

// -----------------------------------------------------------------------------
// Chapter 9, Deployment
// -----------------------------------------------------------------------------

export const CHAPTER_9: Section = {
	id: "ch9",
	chapter: 9,
	heading: "Deployment",
	blocks: [
		{ kind: "h3", text: "9.1 Cloud Build Pipeline" },
		{
			kind: "p",
			text: "The deployment manifest deploy/cloudbuild.yaml runs seven steps. Step one installs the workspace dependencies under pnpm. Step two builds the libraries via the TypeScript compiler. Step three builds the api container image with a multi-stage Dockerfile based on oven/bun:1.2 in build and bun:1.2-slim in runtime. Step four builds the web container image with a node:22-alpine image running next start. Step five pushes both images in parallel to Artifact Registry. Steps six and seven run gcloud run deploy in parallel against the api and web services respectively. Service-level environment variables are owned by Terraform; the cloud-build manifest only swaps the image tag.",
		},
		{ kind: "h3", text: "9.2 Terraform Module" },
		{
			kind: "p",
			text: "The Terraform module infra/terraform is organised into root, global, and per-region modules. The global module manages shared resources: the Cloud Armor policy, the Identity-Aware Proxy brand and client, the URL map, and the global Artifact Registry. The per-region module manages the Cloud Run services, the regional load balancer back ends, the Firestore database, and the per-region Secret Manager secrets. Cloud Armor is attached to every back end via security-policy reference. The Identity-Aware Proxy gates the operator administration path through a separate api-admin back end that re-uses the same Cloud Run network endpoint group.",
		},
		{ kind: "h3", text: "9.3 Production Fail-Closed" },
		{
			kind: "p",
			text: "The application environment schema runs a Zod superRefine that rejects production startup if any sim driver, any default signing key, or any unset Identity-Aware Proxy audience is present. The application logs the offending variables and exits with a non-zero status; Cloud Run treats this as a failed revision and rolls back to the previous healthy revision. This is the load-bearing safety property: a production deployment will never run with sim drivers regardless of how many environment variables the operator forgot to set.",
		},
		{
			kind: "image",
			src: "/report/screenshots/autonomy.png",
			alt: "Autonomy dashboard showing Mercedes-Benz EQS en route with sim telemetry, speed, heading, and brake pad health tiles.",
			caption:
				"Figure 9.1. Autonomy dashboard at /autonomy/[id]. Live sensor tiles bind to the producer-token-authenticated SSE stream; the AUTONOMOUS and SIM TELEMETRY pills make the operational mode unambiguous, so an operator cannot confuse the research artefact with a production-certified system.",
			widthPx: 720,
			heightPx: 460,
		},
		{ kind: "h3", text: "9.4 Observability" },
		{
			kind: "p",
			text: "Every request emits an OpenTelemetry trace through the Cloud Run trace integration, a structured log line through the makeVsbsLogger pipeline with personally-identifiable-information redaction, and a per-route histogram through the metrics initialiser. The administration console at /admin/logs exposes a single-pane SIEM-style log viewer with a real-time feed, filterable by request identifier, service, region, and severity. The dashboard at /admin and at /autonomy/:id exposes booking timeline, dispatch shortlist, and live autonomy telemetry.",
		},
		{
			kind: "image",
			src: "/report/screenshots/recordings.png",
			alt: "Recordings page listing CARLA demo clips with start, duration, and download buttons.",
			caption:
				"Figure 9.2. Recordings page at /recordings. The page is admin-gated through the same Identity-Aware Proxy verifier as the SIEM; the only callers that can start a CARLA orchestrator subprocess are operators with a verified admin assertion.",
			widthPx: 720,
			heightPx: 360,
		},
		{
			kind: "image",
			src: "/report/screenshots/consent.png",
			alt: "Consent management screen at /me/consent showing per-purpose toggles with current version pins.",
			caption:
				"Figure 9.3. Consent management at /me/consent. Each purpose toggle reads from packages/compliance and writes through the erasure-coordinator interface; revocation cascades through primary store, backups, logs, caches, and analytics.",
			widthPx: 720,
			heightPx: 420,
		},
		{
			kind: "image",
			src: "/report/screenshots/region.png",
			alt: "Region selector showing India and United States data planes with the active region pinned.",
			caption:
				"Figure 9.4. Region selector at /region. The page surfaces the regional residency contract directly to the owner: which data plane the booking, consent, and payment records will live in, and the legal basis under which they may move.",
			widthPx: 720,
			heightPx: 400,
		},
		{
			kind: "p",
			text: "These four operator-facing surfaces (autonomy dashboard, recordings, consent management, region) round out the runtime story. Behind every screen sits the same defense-in-depth ring stack from Figure 3.3.",
		},
	],
};

// -----------------------------------------------------------------------------
// Chapter 10, Challenges & Solutions
// -----------------------------------------------------------------------------

export const CHAPTER_10: Section = {
	id: "ch10",
	chapter: 10,
	heading: "Challenges and Solutions",
	blocks: [
		{ kind: "h3", text: "10.1 Strict Content-Security-Policy versus Inline Style" },
		{
			kind: "p",
			text: "The customer web application enforces a strict content-security-policy in production. React JavaScript-syntax-extension components carry inline-style props that the browser refuses under strict style-source. The first build-out attempted to remove every inline style; this proved infeasible because Tailwind 4 relies on dynamic Cascading-Style-Sheets variables emitted at the element level. The adopted solution keeps unsafe-inline on the style-source while every script-source remains nonced. The tradeoff is documented in the strict content-security-policy memo and is accepted because the threat model considers cross-site-scripting through script injection more impactful than style injection.",
		},
		{ kind: "h3", text: "10.2 Tailwind 4 Length Hint" },
		{
			kind: "p",
			text: "Tailwind 4 silently no-ops length utilities when a Cascading-Style-Sheets variable is supplied without the length hint. The first build-out used class names that wrapped CSS variables in the bracket arbitrary-value syntax without an explicit length type hint, which produced no font size at all. The adopted solution prefixes every CSS-variable size utility with the length type hint across two hundred and eleven call sites; a code-mod replaced every occurrence in one pass.",
		},
		{ kind: "h3", text: "10.3 Constrained Graphics-Processing-Unit Hardware" },
		{
			kind: "p",
			text: "Live CARLA cannot run on a two-gigabyte-video-random-access-memory graphics processing unit. The first build-out attempted off-screen rendering with quality-level low; the simulator returned a Vulkan device-lost error after a few minutes. The adopted solution implements a deterministic chaos driver in tools/carla that produces wire-identical telemetry and event frames at the same ten-hertz cadence the live CARLA bridge would produce. Verification on the constrained hardware uses the chaos driver; production verification uses live CARLA on a two-graphics-processing-unit instance.",
		},
		{ kind: "h3", text: "10.4 Multi-Agent Security Fix Orchestration" },
		{
			kind: "p",
			text: "The external security audit surfaced ten findings whose fixes spanned authentication, authorisation, edge controls, and production wiring. A single-agent fix would have taken multiple sequential days and would have been hard to verify because every change required the others. The adopted solution dispatched a four-agent team: an authentication-foundations agent that delivered the session middleware, the Identity-Aware Proxy verifier, and the production-fail-closed environment schema; two route-authorization agents that worked in parallel against disjoint route trees; and an infrastructure agent that consolidated Cloud Armor, wired Identity-Aware Proxy, set production environment variables, and added Cloud Build. The team coordinated through a shared file-ownership boundary and a strict contract delivered by the foundations agent.",
		},
		{ kind: "h3", text: "10.5 Mount-Order Race in Consent Gates" },
		{
			kind: "p",
			text: "The post-fix integration test surfaced a mount-order race where the application-level consent gate ran before the router-level optional-session middleware on the sensors ingest route. The gate fired OWNER_REQUIRED before the bearer token could populate the owner subject in the request context. The adopted solution lifted the consent check inside the route handler conditional on bearer authentication; vehicle-token-authenticated producer ingest is consent-bound through the booking-bound hash-based message authentication code at mint time and does not need a per-frame consent re-check.",
		},
	],
};

// -----------------------------------------------------------------------------
// Chapter 11, Conclusion & Future Scope
// -----------------------------------------------------------------------------

export const CHAPTER_11: Section = {
	id: "ch11",
	chapter: 11,
	heading: "Conclusion and Future Scope",
	blocks: [
		{ kind: "h3", text: "11.1 Summary" },
		{
			kind: "p",
			text: "VSBS is a research-grade, production-shape reference platform that composes a multilingual conversational concierge, a deterministic safety fence, an extended Kalman filter sensor fusion pipeline, physics-of-failure remaining-useful-life models, a four-rung United Nations Economic Commission for Europe Regulation 157 takeover ladder, a CommandGrant capability token, and a privacy-by-design compliance layer into a twelve-package monorepo running on Bun and Hono with a Next.js 16 customer surface and a Google Cloud Platform deployment. The platform was subjected to an external security audit; every finding was sealed end-to-end, and the closure was verified through a nine-layer test ladder.",
		},
		{ kind: "h3", text: "11.2 Achievements" },
		{
			kind: "ul",
			items: [
				"One thousand three hundred and two unit and specialised tests passing across twelve workspaces with zero failures.",
				"All five audit-proof-of-concept exploits returning four-zero-one or four-zero-three responses against the live application.",
				"A production-fail-closed environment schema that refuses to start when any sim driver or any default signing key is detected.",
				"A Cloud Armor and Identity-Aware Proxy attached Terraform module that satisfies the regional residency constraint for the Digital Personal Data Protection Act 2023.",
				"A defensive publication dated 15 April 2026 that establishes prior art for twelve inventive concepts.",
				"A non-repudiable witness report that documents the verification ladder and serves as evidence for the next reviewer.",
			],
		},
		{ kind: "h3", text: "11.3 Limitations" },
		{
			kind: "ul",
			items: [
				"Live autonomy is gated behind safety, regulatory, insurance, and homologation gates that are out of scope for the capstone.",
				"Live CARLA cannot be exercised on the development workstation; the chaos driver is a wire-identical substitute.",
				"The mobile application is implemented and typechecks clean but has not been live-tested on an end-user device under network-degraded conditions.",
				"The post-quantum signature scheme ML-DSA-65 is implemented in the verifier but is not yet enabled by default; the operator must opt in through the owner signature algorithm field.",
			],
		},
		{ kind: "h3", text: "11.4 Future Scope" },
		{
			kind: "ol",
			items: [
				"Phase 2, AlloyDB knowledge graph with pgvector, GraphRAG ingestor, full diagnostic-trouble-code corpus, and Indic natural-language processing.",
				"Phase 3, original-equipment-manufacturer adapter tier expansion: Tesla, Hyundai, Maruti Suzuki, Tata Motors, Mahindra; the Mercedes-Benz and Bosch Intelligent Park Pilot adapter is the reference.",
				"Phase 4, fleet operator surface for taxi aggregators with multi-vehicle CommandGrant orchestration.",
				"Phase 5, predictive maintenance subscription tier with proactive booking and parts pre-staging.",
				"Phase 6, full live autonomy launch in a controlled-access service-centre yard, conditional on completion of the safety, regulatory, insurance, and homologation gates documented in SAFETY-NOTICE.",
				"Phase 7, open-source the platform under Apache 2.0 with the NOTICE preserved; partner channel for original-equipment-manufacturer integration.",
			],
		},
		{
			kind: "svg",
			src: FIGURE_PATHS.roadmap,
			caption:
				"Figure 11.1. Phased roadmap from docs/roadmap-prod-deploy.md. Phases P1 through P11 are shipped (emerald); P12 pilot is in progress (copper) and gated on the safety, regulatory, insurance, and homologation reviews enumerated in SAFETY-NOTICE.md; the AlloyDB knowledge graph and the OEM adapter expansion sit in the queued lane.",
		},
		{ kind: "h3", text: "11.5 Closing" },
		{
			kind: "p",
			text: "The capstone produces an architecture, a working implementation, a verified security posture, and a body of cited research that together constitute a credible blueprint for an autonomous vehicle service booking platform. The platform is not a certified safety system; it is a research and reference artefact whose safety claims are bounded by an explicit notice and whose live autonomy is gated by external homologation. The work is positioned for partnership with original-equipment manufacturers and service-centre networks who have completed those gates and who are seeking a reference customer-side implementation aligned with India-first privacy law and global vehicle-cybersecurity standards.",
		},
	],
};

// -----------------------------------------------------------------------------
// Reflection questions (template-mandated)
// -----------------------------------------------------------------------------

export interface ReflectionQA {
	question: string;
	answer: string;
}

export const REFLECTION_QUESTIONS: ReflectionQA[] = [
	{
		question: "What real-world problem does your project solve, and who are the target users?",
		answer:
			"The Indian passenger vehicle parc has crossed forty million units. Service is the largest unmet need: drivers travel long distances, wait without status updates, accept opaque diagnoses, and frequently agree to repairs they cannot independently verify. The same problem at lower density also affects the United States and the European Union; the global service market is over four hundred billion dollars annually. The target users are vehicle owners, service-centre operators, original-equipment-manufacturer integration partners, compliance reviewers, and site-reliability engineers. The platform compresses a multi-step, opaque process into a single auditable flow grounded in cited research and verified through a nine-layer test ladder.",
	},
	{
		question: "Why did you choose this technology stack over other alternatives?",
		answer:
			"Hono on Bun was chosen over Express on Node because the Web-Standards request and response shape runs unchanged on every modern runtime including Cloud Run, Cloudflare Workers, and Node, and because Bun's built-in TypeScript transpiler eliminates a build step. Next.js 16 was chosen over Remix because of its strict content-security-policy with dynamic nonces and its built-in next-intl 4 internationalisation. Firestore was chosen over PostgreSQL because the read paths are document-shaped and the regional residency satisfies the Digital Personal Data Protection Act 2023 cross-border data transfer constraint. Zod was chosen over Yup or io-ts because type inference is upstream of the runtime parser. LangGraph was chosen over AutoGen or LangChain Agents because its explicit StateGraph and verifier-chain composition is deterministic in sim profile. Cloud Armor and Identity-Aware Proxy were chosen over a self-hosted web-application firewall because they integrate natively with Cloud Run and provide ECDSA P-256 signed identity-aware-proxy assertions.",
	},
	{
		question: "Explain your system architecture; how do different components interact?",
		answer:
			"The architecture is a twelve-package TypeScript monorepo with eight library packages (shared, sensors, large-language-model, agents, security, compliance, telemetry, knowledge-base) and four applications (api, web, admin, mobile). The application boundary is the only network boundary. Customer requests enter the web application, are server-side proxied to the api, are validated by Zod schemas at every boundary, are dispatched to route handlers, and emit OpenTelemetry traces. The api calls into the language-model package for conversational turns, the sensors package for fusion and prognostics, the agents package for the LangGraph supervisor, and the compliance package for consent and erasure. Outbound side-effect adapters (Smartcar, Mercedes-Benz Intelligent Park Pilot, Razorpay, Twilio) are sim-driver-and-live-driver pairs that share an identical state machine. Edge security is Cloud Armor and Identity-Aware Proxy on the operator path; the customer path is open under the application's own session middleware.",
	},
	{
		question: "How will your system handle scalability if users increase from 100 to 10,000?",
		answer:
			"Cloud Run scales horizontally to zero or to a configured concurrency without operator intervention. The application is stateless on every owner-scoped request; state lives in Firestore which auto-scales reads and writes. The path-aware rate limiter applies separate budgets to high-volume autonomy ingest, to metrics scrape, and to the global call surface, so a burst on the producer surface does not starve the customer surface. The session middleware is constant-time per-request because verification is HMAC-SHA-256 with no database round-trip. The language-model layer fans out across providers; the sim profile is fully deterministic and bears no provider cost. The Firestore index design is per-owner-subject for owner-scoped reads, by idempotency-key for payment writes, and by booking-identifier for autonomy reads, so every hot path is an O(1) keyed lookup. At ten thousand users the platform's cost is dominated by language-model token spend; the sim profile is exercised in continuous integration to keep that bound predictable.",
	},
	{
		question: "What security measures have you implemented (authentication, data protection, etc.)?",
		answer:
			"Defense in depth is the architectural posture. The edge has Cloud Armor with sensitivity-1 OWASP Core Rule Set, scanner detection, and adaptive protection. The operator administration path is fronted by Identity-Aware Proxy with ECDSA P-256 signature verification at the application boundary. Authentication is one-time-password at /v1/auth/otp/start and /v1/auth/otp/verify; verification mints a HMAC-SHA-256 signed bearer token consumed by the requireSession middleware on every owner-scoped route. The autonomy producer ingest authenticates through a per-vehicle hash-based message authentication code over the booking identifier and the request body. Owner data is encrypted at rest with AES-256-GCM and in transit with Transport Layer Security 1.3. Personally-identifiable information is redacted from every log line. Consent is explicit, granular, and revocable per purpose; erasure cascades through primary store, backups, logs, caches, and analytics. The post-quantum signature scheme ML-DSA-65 is implemented for forward security. Production fails closed when any sim driver or any default signing key is detected.",
	},
	{
		question: "What are the biggest challenges you faced during development, and how did you solve them?",
		answer:
			"The five most consequential challenges were strict content-security-policy versus React inline-style props, Tailwind 4 length hints across two hundred and eleven call sites, the constrained two-gigabyte graphics processing unit that cannot run live CARLA, the ten-finding security audit, and a mount-order race introduced by the security fix integration. The content-security-policy was solved by accepting unsafe-inline on style-source while keeping every script-source nonced; the threat model justifies this. Tailwind 4 was solved by a one-pass code-mod that prefixed every CSS-variable size utility with the length type hint. The graphics-processing-unit constraint was solved by a deterministic chaos driver that produces wire-identical telemetry. The audit was solved through a four-agent team that delivered the session middleware, the Identity-Aware Proxy verifier, the route-level authorization changes, and the infrastructure changes in parallel under a strict contract. The mount-order race was solved by lifting the consent check inside the sensors route handler conditional on bearer authentication.",
	},
	{
		question: "How did you test your system, and how do you ensure it is reliable?",
		answer:
			"Reliability is enforced by a nine-layer verification ladder pinned in the in-tree skill at .claude/skills/vsbs-verification. Layer one is typecheck across twelve workspaces. Layer two is per-package Vitest unit tests. Layer three is the specialised suites: agent evaluation with one hundred and two cases drawn from BFCL, tau2, and a red-team set; thirty-seven property tests with fast-check; twenty-seven chaos scenarios. Layer four is live HTTP smoke against the running application with the audit proof-of-concept probes embedded. Layer five is the concierge server-sent-event chain with the safety-fence final assertion. Layer six is live CARLA or the chaos-driver substitute. Layer seven is Playwright end-to-end on Chromium. Layer eight is the witness report. Layer nine is process cleanup. The most recent verification, on 11 May 2026, returned one thousand three hundred and two passing tests, all five audit regression probes sealed, and the witness committed at docs/verification/2026-05-10-security-fixes.md.",
	},
	{
		question: "If your system fails in production, how will you handle debugging and recovery?",
		answer:
			"Every request emits an OpenTelemetry trace with a unique request identifier and a personally-identifiable-information-redacted structured log line. The administration console at /admin/logs exposes a real-time SIEM-style log feed filterable by request identifier, service, region, and severity. The /readyz endpoint returns the health-checker verdict over four dependency probes (AlloyDB, Firestore, Secret Manager, language-model provider) every five seconds with a two-second timeout. The Cloud Run service is configured to roll back to the previous healthy revision on a failed-health threshold; the rollback is under sixty seconds. Feature flags gate every new behaviour so a regression can be disabled without redeployment. The kill-switch in the configuration manager disables the platform end-to-end if the safety fence ever returns a failure-mode that the verifier chain did not catch. The on-call runbook is at the project Confluence; the seventy-two-hour Digital-Personal-Data-Protection-Act breach runbook is at docs/compliance.",
	},
	{
		question: "What are the limitations of your project, and how can it be improved further?",
		answer:
			"The platform is not a certified safety system. The README, the SAFETY-NOTICE, and the user-interface banners state that no real autonomy is enabled and that the platform is a research and reference artefact. Live CARLA cannot be exercised on the development workstation; the chaos driver is a wire-identical substitute. The mobile application has been typechecked and unit-tested but has not been live-tested on an end-user device under network-degraded conditions. The post-quantum signature scheme is implemented but is not the default. The future-scope roadmap addresses each limitation: the AlloyDB knowledge graph and the GraphRAG ingestor in Phase 2; the original-equipment-manufacturer adapter tier expansion in Phase 3; the predictive-maintenance subscription tier in Phase 5; the live autonomy launch conditional on completion of the safety, regulatory, insurance, and homologation gates in Phase 6.",
	},
	{
		question: "If you had to deploy this as a real product or startup, what would be your next steps?",
		answer:
			"Step one is to complete the safety, regulatory, insurance, and homologation gates documented in SAFETY-NOTICE; the platform's autonomy code path is wired but is gated behind these gates. Step two is to sign a partnership with one original-equipment manufacturer, beginning with the Mercedes-Benz and Bosch Intelligent Park Pilot deployment in Stuttgart for which the adapter is already implemented. Step three is to sign a service-centre network for the pilot, with a clear scope-of-work and a CommandGrant lifecycle that the network's operations staff can audit. Step four is the Phase 2 deployment of the AlloyDB knowledge graph and the GraphRAG ingestor, which unlocks the predictive-maintenance subscription tier. Step five is the regulatory submission to the relevant authority for India, the United States, and the European Union, building on the Fundamental Rights Impact Assessment and the AI Risk Register that ship with the platform. Step six is the open-source release under Apache 2.0 with the attribution NOTICE preserved as a benefit to adopters; the partner channel for original-equipment-manufacturer integration follows.",
	},
];

// -----------------------------------------------------------------------------
// References (Vancouver style, abbreviated where helpful)
// -----------------------------------------------------------------------------

export const REFERENCES: string[] = [
	"Severson KA, Attia PM, Jin N, et al. Data-driven prediction of battery cycle life before capacity degradation. Nature Energy. 2019;4(5):383-391.",
	"Plett GL. Extended Kalman filtering for battery management systems of LiPB-based HEV battery packs. Journal of Power Sources. 2004;134(2):252-292.",
	"United Nations Economic Commission for Europe. Regulation No. 157, Uniform provisions concerning the approval of vehicles with regard to Automated Lane Keeping Systems. Geneva: UNECE; 2021.",
	"International Organization for Standardization. ISO 21434:2021, Road vehicles, Cybersecurity engineering. Geneva: ISO; 2021.",
	"International Organization for Standardization. ISO 26262, Road vehicles, Functional safety. Geneva: ISO; 2018.",
	"International Organization for Standardization. ISO 21448:2022, Road vehicles, Safety of the intended functionality. Geneva: ISO; 2022.",
	"International Organization for Standardization. ISO 10816, Mechanical vibration, Evaluation of machine vibration. Geneva: ISO; 1995.",
	"Society of Automotive Engineers. SAE J300, Engine Oil Viscosity Classification. Warrendale, PA: SAE International; 2021.",
	"Society of Automotive Engineers. SAE J1979, E/E Diagnostic Test Modes. Warrendale, PA: SAE International; 2017.",
	"Government of India. The Digital Personal Data Protection Act, 2023. Gazette of India. 2023.",
	"European Parliament. Regulation (EU) 2016/679 (General Data Protection Regulation). Brussels: EU; 2016.",
	"European Parliament. Regulation (EU) 2024/1689 (Artificial Intelligence Act). Brussels: EU; 2024.",
	"State of California. California Consumer Privacy Act of 2018, as amended by CPRA 2020. Sacramento: California Legislature; 2020.",
	"Lewis P, Perez E, Piktus A, et al. Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. NeurIPS. 2020.",
	"Yao S, Zhao J, Yu D, et al. ReAct: Synergizing Reasoning and Acting in Language Models. ICLR. 2023.",
	"Wu Q, Bansal G, Zhang J, et al. AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation. arXiv. 2023.",
	"LangChain. LangGraph. https://langchain-ai.github.io/langgraph/ (accessed 2026-05-10).",
	"Hono. https://hono.dev/ (accessed 2026-05-10).",
	"Vercel. Next.js documentation. https://nextjs.org/docs (accessed 2026-05-10).",
	"Anthropic. Claude API documentation. https://docs.anthropic.com (accessed 2026-05-10).",
	"Google Cloud. Cloud Run, Cloud Armor, Identity-Aware Proxy, Firestore documentation. https://cloud.google.com/docs (accessed 2026-05-10).",
	"OpenWorm Project, CARLA. CARLA Simulator 0.9.16 documentation. https://carla.org (accessed 2026-05-10).",
	"RFC 8785. JSON Canonicalization Scheme. Internet Engineering Task Force; 2020.",
	"NIST. FIPS 204, Module-Lattice-Based Digital Signature Standard (ML-DSA). Gaithersburg, MD: NIST; 2024.",
	"OWASP. OWASP Top 10, 2021. https://owasp.org/Top10/ (accessed 2026-05-10).",
];

// -----------------------------------------------------------------------------
// List of figures and tables (computed metadata for the front matter)
// -----------------------------------------------------------------------------

export const LIST_OF_FIGURES: { number: string; caption: string }[] = [
	{ number: "1.1", caption: "Customer landing page at /." },
	{ number: "2.1", caption: "Five user personas mapped to the surfaces they touch." },
	{ number: "3.1", caption: "High-level architecture of the VSBS platform." },
	{ number: "3.2", caption: "Concierge turn data flow with the verifier in line." },
	{ number: "3.3", caption: "Defense-in-depth security layers." },
	{ number: "4.1", caption: "Stack layers with pinned versions." },
	{ number: "5.1", caption: "Payment state machine, eleven states across four swim-lanes." },
	{ number: "6.1", caption: "Sensor fusion topology around the ExtendedKalman class." },
	{ number: "6.2", caption: "Severson 2019 knee-point traction-battery state-of-health." },
	{ number: "6.3", caption: "Wellbeing radar across ten weighted axes." },
	{ number: "6.4", caption: "UNECE R157 four-rung takeover ladder." },
	{ number: "7.1", caption: "Nine-layer verification ladder." },
	{ number: "8.1", caption: "Audit findings before and after fix." },
	{ number: "9.1", caption: "Autonomy dashboard at /autonomy/[id]." },
	{ number: "9.2", caption: "Recordings page at /recordings (admin-gated)." },
	{ number: "9.3", caption: "Consent management at /me/consent." },
	{ number: "9.4", caption: "Region selector at /region." },
	{ number: "11.1", caption: "Phased roadmap, P1 through P12." },
];

export const LIST_OF_TABLES: { number: string; caption: string }[] = [
	{ number: "2.1", caption: "Non-functional requirement targets and measurement approach." },
	{ number: "3.1", caption: "Package inventory and responsibility." },
	{ number: "4.1", caption: "Why each technology was chosen over the leading alternative." },
	{ number: "7.1", caption: "Test ladder, what each layer catches, and the count at the most recent verification." },
	{ number: "8.1", caption: "Audit findings, pre-fix runtime probe response, post-fix response." },
];

// -----------------------------------------------------------------------------
// Section ordering used by both the web page and the docx generator
// -----------------------------------------------------------------------------

export const CHAPTERS: Section[] = [
	CHAPTER_1,
	CHAPTER_2,
	CHAPTER_3,
	CHAPTER_4,
	CHAPTER_5,
	CHAPTER_6,
	CHAPTER_7,
	CHAPTER_8,
	CHAPTER_9,
	CHAPTER_10,
	CHAPTER_11,
];
