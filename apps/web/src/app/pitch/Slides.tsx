"use client";

import type { ComponentType, ReactNode } from "react";

export type Slide = {
	id: string;
	title: string;
	kicker: string;
	Component: ComponentType;
};

/* ───────────────────────── 01 · COVER ───────────────────────── */

function CoverSlide() {
	return (
		<div className="pitch-cover">
			<div>
				<div className="pitch-reveal pitch-eyebrow" style={{ marginBottom: 36 }}>
					Capstone · May 2026 · One vehicle, one calm motion.
				</div>
				<h1 className="pitch-reveal pitch-display pitch-cover-title">
					V<span style={{ fontStyle: "italic" }}>S</span>BS
				</h1>
				<p className="pitch-reveal pitch-cover-tagline">
					Your vehicle. Booked, diagnosed, driven, paid, and returned. Autonomously, audited, on a
					slow phone in Hindi.
				</p>
				<div
					className="pitch-reveal"
					style={{
						marginTop: 44,
						display: "flex",
						alignItems: "center",
						gap: 18,
						flexWrap: "wrap",
						color: "rgba(242, 238, 230, 0.5)",
						fontFamily: "var(--font-mono)",
						fontSize: 11,
						letterSpacing: "0.2em",
						textTransform: "uppercase",
					}}
				>
					<span className="pitch-tag pitch-tag--copper">Divya Mohan</span>
					<span>dmj.one · contact@dmj.one</span>
					<span style={{ color: "rgba(242,238,230,0.3)" }}>·</span>
					<span>Apache 2.0 + NOTICE</span>
					<span style={{ color: "rgba(242,238,230,0.3)" }}>·</span>
					<span>Defensive publication 2026-04-15</span>
				</div>
			</div>
			<div className="pitch-cover-meta" aria-hidden="true">
				<span>VSBS · v0.1 · Capstone</span>
				<span>17 slides · 1 architecture · 0 fabricated capabilities</span>
				<span>#AatmanirbharBharat · @India2047</span>
			</div>
		</div>
	);
}

/* ───────────────────────── 02 · THE HOOK ───────────────────────── */

function HookSlide() {
	return (
		<div className="pitch-hook">
			<div className="pitch-reveal pitch-eyebrow">What VSBS is, in one breath.</div>
			<h2 className="pitch-reveal pitch-hook-line">
				The car <em style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}>books</em>{" "}
				its own service,{" "}
				<em style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}>drives</em> itself
				there, pays within a <span className="pitch-copper">cryptographically signed</span> cap, and{" "}
				<em style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}>drives home</em>.
			</h2>
			<p className="pitch-reveal pitch-hook-secondary">
				On a slow phone, in Hindi. With zero fabricated capability — outside Tier-A AVP, the system
				gracefully degrades to a human pickup with the same UX. Honest about what the vehicle can
				and cannot do.
			</p>
			<div
				className="pitch-reveal"
				style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}
			>
				<span className="pitch-tag">8 packages</span>
				<span className="pitch-tag">15 workspaces</span>
				<span className="pitch-tag">~53,500 LOC TypeScript</span>
				<span className="pitch-tag">10 agent tools</span>
				<span className="pitch-tag pitch-tag--copper">1 env var promotes sim → prod</span>
			</div>
		</div>
	);
}

/* ───────────────────────── 03 · THE PROBLEM ───────────────────────── */

function ProblemSlide() {
	const cards: {
		kicker: string;
		title: string;
		body: string;
		accent: string;
	}[] = [
		{
			kicker: "01 · India",
			title: "Service is broken.",
			body: "Opaque pricing. Repeat visits. The advisor's job is mostly clerical pattern-matching nobody automates end to end. Trust deficit baked into the buying journey.",
			accent: "amber",
		},
		{
			kicker: "02 · Autonomy",
			title: "Mostly vapour.",
			body: "Only one consumer L4 feature is commercially approved in April 2026 — Mercedes/Bosch IPP at APCOA P6 Stuttgart. Most pitches inflate capability. None refuse honestly.",
			accent: "crimson",
		},
		{
			kicker: "03 · OEMs",
			title: "Need a starting point.",
			body: "Compliance-native, research-pedigreed, post-quantum. Not a vendor product they have to legally sandblast for nine months before a single byte goes near a vehicle.",
			accent: "copper",
		},
	];

	return (
		<div
			style={{
				width: "100%",
				display: "flex",
				flexDirection: "column",
				gap: 48,
			}}
		>
			<div>
				<div className="pitch-reveal pitch-eyebrow">The problem is three problems.</div>
				<h2
					className="pitch-reveal pitch-display"
					style={{ fontSize: "clamp(2.5rem, 4.6vw, 4rem)", marginTop: 16 }}
				>
					Why nobody has solved this yet.
				</h2>
			</div>
			<div className="pitch-three-col">
				{cards.map((c) => (
					<div key={c.kicker} className="pitch-reveal pitch-card pitch-card-hairline">
						<div className="pitch-eyebrow" style={{ marginBottom: 18 }}>
							{c.kicker}
						</div>
						<h3 className="pitch-display" style={{ fontSize: "1.9rem", marginBottom: 14 }}>
							{c.title}
						</h3>
						<p className="pitch-pearl-soft" style={{ fontSize: 14, lineHeight: 1.55 }}>
							{c.body}
						</p>
					</div>
				))}
			</div>
			<p
				className="pitch-reveal pitch-pearl-faint"
				style={{
					fontFamily: "var(--font-mono)",
					fontSize: 11,
					letterSpacing: "0.16em",
					textTransform: "uppercase",
				}}
			>
				Sources: docs/research/autonomy.md:11 · docs/research/agentic.md:31 · NOTICE adopter-channel
				framing.
			</p>
		</div>
	);
}

/* ───────────────────────── 04 · WHY NOW ───────────────────────── */

function WhyNowSlide() {
	const events: { date: string; title: string; detail: string }[] = [
		{
			date: "Aug 2024",
			title: "LangGraph 1.0 GA",
			detail: "Production-mature stateful agents.",
		},
		{
			date: "Jan 2025",
			title: "Claude Opus 4.6 + Gemini 3 Pro",
			detail: "Reliable function-calling on Vertex.",
		},
		{
			date: "Aug 2025",
			title: "ML-KEM-768 + ML-DSA-65 in Cloud KMS",
			detail: "Post-quantum hybrid, GA.",
		},
		{
			date: "Nov 2025",
			title: "DPDP Rules 2025 notified",
			detail: "India consent-evidence regime live (14 Nov).",
		},
		{
			date: "Jan 2026",
			title: "τ-bench / BFCL pass at 90%+",
			detail: "Verifier-fenced agents reach reliability bar.",
		},
	];

	return (
		<div
			style={{
				width: "100%",
				display: "flex",
				flexDirection: "column",
				gap: 36,
			}}
		>
			<div className="pitch-reveal">
				<div className="pitch-eyebrow">Why this April, not last April.</div>
				<h2
					className="pitch-display"
					style={{ fontSize: "clamp(2.6rem, 5vw, 4.2rem)", marginTop: 18 }}
				>
					The whole stack <em style={{ fontStyle: "italic" }}>just</em> aligned.
				</h2>
			</div>

			<div
				className="pitch-reveal"
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(5, 1fr)",
					gap: 0,
					position: "relative",
				}}
			>
				<div
					aria-hidden="true"
					style={{
						position: "absolute",
						top: 28,
						left: "10%",
						right: "10%",
						height: 1,
						background:
							"linear-gradient(90deg, transparent 0%, rgba(201,163,106,0.5) 20%, rgba(201,163,106,0.5) 80%, transparent 100%)",
					}}
				/>
				{events.map((e) => (
					<div
						key={e.date}
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							padding: "0 12px",
						}}
					>
						<div
							aria-hidden="true"
							style={{
								width: 14,
								height: 14,
								borderRadius: "50%",
								background: "var(--color-copper)",
								boxShadow: "0 0 12px rgba(201,163,106,0.6)",
								position: "relative",
								zIndex: 2,
								marginBottom: 22,
							}}
						/>
						<div
							className="pitch-mono"
							style={{
								fontSize: 10,
								letterSpacing: "0.18em",
								textTransform: "uppercase",
								color: "var(--color-copper)",
								marginBottom: 8,
							}}
						>
							{e.date}
						</div>
						<div
							className="pitch-display"
							style={{
								fontSize: 18,
								lineHeight: 1.2,
								textAlign: "center",
								marginBottom: 6,
							}}
						>
							{e.title}
						</div>
						<div
							className="pitch-pearl-soft"
							style={{ fontSize: 12, textAlign: "center", lineHeight: 1.4 }}
						>
							{e.detail}
						</div>
					</div>
				))}
			</div>

			<div className="pitch-reveal pitch-card" style={{ marginTop: 12 }}>
				<p
					className="pitch-quote"
					style={{ maxWidth: "62ch", fontSize: "clamp(1.4rem, 2.4vw, 2.1rem)" }}
				>
					"Autonomous service is the narrowest, highest-value AV wedge — low-speed, geofenced,
					owner-consented. Tractable without L5."
				</p>
				<div className="pitch-quote-attribution">VSBS thesis · docs/research/autonomy.md</div>
			</div>
		</div>
	);
}

