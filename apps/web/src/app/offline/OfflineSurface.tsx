"use client";

import { useCallback, useEffect, useState } from "react";
import { AmbientGlow, GlassPanel, SpecLabel } from "../../components/luxe";
import { Button } from "../../components/ui";

interface Labels {
  eyebrow: string;
  title: string;
  subtitle: string;
  cached: string;
  queued: string;
  safety: string;
  diagnostics: string;
  swVersion: string;
  queueLength: string;
  lastOnline: string;
  swUnavailable: string;
  lastOnlineNever: string;
  tryAgain: string;
  tryingAgain: string;
}

export function OfflineSurface({ labels }: { labels: Labels }): React.JSX.Element {
  const [swVersion, setSwVersion] = useState<string>(labels.swUnavailable);
  const [queueLength, setQueueLength] = useState<number>(0);
  const [lastOnline, setLastOnline] = useState<string>(labels.lastOnlineNever);
  const [tryingAgain, setTryingAgain] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function read(): Promise<void> {
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!cancelled) {
          setSwVersion(
            reg?.active?.scriptURL
              ? new URL(reg.active.scriptURL).pathname
              : labels.swUnavailable,
          );
        }
      }
      try {
        const mod = await import("../../lib/offline");
        if (cancelled) return;
        const queue = await mod.listQueue().catch(() => []);
        setQueueLength(queue.length);
        const last = (await mod.getMeta("lastOnline").catch(() => null)) as
          | number
          | null;
        if (typeof last === "number") {
          setLastOnline(new Date(last).toLocaleString());
        }
      } catch {
        /* IndexedDB unavailable in the test environment — silent. */
      }
    }
    void read();
    return () => {
      cancelled = true;
    };
  }, [labels.swUnavailable]);

  const onTryAgain = useCallback(async (): Promise<void> => {
    setTryingAgain(true);
    try {
      if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage("force-revalidate");
      }
      // Light delay so the user perceives the action.
      await new Promise((r) => setTimeout(r, 240));
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } finally {
      setTryingAgain(false);
    }
  }, []);

  return (
    <div className="relative isolate mx-auto flex min-h-[640px] w-full max-w-[820px] items-center justify-center px-6 py-[80px]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[var(--radius-xl)]"
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(180deg, rgba(8,9,12,0.55) 0%, rgba(8,9,12,0.85) 100%), url("/images/loading-gauge.png"), linear-gradient(135deg, #08090c 0%, #11151d 50%, #1b2230 100%)',
            backgroundSize: "cover, cover, cover",
            backgroundPosition: "center",
            opacity: 1,
          }}
        />
        <AmbientGlow tone="sky" className="!inset-[-30%_auto_auto_-20%] !w-[80%] !h-[80%] opacity-50" />
        <AmbientGlow tone="copper" className="!inset-[auto_-20%_-30%_auto] !w-[60%] !h-[60%] opacity-40" />
      </div>

      <GlassPanel variant="elevated" className="w-full !p-10 md:!p-12">
        <div className="flex flex-col gap-7">
          <div className="flex flex-col gap-4">
            <SpecLabel>{labels.eyebrow}</SpecLabel>
            <h2 className="font-[family-name:var(--font-display)] text-[clamp(2.25rem,5vw,3.25rem)] font-medium leading-[1.05] tracking-[var(--tracking-tight)] text-pearl">
              {labels.title}
            </h2>
            <p className="max-w-[52ch] text-[var(--text-lg)] leading-[1.55] text-pearl-muted">
              {labels.subtitle}
            </p>
          </div>

          <ul className="flex flex-col">
            {[
              { line: labels.cached, dot: "sky" },
              { line: labels.queued, dot: "copper" },
              { line: labels.safety, dot: "emerald" },
            ].map(({ line, dot }) => (
              <li
                key={line}
                className="flex items-start gap-4 border-t border-[var(--color-hairline)] py-4 first:border-t-0"
              >
                <span
                  aria-hidden="true"
                  className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      dot === "sky"
                        ? "var(--color-accent-sky)"
                        : dot === "copper"
                          ? "var(--color-copper)"
                          : "var(--color-emerald)",
                    boxShadow:
                      dot === "copper"
                        ? "0 0 8px rgba(201,163,106,0.55)"
                        : "none",
                  }}
                />
                <span className="text-[var(--text-control)] leading-[1.55] text-pearl">{line}</span>
              </li>
            ))}
          </ul>

          <GlassPanel variant="muted" className="!p-5">
            <SpecLabel>{labels.diagnostics}</SpecLabel>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <DiagnosticRow label={labels.swVersion} value={swVersion} />
              <DiagnosticRow label={labels.queueLength} value={String(queueLength)} />
              <DiagnosticRow label={labels.lastOnline} value={lastOnline} />
            </dl>
          </GlassPanel>

          <div className="flex justify-center pt-2">
            <Button onClick={onTryAgain} loading={tryingAgain} loadingText={labels.tryingAgain} size="lg">
              {labels.tryAgain}
            </Button>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[var(--text-caption)] tracking-[var(--tracking-wide)] uppercase text-pearl-soft">
        {label}
      </dt>
      <dd className="luxe-mono text-[var(--text-control)] text-pearl">{value}</dd>
    </div>
  );
}
