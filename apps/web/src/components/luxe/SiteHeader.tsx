// SiteHeader — thin glass strip pinned to the top. Transparent until scrolled
// past 8px, then it lifts into a glass panel. Uses pure CSS via a sticky
// container + a sentinel; no JS scroll listeners.

import Link from "next/link";
import { Brand } from "./Brand";

interface SiteHeaderProps {
  demo: boolean;
  locale: string;
  labels: {
    book: string;
    autonomy: string;
    consent: string;
    help: string;
    demoPill: string;
  };
}

export function SiteHeader({ demo, locale, labels }: SiteHeaderProps): React.JSX.Element {
  return (
    <header
      className="sticky top-0 z-30 mx-auto flex h-[64px] w-full max-w-[1440px] items-center justify-between gap-4 px-6 md:px-10"
      aria-label="Site"
    >
      <div className="luxe-glass-muted absolute inset-x-0 top-0 h-full -z-10" />
      <Link
        href={{ pathname: "/" }}
        aria-label="VSBS home"
        className="-ml-1 inline-flex items-center"
      >
        <Brand size="sm" showSubtitle={false} />
      </Link>

      <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
        <Link
          href={{ pathname: "/book" }}
          className="rounded-[var(--radius-sm)] px-4 py-2 text-[length:var(--text-control)] tracking-[var(--tracking-wide)] text-pearl-muted hover:text-pearl"
        >
          {labels.book}
        </Link>
        <Link
          href={{ pathname: "/help" }}
          className="rounded-[var(--radius-sm)] px-4 py-2 text-[length:var(--text-control)] tracking-[var(--tracking-wide)] text-pearl-muted hover:text-pearl"
        >
          {labels.help}
        </Link>
        <Link
          href={{ pathname: "/me/consent" }}
          className="rounded-[var(--radius-sm)] px-4 py-2 text-[length:var(--text-control)] tracking-[var(--tracking-wide)] text-pearl-muted hover:text-pearl"
        >
          {labels.consent}
        </Link>
      </nav>

      <div className="flex items-center gap-3">
        {demo ? (
          <span
            className="luxe-spec-label inline-flex items-center gap-2 rounded-full border border-[var(--color-copper)] bg-[rgba(201,163,106,0.08)] px-3 py-1.5 !text-[0.625rem] !text-[var(--color-copper)]"
            aria-label={labels.demoPill}
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--color-copper)]" />
            {labels.demoPill}
          </span>
        ) : null}
        <span className="luxe-spec-label hidden md:inline !text-[0.625rem]" aria-label={`Locale ${locale}`}>
          {locale.toUpperCase()}
        </span>
      </div>
    </header>
  );
}