/* ───────────────────────── 05 · THE SOLUTION ───────────────────────── */

function SolutionSlide() {
	const diffs: { title: string; detail: string }[] = [
		{
			title: "Wellbeing-dominant dispatch",
			detail:
				"The dispatch ranker weights wellbeing 2.5× — larger than distance, price, or capacity combined. Inside wellbeing, safety is the dominant axis.",
		},
		{
			title: "Sim ↔ live state-machine parity",
			detail:
				"Every external dependency promotes by flipping one env var. Sim drivers reproduce latency, idempotency, webhook order, and error class. No 'cleanup pass' to go live.",
		},
		{
			title: "Sensor provenance, structurally enforced",
			detail:
				"Every sample carries origin: 'real' | 'sim'. Branded TS types + boundary checks make a sim sample structurally incapable of entering a real decision log.",
		},
		{
			title: "CommandGrant capability tokens",
			detail:
				"Time-bounded, geofence-bounded, scope-bounded, signed. The auto-pay cap is encoded inside the token — a compromised server cannot overcharge.",
		},
		{
			title: "Honest refusal",
			detail:
				"Outside Tier-A AVP, the system gracefully degrades to human pickup with the same UX. Zero fabricated autonomy. The refusal logic is itself a credibility moat.",
		},
	];

	return (
		<div
			style={{
				width: "100%",
				display: "grid",
				gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
				gap: 56,
			}}
		>
			<div
				className="pitch-reveal"
				style={{
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
				}}
			>
				<div className="pitch-eyebrow" style={{ marginBottom: 18 }}>
					The solution, in one paragraph.
				</div>
				<h2
					className="pitch-display"
					style={{ fontSize: "clamp(2.4rem, 4.6vw, 3.6rem)", marginBottom: 24 }}
				>
					A 12-package monorepo that is <em>safe by construction</em>, not by review.
				</h2>
				<p className="pitch-pearl-soft" style={{ fontSize: 16, lineHeight: 1.7, maxWidth: "44ch" }}>
					LangGraph supervisor with a Haiku verifier on every tool call. Provider-agnostic LLM layer
					(sim, demo, prod via one env var). Deterministic safety + wellbeing engines. Sensor-fusion
					+ PHM advisory pipeline. CommandGrant capability protocol with passkey + ML-DSA-65
					witness. A full DPDP / GDPR / EU AI Act compliance pack. Running end-to-end on a slow
					phone, in Hindi, with zero API keys.
				</p>
			</div>
			<div className="pitch-reveal">
				<ol className="pitch-numbered-list">
					{diffs.map((d) => (
						<li key={d.title} className="pitch-numbered-item">
							<div>
								<div className="pitch-numbered-title">{d.title}</div>
								<div className="pitch-numbered-detail">{d.detail}</div>
							</div>
						</li>
					))}
				</ol>
			</div>
		</div>
	);
}

/* ───────────────────────── 06 · LIVE DEMO ───────────────────────── */

function DemoSlide() {
	return (
		<div
			style={{
				width: "100%",
				display: "grid",
				gridTemplateColumns: "minmax(0, 0.85fr) minmax(0, 1.15fr)",
				gap: 48,
				alignItems: "center",
			}}
		>
			<div className="pitch-reveal">
				<div className="pitch-eyebrow" style={{ marginBottom: 16 }}>
					The 90-second money shot.
				</div>
				<h2
					className="pitch-display"
					style={{
						fontSize: "clamp(2.2rem, 4.2vw, 3.4rem)",
						lineHeight: 1,
						marginBottom: 24,
					}}
				>
					The safety system overrides the LLM, <em>live</em>, on stage.
				</h2>
				<p className="pitch-pearl-soft" style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 28 }}>
					Type{" "}
					<span className="pitch-mono pitch-copper">
						"My 2024 Honda Civic is grinding when I brake"
					</span>{" "}
					into /book step 5. Watch the SSE trace render the agent loop in plain English. The C3
					output filter rewrites the LLM&apos;s drive-suggestion before any byte reaches the
					customer.
				</p>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 10,
						fontSize: 13,
					}}
				>
					<div
						className="pitch-pearl-faint"
						style={{
							fontFamily: "var(--font-mono)",
							fontSize: 11,
							letterSpacing: "0.18em",
							textTransform: "uppercase",
						}}
					>
						Witness
					</div>
					<div className="pitch-pearl-soft">docs/verification/REPORT.md:140-156</div>
					<div className="pitch-pearl-soft">runs/2026-05-02-recordings/concierge-sse.log</div>
					<div className="pitch-pearl-faint" style={{ fontStyle: "italic", marginTop: 6 }}>
						Captured on a 2 GiB-VRAM 940MX laptop. Zero API keys.
					</div>
					<div
						style={{
							marginTop: 18,
							paddingTop: 14,
							borderTop: "1px solid rgba(255,255,255,0.08)",
							display: "flex",
							flexDirection: "column",
							gap: 6,
						}}
					>
						<div className="pitch-eyebrow" style={{ marginBottom: 4, fontSize: 10 }}>
							Second beat · web cockpit
						</div>
						<div className="pitch-pearl-soft" style={{ fontSize: 13 }}>
							One click on <span className="pitch-mono pitch-copper">/</span> spawns real CARLA
							0.9.16 via{" "}
							<span className="pitch-mono pitch-copper">POST /v1/scenarios/test-drive/start</span>.
							Random fault injected after 60 s warmup. The dashboard streams the ride.
						</div>
					</div>
				</div>
			</div>

			<div className="pitch-reveal pitch-terminal">
				<div className="pitch-terminal-header">
					<span className="pitch-terminal-dot" />
					<span className="pitch-terminal-dot" />
					<span className="pitch-terminal-dot" />
					<span className="pitch-terminal-title">POST /v1/concierge/turn · text/event-stream</span>
				</div>
				<div className="pitch-terminal-body">
					<div className="pitch-term-line">
						<span className="pitch-term-prompt">›</span>
						<span>
							<span className="pitch-term-tag pitch-term-tag--copper">tool</span>
							assessSafety(owner: &quot;grinding when I brake&quot;, sensorFlags: [])
						</span>
					</div>
					<div className="pitch-term-line" style={{ marginLeft: 32 }}>
						<span style={{ color: "#6fdfb1" }}>✓ verifier</span>
						<span className="pitch-pearl-soft">grounded · severity=green · confidence=1.0</span>
					</div>
					<div className="pitch-term-line">
						<span className="pitch-term-prompt">›</span>
						<span>
							<span className="pitch-term-tag pitch-term-tag--copper">tool</span>
							scoreWellbeing(safety, wait, ces, csat, …)
						</span>
					</div>
					<div className="pitch-term-line" style={{ marginLeft: 32 }}>
						<span style={{ color: "#6fdfb1" }}>✓ verifier</span>
						<span className="pitch-pearl-soft">grounded · band=good · safety axis=0.25</span>
					</div>
					<div className="pitch-term-line">
						<span className="pitch-term-prompt">›</span>
						<span>
							<span className="pitch-term-tag pitch-term-tag--warn">delta</span>
							<span className="pitch-term-strikethrough">
								&quot;…the vehicle is safe to drive in the short term…&quot;
							</span>
						</span>
					</div>
					<div className="pitch-term-line">
						<span className="pitch-term-prompt" style={{ color: "var(--color-copper)" }}>
							!
						</span>
						<span>
							<span className="pitch-term-tag pitch-term-tag--crit">C3 override</span>
							<span style={{ color: "rgba(242,238,230,0.6)" }}>
								SafetyFence rewrote final emission
							</span>
						</span>
					</div>
					<div className="pitch-term-line pitch-term-override">
						<span style={{ color: "var(--color-copper)" }}>›</span>
						<span>
							<span className="pitch-term-tag pitch-term-tag--ok">final</span>
							<span style={{ fontStyle: "italic" }}>
								&quot;I cannot certify safety. Please consult a qualified mechanic.&quot;
							</span>
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}

/* ───────────────────────── 07 · ARCHITECTURE ───────────────────────── */

