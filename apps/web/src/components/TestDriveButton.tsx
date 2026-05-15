"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Best-effort geolocation: returns the browser-reported coordinates if the
// user grants permission within ~6 seconds, otherwise resolves null. The
// chaos driver uses these to pull live weather for the actual location.
async function tryGetLocation(): Promise<{ lat: number; lng: number } | null> {
	if (typeof navigator === "undefined" || !navigator.geolocation) return null;
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(null), 6000);
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				clearTimeout(timer);
				resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
			},
			() => {
				clearTimeout(timer);
				resolve(null);
			},
			{ enableHighAccuracy: false, timeout: 5000, maximumAge: 600_000 },
		);
	});
}

export function TestDriveButton(): React.JSX.Element {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const onClick = async (): Promise<void> => {
		setBusy(true);
		setError(null);
		try {
			const loc = await tryGetLocation();
			const body = loc ? { lat: loc.lat, lng: loc.lng } : {};
			const res = await fetch("/api/proxy/scenarios/test-drive/start", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			// 201 = spawned now; 202 = queued behind an active scenario. Both
			// include a bookingId + dashboardUrl, so we redirect either way.
			if (res.status !== 201 && res.status !== 202) {
				const txt = await res.text();
				throw new Error(`${res.status} ${txt.slice(0, 160)}`);
			}
			const json = (await res.json()) as {
				data: {
					bookingId: string;
					dashboardUrl: string;
					queued?: boolean;
					position?: number;
				};
			};
			router.push(json.data.dashboardUrl as Route);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-col items-start gap-2">
			<button
				type="button"
				onClick={onClick}
				disabled={busy}
				className="luxe-btn-primary inline-flex min-h-[56px] items-center justify-center rounded-[var(--radius-md)] px-8 py-4 text-[length:var(--text-body)] font-medium tracking-[var(--tracking-wide)] disabled:cursor-not-allowed disabled:opacity-60"
			>
				{busy ? "Spawning ego in CARLA…" : "Start autonomous test drive"}
			</button>
			<p className="text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
				We use your live location for real weather, traffic, and pavement
				modelling. Denied? We fall back to Bangalore.
			</p>
			{error ? (
				<p className="text-[length:var(--text-sm)] text-[color:var(--color-danger,#f87171)]">
					{error}
				</p>
			) : null}
		</div>
	);
}
