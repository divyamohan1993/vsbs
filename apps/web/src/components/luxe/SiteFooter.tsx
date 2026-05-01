// SiteFooter — minimal closing bar. Tiny wordmark, the safety notice link,
// and the GitHub link. Quiet on purpose: the page should end on the work,
// not on chrome.

import Link from "next/link";
import { Brand } from "./Brand";

interface SiteFooterProps {
  labels: {
    safety: string;
    repo: string;
    privacy: string;
    region: string;
  };
}

export function SiteFooter({ labels }: SiteFooterProps): React.JSX.Element {
  return (
    <footer className="mx-auto mt-[120px] w-full max-w-[1440px] border-t border-[var(--color-hairline)] px-6 py-10 md:px-10">
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <Brand size="sm" />
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link
            href={{ pathname: "/me/consent" }}
            className="text-[length:var(--text-control)] text-pearl-muted hover:text-pearl"
          >
            {labels.privacy}
          </Link>
          <Link
            href={{ pathname: "/region" }}
            className="text-[length:var(--text-control)] text-pearl-muted hover:text-pearl"
          >
            {labels.region}
          </Link>
          <a
            href="https://github.com/dmj-one/vehicle-service-booking-system"
            target="_blank"
            rel="noreferrer"
            className="text-[length:var(--text-control)] text-pearl-muted hover:text-pearl"
          >
            {labels.repo}
          </a>
          <Link
            href={{ pathname: "/help" }}
            className="text-[length:var(--text-control)] text-pearl-muted hover:text-pearl"
          >
            {labels.safety}
          </Link>
        </nav>
      </div>
      <p className="luxe-spec-label mt-6 !text-[0.625rem]">
        Apple cars do not pull themselves over. We engineer for the day they could.
      </p>
    </footer>
  );
}
