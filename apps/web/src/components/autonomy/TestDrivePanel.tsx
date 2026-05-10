"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type PerceptionEvent, usePerceptionEvents } from "./usePerceptionEvents";
import { useTelemetryStream } from "./useTelemetryStream";

interface Props {
	bookingId: string;
}

interface TestDriveBlock {
	phase?: string;
	faultName?: string;
	healthPct?: number;
	rulSeconds?: number;
	rulP10Seconds?: number;
	rulP50Seconds?: number;
	rulP90Seconds?: number;
	predictorSlopePctPerS?: number;
	predictorMaePct?: number;
	predictorObservations?: number;
	predictorErrorsScored?: number;
}

interface StatusResponse {
	data: {
		bookingId: string;
		phase: "running" | "queued" | "unknown";
		position?: number;
		activeBookingId?: string | null;
		startedAt?: string;
	};
}

const LOG_TAIL_CAP = 300;

// Lines we never want surfaced in any log view: per-tick httpx INFO POSTs
// from the bridge to /telemetry/ingest and /events/ingest. At 10 Hz they
// are pure background hum and drown out anything actionable. Keep one
// regex so both the live status panel and the debug drawer agree.
const HTTPX_NOISE = /httpx\s+INFO\s+HTTP Request:.*\/(telemetry|events)\/ingest/;

// --- shared SSE log tail hook --------------------------------------------

function useBridgeLog(bookingId: string, options?: { dropNoise?: boolean }) {
	const dropNoise = options?.dropNoise ?? true;
	const [logLines, setLogLines] = useState<string[]>([]);
	const [logConnected, setLogConnected] = useState(false);

	useEffect(() => {
		const ctrl = new AbortController();
		let cancelled = false;
		async function tail(): Promise<void> {
			try {
				const res = await fetch(
					`/api/proxy/scenarios/test-drive/${encodeURIComponent(bookingId)}/log/sse`,
					{ signal: ctrl.signal, headers: { accept: "text/event-stream" } },
				);
				if (!res.ok || !res.body) return;
				setLogConnected(true);
				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buf = "";
				while (!cancelled) {
					const { value, done } = await reader.read();
					if (done) break;
					buf += decoder.decode(value, { stream: true });
					let idx = buf.indexOf("\n\n");
					while (idx !== -1) {
						const block = buf.slice(0, idx);
						buf = buf.slice(idx + 2);
						const line = block
							.split(/\r?\n/)
							.filter((l) => l.startsWith("data:"))
							.map((l) => l.slice(5).trimStart())
							.join("\n");
						if (line.length > 0 && !(dropNoise && HTTPX_NOISE.test(line))) {
							setLogLines((prev) => {
								const next = [...prev, line];
								return next.length > LOG_TAIL_CAP ? next.slice(next.length - LOG_TAIL_CAP) : next;
							});
						}
						idx = buf.indexOf("\n\n");
					}
				}
			} catch {
				/* network errors: try once more after backoff */
			} finally {
				setLogConnected(false);
			}
		}
		void tail();
		return () => {
			cancelled = true;
			ctrl.abort();
		};
	}, [bookingId, dropNoise]);

	const clear = () => setLogLines([]);
	return { logLines, logConnected, clear };
}

// --- TestDrivePanel — header, predictor row, recording download ---------

