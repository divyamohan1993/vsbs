"use client";

import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { SLIDES } from "./Slides";

const SWIPE_THRESHOLD_PX = 60;

export function PitchDeck() {
	const [index, setIndex] = useState(0);
	const [reducedMotion, setReducedMotion] = useState(false);
	const total = SLIDES.length;
	const trackRef = useRef<HTMLDivElement | null>(null);
	const swipeOriginRef = useRef<{ x: number; y: number; id: number } | null>(null);

	// Detect prefers-reduced-motion. Disables horizontal-slide motion only;
	// discrete content reveal still happens for keyboard users.
	useEffect(() => {
		if (typeof window === "undefined") return;
		const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReducedMotion(mql.matches);
		const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);

	const goTo = useCallback(
		(next: number) => {
			setIndex((cur) => {
				const clamped = Math.max(0, Math.min(total - 1, next));
				if (clamped !== cur && typeof document !== "undefined") {
					const live = document.getElementById("pitch-live-region");
					if (live)
						live.textContent = `Slide ${clamped + 1} of ${total}: ${SLIDES[clamped]?.title ?? ""}`;
				}
				return clamped;
			});
		},
		[total],
	);

	const prev = useCallback(() => goTo(index - 1), [goTo, index]);
	const next = useCallback(() => goTo(index + 1), [goTo, index]);

	// Keyboard navigation. Space + Shift+Space, arrows, Home/End, digit jumps,
	// F for fullscreen.
	useEffect(() => {
		if (typeof window === "undefined") return;
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
			) {
				return;
			}
			switch (e.key) {
				case "ArrowRight":
				case "PageDown":
					e.preventDefault();
					next();
					break;
				case " ":
					e.preventDefault();
					if (e.shiftKey) prev();
					else next();
					break;
				case "ArrowLeft":
				case "PageUp":
					e.preventDefault();
					prev();
					break;
				case "Home":
					e.preventDefault();
					goTo(0);
					break;
				case "End":
					e.preventDefault();
					goTo(total - 1);
					break;
				case "f":
				case "F":
					if (!e.metaKey && !e.ctrlKey) {
						e.preventDefault();
						void toggleFullscreen();
					}
					break;
				default:
					if (/^[0-9]$/.test(e.key)) {
						e.preventDefault();
						const digit = Number(e.key);
						const target = digit === 0 ? 9 : digit - 1;
						goTo(target);
					}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [goTo, next, prev, total]);

	const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
		if (e.pointerType === "mouse" && e.button !== 0) return;
		swipeOriginRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
	}, []);

	const onPointerUp = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			const origin = swipeOriginRef.current;
			if (!origin || origin.id !== e.pointerId) return;
			const dx = e.clientX - origin.x;
			const dy = e.clientY - origin.y;
			swipeOriginRef.current = null;
			if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
				if (dx < 0) next();
				else prev();
				return;
			}
			const target = e.target as HTMLElement;
			if (target.closest("button, a, [data-no-advance]")) return;
			if (e.pointerType !== "mouse") return;
			const viewport = e.currentTarget.getBoundingClientRect();
			const ratio = (e.clientX - viewport.left) / viewport.width;
			if (ratio < 0.3) prev();
			else if (ratio > 0.7) next();
		},
		[next, prev],
	);

	const progressPct = useMemo(() => {
		if (total <= 1) return 100;
		return Math.round(((index + 1) / total) * 1000) / 10;
	}, [index, total]);

	const current = SLIDES[index];
	const trackStyle = { transform: `translateX(-${index * 100}%)` };

	// Auto-hide controls + topbar after 3 s of no input. Pointer move,
	// touch, and key events all reset the timer; the section gets
	// data-idle="true" which CSS fades the chrome out (still keyboard
	// navigable, just visually quiet).
	const [idle, setIdle] = useState(false);
	useEffect(() => {
		if (typeof window === "undefined") return;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const wake = () => {
			setIdle(false);
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => setIdle(true), 3000);
		};
		wake();
		const events: (keyof WindowEventMap)[] = [
			"mousemove",
			"pointerdown",
			"touchstart",
			"keydown",
			"wheel",
		];
		for (const ev of events) window.addEventListener(ev, wake, { passive: true });
		return () => {
			if (timer) clearTimeout(timer);
			for (const ev of events) window.removeEventListener(ev, wake);
		};
	}, []);

	return (
		<section
			className="pitch-stage"
			aria-roledescription="slide deck"
			aria-label="VSBS capstone pitch"
			data-idle={idle ? "true" : "false"}
		>
			<span id="pitch-live-region" className="sr-only" aria-live="polite" aria-atomic="true" />

			<header className="pitch-topbar">
				<div className="pitch-counter">
					<span className="pitch-counter-num">{String(index + 1).padStart(2, "0")}</span>
					<span className="pitch-counter-divider">/</span>
					<span className="pitch-counter-total">{String(total).padStart(2, "0")}</span>
				</div>
				<div className="pitch-title-kicker">{current?.kicker ?? ""}</div>
				<div className="pitch-exit">
					<span className="pitch-live-dot" aria-hidden="true" />
					<span style={{ fontSize: 10 }}>VSBS · CAPSTONE · 2026</span>
					<a className="pitch-exit-link" href="/" aria-label="Exit deck and return home">
						EXIT
					</a>
				</div>
			</header>

			<div
				ref={trackRef}
				className="pitch-track-viewport"
				onPointerDown={onPointerDown}
				onPointerUp={onPointerUp}
			>
				<div
					className="pitch-track"
					data-reduced={reducedMotion ? "true" : "false"}
					style={trackStyle}
				>
					{SLIDES.map((slide, i) => (
						<section
							key={slide.id}
							className="pitch-slide"
							data-active={i === index ? "true" : "false"}
							aria-roledescription="slide"
							aria-label={`${i + 1} of ${total}: ${slide.title}`}
							tabIndex={i === index ? 0 : -1}
							aria-hidden={i === index ? "false" : "true"}
						>
							<slide.Component />
						</section>
					))}
				</div>
			</div>

			<div className="pitch-controls">
				<div className="pitch-hints" aria-hidden="true">
					<span className="pitch-hint-key">
						<span className="pitch-key-cap">←</span>
						<span className="pitch-key-cap">→</span>
						navigate
					</span>
					<span className="pitch-hint-key">
						<span className="pitch-key-cap">space</span>
						advance
					</span>
					<span className="pitch-hint-key">
						<span className="pitch-key-cap">F</span>
						fullscreen
					</span>
				</div>
				<div className="pitch-dots" role="tablist" aria-label="Jump to slide">
					{SLIDES.map((slide, i) => (
						<button
							key={slide.id}
							type="button"
							role="tab"
							aria-selected={i === index}
							aria-label={`Slide ${i + 1}: ${slide.title}`}
							data-active={i === index ? "true" : "false"}
							className="pitch-dot"
							onClick={() => goTo(i)}
							data-no-advance="true"
						/>
					))}
				</div>
				<div className="pitch-nav-cluster" aria-label="Slide navigation">
					<button
						type="button"
						className="pitch-nav-btn"
						onClick={prev}
						disabled={index === 0}
						aria-label="Previous slide"
						data-no-advance="true"
					>
						<ChevronLeft />
					</button>
					<button
						type="button"
						className="pitch-nav-btn pitch-nav-primary"
						onClick={next}
						disabled={index === total - 1}
						aria-label="Next slide"
						data-no-advance="true"
					>
						<ChevronRight />
					</button>
				</div>
			</div>

			<div className="pitch-progress-rail" aria-hidden="true">
				<div className="pitch-progress-fill" style={{ width: `${progressPct}%` }} />
			</div>
		</section>
	);
}

async function toggleFullscreen() {
	if (typeof document === "undefined") return;
	if (document.fullscreenElement) {
		await document.exitFullscreen?.().catch(() => undefined);
		return;
	}
	await document.documentElement.requestFullscreen?.().catch(() => undefined);
}

function ChevronLeft() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path
				d="M15 18l-6-6 6-6"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function ChevronRight() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path
				d="M9 6l6 6-6 6"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
