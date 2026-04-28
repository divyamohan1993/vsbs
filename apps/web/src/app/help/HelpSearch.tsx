"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { searchHelp } from "../../lib/helpSearch";
import { Input, Label } from "../../components/ui/Form";
import { EmptyState } from "../../components/states";

export function HelpSearch(): React.JSX.Element {
  const t = useTranslations();
  const [q, setQ] = useState("");
  const results = useMemo(() => searchHelp(q), [q]);

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="help-search">{t("help.search.label")}</Label>
        <Input
          id="help-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("help.search.placeholder")}
          className="mt-1"
          aria-controls="help-search-results"
          aria-describedby="help-search-hint"
        />
        <p id="help-search-hint" className="mt-1 text-xs text-muted">
          {t("help.search.hint")}
        </p>
      </div>

      <div id="help-search-results" role="region" aria-live="polite" aria-label={t("help.search.resultsLabel")}>
        {q.trim().length === 0 ? null : results.length === 0 ? (
          <EmptyState
            heading={t("help.search.noResultsTitle")}
            body={t("help.search.noResultsBody", { query: q })}
          />
        ) : (
          <ul className="grid gap-2">
            {results.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/help/${r.slug}` as `/help/${string}`}
                  className="block rounded-[var(--radius-card)] border border-muted/30 p-3 hover:border-accent"
                  style={{ backgroundColor: "oklch(20% 0.02 260)" }}
                >
                  <p className="font-display text-base font-semibold">{r.title}</p>
                  <p className="mt-1 text-sm text-muted">{r.excerpt}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