export function TestDrivePanel({ bookingId }: Props): React.JSX.Element | null {
	const [phase, setPhase] = useState<"running" | "queued" | "unknown">("unknown");
	const [queuePosition, setQueuePosition] = useState<number | null>(null);
	const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
	const { events } = usePerceptionEvents(bookingId);
	const { frame } = useTelemetryStream(bookingId);
	// Track MAE history so we can render the learning curve.
	const [maeHistory, setMaeHistory] = useState<number[]>([]);
	// testDrive is a passthrough block on the telemetry frame — the schema
	// uses .passthrough() so the typed frame doesn't include it explicitly.
	const td = (frame as unknown as { testDrive?: TestDriveBlock }).testDrive ?? null;
	const lastMae = td?.predictorMaePct ?? null;
	const errorsScored = td?.predictorErrorsScored ?? 0;
	useEffect(() => {
		if (lastMae == null || errorsScored === 0) return;
		setMaeHistory((prev) => {
			const next = [...prev, lastMae];
			return next.length > 120 ? next.slice(next.length - 120) : next;
		});
	}, [lastMae, errorsScored]);

	// Poll status every 3 s. The server flips us from queued -> running once
	// the bridge for this bookingId actually spawns.
	useEffect(() => {
		let cancelled = false;
		async function poll(): Promise<void> {
			try {
				const res = await fetch(
					`/api/proxy/scenarios/test-drive/${encodeURIComponent(bookingId)}/status`,
				);
				if (!res.ok) return;
				const body = (await res.json()) as StatusResponse;
				if (cancelled) return;
				setPhase(body.data.phase);
				setQueuePosition(body.data.position ?? null);
				setActiveBookingId(body.data.activeBookingId ?? null);
			} catch {
				/* keep last known */
			}
		}
		void poll();
		const id = setInterval(poll, 3000);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [bookingId]);

	const recording = useMemo(() => {
		const evt = [...events]
			.reverse()
			.find(
				(e: PerceptionEvent) =>
					e.category === "scenario" &&
					(e.title === "Recording ready" || e.title.toLowerCase().includes("recording ready")),
			);
		if (!evt) return null;
		const data =
			evt.data && typeof evt.data === "object" ? (evt.data as Record<string, unknown>) : null;
		const url = data?.videoUrl;
		if (typeof url !== "string") return null;
		return {
			url,
			detail: evt.detail,
			frameCount: typeof data?.frameCount === "number" ? (data.frameCount as number) : null,
		};
	}, [events]);

	// Hide entirely if the bookingId is not a test drive at all.
	if (phase === "unknown" && !recording && !td) return null;

	return (
		<div className="space-y-4 rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[rgba(8,12,18,0.55)] p-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
						Test drive
					</p>
					<h3 className="text-[length:var(--text-lg)] text-pearl">
						{phase === "queued"
							? `Queued — position ${queuePosition ?? "?"}`
							: phase === "running"
								? "Running"
								: "Unknown"}
					</h3>
					{phase === "queued" && activeBookingId ? (
						<p className="mt-1 text-[length:var(--text-small)] text-pearl-muted">
							CARLA is busy with {activeBookingId.slice(0, 8)}…; we'll start as soon as it finishes.
						</p>
					) : null}
				</div>
				{recording ? (
					<a
						href={recording.url}
						download
						className="luxe-btn-primary inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-sm)] px-5 py-2 text-[length:var(--text-control)] font-medium tracking-[var(--tracking-wide)]"
					>
						↓ Download recording
						{recording.frameCount ? (
							<span className="luxe-mono text-[length:var(--text-micro)] text-pearl-soft">
								{recording.frameCount}f
							</span>
						) : null}
					</a>
				) : null}
			</div>

			{td ? <PredictorRow td={td} maeHistory={maeHistory} /> : null}
		</div>
	);
}

// --- TestDriveDebugLog — collapsible bridge-log drawer for the page foot

export function TestDriveDebugLog({ bookingId }: Props): React.JSX.Element | null {
	const [phase, setPhase] = useState<"running" | "queued" | "unknown">("unknown");
	const [open, setOpen] = useState(false);
	const { logLines, logConnected, clear } = useBridgeLog(bookingId, {
		dropNoise: true,
	});
	const logEndRef = useRef<HTMLDivElement | null>(null);

	// Status poll — reused so we can hide the drawer when this isn't a
	// test-drive booking at all.
	useEffect(() => {
		let cancelled = false;
		async function poll(): Promise<void> {
			try {
				const res = await fetch(
					`/api/proxy/scenarios/test-drive/${encodeURIComponent(bookingId)}/status`,
				);
				if (!res.ok) return;
				const body = (await res.json()) as StatusResponse;
				if (cancelled) return;
				setPhase(body.data.phase);
			} catch {
				/* keep last known */
			}
		}
		void poll();
		const id = setInterval(poll, 5000);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [bookingId]);

	useEffect(() => {
		if (open) logEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
	}, [logLines, open]);

	if (phase === "unknown" && logLines.length === 0) return null;

	return (
		<details
			open={open}
			onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
			className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[rgba(0,0,0,0.45)]"
		>
			<summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 text-pearl-soft hover:text-pearl">
				<span className="flex items-center gap-3">
					<span className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caps)]">
						Debug · CARLA bridge log
					</span>
					<span
						className={`luxe-mono text-[length:var(--text-micro)] ${logConnected ? "text-[color:var(--color-emerald,#6ee7b7)]" : "text-pearl-soft"}`}
					>
						{logConnected ? "● live" : "○ idle"}
					</span>
					<span className="luxe-mono text-[length:var(--text-micro)] text-pearl-soft">
						{logLines.length}/{LOG_TAIL_CAP} lines · ingest noise filtered
					</span>
				</span>
				<span className="flex items-center gap-3">
					{open && logLines.length > 0 ? (
						<button
							type="button"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								clear();
							}}
							className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft hover:text-pearl"
						>
							clear
						</button>
					) : null}
					<span aria-hidden="true" className="text-pearl-soft">
						{open ? "▾" : "▸"}
					</span>
				</span>
			</summary>
			{open ? (
				<div className="border-t border-[var(--color-hairline)] px-5 pb-4 pt-3">
					<div className="max-h-[260px] overflow-auto rounded-[var(--radius-sm)] bg-[rgba(0,0,0,0.55)] p-3 font-mono text-[length:var(--text-micro)] leading-[1.45] text-pearl-muted">
						{logLines.length === 0 ? (
							<p className="text-pearl-soft">Waiting for bridge to produce output…</p>
						) : (
							logLines.map((line, i) => (
								<div key={`${i}-${line.slice(0, 32)}`} className="whitespace-pre-wrap break-all">
									{line}
								</div>
							))
						)}
						<div ref={logEndRef} />
					</div>
				</div>
			) : null}
		</details>
	);
}

