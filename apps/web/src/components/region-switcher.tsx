"use client";

// Region switcher — surfaces the current region, the detected one, and
// (when no pending bookings exist) lets the user switch. CSP-clean: no
// inline scripts, all logic comes from this module via React.
// On switch the API responds with a regional FQDN; we hard-navigate so
// subsequent requests land on the correct data plane (residency).

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

type RegionId = "asia-south1" | "us-central1";

interface RegionState {
  detected: RegionId;
  pinned: RegionId;
  reason: "explicit-header" | "cookie" | "geo" | "fallback";
  country: string | null;
  allowedSwitch: boolean;
  knownRegions: RegionId[];
  pendingBookings: number;
}

interface ApiSuccess<T> {
  data: T;
}

interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

function isError<T>(r: ApiSuccess<T> | ApiError): r is ApiError {
  return (r as ApiError).error !== undefined;
}

const REGION_LABEL: Record<RegionId, string> = {
  "asia-south1": "India (asia-south1)",
  "us-central1": "United States (us-central1)",
};

export function RegionSwitcher(): React.JSX.Element {
  const t = useTranslations();
  const [state, setState] = useState<RegionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/proxy/region/me", { method: "GET" });
        const body = (await res.json()) as ApiSuccess<RegionState> | ApiError;
        if (!alive) return;
        if (isError(body)) {
          setError(body.error.message);
          return;
        }
        setState(body.data);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function switchTo(target: RegionId): void {
    if (!state || target === state.pinned) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/proxy/region/switch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to: target }),
        });
        const body = (await res.json()) as
          | ApiSuccess<{
              ok: true;
              changed: boolean;
              pinned: RegionId;
              webBaseUrl: string | null;
            }>
          | ApiError;
        if (isError(body)) {
          if (res.status === 409 && body.error.code === "REGION_SWITCH_BLOCKED") {
            setError(t("region.errors.switchBlocked"));
            return;
          }
          setError(body.error.message);
          return;
        }
        // Hard-navigate to the new regional FQDN if the API surfaced one;
        // otherwise reload in place so the new cookie takes effect.
        if (body.data.changed && body.data.webBaseUrl) {
          window.location.href = body.data.webBaseUrl;
          return;
        }
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (!state && !error) {
    return (
      <p role="status" aria-live="polite" className="text-muted">
        {t("region.loading")}
      </p>
    );
  }

  if (error) {
    return (
      <p role="alert" className="rounded-[var(--radius-card)] border border-red-500/40 bg-red-500/10 p-4 text-red-200">
        {error}
      </p>
    );
  }

  if (!state) return <></>;

  return (
    <div className="space-y-6">
      <dl className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-muted/30 p-4">
          <dt className="text-muted text-sm uppercase tracking-[0.18em]">
            {t("region.pinned")}
          </dt>
          <dd className="mt-1 font-display text-xl">{REGION_LABEL[state.pinned]}</dd>
          <p className="text-muted mt-2 text-sm">
            {t("region.reason." + state.reason)}
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-muted/30 p-4">
          <dt className="text-muted text-sm uppercase tracking-[0.18em]">
            {t("region.detected")}
          </dt>
          <dd className="mt-1 font-display text-xl">{REGION_LABEL[state.detected]}</dd>
          <p className="text-muted mt-2 text-sm">
            {state.country
              ? t("region.detectedCountry", { country: state.country })
              : t("region.detectedNone")}
          </p>
        </div>
      </dl>

      <fieldset
        className="space-y-3 rounded-[var(--radius-card)] border border-muted/30 p-4"
        aria-describedby="region-switch-help"
      >
        <legend className="font-display text-lg font-semibold">{t("region.switchLegend")}</legend>
        <p id="region-switch-help" className="text-muted text-sm">
          {state.allowedSwitch
            ? t("region.switchOk")
            : t("region.switchBlockedHint", { count: state.pendingBookings })}
        </p>
        <ul className="grid gap-2 md:grid-cols-2">
          {state.knownRegions.map((r) => {
            const isActive = r === state.pinned;
            const disabled = !state.allowedSwitch || isActive || isPending;
            return (
              <li key={r}>
                <button
                  type="button"
                  onClick={() => switchTo(r)}
                  disabled={disabled}
                  aria-pressed={isActive}
                  className="inline-flex w-full items-center justify-between gap-3 rounded-[var(--radius-card)] border-2 border-accent bg-accent px-4 py-3 text-left text-base font-semibold text-accent-on disabled:cursor-not-allowed disabled:border-muted/30 disabled:bg-transparent disabled:text-muted"
                >
                  <span>{REGION_LABEL[r]}</span>
                  {isActive ? (
                    <span aria-hidden="true" className="text-sm font-normal opacity-80">
                      {t("region.current")}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </div>
  );
}
