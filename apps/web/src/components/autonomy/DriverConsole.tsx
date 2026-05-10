"use client";

// Centre console — shows the action the vehicle is performing right now,
// the next constraint (red light / slow zone) and route progress.

import { GlassPanel } from "../luxe";
import { cn } from "../ui/cn";
import { StatusPill } from "./luxe/StatusPill";
import type { TelemetryFrame } from "./useTelemetryStream";

interface DriverConsoleProps {
	frame: TelemetryFrame & {
		currentAction?: string;
		currentActionDetail?: string;
		nextConstraint?: { label: string; etaS: number; distanceM: number } | null;
		distanceTraveledKm?: number;
		routeTotalKm?: number;
		routeProgress?: number;
		phaseName?: string;
	};
	className?: string;
}

const ACTION_TONE: Record<string, "live" | "watch" | "halt" | "ok" | "neutral"> = {
	BRAKING: "halt",
	"MRM ACTIVE": "halt",
	ACCELERATING: "live",
	CRUISING: "ok",
	DECELERATING: "watch",
	STOPPED: "watch",
	PARKED: "ok",
	"SELF-TEST": "neutral",
	"ODD ADMISSION": "neutral",
	"GRANT MINTING": "neutral",
};

export function DriverConsole({ frame, className }: DriverConsoleProps): React.JSX.Element {
	const action = frame.currentAction ?? "INITIALISING";
	const detail = frame.currentActionDetail ?? "";
	const tone: "live" | "watch" | "halt" | "ok" | "neutral" = ACTION_TONE[action] ?? "live";
	const speed = frame.speedKph;
	const next = frame.nextConstraint;
	const traveled = frame.distanceTraveledKm ?? 0;
	const total = frame.routeTotalKm ?? 12.3;
	const phase = frame.phaseName ?? "";

	return (
		<GlassPanel
			variant="elevated"
			className={cn("flex flex-col gap-5 p-7", className)}
			aria-label="Driver console"
		>
			<div className="flex items-start justify-between gap-6">
				<div>
					<div className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-muted">
						Vehicle action
					</div>
					<div className="mt-2 font-display text-[length:var(--text-h1)] leading-none text-pearl">
						{action}
					</div>
					<div className="mt-2 text-[length:var(--text-body)] text-pearl-soft">{detail}</div>
				</div>
				<StatusPill tone={tone} size="md">
					{action}
				</StatusPill>
			</div>

			<div className="grid grid-cols-3 gap-6">
				<div>
					<div className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-muted">
						Speed
					</div>
					<div className="font-display text-[length:var(--text-h2)] tabular-nums text-pearl">
						{speed.toFixed(1)}{" "}
						<span className="text-[length:var(--text-body)] text-pearl-soft">kph</span>
					</div>
				</div>
				<div>
					<div className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-muted">
						Next constraint
					</div>
					{next ? (
						<div>
							<div className="font-display text-[length:var(--text-h3)] text-pearl">
								{next.label}
							</div>
							<div className="mt-1 luxe-mono text-[length:var(--text-micro)] text-pearl-soft">
								in {next.distanceM.toFixed(0)} m / {next.etaS.toFixed(0)} s
							</div>
						</div>
					) : (
						<div className="font-display text-[length:var(--text-h3)] text-pearl-soft">
							— clear —
						</div>
					)}
				</div>
				<div>
					<div className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-muted">
						Route progress
					</div>
					<div className="font-display text-[length:var(--text-h2)] tabular-nums text-pearl">
						{traveled.toFixed(2)}
						<span className="text-[length:var(--text-body)] text-pearl-soft">
							{" "}
							/ {total.toFixed(1)} km
						</span>
					</div>
					<div className="mt-1 luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-muted">
						phase: {phase || "—"}
					</div>
				</div>
			</div>
		</GlassPanel>
	);
}