function PredictorRow({
	td,
	maeHistory,
}: {
	td: TestDriveBlock;
	maeHistory: number[];
}): React.JSX.Element {
	const phase = td.phase ?? "—";
	const fault = td.faultName ?? "—";
	const health = td.healthPct;
	const rul = td.rulSeconds;
	const slope = td.predictorSlopePctPerS;
	const mae = td.predictorMaePct;
	const obs = td.predictorObservations ?? 0;
	const scored = td.predictorErrorsScored ?? 0;

	// Spark-line for MAE: show the predictor learning. SVG path of the last
	// ~120 MAE samples normalised to the panel height.
	const sparkPath = useMemo(() => {
		if (maeHistory.length < 2) return "";
		const max = Math.max(0.5, ...maeHistory);
		const w = 240;
		const h = 36;
		const step = w / Math.max(1, maeHistory.length - 1);
		return maeHistory
			.map((v, i) => {
				const x = i * step;
				const y = h - (v / max) * h;
				return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(" ");
	}, [maeHistory]);

	return (
		<div className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[rgba(0,0,0,0.35)] p-4 sm:grid-cols-2 lg:grid-cols-4">
			<div>
				<p className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
					Phase / fault
				</p>
				<p className="text-[length:var(--text-control)] text-pearl">{phase}</p>
				<p className="text-[length:var(--text-small)] text-pearl-muted">{fault}</p>
			</div>
			<div>
				<p className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
					Health · predicted slope
				</p>
				<p className="text-[length:var(--text-control)] text-pearl">
					{health != null ? `${health.toFixed(1)}%` : "—"}
				</p>
				<p className="text-[length:var(--text-small)] text-pearl-muted">
					{slope != null ? `${slope.toFixed(2)}%/s` : "—"}
				</p>
			</div>
			<div>
				<p className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
					Predicted RUL
				</p>
				<p className="text-[length:var(--text-control)] text-pearl">
					{rul != null && Number.isFinite(rul) ? `${rul.toFixed(0)} s` : "∞"}
				</p>
				{td.rulP10Seconds != null && td.rulP90Seconds != null ? (
					<p className="luxe-mono text-[length:var(--text-micro)] text-pearl-soft">
						P10 {td.rulP10Seconds.toFixed(0)}s · P50 {(td.rulP50Seconds ?? rul ?? 0).toFixed(0)}s ·
						P90 {td.rulP90Seconds.toFixed(0)}s
					</p>
				) : null}
				<p className="text-[length:var(--text-small)] text-pearl-muted">{obs} samples</p>
			</div>
			<div>
				<p className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
					Forecast error · learning
				</p>
				<p className="text-[length:var(--text-control)] text-pearl">
					{mae != null && scored > 0 ? `MAE ${mae.toFixed(2)}%` : "—"}
				</p>
				<svg viewBox="0 0 240 36" className="mt-1 h-9 w-full" preserveAspectRatio="none">
					{sparkPath ? (
						<path
							d={sparkPath}
							stroke="currentColor"
							strokeWidth="1.5"
							fill="none"
							className="text-[var(--color-primary,#c8a560)]"
						/>
					) : (
						<line
							x1="0"
							y1="18"
							x2="240"
							y2="18"
							stroke="currentColor"
							strokeWidth="1"
							strokeDasharray="2,3"
							className="text-pearl-soft opacity-40"
						/>
					)}
				</svg>
				<p className="luxe-mono text-[length:var(--text-micro)] text-pearl-soft">
					{scored} forecasts scored
				</p>
			</div>
		</div>
	);
}
