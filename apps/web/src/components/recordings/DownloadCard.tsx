// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

// The "your run is ready" card. Three things happen here:
// 1. A composite poster (three frames stitched into a single 960x180 image) is
//    rendered with a clear caption so screen readers know what they are
//    looking at.
// 2. The primary CTA is a real <a download> so the browser's download manager
//    handles the file save. On hover we prepend a <link rel="prefetch"> to
//    document.head so the actual click is instant — and we always remove it on
//    unmount.
// 3. A secondary "copy share link" button copies the absolute URL via
//    navigator.clipboard, with a callback the parent uses to surface a toast.

"use client";

import { useEffect, useRef } from "react";
import { GlassPanel, SpecLabel } from "../luxe";
import { Button } from "../ui/Button";
import { prettyBytes, prettyDuration } from "../../lib/recordings";

export interface DownloadCardProps {
  fileUrl: string;
  posterUrl: string;
  sizeBytes: number;
  durationS: number;
  encoder: string;
  onCopyLink?: (absoluteUrl: string) => void;
  onCopyError?: (message: string) => void;
}

export function DownloadCard({
  fileUrl,
  posterUrl,
  sizeBytes,
  durationS,
  encoder,
  onCopyLink,
  onCopyError,
}: DownloadCardProps): React.JSX.Element {
  const prefetchRef = useRef<HTMLLinkElement | null>(null);
  const ctaLabel = `Download demo (4K · 60fps · ${encoder.toUpperCase()} · ${prettyBytes(
    sizeBytes,
  )} · ${prettyDuration(durationS)})`;

  useEffect(() => {
    return () => {
      if (prefetchRef.current && prefetchRef.current.parentNode) {
        prefetchRef.current.parentNode.removeChild(prefetchRef.current);
        prefetchRef.current = null;
      }
    };
  }, []);

  const ensurePrefetch = (): void => {
    if (prefetchRef.current) return;
    if (typeof document === "undefined") return;
    const el = document.createElement("link");
    el.rel = "prefetch";
    el.href = fileUrl;
    el.as = "video";
    document.head.appendChild(el);
    prefetchRef.current = el;
  };

  const onCopy = async (): Promise<void> => {
    const absolute =
      typeof window !== "undefined" ? `${window.location.origin}${fileUrl}` : fileUrl;
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard not available");
      }
      await navigator.clipboard.writeText(absolute);
      onCopyLink?.(absolute);
    } catch (err) {
      onCopyError?.(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <GlassPanel variant="elevated" as="section" aria-label="Download your demo recording">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <SpecLabel>Run complete</SpecLabel>
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h2)] text-pearl">
            Your demo is ready.
          </h2>
          <p className="text-[length:var(--text-control)] text-pearl-muted leading-[1.55]">
            One 4K, 60 fps file. The poster below is a composite of three frames
            from the run — start, mid-point, finish.
          </p>
        </div>

        <figure className="flex flex-col gap-2">
          <img
            src={posterUrl}
            alt="Composite preview, three frames from the run"
            width={960}
            height={180}
            loading="lazy"
            decoding="async"
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[rgba(255,255,255,0.02)]"
          />
          <figcaption className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
            Three-frame poster · start · mid · finish
          </figcaption>
        </figure>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href={fileUrl}
            download
            data-testid="download-cta"
            onMouseEnter={ensurePrefetch}
            onFocus={ensurePrefetch}
            className="luxe-btn-primary inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[var(--radius-md)] px-6 py-3 text-[length:var(--text-body)] font-medium tracking-[var(--tracking-wide)]"
          >
            {ctaLabel}
          </a>
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              void onCopy();
            }}
            data-testid="copy-link"
          >
            Copy share link
          </Button>
        </div>
      </div>
    </GlassPanel>
  );
}
