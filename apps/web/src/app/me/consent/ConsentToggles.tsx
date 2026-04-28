"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

type Purpose = string;

interface EffectiveItem {
  purpose: Purpose;
  granted: boolean;
  version: string;
  at: string;
  staleAgainst?: string;
}

interface ConsentSnapshot {
  ownerId: string;
  latestVersions: Record<Purpose, string>;
  items: EffectiveItem[];
  needsReConsent: Purpose[];
}

export function ConsentToggles({
  purposes,
}: {
  purposes: Purpose[];
}): React.JSX.Element {
  const t = useTranslations();
  const [snapshot, setSnapshot] = useState<ConsentSnapshot | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Purpose | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    setError(null);
    try {
      const res = await fetch("/api/proxy/me/consent", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const json = (await res.json()) as { data: ConsentSnapshot };
      setSnapshot(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function grant(purpose: Purpose): void {
    if (!snapshot) return;
    setBusy(purpose);
    startTransition(async () => {
      try {
        const res = await fetch("/api/proxy/me/consent/grant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            purpose,
            version: snapshot.latestVersions[purpose],
            source: "web",
          }),
        });
        if (!res.ok) throw new Error(`Grant failed (${res.status})`);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    });
  }

  function revoke(purpose: Purpose): void {
    setBusy(purpose);
    startTransition(async () => {
      try {
        const res = await fetch("/api/proxy/me/consent/revoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose }),
        });
        if (!res.ok && res.status !== 409) throw new Error(`Revoke failed (${res.status})`);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    });
  }

  const items: EffectiveItem[] = purposes.map((p) => {
    const found = snapshot?.items.find((it) => it.purpose === p);
    if (found) return found;
    return {
      purpose: p,
      granted: p === "service-fulfilment",
      version: snapshot?.latestVersions[p] ?? "1.0.0",
      at: "",
    };
  });

  return (
    <div className="space-y-4" aria-busy={pending}>
      {error ? (
        <div role="alert" className="rounded-[var(--radius-card)] border-2 border-danger px-4 py-3">
          {error}
        </div>
      ) : null}
      {snapshot && snapshot.needsReConsent.length > 0 ? (
        <div role="status" className="rounded-[var(--radius-card)] border-2 border-warning px-4 py-3">
          {t("consent.staleBanner", { count: snapshot.needsReConsent.length })}
        </div>
      ) : null}
      <ul className="space-y-3">
        {items.map((item) => {
          const stale = item.staleAgainst !== undefined;
          const latest = snapshot?.latestVersions[item.purpose] ?? item.version;
          const id = `consent-${item.purpose}`;
          return (
            <li
              key={item.purpose}
              className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-muted/30 p-5 md:flex-row md:items-start md:justify-between"
            >
              <div className="space-y-1">
                <label htmlFor={id} className="font-semibold" lang="en">
                  {t(`consent.purposes.${item.purpose}.en`)}
                </label>
                <p className="text-muted text-sm" lang="hi">
                  {t(`consent.purposes.${item.purpose}.hi`)}
                </p>
                <p className="text-muted text-xs">
                  {stale
                    ? t("consent.staleDetail", { from: item.version, to: latest })
                    : t("consent.versionDetail", { version: item.version || latest })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2">
                  <input
                    id={id}
                    type="checkbox"
                    checked={item.granted && !stale}
                    aria-checked={item.granted && !stale}
                    disabled={busy === item.purpose}
                    onChange={() => (item.granted ? revoke(item.purpose) : grant(item.purpose))}
                  />
                  <span className="text-sm">
                    {item.granted ? t("consent.granted") : t("consent.notGranted")}
                  </span>
                </label>
                {item.granted ? (
                  <button
                    type="button"
                    onClick={() => revoke(item.purpose)}
                    disabled={busy === item.purpose}
                    className="inline-flex items-center justify-center rounded-[var(--radius-card)] border-2 border-danger px-4 py-2 text-sm font-semibold text-on-surface"
                  >
                    {t("consent.revoke")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => grant(item.purpose)}
                    disabled={busy === item.purpose}
                    className="inline-flex items-center justify-center rounded-[var(--radius-card)] border-2 border-primary px-4 py-2 text-sm font-semibold text-on-surface"
                  >
                    {t("consent.grant")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
