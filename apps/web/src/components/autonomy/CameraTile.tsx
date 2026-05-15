"use client";

// CameraTile — cinematic 16:9 quadrant view. The canvas painter remains a
// deterministic checker pattern so the page can be Lighthouse-audited without
// a live MJPEG feed; the surrounding chrome is rebuilt for the Mercedes
// hyperscreen brief: glass plate, copper LIVE capsule, mono quadrant label,
// timestamp ticker.

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../../lib/motion";
import { GlassPanel } from "../luxe";
import { cn } from "../ui/cn";
import { StatusPill } from "./luxe/StatusPill";

export type CameraQuadrant = "front" | "rear" | "left" | "right";

const TITLES: Record<CameraQuadrant, string> = {
	front: "Front camera",
	rear: "Rear camera",
	left: "Left camera",
	right: "Right camera",
};

const SHORT_LABEL: Record<CameraQuadrant, string> = {
	front: "FRONT",
	rear: "REAR",
	left: "LEFT",
	right: "RIGHT",
};

interface CameraTileProps {
	quadrant: CameraQuadrant;
	origin?: "real" | "sim";
	label?: string;
	className?: string;
	/** When set, the tile renders <img src="/cameras/<bookingId>/<quadrant>.jpg">
	 *  layered above the deterministic checker, with a 5-second cache-bust so
	 *  the browser refreshes whenever the bridge writes a new frame. */
	bookingId?: string | undefined;
}

export function CameraTile({
	quadrant,
	origin = "sim",
	label,
	className,
	bookingId,
}: CameraTileProps): React.JSX.Element {
	const reduced = useReducedMotion();
	const ref = useRef<HTMLCanvasElement | null>(null);
	const [tick, setTick] = useState(0);
	// Stamp starts blank so SSR HTML matches the first client paint. The real
	// wall-clock value is filled in after mount, then ticks.
	const [stamp, setStamp] = useState<string>("--:--:--");
	// 5-second bucket for image cache-busting. Starts at 0 so SSR HTML matches.
	const [bucket, setBucket] = useState<number>(0);
	const [imgOk, setImgOk] = useState<boolean>(false);
	// Camera images come from a bridge that may not exist for synthetic
	// scenarios. After the first 404 for this booking we stop polling — the
	// deterministic-checker canvas underneath stays as the visual fallback.
	const [imgUnavailable, setImgUnavailable] = useState<boolean>(false);
	useEffect(() => {
		// Reset the unavailable flag when the booking changes so a new bridge
		// can re-publish frames.
		setImgUnavailable(false);
		setImgOk(false);
	}, [bookingId]);
	useEffect(() => {
		if (imgUnavailable) return;
		setBucket(Math.floor(Date.now() / 1000));
		const id = setInterval(() => {
			setBucket(Math.floor(Date.now() / 1000));
		}, 1000);
		return () => clearInterval(id);
	}, [imgUnavailable]);

	useEffect(() => {
		setStamp(formatStamp(new Date()));
		if (reduced) return;
		let raf = 0;
		let last = performance.now();
		const loop = (now: number): void => {
			if (now - last >= 250) {
				last = now;
				setTick((t) => (t + 1) % 16);
				setStamp(formatStamp(new Date()));
			}
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [reduced]);

	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const w = canvas.width;
		const h = canvas.height;
		// Deep obsidian backdrop. createLinearGradient is unavailable on the jsdom
		// canvas stub used by unit tests, so we fall back to a flat fill there.
		if (typeof ctx.createLinearGradient === "function") {
			const grad = ctx.createLinearGradient(0, 0, 0, h);
			grad.addColorStop(0, "#0c0f14");
			grad.addColorStop(1, "#08090c");
			ctx.fillStyle = grad;
		} else {
			ctx.fillStyle = "#0a0c11";
		}
		ctx.fillRect(0, 0, w, h);
		const cells = 16;
		const cw = w / cells;
		const ch = h / cells;
		for (let y = 0; y < cells; y++) {
			for (let x = 0; x < cells; x++) {
				const phase = ((x + y + tick) % 4) / 4;
				ctx.fillStyle = `oklch(${22 + phase * 6}% 0.04 ${quadrantHue(quadrant)})`;
				ctx.fillRect(x * cw, y * ch, cw - 1, ch - 1);
			}
		}
		// Vignette. Same fallback story as the linear gradient above.
		if (typeof ctx.createRadialGradient === "function") {
			const vignette = ctx.createRadialGradient(w / 2, h / 2, w / 4, w / 2, h / 2, w / 1.2);
			vignette.addColorStop(0, "rgba(0,0,0,0)");
			vignette.addColorStop(1, "rgba(0,0,0,0.55)");
			ctx.fillStyle = vignette;
			ctx.fillRect(0, 0, w, h);
		}
		// Crosshair / framing lines.
		ctx.strokeStyle = "rgba(201,163,106,0.45)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(w * 0.5, h * 0.42);
		ctx.lineTo(w * 0.5, h * 0.58);
		ctx.moveTo(w * 0.42, h * 0.5);
		ctx.lineTo(w * 0.58, h * 0.5);
		ctx.stroke();
	}, [quadrant, tick]);

	const liveText = origin === "real" ? "LIVE" : "LIVE (sim)";

	return (
		<GlassPanel
			variant="muted"
			as="article"
			className={cn(
				"relative aspect-video !p-0 overflow-hidden rounded-[var(--radius-md)]",
				className,
			)}
			aria-label={label ?? TITLES[quadrant]}
		>
			<canvas
				ref={ref}
				width={640}
				height={360}
				role="presentation"
				aria-hidden="true"
				className="absolute inset-0 h-full w-full"
			/>
			{/*
			 * Demo placeholder: a stylised CARLA-Town10HD scene per quadrant so
			 * the camera tiles show what the bridge WOULD render. Stays visible
			 * until/unless the bridge publishes a real image overlay below.
			 */}
			<img
				src={`/cameras/placeholder/${quadrant}.svg`}
				alt=""
				aria-hidden="true"
				className="absolute inset-0 h-full w-full object-cover"
			/>
			{bookingId && bucket > 0 && !imgUnavailable ? (
				<img
					src={`/cameras/${encodeURIComponent(bookingId)}/${quadrant}.jpg?t=${bucket}`}
					alt={label ?? TITLES[quadrant]}
					className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
					style={{ opacity: imgOk ? 1 : 0 }}
					onLoad={() => setImgOk(true)}
					onError={() => {
						setImgOk(false);
						setImgUnavailable(true);
					}}
				/>
			) : null}
			<span
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 top-0 h-px"
				style={{
					background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent)",
				}}
			/>
			<div className="pointer-events-none absolute inset-3 flex flex-col justify-between">
				<div className="flex items-start justify-between gap-2">
					<StatusPill tone="live" size="sm">
						{liveText}
					</StatusPill>
					<span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-muted">
						{SHORT_LABEL[quadrant]}
					</span>
				</div>
				<div className="flex items-end justify-between gap-2">
					<span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-wide)] text-pearl-soft">
						{label ?? TITLES[quadrant]}
					</span>
					<span className="luxe-mono text-[length:var(--text-micro)] tabular-nums text-pearl-soft">
						{stamp}
					</span>
				</div>
			</div>
		</GlassPanel>
	);
}