function ArchitectureSlide() {
	return (
		<div
			style={{
				width: "100%",
				display: "flex",
				flexDirection: "column",
				gap: 28,
			}}
		>
			<div
				className="pitch-reveal"
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "baseline",
					flexWrap: "wrap",
					gap: 16,
				}}
			>
				<div>
					<div className="pitch-eyebrow">If we drew one diagram, it would be this.</div>
					<h2
						className="pitch-display"
						style={{ fontSize: "clamp(2rem, 3.6vw, 2.8rem)", marginTop: 8 }}
					>
						Architecture, top to bottom.
					</h2>
				</div>
				<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
					<span className="pitch-tag pitch-tag--copper">Zod is the source of truth</span>
					<span className="pitch-tag">Hono on Bun on Cloud Run</span>
					<span className="pitch-tag">Next.js 16 · React 19 · Tailwind 4</span>
				</div>
			</div>

			<div
				className="pitch-reveal"
				style={{
					flex: 1,
					display: "grid",
					placeItems: "stretch",
					overflow: "hidden",
				}}
			>
				<ArchitectureSVG />
			</div>
		</div>
	);
}

function ArchitectureSVG() {
	return (
		<svg
			viewBox="0 0 1280 600"
			className="pitch-arch-svg"
			preserveAspectRatio="xMidYMid meet"
			role="img"
			aria-labelledby="arch-svg-title arch-svg-desc"
		>
			<title id="arch-svg-title">VSBS architecture diagram</title>
			<desc id="arch-svg-desc">
				Top band of safety invariants over a left rail of four package layers (shared, sensors, llm,
				agents), a centre pipeline from owner through web, API, LangGraph, tools to a live booking,
				a right rail showing LiveAutonomyHub feeding fourteen telemetry blocks, and a bottom band
				showing the LLM_PROFILE switch with sim, demo, and prod values.
			</desc>
			{/* Top band: safety invariants */}
			<g>
				<rect x="40" y="20" width="1200" height="56" rx="10" className="arch-fill" />
				<rect x="40" y="20" width="1200" height="56" rx="10" className="arch-copper" />
				<text x="64" y="44" className="arch-kicker">
					Safety invariants · non-overridable
				</text>
				<text x="64" y="64" className="arch-label">
					Red-flag set · UNECE R157 4-rung ladder · MRM ≤ 4 m/s² · CommandGrant signed + geofenced +
					capped · PHM SOTIF gate · ISO 13374
				</text>
			</g>

			{/* Left rail: 4 layers */}
			<g>
				<rect x="40" y="100" width="240" height="380" rx="10" className="arch-fill" />
				<rect x="40" y="100" width="240" height="380" rx="10" className="arch-stroke" />
				<text x="64" y="126" className="arch-kicker">
					04 · packages
				</text>
				<text x="64" y="150" className="arch-label" style={{ fontSize: 14, fontWeight: 600 }}>
					shared
				</text>
				<text x="64" y="170" className="arch-label" style={{ opacity: 0.65 }}>
					Zod schemas · safety · wellbeing · autonomy · phm
				</text>
				<line x1="64" y1="190" x2="256" y2="190" className="arch-stroke" />
				<text x="64" y="216" className="arch-label" style={{ fontSize: 14, fontWeight: 600 }}>
					sensors
				</text>
				<text x="64" y="236" className="arch-label" style={{ opacity: 0.65 }}>
					EKF · arbitration · RUL × 7 · provenance
				</text>
				<line x1="64" y1="256" x2="256" y2="256" className="arch-stroke" />
				<text x="64" y="282" className="arch-label" style={{ fontSize: 14, fontWeight: 600 }}>
					llm
				</text>
				<text x="64" y="302" className="arch-label" style={{ opacity: 0.65 }}>
					6 providers · role registry · profile flip
				</text>
				<line x1="64" y1="322" x2="256" y2="322" className="arch-stroke" />
				<text x="64" y="348" className="arch-label" style={{ fontSize: 14, fontWeight: 600 }}>
					agents
				</text>
				<text x="64" y="368" className="arch-label" style={{ opacity: 0.65 }}>
					LangGraph · verifier · 10 tools · 3-layer fence
				</text>

				<text x="64" y="450" className="arch-kicker" style={{ fill: "rgba(242,238,230,0.45)" }}>
					+ security · compliance · telemetry · kb
				</text>
			</g>

			{/* Centre: pipeline */}
			<g>
				{/* Step boxes */}
				{[
					{ x: 320, label: "Owner", sub: "slow phone · Hindi" },
					{ x: 470, label: "Web", sub: "Next.js 16" },
					{ x: 620, label: "API", sub: "Hono · Bun · Cloud Run" },
					{ x: 790, label: "LangGraph", sub: "supervisor + verifier" },
					{ x: 970, label: "Tools", sub: "10 Zod-typed" },
					{ x: 1120, label: "Booking", sub: "live + audited" },
				].map((step) => (
					<g key={step.label}>
						<rect x={step.x} y={210} width={120} height={70} rx={8} className="arch-fill" />
						<rect x={step.x} y={210} width={120} height={70} rx={8} className="arch-stroke" />
						<text
							x={step.x + 60}
							y={240}
							textAnchor="middle"
							className="arch-label"
							style={{ fontSize: 13, fontWeight: 600 }}
						>
							{step.label}
						</text>
						<text
							x={step.x + 60}
							y={260}
							textAnchor="middle"
							className="arch-label"
							style={{ fontSize: 10, opacity: 0.6 }}
						>
							{step.sub}
						</text>
					</g>
				))}

				{/* Arrows */}
				{[440, 590, 740, 910, 1090].map((x) => (
					<g key={x}>
						<line x1={x} y1={245} x2={x + 30} y2={245} className="arch-copper" />
						<polygon
							points={`${x + 30},245 ${x + 24},241 ${x + 24},249`}
							fill="var(--color-copper)"
						/>
					</g>
				))}

				{/* Verifier loop */}
				<path
					d="M 850 210 Q 850 160 910 160 Q 970 160 970 210"
					className="arch-copper"
					strokeDasharray="4 4"
				/>
				<text x="910" y="148" textAnchor="middle" className="arch-kicker">
					loop with verifier
				</text>
			</g>

			{/* Right rail: LiveAutonomyHub */}
			<g>
				<rect x="1000" y="100" width="240" height="80" rx="10" className="arch-fill" />
				<rect x="1000" y="100" width="240" height="80" rx="10" className="arch-stroke" />
				<text x="1024" y="126" className="arch-kicker">
					10 Hz live telemetry · web-triggered
				</text>
				<text x="1024" y="148" className="arch-label" style={{ fontSize: 14, fontWeight: 600 }}>
					LiveAutonomyHub
				</text>
				<text x="1024" y="166" className="arch-label" style={{ opacity: 0.65 }}>
					ring-buffered SSE · /scenarios/test-drive
				</text>

				<rect x="1000" y="320" width="240" height="160" rx="10" className="arch-fill" />
				<rect x="1000" y="320" width="240" height="160" rx="10" className="arch-stroke" />
				<text x="1024" y="346" className="arch-kicker">
					16 schema blocks · 17 dashboard sections
				</text>
				<text x="1024" y="368" className="arch-label" style={{ fontSize: 12 }}>
					sensors · gnss · imu · wheels
				</text>
				<text x="1024" y="386" className="arch-label" style={{ fontSize: 12 }}>
					chassis · powertrain · perception · planner
				</text>
				<text x="1024" y="404" className="arch-label" style={{ fontSize: 12 }}>
					control · compute · network · v2x
				</text>
				<text x="1024" y="422" className="arch-label" style={{ fontSize: 12 }}>
					safety · cabin · environment · software
				</text>
				<text x="1024" y="450" className="arch-kicker">
					CARLA · or chaos driver · wire-identical
				</text>
			</g>

			{/* Bottom band: LLM_PROFILE switch */}
			<g>
				<rect x="40" y="520" width="1200" height="60" rx="10" className="arch-fill" />
				<rect x="40" y="520" width="1200" height="60" rx="10" className="arch-copper" />
				<text x="64" y="548" className="arch-kicker">
					One env var. The entire promotion story.
				</text>
				<text x="64" y="568" className="arch-label" style={{ fontSize: 14 }}>
					LLM_PROFILE = sim&nbsp;&nbsp;|&nbsp;&nbsp;demo&nbsp;&nbsp;|&nbsp;&nbsp;prod
				</text>
				<text x="1216" y="568" textAnchor="end" className="arch-label" style={{ opacity: 0.6 }}>
					scripted (zero keys) · Gemini 2.5 Flash-Lite · Vertex Claude Opus 4.6
				</text>
			</g>
		</svg>
	);
}

