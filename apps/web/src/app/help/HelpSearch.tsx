"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { searchHelp } from "../../lib/helpSearch";
import { Input } from "../../components/ui/Form";
import { GlassPanel, SpecLabel } from "../../components/luxe";
import { EmptyState } from "../../components/states";

const SEARCH_INPUT_ID = "help-search";

export function HelpSearch(): React.JSX.Element {
  const t = useTranslations();
  const [q, setQ] = useState("");
  const results = useMemo(() => searchHelp(q), [q]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName ?? "";
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        const el = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null;
        el?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showResults = q.trim().length > 0;

  return (
    <div className="space-y-5">
      <div className="relative">
        <span
          aria-hidden="true"
          className="luxe-mono pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 rounded-[6px] border border-[var(--color-hairline-strong)] px-1.5 py-0.5 text-[length:var(--text-caption)] text-pearl-soft"
        >
          /
        </span>
        <label htmlFor={SEARCH_INPUT_ID} className="sr-only">
          {t("help.search.label")}
        </label>
        <Input
          id={SEARCH_INPUT_ID}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("help.search.placeholder")}
          className="!min-h-[64px] !pl-14 !pr-5 !text-[length:var(--text-lg)]"
          aria-controls="help-search-results"
          aria-describedby="help-search-hint"
        />
        <p
          id="help-search-hint"
          className="mt-2 text-[length:var(--text-caption)] tracking-[var(--tracking-wide)] text-pearl-soft"
        >
          {t("help.search.hint")}
        </p>
      </div>

      <div
        id="help-search-results"
        role="region"
        aria-live="polite"
        aria-label={t("help.search.resultsLabel")}
      >
        {!showResults ? null : results.length === 0 ? (
          <EmptyState
            heading={t("help.search.noResultsTitle")}
            body={t("help.search.noResultsBody", { query: q })}
          />
        ) : (
          <ul className="grid gap-3">
            {results.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/help/${r.slug}` as `/help/${string}`}
                  className="block"
                >
                  <GlassPanel interactive className="!py-5">
                    <SpecLabel>{r.title}</SpecLabel>
                    <p className="mt-2 text-[length:var(--text-control)] leading-[1.55] text-pearl-muted">
                      {r.excerpt}
                    </p>
                  </GlassPanel>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