function formatStamp(d: Date): string {
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	const ss = String(d.getSeconds()).padStart(2, "0");
	return `${hh}:${mm}:${ss}`;
}

function quadrantHue(q: CameraQuadrant): number {
	switch (q) {
		case "front":
			return 220;
		case "rear":
			return 25;
		case "left":
			return 155;
		case "right":
			return 280;
	}
}

interface CameraGridProps {
	origin?: "real" | "sim";
	className?: string;
	variant?: "grid" | "strip";
	bookingId?: string | undefined;
}

export function CameraGrid({
	origin = "sim",
	className,
	variant = "grid",
	bookingId,
}: CameraGridProps): React.JSX.Element {
	if (variant === "strip") {
		return (
			<div className={cn("grid grid-cols-2 gap-3 md:grid-cols-4", className)}>
				<CameraTile quadrant="front" origin={origin} bookingId={bookingId} />
				<CameraTile quadrant="rear" origin={origin} bookingId={bookingId} />
				<CameraTile quadrant="left" origin={origin} bookingId={bookingId} />
				<CameraTile quadrant="right" origin={origin} bookingId={bookingId} />
			</div>
		);
	}
	return (
		<div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}>
			<CameraTile quadrant="front" origin={origin} bookingId={bookingId} />
			<CameraTile quadrant="rear" origin={origin} bookingId={bookingId} />
			<CameraTile quadrant="left" origin={origin} bookingId={bookingId} />
			<CameraTile quadrant="right" origin={origin} bookingId={bookingId} />
		</div>
	);
}