/* ───────────────────────── 08 · THE AGENT LOOP ───────────────────────── */

function AgentLoopSlide() {
	const tools: { name: string; detail: string }[] = [
		{
			name: "decodeVin",
			detail: "NHTSA vPIC lookup · deterministic · confidence 1.0",
		},
		{
			name: "assessSafety",
			detail: "Hard-coded red-flag evaluator · fail-closed cross-check",
		},
		{
			name: "scoreWellbeing",
			detail: "10-axis weighted composite · safety axis dominant · safety as gate",
		},
		{ name: "driveEta", detail: "Routes API · soft confidence floor 0.6" },
		{
			name: "resolveAutonomy",
			detail: "Tier-A AVP eligibility cascade · fail-closed",
		},
		{ name: "commitIntake", detail: "Idempotent Zod-validated intake commit" },
		{
			name: "createPaymentOrder",
			detail: "Razorpay sim/live state-machine parity",
		},
		{ name: "createPaymentIntent", detail: "UPI · card · netbanking · wallet" },
		{ name: "authorisePayment", detail: "Verifier-gated auth step" },
		{
			name: "capturePayment",
			detail: "Irreversible · cap-bound · CommandGrant-witnessed",
		},
	];

	return (
		<div
			style={{
				width: "100%",
				display: "grid",
				gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
				gap: 56,
				alignItems: "stretch",
			}}
		>
			<div
				className="pitch-reveal"
				style={{
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
				}}
			>
				<div className="pitch-eyebrow">The agent loop, deterministic at the edges.</div>
				<h2
					className="pitch-display"
					style={{
						fontSize: "clamp(2rem, 3.8vw, 3rem)",
						marginTop: 12,
						marginBottom: 28,
					}}
				>
					Supervisor talks. <em>Verifier listens.</em> Zod gates the door.
				</h2>
				<div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
					<div>
						<div className="pitch-eyebrow pitch-eyebrow--muted" style={{ marginBottom: 6 }}>
							Topology
						</div>
						<div className="pitch-mono" style={{ fontSize: 14, color: "var(--color-pearl)" }}>
							START → supervisor → (verify → tools → supervisor)* → END
						</div>
						<div className="pitch-pearl-faint pitch-mono" style={{ fontSize: 12, marginTop: 4 }}>
							MAX_STEPS = 12 · runaway-loop fail-closed cap
						</div>
					</div>
					<div>
						<div className="pitch-eyebrow pitch-eyebrow--muted" style={{ marginBottom: 6 }}>
							8 agent roles
						</div>
						<div className="pitch-pearl-soft" style={{ fontSize: 13, lineHeight: 1.7 }}>
							Concierge · Intake · Diagnosis · Dispatch · Wellbeing · Verifier · Autonomy · Payment
						</div>
					</div>
					<div>
						<div className="pitch-eyebrow pitch-eyebrow--muted" style={{ marginBottom: 6 }}>
							3-layer output defence
						</div>
						<div className="pitch-pearl-soft" style={{ fontSize: 13, lineHeight: 1.7 }}>
							Confidence gate → SafetyFence → screenFinalOutput · any internal error fails closed to
							canonical red-flag advisory.
						</div>
					</div>
				</div>
			</div>

			<div className="pitch-reveal" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
				<div className="pitch-eyebrow" style={{ marginBottom: 8 }}>
					10 Zod-typed tools
				</div>
				{tools.map((t) => (
					<div
						key={t.name}
						style={{
							display: "grid",
							gridTemplateColumns: "minmax(180px, auto) 1fr",
							gap: 18,
							alignItems: "baseline",
							padding: "10px 0",
							borderBottom: "1px solid rgba(255,255,255,0.06)",
						}}
					>
						<div
							className="pitch-mono"
							style={{
								color: "var(--color-pearl)",
								fontSize: 14,
								fontWeight: 500,
							}}
						>
							{t.name}
						</div>
						<div className="pitch-pearl-soft" style={{ fontSize: 13, lineHeight: 1.5 }}>
							{t.detail}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

/* ───────────────────────── 09 · SAFETY + AUTONOMY ───────────────────────── */

function SafetySlide() {
	return (
		<div
			style={{
				width: "100%",
				display: "flex",
				flexDirection: "column",
				gap: 28,
			}}
		>
			<div className="pitch-reveal">
				<div className="pitch-eyebrow">Safe by construction, not by review.</div>
				<h2
					className="pitch-display"
					style={{ fontSize: "clamp(2.2rem, 4vw, 3.2rem)", marginTop: 12 }}
				>
					Four invariants the system <em>cannot</em> violate.
				</h2>
			</div>

			<div className="pitch-reveal pitch-three-col">
				<div className="pitch-card pitch-card-hairline">
					<div className="pitch-eyebrow" style={{ marginBottom: 12 }}>
						01 · Red flags
					</div>
					<div className="pitch-display" style={{ fontSize: 22, marginBottom: 16 }}>
						14 hard-coded triggers.
					</div>
					<div
						className="pitch-pearl-soft"
						style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}
					>
						10 owner-reported + 4 sensor-derived. Non-overridable Set. Any hit ⇒ severity:red, tow
						mandated, all drive-in / autonomous paths disabled.
					</div>
					<div className="pitch-mono pitch-pearl-faint" style={{ fontSize: 11, lineHeight: 1.6 }}>
						brake-failure · steering-failure · engine-fire · visible-smoke-from-hood ·
						fluid-puddle-large · coolant-boiling · oil-pressure-red-light · airbag-deployed-recent ·
						ev-battery-thermal-warning · driver-reports-unsafe · brake-pressure-residual-critical ·
						steering-assist-lost · hv-battery-dT-runaway ·
						oil-pressure-sensor-below-threshold-confirmed
					</div>
				</div>
				<div className="pitch-card pitch-card-hairline">
					<div className="pitch-eyebrow" style={{ marginBottom: 12 }}>
						02 · UNECE R157 ladder
					</div>
					<div className="pitch-display" style={{ fontSize: 22, marginBottom: 16 }}>
						4-rung escalation, terminal MRM.
					</div>
					<ol
						style={{
							listStyle: "none",
							margin: 0,
							padding: 0,
							display: "flex",
							flexDirection: "column",
							gap: 8,
						}}
					>
						<li
							style={{
								display: "grid",
								gridTemplateColumns: "16px 1fr",
								gap: 10,
							}}
						>
							<span className="pitch-mono" style={{ color: "var(--color-emerald)", fontSize: 12 }}>
								1
							</span>
							<div>
								<div className="pitch-pearl" style={{ fontSize: 13 }}>
									informational
								</div>
								<div className="pitch-pearl-faint" style={{ fontSize: 11 }}>
									visual only
								</div>
							</div>
						</li>
						<li
							style={{
								display: "grid",
								gridTemplateColumns: "16px 1fr",
								gap: 10,
							}}
						>
							<span className="pitch-mono" style={{ color: "#f4cf78", fontSize: 12 }}>
								2
							</span>
							<div>
								<div className="pitch-pearl" style={{ fontSize: 13 }}>
									warning
								</div>
								<div className="pitch-pearl-faint" style={{ fontSize: 11 }}>
									visual + audio · 60% hold
								</div>
							</div>
						</li>
						<li
							style={{
								display: "grid",
								gridTemplateColumns: "16px 1fr",
								gap: 10,
							}}
						>
							<span className="pitch-mono" style={{ color: "#f0a05c", fontSize: 12 }}>
								3
							</span>
							<div>
								<div className="pitch-pearl" style={{ fontSize: 13 }}>
									urgent
								</div>
								<div className="pitch-pearl-faint" style={{ fontSize: 11 }}>
									4 modalities · 30% hold
								</div>
							</div>
						</li>
						<li
							style={{
								display: "grid",
								gridTemplateColumns: "16px 1fr",
								gap: 10,
							}}
						>
							<span className="pitch-mono" style={{ color: "#ef8b97", fontSize: 12 }}>
								4
							</span>
							<div>
								<div className="pitch-pearl" style={{ fontSize: 13 }}>
									emergency-mrm
								</div>
								<div className="pitch-pearl-faint" style={{ fontSize: 11 }}>
									terminal · ≤ 4 m/s² decel
								</div>
							</div>
						</li>
					</ol>
				</div>
				<div className="pitch-card pitch-card-hairline">
					<div className="pitch-eyebrow" style={{ marginBottom: 12 }}>
						03 · CommandGrant
					</div>
					<div className="pitch-display" style={{ fontSize: 22, marginBottom: 16 }}>
						Capability tokens, not flags.
					</div>
					<div
						className="pitch-pearl-soft"
						style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}
					>
						UUID + tier + scopes + notBefore + notAfter + geofence radius + maxAutoPayInr + ownerSig
						+ witnesses. Auto-pay cap encoded inside the signed token. The phone is the root of
						trust.
					</div>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
						<span className="pitch-tag pitch-tag--copper">ML-DSA-65</span>
						<span className="pitch-tag pitch-tag--copper">WebAuthn ES256</span>
						<span className="pitch-tag pitch-tag--copper">RS256</span>
						<span className="pitch-tag pitch-tag--copper">Ed25519</span>
					</div>
				</div>
			</div>

			<div
				className="pitch-reveal"
				style={{
					display: "grid",
					gridTemplateColumns: "auto 1fr",
					gap: 24,
					alignItems: "center",
					padding: "20px 24px",
					borderTop: "1px solid rgba(201,163,106,0.4)",
					borderBottom: "1px solid rgba(255,255,255,0.06)",
				}}
			>
				<div className="pitch-eyebrow">04 · PHM SOTIF gate</div>
				<div className="pitch-pearl-soft" style={{ fontSize: 14, lineHeight: 1.6 }}>
					32 components × 5 PHM states × criticality Tier 1/2/3 (ISO 26262 referenced).{" "}
					<span className="pitch-copper">Tier-1 sensor dead ⇒ autonomy refused</span> per ISO 21448.
					Lower-confidence-bound RUL. Coverage manifest pre-check refuses the path before the LLM
					ever gets the question.
				</div>
			</div>
		</div>
	);
}

/* ───────────────────────── 10 · PREDICTIVE RUL ───────────────────────── */

function PredictiveRulSlide() {
	const cells: { value: string; label: string; note: string }[] = [
		{
			value: "38.9 M",
			label: "Training rows",
			note: "Synthetic GPU-vectorised stochastic-fault simulation · 200k iter × ~600 samples",
		},
		{
			value: "11",
			label: "Features",
			note: "+4 in this session: jump recency · jump cluster · plateau · slope×health",
		},
		{
			value: "P10·P50·P90",
			label: "Quantile head",
			note: "Pinball loss · one MLP head per τ",
		},
		{
			value: "80.04 %",
			label: "Empirical coverage",
			note: "[P10, P90] band on held-out val · target 80 %",
		},
		{
			value: "25.14 s",
			label: "P50 MAE",
			note: "On par with XGBoost CUDA (25.33 s) · same backbone as point MLP",
		},
		{
			value: "150 s",
			label: "Reroute threshold",
			note: "Was 90 s · bridge acts on conservative P10, not the median",
		},
	];
	return (
		<div
			style={{
				width: "100%",
				display: "flex",
				flexDirection: "column",
				gap: 24,
			}}
		>
			<div
				className="pitch-reveal"
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "baseline",
					flexWrap: "wrap",
					gap: 16,
				}}
			>
				<div>
					<div className="pitch-eyebrow">Predictive RUL · honest uncertainty.</div>
					<h2
						className="pitch-display"
						style={{ fontSize: "clamp(2rem, 3.8vw, 3rem)", marginTop: 12 }}
					>
						<em>Calibrated</em>, not just accurate.
					</h2>
				</div>
				<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
					<span className="pitch-tag pitch-tag--copper">
						GPU-trained · GPU inference · linear fallback when no CUDA
					</span>
					<span className="pitch-tag">PyTorch · CUDA · XGBoost CUDA</span>
				</div>
			</div>

			<div
				className="pitch-reveal"
				style={{
					display: "grid",
					gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 0.95fr)",
					gap: 36,
					alignItems: "stretch",
				}}
			>
				<div className="pitch-numbers-grid" style={{ alignSelf: "start" }}>
					{cells.map((c) => (
						<div key={c.label} className="pitch-number-cell" style={{ minHeight: 150 }}>
							<div
								className="pitch-number-value"
								style={{ fontSize: "clamp(2rem, 3.6vw, 3.2rem)" }}
							>
								{c.value}
							</div>
							<div className="pitch-number-label">{c.label}</div>
							<div className="pitch-number-note">{c.note}</div>
						</div>
					))}
				</div>

				<div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
					<div className="pitch-card pitch-card-hairline">
						<div className="pitch-eyebrow" style={{ marginBottom: 10 }}>
							Architecture
						</div>
						<div className="pitch-mono pitch-pearl-soft" style={{ fontSize: 12, lineHeight: 1.7 }}>
							Linear(11→128) → GELU → Linear(128→128) → GELU →
							<br />
							Linear(128→64) → GELU → Linear(64→3)
						</div>
						<div
							className="pitch-pearl-faint"
							style={{ fontSize: 12, lineHeight: 1.6, marginTop: 10 }}
						>
							AdamW · lr 2e-3 · cosine annealing · 20 epochs · batch 8192 · feature standardisation
							· best-by-P50-MAE checkpoint. Same backbone as the point MLP — the win is the loss
							function.
						</div>
					</div>

					<div className="pitch-card pitch-card-hairline">
						<div className="pitch-eyebrow" style={{ marginBottom: 10 }}>
							Headless evaluation · 200k synthetic runs
						</div>
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "auto 1fr",
								rowGap: 6,
								columnGap: 18,
								fontSize: 13,
							}}
						>
							<span className="pitch-mono pitch-copper">arrived_safely</span>
							<span className="pitch-pearl">100.00 %</span>
							<span className="pitch-mono pitch-copper">tow_after_warning</span>
							<span className="pitch-pearl">0.00 %</span>
							<span className="pitch-mono pitch-copper">mean lead</span>
							<span className="pitch-pearl">193 s</span>
							<span className="pitch-mono pitch-copper">P10 lead</span>
							<span className="pitch-pearl">127 s</span>
							<span className="pitch-mono pitch-copper">vs linear</span>
							<span className="pitch-pearl-soft">+16 s mean · +14 s P10</span>
						</div>
					</div>

					<div
						style={{
							border: "1px solid rgba(217, 164, 65, 0.4)",
							borderLeft: "2px solid var(--color-amber)",
							borderRadius: 8,
							padding: "12px 16px",
							background: "rgba(217, 164, 65, 0.04)",
						}}
					>
						<div className="pitch-eyebrow" style={{ color: "#f0c773", marginBottom: 6 }}>
							Honest caveats
						</div>
						<div className="pitch-pearl-soft" style={{ fontSize: 12, lineHeight: 1.6 }}>
							Numbers above are synthetic-simulator headless. A feature-semantics mismatch on{" "}
							<span className="pitch-mono">t_since_fault_s</span> is unfixed in the live bridge —
							known issue, queued for the next pass. Training set is synthetic; no real-vehicle
							telematics yet. Tracked in{" "}
							<span className="pitch-mono">docs/2026-05-09-predictor-optimization-handoff.md</span>.
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/* ───────────────────────── 11 · L5 SENSOR STREAM ───────────────────────── */

