"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TestDriveButton(): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/proxy/scenarios/test-drive/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
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
      router.push(json.data.dashboardUrl);
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
      {error ? (
        <p className="text-[length:var(--text-sm)] text-[color:var(--color-danger,#f87171)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
