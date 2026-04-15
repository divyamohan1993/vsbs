"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

type Purpose = string;

interface ConsentToggle {
  purpose: Purpose;
  granted: boolean;
}

export function ConsentToggles({
  purposes,
}: {
  purposes: Purpose[];
}): React.JSX.Element {
  const t = useTranslations();
  const [items, setItems] = useState<ConsentToggle[]>(
    purposes.map((p) => ({ purpose: p, granted: p === "service-fulfilment" })),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function revoke(purpose: Purpose): void {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/proxy/me/consent/${encodeURIComponent(purpose)}`, {
          method: "DELETE",
        });
        if (!res.ok && res.status !== 404) {
          throw new Error(`Revoke failed (${res.status})`);
        }
        setItems((xs) =>
          xs.map((x) => (x.purpose === purpose ? { ...x, granted: false } : x)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function toggle(purpose: Purpose): void {
    setItems((xs) =>
      xs.map((x) => (x.purpose === purpose ? { ...x, granted: !x.granted } : x)),
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="rounded-[var(--radius-card)] border-2 border-danger px-4 py-3">
          {error}
        </div>
      ) : null}
      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.purpose}
            className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-muted/30 p-5 md:flex-row md:items-center md:justify-between"
          >
            <div className="space-y-1">
              <p className="font-semibold" lang="en">
                {t(`consent.purposes.${item.purpose}.en`)}
              </p>
              <p className="text-muted text-sm" lang="hi">
                {t(`consent.purposes.${item.purpose}.hi`)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.granted}
                  onChange={() => toggle(item.purpose)}
                />
                <span className="text-sm">
                  {item.granted ? t("consent.granted") : t("consent.notGranted")}
                </span>
              </label>
              <button
                type="button"
                onClick={() => revoke(item.purpose)}
                disabled={pending || !item.granted}
                className="inline-flex items-center justify-center rounded-[var(--radius-card)] border-2 border-danger px-4 py-2 text-sm font-semibold text-on-surface"
              >
                {t("consent.revoke")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