function SensorSlide() {
	const tiles: { name: string; detail: string }[] = [
		{ name: "Cameras", detail: "≤16 surround" },
		{ name: "Radars", detail: "≤8 · 4D imaging" },
		{ name: "LiDAR", detail: "≤4 · solid-state" },
		{ name: "Thermal", detail: "≤4 · LWIR" },
		{ name: "Audio", detail: "≤8-mic array" },
		{ name: "Ultrasonic", detail: "≤16 close-range" },
		{ name: "GNSS · RTK", detail: "GPS · Galileo · NavIC" },
		{ name: "IMU", detail: "9-DoF · tactical-grade" },
		{ name: "Wheels", detail: "in-tyre pyrometric" },
		{ name: "Chassis", detail: "ride height ×4" },
		{ name: "Motors", detail: "front + rear · inverter" },
		{ name: "HV pack", detail: "96-cell heat-map" },
		{ name: "Coolant", detail: "3-loop · motor / pack / inverter" },
		{ name: "Perception", detail: "BEV · tracks · risk halos" },
		{ name: "Planner", detail: "horizon · CVaR95" },
		{ name: "Compute", detail: "AURIX lockstep · HSM" },
		{ name: "Network", detail: "5G NR-V2X · MEC" },
		{ name: "V2X bus", detail: "BSM · CAM · SPaT · DENM" },
		{ name: "Safety", detail: "ODD · OOD · R157 · MRM" },
		{ name: "Cabin", detail: "DMS · CO₂ · HVAC" },
		{ name: "Environment", detail: "weather · pavement · TOD" },
	];

	return (
		<div
			style={{
				width: "100%",
				display: "flex",
				flexDirection: "column",
				gap: 28,
			}}
		>
			<div
				className="pitch-reveal"
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "baseline",
					flexWrap: "wrap",
					gap: 18,
				}}
			>
				<div>
					<div className="pitch-eyebrow">Live L5 telemetry · 10 Hz · per booking.</div>
					<h2
						className="pitch-display"
						style={{ fontSize: "clamp(2rem, 3.8vw, 3rem)", marginTop: 12 }}
					>
						17 sections of ground truth.
					</h2>
				</div>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "flex-end",
						gap: 6,
					}}
				>
					<span className="pitch-tag pitch-tag--copper">
						CARLA · or chaos driver · wire-identical
					</span>
					<span
						className="pitch-pearl-faint pitch-mono"
						style={{ fontSize: 11, letterSpacing: "0.16em" }}
					>
						POST /v1/autonomy/:id/telemetry/ingest · GET …/sse
					</span>
				</div>
			</div>

			<div className="pitch-reveal pitch-sensor-grid">
				{tiles.map((t) => (
					<div key={t.name} className="pitch-sensor-tile">
						<div className="pitch-sensor-name">{t.name}</div>
						<div className="pitch-sensor-detail">{t.detail}</div>
					</div>
				))}
			</div>

			<div
				className="pitch-reveal pitch-pearl-faint"
				style={{
					fontSize: 12,
					lineHeight: 1.6,
					fontStyle: "italic",
					maxWidth: "76ch",
				}}
			>
				Every sample is stamped with origin: &quot;real&quot; | &quot;sim&quot;. Branded TS types
				make a sim sample structurally incapable of entering a real decision log. The dashboard
				renders 12 sections, including a 96-cell HV pack heat-map and a BEV occupancy mini-map with
				class-coded risk halos.
			</div>
		</div>
	);
}

