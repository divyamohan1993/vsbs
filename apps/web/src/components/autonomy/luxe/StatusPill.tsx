"use client";

// StatusPill — small caps capsule used to surface autonomy state.
// Tone matrix mirrors the dashboard semantics: "live" copper for the camera
// feed, "ok" emerald for an active grant, "alert" copper for a watch state,
// "halt" crimson for a halted grant.

import type { ReactNode } from "react";
import { cn } from "../../ui/cn";

export type StatusPillTone = "live" | "ok" | "watch" | "halt" | "neutral";

interface StatusPillProps {
  tone: StatusPillTone;
  children: ReactNode;
  size?: "sm" | "md";
  className?: string;
}

const TONE_BORDER: Record<StatusPillTone, string> = {
  live: "var(--color-copper)",
  ok: "var(--color-emerald)",
  watch: "var(--color-amber)",
  halt: "var(--color-crimson)",
  neutral: "var(--color-hairline-strong)",
};

const TONE_DOT: Record<StatusPillTone, string> = {
  live: "var(--color-copper)",
  ok: "var(--color-emerald)",
  watch: "var(--color-amber)",
  halt: "var(--color-crimson)",
  neutral: "var(--color-pearl-soft)",
};

const TONE_BG: Record<StatusPillTone, string> = {
  live: "rgba(201, 163, 106, 0.10)",
  ok: "rgba(31, 143, 102, 0.12)",
  watch: "rgba(217, 164, 65, 0.12)",
  halt: "rgba(178, 58, 72, 0.16)",
  neutral: "rgba(255, 255, 255, 0.04)",
};

export function StatusPill({ tone, children, size = "md", className }: StatusPillProps): React.JSX.Element {
  const sizing =
    size === "sm"
      ? "px-2 py-[3px] text-[length:var(--text-micro)]"
      : "px-3 py-1 text-[length:var(--text-caption)]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border luxe-mono uppercase tracking-[var(--tracking-caps)] text-pearl",
        sizing,
        className,
      )}
      style={{
        borderColor: TONE_BORDER[tone],
        backgroundColor: TONE_BG[tone],
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-[6px] w-[6px] rounded-full"
        style={{
          background: TONE_DOT[tone],
          boxShadow: tone !== "neutral" ? `0 0 6px ${TONE_DOT[tone]}` : undefined,
        }}
      />
      {children}
    </span>
  );
}