/* ───────────────────────── 11 · NUMBERS ───────────────────────── */

function NumbersSlide() {
	const cells: {
		value: string;
		label: string;
		note: string;
		small?: boolean;
	}[] = [
		{
			value: "1,163",
			label: "Unit tests",
			note: "Across 13 workspaces · counted by `pnpm -r test` on 2026-05-11",
		},
		{
			value: "32",
			label: "Live HTTP probes",
			note: "31 pass · 1 known-bad empty-body case · correction probe returns 202",
		},
		{
			value: "0",
			label: "Mishandled grants",
			note: "Every CommandGrant verified end to end",
		},
		{
			value: "10",
			label: "Agent tools",
			note: "Every one Zod-typed at the door",
		},
		{
			value: "31",
			label: "/v1 endpoints",
			note: "19 router mounts + 9 inline + 3 test-drive · path-aware rate limiter",
		},
		{
			value: "12",
			label: "Inventive concepts",
			note: "Defensive publication 2026-04-15",
		},
		{
			value: "12",
			label: "Phases shipped",
			note: "From contracts to verification · all green",
		},
		{
			value: "10",
			label: "Languages",
			note: "en · hi full · 8 Indic locales architected",
		},
		{
			value: "5",
			label: "Compliance regimes",
			note: "DPDP · GDPR · AI Act · CCPA · UK GDPR",
		},
	];

	return (
		<div
			style={{
				width: "100%",
				display: "flex",
				flexDirection: "column",
				gap: 24,
			}}
		>
			<div
				className="pitch-reveal"
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "baseline",
					flexWrap: "wrap",
					gap: 16,
				}}
			>
				<div>
					<div className="pitch-eyebrow">Numbers we publish. Every build.</div>
					<h2
						className="pitch-display"
						style={{ fontSize: "clamp(2.2rem, 4vw, 3.2rem)", marginTop: 12 }}
					>
						Receipts, not promises.
					</h2>
				</div>
				<div
					className="pitch-pearl-faint pitch-mono"
					style={{ fontSize: 11, letterSpacing: "0.18em" }}
				>
					docs/verification/REPORT.md · 2026-04-30
				</div>
			</div>

			<div className="pitch-reveal pitch-numbers-grid">
				{cells.map((c) => (
					<div key={c.label} className="pitch-number-cell">
						<div className={`pitch-number-value${c.small ? " pitch-number-value--small" : ""}`}>
							{c.value}
						</div>
						<div className="pitch-number-label">{c.label}</div>
						<div className="pitch-number-note">{c.note}</div>
					</div>
				))}
			</div>

			<div className="pitch-reveal" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
				<span className="pitch-tag pitch-tag--emerald">102/102 agent-eval</span>
				<span className="pitch-tag pitch-tag--emerald">37/37 fast-check property</span>
				<span className="pitch-tag pitch-tag--emerald">26-27/27 chaos</span>
				<span className="pitch-tag pitch-tag--emerald">19/21 Playwright Chromium</span>
				<span className="pitch-tag">22 Playwright · Chromium + Firefox + WebKit + axe</span>
				<span className="pitch-tag">~53,500 LOC TypeScript</span>
			</div>
		</div>
	);
}

/* ───────────────────────── 12 · RESEARCH PEDIGREE ───────────────────────── */

function ResearchSlide() {
	const docs: { name: string; anchors: string }[] = [
		{
			name: "agentic.md",
			anchors: "LangGraph + verifier · τ-bench / BFCL bar",
		},
		{
			name: "automotive.md",
			anchors: "Telematics · OBD-II · J1939 · ISO 2575",
		},
		{
			name: "autonomy.md",
			anchors: "Tier-A AVP · UNECE R157 · honest refusal",
		},
		{
			name: "dispatch.md",
			anchors: "Wellbeing-dominant objective · ranker weight 2.5×",
		},
		{
			name: "frontend.md",
			anchors: "WCAG 2.2 AAA · Indic NLP · slow-phone first",
		},
		{
			name: "knowledge-base.md",
			anchors: "AlloyDB + pgvector · GraphRAG · BGE-M3",
		},
		{
			name: "prognostics.md",
			anchors: "ISO 13374 PHM · Severson 2019 · pinball-loss quantile RUL",
		},
		{ name: "security.md", anchors: "DPDP 2025 · ML-KEM-768 · ML-DSA-65" },
		{
			name: "wellbeing.md",
			anchors: "10-axis composite · safety as gate, not term",
		},
	];

	const concepts = [
		"Tiered autonomous service orchestration with signed capability tokens",
		"Tier-aware autonomy capability resolution across heterogeneous OEM levels",
		"Safety-first dispatch objective with wellbeing dominance",
		"Composite customer wellbeing score with safety as gate, not term",
		"Dual-cross-check safety red-flag enforcement, fail-closed on disagreement",
		"Tiered prognostic health state machine with sensor-failure arbitration",
		"Graceful-degradation driver-takeover ladder under SOTIF (R157-aligned)",
		"Autonomous auto-pay within a user-set cap, cryptographically bound",
		"Sensor provenance stamping with simulator-real isolation",
		"Exact-production-logic simulation with single-toggle promotion",
		"Per-purpose DPDP-native consent with evidence hash",
		"Exhaustive intake schema (VIN + RC + ISO 2575 + SAE J1979 + DPDP consent)",
	];

	return (
		<div
			style={{
				width: "100%",
				display: "grid",
				gridTemplateColumns: "minmax(0, 0.85fr) minmax(0, 1.15fr)",
				gap: 56,
			}}
		>
			<div className="pitch-reveal">
				<div className="pitch-eyebrow">Research pedigree as architecture, not afterthought.</div>
				<h2
					className="pitch-display"
					style={{
						fontSize: "clamp(2rem, 3.8vw, 3rem)",
						marginTop: 12,
						marginBottom: 28,
					}}
				>
					Nine cited research docs. Every claim traceable.
				</h2>
				<div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
					{docs.map((d) => (
						<div
							key={d.name}
							style={{
								display: "grid",
								gridTemplateColumns: "minmax(180px, auto) 1fr",
								gap: 18,
								padding: "10px 0",
								borderBottom: "1px solid rgba(255,255,255,0.06)",
							}}
						>
							<div
								className="pitch-mono"
								style={{
									color: "var(--color-copper)",
									fontSize: 13,
									fontWeight: 500,
								}}
							>
								{d.name}
							</div>
							<div className="pitch-pearl-soft" style={{ fontSize: 13 }}>
								{d.anchors}
							</div>
						</div>
					))}
				</div>
				<div
					className="pitch-pearl-faint"
					style={{ fontSize: 12, marginTop: 18, fontStyle: "italic" }}
				>
					Plus the 2026-04-15 addendum capturing April 2026 deltas. A copycat must redo the citation
					work and the build.
				</div>
			</div>

			<div className="pitch-reveal" style={{ display: "flex", flexDirection: "column" }}>
				<div className="pitch-eyebrow" style={{ marginBottom: 14 }}>
					12 concepts · prior art · 2026-04-15
				</div>
				<div
					className="pitch-card pitch-card-hairline"
					style={{
						padding: 24,
						display: "flex",
						flexDirection: "column",
						gap: 12,
					}}
				>
					<ol
						style={{
							counterReset: "concept",
							listStyle: "none",
							padding: 0,
							margin: 0,
							display: "flex",
							flexDirection: "column",
							gap: 8,
						}}
					>
						{concepts.map((c) => (
							<li
								key={c}
								style={{
									counterIncrement: "concept",
									display: "grid",
									gridTemplateColumns: "32px 1fr",
									gap: 10,
									fontSize: 13,
									lineHeight: 1.45,
								}}
							>
								<span
									className="pitch-mono"
									style={{
										color: "var(--color-copper)",
										fontSize: 11,
										paddingTop: 2,
									}}
								>
									{String(concepts.indexOf(c) + 1).padStart(2, "0")}
								</span>
								<span className="pitch-pearl-soft">{c}</span>
							</li>
						))}
					</ol>
				</div>
				<div
					className="pitch-pearl-faint"
					style={{
						fontSize: 11,
						marginTop: 14,
						fontFamily: "var(--font-mono)",
						letterSpacing: "0.16em",
					}}
				>
					35 USC §102 · EPC Art. 54 · Indian Patents Act §13. A copycat cannot patent around them.
				</div>
			</div>
		</div>
	);
}

/* ───────────────────────── 13 · COMPLIANCE MOAT ───────────────────────── */

function ComplianceSlide() {
	const regimes: { name: string; jurisdiction: string; detail: string }[] = [
		{
			name: "DPDP 2023 + Rules 2025",
			jurisdiction: "India",
			detail:
				"Per-purpose consent · evidence hash over the actual notice shown · 72 h breach runbook · India data stays in India.",
		},
		{
			name: "GDPR + EU AI Act Art. 27",
			jurisdiction: "European Union",
			detail:
				"Lawful basis · Article-15 access · DPIA + FRIA scoped · Annex VI documentation · Article 27 fundamental rights.",
		},
		{
			name: "CCPA + CPRA",
			jurisdiction: "California",
			detail:
				"Right to know · right to delete · sensitive PI category map · sale/share opt-out · regional residency.",
		},
		{
			name: "UK GDPR + DPA 2018",
			jurisdiction: "United Kingdom",
			detail:
				"ICO-aligned record-of-processing · Schedule-1 conditions · age-appropriate design code.",
		},
	];

	const standards = [
		"ISO 26262",
		"ISO 21448 SOTIF",
		"ISO 13374 PHM",
		"ISO/SAE 21434",
		"FIPS 203 ML-KEM",
		"FIPS 204 ML-DSA",
		"FIPS 205 SLH-DSA",
		"WCAG 2.2 AAA",
		"UNECE R155",
		"UNECE R156",
		"UNECE R157",
		"OWASP GenAI Top 10 2025",
		"NIST AI RMF 1.0",
	];

	return (
		<div
			style={{
				width: "100%",
				display: "flex",
				flexDirection: "column",
				gap: 28,
			}}
		>
			<div className="pitch-reveal">
				<div className="pitch-eyebrow">Compliance from line one. Not retrofitted.</div>
				<h2
					className="pitch-display"
					style={{ fontSize: "clamp(2rem, 3.8vw, 3rem)", marginTop: 12 }}
				>
					The moat regulators love.
				</h2>
			</div>

			<div className="pitch-reveal pitch-compliance-grid">
				{regimes.map((r) => (
					<div key={r.name} className="pitch-regime-block">
						<div className="pitch-eyebrow pitch-eyebrow--muted" style={{ marginBottom: 6 }}>
							{r.jurisdiction}
						</div>
						<div className="pitch-regime-name">{r.name}</div>
						<div className="pitch-regime-detail">{r.detail}</div>
					</div>
				))}
			</div>

			<div className="pitch-reveal">
				<div className="pitch-eyebrow pitch-eyebrow--muted" style={{ marginBottom: 12 }}>
					Standards trail
				</div>
				<div className="pitch-standards">
					{standards.map((s) => (
						<span key={s} className="pitch-tag pitch-tag--copper">
							{s}
						</span>
					))}
				</div>
			</div>

			<div
				className="pitch-reveal pitch-pearl-faint"
				style={{ fontSize: 12, fontStyle: "italic", maxWidth: "70ch" }}
			>
				Compliance pack lives at docs/compliance/ · 10 artefacts · DPIA · FRIA · 18-row AI risk
				register · CCPA-CPRA overlay · jurisdiction matrix · retention schedule · breach runbook ·
				consent notices index.
			</div>
		</div>
	);
}

/* ───────────────────────── 14 · 12 PHASES SHIPPED ───────────────────────── */

function PhasesSlide() {
	const phases: { id: string; name: string; detail: string }[] = [
		{
			id: "P0",
			name: "Contracts + scaffold",
			detail:
				"Safety / wellbeing / autonomy / PHM logic · NHTSA + Routes adapters · Terraform baseline · CI.",
		},
		{
			id: "P1",
			name: "Booking loop in demo mode",
			detail:
				"LangGraph · concierge · intake · diagnosis · dispatch · status · payments-sim · banners.",
		},
		{
			id: "P2",
			name: "Sensor + PHM + autonomy",
			detail:
				"Smartcar · OBD-II BLE · EKF / UKF · 7 RUL models · R157 takeover · CommandGrant signing · AVP.",
		},
		{
			id: "P3",
			name: "Knowledge base + retrieval",
			detail: "AlloyDB + pgvector · GraphRAG · BGE-M3 · DTC corpus · ISO 2575 · Indic NLP.",
		},
		{
			id: "P4",
			name: "Dual-region IN + US",
			detail: "Cloud Run × 2 · Firestore residency · Cloud Armor · DNSSEC · region router.",
		},
		{
			id: "P5",
			name: "Consent + compliance",
			detail:
				"DPDP consent manager · erasure cascade · breach reporter · DPIA + FRIA · risk register · jurisdictions.",
		},
		{
			id: "P6",
			name: "Security hardening",
			detail:
				"PQ KEM · ML-DSA-65 · WebAuthn · Cloud Armor · VPC-SC · Binary Auth · secret rotation.",
		},
		{
			id: "P7",
			name: "Observability",
			detail: "OTel · structured JSON logs · metrics · SIEM SSE feed · SLO burn-rate · runbooks.",
		},
		{
			id: "P8",
			name: "Realtime + UX polish",
			detail:
				"24 shadcn-grade primitives · voice / photo / audio intake · offline-first SW · autonomy dashboard.",
		},
		{
			id: "P9",
			name: "Mobile (Expo)",
			detail: "Native passkey · grant signing · BLE OBD · push.",
		},
		{
			id: "P10",
			name: "Admin console",
			detail: "Operator queue · capacity heat-map · pricing · SLA · audit Merkle viewer.",
		},
		{
			id: "P11",
			name: "Quality + verification",
			detail: "Property · chaos · agent-eval · Playwright · load · Lighthouse CI.",
		},
	];

	return (
		<div
			style={{
				width: "100%",
				display: "flex",
				flexDirection: "column",
				gap: 24,
			}}
		>
			<div
				className="pitch-reveal"
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "baseline",
					flexWrap: "wrap",
					gap: 16,
				}}
			>
				<div>
					<div className="pitch-eyebrow">P0 – P11 ladder · 12 phases shipped.</div>
					<h2
						className="pitch-display"
						style={{ fontSize: "clamp(2rem, 3.8vw, 3rem)", marginTop: 12 }}
					>
						Built. Verified. Witnessed.
					</h2>
				</div>
				<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
					<span className="pitch-tag pitch-tag--emerald">P0 – P11 shipped</span>
					<span className="pitch-tag">P12 pilot · ≤ 100 bookings · pending live cut</span>
				</div>
			</div>

			<div className="pitch-reveal pitch-ladder">
				{phases.map((p) => (
					<div key={p.id} className="pitch-ladder-row">
						<div className="pitch-ladder-id">{p.id}</div>
						<div className="pitch-ladder-name">{p.name}</div>
						<div className="pitch-ladder-detail">{p.detail}</div>
						<div className="pitch-ladder-status">SHIPPED</div>
					</div>
				))}
			</div>
		</div>
	);
}

/* ───────────────────────── 15 · BUSINESS MODEL ───────────────────────── */

function BusinessSlide() {
	return (
		<div
			style={{
				width: "100%",
				display: "grid",
				gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
				gap: 56,
			}}
		>
			<div
				className="pitch-reveal"
				style={{
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
				}}
			>
				<div className="pitch-eyebrow">How it makes money. Honest framing.</div>
				<h2
					className="pitch-display"
					style={{
						fontSize: "clamp(2.2rem, 4.4vw, 3.6rem)",
						marginTop: 12,
						marginBottom: 24,
					}}
				>
					B2B2C OEM partnerships, with a <em>research-pedigreed</em> reference architecture as the
					on-ramp.
				</h2>
				<p className="pitch-pearl-soft" style={{ fontSize: 15, lineHeight: 1.7, maxWidth: "44ch" }}>
					Apache 2.0 + NOTICE lets adopters white-label and ship closed-source — no royalty. The
					revenue thesis is paid integration, safety-case + DPIA / FRIA support, OEM-specific
					telematics + PHM model plug-ins, and regional compliance engagement. India-first OEM pilot
					is the explicit Phase-12 step.
				</p>
				<div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 24 }}>
					<span className="pitch-tag pitch-tag--copper">Mercedes</span>
					<span className="pitch-tag pitch-tag--copper">Tata</span>
					<span className="pitch-tag pitch-tag--copper">Mahindra</span>
					<span className="pitch-tag pitch-tag--copper">Hyundai · Kia</span>
					<span className="pitch-tag">+ adapter shells in roadmap</span>
				</div>
			</div>

			<div className="pitch-reveal" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
				<div className="pitch-eyebrow" style={{ marginBottom: 6 }}>
					Channels invited in NOTICE
				</div>
				{[
					{
						title: "OEM pilot programmes",
						detail: "Closed pilot ≤ 100 bookings · India-first · Phase 12 gate.",
					},
					{
						title: "Safety + compliance support",
						detail: "DPIA · FRIA · ISO 26262 / 21448 · UNECE R155-R157 dossier.",
					},
					{
						title: "Custom sensor-fusion / PHM plug-ins",
						detail: "OEM-specific RUL models · provenance-aware ingest · sensor calibration.",
					},
					{
						title: "Regional compliance engagement",
						detail: "DPDP · GDPR · CCPA · UK GDPR · jurisdictional residency.",
					},
					{
						title: "Research collaboration",
						detail: "Academic partners · prior-art reference · standards bodies.",
					},
				].map((c) => (
					<div key={c.title} className="pitch-card pitch-card-hairline" style={{ padding: 16 }}>
						<div className="pitch-numbered-title" style={{ fontSize: 18, marginBottom: 6 }}>
							{c.title}
						</div>
						<div className="pitch-numbered-detail">{c.detail}</div>
					</div>
				))}
				<div
					className="pitch-pearl-faint"
					style={{
						fontSize: 11,
						marginTop: 6,
						fontFamily: "var(--font-mono)",
						letterSpacing: "0.16em",
						textTransform: "uppercase",
					}}
				>
					Inferred from NOTICE wording + Phase 12 + OEM adapter shells. No separate BUSINESS.md.
				</div>
			</div>
		</div>
	);
}

/* ───────────────────────── 16 · CLOSING ───────────────────────── */

function ClosingSlide() {
	return (
		<div className="pitch-closing">
			<div className="pitch-reveal">
				<div className="pitch-eyebrow" style={{ marginBottom: 18 }}>
					Reprise.
				</div>
				<h2 className="pitch-display pitch-closing-mark">
					Your vehicle.{" "}
					<em
						style={{
							fontStyle: "italic",
							color: "var(--color-copper)",
							fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1',
						}}
					>
						Served.
					</em>
				</h2>
			</div>

			<div
				className="pitch-reveal"
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 1fr 1fr",
					gap: 32,
					alignItems: "end",
				}}
			>
				<div>
					<div className="pitch-eyebrow pitch-eyebrow--muted" style={{ marginBottom: 8 }}>
						Author
					</div>
					<div className="pitch-display" style={{ fontSize: 22, marginBottom: 4 }}>
						Divya Mohan
					</div>
					<div className="pitch-pearl-soft" style={{ fontSize: 13 }}>
						dmj.one · contact@dmj.one
					</div>
				</div>
				<div>
					<div className="pitch-eyebrow pitch-eyebrow--muted" style={{ marginBottom: 8 }}>
						License
					</div>
					<div className="pitch-display" style={{ fontSize: 22, marginBottom: 4 }}>
						Apache 2.0 + NOTICE
					</div>
					<div className="pitch-pearl-soft" style={{ fontSize: 13 }}>
						White-label friendly · no royalty.
					</div>
				</div>
				<div>
					<div className="pitch-eyebrow pitch-eyebrow--muted" style={{ marginBottom: 8 }}>
						Prior art
					</div>
					<div className="pitch-display" style={{ fontSize: 22, marginBottom: 4 }}>
						2026-04-15
					</div>
					<div className="pitch-pearl-soft" style={{ fontSize: 13 }}>
						12 inventive concepts · USPTO + EPC + IPA.
					</div>
				</div>
			</div>

			<div
				className="pitch-reveal"
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "baseline",
					flexWrap: "wrap",
					gap: 24,
					paddingTop: 28,
					borderTop: "1px solid rgba(255,255,255,0.08)",
				}}
			>
				<p
					className="pitch-quote"
					style={{ fontSize: "clamp(1.2rem, 2vw, 1.6rem)", maxWidth: "44ch" }}
				>
					PhD-grade work deserves a name on it. Users deserve to know who to thank — or challenge.
				</p>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 10,
						alignItems: "flex-end",
					}}
				>
					<a
						className="pitch-tag pitch-tag--copper"
						href="/book"
						style={{ padding: "10px 20px", fontSize: 12 }}
						data-no-advance="true"
					>
						See the live demo · /book
					</a>
					<a
						className="pitch-tag"
						href="/autonomy/demo"
						style={{ padding: "10px 20px", fontSize: 12 }}
						data-no-advance="true"
					>
						Open the live dashboard · /autonomy/demo
					</a>
					<span
						className="pitch-pearl-faint"
						style={{ fontSize: 11, marginTop: 4, fontStyle: "italic" }}
					>
						#AatmanirbharBharat · @India2047
					</span>
				</div>
			</div>
		</div>
	);
}

/* ───────────────────────── deck ───────────────────────── */

export const SLIDES: Slide[] = [
	{
		id: "cover",
		title: "VSBS",
		kicker: "Capstone · May 2026",
		Component: CoverSlide,
	},
	{
		id: "hook",
		title: "The hook",
		kicker: "What VSBS is, in one breath",
		Component: HookSlide,
	},
	{
		id: "problem",
		title: "The problem",
		kicker: "Why nobody has solved this yet",
		Component: ProblemSlide,
	},
	{
		id: "why-now",
		title: "Why now",
		kicker: "April 2026 · the stack just aligned",
		Component: WhyNowSlide,
	},
	{
		id: "solution",
		title: "The solution",
		kicker: "Safe by construction, not by review",
		Component: SolutionSlide,
	},
	{
		id: "demo",
		title: "The 90-second demo",
		kicker: "C3 override · live, on stage",
		Component: DemoSlide,
	},
	{
		id: "architecture",
		title: "Architecture",
		kicker: "One diagram · top to bottom",
		Component: ArchitectureSlide,
	},
	{
		id: "agent-loop",
		title: "The agent loop",
		kicker: "Supervisor · verifier · 10 tools",
		Component: AgentLoopSlide,
	},
	{
		id: "safety",
		title: "Safety + autonomy invariants",
		kicker: "4 invariants the system cannot violate",
		Component: SafetySlide,
	},
	{
		id: "predictive-rul",
		title: "Predictive RUL",
		kicker: "Quantile MLP · 80.04 % calibrated coverage",
		Component: PredictiveRulSlide,
	},
	{
		id: "sensors",
		title: "L5 sensor stream",
		kicker: "17 sections · 10 Hz · per booking",
		Component: SensorSlide,
	},
	{
		id: "numbers",
		title: "Numbers",
		kicker: "Receipts, not promises",
		Component: NumbersSlide,
	},
	{
		id: "research",
		title: "Research pedigree",
		kicker: "9 cited docs · 12 inventive concepts",
		Component: ResearchSlide,
	},
	{
		id: "compliance",
		title: "Compliance moat",
		kicker: "From line one · not retrofitted",
		Component: ComplianceSlide,
	},
	{
		id: "phases",
		title: "12 phases shipped",
		kicker: "Built · verified · witnessed",
		Component: PhasesSlide,
	},
	{
		id: "business",
		title: "Business model",
		kicker: "B2B2C OEM partnerships",
		Component: BusinessSlide,
	},
	{
		id: "closing",
		title: "Closing",
		kicker: "Your vehicle. Served.",
		Component: ClosingSlide,
	},
];

export type { ReactNode };
